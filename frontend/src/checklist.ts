// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import type { FrameMeta, GaiaSource } from "./api";
import { decimalYear, sourcesNear } from "./gaia";

export type Answer = "yes" | "no" | "n/a";

export interface Row {
  question: string;
  answer: Answer;
  detail: string;
}

export interface ChecklistInput {
  frames: Array<{ meta: FrameMeta; data: Float32Array }>;
  npix: number;
  /** Peak of the stacked image (array coordinates, row 0 = south). */
  peak: { x: number; y: number } | null;
  /** Content shift (dx, dy) of each frame, in the order of `frames` sorted by MJD. */
  shifts: Array<[number, number]>;
  /** Velocity of the stack, arcsec/yr (vx east, vy north). */
  vx: number;
  vy: number;
  score: number;
  zeroScore: number;
  gaia: { epochYear: number; sources: GaiaSource[] } | null;
}

export const EDGE_PX = 3; // peak this close to the border counts as "on the edge"
export const GAIA_RADIUS_PX = 2; // within this distance of a moving Gaia star counts as that star
export const SEEN_SIGMA = 3; // per-frame detection threshold
export const SCORE_RATIO = 1.15; // peak score must beat v = 0 by this factor

/** Robust noise (1.4826 MAD) of a residual image. */
function robustSigma(values: Float32Array | number[]): number {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const med = v[Math.floor(v.length / 2)];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return 1.4826 * dev[Math.floor(dev.length / 2)];
}

/** Per-pixel temporal median of the frames. */
function temporalMedian(frames: Float32Array[], size: number): Float32Array {
  const out = new Float32Array(size);
  const col: number[] = new Array(frames.length);
  for (let i = 0; i < size; i += 1) {
    let n = 0;
    for (const f of frames) if (Number.isFinite(f[i])) col[n++] = f[i];
    if (n === 0) {
      out[i] = NaN;
      continue;
    }
    const part = col.slice(0, n).sort((a, b) => a - b);
    out[i] = part[Math.floor(n / 2)];
  }
  return out;
}

export interface SeenResult {
  epochs: number;
  passes: number;
  usable: number;
}

/**
 * In how many frames (and how many distinct passes) is there a 3-sigma bump,
 * after the fixed sky is removed, where the stacked candidate should be?
 */
export function seenIn(input: ChecklistInput): SeenResult {
  const { npix, peak } = input;
  const ordered = [...input.frames].sort((a, b) => a.meta.mjd - b.meta.mjd);
  if (!peak || ordered.length < 3 || input.shifts.length !== ordered.length) {
    return { epochs: 0, passes: 0, usable: 0 };
  }
  const size = npix * npix;
  const median = temporalMedian(ordered.map((f) => f.data), size);
  let epochs = 0;
  let usable = 0;
  const passes = new Set<number>();
  ordered.forEach((f, k) => {
    const resid = new Float32Array(size);
    for (let i = 0; i < size; i += 1) resid[i] = f.data[i] - median[i];
    const sigma = robustSigma(resid);
    // The stack shifted each frame by (dx, dy); the candidate sat at peak - shift.
    const cx = Math.round(peak.x - input.shifts[k][0]);
    const cy = Math.round(peak.y - input.shifts[k][1]);
    if (cx < 1 || cy < 1 || cx > npix - 2 || cy > npix - 2 || !(sigma > 0)) return;
    usable += 1;
    let best = -Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const v = resid[(cy + dy) * npix + cx + dx];
        if (Number.isFinite(v) && v > best) best = v;
      }
    }
    if (best > SEEN_SIGMA * sigma) {
      epochs += 1;
      passes.add(f.meta.pass);
    }
  });
  return { epochs, passes: passes.size, usable };
}

/** The evidence rows for the current stack peak.  Every row is yes or no (n/a only if the data are missing). */
export function buildChecklist(input: ChecklistInput): Row[] {
  const rows: Row[] = [];
  const { peak, npix } = input;

  const seen = seenIn(input);
  rows.push({
    question: "Seen in at least 2 passes/epochs",
    answer: !peak || seen.usable === 0 ? "n/a" : seen.passes >= 2 ? "yes" : "no",
    detail:
      seen.usable === 0
        ? "needs a peak and at least 3 frames"
        : `${seen.epochs} of ${seen.usable} frames show a ${SEEN_SIGMA}σ bump at the predicted pixel, in ${seen.passes} pass${seen.passes === 1 ? "" : "es"}`,
  });

  if (!input.gaia || !peak) {
    rows.push({
      question: "Not a Gaia star moving with it",
      answer: "n/a",
      detail: input.gaia ? "no peak" : "Gaia catalogue not loaded",
    });
  } else {
    const t0 = Math.min(...input.frames.map((f) => f.meta.mjd));
    const near = sourcesNear(input.gaia.sources, input.gaia.epochYear, decimalYear(t0), peak.x, peak.y, GAIA_RADIUS_PX);
    const tol = Math.max(1.0, 0.3 * Math.hypot(input.vx, input.vy));
    const match = near.find(({ source }) => {
      const sx = (source.pmra ?? 0) / 1000;
      const sy = (source.pmdec ?? 0) / 1000;
      return Math.hypot(sx - input.vx, sy - input.vy) <= tol;
    });
    rows.push({
      question: "Not a Gaia star moving with it",
      answer: match ? "no" : "yes",
      detail: match
        ? `Gaia DR3 ${match.source.source_id} is ${match.distance.toFixed(1)} px away and moves like this stack`
        : near.length
          ? `${near.length} Gaia star${near.length === 1 ? "" : "s"} within ${GAIA_RADIUS_PX} px, none moving like this stack`
          : `no Gaia star within ${GAIA_RADIUS_PX} px of the peak`,
    });
  }

  const margin = peak ? Math.min(peak.x, peak.y, npix - 1 - peak.x, npix - 1 - peak.y) : 0;
  rows.push({
    question: "Not on the image edge",
    answer: peak ? (margin >= EDGE_PX ? "yes" : "no") : "n/a",
    detail: peak ? `${margin.toFixed(0)} px from the nearest edge (limit ${EDGE_PX} px)` : "no peak",
  });

  const ratio = input.zeroScore > 0 ? input.score / input.zeroScore : NaN;
  rows.push({
    question: `Scores above v = 0 (at least ${SCORE_RATIO}×)`,
    answer: Number.isFinite(ratio) ? (ratio >= SCORE_RATIO ? "yes" : "no") : "n/a",
    detail: Number.isFinite(ratio)
      ? `${input.score.toFixed(1)} vs ${input.zeroScore.toFixed(1)} (${ratio.toFixed(2)}×)`
      : "no v = 0 score",
  });
  return rows;
}

/** Fill `container` with the rows.  Answers are words plus blue (yes) or orange (no), never red/green. */
export function renderChecklist(container: HTMLElement, rows: Row[]): void {
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Evidence checklist";
  const list = document.createElement("ul");
  list.className = "checklist";
  for (const row of rows) {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = `tick ${row.answer === "yes" ? "yes" : row.answer === "no" ? "no" : "na"}`;
    badge.textContent = row.answer === "n/a" ? "n/a" : row.answer === "yes" ? "Yes" : "No";
    const text = document.createElement("span");
    text.className = "check-text";
    const q = document.createElement("b");
    q.textContent = row.question;
    const d = document.createElement("small");
    d.textContent = row.detail;
    text.append(q, d);
    li.append(badge, text);
    list.appendChild(li);
  }
  const note = document.createElement("p");
  note.className = "hint small caution-note";
  note.textContent =
    "This is a candidate only. Passing these checks does not make it a detection; it still needs independent confirmation.";
  container.append(heading, list, note);
  container.hidden = false;
}
