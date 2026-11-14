"""Keep cached cubes up to date as the archive publishes new SPHEREx images.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

The archive adds images all the time (new survey passes, new quick releases).
A cube is a snapshot of the day it was built.  This module:

* checks one cube: are there archive images newer than its newest frame?
* rebuilds a cube in place (same key, same link).  Cut-outs already on disk are
  reused, so only the new images are downloaded.
* does the same for every cached cube, from the command line or on a timer.

Command line (prints a table; add --apply to rebuild the cubes that have news):

    python -m backend.refresh
    python -m backend.refresh --apply
    python -m backend.refresh --apply --loop 12      # again every 12 hours

Server timer: set SPHEREX_AUTO_REFRESH_HOURS=12 and the running server does the
--apply pass itself every 12 hours.

New collections need no code change: the search does not filter by collection,
so a new quick release is found as soon as the archive serves it.  A collection
name this code has not seen before is reported as ``new_collections``.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import shutil
import threading
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from . import config, jobs, service, spherex

router = APIRouter()
_KEY_RE = re.compile(r"^[0-9a-f]{20}$")
CHECK_TTL_S = 900.0                 # one archive query per cube per 15 minutes
NEW_GAP_DAYS = 0.5                  # an image this much later than the newest frame is "new"
_checks: dict[str, dict] = {}
_checks_lock = threading.Lock()


def _date(mjd: Optional[float]) -> Optional[str]:
    if mjd is None or not math.isfinite(mjd):
        return None
    return time.strftime("%Y-%m-%d", time.gmtime((mjd - 40587.0) * 86400.0))


def check_state(state: dict) -> dict:
    """Compare one finished job with the archive.  One TAP query; raises on archive errors."""
    g = state.get("grid") or {}
    t = state.get("target") or {}
    ra = float(t.get("search_ra_deg", g.get("center_ra")))
    dec = float(t.get("search_dec_deg", g.get("center_dec")))
    params = state.get("params") or {}
    fov = float(params.get("fov", 0.2))
    npix = int(g.get("npix", config.DEFAULT_NPIX))
    pixscale = float(g.get("pixscale_arcsec", config.DEFAULT_PIXSCALE))
    fov_fetch = max(fov, npix * pixscale / 3600.0 * 0.84)      # as in jobs._pipeline

    # Same cone and guard as spherex.search_and_fetch.
    planes = spherex.cone_search(ra, dec, min(5.0, fov_fetch / 2.0 + 1.85))
    limit = 1.78 + fov_fetch / 2.0
    planes = [p for p in planes
              if math.hypot((p.ra - ra) * math.cos(math.radians(dec)), p.dec - dec) <= limit]

    frames = [m for m in state.get("frames", [])
              if m.get("status", "ok") == "ok" and m.get("source", "spherex") == "spherex"]
    newest_cube = max((float(m["mjd"]) for m in frames), default=None)
    newest_archive = max((p.t_min for p in planes), default=None)
    cutoff = (newest_cube if newest_cube is not None else -math.inf) + NEW_GAP_DAYS
    new = [p for p in planes if p.t_min > cutoff]
    collections = sorted({p.collection for p in planes})
    return {
        "key": state.get("key"),
        "target": t.get("name") or "Custom position",
        "checked_at": time.time(),
        "frames_in_cube": len(frames),
        "archive_images": len(planes),
        "newest_in_cube": _date(newest_cube),
        "newest_in_archive": _date(newest_archive),
        # Upper limit: an image counts here before we know it really covers the position.
        "new_images": len(new),
        "new_nights": len({int(p.t_min) for p in new}),
        "collections": collections,
        "new_collections": [c for c in collections if c not in config.KNOWN_COLLECTIONS],
        "has_news": len(new) > 0,
    }


def check_key(key: str, fresh: bool = False) -> dict:
    """Cached :func:`check_state` for one job key."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise KeyError(key)
    state = job.status()
    if state.get("status") != "done":
        return {"key": key, "status": state.get("status"), "has_news": False, "busy": True}
    with _checks_lock:
        held = _checks.get(key)
        if held and not fresh and time.time() - held["checked_at"] < CHECK_TTL_S \
                and held.get("built") == state.get("updated"):
            return held
    result = check_state(state)
    result["built"] = state.get("updated")
    result["built_date"] = time.strftime("%Y-%m-%d", time.gmtime(float(state.get("updated") or 0)))
    with _checks_lock:
        _checks[key] = result
    return result


def rebuild(key: str) -> jobs.Job:
    """Build the cube again with the same parameters (same key, same link)."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise KeyError(key)
    params = dict(job.status().get("params") or job.params)
    if jobs.job_key(params) != key:
        raise ValueError("the stored parameters do not match this key")
    with _checks_lock:
        _checks.pop(key, None)
    old_state = job.status()
    backup = _backup(job) if old_state.get("status") == "done" else False
    new = jobs.manager.submit(params, force=True)
    if backup and new.thread is not None:
        threading.Thread(target=_restore_on_failure, args=(new, old_state), daemon=True).start()
    return new


def _backup(job: jobs.Job) -> bool:
    """Copy the frames and cubes of a good cube aside, so a failed rebuild loses nothing."""
    prev = job.dir / "prev"
    try:
        shutil.rmtree(prev, ignore_errors=True)
        for name in ("frames", "cubes"):
            if (job.dir / name).is_dir():
                shutil.copytree(job.dir / name, prev / name)
        return True
    except OSError:
        return False


def _restore_on_failure(job: jobs.Job, old_state: dict) -> None:
    """Wait for the rebuild.  If it failed (archive down), put the old cube back."""
    while job.thread is not None and job.thread.is_alive():
        job.thread.join(5.0)
    prev = job.dir / "prev"
    try:
        if job.status().get("status") != "done":
            reason = job.status().get("error") or "unknown error"
            for name in ("frames", "cubes"):
                if (prev / name).is_dir():
                    shutil.rmtree(job.dir / name, ignore_errors=True)
                    shutil.copytree(prev / name, job.dir / name)
            with job.lock:
                job.state.clear()
                job.state.update(old_state)
                job.state["refresh_error"] = f"The update failed and the old cube was kept: {reason}"[:300]
            job.save()
    finally:
        shutil.rmtree(prev, ignore_errors=True)


def cached_keys() -> list[str]:
    root = config.CACHE_DIR / "jobs"
    if not root.is_dir():
        return []
    return sorted(p.parent.name for p in root.glob("*/job.json") if _KEY_RE.fullmatch(p.parent.name))


def sweep(apply: bool, log=print) -> list[dict]:
    """Check every cached cube; with ``apply`` rebuild those with new images, one at a time."""
    out = []
    for key in cached_keys():
        try:
            info = check_key(key, fresh=True)
        except Exception as exc:  # noqa: BLE001 - one bad cube must not stop the sweep
            log(f"{key}  check failed: {type(exc).__name__}: {exc}")
            continue
        if info.get("busy"):
            continue
        out.append(info)
        log(f"{key}  {info['target'][:22]:22s}  cube {info['newest_in_cube']}  "
            f"archive {info['newest_in_archive']}  new images: {info['new_images']}")
        if apply and info["has_news"]:
            job = rebuild(key)
            log(f"{key}  rebuilding...")
            while job.thread is not None and job.thread.is_alive():
                job.thread.join(5.0)
            final = job.status()
            log(f"{key}  {final.get('status')}: {len(final.get('frames', []))} frames")
            info["rebuilt"] = final.get("status") == "done"
    return out


_auto_started = False


def start_auto_refresh() -> bool:
    """Start the timer thread when SPHEREX_AUTO_REFRESH_HOURS is a positive number."""
    global _auto_started
    try:
        hours = float(os.environ.get("SPHEREX_AUTO_REFRESH_HOURS", "0") or 0)
    except ValueError:
        hours = 0.0
    if hours <= 0 or _auto_started:
        return False
    _auto_started = True

    def loop() -> None:
        while True:
            time.sleep(max(600.0, hours * 3600.0))
            try:
                sweep(apply=True, log=lambda *_: None)
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=loop, daemon=True, name="auto-refresh").start()
    return True


# ------------------------------------------------------------------ API
@router.get("/api/jobs/{key}/updates")
def job_updates(key: str, fresh: bool = Query(False)) -> dict:
    """Does the archive hold images newer than this cube?"""
    if not _KEY_RE.fullmatch(key) or jobs.manager.get(key) is None:
        raise HTTPException(404, "job not found")
    if service.archive_ok() is False:
        # Fail fast: the TAP client retries for a long time when the archive is down.
        if not fresh:   # the quiet check a page makes when it opens a cube
            return {"key": key, "offline": True, "has_news": False}
        raise HTTPException(503, "The archive does not answer right now. Try again later.")
    try:
        info = check_key(key, fresh=fresh)
    except KeyError:
        raise HTTPException(404, "job not found") from None
    except Exception as exc:  # noqa: BLE001
        if not fresh:   # the quiet check must never look like a page error
            return {"key": key, "offline": True, "has_news": False}
        raise HTTPException(502, f"The archive did not answer: {type(exc).__name__}") from exc
    return {k: v for k, v in info.items() if k != "built"}


@router.post("/api/jobs/{key}/refresh")
def job_refresh(key: str, request: Request) -> dict:
    """Rebuild this cube with the newest archive images.  Counts as a build for the rate limit."""
    job = jobs.manager.get(key) if _KEY_RE.fullmatch(key) else None
    if job is None:
        raise HTTPException(404, "job not found")
    if job.status().get("status") in ("queued", "running"):
        return {"key": key, "status": job.status().get("status")}
    if service.archive_ok() is False:
        raise HTTPException(503, "The archive does not answer right now. The cube was not changed.")
    wait = service.limiter.check(service.client_ip(request))
    if wait > 0:
        raise HTTPException(429, f"Too many builds from this address. Try again in about "
                                 f"{int(wait // 60) + 1} minute(s).",
                            headers={"Retry-After": str(int(wait) + 1)})
    try:
        new = rebuild(key)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"key": new.key, "status": new.status().get("status")}


def main() -> None:
    parser = argparse.ArgumentParser(description="Check cached cubes for new SPHEREx images.")
    parser.add_argument("--apply", action="store_true", help="rebuild the cubes that have new images")
    parser.add_argument("--loop", type=float, default=0.0, metavar="HOURS",
                        help="repeat every HOURS hours (0 = run once)")
    args = parser.parse_args()
    while True:
        print(time.strftime("%Y-%m-%d %H:%M:%S"), "checking", len(cached_keys()), "cached cubes")
        found = sweep(apply=args.apply)
        news = sum(1 for f in found if f["has_news"])
        print(f"{news} of {len(found)} cubes have new images." + ("" if args.apply or not news
              else "  Run again with --apply to rebuild them."))
        if args.loop <= 0:
            break
        time.sleep(args.loop * 3600.0)


if __name__ == "__main__":
    main()
