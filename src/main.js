import { showStage } from "./plan.js";
import { showLesson } from "./learn.js";
import { startEngine } from "./engine.js";
import { showMeasure } from "./measure.js";
import { showExport } from "./export.js";

const engineEl = document.getElementById("engine");
const planEl = document.getElementById("plan-view");
const learnEl = document.getElementById("learn-view");
const measureEl = document.getElementById("measure-view");
const exportEl = document.getElementById("export-view");
let engine = null;

function show(path) {
  const p = (path || "").replace(/^\//, "");
  const plan = p.startsWith("plan"), learn = p.startsWith("learn"), measure = p.startsWith("measure"), exp = p.startsWith("export");
  engineEl.hidden = plan || learn || measure || exp;
  exportEl.hidden = !exp;
  measureEl.hidden = !measure;
  planEl.hidden = !plan;
  learnEl.hidden = !learn;
  if (plan) { showStage(p.replace(/^plan\/?/, "") || "challenge"); window.scrollTo(0, 0); return; }
  if (exp) { showExport(); window.scrollTo(0, 0); return; }
  if (measure) { showMeasure(tryInSim); window.scrollTo(0, 0); return; }
  if (learn) { showLesson(p.replace(/^learn\/?/, ""), tryInSim); window.scrollTo(0, 0); return; }
  if (!engine) engine = startEngine();
  else engine.then((e) => e.resize());
}

// A lesson's "see it in the sim": open the sim and set it up as the lesson says.
async function tryInSim(preset) {
  ambition.route.set("/");
  show("/");
  const e = await engine;
  await e.apply(preset);
  document.getElementById("g-viewport")?.focus();
}

const go = (path) => { ambition.route.set(path); show(path); };
document.getElementById("g-plan-open").addEventListener("click", () => go("/plan/challenge"));
document.getElementById("g-plan-close").addEventListener("click", () => go("/"));
document.getElementById("g-learn-open").addEventListener("click", () => go("/learn"));
document.getElementById("g-learn-close").addEventListener("click", () => go("/"));
document.getElementById("g-measure-open").addEventListener("click", () => go("/measure"));
document.getElementById("g-measure-close").addEventListener("click", () => go("/"));
document.getElementById("g-export-open").addEventListener("click", () => go("/export"));
document.getElementById("g-export-close").addEventListener("click", () => go("/"));
document.addEventListener("sim-go", (e) => go(e.detail));
ambition.route.onChange(show);
show(await ambition.route.get());
