// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Click-or-keyboard pixel picker for a canvas that shows a north-up image (row 0 is drawn at the bottom).

export interface Pixel {
  x: number;
  y: number;
}

/**
 * Makes `base` a pixel picker.  A click picks the pixel under the pointer (also through the Gaia
 * overlay that sits on top of the canvas).  With keyboard focus on the canvas, the arrow keys move a
 * dashed cursor (Shift: 5 pixels) and Enter picks.  The picked pixel is shown by a solid ring.
 */
export class PixelPicker {
  private readonly ring = document.createElement("div");
  private readonly cursorEl = document.createElement("div");
  private npix = 128;
  private picked: Pixel | null = null;
  private cursor: Pixel = { x: 64, y: 64 };
  private focused = false;

  constructor(
    private readonly base: HTMLCanvasElement,
    label: string,
    private readonly onPick: (p: Pixel) => void,
  ) {
    const parent = base.parentElement;
    if (!parent) throw new Error("canvas has no parent");
    base.tabIndex = 0;
    base.setAttribute(
      "aria-label",
      `${label}. Click a pixel, or use the arrow keys to move a cursor and Enter to open its spectrum and light curve.`,
    );
    for (const el of [this.ring, this.cursorEl]) {
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }
    this.ring.className = "pick-marker pick-selected";
    this.cursorEl.className = "pick-marker pick-cursor";
    parent.append(this.ring, this.cursorEl);

    parent.addEventListener("click", (ev) => this.onClick(ev));
    base.addEventListener("keydown", (ev) => this.onKey(ev));
    base.addEventListener("focus", () => {
      this.focused = true;
      if (this.picked) this.cursor = { ...this.picked };
      this.redraw();
    });
    base.addEventListener("blur", () => {
      this.focused = false;
      this.redraw();
    });
    const observer = new ResizeObserver(() => this.redraw());
    observer.observe(base);
    observer.observe(parent);
    window.addEventListener("resize", () => this.redraw());
  }

  setNpix(npix: number): void {
    if (npix !== this.npix) {
      this.npix = npix;
      this.cursor = { x: Math.floor(npix / 2), y: Math.floor(npix / 2) };
    }
    this.redraw();
  }

  /** Show the selected pixel (null clears it). */
  setSelected(p: Pixel | null): void {
    this.picked = p;
    if (p) this.cursor = { ...p };
    this.redraw();
  }

  /** Reposition the markers after the canvas was shown, hidden or resized. */
  refresh(): void {
    this.redraw();
  }

  private onClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target || this.base.hidden) return;
    if (target !== this.base && !target.classList.contains("gaia-overlay")) return;
    const r = this.base.getBoundingClientRect();
    if (r.width < 2 || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    const x = Math.min(this.npix - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * this.npix)));
    const row = Math.min(this.npix - 1, Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * this.npix)));
    this.cursor = { x, y: this.npix - 1 - row };
    this.onPick({ ...this.cursor });
  }

  private onKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 5 : 1;
    const c = this.cursor;
    // Canvas column = x (east at the left), canvas row from the bottom = y (north up).
    if (ev.key === "ArrowLeft") c.x = Math.max(0, c.x - step);
    else if (ev.key === "ArrowRight") c.x = Math.min(this.npix - 1, c.x + step);
    else if (ev.key === "ArrowUp") c.y = Math.min(this.npix - 1, c.y + step);
    else if (ev.key === "ArrowDown") c.y = Math.max(0, c.y - step);
    else if (ev.key === "Enter" || ev.key === " ") this.onPick({ ...c });
    else return;
    ev.preventDefault();
    this.redraw();
  }

  private place(el: HTMLElement, p: Pixel | null, show: boolean): void {
    const parent = this.base.parentElement;
    if (!parent || !p || !show || this.base.hidden) {
      el.hidden = true;
      return;
    }
    const b = this.base.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (b.width < 2) {
      el.hidden = true;
      return;
    }
    const cell = b.width / this.npix;
    el.hidden = false;
    el.style.width = `${Math.max(10, cell * 3)}px`;
    el.style.height = `${Math.max(10, cell * 3)}px`;
    el.style.left = `${b.left - pr.left + (p.x + 0.5) * cell}px`;
    el.style.top = `${b.top - pr.top + (this.npix - p.y - 0.5) * cell}px`;
  }

  private redraw(): void {
    this.place(this.ring, this.picked, true);
    this.place(this.cursorEl, this.cursor, this.focused);
  }
}
