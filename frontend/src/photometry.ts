// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Per-pixel photometry: fetch, split, match wavelengths, colour index, CSV.

export interface PhotFrame {
  index: number;
  source: string;
  obs_time: string | null;
  mjd: number | null;
  pass: number | null;
  detector: number | null;
  wavelength_um: number | null;
  bandwidth_um: number | null;
  flux: number | null;
  flux_err: number | null;
  /** True: a masked (interpolated) pixel is in the aperture.  Null: no mask stored for this frame. */
  flagged: boolean | null;
  units: string;
}

export interface Photometry {
  x: number;
  y: number;
  radius_px: number;
  npix: number;
  ra_deg: number;
  dec_deg: number;
  n: number;
  flag_info: string;
  note: string;
  frames: PhotFrame[];
}

/** Wavelength difference below which two points count as "the same wavelength". */
export const MATCH_UM = 0.05;

export async function fetchPhotometry(key: string, x: number, y: number, r: number): Promise<Photometry> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(key)}/photometry?x=${x}&y=${y}&r=${r}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`photometry failed: ${res.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as Photometry;
}

export function isWise(f: PhotFrame): boolean {
  return f.source === "wise";
}

/** A frame that has everything a chart needs. */
export function usable(f: PhotFrame): boolean {
  return (
    f.flux !== null && Number.isFinite(f.flux) &&
    f.flux_err !== null && Number.isFinite(f.flux_err) &&
    f.wavelength_um !== null && f.mjd !== null
  );
}

export function spherexPoints(p: Photometry): PhotFrame[] {
  return p.frames.filter((f) => !isWise(f) && usable(f));
}

export function wisePoints(p: Photometry): PhotFrame[] {
  return p.frames.filter((f) => isWise(f) && usable(f));
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/**
 * Groups of points of one detector whose wavelengths all lie within `tol` of each other
 * (greedy, from the shortest wavelength).  Only groups with 2+ points can be connected, and
 * every pair inside a group differs by less than `tol` in wavelength.
 */
export function matchedGroups(points: PhotFrame[], tol = MATCH_UM): PhotFrame[][] {
  const byDet = new Map<number, PhotFrame[]>();
  for (const f of points) {
    const d = f.detector ?? -1;
    if (!byDet.has(d)) byDet.set(d, []);
    byDet.get(d)!.push(f);
  }
  const groups: PhotFrame[][] = [];
  for (const list of byDet.values()) {
    const sorted = [...list].sort((a, b) => (a.wavelength_um ?? 0) - (b.wavelength_um ?? 0));
    let current: PhotFrame[] = [];
    for (const f of sorted) {
      if (current.length === 0 || (f.wavelength_um ?? 0) - (current[0].wavelength_um ?? 0) < tol) {
        current.push(f);
      } else {
        groups.push(current);
        current = [f];
      }
    }
    if (current.length) groups.push(current);
  }
  return groups.map((g) => g.sort((a, b) => (a.mjd ?? 0) - (b.mjd ?? 0)));
}

export interface ColourIndex {
  detA: number;
  detB: number;
  nA: number;
  nB: number;
  medianA: number;
  medianB: number;
  ratio: number;
  flaggedA: number;
  flaggedB: number;
  /** Same ratio using unflagged points only, or NaN when a group has none. */
  ratioClean: number;
}

/** Ratio of the median flux in detector A to that in detector B (SPHEREx points only). */
export function colourIndex(points: PhotFrame[], detA: number, detB: number): ColourIndex | null {
  const a = points.filter((f) => f.detector === detA);
  const b = points.filter((f) => f.detector === detB);
  if (a.length === 0 || b.length === 0) return null;
  const medA = median(a.map((f) => f.flux as number));
  const medB = median(b.map((f) => f.flux as number));
  const cleanA = a.filter((f) => f.flagged !== true).map((f) => f.flux as number);
  const cleanB = b.filter((f) => f.flagged !== true).map((f) => f.flux as number);
  return {
    detA, detB, nA: a.length, nB: b.length, medianA: medA, medianB: medB,
    ratio: medB !== 0 ? medA / medB : NaN,
    flaggedA: a.filter((f) => f.flagged === true).length,
    flaggedB: b.filter((f) => f.flagged === true).length,
    ratioClean: cleanA.length && cleanB.length && median(cleanB) !== 0 ? median(cleanA) / median(cleanB) : NaN,
  };
}

export interface PassComparison {
  passA: number;
  passB: number;
  loUm: number;
  hiUm: number;
  nA: number;
  nB: number;
  medianA: number;
  medianB: number;
  ratio: number;
}

/** Median flux of two passes inside the wavelength range both of them cover (null: no overlap). */
export function comparePasses(points: PhotFrame[], passA: number, passB: number): PassComparison | null {
  const a = points.filter((f) => f.pass === passA);
  const b = points.filter((f) => f.pass === passB);
  if (a.length === 0 || b.length === 0) return null;
  const wa = a.map((f) => f.wavelength_um as number);
  const wb = b.map((f) => f.wavelength_um as number);
  const lo = Math.max(Math.min(...wa), Math.min(...wb));
  const hi = Math.min(Math.max(...wa), Math.max(...wb));
  if (!(hi > lo)) return null;
  const inA = a.filter((f) => (f.wavelength_um as number) >= lo && (f.wavelength_um as number) <= hi);
  const inB = b.filter((f) => (f.wavelength_um as number) >= lo && (f.wavelength_um as number) <= hi);
  if (inA.length === 0 || inB.length === 0) return null;
  const medA = median(inA.map((f) => f.flux as number));
  const medB = median(inB.map((f) => f.flux as number));
  return {
    passA, passB, loUm: lo, hiUm: hi, nA: inA.length, nB: inB.length,
    medianA: medA, medianB: medB, ratio: medB !== 0 ? medA / medB : NaN,
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(p: Photometry): string {
  const head = [
    "index", "source", "obs_time", "mjd", "pass", "detector", "wavelength_um", "bandwidth_um",
    "flux", "flux_err", "flagged", "units", "x", "y", "ra_deg", "dec_deg", "radius_px",
  ];
  const rows = p.frames.map((f) =>
    [
      f.index, f.source, f.obs_time, f.mjd, f.pass, f.detector, f.wavelength_um, f.bandwidth_um,
      f.flux, f.flux_err, f.flagged === null ? "unknown" : f.flagged ? "yes" : "no", f.units,
      p.x, p.y, p.ra_deg, p.dec_deg, p.radius_px,
    ].map(csvCell).join(","),
  );
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}

export function downloadCsv(p: Photometry, key: string): void {
  const blob = new Blob([toCsv(p)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spherex-timecube_${key.slice(0, 8)}_x${p.x}_y${p.y}_r${p.radius_px}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
