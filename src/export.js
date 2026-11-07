import snapshot from "./snapshot.js";

// Export: push the sim's source (a snapshot kept with the app) into the viewer's GitHub repo.
const $ = (id) => document.getElementById(id);
let started = false;
let source = null;
let login = "";
const NEW = "__new__";
const isNew = () => $("x-repo").value === NEW;

function say(text) { $("x-status").textContent = text; }

function quiet(err) {
  const code = err && err.code;
  if (code === "needs_connection") return "Waiting for your GitHub account to be connected.";
  if (code === "needs_approval") return "Waiting for an owner to allow GitHub for this app.";
  if (code === "limited") return "Going a little fast. Try again in a moment.";
  return (err && err.message) || "GitHub didn't answer. Try again.";
}

async function loadRepos() {
  const sel = $("x-repo");
  try {
    const answer = await ambition.connection("github").get("/user/repos", { query: { per_page: 100, sort: "updated" } });
    if (!answer.ok) throw new Error(`GitHub answered ${answer.status}`);
    const repos = (answer.data || []).filter((r) => r.permissions ? r.permissions.push : true);
    const keep = sel.value;
    sel.replaceChildren(new Option("New repository…", NEW));
    for (const r of repos) sel.append(new Option(r.full_name + (r.private ? " (private)" : ""), r.full_name));
    const mine = repos.find((r) => r.owner && r.owner.login && r.permissions && r.permissions.admin);
    if (mine) login = mine.owner.login;
    sel.value = keep && [...sel.options].some((o) => o.value === keep) ? keep : NEW;
    sel.onchange = () => {
      const r = repos.find((x) => x.full_name === sel.value);
      $("x-branch").value = (r && r.default_branch) || "main";
      $("x-new").hidden = !isNew();
      ready();
    };
    sel.onchange();
    return repos;
  } catch (err) {
    sel.replaceChildren(new Option("New repository…", NEW));
    $("x-new").hidden = false;
    say(quiet(err));
    return null;
  }
}

async function createRepo(name) {
  say(`Making ${name}…`);
  const asked = await ambition.connection("github").propose("GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER", {
    name, private: $("x-new-private").checked, auto_init: true,
    description: "Red team operations drone sim, exported from Ambition",
  });
  if (asked && asked.status === "waiting") {
    say(`Approve making ${name} in the room. Once it's made, it shows in the list and you can push.`);
    return null;
  }
  const data = (asked && asked.answer && (asked.answer.data || asked.answer)) || {};
  const full = data.full_name || (login ? `${login}/${name}` : "");
  const repos = await loadRepos();
  if (full && repos && repos.some((r) => r.full_name === full)) {
    $("x-repo").value = full;
    $("x-repo").onchange && $("x-repo").onchange();
  }
  return full || null;
}

function ready() {
  const name = $("x-new-name").value.trim();
  $("x-push").disabled = !(source && (isNew() ? /^[A-Za-z0-9._-]+$/.test(name) : $("x-repo").value));
  $("x-push").textContent = isNew() ? "Make it and push" : "Push to GitHub";
}

async function push() {
  if (!source) return;
  let full = $("x-repo").value;
  if (full === NEW) {
    $("x-push").disabled = true;
    try {
      full = await createRepo($("x-new-name").value.trim());
    } catch (err) {
      say(quiet(err));
      full = null;
    }
    if (!full) { ready(); return; }
  }
  if (!full) return;
  const [owner, repo] = full.split("/");
  const folder = $("x-folder").value.trim().replace(/^\/+|\/+$/g, "");
  const branch = $("x-branch").value.trim() || "main";
  const message = $("x-message").value.trim() || "Red team sim from Ambition";
  const upserts = Object.entries(source.files).map(([path, content]) => ({
    path: folder ? `${folder}/${path}` : path, content, encoding: "utf-8",
  }));
  const btn = $("x-push");
  btn.disabled = true;
  say("Preparing the commit…");
  try {
    const asked = await ambition.connection("github").propose("GITHUB_COMMIT_MULTIPLE_FILES", {
      owner, repo, branch, message, upserts,
    });
    if (asked && asked.status === "waiting") {
      say(`Waiting for your yes in the room to push ${upserts.length} files to ${full} on ${branch}.`);
    } else {
      say(`Pushed ${upserts.length} files to ${full} on ${branch}.`);
    }
  } catch (err) {
    say(quiet(err));
  } finally {
    ready();
  }
}

export async function showExport() {
  if (started) { loadRepos(); return; }
  started = true;
  $("x-push").addEventListener("click", push);
  $("x-new-name").addEventListener("input", ready);
  // Refresh the list when coming back, so a repo approved in the room shows up.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && started) loadRepos(); });
  try {
    source = snapshot;
    const n = Object.keys(source.files).length;
    const kb = Math.round(Object.values(source.files).reduce((s, f) => s + f.length, 0) / 1024);
    $("x-files").textContent = `${n} files, about ${kb} KB of source`;
  } catch {
    $("x-files").textContent = "The source snapshot couldn't be read.";
  }
  ready();
  loadRepos();
}
