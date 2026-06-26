#!/usr/bin/env python3
"""
Quarantine scanner worker.

Polls the quarantine table for PENDING rows, scans each file with
ClamAV (block tier) + YARA block-tier + YARA review-tier, then:
  - clean            -> status=clear, move file to intended_dest
  - block-tier hit   -> status=flagged, flag_tier=block  (held in staging)
  - review-tier hit  -> status=flagged, flag_tier=review (held in staging)

Runs as a systemd service. Lightweight poll loop (default 5s).
"""
import os, time, json, shutil, sqlite3, subprocess, logging

logging.basicConfig(filename="/var/log/scanner-worker.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

DB = "/opt/copyparty/shares.db"
YARA_BLOCK  = "/opt/yara-rules/stego.yar"
YARA_REVIEW = "/opt/yara-rules/review.yar"
POLL_SEC = 5

def scan(path):
    """Return (verdict, reason). verdict in {clean, block, review}."""
    # ClamAV
    try:
        r = subprocess.run(["clamscan", "--infected", "--no-summary", path],
                           capture_output=True, text=True, timeout=600)
        if r.returncode == 1:  # 1 = virus found
            sig = r.stdout.strip().split(":")[-1].strip() or "unknown"
            return "block", f"ClamAV:{sig}"
    except Exception as e:
        logging.warning(f"clamscan error on {path}: {e}")

    # YARA block tier
    try:
        r = subprocess.run(["yara", YARA_BLOCK, path],
                           capture_output=True, text=True, timeout=120)
        if r.stdout.strip():
            rule = r.stdout.strip().split()[0]
            return "block", f"YARA:{rule}"
    except Exception as e:
        logging.warning(f"yara block error on {path}: {e}")

    # YARA review tier
    try:
        r = subprocess.run(["yara", YARA_REVIEW, path],
                           capture_output=True, text=True, timeout=120)
        if r.stdout.strip():
            rule = r.stdout.strip().split()[0]
            return "review", f"YARA:{rule}"
    except Exception as e:
        logging.warning(f"yara review error on {path}: {e}")

    return "clean", None

def move_to_dest(staging_path, intended_dest, filename):
    os.makedirs(intended_dest, exist_ok=True)
    final = os.path.join(intended_dest, filename)
    shutil.move(staging_path, final)
    # clean up the now-empty staging subdir
    try:
        os.rmdir(os.path.dirname(staging_path))
    except OSError:
        pass
    return final

def process_one(conn, row):
    qid, owner, filename, staging_path, intended_dest, scope = row
    if not os.path.exists(staging_path):
        # File not landed yet (upload still in flight) — skip this round
        return
    verdict, reason = scan(staging_path)
    now = int(time.time())
    if verdict == "clean":
        try:
            final = move_to_dest(staging_path, intended_dest, filename)
            conn.execute("UPDATE quarantine SET status='clear', scanned_at=?, "
                         "resolved_at=?, resolved_by='system' WHERE id=?",
                         (now, now, qid))
            conn.commit()
            logging.info(f"CLEAR id={qid} {filename} -> {final}")
        except Exception as e:
            logging.error(f"move failed id={qid} {filename}: {e}")
    else:
        tier = verdict  # 'block' or 'review'
        conn.execute("UPDATE quarantine SET status='flagged', flag_tier=?, "
                     "flag_reason=?, scanned_at=? WHERE id=?",
                     (tier, reason, now, qid))
        conn.commit()
        logging.warning(f"FLAGGED({tier}) id={qid} {filename} reason={reason}")

def main():
    logging.info("scanner-worker started")
    while True:
        try:
            conn = sqlite3.connect(DB, timeout=10)
            rows = conn.execute(
                "SELECT id, owner, filename, staging_path, intended_dest, dest_scope "
                "FROM quarantine WHERE status='pending'"
            ).fetchall()
            for row in rows:
                process_one(conn, row)
            conn.close()
        except Exception as e:
            logging.error(f"worker loop error: {e}")
        time.sleep(POLL_SEC)

if __name__ == "__main__":
    main()
