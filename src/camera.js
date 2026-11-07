// Stage 3: the Justice D. Renders the nadir view a global shutter would see, then
// rebuilds it row by row: each row reads out a little later than the one above, at the
// pose the drone (and its vibrating mount) had at that instant, averaged over the exposure.
// The world is close to a plane under a nadir camera, so each instant is one homography.
import { createWorld } from "./world.js";
import { detect } from "./features.js";
import { createFlight, GUSTS } from "./flight.js";

const T = window.THREE;
const VFOV = 86, ASPECT = 16 / 9, TAN_V = Math.tan(VFOV / 2 * Math.PI / 180);
const AW = 1280, AH = 720;               // 720p: what features and pixel figures are counted in
const RW = 1792, RH = 1008;              // the wider global shutter render each frame is built from
const REF_TAN = [2.05, 2.05 / ASPECT * 1.0]; // its half-extent in tan units, with room for tilt
export const N = 64;                            // instants sampled across readout and exposure
export const MOUNT_OFF = [0, -0.05, -0.075];    // where the Justice D sits on the airframe
const DEFAULT_WORLD = { name: "Dead grass, low November sun", surface: "deadgrass", light: "low", patches: false, shadow: true, seed: 2111 };

export const READOUTS = [
  { ms: 0, name: "0 ms, global shutter" },
  { ms: 5, name: "5 ms, fast sensor" },
  { ms: 10, name: "10 ms" },
  { ms: 13, name: "13 ms, our first guess" },
  { ms: 16, name: "16 ms, Justice D from its sensor family" },
  { ms: 16.7, name: "16.7 ms, the whole frame" },
  { ms: 25, name: "25 ms, 30 fps mode" }
];
export const MOUNTS = {
  soft: { name: "Soft-mounted, damped", deg: 0.005 },
  hard: { name: "Hard-mounted", deg: 0.02 },
  loose: { name: "Loose, or a chipped prop", deg: 0.12 }
};
export const EXPOSURES = [0, 1, 2, 4, 8, 16];
const MOTIONS = { hover: "Holding over the mark", cross: "Crossing at 4 m/s", sway: "Swaying side to side" };
const SWEEP = [0, 5, 10, 13, 16.7, 25];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const px = (v) => v < 10 ? v.toFixed(1) : String(Math.round(v));
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export const FRAG = `
precision highp float;
uniform sampler2D refTex;
uniform mat3 H[${N}];
uniform float gainMul, tStart, tStep, readout, expo, sd, aspect, k1, noise, seed, vign, scan, tNow;
uniform int taps, mode;
uniform vec2 refTan;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423) + seed); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 look(vec3 ray, float t) {
  float f = clamp((t - tStart) / tStep, 0.0, ${N - 1}.0 - 0.001);
  int i = int(f); float a = f - float(i);
  vec3 c = (H[i] * (1.0 - a) + H[i + 1] * a) * ray;
  if (c.z > -1e-5) return vec3(0.0);
  vec2 uv = (c.xy / -c.z) / refTan * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(refTex, uv).rgb * gainMul;
}
void main() {
  vec2 d = vec2((vUv.x - 0.5) * 2.0 * aspect * sd, (vUv.y - 0.5) * 2.0 * sd);
  float rr = dot(d, d);
  vec3 ray = vec3(d * (1.0 + k1 * rr), -1.0);
  float row = 1.0 - vUv.y; // the top row reads out first
  vec3 rs = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= taps) break;
    float t = readout * (row - 0.5) + expo * ((float(j) + 0.5) / float(taps) - 0.5);
    rs += look(ray, t);
  }
  rs /= float(taps);
  // Slow motion: rows under the scan line are not read yet; show what the sensor sees now, dimmed.
  if (scan >= 0.0 && row > scan) rs = look(ray, tNow) * 0.38;
  vec3 col = rs;
  if (mode == 1) col = look(ray, 0.0);
  float v = 1.0 - vign * pow(rr / (sd * sd * (1.0 + aspect * aspect)), 1.5);
  col *= v;
  if (mode != 2) {
    float n1 = hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 3.1) - 1.0;
    col = max(vec3(0.0), col + noise * (n1 * 0.9 + (hash(gl_FragCoord.xy + 7.7) - 0.5) * 0.4) * (0.35 + sqrt(max(col, 0.0))));
  } else {
    col = vec3(clamp(length(rs - look(ray, 0.0)) * 5.0, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Small rotation maths on plain arrays, quaternions as [x, y, z, w].
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export function qmat(q) { // row-major 3x3, body to world
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
export const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const MOUNT_Q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // -90° about x: looks straight down, forward at the top
export const smallQ = (ax, ay, az) => { const q = [ax / 2, ay / 2, az / 2, 1], l = Math.hypot(...q); return q.map((v) => v / l); };

export async function startCamera() {
  const cameras = ambition.collection("cameras");
  const scenes = ambition.collection("scenes");
  const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const isAdmin = me.role === "owner" || me.role === "admin";

  const cam = { readout: 13, exposure: 0, mount: "hard", lens: true, noise: true };
  const ui = { speed: 1, view: "rs", feats: true, arrows: false, frozen: false, motion: "hover", altitude: 20, wind: 4, worldId: "default" };
  let savedScenes = [], setups = [];

  // ---------- renderer, world, flight ----------
  const canvas = $("c-view");
  const renderer = new T.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.LinearToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const world = createWorld(renderer);
  const { scene } = world;
  const sky = new T.Color();
  scene.background = sky;

  const refCam = new T.PerspectiveCamera(2 * Math.atan(REF_TAN[1]) * 180 / Math.PI, REF_TAN[0] / REF_TAN[1], 0.05, 2000);
  const refTarget = new T.WebGLRenderTarget(RW, RH, { colorSpace: T.SRGBColorSpace });
  refTarget.texture.colorSpace = T.SRGBColorSpace;
  refTarget.texture.generateMipmaps = false;
  refTarget.texture.minFilter = T.LinearFilter;
  const outTarget = new T.WebGLRenderTarget(AW, AH, { colorSpace: T.SRGBColorSpace });
  outTarget.texture.colorSpace = T.SRGBColorSpace;
  const pixels = new Uint8Array(AW * AH * 4);

  const Hs = Array.from({ length: N }, () => new T.Matrix3());
  const uniforms = {
    refTex: { value: refTarget.texture }, gainMul: { value: 1 }, H: { value: Hs }, tStart: { value: 0 }, tStep: { value: 1 },
    readout: { value: 0 }, expo: { value: 0 }, taps: { value: 1 }, mode: { value: 0 },
    sd: { value: TAN_V }, aspect: { value: ASPECT }, k1: { value: 0 }, noise: { value: 0 }, seed: { value: 0 }, vign: { value: 0 },
    refTan: { value: new T.Vector2(REF_TAN[0], REF_TAN[1]) }, scan: { value: -1 }, tNow: { value: 0 }
  };
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthTest: false, depthWrite: false, toneMapped: false }));
  const post = new T.Scene(); post.add(quad);
  const postCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let flight = createFlight({ altitude: ui.altitude, wind: ui.wind, gnss: "full", vio: true, gust: "moderate", seed: 1 + Math.floor(Math.random() * 9999) });
  const H = (x, z) => world.heightAt(x, z);

  // Poses at every physics step for the last few seconds: what each row looks back on.
  const HIST = 2400;
  const hist = { t: new Float64Array(HIST), p: new Float64Array(HIST * 3), q: new Float64Array(HIST * 4), rpm: new Float32Array(HIST), n: 0, head: 0 };
  function record() {
    const s = flight.s, i = hist.head;
    hist.t[i] = s.t;
    hist.p.set(s.p, i * 3); hist.q.set(s.q, i * 4);
    hist.rpm[i] = flight.imu.rpm || 0;
    hist.head = (i + 1) % HIST; hist.n = Math.min(HIST, hist.n + 1);
  }
  const vibPhase = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
  // Body pose at time t (linear between physics steps), then the camera on its shaking mount.
  function cameraAt(t) {
    // Binary search the ring, oldest to newest.
    const base = (hist.head - hist.n + HIST) % HIST, at = (k) => (base + k) % HIST;
    let lo = 0, hi = hist.n - 1;
    if (t >= hist.t[at(hi)]) lo = hi;
    else if (t <= hist.t[at(0)]) hi = 0;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hist.t[at(m)] <= t) lo = m; else hi = m; }
    const i = at(lo), j = at(hi);
    const span = hist.t[j] - hist.t[i];
    const a = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - hist.t[i]) / span));
    const p = [0, 1, 2].map((c) => hist.p[i * 3 + c] * (1 - a) + hist.p[j * 3 + c] * a);
    let q = [0, 1, 2, 3].map((c) => hist.q[i * 4 + c] * (1 - a) + hist.q[j * 4 + c] * a);
    const l = Math.hypot(...q); q = q.map((v) => v / l);
    const rpm = hist.rpm[i];
    const f = Math.max(20, rpm / 60), w = 2 * Math.PI * f;
    const A = MOUNTS[cam.mount].deg * Math.PI / 180;
    // Shake at the prop rate, its blade-pass harmonic, and a slower frame resonance.
    const vib = (ph, s) => A * s * (Math.sin(w * t + ph) + 0.5 * Math.sin(2 * w * t + ph * 1.7) + 0.3 * Math.sin(0.37 * w * t + ph * 0.6));
    const qv = smallQ(vib(vibPhase[0], 1), vib(vibPhase[1], 0.4), vib(vibPhase[2], 1));
    const Rb = qmat(q), off = mv(Rb, MOUNT_OFF);
    return { p: [p[0] + off[0], p[1] + off[1], p[2] + off[2]], q: qmul(qmul(q, MOUNT_Q), qv), hz: f };
  }
  // The homography from a camera ray at pose c to the reference camera's ray, through the ground plane y = g.
  function homography(c, ref, g) {
    const R = qmat(c.q), Rr = qmat(ref.q);
    const dy = g - c.p[1] || -1e-3;
    const dp = [(c.p[0] - ref.p[0]) / dy, (c.p[1] - ref.p[1]) / dy, (c.p[2] - ref.p[2]) / dy];
    // M = I + dp nᵀ with n = (0, 1, 0): only the middle column changes.
    const M = [1, dp[0], 0, 0, 1 + dp[1], 0, 0, dp[2], 1];
    const MR = new Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) MR[r * 3 + k] = M[r * 3] * R[k] + M[r * 3 + 1] * R[3 + k] + M[r * 3 + 2] * R[6 + k];
    const out = new Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out[r * 3 + k] = Rr[r] * MR[k] + Rr[3 + r] * MR[3 + k] + Rr[6 + r] * MR[6 + k];
    return out;
  }
  const project = (h, ray) => { const c = mv(h, ray); return [c[0] / -c[2], c[1] / -c[2]]; };

  // ---------- lens ----------
  function lensScale() {
    // Barrel distortion that keeps the 86° vertical view; it widens the corners as the real lens does.
    const k = cam.lens ? 0.06 : 0;
    let s = TAN_V;
    for (let i = 0; i < 30; i++) s = TAN_V / (1 + k * s * s);
    return { k, s };
  }
  // Grid of output points (distorted pixel to ray) used for the warp and blur figures.
  function grid(cols = 12, rows = 7) {
    const { k, s } = lensScale(), pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) / cols, v = (r + 0.5) / rows; // v from the top
      const dx = (u - 0.5) * 2 * ASPECT * s, dy = (0.5 - v) * 2 * s, sc = 1 + k * (dx * dx + dy * dy);
      pts.push({ u, v, ray: [dx * sc, dy * sc, -1] });
    }
    return { pts, pxPerTan: AH / (2 * s) };
  }

  // ---------- exposure ----------
  let gainE = 1; // overall brightness factor the auto exposure settles on
  function exposureNow() {
    const auto = Math.min(16, Math.max(0.1, gainE * 1.5));
    const ms = cam.exposure || auto;
    const gain = Math.max(1, gainE * 1.5 / ms);
    return { ms, gain };
  }

  // ---------- one frame ----------
  let frame = null; // { tc, ref, g, start, step, hz }
  let seedN = 0;
  // In slow motion the frame is the 60 fps frame the playhead tp falls in: its top row reads at the
  // frame's start, and rows below the scan line are still waiting for the readout to reach them.
  const PERIOD = 1 / 60;
  const slow = { t: null, scan: -1, tNow: 0, frame: -1, into: 0, measured: -1 };
  function buildFrame(tp) {
    const s = flight.s;
    const { ms } = exposureNow();
    const ro = cam.readout / 1000, ex = ms / 1000;
    const half = ro / 2 + ex / 2 + 0.0005;
    let tc = s.t - half - 0.002;
    if (tp != null) {
      const fi = Math.floor(tp / PERIOD), Tf = fi * PERIOD;
      tc = Tf + ro / 2;
      slow.frame = fi; slow.into = tp - Tf;
      slow.scan = ro > 0 ? Math.min(2, Math.max(0, (tp - Tf) / ro)) : 2;
      slow.tNow = Math.min(half, Math.max(-half, tp - tc));
    } else slow.scan = -1;
    const ref = cameraAt(tc);
    const g = world.heightAt(ref.p[0], ref.p[2]);
    const start = -half, step = (2 * half) / (N - 1);
    for (let i = 0; i < N; i++) {
      const h = homography(cameraAt(tc + start + i * step), ref, g);
      Hs[i].set(...h);
    }
    frame = { tc, ref, g, start, step, hz: ref.hz };
    refCam.position.set(...ref.p);
    refCam.quaternion.set(...ref.q);
    refCam.updateMatrixWorld(true);
    world.aimSun(refCam.position, ref.p[1] - g);
  }
  function renderFrame(target, mode) {
    const { ms, gain } = exposureNow();
    const { k, s } = lensScale();
    uniforms.tStart.value = frame.start; uniforms.tStep.value = frame.step;
    uniforms.readout.value = cam.readout / 1000; uniforms.expo.value = ms / 1000;
    uniforms.taps.value = ms >= 4 ? 8 : ms >= 1 ? 5 : 2;
    uniforms.k1.value = k; uniforms.sd.value = s;
    uniforms.noise.value = cam.noise ? 0.006 * Math.sqrt(gain) * (gainE > 6 ? 1 + (gainE - 6) * 0.15 : 1) : 0;
    uniforms.vign.value = cam.lens ? 0.35 : 0;
    uniforms.seed.value = (seedN % 97) * 0.013;
    uniforms.mode.value = mode;
    uniforms.gainMul.value = gainE;
    uniforms.scan.value = target === null && slow.scan >= 0 && slow.scan < 1 ? slow.scan : -1;
    uniforms.tNow.value = slow.tNow;
    renderer.setRenderTarget(target);
    renderer.render(post, postCam);
    renderer.setRenderTarget(null);
  }
  function renderRef() {
    renderer.toneMappingExposure = 1;
    renderer.setRenderTarget(refTarget);
    renderer.render(scene, refCam);
    renderer.setRenderTarget(null);
  }

  // ---------- what the shutter does, in 720p pixels ----------
  const G = grid();
  function warpAt(tc, readoutMs, exposureMs) {
    const ref = cameraAt(tc), g = world.heightAt(ref.p[0], ref.p[2]);
    const ro = readoutMs / 1000, ex = exposureMs / 1000;
    let warp = 0, blur = 0;
    const rows = new Map();
    for (const pt of G.pts) {
      let h = rows.get(pt.v);
      if (!h) {
        const t = tc + ro * (pt.v - 0.5);
        h = [homography(cameraAt(t), ref, g), homography(cameraAt(t - ex / 2), ref, g), homography(cameraAt(t + ex / 2), ref, g)];
        rows.set(pt.v, h);
      }
      const at = project(h[0], pt.ray), gs = [pt.ray[0], pt.ray[1]];
      warp = Math.max(warp, Math.hypot(at[0] - gs[0], at[1] - gs[1]) * G.pxPerTan);
      const a = project(h[1], pt.ray), b = project(h[2], pt.ray);
      blur = Math.max(blur, Math.hypot(a[0] - b[0], a[1] - b[1]) * G.pxPerTan);
    }
    return { warp, blur };
  }
  // Warp of every recent frame at each readout time: how this flight would look on other sensors.
  function sweep() {
    const newest = hist.t[(hist.head - 1 + HIST) % HIST];
    const oldest = hist.t[(hist.head - hist.n + HIST) % HIST];
    const { ms } = exposureNow();
    const from = Math.max(oldest + 0.05, newest - 3.5), to = newest - 0.05;
    if (to - from < 0.5) return null;
    return SWEEP.map((r) => {
      let sum = 0, max = 0, n = 0;
      for (let t = from; t < to; t += 1 / 30) { const w = warpAt(t, r, ms).warp; sum += w; max = Math.max(max, w); n++; }
      return { r, mean: sum / n, max };
    });
  }

  // ---------- measuring ----------
  let feats = { rs: null, gs: null, points: [] };
  let live = { warp: 0, blur: 0, peak: 0, peaks: [] };
  function grabOut(mode) {
    renderFrame(outTarget, mode);
    renderer.readRenderTargetPixels(outTarget, 0, 0, AW, AH, pixels);
  }
  function brightness() {
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    return sum / (pixels.length / 64) / 255;
  }
  function measure(settle) {
    if (!frame) return;
    renderRef();
    grabOut(1);
    let b = brightness();
    for (let k = 0; k < (settle ? 5 : 1) && Math.abs(b - 0.38) > 0.04; k++) {
      gainE = Math.min(24, Math.max(0.3, gainE * Math.pow(0.38 / Math.max(b, 0.005), settle ? 2.2 : 1.2)));
      renderRef(); grabOut(1); b = brightness();
    }
    const gs = detect(flipRows(pixels), AW, AH);
    grabOut(0);
    const rs = detect(flipRows(pixels), AW, AH);
    feats = { rs, gs, points: rs.points };
  }
  const flipped = new Uint8Array(AW * AH * 4);
  function flipRows(src) { // GL reads bottom row first
    const row = AW * 4;
    for (let y = 0; y < AH; y++) flipped.set(src.subarray((AH - 1 - y) * row, (AH - y) * row), y * row);
    return flipped;
  }

  // ---------- overlay ----------
  const overlay = $("c-overlay");
  function drawOverlay() {
    const ctx = overlay.getContext("2d"), W = overlay.width, Hh = overlay.height;
    ctx.clearRect(0, 0, W, Hh);
    const scanning = slow.scan >= 0 && slow.scan < 1 && ui.speed < 1;
    if (scanning && ui.view === "rs") {
      const y = slow.scan * Hh;
      ctx.fillStyle = ambition.color("accent-1");
      ctx.globalAlpha = 0.18; ctx.fillRect(0, y - Hh * 0.04, W, Hh * 0.04); ctx.globalAlpha = 1;
      ctx.fillRect(0, y - 1, W, Math.max(2, W / 500));
    }
    if (ui.feats && ui.view !== "diff" && feats.points.length && !scanning) {
      ctx.fillStyle = ambition.color("accent-4");
      const sx = W / AW, sy = Hh / AH, r = Math.max(1.5, W / 520);
      for (let i = 0; i < feats.points.length; i += 2) { ctx.beginPath(); ctx.arc(feats.points[i] * sx, feats.points[i + 1] * sy, r, 0, 6.283); ctx.fill(); }
    }
    if (ui.arrows && frame) {
      const ro = cam.readout / 1000, sc = W / AW * 10;
      ctx.strokeStyle = ambition.color("accent-2"); ctx.lineWidth = Math.max(1.5, W / 600);
      const rows = new Map();
      for (const pt of G.pts) {
        let h = rows.get(pt.v);
        if (!h) { h = homography(cameraAt(frame.tc + ro * (pt.v - 0.5)), frame.ref, frame.g); rows.set(pt.v, h); }
        const at = project(h, pt.ray);
        const dx = (at[0] - pt.ray[0]) * G.pxPerTan * sc, dy = -(at[1] - pt.ray[1]) * G.pxPerTan * sc;
        const x = pt.u * W, y = pt.v * Hh;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth, 0, 6.283); ctx.fillStyle = ambition.color("accent-2"); ctx.fill();
      }
    }
  }

  // ---------- controls ----------
  $("c-readout").replaceChildren(...READOUTS.map((r) => el("option", { value: String(r.ms) }, r.name)));
  $("c-exposure").replaceChildren(...EXPOSURES.map((e) => el("option", { value: String(e) }, e === 0 ? "Auto, like the camera" : `${e} ms, fixed`)));
  $("c-mount").replaceChildren(...Object.entries(MOUNTS).map(([k, v]) => el("option", { value: k }, v.name)));
  $("c-motion").replaceChildren(...Object.entries(MOTIONS).map(([k, v]) => el("option", { value: k }, v)));
  function sync() {
    $("c-readout").value = String(cam.readout);
    $("c-exposure").value = String(cam.exposure);
    $("c-mount").value = cam.mount;
    $("c-lens").checked = cam.lens;
    $("c-noise").checked = cam.noise;
    $("c-motion").value = ui.motion;
    $("c-alt").value = ui.altitude; $("c-alt-out").textContent = `${ui.altitude} m`;
    $("c-wind").value = ui.wind; $("c-wind-out").textContent = `${ui.wind} m/s`;
    $("c-feat").checked = ui.feats; $("c-arrows").checked = ui.arrows;
    for (const k of ["rs", "gs", "diff"]) {
      $(`c-v-${k}`).className = ui.view === k ? "small" : "small secondary";
      $(`c-v-${k}`).setAttribute("aria-pressed", String(ui.view === k));
    }
    $("c-freeze").textContent = ui.frozen ? "Play" : "Freeze";
    $("c-speed").value = String(ui.speed);
    $("c-step").hidden = ui.speed >= 1;
    $("c-slow-note").hidden = ui.speed >= 1;
  }
  const changed = () => { sync(); lastMeasure = 0; };
  $("c-readout").addEventListener("change", (e) => { cam.readout = +e.target.value; changed(); });
  $("c-exposure").addEventListener("change", (e) => { cam.exposure = +e.target.value; changed(); });
  $("c-mount").addEventListener("change", (e) => { cam.mount = e.target.value; changed(); });
  $("c-lens").addEventListener("change", (e) => { cam.lens = e.target.checked; changed(); });
  $("c-noise").addEventListener("change", (e) => { cam.noise = e.target.checked; changed(); });
  $("c-motion").addEventListener("change", (e) => { ui.motion = e.target.value; motionT = 0; if (ui.motion === "hover") { flight.hold[0] = 0; flight.hold[1] = 0; } changed(); });
  $("c-alt").addEventListener("input", (e) => { ui.altitude = +e.target.value; flight.setAltitude(ui.altitude); sync(); });
  $("c-wind").addEventListener("input", (e) => { ui.wind = +e.target.value; flight.set.wind = ui.wind; sync(); });
  $("c-feat").addEventListener("change", (e) => { ui.feats = e.target.checked; drawOverlay(); });
  $("c-arrows").addEventListener("change", (e) => { ui.arrows = e.target.checked; drawOverlay(); });
  for (const k of ["rs", "gs", "diff"]) $(`c-v-${k}`).addEventListener("click", () => { ui.view = k; sync(); if (ui.frozen) draw(); });
  $("c-kick").addEventListener("click", () => flight.kick());
  $("c-freeze").addEventListener("click", () => { ui.frozen = !ui.frozen; sync(); });
  $("c-speed").addEventListener("change", (e) => {
    ui.speed = +e.target.value; slow.t = null; slow.scan = -1; slow.measured = -1;
    if (ui.speed >= 1) { buildFrame(); slowClock(); }
    sync();
  });
  $("c-step").addEventListener("click", () => {
    if (slow.t == null) return;
    slow.t += cam.readout > 0 ? cam.readout / 1000 / 12 : 0.001;
    ui.frozen = true; sync();
  });

  // ---------- worlds ----------
  function worldOptions() {
    const opts = [el("option", { value: "default" }, DEFAULT_WORLD.name)];
    for (const r of savedScenes.slice().reverse()) opts.push(el("option", { value: r.id }, r.value.name));
    $("c-world").replaceChildren(...opts);
    $("c-world").value = savedScenes.some((r) => r.id === ui.worldId) ? ui.worldId : "default";
  }
  async function loadWorld(id) {
    ui.worldId = id;
    const rec = savedScenes.find((r) => r.id === id);
    const w = rec ? { surface: rec.value.surface, light: rec.value.light, patches: !!rec.value.patches, shadow: rec.value.shadow !== false, seed: rec.value.seed } : DEFAULT_WORLD;
    $("c-building").hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    world.rebuild(w.surface, w.seed, w.patches);
    const L = world.applyLight(w.light, w.shadow);
    const k = Math.min(1, 0.15 + L.sky * 0.45 + L.sun * 0.12);
    sky.setRGB(0.62 * k, 0.7 * k, 0.8 * k);
    $("c-building").hidden = true;
    flight.setAltitude(ui.altitude);
    flight.reset(H);
    hist.n = 0; hist.head = 0;
    for (let i = 0; i < 400; i++) { flight.step(H); record(); }
    buildFrame();
    measure(true);
  }
  $("c-world").addEventListener("change", (e) => loadWorld(e.target.value));

  // ---------- shared camera setups ----------
  function setupLine(v) {
    const ex = v.exposure_ms ? `${v.exposure_ms} ms exposure` : "auto exposure";
    return `${v.readout_ms} ms readout · ${ex} · ${MOUNTS[v.mount]?.name.toLowerCase() || v.mount}${v.lens ? "" : " · no lens distortion"}${v.noise ? "" : " · no noise"}`;
  }
  function renderSetups() {
    const list = $("c-setups");
    if (!setups.length) {
      list.replaceChildren(el("li", { class: "empty" }, "No camera setups saved yet. Dial one in and save it so everyone tests the same camera."));
      return;
    }
    list.replaceChildren(...setups.slice().reverse().map((r) => {
      const v = r.value;
      const mine = r.author_id === me.id || isAdmin;
      const res = v.result ? `${px(v.result.warp)} px warp, ${px(v.result.blur)} px blur, ${v.result.features} features at ${v.result.altitude} m` : null;
      return el("li", { class: "card stack tight" },
        el("strong", {}, v.name),
        el("span", { class: "meta" }, setupLine(v)),
        res ? el("span", { class: "meta" }, res) : null,
        el("span", { class: "faint type-meta-sm" }, `${names[r.author_id] || "Someone"} · ${ago(r.updated_at)}`),
        el("div", { class: "row tight-row" },
          el("button", { class: "small secondary", type: "button", onclick: () => useSetup(v) }, "Use this camera"),
          mine ? el("button", { class: "small ghost", type: "button", "aria-label": `Remove ${v.name}`, onclick: () => removeSetup(r.id) }, "Remove") : null));
    }));
  }
  function useSetup(v) {
    Object.assign(cam, { readout: v.readout_ms, exposure: v.exposure_ms || 0, mount: MOUNTS[v.mount] ? v.mount : "hard", lens: v.lens !== false, noise: v.noise !== false });
    changed();
    $("c-viewport").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function removeSetup(id) {
    try { await cameras.remove(id); } catch (e) { flash(e.message); }
  }
  function flash(t) { $("c-flash").textContent = t; setTimeout(() => { if ($("c-flash").textContent === t) $("c-flash").textContent = ""; }, 4000); }
  $("c-save").addEventListener("click", async () => {
    const name = $("c-name").value.trim();
    if (!name) { flash("Give the setup a name first."); $("c-name").focus(); return; }
    $("c-save").disabled = true;
    try {
      await cameras.add({
        name: name.slice(0, 80), readout_ms: cam.readout, exposure_ms: cam.exposure, mount: cam.mount, lens: cam.lens, noise: cam.noise,
        result: { altitude: ui.altitude, warp: +live.peak.toFixed(2), blur: +live.blur.toFixed(2), features: feats.rs ? feats.rs.features : 0 }
      });
      $("c-name").value = "";
      flash("Saved for the group.");
    } catch (e) { flash(e.message); }
    $("c-save").disabled = false;
  });
  async function loadSetups() { setups = await cameras.list(); renderSetups(); }
  async function loadScenes() { savedScenes = await scenes.list(); worldOptions(); }

  // ---------- readouts ----------
  function card(label, value, sub, tone) {
    return el("div", { class: "card stack tight readout" },
      el("span", { class: "eyebrow" }, label),
      el("span", { class: "type-heading-md" + (tone ? ` tone-${tone}` : "") }, value),
      sub ? el("span", { class: "meta" }, sub) : null);
  }
  function readouts() {
    const { ms, gain } = exposureNow();
    const lostShare = feats.rs && feats.gs && feats.gs.features ? 1 - feats.rs.features / feats.gs.features : 0;
    const warpTone = live.peak > 2 ? "bad" : live.peak < 1 ? "good" : null;
    $("c-readouts").replaceChildren(
      card("Rolling shutter warp", `${px(live.warp)} px`, cam.readout === 0 ? "Global shutter: every row at once" : `worst ${px(live.peak)} px in the last 2 s, vs a global shutter`, warpTone),
      card("Motion blur", `${px(live.blur)} px`, `${ms < 1 ? ms.toFixed(1) : Math.round(ms * 10) / 10} ms exposure${gain > 1.05 ? `, gain ${gain.toFixed(1)}×` : ""}`, live.blur > 2 ? "bad" : null),
      card("Features tracked", feats.rs ? String(feats.rs.features) : "…", feats.gs ? `${feats.gs.features} with a global shutter${lostShare > 0.05 ? `, ${Math.round(lostShare * 100)}% fewer` : ""}` : "", lostShare > 0.3 ? "bad" : null),
      card("Mount shake", `${Math.round(frame?.hz || 0)} Hz`, `±${MOUNTS[cam.mount].deg}° at the prop rate`),
      card("Height", `${Math.round((flight.s.p[1] - flight.s.ground) * 10) / 10} m`, `${Math.hypot(flight.s.v[0], flight.s.v[2]).toFixed(1)} m/s across the ground`));
  }
  function drawSweep() {
    const rows = sweep();
    if (!rows) return;
    const top = Math.max(2, ...rows.map((r) => r.max));
    $("c-sweep").replaceChildren(...rows.map((r) => el("tr", { class: r.r === cam.readout ? "current" : "" },
      el("td", {}, r.r === 0 ? "Global shutter" : `${r.r} ms`),
      el("td", {}, `${px(r.mean)} px`),
      el("td", {}, `${px(r.max)} px`),
      el("td", { class: "bar-cell" }, el("progress", { max: String(top), value: String(r.max), "aria-label": `Worst warp ${px(r.max)} px` })))));
  }

  // ---------- loop ----------
  let motionT = 0, dir = 1;
  function steer(dt) {
    motionT += dt;
    const s = flight.s;
    if (ui.motion === "cross") {
      // Chase a point ahead so the controller flies at its 4 m/s limit, turning back at the edges.
      if (s.p[0] > 120) dir = -1; else if (s.p[0] < -120) dir = 1;
      flight.hold[0] = s.p[0] + dir * 8; flight.hold[1] = 0;
    } else if (ui.motion === "sway") {
      flight.hold[0] = Math.sin(motionT * 0.9) * 4; flight.hold[1] = 0;
    }
  }
  function resize() {
    const box = $("c-viewport").getBoundingClientRect();
    const w = Math.max(320, Math.round(box.width)), h = Math.round(w / ASPECT);
    renderer.setSize(w, h, false);
    overlay.width = w; overlay.height = h;
    drawOverlay();
  }
  new ResizeObserver(resize).observe($("c-viewport"));

  function draw() {
    renderRef();
    renderFrame(null, ui.view === "gs" ? 1 : ui.view === "diff" ? 2 : 0);
    drawOverlay();
  }

  let lastWall = performance.now(), lastMeasure = 0, lastUi = 0, lastSweep = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    const wall = Math.min(0.05, (now - lastWall) / 1000);
    lastWall = now;
    if ($("camera-view").hidden || !frame) return;
    if (ui.speed < 1) {
      if (slow.t == null) slow.t = flight.s.t - 0.04;
      if (!ui.frozen) slow.t += wall * ui.speed;
      slowFrame(now);
    } else if (!ui.frozen) {
      const steps = Math.round(wall / flight.DT);
      for (let i = 0; i < steps; i++) { steer(flight.DT); flight.step(H); record(); }
      seedN++;
      buildFrame();
      liveFigures();
      if (now - lastMeasure > 900) { lastMeasure = now; measure(false); }
    }
    draw();
    if (now - lastUi > 250) { lastUi = now; readouts(); }
    if (now - lastSweep > 1500 && !ui.frozen) { lastSweep = now; drawSweep(); }
  }
  // Physics runs a little ahead of the slow playhead so every row has a pose to look back on.
  function slowFrame(now) {
    while (flight.s.t < slow.t + 0.03) { steer(flight.DT); flight.step(H); record(); }
    const before = slow.frame;
    buildFrame(slow.t);
    if (slow.frame !== before) { seedN++; liveFigures(); }
    // Count features once each frame is fully read out (at most about once a second).
    if (slow.scan >= 1 && slow.measured !== slow.frame && now - lastMeasure > 700) {
      lastMeasure = now; slow.measured = slow.frame; measure(false);
    }
    slowClock();
  }
  function slowClock() {
    const c = $("c-clock");
    if (ui.speed >= 1) { c.hidden = true; return; }
    c.hidden = false;
    const ms = (slow.into * 1000).toFixed(slow.into < 0.01 ? 2 : 1);
    if (cam.readout <= 0) c.textContent = `Global shutter: every row at once · ${ms} ms into the frame`;
    else if (slow.scan < 1) c.textContent = `Reading row ${Math.max(1, Math.round(slow.scan * AH))} of ${AH} · ${ms} ms into the frame`;
    else c.textContent = `Frame read out · next one in ${Math.max(0, (PERIOD - slow.into) * 1000).toFixed(1)} ms`;
  }
  function liveFigures() {
    {
      const { ms } = exposureNow();
      const w = warpAt(frame.tc, cam.readout, ms);
      live.warp = live.warp * 0.7 + w.warp * 0.3;
      live.blur = live.blur * 0.7 + w.blur * 0.3;
      live.peaks.push({ t: flight.s.t, w: w.warp });
      while (live.peaks.length && live.peaks[0].t < flight.s.t - 2) live.peaks.shift();
      live.peak = live.peaks.reduce((m, p) => Math.max(m, p.w), 0);
    }
  }

  cameras.subscribe(loadSetups);
  scenes.subscribe(loadScenes);
  sync();
  await Promise.all([loadScenes(), loadSetups()]);
  resize();
  await loadWorld("default");
  readouts();
  requestAnimationFrame(tick);
  return { resize };
}
