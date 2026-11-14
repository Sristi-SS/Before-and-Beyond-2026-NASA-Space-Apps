// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Kiosk (?kiosk=1) and projection (?projection=1) modes, plus the full-screen demo button.
import { showScene } from "./scenes";

const params = new URLSearchParams(window.location.search);
const on = (k: string): boolean => params.get(k) === "1" || params.get(k) === "true";
const KIOSK_IDLE_MS = 3 * 60_000;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function playButton(): HTMLButtonElement | null {
  return document.getElementById("play") as HTMLButtonElement | null;
}

/** Start the current cube playing as soon as it has more than one slice (never with reduced motion). */
function autoPlay(): void {
  if (reducedMotion()) return;
  const tick = window.setInterval(() => {
    const play = playButton();
    const timeline = document.getElementById("timeline") as HTMLInputElement | null;
    if (!play || !timeline || document.body.dataset.scene !== "cube") return;
    if (Number(timeline.max) > 0) {
      if (play.textContent === "Play") play.click();
      window.clearInterval(tick);
    }
  }, 1000);
}

function startKiosk(): void {
  document.body.classList.add("kiosk");
  let timer = 0;
  const reset = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const play = playButton();
      if (play && play.textContent === "Pause") play.click();
      const zero = document.getElementById("reset-tilt") as HTMLButtonElement | null;
      zero?.click();
      showScene("globe");
    }, KIOSK_IDLE_MS);
  };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(ev, reset, { passive: true });
  }
  reset();
}

export function initModes(): void {
  if (on("kiosk")) startKiosk();
  if (on("projection")) {
    document.body.classList.add("projection");
    autoPlay();
  }
  const button = document.getElementById("fullscreen-demo");
  button?.addEventListener("click", () => {
    document.body.classList.add("projection");
    autoPlay();
    void document.documentElement.requestFullscreen?.().catch(() => {
      /* fullscreen refused; projection styling still applies */
    });
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !on("projection")) document.body.classList.remove("projection");
  });
}
