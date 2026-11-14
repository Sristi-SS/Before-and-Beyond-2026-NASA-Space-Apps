// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".

export interface FrameMeta {
  id: string;
  index: number;
  obs_time: string;
  mjd: number;
  detector: number;
  wavelength_um: number;
  bandwidth_um: number;
  masked_fraction: number;
  coverage: number;
  pass: number;
  status: string;
  provenance_url: string;
  /** "spherex" (default when absent) or "wise". */
  source?: string;
  collection?: string;
  band?: string;
  epoch?: number;
  unit?: string;
}

export interface SliceMeta {
  pass: number;
  detector: number;
  mjd: number;
  obs_time: string;
  wavelength_um: number;
  bandwidth_um: number;
  n_frames: number;
  member_ids: string[];
  simple_noise?: number;
}

export interface GroupMeta {
  detector: number;
  wavelength_um: number;
  bandwidth_um: number;
  range_um: [number, number];
  count: number;
  passes: number[];
  slices: number;
}

export interface JobStatus {
  key: string;
  status: "queued" | "running" | "done" | "error";
  phase: string;
  progress: { done: number; total: number };
  frames: FrameMeta[];
  groups: GroupMeta[];
  slices: SliceMeta[];
  target?: {
    name: string;
    ra_deg: number;
    dec_deg: number;
    search_ra_deg?: number;
    search_dec_deg?: number;
    pm_ra?: number;
    pm_dec?: number;
    /** Catalogue proper motion (mas/yr; pmra includes cos dec). */
    pmra_mas_yr?: number;
    pmdec_mas_yr?: number;
  };
  wise?: { status: string; n: number; message: string };
  grid?: {
    npix: number;
    pixscale_arcsec: number;
    fov_arcsec: number;
    center_ra: number;
    center_dec: number;
  };
  release?: string;
  error?: string;
  collections?: string[];
}

export interface TargetInfo {
  key: string;
  name: string;
  ra_deg?: number;
  dec_deg?: number;
  pmra_mas_yr?: number;
  pmdec_mas_yr?: number;
  source?: string;
}

export interface CubeData {
  npix: number;
  /** One entry per slice.  The pixels and the metadata always belong together. */
  frames: Array<{ meta: FrameMeta; data: Float32Array }>;
}

export interface TiltResult {
  data: Float32Array;
  npix: number;
  score: number;
  min: number;
  max: number;
  shifts: [number, number][];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

export function health(): Promise<{ ok: boolean; release: string; collections: string[] }> {
  return json("/api/health");
}

export function targets(): Promise<{ targets: TargetInfo[] }> {
  return json("/api/targets");
}

export function createJob(body: Record<string, unknown>): Promise<{ key: string; status: JobStatus }> {
  return json("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** One ranked motion candidate (a candidate, never a detection). */
export interface Candidate {
  rank: number;
  vx: number;
  vy: number;
  speed_arcsec_yr: number;
  pa_deg: number;
  score: number;
  ratio: number | null;
  x: number;
  y: number;
  ra_deg: number | null;
  dec_deg: number | null;
  patch_score: number;
  path: Array<{
    index: number; detector: number; mjd: number; obs_time: string; used: boolean;
    x: number; y: number; ra_deg: number | null; dec_deg: number | null; inside: boolean;
  }>;
  today: { mjd: number; x: number; y: number; ra_deg: number | null; dec_deg: number | null; inside: boolean };
}

export interface CandidateResult {
  detector: number;
  n_frames: number;
  zero_score: number;
  caution: string;
  model: { name: string; parameters: number; trained_on: string; validation_accuracy_on_simulated: number; note: string };
  candidates: Candidate[];
}

export function fetchCandidates(key: string, detector: number, span: number, step: number): Promise<CandidateResult> {
  const q = new URLSearchParams({ detector: String(detector), span: String(span), step: String(step), top: "5" });
  return json(`/api/jobs/${encodeURIComponent(key)}/candidates?${q}`);
}

export interface UpdateInfo {
  busy?: boolean;
  offline?: boolean;
  has_news: boolean;
  frames_in_cube?: number;
  archive_images?: number;
  newest_in_cube?: string | null;
  newest_in_archive?: string | null;
  new_images?: number;
  new_nights?: number;
  new_collections?: string[];
  built_date?: string;
}

export function fetchUpdates(key: string, fresh = false): Promise<UpdateInfo> {
  return json(`/api/jobs/${encodeURIComponent(key)}/updates${fresh ? "?fresh=true" : ""}`);
}

export function refreshJob(key: string): Promise<{ key: string; status: string }> {
  return json(`/api/jobs/${encodeURIComponent(key)}/refresh`, { method: "POST" });
}

export function getJob(key: string): Promise<JobStatus> {
  return json(`/api/jobs/${encodeURIComponent(key)}`);
}

export async function waitForJob(
  key: string,
  onUpdate: (status: JobStatus) => void,
): Promise<JobStatus> {
  const started = Date.now();
  for (;;) {
    const status = await getJob(key);
    onUpdate(status);
    if (status.status === "done" || status.status === "error") return status;
    if (Date.now() - started > 15 * 60_000) throw new Error("job is taking too long");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function headerNumber(res: Response, name: string, fallback: number): number {
  const raw = res.headers.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** All aligned individual frames for one detector (0 = every detector). */
export async function fetchFrameCube(key: string, detector: number): Promise<CubeData> {
  const res = await fetch(
    `/api/jobs/${encodeURIComponent(key)}/frames_cube?detector=${detector}`,
  );
  if (!res.ok) throw new Error(`frame cube failed: ${res.status} ${res.statusText}`);
  const all = new Float32Array(await res.arrayBuffer());
  // Read the job after the cube.  A running job only adds frames, so this list
  // then covers every slice in the cube.
  const job = await getJob(key);
  const npix = headerNumber(res, "X-Npix", job.grid?.npix ?? 128);
  const size = npix * npix;
  const nsl = Math.floor(all.length / size);

  // The server says which frame each slice is.  Pairing by position alone can
  // put the wrong date on a slice while the job is still adding frames.
  let indices: number[] | null = null;
  try {
    const raw = res.headers.get("X-Frame-Index");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) indices = parsed.map(Number);
  } catch {
    indices = null;
  }
  const byIndex = new Map(job.frames.map((f) => [f.index, f]));
  const byOrder = job.frames
    .filter((f) => f.status === "ok" && (detector === 0 || f.detector === detector))
    .sort((a, b) => a.mjd - b.mjd);

  const frames: CubeData["frames"] = [];
  for (let i = 0; i < nsl; i += 1) {
    const meta = indices ? byIndex.get(indices[i]) : byOrder[i];
    if (meta) frames.push({ meta, data: all.subarray(i * size, (i + 1) * size) });
  }
  return { npix, frames };
}

export async function fetchTilt(
  key: string,
  detector: number,
  vx: number,
  vy: number,
  source: "frames" | "slices" = "frames",
  staticMode: "median" | "none" = "none",
): Promise<TiltResult> {
  const url =
    `/api/jobs/${encodeURIComponent(key)}/tilt?detector=${detector}` +
    `&vx=${vx}&vy=${vy}&source=${source}&static=${staticMode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tilt failed: ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  const shifts = JSON.parse(res.headers.get("X-Shifts") ?? "[]") as [number, number][];
  return {
    data: new Float32Array(buffer),
    npix: headerNumber(res, "X-Npix", 128),
    score: headerNumber(res, "X-Score", NaN),
    min: headerNumber(res, "X-Min", NaN),
    max: headerNumber(res, "X-Max", NaN),
    shifts,
  };
}

export interface MotionMapResult {
  /** nv*nv scores; row j = vy index, column i = vx index, both ascending. */
  data: Float32Array;
  nv: number;
  span: number;
  step: number;
  bestVx: number;
  bestVy: number;
  bestScore: number;
  zeroScore: number;
  bestX: number;
  bestY: number;
}

/** Fixed-source-suppressed score over a velocity grid (vx east, vy north, arcsec/yr). */
export async function fetchMotionMap(
  key: string,
  detector: number,
  span: number,
  step: number,
): Promise<MotionMapResult> {
  const url =
    `/api/jobs/${encodeURIComponent(key)}/motionmap?detector=${detector}` +
    `&span=${span}&step=${step}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`motion map failed: ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  const data = new Float32Array(await res.arrayBuffer());
  return {
    data,
    nv: headerNumber(res, "X-Nv", Math.round(Math.sqrt(data.length))),
    span: headerNumber(res, "X-Span", span),
    step: headerNumber(res, "X-Step", step),
    bestVx: headerNumber(res, "X-Best-Vx", 0),
    bestVy: headerNumber(res, "X-Best-Vy", 0),
    bestScore: headerNumber(res, "X-Best-Score", NaN),
    zeroScore: headerNumber(res, "X-Zero-Score", NaN),
    bestX: headerNumber(res, "X-Best-X", -1),
    bestY: headerNumber(res, "X-Best-Y", -1),
  };
}

export interface GaiaSource {
  source_id: string;
  ra: number;
  dec: number;
  pmra: number | null;
  pmdec: number | null;
  parallax: number | null;
  phot_g_mean_mag: number | null;
  /** 0-based grid pixel at `epoch_year` (x grows west, y grows north). */
  x: number;
  y: number;
  dx_per_yr: number;
  dy_per_yr: number;
  pm_total_arcsec_yr: number;
}

export interface GaiaResult {
  epoch_year: number;
  catalogue: string;
  n: number;
  limit: number;
  sources: GaiaSource[];
}

export function fetchGaia(key: string): Promise<GaiaResult> {
  return json(`/api/jobs/${encodeURIComponent(key)}/gaia`);
}

// --- sky globe -------------------------------------------------------------
export interface CachedPatch {
  key: string;
  target: string;
  ra_deg: number;
  dec_deg: number;
  fov_deg: number | null;
  n_spherex: number;
  n_wise: number;
  status: "done";
}

export interface BrightStar {
  name: string;
  ra_deg: number;
  dec_deg: number;
  mag: number;
}

export interface BrightStars {
  source: "hipparcos" | "fallback";
  catalogue: string;
  max_mag: number;
  n: number;
  stars: BrightStar[];
}

export interface Resolved {
  kind: "name" | "coordinates";
  name: string;
  ra_deg: number;
  dec_deg: number;
  pmra_mas_yr: number | null;
  pmdec_mas_yr: number | null;
  source: string;
}

export function cachedPatches(): Promise<{ jobs: CachedPatch[] }> {
  return json("/api/jobs");
}

export function brightStars(): Promise<BrightStars> {
  return json("/api/sky/bright_stars");
}

/** Resolve an object name or typed coordinates.  Rejects with the server's plain-English message. */
export async function resolveText(text: string): Promise<Resolved> {
  const res = await fetch(`/api/resolve?name=${encodeURIComponent(text)}`);
  if (!res.ok) {
    let detail = `The lookup failed (${res.status}).`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return (await res.json()) as Resolved;
}
