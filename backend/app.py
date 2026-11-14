"""FastAPI application for the SPHEREx Time Cube.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Run with:  python -m backend.app     (or uvicorn backend.app:app --reload)
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import (cache, candidates, config, extras, group, hardware, jobs, refresh, resolve,
               service, spherex, tilt)

app = FastAPI(title="SPHEREx Time Cube", version="0.1.0")
# The API is read-only public data with no login, so any origin may read it by default.
# Set SPHEREX_CORS_ORIGINS (comma-separated) to allow only your own site.
_CORS = [o.strip() for o in os.environ.get("SPHEREX_CORS_ORIGINS", "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Score", "X-Min", "X-Max", "X-Npix", "X-Nsl", "X-Shifts",
                    "X-Frame-Index", "X-Nv", "X-Span", "X-Step", "X-Best-Vx", "X-Best-Vy",
                    "X-Best-Score", "X-Zero-Score", "X-Best-X", "X-Best-Y"],
)

# 1-6 are SPHEREx detectors, 101/102 are WISE W1/W2, 0 means every frame.
MAX_DETECTOR = 102

_KEY_RE = re.compile(r"^[0-9a-f]{20}$")
_PRIVATE_FIELDS = ("traceback", "downloads")


def _job(key: str) -> jobs.Job:
    """Look a job up.  The key becomes a folder name, so its shape is checked."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise HTTPException(404, "job not found")
    return job


def _public_status(job: jobs.Job) -> dict:
    """Job state for the browser, without local paths or tracebacks."""
    state = {k: v for k, v in job.status().items() if k not in _PRIVATE_FIELDS}
    state["contact_sheet"] = bool(state.get("contact_sheet"))
    return state


app.include_router(extras.router)
app.include_router(service.router)
app.include_router(hardware.router)
app.include_router(candidates.router)
app.include_router(refresh.router)
refresh.start_auto_refresh()   # only when SPHEREX_AUTO_REFRESH_HOURS is set
app.add_middleware(service.JsonGZip)


class JobRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    ra: Optional[float] = Field(None, ge=0.0, le=360.0)
    dec: Optional[float] = Field(None, ge=-90.0, le=90.0)
    fov: float = Field(0.2, ge=0.02, le=0.8)
    npix: int = Field(config.DEFAULT_NPIX, ge=32, le=config.MAX_NPIX)
    pixscale: float = Field(config.DEFAULT_PIXSCALE, ge=0.5, le=60.0)
    max_frames: int = Field(config.MAX_FRAMES_PER_JOB, ge=1, le=config.MAX_FRAMES_PER_JOB)
    release: str = config.RELEASE
    wise: bool = True


@app.get("/api/health")
def health() -> dict:
    return _health()


@app.get("/health")  # alias for simple uptime probes
def health_alias() -> dict:
    return _health()


def _health() -> dict:
    return {
        "ok": True,
        "release": config.RELEASE,
        "collections": list(config.KNOWN_COLLECTIONS),
    }


@app.get("/api/targets")
def targets() -> dict:
    return {
        "targets": [
            {**t.as_dict(), "key": k}
            for k, t in resolve.BUILTIN_TARGETS.items()
        ]
    }


@app.post("/api/jobs")
def create_job(req: JobRequest, request: Request) -> dict:
    if not req.name and (req.ra is None or req.dec is None):
        raise HTTPException(400, "provide a name or both ra and dec")
    if req.release not in config.KNOWN_COLLECTIONS:
        raise HTTPException(400, "unknown release")
    params = req.model_dump()
    if req.name:
        params["name"] = req.name.strip()
        params["ra"], params["dec"] = None, None
    else:
        params["ra"] = req.ra % 360.0
    service.enforce_build_limit(request, params)
    job = jobs.manager.submit(params)
    return {"key": job.key, "status": _public_status(job)}


@app.get("/api/jobs/{key}")
def get_job(key: str) -> dict:
    return _public_status(_job(key))


def _load_cube(key: str, detector: int) -> tuple[np.ndarray, list[dict]]:
    job = _job(key)
    cube_path = job.dir / "cubes" / f"det{detector}.npy"
    meta_path = job.dir / "cubes" / f"det{detector}.json"
    if not cube_path.exists() or not meta_path.exists():
        raise HTTPException(404, "no cube for that detector")
    return np.load(cube_path), cache.read_json(meta_path)


def _load_frames(key: str, detector: int) -> tuple[np.ndarray, list[dict]]:
    """Stack the individual aligned frames (detector 0 = every detector).

    The 3D view uses the individual epochs, not the pass-averaged slices, so the
    time axis shows the real cadence of the survey.
    """
    job = _job(key)
    metas = [
        m for m in job.status().get("frames", [])
        if m.get("status") == "ok" and (detector == 0 or m.get("detector") == detector)
    ]
    metas.sort(key=lambda m: m["mjd"])
    images, ok_metas = [], []
    for meta in metas:
        path = job.dir / "frames" / f"{meta['index']:03d}.npy"
        if path.exists():
            images.append(np.load(path))
            ok_metas.append(meta)
    if not images:
        raise HTTPException(404, "no frames for that detector")
    return np.stack(images).astype(np.float32), ok_metas


@app.get("/api/jobs/{key}/cube/{detector}")
def get_cube(key: str, detector: int) -> Response:
    cube, meta = _load_cube(key, detector)
    npix = cube.shape[1]
    return Response(
        content=np.ascontiguousarray(cube, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Nsl": str(cube.shape[0]),
            "X-Npix": str(npix),
            "Cache-Control": "public, max-age=3600",
        },
    )


def _check_detector(detector: int) -> int:
    if detector > 6 and detector not in (101, 102):
        raise HTTPException(422, "detector must be 0-6, 101 or 102")
    return detector


@app.get("/api/jobs/{key}/frames_cube")
def get_frames_cube(key: str, detector: int = Query(0, ge=0, le=MAX_DETECTOR)) -> Response:
    _check_detector(detector)
    cube, metas = _load_frames(key, detector)
    finished = _job(key).status().get("status") == "done"
    return Response(
        content=np.ascontiguousarray(cube, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Nsl": str(cube.shape[0]),
            "X-Npix": str(cube.shape[1]),
            # Which frame each slice is, so the browser never pairs a slice
            # with the wrong date while a job is still adding frames.
            "X-Frame-Index": json.dumps([m["index"] for m in metas]),
            # A cube that is still filling in must not be cached.
            "Cache-Control": "public, max-age=3600" if finished else "no-store",
        },
    )


@app.get("/api/jobs/{key}/tilt")
def get_tilt(
    key: str,
    detector: int = Query(..., ge=0, le=MAX_DETECTOR),
    vx: float = Query(0.0, ge=-60.0, le=60.0),
    vy: float = Query(0.0, ge=-60.0, le=60.0),
    t0: Optional[float] = None,
    source: str = Query("frames", pattern="^(frames|slices)$"),
    static: str = Query("none", pattern="^(median|none)$"),
) -> Response:
    """Shift-and-sum at (vx, vy).  ``static=median`` removes the fixed sky first."""
    _check_detector(detector)
    if source == "slices":
        if detector == 0:
            raise HTTPException(400, "slices require a detector 1-6")
        cube, meta = _load_cube(key, detector)
    else:
        detector = 0 if detector == 0 else detector
        cube, meta = _load_frames(key, detector)
    mjds = [m["mjd"] for m in meta]
    if not mjds:
        raise HTTPException(404, "empty cube")
    grid = _job(key).status().get("grid", {})
    pixscale = float(grid.get("pixscale_arcsec", config.DEFAULT_PIXSCALE))
    try:
        stacked, shifts = tilt.shift_sum(list(cube), mjds, vx, vy, pixscale, t0_mjd=t0,
                                         static=static)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    score = tilt.sharpness(stacked)
    lo, hi = float(np.min(stacked)), float(np.max(stacked))
    payload = np.ascontiguousarray(stacked, dtype="<f4").tobytes()
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={
            "X-Score": f"{score:.5f}",
            "X-Min": f"{lo:.6e}",
            "X-Max": f"{hi:.6e}",
            "X-Npix": str(stacked.shape[1]),
            "X-Shifts": json.dumps([[round(a, 3), round(b, 3)] for a, b in shifts]),
        },
    )


@app.get("/api/jobs/{key}/contact_sheet.png")
def contact_sheet(key: str):
    path = _job(key).dir / "contact_sheet.png"
    if not path.exists():
        raise HTTPException(404, "no contact sheet")
    return FileResponse(path, media_type="image/png")


@app.get("/api/jobs/{key}/motionmap")
def motion_map(
    request: Request,
    key: str,
    detector: int = Query(3, ge=1, le=MAX_DETECTOR),
    span: float = Query(12.0, ge=1.0, le=60.0),
    step: float = Query(1.0, ge=0.25, le=20.0),
) -> Response:
    """Fixed-source-suppressed shift-and-stack score over a velocity grid.

    Float32 blob of ``nv * nv`` values, row j = vy index, column i = vx index,
    both ascending from ``-span`` to ``+span`` (vx positive = east).
    """
    _check_detector(detector)
    service.enforce_analysis_limit(request)
    cube, meta = _load_frames(key, detector)
    if cube.shape[0] < 3:
        raise HTTPException(400, "the motion map needs at least 3 frames")
    grid = _job(key).status().get("grid", {})
    pixscale = float(grid.get("pixscale_arcsec", config.DEFAULT_PIXSCALE))
    try:
        mm = tilt.motion_map(list(cube), [m["mjd"] for m in meta], pixscale,
                             span=span, step=step)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(
        content=np.ascontiguousarray(mm.score, dtype="<f4").tobytes(),
        media_type="application/octet-stream",
        headers={
            "X-Nv": str(mm.score.shape[1]),
            "X-Span": f"{float(mm.vxs[-1]):.4f}",
            "X-Step": f"{float(mm.vxs[1] - mm.vxs[0]):.4f}",
            "X-Best-Vx": f"{mm.best_vx:.4f}",
            "X-Best-Vy": f"{mm.best_vy:.4f}",
            "X-Best-Score": f"{mm.best_score:.4f}",
            "X-Zero-Score": f"{mm.zero_score:.4f}",
            "X-Best-X": str(mm.best_xy[0]),
            "X-Best-Y": str(mm.best_xy[1]),
            "X-Npix": str(cube.shape[1]),
            "X-Nsl": str(cube.shape[0]),
        },
    )


# ---------------------------------------------------------------------------
# Static frontend (built with `npm run build`).  API routes are registered first.
# ---------------------------------------------------------------------------
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/", service.CachedStatic(directory=str(DIST), html=True), name="frontend")


def main() -> None:
    import uvicorn

    # Local runs stay on 127.0.0.1; containers/hosts set SPHEREX_HOST=0.0.0.0 and PORT.
    host = os.environ.get("SPHEREX_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("backend.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
