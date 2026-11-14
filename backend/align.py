"""Reprojection, masking and background subtraction.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Every frame is resampled onto one north-up tangent-plane grid centred on the
requested position.  We never upsample by more than a factor of two relative to
the native SPHEREx pixel scale (6.15 arcsec).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp
from scipy import ndimage

from . import config


def make_grid(ra: float, dec: float, npix: int, pixscale_arcsec: float) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(npix + 1) / 2.0, (npix + 1) / 2.0]
    w.wcs.cdelt = [-pixscale_arcsec / 3600.0, pixscale_arcsec / 3600.0]
    w.wcs.radesys = "ICRS"
    return w


def clamp_pixscale(requested_arcsec: float, native_arcsec: float = config.DEFAULT_PIXSCALE) -> float:
    return float(max(requested_arcsec, native_arcsec / config.MAX_UPSAMPLE))


@dataclass
class AlignedFrame:
    data: np.ndarray          # float32, background-subtracted, MJy/sr
    mask: np.ndarray          # bool, True = do not use
    coverage: float
    masked_fraction: float
    background: float
    noise: float


def _robust_background(values: np.ndarray) -> tuple[float, float]:
    good = values[np.isfinite(values)]
    if good.size == 0:
        return 0.0, 0.0
    med = float(np.median(good))
    mad = float(np.median(np.abs(good - med)))
    sigma = 1.4826 * mad
    if sigma <= 0:
        sigma = float(np.std(good)) or 1.0
    for _ in range(3):
        keep = np.abs(good - med) < 4.0 * sigma
        if keep.sum() < 16:
            break
        new_med = float(np.median(good[keep]))
        new_sigma = 1.4826 * float(np.median(np.abs(good[keep] - new_med)))
        if new_sigma <= 0:
            break
        med, sigma = new_med, new_sigma
    return med, max(sigma, 1e-9)


def align_frame(
    image: np.ndarray,
    flags: np.ndarray,
    zodi: Optional[np.ndarray],
    in_wcs: WCS,
    grid: WCS,
    npix: int,
) -> Optional[AlignedFrame]:
    """Background-subtract, mask and reproject one cut-out onto ``grid``."""
    img = np.asarray(image, dtype=np.float64).copy()
    bad = ~np.isfinite(img)
    bad |= (np.asarray(flags, dtype=np.int64) & config.MASK_BITS) != 0
    if zodi is not None and np.isfinite(zodi).any():
        img = img - np.asarray(zodi, dtype=np.float64)
        bad |= ~np.isfinite(img)

    # Reproject the science image.  NaNs propagate into the footprint.
    try:
        projected, footprint = reproject_interp(
            (img, in_wcs), grid, shape_out=(npix, npix), order="bilinear",
            return_footprint=True,
        )
        # ``footprint`` above is zero where the input is NaN (a saturated
        # core).  The flag image has no NaN, so its footprint is the true
        # outline of the detector on the grid.
        bad_u8, outline = reproject_interp(
            (bad.astype(np.uint8), in_wcs), grid, shape_out=(npix, npix),
            order="nearest-neighbor", return_footprint=True,
        )
    except Exception:
        return None

    inside = np.asarray(outline) > 0.5
    coverage = float(np.mean(inside))
    if coverage < 0.55:
        return None

    data = np.asarray(projected, dtype=np.float64)
    mask = (bad_u8 > 0.5) | ~np.isfinite(data) | (footprint <= 0.5) | ~inside

    bg, noise = _robust_background(data[~mask])
    data = data - bg

    masked_fraction = float(np.mean(mask))
    if masked_fraction > 0.95:
        return None

    # Fill masked pixels that are inside the image footprint (saturated star
    # cores, bad pixels) from their neighbours, so a bright star is not a black
    # hole in the cube and the tilt sum has a peak to lock on to.  The scale
    # grows until the hole closes.  Filled pixels are interpolated values: do
    # not measure fluxes there (``masked_fraction`` counts them).  Pixels
    # outside the footprint are never invented; they stay zero.
    todo = mask & inside
    if todo.any() and (~mask).any():
        source = np.where(mask, 0.0, data)
        valid = (~mask).astype(np.float64)
        filled = source.copy()
        for sigma in (1.0, 2.0, 4.0):
            if not todo.any():
                break
            smooth = ndimage.gaussian_filter(source, sigma)
            weight = ndimage.gaussian_filter(valid, sigma)
            reach = todo & (weight > 0.05)
            filled[reach] = smooth[reach] / weight[reach]
            todo &= ~reach
        data = filled
    else:
        data = np.where(mask, 0.0, data)

    return AlignedFrame(
        data=data.astype(np.float32),
        mask=mask,
        coverage=coverage,
        masked_fraction=masked_fraction,
        background=bg,
        noise=noise,
    )
