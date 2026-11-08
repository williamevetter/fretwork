const express = require("express");
const { db } = require("../db");
const { nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

// Every user's own "do I have a pending notice for myself" check — not admin-gated,
// since this is about receiving a notice, not sending one.
router.get("/pending", (req, res) => {
  const row = db.prepare(`
    SELECT * FROM admin_notices WHERE user_id = ? AND shown_at IS NULL ORDER BY created_at ASC LIMIT 1
  `).get(req.user.id);
  if (!row) return res.json(null);
  res.json({ id: row.id, message: row.message, createdAt: row.created_at });
});

router.post("/:id/dismiss", (req, res) => {
  const row = db.prepare("SELECT * FROM admin_notices WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("UPDATE admin_notices SET shown_at = ? WHERE id = ?").run(nowISO(), row.id);
  res.json({ ok: true });
});

module.exports = router;
