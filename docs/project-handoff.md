# PERSONAL CLOUD — PROJECT HANDOFF
## Full state of the project as of this conversation's end

---

## 1. WHAT THIS PROJECT IS

A self-hosted personal server on a Lenovo ThinkCentre M920q that serves as:
- Personal file dump with Telegram-style chronological interface
- Shared media server (movies, TV, music, photos) with a dedicated browsing UI
- Quarantined upload pipeline with multi-layer malware scanning
- Future hub for offline knowledge (Kiwix), maps, and mesh communication
- Future host for personal fitness apps (workout gen, meal prep, food tracker)

---

## 2. HARDWARE — PURCHASED AND IN HAND

| Item | Status | Cost |
|------|--------|------|
| Lenovo ThinkCentre M920q (i5-8500T 6C/6T, 8GB, 256GB NVMe) | **Arrived** | $139.99 |
| PCIe riser (01AJ940) | **Ordered, arriving soon** | $21.99 |
| LSI 9207-8i HBA (IT mode, P20 firmware) + 2x SFF-8087 cables | **Ordered, shipped from HK** | ~$35 |
| Micron 1300 256GB 2.5" SATA SSD | **Purchased** | $24.99 |
| UGREEN NVMe enclosure (for PM991 as USB cache) | **Purchased** | $17.99 |
| Samsung PM991 128GB NVMe 2242 | **In hand** (original M710q purchase, repurposed to USB enclosure) | $19.99 |
| USB keyboard + mouse | **Arriving/arrived** | -- |

**Total spent: ~$260**

The M710q was a bad initial recommendation (no PCIe). It has been fully replaced by the M920q. All M710q references have been purged from all documents. Do not suggest or reference the M710q.

### Hardware architecture
- M920q NVMe (256GB) = boot drive
- PCIe riser in 2.5" bay slot = houses LSI 9207-8i HBA
- HBA provides 8 SATA ports via 2x SFF-8087 breakout cables
- External drives in 3D-printed 10-inch rack, powered by ATX PSU
- PM991 in UGREEN USB NVMe enclosure = fast cache/scratch
- Micron 1300 = first data drive on HBA

### Future hardware
- M920x: upgrade path with native PCIe x16 slot (when budget allows)
- Additional SATA drives as $/TB deals appear (target: 4TB+ HDDs under $15/TB)

---

## 3. GITHUB REPO

**Repo:** `DataGuy99/personal-cloud`
**Token (current, working):** `[REDACTED -- retrieve from Claude chat or GitHub settings]`

### Contents:
```
personal-cloud/
  setup/bootstrap.sh          — Full 20-phase Debian 12 installer (executable)
  docs/whitepaper-v1.2.md     — Current whitepaper (M920q, no M710q)
  docs/whitepaper-v1.1.md     — Old version (can delete)
  docs/pre-hardware-actionable.md — Pre-hardware dev spec
  pwa/                        — PWA shell (OLD card-style, needs replacement with Telegram-style)
    src/main.js, db.js, api.js, style.css
    package.json, vite.config.js, index.html
  hooks/
    on-upload.py              — Original upload hook (superseded by xau-hook.py in bootstrap)
    categorize.py             — Extension-based file categorization
    virustotal.py             — VT hash lookup with persistent JSON cache
    stego.yar                 — YARA rules for steganography detection
    share-expiry.py           — Hourly cron for share cleanup
  share-manager/
    share-manager.py          — Flask API (CRUD shares, members, audit log)
    schema.sql                — SQLite schema (shares, share_members, audit_log)
    requirements.txt
  config/
    copyparty.conf            — User/volume configuration template
    copyparty.service         — systemd unit template
```

### What bootstrap.sh does (20 phases):
1. Hostname + timezone
2. Static IP configuration
3. Disable WiFi (kernel blacklist)
4. System update + all packages (copyparty, WireGuard, ClamAV, YARA, Node.js, MergerFS, nftables, fail2ban, Jellyfin, etc.)
5. SSH hardening (root login off, ed25519 key gen, max 3 tries)
6. Fail2ban (5 fails = 1hr ban)
7. Unattended security updates
8. Service user + full directory tree
9. Drive detection + formatting (interactive, by UUID)
10. MergerFS fstab
11. Clone repo + download latest copyparty release
12. Interactive password setup (hashes automatically)
13. Build PWA + deploy to copyparty --html
14. Quarantine pipeline: /incoming noexec mount, ClamAV+YARA combined scanner, VirusTotal integration, AppArmor profile, EICAR self-test, upload hook wired to copyparty via xau config
15. WireGuard server + 3 client configs + QR code for phone
16. nftables firewall (SSH, HTTP, WireGuard, Jellyfin only)
17. Systemd services (copyparty, share-manager, WireGuard)
18. Cron jobs (nightly ClamAV scan, freshclam, btrfs scrub, archive cleanup, share expiry, weekly SMART)
19-20. Health checks + status dashboard

---

## 4. TWO USER INTERFACES (both unfinished)

### A. Telegram-style Personal Timeline
**Purpose:** Samuel's daily driver. Private. Input-first chronological dump.

**Design spec (finalized in this conversation):**
- Chat bubbles, not cards
- Media (images, videos, link previews) hugs RIGHT side
- Everything else (text notes, files, audio, plain links) hugs LEFT side
- Newest content at BOTTOM, scroll up for older (chat-style)
- Dynamic bubble sizing based on content type and length
- Date separators between groups
- Tapping date separator opens CALENDAR view with thumbnail dots on active days, tap to jump
- Tapping header title reveals CATEGORY FILTER TABS: Chats, Media (grid), Files (list), Links (list with previews), Music (list with play)
- Bottom input bar: emoji, text field, attachment clip, mic button
- Upload modal: drag-drop zone with dashed border, file queue with success/error/retry states
- Auto-categorization by mime type
- Later: surfaces copyparty volumes (vault, shared spaces) so everything is accessible from one place
- Later: share functionality to push items to the shared side

**v3 HTML preview exists** as `/mnt/user-data/outputs/personal-cloud-v3.html` — this is the design reference. NOT production code, NOT in the repo. Needs to be rebuilt as a proper Vite app against real copyparty API.

### B. Shared Media Interface
**Purpose:** What other people use. Consumption-first.

**Design spec (not yet detailed):**
- Grid layouts for photos
- Poster/card views for movies and TV
- Album views for music
- Optimized for browsing and streaming
- Multi-user auth
- Less input-focused, more browse/consume-focused

**Status:** Not started. Design not specced beyond high-level concept.

### Architecture
Both interfaces hit the same copyparty API, same storage pool, same auth. Two frontend skins over one backend. Either two Vite builds deployed to different paths under copyparty's --html directory, or one build with route splitting.

---

## 5. QUARANTINE PIPELINE (built, in bootstrap)

Upload flow:
1. File uploaded to copyparty
2. copyparty calls xau-hook.py (after-upload hook)
3. Hook categorizes file by extension
4. Moves to /incoming/<category> (mounted noexec,nosuid,nodev)
5. Creates immutable archive copy in /incoming/.archive/<category>
6. Runs scan-file.sh: ClamAV first, then YARA rules
7. If ClamAV or YARA flags: QUARANTINE immediately
8. If clean: VirusTotal hash lookup
9. VT positive: QUARANTINE
10. VT unknown (novel file like photos): PROMOTE with log note
11. VT clean: PROMOTE to /storage/pool/<category>
12. AppArmor confines copyparty process

---

## 6. GAPS — WHAT'S NOT DONE

**Critical:**
1. Telegram-style PWA not in repo (only HTML preview exists)
2. PWA not wired to real copyparty API (still uses mock data)
3. Shared media interface not started
4. SQLite for fitness apps not set up

**Important:**
5. Kiwix not in bootstrap
6. Notification system (quarantine alerts) is a logging stub only
7. Backup target (/mnt/backup) doesn't exist, no backup drive configured
8. Jellyfin not pointed at media directories
9. Data migration script (bulk import from phone/laptop)
10. Proton VPN (Samuel says he'll do this himself)
11. Night maintenance window (WiFi-off hours) not implemented

**Future projects (separate scope):**
12. Unified fitness platform (workout + meal prep + food tracker sharing SQLite backend)
13. Self-hosting fitness apps on server instead of GitHub Pages
14. Resilience/go-bag architecture (see section 8)

---

## 7. UNIFIED FITNESS PLATFORM (concept only)

Samuel has three existing apps on GitHub:
- `DataGuy99/workout-gen` — workout generator
- `DataGuy99/cut-tracker` — food/nutrition tracker (needs refining to general food tracker)
- Meal prep system (in development in another chat)

**Vision:** All three share one SQLite database on the server. Exercise logging informs meal planning, meal tracking informs the other two. Macros auto-populate across apps. Food data sourced from USDA FoodData Central or a downloaded database on the server.

**Architecture:** One SQLite database, three frontends, shared tables for meals/macros/exercises. Server provides persistent backend that localStorage never could.

**Status:** Concept only. Different chat, later.

---

## 8. RESILIENCE / GO-BAG ARCHITECTURE (concept only)

Inspired by Urban Circles' ATU v1 (disaster preparedness portable tech kit).

### Hub (M920q at base):
- Full Kiwix library: English Wikipedia (~90GB), WikiMed (~1.8GB), Wikibooks, agriculture, survival guides
- Full offline maps: OpenStreetMap for North America (~15GB)
- All personal data
- Meshtastic LoRa gateway (USB node, ~$20) for remote text queries
- Stays powered, stays put

### Spokes (go bag nodes):
- Small SBC (Pi Zero 2W, ~$15)
- Subset Kiwix: medical + agriculture + survival (~5-10GB microSD)
- Regional maps pre-loaded
- Critical personal files synced from hub
- Meshtastic node for comms back to hub
- Battery powered
- Syncs to hub over WiFi when in range, independent when not

### Sync model:
- Spoke connects to hub WiFi, rsync/Syncthing pulls latest
- Priority order: medical/survival first, maps, personal files, general knowledge
- Spoke always a few hours/days behind hub at worst

### LoRa gateway service (not built):
- USB Meshtastic node plugged into M920q
- Python service listens for text commands over serial
- "wiki solar panel" → queries Kiwix → compresses → sends back text chunks
- "status" → server uptime, battery, drive health
- "med burns" → first aid protocol from medical Kiwix
- NOT for maps or media (LoRa bandwidth: ~1-5 KB/min)

### Current gap:
- Server has zero resilience (no UPS, no offline capability, no mesh comms)
- Tier 1 (UPS + NUT auto-shutdown) is minimum, not optional
- Kiwix + hostapd (server as WiFi AP) = useful even without internet

---

## 9. KEY PREFERENCES AND DECISIONS

- **Never reference M710q.** It was a bad suggestion. Samuel is firm on this.
- **Never tell Samuel to go to sleep or suggest he needs sleep.** He finds it patronizing.
- **No fluff, no platitudes, no consolation, no babying.** He's an adult. Be direct.
- **Accuracy over everything.** Never compromise accuracy.
- **Don't "yes man."** Push back when something is wrong. The M710q situation happened because of insufficient pushback.
- **Brevity.** Short, dense responses. Lead with the answer.
- **Pragmatism.** Encourage betterment, not spending or coping.
- **Database:** SQLite for everything. No cloud databases (Turso, Supabase, etc.) — defeats sovereignty purpose.
- **The two interfaces are SEPARATE.** Telegram-style is personal daily driver. Media interface is shared consumption UI. They are not the same thing.
- **4.4 stars minimum** on product reviews (exceptions made but noted as exceptions).
- **Samuel's GitHub username:** DataGuy99
- **Location context:** Knoxville, TN area (37919)
