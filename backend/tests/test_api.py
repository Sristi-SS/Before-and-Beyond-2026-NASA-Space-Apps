"""API smoke tests (no archive access).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend import app as app_module


client = TestClient(app_module.app)


def test_health_reports_release():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["release"]


def test_targets_include_the_five_objects():
    response = client.get("/api/targets")
    assert response.status_code == 200
    names = {t["name"] for t in response.json()["targets"]}
    assert {"Barnard's Star", "Epsilon Indi B", "WISE 0855", "RW Aurigae", "R Draconis"} <= names


def test_job_requires_a_name_or_coordinates():
    response = client.post("/api/jobs", json={"fov": 0.2})
    assert response.status_code == 400


def test_unknown_job_is_404():
    assert client.get("/api/jobs/does-not-exist").status_code == 404


def test_tilt_static_param_validated_and_applied(monkeypatch):
    """/tilt?static=median subtracts the fixed sky; bad values are rejected."""
    import numpy as np

    n, npix = 6, 32
    yy, xx = np.mgrid[0:npix, 0:npix]
    cube = np.stack([300.0 * np.exp(-((xx - 10) ** 2 + (yy - 10) ** 2) / 4.0) + 5.0
                     for _ in range(n)]).astype(np.float32)
    metas = [{"mjd": 55500.0 + 180.0 * k, "index": k} for k in range(n)]

    class FakeJob:
        def status(self):
            return {"grid": {"pixscale_arcsec": 6.15}, "status": "done"}

    monkeypatch.setattr(app_module, "_job", lambda key: FakeJob())
    monkeypatch.setattr(app_module, "_load_frames", lambda key, det: (cube, metas))
    key = "a" * 20
    plain = client.get(f"/api/jobs/{key}/tilt?detector=102&static=none")
    clean = client.get(f"/api/jobs/{key}/tilt?detector=102&static=median")
    assert plain.status_code == 200 and clean.status_code == 200
    assert float(plain.headers["X-Max"]) > 100.0       # the fixed star is in the plain stack
    assert abs(float(clean.headers["X-Max"])) < 1e-3   # identical frames: nothing but the fixed sky
    assert client.get(f"/api/jobs/{key}/tilt?detector=102&static=bogus").status_code == 422
