"""Sleep — session-auth CRUD for the PWA plus device-key ingestion so the
alarm puck can sync without a browser session.

Puck usage:  POST /api/sleep/ingest
             headers: X-Api-Key: <key from /api/sleep/devicekey>
             body: {"slept_at": ts, "woke_at": ts, "quality": 1-5}
"""
import time, secrets
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("sleep", __name__, url_prefix="/api/sleep")


@bp.post("/devicekey")
@require_auth
def make_key():
    key = "pk_" + secrets.token_urlsafe(24)
    conn = db.connect()
    conn.execute("INSERT INTO api_keys (key, user_id, label, created_at) VALUES (?,?,?,?)",
                 (key, g.user["id"], (request.get_json(silent=True) or {}).get("label", "device"),
                  int(time.time())))
    conn.commit()
    conn.close()
    return jsonify({"key": key, "note": "shown once; store it on the device"})


@bp.post("/ingest")
def ingest():
    key = request.headers.get("X-Api-Key", "")
    conn = db.connect()
    row = conn.execute("SELECT user_id FROM api_keys WHERE key=? AND revoked=0", (key,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "bad key"}), 401
    d = request.get_json(silent=True) or {}
    if not d.get("slept_at"):
        conn.close()
        return jsonify({"error": "slept_at required"}), 400
    conn.execute("INSERT INTO sleep_sessions (user_id, slept_at, woke_at, quality, note) "
                 "VALUES (?,?,?,?,?)",
                 (row["user_id"], d["slept_at"], d.get("woke_at"), d.get("quality"), d.get("note")))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@bp.get("/recent")
@require_auth
def recent():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM sleep_sessions WHERE user_id=? "
                        "ORDER BY slept_at DESC LIMIT 30", (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
