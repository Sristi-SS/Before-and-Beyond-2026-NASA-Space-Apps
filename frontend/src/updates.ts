// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// "New images" box in the Data tab: ask the archive for images newer than this cube, and rebuild.
import * as api from "./api";
import { isRefreshLocked } from "./statusbadge";

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class UpdatePanel {
  private readonly check = el<HTMLButtonElement>("upd-check");
  private readonly apply = el<HTMLButtonElement>("upd-apply");
  private readonly status = el<HTMLElement>("upd-status");
  private readonly dot = el<HTMLElement>("data-dot");
  private key: string | null = null;

  /** `reopen` loads the cube again once the rebuild is done. */
  constructor(private readonly reopen: (key: string) => Promise<void>) {
    this.check.addEventListener("click", () => void this.run(true));
    this.apply.addEventListener("click", () => void this.rebuild());
    const lock = (): void => { this.apply.hidden = isRefreshLocked(); };
    window.addEventListener("status:changed", lock);
    lock();
  }

  /** A cube was opened: look for news in the background (quietly; the archive may be offline). */
  setJob(key: string, note?: string): void {
    this.key = key;
    this.check.disabled = false;
    this.apply.disabled = true;
    this.dot.hidden = true;
    for (const id of ["upd-cube", "upd-archive", "upd-new"]) el(id).textContent = "—";
    this.status.textContent = note ?? "";
    void this.run(false);
  }

  private async run(loud: boolean): Promise<void> {
    const key = this.key;
    if (!key) return;
    if (loud) {
      this.check.disabled = true;
      this.status.textContent = "Asking the archive…";
    }
    try {
      const info = await api.fetchUpdates(key, loud);
      if (key !== this.key) return;
      if (info.offline) {
        this.status.textContent = "The archive does not answer right now, so new images cannot be checked. The cube still works.";
        return;
      }
      if (info.busy) {
        this.status.textContent = "This cube is being built right now.";
        return;
      }
      el("upd-cube").textContent = info.newest_in_cube ?? "—";
      el("upd-archive").textContent = info.newest_in_archive ?? "—";
      const n = info.new_images ?? 0;
      el("upd-new").textContent = n > 0 ? `${n} (from ${info.new_nights} nights)` : "none";
      this.apply.disabled = !info.has_news;
      this.dot.hidden = !info.has_news;
      const extra = info.new_collections?.length ? ` New data release seen: ${info.new_collections.join(", ")}.` : "";
      this.status.textContent = info.has_news
        ? isRefreshLocked()
          ? `The archive has newer pictures of this place. Saved cubes are updated by the site's maintainers.${extra}`
          : `The archive has newer pictures of this place. Press Update cube to add them.${extra}`
        : `This cube is up to date (built ${info.built_date ?? "earlier"}).${extra}`;
    } catch (error) {
      if (loud && key === this.key) {
        const text = (error as Error).message.replace(/^\d+ [^—]*— /, "").replace(/^\{"detail":"|"\}$/g, "");
        this.status.textContent = `Could not check. ${text.slice(0, 160)}`;
      }
    } finally {
      if (key === this.key) this.check.disabled = false;
    }
  }

  private async rebuild(): Promise<void> {
    const key = this.key;
    if (!key) return;
    this.apply.disabled = true;
    this.check.disabled = true;
    this.status.textContent = "Updating. Only new images are downloaded. This can take a few minutes…";
    try {
      await api.refreshJob(key);
      await this.reopen(key);
    } catch (error) {
      const text = (error as Error).message.replace(/^\d+ [^—]*— /, "").replace(/^\{"detail":"|"\}$/g, "");
      this.status.textContent = `Update failed. ${text.slice(0, 160)}`;
      this.check.disabled = false;
    }
  }
}
