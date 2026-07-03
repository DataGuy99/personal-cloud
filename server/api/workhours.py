"""Work hours — clock in/out, manual entries, list sessions."""
import time, json
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
    rate = d.get("hourly_rate")
    if rate is None:
        sv = conn.execute("SELECT settings FROM user_services WHERE user_id=? AND service='work' AND enabled=1",
                          (g.user["id"],)).fetchone()
        if sv:
            rate = json.loads(sv["settings"]).get("hourly_rate")
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
        (g.user["id"], gid, int(time.time()), rate,
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


@bp.post("/manual")
@require_auth
def manual():
    """Add a past session: started_at + (ended_at | duration_min), optional
    break_min subtracted from the end, note, activity, rate (falls back to
    paired work settings)."""
    d = request.get_json(silent=True) or {}
    start = d.get("started_at")
    if not start:
        return jsonify({"error": "started_at required"}), 400
    end = d.get("ended_at")
    if not end and d.get("duration_min"):
        end = start + int(d["duration_min"]) * 60
    if not end or end <= start:
        return jsonify({"error": "need ended_at or duration_min > 0"}), 400
    end -= int(d.get("break_min") or 0) * 60
    if end <= start:
        return jsonify({"error": "break exceeds duration"}), 400
    conn = db.connect()
    rate = d.get("hourly_rate")
    if rate is None:
        sv = conn.execute("SELECT settings FROM user_services WHERE user_id=? AND service='work' AND enabled=1",
                          (g.user["id"],)).fetchone()
        if sv:
            rate = json.loads(sv["settings"]).get("hourly_rate")
    gid = d.get("group_id")
    if gid and not conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                                (gid, g.user["id"])).fetchone():
        conn.close(); return jsonify({"error": "not a member"}), 403
    conn.execute("INSERT INTO work_sessions (user_id, group_id, started_at, ended_at, hourly_rate, activity, note) "
                 "VALUES (?,?,?,?,?,?,?)",
                 (g.user["id"], gid, start, end, rate, d.get("activity"), d.get("note")))
    conn.commit(); conn.close()
    return jsonify({"ok": True})
