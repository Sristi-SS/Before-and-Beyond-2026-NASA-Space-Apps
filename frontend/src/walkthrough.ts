// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// First-visit walkthroughs: the first time a visitor opens each view of the time cube, a pixel speech
// bubble walks them through it in three steps at most (BACK / NEXT).  Each control is pointed at by one
// step only, and each view says one idea.
import { showSteps, type Step } from "./bubble";

const STEPS: Record<string, Step[]> = {
  cube: [
    {
      anchor: ".view-seg", side: "below", title: "Five ways to look",
      text: "CUBE stacks the years like slices of bread. BLINK, COLOUR and COMPARE show the same pictures other ways.",
    },
    {
      anchor: "#play", side: "above", title: "Press play",
      text: "Watch the years run. Faraway stars stay put; the nearby star walks across the picture.",
    },
    {
      anchor: "#handle-right", side: "left", title: "More tools",
      text: "The measuring tools live here when you want them: line the years up along a motion, list candidates, check the data.",
    },
  ],
  blink: [
    {
      anchor: "#play", side: "above", title: "A flip book",
      text: "One picture at a time, oldest to newest. Press play or drag the slider and watch for the dot that jumps.",
    },
  ],
  colour: [
    {
      anchor: "#colour-canvas", side: "right", title: "All years in one picture",
      text: "Early years are painted blue, late years orange. Still stars add up to white; a star that moved leaves a blue-to-orange trail.",
    },
  ],
  compare: [
    {
      anchor: ".cmp-controls .field", side: "below", title: "Pick two dates",
      text: "A is the older picture, B the newer one. The first and last are already picked.",
    },
    {
      anchor: ".cmp-modes", side: "below", title: "Three ways to compare",
      text: "Side by side, a line you swipe across, or Difference: blue where something was, orange where it is now.",
    },
    {
      anchor: ".cmp-legend", side: "above", title: "Find the mover",
      text: "Most stars stay in the same place. The one that changed place is the nearby star.",
    },
  ],
  map: [
    {
      anchor: "#map-canvas", side: "right", title: "Every speed, tested",
      text: "Each square tries one speed and direction. The brightest square is the motion that lines the pictures up best.",
    },
    {
      anchor: "#map-info", side: "above", title: "A lead, not a find",
      text: "The best square is a candidate to check against other colours and catalogues, never a discovery on its own.",
    },
  ],
};

/** Run the walkthrough for this view if the visitor has not seen it yet (call once the view is drawn). */
export function walkthrough(view: string): void {
  const steps = STEPS[view];
  if (!steps || document.body.classList.contains("intro-open")) return;
  window.setTimeout(() => showSteps(`walk-${view}`, steps), 700);
}
