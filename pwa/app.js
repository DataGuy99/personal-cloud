/* CloudDome PWA v2 — rail navigation, service pairing, kulikéun dump */
const CP = `${location.protocol}//${location.hostname}:3923`;
let ME = null, cwd = null, MYGROUPS = [], SVC = [], curGroup = null, curEntry = null,
    curChat = null, curView = "dump", tInterval = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = (m) => { const t = document.createElement("div"); t.className = "toast";
  t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
const fmtSize = (b) => b > 1e9 ? (b/1e9).toFixed(1)+" GB" : b > 1e6 ? (b/1e6).toFixed(1)+" MB"
  : b > 1e3 ? (b/1e3).toFixed(0)+" KB" : b+" B";
const fmtDay = (ts) => new Date(ts*1000).toLocaleDateString(undefined,{month:"short",day:"numeric"});
const fmtDT = (ts) => new Date(ts*1000).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
const hrs = (a,b) => (((b || Date.now()/1000) - a) / 3600);

/* ── auth ── */
async function boot() {
  try { ME = await api("/api/me"); postLogin(); }
  catch { $("#login-view").classList.remove("hidden"); }
}
$("#login-btn").onclick = async () => {
  try {
    ME = await api("/api/login", { method:"POST", body: JSON.stringify({
      username: $("#login-user").value.trim(), password: $("#login-pass").value }) });
    $("#login-view").classList.add("hidden"); postLogin();
  } catch { $("#login-err").textContent = "wrong username or password"; }
};
$("#login-pass").addEventListener("keydown", e => { if (e.key === "Enter") $("#login-btn").click(); });
function postLogin() {
  if (ME.must_change_pw) { $("#pwreset-view").classList.remove("hidden"); return; }
  enter();
}
$("#pw-set").onclick = async () => {
  const a = $("#pw-new").value, b = $("#pw-new2").value;
  if (a !== b) { $("#pw-err").textContent = "passwords don't match"; return; }
  try {
    await api("/api/password", { method:"POST", body: JSON.stringify({ new_password: a }) });
    ME.must_change_pw = false; $("#pwreset-view").classList.add("hidden"); enter();
  } catch (e) { $("#pw-err").textContent = e.message; }
};

async function enter() {
  document.cookie = `cppwd=${ME.file_token}; path=/; max-age=2592000`;
  $("#app-view").classList.remove("hidden");
  $("#whoami").textContent = ME.username;
  cwd = `/vault/${ME.username}`;
  MYGROUPS = await api("/api/groups");
  SVC = await api("/api/services");
  buildRail(); show("dump");
  refreshBadge(); setInterval(refreshBadge, 15000);
}

/* ── rail & routing ── */
const CORE = [
  { v:"dump", i:"💬", l:"Dump" }, { v:"files", i:"📁", l:"Files" }, { v:"dash", i:"📊", l:"Dash" }];
const SVCMETA = { work:{i:"⏱",l:"Work"}, fitness:{i:"💪",l:"Fitness"}, meals:{i:"🍽",l:"Meals"},
  sleep:{i:"😴",l:"Sleep"}, journal:{i:"📓",l:"Journal"} };
function buildRail() {
  const paired = SVC.filter(s => s.enabled).map(s => s.service);
  const items = [...CORE,
    ...paired.map(s => ({ v:s, i:SVCMETA[s].i, l:SVCMETA[s].l })),
    { v:"pending", i:"🛡️", l:"Pending", badge:true }];
  $("#rail-items").innerHTML = items.map(it =>
    `<button class="ritem" data-view="${it.v}"><span class="ri">${it.i}</span>
     <span class="rl">${it.l}</span>${it.badge ? '<em class="badge hidden" id="pending-badge"></em>' : ""}</button>`).join("");
  document.querySelectorAll(".ritem").forEach(b => b.onclick = () => {
    if (b.dataset.view === "journal") { openJournal(); railClose(); return; }
    show(b.dataset.view); railClose();
  });
}
function show(v) {
  curView = v;
  document.querySelectorAll(".vw").forEach(x => x.classList.add("hidden"));
  const el = $(`#view-${v}`); if (el) el.classList.remove("hidden");
  document.querySelectorAll(".ritem").forEach(b =>
    b.classList.toggle("active", b.dataset.view === v));
  $("#view-title").textContent = ({ dump:"Dump", files:"Files", dash:"Dash", work:"Work",
    fitness:"Fitness", meals:"Meals", sleep:"Sleep", pending:"Pending", settings:"Settings" })[v] || v;
  $("#mob-back").classList.toggle("show", v !== "dump");
  ({ dump:loadDump, files:loadFiles, dash:loadDash, work:loadWork, fitness:loadFit,
     meals:loadMeals, sleep:loadSleep, pending:loadPending, settings:loadSettings })[v]?.();
}
$("#rail-toggle").onclick = () => $("#rail").classList.toggle("open");
$("#mob-menu").onclick = () => { $("#rail").classList.add("open"); $("#railveil").classList.add("on"); };
$("#railveil").onclick = railClose;
$("#mob-back").onclick = () => show("dump");
function railClose() { if (matchMedia("(max-width:700px)").matches)
  { $("#rail").classList.remove("open"); $("#railveil").classList.remove("on"); } }

/* ── dump ── */
function chatSlug(n) { return n.toLowerCase().replace(/ /g, "-"); }
async function loadDump() {
  const pills = [{ id:null, name:"💾 My dump" }, ...MYGROUPS.map(g => ({ id:g.id, name:g.name }))];
  $("#chatpills").innerHTML = pills.map(p =>
    `<button data-gid="${p.id ?? ""}" class="${(p.id ?? null) === curChat ? "active" : ""}">${esc(p.name)}</button>`).join("");
  document.querySelectorAll("#chatpills button").forEach(b =>
    b.onclick = () => { curChat = b.dataset.gid ? +b.dataset.gid : null; loadDump(); });
  const items = await api(`/api/dump${curChat ? "?group_id=" + curChat : ""}`);
  $("#dumpfeed").innerHTML = items.map(bubbleHtml).join("") ||
    `<div class="empty">nothing here — drop something 💾</div>`;
  document.querySelectorAll(".bubble .del").forEach(b => b.onclick = async () => {
    await api(`/api/dump/${b.dataset.id}`, { method:"DELETE" }); loadDump(); });
  const f = $("#dumpfeed"); f.scrollTop = f.scrollHeight;
}
function bubbleHtml(m) {
  const mine = m.username === ME.username;
  const who = (!mine && curChat) ? `<span class="who">${esc(m.username)}</span>` : "";
  let body;
  if (m.kind === "link") body = `<a href="${esc(m.content)}" target="_blank">${esc(m.content)}</a>`;
  else if (m.kind === "file") {
    const url = `${CP}${encodeURI(m.file_path)}?pw=${ME.file_token}`;
    body = /\.(jpe?g|png|gif|webp)$/i.test(m.file_path)
      ? `<a href="${url}" target="_blank"><img src="${url}" onerror="this.outerHTML='📄 scanning…'"></a>
         <div class="fchip"><span>${esc(m.content || "")}</span></div>`
      : `<a href="${url}" target="_blank" class="fchip"><span class="fico">${icon(m.file_path)}</span>
         <span>${esc(m.content || m.file_path.split("/").pop())}</span></a>`;
  } else body = esc(m.content);
  const del = mine ? `<button class="del" data-id="${m.id}">✕</button>` : "";
  const t = new Date(m.created_at*1000).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
  return `<div class="bubble ${mine ? "mine" : "theirs"}">${del}${who}${body}<span class="when">${t}</span></div>`;
}
$("#dump-send").onclick = sendDump;
$("#dump-text").addEventListener("keydown", e => { if (e.key === "Enter") sendDump(); });
async function sendDump() {
  const content = $("#dump-text").value.trim();
  if (!content) return;
  await api("/api/dump", { method:"POST", body: JSON.stringify({ content, group_id: curChat }) });
  $("#dump-text").value = ""; loadDump();
}
$("#dump-attach").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const grp = curChat ? MYGROUPS.find(g => g.id === curChat) : null;
  const base = grp ? `/group/${chatSlug(grp.name)}/dump` : `/vault/${ME.username}/dump`;
  toast(`uploading ${f.name}…`);
  const r = await fetch(`${CP}/up${encodeURI(base)}/${encodeURIComponent(f.name)}`,
    { method:"PUT", headers:{ "PW": ME.file_token }, body: f });
  if (!r.ok) { toast(`upload failed (${r.status})`); return; }
  await api("/api/dump", { method:"POST", body: JSON.stringify({
    content: f.name, file_path: `${base}/${f.name}`, group_id: curChat }) });
  e.target.value = ""; toast("dropped — scanning"); loadDump(); refreshBadge();
};

/* ── files + search ── */
async function loadFiles() {
  $("#crumbs").innerHTML = crumbHtml(cwd);
  const r = await fetch(`${CP}${encodeURI(cwd)}/?ls`, { headers:{ "PW": ME.file_token } });
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
  : /\.(mp4|mkv|mov|avi|webm)$/i.test(n) ? "🎬" : /\.(mp3|flac|ogg|m4a|wav)$/i.test(n) ? "🎵"
  : /\.(pdf|docx?|txt|md|epub)$/i.test(n) ? "📄" : "📦";
const frow = (ico, name, sz, isDir) =>
  `<div class="frow" data-name="${encodeURIComponent(name)}" data-dir="${isDir ? 1 : 0}">
     <span class="fico">${ico}</span><span class="fname">${esc(name)}</span>
     ${sz != null ? `<span class="fsize">${fmtSize(sz)}</span>` : ""}</div>`;
function crumbHtml(path) {
  const parts = path.split("/").filter(Boolean); let acc = "";
  return parts.map((p, i) => { acc += "/" + p; const t = acc;
    return i < parts.length - 1
      ? `<a href="#" onclick="cwd='${t}';loadFiles();return false">${esc(p)}</a> / ` : esc(p); }).join("");
}
$("#upload-input").onchange = async (e) => {
  const files = [...e.target.files];
  const upBase = cwd.startsWith("/up") ? cwd : "/up" + cwd;
  for (const f of files) {
    toast(`uploading ${f.name}…`);
    const r = await fetch(`${CP}${encodeURI(upBase)}/${encodeURIComponent(f.name)}`,
      { method:"PUT", headers:{ "PW": ME.file_token }, body: f });
    toast(r.ok ? `${f.name} → scanning` : `upload failed (${r.status})`);
  }
  e.target.value = ""; setTimeout(refreshBadge, 1500);
};
$("#search-open").onclick = () => { $("#search-view").classList.remove("hidden");
  $("#search-q").value = ""; $("#search-results").innerHTML = ""; $("#search-q").focus(); };
$("#search-close").onclick = () => $("#search-view").classList.add("hidden");
let sTimer = null;
$("#search-q").addEventListener("input", () => {
  clearTimeout(sTimer); sTimer = setTimeout(runSearch, 350);
});
async function runSearch() {
  const q = $("#search-q").value.trim();
  if (!q) { $("#search-results").innerHTML = ""; return; }
  const r = await fetch(`${CP}/?srch=${encodeURIComponent(q)}`, { headers:{ "PW": ME.file_token } });
  if (!r.ok) { $("#search-results").innerHTML = `<div class="srow">search unavailable (${r.status})</div>`; return; }
  const j = await r.json().catch(() => ({ hits: [] }));
  const hits = j.hits || [];
  $("#search-results").innerHTML = hits.slice(0, 40).map(h =>
    `<div class="srow" data-vp="${esc(h.rp || h.vp || "")}"><span>${esc((h.rp || h.vp || "").split("/").pop())}</span>
     <span class="spath">${esc(h.rp || h.vp || "")}</span></div>`).join("")
    || `<div class="srow">no matches</div>`;
  document.querySelectorAll(".srow[data-vp]").forEach(el => el.onclick = () =>
    window.open(`${CP}/${encodeURI(el.dataset.vp)}?pw=${ME.file_token}`, "_blank"));
}

/* ── dash (insights + groups) ── */
async function loadDash() {
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
  MYGROUPS = await api("/api/groups");
  $("#grouplist").innerHTML = MYGROUPS.map(g => `
    <div class="gcard" data-gid="${g.id}" data-name="${esc(g.name)}" data-role="${g.role}">
      <span>${g.kind === "work" ? "🏗️" : g.kind === "family" ? "🏠" : "📌"}</span>
      <span class="gname">${esc(g.name)}</span><span class="grole">${g.role}</span></div>`).join("")
    || `<div class="empty">no groups yet</div>`;
  document.querySelectorAll(".gcard").forEach(el => el.onclick = () => openGroup(el.dataset));
  $("#group-detail").classList.add("hidden");
}
$("#g-create").onclick = async () => {
  try { await api("/api/groups", { method:"POST", body: JSON.stringify({
      name: $("#g-name").value.trim(), kind: $("#g-kind").value }) });
    $("#g-name").value = ""; toast("group created"); loadDash();
  } catch (e) { toast(e.message); }
};
async function openGroup(d) {
  curGroup = d;
  $("#group-detail").classList.remove("hidden");
  $("#gd-name").textContent = d.name;
  $("#gd-role").textContent = `you are ${d.role}`;
  $("#gd-members-card").classList.toggle("hidden", !["owner","manager"].includes(d.role));
  $("#gd-files").onclick = (e) => { e.preventDefault();
    cwd = `/group/${chatSlug(d.name)}`; show("files"); };
  const rows = await api(`/api/groups/${d.gid}/work`).catch(() => []);
  $("#gd-work").innerHTML = rows.map(s => {
    const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h * s.hourly_rate).toFixed(2)}` : "";
    return `<div class="lrow"><div class="grow"><b>${esc(s.username)}</b> — ${esc(s.activity || "work")}${s.note ? " · " + esc(s.note) : ""}
      <span class="sub">${fmtDT(s.started_at)} · ${s.ended_at ? h.toFixed(1)+"h"+pay : "⏱ on the clock"}</span></div></div>`;
  }).join("") || `<div class="empty">no sessions logged to this group</div>`;
}
$("#gm-add").onclick = async () => {
  try { await api(`/api/groups/${curGroup.gid}/members`, { method:"POST", body: JSON.stringify({
      username: $("#gm-user").value.trim(), role: $("#gm-role").value }) });
    $("#gm-user").value = ""; toast("member added");
  } catch (e) { toast(e.message); }
};

/* ── work ── */
function tickTimer(startTs) {
  clearInterval(tInterval);
  const render = () => {
    const s = Math.floor(Date.now()/1000 - startTs);
    $("#t-elapsed").textContent =
      [s/3600, s/60%60, s%60].map(n => String(Math.floor(n)).padStart(2,"0")).join(":");
  };
  render(); tInterval = setInterval(render, 1000);
}
async function loadWork() {
  $("#w-group").innerHTML = `<option value="">personal</option>` +
    MYGROUPS.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  const svc = SVC.find(s => s.service === "work");
  const rate = svc?.settings?.hourly_rate;
  $("#w-rate-label").textContent = rate ? `· paired rate $${rate}/hr` : "· set rate in Settings";
  const w = await api("/api/work/status");
  const btn = $("#w-toggle");
  if (w.id) { btn.textContent = "Stop"; btn.classList.add("running");
    $("#t-sub").textContent = `${w.activity || "work"} since ${fmtDT(w.started_at)}`;
    tickTimer(w.started_at);
  } else { btn.textContent = "Start"; btn.classList.remove("running");
    $("#t-sub").textContent = "not on the clock";
    clearInterval(tInterval); $("#t-elapsed").textContent = "00:00:00"; }
  const rows = await api("/api/work/sessions");
  $("#worklist").innerHTML = rows.slice(0, 15).map(s => {
    const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h * s.hourly_rate).toFixed(2)}` : "";
    return `<div class="lrow"><div class="grow">${esc(s.activity || "work")}${s.note ? " — " + esc(s.note) : ""}
      <span class="sub">${fmtDT(s.started_at)} · ${s.ended_at ? h.toFixed(1)+"h"+pay : "⏱ running"}</span></div></div>`;
  }).join("") || `<div class="empty">no sessions</div>`;
}
$("#w-toggle").onclick = async () => {
  const w = await api("/api/work/status");
  if (w.id) { await api("/api/work/clockout", { method:"POST" }); toast("clocked out"); }
  else { await api("/api/work/clockin", { method:"POST", body: JSON.stringify({
      activity: $("#w-activity").value, group_id: +$("#w-group").value || null,
      note: $("#w-note").value || null }) }); toast("clocked in"); }
  loadWork();
};
$("#mw-save").onclick = async () => {
  const d = $("#mw-date").value;
  if (!d || !$("#mw-start").value || !$("#mw-end").value) { toast("date + start + end required"); return; }
  const ts = (t) => Math.floor(new Date(`${d}T${t}`).getTime() / 1000);
  try {
    await api("/api/work/manual", { method:"POST", body: JSON.stringify({
      started_at: ts($("#mw-start").value), ended_at: ts($("#mw-end").value),
      break_min: +$("#mw-break").value || 0, note: $("#mw-note").value || null }) });
    toast("entry added"); loadWork();
  } catch (e) { toast(e.message); }
};

/* ── fitness / meals / sleep ── */
async function loadFit() {
  const rows = await api("/api/workouts/recent");
  $("#wolist").innerHTML = rows.slice(0, 12).map(w => `
    <div class="lrow"><div class="grow">${esc(w.kind)}
      <span class="sub">${fmtDT(w.performed_at)} · ${w.duration_min || "?"} min</span></div>
      <span class="muted">~${w.est_kcal ?? "?"} kcal</span></div>`).join("")
    || `<div class="empty">no workouts</div>`;
}
$("#m-save").onclick = async () => {
  await api("/api/metrics", { method:"POST", body: JSON.stringify({
    weight_kg: +$("#m-weight").value || null, height_cm: +$("#m-height").value || null,
    age_years: +$("#m-age").value || null, sex: $("#m-sex").value || null }) });
  toast("metrics logged");
};
$("#wo-save").onclick = async () => {
  const r = await api("/api/workouts", { method:"POST", body: JSON.stringify({
    kind: $("#wo-kind").value, duration_min: +$("#wo-min").value || 0 }) });
  toast(r.est_kcal ? `logged · ~${r.est_kcal} kcal` : "logged"); loadFit();
};
async function loadMeals() {
  const plans = await api("/api/meals/plans");
  $("#pl-group").innerHTML = `<option value="">personal</option>` +
    MYGROUPS.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  $("#planlist").innerHTML = plans.map(p => `
    <div class="lrow"><div class="grow">${esc(p.recipe)}
      <span class="sub">${p.group_name ? "👥 " + esc(p.group_name) : "personal"} · ${esc(p.meal_slot || "")} ${esc(p.plan_date || "")} ${p.target_kcal ? "· " + p.target_kcal + " kcal" : ""}</span></div>
      <button class="act" data-pid="${p.id}">Log it</button></div>`).join("")
    || `<div class="empty">no plans yet</div>`;
  document.querySelectorAll("#planlist .act").forEach(b => b.onclick = async () => {
    await api("/api/meals", { method:"POST", body: JSON.stringify({ plan_id: +b.dataset.pid }) });
    toast("logged from plan"); loadMeals(); });
  const meals = await api("/api/meals/recent");
  $("#meallist").innerHTML = meals.slice(0, 12).map(m => `
    <div class="lrow"><div class="grow">${esc(m.name || "meal")}
      <span class="sub">${fmtDT(m.eaten_at)}${m.plan_id ? " · from plan" : ""}</span></div>
      <span class="muted">${m.kcal ?? "?"} kcal</span></div>`).join("")
    || `<div class="empty">nothing logged</div>`;
}
$("#ml-save").onclick = async () => {
  await api("/api/meals", { method:"POST", body: JSON.stringify({
    name: $("#ml-name").value || null, kcal: +$("#ml-kcal").value || null,
    protein_g: +$("#ml-protein").value || null }) });
  $("#ml-name").value = $("#ml-kcal").value = $("#ml-protein").value = "";
  toast("meal logged"); loadMeals();
};
$("#pl-save").onclick = async () => {
  await api("/api/meals/plans", { method:"POST", body: JSON.stringify({
    recipe: $("#pl-recipe").value, plan_date: $("#pl-date").value || null,
    meal_slot: $("#pl-slot").value, target_kcal: +$("#pl-kcal").value || null,
    group_id: +$("#pl-group").value || null }) });
  toast("plan created"); loadMeals();
};
async function loadSleep() {
  const rows = await api("/api/sleep/recent");
  $("#sleeplist").innerHTML = rows.map(s => {
    const dur = s.woke_at ? hrs(s.slept_at, s.woke_at).toFixed(1)+"h" : "?";
    return `<div class="lrow"><div class="grow">${fmtDay(s.slept_at)}
      <span class="sub">${dur}${s.quality ? " · quality " + s.quality + "/5" : ""}</span></div></div>`;
  }).join("") || `<div class="empty">no sleep synced — pair the puck</div>`;
}
$("#sleep-key").onclick = async () => {
  const r = await api("/api/sleep/devicekey", { method:"POST", body: JSON.stringify({ label:"alarm-puck" }) });
  const el = $("#sleep-key-out"); el.textContent = r.key; el.classList.remove("hidden");
  toast("key shown once — store it on the device");
};

/* ── pending ── */
async function refreshBadge() {
  try {
    const rows = await api(`/api/pending${ME.is_admin ? "?all=1" : ""}`);
    const n = rows.filter(r => r.status === "flagged").length;
    const b = $("#pending-badge");
    if (b) { b.textContent = n; b.classList.toggle("hidden", n === 0); }
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
      ${r.status === "flagged" ? `<div class="pacts"><button class="rel">Release</button><button class="rej">Delete</button></div>` : ""}
    </div>`).join("");
  document.querySelectorAll(".prow .rel").forEach(b => b.onclick = () => act(b, "release"));
  document.querySelectorAll(".prow .rej").forEach(b => b.onclick = () => act(b, "reject"));
}
async function act(btn, action) {
  const id = btn.closest(".prow").dataset.id;
  try { await api(`/api/pending/${id}/${action}`, { method:"POST" });
    toast(action === "release" ? "released ✓" : "deleted"); loadPending(); refreshBadge(); }
  catch (e) { toast(e.message); }
}

/* ── settings ── */
const SVCDESC = { work:"hours, earnings, org visibility", fitness:"metrics, workouts, MET burn",
  meals:"logging, plans, group linking", sleep:"puck sync, quality", journal:"private writing" };
async function loadSettings() {
  SVC = await api("/api/services");
  $("#svc-list").innerHTML = SVC.map(s => `
    <div class="svcrow" data-svc="${s.service}">
      <div class="grow"><div class="sname">${SVCMETA[s.service].i} ${SVCMETA[s.service].l}</div>
        <div class="ssub">${SVCDESC[s.service]}</div></div>
      ${s.service === "work" ? `<input class="rate" type="number" step="0.5" placeholder="$/hr"
        value="${s.settings.hourly_rate ?? ""}">` : ""}
      <div class="sw ${s.enabled ? "on" : ""}"></div>
    </div>`).join("");
  document.querySelectorAll(".svcrow .sw").forEach(sw => sw.onclick = () => saveSvc(sw.closest(".svcrow"), !sw.classList.contains("on")));
  document.querySelectorAll(".svcrow .rate").forEach(r => r.onchange = () => {
    const row = r.closest(".svcrow");
    saveSvc(row, row.querySelector(".sw").classList.contains("on")); });
  if (ME.is_admin) {
    $("#admin-rb").classList.remove("hidden");
    const users = await api("/api/users");
    $("#userlist").innerHTML = users.map(u => `
      <div class="urow"><div class="grow">${esc(u.username)}
        <span class="sub" style="color:#6f6f6f">joined ${fmtDay(u.created_at)}</span></div>
        ${u.is_admin ? '<span class="tag">ADMIN</span>' : ""}
        ${u.must_change_pw ? '<span class="tag">RESET PENDING</span>' : ""}
        ${u.disabled ? '<span class="tag">DISABLED</span>' : ""}</div>`).join("");
  }
}
async function saveSvc(row, enabled) {
  const svc = row.dataset.svc;
  const settings = {};
  const rate = row.querySelector(".rate");
  if (rate && rate.value) settings.hourly_rate = +rate.value;
  await api(`/api/services/${svc}`, { method:"PUT",
    body: JSON.stringify({ enabled, settings }) });
  row.querySelector(".sw").classList.toggle("on", enabled);
  SVC = await api("/api/services");
  buildRail(); toast(enabled ? `${svc} paired` : `${svc} unpaired`);
}
$("#cp-save").onclick = async () => {
  try { await api("/api/password", { method:"POST", body: JSON.stringify({
      current_password: $("#cp-cur").value, new_password: $("#cp-new").value }) });
    $("#cp-cur").value = $("#cp-new").value = ""; toast("password changed");
  } catch (e) { toast(e.message); }
};
$("#au-add").onclick = async () => {
  try { const r = await api("/api/users", { method:"POST", body: JSON.stringify({
      username: $("#au-name").value.trim(), password: $("#au-pass").value }) });
    toast(r.warning || "user created — they'll set their own password");
    $("#au-name").value = $("#au-pass").value = ""; loadSettings();
  } catch (e) { toast(e.message); }
};
$("#logout").onclick = async () => { await api("/api/logout", { method:"POST" }); location.reload(); };

/* ── journal ── */
function openJournal() { $("#app-view").classList.add("hidden");
  $("#journal-view").classList.remove("hidden"); loadJournal(); }
$("#j-close").onclick = (e) => { e.preventDefault();
  $("#journal-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); };
async function loadJournal() {
  $("#j-editor").classList.add("hidden"); $("#j-list").classList.remove("hidden");
  const rows = await api("/api/journal");
  $("#j-list").innerHTML = rows.map(e => `
    <div class="jrow" data-id="${e.id}"><span class="jdate">${fmtDay(e.created_at)}</span>
      <h4>${esc(e.title || "untitled")}</h4><p>${esc(e.body || "")}</p></div>`).join("")
    || `<div class="empty">empty pages, waiting</div>`;
  document.querySelectorAll(".jrow").forEach(el => el.onclick = async () => {
    const rows2 = await api("/api/journal");
    openEditor(rows2.find(x => x.id === +el.dataset.id)); });
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
  if (curEntry) await api(`/api/journal/${curEntry.id}`, { method:"PUT", body: JSON.stringify(payload) });
  else await api("/api/journal", { method:"POST", body: JSON.stringify(payload) });
  toast("saved"); loadJournal();
};
$("#j-delete").onclick = async () => {
  await api(`/api/journal/${curEntry.id}`, { method:"DELETE" }); toast("deleted"); loadJournal();
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
boot();
