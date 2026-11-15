// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Small extras: the share-link button and the keyboard shortcuts.

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

/** Space = play, left/right = step one picture, 1 to 4 = views.  Only in the cube scene. */
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
    } else if (/^[1-4]$/.test(ev.key)) {
      document.querySelectorAll<HTMLButtonElement>(".view-seg [data-view]")[Number(ev.key) - 1]?.click();
    }
  });
}
