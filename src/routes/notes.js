const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToNote(row) {
  return {
    id: row.id, courseId: row.course_id, courseName: row.course_name,
    lessonId: row.lesson_id, lessonTitle: row.lesson_title,
    pageRef: row.page_ref || "", text: row.text, created: row.created_at,
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(rows.map(rowToNote));
});

router.post("/", (req, res) => {
  const { courseId, courseName, lessonId, lessonTitle, pageRef, text } = req.body || {};
  if (!String(text || "").trim()) return res.status(400).json({ error: "text is required." });
  const row = {
    id: uid(), course_id: courseId || null, course_name: courseName || "",
    lesson_id: lessonId || null, lesson_title: lessonTitle || "",
    page_ref: (pageRef || "").trim(), text: text.trim(), created_at: nowISO().slice(0, 10),
  };
  db.prepare(`
    INSERT INTO notes (id, user_id, course_id, course_name, lesson_id, lesson_title, page_ref, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, req.user.id, row.course_id, row.course_name, row.lesson_id, row.lesson_title, row.page_ref, row.text, row.created_at);
  res.json(rowToNote(row));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
