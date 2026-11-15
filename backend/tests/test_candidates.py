"""Candidate search, patch model and the data-update check (no archive access).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
All images here are SYNTHETIC test data, made in the test.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import candidates, config, jobs, ranker, refresh, spherex

client = TestClient(app_module.app)
KEY = "0123456789abcdef0123"
PIX = 6.15


def _mover_frames(vx=8.0, vy=-5.0, n=12, npix=64, amp=40.0, seed=3):
    """SYNTHETIC frames: noise, two fixed stars, one mover with a known velocity."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:npix, 0:npix]
    # One frame per year: the mover must leave its pixel between frames, or the
    # temporal median removes it (a known limit for slow movers).
    mjds = [60000.0 + 365.0 * k for k in range(n)]
    frames = []
    for mjd in mjds:
        img = rng.normal(0.0, 1.0, (npix, npix))
        for sx, sy, a in ((15, 50, 300.0), (48, 12, 150.0)):
            img += a * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * 1.2 ** 2))
        x, y = candidates.path_pixel(40.0, 30.0, vx, vy, (mjd - mjds[0]) / 365.25, PIX)
        img += amp * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 1.1 ** 2))
        frames.append(img)
    return frames, mjds


def test_path_pixel_is_the_inverse_of_the_tilt_shift():
    from backend import tilt
    dy, dx = tilt.pixel_shifts(5.0, 2.0, 1.5, PIX)
    x, y = candidates.path_pixel(10.0, 10.0, 5.0, 2.0, 1.5, PIX)
    assert x + dx == pytest.approx(10.0) and y + dy == pytest.approx(10.0)


def test_the_planted_mover_is_the_first_candidate():
    frames, mjds = _mover_frames()
    found, mm = candidates.rank_candidates(frames, mjds, PIX, span=12.0, step=1.0, top=5)
    assert found, "no candidates"
    best = found[0]
    assert best["rank"] == 1
    assert abs(best["vx"] - 8.0) <= 1.0 and abs(best["vy"] + 5.0) <= 1.0
    assert abs(best["x"] - 40) <= 2 and abs(best["y"] - 30) <= 2
    assert best["patch_score"] > 0.5
    # No candidate sits at zero motion.
    assert all(abs(c["vx"]) > 1.0 or abs(c["vy"]) > 1.0 for c in found)


def test_patch_model_tells_a_point_source_from_a_hot_pixel():
    rng = np.random.default_rng(1)
    yy, xx = np.mgrid[0:31, 0:31]
    star = rng.normal(0, 1, (31, 31)) + 30 * np.exp(-((xx - 15) ** 2 + (yy - 15) ** 2) / (2 * 1.1 ** 2))
    hot = rng.normal(0, 1, (31, 31))
    hot[15, 15] += 30
    assert ranker.patch_score(star, 15, 15) > 0.8
    assert ranker.patch_score(hot, 15, 15) < 0.3
    info = ranker.info()
    assert info["parameters"] < 2000
    assert info["validation_accuracy_on_simulated"] > 0.9
    assert "simulated" in info["trained_on"]


def _write_job(tmp_path, frames, mjds, detector=3):
    root = tmp_path / "jobs" / KEY
    (root / "frames").mkdir(parents=True)
    metas = []
    for i, (img, mjd) in enumerate(zip(frames, mjds)):
        np.save(root / "frames" / f"{i:03d}.npy", img)
        metas.append({"id": f"obs{i}_D{detector}", "index": i, "source": "spherex", "status": "ok",
                      "detector": detector, "mjd": mjd, "obs_time": "2025-01-01T00:00:00"})
    params = {"name": "", "ra": 10.0, "dec": 0.0, "fov": 0.2}
    state = {"key": KEY, "status": "done", "updated": time.time(), "params": params, "frames": metas,
             "target": {"name": "Synthetic test field", "search_ra_deg": 10.0, "search_dec_deg": 0.0},
             "grid": {"npix": frames[0].shape[0], "pixscale_arcsec": PIX, "center_ra": 10.0, "center_dec": 0.0}}
    (root / "job.json").write_text(json.dumps(state), encoding="utf-8")
    return state


def test_candidates_endpoint_gives_a_path_and_sky_positions(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    frames, mjds = _mover_frames()
    _write_job(tmp_path, frames, mjds)
    r = client.get(f"/api/jobs/{KEY}/candidates", params={"detector": 3, "top": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Candidates only" in body["caution"]
    c = body["candidates"][0]
    assert len(c["path"]) == len(frames) and all(p["used"] for p in c["path"])
    first, last = c["path"][0], c["path"][-1]
    assert first["x"] == pytest.approx(c["x"]) and first["y"] == pytest.approx(c["y"])
    # East (+vx) is towards smaller x; south (-vy) is towards smaller row.
    assert last["x"] < first["x"] and last["y"] < first["y"]
    assert abs(c["ra_deg"] - 10.0) < 0.2 and abs(c["dec_deg"]) < 0.2
    assert "inside" in c["today"]
    assert client.get(f"/api/jobs/{KEY}/candidates", params={"detector": 7}).status_code == 422
    assert client.get("/api/jobs/zz/candidates", params={"detector": 3}).status_code == 404


def _plane(obs, t):
    return spherex.Plane(obs, 3, "spherex_qr9", 10.0, 0.0, 3.5, 1e-6, 2e-6, t, t + 0.001, "")


def test_update_check_counts_only_images_newer_than_the_cube(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    monkeypatch.setattr(refresh, "_checks", {})
    monkeypatch.setattr(refresh.service, "archive_ok", lambda: True)
    frames, mjds = _mover_frames(n=4)
    _write_job(tmp_path, frames, mjds)
    newest = max(mjds)
    planes = [_plane("old", newest - 100), _plane("same", newest), _plane("n1", newest + 30.0),
              _plane("n2", newest + 30.2), _plane("n3", newest + 200.0)]
    monkeypatch.setattr(spherex, "cone_search", lambda ra, dec, radius, maxrec=5000: planes)
    body = client.get(f"/api/jobs/{KEY}/updates").json()
    assert body["has_news"] is True
    assert body["new_images"] == 3 and body["new_nights"] == 2
    assert body["frames_in_cube"] == 4 and body["archive_images"] == 5
    assert body["new_collections"] == ["spherex_qr9"]
    assert "built" not in body
    # Nothing newer: no news.
    monkeypatch.setattr(refresh, "_checks", {})
    monkeypatch.setattr(spherex, "cone_search", lambda ra, dec, radius, maxrec=5000: planes[:2])
    assert client.get(f"/api/jobs/{KEY}/updates").json()["has_news"] is False
    assert client.get("/api/jobs/zz/updates").status_code == 404
    # Archive down: the answer is fast and clear, and a rebuild is refused.
    monkeypatch.setattr(refresh.service, "archive_ok", lambda: False)
    assert client.get(f"/api/jobs/{KEY}/updates").json() == {"key": KEY, "offline": True, "has_news": False}
    assert client.get(f"/api/jobs/{KEY}/updates", params={"fresh": "true"}).status_code == 503
    assert client.post(f"/api/jobs/{KEY}/refresh").status_code == 503


def test_failed_update_keeps_the_old_cube(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    frames, mjds = _mover_frames(n=4)
    state = _write_job(tmp_path, frames, mjds)
    key = jobs.job_key(state["params"])
    # Move the synthetic job to the key its parameters hash to.
    (tmp_path / "jobs" / KEY).rename(tmp_path / "jobs" / key)
    path = tmp_path / "jobs" / key / "job.json"
    path.write_text(json.dumps(dict(state, key=key)), encoding="utf-8")

    def archive_down(*args, **kwargs):
        raise RuntimeError("archive down")
    monkeypatch.setattr(spherex, "search_and_fetch", archive_down)
    job = refresh.rebuild(key)
    for _ in range(100):
        final = json.loads(path.read_text(encoding="utf-8"))
        if final.get("refresh_error"):
            break
        time.sleep(0.1)
    assert final["status"] == "done" and len(final["frames"]) == 4
    assert "old cube was kept" in final["refresh_error"]
    assert (tmp_path / "jobs" / key / "frames" / "000.npy").exists()
    assert job.key == key


def test_visitors_cannot_rebuild_a_saved_cube(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    monkeypatch.setattr(refresh.service, "archive_ok", lambda: True)
    monkeypatch.delenv("SPHEREX_ADMIN_TOKEN", raising=False)
    refresh.service.limiter.reset()
    frames, mjds = _mover_frames(n=4)
    _write_job(tmp_path, frames, mjds)
    started = []
    monkeypatch.setattr(refresh, "rebuild", lambda key: started.append(key) or jobs.manager.get(key))
    # A visitor (the request came through a proxy): refused, and nothing starts.
    r = client.post(f"/api/jobs/{KEY}/refresh", headers={"x-forwarded-for": "8.8.8.8"})
    assert r.status_code == 403 and not started
    assert client.get("/api/status", headers={"x-forwarded-for": "8.8.8.8"}).json()["refresh"] == "locked"
    # With a token set, only the token opens it, from anywhere.
    monkeypatch.setenv("SPHEREX_ADMIN_TOKEN", "s3cret")
    assert client.post(f"/api/jobs/{KEY}/refresh").status_code == 403
    assert client.post(f"/api/jobs/{KEY}/refresh", headers={"x-admin-token": "wrong"}).status_code == 403
    r = client.post(f"/api/jobs/{KEY}/refresh", headers={"x-admin-token": "s3cret", "x-forwarded-for": "8.8.8.8"})
    assert r.status_code == 200 and started == [KEY]
    assert client.get("/api/status").json()["refresh"] == "locked"
    assert client.get("/api/status", headers={"x-admin-token": "s3cret"}).json()["refresh"] == "open"
    refresh.service.limiter.reset()


def test_map_and_candidates_share_one_computation(tmp_path, monkeypatch):
    from backend import tilt
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "manager", jobs.JobManager())
    refresh.service.analysis_limiter.reset()
    frames, mjds = _mover_frames()
    _write_job(tmp_path, frames, mjds)
    calls = []
    real = tilt.motion_map
    monkeypatch.setattr(tilt, "motion_map", lambda *a, **k: calls.append(1) or real(*a, **k))
    a = client.get(f"/api/jobs/{KEY}/motionmap", params={"detector": 3})
    b = client.get(f"/api/jobs/{KEY}/candidates", params={"detector": 3})
    assert a.status_code == 200 and b.status_code == 200, (a.text[:200], b.text[:200])
    assert len(calls) == 1
    assert a.headers["cache-control"].startswith("public")
    # A grid above the size limit is refused before any work is done.
    r = client.get(f"/api/jobs/{KEY}/motionmap", params={"detector": 3, "span": 60, "step": 1})
    assert r.status_code == 400 and len(calls) == 1
    refresh.service.analysis_limiter.reset()
