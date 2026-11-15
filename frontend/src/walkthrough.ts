// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// One first-visit walkthrough, three steps, the first time a cube is on screen.  The other views need
// no pop-up: the line under the view buttons says what each one shows.
import { showSteps, type Step } from "./bubble";

const STEPS: Step[] = [
  {
    anchor: ".view-seg", side: "below", title: "Four ways to look",
    text: "The same pictures, four ways. The line under these buttons says what each one shows.",
  },
  {
    anchor: "#play", side: "above", title: "Press play",
    text: "Watch the years run. Far-away stars stay put; a nearby one walks across the picture.",
  },
  {
    anchor: "#handle-right", side: "left", title: "Tools",
    text: "When you want more: let the computer find what moves, line the pictures up yourself, or practise on a made-up planet.",
  },
];

/** Run the walkthrough once (call when a cube is drawn). */
export function walkthrough(_view: string): void {
  if (document.body.classList.contains("intro-open")) return;
  window.setTimeout(() => showSteps("walk-cube", STEPS), 700);
}
