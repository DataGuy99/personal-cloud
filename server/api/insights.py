"""Insights — cross-module daily picture. The reason the ecosystem is one system.

Combines: BMR (body_metrics) + work activity (work_sessions) + workouts
into an estimated daily energy expenditure + earnings for today.
Modules not yet logged simply contribute nothing (graceful degradation).
"""
import time
from datetime import datetime
from flask import Blueprint, jsonify, g
import db
from api.util import require_auth
from api.metrics import bmr_mifflin

bp = Blueprint("insights", __name__, url_prefix="/api/insights")

# rough kcal/hour above resting for work activity types
ACTIVITY_KCAL_HR = {"desk": 30, "standing": 60, "driving": 40,
                    "construction": 250, "manual": 200}


def _day_bounds(ts=None):
    dt = datetime.fromtimestamp(ts or time.time())
    start = int(datetime(dt.year, dt.month, dt.day).timestamp())
    return start, start + 86400


@bp.get("/today")
@require_auth
def today():
    uid = g.user["id"]
    start, end = _day_bounds()
    conn = db.connect()

    m = conn.execute("SELECT * FROM body_metrics WHERE user_id=? "
                     "ORDER BY logged_at DESC LIMIT 1", (uid,)).fetchone()
    bmr = bmr_mifflin(m["weight_kg"], m["height_cm"], m["age_years"], m["sex"]) if m else None

    work = conn.execute(
        "SELECT started_at, ended_at, hourly_rate, activity FROM work_sessions "
        "WHERE user_id=? AND started_at>=? AND started_at<?", (uid, start, end)).fetchall()
    now = int(time.time())
    work_sec = sum((w["ended_at"] or now) - w["started_at"] for w in work)
    work_kcal = sum(((w["ended_at"] or now) - w["started_at"]) / 3600
                    * ACTIVITY_KCAL_HR.get(w["activity"] or "desk", 30) for w in work)
    earnings = sum(((w["ended_at"] or now) - w["started_at"]) / 3600 * w["hourly_rate"]
                   for w in work if w["hourly_rate"])

    wo = conn.execute("SELECT COALESCE(SUM(est_kcal),0) k, COALESCE(SUM(duration_min),0) d "
                      "FROM workouts WHERE user_id=? AND performed_at>=? AND performed_at<?",
                      (uid, start, end)).fetchone()
    meals = conn.execute("SELECT COALESCE(SUM(kcal),0) k FROM meals "
                         "WHERE user_id=? AND eaten_at>=? AND eaten_at<?",
                         (uid, start, end)).fetchone()
    conn.close()

    burn = (bmr or 0) + work_kcal + wo["k"]
    return jsonify({
        "bmr_kcal": bmr,
        "work_hours": round(work_sec / 3600, 2),
        "work_kcal": round(work_kcal),
        "workout_kcal": wo["k"],
        "workout_minutes": wo["d"],
        "earnings": round(earnings, 2) if earnings else 0,
        "intake_kcal": meals["k"],
        "est_total_burn_kcal": round(burn) if bmr else None,
        "net_kcal": round(meals["k"] - burn) if bmr else None,
        "note": None if bmr else "log body metrics to unlock burn estimates",
    })
