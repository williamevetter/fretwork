const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");
const { sendEmail } = require("../mailer");

const router = express.Router();
router.use(requireAuth);

function rowToTopic(row) {
  return { id: row.id, type: row.type, text: row.text, status: row.status, created: row.created_at };
}
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM topics WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(rows.map(rowToTopic));
});

router.post("/", (req, res) => {
  const text = (req.body?.text || "").trim();
  const type = req.body?.type || "issue";
  if (!text) return res.status(400).json({ error: "text is required." });
  const row = { id: uid(), type, text, status: "open", created_at: nowISO() };
  db.prepare("INSERT INTO topics (id, user_id, type, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.type, row.text, row.status, row.created_at);
  res.json(rowToTopic(row));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM topics WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const nextStatus = row.status === "open" ? "resolved" : "open";
  db.prepare("UPDATE topics SET status = ? WHERE id = ?").run(nextStatus, row.id);
  res.json(rowToTopic({ ...row, status: nextStatus }));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM topics WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM topics WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Emails a chosen set of the user's own topics/questions/problems to an address
// of their choosing (themselves, a saved contact, or a one-off typed address).
router.post("/send-email", async (req, res) => {
  const to = (req.body?.to || "").trim();
  const ids = Array.isArray(req.body?.topicIds) ? req.body.topicIds : [];
  const note = (req.body?.note || "").trim();
  if (!isValidEmail(to)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!ids.length) return res.status(400).json({ error: "Select at least one item to send." });

  const sender = db.prepare("SELECT name, email FROM users WHERE id = ?").get(req.user.id);
  const senderLabel = sender.name ? `${sender.name} (${sender.email})` : sender.email;
  const subject = `A new Guitar Question from ${senderLabel}`;

  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM topics WHERE user_id = ? AND id IN (${placeholders})`).all(req.user.id, ...ids);
  if (!rows.length) return res.status(404).json({ error: "Not found." });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  const text = "Topics & Questions from Fretwork:\n\n" + ordered.map((r) => `[${r.type.toUpperCase()}] ${r.text}`).join("\n")
    + (note ? `\n\nNote from ${senderLabel}:\n${note}` : "");
  const html = "<p>Topics &amp; Questions from Fretwork:</p><ul>" +
    ordered.map((r) => `<li><strong>${escapeHtml(r.type)}</strong>: ${escapeHtml(r.text)}</li>`).join("") + "</ul>"
    + (note ? `<p><strong>Note from ${escapeHtml(senderLabel)}:</strong><br>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : "");
  const result = await sendEmail({ to, subject, text, html });
  res.json({ ok: true, delivered: !!result.delivered });
});

module.exports = router;
