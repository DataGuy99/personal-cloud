"""Shared filesystem-path helpers for file operations — added 2026-07-21.

Maps the copyparty *vpaths* the app browses (e.g. /vault/sam/sub/x.pdf,
/public/books/y.epub) to real disk paths, with a hard traversal guard and a
permission verdict, so the download/delete endpoints (api/files.py) and the
shelf index (api/shelf.py) agree on where things live and who may touch them.

Layout mirrors sync_copyparty.py; PC_ROOT prefixes it for local dev.
See [[project-copyparty-layout-shelf]].
"""
import os
import db

ROOT = os.environ.get("PC_ROOT", "")
USERS = ROOT + "/users"
POOL = ROOT + "/storage/pool"
GROUPS = ROOT + "/groups"
STAGING = ROOT + "/staging"


class Denied(Exception):
    """Raised when the caller may not touch the resolved path."""


class NotFound(Exception):
    pass


def _under(base: str, *parts: str) -> str:
    """Join and confirm the result stays inside base (blocks ../ escapes)."""
    base_abs = os.path.abspath(base)
    full = os.path.abspath(os.path.join(base_abs, *parts))
    if full != base_abs and not full.startswith(base_abs + os.sep):
        raise Denied("path escapes its volume")
    return full


def _is_group_member(uid: int, slug: str) -> bool:
    conn = db.connect()
    row = conn.execute(
        "SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id "
        "WHERE gm.user_id=? AND lower(replace(g.name,' ','-'))=?",
        (uid, slug.lower())).fetchone()
    conn.close()
    return row is not None


def resolve(vpath: str, user: dict, need_write: bool = False):
    """vpath -> (disk_path, scope). Raises Denied/NotFound.

    Permission model (matches copyparty ACLs in sync_copyparty.py):
      /vault/<user>/…   owner (or admin) read+write
      /public|pool/<c>/… any authed read; admin-only write/delete
      /group/<slug>/…    members (or admin) read+write
    """
    parts = [p for p in vpath.strip("/").split("/") if p and p not in (".", "..")]
    if len(parts) < 2:
        raise Denied("unrecognized path")
    scope_top, rel = parts[0], parts[2:]
    # g.user is a sqlite3.Row — index, don't .get()
    is_admin = bool(user["is_admin"])

    if scope_top == "vault":
        owner = parts[1]
        if owner != user["username"] and not is_admin:
            raise Denied("not your vault")
        disk = _under(f"{USERS}/{owner}/private", *rel)
        return disk, "vault"

    if scope_top in ("public", "pool"):
        cat = parts[1]
        if need_write and not is_admin:
            raise Denied("shared library is admin-managed")
        disk = _under(f"{POOL}/{cat}", *rel)
        return disk, "pool"

    if scope_top == "group":
        slug = parts[1]
        if not (is_admin or _is_group_member(user["id"], slug)):
            raise Denied("not a member of this group")
        disk = _under(f"{GROUPS}/{slug}", *rel)
        return disk, "group"

    raise Denied("unknown scope")


def trash_dir_for(scope: str, vpath: str, user: dict) -> str:
    """Where a soft-deleted file from this scope should go (same volume)."""
    parts = vpath.strip("/").split("/")
    if scope == "vault":
        return f"{USERS}/{parts[1]}/.trash"
    if scope == "group":
        return f"{GROUPS}/{parts[1]}/.trash"
    return f"{POOL}/.trash"
