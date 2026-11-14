// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
export type Axis = "time" | "wave";
export type StaticMode = "median" | "none";
export type View = "cube" | "blink" | "colour" | "map" | "compare";
export type CmpMode = "side" | "swipe" | "fade" | "diff";
export type Panel = "spectrum" | "pulse";
export type Scene = "globe" | "cube" | "orbit";

export interface UrlState {
  /** Which of the three scenes is showing.  Default: cube when a job or coordinates are in the URL, else globe. */
  scene: Scene;
  job: string | null;
  ra: number | null;
  dec: number | null;
  fov: number;
  axis: Axis;
  group: number;
  t: number;
  vx: number;
  vy: number;
  view: View;
  /** 16-year movie: WISE epochs followed by SPHEREx frames of the same band. */
  movie: boolean;
  /** Overlay Gaia DR3 sources.  Off by default on phones. */
  gaia: boolean;
  /** "median" removes the fixed sky before the shift-and-sum. */
  static: StaticMode;
  /** Selected pixel on the job grid (0-based; x grows west, y north) and the open panel. */
  px: number | null;
  py: number | null;
  panel: Panel | null;
  /** Compare view: epoch indices (into the current group, time order) and display mode. */
  a: number | null;
  b: number | null;
  cmp: CmpMode;
  /** Simulator test mode.  A link with sim=1 always shows the SIMULATED banner. */
  sim: boolean;
  /** Visible simulator parameters "brightness,x,y,vx,vy" (never written while a hidden planet is active). */
  simp: string | null;
}

const AXES: Axis[] = ["time", "wave"];
const VIEWS: View[] = ["cube", "blink", "colour", "map", "compare"];
const CMPS: CmpMode[] = ["side", "swipe", "fade", "diff"];
const SCENES: Scene[] = ["globe", "cube", "orbit"];

function flag(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

/** Phones get the Gaia overlay off until the visitor asks for it. */
function isPhone(): boolean {
  try {
    return window.matchMedia("(max-width: 700px)").matches;
  } catch {
    return false;
  }
}

function num(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readPixel(p: URLSearchParams): Pick<UrlState, "px" | "py" | "panel"> {
  const px = p.has("px") ? Math.round(num(p.get("px"), NaN)) : NaN;
  const py = p.has("py") ? Math.round(num(p.get("py"), NaN)) : NaN;
  const ok = Number.isFinite(px) && Number.isFinite(py) && px >= 0 && py >= 0;
  const panel = p.get("panel");
  return {
    px: ok ? px : null,
    py: ok ? py : null,
    panel: ok ? (panel === "pulse" ? "pulse" : "spectrum") : null,
  };
}

export function readState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const axis = p.get("axis") as Axis | null;
  const view = p.get("view") as View | null;
  const scene = p.get("scene") as Scene | null;
  const hasPlace = p.has("job") || (p.has("ra") && p.has("dec"));
  return {
    scene: scene && SCENES.includes(scene) ? scene : hasPlace ? "cube" : "globe",
    job: p.get("job"),
    ra: p.has("ra") ? num(p.get("ra"), 0) : null,
    dec: p.has("dec") ? num(p.get("dec"), 0) : null,
    fov: num(p.get("fov"), 0.2),
    axis: axis && AXES.includes(axis) ? axis : "time",
    group: Math.round(num(p.get("group"), -1)),
    t: Math.round(num(p.get("t"), 0)),
    vx: num(p.get("vx"), 0),
    vy: num(p.get("vy"), 0),
    view: view && VIEWS.includes(view) ? view : "cube",
    movie: flag(p.get("movie"), false),
    gaia: flag(p.get("gaia"), !isPhone()),
    static: p.get("static") === "none" ? "none" : "median",
    ...readPixel(p),
    a: p.has("a") ? Math.max(0, Math.round(num(p.get("a"), 0))) : null,
    b: p.has("b") ? Math.max(0, Math.round(num(p.get("b"), 0))) : null,
    cmp: CMPS.includes(p.get("cmp") as CmpMode) ? (p.get("cmp") as CmpMode) : "diff",
    sim: flag(p.get("sim"), false),
    simp: /^[-\d.,e]+$/i.test(p.get("simp") ?? "") ? p.get("simp") : null,
  };
}

// The URL is written at most a few times per second.  Playback changes the
// slice up to 12 times per second, and Safari throws an error when a page
// calls history.replaceState more than about 100 times in 10 seconds.
const FLUSH_MS = 400;
let current: UrlState | null = null;
let flushTimer: number | null = null;

export function writeState(patch: Partial<UrlState>): UrlState {
  current = { ...(current ?? readState()), ...patch };
  if (flushTimer === null) {
    flushTimer = window.setTimeout(flushState, FLUSH_MS);
  }
  return current;
}

/** Write the pending state to the address bar now. */
export function flushState(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (current === null) return;
  const next = current;
  const p = new URLSearchParams();
  p.set("scene", next.scene);
  if (next.job) p.set("job", next.job);
  if (next.ra !== null) p.set("ra", next.ra.toFixed(4));
  if (next.dec !== null) p.set("dec", next.dec.toFixed(4));
  p.set("fov", next.fov.toFixed(2));
  p.set("axis", next.axis);
  p.set("group", String(next.group));
  p.set("t", String(next.t));
  p.set("vx", String(next.vx));
  p.set("vy", String(next.vy));
  p.set("view", next.view);
  if (next.movie) p.set("movie", "1");
  p.set("gaia", next.gaia ? "1" : "0");
  p.set("static", next.static);
  if (next.px !== null && next.py !== null) {
    p.set("px", String(next.px));
    p.set("py", String(next.py));
    p.set("panel", next.panel ?? "spectrum");
  }
  if (next.a !== null) p.set("a", String(next.a));
  if (next.b !== null) p.set("b", String(next.b));
  if (next.view === "compare") p.set("cmp", next.cmp);
  if (next.sim) {
    p.set("sim", "1");
    if (next.simp) p.set("simp", next.simp);
  }
  // Keep deployment flags (kiosk, projection, hardware) in the address bar.
  const keep = new URLSearchParams(window.location.search);
  for (const k of ["kiosk", "projection", "hw", "hwtoken"]) {
    const v = keep.get(k);
    if (v !== null) p.set(k, v);
  }
  const url = `${window.location.pathname}?${p.toString()}`;
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* the browser refused the update; the next change tries again */
  }
}

// Do not lose the last change when the visitor leaves or copies the link.
window.addEventListener("pagehide", flushState);
document.addEventListener("visibilitychange", flushState);
