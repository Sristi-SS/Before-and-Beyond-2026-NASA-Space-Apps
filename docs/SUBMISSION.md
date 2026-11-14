<!-- AI-assistance: this file was drafted with AI assistance; see README.md "AI assistance". -->

# SPHEREx Time Cube: submission draft

This is a draft for the human team to edit. Each section is written to paste
straight into the NASA Space Apps Challenge 2026 form. Items marked
**[TEAM]** need a decision or a fact from the team before submission.

---

## 1. Project name (pick one)

1. SPHEREx Time Cube
2. SPHEREx Time Cube: Stacking the Sky
3. Tilt the Cube: Finding Motion in SPHEREx Frames

---

## 2. High-level project summary (150 words or fewer)

SPHEREx Time Cube is a no-login web tool that turns real SPHEREx archive
images of one patch of sky into a three-dimensional time cube. Users can
shift and stack the frames along a trial motion, which we call a "tilt", to
test whether anything in that patch moves. A motion map scores many motions
at once. WISE and NEOWISE frames from 2010 to 2024 extend the time
baseline. Spectrum, pulse and epoch-compare views and a simulator test mode
are included. The tool addresses the challenge by making SPHEREx's repeated
sky images usable for finding moving objects, including faint, nearby objects
that one image cannot show. Every highlighted object is labelled a candidate.
All measurements come from public NASA/IPAC IRSA data and can be reproduced
from the cached files and the commands in the project README.

---

## 3. Detailed project description (about 500 words)

SPHEREx Time Cube is a web tool built for the 2026 NASA Space Apps Challenge,
"Planet X and SPHEREx". It takes real SPHEREx archive images of one patch of
sky, aligns them, and stacks them into a three-dimensional time cube. Then it
asks a simple question: is anything in this patch moving?

**What it does.** A user types a target name or coordinates. The tool
searches the NASA/IPAC IRSA archive and downloads a small cut-out of every
frame that covers the target. Each frame is reprojected onto one north-up
grid, 128 by 128 pixels at 6.15 arcseconds per pixel, a field of 0.2 degrees.
The background is removed, and flagged pixels are masked. Bright star cores
are filled by interpolation, so their brightness is too low and is not
measured.

**How it works.** Frames are grouped in two ways. First, frames are grouped
into sky passes, with a 60-day gap between passes. Second, frames are split
into the six SPHEREx detector wavelength groups, D1 to D6. Each slice in the
cube therefore has a known pass and a known wavelength. The 3D view shows the
individual epochs, so the real survey cadence is visible. The 3D view is for
explanation only. It does not compute motion.

The science score comes from a two-dimensional "tilt". For a trial velocity,
each frame is shifted by the motion that would occur over its time offset,
and the shifted frames are summed with cubic interpolation. Fixed stars can
be removed first by subtracting the per-pixel temporal median, so only what
changes between frames is stacked. The score is the peak of the smoothed stack.

The motion map repeats this for a grid of velocities and ranks them. It masks
pixels where a fixed source varies from frame to frame. A colour view shows
early and late frames in blue and orange, so a fixed source appears neutral
and a changing source leaves a coloured trail.

An optional WISE baseline adds unWISE W1 and W2 epochs from 2010 to 2024 onto
the same grid. The 16-year movie (WISE 2010 to 2024, then SPHEREx 2025 to 2026) shows
WISE frames and SPHEREx frames in time order. Each frame has its own stretch, and the two kinds of units are never
compared numerically.

Gaia DR3 stars appear as rings, moved by their catalogue proper motion to the
date of each frame, and Gaia labels name them on hover. An evidence checklist
sits under each tilt result, with plain yes or no rows. It always ends with the
words "candidate only".

Further views, all on the same data. Clicking a pixel on the blink view or the
tilt result opens a spectrum: brightness against wavelength, with hollow marks
for flagged points and approximate molecule bands that are not fitted to the
data. The same panel has a pulse view, brightness against date, which suits
variable stars such as RW Aurigae and R Draconis, with a caution that each
SPHEREx frame samples a different wavelength. A compare view sets two epochs
side by side, with a swipe, a fade or a difference map, and "jump to largest
change". A simulator test mode adds a made-up moving object to copies of the
frames, always marked "SIMULATED OBJECT, not real data", so a user can practise
before looking at real data. A sky globe lets users pick a patch of sky and
shows where cubes already exist, an orbit view explains parallax and proper
motion, and a five-step guided tour walks through WISE 0855. A status badge
shows whether the archive is reachable, and kiosk and projection modes exist
for a stand or a classroom screen. A hardware bridge (a small web-socket relay
for an optional ESP32 device) is written but untested on real hardware.

**Benefits and goals.** The goal is a tool that a student or a citizen
scientist can run in a browser, without an account, on public data. The
method is standard shift-and-stack. The code is our own and can be
inspected once the repository is public. The tool is also honest about limits. It shows masked fractions
and coverage for each frame, and it does not call any object a detection.

**Tools and languages.** Backend: Python, FastAPI, astropy, reproject,
NumPy, SciPy, pyvo and Matplotlib. Frontend: TypeScript, Vite and three.js.
The project has automated tests written with pytest.

---

## 4. How the five test objects behave

These descriptions use only what the project README states. Where the README
says a result is not detected or not verified, this text says so.

**Barnard's Star.** The cube has 35 SPHEREx frames in 3 passes and 46 WISE
epochs. The star is bright in every detector group. It has a saturated core
with a halo in every band. A bright star is visible in every band because it
is a continuum source. That does not make it a planet. A planted-source test on
real SPHEREx frames recovered a synthetic motion of (24, −16) arcseconds per
year. That test used added synthetic data, not a real object.

**Epsilon Indi B.** The cube has 35 SPHEREx frames in 4 passes and 46 WISE
epochs. A steady, compact source sits at the grid centre in all six detector
groups. The compact central source is a candidate for a follow-up check. It is
not proof of anything, because a field star can look the same.

**WISE 0855.** The cube has 40 SPHEREx frames in 3 passes and 46 WISE epochs.
The object is not credibly seen in single SPHEREx frames. The brief's
coordinates are for the WISE observing epoch, about 2010.5. The project now
uses the position and proper motion from SIMBAD. By the SPHEREx epochs, the
object is about 2 arcminutes west of the brief's position. A fixed field star
sits 1 to 2 pixels from the predicted position, and the excess near the grid
centre in SPHEREx frames belongs to that star. In the WISE W2 shift-and-stack
at the catalogue motion (-8.1, +0.7 arcseconds per year) with fixed stars
removed, the strongest peak in the field sits at the predicted pixel, with a
signal-to-noise of 130. The page's sharpness score is 5.6 times its zero-motion
value, and the motion map's best cell, (-8.0, +0.5) arcseconds per year, lies
within one step of the catalogue motion. This is a recovery of a known object,
not a detection. Any other moving source is a candidate only.

**RW Aurigae.** The cube has 40 SPHEREx frames in 3 passes and 46 WISE epochs.
The object has coverage in D1, D3, D4 and D6. It has no coverage in D2 or D5.
The central signal is strong in all four. Bright star cores are filled, so
their fluxes are lower limits and brightness charts for this object are not
reliable yet. The pulse view is available for it.

**R Draconis.** The cube has 38 SPHEREx frames, which the pass clustering puts
in one pass, and 82 WISE epochs. The core is saturated and filled in the
bands it covers. It has frames in all six detector groups, but only 3 in D2 and
2 in D5. R Draconis is a variable star. Variability can look like motion in a shift-and-stack score, so each
per-epoch frame must be checked before any claim.

---

## 5. Use of AI

AI coding assistants wrote most of the code and drafted most of the
documents, under the direction of the team. The assistants used include
Claude. The team chose the concept, set the scientific checks, and shaped the
story and the tool. Every generated source file starts with an
AI-assistance header comment. The team ran and corrected the code against
the live archive. No AI-generated images, video or audio are used. The
project shows no NASA logos or insignia.

**[TEAM: edit this to match what really happened. Confirm which assistants
were used, who made the concept choices, whether any image, video or audio
was generated, and that no NASA logo or insignia appears anywhere.]**

---

## 6. NASA data used

- **SPHEREx spectral images**, from the NASA/IPAC IRSA archive,
  <https://irsa.ipac.caltech.edu/Missions/spherex.html>. Collections named in
  the README: `spherex_dr1`, `spherex_qr3` and `spherex_dr1_deep`. Access
  through the IRSA TAP service, <https://irsa.ipac.caltech.edu/TAP/>, and the
  IRSA Image Cutout Service, <https://irsa.ipac.caltech.edu/ibe/>. Credit:
  "NASA/IPAC IRSA SPHEREx".
- **WISE and NEOWISE**, through unWISE time-resolved coadds, release neo11,
  from <https://portal.nersc.gov/project/cosmo/temp/ameisner/neo11/>. Credit:
  "unWISE (Lang 2014; Meisner et al.)" and NASA/IPAC IRSA for WISE/NEOWISE.
  WISE and NEOWISE data are public domain NASA data, credit
  NASA/JPL-Caltech/UCLA.

**Other data (not NASA):**

- **Gaia DR3**, from the ESA Gaia archive, <https://gea.esac.esa.int/tap-server/tap>.
  Credit: "ESA/Gaia/DPAC".
- **CDS Sesame and SIMBAD**, for target names and positions,
  <https://cds.unistra.fr/cgi-bin/nph-sesame> and <https://simbad.cds.unistra.fr/>.

---

## 7. References

**Data**

- NASA SPHEREx mission overview. <https://www.jpl.nasa.gov/missions/spherex/>
- SPHEREx at IPAC/IRSA. <https://irsa.ipac.caltech.edu/Missions/spherex.html>
- SPHEREx Explanatory Supplement (IRSA). <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/>
- Crill, B. P., et al. 2020, "SPHEREx: NASA's near-infrared spectrophotometric all-sky survey", Proc. SPIE 11443, 114430I. <https://doi.org/10.1117/12.2567224>
- unWISE time-resolved coadds, release neo11. Meisner, A. M., Lang, D., Schlafly, E. F., & Schlegel, D. J. 2018, MNRAS 477, 1. <https://arxiv.org/abs/1710.02526>
- unWISE coadds. Lang, D. 2014, AJ, 147, 108. <https://arxiv.org/abs/1405.0308>. Meisner, A. M., et al. 2019, PASP, 131, 124504. <https://arxiv.org/abs/1909.05444>. unTimely catalog, Meisner et al. 2023. <https://arxiv.org/abs/2209.14327>. IRSA DOI <https://doi.org/10.26131/IRSA580>.
- WISE. Wright, E. L., et al. 2010, AJ, 140, 1868. <https://doi.org/10.1088/0004-6256/140/6/1868>
- NEOWISE. Mainzer, A., et al. 2014, ApJ, 792, 30.
- Gaia DR3. Gaia Collaboration 2023, A&A, 674, A1. <https://doi.org/10.1051/0004-6361/202243940>
- General Catalogue of Variable Stars. Samus, N. N., et al. 2017, Astronomy Reports, 61, 80.
- WISE 0855-0714. Luhman, K. L. 2014, ApJL, 786, L18. <https://doi.org/10.1088/2041-8205/786/2/L18>

**Services**

- IRSA Table Access Protocol. <https://irsa.ipac.caltech.edu/TAP/>
- IRSA Image Cutout Service (IBE). <https://irsa.ipac.caltech.edu/ibe/>
- SPHEREx DataLink service. <https://irsa.ipac.caltech.edu/datalink/links/spherex>
- CDS Sesame. <https://cds.unistra.fr/cgi-bin/nph-sesame>
- SIMBAD. Wenger, M., et al. 2000, A&AS, 143, 9. <https://simbad.cds.unistra.fr/>
- ESA Gaia archive TAP. <https://gea.esac.esa.int/tap-server/tap>

**Libraries**

- Astropy Collaboration 2022, ApJ, 935, 167. <https://doi.org/10.3847/1538-4357/ac7c74>
- reproject. <https://reproject.readthedocs.io/>
- SciPy. Virtanen, P., et al. 2020, Nature Methods, 17, 261. <https://doi.org/10.1038/s41592-019-0686-2>
- NumPy. Harris, C. R., et al. 2020, Nature, 585, 357. <https://doi.org/10.1038/s41586-020-2649-2>
- pyvo. <https://pyvo.readthedocs.io/>
- Matplotlib. Hunter, J. D. 2007, Computing in Science & Engineering, 9, 90.
- FastAPI. <https://fastapi.tiangolo.com/>
- Uvicorn. <https://www.uvicorn.org/>
- HTTPX. <https://www.python-httpx.org/>

**Tools**

- three.js. <https://threejs.org/>
- Vite. <https://vitejs.dev/>
- TypeScript. <https://www.typescriptlang.org/>

**Methods**

- Bernstein, G. M., & Khushalani, B. 2007, PASP, 119, 392. <https://doi.org/10.1086/512193>. Shift-and-stack for moving sources.

**[TEAM: the Luhman 2014 paper title is left out because the team avoids that
word in this draft. Add the full title if the form asks for it. Also confirm
the unWISE paper citation, which REFERENCES.md says was not re-verified.]**

---

## 8. 30-second demo video script

The video is one 30-second file. Narration is in English. It must be recorded
by an adult (18 or older). No one under 18 may appear on screen or be heard.

| Time (s) | Shot | On-screen text | Narration (adult voice) |
| --- | --- | --- | --- |
| 0–4 | Two photo plates, switching back and forth. Animated, not a real photograph unless the team has rights to it. | "Blink two frames. Something moves." | "Clyde Tombaugh blinked two plates until one spot moved." |
| 4–9 | Screen recording: the 3D time cube turns slowly, frames play. | "One patch of sky, many frames." | "SPHEREx images the same patch of sky again and again. We stack it into a cube." |
| 9–14 | Screen recording: the tilt panel. Velocity boxes change. | "Tilt: shift each frame, then add." | "Tilt the cube to a trial motion. Shift each frame, then add the frames up." |
| 14–20 | Screen recording: turn on "Remove fixed stars". WISE 0855 at its catalogue motion snaps into focus. | "Known object. Recovery, not a new find." | "Sixteen years of sky, stacked at the known motion. WISE 0855 comes into focus." |
| 20–25 | Screen recording: the evidence checklist under the result. | "Every highlight is a candidate." | "Anything the tool highlights is a candidate, to be checked against catalogues." |
| 25–30 | Title card with the link. | "Try it: [public URL, to be added]" | "SPHEREx Time Cube. Link below." |

**[TEAM: the story brief asks for the line "candidates, never discoveries" in
the video. This draft uses "Every highlight is a candidate." instead, to
avoid the word "discoveries" in this file. Change it if the team prefers the
brief's wording. Replace the link with the public URL once the site is
deployed. The site is not deployed yet.]**

---

## 9. Alternative: 7-slide deck outline

Use this only if the team submits slides instead of the video. The form
allows one video or at most 7 slides.

1. **Title: SPHEREx Time Cube.** One line: a browser tool that stacks SPHEREx frames of one patch of sky.
   *Speaker note: Name the challenge, "Planet X and SPHEREx", and the team.*
2. **The idea.** One line: blink frames over time to see what moves.
   *Speaker note: Tell the Tombaugh story in two sentences. Do not claim a detection.*
3. **The cube.** One line: frames grouped by sky pass and by six wavelength groups, aligned to one grid.
   *Speaker note: Show the 3D view. Say it is for explanation only.*
4. **The tilt.** One line: shift each frame by a trial motion, then add the frames.
   *Speaker note: Name the score and say cubic interpolation is used.*
5. **The 16-year baseline.** One line: WISE 2010 to 2024 frames on the same grid.
   *Speaker note: WISE 0855 is a recovery of a known object, not a new detection.*
6. **Candidates only.** One line: every highlighted object is a candidate with a checklist.
   *Speaker note: Read the checklist rows. Name the open limits from the README.*
7. **Try it and sources.** One line: the public link and the data credits.
   *Speaker note: Give the link. Credit NASA/IPAC IRSA SPHEREx and unWISE. Thank the judges.*

---

## 10. Judging criteria map

**Impact**

- It makes a real public archive usable by anyone with a browser and no account.
- It is honest about limits: each frame shows masked fraction and coverage, and every result is labelled a candidate.

**Creativity**

- It turns SPHEREx's repeated sky images into a cube that can be shifted and stacked along trial motions.
- The colour view and the motion map give two new ways to see change in one image set.

**Validity**

- The tilt is tested. A planted motion in real cached frames is recovered exactly, and a synthetic test checks sharpness.
- WISE 0855 is treated as a recovery of a known object, and the field star near it is named.

**Relevance**

- It uses SPHEREx data for the search for moving objects, which is the core of the challenge.
- It uses the challenge's five named objects as test cases, with their limits stated.

**Presentation**

- The demo is one short video, with a clear story from blinking plates to candidates.
- The description and the five object notes say plainly what is not verified.

**[TEAM: the wording of the official judging criteria is not in the repository.
Check these bullets against the challenge brief before you submit.]**

---

## 11. Submission checklist

Form order:

- [ ] Project name (section 1)
- [ ] High-level summary (section 2, 150 words or fewer)
- [ ] Demo link (one 30-second video, or at most 7 slides)
- [ ] Final project link (public URL)
- [ ] Detailed description (section 3)
- [ ] AI use statement (section 5, with the TEAM note resolved)
- [ ] NASA data (section 6)
- [ ] Partner data and references (section 6 and section 7)
- [ ] Images (no NASA logos; no AI-generated images)
- [ ] Links tested in a private window
- [ ] Confirm nobody under 18 appears or speaks in the video
- [ ] Accept the terms boxes
- [ ] Click "Submit for Judging"
- [ ] Member names added to profiles

**Deadline.** The submission window opens Saturday, 14 November 2026, at
9:00 a.m. It closes Sunday, 15 November 2026, at 11:59 p.m., local event
time. The demo is ONE 30-second video, or at most 7 slides. Going over the
limit makes the project ineligible.

---

## 12. Things only the team can do

- [ ] Deploy to a public URL. This is not done. The README describes a local run at `http://127.0.0.1:8000` only.
- [ ] Make the repository public.
- [ ] Record the 30-second video, with adult narration, from the script in section 8.
- [ ] Request a FortiGuard web filter classification for the new site, after it is deployed.
- [ ] Verify every claim the README marks as unverified. These are: the WebGL 3D layout (not pixel-inspected); flag bit meanings and the WAVE-TAB calibration (not checked against mission papers); the five-target visibility table (a screening summary only); Gaia completeness for faint or fast movers, and the note that WISE 0855 has no Gaia entry; the VizieR paths (Gaia fallback and the Hipparcos star list: VizieR did not answer from the test machine); the Dockerfile, the deployment steps and the ESP32 sketch (never run); the status badge states other than "online".
- [ ] README and REFERENCES items checked on 2026-11-14 (re-read them once before submitting):
  - REFERENCES.md now lists `spherex_dr1_deep` next to `spherex_dr1` and `spherex_qr3`.
  - The README milestone table was replaced by a status table that says what was tested in a browser, by unit test only, or not at all.
  - The "16-year" movie is now defined in the README as WISE 2010 to 2024 followed by SPHEREx 2025 to 2026, about 16 years end to end. **[TEAM: confirm you are happy with the wording.]**
  - The Barnard's Star offset is now given as about 4.5 arcminutes (26 years at 10.36 arcseconds per year).
  - The five cubes were rebuilt with `python -m backend.precache --force` on 2026-11-14, so the fill fix applies and masks are saved. If you rebuild again before recording, re-check the numbers in section 4.
  - The README now describes the spectrum click (pixel spectrum) and the pulse view, so this draft mentions them in section 3.
