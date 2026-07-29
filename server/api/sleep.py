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


def _store(conn, uid, d):
    """Insert one sleep session plus its stages. Returns (id, created).

    Added 2026-07-28 for Health Connect. HC re-delivers the same records on every sync,
    so `hc_uid` is the dedup key — without it you accumulate duplicate nights and every
    sleep figure silently doubles. An existing uid updates in place rather than inserting.
    """
    uid_key = d.get("hc_uid")
    existing = None
    if uid_key:
        existing = conn.execute(
            "SELECT id FROM sleep_sessions WHERE user_id=? AND hc_uid=?",
            (uid, uid_key)).fetchone()
    cols = (d.get("slept_at"), d.get("woke_at"), d.get("quality"), d.get("note"),
            d.get("source", "manual"), uid_key, d.get("tz_offset_min"))
    if existing:
        sid = existing["id"]
        conn.execute("UPDATE sleep_sessions SET slept_at=?, woke_at=?, quality=?, note=?, "
                     "source=?, hc_uid=?, tz_offset_min=? WHERE id=?", (*cols, sid))
        conn.execute("DELETE FROM sleep_stages WHERE session_id=?", (sid,))
        created = False
    else:
        cur = conn.execute(
            "INSERT INTO sleep_sessions (user_id, slept_at, woke_at, quality, note, "
            "source, hc_uid, tz_offset_min) VALUES (?,?,?,?,?,?,?,?)", (uid, *cols))
        sid = cur.lastrowid
        created = True
    for st in (d.get("stages") or []):
        if st.get("stage") is None or st.get("started_at") is None:
            continue
        conn.execute("INSERT INTO sleep_stages (session_id, stage, started_at, ended_at) "
                     "VALUES (?,?,?,?)",
                     (sid, int(st["stage"]), int(st["started_at"]),
                      int(st.get("ended_at") or st["started_at"])))
    return sid, created


@bp.post("")
@require_auth
def log_sleep():
    """Session-authed sleep write — what the Nook app uses.

    /ingest exists for the alarm puck and takes a device key; the app already holds a
    session, so making it mint and store a device key just to write its own data would be
    a needless second credential to leak.
    """
    d = request.get_json(silent=True) or {}
    if not d.get("slept_at"):
        return jsonify({"error": "slept_at required"}), 400
    conn = db.connect()
    sid, created = _store(conn, g.user["id"], d)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": sid, "created": created})


@bp.post("/bulk")
@require_auth
def log_sleep_bulk():
    """Many sessions at once — a Health Connect sync returns a batch, not one night.

    Per-item failures are counted rather than aborting the batch: one malformed record
    must not discard a month of good ones.
    """
    d = request.get_json(silent=True) or {}
    items = d.get("sessions") or []
    conn = db.connect()
    added = updated = skipped = 0
    for s in items:
        if not s.get("slept_at"):
            skipped += 1
            continue
        try:
            _, created = _store(conn, g.user["id"], s)
            added, updated = (added + 1, updated) if created else (added, updated + 1)
        except Exception:
            skipped += 1
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "added": added, "updated": updated, "skipped": skipped})


@bp.get("/recent")
@require_auth
def recent():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM sleep_sessions WHERE user_id=? "
                        "ORDER BY slept_at DESC LIMIT 30", (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
