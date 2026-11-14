"""Pre-cache the five challenge test objects.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Usage:
    python -m backend.precache --only barnard --max-frames 12
    python -m backend.precache                 # all five, polite defaults
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from . import cache, config, jobs, resolve


def _group_peak_snr(cube_path: Path, meta_path: Path) -> float:
    if not cube_path.exists():
        return 0.0
    cube = np.load(cube_path)
    meta = cache.read_json(meta_path)
    if cube.size == 0:
        return 0.0
    stacked = cube.sum(axis=0).astype(np.float64)
    noise = 1.4826 * np.median(np.abs(stacked - np.median(stacked)))
    if noise <= 0:
        return 0.0
    return float(np.max(stacked) / noise)


def summarise(job) -> dict:
    state = job.status()
    target = state.get("target", {})
    groups = []
    for g in state.get("groups", []):
        det = g["detector"]
        snr = _group_peak_snr(
            job.dir / "cubes" / f"det{det}.npy",
            job.dir / "cubes" / f"det{det}.json",
        )
        g = dict(g)
        g["peak_snr"] = round(snr, 1)
        g["visible"] = bool(snr >= 5.0 and g["count"] > 0)
        groups.append(g)
    return {
        "key": job.key,
        "name": target.get("name"),
        "status": state.get("status"),
        "frames": len(state.get("frames", [])),
        "passes": sorted({f.get("pass") for f in state.get("frames", []) if f.get("pass")}),
        "groups": groups,
        "contact_sheet": state.get("contact_sheet"),
        "error": state.get("error"),
    }


def run(names: list[str], fov: float, npix: int, max_frames: int, force: bool) -> list[dict]:
    out = []
    for name in names:
        target = resolve.BUILTIN_TARGETS[name]
        params = {
            "name": target.name,
            "ra": None,
            "dec": None,
            "fov": fov,
            "npix": npix,
            "pixscale": config.DEFAULT_PIXSCALE,
            "max_frames": max_frames,
            "release": config.RELEASE,
        }
        key = jobs.job_key(params)
        existing = jobs.manager.get(key)
        if existing is not None and existing.status().get("status") == "done" and not force:
            print(f"[cached] {target.name} ({key})")
            out.append(summarise(existing))
            continue
        print(f"[fetch ] {target.name} -> {key}")
        job = jobs.manager.submit(params, force=force)
        last = None
        t0 = time.time()
        while True:
            st = job.status()
            progress = st.get("progress", {})
            phase = st.get("phase")
            marker = (phase, progress.get("done"), progress.get("total"),
                      len(st.get("frames", [])))
            if marker != last:
                print(f"   {phase:10s} {progress.get('done', 0)}/{progress.get('total', 0)} "
                      f"downloaded, {len(st.get('frames', []))} aligned")
                last = marker
            if st.get("status") in ("done", "error"):
                break
            if time.time() - t0 > 3600:
                print("   timeout")
                break
            time.sleep(2.0)
        summary = summarise(job)
        out.append(summary)
        print(f"   status={summary['status']} frames={summary['frames']} "
              f"passes={summary['passes']}")
        for g in summary["groups"]:
            print(f"     D{g['detector']}  n={g['count']:3d} slices={g['slices']:2d} "
                  f"lambda~{g['wavelength_um']:.2f}um  peakSNR={g['peak_snr']:.1f} "
                  f"{'visible' if g['visible'] else ''}")
        if summary.get("contact_sheet"):
            print(f"   contact sheet: {summary['contact_sheet']}")
        if summary.get("error"):
            print(f"   ERROR: {summary['error']}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Pre-cache SPHEREx time cubes")
    parser.add_argument("--only", default="", help="comma-separated keys: barnard,epsindb,wise0855,rwaur,rdra")
    parser.add_argument("--fov", type=float, default=0.2)
    parser.add_argument("--npix", type=int, default=config.DEFAULT_NPIX)
    parser.add_argument("--max-frames", type=int, default=40)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    names = [n.strip() for n in args.only.split(",") if n.strip()] or list(resolve.TEST_TARGET_KEYS)
    names = [n for n in names if n in resolve.BUILTIN_TARGETS]
    results = run(names, args.fov, args.npix, args.max_frames, args.force)
    out = config.DATA_DIR / "precache_summary.json"
    existing = []
    if out.exists():
        try:
            existing = cache.read_json(out).get("targets", [])
        except Exception:
            existing = []
    merged = {entry["key"]: entry for entry in existing if entry.get("key")}
    for entry in results:
        merged[entry["key"]] = entry
    cache.atomic_write_json(out, {
        "generated": time.time(),
        "targets": list(merged.values()),
    })
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
