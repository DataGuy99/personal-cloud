# Architecture Decisions & Notes

A running log of non-obvious choices, *why* they were made, and what to revisit
if things break later. Written so future-you (with more CS under your belt) can
second-guess past-you with full context.

---

## 2026-06-25 — Staging architecture: chose "staging as upload target" (Option 1)

**The problem we were solving:**
Every upload must be scanned (ClamAV + YARA) BEFORE it reaches its real
destination, so malware never lands in a vault or public pool unscanned.
A file should sit in an isolated staging area, get scanned, then either be
released to its destination (clean) or held + flagged (suspicious/malicious).

**Two ways to keep uploads out of their destination until scanned:**

- **Path B / reloc (TRIED FIRST, ABANDONED):** Use copyparty's `--xbu` before-upload
  hook with `c1` reloc to *redirect* each upload into `/staging/<uuid>` before it's
  written. Clean in theory. **It did not work in practice** — the hook fired and
  registered DB rows, but copyparty ignored the reloc and wrote files straight to
  their real destination anyway (39 test files landed in bob's vault unscanned).
  Could not debug further because copyparty can't be run/tested in the build
  sandbox (its download is network-blocked there), so fixing it would've meant
  guess-and-push cycles. Root cause never confirmed. Suspects: reloc may not honor
  up2k uploads the way docs imply, or the staging vp target needed to pre-exist.

- **Path A / after-upload move (CONSIDERED):** Let the file land in its destination,
  then an `xau` after-upload hook immediately moves it to staging. The `xau` hook
  *did* fire reliably in testing. Downside: a sub-second window where a public-pool
  file exists in the pool before the hook yanks it. Fine for vault uploads (owner's
  own private space, no real exposure), riskier for public uploads.

**What we chose: Option 1 — make staging the LITERAL upload target.**
Instead of relying on reloc, point each user's *upload* volume directly at a staging
filesystem path at the copyparty config level. The file physically lands in staging
by definition; the real destination is simply not an upload target, so nothing can
reach it unscanned. The scanner worker moves cleared files to the real destination.

**Known tradeoff / what to revisit if this feels wrong later:**
Upload and browse become slightly different URLs in copyparty's raw UI (you upload
to one volume, browse another). This is cosmetic. The custom PWA we're building is
meant to present a single unified view that hides this split entirely. IF the split
ever causes real problems (confusing flows, permission edge cases, sync issues
between staging and destination), reconsider:
  1. Revisiting Path B reloc — but only with a way to actually test copyparty locally.
  2. Path A after-upload move, accepting the tiny public-upload exposure window.

Decision made by Claude on the reasoning above; user deferred ("genuinely don't know")
and asked to leave this note so it can be re-evaluated with more knowledge later.

---
## 2026-07-01 — Platform restructure

- **Single identity:** users table in SQLite is the authority; copyparty.conf
  is generated (sync_copyparty.py). Users' copyparty password is a random
  file_token, not their real password — real password only exists as a hash.
- **share-manager absorbed** into personal-cloud-api (one Flask service:
  PWA serving + identity + quarantine review + ecosystem).
- **PWA rebuilt with no build step** (vanilla JS/CSS). The old Vite scaffold
  was removed: a build chain added fragility with zero payoff at this scale,
  and deploys are now just `git pull`. Revisit only if the PWA outgrows this.
- **pdf_javascript YARA rule removed** — carpet-flagged every JS-bearing PDF
  (i.e. most books/forms). ClamAV is the malware detector for all file types;
  YARA kept narrow (polyglot/appended-executable only).
- **Jellyfin stays the streaming engine**; PWA Media tab links out. A custom
  in-PWA player ("stream dock") is a later project, not rebuilt now.
