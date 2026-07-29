"""Insights — cross-module daily picture. The reason the ecosystem is one system.

Combines: BMR (body_metrics) + work activity (work_sessions) + workouts
into an estimated daily energy expenditure + earnings for today.
Modules not yet logged simply contribute nothing (graceful degradation).
"""
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from flask import Blueprint, jsonify, g
import db
from api.util import require_auth
from api.metrics import bmr_mifflin

bp = Blueprint("insights", __name__, url_prefix="/api/insights")

# rough kcal/hour above resting for work activity types
ACTIVITY_KCAL_HR = {"desk": 30, "standing": 60, "driving": 40,
                    "construction": 250, "manual": 200}


def _day_bounds(tz_name=None, ts=None):
    """Midnight-to-midnight in the USER's timezone.

    Fixed 2026-07-28. This previously used datetime.fromtimestamp() with no tzinfo, i.e.
    the SERVER's local time, so "today" was wherever CloudDome thinks it is. Two real
    consequences: a meal eaten late and logged after midnight landed on the wrong day, and
    the energy-balance window covered the wrong 24 hours. The resolved rule is midnight in
    the user's own timezone.

    Deliberately NOT `start + 86400`: across a DST transition a local day is 23 or 25
    hours, and adding a fixed 86400 would clip or overlap an hour of the user's data.
    Adding timedelta(days=1) to an aware datetime does wall-clock arithmetic, so the end
    really is the next local midnight.

    An unset or unrecognised tz falls back to server local — same behaviour as before, so
    a bad value degrades rather than throwing.
    """
    tz = None
    if tz_name:
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = None
    dt = datetime.fromtimestamp(ts or time.time(), tz)
    start_local = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return int(start_local.timestamp()), int(end_local.timestamp())


@bp.get("/today")
@require_auth
def today():
    uid = g.user["id"]
    start, end = _day_bounds(g.user["tz"] if "tz" in g.user.keys() else None)
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
