/* ═══ NOOK — wired to live /api + copyparty ═══ */
const CP = `${location.protocol}//${location.hostname}:3923`;
let ME=null, SVC=[], MYGROUPS=[], UI={theme:'light'};
let curView='home', WSESS=[], DTP={}, tTick=null, incMode='w';
let shMode='books', medMode='mine';

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
function applyUI(){document.documentElement.dataset.theme=UI.theme;
  const tb=$('#theme-btn');if(tb)tb.textContent=UI.theme==='light'?'\u263e':'\u2600';
  document.querySelector('meta[name=theme-color]').content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();}
function saveUI(){applyUI();api('/api/kv/nook',{method:'PUT',body:JSON.stringify({ui:JSON.stringify(UI)})}).catch(()=>{});}

/* ── auth ── */
async function boot(){try{ME=await api('/api/me');await afterLogin();}catch{$('#v-lock').classList.remove('hidden');}}
$('#lg-btn').onclick=async()=>{try{ME=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#lg-user').value.trim(),password:$('#lg-pass').value})});$('#v-lock').classList.add('hidden');await afterLogin();}catch{$('#lg-err').textContent='wrong username or password';}};
$('#lg-pass').addEventListener('keydown',e=>{if(e.key==='Enter')$('#lg-btn').click();});
$('#lg-eye').onclick=()=>{const p=$('#lg-pass');p.type=p.type==='password'?'text':'password';};
$('#sp-btn').onclick=async()=>{const a=$('#sp-a').value,b=$('#sp-b').value;if(a!==b){$('#sp-err').textContent="passwords don't match";return;}if(a.length<8){$('#sp-err').textContent='min 8 characters';return;}try{await api('/api/password',{method:'POST',body:JSON.stringify({new_password:a})});ME.must_change_pw=false;$('#v-setpw').classList.add('hidden');await afterLogin();}catch(e){$('#sp-err').textContent=e.message;}};

async function afterLogin(){
  if(ME.must_change_pw){$('#v-setpw').classList.remove('hidden');return;}
  document.cookie=`cppwd=${ME.file_token}; path=/; max-age=2592000`;
  try{const kv=await api('/api/kv/nook');if(kv.ui)UI={...UI,...JSON.parse(kv.ui)};}catch{}
  applyUI();
  $('#v-app').classList.remove('hidden');
  MYGROUPS=await api('/api/groups').catch(()=>[]);
  SVC=await api('/api/services').catch(()=>[]);
  $('#side-name').textContent=ME.username;
  buildNav();
  show('home');
  badge();setInterval(badge,15000);
}
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload();};

/* ── nav ── */
const CORE=[['home','Stream'],['archive','Archive'],['photos','Photos'],['shelf','Shelf']];
const SVCNAV={work:['hours','Hours'],fitness:['workout','Workout'],meals:['meal','Meal Prep'],sleep:['sleep','Sleep'],journal:['journal','Journal']};
const SVCAPP={workout:'workout-gen',meal:'meal-prep',contractor:'contract-manager'};
const TITLES={home:'Stream',archive:'Archive',photos:'Photos',shelf:'Shelf',hours:'Hours',sleep:'Sleep',journal:'Journal',review:'Review',settings:'Settings'};
const NAVDOT={home:'var(--accent)',hours:'var(--a-work)',archive:'var(--a-video)',photos:'var(--a-photo)',shelf:'var(--a-audio)',sleep:'var(--a-idea)',journal:'var(--a-note)',review:'var(--a-todo)',settings:'var(--ink-3)',workout:'var(--a-workout)',meal:'var(--a-meal)',contractor:'var(--a-file)'};
function buildNav(){
  const paired=SVC.filter(x=>x.enabled).map(x=>x.service);
  const items=[...CORE];paired.forEach(x=>SVCNAV[x]&&items.push(SVCNAV[x]));
  items.push(['contractor','Contractor'],['review','Review'],['settings','Settings']);
  $('#nav').innerHTML=items.map(([v,l])=>`<button class="navitem" data-view="${v}"><span class="dot" style="background:${NAVDOT[v]||'var(--ink-3)'}"></span><span style="flex:1">${l}</span>${v==='review'?'<span class="cnt hidden" id="pbadge"></span>':''}</button>`).join('');
  $$('.navitem').forEach(b=>b.onclick=()=>{const v=b.dataset.view;if(SVCAPP[v])return location.href=`/apps/${SVCAPP[v]}/`;show(v);closeNav();});
}
function show(v){
  curView=v;
  $$('.view').forEach(x=>x.classList.add('hidden'));
  $(`#w-${v}`)?.classList.remove('hidden');
  $$('.navitem').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  $('#mtitle').textContent=TITLES[v]||v;
  $('#brand-title').textContent=TITLES[v]||'Nook';
  ['facetzone','tagzone','peoplezone'].forEach(z=>{const el=$('#'+z);if(el)el.classList.toggle('hidden',v!=='home');});
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


/* upload → copyparty staging; scanner moves it to your vault when clean */
async function upload(f, meta){
  const fn=`dump-${Date.now().toString(36)}-${f.name}`;
  toast(`uploading ${f.name}…`);
  let r;
  try{
    r=await fetch(`${CP}/up/vault/${ME.username}/${encodeURIComponent(fn)}`,
      {method:'PUT',headers:{PW:ME.file_token},body:f});
  }catch(e){ toast(`upload failed — can't reach the file server`); return null; }
  if(!r.ok){
    const why = r.status===403 ? "permission denied on the server's staging folder (run sync_copyparty.py --fix-perms as root)"
      : r.status===404 ? 'upload volume missing — re-run sync_copyparty.py'
      : r.status===413 ? 'file too large'
      : `HTTP ${r.status}`;
    toast(`${f.name}: ${why}`);
    console.error('upload failed', r.status, await r.text().catch(()=>''));
    return null;
  }
  await api('/api/dump',{method:'POST',body:JSON.stringify({
    content:f.name, file_path:`/vault/${ME.username}/${fn}`, meta:meta||{}})});
  return fn;
}

/* ══ STREAM (Home rework) ══ */
const RESERVED={todo:'todo',task:'todo',workout:'workout',lift:'workout',run:'workout',meal:'meal',food:'meal',work:'work',idea:'idea',note:'note',link:'link'};
const KMETA={note:{label:'Note',icon:'M4 20h4L18 8l-4-4L4 16z'},todo:{label:'To-do',icon:'M5 13l4 4L19 7'},workout:{label:'Workout',icon:'M3 12h4l3 8 4-16 3 8h4'},meal:{label:'Meal',icon:'M4 11h16a8 8 0 01-16 0z'},work:{label:'Work',icon:'M4 8h16v11H4z M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2'},idea:{label:'Idea',icon:'M9 18h6M10 21h4M12 3a6 6 0 013 11v1H9v-1a6 6 0 013-11z'},photo:{label:'Photo',icon:'M3 5h18v14H3z M3 15l5-5 4 4 3-3 5 5'},link:{label:'Link',icon:'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1 M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1'},audio:{label:'Audio',icon:'M9 18V5l10-2v13 M9 18a3 3 0 11-6 0 3 3 0 016 0 M19 16a3 3 0 11-6 0 3 3 0 016 0'},video:{label:'Video',icon:'M8 6l10 6-10 6z'},file:{label:'File',icon:'M6 3h8l4 4v14H6z M14 3v5h5'}};
const SOLID={todo:'var(--card-todo)',meal:'var(--card-meal)',workout:'var(--card-workout)',work:'var(--card-work)',idea:'var(--card-idea)'};
const AC=k=>`var(--a-${k})`;
let SF={type:'all',tag:null,person:null,query:'',date:null},FEED=[],draftFiles=[],expandedId=null,editingId=null,calMonth=null,calOpen=false;
const isUrl=t=>{t=(t||'').trim();return /^(https?:\/\/|www\.)\S+$/i.test(t)&&!/\s/.test(t);};
const hostOf=u=>{try{return new URL(/^https?:/i.test(u)?u:'https://'+u).hostname.replace(/^www\./,'');}catch{return u;}};
const fileKind=n=>{const e=((n||'').split('.').pop()||'').toLowerCase();const m={pdf:['PDF','#c65b52'],doc:['DOC','#3f6fb0'],docx:['DOC','#3f6fb0'],xls:['XLS','#4e8a5b'],xlsx:['XLS','#4e8a5b'],csv:['CSV','#4e8a5b'],ppt:['PPT','#c17d3f'],pptx:['PPT','#c17d3f'],zip:['ZIP','#8a7fa8'],txt:['TXT','#7a746a'],md:['MD','#7a746a'],json:['JSON','#7a746a']};return m[e]?{kind:m[e][0],color:m[e][1]}:{kind:(e||'FILE').toUpperCase().slice(0,4),color:'#5f7fb0'};};
const personColor=n=>{const p=['#c8763a','#5a9e64','#8974cf','#d96fa1','#3fa091','#dd8250','#5f7fb0'];let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))>>>0;return p[h%p.length];};
const dayKey=ts=>{const d=new Date(ts*1000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
function parseDraft(t){
  const tags=[],people=[];let category=null,due=null;
  const text=(t||'').replace(/\/\/(@?[\w:-]+)/g,(_,tok)=>{
    if(tok.startsWith('@')){people.push(tok.slice(1));return '';}
    if(tok.startsWith('due:')){due=tok.slice(4);return '';}
    const low=tok.toLowerCase();
    if(RESERVED[low]){if(!category)category=RESERVED[low];return '';}
    tags.push(low);return '';
  }).replace(/\s+/g,' ').trim();
  return {text,tags,people,category,due};
}
function kindOf(m){
  const meta=entMeta(m);
  if(meta.cmd)return meta.cmd;
  if(m.kind==='link')return 'link';
  if(m.kind==='file'){const f=m.file_path||'';if(/\.(jpe?g|png|gif|webp)$/i.test(f))return 'photo';if(/\.(mp4|webm|mov|m4v)$/i.test(f))return 'video';if(/\.(mp3|flac|ogg|m4a|wav|opus)$/i.test(f))return 'audio';return 'file';}
  return 'note';
}
function entMeta(m){try{return JSON.parse(m.meta||'{}');}catch{return {};}}
async function loadHome(){
  const n=new Date(),h=n.getHours();
  $('#hd-kick').textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  $('#hd-week').textContent=n.toLocaleDateString(undefined,{weekday:'long'});
  if(!calMonth)calMonth=new Date(n.getFullYear(),n.getMonth(),1).getTime();
  $('#cmdchips').innerHTML=[['//todo','todo'],['//workout','workout'],['//meal','meal'],['//work','work'],['//idea','idea']].map(([c,k])=>`<button class="cmdchip" data-cmd="${c}" style="color:${AC(k)}">${c}</button>`).join('');
  $$('#cmdchips .cmdchip').forEach(b=>b.onclick=()=>{const ta=$('#cmp-ta');ta.value+=(ta.value&&!/\s$/.test(ta.value)?' ':'')+b.dataset.cmd+' ';ta.focus();onDraftInput();});
  await refreshStream();
}
async function refreshStream(){
  FEED=await api('/api/dump').catch(()=>[]);
  $('#hd-date').textContent=new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+' · '+FEED.length+' captures';
  renderSidebarFacets();renderStream();badge();
}
function renderSidebarFacets(){
  const counts={all:FEED.length};FEED.forEach(m=>{const k=kindOf(m);counts[k]=(counts[k]||0)+1;});
  const order=['all','note','todo','workout','meal','work','idea','photo','video','audio','link','file'];
  const fz=order.filter(k=>k==='all'||counts[k]);
  $('#facetzone').innerHTML=`<div class="sechead">Stream</div><div class="navlist">`+fz.map(k=>`<button class="navitem ${SF.type===k?'on':''}" data-facet="${k}"><span class="dot" style="background:${k==='all'?'var(--ink)':AC(k)}"></span><span style="flex:1">${k==='all'?'Everything':KMETA[k].label+'s'}</span><span class="cnt">${counts[k]||0}</span></button>`).join('')+`</div>`;
  $('#facet-row').innerHTML=fz.map(k=>`<button class="facetchip ${SF.type===k?'on':''}" data-facet="${k}"><span class="dot" style="background:${k==='all'?'currentColor':AC(k)}"></span>${k==='all'?'All':KMETA[k].label}<span style="opacity:.6;font:600 10px 'JetBrains Mono',monospace">${counts[k]||0}</span></button>`).join('');
  $$('[data-facet]').forEach(b=>b.onclick=()=>{SF.type=b.dataset.facet;renderSidebarFacets();renderStream();});
  const tags={},people={};
  FEED.forEach(m=>{const x=entMeta(m);(x.tags||[]).forEach(t=>tags[t]=(tags[t]||0)+1);(x.people||[]).forEach(p=>people[p]=(people[p]||0)+1);});
  $('#tagzone').innerHTML=Object.keys(tags).length?`<div class="sechead">Tags</div><div class="tagwrap">`+Object.entries(tags).map(([t,c])=>`<button class="tagpill ${SF.tag===t?'on':''}" data-tag="${esc(t)}">//${esc(t)}<span style="opacity:.65;font:600 9.5px 'JetBrains Mono',monospace">${c}</span></button>`).join('')+`</div>`:'';
  $('#peoplezone').innerHTML=Object.keys(people).length?`<div class="sechead">People</div><div class="tagwrap">`+Object.keys(people).map(p=>`<button class="tagpill ${SF.person===p?'on':''}" data-person="${esc(p)}"><span style="width:19px;height:19px;border-radius:50%;background:${personColor(p)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font:700 9px 'JetBrains Mono',monospace">${esc(p[0].toUpperCase())}</span>@${esc(p)}</button>`).join('')+`</div>`:'';
  $$('[data-tag]').forEach(b=>b.onclick=e=>{e.stopPropagation();SF.tag=SF.tag===b.dataset.tag?null:b.dataset.tag;renderSidebarFacets();renderStream();});
  $$('[data-person]').forEach(b=>b.onclick=()=>{SF.person=SF.person===b.dataset.person?null:b.dataset.person;renderSidebarFacets();renderStream();});
}
function renderStream(){
  let items=FEED.filter(m=>{
    const k=kindOf(m),x=entMeta(m);
    if(SF.type!=='all'&&k!==SF.type)return false;
    if(SF.tag&&!(x.tags||[]).includes(SF.tag))return false;
    if(SF.person&&!(x.people||[]).includes(SF.person))return false;
    if(SF.date&&dayKey(m.created_at)!==SF.date)return false;
    if(SF.query){const q=SF.query.toLowerCase();if(!((m.content||'')+' '+(m.file_path||'')).toLowerCase().includes(q))return false;}
    return true;
  });
  const chips=[];
  if(SF.type!=='all')chips.push(['type',KMETA[SF.type].label]);
  if(SF.tag)chips.push(['tag','//'+SF.tag]);if(SF.person)chips.push(['person','@'+SF.person]);
  if(SF.query)chips.push(['query',SF.query]);if(SF.date)chips.push(['date',SF.date]);
  $('#filterbar').classList.toggle('hidden',!chips.length);
  if(chips.length)$('#filterbar').innerHTML=`<span>Filter</span>`+chips.map(([k,l])=>`<button class="fchipx" data-clr="${k}">${esc(l)} ✕</button>`).join('')+`<button class="fchipx" data-clr="all" style="border:none;color:var(--accent)">Clear all</button><span style="flex:1"></span><span style="text-transform:none;letter-spacing:0">${items.length} results</span>`;
  $$('#filterbar [data-clr]').forEach(b=>b.onclick=()=>{const k=b.dataset.clr;
    if(k==='all')SF={type:'all',tag:null,person:null,query:'',date:null};
    else{if(k==='type')SF.type='all';if(k==='tag')SF.tag=null;if(k==='person')SF.person=null;if(k==='query'){SF.query='';$('#hq').value='';}if(k==='date')SF.date=null;}
    $('#cal-label').textContent=SF.date||'All dates';renderSidebarFacets();renderStream();});
  if(!items.length){$('#stream').innerHTML=`<div class="emptywrap"><div class="ei"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></div><div class="et">${FEED.length?'Nothing matches':'Your stream is empty'}</div><div class="eb">${FEED.length?'Loosen a filter or clear the search.':'Write a note, paste a link, or drop a file above.'}</div></div>`;return;}
  const groups={};items.forEach(m=>{(groups[dayKey(m.created_at)]??=[]).push(m);});
  const todayK=dayKey(Date.now()/1000),ydK=dayKey(Date.now()/1000-86400);
  $('#stream').innerHTML=Object.keys(groups).sort().reverse().map(k=>{
    const es=groups[k].sort((a,b)=>((entMeta(b).pinned?1:0)-(entMeta(a).pinned?1:0))||b.created_at-a.created_at);
    const d=new Date(k+'T12:00');
    const label=k===todayK?'Today':k===ydK?'Yesterday':d.toLocaleDateString(undefined,{month:'long',day:'numeric'});
    return `<div class="dayhead"><span class="dl">${label}</span><span class="ds">${d.toLocaleDateString(undefined,{weekday:'short'})} · ${es.length}</span><span class="rule"></span></div>`+es.map(entryCard).join('');
  }).join('');
  wireStream();
}
function entryCard(m){
  const k=kindOf(m),x=entMeta(m),meta=KMETA[k]||KMETA.note;
  const exp=expandedId==m.id,edit=editingId==m.id;
  const solid=SOLID[k],cardBg=solid||'var(--panel)',frost=solid?'none':'blur(12px)';
  const url=m.file_path?`${CP}${encodeURI(m.file_path)}?pw=${ME.file_token}`:'';
  const done=!!x.done,sens=!!x.sensitive;
  const headline=m.kind==='link'?hostOf(m.content):(m.content||(m.file_path||'').split('/').pop()||'—');
  const chipBg=solid?'rgba(0,0,0,.07)':'var(--surface)';
  let metaChip='';
  if(k==='photo')metaChip=`<img class="thumb${sens?' blur':''}" src="${url}" onerror="this.replaceWith('⏳')">`;
  else if(m.kind==='file'&&k==='file')metaChip=`<span class="metachip" style="background:${chipBg};color:${AC(k)}">${fileKind(m.file_path).kind}</span>`;
  let body='';
  if(exp&&edit){
    body=`<div class="ebody"><textarea class="editbox" id="editbox">${esc(srcOf(m))}</textarea>
      <div class="row"><button class="sbtn" data-saveedit="${m.id}">Save</button><button class="ebtn" data-canceledit="1">Cancel</button></div></div>`;
  }else if(exp){
    const parts=[];
    if(m.kind==='text'&&m.content)parts.push(`<div class="etext">${esc(m.content)}</div>`);
    if(k==='photo')parts.push(`<div class="photogrid2" style="grid-template-columns:1fr"><img class="${sens?'blur':''}" src="${url}" data-url="${url}" onerror="this.replaceWith('still scanning — refresh soon')"></div>`);
    if(k==='video')parts.push(`<video class="${sens?'blur':''}" src="${url}" controls playsinline preload="metadata"></video>`);
    if(k==='audio')parts.push(`<div class="mediarow"><span class="sq" style="background:${AC('audio')}">♪</span><div class="g"><div class="t">${esc(m.content||'')}</div><audio src="${url}" controls></audio></div></div>`);
    if(k==='file'&&m.kind==='file'){const fk=fileKind(m.file_path);parts.push(`<a class="mediarow" href="${url}" download><span class="sq" style="background:${fk.color}">${fk.kind}</span><div class="g"><div class="t">${esc(m.content||m.file_path.split('/').pop())}</div><div class="s">tap to download</div></div></a>`);}
    if(m.kind==='link')parts.push(`<a class="mediarow" href="${esc(m.content)}" target="_blank" rel="noopener"><span class="sq" style="background:${AC('link')}">↗</span><div class="g"><div class="t">${esc(hostOf(m.content))}</div><div class="s" style="color:var(--accent)">${esc(m.content)}</div></div></a>`);
    if((x.people||[]).length)parts.push(`<div style="display:flex;gap:6px;flex-wrap:wrap">${x.people.map(p=>`<span class="tagpill" style="cursor:default"><span style="width:19px;height:19px;border-radius:50%;background:${personColor(p)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font:700 9px 'JetBrains Mono',monospace">${esc(p[0].toUpperCase())}</span>@${esc(p)}</span>`).join('')}</div>`);
    if(x.due)parts.push(`<div class="metachip" style="align-self:flex-start;background:${chipBg};color:${AC(k)}">due ${esc(x.due)}</div>`);
    parts.push(`<div class="eactions"><span class="when">${dt(m.created_at)}</span><span style="flex:1"></span>
      ${m.kind==='text'?`<button class="ebtn" data-edit="${m.id}">Edit</button>`:''}
      ${m.kind==='file'?`<button class="ebtn" data-sens="${m.id}">${sens?'Unblur':'Mark sensitive'}</button>`:''}
      <button class="eicon ${x.pinned?'pinned':''}" data-pin="${m.id}" title="Pin">⚲</button>
      <button class="eicon" data-del="${m.id}" title="Delete">🗑</button></div>`);
    body=`<div class="ebody">${parts.join('')}</div>`;
  }
  return `<div class="entry"><div class="tcol">${tm(m.created_at)}</div>
    <div class="railcol"><div class="rl"></div><div class="nd" style="background:${AC(k)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${meta.icon}"/></svg></div></div>
    <div class="ecard" style="background:${cardBg};backdrop-filter:${frost};-webkit-backdrop-filter:${frost};border-color:${solid?'transparent':'var(--line)'}">
      <div class="head" data-expand="${m.id}">
        <div class="chips"><span class="typechip" style="background:${chipBg};color:${AC(k)}"><span class="dd" style="background:${AC(k)}"></span>${meta.label}</span>
          ${(x.tags||[]).map(t=>`<button class="minitag" data-tag="${esc(t)}">//${esc(t)}</button>`).join('')}
          <span style="flex:1"></span>
          ${x.pinned?'<span style="color:var(--accent)">⚲</span>':''}
          <svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${exp?180:0}deg)"><path d="M6 9l6 6 6-6"/></svg></div>
        <div class="hrow">
          ${k==='todo'?`<button class="checkbx ${done?'done':''}" data-done="${m.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity:${done?1:0}"><path d="M5 13l4 4L19 7"/></svg></button>`:''}
          <div class="headline ${done?'done':''}">${esc(headline)}</div>${metaChip}</div>
      </div>${body}</div></div>`;
}
function srcOf(m){const x=entMeta(m);const p=[m.content||''];if(x.cmd)p.push('//'+x.cmd);(x.tags||[]).forEach(t=>p.push('//'+t));(x.people||[]).forEach(u=>p.push('//@'+u));if(x.due)p.push('//due:'+x.due);return p.filter(Boolean).join(' ');}
function wireStream(){
  $$('[data-expand]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-done],.minitag'))return;const id=el.dataset.expand;expandedId=expandedId==id?null:id;editingId=null;renderStream();});
  $$('[data-done]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const m=FEED.find(x=>x.id==b.dataset.done);const x=entMeta(m);await api(`/api/dump/${m.id}/meta`,{method:'PUT',body:JSON.stringify({...x,done:!x.done})});refreshStream();});
  $$('[data-pin]').forEach(b=>b.onclick=async()=>{const m=FEED.find(x=>x.id==b.dataset.pin);const x=entMeta(m);await api(`/api/dump/${m.id}/meta`,{method:'PUT',body:JSON.stringify({...x,pinned:!x.pinned})});refreshStream();});
  $$('[data-sens]').forEach(b=>b.onclick=async()=>{const m=FEED.find(x=>x.id==b.dataset.sens);const x=entMeta(m);await api(`/api/dump/${m.id}/meta`,{method:'PUT',body:JSON.stringify({...x,sensitive:!x.sensitive})});refreshStream();});
  $$('[data-del]').forEach(b=>b.onclick=async()=>{await api(`/api/dump/${b.dataset.del}`,{method:'DELETE'});expandedId=null;refreshStream();});
  $$('[data-edit]').forEach(b=>b.onclick=()=>{editingId=b.dataset.edit;renderStream();const e2=$('#editbox');if(e2)e2.focus();});
  $$('[data-canceledit]').forEach(b=>b.onclick=()=>{editingId=null;renderStream();});
  $$('[data-saveedit]').forEach(b=>b.onclick=async()=>{const p=parseDraft($('#editbox').value);const m=FEED.find(x=>x.id==b.dataset.saveedit);const x=entMeta(m);
    await api(`/api/dump/${m.id}/content`,{method:'PUT',body:JSON.stringify({content:p.text})});
    await api(`/api/dump/${m.id}/meta`,{method:'PUT',body:JSON.stringify({...x,cmd:p.category||x.cmd,tags:p.tags,people:p.people,due:p.due})});
    editingId=null;refreshStream();});
  $$('.photogrid2 img:not(.blur)').forEach(im=>im.onclick=()=>{$('#lb-img').src=im.dataset.url;$('#lightbox').classList.remove('hidden');});
  $$('.photogrid2 img.blur,video.blur,.thumb.blur').forEach(el=>el.onclick=e=>{e.stopPropagation();el.classList.remove('blur');});
}
function onDraftInput(){
  const p=parseDraft($('#cmp-ta').value);
  const chips=[];
  if(p.category)chips.push([KMETA[p.category].label,AC(p.category),SOLID[p.category]||'var(--surface)']);
  p.tags.forEach(t=>chips.push(['//'+t,'var(--ink-2)','var(--surface)']));
  p.people.forEach(u=>chips.push(['@'+u,'#fff',personColor(u)]));
  if(p.due)chips.push(['due '+p.due,AC('todo'),'var(--surface)']);
  $('#parsechips').classList.toggle('hidden',!chips.length);
  $('#parsechips').innerHTML=chips.map(([l,fg,bg])=>`<span class="pchip" style="color:${fg};background:${bg}">${esc(l)}</span>`).join('');
}
$('#cmp-ta').addEventListener('input',onDraftInput);
$('#cmp-ta').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();commitDraft();}});
$('#cmp-post').onclick=()=>commitDraft();
['in-photo','in-video','in-audio','in-file'].forEach(id=>{const el=document.getElementById(id);el.onchange=()=>{[...el.files].forEach(f=>draftFiles.push(f));el.value='';renderDraftFiles();};});
function renderDraftFiles(){
  $('#draftfiles').classList.toggle('hidden',!draftFiles.length);
  $('#draftfiles').innerHTML=draftFiles.map((f,i)=>{const img=/^image\//.test(f.type);const fk=fileKind(f.name);
    return `<div class="dfile">${img?`<img src="${URL.createObjectURL(f)}">`:`<span class="kd" style="background:${fk.color}">${fk.kind}</span>`}<span class="nm">${esc(f.name)}</span><button data-rm="${i}">✕</button></div>`;}).join('');
  $$('#draftfiles [data-rm]').forEach(b=>b.onclick=()=>{draftFiles.splice(+b.dataset.rm,1);renderDraftFiles();});
}
async function commitDraft(){
  const p=parseDraft($('#cmp-ta').value);
  if(!p.text&&!draftFiles.length)return;
  const meta={};if(p.category)meta.cmd=p.category;if(p.tags.length)meta.tags=p.tags;if(p.people.length)meta.people=p.people;if(p.due)meta.due=p.due;
  let cap=p.text;const take=()=>{const c=cap;cap='';return c;};
  let sent=0;
  for(const f of draftFiles){
    const ok=await upload(f, {...meta, caption: take()||undefined});
    if(ok) sent++;
  }
  if(draftFiles.length && !sent){ toast('nothing uploaded — see the error above'); return; }
  if(!draftFiles.length)await api('/api/dump',{method:'POST',body:JSON.stringify({content:p.text,meta})});
  else if(cap)await api('/api/dump',{method:'POST',body:JSON.stringify({content:cap,meta})});
  $('#cmp-ta').value='';draftFiles=[];renderDraftFiles();onDraftInput();
  toast('added to stream');refreshStream();
}
$('#hq').addEventListener('input',e=>{SF.query=e.target.value;renderStream();});
$('#cal-btn').onclick=e=>{e.stopPropagation();calOpen=!calOpen;renderCal();};
document.addEventListener('click',e=>{if(calOpen&&!e.target.closest('#cal-pop,#cal-btn')){calOpen=false;$('#cal-pop').classList.add('hidden');}});
function renderCal(){
  const pop=$('#cal-pop');pop.classList.toggle('hidden',!calOpen);if(!calOpen)return;
  const cur=new Date(calMonth);const y=cur.getFullYear(),mo=cur.getMonth();
  const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate();
  const dotDays=new Set(FEED.map(m=>dayKey(m.created_at)));
  pop.className='calpop';
  pop.innerHTML=`<div class="chead"><button class="cnav" data-nav="-1">‹</button><span>${cur.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span><button class="cnav" data-nav="1">›</button></div>
    <div class="calgrid" style="margin-bottom:4px">${['S','M','T','W','T','F','S'].map(d=>`<span class="dw">${d}</span>`).join('')}</div>
    <div class="calgrid">${'<span></span>'.repeat(first)}${Array.from({length:days},(_,i)=>{const key=`${y}-${String(mo+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;const has=dotDays.has(key);
      return `<button class="cday ${SF.date===key?'sel':''} ${has?'':'off'}" data-day="${key}">${i+1}${has?'<span class="d"></span>':''}</button>`;}).join('')}</div>
    <button class="callall" data-clear="1">All dates</button>`;
  pop.querySelectorAll('[data-nav]').forEach(b=>b.onclick=e=>{e.stopPropagation();const d=new Date(calMonth);d.setMonth(d.getMonth()+ +b.dataset.nav);calMonth=d.getTime();renderCal();});
  pop.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{SF.date=SF.date===b.dataset.day?null:b.dataset.day;$('#cal-label').textContent=SF.date||'All dates';calOpen=false;pop.classList.add('hidden');renderStream();});
  pop.querySelector('[data-clear]').onclick=()=>{SF.date=null;$('#cal-label').textContent='All dates';calOpen=false;pop.classList.add('hidden');renderStream();};
}
addEventListener('dragover',e=>{if(curView!=='home'||![...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files'))return;e.preventDefault();$('#dragveil').classList.remove('hidden');});
addEventListener('dragleave',e=>{if(!e.relatedTarget)$('#dragveil').classList.add('hidden');});
addEventListener('drop',e=>{if(curView!=='home')return;e.preventDefault();$('#dragveil').classList.add('hidden');if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){[...e.dataTransfer.files].forEach(f=>draftFiles.push(f));renderDraftFiles();toast('attached — hit Post');}});

function badge(){api(`/api/pending${ME?.is_admin?'?all=1':''}`).then(rows=>{const n=rows.filter(r=>r.status==='flagged').length;const b=$('#pbadge');if(b){b.textContent=n;b.classList.toggle('hidden',n===0);}}).catch(()=>{});}

/* ══ HOURS (rework) ══ */
function workSettings(){const x=SVC.find(v=>v.service==='work');return (x&&x.settings)||{};}
let selOrg=null,STATUS=null;
async function loadHours(){
  const st=workSettings();
  $('#hh-day').textContent=new Date().toLocaleDateString(undefined,{weekday:'long'});
  $('#hh-emp').textContent=(st.hourly_rate?`$${st.hourly_rate}/hr`:'set your rate in Settings')+' · single-page tracker';
  STATUS=await api('/api/work/status').catch(()=>({}));
  // org chips
  if(selOrg===null)selOrg=st.default_group||0;
  const orgs=[{id:0,name:'Personal',color:'var(--ink-3)'},...MYGROUPS.map((g,i)=>({id:g.id,name:g.name,color:['#CE5B3C','#6E7360','#8974cf','#3fa091'][i%4]}))];
  $('#orgchips').innerHTML=orgs.map(o=>`<button class="projchip ${selOrg==o.id?'on':''}" data-org="${o.id}"><span class="pc" style="background:${o.color}"></span>${esc(o.name)}</button>`).join('');
  $$('#orgchips .projchip').forEach(b=>b.onclick=()=>{selOrg=+b.dataset.org;loadHours();});
  const btn=$('#hstart');
  if(STATUS.id){btn.textContent='Clock out';btn.classList.add('running');$('#hnote-add').classList.remove('hidden');startTick(STATUS.started_at);
    $('#clk-sub').textContent=`on the clock · ${esc(STATUS.activity||'work')}${STATUS.group_id?' · org':''}`;}
  else{btn.textContent='Clock in';btn.classList.remove('running');$('#hnote-add').classList.add('hidden');stopTick();$('#clk-sub').textContent='not on the clock';}
  btn.onclick=async()=>{
    if(STATUS.id){await api('/api/work/clockout',{method:'POST'});toast('clocked out');}
    else{const body={activity:'work',note:$('#hnote').value||null};if(selOrg)body.group_id=selOrg;
      await api('/api/work/clockin',{method:'POST',body:JSON.stringify(body)});toast('clocked in');$('#hnote').value='';}
    loadHours();};
  $('#hnote-add').onclick=async()=>{
    const t=$('#hnote').value.trim();if(!t)return;
    await api(`/api/work/${STATUS.id}`,{method:'PUT',body:JSON.stringify({note:((STATUS.note||'')+(STATUS.note?' · ':'')+t).slice(0,500)})});
    await api('/api/dump',{method:'POST',body:JSON.stringify({content:t,meta:{cmd:'work'}})});
    $('#hnote').value='';toast('noted');loadHours();};
  WSESS=await api('/api/work/sessions?days=120').catch(()=>[]);
  const t0=Math.floor(new Date().setHours(0,0,0,0)/1000);
  const todays=WSESS.filter(x=>x.started_at>=t0);
  const dh=todays.reduce((a,x)=>a+hrs(x.started_at,x.ended_at),0);
  const de=todays.reduce((a,x)=>a+(x.hourly_rate?hrs(x.started_at,x.ended_at)*x.hourly_rate:0),0);
  $('#st-today').textContent=dh.toFixed(1)+'h';$('#st-earn').textContent='$'+de.toFixed(0);
  if(!STATUS.id)$('#clk').textContent=fmtHMS(dh*3600);
  // week bars (Mon..Sun of current week)
  const now=new Date();const mon=new Date(now);mon.setDate(now.getDate()-((now.getDay()+6)%7));mon.setHours(0,0,0,0);
  let weekTot=0;const bars=[];
  for(let i=0;i<7;i++){const d0=new Date(mon);d0.setDate(mon.getDate()+i);const a=d0.getTime()/1000,b=a+86400;
    const h=WSESS.filter(x=>x.started_at>=a&&x.started_at<b).reduce((s2,x)=>s2+hrs(x.started_at,x.ended_at),0);
    weekTot+=h;bars.push({d:d0,h});}
  $('#st-week').textContent=weekTot.toFixed(1)+'h';
  const mx=Math.max(1,...bars.map(b=>b.h));
  $('#wbars').innerHTML=bars.map(b=>{const today=b.d.toDateString()===now.toDateString();
    return `<div class="wb ${today?'today':''}"><span class="wv">${b.h?b.h.toFixed(1):''}</span><div class="bar" style="height:${Math.max(3,b.h/mx*100)}%"></div><span class="wl">${['MO','TU','WE','TH','FR','SA','SU'][(b.d.getDay()+6)%7]}</span></div>`;}).join('');
  // notes today (stream items cmd=work)
  const notes=(FEED.length?FEED:await api('/api/dump').catch(()=>[])).filter(m=>{try{return JSON.parse(m.meta||'{}').cmd==='work'&&m.created_at>=t0;}catch{return false;}});
  $('#hnotes').innerHTML=notes.map(n=>`<div class="noteitem"><span class="nt">${tm(n.created_at)}</span><span>${esc(n.content)}</span></div>`).join('')||`<div class="empty">no notes today — jot as you go</div>`;
  $('#worklist').innerHTML=WSESS.slice(0,20).map(x=>{const h=hrs(x.started_at,x.ended_at);const pay=x.hourly_rate?` · $${(h*x.hourly_rate).toFixed(2)}`:'';
    return `<div class="sessrow" data-sid="${x.id}"><div class="g"><div class="t">${esc(x.activity||'work')}${x.note?' — '+esc(x.note):''}</div><div class="s">${dt(x.started_at)}${x.ended_at?'':' · running'}</div></div><div class="amt">${x.ended_at?h.toFixed(1)+'h'+pay:'⏱'}</div></div>`;}).join('')||`<div class="empty">no sessions yet</div>`;
  $$('#worklist .sessrow').forEach(el=>el.onclick=()=>editSession(el,WSESS.find(x=>x.id==el.dataset.sid)));
}
function fmtHMS(sec){sec=Math.floor(sec);return Math.floor(sec/3600)+':'+String(Math.floor(sec/60%60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
function startTick(t0){stopTick();const r=()=>{$('#clk').textContent=fmtHMS(Date.now()/1000-t0);};r();tTick=setInterval(r,1000);}
function stopTick(){clearInterval(tTick);tTick=null;}
function editSession(el,x){
  if(!x||el.querySelector('.editrow'))return;
  el.innerHTML=`<div class="editrow" style="display:flex;flex-direction:column;gap:8px;width:100%">
    <input class="fld e-act" value="${esc(x.activity||'')}" placeholder="activity">
    <input class="fld e-note" value="${esc(x.note||'')}" placeholder="note">
    <div class="row"><input class="fld e-rate" type="number" step="0.5" value="${x.hourly_rate==null?'':x.hourly_rate}" placeholder="$/hr" style="max-width:110px">
    <button class="sbtn e-save">Save</button><button class="sbtn warn e-del">Delete</button></div></div>`;
  el.onclick=null;
  el.querySelector('.e-save').onclick=async()=>{await api(`/api/work/${x.id}`,{method:'PUT',body:JSON.stringify({activity:el.querySelector('.e-act').value||null,note:el.querySelector('.e-note').value||null,hourly_rate:+el.querySelector('.e-rate').value||null})});toast('saved');loadHours();};
  el.querySelector('.e-del').onclick=async()=>{await api(`/api/work/${x.id}`,{method:'DELETE'});toast('deleted');loadHours();};
}
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
$('#photo-add').onchange=async e=>{
  let n=0;
  for(const f of e.target.files){ if(await upload(f,{cmd:'photo'})) n++; }
  e.target.value='';
  if(n) toast(`${n} uploaded — scanning, they'll appear once cleared`);
  loadPhotos();};
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
  // storage health
  try{
    const hs=await api('/api/health/storage');
    $('#healthlist').innerHTML=hs.checks.map(c=>{
      const good=c.exists&&c.writable&&c.owner_ok;
      const why=!c.exists?'missing':!c.owner_ok?'wrong owner':!c.writable?'not writable':'ok';
      return `<div class="srow"><div class="g"><div class="t" style="font:500 12.5px 'JetBrains Mono',monospace">${esc(c.path)}</div>
        <div class="s">${why}</div></div>
        <span class="metachip" style="background:var(--surface);color:${good?'var(--a-workout)':'#c65b52'}">${good?'OK':'BROKEN'}</span></div>`;
    }).join('')+(hs.ok?'':`<div class="s" style="color:#c65b52;margin-top:10px">Uploads will fail. Fix on the server:<br><code style="user-select:all">${esc(hs.fix)}</code></div>`);
  }catch{ $('#healthlist').innerHTML=`<div class="s" style="color:var(--ink-3)">health check unavailable</div>`; }
  // snapshots
  const paired=SVC.filter(x=>x.enabled).map(x=>SVCAPP[x.service]).filter(Boolean);
  const apps=[...new Set(['workout-gen','meal-prep','contract-manager',...paired])];
  const rows=[];
  for(const a of apps){
    const sn=await api(`/api/kv/${a}/snapshots`).catch(()=>[]);
    rows.push(`<div class="snaprow" data-app="${a}"><div class="g"><div class="t">${a}</div>
      <div class="s">${sn.length?sn.length+' snapshots · latest '+dt(sn[0].created_at):'no snapshots'}</div></div>
      <button class="ebtn app-exp">Export</button>
      <label class="ebtn" style="cursor:pointer">Import<input type="file" class="app-imp" accept="application/json,.json" hidden></label>
      <button class="sbtn snap-now">Snapshot</button>
      ${sn.length?`<button class="sbtn warn snap-restore" data-sid="${sn[0].id}">Restore</button>`:''}</div>`);
  }
  $('#snaplist').innerHTML=rows.join('');
  $$('.app-exp').forEach(b=>b.onclick=()=>appExport(b.closest('.snaprow').dataset.app));
  $$('.app-imp').forEach(i=>i.onchange=e=>{const f=e.target.files[0];e.target.value='';
    if(f)appImport(i.closest('.snaprow').dataset.app,f);});
  $$('.snap-now').forEach(b=>b.onclick=async()=>{const a=b.closest('.snaprow').dataset.app;const r=await api(`/api/kv/${a}/snapshot`,{method:'POST'});toast(`${a}: ${r.keys} keys`);loadSettings();});
  $$('.snap-restore').forEach(b=>b.onclick=async()=>{const a=b.closest('.snaprow').dataset.app;const r=await api(`/api/kv/${a}/restore/${b.dataset.sid}`,{method:'POST'});toast(`${a}: restored ${r.keys}`);});
  // admin
  if(ME.is_admin){$('#admin-group').classList.remove('hidden');const users=await api('/api/users').catch(()=>[]);
    $('#userlist').innerHTML=users.map(u=>`<div class="urow"><div class="g">${esc(u.username)} <span class="s">joined ${day(u.created_at)}</span></div>${u.is_admin?'<span class="utag">admin</span>':''}${u.must_change_pw?'<span class="utag">reset pending</span>':''}</div>`).join('');}
}
async function svcToggle(row,on){const svc=row.dataset.svc;const settings={};const rate=row.querySelector('.rate');if(rate&&rate.value)settings.hourly_rate=+rate.value;await api(`/api/services/${svc}`,{method:'PUT',body:JSON.stringify({enabled:on,settings})});row.querySelector('.sw').classList.toggle('on',on);SVC=await api('/api/services');buildNav();toast(on?`${svc} paired`:`${svc} unpaired`);}
$('#cp-save').onclick=async()=>{try{await api('/api/password',{method:'POST',body:JSON.stringify({current_password:$('#cp-cur').value,new_password:$('#cp-new').value})});$('#cp-cur').value=$('#cp-new').value='';toast('password changed');}catch(e){toast(e.message);}};
$('#au-add').onclick=async()=>{try{const r=await api('/api/users',{method:'POST',body:JSON.stringify({username:$('#au-name').value.trim(),password:$('#au-pass').value})});toast(r.warning||'user created');$('#au-name').value=$('#au-pass').value='';loadSettings();}catch(e){toast(e.message);}};


/* ── export / import ── */
let impMode='merge';
function download(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}
async function readJSON(file){
  try{ return JSON.parse(await file.text()); }
  catch(e){ toast("that file isn't valid JSON"); return null; }
}
$('#exp-btn').onclick=async()=>{
  toast('packing your account…');
  const d=await api('/api/export');
  const stamp=new Date().toISOString().slice(0,10);
  download(`nook-${ME.username}-${stamp}.json`,d);
  const n=Object.entries(d.counts).filter(([,v])=>v).map(([k,v])=>`${v} ${k}`).join(' · ');
  $('#exp-hint').textContent=n||'nothing to export yet';
  toast('exported');
};
$$('#imp-mode .chip').forEach(b=>b.onclick=()=>{impMode=b.dataset.m;
  $$('#imp-mode .chip').forEach(x=>x.classList.toggle('on',x===b));});
$('#imp-file').onchange=async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const d=await readJSON(f); if(!d) return;
  if(d.format!=='nook-export/1'){
    $('#imp-out').innerHTML=`<span style="color:#c65b52">Not a Nook account export. If this is a single app's backup (workout, meals, contracts), import it from the Backups list below instead.</span>`;
    return;
  }
  const n=Object.entries(d.counts||{}).filter(([,v])=>v).map(([k,v])=>`${v} ${k}`).join(' · ');
  if(impMode==='replace' && !confirm(`REPLACE everything with this backup?\n\n${n}\n\nYour current app data is snapshotted first, so this is undoable from Backups.`))return;
  $('#imp-out').textContent='importing…';
  try{
    const r=await api(`/api/import?mode=${impMode}`,{method:'POST',body:JSON.stringify(d)});
    const got=Object.entries(r.imported).filter(([,v])=>v).map(([k,v])=>`${v} ${k}`).join(' · ')||'nothing new';
    const skip=Object.entries(r.skipped_duplicates||{}).map(([k,v])=>`${v} ${k}`).join(' · ');
    let msg=`<b>Imported:</b> ${esc(got)}`;
    if(skip)msg+=`<br>Already had: ${esc(skip)}`;
    if(r.groups_recreated?.length)msg+=`<br>Recreated org: ${esc(r.groups_recreated.join(', '))}`;
    const kept=Object.entries(r.app_keys_kept||{});
    if(kept.length){
      msg+=`<br><b>Kept your version</b> of: ${kept.map(([a,ks])=>`${esc(a)} (${ks.map(esc).join(', ')})`).join('; ')}`;
      msg+=`<br><span style="color:var(--ink-3)">${esc(r.app_conflict_note||'')}</span>`;
    }
    if(r.note)msg+=`<br><span style="color:#c65b52">${esc(r.note)}</span>`;
    $('#imp-out').innerHTML=msg;
    toast('imported');
    SVC=await api('/api/services'); MYGROUPS=await api('/api/groups').catch(()=>[]);
    buildNav(); loadSettings();
  }catch(err){ $('#imp-out').innerHTML=`<span style="color:#c65b52">${esc(err.message)}</span>`; }
};
/* per-app: raw localStorage-shape JSON — the shape the old PWA/GitHub apps store */
async function appExport(a){
  const kv=await api(`/api/kv/${a}`);
  if(!Object.keys(kv).length){ toast(`${a} has no data on the server yet`); return; }
  download(`${a}-${new Date().toISOString().slice(0,10)}.json`,kv);
  toast(`${a} exported (${Object.keys(kv).length} keys)`);
}
async function appImport(a,file){
  const d=await readJSON(file); if(!d) return;
  if(d.format==='nook-export/1'){ toast("that's a full account backup — use Import above"); return; }
  const kv=Object.fromEntries(Object.entries(d).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]));
  if(!Object.keys(kv).length){ toast('that file has no keys'); return; }
  // never import blind: ask the server what this would actually do
  const p=await api(`/api/kv/${a}/preview`,{method:'POST',body:JSON.stringify(kv)});
  clashDialog(a,kv,p);
}
function closeModal(){ $('#modal').classList.add('hidden'); $('#modal').innerHTML=''; }
function clashDialog(a,kv,p){
  const s=p.summary, hasClash=s.conflicts>0, canUnion=s.conflicts_mergeable>0;
  const badge=(txt,col)=>`<span class="kbadge" style="background:var(--surface);color:${col}">${txt}</span>`;
  const rows=p.keys.map(k=>{
    if(k.status==='new')return `<div class="krow"><span class="kn">${esc(k.key)}</span><span class="kd">not on the server — will be added</span>${badge('new','var(--a-workout)')}</div>`;
    if(k.status==='identical')return `<div class="krow"><span class="kn">${esc(k.key)}</span><span class="kd">already identical</span>${badge('same','var(--ink-3)')}</div>`;
    if(k.status==='only_mine')return `<div class="krow"><span class="kn">${esc(k.key)}</span><span class="kd">only on the server — <b>deleted by Replace</b>, kept by everything else</span>${badge('yours','var(--a-work)')}</div>`;
    const d=k.mergeable
      ? `${k.strategy} · yours ${k.mine_items} + file ${k.theirs_items} → <b>${k.union_items} combined</b>${k.overlapping_items?` (${k.overlapping_items} in both — file's copy wins)`:''}`
      : `can't be combined automatically (${esc(k.reason||'unknown shape')})`;
    return `<div class="krow"><span class="kn">${esc(k.key)}</span><span class="kd">${d}</span>${badge(k.mergeable?'combinable':'clash',k.mergeable?'var(--a-todo)':'#c65b52')}</div>`;
  }).join('');
  const go=async(mode)=>{
    closeModal();
    await api(`/api/kv/${a}/snapshot`,{method:'POST'}).catch(()=>{});
    const r=await api(`/api/kv/${a}?mode=${mode}`,{method:'PUT',body:JSON.stringify(kv)});
    let msg=`${a}: ${r.n} written`;
    if(r.unioned)msg+=`, ${r.unioned} combined`;
    if(r.kept_yours)msg+=`, ${r.kept_yours} kept as yours`;
    toast(msg);
    if(r.could_not_combine?.length)
      $('#imp-out').innerHTML=`<span style="color:#c65b52">Couldn't combine ${r.could_not_combine.map(c=>esc(c.key)).join(', ')} — your version was kept. Export both and reconcile by hand if you need the file's copy.</span>`;
    loadSettings();
  };
  $('#modal').innerHTML=`<div class="modalcard">
    <h3>Importing into ${esc(a)}</h3>
    <div class="sub">${s.new} new · ${s.conflicts} clash${s.conflicts===1?'':'es'} · ${s.only_on_server} only on server · ${s.identical} identical</div>
    ${hasClash?`<div class="s" style="color:var(--ink-2);margin-bottom:6px">This app already has data. Nothing is written until you choose — and your current state is snapshotted first either way.</div>`:''}
    ${rows}
    <div class="modalacts">
      ${canUnion?`<button class="mbtn rec" data-m="union"><b>Combine both</b><small>Keep everything from both sides. On a genuine overlap the file's copy wins.</small></button>`:''}
      <button class="mbtn ${canUnion?'':'rec'}" data-m="keep"><b>Keep mine</b><small>Add only what's missing. Nothing of yours is touched.</small></button>
      <button class="mbtn" data-m="merge"><b>File wins</b><small>The file overwrites shared keys. Your other keys survive.</small></button>
      <button class="mbtn danger" data-m="replace"><b>Replace all</b><small>The file becomes the only truth. Your other keys are deleted.</small></button>
    </div>
    <div class="modalacts" style="border:none;padding-top:4px;margin-top:2px"><button class="mbtn plain" data-m="">Cancel</button></div>
  </div>`;
  $('#modal').classList.remove('hidden');
  $$('#modal .mbtn').forEach(b=>b.onclick=()=>{ b.dataset.m ? go(b.dataset.m) : closeModal(); });
}

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
