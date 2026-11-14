"""Name resolution and proper-motion propagation.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Positions and proper motions were read from CDS Sesame (SIMBAD/Gaia) on
2026-11-13.  SIMBAD reports ICRS coordinates at J2000.0; the catalogue name in
Sesame's ``refPos`` is the astrometric reference, not the epoch of the
coordinates.  We verified this empirically: centring on Sesame's Barnard's Star
position puts the star 4.4 arcmin north, exactly its 26 years of proper motion,
which only makes sense with a J2000 epoch.  Barnard's Star has moved more than
4 arcminutes since 2000.
"""
from __future__ import annotations

import math
import re
from urllib.parse import quote
from dataclasses import dataclass, asdict
from typing import Optional

import httpx

from . import config

SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV"

MAS_PER_DEG = 3.6e6


@dataclass
class Target:
    name: str
    ra_deg: float
    dec_deg: float
    pmra_mas_yr: float = 0.0
    pmdec_mas_yr: float = 0.0
    epoch_year: float = 2000.0
    source: str = "hardcoded"
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        d = asdict(self)
        d["aliases"] = list(self.aliases)
        return d

    def at_year(self, year: float) -> tuple[float, float]:
        """Propagate the position to ``year`` with a small-angle approximation.

        ``pmra_mas_yr`` is the proper motion in RA *times* cos(dec), as SIMBAD
        reports it.  The approximation is exact enough for fields of a degree.
        """
        dt = year - self.epoch_year
        cosd = max(1e-6, math.cos(math.radians(self.dec_deg)))
        ra = self.ra_deg + (self.pmra_mas_yr * dt / MAS_PER_DEG) / cosd
        dec = self.dec_deg + (self.pmdec_mas_yr * dt / MAS_PER_DEG)
        return ra % 360.0, dec


# Fallback registry, verified against Sesame on 2026-11-13.  ``epoch_year`` is
# the epoch of the catalogue position, not the date of the observation.
BUILTIN_TARGETS: dict[str, Target] = {
    "barnard": Target(
        "Barnard's Star", 269.45207696, 4.69336497,
        -801.551, 10362.394, 2000.0, "Sesame/SIMBAD (J2000)",
        ("barnard's star", "barnards star", "name barnard's star", "gj 699"),
    ),
    "epsindb": Target(
        "Epsilon Indi B", 331.04414659, -56.78284420,
        3981.977, -2466.832, 2000.0, "Sesame/SIMBAD (J2000)",
        ("epsilon indi b", "eps ind b", "eps indi b"),
    ),
    # The challenge brief gives 133.79513, -7.24515.  That is the position at
    # the WISE observing epoch (about 2010.5), not J2000.  SIMBAD (WISEA J085510.74-071442.5,
    # read 2026-11-13) gives the J2000 position and the 8.1 arcsec/yr proper
    # motion below; propagated to 2010.5 they reproduce the brief's position.
    "wise0855": Target(
        "WISE 0855", 133.81890825, -7.247048,
        -8123.7, 673.2, 2000.0, "Sesame/SIMBAD (J2000), WISEA J085510.74-071442.5",
        ("wise 0855", "wise0855", "wise 0855-0714", "wise0855-0714",
         "wisea j085510.74-071442.5", "wise j085510.83-071442.5"),
    ),
    "rwaur": Target(
        "RW Aurigae", 76.95652603, 30.40143817,
        7.23, -20.33, 2000.0, "Sesame/SIMBAD (J2000)",
        ("rw aurigae", "rw aur", "v* rw aur"),
    ),
    "rdra": Target(
        "R Draconis", 248.16761083, 66.75497942,
        -20.643, 6.149, 2000.0, "Sesame/SIMBAD (J2000)",
        ("r draconis", "r dra", "v* r dra"),
    ),
}

TEST_TARGET_KEYS = ("barnard", "epsindb", "wise0855", "rwaur", "rdra")


def builtin(name: str) -> Optional[Target]:
    key = name.strip().lower()
    for t in BUILTIN_TARGETS.values():
        if key == t.name.lower() or key in t.aliases:
            return t
    return None


def _tag(text: str, tag: str) -> Optional[str]:
    m = re.search(rf"<{tag}>([^<]*)</{tag}>", text)
    return m.group(1) if m else None


def resolve_name(name: str, timeout: float = 30.0) -> Target:
    """Resolve a name: the verified built-in registry first, then Sesame.

    The five challenge targets never need the network, so the demo still works
    when CDS is slow.  Sesame answers with a redirect to a mirror, so redirects
    must be followed (without that every lookup failed).
    """
    fallback = builtin(name)
    if fallback is not None:
        return fallback
    url = SESAME + "?" + quote(name.strip(), safe="")
    try:
        with httpx.Client(timeout=timeout, headers={"User-Agent": config.USER_AGENT},
                          follow_redirects=True) as client:
            r = client.get(url)
        r.raise_for_status()
        text = r.text
        if "Nothing found" in text:
            raise LookupError(name)
        ra = float(_tag(text, "jradeg"))
        dec = float(_tag(text, "jdedeg"))
        pmra = float(_tag(text, "pmRA") or 0.0)
        pmdec = float(_tag(text, "pmDE") or 0.0)
        oname = _tag(text, "oname") or name
        return Target(oname, ra, dec, pmra, pmdec, 2000.0, "Sesame/SIMBAD (J2000)")
    except LookupError:
        raise
    except Exception as exc:
        raise LookupError(f"could not resolve {name!r}: {type(exc).__name__}") from exc


def parse_coordinates(ra: str | float, dec: str | float) -> tuple[float, float]:
    """Accept decimal degrees or sexagesimal strings such as ``17h57m48.5s``."""
    def _num(value, is_ra: bool) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip()
        if re.fullmatch(r"[-+]?\d+(\.\d+)?", s):
            return float(s)
        sexa = re.match(
            r"^([+-]?\d+)[h:\s]+(\d+)[m:\s]+(\d+(?:\.\d+)?)s?$", s, re.I
        )
        if sexa:
            sign = -1 if sexa.group(1).startswith("-") else 1
            deg = abs(float(sexa.group(1))) + float(sexa.group(2)) / 60 + float(sexa.group(3)) / 3600
            return sign * deg * (15.0 if is_ra else 1.0)
        raise ValueError(f"cannot parse coordinate {value!r}")

    return _num(ra, True), _num(dec, False)


def decimal_year(mjd: float) -> float:
    """Approximate decimal year from an MJD (good to a few hours)."""
    # MJD 51544.5 = 2000-01-01T00:00:00
    return 2000.0 + (mjd - 51544.5) / 365.25
