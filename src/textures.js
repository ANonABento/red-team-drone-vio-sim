// Procedural ground for a nadir camera, in three layers:
//   macro  2048 px over the whole 512 m world  (25 cm a pixel): layout, colour, patches
//   medium 1024 px tiling every 32 m           (3 cm a pixel):  clumps, stains, seams
//   detail 1024 px tiling every 2 m            (2 mm a pixel):  blades, stones, grain
// Medium and detail are multipliers around 1 (stored as value / 2), so as mipmaps
// average them away with altitude the ground keeps its colour and loses its texture,
// which is what a real camera sees.
import { createNoise2D, createNoise4D } from "simplex-noise";

export const WORLD = 512;
export const MED_TILE = 32;
export const DET_TILE = 2;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buffer(n, wrap, fill) {
  const d = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255; }
  return { n, d, wrap };
}
function blend(B, x, y, c, a) {
  const n = B.n;
  if (B.wrap) { x = ((x % n) + n) % n; y = ((y % n) + n) % n; }
  else if (x < 0 || y < 0 || x >= n || y >= n) return;
  const i = (y * n + x) * 4, d = B.d;
  d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a;
}
function disc(B, cx, cy, r, c, a = 1) {
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cov = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x - cx, y - cy)));
    if (cov > 0) blend(B, x, y, c, a * cov);
  }
}
function softDisc(B, cx, cy, r, c, a = 1) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = 1 - Math.hypot(x - cx, y - cy) / r;
    if (t > 0) blend(B, x, y, c, a * t * t * (3 - 2 * t));
  }
}
function seg(B, ax, ay, bx, by, w, c, a = 1) {
  const x0 = Math.floor(Math.min(ax, bx) - w - 1), x1 = Math.ceil(Math.max(ax, bx) + w + 1);
  const y0 = Math.floor(Math.min(ay, by) - w - 1), y1 = Math.ceil(Math.max(ay, by) + w + 1);
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let t = ((x - ax) * dx + (y - ay) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cov = Math.min(1, Math.max(0, w / 2 + 0.5 - Math.hypot(x - ax - t * dx, y - ay - t * dy)));
    if (cov > 0) blend(B, x, y, c, a * cov);
  }
}
function rect(B, x0, y0, x1, y1, c, a = 1) {
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) blend(B, x, y, c, a);
}
// A multiplier colour: f = 1 leaves the ground as it is.
const m = (r, g = r, b = g === r ? r : g) => [r * 127.5, g * 127.5, b * 127.5];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Seamless noise on a torus, for tiles.
function tileNoise(n4, period) {
  const k = (2 * Math.PI) / period;
  return (x, y, freq) => {
    const R = freq / (2 * Math.PI);
    return n4(Math.cos(x * k) * R, Math.sin(x * k) * R, Math.cos(y * k) * R, Math.sin(y * k) * R);
  };
}
// Tufts and the dark gaps between them, at the medium layer's 3 cm a pixel.
function speckle(B, r, amount) {
  const d = B.d;
  for (let i = 0; i < d.length; i += 4) {
    const k = 1 + (r() - 0.5) * 2 * amount;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
}
function fillNoise(B, fn) {
  const n = B.n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = fn(x, y), i = (y * n + x) * 4;
    B.d[i] = c[0]; B.d[i + 1] = c[1]; B.d[i + 2] = c[2];
  }
}

// ---------- detail tiles, 2 m across ----------
const DETAIL = {
  lawn(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 0.62 + 0.12 * tn(x, y, 24); return m(v, v * 0.95, v * 0.85); });
    for (let i = 0; i < 14000; i++) {
      const x = r() * B.n, y = r() * B.n, ang = r() * Math.PI * 2, len = 5 + r() * 14;
      const g = 0.85 + r() * 0.45;
      seg(B, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 1.2 + r() * 1.3, m(g * 0.95, g, g * 0.85), 0.9);
    }
  },
  deadgrass(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 0.6 + 0.15 * tn(x, y, 18); return m(v, v * 0.92, v * 0.85); });
    const lean = r() * Math.PI;
    for (let i = 0; i < 6000; i++) {
      const x = r() * B.n, y = r() * B.n, ang = lean + (r() - 0.5) * 1.6, len = 18 + r() * 45;
      const g = 0.8 + r() * 0.55;
      seg(B, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 1.4 + r() * 1.8, m(g * 1.05, g, g * 0.85), 0.85);
    }
    for (let i = 0; i < 160; i++) disc(B, r() * B.n, r() * B.n, 6 + r() * 10, m(0.75, 0.6, 0.45), 0.7);
  },
  gravel(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 0.5 + 0.1 * tn(x, y, 40); return m(v); });
    for (let i = 0; i < 3200; i++) {
      const x = r() * B.n, y = r() * B.n, rad = 3 + r() * 9, g = 0.75 + r() * 0.65, w = r() * 0.15;
      disc(B, x, y, rad, m(g + w, g, g - w));
      disc(B, x - rad * 0.3, y - rad * 0.3, rad * 0.45, m(g * 1.18 + w), 0.5);
    }
  },
  asphalt(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 0.9 + 0.08 * tn(x, y, 30) + (r() - 0.5) * 0.22; return m(v); });
    for (let i = 0; i < 9000; i++) disc(B, r() * B.n, r() * B.n, 0.8 + r() * 2.4, m(1.15 + r() * 0.5), 0.8);
    for (let k = 0; k < 3; k++) {
      let x = r() * B.n, y = r() * B.n, ang = r() * Math.PI * 2;
      for (let s = 0; s < 40; s++) {
        const nx = x + Math.cos(ang) * 8, ny = y + Math.sin(ang) * 8;
        seg(B, x, y, nx, ny, 1.5 + r(), m(0.45), 0.8);
        x = nx; y = ny; ang += (r() - 0.5) * 0.9;
      }
    }
  },
  snow(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.025 * tn(x, y, 10) + (r() - 0.5) * 0.02; return m(v); });
    for (let i = 0; i < 300; i++) disc(B, r() * B.n, r() * B.n, 0.8, m(1.12), 0.6);
  },
  floor(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.05 * tn(x, y, 14) + 0.03 * tn(x, y, 60) + (r() - 0.5) * 0.05; return m(v); });
    for (let i = 0; i < 400; i++) disc(B, r() * B.n, r() * B.n, 0.8 + r() * 1.5, m(0.8), 0.6);
  }
};

// Leaves, sticks, tufts and stones: the 5 to 30 cm things a tracker actually locks onto.
function clutter(B, r, count, tones) {
  for (let i = 0; i < count; i++) {
    const x = r() * B.n, y = r() * B.n, c = tones[Math.floor(r() * tones.length)];
    if (r() < 0.35) { const a = r() * Math.PI, l = 3 + r() * 9; seg(B, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.8 + r() * 1.2, c, 0.9); }
    else disc(B, x, y, 0.8 + r() * 2.6, c, 0.9);
  }
}

// ---------- medium tiles, 32 m across ----------
const MEDIUM = {
  lawn(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.14 * tn(x, y, 10) + 0.08 * tn(x, y, 40); const h = 0.06 * tn(x + 99, y, 6); return m(v + h, v, v - h); });
    for (let i = 0; i < 120; i++) disc(B, r() * B.n, r() * B.n, 3 + r() * 9, m(1.15, 1.05, 0.8), 0.45);
    for (let i = 0; i < 25; i++) disc(B, r() * B.n, r() * B.n, 4 + r() * 10, m(1.2, 1.0, 0.85), 0.55);
    speckle(B, r, 0.22);
    clutter(B, r, 2600, [m(0.55, 0.5, 0.45), m(1.35, 1.3, 0.9), m(0.75, 0.9, 0.6), m(1.4, 1.2, 0.8)]);
  },
  deadgrass(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.18 * tn(x, y, 8) + 0.08 * tn(x, y, 36); return m(v, v * 0.97, v * 0.92); });
    for (let i = 0; i < 900; i++) disc(B, r() * B.n, r() * B.n, 1.5 + r() * 2.5, m(0.8 + r() * 0.5, 0.65, 0.45), 0.8);
    speckle(B, r, 0.25);
    clutter(B, r, 3200, [m(0.5, 0.45, 0.4), m(1.45, 1.35, 1.1), m(0.9, 0.65, 0.45), m(1.3, 1.25, 1.1)]);
  },
  gravel(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.1 * tn(x, y, 7) + 0.05 * tn(x, y, 30); return m(v); });
    speckle(B, r, 0.2);
    for (let i = 0; i < 9000; i++) disc(B, r() * B.n, r() * B.n, 0.7 + r() * 1.6, m(0.6 + r() * 0.9), 0.85);
    for (let k = 0; k < 2; k++) {
      const y0 = r() * B.n;
      for (let x = 0; x < B.n; x += 4) { const y = y0 + 30 * Math.sin(x / 140); seg(B, x, y, x + 4, y0 + 30 * Math.sin((x + 4) / 140), 8, m(0.85), 0.5); seg(B, x, y + 45, x + 4, y0 + 45 + 30 * Math.sin((x + 4) / 140), 8, m(0.85), 0.5); }
    }
  },
  asphalt(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.07 * tn(x, y, 6); return m(v); });
    for (let i = 0; i < 6; i++) { const x = r() * B.n, y = r() * B.n; rect(B, x, y, x + 20 + r() * 60, y + 20 + r() * 60, m(0.82), 0.8); }
    for (let i = 0; i < 18; i++) disc(B, r() * B.n, r() * B.n, 3 + r() * 8, m(0.7), 0.5);
    speckle(B, r, 0.08);
    clutter(B, r, 500, [m(0.6), m(1.3), m(0.75)]);
    for (let k = 0; k < 5; k++) {
      let x = r() * B.n, y = r() * B.n, ang = r() * Math.PI * 2;
      for (let s = 0; s < 30; s++) { const nx = x + Math.cos(ang) * 10, ny = y + Math.sin(ang) * 10; seg(B, x, y, nx, ny, 1.2, m(0.55), 0.8); x = nx; y = ny; ang += (r() - 0.5) * 0.6; }
    }
  },
  snow(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.035 * tn(x, y, 5) + 0.015 * tn(x, y, 25); return m(v * 0.995, v, v * 1.01); });
    let x = r() * B.n, y = r() * B.n; const ang = r() * Math.PI * 2;
    for (let s = 0; s < 60; s++) { disc(B, x + (s % 2) * 6, y, 4, m(0.88), 0.6); x += Math.cos(ang) * 22; y += Math.sin(ang) * 22; }
  },
  floor(B, r, tn) {
    fillNoise(B, (x, y) => { const v = 1 + 0.05 * tn(x, y, 6) + 0.03 * tn(x, y, 22); return m(v); });
    for (let k = 0; k < B.n; k += 128) { seg(B, k, 0, k, B.n, 1.1, m(0.62), 0.9); seg(B, 0, k, B.n, k, 1.1, m(0.62), 0.9); }
    for (let i = 0; i < 12; i++) disc(B, r() * B.n, r() * B.n, 6 + r() * 20, m(0.88, 0.86, 0.8), 0.5);
    clutter(B, r, 250, [m(0.7), m(0.8, 0.78, 0.72), m(1.15)]);
  }
};

// ---------- the whole world, 512 m ----------
export const SURFACES = {
  lawn: { name: "Mown lawn", base: [88, 118, 58], detail: "lawn", relief: 0.4 },
  deadgrass: { name: "Dead grass, late November", base: [146, 128, 90], detail: "deadgrass", relief: 0.4 },
  gravel: { name: "Gravel lot", base: [138, 134, 126], detail: "gravel", relief: 0.15 },
  asphalt: { name: "Asphalt car park", base: [64, 64, 66], detail: "asphalt", relief: 0 },
  snow: { name: "Fresh snow", base: [232, 236, 240], detail: "snow", relief: 0.6 },
  floor: { name: "Indoor concrete floor", base: [152, 150, 146], detail: "floor", relief: 0 },
  site: { name: "Museum grounds stand-in", base: [100, 114, 64], detail: "lawn", second: "asphalt", relief: 0.2 }
};

export function buildGround(surfaceId, seed, patches) {
  const S = SURFACES[surfaceId];
  const r = rng(seed * 7919 + 13);
  const n2 = createNoise2D(r), n4 = createNoise4D(r);
  const mid = m(1);

  const det = buffer(1024, true, mid);
  DETAIL[S.detail](det, r, tileNoise(n4, 1024));
  const det2 = buffer(1024, true, mid);
  DETAIL[S.second || (patches ? "snow" : S.detail)](det2, r, tileNoise(n4, 1024));
  const med = buffer(1024, true, mid);
  MEDIUM[S.detail](med, r, tileNoise(n4, 1024));

  const N = 2048, px = N / WORLD; // pixels a metre
  const macro = buffer(N, false, S.base);
  const mask = buffer(N, false, [0, 255, 0]); // r: blend to second detail, g: texture strength
  const fbm = field((x, y) => n2(x / 90, y / 90) * 0.6 + n2(x / 30, y / 30) * 0.3 + n2(x / 9, y / 9) * 0.1);
  const hueF = field((x, y) => n2(x / 60 + 40, y / 60));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = x / px, wy = y / px, v = fbm(wx, wy), i = (y * N + x) * 4;
    const k = 1 + v * (surfaceId === "snow" ? 0.03 : surfaceId === "floor" ? 0.04 : 0.12);
    const hue = hueF(wx, wy) * 0.05;
    macro.d[i] = S.base[0] * (k + hue); macro.d[i + 1] = S.base[1] * k; macro.d[i + 2] = S.base[2] * (k - hue);
  }

  if (surfaceId !== "floor") {
    const k = surfaceId === "snow" ? 0.06 : 1;
    for (let i = 0; i < 2500 * k; i++) {
      // Clusters of soft blobs: shrubs, bare earth, worn patches, molehills.
      const x = r() * N, y = r() * N, f = r() < 0.55 ? 0.62 + r() * 0.2 : 1.12 + r() * 0.2, c = S.base.map((v) => v * f);
      const parts = 1 + Math.floor(r() * 5), size = 1.5 + r() * 5;
      for (let j = 0; j < parts; j++) softDisc(macro, x + (r() - 0.5) * size * 2.5, y + (r() - 0.5) * size * 2.5, size * (0.5 + r()), c, 0.75);
    }
  }
  if (surfaceId === "site") paintSite(macro, mask, px, r);

  if (patches) {
    const patchColor = surfaceId === "floor" ? [170, 170, 168] : surfaceId === "snow" ? [226, 230, 234] : [214, 218, 224];
    const pf = field((x, y) => n2(x / 45 + 300, y / 45) * 0.75 + n2(x / 12, y / 12 + 300) * 0.25);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = x / px, wy = y / px;
      const v = pf(wx, wy);
      const t = Math.min(1, Math.max(0, (v - 0.32) / 0.06));
      if (t <= 0) continue;
      const i = (y * N + x) * 4;
      for (let c = 0; c < 3; c++) macro.d[i + c] += (patchColor[c] - macro.d[i + c]) * t;
      mask.d[i] += ((S.second ? 0 : 255) - mask.d[i]) * t;
      mask.d[i + 1] += (25 - mask.d[i + 1]) * t;
    }
  }

  // Height: gentle undulation, so a low sun shades the ground.
  const height = (x, z) => S.relief * (n2(x / 40 + 7, z / 40) * 0.7 + n2(x / 12, z / 12 + 7) * 0.3);
  return { det, det2, med, macro, mask, height };
}

// A noise field over the world sampled every metre, read back smoothly.
function field(fn, G = 513) {
  const f = new Float32Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) f[y * G + x] = fn(x, y);
  return (x, y) => {
    const x0 = Math.min(G - 2, x | 0), y0 = Math.min(G - 2, y | 0), tx = x - x0, ty = y - y0, i = y0 * G + x0;
    return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + G] * (1 - tx) + f[i + G + 1] * tx) * ty;
  };
}

function paintSite(macro, mask, px, r) {
  const asph = [70, 70, 72], concrete = [150, 147, 140], paint = [222, 222, 214];
  const lot = (x0, y0, x1, y1) => {
    rect(macro, x0 * px, y0 * px, x1 * px, y1 * px, asph);
    rect(mask, x0 * px, y0 * px, x1 * px, y1 * px, [255, 255, 0]);
    for (let y = y0 + 6; y < y1 - 5; y += 16) {
      for (let x = x0 + 4; x <= x1 - 4; x += 2.7) {
        seg(macro, x * px, y * px, x * px, (y + 5.2) * px, 0.12 * px, paint);
        seg(macro, x * px, (y + 6.2) * px, x * px, (y + 11.4) * px, 0.12 * px, paint);
      }
    }
  };
  lot(-60 + 256, -40 + 256, 40 + 256, 30 + 256);
  lot(70 + 256, 60 + 256, 150 + 256, 120 + 256);
  // Paths and a road.
  const path = (ax, ay, bx, by, w, c) => { seg(macro, ax * px, ay * px, bx * px, by * px, w * px, c); seg(mask, ax * px, ay * px, bx * px, by * px, w * px, [255, 255, 0]); };
  path(0, 230, 512, 236, 9, asph);
  path(256, 30, 260, 512, 3, concrete);
  path(120, 400, 400, 330, 2.5, concrete);
  for (let x = 4; x < 512; x += 6) seg(macro, x * px, 233 * px, (x + 3) * px, 233.08 * px, 0.12 * px, paint);
  for (let i = 0; i < 40; i++) disc(macro, r() * 2048, r() * 2048, (2 + r() * 4) * px, [70, 88, 50], 0.8);
}
