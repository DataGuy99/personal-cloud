#!/usr/bin/env python3
"""Nightly KV snapshots: one per (user, app) with data; prune to last 14 each."""
import os, sys, time, json, sqlite3

DB = os.environ.get("PC_DB", "/opt/copyparty/shares.db")
conn = sqlite3.connect(DB, timeout=30)
conn.row_factory = sqlite3.Row
now = int(time.time())
pairs = conn.execute("SELECT DISTINCT user_id, app FROM app_kv").fetchall()
for p in pairs:
    rows = conn.execute("SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
                        (p["user_id"], p["app"])).fetchall()
    if not rows:
        continue
    conn.execute("INSERT INTO kv_snapshots (user_id, app, created_at, data) VALUES (?,?,?,?)",
                 (p["user_id"], p["app"], now, json.dumps({r["key"]: r["value"] for r in rows})))
    conn.execute("DELETE FROM kv_snapshots WHERE user_id=? AND app=? AND id NOT IN "
                 "(SELECT id FROM kv_snapshots WHERE user_id=? AND app=? ORDER BY created_at DESC LIMIT 14)",
                 (p["user_id"], p["app"], p["user_id"], p["app"]))
conn.commit()
print(f"snapshotted {len(pairs)} app-states")
