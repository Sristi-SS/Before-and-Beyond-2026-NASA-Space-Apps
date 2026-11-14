"""SPHEREx archive access: cone search, cut-outs, wavelength and flags.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Verified against IRSA on 2026-11-13:

* TAP sync endpoint ``https://irsa.ipac.caltech.edu/TAP/sync``.
* obsCore table ``spherex.obscore`` holds one row per detector plane.
  ``obs_id`` looks like ``2025W34_2B_0030_4``; the trailing ``_4`` is the
  detector, and the same information is in the datalink suffix ``/D4``.
* ``t_min``/``t_max`` are MJD, ``s_ra``/``s_dec`` the plane centre.
* The IBE file path comes from ``spherex.artifact.uri`` (DR1) or from the
  DataLink response (fallback; QR3 rows are served this way).
* Appending ``?center=RA,DEC&size=DEG`` to the IBE URL returns a FITS cut-out
  with extensions IMAGE, FLAGS, VARIANCE, ZODI, EPSF and WCS-WAVE.
* The IMAGE header carries an alternate WCS with key ``W`` (CTYPE ``WAVE-TAB``)
  that points at the WCS-WAVE lookup table.  ``WCS(header, fobj=hdul, key='W')``
  then ``.pixel_to_world(x, y)`` returns wavelength and bandwidth in microns.
"""
from __future__ import annotations

import csv
import io
import math
import re
import threading
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional

import httpx
import numpy as np
from astropy import log as astropy_log
from astropy.io import fits
from astropy.wcs import WCS

from . import cache, config

astropy_log.setLevel("ERROR")  # the WAVE-TAB WCS emits a benign SIP warning

TAP_LOCK = threading.Semaphore(2)  # be gentle with the shared TAP service


@dataclass
class Plane:
    obs_id: str
    detector: int
    collection: str
    ra: float
    dec: float
    fov: float
    em_min: float
    em_max: float
    t_min: float
    t_max: float
    access_url: str
    uri: Optional[str] = None

    @property
    def key(self) -> str:
        return f"{self.collection}:{self.obs_id}:D{self.detector}"


def _http_client() -> httpx.Client:
    return httpx.Client(
        timeout=config.HTTP_TIMEOUT,
        headers={"User-Agent": config.USER_AGENT},
        follow_redirects=True,
    )


def tap_query(adql: str, maxrec: int = 5000) -> list[dict]:
    """Run a synchronous ADQL query and return rows as dictionaries."""
    last: Exception | None = None
    for attempt in range(config.MAX_RETRIES):
        try:
            with TAP_LOCK:
                with _http_client() as client:
                    r = client.post(
                        config.TAP_SYNC,
                        data={"QUERY": adql, "FORMAT": "csv", "MAXREC": str(maxrec)},
                    )
            if r.status_code == 200 and "<VOTABLE" not in r.text[:200]:
                return list(csv.DictReader(io.StringIO(r.text)))
            if r.status_code == 200:
                # A VOTable here is an error report, not a result.
                m = re.search(r'value="ERROR">([^<]*)', r.text)
                raise RuntimeError(m.group(1) if m else r.text[:200])
            if r.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"TAP busy ({r.status_code})")
            raise RuntimeError(f"TAP error {r.status_code}: {r.text[:200]}")
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            last = exc
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"TAP query failed: {last}")


def cone_search(ra: float, dec: float, radius_deg: float, maxrec: int = 5000) -> list[Plane]:
    radius = max(0.01, min(5.0, radius_deg))
    adql = (
        "SELECT obs_id,s_ra,s_dec,s_fov,em_min,em_max,t_min,t_max,access_url "
        "FROM spherex.obscore WHERE "
        f"CONTAINS(POINT('ICRS',s_ra,s_dec),CIRCLE('ICRS',{ra:.7f},{dec:.7f},{radius:.4f}))=1"
    )
    rows = tap_query(adql, maxrec=maxrec)
    planes: dict[tuple[str, int], Plane] = {}
    for row in rows:
        try:
            url = row.get("access_url", "")
            m = re.search(r"/D(\d)$", url)
            coll = re.search(r"ivo://irsa\.ipac/([^?]+)\?", url)
            if not m:
                continue
            obs_id = row["obs_id"].strip()
            p = Plane(
                obs_id=obs_id,
                detector=int(m.group(1)),
                collection=(coll.group(1) if coll else config.RELEASE),
                ra=float(row["s_ra"]),
                dec=float(row["s_dec"]),
                fov=float(row["s_fov"] or 0.0),
                em_min=float(row["em_min"] or 0.0),
                em_max=float(row["em_max"] or 0.0),
                t_min=float(row["t_min"]),
                t_max=float(row["t_max"]),
                access_url=url,
            )
        except (KeyError, ValueError):
            continue
        # The same exposure can be served by two collections.  Keep one copy,
        # the configured release first, so a frame is never stacked twice.
        exposure = (p.obs_id, p.detector)
        held = planes.get(exposure)
        if held is None or (p.collection == config.RELEASE and held.collection != config.RELEASE):
            planes[exposure] = p
    return sorted(planes.values(), key=lambda p: (p.t_min, p.detector))


def _artifact_from_tap(obs_id: str) -> dict[int, str]:
    adql = (
        "SELECT p.productid,a.uri FROM spherex.artifact a "
        "JOIN spherex.plane p ON a.planeid=p.planeid "
        "JOIN spherex.observation o ON p.obsid=o.obsid "
        f"WHERE o.observationid='{obs_id}'"
    )
    out: dict[int, str] = {}
    try:
        for row in tap_query(adql, maxrec=20):
            m = re.search(r"D(\d)$", row.get("productid", ""))
            if m and row.get("uri"):
                out[int(m.group(1))] = row["uri"].strip()
    except Exception:
        pass
    return out


def _artifact_from_datalink(collection: str, obs_id: str, detector: int) -> Optional[str]:
    url = f"{config.DATALINK_BASE}?ID=ivo://irsa.ipac/{collection}?{obs_id}/D{detector}"
    for attempt in range(config.MAX_RETRIES):
        try:
            with _http_client() as client:
                r = client.get(url)
            if r.status_code != 200:
                raise RuntimeError(f"datalink {r.status_code}")
            for m in re.finditer(r"<TD>([^<]*ibe/data/spherex[^<]*)</TD>", r.text):
                return m.group(1).strip()
            for m in re.finditer(r"ibe/data/spherex/[^\s<\"']+\.fits", r.text):
                return m.group(0)
            return None
        except Exception:
            time.sleep(min(20, 2 ** attempt))
    return None


_ARTIFACT_LOCK = threading.Lock()
_ARTIFACT_MEMO: dict[tuple[str, str, int], str] = {}


def resolve_artifact(plane: Plane) -> str:
    memo_key = (plane.collection, plane.obs_id, plane.detector)
    with _ARTIFACT_LOCK:
        if memo_key in _ARTIFACT_MEMO:
            return _ARTIFACT_MEMO[memo_key]
    if plane.uri is None:
        paths = _artifact_from_tap(plane.obs_id)
        plane.uri = paths.get(plane.detector)
    if plane.uri is None:
        plane.uri = _artifact_from_datalink(plane.collection, plane.obs_id, plane.detector)
    if plane.uri is None:
        raise RuntimeError(f"no artifact path for {plane.key}")
    with _ARTIFACT_LOCK:
        _ARTIFACT_MEMO[memo_key] = plane.uri
    return plane.uri


def cutout_url(uri: str, ra: float, dec: float, size_deg: float) -> str:
    return (
        f"{config.IBE_BASE}{uri}"
        f"?center={ra:.7f},{dec:.7f}&size={size_deg:.5f}"
    )


def fetch_cutout(plane: Plane, ra: float, dec: float, size_deg: float) -> Optional[Path]:
    """Download (or reuse) a FITS cut-out.  Returns None when there is no overlap."""
    uri = resolve_artifact(plane)
    key = cache.key_for("cutout", plane.collection, plane.obs_id, plane.detector,
                        f"{ra:.5f}", f"{dec:.5f}", f"{size_deg:.4f}")
    path = cache.raw_dir() / f"{key}.fits"
    if path.exists() and path.stat().st_size > 10_000:
        return path
    url = cutout_url(uri, ra, dec, size_deg)
    for attempt in range(config.MAX_RETRIES):
        try:
            with _http_client() as client:
                with client.stream("GET", url) as r:
                    if r.status_code == 422:
                        return None  # cut-out does not overlap this detector
                    if r.status_code == 404:
                        return None
                    if r.status_code != 200:
                        raise RuntimeError(f"cutout {r.status_code}")
                    buf = io.BytesIO()
                    for chunk in r.iter_bytes():
                        buf.write(chunk)
            data = buf.getvalue()
            if len(data) < 10_000 or data[:6] != b"SIMPLE":
                raise RuntimeError(f"not FITS ({len(data)} bytes)")
            cache.atomic_write_bytes(path, data)
            return path
        except Exception:
            time.sleep(min(30, 3 * (attempt + 1)))
    return None


@dataclass
class Cutout:
    image: np.ndarray
    flags: np.ndarray
    variance: np.ndarray
    zodi: Optional[np.ndarray]
    wcs: WCS
    header: fits.Header
    wave_wcs: WCS
    detector: int
    obs_id: str
    mjd: float
    date_obs: str


def read_cutout(path: Path) -> Cutout:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with fits.open(path) as hdul:
            img_hdu = hdul["IMAGE"]
            header = img_hdu.header.copy()
            image = np.asarray(img_hdu.data, dtype=np.float64)
            flags = np.asarray(hdul["FLAGS"].data, dtype=np.int64) if "FLAGS" in hdul else np.zeros_like(image, dtype=np.int64)
            variance = np.asarray(hdul["VARIANCE"].data, dtype=np.float64) if "VARIANCE" in hdul else np.full_like(image, np.nan)
            zodi = np.asarray(hdul["ZODI"].data, dtype=np.float64) if "ZODI" in hdul else None
            wcs = WCS(header)
            try:
                wave_wcs = WCS(header, fobj=hdul, key="W")
                wave_wcs.sip = None
            except Exception:
                wave_wcs = None
    mjd = float(header.get("MJD-AVG", header.get("MJD-OBS", 0.0)))
    return Cutout(
        image=image,
        flags=flags,
        variance=variance,
        zodi=zodi,
        wcs=wcs,
        header=header,
        wave_wcs=wave_wcs,
        detector=int(header.get("DETECTOR", 0)),
        obs_id=str(header.get("OBSID", "")),
        mjd=mjd,
        date_obs=str(header.get("DATE-OBS", "")),
    )


def wavelength_at(cut: Cutout, ra: float, dec: float) -> tuple[float, float]:
    """Wavelength and bandwidth (microns) at the target position in this frame."""
    if cut.wave_wcs is None:
        return float("nan"), float("nan")
    x, y = cut.wcs.all_world2pix(ra, dec, 0)
    if not (np.isfinite(x) and np.isfinite(y)):
        return float("nan"), float("nan")
    if x < -1 or y < -1 or x > cut.image.shape[1] or y > cut.image.shape[0]:
        return float("nan"), float("nan")
    try:
        world = cut.wave_wcs.pixel_to_world(float(np.clip(x, 0, cut.image.shape[1] - 1)),
                                           float(np.clip(y, 0, cut.image.shape[0] - 1)))
        wave, band = world
        return float(wave.to_value("um")), float(band.to_value("um"))
    except Exception:
        return float("nan"), float("nan")


def masked_fraction(flags: np.ndarray, image: np.ndarray) -> float:
    bad = ((flags & config.MASK_BITS) != 0) | ~np.isfinite(image)
    return float(np.mean(bad))


def search_and_fetch(
    ra: float,
    dec: float,
    fov_deg: float,
    max_frames: int,
    progress: Optional[Callable[[int, int, dict], None]] = None,
    on_frame: Optional[Callable[[Plane, "Cutout", float, float], object]] = None,
) -> list[tuple[Plane, Cutout, float, float]]:
    """Search, download and characterise frames.

    With ``on_frame`` each cut-out is handed over and then dropped, so memory
    stays flat (this matters on the Jetson).  ``on_frame`` returns a false value
    when it rejects the frame.  Without ``on_frame`` the cut-outs are returned.

    The cone radius is the request half-diagonal plus the detector half-diagonal
    (SPHEREx planes are 3.485 deg across, so 1.75 deg is the maximum centre
    offset for a target to still fall on the detector).
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    radius = min(5.0, fov_deg / 2.0 + 1.85)
    planes = cone_search(ra, dec, radius)
    if not planes:
        return []
    # Keep the search honest: drop planes whose centre is farther than the
    # detector half-diagonal plus the field radius.  (The TAP cone already does
    # this; this guard catches planes returned for other reasons.)
    limit = 1.78 + fov_deg / 2.0
    planes = [p for p in planes
              if math.hypot((p.ra - ra) * math.cos(math.radians(dec)), p.dec - dec) <= limit]
    # Prefer a spread over passes rather than 60 frames from one night.
    planes = _thin_by_time(planes, max_frames)
    total = len(planes)
    results: list[tuple[Plane, Cutout, float, float]] = []
    size = max(fov_deg * 1.25, fov_deg + 0.05)
    with ThreadPoolExecutor(max_workers=config.MAX_CONCURRENCY) as pool:
        future_map = {
            pool.submit(fetch_cutout, p, ra, dec, size): p for p in planes
        }
        done = 0
        for fut in as_completed(future_map):
            plane = future_map[fut]
            done += 1
            try:
                path = fut.result()
            except Exception:
                path = None
            meta = {"id": plane.key, "detector": plane.detector, "status": "skipped"}
            if path is not None:
                try:
                    cut = read_cutout(path)
                    wave, band = wavelength_at(cut, ra, dec)
                    if not (np.isfinite(wave) and wave > 0):
                        meta["status"] = "no-wavelength"
                    elif cut.image.size == 0:
                        meta["status"] = "empty"
                    else:
                        meta.update(
                            status="ok",
                            obs_time=cut.date_obs,
                            wavelength_um=round(wave, 4),
                            bandwidth_um=round(band, 4),
                            masked_fraction=round(masked_fraction(cut.flags, cut.image), 4),
                        )
                        if on_frame is None:
                            results.append((plane, cut, wave, band))
                        else:
                            try:
                                if not on_frame(plane, cut, wave, band):
                                    meta["status"] = "rejected: low coverage or fully masked"
                            except Exception as exc:  # noqa: BLE001
                                meta["status"] = f"align-error: {type(exc).__name__}"
                except Exception as exc:  # noqa: BLE001
                    meta["status"] = f"error: {type(exc).__name__}"
            if progress is not None:
                progress(done, total, meta)
    return results


def _thin_by_time(planes: list[Plane], max_frames: int) -> list[Plane]:
    """Deterministically keep at most ``max_frames`` planes, spread over time."""
    if len(planes) <= max_frames:
        return planes
    # Group per pass-like 30-day bucket, then round-robin through buckets.
    buckets: dict[int, list[Plane]] = {}
    for p in planes:
        buckets.setdefault(int(p.t_min // 30), []).append(p)
    ordered = [buckets[k] for k in sorted(buckets)]
    out: list[Plane] = []
    i = 0
    while len(out) < max_frames and any(ordered):
        for bucket in ordered:
            if bucket and len(out) < max_frames:
                out.append(bucket.pop(0))
        i += 1
        if i > 10_000:
            break
    return sorted(out, key=lambda p: (p.t_min, p.detector))
