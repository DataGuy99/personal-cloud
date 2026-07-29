"""Whole-account export / import.

One JSON carries everything the platform knows about you: stream, hours,
sleep, metrics, workouts, meals, service pairings, and every ported
app's KV state (in localStorage shape, so it round-trips through the bridge).

Files are NOT embedded — media lives in copyparty on disk and would balloon
the payload. File *references* travel, so a restored stream still points at
the same vault paths.

Import never touches credentials (pw_hash / file_token / is_admin) and every
row is written scoped to the caller. You cannot import into someone else.
"""
import time, json
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth

bp = Blueprint("backup", __name__, url_prefix="/api")

FORMAT = "nook-export/1"

# table -> (natural key columns used to skip duplicates in merge mode)
DEDUPE = {
    "dump_items":      ("created_at", "kind", "content", "file_path"),
    "work_sessions":   ("started_at",),
    "sleep_sessions":  ("slept_at",),
    "body_metrics":    ("logged_at",),
    "workouts":        ("performed_at", "kind"),
    "meals":           ("eaten_at", "name"),
    "meal_plans":      ("plan_date", "meal_slot"),
}
# order matters: parents before children (FK remap)
SECTIONS = [
    ("stream",     "dump_items"),
    ("hours",      "work_sessions"),
    ("sleep",      "sleep_sessions"),
    ("metrics",    "body_metrics"),
    ("workouts",   "workouts"),
    ("meal_plans", "meal_plans"),
    ("meals",      "meals"),
]


def _rows(conn, table, uid):
    return [dict(r) for r in conn.execute(
        f"SELECT * FROM {table} WHERE user_id=?", (uid,)).fetchall()]


def _cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


@bp.get("/export")
@require_auth
def export():
    uid = g.user["id"]
    conn = db.connect()
    out = {
        "format": FORMAT,
        "exported_at": int(time.time()),
        "user": {"username": g.user["username"]},
        "files": {"included": False,
                  "note": "media stays in copyparty; stream rows keep their vault paths"},
    }

    for name, table in SECTIONS:
        out[name] = _rows(conn, table, uid)

    # workout sets hang off workouts
    wids = [w["id"] for w in out["workouts"]]
    sets = []
    if wids:
        ph = ",".join("?" * len(wids))
        sets = [dict(r) for r in conn.execute(
            f"SELECT * FROM workout_sets WHERE workout_id IN ({ph})", wids).fetchall()]
    out["workout_sets"] = sets

    out["services"] = [dict(r) for r in conn.execute(
        "SELECT service, enabled, settings FROM user_services WHERE user_id=?",
        (uid,)).fetchall()]

    # group membership travels by NAME so it can be re-linked on any box
    out["groups"] = [dict(r) for r in conn.execute(
        "SELECT g.id, g.name, g.kind, m.role FROM groups g "
        "JOIN group_members m ON m.group_id=g.id WHERE m.user_id=?", (uid,)).fetchall()]

    # every ported app's KV, in localStorage shape {key: value}
    apps = {}
    for r in conn.execute("SELECT DISTINCT app FROM app_kv WHERE user_id=?", (uid,)).fetchall():
        apps[r["app"]] = {
            k["key"]: k["value"] for k in conn.execute(
                "SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
                (uid, r["app"])).fetchall()}
    out["apps"] = apps

    conn.close()
    counts = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    counts["app_keys"] = sum(len(v) for v in apps.values())
    out["counts"] = counts
    return jsonify(out)


@bp.post("/import")
@require_auth
def do_import():
    """?mode=merge (default, skips duplicates) | replace (wipes your rows first).

    Replace auto-snapshots every app's KV before touching anything, so a bad
    import is always undoable from Settings -> Backups.
    """
    data = request.get_json(silent=True) or {}
    if data.get("format") != FORMAT:
        return jsonify({"error": f"unrecognized format (want {FORMAT})"}), 400
    mode = request.args.get("mode", "merge")
    if mode not in ("merge", "replace"):
        return jsonify({"error": "mode must be merge or replace"}), 400

    uid = g.user["id"]
    now = int(time.time())
    conn = db.connect()
    report, skipped = {}, {}

    # ── safety net first: snapshot current KV so replace is reversible
    if mode == "replace":
        for r in conn.execute("SELECT DISTINCT app FROM app_kv WHERE user_id=?",
                              (uid,)).fetchall():
            cur = {k["key"]: k["value"] for k in conn.execute(
                "SELECT key, value FROM app_kv WHERE user_id=? AND app=?",
                (uid, r["app"])).fetchall()}
            conn.execute("INSERT INTO kv_snapshots (user_id, app, created_at, data) "
                         "VALUES (?,?,?,?)", (uid, r["app"], now, json.dumps(cur)))

    # ── group id remap: old id -> my group with the same name.
    # Groups I OWNED get recreated if missing (disaster recovery should bring the
    # org back). Groups I was merely a member of are NOT recreated — that org
    # belongs to someone else and I'd only be forging a lookalike; the rows keep
    # their data and the link is reported as dropped, pending a re-invite.
    gmap = {}
    recreated = []
    for grp in data.get("groups", []):
        mine = conn.execute(
            "SELECT g.id FROM groups g JOIN group_members m ON m.group_id=g.id "
            "WHERE m.user_id=? AND g.name=?", (uid, grp.get("name"))).fetchone()
        if mine:
            gmap[grp.get("id")] = mine["id"]
        elif grp.get("role") == "owner":
            cur = conn.execute(
                "INSERT INTO groups (name, kind, created_by, created_at) VALUES (?,?,?,?)",
                (grp.get("name"), grp.get("kind") or "work", uid, now))
            new_gid = cur.lastrowid
            conn.execute("INSERT INTO group_members (group_id, user_id, role, joined_at) "
                         "VALUES (?,?,?,?)", (new_gid, uid, "owner", now))
            gmap[grp.get("id")] = new_gid
            recreated.append(grp.get("name"))
    unlinked = 0

    def remap_group(row):
        nonlocal unlinked
        if "group_id" in row and row.get("group_id") is not None:
            new = gmap.get(row["group_id"])
            if new is None:
                unlinked += 1
            row["group_id"] = new
        return row

    for name, table in SECTIONS:
        rows = data.get(name) or []
        cols = _cols(conn, table)
        if mode == "replace":
            conn.execute(f"DELETE FROM {table} WHERE user_id=?", (uid,))
        keys = DEDUPE.get(table, ())
        existing = set()
        if mode == "merge" and keys:
            for r in conn.execute(
                    f"SELECT {','.join(keys)} FROM {table} WHERE user_id=?", (uid,)).fetchall():
                existing.add(tuple(r[k] for k in keys))
        added = skip = 0
        idmap = {}
        for row in rows:
            old_id = row.get("id")
            row = remap_group(dict(row))
            if keys:
                sig = tuple(row.get(k) for k in keys)
                if mode == "merge" and sig in existing:
                    skip += 1
                    continue
                existing.add(sig)
            # meals point at a plan we may have just re-keyed
            if table == "meals" and row.get("plan_id") is not None:
                row["plan_id"] = report.get("_planmap", {}).get(row["plan_id"])
            payload = {k: v for k, v in row.items()
                       if k in cols and k not in ("id", "user_id")}
            payload["user_id"] = uid
            ph = ",".join("?" * len(payload))
            cur = conn.execute(
                f"INSERT INTO {table} ({','.join(payload)}) VALUES ({ph})",
                tuple(payload.values()))
            if old_id is not None:
                idmap[old_id] = cur.lastrowid
            added += 1
        if table == "meal_plans":
            report["_planmap"] = idmap
        if table == "workouts":
            report["_woutmap"] = idmap
        report[name] = added
        if skip:
            skipped[name] = skip

    # workout sets, remapped onto the new workout ids
    wmap = report.pop("_woutmap", {})
    report.pop("_planmap", None)
    scols = _cols(conn, "workout_sets")
    sadded = 0
    for s in data.get("workout_sets", []):
        wid = wmap.get(s.get("workout_id"))
        if wid is None:
            continue
        payload = {k: v for k, v in s.items() if k in scols and k not in ("id", "workout_id")}
        payload["workout_id"] = wid
        ph = ",".join("?" * len(payload))
        conn.execute(f"INSERT INTO workout_sets ({','.join(payload)}) VALUES ({ph})",
                     tuple(payload.values()))
        sadded += 1
    report["workout_sets"] = sadded

    # service pairings (upsert). settings can carry a group id (work.default_group),
    # which must ride the same remap or it dangles at a stranger's org.
    for s in data.get("services", []):
        st = s.get("settings") or {}
        if isinstance(st, str):
            try:
                st = json.loads(st)
            except Exception:
                st = {}
        if st.get("default_group") is not None:
            st["default_group"] = gmap.get(st["default_group"])
        conn.execute(
            "INSERT INTO user_services (user_id, service, enabled, settings, updated_at) "
            "VALUES (?,?,?,?,?) ON CONFLICT(user_id, service) DO UPDATE SET "
            "enabled=excluded.enabled, settings=excluded.settings, updated_at=excluded.updated_at",
            (uid, s.get("service"), 1 if s.get("enabled") else 0, json.dumps(st), now))
    report["services"] = len(data.get("services", []))

    # ── app KV.
    # MERGE means "add what's missing" -- so an app key I already have is NOT
    # overwritten. An app's whole history lives under one fat key; clobbering it
    # would erase everything logged since the backup was taken, which is the
    # opposite of what a merge promises. Conflicts are kept and REPORTED, and the
    # per-app importer in Settings offers union/replace with a preview.
    # REPLACE means "this file is the truth" -- wipe first, so renamed or deleted
    # keys don't resurrect.
    keyn = 0
    conflicts = {}
    for app, kv in (data.get("apps") or {}).items():
        if mode == "replace":
            conn.execute("DELETE FROM app_kv WHERE user_id=? AND app=?", (uid, app))
        mine = {r["key"]: r["value"] for r in conn.execute(
            "SELECT key, value FROM app_kv WHERE user_id=? AND app=?", (uid, app)).fetchall()}
        for k, v in kv.items():
            v = v if isinstance(v, str) else json.dumps(v)
            if mode == "merge" and k in mine and mine[k] != v:
                conflicts.setdefault(app, []).append(k)
                continue
            conn.execute(
                "INSERT INTO app_kv (user_id, app, key, value, updated_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(user_id, app, key) DO UPDATE SET "
                "value=excluded.value, updated_at=excluded.updated_at",
                (uid, app, k, v, now))
            keyn += 1
    report["app_keys"] = keyn
    if conflicts:
        report["_conflicts"] = conflicts

    conflicts = report.pop("_conflicts", {})
    conn.commit()
    conn.close()
    return jsonify({
        "ok": True, "mode": mode, "imported": report,
        "skipped_duplicates": skipped,
        "app_keys_kept": conflicts,
        "app_conflict_note": (
            "these app keys already existed and differ; your version was KEPT. "
            "To combine them, use the per-app Import in Backups — it previews the "
            "clash and can union both histories." if conflicts else None),
        "groups_recreated": recreated,
        "groups_unlinked": unlinked,
        "note": ("rows referencing an org you don't belong to kept their data but lost the "
                 "org link — ask its owner to re-add you" if unlinked else None),
    })
