#!/usr/bin/env bash
# Self-host Courier Prime so Nook renders correctly with no internet (LAN-only).
# Run once on the server (which has outbound internet). Idempotent.
set -euo pipefail
PWA="$(cd "$(dirname "$0")/.." && pwd)/pwa"
mkdir -p "$PWA/fonts"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
CSS=$(curl -sA "$UA" 'https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap')
i=0
while read -r url; do
  [[ -z "$url" ]] && continue
  curl -sA "$UA" "$url" -o "$PWA/fonts/cp-$i.woff2"; i=$((i+1))
done < <(grep -oE 'https://[^)]+\.woff2' <<< "$CSS")
sed -E "s#https://[^)]+\.woff2#PLACEHOLDER#g" >/dev/null <<< "$CSS" || true
# rewrite src urls to local files, in order
j=0
: > "$PWA/fonts/courier-prime.css"
while IFS= read -r line; do
  if [[ "$line" =~ https://[^\)]+\.woff2 ]]; then
    line=$(sed -E "s#https://[^)]+\.woff2#fonts/cp-$j.woff2#" <<< "$line"); j=$((j+1))
  fi
  printf '%s\n' "$line" >> "$PWA/fonts/courier-prime.css"
done <<< "$CSS"
# point index.html at the local sheet instead of Google
python3 - "$PWA/index.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'\s*<link rel="preconnect"[^>]*>\n?', '', s)
s = re.sub(r'<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">',
           '<link rel="stylesheet" href="fonts/courier-prime.css">', s)
open(p, 'w').write(s)
print("index.html now uses the self-hosted font")
PY
echo "vendored $i font files -> $PWA/fonts/"
