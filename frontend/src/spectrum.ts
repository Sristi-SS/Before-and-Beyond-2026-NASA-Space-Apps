// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Spectrum chart: flux versus wavelength for the SPHEREx frames at one pixel.
import {
  drawEmpty, drawErrorBar, drawFrame, drawMarker, linearScale, niceTicks, preparePlot,
  INK, MUTED, PALETTE, SHAPES,
} from "./chartkit";
import type { PhotFrame } from "./photometry";

export interface Molecule {
  id: string;
  label: string;
  /** Band centres in micrometres (approximate). */
  bands: Array<{ centre: number; halfWidth: number }>;
  explain: string;
}

/**
 * Approximate band positions from general astronomy knowledge, NOT fitted to this data.
 * They are presets to guide the eye; real band shapes and centres shift with temperature,
 * mixture and (for gases) the star's own spectrum.
 */
export const MOLECULES: Molecule[] = [
  {
    id: "h2o", label: "H2O ice 3.0 µm",
    bands: [{ centre: 3.0, halfWidth: 0.15 }],
    explain: "Water ice absorbs light near 3.0 µm, so a dip here can hint at ice along the line of sight.",
  },
  {
    id: "ch4", label: "CH4 3.3 µm (also 1.6, 2.2)",
    bands: [{ centre: 1.6, halfWidth: 0.06 }, { centre: 2.2, halfWidth: 0.06 }, { centre: 3.3, halfWidth: 0.1 }],
    explain: "Methane absorbs at 3.3 µm and, more weakly, near 1.6 and 2.2 µm; cool brown dwarfs and some icy bodies show it.",
  },
  {
    id: "pah", label: "PAH 3.3 µm",
    bands: [{ centre: 3.3, halfWidth: 0.06 }],
    explain: "Sooty carbon molecules (PAHs) glow near 3.3 µm in dusty nebulae, which shows as an excess here.",
  },
  {
    id: "co2", label: "CO2 4.27 µm",
    bands: [{ centre: 4.27, halfWidth: 0.1 }],
    explain: "Carbon dioxide (ice or gas) absorbs strongly near 4.27 µm; a narrow dip here can mean CO2 ice.",
  },
  {
    id: "co", label: "CO 4.67 µm",
    bands: [{ centre: 4.67, halfWidth: 0.08 }],
    explain: "Carbon monoxide absorbs near 4.67 µm; cold gas and ice around young stars often show it.",
  },
];

export const MOLECULE_NOTE =
  "Band positions are approximate general values, not fitted to this pixel. With one point per frame, " +
  "SPHEREx samples each band only a few times, so a band can fall between points.";

export interface SpectrumOptions {
  activeBands: Set<string>;
  /** Passes drawn (empty = none).  Pass numbers are those of the job. */
  visiblePasses: Set<number>;
  joinPasses: boolean;
}

export const WAVE_LO = 0.7;
export const WAVE_HI = 5.1;

export function passColor(pass: number | null): string {
  return PALETTE[(((pass ?? 1) - 1) % PALETTE.length + PALETTE.length) % PALETTE.length];
}

export function passShape(pass: number | null): (typeof SHAPES)[number] {
  return SHAPES[(((pass ?? 1) - 1) % SHAPES.length + SHAPES.length) % SHAPES.length];
}

export function describeSpectrum(points: PhotFrame[]): string {
  if (points.length === 0) return "No SPHEREx measurements at this pixel.";
  const waves = points.map((f) => f.wavelength_um as number);
  const flux = points.map((f) => f.flux as number);
  const flagged = points.filter((f) => f.flagged === true).length;
  const passes = new Set(points.map((f) => f.pass));
  return (
    `Spectrum of ${points.length} SPHEREx points from ${passes.size} pass${passes.size === 1 ? "" : "es"}, ` +
    `wavelengths ${Math.min(...waves).toFixed(2)} to ${Math.max(...waves).toFixed(2)} micrometres, ` +
    `flux from ${Math.min(...flux).toPrecision(3)} to ${Math.max(...flux).toPrecision(3)} MJy per steradian summed. ` +
    `${flagged} flagged as lower limits.`
  );
}

export function drawSpectrum(canvas: HTMLCanvasElement, points: PhotFrame[], opt: SpectrumOptions): void {
  const shown = points.filter((f) => opt.visiblePasses.has(f.pass ?? 0));
  if (shown.length === 0) {
    drawEmpty(canvas, points.length ? "No pass selected." : "No SPHEREx measurements at this pixel.");
    return;
  }
  const plot = preparePlot(canvas);
  if (!plot) return;
  const { ctx } = plot;
  let lo = 0;
  let hi = 0;
  for (const f of shown) {
    lo = Math.min(lo, (f.flux as number) - (f.flux_err as number));
    hi = Math.max(hi, (f.flux as number) + (f.flux_err as number));
  }
  const pad = (hi - lo || 1) * 0.08;
  const xs = linearScale(WAVE_LO, WAVE_HI, plot.left, plot.right);
  const ys = linearScale(lo - (lo < 0 ? pad : 0), hi + pad, plot.bottom, plot.top);
  const xTicks = [1, 2, 3, 4, 5].map((v) => ({ v, label: String(v) }));
  const yTicks = niceTicks(ys.lo, ys.hi, 5);
  // Bands are painted first, so points stay on top.
  const active = MOLECULES.filter((m) => opt.activeBands.has(m.id));
  drawFrame(plot, xs, ys, xTicks, yTicks, "Wavelength (µm)", "Flux, aperture sum (MJy/sr)");
  active.forEach((m, row) => {
    for (const b of m.bands) {
      const x0 = xs.to(b.centre - b.halfWidth);
      const x1 = xs.to(b.centre + b.halfWidth);
      ctx.fillStyle = "rgba(207,232,251,0.16)";
      ctx.fillRect(x0, plot.top, Math.max(2, x1 - x0), plot.bottom - plot.top);
      ctx.strokeStyle = "rgba(207,232,251,0.7)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xs.to(b.centre), plot.top);
      ctx.lineTo(xs.to(b.centre), plot.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // One label per molecule, on its own row, at its first band (approximate).
    const first = m.bands[m.bands.length - 1];
    ctx.font = "10.5px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#cfe8fb";
    ctx.textBaseline = "top";
    const label = `${m.label.split(" ")[0]} (approx.)`;
    const x = xs.to(first.centre);
    ctx.textAlign = x > plot.right - 90 ? "right" : "left";
    ctx.fillText(label, x + (ctx.textAlign === "right" ? -4 : 4), plot.top + 3 + row * 13);
  });
  // Zero line.
  if (ys.lo < 0 && ys.hi > 0) {
    ctx.strokeStyle = MUTED;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.left, ys.to(0));
    ctx.lineTo(plot.right, ys.to(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Thin line per pass in wavelength order, so the passes can be compared by eye.
  if (opt.joinPasses) {
    for (const pass of opt.visiblePasses) {
      const list = shown.filter((f) => f.pass === pass).sort((a, b) => (a.wavelength_um as number) - (b.wavelength_um as number));
      if (list.length < 2) continue;
      ctx.strokeStyle = passColor(pass);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      list.forEach((f, i) => {
        const x = xs.to(f.wavelength_um as number);
        const y = ys.to(f.flux as number);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  for (const f of shown) {
    const x = xs.to(f.wavelength_um as number);
    const color = passColor(f.pass);
    drawErrorBar(ctx, x, ys.to((f.flux as number) - (f.flux_err as number)), ys.to((f.flux as number) + (f.flux_err as number)), color);
    drawMarker(ctx, passShape(f.pass), x, ys.to(f.flux as number), 4, color, f.flagged === true);
  }
  ctx.fillStyle = INK;
}
