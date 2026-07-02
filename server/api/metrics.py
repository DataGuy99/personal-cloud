"""Body metrics — log weight/height/age/sex, compute BMR (Mifflin-St Jeor)."""
import time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("metrics", __name__, url_prefix="/api/metrics")


def bmr_mifflin(weight_kg, height_cm, age, sex):
    if not all([weight_kg, height_cm, age, sex]):
        return None
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return round(base + (5 if sex == "m" else -161))


@bp.post("")
@require_auth
def log_metric():
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    conn.execute(
        "INSERT INTO body_metrics (user_id, logged_at, weight_kg, height_cm, "
        "age_years, sex, body_fat_pct, note) VALUES (?,?,?,?,?,?,?,?)",
        (g.user["id"], int(time.time()), d.get("weight_kg"), d.get("height_cm"),
         d.get("age_years"), d.get("sex"), d.get("body_fat_pct"), d.get("note")))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


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
