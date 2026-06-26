#!/usr/bin/env python3
"""
copyparty AFTER-upload hook (xau) — register a PENDING quarantine row.

With the Option-1 architecture, uploads land directly in /staging/<scope>/...
because the upload volumes are staging-backed. This hook does NOT move the file;
it just records that a file is pending scan. The scanner-worker handles scanning
and moving cleared files to their real destination.

Wire-up (systemd ExecStart):
    --xau f,j,/opt/copyparty/hooks/xau-register.py
  f = fork (don't block other uploads)
  j = pass upload info as JSON on argv[1]

Maps the staging path to the intended real destination:
  /staging/vault/bob/foo.pdf   -> /users/bob/private/foo.pdf       (scope vault)
  /staging/shared/work/x.docx  -> /shares/alice-bob-work/x.docx    (scope vault)
  /staging/public/movies/y.mkv -> /storage/pool/movies/y.mkv       (scope public)
  /staging/public/unknown/z    -> /storage/pool/unknown/z          (scope public)
"""
import sys, os, json, uuid, time, sqlite3, logging

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

DB = "/opt/copyparty/shares.db"

# Shared-space slug -> real /shares folder name
SHARED_MAP = {
    "work":   "alice-bob-work",
    "baking": "alice-sil-baking",
}

def map_destination(ap):
    """
    ap is the absolute staging path, e.g. /staging/vault/bob/sub/foo.pdf
    Returns (intended_dest_dir, dest_scope) where intended_dest_dir is the
    real destination FOLDER (filename appended later by scanner).
    """
    rel = ap.replace("/staging/", "", 1)        # vault/bob/sub/foo.pdf
    parts = rel.split("/")
    scope_top = parts[0]                          # vault | shared | public
    folder_parts = parts[:-1]                     # drop filename

    if scope_top == "vault":
        # vault/<user>/<sub...>/file -> /users/<user>/private/<sub...>
        user = parts[1] if len(parts) > 1 else "unknown"
        sub = "/".join(folder_parts[2:])
        dest = f"/users/{user}/private" + (f"/{sub}" if sub else "")
        return dest, "vault"

    if scope_top == "shared":
        slug = parts[1] if len(parts) > 1 else ""
        real = SHARED_MAP.get(slug, slug)
        sub = "/".join(folder_parts[2:])
        dest = f"/shares/{real}" + (f"/{sub}" if sub else "")
        return dest, "vault"

    if scope_top == "public":
        cat = parts[1] if len(parts) > 1 else "unknown"
        sub = "/".join(folder_parts[2:])
        dest = f"/storage/pool/{cat}" + (f"/{sub}" if sub else "")
        return dest, "public"

    return "/storage/pool/unknown", "public"

def main():
    if len(sys.argv) < 2:
        sys.exit(0)
    try:
        info = json.loads(sys.argv[1])
    except (json.JSONDecodeError, TypeError):
        logging.error(f"xau-register: unparseable input: {sys.argv[1][:200]}")
        sys.exit(0)

    ap       = info.get("ap", "")     # absolute staging path on disk
    user     = info.get("user", "anonymous")
    filename = os.path.basename(ap) or info.get("fn", "unnamed")
    size     = info.get("sz", 0)
    ip       = info.get("ip", "?")
    wark     = info.get("wark", "")

    if not ap.startswith("/staging/"):
        # Shouldn't happen with staging-backed upload vols; log and bail safely.
        logging.error(f"xau-register: upload not in staging: {ap}")
        sys.exit(0)

    intended_dest, scope = map_destination(ap)
    qid = str(uuid.uuid4())
    try:
        conn = sqlite3.connect(DB, timeout=10)
        conn.execute(
            "INSERT INTO quarantine "
            "(id, owner, filename, staging_path, intended_dest, dest_scope, "
            " size_bytes, sha256, status, uploaded_at, ip_address) "
            "VALUES (?,?,?,?,?,?,?,?,'pending',?,?)",
            (qid, user, filename, ap, intended_dest, scope,
             size, wark, int(time.time()), ip)
        )
        conn.commit()
        conn.close()
        logging.info(f"PENDING id={qid} user={user} file={filename} "
                     f"staging={ap} -> dest={intended_dest} scope={scope}")
    except Exception as e:
        logging.error(f"xau-register DB insert failed for {filename}: {e}")

    sys.exit(0)

if __name__ == "__main__":
    main()
