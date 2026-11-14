<!-- AI-assistance: this file was written with AI assistance; see README.md "AI assistance". -->
# Deployment

Nothing here has been deployed. The Dockerfile has **not been built or run** (Docker was not
installed on the machine where it was written): treat it as untested. The local run and the test
suite are what was actually measured.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `SPHEREX_HOST` | `127.0.0.1` | Bind address. Containers/hosts set `0.0.0.0`. |
| `PORT` | `8000` | Listen port. |
| `SPHEREX_DATA_DIR` | `./data` | Folder holding `cache/`. |
| `SPHEREX_RATE_MAX` / `SPHEREX_RATE_WINDOW_S` | `6` / `600` | New cube builds allowed per IP per window (429 beyond). Cached cubes are not counted. |
| `SPHEREX_TRUST_PROXY` | unset | Set to `1` behind a reverse proxy to use `X-Forwarded-For` for the rate limit. |
| `SPHEREX_HW_TOKEN` | unset | Optional shared token for `/ws/hardware` (`?token=...`). Never commit it. |

## (a) Local run

```
python -m venv .venv && .venv\Scripts\activate      # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm ci && npm run build && cd ..
python -m backend.app                                # http://127.0.0.1:8000
```

## (b) Docker (untested)

```
docker build -t spherex-time-cube .
docker run --rm -p 8000:8000 -v "$PWD/data/cache:/app/data/cache" spherex-time-cube
```

Open http://localhost:8000. Without the mounted cache the site starts empty and every cube
needs the archive.

## (c) One free-tier host (generic)

Any free container host that can run a Docker image and expose `$PORT` works (a free web-service
tier on a PaaS). Steps: create the service from this repo's Dockerfile; leave the start command
empty (the image's `CMD` is used); set `SPHEREX_TRUST_PROXY=1`; attach a persistent disk at
`/app/data/cache` if the host offers one and upload the cache (below), otherwise bake the small
cache into the image (copy `data/cache/jobs`, `gaia`, `wise` in before `docker build`; free
tiers often have ephemeral disks and sleep when idle, so the first request can be slow). Create
the account and deploy yourself; this repo does neither.

## (d) Jetson Orin Nano

```
sudo apt install python3-venv nodejs npm        # Node 18+ is enough for the build
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm ci && npm run build && cd ..
SPHEREX_HOST=0.0.0.0 python -m backend.app      # reachable from the LAN on :8000
```

For a kiosk screen, start Chromium on the board with `--kiosk "http://localhost:8000/?kiosk=1"`
(or `?projection=1`). Set up a systemd unit if it should start on boot. Not tested on a Jetson.

## Shipping the pre-built cache

The five test objects load from `data/cache` with no archive access:

- `data/cache/jobs/` (cubes, about 73 MB when written) and `data/cache/gaia/` (small): **required**.
- `data/cache/wise/` (about 144 MB): needed for the 16-year WISE movie.
- `data/cache/raw/` (about 930 MB): **optional**. It holds downloaded archive cut-outs; only a
  rebuild of a cube needs it, opening a finished cube does not.

```
tar czf cache-min.tgz data/cache/jobs data/cache/gaia data/cache/wise
# on the target, from the project root:
tar xzf cache-min.tgz
```

Verify with `GET /api/status` (`cached_targets` should be at least 5) and `GET /api/jobs`.

## Keeping the data fresh

The archive adds SPHEREx images all the time. Pick one way:

- On the page: Data tab, "Check now", then "Update cube".
- By hand: `python -m backend.refresh` (list) or `python -m backend.refresh --apply` (rebuild cubes that have newer images).
- On a timer in the server: set `SPHEREX_AUTO_REFRESH_HOURS=12` (0 or unset = off).
- On a timer outside the server (UNTESTED lines):
  - Linux / Jetson cron: `0 */12 * * * cd /path/to/spherex-time-cube && python -m backend.refresh --apply >> refresh.log 2>&1`
  - Windows Task Scheduler: `schtasks /Create /SC HOURLY /MO 12 /TN SpherexRefresh /TR "cmd /c cd /d C:\path\to\spherex-time-cube && python -m backend.refresh --apply"`

A rebuild reuses the cut-outs already on disk, keeps the cube's key and link, and puts the old cube back
if the archive fails part-way. Be considerate: do not run it more often than every few hours.
