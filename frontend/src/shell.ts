// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The page shell: fonts, floating panels with tabs, the view switch, focus mode.
// It only shows and hides things; it holds no science state.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/jetbrains-mono";

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

/** The right-hand panel of each scene; the left panel exists only in the cube scene. */
const RIGHT_DOCK: Record<string, string> = { cube: "dock-tilt", globe: "dock-globe", orbit: "dock-orbit" };

/** Show one tab of a panel (and open the panel if it is hidden). */
export function showTab(dockId: string, tab: string): void {
  const dock = document.getElementById(dockId);
  if (!dock) return;
  for (const b of $$<HTMLButtonElement>(".dock-tabs [data-tab]", dock)) {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const pane of $$(":scope > section[data-pane]", dock)) pane.hidden = pane.dataset.pane !== tab;
}

function setClosed(dock: HTMLElement, closed: boolean): void {
  dock.classList.toggle("closed", closed);
  syncHandles();
}

function syncHandles(): void {
  const scene = document.body.dataset.scene ?? "cube";
  const left = document.getElementById("dock-controls");
  const right = document.getElementById(RIGHT_DOCK[scene] ?? "dock-tilt");
  const hl = document.getElementById("handle-left");
  const hr = document.getElementById("handle-right");
  if (hl) hl.hidden = !(scene === "cube" && left?.classList.contains("closed"));
  if (hr) hr.hidden = !right?.classList.contains("closed");
  const all = $$(".dock").every((d) => d.classList.contains("closed"));
  document.getElementById("focus-toggle")?.setAttribute("aria-pressed", String(all));
}

/** Make an element visible: open its panel and its tab.  Used by the tour and by other modules. */
export function reveal(el: Element | null): void {
  if (!el) return;
  const pane = el.closest<HTMLElement>("section[data-pane]");
  const dock = el.closest<HTMLElement>(".dock");
  if (dock && pane?.dataset.pane) showTab(dock.id, pane.dataset.pane);
  if (dock?.classList.contains("closed")) setClosed(dock, false);
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
}

/** Keep the view buttons in step with the hidden <select id="view">. */
export function syncView(): void {
  const select = $<HTMLSelectElement>("#view");
  for (const b of $$<HTMLButtonElement>(".view-seg [data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === select?.value));
  }
}

export function initShell(): void {
  for (const dock of $$(".dock")) {
    const tabs = $$<HTMLButtonElement>(".dock-tabs [data-tab]", dock);
    for (const b of tabs) b.addEventListener("click", () => showTab(dock.id, b.dataset.tab ?? ""));
    if (tabs[0]) showTab(dock.id, tabs[0].dataset.tab ?? "");
    $(".dock-close", dock)?.addEventListener("click", () => setClosed(dock, true));
  }
  document.getElementById("handle-left")?.addEventListener("click", () => {
    const d = document.getElementById("dock-controls");
    if (d) setClosed(d, false);
  });
  document.getElementById("handle-right")?.addEventListener("click", () => {
    const d = document.getElementById(RIGHT_DOCK[document.body.dataset.scene ?? "cube"]);
    if (d) setClosed(d, false);
  });

  // Focus: hide every panel so only the sky and the timeline are left.  Again to bring them back.
  const focus = document.getElementById("focus-toggle");
  const toggleFocus = (): void => {
    const hide = focus?.getAttribute("aria-pressed") !== "true";
    for (const d of $$(".dock")) d.classList.toggle("closed", hide);
    syncHandles();
  };
  focus?.addEventListener("click", toggleFocus);
  window.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (ev.key.toLowerCase() !== "f" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    toggleFocus();
  });

  // The view switch drives the select the rest of the code listens to.
  const select = $<HTMLSelectElement>("#view");
  for (const b of $$<HTMLButtonElement>(".view-seg [data-view]")) {
    b.addEventListener("click", () => {
      if (!select || !b.dataset.view) return;
      select.value = b.dataset.view;
      select.dispatchEvent(new Event("change"));
    });
  }
  select?.addEventListener("change", syncView);
  syncView();

  // Shortcuts in the Learn tab.
  document.getElementById("learn-tour")?.addEventListener("click", () => document.getElementById("tour-start")?.click());
  document.getElementById("learn-orbit")?.addEventListener("click", () => document.getElementById("nav-orbit")?.click());

  // When the tour (or anything else) outlines an element, make sure it is on screen.
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as Element;
      if (r.attributeName === "class" && el.classList.contains("tour-target")) reveal(el);
      if (r.attributeName === "data-scene") syncHandles();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["class", "data-scene"], subtree: true });

  // Small screens: panels lie over the stage, so start with them closed.
  if (window.innerWidth < 920) for (const d of $$(".dock")) d.classList.add("closed");
  syncHandles();
}
