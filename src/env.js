import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, Filler } from "chart.js";
import { SURFACES } from "./textures.js";
import { createWorld, LIGHTS } from "./world.js";
import { detect } from "./features.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, Filler);

const T = window.THREE;
const VFOV = 86;                 // Justice D vertical view, degrees
const ASPECT = 16 / 9;
const TAN = Math.tan((VFOV / 2) * Math.PI / 180);
const RUNGS = [5, 10, 20, 30, 50, 75, 100, 120];
const ANALYSE_W = 1280, ANALYSE_H = 720; // the Justice D's 720p mode
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
const fmt = (m) => m < 0.1 ? `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm` : m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`;

export async function startSim() {
  const scenes = ambition.collection("scenes");
  const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const state = { surface: "deadgrass", light: "low", altitude: 20, patches: false, shadow: true, seed: 2111, mode: "cam", showFeat: true };
  let lastSweep = null;
  let last = null; // last analysis

  // ---------- controls ----------
  $("surface").replaceChildren(...Object.entries(SURFACES).map(([id, s]) => el("option", { value: id }, s.name)));
  $("light").replaceChildren(...Object.entries(LIGHTS).map(([id, s]) => el("option", { value: id }, s.name)));
  $("rungs").replaceChildren(...RUNGS.map((h) => el("button", { class: "ghost small", type: "button", "data-alt": h, onclick: () => { state.altitude = h; syncControls(); placeCamera(); } }, `${h} m`)));

  function syncControls() {
    $("surface").value = state.surface;
    $("light").value = state.light;
    $("alt").value = state.altitude;
    $("alt-out").textContent = `${state.altitude} m`;
    $("patches").checked = state.patches;
    $("shadow").checked = state.shadow;
    $("seed").value = state.seed;
    $("show-feat").checked = state.showFeat;
    for (const b of $("rungs").children) b.className = +b.dataset.alt === state.altitude ? "secondary small" : "ghost small";
    $("mode-cam").className = state.mode === "cam" ? "small" : "small secondary";
    $("mode-over").className = state.mode === "over" ? "small" : "small secondary";
  }

  // ---------- three.js world ----------
  const canvas = $("view");
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.LinearToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const world = createWorld(renderer);
  const { scene } = world;
  const heightAt = world.heightAt;
  const camera = new T.PerspectiveCamera(VFOV, ASPECT, 0.05, 2000);
  const over = new T.PerspectiveCamera(50, ASPECT, 0.5, 4000);
  let orbit = 0.7;

  // The Orqa M2-AI, roughly: 10 inch props on a ~45 cm wheelbase. Only its shadow is seen.
  const drone = new T.Group();
  const dark = new T.MeshStandardMaterial({ color: new T.Color(0.08, 0.08, 0.09) });
  drone.add(new T.Mesh(new T.BoxGeometry(0.16, 0.06, 0.1), dark));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, arm = new T.Mesh(new T.BoxGeometry(0.32, 0.02, 0.025), dark);
    arm.position.set(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16); arm.rotation.y = -a; drone.add(arm);
    const prop = new T.Mesh(new T.CylinderGeometry(0.127, 0.127, 0.004, 24), dark);
    prop.position.set(Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32); drone.add(prop);
  }
  drone.traverse((o) => { o.castShadow = true; });
  scene.add(drone);

  // Footprint of the camera on the ground, for the overview.
  const footMat = new T.LineBasicMaterial({ color: new T.Color(1, 0.75, 0.2) });
  const foot = new T.LineLoop(new T.BufferGeometry().setFromPoints([0, 1, 2, 3].map(() => new T.Vector3())), footMat);
  const ray = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), footMat);
  const marker = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshBasicMaterial({ color: new T.Color(1, 0.75, 0.2) }));
  scene.add(foot, ray, marker);

  let builtKey = "";
  async function rebuild() {
    const key = `${state.surface}|${state.seed}|${state.patches}`;
    if (key === builtKey) return;
    builtKey = key;
    $("building").hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    world.rebuild(state.surface, state.seed, state.patches);
    $("building").hidden = true;
  }

  function applyLight() {
    world.applyLight(state.light, state.shadow);
    exposure = 1;
  }

  function placeCamera() {
    const h = state.altitude, g = heightAt(0, 0);
    const top = g + h;
    drone.position.set(0, top + 0.04, 0);
    camera.position.set(0, top, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, g - 1, 0);
    camera.updateProjectionMatrix();

    world.aimSun(drone.position, h);

    // Overview helpers.
    const hw = h * TAN * ASPECT, hh = h * TAN;
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, z]) => new T.Vector3(x, heightAt(x, z) + 0.3, z));
    foot.geometry.setFromPoints(pts);
    ray.geometry.setFromPoints([new T.Vector3(0, top, 0), new T.Vector3(0, g, 0)]);
    marker.position.set(0, top, 0);
    marker.scale.setScalar(Math.max(0.4, h * 0.03));
    const dist = Math.max(30, h * 3.2);
    over.position.set(Math.sin(orbit) * dist, h + dist * 0.75, Math.cos(orbit) * dist);
    over.lookAt(0, h * 0.35, 0);
    syncControls();
    readouts();
    dirty = true;
    queueAnalyse();
  }

  let dirty = true;
  // Auto exposure like the camera's own: pull the frame toward mid grey, with a gain limit,
  // so a dark scene stays dark (and its low contrast shows up in the feature count).
  let exposure = 1;
  const MAX_GAIN = 6;
  function resize() {
    const box = $("viewport").getBoundingClientRect();
    const w = Math.max(320, Math.round(box.width)), h = Math.round(w / ASPECT);
    renderer.setSize(w, h, false);
    const ov = $("overlay"); ov.width = w; ov.height = h;
    drawOverlay();
    dirty = true;
  }
  new ResizeObserver(resize).observe($("viewport"));

  function frame() {
    if (dirty && !$("sim-view").hidden) {
      dirty = false;
      const showHelpers = state.mode === "over";
      foot.visible = ray.visible = marker.visible = showHelpers;
      renderer.setRenderTarget(null);
      renderer.toneMappingExposure = showHelpers ? Math.min(exposure, 2) : exposure;
      renderer.render(scene, showHelpers ? over : camera);
    }
    requestAnimationFrame(frame);
  }

  // ---------- analysis at 720p ----------
  const target = new T.WebGLRenderTarget(ANALYSE_W, ANALYSE_H, { colorSpace: T.SRGBColorSpace });
  target.texture.colorSpace = T.SRGBColorSpace;
  const pixels = new Uint8Array(ANALYSE_W * ANALYSE_H * 4);
  function grab() {
    renderer.toneMappingExposure = exposure;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, ANALYSE_W, ANALYSE_H, pixels);
    renderer.setRenderTarget(null);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    return sum / (pixels.length / 64) / 255;
  }
  function analyse() {
    foot.visible = ray.visible = marker.visible = false;
    let b = grab();
    for (let k = 0; k < 4 && Math.abs(b - 0.38) > 0.04; k++) {
      const next = Math.min(MAX_GAIN, Math.max(0.3, exposure * Math.pow(0.38 / Math.max(b, 0.005), 2.2)));
      if (Math.abs(next - exposure) < 0.01) break;
      exposure = next; b = grab();
    }
    const result = detect(pixels, ANALYSE_W, ANALYSE_H);
    result.brightness = b;
    dirty = true;
    return result;
  }
  let analyseTimer = 0;
  function queueAnalyse() {
    clearTimeout(analyseTimer);
    analyseTimer = setTimeout(() => { last = analyse(); readouts(); drawOverlay(); }, 250);
  }

  function drawOverlay() {
    const ov = $("overlay"), ctx = ov.getContext("2d");
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!last || !state.showFeat || state.mode !== "cam") return;
    const sx = ov.width / ANALYSE_W, sy = ov.height / ANALYSE_H;
    ctx.strokeStyle = ambition.color("accent-2");
    ctx.lineWidth = 1.5;
    const p = last.points;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i] * sx, y = (ANALYSE_H - 1 - p[i + 1]) * sy; // read back bottom up
      ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
    }
  }

  function card(label, value, sub) {
    return el("div", { class: "card stack tight readout" },
      el("span", { class: "eyebrow" }, label),
      el("span", { class: "type-heading-md" }, value),
      sub ? el("span", { class: "meta" }, sub) : null);
  }
  function readouts() {
    const h = state.altitude, vert = 2 * h * TAN, horiz = vert * ASPECT;
    const cov = last ? Math.round(last.coverage * 100) : null;
    const verdict = cov == null ? "" : cov >= 60 ? "Plenty to track" : cov >= 30 ? "Thin, VIO will strain" : "Starved, expect drift";
    $("readouts").replaceChildren(
      card("Ground per pixel", fmt(vert / 1080), `at 1080p · ${fmt(vert / 720)} at 720p`),
      card("In view", `${horiz.toFixed(0)} × ${vert.toFixed(0)} m`, `from ${h} m up`),
      card("Features", last ? last.features.toLocaleString() : "…", last ? `FAST corners at 720p` : ""),
      card("Frame covered", cov == null ? "…" : `${cov}%`, verdict));
  }

  // ---------- altitude sweep ----------
  let chart = null;
  async function sweep() {
    const btn = $("sweep");
    btn.disabled = true;
    const keep = state.altitude, rows = [];
    for (const h of RUNGS) {
      btn.textContent = `Measuring ${h} m…`;
      state.altitude = h; placeCamera(); clearTimeout(analyseTimer);
      await new Promise((r) => setTimeout(r, 20));
      const a = analyse();
      rows.push({ alt: h, features: a.features, coverage: Math.round(a.coverage * 1000) / 1000 });
    }
    state.altitude = keep; placeCamera();
    btn.disabled = false; btn.textContent = "Run altitude sweep";
    lastSweep = { rows, label: label() };
    drawSweep();
  }
  // The highest rung before coverage first drops under 30%: where VIO would start to struggle.
  function holdsTo(rows) {
    let ok = null;
    for (const r of rows) { if (r.coverage >= 0.3) ok = r.alt; else break; }
    return ok;
  }
  function thinnest(rows) { return rows.reduce((a, b) => (b.coverage < a.coverage ? b : a), rows[0]); }
  function label() { return `${SURFACES[state.surface].name}, ${LIGHTS[state.light].name.toLowerCase()}${state.patches ? ", patches" : ""}`; }
  function drawSweep() {
    const series = [];
    if (lastSweep) series.push({ name: `Now: ${lastSweep.label}`, rows: lastSweep.rows });
    for (const r of saved) if (r.value.sweep?.length && series.length < 6) series.push({ name: r.value.name, rows: r.value.sweep });
    $("sweep-box").hidden = !series.length;
    if (!series.length) return;
    const ok = lastSweep ? holdsTo(lastSweep.rows) : null;
    const thin = lastSweep ? thinnest(lastSweep.rows) : null;
    $("sweep-note").textContent = lastSweep ? `${ok ? `Well covered up to ${ok} m` : "Thin from 5 m"} · thinnest at ${thin.alt} m, ${Math.round(thin.coverage * 100)}%` : "";
    const tones = ["accent-1", "accent-2", "accent-3", "accent-4", "accent-5", "accent-6"];
    const data = {
      datasets: series.map((s, i) => ({
        label: s.name, data: s.rows.map((r) => ({ x: r.alt, y: Math.round(r.coverage * 100) })),
        borderColor: ambition.color(tones[i]), backgroundColor: ambition.color(tones[i]),
        borderWidth: i === 0 && lastSweep ? 3 : 2, tension: 0.25, pointRadius: 3
      }))
    };
    const grid = ambition.color("border-subtle"), text = ambition.color("text-secondary");
    if (chart) { chart.data = data; chart.update(); return; }
    chart = new Chart($("chart"), {
      type: "line", data,
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: "linear", min: 0, max: 125, title: { display: true, text: "Altitude, m", color: text }, ticks: { color: text }, grid: { color: grid } },
          y: { min: 0, max: 100, title: { display: true, text: "Frame covered by features, %", color: text }, ticks: { color: text }, grid: { color: grid } }
        },
        plugins: { legend: { labels: { color: text, boxWidth: 12 } } }
      }
    });
  }

  // ---------- saved scenarios ----------
  let saved = [];
  function sceneValue() {
    const v = { name: $("scene-name").value.trim() || label(), surface: state.surface, light: state.light, altitude: state.altitude, patches: state.patches, shadow: state.shadow, seed: state.seed };
    if (lastSweep && lastSweep.label === label()) v.sweep = lastSweep.rows;
    return v;
  }
  async function saveScene() {
    const flash = $("scene-flash");
    try {
      await scenes.add(sceneValue());
      $("scene-name").value = "";
      flash.textContent = "";
    } catch (e) { flash.textContent = e.message; }
  }
  function loadScene(v) {
    Object.assign(state, { surface: v.surface, light: v.light, altitude: v.altitude, patches: !!v.patches, shadow: v.shadow !== false, seed: v.seed });
    lastSweep = v.sweep ? { rows: v.sweep, label: label() } : null;
    refresh();
    drawSweep();
    $("viewport").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function renderScenes() {
    const list = $("scenes");
    if (!saved.length) {
      list.replaceChildren(el("li", { class: "empty" }, "No scenarios yet. Set up a world worth testing and save it, so the drone and camera stages can fly over the same ground."));
      return;
    }
    list.replaceChildren(...saved.slice().reverse().map((r) => {
      const v = r.value, ok = v.sweep ? holdsTo(v.sweep) : null;
      return el("li", { class: "card stack tight" },
        el("strong", {}, v.name),
        el("div", { class: "row chips" },
          el("span", { class: "chip" }, SURFACES[v.surface]?.name || v.surface),
          el("span", { class: "chip" }, LIGHTS[v.light]?.name || v.light),
          v.patches ? el("span", { class: "chip warning" }, "Low-texture patches") : null,
          v.sweep ? el("span", { class: "chip " + (ok >= 50 ? "success" : ok ? "accent" : "danger") }, ok ? `Covered to ${ok} m` : "Thin from 5 m") : null),
        el("span", { class: "meta" }, `${names[r.author_id] || "Someone"} · seed ${v.seed} · ${v.altitude} m`),
        el("div", { class: "row" },
          el("button", { class: "secondary small", type: "button", onclick: () => loadScene(v) }, "Load"),
          r.author_id === me.id ? el("button", { class: "ghost small", type: "button", onclick: () => scenes.remove(r.id).catch((e) => { $("scene-flash").textContent = e.message; }) }, "Remove") : null));
    }));
  }
  async function loadSaved() {
    saved = await scenes.list();
    renderScenes();
    drawSweep();
  }

  // ---------- wiring ----------
  async function refresh() {
    syncControls();
    applyLight();
    await rebuild();
    placeCamera();
  }
  $("surface").addEventListener("change", (e) => { state.surface = e.target.value; refresh(); });
  $("light").addEventListener("change", (e) => { state.light = e.target.value; refresh(); });
  $("alt").addEventListener("input", (e) => { state.altitude = +e.target.value; placeCamera(); });
  $("patches").addEventListener("change", (e) => { state.patches = e.target.checked; refresh(); });
  $("shadow").addEventListener("change", (e) => { state.shadow = e.target.checked; refresh(); });
  $("seed").addEventListener("change", (e) => { const s = Math.round(+e.target.value); if (s >= 1 && s <= 99999) { state.seed = s; refresh(); } else syncControls(); });
  $("reseed").addEventListener("click", () => { state.seed = 1 + Math.floor(Math.random() * 99999); refresh(); });
  $("show-feat").addEventListener("change", (e) => { state.showFeat = e.target.checked; drawOverlay(); });
  $("mode-cam").addEventListener("click", () => { state.mode = "cam"; syncControls(); drawOverlay(); dirty = true; });
  $("mode-over").addEventListener("click", () => { state.mode = "over"; syncControls(); drawOverlay(); dirty = true; });
  $("sweep").addEventListener("click", sweep);
  $("save-scene").addEventListener("click", saveScene);
  $("scene-name").addEventListener("keydown", (e) => { if (e.key === "Enter") saveScene(); });

  // Drag in the overview to walk around the drone.
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { if (state.mode === "over") { drag = e.clientX; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener("pointermove", (e) => { if (drag != null) { orbit -= (e.clientX - drag) * 0.01; drag = e.clientX; placeCamera(); } });
  canvas.addEventListener("pointerup", () => { drag = null; });

  scenes.subscribe(loadSaved);
  resize();
  await refresh();
  await loadSaved();
  requestAnimationFrame(frame);
  return { resize };
}
