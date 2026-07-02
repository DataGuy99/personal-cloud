-- ============================================================================
-- Personal Cloud Platform — unified schema
-- SQLite. One identity table owns all users; every module hangs off user_id.
-- ============================================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ── IDENTITY ─────────────────────────────────────────────────────────────
-- Source of truth for all accounts. copyparty.conf is GENERATED from this
-- table (server/sync_copyparty.py) — never hand-edit accounts there.
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    pw_hash     TEXT NOT NULL,            -- pbkdf2 hash of the user's real password (API login)
    file_token  TEXT NOT NULL,            -- random service credential; becomes their copyparty password
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    disabled    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,          -- random session token (cookie)
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);

-- ── FILES: quarantine / staging state machine ────────────────────────────
-- pending -> (clear | flagged) -> (released | rejected)
CREATE TABLE IF NOT EXISTS quarantine (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,           -- copyparty username (matches users.username)
    filename      TEXT NOT NULL,
    staging_path  TEXT NOT NULL,
    intended_dest TEXT NOT NULL,
    dest_scope    TEXT CHECK(dest_scope IN ('vault','public')) NOT NULL,
    size_bytes    INTEGER NOT NULL,
    sha256        TEXT,
    status        TEXT CHECK(status IN ('pending','clear','flagged','released','rejected')) NOT NULL DEFAULT 'pending',
    flag_reason   TEXT,
    flag_tier     TEXT CHECK(flag_tier IN ('block','review')),
    uploaded_at   INTEGER NOT NULL,
    scanned_at    INTEGER,
    resolved_at   INTEGER,
    resolved_by   TEXT,
    ip_address    TEXT
);
CREATE INDEX IF NOT EXISTS idx_quarantine_status ON quarantine(status);
CREATE INDEX IF NOT EXISTS idx_quarantine_owner  ON quarantine(owner);

-- ── FILES: link shares (time/use-limited public links) ───────────────────
CREATE TABLE IF NOT EXISTS shares (
    id          TEXT PRIMARY KEY,
    owner_id    INTEGER NOT NULL REFERENCES users(id),
    path        TEXT NOT NULL,             -- vault-relative file path being shared
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,                   -- null = no expiry
    max_uses    INTEGER,                   -- null = unlimited
    use_count   INTEGER NOT NULL DEFAULT 0,
    revoked     INTEGER NOT NULL DEFAULT 0
);

-- ── ECOSYSTEM ────────────────────────────────────────────────────────────
-- Design principle: every module is per-user rows keyed on user_id, so any
-- module can inform any other (insights joins across them).

-- body metrics (IMPLEMENTED: server/api/metrics.py)
CREATE TABLE IF NOT EXISTS body_metrics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    logged_at   INTEGER NOT NULL,          -- unix ts
    weight_kg   REAL,
    height_cm   REAL,
    age_years   INTEGER,
    sex         TEXT CHECK(sex IN ('m','f')),
    body_fat_pct REAL,
    note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_user ON body_metrics(user_id, logged_at);

-- work hours (IMPLEMENTED: server/api/workhours.py)
CREATE TABLE IF NOT EXISTS work_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    group_id    INTEGER REFERENCES groups(id),   -- NULL = personal; set = work-org visible to managers
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,                   -- null = clocked in, still running
    hourly_rate REAL,                      -- optional; enables earnings insight
    activity    TEXT,                      -- e.g. 'desk', 'construction', 'driving'
    note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_user ON work_sessions(user_id, started_at);

-- workouts (PLANNED: schema ready, endpoints not yet built)
CREATE TABLE IF NOT EXISTS workouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    performed_at INTEGER NOT NULL,
    kind        TEXT,                      -- 'strength','cardio','mobility',...
    duration_min INTEGER,
    est_kcal    REAL,
    note        TEXT
);
CREATE TABLE IF NOT EXISTS workout_sets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id  INTEGER NOT NULL REFERENCES workouts(id),
    exercise    TEXT NOT NULL,
    set_no      INTEGER,
    reps        INTEGER,
    weight_kg   REAL
);

-- meals & nutrition (PLANNED)
CREATE TABLE IF NOT EXISTS meals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    plan_id     INTEGER REFERENCES meal_plans(id), -- provenance: logged from a (group) plan
    eaten_at    INTEGER NOT NULL,
    name        TEXT,
    kcal        REAL,
    protein_g   REAL,
    carbs_g     REAL,
    fat_g       REAL,
    note        TEXT
);
CREATE TABLE IF NOT EXISTS meal_plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    group_id    INTEGER REFERENCES groups(id),   -- NULL = personal plan
    plan_date   TEXT NOT NULL,             -- YYYY-MM-DD
    meal_slot   TEXT,                      -- 'breakfast','lunch','dinner','snack'
    recipe      TEXT,
    target_kcal REAL
);

-- sleep (PLANNED)
CREATE TABLE IF NOT EXISTS sleep_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    slept_at    INTEGER NOT NULL,
    woke_at     INTEGER,
    quality     INTEGER,                   -- 1-5 self-report
    note        TEXT
);

-- notes / journal (PLANNED)
CREATE TABLE IF NOT EXISTS journal_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER,
    title       TEXT,
    body        TEXT
);

-- ── GROUPS: the sharing primitive ─────────────────────────────────────────
-- A group is any shared space: "Family" (meal prep), a work org (contract
-- manager), a project. Content tables carry nullable group_id: NULL = personal,
-- set = group-scoped (visible to members per role). Personal rows may
-- REFERENCE group rows (provenance) without becoming group-visible.
CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    kind        TEXT,                      -- 'family','work','project',...
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id    INTEGER NOT NULL REFERENCES groups(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    role        TEXT CHECK(role IN ('owner','manager','member')) NOT NULL DEFAULT 'member',
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- device API keys (alarm puck sleep sync, future sensors): header-token auth
CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    label       TEXT,                      -- 'alarm-puck'
    created_at  INTEGER NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
);
