"""Tests for the WISE baseline, the Gaia labels and their job/API wiring.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

Unit tests use synthetic data only.  Tests marked ``network`` hit the live
services and run only with SPHEREX_NETWORK_TESTS=1.
"""
from __future__ import annotations

import io
import os

import numpy as np
import pytest
from astropy.io import fits
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import align, cache, config, extras, gaia, jobs, resolve, tilt, wise

network = pytest.mark.skipif(os.environ.get("SPHEREX_NETWORK_TESTS") != "1",
                             reason="set SPHEREX_NETWORK_TESTS=1 to run live-archive tests")

RA0, DEC0 = 133.8, -7.25


# ---------------------------------------------------------------- synthetic WISE server
def _fits_bytes(img: np.ndarray, mjdmin: float, mjdmax: float, epoch: int, ra: float, dec: float) -> bytes:
    hdr = fits.Header()
    hdr["CTYPE1"], hdr["CTYPE2"] = "RA---TAN", "DEC--TAN"
    hdr["CRVAL1"], hdr["CRVAL2"] = ra, dec
    hdr["CRPIX1"] = hdr["CRPIX2"] = 1024.5
    hdr["CD1_1"], hdr["CD1_2"], hdr["CD2_1"], hdr["CD2_2"] = -2.75 / 3600, 0.0, 0.0, 2.75 / 3600
    hdr["MJDMIN"], hdr["MJDMAX"], hdr["EPOCH"] = mjdmin, mjdmax, epoch
    buf = io.BytesIO()
    fits.PrimaryHDU(img.astype(">f4"), header=hdr).writeto(buf)
    return buf.getvalue()


class FakeServer:
    """Serves unWISE-like epoch tiles with a source that moves 8 arcsec/yr west."""

    def __init__(self):
        self.calls = 0
        self.vx = -8.0  # arcsec/yr east
        self.files: dict[str, bytes] = {}
        rng = np.random.default_rng(1)
        w = wise.tile_wcs_nominal(RA0, DEC0)
        yy, xx = np.mgrid[0:2048, 0:2048]
        for epoch in range(4):
            mjd = 55500.0 + 400.0 * epoch
            ra_s = RA0 + self.vx * (mjd - 55500.0) / 365.25 / 3600.0 / np.cos(np.radians(DEC0))
            sx, sy = w.all_world2pix(ra_s, DEC0, 0)
            img = rng.normal(0, 2.0, (2048, 2048)).astype(np.float32)
            img += 400.0 * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * 1.6 ** 2))
            img += 5.0
            for band in (1, 2):
                url = wise.image_url("1338m073", band, epoch)
                self.files[url] = _fits_bytes(img, mjd, mjd + 3.0, epoch, RA0, DEC0)

    def http_bytes(self, url, start=None, end=None, **kw):
        self.calls += 1
        if url not in self.files:
            raise wise.NotFound(url)
        data = self.files[url]
        return data if start is None else data[start:end + 1]


@pytest.fixture()
def fake_wise(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    srv = FakeServer()
    monkeypatch.setattr(wise, "http_bytes", srv.http_bytes)
    monkeypatch.setattr(wise, "load_atlas", lambda: {
        "coadd_id": np.array(["1338m073"]), "ra": np.array([RA0]), "dec": np.array([DEC0]),
        "bitmask": np.array([[3, 3, 3, 3] + [0] * 20], dtype=np.uint8),
    })
    return srv


def _grid(npix=64, ps=6.15):
    return align.make_grid(RA0, DEC0, npix, ps), npix, ps


def test_wise_frames_shape_and_range_fetch(fake_wise):
    grid, npix, ps = _grid()
    frames = wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps)
    assert len(frames) == 8  # 4 epochs x W1/W2
    f = frames[0]
    assert f.data.shape == (npix, npix) and f.data.dtype == np.float32
    meta = f.meta(5)
    assert meta["source"] == "wise" and meta["index"] == 5 and meta["status"] == "ok"
    assert {(m.meta(0)["detector"], m.meta(0)["wavelength_um"]) for m in frames} == {(101, 3.4), (102, 4.6)}
    assert meta["obs_time"].startswith("2010-")
    assert meta["coverage"] == 1.0
    assert all(frames[i].mjd <= frames[i + 1].mjd for i in range(len(frames) - 1))
    assert fake_wise.calls > 0


def test_wise_cache_avoids_second_download(fake_wise):
    grid, npix, ps = _grid()
    wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps)
    first = fake_wise.calls
    wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps)
    assert fake_wise.calls == first


def test_wise_shift_stack_recovers_motion(fake_wise):
    grid, npix, ps = _grid()
    frames = [f for f in wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps) if f.band == 2]
    imgs, mjds = [f.data for f in frames], [f.mjd for f in frames]
    good, _ = tilt.shift_sum(imgs, mjds, fake_wise.vx, 0.0, ps, t0_mjd=mjds[0])
    flat, _ = tilt.shift_sum(imgs, mjds, 0.0, 0.0, ps, t0_mjd=mjds[0])
    assert good.max() > 1.8 * flat.max()


def test_wise_missing_epoch_is_skipped(fake_wise):
    del fake_wise.files[wise.image_url("1338m073", 2, 1)]
    grid, npix, ps = _grid()
    frames = wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps)
    assert len(frames) == 7


def test_wise_all_failures_raise(monkeypatch, fake_wise):
    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(wise, "http_bytes", boom)
    grid, npix, ps = _grid()
    with pytest.raises(RuntimeError):
        wise.fetch_frames(grid, npix, RA0, DEC0, npix * ps / 3600, ps)


def test_http_bytes_retries_then_gives_up(monkeypatch):
    class R:
        status_code = 503
        request = None
        content = b""

    class C:
        n = 0

        def get(self, url, headers=None):
            C.n += 1
            return R()
    monkeypatch.setattr(wise, "_get_client", lambda: C())
    waits = []
    with pytest.raises(RuntimeError):
        wise.http_bytes("http://x", retries=3, sleep=waits.append)
    assert C.n == 3 and waits == [1.5, 3.0]


def test_band_ranges():
    assert wise.band_range_um(1)[0] < 3.4 < wise.band_range_um(1)[1]
    assert wise.band_range_um(2)[0] < 4.6 < wise.band_range_um(2)[1]


# ---------------------------------------------------------------- job integration
def test_job_key_unchanged_unless_wise_off():
    base = {"name": "WISE 0855", "ra": None, "dec": None, "fov": 0.2, "npix": 128,
            "pixscale": 6.15, "max_frames": 12, "release": "spherex_dr1"}
    k = jobs.job_key(base)
    assert jobs.job_key({**base, "wise": True}) == k
    assert jobs.job_key({**base, "wise": False}) != k


def _fake_job(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    return jobs.Job(key="a" * 20, params={}, state={"frames": [{"index": 0}], "progress": {"done": 0, "total": 0}})


def test_wise_stage_failure_is_recorded_not_raised(tmp_path, monkeypatch):
    job = _fake_job(tmp_path, monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("archive down")
    monkeypatch.setattr(wise, "fetch_frames", boom)
    grid, npix, ps = _grid(32)
    state, groups, slices = jobs._wise_stage(job, grid, npix, ps, RA0, DEC0, 0.05, {"n": 1})
    assert state["status"] == "error" and "archive down" in state["message"]
    assert groups == [] and slices == []


def test_wise_stage_none(tmp_path, monkeypatch):
    job = _fake_job(tmp_path, monkeypatch)
    monkeypatch.setattr(wise, "fetch_frames", lambda *a, **k: [])
    grid, npix, ps = _grid(32)
    state, groups, _ = jobs._wise_stage(job, grid, npix, ps, RA0, DEC0, 0.05, {"n": 1})
    assert state["status"] == "none" and groups == []


def test_wise_stage_ok_adds_frames_groups_cubes(tmp_path, monkeypatch, fake_wise):
    job = _fake_job(tmp_path, monkeypatch)
    grid, npix, ps = _grid(48)
    counter = {"n": 3}
    state, groups, slices = jobs._wise_stage(job, grid, npix, ps, RA0, DEC0, npix * ps / 3600, counter)
    assert state["status"] == "ok" and state["n"] == 8
    assert counter["n"] == 11
    metas = [m for m in job.state["frames"] if m.get("source") == "wise"]
    assert sorted(m["index"] for m in metas) == list(range(3, 11))
    for m in metas:
        assert (cache.frames_dir(job.key) / f"{m['index']:03d}.npy").exists()
    assert {g["detector"] for g in groups} == {101, 102}
    g1 = next(g for g in groups if g["detector"] == 101)
    assert g1["range_um"] == list(wise.band_range_um(1)) and g1["count"] == 4
    cube = np.load(job.dir / "cubes" / "det102.npy")
    assert cube.shape[1:] == (npix, npix)
    assert {s["detector"] for s in slices} == {101, 102}


# ---------------------------------------------------------------- Gaia
GAIA_CSV = (
    "source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag,ref_epoch\n"
    "1,133.8,-7.25,1000.0,-500.0,10.0,12.0,2016.0\n"
    "2,133.8005,-7.2495,,,,18.5,2016.0\n"
    "3,200.0,10.0,0,0,1,15,2016.0\n"
)


def test_gaia_parse_and_propagate():
    rows = gaia.parse_csv(GAIA_CSV)
    assert len(rows) == 3 and rows[1]["pmra"] is None
    ra, dec = gaia.propagate(133.8, -7.25, 1000.0, -500.0, 2016.0, 2026.0)
    assert dec == pytest.approx(-7.25 - 5.0 / 3600, abs=1e-9)
    assert (ra - 133.8) * np.cos(np.radians(-7.25)) * 3600 == pytest.approx(10.0, abs=1e-3)


def test_gaia_sources_cached_and_pixels(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    calls = []
    monkeypatch.setattr(gaia, "_post", lambda url, adql, timeout=90.0: calls.append(url) or GAIA_CSV)
    s1 = gaia.gaia_sources(133.8, -7.25, 0.1, 2026.0)
    s2 = gaia.gaia_sources(133.8, -7.25, 0.1, 2026.0)
    assert len(calls) == 1 and s1 == s2
    grid, npix, ps = _grid(64)
    out = gaia.with_pixels(s1, grid, npix, 2026.0, ps)
    assert [s["source_id"] for s in out] == ["1", "2"]  # source 3 is far off the grid
    a = out[0]
    # 1 arcsec/yr towards east: east is -x on this grid
    assert a["dx_per_yr"] == pytest.approx(1.0 / ps * -1.0, abs=0.01) or a["dx_per_yr"] == pytest.approx(-1.0 / ps, abs=0.01)
    assert a["dy_per_yr"] == pytest.approx(-0.5 / ps, abs=0.01)


def test_gaia_falls_back_to_second_service(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")

    def post(url, adql, timeout=90.0):
        if url == gaia.ESA_TAP:
            raise RuntimeError("esa down")
        return GAIA_CSV
    monkeypatch.setattr(gaia, "_post", post)
    assert len(gaia.raw_sources(10.0, 10.0, 0.1)) == 3


# ---------------------------------------------------------------- API
def _client(monkeypatch, state):
    app = FastAPI()
    app.include_router(extras.router)
    job = jobs.Job(key="b" * 20, params={}, state=state)
    monkeypatch.setattr(jobs.manager, "get", lambda k: job if k == "b" * 20 else None)
    return TestClient(app)


def test_extras_gaia_route(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(gaia, "_post", lambda *a, **k: GAIA_CSV)
    state = {"grid": {"npix": 64, "pixscale_arcsec": 6.15, "center_ra": RA0, "center_dec": DEC0},
             "frames": [{"mjd": 61000.0, "status": "ok", "source": "spherex"},
                        {"mjd": 61100.0, "status": "ok", "source": "spherex"},
                        {"mjd": 55000.0, "status": "ok", "source": "wise"}]}
    c = _client(monkeypatch, state)
    r = c.get("/api/jobs/" + "b" * 20 + "/gaia")
    assert r.status_code == 200
    body = r.json()
    assert body["epoch_year"] == pytest.approx(resolve.decimal_year(61050.0), abs=1e-3)
    assert body["n"] == 2 and {"x", "y", "dx_per_yr", "dy_per_yr", "source_id"} <= set(body["sources"][0])


@pytest.mark.parametrize("key", ["..", "A" * 20, "c" * 20, "b" * 19])
def test_extras_bad_or_unknown_key(monkeypatch, key):
    c = _client(monkeypatch, {"grid": {}})
    assert c.get(f"/api/jobs/{key}/gaia").status_code in (404, 422)


def test_extras_no_grid_yet(monkeypatch):
    c = _client(monkeypatch, {})
    assert c.get("/api/jobs/" + "b" * 20 + "/gaia").status_code == 409


# ---------------------------------------------------------------- live services
@pytest.mark.network
@network
def test_network_gaia_barnards_star(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    src = gaia.gaia_sources(269.4521, 4.6934, 0.05, 2026.5, limit=20)
    assert src and src[0]["phot_g_mean_mag"] < 9.0
    assert abs(src[0]["pmdec"]) > 10000  # Barnard's Star, ~10.4 arcsec/yr


@pytest.mark.network
@network
def test_network_wise0855_epochs(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    grid = align.make_grid(133.795, -7.245, 64, 6.15)
    frames = wise.fetch_frames(grid, 64, 133.795, -7.245, 64 * 6.15 / 3600, 6.15, bands=(2,))
    assert len(frames) >= 15
    years = {f.obs_time[:4] for f in frames}
    assert "2010" in years and max(years) >= "2020"
