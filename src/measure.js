// What we measure on the real M2-AI, Justice D and APB, how, and what each number changes in the sim.
const G = 9.81;
const store = ambition.collection("measurements");

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
const fmt = (v, d = 3) => (v == null || !isFinite(v)) ? "–" : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (+v.toPrecision(d)).toString();
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Sessions: what you can do in one sitting with the same kit.
const SESSIONS = [
  { id: "bench", name: "On the bench, props off", about: "One afternoon with the drone, a kitchen scale, string and a laptop. Nothing flies." },
  { id: "stand", name: "On a thrust stand, props on", about: "Strap one arm down over a scale, or use a thrust stand. Stay behind the prop line." },
  { id: "air", name: "In the air, GNSS on", about: "One calm day on an open field, flying with GNSS so the drone is safe while it logs." },
  { id: "apb", name: "On the APB", about: "Plug into the board's Linux side over USB-C or SSH." }
];

// Each thing to measure: inputs, a formula, and where the answer lands in the sim.
const ITEMS = [
  {
    id: "mass", session: "bench", name: "Take-off weight",
    why: "Sets how hard the motors work to hover, and scales the inertia.",
    sim: "Drone mass, now 2.9 kg",
    kit: ["Kitchen or luggage scale good to 5 kg"],
    steps: ["Fit everything that will fly: battery, APB, Justice D, props, antennas.", "Weigh it three times and take the middle reading."],
    inputs: [{ k: "g", label: "Weight", unit: "g", step: 1 }],
    calc: (v) => v.g > 0 ? { mass: v.g / 1000 } : null,
    show: (r) => `${fmt(r.mass)} kg`,
    preset: (r) => ({ airframe: { mass: r.mass } })
  },
  {
    id: "inertia", session: "bench", name: "Inertia, by two-string pendulum",
    why: "How fast it rolls, pitches and turns for a given motor push. The sim's numbers are a guess from a box and four arms.",
    sim: "Inertia, now 0.024 roll, 0.024 pitch, 0.042 yaw (kg m²)",
    kit: ["Two thin strings about 1 to 1.5 m long", "Tape measure", "Phone stopwatch"],
    steps: [
      "Hang the drone level from two strings, equally spaced either side of its centre, strings parallel.",
      "For yaw: hang it flat, twist it a few degrees about the vertical and let go. Time 10 full swings.",
      "For roll: hang it on its side with the front pointing up, strings on either side of the centre, and repeat.",
      "For pitch: hang it on its side with the front pointing sideways, and repeat.",
      "Measure the string length and the gap between the strings each time you rehang it; keep them the same if you can."
    ],
    inputs: [
      { k: "kg", label: "Weight hung", unit: "kg", step: 0.01 },
      { k: "d", label: "Gap between strings", unit: "m", step: 0.01 },
      { k: "L", label: "String length", unit: "m", step: 0.01 },
      { k: "roll", label: "10 roll swings", unit: "s", step: 0.01 },
      { k: "pitch", label: "10 pitch swings", unit: "s", step: 0.01 },
      { k: "yaw", label: "10 yaw swings", unit: "s", step: 0.01 }
    ],
    calc: (v) => {
      if (!(v.kg > 0 && v.d > 0 && v.L > 0)) return null;
      const I = (t) => t > 0 ? v.kg * G * v.d * v.d * (t / 10) ** 2 / (16 * Math.PI ** 2 * v.L) : null;
      const r = { roll: I(v.roll), pitch: I(v.pitch), yaw: I(v.yaw) };
      return r.roll || r.pitch || r.yaw ? r : null;
    },
    formula: "I = m g d² T² / (16 π² L), with T one swing",
    show: (r) => ["roll", "pitch", "yaw"].filter((k) => r[k]).map((k) => `${k} ${fmt(r[k])}`).join(" · ") + " kg m²",
    preset: (r) => ({ airframe: { inertia: [r.roll, r.yaw, r.pitch] } })
  },
  {
    id: "readout", session: "bench", name: "Justice D readout time",
    why: "The heart of the rolling shutter: how long the sensor takes from its top row to its bottom row.",
    sim: "Readout, now a 13 ms guess",
    kit: ["An LED blinking at a known rate: an Arduino, or a phone strobe app", "Something dark to point the camera at"],
    steps: [
      "Blink an LED at a known rate, like 1,000 Hz with half on, half off.",
      "Set the Justice D to the mode you'll fly (720p or 1080p at 60 fps) with the shortest exposure it allows.",
      "Fill the frame with the LED, close up and out of focus. You'll see light and dark stripes across the frame.",
      "Grab a still and count how many rows one light plus one dark stripe takes. Average over several stripes.",
      "Repeat at a second blink rate; both should give the same readout."
    ],
    inputs: [
      { k: "hz", label: "Blink rate", unit: "Hz", step: 1 },
      { k: "period", label: "Rows per light and dark pair", unit: "rows", step: 0.1 },
      { k: "rows", label: "Rows in the frame", unit: "rows", step: 1, value: 720 }
    ],
    calc: (v) => v.hz > 0 && v.period > 0 && v.rows > 0 ? { ms: 1000 * v.rows / (v.hz * v.period), line_us: 1e6 / (v.hz * v.period) } : null,
    formula: "readout = rows / (blink rate × rows per pair)",
    show: (r) => `${fmt(r.ms)} ms (${fmt(r.line_us)} µs a row)`,
    preset: (r) => ({ readout: Math.round(r.ms * 10) / 10 })
  },
  {
    id: "lens", session: "bench", name: "Lens and focal length",
    why: "VIO needs to know exactly where each pixel looks. At 114° the fisheye bend is large.",
    sim: "Reference for the VIO setup; the sim draws a generic fisheye",
    kit: ["Kalibr on a laptop", "An AprilGrid printed flat on stiff board", "A short recording from the Justice D"],
    steps: [
      "Print Kalibr's AprilGrid and glue it flat.",
      "Record 60 s from the Justice D, moving the camera slowly so the grid reaches every corner, at many tilts.",
      "Run kalibr_calibrate_cameras with the pinhole-equi (equidistant fisheye) model.",
      "Copy the focal lengths, centre and four distortion numbers from its report. A good fit is under 0.5 px."
    ],
    inputs: [
      { k: "fx", label: "fx", unit: "px", step: 0.1 }, { k: "fy", label: "fy", unit: "px", step: 0.1 },
      { k: "cx", label: "cx", unit: "px", step: 0.1 }, { k: "cy", label: "cy", unit: "px", step: 0.1 },
      { k: "k1", label: "k1", unit: "", step: 0.0001 }, { k: "k2", label: "k2", unit: "", step: 0.0001 },
      { k: "k3", label: "k3", unit: "", step: 0.0001 }, { k: "k4", label: "k4", unit: "", step: 0.0001 },
      { k: "err", label: "Reprojection error", unit: "px", step: 0.01 }
    ],
    calc: (v) => v.fx > 0 && v.fy > 0 ? { fx: v.fx, fy: v.fy, cx: v.cx || 0, cy: v.cy || 0, k1: v.k1 || 0, k2: v.k2 || 0, k3: v.k3 || 0, k4: v.k4 || 0, err: v.err || 0 } : null,
    show: (r) => `fx ${fmt(r.fx, 5)}, fy ${fmt(r.fy, 5)}${r.err ? ` · ${fmt(r.err, 2)} px error` : ""}`
  },
  {
    id: "camimu", session: "bench", name: "Camera to IMU timing",
    why: "If image times are off from gyro times by even a few ms, VIO mistakes rotation for movement.",
    sim: "Reference for the VIO setup",
    kit: ["Kalibr", "The AprilGrid", "Camera and IMU logged together on the APB"],
    steps: [
      "Log the Justice D and the APB's IMU together while waving the drone in front of the grid, all three axes, for a minute.",
      "Run kalibr_calibrate_imu_camera with the lens result from above.",
      "Read the time shift (timeshift_cam_imu, in seconds) and the camera's tilt from straight down."
    ],
    inputs: [{ k: "td", label: "Time shift", unit: "ms", step: 0.1 }, { k: "tilt", label: "Tilt from nadir", unit: "°", step: 0.1 }],
    calc: (v) => v.td != null && isFinite(v.td) ? { td: v.td, tilt: v.tilt || 0 } : null,
    show: (r) => `${fmt(r.td)} ms shift · ${fmt(r.tilt)}° tilt`
  },
  {
    id: "imu", session: "bench", name: "IMU noise",
    why: "How noisy and how drifty the gyro and accelerometer are. VIO's filter needs these four numbers.",
    sim: "Reference for the VIO setup; the sim models a typical ICM-42688",
    kit: ["The drone sitting still on a soft pad", "allan_variance_ros or a similar tool"],
    steps: [
      "Log the APB's IMU for at least 2 hours, drone powered, sitting still, nobody touching the table.",
      "Run an Allan variance tool on it and copy the four numbers it reports."
    ],
    inputs: [
      { k: "gn", label: "Gyro noise", unit: "rad/s/√Hz", step: 0.00001 },
      { k: "gw", label: "Gyro random walk", unit: "rad/s²/√Hz", step: 0.000001 },
      { k: "an", label: "Accel noise", unit: "m/s²/√Hz", step: 0.0001 },
      { k: "aw", label: "Accel random walk", unit: "m/s³/√Hz", step: 0.00001 }
    ],
    calc: (v) => v.gn > 0 && v.an > 0 ? { gn: v.gn, gw: v.gw || 0, an: v.an, aw: v.aw || 0 } : null,
    show: (r) => `gyro ${fmt(r.gn)} · accel ${fmt(r.an)}`
  },
  {
    id: "thrust", session: "stand", name: "Full thrust per motor",
    why: "How much push is left over hover for fighting gusts. The sim uses 21 N, borrowed from a similar motor.",
    sim: "Max thrust per motor, now 21 N",
    kit: ["Thrust stand, or one arm strapped to a scale with the prop pushing down", "Full battery", "Props from the drone"],
    steps: [
      "Fix one arm over the scale and zero it with the motor off.",
      "Bring that motor alone to full throttle from the flight controller's motor test for two seconds.",
      "Note the peak reading in grams and the pack voltage."
    ],
    inputs: [{ k: "g", label: "Peak reading", unit: "g", step: 1 }, { k: "v", label: "Pack voltage", unit: "V", step: 0.1 }],
    calc: (v) => v.g > 0 ? { n: v.g * G / 1000, v: v.v || 0 } : null,
    show: (r) => `${fmt(r.n)} N${r.v ? ` at ${fmt(r.v)} V` : ""}`,
    preset: (r) => ({ airframe: { maxThrust: r.n } })
  },
  {
    id: "lag", session: "stand", name: "Motor spin-up lag",
    why: "How quickly a motor answers a change. Slow motors make the hold wobble.",
    sim: "Motor lag, now 40 ms",
    kit: ["The same stand", "ESC telemetry or the flight log with RPM"],
    steps: [
      "Step one motor from 30% to 60% throttle in the motor test.",
      "In the log, find how long the RPM takes to get 63% of the way to its new speed."
    ],
    inputs: [{ k: "ms", label: "Time to 63%", unit: "ms", step: 1 }],
    calc: (v) => v.ms > 0 ? { s: v.ms / 1000 } : null,
    show: (r) => `${fmt(r.s * 1000)} ms`,
    preset: (r) => ({ airframe: { motorTau: r.s } })
  },
  {
    id: "hover", session: "air", name: "Real hover",
    why: "Our yardstick: how well the real drone holds with GNSS, and how hard it works to do it.",
    sim: "What the sim has to match",
    kit: ["A calm day, under 3 m/s", "Logging on (PX4 ulog or ArduPilot dataflash)", "A mark on the ground"],
    steps: [
      "Take off over the mark and climb to 20 m with GNSS on.",
      "Hold for 60 s without touching the sticks. Also record the Justice D the whole time.",
      "From the log, read the hover throttle, the largest distance from the start point and the wind if you have it."
    ],
    inputs: [
      { k: "alt", label: "Height", unit: "m", step: 1, value: 20 },
      { k: "thr", label: "Hover throttle", unit: "%", step: 1 },
      { k: "drift", label: "Worst drift", unit: "m", step: 0.01 },
      { k: "wind", label: "Wind", unit: "m/s", step: 0.1 }
    ],
    calc: (v) => v.drift >= 0 && v.alt > 0 ? { alt: v.alt, thr: v.thr || 0, drift: v.drift, wind: v.wind || 0 } : null,
    show: (r) => `${fmt(r.drift)} m worst at ${fmt(r.alt)} m${r.thr ? ` · ${fmt(r.thr)}% throttle` : ""}`
  },
  {
    id: "vibe", session: "air", name: "Vibration",
    why: "Shakes the camera during each frame's readout, the jello that rolling shutter turns into warp.",
    sim: "Camera mount: soft, hard or loose",
    kit: ["The hover log from above", "PlotJuggler, or PX4's flight review"],
    steps: [
      "Open the hover log's accelerometer spectrum (PSD).",
      "Note the tallest peak's frequency and the accelerometer's RMS over the hover."
    ],
    inputs: [{ k: "hz", label: "Main peak", unit: "Hz", step: 1 }, { k: "rms", label: "Accel RMS", unit: "m/s²", step: 0.01 }],
    calc: (v) => v.hz > 0 ? { hz: v.hz, rms: v.rms || 0 } : null,
    show: (r) => `${fmt(r.hz)} Hz${r.rms ? ` · ${fmt(r.rms)} m/s² RMS` : ""}`,
    preset: (r) => r.rms ? ({ mount: r.rms < 1 ? "soft" : r.rms < 4 ? "hard" : "loose" }) : null
  },
  {
    id: "drag", session: "air", name: "Drag",
    why: "How hard the wind pushes the drone, so the sim's gusts shove it the right amount.",
    sim: "Drag, now 0.045 N per (m/s)²",
    kit: ["The same calm day", "Log with GNSS speed and attitude"],
    steps: [
      "Fly straight and level at a steady speed, like 10 m/s, into the wind and back to cancel it out.",
      "From the log, read the ground speed and the pitch angle it needs to hold that speed. Average both legs."
    ],
    inputs: [{ k: "v", label: "Steady speed", unit: "m/s", step: 0.1 }, { k: "deg", label: "Pitch to hold it", unit: "°", step: 0.1 }, { k: "kg", label: "Weight", unit: "kg", step: 0.01, value: 2.9 }],
    calc: (v) => v.v > 0 && v.deg > 0 && v.kg > 0 ? { quad: Math.max(0.005, (v.kg * G * Math.tan(v.deg * Math.PI / 180) - 0.25 * v.v) / (v.v * v.v)) } : null,
    formula: "drag = m g tan(pitch), split into the sim's linear part and the rest over speed²",
    show: (r) => `${fmt(r.quad)} N per (m/s)²`,
    preset: (r) => ({ airframe: { dragQuad: r.quad } })
  },
  {
    id: "ram", session: "apb", name: "APB memory and storage",
    why: "Whether a VIO, its map and a logger fit at once.",
    sim: "Fills the gap in the hardware sheet",
    kit: ["A shell on the APB"],
    steps: ["Run free -m and note the total memory.", "Run df -h / and note the free space."],
    inputs: [{ k: "mb", label: "Total memory", unit: "MB", step: 1 }, { k: "free", label: "Free storage", unit: "GB", step: 0.1 }],
    calc: (v) => v.mb > 0 ? { mb: v.mb, free: v.free || 0 } : null,
    show: (r) => `${fmt(r.mb)} MB${r.free ? ` · ${fmt(r.free)} GB free` : ""}`
  },
  {
    id: "viotime", session: "apb", name: "VIO time per frame",
    why: "Proves our approach runs on the board. At 60 fps there are 16.7 ms per frame for everything.",
    sim: "Tells us which frame rate and resolution we can afford",
    kit: ["OpenVINS (or our pipeline) built for the APB", "The hover recording, replayed"],
    steps: [
      "Replay the hover recording into the VIO on the APB.",
      "Note the average time per frame, the worst, and the CPU load."
    ],
    inputs: [{ k: "ms", label: "Average per frame", unit: "ms", step: 0.1 }, { k: "worst", label: "Worst frame", unit: "ms", step: 0.1 }, { k: "cpu", label: "CPU load", unit: "%", step: 1 }],
    calc: (v) => v.ms > 0 ? { ms: v.ms, worst: v.worst || 0, cpu: v.cpu || 0 } : null,
    show: (r) => `${fmt(r.ms)} ms a frame${r.cpu ? ` · ${fmt(r.cpu)}% CPU` : ""}`
  }
];
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// What we could find or work out online for each item (researched November 6, 2026).
// A real measurement always wins over these.
const FOUND_TONE = { found: ["Published", "success"], derived: ["Worked out", "accent"], comparable: ["From similar drones", "accent"], none: ["Not findable", "warning"] };
const FOUND = {
  mass: { tone: "derived", value: "About 2.97 kg",
    how: "Orqa's 2,908 g with battery, plus the APB (50 g) and the Justice D (14.2 g). Only off if the AI version drops a part of the stock build.",
    src: "MRM2-10 weights, Orqa APB page, Justice D sheet", preset: { airframe: { mass: 2.97 } } },
  inertia: { tone: "comparable", value: "About 0.021 roll, 0.022 pitch, 0.038 yaw (kg m²)",
    how: "A parts model (four 120 g motors with props at 23 cm, a 1.7 kg 6S4P pack in the middle, arms and body) gives 0.019 / 0.020 / 0.034. PX4's 2 kg, 500 mm X500 model scaled to 2.97 kg and 465 mm gives 0.027 / 0.027 / 0.050. The sim's 0.024 / 0.024 / 0.042 sits inside that range.",
    src: "PX4 X500 Gazebo model, our parts model", preset: { airframe: { inertia: [0.021, 0.038, 0.022] } } },
  readout: { tone: "derived", value: "About 16 ms (14.8 µs a row at 1080p, 22.2 µs at 720p)",
    how: "Every Sony 1/2.8 inch 2 MP sensor (IMX307, 327, 462, 290) runs 60 fps with 1,125 lines of 14.8 µs at 1080p, or 750 lines of 22.2 µs at 720p, so the image takes 16.0 ms of the 16.7 ms frame either way. The sim's 13 ms guess was too kind. Only if Orqa runs a 120 fps chip slowed to 60 would it drop to about 8 ms; the LED test settles it.",
    src: "Sony IMX327 and IMX462 sheets, Linux imx290 driver timings", preset: { readout: 16 } },
  lens: { tone: "derived", value: "Starting guess fx ≈ fy ≈ 620 px at 1080p (415 px at 720p), centre mid-frame",
    how: "Worked out from the 114° / 86° / 121.5° angles. Those three don't fit one lens model (they look copied from the analog 4:3 version), so the distortion numbers still need Kalibr. Use this only as Kalibr's starting point.",
    src: "Justice D sheet" },
  camimu: { tone: "none", value: "Has to be measured",
    how: "Depends on how the APB's driver stamps frames, which nobody publishes. Expect anywhere from a few to tens of ms; Kalibr finds it in one session.",
    src: "Orqa developer site" },
  imu: { tone: "found", value: "Gyro 2.8 mdps/√Hz, accel 65 to 70 µg/√Hz (flight IMU)",
    how: "The flight controller's ICM-42688-P: gyro 4.9e-5 rad/s/√Hz, accel 6.9e-4 m/s²/√Hz. The APB's own ICM-42605: gyro 3.8 mdps/√Hz (6.6e-5 rad/s/√Hz), accel 70 µg/√Hz. Bias drift isn't published, and on a vibrating drone VIO usually needs these raised 5 to 10 times.",
    src: "TDK ICM-42688-P and ICM-42605 datasheets" },
  thrust: { tone: "comparable", value: "About 27 N peak per motor",
    how: "A similar 2814 880 kV on a 10 inch prop at 6S peaks at 2.76 kg. Orqa's own curve isn't public. The sim keeps a safer 21 N, which still leaves three times hover.",
    src: "iFlight XING 2814 880 kV data" },
  lag: { tone: "comparable", value: "About 40 to 60 ms",
    how: "Measured 5 inch quads answer in 30 to 39 ms; 10 inch props are heavier and slower, so likely a bit more. PX4's X500 model uses 12.5 ms up and 25 ms down, which is optimistic. The sim's 40 ms is a fair middle.",
    src: "Published system ID papers, PX4 X500 Gazebo model" },
  hover: { tone: "none", value: "Has to be flown",
    how: "This is our yardstick for the sim, so it has to come from our own drone on our own day.",
    src: "" },
  vibe: { tone: "derived", value: "Likely 130 to 170 Hz, blade pass twice that",
    how: "A 2814 at 880 kV on 6S lifting about 7.3 N spins roughly 8,000 to 10,000 rpm at hover. How strong it is depends on the mount, so the log still decides soft, hard or loose.",
    src: "Our estimate from the motor specs" },
  drag: { tone: "comparable", value: "About 0.02 to 0.05 N per (m/s)²",
    how: "A 10 inch quad with a big pack shows roughly 0.03 to 0.05 m² to the wind. The sim's 0.045 is at the windy end, which is the safe side for a hold.",
    src: "Our estimate from frame size" },
  ram: { tone: "found", value: "4 GB LPDDR4 RAM, 4 GB eMMC, microSD up to 512 GB",
    how: "On the Tech Specs tab of Orqa's Code on APB page. Free storage still worth a quick df -h, since the microSD is where logs land (/sdcard).",
    src: "Orqa developer site, Code on APB" },
  viotime: { tone: "comparable", value: "Likely 40 to 80 ms a frame at default settings",
    how: "OpenVINS takes 12 to 25 ms a frame on a Raspberry Pi 5, and VINS-Mono managed about 20 fps on a Pi CM4. The APB's Cortex-A53 cores are roughly 2 to 3 times slower than the CM4's. So plan VIO at 15 to 20 Hz on downscaled frames (like 640 x 360), not 60 fps, and measure to confirm.",
    src: "OpenVINS Pi 5 benchmark, VINS-Mono on Pi CM4 paper" }
};


const ASK_ORQA = `Hello Orqa team,

We're a team in the Red Team Hackathon Grand Final (Contested Battlefield Aerial Operations) and are building a simulator of the M2-AI with the Justice D and the APB ahead of the final on November 21. Could you share any of these?

1. Justice D: the sensor model, the line readout time (or total frame readout) at 720p60 and 1080p60, and the lens intrinsics and distortion.
2. M2-AI: moments of inertia, a CAD model or STEP file of the airframe, the thrust and RPM curve of the 2814 880 kV on the stock props, and motor response time.
3. APB: whether camera frames carry hardware timestamps synced to the IMU.

Anything under NDA through the Developer Program is fine. Thank you!`;

let all = [], people = {}, flash = "", openId = null, applyFn = null;
const root = () => document.getElementById("measure-body");

const latest = (id) => all.filter((r) => r.value.item === id).at(-1) || null;

async function load() {
  all = await store.list();
  render();
}

function render() {
  const host = root();
  if (!host) return;
  const done = ITEMS.filter((i) => latest(i.id)).length;
  const usable = ITEMS.filter((i) => i.preset && latest(i.id) && i.preset(latest(i.id).value.result));
  host.replaceChildren(
    el("section", { class: "card stack tight" },
      el("div", { class: "row between" },
        el("span", { class: "type-heading-sm" }, `${done} of ${ITEMS.length} measured`),
        usable.length ? el("button", { class: "small", onclick: () => useAll(usable) }, `Put ${usable.length} into the sim`) : null),
      el("progress", { max: ITEMS.length, value: done, "aria-label": "Measured so far" }),
      el("p", { class: "meta" }, done ? "The newest result for each one is what the sim uses." : "Start with the bench: weight, pendulum and the blinking LED need no flying.")),
    foundSummary(),
    ...SESSIONS.map((s) => el("section", { class: "stack" },
      el("div", { class: "stack tight" },
        el("h3", {}, s.name),
        el("p", { class: "muted" }, s.about)),
      el("ul", { class: "stack plain" }, ITEMS.filter((i) => i.session === s.id).map(itemCard)))),
    el("section", { class: "stack" },
      el("div", { class: "stack tight" },
        el("h3", {}, "Ask Orqa"),
        el("p", { class: "muted" }, "Some of this they already know. Worth a short note through the Developer Program while we measure.")),
      el("label", { class: "stack tight" }, "A note to send", el("textarea", { rows: "14", readonly: true, class: "ask-orqa" }, ASK_ORQA))),
    flash ? el("p", { class: "meta", role: "status" }, flash) : null
  );
}

function itemCard(it) {
  const last = latest(it.id);
  const tries = all.filter((r) => r.value.item === it.id);
  const open = openId === it.id;
  return el("li", { class: "card stack tight measure-item" + (last ? " measured" : "") },
    el("div", { class: "row between" },
      el("h4", {}, it.name),
      last ? el("span", { class: "chip success" }, it.show(last.value.result)) : el("span", { class: "chip warning" }, "Not measured")),
    el("p", {}, it.why),
    el("p", { class: "meta" }, "In the sim: ", it.sim),
    foundBlock(it, last),
    el("details", { open: open || null, ontoggle: (e) => { if (e.target.open) openId = it.id; else if (openId === it.id) openId = null; } },
      el("summary", {}, last ? "Measure again" : "How to measure it"),
      el("div", { class: "stack measure-how" },
        el("div", { class: "stack tight" },
          el("span", { class: "eyebrow" }, "You need"),
          el("ul", { class: "stack tight" }, it.kit.map((k) => el("li", {}, k)))),
        el("div", { class: "stack tight" },
          el("span", { class: "eyebrow" }, "Steps"),
          el("ol", { class: "stack tight" }, it.steps.map((k) => el("li", {}, k)))),
        entry(it))),
    tries.length ? el("details", {},
      el("summary", { class: "meta" }, tries.length === 1 ? "1 result" : `${tries.length} results`),
      el("ul", { class: "stack tight plain" }, tries.slice().reverse().map((r) => el("li", { class: "row between" },
        el("span", {}, it.show(r.value.result),
          el("span", { class: "meta" }, ` · ${people[r.author_id] || "Someone"}, ${when(r.updated_at)}${r.value.note ? ` · ${r.value.note}` : ""}`)),
        el("button", { class: "ghost small", "aria-label": `Remove this ${it.name.toLowerCase()} result`, onclick: () => guard(() => store.remove(r.id)) }, "Remove"))))) : null,
    last && it.preset && it.preset(last.value.result)
      ? el("div", {}, el("button", { class: "secondary small", onclick: () => useAll([it]) }, "Fly the sim with this")) : null);
}

function foundBlock(it, last) {
  const f = FOUND[it.id];
  if (!f) return null;
  return el("div", { class: "stack tight measure-found" },
    el("div", { class: "row between" },
      el("span", { class: "eyebrow" }, last ? "Found online, to compare" : "Found online"),
      el("span", { class: "chip " + FOUND_TONE[f.tone][1] }, FOUND_TONE[f.tone][0])),
    el("p", { class: "type-label-lg" }, f.value),
    el("p", { class: "meta" }, f.how),
    f.src ? el("p", { class: "meta faint" }, "Sources: ", f.src) : null);
}

function foundSummary() {
  const n = (t) => ITEMS.filter((i) => FOUND[i.id]?.tone === t).length;
  const open = ITEMS.filter((i) => FOUND[i.id]?.preset && !latest(i.id));
  return el("div", { class: "card stack tight" },
    el("span", { class: "eyebrow" }, "Researched November 6"),
    el("h3", {}, "What we could find without the drone"),
    el("p", { class: "muted" }, `${n("found")} published, ${n("derived")} worked out from the spec sheets, ${n("comparable")} from similar drones and ${n("none")} that only our own drone can tell us. The biggest change: the Justice D most likely takes about 16 ms to read a frame, not the 13 ms the sim guessed.`),
    open.length ? el("div", {}, el("button", { class: "secondary small", onclick: () => useFound(open) },
      `Fly the sim with what we found (${open.map((i) => i.id === "mass" ? "weight" : i.id === "readout" ? "readout" : "inertia").join(", ")})`)) : null);
}

function useFound(items) {
  const p = {};
  for (const it of items) {
    const r = FOUND[it.id].preset;
    if (r.airframe) p.airframe = { ...(p.airframe || {}), ...r.airframe };
    if (r.readout != null) p.readout = r.readout;
  }
  applyFn?.(p);
}

function entry(it) {
  const vals = {};
  const out = el("p", { class: "type-label-lg", "aria-live": "polite" });
  const note = el("input", { type: "text", maxlength: "200", placeholder: "Optional, like 'second try, new strings'" });
  const save = el("button", { class: "small", disabled: true }, "Save the result");
  const update = () => {
    const r = it.calc(vals);
    out.textContent = r ? `= ${it.show(r)}` : "Fill in the numbers to see the result.";
    save.disabled = !r;
  };
  const fields = it.inputs.map((f) => {
    const input = el("input", { type: "number", step: String(f.step), inputmode: "decimal", value: f.value ?? null });
    if (f.value != null) vals[f.k] = f.value;
    input.addEventListener("input", () => { vals[f.k] = input.value === "" ? undefined : +input.value; update(); });
    return el("label", { class: "stack tight" }, `${f.label}${f.unit ? ` (${f.unit})` : ""}`, input);
  });
  save.addEventListener("click", () => {
    const result = it.calc(vals);
    if (!result) return;
    const inputs = Object.fromEntries(Object.entries(vals).filter(([, v]) => v != null && isFinite(v)));
    guard(async () => {
      await store.add({ item: it.id, inputs, result, note: note.value.trim() });
      openId = null; flash = "";
    });
  });
  update();
  return el("div", { class: "stack tight measure-entry" },
    el("span", { class: "eyebrow" }, "Your numbers"),
    el("div", { class: "measure-fields" }, fields),
    it.formula ? el("p", { class: "meta" }, it.formula) : null,
    out,
    el("label", { class: "stack tight" }, "Note", note),
    el("div", {}, save));
}

function useAll(items) {
  const p = { airframe: {} };
  for (const it of items) {
    const r = it.preset(latest(it.id).value.result);
    if (!r) continue;
    if (r.airframe) {
      if (r.airframe.inertia) {
        const was = p.airframe.inertia || [null, null, null];
        p.airframe.inertia = r.airframe.inertia.map((v, i) => v || was[i]);
      }
      Object.assign(p.airframe, { ...r.airframe, inertia: p.airframe.inertia });
      if (!p.airframe.inertia) delete p.airframe.inertia;
    }
    if (r.readout != null) p.readout = r.readout;
    if (r.mount) p.mount = r.mount;
  }
  if (!Object.keys(p.airframe).length) delete p.airframe;
  applyFn?.(p);
}

async function guard(fn) { try { await fn(); } catch (e) { flash = e.message; render(); } }

store.subscribe(load);
const [list, members] = await Promise.all([store.list(), ambition.members().catch(() => [])]);
all = list;
people = Object.fromEntries(members.map((m) => [m.id, m.name]));

export function showMeasure(onApply) {
  applyFn = onApply;
  render();
}
export const measureItems = ITEMS.map((i) => i.id);
export { BY_ID as MEASURE_ITEMS };
