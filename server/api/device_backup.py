"""Device backup ingest — added 2026-07-21.

Bulk backup of a user's own phone (photos/videos, and exported contacts / call
log / SMS) into their PRIVATE vault. Deliberately does NOT go through the
copyparty upload → staging-SSD → clamscan → promote pipeline: that pipeline is
for untrusted uploads and would (a) hammer the already-backlogged scanner and
(b) fill the 221 GB staging SSD with hundreds of GB of a user's own photos. A
user's own device backup is trusted, so we stream it straight to disk under
their private area, with a ../ guard and free-space backpressure.

  POST /api/backup/file      header X-Backup-Path: <relpath>, raw body = bytes
                              → /users/<user>/private/DeviceBackup/<relpath>
                              skips if a same-size file is already there.
  GET  /api/backup/capacity  free space on the backup disk + accept flag.
"""
import os, shutil
from flask import Blueprint, request, jsonify, g
import db
from api.util import require_auth
from api import storage_paths as sp

bp = Blueprint("device_backup", __name__, url_prefix="/api/backup")

# Keep this much free on the backup disk before refusing writes.
BACKUP_MIN_FREE = int(os.environ.get("PC_BACKUP_MIN_FREE", str(5 * 1024**3)))
BACKUP_SUBDIR = "DeviceBackup"


def _backup_root(user) -> str:
    return os.path.abspath(f"{sp.USERS}/{user['username']}/private/{BACKUP_SUBDIR}")


def _safe_dest(user, rel: str) -> str:
    base = _backup_root(user)
    parts = [p for p in rel.replace("\\", "/").split("/") if p and p not in (".", "..")]
    if not parts:
        raise sp.Denied("empty backup path")
    dest = os.path.abspath(os.path.join(base, *parts))
    if dest != base and not dest.startswith(base + os.sep):
        raise sp.Denied("path escapes backup area")
    return dest


def _free(path: str) -> int:
    try:
        # walk up to an existing ancestor for disk_usage
        p = path
        while p and not os.path.exists(p):
            p = os.path.dirname(p)
        return shutil.disk_usage(p or "/").free
    except OSError:
        return 0


@bp.get("/capacity")
@require_auth
def capacity():
    root = _backup_root(g.user)
    free = _free(root)
    return jsonify({"free": free, "min_free": BACKUP_MIN_FREE,
                    "accept_uploads": free > BACKUP_MIN_FREE})


@bp.post("/file")
@require_auth
def upload_file():
    rel = request.headers.get("X-Backup-Path", "").strip()
    if not rel:
        return jsonify({"error": "missing X-Backup-Path"}), 400
    try:
        dest = _safe_dest(g.user, rel)
    except sp.Denied as e:
        return jsonify({"error": str(e)}), 403

    # dedupe: same-size file already backed up → skip (client also tracks this)
    incoming = request.content_length
    if incoming and os.path.isfile(dest) and os.path.getsize(dest) == incoming:
        return jsonify({"ok": True, "skipped": True, "bytes": incoming})

    # backpressure on the backup disk
    if _free(os.path.dirname(dest)) <= BACKUP_MIN_FREE:
        return jsonify({"error": "backup disk full", "accept_uploads": False}), 507

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    try:
        with open(tmp, "wb") as f:
            shutil.copyfileobj(request.stream, f, length=1024 * 256)
        os.replace(tmp, dest)
    except Exception as e:
        try: os.remove(tmp)
        except OSError: pass
        return jsonify({"error": f"write failed: {e}"}), 500
    return jsonify({"ok": True, "skipped": False, "bytes": os.path.getsize(dest)})
