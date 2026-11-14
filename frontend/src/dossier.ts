// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

export interface DossierContext {
  simActive: () => boolean;
  targetName: () => string;
  groupLabel: () => string;
  sourceLabel: () => string;
  velocity: () => { vx: number; vy: number };
  say: (message: string) => void;
}

const STANDING =
  "This is a candidate, not a confirmed discovery. Simulated objects are excluded.";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function textOf(id: string): string {
  return (document.getElementById(id)?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function canvasImage(id: string, alt: string): HTMLElement {
  const fig = h("figure", undefined, "dossier-fig");
  const src = document.getElementById(id) as HTMLCanvasElement | null;
  if (src && src.width > 0) {
    const img = document.createElement("img");
    try {
      img.src = src.toDataURL("image/png");
    } catch {
      // A tainted canvas cannot be exported; leave the figure with its caption only.
    }
    img.alt = alt;
    img.width = 256;
    fig.appendChild(img);
  }
  fig.appendChild(h("figcaption", alt));
  return fig;
}

/** Copy the visible measurement table from the spectrum panel as text (never as markup). */
function spectrumTable(): HTMLElement | null {
  const src = document.querySelector<HTMLTableElement>("#spectrum-panel .sp-table table");
  if (!src || src.querySelectorAll("tbody tr").length === 0) return null;
  const table = document.createElement("table");
  table.className = "dossier-table";
  for (const group of Array.from(src.children)) {
    const out = document.createElement(group.tagName.toLowerCase());
    for (const tr of Array.from(group.querySelectorAll("tr"))) {
      const row = document.createElement("tr");
      for (const cell of Array.from(tr.children)) {
        const c = document.createElement(cell.tagName.toLowerCase());
        c.textContent = (cell.textContent ?? "").trim();
        row.appendChild(c);
      }
      out.appendChild(row);
    }
    table.appendChild(out);
  }
  return table;
}

function row(dl: HTMLElement, label: string, value: string): void {
  dl.append(h("dt", label), h("dd", value || "—"));
}

export function wireDossier(x: DossierContext): { refresh: () => void } {
  const open = document.getElementById("open-dossier") as HTMLButtonElement;
  const status = document.getElementById("dossier-status") as HTMLElement;
  const section = h("section", undefined, "dossier");
  section.id = "dossier";
  section.hidden = true;
  section.setAttribute("aria-label", "Candidate dossier");
  document.body.appendChild(section);

  const refresh = (): void => {
    const sim = x.simActive();
    open.disabled = sim;
    status.textContent = sim
      ? "Dossier is disabled while the simulator is on: simulated objects are never reported."
      : "";
    if (sim) close();
  };

  function close(): void {
    section.hidden = true;
    document.body.classList.remove("dossier-open");
  }

  function build(): void {
    section.replaceChildren();
    const { vx, vy } = x.velocity();
    const link = location.href;
    section.appendChild(h("h2", "Candidate dossier"));
    section.appendChild(h("p", STANDING, "dossier-standing"));

    const dl = h("dl", undefined, "dossier-list");
    row(dl, "Target", x.targetName() || "custom position");
    row(dl, "Coordinates", `RA ${(document.getElementById("ra") as HTMLInputElement).value}, Dec ${(document.getElementById("dec") as HTMLInputElement).value} (deg)`);
    row(dl, "Shareable link", link);
    row(dl, "Group / source", `${x.groupLabel()} / ${x.sourceLabel()}`);
    row(dl, "Velocity", `(${vx.toFixed(1)}, ${vy.toFixed(1)}) arcsec/yr`);
    const metrics = Array.from(document.querySelectorAll("#tilt-metrics .metric")).map(
      (m) => `${(m.querySelector("span")?.textContent ?? "").trim()}: ${(m.querySelector("b")?.textContent ?? "").trim()}`,
    );
    row(dl, "Score vs v = 0", metrics.join("; "));
    section.appendChild(dl);

    section.appendChild(h("h3", "Evidence checklist"));
    const items = document.querySelectorAll("#checklist ul.checklist > li");
    const ul = h("ul", undefined, "dossier-checks");
    items.forEach((li) => ul.appendChild(h("li", (li.textContent ?? "").replace(/\s+/g, " ").trim())));
    if (items.length === 0) ul.appendChild(h("li", "Run the tilt first to fill in the checklist."));
    section.appendChild(ul);

    const figs = h("div", undefined, "dossier-figs");
    figs.append(
      canvasImage("tilt-canvas", `Shifted stack, v = (${vx.toFixed(1)}, ${vy.toFixed(1)}) arcsec/yr`),
      canvasImage("zero-canvas", "Stack at zero motion"),
    );
    section.appendChild(figs);

    const table = spectrumTable();
    section.appendChild(h("h3", "Spectrum and light curve at the selected pixel"));
    section.appendChild(table ?? h("p", "No pixel selected."));

    section.appendChild(h("h3", "Data provenance"));
    const prov = h("dl", undefined, "dossier-list");
    row(prov, "Archives", textOf("prov-archives"));
    row(prov, "Release", textOf("release-badge").replace(/^release:\s*/, ""));
    row(prov, "Frames", textOf("prov-frames"));
    row(prov, "Masked fraction", textOf("prov-masked"));
    section.appendChild(prov);

    const actions = h("div", undefined, "dossier-actions no-print");
    const print = h("button", "Print / save as PDF");
    print.type = "button";
    print.addEventListener("click", () => window.print());
    const copy = h("button", "Copy link");
    copy.type = "button";
    copy.addEventListener("click", () => {
      const done = () => x.say("Link copied.");
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => x.say("Could not copy; select the link above."));
      else x.say("Clipboard unavailable; select the link above and copy it.");
    });
    const closeBtn = h("button", "Close dossier");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => {
      close();
      open.focus();
    });
    actions.append(print, copy, closeBtn);
    section.appendChild(actions);
    section.appendChild(h("p", STANDING, "dossier-standing"));
  }

  open.addEventListener("click", () => {
    if (x.simActive()) {
      refresh();
      return;
    }
    build();
    section.hidden = false;
    document.body.classList.add("dossier-open");
    section.setAttribute("tabindex", "-1");
    section.focus();
    section.scrollIntoView({ block: "start" });
  });
  refresh();
  return { refresh };
}
