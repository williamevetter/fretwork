const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function rowToContact(row) {
  return { id: row.id, label: row.label, email: row.email };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM email_contacts WHERE user_id = ? ORDER BY label COLLATE NOCASE").all(req.user.id);
  res.json(rows.map(rowToContact));
});

router.post("/", (req, res) => {
  const label = (req.body?.label || "").trim();
  const email = (req.body?.email || "").trim();
  if (!label) return res.status(400).json({ error: "label is required." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  const row = { id: uid(), label, email, created_at: nowISO() };
  db.prepare("INSERT INTO email_contacts (id, user_id, label, email, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.label, row.email, row.created_at);
  res.json(rowToContact(row));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM email_contacts WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM email_contacts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
