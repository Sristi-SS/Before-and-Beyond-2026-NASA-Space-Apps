// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Short, checked facts about the five test objects and the bright stars named on the globe.
// They appear in the "Did you know?" card on the Sky page, in the card of a place you pick,
// and under Controls, About when a cube of a test object is open.
export const FACTS: Record<string, string> = {
  "Barnard's Star": "Barnard's Star is the fastest-moving star in our sky: it crosses the width of the full Moon in about 180 years. It is a small red star only six light-years away, too faint to see without a telescope.",
  "Epsilon Indi B": "Epsilon Indi B is really two brown dwarfs circling each other, about 12 light-years away. Brown dwarfs are too small to shine like stars and too big to be called planets.",
  "WISE 0855": "WISE 0855 is the coldest brown dwarf known, well below freezing. It was found in 2014 because it moved between pictures from the WISE telescope, the same trick this site uses. Only three star systems are closer to the Sun.",
  "RW Aurigae": "RW Aurigae is a young pair of stars, only a few million years old. Every so often it fades for months, probably because dust from the disc around one of the stars drifts in front of it.",
  "R Draconis": "R Draconis is a swollen red giant that pulses like a slow heartbeat: it brightens and fades about every eight months.",
  "Sirius": "Sirius is the brightest star in the night sky, 8.6 light-years away. It has a tiny companion: a white dwarf about the size of Earth with about the mass of the Sun.",
  "Canopus": "Canopus is the second-brightest star in the night sky. Spacecraft use it as a guide star to know which way they are pointing.",
  "Rigil Kentaurus": "Rigil Kentaurus (Alpha Centauri) belongs to the closest star system to the Sun: its light takes a little over four years to reach us.",
  "Arcturus": "Arcturus is the brightest star in the northern half of the sky. In 1933 its light, caught by telescopes, was used to switch on the lights of the Chicago World's Fair.",
  "Vega": "Vega was the North Star about 14,000 years ago and will be again in about 12,000 years, because Earth's axis slowly wobbles. In 1850 it became the first star after the Sun to be photographed.",
  "Capella": "Capella looks like one star but is four: two yellow giants circling closely, and two small red stars far from them.",
  "Rigel": "Rigel is a blue supergiant that shines with the light of tens of thousands of Suns. It is the brightest star of Orion.",
  "Procyon": "Procyon means \"before the dog\" in Greek: it rises just before Sirius, the Dog Star. It is one of our nearest neighbours, 11.5 light-years away.",
  "Betelgeuse": "Betelgeuse is a red supergiant so large that, in the Sun's place, it would swallow the orbits of Mercury, Venus, Earth and Mars. In late 2019 it dimmed sharply after throwing out a cloud of dust.",
  "Achernar": "Achernar spins so fast that it is squashed: it is much wider across its equator than from pole to pole.",
  "Hadar": "Hadar (Beta Centauri) is a system of three stars. With Rigil Kentaurus it points the way to the Southern Cross.",
  "Altair": "Altair spins once in about nine hours (the Sun takes almost a month), which flattens it at the poles. It is 17 light-years away.",
  "Acrux": "Acrux is the brightest star of the Southern Cross. It looks like one star but is several.",
  "Aldebaran": "Aldebaran is the red eye of Taurus the bull. The Pioneer 10 spacecraft is drifting in its direction and would need about two million years to get that far.",
  "Antares": "Antares means \"rival of Mars\", because of its red colour. It is a supergiant so big that, in the Sun's place, it would reach past the orbit of Mars.",
  "Spica": "Spica is two stars so close together that they circle each other every four days and pull each other into egg shapes.",
  "Pollux": "Pollux is the nearest giant star to the Sun, 34 light-years away, and it has at least one planet.",
  "Fomalhaut": "Fomalhaut is surrounded by a huge ring of dust and rubble, like a young, oversized version of the belt of icy bodies beyond Neptune.",
  "Deneb": "Deneb is one of the most luminous stars you can see without a telescope. It is well over a thousand light-years away and still among the twenty brightest stars.",
  "Mimosa": "Mimosa is the second-brightest star of the Southern Cross: a hot blue giant about 280 light-years away.",
  "Regulus": "Regulus spins once in about 16 hours, so fast that it bulges at the equator. It sits almost exactly on the path the Sun follows across the sky.",
  "Castor": "Castor looks like one star to the eye, but it is six stars in three close pairs.",
  "Gacrux": "Gacrux, at the top of the Southern Cross, is the nearest red giant to the Sun, about 88 light-years away.",
  "Polaris": "Polaris, the North Star, sits almost exactly above Earth's north pole, so the whole sky seems to turn around it. It also pulses slightly every four days.",
};

const GENERAL = [
  "SPHEREx was launched in March 2025. It photographs the whole sky in 102 infrared colours, twice a year.",
  "Every picture on this site is 13 arcminutes across: a bit less than half the width of the full Moon.",
  "The oldest pictures here were taken in 2010 by the WISE telescope and the newest by SPHEREx, so some cubes span 16 years.",
  "Astronomers have looked for a ninth planet far beyond Neptune for years. If it exists, one trip around the Sun would take it ten thousand years or more.",
  "A nearby object seems to sway back and forth once a year, because we watch it from a moving Earth. The sway is called parallax, and it tells us how far away the object is.",
];

const key = (name: string): string => name.trim().toLowerCase();
const BY_NAME = new Map(Object.entries(FACTS).map(([name, fact]) => [key(name), fact]));

/** The fact about a named object, or null when there is none. */
export function factFor(name: string | null | undefined): string | null {
  return name ? BY_NAME.get(key(name)) ?? null : null;
}

/** The "Did you know?" card on the Sky page: a fact at random, and a button for another. */
export function initFacts(): void {
  const text = document.getElementById("fact-text");
  const next = document.getElementById("fact-next");
  if (!text || !next) return;
  const all = [...GENERAL, ...Object.values(FACTS)];
  let order: number[] = [];
  const show = (): void => {
    if (order.length === 0) order = all.map((_, i) => i).sort(() => Math.random() - 0.5);
    text.textContent = all[order.pop() as number];
  };
  next.addEventListener("click", show);
  show();
}
