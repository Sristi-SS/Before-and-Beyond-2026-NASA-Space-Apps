// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import "./styles.css";
import { initShell, showTab, syncView } from "./shell";
import { initShare, initShortcuts, Sonifier } from "./extras";
import { flushState } from "./state";
import { showScene } from "./scenes";
import { initHelp } from "./help";
import { initIntro } from "./intro";
import { CandidatePanel } from "./candidates";
import { UpdatePanel } from "./updates";
import * as api from "./api";
import { buildChecklist, renderChecklist } from "./checklist";
import { clientMotionMap, clientTilt, type StackFrame } from "./clientstack";
import { CompareView } from "./compare";
import { autoStretch, drawSlice, percentile, type Stretch } from "./colormap";
import { drawColourComposite } from "./colourview";
import { CubeView } from "./cube";
import { decimalYear, GaiaOverlay, sourcesNear } from "./gaia";
import { renderGlossary } from "./glossary";
import { describeMap, markPeak, MotionMapView, peakPixel } from "./motionmap";
import { PixelPicker, type Pixel } from "./picker";
import { Simulator } from "./simulator";
import { wireExports } from "./exporter";
import { wireDossier } from "./dossier";
import { SpectrumPanel, type PanelTab } from "./spectrumpanel";
import { initScenes, registerOpenJob, setCurrentTarget } from "./scenes";
import { Tour } from "./tour";
import { initHardware } from "./hardware";
import { initModes } from "./modes";
import { initStatusBadge, isArchiveOffline, OFFLINE_BUILD_MESSAGE } from "./statusbadge";
import { readState, writeState, type Axis, type View } from "./state";
import {
  DET_W2,
  frameLabel,
  groupLabel,
  isWiseDetector,
  movieDescription,
  ownStretch,
  selectMovieFrames,
  sourceName,
  summariseSources,
  unitName,
  type MovieBand,
} from "./wise";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const targetSelect = el<HTMLSelectElement>("target-select");
const raInput = el<HTMLInputElement>("ra");
const decInput = el<HTMLInputElement>("dec");
const fovInput = el<HTMLSelectElement>("fov");
const framesInput = el<HTMLSelectElement>("max-frames");
const buildButton = el<HTMLButtonElement>("build");
const buildStatus = el<HTMLParagraphElement>("build-status");
const groupPicker = el<HTMLDivElement>("group-picker");
const axisInput = el<HTMLSelectElement>("axis");
const viewInput = el<HTMLSelectElement>("view");
const timeline = el<HTMLInputElement>("timeline");
const sliceLabel = el<HTMLParagraphElement>("slice-label");
const playButton = el<HTMLButtonElement>("play");
const speedInput = el<HTMLInputElement>("speed");
const vxInput = el<HTMLInputElement>("vx");
const vyInput = el<HTMLInputElement>("vy");
const runTiltButton = el<HTMLButtonElement>("run-tilt");
const resetTiltButton = el<HTMLButtonElement>("reset-tilt");
const tiltStatus = el<HTMLParagraphElement>("tilt-status");
const tiltCanvas = el<HTMLCanvasElement>("tilt-canvas");
const zeroCanvas = el<HTMLCanvasElement>("zero-canvas");
const tiltCaption = el<HTMLElement>("tilt-caption");
const tiltMetrics = el<HTMLDivElement>("tilt-metrics");
const emptyState = el<HTMLDivElement>("empty-state");
const quickStart = el<HTMLButtonElement>("quick-start");
const cubeCount = el<HTMLSpanElement>("cube-count");
const contactLink = el<HTMLAnchorElement>("contact-link");
const releaseBadge = el<HTMLSpanElement>("release-badge");
const provFrames = el<HTMLElement>("prov-frames");
const provMasked = el<HTMLElement>("prov-masked");
const provWaves = el<HTMLElement>("prov-waves");
const viewport = el<HTMLDivElement>("viewport");
const blinkCanvas = el<HTMLCanvasElement>("blink-canvas");
const viewStub = el<HTMLDivElement>("view-stub");
const viewStubTitle = el<HTMLHeadingElement>("view-stub-title");
const viewStubBody = el<HTMLParagraphElement>("view-stub-body");
const colourCanvas = el<HTMLCanvasElement>("colour-canvas");
const colourNote = el<HTMLElement>("colour-note");
const mapWrap = el<HTMLDivElement>("map-wrap");
const mapHeadline = el<HTMLElement>("map-headline");
const mapDetail = el<HTMLElement>("map-detail");
const mapSpanInput = el<HTMLSelectElement>("map-span");
const mapStepInput = el<HTMLSelectElement>("map-step");
const findMotionButton = el<HTMLButtonElement>("find-motion");
const gaiaToggle = el<HTMLInputElement>("gaia-toggle");
const gaiaNote = el<HTMLParagraphElement>("gaia-note");
const staticMedian = el<HTMLInputElement>("static-median");
const useCatalogue = el<HTMLButtonElement>("use-catalogue");
const checklistBox = el<HTMLDivElement>("checklist");
const groupNote = el<HTMLParagraphElement>("group-note");
const provArchives = el<HTMLElement>("prov-archives");
const provUnits = el<HTMLElement>("prov-units");
const provWise = el<HTMLElement>("prov-wise");
const provCurrent = el<HTMLElement>("prov-current");
const compareWrap = el<HTMLDivElement>("compare-wrap");

const state = readState();
const cubeView = new CubeView(viewport);
const mapView = new MotionMapView(el<HTMLCanvasElement>("map-canvas"), (v) => {
  vxInput.value = String(v.vx);
  vyInput.value = String(v.vy);
  void runTilt();
});
const blinkGaia = new GaiaOverlay(blinkCanvas, "Blink view");
const tiltGaia = new GaiaOverlay(tiltCanvas, "Shifted stack");
const zeroGaia = new GaiaOverlay(zeroCanvas, "Stack at zero motion");
let panelTab: PanelTab = "spectrum";
const spectrumPanel = new SpectrumPanel(el<HTMLElement>("spectrum-panel"), {
  onClose: () => {
    writeState({ px: null, py: null, panel: null });
    soundPixel = null;
    for (const picker of pickers) picker.setSelected(null);
  },
  onTab: (panel) => {
    panelTab = panel;
    writeState({ panel });
  },
});
const pickers: PixelPicker[] = [
  new PixelPicker(blinkCanvas, "Blink view", (p) => { if (!simulator.takePick(p)) void pickPixel(p, true); }),
  new PixelPicker(tiltCanvas, "Shifted stack", (p) => { if (!simulator.takePick(p)) void pickPixel(p, true); }),
];
const mapCache = new Map<string, api.MotionMapResult>();
document.body.classList.toggle("sim-on", state.sim);
const simulator = new Simulator(
  el<HTMLElement>("sim-panel"),
  {
    onChange: () => applySim(),
    context: () => simContext(),
    answer: () => pickedVelocity(),
    showPickView: () => {
      viewInput.value = "blink";
      viewInput.dispatchEvent(new Event("change"));
    },
  },
  { on: state.sim, simp: state.simp },
);
const compareView = new CompareView(
  compareWrap,
  {
    stretchFor: (i) => stretchFor(i),
    gaiaNear: (x, y, a, b, r) => {
      if (!gaiaData || !slicesMeta[a] || !slicesMeta[b]) return null;
      const at = (i: number): boolean =>
        sourcesNear(gaiaData!.sources, gaiaData!.epoch_year, decimalYear(slicesMeta[i].mjd), x, y, r).length > 0;
      return at(a) || at(b);
    },
    openSpectrum: (p) => void pickPixel(p, true),
  },
  state.cmp,
);
renderGlossary(el<HTMLElement>("glossary"));
const candidatePanel = new CandidatePanel({
  jobKey: () => jobKey,
  group: () => (movie ? 0 : group),
  span: () => Number(mapSpanInput.value),
  step: () => Number(mapStepInput.value),
  simActive: () => simulator.active,
  npix: () => cubeNpix,
  frameIndex: () => slicesMeta[Number(timeline.value)]?.index ?? null,
  blinkCanvas,
  onPick: (c) => {
    vxInput.value = String(c.vx);
    vyInput.value = String(c.vy);
    void runTilt();
  },
});
const updatePanel = new UpdatePanel(async (key) => {
  mapCache.clear();
  await openJob(key, false);
});
const tour = new Tour(el<HTMLElement>("tour-panel"));
for (const id of ["tour-start", "tour-start-empty"]) el(id).addEventListener("click", () => tour.start());
// One-minute auto demo, and a one-click way to the fastest mover.
document.addEventListener("click", (ev) => {
  const hit = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-auto-demo], [data-open-target]");
  if (!hit) return;
  showScene("cube");
  if (hit.dataset.autoDemo !== undefined) {
    tour.start(true);
    return;
  }
  targetSelect.value = hit.dataset.openTarget ?? "";
  if (!targetSelect.value) return;
  targetSelect.dispatchEvent(new Event("change"));
  void build();
});
const sonifier = new Sonifier(document.getElementById("sound-toggle") as HTMLButtonElement | null);
let soundPixel: Pixel | null = null;
initShare(() => flushState());
initShortcuts();
let mapRequest = 0;

let jobKey: string | null = state.job;
let group = state.group;
let movie = state.movie;
let jobStatus: api.JobStatus | null = null;
let gaiaData: api.GaiaResult | null = null;
let gaiaLoad: { key: string; promise: Promise<api.GaiaResult | null> } | null = null;
let tiltRan = false;
let frameRanges: Stretch[] | null = null;
let playTimer: number | null = null;
let partialInFlight = false;
let partialLast = 0;
let pendingPair: { a: number | null; b: number | null } | null = { a: state.a, b: state.b };

// Real frames exactly as loaded; `frameSlices` is these, or planted copies while the simulator is on.
let realFrames: Array<{ meta: api.FrameMeta; data: Float32Array }> = [];
// Frames in the order they were fetched from the archive (sorted by MJD).
let frameSlices: Array<{ meta: api.FrameMeta; data: Float32Array }> = [];
let slicesMeta: api.FrameMeta[] = [];
let sliceData: Float32Array[] = [];
let cubeNpix = 128;
let blinkRange = { lo: 0, hi: 1 };

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
registerOpenJob((key) => {
  if (key === jobKey && jobStatus) return;
  writeState({ job: key, ra: null, dec: null, px: null, py: null, panel: null, t: 0 });
  void openJob(key, false);
});
let dossierRefresh: (() => void) | null = null;
const exportCtx = {
  targetName: () => (targetSelect.selectedOptions[0]?.textContent ?? "").trim() === "Custom coordinates" ? "" : (targetSelect.selectedOptions[0]?.textContent ?? "").trim(),
  simActive: () => simulator.active,
  frames: () => slicesMeta.map((meta, i) => ({ meta, data: sliceData[i] })).filter((f) => f.data),
  npix: () => cubeNpix,
  stretchFor: (i: number) => stretchFor(i),
  groupLabel: () => (group === 0 ? "16-year movie" : `group D${group}`),
  velocity: () => ({ vx: Number(vxInput.value) || 0, vy: Number(vyInput.value) || 0 }),
  score: () => tiltMetrics.querySelector(".metric b")?.textContent ?? "n/a",
  stackAt: (vx: number, vy: number) => {
    if (group === 0) return null;
    const frames = stackFrames();
    if (frames.length === 0) return null;
    const scale = jobStatus?.grid?.pixscale_arcsec ?? 6.15;
    const r = clientTilt(frames, cubeNpix, scale, vx, vy, staticMedian.checked);
    return { data: r.data, npix: r.npix };
  },
  say: (m: string) => {
    el<HTMLElement>("export-status").textContent = m;
  },
};
wireExports(exportCtx, { movie: "save-movie", tilt: "save-tilt-img", snap: "tilt-snap", map: "save-map-img", tiltCanvas: "tilt-canvas", mapCanvas: "map-canvas" });
dossierRefresh = wireDossier({
  simActive: () => simulator.active,
  targetName: exportCtx.targetName,
  groupLabel: exportCtx.groupLabel,
  sourceLabel: () => {
    const f = frameSlices.find((fr) => fr.meta.detector === group) ?? frameSlices[0];
    return f ? sourceName(f.meta) : "";
  },
  velocity: exportCtx.velocity,
  say: exportCtx.say,
}).refresh;
initScenes();
initShell();
initHelp();
initIntro();
void init();

async function init(): Promise<void> {
  initStatusBadge();
  initModes();
  initHardware();
  axisInput.value = state.axis;
  viewInput.value = state.view;
  vxInput.value = String(state.vx);
  vyInput.value = String(state.vy);
  fovInput.value = String(state.fov);
  staticMedian.checked = state.static === "median";
  gaiaToggle.checked = state.gaia;
  applyGaiaEnabled();
  if (state.ra !== null) raInput.value = state.ra.toFixed(4);
  if (state.dec !== null) decInput.value = state.dec.toFixed(4);

  try {
    const info = await api.health();
    releaseBadge.textContent = `release: ${info.release}`;
    el("prov-release").textContent = info.release;
  } catch {
    releaseBadge.textContent = "API offline";
  }

  try {
    const { targets } = await api.targets();
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.key;
      option.textContent = target.name;
      option.dataset.ra = String(target.ra_deg ?? "");
      option.dataset.dec = String(target.dec_deg ?? "");
      targetSelect.appendChild(option);
    }
  } catch {
    /* the form still works with explicit coordinates */
  }

  if (jobKey) {
    await openJob(jobKey, true);
  } else if (state.ra !== null && state.dec !== null) {
    // A URL with only coordinates resolves to (or starts) that cube.
    targetSelect.value = "";
    raInput.value = String(state.ra);
    decInput.value = String(state.dec);
    fovInput.value = String(state.fov);
    void build();
  } else {
    emptyState.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Building a cube
// ---------------------------------------------------------------------------
targetSelect.addEventListener("change", () => {
  const option = targetSelect.selectedOptions[0];
  if (option?.dataset.ra) raInput.value = Number(option.dataset.ra).toFixed(4);
  if (option?.dataset.dec) decInput.value = Number(option.dataset.dec).toFixed(4);
});

buildButton.addEventListener("click", () => void build());
quickStart.addEventListener("click", () => {
  targetSelect.value = "barnard";
  targetSelect.dispatchEvent(new Event("change"));
  void build();
});

async function build(): Promise<void> {
  const option = targetSelect.value ? targetSelect.selectedOptions[0] : null;
  const name = option?.textContent ?? "";
  const body: Record<string, unknown> = {
    fov: Number(fovInput.value),
    max_frames: Number(framesInput.value),
  };
  let ra: number | null = null;
  let dec: number | null = null;
  if (name) {
    body.name = name;
    ra = option?.dataset.ra ? Number(option.dataset.ra) : null;
    dec = option?.dataset.dec ? Number(option.dataset.dec) : null;
  } else {
    ra = Number(raInput.value);
    dec = Number(decInput.value);
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || raInput.value === "" || decInput.value === "") {
      buildStatus.textContent = "Enter both RA and Dec, or pick a named target.";
      return;
    }
    body.ra = ra;
    body.dec = dec;
  }

  buildButton.disabled = true;
  buildStatus.textContent = "Submitting request to the archive…";
  partialLast = 0;
  try {
    const created = await api.createJob(body);
    jobKey = created.key;
    writeState({ job: jobKey, ra, dec });
    buildStatus.textContent = "Searching the SPHEREx archive…";
    const status = await api.waitForJob(jobKey, (update) => {
      const done = update.progress.done;
      const total = update.progress.total;
      buildStatus.textContent = total > 0
        ? `${update.phase} — ${done}/${total} frames`
        : `${update.phase}…`;
      if (update.status === "running") void partialRefresh(created.key);
    });
    if (status.status === "error") throw new Error(status.error ?? "unknown error");
    await openJob(jobKey, false);
    buildStatus.textContent = `${status.frames.length} frames aligned.`;
  } catch (error) {
    const text = (error as Error).message;
    buildStatus.textContent = text.startsWith("429")
      ? text.replace(/^429[^\u2014]*\u2014 /, "").replace(/^\{"detail":"|"\}$/g, "")
      : isArchiveOffline() ? OFFLINE_BUILD_MESSAGE : `Failed: ${text}`;
  } finally {
    buildButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Opening a finished job
// ---------------------------------------------------------------------------
async function openJob(key: string, hydrate: boolean): Promise<void> {
  buildStatus.textContent = "Loading cube…";
  const status = await api.waitForJob(key, (update) => {
    buildStatus.textContent = update.status === "done" ? "Loading cube…" : `${update.phase}…`;
  });
  if (status.status === "error") {
    buildStatus.textContent = `Job failed: ${status.error}`;
    return;
  }
  jobKey = key;
  jobStatus = status;
  setCurrentTarget(status.target);
  if (!hydrate) spectrumPanel.reset(key);
  else spectrumPanel.reset(key);
  gaiaData = null;
  gaiaLoad = null;
  checklistBox.hidden = true;
  tiltRan = false;
  emptyState.hidden = true;
  buildButton.disabled = false;
  buildStatus.textContent = `${status.frames.length} aligned frames · ${status.groups.length} wavelength groups`;
  const refreshError = (status as unknown as { refresh_error?: string }).refresh_error;
  updatePanel.setJob(key, refreshError);
  showTab("dock-controls", "frames");

  if (status.target) {
    raInput.value = status.target.ra_deg.toFixed(4);
    decInput.value = status.target.dec_deg.toFixed(4);
    if (state.ra === null || state.dec === null) {
      writeState({ ra: status.target.ra_deg, dec: status.target.dec_deg });
    }
    provFrames.textContent = `${status.frames.length} frames`;
    const masked = status.frames.map((f) => f.masked_fraction).filter(Number.isFinite);
    const mean = masked.length ? masked.reduce((a, b) => a + b, 0) / masked.length : 0;
    provMasked.textContent = `${(mean * 100).toFixed(1)}% mean`;
  }
  contactLink.href = `/api/jobs/${encodeURIComponent(key)}/contact_sheet.png`;
  contactLink.hidden = false;

  const known = status.groups.map((g) => g.detector);
  if (!known.includes(group)) {
    // WISE 0855 is the demo target: open it on WISE W2, where it moves visibly.
    // Otherwise default to the SPHEREx group with the most epochs, not simply D1.
    const isDemo = /wise\s*0855/i.test(status.target?.name ?? "");
    const spherex = status.groups.filter((g) => !isWiseDetector(g.detector));
    const pool = spherex.length ? spherex : status.groups;
    const richest = [...pool].sort((a, b) => b.count - a.count)[0];
    group = isDemo && known.includes(DET_W2) ? DET_W2 : (richest?.detector ?? 0);
  }
  if (!isWiseDetector(group)) movie = false;
  writeState({ group, movie });
  const pmx = status.target?.pmra_mas_yr ?? 0;
  const pmy = status.target?.pmdec_mas_yr ?? 0;
  useCatalogue.disabled = !(pmx !== 0 || pmy !== 0);
  useCatalogue.title = useCatalogue.disabled
    ? "No catalogue proper motion is known for this position"
    : `Catalogue proper motion: ${(pmx / 1000).toFixed(3)} east, ${(pmy / 1000).toFixed(3)} north arcsec/yr`;
  renderGroupChips(status);
  void ensureGaia();
  const npix = status.grid?.npix ?? cubeNpix;
  for (const picker of pickers) picker.setNpix(npix);
  if (hydrate && state.px !== null && state.py !== null && state.px < npix && state.py < npix) {
    void pickPixel({ x: state.px, y: state.py }, false, state.panel ?? "spectrum");
  } else {
    writeState({ px: null, py: null, panel: null });
  }
  await loadGroup(group, hydrate ? state.t : 0, hydrate);
  candidatePanel.reset();
  if (hydrate && (state.vx !== 0 || state.vy !== 0)) void runTilt();
}

/** Click-for-spectrum: measure every frame at this pixel and open the panel. */
async function pickPixel(p: Pixel, scroll: boolean, tab?: PanelTab): Promise<void> {
  if (!jobKey) return;
  if (simulator.active) {
    tiltStatus.textContent = "Spectrum and light curve are measured on real data only. Turn the simulator off to use them.";
    return;
  }
  const panel = tab ?? panelTab;
  panelTab = panel;
  writeState({ px: p.x, py: p.y, panel });
  soundPixel = p;
  for (const picker of pickers) picker.setSelected(p);
  const done = spectrumPanel.show(p.x, p.y, panel);
  if (scroll) el<HTMLElement>("spectrum-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
  await done;
}


function renderGroupChips(status: api.JobStatus): void {
  groupPicker.replaceChildren();
  const total = status.frames.length;
  const entries: Array<{ value: number; label: string; movie: boolean; title?: string }> = [
    { value: 0, label: `All bands (${total})`, movie: false,
      title: "Every frame, SPHEREx and WISE together. Units differ, so tilt and motion map need one band." },
    ...status.groups.map((g) => ({ value: g.detector, label: groupLabel(g), movie: false })),
  ];
  // The 16-year movie: one chip per WISE band that has SPHEREx frames to follow it.
  for (const g of status.groups.filter((x) => isWiseDetector(x.detector))) {
    const band = g.detector as MovieBand;
    const n = selectMovieFrames(status.frames.map((meta) => ({ meta })), band).length;
    entries.push({
      value: g.detector,
      label: `16-year movie ${band === DET_W2 ? "W2 → D6" : "W1 → SPHEREx"} (${n})`,
      movie: true,
      title: movieDescription(band),
    });
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = entry.movie ? "chip movie" : "chip";
    button.textContent = entry.label;
    if (entry.title) button.title = entry.title;
    button.dataset.value = String(entry.value);
    button.dataset.movie = entry.movie ? "1" : "0";
    button.setAttribute("aria-pressed", String(entry.value === group && entry.movie === movie));
    button.addEventListener("click", () => {
      group = entry.value;
      movie = entry.movie;
      writeState({ group, movie });
      for (const chip of groupPicker.querySelectorAll("button")) {
        chip.setAttribute(
          "aria-pressed",
          String(chip.dataset.value === String(group) && (chip.dataset.movie === "1") === movie),
        );
      }
      checklistBox.hidden = true;
      void loadGroup(group, 0, false);
    });
    groupPicker.appendChild(button);
  }
}

/** Show the same chips from raw in-progress frames, so the cube fills in live. */
function renderFrameChips(frames: api.FrameMeta[], active: number): void {
  const counts = new Map<number, number>();
  for (const f of frames) counts.set(f.detector, (counts.get(f.detector) ?? 0) + 1);
  const entries = [
    { value: 0, label: `All bands (${frames.length})` },
    ...[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([detector, n]) => ({
      value: detector,
      label: isWiseDetector(detector) ? `WISE ${detector === DET_W2 ? "W2" : "W1"} (${n})` : `D${detector} (${n})`,
    })),
  ];
  groupPicker.replaceChildren();
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = entry.label;
    button.setAttribute("aria-pressed", String(entry.value === active));
    button.addEventListener("click", () => {
      group = entry.value;
      writeState({ group });
      void loadGroup(group, 0, false);
    });
    groupPicker.appendChild(button);
  }
}

async function partialRefresh(key: string): Promise<void> {
  if (partialInFlight) return;
  if (Date.now() - partialLast < 1500) return;
  partialInFlight = true;
  partialLast = Date.now();
  try {
    const status = await api.getJob(key);
    if (status.status !== "running" && status.status !== "queued") return;
    const ok = status.frames.filter((f) => f.status === "ok");
    if (ok.length === 0) return;
    emptyState.hidden = true;
    if (group === -1) {
      const counts = new Map<number, number>();
      for (const f of ok) counts.set(f.detector, (counts.get(f.detector) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      group = best?.[0] ?? 0;
      writeState({ group });
    }
    renderFrameChips(ok, group);
    const keep = sliceData.length > 0 ? Number(timeline.value) : 0;
    await loadGroup(group, keep, true);
  } catch {
    /* keep polling; the final openJob pass surfaces any real error */
  } finally {
    partialInFlight = false;
  }
}

async function loadGroup(detector: number, startAt: number, quiet: boolean): Promise<void> {
  if (!jobKey) return;
  if (!quiet) {
    stopPlayback();
    sliceLabel.textContent = "Fetching frames…";
  }
  try {
    const asMovie = movie && isWiseDetector(detector);
    // The movie needs the SPHEREx frames too, so it reads every detector and keeps the matching ones.
    const cube = await api.fetchFrameCube(jobKey, asMovie ? 0 : detector);
    if (detector !== group) return; // the visitor picked another group meanwhile
    cubeNpix = cube.npix;
    realFrames = asMovie ? selectMovieFrames(cube.frames, detector as MovieBand) : cube.frames;
    frameSlices = plantedFrames();
    mountFrames(Number.isFinite(startAt) ? startAt : 0, !quiet);
    if (!quiet) candidatePanel.reset();

    const tiltReady = detector !== 0;
    runTiltButton.disabled = !tiltReady;
    findMotionButton.disabled = !tiltReady;
    tiltStatus.textContent = !tiltReady
      ? "Pick a single wavelength group to run a physically meaningful tilt. SPHEREx and WISE units differ, so All bands is not stacked."
      : asMovie
        ? "Ready. The tilt stacks the WISE epochs of this band only (units differ from SPHEREx). Positive vx is east, positive vy is north."
        : "Ready. Positive vx is east, positive vy is north.";
    groupNote.textContent = asMovie
      ? `16-year movie: ${movieDescription(detector as MovieBand)}. Each frame has its own brightness stretch, so the units do not matter for viewing.`
      : detector === 0
        ? "All bands mixes SPHEREx (MJy/sr) and WISE (nanomaggies): good for browsing only."
        : isWiseDetector(detector)
          ? "WISE frames are unWISE time-resolved coadds in nanomaggies, not MJy/sr."
          : "";
  } catch (error) {
    sliceLabel.textContent = `Could not load frames: ${(error as Error).message}`;
  }
}

/** Sort + mount the current frame set, preserving the requested index. */
function mountFrames(startAt: number, reframe = true): void {
  const axis: Axis = movie ? "time" : (axisInput.value as Axis);
  axisInput.disabled = movie;
  const ordered = [...frameSlices].sort((a, b) =>
    axis === "wave" ? a.meta.wavelength_um - b.meta.wavelength_um : a.meta.mjd - b.meta.mjd,
  );
  slicesMeta = ordered.map((f) => f.meta);
  sliceData = ordered.map((f) => f.data);
  const slices = ordered.map((f) => ({
    data: f.data,
    label: axis === "wave" ? `${f.meta.wavelength_um.toFixed(2)} µm` : f.meta.obs_time.slice(0, 10),
    sublabel: axis === "wave"
      ? `${f.meta.obs_time.slice(0, 10)} · ${sourceName(f.meta)}`
      : `${sourceName(f.meta)} · ${f.meta.wavelength_um.toFixed(2)} µm`,
  }));
  if (slices.length === 0) {
    sliceLabel.textContent = "No frames in this group.";
    return;
  }

  // One stretch shared by every frame so the blink view does not flicker in brightness.
  const samples: number[] = [];
  const stride = Math.max(1, Math.floor((sliceData.length * cubeNpix * cubeNpix) / 30000));
  for (const data of sliceData) {
    for (let i = 0; i < data.length; i += stride) {
      if (Number.isFinite(data[i])) samples.push(data[i]);
      if (samples.length >= 30000) break;
    }
  }
  blinkRange = {
    lo: percentile(samples, 1),
    hi: Math.max(percentile(samples, 99.5), percentile(samples, 1) + 1e-6),
  };
  // Mixed units (movie, All bands): every frame gets its own robust stretch.
  frameRanges = movie || group === 0 ? sliceData.map((d) => ownStretch(d)) : null;

  compareView.setFrames(ordered, cubeNpix, pendingPair?.a ?? null, pendingPair?.b ?? null);
  pendingPair = null;
  cubeView.setSlices(slices, cubeNpix, reframe);
  timeline.max = String(slices.length - 1);
  const index = Math.max(0, Math.min(slices.length - 1, Math.round(startAt)));
  setActive(index);
  applyViewMode();
  cubeCount.textContent = `${slices.length} ${movie ? "movie frames" : "epochs"} · ${cubeNpix}×${cubeNpix} px`;

  const waves = slicesMeta.map((m) => m.wavelength_um);
  const waveLo = Math.min(...waves);
  const waveHi = Math.max(...waves);
  const suffix = group === 0 ? "" : isWiseDetector(group) ? ` (W${group - 100})` : ` (D${group})`;
  provWaves.textContent = `${waveLo.toFixed(2)}–${waveHi.toFixed(2)} µm${suffix}`;
  const shown = summariseSources(slicesMeta, jobStatus);
  provArchives.textContent = shown.archives;
  provUnits.textContent = shown.units;
  provWise.textContent = shown.wise;
}

function stretchFor(index: number): Stretch {
  return frameRanges?.[index] ?? blinkRange;
}

function drawBlink(index: number): void {
  drawSlice(sliceData[index], cubeNpix, blinkCanvas, stretchFor(index));
  const meta = slicesMeta[index];
  if (meta) blinkGaia.show(decimalYear(meta.mjd), cubeNpix);
}

function setActive(index: number): void {
  timeline.value = String(index);
  cubeView.setActive(index);
  updateSliceLabel(index);
  if (viewInput.value === "blink") drawBlink(index);
  candidatePanel.frameChanged();
  if (sonifier.enabled && sliceData[index]) {
    // Brightness at the marked pixel (or the centre of the image), on this image's own scale.
    const p = soundPixel ?? { x: cubeNpix >> 1, y: cubeNpix >> 1 };
    const v = sliceData[index][p.y * cubeNpix + p.x];
    const s = stretchFor(index);
    sonifier.ping(Number.isFinite(v) ? (v - s.lo) / (s.hi - s.lo || 1) : null);
  }
  writeState({ t: index, axis: axisInput.value as Axis });
}

function updateSliceLabel(index: number): void {
  const meta = slicesMeta[index];
  if (!meta) {
    sliceLabel.textContent = "—";
    return;
  }
  sliceLabel.textContent = frameLabel(meta);
  provCurrent.replaceChildren(document.createTextNode(`${sourceName(meta)}, ${unitName(meta)}`));
  if (meta.provenance_url && /^https?:\/\//.test(meta.provenance_url)) {
    const a = document.createElement("a");
    a.href = meta.provenance_url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.className = "link";
    a.textContent = " (archive)";
    provCurrent.appendChild(a);
  }
}

// ---------------------------------------------------------------------------
// Playback and view mode
// ---------------------------------------------------------------------------
timeline.addEventListener("input", () => {
  setActive(Number(timeline.value));
});

playButton.addEventListener("click", () => {
  if (playTimer !== null) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

speedInput.addEventListener("input", () => {
  if (playTimer !== null) {
    stopPlayback();
    startPlayback();
  }
});

function startPlayback(): void {
  const delay = 1000 / Math.max(1, Number(speedInput.value));
  playButton.textContent = "Pause";
  playButton.setAttribute("aria-label", "Pause");
  playTimer = window.setInterval(() => {
    const next = (Number(timeline.value) + 1) % (Number(timeline.max) + 1);
    setActive(next);
  }, delay);
}

function stopPlayback(): void {
  if (playTimer !== null) {
    window.clearInterval(playTimer);
    playTimer = null;
  }
  playButton.textContent = "Play";
  playButton.setAttribute("aria-label", "Play");
}

axisInput.addEventListener("change", () => {
  writeState({ axis: axisInput.value as Axis });
  if (frameSlices.length > 0) mountFrames(0);
});

viewInput.addEventListener("change", () => {
  writeState({ view: viewInput.value as View });
  applyViewMode();
});

function applyViewMode(): void {
  const view = viewInput.value as View;
  syncView();
  window.requestAnimationFrame(() => {
    pickers.forEach((p) => p.refresh());
    candidatePanel.frameChanged();
  });
  viewport.style.display = view === "cube" ? "" : "none";
  blinkCanvas.hidden = view !== "blink";
  viewStub.hidden = true;
  colourCanvas.hidden = view !== "colour";
  colourNote.hidden = view !== "colour";
  mapWrap.hidden = view !== "map";
  compareWrap.hidden = view !== "compare";
  if (view === "compare") {
    if (frameSlices.length < 2) {
      compareWrap.hidden = true;
      showStub("Compare epochs", "It needs at least two epochs in this group.");
    } else {
      compareView.render();
    }
  } else if (view === "colour" && (movie || group === 0)) {
    colourCanvas.hidden = true;
    colourNote.hidden = true;
    showStub("Colour view", "It compares epochs of one band. Pick a single wavelength group, not All bands or the 16-year movie: SPHEREx and WISE units differ.");
  } else if (view === "colour") {
    const frames = frameSlices.map((f) => ({ mjd: f.meta.mjd, data: f.data }));
    if (!drawColourComposite(frames, cubeNpix, colourCanvas)) {
      colourCanvas.hidden = true;
      colourNote.hidden = true;
      showStub("Colour view", "It needs at least two epochs with different dates in this group.");
    }
  } else if (view === "map") {
    void showMap();
  } else if (view === "blink" && sliceData.length > 0) {
    drawBlink(Number(timeline.value));
  }
}

function showStub(title: string, body: string): void {
  viewStubTitle.textContent = title;
  viewStubBody.textContent = body;
  viewStub.hidden = false;
}

// ---------------------------------------------------------------------------
// Motion map
// ---------------------------------------------------------------------------
findMotionButton.addEventListener("click", () => void findBestMotion());
for (const input of [mapSpanInput, mapStepInput]) {
  input.addEventListener("change", () => {
    if (viewInput.value === "map") void showMap();
  });
}

async function loadMap(): Promise<api.MotionMapResult> {
  if (!jobKey) throw new Error("build a cube first");
  const span = Number(mapSpanInput.value);
  const step = Number(mapStepInput.value);
  const id = `${jobKey}|${group}|${span}|${step}|${frameSlices.length}|${simulator.signature()}`;
  const cached = mapCache.get(id);
  if (cached) return cached;
  const ctx = simContext();
  const result = simulator.active && ctx
    ? await clientMotionMap(stackFrames(), ctx.npix, ctx.pixscale, span, step, (f) => {
        tiltStatus.textContent = `Simulated frames: scanning velocities in the browser… ${Math.round(f * 100)}%`;
      })
    : await api.fetchMotionMap(jobKey, group, span, step);
  mapCache.set(id, result);
  return result;
}

function pickedVelocity(): { vx: number; vy: number } {
  return { vx: Number(vxInput.value) || 0, vy: Number(vyInput.value) || 0 };
}

async function showMap(): Promise<void> {
  const request = ++mapRequest;
  if (!jobKey || group === 0) {
    mapWrap.hidden = true;
    showStub("Motion map", "Pick a single wavelength group: the map needs frames of one detector.");
    return;
  }
  mapWrap.hidden = true;
  showStub("Motion map", "Shifting and stacking the frames over a grid of velocities…");
  try {
    const result = await loadMap();
    if (request !== mapRequest || viewInput.value !== "map") return;
    const text = describeMap(result);
    mapHeadline.textContent = text.headline;
    mapDetail.textContent = text.detail;
    viewStub.hidden = true;
    mapWrap.hidden = false;
    mapView.setResult(result, pickedVelocity());
  } catch (error) {
    if (request === mapRequest) showStub("Motion map", (error as Error).message);
  }
}

async function findBestMotion(): Promise<void> {
  if (!jobKey || group === 0) {
    tiltStatus.textContent = "Pick a single wavelength group first.";
    return;
  }
  findMotionButton.disabled = true;
  tiltStatus.textContent = "Scanning velocities (fixed sources suppressed)…";
  try {
    const result = await loadMap();
    vxInput.value = String(result.bestVx);
    vyInput.value = String(result.bestVy);
    if (viewInput.value === "map") void showMap();
    else mapView.setResult(result, { vx: result.bestVx, vy: result.bestVy });
    await runTilt();
    tiltStatus.textContent = `${describeMap(result).detail} Candidate only, not a detection.`;
  } catch (error) {
    tiltStatus.textContent = (error as Error).message;
  } finally {
    findMotionButton.disabled = group === 0;
  }
}

// ---------------------------------------------------------------------------
// Tilt
// ---------------------------------------------------------------------------
runTiltButton.addEventListener("click", () => void runTilt());
resetTiltButton.addEventListener("click", () => {
  vxInput.value = "0";
  vyInput.value = "0";
  void runTilt();
});

async function runTilt(): Promise<void> {
  if (!jobKey) {
    tiltStatus.textContent = "Build a cube first.";
    return;
  }
  if (group === 0) {
    tiltStatus.textContent = "Pick a single wavelength group to run the tilt.";
    return;
  }
  const vx = Math.max(-60, Math.min(60, Number(vxInput.value) || 0));
  const vy = Math.max(-60, Math.min(60, Number(vyInput.value) || 0));
  vxInput.value = String(vx);
  vyInput.value = String(vy);
  writeState({ vx, vy });

  runTiltButton.disabled = true;
  window.dispatchEvent(new CustomEvent("tilt-start"));
  tiltStatus.textContent = "Shifting every frame and summing…";
  try {
    const mode = staticMedian.checked ? "median" : "none";
    writeState({ static: mode });
    const [moved, still] = await stackBoth(vx, vy, mode);
    // With the fixed sky removed a mover is a lone peak in noise: stretch up to almost the maximum.
    const range = mode === "median" ? autoStretch(moved.data, 5, 99.97) : autoStretch(moved.data);
    drawSlice(moved.data, moved.npix, tiltCanvas, range);
    drawSlice(still.data, still.npix, zeroCanvas, range);
    const peak = peakPixel(moved.data, moved.npix);
    markPeak(tiltCanvas, peak);
    mapView.setPicked({ vx, vy });
    tiltRan = true;

    // Gaia rings on both result canvases, at the epoch the stacks are aligned to (the first frame).
    const stackFrames = frameSlices.filter((f) => f.meta.detector === group);
    const t0 = stackFrames.length ? Math.min(...stackFrames.map((f) => f.meta.mjd)) : NaN;
    if (Number.isFinite(t0)) {
      tiltGaia.show(decimalYear(t0), moved.npix);
      zeroGaia.show(decimalYear(t0), still.npix);
    }

    const ratio = still.score > 0 && Number.isFinite(moved.score) ? moved.score / still.score : NaN;
    const quality = !Number.isFinite(ratio)
      ? "n/a"
      : ratio >= 1.4 ? "strong alignment" : ratio >= 1.15 ? "moderate alignment" : "weak alignment";
    window.dispatchEvent(new CustomEvent("tilt-result", { detail: { vx, vy, ratio } }));
    tiltCaption.textContent =
      `v = (${vx.toFixed(1)}, ${vy.toFixed(1)}) arcsec/yr · ${moved.shifts.length} frames`;

    tiltMetrics.innerHTML = "";
    const cards: Array<[string, string]> = [
      ["Peak score", moved.score.toFixed(1)],
      ["vs v = 0", Number.isFinite(ratio) ? `${ratio.toFixed(2)}× ${quality}` : "n/a"],
      ["Frames stacked", String(moved.shifts.length)],
      ["Max shift", maxShift(moved.shifts)],
      ["Fixed stars", mode === "median" ? "removed" : "kept"],
    ];
    for (const [label, value] of cards) {
      const div = document.createElement("div");
      div.className = "metric";
      const b = document.createElement("b");
      b.textContent = value;
      const span = document.createElement("span");
      span.textContent = label;
      div.append(b, span);
      tiltMetrics.appendChild(div);
    }
    tiltStatus.textContent =
      "Candidate motion only. A high score is not a detection; real moving objects need cross-matching in several bands and a catalogue check.";

    const gaia = await ensureGaia();
    const sorted = [...stackFrames].sort((a, b) => a.meta.mjd - b.meta.mjd);
    renderChecklist(
      checklistBox,
      buildChecklist({
        frames: sorted,
        npix: moved.npix,
        peak,
        shifts: moved.shifts,
        vx,
        vy,
        score: moved.score,
        zeroScore: still.score,
        gaia: gaia ? { epochYear: gaia.epoch_year, sources: gaia.sources } : null,
      }),
    );
  } catch (error) {
    tiltStatus.textContent = `Tilt failed: ${(error as Error).message}`;
  } finally {
    runTiltButton.disabled = false;
  }
}

function maxShift(shifts: Array<[number, number]>): string {
  let best = 0;
  for (const [dx, dy] of shifts) best = Math.max(best, Math.hypot(dx, dy));
  return `${best.toFixed(1)} px`;
}

// ---------------------------------------------------------------------------
// Catalogue motion and the "remove fixed stars" switch
// ---------------------------------------------------------------------------
useCatalogue.addEventListener("click", () => void runCatalogueMotion());
staticMedian.addEventListener("change", () => {
  writeState({ static: staticMedian.checked ? "median" : "none" });
  if (tiltRan && group !== 0) void runTilt();
});

async function runCatalogueMotion(): Promise<void> {
  const target = jobStatus?.target;
  if (!target || !(target.pmra_mas_yr || target.pmdec_mas_yr)) {
    tiltStatus.textContent = "No catalogue proper motion is known for this target.";
    return;
  }
  if (group === 0) {
    tiltStatus.textContent = "Pick a single wavelength group first (for example WISE W2).";
    return;
  }
  // mas/yr to arcsec/yr; vx is east-positive (pmra already includes cos dec), vy is north.
  vxInput.value = String(Math.round(((target.pmra_mas_yr ?? 0) / 1000) * 1000) / 1000);
  vyInput.value = String(Math.round(((target.pmdec_mas_yr ?? 0) / 1000) * 1000) / 1000);
  await runTilt();
  tiltStatus.textContent =
    `Catalogue motion of ${target.name}: (${vxInput.value}, ${vyInput.value}) arcsec/yr. Candidate only: a bright spot here is a check, not a detection.`;
}

// ---------------------------------------------------------------------------
// Gaia stars
// ---------------------------------------------------------------------------
gaiaToggle.addEventListener("change", () => {
  writeState({ gaia: gaiaToggle.checked });
  applyGaiaEnabled();
  if (gaiaToggle.checked) void ensureGaia();
});

function applyGaiaEnabled(): void {
  for (const overlay of [blinkGaia, tiltGaia, zeroGaia]) overlay.setEnabled(gaiaToggle.checked);
}

/** Fetch the job's Gaia sources once; null (and a note) if the archive is unavailable. */
function ensureGaia(): Promise<api.GaiaResult | null> {
  if (!jobKey) return Promise.resolve(null);
  if (gaiaData) return Promise.resolve(gaiaData);
  if (gaiaLoad && gaiaLoad.key === jobKey) return gaiaLoad.promise;
  const key = jobKey;
  const promise = api
    .fetchGaia(key)
    .then((result) => {
      if (key !== jobKey) return null;
      gaiaData = result;
      for (const overlay of [blinkGaia, tiltGaia, zeroGaia]) overlay.setSources(result.sources, result.epoch_year);
      applyGaiaEnabled();
      gaiaNote.textContent = `${result.n} Gaia DR3 sources in the field (from the ${result.limit} brightest in the cone, so faint stars may be missing). Positions follow their catalogue motion.`;
      const index = Number(timeline.value);
      if (viewInput.value === "blink" && sliceData[index]) drawBlink(index);
      return result;
    })
    .catch((error: Error) => {
      if (key === jobKey) gaiaNote.textContent = `Gaia stars unavailable: ${error.message.slice(0, 120)}`;
      return null;
    });
  gaiaLoad = { key, promise };
  return promise;
}

// ---------------------------------------------------------------------------
// Simulator glue: planted copies of the frames, browser-side stacking
// ---------------------------------------------------------------------------
function simContext(): { npix: number; pixscale: number; spanYears: number; mapSpan: number; mapStep: number } | null {
  const group_ = realFrames.filter((f) => f.meta.detector === group || group === 0 || movie);
  if (group_.length === 0) return null;
  const mjds = group_.map((f) => f.meta.mjd);
  return {
    npix: cubeNpix,
    pixscale: jobStatus?.grid?.pixscale_arcsec ?? 6.15,
    spanYears: (Math.max(...mjds) - Math.min(...mjds)) / 365.25,
    mapSpan: Number(mapSpanInput.value),
    mapStep: Number(mapStepInput.value),
  };
}

/** The loaded frames, with the simulated object added when the simulator is on (copies; real frames untouched). */
function plantedFrames(): Array<{ meta: api.FrameMeta; data: Float32Array }> {
  const ctx = simContext();
  return simulator.active && ctx ? simulator.plant(realFrames, ctx) : realFrames;
}

function stackFrames(): StackFrame[] {
  return frameSlices.filter((f) => f.meta.detector === group).map((f) => ({ mjd: f.meta.mjd, data: f.data }));
}

/** Shifted stack at (vx, vy) and at zero motion, from the server, or in the browser while simulating. */
async function stackBoth(vx: number, vy: number, mode: "median" | "none"): Promise<[api.TiltResult, api.TiltResult]> {
  if (jobKey && simulator.active) {
    const frames = stackFrames();
    const scale = jobStatus?.grid?.pixscale_arcsec ?? 6.15;
    return [
      clientTilt(frames, cubeNpix, scale, vx, vy, mode === "median"),
      clientTilt(frames, cubeNpix, scale, 0, 0, mode === "median"),
    ];
  }
  return Promise.all([
    api.fetchTilt(jobKey as string, group, vx, vy, "frames", mode),
    api.fetchTilt(jobKey as string, group, 0, 0, "frames", mode),
  ]);
}

/** The simulator was switched, or its parameters changed: swap real and planted frames and redraw. */
function applySim(): void {
  dossierRefresh?.();
  candidatePanel.reset();
  if (realFrames.length === 0) return;
  pendingPair = compareView.pair;
  frameSlices = plantedFrames();
  mountFrames(Number(timeline.value), false);
  tiltStatus.textContent = simulator.active
    ? "Simulated frames: tilt and motion map run in your browser, not on the server."
    : "Real data restored.";
  if (tiltRan && group !== 0) void runTilt();
  if (viewInput.value === "map") void showMap();
}
