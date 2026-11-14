"""Gaia DR3 cone search, proper-motion propagation and pixel positions.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Primary service: ESA Gaia archive TAP (verified 2026-11-13, answers in ~2 s).
Fallback: VizieR catalogue I/355/gaiadr3 through TAPVizieR (implemented, but
NOT verified: tapvizier.cds.unistra.fr timed out from the development machine
on 2026-11-13).  Positions in Gaia DR3 are at epoch 2016.0 (ICRS); they are
propagated to the requested epoch with the catalogue proper motion only
(small-angle, no parallax or radial-velocity terms, adequate for labels).
"""
from __future__ import annotations

import csv
import io
import math
import time
from pathlib import Path
from typing import Any, Optional, Sequence

import httpx
import numpy as np
from astropy.wcs import WCS

from . import cache, config

ESA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
VIZIER_TAP = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
GAIA_REF_EPOCH = 2016.0
MAS_PER_DEG = 3.6e6


def _cache_dir() -> Path:
    d = config.CACHE_DIR / "gaia"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _num(value: Any) -> Optional[float]:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _adql_esa(ra: float, dec: float, radius: float, limit: int) -> str:
    return (
        f"SELECT TOP {int(limit)} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, ref_epoch "
        "FROM gaiadr3.gaia_source "
        f"WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius:.6f})) "
        "ORDER BY phot_g_mean_mag"
    )


def _adql_vizier(ra: float, dec: float, radius: float, limit: int) -> str:
    return (
        f'SELECT TOP {int(limit)} Source AS source_id, RA_ICRS AS ra, DE_ICRS AS dec, pmRA AS pmra, '
        'pmDE AS pmdec, Plx AS parallax, Gmag AS phot_g_mean_mag '
        'FROM "I/355/gaiadr3" '
        f"WHERE 1=CONTAINS(POINT('ICRS',RA_ICRS,DE_ICRS),CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius:.6f})) "
        "ORDER BY Gmag"
    )


def _post(url: str, adql: str, timeout: float = 90.0) -> str:
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
    last: Exception | None = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout, headers={"User-Agent": config.USER_AGENT},
                              follow_redirects=True) as client:
                r = client.post(url, data=data)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r.text
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError(f"Gaia query failed: {type(last).__name__}: {last}")


def parse_csv(text: str) -> list[dict]:
    """CSV (header + rows) from either service -> list of raw dicts at epoch 2016.0."""
    rows = []
    for rec in csv.DictReader(io.StringIO(text)):
        ra, dec = _num(rec.get("ra")), _num(rec.get("dec"))
        if ra is None or dec is None:
            continue
        rows.append({
            "source_id": str(rec.get("source_id", "")).strip(),
            "ra": ra,
            "dec": dec,
            "pmra": _num(rec.get("pmra")),
            "pmdec": _num(rec.get("pmdec")),
            "parallax": _num(rec.get("parallax")),
            "phot_g_mean_mag": _num(rec.get("phot_g_mean_mag")),
            "ref_epoch": _num(rec.get("ref_epoch")) or GAIA_REF_EPOCH,
        })
    return rows


def propagate(ra: float, dec: float, pmra: Optional[float], pmdec: Optional[float],
              from_year: float, to_year: float) -> tuple[float, float]:
    """Small-angle proper-motion propagation (pmra already includes cos dec)."""
    dt = to_year - from_year
    cosd = max(1e-6, math.cos(math.radians(dec)))
    ra2 = ra + ((pmra or 0.0) * dt / MAS_PER_DEG) / cosd
    dec2 = dec + (pmdec or 0.0) * dt / MAS_PER_DEG
    return ra2 % 360.0, dec2


def raw_sources(ra: float, dec: float, radius_deg: float, limit: int = 300) -> list[dict]:
    """Cone search, cached on disk.  Positions are at Gaia's epoch (2016.0)."""
    key = cache.key_for("gaia-v1", f"{ra:.4f}", f"{dec:.4f}", f"{radius_deg:.4f}", limit)
    path = _cache_dir() / f"{key}.json"
    if path.exists():
        try:
            return cache.read_json(path)["sources"]
        except (OSError, ValueError, KeyError):
            pass
    errors = []
    rows: list[dict] | None = None
    for name, url, adql in (
        ("esa", ESA_TAP, _adql_esa(ra, dec, radius_deg, limit)),
        ("vizier", VIZIER_TAP, _adql_vizier(ra, dec, radius_deg, limit)),
    ):
        try:
            rows = parse_csv(_post(url, adql))
            service = name
            break
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}: {exc}")
    if rows is None:
        raise RuntimeError("; ".join(errors))
    cache.atomic_write_json(path, {"service": service, "ra": ra, "dec": dec,
                                   "radius_deg": radius_deg, "sources": rows})
    return rows


def gaia_sources(ra: float, dec: float, radius_deg: float, epoch_year: float,
                 limit: int = 300) -> list[dict]:
    """Gaia DR3 sources in a cone, positions propagated to ``epoch_year``."""
    out = []
    for r in raw_sources(ra, dec, radius_deg, limit):
        ra_e, dec_e = propagate(r["ra"], r["dec"], r["pmra"], r["pmdec"],
                                r.get("ref_epoch") or GAIA_REF_EPOCH, epoch_year)
        out.append({
            "source_id": r["source_id"],
            "ra": ra_e,
            "dec": dec_e,
            "pmra": r["pmra"],
            "pmdec": r["pmdec"],
            "parallax": r["parallax"],
            "phot_g_mean_mag": r["phot_g_mean_mag"],
        })
    return out


def pixel_xy(sources: Sequence[dict], wcs: WCS) -> list[tuple[float, float]]:
    """0-based pixel (x, y) of each source on ``wcs`` (same convention as the cubes)."""
    if not sources:
        return []
    ra = np.array([s["ra"] for s in sources], dtype=float)
    dec = np.array([s["dec"] for s in sources], dtype=float)
    x, y = wcs.all_world2pix(ra, dec, 0)
    return [(float(a), float(b)) for a, b in zip(x, y)]


def with_pixels(sources: Sequence[dict], wcs: WCS, npix: int, epoch_year: float,
                pixscale_arcsec: float) -> list[dict]:
    """Add ``x``, ``y`` and the predicted per-year pixel motion; drop sources off the grid.

    Motion is the pixel displacement over one year from the catalogue proper
    motion (``dx_per_yr``, ``dy_per_yr``; x grows west, y grows north).
    """
    xy = pixel_xy(sources, wcs)
    nxt = []
    for s in sources:
        ra1, dec1 = propagate(s["ra"], s["dec"], s["pmra"], s["pmdec"], epoch_year, epoch_year + 1.0)
        nxt.append({"ra": ra1, "dec": dec1})
    xy1 = pixel_xy(nxt, wcs)
    out = []
    for s, (x, y), (x1, y1) in zip(sources, xy, xy1):
        if not (-0.5 <= x <= npix - 0.5 and -0.5 <= y <= npix - 0.5):
            continue
        out.append({**s, "x": round(x, 3), "y": round(y, 3),
                    "dx_per_yr": round(x1 - x, 4), "dy_per_yr": round(y1 - y, 4),
                    "pm_total_arcsec_yr": round(math.hypot(s["pmra"] or 0.0, s["pmdec"] or 0.0) / 1000.0, 4)})
    return out
