"""Small, dependency-free disk cache.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from . import config

_LOCK = threading.RLock()


def key_for(*parts: Any) -> str:
    """Stable short key for a tuple of cache-defining values."""
    raw = "|".join(str(p) for p in parts).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:20]


def _replace(tmp: str, path: Path) -> None:
    """``os.replace`` with a short retry.

    On Windows the replace fails while another thread or process has the target
    open for reading (for example the server reading job.json).
    """
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def atomic_write_bytes(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        _replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return path


def atomic_write_json(path: Path, payload: Any) -> Path:
    return atomic_write_bytes(path, json.dumps(payload, indent=2, default=str).encode("utf-8"))


def read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def atomic_write_npy(path: Path, array: np.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".npy")
    try:
        with os.fdopen(fd, "wb") as fh:
            np.save(fh, array, allow_pickle=False)
        _replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return path


def raw_dir() -> Path:
    d = config.CACHE_DIR / "raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def job_dir(job_key: str) -> Path:
    d = config.CACHE_DIR / "jobs" / job_key
    d.mkdir(parents=True, exist_ok=True)
    return d


def frames_dir(job_key: str) -> Path:
    d = job_dir(job_key) / "frames"
    d.mkdir(parents=True, exist_ok=True)
    return d


def iter_cached(path: Path) -> Iterable[Path]:
    if path.exists():
        yield from sorted(p for p in path.iterdir() if p.is_file())


class JobLock:
    """A per-job in-process mutex so two browser tabs do not duplicate work."""

    _locks: dict[str, threading.Lock] = {}

    def __init__(self, key: str):
        with _LOCK:
            self._lock = self._locks.setdefault(key, threading.Lock())

    def __enter__(self):
        self._lock.acquire()
        return self

    def __exit__(self, *exc):
        self._lock.release()
        return False
