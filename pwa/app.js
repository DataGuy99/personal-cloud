/* Nook — CloudDome PWA. Vanilla, no build step, no CDN runtime.
   Theme engine ported from the Nook design prototype (tone × light/dark × surface).
   Data comes from the platform API (/api/*) and copyparty (:3923). */

const CP = `${location.protocol}//${location.hostname}:3923`;

/* ── theme (exact tokens from the Nook prototype) ── */
const TONE = {
  warm:    { light:{bg:'#ece8e0',panel:'#f4f1ea',panel2:'#e6e1d7',ink:'#23201a',dim:'#8b8579',line:'#d6d0c3'},
             dark: {bg:'#16140f',panel:'#1e1b15',panel2:'#26221b',ink:'#e9e4d8',dim:'#8a8474',line:'#332e26'} },
  neutral: { light:{bg:'#eae9e6',panel:'#f3f2ef',panel2:'#e3e2de',ink:'#20201e',dim:'#86847f',line:'#d3d2cd'},
             dark: {bg:'#151512',panel:'#1d1d1a',panel2:'#252521',ink:'#e7e6e1',dim:'#87857e',line:'#302f2b'} },
  cool:    { light:{bg:'#e8eaec',panel:'#f1f3f4',panel2:'#e0e3e5',ink:'#1e2226',dim:'#7f858b',line:'#d0d4d7'},
             dark: {bg:'#131517',panel:'#1b1e20',panel2:'#232729',ink:'#e3e7ea',dim:'#828990',line:'#2c3033'} },
};
const ACCENT = ['#6f7d55', '#aebd88'];   // [light, dark]
const UI = { tone: 'warm', mode: 'dark', surface: 'flat' };

function surfaceVars(dark, surf) {
  if (surf === 'soft') return { card:'var(--panel)', cardBd:'1px solid transparent',
    sh: dark ? '5px 5px 13px rgba(0,0,0,.5), -5px -5px 13px rgba(255,255,255,.035)'
             : '6px 6px 15px rgba(120,108,86,.18), -6px -6px 15px rgba(255,255,255,.8)', bdrop:'none' };
  if (surf === 'glass') return { card: dark ? 'rgba(38,34,27,.5)' : 'rgba(246,244,239,.5)',
    cardBd: '1px solid ' + (dark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.55)'),
    sh:'0 12px 36px rgba(0,0,0,.16)', bdrop:'blur(14px) saturate(1.25)' };
  return { card:'var(--panel)', cardBd:'1px solid var(--line)', sh:'none', bdrop:'none' };
}
function applyTheme() {
  const dark = UI.mode === 'dark';
  const t = (TONE[UI.tone] || TONE.warm)[dark ? 'dark' : 'light'];
  const accent = dark ? ACCENT[1] : ACCENT[0];
  const sv = surfaceVars(dark, UI.surface);
  const r = document.documentElement.style;
  Object.entries(t).forEach(([k, v]) => r.setProperty(`--${k}`, v));
  r.setProperty('--accent', accent);
  r.setProperty('--hl', `color-mix(in oklab, ${accent} ${dark ? 28 : 24}%, ${t.panel})`);
  Object.entries(sv).forEach(([k, v]) => r.setProperty(`--${k}`, v));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
  ['surf', 'tone', 'mode'].forEach(g => {
    const val = { surf: UI.surface, tone: UI.tone, mode: UI.mode }[g];
    document.querySelectorAll(`#${g}seg button`).forEach(b => b.classList.toggle('on', b.dataset.v === val));
  });
}
async function saveUI() {
  try { localStorage.setItem('nook-ui', JSON.stringify(UI)); } catch {}
  api('/api/kv/nook', { method:'PUT', body: JSON.stringify({ ui: JSON.stringify(UI) }) }).catch(() => {});
}
async function loadUI() {
  try { Object.assign(UI, JSON.parse(localStorage.getItem('nook-ui') || '{}')); } catch {}
  applyTheme();
  try {
    const kv = await api('/api/kv/nook');
    if (kv.ui) { Object.assign(UI, JSON.parse(kv.ui)); applyTheme(); }
  } catch {}
}

/* ── util ── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (m) => { const t = document.createElement('div'); t.className = 'toast';
  t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
const size = (b) => b > 1e9 ? (b/1e9).toFixed(1)+' GB' : b > 1e6 ? (b/1e6).toFixed(1)+' MB'
  : b > 1e3 ? (b/1e3).toFixed(0)+' KB' : b+' B';
const day = (ts) => new Date(ts*1000).toLocaleDateString(undefined, {month:'short', day:'numeric'});
const dt  = (ts) => new Date(ts*1000).toLocaleString(undefined, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const hrs = (a, b) => (((b || Date.now()/1000) - a) / 3600);
const slug = (n) => n.toLowerCase().replace(/ /g, '-');
const ficon = (n) => /\.(jpe?g|png|gif|webp|heic)$/i.test(n) ? '▣'
  : /\.(mp4|mkv|mov|avi|webm)$/i.test(n) ? '▶' : /\.(mp3|flac|ogg|m4a|wav)$/i.test(n) ? '♪'
  : /\.(pdf|docx?|txt|md|epub)$/i.test(n) ? '▤' : '◫';

/* ── state ── */
let ME = null, SVC = [], GROUPS = [], PEERS = [], cwd = null,
    chat = null, peer = null, view = 'home', tick = null, WSESS = [], curJ = null, curG = null;

/* ── auth ── */
async function boot() {
  try { ME = await api('/api/me'); await enter(); }
  catch { $('#v-login').classList.remove('hidden'); }
}
$('#lg-go').onclick = async () => {
  try {
    ME = await api('/api/login', { method:'POST', body: JSON.stringify({
      username: $('#lg-user').value.trim(), password: $('#lg-pass').value }) });
    $('#v-login').classList.add('hidden');
    if (ME.must_change_pw) return $('#v-setpw').classList.remove('hidden');
    await enter();
  } catch { $('#lg-err').textContent = 'wrong user or password'; }
};
$('#lg-pass').addEventListener('keydown', e => e.key === 'Enter' && $('#lg-go').click());
$('#sp-go').onclick = async () => {
  const a = $('#sp-a').value, b = $('#sp-b').value;
  if (a !== b) return $('#sp-err').textContent = "passwords don't match";
  try {
    await api('/api/password', { method:'POST', body: JSON.stringify({ new_password: a }) });
    ME.must_change_pw = false; $('#v-setpw').classList.add('hidden'); await enter();
  } catch (e) { $('#sp-err').textContent = e.message; }
};
$('#lockbtn').onclick = async () => { await api('/api/logout', { method:'POST' }); location.reload(); };

async function enter() {
  document.cookie = `cppwd=${ME.file_token}; path=/; max-age=2592000`;
  $('#v-app').classList.remove('hidden');
  $('#who').textContent = ME.username;
  $('#avatar').textContent = ME.username[0];
  $('#pname').textContent = ME.username;
  $('#prole').textContent = ME.is_admin ? 'administrator' : 'member';
  cwd = `/vault/${ME.username}`;
  GROUPS = await api('/api/groups').catch(() => []);
  SVC = await api('/api/services').catch(() => []);
  await loadUI();
  buildNav(); show('home');
  badge(); setInterval(badge, 15000);
}

/* ── nav ── */
const CORE = [['home','Home','◈'], ['archive','Archive','▤'], ['photos','Photos','▣'], ['shelf','Shelf','▥']];
const SVCNAV = { work:['hours','Hours','◷'], fitness:['workout','Workout','◍'], meals:['meal','Meal Prep','◐'],
                 sleep:['sleep','Sleep','☾'], journal:['journal','Journal','✎'] };
const SVCAPP = { workout:'workout-gen', meal:'meal-prep', contractor:'contract-manager' };

function buildNav() {
  const paired = SVC.filter(s => s.enabled).map(s => s.service);
  const items = [...CORE];
  paired.forEach(s => SVCNAV[s] && items.push(SVCNAV[s]));
  items.push(['contractor','Contractor','◰'], ['review','Review','◇']);
  $('#nav').innerHTML = items.map(([v, l, i]) =>
    `<button class="navitem" data-view="${v}"><span class="ni">${i}</span><span class="nl">${l}</span>${
      v === 'review' ? '<em class="badge hidden" id="pbadge"></em>' : ''}</button>`).join('');
  $$('.navitem[data-view]').forEach(b => b.onclick = () => {
    const v = b.dataset.view;
    if (SVCAPP[v]) return location.href = `/apps/${SVCAPP[v]}/`;
    show(v); closeNav();
  });
}
const TITLES = { home:'Home', archive:'Archive', photos:'Photos', shelf:'Shelf', hours:'Hours',
  sleep:'Sleep', journal:'Journal', review:'Review', settings:'Settings' };
function show(v) {
  view = v;
  $$('.view').forEach(x => x.classList.add('hidden'));
  $(`#w-${v}`)?.classList.remove('hidden');
  $$('.navitem').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#title').textContent = TITLES[v] || v;
  ({ home:loadHome, archive:loadFiles, photos:loadPhotos, shelf:loadShelf, hours:loadHours,
     sleep:loadSleep, journal:loadJournal, review:loadReview, settings:loadSettings })[v]?.();
}
$('#burger').onclick = () => { $('#side').classList.add('open'); $('#veil').classList.add('on'); };
$('#veil').onclick = closeNav;
$('.brand').onclick = () => matchMedia('(max-width:760px)').matches ? closeNav() : $('#side').classList.toggle('mini');
function closeNav() { $('#side').classList.remove('open'); $('#veil').classList.remove('on'); }

/* ══ HOME (dump stream) ══ */
async function loadHome() {
  const h = new Date().getHours();
  $('#greet').textContent = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  api('/api/insights/today').then(i => {
    $('#glance').innerHTML = i.note ? `<div class="pin dim">${esc(i.note)}</div>` :
      `<div class="pin">Burn<b>~${i.est_total_burn_kcal}</b></div>
       <div class="pin">Intake<b>${i.intake_kcal}</b></div>
       <div class="pin">Hours<b>${i.work_hours}h</b></div>
       ${i.earnings ? `<div class="pin">Earned<b>$${i.earnings}</b></div>` : ''}`;
  }).catch(() => {});

  PEERS = await api('/api/dump/peers').catch(() => PEERS);
  const chips = [{ id:null, n:'My dump' }, ...GROUPS.map(g => ({ id:g.id, n:g.name })),
                 ...PEERS.map(u => ({ peer:u, n:'@'+u }))];
  $('#homechips').innerHTML = chips.map(c => c.peer
    ? `<button data-peer="${esc(c.peer)}" class="${peer===c.peer?'on':''}">${esc(c.n)}</button>`
    : `<button data-gid="${c.id ?? ''}" class="${!peer && (c.id ?? null)===chat ? 'on':''}">${esc(c.n)}</button>`).join('');
  $$('#homechips button').forEach(b => b.onclick = () => {
    if (b.dataset.peer) { peer = b.dataset.peer; chat = null; }
    else { peer = null; chat = b.dataset.gid ? +b.dataset.gid : null; }
    loadHome();
  });

  const q = peer ? `?peer=${encodeURIComponent(peer)}` : chat ? `?group_id=${chat}` : '';
  const items = await api(`/api/dump${q}`);
  $('#stream').innerHTML = items.map(entryHtml).join('') || `<div class="empty">nothing here yet</div>`;
  wireStream();
  $('#stream').scrollTop = $('#stream').scrollHeight;
}
function entryHtml(m) {
  const mine = m.username === ME.username;
  const who = (!mine && (chat || peer)) ? `<span class="who">${esc(m.username)}</span>` : '';
  let meta = {}; try { meta = JSON.parse(m.meta || '{}'); } catch {}
  const blur = meta.sensitive ? ' blur' : '';
  const named = meta.showname !== false;
  let body;
  if (m.kind === 'link') body = `<a href="${esc(m.content)}" target="_blank" rel="noopener">${esc(m.content)}</a>`;
  else if (m.kind === 'file') {
    const url = `${CP}${encodeURI(m.file_path)}?pw=${ME.file_token}`;
    const nm = named ? `<div class="fchip"><span>${esc(m.content || '')}</span></div>` : '';
    if (/\.(jpe?g|png|gif|webp)$/i.test(m.file_path))
      body = `<img class="media${blur}" src="${url}" data-url="${url}" alt="" onerror="this.outerHTML='▤ scanning…'">${nm}`;
    else if (/\.(mp4|webm|mov|m4v)$/i.test(m.file_path))
      body = `<video class="media vid${blur}" src="${url}" muted loop playsinline preload="metadata"></video>${nm}`;
    else body = `<a class="fchip" href="${url}" target="_blank" rel="noopener"><span class="fi">${ficon(m.file_path)}</span>
      <span>${esc(m.content || m.file_path.split('/').pop())}</span></a>`;
  } else if (m.kind === 'share') {
    let p = {}; try { p = JSON.parse(m.content); } catch {}
    body = `<div class="sharecard"><div class="st">${esc(p.title || p.type || 'shared item')}</div>
      <div class="ss">from ${esc(p.app || '?')}</div>
      <button class="act shsave" data-json='${esc(m.content)}'>Save to my ${esc(p.app || 'apps')}</button></div>`;
  } else body = esc(m.content);
  const t = new Date(m.created_at*1000).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'});
  return `<div class="entry ${mine?'mine':'theirs'}" data-id="${m.id}" data-mine="${mine?1:0}"
    data-kind="${m.kind}" data-sens="${meta.sensitive?1:0}" data-name="${named?1:0}">${who}${body}<span class="when">${t}</span></div>`;
}
let vobs = null;
function wireStream() {
  vobs?.disconnect();
  vobs = new IntersectionObserver(es => es.forEach(e => {
    if (e.target.classList.contains('blur')) return e.target.pause();
    e.isIntersecting ? e.target.play().catch(()=>{}) : e.target.pause();
  }), { threshold: 0.5 });
  $$('.vid').forEach(v => vobs.observe(v));
  $$('.media.blur').forEach(el => el.onclick = () => {
    el.classList.toggle('blur');
    if (el.tagName === 'VIDEO') el.classList.contains('blur') ? el.pause() : el.play().catch(()=>{});
  });
  $$('img.media:not(.blur)').forEach(el => el.onclick = () => openLb(el.dataset.url));
  $$('.shsave').forEach(b => b.onclick = async () => {
    let p = {}; try { p = JSON.parse(b.dataset.json); } catch {}
    if (!p.app) return;
    await api(`/api/kv/${p.app}`, { method:'PUT', body: JSON.stringify({ ['inbox_'+Date.now()]: JSON.stringify(p) }) });
    toast(`saved — open ${p.app} and import from inbox`);
  });
  $$('.entry').forEach(e => {
    e.oncontextmenu = (ev) => { ev.preventDefault(); ctxMenu(e, ev.clientX, ev.clientY); };
    let lp;
    e.addEventListener('touchstart', () => lp = setTimeout(() =>
      ctxMenu(e, innerWidth/2 - 92, innerHeight/2), 550), { passive:true });
    ['touchend','touchmove'].forEach(v => e.addEventListener(v, () => clearTimeout(lp)));
  });
}
function ctxMenu(e, x, y) {
  $$('.ctx').forEach(m => m.remove());
  const mine = e.dataset.mine === '1', file = e.dataset.kind === 'file';
  const sens = e.dataset.sens === '1', named = e.dataset.name === '1';
  const acts = [];
  if (file) acts.push(['↗  open', () => e.querySelector('[data-url],video,a.fchip')?.click?.()]);
  if (mine && file) acts.push(
    [sens ? '◉  unmark sensitive' : '◌  mark sensitive', () => setMeta(e.dataset.id, { sensitive:!sens, showname:named })],
    [named ? '▢  hide filename' : '▣  show filename', () => setMeta(e.dataset.id, { sensitive:sens, showname:!named })]);
  if (mine) acts.push(['✕  delete', async () => { await api(`/api/dump/${e.dataset.id}`, {method:'DELETE'}); loadHome(); }]);
  if (!acts.length) return;
  const m = document.createElement('div'); m.className = 'ctx';
  m.style.left = Math.min(x, innerWidth-196)+'px'; m.style.top = Math.min(y, innerHeight-200)+'px';
  m.innerHTML = acts.map(([l], i) => `<div data-i="${i}">${l}</div>`).join('');
  m.querySelectorAll('div').forEach(o => o.onclick = () => { m.remove(); acts[+o.dataset.i][1](); });
  document.body.appendChild(m);
}
document.addEventListener('click', () => $$('.ctx').forEach(m => m.remove()));
async function setMeta(id, meta) { await api(`/api/dump/${id}/meta`, {method:'PUT', body:JSON.stringify(meta)}); loadHome(); }

$('#h-send').onclick = sendEntry;
$('#h-text').addEventListener('keydown', e => e.key === 'Enter' && sendEntry());
async function sendEntry() {
  const content = $('#h-text').value.trim();
  if (!content) return;
  await api('/api/dump', { method:'POST', body: JSON.stringify({ content, group_id: chat, to_username: peer }) });
  $('#h-text').value = ''; loadHome();
}
$('#h-file').onchange = async (e) => { const f = e.target.files[0]; if (f) await dumpUpload(f); e.target.value=''; };
async function dumpUpload(f) {
  if (peer) return toast('file DMs need a share-space — not built yet');
  const g = chat ? GROUPS.find(x => x.id === chat) : null;
  const base = g ? `/group/${slug(g.name)}` : `/vault/${ME.username}`;
  const name = `dump-${Date.now().toString(36)}-${f.name}`;
  toast(`uploading ${f.name}…`);
  const r = await fetch(`${CP}/up${encodeURI(base)}/${encodeURIComponent(name)}`,
    { method:'PUT', headers:{ PW: ME.file_token }, body: f });
  if (!r.ok) return toast(`upload failed (${r.status})`);
  await api('/api/dump', { method:'POST', body: JSON.stringify({
    content: f.name, file_path: `${base}/${name}`, group_id: chat }) });
  loadHome(); badge();
}

/* drop overlay */
let depth = 0;
addEventListener('dragenter', e => {
  if (view !== 'home' || !e.dataTransfer?.types.includes('Files')) return;
  depth++; $('#drop').classList.remove('hidden');
});
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#drop').classList.add('hidden'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); depth = 0; $('#drop').classList.add('hidden'); });
['dz-orig','dz-quick'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('dragover', () => el.classList.add('hot'));
  el.addEventListener('dragleave', () => el.classList.remove('hot'));
  el.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; $('#drop').classList.add('hidden'); el.classList.remove('hot');
    for (const f of e.dataTransfer.files) await dumpUpload(id === 'dz-quick' ? await shrink(f) : f);
  });
});
async function shrink(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
  const img = await createImageBitmap(f);
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (s === 1 && f.type === 'image/jpeg') return f;
  const c = document.createElement('canvas');
  c.width = img.width*s; c.height = img.height*s;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  return new File([blob], f.name.replace(/\.\w+$/, '.jpg'), { type:'image/jpeg' });
}

/* ══ ARCHIVE ══ */
async function loadFiles() {
  $('#crumbs').innerHTML = crumbs(cwd);
  const r = await fetch(`${CP}${encodeURI(cwd)}/?ls`, { headers:{ PW: ME.file_token } });
  if (!r.ok) return $('#files').innerHTML = `<div class="empty">can't reach files (${r.status})</div>`;
  const j = await r.json();
  const rows = [];
  (j.dirs || []).forEach(d => rows.push(frow('▸', d.href.replace(/\/$/,''), null, 1)));
  (j.files || []).forEach(f => rows.push(frow(ficon(f.href), f.href, f.sz, 0)));
  $('#files').innerHTML = rows.join('') || `<div class="empty">empty</div>`;
  $$('.frow').forEach(el => el.onclick = () => {
    const n = decodeURIComponent(el.dataset.n);
    if (el.dataset.d === '1') { cwd = `${cwd}/${n}`; loadFiles(); }
    else window.open(`${CP}${encodeURI(cwd)}/${encodeURIComponent(n)}?pw=${ME.file_token}`, '_blank');
  });
}
const frow = (i, n, s, d) => `<div class="frow" data-n="${encodeURIComponent(n)}" data-d="${d}">
  <span class="fi">${i}</span><span class="fn">${esc(n)}</span>${s!=null?`<span class="fs">${size(s)}</span>`:''}</div>`;
function crumbs(p) {
  const parts = p.split('/').filter(Boolean); let acc = '';
  return parts.map((x, i) => { acc += '/'+x; const t = acc;
    return i < parts.length-1 ? `<a href="#" data-cd="${t}">${esc(x)}</a> / ` : esc(x); }).join('');
}
document.addEventListener('click', e => {
  const a = e.target.closest('#crumbs a[data-cd]'); if (!a) return;
  e.preventDefault(); cwd = a.dataset.cd; loadFiles();
});
$('#up').onchange = async e => {
  const base = cwd.startsWith('/up') ? cwd : '/up'+cwd;
  for (const f of e.target.files) {
    toast(`uploading ${f.name}…`);
    const r = await fetch(`${CP}${encodeURI(base)}/${encodeURIComponent(f.name)}`,
      { method:'PUT', headers:{ PW: ME.file_token }, body: f });
    toast(r.ok ? `${f.name} → scanning` : `failed (${r.status})`);
  }
  e.target.value = ''; setTimeout(badge, 1500);
};

/* ══ SEARCH ══ */
$('#searchbtn').onclick = () => { $('#v-search').classList.remove('hidden'); $('#s-q').value=''; $('#s-out').innerHTML=''; $('#s-q').focus(); };
$('#s-close').onclick = () => $('#v-search').classList.add('hidden');
let stimer;
$('#s-q').addEventListener('input', () => { clearTimeout(stimer); stimer = setTimeout(runSearch, 340); });
async function runSearch() {
  const q = $('#s-q').value.trim();
  if (!q) return $('#s-out').innerHTML = '';
  const r = await fetch(`${CP}/?srch=${encodeURIComponent(q)}`, { headers:{ PW: ME.file_token } });
  if (!r.ok) return $('#s-out').innerHTML = `<div class="srow">search unavailable (${r.status})</div>`;
  const j = await r.json().catch(() => ({hits:[]}));
  const hits = j.hits || [];
  $('#s-out').innerHTML = hits.slice(0, 40).map(h => { const p = h.rp || h.vp || '';
    return `<div class="srow" data-vp="${esc(p)}"><span>${esc(p.split('/').pop())}</span><span class="sp">${esc(p)}</span></div>`;
  }).join('') || `<div class="srow">no matches</div>`;
  $$('.srow[data-vp]').forEach(el => el.onclick = () =>
    window.open(`${CP}/${encodeURI(el.dataset.vp)}?pw=${ME.file_token}`, '_blank'));
}

/* ══ PHOTOS ══ */
let phMode = 'mine';
document.addEventListener('click', e => {
  const b = e.target.closest('#phseg button'); if (!b) return;
  $$('#phseg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  phMode = b.dataset.m; loadPhotos();
});
async function loadPhotos() {
  $('#jf').href = `${location.protocol}//${location.hostname}:8096`;
  const screen = phMode === 'screen';
  $('#grid').classList.toggle('hidden', screen);
  $('#screenpane').classList.toggle('hidden', !screen);
  if (screen) {
    const out = [];
    for (const cat of ['movies','tv']) {
      const r = await fetch(`${CP}/public/${cat}/?ls`, { headers:{ PW: ME.file_token } });
      if (!r.ok) continue;
      const j = await r.json();
      [...(j.dirs||[]), ...(j.files||[])].forEach(f => out.push(
        `<div class="lrow"><div class="grow">${esc(decodeURIComponent(f.href.replace(/\/$/,'')))}
         <span class="sub">${cat}</span></div></div>`));
    }
    $('#lib').innerHTML = out.join('') || `<div class="empty">pool empty — drives &amp; libraries pending</div>`;
    return;
  }
  const base = phMode === 'mine' ? `/vault/${ME.username}` : '/public/photos';
  const imgs = await walk(base, 2, /\.(jpe?g|png|gif|webp)$/i);
  $('#grid').innerHTML = imgs.slice(0, 200).map(u => `<img loading="lazy" src="${u}" data-u="${u}" alt="">`).join('')
    || `<div class="empty">no photos in ${phMode === 'mine' ? 'your vault' : 'the family pool'} yet</div>`;
  $$('#grid img').forEach(im => im.onclick = () => openLb(im.dataset.u));
}
function openLb(u) { $('#lbimg').src = u; $('#lightbox').classList.remove('hidden'); }
$('#lightbox').onclick = () => $('#lightbox').classList.add('hidden');
async function walk(vp, depth, re, meta = false) {
  const r = await fetch(`${CP}${encodeURI(vp)}/?ls`, { headers:{ PW: ME.file_token } });
  if (!r.ok) return [];
  const j = await r.json();
  let out = (j.files || []).filter(f => re.test(f.href)).map(f => meta
    ? { name: decodeURIComponent(f.href), url: `${CP}${encodeURI(vp)}/${f.href}?pw=${ME.file_token}`, sz: f.sz }
    : `${CP}${encodeURI(vp)}/${f.href}?pw=${ME.file_token}`);
  if (depth > 0) for (const d of (j.dirs || []).slice(0, 12)) {
    if (d.href.startsWith('.')) continue;
    out = out.concat(await walk(`${vp}/${d.href.replace(/\/$/,'')}`, depth-1, re, meta));
  }
  return out;
}

/* ══ SHELF ══ */
let shMode = 'books';
document.addEventListener('click', e => {
  const b = e.target.closest('#shseg button'); if (!b) return;
  $$('#shseg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  shMode = b.dataset.s; loadShelf();
});
async function loadShelf() {
  const el = $('#shelf');
  el.innerHTML = `<div class="empty">reading the shelf…</div>`;
  const AUDIO = /\.(mp3|flac|ogg|m4a|wav|opus)$/i;
  const SHELVES = {
    books:      { paths: [`/vault/${ME.username}`, '/public/books', '/public/docs'],
                  re: /\.(pdf|epub|mobi|azw3)$/i },
    music:      { paths: ['/public/music'],      re: AUDIO },
    audiobooks: { paths: ['/public/audiobooks'], re: AUDIO },
    podcasts:   { paths: ['/public/podcasts'],   re: AUDIO },
  };
  const cfg = SHELVES[shMode] || SHELVES.books;
  let items = [];
  for (const p of cfg.paths) items = items.concat(await walk(p, 2, cfg.re, true).catch(() => []));
  el.innerHTML = items.slice(0, 120).map(f => {
    const ext = f.name.split('.').pop().toUpperCase();
    return `<div class="spine" data-u="${f.url}"><span class="kind">${ext}</span>
      <span class="t">${esc(f.name.replace(/\.\w+$/, ''))}</span></div>`;
  }).join('') || `<div class="empty">nothing on the ${shMode} shelf yet</div>`;
  $$('.spine').forEach(s => s.onclick = () => window.open(s.dataset.u, '_blank'));
}

/* ══ HOURS ══ */
const BASE_ACTS = ['desk','standing','driving','manual','construction'];
const wset = () => SVC.find(s => s.service === 'work')?.settings || {};
async function saveWset(patch) {
  await api('/api/services/work', { method:'PUT', body: JSON.stringify({ enabled:true, settings:{ ...wset(), ...patch } }) });
  SVC = await api('/api/services');
}
async function loadHours() {
  const st = wset();
  $('#ratelbl').textContent = st.hourly_rate ? `· $${st.hourly_rate}/hr` : '· set a rate in Settings';
  mkSelect($('#orgsel'), [['','personal'], ...GROUPS.map(g => [String(g.id), g.name])],
    st.default_group ? String(st.default_group) : '');
  $('#deforg').classList.toggle('on', !!st.default_group);
  $('#deforg').parentElement.onclick = () => {
    const on = !$('#deforg').classList.contains('on');
    $('#deforg').classList.toggle('on', on);
    saveWset({ default_group: on ? (+$('#orgsel').dataset.val || null) : null });
  };
  combo($('#act-c'), () => [...new Set([...(wset().activities || []), ...BASE_ACTS])],
    async v => saveWset({ activities: [...(wset().activities || []), v] }));

  const w = await api('/api/work/status');
  const btn = $('#tgo');
  if (w.id) { btn.textContent = 'Stop'; btn.classList.add('running');
    $('#tsub').textContent = `${w.activity || 'work'} since ${dt(w.started_at)}`; runClock(w.started_at); }
  else { btn.textContent = 'Start'; btn.classList.remove('running');
    $('#tsub').textContent = 'not on the clock'; clearInterval(tick); $('#tclock').textContent = '00:00:00'; }

  WSESS = await api('/api/work/sessions?days=120');
  const today = new Date(); today.setHours(0,0,0,0);
  const t0 = today.getTime()/1000;
  let th = 0, te = 0;
  WSESS.forEach(s => { if (s.started_at >= t0) { const h = hrs(s.started_at, s.ended_at); th += h; if (s.hourly_rate) te += h*s.hourly_rate; } });
  $('#hr-today').textContent = th.toFixed(1)+'h';
  $('#hr-earn').textContent = '$'+te.toFixed(2);
  renderIncome();
  $('#sessions').innerHTML = WSESS.slice(0, 25).map(s => {
    const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h*s.hourly_rate).toFixed(2)}` : '';
    return `<div class="lrow" data-sid="${s.id}"><div class="grow">${esc(s.activity || 'work')}${s.note?' — '+esc(s.note):''}
      <span class="sub">${dt(s.started_at)} · ${s.ended_at ? h.toFixed(1)+'h'+pay : 'running'}</span></div></div>`;
  }).join('') || `<div class="empty">no sessions</div>`;
  $$('#sessions .lrow').forEach(el => el.onclick = () => editSess(el, WSESS.find(x => x.id === +el.dataset.sid)));
}
function runClock(from) {
  clearInterval(tick);
  const r = () => { const s = Math.floor(Date.now()/1000 - from);
    $('#tclock').textContent = [s/3600, s/60%60, s%60].map(n => String(Math.floor(n)).padStart(2,'0')).join(':'); };
  r(); tick = setInterval(r, 1000);
}
$('#tgo').onclick = async () => {
  const w = await api('/api/work/status');
  if (w.id) { await api('/api/work/clockout', {method:'POST'}); toast('clocked out'); }
  else {
    const b = { activity: $('#act').value.trim() || null, note: $('#tnote').value || null };
    if (!$('#deforg').classList.contains('on')) b.group_id = +$('#orgsel').dataset.val || null;
    await api('/api/work/clockin', { method:'POST', body: JSON.stringify(b) }); toast('clocked in');
  }
  loadHours();
};
function editSess(el, s) {
  if (!s || el.dataset.edit) return;
  el.dataset.edit = 1; el.classList.add('editing'); el.onclick = null;
  el.innerHTML = `<input class="ea" value="${esc(s.activity||'')}" placeholder="activity">
    <div class="row"><input class="en" value="${esc(s.note||'')}" placeholder="note"></div>
    <div class="row"><input class="er" inputmode="decimal" value="${s.hourly_rate ?? ''}" placeholder="$/hr">
      <button class="act sv">Save</button><button class="act dl" style="background:#b4574d;color:#fff">Delete</button></div>`;
  el.querySelector('.sv').onclick = async () => {
    await api(`/api/work/${s.id}`, { method:'PUT', body: JSON.stringify({
      activity: el.querySelector('.ea').value || null, note: el.querySelector('.en').value || null,
      hourly_rate: parseFloat(el.querySelector('.er').value) || null }) });
    toast('saved'); loadHours();
  };
  el.querySelector('.dl').onclick = async () => { await api(`/api/work/${s.id}`, {method:'DELETE'}); toast('deleted'); loadHours(); };
}
let incMode = 'w';
document.addEventListener('click', e => {
  const b = e.target.closest('#incseg button'); if (!b) return;
  $$('#incseg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  incMode = b.dataset.g; renderIncome();
});
function renderIncome() {
  const span = incMode === 'w' ? 7 : incMode === '2w' ? 14 : 30;
  const bk = {};
  WSESS.forEach(s => { if (!s.ended_at) return;
    const k = Math.floor(s.started_at / (span*86400));
    const h = (s.ended_at - s.started_at)/3600;
    const b = bk[k] ??= { h:0, pay:0, from: k*span*86400 };
    b.h += h; if (s.hourly_rate) b.pay += h*s.hourly_rate;
  });
  $('#income').innerHTML = Object.values(bk).sort((a,b) => b.from - a.from).slice(0,6)
    .map(b => `<div class="lrow"><div class="grow">${day(b.from)} – ${day(b.from + span*86400 - 1)}</div>
      <span class="dim">${b.h.toFixed(1)}h · $${b.pay.toFixed(2)}</span></div>`).join('')
    || `<div class="empty">no completed sessions</div>`;
}
$('#addseg').onclick = () => {
  const d = document.createElement('div'); d.className = 'segrow';
  d.innerHTML = `<input class="sh" inputmode="numeric" placeholder="hr"><input class="sm" inputmode="numeric" placeholder="min">
    <input class="sd" placeholder="what was done"><button>✕</button>`;
  d.querySelector('button').onclick = () => d.remove();
  $('#segs').appendChild(d);
};
$('#p-save').onclick = async () => {
  const d = PICK['p-date'], s1 = PICK['p-start'];
  if (!d || !s1) return toast('date + start required');
  const ts = t => Math.floor(new Date(`${d}T${t}`).getTime()/1000);
  const segs = $$('.segrow').map(r => ({
    min: (+r.querySelector('.sh').value || 0)*60 + (+r.querySelector('.sm').value || 0),
    desc: r.querySelector('.sd').value.trim() })).filter(x => x.min > 0);
  try {
    if (segs.length) {
      let cur = ts(s1);
      for (const sg of segs) {
        await api('/api/work/manual', { method:'POST', body: JSON.stringify({
          started_at: cur, duration_min: sg.min, note: sg.desc || null }) });
        cur += sg.min*60;
      }
      toast(`${segs.length} segments added`);
    } else {
      const s2 = PICK['p-end'];
      if (!s2) return toast('end time or segments required');
      await api('/api/work/manual', { method:'POST', body: JSON.stringify({
        started_at: ts(s1), ended_at: ts(s2), break_min: +$('#p-break').value || 0,
        note: $('#p-note').value || null }) });
      toast('entry added');
    }
    $$('.segrow').forEach(r => r.remove()); loadHours();
  } catch (e) { toast(e.message); }
};

/* ══ REVIEW ══ */
async function badge() {
  try {
    const rows = await api(`/api/pending${ME.is_admin ? '?all=1' : ''}`);
    const n = rows.filter(r => r.status === 'flagged').length;
    const b = $('#pbadge'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  } catch {}
}
async function loadReview() {
  const rows = await api(`/api/pending${ME.is_admin ? '?all=1' : ''}`);
  if (!rows.length) return $('#pending').innerHTML = `<div class="empty">nothing waiting</div>`;
  $('#pending').innerHTML = rows.map(r => `<div class="prow" data-id="${r.id}">
    <div class="pn">${esc(r.filename)}</div>
    <div class="pm">${esc(r.owner)} · ${size(r.size_bytes)} · → ${esc(r.intended_dest)}
      ${r.status==='flagged' ? `<div class="flag">⚠ ${esc(r.flag_reason || 'flagged')}</div>` : '· scanning…'}</div>
    ${r.status==='flagged' ? `<div class="pacts"><button class="rel">Release</button><button class="rej">Delete</button></div>`:''}</div>`).join('');
  $$('.prow .rel').forEach(b => b.onclick = () => resolve(b, 'release'));
  $$('.prow .rej').forEach(b => b.onclick = () => resolve(b, 'reject'));
}
async function resolve(btn, action) {
  try { await api(`/api/pending/${btn.closest('.prow').dataset.id}/${action}`, {method:'POST'});
    toast(action === 'release' ? 'released' : 'deleted'); loadReview(); badge(); }
  catch (e) { toast(e.message); }
}

/* ══ SLEEP ══ */
async function loadSleep() {
  const rows = await api('/api/sleep/recent');
  $('#sleeplist').innerHTML = rows.map(s => {
    const d = s.woke_at ? hrs(s.slept_at, s.woke_at).toFixed(1)+'h' : '?';
    return `<div class="lrow"><div class="grow">${day(s.slept_at)}
      <span class="sub">${d}${s.quality?' · quality '+s.quality+'/5':''}</span></div></div>`;
  }).join('') || `<div class="empty">no sleep synced — pair the puck</div>`;
}
$('#pk-key').onclick = async () => {
  const r = await api('/api/sleep/devicekey', { method:'POST', body: JSON.stringify({label:'alarm-puck'}) });
  const el = $('#pk-out'); el.textContent = r.key; el.classList.remove('hidden');
  toast('shown once — store it on the device');
};

/* ══ JOURNAL ══ */
async function loadJournal() {
  $('#j-edit').classList.add('hidden'); $('#j-list').classList.remove('hidden'); $('#j-new').classList.remove('hidden');
  const rows = await api('/api/journal');
  $('#j-list').innerHTML = rows.map(e => `<div class="jrow" data-id="${e.id}">
    <span class="jd">${day(e.created_at)}</span><h4>${esc(e.title || 'untitled')}</h4>
    <p>${esc(e.body || '')}</p></div>`).join('') || `<div class="empty">empty pages, waiting</div>`;
  $$('.jrow').forEach(el => el.onclick = async () => {
    const all = await api('/api/journal'); jEdit(all.find(x => x.id === +el.dataset.id)); });
}
function jEdit(e) {
  curJ = e || null;
  $('#j-list').classList.add('hidden'); $('#j-new').classList.add('hidden'); $('#j-edit').classList.remove('hidden');
  $('#j-title').value = e?.title || ''; $('#j-body').value = e?.body || '';
  $('#j-del').classList.toggle('hidden', !e);
}
$('#j-new').onclick = () => jEdit(null);
$('#j-save').onclick = async () => {
  const p = { title: $('#j-title').value, body: $('#j-body').value };
  if (curJ) await api(`/api/journal/${curJ.id}`, {method:'PUT', body:JSON.stringify(p)});
  else await api('/api/journal', {method:'POST', body:JSON.stringify(p)});
  toast('saved'); loadJournal();
};
$('#j-del').onclick = async () => { await api(`/api/journal/${curJ.id}`, {method:'DELETE'}); toast('deleted'); loadJournal(); };

/* ══ SETTINGS ══ */
const SVCMETA = { work:['Hours','hours, earnings, org visibility'], fitness:['Workout','opens Workout Gen'],
  meals:['Meal Prep','opens Meal Prep'], sleep:['Sleep','puck sync, quality'], journal:['Journal','private writing'] };
async function loadSettings() {
  ['surf','tone','mode'].forEach(g => $$(`#${g}seg button`).forEach(b => b.onclick = () => {
    UI[{surf:'surface', tone:'tone', mode:'mode'}[g]] = b.dataset.v; applyTheme(); saveUI(); }));
  applyTheme();

  SVC = await api('/api/services');
  $('#svcs').innerHTML = SVC.map(s => { const [n, d] = SVCMETA[s.service] || [s.service, ''];
    return `<div class="svcrow" data-s="${s.service}"><div class="g"><div class="sn">${n}</div><span class="sd">${d}</span></div>
      ${s.service==='work' ? `<input class="rate" inputmode="decimal" placeholder="$/hr" value="${s.settings.hourly_rate ?? ''}">` : ''}
      <div class="sw ${s.enabled?'on':''}"></div></div>`; }).join('');
  $$('.svcrow .sw').forEach(sw => sw.onclick = () => svcSave(sw.closest('.svcrow'), !sw.classList.contains('on')));
  $$('.svcrow .rate').forEach(r => r.onchange = () => {
    const row = r.closest('.svcrow'); svcSave(row, row.querySelector('.sw').classList.contains('on')); });

  const apps = ['workout-gen','meal-prep','contract-manager'];
  const out = [];
  for (const a of apps) {
    const s = await api(`/api/kv/${a}/snapshots`).catch(() => []);
    out.push(`<div class="snaprow" data-app="${a}"><div class="g"><b>${a}</b>
      <span class="ss">${s.length ? s.length+' snapshots · latest '+dt(s[0].created_at) : 'none yet'}</span></div>
      <button class="btn-ghost snapnow">Snapshot</button>
      ${s.length ? `<button class="btn-ghost danger snaprst" data-sid="${s[0].id}">Restore</button>`:''}</div>`);
  }
  $('#snaps').innerHTML = out.join('');
  $$('.snapnow').forEach(b => b.onclick = async () => {
    const a = b.closest('.snaprow').dataset.app;
    const r = await api(`/api/kv/${a}/snapshot`, {method:'POST'}); toast(`${a}: ${r.keys} keys`); loadSettings(); });
  $$('.snaprst').forEach(b => b.onclick = async () => {
    const a = b.closest('.snaprow').dataset.app;
    const r = await api(`/api/kv/${a}/restore/${b.dataset.sid}`, {method:'POST'}); toast(`${a}: restored ${r.keys} keys`); });

  mkSelect($('#g-kind'), [['family','family'],['work','work'],['project','project']], 'family');
  mkSelect($('#gm-r'), [['member','member'],['manager','manager']], 'member');
  GROUPS = await api('/api/groups');
  $('#groups').innerHTML = GROUPS.map(g => `<div class="grow-row" data-gid="${g.id}" data-n="${esc(g.name)}" data-r="${g.role}">
    <div class="g">${esc(g.name)}<span class="us">${g.kind || ''}</span></div><span class="tag">${g.role}</span></div>`).join('')
    || `<div class="empty">no groups</div>`;
  $$('.grow-row').forEach(el => el.onclick = () => openGroup(el.dataset));

  if (ME.is_admin) {
    $('#admincard').classList.remove('hidden');
    const users = await api('/api/users');
    $('#users').innerHTML = users.map(u => `<div class="urow"><div class="g">${esc(u.username)}
      <span class="us">joined ${day(u.created_at)}</span></div>
      ${u.is_admin?'<span class="tag">ADMIN</span>':''}
      ${u.must_change_pw?'<span class="tag">PENDING RESET</span>':''}
      ${u.disabled?'<span class="tag">DISABLED</span>':''}</div>`).join('');
  }
}
async function svcSave(row, on) {
  const settings = {}; const r = row.querySelector('.rate');
  if (r && r.value) settings.hourly_rate = parseFloat(r.value);
  const cur = SVC.find(s => s.service === row.dataset.s)?.settings || {};
  await api(`/api/services/${row.dataset.s}`, { method:'PUT', body: JSON.stringify({ enabled:on, settings:{...cur, ...settings} }) });
  row.querySelector('.sw').classList.toggle('on', on);
  SVC = await api('/api/services'); buildNav(); toast(on ? `${row.dataset.s} paired` : `${row.dataset.s} unpaired`);
}
$('#pw-go').onclick = async () => {
  try { await api('/api/password', { method:'POST', body: JSON.stringify({
      current_password: $('#pw-cur').value, new_password: $('#pw-new').value }) });
    $('#pw-cur').value = $('#pw-new').value = ''; toast('password changed');
  } catch (e) { toast(e.message); }
};
$('#nu-go').onclick = async () => {
  try { const r = await api('/api/users', { method:'POST', body: JSON.stringify({
      username: $('#nu-name').value.trim(), password: $('#nu-pw').value }) });
    toast(r.warning || 'created — they set their own password'); $('#nu-name').value = $('#nu-pw').value = ''; loadSettings();
  } catch (e) { toast(e.message); }
};
$('#g-go').onclick = async () => {
  try { await api('/api/groups', { method:'POST', body: JSON.stringify({
      name: $('#g-name').value.trim(), kind: $('#g-kind').dataset.val }) });
    $('#g-name').value = ''; toast('group created'); loadSettings();
  } catch (e) { toast(e.message); }
};
async function openGroup(d) {
  curG = d;
  $('#gdetail').classList.remove('hidden');
  $('#gd-name').textContent = d.n; $('#gd-role').textContent = `you are ${d.r}`;
  $('#gd-add').classList.toggle('hidden', !['owner','manager'].includes(d.r));
  $('#gd-files').onclick = () => { cwd = `/group/${slug(d.n)}`; show('archive'); };
  const rows = await api(`/api/groups/${d.gid}/work`).catch(() => []);
  $('#gd-work').innerHTML = rows.map(s => { const h = hrs(s.started_at, s.ended_at);
    const pay = s.hourly_rate ? ` · $${(h*s.hourly_rate).toFixed(2)}` : '';
    return `<div class="lrow"><div class="grow"><b>${esc(s.username)}</b> — ${esc(s.activity||'work')}${s.note?' · '+esc(s.note):''}
      <span class="sub">${dt(s.started_at)} · ${s.ended_at ? h.toFixed(1)+'h'+pay : 'on the clock'}</span></div></div>`;
  }).join('') || `<div class="empty">no sessions logged to this group</div>`;
}
$('#gm-go').onclick = async () => {
  try { await api(`/api/groups/${curG.gid}/members`, { method:'POST', body: JSON.stringify({
      username: $('#gm-u').value.trim(), role: $('#gm-r').dataset.val }) });
    $('#gm-u').value = ''; toast('member added');
  } catch (e) { toast(e.message); }
};

/* ══ custom controls ══ */
function mkSelect(host, opts, val) {
  host.dataset.val = val ?? (opts[0]?.[0] ?? '');
  const label = () => (opts.find(o => o[0] === host.dataset.val) || opts[0] || ['',''])[1];
  host.innerHTML = `<button type="button" class="selbtn">${esc(label())}</button>`;
  host.querySelector('.selbtn').onclick = e => {
    e.stopPropagation(); $$('.selmenu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'selmenu';
    m.innerHTML = opts.map(([v, l]) => `<div data-v="${esc(v)}" class="${v===host.dataset.val?'on':''}">${esc(l)}</div>`).join('');
    m.querySelectorAll('div').forEach(d => d.onclick = () => {
      host.dataset.val = d.dataset.v; host.querySelector('.selbtn').textContent = label(); m.remove();
      host.dispatchEvent(new Event('change')); });
    host.appendChild(m);
  };
}
document.addEventListener('click', () => $$('.selmenu').forEach(m => m.remove()));

function combo(host, listFn, addFn) {
  const inp = host.querySelector('input'), menu = host.querySelector('.cmenu');
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const all = listFn();
    const hits = all.filter(a => a.toLowerCase().includes(q));
    menu.innerHTML = hits.map(a => `<div data-v="${esc(a)}">${esc(a)}</div>`).join('') +
      (q && !all.some(a => a.toLowerCase() === q) ? `<div class="addnew" data-new="1">＋ add "${esc(inp.value.trim())}"</div>` : '');
    menu.classList.toggle('hidden', !menu.innerHTML);
    menu.querySelectorAll('div').forEach(d => d.onclick = async ev => {
      ev.stopPropagation();
      if (d.dataset.new) { const v = inp.value.trim(); await addFn(v); inp.value = v; }
      else inp.value = d.dataset.v;
      menu.classList.add('hidden');
    });
  };
  inp.oninput = draw; inp.onfocus = draw;
  document.addEventListener('click', e => { if (!e.target.closest(`#${host.id}`)) menu.classList.add('hidden'); });
}

const PICK = {};
document.addEventListener('click', e => {
  const b = e.target.closest('.pick');
  $$('.pop').forEach(p => p.remove());
  if (!b) return;
  e.stopPropagation();
  const wrap = b.parentElement;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  wrap.appendChild(b.dataset.kind === 'date' ? calPop(b) : timePop(b));
});
function calPop(btn) {
  const pop = document.createElement('div'); pop.className = 'pop';
  pop.onclick = e => e.stopPropagation();
  let cur = PICK[btn.id] ? new Date(PICK[btn.id]+'T12:00') : new Date();
  let dots = [];
  const dotsFor = () => api(`/api/work/days?year=${cur.getFullYear()}&month=${cur.getMonth()+1}`)
    .then(d => { dots = d; paint(); }).catch(() => {});
  const paint = () => pop.querySelectorAll('.d').forEach(el => {
    const s = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(el.textContent).padStart(2,'0')}`;
    el.classList.toggle('dot', dots.includes(s)); });
  const draw = () => {
    const y = cur.getFullYear(), m = cur.getMonth();
    const first = new Date(y, m, 1).getDay(), n = new Date(y, m+1, 0).getDate();
    pop.innerHTML = `<div class="pophead"><button data-d="-1">‹</button>
      <span>${cur.toLocaleString(undefined,{month:'long',year:'numeric'})}</span><button data-d="1">›</button></div>
      <div class="cal">${['S','M','T','W','T','F','S'].map(d=>`<span class="dow">${d}</span>`).join('')}
      ${'<span></span>'.repeat(first)}${Array.from({length:n},(_,i)=>`<span class="d">${i+1}</span>`).join('')}</div>`;
    pop.querySelectorAll('.pophead button').forEach(b => b.onclick = () => { cur.setMonth(cur.getMonth()+ +b.dataset.d); draw(); dotsFor(); });
    pop.querySelectorAll('.d').forEach(d => d.onclick = () => {
      const dd = String(d.textContent).padStart(2,'0'), mm = String(m+1).padStart(2,'0');
      PICK[btn.id] = `${y}-${mm}-${dd}`;
      btn.textContent = new Date(PICK[btn.id]+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
      pop.remove(); });
    paint();
  };
  draw(); dotsFor(); return pop;
}
function timePop(btn) {
  const pop = document.createElement('div'); pop.className = 'pop';
  pop.onclick = e => e.stopPropagation();
  const [ch, cm] = (PICK[btn.id] || '09:00').split(':').map(Number);
  pop.innerHTML = `<div class="wheels">
    <div class="wheel">${Array.from({length:24},(_,i)=>`<div class="${i===ch?'on':''}">${String(i).padStart(2,'0')}</div>`).join('')}</div>
    <b>:</b><div class="wheel">${Array.from({length:12},(_,i)=>`<div class="${i*5===cm?'on':''}">${String(i*5).padStart(2,'0')}</div>`).join('')}</div></div>`;
  const set = () => {
    const h = pop.querySelector('.wheel:first-child .on')?.textContent || '09';
    const m = pop.querySelector('.wheel:last-child .on')?.textContent || '00';
    PICK[btn.id] = `${h}:${m}`; btn.textContent = PICK[btn.id];
  };
  pop.querySelectorAll('.wheel div').forEach(d => d.onclick = () => {
    d.parentNode.querySelectorAll('div').forEach(x => x.classList.remove('on'));
    d.classList.add('on'); set(); });
  return pop;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
boot();
