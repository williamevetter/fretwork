const express = require("express");
const { db } = require("../db");
const { uid } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

const STATUS_ORDER = ["learning", "practicing", "mastered"];

function rowToTheory(row) {
  return { id: row.id, name: row.name, status: row.status, notes: row.notes || "" };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM theory WHERE user_id = ? ORDER BY name").all(req.user.id);
  res.json(rows.map(rowToTheory));
});

router.post("/", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required." });
  const row = { id: uid(), name, status: "learning", notes: req.body?.notes || "" };
  db.prepare("INSERT INTO theory (id, user_id, name, status, notes) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.name, row.status, row.notes);
  res.json(rowToTheory(row));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM theory WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(row.status) + 1) % STATUS_ORDER.length];
  db.prepare("UPDATE theory SET status = ? WHERE id = ?").run(nextStatus, row.id);
  res.json(rowToTheory({ ...row, status: nextStatus }));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM theory WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM theory WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
