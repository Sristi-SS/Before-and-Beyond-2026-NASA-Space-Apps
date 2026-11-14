"""Background job that turns a coordinate request into a cached time cube.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import threading
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

from . import align, cache, config, group, resolve, spherex, tilt, wise

try:  # headless contact sheets.  No pyplot: pyplot is not thread-safe.
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
except Exception:  # pragma: no cover
    Figure = None

# Limits how many cubes are built at the same time (archive etiquette).
_JOB_SLOTS = threading.BoundedSemaphore(max(1, config.MAX_ACTIVE_JOBS))


def job_key(params: dict) -> str:
    ra = params.get("ra")
    dec = params.get("dec")
    return cache.key_for(
        "job-v2",  # bump when the pipeline semantics change
        params.get("name") or "",
        "none" if ra is None else f"{ra:.5f}",
        "none" if dec is None else f"{dec:.5f}",
        f"{params.get('fov', 0.2):.4f}",
        params.get("npix", config.DEFAULT_NPIX),
        f"{params.get('pixscale', config.DEFAULT_PIXSCALE):.3f}",
        params.get("max_frames", config.MAX_FRAMES_PER_JOB),
        params.get("release", config.RELEASE),
        # Only added when switched off, so every key made before the WISE
        # stage existed (and every default job) keeps its cache folder.
        *(("wise-off",) if params.get("wise", True) is False else ()),
    )


@dataclass
class Job:
    key: str
    params: dict
    state: dict = field(default_factory=dict)
    thread: Optional[threading.Thread] = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def dir(self) -> Path:
        return cache.job_dir(self.key)

    @property
    def state_path(self) -> Path:
        return self.dir / "job.json"

    def save(self) -> None:
        with self.lock:
            self.state["updated"] = time.time()
            cache.atomic_write_json(self.state_path, self.state)

    def update(self, **kwargs) -> None:
        with self.lock:
            self.state.update(kwargs)
        self.save()

    def status(self) -> dict:
        with self.lock:
            return dict(self.state)


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _settled(job: Job) -> bool:
        """True when memory holds the final word: built here, or finished."""
        if job.thread is not None and job.thread.is_alive():
            return True
        return job.state.get("status") == "done"

    @staticmethod
    def _read_disk(key: str) -> Optional[dict]:
        # Do not use cache.job_dir() here: it creates directories, and a lookup
        # for an unknown key must stay read-only.
        state_path = config.CACHE_DIR / "jobs" / key / "job.json"
        try:
            state = cache.read_json(state_path)
        except (OSError, ValueError):
            return None
        if not isinstance(state, dict):
            return None
        if state.get("status") in ("queued", "running"):
            age = time.time() - float(state.get("updated", 0) or 0)
            if age > config.STALE_JOB_SECONDS:
                # Nobody is writing this job any more (server restart).
                state = dict(state, status="error", phase="error", stale=True,
                             error="This build was interrupted. Build the cube again.")
        return state

    def get(self, key: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(key)
            if job is not None and self._settled(job):
                return job
            # No live thread here: another process (precache) may own the job,
            # so the file on disk is the truth.
            state = self._read_disk(key)
            if state is None:
                return job
            job = Job(key=key, params=state.get("params", {}), state=state)
            self._jobs[key] = job
            return job

    def submit(self, params: dict, force: bool = False) -> Job:
        key = job_key(params)
        with self._lock:
            existing = self._jobs.get(key)
            if existing is not None and self._settled(existing):
                if not (force and existing.state.get("status") == "done"):
                    return existing
            state = self._read_disk(key)
            if state is not None and not force and state.get("status") in ("done", "queued", "running"):
                # Finished, or another process is building it right now.
                job = Job(key=key, params=state.get("params", params), state=state)
                self._jobs[key] = job
                return job
            # New, failed or interrupted: (re)start from a clean state.
            state = {
                "key": key,
                "params": params,
                "status": "queued",
                "phase": "queued",
                "progress": {"done": 0, "total": 0},
                "frames": [],
                "groups": [],
                "slices": [],
                "created": time.time(),
                "release": params.get("release", config.RELEASE),
            }
            job = Job(key=key, params=params, state=state)
            job.save()
            job.thread = threading.Thread(target=self._run, args=(job,), daemon=True)
            self._jobs[key] = job
            job.thread.start()
        return job

    # ------------------------------------------------------------------
    def _run(self, job: Job) -> None:
        try:
            with _JOB_SLOTS:  # wait here, as "queued", while other cubes build
                self._pipeline(job)
        except Exception as exc:  # noqa: BLE001
            job.update(
                status="error",
                phase="error",
                error=f"{type(exc).__name__}: {exc}",
                traceback=traceback.format_exc()[-4000:],
            )

    def _pipeline(self, job: Job) -> None:
        params = job.params
        job.update(status="running", phase="resolving", progress={"done": 0, "total": 0})

        if params.get("name"):
            target = resolve.resolve_name(params["name"])
            # Catalogue positions are J2000; centre the cube on where the
            # object is during the survey, otherwise fast movers such as
            # Barnard's Star sit several arcminutes off-centre.
            ra, dec = target.at_year(2026.5)
        else:
            ra = float(params["ra"])
            dec = float(params["dec"])
            target = resolve.Target(str(params.get("name") or "Custom position"), ra, dec)

        fov = float(np.clip(params.get("fov", 0.2), 0.02, 0.8))
        npix = int(np.clip(params.get("npix", config.DEFAULT_NPIX), 32, config.MAX_NPIX))
        pixscale = align.clamp_pixscale(float(params.get("pixscale", config.DEFAULT_PIXSCALE)))
        max_frames = int(np.clip(params.get("max_frames", config.MAX_FRAMES_PER_JOB), 1, config.MAX_FRAMES_PER_JOB))
        grid = align.make_grid(ra, dec, npix, pixscale)
        # The output grid is npix * pixscale wide whatever the requested field of view.  A
        # cut-out smaller than the grid leaves most of it uncovered, and every frame would be
        # rejected for low coverage, so never request less than the grid needs.
        fov_fetch = max(fov, npix * pixscale / 3600.0 * 0.84)

        # The grid is centred on the propagated position for named objects.
        search_ra, search_dec = ra, dec

        job.update(
            target={**target.as_dict(), "search_ra_deg": round(search_ra, 6),
                    "search_dec_deg": round(search_dec, 6)},
            grid={
                "npix": npix,
                "pixscale_arcsec": round(pixscale, 3),
                "fov_arcsec": round(npix * pixscale, 1),
                "center_ra": ra,
                "center_dec": dec,
            },
            phase="searching",
            release=params.get("release", config.RELEASE),
        )

        def on_progress(done: int, total: int, meta: dict) -> None:
            with job.lock:
                job.state["progress"] = {"done": done, "total": total}
                job.state.setdefault("downloads", []).append(meta)
            job.save()

        counter = {"n": 0}

        def on_frame(plane, cut, wave, band) -> None:
            year = resolve.decimal_year(cut.mjd)
            frame_ra, frame_dec = target.at_year(year) if params.get("name") else (ra, dec)
            aligned = align.align_frame(cut.image, cut.flags, cut.zodi, cut.wcs, grid, npix)
            if aligned is None:
                return False
            index = counter["n"]
            counter["n"] += 1
            fpath = cache.frames_dir(job.key) / f"{index:03d}.npy"
            cache.atomic_write_npy(fpath, aligned.data)
            # Compact uint8 mask (1 = masked, then filled by interpolation).  Read by
            # /photometry to flag measurements; caches built before this have none.
            cache.atomic_write_npy(fpath.with_name(f"{index:03d}.mask.npy"),
                                   np.asarray(aligned.mask, dtype=np.uint8))
            meta = {
                "id": f"{plane.obs_id}_D{plane.detector}",
                "index": index,
                "source": "spherex",
                "obs_time": cut.date_obs,
                "mjd": round(cut.mjd, 5),
                "detector": plane.detector,
                "wavelength_um": round(wave, 4),
                "bandwidth_um": round(band, 4),
                "masked_fraction": round(aligned.masked_fraction, 4),
                "coverage": round(aligned.coverage, 3),
                "background": round(aligned.background, 4),
                "noise": round(aligned.noise, 4),
                "collection": plane.collection,
                "provenance_url": spherex.cutout_url(
                    plane.uri or "", ra, dec, max(fov_fetch * 1.25, fov_fetch + 0.05)
                ) if plane.uri else plane.access_url,
                "status": "ok",
                "target_ra_deg": round(frame_ra, 6),
                "target_dec_deg": round(frame_dec, 6),
            }
            with job.lock:
                job.state.setdefault("frames", []).append(meta)
                job.state["aligned"] = counter["n"]
            job.save()
            return True

        spherex.search_and_fetch(
            search_ra, search_dec, fov_fetch, max_frames,
            progress=on_progress, on_frame=on_frame,
        )

        job.update(phase="grouping")
        frames = []
        for meta in sorted(job.state.get("frames", []), key=lambda m: m["mjd"]):
            path = cache.frames_dir(job.key) / f"{meta['index']:03d}.npy"
            if not path.exists():
                continue
            frames.append(group.Frame(
                id=meta["id"], source=meta["source"], obs_time=meta["obs_time"],
                mjd=meta["mjd"], pass_index=0, detector=meta["detector"],
                wavelength_um=meta["wavelength_um"], bandwidth_um=meta["bandwidth_um"],
                masked_fraction=meta["masked_fraction"], provenance_url=meta["provenance_url"],
                data=np.load(path), mask=np.zeros((npix, npix), dtype=bool),
                coverage=meta.get("coverage", 1.0), background=meta.get("background", 0.0),
                noise=meta.get("noise", 0.0),
            ))
        group.assign_passes(frames)
        by_id = {f.id: f for f in frames}
        for meta in job.state.get("frames", []):
            f = by_id.get(meta["id"])
            if f is not None:
                meta["pass"] = f.pass_index

        slices = group.build_slices(frames)
        cubes_dir = job.dir / "cubes"
        cubes_dir.mkdir(parents=True, exist_ok=True)
        slice_meta = []
        for det in sorted({s["detector"] for s in slices}):
            members = [s for s in slices if s["detector"] == det]
            members.sort(key=lambda s: s["mjd"])
            stack = np.stack([s["data"] for s in members]).astype(np.float32)
            cache.atomic_write_npy(cubes_dir / f"det{det}.npy", stack)
            cache.atomic_write_json(
                cubes_dir / f"det{det}.json",
                [{k: v for k, v in s.items() if k != "data"} for s in members],
            )
            for s in members:
                entry = {k: v for k, v in s.items() if k != "data"}
                entry["simple_noise"] = float(
                    1.4826 * np.median(np.abs(s["data"] - np.median(s["data"])))
                )
                slice_meta.append(entry)

        groups = group.detector_groups(frames)
        for g in groups:
            g["slices"] = sum(1 for s in slice_meta if s["detector"] == g["detector"])

        if not frames:
            raise RuntimeError(
                "no usable SPHEREx frames at this position "
                "(the archive returned nothing that covers it, or it was too busy)"
            )
        job.update(frames=sorted(job.state.get("frames", []), key=lambda m: m["mjd"]))
        try:
            sheet = _write_contact_sheet(job, npix)
        except Exception:  # noqa: BLE001 - a plot must never fail a good cube
            sheet = None

        # Optional WISE/NEOWISE baseline.  It runs after the SPHEREx cube is
        # complete (and after the contact sheet, so the sheet keeps showing
        # SPHEREx frames) and can never fail the job.
        wise_state = {"status": "none", "n": 0, "message": "disabled for this job"}
        if params.get("wise", True) is not False:
            wise_state, wise_groups, wise_slices = _wise_stage(
                job, grid, npix, pixscale, ra, dec, fov, counter,
            )
            groups = groups + wise_groups
            slice_meta = slice_meta + wise_slices

        job.update(
            status="done",
            phase="done",
            wise=wise_state,
            contact_sheet=sheet,
            frames=sorted(job.state.get("frames", []), key=lambda m: m["mjd"]),
            groups=groups,
            slices=sorted(slice_meta, key=lambda s: (s["detector"], s["mjd"])),
            collections=sorted({m.get("collection", "") for m in job.state.get("frames", []) if m.get("collection")}),
            progress={"done": job.state["progress"].get("total", 0), "total": job.state["progress"].get("total", 0)},
        )


def _wise_stage(job: "Job", grid, npix: int, pixscale: float, ra: float, dec: float,
                fov: float, counter: dict) -> tuple[dict, list, list]:
    """Fetch WISE/NEOWISE epochs onto ``grid`` and add them as detectors 101/102.

    Returns ``(state["wise"], groups, slices)``.  Never raises.
    """
    try:
        job.update(phase="wise")

        def on_progress(done: int, total: int) -> None:
            with job.lock:
                job.state["wise_progress"] = {"done": done, "total": total}
            job.save()

        found = wise.fetch_frames(grid, npix, ra, dec, npix * pixscale / 3600.0, pixscale,
                                  progress=on_progress)
        if not found:
            return ({"status": "none", "n": 0,
                     "message": "no WISE/NEOWISE time-resolved coadd covers this position"}, [], [])

        gframes, metas = [], []
        for wf in found:  # already sorted by time
            index = counter["n"]
            counter["n"] += 1
            cache.atomic_write_npy(cache.frames_dir(job.key) / f"{index:03d}.npy", wf.data)
            meta = wf.meta(index)
            metas.append(meta)
            gframes.append(group.Frame(
                id=wf.id, source="wise", obs_time=wf.obs_time, mjd=wf.mjd, pass_index=0,
                detector=meta["detector"], wavelength_um=meta["wavelength_um"],
                bandwidth_um=meta["bandwidth_um"], masked_fraction=wf.masked_fraction,
                provenance_url=wf.provenance_url, data=wf.data,
                mask=np.zeros((npix, npix), dtype=bool), coverage=wf.coverage,
                background=wf.background, noise=wf.noise,
            ))
        group.assign_passes(gframes)
        by_id = {f.id: f for f in gframes}
        for meta in metas:
            meta["pass"] = by_id[meta["id"]].pass_index
        slices = group.build_slices(gframes)

        cubes_dir = job.dir / "cubes"
        cubes_dir.mkdir(parents=True, exist_ok=True)
        slice_meta = []
        for det in sorted({s["detector"] for s in slices}):
            members = sorted((s for s in slices if s["detector"] == det), key=lambda s: s["mjd"])
            cache.atomic_write_npy(cubes_dir / f"det{det}.npy",
                                   np.stack([s["data"] for s in members]).astype(np.float32))
            cache.atomic_write_json(cubes_dir / f"det{det}.json",
                                    [{k: v for k, v in s.items() if k != "data"} for s in members])
            for s in members:
                entry = {k: v for k, v in s.items() if k != "data"}
                entry["simple_noise"] = float(
                    1.4826 * np.median(np.abs(s["data"] - np.median(s["data"]))))
                slice_meta.append(entry)

        groups = []
        for g in group.detector_groups(gframes):
            band = 1 if g["detector"] == wise.DET_W1 else 2
            g["range_um"] = list(wise.band_range_um(band))
            g["slices"] = sum(1 for s in slice_meta if s["detector"] == g["detector"])
            groups.append(g)

        with job.lock:
            job.state.setdefault("frames", []).extend(metas)
        job.save()
        years = sorted(m["obs_time"][:4] for m in metas)
        return ({"status": "ok", "n": len(metas),
                 "message": f"{len(metas)} WISE/NEOWISE epochs, {years[0]}-{years[-1]}, "
                            f"release {wise.RELEASE}"}, groups, slice_meta)
    except Exception as exc:  # noqa: BLE001 - WISE is optional, the cube is already good
        return ({"status": "error", "n": 0, "message": f"{type(exc).__name__}: {exc}"[:300]}, [], [])


def _stretch(image: np.ndarray) -> np.ndarray:
    vals = image[np.isfinite(image)]
    if vals.size == 0:
        return np.zeros_like(image)
    lo, hi = np.percentile(vals, [1, 99.5])
    if hi <= lo:
        hi = lo + 1e-6
    return np.clip((image - lo) / (hi - lo), 0, 1)


def _write_contact_sheet(job: Job, npix: int) -> Optional[str]:
    if Figure is None:
        return None
    frames = job.status().get("frames", [])
    if not frames:
        return None
    frames = sorted(frames, key=lambda m: m["mjd"])[:40]
    n = len(frames)
    cols = min(5, n)
    rows = int(np.ceil(n / cols))
    fig = Figure(figsize=(3.1 * cols, 3.3 * rows))
    FigureCanvasAgg(fig)
    axes = fig.subplots(rows, cols, squeeze=False)
    for ax in axes.ravel():
        ax.axis("off")
    for ax, meta in zip(axes.ravel(), frames):
        path = cache.frames_dir(job.key) / f"{meta['index']:03d}.npy"
        if not path.exists():
            continue
        data = np.load(path)
        ax.imshow(_stretch(data), origin="lower", cmap="magma", interpolation="nearest")
        ax.set_title(
            f"D{meta['detector']}  {meta['wavelength_um']:.2f} um\n{meta['obs_time'][:10]}  pass {meta.get('pass')}",
            fontsize=7,
        )
        ax.axis("on")
        ax.set_xticks([]); ax.set_yticks([])
    fig.suptitle(
        f"{job.state.get('target', {}).get('name', '')} - aligned frames, {npix}x{npix}",
        fontsize=11,
    )
    fig.tight_layout()
    out = job.dir / "contact_sheet.png"
    fig.savefig(out, dpi=110)
    return str(out)


manager = JobManager()
