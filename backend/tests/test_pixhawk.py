"""Stick mapping of hardware/pixhawk_reader.py (no Pixhawk, no network).

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from backend import hardware

_path = Path(__file__).resolve().parents[2] / "hardware" / "pixhawk_reader.py"
_spec = importlib.util.spec_from_file_location("pixhawk_reader", _path)
reader = importlib.util.module_from_spec(_spec)
sys.modules["pixhawk_reader"] = reader   # dataclasses look the module up by name
_spec.loader.exec_module(reader)

CENTRE = {1: 1500, 2: 1500, 4: 1500, 5: 1000, 6: 1000, 7: 1000}


def test_stick_scaling_and_dead_zone():
    assert reader.stick(1500) == 0.0
    assert reader.stick(1520) == 0.0            # inside the dead zone
    assert reader.stick(2000) == 1.0 and reader.stick(1000) == -1.0
    assert reader.stick(1750) == 0.5
    assert reader.stick(None) == 0.0 and reader.stick(0) == 0.0 and reader.stick(65535) == 0.0


def test_events_follow_the_schema_the_server_accepts():
    m = reader.StickMapper()
    assert m.events(dict(CENTRE), 0.0) == []     # centred sticks, first reading: nothing to send
    out = m.events({**CENTRE, 1: 2000, 2: 1000}, 1.0)          # right stick: full right, full forward
    assert out == [{"type": "joystick", "x": 1.0, "y": 1.0}]   # forward = north
    out = m.events({**CENTRE, 1: 2000, 2: 1000, 4: 2000}, 2.0)  # hold yaw right
    assert {"type": "encoder", "id": "time", "delta": 1} in out
    out = m.events({**CENTRE, 5: 2000, 6: 2000, 7: 2000}, 3.0)
    assert {"type": "toggle", "id": "axis", "value": "wave"} in out
    assert {"type": "button", "id": "ask", "state": "down"} in out
    assert {"type": "button", "id": "reset", "state": "down"} in out
    # A held switch does not repeat.
    again = m.events({**CENTRE, 5: 2000, 6: 2000, 7: 2000}, 3.5)
    assert not [e for e in again if e["type"] in ("button", "toggle")]
    # Every event passes the server's own validation.
    m2 = reader.StickMapper()
    m2.events(dict(CENTRE), 0.0)
    for t, pwm in enumerate(({**CENTRE, 1: 1800}, {**CENTRE, 4: 1000}, {**CENTRE, 5: 2000, 6: 2000}), start=1):
        for event in m2.events(pwm, float(t)):
            assert hardware.validate_device_event(event) is not None, event


def test_joystick_events_are_rate_limited():
    m = reader.StickMapper(joystick_hz=10.0)
    m.events(dict(CENTRE), 0.0)
    n = 0
    for k in range(100):                         # the stick moves on every one of 100 readings in 1 s
        n += sum(1 for e in m.events({**CENTRE, 1: 1600 + 4 * k}, 0.01 * k) if e["type"] == "joystick")
    assert n <= 11
