// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// "How this works": plain-English glossary.

export const GLOSSARY: Array<[string, string]> = [
  ["Epoch", "One moment when the telescope looked at this patch of sky. Each frame in the cube is one epoch."],
  ["Pass", "A visit. SPHEREx scans the whole sky about every six months, so frames taken within a couple of months of each other belong to the same pass."],
  ["Wavelength group", "SPHEREx splits infrared light into six detector groups, each covering a range of wavelengths (colours our eyes cannot see). WISE adds two more bands, W1 and W2. Frames are only added together within one group."],
  ["False colour", "The colours on screen are a visualisation of non-visible infrared light, chosen by us (blue is faint, orange is bright). They are not what an eye would see."],
  ["Artifact", "Something in an image that is not a real object: a bad pixel, a cosmic-ray hit, a ghost, a bright star's glare, or a detector edge."],
  ["Proper motion", "The slow drift of a star across the sky over the years, measured in arcseconds per year. A nearby star can drift far enough to show up as movement between epochs."],
  ["Shift-and-stack", "Shift every frame by the amount a moving object would have travelled, then add them up. If the guess is right, the faint object adds up into one clear spot while the rest smears out."],
  ["Candidate", "A spot that might be a moving object. A candidate is never a confirmed discovery: it needs checking in several bands, against catalogues, and by experts."],
];

export function renderGlossary(root: HTMLElement): void {
  root.replaceChildren();
  const summary = document.createElement("summary");
  summary.textContent = "How this works";
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent =
    "Display colours are visualisations of non-visible infrared light, and candidates are never confirmed discoveries.";
  const list = document.createElement("dl");
  list.className = "glossary-list";
  for (const [term, meaning] of GLOSSARY) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = meaning;
    list.append(dt, dd);
  }
  root.append(summary, intro, list);
}
