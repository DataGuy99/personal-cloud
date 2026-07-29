"""Body metrics — log weight/height/age/sex, compute BMR (Mifflin-St Jeor)."""
import time
from flask import Blueprint, request, jsonify, g
import db
import units
from api.util import require_auth

bp = Blueprint("metrics", __name__, url_prefix="/api/metrics")


def bmr_mifflin(weight_kg, height_cm, age, sex):
    if not all([weight_kg, height_cm, age, sex]):
        return None
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return round(base + (5 if sex == "m" else -161))


def _measure(d, base_key, unit_key, family, default_unit):
    """Resolve a measurement to the column's base unit, whatever the caller sent.

    Added 2026-07-28. The columns are `weight_kg` and `height_cm`, but nothing upstream
    carried a unit: reps stores whatever number the user types, and Samuel types POUNDS.
    Posting a bare 175 would have been stored as 175 kg and computed BMR ~45% high,
    silently, forever. So the endpoint now accepts EITHER an explicitly-united value —
    {"weight": 175, "weight_unit": "lb"} — or the legacy already-converted
    {"weight_kg": 79.4}, and converts through units.py.

    An unknown or ambiguous unit returns None rather than guessing. Refusing to store is
    the correct failure here: a wrong number looks right forever, a missing one gets
    noticed immediately.
    """
    if d.get(base_key) is not None:            # caller already did the conversion
        return d.get(base_key), None
    raw = d.get(family)
    if raw is None:
        return None, None
    unit = (d.get(unit_key) or default_unit)
    value, fam = units.to_base(raw, unit)
    if value is None:
        return None, f"unknown or ambiguous unit for {family}: {unit!r}"
    if fam != ("mass" if family == "weight" else "length"):
        return None, f"{unit!r} is not a {family} unit"
    # base for mass is grams, for length centimetres; columns want kg and cm
    return (value / 1000.0 if family == "weight" else value), None


@bp.post("")
@require_auth
def log_metric():
    d = request.get_json(silent=True) or {}
    weight, werr = _measure(d, "weight_kg", "weight_unit", "weight", "kg")
    height, herr = _measure(d, "height_cm", "height_unit", "height", "cm")
    if werr or herr:
        return jsonify({"error": werr or herr}), 400
    conn = db.connect()
    conn.execute(
        "INSERT INTO body_metrics (user_id, logged_at, weight_kg, height_cm, "
        "age_years, sex, body_fat_pct, note) VALUES (?,?,?,?,?,?,?,?)",
        (g.user["id"], int(time.time()), weight, height,
         d.get("age_years"), d.get("sex"), d.get("body_fat_pct"), d.get("note")))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "stored": {"weight_kg": weight, "height_cm": height}})


@bp.get("/latest")
@require_auth
def latest():
    conn = db.connect()
    row = conn.execute(
        "SELECT * FROM body_metrics WHERE user_id=? ORDER BY logged_at DESC LIMIT 1",
        (g.user["id"],)).fetchone()
    conn.close()
    if not row:
        return jsonify({})
    out = dict(row)
    out["bmr_kcal"] = bmr_mifflin(row["weight_kg"], row["height_cm"],
                                  row["age_years"], row["sex"])
    return jsonify(out)


@bp.get("/history")
@require_auth
def history():
    conn = db.connect()
    rows = conn.execute(
        "SELECT logged_at, weight_kg, body_fat_pct FROM body_metrics "
        "WHERE user_id=? ORDER BY logged_at DESC LIMIT 90",
        (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
