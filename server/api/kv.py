"""Per-user KV storage for ported apps. GET all / bulk PUT / DELETE key."""
import time, json
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("kv", __name__, url_prefix="/api/kv")


@bp.get("/<app>")
@require_auth
def get_all(app):
    conn = db.connect()
    rows = conn.execute("SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
                        (g.user["id"], app)).fetchall()
    conn.close()
    return jsonify({r["key"]: r["value"] for r in rows})


@bp.put("/<app>")
@require_auth
def put_bulk(app):
    d = request.get_json(silent=True) or {}
    now = int(time.time())
    conn = db.connect()
    for k, v in d.items():
        conn.execute("INSERT INTO app_kv (user_id, app, key, value, updated_at) VALUES (?,?,?,?,?) "
                     "ON CONFLICT(user_id, app, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                     (g.user["id"], app, k,
                      v if isinstance(v, str) else json.dumps(v), now))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "n": len(d)})


@bp.delete("/<app>/<path:key>")
@require_auth
def del_key(app, key):
    conn = db.connect()
    conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=? AND key=?",
                 (g.user["id"], app, key))
    conn.commit(); conn.close()
    return jsonify({"ok": True})
