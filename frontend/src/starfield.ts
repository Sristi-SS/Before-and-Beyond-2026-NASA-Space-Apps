// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// A sparse, slowly twinkling star background behind every page.  Decoration only: it is not data,
// it sits behind the pictures, and it holds still when the visitor asks for reduced motion.
// Three depths: far stars are small, dim and barely move with the pointer; near ones are larger,
// brighter and move a little more.  Once in a long while a shooting star crosses the sky.
interface Star { x: number; y: number; depth: number; base: number; speed: number; phase: number; warm: boolean }
interface Meteor { x: number; y: number; vx: number; vy: number; age: number; life: number }

let width = 0;
let height = 0;
let still = false;
let party = 0;
const meteors: Meteor[] = [];

function spawn(): void {
  if (still || width === 0) return;
  const fromLeft = Math.random() < 0.5;
  const speed = 520 + Math.random() * 380;
  const angle = ((fromLeft ? 22 : 158) * Math.PI) / 180 + (Math.random() - 0.5) * 0.3;
  meteors.push({
    x: fromLeft ? Math.random() * width * 0.5 : width * (0.5 + Math.random() * 0.5),
    y: Math.random() * height * 0.35,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: 0.8 + Math.random() * 0.5,
  });
}

/** Send `n` shooting stars across the background. */
export function shootingStars(n = 1): void {
  for (let i = 0; i < n; i++) window.setTimeout(spawn, i * 260 + Math.random() * 200);
}

/** Make the background stars twinkle fast and in colour for a few seconds. */
export function starParty(seconds = 10): void {
  if (!still) party = seconds;
}

export function initStarfield(): void {
  const canvas = document.createElement("canvas");
  canvas.id = "starfield";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let stars: Star[] = [];
  let mx = 0, my = 0, px = 0, py = 0;

  const draw = (t: number, dt: number): void => {
    ctx.clearRect(0, 0, width, height);
    px += (mx - px) * 0.06;
    py += (my - py) * 0.06;
    for (const s of stars) {
      const twinkle = still ? 1 : 0.62 + 0.38 * Math.sin(t * s.speed * (party > 0 ? 6 : 1) + s.phase);
      const shift = 3 + s.depth * 14;
      const x = Math.round(s.x - px * shift);
      const y = Math.round(s.y - py * shift);
      ctx.globalAlpha = s.base * twinkle;
      ctx.fillStyle = party > 0 ? `hsl(${Math.round(s.phase * 57 + t * 90) % 360} 90% 70%)` : s.warm ? "#ffd9a8" : "#dfe8ff";
      const size = s.depth > 0.6 ? 2 : 1;
      ctx.fillRect(x, y, size, size);
      if (s.depth > 0.88) {            // the nearest few get a small cross
        ctx.fillRect(x - 2, y, 6, size);
        ctx.fillRect(x, y - 2, size, 6);
      }
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age > m.life) { meteors.splice(i, 1); continue; }
      const fade = 1 - m.age / m.life;
      const tail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.16, m.y - m.vy * 0.16);
      tail.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
      tail.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tail;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.16, m.y - m.vy * 0.16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const layout = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Scarce on purpose: about one star per 150 x 150 pixels.
    const count = Math.max(36, Math.min(90, Math.round((width * height) / 22000)));
    stars = Array.from({ length: count }, () => {
      const depth = Math.random();
      return {
        x: Math.random() * width, y: Math.random() * height, depth, base: 0.22 + depth * 0.5,
        speed: 0.4 + Math.random() * 1.1, phase: Math.random() * 6.283, warm: Math.random() < 0.15,
      };
    });
    draw(performance.now() / 1000, 0);
  };
  layout();
  window.addEventListener("resize", layout);
  if (still) return;

  window.addEventListener("pointermove", (ev) => {
    mx = ev.clientX / Math.max(1, width) - 0.5;
    my = ev.clientY / Math.max(1, height) - 0.5;
  });
  let last = performance.now();
  const tick = (now: number): void => {
    window.requestAnimationFrame(tick);
    if (document.hidden || now - last < 45) return;     // about 20 pictures a second is plenty
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (party > 0) party = Math.max(0, party - dt);
    draw(now / 1000, dt);
  };
  window.requestAnimationFrame(tick);
  const ambient = (): void => {
    if (!document.hidden) spawn();
    window.setTimeout(ambient, 45000 + Math.random() * 60000);
  };
  window.setTimeout(ambient, 30000 + Math.random() * 30000);
}
