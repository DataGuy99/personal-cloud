/* CloudDome bridge v2 — full-snapshot sync.
   v1 mirrored only setItem calls and never deleted server keys; renames/
   property-assignments left stale keys that resurrected on hydrate and
   corrupted app state. v2: server state hydrates localStorage (clearing it
   first), then the ENTIRE localStorage is snapshotted to the server
   (replace mode) on change/interval/hide — deletions included. */
(async () => {
  const tag = document.currentScript;
  const APP = tag.dataset.app, ENTRY = tag.dataset.entry;
  const me = await fetch("/api/me").then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { location.href = "/"; return; }
  if (me.file_token) document.cookie = `cppwd=${me.file_token}; path=/; max-age=2592000`;

  const snapshot = () => { const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
      o[k] = localStorage.getItem(k); } return o; };
  const push = () => fetch(`/api/kv/${APP}?replace=1`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot()) })
    .catch(e => console.warn("bridge sync failed", e));

  try {
    const kv = await fetch(`/api/kv/${APP}`).then(r => r.json());
    if (Object.keys(kv).length) {           // server is authoritative when it has state
      localStorage.clear();
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    } else if (localStorage.length) {       // first run w/ existing local data: adopt it
      await push();
    }
  } catch (e) { console.warn("bridge hydrate failed", e); }

  let timer = null;
  const queue = () => { clearTimeout(timer); timer = setTimeout(push, 800); };
  const _set = Storage.prototype.setItem, _rm = Storage.prototype.removeItem,
        _clr = Storage.prototype.clear;
  Storage.prototype.setItem = function (k, v) { _set.call(this, k, v);
    if (this === localStorage) queue(); };
  Storage.prototype.removeItem = function (k) { _rm.call(this, k);
    if (this === localStorage) queue(); };
  Storage.prototype.clear = function () { _clr.call(this);
    if (this === localStorage) queue(); };
  setInterval(push, 10000);                  // catches property-assignment writes
  addEventListener("visibilitychange", () => document.hidden && push());
  addEventListener("beforeunload", push);

  window.CloudDome = {                       // in-app safety net
    snapshot: () => fetch(`/api/kv/${APP}/snapshot`, { method: "POST" }).then(r => r.json()),
    snapshots: () => fetch(`/api/kv/${APP}/snapshots`).then(r => r.json()),
    restore: (id) => fetch(`/api/kv/${APP}/restore/${id}`, { method: "POST" }).then(r => r.json()),
    wipe: () => fetch(`/api/kv/${APP}`, { method: "DELETE" }).then(r => r.json()),
  };
  if (ENTRY) { const s = document.createElement("script"); s.type = "module"; s.src = ENTRY;
    document.body.appendChild(s); }
})();
