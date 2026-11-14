"""Rate limit, /api/status, gzip and the hardware relay.  No network.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module, hardware, jobs, service

client = TestClient(app_module.app)


class FakeJob:
    key = "0" * 20

    def __init__(self, status="queued"):
        self._status = status

    def status(self):
        return {"key": self.key, "status": self._status, "frames": []}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    service.limiter.reset()
    service.reset_ping()
    monkeypatch.setattr(service, "RATE_MAX", 2)
    yield
    service.limiter.reset()


def test_rate_limit_counts_only_new_builds(monkeypatch):
    monkeypatch.setattr(jobs.manager, "get", lambda key: None)
    monkeypatch.setattr(jobs.manager, "submit", lambda params, force=False: FakeJob())
    body = {"name": "Barnard's Star"}
    assert client.post("/api/jobs", json=body).status_code == 200
    assert client.post("/api/jobs", json=body).status_code == 200
    r = client.post("/api/jobs", json=body)
    assert r.status_code == 429
    assert "Too many new cube builds" in r.json()["detail"]
    assert "retry-after" in r.headers


def test_cached_done_jobs_are_not_counted(monkeypatch):
    monkeypatch.setattr(jobs.manager, "get", lambda key: FakeJob("done"))
    monkeypatch.setattr(jobs.manager, "submit", lambda params, force=False: FakeJob("done"))
    for _ in range(6):
        assert client.post("/api/jobs", json={"name": "Barnard's Star"}).status_code == 200


def test_status_offline(monkeypatch):
    monkeypatch.setattr(service, "_probe_archive", lambda: False)
    data = client.get("/api/status").json()
    assert data["mode"] == "offline-cache" and data["archive_ok"] is False
    assert isinstance(data["cached_targets"], int) and isinstance(data["active_jobs"], int)


def test_status_online_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(service, "_probe_archive", lambda: calls.append(1) or True)
    assert client.get("/api/status").json()["mode"] == "online"
    assert client.get("/api/status").json()["archive_ok"] is True
    assert len(calls) == 1  # second request used the cached ping


def test_json_is_gzipped():
    r = client.get("/api/targets", headers={"accept-encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


# ---------------------------------------------------------------- hardware
def test_validators():
    assert hardware.validate_device_event({"type": "encoder", "id": "time", "delta": -1})
    assert not hardware.validate_device_event({"type": "encoder", "id": "time", "delta": 0})
    assert not hardware.validate_device_event({"type": "joystick", "x": 2, "y": 0})
    assert not hardware.validate_device_event({"type": "joystick", "x": float("nan"), "y": 0})
    assert hardware.validate_device_event({"type": "toggle", "id": "axis", "value": "wave"})
    assert not hardware.validate_device_event({"type": "led_ring"})
    assert hardware.validate_browser_event({"type": "led_ring", "angle_deg": -90, "sharpness": 0.5})["angle_deg"] == 270
    assert not hardware.validate_browser_event({"type": "status", "state": "bogus"})


def test_relay_between_two_clients():
    with client.websocket_connect("/ws/hardware?role=browser") as browser:
        assert browser.receive_json() == {"type": "presence", "devices": 0}
        with client.websocket_connect("/ws/hardware?role=device") as device:
            assert browser.receive_json() == {"type": "presence", "devices": 1}
            device.send_text(json.dumps({"type": "encoder", "id": "time", "delta": 1}))
            assert browser.receive_json() == {"type": "encoder", "id": "time", "delta": 1}
            device.send_text(json.dumps({"type": "joystick", "x": 0.5, "y": -1}))
            assert browser.receive_json()["type"] == "joystick"
            # invalid and oversized messages are rejected, not relayed
            device.send_text("not json")
            assert device.receive_json()["type"] == "error"
            device.send_text(json.dumps({"type": "oled", "lines": ["x" * 2000]}))
            assert device.receive_json()["type"] == "error"
            # browser -> device
            browser.send_text(json.dumps({"type": "status", "state": "candidate"}))
            assert device.receive_json() == {"type": "status", "state": "candidate"}
            browser.send_text(json.dumps({"type": "led_ring", "angle_deg": 10, "sharpness": 1}))
            assert device.receive_json()["type"] == "led_ring"
            # a browser may not inject device events
            browser.send_text(json.dumps({"type": "encoder", "id": "time", "delta": 1}))
            assert browser.receive_json()["type"] == "error"


def test_token_required_when_configured(monkeypatch):
    monkeypatch.setenv("SPHEREX_HW_TOKEN", "s3cret")
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/hardware?role=device"):
            pass
    with client.websocket_connect("/ws/hardware?role=device&token=s3cret"):
        pass
