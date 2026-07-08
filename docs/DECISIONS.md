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
## 2026-07-01 — Groups as the single sharing primitive
Rather than per-app sharing features, one model: group-scoped rows +
personal-row provenance references. Family meal linking, contract-manager
work visibility, and shared dumps are all instances of it. Tested end-to-end
(roles, membership gates, manager views, device-key ingestion) before push.
External-app integration pattern: existing GitHub PWAs (meal-prep,
workout-gen) swap their localStorage layer for these APIs to join the
ecosystem; they can be served as static apps under the platform later.

## 2026-07-08 — Nook replaces the PWA UI

The Nook design (Claude Design artifact, `Nook.dc.html`) was NOT deployable:
its runtime (`support.js`) fetches React 18 + ReactDOM + Babel from unpkg.com
at page load, and its 716 `{{ }}` bindings / 105 `<sc-for>` / 72 `<sc-if>` all
target hardcoded mock state — zero `/api/` calls. Shipping it verbatim would
have produced a beautiful dead UI that also breaks the LAN-only requirement.

**Ported instead**: theme engine lifted exactly (3 paper tones × light/dark ×
flat/soft/glass surfaces, accent pair #6f7d55/#aebd88, `color-mix` highlight),
rendered as vanilla JS/CSS. No React, no Babel, no CDN runtime, no build step —
consistent with the existing deploy model (`git pull` and done).

Theme prefs persist per-user server-side via `/api/kv/nook` (localStorage is
only a first-paint cache).

Font: Courier Prime is loaded from Google Fonts with a system-mono fallback.
Run `setup/vendor-font.sh` once on the server to self-host it — required for
true offline/LAN-only rendering.

### Open fork (needs a decision before more UI work)
Nook ships its own full Workout, Meal Prep, and Contractor screens (~70% of the
prototype's markup). These duplicate the ported GitHub apps, which hold the real
data and mature logic (workout-gen: anchors, strength progression, 4 weeks of
training history). Three options:
  a. Sidebar links out to the ported apps (current behavior — chosen for now).
     Nook's designs for those three go unused; zero data risk.
  b. Reimplement all three inside Nook. Large; requires migrating workout-gen's
     schema; risks the training data the user has said cannot be lost.
  c. Port Nook's three screens as *views over the same KV data* the apps already
     write. No migration, preserves data, but requires reading each app's model.
Recommendation: (c), after (a) is confirmed stable and a snapshot exists.

### Not built (no backend source)
Shelf → Audiobooks and Podcasts have no server-side source; they show an honest
empty state. Books reads PDFs/EPUBs from the vault + `/storage/pool/docs`;
Music reads `/storage/pool/music`. Both via copyparty `?ls`.
