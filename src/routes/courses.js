const express = require("express");
const { db } = require("../db");
const { uid } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function lessonMeta(row) {
  return { id: row.id, title: row.title, fileType: row.file_type, fileName: row.file_name, uploadedDate: row.uploaded_date };
}
function lessonFull(row) {
  return { ...lessonMeta(row), html: row.html, text: row.text, dataUrl: row.data_url };
}
const SPRINT_LENGTH_UNITS = ["day", "week", "month", "year"];
function courseEntry(row, lessonRows) {
  return {
    id: row.id, name: row.name, description: row.description || "",
    sprintLengthValue: row.sprint_length_value, sprintLengthUnit: row.sprint_length_unit,
    lessons: lessonRows.map(lessonMeta),
  };
}

const lessonsStmt = db.prepare("SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order");

// Lightweight index — lesson metadata only, no content. Matches the lazy-load
// shape the frontend already relies on (full content is fetched per course on open).
router.get("/", (req, res) => {
  const courseRows = db.prepare("SELECT * FROM courses WHERE user_id = ?").all(req.user.id);
  res.json(courseRows.map((c) => courseEntry(c, lessonsStmt.all(c.id))));
});

// Full lesson content for one course.
router.get("/:id/content", (req, res) => {
  const course = db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!course) return res.status(404).json({ error: "Not found." });
  res.json({ lessons: lessonsStmt.all(course.id).map(lessonFull) });
});

router.post("/", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required." });
  const sprintLengthUnit = SPRINT_LENGTH_UNITS.includes(req.body?.sprintLengthUnit) ? req.body.sprintLengthUnit : "week";
  const row = {
    id: uid(), name, description: (req.body?.description || "").trim(),
    sprint_length_value: Number(req.body?.sprintLengthValue) || 2, sprint_length_unit: sprintLengthUnit,
  };
  db.prepare("INSERT INTO courses (id, user_id, name, description, sprint_length_value, sprint_length_unit) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.name, row.description, row.sprint_length_value, row.sprint_length_unit);
  res.json(courseEntry(row, []));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : row.description;
  const sprint_length_value = req.body?.sprintLengthValue !== undefined ? (Number(req.body.sprintLengthValue) || 2) : row.sprint_length_value;
  const sprint_length_unit = req.body?.sprintLengthUnit !== undefined
    ? (SPRINT_LENGTH_UNITS.includes(req.body.sprintLengthUnit) ? req.body.sprintLengthUnit : row.sprint_length_unit)
    : row.sprint_length_unit;
  db.prepare("UPDATE courses SET name = ?, description = ?, sprint_length_value = ?, sprint_length_unit = ? WHERE id = ?")
    .run(name, description, sprint_length_value, sprint_length_unit, row.id);
  res.json(courseEntry({ ...row, name, description, sprint_length_value, sprint_length_unit }, lessonsStmt.all(row.id)));
});

router.delete("/:id", (req, res) => {
  const course = db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!course) return res.status(404).json({ error: "Not found." });
  db.exec("BEGIN");
  try {
    const lessonIds = db.prepare("SELECT id FROM lessons WHERE course_id = ?").all(course.id).map((l) => l.id);
    const deleteNotesForLesson = db.prepare("DELETE FROM notes WHERE lesson_id = ?");
    lessonIds.forEach((lid) => deleteNotesForLesson.run(lid));
    db.prepare("DELETE FROM notes WHERE course_id = ? AND lesson_id IS NULL").run(course.id);
    db.prepare("DELETE FROM lessons WHERE course_id = ?").run(course.id);
    db.prepare("DELETE FROM courses WHERE id = ?").run(course.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true });
});

router.post("/:id/lessons", (req, res) => {
  const course = db.prepare("SELECT * FROM courses WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!course) return res.status(404).json({ error: "Not found." });
  const { title, fileType, fileName, uploadedDate, html, text, dataUrl } = req.body || {};
  if (!title || !fileType) return res.status(400).json({ error: "title and fileType are required." });
  const { max } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max FROM lessons WHERE course_id = ?").get(course.id);
  const row = {
    id: uid(), title, file_type: fileType, file_name: fileName || null, uploaded_date: uploadedDate || null,
    html: html || null, text: text || null, data_url: dataUrl || null, sort_order: max + 1,
  };
  db.prepare(`
    INSERT INTO lessons (id, course_id, title, file_type, file_name, uploaded_date, html, text, data_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, course.id, row.title, row.file_type, row.file_name, row.uploaded_date, row.html, row.text, row.data_url, row.sort_order);
  res.json(lessonMeta(row));
});

router.delete("/:courseId/lessons/:lessonId", (req, res) => {
  const row = db.prepare(`
    SELECT lessons.* FROM lessons JOIN courses ON courses.id = lessons.course_id
    WHERE lessons.id = ? AND lessons.course_id = ? AND courses.user_id = ?
  `).get(req.params.lessonId, req.params.courseId, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM notes WHERE lesson_id = ?").run(row.id);
    db.prepare("DELETE FROM lessons WHERE id = ?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true });
});

module.exports = router;
