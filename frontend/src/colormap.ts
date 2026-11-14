// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

/** Blue-to-orange ramp: no red/green pair is used to carry meaning. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [4, 8, 14]],
  [0.22, [18, 48, 78]],
  [0.45, [46, 116, 168]],
  [0.62, [98, 172, 214]],
  [0.76, [232, 176, 104]],
  [0.9, [240, 138, 60]],
  [1.0, [255, 238, 214]],
];

const LUT = (() => {
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let k = 0; k < STOPS.length - 1; k++) {
      if (t >= STOPS[k][0] && t <= STOPS[k + 1][0]) {
        a = STOPS[k];
        b = STOPS[k + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const f = (t - a[0]) / span;
    table[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * f;
    table[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
    table[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
  }
  return table;
})();

export interface Stretch {
  lo: number;
  hi: number;
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((q / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export function autoStretch(data: Float32Array, loPct = 1, hiPct = 99.5): Stretch {
  const finite: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 20000));
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return { lo: 0, hi: 1 };
  const lo = percentile(finite, loPct);
  let hi = percentile(finite, hiPct);
  if (!(hi > lo)) hi = lo + 1e-6;
  return { lo, hi };
}

/**
 * Paint one square slice onto a canvas.  Row 0 of the data is the south edge,
 * matching the north-up grid used by the backend, so rows are flipped here.
 */
export function drawSlice(
  data: Float32Array,
  npix: number,
  canvas: HTMLCanvasElement,
  range: Stretch,
): void {
  if (canvas.width !== npix) canvas.width = npix;
  if (canvas.height !== npix) canvas.height = npix;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(npix, npix);
  const span = range.hi - range.lo || 1;
  for (let y = 0; y < npix; y++) {
    const srcRow = (npix - 1 - y) * npix;
    const dstRow = y * npix * 4;
    for (let x = 0; x < npix; x++) {
      const v = data[srcRow + x];
      const t = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - range.lo) / span)) : 0;
      const k = Math.round(t * 255) * 3;
      const o = dstRow + x * 4;
      image.data[o] = LUT[k];
      image.data[o + 1] = LUT[k + 1];
      image.data[o + 2] = LUT[k + 2];
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Small canvas used as a three.js texture. */
export function sliceTextureCanvas(
  data: Float32Array,
  npix: number,
  range: Stretch,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawSlice(data, npix, canvas, range);
  return canvas;
}
