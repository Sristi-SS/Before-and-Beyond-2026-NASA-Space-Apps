// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Small extras: sound for the timeline (sonification), a share-link button, keyboard shortcuts.

/**
 * Sonification: one short tone per image.  The pitch follows the brightness at one pixel,
 * so a source that brightens, fades or moves away can be heard as well as seen.
 * The tones are made in the browser (Web Audio); nothing is recorded or downloaded.
 */
export class Sonifier {
  private ctx: AudioContext | null = null;
  enabled = false;

  constructor(private readonly button: HTMLButtonElement | null) {
    button?.addEventListener("click", () => this.set(!this.enabled));
  }

  set(on: boolean): void {
    this.enabled = on;
    this.button?.setAttribute("aria-pressed", String(on));
    if (on && !this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (on) void this.ctx?.resume();
  }

  /** `level` is the brightness from 0 (background) to 1 (brightest); other values are silent. */
  ping(level: number | null): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || level === null || !Number.isFinite(level)) return;
    const t = Math.min(1, Math.max(0, level));
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 196 * Math.pow(2, t * 2.6);     // about G3 (dark) to E6 (bright)
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

/** Copy the page address (it holds the whole view: target, band, image, motion). */
export function initShare(beforeCopy: () => void): void {
  const button = document.getElementById("share-link");
  if (!button) return;
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    beforeCopy();
    const label = button.firstChild;                      // the text node; the help dot stays
    const old = label?.textContent ?? "Share";
    let text = "Link copied";
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      text = "Copy the address bar";
    }
    if (label) label.textContent = text;
    window.setTimeout(() => {
      if (label) label.textContent = old;
      busy = false;
    }, 1800);
  });
}

/** Space = play, left/right = step one image, 1 to 5 = views.  Only in the cube scene. */
export function initShortcuts(): void {
  window.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || document.body.dataset.scene !== "cube") return;
    const t = ev.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON|CANVAS|SUMMARY|A)$/.test(t.tagName)) return;
    const timeline = document.getElementById("timeline") as HTMLInputElement | null;
    if (ev.key === " ") {
      ev.preventDefault();
      document.getElementById("play")?.click();
    } else if ((ev.key === "ArrowRight" || ev.key === "ArrowLeft") && timeline) {
      const max = Number(timeline.max);
      if (max <= 0) return;
      const next = (Number(timeline.value) + (ev.key === "ArrowRight" ? 1 : max)) % (max + 1);
      timeline.value = String(next);
      timeline.dispatchEvent(new Event("input"));
    } else if (/^[1-5]$/.test(ev.key)) {
      document.querySelectorAll<HTMLButtonElement>(".view-seg [data-view]")[Number(ev.key) - 1]?.click();
    }
  });
}
