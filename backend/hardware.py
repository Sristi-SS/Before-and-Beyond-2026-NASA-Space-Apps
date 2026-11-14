"""Hardware bridge: a small WebSocket relay between physical devices and browsers.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Connect to ``/ws/hardware?role=device`` (an ESP32, or hardware/simulate_device.py) or
``/ws/hardware?role=browser`` (the default; the website).  Device messages are
validated and forwarded to every browser; browser messages go to every device.
Schema: hardware/EVENTS.md.  Optional shared token: env SPHEREX_HW_TOKEN, sent
as ``?token=...``.  The site works fully with no hardware connected.
"""
from __future__ import annotations

import hmac
import json
import math
import os
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

MAX_MESSAGE_BYTES = 1024
MAX_CONNECTIONS = 16
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


def _token_ok(given: Optional[str]) -> bool:
    expected = os.environ.get("SPHEREX_HW_TOKEN", "")
    return not expected or hmac.compare_digest((given or "").encode(), expected.encode())


@router.websocket("/ws/hardware")
async def hardware_ws(ws: WebSocket, role: str = "browser", token: Optional[str] = None) -> None:
    if role not in ("device", "browser") or not _token_ok(token) or hub.count() >= MAX_CONNECTIONS:
        await ws.close(code=1008)
        return
    await ws.accept()
    mine, others = (hub.devices, hub.browsers) if role == "device" else (hub.browsers, hub.devices)
    mine.add(ws)
    # Tell browsers whether a device is present (they show it only with hw=1).
    await hub.send(hub.browsers, json.dumps({"type": "presence", "devices": len(hub.devices)}))
    try:
        while True:
            text = await ws.receive_text()
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
