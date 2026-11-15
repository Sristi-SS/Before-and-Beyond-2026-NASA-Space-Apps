// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Compare view: two epochs side by side, with a swipe divider, a fade, or a difference map.
import type { FrameMeta } from "./api";
import { drawSlice, type Stretch } from "./colormap";
import { boxSmooth, EDGE_BORDER, robustStats } from "./clientstack";
import type { Pixel } from "./picker";
import { writeState, type CmpMode } from "./state";
import { isWiseFrame, sourceName } from "./wise";

/** Wavelengths further apart than this (µm) inside SPHEREx make a brightness change ambiguous. */
export const WAVELENGTH_WARN_UM = 0.05;
/** Detections need at least this many sigma before the tool says anything about them. */
export const SIGNIFICANCE = 5;
/** A peak this close to the edge (px) gets an "edge of image" note. */
const EDGE_WARN_PX = 8;
const GAIA_RADIUS_PX = 3;

export interface CompareFrame {
  meta: FrameMeta;
  data: Float32Array;
}

export interface CompareHooks {
  stretchFor(index: number): Stretch;
  /** Whether a Gaia source is within `radiusPx` of (x, y) at either epoch; null when no Gaia data is loaded. */
  gaiaNear(x: number, y: number, a: number, b: number, radiusPx: number): boolean | null;
  openSpectrum(p: Pixel): void;
}

export interface DiffResult {
  /** (B - A) in units of the difference noise, after matching each frame's background and noise scale. */
  diff: Float32Array;
  /** Largest smoothed |diff| outside the edge border, in sigma. */
  best: { x: number; y: number; sigma: number; value: number } | null;
}

/**
 * B minus A.  Each frame loses its robust background (median) and is divided by its robust noise,
 * so the two are on one scale; dividing by sqrt(2) makes pure noise come out near 1.  Peak search
 * uses a 3x3 smooth and the robust noise of the smoothed map.
 */
export function computeDiff(a: Float32Array, b: Float32Array, n: number): DiffResult {
  const sa = robustStats(a, 3);
  const sb = robustStats(b, 3);
  const diff = new Float32Array(n * n);
  if (!(sa.sigma > 0) || !(sb.sigma > 0)) {
    diff.fill(NaN);
    return { diff, best: null };
  }
  const k = Math.SQRT1_2;
  for (let i = 0; i < diff.length; i++) {
    diff[i] = ((b[i] - sb.median) / sb.sigma - (a[i] - sa.median) / sa.sigma) * k;
  }
  const clean = diff.map((v) => (Number.isFinite(v) ? v : 0));
  const smooth = boxSmooth(clean, n);
  const interior: number[] = [];
  for (let y = EDGE_BORDER; y < n - EDGE_BORDER; y++) {
    for (let x = EDGE_BORDER; x < n - EDGE_BORDER; x += 2) interior.push(smooth[y * n + x]);
  }
  const noise = robustStats(interior).sigma;
  if (!(noise > 0)) return { diff, best: null };
  let best: DiffResult["best"] = null;
  for (let y = EDGE_BORDER; y < n - EDGE_BORDER; y++) {
    for (let x = EDGE_BORDER; x < n - EDGE_BORDER; x++) {
      const v = smooth[y * n + x];
      if (!best || Math.abs(v) > Math.abs(best.value)) best = { x, y, sigma: 0, value: v };
    }
  }
  if (best) best.sigma = Math.abs(best.value) / noise;
  return { diff, best };
}

// The theme's data colours on black: no change stays dark, so a change is the only thing that lights up.
const BLUE_END: [number, number, number] = [88, 180, 255];
const ORANGE_END: [number, number, number] = [255, 162, 74];

/** Diverging blue (dimmer) - black - orange (brighter) map; never red/green. */
export function drawDiff(diff: Float32Array, n: number, canvas: HTMLCanvasElement, clip = 5): void {
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = diff[(n - 1 - y) * n + x];
      const o = (y * n + x) * 4;
      if (!Number.isFinite(v)) {
        img.data.set([24, 26, 36, 255], o);
        continue;
      }
      const t = Math.min(1, Math.abs(v) / clip);
      const end = v < 0 ? BLUE_END : ORANGE_END;
      img.data[o] = end[0] * t;
      img.data[o + 1] = end[1] * t;
      img.data[o + 2] = end[2] * t;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export class CompareView {
  private frames: CompareFrame[] = [];
  private npix = 128;
  private mode: CmpMode;
  private ia = 0;
  private ib = 0;
  private swipePos = 50;
  private result: DiffResult | null = null;
  private ring: Pixel | null = null;

  private readonly selA = el("select");
  private readonly selB = el("select");
  private readonly modeButtons = new Map<CmpMode, HTMLButtonElement>();
  private readonly fade = el("input");
  private readonly fadeField = el("label", "field");
  private readonly jump = el("button", "", "Jump to largest change");
  private readonly open = el("button", "", "Open spectrum there");
  private readonly warn = el("p", "cmp-warn");
  private readonly area = el("div", "cmp-area");
  private readonly chips = el("div", "cmp-chips");
  private readonly legend = el("p", "cmp-legend");
  private readonly live = el("p", "sr-only");
  private readonly frameA = el("div", "cmp-frame");
  private readonly frameB = el("div", "cmp-frame");
  private readonly canvasA = el("canvas");
  private readonly canvasB = el("canvas");
  private readonly divider = el("div", "cmp-divider");
  private readonly rings: HTMLElement[] = [];

  constructor(root: HTMLElement, private readonly hooks: CompareHooks, mode: CmpMode) {
    this.mode = mode;
    root.className = "cmp-wrap";
    const labelA = el("label", "field");
    labelA.append(el("span", "", "A"), this.selA);
    const labelB = el("label", "field");
    labelB.append(el("span", "", "B"), this.selB);
    this.selA.setAttribute("aria-label", "Epoch A");
    this.selB.setAttribute("aria-label", "Epoch B");

    // Three ways to look, as one row of buttons.  (Fade was a fourth; it said nothing the swipe does not.)
    if (this.mode === "fade") this.mode = "side";
    const group = el("div", "cmp-modes");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "How to compare");
    const names: Array<[CmpMode, string]> = [["side", "Side by side"], ["swipe", "Swipe"], ["diff", "Difference"]];
    for (const [value, text] of names) {
      const b = el("button", "chip", text);
      b.type = "button";
      b.addEventListener("click", () => this.setMode(value));
      this.modeButtons.set(value, b);
      group.append(b);
    }

    this.fade.type = "range";
    this.fade.min = "0";
    this.fade.max = "100";
    this.fade.value = "50";
    this.fade.setAttribute("aria-label", "Fade from epoch A to epoch B");
    this.fadeField.append(el("span", "", "A to B"), this.fade);
    this.fade.addEventListener("input", () => this.render());

    this.open.disabled = true;
    const controls = el("div", "cmp-controls");
    const vs = el("span", "cmp-vs", "vs");
    vs.setAttribute("aria-hidden", "true");
    controls.append(labelA, vs, labelB, group);

    for (const canvas of [this.canvasA, this.canvasB]) {
      canvas.className = "cmp-canvas";
      canvas.width = 128;
      canvas.height = 128;
    }
    this.canvasA.setAttribute("role", "img");
    this.canvasB.setAttribute("role", "img");
    this.divider.tabIndex = 0;
    this.divider.setAttribute("role", "slider");
    this.divider.setAttribute("aria-label", "Swipe divider between epoch A (left) and epoch B (right)");
    this.divider.setAttribute("aria-valuemin", "0");
    this.divider.setAttribute("aria-valuemax", "100");
    this.warn.setAttribute("role", "status");
    this.chips.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");
    // Three things on screen: the two dates and the mode, the picture, one line saying how to read it.
    root.append(controls, this.area, this.legend, this.live);

    this.selA.addEventListener("change", () => this.setPair(Number(this.selA.value), this.ib));
    this.selB.addEventListener("change", () => this.setPair(this.ia, Number(this.selB.value)));
    this.jump.addEventListener("click", () => this.jumpToLargest());
    this.open.addEventListener("click", () => {
      if (this.ring) this.hooks.openSpectrum(this.ring);
    });
    this.divider.addEventListener("keydown", (ev) => this.onDividerKey(ev));
    this.frameA.addEventListener("pointerdown", (ev) => this.onPointer(ev));
    this.frameA.addEventListener("pointermove", (ev) => {
      if (ev.buttons & 1 && this.mode === "swipe") this.onPointer(ev);
    });
    this.syncModeButtons();
  }

  private syncModeButtons(): void {
    for (const [value, b] of this.modeButtons) b.setAttribute("aria-pressed", String(value === this.mode));
  }

  get pair(): { a: number | null; b: number | null } {
    return { a: this.ia, b: this.ib };
  }

  /** New frame set (group, axis or simulator changed).  `a`/`b` are the wanted epochs from the URL, if any. */
  setFrames(frames: CompareFrame[], npix: number, a: number | null, b: number | null): void {
    this.frames = frames;
    this.npix = npix;
    for (const select of [this.selA, this.selB]) {
      select.replaceChildren();
      frames.forEach((f, i) => {
        const o = el("option", "", `${f.meta.obs_time.slice(0, 10)} · ${sourceName(f.meta)}`);
        o.value = String(i);
        select.append(o);
      });
    }
    const last = Math.max(0, frames.length - 1);
    const ok = (v: number | null): v is number => v !== null && v >= 0 && v <= last;
    this.ia = ok(a) ? a : 0;
    this.ib = ok(b) ? b : last;
    this.selA.value = String(this.ia);
    this.selB.value = String(this.ib);
    this.result = null;
    this.ring = null;
    this.open.disabled = true;
    this.chips.replaceChildren();
    writeState({ a: this.ia, b: this.ib });
  }

  /** Redraw (call when the view is shown or the frames changed). */
  render(): void {
    const A = this.frames[this.ia];
    const B = this.frames[this.ib];
    this.area.replaceChildren();
    this.rings.length = 0;
    if (!A || !B) {
      this.warn.textContent = "Two epochs are needed to compare.";
      return;
    }
    this.warn.textContent = this.wavelengthWarning(A.meta, B.meta);
    const n = this.npix;
    const describe = (f: CompareFrame, which: string): string =>
      `Epoch ${which}: ${f.meta.obs_time.slice(0, 10)}, ${sourceName(f.meta)}, ${f.meta.wavelength_um.toFixed(2)} micrometres`;
    this.canvasA.setAttribute("aria-label", describe(A, "A"));
    this.canvasB.setAttribute("aria-label", describe(B, "B"));
    const drawBoth = (): void => {
      drawSlice(A.data, n, this.canvasA, this.hooks.stretchFor(this.ia));
      drawSlice(B.data, n, this.canvasB, this.hooks.stretchFor(this.ib));
    };
    this.fadeField.hidden = this.mode !== "fade";
    this.frameA.replaceChildren();
    this.frameB.replaceChildren();
    this.frameA.className = "cmp-frame";
    this.frameB.className = "cmp-frame";

    if (this.mode === "side") {
      drawBoth();
      this.frameA.append(this.canvasA, this.caption("A", A));
      this.frameB.append(this.canvasB, this.caption("B", B));
      this.area.append(this.frameA, this.frameB);
      this.legend.textContent = "A on the left, B on the right. Find the star that is in a different place.";
    } else if (this.mode === "swipe") {
      drawBoth();
      this.canvasB.style.clipPath = `inset(0 0 0 ${this.swipePos}%)`;
      this.canvasB.style.opacity = "1";
      this.divider.style.left = `${this.swipePos}%`;
      this.divider.setAttribute("aria-valuenow", String(Math.round(this.swipePos)));
      this.frameA.classList.add("solo", "swipe");
      this.frameA.append(this.canvasA, this.canvasB, this.divider, this.caption("A", A, "left"), this.caption("B", B, "right"));
      this.area.append(this.frameA);
      this.legend.textContent = "Drag the line across the picture: left of it is A, right of it is B.";
    } else if (this.mode === "fade") {
      drawBoth();
      this.canvasB.style.clipPath = "";
      this.canvasB.style.opacity = String(Number(this.fade.value) / 100);
      this.frameA.classList.add("solo", "fade");
      this.frameA.append(this.canvasA, this.canvasB);
      this.area.append(this.frameA);
      this.legend.textContent = "Slide from epoch A (0) to epoch B (100). Things that change seem to flicker or grow.";
    } else {
      this.result = computeDiff(A.data, B.data, n);
      drawDiff(this.result.diff, n, this.canvasA);
      this.canvasA.setAttribute(
        "aria-label",
        `Difference map, epoch B minus epoch A. Blue is dimmer in B, orange is brighter in B, white is no change.`,
      );
      this.canvasA.style.clipPath = "";
      this.frameA.classList.add("solo");
      this.frameA.append(this.canvasA);
      this.area.append(this.frameA);
      const caveat = this.warn.textContent ? " Different instruments: trust where things are, not how bright." : "";
      this.legend.replaceChildren(
        swatch("blue"), document.createTextNode(" was here in A   "),
        swatch("orange"), document.createTextNode(` is here in B. Dark means no change.${caveat}`),
      );
    }
    if (this.mode !== "swipe") this.canvasB.style.clipPath = "";
    if (this.mode !== "fade") this.canvasB.style.opacity = "1";
    for (const frame of this.mode === "side" ? [this.frameA, this.frameB] : [this.frameA]) {
      const ring = el("div", "pick-marker cmp-ring");
      ring.hidden = this.ring === null;
      ring.setAttribute("aria-hidden", "true");
      frame.append(ring);
      this.rings.push(ring);
    }
    this.placeRings();
  }

  private caption(which: string, f: CompareFrame, side?: string): HTMLElement {
    const c = el("span", `cmp-cap${side ? ` ${side}` : ""}`, `${which}: ${f.meta.obs_time.slice(0, 10)} · ${f.meta.wavelength_um.toFixed(2)} µm`);
    return c;
  }

  private wavelengthWarning(a: FrameMeta, b: FrameMeta): string {
    if (isWiseFrame(a) !== isWiseFrame(b) || (isWiseFrame(a) && a.detector !== b.detector)) {
      return "Warning: these two epochs come from different instruments or bands, so they are not on the same scale and a difference is not a brightness change.";
    }
    const d = Math.abs(a.wavelength_um - b.wavelength_um);
    if (!isWiseFrame(a) && d > WAVELENGTH_WARN_UM) {
      return `Warning: the wavelengths differ (${a.wavelength_um.toFixed(2)} vs ${b.wavelength_um.toFixed(2)} µm), so a brightness difference may be a colour difference, not a change in the object.`;
    }
    return "";
  }

  private setMode(mode: CmpMode): void {
    this.mode = mode;
    writeState({ cmp: mode });
    this.syncModeButtons();
    this.render();
  }

  private setPair(a: number, b: number): void {
    this.ia = a;
    this.ib = b;
    this.ring = null;
    this.open.disabled = true;
    this.chips.replaceChildren();
    writeState({ a, b });
    this.render();
  }

  private onPointer(ev: PointerEvent): void {
    if (this.mode !== "swipe") return;
    const rect = this.frameA.getBoundingClientRect();
    if (rect.width < 2) return;
    this.swipePos = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    this.applySwipe();
  }

  private onDividerKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 10 : 2;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") this.swipePos -= step;
    else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") this.swipePos += step;
    else if (ev.key === "Home") this.swipePos = 0;
    else if (ev.key === "End") this.swipePos = 100;
    else return;
    ev.preventDefault();
    this.swipePos = Math.max(0, Math.min(100, this.swipePos));
    this.applySwipe();
  }

  private applySwipe(): void {
    this.canvasB.style.clipPath = `inset(0 0 0 ${this.swipePos}%)`;
    this.divider.style.left = `${this.swipePos}%`;
    this.divider.setAttribute("aria-valuenow", String(Math.round(this.swipePos)));
  }

  private placeRings(): void {
    for (const ring of this.rings) {
      if (!this.ring) {
        ring.hidden = true;
        continue;
      }
      ring.hidden = false;
      ring.style.left = `${((this.ring.x + 0.5) / this.npix) * 100}%`;
      ring.style.top = `${((this.npix - this.ring.y - 0.5) / this.npix) * 100}%`;
      ring.style.width = `${(3 / this.npix) * 100 * 2}%`;
      ring.style.height = ring.style.width;
    }
  }

  /** Mark the pixel with the largest |difference| / noise and say what to make of it. */
  private jumpToLargest(): void {
    const A = this.frames[this.ia];
    const B = this.frames[this.ib];
    if (!A || !B) return;
    const r = computeDiff(A.data, B.data, this.npix);
    this.result = r;
    this.chips.replaceChildren();
    const add = (text: string): void => {
      this.chips.append(el("span", "cmp-chip", text));
    };
    if (!r.best) {
      add("Not enough evidence to classify");
      this.announce("No usable pixels to compare.");
      return;
    }
    const { x, y, sigma, value } = r.best;
    this.ring = { x, y };
    this.open.disabled = false;
    this.placeRings();
    const dir = value > 0 ? "brighter" : "dimmer";
    const head = `Largest change: pixel (${x}, ${y}), ${sigma > 99 ? "over 99" : sigma.toFixed(1)} sigma, ${dir} in B.`;
    const hasEdge = Math.min(x, y, this.npix - 1 - x, this.npix - 1 - y) < EDGE_WARN_PX;
    if (hasEdge) add("Edge of image: detector edges are less reliable");
    if (sigma < SIGNIFICANCE) add(`Low signal: below ${SIGNIFICANCE} sigma`);
    const near = this.hooks.gaiaNear(x, y, this.ia, this.ib, GAIA_RADIUS_PX);
    if (near) add("Near a Gaia star: probably that star, not something new");
    if (this.warn.textContent) add("Different wavelengths or instruments");
    if (sigma < SIGNIFICANCE) add("Not enough evidence to classify");
    else add("Candidate to inspect, not a detection");
    this.announce(head);
    const lead = el("span", "cmp-chip lead", head);
    this.chips.prepend(lead);
  }

  private announce(text: string): void {
    this.live.textContent = text;
  }
}

function swatch(kind: string): HTMLElement {
  const s = el("i", `swatch ${kind}`);
  s.setAttribute("aria-hidden", "true");
  return s;
}
