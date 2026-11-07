// The lesson path: from how drones and cameras work to what the challenge asks,
// each lesson with something to play with, a "try it in the sim" and one check.

const G = 9.81, MASS = 2.9, MAX_THRUST = 4 * 21;
const TAN_V = Math.tan(43 * Math.PI / 180);   // 86° vertical view
const M_PER_PX = 2 * TAN_V / 720;               // ground per pixel per metre of height, at 720 rows

const progress = ambition.collection("lessons");
const [me, people] = await Promise.all([ambition.viewer(), ambition.members()]);
const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

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
const SVG = "http://www.w3.org/2000/svg";
const sv = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const r1 = (v) => v < 10 ? v.toFixed(1) : String(Math.round(v));
const len = (m) => m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : m < 1 ? `${Math.round(m * 100)} cm` : `${r1(m)} m`;

// A slider with its label and live value.
function slider(label, min, max, step, value, show, on) {
  const out = el("output", { class: "type-label-md" });
  const input = el("input", { type: "range", min, max, step, value, "aria-label": label });
  const upd = () => { out.textContent = show(+input.value); on(+input.value); };
  input.addEventListener("input", upd);
  queueMicrotask(upd);
  return el("label", { class: "stack tight" }, el("span", { class: "row between" }, el("span", {}, label), out), input);
}
const fact = (label) => { const v = el("strong", { class: "type-heading-sm" }); return [el("div", { class: "fact stack tight" }, el("span", { class: "meta" }, label), v), v]; };

// ---------- the widgets ----------
function tiltWidget() {
  const [f1, a] = fact("Sideways push"), [f2, t] = fact("Thrust needed"), [f3, m] = fact("Of the motors' full power");
  const hover = MASS * G;
  return el("div", { class: "stack" },
    slider("Tilt the drone", 0, 45, 1, 15, (v) => `${v}°`, (deg) => {
      const r = deg * Math.PI / 180;
      a.textContent = `${(G * Math.tan(r)).toFixed(1)} m/s²`;
      t.textContent = `${Math.round(hover / Math.cos(r))} N`;
      m.textContent = `${Math.round(100 * hover / Math.cos(r) / MAX_THRUST)}%`;
    }),
    el("div", { class: "facts" }, f1, f2, f3),
    el("p", { class: "meta" }, `Level, it needs ${Math.round(hover)} N to hover, about ${Math.round(100 * hover / MAX_THRUST)}% of full power. Tilting means more thrust just to stay up.`));
}

function driftWidget() {
  const [f1, e] = fact("How far off it thinks it is");
  let bias = 0.01, secs = 30;
  const upd = () => { e.textContent = len(0.5 * bias * secs * secs); };
  return el("div", { class: "stack" },
    slider("A tiny error in the accelerometer", 0.001, 0.05, 0.001, bias, (v) => `${v.toFixed(3)} m/s²`, (v) => { bias = v; upd(); }),
    slider("Seconds without GNSS", 1, 60, 1, secs, (v) => `${v} s`, (v) => { secs = v; upd(); }),
    el("div", { class: "facts" }, f1),
    el("p", { class: "meta" }, "0.01 m/s² is about a thousandth of gravity, smaller than a good sensor's leftover error. Because the error is added up twice, doubling the time makes it four times worse."));
}

function footprintWidget() {
  const [f1, w] = fact("Ground in view"), [f2, p] = fact("One pixel covers"), [f3, c] = fact("A 4 m car is");
  return el("div", { class: "stack" },
    slider("Height above the ground", 5, 120, 1, 30, (v) => `${v} m`, (h) => {
      const H = 2 * h * TAN_V, W = H * 16 / 9, px = h * M_PER_PX;
      w.textContent = `${Math.round(W)} × ${Math.round(H)} m`;
      p.textContent = len(px);
      c.textContent = `${r1(4 / px)} pixels long`;
    }),
    el("div", { class: "facts" }, f1, f2, f3),
    el("p", { class: "meta" }, "Worked out for the camera as the sim has it: 86° from top to bottom, a 16:9 picture, 1280 × 720 pixels."));
}

function shutterWidget() {
  const W = 320, H = 180;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rs-pic", role: "img" });
  const [f1, s] = fact("Bottom row lands this far from the top row");
  let v = 4, ro = 13, h = 20, big = true;
  const exaggerate = el("input", { type: "checkbox", checked: true });
  exaggerate.addEventListener("change", () => { big = exaggerate.checked; draw(); });
  function draw() {
    const shift = v * (ro / 1000) / (h * M_PER_PX); // pixels across one frame's readout
    s.textContent = `${shift < 10 ? shift.toFixed(1) : Math.round(shift)} px`;
    const k = big ? 20 : 1, scale = W / 1280, d = shift * scale * k;
    svg.setAttribute("aria-label", `A grid of ground lines; the bottom of the picture is shifted ${shift.toFixed(1)} pixels from the top`);
    svg.replaceChildren(sv("rect", { x: 0, y: 0, width: W, height: H, class: "rs-bg" }));
    for (let x = -W; x <= 2 * W; x += 32) svg.append(sv("line", { x1: x, y1: 0, x2: x - d, y2: H, class: "rs-line" }));
    for (let y = 0; y <= H; y += 30) svg.append(sv("line", { x1: 0, y1: y, x2: W, y2: y, class: "rs-line faintline" }));
    svg.append(sv("rect", { x: 0, y: 0, width: W, height: H, class: "rs-frame" }));
  }
  return el("div", { class: "stack" },
    svg,
    el("div", { class: "facts" }, f1),
    slider("Drone sliding sideways", 0, 10, 0.5, v, (x) => `${x} m/s`, (x) => { v = x; draw(); }),
    slider("Readout time, top row to bottom row", 0, 25, 1, ro, (x) => x === 0 ? "global shutter" : `${x} ms`, (x) => { ro = x; draw(); }),
    slider("Height", 5, 100, 1, h, (x) => `${x} m`, (x) => { h = x; draw(); }),
    el("label", { class: "row tight-row" }, exaggerate, "Draw the lean 20 times bigger so it's easy to see"));
}

function flowWidget() {
  const W = 320, H = 180;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rs-pic", role: "img" });
  const pts = [];
  for (let i = 0; i < 28; i++) pts.push([20 + ((i * 97) % 280), 18 + ((i * 53) % 144)]);
  const said = el("p", { class: "muted", "aria-live": "polite" });
  const MOVES = {
    right: ["Moves right", "Every feature slides left by the same amount: the drone went right.", (x, y) => [-18, 0]],
    climb: ["Climbs", "Features drift in toward the middle: the ground got smaller, so the drone went up.", (x, y) => [(W / 2 - x) * 0.15, (H / 2 - y) * 0.15]],
    turn: ["Turns", "Features swing around the middle: the drone turned on the spot.", (x, y) => [-(y - H / 2) * 0.2, (x - W / 2) * 0.2]]
  };
  let on = "right";
  const btns = Object.entries(MOVES).map(([k, [label]]) => el("button", { type: "button", class: "small secondary", "aria-pressed": "false", onclick: () => { on = k; draw(); } }, label));
  function draw() {
    const [, text, f] = MOVES[on];
    said.textContent = text;
    Object.keys(MOVES).forEach((k, i) => { btns[i].className = k === on ? "small" : "small secondary"; btns[i].setAttribute("aria-pressed", String(k === on)); });
    svg.setAttribute("aria-label", text);
    svg.replaceChildren(sv("rect", { x: 0, y: 0, width: W, height: H, class: "rs-bg" }));
    for (const [x, y] of pts) {
      const [dx, dy] = f(x, y);
      svg.append(sv("line", { x1: x, y1: y, x2: x + dx, y2: y + dy, class: "flow" }));
      svg.append(sv("circle", { cx: x, cy: y, r: 3, class: "feat" }));
    }
    svg.append(sv("rect", { x: 0, y: 0, width: W, height: H, class: "rs-frame" }));
  }
  draw();
  return el("div", { class: "stack" }, el("div", { class: "row", role: "group", "aria-label": "What the drone does" }, el("span", { class: "meta" }, "The drone"), btns), svg, said);
}

function heightWidget() {
  const [f1, p] = fact("A 10 cm drift moves the picture"), [f2, c] = fact("");
  const chip = el("span", { class: "chip" });
  f2.replaceChildren(el("span", { class: "meta" }, "Can tracking see it?"), chip);
  return el("div", { class: "stack" },
    slider("Height", 5, 120, 1, 10, (v) => `${v} m`, (h) => {
      const px = 0.1 / (h * M_PER_PX);
      p.textContent = `${px < 1 ? px.toFixed(2) : px.toFixed(1)} px`;
      chip.className = "chip " + (px >= 2 ? "success" : px >= 0.7 ? "warning" : "danger");
      chip.textContent = px >= 2 ? "Easily" : px >= 0.7 ? "Just about" : "Under a pixel";
    }),
    el("div", { class: "facts" }, f1, f2));
}

// ---------- the path ----------
const LESSONS = [
  {
    id: "challenge", title: "What the challenge asks", min: 4,
    body: [
      ["The Red Team Hackathon Grand Final, Contested Battlefield Aerial Operations, is on November 21, 2026 at the Canadian War Museum in Ottawa. The full rules arrive 72 hours before, on November 18."],
      ["The task in one sentence", "Make an Orqa M2-AI drone hold still over one spot while its satellite positioning (GNSS, the family GPS belongs to) is jammed or switched off, using only a cheap camera pointing straight down and the drone's own small computer."],
      ["How it's won", "In the live trial, the drone that stays stable at the greatest height wins. Teams also present four things: how they combine sensors, how they handle the camera's rolling shutter, how they use the onboard computer, and how they recover when vision fails."],
      ["The kit", "The M2-AI is Orqa's four-propeller drone with 10 inch props, about 2.9 kg with its battery. The APB (Auto Pilot Board) is its flight controller plus a small Linux computer, where our code has to run. The Justice D is a small FPV camera, mounted looking straight down, which people call nadir."],
      ["Why it's hard", "Without GNSS the drone has no outside reference for where it is. Its motion sensors drift within seconds. The camera can watch the ground slide past, but from high up the ground looks small and smooth, and this camera bends the picture when it moves. Each lesson here unpacks one of those pieces."]
    ],
    quiz: { q: "What wins the live trial?", options: ["The fastest lap around a course", "Staying stable over one spot at the greatest height", "The longest flight on one battery"], correct: 1, why: "It's a height contest: hold still without GNSS, as high as you can." }
  },
  {
    id: "flight", title: "How a quadcopter flies", min: 5,
    body: [
      ["Four propellers push air down. Their thrust grows with the square of how fast they spin. Two spin one way and two the other, so their twisting cancels out."],
      ["Moving around", "To climb, all four speed up. To move sideways, the drone tilts: some of its thrust now points sideways, so it accelerates that way. To turn on the spot (yaw), it speeds up one pair and slows the other, so the twisting no longer cancels."],
      ["The flight controller", "Nobody balances this by hand. The flight controller runs a loop hundreds of times a second: read the gyro, compare with what it wants, adjust the four motors. On top sits a slower position loop: I want to be here, I'm there, so tilt this much. Holding position is that outer loop, and it's only as good as its answer to where am I."]
    ],
    widget: tiltWidget,
    tryit: { text: "Fly it yourself over the Dübendorf airfield: W A S D to move, R and F to climb and drop, Q and E to turn. Watch it tilt to move.", preset: { site: "dubendorf", gnss: "full", vio: true, altitude: 20, mode: "pilot", view: "chase", tab: "drone" } },
    quiz: { q: "How does a quadcopter move forward?", options: ["A rear propeller pushes it", "It tilts so some of its thrust points forward", "The front motors stop"], correct: 1, why: "Tilting turns part of the upward push into a forward one." }
  },
  {
    id: "position", title: "Knowing where you are", min: 5,
    body: [
      ["GNSS", "Satellites tell the drone where it is to within a few metres, every second, and the error never builds up. But the signal is faint, so it's easy to jam (drown in noise) or spoof (fake signals that slowly walk you away while looking healthy). The trial will take it away."],
      ["IMU", "The gyroscope measures turning and the accelerometer measures acceleration, hundreds of times a second, always. To get position from acceleration you add it up twice, once into speed and again into distance, so a tiny steady error grows with time squared."],
      ["Barometer", "Air pressure gives height well enough to hold altitude, but says nothing about sliding sideways."],
      ["So something has to replace GNSS for sideways position. That's the camera's job."]
    ],
    widget: driftWidget,
    tryit: { text: "This turns GNSS and VIO off, so the hold only has the IMU. Watch the drift in the corner of the view grow.", preset: { gnss: "denied", vio: false, altitude: 20, mode: "hold", view: "orbit", tab: "nav" } },
    quiz: { q: "Why can't the IMU alone hold position for a minute?", options: ["It's too slow", "Tiny errors are added up twice and grow fast", "It only measures height"], correct: 1, why: "Adding up twice turns a tiny error into metres within a minute." }
  },
  {
    id: "camera", title: "How a camera sees the ground", min: 4,
    body: [
      ["A camera is a pinhole with a lens: each pixel looks out along its own direction. The field of view says how wide that cone is. In our sim the Justice D sees 86° from top to bottom, in a 1280 × 720 picture."],
      ["Ground per pixel", "Pointing straight down, the patch of ground it sees grows with height, and each pixel covers more of it. This is called ground sampling distance, or GSD. It also applies to the aerial photos our sites are made from: Dübendorf's is 10 cm a pixel."],
      ["Frames and exposure", "The camera takes many pictures a second (60 in the sim). Exposure is how long each one collects light: longer is brighter, but blurrier when things move."]
    ],
    widget: footprintWidget,
    tryit: { text: "This shows what the Justice D sees at 10 m. Then try the height buttons on the Drone tab and watch the ground shrink.", preset: { view: "cam", altitude: 10, gnss: "full", vio: true, mode: "hold", tab: "drone" } },
    quiz: { q: "At 50 m, about how much ground does one pixel of our camera cover?", options: ["1 cm", "13 cm", "1 m"], correct: 1, why: "About 2.6 mm per metre of height, so roughly 13 cm at 50 m." }
  },
  {
    id: "shutter", title: "Rolling shutter", min: 5,
    body: [
      ["A global shutter captures every pixel at the same instant. Cheap sensors, the Justice D included, use a rolling shutter: they read the picture row by row, top to bottom. The time from first row to last is the readout time. We guess 13 ms for the Justice D until we can measure it."],
      ["What it does to the picture", "If the camera moves during the readout, each row sees the ground from a slightly different place. Sliding sideways makes straight lines lean. Turning shears the picture. Propeller vibration makes rows wobble back and forth, which people call jello."],
      ["Why it matters", "Most VIO assumes a picture is one moment. A rolling shutter picture is really 720 moments. Software that doesn't know gets the motion wrong. Fixes: soft-mount the camera, measure the readout, and use VIO that gives each row its own time (a version of OpenVINS does)."]
    ],
    widget: shutterWidget,
    tryit: { text: "This puts rolling and global shutter side by side with a loosely mounted camera, so the jello shows. Slow time down to see it row by row.", preset: { view: "split", mount: "loose", readout: 13, tab: "camera", mode: "hold" } },
    quiz: { q: "What does a rolling shutter do?", options: ["Captures every pixel at once", "Reads the picture one row after another, so motion bends it", "Rolls the camera to keep it level"], correct: 1, why: "Rows are read at different moments, so anything that moves during the readout bends." }
  },
  {
    id: "vio", title: "Seeing motion: VIO", min: 6,
    body: [
      ["Visual odometry works out how the camera moved from its pictures. First it finds features: small spots that are easy to find again, like the corner of a paving slab or a dark tuft in bright grass. Then it tracks them into the next frame. The way they all move tells how the camera moved."],
      ["Why the IMU joins in", "A camera alone can't tell size: a small thing nearby moves like a big thing far away. The IMU knows real accelerations in metres and seconds, and fills the gaps between frames, while the camera stops the IMU from drifting. Together that's visual-inertial odometry, VIO. Combining them is called sensor fusion, usually a filter that weighs each one by how much it trusts it."],
      ["It still drifts, slowly", "Every small tracking mistake adds up. In a hover, the question is how long it stays inside a small circle."],
      ["What we'd use", "OpenVINS is light enough for the APB and has a rolling shutter version. Plan B is simpler: optical flow plus the barometer's height, which is cruder but very robust."]
    ],
    widget: flowWidget,
    tryit: { text: "This shows the Justice D view with GNSS off and VIO on. The marks are features being tracked, and the count is in the corner.", preset: { view: "cam", gnss: "denied", vio: true, altitude: 20, mode: "hold", tab: "nav" } },
    quiz: { q: "Why does VIO need the IMU as well as the camera?", options: ["The camera can't tell how big a motion is in metres, and the IMU can", "The IMU takes the pictures", "It doesn't need it"], correct: 0, why: "The IMU gives real-world scale and fills the gaps between frames." }
  },
  {
    id: "height", title: "Why height is the hard part", min: 4,
    body: [
      ["Smaller motion in the picture", "Higher up, each pixel covers more ground, so the same drift moves the picture less. At 10 m a 10 cm drift moves the image about 4 pixels, easy to see. At 100 m it's under half a pixel. VIO tends to break where a drift worth caring about shrinks to about a pixel."],
      ["Texture disappears", "Grass blades and pebbles blur into flat colour from high up, so there are fewer features. A plain field is far worse than a car park with markings."],
      ["Some things get easier", "More ground is in view, so bigger landmarks show up, and slower picture motion means less rolling shutter lean and blur."],
      ["The trial rewards height, so the team that copes with sub-pixel motion over smooth ground wins. Canada's normal drone ceiling is 122 m."]
    ],
    widget: heightWidget,
    tryit: { text: "Open the Tests tab and run the altitude ladder: it holds 60 s at 10, 30, 60 and 100 m and shows where it stops holding.", preset: { site: "dubendorf", gnss: "denied", vio: true, altitude: 10, mode: "hold", view: "chase", tab: "tests" } },
    quiz: { q: "At 100 m, how far does the picture move if the drone drifts 10 cm?", options: ["About 4 pixels", "Less than half a pixel", "About 40 pixels"], correct: 1, why: "One pixel covers about 26 cm at 100 m, so 10 cm is well under one." }
  },
  {
    id: "recovery", title: "When VIO fails, and coming back", min: 4,
    body: [
      ["It will fail sometimes: blank ground like snow or fresh tarmac, a sudden change of light, motion blur, a gust, dropped frames, a burst of vibration."],
      ["Spotting it", "Tracked features dropping, the filter growing less sure of itself, and VIO disagreeing with the IMU are the early signs."],
      ["Coming back", "First hold level and keep height on the barometer (the flight controller can do this on its own); it drifts with the wind but stays up. Then come down to where features are bigger, restart VIO, and climb back."],
      ["Spoofing is the sneaky case: GNSS looks healthy but lies. Trust VIO over it. This whole topic is one of the presentation points, so we log every time it happens."]
    ],
    tryit: { text: "The Ottawa farm is a bare field with little to track. Watch VIO health in the corner drop to lost.", preset: { site: "farm", gnss: "denied", vio: true, altitude: 20, mode: "hold", view: "cam", tab: "nav" } },
    quiz: { q: "What's a good first sign VIO is in trouble?", options: ["Fewer features being tracked", "The battery warming up", "GNSS getting better"], correct: 0, why: "Fewer features means less to measure motion from." }
  },
  {
    id: "oursim", title: "How our sim fits together", min: 5,
    body: [
      ["The three pieces", "The drone: physics, motors, wind and GNSS you can switch between full, jammed, spoofed and off. The environment: real aerial photos laid on real ground height (Dübendorf, Delft, Andermatt, the Ottawa farm). The camera: the Justice D with its rolling shutter, readout time, mount shake and blur."],
      ["One loop", "The drone flies. The camera draws what it would see, row by row. Features are found in that bent picture. How many there are and how bent it is decide how much VIO gets wrong. The hold steers on what VIO believes, and the drone moves."],
      ["The test", "A 60 s hold passes if the drone stays within 1 m the whole time, a stand-in until the real rules on November 18. The ladder repeats it at 10, 30, 60 and 100 m."],
      ["The honest part", "The drone and camera are built from published numbers and guesses, and how warp and blur become VIO error is our estimate. It's for building intuition. The real test bench will be Gazebo with PX4 or ArduPilot running our actual VIO code."]
    ],
    tryit: { text: "Open the Tests tab and start a 60 s hold at 20 m with GNSS off.", preset: { site: "dubendorf", gnss: "denied", vio: true, altitude: 20, mode: "hold", view: "chase", tab: "tests" } },
    quiz: { q: "In our sim, what decides how much VIO drifts?", options: ["A fixed random number", "What the bent camera picture shows: how many features and how much warp", "The battery level"], correct: 1, why: "The camera image drives the VIO error, which is what makes camera choices matter." }
  },
  {
    id: "next", title: "What we still need", min: 3,
    body: [
      ["Real numbers", "The M2-AI's mass, inertia and motor thrust, from Orqa or by measuring. The Justice D's readout time: film a light flickering at a known rate and count the bands. Its mount shake, from a hover log."],
      ["One real flight", "Hover at a few heights over a field with GNSS on as the truth, recording camera and IMU. Compare with the sim and correct the VIO error model."],
      ["Pick the VIO", "Run OpenVINS with rolling shutter on that recording and check it keeps up on the APB."],
      ["Rules day", "On November 18, put the real radius and time into the sim and rerun everything."],
      ["Anything you notice or want to try goes in Plan and notes, so the whole team sees it."]
    ]
  }
];

let done = [];      // records: { lesson }
let current = LESSONS[0].id;
let picked = null;  // quiz option chosen in this lesson
let onTry = () => {};

async function load() { done = await progress.list(); render(); }
const mine = () => new Set(done.filter((r) => r.author_id === me.id).map((r) => r.value.lesson));
const whoDid = (id) => [...new Set(done.filter((r) => r.value.lesson === id).map((r) => r.author_id))];

async function markDone(id) {
  if (mine().has(id)) return;
  try { await progress.add({ lesson: id }); } catch { /* shown as not done; try again later */ }
}

function go(id) {
  current = id; picked = null;
  ambition.route.set("/learn/" + id);
  render();
  window.scrollTo(0, 0);
  document.getElementById("learn-lesson")?.focus();
}

function render() {
  const root = document.getElementById("learn-body");
  if (!root) return;
  const have = mine();
  const i = LESSONS.findIndex((l) => l.id === current);
  const L = LESSONS[i];

  const path = el("nav", { class: "learn-path stack tight", "aria-label": "Lessons" },
    el("div", { class: "stack tight" },
      el("span", { class: "meta" }, `${have.size} of ${LESSONS.length} done`),
      el("progress", { max: LESSONS.length, value: have.size, "aria-label": "Lessons done" })),
    el("ol", { class: "stack tight plain" }, LESSONS.map((l, n) =>
      el("li", {}, el("button", { type: "button", class: "lesson-link" + (l.id === current ? " on" : ""), "aria-current": l.id === current ? "step" : null, onclick: () => go(l.id) },
        el("span", { class: "dot" + (have.has(l.id) ? " done" : ""), "aria-hidden": "true" }, have.has(l.id) ? "\u2713" : String(n + 1)),
        el("span", {}, l.title, have.has(l.id) ? el("span", { class: "sr-only" }, " (done)") : null))))));

  const who = whoDid(L.id).map((id) => names[id] || "Someone");
  const q = L.quiz;
  const quiz = q ? el("fieldset", { class: "card stack tight quiz" },
    el("legend", { class: "type-label-lg" }, q.q),
    q.options.map((o, n) => el("label", { class: "row tight-row option" + (picked != null && n === q.correct ? " right" : picked === n ? " wrong" : "") },
      el("input", { type: "radio", name: "quiz", value: String(n), checked: picked === n, onchange: () => { picked = n; if (n === q.correct) markDone(L.id); render(); } }), o)),
    picked == null ? null : el("p", { role: "status", class: picked === q.correct ? "" : "muted" },
      (picked === q.correct ? "Right. " : "Not quite. ") + q.why)) : null;

  const lesson = el("article", { class: "stack loose learn-lesson", id: "learn-lesson", tabindex: "-1" },
    el("header", { class: "stack tight" },
      el("span", { class: "eyebrow" }, `Lesson ${i + 1} of ${LESSONS.length} \u00b7 ${L.min} min`),
      el("h2", {}, L.title)),
    el("div", { class: "stack" }, L.body.map((b) => b.length === 1 ? el("p", { class: "type-body-lg" }, b[0])
      : el("section", { class: "stack tight" }, el("h3", {}, b[0]), el("p", {}, b[1])))),
    L.widget ? el("section", { class: "card stack widget", "aria-label": "Try the numbers" }, el("span", { class: "eyebrow" }, "Try the numbers"), L.widget()) : null,
    L.tryit ? el("section", { class: "card stack tight tryit" },
      el("span", { class: "eyebrow" }, "See it in the sim"),
      el("p", {}, L.tryit.text),
      el("div", {}, el("button", { type: "button", class: "secondary", onclick: () => onTry(L.tryit.preset) }, "Open it in the sim"))) : null,
    quiz,
    el("footer", { class: "row between learn-foot" },
      i > 0 ? el("button", { type: "button", class: "ghost", onclick: () => go(LESSONS[i - 1].id) }, "Back") : el("span"),
      el("div", { class: "row" },
        who.length ? el("span", { class: "meta" }, `Done by ${who.join(", ")}`) : null,
        i < LESSONS.length - 1
          ? el("button", { type: "button", onclick: async () => { const id = L.id; go(LESSONS[i + 1].id); await markDone(id); } }, have.has(L.id) ? "Next lesson" : "Done, next lesson")
          : have.has(L.id) ? el("span", { class: "chip success" }, "You've finished the path")
            : el("button", { type: "button", onclick: () => markDone(L.id) }, "Finish the path"))));

  root.replaceChildren(path, lesson);
}

progress.subscribe(load);
await load();

export function showLesson(id, tryHandler) {
  if (tryHandler) onTry = tryHandler;
  if (id && LESSONS.some((l) => l.id === id)) { if (id !== current) picked = null; current = id; }
  else if (!id) {
    const have = mine();
    current = (LESSONS.find((l) => !have.has(l.id)) || LESSONS[0]).id; picked = null;
  }
  render();
}
