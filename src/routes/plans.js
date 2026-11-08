const express = require("express");
const { db } = require("../db");
const { uid } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToPlan(row) {
  return {
    id: row.id,
    date: row.date,
    content: row.content || "",
    goals: row.goals || "",
    techniques: JSON.parse(row.techniques_json || "[]"),
    lessonRefs: JSON.parse(row.lesson_refs_json || "[]"),
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM plans WHERE user_id = ? ORDER BY date DESC").all(req.user.id);
  res.json(rows.map(rowToPlan));
});

router.post("/", (req, res) => {
  const { date, content, goals, techniques, lessonRefs } = req.body || {};
  if (!date || !goals) return res.status(400).json({ error: "date and goals are required." });
  const row = {
    id: uid(), date, content: content || "", goals,
    techniques_json: JSON.stringify(techniques || []),
    lesson_refs_json: JSON.stringify(lessonRefs || []),
  };
  db.prepare(`
    INSERT INTO plans (id, user_id, date, content, goals, techniques_json, lesson_refs_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, req.user.id, row.date, row.content, row.goals, row.techniques_json, row.lesson_refs_json);
  res.json(rowToPlan(row));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM plans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM plans WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
