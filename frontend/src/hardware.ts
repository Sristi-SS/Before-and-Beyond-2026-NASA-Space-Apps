// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
// Hardware bridge client (schema: hardware/EVENTS.md).  Drives the EXISTING on-screen
// controls; with no hardware connected the site behaves exactly as before.
const VMAX = 12; // arcsec/yr at full joystick deflection
const TILT_DEBOUNCE_MS = 350;

const params = new URLSearchParams(window.location.search);
const showIndicator = params.get("hw") === "1";

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let socket: WebSocket | null = null;
let backoff = 1000;
let tiltTimer = 0;
let lastLed = 0;

function send(msg: object): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function setIndicator(connected: boolean): void {
  const node = byId("hw-indicator");
  if (!node || !showIndicator) return;
  node.hidden = false;
  node.textContent = connected ? "hardware connected" : "hardware disconnected";
  node.dataset.kind = connected ? "online" : "offline";
}

function stepTimeline(delta: number): void {
  const t = byId<HTMLInputElement>("timeline");
  if (!t) return;
  const max = Number(t.max);
  if (max <= 0) return;
  t.value = String(Math.max(0, Math.min(max, Number(t.value) + delta)));
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

function joystick(x: number, y: number): void {
  const vx = byId<HTMLInputElement>("vx");
  const vy = byId<HTMLInputElement>("vy");
  if (!vx || !vy) return;
  const dead = (v: number): number => (Math.abs(v) < 0.08 ? 0 : v);
  vx.value = (dead(x) * VMAX).toFixed(1);
  vy.value = (dead(y) * VMAX).toFixed(1);
  window.clearTimeout(tiltTimer);
  tiltTimer = window.setTimeout(() => byId<HTMLButtonElement>("run-tilt")?.click(), TILT_DEBOUNCE_MS);
}

function handle(msg: { type?: string; [k: string]: unknown }): void {
  switch (msg.type) {
    case "encoder":
      stepTimeline(Number(msg.delta) || 0);
      break;
    case "button":
      if (msg.state !== "down") break;
      if (msg.id === "play") byId<HTMLButtonElement>("play")?.click();
      else if (msg.id === "reset") byId<HTMLButtonElement>("reset-tilt")?.click();
      else if (msg.id === "ask") byId<HTMLButtonElement>("find-motion")?.click();
      break;
    case "joystick":
      joystick(Number(msg.x) || 0, Number(msg.y) || 0);
      break;
    case "toggle": {
      const axis = byId<HTMLSelectElement>("axis");
      if (axis && (msg.value === "time" || msg.value === "wave")) {
        axis.value = String(msg.value);
        axis.dispatchEvent(new Event("change", { bubbles: true }));
      }
      break;
    }
    case "presence":
      setIndicator(Number(msg.devices) > 0);
      break;
    default:
      break;
  }
}

function connect(): void {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const token = params.get("hwtoken");
  const url = `${proto}://${window.location.host}/ws/hardware?role=browser${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  try {
    socket = new WebSocket(url);
  } catch {
    return;
  }
  socket.onopen = (): void => {
    backoff = 1000;
    setIndicator(false); // until a presence message says a device is there
  };
  socket.onmessage = (ev: MessageEvent): void => {
    try {
      handle(JSON.parse(String(ev.data)));
    } catch {
      /* ignore malformed relay messages */
    }
  };
  socket.onclose = (): void => {
    socket = null;
    setIndicator(false);
    window.setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  socket.onerror = (): void => socket?.close();
}

export function initHardware(): void {
  // Only a page opened with ?hw=1 (the exhibit screen) joins the hardware socket.  An ordinary
  // visitor's page must not take a seat on it, nor be steered by somebody else's controller.
  if (!showIndicator) return;
  // Output side: LED ring direction = current (vx, vy); sharpness = normalised tilt score.
  window.addEventListener("tilt-start", () => send({ type: "status", state: "processing" }));
  window.addEventListener("tilt-result", (ev) => {
    const d = (ev as CustomEvent<{ vx: number; vy: number; ratio: number }>).detail;
    const angle = (Math.atan2(d.vx, d.vy) * 180) / Math.PI; // 0 = north (+vy), 90 = east (+vx)
    const sharp = Number.isFinite(d.ratio) ? Math.max(0, Math.min(1, (d.ratio - 1) / 0.6)) : 0;
    const now = Date.now();
    if (now - lastLed > 100) {
      lastLed = now;
      send({ type: "led_ring", angle_deg: (angle + 360) % 360, sharpness: sharp });
    }
    send({ type: "status", state: d.ratio >= 1.4 ? "candidate" : "ready" });
    const r = Number.isFinite(d.ratio) ? d.ratio.toFixed(2) : "-";
    send({ type: "oled", lines: [`vx ${d.vx.toFixed(1)}`, `vy ${d.vy.toFixed(1)}`, `x${r}`] });
  });
  connect();
}
