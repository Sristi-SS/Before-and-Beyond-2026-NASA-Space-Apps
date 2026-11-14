"""Pass clustering, wavelength groups and cube slices.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

SPHEREx revisits most of the sky roughly every six months.  Frames are first
clustered into passes by observation time, then split by detector (the six
wavelength groups the challenge asks to start with).  Frames in the same pass
and detector are averaged into one cube slice; the individual frames are kept
so fast movers can still be inspected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

from . import config


@dataclass
class Frame:
    id: str
    source: str
    obs_time: str
    mjd: float
    pass_index: int
    detector: int
    wavelength_um: float
    bandwidth_um: float
    masked_fraction: float
    provenance_url: str
    data: np.ndarray = field(repr=False)
    mask: np.ndarray = field(repr=False)
    coverage: float = 1.0
    background: float = 0.0
    noise: float = 0.0

    def meta(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "obs_time": self.obs_time,
            "mjd": round(self.mjd, 5),
            "pass": self.pass_index,
            "detector": self.detector,
            "wavelength_um": round(self.wavelength_um, 4),
            "bandwidth_um": round(self.bandwidth_um, 4),
            "masked_fraction": round(self.masked_fraction, 4),
            "coverage": round(self.coverage, 3),
            "provenance_url": self.provenance_url,
        }


def assign_passes(frames: Iterable[Frame], gap_days: float = config.PASS_GAP_DAYS) -> list[Frame]:
    """Assign a 1-based pass index from observation-time gaps."""
    ordered = sorted(frames, key=lambda f: f.mjd)
    if not ordered:
        return []
    pass_index = 1
    prev = ordered[0].mjd
    for frame in ordered:
        if frame.mjd - prev > gap_days:
            pass_index += 1
        frame.pass_index = pass_index
        prev = frame.mjd
    return ordered


def detector_groups(frames: Iterable[Frame]) -> list[dict]:
    groups = {}
    for f in frames:
        g = groups.setdefault(
            f.detector,
            {
                "detector": f.detector,
                "wavelength_um": f.wavelength_um,
                "bandwidth_um": f.bandwidth_um,
                "range_um": list(config.DETECTOR_BANDS.get(f.detector, (0, 0))),
                "count": 0,
                "passes": set(),
                "slices": 0,
            },
        )
        g["count"] += 1
        g["passes"].add(f.pass_index)
        if abs(f.wavelength_um - g["wavelength_um"]) > 0:
            g["wavelength_um"] = float(np.median(
                [x.wavelength_um for x in frames if x.detector == f.detector]
            ))
    for g in groups.values():
        g["passes"] = sorted(g["passes"])
    return sorted(groups.values(), key=lambda g: g["detector"])


def build_slices(frames: Iterable[Frame]) -> list[dict]:
    """Average frames within (pass, detector) into cube slices."""
    buckets: dict[tuple[int, int], list[Frame]] = {}
    for f in frames:
        buckets.setdefault((f.pass_index, f.detector), []).append(f)
    slices = []
    for (pass_index, detector), members in sorted(buckets.items()):
        if not members:
            continue
        stack = np.stack([m.data for m in members])
        weights = np.array([max(m.coverage, 0.05) for m in members], dtype=np.float64)
        data = np.tensordot(weights, stack, axes=(0, 0)) / weights.sum()
        mean_mjd = float(np.mean([m.mjd for m in members]))
        waves = [m.wavelength_um for m in members]
        slices.append({
            "pass": pass_index,
            "detector": detector,
            "mjd": mean_mjd,
            "obs_time": min((m.obs_time for m in members), default=""),
            "wavelength_um": float(np.median(waves)),
            "bandwidth_um": float(np.median([m.bandwidth_um for m in members])),
            "n_frames": len(members),
            "member_ids": [m.id for m in members],
            "data": data.astype(np.float32),
        })
    return slices
