// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Header status badge fed by GET /api/status: "Live archive", "Saved cubes only" or "Offline".
interface Status {
  mode: "online" | "offline-cache";
  archive_ok: boolean | null;
  cached_targets: number;
  active_jobs: number;
  /** "open": this visitor may rebuild a saved cube; "locked": only the maintainers may. */
  refresh?: "open" | "locked";
}

let archiveOffline = false;
let refreshLocked = true;

/** True unless the server said this visitor may rebuild saved cubes (the maintainers, or a local copy). */
export function isRefreshLocked(): boolean {
  return refreshLocked;
}

/** True when the server could not reach the archive at its last check. */
export function isArchiveOffline(): boolean {
  return archiveOffline;
}

export const OFFLINE_BUILD_MESSAGE =
  "NASA's archive cannot be reached right now, so a new cube cannot be built. " +
  "The saved cubes (the presets on the Sky page) still open normally.";

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
    refreshLocked = s.refresh !== "open";
    window.dispatchEvent(new Event("status:changed"));
    if (archiveOffline) {
      show(badge, "Saved cubes only",
        `NASA's archive cannot be reached right now, so new places cannot be loaded. The ${s.cached_targets} saved cubes still open.`, "cached");
    } else {
      show(badge, "Live archive",
        `NASA's archive is reachable: any place in the sky can be loaded. ${s.cached_targets} cubes are saved here.`, "online");
    }
  } catch {
    archiveOffline = true;
    show(badge, "Offline", "The server cannot be reached. Only what is already on this page works.", "offline");
  }
}

export function initStatusBadge(): void {
  const badge = document.getElementById("status-badge");
  if (!badge) return;
  void refresh(badge);
  window.setInterval(() => void refresh(badge), 5 * 60_000);
}
