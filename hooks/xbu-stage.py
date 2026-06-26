#!/usr/bin/env python3
"""
copyparty BEFORE-upload hook (xbu) with reloc.

Redirects every incoming upload into an isolated /staging/<uuid>/ directory
BEFORE it is written, so the file never touches its real destination until
it has been scanned and cleared. Registers a PENDING row in the quarantine DB.

Wire-up (systemd ExecStart):
    --xbu j,c1,/opt/copyparty/hooks/xbu-stage.py
  j  = pass upload info as JSON on argv[1]
  c1 = read JSON action back from our stdout (the reloc instruction)

Returns on stdout: {"vp": "/staging/<uuid>"} to redirect the upload.
"""
import sys, os, json, uuid, time, sqlite3, logging

logging.basicConfig(filename="/var/log/copyparty-hooks.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

DB = "/opt/copyparty/shares.db"
STAGING_ROOT = "/staging"          # filesystem root for staging
STAGING_VURL = "/staging"          # copyparty virtual-URL for staging volume

# Map a copyparty virtual upload path to (intended_dest_fs, dest_scope).
# vp examples: "vault/bob/foo.pdf", "public/movies/x.mkv", "drop/y.zip",
#              "shared/work/z.docx"
def resolve_destination(vp, user):
    parts = vp.strip("/").split("/")
    top = parts[0] if parts else ""
    # strip filename to get the destination *folder* vpath
    folder_parts = parts[:-1] if len(parts) > 1 else parts

    if top == "vault":
        # vault/<user>/...  -> /users/<user>/private/...
        sub = "/".join(folder_parts[2:]) if len(folder_parts) > 2 else ""
        dest = f"/users/{user}/private" + (f"/{sub}" if sub else "")
        return dest, "vault"
    if top == "public":
        # public/<cat>/... -> /storage/pool/<cat>/...
        sub = "/".join(folder_parts[1:]) if len(folder_parts) > 1 else ""
        dest = "/storage/pool" + (f"/{sub}" if sub else "")
        return dest, "public"
    if top == "shared":
        # shared/<space>/... -> /shares/<resolved>  (members-only = vault scope)
        sub = "/".join(folder_parts[1:]) if len(folder_parts) > 1 else ""
        dest = "/shares" + (f"/{sub}" if sub else "")
        return dest, "vault"
    if top == "drop":
        # anonymous drop -> public pool unknown bucket, public scope
        return "/storage/pool/unknown", "public"
    # fallback: treat as public unknown
    return "/storage/pool/unknown", "public"

def main():
    if len(sys.argv) < 2:
        sys.exit(0)
    try:
        info = json.loads(sys.argv[1])
    except (json.JSONDecodeError, TypeError):
        # Can't parse — let copyparty proceed normally (no reloc)
        logging.error(f"xbu: unparseable input: {sys.argv[1][:200]}")
        sys.exit(0)

    vp       = info.get("vp", "")
    user     = info.get("user", "anonymous")
    filename = os.path.basename(vp) or info.get("fn", "unnamed")
    size     = info.get("sz", 0)
    ip       = info.get("ip", "?")
    wark     = info.get("wark", "")

    qid = str(uuid.uuid4())
    intended_dest, scope = resolve_destination(vp, user)
    staging_vp = f"{STAGING_VURL}/{qid}"
    staging_fs = f"{STAGING_ROOT}/{qid}/{filename}"

    # Register PENDING row
    try:
        conn = sqlite3.connect(DB, timeout=10)
        conn.execute(
            "INSERT INTO quarantine "
            "(id, owner, filename, staging_path, intended_dest, dest_scope, "
            " size_bytes, sha256, status, uploaded_at, ip_address) "
            "VALUES (?,?,?,?,?,?,?,?,'pending',?,?)",
            (qid, user, filename, staging_fs, intended_dest, scope,
             size, wark, int(time.time()), ip)
        )
        conn.commit()
        conn.close()
        logging.info(f"PENDING id={qid} user={user} file={filename} "
                     f"-> dest={intended_dest} scope={scope}")
    except Exception as e:
        # If DB write fails, do NOT silently let the file through to its real
        # destination — still reloc to staging so nothing propagates unscanned.
        logging.error(f"xbu DB insert failed for {filename}: {e}")

    # Tell copyparty to write the upload into the staging folder instead
    print(json.dumps({"vp": staging_vp}))
    sys.exit(0)

if __name__ == "__main__":
    main()
