// The sim engine: one screen where the M2-AI flies its physics over a site, the Justice D's
// rolling shutter image is rebuilt row by row from the drone's own poses, VIO tracks the
// corners it finds there, and that decides how well the drone holds. Time can run, pause,
// step a frame or slow down 1,000 times; the drone can hold on its own or be flown by hand.
import { createWorld, LIGHTS } from "./world.js";
import { SURFACES } from "./textures.js";
import { detect, TRACKER_DEFAULT } from "./features.js";
import { createFlight, AIRFRAME, MOTORS, GNSS_MODES, VIO_TUNES, GUSTS } from "./flight.js";
import { VERT, FRAG, qmul, qmat, mv, MOUNT_Q, smallQ, N, MOUNT_OFF, READOUTS, MOUNTS, EXPOSURES } from "./camera.js";
import { buildPhoto, buildHeights, buildDetail, SITES } from "./site.js";
import { buildDrone } from "./drone.js";

const T = window.THREE;
const VFOV = 86, ASPECT = 16 / 9, TAN_V = Math.tan(VFOV / 2 * Math.PI / 180);
const AW = 1280, AH = 720;
const RW = 1792, RH = 1008;
const REF_TAN = [2.05, 2.05 / ASPECT];
const CHECK_SITES = ["dubendorf", "delft", "andermatt", "farm"], CHECK = { altitude: 20, gnss: "denied" };
const TRIAL = 60, RADIUS = 1, MEASURE_EVERY = 0.5, PERIOD = 1 / 60;
const RUNGS = [10, 30, 60, 100];
const OT = { site: "farm", altitude: 20, gnss: "denied" };
const OT_PRESETS = [
  { name: "Default", ...TRACKER_DEFAULT },
  { name: "Low threshold", threshold: 6, minDist: 3, maxFeatures: 3456, levels: 1, contrast: 1 },
  { name: "Pyramid, 3 levels", threshold: 12, minDist: 3, maxFeatures: 3456, levels: 3, contrast: 1 },
  { name: "Contrast boost", threshold: 8, minDist: 3, maxFeatures: 3456, levels: 1, contrast: 2.5 },
  { name: "Pyramid and boost", threshold: 6, minDist: 4, maxFeatures: 3456, levels: 3, contrast: 2 },
  { name: "Everything up", threshold: 4, minDist: 2, maxFeatures: 6000, levels: 4, contrast: 3 }
];
const TR_KEYS = ["threshold", "minDist", "maxFeatures", "levels", "contrast"];
// The worst night: the anchored hold with GNSS off, climbing each condition's rungs until it
// drifts out, so we learn the highest hold each kind of evening allows.
const NIGHT = [
  { id: "grass_dusk", name: "Dead grass at dusk", short: "Grass, dusk", surface: "deadgrass", light: "dusk", patches: false, rungs: [10, 30, 60, 100] },
  { id: "grass_dark", name: "Dead grass, dark, city glow only", short: "Grass, dark", surface: "deadgrass", light: "dark", patches: false, rungs: [10, 30, 60, 100] },
  { id: "patchy_flood", name: "Patchy snow under a floodlight", short: "Patchy snow, flood", surface: "deadgrass", light: "flood", patches: true, rungs: [10, 30, 60, 100] },
  { id: "snow_dusk", name: "Fresh snow at dusk", short: "Snow, dusk", surface: "snow", light: "dusk", patches: false, rungs: [10, 30, 60, 100] },
  { id: "snow_flood", name: "Fresh snow under a floodlight", short: "Snow, flood", surface: "snow", light: "flood", patches: false, rungs: [10, 30, 60, 100] },
  { id: "hall_floor", name: "Museum hall floor, indoors", short: "Hall floor", surface: "floor", light: "hall", patches: false, rungs: [3, 6, 10, 15], wind: 0 }
];
const NIGHT_BY = Object.fromEntries(NIGHT.map((c) => [c.id, c]));
const LADDER_SITE = { site: "dubendorf", gnss: "denied" };
// Losing the lock: the anchored 20 m hold on Dübendorf with GNSS off, tracking cut 15 s in for
// longer and longer, timing how long VIO takes to pick the ground up again and the drone to
// settle back inside the circle (and stay there 3 s). Each cut is flown twice: without the
// lost-lock fallback, then with it (hold still on the IMU, find the mark again, fly back).
const LOSE = { site: "dubendorf", altitude: 20, gnss: "denied", at: 15, cuts: [1, 3, 6, 10, 20], steady: 3 };
const LOSE_PLAN = LOSE.cuts.flatMap((len) => [{ len, fb: false }, { len, fb: true }]);
const SPEEDS = [0.001, 0.01, 0.1, 0.25, 0.5, 1, 2, 4];
const DEFAULT_WORLD = { name: "Dead grass, low November sun", surface: "deadgrass", light: "low", patches: false, shadow: true, seed: 2111 };
const DEFAULT_CAM = { name: "Justice D, our 13 ms guess", readout_ms: 13, exposure_ms: 0, mount: "hard", lens: true, noise: true };
const FARM = "farm", CUSTOM = "custom";
const BASE_INERTIA = AIRFRAME.inertia.slice(), BASE_MASS = AIRFRAME.mass;
const NAV_NAMES = { "gnss+vio": "GNSS and VIO", gnss: "GNSS", vio: "VIO only", imu: "IMU only, VIO lost", none: "Nothing" };
const FB_NAMES = { imu: "Fallback: holding still", search: "Fallback: climbing to find the mark" };
const VIO_STATE = { tracking: "VIO tracking well", weak: "VIO straining", lost: "VIO lost, coasting on the IMU", off: "VIO off" };
const VIEWS = ["chase", "orbit", "cam", "split"];
const TABS = ["scene", "drone", "nav", "camera", "tests"];

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
const fmt = (m) => m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`;
const px = (v) => v < 10 ? v.toFixed(1) : String(Math.round(v));
const css = (k) => ambition.color(k);
const FONT = () => getComputedStyle(document.body).fontFamily;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const readoutName = (ms) => ms === 0 ? "global shutter" : `${ms} ms readout`;
const speedName = (v) => v >= 1 ? (v === 1 ? "Real time" : `${v}×`) : v >= 0.25 ? `${v}×` : `${Math.round(1 / v).toLocaleString()}× slower`;

export async function startEngine() {
  const missions = ambition.collection("missions");
  const scenes = ambition.collection("scenes");
  const cameras = ambition.collection("cameras");
  const flightsCol = ambition.collection("flights");
  const benchCol = ambition.collection("benchmarks");
  const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const isAdmin = me.role === "owner" || me.role === "admin";

  const tracker = { ...TRACKER_DEFAULT };
  const cam = { readout: 13, exposure: 0, mount: "hard", lens: true, noise: true };
  const drone = { altitude: 20, gnss: "denied", vio: true, tune: "typical", rsAware: true, anchor: true, fallback: true, wind: 4, windDir: 250, gust: "moderate", charge: 0.9 };
  const worldDef = { ...DEFAULT_WORLD };
  const ui = { site: "default", setup: "default", view: "chase", feats: true, inset: true, speed: 1, paused: false, mode: "hold", tab: "scene" };
  let savedScenes = [], setups = [], board = [], earlier = [];

  const flash = (t) => { $("g-flash").textContent = t || ""; };

  // ---------- renderer ----------
  const canvas = $("g-view");
  const renderer = new T.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.LinearToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.autoClear = true;

  // ---------- the two kinds of ground ----------
  const textured = createWorld(renderer);
  const texSky = new T.Color();
  textured.scene.background = texSky;
  // One real site is kept built at a time; switching lets the last one's textures go.
  let real = null; // { id, promise }
  const built = new Set();
  function dropOtherSites(keep) { for (const w of built) if (w !== keep) { w.dispose(); built.delete(w); } }
  function photoTexture(canvas) {
    const tex = canvas instanceof HTMLCanvasElement ? new T.CanvasTexture(canvas) : new T.Texture(canvas);
    tex.needsUpdate = true;
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = T.LinearMipmapLinearFilter;
    return tex;
  }
  function drape(geo, at) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, at(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  async function makeReal(site) {
    const scene = new T.Scene();
    const sky = new T.Color(0.7, 0.76, 0.84);
    scene.background = sky;
    scene.fog = new T.Fog(sky, site.size * 1.2, site.size * 4);
    const [photo, detail, h] = await Promise.all([buildPhoto(site), buildDetail(site), buildHeights(site)]);
    const geo = new T.PlaneGeometry(site.size, site.size, 128, 128).rotateX(-Math.PI / 2);
    drape(geo, h.at);
    const mat = new T.MeshBasicMaterial({ map: photoTexture(photo) });
    scene.add(new T.Mesh(geo, mat));
    const owned = [geo, mat, mat.map];
    if (detail) {
      // The sharp middle half, draped on the same ground and drawn over the base photo.
      const dgeo = new T.PlaneGeometry(site.size / 2, site.size / 2, 64, 64).rotateX(-Math.PI / 2);
      drape(dgeo, h.at);
      const dmat = new T.MeshBasicMaterial({ map: photoTexture(detail), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const dm = new T.Mesh(dgeo, dmat);
      dm.renderOrder = 1;
      scene.add(dm);
      owned.push(dgeo, dmat, dmat.map);
    }
    // A plain skirt so the far view does not end at a cliff.
    const sgeo = new T.PlaneGeometry(site.size * 6, site.size * 6).rotateX(-Math.PI / 2);
    const smat = new T.MeshBasicMaterial({ color: new T.Color(0.36, 0.38, 0.3) });
    const skirt = new T.Mesh(sgeo, smat);
    skirt.position.y = h.lo - 3;
    scene.add(skirt);
    owned.push(sgeo, smat);
    return { scene, heightAt: h.at, aimSun() {}, relief: h.relief, dispose() { for (const o of owned) o.dispose(); } };
  }
  function loadReal(id) {
    if (real && real.id === id) return real.promise;
    real = { id, promise: makeReal(SITES[id]) };
    real.promise.then((w) => built.add(w)).catch(() => {});
    return real.promise;
  }
  let world = textured;
  const H = (x, z) => world.heightAt(x, z);

  // ---------- the drone and the mark ----------
  const model = buildDrone();
  const markColor = new T.Color(1, 0.75, 0.2);
  const ringMat = new T.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false });
  const ring = new T.Mesh(new T.RingGeometry(RADIUS * 0.94, RADIUS, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const plumb = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: markColor, transparent: true, opacity: 0.5 }));
  const chase = new T.PerspectiveCamera(55, ASPECT, 0.05, 3000);
  const orbit = { az: 0.6, el: 0.45, dist: 4 };

  // ---------- the rolling shutter pipeline ----------
  const refCam = new T.PerspectiveCamera(2 * Math.atan(REF_TAN[1]) * 180 / Math.PI, REF_TAN[0] / REF_TAN[1], 0.05, 2000);
  const refTarget = new T.WebGLRenderTarget(RW, RH, { colorSpace: T.SRGBColorSpace });
  refTarget.texture.colorSpace = T.SRGBColorSpace;
  refTarget.texture.generateMipmaps = false;
  refTarget.texture.minFilter = T.LinearFilter;
  const outTarget = new T.WebGLRenderTarget(AW, AH, { colorSpace: T.SRGBColorSpace });
  outTarget.texture.colorSpace = T.SRGBColorSpace;
  const pixels = new Uint8Array(AW * AH * 4);
  const flipped = new Uint8Array(AW * AH * 4);
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

  // ---------- flight history, so every row can look back at its own pose ----------
  let flight = null;
  const HIST = 2400;
  const hist = { t: new Float64Array(HIST), p: new Float64Array(HIST * 3), q: new Float64Array(HIST * 4), rpm: new Float32Array(HIST), n: 0, head: 0 };
  function record() {
    const s = flight.s, i = hist.head;
    hist.t[i] = s.t; hist.p.set(s.p, i * 3); hist.q.set(s.q, i * 4);
    hist.rpm[i] = flight.imu.rpm || 0;
    hist.head = (i + 1) % HIST; hist.n = Math.min(HIST, hist.n + 1);
  }
  function bodyAt(t) {
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
    return { p, q, rpm: hist.rpm[i] };
  }
  const vibPhase = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
  function cameraAt(t) {
    const { p, q, rpm } = bodyAt(t);
    const f = Math.max(20, rpm / 60), w = 2 * Math.PI * f;
    const A = MOUNTS[cam.mount].deg * Math.PI / 180;
    const vib = (ph, s) => A * s * (Math.sin(w * t + ph) + 0.5 * Math.sin(2 * w * t + ph * 1.7) + 0.3 * Math.sin(0.37 * w * t + ph * 0.6));
    const qv = smallQ(vib(vibPhase[0], 1), vib(vibPhase[1], 0.4), vib(vibPhase[2], 1));
    const off = mv(qmat(q), MOUNT_OFF);
    return { p: [p[0] + off[0], p[1] + off[1], p[2] + off[2]], q: qmul(qmul(q, MOUNT_Q), qv), hz: f };
  }
  function homography(c, ref, g) {
    const R = qmat(c.q), Rr = qmat(ref.q);
    const dy = g - c.p[1] || -1e-3;
    const dp = [(c.p[0] - ref.p[0]) / dy, (c.p[1] - ref.p[1]) / dy, (c.p[2] - ref.p[2]) / dy];
    const M = [1, dp[0], 0, 0, 1 + dp[1], 0, 0, dp[2], 1];
    const MR = new Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) MR[r * 3 + k] = M[r * 3] * R[k] + M[r * 3 + 1] * R[3 + k] + M[r * 3 + 2] * R[6 + k];
    const out = new Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out[r * 3 + k] = Rr[r] * MR[k] + Rr[3 + r] * MR[3 + k] + Rr[6 + r] * MR[6 + k];
    return out;
  }
  const project = (h, ray) => { const c = mv(h, ray); return [c[0] / -c[2], c[1] / -c[2]]; };
  function lensScale() {
    const k = cam.lens ? 0.06 : 0;
    let s = TAN_V;
    for (let i = 0; i < 30; i++) s = TAN_V / (1 + k * s * s);
    return { k, s };
  }
  function grid(cols = 12, rows = 7) {
    const { k, s } = lensScale(), pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
      const dx = (u - 0.5) * 2 * ASPECT * s, dy = (0.5 - v) * 2 * s, sc = 1 + k * (dx * dx + dy * dy);
      pts.push({ u, v, ray: [dx * sc, dy * sc, -1] });
    }
    return { pts, pxPerTan: AH / (2 * s) };
  }
  let G = grid();

  let gainE = 1;
  function exposureNow() {
    const auto = Math.min(16, Math.max(0.1, gainE * 1.5));
    const ms = cam.exposure || auto;
    return { ms, gain: Math.max(1, gainE * 1.5 / ms) };
  }

  // In slow motion the frame shown is the 60 fps frame the playhead falls in: its top row reads
  // at the frame's start, and rows below the scan line are still waiting for the readout.
  const slow = { scan: -1, tNow: 0, frame: -1, into: 0 };
  const slowMode = () => ui.speed <= 0.1 && cam.readout > 0;
  let frame = null, seedN = 0, playhead = 0;
  function buildFrame(tp) {
    const { ms } = exposureNow();
    const ro = cam.readout / 1000, ex = ms / 1000;
    const half = ro / 2 + ex / 2 + 0.0005;
    let tc = flight.s.t - half - 0.002;
    if (tp != null) {
      const fi = Math.floor(tp / PERIOD), Tf = fi * PERIOD;
      tc = Tf + ro / 2;
      if (fi !== slow.frame) seedN++;
      slow.frame = fi; slow.into = tp - Tf;
      slow.scan = ro > 0 ? clamp((tp - Tf) / ro, 0, 2) : 2;
      slow.tNow = clamp(tp - tc, -half, half);
    } else slow.scan = -1;
    const ref = cameraAt(tc);
    const g = world.heightAt(ref.p[0], ref.p[2]);
    const start = -half, step = (2 * half) / (N - 1);
    for (let i = 0; i < N; i++) Hs[i].set(...homography(cameraAt(tc + start + i * step), ref, g));
    frame = { tc, ref, g, start, step, hz: ref.hz };
    refCam.position.set(...ref.p);
    refCam.quaternion.set(...ref.q);
    refCam.updateMatrixWorld(true);
    world.aimSun(refCam.position, ref.p[1] - g);
  }
  function renderRef() {
    model.group.visible = ring.visible = plumb.visible = false;
    renderer.toneMappingExposure = 1;
    renderer.setRenderTarget(refTarget);
    renderer.render(world.scene, refCam);
    renderer.setRenderTarget(null);
    model.group.visible = ring.visible = plumb.visible = true;
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
    uniforms.scan.value = target === null && mode === 0 && slow.scan >= 0 && slow.scan < 1 ? slow.scan : -1;
    uniforms.tNow.value = slow.tNow;
    renderer.setRenderTarget(target);
    renderer.render(post, postCam);
    renderer.setRenderTarget(null);
  }
  function warpAt(tc) {
    const { ms } = exposureNow();
    const ref = cameraAt(tc), g = world.heightAt(ref.p[0], ref.p[2]);
    const ro = cam.readout / 1000, ex = ms / 1000;
    let warp = 0, blur = 0;
    const rows = new Map();
    for (const pt of G.pts) {
      let h = rows.get(pt.v);
      if (!h) {
        const t = tc + ro * (pt.v - 0.5);
        h = [homography(cameraAt(t), ref, g), homography(cameraAt(t - ex / 2), ref, g), homography(cameraAt(t + ex / 2), ref, g)];
        rows.set(pt.v, h);
      }
      const at = project(h[0], pt.ray);
      warp = Math.max(warp, Math.hypot(at[0] - pt.ray[0], at[1] - pt.ray[1]) * G.pxPerTan);
      const a = project(h[1], pt.ray), b = project(h[2], pt.ray);
      blur = Math.max(blur, Math.hypot(a[0] - b[0], a[1] - b[1]) * G.pxPerTan);
    }
    return { warp, blur };
  }
  function flipRows(src) {
    const row = AW * 4;
    for (let y = 0; y < AH; y++) flipped.set(src.subarray((AH - 1 - y) * row, (AH - y) * row), y * row);
    return flipped;
  }
  function grab(mode) {
    const keep = slow.scan;
    slow.scan = -1;
    renderFrame(outTarget, mode);
    slow.scan = keep;
    renderer.readRenderTargetPixels(outTarget, 0, 0, AW, AH, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    return sum / (pixels.length / 64) / 255;
  }

  // What VIO's front end gets: corners in the rolling shutter frame, with the global shutter
  // count alongside every few measurements to show what the shutter costs.
  let feats = { rs: null, gs: null, points: [] };
  let live = { warp: 0, blur: 0 };
  let measureN = 0;
  function measure(settle) {
    if (!frame) return;
    renderRef();
    let b = grab(0);
    for (let k = 0; k < (settle ? 5 : 1) && Math.abs(b - 0.38) > 0.04; k++) {
      gainE = clamp(gainE * Math.pow(0.38 / Math.max(b, 0.005), settle ? 2.2 : 1.2), 0.3, 24);
      if (settle) { renderRef(); b = grab(0); }
    }
    const rs = detect(flipRows(pixels), AW, AH, tracker);
    const rsPoints = rs.points.slice();
    let gs = feats.gs;
    if (settle || measureN % 3 === 0 || !gs) { grab(1); gs = detect(flipRows(pixels), AW, AH, tracker); }
    measureN++;
    feats = { rs, gs, points: rsPoints };
    flight.vio.coverage = rs.coverage;
  }

  // ---------- runs ----------
  let track = [], trial = null, marks = [], lastSample = -1, lastMeasureT = -1, result = null, ladder = null, nextRung = false, sweep = null, nextSite = false, otest = null, nextOt = false, night = null, nextNight = false, lose = null, nextLose = false;
  function note(text) { if (trial && !trial.done) marks.push({ t: flight.s.t - trial.start, text }); }
  function newFlight() {
    flight = createFlight({ altitude: drone.altitude, gnss: drone.gnss, vio: drone.vio, tune: drone.tune, rsAware: drone.rsAware, anchor: drone.anchor, fallback: drone.fallback, wind: drone.wind, windDir: drone.windDir, gust: drone.gust, charge: drone.charge, seed: 1 + Math.floor(Math.random() * 9999) });
    flight.vio.warp = 0; flight.vio.blur = 0;
    flight.setAltitude(drone.altitude);
    flight.reset(H);
    flight.pilot.on = ui.mode === "pilot";
    hist.n = 0; hist.head = 0;
    for (let i = 0; i < 400; i++) { flight.step(H); record(); }
    playhead = flight.s.t;
    track = []; lastSample = -1; lastMeasureT = -1; live = { warp: 0, blur: 0 };
    buildFrame(null);
    measure(true);
  }
  function stopTests(why) {
    if (lose) { drone.anchor = lose.anchor; drone.fallback = lose.fallback; if (flight) flight.set.fallback = drone.fallback; }
    if (lose && (!trial || trial.done)) { lose = null; nextLose = false; sync(); return; }
    if (night && (!trial || trial.done)) { endNight(); sync(); return; }
    if (!trial || trial.done) return;
    trial = null; ladder = null; nextRung = false; sweep = null; nextSite = false; otest = null; nextOt = false; lose = null; nextLose = false; marks = [];
    endNight();
    if (why) flash(why);
    sync();
  }
  function beginTrial() {
    setMode("hold", true);
    newFlight();
    trial = { start: flight.s.t, max: 0, sum: 0, n: 0, inside: 0, lost: 0, rs: 0, gs: 0, cov: 0, fN: 0, warp: 0, blur: 0, wN: 0, nav: 0, ctrl: 0, done: false };
    marks = [];
    if (ui.paused) setPaused(false);
  }
  function startHold() {
    ladder = null; sweep = null; nextSite = false; otest = null; nextOt = false; lose = null; nextLose = false; endNight(); result = null; $("g-result").hidden = true; flash("");
    beginTrial(); sync();
  }
  function startLadder() {
    sweep = null; nextSite = false; otest = null; nextOt = false; lose = null; nextLose = false; endNight();
    result = null; $("g-result").hidden = true; flash("");
    ladder = { i: 0, rows: [] };
    runRung();
  }
  // The Dübendorf ladder: GNSS off, VIO on, each rung shared as it lands.
  async function startSiteLadder() {
    sweep = null; nextSite = false; nextRung = false; otest = null; nextOt = false; lose = null; nextLose = false; endNight(); result = null; $("g-result").hidden = true; flash("");
    drone.gnss = LADDER_SITE.gnss; drone.vio = true; trial = null;
    const l = { i: 0, rows: [], auto: true };
    ladder = l;
    if (ui.speed < 4) setSpeed(4);
    sync();
    if (ui.site !== LADDER_SITE.site) await loadSite(LADDER_SITE.site);
    if (ladder !== l) return;
    if (ui.site !== LADDER_SITE.site) { ladder = null; flash("The ladder stopped because the site changed."); sync(); return; }
    runRung();
  }
  // The real-site check: one 60 s hold at 20 m with GNSS off on each real site, each shared as it lands.
  function startSweep() {
    ladder = null; nextRung = false; otest = null; nextOt = false; lose = null; nextLose = false; endNight(); result = null; $("g-result").hidden = true; flash("");
    sweep = { i: 0, rows: [] };
    if (ui.speed < 4) setSpeed(4);
    runSite();
  }
  async function runSite() {
    const s = sweep;
    if (!s) return;
    drone.altitude = CHECK.altitude; drone.gnss = CHECK.gnss; drone.vio = true;
    trial = null; sync();
    if (ui.site !== CHECK_SITES[s.i]) await loadSite(CHECK_SITES[s.i]);
    if (sweep !== s) return;
    if (ui.site !== CHECK_SITES[s.i]) { sweep = null; flash("The real-site check stopped because the site changed."); sync(); return; }
    drone.altitude = CHECK.altitude;
    beginTrial(); sync();
  }
  // The Ottawa test: the anchored 20 m hold on the farm with GNSS off, once with the tracker
  // as set, or once per preset. Each run is shared to the board as it lands.
  function startOttawa(list) {
    ladder = null; nextRung = false; sweep = null; nextSite = false; lose = null; nextLose = false; endNight(); result = null; $("g-result").hidden = true; flash("");
    otest = { i: 0, list, rows: [] };
    if (ui.speed < 4) setSpeed(4);
    runOt();
  }
  async function runOt() {
    const o = otest;
    if (!o) return;
    Object.assign(tracker, o.list[o.i]); trackerUi();
    drone.altitude = OT.altitude; drone.gnss = OT.gnss; drone.vio = true; drone.anchor = true;
    trial = null; sync();
    if (ui.site !== OT.site) await loadSite(OT.site);
    if (otest !== o) return;
    if (ui.site !== OT.site) { otest = null; flash("The Ottawa test stopped because the site changed."); sync(); return; }
    drone.altitude = OT.altitude;
    lastMeasureT = -1;
    beginTrial(); sync();
  }
  function startNight() {
    ladder = null; nextRung = false; sweep = null; nextSite = false; otest = null; nextOt = false; result = null; $("g-result").hidden = true; flash("");
    night = { ci: 0, ri: 0, rows: [], wind: drone.wind, anchor: drone.anchor, built: null };
    nightResult = null; renderNightResult();
    if (ui.speed < 4) setSpeed(4);
    runNight();
  }
  // Put the wind and anchor back as they were, once the night test is over or stopped.
  function endNight() {
    if (!night) return;
    drone.wind = night.wind; drone.anchor = night.anchor;
    night = null; nextNight = false;
  }
  async function runNight() {
    const n = night;
    if (!n) return;
    const c = NIGHT[n.ci];
    drone.altitude = c.rungs[n.ri]; drone.gnss = "denied"; drone.vio = true; drone.anchor = true;
    drone.wind = c.wind ?? n.wind;
    trial = null; sync();
    if (n.built !== c.id || ui.site !== CUSTOM) {
      Object.assign(worldDef, { surface: c.surface, light: c.light, patches: c.patches, shadow: true, seed: DEFAULT_WORLD.seed });
      await loadSite(CUSTOM, true);
      if (night !== n) return;
      n.built = c.id;
    }
    drone.altitude = c.rungs[n.ri];
    lastMeasureT = -1;
    beginTrial(); sync();
  }
  function startLose() {
    ladder = null; nextRung = false; sweep = null; nextSite = false; otest = null; nextOt = false; endNight(); result = null; $("g-result").hidden = true; flash("");
    lose = { i: 0, rows: [], anchor: drone.anchor, fallback: drone.fallback };
    loseResult = null; renderLoseResult();
    if (ui.speed < 4) setSpeed(4);
    runLose();
  }
  async function runLose() {
    const l = lose;
    if (!l) return;
    drone.altitude = LOSE.altitude; drone.gnss = LOSE.gnss; drone.vio = true; drone.anchor = true; drone.fallback = LOSE_PLAN[l.i].fb;
    if (flight) flight.set.fallback = drone.fallback;
    trial = null; sync();
    if (ui.site !== LOSE.site) await loadSite(LOSE.site);
    if (lose !== l) return;
    if (ui.site !== LOSE.site) { lose = null; flash("Losing the lock stopped because the site changed."); sync(); return; }
    drone.altitude = LOSE.altitude;
    lastMeasureT = -1;
    beginTrial();
    trial.cut = { at: LOSE.at, len: LOSE_PLAN[l.i].len, started: false, reacq: null, steadyFrom: null, recover: null, atCut: 0 };
    sync();
  }
  // Cut tracking on schedule, then time the re-acquisition and the settling.
  function cutStep(f, d) {
    const c = trial.cut, t = f.s.t - trial.start;
    if (!c.started) {
      if (t >= c.at) { c.started = true; c.atCut = d; f.blind(c.len); note(`tracking cut for ${c.len} s`); }
      return;
    }
    const end = c.at + c.len;
    if (t < end) return;
    if (c.reacq == null && f.vio.state !== "lost") { c.reacq = t - end; note("tracking back"); }
    if (d <= RADIUS) { if (c.steadyFrom == null) c.steadyFrom = t; } else c.steadyFrom = null;
    if (c.recover == null && c.steadyFrom != null && t - c.steadyFrom >= LOSE.steady) { c.recover = Math.max(0, c.steadyFrom - end); note("steady again"); }
  }
  function runRung() {
    drone.altitude = RUNGS[ladder.i];
    beginTrial(); sync();
  }
  function sample() {
    const f = flight, d = f.drift(), b = f.believed();
    track.push({ t: f.s.t, x: f.s.p[0], z: f.s.p[2], bx: b[0], bz: b[1], d, f: feats.rs ? feats.rs.features : 0 });
    if (!trial || trial.done) { while (track.length && track[0].t < f.s.t - 30) track.shift(); if (!trial) return; }
    if (trial.done) return;
    trial.max = Math.max(trial.max, d); trial.sum += d; trial.n++;
    trial.nav = Math.max(trial.nav, Math.hypot(f.est.err[0], f.est.err[1]));
    trial.ctrl = Math.max(trial.ctrl, Math.hypot(b[0] - f.hold[0], b[1] - f.hold[1]));
    if (d <= RADIUS) trial.inside++;
    if (f.vio.state === "lost") trial.lost += 0.05;
    trial.warp += live.warp; trial.blur += live.blur; trial.wN++;
    if (f.fb.events.length) { for (const e of f.fb.events) note(e); f.fb.events.length = 0; }
    if (trial.cut) cutStep(f, d);
    if (f.s.t - trial.start >= TRIAL) finishTrial();
  }
  function onMeasured() {
    if (!trial || trial.done || !feats.rs) return;
    trial.rs += feats.rs.features; trial.gs += feats.gs ? feats.gs.features : 0; trial.cov += feats.rs.coverage; trial.fN++;
  }
  function siteName() { return SITES[ui.site] ? SITES[ui.site].name : ui.site === CUSTOM ? worldLabel() : (savedScenes.find((r) => r.id === ui.site)?.value.name || DEFAULT_WORLD.name); }
  function finishTrial() {
    const t = trial;
    t.done = true;
    const r = {
      site: SITES[ui.site] ? ui.site : "textured", site_name: siteName().slice(0, 120), camera_name: setupLabel().slice(0, 120),
      readout_ms: cam.readout, exposure_ms: cam.exposure, mount: cam.mount, lens: cam.lens,
      altitude: drone.altitude, gnss: drone.gnss, vio: drone.vio, tune: drone.tune, rs_aware: drone.rsAware, anchor: drone.anchor, fallback: drone.fallback, wind: drone.wind,
      duration: TRIAL, radius: RADIUS,
      max_drift: +t.max.toFixed(3), mean_drift: +(t.sum / Math.max(1, t.n)).toFixed(3),
      inside: +(t.inside / Math.max(1, t.n)).toFixed(3), passed: t.max <= RADIUS,
      features_rs: Math.round(t.rs / Math.max(1, t.fN)), features_gs: Math.round(t.gs / Math.max(1, t.fN)),
      coverage: +(t.cov / Math.max(1, t.fN)).toFixed(3),
      warp_px: +(t.warp / Math.max(1, t.wN)).toFixed(2), blur_px: +(t.blur / Math.max(1, t.wN)).toFixed(2),
      vio_lost: +t.lost.toFixed(1), nav_err: +t.nav.toFixed(3), ctrl_err: +t.ctrl.toFixed(3), events: marks.map((m) => `${Math.round(m.t)} s: ${m.text}`).join("; ").slice(0, 400)
    };
    if (lose && t.cut) {
      const l = lose, c = t.cut;
      Object.assign(r, { test: "recovery", cut_s: c.len, recovered: c.recover != null });
      if (c.reacq != null) r.reacquire_s = +c.reacq.toFixed(1);
      if (c.recover != null) r.recover_s = +c.recover.toFixed(1);
      l.rows.push(r);
      missions.add(r).catch((e) => flash(e.message));
      l.i++;
      if (l.i < LOSE_PLAN.length) { nextLose = true; sync(); return; }
      drone.anchor = l.anchor; drone.fallback = l.fallback; flight.set.fallback = drone.fallback;
      loseResult = { rows: l.rows.slice() };
      lose = null;
      renderLoseResult();
      sync();
      return;
    }
    if (night) {
      const n = night, c = NIGHT[n.ci];
      Object.assign(r, { test: "night", condition: c.id, site_name: c.name });
      n.rows.push(r);
      missions.add(r).catch((e) => flash(e.message));
      if (r.passed && n.ri + 1 < c.rungs.length) n.ri++;
      else { n.ci++; n.ri = 0; }
      if (n.ci < NIGHT.length) { nextNight = true; sync(); return; }
      nightResult = { rows: n.rows.slice() };
      endNight();
      renderNightResult();
      sync();
      return;
    }
    if (otest) {
      r.test = "ottawa";
      r.tracker = { name: (otest.list[otest.i].name || trackerName()).slice(0, 60), ...pickTracker(tracker) };
      otest.rows.push(r);
      missions.add(r).catch((e) => flash(e.message));
      otest.i++;
      if (otest.i < otest.list.length) { nextOt = true; sync(); return; }
      const rows = otest.rows;
      otest = null;
      const best = rows.slice().sort((a, b) => (b.passed - a.passed) || a.max_drift - b.max_drift)[0];
      if (rows.length > 1) { Object.assign(tracker, pickTracker(best.tracker)); trackerUi(); }
      otResult = { rows, best };
      renderOtResult();
      sync();
      return;
    }
    if (sweep) {
      sweep.rows.push(r);
      missions.add(r).catch((e) => flash(e.message));
      sweep.i++;
      if (sweep.i < CHECK_SITES.length) { nextSite = true; sync(); return; }
      result = { sweep: sweep.rows.slice() };
      sweep = null;
    } else if (ladder) {
      ladder.rows.push(r);
      if (ladder.auto) missions.add(r).catch((e) => flash(e.message));
      ladder.i++;
      if (ladder.i < RUNGS.length) { nextRung = true; return; }
      result = { ladder: ladder.rows.slice(), shared: !!ladder.auto };
      ladder = null;
    } else result = r;
    showResult();
    sync();
  }
  function verdict(r) {
    if (r.passed) return `Held within ${fmt(r.radius)} for the full ${r.duration} s`;
    return `Left the ${fmt(r.radius)} circle, worst ${fmt(r.max_drift)} off the mark`;
  }
  function chipsFor(r) {
    return [
      el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, r.passed ? "Held" : "Drifted out"),
      el("span", { class: "chip" }, `${r.altitude} m`),
      el("span", { class: "chip" }, readoutName(r.readout_ms)),
      el("span", { class: "chip" }, MOUNTS[r.mount]?.name || r.mount),
      el("span", { class: "chip" }, `GNSS ${GNSS_MODES[r.gnss]?.toLowerCase() || r.gnss}`),
      el("span", { class: "chip" }, r.vio ? (r.rs_aware ? "VIO, shutter-aware" : "VIO") : "VIO off"),
      r.anchor ? el("span", { class: "chip accent" }, "Anchored to the mark") : null,
      el("span", { class: "chip" }, `${r.wind} m/s wind`)
    ];
  }
  function figures(r) {
    const lost = r.features_gs ? Math.max(0, 1 - r.features_rs / r.features_gs) : 0;
    return el("p", { class: "meta" },
      `Worst ${fmt(r.max_drift)}, average ${fmt(r.mean_drift)}, ${Math.round(r.inside * 100)}% of the time inside. `,
      `VIO tracked ${r.features_rs} features a frame${lost > 0.03 ? ` (${Math.round(lost * 100)}% fewer than a global shutter)` : ""}, `,
      `with ${px(r.warp_px)} px of shutter warp and ${px(r.blur_px)} px of blur`,
      r.vio_lost ? `, and lost tracking for ${r.vio_lost} s.` : ".");
  }
  // Where the drift came from: the position estimate walking away, or wind and control.
  function cause(r) {
    if (r.nav_err == null) return null;
    const nav = r.nav_err, ctrl = r.ctrl_err;
    const main = nav > ctrl * 1.5 ? "Most of it was the drone's own position estimate walking off, not the wind."
      : ctrl > nav * 1.5 ? "Most of it was wind and the controller; the position estimate stayed close."
      : "Estimate and wind shared it.";
    const tip = !r.anchor && r.vio && nav > ctrl ? " Try anchoring the hold to the mark on the Navigation tab." : "";
    return el("p", { class: "meta" }, `Estimate off by up to ${fmt(nav)}, wind and control up to ${fmt(ctrl)}. ${main}${tip}`);
  }
  function ladderTable(rows) {
    return el("table", { class: "ladder" },
      el("thead", {}, el("tr", {}, el("th", {}, "Height"), el("th", {}, "Worst drift"), el("th", {}, "Features"), el("th", {}, "Estimate off"), el("th", {}, ""))),
      el("tbody", {}, ...rows.map((r) => el("tr", {},
        el("td", {}, `${r.altitude} m`), el("td", {}, fmt(r.max_drift)), el("td", {}, String(r.features_rs)),
        el("td", {}, r.nav_err == null ? "" : fmt(r.nav_err)),
        el("td", {}, el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, r.passed ? "Held" : "Out"))))));
  }
  function showResult() {
    const r = result, box = $("g-result");
    box.hidden = false;
    if (r.sweep) {
      const held = r.sweep.filter((x) => x.passed).length;
      box.replaceChildren(
        el("h3", {}, `Held on ${held} of ${r.sweep.length} real sites`),
        el("p", { class: "meta" }, `${r.sweep[0].altitude} m, GNSS off, ${r.sweep[0].camera_name}. All four are on the shared board.`));
      return;
    }
    if (r.ladder) {
      const held = r.ladder.filter((x) => x.passed).map((x) => x.altitude);
      box.replaceChildren(
        el("h3", {}, held.length ? `Held at ${held.join(", ")} m` : "Didn't hold at any height"),
        el("p", { class: "meta" }, `${r.ladder[0].site_name}, ${r.ladder[0].camera_name}.`),
        ladderTable(r.ladder),
        r.shared ? el("p", { class: "meta" }, "All four are on the shared board.")
          : el("button", { class: "secondary", type: "button", id: "g-share", onclick: share }, "Share all four runs"));
      return;
    }
    box.replaceChildren(
      el("h3", {}, verdict(r)),
      el("p", { class: "meta" }, `${r.site_name}, ${r.camera_name}.`),
      el("div", { class: "row chips" }, ...chipsFor(r)),
      figures(r),
      cause(r),
      r.events ? el("p", { class: "meta" }, `Changed mid-flight: ${r.events}`) : null,
      el("button", { class: "secondary", type: "button", id: "g-share", onclick: share }, "Share this run"));
  }
  async function share() {
    const btn = $("g-share");
    if (!result || !btn) return;
    btn.disabled = true;
    try {
      for (const r of result.ladder || [result]) await missions.add(r);
      btn.textContent = "Shared";
      flash("");
    } catch (e) {
      btn.disabled = false;
      flash(e.message);
    }
  }

  // ---------- shared runs ----------
  // The latest shared 20 m, GNSS-off hold on each real site, side by side.
  function renderCheck() {
    if (!$("g-check")) return;
    const rows = CHECK_SITES.map((id) => {
      const rec = board.slice().reverse().find((b) => b.value.site === id && b.value.altitude === CHECK.altitude && b.value.gnss === CHECK.gnss && b.value.vio);
      return { id, r: rec?.value, when: rec?.updated_at };
    });
    const any = rows.some((x) => x.r);
    $("g-check-empty").hidden = any;
    $("g-check").hidden = !any;
    if (!any) return;
    $("g-check").replaceChildren(
      el("thead", {}, el("tr", {}, el("th", {}, "Site"), el("th", {}, "Worst"), el("th", {}, "Feat."), el("th", {}, ""))),
      el("tbody", {}, ...rows.map(({ id, r, when }) => el("tr", {},
        el("td", {}, SITES[id].short),
        ...(r ? [el("td", { title: `average ${fmt(r.mean_drift)}` }, fmt(r.max_drift)), el("td", {}, String(r.features_rs)),
          el("td", { title: ago(when) }, el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, r.passed ? "Held" : "Out"))]
          : [el("td", { class: "faint", colspan: "3" }, "Not flown yet")])))));
  }
  // The latest shared hold at each ladder height on Dübendorf with GNSS off.
  function renderSiteLadder() {
    if (!$("g-lad")) return;
    const rows = RUNGS.map((alt) => board.slice().reverse().find((b) => b.value.site === LADDER_SITE.site && b.value.altitude === alt && b.value.gnss === LADDER_SITE.gnss && b.value.vio)?.value);
    const flown = rows.filter(Boolean);
    $("g-lad-empty").hidden = !!flown.length;
    $("g-lad").hidden = !flown.length;
    $("g-lad-top").hidden = !flown.length;
    if (!flown.length) return;
    const held = flown.filter((r) => r.passed).map((r) => r.altitude);
    $("g-lad-top").textContent = held.length ? `Highest stable hold: ${Math.max(...held)} m` : "No stable hold at any height yet";
    $("g-lad").replaceChildren(
      el("thead", {}, el("tr", {}, el("th", {}, "Height"), el("th", {}, "Worst"), el("th", {}, "Feat."), el("th", {}, ""))),
      el("tbody", {}, ...RUNGS.map((alt, i) => { const r = rows[i]; return el("tr", {},
        el("td", {}, `${alt} m`),
        ...(r ? [el("td", { title: `average ${fmt(r.mean_drift)}` }, fmt(r.max_drift)), el("td", {}, String(r.features_rs)),
          el("td", {}, el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, r.passed ? "Held" : "Out"))]
          : [el("td", { class: "faint", colspan: "3" }, "Not flown yet")])); })));
  }
  // ---------- the Ottawa test ----------
  let otResult = null;
  const TR_UI = {
    threshold: { id: "g-tr-threshold", out: (v) => `${v} grey levels` },
    minDist: { id: "g-tr-mindist", out: (v) => `${v} px` },
    maxFeatures: { id: "g-tr-max", out: (v) => v.toLocaleString() },
    levels: { id: "g-tr-levels", out: (v) => v === 1 ? "full frame only" : `${v} levels` },
    contrast: { id: "g-tr-contrast", out: (v) => v === 1 ? "off" : `${v}×` }
  };
  function pickTracker(t) { const o = {}; for (const k of TR_KEYS) o[k] = +t[k]; return o; }
  function trackerName() {
    const p = OT_PRESETS.find((x) => TR_KEYS.every((k) => x[k] === tracker[k]));
    return p ? p.name : "Own settings";
  }
  function trackerText(t) {
    return `threshold ${t.threshold}, ${t.minDist} px apart, up to ${t.maxFeatures.toLocaleString()}, ${t.levels} level${t.levels > 1 ? "s" : ""}, contrast ${t.contrast === 1 ? "off" : t.contrast + "×"}`;
  }
  function trackerUi() {
    for (const k of TR_KEYS) {
      const u = TR_UI[k];
      $(u.id).value = tracker[k];
      $(`${u.id}-out`).textContent = u.out(tracker[k]);
    }
    $("g-tr-name").textContent = trackerName();
  }
  function otTable(rows) {
    return el("table", { class: "ladder type-body-sm" },
      el("thead", {}, el("tr", {}, el("th", {}, "Setting"), el("th", {}, "Worst"), el("th", {}, "Feat."), el("th", {}, ""))),
      el("tbody", {}, ...rows.map((r) => el("tr", {},
        el("td", { title: r.tracker ? trackerText(r.tracker) : "" }, r.tracker?.name || "Default"),
        el("td", { title: `average ${fmt(r.mean_drift)}${r.vio_lost ? `, VIO lost ${r.vio_lost} s` : ""}` }, fmt(r.max_drift)),
        el("td", { title: `${Math.round((r.coverage || 0) * 100)}% of the frame covered` }, String(r.features_rs)),
        el("td", {}, el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, r.passed ? "Held" : "Out"))))));
  }
  function otVerdict(rows) {
    const held = rows.filter((r) => r.passed);
    if (held.length) {
      const b = held.slice().sort((a, b) => a.max_drift - b.max_drift)[0];
      return { pass: true, title: `Pass: tuning is enough`, text: `${b.tracker?.name || "Default"} held within ${fmt(RADIUS)}, worst ${fmt(b.max_drift)} with ${b.features_rs} features. No trained detector needed for Ottawa yet.` };
    }
    const b = rows.slice().sort((a, b) => a.max_drift - b.max_drift)[0];
    return { pass: false, title: "Tuning not enough, consider a trained detector", text: `Closest was ${b.tracker?.name || "Default"}, worst ${fmt(b.max_drift)} with ${b.features_rs} features and ${Math.round((b.coverage || 0) * 100)}% of the frame covered.` };
  }
  function renderOtResult() {
    const box = $("g-ot-result");
    if (!otResult) { box.hidden = true; return; }
    const v = otVerdict(otResult.rows);
    box.hidden = false;
    box.replaceChildren(
      el("div", { class: "row tight-row" }, el("span", { class: `chip ${v.pass ? "success" : "warning"}` }, v.pass ? "Pass" : "Not yet"), el("strong", {}, v.title)),
      el("p", { class: "meta" }, v.text),
      otTable(otResult.rows),
      otResult.rows.length > 1 ? el("p", { class: "meta" }, `The sliders are now on ${otResult.best.tracker.name}. Every run is on the shared board.`) : el("p", { class: "meta" }, "Shared to the board."));
  }
  function renderOtBoard() {
    const runs = board.filter((b) => b.value.test === "ottawa");
    $("g-ot-empty").hidden = !!runs.length;
    $("g-ot-board").hidden = !runs.length;
    $("g-ot-top").hidden = !runs.length;
    if (!runs.length) return;
    // The latest shared run for each setting.
    const seen = new Map();
    for (const rec of runs.slice().reverse()) {
      const key = rec.value.tracker ? trackerText(rec.value.tracker) : "default";
      if (!seen.has(key)) seen.set(key, rec.value);
    }
    const rows = [...seen.values()].slice(0, 10);
    const v = otVerdict(rows);
    $("g-ot-top").replaceChildren(el("span", { class: `chip ${v.pass ? "success" : "warning"}` }, v.pass ? "Pass" : "Not yet"), " ", v.title);
    $("g-ot-board").replaceChildren(otTable(rows));
  }
  for (const k of TR_KEYS) {
    $(TR_UI[k].id).addEventListener("input", (e) => {
      tracker[k] = +e.target.value;
      $(`${TR_UI[k].id}-out`).textContent = TR_UI[k].out(tracker[k]);
      $("g-tr-name").textContent = trackerName();
      lastMeasureT = -1;
    });
    $(TR_UI[k].id).addEventListener("change", () => note(`tracker ${trackerName().toLowerCase()}`));
  }
  $("g-tr-reset").addEventListener("click", () => { Object.assign(tracker, TRACKER_DEFAULT); trackerUi(); lastMeasureT = -1; note("tracker default"); });
  $("g-ot-fly").addEventListener("click", () => { if (otest) return stopTests(); startOttawa([{ ...tracker, name: trackerName() }]); });
  $("g-ot-sweep").addEventListener("click", () => { if (otest) return stopTests(); startOttawa(OT_PRESETS.map((p) => ({ ...p }))); });
  trackerUi();

  // ---------- the worst night ----------
  let nightResult = null;
  // From a set of runs: per condition, the highest rung held with every rung below it held too.
  function nightSummary(rows) {
    return NIGHT.map((c) => {
      const mine = rows.filter((r) => r.condition === c.id);
      const at = new Map();
      for (const r of mine) at.set(r.altitude, r);
      let best = null, fail = null;
      for (const h of c.rungs) {
        const r = at.get(h);
        if (!r) break;
        if (r.passed) best = r; else { fail = r; break; }
      }
      return { c, best, fail, flown: mine.length > 0, top: best && !fail && best.altitude === c.rungs[c.rungs.length - 1] };
    });
  }
  function nightTable(sum) {
    return el("table", { class: "ladder type-body-sm" },
      el("thead", {}, el("tr", {}, el("th", {}, "Condition"), el("th", {}, "Holds to"), el("th", {}, "Fails at"), el("th", {}, "Feat."))),
      el("tbody", {}, ...sum.map(({ c, best, fail, flown, top }) => el("tr", {},
        el("td", {}, c.name),
        el("td", {}, !flown ? el("span", { class: "faint" }, "not flown") : best ? el("span", { class: `chip ${top ? "success" : "accent"}` }, `${best.altitude} m${top ? "+" : ""}`) : el("span", { class: "chip danger" }, `none`)),
        el("td", { title: fail ? `worst ${fmt(fail.max_drift)}${fail.vio_lost ? `, VIO lost ${fail.vio_lost} s` : ""}` : "" }, fail ? `${fail.altitude} m, ${fmt(fail.max_drift)} off` : flown ? "" : ""),
        el("td", {}, (fail || best) ? String((fail || best).features_rs) : "")))));
  }
  function nightVerdict(sum) {
    const flown = sum.filter((x) => x.flown);
    if (!flown.length) return null;
    const outdoor = flown.filter((x) => x.c.id !== "hall_floor");
    const worst = outdoor.slice().sort((a, b) => (a.best?.altitude || 0) - (b.best?.altitude || 0))[0];
    const hall = flown.find((x) => x.c.id === "hall_floor");
    const parts = [];
    if (worst) parts.push(worst.best ? `Outdoors, the hold is safe up to ${worst.best.altitude} m on every evening flown; ${worst.c.name.toLowerCase()} sets that limit.` : `${worst.c.name} couldn't hold even at ${worst.c.rungs[0]} m, so that's the night to fix first.`);
    if (hall) parts.push(hall.best ? `Indoors it held to ${hall.best.altitude} m${hall.top ? ", the highest a hall allows" : ""}.` : `Indoors it couldn't hold at ${hall.c.rungs[0]} m.`);
    return { ok: !!(worst ? worst.best : hall?.best), text: parts.join(" ") };
  }
  function renderNightResult() {
    const box = $("g-night-result");
    if (!nightResult) { box.hidden = true; return; }
    const sum = nightSummary(nightResult.rows), v = nightVerdict(sum);
    box.hidden = false;
    box.replaceChildren(
      el("strong", {}, "This run"),
      v ? el("p", {}, v.text) : null,
      nightTable(sum),
      el("p", { class: "meta" }, `${nightResult.rows.length} holds, every one shared to the board.`));
  }
  function renderNightBoard() {
    const runs = board.filter((b) => b.value.test === "night").map((b) => b.value);
    $("g-night-empty").hidden = !!runs.length;
    $("g-night-board").hidden = !runs.length;
    $("g-night-top").hidden = !runs.length;
    if (!runs.length) return;
    const sum = nightSummary(runs), v = nightVerdict(sum);
    $("g-night-top").textContent = v ? v.text : "";
    $("g-night-board").replaceChildren(nightTable(sum));
  }
  $("g-night-fly").addEventListener("click", () => { if (night) return stopTests("The worst night stopped."); startNight(); });

  // ---------- losing the lock ----------
  let loseResult = null;
  // The newest run for each cut length, without and with the fallback (older runs had none).
  function loseSummary(rows) {
    const newest = (len, fb) => rows.filter((r) => r.cut_s === len && !!r.fallback === fb).slice(-1)[0] || null;
    return LOSE.cuts.map((len) => ({ len, off: newest(len, false), on: newest(len, true) }));
  }
  const secs = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;
  function steadyCell(r) {
    if (!r) return el("span", { class: "faint" }, "not flown");
    if (r.recovered) return el("span", { class: `chip ${r.recover_s <= 5 ? "success" : "warning"}` }, r.recover_s < 0.05 ? "never left" : `after ${secs(r.recover_s)}`);
    return el("span", { class: "chip danger" }, r.reacquire_s == null ? "no tracking" : "not in 60 s");
  }
  function loseTable(sum) {
    return el("table", { class: "ladder type-body-sm" },
      el("thead", {},
        el("tr", {}, el("th", {}, ""), el("th", { colspan: "2" }, "Without fallback"), el("th", { colspan: "2" }, "With fallback")),
        el("tr", {}, el("th", {}, "Cut"), el("th", {}, "Steady again"), el("th", {}, "Worst drift"), el("th", {}, "Steady again"), el("th", {}, "Worst drift"))),
      el("tbody", {}, ...sum.map(({ len, off, on }) => el("tr", {},
        el("td", {}, `${len} s`),
        el("td", {}, steadyCell(off)), el("td", {}, off ? fmt(off.max_drift) : ""),
        el("td", {}, steadyCell(on)), el("td", {}, on ? fmt(on.max_drift) : "")))));
  }
  function loseVerdict(sum) {
    const parts = [];
    const longestOk = (k) => sum.filter((x) => x[k] && x[k].recovered).slice(-1)[0] || null;
    const firstBad = (k) => sum.find((x) => x[k] && !x[k].recovered) || null;
    const offOk = longestOk("off"), offBad = firstBad("off"), onOk = longestOk("on"), onBad = firstBad("on");
    if (!sum.some((x) => x.off || x.on)) return null;
    if (offBad) parts.push(`Without the fallback, a ${offBad.len} s cut drifted ${fmt(offBad.off.max_drift)} and never settled.`);
    else if (offOk) parts.push(`Without the fallback it came back from cuts up to ${offOk.len} s.`);
    if (onBad) parts.push(`With it, a ${onBad.len} s cut still drifted ${fmt(onBad.on.max_drift)} and didn't settle, so keep blackouts shorter than that.`);
    else if (onOk) parts.push(`With the fallback it came back from every cut up to ${onOk.len} s, worst ${fmt(onOk.on.max_drift)} off, steady ${onOk.on.recover_s < 0.05 ? "without leaving the circle" : `${secs(onOk.on.recover_s)} after tracking returned`}.`);
    return { ok: !onBad && !!onOk, text: parts.join(" ") };
  }
  function renderLoseResult() {
    const box = $("g-lose-result");
    if (!loseResult) { box.hidden = true; return; }
    const sum = loseSummary(loseResult.rows), v = loseVerdict(sum);
    box.hidden = false;
    box.replaceChildren(
      el("strong", {}, "This run"),
      v ? el("p", {}, v.text) : null,
      loseTable(sum),
      el("p", { class: "meta" }, `${loseResult.rows.length} holds, every one shared to the board.`));
  }
  function renderLoseBoard() {
    const runs = board.filter((b) => b.value.test === "recovery").map((b) => b.value);
    $("g-lose-empty").hidden = !!runs.length;
    $("g-lose-board").hidden = !runs.length;
    $("g-lose-top").hidden = !runs.length;
    if (!runs.length) return;
    const sum = loseSummary(runs), v = loseVerdict(sum);
    $("g-lose-top").textContent = v ? v.text : "";
    $("g-lose-board").replaceChildren(loseTable(sum));
  }
  $("g-lose-fly").addEventListener("click", () => { if (lose) return stopTests("Losing the lock stopped."); startLose(); });

  function renderBoard() {
    renderCheck();
    renderLoseBoard();
    renderNightBoard();
    renderSiteLadder();
    renderOtBoard();
    const list = $("g-board");
    if (!board.length) {
      list.replaceChildren(el("li", { class: "empty" }, "No runs shared yet. Fly a hold and share how it went."));
    } else {
      list.replaceChildren(...board.slice().reverse().slice(0, 30).map((rec) => {
        const r = rec.value, mine = rec.author_id === me.id;
        return el("li", { class: "card stack tight" },
          el("strong", {}, `${r.site_name}, ${r.altitude} m`),
          el("span", { class: "meta" }, `${verdict(r)}. ${names[rec.author_id] || "Someone"}, ${ago(rec.updated_at)}.`),
          el("div", { class: "row chips" }, ...chipsFor(r).slice(2)),
          el("div", { class: "row" },
            el("button", { class: "secondary small", type: "button", onclick: () => flyAgain(r) }, "Fly this again"),
            mine || isAdmin ? el("button", { class: "ghost small", type: "button", onclick: async (e) => {
              e.target.disabled = true;
              try { await missions.remove(rec.id); } catch (err) { flash(err.message); e.target.disabled = false; }
            } }, "Remove") : null));
      }));
    }
    $("g-earlier").hidden = !earlier.length;
    $("g-earlier-list").replaceChildren(...earlier.map((e) => el("li", { class: "card stack tight" },
      el("strong", {}, e.title), el("span", { class: "meta" }, e.sub))));
  }
  async function flyAgain(r) {
    Object.assign(cam, { readout: r.readout_ms, exposure: r.exposure_ms, mount: r.mount, lens: r.lens !== false });
    Object.assign(drone, { altitude: r.altitude, gnss: r.gnss, vio: r.vio, tune: r.tune, rsAware: !!r.rs_aware, anchor: !!r.anchor, fallback: !!r.fallback, wind: r.wind });
    if (r.tracker) { Object.assign(tracker, pickTracker({ ...TRACKER_DEFAULT, ...r.tracker })); trackerUi(); }
    G = grid();
    const site = SITES[r.site] ? r.site : (savedScenes.find((s) => s.value.name === r.site_name)?.id || "default");
    ui.setup = matchSetup();
    sync();
    $("g-viewport").scrollIntoView({ behavior: "smooth", block: "center" });
    await loadSite(site);
    startHold();
  }

  // ---------- sites ----------
  function worldLabel() { return `${SURFACES[worldDef.surface]?.name || worldDef.surface}, ${(LIGHTS[worldDef.light]?.name || worldDef.light).toLowerCase()}`; }
  function siteOptions() {
    const realOpts = Object.values(SITES).map((s) => el("option", { value: s.id }, `${s.name}, ${s.gsd}`));
    const madeOpts = [el("option", { value: "default" }, DEFAULT_WORLD.name)];
    for (const r of savedScenes.slice().reverse()) madeOpts.push(el("option", { value: r.id }, r.value.name));
    if (ui.site === CUSTOM) madeOpts.push(el("option", { value: CUSTOM }, "Your own world, not saved"));
    $("g-site").replaceChildren(
      el("optgroup", { label: "Real places, aerial photo on real ground" }, ...realOpts),
      el("optgroup", { label: "Generated worlds" }, ...madeOpts));
    if (!SITES[ui.site] && !["default", CUSTOM].includes(ui.site) && !savedScenes.some((r) => r.id === ui.site)) ui.site = "default";
    $("g-site").value = ui.site;
  }
  function applyTextured() {
    textured.rebuild(worldDef.surface, worldDef.seed, worldDef.patches);
    const L = textured.applyLight(worldDef.light, worldDef.shadow);
    const k = Math.min(1, 0.15 + L.sky * 0.45 + L.sun * 0.12);
    texSky.setRGB(0.62 * k, 0.7 * k, 0.8 * k);
  }
  async function loadSite(id, keepFlight) {
    ui.site = id;
    siteOptions();
    $("g-building").hidden = false;
    $("g-building").textContent = SITES[id] ? `Laying out ${SITES[id].short}…` : "Building the ground…";
    await new Promise((r) => setTimeout(r, 30));
    if (SITES[id]) {
      try {
        const w = await loadReal(id);
        if (ui.site !== id) return;
        world = w;
        built.add(w);
        dropOtherSites(w);
        $("g-site-note").textContent = `${SITES[id].kind}. ${SITES[id].note}`;
      } catch {
        real = null;
        $("g-site-note").textContent = `The aerial photo of ${SITES[id].short} would not load, so this is the textured field. Pick it again to retry.`;
        return loadSite("default");
      }
    } else {
      if (id !== CUSTOM) {
        const rec = savedScenes.find((r) => r.id === id);
        Object.assign(worldDef, rec ? { surface: rec.value.surface, light: rec.value.light, patches: !!rec.value.patches, shadow: rec.value.shadow !== false, seed: rec.value.seed } : DEFAULT_WORLD);
      }
      applyTextured();
      world = textured;
      dropOtherSites(null); real = null;
      $("g-site-note").textContent = "A generated world. Change its ground and light below, and save it for the group.";
    }
    world.scene.add(model.group, ring, plumb);
    $("g-building").hidden = true;
    if (!keepFlight) { stopTests(); result = null; $("g-result").hidden = true; newFlight(); }
    else { lastMeasureT = -1; }
    sync();
  }
  function worldEdited(what) {
    if (SITES[ui.site]) return;
    if (ui.site !== CUSTOM) { ui.site = CUSTOM; siteOptions(); }
    applyTextured();
    lastMeasureT = -1;
    note(what);
    sync();
  }
  async function saveWorld() {
    const name = $("g-world-name").value.trim() || worldLabel();
    const btn = $("g-world-save");
    btn.disabled = true;
    try {
      const rec = await scenes.add({ name: name.slice(0, 80), surface: worldDef.surface, light: worldDef.light, altitude: clamp(drone.altitude, 1, 150), patches: worldDef.patches, shadow: worldDef.shadow, seed: worldDef.seed });
      savedScenes = await scenes.list();
      ui.site = rec.id;
      $("g-world-name").value = "";
      siteOptions(); flash(`Saved ${name}.`);
    } catch (e) { flash(e.message); }
    btn.disabled = false;
  }

  // ---------- camera setups ----------
  function setupLabel() {
    if (ui.setup === "default") return DEFAULT_CAM.name;
    const rec = setups.find((r) => r.id === ui.setup);
    return rec ? rec.value.name : `Justice D, ${readoutName(cam.readout)}, ${MOUNTS[cam.mount].name.toLowerCase()}`;
  }
  function matchSetup() {
    const same = (v) => v.readout_ms === cam.readout && (v.exposure_ms || 0) === cam.exposure && v.mount === cam.mount && (v.lens !== false) === cam.lens;
    if (same(DEFAULT_CAM)) return "default";
    const rec = setups.slice().reverse().find((r) => same(r.value));
    return rec ? rec.id : "custom";
  }
  function setupOptions() {
    const opts = [el("option", { value: "default" }, DEFAULT_CAM.name)];
    for (const r of setups.slice().reverse()) opts.push(el("option", { value: r.id }, r.value.name));
    opts.push(el("option", { value: "custom" }, "Your own settings"));
    $("g-setup").replaceChildren(...opts);
    ui.setup = matchSetup();
    $("g-setup").value = ui.setup;
  }
  async function saveCamera() {
    const name = $("g-cam-name").value.trim() || `Justice D, ${readoutName(cam.readout)}, ${MOUNTS[cam.mount].name.toLowerCase()}`;
    const btn = $("g-cam-save");
    btn.disabled = true;
    try {
      const rec = await cameras.add({ name: name.slice(0, 80), readout_ms: cam.readout, exposure_ms: cam.exposure, mount: cam.mount, lens: cam.lens, noise: cam.noise });
      setups = await cameras.list();
      setupOptions(); ui.setup = rec.id; $("g-setup").value = rec.id;
      $("g-cam-name").value = "";
      flash(`Saved ${name}.`);
    } catch (e) { flash(e.message); }
    btn.disabled = false;
  }

  // ---------- time, view and flight mode ----------
  function setPaused(p) { ui.paused = p; if (!p) playhead = slowMode() ? playhead : flight.s.t; sync(); }
  function setSpeed(v) {
    const wasSlow = slowMode();
    ui.speed = v;
    if (wasSlow && !slowMode()) playhead = flight.s.t;
    if (!wasSlow && slowMode()) playhead = flight.s.t - 0.03;
    sync();
  }
  function setView(v) { ui.view = v; sync(); }
  function setMode(m, quiet) {
    if (m === "pilot" && trial && !trial.done) stopTests("Taking the sticks stopped the test.");
    ui.mode = m;
    if (flight) {
      flight.pilot.on = m === "pilot";
      if (m === "hold") { for (const k of ["fwd", "right", "up", "yaw"]) flight.pilot[k] = 0; if (!quiet) flight.holdHere(); }
    }
    sync();
  }
  function stepFrame() {
    if (!ui.paused) setPaused(true);
    advance(PERIOD, true);
  }

  // ---------- inspector controls ----------
  $("g-readout").replaceChildren(...READOUTS.map((r) => el("option", { value: String(r.ms) }, r.name)));
  $("g-exposure").replaceChildren(...EXPOSURES.map((e) => el("option", { value: String(e) }, e === 0 ? "Auto, like the camera" : `${e} ms, fixed`)));
  $("g-mount").replaceChildren(...Object.entries(MOUNTS).map(([k, v]) => el("option", { value: k }, v.name)));
  $("g-gnss").replaceChildren(...Object.entries(GNSS_MODES).map(([k, v]) => el("option", { value: k }, v)));
  $("g-tune").replaceChildren(...Object.entries(VIO_TUNES).map(([k, v]) => el("option", { value: k }, v.name)));
  $("g-gust").replaceChildren(...Object.entries(GUSTS).map(([k, v]) => el("option", { value: k }, v.name)));
  $("g-surface").replaceChildren(...Object.entries(SURFACES).map(([k, v]) => el("option", { value: k }, v.name)));
  $("g-light").replaceChildren(...Object.entries(LIGHTS).map(([k, v]) => el("option", { value: k }, v.name)));
  $("g-rungs").replaceChildren(...RUNGS.map((a) => el("button", { class: "small secondary", type: "button", "data-alt": String(a), onclick: () => setAlt(a) }, `${a} m`)));
  $("g-speed").replaceChildren(...SPEEDS.slice().reverse().map((v) => el("option", { value: String(v) }, speedName(v))));

  const dirName = (d) => ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(d / 45) % 8];
  function sync() {
    $("g-readout").value = String(cam.readout);
    $("g-exposure").value = String(cam.exposure);
    $("g-mount").value = cam.mount;
    $("g-lens").checked = cam.lens;
    $("g-noise").checked = cam.noise;
    $("g-setup").value = ui.setup;
    $("g-alt").value = Math.round(drone.altitude); $("g-alt-out").textContent = `${Math.round(drone.altitude)} m`;
    for (const b of $("g-rungs").children) b.className = +b.dataset.alt === Math.round(drone.altitude) ? "small" : "small secondary";
    $("g-gnss").value = drone.gnss;
    $("g-vio").checked = drone.vio;
    $("g-tune").value = drone.tune; $("g-tune").disabled = !drone.vio;
    $("g-rsaware").checked = drone.rsAware; $("g-rsaware").disabled = !drone.vio;
    $("g-anchor").checked = drone.anchor; $("g-anchor").disabled = !drone.vio;
    $("g-fallback").checked = drone.fallback; $("g-fallback").disabled = !drone.vio;
    $("g-wind").value = drone.wind; $("g-wind-out").textContent = `${drone.wind} m/s`;
    $("g-dir").value = drone.windDir; $("g-dir-out").textContent = `the ${dirName(drone.windDir)}`;
    $("g-gust").value = drone.gust;
    $("g-charge").value = drone.charge; $("g-charge-out").textContent = `${Math.round(drone.charge * 100)}%`;
    if (document.activeElement !== $("g-mass")) $("g-mass").value = AIRFRAME.mass;
    if (document.activeElement !== $("g-thrust")) $("g-thrust").value = AIRFRAME.maxThrust;
    if (flight) {
      const hov = flight.hoverThrottle();
      $("g-hover").textContent = hov >= 1 ? `Too heavy to hover on these motors at ${flight.voltage().toFixed(1)} V.` : `Hovers at ${Math.round(hov * 100)}% throttle on a ${flight.voltage().toFixed(1)} V pack.`;
      $("g-hover").className = hov > 0.75 ? "meta tone-bad" : "meta";
    }
    $("g-world-edit").hidden = !!SITES[ui.site];
    $("g-surface").value = worldDef.surface; $("g-light").value = worldDef.light;
    $("g-patches").checked = worldDef.patches; $("g-shadow").checked = worldDef.shadow;
    $("g-seed").textContent = `Layout ${worldDef.seed}`;
    $("g-feat").checked = ui.feats; $("g-inset").checked = ui.inset;
    $("g-speed").value = String(ui.speed);
    $("g-play").textContent = ui.paused ? "Play" : "Pause";
    $("g-play").className = ui.paused ? "small" : "small secondary";
    for (const v of VIEWS) {
      const b = $(`g-view-${v}`);
      b.className = ui.view === v ? "small" : "small secondary";
      b.setAttribute("aria-pressed", String(ui.view === v));
    }
    $("g-inset").disabled = ui.view === "split";
    for (const m of ["hold", "pilot"]) {
      const b = $(`g-mode-${m}`);
      b.className = ui.mode === m ? "small" : "small secondary";
      b.setAttribute("aria-pressed", String(ui.mode === m));
    }
    $("g-pad").hidden = ui.mode !== "pilot";
    keysHint();
    for (const t of TABS) {
      const b = $(`g-tab-${t}`), on = ui.tab === t;
      b.className = on ? "small" : "small secondary";
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $(`g-panel-${t}`).hidden = !on;
    }
    const running = trial && !trial.done;
    $("g-hold").textContent = running && !ladder ? "Start the hold again" : "Fly a 60 s hold";
    if ($("g-sweep")) $("g-sweep").textContent = sweep ? `${SITES[CHECK_SITES[sweep.i]].short}, ${sweep.i + 1} of ${CHECK_SITES.length}, stop` : "Fly all four real sites";
    if ($("g-ladder")) $("g-ladder").textContent = ladder && !ladder.auto ? `Ladder: ${RUNGS[ladder.i]} m, stop` : "Altitude ladder";
    const otName = otest ? (otest.list[otest.i]?.name || "") : "";
    $("g-ot-fly").textContent = otest && otest.list.length === 1 ? "Ottawa test running, stop" : "Fly the Ottawa test";
    $("g-ot-sweep").textContent = otest && otest.list.length > 1 ? `${otName}, ${Math.min(otest.i + 1, otest.list.length)} of ${otest.list.length}, stop` : `Sweep ${OT_PRESETS.length} presets`;
    const lp = lose ? LOSE_PLAN[Math.min(lose.i, LOSE_PLAN.length - 1)] : null;
    $("g-lose-fly").textContent = lose ? `${lp.len} s cut ${lp.fb ? "with" : "without"} fallback (${Math.min(lose.i + 1, LOSE_PLAN.length)} of ${LOSE_PLAN.length}), stop` : "Fly losing the lock";
    $("g-night-fly").textContent = night ? `${NIGHT[night.ci].short}, ${NIGHT[night.ci].rungs[night.ri]} m (${night.ci + 1} of ${NIGHT.length}), stop` : "Fly the worst night";
    if ($("g-lad-fly")) $("g-lad-fly").textContent = ladder?.auto ? `Dübendorf ladder: ${RUNGS[ladder.i] ?? RUNGS[RUNGS.length - 1]} m, stop` : "Fly the ladder on Dübendorf";
  }
  function keysHint() {
    const k = (t) => el("kbd", {}, t);
    const parts = ui.mode === "pilot"
      ? [k("W"), k("A"), k("S"), k("D"), " move, ", k("R"), k("F"), " climb and descend, ", k("Q"), k("E"), " turn, ", k("H"), " hold here, ", k("Space"), " pause."]
      : [k("P"), " or a move key takes the sticks, ", k("Space"), " pauses, ", k("."), " steps a frame, ", k("1"), "–", k("4"), " change the view, drag to orbit."];
    $("g-keys").replaceChildren(...parts);
  }
  const camChanged = (what) => { ui.setup = matchSetup(); G = grid(); note(what); sync(); lastMeasureT = -1; };
  function setAlt(a) { drone.altitude = a; flight.setAltitude(a); note(`to ${a} m`); sync(); lastMeasureT = -1; }
  function setAirframe() {
    const m = +$("g-mass").value, th = +$("g-thrust").value;
    if (m >= 0.5 && m <= 10) { AIRFRAME.mass = m; AIRFRAME.inertia = BASE_INERTIA.map((v) => v * m / BASE_MASS); }
    if (th >= 3 && th <= 60) AIRFRAME.maxThrust = th;
    note("airframe"); sync();
  }

  $("g-setup").addEventListener("change", (e) => {
    const id = e.target.value;
    const v = id === "default" ? DEFAULT_CAM : setups.find((r) => r.id === id)?.value;
    if (v) Object.assign(cam, { readout: v.readout_ms, exposure: v.exposure_ms || 0, mount: v.mount, lens: v.lens !== false, noise: v.noise !== false });
    ui.setup = id;
    G = grid(); note("camera setup"); sync(); lastMeasureT = -1;
  });
  $("g-readout").addEventListener("change", (e) => { const was = slowMode(); cam.readout = +e.target.value; if (was !== slowMode()) setSpeed(ui.speed); camChanged(readoutName(cam.readout)); });
  $("g-exposure").addEventListener("change", (e) => { cam.exposure = +e.target.value; camChanged("exposure"); });
  $("g-mount").addEventListener("change", (e) => { cam.mount = e.target.value; camChanged(MOUNTS[cam.mount].name.toLowerCase()); });
  $("g-lens").addEventListener("change", (e) => { cam.lens = e.target.checked; camChanged("lens"); });
  $("g-noise").addEventListener("change", (e) => { cam.noise = e.target.checked; camChanged("noise"); });
  $("g-cam-save").addEventListener("click", saveCamera);
  $("g-alt").addEventListener("input", (e) => { drone.altitude = +e.target.value; flight.setAltitude(drone.altitude); sync(); });
  $("g-alt").addEventListener("change", () => { note(`to ${drone.altitude} m`); lastMeasureT = -1; });
  $("g-gnss").addEventListener("change", (e) => { drone.gnss = e.target.value; flight.set.gnss = drone.gnss; note(`GNSS ${GNSS_MODES[drone.gnss].toLowerCase()}`); sync(); });
  $("g-vio").addEventListener("change", (e) => { drone.vio = e.target.checked; flight.set.vio = drone.vio; note(drone.vio ? "VIO on" : "VIO off"); sync(); });
  $("g-tune").addEventListener("change", (e) => { drone.tune = e.target.value; flight.set.tune = drone.tune; note("VIO tune"); sync(); });
  $("g-fallback").addEventListener("change", (e) => { drone.fallback = e.target.checked; flight.set.fallback = drone.fallback; note(drone.fallback ? "lost-lock fallback on" : "lost-lock fallback off"); sync(); });
  $("g-anchor").addEventListener("change", (e) => { drone.anchor = e.target.checked; flight.set.anchor = drone.anchor; note(drone.anchor ? "anchored to the mark" : "anchor off"); sync(); });
  $("g-rsaware").addEventListener("change", (e) => { drone.rsAware = e.target.checked; flight.set.rsAware = drone.rsAware; note(drone.rsAware ? "shutter-aware VIO" : "plain VIO"); sync(); });
  $("g-wind").addEventListener("input", (e) => { drone.wind = +e.target.value; flight.set.wind = drone.wind; sync(); });
  $("g-wind").addEventListener("change", () => note(`wind ${drone.wind} m/s`));
  $("g-dir").addEventListener("input", (e) => { drone.windDir = +e.target.value; flight.set.windDir = drone.windDir; sync(); });
  $("g-gust").addEventListener("change", (e) => { drone.gust = e.target.value; flight.set.gust = drone.gust; note(GUSTS[drone.gust].name.toLowerCase()); sync(); });
  $("g-charge").addEventListener("input", (e) => { drone.charge = +e.target.value; flight.set.charge = drone.charge; sync(); });
  $("g-mass").addEventListener("change", setAirframe);
  $("g-thrust").addEventListener("change", setAirframe);
  $("g-site").addEventListener("change", (e) => loadSite(e.target.value));
  $("g-surface").addEventListener("change", (e) => { worldDef.surface = e.target.value; worldEdited("ground"); });
  $("g-light").addEventListener("change", (e) => { worldDef.light = e.target.value; worldEdited("light"); });
  $("g-patches").addEventListener("change", (e) => { worldDef.patches = e.target.checked; worldEdited("patches"); });
  $("g-shadow").addEventListener("change", (e) => { worldDef.shadow = e.target.checked; worldEdited("shadow"); });
  $("g-reseed").addEventListener("click", () => { worldDef.seed = 1 + Math.floor(Math.random() * 99998); worldEdited("layout"); });
  $("g-world-save").addEventListener("click", saveWorld);
  $("g-feat").addEventListener("change", (e) => { ui.feats = e.target.checked; });
  $("g-inset").addEventListener("change", (e) => { ui.inset = e.target.checked; });
  $("g-speed").addEventListener("change", (e) => setSpeed(+e.target.value));
  $("g-play").addEventListener("click", () => setPaused(!ui.paused));
  $("g-step").addEventListener("click", stepFrame);
  $("g-reset").addEventListener("click", () => { stopTests(); result = null; $("g-result").hidden = true; newFlight(); sync(); });
  for (const v of VIEWS) $(`g-view-${v}`).addEventListener("click", () => setView(v));
  $("g-mode-hold").addEventListener("click", () => setMode("hold"));
  $("g-mode-pilot").addEventListener("click", () => setMode("pilot"));
  $("g-kick").addEventListener("click", () => { flight.kick(); note("kick"); });
  $("g-blind").addEventListener("click", () => { flight.blind(3); note("tracking cut for 3 s"); });
  $("g-hold").addEventListener("click", startHold);
  $("g-sweep")?.addEventListener("click", () => { if (sweep) stopTests(); else startSweep(); });
  $("g-ladder")?.addEventListener("click", () => { if (ladder) stopTests(); else startLadder(); });
  $("g-lad-fly")?.addEventListener("click", () => { if (!ladder?.auto) return startSiteLadder(); if (trial && !trial.done) stopTests(); else { ladder = null; sync(); } });
  TABS.forEach((t, i) => {
    const b = $(`g-tab-${t}`);
    b.addEventListener("click", () => { ui.tab = t; sync(); });
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      ui.tab = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      sync(); $(`g-tab-${ui.tab}`).focus();
    });
  });

  // ---------- the sticks: keyboard and on-screen pad ----------
  const held = new Set();
  const KEYS = { w: ["fwd", 1], arrowup: ["fwd", 1], s: ["fwd", -1], arrowdown: ["fwd", -1], a: ["right", -1], arrowleft: ["right", -1], d: ["right", 1], arrowright: ["right", 1], r: ["up", 1], f: ["up", -1], q: ["yaw", 1], e: ["yaw", -1] };
  const padHeld = new Map();
  function applySticks() {
    if (!flight) return;
    const p = flight.pilot;
    for (const k of ["fwd", "right", "up", "yaw"]) p[k] = 0;
    for (const key of held) { const [a, v] = KEYS[key]; p[a] = clamp(p[a] + v, -1, 1); }
    for (const [a, v] of padHeld.values()) p[a] = clamp(p[a] + v, -1, 1);
  }
  const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  window.addEventListener("keydown", (e) => {
    if ($("engine").hidden || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (KEYS[key]) {
      if (key.startsWith("arrow") && e.target.getAttribute && e.target.getAttribute("role") === "tab") return;
      e.preventDefault();
      if (ui.mode !== "pilot") setMode("pilot");
      held.add(key); applySticks(); return;
    }
    if (e.target.tagName === "BUTTON" && (key === " " || key === "enter")) return;
    if (key === " ") { e.preventDefault(); setPaused(!ui.paused); }
    else if (key === ".") stepFrame();
    else if (key === "k") { flight.kick(); note("kick"); }
    else if (key === "h") setMode("hold");
    else if (key === "p") setMode("pilot");
    else if (["1", "2", "3", "4"].includes(key)) setView(VIEWS[+key - 1]);
    else if (key === "-" || key === "=" || key === "+") {
      const i = SPEEDS.indexOf(ui.speed);
      setSpeed(SPEEDS[clamp(i + (key === "-" ? -1 : 1), 0, SPEEDS.length - 1)]);
    }
  });
  window.addEventListener("keyup", (e) => { const key = e.key.toLowerCase(); if (held.delete(key)) applySticks(); });
  window.addEventListener("blur", () => { held.clear(); padHeld.clear(); applySticks(); });
  for (const b of $("g-pad").querySelectorAll("button")) {
    const [a, v] = b.dataset.stick.split(":");
    const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); padHeld.set(b, [a, +v]); b.classList.add("held"); applySticks(); };
    const off = () => { padHeld.delete(b); b.classList.remove("held"); applySticks(); };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); padHeld.set(b, [a, +v]); applySticks(); } });
    b.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") off(); });
  }

  // ---------- orbiting with the mouse ----------
  const vp = $("g-viewport");
  let drag = null;
  vp.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; vp.setPointerCapture(e.pointerId); vp.focus({ preventScroll: true }); });
  vp.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    if (ui.view === "chase") setView("orbit");
    if (ui.view !== "orbit") return;
    orbit.az -= dx * 0.008; orbit.el = clamp(orbit.el + dy * 0.006, -0.2, 1.5);
    drag = { x: e.clientX, y: e.clientY };
  });
  vp.addEventListener("pointerup", () => { drag = null; });
  vp.addEventListener("wheel", (e) => {
    if (ui.view !== "orbit" && ui.view !== "chase") return;
    e.preventDefault();
    if (ui.view === "chase") setView("orbit");
    orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1, 400);
  }, { passive: false });

  // ---------- drawing ----------
  const overlay = $("g-overlay");
  function resize() {
    const box = vp.getBoundingClientRect();
    const w = Math.max(320, Math.round(box.width)), h = Math.round(w / ASPECT);
    renderer.setSize(w, h, false);
    overlay.width = w; overlay.height = h;
    for (const id of ["g-track", "g-drift"]) {
      const c = $(id), b = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(200, Math.round(b.width * dpr)); c.height = Math.round(c.width * 0.62);
    }
  }
  new ResizeObserver(resize).observe(vp);

  const shownT = () => slowMode() ? playhead : flight.s.t;
  function poseModel() {
    const s = flight.s, t = shownT(), b = bodyAt(t);
    model.group.position.set(...b.p);
    model.group.quaternion.set(...b.q);
    model.group.updateMatrixWorld(true);
    const lag = s.t - t, perFrame = (ui.paused ? 0 : ui.speed) / 60;
    for (const p of model.props) {
      const turn = s.rpm[p.i] / 60 * 2 * Math.PI;
      p.hub.rotation.y = (s.spin[p.i] - lag * turn * MOTORS[p.i].s) % (Math.PI * 2);
      const blurred = s.rpm[p.i] > 1500 && turn * perFrame > 0.6;
      p.blade.visible = !blurred; p.disc.visible = blurred;
    }
    const g = world.heightAt(b.p[0], b.p[2]);
    plumb.geometry.setFromPoints([new T.Vector3(...b.p), new T.Vector3(b.p[0], g + 0.05, b.p[2])]);
    ring.position.set(flight.hold[0], world.heightAt(flight.hold[0], flight.hold[1]) + 0.06, flight.hold[1]);
    const yaw = flight.yaw;
    const at = model.group.position;
    if (ui.view === "orbit") {
      const d = orbit.dist, a = orbit.az + yaw;
      chase.position.set(at.x + Math.sin(a) * Math.cos(orbit.el) * d, at.y + Math.sin(orbit.el) * d, at.z + Math.cos(a) * Math.cos(orbit.el) * d);
      chase.position.y = Math.max(chase.position.y, world.heightAt(chase.position.x, chase.position.z) + 0.3);
      chase.lookAt(at.x, at.y, at.z);
    } else {
      const back = new T.Vector3(0.9, 0.55, 2.2).applyQuaternion(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.35 + yaw));
      chase.position.copy(at).add(back);
      chase.lookAt(at.x, at.y - 0.25, at.z);
    }
  }
  function insetRect(W) {
    const w = Math.round(W * 0.28), h = Math.round(w / ASPECT), m = Math.round(W * 0.015);
    return { x: W - w - m, y: m, w, h }; // y from the bottom, as GL counts
  }
  const clearCol = new T.Color();
  function draw() {
    const size = renderer.getSize(new T.Vector2()), W = size.x, Hh = size.y;
    poseModel();
    renderRef();
    renderer.toneMappingExposure = 1;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, Hh);
    const boxes = [];
    let ins = null;
    if (ui.view === "split") {
      clearCol.set(css("surface-sunken"));
      renderer.setClearColor(clearCol, 1); renderer.clear();
      const w = Math.floor(W / 2) - 2, h = Math.round(w / ASPECT), y = Math.round((Hh - h) / 2);
      renderer.setScissorTest(true);
      for (const [i, mode] of [[0, 0], [1, 1]]) {
        const x = i ? W - w : 0;
        renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
        renderFrame(null, mode);
        boxes.push({ x, y: Hh - y - h, w, h, label: mode ? "Global shutter" : "Rolling shutter", rs: !mode });
      }
    } else {
      const camMain = ui.view === "cam";
      if (camMain) { renderFrame(null, 0); boxes.push({ x: 0, y: 0, w: W, h: Hh, rs: true, main: true }); }
      else renderer.render(world.scene, chase);
      if (ui.inset) {
        ins = insetRect(W);
        renderer.setScissorTest(true);
        renderer.setScissor(ins.x, ins.y, ins.w, ins.h);
        renderer.setViewport(ins.x, ins.y, ins.w, ins.h);
        const box = { x: ins.x, y: Hh - ins.y - ins.h, w: ins.w, h: ins.h, inset: true };
        if (camMain) { const v = chase.clone(); poseChaseOnly(v); renderer.render(world.scene, v); box.label = "Chase"; }
        else { renderFrame(null, 0); box.label = "Justice D"; box.rs = true; }
        boxes.push(box);
      }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, Hh);
    drawOverlay(boxes, W, Hh);
  }
  function poseChaseOnly(v) {
    const at = model.group.position;
    const back = new T.Vector3(0.9, 0.55, 2.2).applyQuaternion(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.35 + flight.yaw));
    v.position.copy(at).add(back);
    v.lookAt(at.x, at.y - 0.25, at.z);
  }
  function drawOverlay(boxes, W, Hh) {
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, W, Hh);
    const scanning = slow.scan >= 0 && slow.scan < 1;
    const fs = Math.max(10, Math.round(W / 95));
    ctx.font = `${fs}px ${FONT()}`;
    for (const b of boxes) {
      if (b.rs && scanning) {
        const y = b.y + slow.scan * b.h;
        ctx.strokeStyle = css("accent-2"); ctx.lineWidth = Math.max(1.5, W / 600);
        ctx.beginPath(); ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); ctx.stroke();
      }
      if (b.rs && ui.feats && !scanning && feats.points.length) {
        ctx.fillStyle = css("accent-4");
        const sx = b.w / AW, sy = b.h / AH, r = Math.max(1.2, b.w / 520);
        const inner = boxes.find((o) => o.inset && o !== b);
        for (let i = 0; i < feats.points.length; i += 2) {
          const x = b.x + feats.points[i] * sx, y = b.y + feats.points[i + 1] * sy;
          if (b.main && inner && x > inner.x && y > inner.y && x < inner.x + inner.w && y < inner.y + inner.h) continue;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
        }
      }
      if (b.inset) { ctx.strokeStyle = css("border-strong"); ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); }
      if (b.label) {
        const tw = ctx.measureText(b.label).width;
        const lx = b.inset ? b.x + 6 : b.x + 8, ly = b.inset ? b.y + 6 : b.y + 8;
        ctx.fillStyle = css("surface-floating");
        ctx.fillRect(lx, ly, tw + fs, fs * 1.6);
        ctx.fillStyle = css("text-primary");
        ctx.fillText(b.label, lx + fs / 2, ly + fs * 1.15);
      }
    }
  }

  function drawTrack() {
    const c = $("g-track"), ctx = c.getContext("2d"), W = c.width, Hh = c.height;
    ctx.clearRect(0, 0, W, Hh);
    const ox = flight.hold[0], oz = flight.hold[1];
    let ext = RADIUS * 2;
    for (const p of track) ext = Math.max(ext, Math.abs(p.x - ox) * 1.15, Math.abs(p.z - oz) * 1.15, Math.abs(p.bx - ox) * 1.15, Math.abs(p.bz - oz) * 1.15);
    const sc = Math.min(W, Hh) / 2 / ext, cx = W / 2, cy = Hh / 2;
    const X = (x) => cx + (x - ox) * sc, Y = (z) => cy + (z - oz) * sc;
    const stepM = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((m) => m * sc > 28) || 500;
    ctx.strokeStyle = css("border-subtle"); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = -Math.ceil(ext / stepM) * stepM; m <= ext * 2; m += stepM) { ctx.moveTo(cx + m * sc, 0); ctx.lineTo(cx + m * sc, Hh); ctx.moveTo(0, cy + m * sc); ctx.lineTo(W, cy + m * sc); }
    ctx.stroke();
    ctx.strokeStyle = css("accent-5"); ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, RADIUS * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const line = (kx, kz, color, dash) => {
      if (track.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
      ctx.beginPath(); track.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p[kx]), Y(p[kz]))); ctx.stroke();
      ctx.setLineDash([]);
    };
    line("bx", "bz", css("accent-3"), [4, 3]);
    line("x", "z", css("accent-1"));
    const s = flight.s;
    ctx.fillStyle = css("accent-1");
    ctx.beginPath(); ctx.arc(X(s.p[0]), Y(s.p[2]), 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css("text-secondary"); ctx.font = `${12 * (W / (c.getBoundingClientRect().width || W))}px ${FONT()}`;
    ctx.fillText(`grid ${stepM < 1 ? stepM * 100 + " cm" : stepM + " m"} · north up`, 8, Hh - 8);
  }
  function drawDrift() {
    const c = $("g-drift"), ctx = c.getContext("2d"), W = c.width, Hh = c.height;
    ctx.clearRect(0, 0, W, Hh);
    const k = W / (c.getBoundingClientRect().width || W) || 1;
    const pad = 30 * k, fs = 11 * k;
    const live = trial && !trial.done;
    const t0 = live ? trial.start : Math.max(track[0]?.t ?? 0, flight.s.t - 30);
    const span = live ? TRIAL : 30;
    const pts = track.filter((p) => p.t >= t0);
    let top = RADIUS * 1.6, fTop = 50;
    for (const p of pts) { top = Math.max(top, p.d * 1.1); fTop = Math.max(fTop, p.f * 1.1); }
    const X = (t) => pad + (t - t0) / span * (W - 2 * pad), Y = (d) => Hh - pad - d / top * (Hh - pad - 8), YF = (f) => Hh - pad - f / fTop * (Hh - pad - 8);
    ctx.strokeStyle = css("border-subtle"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0)); ctx.moveTo(pad, Y(0)); ctx.lineTo(pad, 8); ctx.stroke();
    ctx.strokeStyle = css("accent-1"); ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(pad, Y(RADIUS)); ctx.lineTo(W - pad, Y(RADIUS)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.font = `${fs}px ${FONT()}`; ctx.fillStyle = css("text-secondary");
    ctx.fillText(fmt(top), 2, 8 + fs); ctx.fillText("0", 2, Y(0));
    ctx.fillText(String(Math.round(fTop)), W - pad + 4, 8 + fs);
    ctx.fillText(live ? "60 s" : "last 30 s", W / 2 - fs * 2, Hh - 6);
    if (marks.length && live) {
      ctx.strokeStyle = css("text-tertiary"); ctx.lineWidth = 1;
      for (const m of marks) { const x = X(t0 + m.t); ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, Y(0)); ctx.stroke(); ctx.fillText(m.text, x + 3, 8 + fs); }
    }
    if (pts.length > 1) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = css("accent-5");
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.t), YF(p.f))); ctx.stroke();
      ctx.strokeStyle = css("accent-1");
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.t), Y(p.d))); ctx.stroke();
    }
    $("g-drift-note").textContent = live ? `${Math.floor(flight.s.t - trial.start)} s of ${TRIAL}` : ui.mode === "pilot" ? "Piloting" : "Free hold";
  }

  function card(label, value, sub, tone) {
    return el("div", { class: "card stack tight readout" },
      el("span", { class: "eyebrow" }, label),
      el("span", { class: "type-heading-sm" + (tone ? ` tone-${tone}` : "") }, value),
      sub ? el("span", { class: "meta" }, sub) : null);
  }
  function readouts() {
    const f = flight, s = f.s, d = f.drift();
    if (ui.tab === "tests" && feats.rs) $("g-ot-live").textContent = `This frame: ${feats.rs.features.toLocaleString()} corners, ${Math.round(feats.rs.coverage * 100)}% of the frame covered${feats.rs.junk ? `, ${feats.rs.junk.toLocaleString()} sensor speckles ignored` : ""}.`;
    const { ms } = exposureNow();
    const lost = feats.rs && feats.gs && feats.gs.features ? 1 - feats.rs.features / feats.gs.features : 0;
    const q = f.vio.quality ?? 1;
    $("g-readouts").replaceChildren(
      card("Drift from the mark", fmt(d), trial && !trial.done ? `worst ${fmt(trial.max)} this hold` : ui.mode === "pilot" ? "the mark follows the sticks" : "since the hold began", d > RADIUS ? "bad" : "good"),
      card("Flying on", f.fb.mode !== "off" ? FB_NAMES[f.fb.mode] : NAV_NAMES[f.est.src] || f.est.src, drone.vio ? `${VIO_STATE[f.vio.state]}, quality ${Math.round(q * 100)}%${f.vio.anchored ? ", anchored" : ""}` : "VIO off", f.vio.state === "lost" || f.est.src === "none" ? "bad" : null),
      card("Features VIO tracks", feats.rs ? String(feats.rs.features) : "…", feats.gs ? `${feats.gs.features} with a global shutter${lost > 0.05 ? `, ${Math.round(lost * 100)}% more` : ""}` : "", (feats.rs?.coverage ?? 1) < 0.2 ? "bad" : null),
      card("Shutter warp", `${px(live.warp)} px`, cam.readout === 0 ? "Global shutter: no warp" : drone.rsAware ? "VIO corrects most of it" : "VIO treats it as noise", live.warp > 2 && !drone.rsAware ? "bad" : live.warp < 1 ? "good" : null),
      card("Motion blur", `${px(live.blur)} px`, `${ms < 1 ? ms.toFixed(1) : Math.round(ms * 10) / 10} ms exposure`, live.blur > 3 ? "bad" : null),
      card("Battery", `${f.voltage().toFixed(1)} V`, `hover at ${Math.round(f.hoverThrottle() * 100)}% throttle`, f.hoverThrottle() > 0.8 ? "bad" : null));
  }
  function chip(text, tone) { return el("span", { class: `chip${tone ? " " + tone : ""}` }, text); }
  function hud() {
    const f = flight, s = f.s;
    const running = trial && !trial.done;
    $("g-hud-tl").replaceChildren(...[
      chip(ui.paused ? "Paused" : speedName(ui.speed), ui.paused ? "warning" : null),
      chip(`t ${s.t.toFixed(ui.speed < 0.1 ? 3 : 1)} s`),
      chip(ui.mode === "pilot" ? "Piloting" : "Holding", ui.mode === "pilot" ? "accent" : null),
      chip(NAV_NAMES[f.est.src] || f.est.src, f.vio.state === "lost" || f.est.src === "none" ? "danger" : null),
      running ? chip(`${ladder ? `Ladder ${ladder.i + 1} of 4, ` : sweep ? `Site ${sweep.i + 1} of ${CHECK_SITES.length}, ` : otest && otest.list.length > 1 ? `Preset ${otest.i + 1} of ${otest.list.length}, ` : night ? `${NIGHT[night.ci].short} ${drone.altitude} m, ` : lose ? `${LOSE_PLAN[lose.i].len} s cut${LOSE_PLAN[lose.i].fb ? " with fallback" : ""}, ` : ""}${Math.ceil(Math.max(0, TRIAL - (s.t - trial.start)))} s left`, "accent") : null].filter(Boolean));
    const sp = Math.hypot(s.v[0], s.v[2]);
    const hdg = ((-f.yaw * 180 / Math.PI) % 360 + 360) % 360;
    $("g-hud-bl").replaceChildren(
      chip(`${(s.p[1] - s.ground).toFixed(1)} m up`),
      chip(`${sp.toFixed(1)} m/s`),
      chip(`heading ${Math.round(hdg)}°`),
      chip(`drift ${fmt(f.drift())}`, f.drift() > RADIUS ? "danger" : "success"));
    const c = $("g-clock");
    const scanning = slowMode();
    c.hidden = !scanning;
    if (scanning) {
      const ms = (slow.into * 1000).toFixed(slow.into < 0.01 ? 2 : 1);
      c.textContent = slow.scan < 1 ? `Reading row ${Math.max(1, Math.round(slow.scan * AH))} of ${AH} · ${ms} ms into the frame` : `Frame read out · next in ${Math.max(0, (PERIOD - slow.into) * 1000).toFixed(1)} ms`;
    }
  }

  // ---------- the loop ----------
  function physicsTo(target) {
    let n = 0;
    while (flight.s.t < target && n < 2000) {
      flight.step(H); record(); n++;
      if (flight.s.t - lastSample >= 0.05) { lastSample = flight.s.t; sample(); if (nextRung || nextSite || nextOt || nextNight || nextLose) break; }
    }
  }
  function advance(dtSim) {
    if (nextRung || nextSite || nextOt || nextNight || nextLose) return;
    playhead += Math.min(dtSim, 0.25);
    if (slowMode()) physicsTo(playhead + 0.03);
    else { physicsTo(playhead); playhead = Math.max(playhead, flight.s.t - flight.DT); }
  }
  let lastWall = performance.now(), lastUi = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    const wall = Math.min(0.05, (now - lastWall) / 1000);
    lastWall = now;
    if ($("engine").hidden || !frame || !flight) return;
    if (nextRung) { nextRung = false; runRung(); }
    if (nextSite) { nextSite = false; runSite(); }
    if (nextOt) { nextOt = false; runOt(); }
    if (nextNight) { nextNight = false; runNight(); }
    if (nextLose) { nextLose = false; runLose(); }
    if (!ui.paused) advance(wall * ui.speed);
    buildFrame(slowMode() ? playhead : null);
    if (!slowMode() && !ui.paused) seedN++;
    const w = warpAt(frame.tc);
    live.warp = live.warp * 0.7 + w.warp * 0.3;
    live.blur = live.blur * 0.7 + w.blur * 0.3;
    flight.vio.warp = live.warp; flight.vio.blur = live.blur;
    if (lastMeasureT < 0 || flight.s.t - lastMeasureT >= MEASURE_EVERY) { lastMeasureT = flight.s.t; measure(false); onMeasured(); }
    draw();
    if (now - lastUi > 200) {
      lastUi = now;
      readouts(); hud(); drawTrack(); drawDrift();
      if (Math.round(drone.altitude) !== Math.round(flight.altSp)) { drone.altitude = Math.round(flight.altSp); sync(); }
    }
  }

  async function loadBoard() {
    board = await missions.list();
    renderBoard();
  }
  async function loadEarlier() {
    const [fl, be] = await Promise.all([flightsCol.list().catch(() => []), benchCol.list().catch(() => [])]);
    earlier = [
      ...fl.map((r) => ({ at: r.updated_at, title: r.value.kind === "ceiling" ? `Ceiling ${r.value.altitude} m on ${r.value.world}` : `${r.value.altitude} m hold on ${r.value.world}`, sub: `${r.value.passed ? "Held" : "Drifted out"}, worst ${fmt(r.value.max_drift || 0)}. ${names[r.author_id] || "Someone"}, ${ago(r.updated_at)}.` })),
      ...be.map((r) => ({ at: r.updated_at, title: `Benchmark: ${r.value.site} against ${r.value.world}`, sub: `${(r.value.rows || []).map((x) => `${x.alt} m: ${fmt(x.site_drift || 0)} vs ${fmt(x.field_drift || 0)}`).join(", ")}. ${names[r.author_id] || "Someone"}, ${ago(r.updated_at)}.` }))
    ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);
    renderBoard();
  }
  async function loadScenes() { savedScenes = await scenes.list(); siteOptions(); }
  async function loadSetups() { setups = await cameras.list(); setupOptions(); }
  missions.subscribe(loadBoard);
  scenes.subscribe(loadScenes);
  cameras.subscribe(loadSetups);
  await Promise.all([loadScenes(), loadSetups(), loadBoard(), loadEarlier()]);
  resize();
  await loadSite("dubendorf");
  requestAnimationFrame(tick);

  // A lesson can set the sim up for the member: a site, a height, a camera and nav setup.
  async function apply(p = {}) {
    if (p.site && p.site !== ui.site && SITES[p.site]) await loadSite(p.site);
    if (p.airframe) {
      const a = p.airframe;
      if (a.mass >= 0.5 && a.mass <= 10) AIRFRAME.mass = a.mass;
      if (a.inertia) AIRFRAME.inertia = a.inertia.map((v, i) => v > 0 && v < 1 ? v : AIRFRAME.inertia[i]);
      if (a.maxThrust >= 3 && a.maxThrust <= 60) AIRFRAME.maxThrust = a.maxThrust;
      if (a.motorTau > 0.002 && a.motorTau < 0.5) AIRFRAME.motorTau = a.motorTau;
      if (a.dragQuad > 0 && a.dragQuad < 1) AIRFRAME.dragQuad = a.dragQuad;
      note("measured airframe");
    }
    if (p.readout != null && p.readout >= 0 && p.readout <= 60 && !READOUTS.some((r) => r.ms === p.readout)) {
      READOUTS.push({ ms: p.readout, name: `${p.readout} ms, measured` });
      READOUTS.sort((a, b) => a.ms - b.ms);
      $("g-readout").replaceChildren(...READOUTS.map((r) => el("option", { value: String(r.ms) }, r.name)));
    }
    if (p.readout != null) { const was = slowMode(); cam.readout = p.readout; if (was !== slowMode()) setSpeed(ui.speed); }
    if (p.mount && MOUNTS[p.mount]) cam.mount = p.mount;
    if (p.readout != null || p.mount) camChanged(p.readout != null ? readoutName(cam.readout) : MOUNTS[cam.mount].name.toLowerCase());
    if (p.gnss && GNSS_MODES[p.gnss]) { drone.gnss = p.gnss; flight.set.gnss = p.gnss; }
    if (p.vio != null) { drone.vio = p.vio; flight.set.vio = p.vio; }
    if (p.altitude) setAlt(p.altitude);
    if (p.view && VIEWS.includes(p.view)) ui.view = p.view;
    if (p.tab && TABS.includes(p.tab)) ui.tab = p.tab;
    if (p.speed && SPEEDS.includes(p.speed)) setSpeed(p.speed);
    if (p.mode) setMode(p.mode);
    if (ui.paused) setPaused(false);
    sync();
  }
  return { resize, apply };
}
