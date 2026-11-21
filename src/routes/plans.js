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
    plannedMinutes: row.planned_minutes != null ? row.planned_minutes : null,
    sprintId: row.sprint_id || null,
    techniques: JSON.parse(row.techniques_json || "[]"),
    lessonRefs: JSON.parse(row.lesson_refs_json || "[]"),
    blocks: JSON.parse(row.blocks_json || "[]"),
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM plans WHERE user_id = ? ORDER BY date DESC").all(req.user.id);
  res.json(rows.map(rowToPlan));
});

router.post("/", (req, res) => {
  const { date, content, goals, techniques, lessonRefs, plannedMinutes, blocks, sprintId } = req.body || {};
  if (!date || !goals) return res.status(400).json({ error: "date and goals are required." });
  let sprint_id = null;
  if (sprintId) {
    const owned = db.prepare("SELECT id FROM sprints WHERE id = ? AND user_id = ?").get(sprintId, req.user.id);
    if (!owned) return res.status(404).json({ error: "Sprint not found." });
    sprint_id = sprintId;
  }
  const row = {
    id: uid(), date, content: content || "", goals, sprint_id,
    planned_minutes: plannedMinutes != null ? Number(plannedMinutes) : null,
    techniques_json: JSON.stringify(techniques || []),
    lesson_refs_json: JSON.stringify(lessonRefs || []),
    blocks_json: JSON.stringify(blocks || []),
  };
  db.prepare(`
    INSERT INTO plans (id, user_id, date, content, goals, planned_minutes, sprint_id, techniques_json, lesson_refs_json, blocks_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, req.user.id, row.date, row.content, row.goals, row.planned_minutes, row.sprint_id, row.techniques_json, row.lesson_refs_json, row.blocks_json);
  res.json(rowToPlan(row));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM plans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const date = req.body?.date !== undefined ? req.body.date : row.date;
  const goals = req.body?.goals !== undefined ? req.body.goals : row.goals;
  const content = req.body?.content !== undefined ? req.body.content : row.content;
  const plannedMinutes = req.body?.plannedMinutes !== undefined
    ? (req.body.plannedMinutes != null ? Number(req.body.plannedMinutes) : null)
    : row.planned_minutes;
  let sprint_id = row.sprint_id;
  if (req.body?.sprintId !== undefined) {
    if (req.body.sprintId) {
      const owned = db.prepare("SELECT id FROM sprints WHERE id = ? AND user_id = ?").get(req.body.sprintId, req.user.id);
      if (!owned) return res.status(404).json({ error: "Sprint not found." });
      sprint_id = req.body.sprintId;
    } else {
      sprint_id = null;
    }
  }
  const techniquesJson = req.body?.techniques !== undefined ? JSON.stringify(req.body.techniques) : row.techniques_json;
  const lessonRefsJson = req.body?.lessonRefs !== undefined ? JSON.stringify(req.body.lessonRefs) : row.lesson_refs_json;
  const blocksJson = req.body?.blocks !== undefined ? JSON.stringify(req.body.blocks) : row.blocks_json;
  if (!date || !goals) return res.status(400).json({ error: "date and goals are required." });
  db.prepare(`
    UPDATE plans SET date = ?, content = ?, goals = ?, planned_minutes = ?, sprint_id = ?, techniques_json = ?, lesson_refs_json = ?, blocks_json = ?
    WHERE id = ?
  `).run(date, content, goals, plannedMinutes, sprint_id, techniquesJson, lessonRefsJson, blocksJson, row.id);
  res.json(rowToPlan({ ...row, date, content, goals, planned_minutes: plannedMinutes, sprint_id, techniques_json: techniquesJson, lesson_refs_json: lessonRefsJson, blocks_json: blocksJson }));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM plans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM plans WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
