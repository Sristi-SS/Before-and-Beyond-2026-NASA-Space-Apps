// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// A short guided tour: a small non-modal coach panel that drives the page through the DOM.
// It only loads the cached WISE 0855 cube; it never starts anything else on the archive.

interface Step {
  title: string;
  text: string;
  /** Element to outline while the step is shown. */
  target: string;
  run?: () => Promise<void> | void;
  /** Label of an extra button, and what it does. */
  extra?: { label: string; run: () => void };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(test: () => boolean, ms = 90000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(150);
  }
  return false;
}

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

function chip102(): HTMLButtonElement | null {
  return q<HTMLButtonElement>('#group-picker button[data-value="102"][data-movie="0"]');
}

function framesReady(): boolean {
  const t = q<HTMLInputElement>("#timeline");
  const label = q("#slice-label")?.textContent ?? "";
  return !!t && Number(t.max) > 0 && !/Fetching|Loading/.test(label);
}

const STEPS: Step[] = [
  {
    title: "Pick WISE 0855",
    text:
      "WISE 0855 is one of the coldest, nearest known objects and one of the fastest movers on the sky. We load the cached cube for it: real archive images, nothing new is requested.",
    target: "#target-select",
    run: async () => {
      // Skip loading only when the cube on screen really is WISE 0855 (not just any cube with a W2 group).
      const raNow = Number(q<HTMLInputElement>("#ra")?.value);
      if (chip102() && Math.abs(raNow - 133.8189) < 0.05) return;
      const select = q<HTMLSelectElement>("#target-select");
      const option = [...(select?.options ?? [])].find((o) => /wise\s*0855/i.test(o.textContent ?? ""));
      if (!select || !option) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change"));
      const fov = q<HTMLSelectElement>("#fov");
      const frames = q<HTMLSelectElement>("#max-frames");
      if (fov) fov.value = "0.2";
      if (frames) frames.value = "40";
      q<HTMLButtonElement>("#build")?.click();
      await waitFor(() => !!chip102() && framesReady());
    },
  },
  {
    title: "Choose WISE W2",
    text:
      "WISE took pictures from 2010 to 2024, about fourteen years. The W2 group (4.6 micrometres) shows this object best. Its chip is now selected.",
    target: "#group-picker",
    run: async () => {
      chip102()?.click();
      await sleep(300);
      await waitFor(framesReady, 30000);
    },
  },
  {
    title: "Play the movie",
    text:
      "Watch the frames play in time order. The faint dot that creeps across the field is the mover; the stars stay put. Use Pause at the bottom whenever you like.",
    target: "#play",
    run: () => {
      const play = q<HTMLButtonElement>("#play");
      if (play && play.textContent === "Play") play.click();
    },
  },
  {
    title: "Use catalogue motion",
    text:
      "The catalogue knows how fast this object moves. This button fills that motion into the tilt, which shifts every frame to follow it and adds them up. The object snaps into focus as a single sharp spot on the right, while the stars smear. A spot like this would be a candidate, never a confirmed discovery.",
    target: "#use-catalogue",
    run: async () => {
      const play = q<HTMLButtonElement>("#play");
      if (play && play.textContent === "Pause") play.click();
      const button = q<HTMLButtonElement>("#use-catalogue");
      if (button && !button.disabled) {
        button.click();
        await sleep(600);
        q("#tilt-canvas")?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    },
  },
  {
    title: "Now try the simulator",
    text:
      "Want to practise on something you can check? The simulator plants a made-up object in copies of the frames, clearly marked as simulated, and lets you hunt for it with the motion map.",
    target: "#sim-panel",
    extra: {
      label: "Open the simulator",
      run: () => {
        const panel = q("#sim-panel");
        panel?.scrollIntoView({ block: "start", behavior: "smooth" });
        q<HTMLInputElement>("#sim-toggle")?.focus();
      },
    },
  },
];

export class Tour {
  private index = 0;
  private open = false;
  private busy = false;
  private auto = false;
  private timer = 0;
  private highlighted: Element | null = null;
  private readonly title = document.createElement("h2");
  private readonly count = document.createElement("p");
  private readonly text = document.createElement("p");
  private readonly back = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly close = document.createElement("button");
  private readonly extra = document.createElement("button");

  constructor(private readonly root: HTMLElement) {
    root.className = "tour";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    this.title.id = "tour-title";
    root.setAttribute("aria-labelledby", "tour-title");
    this.count.className = "hint small";
    this.text.className = "tour-text";
    this.text.setAttribute("aria-live", "polite");
    this.back.textContent = "Back";
    this.next.textContent = "Next";
    this.next.className = "primary";
    this.close.textContent = "Close";
    this.close.className = "ghost";
    this.extra.className = "grow";
    this.extra.hidden = true;
    for (const b of [this.back, this.next, this.close, this.extra]) b.type = "button";
    const row = document.createElement("div");
    row.className = "row";
    row.append(this.back, this.next, this.close);
    root.append(this.count, this.title, this.text, this.extra, row);
    this.back.addEventListener("click", () => void this.go(this.index - 1, false));
    this.next.addEventListener("click", () => {
      if (this.index >= STEPS.length - 1) this.stop();
      else void this.go(this.index + 1, true);
    });
    this.close.addEventListener("click", () => this.stop());
    this.extra.addEventListener("click", () => STEPS[this.index].extra?.run());
    // Any click in the card takes the wheel back from the auto demo.
    root.addEventListener("pointerdown", () => {
      this.auto = false;
      window.clearTimeout(this.timer);
    });
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.stop();
    });
  }

  /** `auto` = the one-minute demo: every step runs by itself, about 10 seconds apart. */
  start(auto = false): void {
    this.auto = auto;
    window.clearTimeout(this.timer);
    this.open = true;
    this.root.hidden = false;
    void this.go(0, true);
  }

  private stop(): void {
    this.auto = false;
    window.clearTimeout(this.timer);
    this.open = false;
    this.root.hidden = true;
    this.highlighted?.classList.remove("tour-target");
    this.highlighted = null;
  }

  private async go(i: number, runAction: boolean): Promise<void> {
    if (!this.open || this.busy) return;
    this.index = Math.max(0, Math.min(STEPS.length - 1, i));
    const step = STEPS[this.index];
    this.title.textContent = step.title;
    this.count.textContent = `Step ${this.index + 1} of ${STEPS.length}`;
    this.text.textContent = step.text;
    this.extra.hidden = !step.extra;
    this.extra.textContent = step.extra?.label ?? "";
    this.back.disabled = this.index === 0;
    this.next.textContent = this.index === STEPS.length - 1 ? "Finish" : "Next";
    this.highlighted?.classList.remove("tour-target");
    this.highlighted = q(step.target);
    this.highlighted?.classList.add("tour-target");
    this.highlighted?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (runAction && step.run) {
      this.busy = true;
      this.next.disabled = true;
      this.back.disabled = true;
      this.count.textContent += " — working…";
      try {
        await step.run();
      } finally {
        this.busy = false;
        this.next.disabled = false;
        this.back.disabled = this.index === 0;
        this.count.textContent = `Step ${this.index + 1} of ${STEPS.length}`;
      }
    }
    if (this.open && !this.auto) this.next.focus();
    if (this.open && this.auto) {
      this.count.textContent = `Auto demo \u00b7 step ${this.index + 1} of ${STEPS.length} \u00b7 click this card to take over`;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (!this.auto) return;
        if (this.index >= STEPS.length - 1) this.stop();
        else void this.go(this.index + 1, true);
      }, 10000);
    }
  }
}
