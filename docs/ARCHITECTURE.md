# Platform Architecture

```
                    ┌─────────────────────────────────────────┐
 Browser / PWA ───► │  personal-cloud-api  :5001  (Flask)     │
 (Telegram-style,   │  • serves the PWA (no build step)       │
  no build step)    │  • identity: users table = source of    │
                    │    truth; sessions; admin user mgmt     │
                    │  • quarantine review (release/reject)   │
                    │  • ecosystem APIs (metrics, work,       │
                    │    insights; meals/sleep/journal next)  │
                    └───────────────┬─────────────────────────┘
                                    │ shares SQLite DB
        ┌───────────────────────────┼──────────────────────────┐
        ▼                           ▼                          ▼
┌───────────────┐        ┌──────────────────┐       ┌──────────────────┐
│ copyparty     │        │ scanner-worker   │       │ Jellyfin :8096   │
│ :3923         │        │ polls pending →  │       │ streams          │
│ file engine   │        │ ClamAV + YARA →  │       │ /storage/pool    │
│ conf GENERATED│        │ clear→move to    │       │ (media tab links │
│ from users tbl│        │ dest / flag→hold │       │  out to it)      │
└───────┬───────┘        └──────────────────┘       └──────────────────┘
        │ xau hook registers uploads as PENDING
        ▼
   /staging/<scope>/…  ← uploads land HERE by design (upload vols are
                          staging-backed; real dests are never upload
                          targets — see docs/DECISIONS.md)
```

## Identity model
- `users` table owns identity. Real password → pbkdf2 hash (API login).
- Each user gets a random `file_token` = their copyparty password.
- `server/sync_copyparty.py` regenerates copyparty.conf (accounts + all
  volumes) from the table. Never hand-edit accounts in the conf.
- PWA login: one form → API session cookie + sets `cppwd` cookie with the
  file_token so copyparty requests are authorized too.

## File flow
upload (PWA → /up/... PUT) → lands in /staging → xau-register hook inserts
PENDING row → scanner-worker scans (ClamAV primary, YARA narrow block-tier)
→ clean: moved to intended dest (visible in browse vols) · flagged: held,
appears in PWA Pending tab → owner releases (vault scope) or admin (public).

## Ecosystem model
Every module = per-user rows keyed on users.id. `/api/insights/*` joins
across modules (BMR + work activity + workouts → daily burn; meals → net).
Implemented: body metrics, work hours, insights/today.
Schema-ready, endpoints next: workouts, meals/nutrition, sleep, journal.
Pattern for adding a module: table in schema.sql → blueprint in server/api/
→ register in app.py → card in PWA Life tab.

## Ports
5001 PWA+API · 3923 copyparty · 8096 Jellyfin · 51820/udp WireGuard · 22 SSH
