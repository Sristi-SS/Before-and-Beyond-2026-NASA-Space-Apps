// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The people behind the site, shown on the About page.  Edit this list: one entry per person.
// `role` (what you did), `about` (a line about you) and `link` are optional and are left out when empty.
export interface Creator {
  name: string;
  role?: string;
  about?: string;
  link?: string;
}

export const TEAM_NAME = "Before and Beyond";

export const CREATORS: Creator[] = [
  { name: "Arush", role: "", about: "", link: "https://github.com/Arusshh" },
  { name: "Aditya", role: "", about: "", link: "https://github.com/AdityaGaur77" },
  { name: "Sristi", role: "", about: "", link: "https://github.com/Sristi-SS" },
  { name: "Nishadh", role: "", about: "", link: "https://github.com/nishadhmulay" },
];

/** Where bug reports and ideas are sent (GitHub Issues of this repository). */
export const REPO_URL = "https://github.com/Sristi-SS/Before-and-Beyond-2026-NASA-Space-Apps";
