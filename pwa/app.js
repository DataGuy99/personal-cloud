/* ═══ NOOK — wired to live /api + copyparty ═══ */
const CP = `${location.protocol}//${location.hostname}:3923`;
let ME=null, SVC=[], MYGROUPS=[], UI={theme:'light',tone:'warm',surface:'flat'};
let curView='home', WSESS=[], DTP={}, tTick=null, incMode='w';
let feedFilter='all', composeKind='text', shMode='books', medMode='mine';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=m=>{const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2500);};
const api=async(p,o={})=>{const r=await fetch(p,{headers:{'Content-Type':'application/json'},...o});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j;};
const sz=b=>b>1e9?(b/1e9).toFixed(1)+' GB':b>1e6?(b/1e6).toFixed(1)+' MB':b>1e3?(b/1e3).toFixed(0)+' KB':b+' B';
const day=t=>new Date(t*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const dt=t=>new Date(t*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const tm=t=>new Date(t*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
const hrs=(a,b)=>(((b||Date.now()/1000)-a)/3600);

/* ── theme ── */
function applyUI(){const h=document.documentElement;h.dataset.theme=UI.theme;h.dataset.tone=UI.tone;h.dataset.surface=UI.surface;
  document.querySelector('meta[name=theme-color]').content=getComputedStyle(h).getPropertyValue('--bg').trim();}
function saveUI(){applyUI();api('/api/kv/nook',{method:'PUT',body:JSON.stringify({ui:JSON.stringify(UI)})}).catch(()=>{});}

/* ── auth ── */
async function boot(){try{ME=await api('/api/me');await afterLogin();}catch{$('#v-lock').classList.remove('hidden');}}
$('#lg-btn').onclick=async()=>{try{ME=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#lg-user').value.trim(),password:$('#lg-pass').value})});$('#v-lock').classList.add('hidden');await afterLogin();}catch{$('#lg-err').textContent='wrong username or password';}};
$('#lg-pass').addEventListener('keydown',e=>{if(e.key==='Enter')$('#lg-btn').click();});
$('#sp-btn').onclick=async()=>{const a=$('#sp-a').value,b=$('#sp-b').value;if(a!==b){$('#sp-err').textContent="passwords don't match";return;}if(a.length<8){$('#sp-err').textContent='min 8 characters';return;}try{await api('/api/password',{method:'POST',body:JSON.stringify({new_password:a})});ME.must_change_pw=false;$('#v-setpw').classList.add('hidden');await afterLogin();}catch(e){$('#sp-err').textContent=e.message;}};

async function afterLogin(){
  if(ME.must_change_pw){$('#v-setpw').classList.remove('hidden');return;}
  document.cookie=`cppwd=${ME.file_token}; path=/; max-age=2592000`;
  try{const kv=await api('/api/kv/nook');if(kv.ui)UI={...UI,...JSON.parse(kv.ui)};}catch{}
  applyUI();
  $('#v-app').classList.remove('hidden');
  MYGROUPS=await api('/api/groups').catch(()=>[]);
  SVC=await api('/api/services').catch(()=>[]);
  buildNav();
  show('home');
  badge();setInterval(badge,15000);
}
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload();};

/* ── nav ── */
const CORE=[['home','Home','◈'],['archive','Archive','▤'],['photos','Photos','▣'],['shelf','Shelf','▥']];
const SVCNAV={work:['hours','Hours','◷'],fitness:['workout','Workout','◍'],meals:['meal','Meal Prep','◐'],sleep:['sleep','Sleep','☾'],journal:['journal','Journal','✎']};
const SVCAPP={workout:'workout-gen',meal:'meal-prep',contractor:'contract-manager'};
const TITLES={home:'Home',archive:'Archive',photos:'Photos',shelf:'Shelf',hours:'Hours',sleep:'Sleep',journal:'Journal',review:'Review',settings:'Settings'};

function buildNav(){
  const paired=SVC.filter(s=>s.enabled).map(s=>s.service);
  const items=[...CORE];
  paired.forEach(s=>SVCNAV[s]&&items.push(SVCNAV[s]));
  items.push(['contractor','Contractor','◰'],['review','Review','◇']);
  $('#nav').innerHTML=`<div class="navsec">Spaces</div>`+items.map(([v,l,i])=>
    `<button class="navitem" data-view="${v}"><span class="ni">${i}</span><span>${l}</span>${v==='review'?'<em class="badge hidden" id="pbadge"></em>':''}</button>`).join('')
    +`<div class="navsec">System</div><button class="navitem" data-view="settings"><span class="ni">⚙</span><span>Settings</span></button>`;
  $$('.navitem').forEach(b=>b.onclick=()=>{const v=b.dataset.view;if(SVCAPP[v])return location.href=`/apps/${SVCAPP[v]}/`;show(v);closeNav();});
}
function show(v){
  curView=v;
  $$('.view').forEach(x=>x.classList.add('hidden'));
  $(`#w-${v}`)?.classList.remove('hidden');
  $$('.navitem').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  $('#mtitle').textContent=TITLES[v]||v;
  ({home:loadHome,hours:loadHours,archive:loadArchive,photos:loadPhotos,shelf:loadShelf,sleep:loadSleep,journal:loadJournal,review:loadReview,settings:loadSettings}[v]||(()=>{}))();
}
$('#menu-btn').onclick=()=>{$('#side').classList.add('open');$('#veil').classList.add('on');};
$('#veil').onclick=closeNav;
function closeNav(){$('#side').classList.remove('open');$('#veil').classList.remove('on');}
$('#theme-btn').onclick=()=>{UI.theme=UI.theme==='light'?'dark':'light';saveUI();};

/* ── search overlay ── */
$('#open-search').onclick=$('#nav')?()=>openSearch():null;
function openSearch(){$('#v-search').classList.remove('hidden');$('#sc-q').value='';$('#sresults').innerHTML='';$('#sc-label').textContent='Type to search';$('#sc-q').focus();}
$('#open-search').onclick=openSearch;
$('#sc-x').onclick=()=>$('#v-search').classList.add('hidden');
let scT=null;
$('#sc-q').addEventListener('input',()=>{clearTimeout(scT);scT=setTimeout(runSearch,300);});
$('#sc-q').addEventListener('keydown',e=>{if(e.key==='Escape')$('#sc-x').click();});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openSearch();}});
async function runSearch(){
  const q=$('#sc-q').value.trim();if(!q){$('#sresults').innerHTML='';$('#sc-label').textContent='Type to search';return;}
  const r=await fetch(`${CP}/?srch=${encodeURIComponent(q)}`,{headers:{PW:ME.file_token}});
  if(!r.ok){$('#sc-label').textContent='search unavailable';return;}
  const j=await r.json().catch(()=>({hits:[]}));const hits=j.hits||[];
  $('#sc-label').textContent=hits.length?`${hits.length} results`:'no matches';
  $('#sresults').innerHTML=hits.slice(0,50).map(h=>{const vp=h.rp||h.vp||'';const svc=vp.split('/')[1]||'file';
    return `<button class="sres" data-vp="${esc(vp)}"><span class="l"><em>&mdash;</em><b>${esc(vp.split('/').pop())}</b></span><span class="svc">${esc(svc)}</span></button>`;}).join('');
  $$('.sres[data-vp]').forEach(el=>el.onclick=()=>window.open(`${CP}/${encodeURI(el.dataset.vp)}?pw=${ME.file_token}`,'_blank'));
}

/* ══ HOME — glance pins + compose + masonry typed feed ══ */
const FILTERS=[['all','All'],['note','Notes'],['todo','Todos'],['photo','Photos'],['video','Video'],['link','Links'],['file','Files']];
const CMPKINDS=[['text','Note'],['todo','Todo'],['link','Link'],['file','Drop']];
async function loadHome(){
  const h=new Date().getHours();
  $('#greeting').textContent=(h<12?'Good morning':h<18?'Good afternoon':'Good evening')+', '+ME.username;
  // glance pins from live data
  const ins=await api('/api/insights/today').catch(()=>({}));
  const pend=await api(`/api/pending${ME.is_admin?'?all=1':''}`).catch(()=>[]);
  const pins=[
    {tag:'Today',b:ins.est_total_burn_kcal?`${ins.est_total_burn_kcal} kcal`:'—',s:ins.note?'log metrics':'est. burn',accent:false},
    {tag:'Worked',b:ins.work_hours?`${ins.work_hours}h`:'0h',s:ins.earnings?`$${ins.earnings}`:'today',accent:true},
    {tag:'Review',b:String(pend.filter(p=>p.status==='flagged').length),s:'flagged files',accent:false},
  ];
  $('#pins').innerHTML=pins.map(p=>`<div class="pin${p.accent?' accentpin':''}"><div class="tag">${p.tag}</div><div class="b">${esc(p.b)}</div><div class="s">${esc(p.s)}</div></div>`).join('');
  $('#cmp-chips').innerHTML=CMPKINDS.map(([k,l])=>`<button class="chip${composeKind===k?' on':''}" data-k="${k}">${l}</button>`).join('');
  $$('#cmp-chips .chip').forEach(b=>b.onclick=()=>{composeKind=b.dataset.k;openCompose();loadHome();});
  $('#feed-filters').innerHTML=FILTERS.map(([k,l])=>`<button class="chip${feedFilter===k?' on':''}" data-f="${k}">${l}</button>`).join('');
  $$('#feed-filters .chip').forEach(b=>b.onclick=()=>{feedFilter=b.dataset.f;renderFeed();});
  await renderFeed();
}
let FEED=[];
async function renderFeed(){
  FEED=await api('/api/dump').catch(()=>[]);
  const items=FEED.filter(m=>{if(feedFilter==='all')return true;
    if(feedFilter==='note')return m.kind==='text';
    if(feedFilter==='todo')return m.kind==='todo';
    if(feedFilter==='link')return m.kind==='link';
    if(feedFilter==='file')return m.kind==='file'&&/\.(pdf|docx?|txt|md|epub|zip)$/i.test(m.file_path||'');
    if(feedFilter==='photo')return m.kind==='file'&&/\.(jpe?g|png|gif|webp)$/i.test(m.file_path||'');
    if(feedFilter==='video')return m.kind==='file'&&/\.(mp4|webm|mov|m4v)$/i.test(m.file_path||'');
    return true;});
  $('#feed').innerHTML=items.slice().reverse().map(feedCard).join('')||`<div class="empty">nothing in your stream yet</div>`;
  wireFeed();
}
function feedCard(m){
  let meta={};try{meta=JSON.parse(m.meta||'{}');}catch{}
  const blur=meta.sensitive?' blur':'';
  const tag=m.kind==='text'?'note':m.kind;
  const url=m.file_path?`${CP}${encodeURI(m.file_path)}?pw=${ME.file_token}`:'';
  let body='';
  if(m.kind==='text')body=`<div class="f-note">${esc(m.content)}</div>`;
  else if(m.kind==='link')body=`<a class="f-link" href="${esc(m.content)}" target="_blank"><span class="ic">&#128279;</span><span style="min-width:0"><span class="t">${esc(m.content)}</span><span class="d">${esc((m.content||'').replace(/^https?:\/\//,'').split('/')[0])}</span></span></a>`;
  else if(m.kind==='todo'){let td={};try{td=JSON.parse(m.content);}catch{}
    body=`<div class="f-title">${esc(td.title||'Todo')}</div><div class="todos">${(td.items||[]).map((it,i)=>`<div class="todo${it.done?' done':''}" data-id="${m.id}" data-i="${i}"><span class="dot">${it.done?'✓':''}</span><span class="lb">${esc(it.label)}</span></div>`).join('')}</div>`;}
  else if(m.kind==='share'){let p={};try{p=JSON.parse(m.content);}catch{}
    body=`<div class="sharecard"><div class="st">${p.type==='workout'?'🏋 ':p.type==='recipe'||p.type==='meal'?'🥘 ':'📦 '}${esc(p.title||p.type||'shared')}</div><div class="ss">from ${esc(p.app||'?')}</div><button class="sh-save" data-json='${esc(m.content)}'>Save to my ${esc(p.app||'apps')}</button></div>`;}
  else if(m.kind==='file'){const nm=meta.showname===false?'':`<div class="f-cap">${esc(m.content||'')}</div>`;
    if(/\.(jpe?g|png|gif|webp)$/i.test(m.file_path))body=`<img class="f-media${blur}" src="${url}" data-url="${url}" loading="lazy">${nm}`;
    else if(/\.(mp4|webm|mov|m4v)$/i.test(m.file_path))body=`<div class="vidwrap"><video class="f-media dvid${blur}" src="${url}" muted loop playsinline preload="metadata"></video></div>${nm}`;
    else{const ext=(m.file_path.split('.').pop()||'FILE').toUpperCase();body=`<a class="f-file" href="${url}" target="_blank"><span class="sheet">${esc(ext.slice(0,4))}</span><span style="min-width:0"><span class="t">${esc(m.content||m.file_path.split('/').pop())}</span></span></a>`;}}
  const who=(curView==='home'&&m.username!==ME.username)?`<div class="who">${esc(m.username)}</div>`:'';
  return `<div class="fcard${meta.important?' important':''}" data-id="${m.id}" data-mine="${m.username===ME.username?1:0}" data-kind="${m.kind}" data-sens="${meta.sensitive?1:0}" data-name="${meta.showname===false?0:1}">
    <div class="fhead"><span class="tag">${esc(tag)}</span><span class="rt"><span class="time">${tm(m.created_at)}</span>${m.username===ME.username?`<button class="menu" data-menu="${m.id}">⋯</button>`:''}</span></div>
    ${who}${body}</div>`;
}
let vObs=null;
function wireFeed(){
  vObs?.disconnect();
  vObs=new IntersectionObserver(es=>es.forEach(e=>{if(e.target.classList.contains('blur'))return e.target.pause();e.isIntersecting?e.target.play().catch(()=>{}):e.target.pause();}),{threshold:.5});
  $$('#feed .dvid').forEach(v=>vObs.observe(v));
  $$('#feed .f-media.blur').forEach(el=>el.onclick=()=>{el.classList.remove('blur');if(el.tagName==='VIDEO')el.play().catch(()=>{});});
  $$('#feed img.f-media:not(.blur)').forEach(el=>el.onclick=()=>{$('#lb-img').src=el.dataset.url;$('#lightbox').classList.remove('hidden');});
  $$('#feed .todo').forEach(el=>el.onclick=()=>toggleTodo(el.dataset.id,+el.dataset.i));
  $$('#feed .sh-save').forEach(b=>b.onclick=async()=>{let p={};try{p=JSON.parse(b.dataset.json);}catch{}if(!p.app)return;await api(`/api/kv/${p.app}`,{method:'PUT',body:JSON.stringify({['inbox_'+Date.now()]:JSON.stringify(p)})});toast(`saved to ${p.app}`);});
  $$('#feed .menu').forEach(b=>b.onclick=e=>{e.stopPropagation();cardMenu(b.closest('.fcard'),e.clientX,e.clientY);});
  $$('#feed .fcard[data-mine="1"]').forEach(c=>{let lp;c.addEventListener('touchstart',()=>lp=setTimeout(()=>cardMenu(c,innerWidth/2-93,innerHeight/2),500),{passive:true});['touchend','touchmove'].forEach(ev=>c.addEventListener(ev,()=>clearTimeout(lp)));});
}
async function toggleTodo(id,i){
  const m=FEED.find(x=>x.id==id);if(!m)return;let td={};try{td=JSON.parse(m.content);}catch{return;}
  td.items[i].done=!td.items[i].done;m.content=JSON.stringify(td);
  await api(`/api/dump/${id}/content`,{method:'PUT',body:JSON.stringify({content:m.content})});renderFeed();
}
function cardMenu(card,x,y){
  $$('.ctx').forEach(m=>m.remove());
  const isFile=card.dataset.kind==='file',sens=card.dataset.sens==='1',named=card.dataset.name==='1';
  const opts=[];
  if(isFile)opts.push(['↗ open',()=>card.querySelector('[data-url],a,video')?.click?.()]);
  if(isFile)opts.push([sens?'👁 unmark sensitive':'🙈 mark sensitive',()=>setMeta(card.dataset.id,{sensitive:!sens,showname:named})],
    [named?'🏷 hide filename':'🏷 show filename',()=>setMeta(card.dataset.id,{sensitive:sens,showname:!named})]);
  opts.push(['🗑 delete',async()=>{await api(`/api/dump/${card.dataset.id}`,{method:'DELETE'});renderFeed();}]);
  const m=document.createElement('div');m.className='ctx';m.style.left=Math.min(x,innerWidth-196)+'px';m.style.top=Math.min(y,innerHeight-200)+'px';
  m.innerHTML=opts.map(([l],i)=>`<div data-i="${i}">${l}</div>`).join('');
  m.querySelectorAll('div').forEach(o=>o.onclick=()=>{m.remove();opts[+o.dataset.i][1]();});
  document.body.appendChild(m);
}
async function setMeta(id,meta){await api(`/api/dump/${id}/meta`,{method:'PUT',body:JSON.stringify(meta)});renderFeed();}
document.addEventListener('click',()=>$$('.ctx').forEach(m=>m.remove()));

/* compose */
$('#cmp-open').onclick=()=>openCompose();
$('#cmp-quick').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){quickPost(e.target.value.trim());e.target.value='';}});
async function quickPost(text){await api('/api/dump',{method:'POST',body:JSON.stringify({content:text})});renderFeed();toast('added');}
function openCompose(){
  const c=$('#compose');c.classList.remove('hidden');
  if(composeKind==='text')c.innerHTML=`<textarea id="c-body" placeholder="Write a note, paste anything…"></textarea>`;
  else if(composeKind==='todo')c.innerHTML=`<div class="todoedit"><input id="c-title" placeholder="list title"><input id="c-items" placeholder="items, comma separated"></div>`;
  else if(composeKind==='link')c.innerHTML=`<div class="linkrow"><span class="pfx">https://</span><input id="c-body" placeholder="paste a link"></div>`;
  else c.innerHTML=`<div class="dropbox" id="c-drop"><div class="ic">&#8593;</div><div class="t">Drop a file</div><div class="s">drag &amp; drop, or tap to browse</div><input type="file" id="c-file" hidden></div>`;
  c.innerHTML+=`<div class="cactions"><button class="cancel" id="c-cancel">Cancel</button><button class="go" id="c-go">Add to stream</button></div>`;
  if(composeKind==='drop'||composeKind==='file'){const d=$('#c-drop'),f=$('#c-file');d.onclick=()=>f.click();
    f.onchange=async()=>{if(f.files[0]){await dumpFile(f.files[0]);composeClose();}};
    d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('hot');});
    d.addEventListener('dragleave',()=>d.classList.remove('hot'));
    d.addEventListener('drop',async e=>{e.preventDefault();d.classList.remove('hot');if(e.dataTransfer.files[0]){await dumpFile(e.dataTransfer.files[0]);composeClose();}});}
  $('#c-cancel').onclick=composeClose;
  $('#c-go').onclick=async()=>{
    if(composeKind==='text'){const v=$('#c-body').value.trim();if(v)await api('/api/dump',{method:'POST',body:JSON.stringify({content:v})});}
    else if(composeKind==='link'){const v=$('#c-body').value.trim();if(v)await api('/api/dump',{method:'POST',body:JSON.stringify({content:v.startsWith('http')?v:'https://'+v})});}
    else if(composeKind==='todo'){const items=$('#c-items').value.split(',').map(x=>x.trim()).filter(Boolean).map(l=>({label:l,done:false}));if(items.length)await api('/api/dump',{method:'POST',body:JSON.stringify({kind:'todo',title:$('#c-title').value||'Todo',items})});}
    composeClose();renderFeed();toast('added');};
}
function composeClose(){$('#compose').classList.add('hidden');$('#compose').innerHTML='';}
async function dumpFile(f){
  const fn=`dump-${Date.now().toString(36)}-${f.name}`;
  toast(`uploading ${f.name}…`);
  const r=await fetch(`${CP}/up/vault/${ME.username}/${encodeURIComponent(fn)}`,{method:'PUT',headers:{PW:ME.file_token},body:f});
  if(!r.ok){toast(`upload failed (${r.status})`);return;}
  await api('/api/dump',{method:'POST',body:JSON.stringify({content:f.name,file_path:`/vault/${ME.username}/${fn}`})});
  renderFeed();badge();
}
/* global drag onto home */
let dragN=0;
addEventListener('dragenter',e=>{if(curView!=='home'||!e.dataTransfer?.types.includes('Files'))return;dragN++;});
addEventListener('dragover',e=>{if(curView==='home')e.preventDefault();});
addEventListener('drop',async e=>{if(curView!=='home')return;e.preventDefault();dragN=0;for(const f of e.dataTransfer.files)await dumpFile(f);});

function badge(){api(`/api/pending${ME?.is_admin?'?all=1':''}`).then(rows=>{const n=rows.filter(r=>r.status==='flagged').length;const b=$('#pbadge');if(b){b.textContent=n;b.classList.toggle('hidden',n===0);}}).catch(()=>{});}

/* ══ HOURS — ring, day strip w/ dots, sessions, income ══ */
function workSettings(){return SVC.find(x=>x.service==='work')?.settings||{};}
async function saveWorkSettings(patch){const st={...workSettings(),...patch};await api('/api/services/work',{method:'PUT',body:JSON.stringify({enabled:true,settings:st})});SVC=await api('/api/services');}
const WTYPES=['desk','standing','driving','manual','construction'];
async function loadHours(){
  const st=workSettings();
  $('#wtypes').innerHTML=WTYPES.map(w=>`<button class="chip" data-w="${w}">${w}</button>`).join('');
  let selType=WTYPES[0];
  $$('#wtypes .chip').forEach((b,i)=>{if(i===0)b.classList.add('on');b.onclick=()=>{$$('#wtypes .chip').forEach(x=>x.classList.remove('on'));b.classList.add('on');selType=b.dataset.w;};});
  const status=await api('/api/work/status').catch(()=>({}));
  const btn=$('#timer-btn');
  if(status.id){btn.textContent='Stop';btn.classList.add('running');startTick(status.started_at);}
  else{btn.textContent='Start';btn.classList.remove('running');stopTick();}
  btn.onclick=async()=>{const s=await api('/api/work/status');if(s.id){await api('/api/work/clockout',{method:'POST'});toast('clocked out');}
    else{const body={activity:selType,note:$('#w-note').value||null};await api('/api/work/clockin',{method:'POST',body:JSON.stringify(body)});toast('clocked in');}loadHours();};
  // day strip w/ dots (last 7 days)
  const now=new Date();const days=[];for(let i=6;i>=0;i--){const d=new Date(now);d.setDate(now.getDate()-i);days.push(d);}
  const y=now.getFullYear(),mo=now.getMonth()+1;
  const dots=await api(`/api/work/days?year=${y}&month=${mo}`).catch(()=>[]);
  $('#daystrip').innerHTML=days.map((d,i)=>{const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return `<button class="dcell${i===6?' on':''}"><span class="dow">${['SU','MO','TU','WE','TH','FR','SA'][d.getDay()]}</span><span class="num">${d.getDate()}</span>${dots.includes(iso)?'<span class="dot"></span>':''}</button>`;}).join('');
  WSESS=await api('/api/work/sessions?days=120').catch(()=>[]);
  const t0=Math.floor(new Date().setHours(0,0,0,0)/1000);
  const todays=WSESS.filter(s=>s.started_at>=t0);
  const dh=todays.reduce((a,s)=>a+hrs(s.started_at,s.ended_at),0);
  const de=todays.reduce((a,s)=>a+(s.hourly_rate?hrs(s.started_at,s.ended_at)*s.hourly_rate:0),0);
  $('#day-hours').textContent=dh.toFixed(1)+'h';$('#day-earned').textContent='$'+de.toFixed(0);
  const pct=Math.min(100,dh/8*100);const circ=2*Math.PI*52;
  $('#ring').setAttribute('stroke-dasharray',circ.toFixed(0));$('#ring').setAttribute('stroke-dashoffset',(circ*(1-pct/100)).toFixed(1));
  $('#ring-pct').textContent=Math.round(pct)+'% of 8h';
  if(!status.id)$('#ring-time').textContent=dh?`${Math.floor(dh)}:${String(Math.round(dh%1*60)).padStart(2,'0')}:00`:'0:00:00';
  renderIncome();
  $('#worklist').innerHTML=WSESS.slice(0,20).map(s=>{const h=hrs(s.started_at,s.ended_at);const pay=s.hourly_rate?` · $${(h*s.hourly_rate).toFixed(2)}`:'';
    return `<div class="sess" data-sid="${s.id}"><div class="g"><div class="t">${esc(s.activity||'work')}${s.note?' — '+esc(s.note):''}</div><div class="s">${dt(s.started_at)}${s.ended_at?'':' · ⏱ running'}</div></div><div class="amt">${s.ended_at?h.toFixed(1)+'h'+pay:''}</div></div>`;}).join('')||`<div class="empty">no sessions</div>`;
  $$('#worklist .sess').forEach(el=>el.onclick=()=>editSession(el,WSESS.find(x=>x.id==el.dataset.sid)));
  // income seg
  $('#inc-seg').innerHTML=[['w','Weekly'],['2w','Biweekly'],['m','Monthly']].map(([k,l])=>`<button class="chip${incMode===k?' on':''}" data-g="${k}">${l}</button>`).join('');
  $$('#inc-seg .chip').forEach(b=>b.onclick=()=>{incMode=b.dataset.g;$$('#inc-seg .chip').forEach(x=>x.classList.remove('on'));b.classList.add('on');renderIncome();});
}
function startTick(t0){stopTick();const r=()=>{const s=Math.floor(Date.now()/1000-t0);$('#ring-time').textContent=[s/3600,s/60%60,s%60].map(n=>String(Math.floor(n)).padStart(2,'0')).join(':').replace(/^0/,'');};r();tTick=setInterval(r,1000);}
function stopTick(){clearInterval(tTick);tTick=null;}
function editSession(el,s){
  if(!s||el.querySelector('.editrow'))return;
  el.innerHTML=`<div class="editrow"><input class="e-act" value="${esc(s.activity||'')}" placeholder="activity"><input class="e-note" value="${esc(s.note||'')}" placeholder="note"><div class="row"><input class="e-rate" type="number" step="0.5" value="${s.hourly_rate??''}" placeholder="$/hr"><button class="sbtn e-save">Save</button><button class="sbtn warn e-del">Delete</button></div></div>`;
  el.onclick=null;
  el.querySelector('.e-save').onclick=async()=>{await api(`/api/work/${s.id}`,{method:'PUT',body:JSON.stringify({activity:el.querySelector('.e-act').value||null,note:el.querySelector('.e-note').value||null,hourly_rate:+el.querySelector('.e-rate').value||null})});toast('saved');loadHours();};
  el.querySelector('.e-del').onclick=async()=>{await api(`/api/work/${s.id}`,{method:'DELETE'});toast('deleted');loadHours();};
}
function renderIncome(){
  const span=incMode==='w'?7:incMode==='2w'?14:30;const buckets={};
  WSESS.forEach(s=>{if(!s.ended_at)return;const b=Math.floor(s.started_at/(span*86400));const h=(s.ended_at-s.started_at)/3600;const o=buckets[b]??={h:0,pay:0,from:b*span*86400};o.h+=h;if(s.hourly_rate)o.pay+=h*s.hourly_rate;});
  $('#inclist').innerHTML=Object.values(buckets).sort((a,b)=>b.from-a.from).slice(0,6).map(b=>`<div class="sess"><div class="g"><div class="t">${day(b.from)} – ${day(b.from+span*86400-1)}</div></div><div class="amt">${b.h.toFixed(1)}h · $${b.pay.toFixed(2)}</div></div>`).join('')||`<div class="empty">no completed sessions</div>`;
}
$('#mw-save').onclick=async()=>{
  const d=DTP['mw-date'],s1=DTP['mw-start'],s2=DTP['mw-end'];
  if(!d||!s1||!s2){toast('date + start + end required');return;}
  const ts=t=>Math.floor(new Date(`${d}T${t}`).getTime()/1000);
  try{await api('/api/work/manual',{method:'POST',body:JSON.stringify({started_at:ts(s1),ended_at:ts(s2),break_min:+$('#mw-break').value||0,note:$('#mw-note2').value||null})});toast('entry added');DTP={};$('#mw-date').textContent='pick date';$('#mw-start').textContent='start';$('#mw-end').textContent='end';loadHours();}catch(e){toast(e.message);}
};

/* ══ ARCHIVE — posters from movies/tv pool ══ */
let ARCH=[];
async function loadArchive(){
  ARCH=[];
  for(const cat of ['movies','tv']){const r=await fetch(`${CP}/public/${cat}/?ls`,{headers:{PW:ME.file_token}}).catch(()=>null);
    if(r&&r.ok){const j=await r.json();[...(j.dirs||[]),...(j.files||[])].forEach(f=>ARCH.push({title:decodeURIComponent(f.href.replace(/\/$/,'')),kind:cat,meta:cat==='movies'?'Movie':'Series',url:`${location.protocol}//${location.hostname}:8096`}));}}
  renderArch('');
}
$('#arch-q').addEventListener('input',e=>renderArch(e.target.value));
function renderArch(q){
  const items=ARCH.filter(a=>a.title.toLowerCase().includes(q.toLowerCase()));
  $('#posters').innerHTML=items.map(a=>`<div class="poster"><div class="art" data-u="${a.url}"><span class="kind">${a.kind}</span></div><div class="t">${esc(a.title)}</div><div class="m">${a.meta}</div></div>`).join('')||`<div class="empty">pool empty — add media + Jellyfin libraries</div>`;
  $$('.poster .art').forEach(el=>el.onclick=()=>window.open(el.dataset.u,'_blank'));
}

/* ══ PHOTOS — date-grouped tiles ══ */
async function loadPhotos(){
  $('#photo-jump').innerHTML=[['mine','My photos'],['family','Family']].map(([k,l])=>`<button class="chip${medMode===k?' on':''}" data-m="${k}">${l}</button>`).join('');
  $$('#photo-jump .chip').forEach(b=>b.onclick=()=>{medMode=b.dataset.m;loadPhotos();});
  const base=medMode==='mine'?`/vault/${ME.username}`:'/public/photos';
  const imgs=await walkImages(base,2);
  if(!imgs.length){$('#photo-groups').innerHTML=`<div class="empty">no photos in ${medMode==='mine'?'your vault':'the family pool'} yet</div>`;return;}
  $('#photo-groups').innerHTML=`<div class="pgroup"><div class="pglabel">${medMode==='mine'?'My photos':'Family'} <span class="c">· ${imgs.length}</span></div><div class="tiles">${imgs.slice(0,300).map(u=>`<img loading="lazy" src="${u}" data-u="${u}">`).join('')}</div></div>`;
  $$('#photo-groups img').forEach(im=>im.onclick=()=>{$('#lb-img').src=im.dataset.u;$('#lightbox').classList.remove('hidden');});
}
$('#photo-add').onchange=async e=>{for(const f of e.target.files)await dumpFile(f);e.target.value='';toast('uploaded — scanning');};
async function walkImages(vp,depth){
  const r=await fetch(`${CP}${encodeURI(vp)}/?ls`,{headers:{PW:ME.file_token}}).catch(()=>null);if(!r||!r.ok)return[];
  const j=await r.json();let out=(j.files||[]).filter(f=>/\.(jpe?g|png|gif|webp)$/i.test(f.href)).map(f=>`${CP}${encodeURI(vp)}/${f.href}?pw=${ME.file_token}`);
  if(depth>0)for(const d of (j.dirs||[]).slice(0,15)){if(d.href.startsWith('.'))continue;out=out.concat(await walkImages(`${vp}/${d.href.replace(/\/$/,'')}`,depth-1));}
  return out;
}
$('#lightbox').onclick=()=>$('#lightbox').classList.add('hidden');

/* ══ SHELF — books/music/audiobooks/podcasts ══ */
const SHELVES={books:'▤',music:'♪',audiobooks:'☊',podcasts:'◉'};
async function loadShelf(){
  $('#shelf-seg').innerHTML=Object.keys(SHELVES).map(k=>`<button class="chip${shMode===k?' on':''}" data-s="${k}">${k}</button>`).join('');
  $$('#shelf-seg .chip').forEach(b=>b.onclick=()=>{shMode=b.dataset.s;loadShelf();});
  $('#shelf').innerHTML=`<div class="empty">reading the shelf…</div>`;
  const AUDIO=/\.(mp3|flac|ogg|m4a|wav|opus)$/i;
  const cfg={books:{paths:[`/vault/${ME.username}`,'/public/books','/public/docs'],re:/\.(pdf|epub|mobi|azw3)$/i,grid:true},
    music:{paths:['/public/music'],re:AUDIO,grid:false},audiobooks:{paths:['/public/audiobooks'],re:AUDIO,grid:false},podcasts:{paths:['/public/podcasts'],re:AUDIO,grid:false}}[shMode];
  let items=[];for(const p of cfg.paths)items=items.concat(await walkFiles(p,2,cfg.re));
  if(!items.length){$('#shelf').innerHTML=`<div class="empty">nothing on the ${shMode} shelf</div>`;return;}
  if(cfg.grid){$('#shelf').innerHTML=`<div class="shelfgrid">${items.slice(0,120).map(f=>{const ext=f.name.split('.').pop().toUpperCase();const nm=f.name.replace(/\.\w+$/,'');
    return `<div class="spine" data-u="${f.url}"><div class="cov"><span class="kind">${ext}</span><span class="nm">${esc(nm)}</span></div><div class="t">${esc(nm)}</div></div>`;}).join('')}</div>`;
    $$('.spine').forEach(s=>s.onclick=()=>window.open(s.dataset.u,'_blank'));}
  else{$('#shelf').innerHTML=items.slice(0,150).map(f=>`<div class="trackrow" data-u="${f.url}" data-n="${esc(f.name)}"><button class="pl">▶</button><div class="g"><div class="t">${esc(f.name.replace(/\.\w+$/,''))}</div><div class="s">${f.name.split('.').pop().toUpperCase()}</div></div></div>`).join('');
    $$('.trackrow').forEach(r=>r.onclick=()=>{$('#player').classList.remove('hidden');$('#player-t').textContent=r.dataset.n;$('#player-a').src=r.dataset.u;$('#player-a').play().catch(()=>{});});}
}
async function walkFiles(vp,depth,re){
  const r=await fetch(`${CP}${encodeURI(vp)}/?ls`,{headers:{PW:ME.file_token}}).catch(()=>null);if(!r||!r.ok)return[];
  const j=await r.json();let out=(j.files||[]).filter(f=>re.test(f.href)).map(f=>({name:decodeURIComponent(f.href),url:`${CP}${encodeURI(vp)}/${f.href}?pw=${ME.file_token}`}));
  if(depth>0)for(const d of (j.dirs||[]).slice(0,15)){if(d.href.startsWith('.'))continue;out=out.concat(await walkFiles(`${vp}/${d.href.replace(/\/$/,'')}`,depth-1,re));}
  return out;
}

/* ══ SLEEP ══ */
async function loadSleep(){
  const rows=await api('/api/sleep/recent').catch(()=>[]);
  $('#sleeplist').innerHTML=rows.map(s=>{const d=s.woke_at?hrs(s.slept_at,s.woke_at).toFixed(1)+'h':'?';return `<div class="sess"><div class="g"><div class="t">${day(s.slept_at)}</div><div class="s">${d}${s.quality?' · quality '+s.quality+'/5':''}</div></div></div>`;}).join('')||`<div class="empty">no sleep synced — pair the puck</div>`;
}
$('#sleep-key').onclick=async()=>{const r=await api('/api/sleep/devicekey',{method:'POST',body:JSON.stringify({label:'alarm-puck'})});const el=$('#sleep-key-out');el.textContent=r.key;el.classList.remove('hidden');toast('key shown once');};

/* ══ JOURNAL ══ */
let curEntry=null;
async function loadJournal(){
  $('#j-editor').classList.add('hidden');$('#j-list').classList.remove('hidden');
  const rows=await api('/api/journal').catch(()=>[]);
  $('#j-list').innerHTML=rows.map(e=>`<div class="fcard" data-id="${e.id}" style="cursor:pointer;margin-bottom:10px"><div class="fhead"><span class="tag">${day(e.created_at)}</span></div><div class="f-title">${esc(e.title||'untitled')}</div><div class="f-note" style="max-height:44px;overflow:hidden">${esc(e.body||'')}</div></div>`).join('')||`<div class="empty">empty pages, waiting</div>`;
  $$('#j-list .fcard').forEach(el=>el.onclick=async()=>{const all=await api('/api/journal');openEntry(all.find(x=>x.id==el.dataset.id));});
}
function openEntry(e){curEntry=e||null;$('#j-list').classList.add('hidden');$('#j-editor').classList.remove('hidden');$('#j-title').value=e?.title||'';$('#j-body').value=e?.body||'';$('#j-del').classList.toggle('hidden',!e);}
$('#j-new').onclick=()=>openEntry(null);
$('#j-save').onclick=async()=>{const p={title:$('#j-title').value,body:$('#j-body').value};if(curEntry)await api(`/api/journal/${curEntry.id}`,{method:'PUT',body:JSON.stringify(p)});else await api('/api/journal',{method:'POST',body:JSON.stringify(p)});toast('saved');loadJournal();};
$('#j-del').onclick=async()=>{await api(`/api/journal/${curEntry.id}`,{method:'DELETE'});toast('deleted');loadJournal();};

/* ══ REVIEW (pending) ══ */
async function loadReview(){
  const rows=await api(`/api/pending${ME.is_admin?'?all=1':''}`).catch(()=>[]);
  if(!rows.length){$('#pendinglist').innerHTML=`<div class="empty">nothing pending 🎉</div>`;return;}
  $('#pendinglist').innerHTML=rows.map(r=>`<div class="sgroup" data-id="${r.id}" style="padding:14px 16px"><div class="t" style="font-size:13.5px;word-break:break-all">${esc(r.filename)}</div><div class="s" style="color:var(--dim);margin:4px 0 10px">${esc(r.owner)} · ${sz(r.size_bytes)} · → ${esc(r.intended_dest)}${r.status==='flagged'?`<div style="color:#b4553f">⚠ ${esc(r.flag_reason||'flagged')}</div>`:' · scanning…'}</div>${r.status==='flagged'?`<div class="row"><button class="sbtn rel">Release</button><button class="sbtn warn rej">Delete</button></div>`:''}</div>`).join('');
  $$('#pendinglist .rel').forEach(b=>b.onclick=()=>pact(b,'release'));
  $$('#pendinglist .rej').forEach(b=>b.onclick=()=>pact(b,'reject'));
}
async function pact(b,a){const id=b.closest('[data-id]').dataset.id;try{await api(`/api/pending/${id}/${a}`,{method:'POST'});toast(a==='release'?'released':'deleted');loadReview();badge();}catch(e){toast(e.message);}}

/* ══ SETTINGS ══ */
async function loadSettings(){
  $('#s-avatar').textContent=ME.username.slice(0,2).toUpperCase();
  $('#s-name').textContent=ME.username;$('#s-role').textContent=ME.is_admin?'admin':'member';
  $('#pick-theme').innerHTML=['light','dark'].map(t=>`<button class="chip${UI.theme===t?' on':''}" data-v="${t}">${t}</button>`).join('');
  $('#pick-tone').innerHTML=['warm','neutral','cool'].map(t=>`<button class="chip${UI.tone===t?' on':''}" data-v="${t}">${t}</button>`).join('');
  $('#pick-surface').innerHTML=['flat','soft','glass'].map(t=>`<button class="chip${UI.surface===t?' on':''}" data-v="${t}">${t}</button>`).join('');
  $$('#pick-theme .chip').forEach(b=>b.onclick=()=>{UI.theme=b.dataset.v;saveUI();loadSettings();});
  $$('#pick-tone .chip').forEach(b=>b.onclick=()=>{UI.tone=b.dataset.v;saveUI();loadSettings();});
  $$('#pick-surface .chip').forEach(b=>b.onclick=()=>{UI.surface=b.dataset.v;saveUI();loadSettings();});
  // services
  const DESC={work:'hours, earnings, org visibility',fitness:'opens Workout Gen',meals:'opens Meal Prep',sleep:'puck sync, quality',journal:'private writing'};
  const MI={work:'◷',fitness:'◍',meals:'◐',sleep:'☾',journal:'✎'};
  SVC=await api('/api/services');
  $('#svc-list').innerHTML=SVC.map(s=>`<div class="srow" data-svc="${s.service}"><div class="g"><div class="t">${MI[s.service]} ${s.service}</div><div class="s">${DESC[s.service]}</div></div>${s.service==='work'?`<input class="rate" type="number" step="0.5" placeholder="$/hr" value="${s.settings.hourly_rate??''}">`:''}<div class="sw${s.enabled?' on':''}"></div></div>`).join('');
  $$('#svc-list .sw').forEach(sw=>sw.onclick=()=>svcToggle(sw.closest('.srow'),!sw.classList.contains('on')));
  $$('#svc-list .rate').forEach(r=>r.onchange=()=>{const row=r.closest('.srow');svcToggle(row,row.querySelector('.sw').classList.contains('on'));});
  // snapshots
  const paired=SVC.filter(x=>x.enabled).map(x=>SVCAPP[x.service]).filter(Boolean);
  const apps=[...new Set(['workout-gen','meal-prep','contract-manager',...paired])];
  const rows=[];for(const a of apps){const sn=await api(`/api/kv/${a}/snapshots`).catch(()=>[]);rows.push(`<div class="snaprow" data-app="${a}"><div class="g"><div class="t">${a}</div><div class="s">${sn.length?sn.length+' snapshots · latest '+dt(sn[0].created_at):'no snapshots'}</div></div><button class="sbtn snap-now">Snapshot</button>${sn.length?`<button class="sbtn warn snap-restore" data-sid="${sn[0].id}">Restore</button>`:''}</div>`);}
  $('#snaplist').innerHTML=rows.join('');
  $$('.snap-now').forEach(b=>b.onclick=async()=>{const a=b.closest('.snaprow').dataset.app;const r=await api(`/api/kv/${a}/snapshot`,{method:'POST'});toast(`${a}: ${r.keys} keys`);loadSettings();});
  $$('.snap-restore').forEach(b=>b.onclick=async()=>{const a=b.closest('.snaprow').dataset.app;const r=await api(`/api/kv/${a}/restore/${b.dataset.sid}`,{method:'POST'});toast(`${a}: restored ${r.keys}`);});
  // admin
  if(ME.is_admin){$('#admin-group').classList.remove('hidden');const users=await api('/api/users').catch(()=>[]);
    $('#userlist').innerHTML=users.map(u=>`<div class="urow"><div class="g">${esc(u.username)} <span class="s">joined ${day(u.created_at)}</span></div>${u.is_admin?'<span class="utag">admin</span>':''}${u.must_change_pw?'<span class="utag">reset pending</span>':''}</div>`).join('');}
}
async function svcToggle(row,on){const svc=row.dataset.svc;const settings={};const rate=row.querySelector('.rate');if(rate&&rate.value)settings.hourly_rate=+rate.value;await api(`/api/services/${svc}`,{method:'PUT',body:JSON.stringify({enabled:on,settings})});row.querySelector('.sw').classList.toggle('on',on);SVC=await api('/api/services');buildNav();toast(on?`${svc} paired`:`${svc} unpaired`);}
$('#cp-save').onclick=async()=>{try{await api('/api/password',{method:'POST',body:JSON.stringify({current_password:$('#cp-cur').value,new_password:$('#cp-new').value})});$('#cp-cur').value=$('#cp-new').value='';toast('password changed');}catch(e){toast(e.message);}};
$('#au-add').onclick=async()=>{try{const r=await api('/api/users',{method:'POST',body:JSON.stringify({username:$('#au-name').value.trim(),password:$('#au-pass').value})});toast(r.warning||'user created');$('#au-name').value=$('#au-pass').value='';loadSettings();}catch(e){toast(e.message);}};

/* ══ custom date/time pickers ══ */
function dtpInit(){$$('.dtp-btn').forEach(btn=>btn.onclick=e=>{e.stopPropagation();$$('.dtp-pop').forEach(p=>p.remove());btn.parentNode.style.position='relative';btn.parentNode.appendChild(btn.dataset.kind==='date'?dtpCal(btn):dtpTime(btn));});}
document.addEventListener('click',()=>$$('.dtp-pop').forEach(p=>p.remove()));
function dtpCal(btn){const pop=document.createElement('div');pop.className='dtp-pop';pop.style.cssText='position:absolute;top:calc(100% + 6px);left:0;z-index:60;background:var(--card);border:var(--cardBd);box-shadow:var(--sh);backdrop-filter:var(--bdrop);border-radius:14px;padding:12px;min-width:250px';pop.onclick=e=>e.stopPropagation();
  let cur=DTP[btn.id]?new Date(DTP[btn.id]):new Date();
  const render=()=>{const y=cur.getFullYear(),m=cur.getMonth(),first=new Date(y,m,1).getDay(),dz=new Date(y,m+1,0).getDate();
    pop.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;color:var(--ink)"><button data-d="-1" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:16px">‹</button><span>${cur.toLocaleString(undefined,{month:'long',year:'numeric'})}</span><button data-d="1" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:16px">›</button></div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">${['S','M','T','W','T','F','S'].map(d=>`<span style="font-size:10px;color:var(--dim);padding:4px 0">${d}</span>`).join('')}${'<span></span>'.repeat(first)}${Array.from({length:dz},(_,i)=>`<span class="cd" style="padding:7px 0;border-radius:8px;cursor:pointer;font-size:13px;color:var(--ink)">${i+1}</span>`).join('')}</div>`;
    pop.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{cur.setMonth(cur.getMonth()+ +b.dataset.d);render();});
    pop.querySelectorAll('.cd').forEach(d=>{d.onmouseenter=()=>d.style.background='var(--hl)';d.onmouseleave=()=>d.style.background='';d.onclick=()=>{const mm=String(m+1).padStart(2,'0'),dd=String(d.textContent).padStart(2,'0');DTP[btn.id]=`${y}-${mm}-${dd}`;btn.textContent=new Date(DTP[btn.id]+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});pop.remove();};});};
  render();return pop;}
function dtpTime(btn){const pop=document.createElement('div');pop.className='dtp-pop';pop.style.cssText='position:absolute;top:calc(100% + 6px);left:0;z-index:60;background:var(--card);border:var(--cardBd);box-shadow:var(--sh);backdrop-filter:var(--bdrop);border-radius:14px;padding:12px';pop.onclick=e=>e.stopPropagation();
  const[ch,cm]=(DTP[btn.id]||'09:00').split(':').map(Number);
  pop.innerHTML=`<div style="display:flex;gap:8px;align-items:center"><div class="tcol" id="th" style="height:150px;overflow-y:auto;width:60px;background:var(--panel2);border-radius:10px">${Array.from({length:24},(_,i)=>`<div class="tt" style="padding:9px 0;text-align:center;cursor:pointer;font-size:15px;color:${i===ch?'var(--accent)':'var(--ink)'}">${String(i).padStart(2,'0')}</div>`).join('')}</div><b>:</b><div class="tcol" id="tm" style="height:150px;overflow-y:auto;width:60px;background:var(--panel2);border-radius:10px">${Array.from({length:12},(_,i)=>`<div class="tt" style="padding:9px 0;text-align:center;cursor:pointer;font-size:15px;color:${i*5===cm?'var(--accent)':'var(--ink)'}">${String(i*5).padStart(2,'0')}</div>`).join('')}</div></div>`;
  const pick=()=>{const h=pop.querySelector('#th .sel')?.textContent||String(ch).padStart(2,'0');const m=pop.querySelector('#tm .sel')?.textContent||String(cm).padStart(2,'0');DTP[btn.id]=`${h}:${m}`;btn.textContent=DTP[btn.id];};
  pop.querySelectorAll('.tt').forEach(d=>d.onclick=()=>{d.parentNode.querySelectorAll('.tt').forEach(x=>{x.classList.remove('sel');x.style.color='var(--ink)';});d.classList.add('sel');d.style.color='var(--accent)';pick();});
  return pop;}
dtpInit();

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
boot();
