"""Service pairing — per-user opt-in + settings for ecosystem modules."""
import time, json
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("services", __name__, url_prefix="/api/services")
KNOWN = ["work", "fitness", "meals", "sleep", "journal"]


@bp.get("")
@require_auth
def list_services():
    conn = db.connect()
    rows = {r["service"]: r for r in conn.execute(
        "SELECT * FROM user_services WHERE user_id=?", (g.user["id"],)).fetchall()}
    conn.close()
    return jsonify([{
        "service": s,
        "enabled": bool(rows[s]["enabled"]) if s in rows else False,
        "settings": json.loads(rows[s]["settings"]) if s in rows else {},
    } for s in KNOWN])


@bp.put("/<service>")
@require_auth
def set_service(service):
    if service not in KNOWN:
        return jsonify({"error": "unknown service"}), 404
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    conn.execute(
        "INSERT INTO user_services (user_id, service, enabled, settings, updated_at) "
        "VALUES (?,?,?,?,?) ON CONFLICT(user_id, service) DO UPDATE SET "
        "enabled=excluded.enabled, settings=excluded.settings, updated_at=excluded.updated_at",
        (g.user["id"], service, 1 if d.get("enabled", True) else 0,
         json.dumps(d.get("settings", {})), int(time.time())))
    conn.commit(); conn.close()
    return jsonify({"ok": True})
