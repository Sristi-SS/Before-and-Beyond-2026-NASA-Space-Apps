// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Question-mark tips: a tiny "?" on a control; point at it (or focus the control) to read what it does.
// The "?" is drawn with CSS, so a button's text content does not change.
import { showBubble } from "./bubble";

/** [control, tip, optional element that carries the "?" when the control itself cannot]. */
const TIPS: Array<[string, string, string?]> = [
  // Top bar
  ["#nav-globe", "The whole sky as a globe. Pick a place to study."],
  ["#nav-cube", "The time cube: every picture of one sky patch, stacked by date."],
  ["#fullscreen-demo", "Fills the screen and enlarges the text, for a projector or a talk."],
  // The four views
  ['.view-seg [data-view="cube"]', "All pictures as a stack you can turn. The white frame is the one on the timeline."],
  ['.view-seg [data-view="blink"]', "One picture at a time. Press Play: fixed stars stay put, a mover jumps."],
  ['.view-seg [data-view="colour"]', "One picture of what changed: blue where something was early on, orange where it was later."],
  ['.view-seg [data-view="compare"]', "Two dates next to each other, and a third picture of only what changed."],
  // Timeline
  ["#play", "Plays the pictures in order, like a flip book."],
  ["#speed", "How fast the pictures play."],
  ["#share-toggle", "Copy a link to exactly this cube and view, or save a movie or a picture of it."],
  ["[data-auto-demo]", "Runs five steps by itself, about ten seconds each, on a saved cube of real pictures."],
  // Left panel
  ['#dock-controls [data-tab="target"]', "Choose where in the sky to look."],
  ['#dock-controls [data-tab="frames"]', "Choose which pictures to show: which infrared colours, which years."],
  ['#dock-controls [data-tab="about"]', "Where the pictures come from, newer pictures, and the words used here."],
  ["#target-select", "Five test objects that are known to move or change. Their cubes are already saved."],
  ["#ra", "Right ascension: the sky's east-west coordinate, in degrees (0 to 360)."],
  ["#dec", "Declination: the sky's north-south coordinate, in degrees (-90 to +90)."],
  ["#fov", "How much sky to download around the position. The cube itself always shows the same 13-arcminute patch."],
  ["#max-frames", "The most pictures to fetch. More pictures take longer but show more dates."],
  ["#build", "Fetches real pictures of this position from NASA's archive and lines them up. The first time takes a few minutes."],
  ["#axis", "Order the stack by date, or by colour (wavelength)."],
  ["#gaia-toggle", "Draws a blue ring on every star the Gaia catalogue knows. A spot with no ring is more interesting."],
  ["#upd-check", "Asks the archive if it has pictures newer than this cube."],
  ["#upd-apply", "Builds this cube again with the newest pictures. Pictures already saved are not downloaded again."],
  // Right panel: the three tools
  ['#dock-tilt [data-tab="find"]', "Let the computer search for things that move, and rank what it finds."],
  ['#dock-tilt [data-tab="tilt"]', "Slide and add the pictures to follow one motion you choose."],
  ['#dock-tilt [data-tab="sim"]', "Practice mode. It hides a made-up object in copies of the pictures. Always marked SIMULATED."],
  ["#map-span", "The fastest motion the search tries, in each direction. Wider searches take longer."],
  ["#cand-run", "Searches the pictures on screen for things that move. Each result is a candidate, not a discovery."],
  ["#vx", "The motion to test, toward the east, in arcseconds a year. One SPHEREx pixel is about 6 arcseconds."],
  ["#vy", "The motion to test, toward the north, in arcseconds a year."],
  ["#run-tilt", "Slides every picture back along this motion, then adds them. Something with this motion becomes one sharp dot."],
  ["#use-catalogue", "Uses this object's known motion from the star catalogue. A good check that the method works."],
  ["#tilt-caption", "The pictures added together after sliding. The orange ring marks the brightest spot.", "#tilt-caption"],
  ["#static-median", "Subtracts what is the same in every picture (the fixed stars), so only changes are left."],
  ["#reset-tilt", "Sets the motion back to zero."],
  ["#save-tilt-img", "Saves the lined-up picture with a caption."],
  ["#tilt-snap", "Saves a short video of the pictures lining up as the motion goes from zero to your value."],
  ["#open-dossier", "A one-page report of this candidate that you can print."],
  ["#sim-toggle", "Adds a made-up moving object to copies of the pictures. Real pictures are not changed."],
  // Sky page
  ["#globe-q", "Type a name (Barnard's Star) or a position (269.45 4.69, or 17h57m48s +04d41m36s)."],
  ['[data-globe="centre"]', "Picks the point in the middle of the view."],
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
    if (toggle) toggle.textContent = on ? "Tips: on" : "Tips: off";
    if (!on) hide();
  };
  // Tips start hidden (the intro does the first teaching); the ? button shows them and says how they work.
  apply(stored === "on");
  toggle?.addEventListener("click", () => {
    const on = document.body.classList.contains("no-help");
    apply(on);
    try { window.localStorage.setItem("tips", on ? "on" : "off"); } catch { /* private mode */ }
    showBubble(on
      ? {
          anchor: toggle, side: "below", ms: 9000, title: "Tips on!",
          text: "If you're confused about what something means, press the question marks that now appear next to it.",
        }
      : { anchor: toggle, side: "below", ms: 5000, title: "Tips off", text: "Press Tips again any time to bring the question marks back." });
  });

  attach();
  // Panels are filled in later, and some buttons rewrite their own text: add missing tips again.
  let timer = 0;
  new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(attach, 250);
  }).observe(document.body, { childList: true, subtree: true });
}
