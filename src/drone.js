// Stage 2: the drone. Flies the flight model over the shared world, measures what
// the nadir Justice D can track as it goes, and scores hold trials for the board.
import { createWorld, LIGHTS } from "./world.js";
import { SURFACES } from "./textures.js";
import { detect } from "./features.js";
import { createFlight, AIRFRAME, MOTORS, GNSS_MODES, VIO_TUNES, GUSTS } from "./flight.js";

const T = window.THREE;
const VFOV = 86, ASPECT = 16 / 9;
const AW = 1280, AH = 720;            // the Justice D's 720p mode, for feature counts
const TRIAL = 60;                      // seconds of a hold trial
const RUNGS = [5, 10, 20, 30, 50, 75, 100, 120];
const DEFAULT_WORLD = { name: "Dead grass, low November sun", surface: "deadgrass", light: "low", patches: false, shadow: true, seed: 2111 };

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
const compass = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const NAV_NAMES = { "gnss+vio": "GNSS and VIO", gnss: "GNSS", vio: "VIO only", imu: "IMU only, VIO lost", none: "Nothing" };

// ---------- the airframe, built from its published sizes ----------
export function buildDrone() {
  const g = new T.Group();
  const carbon = new T.MeshStandardMaterial({ color: new T.Color(0.05, 0.05, 0.055), roughness: 0.5, metalness: 0.2 });
  const metal = new T.MeshStandardMaterial({ color: new T.Color(0.18, 0.18, 0.2), roughness: 0.35, metalness: 0.8 });
  const orange = new T.MeshStandardMaterial({ color: new T.Color(0.95, 0.38, 0.05), roughness: 0.5 });
  const pack = new T.MeshStandardMaterial({ color: new T.Color(0.12, 0.2, 0.32), roughness: 0.7 });
  const board = new T.MeshStandardMaterial({ color: new T.Color(0.05, 0.25, 0.12), roughness: 0.6 });
  const prop = new T.MeshStandardMaterial({ color: new T.Color(0.08, 0.08, 0.08), roughness: 0.6 });
  const blur = new T.MeshBasicMaterial({ color: new T.Color(0.1, 0.1, 0.1), transparent: true, opacity: 0.18, depthWrite: false });
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  const cyl = (r, h, m, x = 0, y = 0, z = 0, seg = 20) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y, z); g.add(o); return o; };

  box(0.17, 0.004, 0.13, carbon, 0, 0.012);        // top plate
  box(0.17, 0.004, 0.13, carbon, 0, -0.018);       // bottom plate
  box(0.07, 0.026, 0.07, metal, 0, -0.003);        // flight controller and ESC stack
  box(0.062, 0.006, 0.045, board, 0, 0.02, 0.01);  // the APB
  box(0.14, 0.072, 0.075, pack, 0, -0.06);          // 6S4P Li-ion pack
  cyl(0.004, 0.06, carbon, 0, 0.045, 0.05, 8);      // GNSS mast
  cyl(0.032, 0.012, carbon, 0, 0.078, 0.05);        // GNSS puck
  box(0.022, 0.022, 0.022, metal, 0, -0.03, -0.075); // the nadir Justice D
  cyl(0.006, 0.01, orange, 0, -0.045, -0.075, 12);
  const props = [];
  MOTORS.forEach((m, i) => {
    const a = Math.atan2(m.z, m.x), r = Math.hypot(m.x, m.z);
    const arm = box(r, 0.012, 0.028, carbon, m.x / 2, 0, m.z / 2);
    arm.rotation.y = -a;
    const front = m.z < 0;
    cyl(0.0175, 0.022, front ? orange : metal, m.x, 0.017, m.z);    // 2814 motor bell
    cyl(0.003, 0.09, carbon, m.x * 0.85, -0.05, m.z * 0.85, 6);      // leg
    const hub = new T.Group(); hub.position.set(m.x, 0.032, m.z); g.add(hub);
    const blade = new T.Mesh(new T.BoxGeometry(0.254, 0.003, 0.022), prop); hub.add(blade);
    const disc = new T.Mesh(new T.CircleGeometry(0.127, 32), blur); disc.rotation.x = -Math.PI / 2; hub.add(disc);
    props.push({ hub, blade, disc, i });
  });
  g.traverse((o) => { if (o.isMesh && o.material !== blur) o.castShadow = true; });
  return { group: g, props };
}

export async function startDrone() {
  const flights = ambition.collection("flights");
  const scenes = ambition.collection("scenes");
  const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const ui = { cam: "chase", speed: 1, radius: 1, worldId: "default" };
  let worldDef = { ...DEFAULT_WORLD };
  let savedScenes = [];

  // ---------- renderer and world ----------
  const canvas = $("d-view");
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.toneMapping = T.LinearToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const world = createWorld(renderer);
  const { scene } = world;
  const sky = new T.Color();
  scene.background = sky;
  scene.fog = new T.Fog(sky, 180, 420);

  const model = buildDrone();
  scene.add(model.group);
  const nadir = new T.PerspectiveCamera(VFOV, ASPECT, 0.05, 2000);
  nadir.position.set(0, -0.05, -0.075);
  nadir.rotation.x = -Math.PI / 2; // looks straight down, forward at the top of the frame
  model.group.add(nadir);
  const chase = new T.PerspectiveCamera(55, ASPECT, 0.05, 3000);
  const judge = new T.PerspectiveCamera(40, ASPECT, 0.1, 3000);

  // The hold point, as the judges would paint it, and a ring at the pass radius.
  const ringMat = new T.MeshBasicMaterial({ color: new T.Color(1, 0.75, 0.2), transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false });
  const ring = new T.Mesh(new T.RingGeometry(0.94, 1, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const lineMat = new T.LineBasicMaterial({ color: new T.Color(1, 0.75, 0.2), transparent: true, opacity: 0.5 });
  const plumb = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), lineMat);
  scene.add(plumb);

  // ---------- flight ----------
  const settings = { altitude: 20, gnss: "full", vio: true, tune: "typical", wind: 4, windDir: 250, gust: "moderate", charge: 0.9 };
  let flight = createFlight({ ...settings, seed: 1 + Math.floor(Math.random() * 9999) });
  const H = (x, z) => world.heightAt(x, z);

  let track = [];       // samples {t, x, z, bx, bz, d}
  let trial = null;     // { start, max, sum, n, inside, lost, rejected, covSum, covN, done }
  let lastSample = -1;

  function resetFlight(keepTrial = false) {
    flight.setAltitude(settings.altitude);
    flight.reset(H);
    track = []; lastSample = -1;
    if (!keepTrial) trial = null;
    exposure = 1;
  }

  // ---------- controls ----------
  $("d-gnss").replaceChildren(...Object.entries(GNSS_MODES).map(([k, v]) => el("option", { value: k }, v)));
  $("d-tune").replaceChildren(...Object.entries(VIO_TUNES).map(([k, v]) => el("option", { value: k }, v.name)));
  $("d-gust").replaceChildren(...Object.entries(GUSTS).map(([k, v]) => el("option", { value: k }, v.name)));
  function syncControls() {
    $("d-alt").value = settings.altitude;
    $("d-alt-out").textContent = `${settings.altitude} m`;
    $("d-gnss").value = settings.gnss;
    $("d-vio").checked = settings.vio;
    $("d-tune").value = settings.tune;
    $("d-tune").disabled = !settings.vio;
    $("d-wind").value = settings.wind;
    $("d-wind-out").textContent = `${settings.wind} m/s from ${compass(settings.windDir)}`;
    $("d-gust").value = settings.gust;
    $("d-charge").value = String(settings.charge);
    $("d-radius").value = String(ui.radius);
    $("d-speed").value = String(ui.speed);
    for (const k of ["chase", "nadir", "judge"]) $(`d-cam-${k}`).className = ui.cam === k ? "small" : "small secondary";
    ring.scale.setScalar(ui.radius);
  }
  const apply = () => { Object.assign(flight.set, settings); flight.setAltitude(settings.altitude); syncControls(); };
  $("d-alt").addEventListener("input", (e) => { settings.altitude = +e.target.value; apply(); });
  $("d-gnss").addEventListener("change", (e) => { settings.gnss = e.target.value; apply(); note(`GNSS ${GNSS_MODES[settings.gnss].toLowerCase()}`); });
  $("d-vio").addEventListener("change", (e) => { settings.vio = e.target.checked; apply(); note(settings.vio ? "VIO on" : "VIO off"); });
  $("d-tune").addEventListener("change", (e) => { settings.tune = e.target.value; apply(); });
  $("d-wind").addEventListener("input", (e) => { settings.wind = +e.target.value; apply(); });
  $("d-gust").addEventListener("change", (e) => { settings.gust = e.target.value; apply(); });
  $("d-charge").addEventListener("change", (e) => { settings.charge = +e.target.value; apply(); });
  $("d-radius").addEventListener("change", (e) => { ui.radius = +e.target.value; syncControls(); drawPlots(); });
  $("d-speed").addEventListener("change", (e) => { ui.speed = +e.target.value; });
  for (const k of ["chase", "nadir", "judge"]) $(`d-cam-${k}`).addEventListener("click", () => { ui.cam = k; syncControls(); });
  $("d-kick").addEventListener("click", () => { flight.kick(); note("Kicked"); });
  $("d-reset").addEventListener("click", () => { resetFlight(); $("d-result").hidden = true; });
  $("d-trial").addEventListener("click", startTrial);
  $("d-ceiling").addEventListener("click", findCeiling);

  // Events during a trial (GNSS off, a kick), marked on the drift chart.
  let marks = [];
  function note(text) { if (trial && !trial.done) marks.push({ t: flight.s.t - trial.start, text }); }

  // ---------- worlds ----------
  function worldOptions() {
    const opts = [el("option", { value: "default" }, DEFAULT_WORLD.name)];
    for (const r of savedScenes.slice().reverse()) opts.push(el("option", { value: r.id }, r.value.name));
    $("d-world").replaceChildren(...opts);
    $("d-world").value = savedScenes.some((r) => r.id === ui.worldId) ? ui.worldId : "default";
  }
  async function loadWorld(id) {
    ui.worldId = id;
    const rec = savedScenes.find((r) => r.id === id);
    worldDef = rec ? { name: rec.value.name, surface: rec.value.surface, light: rec.value.light, patches: !!rec.value.patches, shadow: rec.value.shadow !== false, seed: rec.value.seed } : { ...DEFAULT_WORLD };
    $("d-building").hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    world.rebuild(worldDef.surface, worldDef.seed, worldDef.patches);
    const L = world.applyLight(worldDef.light, worldDef.shadow);
    // Sky behind the chase view, dimmed with the light preset.
    const k = Math.min(1, 0.15 + L.sky * 0.45 + L.sun * 0.12);
    sky.setRGB(0.62 * k, 0.7 * k, 0.8 * k);
    scene.fog.color.copy(sky);
    $("d-building").hidden = true;
    resetFlight();
    measure(true);
  }
  $("d-world").addEventListener("change", (e) => loadWorld(e.target.value));

  // ---------- what the nadir camera can track ----------
  const target = new T.WebGLRenderTarget(AW, AH, { colorSpace: T.SRGBColorSpace });
  target.texture.colorSpace = T.SRGBColorSpace;
  const pixels = new Uint8Array(AW * AH * 4);
  let exposure = 1;
  function grabNadir() {
    const showModel = model.group.visible, showRing = ring.visible;
    model.group.visible = false; ring.visible = false; plumb.visible = false;
    nadir.aspect = ASPECT; nadir.updateProjectionMatrix();
    renderer.toneMappingExposure = exposure;
    renderer.setRenderTarget(target);
    renderer.render(scene, nadir);
    renderer.readRenderTargetPixels(target, 0, 0, AW, AH, pixels);
    renderer.setRenderTarget(null);
    model.group.visible = showModel; ring.visible = showRing; plumb.visible = true;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    return sum / (pixels.length / 64) / 255;
  }
  function measure(settle) {
    poseModel();
    let b = grabNadir();
    for (let k = 0; k < (settle ? 4 : 1) && Math.abs(b - 0.38) > 0.04; k++) {
      exposure = Math.min(6, Math.max(0.3, exposure * Math.pow(0.38 / Math.max(b, 0.005), settle ? 2.2 : 1.2)));
      b = grabNadir();
    }
    const r = detect(pixels, AW, AH);
    flight.vio.coverage = r.coverage;
    return r.coverage;
  }

  // ---------- drawing ----------
  function poseModel() {
    const s = flight.s;
    model.group.position.set(s.p[0], s.p[1], s.p[2]);
    model.group.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    model.group.updateMatrixWorld(true);
    for (const p of model.props) {
      p.hub.rotation.y = s.spin[p.i] % (Math.PI * 2);
      const fast = s.rpm[p.i] > 1500;
      p.blade.visible = !fast; p.disc.visible = fast;
    }
  }
  function resize() {
    const box = $("d-viewport").getBoundingClientRect();
    const w = Math.max(320, Math.round(box.width)), h = Math.round(w / ASPECT);
    renderer.setSize(w, h, false);
    for (const id of ["d-track", "d-drift"]) {
      const c = $(id), b = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(200, Math.round(b.width * dpr)); c.height = Math.round(c.width * 0.62);
    }
    drawPlots();
  }
  new ResizeObserver(resize).observe($("d-viewport"));

  function render() {
    poseModel();
    const s = flight.s, g = world.heightAt(0, 0);
    ring.position.set(0, g + 0.06, 0);
    plumb.geometry.setFromPoints([new T.Vector3(s.p[0], s.p[1], s.p[2]), new T.Vector3(s.p[0], world.heightAt(s.p[0], s.p[2]) + 0.05, s.p[2])]);
    world.aimSun(model.group.position, s.p[1] - world.heightAt(s.p[0], s.p[2]));
    let cam = chase;
    model.group.visible = ui.cam !== "nadir";
    ring.visible = plumb.visible = ui.cam !== "nadir";
    if (ui.cam === "chase") {
      const back = new T.Vector3(0.9, 0.55, 2.2);
      const yawOnly = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.35);
      chase.position.copy(model.group.position).add(back.applyQuaternion(yawOnly));
      chase.lookAt(model.group.position.x, model.group.position.y - 0.25, model.group.position.z);
    } else if (ui.cam === "judge") {
      cam = judge;
      const d = Math.max(12, s.p[1] * 0.9);
      judge.position.set(d * 0.8, world.heightAt(d * 0.8, d * 0.6) + 1.7, d * 0.6);
      judge.lookAt(model.group.position);
      // Zoom in enough to see the airframe at any height.
      const dist = judge.position.distanceTo(model.group.position);
      judge.fov = Math.max(1.5, Math.min(40, 2 * Math.atan(3 / dist) * 180 / Math.PI));
      judge.updateProjectionMatrix();
    } else cam = nadir;
    renderer.toneMappingExposure = ui.cam === "nadir" ? exposure : Math.min(2, Math.max(1, exposure * 0.8));
    renderer.render(scene, cam);
  }

  const css = (k) => ambition.color(k);
  const FONT = () => getComputedStyle(document.body).fontFamily;
  function drawPlots() {
    drawTrack(); drawDrift();
  }
  function drawTrack() {
    const c = $("d-track"), ctx = c.getContext("2d"), W = c.width, Hh = c.height;
    ctx.clearRect(0, 0, W, Hh);
    let ext = ui.radius * 2;
    for (const p of track) ext = Math.max(ext, Math.abs(p.x) * 1.15, Math.abs(p.z) * 1.15, Math.abs(p.bx) * 1.15, Math.abs(p.bz) * 1.15);
    const sc = Math.min(W, Hh) / 2 / ext, cx = W / 2, cy = Hh / 2;
    const X = (x) => cx + x * sc, Y = (z) => cy + z * sc;
    // grid in metres
    const stepM = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((m) => m * sc > 28) || 500;
    ctx.strokeStyle = css("border-subtle"); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = -Math.ceil(ext / stepM) * stepM; m <= ext * 2; m += stepM) { ctx.moveTo(X(m), 0); ctx.lineTo(X(m), Hh); ctx.moveTo(0, Y(m)); ctx.lineTo(W, Y(m)); }
    ctx.stroke();
    ctx.strokeStyle = css("accent-5"); ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, ui.radius * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = css("text-tertiary");
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
    const line = (key, color, dash) => {
      if (track.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
      ctx.beginPath(); track.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p[key[0]]), Y(p[key[1]]))); ctx.stroke();
      ctx.setLineDash([]);
    };
    line(["bx", "bz"], css("accent-3"), [4, 3]);
    line(["x", "z"], css("accent-1"));
    const s = flight.s;
    ctx.fillStyle = css("accent-1");
    ctx.beginPath(); ctx.arc(X(s.p[0]), Y(s.p[2]), 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css("text-secondary"); ctx.font = `${12 * (W / c.getBoundingClientRect().width || 1)}px ${FONT()}`;
    ctx.fillText(`grid ${stepM < 1 ? stepM * 100 + " cm" : stepM + " m"} · north up`, 8, Hh - 8);
    $("d-track-note").textContent = `Pass circle ${ui.radius} m`;
  }
  function drawDrift() {
    const c = $("d-drift"), ctx = c.getContext("2d"), W = c.width, Hh = c.height;
    ctx.clearRect(0, 0, W, Hh);
    const pad = 28 * (W / (c.getBoundingClientRect().width || W) || 1);
    const t0 = trial ? trial.start : (track[0]?.t ?? 0);
    const span = trial ? TRIAL : 30;
    let top = ui.radius * 1.6;
    for (const p of track) top = Math.max(top, p.d * 1.1);
    const X = (t) => pad + (t - t0) / span * (W - pad - 8), Y = (d) => Hh - pad - d / top * (Hh - pad - 8);
    ctx.strokeStyle = css("border-subtle"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - 8, Y(0)); ctx.moveTo(pad, Y(0)); ctx.lineTo(pad, 8); ctx.stroke();
    ctx.strokeStyle = css("accent-5"); ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, Y(ui.radius)); ctx.lineTo(W - 8, Y(ui.radius)); ctx.stroke(); ctx.setLineDash([]);
    const fs = 11 * (W / (c.getBoundingClientRect().width || W) || 1);
    ctx.fillStyle = css("text-secondary"); ctx.font = `${fs}px ${FONT()}`;
    ctx.fillText(fmt(top), 2, 8 + fs); ctx.fillText("0", 2, Y(0));
    ctx.fillText(trial ? "60 s" : "last 30 s", W - 8 - fs * 4, Hh - 6);
    if (marks.length && trial) {
      ctx.strokeStyle = css("text-tertiary"); ctx.lineWidth = 1;
      for (const m of marks) { const x = X(t0 + m.t); ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, Y(0)); ctx.stroke(); ctx.fillText(m.text, x + 3, 8 + fs); }
    }
    if (track.length > 1) {
      ctx.strokeStyle = css("accent-1"); ctx.lineWidth = 2;
      ctx.beginPath(); track.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.t), Y(p.d))); ctx.stroke();
    }
    $("d-drift-note").textContent = trial ? (trial.done ? "Trial finished" : `Trial ${Math.floor(flight.s.t - trial.start)} s of ${TRIAL}`) : "Free flight";
  }

  function card(label, value, sub, tone) {
    return el("div", { class: "card stack tight readout" },
      el("span", { class: "eyebrow" }, label),
      el("span", { class: "type-heading-md" + (tone ? ` tone-${tone}` : "") }, value),
      sub ? el("span", { class: "meta" }, sub) : null);
  }
  function readouts() {
    const f = flight, s = f.s, d = f.drift();
    const navErr = Math.hypot(f.est.err[0], f.est.err[1]);
    const src = f.est.src;
    const vioSub = { tracking: "Tracking well", weak: "Thin, tracking strains", lost: "Lost, coasting on the IMU", off: "Switched off" }[f.vio.state];
    const wind = f.windAt(s.p[1] - s.ground), wsp = Math.hypot(wind[0], wind[2]);
    const hz = Math.round((f.imu.rpm || 0) / 60);
    $("d-readouts").replaceChildren(
      card("Drift from the mark", fmt(d), trial ? `worst ${fmt(trial.max)} this trial` : `${fmt(s.p[1] - s.ground)} up`, d > ui.radius ? "bad" : "good"),
      card("Navigating on", NAV_NAMES[src], src === "none" ? "Holding height only, the wind carries it" : f.gnss.rejected ? "GNSS thrown out: it disagrees with VIO" : settings.gnss === "denied" ? "GNSS denied" : "", src === "none" || src === "imu" ? "bad" : null),
      card("Thinks it is off by", fmt(navErr), "Gap between where it thinks it is and where it is"),
      card("Features in view", f.vio.coverage == null ? "…" : `${Math.round(f.vio.coverage * 100)}%`, settings.vio ? vioSub : "VIO is off; this is what it would see", f.vio.state === "lost" ? "bad" : null),
      card("Hover throttle", `${Math.round(f.hoverThrottle() * 100)}%`, `${f.voltage().toFixed(1)} V pack · ${AIRFRAME.mass} kg`),
      card("Props", `${Math.round((f.imu.rpm || 0) / 100) * 100} rpm`, `${hz} Hz shake, ${f.imu.vibRms.toFixed(1)} m/s² at the IMU`),
      card("Wind up here", `${wsp.toFixed(1)} m/s`, `from ${compass(settings.windDir)}, ${GUSTS[settings.gust].name.toLowerCase()}`));
  }

  // ---------- trials ----------
  function startTrial() {
    resetFlight();
    marks = [];
    trial = { start: flight.s.t, max: 0, sum: 0, n: 0, inside: 0, lost: 0, covSum: 0, covN: 0, done: false, settings: { ...settings }, world: { ...worldDef }, radius: ui.radius };
    $("d-result").hidden = true;
    $("d-trial").textContent = "Restart the trial";
  }
  function sample() {
    const f = flight, s = f.s, [bx, bz] = f.believed(), d = f.drift();
    if (trial && trial.done) return; // keep the finished trial on the charts until the next
    track.push({ t: s.t, x: s.p[0], z: s.p[2], bx, bz, d });
    if (!trial && track.length > 600) track.shift();
    if (trial && !trial.done) {
      trial.max = Math.max(trial.max, d); trial.sum += d; trial.n++;
      if (d <= trial.radius) trial.inside++;
      if (f.vio.state === "lost") trial.lost += 0.05;
      if (f.vio.coverage != null) { trial.covSum += f.vio.coverage; trial.covN++; }
      if (s.t - trial.start >= TRIAL) finishTrial();
    }
  }
  function trialRecord() {
    const t = trial, st = { ...settings, altitude: t.settings.altitude }, w = t.world;
    return {
      kind: "hold", world: w.name.slice(0, 80), surface: w.surface, light: w.light, seed: w.seed, patches: !!w.patches,
      altitude: st.altitude, gnss: st.gnss, vio: st.vio, tune: st.tune, wind: st.wind, gust: st.gust, charge: st.charge,
      radius: t.radius, duration: TRIAL,
      max_drift: +t.max.toFixed(3), mean_drift: +(t.sum / Math.max(1, t.n)).toFixed(3), inside: +(t.inside / Math.max(1, t.n)).toFixed(3),
      passed: t.max <= t.radius, vio_lost: +t.lost.toFixed(1), gnss_rejections: flight.gnss.rejections,
      coverage: t.covN ? +(t.covSum / t.covN).toFixed(3) : 0,
      events: marks.slice(0, 12).map((m) => `${Math.round(m.t)} s ${m.text}`)
    };
  }
  function finishTrial() {
    trial.done = true;
    $("d-trial").textContent = "Fly a 60 s hold trial";
    const rec = trialRecord();
    showResult(rec);
  }
  function showResult(rec) {
    const box = $("d-result");
    const pass = rec.passed;
    box.replaceChildren(el("div", { class: "card stack" },
      el("div", { class: "row between" },
        el("div", { class: "stack tight" },
          el("span", { class: "eyebrow" }, rec.kind === "ceiling" ? "Ceiling search" : "Hold trial"),
          el("h2", {}, rec.kind === "ceiling"
            ? (rec.altitude ? `Holds within ${rec.radius} m up to ${rec.altitude} m` : `No rung held within ${rec.radius} m`)
            : `${pass ? "Held" : "Drifted out"} at ${rec.altitude} m`)),
        el("span", { class: `chip ${pass ? "success" : "danger"}` }, pass ? "Pass" : "Fail")),
      rec.kind === "ceiling"
        ? el("div", { class: "row chips" }, ...rec.rungs.map((r) => el("span", { class: `chip ${r.passed ? "success" : "danger"}` }, `${r.alt} m · worst ${fmt(r.max_drift)} · ${Math.round(r.coverage * 100)}% features`)))
        : el("p", { class: "muted" }, `Worst drift ${fmt(rec.max_drift)}, average ${fmt(rec.mean_drift)}, inside the ${rec.radius} m circle ${Math.round(rec.inside * 100)}% of the time.` +
          (rec.vio_lost ? ` VIO was lost for ${rec.vio_lost} s.` : "") + (rec.gnss_rejections ? ` GNSS was thrown out ${rec.gnss_rejections} time${rec.gnss_rejections > 1 ? "s" : ""}.` : "")),
      el("p", { class: "meta" }, `${rec.world} · ${GNSS_MODES[rec.gnss]} · ${rec.vio ? VIO_TUNES[rec.tune]?.name : "No VIO"} · wind ${rec.wind} m/s`),
      el("div", { class: "row" },
        el("button", { type: "button", onclick: async (e) => {
          e.target.disabled = true;
          try { await flights.add(rec); e.target.textContent = "On the board"; }
          catch (err) { e.target.disabled = false; $("d-flash").textContent = err.message; }
        } }, "Put it on the board"),
        el("button", { class: "ghost", type: "button", onclick: () => { box.hidden = true; } }, "Dismiss"))));
    box.hidden = false;
  }

  // Fly each rung headless at full speed, three times, after measuring what the camera sees there.
  async function findCeiling() {
    const btn = $("d-ceiling");
    btn.disabled = true; $("d-trial").disabled = true;
    const keep = settings.altitude, rungs = [];
    try {
      for (const alt of RUNGS) {
        btn.textContent = `Flying ${alt} m…`;
        settings.altitude = alt; apply(); resetFlight();
        await new Promise((r) => setTimeout(r, 16));
        const cov = measure(true);
        let worst = 0;
        for (let k = 0; k < 3; k++) {
          const f = createFlight({ ...settings, seed: 100 + k * 17 + alt });
          f.setAltitude(alt); f.reset(H); f.vio.coverage = cov;
          const steps = TRIAL / f.DT;
          for (let i = 0; i < steps; i++) { f.step(H); if (i % 25 === 0) worst = Math.max(worst, f.drift()); }
          await new Promise((r) => setTimeout(r, 0));
        }
        rungs.push({ alt, max_drift: +worst.toFixed(3), coverage: +cov.toFixed(3), passed: worst <= ui.radius });
      }
    } finally {
      settings.altitude = keep; apply(); resetFlight();
      btn.disabled = false; $("d-trial").disabled = false; btn.textContent = "Find the ceiling";
    }
    let ceiling = 0;
    for (const r of rungs) { if (r.passed) ceiling = r.alt; else break; }
    showResult({
      kind: "ceiling", world: worldDef.name.slice(0, 80), surface: worldDef.surface, light: worldDef.light, seed: worldDef.seed, patches: !!worldDef.patches,
      altitude: ceiling, gnss: settings.gnss, vio: settings.vio, tune: settings.tune, wind: settings.wind, gust: settings.gust, charge: settings.charge,
      radius: ui.radius, duration: TRIAL, passed: ceiling > 0, rungs,
      max_drift: rungs.find((r) => r.alt === ceiling)?.max_drift ?? rungs[0].max_drift
    });
    $("d-result").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- board ----------
  let board = [];
  function renderBoard() {
    const list = $("d-board");
    if (!board.length) {
      list.replaceChildren(el("li", { class: "empty" }, "No holds on the board yet. Fly a trial or find the ceiling, then put the result here so everyone can compare setups."));
      return;
    }
    const sorted = board.slice().sort((a, b) => (b.value.passed - a.value.passed) || (b.value.altitude - a.value.altitude) || (a.value.max_drift - b.value.max_drift));
    list.replaceChildren(...sorted.map((r, i) => {
      const v = r.value;
      return el("li", { class: "card row between board-row" + (i === 0 && v.passed ? " selected" : "") },
        el("div", { class: "stack tight" },
          el("div", { class: "row tight-row" },
            el("strong", {}, v.kind === "ceiling" ? `Ceiling ${v.altitude} m` : `${v.altitude} m hold`),
            el("span", { class: `chip ${v.passed ? "success" : "danger"}` }, v.passed ? "Pass" : "Fail"),
            el("span", { class: "chip" }, v.vio ? VIO_TUNES[v.tune]?.name || "VIO" : "No VIO"),
            el("span", { class: "chip" }, GNSS_MODES[v.gnss])),
          el("span", { class: "meta" }, `Worst ${fmt(v.max_drift)} in a ${v.radius} m circle · ${v.world} · ${LIGHTS[v.light]?.name || v.light} · wind ${v.wind} m/s · ${names[r.author_id] || "Someone"}`)),
        el("div", { class: "row tight-row" },
          el("button", { class: "secondary small", type: "button", onclick: () => flyAgain(v) }, "Fly this setup"),
          r.author_id === me.id ? el("button", { class: "ghost small", type: "button", "aria-label": "Remove from the board", onclick: () => flights.remove(r.id).catch((e) => { $("d-flash").textContent = e.message; }) }, "Remove") : null));
    }));
  }
  async function flyAgain(v) {
    Object.assign(settings, { altitude: v.altitude || settings.altitude, gnss: v.gnss, vio: v.vio, tune: v.tune || "typical", wind: v.wind, gust: v.gust, charge: v.charge ?? settings.charge });
    ui.radius = v.radius;
    const match = savedScenes.find((r) => r.value.seed === v.seed && r.value.surface === v.surface && r.value.light === v.light);
    apply();
    await loadWorld(match ? match.id : "default");
    worldOptions();
    $("d-viewport").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function loadBoard() { board = await flights.list(); renderBoard(); }
  async function loadScenes() { savedScenes = await scenes.list(); worldOptions(); }

  // ---------- loop ----------
  let lastWall = performance.now(), lastMeasure = 0, lastUi = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const wall = Math.min(0.05, (now - lastWall) / 1000);
    lastWall = now;
    if ($("drone-view").hidden || $("d-ceiling").disabled) return;
    const steps = Math.round(wall * ui.speed / flight.DT);
    for (let i = 0; i < steps; i++) {
      flight.step(H);
      if (flight.s.t - lastSample >= 0.05) { lastSample = flight.s.t; sample(); }
    }
    if (now - lastMeasure > 700) { lastMeasure = now; measure(false); }
    render();
    if (now - lastUi > 200) {
      lastUi = now;
      readouts(); drawPlots();
      const left = trial && !trial.done ? Math.max(0, TRIAL - (flight.s.t - trial.start)) : null;
      $("d-clock").textContent = left != null ? `${Math.ceil(left)} s left` : "";
      $("d-clock").hidden = left == null;
    }
  }

  flights.subscribe(loadBoard);
  scenes.subscribe(loadScenes);
  syncControls();
  await loadScenes();
  resize();
  await loadWorld("default");
  await loadBoard();
  requestAnimationFrame(frame);
  return { resize };
}
