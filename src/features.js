// FAST-9 corners on a grey frame, bucketed into a grid the way VIO front ends spread
// their tracks. Coverage is the share of cells with enough corners to track.
//
// The tracker's knobs (the Ottawa test tunes these):
//   threshold   brightness step a corner's arc must clear, in grey levels
//   minDist     closest two kept corners may sit, in full-frame pixels
//   maxFeatures budget for the whole frame, spread evenly over the grid cells
//   levels      pyramid levels: 1 is the full frame only, each extra level halves it,
//               which averages away noise and turns broad texture into corners
//   contrast    local contrast boost: 1 leaves the frame alone, 2 doubles fine detail
//               (and the sensor noise with it)
// A corner only counts as trackable if its arc also clears about three times the frame's
// own noise, so a threshold set below the noise finds speckle, which is reported apart.
const CIRCLE = [[0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3], [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3]];
export const CELL = 40, CAP = 6, MIN_IN_CELL = 3;
export const TRACKER_DEFAULT = { threshold: 12, minDist: 3, maxFeatures: 3456, levels: 1, contrast: 1 };
const NOISE_K = 3;

function grey(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) / 256;
  return g;
}

// Unsharp mask with a 15 px box, through an integral image.
function boost(g, w, h, amount) {
  if (amount <= 1.001) return g;
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  const r = 7, out = new Float32Array(w * h), k = amount - 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const m = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
      const v = g[y * w + x];
      out[y * w + x] = Math.max(0, Math.min(255, v + (v - m) * k));
    }
  }
  return out;
}

function half(g, w, h) {
  const hw = w >> 1, hh = h >> 1, o = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const p = 2 * y * w + 2 * x;
    o[y * hw + x] = (g[p] + g[p + 1] + g[p + w] + g[p + w + 1]) / 4;
  }
  return { g: o, w: hw, h: hh };
}

// Sensor noise from the median absolute second difference, which flat texture barely moves.
function noiseOf(g, w, h) {
  const vals = [];
  for (let y = 2; y < h - 2; y += 7) for (let x = 2; x < w - 2; x += 5) {
    const p = y * w + x;
    vals.push(Math.abs(2 * g[p] - g[p - 1] - g[p + 1]));
  }
  vals.sort((a, b) => a - b);
  return (vals[vals.length >> 1] || 0) * 1.4826 / Math.sqrt(6);
}

function arc(g, p, off, t, bright) {
  const v = g[p], hi = v + t, lo = v - t;
  const a = g[p + off[0]], b = g[p + off[4]], c = g[p + off[8]], d = g[p + off[12]];
  const up = (a > hi) + (b > hi) + (c > hi) + (d > hi), dn = (a < lo) + (b < lo) + (c < lo) + (d < lo);
  if (up < 2 && dn < 2) return false;
  for (let k = 0; k < 16; k++) { const q = g[p + off[k]]; bright[k] = bright[k + 16] = q > hi ? 1 : q < lo ? 2 : 0; }
  let run = 0, best = 0, prev = 0;
  for (let k = 0; k < 32; k++) {
    const s = bright[k];
    run = s && s === prev ? run + 1 : s ? 1 : 0; prev = s;
    if (run > best) best = run;
  }
  return best >= 9;
}

export function detect(rgba, w, h, opts = {}) {
  const o = typeof opts === "number" ? { ...TRACKER_DEFAULT, threshold: opts } : { ...TRACKER_DEFAULT, ...opts };
  const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
  const cells = new Uint16Array(cols * rows);
  const cap = Math.max(1, Math.min(40, Math.ceil(o.maxFeatures / (cols * rows))));
  const need = Math.min(MIN_IN_CELL, cap);
  const md = Math.max(1, Math.round(o.minDist));
  const bw = Math.ceil(w / md), taken = new Uint8Array(bw * Math.ceil(h / md));
  const points = [];
  const bright = new Uint8Array(32);
  let level = { g: boost(grey(rgba, w, h), w, h, o.contrast), w, h };
  let junk = 0, noise0 = 0, total = 0;
  for (let L = 0; L < Math.max(1, Math.min(4, o.levels)); L++) {
    if (L > 0) level = half(level.g, level.w, level.h);
    const { g, w: lw, h: lh } = level, sc = 1 << L;
    const noise = noiseOf(g, lw, lh);
    if (L === 0) noise0 = noise;
    const floor = Math.max(o.threshold, noise * NOISE_K);
    const off = CIRCLE.map(([dx, dy]) => dy * lw + dx);
    const skip = Math.max(1, Math.round(md / sc));
    for (let y = 4; y < lh - 4; y++) {
      const fy = y * sc;
      if (fy >= rows * CELL) break;
      for (let x = 4; x < lw - 4; x++) {
        const fx = x * sc;
        if (fx >= cols * CELL) break;
        const p = y * lw + x;
        if (!arc(g, p, off, o.threshold, bright)) continue;
        if (floor > o.threshold && !arc(g, p, off, floor, bright)) { junk++; x += skip - 1; continue; }
        const ci = Math.floor(fy / CELL) * cols + Math.floor(fx / CELL);
        if (cells[ci] >= cap || total >= o.maxFeatures) { x += 2; continue; }
        const bi = Math.floor(fy / md) * bw + Math.floor(fx / md);
        if (taken[bi]) continue;
        taken[bi] = 1;
        cells[ci]++; total++;
        points.push(fx, fy);
        x += skip;
      }
    }
  }
  let features = 0, covered = 0;
  for (const n of cells) { features += n; if (n >= need) covered++; }
  return { features, coverage: covered / cells.length, points, cols, rows, junk, noise: noise0 };
}
