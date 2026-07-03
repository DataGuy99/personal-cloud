/* CloudDome PWA v2 — rail navigation, service pairing, kulikéun dump */
const CP = `${location.protocol}//${location.hostname}:3923`;
let ME = null, cwd = null, MYGROUPS = [], SVC = [], PEERS = [], curGroup = null,
    curEntry = null, curChat = null, curPeer = null, curView = "dump", tInterval = null;

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
const SVCAPP = { fitness:"workout-gen", meals:"meal-prep" };   // paired → ported app
function buildRail() {
  const paired = SVC.filter(s => s.enabled).map(s => s.service);
  const items = [...CORE,
    ...paired.map(s => ({ v:s, i:SVCMETA[s].i, l:SVCMETA[s].l })),
    { v:"pending", i:"🛡️", l:"Pending", badge:true }];
  const APPS = [ { n:"contract-manager", i:"📋", l:"Contracts" } ];
  $("#rail-items").innerHTML = items.map(it =>
    `<button class="ritem" data-view="${it.v}"><span class="ri">${it.i}</span>
     <span class="rl">${it.l}</span>${it.badge ? '<em class="badge hidden" id="pending-badge"></em>' : ""}</button>`).join("")
    + `<div style="height:1px;background:#1e2a36;margin:6px 8px"></div>`
    + APPS.map(a => `<button class="ritem" data-app="${a.n}"><span class="ri">${a.i}</span>
       <span class="rl">${a.l}</span></button>`).join("");
  document.querySelectorAll(".ritem[data-app]").forEach(b =>
    b.onclick = () => { location.href = `/apps/${b.dataset.app}/`; });
  document.querySelectorAll(".ritem:not([data-app])").forEach(b => b.onclick = () => {
    const v = b.dataset.view;
    if (v === "journal") { openJournal(); railClose(); return; }
    if (SVCAPP[v]) { location.href = `/apps/${SVCAPP[v]}/`; return; }
    show(v); railClose();
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
  ({ dump:loadDump, files:loadFiles, dash:loadDash, work:loadWork,
     sleep:loadSleep, pending:loadPending, settings:loadSettings })[v]?.();
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
  PEERS = await api("/api/dump/peers").catch(() => PEERS);
  const pills = [{ id:null, name:"💾 My dump" }, ...MYGROUPS.map(g => ({ id:g.id, name:g.name })),
    ...PEERS.map(u => ({ peer:u, name:u }))];
  $("#chatpills").innerHTML = pills.map(p =>
    `<button ${p.peer ? `data-peer="${esc(p.peer)}" class="dm ${curPeer === p.peer ? "active" : ""}"`
      : `data-gid="${p.id ?? ""}" class="${!curPeer && (p.id ?? null) === curChat ? "active" : ""}"`}>${esc(p.name)}</button>`).join("");
  document.querySelectorAll("#chatpills button").forEach(b => b.onclick = () => {
    if (b.dataset.peer) { curPeer = b.dataset.peer; curChat = null; }
    else { curPeer = null; curChat = b.dataset.gid ? +b.dataset.gid : null; }
    loadDump(); });
  const q = curPeer ? `?peer=${encodeURIComponent(curPeer)}` : curChat ? `?group_id=${curChat}` : "";
  const items = await api(`/api/dump${q}`);
  $("#dumpfeed").innerHTML = items.map(bubbleHtml).join("") ||
    `<div class="empty">nothing here — drop something 💾</div>`;
  document.querySelectorAll(".bubble .del").forEach(b => b.onclick = async () => {
    await api(`/api/dump/${b.dataset.id}`, { method:"DELETE" }); loadDump(); });
  document.querySelectorAll(".sh-save").forEach(b => b.onclick = async () => {
    let p = {}; try { p = JSON.parse(b.dataset.json); } catch {}
    if (!p.app) return;
    await api(`/api/kv/${p.app}`, { method:"PUT", body: JSON.stringify({
      ["inbox_" + Date.now()]: JSON.stringify(p) }) });
    toast(`saved — open ${p.app} and import from inbox/backup`); });
  const f = $("#dumpfeed"); f.scrollTop = f.scrollHeight;
}
function bubbleHtml(m) {
  const mine = m.username === ME.username;
  const who = (!mine && (curChat || curPeer)) ? `<span class="who">${esc(m.username)}</span>` : "";
  let body;
  if (m.kind === "link") body = `<a href="${esc(m.content)}" target="_blank">${esc(m.content)}</a>`;
  else if (m.kind === "file") {
    const url = `${CP}${encodeURI(m.file_path)}?pw=${ME.file_token}`;
    body = /\.(jpe?g|png|gif|webp)$/i.test(m.file_path)
      ? `<a href="${url}" target="_blank"><img src="${url}" onerror="this.outerHTML='📄 scanning…'"></a>
         <div class="fchip"><span>${esc(m.content || "")}</span></div>`
      : `<a href="${url}" target="_blank" class="fchip"><span class="fico">${icon(m.file_path)}</span>
         <span>${esc(m.content || m.file_path.split("/").pop())}</span></a>`;
  } else if (m.kind === "share") {
    let p = {}; try { p = JSON.parse(m.content); } catch {}
    body = `<div class="share-card"><div class="st">${p.type === "workout" ? "🏋️" : p.type === "recipe" || p.type === "meal" ? "🥘" : "📦"} ${esc(p.title || p.type || "shared item")}</div>
      <div class="ss">from ${esc(p.app || "?")}</div>
      <button class="sh-save" data-json='${esc(m.content)}'>Save to my ${esc(p.app || "apps")}</button></div>`;
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
  await api("/api/dump", { method:"POST", body: JSON.stringify({
    content, group_id: curChat, to_username: curPeer }) });
  $("#dump-text").value = ""; loadDump();
}
$("#dm-open").onclick = async () => {
  const u = $("#dm-user").value.trim().replace(/^@/, "");
  if (!u) return;
  curPeer = u; curChat = null; $("#dm-user").value = "";
  if (!PEERS.includes(u)) PEERS.push(u);
  loadDump();
};
$("#dump-attach").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const grp = curChat ? MYGROUPS.find(g => g.id === curChat) : null;
  const base = grp ? `/group/${chatSlug(grp.name)}/dump` : `/vault/${ME.username}/dump`;
  // NOTE: DM file recipients can't read your vault — group or self dumps only for files (flagged)
  if (curPeer) { toast("file DMs need a share-space — coming with per-DM folders"); return; }
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
  const d = DTP["mw-date"], s1 = DTP["mw-start"], s2 = DTP["mw-end"];
  if (!d || !s1 || !s2) { toast("date + start + end required"); return; }
  const ts = (t) => Math.floor(new Date(`${d}T${t}`).getTime() / 1000);
  try {
    await api("/api/work/manual", { method:"POST", body: JSON.stringify({
      started_at: ts(s1), ended_at: ts(s2),
      break_min: +$("#mw-break").value || 0, note: $("#mw-note").value || null }) });
    toast("entry added"); loadWork();
  } catch (e) { toast(e.message); }
};

/* ── sleep ── */
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
const SVCDESC = { work:"hours, earnings, org visibility", fitness:"opens Workout Gen (ported)",
  meals:"opens Meal Prep (ported)", sleep:"puck sync, quality", journal:"private writing" };
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

/* ── custom controls ── */
function cselectAll(root = document) {
  root.querySelectorAll("select:not([data-cs])").forEach(sel => {
    sel.dataset.cs = "1"; sel.style.display = "none";
    const wrap = document.createElement("div"); wrap.className = "cs";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "cs-btn";
    const label = () => sel.options[sel.selectedIndex]?.text || "—";
    btn.textContent = label();
    wrap.appendChild(btn); sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".cs-menu").forEach(m => m.remove());
      const menu = document.createElement("div"); menu.className = "cs-menu";
      [...sel.options].forEach((o, i) => {
        const d = document.createElement("div");
        d.className = "cs-opt" + (i === sel.selectedIndex ? " sel" : "");
        d.textContent = o.text;
        d.onclick = () => { sel.selectedIndex = i; sel.dispatchEvent(new Event("change"));
          btn.textContent = label(); menu.remove(); };
        menu.appendChild(d);
      });
      wrap.appendChild(menu);
    };
    new MutationObserver(() => { btn.textContent = label(); })
      .observe(sel, { childList: true });
  });
}
document.addEventListener("click", () => document.querySelectorAll(".cs-menu").forEach(m => m.remove()));
new MutationObserver(() => cselectAll()).observe(document.body, { childList: true, subtree: true });
cselectAll();

/* custom date + time pickers (dtp) */
const DTP = {};   // id -> value ("YYYY-MM-DD" | "HH:MM")
function dtpInit() {
  document.querySelectorAll(".dtp-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".dtp-pop").forEach(p => p.remove());
      btn.parentNode.appendChild(btn.dataset.kind === "date" ? dtpCal(btn) : dtpTime(btn));
    };
  });
}
document.addEventListener("click", () => document.querySelectorAll(".dtp-pop").forEach(p => p.remove()));
function dtpCal(btn) {
  const pop = document.createElement("div"); pop.className = "dtp-pop";
  pop.onclick = (e) => e.stopPropagation();
  let cur = DTP[btn.id] ? new Date(DTP[btn.id]) : new Date();
  const render = () => {
    const y = cur.getFullYear(), m = cur.getMonth();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    pop.innerHTML = `<div class="dtp-head"><button data-d="-1">‹</button>
      <span>${cur.toLocaleString(undefined,{month:"long",year:"numeric"})}</span>
      <button data-d="1">›</button></div>
      <div class="dtp-grid">${["S","M","T","W","T","F","S"].map(d=>`<span class="dow">${d}</span>`).join("")}
      ${"<span></span>".repeat(first)}
      ${Array.from({length:days},(_,i)=>`<span class="day">${i+1}</span>`).join("")}</div>`;
    pop.querySelectorAll(".dtp-head button").forEach(b => b.onclick = () => {
      cur.setMonth(cur.getMonth() + +b.dataset.d); render(); });
    pop.querySelectorAll(".day").forEach(d => d.onclick = () => {
      const dd = String(d.textContent).padStart(2,"0"), mm = String(m+1).padStart(2,"0");
      DTP[btn.id] = `${y}-${mm}-${dd}`;
      btn.textContent = new Date(DTP[btn.id]+"T12:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
      pop.remove(); });
  };
  render(); return pop;
}
function dtpTime(btn) {
  const pop = document.createElement("div"); pop.className = "dtp-pop";
  pop.onclick = (e) => e.stopPropagation();
  const [ch, cm] = (DTP[btn.id] || "09:00").split(":").map(Number);
  pop.innerHTML = `<div class="tp-wheels">
    <div class="tp-col" id="tp-h">${Array.from({length:24},(_,i)=>`<div class="${i===ch?"sel":""}">${String(i).padStart(2,"0")}</div>`).join("")}</div>
    <b>:</b>
    <div class="tp-col" id="tp-m">${Array.from({length:12},(_,i)=>`<div class="${i*5===cm?"sel":""}">${String(i*5).padStart(2,"0")}</div>`).join("")}</div>
  </div>`;
  const pick = () => {
    const h = pop.querySelector("#tp-h .sel")?.textContent || "09";
    const m = pop.querySelector("#tp-m .sel")?.textContent || "00";
    DTP[btn.id] = `${h}:${m}`; btn.textContent = DTP[btn.id];
  };
  pop.querySelectorAll(".tp-col div").forEach(d => d.onclick = () => {
    d.parentNode.querySelectorAll("div").forEach(x => x.classList.remove("sel"));
    d.classList.add("sel"); pick(); });
  return pop;
}
dtpInit();

/* telegram-style drop overlay (dump view) */
let dragDepth = 0;
addEventListener("dragenter", (e) => {
  if (curView !== "dump" || !e.dataTransfer?.types.includes("Files")) return;
  dragDepth++; $("#dropzone").classList.remove("hidden");
});
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropzone").classList.add("hidden"); } });
addEventListener("dragover", (e) => e.preventDefault());
["dz-orig","dz-quick"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("dragover", () => el.classList.add("hot"));
  el.addEventListener("dragleave", () => el.classList.remove("hot"));
  el.addEventListener("drop", async (e) => {
    e.preventDefault(); dragDepth = 0;
    $("#dropzone").classList.add("hidden"); el.classList.remove("hot");
    for (const f of e.dataTransfer.files)
      await dumpUpload(id === "dz-quick" ? await maybeCompress(f) : f);
  });
});
addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; $("#dropzone").classList.add("hidden"); });
async function maybeCompress(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
  const img = await createImageBitmap(f);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (scale === 1 && f.type === "image/jpeg") return f;
  const c = document.createElement("canvas");
  c.width = img.width * scale; c.height = img.height * scale;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  return new File([blob], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}
async function dumpUpload(f) {
  const grp = curChat ? MYGROUPS.find(g => g.id === curChat) : null;
  if (curPeer) { toast("file DMs need a share-space — coming"); return; }
  const base = grp ? `/group/${chatSlug(grp.name)}/dump` : `/vault/${ME.username}/dump`;
  toast(`uploading ${f.name}…`);
  const r = await fetch(`${CP}/up${encodeURI(base)}/${encodeURIComponent(f.name)}`,
    { method: "PUT", headers: { "PW": ME.file_token }, body: f });
  if (!r.ok) { toast(`upload failed (${r.status})`); return; }
  await api("/api/dump", { method: "POST", body: JSON.stringify({
    content: f.name, file_path: `${base}/${f.name}`, group_id: curChat }) });
  loadDump(); refreshBadge();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
boot();
