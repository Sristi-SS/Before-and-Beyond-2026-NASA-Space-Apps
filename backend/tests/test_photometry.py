"""Tests for the per-pixel photometry endpoint.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Synthetic frames in a temporary cache folder; no network.
"""
from __future__ import annotations

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import cache, config, extras, jobs

NPIX = 40
KEY = "0123456789abcdef0123"


def _star(npix, cx, cy, amp, sigma=1.2):
    yy, xx = np.mgrid[0:npix, 0:npix]
    return amp * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma ** 2))


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    rng = np.random.default_rng(3)
    fdir = cache.frames_dir(KEY)
    frames = []
    for i in range(4):
        data = rng.normal(0, 0.5, (NPIX, NPIX)).astype(np.float32) + 7.0  # flat sky level 7
        data += _star(NPIX, 20, 20, 100.0 * (i + 1)).astype(np.float32)
        np.save(fdir / f"{i:03d}.npy", data)
        mask = np.zeros((NPIX, NPIX), dtype=np.uint8)
        if i == 2:
            mask[20, 20] = 1  # a filled (saturated) core pixel
        if i != 3:  # frame 3 plays an "old" frame without a mask file
            np.save(fdir / f"{i:03d}.mask.npy", mask)
        frames.append({
            "index": i, "source": "spherex" if i < 3 else "wise", "obs_time": f"2026-0{i + 1}-01T00:00:00",
            "mjd": 61000.0 + 30 * i, "pass": 1, "detector": 3 if i < 3 else 101,
            "wavelength_um": 2.0 + 0.1 * i, "bandwidth_um": 0.02, "status": "ok",
        })
    state = {"key": KEY, "params": {}, "status": "done", "frames": frames,
             "grid": {"npix": NPIX, "pixscale_arcsec": 6.15, "center_ra": 120.0, "center_dec": 10.0}}
    cache.atomic_write_json(config.CACHE_DIR / "jobs" / KEY / "job.json", state)
    app = FastAPI()
    app.include_router(extras.router)
    return TestClient(app)


def test_recovers_flux_and_subtracts_sky(client):
    body = client.get(f"/api/jobs/{KEY}/photometry", params={"x": 20, "y": 20, "r": 3}).json()
    assert body["n"] == 4 and body["radius_px"] == 3
    fluxes = [f["flux"] for f in body["frames"]]
    # Gaussian sigma 1.2: sum within r=3 is a large fraction of 2*pi*sigma^2*amp.
    total = 2 * np.pi * 1.2 ** 2
    for i, flux in enumerate(fluxes):
        expect = 100.0 * (i + 1) * total
        assert 0.8 * expect < flux < 1.05 * expect  # sky level 7 would add ~200 if not subtracted
    assert all(f["flux_err"] > 0 for f in body["frames"])
    assert fluxes == sorted(fluxes)
    assert abs(body["ra_deg"] - 120.0) < 0.05 and abs(body["dec_deg"] - 10.0) < 0.05


def test_flags_and_units(client):
    body = client.get(f"/api/jobs/{KEY}/photometry", params={"x": 20, "y": 20}).json()
    flagged = [f["flagged"] for f in body["frames"]]
    assert flagged == [False, False, True, None]  # None = no mask file stored
    assert body["flag_info"] == "partly unknown"
    units = [f["units"] for f in body["frames"]]
    assert units[0].startswith("MJy/sr") and units[3].startswith("unWISE")
    assert [f["source"] for f in body["frames"]] == ["spherex"] * 3 + ["wise"]


def test_blank_position_is_consistent_with_zero(client):
    body = client.get(f"/api/jobs/{KEY}/photometry", params={"x": 6, "y": 33, "r": 2}).json()
    for f in body["frames"]:
        assert abs(f["flux"]) < 4 * f["flux_err"]


def test_validation(client):
    assert client.get("/api/jobs/not-a-key/photometry", params={"x": 1, "y": 1}).status_code == 404
    assert client.get("/api/jobs/ffffffffffffffffffff/photometry", params={"x": 1, "y": 1}).status_code == 404
    assert client.get(f"/api/jobs/{KEY}/photometry", params={"x": 1, "y": 1, "r": 7}).status_code == 422
    assert client.get(f"/api/jobs/{KEY}/photometry", params={"x": NPIX, "y": 1}).status_code == 422
    assert client.get(f"/api/jobs/{KEY}/photometry", params={"x": -1, "y": 1}).status_code == 422
    assert client.get(f"/api/jobs/{'../' * 5}/photometry", params={"x": 1, "y": 1}).status_code in (404, 405)


def test_edge_pixel_returns_null_not_crash(client):
    body = client.get(f"/api/jobs/{KEY}/photometry", params={"x": 0, "y": 0, "r": 6}).json()
    assert body["n"] == 4  # either measured or None, never an error
    for f in body["frames"]:
        assert f["flux"] is None or np.isfinite(f["flux"])
