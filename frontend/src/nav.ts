// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Two levels of tabs: the pages (Sky, Time cube) and the time cube's four views.  Both rows stay open:
// with two and four choices there is nothing to gain from folding them, and a folded row hid the other
// choices behind a small button.  Each level down is drawn a step less bright (see the stylesheet).
export function initNav(): void {
  document.querySelector<HTMLElement>(".scene-nav")?.classList.add("tab-level", "tab-level-1");
  document.querySelector<HTMLElement>(".view-seg")?.classList.add("tab-level", "tab-level-2");
}
