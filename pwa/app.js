/* CloudDome PWA — platform API (/api/*) for identity/review/ecosystem;
   copyparty (:3923) directly for files using the per-user file_token. */

const CP = `${location.protocol}//${location.hostname}:3923`;
let ME = null, cwd = null, MYGROUPS = [], curGroup = null, curEntry = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = (msg) => {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
};
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB"
  : b > 1e3 ? (b / 1e3).toFixed(0) + " KB" : b + " B";
const fmtDay = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDT = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const hrs = (a, b) => (((b || Date.now() / 1000) - a) / 3600);

/* ── auth ─────────────────────────────────────────────────────── */
async function boot() {
  try { ME = await api("/api/me"); enter(); }
  catch { $("#login-view").classList.remove("hidden"); }
}
$("#login-btn").onclick = async () => {
  try {
    ME = await api("/api/login", { method: "POST", body: JSON.stringify({
      username: $("#login-user").value.trim(), password: $("#login-pass").value }) });
    enter();
  } catch { $("#login-err").textContent = "wrong username or password"; }
};
$("#login-pass").addEventListener("keydown", e => { if (e.key === "Enter") $("#login-btn").click(); });

function enter() {
  document.cookie = `cppwd=${ME.file_token}; path=/; max-age=2592000`;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#whoami").textContent = ME.username;
  $("#jellyfin-link").href = `${location.protocol}//${location.hostname}:8096`;
  if (ME.is_admin) $("#admin-card").classList.remove("hidden");
  cwd = `/vault/${ME.username}`;
  loadFiles(); loadGroups(); refreshBadge(); setInterval(refreshBadge, 15000);
}
$("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };

/* ── tabs & segments ──────────────────────────────────────────── */
document.querySelectorAll("#tabbar button").forEach(btn => btn.onclick = () => {
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.add("hidden"));
  btn.classList.add("active");
  const tab = btn.dataset.tab;
  $(`#tab-${tab}`).classList.remove("hidden");
  $("#view-title").textContent = { files: "Files", life: "Life", groups: "Groups", pending: "Pending", more: "More" }[tab];
  if (tab === "files") loadFiles();
  if (tab === "life") loadLife();
  if (tab === "groups") loadGroups();
  if (tab === "pending") loadPending();
});
document.querySelectorAll("#life-seg button").forEach(btn => btn.onclick = () => {
  document.querySelectorAll("#life-seg button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".segpane").forEach(p => p.classList.add("hidden"));
  btn.classList.add("active");
  $(`#seg-${btn.dataset.seg}`).classList.remove("hidden");
  ({ meals: loadMeals, work: loadWork, fit: loadFit, sleep: loadSleep })[btn.dataset.seg]();
});

/* ── files ────────────────────────────────────────────────────── */
async function loadFiles() {
  $("#crumbs").innerHTML = crumbHtml(cwd);
  const r = await fetch(`${CP}${encodeURI(cwd)}/?ls`, { headers: { "PW": ME.file_token } });
  if (!r.ok) { $("#filelist").innerHTML = `<div class="empty">can't reach files (${r.status})</div>`; return; }
  const j = await r.json();
  const rows = [];
  (j.dirs || []).forEach(d => rows.push(frow("📁", d.href.replace(/\/$/, ""), null, true)));
  (j.files || []).forEach(f => rows.push(frow(icon(f.href), f.href, f.sz, false)));
  $("#filelist").innerHTML = rows.join("") || `<div class="empty">empty folder</div>`;
  document.querySelectorAll(".frow").forEach(el => el.onclick = () => {
    const name = decodeURIComponent(el.dataset.name);
    if (el.dataset.dir === "1") { cwd = `${cwd}/${name}`; loadFiles(); }
    else window.open(`${CP}${encodeURI(cwd)}/${encodeURIComponent(name)}?pw=${ME.file_token}`, "_blank");
  });
}
const icon = (n) => /\.(jpe?g|png|gif|webp|heic)$/i.test(n) ? "🖼️"
  : /\.(mp4|mkv|mov|avi|webm)$/i.test(n) ? "🎬"
  : /\.(mp3|flac|ogg|m4a|wav)$/i.test(n) ? "🎵"
  : /\.(pdf|docx?|txt|md|epub)$/i.test(n) ? "📄" : "📦";
const frow = (ico, name, sz, isDir) =>
  `<div class="frow" data-name="${encodeURIComponent(name)}" data-dir="${isDir ? 1 : 0}">
     <span class="fico">${ico}</span><span class="fname">${esc(name)}</span>
     ${sz != null ? `<span class="fsize">${fmtSize(sz)}</span>` : ""}</div>`;
function crumbHtml(path) {
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  return parts.map((p, i) => {
    acc += "/" + p;
    const t = acc;
    return i < parts.length - 1
      ? `<a href="#" onclick="cwd='${t}';loadFiles();return false">${esc(p)}</a> / ` : esc(p);
  }).join("");
}
$("#upload-input").onchange = async (e) => {
  const files = [...e.target.files];
  const upBase = cwd.startsWith("/up") ? cwd : "/up" + cwd;
  for (const f of files) {
    toast(`uploading ${f.name}…`);
    const r = await fetch(`${CP}${encodeURI(upBase)}/${encodeURIComponent(f.name)}`,
      { method: "PUT", headers: { "PW": ME.file_token }, body: f });
    toast(r.ok ? `${f.name} → scanning` : `upload failed (${r.status})`);
  }
  e.target.value = ""; setTimeout(refreshBadge, 1500);
};

/* ── pending ──────────────────────────────────────────────────── */
async function refreshBadge() {
  try {
    const rows = await api(`/api/pending${ME.is_admin ? "?all=1" : ""}`);
    const n = rows.filter(r => r.status === "flagged").length;
    $("#pending-badge").textContent = n;
    $("#pending-badge").classList.toggle("hidden", n === 0);
  } catch {}
}
async function loadPending() {
  const rows = await api(`/api/pending${ME.is_admin ? "?all=1" : ""}`);
  if (!rows.length) { $("#pendinglist").innerHTML = `<div class="empty">nothing pending 🎉</div>`; return; }
  $("#pendinglist").innerHTML = rows.map(r => `
    <div class="prow" data-id="${r.id}">
      <div class="pname">${esc(r.filename)}</div>
      <div class="pmeta">${esc(r.owner)} · ${fmtSize(r.size_bytes)} · → ${esc(r.intended_dest)}
        ${r.status === "flagged" ? `<div class="pflag">⚠ ${esc(r.flag_reason || "flagged")}</div>` : "· scanning…"}</div>
      ${r.status === "flagged" ? `<div class="pacts">
        <button class="rel">Release</button><button class="rej">Delete</button></div>` : ""}
    </div>`).join("");
  document.querySelectorAll(".prow .rel").forEach(b => b.onclick = () => act(b, "release"));
  document.querySelectorAll(".prow .rej").forEach(b => b.onclick = () => act(b, "reject"));
}
async function act(btn, action) {
  const id = btn.closest(".prow").dataset.id;
  try { await api(`/api/pending/${id}/${action}`, { method: "POST" });
    toast(action === "release" ? "released ✓" : "deleted"); loadPending(); refreshBadge(); }
  catch (e) { toast(e.message); }
}

/* ── life: insight ────────────────────────────────────────────── */
async function loadLife() {
  const i = await api("/api/insights/today");
  $("#insight-body").innerHTML = i.note
    ? `<span style="grid-column:1/3;color:var(--muted)">${esc(i.note)}</span>`
    : `<span>BMR</span><b>${i.bmr_kcal} kcal</b>
       <span>Work</span><b>${i.work_hours} h · ${i.work_kcal} kcal</b>
       <span>Workouts</span><b>${i.workout_minutes} min · ${i.workout_kcal} kcal</b>
       <span>Est. burn</span><b>~${i.est_total_burn_kcal} kcal</b>
       <span>Intake</span><b>${i.intake_kcal} kcal</b>
       <span>Net</span><b>${i.net_kcal} kcal</b>
       ${i.earnings ? `<span>Earned</span><b>$${i.earnings}</b>` : ""}`;
  loadMeals();
}

/* ── life: meals ──────────────────────────────────────────────── */
async function loadMeals() {
  const plans = await api("/api/meals/plans");
  const gsel = $("#pl-group");
  gsel.innerHTML = `<option value="">personal</option>` +
    MYGROUPS.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  $("#planlist").innerHTML = plans.map(p => `
    <div class="lrow"><div class="grow">${esc(p.recipe)}
      <span class="sub">${p.group_name ? "👥 " + esc(p.group_name) : "personal"} · ${esc(p.meal_slot || "")} ${esc(p.plan_date || "")} ${p.target_kcal ? "· " + p.target_kcal + " kcal" : ""}</span></div>
      <button class="act" data-pid="${p.id}">Log it</button></div>`).join("")
    || `<div class="empty">no plans yet</div>`;
  document.querySelectorAll("#planlist .act").forEach(b => b.onclick = async () => {
    await api("/api/meals", { method: "POST", body: JSON.stringify({ plan_id: +b.dataset.pid }) });
    toast("logged from plan"); loadMeals(); });
  const meals = await api("/api/meals/recent");
  $("#meallist").innerHTML = meals.slice(0, 12).map(m => `
    <div class="lrow"><div class="grow">${esc(m.name || "meal")}
      <span class="sub">${fmtDT(m.eaten_at)} ${m.plan_id ? "· from plan" : ""}</span></div>
      <span class="muted">${m.kcal ?? "?"} kcal</span></div>`).join("")
    || `<div class="empty">nothing logged</div>`;
}
$("#ml-save").onclick = async () => {
  await api("/api/meals", { method: "POST", body: JSON.stringify({
    name: $("#ml-name").value || null, kcal: +$("#ml-kcal").value || null,
    protein_g: +$("#ml-protein").value || null }) });
  $("#ml-name").value = $("#ml-kcal").value = $("#ml-protein").value = "";
  toast("meal logged"); loadMeals();
};
$("#pl-save").onclick = async () => {
  await api("/api/meals/plans", { method: "POST", body: JSON.stringify({
    recipe: $("#pl-recipe").value, plan_date: $("#pl-date").value || null,
    meal_slot: $("#pl-slot").value, target_kcal: +$("#pl-kcal").value || null,
    group_id: +$("#pl-group").value || null }) });
  toast("plan created"); loadMeals();
};

/* ── life: work ───────────────────────────────────────────────── */
async function loadWork() {
  $("#w-group").innerHTML = `<option value="">personal (no org)</option>` +
    MYGROUPS.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  const w = await api("/api/work/status");
  $("#w-toggle").textContent = w.id ? "Clock out" : "Clock in";
  const rows = await api("/api/work/sessions");
  $("#worklist").innerHTML = rows.slice(0, 12).map(s => {
    const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h * s.hourly_rate).toFixed(2)}` : "";
    return `<div class="lrow"><div class="grow">${esc(s.activity || "work")}${s.note ? " — " + esc(s.note) : ""}
      <span class="sub">${fmtDT(s.started_at)} · ${s.ended_at ? h.toFixed(1) + "h" + pay : "⏱ running"}</span></div></div>`;
  }).join("") || `<div class="empty">no sessions</div>`;
}
$("#w-toggle").onclick = async () => {
  const w = await api("/api/work/status");
  if (w.id) { await api("/api/work/clockout", { method: "POST" }); toast("clocked out"); }
  else {
    await api("/api/work/clockin", { method: "POST", body: JSON.stringify({
      hourly_rate: +$("#w-rate").value || null, activity: $("#w-activity").value,
      group_id: +$("#w-group").value || null, note: $("#w-note").value || null }) });
    toast("clocked in");
  }
  loadWork();
};

/* ── life: fitness ────────────────────────────────────────────── */
async function loadFit() {
  const rows = await api("/api/workouts/recent");
  $("#wolist").innerHTML = rows.slice(0, 12).map(w => `
    <div class="lrow"><div class="grow">${esc(w.kind)}
      <span class="sub">${fmtDT(w.performed_at)} · ${w.duration_min || "?"} min</span></div>
      <span class="muted">~${w.est_kcal ?? "?"} kcal</span></div>`).join("")
    || `<div class="empty">no workouts</div>`;
}
$("#m-save").onclick = async () => {
  await api("/api/metrics", { method: "POST", body: JSON.stringify({
    weight_kg: +$("#m-weight").value || null, height_cm: +$("#m-height").value || null,
    age_years: +$("#m-age").value || null, sex: $("#m-sex").value || null }) });
  toast("metrics logged"); loadLife();
};
$("#wo-save").onclick = async () => {
  const r = await api("/api/workouts", { method: "POST", body: JSON.stringify({
    kind: $("#wo-kind").value, duration_min: +$("#wo-min").value || 0 }) });
  toast(r.est_kcal ? `logged · ~${r.est_kcal} kcal` : "logged"); loadFit();
};

/* ── life: sleep ──────────────────────────────────────────────── */
async function loadSleep() {
  const rows = await api("/api/sleep/recent");
  $("#sleeplist").innerHTML = rows.map(s => {
    const dur = s.woke_at ? hrs(s.slept_at, s.woke_at).toFixed(1) + "h" : "?";
    return `<div class="lrow"><div class="grow">${fmtDay(s.slept_at)}
      <span class="sub">${dur}${s.quality ? " · quality " + s.quality + "/5" : ""}</span></div></div>`;
  }).join("") || `<div class="empty">no sleep synced — pair the puck</div>`;
}
$("#sleep-key").onclick = async () => {
  const r = await api("/api/sleep/devicekey", { method: "POST", body: JSON.stringify({ label: "alarm-puck" }) });
  const el = $("#sleep-key-out");
  el.textContent = r.key; el.classList.remove("hidden");
  toast("key shown once — store it on the device");
};

/* ── groups ───────────────────────────────────────────────────── */
async function loadGroups() {
  MYGROUPS = await api("/api/groups");
  $("#grouplist").innerHTML = MYGROUPS.map(g => `
    <div class="gcard" data-gid="${g.id}" data-name="${esc(g.name)}" data-role="${g.role}">
      <span>${g.kind === "work" ? "🏗️" : g.kind === "family" ? "🏠" : "📌"}</span>
      <span class="gname">${esc(g.name)}</span><span class="grole">${g.role}</span></div>`).join("")
    || `<div class="empty">no groups yet</div>`;
  document.querySelectorAll(".gcard").forEach(el => el.onclick = () => openGroup(el.dataset));
}
$("#g-create").onclick = async () => {
  try {
    await api("/api/groups", { method: "POST", body: JSON.stringify({
      name: $("#g-name").value.trim(), kind: $("#g-kind").value }) });
    $("#g-name").value = ""; toast("group created"); loadGroups();
  } catch (e) { toast(e.message); }
};
async function openGroup(d) {
  curGroup = d;
  $("#group-list-view").classList.add("hidden");
  $("#group-detail-view").classList.remove("hidden");
  $("#gd-name").textContent = d.name;
  $("#gd-role").textContent = `you are ${d.role}`;
  $("#gd-members-card").classList.toggle("hidden", !["owner", "manager"].includes(d.role));
  $("#gd-files").onclick = (e) => {
    e.preventDefault();
    cwd = `/group/${d.name.toLowerCase().replace(/ /g, "-")}`;
    document.querySelector('[data-tab="files"]').click();
  };
  const rows = await api(`/api/groups/${d.gid}/work`).catch(() => []);
  $("#gd-work").innerHTML = rows.map(s => {
    const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h * s.hourly_rate).toFixed(2)}` : "";
    return `<div class="lrow"><div class="grow"><b>${esc(s.username)}</b> — ${esc(s.activity || "work")}${s.note ? " · " + esc(s.note) : ""}
      <span class="sub">${fmtDT(s.started_at)} · ${s.ended_at ? h.toFixed(1) + "h" + pay : "⏱ on the clock"}</span></div></div>`;
  }).join("") || `<div class="empty">no sessions logged to this group</div>`;
}
$("#g-back").onclick = (e) => { e.preventDefault();
  $("#group-detail-view").classList.add("hidden");
  $("#group-list-view").classList.remove("hidden"); };
$("#gm-add").onclick = async () => {
  try {
    await api(`/api/groups/${curGroup.gid}/members`, { method: "POST", body: JSON.stringify({
      username: $("#gm-user").value.trim(), role: $("#gm-role").value }) });
    $("#gm-user").value = ""; toast("member added");
  } catch (e) { toast(e.message); }
};

/* ── admin ────────────────────────────────────────────────────── */
$("#au-add").onclick = async () => {
  try {
    const r = await api("/api/users", { method: "POST", body: JSON.stringify({
      username: $("#au-name").value.trim(), password: $("#au-pass").value }) });
    toast(r.warning || "user created"); $("#au-name").value = $("#au-pass").value = "";
  } catch (e) { toast(e.message); }
};

/* ── journal ──────────────────────────────────────────────────── */
$("#open-journal").onclick = () => { $("#app-view").classList.add("hidden");
  $("#journal-view").classList.remove("hidden"); loadJournal(); };
$("#j-close").onclick = (e) => { e.preventDefault();
  $("#journal-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); };
async function loadJournal() {
  $("#j-editor").classList.add("hidden"); $("#j-list").classList.remove("hidden");
  const rows = await api("/api/journal");
  $("#j-list").innerHTML = rows.map(e => `
    <div class="jrow" data-id="${e.id}" data-title="${esc(e.title || "")}">
      <span class="jdate">${fmtDay(e.created_at)}</span>
      <h4>${esc(e.title || "untitled")}</h4><p>${esc(e.body || "")}</p></div>`).join("")
    || `<div class="empty">empty pages, waiting</div>`;
  document.querySelectorAll(".jrow").forEach(el => el.onclick = async () => {
    const rows2 = await api("/api/journal");
    const entry = rows2.find(x => x.id === +el.dataset.id);
    openEditor(entry);
  });
}
function openEditor(entry) {
  curEntry = entry || null;
  $("#j-list").classList.add("hidden"); $("#j-editor").classList.remove("hidden");
  $("#j-title").value = entry?.title || ""; $("#j-body").value = entry?.body || "";
  $("#j-delete").classList.toggle("hidden", !entry);
}
$("#j-new").onclick = (e) => { e.preventDefault(); openEditor(null); };
$("#j-save").onclick = async () => {
  const payload = { title: $("#j-title").value, body: $("#j-body").value };
  if (curEntry) await api(`/api/journal/${curEntry.id}`, { method: "PUT", body: JSON.stringify(payload) });
  else await api("/api/journal", { method: "POST", body: JSON.stringify(payload) });
  toast("saved"); loadJournal();
};
$("#j-delete").onclick = async () => {
  await api(`/api/journal/${curEntry.id}`, { method: "DELETE" });
  toast("deleted"); loadJournal();
};

/* ── sw ───────────────────────────────────────────────────────── */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
boot();
