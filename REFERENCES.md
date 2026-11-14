# References

All links checked 2026-11-13. Version numbers are the ones actually installed
and used for the M0–M4 slice.

## Mission and archive

- NASA SPHEREx mission overview — <https://www.jpl.nasa.gov/missions/spherex/>
- SPHEREx at IPAC/IRSA — <https://irsa.ipac.caltech.edu/Missions/spherex.html>
- IRSA Table Access Protocol (TAP) — <https://irsa.ipac.caltech.edu/TAP/>
  - Sync endpoint used: `https://irsa.ipac.caltech.edu/TAP/sync`
  - Table used: `spherex.obscore` (ObsCore view)
  - Collections used or seen at the time of writing: `spherex_dr1`, `spherex_qr3`,
    `spherex_dr1_deep` (and, in the R Draconis cube, `spherex_qr3_deep`); `spherex_qr_cal` is
    listed as known but no cube used it
- IRSA Image Cutout Service (IBE) — <https://irsa.ipac.caltech.edu/ibe/>
  - Cut-out pattern: `?center=RA,DEC&size=DEG`
  - Layers read: `IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`
- SPHEREx DataLink service — <https://irsa.ipac.caltech.edu/datalink/links/spherex>
  (used as a fallback when IBE cannot serve a plane)
- NASA Space Apps Challenge 2026, *Planet X and SPHEREx* — challenge brief and
  judging criteria (team-supplied PDF).

Data licence: NASA/IPAC IRSA products are publicly available and may be used
and redistributed with attribution; credit the archive as "NASA/IPAC IRSA
SPHEREx". No restricted data are used.

## Mission and instrument papers

- Crill, B. P., et al. 2020, "SPHEREx: NASA's near-infrared spectrophotometric
  all-sky survey", Proc. SPIE 11443, 114430I.
  <https://doi.org/10.1117/12.2567224>
- SPHEREx Explanatory Supplement (IRSA), for the definition of the six
  detectors, the ~6.15 arcsec pixel scale, and the data products.
  <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/>

## Catalogues and name resolution

- CDS Sesame — <https://cds.unistra.fr/cgi-bin/nph-sesame>
  - Endpoint used: `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?<name>`
- SIMBAD astronomical database — Wenger et al. 2000, A&AS, 143, 9.
  <https://simbad.cds.unistra.fr/>
- Gaia Collaboration 2023, "Gaia Data Release 3", A&A, 674, A1.
  <https://doi.org/10.1051/0004-6361/202243940>
  (proper motions surfaced through SIMBAD for the named targets)
- General Catalogue of Variable Stars — Samus, N. N., et al. 2017, Astronomy
  Reports, 61, 80 (R Draconis is a variable star).
- Luhman, K. L. 2014, "Discovery of a ~250 K Brown Dwarf at 2 pc from the Sun",
  ApJL, 786, L18. <https://doi.org/10.1088/2041-8205/786/2/L18>
  (WISE 0855−0714)

## WISE/NEOWISE and Gaia (frontend labels)

- unWISE time-resolved coadds of WISE/NEOWISE W1/W2 epochs (2010-2024), Meisner,
  Lang, Schlegel et al.; data folder <https://unwise.me/>. (Paper citation not
  re-verified on 2026-11-13: check before quoting it in a report.)
- Wright, E. L., et al. 2010, AJ, 140, 1868 (WISE). <https://doi.org/10.1088/0004-6256/140/6/1868>
- Gaia DR3 through the ESA Gaia archive TAP service,
  <https://gea.esac.esa.int/tap-server/tap>; positions at epoch 2016.0
  propagated with catalogue proper motion for the ring overlay.
- Median-subtracted shift-and-stack for movers: the standard "remove the static
  sky, stack along trial motions" approach also used in WISE/NEOWISE brown-dwarf
  searches (e.g. Luhman 2014 above); the code here is our own, see `backend/tilt.py`.

## Software

- Astropy Collaboration 2022, "The Astropy Project: Sustaining and Growing a
  Community-developed Python Astronomy Package", ApJ, 935, 167.
  <https://doi.org/10.3847/1538-4357/ac7c74> — astropy 8.0.2 (BSD-3-Clause)
- pyvo — <https://pyvo.readthedocs.io/> — 1.10.0 (GPL-3.0)
- reproject — <https://reproject.readthedocs.io/> — 0.21.0 (BSD-3-Clause)
- SciPy — Virtanen, P., et al. 2020, Nature Methods, 17, 261.
  <https://doi.org/10.1038/s41592-019-0686-2> — scipy 1.18.0 (BSD-3-Clause)
- NumPy — Harris, C. R., et al. 2020, Nature, 585, 357.
  <https://doi.org/10.1038/s41586-020-2649-2> — numpy 2.5.2 (BSD-3-Clause)
- FastAPI — <https://fastapi.tiangolo.com/> — 0.136.3 (MIT)
- Uvicorn — <https://www.uvicorn.org/> — 0.49.0 (BSD-3-Clause)
- HTTPX — <https://www.python-httpx.org/> — 0.28.1 (BSD-3-Clause)
- Matplotlib — Hunter, J. D. 2007, Computing in Science & Engineering, 9, 90 —
  3.11.0 (PSF-compatible; contact sheets, headless Agg)
- three.js — <https://threejs.org/> — 0.171.0 (MIT; 3D time cube)
- Vite — <https://vitejs.dev/> — 6.x (MIT)
- TypeScript — <https://www.typescriptlang.org/> — 5.x (Apache-2.0)

## WISE / NEOWISE baseline and Gaia (added 2026-11-13)

- unWISE time-resolved coadds, release neo11 (epochs 2010-2024; neo7 ends 2020) —
  files at <https://portal.nersc.gov/project/cosmo/temp/ameisner/neo11/>
  (`unwise.me/tr_neo2` redirects into this tree), tile atlas
  `time_resolved_neo11-atlas.fits`. Meisner, A. M., Lang, D., Schlafly, E. F.,
  & Schlegel, D. J. 2018, "Time-resolved WISE/NEOWISE Coadds",
  <https://arxiv.org/abs/1710.02526> (MNRAS 477, 1). Licence: public data from
  the unWISE project; no explicit licence is stated on the server. Credit
  "unWISE (Lang 2014; Meisner et al.)" and NASA/IPAC IRSA for WISE/NEOWISE.
- unWISE coadds: Lang, D. 2014, AJ, 147, 108, <https://arxiv.org/abs/1405.0308>;
  Meisner, A. M., et al. 2019, PASP, 131, 124504,
  <https://arxiv.org/abs/1909.05444>; unTimely catalog, Meisner et al. 2023,
  <https://arxiv.org/abs/2209.14327>, IRSA DOI
  <https://doi.org/10.26131/IRSA580>.
- WISE: Wright, E. L., et al. 2010, AJ, 140, 1868,
  <https://doi.org/10.1088/0004-6256/140/6/1868> (band wavelengths used:
  W1 3.4 um, W2 4.6 um). NEOWISE: Mainzer, A., et al. 2014, ApJ, 792, 30.
  WISE/NEOWISE data are public domain NASA data (credit NASA/JPL-Caltech/UCLA).
- Gaia DR3 via the ESA Gaia archive TAP —
  <https://gea.esac.esa.int/tap-server/tap/sync>, table `gaiadr3.gaia_source`.
  Gaia Collaboration 2023, A&A, 674, A1. Licence: CC BY-SA 3.0 IGO; credit
  "ESA/Gaia/DPAC". Fallback (coded, not verified): VizieR TAP
  <https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync>, catalogue I/355/gaiadr3.
- No new Python packages: astropy, reproject, scipy, httpx were already pinned.

## Methods

- Shift-and-stack / "move-stack" astrometry: standard technique for recovering
  moving sources in a series of images; see e.g. Bernstein, G. M., & Khushalani,
  B. 2007, PASP, 119, 392, on efficient shift-and-stack searches.
  <https://doi.org/10.1086/512193>
- Reprojection onto a common tangent-plane grid: reproject's
  `reproject_interp` / WCS utilities.
- Robust background and noise: median absolute deviation (MAD) scaled by
  1.4826.

## Spectrum and pulse view (added 2026-11-14)

- Molecule presets (H2O ice about 3.0 um, CH4 about 3.3 um and 1.6, 2.2 um, PAH 3.3 um,
  CO2 about 4.27 um, CO about 4.67 um) are approximate general astronomy knowledge,
  not taken from a specific table and not fitted to SPHEREx data. They are marked
  "approximate" in the app. No citation is claimed.
- Aperture photometry with a local annulus median and a MAD noise estimate is
  textbook practice; the code is our own (`backend/extras.py`).
- Colour palette for passes and detectors: Okabe, M. & Ito, K. 2008, "Color Universal
  Design" (colour-blind-safe palette, red and green not used together).


## Sky globe and orbit view (added 2026-11-14)

- Bright-star catalogue for the sky globe: the Hipparcos Catalogue, ESA 1997, ESA SP-1200
  (VizieR table I/239/hip_main, V < 4.5, ICRS positions at epoch J1991.25), queried once
  through the VizieR TAP service at CDS and cached in `data/cache/sky/bright_stars.json`.
  VizieR: Ochsenbein, Bauer & Marcout 2000, A&AS, 143, 23. Hipparcos data are free to use with
  acknowledgement of ESA and the Hipparcos consortium. Star names for 25 well-known stars are
  our own HIP-number lookup (`backend/extras.py`).
- Fallback list (used only when VizieR cannot be reached, and labelled "fallback" in the app):
  25 well-known bright stars with standard J2000 positions typed in from general astronomy
  knowledge (rounded to 0.001 degrees); not taken from one citable table.
- Galactic-to-equatorial rotation for the galactic equator: the standard J2000 matrix from the
  Hipparcos Catalogue documentation (ESA 1997, vol. 1, section 1.5.3). Obliquity of the ecliptic
  23.4393 degrees (J2000).
- Parallax (p in arcsec = 1 / d in parsecs; p ~ 206265 / d for d in AU) is textbook geometry.
  The literature parallaxes preset in the orbit view (Barnard's Star 0.547 arcsec, WISE 0855 0.449
  arcsec, Epsilon Indi about 0.274 arcsec) are approximate values from memory of the literature,
  labelled "approximate" in the app and not read from a table by this project.
- SPHEREx pixel size 6.15 arcsec: SPHEREx mission documentation (IRSA / Caltech). No images,
  textures or logos are bundled for either scene.

- Arduino sketch libraries (hardware/esp32_bridge, untested): "WebSockets" by Markus Sattler
  (arduinoWebSockets, LGPL-2.1), "ArduinoJson" by Benoit Blanchon (MIT), "Adafruit NeoPixel"
  (LGPL-3.0), Espressif Arduino-ESP32 core (LGPL-2.1). Licences recalled from memory; check
  each repository before redistributing. Python `websockets` 16.0 (BSD-3-Clause) is used by
  uvicorn for WebSocket support and by hardware/simulate_device.py.

## Interface fonts and Pixhawk input (added 2026-11-14)

- Bricolage Grotesque, by Mathieu Triay. SIL Open Font License 1.1. Bundled through Fontsource
  (`@fontsource-variable/bricolage-grotesque`). https://fontsource.org/fonts/bricolage-grotesque
- Instrument Serif, by Rodrigo Fuenzalida and Jordan Egstad for Instrument. SIL Open Font License 1.1.
  Bundled through Fontsource (`@fontsource/instrument-serif`). https://fontsource.org/fonts/instrument-serif
- JetBrains Mono, by JetBrains. SIL Open Font License 1.1. Bundled through Fontsource
  (`@fontsource-variable/jetbrains-mono`). https://fontsource.org/fonts/jetbrains-mono
- MAVLink common message set, `RC_CHANNELS` (#65): the stick and switch pulse widths read by
  `hardware/pixhawk_reader.py`. https://mavlink.io/en/messages/common.html#RC_CHANNELS
- pymavlink (optional, only for a real Pixhawk; LGPL-3.0). https://github.com/ArduPilot/pymavlink
