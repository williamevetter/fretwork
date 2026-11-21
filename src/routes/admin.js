const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");
const { issueToken } = require("../auth");

const RECORDINGS_DIR = path.join(__dirname, "..", "..", "data", "recordings");

const router = express.Router();
router.use(requireAuth, requireAuth.requireAdmin);

function logAudit(adminId, action, targetUserId, details) {
  db.prepare(`
    INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid(), adminId, action, targetUserId || null, details ? JSON.stringify(details) : null, nowISO());
}

// Real admins ('role'='admin') keep today's unrestricted power. A test_admin acting
// through this same dashboard can only touch test_instructor/test_user accounts —
// not real admins, not other test_admins, and not real production users.
function canActOn(actingUserId, targetRole) {
  const acting = db.prepare("SELECT role FROM users WHERE id = ?").get(actingUserId);
  if (!acting || acting.role !== "test_admin") return true;
  return targetRole === "test_instructor" || targetRole === "test_user";
}
const SCOPE_DENIED = { error: "Test admin accounts can only manage test instructor/user accounts." };

// The acceptance statement is a global, every-user-affecting setting, not a
// per-account action — restricted to real admins even though test_admin otherwise
// shares this whole router.
function isRealAdmin(userId) {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return !!row && row.role === "admin";
}
const ADMIN_ONLY = { error: "Only full admin accounts can manage the acceptance statement." };

// Real bytes for recordings (grouped by owner), approximate character-count bytes
// for course material (there's no clean per-user disk breakdown inside one shared
// SQLite file otherwise, so this is built deliberately rather than assumed).
function storageByUser() {
  const byUser = {};
  const recordings = db.prepare("SELECT user_id, file_name FROM audio_recordings").all();
  recordings.forEach((r) => {
    let size = 0;
    try { size = fs.statSync(path.join(RECORDINGS_DIR, r.file_name)).size; } catch (e) {}
    byUser[r.user_id] = byUser[r.user_id] || { recordingBytes: 0, courseMaterialBytes: 0 };
    byUser[r.user_id].recordingBytes += size;
  });
  // Direct lessons.user_id (issue #17) -- a joined-through-courses count would
  // silently miss any standalone lesson (course_id IS NULL).
  const courseRows = db.prepare(`
    SELECT user_id, SUM(LENGTH(COALESCE(html, '')) + LENGTH(COALESCE(text, '')) + LENGTH(COALESCE(data_url, ''))) AS bytes
    FROM lessons GROUP BY user_id
  `).all();
  courseRows.forEach((r) => {
    byUser[r.user_id] = byUser[r.user_id] || { recordingBytes: 0, courseMaterialBytes: 0 };
    byUser[r.user_id].courseMaterialBytes += r.bytes || 0;
  });
  return byUser;
}

router.get("/users", (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at").all();
  const storage = storageByUser();
  const sessionCount = db.prepare("SELECT user_id, COUNT(*) AS n FROM sessions GROUP BY user_id").all();
  const sprintCount = db.prepare("SELECT user_id, COUNT(*) AS n FROM sprints GROUP BY user_id").all();
  const sessionCountByUser = Object.fromEntries(sessionCount.map((r) => [r.user_id, r.n]));
  const sprintCountByUser = Object.fromEntries(sprintCount.map((r) => [r.user_id, r.n]));

  res.json(users.map((u) => ({
    id: u.id, email: u.email, verified: !!u.verified, isAdmin: !!u.is_admin, role: u.role,
    mustChangePassword: !!u.must_change_password,
    createdAt: u.created_at, lastLoginAt: u.last_login_at || null,
    sessionCount: sessionCountByUser[u.id] || 0, sprintCount: sprintCountByUser[u.id] || 0,
    recordingBytes: (storage[u.id] || {}).recordingBytes || 0,
    courseMaterialBytesApprox: (storage[u.id] || {}).courseMaterialBytes || 0,
  })));
});

router.get("/audit-log", (req, res) => {
  const rows = db.prepare("SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map((r) => ({
    id: r.id, adminId: r.admin_id, action: r.action, targetUserId: r.target_user_id,
    details: r.details ? JSON.parse(r.details) : null, createdAt: r.created_at,
  })));
});

router.post("/users/:id/impersonate", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't impersonate yourself." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);
  issueToken(req, res, { id: target.id, email: target.email, isAdmin: !!target.is_admin }, { impersonatedBy: req.user.id });
  logAudit(req.user.id, "impersonate", target.id, { email: target.email });
  res.json({ ok: true });
});

router.post("/users/:id/notices", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);
  const message = (req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "message is required." });
  const row = { id: uid(), user_id: target.id, message, created_at: nowISO() };
  db.prepare("INSERT INTO admin_notices (id, user_id, message, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.user_id, row.message, row.created_at);
  logAudit(req.user.id, "notice", target.id, { message });
  res.json({ ok: true });
});

router.post("/users/:id/require-password-change", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);
  db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(target.id);
  logAudit(req.user.id, "require-password-change", target.id, { email: target.email });
  res.json({ ok: true });
});

router.patch("/users/:id", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);
  const email = (req.body?.email || "").trim();
  if (!email) return res.status(400).json({ error: "email is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  const clash = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?").get(email, target.id);
  if (clash) return res.status(400).json({ error: "Another account already uses that email." });
  db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, target.id);
  logAudit(req.user.id, "edit-user", target.id, { oldEmail: target.email, newEmail: email });
  // Promoting/demoting to 'instructor' is a global-permissions change, not a scoped
  // per-account action — restricted to real admins, same as the acceptance statement.
  if (req.body?.role !== undefined) {
    if (!isRealAdmin(req.user.id)) return res.status(403).json(ADMIN_ONLY);
    const role = String(req.body.role);
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);
    logAudit(req.user.id, "change-role", target.id, { oldRole: target.role, newRole: role });
    if (role === "instructor") {
      const existing = db.prepare("SELECT id FROM forum_categories WHERE owner_user_id = ?").get(target.id);
      if (!existing) {
        const label = `${target.name || target.email.split("@")[0]}'s Class`;
        db.prepare("INSERT INTO forum_categories (id, slug, label, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(uid(), `instructor-${target.id}`, label, target.id, nowISO());
      }
    }
  }
  res.json({ ok: true });
});

// Deletes a user and every row that depends on them. No ON DELETE CASCADE is defined
// on these tables (foreign_keys is ON for ordinary request handling), so FK checks are
// dropped for the duration of this one transaction rather than hand-ordering ~15 tables.
router.delete("/users/:id", (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  if (target.is_admin) return res.status(400).json({ error: "Admin accounts can't be deleted here." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);

  const recordings = db.prepare("SELECT file_name FROM audio_recordings WHERE user_id = ?").all(target.id);

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM audio_recordings WHERE user_id = ?").run(target.id);
    // FKs are off for this whole transaction, so these two aren't needed to avoid an
    // error -- added anyway to avoid leaving orphaned join rows behind, same spirit
    // as every other cleanup step in this route.
    db.prepare("DELETE FROM session_block_techniques WHERE block_id IN (SELECT id FROM session_blocks WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?))").run(target.id);
    db.prepare("DELETE FROM session_block_lessons WHERE block_id IN (SELECT id FROM session_blocks WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?))").run(target.id);
    db.prepare("DELETE FROM session_blocks WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").run(target.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM queue_items WHERE sprint_id IN (SELECT id FROM sprints WHERE user_id = ?)").run(target.id);
    db.prepare("DELETE FROM sprints WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM notes WHERE user_id = ?").run(target.id);
    // Direct lessons.user_id (issue #17) -- a course_id-derived delete would leak
    // any standalone lesson (course_id IS NULL) belonging to this user.
    db.prepare("DELETE FROM lessons WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM courses WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM gear_maintenance WHERE gear_id IN (SELECT id FROM gear WHERE user_id = ?)").run(target.id);
    db.prepare("DELETE FROM gear WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM techniques WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM plans WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM topics WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM theory WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM custom_tunings WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM admin_notices WHERE user_id = ?").run(target.id);
    db.prepare("UPDATE admin_audit_log SET target_user_id = NULL WHERE target_user_id = ?").run(target.id);
    db.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(target.id, target.id);
    db.prepare("DELETE FROM forum_replies WHERE user_id = ? OR thread_id IN (SELECT id FROM forum_threads WHERE user_id = ?)").run(target.id, target.id);
    db.prepare("DELETE FROM forum_threads WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM enrollments WHERE instructor_id = ? OR student_id = ?").run(target.id, target.id);
    // An owned category (they were an instructor) takes its threads/replies with it too.
    const ownedCategory = db.prepare("SELECT id FROM forum_categories WHERE owner_user_id = ?").get(target.id);
    if (ownedCategory) {
      db.prepare("DELETE FROM forum_replies WHERE thread_id IN (SELECT id FROM forum_threads WHERE category_id = ?)").run(ownedCategory.id);
      db.prepare("DELETE FROM forum_threads WHERE category_id = ?").run(ownedCategory.id);
      db.prepare("DELETE FROM forum_categories WHERE id = ?").run(ownedCategory.id);
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw e;
  }
  db.exec("PRAGMA foreign_keys = ON");

  recordings.forEach((r) => { try { fs.unlinkSync(path.join(RECORDINGS_DIR, r.file_name)); } catch (e) {} });
  logAudit(req.user.id, "delete-user", null, { email: target.email, deletedUserId: target.id });
  res.json({ ok: true });
});

router.post("/users/:id/reset-password", async (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (!canActOn(req.user.id, target.role)) return res.status(403).json(SCOPE_DENIED);
  const temporaryPassword = crypto.randomBytes(6).toString("hex"); // always 12 alphanumeric chars, no stripping edge cases
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, target.id);
  logAudit(req.user.id, "reset-password", target.id, {}); // never the plaintext
  res.json({ ok: true, temporaryPassword });
});

router.get("/acceptance-statement", (req, res) => {
  if (!isRealAdmin(req.user.id)) return res.status(403).json(ADMIN_ONLY);
  const statement = db.prepare("SELECT version, body, updated_at FROM acceptance_statement WHERE id = 1").get();
  res.json({ version: statement.version, body: statement.body, updatedAt: statement.updated_at });
});

router.patch("/acceptance-statement", (req, res) => {
  if (!isRealAdmin(req.user.id)) return res.status(403).json(ADMIN_ONLY);
  const body = (req.body && req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Statement body is required." });
  const current = db.prepare("SELECT version FROM acceptance_statement WHERE id = 1").get();
  const nextVersion = current.version + 1;
  db.prepare("UPDATE acceptance_statement SET version = ?, body = ?, updated_at = ? WHERE id = 1").run(nextVersion, body, nowISO());
  logAudit(req.user.id, "update-acceptance-statement", null, { newVersion: nextVersion });
  res.json({ ok: true, version: nextVersion });
});

module.exports = router;
