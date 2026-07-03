"""DB layer — connection helpers, schema init, user + session management."""
import os, time, sqlite3, secrets, hashlib

DB_PATH = os.environ.get("PC_DB", "/opt/copyparty/shares.db")
SCHEMA  = os.path.join(os.path.dirname(__file__), "schema.sql")
SESSION_TTL = 30 * 24 * 3600  # 30 days


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with open(SCHEMA) as f:
        sql = f.read()
    conn = connect()
    conn.executescript(sql)
    # migrations for columns added after first release
    for mig in [
        "ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE dump_items ADD COLUMN to_user_id INTEGER REFERENCES users(id)",
    ]:
        try:
            conn.execute(mig)
        except Exception:
            pass
    # dump_items kind CHECK must include 'share' — rebuild if old constraint present
    row = conn.execute("SELECT sql FROM sqlite_master WHERE name='dump_items'").fetchone()
    if row and "'share'" not in (row[0] or ""):
        conn.executescript("""
            ALTER TABLE dump_items RENAME TO dump_items_old;
            CREATE TABLE dump_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                group_id INTEGER REFERENCES groups(id),
                to_user_id INTEGER REFERENCES users(id),
                created_at INTEGER NOT NULL,
                kind TEXT CHECK(kind IN ('text','link','file','share')) NOT NULL,
                content TEXT, file_path TEXT);
            INSERT INTO dump_items (id,user_id,group_id,to_user_id,created_at,kind,content,file_path)
                SELECT id,user_id,group_id,to_user_id,created_at,kind,content,file_path FROM dump_items_old;
            DROP TABLE dump_items_old;
            CREATE INDEX IF NOT EXISTS idx_dump_personal ON dump_items(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_dump_group ON dump_items(group_id, created_at);
        """)
    conn.commit()
    conn.close()


# ── passwords / tokens ─────────────────────────────────────────────
def hash_pw(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return salt.hex() + "$" + dk.hex()


def verify_pw(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(),
                                 bytes.fromhex(salt_hex), 200_000)
        return secrets.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# ── users ──────────────────────────────────────────────────────────
def create_user(username: str, password: str, is_admin: bool = False,
                must_change: bool = False):
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO users (username, pw_hash, file_token, is_admin, created_at, must_change_pw) "
            "VALUES (?,?,?,?,?,?)",
            (username, hash_pw(password), secrets.token_urlsafe(24),
             1 if is_admin else 0, int(time.time()), 1 if must_change else 0))
        conn.commit()
    finally:
        conn.close()


def set_password(user_id: int, password: str):
    conn = connect()
    conn.execute("UPDATE users SET pw_hash=?, must_change_pw=0 WHERE id=?",
                 (hash_pw(password), user_id))
    conn.commit()
    conn.close()


def get_user(username: str):
    conn = connect()
    row = conn.execute("SELECT * FROM users WHERE username=? AND disabled=0",
                       (username,)).fetchone()
    conn.close()
    return row


# ── sessions ───────────────────────────────────────────────────────
def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    conn = connect()
    conn.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) "
                 "VALUES (?,?,?,?)", (token, user_id, now, now + SESSION_TTL))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    conn.commit()
    conn.close()
    return token


def session_user(token: str):
    if not token:
        return None
    conn = connect()
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token=? AND s.expires_at > ? AND u.disabled=0",
        (token, int(time.time()))).fetchone()
    conn.close()
    return row


def drop_session(token: str):
    conn = connect()
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit()
    conn.close()
