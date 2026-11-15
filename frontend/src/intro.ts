// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The first-visit intro: three short cards beside a real 16-year movie of Barnard's Star.
// The movie is real archive data (WISE W2 epochs, then SPHEREx D6 frames) from the saved cube;
// the amber line is the catalogue track (SIMBAD proper motion), drawn, never fitted.
// If the frames cannot load, the screen says so and shows nothing in their place.
import "./intro.css";
import * as api from "./api";
import { drawSlice } from "./colormap";
import { decimalYear } from "./gaia";
import { showScene } from "./scenes";
import { DET_W2, ownStretch, selectMovieFrames } from "./wise";

const SEEN_KEY = "intro-seen";
const FRAME_MS = 280;
const HOLD_MS = 1400;
const SCALE = 4;

interface Movie {
  npix: number;
  frames: Array<{ meta: api.FrameMeta; data: Float32Array }>;
  /** Catalogue position of the star at each frame, in display pixels (x right, y down). */
  track: Array<{ x: number; y: number }>;
}

// Read before scenes.ts writes ?scene=... into the address bar on startup.
const LANDING_SEARCH = window.location.search;

const reduced = (): boolean => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function wanted(): boolean {
  const params = new URLSearchParams(LANDING_SEARCH);
  if (params.get("intro") === "1") return true;
  // Any other parameter is a shared link to something specific: go straight there.
  if ([...params.keys()].length > 0) return false;
  try {
    return window.localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the intro shows again next time, which is harmless */
  }
}

/** Pixel of a sky position on the job grid (0-based; x grows west, y north), as in backend/align.py. */
function gridPixel(grid: NonNullable<api.JobStatus["grid"]>, ra: number, dec: number): { x: number; y: number } {
  const c = (grid.npix - 1) / 2;
  const cosd = Math.cos((grid.center_dec * Math.PI) / 180);
  const xi = (ra - grid.center_ra) * cosd * 3600;
  const eta = (dec - grid.center_dec) * 3600;
  return { x: c - xi / grid.pixscale_arcsec, y: c + eta / grid.pixscale_arcsec };
}

async function loadMovie(): Promise<Movie> {
  const { jobs } = await api.cachedPatches();
  const patch = jobs
    .filter((p) => p.target === "Barnard's Star" && p.n_wise > 0)
    .sort((a, b) => b.n_spherex + b.n_wise - (a.n_spherex + a.n_wise))[0];
  if (!patch) throw new Error("no saved Barnard's Star cube");
  const [w2, d6, job] = await Promise.all([
    api.fetchFrameCube(patch.key, DET_W2),
    api.fetchFrameCube(patch.key, 6).catch(() => ({ npix: 0, frames: [] })),
    api.getJob(patch.key),
  ]);
  const frames = selectMovieFrames([...w2.frames, ...d6.frames], DET_W2);
  const t = job.target;
  const grid = job.grid;
  if (frames.length < 2 || !t || !grid || t.pmra_mas_yr === undefined || t.pmdec_mas_yr === undefined) {
    throw new Error("the saved cube has no catalogue motion");
  }
  const cosd = Math.cos((grid.center_dec * Math.PI) / 180);
  const npix = w2.npix;
  const track = frames.map(({ meta }) => {
    const dt = decimalYear(meta.mjd) - 2000; // SIMBAD positions are J2000
    const ra = t.ra_deg + ((t.pmra_mas_yr ?? 0) / 1000) * dt / 3600 / cosd;
    const dec = t.dec_deg + ((t.pmdec_mas_yr ?? 0) / 1000) * dt / 3600;
    const p = gridPixel(grid, ra, dec);
    return { x: (p.x + 0.5) * SCALE, y: (npix - p.y - 0.5) * SCALE };
  });
  return { npix, frames, track };
}

export function initIntro(): void {
  const root = document.getElementById("intro");
  if (!root) return;
  const replay = (): void => open(root);
  for (const b of document.querySelectorAll<HTMLElement>("[data-intro-replay]")) b.addEventListener("click", replay);
  for (const b of document.querySelectorAll<HTMLElement>("[data-intro-start]")) b.addEventListener("click", startBarnard);
  if (wanted()) open(root);
}

function startBarnard(): void {
  close();
  showScene("cube");
  document.getElementById("quick-start")?.click();
}

let closeFn: (() => void) | null = null;

function close(): void {
  closeFn?.();
}

function open(root: HTMLElement): void {
  if (closeFn) return;
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const cards = [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const back = $<HTMLButtonElement>("[data-intro-back]");
  const next = $<HTMLButtonElement>("[data-intro-next]");
  const step = $<HTMLElement>("[data-intro-step]");
  const screen = $<HTMLCanvasElement>(".intro-screen canvas");
  const hud = $<HTMLElement>("[data-intro-hud]");
  const msg = $<HTMLElement>("[data-intro-msg]");
  const play = $<HTMLButtonElement>("[data-intro-play]");
  const scrub = $<HTMLInputElement>("[data-intro-scrub]");
  const lastFocus = document.activeElement as HTMLElement | null;

  let card = 0;
  let movie: Movie | null = null;
  let frame = 0;
  let timer = 0;
  let playing = false;
  const off = document.createElement("canvas");
  const stretches: Array<{ lo: number; hi: number }> = [];

  const showCard = (i: number, focus: boolean): void => {
    card = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => (c.hidden = k !== card));
    back.hidden = card === 0;
    next.hidden = card === cards.length - 1;
    step.textContent = `${card + 1} / ${cards.length}`;
    if (focus) cards[card].querySelector<HTMLElement>("h2")?.focus();
  };

  const draw = (): void => {
    if (!movie) return;
    const { meta, data } = movie.frames[frame];
    stretches[frame] ??= ownStretch(data);
    drawSlice(data, movie.npix, off, stretches[frame]);
    const ctx = screen.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, screen.width, screen.height);
    // Catalogue track: the whole path dashed, the part already travelled solid, a ring where the star should be now.
    const tr = movie.track;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 162, 74, 0.55)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(tr[0].x, tr[0].y);
    ctx.lineTo(tr[tr.length - 1].x, tr[tr.length - 1].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffa24a";
    ctx.beginPath();
    ctx.moveTo(tr[0].x, tr[0].y);
    ctx.lineTo(tr[frame].x, tr[frame].y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tr[frame].x, tr[frame].y, 5 * SCALE, 0, Math.PI * 2);
    ctx.stroke();

    const year = decimalYear(meta.mjd).toFixed(1);
    const who = meta.source === "wise" ? "WISE 4.6 µm" : `SPHEREx ${meta.wavelength_um.toFixed(2)} µm`;
    hud.textContent = `${year} · ${who} · frame ${frame + 1} of ${movie.frames.length}`;
    screen.setAttribute("aria-label", `Real infrared image of the sky around Barnard's Star, ${year}, ${who}. The amber ring marks where star catalogues place it that year.`);
    scrub.value = String(frame);
  };

  const tick = (): void => {
    if (!movie || !playing) return;
    frame = (frame + 1) % movie.frames.length;
    draw();
    timer = window.setTimeout(tick, frame === movie.frames.length - 1 ? HOLD_MS : FRAME_MS);
  };
  const setPlaying = (on: boolean): void => {
    playing = on && !!movie;
    window.clearTimeout(timer);
    play.textContent = playing ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(playing));
    if (playing) timer = window.setTimeout(tick, FRAME_MS);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if (ev.key === "Tab") {
      // Keep keyboard focus inside the intro while it is open.
      const items = [...root.querySelectorAll<HTMLElement>("button:not([hidden]), input, a[href], h2[tabindex]")]
        .filter((n) => n.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); }
    }
  };

  closeFn = () => {
    setPlaying(false);
    root.hidden = true;
    document.body.classList.remove("intro-open");
    root.removeEventListener("keydown", onKey);
    closeFn = null;
    markSeen();
    lastFocus?.focus?.();
    window.dispatchEvent(new Event("intro:closed"));
  };

  back.onclick = () => showCard(card - 1, true);
  next.onclick = () => showCard(card + 1, true);
  play.onclick = () => setPlaying(!playing);
  scrub.oninput = () => {
    setPlaying(false);
    frame = Number(scrub.value);
    draw();
  };
  for (const b of root.querySelectorAll<HTMLElement>("[data-intro-skip]")) b.onclick = close;
  root.addEventListener("keydown", onKey);

  root.hidden = false;
  document.body.classList.add("intro-open");
  showCard(0, false);
  next.focus();

  screen.width = screen.height = 128 * SCALE;
  play.disabled = scrub.disabled = true;
  msg.hidden = false;
  msg.textContent = "Loading the saved images…";
  loadMovie()
    .then((m) => {
      if (!closeFn) return;
      movie = m;
      screen.width = screen.height = m.npix * SCALE;
      scrub.max = String(m.frames.length - 1);
      play.disabled = scrub.disabled = false;
      msg.hidden = true;
      // Reduced motion: no autoplay.  Show the last frame, with the whole track, until asked.
      frame = reduced() ? m.frames.length - 1 : 0;
      draw();
      setPlaying(!reduced());
    })
    .catch(() => {
      msg.textContent =
        "The saved images did not load (the server may still be starting). Nothing is shown in their place. Reload in a minute, or step through the cards to open the tool.";
      hud.textContent = "";
    });
}
