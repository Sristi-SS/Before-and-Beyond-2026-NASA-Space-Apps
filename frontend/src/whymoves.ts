// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// The small moving drawing on the intro's "Why it moves" card.  A drawing, not data, and not to scale.
// Top: Earth circles the Sun, so the line of sight to a nearby object swings against the far-away stars.
// Bottom: where the object appears on the sky over three years: a steady drift (amber, dashed), a yearly
// sway (blue, dashed), and the two together (white), which is what a telescope sees.
const AMBER = "#ffa24a";
const AZURE = "#58b4ff";
const INK = "#eceff7";
const DIM = "#8a94b4";
const YEARS = 3;
const LOOP_MS = 9000;
const HOLD_MS = 1500;

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#05060c";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "15px 'Bricolage Grotesque Variable', system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const angle = t * 2 * Math.PI;

  // ---- top: the view from the side
  const sun = { x: 96, y: 138 };
  const earth = { x: sun.x + 30 * Math.cos(angle), y: sun.y - 62 * Math.sin(angle) };
  const obj = { x: 330, y: 150 - 8 * t };
  const wall = 512;
  const hit = obj.y + ((obj.y - earth.y) * (wall - obj.x)) / (obj.x - earth.x);
  ctx.strokeStyle = "rgba(138,148,180,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(sun.x, sun.y, 30, 62, 0, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 9, 0, 2 * Math.PI);
  ctx.fill();
  // far-away stars
  ctx.fillStyle = "#cfd6ea";
  for (let i = 0; i < 12; i++) {
    const y = 26 + i * 21 + (i % 3) * 3;
    ctx.fillRect(wall + ((i * 37) % 26), y, 2, 2);
  }
  // the line of sight, and where the object seems to be among the stars
  ctx.strokeStyle = "rgba(236,239,247,0.6)";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(earth.x, earth.y);
  ctx.lineTo(wall, hit);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = AZURE;
  ctx.beginPath();
  ctx.arc(earth.x, earth.y, 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(wall, hit, 7, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = DIM;
  ctx.textAlign = "center";
  ctx.fillText("Sun", sun.x, sun.y + 86);
  ctx.fillText("Earth, one lap a year", sun.x + 26, 22);
  ctx.fillText("nearby object", obj.x, obj.y - 24);
  ctx.textAlign = "right";
  ctx.fillText("far-away stars", w - 12, 258);

  // ---- bottom: position on the sky against time
  const gx = 70;
  const gy = 300;
  const gw = w - gx - 24;
  const gh = 210;
  const X = (yr: number): number => gx + (yr / YEARS) * gw;
  const drift = (yr: number): number => gy + gh - 46 - (yr / YEARS) * (gh - 92);
  const sway = (yr: number): number => 22 * Math.sin(yr * 2 * Math.PI);
  ctx.strokeStyle = "rgba(138,148,180,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx, gy + gh);
  ctx.lineTo(gx + gw, gy + gh);
  ctx.stroke();
  ctx.fillStyle = DIM;
  ctx.textAlign = "center";
  for (let yr = 1; yr <= YEARS; yr++) ctx.fillText(`${yr} yr`, X(yr), gy + gh + 16);
  ctx.save();
  ctx.translate(26, gy + gh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("position on the sky", 0, 0);
  ctx.restore();
  const curve = (f: (yr: number) => number, until: number, colour: string, dash: number[], width: number): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i <= 150; i++) {
      const yr = (i / 150) * until;
      if (i === 0) ctx.moveTo(X(yr), f(yr));
      else ctx.lineTo(X(yr), f(yr));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  curve(drift, YEARS, AMBER, [7, 6], 2);
  curve((yr) => gy + gh - 24 + sway(yr) * 0.8, YEARS, AZURE, [3, 5], 2);
  curve((yr) => drift(yr) + sway(yr), t, INK, [], 3);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(X(t), drift(t) + sway(t), 6, 0, 2 * Math.PI);
  ctx.fill();
}

/** Start the drawing; returns a function that stops it. */
export function startWhyMoves(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;
  const still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    draw(ctx, canvas.width, canvas.height, YEARS);
    return () => undefined;
  }
  let raf = 0;
  const t0 = performance.now();
  const tick = (now: number): void => {
    const phase = (now - t0) % (LOOP_MS + HOLD_MS);
    draw(ctx, canvas.width, canvas.height, Math.min(1, phase / LOOP_MS) * YEARS);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
