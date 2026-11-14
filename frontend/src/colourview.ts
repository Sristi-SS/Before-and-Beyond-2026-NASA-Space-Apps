// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import { percentile } from "./colormap";

/**
 * One-image change detection.  The frames are collapsed in time into two
 * images: an early-weighted mean (drawn in blue) and a late-weighted mean
 * (drawn in orange).  The two basis colours add up to white, so a source that
 * sits still is neutral, while one that moves or varies leaves a blue-to-orange
 * trail.  Orange and blue only; no red/green pair carries meaning.
 */
const BLUE: [number, number, number] = [0.0, 0.4, 0.85];
const ORANGE: [number, number, number] = [1.0, 0.6, 0.15];

export interface ColourFrame {
  mjd: number;
  data: Float32Array;
}

export function drawColourComposite(
  frames: ColourFrame[],
  npix: number,
  canvas: HTMLCanvasElement,
): boolean {
  if (frames.length < 2) return false;
  const ordered = [...frames].sort((a, b) => a.mjd - b.mjd);
  const t0 = ordered[0].mjd;
  const span = ordered[ordered.length - 1].mjd - t0;
  if (!(span > 0)) return false;

  // Per-frame background (median) removed; one stretch shared by every frame.
  const size = npix * npix;
  const stride = Math.max(1, Math.floor(size / 4000));
  const offsets: number[] = [];
  const pooled: number[] = [];
  for (const f of ordered) {
    const sample: number[] = [];
    for (let i = 0; i < size; i += stride) if (Number.isFinite(f.data[i])) sample.push(f.data[i]);
    const med = percentile(sample, 50);
    offsets.push(med);
    for (const v of sample) pooled.push(v - med);
  }
  const hi = Math.max(percentile(pooled, 99.7), 1e-9);
  const soft = Math.max(percentile(pooled, 90), hi * 0.02);
  const norm = Math.asinh(hi / soft);

  const early = new Float32Array(size);
  const late = new Float32Array(size);
  let wEarly = 0;
  let wLate = 0;
  ordered.forEach((f, k) => {
    const t = (f.mjd - t0) / span;
    const we = 1 - t;
    const wl = t;
    wEarly += we;
    wLate += wl;
    const off = offsets[k];
    for (let i = 0; i < size; i++) {
      const v = f.data[i];
      if (!Number.isFinite(v)) continue;
      early[i] += we * (v - off);
      late[i] += wl * (v - off);
    }
  });

  if (canvas.width !== npix) canvas.width = npix;
  if (canvas.height !== npix) canvas.height = npix;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const image = ctx.createImageData(npix, npix);
  const stretch = (x: number): number => Math.min(1, Math.max(0, Math.asinh(Math.max(0, x) / soft) / norm));
  for (let y = 0; y < npix; y++) {
    const src = (npix - 1 - y) * npix; // row 0 of the data is the south edge
    for (let x = 0; x < npix; x++) {
      const e = stretch(early[src + x] / wEarly);
      const l = stretch(late[src + x] / wLate);
      const o = (y * npix + x) * 4;
      for (let c = 0; c < 3; c++) {
        image.data[o + c] = Math.min(255, 255 * (e * BLUE[c] + l * ORANGE[c]));
      }
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}
