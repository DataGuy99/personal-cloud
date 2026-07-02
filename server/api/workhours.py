"""Work hours — clock in/out, list sessions, running session."""
import time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("work", __name__, url_prefix="/api/work")


@bp.post("/clockin")
@require_auth
def clock_in():
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    running = conn.execute(
        "SELECT id FROM work_sessions WHERE user_id=? AND ended_at IS NULL",
        (g.user["id"],)).fetchone()
    if running:
        conn.close()
        return jsonify({"error": "already clocked in"}), 409
    gid = d.get("group_id")
    if gid:
        ok = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, g.user["id"])).fetchone()
        if not ok:
            conn.close()
            return jsonify({"error": "not a member of that group"}), 403
    conn.execute(
        "INSERT INTO work_sessions (user_id, group_id, started_at, hourly_rate, activity, note) "
        "VALUES (?,?,?,?,?,?)",
        (g.user["id"], gid, int(time.time()), d.get("hourly_rate"),
         d.get("activity"), d.get("note")))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@bp.post("/clockout")
@require_auth
def clock_out():
    conn = db.connect()
    cur = conn.execute(
        "UPDATE work_sessions SET ended_at=? WHERE user_id=? AND ended_at IS NULL",
        (int(time.time()), g.user["id"]))
    conn.commit()
    changed = cur.rowcount
    conn.close()
    if not changed:
        return jsonify({"error": "not clocked in"}), 409
    return jsonify({"ok": True})


@bp.get("/status")
@require_auth
def status():
    conn = db.connect()
    row = conn.execute(
        "SELECT * FROM work_sessions WHERE user_id=? AND ended_at IS NULL",
        (g.user["id"],)).fetchone()
    conn.close()
    return jsonify(dict(row) if row else {})


@bp.get("/sessions")
@require_auth
def sessions():
    conn = db.connect()
    rows = conn.execute(
        "SELECT * FROM work_sessions WHERE user_id=? ORDER BY started_at DESC LIMIT 60",
        (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
