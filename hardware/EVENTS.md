<!-- AI-assistance: this file was written with AI assistance; see README.md "AI assistance". -->
# Hardware event schema

WebSocket endpoint `/ws/hardware` on the backend. Messages are single JSON objects, at most
1024 bytes, one per text frame. Invalid or oversized messages are not relayed; the sender gets
`{"type":"error","message":"..."}`.

Connect with `?role=device` (ESP32, simulator) or `?role=browser` (the website, the default).
If the server has `SPHEREX_HW_TOKEN` set, add `&token=<value>`. Over HTTPS use `wss://`.
With no token set, the server accepts a device only from the same machine or the local network.
A web page from another site cannot open this socket. Each socket may send 60 messages per second.
The site works fully with no hardware.

## Device to browser

| Message | Rules |
|---|---|
| `{"type":"encoder","id":"time","delta":1}` | `delta` integer, -20..20, not 0. Moves the timeline. |
| `{"type":"button","id":"ask","state":"down"}` | `id` is `ask`, `play` or `reset`; `state` is `down` or `up`. Acts on `down`. `ask` = Find best motion, `play` = play/pause, `reset` = Zero motion. |
| `{"type":"joystick","x":0.4,"y":-1}` | `x`, `y` finite numbers in -1..1. Sets vx/vy to x, y times 12 arcsec/yr (dead zone 0.08), then runs the tilt 350 ms after the last event. |
| `{"type":"toggle","id":"axis","value":"time"}` | `value` is `time` or `wave`. Sets the stacking order. |

## Browser to device

| Message | Rules |
|---|---|
| `{"type":"led_ring","angle_deg":90,"sharpness":0.5}` | `angle_deg` 0 = north (+vy), 90 = east (+vx), wrapped to 0..360. `sharpness` 0..1 = (moved/still score ratio - 1) / 0.6, clamped. |
| `{"type":"status","state":"ready"}` | `ready`, `processing` (tilt running) or `candidate` (ratio >= 1.4: a check, not a detection). |
| `{"type":"oled","lines":["vx 3.0","vy -1.0","x1.52"]}` | At most 8 strings, each cut to 32 characters. |

## Server to browser

`{"type":"presence","devices":N}` is sent whenever a device connects or disconnects; the
`hw=1` indicator ("hardware connected / disconnected") uses it.

## Pixhawk reader (optional)

`hardware/pixhawk_reader.py` is one more device. It reads MAVLink `RC_CHANNELS` and sends the
device events above. It only reads from the flight controller. The real link is UNTESTED.

| Radio control | Channel (default) | Event |
|---|---|---|
| Right stick, sideways and forward/back | 1 (roll), 2 (pitch) | `joystick` x, y. Forward = north. At most 8 events per second. |
| Left stick, sideways | 4 (yaw) | `encoder` id `time`, delta +1 or -1 while held; farther = faster (up to 6 per second). |
| Two-position switch | 5 | `toggle` id `axis`: low = `time`, high = `wave`. |
| Momentary switch | 6 | `button` id `ask`, on the way up. |
| Momentary switch | 7 | `button` id `reset`, on the way up. |

Try it with no hardware: `python hardware/pixhawk_reader.py --simulate` (open the site with `?hw=1`).
