
# PROJECT: PERSONAL CLOUD — SELF-HOSTED FILE STREAM
## White Paper v1.1 | 2026-06-13

---

## 1. EXECUTIVE SUMMARY

Build a headless, self-hosted file server on a Lenovo ThinkCentre M710q micro-PC that:
- Serves as a personal "Saved Messages" replacement (Telegram alternative)
- Streams media and serves files to up to 5 WiFi-connected devices
- Runs copyparty (open-source file server) with a custom PWA skin
- Stores files on an expandable SATA drive pool
- Caches content locally on client devices (offline-first PWA)
- Auto-evicts cached files after 30 days of non-use
- Is accessible only via private LAN / WireGuard VPN (no cloud dependency)

---

## 2. HARDWARE SPECIFICATION

### 2.1 Compute Node

**Slot layout: The M710q has ONE M.2 slot and ONE 2.5" bay.** The PM991 NVMe occupies the M.2 slot for boot. The included 500GB HDD stays in the 2.5" bay as the first data drive. The M.2-to-SATA expansion card is not usable (no slot available). External drives connect via USB 3.0 to SATA adapters instead.

| Component | Spec | Source | Cost |
|-----------|------|--------|------|
| **Mini PC** | Lenovo ThinkCentre M710q | eBay (global-technologies) | $69.99 |
| **CPU** | Intel Core i5-7400T (4C/4T, 2.40 GHz base) | Included | -- |
| **RAM** | 8GB DDR4 (1x8GB, expandable to 32GB) | Included | -- |
| **Boot Storage** | Samsung PM991 128GB NVMe 2242 (in M.2 slot) | eBay (Synergy Industrial) | $19.99 |
| **Initial Data Storage** | 500GB 2.5" HDD (included, stays in internal bay) | Included | -- |
| **SATA Expansion** | USB 3.0 to SATA cables (UASP, JMS578 chipset) | Amazon | ~$10 each |
| **Drive Housing** | Custom 3D-printed stackable drive cage | Self-printed | ~$5 filament |
| **Cooling** | 120mm case fan + 12V buck converter | Amazon | ~$10 |
| **PSU for Drives** | Cheap ATX PSU (short green wire for always-on) | eBay/local | ~$15 |
| **TOTAL (with 2 expansion drives)** | | | **~$140** |

**USB 3.0 SATA expansion notes:**
- USB 3.0 = 5 Gbps. Spinning HDDs top out at ~150 MB/s (~1.2 Gbps). No bottleneck.
- Use UASP-capable adapters (JMS578 or ASM1153E chipset) for lower latency than BOT mode.
- The M710q has 6 USB ports (mix of 2.0 and 3.0). Use USB 3.0 ports for data drives.
- ATX PSU provides SATA power to drives independently -- USB cables carry data only.
- Alternative: a powered 4-bay USB 3.0 HDD dock (~$35-50) replaces individual cables + ATX PSU + drive cage, but is less modular and not printable.

### 2.2 Drive Pool Architecture
```
┌─────────────────────────────────────────────────────────┐
│                    ThinkCentre M710q                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ PM991 128GB  │  │ 500GB 2.5"   │  │ USB 3.0 ports │  │
│  │ NVMe (M.2)   │  │ HDD (internal│  │ (to external  │  │
│  │ OS Boot      │  │  2.5" bay)   │  │  SATA drives) │  │
│  └──────────────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         ▼                 ▼                   ▼          │
│    Debian Server    MergerFS Pool       External Drive   │
│    /boot, /root     /storage            Housing (1-4x)   │
│    copyparty        (internal HDD +     3.5" HDDs via    │
│    Jellyfin          external drives    USB-SATA + ATX   │
│    WireGuard         unified here)      PSU power        │
└─────────────────────────────────────────────────────────┘
```

### 2.2a Boot SSD Health Verification (Post-Install)

The Samsung PM991 is an OEM pull. Verify on first boot:

```bash
# Install SMART tools
sudo apt update && sudo apt install -y smartmontools nvme-cli

# Check NVMe health
sudo smartctl -a /dev/nvme0

# Key fields to verify:
# - Percentage Used: should be < 10% (0-100 scale, 100 = end of life)
# - Data Units Written: divide by 1,000,000 for approximate TBW
# - Media and Data Integrity Errors: should be 0
# - Critical Warning: should be 0

# Quick health summary
sudo nvme smart-log /dev/nvme0
```

**Acceptable thresholds:**
- `percentage_used` < 10%: Excellent
- `percentage_used` 10-20%: Acceptable for boot drive
- `percentage_used` > 20%: File eBay return, request replacement
- Any Media/Data Integrity Errors or Critical Warnings: Return immediately

**Why this matters:** The PM991 is rated for ~150 TBW. As a read-heavy boot drive with minimal writes, even 20% wear leaves years of life. The check takes 30 seconds.

### 2.3 Storage Pool Strategy: MergerFS
- **Filesystem:** MergerFS (FUSE-based union filesystem)
- **Policy:** `mfs` (most free space) for new files
- **Drives:** Mixed sizes accepted — 500GB, 2TB, 4TB, etc.
- **Expansion:** Add drive → format ext4 → add to MergerFS mount → done
- **No RAID:** Single-drive failure = lose only that drive's contents
- **Future parity:** Can add SnapRAID later without rebuilding pool

### 2.4 3D-Printed Drive Housing Spec
- **Form factor:** Stackable modules, 1 drive per module
- **Data interface:** USB 3.0 to SATA cable per drive (routed to M710q USB ports)
- **Power:** SATA power from ATX PSU (independent of USB data path)
- **Cooling:** 120mm intake fan, passive exhaust via vented top
- **Stacking:** M3 threaded inserts, modules bolt together vertically
- **Cable management:** Route USB cables and SATA power through back channel
- **ThinkCentre mount:** Top module has integrated bracket to secure the M710q

---

## 3. NETWORK ARCHITECTURE

### 3.1 LAN Topology
```
┌─────────────┐      Ethernet      ┌─────────────────────┐
│   Router    │◄──────────────────►│  ThinkCentre M710q  │
│  (WiFi AP)  │   (static IP)      │   192.168.1.10      │
└──────┬──────┘                    └─────────────────────┘
       │
       │ WiFi
       │
   ┌───┴───┐
   │       │
┌──┴──┐ ┌──┴──┐ ┌─────┐ ┌─────┐ ┌─────┐
│Phone│ │Phone│ │Laptop│ │Tablet│ │TV   │
│ #1  │ │ #2  │ │      │ │      │ │     │
└─────┘ └─────┘ └─────┘ └─────┘ └─────┘
```

### 3.2 Addressing & Discovery
- **Static IP:** 192.168.1.10 (or DHCP reservation by MAC)
- **Local DNS:** `copyparty.local` via router mDNS or Pi-hole
- **mDNS/SSDP:** Enabled in copyparty — auto-discovery on LAN file managers
- **Port 80/443:** HTTP/HTTPS for PWA and WebDAV
- **Port 22000:** SFTP (optional)
- **Port 51820:** WireGuard UDP (remote access)

### 3.3 Remote Access: WireGuard + Proton VPN Port Forwarding
- **Server:** Runs WireGuard on ThinkCentre, behind Proton VPN
- **Proton VPN Port Forwarding:** Exposes a forwarded port through Proton's tunnel
  - No open ports visible on your public ISP IP
  - Internet sees Proton's IP, not yours
  - Bots and scanners cannot reach your home network
- **Clients:** Phones, laptops — WireGuard connects to Proton's forwarded port
- **When WiFi is off (1-7 AM):** Phone on cellular → WireGuard → Proton VPN → your modem → router → ThinkCentre
- **No additional subscription:** Uses existing Proton plan ($70/3yr)
- **No VPS required:** Proton's infrastructure acts as the relay

---

## 4. SOFTWARE STACK

### 4.1 Operating System
| Layer | Choice | Rationale |
|-------|--------|-----------|
| **OS** | Debian 12 (Bookworm) Server | Stable, minimal, runs forever |
| **Boot** | Legacy BIOS or UEFI | M710q supports both |
| **Filesystem** | ext4 (boot), ext4 (data drives) | Proven, recoverable |
| **Swap** | 2GB swapfile | Prevent OOM during indexing |

### 4.2 Core Services
```
┌────────────────────────────────────────────┐
│           Debian 12 Server                 │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐  │
│  │copyparty│  │Jellyfin │  │ WireGuard │  │
│  │  :80    │  │ :8096   │  │  :51820   │  │
│  │(primary)│  │(media)  │  │ (remote)  │  │
│  └─────────┘  └─────────┘  └───────────┘  │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐  │
│  │MergerFS │  │qBittorrent│ │  Samba   │  │
│  │(union)  │  │  :8080   │  │  :445    │  │
│  └─────────┘  └─────────┘  └───────────┘  │
│  ┌─────────┐  ┌─────────┐                  │
│  │Sonarr   │  │Radarr   │  (optional)    │
│  │(TV)     │  │(movies) │                  │
│  └─────────┘  └─────────┘                  │
└────────────────────────────────────────────┘
```

### 4.3 copyparty Configuration
- **Mode:** HTTP server with WebDAV, SFTP, FTP enabled
- **Auth:** Username/password or client cert (no anonymous access)
- **Upload:** Chunked, resumable, deduplicated, no file size limit
- **Media indexing:** Thumbnails, audio tags, video metadata
- **Search:** Full-text + metadata search via copyparty's built-in engine
- **API:** RESTful JSON API for PWA integration

### 4.4 Jellyfin (Media Streaming)
- **Purpose:** Dedicated media streaming for TV/movies
- **Transcoding:** Intel Quick Sync (i5-7400T HD Graphics 630)
- **Client apps:** Native apps for Android TV, iOS, web
- **Integration:** Reads from same MergerFS pool as copyparty

---

## 5. CLIENT EXPERIENCE: THE PWA

### 5.1 Design Philosophy
- **Telegram Saved Messages parity:** Chronological stream, mixed media types
- **Offline-first:** All content cached locally, works without internet
- **Instant search:** IndexedDB metadata search, no server round-trip
- **Auto-eviction:** LRU + TTL cache, 30-day default
- **Installable:** Add to home screen, full-screen, no browser chrome

### 5.2 PWA Architecture
```
┌─────────────────────────────────────────────┐
│              Client Device                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
│  │   UI    │  │Service  │  │  IndexedDB  │  │
│  │ (React/ │  │ Worker  │  │  (metadata) │  │
│  │ vanilla)│  │(Workbox)│  │             │  │
│  └────┬────┘  └────┬────┘  └──────┬──────┘  │
│       │            │               │         │
│       └────────────┴───────────────┘         │
│                    │                        │
│              Cache API                      │
│         (file blobs, offline)                │
│                    │                        │
│       ┌────────────┴────────────┐           │
│       ▼                         ▼           │
│  ┌─────────┐              ┌─────────┐       │
│  │ Server  │              │  LAN   │       │
│  │ (sync)  │              │ (local)│       │
│  └─────────┘              └─────────┘       │
└─────────────────────────────────────────────┘
```

### 5.3 Caching Strategy
| Pattern | Implementation | Purpose |
|---------|---------------|---------|
| **App shell** | Precache on install | UI loads instantly offline |
| **Metadata** | IndexedDB, sync on open | Search works offline |
| **Media files** | Cache API, fetch-on-demand | Streamed content persists locally |
| **Thumbnails** | Cache API, aggressive | Grid views load instantly |
| **Eviction** | Background sync + LRU + 30-day TTL | Storage doesn't grow forever |

### 5.4 Sync Protocol (PWA ↔ Server)
```
1. Client opens PWA
2. Service Worker serves app shell from cache
3. Client queries IndexedDB for local file index
4. Background: POST /api/sync with client timestamp
5. Server responds: {new: [...], updated: [...], deleted: [...]}
6. Client fetches new/updated items, caches blobs
7. Client purges deleted items from IndexedDB + Cache API
8. User searches/browses — all local, instant
9. User opens file not cached → fetch from server, cache, display
```

### 5.5 Auto-Eviction Logic
```javascript
// Service Worker background sync
async function evictCache() {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const db = await openDB('copyparty-cache', 1);
  const files = await db.getAll('file-metadata');

  for (const file of files) {
    if (now - file.lastAccessed > THIRTY_DAYS) {
      await caches.open('media-cache').then(c => c.delete(file.url));
      await db.delete('file-metadata', file.id);
    }
  }

  // Storage pressure check
  const estimate = await navigator.storage.estimate();
  if (estimate.usage / estimate.quota > 0.85) {
    // Evict LRU until under 70%
    const sorted = files.sort((a,b) => a.lastAccessed - b.lastAccessed);
    // ... evict oldest
  }
}
```

### 5.6 New Device Onboarding
1. Install PWA from `https://copyparty.local`
2. Enter credentials (or scan QR code from server admin)
3. PWA fetches full index from server (one-time, requires internet)
4. Index stored in IndexedDB
5. User browses — empty placeholders for uncached files
6. Tapping a file fetches and caches it
7. From now on, works fully offline for cached content

---

## 6. DATA LIFECYCLE

### 6.1 Upload Flow
```
Phone selects file → PWA chunks file → Service Worker uploads via copyparty API
→ copyparty receives chunks → assembles → stores on MergerFS pool
→ copyparty indexes metadata → PWA receives confirmation → adds to local index
```

### 6.2 Download/Stream Flow
```
User taps file in PWA → Service Worker checks Cache API
├── HIT → serve instantly from local storage
└── MISS → fetch from copyparty server → stream to user + cache in background
```

### 6.3 Cross-Device Consistency
- **Source of truth:** copyparty server (MergerFS pool)
- **Client cache:** Best-effort replica, evicted as needed
- **Conflict resolution:** Server wins. Client re-syncs on open.
- **Background sync:** Periodic (every 15 min when app open) or manual pull-to-refresh

---

## 7. UI/UX REDESIGN: SKINNING COPYPARTY

### 7.1 Current State
copyparty ships with a functional but utilitarian web UI:
- Directory tree sidebar
- File manager grid/list view
- Upload panel with drag-and-drop
- Built-in media player (audio/video)
- Text editor, image viewer, manga reader

### 7.2 Target State: "Stream Mode"
Transform the UI into a Telegram Saved Messages-style feed:
- **Chronological stream:** Newest items at top, infinite scroll
- **Mixed media cards:** Images, videos, audio, documents, text notes — all inline
- **Quick actions:** Long-press to share, download, delete, tag
- **Search bar:** Instant local search (IndexedDB) + server fallback
- **Upload button:** Camera, file picker, text note, voice memo
- **Filter tabs:** All / Images / Videos / Documents / Audio / Links

### 7.3 Implementation Approach
**Option A: Override copyparty's frontend (recommended)**
- copyparty serves static files from its `--html` directory
- Replace `ui.html`, `ui.css`, `ui.js` with custom PWA code
- Retain copyparty's REST API endpoints for all data operations
- Pros: Single codebase, no proxy layer, direct API access
- Cons: Must track copyparty updates, merge changes

**Option B: PWA as separate layer**
- PWA hosted separately (static files on nginx or copyparty itself)
- Talks to copyparty API via CORS
- Pros: Independent updates, cleaner separation
- Cons: CORS config, potential auth complexity

### 7.4 API Surface (copyparty endpoints to skin)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | File listing (HTML or JSON with `?json`) |
| `/api/ls` | GET | Directory listing with metadata |
| `/api/up` | POST | Chunked file upload |
| `/api/thumb` | GET | Thumbnail generation |
| `/api/search` | GET | Full-text search |
| `/api/dl` | GET | File download/stream |
| `/api/del` | POST | Delete file |
| `/api/mv` | POST | Move/rename file |

### 7.5 PWA Tech Stack
| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Framework** | Vanilla JS or Preact | Lightweight, fast boot, no build bloat |
| **Bundler** | Vite | Fast dev, clean output |
| **Service Worker** | Workbox | Google's library, handles caching strategies declaratively |
| **State** | IndexedDB (Dexie.js) | Structured queries, offline persistence |
| **Styling** | CSS Grid/Flexbox, CSS variables | Native, fast, no framework lock-in |
| **Icons** | Lucide or Heroicons | Clean, consistent |
| **Media player** | copyparty's built-in or custom `<video>`/`<audio>` | Native HTML5, hardware-accelerated |

---

## 8. SECURITY ARCHITECTURE: THE DEFENSE-IN-DEPTH MODEL

### 8.1 Threat Model
- **Trusted LAN:** Family/roommates, physical access to network
- **Untrusted WAN:** Public WiFi, cellular — access only via WireGuard
- **Downloaded malware:** Torrented files, grabbed media, documents with embedded scripts — **HIGH RISK**
- **Uploaded malware:** Photos from phone, documents from laptop — **MEDIUM RISK** (trusted source, but phone could be compromised)
- **Media exploits:** Codec vulnerabilities, steganography, malformed containers
- **Lateral movement:** A compromised file must never touch other categories or the host OS
- **Government surveillance:** ISP-level packet inspection, router backdoors — mitigated via layered VPN + DNS encryption
- **Server compromise:** Single point of failure, but contained within sandbox boundaries
- **Device loss:** Cached data on phone is encrypted by Android/iOS full-disk encryption

### 8.2 The Risk-Based Bucket System

All storage is physically separated into **per-category buckets** with **risk-appropriate isolation**. A file in one bucket cannot see, modify, or escape into another.

```
┌─────────────────────────────────────────────────────────────┐
│                         HOST OS                             │
│  (Debian 12, minimal, hardened, no direct data access)    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  LXC CONTAINER: quarantine-gate (unprivileged)        │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  INCOMING BUFFER (per-category, isolated)         │  │  │
│  │  │  /incoming/movies     /incoming/tv                │  │  │
│  │  │  /incoming/music      /incoming/docs              │  │  │
│  │  │  /incoming/photos     /incoming/unknown           │  │  │
│  │  │  ─────────────────────────────────────────────    │  │  │
│  │  │  Each sub-bucket: noexec, nosuid, nodev            │  │  │
│  │  │  Btrfs reflink copy per file (cp --reflink=always) │  │  │
│  │  │  ClamAV scan + VirusTotal (free tier)             │  │  │
│  │  │  Files stay until: scan passes OR admin approves  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  LXC CONTAINER: copyparty-server (unprivileged)       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  CATEGORY BUCKETS (read-only for consumers)     │  │  │
│  │  │  /pool/movies     /pool/tv                        │  │  │
│  │  │  /pool/music      /pool/docs                      │  │  │
│  │  │  /pool/photos     /pool/memes                     │  │  │
│  │  │  ─────────────────────────────────────────────    │  │  │
│  │  │  Each bucket: noexec, nosuid, nodev, RO           │  │  │
│  │  │  Only quarantine-gate can write (via API)         │  │  │
│  │  │  copyparty serves read-only                       │  │  │
│  │  │  Jellyfin mounts read-only from here              │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  LXC CONTAINER: jellyfin-server (unprivileged)        │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Read-only bind: /pool/movies, /pool/tv         │  │  │
│  │  │  No write. No network beyond LAN.               │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  HOST BACKUPS (offline 23/7, separate physical)       │  │
│  │  /backup/movies, /backup/tv, etc.                     │  │
│  │  Mounted only during nightly rsync. Unmounted always. │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Bucket 1: Incoming Buffer (Per-Category Quarantine)
- **Path:** `/incoming/<category>`
- **Filesystem:** Btrfs subvolume per category, reflink copy per file
- **Mount flags:** `noexec,nosuid,nodev`
- **Purpose:** Every downloaded or untrusted-uploaded file lands here first
- **Risk levels:**
  - **Downloads (torrents, web grabs):** HIGH -- full ClamAV + VirusTotal + 7-day auto-quarantine
  - **Untrusted uploads (friend's phone, public WiFi):** MEDIUM -- ClamAV + manual approval option
  - **Trusted uploads (your phone photos, your laptop docs):** LOW -- ClamAV only, auto-promote if clean
- **Promotion rules:**
  1. **Scan passes** (ClamAV clean + VirusTotal 0/70 detections) -- copy to pool
  2. **Admin manually approves** via copyparty web UI -- copy to pool
  3. **Auto-approve after 7 days** if no flags and source is "trusted-upload"
- **Forever rule:** Btrfs reflink copy of every incoming file persists in `/incoming/.archive/<category>/` as a read-only record even after promotion. Malware cannot modify the archived copy (immutable attribute set via `chattr +i`). Admin can audit, purge, or restore.

#### Bucket 2: Category Pools (The Clean Population)
- **Path:** `/pool/<category>`
- **Filesystem:** MergerFS pool per category (ext4 underlying)
- **Mount flags:** `noexec,nosuid,nodev,ro` (for all consumers)
- **Purpose:** Only verified-clean files live here, organized by type
- **Access:**
  - copyparty: read-only serve
  - Jellyfin: read-only bind mount
  - quarantine-gate: write-only via API (promotion path)
- **Isolation:** A movie in `/pool/movies` cannot see a photo in `/pool/photos`. Each category is a separate mount namespace.
- **Performance:** Zero overhead. Files read directly from disk → kernel → network. No proxy, no inspection during stream.

#### Bucket 3: System (The Untouchable Host)
- **Path:** `/` (host OS)
- **Access:** No container has host filesystem access. Not mounted, not visible.
- **Purpose:** If any container is fully compromised, the attacker has no root, no host fs, no network beyond LAN, no ability to modify pool data (read-only from host perspective too).

#### Bucket 4: Offline Backups (The Air-Gapped Safety Net)
- **Path:** `/backup/<category>` (separate physical drive or USB)
- **Mount state:** Unmounted 23 hours/day. Mounted only during `rsync` cron job at 1 AM (when WiFi is off).
- **Purpose:** Even if all above layers fail, the backup is physically offline and inaccessible during active hours.

### 8.3 Implementation: Multi-Container + Risk-Based Routing

#### Routing Logic (copyparty upload hook)
```python
#!/usr/bin/env python3
# /opt/copyparty/hooks/on-upload.py
import sys, os, time, subprocess, hashlib, shutil, logging
from pathlib import Path
from virustotal import virustotal_check  # separate module, see below

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO)

# --- Extension-based category map ---
CATEGORY_MAP = {
    "movies":  {".mkv", ".mp4", ".avi", ".m4v", ".mov"},
    "tv":      set(),  # determined by path convention, not extension
    "music":   {".mp3", ".flac", ".ogg", ".m4a", ".wav", ".opus"},
    "photos":  {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".raw", ".cr2"},
    "docs":    {".pdf", ".docx", ".xlsx", ".txt", ".md", ".odt", ".epub"},
    "memes":   set(),  # manually tagged or from specific upload path
}

def categorize(filename):
    ext = Path(filename).suffix.lower()
    for cat, exts in CATEGORY_MAP.items():
        if ext in exts:
            return cat
    return "unknown"

def archive_reflink(src_path, category):
    """Create an immutable reflink copy in the archive directory (Btrfs only)."""
    archive_dir = f"/incoming/.archive/{category}"
    os.makedirs(archive_dir, exist_ok=True)
    ts = int(time.time())
    short_hash = hashlib.md5(os.path.basename(src_path).encode()).hexdigest()[:8]
    dst = f"{archive_dir}/{ts}-{short_hash}-{os.path.basename(src_path)}"
    subprocess.run(["cp", "--reflink=always", src_path, dst], check=True)
    subprocess.run(["chattr", "+i", dst], check=True)  # immutable

def promote(src, dst):
    """Copy from Btrfs incoming to ext4/MergerFS pool. Cross-filesystem, so copy, not link."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    os.remove(src)
    logging.info(f"Promoted: {src} -> {dst}")

def quarantine(filepath):
    q_dir = "/incoming/.quarantine"
    os.makedirs(q_dir, exist_ok=True)
    shutil.move(filepath, f"{q_dir}/{os.path.basename(filepath)}")
    logging.warning(f"Quarantined: {filepath}")

def flag_for_review(filepath, vt_result):
    quarantine(filepath)
    logging.warning(f"Flagged for review: {filepath} | VT: {vt_result}")
    # TODO: send notification (email, webhook, etc.)

def notify_admin(msg):
    logging.warning(f"ADMIN ALERT: {msg}")
    # TODO: send notification

# --- Main ---
FILE = sys.argv[1]
FILENAME = os.path.basename(FILE)
CATEGORY = categorize(FILENAME)
SOURCE = sys.argv[2]  # "download", "untrusted-upload", "trusted-upload"
RISK = {"download": "high", "untrusted-upload": "medium", "trusted-upload": "low"}[SOURCE]

# 1. Move to incoming buffer
INCOMING = f"/incoming/{CATEGORY}"
os.makedirs(INCOMING, exist_ok=True)
incoming_path = f"{INCOMING}/{FILENAME}"
os.rename(FILE, incoming_path)

# 2. Reflink archive copy (immutable, Btrfs COW -- near-zero disk cost)
archive_reflink(incoming_path, CATEGORY)

# 3. Scan based on risk
clam = subprocess.run(["clamscan", "--infected", "--remove=no", incoming_path])
pool_dst = f"/pool/{CATEGORY}/{FILENAME}"

if RISK == "high":
    if clam.returncode == 0:
        vt = virustotal_check(incoming_path)
        if vt["positives"] == 0:
            promote(incoming_path, pool_dst)
        elif vt["positives"] == -1:
            logging.info(f"VT has no record of {FILENAME} (novel file). Holding for review.")
            flag_for_review(incoming_path, vt)
        else:
            flag_for_review(incoming_path, vt)
    else:
        quarantine(incoming_path)
elif RISK == "medium":
    if clam.returncode == 0:
        promote(incoming_path, pool_dst)
    else:
        quarantine(incoming_path)
elif RISK == "low":
    if clam.returncode == 0:
        promote(incoming_path, pool_dst)
    else:
        notify_admin(f"Trusted upload flagged by ClamAV: {FILENAME}")
        quarantine(incoming_path)
```

#### VirusTotal Free Tier Integration
```python
# /opt/copyparty/hooks/virustotal.py
import requests, time, hashlib, json, os, logging

VT_API_KEY = os.environ.get("VT_API_KEY", "")  # set in systemd unit or .env, not hardcoded
VT_CACHE_FILE = "/opt/copyparty/hooks/.vt_cache.json"

def _load_cache():
    try:
        with open(VT_CACHE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_cache(cache):
    with open(VT_CACHE_FILE, "w") as f:
        json.dump(cache, f)

def virustotal_check(filepath):
    """Hash-based lookup only. VT returns results only if the file (by SHA256) has been
    previously submitted and scanned. Novel files (personal photos, unique documents)
    will return 404 -- this is NOT a clean bill of health, just 'unknown to VT'."""

    file_hash = hashlib.sha256(open(filepath, "rb").read()).hexdigest()
    cache = _load_cache()
    if file_hash in cache:
        return cache[file_hash]

    if not VT_API_KEY:
        return {"positives": -1, "error": "No API key configured"}

    # Rate limit: 4 req/min = 15 sec between requests
    time.sleep(15)

    url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
    headers = {"x-apikey": VT_API_KEY}
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        data = response.json()
        stats = data["data"]["attributes"]["last_analysis_stats"]
        result = {
            "positives": stats.get("malicious", 0),
            "suspicious": stats.get("suspicious", 0),
            "total": sum(stats.values()),
        }
        cache[file_hash] = result
        _save_cache(cache)
        return result
    elif response.status_code == 404:
        # File hash not in VT database -- novel/unique file
        return {"positives": -1, "error": "Hash not found in VT (novel file)"}
    else:
        return {"positives": -1, "error": f"API error {response.status_code}"}
```

**VirusTotal limitation:** The free tier does hash lookups only. Personal photos, unique documents, and files never previously uploaded to VT will return "not found" -- this is NOT a clean result. For high-risk downloads of common media (popular torrents, known software), hash lookups work well because someone has likely already submitted the file. For novel files, ClamAV + YARA rules are the actual defense.

### 8.4 The Nighttime Security Window (1 AM - 7 AM)

Your home WiFi shuts off automatically from ~1 AM to 7 AM. This is a **security asset**, not an inconvenience.

**What runs during the offline window:**
- **1:00 AM:** WiFi goes down. Router disconnects from ISP.
- **1:05 AM:** Server detects no WAN gateway. Enters "maintenance mode."
- **1:10 AM:** Backup drive mounts. `rsync` runs: `/pool/*` → `/backup/*` (incremental, encrypted)
- **1:30 AM:** System-wide ClamAV scan of all `/pool` buckets (read-only, safe)
- **2:00 AM:** `freshclam` updates virus definitions (if WAN was available via wired fallback, else skips)
- **2:30 AM:** Btrfs scrub checks filesystem integrity
- **3:00 AM:** Log rotation, purge archived reflinks > 90 days (remove immutable attr first: `chattr -i`)
- **6:55 AM:** Backup drive unmounts. System returns to "serve mode."
- **7:00 AM:** WiFi comes up. Server resumes normal operation.

**Wired fallback for updates:**
If you want `freshclam` to always work, run a **wired Ethernet connection** to the modem directly (bypassing the WiFi router). The server can reach the internet for updates while the WiFi LAN remains off. This is a single cable, no configuration change.

```
Router (WiFi off 1-7 AM) ──► ThinkCentre (WiFi disabled, no route)
     │
     └── Modem (always on) ──► ThinkCentre (USB Ethernet adapter, updates only)
```

**Note:** The M710q has a single Ethernet port. A second wired connection to the modem requires a USB-to-Ethernet adapter (~$12).

**Firewall rules for update window:**
```bash
# /etc/nftables.conf
table inet update_filter {
    chain output {
        type filter hook output priority 0; policy drop;

        # Always allow loopback and established connections
        oifname "lo" accept
        ct state established,related accept

        # During 1-7 AM on the update interface, allow HTTPS to Debian/ClamAV mirrors
        meta hour "01:00:00"-"06:59:59" oifname "enx*" tcp dport 443 accept
        meta hour "01:00:00"-"06:59:59" oifname "enx*" udp dport 53 accept

        # Always allow LAN traffic on primary interface
        oifname "enp*" ip daddr 192.168.0.0/16 accept

        # Log and drop everything else
        log prefix "nft-drop: " drop
    }
}
```

**Note on `oifname "enx*"`:** USB Ethernet adapters on Linux typically get interface names starting with `enx` (based on MAC address). Verify with `ip link` after plugging in. The primary onboard NIC is typically `enp0s31f6` or similar on the M710q.

### 8.5 Network Privacy: The Layered Defense Stack

You want layers between you and ISP/government surveillance. Here's the stack:

```
┌─────────────────────────────────────────────┐
│  YOUR PHONE / LAPTOP                        │
│  ┌───────────────────────────────────────┐   │
│  │  1. DNS-over-HTTPS (DoH)              │   │
│  │     Cloudflare 1.1.1.1 or Quad9      │   │
│  │     (encrypts DNS queries from ISP)   │   │
│  ├───────────────────────────────────────┤   │
│  │  2. WireGuard to Proton Forwarded Port│   │
│  │     (encrypted tunnel via Proton VPN) │   │
│  └───────────────────────────────────────┘   │
│         │                                    │
│         ▼                                    │
│  ┌───────────────────────────────────────┐   │
│  │  INTERNET                             │   │
│  │  (bots/scanners see Proton IP only)   │   │
│  └───────────────────────────────────────┘   │
│         │                                    │
│         ▼                                    │
│  ┌───────────────────────────────────────┐   │
│  │  THINKCENTRE SERVER (Home)            │   │
│  │  ┌─────────────────────────────────┐  │   │
│  │  │  3. Proton VPN client (WireGuard) │  │   │
│  │  │     Port forwarding enabled       │  │   │
│  │  │     All outbound traffic routed   │  │   │
│  │  │     through Proton's servers      │  │   │
│  │  ├─────────────────────────────────┤  │   │
│  │  │  4. WireGuard server              │  │   │
│  │  │     Listens on Proton forwarded   │  │   │
│  │  │     port, not on public ISP IP    │  │   │
│  │  ├─────────────────────────────────┤  │   │
│  │  │  5. AdGuard Home or Pi-hole       │  │   │
│  │  │     DNS filtering, tracker blocking │  │   │
│  │  ├─────────────────────────────────┤  │   │
│  │  │  6. Firewall (nftables)           │  │   │
│  │  │     Drop all unexpected inbound   │  │   │
│  │  │     Log all outbound for audit      │  │   │
│  │  └─────────────────────────────────┘  │   │
│  └───────────────────────────────────────┘   │
│         │                                    │
│         ▼                                    │
│  ISP ──► Modem ──► Router (WiFi off)       │
│  (ISP sees encrypted Proton tunnel only)     │
└─────────────────────────────────────────────┘
```

**What each layer hides:**
| Layer | What It Hides | From Whom |
|-------|--------------|-----------|
| DoH on phone | DNS queries | ISP, local network snoops |
| WireGuard via Proton | Traffic content, destination, home IP | ISP, WiFi eavesdroppers, bot scanners |
| Proton VPN on server | Server's outbound traffic | ISP, government surveillance |
| Proton port forwarding | Home network open ports | Internet bots, attackers |
| AdGuard/Pi-hole | Tracker domains, ad networks | Data brokers, advertisers |
| Firewall logs | Anomaly detection | You (for self-audit) |

**The "they can break VPN encryption" reality:**
Yes, nation-state actors with sufficient resources can potentially compromise VPN encryption through quantum computing, backdoored algorithms, or endpoint compromise. But:
- **Layered encryption** (WireGuard + Proton) means breaking one reveals only the next hop
- **Swiss jurisdiction** (Proton) has stronger privacy laws than Five Eyes countries
- **Self-hosted server** means your data never touches third-party cloud storage
- **No logs** (if configured) means even if compelled, there's nothing to hand over
- **The goal is friction**, not perfection. Surveillance is resource-limited. Layers increase cost.

### 8.6 The "Phone Compromise" Scenario

You mentioned: "What if a virus on my phone planted itself in my photos?"

**The upload path:**
1. Photo uploads from phone → WireGuard tunnel → copyparty
2. copyparty tags source as `trusted-upload` (your device, known WireGuard key)
3. File lands in `/incoming/photos`
4. ClamAV scans. If clean → promotes to `/pool/photos`
5. If ClamAV flags it -- **quarantined, admin notified, immutable reflink archive preserved**

**Steganography detection:**
Standard ClamAV won't catch a JPG with embedded executable. Add **YARA rules** for anomaly detection:
```bash
# Install yara
sudo apt install yara

# Rule: flag JPGs with suspicious appended data
# /opt/yara-rules/stego.yar
rule suspicious_jpg {
    strings:
        $jpg_header = { FF D8 FF }
        $exe_marker = "MZ" ascii
        $elf_marker = { 7F 45 4C 46 }
    condition:
        $jpg_header at 0 and ($exe_marker in (filesize-1000..filesize) or $elf_marker in (filesize-1000..filesize))
}
```

**The realistic assessment:** A state-level actor targeting you specifically can compromise your phone, embed malware in photos, and evade detection. Against that threat model, no home server setup helps. But for commodity malware, drive-by downloads, and automated surveillance, this architecture provides meaningful friction.

### 8.7 Performance Impact

| Layer | Overhead | Notes |
|-------|----------|-------|
| **LXC containers (3x)** | ~1-2% CPU total | Process isolation, no VM emulation |
| **noexec mount** | 0% | Kernel flag, no runtime cost |
| **Btrfs reflink copies** | ~0.1% I/O | Copy-on-write, negligible |
| **ClamAV scan** | Async, post-upload | Doesn't block streaming |
| **VirusTotal (free)** | 15 sec delay per file | 4 req/min limit, cached results |
| **YARA rules** | ~0.5% CPU per scan | Fast pattern matching |
| **Proton VPN** | ~5-10% CPU | WireGuard is lightweight; speed depends on server distance |
| **AdGuard DNS** | ~1ms latency | Local cache, minimal impact |
| **Stream read-only** | 0% | Direct kernel → network |
| **TOTAL** | **~3-5%** | **Unnoticeable on i5-7400T for 5 clients** |

**Resolution/speed:** No impact. Files stream directly from disk. VPN is outbound-only (server → internet), not LAN traffic (server → phone). LAN streaming is full gigabit speed.

### 8.8 What Malware Can and Cannot Do (Updated)

| Attack Vector | Mitigation | Result |
|---------------|-----------|--------|
| Downloaded executable runs | `noexec` + per-category isolation | **Denied by kernel, contained to one bucket** |
| Exploit escapes quarantine | LXC unprivileged + AppArmor | **Contained in single container** |
| Malware modifies family photos | `/pool/photos` is read-only to all services | **Denied — photos are untouchable** |
| Malware deletes TV shows | `/pool/tv` is read-only, separate mount namespace | **Denied — cannot see or touch TV bucket** |
| Malware persists after "delete" | Btrfs reflink archive copy, immutable (chattr +i) | **Frozen, inert, auditable** |
| Malware spreads phone→server | Phone upload scanned before promotion | **Blocked at gate** |
| Codec exploit in Jellyfin | Jellyfin in separate container, read-only pool | **Cannot write, limited blast radius** |
| Government ISP surveillance | WireGuard + Proton VPN + DoH | **Encrypted, multi-hop, Swiss jurisdiction** |
| Router backdoor | Server has direct modem fallback for updates | **Maintains security patches despite router compromise** |
| Total server compromise | Offline backup, unmounted 23/7 | **Data recoverable from air-gapped backup** |

### 8.9 No Cloud Dependency (Privacy-First)
- No Google, Apple, Microsoft services required
- No third-party authentication (OAuth, etc.)
- No DNS registration needed for LAN access
- WireGuard config files distributed offline (QR codes, local file share)
- Antivirus definitions updated via `freshclam` or manual download
- Proton VPN is the only external dependency, and it's replaceable (Mullvad, self-hosted WireGuard exit node)

---

## 9. USER ACCESS CONTROL & PERMISSION ARCHITECTURE

### 9.1 Design Philosophy

The server is a **multi-tenant private cloud** where every user has:
- A **private vault** — invisible to all others unless explicitly shared
- **Shared spaces** — user-created, permission-controlled, auto-expiring
- **Public pools** — family-wide media, no login required on LAN (optional)
- **Granular sharing** — per-file, per-folder, per-user, with time limits

This replaces Telegram's "Saved Messages" (private) + "Groups" (shared) + "Channels" (public) model with a self-hosted equivalent.

### 9.2 User Types & Permission Matrix

| User Type | Private Vault | Create Shares | Access Public | Access Shared | Admin | Remote Access |
|-----------|-------------|-------------|-------------|---------------|-------|---------------|
| **Owner (You)** | Full | Yes | Yes | All | Yes | Yes |
| **Family Member** | Full | Yes | Yes | Invited only | No | Yes |
| **Guest** | None | No | Yes | Invited only | No | No (LAN only) |
| **Temporary** | None | No | Yes | Specific share | No | No |
| **Service Account** | N/A | N/A | Read-only | N/A | N/A | N/A |

### 9.3 The Four Visibility Zones

```
+-------------------------------------------------------------+
|                    SERVER FILESYSTEM                          |
|  +-------------------------------------------------------+  |
|  |  ZONE 1: PRIVATE VAULTS (per-user, invisible)         |  |
|  |  /users/alice/private/                                |  |
|  |  /users/alice/private/photos                          |  |
|  |  /users/alice/private/music                           |  |
|  |  /users/alice/private/work                            |  |
|  |  /users/alice/private/memes                           |  |
|  |  ---------------------------------------------------  |  |
|  |  Only alice sees this. Not listed in any index.       |  |
|  |  Files here bypass quarantine (trusted source).         |  |
|  |  Alice can share individual items or folders outward.   |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  |  ZONE 2: SHARED SPACES (user-created, permissioned)   |  |
|  |  /shares/alice-bob-work/                              |  |
|  |  /shares/alice-sil-baking/                            |  |
|  |  /shares/family-movies/                               |  |
|  |  ---------------------------------------------------  |  |
|  |  Created by a user, invite specific others.             |  |
|  |  Auto-expire: 7 days (share link) or 30 days (space)   |  |
|  |  Files here go through quarantine (untrusted source).   |  |
|  |  Owner can revoke access, delete, or extend expiry.     |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  |  ZONE 3: PUBLIC POOLS (family-wide, read-only)        |  |
|  |  /public/movies                                       |  |
|  |  /public/tv                                           |  |
|  |  /public/music                                        |  |
|  |  /public/photos (family photos, curated)               |  |
|  |  ---------------------------------------------------  |  |
|  |  Visible to all authenticated users on LAN.             |  |
|  |  Only admin/curator can write.                        |  |
|  |  Files promoted from private vaults by owner.        |  |
|  |  No quarantine (already scanned at source).           |  |
|  +-------------------------------------------------------+  |
|  +-------------------------------------------------------+  |
|  |  ZONE 4: ANONYMOUS DROP (optional, upload-only)      |  |
|  |  /incoming/anonymous/                                 |  |
|  |  ---------------------------------------------------  |  |
|  |  No login required on LAN.                            |  |
|  |  Upload-only, quarantined, admin review required.     |  |
|  |  Useful for guests to drop files without account.     |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 9.4 copyparty User & Volume Configuration

copyparty uses its own config file format (not JSON). Users, volumes, and permissions are defined in a single `.conf` file passed via `--cfg`:

```ini
# /opt/copyparty/config/copyparty.conf

[global]
  # bind to all interfaces, port 80
  p: 80
  # custom UI directory
  html: /opt/copyparty/custom-ui

[accounts]
  # username: password (use -hp flag to generate password hashes)
  # run: python3 copyparty-sfx.py -hp mypassword
  alice: $2b$12$hashedpasswordhere
  bob: $2b$12$hashedpasswordhere
  sil: $2b$12$hashedpasswordhere
  guest: $2b$12$hashedpasswordhere

# --- Private vaults (per-user, invisible to others) ---

[/vault/alice]
  /users/alice/private
  accs:
    rwmd: alice

[/vault/bob]
  /users/bob/private
  accs:
    rwmd: bob

[/vault/sil]
  /users/sil/private
  accs:
    rwmd: sil

# --- Shared spaces (invited users only) ---

[/shared/work]
  /shares/alice-bob-work
  accs:
    rwmd: alice
    rw: bob

[/shared/baking]
  /shares/alice-sil-baking
  accs:
    rwmd: alice
    rw: sil

# --- Public pools (all authenticated users, read-only) ---

[/public/movies]
  /pool/movies
  accs:
    r: *

[/public/tv]
  /pool/tv
  accs:
    r: *

[/public/music]
  /pool/music
  accs:
    r: *

[/public/photos]
  /pool/photos
  accs:
    r: *

# --- Anonymous drop (upload-only, no auth, LAN only) ---

[/drop]
  /incoming/anonymous
  accs:
    w: *
```

**Permission flags:** `r` = read/download, `w` = write/upload, `m` = move/rename, `d` = delete, `a` = admin. Combine as needed: `rwmd` = full access.

**Start with config:** `python3 copyparty-sfx.py --cfg /opt/copyparty/config/copyparty.conf`

### 9.5 Share Creation & Expiry System

#### Share Types

| Type | Visibility | Expiry | Use Case |
|------|-----------|--------|----------|
| **Link Share** | Anyone with URL | 7 days default, configurable | Send a single file to someone |
| **Folder Share** | Invited users | 30 days default, extendable | Collaborate on a project |
| **Space Share** | Invited users | 30 days fixed, auto-delete | Temporary group workspace |
| **Public Drop** | LAN anonymous | N/A, admin review | Guest uploads without account |

#### Share Metadata (stored in SQLite on server)
```sql
CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT CHECK(type IN ('link', 'folder', 'space', 'drop')),
    visibility TEXT CHECK(visibility IN ('private', 'invited', 'public')),
    created_at INTEGER,
    expires_at INTEGER,
    auto_delete BOOLEAN DEFAULT 0,
    max_size_gb INTEGER,
    password_hash TEXT
);

CREATE TABLE share_members (
    share_id TEXT,
    username TEXT,
    permission TEXT CHECK(permission IN ('r', 'rw', 'admin')),
    invited_at INTEGER,
    PRIMARY KEY (share_id, username)
);
```

#### PWA Share Flow
```
Alice opens PWA -> taps "New Share"
-> selects type: "Space"
-> names it: "Baking with SIL"
-> sets expiry: 30 days
-> invites: sil (from contact list)
-> sets permission: rw for sil, admin for alice
-> creates share at /shares/alice-sil-baking-<uuid>
-> PWA generates invite link: https://copyparty.local/s/<uuid>
-> sil receives notification (or alice sends link manually)
-> sil accepts -> space appears in her PWA sidebar
-> both upload files -> quarantine scans -> promoted to space
-> day 30: cron job checks expires_at -> deletes share + contents
-> or alice extends: "+30 days" -> updates expires_at
```

### 9.6 The PWA Sidebar Structure

```
+-------------------------------------+
|  My Server          [search] [gear]  |
+-------------------------------------+
|  PRIVATE                            |
|  [icon] My Photos                     |
|  [icon] My Music                      |
|  [icon] Work Stuff                    |
|  [icon] Memes                         |
|  -----------------------------------  |
|  SHARED WITH ME                       |
|  [icon] Baking with SIL (12d left)  |
|  [icon] Work with Bob (5d left)     |
|  -----------------------------------  |
|  PUBLIC POOLS                         |
|  [icon] Movies                        |
|  [icon] TV Shows                      |
|  [icon] Music                         |
|  [icon] Family Photos                 |
|  -----------------------------------  |
|  MY SHARES                            |
|  [icon] Link: vacation.jpg (2d left)|
|  [icon] Space: Project X (28d left) |
|  -----------------------------------  |
|  [+ New Share]                        |
+-------------------------------------+
```

### 9.7 Temporary User Lifecycle

For guests or one-time access:

```
Admin creates user:
  username: temp-guest-47
  password: auto-generated (12 chars)
  expiry: 7 days from now
  permissions: public read-only, one invited share
  remote_access: false (LAN only)

PWA shows countdown:
  "Access expires in 5 days, 3 hours"

Day 7:
  Cron job deactivates account
  PWA shows: "This share has expired. Contact owner for renewal."
  Files in user's private vault (if any) -> moved to admin quarantine for 30 days -> then purged
```

### 9.8 Permission Inheritance & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Alice shares a subfolder of her private vault | The shared path is a **bind mount** into the share space. Alice's original remains private. Changes sync bidirectionally. |
| Bob deletes a file in a shared space | Only if he has rw. Deleted file goes to share's .trash for 30 days, then purged. |
| SIL uploads malware to "Baking" share | Quarantine scans it. If flagged, file is quarantined, SIL and Alice notified. Share remains accessible. |
| Alice revokes SIL's access | SIL's PWA immediately loses the share. Her cached files are marked stale and evicted on next sync. |
| Share expires while users have cached files | PWA marks share as "expired." Cached files remain locally until 30-day eviction, but cannot sync new changes. |
| Admin (you) wants to see everything | You have implicit read access to all shares (not private vaults). Audit log shows all activity. |

### 9.9 Audit & Transparency

Every action is logged:
```sql
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    username TEXT,
    action TEXT CHECK(action IN ('login', 'logout', 'upload', 'download', 'share_create', 'share_join', 'share_leave', 'share_expire', 'delete', 'admin_override')),
    target_path TEXT,
    share_id TEXT,
    ip_address TEXT,
    user_agent TEXT
);
```

Admin dashboard (PWA admin panel):
- Active users
- Recent uploads
- Share expiry timeline
- Quarantine queue
- Storage usage per user
- Failed login attempts

### 9.10 Implementation: copyparty + Custom Middleware

copyparty handles auth and per-user volumes natively. The share system is a thin layer on top:

```python
# /opt/copyparty/hooks/share-manager.py
# Runs alongside copyparty, manages share metadata, expiry, notifications
# NOTE: This is a minimal reference implementation. Production use needs
# auth middleware (verify copyparty session token) and proper error handling.

from flask import Flask, request, jsonify
import sqlite3, uuid, time, os, shutil

app = Flask(__name__)
DB = "/opt/copyparty/shares.db"
SCHEMA = "/opt/copyparty/hooks/schema.sql"

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript(open(SCHEMA).read())

@app.route("/api/shares", methods=["POST"])
def create_share():
    data = request.json
    share_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO shares (id, owner, name, path, type, visibility, created_at, expires_at, auto_delete) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (share_id, data["owner"], data["name"], "/shares/" + share_id,
             data["type"], data["visibility"], int(time.time()),
             int(time.time()) + data["expiry_days"] * 86400, data.get("auto_delete", 0))
        )
        for member in data.get("members", []):
            conn.execute(
                "INSERT INTO share_members (share_id, username, permission, invited_at) VALUES (?, ?, ?, ?)",
                (share_id, member["username"], member["permission"], int(time.time()))
            )
    os.makedirs("/shares/" + share_id, exist_ok=True)
    return jsonify({"share_id": share_id, "url": "https://copyparty.local/s/" + share_id})

@app.route("/api/shares/<share_id>/extend", methods=["POST"])
def extend_share(share_id):
    days = request.json.get("days", 30)
    with get_db() as conn:
        conn.execute("UPDATE shares SET expires_at = expires_at + ? WHERE id = ?", (days * 86400, share_id))
    return jsonify({"status": "extended"})

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5001)
```

#### Share Expiry Cron Script (standalone, not HTTP)
```python
#!/usr/bin/env python3
# /opt/copyparty/hooks/share-expiry.py
# Called by cron every hour: 0 * * * * /usr/bin/python3 /opt/copyparty/hooks/share-expiry.py
import sqlite3, time, os, shutil, logging

logging.basicConfig(filename="/var/log/share-expiry.log", level=logging.INFO)
DB = "/opt/copyparty/shares.db"

def run_expiry():
    conn = sqlite3.connect(DB)
    now = int(time.time())

    # Warn about shares expiring in < 3 days
    expiring = conn.execute(
        "SELECT id, owner, name FROM shares WHERE expires_at < ? AND expires_at > ?",
        (now + 3 * 86400, now)
    ).fetchall()
    for share_id, owner, name in expiring:
        logging.info(f"Expiring soon: {name} (owner: {owner}, id: {share_id})")

    # Delete expired shares
    expired = conn.execute(
        "SELECT id, path, auto_delete FROM shares WHERE expires_at < ?", (now,)
    ).fetchall()
    for share_id, path, auto_delete in expired:
        if auto_delete and os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
        conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
        conn.execute("DELETE FROM share_members WHERE share_id = ?", (share_id,))
        logging.info(f"Expired and removed: {share_id} at {path}")

    conn.commit()
    conn.close()
    logging.info(f"Expiry check complete: {len(expired)} expired, {len(expiring)} expiring soon")

if __name__ == "__main__":
    run_expiry()
```

### 9.11 PWA Integration

The PWA queries the share manager API for sidebar population:
```javascript
// PWA service worker fetch handler for share list
async function getShares() {
  const response = await fetch('/api/shares/my-shares', {
    headers: { 'Authorization': 'Bearer ' + await getAuthToken() }
  });
  const shares = await response.json();
  const db = await openDB('copyparty-cache', 1);
  await db.put('shares', shares, 'my-shares');
  return shares;
}
```

---

## 10. DEPLOYMENT CHECKLIST

### Phase 1: Hardware (Day 1)
- [ ] ~~Order ThinkCentre M710q ($69.99)~~ **DONE**
- [ ] ~~Order Samsung PM991 128GB NVMe 2242 ($19.99)~~ **DONE**
- [ ] Order USB 3.0 to SATA cables (UASP, JMS578 or ASM1153E chipset, ~$10 each)
- [ ] Order USB-to-Ethernet adapter for wired update fallback (~$12, optional)
- [ ] Print drive housing (or use temporary external USB dock)
- [ ] Install PM991 NVMe in M.2 slot, 500GB HDD stays in 2.5" bay
- [ ] Assemble, verify POST, enter BIOS
- [ ] **First boot: run `smartctl -a /dev/nvme0` and verify < 20% wear**

### Phase 2: OS & Storage (Day 1-2)
- [ ] Flash Debian 12 Server netinst to USB
- [ ] Install to PM991 NVMe
- [ ] Configure static IP (192.168.1.10)
- [ ] Format 500GB HDD as ext4, mount as `/storage/drive1`
- [ ] **Install btrfs-progs, create per-category subvolumes: `/incoming/movies`, `/incoming/tv`, etc.**
- [ ] **Create `/pool/movies`, `/pool/tv`, `/pool/photos`, `/pool/music`, `/pool/memes`, `/pool/docs`**
- [ ] **Install LXC, create three containers: quarantine-gate, copyparty-server, jellyfin-server**
- [ ] **Install AppArmor, apply per-container profiles**
- [ ] **Install ClamAV, YARA, configure freshclam**
- [ ] **Get VirusTotal free API key, store in environment variable (not in code)**
- [ ] Install and configure copyparty inside copyparty-server container
- [ ] Configure upload hooks for risk-based routing (download vs. trusted-upload)
- [ ] Verify LAN access from phone/laptop
- [ ] **Test: upload EICAR test file to each category, verify quarantine + reflink archive + no cross-bucket access**

### Phase 3: Network & Remote (Day 2)
- [ ] Configure router DHCP reservation
- [ ] Set local DNS (copyparty.local) or document IP
- [ ] Install WireGuard, generate client configs
- [ ] Configure Proton VPN port forwarding
- [ ] Test remote access from cellular via Proton forwarded port

### Phase 4: Nighttime Maintenance & Backups (Day 3)
- [ ] **Configure cron: 1:05 AM -- mount backup drive, run rsync**
- [ ] **Configure cron: 1:30 AM -- system-wide ClamAV scan of all `/pool` buckets**
- [ ] **Configure cron: 2:00 AM -- freshclam update (if wired WAN available)**
- [ ] **Configure cron: 2:30 AM -- Btrfs scrub for filesystem integrity**
- [ ] **Configure cron: 3:00 AM -- log rotation, purge archived reflinks > 90 days**
- [ ] **Configure cron: 6:55 AM -- unmount backup drive**
- [ ] **Test: verify backup drive is unmounted during daytime (`lsblk` check)**
- [ ] **Optional: configure USB Ethernet fallback to modem for updates during WiFi-off window**

### Phase 5: PWA Skin (Week 1-2)
- [ ] Audit copyparty API endpoints
- [ ] Build PWA shell (Vite + vanilla JS)
- [ ] Implement Service Worker with Workbox
- [ ] Implement IndexedDB sync logic
- [ ] Build "Stream Mode" UI (chronological feed)
- [ ] Test offline functionality
- [ ] Deploy to copyparty's `--html` directory

### Phase 6: Polish & Expansion (Ongoing)
- [ ] Add Jellyfin for dedicated media streaming
- [ ] Add qBittorrent + *arr stack (optional)
- [ ] Expand drive pool as cheap drives become available
- [ ] 3D-print final drive housing
- [ ] Document backup strategy (optional rclone)

---

## 11. COST SUMMARY

| Item | Cost |
|------|------|
| ThinkCentre M710q (i5-7400T, 8GB, 500GB HDD) | $69.99 |
| Samsung PM991 128GB NVMe 2242 (boot) | $19.99 |
| USB 3.0 to SATA cables x2 (UASP) | ~$20 |
| 3D-printed housing (filament) | ~$5 |
| 120mm fan + buck converter | ~$10 |
| ATX PSU for drives | ~$15 |
| USB Ethernet adapter (optional, for update fallback) | ~$12 |
| **Phase 1 Total** | **~$140-152** |
| Future: 4TB HDD (on sale) | ~$60 |
| Future: Additional drives + USB-SATA cable | ~$70 each |

---

## 12. RISK & MITIGATION

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Single drive failure | Medium | Medium | MergerFS = only lost drive's data; no RAID overhead |
| Power outage | Low | Low | BIOS "power on AC restore"; cheap UPS optional |
| CPU insufficient for 5 streams | Low | Medium | i5-7400T proven adequate; upgrade path = sell + replace |
| WiFi congestion | Medium | Medium | 5GHz band, QoS on router, Ethernet for stationary devices |
| PWA cache bloat | Medium | Low | Auto-eviction + storage quota monitoring |
| copyparty API changes | Low | Medium | Pin version, test updates in staging |
| Hardware obsolescence | Low | Low | Commodity x86, easily replaced in 3-5 years |
| **Malware in downloads** | **Medium** | **High** | **Per-category quarantine + noexec + ClamAV + VirusTotal + Btrfs reflink archives** |
| **Sandbox escape** | **Low** | **High** | **Multi-container LXC + AppArmor + read-only pools + offline backups** |
| **Government surveillance** | **High** | **Medium** | **WireGuard + Proton VPN port forwarding + DoH + Swiss jurisdiction + self-hosted data** |
| **Bot scanning / port exposure** | **Medium** | **Medium** | **Proton port forwarding hides home IP, no open ports on public ISP IP** |
| **Phone compromise** | **Low** | **Medium** | **Trusted-upload scan + YARA stego detection + quarantine gate** |

---

## 13. SUCCESS CRITERIA

- [ ] PWA installs to phone home screen, launches full-screen
- [ ] Files upload from phone, appear in chronological stream
- [ ] Media plays instantly when cached, streams smoothly when not
- [ ] Search works offline (IndexedDB) with <100ms response
- [ ] 30-day auto-eviction functions without manual intervention
- [ ] New device syncs index on first open, caches files on demand
- [ ] 5 concurrent WiFi clients access content without stutter
- [ ] Zero dependency on Google, Apple, Microsoft, or Telegram
- [ ] Remote access via WireGuard works from cellular
- [ ] **Private vaults are invisible to other users**
- [ ] **Shares auto-expire and notify users before deletion**
- [ ] **Temporary users auto-create with limited permissions and expiry**
- [ ] **Admin can audit all actions via dashboard**
- [ ] Total hardware cost under $150 for initial deployment

---

## APPENDIX A: MERGERFS CONFIG

```bash
# /etc/fstab
# Pool all data drives into one mount.
# Source is a glob or colon-separated list of mount points.
# Add new drives: mount them under /storage/driveN, they join the pool automatically.
/storage/drive*  /storage/pool  fuse.mergerfs  defaults,allow_other,use_ino,cache.files=off,dropcacheonclose=true,category.create=mfs,moveonenospc=true,minfreespace=10G,fsname=mergerfs  0  0
```

## APPENDIX B: COPYPARTY SYSTEMD SERVICE

```ini
# /etc/systemd/system/copyparty.service
[Unit]
Description=copyparty file server
After=network.target

[Service]
Type=simple
User=copyparty
Group=copyparty
WorkingDirectory=/opt/copyparty
EnvironmentFile=/opt/copyparty/config/secrets.env
ExecStart=/usr/bin/python3 /opt/copyparty/copyparty-sfx.py \
    --cfg /opt/copyparty/config/copyparty.conf
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
# /opt/copyparty/config/secrets.env (chmod 600, owned by copyparty:copyparty)
VT_API_KEY=your-virustotal-api-key-here
```

## APPENDIX C: WIREGUARD SERVER CONFIG

```ini
# /etc/wireguard/wg0.conf
[Interface]
Address = 10.200.200.1/24
# ListenPort must match the port Proton VPN forwards to your server.
# Proton VPN port forwarding assigns a specific port -- check your Proton
# account or use their CLI: protonvpn-cli port-forward
ListenPort = 51820
PrivateKey = <server-private-key>
# Use actual interface name (run `ip link` to find it, e.g. enp0s31f6)
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o proton0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o proton0 -j MASQUERADE

[Peer]
# Phone 1
PublicKey = <phone1-public-key>
AllowedIPs = 10.200.200.2/32

[Peer]
# Phone 2
PublicKey = <phone2-public-key>
AllowedIPs = 10.200.200.3/32
```

**Note on Proton VPN port forwarding:** Clients connect to `<proton-server-ip>:<forwarded-port>`, not your home IP. The Proton forwarded port may change on reconnection. Use Proton's CLI or API to detect the current forwarded port and update WireGuard's `ListenPort` and client configs accordingly. A simple cron script can automate this.

---

*Document version: 1.1*
*Author: User + AI*
*Date: 2026-06-13*
*License: Public domain -- use, modify, distribute freely*
