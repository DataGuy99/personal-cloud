/* CloudDome PWA — talks to the platform API (/api/*) for identity, pending
   review and ecosystem; talks to copyparty directly (same host, :3923) for
   file listing/upload/download using the per-user file_token. */

const CP = `${location.protocol}//${location.hostname}:3923`;
let ME = null;          // {username, is_admin, file_token}
let cwd = null;         // current copyparty folder vpath, e.g. "/vault/bob"

const $ = (s) => document.querySelector(s);
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
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + " GB"
  : b > 1e6 ? (b / 1e6).toFixed(1) + " MB"
  : b > 1e3 ? (b / 1e3).toFixed(0) + " KB" : b + " B";

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
  } catch (e) { $("#login-err").textContent = "wrong username or password"; }
};
$("#login-pass").addEventListener("keydown", e => { if (e.key === "Enter") $("#login-btn").click(); });

function enter() {
  // copyparty auth: its password IS the file_token; set its cookie directly
  document.cookie = `cppwd=${ME.file_token}; path=/; max-age=2592000`;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#whoami").textContent = ME.username;
  $("#jellyfin-link").href = `${location.protocol}//${location.hostname}:8096`;
  cwd = `/vault/${ME.username}`;
  loadFiles(); refreshPendingBadge(); setInterval(refreshPendingBadge, 15000);
}

/* ── tabs ─────────────────────────────────────────────────────── */
document.querySelectorAll("#tabbar button").forEach(btn => btn.onclick = () => {
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.add("hidden"));
  btn.classList.add("active");
  const tab = btn.dataset.tab;
  $(`#tab-${tab}`).classList.remove("hidden");
  $("#view-title").textContent = { files: "Files", pending: "Pending", media: "Media", life: "Life" }[tab];
  if (tab === "pending") loadPending();
  if (tab === "life") loadLife();
  if (tab === "files") loadFiles();
});

/* ── files (copyparty ?ls JSON api) ───────────────────────────── */
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
     <span class="fico">${ico}</span><span class="fname">${name}</span>
     ${sz != null ? `<span class="fsize">${fmtSize(sz)}</span>` : ""}</div>`;
function crumbHtml(path) {
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  return parts.map((p, i) => {
    acc += "/" + p;
    const target = acc;
    return i < parts.length - 1
      ? `<a href="#" onclick="cwd='${target}';loadFiles();return false">${p}</a> / `
      : p;
  }).join("");
}

/* upload → goes to the staging-backed /up twin of the current folder */
$("#upload-input").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  const upBase = cwd.startsWith("/up") ? cwd : "/up" + cwd;
  for (const f of files) {
    toast(`uploading ${f.name}…`);
    const r = await fetch(`${CP}${encodeURI(upBase)}/${encodeURIComponent(f.name)}`,
      { method: "PUT", headers: { "PW": ME.file_token }, body: f });
    toast(r.ok ? `${f.name} → scanning` : `upload failed (${r.status})`);
  }
  e.target.value = "";
  setTimeout(refreshPendingBadge, 1200);
};

/* ── pending review ───────────────────────────────────────────── */
async function refreshPendingBadge() {
  try {
    const rows = await api(`/api/pending${ME.is_admin ? "?all=1" : ""}`);
    const n = rows.filter(r => r.status === "flagged").length;
    const b = $("#pending-badge");
    b.textContent = n; b.classList.toggle("hidden", n === 0);
  } catch {}
}
async function loadPending() {
  const rows = await api(`/api/pending${ME.is_admin ? "?all=1" : ""}`);
  if (!rows.length) { $("#pendinglist").innerHTML = `<div class="empty">nothing pending 🎉</div>`; return; }
  $("#pendinglist").innerHTML = rows.map(r => `
    <div class="prow" data-id="${r.id}">
      <div class="pname">${r.filename}</div>
      <div class="pmeta">${r.owner} · ${fmtSize(r.size_bytes)} · → ${r.intended_dest}
        ${r.status === "flagged" ? `<div class="pflag">⚠ ${r.flag_reason || "flagged"}</div>` : "· scanning…"}
      </div>
      ${r.status === "flagged" ? `<div class="pacts">
        <button class="rel">Release</button><button class="rej">Delete</button></div>` : ""}
    </div>`).join("");
  document.querySelectorAll(".prow .rel").forEach(b => b.onclick = () => act(b, "release"));
  document.querySelectorAll(".prow .rej").forEach(b => b.onclick = () => act(b, "reject"));
}
async function act(btn, action) {
  const id = btn.closest(".prow").dataset.id;
  try { await api(`/api/pending/${id}/${action}`, { method: "POST" });
        toast(action === "release" ? "released ✓" : "deleted"); loadPending(); refreshPendingBadge(); }
  catch (e) { toast(`${e.message}`); }
}

/* ── life / ecosystem ─────────────────────────────────────────── */
async function loadLife() {
  const i = await api("/api/insights/today");
  $("#insight-body").innerHTML = i.note
    ? `<span style="grid-column:1/3;color:var(--muted)">${i.note}</span>`
    : `<span>BMR</span><b>${i.bmr_kcal} kcal</b>
       <span>Work</span><b>${i.work_hours} h · ${i.work_kcal} kcal</b>
       <span>Workouts</span><b>${i.workout_minutes} min · ${i.workout_kcal} kcal</b>
       <span>Est. burn</span><b>${i.est_total_burn_kcal} kcal</b>
       <span>Intake</span><b>${i.intake_kcal} kcal</b>
       <span>Net</span><b>${i.net_kcal} kcal</b>
       ${i.earnings ? `<span>Earned</span><b>$${i.earnings}</b>` : ""}`;
  const w = await api("/api/work/status");
  $("#w-toggle").textContent = w.id ? "Clock out" : "Clock in";
}
$("#m-save").onclick = async () => {
  await api("/api/metrics", { method: "POST", body: JSON.stringify({
    weight_kg: +$("#m-weight").value || null, height_cm: +$("#m-height").value || null,
    age_years: +$("#m-age").value || null, sex: $("#m-sex").value || null }) });
  toast("metrics logged"); loadLife();
};
$("#w-toggle").onclick = async () => {
  const w = await api("/api/work/status");
  if (w.id) { await api("/api/work/clockout", { method: "POST" }); toast("clocked out"); }
  else { await api("/api/work/clockin", { method: "POST", body: JSON.stringify({
    hourly_rate: +$("#w-rate").value || null, activity: $("#w-activity").value }) });
    toast("clocked in"); }
  loadLife();
};

/* ── service worker ───────────────────────────────────────────── */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
boot();
