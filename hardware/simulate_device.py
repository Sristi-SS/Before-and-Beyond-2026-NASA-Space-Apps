"""Fake hardware device for testing /ws/hardware without any electronics.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Usage:  python hardware/simulate_device.py [ws://127.0.0.1:8000/ws/hardware] [seconds]
Open the site with ?hw=1 in a browser first to watch the timeline and tilt react.
Set SPHEREX_HW_TOKEN in the environment if the server requires a token.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import sys

import websockets


async def main(url: str, seconds: float) -> None:
    sep = "&" if "?" in url else "?"
    url += f"{sep}role=device"
    token = os.environ.get("SPHEREX_HW_TOKEN")
    if token:
        url += f"&token={token}"
    async with websockets.connect(url) as ws:
        async def listen() -> None:
            async for text in ws:
                print("<-", text)

        reader = asyncio.create_task(listen())
        t = 0.0
        await ws.send(json.dumps({"type": "toggle", "id": "axis", "value": "time"}))
        while t < seconds:
            await ws.send(json.dumps({"type": "encoder", "id": "time", "delta": 1}))
            await ws.send(json.dumps({"type": "joystick", "x": round(math.cos(t), 2), "y": round(math.sin(t), 2)}))
            print("-> encoder +1, joystick", round(math.cos(t), 2), round(math.sin(t), 2))
            await asyncio.sleep(0.5)
            t += 0.5
        await ws.send(json.dumps({"type": "button", "id": "reset", "state": "down"}))
        await asyncio.sleep(0.3)
        reader.cancel()


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8000/ws/hardware"
    asyncio.run(main(target, float(sys.argv[2]) if len(sys.argv) > 2 else 5.0))
