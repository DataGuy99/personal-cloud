#!/usr/bin/env bash
# ============================================================================
# Personal Cloud Server Bootstrap
# Run on a fresh Debian 12 install as root
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DataGuy99/personal-cloud/main/setup/bootstrap.sh -o bootstrap.sh
#   chmod +x bootstrap.sh
#   sudo ./bootstrap.sh
# ============================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# --- Preflight ---
[[ $EUID -ne 0 ]] && err "Run as root: sudo ./bootstrap.sh"
[[ ! -f /etc/debian_version ]] && err "This script is for Debian"

GITHUB_REPO="https://github.com/DataGuy99/personal-cloud.git"
INSTALL_DIR="/opt/personal-cloud"
COPYPARTY_DIR="/opt/copyparty"
POOL_DIR="/storage/pool"
INCOMING_DIR="/incoming"

step "Phase 1: System Update"
apt update && apt upgrade -y
log "System updated"

step "Phase 2: Install Packages"
apt install -y \
  git curl wget \
  python3 python3-pip python3-venv python3-flask \
  smartmontools nvme-cli \
  mergerfs \
  btrfs-progs \
  wireguard wireguard-tools \
  clamav clamav-daemon clamav-freshclam \
  yara \
  nftables \
  apparmor apparmor-utils \
  sudo htop tmux rsync \
  unzip jq \
  --no-install-recommends

log "Core packages installed"

# Node.js (for PWA build)
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
  log "Node.js installed"
else
  log "Node.js already present"
fi

step "Phase 3: Create Service User"
if ! id -u copyparty &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -m -d /var/lib/copyparty copyparty
  log "User 'copyparty' created"
else
  log "User 'copyparty' already exists"
fi

step "Phase 4: Create Directory Structure"
# Pool directories
mkdir -p "$POOL_DIR"/{movies,tv,music,photos,memes,docs}

# Incoming buffer (Btrfs if available, ext4 fallback)
mkdir -p "$INCOMING_DIR"/{movies,tv,music,photos,memes,docs,unknown,anonymous}
mkdir -p "$INCOMING_DIR"/.archive
mkdir -p "$INCOMING_DIR"/.quarantine

# User vaults
mkdir -p /users/{alice,bob,sil}/{private}

# Shares
mkdir -p /shares

# Storage mount points
mkdir -p /storage/drive{1,2,3,4,5,6,7,8}

# Set ownership
chown -R copyparty:copyparty "$POOL_DIR" "$INCOMING_DIR" /users /shares

log "Directory structure created"

step "Phase 5: Clone Repository"
if [[ -d "$INSTALL_DIR" ]]; then
  cd "$INSTALL_DIR" && git pull
  log "Repository updated"
else
  git clone "$GITHUB_REPO" "$INSTALL_DIR"
  log "Repository cloned"
fi

step "Phase 6: Install copyparty"
mkdir -p "$COPYPARTY_DIR"/{config,custom-ui,hooks}

# Download latest copyparty SFX
COPYPARTY_VERSION=$(curl -s https://api.github.com/repos/9001/copyparty/releases/latest | jq -r '.tag_name')
COPYPARTY_URL="https://github.com/9001/copyparty/releases/download/${COPYPARTY_VERSION}/copyparty-sfx.py"

if [[ ! -f "$COPYPARTY_DIR/copyparty-sfx.py" ]]; then
  wget -q "$COPYPARTY_URL" -O "$COPYPARTY_DIR/copyparty-sfx.py"
  chmod +x "$COPYPARTY_DIR/copyparty-sfx.py"
  log "copyparty ${COPYPARTY_VERSION} downloaded"
else
  log "copyparty already present"
fi

step "Phase 7: Deploy Configs & Hooks"
# Copy configs from repo
cp "$INSTALL_DIR/config/copyparty.conf" "$COPYPARTY_DIR/config/"
cp "$INSTALL_DIR/config/copyparty.service" /etc/systemd/system/

# Copy hooks
cp "$INSTALL_DIR/hooks/"*.py "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
cp "$INSTALL_DIR/hooks/"*.yar "$COPYPARTY_DIR/hooks/" 2>/dev/null || true

# Copy share manager
if [[ -f "$INSTALL_DIR/share-manager/schema.sql" ]]; then
  cp "$INSTALL_DIR/share-manager/schema.sql" "$COPYPARTY_DIR/hooks/"
fi

# Create secrets env file
if [[ ! -f "$COPYPARTY_DIR/config/secrets.env" ]]; then
  cat > "$COPYPARTY_DIR/config/secrets.env" << 'SECRETS'
# VirusTotal API key (get free key at https://www.virustotal.com)
VT_API_KEY=
SECRETS
  chmod 600 "$COPYPARTY_DIR/config/secrets.env"
  chown copyparty:copyparty "$COPYPARTY_DIR/config/secrets.env"
  warn "Edit /opt/copyparty/config/secrets.env to add your VT API key"
fi

# Set ownership
chown -R copyparty:copyparty "$COPYPARTY_DIR"

log "Configs and hooks deployed"

step "Phase 8: Build PWA"
if [[ -d "$INSTALL_DIR/pwa" ]]; then
  cd "$INSTALL_DIR/pwa"
  npm install --production=false 2>/dev/null || warn "PWA npm install failed -- may need manual build"
  if npm run build 2>/dev/null; then
    cp -r dist/* "$COPYPARTY_DIR/custom-ui/" 2>/dev/null || true
    log "PWA built and deployed"
  else
    warn "PWA build failed -- run manually: cd $INSTALL_DIR/pwa && npm run build"
  fi
else
  warn "PWA directory not found in repo"
fi

step "Phase 9: Configure ClamAV"
systemctl stop clamav-freshclam 2>/dev/null || true
freshclam || warn "freshclam update failed -- will retry on next boot"
systemctl enable clamav-freshclam
systemctl start clamav-freshclam
log "ClamAV configured"

# Deploy YARA rules
mkdir -p /opt/yara-rules
cp "$COPYPARTY_DIR/hooks/"*.yar /opt/yara-rules/ 2>/dev/null || true
log "YARA rules deployed"

step "Phase 10: Configure WireGuard"
mkdir -p /etc/wireguard
if [[ ! -f /etc/wireguard/server_private.key ]]; then
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
  chmod 600 /etc/wireguard/server_private.key

  SERVER_PRIVKEY=$(cat /etc/wireguard/server_private.key)
  SERVER_PUBKEY=$(cat /etc/wireguard/server_public.key)

  # Generate client keys
  for i in 1 2 3; do
    wg genkey | tee "/etc/wireguard/client${i}_private.key" | wg pubkey > "/etc/wireguard/client${i}_public.key"
    chmod 600 "/etc/wireguard/client${i}_private.key"
  done

  CLIENT1_PUBKEY=$(cat /etc/wireguard/client1_public.key)
  CLIENT2_PUBKEY=$(cat /etc/wireguard/client2_public.key)
  CLIENT3_PUBKEY=$(cat /etc/wireguard/client3_public.key)

  # Server config
  cat > /etc/wireguard/wg0.conf << WGEOF
[Interface]
Address = 10.200.200.1/24
ListenPort = 51820
PrivateKey = ${SERVER_PRIVKEY}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o \$(ip route show default | awk '{print \$5}') -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o \$(ip route show default | awk '{print \$5}') -j MASQUERADE

[Peer]
# Client 1 (Phone)
PublicKey = ${CLIENT1_PUBKEY}
AllowedIPs = 10.200.200.2/32

[Peer]
# Client 2 (Laptop)
PublicKey = ${CLIENT2_PUBKEY}
AllowedIPs = 10.200.200.3/32

[Peer]
# Client 3 (Spare)
PublicKey = ${CLIENT3_PUBKEY}
AllowedIPs = 10.200.200.4/32
WGEOF

  chmod 600 /etc/wireguard/wg0.conf

  # Generate client configs
  SERVER_IP=$(hostname -I | awk '{print $1}')
  for i in 1 2 3; do
    CLIENT_PRIVKEY=$(cat "/etc/wireguard/client${i}_private.key")
    CLIENT_IP="10.200.200.$((i+1))"
    cat > "/etc/wireguard/client${i}.conf" << CLIENTEOF
[Interface]
PrivateKey = ${CLIENT_PRIVKEY}
Address = ${CLIENT_IP}/32
DNS = ${SERVER_IP}

[Peer]
PublicKey = ${SERVER_PUBKEY}
AllowedIPs = 0.0.0.0/0
Endpoint = ${SERVER_IP}:51820
PersistentKeepalive = 25
CLIENTEOF
  done

  log "WireGuard keys generated"
  log "Server public key: ${SERVER_PUBKEY}"
  log "Client configs: /etc/wireguard/client{1,2,3}.conf"
  warn "Update client Endpoint to your public IP or Proton VPN forwarded port"
else
  log "WireGuard already configured"
fi

# Enable IP forwarding
if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf; then
  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
  sysctl -p
fi

step "Phase 11: Enable Services"
systemctl daemon-reload

# copyparty
systemctl enable copyparty.service
systemctl start copyparty.service 2>/dev/null || warn "copyparty failed to start -- check config"

# WireGuard
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0 2>/dev/null || warn "WireGuard failed to start"

log "Services enabled"

step "Phase 12: Configure Cron Jobs"
cat > /etc/cron.d/personal-cloud << 'CRONEOF'
# Nighttime maintenance window
5 1 * * *   root  rsync -a /storage/pool/ /mnt/backup/ 2>/dev/null || true
30 1 * * *  root  clamscan -r --infected --remove=no /storage/pool/ >> /var/log/clamav-pool.log 2>&1
0 2 * * *   root  freshclam >> /var/log/freshclam-cron.log 2>&1
30 2 * * *  root  btrfs scrub start /incoming 2>/dev/null || true
0 3 * * *   root  find /var/log -name '*.gz' -mtime +30 -delete
0 * * * *   root  /usr/bin/python3 /opt/copyparty/hooks/share-expiry.py 2>/dev/null || true
CRONEOF

log "Cron jobs configured"

step "Phase 13: NVMe & HBA Health Check"
echo ""
echo "--- NVMe Boot Drive ---"
smartctl -a /dev/nvme0 2>/dev/null | grep -E "Percentage Used|Data Units|Media.*Error|Critical Warning" || warn "NVMe not detected at /dev/nvme0"

echo ""
echo "--- HBA Detection ---"
if lspci | grep -i "LSI\|SAS\|MegaRAID" &>/dev/null; then
  log "HBA detected:"
  lspci | grep -i "LSI\|SAS\|MegaRAID"
  echo ""
  echo "--- SATA drives on HBA ---"
  lsblk -d -o NAME,SIZE,MODEL,TRAN | grep sata || echo "  No SATA drives connected yet"
else
  warn "No HBA detected -- install PCIe riser + LSI 9207-8i"
fi

step "Setup Complete"
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Personal Cloud Server Ready${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  copyparty:    http://$(hostname -I | awk '{print $1}'):80"
echo "  WireGuard:    wg show"
echo "  Configs:      /opt/copyparty/config/"
echo "  Data pool:    /storage/pool/"
echo "  Repo:         /opt/personal-cloud/"
echo ""
echo "  Next steps:"
echo "    1. Set copyparty passwords:"
echo "       python3 /opt/copyparty/copyparty-sfx.py -hp YOUR_PASSWORD"
echo "       Edit /opt/copyparty/config/copyparty.conf with the hashes"
echo "       systemctl restart copyparty"
echo ""
echo "    2. Add VT API key:"
echo "       Edit /opt/copyparty/config/secrets.env"
echo ""
echo "    3. Connect drives to HBA:"
echo "       Format: mkfs.ext4 /dev/sdX"
echo "       Mount:  mount /dev/sdX /storage/driveN"
echo "       Add to /etc/fstab with UUID"
echo ""
echo "    4. Import client WireGuard configs:"
echo "       /etc/wireguard/client1.conf (phone)"
echo "       /etc/wireguard/client2.conf (laptop)"
echo ""
echo "    5. Update repo anytime:"
echo "       cd /opt/personal-cloud && git pull"
echo ""
