// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Tiny canvas chart helpers shared by the spectrum and pulse charts.  No chart library.

export const INK = "#e9eff5";
export const MUTED = "#91a3b4";
export const GRID = "#24323f";
export const BG = "#0b121a";

/** Okabe-Ito colours without red or green, so no colour pair relies on red versus green. */
export const PALETTE = ["#E69F00", "#56B4E9", "#0072B2", "#CC79A7", "#F0E442", "#B8C4CF"];

export type Shape = "circle" | "square" | "triangle" | "diamond" | "cross" | "plus";
export const SHAPES: Shape[] = ["circle", "square", "triangle", "diamond", "cross", "plus"];

export interface Plot {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Size the backing store to the CSS size (sharp on high-DPI screens).  Null while hidden. */
export function preparePlot(canvas: HTMLCanvasElement, margins = { left: 58, right: 12, top: 14, bottom: 38 }): Plot | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 40 || h < 40) return null;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h, left: margins.left, right: w - margins.right, top: margins.top, bottom: h - margins.bottom };
}

export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const f = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return f * mag;
}

export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  const step = niceStep(hi - lo, target);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

export function formatNumber(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e4 || a < 1e-2) return v.toExponential(1).replace("e+", "e");
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export interface Scale {
  lo: number;
  hi: number;
  to: (v: number) => number;
}

export function linearScale(lo: number, hi: number, a: number, b: number): Scale {
  const span = hi - lo || 1;
  return { lo, hi, to: (v) => a + ((v - lo) / span) * (b - a) };
}

export function drawFrame(
  plot: Plot,
  xs: Scale,
  ys: Scale,
  xTicks: Array<{ v: number; label: string }>,
  yTicks: number[],
  xLabel: string,
  yLabel: string,
): void {
  const { ctx } = plot;
  ctx.font = "11px 'Nunito Variable', system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of yTicks) {
    const y = Math.round(ys.to(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillText(formatNumber(v), plot.left - 6, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) {
    const x = Math.round(xs.to(t.v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
    ctx.fillText(t.label, x, plot.bottom + 5);
  }
  ctx.strokeStyle = MUTED;
  ctx.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.right - plot.left, plot.bottom - plot.top);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(xLabel, (plot.left + plot.right) / 2, plot.h - 3);
  ctx.save();
  ctx.translate(12, (plot.top + plot.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(yLabel, 0, -4);
  ctx.restore();
}

/** One marker.  `hollow` draws the outline only (flagged points). */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  size: number,
  color: string,
  hollow: boolean,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const s = size;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x, y, s, 0, Math.PI * 2);
  } else if (shape === "square") {
    ctx.rect(x - s, y - s, 2 * s, 2 * s);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - s * 1.15);
    ctx.lineTo(x + s * 1.05, y + s * 0.85);
    ctx.lineTo(x - s * 1.05, y + s * 0.85);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - s * 1.3);
    ctx.lineTo(x + s * 1.3, y);
    ctx.lineTo(x, y + s * 1.3);
    ctx.lineTo(x - s * 1.3, y);
    ctx.closePath();
  } else if (shape === "cross") {
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
  } else {
    ctx.moveTo(x - s * 1.2, y);
    ctx.lineTo(x + s * 1.2, y);
    ctx.moveTo(x, y - s * 1.2);
    ctx.lineTo(x, y + s * 1.2);
  }
  if (shape === "cross" || shape === "plus") {
    ctx.stroke();
    if (hollow) {
      // Line shapes cannot be hollow, so a flagged one gets a ring around it.
      ctx.beginPath();
      ctx.arc(x, y, s * 1.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (hollow) {
    ctx.fillStyle = BG;
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(4,8,14,0.8)";
    ctx.stroke();
  }
  ctx.restore();
}

export function drawErrorBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  color: string,
  alpha = 0.8,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.moveTo(x - 3, y0);
  ctx.lineTo(x + 3, y0);
  ctx.moveTo(x - 3, y1);
  ctx.lineTo(x + 3, y1);
  ctx.stroke();
  ctx.restore();
}

export function drawEmpty(canvas: HTMLCanvasElement, message: string): void {
  const plot = preparePlot(canvas);
  if (!plot) return;
  plot.ctx.fillStyle = MUTED;
  plot.ctx.font = "12px 'Nunito Variable', system-ui, sans-serif";
  plot.ctx.textAlign = "center";
  plot.ctx.textBaseline = "middle";
  plot.ctx.fillText(message, plot.w / 2, plot.h / 2);
}
