const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToTopic(row) {
  return { id: row.id, type: row.type, text: row.text, status: row.status, created: row.created_at };
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

module.exports = router;
