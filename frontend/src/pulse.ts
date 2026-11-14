// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Pulse view: flux versus date at one pixel, one series per wavelength group (detector).
import {
  drawEmpty, drawErrorBar, drawFrame, drawMarker, linearScale, niceTicks, preparePlot,
  PALETTE, SHAPES,
} from "./chartkit";
import { matchedGroups, MATCH_UM, type PhotFrame } from "./photometry";

export const PULSE_CAUTION =
  "Caution: every SPHEREx frame samples this pixel at a different wavelength. A brightness change between " +
  "passes in one detector can be a change in wavelength (the spectrum), not variability of the source. " +
  `\"Compare passes at matched wavelength\" connects only points whose wavelengths differ by less than ${MATCH_UM} µm.`;

export function detectorName(det: number | null): string {
  if (det === 101) return "WISE W1";
  if (det === 102) return "WISE W2";
  return `D${det}`;
}

export function detectorColor(det: number | null): string {
  if (det === 101) return PALETTE[0];
  if (det === 102) return PALETTE[2];
  return PALETTE[(((det ?? 1) - 1) % PALETTE.length + PALETTE.length) % PALETTE.length];
}

export function detectorShape(det: number | null): (typeof SHAPES)[number] {
  if (det === 101) return "circle";
  if (det === 102) return "square";
  return SHAPES[(((det ?? 1) - 1) % SHAPES.length + SHAPES.length) % SHAPES.length];
}

function decimalYear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function yearTicks(lo: number, hi: number): Array<{ v: number; label: string }> {
  const span = hi - lo;
  const candidates = [1 / 12, 0.25, 0.5, 1, 2, 5, 10];
  const step = candidates.find((c) => span / c <= 7) ?? 10;
  const out: Array<{ v: number; label: string }> = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    const year = Math.floor(v + 1e-9);
    const month = Math.min(11, Math.floor((v - year) * 12 + 1e-6));
    out.push({ v, label: step >= 1 ? String(Math.round(v)) : `${MONTHS[month]} ${year}` });
  }
  return out;
}

export interface PulseOptions {
  matched: boolean;
  units: string;
}

export function describePulse(points: PhotFrame[], name: string): string {
  if (points.length === 0) return `${name}: no measurements at this pixel.`;
  const years = points.map((f) => decimalYear(f.mjd as number));
  const dets = new Set(points.map((f) => f.detector));
  return (
    `${name} light curve: ${points.length} points in ${dets.size} wavelength group${dets.size === 1 ? "" : "s"}, ` +
    `from ${Math.min(...years).toFixed(2)} to ${Math.max(...years).toFixed(2)}.`
  );
}

export function drawPulse(canvas: HTMLCanvasElement, points: PhotFrame[], opt: PulseOptions): void {
  if (points.length === 0) {
    drawEmpty(canvas, "No measurements at this pixel.");
    return;
  }
  const plot = preparePlot(canvas);
  if (!plot) return;
  const { ctx } = plot;
  const years = points.map((f) => decimalYear(f.mjd as number));
  let xlo = Math.min(...years);
  let xhi = Math.max(...years);
  const xpad = Math.max((xhi - xlo) * 0.05, 0.04);
  xlo -= xpad;
  xhi += xpad;
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of points) {
    lo = Math.min(lo, (f.flux as number) - (f.flux_err as number));
    hi = Math.max(hi, (f.flux as number) + (f.flux_err as number));
  }
  const pad = (hi - lo || 1) * 0.08;
  const xs = linearScale(xlo, xhi, plot.left, plot.right);
  const ys = linearScale(lo - pad, hi + pad, plot.bottom, plot.top);
  drawFrame(plot, xs, ys, yearTicks(xlo, xhi), niceTicks(ys.lo, ys.hi, 5), "Date", `Flux, aperture sum (${opt.units})`);

  const connected = new Set<PhotFrame>();
  if (opt.matched) {
    for (const group of matchedGroups(points)) {
      if (group.length < 2) continue;
      const det = group[0].detector;
      ctx.strokeStyle = detectorColor(det);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      group.forEach((f, i) => {
        connected.add(f);
        const x = xs.to(decimalYear(f.mjd as number));
        const y = ys.to(f.flux as number);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  for (const f of points) {
    const x = xs.to(decimalYear(f.mjd as number));
    const color = detectorColor(f.detector);
    // In matched mode, points with no partner at the same wavelength are faded: they cannot be compared.
    const alpha = opt.matched && !connected.has(f) ? 0.3 : 1;
    ctx.globalAlpha = alpha;
    drawErrorBar(ctx, x, ys.to((f.flux as number) - (f.flux_err as number)), ys.to((f.flux as number) + (f.flux_err as number)), color, 0.8);
    ctx.globalAlpha = 1;
    drawMarker(ctx, detectorShape(f.detector), x, ys.to(f.flux as number), 4, color, f.flagged === true, alpha);
  }
}
