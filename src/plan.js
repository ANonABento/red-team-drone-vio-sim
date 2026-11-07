// What we found researching each starting question (November 2026). Shown under the question.
const SRC = {
  brief: "Grand Final page",
  apb: "Orqa APB developer page",
  mrm: "Orqa MRM2-10",
  mrmw: "MRM2-10 weights and flight times",
  ai: "MRM2-10AI launch",
  justice: "Justice D spec sheet",
  ovrs: "Rolling shutter in OpenVINS (ModalAI)",
  kalibr: "Kalibr calibration toolbox",
  px4sim: "PX4 simulation",
  apgz: "ArduPilot with Gazebo",
  survey: "Survey of drone simulators",
  rsdirect: "Rolling shutter VIO paper (TUM)",
  ctrl: "Ctrl-VIO paper",
  mrmh: "Drone integration handbook (MRM2-10)",
  alan: "Agencija Alan MRM2-10 sheet",
  xing: "iFlight XING 2814 880 kV data",
  apbdev: "Orqa developer site, Code on APB",
  x500: "PX4 X500 Gazebo model and published system ID",
  imx: "Sony IMX327 / IMX462 sheets and Linux imx290 timings",
  tdk: "TDK ICM-42688-P and ICM-42605 datasheets"
};

// The hardware as far as public sources go (researched November 6, 2026).
const SPEC_TONE = { published: ["Published", "success"], comparable: ["Comparable part", "accent"], derived: ["Worked out", "accent"], unknown: ["Not published", "warning"] };
const SPECS = [
  { name: "Orqa M2-AI (MRM2-10AI)", about: "The AI version of Orqa's MRM2-10, launched June 2026 with the APB on board. Orqa publishes the base MRM2-10's numbers; nothing extra for the AI version yet.", rows: [
    ["Frame", "Carbon fibre, 465 mm wheelbase, 10 inch two-blade props", "published", "mrm"],
    ["Weight", "1,186 g without battery, 2,908 g with battery. Frame alone 478 g", "published", "mrmw"],
    ["Battery", "6S4P Li-ion, about 16 Ah (some sheets list a 6S 7,000 mAh LiPo instead, 868 g)", "published", "mrmh"],
    ["With APB and Justice D", "About 2.97 kg, if they add to the published 2,908 g (APB 50 g, camera 14 g). The sim uses 2.9 kg", "derived", "apb"],
    ["Motors", "Orqa 2814, 880 kV, on a 70 A 4-in-1 ESC running AM32", "published", "mrm"],
    ["Thrust per motor", "Orqa doesn't publish it. A similar 2814 880 kV motor peaks at 2.76 kg (27 N). The sim plays it safe with 21 N", "comparable", "xing"],
    ["Hover", "At 2.9 kg each motor lifts about 7.1 N, roughly a third of full thrust", "derived", "mrmw"],
    ["Flight controller", "H743 QuadCore with an ICM-42688 IMU; runs PX4, ArduPilot, iNav or Betaflight", "published", "mrm"],
    ["Endurance", "42 min with no payload, 130 km/h top speed", "published", "mrmw"],
    ["Inertia", "Not public. A parts model and PX4's X500 scaled up both put it near 0.02 roll and pitch, 0.04 yaw (kg m²); the pendulum will pin it down", "comparable", "x500"],
    ["Motor lag, drag", "Not public. Similar drones suggest 40 to 60 ms and 0.02 to 0.05 N per (m/s)²; a hover log will tell", "comparable", "x500"],
    ["CAD", "Not public. Ask through Orqa's Developer Program", "unknown", "ai"]
  ] },
  { name: "Justice D camera", about: "The extra nadir camera fitted for the challenge. The stock MRM2-10 carries the analog Justice; this is the digital one.", rows: [
    ["Sensor", "Sony 1/2.8 inch CMOS, rolling shutter. Exact chip not named", "published", "justice"],
    ["Video", "1920 x 1080 or 1280 x 720, at 60 fps, 16:9", "published", "justice"],
    ["Field of view", "114\u00b0 across, 86\u00b0 up and down, 121.5\u00b0 corner to corner", "published", "justice"],
    ["Low light", "Down to 0.003 lux, 88 dB WDR, day and night modes", "published", "justice"],
    ["Body", "22 x 22 x 30 mm, 14.2 g, four M2 inserts, 0.66 W, \u221240 to 85 \u00b0C", "published", "justice"],
    ["Ground per pixel", "About 1.7 mm per metre of height at 1080p: 8.6 cm a pixel at 50 m", "derived", "justice"],
    ["Readout time", "Not published, but every Sony 1/2.8 inch 2 MP sensor at 60 fps reads a frame in about 16 ms (14.8 µs a row at 1080p). Film a blinking LED to confirm", "derived", "imx"],
    ["Lens distortion", "Not published. The angles suggest fx near 620 px at 1080p as a start; calibrate the bend with Kalibr's fisheye model", "unknown", "kalibr"]
  ] },
  { name: "APB (Auto Pilot Board)", about: "Flight controller and a small Linux computer on one board. Our VIO has to run here.", rows: [
    ["Linux side", "NXP i.MX8M Plus: Cortex-A53 cores (4 or 2), a Cortex-M7, 2.25 TOPS NPU, 4 GB eMMC", "published", "apbdev"],
    ["Flight side", "STM32H743; PX4, ArduPilot, Betaflight or iNav", "published", "apbdev"],
    ["Cameras", "Two MIPI-CSI ports, one with an analog-to-MIPI adapter", "published", "apbdev"],
    ["Sensors", "ICM-42605 IMU and DPS310 barometer on the Linux side", "published", "apbdev"],
    ["Video", "H.265 and H.264 encoder, 1080p at 60 fps", "published", "apbdev"],
    ["Board", "65 x 40 mm, 50 g, 12 to 24 V (40 V max) or USB-C up to 60 W", "published", "apb"],
    ["Memory", "4 GB LPDDR4 RAM, 4 GB eMMC, microSD up to 512 GB", "published", "apbdev"],
    ["IMUs", "Flight: ICM-42688-P, gyro 2.8 mdps/√Hz, accel 70 µg/√Hz. Linux side: ICM-42605, gyro 3.8 mdps/√Hz, accel 70 µg/√Hz", "published", "tdk"]
  ] }
];
const BASIS = {
  found: ["From spec sheets", "success"],
  estimate: ["Our best estimate", "accent"],
  wait: ["Check against the tech spec", "warning"]
};
const RESEARCH = {
  "ch-metric": {
    basis: "wait",
    answer: "Score each hold on how far the drone wanders from its start point (worst and average), how much it jitters, and how long it stays inside a radius. Use a stand-in like 1 m for 60 s until the real thresholds arrive.",
    points: [
      "Horizontal drift: the largest and the RMS distance from the hold point over the window, measured against the sim's ground truth.",
      "Stability: position and attitude jitter (standard deviation), plus height error from the target altitude.",
      "Pass or fail per altitude: stays inside the radius for the whole window. Make the radius and the window settings, so the real numbers drop in when the spec lands on November 18, 72 hours before the final on the 21st.",
      "Log everything per run so we can compare pipelines on the same seeds and the same wind."
    ],
    sources: ["brief"]
  },
  "ch-ceiling": {
    basis: "estimate",
    answer: "Climb a ladder (5, 10, 20, 30, 50, 75, 100 m), hold at each rung, and plot drift against height. VIO breaks where a drift worth caring about shrinks to about a pixel.",
    points: [
      "On the Justice D at 1080p, one pixel covers roughly 1.7 mm of ground per metre of height (86 degree vertical view over 1080 rows). At 50 m that is about 8.6 cm a pixel, so a 10 cm drift moves the image by barely one pixel. At 720p it is about 2.6 mm per metre.",
      "Height also lets the barometer carry altitude while VIO only has to hold the horizontal position, which helps.",
      "Canada's normal drone ceiling is 122 m (400 ft) above ground, so the trial likely tops out there or lower.",
      "In the sim, keep everything else equal at each rung so the only thing changing is altitude."
    ],
    sources: ["justice"]
  },
  "ch-pipeline": {
    basis: "estimate",
    answer: "Bet on an OpenVINS-style filter (MSCKF): it is the lightest proper VIO, runs monocular, and has a fork that models rolling shutter. Keep a simple downward optical flow plus barometer hold as plan B.",
    points: [
      "OpenVINS (filter based): cheap enough for the APB's Cortex-A53 cores. ModalAI's version stamps each image row with its own time and supports rolling shutter cameras.",
      "VINS-Mono / VINS-Fusion (optimisation based): more accurate but heavier; VINS-Mono has a rolling shutter readout setting.",
      "Basalt: fast, but built for global shutter cameras.",
      "Ctrl-VIO and other continuous-time methods handle rolling shutter best, and are likely too heavy for this board.",
      "Plan B: over flat ground with a nadir camera, the image motion between frames is close to a simple warp. Optical flow, de-rotated with the gyro and scaled by barometer height, gives velocity, and integrating it gives a position hold. Cruder, but very robust and cheap."
    ],
    sources: ["ovrs", "ctrl", "apb"]
  },
  "ch-recovery": {
    basis: "estimate",
    answer: "Watch tracked feature count, the filter's uncertainty and how much VIO disagrees with the IMU. When it degrades, fall back to holding attitude and barometer altitude, descend toward better texture, and restart VIO.",
    points: [
      "Health signals: number of tracked features, reprojection error, growing covariance, chi-square test failures, image brightness and blur.",
      "Recovery ladder: drop to altitude hold on attitude and barometer (the flight controller does this natively), slow descent where features are bigger, reinitialise VIO, then climb back.",
      "In the sim, break it on purpose: a blank or snowy patch, motion blur, a sudden light change, frozen or dropped frames, a vibration spike, a strong gust.",
      "This is also one of the three presentation points, so logging these events makes good slides."
    ],
    sources: ["brief"]
  },
  "ch-where": {
    basis: "estimate",
    answer: "The real sim runs on a Linux machine: Gazebo with PX4 or ArduPilot SITL, so our actual VIO and flight controller code fly in it. A browser preview here can only help us get a feel for things.",
    points: [
      "The APB's flight controller runs PX4 or ArduPilot, and both have official Gazebo (Harmonic) setups with camera, IMU, GPS and barometer sensors.",
      "SITL means the real autopilot software runs on the laptop against the simulated drone, in lockstep with it.",
      "Run the VIO in an ARM container or on a spare i.MX8M Plus board to see whether it keeps up with the APB's compute.",
      "If we later want photorealistic scanned worlds, Isaac Sim with the Pegasus extension also drives PX4, but needs an NVIDIA RTX GPU.",
      "With 16 days to the final, a suggested order: drone in Gazebo first (it is mostly off-the-shelf), then the rolling shutter camera, then a better ground."
    ],
    sources: ["px4sim", "apgz", "survey"]
  },
  "drone-cad": {
    basis: "found",
    answer: "No public CAD. The M2-AI looks like Orqa's MRM2-10AI, the AI version of their MRM2-10, launched June 2026 with the APB. The MRM2-10's published numbers are enough to start the physics.",
    points: [
      "10 inch two-blade props, 465 mm wheelbase, Orqa 2814 motors at 880 kV, 70 A 4-in-1 ESC on AM32.",
      "About 1.19 kg without battery and 2.9 kg with its 6S4P Li-ion pack (about 16 Ah). The frame alone is 478 g. The APB board itself weighs 50 g.",
      "Inertia: estimate from a simple box-and-arms model, or measure with a bifilar (two string) pendulum when we have the drone.",
      "Thrust curve: use 10 inch prop data for a 2814 880 kV motor, and check it against hover throttle from a real flight log.",
      "Ask Orqa through their Developer Program for CAD or mass properties; it costs nothing to ask."
    ],
    sources: ["ai", "mrm", "mrmw", "apb"]
  },
  "drone-nav": {
    basis: "estimate",
    answer: "Four modes, all switchable mid-flight: full, degraded (more noise and dropouts), spoofed (a slow believable drift, the dangerous one) and denied. The trial will likely start with GNSS and then lose it.",
    points: [
      "Both autopilots inject GPS faults in SITL: ArduPilot has SIM_GPS_DISABLE and glitch settings, PX4 has failure injection (failure gps off).",
      "Spoofing is the sneaky case: position slowly walks away while looking healthy. The EKF should be set to trust VIO over GPS (in ArduPilot, EK3_SRC set to ExternalNav).",
      "Degraded: raise noise to several metres, drop satellites, add random gaps.",
      "Test the handover moment itself, since that is when a hold often jumps."
    ],
    sources: ["px4sim", "apgz"]
  },
  "drone-imu": {
    basis: "estimate",
    answer: "Model each axis as white noise plus a slowly wandering bias, then add motor vibration as sine waves at the motor speed and prop blade-pass frequency. Use the APB's own IMU for VIO, since it shares the camera's clock.",
    points: [
      "The APB carries an ICM-42605 IMU and DPS310 barometer on the Linux side; the MRM2-10's flight controller uses an ICM-42688.",
      "Noise numbers: start from the datasheet, then refine with an Allan variance from a few hours of the real IMU sitting still (Kalibr's format).",
      "Vibration: at hover a 2814 at 880 kV on 6S probably spins around 8,000 to 10,000 rpm, so roughly 130 to 170 Hz, with blade-pass at twice that. A real hover log's spectrum will tell us exactly.",
      "That vibration is also what makes the rolling shutter wobble, so the camera stage reuses it."
    ],
    sources: ["apb", "mrm", "kalibr"]
  },
  "drone-physics": {
    basis: "estimate",
    answer: "Start with a rigid body: thrust and torque that grow with prop speed squared, a short motor lag, drag, and gusty wind. Add battery sag next; skip ground effect, it only matters below about half a metre.",
    points: [
      "Gazebo's multicopter motor model already covers thrust, torque, motor lag and drag.",
      "Wind: a steady wind plus gusts (a Dryden turbulence model is standard). It matters a lot for hold quality at altitude.",
      "Battery sag changes hover throttle across a long hold, so it is worth a simple voltage model.",
      "Ground effect, blade flapping and prop wash on the ground can wait."
    ],
    sources: ["px4sim", "apgz"]
  },
  "drone-mount": {
    basis: "wait",
    answer: "We won't know exactly until we see the vehicle. Measure the camera's position and angle relative to the IMU, then let calibration refine it, including the time offset.",
    points: [
      "The Justice D is a 22 x 22 mm camera with four M2 mounting inserts, 14.2 g.",
      "Three numbers matter: the lever arm (camera offset from IMU), the rotation (nadir, maybe slightly tilted) and the time offset between camera and IMU.",
      "Kalibr calibrates all three, and OpenVINS or VINS can also estimate the time offset while flying.",
      "Hard mount means more jello; soft mount means the camera wobbles relative to the IMU. Make the mount stiffness a setting in the sim."
    ],
    sources: ["justice", "kalibr"]
  },
  "env-site": {
    basis: "wait",
    answer: "Not published. The final is November 21 at the Canadian War Museum in Ottawa, 5:30 to 8:00 PM, after sunset, so plan for dark or floodlit ground, dead grass, snow, asphalt or an indoor floor until we hear otherwise.",
    points: [
      "Sunset in Ottawa that day is around 4:25 PM, so an evening flight means low light: more noise, longer exposure, more blur.",
      "Late November in Ottawa can mean early snow, which is close to featureless from above.",
      "The flying might happen at a different time or place from the evening event; worth asking the organisers.",
      "Build the sim so the ground is swappable: grass, gravel, asphalt, snow, an indoor floor."
    ],
    sources: ["brief"]
  },
  "env-scan": {
    basis: "estimate",
    answer: "The camera only looks straight down, so an orthophoto (a top-down photo map) plus a height map on a ground plane gets most of the realism for little work. Full 3D scans matter only if there are buildings or trees in view.",
    points: [
      "Capture: fly a phone or small drone in a grid over a similar site and stitch it with OpenDroneMap (free), Agisoft or RealityCapture.",
      "That gives an orthophoto and a height map, or a full textured mesh if we want it.",
      "Gaussian splats look the most real, but don't drop into Gazebo easily; save them for later.",
      "City orthophotos are usually 5 to 15 cm a pixel: fine for high-altitude rungs, too coarse for low ones."
    ],
    sources: ["survey"]
  },
  "env-detail": {
    basis: "estimate",
    answer: "The ground texture has to be finer than what one camera pixel sees at our lowest altitude: about 3.5 mm at 2 m, 1.7 cm at 10 m and 8.6 cm at 50 m. Layer a fine tiling texture under a coarser photo map.",
    points: [
      "Rule of thumb from the Justice D's view: ground per pixel is about 1.7 mm times the height in metres at 1080p.",
      "Fine detail (grass blades, gravel) as a repeating texture of a few millimetres a pixel, blended with a 5 to 10 cm orthophoto for the big picture.",
      "Watch out for obvious repetition in tiled textures: VIO can lock onto the wrong copy."
    ],
    sources: ["justice"]
  },
  "env-conditions": {
    basis: "estimate",
    answer: "Most worth simulating: low light, the drone's own shadow, auto-exposure jumps, low-texture patches like snow, and wind. Grass moving in prop wash matters only near the ground.",
    points: [
      "Low light: higher noise and longer exposure, so more blur. Likely at an evening event in November.",
      "The drone's shadow moves with it and can fool feature tracking at low altitude.",
      "Exposure and WDR adjustments change brightness between frames.",
      "Uniform patches (snow, fresh asphalt, painted floor) starve VIO of features. Good for the recovery tests.",
      "Wind moves the drone, which forces the hold to work, and shakes the camera."
    ],
    sources: ["justice"]
  },
  "cam-sensor": {
    basis: "found",
    answer: "Sony 1/2.8 inch CMOS, 1920 x 1080 or 1280 x 720 at 60 fps, 114 degree horizontal and 86 degree vertical view (121.5 diagonal). Readout time, exposure and lens model aren't published, so we measure them.",
    points: [
      "Also: 88 dB WDR, works down to 0.003 lux, 0.66 W, 14.2 g, 22 x 22 x 30 mm.",
      "Readout time: at 60 fps it is probably most of the 16.7 ms frame, roughly 10 to 15 ms. Measure it by filming a fast blinking LED or calibrating with Kalibr's rolling shutter mode.",
      "Lens: a view this wide has strong barrel distortion, so use a fisheye (Kannala-Brandt / equidistant) model and calibrate it.",
      "The APB takes cameras over MIPI-CSI, and one port converts analog video. If we end up on the analog path the image is interlaced, which is another artefact to model."
    ],
    sources: ["justice", "apb", "kalibr"]
  },
  "cam-effects": {
    basis: "estimate",
    answer: "For a hover, the order is: jello from prop vibration, skew from the drone's small rotations, blur in low light, then brightness jumps from auto exposure. Skew from moving sideways is small when holding still.",
    points: [
      "Jello: vibration at 100 to 300 Hz is faster than the frame, so straight lines wobble within a single image.",
      "Rotation skew: at 1 rad/s with a 15 ms readout, the bottom of the frame sees the world about 0.9 degrees later than the top, roughly 10 pixels at 1080p.",
      "Blur grows with exposure, which grows in low light.",
      "If the video goes through the H.264/H.265 encoder before VIO, compression blocks also cost features."
    ],
    sources: ["justice", "rsdirect"]
  },
  "cam-model": {
    basis: "estimate",
    answer: "Since the camera looks at nearly flat ground, warping each row of a normal render to that row's pose is close to exact and cheap. Render in time slices only where there's height (buildings, trees).",
    points: [
      "Per-row warp: render a global shutter image, then for each row apply the ground-plane warp for the drone's pose at that row's time.",
      "Time-sliced rendering: render 16 to 32 sub-frames per frame and stitch bands of rows. Handles 3D scenes correctly, at 16 to 32 times the cost.",
      "Blur: average a few sub-exposures. Then add the lens distortion, noise, vignetting and compression.",
      "Keep the readout time a setting so we can sweep it and see where VIO breaks."
    ],
    sources: ["rsdirect", "ovrs"]
  },
  "cam-output": {
    basis: "estimate",
    answer: "Yes: frames at 60 fps stamped at the middle row's mid-exposure, IMU at 200 to 1000 Hz, barometer and ground truth, recorded as ROS 2 bags, and the same streams fed live into our VIO.",
    points: [
      "Live loop: VIO output goes to the flight controller as MAVLink vision position or odometry messages, exactly as on the real drone.",
      "Recordings: ROS 2 bags plus EuRoC-style folders so we can replay the same flight into different pipelines.",
      "Scoring: compare VIO against ground truth with the evo tool (drift and relative error).",
      "Pixel time for row m of M: frame time + readout x (m / M - 0.5). Our VIO needs the same convention as the sim."
    ],
    sources: ["ovrs", "kalibr"]
  }
};
const GLOSSARY = [
  ["GNSS", "Satellite positioning (GPS and friends). The trial jams or switches it off."],
  ["VIO", "Visual-inertial odometry: working out how the drone moved from camera images plus the motion sensor (IMU)."],
  ["IMU", "Gyroscope and accelerometer. Fast and smooth, but drifts on its own."],
  ["Rolling shutter", "The sensor reads its rows one after another, so a moving or shaking camera bends the picture. Global shutter captures every row at once."],
  ["Nadir", "Pointing straight down."],
  ["Drift", "How far the estimated position wanders from the truth over time."],
  ["SITL", "Software in the loop: the real autopilot code flies a simulated drone on a computer."],
  ["APB", "Orqa's Auto Pilot Board: flight controller plus a small Linux computer (i.MX8M Plus, 2.25 TOPS NPU) where our VIO must run."]
];
const STAGES = [
  {
    id: "challenge", name: "The challenge",
    blurb: "Contested Battlefield Aerial Operations, Red Team Hackathon Grand Final. Hold an Orqa M2-AI stable over a fixed point with GNSS degraded or off, using VIO from a nadir Justice D rolling shutter FPV camera and the APB's onboard compute. Highest stable altitude wins the live trial; a presentation covers fusion, rolling shutter handling, APB use and VIO failure recovery. The final is November 21, 2026 at the Canadian War Museum in Ottawa; the full spec lands 72 hours before.",
    prompts: [
      ["ch-metric", "What will the sim score us on before the spec arrives: drift radius and stability over time, at each altitude?"],
      ["ch-ceiling", "What altitudes do we test, and how do we find the point where VIO breaks down?"],
      ["ch-pipeline", "Which VIO pipeline are we betting on (OpenVINS, VINS-Fusion, Basalt, our own), and does it model rolling shutter?"],
      ["ch-recovery", "How do we detect VIO degrading and recover, and how will the sim make that happen on purpose?"],
      ["ch-where", "Where does the sim run: a quick browser preview here, or Gazebo / Isaac / AirSim with PX4 SITL and our real stack in the loop?"]
    ]
  },
  {
    id: "drone", name: "Drone",
    blurb: "The Orqa M2-AI from CAD, GNSS we can switch on, degrade or kill, and flight physics close enough that a position hold tuned in sim holds in the air.",
    prompts: [
      ["drone-cad", "Do we have M2-AI CAD or measurements? The physics needs mass, inertia, arm length, prop and motor thrust curves."],
      ["drone-nav", "Which GNSS modes: full, degraded (noise, dropouts), spoofed, fully denied? Switchable mid-flight?"],
      ["drone-imu", "How do we model the IMU: noise, bias drift, and motor vibration feeding into it?"],
      ["drone-physics", "How deep should the physics go: rigid body with thrust and drag, plus wind gusts, ground effect, battery sag?"],
      ["drone-mount", "Where exactly does the nadir Justice D mount, and what's its offset and timing to the IMU?"]
    ]
  },
  {
    id: "environment", name: "Environment",
    blurb: "Ground texture under a nadir camera is what VIO lives on. A high-fidelity world, maybe scanned, that matches the trial site.",
    prompts: [
      ["env-site", "What surface will we hover over: grass, tarmac, gravel, a field with few features? Do we know the site?"],
      ["env-scan", "How do we capture it: drone photogrammetry, Gaussian splats, or high-res orthophoto plus height map?"],
      ["env-detail", "What ground resolution keeps features visible up to our target altitude?"],
      ["env-conditions", "Lighting, shadows, wind, moving grass, low-texture patches to stress VIO?"]
    ]
  },
  {
    id: "camera", name: "Camera",
    blurb: "The Justice D: a cheap FPV rolling shutter sensor, fixed nadir. The sim has to break VIO the way the real one does.",
    prompts: [
      ["cam-sensor", "Justice D specs: resolution, frame rate, line readout time, exposure, FOV and lens distortion?"],
      ["cam-effects", "Which artefacts matter most: skew under yaw and translation, jello from prop vibration, motion blur, auto exposure?"],
      ["cam-model", "Do we render each row at its own time (true rolling shutter) or warp global shutter frames afterwards?"],
      ["cam-output", "What comes out: frames plus IMU at real rates into our VIO, logged as rosbags, with ground truth to measure drift?"]
    ]
  }
];
const FOCUSABLE = ["drone", "environment", "camera"];
const KIND_LABEL = { idea: "Idea", question: "Question", decision: "Decision" };
const KIND_TONE = { idea: "", question: "warning", decision: "success" };

const notes = ambition.collection("notes");
const plan = ambition.collection("plan");
const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

let all = [];
let planRec = null;
let current = "challenge";
let answering = null; // prompt id the form is answering
let flash = "";

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
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

async function load() {
  const [n, p] = await Promise.all([notes.list(), plan.list()]);
  all = n;
  planRec = p[0] || null;
  render();
}

function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(...STAGES.map((s, i) => {
    const count = all.filter((r) => r.value.stage === s.id).length;
    const focus = planRec?.value.focus === s.id;
    return el("button", {
      class: s.id === current ? "small" : "small secondary",
      "aria-current": s.id === current ? "page" : false,
      onclick: () => go(s.id)
    }, i ? `${i}. ${s.name}` : s.name, count ? ` \u00b7 ${count}` : "", focus ? " \u25cf" : "");
  }));
}

function noteItem(r) {
  const v = r.value;
  const mine = r.author_id === me.id;
  return el("li", { class: "card stack tight note" + (v.done ? " done" : "") },
    el("div", { class: "row between" },
      el("div", { class: "row" },
        el("span", { class: "chip " + (KIND_TONE[v.kind] || "") }, KIND_LABEL[v.kind]),
        v.done ? el("span", { class: "chip success" }, "Settled") : null),
      el("span", { class: "meta" }, `${names[r.author_id] || "Someone"} \u00b7 ${when(r.updated_at)}`)),
    el("p", { class: "note-text" }, v.text),
    el("div", { class: "row" },
      v.kind === "question" ? el("button", { class: "ghost small", onclick: () => toggleDone(r) }, v.done ? "Reopen" : "Mark settled") : null,
      v.kind !== "decision" ? el("button", { class: "ghost small", onclick: () => makeDecision(r) }, "Make it a decision") : null,
      mine ? el("button", { class: "ghost small", onclick: () => removeNote(r) }, "Remove") : null));
}

function render() {
  renderTabs();
  const s = STAGES.find((x) => x.id === current);
  const mine = all.filter((r) => r.value.stage === s.id);
  const byPrompt = (pid) => mine.filter((r) => r.value.prompt === pid);
  const loose = mine.filter((r) => !r.value.prompt)
    .sort((a, b) => (b.value.kind === "decision") - (a.value.kind === "decision"));
  const decisions = mine.filter((r) => r.value.kind === "decision" && !(r.value.prompt && RESEARCH[r.value.prompt]?.answer === r.value.text)).length
    + s.prompts.filter(([pid]) => RESEARCH[pid] && !overridden(RESEARCH[pid], byPrompt(pid))).length;
  const root = document.getElementById("stage");

  const focusRow = FOCUSABLE.includes(s.id)
    ? (planRec?.value.focus === s.id
      ? el("span", { class: "chip accent" }, "Building this first")
      : el("button", { class: "secondary small", onclick: () => setFocus(s.id) }, "Build this stage first"))
    : null;

  root.replaceChildren(...[
    el("div", { class: "stack tight" },
      el("div", { class: "row between" }, el("h2", {}, s.name), focusRow),
      el("p", {}, s.blurb),
      el("p", { class: "meta" }, `${decisions} decided \u00b7 ${s.prompts.filter(([pid]) => RESEARCH[pid] || byPrompt(pid).length).length} of ${s.prompts.length} starting questions answered`)),
    el("section", { class: "stack" },
      el("h3", {}, "Starting questions"),
      el("ol", { class: "stack prompts" }, s.prompts.map(([pid, q]) => {
        const answers = byPrompt(pid);
        return el("li", { class: "card stack tight" },
          el("p", { class: "type-label-lg" }, q),
          researchBlock(s.id, pid, answers),
          answers.length ? el("ul", { class: "stack tight plain" }, answers.map(noteItem)) : null,
          answering === pid ? form(s.id, pid) :
            el("div", {}, el("button", { class: "secondary small", onclick: () => { answering = pid; render(); focusForm(); } }, answers.length ? "Add another answer" : "Answer")));
      }))),
    s.id === "challenge" ? specSheet() : null,
    s.id === "challenge" ? glossary() : null,
    el("section", { class: "stack" },
      el("h3", {}, "Ideas and decisions"),
      loose.length ? el("ul", { class: "stack plain" }, loose.map(noteItem))
        : el("p", { class: "empty" }, "Nothing here yet. What's on your mind for this stage?"),
      answering === null ? form(s.id, null) : null),
    flash ? el("p", { class: "meta", role: "status" }, flash) : null
  ].filter(Boolean));
}

function researchBlock(stage, pid, answers) {
  const r = RESEARCH[pid];
  if (!r) return null;
  const [label, tone] = BASIS[r.basis];
  return el("div", { class: "research stack tight" },
    el("div", { class: "row between" },
      el("span", { class: "eyebrow" }, "What we found"),
      el("span", { class: "chip " + tone }, label)),
    el("p", { class: "research-answer" }, r.answer),
    el("details", {},
      el("summary", {}, "The details"),
      el("ul", { class: "stack tight research-points" }, r.points.map((t) => el("li", {}, t))),
      el("div", { class: "row sources" },
        el("span", { class: "meta" }, "Sources:"),
        el("span", { class: "meta" }, r.sources.map((k) => SRC[k]).join(" \u00b7 ")))),
    overridden(r, answers) ? el("span", { class: "chip" }, "We decided differently, see below")
      : el("span", { class: "chip success" }, "Going with this for now"));
}

function overridden(r, answers) {
  return answers.some((a) => a.value.kind === "decision" && a.value.text !== r.answer);
}

function specSheet() {
  const missing = SPECS.reduce((n, g) => n + g.rows.filter((r) => r[2] === "unknown").length, 0);
  return el("section", { class: "stack", id: "specs" },
    el("div", { class: "stack tight" },
      el("span", { class: "eyebrow" }, "Researched November 6"),
      el("h3", {}, "The hardware"),
      el("p", { class: "muted" }, `What Orqa and its sellers publish, plus ${missing} things nobody publishes that we'll need to ask for or measure.`),
      el("div", {}, el("button", { class: "secondary small", onclick: () => document.dispatchEvent(new CustomEvent("sim-go", { detail: "/measure" })) }, "Measure what's missing"))),
    ...SPECS.map((g) => el("div", { class: "card stack tight" },
      el("h4", {}, g.name),
      el("p", { class: "meta" }, g.about),
      el("div", { class: "spec-wrap" }, el("table", { class: "spec-table" },
        el("tbody", {}, g.rows.map(([k, v, st, src]) => el("tr", {},
          el("th", { scope: "row" }, k),
          el("td", {}, v, el("div", { class: "meta" }, SRC[src])),
          el("td", { class: "spec-status" }, el("span", { class: "chip " + SPEC_TONE[st][1] }, SPEC_TONE[st][0]))))))))));
}

function glossary() {
  return el("section", { class: "stack" },
    el("h3", {}, "Words you'll see"),
    el("dl", { class: "card glossary" }, GLOSSARY.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)])));
}

function form(stage, pid) {
  const kind = el("select", { name: "kind" },
    ...["idea", "question", "decision"].map((k) => el("option", { value: k, selected: k === (pid ? "decision" : "idea") }, KIND_LABEL[k])));
  const text = el("textarea", { name: "text", rows: "3", maxlength: "2000", placeholder: pid ? "Your answer" : "An idea, question or decision" });
  const save = async () => {
    const t = text.value.trim();
    if (!t) { text.focus(); return; }
    const value = { stage, kind: kind.value, text: t, done: false };
    if (pid) value.prompt = pid;
    try { await notes.add(value); answering = null; flash = ""; }
    catch (e) { flash = e.message; render(); }
  };
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); });
  return el("div", { class: "stack tight add" },
    el("label", { class: "stack tight" }, pid ? "Answer" : "Add to this stage", text),
    el("div", { class: "row" },
      el("label", { class: "row tight-row" }, el("span", {}, "As"), kind),
      el("button", { class: "small", onclick: save }, "Add"),
      pid ? el("button", { class: "ghost small", onclick: () => { answering = null; render(); } }, "Cancel") : null));
}
function focusForm() { document.querySelector(".add textarea")?.focus(); }

async function guard(fn) { try { await fn(); } catch (e) { flash = e.message; render(); } }
const toggleDone = (r) => guard(() => notes.update(r.id, { done: !r.value.done }));
const makeDecision = (r) => guard(() => notes.update(r.id, { kind: "decision", done: true }));
const removeNote = (r) => guard(() => notes.remove(r.id));
const setFocus = (id) => guard(() => planRec ? plan.set(planRec.id, { focus: id }) : plan.add({ focus: id }));

function go(id) {
  current = id; answering = null; flash = "";
  ambition.route.set("/plan/" + id);
  render();
}

notes.subscribe(load);
plan.subscribe(load);
await load();

export function showStage(id) {
  if (!STAGES.some((s) => s.id === id)) return false;
  current = id; answering = null; flash = "";
  render();
  return true;
}
export const planStages = STAGES.map((s) => s.id);
