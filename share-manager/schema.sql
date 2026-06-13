CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT CHECK(type IN ('project', 'album', 'drop', 'collab')) NOT NULL,
    visibility TEXT CHECK(visibility IN ('private', 'unlisted', 'public')) DEFAULT 'private',
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    auto_delete INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS share_members (
    share_id TEXT NOT NULL,
    username TEXT NOT NULL,
    permission TEXT CHECK(permission IN ('r', 'rw', 'rwmd', 'admin')) DEFAULT 'r',
    invited_at INTEGER NOT NULL,
    PRIMARY KEY (share_id, username),
    FOREIGN KEY (share_id) REFERENCES shares(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    username TEXT,
    action TEXT CHECK(action IN ('login', 'logout', 'upload', 'download', 'share_create', 'share_join', 'share_leave', 'share_expire', 'delete', 'admin_override')) NOT NULL,
    target_path TEXT,
    share_id TEXT,
    ip_address TEXT,
    user_agent TEXT
);
