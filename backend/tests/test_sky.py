"""Sky-globe endpoints (no network).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from backend import app as app_module, config, extras

client = TestClient(app_module.app)


def test_resolve_builtin_name_needs_no_network():
    r = client.get("/api/resolve", params={"name": "Barnard's Star"})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "name"
    assert abs(body["ra_deg"] - 269.452) < 0.01 and abs(body["dec_deg"] - 4.693) < 0.01


def test_resolve_coordinates_decimal_and_sexagesimal():
    r = client.get("/api/resolve", params={"name": "269.45 4.69"})
    assert r.status_code == 200 and r.json()["kind"] == "coordinates"
    r = client.get("/api/resolve", params={"name": "17h57m48.5s +04 41 36"})
    assert r.status_code == 200
    body = r.json()
    assert abs(body["ra_deg"] - 269.4521) < 0.001 and abs(body["dec_deg"] - 4.6933) < 0.001


def test_resolve_rejects_bad_input():
    assert client.get("/api/resolve", params={"name": "x" * 81}).status_code == 400
    assert client.get("/api/resolve", params={"name": "   "}).status_code == 400
    r = client.get("/api/resolve", params={"name": "400 95"})
    assert r.status_code == 400 and "range" in r.json()["detail"]


def test_resolve_unknown_name_has_clear_error(monkeypatch):
    def boom(name):
        raise LookupError(name)

    monkeypatch.setattr(extras.resolve, "resolve_name", boom)
    r = client.get("/api/resolve", params={"name": "zzzz not a star"})
    assert r.status_code == 404 and "Nothing found" in r.json()["detail"]


def test_bright_stars_fall_back_when_network_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(extras, "_stars_retry_after", 0.0)

    def fail():
        raise OSError("no network")

    monkeypatch.setattr(extras, "_fetch_hipparcos", fail)
    body = client.get("/api/sky/bright_stars").json()
    assert body["source"] == "fallback" and body["n"] == 25
    assert all(0 <= s["ra_deg"] < 360 and -90 <= s["dec_deg"] <= 90 for s in body["stars"])


def test_bright_stars_are_cached_on_disk(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    payload = {
        "metadata": [{"name": n} for n in ("HIP", "RAICRS", "DEICRS", "Vmag")],
        "data": [[32349, 101.2, -16.7, -1.44], [1, 0.0, 1.0, None], [11767, 37.9, 89.2, 2.0]],
    }
    stars = extras.parse_vizier_stars(payload)
    assert [s["name"] for s in stars] == ["Sirius", "Polaris"]
    data = {"source": "hipparcos", "catalogue": "t", "max_mag": 4.5, "n": 2, "stars": stars}
    monkeypatch.setattr(extras, "_fetch_hipparcos", lambda: data)
    assert client.get("/api/sky/bright_stars").json()["source"] == "hipparcos"
    assert (tmp_path / "sky" / "bright_stars.json").is_file()
    monkeypatch.setattr(extras, "_fetch_hipparcos", lambda: (_ for _ in ()).throw(OSError()))
    assert client.get("/api/sky/bright_stars").json()["source"] == "hipparcos"


def test_jobs_list_is_light_and_done_only(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    good, busy = "a" * 20, "b" * 20
    state = {
        "key": good, "status": "done", "params": {"fov": 0.2},
        "target": {"name": "Test Star", "ra_deg": 10.0, "dec_deg": -5.0},
        "grid": {"center_ra": 10.1, "center_dec": -5.0, "fov_arcsec": 720},
        "frames": [{"source": "spherex", "status": "ok"}, {"source": "spherex"}, {"source": "wise"}],
        "wise": {"n": 1}, "downloads": ["C:/secret/path.fits"],
    }
    for key, st in ((good, state), (busy, dict(state, key=busy, status="running"))):
        d = tmp_path / "jobs" / key
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps(st), encoding="utf-8")
    jobs_ = client.get("/api/jobs").json()["jobs"]
    assert len(jobs_) == 1
    j = jobs_[0]
    assert j["key"] == good and j["n_spherex"] == 2 and j["n_wise"] == 1 and j["status"] == "done"
    assert "downloads" not in j and "secret" not in json.dumps(j)
