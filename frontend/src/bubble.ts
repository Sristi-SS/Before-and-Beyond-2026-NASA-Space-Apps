// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Pixel speech bubbles: short arcade-style notes that point at one control.
// One bubble at a time.  Each closes on its X, on Escape, after a while, or when its control disappears.
import "./bubble.css";

export interface BubbleOptions {
  /** The control the tail points at. */
  anchor: HTMLElement;
  title: string;
  text: string;
  /** Where the bubble sits relative to the control. */
  side: "below" | "above" | "right";
  /** Show only once per browser under this key. */
  once?: string;
  /** Close by itself after this long (ms); 0 keeps it until closed. */
  ms?: number;
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

export function closeBubble(): void {
  closeCurrent?.();
}

export function showBubble(o: BubbleOptions): void {
  if (o.once && seen(o.once)) return;
  closeCurrent?.();
  if (o.once) markSeen(o.once);

  const root = document.createElement("div");
  root.className = `bubble ${o.side}`;
  root.setAttribute("role", "status");
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
  const x = document.createElement("button");
  x.type = "button";
  x.className = "bubble-x";
  x.textContent = "X";
  x.setAttribute("aria-label", "Close this note");
  body.append(title, text, x);
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
    if (!o.anchor.isConnected || o.anchor.offsetParent === null || document.body.classList.contains("intro-open")) {
      close();
      return;
    }
    const r = o.anchor.getBoundingClientRect();
    const bw = root.offsetWidth;
    const bh = root.offsetHeight;
    const vw = window.innerWidth;
    const gap = 16;
    let left: number;
    let top: number;
    if (o.side === "right") {
      left = r.right + gap;
      top = r.top + r.height / 2 - 22;
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
}
