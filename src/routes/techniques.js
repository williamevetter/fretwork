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

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM techniques WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required." });
  db.prepare("UPDATE techniques SET name = ? WHERE id = ?").run(name, row.id);
  res.json(rowToTechnique({ ...row, name }));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM techniques WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  // technique_assignments.technique_id and session_block_techniques.technique_id
  // both reference this row — clear both before deleting, same as every other
  // cascade in this app. session_blocks.technique_id (the pre-v16 legacy single-FK
  // column, left in place unused) still enforces its own FK even though nothing
  // reads it anymore -- clear it too, or deleting a technique that predates v16
  // fails outright on any block that was never re-saved through the new system.
  db.prepare("DELETE FROM technique_assignments WHERE technique_id = ?").run(req.params.id);
  db.prepare("DELETE FROM session_block_techniques WHERE technique_id = ?").run(req.params.id);
  db.prepare("UPDATE session_blocks SET technique_id = NULL WHERE technique_id = ?").run(req.params.id);
  db.prepare("DELETE FROM techniques WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
