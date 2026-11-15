// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// A hierarchy of tabs.  Level 1: the scenes (Sky, Time cube, Why it moves).  Level 2: the time cube's
// views.  Level 3: the compare modes.  Once a visitor picks a tab, its siblings fold away and only the
// chosen one stays, with a small caret; pressing it opens the row again.  Each level down is drawn a
// step less bright, so the path you are on reads from the top.
// Which tab is chosen is read from the page itself (aria-current / aria-pressed), so this module
// only shows and hides; the buttons keep their own click handlers.

const isActive = (b: HTMLElement): boolean =>
  b.getAttribute("aria-current") === "page" || b.getAttribute("aria-pressed") === "true";

/** Make one row of tabs fold to its chosen tab after a choice. */
export function foldingTabs(row: HTMLElement | null, level: 1 | 2 | 3): void {
  if (!row || row.dataset.fold) return;
  row.dataset.fold = "1";
  row.classList.add("tab-level", `tab-level-${level}`);
  const setOpen = (open: boolean): void => {
    row.classList.toggle("folded", !open);
    for (const b of row.querySelectorAll<HTMLButtonElement>(":scope > button")) {
      if (isActive(b)) b.setAttribute("aria-expanded", String(open));
      else b.removeAttribute("aria-expanded");
    }
  };
  // Capture phase: decide before the button's own handler changes which tab is active.
  row.addEventListener(
    "click",
    (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b || b.parentElement !== row) return;
      if (row.classList.contains("folded") && isActive(b)) {
        setOpen(true); // the chosen tab opens the row again
        ev.stopImmediatePropagation();
        return;
      }
      window.setTimeout(() => setOpen(false), 0); // a choice was made: fold to it
    },
    true,
  );
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !row.classList.contains("folded")) setOpen(false);
  });
}

export function initNav(): void {
  foldingTabs(document.querySelector<HTMLElement>(".scene-nav"), 1);
  foldingTabs(document.querySelector<HTMLElement>(".view-seg"), 2);
  foldingTabs(document.querySelector<HTMLElement>("#compare-wrap .cmp-modes"), 3);
}
