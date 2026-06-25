#!/usr/bin/env python3
"""Hourly cron: expire shares, notify about expiring-soon, clean up."""
import sqlite3, time, os, shutil, logging

logging.basicConfig(filename="/var/log/share-expiry.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
DB = "/opt/copyparty/shares.db"

def run():
    if not os.path.exists(DB):
        return
    conn = sqlite3.connect(DB)
    now = int(time.time())

    # Warn: expiring within 3 days
    expiring = conn.execute(
        "SELECT id, owner, name FROM shares WHERE expires_at BETWEEN ? AND ?",
        (now, now + 3 * 86400)
    ).fetchall()
    for sid, owner, name in expiring:
        logging.info(f"Expiring soon: '{name}' (owner: {owner}, id: {sid})")

    # Delete expired
    expired = conn.execute(
        "SELECT id, path, auto_delete FROM shares WHERE expires_at < ?", (now,)
    ).fetchall()
    for sid, path, auto_delete in expired:
        if auto_delete and path and os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
        conn.execute("DELETE FROM share_members WHERE share_id = ?", (sid,))
        conn.execute("DELETE FROM shares WHERE id = ?", (sid,))
        logging.info(f"Expired: {sid} at {path} (auto_delete={auto_delete})")

    conn.commit()
    conn.close()
    if expired or expiring:
        logging.info(f"Check complete: {len(expired)} expired, {len(expiring)} expiring soon")

if __name__ == "__main__":
    run()
