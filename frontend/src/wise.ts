// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import type { FrameMeta, GroupMeta, JobStatus } from "./api";
import { percentile, type Stretch } from "./colormap";

/** Detector numbers: 1-6 are SPHEREx, 101/102 are WISE W1/W2. */
export const DET_W1 = 101;
export const DET_W2 = 102;

export function isWiseDetector(detector: number): boolean {
  return detector === DET_W1 || detector === DET_W2;
}

export function isWiseFrame(meta: FrameMeta): boolean {
  return meta.source === "wise" || isWiseDetector(meta.detector);
}

/** "WISE W2" or "SPHEREx D6": which instrument took the frame. */
export function sourceName(meta: FrameMeta): string {
  if (isWiseFrame(meta)) return `WISE ${meta.detector === DET_W1 ? "W1" : "W2"}`;
  return `SPHEREx D${meta.detector}`;
}

export function unitName(meta: FrameMeta): string {
  return isWiseFrame(meta) ? "unWISE nanomaggies" : "MJy/sr";
}

/** Short label for a wavelength-group chip. */
export function groupLabel(g: GroupMeta): string {
  if (g.detector === DET_W1) return `WISE W1 3.4 µm (${g.count})`;
  if (g.detector === DET_W2) return `WISE W2 4.6 µm (${g.count})`;
  return `D${g.detector} ${g.range_um[0].toFixed(2)}–${g.range_um[1].toFixed(2)} µm (${g.count})`;
}

/** One-line description of a frame: source, date, wavelength, pass or epoch. */
export function frameLabel(meta: FrameMeta): string {
  const date = meta.obs_time.slice(0, 10);
  const tail = isWiseFrame(meta)
    ? `epoch ${meta.epoch ?? meta.pass}`
    : `pass ${meta.pass}`;
  return `${sourceName(meta)} · ${date} · ${meta.wavelength_um.toFixed(2)} µm · ${tail}`;
}

export type MovieBand = typeof DET_W1 | typeof DET_W2;

/** SPHEREx wavelength window that is compared with each WISE band (µm). */
export const MOVIE_SPHEREX_WINDOW: Record<MovieBand, [number, number]> = {
  [DET_W1]: [3.0, 3.8],
  [DET_W2]: [4.18, 5.0],
};

export function movieDescription(band: MovieBand): string {
  return band === DET_W2
    ? "WISE W2 (4.6 µm) epochs, then SPHEREx D6 frames (4.2–5.0 µm)"
    : "WISE W1 (3.4 µm) epochs, then SPHEREx frames at 3.0–3.8 µm";
}

/**
 * The frames of the 16-year movie, oldest first: every WISE epoch of the band
 * followed by the SPHEREx frames whose wavelength matches it.  W2 uses the
 * SPHEREx D6 detector; W1 uses any SPHEREx frame at 3.0-3.8 µm.
 */
export function selectMovieFrames<T extends { meta: FrameMeta }>(all: T[], band: MovieBand): T[] {
  const [lo, hi] = MOVIE_SPHEREX_WINDOW[band];
  return all
    .filter(({ meta }) => {
      if (meta.status !== "ok") return false;
      if (isWiseFrame(meta)) return meta.detector === band;
      if (band === DET_W2 && meta.detector !== 6) return false;
      return meta.wavelength_um >= lo && meta.wavelength_um <= hi;
    })
    .sort((a, b) => a.meta.mjd - b.meta.mjd);
}

/** A stretch from this frame alone (robust percentiles), so units never matter. */
export function ownStretch(data: Float32Array, loPct = 1, hiPct = 99.5): Stretch {
  const stride = Math.max(1, Math.floor(data.length / 12000));
  const values: number[] = [];
  for (let i = 0; i < data.length; i += stride) if (Number.isFinite(data[i])) values.push(data[i]);
  if (values.length === 0) return { lo: 0, hi: 1 };
  const lo = percentile(values, loPct);
  let hi = percentile(values, hiPct);
  if (!(hi > lo)) hi = lo + 1e-6;
  return { lo, hi };
}

export interface SourceSummary {
  archives: string;
  units: string;
  wise: string;
}

/** Text for the provenance panel, from the frames currently shown. */
export function summariseSources(frames: FrameMeta[], status: JobStatus | null): SourceSummary {
  const nWise = frames.filter(isWiseFrame).length;
  const nSph = frames.length - nWise;
  const archives: string[] = [];
  if (nSph > 0) archives.push(`IRSA SPHEREx (${nSph})`);
  if (nWise > 0) archives.push(`unWISE time-resolved coadds (${nWise})`);
  const units: string[] = [];
  if (nSph > 0) units.push("SPHEREx: MJy/sr");
  if (nWise > 0) units.push("WISE: unWISE nanomaggies");
  const w = status?.wise;
  return {
    archives: archives.join(" + ") || "IRSA SPHEREx",
    units: units.join(" · ") || "—",
    wise: w ? w.message || w.status : "—",
  };
}
