"""Hardware bridge: a small WebSocket relay between physical devices and browsers.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Connect to ``/ws/hardware?role=device`` (an ESP32, or hardware/simulate_device.py) or
``/ws/hardware?role=browser`` (the default; the website).  Device messages are
validated and forwarded to every browser; browser messages go to every device.
Schema: hardware/EVENTS.md.  The site works fully with no hardware connected.

Who may connect:
* With a shared token set (env SPHEREX_HW_TOKEN, sent as ``?token=...``), every
  device needs it.
* With no token set, a device is accepted only from the same machine or the local
  network, so a public server never takes hardware events from strangers.
* A browser page must come from this site (its Origin must match the Host), from
  localhost, or from a site listed in SPHEREX_ALLOWED_ORIGINS.
* Each socket may send at most MAX_MESSAGES_PER_S messages per second.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import math
import os
import time
from urllib.parse import urlsplit
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

MAX_MESSAGE_BYTES = 1024
MAX_CONNECTIONS = 16
# Devices keep seats of their own, so a crowd of open web pages cannot lock the controller out.
MAX_DEVICES = 4
MAX_MESSAGES_PER_S = 60
_LOCAL_NAMES = ("localhost", "testclient")      # "testclient" is the in-process test client
MAX_OLED_LINES = 8
MAX_OLED_CHARS = 32

_DEVICE_BUTTONS = ("ask", "play", "reset")
_STATES = ("ready", "processing", "candidate")


def _num(value: Any, lo: float, hi: float) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < lo or value > hi:
        return None
    return float(value)


def validate_device_event(msg: Any) -> Optional[dict]:
    """Return a clean device->browser event, or None if it is not valid."""
    if not isinstance(msg, dict):
        return None
    kind = msg.get("type")
    if kind == "encoder":
        delta = msg.get("delta")
        if msg.get("id") != "time" or isinstance(delta, bool) or not isinstance(delta, int) \
                or not -20 <= delta <= 20 or delta == 0:
            return None
        return {"type": "encoder", "id": "time", "delta": delta}
    if kind == "button":
        if msg.get("id") not in _DEVICE_BUTTONS or msg.get("state") not in ("down", "up"):
            return None
        return {"type": "button", "id": msg["id"], "state": msg["state"]}
    if kind == "joystick":
        x, y = _num(msg.get("x"), -1, 1), _num(msg.get("y"), -1, 1)
        if x is None or y is None:
            return None
        return {"type": "joystick", "x": x, "y": y}
    if kind == "toggle":
        if msg.get("id") != "axis" or msg.get("value") not in ("time", "wave"):
            return None
        return {"type": "toggle", "id": "axis", "value": msg["value"]}
    return None


def validate_browser_event(msg: Any) -> Optional[dict]:
    """Return a clean browser->device event, or None if it is not valid."""
    if not isinstance(msg, dict):
        return None
    kind = msg.get("type")
    if kind == "led_ring":
        angle, sharp = _num(msg.get("angle_deg"), -360, 720), _num(msg.get("sharpness"), 0, 1)
        if angle is None or sharp is None:
            return None
        return {"type": "led_ring", "angle_deg": angle % 360.0, "sharpness": sharp}
    if kind == "status":
        if msg.get("state") not in _STATES:
            return None
        return {"type": "status", "state": msg["state"]}
    if kind == "oled":
        lines = msg.get("lines")
        if not isinstance(lines, list) or len(lines) > MAX_OLED_LINES \
                or not all(isinstance(s, str) for s in lines):
            return None
        return {"type": "oled", "lines": [s[:MAX_OLED_CHARS] for s in lines]}
    return None


class _Hub:
    def __init__(self) -> None:
        self.devices: set[WebSocket] = set()
        self.browsers: set[WebSocket] = set()

    async def send(self, targets: set[WebSocket], text: str) -> None:
        for ws in list(targets):
            try:
                await ws.send_text(text)
            except Exception:  # a dead socket must not stop the others
                targets.discard(ws)

    def count(self) -> int:
        return len(self.devices) + len(self.browsers)


hub = _Hub()


def _is_local(host: str) -> bool:
    if host in _LOCAL_NAMES:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _token_ok(given: Optional[str], role: str = "browser", host: str = "localhost") -> bool:
    # Only a device can drive the exhibit, so only a device needs the secret.  A browser page
    # is checked by its Origin instead; it has no safe place to keep a secret.
    if role != "device":
        return True
    expected = os.environ.get("SPHEREX_HW_TOKEN", "")
    if expected:
        return hmac.compare_digest((given or "").encode(), expected.encode())
    return _is_local(host)              # no token configured: local network only


def _origin_ok(ws: WebSocket) -> bool:
    """Browsers always send Origin; an ESP32 or a script does not (the token covers those)."""
    origin = ws.headers.get("origin")
    if not origin:
        return True
    allowed = [o.strip().rstrip("/") for o in os.environ.get("SPHEREX_ALLOWED_ORIGINS", "").split(",")]
    if origin.rstrip("/") in allowed:
        return True
    parts = urlsplit(origin)
    if parts.hostname and _is_local(parts.hostname):
        return True
    return bool(parts.netloc) and parts.netloc == ws.headers.get("host", "")


@router.websocket("/ws/hardware")
async def hardware_ws(ws: WebSocket, role: str = "browser", token: Optional[str] = None) -> None:
    from .service import forwarded_ip     # late import keeps the module order simple

    host = forwarded_ip(ws.headers, ws.client.host if ws.client else "unknown")
    full = (len(hub.devices) >= MAX_DEVICES if role == "device"
            else len(hub.browsers) >= MAX_CONNECTIONS - MAX_DEVICES)
    if (role not in ("device", "browser") or not _origin_ok(ws) or not _token_ok(token, role, host)
            or full):
        await ws.close(code=1008)
        return
    await ws.accept()
    mine, others = (hub.devices, hub.browsers) if role == "device" else (hub.browsers, hub.devices)
    mine.add(ws)
    # Tell browsers whether a device is present (they show it only with hw=1).
    await hub.send(hub.browsers, json.dumps({"type": "presence", "devices": len(hub.devices)}))
    window_start, sent = time.monotonic(), 0
    try:
        while True:
            text = await ws.receive_text()
            now = time.monotonic()
            if now - window_start >= 1.0:
                window_start, sent = now, 0
            sent += 1
            if sent > MAX_MESSAGES_PER_S:
                continue                    # too fast: drop without an answer
            clean = None
            if len(text.encode("utf-8")) <= MAX_MESSAGE_BYTES:
                try:
                    msg = json.loads(text)
                except ValueError:
                    msg = None
                clean = validate_device_event(msg) if role == "device" else validate_browser_event(msg)
            if clean is None:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid or oversized message"}))
                continue
            await hub.send(others, json.dumps(clean))
    except WebSocketDisconnect:
        pass
    finally:
        mine.discard(ws)
        await hub.send(hub.browsers, json.dumps({"type": "presence", "devices": len(hub.devices)}))
