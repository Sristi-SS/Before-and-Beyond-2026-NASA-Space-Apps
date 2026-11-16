# API Reference

The FastAPI backend serves the browser client and exposes the routes below. For local development, run the backend with `python -m backend.app`; the API is available at `http://127.0.0.1:8000`.

## Service and target routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Return the pinned release and known SPHEREx collections. |
| `GET /api/status` | Return runtime mode, archive health, cached target count, and active job count. |
| `GET /api/targets` | List the five built-in challenge targets. |
| `GET /api/resolve?name=` | Resolve a CDS Sesame object name or parse decimal/sexagesimal coordinates; names are limited to 80 characters and errors are returned in plain English. |
| `GET /api/sky/bright_stars` | Return bright Hipparcos stars from VizieR; results are cached in `data/cache/sky/` and a labeled 25-star fallback is used when the network is unavailable. |

## Cube jobs and data routes

| Route | Purpose |
| --- | --- |
| `POST /api/jobs` | Create or reuse a cube job from `{ name }` or `{ ra, dec }`, with optional `fov` and `max_frames`. |
| `GET /api/jobs` | List finished cached cubes with keys, target, center coordinates, field of view, and SPHEREx/WISE frame counts; local paths are omitted. |
| `GET /api/jobs/{key}` | Return job status, frames, passes, detector groups, slices, and provenance. |
| `GET /api/jobs/{key}/frames_cube?detector=N` | Return a `float32` stack of individual frames; detector `0` selects all bands. |
| `GET /api/jobs/{key}/cube/{detector}` | Return the pass-averaged cube for one detector. |
| `GET /api/jobs/{key}/contact_sheet.png` | Return a labeled contact sheet of aligned frames. |

## Analysis routes

| Route | Purpose |
| --- | --- |
| `GET /api/jobs/{key}/tilt?detector=&vx=&vy=&source=&static=` | Return a `float32` shifted-and-stacked image. Response headers include `X-Score`, `X-Shifts`, `X-Min`, and `X-Max`. `source` accepts `frames` (individual epochs) or `slices` (pass-averaged slices). `static` accepts `none` or `median`; median mode removes each pixel's temporal median and each frame's offset before stacking, requiring at least three frames. The API default is `none`; the web app sends `median` unless “Remove fixed stars” is unticked. |
| `GET /api/jobs/{key}/gaia` | Return Gaia DR3 sources with grid pixel positions and per-year pixel motion. |
| `GET /api/jobs/{key}/photometry?x=&y=&r=` | Return per-frame aperture photometry at a grid pixel. Radius `r` is 0.5–6 pixels (default 2); results include flux, flux error, flags, wavelength, date, pass, detector, units, and the pixel's RA/Dec. |
| `GET /api/jobs/{key}/motionmap?detector=&span=&step=` | Return a `float32` trial-velocity score grid. Rows correspond to `vy`, columns to `vx`; response headers include grid dimensions and best/zero-motion scores. `span` is 1–60 and `step` is 0.25–20, with at most 121 samples per axis. Detector `0` is not allowed; `101` and `102` select WISE W1/W2. |
| `GET /api/jobs/{key}/candidates?detector=&span=&step=&top=` | Return ranked motion candidates with velocity, score ratio, stack position, estimated sky coordinates, shape score, and predicted path through the job's frames. These are candidates only. |

## Archive refresh routes

| Route | Purpose |
| --- | --- |
| `GET /api/jobs/{key}/updates?fresh=` | Compare a cached cube with the archive and report newer images and previously unseen collection names. Results are cached for 15 minutes; the endpoint returns `503` when the archive is unavailable. |
| `POST /api/jobs/{key}/refresh` | Rebuild a cube using the same parameters and key, reusing saved cutouts. If the build fails, the old cube is restored. |

## Job persistence

Cube jobs run in a background thread. Job state is saved to `data/cache/jobs/<key>/job.json`, so reloading the page or restarting the server reuses the cache.
