// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import type { MotionMapResult } from "./api";
import { autoStretch, drawSlice } from "./colormap";

const SIZE = 640;
const MARGIN = { left: 62, right: 16, top: 16, bottom: 52 };
const ORANGE = "#f08a3c";
const BLUE = "#4aa3df";
const TEXT = "#c9d6e2";

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * The motion map: score over the velocity plane.  East (positive vx) is on the
 * left like the sky, north (positive vy) is up.  The map is a ranking of
 * candidate velocities, not a detection.
 */
export class MotionMapView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image = document.createElement("canvas");
  private result: MotionMapResult | null = null;
  private picked: Velocity | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onPick: (v: Velocity) => void,
  ) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
    canvas.addEventListener("click", (ev) => {
      const v = this.velocityAt(ev.clientX, ev.clientY);
      if (v) this.pick(v);
    });
    canvas.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  get current(): MotionMapResult | null {
    return this.result;
  }

  /** Show a new map; `picked` is the velocity currently in the vx/vy boxes. */
  setResult(result: MotionMapResult | null, picked: Velocity | null): void {
    this.result = result;
    this.picked = picked;
    if (result) this.render();
    else this.ctx.clearRect(0, 0, SIZE, SIZE);
  }

  setPicked(picked: Velocity | null): void {
    this.picked = picked;
    if (this.result) this.draw();
  }

  private plotBox(): { x0: number; y0: number; w: number; h: number } {
    return {
      x0: MARGIN.left,
      y0: MARGIN.top,
      w: SIZE - MARGIN.left - MARGIN.right,
      h: SIZE - MARGIN.top - MARGIN.bottom,
    };
  }

  /** Client coordinates to a grid velocity, or null outside the plot. */
  private velocityAt(clientX: number, clientY: number): Velocity | null {
    const r = this.result;
    if (!r) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * SIZE;
    const py = ((clientY - rect.top) / rect.height) * SIZE;
    const b = this.plotBox();
    if (px < b.x0 || px > b.x0 + b.w || py < b.y0 || py > b.y0 + b.h) return null;
    const fx = (px - b.x0) / b.w; // 0 at the left = +span (east)
    const fy = (py - b.y0) / b.h; // 0 at the top = +span (north)
    const snap = (f: number): number => {
      const raw = (1 - 2 * f) * (r.span + r.step / 2);
      return Math.max(-r.span, Math.min(r.span, Math.round(raw / r.step) * r.step));
    };
    return { vx: snap(fx), vy: snap(fy) };
  }

  private pick(v: Velocity): void {
    this.picked = v;
    this.draw();
    this.onPick(v);
  }

  private onKey(ev: KeyboardEvent): void {
    const r = this.result;
    if (!r) return;
    const cur = this.picked ?? { vx: r.bestVx, vy: r.bestVy };
    const s = r.step;
    let next: Velocity | null = null;
    // Arrow keys follow the picture: left = east (+vx), up = north (+vy).
    if (ev.key === "ArrowLeft") next = { vx: cur.vx + s, vy: cur.vy };
    else if (ev.key === "ArrowRight") next = { vx: cur.vx - s, vy: cur.vy };
    else if (ev.key === "ArrowUp") next = { vx: cur.vx, vy: cur.vy + s };
    else if (ev.key === "ArrowDown") next = { vx: cur.vx, vy: cur.vy - s };
    else if (ev.key === "Enter" || ev.key === " ") next = cur;
    else if (ev.key === "b" || ev.key === "B") next = { vx: r.bestVx, vy: r.bestVy };
    if (!next) return;
    ev.preventDefault();
    const clamp = (x: number): number => Math.max(-r.span, Math.min(r.span, x));
    this.pick({ vx: clamp(next.vx), vy: clamp(next.vy) });
  }

  private render(): void {
    const r = this.result;
    if (!r) return;
    const n = r.nv;
    // East on the left: reverse every row.  drawSlice already puts row 0 (south) at the bottom.
    const flipped = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) flipped[j * n + i] = r.data[j * n + (n - 1 - i)];
    }
    drawSlice(flipped, n, this.image, autoStretch(flipped, 2, 99.8));
    this.draw();
  }

  private toCanvas(v: Velocity, r: MotionMapResult): { x: number; y: number } {
    const b = this.plotBox();
    const full = 2 * r.span + r.step;
    return {
      x: b.x0 + ((r.span + r.step / 2 - v.vx) / full) * b.w,
      y: b.y0 + ((r.span + r.step / 2 - v.vy) / full) * b.h,
    };
  }

  private draw(): void {
    const r = this.result;
    if (!r) return;
    const { ctx } = this;
    const b = this.plotBox();
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, b.x0, b.y0, b.w, b.h);
    ctx.strokeStyle = "#24323f";
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.w, b.h);

    ctx.fillStyle = TEXT;
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    const tick = niceTick(r.span);
    const first = -Math.floor(r.span / tick) * tick;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let v = first; v <= r.span + 1e-9; v += tick) {
      const p = this.toCanvas({ vx: v, vy: 0 }, r);
      ctx.fillRect(p.x, b.y0 + b.h, 1, 5);
      ctx.fillText(String(Math.round(v * 100) / 100), p.x, b.y0 + b.h + 7);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = first; v <= r.span + 1e-9; v += tick) {
      const p = this.toCanvas({ vx: 0, vy: v }, r);
      ctx.fillRect(b.x0 - 5, p.y, 5, 1);
      ctx.fillText(String(Math.round(v * 100) / 100), b.x0 - 8, p.y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("vx, east to the left (arcsec/yr)", b.x0 + b.w / 2, SIZE - 8);
    ctx.save();
    ctx.translate(15, b.y0 + b.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("vy, north up (arcsec/yr)", 0, 0);
    ctx.restore();

    // v = 0 crosshair (blue, dashed).
    const zero = this.toCanvas({ vx: 0, vy: 0 }, r);
    ctx.save();
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(zero.x, b.y0);
    ctx.lineTo(zero.x, b.y0 + b.h);
    ctx.moveTo(b.x0, zero.y);
    ctx.lineTo(b.x0 + b.w, zero.y);
    ctx.stroke();
    ctx.restore();

    // Best velocity (orange ring) and the one in the boxes (white cross).
    const best = this.toCanvas({ vx: r.bestVx, vy: r.bestVy }, r);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(best.x, best.y, 11, 0, Math.PI * 2);
    ctx.stroke();
    if (this.picked) {
      const p = this.toCanvas(this.picked, r);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
    }
  }
}

function niceTick(span: number): number {
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

/** Plain-language summary of a map, with numbers a visitor can check. */
export function describeMap(r: MotionMapResult): { headline: string; detail: string } {
  const sorted = Float32Array.from(r.data).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  const ratio = r.zeroScore > 0 ? r.bestScore / r.zeroScore : NaN;
  const contrast = median > 0 ? r.bestScore / median : NaN;
  const atEdge = Math.abs(r.bestVx) >= r.span - 1e-9 || Math.abs(r.bestVy) >= r.span - 1e-9;
  return {
    headline: `Best candidate velocity: (${r.bestVx.toFixed(1)}, ${r.bestVy.toFixed(1)}) arcsec/yr`,
    detail:
      `Score ${r.bestScore.toFixed(1)} vs ${r.zeroScore.toFixed(1)} at v = 0` +
      (Number.isFinite(ratio) ? ` (${ratio.toFixed(2)}×)` : "") +
      (Number.isFinite(contrast) ? `; ${contrast.toFixed(2)}× the map median` : "") +
      (atEdge ? ". The best cell is on the edge of the grid: widen the span." : "."),
  };
}

/** Pixel of the largest 3x3-smoothed value, ignoring a 2-pixel border (row 0 = south). */
export function peakPixel(data: Float32Array, npix: number): { x: number; y: number } | null {
  let best = -Infinity;
  let at: { x: number; y: number } | null = null;
  for (let y = 2; y < npix - 2; y++) {
    for (let x = 2; x < npix - 2; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = data[(y + dy) * npix + x + dx];
          if (Number.isFinite(v)) {
            sum += v;
            count += 1;
          }
        }
      }
      if (count === 9 && sum > best) {
        best = sum;
        at = { x, y };
      }
    }
  }
  return at;
}

/** Draw a small orange ring on a canvas already painted with drawSlice (which flips rows). */
export function markPeak(canvas: HTMLCanvasElement, peak: { x: number; y: number } | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !peak) return;
  const cx = peak.x + 0.5;
  const cy = canvas.height - peak.y - 0.5;
  ctx.save();
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = Math.max(1, canvas.width / 90);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(4, canvas.width / 24), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
