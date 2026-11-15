"""Exact shift-and-stack ("tilt") and the motion map.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

The science result never comes from rotating a perspective camera: each frame
is shifted by an exact sub-pixel translation and summed.  The 3D view is only
an explanatory aid.
"""
from __future__ import annotations

from typing import Optional, Sequence

import numpy as np
from scipy import ndimage


def pixel_shifts(vx_arcsec_yr: float, vy_arcsec_yr: float, dt_yr: float,
                 pixscale_arcsec: float) -> tuple[float, float]:
    """Return the (dy, dx) content shift that undoes a proper motion.

    The grid is north-up with a negative RA step, so an eastward motion (positive
    ``vx``) moves a source towards smaller x.  The returned shifts are in the
    order scipy expects: (axis 0 = y, axis 1 = x).
    """
    dx = vx_arcsec_yr * dt_yr / pixscale_arcsec
    dy = -vy_arcsec_yr * dt_yr / pixscale_arcsec
    return dy, dx


def remove_static(images: Sequence[np.ndarray]) -> list[np.ndarray]:
    """Subtract the per-pixel temporal median and each frame's own offset.

    Fixed stars and the smooth background are the same in every frame, so they
    are in the median and vanish; a mover is absent from the median at any
    given pixel and survives.  The per-frame offset (median of the residual)
    removes frame-to-frame background differences.  A fixed star whose flux or
    PSF changes between frames leaves residuals of both signs at the same pixel
    that would add up at v = 0, so those pixels are zeroed too (the same mask
    the motion map uses, see :func:`fixed_source_mask`).  NaN pixels become 0.
    Needs at least 3 frames, otherwise the median is the data itself.
    """
    cube = np.stack([np.asarray(i, dtype=np.float64) for i in images])
    if cube.shape[0] < 3:
        raise ValueError("removing fixed sources needs at least 3 frames")
    resid = cube - np.nanmedian(cube, axis=0)
    resid -= np.nanmedian(resid.reshape(resid.shape[0], -1), axis=1)[:, None, None]
    resid = np.nan_to_num(resid, nan=0.0)
    mask = fixed_source_mask(cube)
    resid[:, mask] = 0.0
    return list(resid)


def shift_sum(
    images: Sequence[np.ndarray],
    mjds: Sequence[float],
    vx: float,
    vy: float,
    pixscale_arcsec: float,
    t0_mjd: float | None = None,
    order: int = 3,
    static: str = "none",
) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """Shift every frame back to ``t0`` and sum.

    Parameters are velocities in arcseconds per year (ICRS east/north).  Cubic
    interpolation is used: bilinear interpolation biases the recovered velocity
    towards integer pixel shifts (measured: 1.5 arcsec/yr on the Barnard's Star
    test cube, versus exact recovery with cubic).

    ``static="median"`` first removes the fixed sky with :func:`remove_static`
    (the stack then holds only what changes between frames); ``"none"`` stacks
    the frames as they are.
    """
    if len(images) == 0:
        raise ValueError("no images")
    if static not in ("none", "median"):
        raise ValueError("static must be 'none' or 'median'")
    if static == "median":
        images = remove_static(images)
    t0 = float(min(mjds)) if t0_mjd is None else float(t0_mjd)
    total = np.zeros_like(np.asarray(images[0], dtype=np.float64))
    shifts: list[tuple[float, float]] = []
    for image, mjd in zip(images, mjds):
        dt = (float(mjd) - t0) / 365.25
        dy, dx = pixel_shifts(vx, vy, dt, pixscale_arcsec)
        shifts.append((dx, dy))
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            shifted = np.asarray(image, dtype=np.float64)
        else:
            shifted = ndimage.shift(
                np.asarray(image, dtype=np.float64),
                shift=(dy, dx),
                order=order,
                mode="constant",
                cval=0.0,
                prefilter=order > 1,
            )
        total += shifted
    return total / len(images), shifts


def sharpness(image: np.ndarray, sigma: float = 1.0) -> float:
    """Peak of the (flux-normalised) stacked image.  Higher = sharper.

    The stack is an average, so its peak grows as a moving source is aligned and
    falls as it is smeared.  We deliberately avoid dividing by a noise estimate
    here: on very clean synthetic frames the MAD is zero and the ratio explodes.
    """
    arr = np.asarray(image, dtype=np.float64)
    smooth = ndimage.gaussian_filter(arr, sigma)
    return float(np.max(smooth))


def evaluate_grid(
    images: Sequence[np.ndarray],
    mjds: Sequence[float],
    vx_values: Sequence[float],
    vy_values: Sequence[float],
    pixscale_arcsec: float,
) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Evaluate peak sharpness over a velocity grid.  For the motion map (M6)."""
    best = (-np.inf, 0.0, 0.0)
    scores = np.zeros((len(vy_values), len(vx_values)), dtype=np.float32)
    for j, vy in enumerate(vy_values):
        for i, vx in enumerate(vx_values):
            stacked, _ = shift_sum(images, mjds, vx, vy, pixscale_arcsec)
            s = sharpness(stacked)
            scores[j, i] = s
            if s > best[0]:
                best = (s, float(vx), float(vy))
    return scores, best[0], (best[1], best[2])


# ---------------------------------------------------------------------------
# Motion map (M6)
# ---------------------------------------------------------------------------
import threading  # noqa: E402
from collections import OrderedDict  # noqa: E402
from dataclasses import dataclass  # noqa: E402

from scipy import fft as sfft  # noqa: E402

# Velocity samples per axis.  A 121 x 121 map held about 570 MB at its peak and took 15 s,
# more than a small host has; 49 x 49 stays under about 100 MB and a couple of seconds.
MAX_MAP_AXIS = 49
_EDGE_PX = 2                # ignore this many pixels at the image edge when scoring
_VX_CHUNK = 8               # vx values stacked at once (bounds the working memory)


@dataclass
class MotionMap:
    """Result of :func:`motion_map`.

    ``score[j, i]`` belongs to ``vy = vys[j]`` and ``vx = vxs[i]`` (both ascending).
    """
    score: np.ndarray
    vxs: np.ndarray
    vys: np.ndarray
    best_vx: float
    best_vy: float
    best_score: float
    zero_score: float
    best_xy: tuple[int, int]
    zero_xy: tuple[int, int]
    masked_fraction: float
    # peaks[j, i] = (x, y) pixel of the stack peak at that velocity (array column, row).
    peaks: Optional[np.ndarray] = None


def _normalised(resid: np.ndarray) -> np.ndarray:
    """Divide every frame by its robust (MAD) noise; unchanged if that is zero."""
    out = np.array(resid, dtype=np.float64)
    for f in range(out.shape[0]):
        r = out[f]
        nz = r[np.isfinite(r) & (r != 0)]
        sig = 1.4826 * float(np.median(np.abs(nz - np.median(nz)))) if nz.size else 0.0
        if sig > 0:
            out[f] = r / sig
    return out


def fixed_residuals(cube: np.ndarray) -> np.ndarray:
    """Frames minus the per-pixel temporal median (NaN pixels stay NaN)."""
    return cube - np.nanmedian(cube, axis=0)


def fixed_source_mask(images: np.ndarray, radius: int = 3) -> np.ndarray:
    """Boolean mask of pixels where something fixed varies from frame to frame.

    After the per-pixel temporal median is removed, a fixed star whose flux or
    PSF changes between frames leaves residuals of *both* signs at the same
    pixel, and they would pile up at v = 0.  A mover leaves only positive
    residuals (it is absent from the median).  Pixels with a strong residual of
    each sign are masked and grown by ``radius``; so are the brightest pixels
    of the median image itself.
    """
    cube = np.asarray(images, dtype=np.float64)
    med = cube[0]
    resid = _normalised(fixed_residuals(cube))
    rmax = np.nanmax(resid, axis=0)
    rmin = np.nanmin(resid, axis=0)
    core = np.zeros(med.shape, bool)
    for k in (5.0, 10.0, 20.0, 40.0, 80.0, 160.0):   # raise the bar in crowded fields
        core = (rmax > k) & (rmin < -k)
        if ndimage.binary_dilation(core, iterations=radius).mean() < 0.25:
            break
    if not core.any():
        return core
    return ndimage.binary_dilation(core, structure=ndimage.generate_binary_structure(2, 2),
                                   iterations=max(1, radius))


def check_grid(span: float, step: float) -> int:
    """Half-width of the velocity grid in samples; ValueError if the grid would be too large."""
    half = max(1, int(round(float(span) / float(step))))
    if 2 * half + 1 > MAX_MAP_AXIS:
        raise ValueError("velocity grid too large; increase step or reduce span")
    return half


def motion_map(
    images: Sequence[np.ndarray],
    mjds: Sequence[float],
    pixscale_arcsec: float,
    span: float = 12.0,
    step: float = 1.0,
    smooth_sigma: float = 1.0,
    mask_radius: int = 3,
    t0_mjd: float | None = None,
    clip: float = 8.0,
) -> MotionMap:
    """Fixed-source-suppressed shift-and-stack score over a velocity grid.

    1. subtract the per-pixel temporal median from every frame (fixed sky goes);
    2. zero a few pixels around the brightest fixed sources (their residual
       would otherwise add up at v = 0);
    3. divide each frame by its robust noise and clip it at +-``clip`` sigma (so a
       single-frame spike or cosmic ray cannot dominate), smooth by the PSF scale;
    4. for each velocity shift every frame back to ``t0`` and average; the
       shifts are exact (Fourier phase ramps, separable in vx and vy);
    5. score = (peak - median) / (1.4826 * MAD) of the stack.

    A score is a signal-to-noise-like ranking, not a probability; see README.
    """
    cube = np.asarray(np.stack([np.asarray(i, dtype=np.float64) for i in images]))
    nf, ny, nx = cube.shape
    if nf < 3:
        raise ValueError("need at least 3 frames")
    mj = np.asarray(mjds, dtype=np.float64)
    t0 = float(mj.min()) if t0_mjd is None else float(t0_mjd)
    dt = (mj - t0) / 365.25                                   # years, shape (nf,)

    half = check_grid(span, step)
    vals = np.arange(-half, half + 1, dtype=np.float64) * float(step)
    nv = vals.size

    mask = fixed_source_mask(cube, mask_radius)
    resid = fixed_residuals(cube)
    resid = np.where(np.isfinite(resid), resid, 0.0)
    resid[:, mask] = 0.0
    resid = np.clip(_normalised(resid), -clip, clip)             # equal-noise weighting

    # The Fourier shift wraps around, so the frames are padded with zeros.  Content that
    # leaves one side re-enters the picture only after crossing both pads, so the pads
    # together must be at least the largest shift.  (The old limit of 48 pixels let shifts
    # above 96 pixels, e.g. 45 arcsec/yr over the 14 WISE years, wrap back into the stack.)
    max_px = float(np.max(np.abs(vals)) * np.max(np.abs(dt)) / pixscale_arcsec)
    pad = int(np.ceil(max_px / 2.0) + 3)
    fy = sfft.next_fast_len(ny + 2 * pad, real=True)
    fx = sfft.next_fast_len(nx + 2 * pad, real=True)
    padded = np.zeros((nf, fy, fx))
    padded[:, pad:pad + ny, pad:pad + nx] = resid
    F = sfft.rfft2(padded, axes=(-2, -1), workers=-1)          # (nf, fy, kx)
    ky = sfft.fftfreq(fy)
    kx = sfft.rfftfreq(fx)
    if smooth_sigma > 0:
        F = F * np.exp(-2.0 * (np.pi * smooth_sigma) ** 2 * (ky[:, None] ** 2 + kx[None, :] ** 2))[None]

    a = dt / pixscale_arcsec                                   # pixels per (arcsec/yr)
    # content shift: dx = vx * a, dy = -vy * a   (as in pixel_shifts)
    ex = np.exp(-2j * np.pi * (vals[:, None, None] * a[None, :, None]) * kx[None, None, :])  # (nv, nf, kx)
    ex_k = np.ascontiguousarray(ex.transpose(2, 0, 1))         # (kx, nv, nf)

    score = np.zeros((nv, nv), dtype=np.float32)
    px = np.zeros((nv, nv, 2), dtype=np.int32)
    b = _EDGE_PX
    y0, y1, x0, x1 = pad + b, pad + ny - b, pad + b, pad + nx - b
    for j, vy in enumerate(vals):
        ey = np.exp(-2j * np.pi * ky[None, :] * (-vy * a)[:, None])      # (nf, fy)
        g = F * ey[:, :, None]                                           # (nf, fy, kx)
        g_k = np.ascontiguousarray(g.transpose(2, 0, 1))                 # (kx, nf, fy)
        w = x1 - x0
        # A few vx values at a time: the stacks of a whole row at once are what used the memory.
        for c0 in range(0, nv, _VX_CHUNK):
            sl = slice(c0, min(nv, c0 + _VX_CHUNK))
            out = np.matmul(ex_k[:, sl, :], g_k)                         # (kx, n, fy)
            stacks = sfft.irfft2(out.transpose(1, 2, 0), s=(fy, fx), axes=(-2, -1), workers=-1)
            n = stacks.shape[0]
            crop = stacks[:, y0:y1, x0:x1].reshape(n, -1)
            med = np.median(crop, axis=1)
            mad = np.median(np.abs(crop - med[:, None]), axis=1)
            noise = 1.4826 * mad
            noise = np.where(noise > 0, noise, np.maximum(crop.std(axis=1), 1e-12))
            arg = crop.argmax(axis=1)
            peak = crop[np.arange(n), arg]
            score[j, sl] = ((peak - med) / noise).astype(np.float32)
            px[j, sl, 0] = arg % w + b
            px[j, sl, 1] = arg // w + b

    jb, ib = np.unravel_index(int(np.argmax(score)), score.shape)
    jz = ib0 = half  # v = 0 sits at the centre of the grid
    return MotionMap(
        score=score, vxs=vals, vys=vals.copy(),
        best_vx=float(vals[ib]), best_vy=float(vals[jb]), best_score=float(score[jb, ib]),
        zero_score=float(score[jz, ib0]),
        best_xy=(int(px[jb, ib, 0]), int(px[jb, ib, 1])),
        zero_xy=(int(px[jz, ib0, 0]), int(px[jz, ib0, 1])),
        masked_fraction=float(mask.mean()),
        peaks=px,
    )


# The motion map and the candidate list of one band are the same computation, and every
# visitor of a saved cube asks for the same one, so the last few maps are kept.
_MAP_CACHE: "OrderedDict[tuple, MotionMap]" = OrderedDict()
_MAP_CACHE_LOCK = threading.Lock()
_MAP_CACHE_MAX = 32


def motion_map_cached(memo: tuple, images: Sequence[np.ndarray], mjds: Sequence[float],
                      pixscale_arcsec: float, span: float, step: float) -> MotionMap:
    """:func:`motion_map`, remembered under ``memo`` (job key, band, grid, frame count, build time)."""
    with _MAP_CACHE_LOCK:
        held = _MAP_CACHE.get(memo)
        if held is not None:
            _MAP_CACHE.move_to_end(memo)
            return held
    mm = motion_map(images, mjds, pixscale_arcsec, span=span, step=step)
    with _MAP_CACHE_LOCK:
        _MAP_CACHE[memo] = mm
        while len(_MAP_CACHE) > _MAP_CACHE_MAX:
            _MAP_CACHE.popitem(last=False)
    return mm
