"""Synthetic tests for the motion map (fixed-source suppression, speed).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import time

import numpy as np

from backend import tilt

PIX = 6.15


def _gauss(yy, xx, cx, cy, amp, sigma=1.3):
    return amp * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma ** 2))


def _scene(vx=10.0, vy=-8.0, nf=20, n=128, seed=3, baseline_days=4000.0, planted=40.0):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    mjds = 60000.0 + np.sort(rng.uniform(0, baseline_days, nf))
    stars = [(30, 40, 600.0), (90, 25, 900.0), (70, 100, 400.0), (50, 64, 1500.0)]
    frames = []
    for mjd in mjds:
        dt = (mjd - mjds[0]) / 365.25
        img = rng.normal(0.0, 1.0, (n, n)) + 5.0
        for sx, sy, amp in stars:                       # brighter, fixed, flux varies 8%
            img += _gauss(yy, xx, sx, sy, amp * rng.normal(1.0, 0.08))
        cx = 64 - vx * dt / PIX                          # east = -x
        cy = 64 + vy * dt / PIX                          # north = +y
        img += _gauss(yy, xx, cx, cy, planted)
        frames.append(img)
    return frames, mjds


def test_planted_mover_beats_fixed_stars():
    vx, vy = 10.0, -8.0
    frames, mjds = _scene(vx, vy)
    t = time.time()
    mm = tilt.motion_map(frames, mjds, PIX, span=12.0, step=1.0)
    assert time.time() - t < 3.0
    assert mm.score.shape == (25, 25)
    assert abs(mm.best_vx - vx) <= 1.0 + 1e-9
    assert abs(mm.best_vy - vy) <= 1.0 + 1e-9
    # Fixed stars must not hold the peak at v = 0.
    assert mm.best_score > 1.5 * mm.zero_score
    assert (mm.best_vx, mm.best_vy) != (0.0, 0.0)
    # The best stack's peak sits on the planted source at t0 (x=64, y=64).
    assert abs(mm.best_xy[0] - 64) <= 2 and abs(mm.best_xy[1] - 64) <= 2


def test_fixed_stars_only_do_not_make_a_confident_map():
    frames, mjds = _scene(planted=0.0)
    mm = tilt.motion_map(frames, mjds, PIX, span=12.0, step=2.0)
    assert mm.best_score < 8.0     # noise-level, no planted mover
    assert mm.masked_fraction > 0.0


def test_fixed_source_mask_covers_stars():
    frames, _ = _scene(planted=0.0)
    mask = tilt.fixed_source_mask(np.stack(frames))
    assert mask[64, 50] and mask[25, 90]
    assert mask.mean() < 0.1


def test_nan_pixels_are_tolerated():
    frames, mjds = _scene()
    frames[2][10:20, 10:20] = np.nan
    mm = tilt.motion_map(frames, mjds, PIX, span=6.0, step=2.0)
    assert np.isfinite(mm.score).all()
