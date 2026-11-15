// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Pixel speech bubbles: short arcade-style notes that point at one control.
// One bubble at a time.  A single note closes on its X, on Escape, after a while, or when its control
// disappears.  A walkthrough (showSteps) is a few notes in a row with BACK and NEXT.
import "./bubble.css";

export type BubbleSide = "below" | "above" | "right" | "left";

export interface BubbleOptions {
  /** The control the tail points at. */
  anchor: HTMLElement;
  title: string;
  text: string;
  /** Where the bubble sits relative to the control. */
  side: BubbleSide;
  /** Show only once per browser under this key. */
  once?: string;
  /** Close by itself after this long (ms); 0 keeps it until closed. */
  ms?: number;
  /** Walkthrough step: shows "2 / 3" with BACK and NEXT (or GOT IT on the last). */
  nav?: { index: number; count: number; onBack: () => void; onNext: () => void };
}

let closeCurrent: (() => void) | null = null;

function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* private mode: it may show again, which is harmless */
  }
}

const TAIL = `<svg class="bubble-tail" viewBox="0 0 5 3" width="20" height="12" aria-hidden="true" shape-rendering="crispEdges">
<rect x="0" y="0" width="1" height="1" fill="#000"/><rect x="1" y="0" width="3" height="1" fill="#fff"/><rect x="4" y="0" width="1" height="1" fill="#000"/>
<rect x="1" y="1" width="1" height="1" fill="#000"/><rect x="2" y="1" width="1" height="1" fill="#fff"/><rect x="3" y="1" width="1" height="1" fill="#000"/>
<rect x="2" y="2" width="1" height="1" fill="#000"/></svg>`;

/** On screen and laid out (offsetParent alone misses position: fixed controls such as the panel tabs). */
function shown(el: HTMLElement): boolean {
  return el.isConnected && !el.closest("[hidden]") && el.getClientRects().length > 0;
}

export function closeBubble(): void {
  closeCurrent?.();
}

function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  return b;
}

export function showBubble(o: BubbleOptions): void {
  if (o.once && seen(o.once)) return;
  closeCurrent?.();
  if (o.once) markSeen(o.once);

  const root = document.createElement("div");
  root.className = `bubble ${o.side}`;
  root.setAttribute("role", o.nav ? "dialog" : "status");
  if (o.nav) root.setAttribute("aria-label", o.title);
  const frame = document.createElement("div");
  frame.className = "bubble-frame";
  const body = document.createElement("div");
  body.className = "bubble-body";
  const title = document.createElement("p");
  title.className = "bubble-title";
  title.textContent = o.title;
  const text = document.createElement("p");
  text.className = "bubble-text";
  text.textContent = o.text;
  const x = button("bubble-x", "X");
  x.setAttribute("aria-label", o.nav ? "Close the walkthrough" : "Close this note");
  body.append(title, text, x);
  let next: HTMLButtonElement | null = null;
  if (o.nav) {
    const nav = document.createElement("div");
    nav.className = "bubble-nav";
    const count = document.createElement("span");
    count.className = "bubble-count";
    count.textContent = `${o.nav.index + 1} / ${o.nav.count}`;
    nav.append(count);
    if (o.nav.index > 0) {
      const back = button("bubble-btn", "Back");
      back.addEventListener("click", o.nav.onBack);
      nav.append(back);
    }
    next = button("bubble-btn primary", o.nav.index === o.nav.count - 1 ? "Got it" : "Next");
    next.addEventListener("click", o.nav.onNext);
    nav.append(next);
    body.append(nav);
  }
  frame.append(body);
  root.append(frame);
  root.insertAdjacentHTML("beforeend", TAIL);
  document.body.append(root);

  let raf = 0;
  let timer = 0;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") close();
  };
  const close = (): void => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    root.remove();
    if (closeCurrent === close) closeCurrent = null;
  };
  closeCurrent = close;
  x.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  if (o.ms) timer = window.setTimeout(close, o.ms);

  // Follow the control (panels slide, the window resizes); go away when it is hidden.
  const place = (): void => {
    if (!shown(o.anchor) || document.body.classList.contains("intro-open")) {
      close();
      return;
    }
    const r = o.anchor.getBoundingClientRect();
    const bw = root.offsetWidth;
    const bh = root.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 16;
    let left: number;
    let top: number;
    if (o.side === "right" || o.side === "left") {
      // Flip to the other side when there is no room, then keep it on screen.
      let side = o.side;
      if (side === "right" && r.right + gap + bw > vw - 8 && r.left - gap - bw >= 8) side = "left";
      else if (side === "left" && r.left - gap - bw < 8 && r.right + gap + bw <= vw - 8) side = "right";
      root.classList.toggle("right", side === "right");
      root.classList.toggle("left", side === "left");
      left = side === "right" ? r.right + gap : r.left - bw - gap;
      left = Math.max(8, Math.min(vw - bw - 8, left));
      top = Math.max(8, Math.min(vh - bh - 8, r.top + r.height / 2 - 28));
      root.style.setProperty("--tail-y", `${Math.max(12, Math.min(bh - 32, r.top + r.height / 2 - top - 10))}px`);
    } else {
      left = Math.max(8, Math.min(vw - bw - 8, r.left + r.width / 2 - bw / 2));
      top = o.side === "below" ? r.bottom + gap : r.top - bh - gap;
      const tail = Math.max(14, Math.min(bw - 34, r.left + r.width / 2 - left - 10));
      root.style.setProperty("--tail-x", `${tail}px`);
    }
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(Math.max(8, top))}px`;
    raf = requestAnimationFrame(place);
  };
  place();
  next?.focus({ preventScroll: true });
}

export interface Step {
  /** CSS selector of the control this step points at; a step whose control is not on screen is skipped. */
  anchor: string;
  side: BubbleSide;
  title: string;
  text: string;
}

/** A short walkthrough (three steps at most), shown once per browser under `key`. */
export function showSteps(key: string, steps: Step[]): void {
  if (seen(key)) return;
  const visible = (sel: string): HTMLElement | null => {
    const el = document.querySelector<HTMLElement>(sel);
    return el && shown(el) ? el : null;
  };
  const live = steps.filter((s) => visible(s.anchor)).slice(0, 3);
  if (live.length === 0) return;
  markSeen(key);
  const go = (i: number): void => {
    const step = live[i];
    const anchor = visible(step.anchor);
    if (!anchor) {
      closeBubble();
      return;
    }
    showBubble({
      anchor, side: step.side, title: step.title, text: step.text,
      nav: {
        index: i,
        count: live.length,
        onBack: () => go(Math.max(0, i - 1)),
        onNext: () => (i + 1 < live.length ? go(i + 1) : closeBubble()),
      },
    });
  };
  go(0);
}
