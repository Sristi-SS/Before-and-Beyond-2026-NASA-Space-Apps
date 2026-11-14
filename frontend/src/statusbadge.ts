// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Header status badge fed by GET /api/status: "online", "data cached" or "offline demo".
interface Status {
  mode: "online" | "offline-cache";
  archive_ok: boolean | null;
  cached_targets: number;
  active_jobs: number;
}

let archiveOffline = false;

/** True when the server could not reach the archive at its last check. */
export function isArchiveOffline(): boolean {
  return archiveOffline;
}

export const OFFLINE_BUILD_MESSAGE =
  "The SPHEREx archive cannot be reached right now, so new cubes cannot be built. " +
  "Cubes already in the cache (pick one on the Sky globe) still open normally.";

function show(badge: HTMLElement, text: string, title: string, kind: string): void {
  badge.textContent = text;
  badge.title = title;
  badge.dataset.kind = kind;
}

async function refresh(badge: HTMLElement): Promise<void> {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error(String(res.status));
    const s = (await res.json()) as Status;
    archiveOffline = s.mode === "offline-cache";
    if (archiveOffline) {
      show(badge, "data cached", `Archive unreachable. ${s.cached_targets} cached cubes still work.`, "cached");
    } else {
      show(badge, "online", `Archive reachable. ${s.cached_targets} cached cubes, ${s.active_jobs} building.`, "online");
    }
  } catch {
    archiveOffline = true;
    show(badge, "offline demo", "The server is not reachable; only what is already loaded works.", "offline");
  }
}

export function initStatusBadge(): void {
  const badge = document.getElementById("status-badge");
  if (!badge) return;
  void refresh(badge);
  window.setInterval(() => void refresh(badge), 5 * 60_000);
}
