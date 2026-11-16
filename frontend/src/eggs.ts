// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Three small secrets.  They only touch the background stars and a short message; they never touch
// the pictures, the tools or the data.
//   1. The classic arcade code (up up down down left right left right B A): a meteor shower.
//   2. Typing "planetx": one shooting star and a note.
//   3. Pressing the name in the top-left corner five times quickly: the background stars dance.
import { shootingStars, starParty } from "./starfield";

const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** A short message at the bottom of the screen that goes away by itself. */
export function toast(text: string): void {
  document.querySelector(".toast")?.remove();
  const box = document.createElement("div");
  box.className = "toast";
  box.setAttribute("role", "status");
  box.textContent = text;
  document.body.append(box);
  window.setTimeout(() => box.remove(), 5000);
}

export function initEggs(): void {
  let step = 0;
  let typed = "";
  window.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    step = key === CODE[step] ? step + 1 : key === CODE[0] ? 1 : 0;
    if (step === CODE.length) {
      step = 0;
      shootingStars(12);
      toast("Secret found: a meteor shower. Make a wish.");
    }
    if (key.length === 1) {
      typed = (typed + key).slice(-7);
      if (typed === "planetx") {
        typed = "";
        shootingStars(1);
        toast("Planet X is still hiding. Nobody has found it yet. Keep looking.");
      }
    }
  });
  let presses = 0;
  let timer = 0;
  document.querySelector(".brand")?.addEventListener("click", () => {
    presses += 1;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { presses = 0; }, 1500);
    if (presses >= 5) {
      presses = 0;
      starParty(10);
      toast("Secret found: a star party. The background stars are dancing.");
    }
  });
}
