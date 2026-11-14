"""M3 check: plant a moving source in real SPHEREx frames and recover it.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

The test uses the cached Barnard's Star cube written by ``python -m
backend.precache``.  If no cache is present it is skipped, so a fresh clone
still passes the pure-synthetic tests in ``test_tilt_synthetic.py``.
"""
from __future__ import annotations

import glob
import json
import os

import numpy as np
import pytest
from scipy import ndimage

from backend import cache, config, tilt


def _find_cached_group(min_frames: int = 4):
    pattern = str(config.CACHE_DIR / "jobs" / "*" / "job.json")
    best = None
    for path in glob.glob(pattern):
        try:
            state = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        frames = [f for f in state.get("frames", []) if f.get("status") == "ok" and f.get("source", "spherex") == "spherex"]
        by_det: dict[int, list[dict]] = {}
        for f in frames:
            by_det.setdefault(f["detector"], []).append(f)
        for det, members in by_det.items():
            if len(members) >= min_frames:
                candidate = (len(members), os.path.dirname(path), det, members)
                if best is None or candidate[0] > best[0]:
                    best = candidate
    return best


def _load(members, job_dir):
    images, mjds = [], []
    for meta in sorted(members, key=lambda m: m["mjd"]):
        path = os.path.join(job_dir, "frames", f"{meta['index']:03d}.npy")
        images.append(np.load(path).astype(np.float64))
        mjds.append(meta["mjd"])
    return images, mjds


def _plant(images, mjds, vx, vy, pixscale, start=(35.0, 35.0), amp=400.0, sigma=1.0):
    """Add a Gaussian whose centroid moves at (vx, vy) arcsec/yr."""
    out = []
    t0 = min(mjds)
    ny, nx = images[0].shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    for image, mjd in zip(images, mjds):
        dt = (mjd - t0) / 365.25
        # vx is east (+RA).  The grid has a negative RA step, so east is -x.
        cx = start[0] - vx * dt / pixscale
        cy = start[1] + vy * dt / pixscale
        blob = amp * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma ** 2))
        out.append(image + blob)
    return out


@pytest.mark.skipif(_find_cached_group() is None, reason="no cached real frames; run backend.precache")
def test_tilt_recovers_planted_motion_in_real_frames():
    n, job_dir, det, members = _find_cached_group()
    images, mjds = _load(members, job_dir)
    pixscale = config.DEFAULT_PIXSCALE
    true_vx, true_vy = 24.0, -16.0

    planted = _plant(images, mjds, true_vx, true_vy, pixscale)

    # One grid step is 0.5 arcsec/yr; the source moves ~4 px over the baseline.
    vxs = np.arange(-32, 32.01, 0.5)
    vys = np.arange(-32, 32.01, 0.5)
    scores = np.zeros((len(vys), len(vxs)))
    for j, vy in enumerate(vys):
        for i, vx in enumerate(vxs):
            stacked, _ = tilt.shift_sum(planted, mjds, float(vx), float(vy), pixscale)
            scores[j, i] = tilt.sharpness(stacked)
    j, i = np.unravel_index(np.argmax(scores), scores.shape)
    fit_vx, fit_vy = float(vxs[i]), float(vys[j])

    zero_score = scores[np.argmin(np.abs(vys)), np.argmin(np.abs(vxs))]
    print(f"\nreal frames: detector {det}, n={len(images)}, span={(max(mjds)-min(mjds)):.1f} d")
    print(f"planted ({true_vx}, {true_vy}) -> recovered ({fit_vx}, {fit_vy}); "
          f"score {scores[j, i]:.1f} vs zero-motion {zero_score:.1f}")

    step = 0.5
    assert abs(fit_vx - true_vx) <= step, (fit_vx, true_vx)
    assert abs(fit_vy - true_vy) <= step, (fit_vy, true_vy)
    # Real frames carry a bright, slightly extended star, so the contrast gain is
    # ~1.8x; exact velocity recovery above is the stronger assertion.
    assert scores[j, i] > 1.6 * zero_score
