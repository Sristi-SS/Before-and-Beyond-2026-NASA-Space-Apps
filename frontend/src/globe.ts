// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Scene 1: the sky globe.  A celestial sphere seen from outside (like a desk globe; the real sky is
// its inside surface) with an RA/Dec grid, the ecliptic, the galactic equator, real bright stars,
// pins for the mission targets and markers for every patch that already has a cube.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { BrightStars } from "./api";

const D2R = Math.PI / 180;
// Only the site theme's colours (arcade.css): maze blue, amber and azure for data, yellow stars, white.
const ORANGE = 0xffa24a; // --amber
const BLUE = 0x58b4ff; // --azure
const WALL = 0x2f5bff; // --wall
const OBLIQUITY = 23.4393 * D2R;

/** RA/Dec (degrees) to a point on a sphere of radius r.  y is the north celestial pole; RA grows counter-clockwise seen from the north. */
export function radecToVec(ra: number, dec: number, r = 1): THREE.Vector3 {
  const a = ra * D2R;
  const d = dec * D2R;
  return new THREE.Vector3(r * Math.cos(d) * Math.cos(a), r * Math.sin(d), -r * Math.cos(d) * Math.sin(a));
}

export function vecToRadec(v: THREE.Vector3): { ra: number; dec: number } {
  const n = v.clone().normalize();
  const ra = (Math.atan2(-n.z, n.x) / D2R + 360) % 360;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R };
}

/** Angular separation in degrees. */
export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const a = radecToVec(ra1, dec1);
  const b = radecToVec(ra2, dec2);
  return Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / D2R;
}

export function formatRaDec(ra: number, dec: number): string {
  return `RA ${ra.toFixed(2)}°, Dec ${dec >= 0 ? "+" : "−"}${Math.abs(dec).toFixed(2)}°`;
}

// eq -> gal rotation (J2000); the galactic equator is its transpose applied to (cos l, sin l, 0).
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];

function eqXyzToView(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

function linePoints(fn: (u: number) => THREE.Vector3, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) pts.push(fn(i / n));
  return pts;
}

/** Free every GPU resource under a root (geometries, materials, textures). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const withMap = m as THREE.Material & { map?: THREE.Texture | null };
      withMap.map?.dispose();
      m.dispose();
    }
  });
}

export interface TextSpriteOptions {
  height: number;
  color?: string;
  bold?: boolean;
  /** The site's fonts: "sans" for names, "mono" for numbers, "pixel" for titles. */
  font?: "sans" | "mono" | "pixel";
  /** true: constant size on screen (height is a fraction of the view); false: height in world units. */
  screen?: boolean;
}

const SPRITE_FONTS = {
  sans: `"Nunito Variable", "Segoe UI", system-ui, sans-serif`,
  mono: `"JetBrains Mono Variable", ui-monospace, monospace`,
  pixel: `"Press Start 2P", ui-monospace, monospace`,
};

export function textSprite(text: string, opts: TextSpriteOptions): THREE.Sprite {
  const kind = opts.font ?? "sans";
  // The pixel font is drawn on an 8px grid and is twice as wide as the sans: 24px keeps it crisp and in proportion.
  const px = kind === "pixel" ? 24 : 30;
  const font = `${opts.bold && kind !== "pixel" ? "650 " : ""}${px}px ${SPRITE_FONTS[kind]}`;
  const mat = new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: !(opts.screen ?? true),
  });
  const sprite = new THREE.Sprite(mat);
  const draw = (): void => {
    const canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d")!;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    canvas.width = w;
    canvas.height = 48;
    ctx = canvas.getContext("2d")!;
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = kind === "pixel" ? 7 : 5;
    ctx.strokeStyle = "rgba(4, 6, 14, 0.92)";
    ctx.strokeText(text, 8, 25);
    ctx.fillStyle = opts.color ?? "#cfe0ee";
    ctx.fillText(text, 8, 25);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    // A new texture each time: the canvas may change size once the web font arrives.
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
    sprite.scale.set((opts.height * w) / 48, opts.height, 1);
  };
  draw();
  if (document.fonts && !document.fonts.check(font, text)) {
    document.fonts.load(font, text).then(draw, () => undefined);
  }
  return sprite;
}

function iconTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  draw(canvas.getContext("2d")!, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export interface Pin {
  id: string;
  kind: "target" | "patch";
  label: string;
  ra: number;
  dec: number;
}

interface PinObject {
  pin: Pin;
  dir: THREE.Vector3;
  sprite: THREE.Sprite;
  label: THREE.Sprite | null;
}

export interface GlobeOptions {
  reducedMotion: boolean;
  onPick: (ra: number, dec: number) => void;
  onPin: (pin: Pin) => void;
  onView?: (ra: number, dec: number) => void;
}

// Pixel-art stars: a five-point star and a four-point sparkle (for the brightest), 15 x 15 cells each.
// Only the fill is drawn here; the dark outline is added around it.  y gold, d shade, h highlight, w white.
const STAR_FIVE = [
  "...............",
  ".......y.......",
  ".......y.......",
  "......yhy......",
  "......yhy......",
  ".yyyyyhwhyyyyy.",
  "..yyyyhhhyyyd..",
  "...yyyyhyyyd...",
  "....yyyyyydd...",
  "....yyyyyydd...",
  "...yyyy.yyddd..",
  "...yyy...yddd..",
  "..yyy.....ddd..",
  "...............",
  "...............",
];
const STAR_GRID = 15;

function sparkleCell(x: number, y: number): string {
  const dx = Math.abs(x - 7);
  const dy = Math.abs(y - 7);
  const d = dx + dy;
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  // A gold body that tapers into four long rays: three cells wide near the middle, one cell at the tips.
  const inside = d <= 3 || (lo === 0 && hi <= 6) || (lo === 1 && hi <= 4);
  if (!inside) return ".";
  if (d <= 1) return "w";
  if (d <= 2) return "h";
  return x > 7 || y > 7 ? "d" : "y";
}

function starAtlas(): THREE.CanvasTexture {
  const n = STAR_GRID;
  const canvas = document.createElement("canvas");
  canvas.width = 2 * n;
  canvas.height = n;
  const c = canvas.getContext("2d")!;
  // Title yellow (--title) with its purple shadow (--title-shadow) as the outline.
  const ink: Record<string, string> = { y: "#ffd23f", d: "#e0a800", h: "#ffe98a", w: "#ffffff" };
  const shapes = [
    (x: number, y: number) => STAR_FIVE[y][x],
    sparkleCell,
  ];
  shapes.forEach((cell, k) => {
    const filled = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && cell(x, y) !== ".";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = cell(x, y);
        if (v !== ".") c.fillStyle = ink[v];
        else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) c.fillStyle = "#3a2aa6";
        else continue;
        c.fillRect(k * n + x, y, 1, 1);
      }
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // sampled and written as drawn
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

const STAR_VERT = `
attribute float size;
attribute float aShape;
uniform float uPR;
varying float vShape;
varying float vA;
void main() {
  vShape = aShape;
  float f = dot(normalize(position), normalize(cameraPosition));
  vA = mix(0.25, 1.0, smoothstep(-0.15, 0.25, f));
  // Whole multiples of the 15-cell grid, so every star pixel lands on screen pixels.
  gl_PointSize = 15.0 * max(1.0, floor(size * uPR / 15.0 + 0.5));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = `
uniform sampler2D uTex;
varying float vShape;
varying float vA;
void main() {
  vec2 uv = vec2((min(gl_PointCoord.x, 0.999) + vShape) * 0.5, 1.0 - gl_PointCoord.y);
  vec4 t = texture2D(uTex, uv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb, vA);
}`;

/** Where a star's name may sit, as sprite anchors: under the star, above it, to its right, to its left. */
const LABEL_SPOTS: Array<[number, number]> = [[0.5, 1.55], [0.5, -0.55], [-0.12, 0.5], [1.12, 0.5]];
const LABEL_SPOT = new WeakMap<THREE.Sprite, number>();

export class Globe {
  static supported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly starTex = starAtlas();
  /** Thick lines (ecliptic, galactic equator) need the view size in pixels. */
  private readonly fatLines: LineMaterial[] = [];
  private readonly pinTex: THREE.CanvasTexture;
  private readonly tileTex: THREE.CanvasTexture;
  private readonly markTex: THREE.CanvasTexture;
  private readonly pinGroup = new THREE.Group();
  private readonly starGroup = new THREE.Group();
  /** Star names, brightest first: a name that would overlap a brighter one is hidden, leaving just the star. */
  private starLabels: Array<{ sprite: THREE.Sprite; dir: THREE.Vector3 }> = [];
  /** Labels that always win a collision: the two sky lines. */
  private lineLabels: Array<{ sprite: THREE.Sprite; dir: THREE.Vector3 }> = [];
  private pins: PinObject[] = [];
  private mark: THREE.Sprite;
  private raf = 0;
  private running = false;
  private disposed = false;
  private down: { x: number; y: number; t: number } | null = null;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t0: number; ms: number; done?: () => void } | null = null;
  private lastView = 0;

  constructor(private readonly container: HTMLElement, private readonly opts: GlobeOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    const start = radecToVec(200, 25).multiplyScalar(3.1);
    this.camera.position.copy(start);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 6;
    this.controls.autoRotate = !opts.reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
    });

    // A faint body so the sphere reads as a solid ball.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.995, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x02030c, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.scene.add(body);

    this.buildGrid();

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uPR: { value: this.renderer.getPixelRatio() }, uTex: { value: this.starTex } },
    });
    this.scene.add(this.starGroup, this.pinGroup);

    this.pinTex = iconTexture((c, s) => {
      c.strokeStyle = "#ffa24a";
      c.lineWidth = 6;
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(s / 2, 4);
      c.lineTo(s / 2, s * 0.28);
      c.moveTo(s / 2, s * 0.72);
      c.lineTo(s / 2, s - 4);
      c.moveTo(4, s / 2);
      c.lineTo(s * 0.28, s / 2);
      c.moveTo(s * 0.72, s / 2);
      c.lineTo(s - 4, s / 2);
      c.stroke();
    });
    this.tileTex = iconTexture((c, s) => {
      c.fillStyle = "#58b4ff";
      c.fillRect(s * 0.22, s * 0.22, s * 0.56, s * 0.56);
      c.strokeStyle = "#ffffff";
      c.lineWidth = 5;
      c.strokeRect(s * 0.22, s * 0.22, s * 0.56, s * 0.56);
    });
    this.markTex = iconTexture((c, s) => {
      c.strokeStyle = "#ffffff";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(s / 2, 6);
      c.lineTo(s / 2, s - 6);
      c.moveTo(6, s / 2);
      c.lineTo(s - 6, s / 2);
      c.stroke();
      c.strokeStyle = "#ffa24a";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
      c.stroke();
    });
    this.mark = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.markTex, transparent: true, depthTest: false, sizeAttenuation: false }),
    );
    this.mark.scale.set(0.05, 0.05, 1);
    this.mark.visible = false;
    this.scene.add(this.mark);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointermove", this.onMove);
    container.addEventListener("keydown", this.onKey);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  // -- scene content -------------------------------------------------------
  private buildGrid(): void {
    const grid = new THREE.Group();
    const gridMat = new THREE.LineBasicMaterial({ color: WALL, transparent: true, opacity: 0.3, depthWrite: false });
    const eqMat = new THREE.LineBasicMaterial({ color: WALL, transparent: true, opacity: 0.75, depthWrite: false });
    for (let ra = 0; ra < 360; ra += 30) {
      const pts = linePoints((u) => radecToVec(ra, -90 + 180 * u), 60);
      grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let dec = -75; dec <= 75; dec += 15) {
      const pts = linePoints((u) => radecToVec(360 * u, dec), 120);
      grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dec === 0 ? eqMat : gridMat));
    }
    // Ecliptic (orange) and galactic equator (blue, dashed): two faint lines told apart by dash as well as colour.
    const ecl = linePoints((u) => {
      const l = 2 * Math.PI * u;
      return eqXyzToView(Math.cos(l), Math.sin(l) * Math.cos(OBLIQUITY), Math.sin(l) * Math.sin(OBLIQUITY));
    }, 180);
    grid.add(this.fatLine(ecl, ORANGE, false));
    const gal = linePoints((u) => {
      const l = 2 * Math.PI * u;
      const g = [Math.cos(l), Math.sin(l), 0];
      const x = EQ2GAL[0][0] * g[0] + EQ2GAL[1][0] * g[1];
      const y = EQ2GAL[0][1] * g[0] + EQ2GAL[1][1] * g[1];
      const z = EQ2GAL[0][2] * g[0] + EQ2GAL[1][2] * g[1];
      return eqXyzToView(x, y, z);
    }, 180);
    grid.add(this.fatLine(gal, BLUE, true));
    this.scene.add(grid);

    // Labels: RA every 2 h on the equator, in the site's mono, Dec every 30 degrees on the RA 0 meridian, line names.
    const labels = new THREE.Group();
    for (let ra = 0; ra < 360; ra += 30) {
      const s = textSprite(`${ra / 15}h`, { height: 0.026, color: "#8a94b4", font: "mono" });
      s.position.copy(radecToVec(ra, 0, 1.03));
      labels.add(s);
    }
    for (const dec of [-60, -30, 30, 60]) {
      const s = textSprite(`${dec > 0 ? "+" : "−"}${Math.abs(dec)}°`, { height: 0.026, color: "#8a94b4", font: "mono" });
      s.position.copy(radecToVec(15, dec, 1.03));
      labels.add(s);
    }
    const eclLabel = textSprite("ECLIPTIC", { height: 0.03, color: "#ffa24a", font: "pixel" });
    eclLabel.position.copy(eqXyzToView(Math.cos(1.9), Math.sin(1.9) * Math.cos(OBLIQUITY), Math.sin(1.9) * Math.sin(OBLIQUITY)).multiplyScalar(1.04));
    const galLabel = textSprite("GALACTIC EQUATOR", { height: 0.03, color: "#58b4ff", font: "pixel" });
    const lg = 0.75;
    const gx = [Math.cos(lg), Math.sin(lg), 0];
    galLabel.position.copy(eqXyzToView(
      EQ2GAL[0][0] * gx[0] + EQ2GAL[1][0] * gx[1],
      EQ2GAL[0][1] * gx[0] + EQ2GAL[1][1] * gx[1],
      EQ2GAL[0][2] * gx[0] + EQ2GAL[1][2] * gx[1],
    ).multiplyScalar(1.04));
    labels.add(eclLabel, galLabel);
    this.lineLabels = [eclLabel, galLabel].map((sprite) => ({ sprite, dir: sprite.position.clone().normalize() }));
    this.scene.add(labels);
  }

  /** A thick line along the sphere (WebGL's own lines are always one pixel wide). */
  private fatLine(pts: THREE.Vector3[], color: number, dashed: boolean): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color, linewidth: 3, transparent: true, opacity: 0.95, depthWrite: false,
      dashed, dashSize: 0.045, gapSize: 0.03,
    });
    this.fatLines.push(mat);
    const line = new Line2(geo, mat);
    if (dashed) line.computeLineDistances();
    return line;
  }

  /** Real bright stars (see /api/sky/bright_stars).  Replaces any earlier set. */
  setStars(data: BrightStars): void {
    for (const child of [...this.starGroup.children]) {
      disposeObject(child);
      this.starGroup.remove(child);
    }
    const n = data.stars.length;
    const pos = new Float32Array(n * 3);
    const shape = new Float32Array(n);
    const size = new Float32Array(n);
    data.stars.forEach((s, i) => {
      const v = radecToVec(s.ra_deg, s.dec_deg, 1.0);
      pos.set([v.x, v.y, v.z], i * 3);
      // The brightest stars twinkle as four-point sparkles; the rest are five-point stars.
      shape[i] = s.mag < 0.5 ? 1 : 0;
      size[i] = s.mag < 0.5 ? 30 : s.mag < 1.2 ? 22 : 15;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aShape", new THREE.BufferAttribute(shape, 1));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    // The material is shared and disposed with the globe, not with the points.
    this.starGroup.add(new THREE.Points(geo, this.starMat));
    this.starLabels = [];
    for (const s of [...data.stars].sort((a, b) => a.mag - b.mag)) {
      if (!s.name || s.mag > 2.1) continue;
      const label = textSprite(s.name, { height: 0.024, color: "#e6eaf7", font: "sans" });
      // Centred under the star, with a small gap below the star picture.
      label.center.set(0.5, 1.55);
      label.position.copy(radecToVec(s.ra_deg, s.dec_deg, 1.0));
      this.starGroup.add(label);
      this.starLabels.push({ sprite: label, dir: label.position.clone().normalize() });
    }
  }

  setPins(pins: Pin[]): void {
    for (const p of this.pins) {
      this.pinGroup.remove(p.sprite);
      (p.sprite.material as THREE.Material).dispose();
      if (p.label) {
        this.pinGroup.remove(p.label);
        disposeObject(p.label);
      }
    }
    this.pins = pins.map((pin) => {
      const target = pin.kind === "target";
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: target ? this.pinTex : this.tileTex,
          transparent: true,
          depthTest: false,
          sizeAttenuation: false,
        }),
      );
      const s = target ? 0.05 : 0.036;
      sprite.scale.set(s, s, 1);
      const dir = radecToVec(pin.ra, pin.dec, 1);
      sprite.position.copy(dir).multiplyScalar(1.004);
      this.pinGroup.add(sprite);
      let label: THREE.Sprite | null = null;
      if (target) {
        label = textSprite(pin.label, { height: 0.026, color: "#ffd23f", font: "pixel" });
        label.center.set(-0.08, 0.5);
        label.position.copy(dir).multiplyScalar(1.004);
        this.pinGroup.add(label);
      }
      return { pin, dir, sprite, label };
    });
  }

  setMarker(ra: number | null, dec: number | null): void {
    if (ra === null || dec === null) {
      this.mark.visible = false;
      return;
    }
    this.mark.position.copy(radecToVec(ra, dec, 1.004));
    this.mark.visible = true;
  }

  // -- camera --------------------------------------------------------------
  viewCentre(): { ra: number; dec: number } {
    return vecToRadec(this.camera.position);
  }

  /** Rotate the view by `dAz` degrees around the polar axis and `dEl` degrees towards the pole. */
  nudge(dAz: number, dEl: number): void {
    this.controls.autoRotate = false;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position);
    sph.theta -= dAz * D2R;
    sph.phi = Math.max(0.12, Math.min(Math.PI - 0.12, sph.phi - dEl * D2R));
    this.camera.position.setFromSpherical(sph);
    this.camera.lookAt(0, 0, 0);
  }

  zoom(factor: number): void {
    this.controls.autoRotate = false;
    const d = this.camera.position.length() * factor;
    this.camera.position.setLength(Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, d)));
  }

  /** Turn the globe to face RA/Dec.  With `dive` the camera also moves in close.  Instant when motion is reduced. */
  flyTo(ra: number, dec: number, dive: boolean, done?: () => void): void {
    this.controls.autoRotate = false;
    const to = radecToVec(ra, dec).normalize();
    const d1 = dive ? 1.55 : Math.min(2.4, this.camera.position.length());
    if (this.opts.reducedMotion || !this.running) {
      this.camera.position.copy(to).multiplyScalar(d1);
      this.camera.lookAt(0, 0, 0);
      done?.();
      return;
    }
    this.anim = {
      from: this.camera.position.clone().normalize(),
      to,
      d0: this.camera.position.length(),
      d1,
      t0: performance.now(),
      ms: dive ? 900 : 700,
      done,
    };
  }

  // -- input ---------------------------------------------------------------
  private onDown = (ev: PointerEvent): void => {
    this.down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  };

  private onUp = (ev: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const pin = this.pinAt(px, py);
    if (pin) {
      this.opts.onPin(pin.pin);
      return;
    }
    const hit = this.sphereAt(px, py, rect);
    if (hit) {
      const { ra, dec } = vecToRadec(hit);
      this.opts.onPick(ra, dec);
    }
  };

  private onMove = (ev: PointerEvent): void => {
    if (ev.buttons) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pin = this.pinAt(ev.clientX - rect.left, ev.clientY - rect.top);
    this.renderer.domElement.style.cursor = pin ? "pointer" : "crosshair";
    this.renderer.domElement.title = pin ? pin.pin.label : "";
  };

  private onKey = (ev: KeyboardEvent): void => {
    const step = ev.shiftKey ? 2 : 10;
    let handled = true;
    switch (ev.key) {
      case "ArrowLeft": this.nudge(-step, 0); break;
      case "ArrowRight": this.nudge(step, 0); break;
      case "ArrowUp": this.nudge(0, step); break;
      case "ArrowDown": this.nudge(0, -step); break;
      case "+": case "=": this.zoom(0.85); break;
      case "-": case "_": this.zoom(1 / 0.85); break;
      case "Enter": case " ": {
        const c = this.viewCentre();
        this.opts.onPick(c.ra, c.dec);
        break;
      }
      default: handled = false;
    }
    if (handled) ev.preventDefault();
  };

  private sphereAt(px: number, py: number, rect: DOMRect): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
  }

  private pinAt(px: number, py: number): PinObject | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const camDir = this.camera.position.clone().normalize();
    let best: PinObject | null = null;
    let bestD = 20;
    for (const p of this.pins) {
      if (p.dir.dot(camDir) < 0.05) continue;
      const v = p.dir.clone().project(this.camera);
      const d = Math.hypot((v.x * 0.5 + 0.5) * rect.width - px, (-v.y * 0.5 + 0.5) * rect.height - py);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Screen box of a label sprite, in CSS pixels (y down). */
  private labelBox(sprite: THREE.Sprite, dir: THREE.Vector3, w: number, h: number): [number, number, number, number] {
    const v = dir.clone().project(this.camera);
    const px = (v.x * 0.5 + 0.5) * w;
    const py = (-v.y * 0.5 + 0.5) * h;
    // Screen-sized sprites: scale is a fraction of the view through the projection.
    const e = this.camera.projectionMatrix.elements;
    const bw = (sprite.scale.x * e[0] * w) / 2;
    const bh = (sprite.scale.y * e[5] * h) / 2;
    const left = px - sprite.center.x * bw;
    const top = py - (1 - sprite.center.y) * bh;
    return [left, top, left + bw, top + bh];
  }

  /** Show each star's name unless it would overlap a name already shown; the star itself always stays. */
  private placeStarLabels(camDir: THREE.Vector3): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const taken: Array<[number, number, number, number]> = [];
    const pad = 3;
    const hits = (b: [number, number, number, number]): boolean =>
      taken.some((t) => b[0] < t[2] + pad && b[2] + pad > t[0] && b[1] < t[3] + pad && b[3] + pad > t[1]);
    for (const p of this.pins) {
      if (p.label && p.dir.dot(camDir) > -0.02) taken.push(this.labelBox(p.label, p.dir, w, h));
    }
    for (const l of this.lineLabels) taken.push(this.labelBox(l.sprite, l.dir, w, h));
    for (const s of this.starLabels) {
      let show = s.dir.dot(camDir) > -0.02; // same far-side cut-off as the pins
      if (show) {
        // Under the star if there is room; otherwise above it, then right, then left.  The place used
        // last time is tried first, so a name does not hop about while the globe turns.
        show = false;
        const first = LABEL_SPOT.get(s.sprite) ?? 0;
        for (let k = 0; k < LABEL_SPOTS.length && !show; k++) {
          const spot = (first + k) % LABEL_SPOTS.length;
          s.sprite.center.set(LABEL_SPOTS[spot][0], LABEL_SPOTS[spot][1]);
          const box = this.labelBox(s.sprite, s.dir, w, h);
          if (!hits(box)) {
            taken.push(box);
            LABEL_SPOT.set(s.sprite, spot);
            show = true;
          }
        }
      }
      s.sprite.visible = show;
    }
  }

  // -- loop ----------------------------------------------------------------
  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.fatLines) m.resolution.set(w, h);
  }

  /** Start or stop the render loop.  A hidden scene must not draw. */
  setActive(on: boolean): void {
    if (this.disposed || on === this.running) return;
    this.running = on;
    if (on) {
      this.resize();
      this.raf = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.raf);
    }
  }

  private frame = (): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden || this.container.clientWidth === 0) return;
    if (this.anim) {
      const a = this.anim;
      const k = Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const dir = new THREE.Quaternion().slerpQuaternions(
        new THREE.Quaternion(),
        new THREE.Quaternion().setFromUnitVectors(a.from, a.to),
        e,
      );
      this.camera.position.copy(a.from).applyQuaternion(dir).multiplyScalar(a.d0 + (a.d1 - a.d0) * e);
      this.camera.lookAt(0, 0, 0);
      if (k >= 1) {
        this.anim = null;
        a.done?.();
      }
    }
    this.controls.update();
    // dim pins that are on the far side
    const camDir = this.camera.position.clone().normalize();
    for (const p of this.pins) {
      const front = p.dir.dot(camDir) > -0.02;
      (p.sprite.material as THREE.SpriteMaterial).opacity = front ? 1 : 0.22;
      if (p.label) (p.label.material as THREE.SpriteMaterial).opacity = front ? 1 : 0;
    }
    this.placeStarLabels(camDir);
    this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    if (this.opts.onView && now - this.lastView > 250) {
      this.lastView = now;
      const c = this.viewCentre();
      this.opts.onView(c.ra, c.dec);
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.setActive(false);
    this.disposed = true;
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("keydown", this.onKey);
    this.controls.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose();
        m.dispose();
      }
    });
    this.starMat.dispose();
    this.starTex.dispose();
    this.pinTex.dispose();
    this.tileTex.dispose();
    this.markTex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
