"""Pixhawk input reader: fly the tilt with the radio sticks.  OPTIONAL.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

STATUS: the stick mapping (``StickMapper``) is unit-tested and the ``--simulate``
mode is tested against the server.  The MAVLink link to a real Pixhawk is
UNTESTED: no flight controller was available.  Test it on the bench before a demo.

What it does
    A Pixhawk flight controller sends the positions of the radio sticks as
    MAVLink ``RC_CHANNELS`` messages (pulse widths, about 1000 to 2000
    microseconds, 1500 = centre).  This script reads them and sends the
    hardware events of ``hardware/EVENTS.md`` to the site:

        right stick (roll, pitch)   -> joystick x, y  = trial motion direction and speed
        left stick, sideways (yaw)  -> encoder        = step through the timeline
        left stick, up/down (throttle) is NOT used (a throttle stick does not spring back)
        switch channel 5            -> toggle axis    = stack by time / by wavelength
        switch channel 6 (flick up) -> button "ask"   = Find best motion
        switch channel 7 (flick up) -> button "reset" = Zero motion

    It only READS from the Pixhawk.  It never arms it and never sends a command.
    Take the propellers off anyway.

Install (only for the real link; --simulate needs nothing extra):

    pip install pymavlink

Run (open the site with ?hw=1 first):

    python hardware/pixhawk_reader.py --device COM7 --baud 57600
    python hardware/pixhawk_reader.py --device /dev/ttyACM0            # Jetson / Linux, USB
    python hardware/pixhawk_reader.py --device udp:0.0.0.0:14550       # telemetry over UDP
    python hardware/pixhawk_reader.py --simulate                       # no Pixhawk: fake sticks

Set SPHEREX_HW_TOKEN if the server needs a token.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import time
from dataclasses import dataclass, field
from typing import Iterator, Optional

PWM_MIN, PWM_MID, PWM_MAX = 1000.0, 1500.0, 2000.0


def stick(pwm: Optional[float], deadzone: float = 0.08) -> float:
    """Pulse width (microseconds) to -1..1.  Missing or impossible values read as centre."""
    if pwm is None or not math.isfinite(pwm) or pwm < 800 or pwm > 2200:
        return 0.0
    v = max(-1.0, min(1.0, (pwm - PWM_MID) / (PWM_MAX - PWM_MID)))
    return 0.0 if abs(v) < deadzone else round(v, 2)


@dataclass
class Channels:
    """Which RC channel does what (1-based, the usual AETR order by default)."""
    roll: int = 1
    pitch: int = 2
    yaw: int = 4
    axis_switch: int = 5
    ask_switch: int = 6
    reset_switch: int = 7


@dataclass
class StickMapper:
    """Turn a stream of RC channel values into hardware events (no input/output here)."""
    channels: Channels = field(default_factory=Channels)
    joystick_hz: float = 8.0       # at most this many joystick events per second
    encoder_hz: float = 6.0        # timeline steps per second at full yaw
    _last_xy: tuple[float, float] = (0.0, 0.0)
    _last_joy_t: float = -1e9
    _enc_t: float = -1e9
    _axis: Optional[str] = None
    _high: dict = field(default_factory=dict)

    def events(self, pwm: dict[int, float], now: float) -> list[dict]:
        """``pwm`` maps channel number to pulse width.  Returns the events to send, in order."""
        c = self.channels
        out: list[dict] = []

        # Right stick: pitch forward (low pulse on most radios) means north, so y is flipped.
        x, y = stick(pwm.get(c.roll)), -stick(pwm.get(c.pitch))
        if (x, y) != self._last_xy and now - self._last_joy_t >= 1.0 / self.joystick_hz:
            out.append({"type": "joystick", "x": x, "y": y if y != 0 else 0.0})
            self._last_xy, self._last_joy_t = (x, y), now

        # Yaw: hold the stick to scrub the timeline; farther = faster.
        yaw = stick(pwm.get(c.yaw), deadzone=0.25)
        if yaw != 0.0 and now - self._enc_t >= 1.0 / (self.encoder_hz * abs(yaw)):
            out.append({"type": "encoder", "id": "time", "delta": 1 if yaw > 0 else -1})
            self._enc_t = now

        # Two-position switch: low = stack by time, high = stack by wavelength.
        raw = pwm.get(c.axis_switch)
        if raw is not None and 800 <= raw <= 2200:
            axis = "wave" if raw > 1700 else "time" if raw < 1300 else self._axis
            if axis is not None and axis != self._axis:
                if self._axis is not None:          # do not fire on the first reading
                    out.append({"type": "toggle", "id": "axis", "value": axis})
                self._axis = axis

        # Momentary switches: one event when the switch goes up.
        for ch, button in ((c.ask_switch, "ask"), (c.reset_switch, "reset")):
            raw = pwm.get(ch)
            high = raw is not None and 1700 < raw <= 2200
            if high and self._high.get(ch) is False:
                out.append({"type": "button", "id": button, "state": "down"})
            if raw is not None:
                self._high[ch] = high
        return out


def read_pixhawk(device: str, baud: int) -> Iterator[dict[int, float]]:
    """Yield channel maps from a real Pixhawk.  UNTESTED on hardware."""
    try:
        from pymavlink import mavutil
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise SystemExit("pymavlink is not installed. Run: pip install pymavlink") from exc
    link = mavutil.mavlink_connection(device, baud=baud)
    print("waiting for a heartbeat from", device, "...")
    link.wait_heartbeat(timeout=30)
    print("heartbeat received (system", link.target_system, ")")
    # Ask for the RC channel stream at 20 Hz.  This is a telemetry request, not a control command.
    link.mav.request_data_stream_send(link.target_system, link.target_component,
                                      mavutil.mavlink.MAV_DATA_STREAM_RC_CHANNELS, 20, 1)
    while True:
        msg = link.recv_match(type=["RC_CHANNELS", "RC_CHANNELS_RAW"], blocking=True, timeout=2)
        if msg is None:
            yield {}
            continue
        yield {n: float(getattr(msg, f"chan{n}_raw", 0) or 0) for n in range(1, 9)}


def read_simulated() -> Iterator[dict[int, float]]:
    """Fake sticks: the right stick draws a slow circle, yaw nudges the timeline."""
    t0 = time.monotonic()
    while True:
        t = time.monotonic() - t0
        yield {
            1: PWM_MID + 400 * math.cos(t * 0.6),
            2: PWM_MID - 400 * math.sin(t * 0.6),
            4: PWM_MID + (350 if int(t) % 6 < 2 else 0),
            5: PWM_MIN, 6: PWM_MIN, 7: PWM_MIN,
        }
        time.sleep(0.05)


async def run(url: str, source: Iterator[dict[int, float]], seconds: float) -> None:
    import websockets

    sep = "&" if "?" in url else "?"
    url += f"{sep}role=device"
    token = os.environ.get("SPHEREX_HW_TOKEN")
    if token:
        url += f"&token={token}"
    mapper = StickMapper()
    loop = asyncio.get_running_loop()
    end = time.monotonic() + seconds if seconds > 0 else math.inf
    async with websockets.connect(url) as ws:
        print("connected to", url.split("?")[0])
        while time.monotonic() < end:
            pwm = await loop.run_in_executor(None, next, source)   # the reader blocks; keep the socket alive
            for event in mapper.events(pwm, time.monotonic()):
                await ws.send(json.dumps(event))
                print("->", event)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send Pixhawk stick positions to the SPHEREx Time Cube site.")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws/hardware")
    parser.add_argument("--device", default="/dev/ttyACM0", help="serial port, or udp:HOST:PORT")
    parser.add_argument("--baud", type=int, default=57600)
    parser.add_argument("--simulate", action="store_true", help="no Pixhawk: send fake stick motion")
    parser.add_argument("--seconds", type=float, default=0.0, help="stop after this long (0 = run until Ctrl+C)")
    args = parser.parse_args()
    source = read_simulated() if args.simulate else read_pixhawk(args.device, args.baud)
    try:
        asyncio.run(run(args.url, source, args.seconds))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
