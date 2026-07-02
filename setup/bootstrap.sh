#!/usr/bin/env bash
# ============================================================================
# Personal Cloud Server — Full Bootstrap
# For Debian 13 (Trixie) on Lenovo ThinkCentre M920q
#
# Usage:
#   sudo bash setup/bootstrap.sh
#
# Idempotent: tracks completed steps in /var/lib/bootstrap-state
# Network changes deferred to final step — won't kill your SSH session
# ============================================================================

set -euo pipefail
export PATH="/usr/sbin:/usr/local/sbin:$PATH"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ask()  { read -rp "$(echo -e "${CYAN}[?]${NC} $1")" "$2"; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash bootstrap.sh"
[[ ! -f /etc/debian_version ]] && err "Debian only"

# --- State tracking (idempotent reruns) ---
STATE_DIR="/var/lib/bootstrap-state"
mkdir -p "$STATE_DIR"
done_step()  { [[ -f "$STATE_DIR/$1" ]]; }
mark_step()  { touch "$STATE_DIR/$1"; }
reset_all()  { rm -f "$STATE_DIR"/*; log "State reset — all steps will re-run"; }

if [[ "${1:-}" == "--reset" ]]; then reset_all; exit 0; fi

GITHUB_REPO="https://github.com/DataGuy99/personal-cloud.git"
INSTALL_DIR="/opt/personal-cloud"
COPYPARTY_DIR="/opt/copyparty"
MAIN_USER="main"

# --- Preflight: ensure all required packages (always runs, skips if present) ---
REQUIRED_PKGS=(git curl wget jq unzip python3 python3-pip python3-venv python3-flask
  smartmontools nvme-cli mergerfs btrfs-progs wireguard wireguard-tools qrencode
  clamav clamav-daemon clamav-freshclam yara nftables iptables apparmor apparmor-utils
  fail2ban unattended-upgrades apt-listchanges sudo htop tmux rsync lsof pciutils)
MISSING=()
for pkg in "${REQUIRED_PKGS[@]}"; do
  dpkg -s "$pkg" &>/dev/null || MISSING+=("$pkg")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  step "Preflight — Installing missing packages"
  apt update -qq
  apt install -y "${MISSING[@]}" --no-install-recommends
  log "Installed: ${MISSING[*]}"
else
  log "Preflight — All packages present"
fi

# ============================================================================
# 1/16 — Hostname & Timezone
# ============================================================================
if ! done_step "01-hostname"; then
  step "1/16 — Hostname & Timezone"
  CURRENT_HOSTNAME=$(hostname)
  ask "Hostname [${CURRENT_HOSTNAME}]: " NEW_HOSTNAME
  NEW_HOSTNAME=${NEW_HOSTNAME:-$CURRENT_HOSTNAME}
  hostnamectl set-hostname "$NEW_HOSTNAME"
  sed -i "s/127\.0\.1\.1.*$/127.0.1.1\t${NEW_HOSTNAME}/" /etc/hosts
  timedatectl set-timezone America/New_York
  timedatectl set-ntp true
  log "Hostname: $NEW_HOSTNAME | TZ: America/New_York"
  mark_step "01-hostname"
else
  log "1/16 — Hostname & Timezone (done)"
fi

# ============================================================================
# 2/16 — System Update & Packages
# ============================================================================
if ! done_step "02-packages"; then
  step "2/16 — System Upgrade & Node.js"
  apt update && apt upgrade -y
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null || true
    apt install -y nodejs || { apt install -y nodejs npm 2>/dev/null || warn "Node.js install failed — PWA build will skip"; }
  fi
  log "System upgraded"
  mark_step "02-packages"
else
  log "2/16 — System upgrade (done)"
fi

# ============================================================================
# 3/16 — Jellyfin
# ============================================================================
if ! done_step "03-jellyfin"; then
  step "3/16 — Jellyfin"
  if ! command -v jellyfin &>/dev/null; then
    if curl -fsSL https://repo.jellyfin.org/install-debuntu.sh | bash; then
      log "Jellyfin installed"
    else
      warn "Jellyfin auto-install failed — may need manual install for Debian 13"
      warn "See https://jellyfin.org/docs/general/installation/linux"
    fi
  else
    log "Jellyfin already present"
  fi
  mark_step "03-jellyfin"
else
  log "3/16 — Jellyfin (done)"
fi

# ============================================================================
# 4/16 — SSH Hardening & Fail2ban
# ============================================================================
if ! done_step "04-ssh"; then
  step "4/16 — SSH Hardening & Fail2ban"
  SSHD_CONF="/etc/ssh/sshd_config"
  cp -n "$SSHD_CONF" "${SSHD_CONF}.bak" 2>/dev/null || true
  if [[ ! -f "/home/${MAIN_USER}/.ssh/authorized_keys" ]]; then
    mkdir -p "/home/${MAIN_USER}/.ssh"
    ssh-keygen -t ed25519 -f "/home/${MAIN_USER}/.ssh/id_ed25519" -N "" -q
    cp "/home/${MAIN_USER}/.ssh/id_ed25519.pub" "/home/${MAIN_USER}/.ssh/authorized_keys"
    chown -R "${MAIN_USER}:${MAIN_USER}" "/home/${MAIN_USER}/.ssh"
    chmod 700 "/home/${MAIN_USER}/.ssh"; chmod 600 "/home/${MAIN_USER}/.ssh/authorized_keys"
    warn "SSH key at /home/${MAIN_USER}/.ssh/id_ed25519 — copy to laptop before disabling password auth"
  fi
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
  sed -i 's/^#\?X11Forwarding.*/X11Forwarding no/' "$SSHD_CONF"
  sed -i 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' "$SSHD_CONF"
  systemctl restart sshd

  cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
EOF
  systemctl enable fail2ban; systemctl restart fail2ban
  log "SSH hardened + fail2ban active (5 fails = 1hr ban)"
  mark_step "04-ssh"
else
  log "4/16 — SSH & Fail2ban (done)"
fi

# ============================================================================
# 5/16 — Unattended Security Updates
# ============================================================================
if ! done_step "05-autoupdate"; then
  step "5/16 — Unattended Security Updates"
  cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  log "Auto security patches enabled"
  mark_step "05-autoupdate"
else
  log "5/16 — Auto updates (done)"
fi

# ============================================================================
# 6/16 — Service User & Directories
# ============================================================================
if ! done_step "06-dirs"; then
  step "6/16 — Service User & Directories"
  id -u copyparty &>/dev/null || /usr/sbin/useradd -r -s /usr/sbin/nologin -m -d /var/lib/copyparty copyparty
  mkdir -p /storage/pool/{movies,tv,music,photos,memes,docs}
  mkdir -p /staging
  mkdir -p /staging/vault/{alice,bob,sil}
  mkdir -p /staging/shared/{work,baking}
  mkdir -p /staging/public/{movies,tv,music,photos,unknown}
  mkdir -p /incoming/{movies,tv,music,photos,memes,docs,unknown,anonymous}
  mkdir -p /incoming/.archive /incoming/.quarantine
  mkdir -p /users/{alice,bob,sil}/private /shares /storage/drive{1,2,3,4,5,6,7,8}
  mkdir -p /shares/alice-bob-work /shares/alice-sil-baking
  chown -R copyparty:copyparty /storage/pool /incoming /users /shares /staging
  # Pre-create log files the copyparty user needs to write to
  for logf in /var/log/personal-cloud-api.log /var/log/copyparty-hooks.log /var/log/quarantine-scan.log /var/log/scanner-worker.log; do
    touch "$logf"; chown copyparty:copyparty "$logf"
  done
  log "Directories created"
  mark_step "06-dirs"
else
  log "6/16 — Directories (done)"
fi

# ============================================================================
# 7/16 — Detect & Format Drives
# ============================================================================
step "7/16 — Detect & Format Drives"
echo ""; lsblk -d -o NAME,SIZE,MODEL,TRAN,FSTYPE | grep -v "loop\|sr\|nvme0n1" || true; echo ""
UNFORMATTED=$(lsblk -drnpo NAME,FSTYPE,TRAN 2>/dev/null | awk '$3=="sata" && $2=="" {print $1}')
if [[ -n "${UNFORMATTED:-}" ]]; then
  echo "  Unformatted SATA drives:"
  for d in $UNFORMATTED; do echo "    $d $(lsblk -drno SIZE "$d") $(lsblk -drno MODEL "$d" | xargs)"; done
  ask "Format as ext4 and add to pool? (y/N): " FMT
  if [[ "${FMT,,}" == "y" ]]; then
    DN=1; while mountpoint -q "/storage/drive${DN}" 2>/dev/null; do ((DN++)); done
    for d in $UNFORMATTED; do
      mkfs.ext4 -q -L "drive${DN}" "$d"
      UUID=$(blkid -s UUID -o value "$d")
      echo "UUID=${UUID}  /storage/drive${DN}  ext4  defaults,nofail  0  2" >> /etc/fstab
      mount "/storage/drive${DN}"; chown copyparty:copyparty "/storage/drive${DN}"
      log "$d -> /storage/drive${DN}"; ((DN++))
    done
  fi
else
  warn "No unformatted SATA drives — connect HBA drives and re-run this step"
fi

# ============================================================================
# 8/16 — MergerFS
# ============================================================================
if ! done_step "08-mergerfs"; then
  step "8/16 — MergerFS"
  if ! grep -q "fuse.mergerfs" /etc/fstab; then
    echo "/storage/drive*  /storage/pool  fuse.mergerfs  defaults,allow_other,use_ino,cache.files=off,dropcacheonclose=true,category.create=mfs,moveonenospc=true,minfreespace=10G,fsname=mergerfs  0  0" >> /etc/fstab
    mount /storage/pool 2>/dev/null || true
    log "MergerFS configured"
  else
    log "MergerFS already in fstab"
  fi
  mark_step "08-mergerfs"
else
  log "8/16 — MergerFS (done)"
fi

# ============================================================================
# 9/16 — Clone Repo & Install copyparty
# ============================================================================
if ! done_step "09-copyparty-install"; then
  step "9/16 — Clone Repo & Install copyparty"
  if [[ -d "$INSTALL_DIR" ]]; then cd "$INSTALL_DIR" && git pull -q; else git clone -q "$GITHUB_REPO" "$INSTALL_DIR"; fi
  mkdir -p "$COPYPARTY_DIR"/{config,custom-ui,hooks}
  CPVER=$(curl -s https://api.github.com/repos/9001/copyparty/releases/latest | jq -r '.tag_name')
  [[ ! -f "$COPYPARTY_DIR/copyparty-sfx.py" ]] && wget -q "https://github.com/9001/copyparty/releases/download/${CPVER}/copyparty-sfx.py" -O "$COPYPARTY_DIR/copyparty-sfx.py" && chmod +x "$COPYPARTY_DIR/copyparty-sfx.py"
  cp "$INSTALL_DIR/hooks/"*.py "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
  cp "$INSTALL_DIR/hooks/"*.yar "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
  
  
  mkdir -p /opt/yara-rules; cp "$COPYPARTY_DIR/hooks/"*.yar /opt/yara-rules/ 2>/dev/null || true
  log "copyparty ${CPVER} + hooks deployed"
  mark_step "09-copyparty-install"
else
  log "9/16 — copyparty install (done)"
fi

# ============================================================================
# 10/16 — Platform Identity & copyparty Config (generated from users table)
# ============================================================================
if ! done_step "10-copyparty-config"; then
  step "10/16 — Platform Identity & copyparty Config"
  # DB schema + admin account (identity source of truth)
  python3 - << 'PYINIT'
import sys
sys.path.insert(0, "/opt/personal-cloud/server")
import db
db.init_db()
print("schema initialized")
PYINIT
  if ! python3 -c "
import sys; sys.path.insert(0,'/opt/personal-cloud/server'); import db
sys.exit(0 if db.get_user('admin') else 1)"; then
    ask "Set platform admin password: " APW
    PC_ADMIN_PW="$APW" python3 /opt/personal-cloud/server/app.py --init-admin
  else
    log "admin user exists"
  fi
  # generate copyparty.conf from the users table (accounts + volumes + staging)
  python3 /opt/personal-cloud/server/sync_copyparty.py || warn "copyparty sync deferred (service not up yet)"
  chown -R copyparty:copyparty /opt/copyparty /staging /users 2>/dev/null || true
  log "identity + copyparty config generated"
  warn "Add more users later via the PWA (admin) or: curl -X POST /api/users"
  mark_step "10-copyparty-config"
else
  log "10/16 — Identity & config (done)"
fi

# ============================================================================
# 11/16 — Deploy PWA (no build step — plain static files)
# ============================================================================
if ! done_step "11-pwa"; then
  step "11/16 — Deploy PWA"
  # PWA is served by personal-cloud-api directly from /opt/personal-cloud/pwa
  [[ -d /opt/personal-cloud/pwa ]] && log "PWA in place (served on :5001)" || warn "PWA dir missing"
  mark_step "11-pwa"
else
  log "11/16 — PWA (done)"
fi

# ============================================================================
# 12/16 — Quarantine Pipeline & ClamAV
# ============================================================================
if ! done_step "12-quarantine"; then
  step "12/16 — Quarantine Pipeline & ClamAV"

  # noexec on /incoming
  if ! mount | grep -q "/incoming.*noexec"; then
    if ! grep -q "/incoming.*noexec" /etc/fstab; then
      echo "/incoming  /incoming  none  bind,noexec,nosuid,nodev  0  0" >> /etc/fstab
      mount -o remount,bind,noexec,nosuid,nodev /incoming 2>/dev/null || true
    fi
    log "/incoming mounted with noexec,nosuid,nodev"
  fi

  # ClamAV YARA config
  CLAMD_CONF="/etc/clamav/clamd.conf"
  if [[ -f "$CLAMD_CONF" ]]; then
    grep -q "^OfficialDatabaseOnly no" "$CLAMD_CONF" || \
      sed -i 's/^OfficialDatabaseOnly.*/OfficialDatabaseOnly no/' "$CLAMD_CONF" 2>/dev/null || \
      echo "OfficialDatabaseOnly no" >> "$CLAMD_CONF"
  fi

  # Scan wrapper
  cat > "$COPYPARTY_DIR/hooks/scan-file.sh" << 'SCANEOF'
#!/bin/bash
FILE="$1"
LOGFILE="/var/log/quarantine-scan.log"
CLAM_RESULT=$(clamscan --infected --remove=no --no-summary "$FILE" 2>/dev/null)
CLAM_EXIT=$?
YARA_RESULT=$(yara -r /opt/yara-rules/*.yar "$FILE" 2>/dev/null)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
if [[ $CLAM_EXIT -ne 0 ]]; then
  echo "${TIMESTAMP} INFECTED [ClamAV] ${FILE}: ${CLAM_RESULT}" >> "$LOGFILE"; exit 1
fi
if [[ -n "$YARA_RESULT" ]]; then
  echo "${TIMESTAMP} SUSPICIOUS [YARA] ${FILE}: ${YARA_RESULT}" >> "$LOGFILE"; exit 1
fi
echo "${TIMESTAMP} CLEAN ${FILE}" >> "$LOGFILE"; exit 0
SCANEOF
  chmod +x "$COPYPARTY_DIR/hooks/scan-file.sh"

  # Upload hook
  cat > "$COPYPARTY_DIR/hooks/xau-hook.py" << 'XAUEOF'
#!/usr/bin/env python3
"""copyparty after-upload hook — categorize -> scan -> quarantine/promote"""
import sys, os, subprocess, hashlib, shutil, time, logging, json

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

CATEGORY_MAP = {
    "movies": {".mkv",".mp4",".avi",".m4v",".mov",".wmv"},
    "tv": set(),
    "music": {".mp3",".flac",".ogg",".m4a",".wav",".opus",".aac"},
    "photos": {".jpg",".jpeg",".png",".gif",".webp",".heic",".heif",".raw",".cr2",".bmp"},
    "docs": {".pdf",".docx",".xlsx",".txt",".md",".odt",".epub",".csv",".pptx"},
    "memes": set(),
}

def categorize(filename):
    ext = os.path.splitext(filename)[1].lower()
    for cat, exts in CATEGORY_MAP.items():
        if ext in exts: return cat
    return "unknown"

def archive_copy(src, category):
    archive_dir = f"/incoming/.archive/{category}"
    os.makedirs(archive_dir, exist_ok=True)
    ts = int(time.time())
    short = hashlib.md5(os.path.basename(src).encode()).hexdigest()[:8]
    dst = f"{archive_dir}/{ts}-{short}-{os.path.basename(src)}"
    shutil.copy2(src, dst)
    try: subprocess.run(["chattr", "+i", dst], check=True, capture_output=True)
    except Exception: pass
    return dst

def promote(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst); os.remove(src)
    logging.info(f"PROMOTED {src} -> {dst}")

def quarantine(src):
    q_dir = "/incoming/.quarantine"
    os.makedirs(q_dir, exist_ok=True)
    shutil.move(src, f"{q_dir}/{os.path.basename(src)}")
    logging.warning(f"QUARANTINED {src}")

def main():
    if len(sys.argv) < 2:
        sys.exit(0)

    # copyparty sends JSON (we pass the 'j' flag). Parse it.
    raw = sys.argv[1]
    try:
        info = json.loads(raw)
        filepath = info.get("ap")        # absolute path on disk
        vpath = info.get("vp", "")        # virtual path (vault/bob/foo.pdf)
        user = info.get("user", "?")
        size = info.get("sz", 0)
        ip = info.get("ip", "?")
    except (json.JSONDecodeError, AttributeError):
        # Fallback: treat argv[1] as a bare filepath
        filepath = raw
        vpath = filepath
        user = ip = "?"
        size = 0

    if not filepath or not os.path.exists(filepath):
        logging.error(f"File not found on disk: {filepath}")
        sys.exit(0)

    filename = os.path.basename(filepath)

    # Scan the file IN PLACE — do not relocate the user's upload.
    scan_result = subprocess.run(
        ["/opt/copyparty/hooks/scan-file.sh", filepath],
        capture_output=True
    )

    if scan_result.returncode != 0:
        # Infected or suspicious — quarantine it OUT of the user's space
        quarantine(filepath)
        logging.warning(f"BLOCKED+QUARANTINED user={user} vp={vpath} ({size}b from {ip})")
        sys.exit(0)

    # Clean — leave it where the user put it, just log the audit trail
    logging.info(f"CLEAN user={user} vp={vpath} ({size}b from {ip})")
    sys.exit(0)

if __name__ == "__main__": main()
XAUEOF
  chmod +x "$COPYPARTY_DIR/hooks/xau-hook.py"
  chown -R copyparty:copyparty "$COPYPARTY_DIR/hooks"

  # AppArmor
  cat > /etc/apparmor.d/opt.copyparty << 'AAEOF'
#include <tunables/global>
/opt/copyparty/copyparty-sfx.py {
  #include <abstractions/base>
  #include <abstractions/python>
  #include <abstractions/nameservice>
  /opt/copyparty/** r,
  /opt/copyparty/hooks/** rx,
  /opt/copyparty/custom-ui/** r,
  /opt/copyparty/config/** r,
  /storage/pool/** rw,
  /incoming/** rw,
  /users/** rw,
  /shares/** rw,
  /usr/bin/python3 ix,
  /usr/bin/clamscan px,
  /usr/bin/yara px,
  deny /etc/shadow r,
  deny /etc/passwd w,
  deny /root/** rw,
  deny /boot/** rw,
  network inet stream,
  network inet dgram,
}
AAEOF
  apparmor_parser -r /etc/apparmor.d/opt.copyparty 2>/dev/null || warn "AppArmor profile load failed"

  # ClamAV signatures
  systemctl stop clamav-freshclam 2>/dev/null || true
  freshclam 2>/dev/null || warn "freshclam failed — retries via cron"
  systemctl enable clamav-freshclam; systemctl start clamav-freshclam
  log "Quarantine pipeline configured"
  mark_step "12-quarantine"
else
  log "12/16 — Quarantine pipeline (done)"
fi

# ============================================================================
# 13/16 — WireGuard
# ============================================================================
if ! done_step "13-wireguard"; then
  step "13/16 — WireGuard"
  CURRENT_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)192\.168\.\d+\.\d+' | head -1)
  CURRENT_IP=${CURRENT_IP:-192.168.0.64}
  mkdir -p /etc/wireguard
  if [[ ! -f /etc/wireguard/server_private.key ]]; then
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
    SK=$(cat /etc/wireguard/server_private.key); SP=$(cat /etc/wireguard/server_public.key)
    for i in 1 2 3; do
      wg genkey | tee "/etc/wireguard/client${i}_private.key" | wg pubkey > "/etc/wireguard/client${i}_public.key"
      chmod 600 "/etc/wireguard/client${i}_private.key"
    done
    NIF=$(ip route show default | awk '{print $5}' | head -1)
    cat > /etc/wireguard/wg0.conf << WGEOF
[Interface]
Address = 10.200.200.1/24
ListenPort = 51820
PrivateKey = ${SK}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NIF} -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NIF} -j MASQUERADE
[Peer]
PublicKey = $(cat /etc/wireguard/client1_public.key)
AllowedIPs = 10.200.200.2/32
[Peer]
PublicKey = $(cat /etc/wireguard/client2_public.key)
AllowedIPs = 10.200.200.3/32
[Peer]
PublicKey = $(cat /etc/wireguard/client3_public.key)
AllowedIPs = 10.200.200.4/32
WGEOF
    chmod 600 /etc/wireguard/wg0.conf
    for i in 1 2 3; do
      cat > "/etc/wireguard/client${i}.conf" << CLEOF
[Interface]
PrivateKey = $(cat "/etc/wireguard/client${i}_private.key")
Address = 10.200.200.$((i+1))/32
DNS = ${CURRENT_IP}
[Peer]
PublicKey = ${SP}
AllowedIPs = 0.0.0.0/0
Endpoint = REPLACE_WITH_PUBLIC_IP:51820
PersistentKeepalive = 25
CLEOF
    done
    log "WireGuard keys + configs generated"
    echo ""; echo "  Phone QR (client1):"; echo ""
    qrencode -t ansiutf8 < /etc/wireguard/client1.conf 2>/dev/null || warn "qrencode not available"
    echo ""; warn "Update Endpoint in client configs to public IP before remote use"
  fi
  grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf || { echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf; sysctl -p >/dev/null; }
  mark_step "13-wireguard"
else
  log "13/16 — WireGuard (done)"
fi

# ============================================================================
# 14/16 — Firewall (nftables)
# ============================================================================
if ! done_step "14-firewall"; then
  step "14/16 — Firewall (nftables)"
  cat > /etc/nftables.conf << 'NFTEOF'
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        iifname "lo" accept
        ip protocol icmp accept
        ip6 nexthdr icmpv6 accept
        tcp dport 22 accept
        tcp dport 80 accept
        tcp dport 3923 accept
        tcp dport 5001 accept
        udp dport 51820 accept
        tcp dport 8096 accept
        log prefix "nft-drop: " drop
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
        iifname "wg0" accept
        oifname "wg0" ct state established,related accept
    }
    chain output { type filter hook output priority 0; policy accept; }
}
NFTEOF
  systemctl enable nftables; nft -f /etc/nftables.conf
  log "Firewall active"
  mark_step "14-firewall"
else
  log "14/16 — Firewall (done)"
fi

# ============================================================================
# 15/16 — Systemd Services & Cron
# ============================================================================
if ! done_step "15-services"; then
  step "15/16 — Systemd Services & Cron"
  # Units are version-controlled in config/ — copy, don't inline
  cp "$INSTALL_DIR/config/copyparty.service"          /etc/systemd/system/
  cp "$INSTALL_DIR/config/personal-cloud-api.service" /etc/systemd/system/
  cp "$INSTALL_DIR/config/scanner-worker.service"     /etc/systemd/system/
  rm -f /etc/systemd/system/share-manager.service   # absorbed into personal-cloud-api
  command -v jellyfin &>/dev/null && usermod -aG copyparty jellyfin 2>/dev/null || true
  systemctl daemon-reload
  systemctl disable share-manager 2>/dev/null || true
  for svc in copyparty personal-cloud-api scanner-worker wg-quick@wg0; do
    systemctl enable "$svc"; systemctl restart "$svc" 2>/dev/null || warn "$svc failed — check journalctl"
  done

  cat > /etc/cron.d/personal-cloud << 'EOF'
5 1 * * *   root  rsync -a --delete /storage/pool/ /mnt/backup/ 2>/dev/null || true
30 1 * * *  root  clamscan -r --infected --remove=no --log=/var/log/clamav-pool.log /storage/pool/ 2>&1
0 2 * * *   root  freshclam >> /var/log/freshclam-cron.log 2>&1
30 2 * * *  root  btrfs scrub start /incoming 2>/dev/null || true
0 3 * * *   root  find /incoming/.archive -mtime +90 -exec chattr -i {} \; -delete 2>/dev/null || true
0 * * * *   copyparty  /usr/bin/python3 /opt/copyparty/hooks/share-expiry.py 2>/dev/null || true
0 4 * * 0   root  smartctl -a /dev/nvme0 >> /var/log/smart-nvme.log 2>&1
EOF
  log "Services enabled + cron jobs set"
  mark_step "15-services"
else
  log "15/16 — Services & cron (done)"
fi

# ============================================================================
# 16/16 — Network Config (DEFERRED — prepared but NOT applied)
# ============================================================================
step "16/16 — Network Config (deferred)"
CURRENT_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)192\.168\.\d+\.\d+' | head -1)
GATEWAY=$(ip route show default | awk '{print $3}' | head -1)
ETH_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^en' | head -1 || echo "none")
WIFI_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^wl' | head -1 || echo "none")
ACTIVE_IF=$(ip route show default | awk '{print $5}' | head -1)

echo ""
echo "  Current connection: ${ACTIVE_IF} (${CURRENT_IP})"
echo "  Ethernet interface: ${ETH_IF}"
echo "  WiFi interface:     ${WIFI_IF}"
echo ""

if [[ "$ACTIVE_IF" == "$WIFI_IF" ]]; then
  warn "You're on WiFi. When you plug in Ethernet and reboot:"
  warn "  1. WiFi will be disabled automatically"
  warn "  2. Server gets static IP on Ethernet"
fi

ask "Static IP to assign [${CURRENT_IP}]: " STATIC_IP
STATIC_IP=${STATIC_IP:-$CURRENT_IP}
ask "Gateway [${GATEWAY}]: " GW
GW=${GW:-$GATEWAY}

# Write config files but do NOT apply them yet
if [[ "$ETH_IF" != "none" ]]; then
  cat > /etc/network/interfaces.d/static-eth << NETEOF
auto ${ETH_IF}
iface ${ETH_IF} inet static
    address ${STATIC_IP}
    netmask 255.255.255.0
    gateway ${GW}
    dns-nameservers 1.1.1.1
NETEOF
fi

# WiFi disable script — runs on next boot if Ethernet is up
cat > /usr/local/bin/disable-wifi-if-eth.sh << 'WIFISCRIPT'
#!/bin/bash
# If Ethernet has a carrier, disable WiFi
ETH=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^en' | head -1)
if [[ -n "$ETH" ]] && [[ $(cat /sys/class/net/$ETH/carrier 2>/dev/null) == "1" ]]; then
  WIFI=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^wl' | head -1)
  [[ -n "$WIFI" ]] && ip link set "$WIFI" down
fi
WIFISCRIPT
chmod +x /usr/local/bin/disable-wifi-if-eth.sh

# Systemd oneshot to run at boot
cat > /etc/systemd/system/disable-wifi.service << 'EOF'
[Unit]
Description=Disable WiFi if Ethernet is connected
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/disable-wifi-if-eth.sh
[Install]
WantedBy=multi-user.target
EOF
systemctl enable disable-wifi.service 2>/dev/null

log "Network config written (NOT applied yet)"
warn "Static IP + WiFi disable activate on next reboot with Ethernet plugged in"

# ============================================================================
# Health Check
# ============================================================================
step "Health Check"
echo "  NVMe:"; smartctl -a /dev/nvme0 2>/dev/null | grep -E "Percentage|Error|Critical" || warn "NVMe not at /dev/nvme0"
echo "  HBA:"; lspci | grep -iE "LSI|SAS" 2>/dev/null || warn "No HBA detected — install riser + card"
echo "  Services:"
for s in copyparty personal-cloud-api scanner-worker wg-quick@wg0 clamav-freshclam jellyfin fail2ban nftables; do
  ST=$(systemctl is-active "$s" 2>/dev/null || echo "off")
  [[ "$ST" == "active" ]] && echo -e "    ${GREEN}●${NC} $s" || echo -e "    ${RED}○${NC} $s"
done

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Personal Cloud — Setup Complete${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  PWA:        http://${CURRENT_IP}:5001"
  echo "  copyparty:  http://${CURRENT_IP}:3923"
echo "  Jellyfin:   http://${CURRENT_IP}:8096"
echo "  WG clients: /etc/wireguard/client{1,2,3}.conf"
echo "  SSH:        ssh main@${CURRENT_IP}"
echo ""
echo "  When ready to go permanent:"
echo "    1. Plug in Ethernet cable"
echo "    2. Reboot: sudo reboot"
echo "    3. SSH to new static IP: ssh main@${STATIC_IP}"
echo "    4. BIOS: enable 'power on after AC loss'"
echo "    5. Copy SSH key to laptop, then disable password auth:"
echo "       sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd"
echo "    6. Update WG Endpoint in client configs to public IP"
echo "    7. Configure Jellyfin via http://${STATIC_IP}:8096"
echo ""
