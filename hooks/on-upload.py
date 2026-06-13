#!/usr/bin/env python3
import sys, os, time, subprocess, hashlib, shutil, logging
from pathlib import Path
from categorize import categorize
from virustotal import virustotal_check

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO)

def archive_reflink(src_path, category):
    archive_dir = f"/incoming/.archive/{category}"
    os.makedirs(archive_dir, exist_ok=True)
    ts = int(time.time())
    short_hash = hashlib.md5(os.path.basename(src_path).encode()).hexdigest()[:8]
    dst = f"{archive_dir}/{ts}-{short_hash}-{os.path.basename(src_path)}"
    subprocess.run(["cp", "--reflink=always", src_path, dst], check=True)
    subprocess.run(["chattr", "+i", dst], check=True)

def promote(src, dst):
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

def notify_admin(msg):
    logging.warning(f"ADMIN ALERT: {msg}")

FILE = sys.argv[1]
FILENAME = os.path.basename(FILE)
CATEGORY = categorize(FILENAME)
SOURCE = sys.argv[2]
RISK = {"download": "high", "untrusted-upload": "medium", "trusted-upload": "low"}[SOURCE]

INCOMING = f"/incoming/{CATEGORY}"
os.makedirs(INCOMING, exist_ok=True)
incoming_path = f"{INCOMING}/{FILENAME}"
os.rename(FILE, incoming_path)

archive_reflink(incoming_path, CATEGORY)

clam = subprocess.run(["clamscan", "--infected", "--remove=no", incoming_path])
pool_dst = f"/pool/{CATEGORY}/{FILENAME}"

if RISK == "high":
    if clam.returncode == 0:
        vt = virustotal_check(incoming_path)
        if vt["positives"] == 0:
            promote(incoming_path, pool_dst)
        elif vt["positives"] == -1:
            logging.info(f"VT unknown: {FILENAME}. Holding for review.")
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
