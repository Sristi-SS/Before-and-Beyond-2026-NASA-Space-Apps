// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The two pages: the sky globe (landing) and the time cube (the workspace in main.ts).
// This module owns page switching, the URL parameter scene=globe|cube, and the globe's side panel.
// ("Why it moves" used to be a third page; it is now the second card of the intro, see whymoves.ts.)
import * as api from "./api";
import { factFor } from "./facts";
import { formatRaDec, Globe, separationDeg, type Pin } from "./globe";
import { flushState, readState, writeState, type Scene } from "./state";

let openJobFn: ((key: string) => void) | null = null;

/** main.ts tells this module how to open a cached cube in the time-cube scene. */
export function registerOpenJob(fn: (key: string) => void): void {
  openJobFn = fn;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => !!reducedQuery?.matches;

let scene: Scene = "cube";
let globe: Globe | null = null;
let globeReady = false;
let patches: api.CachedPatch[] = [];
let targetList: api.TargetInfo[] = [];

export function currentScene(): Scene {
  return scene;
}

export function showScene(next: Scene): void {
  scene = next;
  document.body.dataset.scene = next;
  $("scene-globe").hidden = next !== "globe";
  for (const [id, s] of [["nav-globe", "globe"], ["nav-cube", "cube"]] as const) {
    const b = $(id);
    if (s === next) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (next !== "cube") {
    const play = document.getElementById("play");
    if (play && play.textContent === "Pause") play.click();
  }
  if (next === "globe") void ensureGlobe();
  globe?.setActive(next === "globe");
  writeState({ scene: next });
  flushState();
  window.scrollTo({ top: 0 });
}

export function initScenes(): void {
  const start = readState().scene;
  for (const [id, s] of [["nav-globe", "globe"], ["nav-cube", "cube"]] as const) {
    $(id).addEventListener("click", () => showScene(s));
  }
  // The guided tour drives the cube workspace, so it always starts there.
  document.addEventListener("click", (ev) => {
    const hit = (ev.target as HTMLElement | null)?.closest("#tour-start, #tour-start-empty");
    if (hit && scene !== "cube") showScene("cube");
  }, true);
  window.addEventListener("pagehide", teardown);
  wireGlobeUi();
  showScene(start);
}

function teardown(): void {
  globe?.dispose();
  globe = null;
}

if (import.meta.hot) import.meta.hot.dispose(teardown);

// ---------------------------------------------------------------------------
// Scene 1: the sky globe
// ---------------------------------------------------------------------------
function patchesNear(ra: number, dec: number, radius = 0.5): api.CachedPatch[] {
  return patches
    .filter((p) => separationDeg(ra, dec, p.ra_deg, p.dec_deg) <= radius)
    .sort((a, b) => b.n_spherex + b.n_wise - (a.n_spherex + a.n_wise));
}

function patchesOfTarget(name: string): api.CachedPatch[] {
  const t = targetList.find((x) => x.name === name);
  const byName = patches
    .filter((p) => p.target === name)
    .sort((a, b) => b.n_spherex + b.n_wise - (a.n_spherex + a.n_wise));
  if (byName.length || !t || t.ra_deg === undefined || t.dec_deg === undefined) return byName;
  return patchesNear(t.ra_deg, t.dec_deg, 0.5);
}

function describePatch(p: api.CachedPatch): string {
  const fov = p.fov_deg ? ` · field ${p.fov_deg}°` : "";
  return `${p.target} · ${p.n_spherex} SPHEREx + ${p.n_wise} WISE frames${fov}`;
}

function openCube(p: api.CachedPatch): void {
  const go = () => {
    showScene("cube");
    openJobFn?.(p.key);
  };
  if (globe && scene === "globe") globe.flyTo(p.ra_deg, p.dec_deg, true, go);
  else go();
}

/** Named bright stars drawn on the globe, for the fact shown when a place near one is picked. */
let brightList: api.BrightStar[] = [];

/** Fill the build form with a position (and a named target when it is one) and start building. */
function buildCubeAt(ra: number, dec: number, targetKey?: string): void {
  const select = $("target-select") as HTMLSelectElement;
  if (targetKey) {
    select.value = targetKey;
    select.dispatchEvent(new Event("change"));
  } else {
    select.value = "";
    ($("ra") as HTMLInputElement).value = ra.toFixed(4);
    ($("dec") as HTMLInputElement).value = dec.toFixed(4);
  }
  showScene("cube");
  ($("build") as HTMLButtonElement).click();
}

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function showPick(ra: number, dec: number, targetKey?: string, targetName?: string): void {
  globe?.setMarker(ra, dec);
  // The build form always follows the globe, so "Build time cube" in the cube scene matches.
  ($("ra") as HTMLInputElement).value = ra.toFixed(4);
  ($("dec") as HTMLInputElement).value = dec.toFixed(4);
  if (!targetKey) ($("target-select") as HTMLSelectElement).value = "";
  const box = $("globe-pick");
  box.replaceChildren();
  const head = document.createElement("p");
  head.className = "pick-head";
  head.textContent = `${targetName ? `${targetName}: ` : ""}${formatRaDec(ra, dec)}`;
  box.append(head);
  // A short fact about the place: the test object itself, or the brightest named star within two degrees.
  const star = targetName ? undefined : brightList
    .filter((b) => b.name && separationDeg(ra, dec, b.ra_deg, b.dec_deg) < 2)
    .sort((a, b) => a.mag - b.mag)[0];
  if (star) head.textContent = `Near ${star.name}: ${formatRaDec(ra, dec)}`;
  const fact = factFor(targetName || star?.name);
  if (fact) {
    const line = document.createElement("p");
    line.className = "fact";
    line.textContent = fact;
    box.append(line);
  }
  const near = targetName ? patchesOfTarget(targetName) : patchesNear(ra, dec);
  const line = document.createElement("p");
  line.className = "hint";
  const actions = document.createElement("div");
  actions.className = "row wrap";
  if (near.length) {
    line.textContent = `A cube is already built here: ${describePatch(near[0])}.`;
    actions.append(button("Open this cube", () => openCube(near[0]), "primary"));
  } else {
    line.textContent = "Nobody has looked here yet.";
  }
  const label = targetName ? `Build a cube for ${targetName}` : "Build a cube here";
  actions.append(button(label, () => buildCubeAt(ra, dec, targetKey), near.length ? "" : "primary"));
  box.append(line, actions);
}

function pinTarget(info: api.TargetInfo): void {
  if (info.ra_deg === undefined || info.dec_deg === undefined) return;
  const cached = patchesOfTarget(info.name);
  if (cached.length) {
    showPick(info.ra_deg, info.dec_deg, info.key, info.name);
    openCube(cached[0]);
    return;
  }
  globe?.flyTo(info.ra_deg, info.dec_deg, false);
  showPick(info.ra_deg, info.dec_deg, info.key, info.name);
}

function onPin(pin: Pin): void {
  if (pin.kind === "patch") {
    const p = patches.find((x) => `patch:${x.key}` === pin.id);
    if (p) openCube(p);
    return;
  }
  const info = targetList.find((t) => `target:${t.key}` === pin.id);
  if (info) pinTarget(info);
}

function renderLists(): void {
  const tl = $("globe-targets");
  tl.replaceChildren();
  for (const t of targetList) {
    const li = document.createElement("li");
    const where = t.ra_deg !== undefined && t.dec_deg !== undefined ? formatRaDec(t.ra_deg, t.dec_deg) : "";
    li.append(button(t.name, () => pinTarget(t), "linkish"));
    const span = document.createElement("span");
    span.className = "muted small";
    span.textContent = ` ${where}`;
    li.append(span);
    tl.append(li);
  }
  if (!targetList.length) tl.append(Object.assign(document.createElement("li"), { textContent: "The target list is not available (is the API running?)." }));
  const cl = $("globe-cubes");
  cl.replaceChildren();
  // Presets: the name, big; the size of the cube, small.  Barnard's Star first: it is the one to start with.
  const order = [...patches].sort((a, b) => Number(/barnard/i.test(b.target)) - Number(/barnard/i.test(a.target)));
  for (const p of order) {
    const li = document.createElement("li");
    const b = button("", () => openCube(p), "preset");
    b.title = describePatch(p);
    const name = document.createElement("b");
    name.textContent = p.target;
    const meta = document.createElement("small");
    meta.textContent = `${p.n_spherex + p.n_wise} pictures`;
    b.append(name, meta);
    li.append(b);
    cl.append(li);
  }
  if (!patches.length) cl.append(Object.assign(document.createElement("li"), { textContent: "No cubes have been built yet." }));
}

async function ensureGlobe(): Promise<void> {
  if (globeReady) return;
  globeReady = true;
  const view = $("globe-view");
  const nogl = $("globe-nogl");
  if (Globe.supported()) {
    try {
      globe = new Globe(view, {
        get reducedMotion() { return reducedMotion(); },
        onPick: (ra, dec) => showPick(ra, dec),
        onPin,
        onView: (ra, dec) => {
          $("globe-view-readout").textContent = `View centre: ${formatRaDec(ra, dec)}`;
        },
      });
      globe.setActive(scene === "globe");
    } catch {
      globe = null;
    }
  }
  nogl.hidden = globe !== null;
  view.hidden = globe === null;
  $("globe-controls").hidden = globe === null;

  const [tg, ps, st] = await Promise.allSettled([api.targets(), api.cachedPatches(), api.brightStars()]);
  targetList = tg.status === "fulfilled" ? tg.value.targets : [];
  brightList = st.status === "fulfilled" ? st.value.stars : [];
  // Several cubes of one place can be in the cache (test builds).  Show the richest one only.
  const best = new Map<string, api.CachedPatch>();
  for (const p of ps.status === "fulfilled" ? ps.value.jobs : []) {
    const id = `${p.ra_deg.toFixed(2)},${p.dec_deg.toFixed(2)}`;
    const held = best.get(id);
    if (!held || p.n_spherex + p.n_wise > held.n_spherex + held.n_wise) best.set(id, p);
  }
  patches = [...best.values()].sort((x, y) => x.target.localeCompare(y.target));
  renderLists();
  const pins: Pin[] = [];
  for (const t of targetList) {
    if (t.ra_deg !== undefined && t.dec_deg !== undefined) {
      pins.push({ id: `target:${t.key}`, kind: "target", label: t.name, ra: t.ra_deg, dec: t.dec_deg });
    }
  }
  for (const p of patches) {
    pins.push({ id: `patch:${p.key}`, kind: "patch", label: describePatch(p), ra: p.ra_deg, dec: p.dec_deg });
  }
  globe?.setPins(pins);
  const note = $("globe-stars-note");
  if (st.status === "fulfilled") {
    globe?.setStars(st.value);
    note.textContent = st.value.source === "fallback"
      ? `Stars: built-in fallback list of ${st.value.n} well-known bright stars (the full catalogue could not be fetched).`
      : `Stars: ${st.value.n} real stars, ${st.value.catalogue}.`;
  } else {
    note.textContent = "Stars: the star list could not be loaded.";
  }
}

function wireGlobeUi(): void {
  const act: Record<string, () => void> = {
    left: () => globe?.nudge(-15, 0),
    right: () => globe?.nudge(15, 0),
    up: () => globe?.nudge(0, 15),
    down: () => globe?.nudge(0, -15),
    in: () => globe?.zoom(0.8),
    out: () => globe?.zoom(1.25),
    centre: () => {
      if (globe) {
        const c = globe.viewCentre();
        showPick(c.ra, c.dec);
      }
    },
  };
  document.querySelectorAll<HTMLButtonElement>("[data-globe]").forEach((b) => {
    b.addEventListener("click", () => act[b.dataset.globe ?? ""]?.());
  });

  const form = $("globe-search") as HTMLFormElement;
  const input = $("globe-q") as HTMLInputElement;
  const msg = $("globe-search-msg");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) {
      msg.textContent = "Type an object name or coordinates first.";
      return;
    }
    msg.textContent = "Looking it up…";
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    api.resolveText(text).then((r) => {
      msg.textContent = `${r.name}: ${formatRaDec(r.ra_deg, r.dec_deg)} (${r.source}).`;
      globe?.flyTo(r.ra_deg, r.dec_deg, false);
      const known = targetList.find((t) => t.name === r.name);
      showPick(r.ra_deg, r.dec_deg, known?.key, r.kind === "name" ? r.name : undefined);
    }).catch((e: Error) => {
      msg.textContent = e.message;
    }).finally(() => {
      submit.disabled = false;
    });
  });

  $("globe-quick").addEventListener("click", () => {
    showScene("cube");
    window.dispatchEvent(new CustomEvent("open-target", { detail: "barnard" }));
  });
  $("globe-tour").addEventListener("click", () => {
    showScene("cube");
    ($("tour-start") as HTMLButtonElement).click();
  });
  $("globe-build-coords").addEventListener("click", () => {
    const ra = Number(($("globe-ra") as HTMLInputElement).value);
    const dec = Number(($("globe-dec") as HTMLInputElement).value);
    const msg2 = $("globe-search-msg");
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
      msg2.textContent = "RA must be 0 to 360 and Dec -90 to +90 (degrees).";
      return;
    }
    globe?.flyTo(ra, dec, false);
    showPick(ra, dec);
  });
}
