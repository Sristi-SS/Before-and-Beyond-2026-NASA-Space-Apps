"""Extra API routes (Gaia labels).  Mounted by backend.app with ``app.include_router(extras.router)``.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import json
import math
import re
import time
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, Query

from . import align, cache, config, gaia, jobs, resolve

router = APIRouter()
_KEY_RE = re.compile(r"^[0-9a-f]{20}$")


def mid_epoch_year(frames: list[dict]) -> float:
    """Decimal year of the middle of the job's SPHEREx frames (all frames if none)."""
    ok = [m for m in frames if m.get("status", "ok") == "ok"]
    pick = [m for m in ok if m.get("source", "spherex") == "spherex"] or ok
    mjds = sorted(float(m["mjd"]) for m in pick)
    if not mjds:
        return 2026.5
    return resolve.decimal_year(0.5 * (mjds[0] + mjds[-1]))


@router.get("/api/jobs/{key}/gaia")
def job_gaia(key: str) -> dict:
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise HTTPException(404, "job not found")
    state = job.status()
    g = state.get("grid")
    if not g:
        raise HTTPException(409, "the job has no grid yet")
    npix = int(g["npix"])
    pixscale = float(g["pixscale_arcsec"])
    grid = align.make_grid(float(g["center_ra"]), float(g["center_dec"]), npix, pixscale)
    epoch = mid_epoch_year(state.get("frames", []))
    # half-diagonal of the grid, plus a margin for the proper motion between 2016 and the epoch
    radius = 0.5 * npix * pixscale * math.sqrt(2.0) / 3600.0 + 0.01
    try:
        found = gaia.gaia_sources(float(g["center_ra"]), float(g["center_dec"]), radius, epoch, limit=300)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Gaia archive unavailable: {type(exc).__name__}") from exc
    sources = gaia.with_pixels(found, grid, npix, epoch, pixscale)
    return {
        "epoch_year": round(epoch, 3),
        "catalogue": "Gaia DR3 (positions propagated from 2016.0 with catalogue proper motion)",
        "n": len(sources),
        "limit": 300,
        "sources": sources,
    }


# ---------------------------------------------------------------------------
# Aperture photometry at one pixel: the frames at a pixel are a spectrum (one
# wavelength per frame) and a light curve (one date per frame).
# ---------------------------------------------------------------------------
def _units(meta: dict) -> str:
    if meta.get("source", "spherex") == "wise":
        return "unWISE nanomaggies (aperture sum)"
    return "MJy/sr (aperture sum)"


def aperture_photometry(data: np.ndarray, mask: Optional[np.ndarray], x: int, y: int, r: float) -> dict:
    """Aperture sum minus a local annulus median, with a noise estimate.

    ``data`` is indexed ``[row, col]`` = ``[y, x]``.  Aperture: pixel centres within ``r`` of
    (x, y).  Annulus: ``r + 2 < d <= r + 5`` (masked and non-finite pixels left out).  The noise
    is the annulus 1.4826*MAD scaled to the aperture, including the error of the background
    median.  ``flagged`` is True when any aperture pixel was masked (its value is interpolated,
    so the flux is a lower limit if it is a saturated core), and None when no mask is stored.
    """
    ny, nx = data.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    d = np.hypot(xx - x, yy - y)
    ap = d <= r
    ann = (d > r + 2.0) & (d <= r + 5.0)
    ok = np.isfinite(data)
    if mask is not None:
        ann &= mask == 0
    ann &= ok
    n_ap_all = int(ap.sum())
    ap_ok = ap & ok
    n_ap = int(ap_ok.sum())
    flagged = None if mask is None else bool((mask[ap] != 0).any())
    out = {"flux": None, "flux_err": None, "flagged": flagged, "n_aperture": n_ap, "n_annulus": int(ann.sum())}
    # The aperture must be mostly on the grid, and the annulus must have enough pixels.
    if n_ap == 0 or n_ap < 0.5 * math.pi * r * r or out["n_annulus"] < 8:
        return out
    bg_pix = data[ann].astype(np.float64)
    bg = float(np.median(bg_pix))
    sigma = 1.4826 * float(np.median(np.abs(bg_pix - bg)))
    flux = float(data[ap_ok].astype(np.float64).sum() - n_ap * bg)
    err = sigma * math.sqrt(n_ap * (1.0 + n_ap * math.pi / 2.0 / out["n_annulus"]))
    if not (math.isfinite(flux) and math.isfinite(err)):
        return out
    out["flux"] = flux
    out["flux_err"] = err
    return out


@router.get("/api/jobs/{key}/photometry")
def job_photometry(
    key: str,
    x: int = Query(..., ge=0, le=1023),
    y: int = Query(..., ge=0, le=1023),
    r: float = Query(2.0, ge=0.5, le=6.0),
) -> dict:
    """Per-frame photometry at pixel (x, y) of the job grid (x grows west, y north, 0-based)."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise HTTPException(404, "job not found")
    state = job.status()
    g = state.get("grid")
    if not g:
        raise HTTPException(409, "the job has no grid yet")
    npix = int(g["npix"])
    if x >= npix or y >= npix:
        raise HTTPException(422, f"pixel outside the {npix}x{npix} grid")
    grid = align.make_grid(float(g["center_ra"]), float(g["center_dec"]), npix, float(g["pixscale_arcsec"]))
    ra, dec = (float(v) for v in grid.all_pix2world(x, y, 0))
    metas = sorted((m for m in state.get("frames", []) if m.get("status", "ok") == "ok"),
                   key=lambda m: float(m["mjd"]))
    fdir = job.dir / "frames"
    rows, n_unknown = [], 0
    for meta in metas:
        idx = int(meta["index"])
        path = fdir / f"{idx:03d}.npy"
        if not path.exists():
            continue
        try:
            data = np.load(path)
        except (OSError, ValueError):
            continue
        mask = None
        mpath = fdir / f"{idx:03d}.mask.npy"
        if mpath.exists():
            try:
                mask = np.load(mpath)
                if mask.shape != data.shape:
                    mask = None
            except (OSError, ValueError):
                mask = None
        phot = aperture_photometry(data, mask, x, y, r)
        if phot["flagged"] is None:
            n_unknown += 1
        rows.append({
            "index": idx,
            "source": meta.get("source", "spherex"),
            "obs_time": meta.get("obs_time"),
            "mjd": meta.get("mjd"),
            "pass": meta.get("pass"),
            "detector": meta.get("detector"),
            "wavelength_um": meta.get("wavelength_um"),
            "bandwidth_um": meta.get("bandwidth_um"),
            "flux": phot["flux"],
            "flux_err": phot["flux_err"],
            "flagged": phot["flagged"],
            "units": _units(meta),
        })
    return {
        "x": x, "y": y, "radius_px": r, "npix": npix,
        "ra_deg": round(ra, 6), "dec_deg": round(dec, 6),
        "n": len(rows),
        "flag_info": "unknown for all frames" if rows and n_unknown == len(rows)
        else ("partly unknown" if n_unknown else "mask stored for every frame"),
        "note": ("Aperture sum minus local annulus median. Pixels the pipeline masked (for example "
                 "saturated star cores) were filled by interpolation, so flagged fluxes are lower limits. "
                 "SPHEREx and WISE units differ."),
        "frames": rows,
    }


# ---------------------------------------------------------------------------
# Scene 1 (sky globe): cached patches, name / coordinate resolution, bright stars.
# ---------------------------------------------------------------------------
def _light_job(state: dict) -> Optional[dict]:
    """Public, path-free summary of a finished job, or None."""
    if state.get("status") != "done":
        return None
    g = state.get("grid") or {}
    t = state.get("target") or {}
    try:
        ra = float(g.get("center_ra", t.get("ra_deg")))
        dec = float(g.get("center_dec", t.get("dec_deg")))
    except (TypeError, ValueError):
        return None
    frames = [m for m in state.get("frames", []) if m.get("status", "ok") == "ok"]
    n_wise_frames = sum(1 for m in frames if m.get("source") == "wise")
    n_spherex = sum(1 for m in frames if m.get("source", "spherex") != "wise")
    n_wise = max(n_wise_frames, int((state.get("wise") or {}).get("n") or 0))
    fov = state.get("params", {}).get("fov")
    if fov is None and g.get("fov_arcsec"):
        fov = float(g["fov_arcsec"]) / 3600.0
    return {
        "key": state.get("key"),
        "target": t.get("name") or "Custom position",
        "ra_deg": round(ra % 360.0, 5),
        "dec_deg": round(dec, 5),
        "fov_deg": round(float(fov), 3) if fov is not None else None,
        "n_spherex": n_spherex,
        "n_wise": n_wise,
        "status": "done",
    }


@router.get("/api/jobs")
def list_jobs() -> dict:
    """Every finished cube in the cache (light list for the sky globe)."""
    root = config.CACHE_DIR / "jobs"
    out: list[dict] = []
    if root.is_dir():
        for path in sorted(root.glob("*/job.json")):
            if not _KEY_RE.fullmatch(path.parent.name):
                continue
            try:
                item = _light_job(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue  # a file being rewritten right now
            if item and item["key"] == path.parent.name:
                out.append(item)
    return {"jobs": out}


_NAME_MAX = 80


def _clean_angle(text: str) -> str:
    return re.sub(r"[dD°'′″\"]", " ", text).strip()


def split_coordinates(text: str) -> Optional[tuple[str, str]]:
    """Split "ra dec" text (decimal or sexagesimal) into two strings, or None if it is not coordinates."""
    s = text.strip()
    if "," in s:
        parts = [p.strip() for p in s.split(",")]
        return (parts[0], parts[1]) if len(parts) == 2 and all(parts) else None
    tokens = s.split()
    if len(tokens) == 2:
        return tokens[0], tokens[1]
    if len(tokens) == 6:
        return " ".join(tokens[:3]), " ".join(tokens[3:])
    signed = re.match(r"^(\S.*?)\s+([+-]\d.*)$", s)  # "17h57m48.5s +04 41 36": the Dec starts at its sign
    if signed:
        return signed.group(1), signed.group(2)
    return None


@router.get("/api/resolve")
def resolve_endpoint(name: str = Query(..., description="object name or coordinates")) -> dict:
    text = name.strip()
    if not text:
        raise HTTPException(400, "Type an object name or coordinates.")
    if len(text) > _NAME_MAX:
        raise HTTPException(400, f"That is too long ({len(text)} characters); the limit is {_NAME_MAX}.")
    if re.search(r"[<>\x00-\x1f]", text):
        raise HTTPException(400, "Use letters, numbers and spaces only.")
    parts = split_coordinates(text)
    looks_numeric = (parts is not None and bool(re.match(r"^[+-]?\d", parts[0]))
                     and bool(re.match(r"^[+-]?\d", parts[1])))
    if looks_numeric:
        try:
            ra, dec = resolve.parse_coordinates(_clean_angle(parts[0]), _clean_angle(parts[1]))
        except ValueError:
            raise HTTPException(400, "Could not read those coordinates. Use decimal degrees (269.45 4.69) "
                                     "or sexagesimal (17h57m48.5s +04 41 36).") from None
        if not (0.0 <= ra <= 360.0 and -90.0 <= dec <= 90.0):
            raise HTTPException(400, "Out of range: RA must be 0 to 360 degrees and Dec -90 to +90.")
        return {"kind": "coordinates", "name": f"{ra % 360.0:.4f}, {dec:+.4f}", "ra_deg": ra % 360.0,
                "dec_deg": dec, "pmra_mas_yr": None, "pmdec_mas_yr": None, "source": "typed coordinates"}
    try:
        t = resolve.resolve_name(text)
    except LookupError as exc:
        if str(exc).startswith("could not resolve"):
            raise HTTPException(502, "The name service (CDS Sesame) did not answer. "
                                     "Try again, or type coordinates instead.") from exc
        raise HTTPException(404, f"Nothing found for '{text}'. Check the spelling or type coordinates.") from exc
    return {"kind": "name", "name": t.name, "ra_deg": t.ra_deg % 360.0, "dec_deg": t.dec_deg,
            "pmra_mas_yr": t.pmra_mas_yr, "pmdec_mas_yr": t.pmdec_mas_yr, "source": t.source}


# Hipparcos (ESA 1997, VizieR I/239) bright stars; ICRS positions at epoch J1991.25, which is
# within a few arcseconds of J2000 for these stars (invisible on a globe).
HIP_NAMES = {
    32349: "Sirius", 30438: "Canopus", 69673: "Arcturus", 91262: "Vega", 24608: "Capella",
    24436: "Rigel", 37279: "Procyon", 27989: "Betelgeuse", 7588: "Achernar", 97649: "Altair",
    21421: "Aldebaran", 80763: "Antares", 65474: "Spica", 37826: "Pollux", 113368: "Fomalhaut",
    102098: "Deneb", 49669: "Regulus", 11767: "Polaris", 71683: "Rigil Kentaurus", 68702: "Hadar",
    60718: "Acrux", 62434: "Mimosa", 36850: "Castor", 25336: "Bellatrix", 54061: "Dubhe",
}

# Built-in fallback: standard J2000 positions (rounded) of 25 well-known bright stars.
FALLBACK_STARS: list[tuple[str, float, float, float]] = [
    ("Sirius", 101.287, -16.716, -1.46), ("Canopus", 95.988, -52.696, -0.74),
    ("Rigil Kentaurus", 219.902, -60.834, -0.01), ("Arcturus", 213.915, 19.182, -0.05),
    ("Vega", 279.235, 38.784, 0.03), ("Capella", 79.172, 45.998, 0.08),
    ("Rigel", 78.634, -8.202, 0.13), ("Procyon", 114.825, 5.225, 0.34),
    ("Achernar", 24.429, -57.237, 0.46), ("Betelgeuse", 88.793, 7.407, 0.50),
    ("Hadar", 210.956, -60.373, 0.61), ("Altair", 297.696, 8.868, 0.76),
    ("Acrux", 186.650, -63.099, 0.76), ("Aldebaran", 68.980, 16.509, 0.86),
    ("Spica", 201.298, -11.161, 0.97), ("Antares", 247.352, -26.432, 1.06),
    ("Pollux", 116.329, 28.026, 1.14), ("Fomalhaut", 344.413, -29.622, 1.16),
    ("Deneb", 310.358, 45.280, 1.25), ("Mimosa", 191.930, -59.689, 1.25),
    ("Regulus", 152.093, 11.967, 1.36), ("Castor", 113.650, 31.888, 1.58),
    ("Bellatrix", 81.283, 6.350, 1.64), ("Dubhe", 165.932, 61.751, 1.79),
    ("Polaris", 37.955, 89.264, 1.98),
]

_STARS_FILE = "bright_stars.json"
_STARS_MAX_MAG = 4.5
_stars_retry_after = 0.0


def fallback_stars() -> dict:
    return {
        "source": "fallback",
        "catalogue": "Built-in list of 25 well-known bright stars (standard J2000 positions). "
                     "The full Hipparcos list could not be fetched.",
        "max_mag": 2.0,
        "n": len(FALLBACK_STARS),
        "stars": [{"name": n, "ra_deg": ra, "dec_deg": dec, "mag": m} for n, ra, dec, m in FALLBACK_STARS],
    }


def parse_vizier_stars(payload: dict) -> list[dict]:
    """Rows of a VizieR TAP JSON answer (HIP, RAICRS, DEICRS, Vmag) as star dicts."""
    cols = [str(c.get("name")) for c in payload.get("metadata", [])]
    idx = {name: cols.index(name) for name in ("HIP", "RAICRS", "DEICRS", "Vmag")}
    stars = []
    for row in payload.get("data", []):
        try:
            hip, ra, dec, mag = (row[idx["HIP"]], row[idx["RAICRS"]], row[idx["DEICRS"]], row[idx["Vmag"]])
            if ra is None or dec is None or mag is None:
                continue
            stars.append({"name": HIP_NAMES.get(int(hip), ""), "hip": int(hip),
                          "ra_deg": round(float(ra), 4), "dec_deg": round(float(dec), 4),
                          "mag": round(float(mag), 2)})
        except (TypeError, ValueError, IndexError):
            continue
    return sorted(stars, key=lambda s: s["mag"])


def _fetch_hipparcos() -> dict:
    query = ('SELECT HIP, RAICRS, DEICRS, Vmag FROM "I/239/hip_main" '
             f"WHERE Vmag < {_STARS_MAX_MAG} ORDER BY Vmag")
    with httpx.Client(timeout=httpx.Timeout(20.0, connect=6.0), follow_redirects=True,
                      headers={"User-Agent": config.USER_AGENT}) as client:
        r = client.get("https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync",
                       params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query})
    r.raise_for_status()
    stars = parse_vizier_stars(r.json())
    if len(stars) < 100:
        raise ValueError("VizieR returned too few stars")
    return {
        "source": "hipparcos",
        "catalogue": "Hipparcos (ESA 1997), VizieR I/239/hip_main, V < 4.5, ICRS positions",
        "max_mag": _STARS_MAX_MAG,
        "n": len(stars),
        "stars": stars,
    }


@router.get("/api/sky/bright_stars")
def bright_stars() -> dict:
    """A few hundred real bright stars, fetched once from VizieR and cached on disk."""
    global _stars_retry_after
    path = config.CACHE_DIR / "sky" / _STARS_FILE
    try:
        if path.is_file():
            cached = json.loads(path.read_text(encoding="utf-8"))
            if cached.get("source") == "hipparcos" and cached.get("stars"):
                return cached
    except (OSError, ValueError):
        pass
    if time.time() < _stars_retry_after:
        return fallback_stars()
    try:
        data = _fetch_hipparcos()
    except Exception:  # noqa: BLE001 - any failure means "use the built-in list"
        _stars_retry_after = time.time() + 600.0  # do not make every page load wait for a dead network
        return fallback_stars()
    try:
        cache.atomic_write_json(path, data)
    except OSError:
        pass
    return data
