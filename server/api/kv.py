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
    """Upsert keys. ?replace=1 = authoritative snapshot: keys absent from the
    payload are DELETED (prevents stale-key resurrection on hydrate)."""
    d = request.get_json(silent=True) or {}
    now = int(time.time())
    conn = db.connect()
    if request.args.get("replace") == "1":
        if d:
            ph = ",".join("?" * len(d))
            conn.execute(f"DELETE FROM app_kv WHERE user_id=? AND app=? AND key NOT IN ({ph})",
                         (g.user["id"], app, *d.keys()))
        else:
            conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=?", (g.user["id"], app))
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


@bp.delete("/<app>")
@require_auth
def clear_app(app):
    """Nuke all my keys for an app (recovery path before clean re-import)."""
    conn = db.connect()
    cur = conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=?", (g.user["id"], app))
    conn.commit(); n = cur.rowcount; conn.close()
    return jsonify({"ok": True, "deleted": n})


@bp.post("/<app>/snapshot")
@require_auth
def snap(app):
    import json as _j
    conn = db.connect()
    rows = conn.execute("SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
                        (g.user["id"], app)).fetchall()
    blob = _j.dumps({r["key"]: r["value"] for r in rows})
    conn.execute("INSERT INTO kv_snapshots (user_id, app, created_at, data) VALUES (?,?,?,?)",
                 (g.user["id"], app, int(time.time()), blob))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "keys": len(rows)})


@bp.get("/<app>/snapshots")
@require_auth
def snaps(app):
    conn = db.connect()
    rows = conn.execute("SELECT id, created_at, length(data) AS bytes FROM kv_snapshots "
                        "WHERE user_id=? AND app=? ORDER BY created_at DESC LIMIT 30",
                        (g.user["id"], app)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("/<app>/restore/<int:sid>")
@require_auth
def restore(app, sid):
    import json as _j
    conn = db.connect()
    row = conn.execute("SELECT data FROM kv_snapshots WHERE id=? AND user_id=? AND app=?",
                       (sid, g.user["id"], app)).fetchone()
    if not row:
        conn.close(); return jsonify({"error": "not found"}), 404
    kv = _j.loads(row["data"])
    conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=?", (g.user["id"], app))
    now = int(time.time())
    for k, v in kv.items():
        conn.execute("INSERT INTO app_kv (user_id, app, key, value, updated_at) VALUES (?,?,?,?,?)",
                     (g.user["id"], app, k, v, now))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "keys": len(kv)})
