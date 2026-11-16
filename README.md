## NASA Space Apps - Before & Beyond
#### Arush, Aditya Gaur, Nishad Mulay, Sristi Sharma

<img width="1097" height="130" alt="image" src="https://github.com/user-attachments/assets/59c82bba-3a2f-4d38-a5c2-c012f82b0c2b" />

**Explore how a patch of infrared sky changes over time and test whether a source follows a chosen motion.**

SPHEREx Time Cube is a public, no-login tool for viewing aligned SPHEREx images of one sky region as a timeline and interactive 3D cube. Use shift-and-stack to test a trial motion. Separately labeled WISE observations extend the timeline for selected examples.

<div align="center">

[Launch the live app](https://spherex-time-cube.onrender.com/) · 
[Watch the demo](REPLACE_WITH_PUBLIC_DEMO_LINK) · 
[View the source code](https://github.com/AdityaGaur77/Before-and-Beyond-2026-NASA-Space-Apps)
</div>

## About the challenge

NASA Space Apps **Planet X and SPHEREx** challenge asks for a public tool that makes it easier to explore how SPHEREx sky images change over time. SPHEREx observes the sky in 102 near-infrared bands, and observations from different times can reveal sources that move or vary. Because wavelength varies with position in a SPHEREx image, comparisons also need to keep the image position and wavelength information straight. 
<div align="center">

[Challenge description](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/) · [IRSA SPHEREx overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html)

</div>

---
## Overview

SPHEREx Time Cube is a public, browser-based tool for exploring how infrared observations of the same region of sky change over time. It brings archival SPHEREx images together in an interactive timeline and 3D time cube, making it easier to compare observations and inspect changes across epochs. Users can browse aligned images, compare frames, and shift-and-stack observations under a trial motion to examine possible moving sources. Optional Gaia overlays and separately labeled WISE observations provide additional context. 

---
## Features



---
## Technology Stack

---
## System Architecture 

---
## Data sources and Scientific Processing

### How a cube is made
 1. **Resolve the position.** The five challenge targets come from a built-in
   table (values read from CDS Sesame/SIMBAD on 2026-11-13), so they need no
   network. Other names go through CDS Sesame. All are treated as J2000
   coordinates with a proper motion.
   Named cubes are centred on the position **propagated to 2026.5**, the middle
   of the SPHEREx survey; otherwise Barnard's Star sits about 4.5 arcmin off-centre (26 yr x 10.36 arcsec/yr = 269 arcsec).
   Explicit coordinates are used exactly as entered.
2. **Search the archive.** A TAP `ADQL` cone search on `spherex.obscore`
   One row is returned per detector plane. The search returns planes from
   every collection (`spherex_dr1`, `spherex_qr3`, `spherex_dr1_deep`); the
   cached cubes mix them. When two collections hold the same exposure, only
   one copy is kept (`spherex_dr1` first). Each frame records its collection.
3. **Fetch cut-outs.** IRSA IBE cut-outs (`?center=RA,DEC&size=DEG`) give the
   `IMAGE`, `FLAGS`, `VARIANCE` and `ZODI` layers plus a celestial WCS and a
   `WAVE-TAB` WCS. If IBE cannot serve a plane, the DataLink link is used as a
   fallback. Raw FITS files are cached under `data/cache/raw/`.
4. **Align.** Every image is reprojected onto one north-up TAN grid
   (default 128 × 128 px at 6.15 arcsec/px, so the grid is 787 arcsec = 0.22 deg wide).
   Native SPHEREx pixels are 6.15 arcsec; the tool never upsamples by more than 2×.
   The "field of view" choice only sets the size of the cut-out requested from the
   archive (never smaller than the grid needs); it does not resize the grid.
5. **Clean.** The ZODI layer and a robust median background are subtracted.
   `FLAGS` is masked except bit 21 (`SOURCE`, "pixel mapped to a known source")
   and bit 12 (`FULLSAMPLE`); every other bit is treated as contamination. The
   bit names come from the `MSKNnnnn` keywords in the FLAGS header. Masked
   pixels inside the detector outline (saturated star cores, bad pixels) are
   filled by interpolation from their neighbours, so a bright star is not a
   black hole; do not measure fluxes there. The masked fraction and coverage
   are stored per frame and shown in the UI.
6. **Group.** Frames are clustered into passes by a 60-day gap, then split by
   detector (the six wavelength groups). Frames in the same pass and detector
   are averaged into one slice for the pass-averaged cube; the 3D view uses the
   individual aligned epochs so the real cadence is visible.
7. **Tilt.** For a trial velocity `(vx, vy)` in arcsec/yr, each frame is shifted
   by `v · Δt / pixel scale` and summed. Cubic interpolation (`ndimage.shift`,
   order 3) is used because bilinear interpolation biased the recovered
   velocity by 1.5 arcsec/yr on the Barnard's Star test cube. The score is the
   peak of the smoothed, flux-averaged stack.

*Orientation: the grid is north-up with a negative RA step, so east is −x and
north is +y. A positive `vx` therefore moves a source toward smaller x.

---
## Installation (Windows, Python 3.14, Node 22)

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

npm --prefix frontend install
npm --prefix frontend run build

python -m backend.app
:: open http://127.0.0.1:8000
```

For live frontend work, `npm --prefix frontend run dev` serves
`http://127.0.0.1:5173` and proxies `/api` to the backend on port 8000.

Build a cube from the UI, or warm the cache from the command line:

```bat
python -m backend.precache --only barnard --max-frames 40
python -m backend.precache --only epsindb,wise0855,rwaur,rdra --max-frames 40
python -m backend.precache --force      :: all five, rebuilt from the archive
```

The pre-cache writes `data/precache_summary.json` (merging with earlier runs)
and a `contact_sheet.png` per target. The cubes the page opens from the globe
are the 40-frame builds of 2026-11-14 (see the table under "The five challenge
objects"); smaller 12- and 20-frame cubes from earlier runs are still in the cache.
`data/precache_summary.json` was written by an earlier, smaller run and is not the
source of the numbers in this README; those come from `job.json` and the API.

Run the tests:

```bat
python -m pytest backend\tests -q -k "not real_frames"   :: about 15 s
python -m pytest backend\tests -q -k real_frames          :: 4 to 12 min, needs the cache
```

---
### Detector wavelength groups

| Group | Nominal range (µm) | Typical λ in the cube |
| --- | --- | --- |
| D1 | 0.75–1.12 | 0.75–0.90 |
| D2 | 1.10–1.65 | 1.20–1.60 |
| D3 | 1.63–2.43 | 1.65–2.36 |
| D4 | 2.40–3.85 | 2.50–3.80 |
| D5 | 3.81–4.43 | 3.85–4.40 |
| D6 | 4.41–5.01 | 4.45–4.95 |

The exact wavelength of each frame is read from the `W` (`WAVE-TAB`) WCS, so it
varies within a detector and is displayed per slice.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | release pin, known collections |
| `GET /api/targets` | the five built-in targets |
| `POST /api/jobs` | `{ name }` or `{ ra, dec }`, plus `fov`, `max_frames` |
| `GET /api/jobs` | light list of every finished cube in the cache: key, target, centre RA/Dec, fov, SPHEREx and WISE frame counts (no local paths) |
| `GET /api/resolve?name=` | object name (CDS Sesame) or typed coordinates, decimal or sexagesimal; at most 80 characters; plain-English errors |
| `GET /api/sky/bright_stars` | Hipparcos stars with V < 4.5 from VizieR, cached in `data/cache/sky/`; a labelled 25-star fallback if the network fails |
| `GET /api/jobs/{key}` | status, frames, passes, groups, slices, provenance |
| `GET /api/jobs/{key}/frames_cube?detector=N` | `float32` stack of all individual frames (`0` = all bands) |
| `GET /api/jobs/{key}/cube/{detector}` | pass-averaged cube for one detector |
| `GET /api/jobs/{key}/tilt?detector=&vx=&vy=&source=frames\|slices&static=none\|median` | `float32` shifted-and-stacked image; `X-Score`, `X-Shifts`, `X-Min`, `X-Max` headers. `frames` (default) stacks the individual epochs; `slices` stacks the pass-averaged slices. `static=median` first subtracts the per-pixel temporal median (and each frame's own offset), so fixed stars drop out and only what changes between frames is stacked (needs at least 3 frames; the API default is `none`, the web page sends `median` unless "Remove fixed stars" is unticked) |
| `GET /api/jobs/{key}/gaia` | Gaia DR3 sources with grid pixel positions and per-year pixel motion (`backend/extras.py`) |
| `GET /api/jobs/{key}/photometry?x=&y=&r=` | per-frame aperture photometry at one grid pixel (`r` 0.5-6 px, default 2): `flux`, `flux_err`, `flagged`, wavelength, date, pass, detector, units, plus the pixel's RA/Dec (`backend/extras.py`) |
| `GET /api/jobs/{key}/contact_sheet.png` | every aligned frame, labelled |
| `GET /api/jobs/{key}/motionmap?detector=&span=&step=` | `float32` score grid (`nv*nv`, row = vy, column = vx, ascending, vx positive east). Headers `X-Nv`, `X-Span`, `X-Step`, `X-Best-Vx`, `X-Best-Vy`, `X-Best-Score`, `X-Zero-Score`, `X-Best-X`, `X-Best-Y`. `span` 1-60, `step` 0.25-20, at most 121 samples per axis. Detector 0 is not allowed; 101/102 (WISE W1/W2) are |
| `GET /api/jobs/{key}/candidates?detector=&span=&step=&top=` | ranked motion candidates for one band (`backend/candidates.py`): velocity, score, ratio to the zero-motion score, stack pixel and RA/Dec, `patch_score` from the small shape model, a `path` with the predicted pixel and RA/Dec in every frame of the job (all bands), and `today`. Candidates only |
| `GET /api/jobs/{key}/updates?fresh=` | compares the cube with the archive: newest frame in the cube, newest image in the archive, count of newer images, collection names not seen before. Cached 15 minutes; 503 at once when the archive is down |
| `POST /api/jobs/{key}/refresh` | builds the cube again with the same parameters and the same key. Saved cut-outs are reused. If the build fails, the old cube is put back |

Jobs run in a background thread and the state is persisted to
`data/cache/jobs/<key>/job.json`, so reloading the page or restarting the
server reuses the cache.

### Three scenes

The page is three connected 3D scenes, switched from the header (`scene=` in the URL):

1. **Sky globe** (`scene=globe`, the landing view when the URL has no job or coordinates). A
   three.js celestial sphere seen from outside, with an RA/Dec grid (every 2 h and 15 degrees),
   the ecliptic and galactic equator, real bright stars (Hipparcos, see REFERENCES.md; a
   labelled fallback list offline), pins for the five targets and blue squares for every
   patch with a cached cube. Clicking empty sky fills RA/Dec and offers "Build a cube here"
   ("Nobody has looked here yet"); clicking a pin or square dives in and opens that cube
   (instant when the system asks for reduced motion). Search takes a name or coordinates.
   Keyboard: arrows turn, + and - zoom, Enter picks the view centre; on-screen buttons and plain
   lists of targets and cubes do the same; without WebGL only the lists and forms remain.
2. **Time cube** (`scene=cube`, the default when `job` or `ra`+`dec` is present): the workspace
   described above. Old links keep working.
3. **Orbit view** (`scene=orbit`, from "Why does it move?" in the header or the tilt panel):
   Earth circling the Sun (not to scale), a sight line to a nearby object and to the faraway
   background, and an inset with the apparent path: parallax ellipse plus straight proper motion.
   Sliders for distance (1 to 100 pc for stars, 100 to 2000 AU for a hypothetical planet),
   proper motion and time, with the numbers shown (p = 1/d for d in pc, p ~ 206265/d for d in
   AU, in SPHEREx pixels of 6.15 arcsec). The sliders are preset from the open cube's target
   (catalogue proper motion; parallax only for Barnard's Star, WISE 0855 and Epsilon Indi, marked
   "approximate, from the literature"). The planet model reuses `distantPlanetMotion` from the simulator.

Each scene stops its render loop while hidden and frees its GPU resources on page teardown.
Code: `frontend/src/scenes.ts` (switching, globe panel), `globe.ts`, `orbit.ts`.

### URL state

The page mirrors its state in the URL so a view can be shared:

`?scene=cube&job=…&ra=…&dec=…&fov=0.20&axis=time&group=102&t=2&vx=-8.124&vy=0.673&view=blink&movie=1&gaia=1&static=median`

- `scene` — `globe`, `cube` or `orbit` (default: `cube` if `job` or `ra`+`dec` is present, else `globe`)
- `axis` — stacking order: `time` or `wave` (ignored in the movie, which is always time)
- `group` — `0` for all bands, `1`–`6` for a SPHEREx detector, `101` WISE W1, `102` WISE W2
- `t` — current slice
- `vx`, `vy` — trial proper motion in arcsec/yr (auto-runs the tilt on load)
- `view` — `cube`, `blink`, `colour`, `map`, `compare` (with `a`, `b`, `cmp`)
- `sim=1` — simulator test mode is on (the SIMULATED banner always shows); `simp` holds its visible parameters
- `movie` — `1` shows the 16-year movie of the WISE band given by `group` (101 or 102)
- `gaia` — `1`/`0` Gaia ring overlay (default on, off on phones narrower than 700 px)
- `static` — `median` (default) or `none`: remove fixed stars before the tilt
- `px`, `py`, `panel` — selected grid pixel (0-based, x grows west, y grows north) and the open panel, `spectrum` or `pulse`; restored on load

---

## Results so far

### Automated tests

`python -m pytest backend\tests -q -k "not real_frames"` → **87 passed, 2 skipped** (about 90 s).
`python -m pytest backend\tests -q -k real_frames` → **1 passed** (about 4.5 min; it
needs the cache and skips cleanly without one). Run on 2026-11-14.

- `test_tilt_recovers_planted_motion_in_real_frames` plants a Gaussian moving at
  (24, −16) arcsec/yr into the real SPHEREx frames of the largest cached detector group
  (it ignores WISE frames, whose 14-year span would carry the planted source off the grid),
  scans a 0.5 arcsec/yr grid over ±32 arcsec/yr, and requires the recovered velocity to be
  within one grid step and the score to beat the zero-motion score by 1.6x. A
  cubic-interpolation comparison, plus the fact that the recovered value is exact rather
  than rounded to an integer pixel shift, is what rules out the bilinear bias seen earlier.
- `test_shift_sum_recovers_known_motion` does the same on a synthetic 4-epoch
  scene, checks the peak stays within 1 px of the input centroid, and requires a
  > 1.3× sharpness gain (measured 1.39×; cubic interpolation broadens the stack
  slightly, so the gain is not the 2× a noiseless delta would give).
- Pass clustering and per-pass/per-detector slice averaging are unit-tested.

The real-frame test skips cleanly when no cache exists, so a fresh clone still
runs the synthetic tests.

### The five challenge objects

Frame counts below are recomputed from `data/cache/jobs/*/job.json` for the 40-frame
builds of 2026-11-14 (field 0.2 deg, 128 x 128 px). Each build holds the SPHEREx frames plus
the WISE W1 and W2 epochs (2010-2024) for the same grid.

| Object | SPHEREx frames | WISE epochs (W1 + W2) | SPHEREx passes | SPHEREx frames per detector D1 / D2 / D3 / D4 / D5 / D6 | SPHEREx dates |
| --- | --- | --- | --- | --- | --- |
| Barnard's Star | 35 | 46 (23 + 23) | 3 | 8 / 1 / 11 / 6 / 1 / 8 | 2025-08-15 to 2026-09-22 |
| Epsilon Indi B | 35 | 46 (23 + 23) | 4 | 8 / 5 / 7 / 7 / 3 / 5 | 2025-04-24 to 2026-09-22 |
| WISE 0855 | 40 | 46 (23 + 23) | 3 | 4 / 7 / 12 / 3 / 6 / 8 | 2025-05-05 to 2026-05-13 |
| RW Aurigae | 40 | 46 (23 + 23) | 3 | 13 / 0 / 8 / 11 / 0 / 8 | 2025-09-02 to 2026-09-08 |
| R Draconis | 38 | 82 (41 + 41) | 1 (pass clustering puts all in one) | 8 / 3 / 10 / 7 / 2 / 8 | 2025-04-24 to 2026-09-08 |

Barnard's Star, Epsilon Indi B, RW Aurigae and R Draconis mix the collections `spherex_dr1`,
`spherex_qr3` and (R Draconis) `spherex_dr1_deep` / `spherex_qr3_deep`; WISE 0855 is all
`spherex_dr1`. The WISE epochs run 2010-03 to 2024-05; SPHEREx adds 2025-2026, so the movie
spans about 16 years end to end, with a gap in 2025 between the two instruments.

**Screening numbers, not detections.** For each detector group the table gives the peak S/N
within 2 px of the target's predicted pixel in the plain shift-and-stack of all frames of the
group at the catalogue proper motion (no fixed-star removal). S/N = (peak - median) / (1.4826 x
MAD) of the stacked image. The predicted pixel is the catalogue position moved from the grid
centre (2026.5) to the first frame's epoch. A bright star scores in the hundreds to thousands
because it is a bright star; a high number is not evidence of anything else. Computed on
2026-11-14 with `GET /api/jobs/{key}/tilt` (script not kept in the repository).

| Object | D1 | D2 | D3 | D4 | D5 | D6 | WISE W1 | WISE W2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Barnard's Star | 123 | 78 | 157 | 137 | 2 551 | 5 219 | 2 387 | 7 014 |
| Epsilon Indi B | 17 | 54 | 200 | 222 | 715 | 332 | 775 | 1 406 |
| WISE 0855 | 44 | 29 | 25 | 12 | 8 | 9 | 0.3 | 36 (130 with fixed stars removed) |
| RW Aurigae | 1 272 | no frames | 994 | 449 | no frames | 6 330 | 3 408 | 7 834 |
| R Draconis | 226 | 322 | 204 | 221 | 344 | 1 284 | 3 551 | 4 911 |

How to read it:

- Barnard's Star, Epsilon Indi B, RW Aurigae and R Draconis are bright in every group they
  cover, as expected for a nearby red dwarf, a brown dwarf companion and two bright stars.
  The R Draconis and RW Aurigae cores are partly saturated and filled by interpolation, so
  their values are lower limits, and both stars are variable.
- **WISE 0855: not credibly seen in single SPHEREx frames.** The 8-44 values in D1-D6 are
  nearly identical to the zero-motion stack (for example D1 43.5 against 43.8) and sit on a
  fixed field star 1-2 px from the predicted pixel; with fixed stars removed the groups drop to
  0-15 with no consistent peak at the predicted position. A cold brown dwarf should be bright in
  the reddest detectors and faint in D2/D3, which is the opposite of what the stack shows.
- **WISE 0855 is recovered in the WISE W2 shift-and-stack at the catalogue motion.** With
  "Use catalogue motion" (vx = -8.124, vy = +0.673 arcsec/yr) and "Remove fixed stars" on the 23
  W2 epochs: the strongest peak in the 128 x 128 field lies at pixel (42, 62), the predicted
  pixel for the first epoch (2010), with S/N 130; the page's sharpness score is 52.4
  against 9.3 for v = 0 (5.61x). The v = 0 stack without star removal reaches only S/N 8.3 at
  that pixel. The motion map on the same group (span 12, step 0.5 arcsec/yr) puts its best cell
  at (-8.0, +0.5) arcsec/yr, within one step of the catalogue value, with score 60.8 against 15.6
  at v = 0. This is **a recovery of a known object, not a detection**: the catalogue motion
  was supplied, so it shows the method works on a real mover, not that anything new was found.

Earlier findings on the older 12-frame cube, kept for history:

- A **persistent compact source sat at the grid centre** in several frames, strongest in
  D2/D3, present in D1, marginal in D6 and D4. That is a field star, not WISE 0855.
- The brief's coordinates are the position at the WISE epoch (about 2010.5). SIMBAD lists
  `WISEA J085510.74-071442.5` with proper motion (-8123.7, +673.2) mas/yr, so by the SPHEREx
  epochs it is about 2 arcmin (20 pixels) west. The built-in target now uses that position and
  motion, and the cube is centred on the 2026.5 position.
- Even so, no SPHEREx detector shows it credibly. A catalogue cross-match or a proper-motion
  blink is required before any statement about SPHEREx data alone.

Interpretation cautions:

- A bright star is visible in **every** band because it is a continuum source;
  that does not make it a planet.
- A high central S/N at a catalogue position can be a field star — proper
  motion and colour must be checked.
- R Draconis is a variable star; variability can look like motion in a
  shift-and-stack score and must be checked against the per-epoch frames.
- Epsilon Indi B's central S/N in D1 is only ~12 and the frame list has four
  passes; treat the D1 result as approximate.

### Planted-source demonstration

The UI does not inject sources. To reproduce the M3 check, run the test above or
call `tilt.shift_sum` on any cached group; synthetic data only ever appears in
the test suite and is labelled as such.

---

## Motion map and colour view

**Motion map** (`backend/tilt.py: motion_map`, view "Motion map", button "Find
best motion"). For one detector group it scores every velocity on a grid
(default +-12 arcsec/yr in 1 arcsec/yr steps, up to +-60):

1. subtract the per-pixel temporal median from every frame, so fixed sky goes;
2. mask (and grow by 3 px) pixels where a fixed source varies from frame to frame,
   i.e. the residual is strongly positive in one frame and strongly negative in
   another. A mover leaves only positive residuals, so it is not masked. The
   threshold rises (5, 10, 20 ... sigma) until at most a quarter of the image
   is masked;
3. divide each frame by its robust noise (MAD) and clip at +-8 sigma, so one
   spike or cosmic ray cannot hold the peak; smooth with a 1 px Gaussian;
4. for each velocity shift every frame back to the first epoch and average. The
   shift is exact (Fourier phase ramp, separable in vx and vy, zero-padded), so a
   25 x 25 grid on 20 frames of 128 x 128 takes about 1 s;
5. score = (peak - median) / (1.4826 x MAD) of the stack, ignoring a 2 px border.

The page shows the grid with east on the left and north up (like the sky), a
dashed blue cross at v = 0, an orange ring at the best cell and a white cross at
the velocity in the vx/vy boxes. Click (or arrow keys, Enter, `B`) picks a
velocity and runs the tilt there; the tilt result marks the stack peak with an
orange ring.

Limits, stated plainly:
- The score is a ranking, not a probability. Nothing here is a detection; a
  best velocity is a **candidate** that needs several bands and a catalogue check.
- A source that moves less than about its own PSF over the baseline (about 2 px,
  or about 12 arcsec/yr over one year) stays in the median and is removed with the
  fixed sky. SPHEREx covers about a year, so only fast movers are reachable.
- Frames of one group differ in wavelength, so bright fixed stars never cancel
  completely; masking them also blanks any mover that crosses them.
- With a few frames (4-5 per detector on Barnard's Star) the map is broad and
  noise-limited. On Barnard's Star D6 (5 frames, true motion about
  (-0.80, +10.36) arcsec/yr) the map is nearly flat: best (-4, 0) with score 13.5
  against 12.4 at v = 0 and a map median of 11.3. It does not recover the known
  motion, as expected from the first limit.
- Edge pixels, one-frame spikes and unmasked stars can still make a peak.

**Colour view** (`frontend/src/colourview.ts`). One-image change detection: the
frames of the group are collapsed in time into an early-weighted mean (blue) and
a late-weighted mean (orange), after removing each frame's median and applying one
shared asinh stretch. The two basis colours add to white, so a fixed source is
neutral and a moving or varying one leaves a blue-to-orange trail. The colours
visualise infrared data; they are not what an eye would see.

## WISE baseline

Optional 2010-2024 baseline: `backend/wise.py` fetches the unWISE
**time-resolved coadds** (one six-month WISE/NEOWISE visit per epoch, W1 3.4 um
and W2 4.6 um, 2.75 arcsec pixels, release `neo11`, 23 epochs for a typical
position) and puts them on the same grid as the SPHEREx frames. They appear in
the job as detectors **101** (W1) and **102** (W2) with `source: "wise"`, so
`frames_cube?detector=102` and `tilt?detector=102` work unchanged. A job param
`"wise": false` switches the stage off. The stage runs after the SPHEREx cube
is finished and can never fail the job: `state["wise"]` is
`{status: ok|error|none, n, message}`.

How it was verified (2026-11-13): `unwise.me/cutout_fits` only serves full-depth
coadds (checked with several `version` values); the epoch files are plain FITS
under `portal.nersc.gov/project/cosmo/temp/ameisner/neo11/` (the target of the
`unwise.me/tr_neo2` redirect), the server honours HTTP Range requests, so only
the needed rows of a tile (about 2 MB) are read. For WISE 0855 on the cached
128x128 grid: 23 W2 + 23 W1 epochs, 2010-05 to 2024-04, 3 s warm, no gaps.
Shift-and-stack of the 23 W2 epochs at the catalogue motion (-8.12, +0.67
arcsec/yr), after removing the static sky with a temporal median, gives a peak
at the predicted pixel (63, 63) with S/N 82 (strongest peak in the field);
unshifted (0, 0), the same object is smeared to S/N 11.6 and a residual star
is stronger (25). Without removing the static sky the peak at the predicted
position is S/N 9, because bright stars dominate. This is a recovery of a known
object, not a new detection; any other moving source is a candidate only.

Limits: the data folder is a public "temp" directory of the unWISE author, not
a guaranteed-stable archive (a different release can be set with
`SPHEREX_WISE_RELEASE`). Frames are in unWISE nanomaggies, not MJy/sr, so do not
mix them with SPHEREx frames in one stack (`detector=0` does). Coadds are
smoothed (sigma = 0.65 native pixel) before they are resampled to 6.15 arcsec,
no per-epoch exposure-count mask is used (zero-valued pixels are treated as
empty), and the epochs are not corrected for the roughly 3-day exposure window.

## Gaia labels

`backend/gaia.py` queries Gaia DR3 (ESA TAP, verified; VizieR I/355 is coded as
a fallback but was **not reachable** from the development machine and is
untested), caches in `data/cache/gaia/`, and propagates 2016.0 positions with
the catalogue proper motion only (no parallax or radial velocity).
`GET /api/jobs/{key}/gaia` (router in `backend/extras.py`) returns up to 300
sources, brightest first, with pixel `x, y` on the job grid at the mid epoch
of the SPHEREx frames and the predicted `dx_per_yr, dy_per_yr`. Not verified:
completeness for faint or very fast movers (Gaia misses many of them, WISE 0855
has no Gaia entry), and crowded fields beyond the 300-source cap.

## 16-year movie, units caveat

The group picker lists WISE W1 3.4 um and W2 4.6 um next to the SPHEREx
detectors, and every slice label, 3D cube label and the provenance panel names
the instrument of the frame shown (for example `WISE W2 · 2012-05-02 · 4.60 um · epoch 4`
or `SPHEREx D6 · 2026-02-11 · 4.62 um · pass 2`).

The **16-year movie** chips (WISE 2010-2024 followed by SPHEREx 2025-2026, about 16 years end to end) build one time-ordered sequence: all WISE W2
epochs followed by the SPHEREx D6 frames (4.2-5.0 um), or all WISE W1 epochs
followed by the SPHEREx frames at 3.0-3.8 um. Every frame is stretched with its
own robust percentile range (1st to 99.5th), so the different units do not
matter for viewing. This is a picture, not a photometric light curve:
**SPHEREx frames are in MJy/sr and WISE frames are in unWISE nanomaggies**, the
bandpasses and resolution differ, and the two are never added or compared
numerically. For the same reason "All bands" (which contains both) is shown
with per-frame stretches, and the tilt, motion map and colour view refuse to
treat it as one image set (the tilt and motion map take one band, detector 1-6,
101 or 102).

## Gaia overlay, catalogue motion, evidence checklist

- **Gaia stars** (checkbox, URL `gaia=`): blue rings on the blink canvas and on
  both tilt canvases, positions moved by each source's catalogue proper motion
  to the date of the frame shown (to the first frame's date on the tilt
  canvases). Hover a ring for a tooltip; with the keyboard, Tab to the image and
  use the arrow keys to step through the stars (brightest first); the same text
  is announced through a live region. The tooltip shows G magnitude and proper
  motion (mas/yr).
- **Use catalogue motion**: when the target has a catalogue proper motion
  (`target.pmra_mas_yr`, `pmdec_mas_yr`), fills vx = pmra/1000 (east positive) and
  vy = pmdec/1000 in arcsec/yr and runs the tilt.
- **Remove fixed stars** (default on): `/tilt?static=median`. Without it the
  fixed sky dominates any stack of a faint mover.
- **Evidence checklist** under the tilt result, plain yes/no rows for the peak of
  the current stack: seen in at least 2 passes/epochs (3 sigma bump above the
  temporal-median residual at the predicted pixel of each frame); not within 2 px of a
  Gaia star whose catalogue motion matches the tested velocity (within
  max(1, 30 %) arcsec/yr); not within 3 px of the image edge; score at least
  1.15 times the v = 0 score. A row reads n/a when the data for it are missing
  (for example Gaia unreachable). The list always ends with the standing
  caution: **candidate only**.

## Pixel spectrum and pulse view

Every SPHEREx frame records a given sky position at a *different* wavelength
(0.75-5.0 um; six detectors with linear variable filters). So the frames at one
pixel are at once a spectrum (brightness against wavelength) and a light curve
(brightness against date). Click a pixel on the Blink view or on the tilt result
(or Tab to the canvas, move the dashed cursor with the arrow keys, Shift for 5
pixels, and press Enter) to open the panel below the page. The selected pixel is
ringed, and `px`, `py`, `panel` go into the URL.

**Measurement.** `GET /api/jobs/{key}/photometry` sums the aperture (radius 1-6
px, default 2) of every aligned frame and subtracts the median of a local
annulus (radius+2 to radius+5 px). The error bar is the annulus 1.4826*MAD
scaled to the aperture, including the error of the background median; the
pixels are slightly correlated by the resampling, so treat it as approximate.
`flagged` is true when any aperture pixel was masked by the pipeline (and then
filled by interpolation). New builds save a compact `frames/NNN.mask.npy` per
SPHEREx frame; older caches, and all WISE frames, report `flagged: null`
("unknown") and the panel says so. SPHEREx values are an aperture sum of MJy/sr,
WISE values an aperture sum of unWISE nanomaggies; the two are never combined.

**Spectrum tab.** Flux against wavelength for the SPHEREx points, error bars,
colour and shape by pass (colour-blind-safe orange/blue palette, no red-green
pair), hollow = flagged. A row of "Molecule presets" chips shades approximate
bands and prints a one-line explanation: H2O ice about 3.0 um, CH4 about 3.3 um
(and 1.6, 2.2), PAH 3.3 um, CO2 about 4.27 um, CO about 4.67 um. **These band
positions are approximate general astronomy values, not fitted to the data**,
and the real centres and widths shift with temperature and mixture. The tab
also compares two passes (median flux over their shared wavelength range) and
shows a colour index: the ratio of the median flux in two chosen SPHEREx
detectors (not a calibrated colour).

**Pulse tab (for variable stars such as RW Aurigae and R Draconis).** Flux
against date, one series per detector. SPHEREx (MJy/sr) and WISE W1/W2
(nanomaggies, 2010-2024) are on separate panels because the units differ.
Caution shown in the panel: at a given pixel each SPHEREx frame is at a
different wavelength, so a change between passes in one detector can be a
wavelength change, not variability. "Compare passes at matched wavelength"
connects only points whose wavelengths differ by less than 0.05 um and fades the
rest. WISE W1 and W2 each have one fixed wavelength, so their series are
directly comparable over time.

**Also in the panel.** RA/Dec of the pixel, a "Download CSV" button for the
measurements, and a collapsed table of all measurements as a text alternative to
the charts (the charts carry a spoken summary in their `aria-label`).

**Limits.**
- Bright star cores are saturated, masked and filled by interpolation, so their
  fluxes are **lower limits**, and flagged points say so. Caches built before
  this feature have no mask, so a bright core may look unflagged there.
- The local-annulus subtraction removes a smooth wing: for a very bright star
  whose halo fills the cut-out, the aperture and the ring are nearly equal and the
  flux can come out near zero or negative. A larger radius helps.
- A pixel is fixed on the grid. A mover (for example a brown dwarf) is not at the
  same pixel in every frame, so the pulse view is not a light curve of a mover.
- Only measured frames appear; there is no colour correction, no aperture
  correction and no absolute calibration.
- A feature in a spectrum or light curve is a **candidate** to check, not a result.

Measured at the central pixel (64, 64), radius 2 px (cached cubes, 2026-11-14):
- RW Aurigae (job 699a..., numbers from before the 2026-11-14 rebuild, so they may shift slightly): 39 SPHEREx and 46 WISE measurements. SPHEREx median
  flux (aperture sum, MJy/sr) is 168 in D1 (0.79-1.05 um), 260 in D3, 76 in D4
  (2.6-3.5 um) and 1111 in D6 (4.4-4.8 um), a rising spectrum toward 4.5 um. Within
  one detector the range is large (D1 80-248) because the wavelength changes from
  frame to frame. WISE W1 ranges 109-393 thousand nanomaggies (3.6x) over 2010-2024.
  The star is very bright: SPHEREx core pixels may be saturated and WISE W1/W2 of a
  star this bright can saturate too, so treat these as lower limits.
- R Draconis (job 563c...): 38 SPHEREx (all in one pass) and 82 WISE measurements.
  At radius 2 the SPHEREx fluxes are consistent with zero or negative (median
  -26 in all detectors pooled), because the bright halo fills the cut-out and the
  annulus is as bright as the aperture. At radius 6 the medians are 300-4000 (D4 to
  D6) and WISE W1 ranges 0.43-4.1 million nanomaggies (9.5x), W2 14x, over
  2010-2024. These are large swings but the cores may be saturated, so no variability
  claim is made.

## Compare epochs, simulator, guided tour

**Compare epochs** (`view=compare`, `frontend/src/compare.ts`). Pick epoch A and B from the
loaded group (default first and last) and view them side by side, with a swipe divider
(keyboard: arrow keys), as a fade, or as a difference map. The difference first removes each
frame's robust background (median) and divides by its robust noise, then shows B minus A with a
blue (dimmer) - white - orange (brighter) scale over +-5 sigma. "Jump to largest change" marks the
pixel with the largest smoothed |difference| / noise outside a 4 px edge border (3x3 box smooth)
and offers to open the spectrum panel there. Plain-text chips say when the peak is at the image
edge, below 5 sigma ("Not enough evidence to classify"), near a Gaia star (when Gaia data is
loaded) or when the two epochs differ in wavelength by more than 0.05 um (a brightness change may be
a colour change). Measured on the cached WISE 0855 job, W2 2010-05-04 vs 2024-04-17: the largest change is
a Gaia-matched moving star at about 67 sigma. URL: `a`, `b` (indices into the group, time order), `cmp=side|swipe|fade|diff`.

**Simulator, test mode** (`frontend/src/simulator.ts`, `clientstack.ts`). "Plant a simulated object" adds a
Gaussian point source (sigma 1 px, brightness in multiples of each frame's own noise) moving at a
chosen velocity, to **copies** of the loaded frames in the browser. The real arrays are never
modified, and switching it off restores them exactly (checked by hashing the drawn frame). Safeguards: a
sticky banner and a watermark on the 3D view, every canvas and the result figures read
"SIMULATED OBJECT - not real data"; the URL carries `sim=1` (and the visible parameters in `simp`;
a hidden planet is never written to the URL); the spectrum and light curve are disabled because
they are measured on real data only. The tilt and the motion map run in the browser on the planted copies
(`clientstack.ts`: bilinear shift-and-stack, per-pixel median removal, fixed-source mask, +-8 sigma
clip, a 3x3 smoothed peak in units of its robust noise: the same recipe as `backend/tilt.py`); the server
endpoints stay real-data only. Velocity can be typed or taken from a distance slider using a
**simplified teaching model** (parallax about 206265 / d_AU arcsec over half a year plus a slow
orbital drift; one documented function with a self-check).

"Hide a planet for me" plants an object with hidden random velocity and start (bright 10, medium 6, faint 4 times
the noise), "Check my answer" scores the velocity left in the tilt boxes (within one grid step is
found) and reveals the truth. Measured on WISE W2 of WISE 0855 (23 frames over 14 years, span 12, step 1,
second peak after excluding the real WISE 0855 peak at (-8, +1)): bright 6/6, medium 5/6, faint 0/6. The real
mover also shows on the map, so it is not your planet. The game needs a long baseline: on SPHEREx
groups (about a year) it declines, because slow tracks would be mistaken for fixed stars.
Whole-map search takes about 4 s for 625 velocities and 23 frames.

**Guided tour** (`tour.ts`): "Start exploring" (header and empty state) runs five steps in a
small non-modal panel (Next, Back, Close, Escape): load the cached WISE 0855 cube, choose W2, play,
Use catalogue motion (snaps into focus), and an invitation to the simulator. It never starts a build
other than the cached default WISE 0855 job. A glossary ("How this works", `glossary.ts`) explains the terms.

## Deployment, status badge, kiosk, hardware

- **Deployment.** `Dockerfile` (multi-stage), `.dockerignore` and `docs/DEPLOY.md` (local, Docker,
  a generic free-tier host, Jetson Orin Nano, how to ship the pre-built cache). Tested: local run
  and the test suite. **Untested: the Dockerfile** (Docker was not installed), the free-tier
  host and the Jetson steps. Nothing has been deployed.
- **Public-service hardening.** `POST /api/jobs` allows 6 new builds per IP per 10 minutes
  (`SPHEREX_RATE_MAX`, `SPHEREX_RATE_WINDOW_S`; 429 with a plain message; cached or running
  jobs are not counted), JSON is gzipped, built assets carry long cache headers. Tested offline
  in `backend/tests/test_service.py`.
- **Status badge.** `GET /api/status` returns `{mode, archive_ok, cached_targets, active_jobs}`;
  the archive ping is cached for 5 minutes and waits at most 3 s. The header shows "online",
  "data cached" (archive unreachable) or "offline demo" (server unreachable). Cached cubes keep
  working; a failed new build says so in plain words.
- **Kiosk and projection.** `?kiosk=1` returns to the globe after 3 minutes without input and
  hides external links. `?projection=1` uses very large labels, minimal controls and high
  contrast and auto-plays the current cube. The "Full-screen demo" button enters projection
  mode in full screen. With `prefers-reduced-motion` nothing auto-plays. Both flags were
  loaded in a browser with no console errors; the 3-minute idle reset and the projection
  auto-play were not waited for.
- **Hardware bridge.** `/ws/hardware` (`backend/hardware.py`) relays validated JSON between
  devices and browsers; schema in `hardware/EVENTS.md`; `hardware/simulate_device.py` fakes a
  device; `?hw=1` shows a connected/disconnected indicator. The site works fully with no
  hardware. Tested: validation and the two-client relay (TestClient). **Untested:**
  `hardware/esp32_bridge/esp32_bridge.ino` (never compiled or run on a board) and all real
  electronics.

## Candidate search, new images, Pixhawk, help tips

Added 2026-11-14.

**Candidate search** (Candidates tab). `backend/candidates.py` runs the motion map for one band, takes its
local maxima (not the ones within one grid step of zero motion: those are fixed sources that did not
subtract well), stacks the frames at each velocity and refines the position. Each candidate gets a
straight-line motion path: the predicted pixel and RA/Dec in every frame of the job, also in the other
bands, and for today's date. Pick a candidate and open the Blink view: a dashed ring marks where it would
be in the image on screen. The path ignores parallax. Slow movers (less than about one pixel between
frames) stay in the temporal median and are not found; this is the same limit as the motion map.

**Patch model.** `backend/ranker.py` is a small neural network (81 inputs, 12 hidden units, 997 numbers)
that looks at the 9 x 9 pixel patch around a candidate in the stack and says how much it looks like a
point source. It is trained on SIMULATED patches only (point sources, noise peaks, hot pixels, streaks,
positive/negative pairs, wide blobs), with a fixed seed, in about one second at first use. The weights are
cached in `data/cache/models/`. The final order is the motion-map score times (0.25 + 0.75 x shape).
It is a ranking hint. It is not evidence.

**New images.** The archive adds SPHEREx images all the time. Three ways to keep cubes current:

```bash
python -m backend.refresh                     # table: which cached cubes have newer images
python -m backend.refresh --apply             # rebuild those cubes (saved cut-outs are reused)
python -m backend.refresh --apply --loop 12   # do it again every 12 hours
```

Or set `SPHEREX_AUTO_REFRESH_HOURS=12` and the running server does the same on a timer. Or use the
Data tab: "Check now" and "Update cube"; a small orange dot on the tab means newer images exist. A cube
keeps its key and its link. A failed update puts the old cube back. The search does not filter by
collection, so a new quick release is used as soon as the archive serves it; a collection name the code
has not seen is reported as `new_collections`.

**Pixhawk input reader** (optional). `hardware/pixhawk_reader.py` reads MAVLink `RC_CHANNELS` from a
Pixhawk and sends the events of `hardware/EVENTS.md`: right stick = trial motion direction and speed,
yaw = step through the timeline, three switches = stacking order, "Find best motion", "Zero motion".
It only reads; it sends no command to the flight controller. `--simulate` needs no hardware.

**Help tips.** Controls carry a small "?"; point at it, tap it, or focus the control with the keyboard.
The "?" button in the top bar hides them. The text is in `frontend/src/help.ts`.

**Interface.** `frontend/src/shell.ts` owns the floating panels, tabs, the view switch and Focus mode
(button, or key F). Fonts are bundled with the build (no font request leaves the page).

## Auto demo, sound, share, shortcuts, and the cube drawing

Added 2026-11-14.

- **Auto demo.** "Watch the 1-minute demo" runs the five tour steps by itself, about ten seconds each,
  on the saved WISE 0855 cube (real images). A click on the tour card stops the timer. Code: `frontend/src/tour.ts`.
- **Sound.** With "Sound" on, each image on the timeline plays one short tone. The pitch follows the
  brightness at the marked pixel (click the image in the Blink view), or at the image centre, on that
  image's own display scale: about 196 Hz (background) to 1190 Hz (brightest). It is a second way to
  notice a change; it is not a measurement. The tones are made in the browser. Code: `frontend/src/extras.ts`.
- **Share.** Copies the page address, which holds the whole view.
- **Keyboard.** Space = play or pause; left and right = one image; 1 to 5 = views; F = hide the panels.
- **Cube drawing.** Each image that is not on the timeline is drawn as light only: pixels below the 70th
  percentile of that image are transparent, the rest add up through the stack. Colour shows the order
  in the stack (blue = first, orange = last), not the colour of the source. Pixels are drawn as sharp
  squares (nearest-neighbour), with no smoothing. The image on the timeline is drawn in full with a white frame.
  This view is for looking; no result is measured from it.

## Safety limits (hardening)

- **Hardware socket (`/ws/hardware`).** With `SPHEREX_HW_TOKEN` set, every device needs the token (the website does not).
  With no token, a device is accepted only from the same machine or the local network.
  A web page from another site cannot open the socket (the `Origin` must match the site).
  Each socket may send 60 messages per second; a message may be 1024 bytes; 16 sockets at most.
- **Heavy searches.** Motion-map and candidate searches are limited to 40 per address per minute
  (`SPHEREX_ANALYSIS_MAX`). New cube builds keep their own limit (6 per 10 minutes).
- **Limiter memory.** Each limiter holds at most 5000 addresses; old ones are removed.
- **Behind a proxy.** With `SPHEREX_TRUST_PROXY=1` the caller address is read from the right side
  of `X-Forwarded-For` (`SPHEREX_PROXY_HOPS`, default 1), so a caller cannot fake it.
- **CORS.** `SPHEREX_CORS_ORIGINS` narrows which sites may read the API (default: any; the data is
  public and there is no login).
- **Not done:** the ESP32 sketch still sends the token in the URL and uses `ws://` by default.
  Use `wss://` and a token for any device that connects over the internet.
  No dependency scan and no penetration test were made.

## Data assumptions and limitations

- **Real data only.** No synthetic sources in the running app. Tests add a
  Gaussian to cached real frames to measure recovery; that is explicit in the
  test docstrings and never saved as a product.
- **J2000 epoch.** SIMBAD positions are treated as epoch 2000.0. Verified
  empirically: centring on Sesame's Barnard's Star position puts the star
  about 4.5 arcmin north, which is 26 years of its 10.36 arcsec/yr proper motion
  (26 x 10.36 = 269 arcsec = 4.5 arcmin).
- **Passes, not visits.** A 60-day gap defines a pass. SPHEREx revisits roughly
  every six months, so a target with three passes has three time slices per
  detector in the pass-averaged cube.
- **Flags.** Bits 21 (`SOURCE`) and 12 (`FULLSAMPLE`) are not masked. Their
  meaning is documented in the FLAGS header of each cut-out (read 2026-11-13).
  Bright star cores carry `TRANSIENT`, `OVERFLOW` and `BLOOM`; they are masked
  and filled by interpolation, so the peak of a bright star is too low.
- **Cache state.** The five 40-frame cubes were rebuilt with
  `python -m backend.precache --force` on 2026-11-14, so they carry the interpolation
  fill and a saved mask per SPHEREx frame. Older, smaller cubes in the cache may not.
  A job that failed or is stuck (for example a "Custom position" build left "running"
  after a server restart) stays that way; posting it again does not retry it.
- **Background.** ZODI subtraction plus a robust median is a simple model; it
  does not fit extended emission or bright-star wings.
- **Coverage.** Frames with < 55 % valid coverage after reprojection are
  dropped. The masked fraction is reported per frame.
- **Wavelengths.** The per-frame λ comes from the `WAVE-TAB` WCS at the target
  position; the detector ranges in the table are nominal, from obscore
  `em_min`/`em_max`.
- **Tilt is a score, not a detection.** A high score can come from a variable
  star, a cosmic ray, a background gradient, or an artefact moving with the
  scan. The evidence checklist and Gaia overlay help, but there is no automatic
  catalogue cross-match or multi-band confirmation.
- **3D view.** It is a visualisation of the same arrays; it is not used to
  compute motion and its perspective is not to scale.
- **No upsample above 2×.** The default grid is at the native pixel scale.
- **Politeness.** At most 4 concurrent archive requests, a descriptive
  User-Agent, retries with backoff, and an on-disk cache. Cut-outs are ~4.5 MB
  of FITS each; a 20-frame cube is ~80 MB before alignment.
- **No authentication or paid services.** Everything runs locally.

## Open questions

- Should bright-star cores keep their measured (flagged) values instead of an
  interpolated fill? This matters for the brightness charts of RW Aurigae and
  R Draconis.
- The tilt score is the peak of the stack. One bright fixed star can hold the
  peak, so the score does not change with velocity (seen on Barnard's Star in
  D1, D3, D4). The motion map (below) uses a different score that ignores fixed
  stars; the tilt panel still reports the plain peak.
- Does `spherex_dr1` or `spherex_qr3` give better photometry for the reddest
  targets? The cubes mix both collections today (see "How a cube is made").
- How should candidate motion be verified? A multi-band table, a
  signal-to-noise threshold and a cross-match against SIMBAD are not built yet; the
  evidence checklist and the Gaia overlay are the current aids.
- WISE 0855: SPHEREx alone does not show it clearly, and a field star is
  1–2 pixels from where it is now. The WISE baseline carries this demo.
- Is a 0.2° cut-out the right trade-off? It keeps the cube small, but fast
  movers such as Barnard's Star can leave the field between passes if the
  centring epoch is wrong; the 2026.5 propagation is a compromise.

## Unverified

- The WebGL scenes were checked through the DOM, network calls, console (no errors)
  and rendered 2D canvases in the in-app browser, not pixel by pixel. That browser
  pane was hidden at times, so timings measured in it are not reliable.
- The flagged column is "unknown" for every WISE frame: the unWISE coadds carry no
  mask product, so no mask is stored for them.
- The Dockerfile, the ESP32 sketch, the VizieR paths (Hipparcos stars, Gaia fallback)
  and the "data cached" and "offline demo" badge states were never exercised.
- The exact flag semantics and the WAVE-TAB calibration accuracy are taken from
  the archive products, not validated against mission papers.
- The five-target visibility table is a screening summary (a stack S/N at one
  predicted pixel), not a cross-validated catalogue result.

## Repository layout

```
backend/
  app.py        FastAPI routes + static frontend mount
  resolve.py    Sesame lookup, J2000 epochs, proper-motion propagation
  spherex.py    TAP search, DataLink/IBE cut-outs, WAVE-TAB wavelengths
  align.py      common WCS grid, reprojection, background, FLAGS mask
  group.py      pass clustering, detector groups, slice averaging
  tilt.py       exact sub-pixel shift-and-stack, sharpness, motion-map grid
  jobs.py       background pipeline, job state, contact sheets
  wise.py       unWISE time-resolved W1/W2 epochs on the job grid
  gaia.py       Gaia DR3 cone search, proper motion, pixel positions
  extras.py     router: /api/jobs/{key}/gaia and /photometry, /api/jobs, /api/resolve, /api/sky/bright_stars
  precache.py   five-target CLI, JSON summary
  tests/        synthetic + real-frame tilt tests
frontend/
  src/cube.ts   three.js time cube (planes, labels, camera presets)
  src/main.ts   form, playback, tilt fetch, result panels
  src/wise.ts   WISE labels, 16-year movie frame selection, per-frame stretch
  src/gaia.ts   Gaia ring overlay with hover/keyboard readout
  src/checklist.ts  evidence checklist for a tilt peak
  src/state.ts  URL state
  src/scenes.ts, src/globe.ts, src/orbit.ts  sky globe, orbit view and scene switching
  src/picker.ts click/keyboard pixel picker; src/spectrumpanel.ts panel
  src/spectrum.ts, src/pulse.ts, src/photometry.ts, src/chartkit.ts  canvas charts (no chart library)
  src/colormap.ts  blue/orange stretch, shared by cube and result
data/
  cache/        raw FITS, aligned .npy frames, cubes, jobs (git-ignored)
  precache_summary.json
```

## AI assistance

This project was built with AI assistance. Every generated source file starts
with a one-line `AI-assistance:` comment, and this section records what that
means in practice:

- The backend, frontend, tests, and documentation were drafted with an AI
  coding assistant (OpenCode / Claude), then run and corrected against the live
  archive.
- Scientific choices were checked empirically where possible: the J2000 epoch
  from the Barnard's Star offset, the choice of cubic interpolation from the
  bilinear bias measurement, and the flag-bit assumption from occupancy counts.
- No AI-generated claim about a specific object is presented as a discovery.
  The tool reports **candidates**; all measurements are reproducible from the
  cached FITS files and the commands in this README.
- Errors and limitations are listed above rather than hidden; anything not
  verified is called out explicitly.

See `REFERENCES.md` for the services, papers, and software used.
