"""Hardening checks: who may open the hardware socket, and the limits on heavy work.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import hardware, service
from backend.app import app

client = TestClient(app)


def test_device_without_token_must_be_local(monkeypatch):
    monkeypatch.delenv("SPHEREX_HW_TOKEN", raising=False)
    assert hardware._token_ok(None, "device", "192.168.1.20")
    assert hardware._token_ok(None, "device", "127.0.0.1")
    assert not hardware._token_ok(None, "device", "8.8.8.8")
    assert not hardware._token_ok(None, "device", "unknown")
    assert hardware._token_ok(None, "browser", "8.8.8.8")
    monkeypatch.setenv("SPHEREX_HW_TOKEN", "s3cret")
    assert not hardware._token_ok(None, "device", "127.0.0.1")
    assert hardware._token_ok("s3cret", "device", "8.8.8.8")
    assert hardware._token_ok(None, "browser", "8.8.8.8")      # the website needs no secret


def test_public_device_is_refused_behind_a_proxy(monkeypatch):
    monkeypatch.delenv("SPHEREX_HW_TOKEN", raising=False)
    monkeypatch.setenv("SPHEREX_TRUST_PROXY", "1")
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/hardware?role=device", headers={"x-forwarded-for": "8.8.8.8"}):
            pass


def test_foreign_web_page_cannot_open_the_socket():
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/hardware?role=browser", headers={"origin": "https://evil.example"}):
            pass
    with client.websocket_connect("/ws/hardware?role=browser", headers={"origin": "http://testserver"}):
        pass
    with client.websocket_connect("/ws/hardware?role=browser", headers={"origin": "http://localhost:5173"}):
        pass


def test_forwarded_address_is_read_from_the_right(monkeypatch):
    headers = {"x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3"}
    monkeypatch.delenv("SPHEREX_TRUST_PROXY", raising=False)
    assert service.forwarded_ip(headers, "9.9.9.9") == "9.9.9.9"
    monkeypatch.setenv("SPHEREX_TRUST_PROXY", "1")
    assert service.forwarded_ip(headers, "9.9.9.9") == "3.3.3.3"      # the faked left side is ignored
    monkeypatch.setenv("SPHEREX_PROXY_HOPS", "2")
    assert service.forwarded_ip(headers, "9.9.9.9") == "2.2.2.2"


def test_limiter_memory_stays_bounded():
    lim = service.RateLimiter(3, 60.0)
    lim.MAX_ADDRESSES = 100
    for i in range(5000):
        lim.check(f"10.0.{i // 250}.{i % 250}", now=float(i) * 0.001)
    assert len(lim._hits) <= 101
    # old addresses go away once their window is over
    lim.check("late", now=1000.0)
    assert set(lim._hits) == {"late"}


def test_analysis_limit():
    service.analysis_limiter.reset()
    try:
        # an unknown job costs nothing and is not counted
        for _ in range(3):
            assert client.get("/api/jobs/" + "0" * 20 + "/candidates", params={"detector": 3}).status_code == 404
        for _ in range(service.ANALYSIS_MAX):
            assert service.analysis_limiter.check("testclient") == 0.0
        assert service.analysis_limiter.check("testclient") > 0
        # a real saved job now answers 429 for a search
        listed = client.get("/api/jobs").json()
        jobs_list = listed.get("jobs", listed) if isinstance(listed, dict) else listed
        if jobs_list:
            key = jobs_list[0]["key"]
            assert client.get(f"/api/jobs/{key}/motionmap", params={"detector": 3}).status_code in (429, 422)
    finally:
        service.analysis_limiter.reset()
