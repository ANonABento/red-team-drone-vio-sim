// Flight model of the Orqa MRM2-10 class airframe (the M2-AI), its sensors,
// navigation sources and a PX4-style cascaded controller. Pure maths, no drawing,
// so the camera stage can replay its poses and the IMU later.
//
// Frames: world x east, y up, z south (three.js). Body: x right, y up, -z forward.

export const AIRFRAME = {
  name: "Orqa MRM2-10 class (M2-AI)",
  // Published: 1186 g dry, 2908 g with the 6S4P ~16 Ah Li-ion pack, 465 mm wheelbase,
  // Orqa 2814 880 kV on 10 inch two-blade props, 3.5 kg max payload, H743 with ICM-42688.
  // Not published, still estimated: inertia, thrust curve, motor lag, drag.
  mass: 2.9,                  // kg, with the 6S4P Li-ion pack
  wheelbase: 0.465,           // m, motor to motor across the diagonal
  inertia: [0.024, 0.042, 0.024], // kg m², box-and-arms estimate (x roll, y yaw, z pitch)
  maxThrust: 21,              // N per motor at full charge: 2814 880 kV on 10 inch props
  maxRpm: 15000,
  motorTau: 0.04,             // s, motor spin-up lag
  torqueK: 0.016,             // m, yaw torque per newton of thrust
  dragLin: 0.25, dragQuad: 0.045,
  cells: 6, cellFull: 4.15, cellEmpty: 3.0
};
const G = 9.81;
const R = AIRFRAME.wheelbase / 2;
const D = R * Math.SQRT1_2;
// Motor positions in the body (x, z) and spin direction (+1 pushes yaw left).
export const MOTORS = [
  { x: D, z: -D, s: -1 },  // front right
  { x: -D, z: D, s: -1 },  // rear left
  { x: -D, z: -D, s: 1 },  // front left
  { x: D, z: D, s: 1 }     // rear right
];

// ---------- small maths ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Quaternions as [x, y, z, w].
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };
function qrot(q, v) { // rotate v by q
  const u = [q[0], q[1], q[2]], s = q[3];
  return add(add(mul(u, 2 * dot(u, v)), mul(v, s * s - dot(u, u))), mul(cross(u, v), 2 * s));
}
function qFromBasis(X, Y, Z) { // columns of a rotation matrix
  const m00 = X[0], m11 = Y[1], m22 = Z[2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(Y[2] - Z[1]) * s, (Z[0] - X[2]) * s, (X[1] - Y[0]) * s, 0.25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s, (Y[2] - Z[1]) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(Y[0] + X[1]) / s, 0.25 * s, (Z[1] + Y[2]) / s, (Z[0] - X[2]) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, 0.25 * s, (X[1] - Y[0]) / s]; }
  return qnorm(q);
}

export function rng(seed) {
  let a = seed >>> 0 || 1;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  u.gauss = () => { const v = Math.max(1e-9, u()); return Math.sqrt(-2 * Math.log(v)) * Math.cos(2 * Math.PI * u()); };
  return u;
}

// A first-order Gauss-Markov process: noise with memory tau and steady spread sigma.
function markov(r, sigma, tau) {
  let x = r.gauss() * sigma;
  return { step(dt) { x += -x * dt / tau + sigma * Math.sqrt(2 * dt / tau) * r.gauss(); return x; }, get v() { return x; }, set v(n) { x = n; } };
}

// Mixer: thrusts for a collective and three body torques (x, y yaw, z).
const MIX = (() => {
  const A = [MOTORS.map(() => 1), MOTORS.map((m) => -m.z), MOTORS.map((m) => m.s * AIRFRAME.torqueK), MOTORS.map((m) => m.x)];
  const n = 4, M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row) => row.slice(n));
})();

export const GNSS_MODES = {
  full: "Full GNSS",
  degraded: "Degraded (jammed)",
  spoofed: "Spoofed",
  denied: "Denied"
};
export const VIO_TUNES = { typical: { name: "Typical open-source VIO", k: 1 }, tuned: { name: "Tuned for this camera", k: 0.5 }, best: { name: "Best case", k: 0.25 } };
export const GUSTS = { calm: { name: "Steady", k: 0 }, moderate: { name: "Gusty", k: 0.25 }, strong: { name: "Very gusty", k: 0.5 } };

export function createFlight(opts = {}) {
  const r = rng(opts.seed || 7);
  const A = AIRFRAME;
  const set = {
    altitude: 20, gnss: "full", vio: true, tune: "typical", wind: 4, windDir: 250, gust: "moderate", charge: 0.9,
    ...opts
  };

  const s = {
    t: 0,
    p: [0, set.altitude, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0],
    thrust: MOTORS.map(() => A.mass * G / 4), // actual, per motor
    rpm: [0, 0, 0, 0], spin: [0, 0, 0, 0],
    ground: 0, landed: false
  };
  const hold = [0, 0];
  let altSp = set.altitude;

  // ---------- environment ----------
  const gust = [markov(r, 1, 2.5), markov(r, 1, 2.5), markov(r, 1, 1.2)];
  function windAt(h) {
    const mean = set.wind * Math.pow(Math.max(1, h) / 10, 0.14); // stronger with height
    const a = set.windDir * Math.PI / 180; // direction it blows from
    const k = GUSTS[set.gust].k * mean;
    return [-Math.sin(a) * mean + gust[0].v * k, gust[2].v * k * 0.4, Math.cos(a) * mean + gust[1].v * k];
  }

  // ---------- sensors ----------
  const imu = {
    gyroBias: [r.gauss() * 0.003, r.gauss() * 0.003, r.gauss() * 0.003],
    gyro: [0, 0, 0], accel: [0, 0, 0], gyroF: [0, 0, 0], vibRms: 0, vibAcc: 0, vibN: 0
  };
  const baro = markov(r, 0.25, 30);
  // GNSS error per mode, as a Gauss-Markov wander plus white noise.
  const gnssWander = [markov(r, 1, 20), markov(r, 1, 20)];
  const gnss = { err: [0, 0], vErr: [0, 0], ok: false, lastFix: -1, gapUntil: 0, spoofDir: r() * Math.PI * 2, spoofStart: null, rejected: false, distrust: 0, vInnov: [0, 0], rejections: 0 };
  const vio = { anchored: false, anchorT: 0, on: false, err: [0, 0], vel: [0, 0], bias: [markov(r, 1, 30), markov(r, 1, 30)], lostBias: [0, 0], coverage: null, state: "off", lostFor: 0, quality: 1 };
  const est = { err: [0, 0], vErr: [0, 0], src: "none", altErr: 0, hasPos: false };
  // Lost-lock fallback: when VIO loses the ground with no GNSS to lean on, stop chasing the
  // runaway IMU position. Freeze the tilt that was holding against the wind and damp only
  // the IMU's own velocity, whose error grows slowly (dead reckoning over seconds, not a
  // double integral left to run). When tracking returns, look for the kept frame of the
  // mark; if it is out of view, climb to widen the footprint until it is. Then snap the
  // estimate to it and fly back down to the mark.
  const fb = { mode: "off", since: 0, trim: [0, 0], bias: [0, 0], dir: 0, err: [0, 0], alt0: 0, events: [] };

  function gnssStep(dt) {
    gnss.ok = false;
    if (set.gnss === "denied") { gnss.spoofStart = null; return; }
    const sig = set.gnss === "degraded" ? 3.5 : 0.5;
    const wx = gnssWander[0].step(dt) * sig, wz = gnssWander[1].step(dt) * sig;
    if (set.gnss === "degraded") {
      if (s.t < gnss.gapUntil) return;
      if (r() < dt / 6) { gnss.gapUntil = s.t + 2 + r() * 6; return; }
    }
    if (s.t - gnss.lastFix < 0.2) { gnss.ok = true; return; } // 5 Hz fixes
    gnss.lastFix = s.t;
    gnss.ok = true;
    let sx = 0, sz = 0, svx = 0, svz = 0;
    if (set.gnss === "spoofed") {
      if (gnss.spoofStart == null) gnss.spoofStart = s.t;
      // A believable slow walk: speeds up to 0.6 m/s over 20 s and looks healthy all the way.
      const tt = s.t - gnss.spoofStart, speed = Math.min(0.6, tt * 0.03), dist = tt < 20 ? 0.015 * tt * tt : 6 + (tt - 20) * 0.6;
      sx = Math.cos(gnss.spoofDir) * dist; sz = Math.sin(gnss.spoofDir) * dist;
      svx = Math.cos(gnss.spoofDir) * speed; svz = Math.sin(gnss.spoofDir) * speed;
    } else gnss.spoofStart = null;
    const white = set.gnss === "degraded" ? 1.2 : 0.15;
    gnss.err = [wx + sx + r.gauss() * white, wz + sz + r.gauss() * white];
    const vn = set.gnss === "degraded" ? 0.3 : 0.05;
    gnss.vErr = [svx + r.gauss() * vn, svz + r.gauss() * vn];
  }

  // Until this time the camera gives VIO nothing (covered, glare, a dropped stream): a forced loss.
  let blindUntil = -1;
  function vioStep(dt, h) {
    vio.on = set.vio;
    if (!set.vio) { vio.state = "off"; return; }
    const cov = vio.coverage == null ? 0.6 : vio.coverage;
    const rate = Math.hypot(s.w[0], s.w[2]);
    // Fewer features and fast rotation (blur) both cut the tracker's quality.
    let q = clamp((cov - 0.1) / 0.5, 0, 1) * clamp(1.6 - rate / 1.5, 0.2, 1);
    // From the mission loop: rolling shutter warp and motion blur in the frames VIO tracks, in
    // 720p pixels. Warp the tracker does not model bends its feature tracks; a tracker that
    // models the readout removes most of it. Blur smears corners until they stop matching.
    const warp = (vio.warp || 0) * (set.rsAware ? 0.25 : 1), blur = vio.blur || 0;
    if (vio.warp != null) q *= clamp(1.25 - warp / 4, 0.25, 1) * clamp(1.2 - blur / 6, 0.2, 1);
    vio.quality = q;
    const lostNow = cov < 0.12 || rate > 3 || h < 0.6 || blur > 10 || s.t < blindUntil;
    if (lostNow) vio.lostFor += dt; else vio.lostFor = Math.max(0, vio.lostFor - dt * 2);
    const k = VIO_TUNES[set.tune].k * Math.max(1, h) / 10;
    if (vio.lostFor > 0.4) {
      // Tracking lost: only the IMU carries the estimate and its error grows fast.
      if (vio.state !== "lost") { vio.state = "lost"; const a = r() * Math.PI * 2; vio.lostBias = [Math.cos(a) * 0.25, Math.sin(a) * 0.25]; }
      vio.lostBias = vio.lostBias.map((b) => clamp(b * (1 + dt * 0.8), -2, 2));
      vio.vel = [vio.lostBias[0], vio.lostBias[1]];
    } else {
      vio.state = q < 0.35 ? "weak" : "tracking";
      const spread = 0.016 * k / (0.3 + q);
      const b = vio.bias.map((m) => m.step(dt) * spread);
      const white = 0.02 * k / (0.3 + q);
      vio.vel = [b[0] + r.gauss() * white, b[1] + r.gauss() * white];
    }
    vio.err = [vio.err[0] + vio.vel[0] * dt, vio.err[1] + vio.vel[1] * dt];
  }

  // Hold anchor: the frame seen when the hold started is kept, and about ten times a second
  // the live frame is matched against it. That match measures where the drone is relative
  // to the mark directly, so VIO's slow walk can no longer pile up. Its noise is a fraction
  // of a ground pixel (which grows with height), worse with poor texture or uncorrected warp.
  // It only works while tracking and while the mark is still in view (the footprint is
  // about 1.5 times the height either side), so after a loss it snaps back once re-acquired.
  function anchorStep(dt) {
    vio.anchored = false;
    if (!set.anchor || vio.state === "lost" || vio.state === "off") return;
    const h = Math.max(1, s.p[1] - s.ground);
    const off = Math.hypot(s.p[0] - hold[0], s.p[2] - hold[1]);
    if (off > h * 1.2) return;
    vio.anchored = true;
    vio.anchorT += dt;
    if (vio.anchorT < 0.1) return;
    vio.anchorT = 0;
    const gsd = h * 0.0026;  // metres per 720p pixel straight down
    const warp = (vio.warp || 0) * (set.rsAware ? 0.25 : 1);
    const sigma = gsd * 0.35 * (1 + warp / 3) / (0.3 + vio.quality);
    const k = 0.25;
    est.err[0] += (r.gauss() * sigma - est.err[0]) * k;
    est.err[1] += (r.gauss() * sigma - est.err[1]) * k;
  }

  function navStep(dt) {
    // Error-state fusion: what the controller believes = truth + est.err.
    gnss.rejected = false;
    if (vio.on && vio.state !== "off") {
      est.err = [est.err[0] + vio.vel[0] * dt, est.err[1] + vio.vel[1] * dt];
      est.vErr = [vio.vel[0], vio.vel[1]];
      if (gnss.ok && gnss.lastFix === s.t) {
        // Two gates: a position jump of more than 3 m, or a velocity that keeps disagreeing
        // with VIO's (a spoofer's slow walk), and GNSS is distrusted for 10 s.
        const ix = gnss.err[0] - est.err[0], iz = gnss.err[1] - est.err[1];
        const k = 0.2 / 3;
        gnss.vInnov[0] += ((gnss.vErr[0] - vio.vel[0]) - gnss.vInnov[0]) * k;
        gnss.vInnov[1] += ((gnss.vErr[1] - vio.vel[1]) - gnss.vInnov[1]) * k;
        const bad = Math.hypot(ix, iz) > 3 || (vio.state !== "lost" && Math.hypot(gnss.vInnov[0], gnss.vInnov[1]) > 0.22);
        if (bad && !(gnss.distrust > s.t)) { gnss.distrust = s.t + 10; gnss.rejections++; }
        if (gnss.distrust > s.t) gnss.rejected = true;
        else { est.err[0] += ix * 0.06; est.err[1] += iz * 0.06; }
      } else if (gnss.distrust > s.t) gnss.rejected = true;
      anchorStep(dt);
      est.src = gnss.ok && !gnss.rejected ? "gnss+vio" : vio.state === "lost" ? "imu" : "vio";
      est.hasPos = true;
    } else if (gnss.ok) {
      est.err = [...gnss.err]; est.vErr = [...gnss.vErr]; est.src = "gnss"; est.hasPos = true;
    } else if (est.hasPos && est.src !== "none" && s.t - gnss.lastFix < 1.5) {
      est.err = [est.err[0] + est.vErr[0] * dt, est.err[1] + est.vErr[1] * dt]; // a short gap: coast
    } else {
      est.src = "none"; est.hasPos = false;
    }
    est.altErr = baro.step(dt) + r.gauss() * 0.05;
  }

  function fallbackStep(dt, h) {
    const blindNav = set.vio && vio.state === "lost" && !(gnss.ok && !gnss.rejected);
    if (!set.fallback) { if (fb.mode !== "off") endFallback(); return; }
    if (fb.mode === "off") {
      if (!blindNav || pilot.on) return;
      fb.mode = "imu"; fb.since = s.t; fb.trim = [ctl.vInt[0], ctl.vInt[2]]; fb.dir = r() * Math.PI * 2;
      fb.bias = [0, 0]; fb.err = [est.err[0], est.err[1]]; fb.alt0 = altSp;
      fb.events.push("fallback: holding still on the IMU");
      return;
    }
    // Dead-reckoned velocity: its error creeps up about 4 cm/s each second, to 0.6 m/s at most.
    const m = Math.min(0.6, (s.t - fb.since) * 0.04);
    fb.bias = [Math.cos(fb.dir) * m, Math.sin(fb.dir) * m];
    fb.err = [fb.err[0] + fb.bias[0] * dt, fb.err[1] + fb.bias[1] * dt];
    if (vio.state === "lost") return;
    if (gnss.ok && !gnss.rejected) { est.err = [...gnss.err]; endFallback(); return; }
    if (!set.anchor) {
      // No kept frame to find: carry on from the dead-reckoned position.
      est.err = [...fb.err]; fb.events.push("tracking back, flying to the dead-reckoned mark"); endFallback(); return;
    }
    const off = Math.hypot(s.p[0] - hold[0], s.p[2] - hold[1]);
    if (off <= Math.max(1, h) * 1.1) {
      // The kept frame matches again: relocalise against it in one go.
      const gsd = Math.max(1, h) * 0.0026;
      est.err = [r.gauss() * gsd, r.gauss() * gsd]; est.vErr = [0, 0]; vio.err = [0, 0];
      fb.events.push(fb.mode === "search" ? `mark found from ${Math.round(h)} m, flying back` : "mark found, flying back");
      endFallback();
      return;
    }
    if (fb.mode !== "search") { fb.mode = "search"; fb.events.push("mark out of view, climbing to look for it"); }
    altSp = Math.min(Math.max(fb.alt0 * 3, fb.alt0 + 20), 150, altSp + 2 * dt);
  }
  function endFallback() {
    if (fb.mode === "off") return;
    ctl.vInt[0] = fb.trim[0]; ctl.vInt[2] = fb.trim[1];
    altSp = fb.alt0; fb.mode = "off";
  }

  // ---------- controller ----------
  const ctl = { vInt: [0, 0, 0], rInt: [0, 0, 0], wasPos: false };
  // Pilot sticks, each -1..1: fwd, right, up and yaw (positive turns left). Off means hold.
  const pilot = { on: false, fwd: 0, right: 0, up: 0, yaw: 0, speed: 6 };
  let yawSp = 0;
  const MAX_TILT = 40 * Math.PI / 180;
  function control(dt) {
    const pe = [s.p[0] + est.err[0], s.p[1] - s.ground + est.altErr, s.p[2] + est.err[1]];
    const ve = [s.v[0] + est.vErr[0], s.v[1], s.v[2] + est.vErr[1]];
    let ax = 0, az = 0;
    const sticking = pilot.on && Math.abs(pilot.fwd) + Math.abs(pilot.right) > 0.02;
    if (pilot.on) {
      yawSp += pilot.yaw * 1.2 * dt;
      if (pilot.up) { altSp = clamp(altSp + pilot.up * 2.5 * dt, 0.5, 150); set.altitude = altSp; }
    }
    let pvx = 0, pvz = 0;
    if (sticking) {
      const sy = Math.sin(yawSp), cy = Math.cos(yawSp);
      pvx = (-sy * pilot.fwd + cy * pilot.right) * pilot.speed;
      pvz = (-cy * pilot.fwd - sy * pilot.right) * pilot.speed;
    }
    if (sticking && !est.hasPos) { ax = pvx * 0.5; az = pvz * 0.5; }
    if (fb.mode !== "off") {
      // Hold still: the frozen wind trim, damped on the IMU's dead-reckoned velocity.
      ax = fb.trim[0] - (s.v[0] + fb.bias[0]) * 1.2;
      az = fb.trim[1] - (s.v[2] + fb.bias[1]) * 1.2;
    } else if (est.hasPos) {
      if (!ctl.wasPos) { ctl.vInt[0] = ctl.vInt[2] = 0; }
      if (sticking) { hold[0] = pe[0] + ve[0] * 0.6; hold[1] = pe[2] + ve[2] * 0.6; }
      const vx = sticking ? pvx : clamp((hold[0] - pe[0]) * 0.95, -4, 4), vz = sticking ? pvz : clamp((hold[1] - pe[2]) * 0.95, -4, 4);
      ctl.vInt[0] = clamp(ctl.vInt[0] + (vx - ve[0]) * dt * 0.5, -6, 6);
      ctl.vInt[2] = clamp(ctl.vInt[2] + (vz - ve[2]) * dt * 0.5, -6, 6);
      ax = (vx - ve[0]) * 2 + ctl.vInt[0];
      az = (vz - ve[2]) * 2 + ctl.vInt[2];
    }
    ctl.wasPos = est.hasPos;
    const vy = clamp((altSp - pe[1]) * 1.1, -2, 2.5);
    ctl.vInt[1] = clamp(ctl.vInt[1] + (vy - ve[1]) * dt * 1.2, -4, 4);
    const ay = (vy - ve[1]) * 4 + ctl.vInt[1];
    let F = [ax * A.mass, (ay + G) * A.mass, az * A.mass];
    if (F[1] < 0.2 * A.mass) F[1] = 0.2 * A.mass;
    const hz = Math.hypot(F[0], F[2]), maxH = F[1] * Math.tan(MAX_TILT);
    if (hz > maxH) { F[0] *= maxH / hz; F[2] *= maxH / hz; }
    const up = norm(F);
    const Z = norm(cross([Math.cos(yawSp), 0, -Math.sin(yawSp)], up)), X = cross(up, Z);
    const qd = qFromBasis(X, up, Z);
    const bodyUp = qrot(s.q, [0, 1, 0]);
    const collective = Math.max(0, dot(F, bodyUp));
    // Attitude error to body rates.
    let qe = qmul(qconj(s.q), qd);
    if (qe[3] < 0) qe = qe.map((v) => -v);
    const rateSp = [qe[0] * 2 * 7, qe[1] * 2 * 2.5, qe[2] * 2 * 7].map((v) => clamp(v, -4, 4));
    const g = imu.gyroF;
    const I = A.inertia;
    const e = sub(rateSp, g);
    ctl.rInt = ctl.rInt.map((v, i) => clamp(v + e[i] * dt, -0.5, 0.5));
    const Iw = [I[0] * g[0], I[1] * g[1], I[2] * g[2]];
    const gyroTerm = cross(g, Iw);
    const tau = [0, 1, 2].map((i) => I[i] * ([22, 10, 22][i] * e[i] + 4 * ctl.rInt[i]) + gyroTerm[i]);
    const want = [collective, tau[0], tau[1], tau[2]];
    return MIX.map((row) => clamp(row.reduce((acc, m, i) => acc + m * want[i], 0), 0, maxThrust()));
  }

  const voltage = () => A.cells * (A.cellEmpty + (A.cellFull - A.cellEmpty) * set.charge);
  const maxThrust = () => A.maxThrust * Math.pow(voltage() / (A.cells * A.cellFull), 2);

  // ---------- physics ----------
  const DT = 0.002; // 500 Hz
  let kickQueued = null;
  function step(heightAt) {
    const dt = DT;
    s.t += dt;
    s.ground = heightAt(s.p[0], s.p[2]);
    const h = s.p[1] - s.ground;
    for (const m of gust) m.step(dt);
    gnssStep(dt); vioStep(dt, h); navStep(dt); fallbackStep(dt, h);

    // IMU: truth plus bias, noise and motor vibration at the props' speed.
    const meanRpm = s.rpm.reduce((a, b) => a + b, 0) / 4;
    imu.rpm = meanRpm;
    const f = meanRpm / 60, vib = 2.2 * Math.pow(meanRpm / 9000, 2);
    const ph = 2 * Math.PI * f * s.t;
    const vibA = [vib * Math.sin(ph + 0.3), vib * 1.4 * Math.sin(ph * 2 + 1.1), vib * Math.sin(ph + 2.0)];
    imu.gyro = s.w.map((wv, i) => wv + imu.gyroBias[i] + r.gauss() * 0.006 + vibA[i] * 0.02);
    imu.gyroF = imu.gyroF.map((v, i) => v + (imu.gyro[i] - v) * (dt / (dt + 1 / (2 * Math.PI * 60))));
    imu.vibAcc += vibA[0] * vibA[0] + vibA[1] * vibA[1] + vibA[2] * vibA[2]; imu.vibN++;
    if (imu.vibN >= 250) { imu.vibRms = Math.sqrt(imu.vibAcc / imu.vibN); imu.vibAcc = 0; imu.vibN = 0; }

    const cmd = s.landed && altSp <= 0 ? [0, 0, 0, 0] : control(dt);
    s.thrust = s.thrust.map((tv, i) => tv + (cmd[i] - tv) * dt / A.motorTau);
    s.rpm = s.thrust.map((tv) => A.maxRpm * Math.sqrt(Math.max(0, tv) / A.maxThrust));
    s.spin = s.spin.map((a, i) => a + s.rpm[i] / 60 * 2 * Math.PI * dt * MOTORS[i].s);

    // Forces in the world.
    const total = s.thrust.reduce((a, b) => a + b, 0);
    const thrustW = mul(qrot(s.q, [0, 1, 0]), total);
    const air = sub(s.v, windAt(h));
    const sp = len(air);
    const drag = mul(air, -(A.dragLin + A.dragQuad * sp));
    let acc = mul(add(add(thrustW, drag), [0, -G * A.mass, 0]), 1 / A.mass);
    if (kickQueued) { s.v = add(s.v, kickQueued.v); s.w = add(s.w, kickQueued.w); kickQueued = null; }
    s.v = add(s.v, mul(acc, dt));
    s.p = add(s.p, mul(s.v, dt));
    s.acc = acc;

    // Torques in the body.
    const I = A.inertia;
    let tau = [0, 0, 0];
    MOTORS.forEach((m, i) => { tau = add(tau, [-m.z * s.thrust[i], m.s * A.torqueK * s.thrust[i], m.x * s.thrust[i]]); });
    tau = add(tau, mul(s.w, -0.004)); // rotational damping
    const Iw = [I[0] * s.w[0], I[1] * s.w[1], I[2] * s.w[2]];
    const wd = sub(tau, cross(s.w, Iw)).map((v, i) => v / I[i]);
    s.w = add(s.w, mul(wd, dt));
    const dq = [s.w[0] * dt / 2, s.w[1] * dt / 2, s.w[2] * dt / 2, 1];
    s.q = qnorm(qmul(s.q, dq));

    // The ground.
    const g = heightAt(s.p[0], s.p[2]) + 0.12;
    if (s.p[1] < g) {
      s.p[1] = g; if (s.v[1] < 0) s.v[1] = 0;
      s.v[0] *= 0.9; s.v[2] *= 0.9; s.w = mul(s.w, 0.8);
      s.landed = true;
    } else if (s.p[1] > g + 0.05) s.landed = false;
  }

  return {
    set, s, imu, gnss, vio, est, hold, DT, fb,
    pilot,
    get yaw() { return yawSp; },
    holdHere() { hold[0] = s.p[0] + est.err[0]; hold[1] = s.p[2] + est.err[1]; },
    get altSp() { return altSp; },
    setAltitude(h) { altSp = h; set.altitude = h; },
    windAt,
    hoverThrottle: () => (A.mass * G / 4) / maxThrust(),
    voltage,
    step,
    // Truth, and where the drone believes it is, relative to the hold point.
    drift: () => Math.hypot(s.p[0] - hold[0], s.p[2] - hold[1]),
    believed: () => [s.p[0] + est.err[0], s.p[2] + est.err[1]],
    blind(sec) { blindUntil = s.t + sec; },
    get blinded() { return s.t < blindUntil; },
    kick() {
      const a = r() * Math.PI * 2;
      kickQueued = { v: [Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5], w: [r.gauss() * 1.5, r.gauss() * 0.5, r.gauss() * 1.5] };
    },
    reset(heightAt) {
      const g = heightAt(0, 0);
      s.p = [0, g + altSp, 0]; s.v = [0, 0, 0]; s.q = [0, 0, 0, 1]; s.w = [0, 0, 0]; s.t = 0;
      s.thrust = MOTORS.map(() => A.mass * G / 4);
      ctl.vInt = [0, 0, 0]; ctl.rInt = [0, 0, 0]; yawSp = 0; hold[0] = 0; hold[1] = 0;
      est.err = [0, 0]; est.vErr = [0, 0]; vio.err = [0, 0]; vio.lostFor = 0; blindUntil = -1; vio.state = set.vio ? "tracking" : "off";
      fb.mode = "off"; fb.events.length = 0;
      gnss.lastFix = -1; gnss.gapUntil = 0; gnss.spoofStart = null; gnss.distrust = 0; gnss.vInnov = [0, 0]; gnss.rejections = 0; gnss.spoofDir = r() * Math.PI * 2;
      // Start as if hovering.
      ctl.vInt[1] = 0;
    }
  };
}
