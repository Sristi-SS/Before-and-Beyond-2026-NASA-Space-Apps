// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Compare view: two dates, and one picture of what changed between them.
//
// Three pictures in a row: BEFORE, AFTER, WHAT CHANGED.  There are no modes to choose.  The third
// picture is black where nothing changed, amber where something appeared or got brighter, and blue
// where something faded or left.  Rings mark the biggest changes in all three pictures.
//
// The two dates start on the first and last picture from the same telescope and the same infrared
// colour, because pictures from different telescopes differ everywhere (WISE is blurrier than
// SPHEREx), and that is not change in the sky.  If the visitor picks an unlike pair anyway, the
// page says so and draws no difference picture.
import type { FrameMeta } from "./api";
import { drawSlice, type Stretch } from "./colormap";
import { EDGE_BORDER, robustStats } from "./clientstack";
import { writeState } from "./state";
import { isWiseFrame } from "./wise";

/** Wavelengths further apart than this (µm) inside SPHEREx make a brightness change ambiguous. */
export const WAVELENGTH_WARN_UM = 0.05;
/** On top of a star that is in both pictures, a change must beat this share of the star's own brightness. */
const STAR_TOLERANCE = 0.3;
/** Per-pixel cap on the change, in noise units, so one hot pixel cannot pass as a point of light. */
const CAP = 8;
/** Smoothed change where colour starts, where it is fully on, and where a ring is drawn. */
const T_START = 4;
const T_FULL = 7;
const T_RING = 6;
const MAX_RINGS = 3;
const RING_APART_PX = 16;

const BRIGHTER: [number, number, number] = [255, 162, 74];
const DIMMER: [number, number, number] = [88, 180, 255];

export interface CompareFrame {
  meta: FrameMeta;
  data: Float32Array;
}

export interface CompareHooks {
  stretchFor(index: number): Stretch;
}

export interface Change {
  /** Smoothed (after minus before) in noise units; positive = brighter in the later picture. */
  map: Float32Array;
  /** The biggest changes, strongest first (grid pixels: x grows west, y grows north). */
  spots: Array<{ x: number; y: number; value: number }>;
}

function smooth121(src: Float32Array, n: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      tmp[row + x] = 0.25 * src[row + (x > 0 ? x - 1 : x)] + 0.5 * src[row + x] + 0.25 * src[row + (x < n - 1 ? x + 1 : x)];
    }
  }
  for (let y = 0; y < n; y++) {
    const up = (y > 0 ? y - 1 : y) * n;
    const down = (y < n - 1 ? y + 1 : y) * n;
    for (let x = 0; x < n; x++) out[y * n + x] = 0.25 * tmp[up + x] + 0.5 * tmp[y * n + x] + 0.25 * tmp[down + x];
  }
  return out;
}

/**
 * After minus before.  Each picture loses its background and is divided by its own noise, so the two
 * are on one scale.  Where a star is in both pictures the change must beat a share of the star's
 * brightness (a star's peak differs a little from picture to picture without the star changing).
 */
export function computeChange(before: Float32Array, after: Float32Array, n: number): Change | null {
  const sa = robustStats(before, 3);
  const sb = robustStats(after, 3);
  if (!(sa.sigma > 0) || !(sb.sigma > 0)) return null;
  const size = n * n;
  const d = new Float32Array(size);
  const both = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const a = before[i];
    const b = after[i];
    // An exact zero is a pixel outside the detector: nothing can be said there.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) continue;
    const za = (a - sa.median) / sa.sigma;
    const zb = (b - sb.median) / sb.sigma;
    d[i] = (zb - za) * Math.SQRT1_2;
    both[i] = Math.max(0, Math.min(za, zb));
  }
  const capped = new Float32Array(size);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let star = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) star = Math.max(star, both[yy * n + xx]);
        }
      }
      const tol = STAR_TOLERANCE * star;
      const v = d[y * n + x] / Math.sqrt(1 + tol * tol);
      capped[y * n + x] = Math.max(-CAP, Math.min(CAP, v));
    }
  }
  const map = smooth121(capped, n);
  for (let i = 0; i < size; i++) map[i] *= 2;

  // The biggest changes: local maxima of |map|, away from the edge and from each other.
  const found: Change["spots"] = [];
  for (let y = EDGE_BORDER; y < n - EDGE_BORDER; y++) {
    for (let x = EDGE_BORDER; x < n - EDGE_BORDER; x++) {
      const v = map[y * n + x];
      if (Math.abs(v) >= T_RING) found.push({ x, y, value: v });
    }
  }
  found.sort((p, q) => Math.abs(q.value) - Math.abs(p.value));
  const spots: Change["spots"] = [];
  for (const p of found) {
    if (spots.length >= MAX_RINGS) break;
    if (spots.every((s) => Math.hypot(s.x - p.x, s.y - p.y) >= RING_APART_PX)) spots.push(p);
  }
  return { map, spots };
}

/** Black where nothing changed; amber where brighter in the later picture, blue where dimmer. */
export function drawChange(change: Change, n: number, canvas: HTMLCanvasElement): void {
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = change.map[(n - 1 - y) * n + x]; // row 0 of the data is the south edge
      const o = (y * n + x) * 4;
      let a = (Math.abs(v) - T_START) / (T_FULL - T_START);
      a = a <= 0 ? 0 : Math.pow(Math.min(1, a), 0.6);
      const end = v < 0 ? DIMMER : BRIGHTER;
      img.data[o] = end[0] * a;
      img.data[o + 1] = end[1] * a;
      img.data[o + 2] = end[2] * a;
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

const telescope = (m: FrameMeta): string => (isWiseFrame(m) ? "WISE" : "SPHEREx");
/** Pictures that can fairly be subtracted share this key. */
const kind = (m: FrameMeta): string => `${telescope(m)}-${m.detector}`;
const date = (m: FrameMeta): string => m.obs_time.slice(0, 10);

/** First and last picture from one telescope and one infrared colour; the longest such stretch wins. */
export function defaultPair(frames: CompareFrame[]): { a: number; b: number } {
  const last = Math.max(0, frames.length - 1);
  let best: { a: number; b: number; days: number } | null = null;
  for (let i = 0; i < frames.length; i++) {
    for (let j = 0; j < frames.length; j++) {
      const A = frames[i].meta;
      const B = frames[j].meta;
      const days = B.mjd - A.mjd;
      if (days <= 20 || kind(A) !== kind(B)) continue;
      if (!isWiseFrame(A) && Math.abs(A.wavelength_um - B.wavelength_um) > WAVELENGTH_WARN_UM) continue;
      if (!best || days > best.days) best = { a: i, b: j, days };
    }
  }
  if (best) return { a: best.a, b: best.b };
  // Nothing matches: the oldest and the newest picture, whatever took them.
  let lo = 0;
  let hi = last;
  frames.forEach((f, i) => {
    if (f.meta.mjd < frames[lo].meta.mjd) lo = i;
    if (f.meta.mjd > frames[hi].meta.mjd) hi = i;
  });
  return { a: lo, b: hi };
}

interface Panel {
  figure: HTMLElement;
  caption: HTMLElement;
  frame: HTMLElement;
  canvas: HTMLCanvasElement;
  message: HTMLElement;
}

export class CompareView {
  private frames: CompareFrame[] = [];
  private npix = 128;
  private ia = 0;
  private ib = 0;

  private readonly selA = el("select");
  private readonly selB = el("select");
  private readonly note = el("p", "cmp-note");
  private readonly area = el("div", "cmp-area");
  private readonly legend = el("p", "cmp-legend");
  private readonly before = this.panel("Before");
  private readonly after = this.panel("After");
  private readonly changed = this.panel("What changed");

  constructor(root: HTMLElement, private readonly hooks: CompareHooks) {
    root.className = "cmp-wrap";
    const labelA = el("label", "field");
    labelA.append(el("span", "", "Before"), this.selA);
    const labelB = el("label", "field");
    labelB.append(el("span", "", "After"), this.selB);
    const controls = el("div", "cmp-controls");
    controls.append(labelA, labelB);
    this.note.setAttribute("role", "status");
    this.changed.figure.classList.add("changed");
    this.area.append(this.before.figure, this.after.figure, this.changed.figure);
    this.legend.append(
      swatch("orange"), document.createTextNode(" appeared or got brighter "),
      swatch("blue"), document.createTextNode(" faded or left. Black: no change. Rings mark the biggest changes."),
    );
    root.append(controls, this.note, this.area, this.legend);
    this.selA.addEventListener("change", () => this.setPair(Number(this.selA.value), this.ib));
    this.selB.addEventListener("change", () => this.setPair(this.ia, Number(this.selB.value)));
  }

  private panel(title: string): Panel {
    const figure = el("figure", "cmp-panel");
    const caption = el("figcaption", "", title);
    const frame = el("div", "cmp-frame");
    const canvas = el("canvas", "cmp-canvas");
    canvas.width = canvas.height = 128;
    canvas.setAttribute("role", "img");
    const message = el("p", "cmp-msg");
    message.hidden = true;
    frame.append(canvas, message);
    figure.append(caption, frame);
    return { figure, caption, frame, canvas, message };
  }

  get pair(): { a: number | null; b: number | null } {
    return { a: this.ia, b: this.ib };
  }

  /** New pictures (another set, order or the simulator).  `a`/`b` are the dates wanted by the link, if any. */
  setFrames(frames: CompareFrame[], npix: number, a: number | null, b: number | null): void {
    this.frames = frames;
    this.npix = npix;
    for (const select of [this.selA, this.selB]) {
      select.replaceChildren();
      frames.forEach((f, i) => {
        const o = el("option", "", `${date(f.meta)} · ${telescope(f.meta)}`);
        o.value = String(i);
        select.append(o);
      });
    }
    const last = Math.max(0, frames.length - 1);
    const ok = (v: number | null): v is number => v !== null && v >= 0 && v <= last;
    const start = defaultPair(frames);
    this.ia = ok(a) ? a : start.a;
    this.ib = ok(b) ? b : start.b;
    this.selA.value = String(this.ia);
    this.selB.value = String(this.ib);
    writeState({ a: this.ia, b: this.ib });
  }

  private setPair(a: number, b: number): void {
    this.ia = a;
    this.ib = b;
    writeState({ a, b });
    this.render();
  }

  /** Why the two pictures cannot fairly be subtracted, or "" when they can. */
  private unlike(a: FrameMeta, b: FrameMeta): string {
    if (telescope(a) !== telescope(b)) {
      return "These two pictures come from different telescopes. WISE is blurrier than SPHEREx, so they differ everywhere, even where the sky did not change. Pick two dates from the same telescope to see what changed.";
    }
    if (kind(a) !== kind(b)) {
      return "These two pictures were taken in different infrared colours, so stars differ in brightness without having changed. Pick two dates in the same colour to see what changed.";
    }
    return "";
  }

  /** Redraw (call when the view is shown or the pictures changed). */
  render(): void {
    const A = this.frames[this.ia];
    const B = this.frames[this.ib];
    for (const p of [this.before, this.after, this.changed]) {
      for (const ring of p.frame.querySelectorAll(".cmp-ring")) ring.remove();
    }
    if (!A || !B) {
      this.note.textContent = "Two pictures are needed to compare.";
      return;
    }
    const n = this.npix;
    const title = (f: CompareFrame, which: string): string =>
      `${which} · ${date(f.meta)} · ${telescope(f.meta)}`;
    this.before.caption.textContent = title(A, "Before");
    this.after.caption.textContent = title(B, "After");
    drawSlice(A.data, n, this.before.canvas, this.hooks.stretchFor(this.ia));
    drawSlice(B.data, n, this.after.canvas, this.hooks.stretchFor(this.ib));
    this.before.canvas.setAttribute("aria-label", `The sky on ${date(A.meta)}, taken by ${telescope(A.meta)}`);
    this.after.canvas.setAttribute("aria-label", `The sky on ${date(B.meta)}, taken by ${telescope(B.meta)}`);

    const problem = this.ia === this.ib ? "Both dates are the same picture. Pick two different dates." : this.unlike(A.meta, B.meta);
    const change = problem ? null : computeChange(A.data, B.data, n);
    this.changed.canvas.hidden = !change;
    this.changed.message.hidden = !!change;
    if (!change) {
      this.note.textContent = problem;
      this.changed.message.textContent = problem ? "No difference picture for this pair." : "These pictures cannot be compared.";
      this.changed.canvas.setAttribute("aria-label", "No difference picture");
      return;
    }
    drawChange(change, n, this.changed.canvas);
    const years = Math.abs(B.meta.mjd - A.meta.mjd) / 365.25;
    const apart = years >= 1 ? `${years.toFixed(1)} years apart` : `${Math.round(years * 365.25)} days apart`;
    const waveGap = !isWiseFrame(A.meta) && Math.abs(A.meta.wavelength_um - B.meta.wavelength_um) > WAVELENGTH_WARN_UM;
    const count = change.spots.length;
    this.note.textContent =
      `Same telescope, ${apart}. ` +
      (count === 0 ? "Nothing changed clearly between these two dates." : count === 1 ? "One clear change is ringed." : `${count} clear changes are ringed.`) +
      (waveGap ? ` The two pictures are in slightly different infrared colours (${A.meta.wavelength_um.toFixed(2)} and ${B.meta.wavelength_um.toFixed(2)} µm), so trust where things are more than how bright.` : "");
    this.changed.canvas.setAttribute(
      "aria-label",
      `What changed between ${date(A.meta)} and ${date(B.meta)}: amber is brighter on the later date, blue is dimmer, black is no change. ${count} clear changes.`,
    );
    for (const p of [this.before, this.after, this.changed]) {
      for (const s of change.spots) {
        const ring = el("div", "pick-marker cmp-ring");
        ring.setAttribute("aria-hidden", "true");
        ring.style.left = `${((s.x + 0.5) / n) * 100}%`;
        ring.style.top = `${((n - s.y - 0.5) / n) * 100}%`;
        ring.style.width = ring.style.height = `${(10 / n) * 100}%`;
        p.frame.append(ring);
      }
    }
  }
}

function swatch(colour: string): HTMLElement {
  const s = el("i", `swatch ${colour}`);
  s.setAttribute("aria-hidden", "true");
  return s;
}
