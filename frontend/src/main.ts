// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import "@fontsource/press-start-2p/400.css";
import "./styles.css";
import "./arcade.css";
import "./calm.css";
import { initShell, showTab, syncView } from "./shell";
import { initShare, initShortcuts } from "./extras";
import { flushState } from "./state";
import { initHelp } from "./help";
import { initIntro } from "./intro";
import { walkthrough } from "./walkthrough";
import { initNav } from "./nav";
import { CandidatePanel } from "./candidates";
import { UpdatePanel } from "./updates";
import * as api from "./api";
import { buildChecklist, renderChecklist } from "./checklist";
import { clientMotionMap, clientTilt, type StackFrame } from "./clientstack";
import { CompareView } from "./compare";
import { autoStretch, drawSlice, percentile, type Stretch } from "./colormap";
import { ChangePicture } from "./colourview";
import { CubeView } from "./cube";
import { decimalYear, GaiaOverlay } from "./gaia";
import { renderGlossary } from "./glossary";
import { compass, describeMap, markPeak, MotionMapView, peakPixel } from "./motionmap";
import { PixelPicker, type Pixel } from "./picker";
import { reveal } from "./shell";
import { Simulator } from "./simulator";
import { exportFrame, wireExports } from "./exporter";
import { wireDossier } from "./dossier";
import { SpectrumPanel, type PanelTab } from "./spectrumpanel";
import { initScenes, registerOpenJob, showScene } from "./scenes";
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
const viewDesc = el<HTMLElement>("view-desc");
const mapWrap = el<HTMLDivElement>("map-wrap");
const mapInfo = el<HTMLElement>("map-info");
const mapHeadline = el<HTMLElement>("map-headline");
const mapDetail = el<HTMLElement>("map-detail");
const mapSpanInput = el<HTMLSelectElement>("map-span");
const candRun = el<HTMLButtonElement>("cand-run");
const candStatus = el<HTMLElement>("cand-status");
const findMore = el<HTMLDetailsElement>("find-more");
const shareToggle = el<HTMLButtonElement>("share-toggle");
const shareMenu = el<HTMLDivElement>("share-menu");
const shareStatus = el<HTMLElement>("share-status");
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
const compareView = new CompareView(compareWrap, { stretchFor: (i) => stretchFor(i) });
const changePicture = new ChangePicture();
/** The Colour view shows every date until the visitor plays or drags the timeline; then it builds up date by date. */
let colourAll = true;
renderGlossary(el<HTMLElement>("glossary"));
const candidatePanel = new CandidatePanel({
  jobKey: () => jobKey,
  group: () => (movie ? 0 : group),
  span: () => mapGrid().span,
  step: () => mapGrid().step,
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
document.getElementById("tour-start")?.addEventListener("click", () => tour.start());
// The one-minute demo, and one-press ways to open a test object or the Sky page.
document.addEventListener("click", (ev) => {
  const hit = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-auto-demo], [data-open-target], [data-go-sky]");
  if (!hit) return;
  if (hit.dataset.goSky !== undefined) {
    showScene("globe");
    return;
  }
  showScene("cube");
  if (hit.dataset.autoDemo !== undefined) tour.start(true);
  else void openTarget(hit.dataset.openTarget ?? "");
});
initShare(() => flushState());
initShortcuts();
let mapRequest = 0;
let targetsLoaded: Promise<void> = Promise.resolve();
let lastScore = "n/a";

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
  targetName: () => (targetSelect.value ? (targetSelect.selectedOptions[0]?.textContent ?? "").trim() : jobStatus?.target?.name ?? ""),
  simActive: () => simulator.active,
  frames: () => slicesMeta.map((meta, i) => ({ meta, data: sliceData[i] })).filter((f) => f.data),
  npix: () => cubeNpix,
  stretchFor: (i: number) => stretchFor(i),
  groupLabel: () => (movie ? "16-year movie" : group === 0 ? "all pictures" : isWiseDetector(group) ? `WISE W${group - 100}` : `SPHEREx D${group}`),
  velocity: () => ({ vx: Number(vxInput.value) || 0, vy: Number(vyInput.value) || 0 }),
  score: () => lastScore,
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
    shareStatus.textContent = m;
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
el<HTMLButtonElement>("save-frame").addEventListener("click", () => void exportFrame(exportCtx, Number(timeline.value)));
const setShareOpen = (open: boolean): void => {
  shareMenu.hidden = !open;
  shareToggle.setAttribute("aria-expanded", String(open));
  if (open) shareStatus.textContent = "";
};
shareToggle.addEventListener("click", () => setShareOpen(shareMenu.hidden));
document.addEventListener("click", (ev) => {
  if (!shareMenu.hidden && !(ev.target as HTMLElement).closest(".deck-share")) setShareOpen(false);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") setShareOpen(false);
});
initScenes();
initShell();
initNav();
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

  targetsLoaded = api.targets().then(({ targets }) => {
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.key;
      option.textContent = target.name;
      option.dataset.ra = String(target.ra_deg ?? "");
      option.dataset.dec = String(target.dec_deg ?? "");
      targetSelect.appendChild(option);
    }
  }).catch(() => {
    /* the form still works with a typed position */
  });
  await targetsLoaded;

  // Old links to the motion map (it now lives under Tools) open the flip book with Find beside it.
  if (new URLSearchParams(window.location.search).get("view") === "map") {
    viewInput.value = "blink";
    writeState({ view: "blink" });
    reveal(candRun);
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

/** Open one of the built-in test objects by its key ("barnard", "wise0855", ...). */
async function openTarget(key: string): Promise<void> {
  await targetsLoaded;
  targetSelect.value = key;
  if (!key || targetSelect.value !== key) {
    buildStatus.textContent = "The list of test objects did not load (the server may still be starting). Try again in a moment.";
    emptyState.hidden = false;
    return;
  }
  targetSelect.dispatchEvent(new Event("change"));
  await build();
}
window.addEventListener("open-target", (ev) => void openTarget(String((ev as CustomEvent).detail ?? "")));

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
      buildStatus.textContent = "Type both RA and Dec, or pick a test object.";
      return;
    }
    body.ra = ra;
    body.dec = dec;
  }

  buildButton.disabled = true;
  buildStatus.textContent = "Asking NASA's archive…";
  partialLast = 0;
  try {
    const created = await api.createJob(body);
    jobKey = created.key;
    writeState({ job: jobKey, ra, dec });
    buildStatus.textContent = "Looking for pictures of this place…";
    const status = await api.waitForJob(jobKey, (update) => {
      const done = update.progress.done;
      const total = update.progress.total;
      buildStatus.textContent = total > 0
        ? `${update.phase}: ${done} of ${total} pictures`
        : `${update.phase}…`;
      if (update.status === "running") void partialRefresh(created.key);
    });
    if (status.status === "error") throw new Error(status.error ?? "unknown error");
    await openJob(jobKey, false);
    buildStatus.textContent = `${status.frames.length} pictures lined up.`;
  } catch (error) {
    const text = (error as Error).message;
    buildStatus.textContent = text.startsWith("429")
      ? text.replace(/^429[^\u2014]*\u2014 /, "").replace(/^\{"detail":"|"\}$/g, "")
      : isArchiveOffline() ? OFFLINE_BUILD_MESSAGE : `That did not work. ${plainError(text)}`;
  } finally {
    buildButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Opening a finished job
// ---------------------------------------------------------------------------
/** The part of a server error a visitor can read: no status code, no JSON wrapper. */
function plainError(text: string): string {
  return text.replace(/^[a-z ]*failed: /i, "").replace(/^\d+ [^\u2014]*\u2014 /, "").replace(/^\d+\s*/, "")
    .replace(/^\{"detail":"|"\}$/g, "").slice(0, 200) || "The server did not answer.";
}

/** No cube on screen: say why, and offer the way back to the saved ones. */
function showNoCube(message: string): void {
  jobKey = null;
  jobStatus = null;
  writeState({ job: null, px: null, py: null, panel: null });
  buildStatus.textContent = message;
  el<HTMLElement>("empty-note").textContent = message;
  emptyState.hidden = false;
  buildButton.disabled = false;
}

async function openJob(key: string, hydrate: boolean): Promise<void> {
  buildStatus.textContent = "Opening the cube…";
  let status: api.JobStatus;
  try {
    status = await api.waitForJob(key, (update) => {
      buildStatus.textContent = update.status === "done" ? "Opening the cube…" : `${update.phase}…`;
    });
  } catch (error) {
    const text = (error as Error).message;
    showNoCube(/^404/.test(text)
      ? "This cube is no longer saved on the server. Pick a saved cube on the Sky page, or build it again."
      : `The cube did not open. ${plainError(text)}`);
    return;
  }
  if (status.status === "error") {
    showNoCube(`This cube could not be built. ${plainError(status.error ?? "")}`);
    return;
  }
  jobKey = key;
  jobStatus = status;
  spectrumPanel.reset(key);
  gaiaData = null;
  gaiaLoad = null;
  checklistBox.hidden = true;
  tiltRan = false;
  emptyState.hidden = true;
  buildButton.disabled = false;
  buildStatus.textContent = `${status.frames.length} pictures of ${status.target?.name ?? "this place"} are open.`;
  const refreshError = (status as unknown as { refresh_error?: string }).refresh_error;
  updatePanel.setJob(key, refreshError);
  showTab("dock-controls", "frames");

  if (status.target) {
    raInput.value = status.target.ra_deg.toFixed(4);
    decInput.value = status.target.dec_deg.toFixed(4);
    if (state.ra === null || state.dec === null) {
      writeState({ ra: status.target.ra_deg, dec: status.target.dec_deg });
    }
    provFrames.textContent = String(status.frames.length);
    const masked = status.frames.map((f) => f.masked_fraction).filter(Number.isFinite);
    const mean = masked.length ? masked.reduce((a, b) => a + b, 0) / masked.length : 0;
    provMasked.textContent = `${(mean * 100).toFixed(1)}% on average`;
  }
  contactLink.href = `/api/jobs/${encodeURIComponent(key)}/contact_sheet.png`;
  contactLink.hidden = false;

  const known = status.groups.map((g) => g.detector);
  // A fast mover with WISE and SPHEREx frames opens on the 16-year movie, where it visibly walks across the
  // picture (Barnard's Star: about 27 pixels).  One year of SPHEREx alone moves it under 2 pixels.
  const pmTotal = Math.hypot(status.target?.pmra_mas_yr ?? 0, status.target?.pmdec_mas_yr ?? 0);
  const movieFrames = known.includes(DET_W2)
    ? selectMovieFrames(status.frames.map((meta) => ({ meta })), DET_W2).length
    : 0;
  if (!hydrate && pmTotal >= 500 && movieFrames >= 4) {
    group = DET_W2;
    movie = true;
  } else if (!known.includes(group)) {
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
    ? "No star catalogue lists a motion for this place"
    : `The catalogue says: ${(pmx / 1000).toFixed(2)} east, ${(pmy / 1000).toFixed(2)} north, in arcseconds a year`;
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
  resetFind();
  if (hydrate && (state.vx !== 0 || state.vy !== 0)) void runTilt();
  walkthrough(viewInput.value);
}

/** Click-for-spectrum: measure every frame at this pixel and open the panel. */
async function pickPixel(p: Pixel, scroll: boolean, tab?: PanelTab): Promise<void> {
  if (!jobKey) return;
  if (simulator.active) {
    tiltStatus.textContent = "Spectra are measured on real pictures only. Turn Practise mode off to use them.";
    return;
  }
  const panel = tab ?? panelTab;
  panelTab = panel;
  writeState({ px: p.x, py: p.y, panel });
  for (const picker of pickers) picker.setSelected(p);
  const done = spectrumPanel.show(p.x, p.y, panel);
  void scroll;
  await done;
}


function renderGroupChips(status: api.JobStatus): void {
  groupPicker.replaceChildren();
  type Entry = { value: number; label: string; movie: boolean; title?: string };
  const all = status.frames.map((meta) => ({ meta }));
  const movies: Entry[] = status.groups.filter((g) => isWiseDetector(g.detector)).map((g) => {
    const band = g.detector as MovieBand;
    return {
      value: g.detector, movie: true, title: movieDescription(band),
      label: `${band === DET_W2 ? "4.6" : "3.4"} µm (${selectMovieFrames(all, band).length})`,
    };
  });
  const spherex: Entry[] = status.groups.filter((g) => !isWiseDetector(g.detector))
    .map((g) => ({ value: g.detector, movie: false, label: `D${g.detector} (${g.count})`, title: groupLabel(g) }));
  const wise: Entry[] = status.groups.filter((g) => isWiseDetector(g.detector))
    .map((g) => ({ value: g.detector, movie: false, label: `${g.detector === DET_W2 ? "4.6" : "3.4"} µm (${g.count})`, title: groupLabel(g) }));
  const rows: Array<[string, Entry[]]> = [
    ["16 years: WISE, then SPHEREx", movies],
    ["SPHEREx only, 2025 on", spherex],
    ["WISE only, 2010 to 2024", wise],
    ["Everything", [{ value: 0, movie: false, label: `All ${status.frames.length} pictures`, title: "For browsing only: the two telescopes use different units, so the tools need one set." }]],
  ];
  const sync = (): void => {
    for (const chip of groupPicker.querySelectorAll("button")) {
      chip.setAttribute("aria-pressed", String(chip.dataset.value === String(group) && (chip.dataset.movie === "1") === movie));
    }
  };
  for (const [title, entries] of rows) {
    if (entries.length === 0) continue;
    const row = document.createElement("div");
    row.className = "chip-row";
    const name = document.createElement("span");
    name.className = "chip-row-name";
    name.textContent = title;
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = entry.label;
      if (entry.title) button.title = entry.title;
      button.dataset.value = String(entry.value);
      button.dataset.movie = entry.movie ? "1" : "0";
      button.addEventListener("click", () => {
        group = entry.value;
        movie = entry.movie;
        writeState({ group, movie });
        sync();
        checklistBox.hidden = true;
        void loadGroup(group, 0, false);
      });
      chips.appendChild(button);
    }
    row.append(name, chips);
    groupPicker.appendChild(row);
  }
  sync();
}

/** Show the same chips from raw in-progress frames, so the cube fills in live. */
function renderFrameChips(frames: api.FrameMeta[], active: number): void {
  const counts = new Map<number, number>();
  for (const f of frames) counts.set(f.detector, (counts.get(f.detector) ?? 0) + 1);
  const entries = [
    { value: 0, label: `All (${frames.length})` },
    ...[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([detector, n]) => ({
      value: detector,
      label: isWiseDetector(detector) ? `WISE ${detector === DET_W2 ? "4.6" : "3.4"} µm (${n})` : `D${detector} (${n})`,
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
    sliceLabel.textContent = "Loading the pictures…";
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
    if (!quiet) resetFind();

    const tiltReady = detector !== 0;
    runTiltButton.disabled = !tiltReady;
    tiltStatus.textContent = !tiltReady
      ? ONE_SET
      : asMovie
        ? "Ready. Only the WISE pictures of this set are added up (SPHEREx uses different units)."
        : "";
    groupNote.textContent = asMovie
      ? "WISE pictures from 2010 to 2024, then SPHEREx pictures in the same infrared colour. Each picture has its own brightness scale."
      : detector === 0
        ? "Both telescopes together: good for browsing. The tools need one set."
        : "";
  } catch (error) {
    sliceLabel.textContent = `The pictures did not load. ${plainError((error as Error).message)}`;
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
    sliceLabel.textContent = "There are no pictures in this set.";
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
  changePicture.setFrames(ordered.map((f) => ({ mjd: f.meta.mjd, data: f.data, source: f.meta.source })), cubeNpix);
  colourAll = true;
  pendingPair = null;
  cubeView.setSlices(slices, cubeNpix, reframe);
  timeline.max = String(slices.length - 1);
  const index = Math.max(0, Math.min(slices.length - 1, Math.round(startAt)));
  setActive(index);
  applyViewMode();
  cubeCount.textContent = `${slices.length} pictures`;

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
  if (viewInput.value === "colour") drawColour();
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
  colourAll = false;
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
  colourAll = false;
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

/** One line under the view buttons: what this view shows and what to do with it. */
const VIEW_DESC: Record<View, string> = {
  cube: "Every picture of this patch of sky, stacked by date. Drag to turn it. Press Play to run through the years.",
  blink: "One picture at a time, like a flip book. Press Play and watch for the dot that jumps. Press any spot to see its spectrum.",
  colour: "Grey is the sky that never changes. Colour marks what appeared: blue early, orange late. A mover draws a blue-to-orange line. Press Play to watch it build.",
  compare: "Two dates side by side, and a third picture that shows only what changed between them.",
};

function drawColour(): void {
  const byDate = movie || axisInput.value === "time";
  const until = colourAll || !byDate ? undefined : slicesMeta[Number(timeline.value)]?.mjd;
  if (changePicture.draw(colourCanvas, until) === 0) {
    colourCanvas.hidden = true;
    showStub("Colour needs more dates", "This set has fewer than two dates. Pick another set under Controls, Pictures.");
  }
}

function applyViewMode(): void {
  const view = viewInput.value as View;
  syncView();
  viewDesc.textContent = frameSlices.length > 0 ? VIEW_DESC[view] : "";
  if (frameSlices.length > 0) walkthrough(view);
  window.requestAnimationFrame(() => {
    pickers.forEach((p) => p.refresh());
    candidatePanel.frameChanged();
  });
  viewport.style.display = view === "cube" ? "" : "none";
  blinkCanvas.hidden = view !== "blink";
  viewStub.hidden = true;
  colourCanvas.hidden = view !== "colour";
  compareWrap.hidden = view !== "compare";
  if (view === "compare") {
    if (frameSlices.length < 2) {
      compareWrap.hidden = true;
      showStub("Compare needs two dates", "This set has only one picture. Pick another set under Controls, Pictures.");
    } else {
      compareView.render();
    }
  } else if (view === "colour") {
    colourAll = true;
    drawColour();
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
// Find: the motion map and the ranked candidates, in the Tools panel
// ---------------------------------------------------------------------------
const ONE_SET = "Choose one set of pictures first (Controls, Pictures). WISE and SPHEREx use different units, so they cannot be added together.";

/** Years between the first and the last picture that the tools add up. */
function baselineYears(): number {
  const used = realFrames.filter((f) => f.meta.detector === group);
  if (used.length < 2) return 1;
  const mjds = used.map((f) => f.meta.mjd);
  return Math.max(0.25, (Math.max(...mjds) - Math.min(...mjds)) / 365.25);
}

/**
 * The grid of motions to try.  Two neighbouring squares must differ by at most about two pixels of
 * slide over the whole baseline, or a mover can fall between them; the server allows 49 squares a side.
 */
function mapGrid(): { span: number; step: number; coarse: boolean } {
  const span = Number(mapSpanInput.value);
  const want = (2 * (jobStatus?.grid?.pixscale_arcsec ?? 6.15)) / baselineYears();
  let step = span / 12;
  if (step > want) step = span / 24;
  return { span, step, coarse: step > want * 1.5 };
}

function resetFind(): void {
  mapRequest++;
  mapWrap.hidden = true;
  mapInfo.hidden = true;
  findMore.hidden = true;
  candidatePanel.reset();
  const ok = !!jobKey && group !== 0;
  candRun.disabled = !ok;
  candStatus.textContent = !jobKey ? "Open a cube first." : group === 0 ? ONE_SET : "";
}

candRun.addEventListener("click", () => void runFind());
mapSpanInput.addEventListener("change", () => resetFind());

async function loadMap(): Promise<api.MotionMapResult> {
  if (!jobKey) throw new Error("open a cube first");
  const { span, step } = mapGrid();
  const id = `${jobKey}|${group}|${span}|${step}|${frameSlices.length}|${simulator.signature()}`;
  const cached = mapCache.get(id);
  if (cached) return cached;
  const ctx = simContext();
  const result = simulator.active && ctx
    ? await clientMotionMap(stackFrames(), ctx.npix, ctx.pixscale, span, step, (f) => {
        candStatus.textContent = `Trying every motion in your browser… ${Math.round(f * 100)}%`;
      })
    : await api.fetchMotionMap(jobKey, group, span, step);
  mapCache.set(id, result);
  return result;
}

function pickedVelocity(): { vx: number; vy: number } {
  return { vx: Number(vxInput.value) || 0, vy: Number(vyInput.value) || 0 };
}

/** Search: try every motion, show the map and what it means, then list the best candidates. */
async function runFind(): Promise<void> {
  if (!jobKey || group === 0) return;
  const request = ++mapRequest;
  candRun.disabled = true;
  candStatus.textContent = "Trying every speed and direction. This takes a few seconds…";
  try {
    const result = await loadMap();
    if (request !== mapRequest) return;
    const t = jobStatus?.target;
    const known = t && (t.pmra_mas_yr || t.pmdec_mas_yr)
      ? { name: t.name, vx: (t.pmra_mas_yr ?? 0) / 1000, vy: (t.pmdec_mas_yr ?? 0) / 1000 }
      : null;
    const text = describeMap(result, { coarse: mapGrid().coarse, known, simulated: simulator.active });
    mapHeadline.textContent = text.headline;
    mapDetail.textContent = text.detail;
    mapWrap.hidden = false;
    mapInfo.hidden = false;
    findMore.hidden = false;
    mapView.setResult(result, pickedVelocity());
    candStatus.textContent = "";
    if (simulator.active) {
      candStatus.textContent = "Practise mode: press the brightest square, then press Check my answer under Practise.";
    } else {
      await candidatePanel.search();
    }
  } catch (error) {
    if (request === mapRequest) candStatus.textContent = plainError((error as Error).message);
  } finally {
    if (request === mapRequest) candRun.disabled = false;
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
    tiltStatus.textContent = "Open a cube first.";
    return;
  }
  if (group === 0) {
    tiltStatus.textContent = ONE_SET;
    return;
  }
  const vx = Math.max(-60, Math.min(60, Number(vxInput.value) || 0));
  const vy = Math.max(-60, Math.min(60, Number(vyInput.value) || 0));
  vxInput.value = String(vx);
  vyInput.value = String(vy);
  writeState({ vx, vy });

  runTiltButton.disabled = true;
  window.dispatchEvent(new CustomEvent("tilt-start"));
  tiltStatus.textContent = "Sliding the pictures and adding them up…";
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
    window.dispatchEvent(new CustomEvent("tilt-result", { detail: { vx, vy, ratio } }));
    const speed = Math.hypot(vx, vy);
    tiltCaption.textContent = speed > 0 ? `Lined up: ${speed.toFixed(1)}″ a year, ${compass(vx, vy)}` : "Lined up: no motion";
    lastScore = moved.score.toFixed(1);

    tiltMetrics.innerHTML = "";
    const verdict = !Number.isFinite(ratio) || speed === 0 ? "" : ratio >= 1.4 ? "Much sharper" : ratio >= 1.15 ? "A little sharper" : "Not sharper";
    const cards: Array<[string, string]> = [
      [speed === 0 || !Number.isFinite(ratio) ? "no motion chosen" : `${ratio.toFixed(2)}× the sharpness with no motion`, verdict || "—"],
      ["pictures added", String(moved.shifts.length)],
      ["furthest slide", maxShift(moved.shifts)],
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
    tiltStatus.textContent = "A sharp dot in the ring is a candidate, not a discovery. Open Checks below to test it.";

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
    tiltStatus.textContent = `That did not work. ${plainError((error as Error).message)}`;
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
    tiltStatus.textContent = "No star catalogue lists a motion for this place.";
    return;
  }
  if (group === 0) {
    tiltStatus.textContent = ONE_SET;
    return;
  }
  // mas/yr to arcsec/yr; vx is east-positive (pmra already includes cos dec), vy is north.
  vxInput.value = String(Math.round(((target.pmra_mas_yr ?? 0) / 1000) * 1000) / 1000);
  vyInput.value = String(Math.round(((target.pmdec_mas_yr ?? 0) / 1000) * 1000) / 1000);
  await runTilt();
  tiltStatus.textContent =
    `This is the motion star catalogues give for ${target.name}. A sharp dot in the ring shows the method works.`;
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
      gaiaNote.textContent = `${result.n} stars from the Gaia catalogue are in this patch (the brightest ${result.limit} at most, so faint ones may be missing).`;
      const index = Number(timeline.value);
      if (viewInput.value === "blink" && sliceData[index]) drawBlink(index);
      return result;
    })
    .catch((error: Error) => {
      if (key === jobKey) gaiaNote.textContent = `The Gaia catalogue did not answer, so no rings are drawn. ${plainError(error.message)}`;
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
    mapSpan: mapGrid().span,
    mapStep: mapGrid().step,
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
  resetFind();
  if (realFrames.length === 0) return;
  pendingPair = compareView.pair;
  frameSlices = plantedFrames();
  mountFrames(Number(timeline.value), false);
  tiltStatus.textContent = simulator.active
    ? "Practise mode: these pictures hold a made-up object. The tools run in your browser."
    : "Back to the real pictures.";
  if (tiltRan && group !== 0) void runTilt();
}
