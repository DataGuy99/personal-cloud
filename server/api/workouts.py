"""Workouts — log sessions; est_kcal auto-computed via MET x weight x hours
when not supplied and body metrics exist. Estimates are labeled estimates."""
import time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("workouts", __name__, url_prefix="/api/workouts")

MET = {"strength": 5.0, "cardio": 8.0, "walking": 3.5, "running": 9.8,
       "cycling": 7.5, "mobility": 2.5, "hiit": 10.0, "sports": 7.0}


@bp.post("")
@require_auth
def log_workout():
    d = request.get_json(silent=True) or {}
    kind = (d.get("kind") or "strength").lower()
    dur = d.get("duration_min") or 0
    est = d.get("est_kcal")
    conn = db.connect()
    if est is None and dur:
        m = conn.execute("SELECT weight_kg FROM body_metrics WHERE user_id=? AND weight_kg "
                         "IS NOT NULL ORDER BY logged_at DESC LIMIT 1", (g.user["id"],)).fetchone()
        if m:
            est = round(MET.get(kind, 5.0) * m["weight_kg"] * (dur / 60))
    conn.execute("INSERT INTO workouts (user_id, performed_at, kind, duration_min, est_kcal, note) "
                 "VALUES (?,?,?,?,?,?)",
                 (g.user["id"], d.get("performed_at") or int(time.time()), kind, dur, est, d.get("note")))
    conn.commit()
    wid = conn.execute("SELECT last_insert_rowid() i").fetchone()["i"]
    for s in d.get("sets") or []:
        conn.execute("INSERT INTO workout_sets (workout_id, exercise, set_no, reps, weight_kg) "
                     "VALUES (?,?,?,?,?)",
                     (wid, s.get("exercise"), s.get("set_no"), s.get("reps"), s.get("weight_kg")))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "est_kcal": est})


@bp.get("/recent")
@require_auth
def recent():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM workouts WHERE user_id=? ORDER BY performed_at DESC LIMIT 40",
                        (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
