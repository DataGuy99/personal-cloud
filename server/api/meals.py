"""Meals & plans — the Family-linking flow.

Plans: personal (group_id NULL) or group-scoped (visible to members).
Logging: a meal row is ALWAYS personal; plan_id records provenance when
logging from a plan (group plan macros copy in automatically).
"""
import time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("meals", __name__, url_prefix="/api/meals")


def _member(conn, gid, uid):
    return conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                        (gid, uid)).fetchone()


@bp.post("")
@require_auth
def log_meal():
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    vals = {k: d.get(k) for k in ("name", "kcal", "protein_g", "carbs_g", "fat_g", "note")}
    plan_id = d.get("plan_id")
    if plan_id:
        plan = conn.execute("SELECT * FROM meal_plans WHERE id=?", (plan_id,)).fetchone()
        if not plan:
            conn.close(); return jsonify({"error": "no such plan"}), 404
        if plan["group_id"] and not _member(conn, plan["group_id"], g.user["id"]):
            conn.close(); return jsonify({"error": "not a member of that plan's group"}), 403
        vals["name"] = vals["name"] or plan["recipe"]
        vals["kcal"] = vals["kcal"] if vals["kcal"] is not None else plan["target_kcal"]
    conn.execute("INSERT INTO meals (user_id, plan_id, eaten_at, name, kcal, protein_g, carbs_g, fat_g, note) "
                 "VALUES (?,?,?,?,?,?,?,?,?)",
                 (g.user["id"], plan_id, d.get("eaten_at") or int(time.time()),
                  vals["name"], vals["kcal"], vals["protein_g"], vals["carbs_g"],
                  vals["fat_g"], vals["note"]))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@bp.get("/recent")
@require_auth
def recent():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM meals WHERE user_id=? ORDER BY eaten_at DESC LIMIT 50",
                        (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("/plans")
@require_auth
def create_plan():
    d = request.get_json(silent=True) or {}
    gid = d.get("group_id")
    conn = db.connect()
    if gid and not _member(conn, gid, g.user["id"]):
        conn.close(); return jsonify({"error": "not a member"}), 403
    conn.execute("INSERT INTO meal_plans (user_id, group_id, plan_date, meal_slot, recipe, target_kcal) "
                 "VALUES (?,?,?,?,?,?)",
                 (g.user["id"], gid, d.get("plan_date"), d.get("meal_slot"),
                  d.get("recipe"), d.get("target_kcal")))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@bp.get("/plans")
@require_auth
def plans():
    """Personal plans + plans from every group I'm in."""
    conn = db.connect()
    rows = conn.execute(
        "SELECT p.*, gr.name AS group_name FROM meal_plans p "
        "LEFT JOIN groups gr ON gr.id=p.group_id "
        "WHERE (p.group_id IS NULL AND p.user_id=?) "
        "   OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id=?) "
        "ORDER BY p.plan_date DESC, p.id DESC LIMIT 100",
        (g.user["id"], g.user["id"])).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
