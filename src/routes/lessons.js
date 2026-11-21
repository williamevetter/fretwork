const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function lessonMeta(row) {
  return { id: row.id, title: row.title, fileType: row.file_type, fileName: row.file_name, uploadedDate: row.uploaded_date, primaryCourseId: row.course_id };
}
function lessonFull(row) {
  return { ...lessonMeta(row), html: row.html, text: row.text, dataUrl: row.data_url };
}

// Issue #17: a lesson's owner is lessons.user_id directly (not derived through
// its course), so it can stand alone with no course at all.
function findOwnedLesson(lessonId, userId) {
  return db.prepare("SELECT * FROM lessons WHERE id = ? AND user_id = ?").get(lessonId, userId);
}

// Materials not linked to any course.
router.get("/standalone", (req, res) => {
  const rows = db.prepare("SELECT * FROM lessons WHERE user_id = ? AND course_id IS NULL ORDER BY sort_order").all(req.user.id);
  res.json(rows.map(lessonMeta));
});

router.get("/:id", (req, res) => {
  const row = findOwnedLesson(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  res.json(lessonFull(row));
});

router.post("/", (req, res) => {
  const { title, fileType, fileName, uploadedDate, html, text, dataUrl, courseId } = req.body || {};
  if (!title || !fileType) return res.status(400).json({ error: "title and fileType are required." });
  let course_id = null;
  if (courseId) {
    const course = db.prepare("SELECT id FROM courses WHERE id = ? AND user_id = ?").get(courseId, req.user.id);
    if (!course) return res.status(404).json({ error: "Course not found." });
    course_id = courseId;
  }
  const { max } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max FROM lessons WHERE user_id = ?").get(req.user.id);
  const row = {
    id: uid(), course_id, user_id: req.user.id, title, file_type: fileType, file_name: fileName || null,
    uploaded_date: uploadedDate || null, html: html || null, text: text || null, data_url: dataUrl || null, sort_order: max + 1,
  };
  db.prepare(`
    INSERT INTO lessons (id, course_id, user_id, title, file_type, file_name, uploaded_date, html, text, data_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.course_id, row.user_id, row.title, row.file_type, row.file_name, row.uploaded_date, row.html, row.text, row.data_url, row.sort_order);
  res.json(lessonMeta(row));
});

router.patch("/:id", (req, res) => {
  const row = findOwnedLesson(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const title = req.body?.title !== undefined ? String(req.body.title).trim() : row.title;
  if (!title) return res.status(400).json({ error: "title is required." });
  let course_id = row.course_id;
  if (req.body?.courseId !== undefined) {
    if (req.body.courseId) {
      const course = db.prepare("SELECT id FROM courses WHERE id = ? AND user_id = ?").get(req.body.courseId, req.user.id);
      if (!course) return res.status(404).json({ error: "Course not found." });
      course_id = req.body.courseId;
    } else {
      course_id = null;
    }
  }
  db.prepare("UPDATE lessons SET title = ?, course_id = ? WHERE id = ?").run(title, course_id, row.id);
  res.json(lessonMeta({ ...row, title, course_id }));
});

router.delete("/:id", (req, res) => {
  const row = findOwnedLesson(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM notes WHERE lesson_id = ?").run(row.id);
    db.prepare("DELETE FROM lesson_courses WHERE lesson_id = ?").run(row.id);
    db.prepare("DELETE FROM technique_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(row.id);
    db.prepare("DELETE FROM session_block_lessons WHERE lesson_id = ?").run(row.id);
    db.prepare("DELETE FROM lessons WHERE id = ?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true });
});

// Associates an already-uploaded lesson with one more course, beyond its primary one.
router.post("/:id/courses", (req, res) => {
  const lesson = findOwnedLesson(req.params.id, req.user.id);
  if (!lesson) return res.status(404).json({ error: "Not found." });
  const courseId = req.body?.courseId;
  const course = db.prepare("SELECT id FROM courses WHERE id = ? AND user_id = ?").get(courseId, req.user.id);
  if (!course) return res.status(404).json({ error: "Course not found." });
  if (courseId === lesson.course_id) return res.status(400).json({ error: "That's already this lesson's primary course." });
  const exists = db.prepare("SELECT id FROM lesson_courses WHERE lesson_id = ? AND course_id = ?").get(lesson.id, courseId);
  if (!exists) {
    db.prepare("INSERT INTO lesson_courses (id, lesson_id, course_id, created_at) VALUES (?, ?, ?, ?)").run(uid(), lesson.id, courseId, nowISO());
  }
  res.json({ ok: true });
});

router.delete("/:id/courses/:courseId", (req, res) => {
  const lesson = findOwnedLesson(req.params.id, req.user.id);
  if (!lesson) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM lesson_courses WHERE lesson_id = ? AND course_id = ?").run(lesson.id, req.params.courseId);
  res.json({ ok: true });
});

module.exports = router;
module.exports.lessonMeta = lessonMeta;
module.exports.lessonFull = lessonFull;
module.exports.findOwnedLesson = findOwnedLesson;
