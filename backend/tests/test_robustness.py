"""Robustness checks for the public service (no archive access).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import json
import math
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import config, jobs, resolve, spherex

client = TestClient(app_module.app)

KEY = "0123456789abcdef0123"


def test_health_does_not_leak_local_paths():
    body = client.get("/api/health").json()
    assert "cache_dir" not in body


@pytest.mark.parametrize("key", ["..", "%2e%2e", "a" * 19, "A" * 20, "x" * 20, "a" * 21])
def test_job_key_shape_is_checked(key):
    assert client.get(f"/api/jobs/{key}").status_code == 404
    assert client.get(f"/api/jobs/{key}/contact_sheet.png").status_code == 404


def test_out_of_range_coordinates_are_rejected():
    assert client.post("/api/jobs", json={"ra": 400.0, "dec": 0.0}).status_code == 422
    assert client.post("/api/jobs", json={"ra": 10.0, "dec": -95.0}).status_code == 422
    assert client.post("/api/jobs", json={"name": "x" * 200}).status_code == 422
    bad_release = {"ra": 10.0, "dec": 0.0, "release": "not-a-release"}
    assert client.post("/api/jobs", json=bad_release).status_code == 400


def test_public_status_hides_tracebacks_and_paths():
    job = jobs.Job(key=KEY, params={}, state={
        "status": "error", "error": "boom", "traceback": "C:/secret/path.py line 1",
        "downloads": [{"id": "x"}], "contact_sheet": "C:/secret/contact_sheet.png",
    })
    public = app_module._public_status(job)
    assert "traceback" not in public and "downloads" not in public
    assert public["contact_sheet"] is True
    assert "secret" not in json.dumps(public)


def _write_job(tmp_path, status, updated):
    path = tmp_path / "jobs" / KEY / "job.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"key": KEY, "status": status, "updated": updated,
                                "params": {}, "frames": []}), encoding="utf-8")


def test_interrupted_job_reads_as_error_not_running(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    _write_job(tmp_path, "running", 0.0)
    state = jobs.JobManager().get(KEY).status()
    assert state["status"] == "error"
    assert "interrupted" in state["error"]


def test_job_built_by_another_process_stays_running(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    _write_job(tmp_path, "running", time.time())
    manager = jobs.JobManager()
    assert manager.get(KEY).status()["status"] == "running"
    # The other process finishes; the next read must see it.
    (tmp_path / "jobs" / KEY / "job.json").write_text(
        json.dumps({"key": KEY, "status": "done", "params": {}, "frames": []}), encoding="utf-8")
    assert manager.get(KEY).status()["status"] == "done"


def test_the_five_targets_resolve_without_the_network(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("network used")
    monkeypatch.setattr(httpx, "Client", no_network)
    for key in resolve.TEST_TARGET_KEYS:
        name = resolve.BUILTIN_TARGETS[key].name
        assert resolve.resolve_name(name).name == name


def test_wise0855_motion_reproduces_the_brief_position():
    """The brief position is the ~2010.5 WISE epoch of the SIMBAD J2000 entry."""
    target = resolve.BUILTIN_TARGETS["wise0855"]
    brief_ra, brief_dec = resolve.parse_coordinates("08h55m10.831s", "-7 14 42.53")
    ra, dec = target.at_year(2010.45)
    sep = math.hypot((ra - brief_ra) * math.cos(math.radians(dec)), dec - brief_dec) * 3600
    assert sep < 3.0, sep
    # By the SPHEREx epochs it is about two arcminutes west of the brief position.
    ra26, _ = target.at_year(2026.0)
    assert 100 < (brief_ra - ra26) * math.cos(math.radians(dec)) * 3600 < 150


def test_negative_sexagesimal_declination_keeps_its_sign():
    _, dec = resolve.parse_coordinates("08h55m10.831s", "-0 30 00")
    assert dec == pytest.approx(-0.5)


def _row(obs_id, collection, detector=3):
    return {
        "obs_id": obs_id, "s_ra": "10.0", "s_dec": "0.0", "s_fov": "3.5",
        "em_min": "1e-6", "em_max": "2e-6", "t_min": "60800.0", "t_max": "60800.1",
        "access_url": f"https://x/datalink?ID=ivo://irsa.ipac/{collection}?{obs_id}/D{detector}",
    }


def test_same_exposure_in_two_collections_is_kept_once(monkeypatch):
    rows = [_row("2025W20_1A_0001_3", "spherex_qr3"), _row("2025W20_1A_0001_3", config.RELEASE),
            _row("2025W21_1A_0002_3", "spherex_qr3")]
    monkeypatch.setattr(spherex, "tap_query", lambda adql, maxrec=5000: rows)
    planes = spherex.cone_search(10.0, 0.0, 1.0)
    assert len(planes) == 2
    by_id = {p.obs_id: p.collection for p in planes}
    assert by_id["2025W20_1A_0001_3"] == config.RELEASE
    assert by_id["2025W21_1A_0002_3"] == "spherex_qr3"


def test_masked_core_is_filled_but_outside_stays_zero():
    """A saturated (NaN + flagged) star core is interpolated, not left black."""
    import numpy as np
    from backend import align

    npix = 64
    grid = align.make_grid(10.0, 0.0, npix, 6.15)
    # The input covers only the left part of the grid (same scale, shifted).
    in_wcs = align.make_grid(10.0, 0.0, npix, 6.15)
    in_wcs.wcs.crpix = [npix / 2 + 0.5 + 16, npix / 2 + 0.5]
    yy, xx = np.mgrid[0:npix, 0:npix]
    image = 5.0 + 200.0 * np.exp(-((xx - 30) ** 2 + (yy - 32) ** 2) / (2 * 3.0 ** 2))
    flags = np.full((npix, npix), 1 << 21, dtype=np.int64)   # SOURCE: benign
    core = (xx - 30) ** 2 + (yy - 32) ** 2 <= 4
    image[core] = np.nan
    flags[core] |= (1 << 1) | (1 << 26)                       # OVERFLOW, BLOOM

    out = align.align_frame(image, flags, None, in_wcs, grid, npix)
    assert out is not None
    assert 0.5 < out.coverage < 0.9          # the NaN core does not shrink coverage
    cy, cx = np.unravel_index(np.argmax(out.data), out.data.shape)
    assert out.mask[32, 14] and out.data[32, 14] > 20.0      # core: masked but filled
    assert abs(cx - 14) <= 3 and abs(cy - 32) <= 3
    assert np.all(out.data[:, -8:] == 0.0)                   # outside the detector
    assert 0.0 < out.masked_fraction < 0.5


def test_thinning_keeps_every_pass():
    planes = [
        spherex.Plane(f"o{i}", 3, "c", 0, 0, 3.5, 0, 0, t, t, "")
        for i, t in enumerate([60800 + 0.01 * k for k in range(30)] + [60990.0, 61170.0])
    ]
    kept = spherex._thin_by_time(planes, 6)
    assert len(kept) == 6
    assert {60990.0, 61170.0} <= {p.t_min for p in kept}
