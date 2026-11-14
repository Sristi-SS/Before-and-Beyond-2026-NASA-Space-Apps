// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Candidate search panel: ranked possible movers, their motion path, and where each one
// is predicted to be in every other image.  Everything here is a candidate, never a detection.
import * as api from "./api";
import { showTab } from "./shell";

export interface CandidateContext {
  jobKey: () => string | null;
  /** Detector of the band on screen; 0 = All bands (no search). */
  group: () => number;
  span: () => number;
  step: () => number;
  simActive: () => boolean;
  npix: () => number;
  /** `index` of the frame on screen (the job's frame index), or null. */
  frameIndex: () => number | null;
  blinkCanvas: HTMLCanvasElement;
  /** Put this motion into the tilt and run it. */
  onPick: (c: api.Candidate) => void;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

const fmtSky = (ra: number | null, dec: number | null): string =>
  ra === null || dec === null ? "n/a" : `${ra.toFixed(4)}°, ${dec >= 0 ? "+" : ""}${dec.toFixed(4)}°`;

function bandName(detector: number): string {
  return detector === 101 ? "W1" : detector === 102 ? "W2" : `D${detector}`;
}

export class CandidatePanel {
  private readonly run = el<HTMLButtonElement>("cand-run");
  private readonly status = el<HTMLElement>("cand-status");
  private readonly list = el<HTMLOListElement>("cand-list");
  private readonly detail = el<HTMLElement>("cand-detail");
  private readonly model = el<HTMLElement>("cand-model");
  private readonly overlay = document.createElement("canvas");
  private result: api.CandidateResult | null = null;
  private picked: api.Candidate | null = null;
  private request = 0;

  constructor(private readonly ctx: CandidateContext) {
    this.overlay.className = "pred-overlay";
    this.overlay.hidden = true;
    this.overlay.setAttribute("aria-hidden", "true");
    ctx.blinkCanvas.parentElement?.appendChild(this.overlay);
    this.run.addEventListener("click", () => void this.search());
    new ResizeObserver(() => this.draw()).observe(ctx.blinkCanvas);
    window.addEventListener("resize", () => this.draw());
  }

  /** The cube, the band or the simulator changed: old results no longer apply. */
  reset(): void {
    this.request++;
    this.result = null;
    this.picked = null;
    this.list.replaceChildren();
    this.detail.hidden = true;
    this.model.textContent = "";
    const ok = !!this.ctx.jobKey() && this.ctx.group() !== 0 && !this.ctx.simActive();
    this.run.disabled = !ok;
    this.status.textContent = !this.ctx.jobKey()
      ? "Build or open a cube first."
      : this.ctx.simActive()
        ? "The search uses real images only. Turn the simulator off to use it."
        : this.ctx.group() === 0
          ? "Pick one band in the Frames tab. SPHEREx and WISE units differ, so All bands is not searched."
          : "";
    this.draw();
  }

  /** The frame on screen changed: move the predicted-position ring. */
  frameChanged(): void {
    this.draw();
    this.markRow();
  }

  private async search(): Promise<void> {
    const key = this.ctx.jobKey();
    const group = this.ctx.group();
    if (!key || group === 0) return;
    const request = ++this.request;
    this.run.disabled = true;
    this.status.textContent = "Trying many motions and ranking the best ones…";
    try {
      const result = await api.fetchCandidates(key, group, this.ctx.span(), this.ctx.step());
      if (request !== this.request) return;
      this.result = result;
      this.render();
    } catch (error) {
      if (request === this.request) this.status.textContent = (error as Error).message.replace(/^\d+ [^—]*— /, "").replace(/^\{"detail":"|"\}$/g, "");
    } finally {
      if (request === this.request) this.run.disabled = false;
    }
  }

  private render(): void {
    const r = this.result;
    if (!r) return;
    this.list.replaceChildren();
    if (r.candidates.length === 0) {
      this.status.textContent = "No candidates in this band.";
      return;
    }
    this.status.textContent =
      `${r.candidates.length} candidates from ${r.n_frames} images. Score at zero motion: ${r.zero_score.toFixed(1)}. ${r.caution}`;
    this.model.textContent =
      `Shape check: ${r.model.name}, a small model (${r.model.parameters} numbers) trained on ${r.model.trained_on}. ` +
      `It scores ${(r.model.validation_accuracy_on_simulated * 100).toFixed(0)}% on simulated test patches. ${r.model.note}`;
    for (const c of r.candidates) {
      const li = node("li");
      const b = node("button", "cand");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label",
        `Candidate ${c.rank}: ${c.vx} east, ${c.vy} north arcseconds per year, score ${c.score}`);
      const arrow = node("span", "cand-arrow", "↑");
      arrow.style.transform = `rotate(${-c.pa_deg}deg)`; // east is to the left on the sky
      arrow.title = `Direction on the sky (north up, east left): position angle ${c.pa_deg}°`;
      const v = node("span", "cand-v", `${c.vx.toFixed(1)} E, ${c.vy.toFixed(1)} N ″/yr `);
      v.appendChild(arrow);
      const bar = node("span", "cand-bar");
      const fill = node("i");
      fill.style.width = `${Math.round(c.patch_score * 100)}%`;
      bar.appendChild(fill);
      const sub = node("span", "cand-sub");
      sub.append(node("span", "", "shape"), bar, node("span", "", c.patch_score.toFixed(2)));
      b.append(node("span", "cand-rank", String(c.rank)), v, node("span", "cand-score", c.score.toFixed(1)), sub);
      b.addEventListener("click", () => this.pick(c, b));
      li.appendChild(b);
      this.list.appendChild(li);
    }
  }

  private pick(c: api.Candidate, button: HTMLButtonElement): void {
    this.picked = c;
    for (const b of this.list.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
    this.ctx.onPick(c);
    this.renderDetail(c);
    this.draw();
  }

  private renderDetail(c: api.Candidate): void {
    const d = this.detail;
    d.replaceChildren();
    d.hidden = false;
    const shape = c.patch_score >= 0.7 ? "looks like a point source" : c.patch_score >= 0.4 ? "is unclear" : "does not look like a point source";
    const facts = node("dl", "provenance");
    const add = (k: string, v: string): void => { facts.append(node("dt", "", k), node("dd", "", v)); };
    add("Motion", `${c.speed_arcsec_yr.toFixed(2)} ″/yr toward ${c.pa_deg.toFixed(0)}°`);
    add("Stack position", fmtSky(c.ra_deg, c.dec_deg));
    add("Score", c.ratio !== null ? `${c.score.toFixed(1)} (${c.ratio.toFixed(2)}× no motion)` : c.score.toFixed(1));
    add("Shape check", `${c.patch_score.toFixed(2)}: ${shape}`);
    add("Predicted today", `${fmtSky(c.today.ra_deg, c.today.dec_deg)}${c.today.inside ? "" : " (outside this field)"}`);

    const table = node("table", "cand-table");
    const head = node("tr");
    for (const h of ["Date", "Band", "x, y", "In stack"]) head.appendChild(node("th", "", h));
    table.appendChild(head);
    for (const p of c.path) {
      const tr = node("tr", p.inside ? "" : "out");
      tr.dataset.index = String(p.index);
      tr.append(
        node("td", "", p.obs_time.slice(0, 10)),
        node("td", "", bandName(p.detector)),
        node("td", "", p.inside ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}` : "outside"),
        node("td", "", p.used ? "yes" : "no"),
      );
      table.appendChild(tr);
    }
    const wrap = node("div", "cand-table-wrap");
    wrap.appendChild(table);
    const open = node("button", "ghost", "Show the stack (Tilt tab)");
    open.type = "button";
    open.addEventListener("click", () => showTab("dock-tilt", "tilt"));
    d.append(
      node("h3", "", `Candidate ${c.rank}`),
      facts,
      node("h3", "", "Predicted position in every image"),
      node("p", "hint small",
        "Open the Blink view: the dashed ring shows where this candidate would be in the image on screen. The dots are its path. The path is a straight line; it ignores parallax."),
      wrap,
      open,
      node("p", "hint small caution-note", "A candidate only. It is not a detection."),
    );
    this.markRow();
  }

  private markRow(): void {
    const index = this.ctx.frameIndex();
    for (const tr of this.detail.querySelectorAll<HTMLTableRowElement>("tr[data-index]")) {
      tr.classList.toggle("now", index !== null && tr.dataset.index === String(index));
    }
  }

  /** Path dots and the predicted-position ring, on top of the blink image. */
  private draw(): void {
    const canvas = this.ctx.blinkCanvas;
    const parent = canvas.parentElement;
    const c = this.picked;
    if (!c || !parent || canvas.hidden || this.ctx.simActive()) {
      this.overlay.hidden = true;
      return;
    }
    const r = canvas.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (r.width < 2) {
      this.overlay.hidden = true;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.hidden = false;
    this.overlay.style.left = `${r.left - pr.left}px`;
    this.overlay.style.top = `${r.top - pr.top}px`;
    this.overlay.style.width = `${r.width}px`;
    this.overlay.style.height = `${r.height}px`;
    this.overlay.width = Math.round(r.width * dpr);
    this.overlay.height = Math.round(r.height * dpr);
    const g = this.overlay.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    const npix = this.ctx.npix();
    const cell = r.width / npix;
    const px = (x: number): number => (x + 0.5) * cell;
    const py = (y: number): number => (npix - y - 0.5) * cell;   // rows are flipped on screen (north up)

    const pts = c.path.filter((p) => p.inside);
    g.strokeStyle = "rgba(220, 214, 255, 0.55)";
    g.lineWidth = 1;
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), py(p.y)) : g.lineTo(px(p.x), py(p.y))));
    g.stroke();
    g.fillStyle = "rgba(220, 214, 255, 0.8)";
    for (const p of pts) {
      g.beginPath();
      g.arc(px(p.x), py(p.y), 1.6, 0, Math.PI * 2);
      g.fill();
    }

    const index = this.ctx.frameIndex();
    const here = c.path.find((p) => p.index === index);
    if (here?.inside) {
      const x = px(here.x);
      const y = py(here.y);
      const rad = Math.max(9, cell * 2.6);
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeStyle = "#05060c";
      g.beginPath();
      g.arc(x, y, rad + 1.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "#dcd6ff";
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.font = "600 11px 'Bricolage Grotesque Variable', system-ui, sans-serif";
      const label = `candidate ${c.rank}: predicted here`;
      const tw = g.measureText(label).width;
      const lx = Math.max(4, Math.min(r.width - tw - 10, x - tw / 2));
      const ly = y - rad - 10 < 14 ? y + rad + 18 : y - rad - 10;
      g.fillStyle = "rgba(5, 6, 12, 0.85)";
      g.fillRect(lx - 4, ly - 12, tw + 8, 16);
      g.fillStyle = "#dcd6ff";
      g.fillText(label, lx, ly);
    }
  }
}
