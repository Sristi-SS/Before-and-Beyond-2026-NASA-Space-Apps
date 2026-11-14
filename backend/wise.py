"""Time-resolved WISE / NEOWISE frames (2010-2024) on the SPHEREx job grid.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Source: the unWISE *time-resolved coadds* (Meisner et al. 2018, MNRAS 477, 1;
neo7/neo11 releases, Meisner et al. 2023).  Each coadd epoch is one six-month visit of
the WISE / NEOWISE survey, 2.75 arcsec pixels, 2048x2048 pixel tiles named like
``1342m076``.  Verified on 2026-11-13 (see README "WISE baseline"):

* unwise.me/cutout_fits only serves *full-depth* coadds, no epochs.
* The epoch files are plain, uncompressed FITS on the NERSC portal under
  ``https://portal.nersc.gov/project/cosmo/temp/ameisner/neo11/eEEE/TTT/TILE/``
  (neo7 has the same layout but ends in 2020)
  (``unwise.me/tr_neo2`` redirects to the same tree).  The server honours HTTP
  Range requests, and the image rows are contiguous, so a cut-out costs a few
  megabytes instead of the 16 MB tile.
* ``time_resolved_neo11-atlas.fits`` (6 MB, same folder) lists the tiles and
  which epochs exist per band (EPOCH_BITMASK: bit 0 = W1, bit 1 = W2).

The tree lives in a *temp* folder of the unWISE author: it is a public, but not
a guaranteed-stable, service.  Every failure here is therefore reported, never
fatal (the caller records it in ``state["wise"]``).
"""
from __future__ import annotations

import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import httpx
import numpy as np
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from reproject import reproject_interp
from scipy import ndimage

from . import align, cache, config

# neo11 = every epoch through NEOWISE year 11 (Dec 2024); neo7 stops in 2020.
RELEASE = os.environ.get("SPHEREX_WISE_RELEASE", "neo11")
BASE = f"https://portal.nersc.gov/project/cosmo/temp/ameisner/{RELEASE}"
ATLAS_URL = f"{BASE}/time_resolved_{RELEASE}-atlas.fits"
NATIVE_PIXSCALE = 2.75  # arcsec, unWISE
TILE_NPIX = 2048
TILE_HALF_DEG = 0.78  # tiles are 1.56 deg wide

# Detector ids used in the job state for WISE (SPHEREx uses 1-6).
DET_W1, DET_W2 = 101, 102
# effective wavelength and FWHM of the WISE bands (Wright et al. 2010, AJ 140, 1868)
BANDS = {
    1: {"detector": DET_W1, "name": "W1", "wavelength_um": 3.4, "bandwidth_um": 0.66},
    2: {"detector": DET_W2, "name": "W2", "wavelength_um": 4.6, "bandwidth_um": 1.04},
}


def band_range_um(band: int) -> tuple[float, float]:
    b = BANDS[band]
    half = b["bandwidth_um"] / 2.0
    return (round(b["wavelength_um"] - half, 3), round(b["wavelength_um"] + half, 3))


class NotFound(Exception):
    """The server answered 404 (no such tile/epoch)."""


def _cache_dir() -> Path:
    d = config.CACHE_DIR / "wise"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
_client_lock = threading.Lock()
_client: Optional[httpx.Client] = None


def _get_client() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                timeout=min(config.HTTP_TIMEOUT, 120.0),
                headers={"User-Agent": config.USER_AGENT},
                follow_redirects=True,
                limits=httpx.Limits(max_connections=config.MAX_CONCURRENCY),
            )
        return _client


def http_bytes(url: str, start: Optional[int] = None, end: Optional[int] = None,
               retries: int = config.MAX_RETRIES, sleep: Callable[[float], None] = time.sleep) -> bytes:
    """GET (optionally a byte range) with retries and exponential backoff."""
    headers = {}
    if start is not None:
        headers["Range"] = f"bytes={start}-{'' if end is None else end}"
    last: Exception | None = None
    for attempt in range(max(1, retries)):
        try:
            r = _get_client().get(url, headers=headers)
            if r.status_code == 404:
                raise NotFound(url)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            body = r.content
            if start is not None and r.status_code == 200:
                # server ignored the Range header: cut the slice ourselves
                body = body[start:(None if end is None else end + 1)]
            return body
        except NotFound:
            raise
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            if attempt + 1 < retries:
                sleep(min(30.0, 1.5 * (2 ** attempt)))
    raise RuntimeError(f"WISE request failed after {retries} tries: {type(last).__name__}: {last}")


# ---------------------------------------------------------------------------
# Atlas (tile list, per-band epoch availability)
# ---------------------------------------------------------------------------
_atlas_lock = threading.Lock()
_atlas_mem: Optional[dict] = None


def load_atlas() -> dict:
    """Tile ids, centres and epoch bitmasks (downloaded once, then cached)."""
    global _atlas_mem
    with _atlas_lock:
        if _atlas_mem is not None:
            return _atlas_mem
        path = _cache_dir() / f"atlas_{RELEASE}.fits"
        if not path.exists():
            cache.atomic_write_bytes(path, http_bytes(ATLAS_URL))
        with fits.open(path) as hdul:
            d = hdul[1].data
            _atlas_mem = {
                "coadd_id": np.array([str(x).strip() for x in d["COADD_ID"]]),
                "ra": np.asarray(d["RA"], dtype=float),
                "dec": np.asarray(d["DEC"], dtype=float),
                "bitmask": np.asarray(d["EPOCH_BITMASK"], dtype=np.uint8),
            }
        return _atlas_mem


def tile_wcs_nominal(ra: float, dec: float) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [1024.5, 1024.5]
    s = NATIVE_PIXSCALE / 3600.0
    w.wcs.cdelt = [-s, s]
    return w


def _perimeter_pixels(npix: int, n: int = 9) -> tuple[np.ndarray, np.ndarray]:
    t = np.linspace(0, npix - 1, n)
    xs = np.concatenate([t, t, np.zeros(n), np.full(n, npix - 1.0)])
    ys = np.concatenate([np.zeros(n), np.full(n, npix - 1.0), t, t])
    return xs, ys


def _pixel_box(grid: WCS, npix: int, tile: WCS, pad: int = 6) -> Optional[tuple[int, int, int, int]]:
    """Inclusive pixel box (x0, x1, y0, y1) of the tile that covers the grid, or None."""
    xs, ys = _perimeter_pixels(npix)
    ra, dec = grid.all_pix2world(xs, ys, 0)
    tx, ty = tile.all_world2pix(ra, dec, 0)
    if not (np.all(np.isfinite(tx)) and np.all(np.isfinite(ty))):
        return None
    x0, x1 = int(math.floor(tx.min())) - pad, int(math.ceil(tx.max())) + pad
    y0, y1 = int(math.floor(ty.min())) - pad, int(math.ceil(ty.max())) + pad
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, TILE_NPIX - 1), min(y1, TILE_NPIX - 1)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return x0, x1, y0, y1


def find_tiles(grid: WCS, npix: int, ra: float, dec: float, fov_deg: float) -> list[dict]:
    """Tiles that overlap the grid, with the epochs available per band."""
    atlas = load_atlas()
    cosd = max(0.05, math.cos(math.radians(dec)))
    reach = TILE_HALF_DEG * math.sqrt(2.0) + fov_deg * 0.75 + 0.05
    dra = (atlas["ra"] - ra + 180.0) % 360.0 - 180.0
    near = np.where((np.abs(atlas["dec"] - dec) < reach) &
                    (np.abs(dra) * cosd < reach + 0.5))[0]
    out = []
    for i in near:
        nominal = tile_wcs_nominal(float(atlas["ra"][i]), float(atlas["dec"][i]))
        if _pixel_box(grid, npix, nominal, pad=0) is None:
            continue
        mask = atlas["bitmask"][i]
        out.append({
            "coadd_id": str(atlas["coadd_id"][i]),
            "epochs": {1: [int(e) for e in np.where(mask & 1)[0]],
                       2: [int(e) for e in np.where(mask & 2)[0]]},
        })
    return out


# ---------------------------------------------------------------------------
# One tile/epoch/band cut-out
# ---------------------------------------------------------------------------
def image_url(coadd_id: str, band: int, epoch: int) -> str:
    return (f"{BASE}/e{epoch:03d}/{coadd_id[:3]}/{coadd_id}/"
            f"unwise-{coadd_id}-w{band}-img-m.fits")


def _header_info(url: str, key: str) -> dict:
    """Minimal header (WCS, MJD range, data offset), cached as JSON."""
    path = _cache_dir() / f"hdr_{RELEASE}_{key}.json"
    if path.exists():
        try:
            return cache.read_json(path)
        except (OSError, ValueError):
            pass
    raw = http_bytes(url, 0, 2880 * 4 - 1)
    cards = []
    hlen = None
    for i in range(0, len(raw), 80):
        card = raw[i:i + 80].decode("latin1")
        cards.append(card)
        if card.startswith("END     "):
            hlen = ((i + 80 + 2879) // 2880) * 2880
            break
    if hlen is None:
        raise RuntimeError("FITS header longer than expected")
    hdr = fits.Header.fromstring("".join(c.ljust(80) for c in cards), sep="")
    if int(hdr.get("BITPIX", 0)) != -32 or int(hdr["NAXIS1"]) != TILE_NPIX:
        raise RuntimeError("unexpected unWISE FITS layout")
    info = {
        "hlen": hlen,
        "naxis1": int(hdr["NAXIS1"]), "naxis2": int(hdr["NAXIS2"]),
        "crval": [float(hdr["CRVAL1"]), float(hdr["CRVAL2"])],
        "crpix": [float(hdr["CRPIX1"]), float(hdr["CRPIX2"])],
        "cd": [float(hdr["CD1_1"]), float(hdr.get("CD1_2", 0.0)),
               float(hdr.get("CD2_1", 0.0)), float(hdr["CD2_2"])],
        "mjdmin": float(hdr["MJDMIN"]), "mjdmax": float(hdr["MJDMAX"]),
        "epoch": int(hdr.get("EPOCH", -1)),
    }
    cache.atomic_write_json(path, info)
    return info


def _wcs_from_info(info: dict) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = info["crval"]
    w.wcs.crpix = info["crpix"]
    w.wcs.cd = [[info["cd"][0], info["cd"][1]], [info["cd"][2], info["cd"][3]]]
    return w


@dataclass
class Part:
    data: np.ndarray            # float32, NaN where there is no coverage
    wcs: WCS
    mjdmin: float
    mjdmax: float
    url: str


def fetch_part(coadd_id: str, band: int, epoch: int, grid: WCS, npix: int) -> Optional[Part]:
    """Download the rows of one tile/epoch/band that the grid needs (cached)."""
    url = image_url(coadd_id, band, epoch)
    key = f"{coadd_id}_w{band}_e{epoch:03d}"
    try:
        info = _header_info(url, key)
    except NotFound:
        return None
    tile = _wcs_from_info(info)
    box = _pixel_box(grid, npix, tile)
    if box is None:
        return None
    x0, x1, y0, y1 = box
    npy = _cache_dir() / f"cut_{RELEASE}_{key}_{x0}_{x1}_{y0}_{y1}.npy"
    arr = None
    if npy.exists():
        try:
            arr = np.load(npy)
        except (OSError, ValueError):
            arr = None
    if arr is None:
        row_bytes = info["naxis1"] * 4
        start = info["hlen"] + y0 * row_bytes
        end = info["hlen"] + (y1 + 1) * row_bytes - 1
        raw = http_bytes(url, start, end)
        nrows = y1 - y0 + 1
        if len(raw) != nrows * row_bytes:
            raise RuntimeError(f"short read for {key}: {len(raw)} bytes, expected {nrows * row_bytes}")
        full = np.frombuffer(raw, dtype=">f4").reshape(nrows, info["naxis1"])
        arr = np.array(full[:, x0:x1 + 1], dtype=np.float32)
        cache.atomic_write_npy(npy, arr)
    arr = np.where((arr == 0.0) | ~np.isfinite(arr), np.nan, arr).astype(np.float32)
    sub = tile.slice((slice(y0, y1 + 1), slice(x0, x1 + 1)))
    return Part(arr, sub, info["mjdmin"], info["mjdmax"], url)


# ---------------------------------------------------------------------------
# Epoch frames on the job grid
# ---------------------------------------------------------------------------
def _smooth_nan(image: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing that ignores NaNs (normalised convolution)."""
    good = np.isfinite(image)
    num = ndimage.gaussian_filter(np.where(good, image, 0.0).astype(np.float64), sigma)
    den = ndimage.gaussian_filter(good.astype(np.float64), sigma)
    out = np.full(image.shape, np.nan)
    ok = (den > 0.3) & good
    out[ok] = num[ok] / den[ok]
    return out


@dataclass
class WiseFrame:
    id: str
    band: int
    epoch: int
    mjd: float
    obs_time: str
    data: np.ndarray = field(repr=False)
    masked_fraction: float
    coverage: float
    background: float
    noise: float
    provenance_url: str

    def meta(self, index: int) -> dict:
        b = BANDS[self.band]
        return {
            "id": self.id,
            "index": index,
            "source": "wise",
            "obs_time": self.obs_time,
            "mjd": round(self.mjd, 5),
            "detector": b["detector"],
            "wavelength_um": b["wavelength_um"],
            "bandwidth_um": b["bandwidth_um"],
            "masked_fraction": round(self.masked_fraction, 4),
            "coverage": round(self.coverage, 3),
            "background": round(self.background, 4),
            "noise": round(self.noise, 4),
            "collection": f"unwise_tr_{RELEASE}",
            "band": b["name"],
            "epoch": self.epoch,
            "unit": "unWISE nanomaggies (Vega zero point 22.5)",
            "provenance_url": self.provenance_url,
            "status": "ok",
        }


def build_frame(parts: list[Part], band: int, epoch: int, grid: WCS, npix: int,
                pixscale_arcsec: float, min_coverage: float = 0.55) -> Optional[WiseFrame]:
    """Smooth to the grid resolution, reproject, mosaic tiles, background-subtract."""
    if not parts:
        return None
    # Area-average approximation: a box of width ratio pixels has sigma ratio/sqrt(12).
    ratio = max(1.0, pixscale_arcsec / NATIVE_PIXSCALE)
    sigma = ratio / math.sqrt(12.0)
    layers = []
    for p in parts:
        sm = _smooth_nan(p.data.astype(np.float64), sigma)
        proj, foot = reproject_interp((sm, p.wcs), grid, shape_out=(npix, npix),
                                      order="bilinear", return_footprint=True)
        proj = np.where(foot > 0.5, proj, np.nan)
        layers.append(proj)
    with np.errstate(all="ignore"):
        stack = np.nanmean(np.stack(layers), axis=0) if len(layers) > 1 else layers[0]
    finite = np.isfinite(stack)
    coverage = float(finite.mean())
    if coverage < min_coverage:
        return None
    aligned = align.align_frame(stack, np.zeros(stack.shape, dtype=np.int64), None, grid, grid, npix)
    if aligned is None:
        return None
    mjd = 0.5 * (min(p.mjdmin for p in parts) + max(p.mjdmax for p in parts))
    return WiseFrame(
        id=f"WISE_W{band}_E{epoch:03d}",
        band=band, epoch=epoch, mjd=mjd,
        obs_time=Time(mjd, format="mjd", scale="utc").isot,
        data=aligned.data,
        masked_fraction=max(aligned.masked_fraction, 1.0 - coverage),
        coverage=coverage,
        background=aligned.background,
        noise=aligned.noise,
        provenance_url=parts[0].url,
    )


def fetch_frames(
    grid: WCS, npix: int, ra: float, dec: float, fov_deg: float, pixscale_arcsec: float,
    bands: tuple[int, ...] = (1, 2),
    progress: Optional[Callable[[int, int], None]] = None,
    max_workers: int = 4,
) -> list[WiseFrame]:
    """All W1/W2 epochs covering the grid, sorted by time.  Raises on hard failure.

    An individual epoch that is missing or fails is skipped; if *every* request
    fails the last error is raised so the caller can record it.
    """
    tiles = find_tiles(grid, npix, ra, dec, fov_deg)
    if not tiles:
        return []
    jobs: list[tuple[int, int]] = sorted({(b, e) for t in tiles for b in bands for e in t["epochs"][b]})
    total, done = len(jobs), 0
    errors: list[Exception] = []
    lock = threading.Lock()

    def one(item: tuple[int, int]) -> Optional[WiseFrame]:
        nonlocal done
        band, epoch = item
        try:
            parts = []
            for t in tiles:
                if epoch in t["epochs"][band]:
                    p = fetch_part(t["coadd_id"], band, epoch, grid, npix)
                    if p is not None:
                        parts.append(p)
            return build_frame(parts, band, epoch, grid, npix, pixscale_arcsec)
        except Exception as exc:  # noqa: BLE001 - one bad epoch must not lose the rest
            with lock:
                errors.append(exc)
            return None
        finally:
            with lock:
                done += 1
                d = done
            if progress:
                progress(d, total)

    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, config.MAX_CONCURRENCY, 4))) as pool:
        results = list(pool.map(one, jobs))
    frames = sorted((f for f in results if f is not None), key=lambda f: (f.mjd, f.band))
    if not frames and errors:
        raise errors[-1]
    return frames
