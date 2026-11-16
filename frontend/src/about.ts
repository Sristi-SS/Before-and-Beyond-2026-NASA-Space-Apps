// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The About page: what the site is, who made it, credits and sources, and a short form for bug
// reports and ideas.  The form needs no server: it opens a new, pre-filled note on the project's
// GitHub page, which the visitor reads and sends there.
import { CREATORS, REPO_URL, TEAM_NAME } from "./team";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export function initAbout(): void {
  const root = document.getElementById("about");
  if (!root) return;
  const team = document.getElementById("team-name");
  if (team) team.textContent = `Team ${TEAM_NAME}.`;
  const list = document.getElementById("creator-list");
  for (const c of CREATORS) {
    const li = node("li", "creator");
    li.append(node("b", "", c.name));
    if (c.role) li.append(node("span", "", c.role));
    if (c.about) li.append(node("p", "", c.about));
    if (c.link && /^https:\/\//.test(c.link)) {
      const a = node("a", "link", "GitHub");
      a.href = c.link;
      a.target = "_blank";
      a.rel = "noreferrer";
      li.append(a);
    }
    list?.append(li);
  }

  let lastFocus: HTMLElement | null = null;
  const open = (): void => {
    lastFocus = document.activeElement as HTMLElement | null;
    root.hidden = false;
    root.querySelector<HTMLElement>("[data-about-close]")?.focus();
  };
  const close = (): void => {
    root.hidden = true;
    lastFocus?.focus?.();
  };
  document.addEventListener("click", (ev) => {
    const hit = (ev.target as HTMLElement | null)?.closest("[data-about-open], [data-about-close]");
    if (!hit) return;
    if (hit.hasAttribute("data-about-open")) open();
    else close();
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  // Bug reports and ideas.
  let kind: "bug" | "idea" = "bug";
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-fb-kind]")];
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      kind = chip.dataset.fbKind === "idea" ? "idea" : "bug";
      for (const c of chips) c.setAttribute("aria-pressed", String(c === chip));
    });
  }
  const text = document.getElementById("fb-text") as HTMLTextAreaElement | null;
  const status = document.getElementById("fb-status");
  const all = document.getElementById("fb-list") as HTMLAnchorElement | null;
  if (all) all.href = `${REPO_URL}/issues`;
  document.getElementById("fb-send")?.addEventListener("click", () => {
    const words = (text?.value ?? "").trim();
    if (words.length < 5) {
      if (status) status.textContent = "Write a sentence or two first.";
      return;
    }
    const title = `${kind === "bug" ? "Bug" : "Idea"}: ${words.split(/\s+/).slice(0, 8).join(" ")}`.slice(0, 80);
    const body = `${words}\n\n---\nSent from the site. I was looking at: ${window.location.href}`;
    const url = `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    if (status) status.textContent = "GitHub opened in a new tab. Press its green button there to send.";
  });

  if (window.location.hash === "#about") open();
}
