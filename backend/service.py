"""Public-service hardening: rate limit, /api/status, gzip for JSON, static cache headers.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles

from . import config, jobs

router = APIRouter()

# ---------------------------------------------------------------- rate limit
RATE_MAX = int(os.environ.get("SPHEREX_RATE_MAX", "6"))
RATE_WINDOW_S = float(os.environ.get("SPHEREX_RATE_WINDOW_S", "600"))


class RateLimiter:
    """Per-IP sliding window.  In memory, per process; fine for one small server."""

    MAX_ADDRESSES = 5000

    def __init__(self, max_hits: int | None = None, window_s: float | None = None) -> None:
        self._max = max_hits
        self._window = window_s
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, ip: str, now: float | None = None) -> float:
        """Record a hit.  Returns 0 if allowed, else seconds until a slot frees up."""
        now = time.monotonic() if now is None else now
        limit = RATE_MAX if self._max is None else self._max
        window = RATE_WINDOW_S if self._window is None else self._window
        with self._lock:
            q = self._hits[ip]
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= limit:
                return window - (now - q[0])
            q.append(now)
            if len(self._hits) > self.MAX_ADDRESSES:
                # Forget every address whose hits are all too old, not only this one.
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= window]:
                    del self._hits[k]
                # Still too many (a flood of new addresses): drop the oldest half.
                if len(self._hits) > self.MAX_ADDRESSES:
                    old = sorted(self._hits, key=lambda k: self._hits[k][-1])
                    for k in old[: len(old) // 2]:
                        if k != ip:
                            del self._hits[k]
            return 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
# Motion maps and candidate searches use a lot of CPU, so they get their own limit.
ANALYSIS_MAX = int(os.environ.get("SPHEREX_ANALYSIS_MAX", "40"))
analysis_limiter = RateLimiter(ANALYSIS_MAX, 60.0)


def forwarded_ip(headers, fallback: str) -> str:
    """The caller's address.  Behind a trusted proxy (SPHEREX_TRUST_PROXY=1) it comes from
    X-Forwarded-For, counted from the RIGHT: the last SPHEREX_PROXY_HOPS entries are the
    ones our own proxies added.  Entries further left are sent by the caller and can be faked."""
    if os.environ.get("SPHEREX_TRUST_PROXY") == "1":
        parts = [p.strip() for p in headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if parts:
            try:
                hops = max(1, int(os.environ.get("SPHEREX_PROXY_HOPS", "1")))
            except ValueError:
                hops = 1
            return parts[max(0, len(parts) - hops)]
    return fallback


def client_ip(request: Request) -> str:
    return forwarded_ip(request.headers, request.client.host if request.client else "unknown")


def enforce_analysis_limit(request: Request) -> None:
    wait = analysis_limiter.check(client_ip(request))
    if wait > 0:
        raise HTTPException(
            429,
            f"Too many searches from this address (limit {ANALYSIS_MAX} per minute). "
            f"Try again in about {int(wait) + 1} second(s).",
            headers={"Retry-After": str(int(wait) + 1)},
        )


def enforce_build_limit(request: Request, params: dict) -> None:
    """Count a request only if it would start a new build (not a cached or running job)."""
    key = jobs.job_key(params)
    existing = jobs.manager.get(key)
    if existing is not None and existing.status().get("status") in ("done", "queued", "running"):
        return
    wait = limiter.check(client_ip(request))
    if wait > 0:
        raise HTTPException(
            429,
            f"Too many new cube builds from this address (limit {RATE_MAX} per "
            f"{int(RATE_WINDOW_S // 60)} minutes). Cached cubes still open instantly. "
            f"Try again in about {int(wait // 60) + 1} minute(s).",
            headers={"Retry-After": str(int(wait) + 1)},
        )


# ------------------------------------------------------------------- status
ARCHIVE_PING_URL = "https://irsa.ipac.caltech.edu/TAP/availability"
PING_TTL_S = 300.0
PING_TIMEOUT_S = 3.0
_ping: dict = {"ok": None, "at": 0.0, "running": False}
_ping_lock = threading.Lock()


def _probe_archive() -> bool:
    try:
        r = httpx.get(ARCHIVE_PING_URL, timeout=PING_TIMEOUT_S, follow_redirects=True,
                      headers={"User-Agent": config.USER_AGENT})
        return r.status_code < 500
    except Exception:
        return False


def _ping_worker() -> None:
    ok = _probe_archive()
    with _ping_lock:
        _ping.update(ok=ok, at=time.monotonic(), running=False)


def archive_ok() -> bool | None:
    """Cached archive reachability.  Refreshed at most every 5 min; a request waits at most 3 s, and only the first time."""
    with _ping_lock:
        stale = _ping["ok"] is None or time.monotonic() - _ping["at"] > PING_TTL_S
        start = stale and not _ping["running"]
        if start:
            _ping["running"] = True
    if start:
        t = threading.Thread(target=_ping_worker, daemon=True)
        t.start()
        if _ping["ok"] is None:
            t.join(PING_TIMEOUT_S)
    return _ping["ok"]


def reset_ping() -> None:
    with _ping_lock:
        _ping.update(ok=None, at=0.0, running=False)


_count: dict = {"n": 0, "at": -1e9}


def cached_targets() -> int:
    if time.monotonic() - _count["at"] > 30:
        root = config.CACHE_DIR / "jobs"
        n = 0
        if root.is_dir():
            for p in root.glob("*/job.json"):
                try:
                    if '"status": "done"' in p.read_text(encoding="utf-8")[:200000]:
                        n += 1
                except OSError:
                    pass
        _count.update(n=n, at=time.monotonic())
    return _count["n"]


def active_jobs() -> int:
    with jobs.manager._lock:
        items = list(jobs.manager._jobs.values())
    return sum(1 for j in items if j.state.get("status") in ("queued", "running"))


@router.get("/api/status")
def status() -> dict:
    ok = archive_ok()
    return {
        "mode": "offline-cache" if ok is False else "online",
        "archive_ok": ok,
        "cached_targets": cached_targets(),
        "active_jobs": active_jobs(),
    }


# --------------------------------------------------- gzip and static caching
_BINARY = re.compile(r"/(cube/\d+|frames_cube|tilt|motionmap|contact_sheet\.png)$")


class JsonGZip:
    """gzip for JSON/text responses; float32 blobs and PNGs are left alone (they barely shrink)."""

    def __init__(self, app, minimum_size: int = 500) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not _BINARY.search(scope["path"]):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


class CachedStatic(StaticFiles):
    """Hashed build assets are immutable; HTML is always revalidated."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            if path.startswith("assets/"):
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path in ("", ".") or path.endswith(".html"):
                resp.headers["Cache-Control"] = "no-cache"
            else:
                resp.headers["Cache-Control"] = "public, max-age=3600"
        return resp
