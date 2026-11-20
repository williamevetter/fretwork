const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const { sendEmail } = require("../mailer");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

const APP_URL = process.env.APP_URL || "http://localhost:3300";

function displayName(row) {
  return row.name || row.email.split("@")[0];
}
function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}
function requireInstructor(req, res) {
  const me = getUser(req.user.id);
  if (!me || me.role !== "instructor") {
    res.status(403).json({ error: "Instructor accounts only." });
    return null;
  }
  return me;
}

// Instructor invites a student by email. Telling the instructor the email isn't
// registered is fine here (not a login-style enumeration risk) -- it's an expected
// instructor action, not an anonymous probe.
router.post("/invite", (req, res) => {
  const me = requireInstructor(req, res);
  if (!me) return;
  const email = (req.body?.email || "").trim();
  const student = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (!student) return res.status(404).json({ error: "No account with that email." });
  if (student.id === me.id) return res.status(400).json({ error: "You can't invite yourself." });
  const existing = db.prepare("SELECT * FROM enrollments WHERE instructor_id = ? AND student_id = ?").get(me.id, student.id);
  if (existing) return res.status(400).json({ error: existing.status === "accepted" ? "Already enrolled." : "Already invited." });
  db.prepare("INSERT INTO enrollments (id, instructor_id, student_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .run(uid(), me.id, student.id, nowISO());
  res.json({ ok: true });
});

// Invites the instructor sent, not yet responded to.
router.get("/sent", (req, res) => {
  const me = requireInstructor(req, res);
  if (!me) return;
  const rows = db.prepare(`
    SELECT enrollments.*, users.email AS student_email, users.name AS student_name
    FROM enrollments JOIN users ON users.id = enrollments.student_id
    WHERE enrollments.instructor_id = ? AND enrollments.status = 'pending'
    ORDER BY enrollments.created_at DESC
  `).all(me.id);
  res.json(rows.map((r) => ({ id: r.id, studentName: displayName({ name: r.student_name, email: r.student_email }), studentEmail: r.student_email, createdAt: r.created_at })));
});

// This account's own pending invite(s), as a prospective student.
router.get("/pending", (req, res) => {
  const rows = db.prepare(`
    SELECT enrollments.*, users.email AS instructor_email, users.name AS instructor_name
    FROM enrollments JOIN users ON users.id = enrollments.instructor_id
    WHERE enrollments.student_id = ? AND enrollments.status = 'pending'
    ORDER BY enrollments.created_at DESC
  `).all(req.user.id);
  res.json(rows.map((r) => ({ id: r.id, instructorName: displayName({ name: r.instructor_name, email: r.instructor_email }), createdAt: r.created_at })));
});

router.post("/:id/accept", (req, res) => {
  const row = db.prepare("SELECT * FROM enrollments WHERE id = ? AND student_id = ? AND status = 'pending'").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("UPDATE enrollments SET status = 'accepted', responded_at = ? WHERE id = ?").run(nowISO(), row.id);
  res.json({ ok: true });
});

router.post("/:id/decline", (req, res) => {
  const row = db.prepare("SELECT * FROM enrollments WHERE id = ? AND student_id = ? AND status = 'pending'").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM enrollments WHERE id = ?").run(row.id); // free to re-invite later
  res.json({ ok: true });
});

router.get("/students", (req, res) => {
  const me = requireInstructor(req, res);
  if (!me) return;
  const rows = db.prepare(`
    SELECT enrollments.id AS enrollment_id, users.id, users.name, users.email
    FROM enrollments JOIN users ON users.id = enrollments.student_id
    WHERE enrollments.instructor_id = ? AND enrollments.status = 'accepted'
    ORDER BY users.email
  `).all(me.id);
  res.json(rows.map((r) => ({ enrollmentId: r.enrollment_id, id: r.id, name: displayName(r), email: r.email })));
});

router.delete("/:id", (req, res) => {
  const me = requireInstructor(req, res);
  if (!me) return;
  const row = db.prepare("SELECT * FROM enrollments WHERE id = ? AND instructor_id = ?").get(req.params.id, me.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM enrollments WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// Same mechanism as POST /api/auth/forgot-password, just triggered by the instructor
// on behalf of one of their own accepted students -- no separate reset path.
router.post("/:id/reset-student-password", async (req, res) => {
  const me = requireInstructor(req, res);
  if (!me) return;
  const row = db.prepare("SELECT * FROM enrollments WHERE id = ? AND instructor_id = ? AND status = 'accepted'").get(req.params.id, me.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const student = getUser(row.student_id);
  const resetToken = uid();
  const resetTokenExpires = Date.now() + 60 * 60 * 1000;
  db.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?").run(resetToken, resetTokenExpires, student.id);
  const link = `${APP_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: student.email,
    subject: "Reset your Fretwork password",
    text: `Your instructor requested a password reset for you (expires in 1 hour): ${link}`,
    html: `<p>Your instructor requested a password reset for you.</p><p><a href="${link}">Reset your password</a> (expires in 1 hour)</p>`,
  });
  res.json({ ok: true });
});

module.exports = router;
