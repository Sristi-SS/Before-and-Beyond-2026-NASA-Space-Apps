// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Browser-side shift-and-stack and velocity-grid search.  It exists only so the simulator can run
// the same idea on SIMULATED copies of the frames.  The server endpoints stay real-data only.
import type { MotionMapResult, TiltResult } from "./api";

export interface StackFrame {
  mjd: number;
  /** n*n pixels, row 0 = south, x grows west (the job grid). */
  data: Float32Array;
}

/** Pixels ignored at every edge when looking for peaks (edge pixels have partial coverage). */
export const EDGE_BORDER = 4;
const DAYS_PER_YEAR = 365.25;

export interface RobustStats {
  median: number;
  /** 1.4826 * MAD: the standard deviation of Gaussian noise, robust to stars. */
  sigma: number;
}

/** Median and robust sigma of the finite pixels (sampled when the image is large). */
export function robustStats(data: ArrayLike<number>, stride = 1): RobustStats {
  const values: number[] = [];
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i];
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return { median: 0, sigma: 0 };
  values.sort((a, b) => a - b);
  const median = values[values.length >> 1];
  const dev = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, sigma: 1.4826 * dev[dev.length >> 1] };
}

/**
 * Where a source that moves at (vx east, vy north) arcsec/yr sits after `dtYears`, relative to
 * its start, in pixels.  East is toward smaller x (matching the backend grid), north is +y.
 */
export function motionPixels(vx: number, vy: number, dtYears: number, pixscale: number): [number, number] {
  return [(-vx * dtYears) / pixscale, (vy * dtYears) / pixscale];
}

export function yearsSince(mjd: number, mjd0: number): number {
  return (mjd - mjd0) / DAYS_PER_YEAR;
}

/**
 * Remove each frame's own median, and (optionally) the per-pixel temporal median so fixed stars
 * drop out and only what changes between frames is left.  Returns new arrays.
 */
export function residualFrames(frames: StackFrame[], n: number, removeStatic: boolean): Float32Array[] {
  const flat = frames.map((f) => {
    const { median } = robustStats(f.data, 3);
    const out = new Float32Array(f.data.length);
    for (let i = 0; i < out.length; i++) out[i] = f.data[i] - median;
    return out;
  });
  if (!removeStatic || flat.length < 3) return flat;
  const npix = n * n;
  const column = new Float32Array(flat.length);
  const med = new Float32Array(npix);
  for (let i = 0; i < npix; i++) {
    let k = 0;
    for (let f = 0; f < flat.length; f++) {
      const v = flat[f][i];
      if (Number.isFinite(v)) column[k++] = v;
    }
    if (k === 0) {
      med[i] = 0;
      continue;
    }
    const sorted = column.slice(0, k).sort();
    med[i] = sorted[k >> 1];
  }
  for (const frame of flat) {
    for (let i = 0; i < npix; i++) frame[i] -= med[i];
    const { median } = robustStats(frame, 3);
    for (let i = 0; i < npix; i++) frame[i] -= median;
  }
  return flat;
}

/** Divide a frame by the robust noise of its non-zero finite pixels (unchanged if that is zero). */
function normalise(frame: Float32Array): void {
  const values: number[] = [];
  for (let i = 0; i < frame.length; i += 2) {
    const v = frame[i];
    if (Number.isFinite(v) && v !== 0) values.push(v);
  }
  const { sigma } = robustStats(values);
  if (sigma > 0) for (let i = 0; i < frame.length; i++) frame[i] /= sigma;
}

/** Grow a mask by `radius` pixels in every direction (square structuring element). */
function dilate(mask: Uint8Array, n: number, radius: number): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      for (let k = Math.max(0, x - radius); k <= Math.min(n - 1, x + radius); k++) rows[y * n + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!rows[y * n + x]) continue;
      for (let k = Math.max(0, y - radius); k <= Math.min(n - 1, y + radius); k++) out[k * n + x] = 1;
    }
  }
  return out;
}

/**
 * Residuals for the motion search, the same recipe as the server's motion map: remove the
 * per-pixel temporal median, zero the pixels around fixed sources that vary from frame to frame
 * (they leave residuals of both signs and would pile up at v = 0), then give every frame equal
 * noise weight and clip at +-8 sigma so a single spike cannot dominate.
 */
export function mapResiduals(frames: StackFrame[], n: number): Float32Array[] {
  const res = residualFrames(frames, n, true);
  const npix = n * n;
  for (const r of res) {
    for (let i = 0; i < npix; i++) if (!Number.isFinite(r[i])) r[i] = 0;
    normalise(r);
  }
  const rmax = new Float32Array(npix).fill(-Infinity);
  const rmin = new Float32Array(npix).fill(Infinity);
  for (const r of res) {
    for (let i = 0; i < npix; i++) {
      if (r[i] > rmax[i]) rmax[i] = r[i];
      if (r[i] < rmin[i]) rmin[i] = r[i];
    }
  }
  let mask: Uint8Array = new Uint8Array(npix);
  for (const k of [5, 10, 20, 40, 80, 160]) {
    const core = new Uint8Array(npix);
    for (let i = 0; i < npix; i++) core[i] = rmax[i] > k && rmin[i] < -k ? 1 : 0;
    mask = dilate(core, n, 3);
    let covered = 0;
    for (let i = 0; i < npix; i++) covered += mask[i];
    if (covered / npix < 0.25) break;
  }
  for (const r of res) {
    for (let i = 0; i < npix; i++) if (mask[i]) r[i] = 0;
    normalise(r);
    for (let i = 0; i < npix; i++) r[i] = Math.max(-8, Math.min(8, r[i]));
  }
  return res;
}

/** Add `src` sampled at (x+mx, y+my) (bilinear) to `sum`; `cnt` counts the frames that covered a pixel. */
function accumulate(sum: Float32Array, cnt: Float32Array, src: Float32Array, n: number, mx: number, my: number): void {
  for (let y = 0; y < n; y++) {
    const sy = y + my;
    if (sy < 0 || sy > n - 1) continue;
    const y0 = Math.floor(sy);
    const y1 = Math.min(n - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < n; x++) {
      const sx = x + mx;
      if (sx < 0 || sx > n - 1) continue;
      const x0 = Math.floor(sx);
      const x1 = Math.min(n - 1, x0 + 1);
      const fx = sx - x0;
      const a = src[y0 * n + x0];
      const b = src[y0 * n + x1];
      const c = src[y1 * n + x0];
      const d = src[y1 * n + x1];
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      if (Number.isFinite(v)) {
        const i = y * n + x;
        sum[i] += v;
        cnt[i] += 1;
      }
    }
  }
}

/** Flux-averaged stack of `res` frames aligned for velocity (vx, vy); frame 0's epoch is the reference. */
export function stackResiduals(
  res: Float32Array[],
  mjds: number[],
  n: number,
  pixscale: number,
  vx: number,
  vy: number,
): { stack: Float32Array; shifts: Array<[number, number]> } {
  const sum = new Float32Array(n * n);
  const cnt = new Float32Array(n * n);
  const shifts: Array<[number, number]> = [];
  const t0 = Math.min(...mjds);
  for (let f = 0; f < res.length; f++) {
    const [mx, my] = motionPixels(vx, vy, yearsSince(mjds[f], t0), pixscale);
    shifts.push([mx, my]);
    accumulate(sum, cnt, res[f], n, mx, my);
  }
  const stack = new Float32Array(n * n);
  // Pixels seen by fewer than half the frames are unreliable: show them as zero.
  const need = Math.max(1, Math.floor(res.length / 2));
  for (let i = 0; i < stack.length; i++) stack[i] = cnt[i] >= need ? sum[i] / cnt[i] : 0;
  return { stack, shifts };
}

/** 3x3 box smooth (a crude matched filter for a ~1 px PSF). */
export function boxSmooth(data: Float32Array, n: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[(y + dy) * n + x + dx];
      out[y * n + x] = s / 9;
    }
  }
  return out;
}

/** Peak of the smoothed stack (outside the edge border) in units of its robust noise. */
export function stackScore(stack: Float32Array, n: number): { score: number; x: number; y: number } {
  const smooth = boxSmooth(stack, n);
  const interior: number[] = [];
  let best = -Infinity;
  let bx = -1;
  let by = -1;
  for (let y = EDGE_BORDER; y < n - EDGE_BORDER; y++) {
    for (let x = EDGE_BORDER; x < n - EDGE_BORDER; x++) {
      const v = smooth[y * n + x];
      if ((x + y) % 2 === 0) interior.push(v);
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  const { median, sigma } = robustStats(interior);
  const score = sigma > 0 ? (best - median) / sigma : 0;
  return { score, x: bx, y: by };
}

/** Client-side equivalent of /tilt: the shifted stack for one velocity. */
export function clientTilt(
  frames: StackFrame[],
  n: number,
  pixscale: number,
  vx: number,
  vy: number,
  removeStatic: boolean,
): TiltResult {
  const res = removeStatic && frames.length >= 3 ? mapResiduals(frames, n) : residualFrames(frames, n, false);
  const mjds = frames.map((f) => f.mjd);
  const { stack, shifts } = stackResiduals(res, mjds, n, pixscale, vx, vy);
  const { score } = stackScore(stack, n);
  let min = Infinity;
  let max = -Infinity;
  for (const v of stack) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { data: stack, npix: n, score, min, max, shifts };
}

/**
 * Client-side equivalent of /motionmap: score over a (vx, vy) grid with the fixed sky removed.
 * Row j = vy index, column i = vx index, both ascending (vx east-positive, arcsec/yr).
 */
export async function clientMotionMap(
  frames: StackFrame[],
  n: number,
  pixscale: number,
  span: number,
  step: number,
  onProgress?: (fraction: number) => void,
): Promise<MotionMapResult> {
  const half = Math.min(60, Math.max(1, Math.round(span / step)));
  const nv = 2 * half + 1;
  const res = mapResiduals(frames, n);
  const mjds = frames.map((f) => f.mjd);
  const data = new Float32Array(nv * nv);
  let best = { score: -Infinity, vx: 0, vy: 0, x: -1, y: -1 };
  let zero = NaN;
  let last = performance.now();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nv; i++) {
      const vx = (i - half) * step;
      const vy = (j - half) * step;
      const { stack } = stackResiduals(res, mjds, n, pixscale, vx, vy);
      const s = stackScore(stack, n);
      data[j * nv + i] = s.score;
      if (i === half && j === half) zero = s.score;
      if (s.score > best.score) best = { score: s.score, vx, vy, x: s.x, y: s.y };
    }
    if (performance.now() - last > 40) {
      onProgress?.((j + 1) / nv);
      await new Promise((resolve) => setTimeout(resolve, 0));
      last = performance.now();
    }
  }
  onProgress?.(1);
  return {
    data,
    nv,
    span: half * step,
    step,
    bestVx: best.vx,
    bestVy: best.vy,
    bestScore: best.score,
    zeroScore: zero,
    bestX: best.x,
    bestY: best.y,
  };
}
