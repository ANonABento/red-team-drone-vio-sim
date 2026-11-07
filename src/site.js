// A real test site: the City of Ottawa's 2022 orthophoto of the Central Experimental
// Farm draped over open elevation data, flown with the Justice D's nadir view, and a
// benchmark that holds 60 s at 10, 30, 60 and 100 m here and over a textured world.
import { createWorld } from "./world.js";
import { detect } from "./features.js";
import { createFlight } from "./flight.js";

const T = window.THREE;
const VFOV = 86, ASPECT = 16 / 9, TAN = Math.tan((VFOV / 2) * Math.PI / 180);
const AW = 1280, AH = 720;
const BENCH_ALTS = [10, 30, 60, 100];
const TRIAL = 60, RADIUS = 1;
const DEFAULT_WORLD = { name: "Dead grass, low November sun", surface: "deadgrass", light: "low", patches: false, shadow: true, seed: 2111 };

// Each real site is one zoom-16 web-mercator tile: a 2048 photo of all of it, and (where the
// source is sharp enough) a 2048 photo of its middle half, draped on a zoom-15 Terrarium tile.
function tileGeo(x, y) {
  const lat = Math.atan(Math.sinh(Math.PI - (2 * Math.PI * (y + 0.5)) / 65536));
  return { lat: lat * 180 / Math.PI, lon: ((x + 0.5) / 65536) * 360 - 180, size: (40075016.686 * Math.cos(lat)) / 65536 };
}
const realSite = (id, x, y, rest) => ({ id, ...tileGeo(x, y), dem: [(x % 2) * 127, (y % 2) * 127], ...rest });
export const SITES = {
  farm: realSite("farm", 18984, 23475, {
    name: "Central Experimental Farm, Ottawa", short: "Ottawa farm", prefix: "o", demFile: "dem15.png", detail: false,
    kind: "Tilled fields and grass", gsd: "20 cm",
    note: "City of Ottawa aerial imagery 2022 over real ground height, 20 cm per pixel, Open Government Licence (Ottawa). Below about 75 m it looks smoother than the real field."
  }),
  delft: realSite("delft", 33561, 21644, {
    name: "Old town, Delft", short: "Delft old town", prefix: "dl", demFile: "dl_dem.png", detail: true,
    kind: "Dense rooftops, canals and narrow streets", gsd: "9 cm",
    note: "PDOK Luchtfoto Actueel HR, the Dutch national aerial photo at about 8 cm, CC BY 4.0 (Beeldmateriaal Nederland). Sharpest over the middle 200 m, 20 cm beyond."
  }),
  dubendorf: realSite("dubendorf", 34340, 22943, {
    name: "Dübendorf airfield, Zürich", short: "Dübendorf airfield", prefix: "db", demFile: "db_dem.png", detail: true,
    kind: "Runway, taxiway and mown grass", gsd: "10 cm",
    note: "swisstopo SWISSIMAGE 10 cm over real ground height, free to use with credit (Federal Office of Topography swisstopo). Sharpest over the middle 200 m, 20 cm beyond."
  }),
  andermatt: realSite("andermatt", 34333, 23148, {
    name: "Alpine slope above Andermatt", short: "Andermatt slope", prefix: "an", demFile: "an_dem.png", detail: true,
    kind: "Steep meadow, spruce forest and village edge", gsd: "10 cm",
    note: "swisstopo SWISSIMAGE 10 cm over real mountain terrain, free to use with credit (Federal Office of Topography swisstopo). The ground climbs steeply, so the drone's height above it keeps changing as it drifts."
  })
};
export const SITE = SITES.farm;
const SIZE = SITE.size;

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
const pct = (c) => `${Math.round(c * 100)}%`;

function loadImage(name) {
  const url = ambition.asset(name);
  const tryLoad = (cors) => new Promise((ok, bad) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = bad;
    img.src = url;
  });
  return tryLoad(true).catch(() => tryLoad(false));
}

// Orthophoto: one 2048 image of the whole site, about 20 cm a pixel.
export async function buildPhoto(site = SITE) {
  const img = await loadImage(`${site.prefix}_base.jpg`);
  const c = document.createElement("canvas");
  c.width = c.height = 2048;
  c.getContext("2d").drawImage(img, 0, 0, 2048, 2048);
  return c;
}

// The sharp middle: one 2048 image of the middle half of the site, about 10 cm a pixel.
export async function buildDetail(site) {
  if (!site.detail) return null;
  return loadImage(`${site.prefix}_mid.jpg`);
}

// Elevation: the zoom-15 Terrarium tile holding the site; the site is its lower-left quarter.
export async function buildHeights(site = SITE) {
  const N = 129, SIZE = site.size;
  const grid = new Float32Array(N * N);
  try {
    const img = await loadImage(site.demFile);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(site.dem[0], site.dem[1], 129, 129).data;
    for (let i = 0; i < N * N; i++) grid[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  } catch { /* flat if the elevation will not read */ }
  const mid = grid[64 * N + 64];
  for (let i = 0; i < grid.length; i++) grid[i] -= mid;
  let lo = Infinity, hi = -Infinity;
  for (const v of grid) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const at = (x, z) => {
    const u = Math.min(N - 1.001, Math.max(0, (x / SIZE + 0.5) * (N - 1)));
    const v = Math.min(N - 1.001, Math.max(0, (z / SIZE + 0.5) * (N - 1)));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], e = grid[(j + 1) * N + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + e * fu) * fv;
  };
  return { at, relief: hi - lo, lo, hi };
}

export async function startSite() {
  const benches = ambition.collection("benchmarks");
  const scenes = ambition.collection("scenes");
  const state = { altitude: 30, mode: "cam", feat: true, fieldId: "default" };
  let savedScenes = [];
  let last = null;

  const canvas = $("s-view");
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.toneMapping = T.LinearToneMapping;

  // ---------- the real site ----------
  const scene = new T.Scene();
  const sky = new T.Color(0.7, 0.76, 0.84);
  scene.background = sky;
  scene.fog = new T.Fog(sky, 500, 1400);
  const groundGeo = new T.PlaneGeometry(SIZE, SIZE, 128, 128);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const ground = new T.Mesh(groundGeo, groundMat);
  scene.add(ground);
  // A plain skirt so the overview does not end at a cliff.
  const skirt = new T.Mesh(new T.PlaneGeometry(SIZE * 6, SIZE * 6).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: new T.Color(0.36, 0.38, 0.3) }));
  skirt.position.y = -3;
  scene.add(skirt);

  const cam = new T.PerspectiveCamera(VFOV, ASPECT, 0.1, 3000);
  cam.rotation.x = -Math.PI / 2;
  const over = new T.PerspectiveCamera(45, ASPECT, 1, 5000);
  const markMat = new T.LineBasicMaterial({ color: new T.Color(1, 0.75, 0.2) });
  const footprint = new T.LineLoop(new T.BufferGeometry().setFromPoints([0, 1, 2, 3].map(() => new T.Vector3())), markMat);
  const plumb = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), markMat);
  scene.add(footprint, plumb);

  let heights = { at: () => 0, relief: 0 };
  $("s-building").hidden = false;
  try {
    const [photo, h] = await Promise.all([buildPhoto(), buildHeights()]);
    heights = h;
    const tex = new T.CanvasTexture(photo);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = T.LinearMipmapLinearFilter;
    groundMat.map = tex;
    groundMat.needsUpdate = true;
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights.at(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    groundGeo.computeBoundingSphere();
    $("s-building").hidden = true;
  } catch {
    $("s-building").textContent = "The aerial photo would not load. Reopen this page to try again.";
  }

  // ---------- the textured world, for comparison ----------
  const field = createWorld(renderer);
  field.scene.background = sky;
  let fieldDef = { ...DEFAULT_WORLD };
  let fieldBuilt = "";
  const fieldCam = new T.PerspectiveCamera(VFOV, ASPECT, 0.1, 3000);
  fieldCam.rotation.x = -Math.PI / 2;
  field.scene.add(fieldCam);
  function prepareField() {
    const key = JSON.stringify(fieldDef);
    if (key === fieldBuilt) return;
    fieldBuilt = key;
    field.rebuild(fieldDef.surface, fieldDef.seed, fieldDef.patches);
    field.applyLight(fieldDef.light, false);
  }

  // ---------- what the camera tracks ----------
  const target = new T.WebGLRenderTarget(AW, AH, { colorSpace: T.SRGBColorSpace });
  target.texture.colorSpace = T.SRGBColorSpace;
  const pixels = new Uint8Array(AW * AH * 4);
  let exposure = 1;
  function grab(sc, camera) {
    renderer.toneMappingExposure = exposure;
    renderer.setRenderTarget(target);
    renderer.render(sc, camera);
    renderer.readRenderTargetPixels(target, 0, 0, AW, AH, pixels);
    renderer.setRenderTarget(null);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    return sum / (pixels.length / 64) / 255;
  }
  // Auto exposure, the way the camera would settle, then FAST corners on the frame.
  function measureWith(sc, camera, own) {
    exposure = 1;
    const fp = footprint.visible, pl = plumb.visible;
    footprint.visible = plumb.visible = false;
    let b = grab(sc, camera);
    for (let k = 0; k < 4 && Math.abs(b - 0.38) > 0.04; k++) {
      exposure = Math.min(6, Math.max(0.3, exposure * Math.pow(0.38 / Math.max(b, 0.005), 2.2)));
      b = grab(sc, camera);
    }
    footprint.visible = fp; plumb.visible = pl;
    const r = detect(pixels, AW, AH);
    if (own) exposure = own;
    return r;
  }
  function placeCam(h) {
    cam.position.set(0, heights.at(0, 0) + h, 0);
    cam.updateMatrixWorld(true);
  }

  // ---------- drawing ----------
  const overlay = $("s-overlay");
  function resize() {
    const box = $("s-viewport");
    const w = box.clientWidth, h = box.clientHeight;
    if (!w) return;
    renderer.setSize(w, h, false);
    overlay.width = Math.round(w * (window.devicePixelRatio || 1));
    overlay.height = Math.round(h * (window.devicePixelRatio || 1));
    draw();
  }
  function setFootprint() {
    const h = state.altitude, gz = heights.at(0, 0);
    const vy = h * TAN, vx = vy * ASPECT, y = gz + 0.4;
    footprint.geometry.setFromPoints([new T.Vector3(-vx, y, -vy), new T.Vector3(vx, y, -vy), new T.Vector3(vx, y, vy), new T.Vector3(-vx, y, vy)]);
    plumb.geometry.setFromPoints([new T.Vector3(0, gz, 0), new T.Vector3(0, gz + h, 0)]);
  }
  function draw() {
    placeCam(state.altitude);
    setFootprint();
    const g = overlay.getContext("2d");
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (state.mode === "cam") {
      footprint.visible = plumb.visible = false;
      renderer.toneMappingExposure = exposure;
      renderer.render(scene, cam);
      if (state.feat && last) {
        const sx = overlay.width / AW, sy = overlay.height / AH;
        g.fillStyle = ambition.color("accent-2") || "currentColor";
        const p = last.points;
        for (let i = 0; i < p.length; i += 2) g.fillRect(p[i] * sx - 2, (AH - p[i + 1]) * sy - 2, 4, 4);
      }
    } else {
      footprint.visible = plumb.visible = true;
      const h = state.altitude, d = Math.max(260, h * 3.2);
      over.position.set(d * 0.55, heights.at(0, 0) + h * 0.6 + d * 0.75, d * 0.95);
      over.lookAt(0, heights.at(0, 0) + h * 0.3, 0);
      renderer.toneMappingExposure = 1;
      renderer.render(scene, over);
    }
  }

  function card(label, value, sub, tone) {
    return el("div", { class: "card stack tight readout" },
      el("span", { class: "eyebrow" }, label),
      el("span", { class: `type-heading-md${tone ? ` tone-${tone}` : ""}` }, value),
      sub ? el("span", { class: "meta" }, sub) : null);
  }
  function readouts() {
    const h = state.altitude, vert = 2 * h * TAN, horiz = vert * ASPECT, gsd = vert / AH;
    const soft = gsd < 0.2;
    $("s-readouts").replaceChildren(
      card("Ground per pixel", fmt(gsd), soft ? "finer than the photo's 20 cm, so the ground looks softer than real" : "at 720p; the photo has 20 cm", soft ? "bad" : null),
      card("In view", `${horiz.toFixed(0)} × ${vert.toFixed(0)} m`, `from ${h} m up`),
      card("Features found", last ? String(last.features) : "…", "FAST corners, 720p"),
      card("Grid coverage", last ? pct(last.coverage) : "…", last && last.coverage < 0.12 ? "too few for VIO to keep tracking" : "cells with enough corners to track", last && last.coverage < 0.12 ? "bad" : null)
    );
  }
  function refresh() {
    placeCam(state.altitude);
    const keep = exposure;
    last = measureWith(scene, cam);
    exposure = exposure || keep;
    readouts();
    draw();
  }

  // ---------- controls ----------
  const rungs = $("s-rungs");
  rungs.replaceChildren(...BENCH_ALTS.map((a) => el("button", { class: "small secondary", type: "button", "data-alt": a, onclick: () => setAlt(a) }, `${a} m`)));
  function syncControls() {
    $("s-alt").value = state.altitude;
    $("s-alt-out").textContent = `${state.altitude} m`;
    for (const b of rungs.children) b.className = +b.dataset.alt === state.altitude ? "small" : "small secondary";
    $("s-mode-cam").className = state.mode === "cam" ? "small" : "small secondary";
    $("s-mode-over").className = state.mode === "over" ? "small" : "small secondary";
  }
  let pending = 0;
  function setAlt(a) {
    state.altitude = a;
    syncControls();
    draw();
    clearTimeout(pending);
    pending = setTimeout(refresh, 120);
  }
  $("s-alt").addEventListener("input", (e) => setAlt(+e.target.value));
  $("s-mode-cam").addEventListener("click", () => { state.mode = "cam"; syncControls(); draw(); });
  $("s-mode-over").addEventListener("click", () => { state.mode = "over"; syncControls(); draw(); });
  $("s-feat").addEventListener("change", (e) => { state.feat = e.target.checked; draw(); });
  $("s-relief").textContent = heights.relief > 0 ? `Height varies by ${heights.relief.toFixed(1)} m across the site.` : "";

  // ---------- comparison world ----------
  function fieldOptions() {
    const sel = $("s-field");
    const opts = [el("option", { value: "default" }, `${DEFAULT_WORLD.name} (textured field)`)];
    for (const r of savedScenes.slice().reverse()) opts.push(el("option", { value: r.id }, r.value.name));
    sel.replaceChildren(...opts);
    sel.value = savedScenes.some((r) => r.id === state.fieldId) ? state.fieldId : "default";
  }
  $("s-field").addEventListener("change", (e) => { state.fieldId = e.target.value; });
  function chosenField() {
    const rec = savedScenes.find((r) => r.id === state.fieldId);
    return rec ? { name: rec.value.name, surface: rec.value.surface, light: rec.value.light, patches: !!rec.value.patches, shadow: false, seed: rec.value.seed } : { ...DEFAULT_WORLD };
  }

  // ---------- benchmark ----------
  async function flyHold(alt, coverage, heightAt) {
    let worst = 0, sum = 0, n = 0;
    for (let k = 0; k < 3; k++) {
      const f = createFlight({ altitude: alt, gnss: "denied", vio: true, tune: "typical", wind: 4, windDir: 250, gust: "moderate", charge: 0.9, seed: 100 + k * 17 + alt });
      f.setAltitude(alt); f.reset(heightAt); f.vio.coverage = coverage;
      const steps = TRIAL / f.DT;
      for (let i = 0; i < steps; i++) {
        f.step(heightAt);
        if (i % 25 === 0) { const d = f.drift(); worst = Math.max(worst, d); sum += d; n++; }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    return { worst: +worst.toFixed(3), mean: +(sum / Math.max(1, n)).toFixed(3) };
  }

  let shown = null;
  async function runBench() {
    const btn = $("s-bench");
    btn.disabled = true;
    $("s-bench-flash").textContent = "";
    fieldDef = chosenField();
    const keepAlt = state.altitude;
    const rows = [];
    try {
      prepareField();
      for (const alt of BENCH_ALTS) {
        btn.textContent = `Flying ${alt} m…`;
        await new Promise((r) => setTimeout(r, 16));
        placeCam(alt);
        const a = measureWith(scene, cam);
        fieldCam.position.set(0, field.heightAt(0, 0) + alt, 0);
        fieldCam.updateMatrixWorld(true);
        const b = measureWith(field.scene, fieldCam);
        const ha = await flyHold(alt, a.coverage, (x, z) => heights.at(x, z));
        const hb = await flyHold(alt, b.coverage, (x, z) => field.heightAt(x, z));
        rows.push({
          alt,
          site_features: a.features, site_coverage: +a.coverage.toFixed(3), site_drift: ha.worst, site_mean: ha.mean,
          field_features: b.features, field_coverage: +b.coverage.toFixed(3), field_drift: hb.worst, field_mean: hb.mean
        });
        shown = { site: SITE.name, world: fieldDef.name.slice(0, 80), rows: rows.slice(), radius: RADIUS, duration: TRIAL, fresh: true };
        renderBench();
      }
    } finally {
      btn.disabled = false; btn.textContent = "Run the benchmark";
      state.altitude = keepAlt;
      refresh();
    }
    $("s-bench-save").hidden = false;
  }
  $("s-bench").addEventListener("click", runBench);
  $("s-bench-save").addEventListener("click", async () => {
    if (!shown) return;
    const btn = $("s-bench-save");
    btn.disabled = true;
    try {
      const { fresh, ...value } = shown;
      await benches.add(value);
      shown = { ...value, fresh: false };
      btn.hidden = true;
      $("s-bench-flash").textContent = "On the shared list below.";
    } catch (e) {
      $("s-bench-flash").textContent = e.message || "That did not save. Try again in a moment.";
    } finally { btn.disabled = false; }
  });

  function cell(cov, feats) {
    return el("td", {}, el("div", { class: "stack tight" },
      el("span", {}, `${feats} features · ${pct(cov)}`),
      el("progress", { max: 1, value: cov, "aria-label": `Coverage ${pct(cov)}` })));
  }
  function driftCell(d) {
    return el("td", {}, el("span", { class: `chip ${d <= RADIUS ? "success" : "danger"}` }, fmt(d)));
  }
  function benchTable(b) {
    const ceiling = (k) => { let c = 0; for (const r of b.rows) { if (r[k] <= (b.radius || RADIUS)) c = r.alt; else break; } return c; };
    const cs = ceiling("site_drift"), cf = ceiling("field_drift");
    return el("div", { class: "stack" },
      el("div", { class: "row chips" },
        el("span", { class: `chip ${cs ? "accent" : "danger"}` }, `Ottawa farm holds to ${cs ? `${cs} m` : "none"}`),
        el("span", { class: `chip ${cf ? "accent" : "danger"}` }, `${b.world} holds to ${cf ? `${cf} m` : "none"}`)),
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Altitude"), el("th", {}, "Farm: what VIO sees"), el("th", {}, "Farm: worst drift"),
          el("th", {}, "Textured: what VIO sees"), el("th", {}, "Textured: worst drift"))),
        el("tbody", {}, ...b.rows.map((r) => el("tr", {},
          el("td", {}, el("div", { class: "stack tight" }, el("span", {}, `${r.alt} m`),
            (2 * r.alt * TAN) / AH < 0.2 ? el("span", { class: "meta" }, "photo softer than real") : null)),
          cell(r.site_coverage, r.site_features), driftCell(r.site_drift),
          cell(r.field_coverage, r.field_features), driftCell(r.field_drift))))),
      el("p", { class: "meta" }, "Below about 75 m the Justice D sees finer than the photo's 20 cm pixels, so the farm looks smoother than it would for real and its low-altitude counts are a floor. The bare tilled field under the hold point is also a genuinely hard, low-texture surface."));
  }
  function renderBench() {
    const box = $("s-bench-out");
    if (!shown) { box.replaceChildren(el("p", { class: "empty" }, "Run the benchmark to fly both grounds at 10, 30, 60 and 100 m.")); return; }
    box.replaceChildren(benchTable(shown));
  }

  // ---------- shared runs ----------
  let people = [];
  try { people = await ambition.members(); } catch { people = []; }
  const nameOf = (id) => people.find((p) => p.id === id)?.name || "Someone";
  async function loadBenches() {
    let list = [];
    try { list = await benches.query({ order: [{ field: "updated_at", desc: true }], limit: 12 }); }
    catch { try { list = (await benches.list()).reverse().slice(0, 12); } catch { list = []; } }
    const ul = $("s-runs");
    if (!list.length) { ul.replaceChildren(el("li", { class: "empty" }, "No benchmark runs shared yet. Run one and put it here so the group can compare grounds.")); return; }
    ul.replaceChildren(...list.map((r) => {
      const when = new Date(r.updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return el("li", { class: "card stack tight" },
        el("div", { class: "row between" },
          el("strong", {}, `Ottawa farm vs ${r.value.world}`),
          el("span", { class: "meta" }, `${nameOf(r.author_id)} · ${when}`)),
        el("button", { class: "ghost small", type: "button", onclick: () => { shown = { ...r.value, fresh: false }; $("s-bench-save").hidden = true; renderBench(); $("s-bench-box").scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Show this run"));
    }));
  }
  benches.subscribe(loadBenches);
  scenes.subscribe(async () => { savedScenes = await scenes.list(); fieldOptions(); });
  try { savedScenes = await scenes.list(); } catch { savedScenes = []; }
  fieldOptions();
  loadBenches();
  renderBench();

  window.addEventListener("resize", () => { if (!$("site-view").hidden) resize(); });
  syncControls();
  resize();
  refresh();
  return { resize };
}
