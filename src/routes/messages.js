const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const { sendEmail, SMTP_CONFIGURED } = require("../mailer");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

const APP_URL = process.env.APP_URL || "http://localhost:3300";

function displayName(row) {
  return row.name || row.email.split("@")[0];
}

// Who the current user is allowed to message -- never an open directory. Admins get
// the same visibility they already have on the admin dashboard (test_admin scoped the
// same way it is there); everyone else is limited to an actual enrollment relationship.
function visibleRecipients(userId) {
  const me = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (me.is_admin) {
    const rows = db.prepare("SELECT id, name, email, role FROM users WHERE id != ?").all(userId);
    return me.role === "test_admin" ? rows.filter((r) => r.role === "test_instructor" || r.role === "test_user") : rows;
  }
  if (me.role === "instructor") {
    return db.prepare(`
      SELECT users.id, users.name, users.email FROM enrollments JOIN users ON users.id = enrollments.student_id
      WHERE enrollments.instructor_id = ? AND enrollments.status = 'accepted'
    `).all(userId);
  }
  return db.prepare(`
    SELECT users.id, users.name, users.email FROM enrollments JOIN users ON users.id = enrollments.instructor_id
    WHERE enrollments.student_id = ? AND enrollments.status = 'accepted'
  `).all(userId);
}

router.get("/contacts", (req, res) => {
  res.json(visibleRecipients(req.user.id).map((r) => ({ id: r.id, name: displayName(r) })));
});

router.get("/", (req, res) => {
  const rows = db.prepare(`
    SELECT messages.*,
      CASE WHEN sender_id = ? THEN ru.name ELSE su.name END AS other_name,
      CASE WHEN sender_id = ? THEN ru.email ELSE su.email END AS other_email
    FROM messages
    JOIN users su ON su.id = messages.sender_id
    JOIN users ru ON ru.id = messages.recipient_id
    WHERE sender_id = ? OR recipient_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(rows.map((r) => ({
    id: r.id, direction: r.sender_id === req.user.id ? "sent" : "received",
    otherParty: displayName({ name: r.other_name, email: r.other_email }),
    category: r.category, body: r.body, createdAt: r.created_at, readAt: r.read_at,
  })));
});

router.post("/", async (req, res) => {
  const recipientIds = Array.isArray(req.body?.recipientIds) ? req.body.recipientIds : [];
  const category = (req.body?.category || "general").trim().slice(0, 40) || "general";
  const body = (req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "body is required." });
  if (!recipientIds.length) return res.status(400).json({ error: "At least one recipient is required." });
  const allowed = new Set(visibleRecipients(req.user.id).map((r) => r.id));
  const invalid = recipientIds.filter((id) => !allowed.has(id));
  if (invalid.length) return res.status(403).json({ error: "You can't message one or more of those recipients." });

  const sender = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const now = nowISO();
  const insert = db.prepare("INSERT INTO messages (id, sender_id, recipient_id, category, body, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  recipientIds.forEach((recipientId) => insert.run(uid(), req.user.id, recipientId, category, body, now));

  if (SMTP_CONFIGURED) {
    const recipients = db.prepare(`SELECT * FROM users WHERE id IN (${recipientIds.map(() => "?").join(",")}) AND notify_new_message = 1`).all(...recipientIds);
    for (const r of recipients) {
      await sendEmail({
        to: r.email,
        subject: `New Fretwork message from ${displayName(sender)}`,
        text: `You have a new message from ${displayName(sender)} on Fretwork. Log in to read it: ${APP_URL}`,
        html: `<p>You have a new message from ${displayName(sender)} on Fretwork.</p><p><a href="${APP_URL}">Log in to read it</a></p>`,
      });
    }
  }
  res.json({ ok: true });
});

router.post("/:id/read", (req, res) => {
  const row = db.prepare("SELECT * FROM messages WHERE id = ? AND recipient_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("UPDATE messages SET read_at = ? WHERE id = ?").run(nowISO(), row.id);
  res.json({ ok: true });
});

module.exports = router;
