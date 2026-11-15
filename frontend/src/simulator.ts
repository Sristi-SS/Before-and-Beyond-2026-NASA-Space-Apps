// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Planet X simulator: a clearly labelled TEST MODE.  It adds a synthetic moving point source to
// COPIES of the loaded frames, in the browser.  Real frames are never modified, and everything the
// simulator touches carries the banner "SIMULATED OBJECT - not real data" and sim=1 in the URL.
import { robustStats, yearsSince, motionPixels } from "./clientstack";
import { writeState } from "./state";
import type { Pixel } from "./picker";

export const SIM_BANNER = "SIMULATED OBJECT — not real data";
const ARCSEC_PER_RAD = 206265;
/** Approximate PSF sigma of a SPHEREx / unWISE pixel grid cut-out, in pixels. */
export const PSF_SIGMA_PX = 1;

// ---------------------------------------------------------------------------
// The teaching model (kept small on purpose)
// ---------------------------------------------------------------------------
export interface DistantMotion {
  /** East-west part: the parallax shuttle, as a straight-line speed (arcsec/yr). */
  vx: number;
  /** North-south part: the slow orbital drift (arcsec/yr). */
  vy: number;
  /** Parallax angle p = 206265 / d_AU (arcsec). */
  parallaxArcsec: number;
}

/**
 * SIMPLIFIED TEACHING MODEL for a hypothetical distant planet at `dAU` astronomical units.
 *  - Parallax: the parallax angle is p = 206265 / d_AU arcsec.  Earth crosses its orbit (2 AU) in half
 *    a year, so the object swings by 2p in half a year: as a straight-line speed that is
 *    4 * 206265 / d_AU arcsec/yr (east-west, illustrative direction).
 *  - Orbital drift: a circular orbit at d AU has v = 2 pi / sqrt(d) AU/yr, so it moves
 *    206265 * 2 pi / d^1.5 arcsec/yr (north-south, illustrative direction).
 * Real parallax is a sinusoid, not a line; this is only valid over short baselines.
 */
export function distantPlanetMotion(dAU: number): DistantMotion {
  const parallaxArcsec = ARCSEC_PER_RAD / dAU;
  return {
    vx: (2 * parallaxArcsec) / 0.5,
    vy: (ARCSEC_PER_RAD * 2 * Math.PI) / Math.pow(dAU, 1.5),
    parallaxArcsec,
  };
}

/** Unit-style self-check of the model and the planting geometry; returns the failed checks (empty = ok). */
export function simSelfCheck(): string[] {
  const failures: string[] = [];
  const near = (a: number, b: number, rel: number): boolean => Math.abs(a - b) <= rel * Math.abs(b);
  if (!near(distantPlanetMotion(206265).parallaxArcsec, 1, 1e-9)) failures.push("1 pc is 1 arcsec of parallax");
  if (!near(distantPlanetMotion(206265).vx, 4, 1e-9)) failures.push("a swing of 2p in half a year is 4 arcsec/yr at 206265 AU");
  if (!near(distantPlanetMotion(1).vy, 1296000, 1e-3)) failures.push("1 AU circular orbit is one turn per year");
  if (!(distantPlanetMotion(1e5).vx < distantPlanetMotion(1e4).vx)) failures.push("farther means slower");
  const [mx, my] = motionPixels(6.15, 6.15, 1, 6.15);
  if (!near(mx, -1, 1e-9) || !near(my, 1, 1e-9)) failures.push("east is toward smaller x, north is +y");
  const probe = new Float32Array(16 * 16);
  addGaussian(probe, 16, 8, 8, 10, 1);
  if (!near(probe[8 * 16 + 8], 10, 1e-6)) failures.push("planted peak equals the requested amplitude");
  return failures;
}

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------
export interface SimParams {
  /** Peak amplitude in multiples of each frame's own noise. */
  k: number;
  /** Start pixel at the first epoch. */
  x: number;
  y: number;
  /** arcsec/yr, east and north. */
  vx: number;
  vy: number;
}

/** Add a Gaussian of peak `amp` at (cx, cy) in place (7x7 window per sigma 1). */
export function addGaussian(data: Float32Array, n: number, cx: number, cy: number, amp: number, sigma: number): void {
  const r = Math.ceil(4 * sigma);
  for (let y = Math.max(0, Math.floor(cy) - r); y <= Math.min(n - 1, Math.ceil(cy) + r); y++) {
    for (let x = Math.max(0, Math.floor(cx) - r); x <= Math.min(n - 1, Math.ceil(cx) + r); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      data[y * n + x] += amp * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

/** Copies of `frames` with the object added; the originals are untouched. */
export function plantFrames<F extends { meta: { mjd: number }; data: Float32Array }>(
  frames: F[],
  n: number,
  pixscale: number,
  p: SimParams,
): F[] {
  if (frames.length === 0) return [];
  const t0 = Math.min(...frames.map((f) => f.meta.mjd));
  return frames.map((f) => {
    const data = new Float32Array(f.data);
    const sigma = robustStats(f.data, 3).sigma;
    const [mx, my] = motionPixels(p.vx, p.vy, yearsSince(f.meta.mjd, t0), pixscale);
    if (sigma > 0) addGaussian(data, n, p.x + mx, p.y + my, p.k * sigma, PSF_SIGMA_PX);
    return { ...f, data };
  });
}

export type Level = "bright" | "medium" | "faint";
export const LEVEL_K: Record<Level, number> = { bright: 10, medium: 6, faint: 4 };

/** Shortest track (pixels) that is not mistaken for a fixed source: a slower object sits in the temporal median. */
export const MIN_TRACK_PX = 12;

/** Longest track (pixels) a hidden object can have in the search range, or 0 if the baseline is too short. */
export function maxTrackPx(n: number, pixscale: number, spanYears: number, mapSpan: number): number {
  return Math.min(0.35 * n, (0.8 * mapSpan * spanYears) / pixscale);
}

/** Hidden random parameters for "hide and seek" (the track stays inside the field), or null if the baseline is too short. */
export function randomHidden(level: Level, n: number, pixscale: number, spanYears: number, mapSpan: number): SimParams | null {
  const longest = maxTrackPx(n, pixscale, spanYears, mapSpan);
  if (longest < MIN_TRACK_PX) return null;
  const displacement = MIN_TRACK_PX + Math.random() * (longest - MIN_TRACK_PX);
  const angle = Math.random() * 2 * Math.PI;
  const speed = (displacement * pixscale) / spanYears;
  const vx = speed * Math.cos(angle);
  const vy = speed * Math.sin(angle);
  const [mx, my] = motionPixels(vx, vy, spanYears, pixscale);
  const margin = 10;
  const pick = (m: number): number => {
    const lo = Math.max(margin, margin - m);
    const hi = Math.min(n - margin, n - margin - m);
    return lo + Math.random() * Math.max(0, hi - lo);
  };
  return {
    k: LEVEL_K[level],
    x: Math.round(pick(mx)),
    y: Math.round(pick(my)),
    vx: Math.round(vx * 10) / 10,
    vy: Math.round(vy * 10) / 10,
  };
}

/** "Found" means within one grid step in both velocity components. */
export function scoreAnswer(
  answer: { vx: number; vy: number },
  truth: { vx: number; vy: number },
  step: number,
): { found: boolean; steps: number } {
  const steps = Math.max(Math.abs(answer.vx - truth.vx), Math.abs(answer.vy - truth.vy)) / step;
  return { found: steps <= 1 + 1e-9, steps };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------
export interface SimContext {
  npix: number;
  pixscale: number;
  /** Years between the first and last frame of the current group. */
  spanYears: number;
  mapSpan: number;
  mapStep: number;
}

export interface SimHooks {
  /** Called after any change so the page can re-plant, redraw and re-run. */
  onChange(): void;
  context(): SimContext | null;
  /** The velocity currently in the tilt boxes: the visitor's answer. */
  answer(): { vx: number; vy: number };
  /** Ask the page to show a view where a click picks a pixel. */
  showPickView(): void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<"id" | "className" | "textContent" | "type" | "min" | "max" | "step" | "value" | "title", string>> = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = node("label", { className: "field" });
  l.append(node("span", { textContent: label }), input);
  return l;
}

export class Simulator {
  private enabled: boolean;
  private params: SimParams = { k: 4, x: NaN, y: NaN, vx: 4, vy: -3 };
  private hidden: SimParams | null = null;
  private level: Level = "bright";
  private picking = false;

  private readonly toggle = node("input", { type: "checkbox", id: "sim-toggle" });
  private readonly kInput = node("input", { type: "number", min: "0.2", max: "40", step: "0.2", value: "4" });
  private readonly xInput = node("input", { type: "number", min: "0", max: "511", step: "1" });
  private readonly yInput = node("input", { type: "number", min: "0", max: "511", step: "1" });
  private readonly vxInput = node("input", { type: "number", min: "-60", max: "60", step: "0.5", value: "4" });
  private readonly vyInput = node("input", { type: "number", min: "-60", max: "60", step: "0.5", value: "-3" });
  private readonly distSlider = node("input", { type: "range", min: "4", max: "6", step: "0.05", value: "4.3" });
  private readonly distRead = node("p", { className: "hint small" });
  private readonly typedRadio = node("input", { type: "radio" });
  private readonly distRadio = node("input", { type: "radio" });
  private readonly pickBtn = node("button", { type: "button", textContent: "Click the image to set start" });
  private readonly levelSelect = node("select");
  private readonly hideBtn = node("button", { type: "button", className: "primary", textContent: "Hide a planet for me" });
  private readonly checkBtn = node("button", { type: "button", textContent: "Check my answer" });
  private readonly result = node("p", { className: "hint" });
  private readonly status = node("p", { className: "hint" });
  private readonly paramBox = node("div", { className: "sim-params" });

  constructor(root: HTMLElement, private readonly hooks: SimHooks, initial: { on: boolean; simp: string | null }) {
    this.enabled = initial.on;
    const parts = (initial.simp ?? "").split(",").map(Number);
    if (parts.length === 5 && parts.every(Number.isFinite)) {
      this.params = { k: parts[0], x: parts[1], y: parts[2], vx: parts[3], vy: parts[4] };
    }
    this.build(root);
    this.syncInputs();
    this.refreshUi();
    const failed = simSelfCheck();
    if (failed.length) console.warn("simulator self-check failed:", failed);
  }

  get active(): boolean {
    return this.enabled;
  }

  /** Compact signature that changes whenever the planted frames would change (cache key for maps). */
  signature(): string {
    const p = this.hidden ?? this.params;
    return this.enabled ? `${p.k},${p.x},${p.y},${p.vx},${p.vy}` : "off";
  }

  /** Planted copies of `frames`, or the same array when the simulator is off. */
  plant<F extends { meta: { mjd: number }; data: Float32Array }>(frames: F[], ctx: SimContext): F[] {
    if (!this.enabled) return frames;
    this.ensureStart(ctx);
    return plantFrames(frames, ctx.npix, ctx.pixscale, this.hidden ?? this.params);
  }

  /** Pixel click while "set start" is armed; returns true when the click was used. */
  takePick(p: Pixel): boolean {
    if (!this.picking) return false;
    this.picking = false;
    this.params.x = p.x;
    this.params.y = p.y;
    this.syncInputs();
    this.refreshUi();
    this.changed();
    return true;
  }

  private ensureStart(ctx: SimContext): void {
    if (Number.isFinite(this.params.x) && Number.isFinite(this.params.y)) return;
    const m = Math.max(8, Math.floor(ctx.npix * 0.2));
    this.params.x = Math.round(m + Math.random() * (ctx.npix - 2 * m));
    this.params.y = Math.round(m + Math.random() * (ctx.npix - 2 * m));
    this.syncInputs();
  }

  private build(root: HTMLElement): void {
    root.replaceChildren();
    const head = node("div", { className: "sim-head" }, [
      node("h2", { textContent: "Practise on a made-up planet" }),
      node("span", { className: "sim-tag", textContent: "SIMULATED" }),
    ]);
    const lead = node("p", {
      className: "hint",
      textContent:
        "The computer hides a made-up moving dot in copies of the pictures, and you try to find it. The real pictures are never changed, and everything is marked SIMULATED while this is on.",
    });
    const toggleLabel = node("label", { className: "check" }, [
      this.toggle,
      node("span", { textContent: "Add a made-up object with my own settings" }),
    ]);
    this.toggle.checked = this.enabled;
    this.toggle.addEventListener("change", () => this.setEnabled(this.toggle.checked));

    this.typedRadio.name = "sim-vmode";
    this.distRadio.name = "sim-vmode";
    this.typedRadio.checked = true;
    const modeRow = node("div", { className: "chips" }, [
      node("label", { className: "check" }, [this.typedRadio, node("span", { textContent: "Type a velocity" })]),
      node("label", { className: "check" }, [this.distRadio, node("span", { textContent: "From a distance" })]),
    ]);
    modeRow.setAttribute("role", "radiogroup");
    modeRow.setAttribute("aria-label", "How to set the velocity");

    this.kInput.setAttribute("aria-label", "Brightness in multiples of the frame noise");
    this.distSlider.setAttribute("aria-label", "Distance of the hypothetical planet, log10 of astronomical units");
    this.distSlider.disabled = true;
    const distRow = node("label", { className: "field" }, [
      node("span", { textContent: "Distance (log scale, 10,000 to 1,000,000 AU)" }),
      this.distSlider,
    ]);

    const grid = node("div", { className: "sim-grid" }, [
      field("Brightness (× frame noise)", this.kInput),
      field("Start x (pixel)", this.xInput),
      field("Start y (pixel)", this.yInput),
      field("vx east (arcsec/yr)", this.vxInput),
      field("vy north (arcsec/yr)", this.vyInput),
    ]);
    this.paramBox.append(modeRow, distRow, this.distRead, grid, this.pickBtn);

    for (const level of ["bright", "medium", "faint"] as Level[]) {
      this.levelSelect.append(node("option", { value: level, textContent: level[0].toUpperCase() + level.slice(1) }));
    }
    const seek = node("div", { className: "sim-seek" }, [
      node("p", {
        className: "hint small",
        textContent:
          "1. Hide a planet. 2. Under Find, press Search, then press the brightest square. 3. Come back and check your answer. It works best on the WISE pictures, which span many years.",
      }),
      node("div", { className: "row" }, [field("Difficulty", this.levelSelect), this.hideBtn]),
      this.checkBtn,
      this.result,
    ]);
    this.result.setAttribute("role", "status");
    this.status.setAttribute("role", "status");
    this.checkBtn.disabled = true;

    const explain = node("details", { className: "sim-explain" }, [
      node("summary", { textContent: "Why do distant objects move slowly?" }),
      node("p", {
        className: "hint",
        textContent:
          "The farther away something is, the smaller the angle it sweeps for the same real motion, like a far-off car that barely seems to move. Part of the motion is parallax: Earth swings around the Sun, so a nearby object sways against the far-away stars, by about 2 × 206265 divided by its distance in AU, in arcseconds, every half year. A slow drift along its own orbit comes on top. A planet thousands of AU away shows only a small shift between visits, which is why many pictures are added together.",
      }),
      node("p", {
        className: "hint small",
        textContent:
          "Simplified teaching model: parallax is treated as a straight line and the directions are illustrative. Real parallax is a back-and-forth curve and a real search would fit it.",
      }),
    ]);

    const own = node("details", { className: "fold" }, [node("summary", { textContent: "Make my own" }), toggleLabel, this.paramBox]);
    root.append(head, lead, seek, this.status, own, explain);

    for (const input of [this.kInput, this.xInput, this.yInput, this.vxInput, this.vyInput]) {
      input.addEventListener("change", () => this.readInputs());
    }
    for (const radio of [this.typedRadio, this.distRadio]) {
      radio.addEventListener("change", () => {
        this.distSlider.disabled = !this.distRadio.checked;
        this.vxInput.disabled = this.distRadio.checked || this.hidden !== null;
        this.vyInput.disabled = this.vxInput.disabled;
        if (this.distRadio.checked) this.applyDistance();
      });
    }
    this.distSlider.addEventListener("input", () => this.applyDistance());
    this.pickBtn.addEventListener("click", () => {
      this.picking = true;
      this.hooks.showPickView();
      this.status.textContent = "Click a pixel on the image to place the start of the object.";
    });
    this.hideBtn.addEventListener("click", () => this.hide());
    this.checkBtn.addEventListener("click", () => this.check());
  }

  private setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.hidden = null;
      this.picking = false;
      this.result.textContent = "";
    }
    this.refreshUi();
    this.changed();
  }

  /** Switch the test mode on from outside (the guided tour). */
  enable(): void {
    this.toggle.checked = true;
    this.setEnabled(true);
  }

  private readInputs(): void {
    const num = (el: HTMLInputElement, fallback: number): number => {
      const v = Number(el.value);
      return el.value !== "" && Number.isFinite(v) ? v : fallback;
    };
    this.params = {
      k: Math.max(0.2, num(this.kInput, this.params.k)),
      x: num(this.xInput, this.params.x),
      y: num(this.yInput, this.params.y),
      vx: Math.max(-60, Math.min(60, num(this.vxInput, this.params.vx))),
      vy: Math.max(-60, Math.min(60, num(this.vyInput, this.params.vy))),
    };
    this.syncInputs();
    this.changed();
  }

  private applyDistance(): void {
    const dAU = Math.pow(10, Number(this.distSlider.value));
    const m = distantPlanetMotion(dAU);
    const vx = Math.min(60, Math.round(m.vx * 10) / 10);
    const vy = Math.min(60, Math.round(m.vy * 100) / 100);
    this.params.vx = vx;
    this.params.vy = vy;
    this.distRead.textContent =
      `d = ${Math.round(dAU).toLocaleString("en-US")} AU. Parallax 206265 / d = ${m.parallaxArcsec.toFixed(2)}″, so it swings ${(2 * m.parallaxArcsec).toFixed(1)}″ in half a year: ` +
      `about ${m.vx.toFixed(1)}″ a year east-west, plus a drift along its orbit of about ${m.vy.toFixed(2)}″ a year north-south. ` +
      "Simplified teaching model.";
    this.syncInputs();
    this.changed();
  }

  private syncInputs(): void {
    const p = this.params;
    this.kInput.value = String(p.k);
    this.xInput.value = Number.isFinite(p.x) ? String(Math.round(p.x)) : "";
    this.yInput.value = Number.isFinite(p.y) ? String(Math.round(p.y)) : "";
    this.vxInput.value = String(p.vx);
    this.vyInput.value = String(p.vy);
  }

  private refreshUi(): void {
    const locked = this.hidden !== null;
    this.paramBox.hidden = !this.enabled;
    for (const el of [this.kInput, this.xInput, this.yInput, this.pickBtn, this.typedRadio, this.distRadio]) {
      el.disabled = !this.enabled || locked;
    }
    this.vxInput.disabled = !this.enabled || locked || this.distRadio.checked;
    this.vyInput.disabled = this.vxInput.disabled;
    this.distSlider.disabled = !this.enabled || locked || !this.distRadio.checked;
    this.checkBtn.disabled = !locked;
    this.status.textContent = !this.enabled
      ? ""
      : locked
        ? "A planet is hidden. Its parameters are not shown or stored in the link."
        : "On: every view now shows pictures with a made-up object.";
  }

  private changed(): void {
    const ctx = this.hooks.context();
    if (this.enabled && ctx) this.ensureStart(ctx);
    writeState({ sim: this.enabled, simp: this.enabled && !this.hidden ? this.signature() : null });
    document.body.classList.toggle("sim-on", this.enabled);
    this.hooks.onChange();
  }

  private hide(): void {
    const ctx = this.hooks.context();
    if (!ctx) {
      this.result.textContent = "Open a cube and choose one set of pictures first.";
      return;
    }
    this.enabled = true;
    this.toggle.checked = true;
    this.level = this.levelSelect.value as Level;
    const hiddenParams = randomHidden(this.level, ctx.npix, ctx.pixscale, ctx.spanYears, ctx.mapSpan);
    if (!hiddenParams) {
      this.result.textContent =
        `These pictures cover only ${ctx.spanYears.toFixed(1)} years, too short for a hidden planet to move far enough. Choose the WISE pictures (Controls, Pictures), then try again.`;
      return;
    }
    this.hidden = hiddenParams;
    this.result.textContent = `A ${this.level} planet is hidden. Go to Find and press Search.`;
    this.refreshUi();
    this.changed();
  }

  private check(): void {
    const truth = this.hidden;
    const ctx = this.hooks.context();
    if (!truth || !ctx) return;
    const answer = this.hooks.answer();
    const score = scoreAnswer(answer, truth, ctx.mapStep);
    this.result.textContent =
      `${score.found ? "Found it!" : "Not yet."} You answered (${answer.vx}, ${answer.vy}) arcsec/yr; ` +
      `the truth was (${truth.vx}, ${truth.vy}), ${score.steps.toFixed(1)} grid steps away. ` +
      `It started at pixel (${truth.x}, ${truth.y}).`;
    this.params = { ...truth };
    this.hidden = null;
    this.syncInputs();
    this.refreshUi();
    this.changed();
  }
}
