"""Journal — private per-user entries."""
import time
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("journal", __name__, url_prefix="/api/journal")


@bp.post("")
@require_auth
def create():
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    conn.execute("INSERT INTO journal_entries (user_id, created_at, title, body) VALUES (?,?,?,?)",
                 (g.user["id"], int(time.time()), d.get("title"), d.get("body")))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@bp.get("")
@require_auth
def list_entries():
    conn = db.connect()
    rows = conn.execute("SELECT * FROM journal_entries WHERE user_id=? "
                        "ORDER BY created_at DESC LIMIT 100", (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.put("/<int:eid>")
@require_auth
def update(eid):
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    cur = conn.execute("UPDATE journal_entries SET title=?, body=?, updated_at=? "
                       "WHERE id=? AND user_id=?",
                       (d.get("title"), d.get("body"), int(time.time()), eid, g.user["id"]))
    conn.commit(); ok = cur.rowcount; conn.close()
    return (jsonify({"ok": True}) if ok else (jsonify({"error": "not found"}), 404))


@bp.delete("/<int:eid>")
@require_auth
def delete(eid):
    conn = db.connect()
    cur = conn.execute("DELETE FROM journal_entries WHERE id=? AND user_id=?", (eid, g.user["id"]))
    conn.commit(); ok = cur.rowcount; conn.close()
    return (jsonify({"ok": True}) if ok else (jsonify({"error": "not found"}), 404))
