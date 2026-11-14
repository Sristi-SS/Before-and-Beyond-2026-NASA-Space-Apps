// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Question-mark tips: a tiny "?" on a control; point at it (or focus the control) to read what it does.
// The "?" is drawn with CSS, so a button's text content does not change.

/** [control, tip, optional element that carries the "?" when the control itself cannot]. */
const TIPS: Array<[string, string, string?]> = [
  // Top bar
  ["#nav-globe", "The whole sky as a globe. Pick a place to study."],
  ["#nav-cube", "The time cube: every image of one sky patch, stacked by date."],
  ["#nav-orbit", "A 3D picture of why near objects seem to move."],
  ["#tour-start", "A five-step guided tour. It uses a cube that is already saved, so it is fast."],
  ["#focus-toggle", "Hides all panels so only the sky is left. Press again, or press F, to bring them back."],
  ["#fullscreen-demo", "Full screen with large text, for a projector."],
  // View switch
  ['.view-seg [data-view="cube"]', "All images as a stack you can turn. The orange slice is the one on the timeline."],
  ['.view-seg [data-view="blink"]', "One image at a time. Press Play: fixed stars stay put, a mover jumps."],
  ['.view-seg [data-view="colour"]', "Early images in blue, late images in orange. A mover leaves a blue-to-orange trail."],
  ['.view-seg [data-view="map"]', "A map of every motion we tried. A bright spot away from the centre is a possible mover."],
  ['.view-seg [data-view="compare"]', "Two dates side by side, with swipe, fade and difference modes."],
  // Timeline
  ["#play", "Plays the images in order, like a flip book."],
  ["#speed", "How fast the images play."],
  ["#sound-toggle", "Plays one tone for each image. Higher pitch means brighter at the marked pixel (or the image centre). Click the image in Blink view to mark a pixel."],
  ["#share-link", "Copies a link to exactly this view: target, band, image and motion."],
  ["[data-auto-demo]", "Runs the five tour steps by itself, about ten seconds each. It uses a saved cube of real images."],
  ["[data-open-target]", "Opens WISE 0855, one of the fastest-moving known objects in the sky."],
  ["#save-movie", "Saves the images on screen as a short video file (WebM)."],
  // Left panel
  ['#dock-controls [data-tab="target"]', "Choose where in the sky to look."],
  ['#dock-controls [data-tab="frames"]', "Choose which images (colour band) to show."],
  ['#dock-controls [data-tab="learn"]', "The tour and a list of the words used here."],
  ["#target-select", "Five test objects that are known to move or change. Their cubes are already saved."],
  ["#ra", "Right ascension: the sky's east-west coordinate, in degrees (0 to 360)."],
  ["#dec", "Declination: the sky's north-south coordinate, in degrees (-90 to +90)."],
  ["#fov", "How wide the patch of sky is. 0.20 degrees is a bit less than half the width of the full Moon."],
  ["#max-frames", "The most images to fetch. More images take longer but show more dates."],
  ["#build", "Fetches real images of this position from the NASA archive and lines them up. The first time takes a few minutes."],
  ["#group-picker", "SPHEREx has six detectors (D1 to D6), each for a range of infrared colour. WISE adds older images from 2010 to 2024.", ".field:has(> #group-picker) > span"],
  ["#axis", "Order the stack by date, or by colour (wavelength)."],
  ["#gaia-toggle", "Draws a blue ring on every star the Gaia catalogue knows. A spot with no ring is more interesting."],
  // Right panel
  ['#dock-tilt [data-tab="tilt"]', "Shift and add the images to follow one motion."],
  ['#dock-tilt [data-tab="candidates"]', "Let the computer search for possible movers and rank them."],
  ['#dock-tilt [data-tab="sim"]', "Practice mode. It hides a made-up object in copies of the images. Always marked SIMULATED."],
  ['#dock-tilt [data-tab="data"]', "Check for new images and see where the data comes from."],
  ["#vx", "The motion to test, toward the east, in arcseconds per year. One SPHEREx pixel is about 6 arcseconds."],
  ["#vy", "The motion to test, toward the north, in arcseconds per year."],
  ["#run-tilt", "Shifts every image to undo this motion, then adds them. An object with this motion becomes one sharp spot."],
  ["#reset-tilt", "Sets the motion back to zero."],
  ["#use-catalogue", "Uses the known motion of this object from the star catalogue. A good check that the method works."],
  ["#find-motion", "Tries a grid of motions and picks the one with the sharpest spot."],
  ["#tilt-caption", "The images added together after the shift. The orange ring marks the brightest spot.", "#tilt-caption"],
  ["#static-median", "Subtracts what is the same in every image (fixed stars), so only changes are left."],
  ["#map-span", "The largest motion the search tries, in each direction."],
  ["#map-step", "The gap between tried motions. Small steps are finer but slower."],
  ["#save-tilt-img", "Saves the stack image with a caption."],
  ["#tilt-snap", "Saves a short video of the stack as the motion goes from zero to your value."],
  ["#open-dossier", "A one-page report of this candidate that you can print."],
  ["#cand-run", "Searches this band for possible movers. Each result is a candidate, not a discovery."],
  ["#upd-check", "Asks the archive if it has images newer than this cube."],
  ["#upd-apply", "Builds this cube again with the newest images. Images already saved are not downloaded again."],
  ["#sim-toggle", "Adds a made-up moving object to copies of the images. Real images are not changed."],
  // Sky scene
  ["#globe-q", "Type a name (Barnard's Star) or a position (269.45 4.69)."],
  ['[data-globe="centre"]', "Picks the point in the middle of the view."],
  ["#globe-quick", "Opens a saved cube right away."],
  // Orbit scene
  ["#orbit-mode", "A star (far away, small wobble) or a made-up distant planet (near, large wobble)."],
  ["#orbit-dist", "How far away the object is. Nearer objects wobble more."],
  ["#orbit-pm", "The object's own straight-line drift across the sky."],
  ["#orbit-detrend", "Takes out the straight drift so you see only the yearly wobble."],
];

function hostFor(el: HTMLElement, explicit?: string): HTMLElement | null {
  if (explicit) return document.querySelector<HTMLElement>(explicit) ?? null;
  if (el.tagName === "BUTTON") return el;
  if (el.tagName === "INPUT" || el.tagName === "SELECT") {
    const label = el.closest("label");
    return label?.querySelector<HTMLElement>(":scope > span") ?? null;
  }
  return el;
}

function attach(): void {
  for (const [selector, tip, explicit] of TIPS) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const host = hostFor(el, explicit);
      if (!host || host.querySelector(":scope > .help-dot")) continue;
      const dot = document.createElement("span");
      dot.className = "help-dot";
      dot.dataset.tip = tip;
      dot.setAttribute("aria-hidden", "true");
      host.appendChild(dot);
      // Screen readers and keyboard users get the same text from the control itself.
      if (!el.getAttribute("aria-description")) el.setAttribute("aria-description", tip);
      if (el !== host && !el.dataset.tip) el.dataset.tip = tip;
      if (el === host) el.dataset.tip = tip;
    }
  }
}

export function initHelp(): void {
  const pop = document.getElementById("help-pop");
  const toggle = document.getElementById("help-toggle");
  if (!pop) return;
  let shownFor: HTMLElement | null = null;

  const show = (anchor: HTMLElement, text: string): void => {
    if (document.body.classList.contains("no-help")) return;
    shownFor?.classList.remove("on");
    shownFor = anchor;
    anchor.classList.add("on");
    pop.textContent = text;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  const hide = (): void => {
    shownFor?.classList.remove("on");
    shownFor = null;
    pop.hidden = true;
  };
  const dotOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof HTMLElement ? t.closest<HTMLElement>(".help-dot") : null;

  document.addEventListener("mouseover", (ev) => {
    const dot = dotOf(ev.target);
    if (dot?.dataset.tip) show(dot, dot.dataset.tip);
  });
  document.addEventListener("mouseout", (ev) => {
    if (dotOf(ev.target)) hide();
  });
  // Keyboard: a focused control shows its tip.
  document.addEventListener("focusin", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!t?.matches?.(":focus-visible") || !t.dataset?.tip) return;
    const dot = t.querySelector<HTMLElement>(":scope > .help-dot")
      ?? t.closest("label")?.querySelector<HTMLElement>(".help-dot");
    if (dot) show(dot, t.dataset.tip);
  });
  document.addEventListener("focusout", hide);
  // Touch: a tap on the "?" shows the tip and does not press the button under it.
  document.addEventListener("click", (ev) => {
    const dot = dotOf(ev.target);
    if (!dot) {
      if (!pop.hidden) hide();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (shownFor === dot && !pop.hidden) hide();
    else if (dot.dataset.tip) show(dot, dot.dataset.tip);
  }, true);
  window.addEventListener("scroll", hide, true);

  let stored: string | null = null;
  try { stored = window.localStorage.getItem("tips"); } catch { /* private mode */ }
  const apply = (on: boolean): void => {
    document.body.classList.toggle("no-help", !on);
    toggle?.setAttribute("aria-pressed", String(on));
    if (!on) hide();
  };
  apply(stored !== "off");
  toggle?.addEventListener("click", () => {
    const on = document.body.classList.contains("no-help");
    apply(on);
    try { window.localStorage.setItem("tips", on ? "on" : "off"); } catch { /* private mode */ }
  });

  attach();
  // Panels are filled in later, and some buttons rewrite their own text: add missing tips again.
  let timer = 0;
  new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(attach, 250);
  }).observe(document.body, { childList: true, subtree: true });
}
