#!/usr/bin/env python3
"""Share Manager API - Flask microservice for time-limited shared spaces."""
from flask import Flask, request, jsonify
import sqlite3, uuid, time, os, shutil, logging

logging.basicConfig(filename="/var/log/share-manager.log", level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__)
DB = "/opt/copyparty/shares.db"
SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists(DB):
        with get_db() as conn:
            conn.executescript(open(SCHEMA).read())
        logging.info("Database initialized")

@app.route("/api/shares", methods=["POST"])
def create_share():
    data = request.json
    share_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO shares (id, owner, name, path, type, visibility, created_at, expires_at, auto_delete) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (share_id, data["owner"], data["name"], "/shares/" + share_id,
             data["type"], data["visibility"], int(time.time()),
             int(time.time()) + data.get("expiry_days", 30) * 86400,
             data.get("auto_delete", 0))
        )
        for member in data.get("members", []):
            conn.execute(
                "INSERT INTO share_members (share_id, username, permission, invited_at) VALUES (?, ?, ?, ?)",
                (share_id, member["username"], member.get("permission", "r"), int(time.time()))
            )
    os.makedirs("/shares/" + share_id, exist_ok=True)
    logging.info(f"Share created: {share_id} by {data['owner']}")
    return jsonify({"share_id": share_id, "path": "/shares/" + share_id})

@app.route("/api/shares/my-shares", methods=["GET"])
def my_shares():
    username = request.headers.get("X-Username", "")
    with get_db() as conn:
        owned = conn.execute("SELECT * FROM shares WHERE owner = ?", (username,)).fetchall()
        member_of = conn.execute(
            "SELECT s.* FROM shares s JOIN share_members m ON s.id = m.share_id WHERE m.username = ?",
            (username,)
        ).fetchall()
    return jsonify({"owned": [dict(r) for r in owned], "member_of": [dict(r) for r in member_of]})

@app.route("/api/shares/<share_id>", methods=["GET"])
def get_share(share_id):
    with get_db() as conn:
        share = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
        if not share:
            return jsonify({"error": "not found"}), 404
        members = conn.execute("SELECT * FROM share_members WHERE share_id = ?", (share_id,)).fetchall()
    return jsonify({"share": dict(share), "members": [dict(m) for m in members]})

@app.route("/api/shares/<share_id>/extend", methods=["POST"])
def extend_share(share_id):
    days = request.json.get("days", 30)
    with get_db() as conn:
        conn.execute("UPDATE shares SET expires_at = expires_at + ? WHERE id = ?", (days * 86400, share_id))
    return jsonify({"status": "extended", "days": days})

@app.route("/api/shares/<share_id>/members", methods=["POST"])
def add_member(share_id):
    data = request.json
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO share_members (share_id, username, permission, invited_at) VALUES (?, ?, ?, ?)",
            (share_id, data["username"], data.get("permission", "r"), int(time.time()))
        )
    return jsonify({"status": "added"})

@app.route("/api/shares/<share_id>/members/<username>", methods=["DELETE"])
def remove_member(share_id, username):
    with get_db() as conn:
        conn.execute("DELETE FROM share_members WHERE share_id = ? AND username = ?", (share_id, username))
    return jsonify({"status": "removed"})

@app.route("/api/shares/<share_id>", methods=["DELETE"])
def delete_share(share_id):
    with get_db() as conn:
        share = conn.execute("SELECT path, auto_delete FROM shares WHERE id = ?", (share_id,)).fetchone()
        if share and share["auto_delete"]:
            shutil.rmtree(share["path"], ignore_errors=True)
        conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
        conn.execute("DELETE FROM share_members WHERE share_id = ?", (share_id,))
    logging.info(f"Share deleted: {share_id}")
    return jsonify({"status": "deleted"})

@app.route("/api/audit", methods=["GET"])
def get_audit_log():
    limit = request.args.get("limit", 100, type=int)
    with get_db() as conn:
        logs = conn.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    return jsonify([dict(l) for l in logs])

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": int(time.time())})

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5001)
