"""Compact patch model: is the stack peak shaped like a point source?

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

A very small neural network (81 inputs, 12 hidden units, 1 output; 997 numbers)
looks at the 9 x 9 pixel patch around a candidate in the shifted stack.  It
gives a number from 0 to 1: high when the patch looks like a point source (the
shape a real, aligned mover must have), low when it looks like noise, one hot
pixel, a streak, a positive/negative pair or a wide blob.

IMPORTANT: the model is trained on SIMULATED patches only (made in
``_training_set``; no archive data, no real object).  Its output is a ranking
hint.  It is not evidence, and it never turns a candidate into a detection.
The training is deterministic (fixed seed) and takes about a second; the
weights are cached under ``data/cache/models``.
"""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np

from . import config

SIZE = 9
HIDDEN = 12
VERSION = "patch-ranker-v1"
_lock = threading.Lock()
_model: Optional[dict] = None


def normalise(patch: np.ndarray) -> np.ndarray:
    """Background-subtract, scale by the robust noise, then by the peak (shape only)."""
    p = np.asarray(patch, dtype=np.float64)
    p = np.where(np.isfinite(p), p, 0.0)
    med = float(np.median(p))
    sig = 1.4826 * float(np.median(np.abs(p - med)))
    if sig <= 0:
        sig = float(p.std()) or 1.0
    z = np.clip((p - med) / sig, -6.0, 60.0)
    peak = float(z.max())
    return (z / peak if peak > 0 else z).ravel()


def _gauss(yy, xx, cy, cx, sigma):
    return np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * sigma ** 2))


def _training_set(rng: np.random.Generator, n: int) -> tuple[np.ndarray, np.ndarray]:
    """SIMULATED patches: point sources (label 1) and five kinds of impostor (label 0)."""
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    c = SIZE // 2
    xs, ys = [], []
    for i in range(n):
        noise = rng.normal(0.0, 1.0, (SIZE, SIZE))
        kind = i % 10
        if kind < 5:                                    # point source
            amp = rng.uniform(5, 40)
            img = noise + amp * _gauss(yy, xx, c + rng.uniform(-0.6, 0.6), c + rng.uniform(-0.6, 0.6),
                                       rng.uniform(0.7, 1.6))
            label = 1.0
        elif kind == 5:                                 # noise maximum
            j, k = np.unravel_index(int(np.argmax(noise)), noise.shape)
            img = np.roll(noise, (c - j, c - k), axis=(0, 1))
            label = 0.0
        elif kind == 6:                                 # one hot pixel (cosmic ray)
            img = noise.copy()
            img[c, c] += rng.uniform(6, 40)
            label = 0.0
        elif kind == 7:                                 # streak (smeared fixed star)
            ang = rng.uniform(0, np.pi)
            d = (xx - c) * np.sin(ang) - (yy - c) * np.cos(ang)
            img = noise + rng.uniform(5, 25) * np.exp(-d ** 2 / (2 * 0.7 ** 2))
            label = 0.0
        elif kind == 8:                                 # positive/negative pair (bad subtraction)
            ang = rng.uniform(0, 2 * np.pi)
            off = rng.uniform(1.5, 3.0)
            amp = rng.uniform(6, 40)
            img = noise + amp * _gauss(yy, xx, c, c, 1.0) \
                - amp * rng.uniform(0.6, 1.0) * _gauss(yy, xx, c + off * np.sin(ang), c + off * np.cos(ang), 1.0)
            label = 0.0
        else:                                           # wide blob (ghost, nebulosity)
            img = noise + rng.uniform(5, 25) * _gauss(yy, xx, c, c, rng.uniform(3.0, 5.0))
            label = 0.0
        xs.append(normalise(img))
        ys.append(label)
    return np.asarray(xs), np.asarray(ys)


def _forward(w: dict, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h = np.tanh(x @ w["w1"] + w["b1"])
    z = h @ w["w2"] + w["b2"]
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30))), h


def _train() -> dict:
    rng = np.random.default_rng(20261114)
    x, y = _training_set(rng, 6000)
    xv, yv = _training_set(rng, 1500)
    w = {
        "w1": rng.normal(0, 0.15, (SIZE * SIZE, HIDDEN)), "b1": np.zeros(HIDDEN),
        "w2": rng.normal(0, 0.15, HIDDEN), "b2": np.zeros(1),
    }
    m = {k: np.zeros_like(v) for k, v in w.items()}
    v = {k: np.zeros_like(v_) for k, v_ in w.items()}
    lr, b1, b2 = 0.02, 0.9, 0.999
    for step in range(1, 401):                          # full-batch Adam
        p, h = _forward(w, x)
        dz = (p - y) / len(y)
        dh = np.outer(dz, w["w2"]) * (1 - h ** 2)
        grads = {"w2": h.T @ dz, "b2": np.array([dz.sum()]), "w1": x.T @ dh, "b1": dh.sum(axis=0)}
        for k in w:
            g = grads[k] + 1e-4 * w[k]
            m[k] = b1 * m[k] + (1 - b1) * g
            v[k] = b2 * v[k] + (1 - b2) * g * g
            w[k] = w[k] - lr * (m[k] / (1 - b1 ** step)) / (np.sqrt(v[k] / (1 - b2 ** step)) + 1e-8)
    pv, _ = _forward(w, xv)
    w["val_accuracy"] = np.array([float(np.mean((pv > 0.5) == (yv > 0.5)))])
    return w


def _load() -> dict:
    global _model
    with _lock:
        if _model is not None:
            return _model
        path = config.CACHE_DIR / "models" / f"{VERSION}.npz"
        try:
            with np.load(path) as f:
                _model = {k: f[k] for k in f.files}
            if _model["w1"].shape != (SIZE * SIZE, HIDDEN):
                raise ValueError("stale weights")
        except Exception:  # noqa: BLE001 - missing or stale file: train again
            _model = _train()
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                np.savez(path, **_model)
            except OSError:
                pass
        return _model


def cut_patch(image: np.ndarray, x: int, y: int) -> np.ndarray:
    """SIZE x SIZE patch centred on column x, row y; outside the image is the median."""
    img = np.asarray(image, dtype=np.float64)
    half = SIZE // 2
    fill = float(np.nanmedian(img)) if img.size else 0.0
    padded = np.pad(np.where(np.isfinite(img), img, fill), half, mode="constant", constant_values=fill)
    return padded[y:y + SIZE, x:x + SIZE]


def patch_score(image: np.ndarray, x: int, y: int) -> float:
    """0..1: how much the patch around (x, y) looks like a point source.  A hint, not evidence."""
    w = _load()
    p, _ = _forward(w, normalise(cut_patch(image, x, y))[None, :])
    return float(p[0])


def info() -> dict:
    w = _load()
    n = sum(int(w[k].size) for k in ("w1", "b1", "w2", "b2"))
    return {
        "name": VERSION,
        "parameters": n,
        "trained_on": "simulated patches only (point sources, noise, hot pixels, streaks, pairs, blobs)",
        "validation_accuracy_on_simulated": round(float(w["val_accuracy"][0]), 3),
        "note": "A ranking hint from a small model. Not evidence, and never a detection.",
    }
