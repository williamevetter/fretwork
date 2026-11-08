const express = require("express");
const { db } = require("../db");
const { uid } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToTechnique(row) {
  return { id: row.id, name: row.name };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM techniques WHERE user_id = ?").all(req.user.id);
  res.json(rows.map(rowToTechnique));
});

router.post("/", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required." });
  const row = { id: uid(), name };
  db.prepare("INSERT INTO techniques (id, user_id, name) VALUES (?, ?, ?)").run(row.id, req.user.id, row.name);
  res.json(rowToTechnique(row));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM techniques WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM techniques WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
