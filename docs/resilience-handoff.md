# RESILIENCE ARCHITECTURE — HUB & SPOKE
## Handoff from ATU-inspired discussion

---

## CONTEXT

Inspired by Urban Circles' Auxiliary Tech Unit v1 — a portable, off-grid disaster preparedness kit built around a ZimaBoard 2, EcoFlow power station, Meshtastic LoRa nodes, SDR radio, and ruggedized phone. The ATU is a self-contained go bag that operates independently for a week with no external power or internet.

The current personal cloud server (M920q) has zero resilience. Power out = server dead. Internet out = remote access dead. Router dead = even LAN access dead. The ATU exposed this gap.

The idea: the server becomes a stationary knowledge hub, and portable spoke nodes carry critical subsets of that knowledge independently. The server does double duty — personal file server in peacetime, knowledge and comms hub in emergencies.

---

## HUB (M920q at base)

The existing server gains these additional roles:

**Kiwix offline knowledge library:**
- English Wikipedia (~90GB)
- WikiMed medical encyclopedia (~1.8GB)
- Wikibooks (how-to, practical knowledge)
- Agriculture/farming references
- Survival guides
- Herbal medicine references
- Animal husbandry references
- Whatever else is relevant — Kiwix has hundreds of pre-packaged libraries

**Offline maps:**
- Full OpenStreetMap data for North America (~15GB via Organic Maps or OsmAnd format)
- Could go broader (entire continent, global) since storage is cheap and this lives on SATA drives
- Server has the maps, not just one region — as long as you've got the server, you've got maps

**Meshtastic LoRa gateway:**
- USB Meshtastic node (Heltec WiFi LoRa 32 V4, ~$20) plugged into M920q
- Python service listens for text commands over Meshtastic serial API
- Receives text queries, looks up answers from local data (Kiwix, maps, status), sends back over LoRa
- Example commands:
  - "wiki solar panel" → pulls article from Kiwix, compresses to plain text, sends back in chunks
  - "med burns" → first aid protocol from WikiMed
  - "status" → server uptime, power status, drive health
  - "gps" → server's known coordinates (if GPS module attached)

**LoRa bandwidth reality:**
- ~1-5 KB per minute realistically
- Meshtastic payload: 228 bytes per message
- Wikipedia article (text only, compressed): 2-10 KB = 1-5 minutes transfer. Feasible.
- GPS coordinates/waypoints: 50-100 bytes = instant
- Short structured data (recipe, medical procedure, emergency protocol): 1-5 KB = under 2 minutes
- 3MB map tile over LoRa = 30-60 minutes. Not feasible. Maps must be pre-loaded on spoke devices.
- Think of it as texting a librarian, not downloading a website

**WiFi access point (hostapd):**
- Server acts as its own WiFi AP so devices connect directly without needing the router
- If router dies, server is still accessible over its own WiFi
- Devices on the server's AP can access Kiwix, maps, files, Jellyfin — everything local

---

## SPOKES (go bag portable nodes)

Each spoke is a small, battery-powered device that carries a curated subset of the hub's data and operates independently.

**Hardware per spoke:**
- Small SBC: Pi Zero 2W (~$15) or similar
- MicroSD card: 32-128GB with pre-loaded data
- Meshtastic LoRa node for comms back to hub
- Battery: power bank or 18650 pack
- Optional: small screen, GPS module

**Data on each spoke:**
- Subset Kiwix: medical + agriculture + survival (~5-10GB)
- Regional maps pre-loaded (state + surrounding states, ~1-2GB)
- Copy of critical personal files synced from hub
- Not the full Wikipedia or full map set — curated for size and relevance

**Sync model:**
- Spoke connects to hub's WiFi when in range
- rsync or Syncthing pulls latest data from a curated "go-bag-sync" directory on the hub
- Sync priority order:
  1. Medical/survival content (highest priority)
  2. Maps
  3. Personal critical files
  4. General knowledge (lowest priority)
- Spoke is always a few hours or days behind hub at worst
- When out of range, operates fully independently from whatever it last synced

**Comms when separated:**
- Spoke's Meshtastic node talks to hub's Meshtastic node over LoRa
- Text queries to the hub's knowledge gateway
- Multi-hop mesh: if spoke is out of direct range, other Meshtastic nodes in the mesh relay messages
- Encrypted channel with shared key across the group

---

## THE RELATIONSHIP TO THE ATU

The ATU is a complete, self-contained portable kit. It IS the go bag.

This architecture splits that concept into two tiers:

**The hub is what the ATU can't be:** massive storage (terabytes of knowledge, maps, media), high compute, always-on, connected to power and internet in normal times. It accumulates and curates.

**The spokes are what the ATU IS:** portable, battery-powered, independent, rugged. They carry the essentials and can operate alone. But unlike the ATU, they also sync with the hub, so they're always current.

The advantage: the spokes don't need to carry everything because the hub has it all. The hub doesn't need to be portable because the spokes go where you go. Each covers the other's weakness.

---

## WHAT NEEDS TO BE BUILT

**On the hub (M920q):**
1. Install Kiwix server + download all relevant ZIM libraries
2. Download and serve offline OSM map data
3. Configure hostapd (server as WiFi AP, router-independent)
4. Meshtastic LoRa gateway Python service
5. Create "go-bag-sync" directory structure with priority tiers
6. UPS + NUT for clean shutdown on power loss (non-optional)

**On each spoke:**
1. Flash Pi Zero 2W with lightweight Linux
2. Install Kiwix reader + subset ZIM files
3. Install offline map viewer
4. Configure Syncthing/rsync client pointed at hub
5. Configure Meshtastic for encrypted mesh comms
6. Battery management / power optimization

**Not built yet:** All of this. The concept is defined. Nothing is implemented.

---

## REFERENCE: URBAN CIRCLES ATU v1 COMPONENTS

For contrast and shopping reference:

| Component | What it does | ATU choice |
|-----------|-------------|------------|
| Power | Off-grid runtime | EcoFlow DELTA 3 Max (2048Wh LiFePO4) |
| Compute | Server/apps | ZimaBoard 2 (N150, 6W idle, fanless) |
| Apps | Knowledge/media | Immich, Paperless-ngx, Jellyfin, Kiwix, Open WebUI |
| Handset | Client + comms | AGM G3 Pro (10000mAh, thermal camera, rugged) |
| Mesh comms | Off-grid text | Heltec WiFi LoRa 32 V4 (Meshtastic) |
| RF monitoring | Signal awareness | PortaPack H4M (1MHz-6GHz) |
| Light/signal | Emergency | Wuben X1 Pro (12300lm, USB-C power bank) |
| Case | Housing/reference | 3D-printed with frequency ref, Morse, redundancy map on lid |
