"""Candidate search: rank possible movers, give each a motion path and predicted positions.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Everything here produces CANDIDATES.  A high rank means "look here first", never
"this is a real object".  Mounted by backend.app.
"""
from __future__ import annotations

import math
import re
import threading
import time
from collections import OrderedDict
from typing import Sequence

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request
from scipy import ndimage

from . import align, config, jobs, ranker, service, tilt

router = APIRouter()
_KEY_RE = re.compile(r"^[0-9a-f]{20}$")
_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_cache_lock = threading.Lock()
_CACHE_MAX = 24


def path_pixel(x0: float, y0: float, vx: float, vy: float, dt_yr: float, pixscale: float) -> tuple[float, float]:
    """Pixel (column, row) of a mover at ``dt_yr`` years after the reference epoch.

    The grid is north-up with east to the left: east (+vx) is towards smaller x,
    north (+vy) is towards larger row.  This is the inverse of ``tilt.pixel_shifts``.
    """
    return x0 - vx * dt_yr / pixscale, y0 + vy * dt_yr / pixscale


def rank_candidates(
    images: Sequence[np.ndarray],
    mjds: Sequence[float],
    pixscale: float,
    span: float = 12.0,
    step: float = 1.0,
    top: int = 5,
) -> tuple[list[dict], tilt.MotionMap]:
    """Local maxima of the motion map, best first, with a refined stack position.

    Velocities within one grid step of zero are left out: a peak there is a fixed
    source that did not subtract well, not a mover.  Two maxima closer than two
    grid steps count as one.
    """
    mm = tilt.motion_map(images, mjds, pixscale, span=span, step=step)
    score = np.asarray(mm.score, dtype=np.float64)
    nv = score.shape[0]
    half = nv // 2
    local = score >= ndimage.maximum_filter(score, size=3, mode="nearest")
    order = np.argsort(score, axis=None)[::-1]
    taken: list[tuple[int, int]] = []
    out: list[dict] = []
    npix = np.asarray(images[0]).shape[0]
    for flat in order:
        if len(out) >= top:
            break
        j, i = divmod(int(flat), nv)
        if not local[j, i]:
            continue
        if abs(j - half) <= 1 and abs(i - half) <= 1:
            continue
        if any(abs(j - tj) <= 2 and abs(i - ti) <= 2 for tj, ti in taken):
            continue
        taken.append((j, i))
        vx, vy = float(mm.vxs[i]), float(mm.vys[j])
        x, y = (int(mm.peaks[j, i, 0]), int(mm.peaks[j, i, 1])) if mm.peaks is not None else (npix // 2, npix // 2)
        stacked, _ = tilt.shift_sum(images, mjds, vx, vy, pixscale, static="median")
        # Refine the position on the real stack, within 2 pixels of the map's peak.
        y0, y1, x0, x1 = max(0, y - 2), min(npix, y + 3), max(0, x - 2), min(npix, x + 3)
        sub = ndimage.gaussian_filter(stacked, 1.0)[y0:y1, x0:x1]
        if sub.size:
            dy, dx = np.unravel_index(int(np.argmax(sub)), sub.shape)
            x, y = x0 + int(dx), y0 + int(dy)
        s = float(score[j, i])
        speed = math.hypot(vx, vy)
        out.append({
            "vx": round(vx, 4), "vy": round(vy, 4),
            "speed_arcsec_yr": round(speed, 3),
            # Position angle: 0 = north, 90 = east.
            "pa_deg": round(math.degrees(math.atan2(vx, vy)) % 360.0, 1),
            "score": round(s, 2),
            "ratio": round(s / mm.zero_score, 3) if mm.zero_score > 0 else None,
            "x": x, "y": y,
            "patch_score": round(ranker.patch_score(stacked, x, y), 3),
        })
    # Final order: motion-map score, weighted by the point-source shape hint.
    out.sort(key=lambda c: c["score"] * (0.25 + 0.75 * c["patch_score"]), reverse=True)
    for rank, c in enumerate(out, start=1):
        c["rank"] = rank
    return out, mm


def _now_mjd() -> float:
    return time.time() / 86400.0 + 40587.0


@router.get("/api/jobs/{key}/candidates")
def job_candidates(
    request: Request,
    key: str,
    detector: int = Query(..., ge=1, le=102),
    span: float = Query(12.0, ge=1.0, le=60.0),
    step: float = Query(1.0, ge=0.25, le=20.0),
    top: int = Query(5, ge=1, le=10),
) -> dict:
    """Ranked motion candidates for one band, with a path over every frame of the job."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise HTTPException(404, "job not found")
    if detector > 6 and detector not in (101, 102):
        raise HTTPException(422, "detector must be 1-6, 101 or 102")
    service.enforce_analysis_limit(request)
    state = job.status()
    frames = sorted((m for m in state.get("frames", []) if m.get("status") == "ok"), key=lambda m: m["mjd"])
    used = [m for m in frames if m.get("detector") == detector]
    memo = (key, detector, span, step, top, len(frames), state.get("updated"))
    with _cache_lock:
        if memo in _cache:
            _cache.move_to_end(memo)
            return _cache[memo]

    images, metas = [], []
    for meta in used:
        path = job.dir / "frames" / f"{meta['index']:03d}.npy"
        if path.exists():
            images.append(np.load(path))
            metas.append(meta)
    if len(images) < 3:
        raise HTTPException(400, "the candidate search needs at least 3 frames in this band")
    g = state.get("grid") or {}
    pixscale = float(g.get("pixscale_arcsec", config.DEFAULT_PIXSCALE))
    npix = int(g.get("npix", images[0].shape[0]))
    mjds = [float(m["mjd"]) for m in metas]
    try:
        found, mm = rank_candidates(images, mjds, pixscale, span=span, step=step, top=top)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    t0 = min(mjds)
    wcs = None
    if "center_ra" in g and "center_dec" in g:
        wcs = align.make_grid(float(g["center_ra"]), float(g["center_dec"]), npix, pixscale)

    def sky(x: float, y: float) -> tuple[float | None, float | None]:
        if wcs is None:
            return None, None
        ra, dec = wcs.all_pix2world([[x, y]], 0)[0]
        return round(float(ra) % 360.0, 6), round(float(dec), 6)

    def point(c: dict, mjd: float) -> dict:
        x, y = path_pixel(c["x"], c["y"], c["vx"], c["vy"], (mjd - t0) / 365.25, pixscale)
        ra, dec = sky(x, y)
        return {"x": round(x, 2), "y": round(y, 2), "ra_deg": ra, "dec_deg": dec,
                "inside": bool(0 <= x <= npix - 1 and 0 <= y <= npix - 1)}

    now = _now_mjd()
    for c in found:
        c["ra_deg"], c["dec_deg"] = sky(c["x"], c["y"])
        # Where a source with this straight-line motion would be in EVERY frame of the
        # job (other bands too).  "used" marks the frames that went into the stack.
        c["path"] = [
            {"index": m["index"], "detector": m.get("detector"), "mjd": m["mjd"],
             "obs_time": m.get("obs_time", ""), "used": m.get("detector") == detector,
             **point(c, float(m["mjd"]))}
            for m in frames
        ]
        c["today"] = {"mjd": round(now, 3), **point(c, now)}

    result = {
        "detector": detector,
        "span": span, "step": step,
        "n_frames": len(images),
        "t0_mjd": t0,
        "zero_score": round(float(mm.zero_score), 2),
        "masked_fraction": round(float(mm.masked_fraction), 4),
        "model": ranker.info(),
        "caution": "Candidates only. A straight-line path ignores parallax. Check several bands and the catalogues.",
        "candidates": found,
    }
    with _cache_lock:
        _cache[memo] = result
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return result
