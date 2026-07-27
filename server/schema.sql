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

-- ── DUMP: telegram-style feeds ─────────────────────────────────────────────
-- Personal dump (group_id NULL) = "Saved Messages"; each group = a chat.
-- kind: 'text' | 'link' | 'file' (file_path = copyparty vpath of attachment)
CREATE TABLE IF NOT EXISTS dump_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),   -- author
    group_id    INTEGER REFERENCES groups(id),           -- NULL = personal
    created_at  INTEGER NOT NULL,
    kind        TEXT CHECK(kind IN ('text','link','file','share','todo')) NOT NULL,
    content     TEXT,                                    -- text body or URL
    file_path   TEXT                                     -- copyparty vpath for kind='file'
);
CREATE INDEX IF NOT EXISTS idx_dump_personal ON dump_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dump_group    ON dump_items(group_id, created_at);

-- ── SERVICE PAIRING ────────────────────────────────────────────────────────
-- Per-user opt-in to ecosystem services; settings JSON holds per-service
-- config (e.g. work: {"hourly_rate": 30}). UI renders only paired services.
CREATE TABLE IF NOT EXISTS user_services (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    service    TEXT NOT NULL,               -- 'work','fitness','meals','sleep','journal'
    enabled    INTEGER NOT NULL DEFAULT 1,
    settings   TEXT NOT NULL DEFAULT '{}',  -- JSON
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, service)
);

-- ── APP KV: generic per-user storage for ported apps ─────────────────────
-- Ported GitHub apps (workout-gen, meal-prep, ...) persist through this via
-- the localStorage bridge; contract-manager's storage.js targets it directly.
CREATE TABLE IF NOT EXISTS app_kv (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    app        TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, app, key)
);

-- KV snapshots: point-in-time backups of an app's per-user state
CREATE TABLE IF NOT EXISTS kv_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    app        TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data       TEXT NOT NULL
);

-- group-scoped app KV: org-shared data (e.g. contract-manager contracts).
-- members read; managers/owners write. Personal app_kv stays private.
CREATE TABLE IF NOT EXISTS group_kv (
    group_id   INTEGER NOT NULL REFERENCES groups(id),
    app        TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    PRIMARY KEY (group_id, app, key)
);

-- Cooking steps for a meal-prep recipe (added 2026-07-25).
--
-- meal-prep's own recipe model has no steps field and no nutrition; its recipes
-- live in the opaque `prep_recipes` KV blob. Rather than modify that app (and
-- risk its data), steps are stored here as a Nook-side overlay keyed by the
-- recipe id meal-prep already assigns. meal-prep keeps working untouched; Nook
-- merges these in when it builds the Meal payload.
--
-- recipe_id is meal-prep's own string id, not a foreign key -- the recipes it
-- refers to live in app_kv, so referential integrity can't be enforced here.
-- Rows for a deleted recipe are harmless (they simply never match).
CREATE TABLE IF NOT EXISTS recipe_steps (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id  TEXT    NOT NULL,
    idx        INTEGER NOT NULL,          -- 0-based position in the list
    text       TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, recipe_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_recipe_steps_user ON recipe_steps(user_id, recipe_id);

-- Cross-service search index (added 2026-07-25).
--
-- One row per addressable THING, so a hit can deep-link to the exact page:
-- service + tab + item_id is the address, `kind` disambiguates rows that share a
-- query ("183" is a bodyweight in Workout, grams of an ingredient in Meal, and a
-- street number in Contractor), and `subtitle` carries the context that lets a
-- person tell those apart at a glance.
--
-- NOT an FTS table itself: FTS5 external-content tables can't be queried by
-- ordinary columns, and the UI needs to filter/sort by service and recency. This
-- holds the data; search_fts below indexes `body`.
--
-- `body` is what actually gets matched, and the indexer must EMIT NUMBERS INTO IT.
-- A bodyweight lives in body_metrics.weight as a REAL — full-text search will
-- never match "183" against a numeric column, so the indexer writes "183 lb body
-- weight" into body. Same for grams inside a recipe blob. Get this wrong and
-- numeric queries silently return nothing.
CREATE TABLE IF NOT EXISTS search_index (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service    TEXT NOT NULL,          -- home | workout | meal | hours | contractor | shelf | archive | photos
    tab        TEXT,                   -- which screen inside that service
    item_id    TEXT,                   -- the service's own id for the thing
    kind       TEXT,                   -- bodyweight | ingredient | project | note | movie | book | employee | …
    title      TEXT NOT NULL,          -- the result headline
    subtitle   TEXT,                   -- disambiguating context ("Body log · Jul 20")
    at         INTEGER,                -- unix seconds, for recency ranking
    body       TEXT NOT NULL,          -- the searchable text (numbers included!)
    UNIQUE(user_id, service, item_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_search_user ON search_index(user_id, service);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    body,
    content='search_index',
    content_rowid='id',
    tokenize='unicode61'
);

-- Keep the FTS mirror in step with the table it indexes.
CREATE TRIGGER IF NOT EXISTS search_ai AFTER INSERT ON search_index BEGIN
    INSERT INTO search_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER IF NOT EXISTS search_ad AFTER DELETE ON search_index BEGIN
    INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER IF NOT EXISTS search_au AFTER UPDATE ON search_index BEGIN
    INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.id, old.body);
    INSERT INTO search_fts(rowid, body) VALUES (new.id, new.body);
END;
