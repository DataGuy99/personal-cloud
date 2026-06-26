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

-- ============================================================================
-- QUARANTINE / STAGING — every upload passes through here before propagating.
-- State machine: pending -> (clear | flagged) -> (released | rejected)
-- ============================================================================
CREATE TABLE IF NOT EXISTS quarantine (
    id            TEXT PRIMARY KEY,          -- uuid
    owner         TEXT NOT NULL,             -- copyparty username who uploaded
    filename      TEXT NOT NULL,             -- display name
    staging_path  TEXT NOT NULL,             -- where the file physically sits now (/staging/<id>/<filename>)
    intended_dest TEXT NOT NULL,             -- where it goes on clear (e.g. /users/bob/private or /storage/pool/movies)
    dest_scope    TEXT CHECK(dest_scope IN ('vault','public')) NOT NULL,  -- governs who can release if flagged
    size_bytes    INTEGER NOT NULL,
    sha256        TEXT,                      -- content hash (copyparty 'wark' or computed)
    status        TEXT CHECK(status IN ('pending','clear','flagged','released','rejected')) NOT NULL DEFAULT 'pending',
    flag_reason   TEXT,                      -- e.g. "YARA:pdf_javascript" or "ClamAV:Eicar-Test-Signature"
    flag_tier     TEXT CHECK(flag_tier IN ('block','review')),  -- block = malware; review = suspicious-but-common
    uploaded_at   INTEGER NOT NULL,
    scanned_at    INTEGER,                   -- when scan completed
    resolved_at   INTEGER,                   -- when released/rejected
    resolved_by   TEXT,                      -- who released/rejected (owner or admin username)
    ip_address    TEXT
);

CREATE INDEX IF NOT EXISTS idx_quarantine_status ON quarantine(status);
CREATE INDEX IF NOT EXISTS idx_quarantine_owner  ON quarantine(owner);
