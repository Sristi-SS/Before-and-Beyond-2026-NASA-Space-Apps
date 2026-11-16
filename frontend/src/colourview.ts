// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The Colour view: one picture of what changed, and when.
//
// Grey shows what stays the same (the per-pixel median over all dates).  Colour marks a place that
// was clearly brighter than usual on at least two separate visits: blue for early dates, white for
// the middle, orange for late dates.  A moving object therefore draws a blue-to-orange line, and a
// field where nothing changed stays grey.
//
// The older version blended an early-weighted and a late-weighted average.  A mover is in each
// place on one date only, so its trail was diluted by the number of dates and all but vanished.
//
// What keeps false colour out (each rule was tuned on the five test cubes):
//  - each telescope is compared with its own median (WISE pictures are blurrier than SPHEREx ones);
//  - on top of a known star the excess must beat the star's own brightness (wavelength, focus and
//    half-pixel shifts change a star's peak from picture to picture);
//  - every pixel's excess is capped before a small smooth, so a lone hot pixel or cosmic-ray hit
//    cannot pass, while a point of light (2 to 3 pixels wide) does;
//  - the excess must be there on two visits at least 20 days apart, within two pixels, which is
//    where a mover would be next.

/** Early dates, the middle, late dates: the same ramp as the cube and the timeline. */
const EARLY: [number, number, number] = [88, 180, 255];
const MIDDLE: [number, number, number] = [255, 255, 255];
const LATE: [number, number, number] = [255, 162, 74];

/** Excess over a star must beat this many times the star's own brightness. */
const STAR_TOLERANCE = 1.5;
/** Per-pixel cap on the excess, in units of the picture's noise. */
const CAP = 8;
/** Smoothed excess where colour starts, and where it is fully on. */
const T_START = 4.5;
const T_FULL = 14;
/** Pictures closer than this (days) belong to one visit. */
const VISIT_GAP_DAYS = 20;
/** How bright the unchanged sky is drawn (0 to 1), so that colour stands out. */
const GREY_LEVEL = 0.5;

export interface ColourFrame {
  mjd: number;
  data: Float32Array;
  /** Which telescope took it ("wise" or "spherex"); pictures are compared within one telescope. */
  source?: string;
}

function median(values: Float32Array | number[], count: number): number {
  if (count === 0) return 0;
  const v = values instanceof Float32Array ? values.subarray(0, count) : Float32Array.from(values.slice(0, count));
  v.sort();
  const mid = count >> 1;
  return count % 2 ? v[mid] : 0.5 * (v[mid - 1] + v[mid]);
}

/** Separable 1-2-1 smooth, edges repeated. */
function smooth121(src: Float32Array, n: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const l = src[row + (x > 0 ? x - 1 : x)];
      const r = src[row + (x < n - 1 ? x + 1 : x)];
      tmp[row + x] = 0.25 * l + 0.5 * src[row + x] + 0.25 * r;
    }
  }
  for (let y = 0; y < n; y++) {
    const up = (y > 0 ? y - 1 : y) * n;
    const down = (y < n - 1 ? y + 1 : y) * n;
    const row = y * n;
    for (let x = 0; x < n; x++) out[row + x] = 0.25 * tmp[up + x] + 0.5 * tmp[row + x] + 0.25 * tmp[down + x];
  }
  return out;
}

/** Largest value within `radius` pixels (a square window), separable. */
function maxFilter(src: Float32Array, n: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let best = -Infinity;
      for (let k = Math.max(0, x - radius); k <= Math.min(n - 1, x + radius); k++) best = Math.max(best, src[row + k]);
      tmp[row + x] = best;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let best = -Infinity;
      for (let k = Math.max(0, y - radius); k <= Math.min(n - 1, y + radius); k++) best = Math.max(best, tmp[k * n + x]);
      out[y * n + x] = best;
    }
  }
  return out;
}

/** Everything that does not depend on which date the timeline is on. */
interface Prepared {
  npix: number;
  /** Frames in time order. */
  mjds: number[];
  /** 0 (first date) to 1 (last date). */
  when: number[];
  /** Smoothed, capped excess of each frame (noise units), and the same spread to its neighbours. */
  excess: Float32Array[];
  spread: Float32Array[];
  /** Visit number of each frame. */
  visit: number[];
  nVisits: number;
  /** The unchanged sky as a grey level, 0 to 255, in data rows (row 0 = south). */
  grey: Float32Array;
}

function prepare(input: ColourFrame[], npix: number): Prepared | null {
  const frames = [...input].sort((a, b) => a.mjd - b.mjd);
  if (frames.length < 2) return null;
  const span = frames[frames.length - 1].mjd - frames[0].mjd;
  if (!(span > 0)) return null;
  const size = npix * npix;
  const nf = frames.length;

  // Each picture in units of its own noise, with its own background removed.  An exact zero is a
  // pixel outside the detector (the server never invents data there), so it is "not seen".
  const z: Float32Array[] = [];
  const scratch = new Float32Array(size);
  for (const f of frames) {
    let count = 0;
    for (let i = 0; i < size; i++) {
      const v = f.data[i];
      if (Number.isFinite(v) && v !== 0) scratch[count++] = v;
    }
    const med = median(scratch, count);
    for (let i = 0; i < count; i++) scratch[i] = Math.abs(scratch[i] - med);
    const sigma = 1.4826 * median(scratch, count) || 1;
    const out = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const v = f.data[i];
      out[i] = Number.isFinite(v) && v !== 0 ? (v - med) / sigma : NaN;
    }
    z.push(out);
  }

  // The unchanged sky: per-pixel median over every picture (for the grey layer) ...
  const all = new Float32Array(size);
  const column = new Float32Array(nf);
  for (let i = 0; i < size; i++) {
    let c = 0;
    for (let k = 0; k < nf; k++) if (!Number.isNaN(z[k][i])) column[c++] = z[k][i];
    all[i] = median(column, c);
  }
  // ... and per telescope (for the comparison), with how bright a known star is around each pixel.
  const groups = new Map<string, number[]>();
  frames.forEach((f, k) => {
    const g = f.source ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(k);
  });
  const excess: Float32Array[] = new Array(nf);
  for (const members of groups.values()) {
    const still = new Float32Array(size);
    const seen = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      let c = 0;
      for (const k of members) if (!Number.isNaN(z[k][i])) column[c++] = z[k][i];
      seen[i] = c >= 3 ? 1 : 0;       // fewer than three looks: no claim about change here
      still[i] = Math.max(0, median(column, c));
    }
    const star = maxFilter(still, npix, 1);
    for (const k of members) {
      const s = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        const v = z[k][i];
        if (!seen[i] || Number.isNaN(v)) continue;
        const tol = STAR_TOLERANCE * star[i];
        const e = (v - still[i]) / Math.sqrt(1 + tol * tol);
        s[i] = Math.max(-CAP, Math.min(CAP, e));
      }
      const smooth = smooth121(s, npix);
      for (let i = 0; i < size; i++) smooth[i] *= 2;
      excess[k] = smooth;
    }
  }
  const spread = excess.map((s) => maxFilter(s, npix, 2));

  // Visits: pictures of one telescope taken within a few weeks.
  const visit: number[] = [];
  let id = -1;
  frames.forEach((f, k) => {
    const prev = frames[k - 1];
    if (!prev || f.mjd - prev.mjd > VISIT_GAP_DAYS || (f.source ?? "") !== (prev.source ?? "")) id++;
    visit.push(id);
  });

  // Grey layer: the unchanged sky with a soft (asinh) stretch.
  const sorted = Float32Array.from(all).sort();
  const pick = (q: number): number => sorted[Math.min(size - 1, Math.max(0, Math.floor(q * (size - 1))))];
  const hi = Math.max(pick(0.997), 1e-6);
  const soft = Math.max(pick(0.9), hi * 0.02, 1e-6);
  const norm = Math.asinh(hi / soft);
  const grey = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    grey[i] = 255 * GREY_LEVEL * Math.min(1, Math.max(0, Math.asinh(Math.max(0, all[i]) / soft) / norm));
  }

  return {
    npix,
    mjds: frames.map((f) => f.mjd),
    when: frames.map((f) => (f.mjd - frames[0].mjd) / span),
    excess,
    spread,
    visit,
    nVisits: id + 1,
    grey,
  };
}

/** The change picture of one set of frames.  Preparing is the slow part and is done once. */
export class ChangePicture {
  private frames: ColourFrame[] = [];
  private npix = 0;
  private prepared: Prepared | null | undefined;

  setFrames(frames: ColourFrame[], npix: number): void {
    this.frames = frames;
    this.npix = npix;
    this.prepared = undefined;
  }

  /** Number of dates in the picture (0 when it cannot be made). */
  get count(): number {
    return this.ready()?.mjds.length ?? 0;
  }

  private ready(): Prepared | null {
    if (this.prepared === undefined) this.prepared = prepare(this.frames, this.npix);
    return this.prepared;
  }

  /**
   * Draw the picture from every date up to and including `untilMjd` (all dates when omitted).
   * With `markNow`, whatever stands out on the last of those dates is drawn in white on top, so the
   * picture shows where things are on that date as well as where they have been.
   * Returns the number of dates used (0 when there are fewer than two dates in all) and how many
   * pixels carry colour.
   */
  draw(canvas: HTMLCanvasElement, untilMjd?: number, markNow = false): { dates: number; coloured: number } {
    const p = this.ready();
    if (!p) return { dates: 0, coloured: 0 };
    const n = p.npix;
    const size = n * n;
    let m = p.mjds.length;
    if (untilMjd !== undefined) {
      m = 0;
      while (m < p.mjds.length && p.mjds[m] <= untilMjd + 1e-6) m++;
      m = Math.max(1, m);
    }

    // Best and second-best visit at each pixel (a mover is within two pixels on its next visit),
    // and which picture was the brightest there.
    const first = new Float32Array(size).fill(-Infinity);
    const second = new Float32Array(size).fill(-Infinity);
    const own = new Float32Array(size).fill(-Infinity);
    const which = new Uint16Array(size);
    const inVisit = new Float32Array(size);
    let k = 0;
    while (k < m) {
      const v = p.visit[k];
      inVisit.fill(-Infinity);
      for (; k < m && p.visit[k] === v; k++) {
        const s = p.excess[k];
        const d = p.spread[k];
        for (let i = 0; i < size; i++) {
          if (d[i] > inVisit[i]) inVisit[i] = d[i];
          if (s[i] > own[i]) {
            own[i] = s[i];
            which[i] = k;
          }
        }
      }
      for (let i = 0; i < size; i++) {
        const x = inVisit[i];
        if (x > first[i]) {
          second[i] = first[i];
          first[i] = x;
        } else if (x > second[i]) {
          second[i] = x;
        }
      }
    }

    if (canvas.width !== n) canvas.width = n;
    if (canvas.height !== n) canvas.height = n;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dates: 0, coloured: 0 };
    const image = ctx.createImageData(n, n);
    const now = markNow ? p.excess[m - 1] : null;
    let coloured = 0;
    for (let y = 0; y < n; y++) {
      const src = (n - 1 - y) * n; // row 0 of the data is the south edge
      for (let x = 0; x < n; x++) {
        const i = src + x;
        const o = (y * n + x) * 4;
        const g = p.grey[i];
        const peak = Math.min(second[i], own[i]);
        let a = (peak - T_START) / (T_FULL - T_START);
        a = a <= 0 ? 0 : Math.pow(Math.min(1, a), 0.6);
        if (a > 0) {
          const t = p.when[which[i]];
          const from = t < 0.5 ? EARLY : MIDDLE;
          const to = t < 0.5 ? MIDDLE : LATE;
          const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
          for (let c = 0; c < 3; c++) image.data[o + c] = g * (1 - a) + (from[c] + (to[c] - from[c]) * u) * a;
        } else {
          image.data[o] = image.data[o + 1] = image.data[o + 2] = g;
        }
        if (a > 0.2) coloured++;
        if (now) {
          const b = (now[i] - T_START) / (T_FULL - T_START);
          if (b > 0) {
            const k = Math.pow(Math.min(1, b), 0.6);
            for (let c = 0; c < 3; c++) image.data[o + c] = image.data[o + c] * (1 - k) + 255 * k;
          }
        }
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return { dates: m, coloured };
  }
}
