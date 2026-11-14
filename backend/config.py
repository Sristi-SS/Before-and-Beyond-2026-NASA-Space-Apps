"""SPHEREx Time Cube backend configuration.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Release pinning.  Verified against the IRSA TAP service on 2026-11-13:
# the obsCore table currently serves both ``spherex_dr1`` (level-2 products)
# and ``spherex_qr3`` (quick-release products).  The tutorials' old
# ``spherex_qr`` collection is *not* what the archive returns today, so the
# release is kept in this single place.
# ---------------------------------------------------------------------------
RELEASE = os.environ.get("SPHEREX_RELEASE", "spherex_dr1")
KNOWN_COLLECTIONS = ("spherex_dr1", "spherex_qr3", "spherex_dr1_deep", "spherex_qr_cal")

TAP_SYNC = "https://irsa.ipac.caltech.edu/TAP/sync"
IBE_BASE = "https://irsa.ipac.caltech.edu/"
DATALINK_BASE = "https://irsa.ipac.caltech.edu/datalink/links/spherex"
SIA_BASE = "https://irsa.ipac.caltech.edu/SIA"

USER_AGENT = os.environ.get(
    "SPHEREX_USER_AGENT",
    "SpherexTimeCube/0.1 (NASA Space Apps 2026 team; contact: team@example.org)",
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SPHEREX_DATA_DIR", ROOT / "data"))
CACHE_DIR = DATA_DIR / "cache"

# Archive etiquette: cap parallel cut-out requests and retry with backoff.
MAX_CONCURRENCY = int(os.environ.get("SPHEREX_CONCURRENCY", "4"))
HTTP_TIMEOUT = float(os.environ.get("SPHEREX_HTTP_TIMEOUT", "180"))
MAX_RETRIES = 5

# Default cube geometry.  SPHEREx native pixels are ~6.15 arcsec; we do not
# upsample by more than a factor of two (the brief's rule).
DEFAULT_NPIX = 128
DEFAULT_PIXSCALE = 6.15
MAX_NPIX = 256
MAX_UPSAMPLE = 2.0

# Detector -> nominal wavelength range (micrometres), from obscore em_min/em_max.
DETECTOR_BANDS = {
    1: (0.7455, 1.1167),
    2: (1.1033, 1.6499),
    3: (1.6301, 2.4346),
    4: (2.4027, 3.8473),
    5: (3.8113, 4.4300),
    6: (4.4115, 5.0096),
}

# FLAGS layer.  The bit names are in the FLAGS header of every cut-out
# (keywords MSKNnnnn / MSKDnnnn), read on 2026-11-13:
#   0 TRANSIENT, 1 OVERFLOW, 2 SUR_ERROR, 6 NONFUNC, 7 DICHROIC, 9 MISSING_DATA,
#   10 HOT, 11 COLD, 12 FULLSAMPLE, 14 PHANMISS, 15 NONLINEAR, 17 PERSIST,
#   19 OUTLIER, 20 CROSSTALK, 21 SOURCE, 22 GHOST, 23 GHOST_FPA, 24 GHOST_EXT,
#   25 STREAK, 26 BLOOM, 27 SNOWBALL, 28 HALO.
# Two bits are information, not contamination:
#   21 SOURCE     "Pixel mapped to a known source"
#   12 FULLSAMPLE "Pixel full sample history is available"
# All other bits are masked.  Bright star cores carry TRANSIENT, OVERFLOW and
# BLOOM, so they are masked and then filled by interpolation (see align.py).
FLAG_NAMES = {
    0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC", 7: "DICHROIC",
    9: "MISSING_DATA", 10: "HOT", 11: "COLD", 12: "FULLSAMPLE", 14: "PHANMISS",
    15: "NONLINEAR", 17: "PERSIST", 19: "OUTLIER", 20: "CROSSTALK", 21: "SOURCE",
    22: "GHOST", 23: "GHOST_FPA", 24: "GHOST_EXT", 25: "STREAK", 26: "BLOOM",
    27: "SNOWBALL", 28: "HALO",
}
BENIGN_FLAG_BITS = (1 << 21, 1 << 12)
MASK_BITS = 0xFFFFFFFF & ~sum(BENIGN_FLAG_BITS)

# Pass clustering: SPHEREx revisits roughly every six months.
PASS_GAP_DAYS = 60.0

# Safety limits for the public service.
MAX_FRAMES_PER_JOB = int(os.environ.get("SPHEREX_MAX_FRAMES", "60"))
MAX_CUTOUT_DEG = 1.0
# Cubes built at the same time.  More requests wait in a queue, so many
# visitors cannot multiply the load on the shared archive.
MAX_ACTIVE_JOBS = int(os.environ.get("SPHEREX_MAX_JOBS", "2"))
# A job on disk that says "running" but has not been written for this long was
# interrupted (server restart).  It is restarted on the next request.
STALE_JOB_SECONDS = float(os.environ.get("SPHEREX_STALE_JOB_SECONDS", "900"))
