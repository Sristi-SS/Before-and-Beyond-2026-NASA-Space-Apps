// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import type { GaiaSource } from "./api";

const BLUE = "#4aa3df";
const ORANGE = "#f08a3c";
const SCALE = 4; // overlay pixels per image pixel, so the rings stay crisp when the canvas is enlarged

export function decimalYear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

/** Pixel position (0-based, x west, y north) of a source at `year`, from its catalogue motion. */
export function positionAt(s: GaiaSource, epochYear: number, year: number): { x: number; y: number } {
  const dt = year - epochYear;
  return { x: s.x + s.dx_per_yr * dt, y: s.y + s.dy_per_yr * dt };
}

export function describeSource(s: GaiaSource): string {
  const g = s.phot_g_mean_mag === null ? "G not measured" : `G ${s.phot_g_mean_mag.toFixed(2)}`;
  const pm =
    s.pmra === null || s.pmdec === null
      ? "no catalogue proper motion"
      : `proper motion (${s.pmra.toFixed(1)}, ${s.pmdec.toFixed(1)}) mas/yr`;
  return `Gaia DR3 ${s.source_id} · ${g} · ${pm}`;
}

/**
 * Small blue rings for Gaia DR3 sources, drawn on a transparent canvas laid
 * over a base canvas.  Hover shows a tooltip; the overlay is also a keyboard
 * stop: Left/Right arrows step through the sources (brightest first) and the
 * same text is announced through an aria-live line.
 */
export class GaiaOverlay {
  private readonly overlay = document.createElement("canvas");
  private readonly tip = document.createElement("div");
  private readonly live = document.createElement("span");
  private sources: GaiaSource[] = [];
  private epochYear = 2026.5;
  private year = 2026.5;
  private npix = 128;
  private enabled = true;
  private focusIndex = -1;
  private hoverIndex = -1;
  private readonly observer: ResizeObserver;

  constructor(private readonly base: HTMLCanvasElement, label: string) {
    const parent = base.parentElement;
    if (!parent) throw new Error("canvas has no parent");
    this.overlay.className = "gaia-overlay";
    this.overlay.tabIndex = 0;
    this.overlay.setAttribute("role", "group");
    this.overlay.setAttribute(
      "aria-label",
      `${label}: Gaia stars. Left and right arrow keys step through them.`,
    );
    this.overlay.hidden = true;
    this.tip.className = "gaia-tip";
    this.tip.setAttribute("role", "tooltip");
    this.tip.hidden = true;
    this.live.className = "sr-only";
    this.live.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");
    base.after(this.overlay);
    parent.append(this.tip, this.live);

    this.overlay.addEventListener("mousemove", (ev) => this.onMove(ev));
    this.overlay.addEventListener("mouseleave", () => this.setHover(-1));
    this.overlay.addEventListener("keydown", (ev) => this.onKey(ev));
    this.overlay.addEventListener("focus", () => {
      if (this.focusIndex < 0 && this.sources.length) this.step(0);
    });
    this.overlay.addEventListener("blur", () => {
      this.focusIndex = -1;
      this.setHover(-1);
    });
    this.observer = new ResizeObserver(() => this.redraw());
    this.observer.observe(base);
    this.observer.observe(parent); // the base can move without changing size
    window.addEventListener("resize", () => this.redraw());
  }

  /** Sources at `epochYear` (their `x`, `y` positions are for that year). */
  setSources(sources: GaiaSource[], epochYear: number): void {
    // Brightest first, so keyboard stepping starts with the most prominent stars.
    this.sources = [...sources].sort(
      (a, b) => (a.phot_g_mean_mag ?? 99) - (b.phot_g_mean_mag ?? 99),
    );
    this.epochYear = epochYear;
    this.focusIndex = -1;
    this.hoverIndex = -1;
    this.redraw();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.redraw();
  }

  get count(): number {
    return this.sources.length;
  }

  /** Redraw the rings for a frame taken at `year` (decimal year) of an `npix` image. */
  show(year: number, npix: number): void {
    this.year = year;
    this.npix = npix;
    this.redraw();
  }

  private sync(): boolean {
    const parent = this.base.parentElement;
    if (!parent) return false;
    const b = this.base.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (b.width < 2 || b.height < 2 || this.base.hidden) return false;
    const st = this.overlay.style;
    st.left = `${b.left - p.left}px`;
    st.top = `${b.top - p.top}px`;
    st.width = `${b.width}px`;
    st.height = `${b.height}px`;
    return true;
  }

  private redraw(): void {
    const visible = this.enabled && this.sources.length > 0 && !this.base.hidden;
    this.overlay.hidden = !visible;
    if (!visible) {
      this.tip.hidden = true;
      return;
    }
    if (!this.sync()) {
      this.overlay.hidden = true;
      return;
    }
    const size = this.npix * SCALE;
    if (this.overlay.width !== size) {
      this.overlay.width = size;
      this.overlay.height = size;
    }
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const radius = Math.max(3.2, this.npix / 36) * SCALE * 0.7;
    this.sources.forEach((s, i) => {
      const { cx, cy } = this.canvasXY(s);
      const active = i === this.focusIndex || i === this.hoverIndex;
      ctx.beginPath();
      ctx.arc(cx, cy, active ? radius * 1.35 : radius, 0, Math.PI * 2);
      ctx.lineWidth = (active ? 3.4 : 2.4) * (SCALE / 3);
      ctx.strokeStyle = "rgba(4, 8, 14, 0.85)";
      ctx.stroke();
      ctx.lineWidth = (active ? 2.2 : 1.3) * (SCALE / 3);
      ctx.strokeStyle = active ? ORANGE : BLUE;
      ctx.stroke();
    });
  }

  private canvasXY(s: GaiaSource): { cx: number; cy: number } {
    const p = positionAt(s, this.epochYear, this.year);
    return { cx: (p.x + 0.5) * SCALE, cy: (this.npix - p.y - 0.5) * SCALE };
  }

  private nearest(clientX: number, clientY: number): number {
    const r = this.overlay.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * this.overlay.width;
    const py = ((clientY - r.top) / r.height) * this.overlay.height;
    let best = -1;
    let bestD = (14 * this.overlay.width) / Math.max(1, r.width); // 14 screen px
    this.sources.forEach((s, i) => {
      const { cx, cy } = this.canvasXY(s);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private onMove(ev: MouseEvent): void {
    this.sync();
    this.setHover(this.nearest(ev.clientX, ev.clientY), ev);
  }

  private setHover(index: number, ev?: MouseEvent): void {
    if (index !== this.hoverIndex) {
      this.hoverIndex = index;
      this.redraw();
    }
    if (index < 0 || !ev) {
      if (this.focusIndex < 0) this.tip.hidden = true;
      return;
    }
    this.tip.textContent = describeSource(this.sources[index]);
    this.tip.hidden = false;
    const parent = this.base.parentElement;
    if (parent) {
      const p = parent.getBoundingClientRect();
      this.tip.style.left = `${Math.min(ev.clientX - p.left + 12, p.width - 12)}px`;
      this.tip.style.top = `${ev.clientY - p.top + 14}px`;
    }
  }

  private step(delta: number): void {
    const n = this.sources.length;
    if (n === 0) return;
    this.focusIndex = this.focusIndex < 0 ? 0 : (this.focusIndex + delta + n) % n;
    const s = this.sources[this.focusIndex];
    const text = `${describeSource(s)} (${this.focusIndex + 1} of ${n})`;
    this.live.textContent = text;
    this.tip.textContent = text;
    this.tip.hidden = false;
    const { cx, cy } = this.canvasXY(s);
    const r = this.overlay.getBoundingClientRect();
    const parent = this.base.parentElement?.getBoundingClientRect();
    if (parent) {
      this.tip.style.left = `${r.left - parent.left + (cx / this.overlay.width) * r.width + 12}px`;
      this.tip.style.top = `${r.top - parent.top + (cy / this.overlay.height) * r.height + 14}px`;
    }
    this.redraw();
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") this.step(1);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") this.step(-1);
    else if (ev.key === "Escape") {
      this.focusIndex = -1;
      this.tip.hidden = true;
      this.redraw();
    } else return;
    ev.preventDefault();
  }
}

/** Sources within `radiusPx` of (x, y) at `year`, nearest first. */
export function sourcesNear(
  sources: GaiaSource[],
  epochYear: number,
  year: number,
  x: number,
  y: number,
  radiusPx: number,
): Array<{ source: GaiaSource; distance: number }> {
  return sources
    .map((source) => {
      const p = positionAt(source, epochYear, year);
      return { source, distance: Math.hypot(p.x - x, p.y - y) };
    })
    .filter((m) => m.distance <= radiusPx)
    .sort((a, b) => a.distance - b.distance);
}
