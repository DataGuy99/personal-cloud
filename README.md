# personal-cloud

Self-hosted personal cloud platform on a Lenovo M920q (Debian 13).
Files + media streaming + per-user life-tracking ecosystem, one login.

- `server/` — Flask API + PWA host + identity + quarantine review + ecosystem
- `server/workers/scanner.py` — quarantine scanner (ClamAV + YARA)
- `pwa/` — Telegram-style PWA, no build step
- `hooks/` — copyparty upload hooks + YARA rules
- `config/` — systemd units
- `setup/bootstrap.sh` — idempotent full-server setup
- `docs/ARCHITECTURE.md` — how it fits together · `docs/DECISIONS.md` — why
