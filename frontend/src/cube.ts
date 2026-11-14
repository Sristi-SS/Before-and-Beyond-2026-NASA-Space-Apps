// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { autoStretch, percentile, sliceTextureCanvas } from "./colormap";

export interface CubeSlice {
  data: Float32Array;
  label: string;
  sublabel: string;
}

const PLANE = 2.0;          // side of one image in scene units
const LENGTH = 5.4;         // length of the whole stack along the time axis
const FIRST = new THREE.Color(0x58b4ff);   // first image in the stack: blue
const MID = new THREE.Color(0xe9e6ff);
const LAST = new THREE.Color(0xffa24a);    // last image in the stack: orange
const LABEL_FONT = '"JetBrains Mono Variable", ui-monospace, Consolas, monospace';

/** Blue for the first image, orange for the last (never red and green). */
function tint(i: number, n: number): THREE.Color {
  const t = n > 1 ? i / (n - 1) : 0.5;
  return t < 0.5 ? FIRST.clone().lerp(MID, t * 2) : MID.clone().lerp(LAST, (t - 0.5) * 2);
}

/**
 * One image as "light only": the dark sky is transparent and only what is brighter
 * than the background is kept.  Stacked with additive blending, a fixed star becomes a
 * straight row of dots through time and a mover becomes a slanted row.
 */
function glowCanvas(data: Float32Array, npix: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = npix;
  canvas.height = npix;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(npix, npix);
  const finite: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 20000));
  for (let i = 0; i < data.length; i += stride) if (Number.isFinite(data[i])) finite.push(data[i]);
  const lo = percentile(finite, 70);                       // sky level and its noise are cut away
  const hi = Math.max(percentile(finite, 99.8), lo + 1e-6);
  for (let y = 0; y < npix; y++) {
    const src = (npix - 1 - y) * npix;                     // row 0 of the data is the south edge
    for (let x = 0; x < npix; x++) {
      const v = data[src + x];
      const t = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
      const o = (y * npix + x) * 4;
      image.data[o] = 255;
      image.data[o + 1] = 255;
      image.data[o + 2] = 255;
      image.data[o + 3] = Math.round(255 * Math.pow(t, 0.75));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function textSprite(lines: Array<{ text: string; size: number; weight: number; color: string }>): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "middle";
  let y = lines.length === 1 ? 128 : 84;
  for (const line of lines) {
    ctx.font = `${line.weight} ${line.size}px ${LABEL_FONT}`;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, 12, y);
    y += 92;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;                         // sharp at every distance
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.center.set(0, 0.5);                              // the text starts at the sprite's position
  sprite.scale.set(2.2, 0.55, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/**
 * The time cube: the images of one sky patch stacked along the time axis.
 * The image on the timeline is drawn in full; every other image shows only its
 * light, so you can look through the stack.  The camera is not used for any
 * science result: it only helps the visitor read the cube.
 */
export class CubeView {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly glowGroup = new THREE.Group();
  private readonly labelGroup = new THREE.Group();
  private readonly guides = new THREE.Group();
  private readonly activePlane: THREE.Mesh;
  private readonly activeFrame: THREE.LineLoop;
  private activeLabel: THREE.Sprite | null = null;

  private slices: CubeSlice[] = [];
  private npix = 128;
  private glows: THREE.Mesh[] = [];
  private fullTextures = new Map<number, THREE.Texture>();
  private gap = 0;
  private depth = 0;
  private active = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
    this.camera.position.set(5, 3, 6);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 40;
    // A slow turn until the visitor takes hold of the cube (not with reduced motion).
    this.controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
    });

    this.activePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE, PLANE),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    );
    this.activePlane.renderOrder = 0;                      // drawn first; images behind it are hidden by it
    const h = PLANE / 2;
    this.activeFrame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.activeFrame.renderOrder = 4;
    this.activePlane.visible = false;
    this.activeFrame.visible = false;
    this.scene.add(this.guides, this.activePlane, this.glowGroup, this.activeFrame, this.labelGroup);

    const render = (): void => {
      // Draw nothing while another view hides the cube (saves battery).
      if (this.container.clientWidth > 0) {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    // Labels drawn before the font arrived use a fallback font: draw them again.
    void document.fonts?.load(`600 44px ${LABEL_FONT}`).then(() => {
      if (this.slices.length) this.buildLabels();
    });
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private z(i: number): number {
    return (i - (this.slices.length - 1) / 2) * this.gap;
  }

  private static clear(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const obj = child as THREE.Mesh;
      obj.geometry?.dispose();
      const material = obj.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      material?.map?.dispose();
      material?.dispose();
    }
  }

  /**
   * Replace the stack.  With `reframe` false the camera stays where the
   * visitor put it (used while a job is still adding frames).
   */
  setSlices(slices: CubeSlice[], npix: number, reframe = true): void {
    const wasEmpty = this.slices.length === 0;
    CubeView.clear(this.glowGroup);
    CubeView.clear(this.guides);
    for (const texture of this.fullTextures.values()) texture.dispose();
    this.fullTextures.clear();
    this.slices = slices;
    this.npix = npix;
    this.glows = [];

    const n = slices.length;
    this.gap = n > 1 ? Math.min(0.6, Math.max(0.07, LENGTH / (n - 1))) : 0;
    this.depth = Math.max(0, (n - 1) * this.gap);
    // Many images: each one adds less light, so the stack does not wash out.
    const strength = Math.min(0.95, Math.max(0.42, 11 / Math.max(1, n)));

    const plane = new THREE.PlaneGeometry(PLANE, PLANE);
    slices.forEach((slice, i) => {
      const texture = new THREE.CanvasTexture(glowCanvas(slice.data, npix));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;             // real pixels stay sharp squares, not a blur
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: tint(i, n),
        transparent: true,
        opacity: strength,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(plane, material);
      mesh.position.z = this.z(i);
      mesh.renderOrder = 2;
      this.glows.push(mesh);
      this.glowGroup.add(mesh);
    });

    // Thin outline of every image, so the stack reads as a stack; and the time axis.
    const h = PLANE / 2;
    const pts: number[] = [];
    const cols: number[] = [];
    slices.forEach((_, i) => {
      const z = this.z(i);
      const c = tint(i, n);
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        pts.push(a[0], a[1], z, b[0], b[1], z);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    });
    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    outlineGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    this.guides.add(new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: n > 40 ? 0.1 : 0.2, depthWrite: false }),
    ));
    if (n > 1) {
      const axis = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(h, -h, this.z(0)), new THREE.Vector3(h, -h, this.z(n - 1) + 0.35),
      ]);
      this.guides.add(new THREE.Line(axis, new THREE.LineBasicMaterial({ color: 0xa9b2cc, transparent: true, opacity: 0.7 })));
    }

    this.buildLabels();
    this.activePlane.visible = n > 0;
    this.activeFrame.visible = n > 0;
    this.active = -1;
    this.setActive(0);
    if (reframe || wasEmpty) this.frameCamera();
  }

  /** Date labels along the time axis (about eight of them), with a tick each. */
  private buildLabels(): void {
    CubeView.clear(this.labelGroup);
    this.activeLabel = null;
    const n = this.slices.length;
    if (n === 0) return;
    const h = PLANE / 2;
    const stride = Math.max(1, Math.ceil(n / 7));
    const ticks: THREE.Vector3[] = [];
    this.slices.forEach((slice, i) => {
      if (i % stride !== 0 && i !== n - 1) return;
      if (i === n - 1 && (n - 1) % stride !== 0 && (n - 1) % stride < stride / 2) return;   // too close to the one before
      const sprite = textSprite([{ text: slice.label, size: 76, weight: 500, color: "#c3cae0" }]);
      sprite.scale.set(1.25, 0.3125, 1);
      sprite.position.set(h + 0.22, -h, this.z(i));
      this.labelGroup.add(sprite);
      ticks.push(new THREE.Vector3(h, -h, this.z(i)), new THREE.Vector3(h + 0.16, -h, this.z(i)));
    });
    this.labelGroup.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(ticks),
      new THREE.LineBasicMaterial({ color: 0xa9b2cc, transparent: true, opacity: 0.7 }),
    ));
    this.placeActiveLabel();
  }

  private placeActiveLabel(): void {
    if (this.activeLabel) {
      this.labelGroup.remove(this.activeLabel);
      this.activeLabel.material.map?.dispose();
      this.activeLabel.material.dispose();
      this.activeLabel = null;
    }
    const slice = this.slices[this.active];
    if (!slice) return;
    const sprite = textSprite([
      { text: slice.label, size: 84, weight: 700, color: "#ffffff" },
      { text: slice.sublabel, size: 52, weight: 400, color: "#c3cae0" },
    ]);
    sprite.scale.set(1.9, 0.475, 1);
    sprite.position.set(-PLANE / 2, PLANE / 2 + 0.3, this.z(this.active));
    this.activeLabel = sprite;
    this.labelGroup.add(sprite);
  }

  setActive(index: number): void {
    const n = this.slices.length;
    if (n === 0) return;
    const next = Math.max(0, Math.min(n - 1, index));
    if (next === this.active) return;
    this.active = next;
    this.glows.forEach((mesh, i) => {
      mesh.visible = i !== next;                            // the active image is drawn in full instead
    });
    let texture = this.fullTextures.get(next);
    if (!texture) {
      const slice = this.slices[next];
      texture = new THREE.CanvasTexture(sliceTextureCanvas(slice.data, this.npix, autoStretch(slice.data)));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      this.fullTextures.set(next, texture);
    }
    const material = this.activePlane.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;
    this.activePlane.position.z = this.z(next);
    this.activeFrame.position.z = this.z(next);
    this.placeActiveLabel();
  }

  private frameCamera(): void {
    const radius = Math.max(PLANE * 3.4, this.depth * 1.42 + PLANE * 1.9);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(new THREE.Vector3(1.0, 0.42, 0.72).normalize().multiplyScalar(radius));
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }
}
