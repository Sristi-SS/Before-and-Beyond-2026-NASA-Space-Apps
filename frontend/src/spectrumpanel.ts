// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Panel that shows the spectrum and the pulse view for one clicked pixel.
import { drawEmpty } from "./chartkit";
import {
  colourIndex, comparePasses, downloadCsv, fetchPhotometry, spherexPoints, wisePoints,
  type PassComparison, type Photometry, type PhotFrame,
} from "./photometry";
import { describePulse, detectorColor, detectorName, detectorShape, drawPulse, PULSE_CAUTION } from "./pulse";
import {
  describeSpectrum, drawSpectrum, MOLECULE_NOTE, MOLECULES, passColor, passShape,
} from "./spectrum";

export type PanelTab = "spectrum" | "pulse";

export interface PanelHooks {
  /** The panel was closed by the visitor (Close button or Escape). */
  onClose: () => void;
  /** The visible tab changed. */
  onTab: (tab: PanelTab) => void;
}

const SHAPE_GLYPH: Record<string, string> = {
  circle: "●", square: "■", triangle: "▲", diamond: "◆", cross: "✕", plus: "＋",
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{ className: string; text: string; id: string; title: string }> = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.id) node.id = props.id;
  if (props.title) node.title = props.title;
  for (const k of kids) node.append(k);
  return node;
}

export class SpectrumPanel {
  private jobKey: string | null = null;
  private tab: PanelTab = "spectrum";
  private data: Photometry | null = null;
  private request = 0;
  private radius = 2;
  private readonly activeBands = new Set<string>();
  private hiddenPasses = new Set<number>();
  private joinPasses = true;
  private matched = false;
  private detA = 0;
  private detB = 0;
  private passA = 0;
  private passB = 0;
  private lastPick: { x: number; y: number } | null = null;

  private readonly title = h("h2", { text: "Pixel spectrum and light curve" });
  private readonly readout = h("p", { className: "sp-readout" });
  private readonly live = h("p", { className: "sr-only" });
  private readonly tabSpectrum = h("button", { text: "Spectrum" });
  private readonly tabPulse = h("button", { text: "Pulse view" });
  private readonly radiusSelect = h("select");
  private readonly csvButton = h("button", { className: "ghost", text: "Download CSV" });
  private readonly closeButton = h("button", { className: "ghost", text: "Close" });
  private readonly status = h("p", { className: "hint", id: "sp-status" });
  private readonly flagBanner = h("p", { className: "sp-banner" });

  private readonly spectrumBody = h("div", { className: "sp-body" });
  private readonly spectrumCanvas = h("canvas", { className: "sp-canvas" });
  private readonly spectrumLegend = h("p", { className: "sp-legend" });
  private readonly bandChips = h("div", { className: "chips" });
  private readonly bandExplain = h("ul", { className: "sp-explain" });
  private readonly passChips = h("div", { className: "chips" });
  private readonly compareBox = h("div", { className: "sp-compare" });
  private readonly colourBox = h("div", { className: "sp-compare" });

  private readonly pulseBody = h("div", { className: "sp-body" });
  private readonly pulseCaution = h("p", { className: "sp-banner", text: PULSE_CAUTION });
  private readonly matchedBox = h("input");
  private readonly pulseSpherexTitle = h("h3");
  private readonly pulseSpherexCanvas = h("canvas", { className: "sp-canvas" });
  private readonly pulseSpherexLegend = h("p", { className: "sp-legend" });
  private readonly pulseWiseTitle = h("h3");
  private readonly pulseWiseCanvas = h("canvas", { className: "sp-canvas" });
  private readonly pulseWiseLegend = h("p", { className: "sp-legend" });

  private readonly tableDetails = h("details", { className: "sp-table" });
  private readonly tableBody = h("tbody");

  constructor(private readonly root: HTMLElement, private readonly hooks: PanelHooks) {
    root.hidden = true;
    root.classList.add("sp-panel");
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", "sp-title");
    this.title.id = "sp-title";

    // Header: title, tabs, controls.
    this.tabSpectrum.type = this.tabPulse.type = this.csvButton.type = this.closeButton.type = "button";
    for (const [btn, id] of [[this.tabSpectrum, "spectrum"], [this.tabPulse, "pulse"]] as const) {
      btn.className = "chip";
      btn.setAttribute("role", "tab");
      btn.id = `sp-tab-${id}`;
      btn.setAttribute("aria-controls", `sp-body-${id}`);
      btn.addEventListener("click", () => this.setTab(id, true));
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
          const next = id === "spectrum" ? "pulse" : "spectrum";
          this.setTab(next, true);
          (next === "spectrum" ? this.tabSpectrum : this.tabPulse).focus();
          ev.preventDefault();
        }
      });
    }
    const tabs = h("div", { className: "chips" }, this.tabSpectrum, this.tabPulse);
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Panel view");

    for (const r of [1, 2, 3, 4, 6]) {
      const o = h("option", { text: `${r} px` });
      o.value = String(r);
      this.radiusSelect.append(o);
    }
    this.radiusSelect.value = "2";
    this.radiusSelect.addEventListener("change", () => {
      this.radius = Number(this.radiusSelect.value);
      if (this.lastPick) void this.load(this.lastPick.x, this.lastPick.y);
    });
    const radiusLabel = h("label", { className: "field sp-radius" }, h("span", { text: "Aperture radius" }), this.radiusSelect);

    this.csvButton.disabled = true;
    this.csvButton.addEventListener("click", () => {
      if (this.data && this.jobKey) downloadCsv(this.data, this.jobKey);
    });
    this.closeButton.setAttribute("aria-label", "Close the spectrum panel (Escape)");
    this.closeButton.addEventListener("click", () => this.close());
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.close();
    });

    this.live.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");
    this.status.setAttribute("role", "status");

    const head = h("div", { className: "sp-head" }, this.title, tabs, radiusLabel, this.csvButton, this.closeButton);

    // Spectrum body.
    this.spectrumBody.id = "sp-body-spectrum";
    this.spectrumBody.setAttribute("role", "tabpanel");
    this.spectrumBody.setAttribute("aria-labelledby", "sp-tab-spectrum");
    this.spectrumCanvas.setAttribute("role", "img");
    const chipRow = h("div", { className: "field" }, h("span", { text: "Molecule presets (approximate)" }), this.bandChips);
    for (const m of MOLECULES) {
      const chip = h("button", { className: "chip", text: m.label, title: m.explain });
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (this.activeBands.has(m.id)) this.activeBands.delete(m.id);
        else this.activeBands.add(m.id);
        chip.setAttribute("aria-pressed", String(this.activeBands.has(m.id)));
        this.renderExplain();
        this.drawSpectrumChart();
      });
      this.bandChips.append(chip);
    }
    this.bandExplain.setAttribute("aria-live", "polite");
    this.spectrumBody.append(
      this.spectrumCanvas, this.spectrumLegend, chipRow, this.bandExplain,
      h("p", { className: "hint small", text: MOLECULE_NOTE }),
      h("div", { className: "field" }, h("span", { text: "Passes" }), this.passChips),
      this.compareBox, this.colourBox,
    );

    // Pulse body.
    this.pulseBody.id = "sp-body-pulse";
    this.pulseBody.setAttribute("role", "tabpanel");
    this.pulseBody.setAttribute("aria-labelledby", "sp-tab-pulse");
    this.matchedBox.type = "checkbox";
    this.matchedBox.addEventListener("change", () => {
      this.matched = this.matchedBox.checked;
      this.drawPulseCharts();
    });
    const matchedLabel = h(
      "label", { className: "check" }, this.matchedBox,
      h("span", { text: "Compare passes at matched wavelength (connect only points within 0.05 µm; others are faded)" }),
    );
    for (const c of [this.pulseSpherexCanvas, this.pulseWiseCanvas]) c.setAttribute("role", "img");
    this.pulseBody.append(
      this.pulseCaution, matchedLabel,
      this.pulseSpherexTitle, this.pulseSpherexCanvas, this.pulseSpherexLegend,
      this.pulseWiseTitle, this.pulseWiseCanvas, this.pulseWiseLegend,
    );

    // Text alternative.
    const summary = h("summary", { text: "Table of the measurements (text alternative to the charts)" });
    const table = h("table");
    table.setAttribute("aria-label", "Measurements at the selected pixel, one row per frame");
    const headRow = h("tr");
    for (const t of ["Frame", "Source", "Date", "Pass", "Detector", "Wavelength (µm)", "Flux", "Error", "Flagged", "Units"]) {
      const th = h("th", { text: t });
      th.scope = "col";
      headRow.append(th);
    }
    table.append(h("thead", {}, headRow), this.tableBody);
    this.tableDetails.append(summary, h("div", { className: "sp-table-scroll" }, table));

    root.append(
      head, this.readout, this.live, this.status, this.flagBanner,
      this.spectrumBody, this.pulseBody, this.tableDetails,
    );

    new ResizeObserver(() => this.redraw()).observe(root);
    this.setTab("spectrum", false);
    this.renderExplain();
  }

  /** Forget the pixel (a different cube was opened). */
  reset(jobKey: string | null): void {
    this.jobKey = jobKey;
    this.request++;
    this.data = null;
    this.lastPick = null;
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  setTab(tab: PanelTab, notify: boolean): void {
    this.tab = tab;
    const spec = tab === "spectrum";
    this.spectrumBody.hidden = !spec;
    this.pulseBody.hidden = spec;
    this.tabSpectrum.setAttribute("aria-selected", String(spec));
    this.tabPulse.setAttribute("aria-selected", String(!spec));
    this.tabSpectrum.setAttribute("aria-pressed", String(spec));
    this.tabPulse.setAttribute("aria-pressed", String(!spec));
    this.tabSpectrum.tabIndex = spec ? 0 : -1;
    this.tabPulse.tabIndex = spec ? -1 : 0;
    if (notify) this.hooks.onTab(tab);
    window.requestAnimationFrame(() => this.redraw());
  }

  close(): void {
    this.root.hidden = true;
    this.request++;
    this.lastPick = null;
    this.hooks.onClose();
  }

  /** Measure pixel (x, y) of the open job and show the panel. */
  async show(x: number, y: number, tab: PanelTab): Promise<void> {
    this.lastPick = { x, y };
    this.root.hidden = false;
    this.setTab(tab, false);
    await this.load(x, y);
  }

  private async load(x: number, y: number): Promise<void> {
    if (!this.jobKey) return;
    const id = ++this.request;
    this.readout.textContent = `Pixel x = ${x}, y = ${y} (grid pixels; x grows west, y grows north)`;
    this.status.textContent = "Measuring every frame at this pixel…";
    this.csvButton.disabled = true;
    try {
      const data = await fetchPhotometry(this.jobKey, x, y, this.radius);
      if (id !== this.request) return;
      this.data = data;
      this.csvButton.disabled = false;
      this.afterLoad(data);
    } catch (error) {
      if (id !== this.request) return;
      this.data = null;
      this.status.textContent = `Could not measure this pixel: ${(error as Error).message}`;
      this.redraw();
    }
  }

  private afterLoad(data: Photometry): void {
    const sph = spherexPoints(data);
    const wise = wisePoints(data);
    this.readout.textContent =
      `Pixel x = ${data.x}, y = ${data.y} · RA ${data.ra_deg.toFixed(5)}°, Dec ${data.dec_deg.toFixed(5)}° · ` +
      `aperture radius ${data.radius_px} px`;
    this.status.textContent =
      `${sph.length} SPHEREx and ${wise.length} WISE measurements. Aperture sum minus a local background ring; ` +
      "units differ between SPHEREx (MJy/sr) and WISE (nanomaggies). A feature here is a candidate to check, not a result.";
    const unknown = data.flag_info !== "mask stored for every frame";
    this.flagBanner.hidden = false;
    this.flagBanner.textContent = unknown
      ? "Saturation flags are not available for every frame of this cube (it was built before masks were saved), so a bright star core may look unflagged. " +
        "Bright star cores are masked and filled by interpolation: their fluxes are lower limits."
      : "Hollow points are flagged: the aperture contains masked pixels. Bright star cores are masked and filled by interpolation, so flagged fluxes are lower limits.";
    this.live.textContent = `Measurements loaded for pixel ${data.x}, ${data.y}: ${sph.length} SPHEREx and ${wise.length} WISE points.`;

    const passes = [...new Set(sph.map((f) => f.pass ?? 0))].sort((a, b) => a - b);
    this.hiddenPasses = new Set([...this.hiddenPasses].filter((p) => passes.includes(p)));
    this.passA = passes.includes(this.passA) ? this.passA : (passes[0] ?? 0);
    this.passB = passes.includes(this.passB) && this.passB !== this.passA ? this.passB : (passes[1] ?? passes[0] ?? 0);
    const dets = [...new Set(sph.map((f) => f.detector ?? 0))].sort((a, b) => a - b);
    this.detA = dets.includes(this.detA) ? this.detA : (dets[0] ?? 0);
    this.detB = dets.includes(this.detB) && this.detB !== this.detA ? this.detB : (dets[1] ?? dets[0] ?? 0);
    this.renderPassChips(passes);
    this.renderCompare(sph, passes);
    this.renderColour(sph, dets);
    this.renderTable(data);
    this.redraw();
  }

  // ------------------------------------------------------------------ rendering
  private renderExplain(): void {
    this.bandExplain.replaceChildren();
    const active = MOLECULES.filter((m) => this.activeBands.has(m.id));
    if (active.length === 0) {
      this.bandExplain.append(h("li", { className: "hint", text: "Switch a chip on to shade its band on the spectrum and read what it means." }));
      return;
    }
    for (const m of active) this.bandExplain.append(h("li", { text: `${m.label} (approximate): ${m.explain}` }));
  }

  private renderPassChips(passes: number[]): void {
    this.passChips.replaceChildren();
    for (const p of passes) {
      const chip = h("button", { className: "chip" });
      chip.type = "button";
      chip.append(h("span", { text: SHAPE_GLYPH[passShape(p)] + " ", className: "sp-glyph" }), `Pass ${p}`);
      (chip.firstChild as HTMLElement).style.color = passColor(p);
      chip.setAttribute("aria-pressed", String(!this.hiddenPasses.has(p)));
      chip.addEventListener("click", () => {
        if (this.hiddenPasses.has(p)) this.hiddenPasses.delete(p);
        else this.hiddenPasses.add(p);
        chip.setAttribute("aria-pressed", String(!this.hiddenPasses.has(p)));
        this.drawSpectrumChart();
      });
      this.passChips.append(chip);
    }
    const join = h("label", { className: "check" });
    const box = h("input");
    box.type = "checkbox";
    box.checked = this.joinPasses;
    box.addEventListener("change", () => {
      this.joinPasses = box.checked;
      this.drawSpectrumChart();
    });
    join.append(box, h("span", { text: "Join each pass's points" }));
    this.passChips.append(join);
  }

  private select(options: Array<{ value: number; label: string }>, current: number, label: string, onChange: (v: number) => void): HTMLElement {
    const sel = h("select");
    for (const o of options) {
      const opt = h("option", { text: o.label });
      opt.value = String(o.value);
      sel.append(opt);
    }
    sel.value = String(current);
    sel.addEventListener("change", () => onChange(Number(sel.value)));
    return h("label", { className: "field" }, h("span", { text: label }), sel);
  }

  private renderCompare(points: PhotFrame[], passes: number[]): void {
    this.compareBox.replaceChildren(h("h3", { text: "Compare spectra between passes" }));
    if (passes.length < 2) {
      this.compareBox.append(h("p", { className: "hint", text: "Only one SPHEREx pass covers this cube, so there is nothing to compare." }));
      return;
    }
    const opts = passes.map((p) => ({ value: p, label: `Pass ${p}` }));
    const out = h("p", { className: "sp-result" });
    out.setAttribute("role", "status");
    const update = (): void => {
      out.textContent = describeComparison(comparePasses(points, this.passA, this.passB), this.passA, this.passB);
    };
    this.compareBox.append(
      h("div", { className: "row" },
        this.select(opts, this.passA, "First pass", (v) => { this.passA = v; update(); }),
        this.select(opts, this.passB, "Second pass", (v) => { this.passB = v; update(); })),
      out,
      h("p", { className: "hint small", text: "Passes are about six months apart and sample this pixel at different wavelengths, so this compares median flux over the shared wavelength range, not matched points." }),
    );
    update();
  }

  private renderColour(points: PhotFrame[], dets: number[]): void {
    this.colourBox.replaceChildren(h("h3", { text: "Colour index (SPHEREx detectors)" }));
    if (dets.length < 2) {
      this.colourBox.append(h("p", { className: "hint", text: "Needs measurements in two SPHEREx detectors." }));
      return;
    }
    const opts = dets.map((d) => ({ value: d, label: `D${d}` }));
    const out = h("p", { className: "sp-result" });
    out.setAttribute("role", "status");
    const update = (): void => {
      const ci = colourIndex(points, this.detA, this.detB);
      if (!ci) { out.textContent = "No data for that pair."; return; }
      const fmt = (v: number): string => (Number.isFinite(v) ? v.toPrecision(3) : "n/a");
      let text =
        `Median flux D${ci.detA} / D${ci.detB} = ${fmt(ci.medianA)} / ${fmt(ci.medianB)} = ${fmt(ci.ratio)} ` +
        `(${ci.nA} and ${ci.nB} points).`;
      const flagged = ci.flaggedA + ci.flaggedB;
      if (flagged > 0) {
        text += ` ${flagged} point${flagged === 1 ? " is" : "s are"} flagged: bright star cores are masked and interpolated, ` +
          `so their fluxes are lower limits and this ratio is unreliable. Unflagged points only: ${fmt(ci.ratioClean)}.`;
      }
      out.textContent = text;
    };
    this.colourBox.append(
      h("div", { className: "row" },
        this.select(opts, this.detA, "Numerator", (v) => { this.detA = v; update(); }),
        this.select(opts, this.detB, "Denominator", (v) => { this.detB = v; update(); })),
      out,
      h("p", { className: "hint small", text: "A ratio of flux in two wavelength groups: bigger means redder. It is not a calibrated colour, and it mixes different wavelengths inside each group." }),
    );
    update();
  }

  private renderTable(data: Photometry): void {
    this.tableBody.replaceChildren();
    const fmt = (v: number | null): string => (v === null ? "—" : v.toPrecision(4));
    for (const f of data.frames) {
      const tr = h("tr");
      const flag = f.flagged === null ? "unknown" : f.flagged ? "yes (lower limit)" : "no";
      const cells = [
        String(f.index), f.source, (f.obs_time ?? "").slice(0, 10), String(f.pass ?? "—"),
        detectorName(f.detector), f.wavelength_um === null ? "—" : f.wavelength_um.toFixed(3),
        fmt(f.flux), fmt(f.flux_err), flag, f.units,
      ];
      for (const c of cells) tr.append(h("td", { text: c }));
      this.tableBody.append(tr);
    }
  }

  redraw(): void {
    if (this.root.hidden) return;
    if (!this.data) {
      for (const c of [this.spectrumCanvas, this.pulseSpherexCanvas, this.pulseWiseCanvas]) drawEmpty(c, "Measuring…");
      return;
    }
    if (this.tab === "spectrum") this.drawSpectrumChart();
    else this.drawPulseCharts();
  }

  private drawSpectrumChart(): void {
    if (!this.data) return;
    const sph = spherexPoints(this.data);
    const visible = new Set(sph.map((f) => f.pass ?? 0).filter((p) => !this.hiddenPasses.has(p)));
    drawSpectrum(this.spectrumCanvas, sph, { activeBands: this.activeBands, visiblePasses: visible, joinPasses: this.joinPasses });
    this.spectrumCanvas.setAttribute("aria-label", describeSpectrum(sph));
    const flagged = sph.filter((f) => f.flagged === true).length;
    this.spectrumLegend.textContent =
      `Colour and shape show the pass (passes are about six months apart). Hollow = flagged${flagged ? ` (${flagged} here)` : ""}: masked pixels in the aperture, flux is a lower limit. Bars are 1-sigma from the background ring.`;
  }

  private drawPulseCharts(): void {
    if (!this.data) return;
    const sph = spherexPoints(this.data);
    const wise = wisePoints(this.data);
    this.pulseSpherexTitle.textContent = "SPHEREx (MJy/sr), 2025 onward";
    drawPulse(this.pulseSpherexCanvas, sph, { matched: this.matched, units: "MJy/sr" });
    this.pulseSpherexCanvas.setAttribute("aria-label", describePulse(sph, "SPHEREx"));
    this.pulseSpherexLegend.replaceChildren(...this.detectorLegend(sph));
    const hasWise = wise.length > 0;
    this.pulseWiseTitle.hidden = this.pulseWiseCanvas.hidden = this.pulseWiseLegend.hidden = !hasWise;
    this.pulseWiseTitle.textContent = "WISE / NEOWISE W1 and W2 (nanomaggies), 2010–2024 baseline";
    if (hasWise) {
      drawPulse(this.pulseWiseCanvas, wise, { matched: this.matched, units: "nanomaggies" });
      this.pulseWiseCanvas.setAttribute("aria-label", describePulse(wise, "WISE"));
      this.pulseWiseLegend.replaceChildren(...this.detectorLegend(wise));
    }
  }

  private detectorLegend(points: PhotFrame[]): Node[] {
    const dets = [...new Set(points.map((f) => f.detector))].sort((a, b) => (a ?? 0) - (b ?? 0));
    const out: Node[] = [];
    for (const d of dets) {
      const span = h("span", { className: "sp-key" });
      const glyph = h("span", { text: SHAPE_GLYPH[detectorShape(d)] + " " });
      glyph.style.color = detectorColor(d);
      const waves = points.filter((f) => f.detector === d).map((f) => f.wavelength_um as number);
      span.append(glyph, `${detectorName(d)} ${Math.min(...waves).toFixed(2)}–${Math.max(...waves).toFixed(2)} µm`);
      out.push(span);
    }
    out.push(h("span", { className: "sp-key", text: "Hollow = flagged (lower limit)" }));
    return out;
  }
}

function describeComparison(c: PassComparison | null, a: number, b: number): string {
  if (!c) return `Pass ${a} and pass ${b} share no wavelength range at this pixel.`;
  const f = (v: number): string => v.toPrecision(3);
  return (
    `Between ${c.loUm.toFixed(2)} and ${c.hiUm.toFixed(2)} µm: pass ${a} median ${f(c.medianA)} (${c.nA} points), ` +
    `pass ${b} median ${f(c.medianB)} (${c.nB} points), ratio ${Number.isFinite(c.ratio) ? f(c.ratio) : "n/a"}.`
  );
}
