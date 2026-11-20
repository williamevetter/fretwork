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
  // Grant admin to a second owner-controlled account, same way as migration #4.
  `
  UPDATE users SET is_admin = 1 WHERE email = 'williamevetter@aol.com' COLLATE NOCASE;
  `,
  // Admin-forced password change: set by the admin, cleared once the user sets a
  // new password (POST /api/auth/force-password-change).
  `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  `,
  // Saved recipients for emailing Topics & Questions items to yourself or someone else.
  `
  CREATE TABLE email_contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_email_contacts_user ON email_contacts(user_id);
  `,
  // Display name, surfaced in the "From" line of emailed Topics & Questions
  // (falls back to the account email wherever it's left blank).
  `
  ALTER TABLE users ADD COLUMN name TEXT;
  `,
  // is_ad_hoc: suppresses the Planned vs Actual comparison in Session History for
  // sessions that were never built from a plan, so there's nothing honest to compare to.
  // block_id/label on recordings: lets a recording be attached to one specific block
  // (not just the whole session) and carries its generated Date-Time-Sprint-Topic-note name.
  `
  ALTER TABLE sessions ADD COLUMN is_ad_hoc INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE audio_recordings ADD COLUMN block_id TEXT REFERENCES session_blocks(id);
  ALTER TABLE audio_recordings ADD COLUMN label TEXT;
  `,
  // Session-level Planned/Actual time (Hours+Minutes in the UI), independent of the
  // per-block planned/actual tracking — mainly for ad-hoc sessions with no blocks to
  // sum, or anyone who'd rather log one whole-session total. Null means "use the
  // block-derived sum instead" (existing behavior), so this is purely additive.
  // Plans get the same Planned Time field — there's no "actual" on a plan yet.
  `
  ALTER TABLE sessions ADD COLUMN planned_minutes REAL;
  ALTER TABLE sessions ADD COLUMN actual_minutes_manual REAL;
  ALTER TABLE plans ADD COLUMN planned_minutes REAL;
  `,
  // Phase 1 of Courses/Sprints/Sessions unification: each course can run its own
  // sprint cadence (default 2 weeks, matching today's hardcoded behavior exactly),
  // and sprints now optionally belong to a course. course_id stays nullable so
  // "general" sprints with no course keep working unchanged.
  `
  ALTER TABLE courses ADD COLUMN sprint_length_value INTEGER NOT NULL DEFAULT 2;
  ALTER TABLE courses ADD COLUMN sprint_length_unit TEXT NOT NULL DEFAULT 'week';
  ALTER TABLE sprints ADD COLUMN course_id TEXT REFERENCES courses(id);
  `,
  // Phase 2: techniques become tags assignable to a Course, Sprint, Session, or Lesson.
  // inherited_from tracks provenance ("course:<id>" / "sprint:<id>") so cascaded-down
  // copies can be cleanly un-cascaded without touching a tag someone added directly.
  `
  CREATE TABLE technique_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    technique_id TEXT NOT NULL REFERENCES techniques(id),
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    inherited_from TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_tech_assign_unique ON technique_assignments(technique_id, scope_type, scope_id);
  CREATE INDEX idx_tech_assign_scope ON technique_assignments(scope_type, scope_id);
  `,
  // Phase 3: a lesson can now be linked to more than one course. lessons.course_id
  // stays the lesson's primary/original course; this table holds only the extra links.
  `
  CREATE TABLE lesson_courses (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(id),
    course_id TEXT NOT NULL REFERENCES courses(id),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_lesson_courses_unique ON lesson_courses(lesson_id, course_id);
  `,
  // Planned blocks on a Plan — a flat JSON array (same precedent as techniques_json /
  // lesson_refs_json on this same table), not a child table: these are frontend-owned,
  // never individually queried/joined, and get copied into real session_blocks rows
  // only once "Start session now" turns the plan into a live session.
  `
  ALTER TABLE plans ADD COLUMN blocks_json TEXT;
  `,
  // Role-based admin scoping: 'admin' (real, full power — the two existing accounts),
  // 'test_admin' / 'test_instructor' / 'test_user' (QA personas), default 'user' for
  // everyone else. is_admin stays the dashboard-access gate (unchanged); role is the
  // finer-grained check layered on top, inside the admin routes, for WHO a test_admin
  // is allowed to act on.
  `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
  UPDATE users SET role = 'admin' WHERE is_admin = 1;
  `,
  // User acceptance statement — a single current version of a terms/warnings
  // statement every account must accept before using the app. Editing it (admin-only)
  // bumps the version, which re-triggers the gate for everyone, since their
  // accepted_statement_version is now behind the new current version.
  `
  CREATE TABLE acceptance_statement (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO acceptance_statement (id, version, body, updated_at) VALUES (1, 1, 'This is a passion project — no warranty is offered.
Support is best-try, not guaranteed.
Do not store anything you do not want the general public or others to see — no privacy is guaranteed.
Do not abuse or scrape the site.
Unauthorized access is a federal crime — we will prosecute and press charges.
No use of this site to perform any activities against your local or federal law, or other unethical behavior.
No racist, sexist, or religious slurs — ZERO TOLERANCE.', '${new Date().toISOString()}');
  ALTER TABLE users ADD COLUMN accepted_statement_version INTEGER NOT NULL DEFAULT 0;
  `,
  // Course lifecycle: a course can now be marked completed (with a short checkup
  // questionnaire), reopened, or "continued" into a linked Part 2 course.
  // focus_days_json is a flat JSON array of weekday codes (e.g. '["mon","wed"]"),
  // same precedent as plans.blocks_json — frontend-owned, never queried/joined.
  // course_checkups is a real child table (not a JSON blob on courses) since a
  // course can be ended more than once (end -> reopen -> end again), each producing
  // its own row with its own id/timestamp — same shape as lessons/sprints.
  `
  ALTER TABLE courses ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE courses ADD COLUMN completed_at TEXT;
  ALTER TABLE courses ADD COLUMN previous_course_id TEXT REFERENCES courses(id);
  ALTER TABLE courses ADD COLUMN focus_days_json TEXT;

  CREATE TABLE course_checkups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    course_id TEXT NOT NULL REFERENCES courses(id),
    answers_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_course_checkups_course ON course_checkups(course_id);
  `,
  // Instructor accounts (role='instructor', a new value for the existing free-text
  // column — no schema change needed for that part), Forums, and the Message Board.
  // No open user directory anywhere here: messaging/forum-category access is always
  // resolved through an actual enrollment relationship, never a general lookup.
  `
  CREATE TABLE enrollments (
    id TEXT PRIMARY KEY,
    instructor_id TEXT NOT NULL REFERENCES users(id),
    student_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT
  );
  CREATE UNIQUE INDEX idx_enrollments_pair ON enrollments(instructor_id, student_id);
  CREATE INDEX idx_enrollments_student ON enrollments(student_id);

  CREATE TABLE forum_categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    owner_user_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  INSERT INTO forum_categories (id, slug, label, created_at) VALUES
    ('faq-cat', 'faq', 'FAQs', '${new Date().toISOString()}'),
    ('help-tech-cat', 'help-technical', 'Help Needed (technical)', '${new Date().toISOString()}'),
    ('help-music-cat', 'help-musical', 'Help Needed (musical)', '${new Date().toISOString()}');

  CREATE TABLE forum_threads (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES forum_categories(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_forum_threads_category ON forum_threads(category_id);

  CREATE TABLE forum_replies (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES forum_threads(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_forum_replies_thread ON forum_replies(thread_id);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id),
    recipient_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL DEFAULT 'general',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX idx_messages_recipient ON messages(recipient_id);
  CREATE INDEX idx_messages_sender ON messages(sender_id);

  ALTER TABLE users ADD COLUMN notify_new_message INTEGER NOT NULL DEFAULT 1;
  `,
  // Interface preferences: theme ('dark'|'light') and ui_mode ('auto'|'computer'|
  // 'phone'|'tablet', overriding real-screen-width auto-detection when not 'auto').
  `
  ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark';
  ALTER TABLE users ADD COLUMN ui_mode TEXT NOT NULL DEFAULT 'auto';
  `,
  // Course detail fields (issue #11): url/notes/dates are plain descriptive fields
  // with no behavioral effect on the existing status/completed_at lifecycle --
  // deliberately kept separate. "Indefinite" is just end_date IS NULL, same
  // precedent as not needing a separate boolean anywhere else in this schema.
  // Goal tracking: goal_period decides the window goal-progress is computed over
  // ('custom' = all-time total, 'sprint' = current active sprint's date range,
  // 'session' = the single most recent session, 'daily'/'weekly'/'monthly' = a
  // rolling window ending today) -- see GET /courses/:id/goal-progress.
  `
  ALTER TABLE courses ADD COLUMN url TEXT;
  ALTER TABLE courses ADD COLUMN notes TEXT;
  ALTER TABLE courses ADD COLUMN start_date TEXT;
  ALTER TABLE courses ADD COLUMN end_date TEXT;
  ALTER TABLE courses ADD COLUMN goal_minutes INTEGER;
  ALTER TABLE courses ADD COLUMN goal_period TEXT;
  ALTER TABLE courses ADD COLUMN goal_type TEXT;
  ALTER TABLE courses ADD COLUMN goal_description TEXT;
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
