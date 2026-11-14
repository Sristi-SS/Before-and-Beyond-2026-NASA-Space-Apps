"""Synthetic unit tests for the shift-and-stack core.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import numpy as np
import pytest

from backend import group, tilt


def _scene(shape=(96, 96), pixscale=6.15, amp=100.0, sigma=1.3):
    ny, nx = shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    return yy, xx, amp, sigma


def test_pixel_shift_direction():
    # Positive vx is east.  The grid's RA step is negative, so east is -x.
    dy, dx = tilt.pixel_shifts(10.0, 0.0, 1.0, 6.15)
    assert dx > 0  # correction shifts content back towards +x
    assert abs(dy) < 1e-9
    dy, dx = tilt.pixel_shifts(0.0, 10.0, 1.0, 6.15)
    assert dy < 0  # correction shifts content back towards -y (north is +y)
    assert abs(dx) < 1e-9


def test_shift_sum_recovers_known_motion():
    yy, xx, amp, sigma = _scene()
    vx, vy = 12.0, -9.0
    pixscale = 6.15
    mjds = np.array([60000.0, 60182.5, 60365.0, 60547.5])
    images = []
    for mjd in mjds:
        dt = (mjd - mjds[0]) / 365.25
        cx = 48 - vx * dt / pixscale
        cy = 48 + vy * dt / pixscale
        images.append(amp * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma ** 2)))
    stacked, _ = tilt.shift_sum(images, mjds, vx, vy, pixscale)
    peak = np.unravel_index(np.argmax(stacked), stacked.shape)
    assert abs(peak[1] - 48) <= 1
    assert abs(peak[0] - 48) <= 1
    at_zero, _ = tilt.shift_sum(images, mjds, 0.0, 0.0, pixscale)
    # Cubic interpolation also slightly broadens the stack, so the contrast gain
    # over the un-shifted sum is ~1.4x rather than the ~2x a noiseless delta would give.
    assert tilt.sharpness(stacked) > 1.3 * tilt.sharpness(at_zero)


def test_pass_clustering():
    frames = [
        group.Frame("a", "spherex", "2025-01-01", 60676.0, 0, 3, 2.0, 0.05, 0.0, "u", np.zeros((4, 4)), np.zeros((4, 4), bool)),
        group.Frame("b", "spherex", "2025-01-10", 60685.0, 0, 3, 2.0, 0.05, 0.0, "u", np.zeros((4, 4)), np.zeros((4, 4), bool)),
        group.Frame("c", "spherex", "2025-09-01", 60919.0, 0, 3, 2.0, 0.05, 0.0, "u", np.zeros((4, 4)), np.zeros((4, 4), bool)),
    ]
    group.assign_passes(frames)
    assert [f.pass_index for f in frames] == [1, 1, 2]


def test_slices_average_within_pass_and_detector():
    frames = []
    for i in range(2):
        frames.append(group.Frame(
            f"f{i}", "spherex", f"2025-01-0{i+1}", 60676.0 + i, 0, 3, 2.0, 0.05, 0.0,
            "u", np.full((4, 4), float(i + 1)), np.zeros((4, 4), bool), coverage=1.0,
        ))
    group.assign_passes(frames)
    slices = group.build_slices(frames)
    assert len(slices) == 1
    assert np.allclose(slices[0]["data"], 1.5)
    assert slices[0]["n_frames"] == 2


# ---------------------------------------------------------------- static=median (WISE/SPHEREx demo)
def _static_plus_mover(n=10, npix=64, ps=6.15, vx=8.0):
    from backend import tilt as _t
    rng = np.random.default_rng(3)
    yy, xx = np.mgrid[0:npix, 0:npix]
    mjds = [55500.0 + 365.0 * k for k in range(n)]
    imgs = []
    for k, m in enumerate(mjds):
        img = rng.normal(0, 1.0, (npix, npix)) + 3.0 * k          # frame offsets
        img += 300.0 * np.exp(-((xx - 20) ** 2 + (yy - 20) ** 2) / (2 * 1.5 ** 2))  # fixed star
        dt = (m - mjds[0]) / 365.25
        sx, sy = 40.0 - vx * dt / ps, 40.0                         # east = -x
        img += 12.0 * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * 1.5 ** 2))
        imgs.append(img)
    return imgs, mjds, ps, vx


def test_shift_sum_static_median_removes_fixed_star_and_keeps_mover():
    from backend import tilt as _t
    imgs, mjds, ps, vx = _static_plus_mover()
    plain, _ = _t.shift_sum(imgs, mjds, vx, 0.0, ps)
    clean, _ = _t.shift_sum(imgs, mjds, vx, 0.0, ps, static="median")
    # plain stack: peak is the (smeared) fixed star; static removal: peak is the mover at (40, 40)
    py, px = np.unravel_index(np.argmax(clean), clean.shape)
    assert abs(px - 40) <= 1 and abs(py - 40) <= 1
    still_plain, _ = _t.shift_sum(imgs, mjds, 0.0, 0.0, ps)
    still_clean, _ = _t.shift_sum(imgs, mjds, 0.0, 0.0, ps, static="median")
    assert still_plain[20, 20] > 100.0            # the fixed star is there ...
    assert abs(still_clean[20, 20]) < 3.0         # ... and is gone after static removal
    assert clean[py, px] > 3.0                    # while the mover is recovered


def test_shift_sum_static_none_is_unchanged_and_bad_mode_rejected():
    from backend import tilt as _t
    imgs, mjds, ps, vx = _static_plus_mover(n=4)
    a, _ = _t.shift_sum(imgs, mjds, 0.0, 0.0, ps)
    b, _ = _t.shift_sum(imgs, mjds, 0.0, 0.0, ps, static="none")
    assert np.array_equal(a, b)
    with pytest.raises(ValueError):
        _t.shift_sum(imgs, mjds, 0.0, 0.0, ps, static="mean")
    with pytest.raises(ValueError):
        _t.shift_sum(imgs[:2], mjds[:2], 0.0, 0.0, ps, static="median")
