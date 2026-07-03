/* CloudDome bridge: hydrate localStorage from per-user server KV, mirror
   writes back (debounced). Injected at build; loads the real app entry
   (data-entry attr) only after hydration so first read sees server state. */
(async () => {
  const tag = document.currentScript;
  const APP = tag.dataset.app, ENTRY = tag.dataset.entry;
  const me = await fetch("/api/me").then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { location.href = "/"; return; }           // not signed in → PWA login
  if (me.file_token) document.cookie = `cppwd=${me.file_token}; path=/; max-age=2592000`;
  try {
    const kv = await fetch(`/api/kv/${APP}`).then(r => r.json());
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  } catch (e) { console.warn("bridge hydrate failed", e); }

  let dirty = {}, timer = null;
  const flush = () => {
    const batch = dirty; dirty = {}; timer = null;
    if (Object.keys(batch).length)
      fetch(`/api/kv/${APP}`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) })
        .catch(e => console.warn("bridge sync failed", e));
  };
  const queue = (k, v) => { dirty[k] = v; clearTimeout(timer); timer = setTimeout(flush, 800); };
  const _set = Storage.prototype.setItem, _rm = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { _set.call(this, k, v);
    if (this === localStorage) queue(k, String(v)); };
  Storage.prototype.removeItem = function (k) { _rm.call(this, k);
    if (this === localStorage) fetch(`/api/kv/${APP}/${encodeURIComponent(k)}`, { method: "DELETE" }).catch(() => {}); };
  addEventListener("beforeunload", flush);
  if (ENTRY) { const s = document.createElement("script"); s.type = "module"; s.src = ENTRY;
    document.body.appendChild(s); }
})();
