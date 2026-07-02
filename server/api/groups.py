"""Groups — the sharing primitive. Create groups, manage members/roles.

Roles: owner (full control) > manager (sees members' group-scoped data,
e.g. contract-manager work views) > member (participates, links own data).
"""
import os, sys, time, subprocess
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("groups", __name__, url_prefix="/api/groups")


def membership(conn, group_id, user_id):
    return conn.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?",
                        (group_id, user_id)).fetchone()


@bp.post("")
@require_auth
def create_group():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    conn = db.connect()
    try:
        cur = conn.execute("INSERT INTO groups (name, kind, created_by, created_at) VALUES (?,?,?,?)",
                           (name, d.get("kind"), g.user["id"], int(time.time())))
        conn.execute("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?,'owner',?)",
                     (cur.lastrowid, g.user["id"], int(time.time())))
        conn.commit()
        gid = cur.lastrowid
    except Exception:
        conn.close()
        return jsonify({"error": "group name taken"}), 409
    conn.close()
    try:
        subprocess.run([sys.executable,
                        os.path.join(os.path.dirname(__file__), "..", "sync_copyparty.py")],
                       check=True, capture_output=True, timeout=30)
    except Exception:
        pass  # conf regenerates on next sync; group data APIs work regardless
    return jsonify({"ok": True, "id": gid})


@bp.get("")
@require_auth
def my_groups():
    conn = db.connect()
    rows = conn.execute(
        "SELECT gr.id, gr.name, gr.kind, gm.role FROM groups gr "
        "JOIN group_members gm ON gm.group_id=gr.id WHERE gm.user_id=?",
        (g.user["id"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@bp.post("/<int:gid>/members")
@require_auth
def add_member(gid):
    d = request.get_json(silent=True) or {}
    conn = db.connect()
    me = membership(conn, gid, g.user["id"])
    if not me or me["role"] not in ("owner", "manager"):
        conn.close()
        return jsonify({"error": "owner/manager only"}), 403
    target = db.get_user(d.get("username", ""))
    if not target:
        conn.close()
        return jsonify({"error": "no such user"}), 404
    role = d.get("role", "member")
    if role not in ("manager", "member") and me["role"] != "owner":
        conn.close()
        return jsonify({"error": "only owner assigns that role"}), 403
    try:
        conn.execute("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                     (gid, target["id"], role, int(time.time())))
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "already a member"}), 409
    conn.close()
    return jsonify({"ok": True})


@bp.get("/<int:gid>/work")
@require_auth
def group_work(gid):
    """Contract-manager basis: managers/owners see members' group-scoped
    work sessions (dates, durations, notes). Members see only their own."""
    conn = db.connect()
    me = membership(conn, gid, g.user["id"])
    if not me:
        conn.close()
        return jsonify({"error": "not a member"}), 403
    if me["role"] in ("owner", "manager"):
        rows = conn.execute(
            "SELECT w.*, u.username FROM work_sessions w JOIN users u ON u.id=w.user_id "
            "WHERE w.group_id=? ORDER BY w.started_at DESC LIMIT 200", (gid,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT w.*, ? AS username FROM work_sessions w "
            "WHERE w.group_id=? AND w.user_id=? ORDER BY w.started_at DESC LIMIT 200",
            (g.user["username"], gid, g.user["id"])).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
