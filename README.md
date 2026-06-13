# Personal Cloud -- Self-Hosted File Server

ThinkCentre M710q + copyparty + custom PWA

## Architecture
- **Hardware:** Lenovo M710q, RIITOP M.2-to-6-SATA (ASM1166), ATX PSU for drives
- **Boot:** 500GB HDD (partitioned), PM991 NVMe via USB enclosure for cache
- **Storage:** MergerFS pool across SATA drives
- **File Server:** copyparty with custom Telegram-style PWA skin
- **Security:** Btrfs quarantine, ClamAV, YARA, VirusTotal hash lookups
- **Remote Access:** WireGuard via Proton VPN port forwarding
- **DNS:** Pi-hole / AdGuard Home

## Project Structure
```
docs/           White paper and actionable development specs
pwa/            Telegram-style PWA shell (Vite + vanilla JS)
share-manager/  Flask middleware for time-limited shared spaces
hooks/          copyparty upload hooks, scanning, categorization
config/         Server config templates (copyparty, systemd, nftables, WireGuard)
```

## Status
Phase 0: Pre-hardware development. Building PWA, share manager, and hook scripts.
