// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Scene 3: the orbit view.  Why does something that is not moving through space still move on the
// sky?  Earth circles the Sun; the sight line to a nearby object swings, the distant background
// does not.  The inset adds that wobble (parallax) to a straight proper motion: the zigzag in the cube.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { disposeObject, Globe, textSprite } from "./globe";
import { distantPlanetMotion } from "./simulator";

/** One SPHEREx pixel, in arcseconds. */
export const SPHEREX_PIXEL_ARCSEC = 6.15;
const AU_PER_PC = 206265;
/** Length of the time scrub, in years. */
const T_MAX = 4;
/** Ecliptic latitude of the example object (degrees): not zero, so the wobble is an ellipse and not a line. */
const BETA = 40 * (Math.PI / 180);

export type OrbitMode = "star" | "planet";

/** Parallax angle in arcseconds.  Stars: p = 1 / d(pc).  A planet at d AU: p ~ 206265 / d. */
export function parallaxArcsec(mode: OrbitMode, d: number): number {
  return mode === "star" ? 1 / d : distantPlanetMotion(d).parallaxArcsec;
}

export interface OrbitTarget {
  name: string;
  pmra_mas_yr?: number;
  pmdec_mas_yr?: number;
}

// Literature values, approximate; shown with that label.
const LITERATURE_PARALLAX: Array<[RegExp, number]> = [
  [/barnard/i, 0.547],
  [/wise\s*0855/i, 0.449],
  [/epsilon\s*indi|eps\s*ind/i, 0.274],
];

const RANGE = {
  star: { min: 1, max: 100, unit: "pc", pmMax: 12 },
  planet: { min: 100, max: 2000, unit: "AU", pmMax: 140 },
} as const;

function fromSlider(mode: OrbitMode, v: number): number {
  const r = RANGE[mode];
  return r.min * Math.pow(r.max / r.min, v / 1000);
}
function toSlider(mode: OrbitMode, d: number): number {
  const r = RANGE[mode];
  return Math.round((1000 * Math.log(d / r.min)) / Math.log(r.max / r.min));
}

function q<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

/** Move a two-point line in place (no new GPU buffers per frame). */
function setSegment(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  attr.setXYZ(0, a.x, a.y, a.z);
  attr.setXYZ(1, b.x, b.y, b.z);
  attr.needsUpdate = true;
}

function fmt(x: number, digits = 3): string {
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(digits);
}

export class OrbitView {
  private mode: OrbitMode = "star";
  private d = 10;
  private pm = 0;
  private dirX = 1;
  private dirY = 0;
  private t = 0;
  private playing = false;
  private running = false;
  private disposed = false;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private preset: { name: string; note: string } | null = null;

  // 3D (null when WebGL is missing)
  private gl: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    earth: THREE.Mesh;
    object: THREE.Mesh;
    hit: THREE.Mesh;
    near: THREE.Line;
    far: THREE.Line;
    trail: THREE.Line;
    earthLabel: THREE.Sprite;
    sunLabel: THREE.Sprite;
    objLabel: THREE.Sprite;
    bgLabel: THREE.Sprite;
    observer: ResizeObserver;
  } | null = null;

  private readonly view = q<HTMLElement>("orbit-view");
  private readonly inset = q<HTMLCanvasElement>("orbit-inset");
  private readonly modeSel = q<HTMLSelectElement>("orbit-mode");
  private readonly distRange = q<HTMLInputElement>("orbit-dist");
  private readonly distNum = q<HTMLInputElement>("orbit-dist-num");
  private readonly distUnit = q<HTMLElement>("orbit-dist-unit");
  private readonly pmRange = q<HTMLInputElement>("orbit-pm");
  private readonly pmOut = q<HTMLElement>("orbit-pm-out");
  private readonly playBtn = q<HTMLButtonElement>("orbit-play");
  private readonly timeRange = q<HTMLInputElement>("orbit-time");
  private readonly timeOut = q<HTMLElement>("orbit-time-out");
  private readonly detrend = q<HTMLInputElement>("orbit-detrend");
  private readonly simBtn = q<HTMLButtonElement>("orbit-use-sim");
  private readonly numbers = q<HTMLElement>("orbit-numbers");
  private readonly presetNote = q<HTMLElement>("orbit-preset-note");
  /** The one plain-English sentence about what is set up right now. */
  private readonly plainNow = q<HTMLElement>("orbit-plain");
  private readonly noGl = q<HTMLElement>("orbit-nogl");

  constructor(private readonly reducedMotion: boolean) {
    this.timeRange.max = String(T_MAX);
    if (Globe.supported()) {
      try {
        this.gl = this.buildScene();
      } catch {
        this.gl = null;
      }
    }
    this.noGl.hidden = this.gl !== null;
    this.view.hidden = this.gl === null;

    this.modeSel.addEventListener("change", () => {
      this.setMode(this.modeSel.value === "planet" ? "planet" : "star", true);
    });
    this.distRange.addEventListener("input", () => {
      this.d = fromSlider(this.mode, Number(this.distRange.value));
      this.syncDist();
      this.changed();
    });
    this.distNum.addEventListener("input", () => {
      const v = Number(this.distNum.value);
      if (!Number.isFinite(v) || v <= 0) return;
      const r = RANGE[this.mode];
      this.d = Math.min(r.max, Math.max(r.min, v));
      this.distRange.value = String(toSlider(this.mode, this.d));
      this.changed();
    });
    this.distNum.addEventListener("change", () => this.syncDist());
    this.pmRange.addEventListener("input", () => {
      this.pm = Number(this.pmRange.value);
      this.changed();
    });
    this.timeRange.addEventListener("input", () => {
      this.t = Number(this.timeRange.value);
      this.dirty = true;
      this.updateTimeOut();
    });
    this.playBtn.addEventListener("click", () => this.setPlaying(!this.playing));
    this.detrend.addEventListener("change", () => {
      this.dirty = true;
      this.updateNumbers();
    });
    this.simBtn.addEventListener("click", () => {
      const m = distantPlanetMotion(this.d);
      this.pm = Math.min(RANGE.planet.pmMax, m.vy);
      this.dirX = 0;
      this.dirY = 1;
      this.pmRange.value = String(this.pm);
      this.changed();
    });
    this.setMode("star", false);
    this.d = 10;
    this.syncDist();
    this.changed();
  }

  // -- state ---------------------------------------------------------------
  private setMode(mode: OrbitMode, keepNothing: boolean): void {
    this.mode = mode;
    const r = RANGE[mode];
    this.modeSel.value = mode;
    this.distRange.min = "0";
    this.distRange.max = "1000";
    this.distNum.min = String(r.min);
    this.distNum.max = String(r.max);
    this.distUnit.textContent = r.unit;
    this.pmRange.max = String(r.pmMax);
    this.simBtn.hidden = mode !== "planet";
    if (keepNothing) {
      this.d = mode === "star" ? 10 : 500;
      this.pm = 0;
      this.pmRange.value = "0";
      this.preset = null;
      this.presetNote.textContent = "";
    }
    this.syncDist();
    this.changed();
  }

  private syncDist(): void {
    this.distRange.value = String(toSlider(this.mode, this.d));
    this.distNum.value = this.d >= 100 ? this.d.toFixed(0) : this.d.toFixed(this.d >= 10 ? 1 : 2);
  }

  private changed(): void {
    this.dirty = true;
    this.pmOut.textContent = `${fmt(this.pm, 2)} arcsec/yr`;
    this.updateNumbers();
    this.updateTimeOut();
    this.rebuildTrail();
  }

  private updateTimeOut(): void {
    this.timeRange.value = String(this.t);
    this.timeOut.textContent = `${this.t.toFixed(2)} years`;
  }

  /** Preset the sliders from the open job's target (catalogue proper motion; literature parallax when known). */
  setTarget(t: OrbitTarget | null): void {
    if (!t) return;
    const pmE = (t.pmra_mas_yr ?? 0) / 1000;
    const pmN = (t.pmdec_mas_yr ?? 0) / 1000;
    const mag = Math.hypot(pmE, pmN);
    const lit = LITERATURE_PARALLAX.find(([re]) => re.test(t.name));
    if (mag === 0 && !lit) return;
    this.mode = "star";
    this.setMode("star", true);
    if (mag > 0) {
      this.dirX = pmE / mag;
      this.dirY = pmN / mag;
      this.pm = Math.min(RANGE.star.pmMax, mag);
      this.pmRange.value = String(this.pm);
    }
    let note = `Preset from the open cube's target, ${t.name}: proper motion ${mag.toFixed(2)} arcsec/yr (catalogue, SIMBAD).`;
    if (lit) {
      this.d = 1 / lit[1];
      note += ` Parallax ${lit[1].toFixed(3)} arcsec (approximate, from the literature), so a distance of ${this.d.toFixed(2)} pc.`;
    } else {
      note += " Its parallax is not stored here, so the distance is a default: drag the distance slider.";
    }
    this.preset = { name: t.name, note };
    this.presetNote.textContent = note;
    this.syncDist();
    this.changed();
  }

  private setPlaying(on: boolean): void {
    this.playing = on;
    this.playBtn.textContent = on ? "Pause" : "Play";
    this.playBtn.setAttribute("aria-pressed", String(on));
    this.last = performance.now();
  }

  // -- the physics (also what the numbers panel shows) ----------------------
  private parallax(): number {
    return parallaxArcsec(this.mode, this.d);
  }

  /** Apparent offset (east, north) in arcsec at time t (years): straight proper motion plus the parallax ellipse. */
  private offset(t: number, withPm: boolean): [number, number] {
    const p = this.parallax();
    const th = 2 * Math.PI * t;
    let x = -p * Math.cos(th);
    let y = -p * Math.sin(th) * Math.sin(BETA);
    if (withPm) {
      x += this.pm * this.dirX * t;
      y += this.pm * this.dirY * t;
    }
    return [x, y];
  }

  private updateNumbers(): void {
    const p = this.parallax();
    const px = SPHEREX_PIXEL_ARCSEC;
    const rows: Array<[string, string]> = [];
    if (this.mode === "star") {
      rows.push(["Distance", `${fmt(this.d, 2)} pc (${(this.d * AU_PER_PC).toLocaleString("en-US", { maximumFractionDigits: 0 })} AU)`]);
      rows.push(["Parallax", `p = 1 / d = 1 / ${fmt(this.d, 2)} = ${fmt(p)} arcsec`]);
    } else {
      rows.push(["Distance", `${fmt(this.d, 0)} AU (a hypothetical distant planet)`]);
      rows.push(["Parallax", `p ≈ 206265 / ${fmt(this.d, 0)} = ${fmt(p, 1)} arcsec`]);
    }
    rows.push(["In SPHEREx pixels", `${fmt(p / px)} pixels (one pixel is ${px} arcsec); the full swing is ${fmt((2 * p) / px)} pixels`]);
    rows.push(["Proper motion", `${fmt(this.pm, 2)} arcsec/yr = ${fmt(this.pm / px, 2)} pixels/yr`]);
    rows.push(["Over 4 years", `drift ${fmt(this.pm * T_MAX, 1)} arcsec = ${fmt((this.pm * T_MAX) / px, 1)} pixels`]);
    if (this.mode === "planet") {
      const m = distantPlanetMotion(this.d);
      rows.push(["Simulator's orbital drift", `206265 × 2π / d¹·⁵ = ${fmt(m.vy, 1)} arcsec/yr`]);
    }
    this.plainNow.textContent = this.plainSentence(p / px, this.pm / px);
    this.numbers.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      this.numbers.append(dt, dd);
    }
    const lead = this.preset ? `${this.preset.name}: ` : "";
    this.inset.setAttribute(
      "aria-label",
      `${lead}apparent path on the sky over 4 years. Parallax ${fmt(p)} arcsec, ${fmt(p / px)} SPHEREx pixels; ` +
        `proper motion ${fmt(this.pm, 2)} arcsec per year.`,
    );
  }

  /** "Right now: ..." in everyday words: how far, and how much it sways and drifts in SPHEREx pixels. */
  private plainSentence(swayPx: number, driftPx: number): string {
    const amount = (n: number, unit: string): string =>
      n < 0.05 ? `far less than one ${unit}` : n < 1 ? `about ${n.toFixed(1)} of a ${unit}` : `about ${fmt(n, 1)} ${unit}s`;
    const sway = `it sways ${amount(2 * swayPx, "SPHEREx pixel")} back and forth`;
    const drift = driftPx > 0 ? ` and drifts ${amount(driftPx, "pixel")} along its path` : "";
    if (this.mode === "star") {
      const who = this.preset ? this.preset.name : "this star";
      const ly = this.d * 3.2616;
      return `Right now: ${who} is about ${fmt(ly, ly < 10 ? 1 : 0)} light-years away. Each year ${sway}${drift}.`;
    }
    return `Right now: a planet ${fmt(this.d, 0)} times farther from the Sun than Earth. Each year ${sway}${drift}: easy to catch.`;
  }

  // -- 3D scene --------------------------------------------------------------
  private buildScene(): NonNullable<OrbitView["gl"]> {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-hidden", "true");
    this.view.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    camera.position.set(5.2, 5.6, 9.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2.3, -3.2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 40;
    controls.minDistance = 2;
    camera.lookAt(controls.target);

    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * 2 * Math.PI), 0, Math.sin((i / 128) * 2 * Math.PI))),
      ),
      new THREE.LineBasicMaterial({ color: 0x58b4ff, transparent: true, opacity: 0.7 }),
    );
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: 0x58b4ff }));
    const object = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0xffa24a }));
    const hit = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xffa24a }));

    // Background: decorative points on a far sphere (not catalogue data).
    const pts: number[] = [];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    while (pts.length < 3 * 260) {
      const z = rnd() * 2 - 1;
      const a = rnd() * 2 * Math.PI;
      const r = Math.sqrt(1 - z * z);
      const v = new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a));
      if (v.z < 0.25) pts.push(v.x * 9, v.y * 9, v.z * 9);
    }
    const bg = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.PointsMaterial({ color: 0xbcc4dc, size: 0.07, transparent: true, opacity: 0.8 }),
    );

    const lineGeo = () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const near = new THREE.Line(lineGeo(), new THREE.LineBasicMaterial({ color: 0x58b4ff }));
    const far = new THREE.Line(lineGeo(), new THREE.LineBasicMaterial({ color: 0x58b4ff, transparent: true, opacity: 0.45 }));
    const trail = new THREE.Line(lineGeo(), new THREE.LineBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.85 }));

    // Pixel-font labels in the theme's colours, like the rest of the site.
    const sunLabel = textSprite("SUN", { height: 0.5, screen: false, color: "#ffd23f", font: "pixel" });
    // Placed every frame (placeSunEarthLabels): EARTH on the side of Earth away from the Sun, SUN on the other side.
    const earthLabel = textSprite("EARTH", { height: 0.5, screen: false, color: "#58b4ff", font: "pixel" });
    const objLabel = textSprite("NEARBY OBJECT", { height: 0.5, screen: false, color: "#ffa24a", font: "pixel" });
    const bgLabel = textSprite("FAR-AWAY STARS", { height: 0.6, screen: false, color: "#bcc4dc", font: "pixel" });
    bgLabel.position.set(-3.2, 5.2, -8.2);

    scene.add(sun, ring, earth, object, hit, bg, near, far, trail, sunLabel, earthLabel, objLabel, bgLabel);

    const observer = new ResizeObserver(() => {
      const w = Math.max(1, this.view.clientWidth);
      const h = Math.max(1, this.view.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(this.view);
    return { renderer, scene, camera, controls, earth, object, hit, near, far, trail, earthLabel, sunLabel, objLabel, bgLabel, observer };
  }

  /** Visual (not to scale) distance of the example object from the Sun. */
  private visualDistance(): number {
    const r = RANGE[this.mode];
    const u = Math.log(this.d / r.min) / Math.log(r.max / r.min);
    return this.mode === "star" ? 3.2 + 2.2 * u : 1.45 + 1.2 * u;
  }

  private objectPos(): THREE.Vector3 {
    return new THREE.Vector3(0, Math.sin(BETA), -Math.cos(BETA)).multiplyScalar(this.visualDistance());
  }

  /** Where the sight line from Earth through the object meets the background sphere (radius 9). */
  private backgroundHit(t: number): THREE.Vector3 {
    const o = this.objectPos();
    const th = 2 * Math.PI * t;
    const e = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const dir = o.clone().sub(e).normalize();
    const b = e.dot(dir);
    const c = e.lengthSq() - 81;
    const s = -b + Math.sqrt(b * b - c);
    return e.clone().addScaledVector(dir, s);
  }

  private rebuildTrail(): void {
    if (!this.gl) return;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) pts.push(this.backgroundHit((T_MAX * i) / 120).multiplyScalar(0.995));
    this.gl.trail.geometry.dispose();
    this.gl.trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.gl.object.position.copy(this.objectPos());
    this.gl.objLabel.position.copy(this.objectPos()).add(new THREE.Vector3(0.9, 0.35, 0));
  }

  /** Keep EARTH and SUN apart on screen: each label sits on the side facing away from the other body. */
  private placeSunEarthLabels(): void {
    const g = this.gl;
    if (!g) return;
    const w = Math.max(1, this.view.clientWidth);
    const h = Math.max(1, this.view.clientHeight);
    const s = new THREE.Vector3(0, 0, 0).project(g.camera);
    const e = g.earth.position.clone().project(g.camera);
    let ux = (e.x - s.x) * w;
    let uy = (e.y - s.y) * h;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    // A sprite's center is its anchor point in its own box: shifting it moves the text off the body.
    g.earthLabel.center.set(0.5 - 0.62 * ux, 0.5 - 1.25 * uy);
    g.sunLabel.center.set(0.5 + 0.8 * ux, 0.5 + 1.6 * uy);
  }

  private update3d(): void {
    const g = this.gl;
    if (!g) return;
    const th = 2 * Math.PI * this.t;
    const e = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    g.earth.position.copy(e);
    g.earthLabel.position.copy(e);
    const o = this.objectPos();
    const h = this.backgroundHit(this.t);
    g.hit.position.copy(h);
    setSegment(g.near, e, o);
    setSegment(g.far, o, h);
    g.object.rotation.y += 0.01;
  }

  // -- inset (2D canvas) -------------------------------------------------------
  private drawInset(): void {
    const c = this.inset;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const detrend = this.detrend.checked;
    const N = 160;
    const full: Array<[number, number]> = [];
    const wobble: Array<[number, number]> = [];
    const straight: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const t = (T_MAX * i) / N;
      full.push(this.offset(t, !detrend));
      wobble.push(this.offset(t, false));
      straight.push([this.pm * this.dirX * t, this.pm * this.dirY * t]);
    }
    const all = detrend ? full : [...full, ...straight, ...wobble];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of all) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = 38;
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const scale = (Math.min(W, H) - 2 * pad) / span; // pixels of canvas per arcsec
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // east to the left, north up
    const sx = (x: number) => W / 2 - (x - cx) * scale;
    const sy = (y: number) => H / 2 - (y - cy) * scale;

    // SPHEREx pixel grid (only when a pixel is big enough to see)
    const pxC = SPHEREX_PIXEL_ARCSEC * scale;
    if (pxC >= 7) {
      ctx.strokeStyle = "rgba(145,163,180,0.16)";
      ctx.lineWidth = 1;
      const x0 = sx(cx) % pxC;
      const y0 = sy(cy) % pxC;
      for (let x = x0; x < W; x += pxC) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = y0; y < H; y += pxC) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    const poly = (pts: Array<[number, number]>, style: string, width: number, dash: number[]) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (!detrend) {
      poly(wobble, "rgba(88,180,255,0.6)", 1.5, [4, 4]);
      poly(straight, "rgba(255,162,74,0.85)", 1.5, [8, 4]);
    } else {
      poly(wobble, "rgba(88,180,255,0.4)", 1, [4, 4]);
    }
    poly(full, "#ffffff", 2.2, []);

    // start and current positions
    const [x0p, y0p] = this.offset(0, !detrend);
    ctx.fillStyle = "#8a94b4";
    ctx.beginPath();
    ctx.arc(sx(x0p), sy(y0p), 3.5, 0, 7);
    ctx.fill();
    const [xt, yt] = this.offset(this.t, !detrend);
    ctx.fillStyle = "#ffa24a";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(xt), sy(yt), 6, 0, 7);
    ctx.fill();
    ctx.stroke();

    // compass and scale
    ctx.fillStyle = "#ffd23f";
    ctx.font = `10px "Press Start 2P", monospace`;
    ctx.fillText("N UP", W - 52, 22);
    ctx.fillText("E LEFT", 10, 22);
    const bar = SPHEREX_PIXEL_ARCSEC * scale;
    ctx.font = `500 13px "Bricolage Grotesque Variable", system-ui, sans-serif`;
    ctx.fillStyle = "#bcc4dc";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    const label = `1 SPHEREx pixel = ${SPHEREX_PIXEL_ARCSEC}″`;
    if (bar >= 2) ctx.strokeRect(10, H - 16 - Math.min(bar, 60), Math.min(bar, 60), Math.min(bar, 60));
    ctx.fillText(bar >= 2 ? label : `${label} (smaller than a dot here)`, 14 + Math.min(bar, 60), H - 20);
    ctx.fillText(`box spans about ${fmt(span, 2)}″`, 10, H - 4);
  }

  // -- loop -------------------------------------------------------------------
  setActive(on: boolean): void {
    if (this.disposed || on === this.running) return;
    this.running = on;
    if (on) {
      if (!this.reducedMotion && !this.playing && this.t === 0) this.setPlaying(true);
      this.dirty = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.raf);
      this.setPlaying(false);
    }
  }

  private frame = (): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const now = performance.now();
    if (this.playing) {
      this.t = (this.t + ((now - this.last) / 1000) * 0.5) % T_MAX;
      this.updateTimeOut();
      this.dirty = true;
    }
    this.last = now;
    if (this.dirty) {
      this.drawInset();
      this.dirty = false;
    }
    const g = this.gl;
    if (g && this.view.clientWidth > 0) {
      this.update3d();
      g.controls.update();
      this.placeSunEarthLabels();
      g.renderer.render(g.scene, g.camera);
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.setActive(false);
    this.disposed = true;
    const g = this.gl;
    if (g) {
      g.observer.disconnect();
      g.controls.dispose();
      disposeObject(g.scene);
      g.renderer.dispose();
      g.renderer.forceContextLoss();
      g.renderer.domElement.remove();
      this.gl = null;
    }
  }
}
