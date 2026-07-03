#!/usr/bin/env bash
# Build & deploy ported GitHub apps under /opt/personal-cloud/apps/<name>/
# served by personal-cloud-api at /apps/<name>/ with per-user KV persistence.
# Usage: bash setup/build-apps.sh [app ...]   (default: all)
set -euo pipefail
SRC=/opt/app-src; OUT="$(cd "$(dirname "$0")/.." && pwd)/apps"
BRIDGE="$(cd "$(dirname "$0")/.." && pwd)/apps-bridge/bridge.js"
APPS=("${@:-workout-gen meal-prep contract-manager}")
[[ "${1:-}" == "" ]] && APPS=(workout-gen meal-prep contract-manager)
mkdir -p "$SRC" "$OUT"

clone_or_pull() {
  if [[ -d "$SRC/$1/.git" ]]; then git -C "$SRC/$1" pull -q
  else git clone -q --depth 1 "https://github.com/DataGuy99/$1.git" "$SRC/$1"; fi
}

inject_bridge() {  # $1 = dist dir, $2 = app name
  cp "$BRIDGE" "$1/clouddome-bridge.js"
  python3 - "$1/index.html" "$2" << 'PYEOF'
import re, sys
path, app = sys.argv[1], sys.argv[2]
s = open(path).read()
m = re.search(r'<script type="module"[^>]*src="([^"]+)"[^>]*></script>', s)
if m:
    entry = m.group(1)
    s = s.replace(m.group(0),
        f'<script src="clouddome-bridge.js" data-app="{app}" data-entry="{entry}"></script>')
else:  # no module entry (plain static app) — bridge without deferred entry
    s = s.replace("</head>",
        f'<script src="clouddome-bridge.js" data-app="{app}"></script></head>', 1)
open(path, "w").write(s)
print(f"bridge injected ({'deferred entry' if m else 'head'})")
PYEOF
}

for APP in ${APPS[@]}; do
  echo "── $APP"
  clone_or_pull "$APP"
  if [[ -f "$SRC/$APP/package.json" ]]; then
    ( cd "$SRC/$APP"
      npm install --silent --no-audit --no-fund
      npx vite build --base="/apps/$APP/" --logLevel error )
    rm -rf "$OUT/$APP"; cp -r "$SRC/$APP/dist" "$OUT/$APP"
  else
    rm -rf "$OUT/$APP"; cp -r "$SRC/$APP" "$OUT/$APP"; rm -rf "$OUT/$APP/.git"
  fi
  inject_bridge "$OUT/$APP" "$APP"
done

# contract-manager: repoint its storage layer at the KV API (designed for this)
if [[ -d "$OUT/contract-manager" ]]; then
  SJS=$(find "$OUT/contract-manager" -name storage.js | head -1)
  if [[ -n "$SJS" ]]; then
    cat > "$SJS" << 'SJEOF'
// CloudDome storage: same load/save API, backed by per-user server KV.
// (Original IndexedDB local-first version preserved in the GitHub repo.)
const APP = 'contract-manager'
let _cache = null
async function hydrate() {
  if (_cache) return _cache
  const r = await fetch(`/api/kv/${APP}`)
  if (!r.ok) { location.href = '/'; throw new Error('not signed in') }
  _cache = await r.json()
  return _cache
}
export async function load(key, fallback) {
  const kv = await hydrate()
  return key in kv ? JSON.parse(kv[key]) : fallback
}
export async function save(key, value) {
  const v = JSON.stringify(value)
  if (_cache) _cache[key] = v
  await fetch(`/api/kv/${APP}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: v }) })
}
export async function allData() { const kv = await hydrate()
  return Object.fromEntries(Object.entries(kv).map(([k,v]) => [k, JSON.parse(v)])) }
export async function snapshot() { /* server-side history TBD; no-op */ }
export async function restoreSnapshot() { throw new Error('snapshots move server-side; use export/import for now') }
export async function listSnapshots() { return [] }
export async function exportJSON() { return JSON.stringify(await hydrate(), null, 2) }
export async function importJSON(text) {
  const kv = JSON.parse(text)
  await fetch(`/api/kv/${APP}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kv) })
  _cache = kv
}
SJEOF
    echo "contract-manager storage repointed to KV API"
  fi
fi
echo "done → $OUT"
