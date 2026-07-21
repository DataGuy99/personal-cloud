"""Shelf book library — added 2026-07-21.

Turns the raw files sitting in copyparty into a real book library. The Android
Shelf was a flat, one-level file browser over /vault/<user>, so PDFs nested in
subfolders (and the whole pooled books area) never surfaced as books. This
blueprint fixes that server-side, where it belongs:

  * recursively discovers book files across the caller's private vault AND the
    shared pool (books + docs — PDFs get categorised as "docs", which has no
    copyparty browse volume, so they were invisible everywhere),
  * caches a cleaned title + best-effort author per file (see shelf_meta),
  * renders + caches a cover on demand (first-page render / embedded / online),
  * streams the file itself (with Range support) so the reader works regardless
    of copyparty volume config.

Heavy work is incremental: enumeration is a cheap os.scandir walk; per-file
metadata extraction is budgeted per request (INDEX_BUDGET) so no single call
stalls on a 60 GB library — repeated calls fill the cache, and the response
reports indexing progress. Covers render lazily when first requested.

Paths mirror sync_copyparty.py's layout, with a PC_ROOT prefix so this runs on
the real box (prefix "") and against a local test tree in dev.
"""
import os, time
from flask import Blueprint, request, jsonify, g, send_file, abort
import db
from api.util import require_auth
from api import shelf_meta as meta

bp = Blueprint("shelf", __name__, url_prefix="/api/shelf")

# Filesystem roots (see [[project-copyparty-layout-shelf]]). PC_ROOT lets dev
# point the whole tree at a scratch dir; on the server it's "".
ROOT = os.environ.get("PC_ROOT", "")
USERS = ROOT + "/users"
POOL = ROOT + "/storage/pool"
COVERS = os.environ.get("PC_SHELF_COVERS", ROOT + "/storage/.shelf-covers")

# Shared book locations every authenticated user may read.
POOL_BOOK_DIRS = ["books", "docs", "audiobooks"]

INDEX_BUDGET = 400          # max NEW files to extract metadata for per request
SCAN_CAP = 20000            # safety ceiling on files enumerated per call


def _ensure_table():
    conn = db.connect()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shelf_index (
            id          TEXT PRIMARY KEY,   -- sha1(vpath)[:16]
            owner_id    INTEGER,            -- user id for vault; NULL = pooled
            scope       TEXT,               -- 'vault' | 'pool'
            vpath       TEXT,               -- logical path (for open/serve)
            disk_path   TEXT,
            title       TEXT,
            author      TEXT,
            ext         TEXT,
            size        INTEGER,
            mtime       INTEGER,
            cover_state TEXT DEFAULT 'unknown',  -- unknown|ready|none
            indexed_at  INTEGER
        )""")
    conn.commit()
    conn.close()


def _iter_book_files(base_dir, vprefix):
    """Yield (vpath, disk_path, ext, size, mtime) for book files under base_dir."""
    if not os.path.isdir(base_dir):
        return
    count = 0
    for dirpath, dirnames, filenames in os.walk(base_dir):
        # skip our own cover cache and any dotfolders
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in meta.BOOK_EXTS:
                continue
            disk = os.path.join(dirpath, fn)
            rel = os.path.relpath(disk, base_dir).replace(os.sep, "/")
            vpath = f"{vprefix}/{rel}"
            try:
                st = os.stat(disk)
            except OSError:
                continue
            yield vpath, disk, ext, st.st_size, int(st.st_mtime)
            count += 1
            if count >= SCAN_CAP:
                return


def _roots_for(user):
    """(base_dir, vprefix, scope, owner_id) tuples the caller can see."""
    uname = user["username"]
    roots = [(f"{USERS}/{uname}/private", f"/vault/{uname}", "vault", user["id"])]
    for cat in POOL_BOOK_DIRS:
        roots.append((f"{POOL}/{cat}", f"/pool/{cat}", "pool", None))
    return roots


def _reindex(user):
    """Sync the cache with disk. Returns (total_seen, newly_indexed, pending)."""
    conn = db.connect()
    # existing rows for this caller's visible scope, keyed by vpath -> (mtime,size)
    rows = conn.execute(
        "SELECT id, vpath, mtime, size FROM shelf_index "
        "WHERE owner_id=? OR owner_id IS NULL", (user["id"],)).fetchall()
    known = {r["vpath"]: (r["mtime"], r["size"], r["id"]) for r in rows}
    seen = set()
    total = new = 0
    budget = INDEX_BUDGET
    now = int(time.time())
    for base_dir, vprefix, scope, owner in _roots_for(user):
        for vpath, disk, ext, size, mtime in _iter_book_files(base_dir, vprefix):
            total += 1
            seen.add(vpath)
            prev = known.get(vpath)
            if prev and prev[0] == mtime and prev[1] == size:
                continue  # unchanged, already indexed
            if budget <= 0:
                continue  # defer to a later call
            title, author = meta.resolve_title_author(disk, ext)
            bid = meta.book_id(vpath)
            conn.execute(
                "INSERT INTO shelf_index "
                "(id, owner_id, scope, vpath, disk_path, title, author, ext, "
                " size, mtime, cover_state, indexed_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?, 'unknown', ?) "
                "ON CONFLICT(id) DO UPDATE SET title=excluded.title, "
                "author=excluded.author, size=excluded.size, mtime=excluded.mtime, "
                "cover_state='unknown', indexed_at=excluded.indexed_at",
                (bid, owner, scope, vpath, disk, title, author, ext,
                 size, mtime, now))
            budget -= 1
            new += 1
    # prune rows whose file vanished
    gone = [vp for vp in known if vp not in seen]
    for vp in gone:
        conn.execute("DELETE FROM shelf_index WHERE id=?", (known[vp][2],))
    conn.commit()
    conn.close()
    # pending = files seen on disk but not yet in the cache (budget ran out)
    pending = _count_pending(user, seen)
    return total, new, pending


def _count_pending(user, seen):
    conn = db.connect()
    have = {r["vpath"] for r in conn.execute(
        "SELECT vpath FROM shelf_index WHERE owner_id=? OR owner_id IS NULL",
        (user["id"],)).fetchall()}
    conn.close()
    return len(seen - have)


@bp.get("/books")
@require_auth
def books():
    """The caller's library. ?scan=0 skips the disk walk (cache-only, fast)."""
    _ensure_table()
    indexing = None
    if request.args.get("scan", "1") != "0":
        total, new, pending = _reindex(g.user)
        indexing = {"total": total, "indexed_new": new, "pending": pending}
    conn = db.connect()
    rows = conn.execute(
        "SELECT id, scope, vpath, title, author, ext, size FROM shelf_index "
        "WHERE owner_id=? OR owner_id IS NULL "
        "ORDER BY title COLLATE NOCASE", (g.user["id"],)).fetchall()
    conn.close()
    books = [{
        "id": r["id"], "scope": r["scope"], "title": r["title"],
        "author": r["author"], "ext": r["ext"].lstrip("."), "size": r["size"],
        "vpath": r["vpath"],
        "cover_url": f"/api/shelf/cover/{r['id']}",
        "file_url": f"/api/shelf/file/{r['id']}",
    } for r in rows]
    return jsonify({"books": books, "count": len(books), "indexing": indexing})


def _lookup(bid, user):
    conn = db.connect()
    row = conn.execute(
        "SELECT * FROM shelf_index WHERE id=? AND (owner_id=? OR owner_id IS NULL)",
        (bid, user["id"])).fetchone()
    conn.close()
    return row


@bp.get("/cover/<bid>")
@require_auth
def cover(bid):
    row = _lookup(bid, g.user)
    if not row:
        abort(404)
    out = os.path.join(COVERS, f"{bid}.jpg")
    if not os.path.exists(out):
        ok = meta.render_cover(row["disk_path"], row["ext"], out)
        if not ok and request.args.get("online", "1") != "0":
            ok = meta.fetch_online_cover(row["title"], row["author"], out)
        state = "ready" if ok else "none"
        conn = db.connect()
        conn.execute("UPDATE shelf_index SET cover_state=? WHERE id=?", (state, bid))
        conn.commit()
        conn.close()
        if not ok:
            abort(404)
    resp = send_file(out, mimetype="image/jpeg", conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@bp.get("/file/<bid>")
@require_auth
def serve_file(bid):
    """Stream the book itself (Range-enabled) for the reader / external viewer."""
    row = _lookup(bid, g.user)
    if not row or not os.path.exists(row["disk_path"]):
        abort(404)
    mimes = {".pdf": "application/pdf", ".epub": "application/epub+zip"}
    return send_file(row["disk_path"],
                     mimetype=mimes.get(row["ext"], "application/octet-stream"),
                     as_attachment=False, conditional=True,
                     download_name=os.path.basename(row["disk_path"]))


@bp.post("/reindex")
@require_auth
def reindex():
    """Force a full re-extract for the caller's scope (drops cached rows).
    Clears the caller's vault rows and the shared pool rows they can see;
    re-extraction is deterministic so refreshing pooled rows is harmless."""
    _ensure_table()
    conn = db.connect()
    conn.execute("DELETE FROM shelf_index WHERE owner_id=? OR owner_id IS NULL",
                 (g.user["id"],))
    conn.commit()
    conn.close()
    total, new, pending = _reindex(g.user)
    return jsonify({"ok": True, "total": total, "indexed_new": new, "pending": pending})
