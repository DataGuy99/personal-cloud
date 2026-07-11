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
    """Write keys. ?mode= decides what happens when a key already exists:

      merge   (default) incoming wins per key; my other keys survive.
                        This is the bridge's normal sync, do not change it.
      replace           incoming is the whole truth; absent keys are DELETED.
                        (?replace=1 is the legacy spelling; the bridge uses it.)
      keep              only add keys I don't have. Nothing of mine is touched.
      union             conflicting JSON arrays are combined; keys that can't be
                        combined fall back to KEEP (never silently destroyed).
    """
    d = request.get_json(silent=True) or {}
    mode = request.args.get("mode") or ("replace" if request.args.get("replace") == "1" else "merge")
    if mode not in ("merge", "replace", "keep", "union"):
        return jsonify({"error": "mode must be merge, replace, keep or union"}), 400
    now = int(time.time())
    conn = db.connect()

    mine = {r["key"]: r["value"] for r in conn.execute(
        "SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
        (g.user["id"], app)).fetchall()}

    if mode == "replace":
        if d:
            ph = ",".join("?" * len(d))
            conn.execute(f"DELETE FROM app_kv WHERE user_id=? AND app=? AND key NOT IN ({ph})",
                         (g.user["id"], app, *d.keys()))
        else:
            conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=?", (g.user["id"], app))

    written = kept = unioned = 0
    fell_back = []
    for k, v in d.items():
        v = v if isinstance(v, str) else json.dumps(v)
        if k in mine and mine[k] != v:
            if mode == "keep":
                kept += 1
                continue
            if mode == "union":
                merged, info = _union(mine[k], v)
                if merged is None:
                    kept += 1
                    fell_back.append({"key": k, "reason": info.get("reason"),
                                      "kept": "yours"})
                    continue
                v = merged
                unioned += 1
        conn.execute("INSERT INTO app_kv (user_id, app, key, value, updated_at) VALUES (?,?,?,?,?) "
                     "ON CONFLICT(user_id, app, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                     (g.user["id"], app, k, v, now))
        written += 1

    conn.commit(); conn.close()
    out = {"ok": True, "mode": mode, "n": written}
    if kept:
        out["kept_yours"] = kept
    if unioned:
        out["unioned"] = unioned
    if fell_back:
        out["could_not_combine"] = fell_back
    return jsonify(out)


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


def _role(conn, gid, uid):
    r = conn.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?",
                     (gid, uid)).fetchone()
    return r["role"] if r else None


@bp.get("/g/<int:gid>/<app>")
@require_auth
def g_get(gid, app):
    conn = db.connect()
    if not _role(conn, gid, g.user["id"]):
        conn.close(); return jsonify({"error": "not a member"}), 403
    rows = conn.execute("SELECT key, value FROM group_kv WHERE group_id=? AND app=?",
                        (gid, app)).fetchall()
    conn.close()
    return jsonify({r["key"]: r["value"] for r in rows})


@bp.put("/g/<int:gid>/<app>")
@require_auth
def g_put(gid, app):
    conn = db.connect()
    if _role(conn, gid, g.user["id"]) not in ("owner", "manager"):
        conn.close(); return jsonify({"error": "managers only"}), 403
    d = request.get_json(silent=True) or {}
    now = int(time.time())
    if request.args.get("replace") == "1":
        if d:
            ph = ",".join("?" * len(d))
            conn.execute(f"DELETE FROM group_kv WHERE group_id=? AND app=? AND key NOT IN ({ph})",
                         (gid, app, *d.keys()))
        else:
            conn.execute("DELETE FROM group_kv WHERE group_id=? AND app=?", (gid, app))
    for k, v in d.items():
        conn.execute("INSERT INTO group_kv (group_id, app, key, value, updated_at, updated_by) "
                     "VALUES (?,?,?,?,?,?) ON CONFLICT(group_id, app, key) DO UPDATE SET "
                     "value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
                     (gid, app, k, v if isinstance(v, str) else json.dumps(v), now, g.user["id"]))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "n": len(d)})

# ── conflict handling ──────────────────────────────────────────────────────
# An app's state lives under a few fat keys ("history" is one JSON array of every
# session). So a naive key-level overwrite silently destroys everything logged
# since the backup. These helpers make the collision visible and let the caller
# pick, rather than guessing on their behalf.

ID_FIELDS = ("id", "uuid", "_id", "key", "date", "ts", "timestamp",
             "performed_at", "logged_at", "when")


def _union(mine_raw, theirs_raw):
    """Try to combine two JSON arrays into one. Returns (merged_json, info).
    merged_json is None when the values can't be safely combined -- we do NOT
    guess at a shape we don't understand."""
    try:
        a = json.loads(mine_raw)
        b = json.loads(theirs_raw)
    except Exception:
        return None, {"mergeable": False, "reason": "not JSON"}
    if not (isinstance(a, list) and isinstance(b, list)):
        return None, {"mergeable": False, "reason": "not a JSON array"}

    if a and b and all(isinstance(x, dict) for x in a + b):
        for f in ID_FIELDS:
            if all(f in x for x in a) and all(f in x for x in b):
                mine_ids = {x[f] for x in a}
                overlap = sum(1 for x in b if x[f] in mine_ids)
                seen = {}
                for x in a:
                    seen[x[f]] = x
                for x in b:          # same identity -> the incoming file wins
                    seen[x[f]] = x
                merged = list(seen.values())
                try:
                    merged.sort(key=lambda x: x[f])
                except Exception:
                    pass
                return json.dumps(merged), {
                    "mergeable": True, "strategy": "union by '%s'" % f,
                    "mine_items": len(a), "theirs_items": len(b),
                    "union_items": len(merged), "overlapping_items": overlap}
        return None, {"mergeable": False,
                      "reason": "objects share no id/date field to match on"}

    if all(not isinstance(x, (dict, list)) for x in a + b):
        merged = list(dict.fromkeys(list(a) + [x for x in b if x not in a]))
        return json.dumps(merged), {
            "mergeable": True, "strategy": "set union",
            "mine_items": len(a), "theirs_items": len(b),
            "union_items": len(merged),
            "overlapping_items": len(a) + len(b) - len(merged)}

    return None, {"mergeable": False, "reason": "array items are mixed types"}


@bp.post("/<app>/preview")
@require_auth
def preview(app):
    """Dry run. What would importing this payload actually do to my data?
    Writes nothing."""
    incoming = request.get_json(silent=True) or {}
    conn = db.connect()
    mine = {r["key"]: r["value"] for r in conn.execute(
        "SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
        (g.user["id"], app)).fetchall()}
    conn.close()

    keys, n_new = [], 0
    n_same = n_conflict = n_unionable = 0
    for k, v in incoming.items():
        v = v if isinstance(v, str) else json.dumps(v)
        if k not in mine:
            keys.append({"key": k, "status": "new", "theirs_bytes": len(v)})
            n_new += 1
        elif mine[k] == v:
            keys.append({"key": k, "status": "identical"})
            n_same += 1
        else:
            merged, info = _union(mine[k], v)
            row = {"key": k, "status": "conflict",
                   "mine_bytes": len(mine[k]), "theirs_bytes": len(v)}
            row.update(info)
            keys.append(row)
            n_conflict += 1
            if merged is not None:
                n_unionable += 1
    only_mine = [k for k in mine if k not in incoming]
    for k in only_mine:
        keys.append({"key": k, "status": "only_mine", "mine_bytes": len(mine[k])})

    return jsonify({
        "app": app,
        "keys": keys,
        "summary": {"new": n_new, "identical": n_same, "conflicts": n_conflict,
                    "conflicts_mergeable": n_unionable,
                    "only_on_server": len(only_mine)},
        "modes": {
            "union":   "combine both where possible; on a tie the file wins. Keeps your keys that aren't in the file.",
            "keep":    "add only what's missing. Nothing of yours is touched.",
            "merge":   "the file wins on every shared key. Your extra keys survive.",
            "replace": "the file becomes the whole truth. Anything not in it is deleted.",
        },
    })
