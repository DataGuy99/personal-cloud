"""Dump — telegram-style feeds. Personal dump = your Saved Messages
(private); group dumps = shared chats, membership-gated. Items are text,
links (auto-detected), or file references (files themselves live in
copyparty vaults/group spaces and pass through the scan pipeline)."""
import time, re
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("dump", __name__, url_prefix="/api/dump")
URL_RE = re.compile(r"^https?://\S+$")


def _member(conn, gid, uid):
    return conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                        (gid, uid)).fetchone()


@bp.post("")
@require_auth
def post_item():
    d = request.get_json(silent=True) or {}
    gid = d.get("group_id")
    conn = db.connect()
    if gid and not _member(conn, gid, g.user["id"]):
        conn.close(); return jsonify({"error": "not a member"}), 403
    if d.get("file_path"):
        kind, content = "file", d.get("content")
    else:
        content = (d.get("content") or "").strip()
        if not content:
            conn.close(); return jsonify({"error": "empty"}), 400
        kind = "link" if URL_RE.match(content) else "text"
    conn.execute("INSERT INTO dump_items (user_id, group_id, created_at, kind, content, file_path) "
                 "VALUES (?,?,?,?,?,?)",
                 (g.user["id"], gid, int(time.time()), kind, content, d.get("file_path")))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "kind": kind})


@bp.get("")
@require_auth
def feed():
    gid = request.args.get("group_id", type=int)
    before = request.args.get("before", type=int) or 2**31
    conn = db.connect()
    if gid:
        if not _member(conn, gid, g.user["id"]):
            conn.close(); return jsonify({"error": "not a member"}), 403
        rows = conn.execute(
            "SELECT di.*, u.username FROM dump_items di JOIN users u ON u.id=di.user_id "
            "WHERE di.group_id=? AND di.created_at<? ORDER BY di.created_at DESC LIMIT 50",
            (gid, before)).fetchall()
    else:
        rows = conn.execute(
            "SELECT di.*, ? AS username FROM dump_items di "
            "WHERE di.group_id IS NULL AND di.user_id=? AND di.created_at<? "
            "ORDER BY di.created_at DESC LIMIT 50",
            (g.user["username"], g.user["id"], before)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in list(rows)[::-1]])  # oldest-first for chat render


@bp.delete("/<int:iid>")
@require_auth
def delete_item(iid):
    conn = db.connect()
    cur = conn.execute("DELETE FROM dump_items WHERE id=? AND user_id=?", (iid, g.user["id"]))
    conn.commit(); ok = cur.rowcount; conn.close()
    return (jsonify({"ok": True}) if ok else (jsonify({"error": "not yours"}), 404))
