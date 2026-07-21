"""File operations: storage health, download, and (soft) delete — added 2026-07-21.

Two operator needs Samuel raised:

  1. Staging-disk safety. Uploads land on the ~221 GB SSD staging ("drop") to be
     scanned, then the scanner MOVES clean files onto the big MergerFS HDD pool.
     If uploads outrun the scanner, the SSD fills. `GET /api/storage/health`
     exposes staging + pool headroom and the scan-queue depth so the client can
     apply backpressure (pace uploads, stop when `accept_uploads` is false)
     instead of blindly filling the disk.

  2. Download + delete for media. `GET /api/files/get` streams any file the
     caller may read (Range-enabled, for movies/shows/music/books). `POST
     /api/files/delete` removes a file the caller owns — SOFT delete into a
     .trash sibling so an accidental tap is recoverable (never a hard unlink).

All paths route through storage_paths.resolve(), which enforces the same
per-scope permissions copyparty uses and blocks ../ traversal.
"""
import os, time, shutil
from flask import Blueprint, request, jsonify, g, send_file, abort
import db
from api.util import require_auth
from api import storage_paths as sp
from api import shelf_meta as meta

bp = Blueprint("files", __name__, url_prefix="/api")

# Keep this much SSD free before we tell clients to stop uploading. The MergerFS
# pool keeps its own 10 G floor; this guards the staging SSD specifically.
STAGING_MIN_FREE = int(os.environ.get("PC_STAGING_MIN_FREE", str(15 * 1024**3)))


def _usage(path):
    try:
        u = shutil.disk_usage(path)
        return {"total": u.total, "used": u.used, "free": u.free}
    except OSError:
        return None


def _scan_queue():
    """Pending scan backlog from the quarantine table (count + bytes)."""
    try:
        conn = db.connect()
        row = conn.execute(
            "SELECT COUNT(*) c, COALESCE(SUM(size_bytes),0) b "
            "FROM quarantine WHERE status='pending'").fetchone()
        conn.close()
        return {"pending": row["c"], "pending_bytes": row["b"]}
    except Exception:
        return {"pending": 0, "pending_bytes": 0}


# NB: distinct from app.py's /api/health/storage (a perms/writability probe).
# This one is about free space + scan backlog, for upload backpressure.
@bp.get("/storage/capacity")
@require_auth
def storage_capacity():
    staging = _usage(sp.STAGING)
    pool = _usage(sp.POOL)
    queue = _scan_queue()
    # Headroom on the staging SSD is what gates uploads.
    accept = True
    if staging is not None:
        accept = staging["free"] > STAGING_MIN_FREE
    return jsonify({
        "staging": staging,          # the ~221 GB scan SSD ("drop")
        "pool": pool,                # the big MergerFS HDD library
        "scan_queue": queue,
        "accept_uploads": accept,
        "staging_min_free": STAGING_MIN_FREE,
    })


@bp.get("/files/get")
@require_auth
def files_get():
    """Stream a file for download. ?vpath=/vault/<user>/… (Range-enabled)."""
    vpath = request.args.get("vpath", "")
    try:
        disk, _ = sp.resolve(vpath, g.user, need_write=False)
    except sp.Denied as e:
        return jsonify({"error": str(e)}), 403
    if not os.path.isfile(disk):
        abort(404)
    return send_file(disk, as_attachment=True, conditional=True,
                     download_name=os.path.basename(disk))


@bp.post("/files/delete")
@require_auth
def files_delete():
    """Soft-delete a file the caller owns: move it to a .trash sibling.

    Body: {"vpath": "/vault/<user>/…"}. Recoverable; never a hard unlink.
    """
    data = request.get_json(silent=True) or {}
    vpath = data.get("vpath", "")
    try:
        disk, scope = sp.resolve(vpath, g.user, need_write=True)
    except sp.Denied as e:
        return jsonify({"error": str(e)}), 403
    if not os.path.isfile(disk):
        return jsonify({"error": "not found"}), 404

    trash = sp.trash_dir_for(scope, vpath, g.user)
    os.makedirs(trash, exist_ok=True)
    stamp = int(time.time())
    dest = os.path.join(trash, f"{stamp}-{os.path.basename(disk)}")
    try:
        shutil.move(disk, dest)
    except OSError as e:
        return jsonify({"error": f"delete failed: {e}"}), 500

    # keep the shelf index honest if we just trashed a book (key on the stable
    # id derived from vpath — disk_path separators differ across OSes)
    try:
        conn = db.connect()
        conn.execute("DELETE FROM shelf_index WHERE id=? OR disk_path=?",
                     (meta.book_id(vpath), disk))
        conn.commit()
        conn.close()
    except Exception:
        pass
    return jsonify({"ok": True, "trashed_to": dest.replace(sp.ROOT, "", 1)})
