// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Candidate search panel: ranked possible movers, their motion path, and where each one
// is predicted to be in every other image.  Everything here is a candidate, never a detection.
import * as api from "./api";
import { compass } from "./motionmap";
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
    this.draw();
  }

  /** The frame on screen changed: move the predicted-position ring. */
  frameChanged(): void {
    this.draw();
    this.markRow();
  }

  /** Rank the best motions (the server reuses the map it has just made). */
  async search(): Promise<void> {
    const key = this.ctx.jobKey();
    const group = this.ctx.group();
    if (!key || group === 0) return;
    const request = ++this.request;
    this.status.textContent = "Ranking the best motions…";
    try {
      const result = await api.fetchCandidates(key, group, this.ctx.span(), this.ctx.step());
      if (request !== this.request) return;
      this.result = result;
      this.render();
    } catch (error) {
      if (request === this.request) this.status.textContent = (error as Error).message.replace(/^\d+ [^—]*— /, "").replace(/^\{"detail":"|"\}$/g, "");
    }
  }

  private render(): void {
    const r = this.result;
    if (!r) return;
    this.list.replaceChildren();
    const top = r.candidates.slice(0, 3);
    if (top.length === 0) {
      this.status.textContent = "";
      return;
    }
    this.status.textContent = "The three best motions. Press one to line the pictures up along it.";
    this.model.textContent =
      `Searched ${r.n_frames} pictures. "Dot" is a small trained check (${r.model.parameters} numbers) of whether the lined-up spot looks like a point of light; ` +
      `it scores ${(r.model.validation_accuracy_on_simulated * 100).toFixed(0)}% on made-up test patches. ${r.caution}`;
    for (const c of top) {
      const li = node("li");
      const b = node("button", "cand");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      const dot = c.patch_score >= 0.7 ? "looks like a point of light" : c.patch_score >= 0.4 ? "shape unclear" : "does not look like a point of light";
      const sharper = c.ratio === null ? `score ${c.score.toFixed(1)}` : c.ratio >= 1.05 ? `${c.ratio.toFixed(1)}× sharper than no motion` : "no sharper than no motion";
      b.setAttribute("aria-label", `Candidate ${c.rank}: ${c.speed_arcsec_yr.toFixed(1)} arcseconds a year ${compass(c.vx, c.vy)}, ${sharper}, ${dot}`);
      const arrow = node("span", "cand-arrow", "↑");
      arrow.style.transform = `rotate(${-c.pa_deg}deg)`; // east is to the left on the sky
      const v = node("span", "cand-v", `${c.speed_arcsec_yr.toFixed(1)}″ a year ${compass(c.vx, c.vy)} `);
      v.appendChild(arrow);
      b.append(node("span", "cand-rank", String(c.rank)), v, node("span", "cand-sub", `${sharper} · ${dot}`));
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
    const open = node("button", "primary", "See it lined up");
    open.type = "button";
    open.addEventListener("click", () => showTab("dock-tilt", "tilt"));
    const facts = node("dl", "provenance");
    const add = (k: string, v: string): void => { facts.append(node("dt", "", k), node("dd", "", v)); };
    add("Where it lines up", fmtSky(c.ra_deg, c.dec_deg));
    add("Where it would be today", `${fmtSky(c.today.ra_deg, c.today.dec_deg)}${c.today.inside ? "" : " (outside this patch)"}`);
    const table = node("table", "cand-table");
    const head = node("tr");
    for (const h of ["Date", "Set", "x, y", "Used"]) head.appendChild(node("th", "", h));
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
    const more = node("details", "fold");
    more.append(node("summary", "", "Where it should be in every picture"), facts, wrap);
    d.append(
      node("p", "hint", `Candidate ${c.rank}. In the Blink view a dashed ring now shows where it should be in each picture. If a dot sits in the ring every time, that is a good sign. It is still a candidate, not a discovery.`),
      open,
      more,
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
      g.font = "600 11px 'Nunito Variable', system-ui, sans-serif";
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
