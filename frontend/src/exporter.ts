// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import type { FrameMeta } from "./api";
import { autoStretch, drawSlice, type Stretch } from "./colormap";

/** Everything the exporter needs from the page; supplied by main.ts as getters so it is never stale. */
export interface ExportContext {
  targetName: () => string;
  simActive: () => boolean;
  /** Frames currently mounted in the blink view, in play order. */
  frames: () => Array<{ meta: FrameMeta; data: Float32Array }>;
  npix: () => number;
  stretchFor: (index: number) => Stretch;
  groupLabel: () => string;
  velocity: () => { vx: number; vy: number };
  score: () => string;
  /** Client-side stack for the tilt snap clip at (vx, vy). */
  stackAt: (vx: number, vy: number) => { data: Float32Array; npix: number } | null;
  say: (message: string) => void;
}

const SIZE = 512;
const REAL_LINE = "SPHEREx Time Cube — real archive data";
const SIM_LINE = "SIMULATED OBJECT — not real data";

export function watermark(simulated: boolean): string {
  return simulated ? SIM_LINE : REAL_LINE;
}

export function sourceText(meta: FrameMeta | undefined): string {
  if (!meta) return "";
  return meta.source === "wise" ? `WISE ${meta.band ?? ""}`.trim() : "SPHEREx";
}

function frameLines(meta: FrameMeta | undefined, target: string, simulated: boolean): string[] {
  const date = meta?.obs_time ? meta.obs_time.slice(0, 10) : "";
  const wave = meta && Number.isFinite(meta.wavelength_um) ? `${meta.wavelength_um.toFixed(2)} um` : "";
  return [
    `${target || "custom position"}  |  ${sourceText(meta)}`,
    `${date}  |  ${wave}`.trim(),
    watermark(simulated),
  ];
}

function drawCaption(ctx: CanvasRenderingContext2D, lines: string[], simulated: boolean): void {
  const lineH = 22;
  const h = lines.length * lineH + 12;
  ctx.fillStyle = simulated ? "rgba(120,10,10,0.88)" : "rgba(8,13,19,0.85)";
  ctx.fillRect(0, SIZE - h, SIZE, h);
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "top";
  lines.forEach((t, i) => ctx.fillText(t, 10, SIZE - h + 8 + i * lineH, SIZE - 20));
  if (simulated) {
    // A second, unmissable mark in the corner so a crop of the caption still carries it.
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "rgba(255,80,80,0.95)";
    ctx.fillText(SIM_LINE, 10, 8, SIZE - 20);
  }
}

/** Paint a small slice onto the 512x512 export canvas (nearest neighbour) and add the caption. */
function paintFrame(
  out: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  data: Float32Array,
  npix: number,
  range: Stretch,
  lines: string[],
  simulated: boolean,
): void {
  drawSlice(data, npix, scratch, range);
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(scratch, 0, 0, SIZE, SIZE);
  drawCaption(ctx, lines, simulated);
}

function newCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Single place downloads go through, so a test can wrap it: window.__exportHook(blob, name). */
function deliver(blob: Blob, name: string): void {
  const hook = (window as unknown as { __exportHook?: (b: Blob, n: string) => void }).__exportHook;
  if (hook) hook(blob, name);
  else download(blob, name);
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Record painted frames as WebM; resolves with the blob, or null when recording is unavailable. */
async function recordWebm(count: number, paint: (i: number, out: HTMLCanvasElement) => void, ms: number): Promise<Blob | null> {
  const mime = pickMime();
  const out = newCanvas();
  paint(0, out);
  if (!mime || !out.captureStream) return null;
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: "video/webm" }));
  });
  rec.start(200);
  for (let i = 0; i < count; i++) {
    paint(i, out);
    track.requestFrame?.();
    await sleep(ms);
  }
  paint(count - 1, out);
  track.requestFrame?.();
  await sleep(ms);
  rec.stop();
  return done;
}

/** PNG contact strip: up to 8 frames in a row, used when MediaRecorder is missing. */
async function contactStrip(x: ExportContext): Promise<Blob | null> {
  const frames = x.frames();
  const pick = frames.filter((_, i) => i % Math.max(1, Math.ceil(frames.length / 8)) === 0).slice(0, 8);
  const cell = 256;
  const out = document.createElement("canvas");
  out.width = cell * pick.length;
  out.height = cell;
  const g = out.getContext("2d");
  if (!g) return null;
  const tmp = newCanvas();
  const scratch = document.createElement("canvas");
  const sim = x.simActive();
  pick.forEach((f, i) => {
    const idx = frames.indexOf(f);
    paintFrame(tmp, scratch, f.data, x.npix(), x.stretchFor(idx), frameLines(f.meta, x.targetName(), sim), sim);
    g.drawImage(tmp, i * cell, 0, cell, cell);
  });
  return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
}

export async function exportMovie(x: ExportContext): Promise<void> {
  const frames = x.frames();
  if (frames.length === 0) {
    x.say("Nothing to export yet. Build a cube first.");
    return;
  }
  const sim = x.simActive();
  const scratch = document.createElement("canvas");
  const npix = x.npix();
  x.say(`Recording ${frames.length} frames…`);
  const blob = await recordWebm(frames.length, (i, out) => {
    const f = frames[i];
    paintFrame(out, scratch, f.data, npix, x.stretchFor(i), frameLines(f.meta, x.targetName(), sim), sim);
  }, 250);
  if (blob && blob.size > 0) {
    deliver(blob, `spherex-time-cube-${sim ? "SIMULATED-" : ""}movie.webm`);
    x.say(`Movie saved (${Math.round(blob.size / 1024)} KB WebM, ${frames.length} frames).`);
    return;
  }
  const png = await contactStrip(x);
  if (png) {
    deliver(png, `spherex-time-cube-${sim ? "SIMULATED-" : ""}strip.png`);
    x.say("Video recording is not available in this browser; saved a PNG contact strip instead.");
  } else {
    x.say("Export failed: this browser can neither record video nor draw the strip.");
  }
}

export async function exportTiltSnap(x: ExportContext): Promise<void> {
  const { vx, vy } = x.velocity();
  const frames = x.frames();
  if (frames.length === 0) {
    x.say("Build a cube first.");
    return;
  }
  const steps = 40;
  const sim = x.simActive();
  x.say("Computing the tilt clip in your browser…");
  await sleep(0);
  const last = x.stackAt(vx, vy);
  if (!last) {
    x.say("Pick a single wavelength group before making the tilt clip.");
    return;
  }
  const range = autoStretch(last.data, 5, 99.97);
  const stacks: Array<Float32Array | null> = [];
  for (let i = 0; i <= steps; i++) {
    const s = i === steps ? last : x.stackAt((vx * i) / steps, (vy * i) / steps);
    stacks.push(s ? s.data : null);
    if (i % 8 === 0) await sleep(0);
  }
  const meta = frames[0].meta;
  const scratch = document.createElement("canvas");
  const blob = await recordWebm(steps + 1, (i, out) => {
    const lines = frameLines(meta, x.targetName(), sim);
    lines[1] = `tilt snap: v = ${((vx * i) / steps).toFixed(1)}, ${((vy * i) / steps).toFixed(1)} arcsec/yr`;
    paintFrame(out, scratch, stacks[i] ?? last.data, last.npix, range, lines, sim);
  }, 100);
  if (blob && blob.size > 0) {
    deliver(blob, `spherex-time-cube-${sim ? "SIMULATED-" : ""}tilt-snap.webm`);
    x.say(`Tilt clip saved (${Math.round(blob.size / 1024)} KB WebM).`);
  } else {
    x.say("Video recording is not available in this browser, so no tilt clip was saved.");
  }
}

/** PNG of a result canvas with a caption strip underneath. */
export async function exportCanvasImage(x: ExportContext, src: HTMLCanvasElement, kind: string): Promise<void> {
  const sim = x.simActive();
  const { vx, vy } = x.velocity();
  const lines = [
    `${x.targetName() || "custom position"}  |  ${x.groupLabel()}  |  ${kind}`,
    `velocity (${vx.toFixed(1)}, ${vy.toFixed(1)}) arcsec/yr  |  score ${x.score()}  |  candidate only`,
    watermark(sim),
  ];
  const w = Math.max(src.width, 512);
  const scale = w / src.width;
  const img = src.height * scale;
  const strip = 80;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = Math.round(img) + strip;
  const g = out.getContext("2d");
  if (!g) {
    x.say("Could not draw the image.");
    return;
  }
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#000";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0, w, img);
  g.fillStyle = sim ? "#780a0a" : "#080d13";
  g.fillRect(0, img, w, strip);
  g.fillStyle = "#fff";
  g.font = "14px sans-serif";
  g.textBaseline = "top";
  lines.forEach((t, i) => g.fillText(t, 8, img + 6 + i * 24, w - 16));
  const blob = await new Promise<Blob | null>((res) => out.toBlob((b) => res(b), "image/png"));
  if (!blob) {
    x.say("Could not encode the image.");
    return;
  }
  deliver(blob, `spherex-time-cube-${sim ? "SIMULATED-" : ""}${kind.replace(/\s+/g, "-")}.png`);
  x.say(`${kind} image saved.`);
}

export function wireExports(
  x: ExportContext,
  ids: { movie: string; tilt: string; snap: string; map: string; tiltCanvas: string; mapCanvas: string },
): void {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const guard = (btn: HTMLButtonElement, fn: () => Promise<void>) =>
    btn.addEventListener("click", () => {
      btn.disabled = true;
      fn()
        .catch((e) => x.say(`Export failed: ${(e as Error).message}`))
        .finally(() => {
          btn.disabled = false;
        });
    });
  guard(byId<HTMLButtonElement>(ids.movie), () => exportMovie(x));
  guard(byId<HTMLButtonElement>(ids.snap), () => exportTiltSnap(x));
  guard(byId<HTMLButtonElement>(ids.tilt), () => exportCanvasImage(x, byId<HTMLCanvasElement>(ids.tiltCanvas), "tilt result"));
  guard(byId<HTMLButtonElement>(ids.map), () => exportCanvasImage(x, byId<HTMLCanvasElement>(ids.mapCanvas), "motion map"));
}
