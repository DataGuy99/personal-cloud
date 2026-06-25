#!/usr/bin/env bash
# ============================================================================
# Personal Cloud Server — Full Bootstrap
# For Debian 12 on Lenovo ThinkCentre M920q
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DataGuy99/personal-cloud/main/setup/bootstrap.sh -o bootstrap.sh
#   chmod +x bootstrap.sh
#   sudo ./bootstrap.sh
# ============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ask()  { read -rp "$(echo -e "${CYAN}[?]${NC} $1")" "$2"; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo ./bootstrap.sh"
[[ ! -f /etc/debian_version ]] && err "Debian only"

GITHUB_REPO="https://github.com/DataGuy99/personal-cloud.git"
INSTALL_DIR="/opt/personal-cloud"
COPYPARTY_DIR="/opt/copyparty"

step "1/18 — Hostname & Timezone"
CURRENT_HOSTNAME=$(hostname)
ask "Hostname [${CURRENT_HOSTNAME}]: " NEW_HOSTNAME
NEW_HOSTNAME=${NEW_HOSTNAME:-$CURRENT_HOSTNAME}
hostnamectl set-hostname "$NEW_HOSTNAME"
sed -i "s/127\.0\.1\.1.*$/127.0.1.1\t${NEW_HOSTNAME}/" /etc/hosts
timedatectl set-timezone America/New_York
timedatectl set-ntp true
log "Hostname: $NEW_HOSTNAME | TZ: America/New_York"

step "2/18 — Static IP"
ETH_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^en' | head -1)
CURRENT_IP=$(ip -4 addr show "$ETH_IF" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
GATEWAY=$(ip route show default | awk '{print $3}' | head -1)
echo "  Interface: $ETH_IF | Current: ${CURRENT_IP:-?} | Gateway: ${GATEWAY:-?}"
ask "Static IP [192.168.1.10]: " STATIC_IP
STATIC_IP=${STATIC_IP:-192.168.1.10}
ask "Gateway [${GATEWAY:-192.168.1.1}]: " GW
GW=${GW:-${GATEWAY:-192.168.1.1}}
cat > /etc/network/interfaces.d/static << NETEOF
auto ${ETH_IF}
iface ${ETH_IF} inet static
    address ${STATIC_IP}
    netmask 255.255.255.0
    gateway ${GW}
    dns-nameservers 1.1.1.1
NETEOF
sed -i "/iface ${ETH_IF}/,/^$/d" /etc/network/interfaces 2>/dev/null || true
log "Static IP: ${STATIC_IP}"

step "3/18 — Disable WiFi"
WIFI_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^wl' | head -1)
if [[ -n "${WIFI_IF:-}" ]]; then
  ip link set "$WIFI_IF" down 2>/dev/null || true
  printf "blacklist iwlwifi\nblacklist iwlmvm\n" > /etc/modprobe.d/disable-wifi.conf
  log "WiFi disabled: $WIFI_IF"
else
  log "No WiFi interface"
fi

step "4/18 — System Update & Packages"
apt update && apt upgrade -y
apt install -y git curl wget jq unzip python3 python3-pip python3-venv python3-flask \
  smartmontools nvme-cli mergerfs btrfs-progs wireguard wireguard-tools qrencode \
  clamav clamav-daemon clamav-freshclam yara nftables apparmor apparmor-utils \
  fail2ban unattended-upgrades apt-listchanges sudo htop tmux rsync lsof \
  --no-install-recommends
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
log "All packages installed"

# Jellyfin
if ! command -v jellyfin &>/dev/null; then
  curl -fsSL https://repo.jellyfin.org/install-debuntu.sh | bash
  log "Jellyfin installed"
else
  log "Jellyfin present"
fi

step "5/18 — SSH Hardening"
SSHD_CONF="/etc/ssh/sshd_config"
cp "$SSHD_CONF" "${SSHD_CONF}.bak"
MAIN_USER=$(logname 2>/dev/null || echo "")
if [[ -n "$MAIN_USER" ]] && [[ ! -f "/home/${MAIN_USER}/.ssh/authorized_keys" ]]; then
  mkdir -p "/home/${MAIN_USER}/.ssh"
  ssh-keygen -t ed25519 -f "/home/${MAIN_USER}/.ssh/id_ed25519" -N "" -q
  cp "/home/${MAIN_USER}/.ssh/id_ed25519.pub" "/home/${MAIN_USER}/.ssh/authorized_keys"
  chown -R "${MAIN_USER}:${MAIN_USER}" "/home/${MAIN_USER}/.ssh"
  chmod 700 "/home/${MAIN_USER}/.ssh"; chmod 600 "/home/${MAIN_USER}/.ssh/authorized_keys"
  warn "SSH key at /home/${MAIN_USER}/.ssh/id_ed25519 — copy to client before disabling password auth"
fi
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
sed -i 's/^#\?X11Forwarding.*/X11Forwarding no/' "$SSHD_CONF"
sed -i 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' "$SSHD_CONF"
systemctl restart sshd
log "SSH hardened (root login off, 3 max tries, password auth still on until key copied)"

step "6/18 — Fail2ban"
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
log "Fail2ban: 5 fails = 1hr ban"

step "7/18 — Unattended Security Updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
log "Auto security patches enabled"

step "8/18 — Service User & Directories"
id -u copyparty &>/dev/null || useradd -r -s /usr/sbin/nologin -m -d /var/lib/copyparty copyparty
mkdir -p /storage/pool/{movies,tv,music,photos,memes,docs}
mkdir -p /incoming/{movies,tv,music,photos,memes,docs,unknown,anonymous}
mkdir -p /incoming/.archive /incoming/.quarantine
mkdir -p /users/{alice,bob,sil}/private /shares /storage/drive{1,2,3,4,5,6,7,8}
chown -R copyparty:copyparty /storage/pool /incoming /users /shares
log "Directories created"

step "9/18 — Detect & Format Drives"
echo ""; lsblk -d -o NAME,SIZE,MODEL,TRAN,FSTYPE | grep -v "loop\|sr\|nvme0n1"; echo ""
UNFORMATTED=$(lsblk -drnpo NAME,FSTYPE,TRAN 2>/dev/null | awk '$3=="sata" && $2=="" {print $1}')
if [[ -n "${UNFORMATTED:-}" ]]; then
  echo "  Unformatted SATA drives:"; for d in $UNFORMATTED; do echo "    $d $(lsblk -drno SIZE "$d") $(lsblk -drno MODEL "$d" | xargs)"; done
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
  warn "No unformatted SATA drives — connect to HBA and re-run or format manually"
fi

step "10/18 — MergerFS"
if ! grep -q "fuse.mergerfs" /etc/fstab; then
  echo "/storage/drive*  /storage/pool  fuse.mergerfs  defaults,allow_other,use_ino,cache.files=off,dropcacheonclose=true,category.create=mfs,moveonenospc=true,minfreespace=10G,fsname=mergerfs  0  0" >> /etc/fstab
  mount /storage/pool 2>/dev/null || true
  log "MergerFS configured"
else
  log "MergerFS already in fstab"
fi

step "11/18 — Clone Repo & Install copyparty"
if [[ -d "$INSTALL_DIR" ]]; then cd "$INSTALL_DIR" && git pull -q; else git clone -q "$GITHUB_REPO" "$INSTALL_DIR"; fi
mkdir -p "$COPYPARTY_DIR"/{config,custom-ui,hooks}
CPVER=$(curl -s https://api.github.com/repos/9001/copyparty/releases/latest | jq -r '.tag_name')
[[ ! -f "$COPYPARTY_DIR/copyparty-sfx.py" ]] && wget -q "https://github.com/9001/copyparty/releases/download/${CPVER}/copyparty-sfx.py" -O "$COPYPARTY_DIR/copyparty-sfx.py" && chmod +x "$COPYPARTY_DIR/copyparty-sfx.py"
cp "$INSTALL_DIR/hooks/"*.py "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
cp "$INSTALL_DIR/hooks/"*.yar "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
cp "$INSTALL_DIR/share-manager/schema.sql" "$COPYPARTY_DIR/hooks/" 2>/dev/null || true
mkdir -p /opt/yara-rules; cp "$COPYPARTY_DIR/hooks/"*.yar /opt/yara-rules/ 2>/dev/null || true
log "copyparty ${CPVER} + hooks deployed"

step "12/18 — copyparty Passwords"
echo "  Set passwords for copyparty users. Blank to skip."
declare -A UH
for U in alice bob sil guest; do
  ask "Password for '${U}': " PW
  if [[ -n "${PW:-}" ]]; then
    UH[$U]=$(python3 "$COPYPARTY_DIR/copyparty-sfx.py" -hp "$PW" 2>/dev/null | tail -1)
    log "  $U: set"
  else
    UH[$U]='$2b$12$PLACEHOLDER'; warn "  $U: skipped"
  fi
done
cat > "$COPYPARTY_DIR/config/copyparty.conf" << CPEOF
[global]
  p: 80
  html: /opt/copyparty/custom-ui
[accounts]
  alice: ${UH[alice]}
  bob: ${UH[bob]}
  sil: ${UH[sil]}
  guest: ${UH[guest]}
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
[/drop]
  /incoming/anonymous
  accs:
    w: *
CPEOF
if [[ ! -f "$COPYPARTY_DIR/config/secrets.env" ]]; then
  ask "VirusTotal API key (blank to skip): " VTK
  echo "VT_API_KEY=${VTK:-}" > "$COPYPARTY_DIR/config/secrets.env"
  chmod 600 "$COPYPARTY_DIR/config/secrets.env"
fi
chown -R copyparty:copyparty "$COPYPARTY_DIR"
log "copyparty configured"

step "13/18 — Build PWA"
if [[ -d "$INSTALL_DIR/pwa" ]]; then
  cd "$INSTALL_DIR/pwa" && npm install --silent 2>/dev/null
  if npm run build --silent 2>/dev/null; then
    rm -rf "$COPYPARTY_DIR/custom-ui/"*; cp -r dist/* "$COPYPARTY_DIR/custom-ui/"
    chown -R copyparty:copyparty "$COPYPARTY_DIR/custom-ui"; log "PWA deployed"
  else warn "PWA build failed — run manually later"; fi
fi

step "14/18 — ClamAV"
systemctl stop clamav-freshclam 2>/dev/null || true
freshclam 2>/dev/null || warn "freshclam failed — retries via cron"
systemctl enable clamav-freshclam; systemctl start clamav-freshclam
log "ClamAV ready"

step "15/18 — WireGuard"
mkdir -p /etc/wireguard
if [[ ! -f /etc/wireguard/server_private.key ]]; then
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
  chmod 600 /etc/wireguard/server_private.key
  SK=$(cat /etc/wireguard/server_private.key); SP=$(cat /etc/wireguard/server_public.key)
  for i in 1 2 3; do wg genkey | tee "/etc/wireguard/client${i}_private.key" | wg pubkey > "/etc/wireguard/client${i}_public.key"; chmod 600 "/etc/wireguard/client${i}_private.key"; done
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
DNS = ${STATIC_IP}
[Peer]
PublicKey = ${SP}
AllowedIPs = 0.0.0.0/0
Endpoint = ${STATIC_IP}:51820
PersistentKeepalive = 25
CLEOF
  done
  log "WireGuard configured — 3 client configs generated"
  echo ""; echo "  Phone QR (client1):"; echo ""
  qrencode -t ansiutf8 < /etc/wireguard/client1.conf
  echo ""; warn "Update Endpoint to public IP before remote use"
fi
grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf || { echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf; sysctl -p >/dev/null; }

step "16/18 — Firewall (nftables)"
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

step "17/18 — Systemd Services"
cat > /etc/systemd/system/copyparty.service << 'EOF'
[Unit]
Description=copyparty file server
After=network.target
[Service]
Type=simple
User=copyparty
Group=copyparty
WorkingDirectory=/opt/copyparty
EnvironmentFile=/opt/copyparty/config/secrets.env
ExecStart=/usr/bin/python3 /opt/copyparty/copyparty-sfx.py --cfg /opt/copyparty/config/copyparty.conf
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/share-manager.service << 'EOF'
[Unit]
Description=Share Manager API
After=network.target copyparty.service
[Service]
Type=simple
User=copyparty
Group=copyparty
WorkingDirectory=/opt/copyparty/hooks
EnvironmentFile=/opt/copyparty/config/secrets.env
ExecStart=/usr/bin/python3 /opt/copyparty/hooks/share-manager.py
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
command -v jellyfin &>/dev/null && usermod -aG copyparty jellyfin 2>/dev/null || true
systemctl daemon-reload
for svc in copyparty share-manager wg-quick@wg0; do
  systemctl enable "$svc"; systemctl start "$svc" 2>/dev/null || warn "$svc failed — check journalctl"
done
log "Services enabled"

step "18/18 — Cron Jobs & Health Check"
cat > /etc/cron.d/personal-cloud << 'EOF'
5 1 * * *   root  rsync -a --delete /storage/pool/ /mnt/backup/ 2>/dev/null || true
30 1 * * *  root  clamscan -r --infected --remove=no --log=/var/log/clamav-pool.log /storage/pool/ 2>&1
0 2 * * *   root  freshclam >> /var/log/freshclam-cron.log 2>&1
30 2 * * *  root  btrfs scrub start /incoming 2>/dev/null || true
0 3 * * *   root  find /incoming/.archive -mtime +90 -exec chattr -i {} \; -delete 2>/dev/null || true
0 * * * *   copyparty  /usr/bin/python3 /opt/copyparty/hooks/share-expiry.py 2>/dev/null || true
0 4 * * 0   root  smartctl -a /dev/nvme0 >> /var/log/smart-nvme.log 2>&1
EOF
echo ""
echo "  NVMe:"; smartctl -a /dev/nvme0 2>/dev/null | grep -E "Percentage|Error|Critical" || warn "NVMe not at /dev/nvme0"
echo "  HBA:"; lspci | grep -iE "LSI|SAS" 2>/dev/null || warn "No HBA — install riser + card"
echo "  Services:"
for s in copyparty share-manager wg-quick@wg0 clamav-freshclam jellyfin fail2ban nftables; do
  ST=$(systemctl is-active "$s" 2>/dev/null || echo "off")
  [[ "$ST" == "active" ]] && echo -e "    ${GREEN}●${NC} $s" || echo -e "    ${RED}○${NC} $s"
done

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Personal Cloud — Setup Complete${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  copyparty:  http://${STATIC_IP}:80"
echo "  Jellyfin:   http://${STATIC_IP}:8096"
echo "  WG clients: /etc/wireguard/client{1,2,3}.conf"
echo "  SSH:        ssh ${MAIN_USER:-user}@${STATIC_IP}"
echo ""
echo "  Manual steps remaining:"
echo "    1. BIOS: 'power on after AC loss'"
echo "    2. Copy SSH key to client, then disable password auth:"
echo "       sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd"
echo "    3. Update WG Endpoint to public IP/Proton VPN port"
echo "    4. Configure Jellyfin via http://${STATIC_IP}:8096"
echo ""
