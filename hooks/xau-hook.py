#!/usr/bin/env python3
"""copyparty after-upload hook — scan in place, quarantine only if infected"""
import sys, os, subprocess, shutil, logging, json

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

def quarantine(src):
    q_dir = "/incoming/.quarantine"
    os.makedirs(q_dir, exist_ok=True)
    try:
        shutil.move(src, f"{q_dir}/{os.path.basename(src)}")
        logging.warning(f"QUARANTINED {src}")
    except Exception as e:
        logging.error(f"Quarantine move failed for {src}: {e}")

def main():
    if len(sys.argv) < 2:
        sys.exit(0)
    raw = sys.argv[1]
    try:
        info = json.loads(raw)
        filepath = info.get("ap")
        vpath = info.get("vp", "")
        user = info.get("user", "?")
        size = info.get("sz", 0)
        ip = info.get("ip", "?")
    except (json.JSONDecodeError, AttributeError):
        filepath = raw; vpath = filepath; user = ip = "?"; size = 0

    if not filepath or not os.path.exists(filepath):
        logging.error(f"File not found on disk: {filepath}")
        sys.exit(0)

    scan_result = subprocess.run(
        ["/opt/copyparty/hooks/scan-file.sh", filepath],
        capture_output=True
    )
    if scan_result.returncode != 0:
        quarantine(filepath)
        logging.warning(f"BLOCKED+QUARANTINED user={user} vp={vpath} ({size}b from {ip})")
        sys.exit(0)
    logging.info(f"CLEAN user={user} vp={vpath} ({size}b from {ip})")
    sys.exit(0)

if __name__ == "__main__":
    main()
