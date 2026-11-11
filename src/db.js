const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "fretwork.sqlite");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Ordered, append-only list of migrations. Each runs exactly once, tracked in
// schema_migrations — new phases add new entries here, never edit old ones.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verify_token TEXT,
    reset_token TEXT,
    reset_token_expires INTEGER,
    notify_practice_reminders INTEGER NOT NULL DEFAULT 1,
    notify_weekly_summary INTEGER NOT NULL DEFAULT 1,
    notify_gear_reminders INTEGER NOT NULL DEFAULT 1,
    gear_reminder_days INTEGER NOT NULL DEFAULT 90,
    created_at TEXT NOT NULL
  );

  CREATE TABLE techniques (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL
  );
  CREATE INDEX idx_techniques_user ON techniques(user_id);

  CREATE TABLE sprints (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    carried_from_sprint_id TEXT REFERENCES sprints(id)
  );
  CREATE INDEX idx_sprints_user ON sprints(user_id);

  CREATE TABLE queue_items (
    id TEXT PRIMARY KEY,
    sprint_id TEXT NOT NULL REFERENCES sprints(id),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    important INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    ref_json TEXT,
    carried_from_queue_item_id TEXT REFERENCES queue_items(id),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_queue_items_sprint ON queue_items(sprint_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    sprint_id TEXT REFERENCES sprints(id),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user_date ON sessions(user_id, date);
  CREATE INDEX idx_sessions_sprint ON sessions(sprint_id);

  CREATE TABLE session_blocks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    queue_item_id TEXT REFERENCES queue_items(id),
    technique_id TEXT REFERENCES techniques(id),
    material TEXT NOT NULL,
    category TEXT NOT NULL,
    actual_minutes REAL NOT NULL DEFAULT 0,
    planned_minutes REAL,
    completed INTEGER NOT NULL DEFAULT 0,
    important INTEGER NOT NULL DEFAULT 0,
    ref_json TEXT,
    notes TEXT DEFAULT '',
    imported_entry_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_blocks_session ON session_blocks(session_id);
  CREATE INDEX idx_blocks_imported_entry ON session_blocks(imported_entry_id);

  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    content TEXT DEFAULT '',
    goals TEXT DEFAULT '',
    techniques_json TEXT NOT NULL DEFAULT '[]',
    lesson_refs_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_plans_user ON plans(user_id);

  CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_topics_user ON topics(user_id);

  CREATE TABLE gear (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Good'
  );
  CREATE INDEX idx_gear_user ON gear(user_id);

  CREATE TABLE gear_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gear_id TEXT NOT NULL REFERENCES gear(id),
    date TEXT NOT NULL,
    note TEXT NOT NULL
  );
  CREATE INDEX idx_gear_maintenance_gear ON gear_maintenance(gear_id);

  CREATE TABLE theory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'learning',
    notes TEXT DEFAULT ''
  );
  CREATE INDEX idx_theory_user ON theory(user_id);

  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT ''
  );
  CREATE INDEX idx_courses_user ON courses(user_id);

  CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    title TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_name TEXT,
    uploaded_date TEXT,
    html TEXT,
    text TEXT,
    data_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_lessons_course ON lessons(course_id);

  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    course_id TEXT REFERENCES courses(id),
    course_name TEXT,
    lesson_id TEXT REFERENCES lessons(id),
    lesson_title TEXT,
    page_ref TEXT DEFAULT '',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notes_user ON notes(user_id);
  CREATE INDEX idx_notes_lesson ON notes(lesson_id);

  CREATE TABLE custom_tunings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    strings_json TEXT NOT NULL
  );
  CREATE INDEX idx_tunings_user ON custom_tunings(user_id);
  `,
  // Phase 2: live start/stop timers on a block. Nullable — null means not currently
  // running. While running, actual_minutes is live-updated to elapsed-since-start
  // (no pause/resume, so no separate baseline column is needed).
  `
  ALTER TABLE session_blocks ADD COLUMN timer_started_at TEXT;
  `,
  // Phase 3: audio recordings attached to a session. The audio bytes themselves live
  // on disk (data/recordings/<id>.<ext>), not in SQLite — only metadata here.
  `
  CREATE TABLE audio_recordings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    duration_seconds REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_recordings_session ON audio_recordings(session_id);
  `,
  // Admin dashboard: owner-only (set by email, once, here — never by application code).
  // Impersonation and notices both key off this same users table.
  `
  ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN last_login_at TEXT;
  UPDATE users SET is_admin = 1 WHERE email = 'paladin@darthvetter.com' COLLATE NOCASE;

  CREATE TABLE admin_notices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    shown_at TEXT
  );
  CREATE INDEX idx_notices_user ON admin_notices(user_id);

  CREATE TABLE admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_user_id TEXT REFERENCES users(id),
    details TEXT,
    created_at TEXT NOT NULL
  );
  `,
];

function runMigrations() {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all();
  const applied = new Set(appliedRows.map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
runMigrations();

module.exports = { db };
