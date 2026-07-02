#!/usr/bin/env python3
"""
Personal Cloud API — the platform backend.

Serves:
  /                     the PWA (static files from ../pwa)
  /api/login|logout|me  identity (sessions; also hands the PWA its copyparty file_token)
  /api/users            admin: create users (auto-syncs copyparty accounts)
  /api/pending          quarantine review: list / release / reject
  /api/metrics          body metrics log + latest
  /api/work             work sessions: clock in/out, list
  /api/insights/today   cross-module daily insight (BMR + work + workouts)

Runs as the copyparty user so it can move files staging -> destination.
Listens on 0.0.0.0:5001 (behind nftables; later behind reverse proxy + TLS).
"""
import os, sys, time, shutil, subprocess, logging
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, g

sys.path.insert(0, os.path.dirname(__file__))
import db
from api import metrics as api_metrics
from api import workhours as api_work
from api import insights as api_insights
from api import groups as api_groups
from api import sleep as api_sleep

logging.basicConfig(filename=os.environ.get("PC_LOG", "/var/log/personal-cloud-api.log"),
                    level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

PWA_DIR = os.environ.get("PC_PWA", os.path.join(os.path.dirname(__file__), "..", "pwa"))
app = Flask(__name__, static_folder=None)


# ── auth plumbing ──────────────────────────────────────────────────
def current_user():
    return db.session_user(request.cookies.get("pc_session", ""))


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            return jsonify({"error": "not authenticated"}), 401
        g.user = user
        return fn(*a, **kw)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user or not user["is_admin"]:
            return jsonify({"error": "admin only"}), 403
        g.user = user
        return fn(*a, **kw)
    return wrapper


# ── identity ───────────────────────────────────────────────────────
@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    user = db.get_user(data.get("username", ""))
    if not user or not db.verify_pw(data.get("password", ""), user["pw_hash"]):
        return jsonify({"error": "bad credentials"}), 401
    token = db.create_session(user["id"])
    resp = jsonify({"username": user["username"], "is_admin": bool(user["is_admin"]),
                    "file_token": user["file_token"]})
    resp.set_cookie("pc_session", token, max_age=db.SESSION_TTL,
                    httponly=True, samesite="Lax")
    logging.info(f"login user={user['username']}")
    return resp


@app.post("/api/logout")
@require_auth
def logout():
    db.drop_session(request.cookies.get("pc_session", ""))
    resp = jsonify({"ok": True})
    resp.delete_cookie("pc_session")
    return resp


@app.get("/api/me")
@require_auth
def me():
    return jsonify({"username": g.user["username"], "is_admin": bool(g.user["is_admin"]),
                    "file_token": g.user["file_token"]})


@app.post("/api/users")
@require_admin
def add_user():
    data = request.get_json(silent=True) or {}
    uname, pw = data.get("username", "").strip(), data.get("password", "")
    if not uname or not pw:
        return jsonify({"error": "username and password required"}), 400
    try:
        db.create_user(uname, pw, bool(data.get("is_admin")))
    except Exception as e:
        return jsonify({"error": str(e)}), 409
    # regenerate copyparty accounts + volumes, reload it
    try:
        subprocess.run([sys.executable,
                        os.path.join(os.path.dirname(__file__), "sync_copyparty.py")],
                       check=True, capture_output=True, timeout=30)
    except Exception as e:
        logging.error(f"copyparty sync failed after user add: {e}")
        return jsonify({"ok": True, "warning": "user created but copyparty sync failed"})
    return jsonify({"ok": True})


# ── quarantine review ──────────────────────────────────────────────
@app.get("/api/pending")
@require_auth
def pending_list():
    conn = db.connect()
    if g.user["is_admin"] and request.args.get("all") == "1":
        rows = conn.execute(
            "SELECT * FROM quarantine WHERE status IN ('pending','flagged') "
            "ORDER BY uploaded_at DESC LIMIT 200").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM quarantine WHERE owner=? AND status IN ('pending','flagged') "
            "ORDER BY uploaded_at DESC LIMIT 200", (g.user["username"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


def _resolve(qid, action, actor):
    """Shared release/reject logic. Returns (json, http_status)."""
    conn = db.connect()
    row = conn.execute("SELECT * FROM quarantine WHERE id=?", (qid,)).fetchone()
    if not row:
        conn.close()
        return {"error": "not found"}, 404
    is_owner = row["owner"] == actor["username"]
    is_admin = bool(actor["is_admin"])
    # release authority: owner may self-release vault-scope; public is admin-only
    if action == "release":
        if not (is_admin or (is_owner and row["dest_scope"] == "vault")):
            conn.close()
            return {"error": "not authorized to release this file"}, 403
    else:  # reject: owner may reject their own; admin any
        if not (is_admin or is_owner):
            conn.close()
            return {"error": "not authorized"}, 403
    if row["status"] not in ("pending", "flagged"):
        conn.close()
        return {"error": f"already {row['status']}"}, 409

    now = int(time.time())
    try:
        if action == "release":
            os.makedirs(row["intended_dest"], exist_ok=True)
            shutil.move(row["staging_path"],
                        os.path.join(row["intended_dest"], row["filename"]))
            new_status = "released"
        else:
            if os.path.exists(row["staging_path"]):
                os.remove(row["staging_path"])
            new_status = "rejected"
    except Exception as e:
        conn.close()
        return {"error": f"file operation failed: {e}"}, 500

    conn.execute("UPDATE quarantine SET status=?, resolved_at=?, resolved_by=? WHERE id=?",
                 (new_status, now, actor["username"], qid))
    conn.commit()
    conn.close()
    logging.info(f"{action.upper()} id={qid} by={actor['username']}")
    return {"ok": True, "status": new_status}, 200


@app.post("/api/pending/<qid>/release")
@require_auth
def pending_release(qid):
    body, code = _resolve(qid, "release", g.user)
    return jsonify(body), code


@app.post("/api/pending/<qid>/reject")
@require_auth
def pending_reject(qid):
    body, code = _resolve(qid, "reject", g.user)
    return jsonify(body), code


# ── ecosystem modules ──────────────────────────────────────────────
app.register_blueprint(api_metrics.bp)
app.register_blueprint(api_work.bp)
app.register_blueprint(api_insights.bp)
app.register_blueprint(api_groups.bp)
app.register_blueprint(api_sleep.bp)


# ── PWA static serving ─────────────────────────────────────────────
@app.get("/")
def pwa_index():
    return send_from_directory(PWA_DIR, "index.html")


@app.get("/<path:path>")
def pwa_static(path):
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    return send_from_directory(PWA_DIR, path)


# ── entrypoint ─────────────────────────────────────────────────────
if __name__ == "__main__":
    db.init_db()
    if "--init-admin" in sys.argv:
        import getpass
        pw = os.environ.get("PC_ADMIN_PW") or getpass.getpass("admin password: ")
        try:
            db.create_user("admin", pw, is_admin=True)
            print("admin user created")
        except Exception as e:
            print(f"admin exists or error: {e}")
        sys.exit(0)
    app.run(host="0.0.0.0", port=5001)
