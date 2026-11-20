const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function displayName(row) {
  return row.name || row.email.split("@")[0];
}
function isRealAdmin(userId) {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return !!row && row.role === "admin";
}
// Global categories (owner_user_id NULL) are open to everyone. An instructor-owned
// category is exclusive to that instructor's own class -- the instructor themself,
// or one of their *accepted* students.
function canAccessCategory(userId, category) {
  if (!category.owner_user_id) return true;
  if (category.owner_user_id === userId) return true;
  const enrolled = db.prepare("SELECT 1 FROM enrollments WHERE instructor_id = ? AND student_id = ? AND status = 'accepted'")
    .get(category.owner_user_id, userId);
  return !!enrolled;
}
function getCategory(id) {
  return db.prepare("SELECT * FROM forum_categories WHERE id = ?").get(id);
}

router.get("/categories", (req, res) => {
  const rows = db.prepare("SELECT * FROM forum_categories ORDER BY owner_user_id IS NULL DESC, label").all();
  res.json(rows.map((c) => ({
    id: c.id, slug: c.slug, label: c.label, isInstructorClass: !!c.owner_user_id,
    canPost: canAccessCategory(req.user.id, c),
  })));
});

router.get("/categories/:id/threads", (req, res) => {
  const category = getCategory(req.params.id);
  if (!category) return res.status(404).json({ error: "Not found." });
  if (!canAccessCategory(req.user.id, category)) return res.status(403).json({ error: "Not available to you." });
  const rows = db.prepare(`
    SELECT forum_threads.*, users.name AS author_name, users.email AS author_email,
      (SELECT COUNT(*) FROM forum_replies WHERE forum_replies.thread_id = forum_threads.id) AS reply_count,
      COALESCE((SELECT MAX(created_at) FROM forum_replies WHERE forum_replies.thread_id = forum_threads.id), forum_threads.created_at) AS last_activity
    FROM forum_threads JOIN users ON users.id = forum_threads.user_id
    WHERE category_id = ?
    ORDER BY last_activity DESC
  `).all(category.id);
  res.json(rows.map((r) => ({
    id: r.id, title: r.title, author: displayName({ name: r.author_name, email: r.author_email }),
    replyCount: r.reply_count, createdAt: r.created_at, lastActivity: r.last_activity,
  })));
});

router.post("/categories/:id/threads", (req, res) => {
  const category = getCategory(req.params.id);
  if (!category) return res.status(404).json({ error: "Not found." });
  if (!canAccessCategory(req.user.id, category)) return res.status(403).json({ error: "Not available to you." });
  const title = (req.body?.title || "").trim();
  const body = (req.body?.body || "").trim();
  if (!title || !body) return res.status(400).json({ error: "title and body are required." });
  const row = { id: uid(), category_id: category.id, user_id: req.user.id, title, body, created_at: nowISO() };
  db.prepare("INSERT INTO forum_threads (id, category_id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.category_id, row.user_id, row.title, row.body, row.created_at);
  res.json({ id: row.id, title, body, createdAt: row.created_at, replies: [] });
});

function threadWithReplies(threadId) {
  const thread = db.prepare(`
    SELECT forum_threads.*, users.name AS author_name, users.email AS author_email
    FROM forum_threads JOIN users ON users.id = forum_threads.user_id
    WHERE forum_threads.id = ?
  `).get(threadId);
  if (!thread) return null;
  const replies = db.prepare(`
    SELECT forum_replies.*, users.name AS author_name, users.email AS author_email
    FROM forum_replies JOIN users ON users.id = forum_replies.user_id
    WHERE thread_id = ? ORDER BY created_at ASC
  `).all(threadId);
  return {
    id: thread.id, categoryId: thread.category_id, title: thread.title, body: thread.body,
    author: displayName({ name: thread.author_name, email: thread.author_email }), authorId: thread.user_id, createdAt: thread.created_at,
    replies: replies.map((r) => ({
      id: r.id, body: r.body, author: displayName({ name: r.author_name, email: r.author_email }), authorId: r.user_id, createdAt: r.created_at,
    })),
  };
}

router.get("/threads/:id", (req, res) => {
  const thread = db.prepare("SELECT category_id FROM forum_threads WHERE id = ?").get(req.params.id);
  if (!thread) return res.status(404).json({ error: "Not found." });
  const category = getCategory(thread.category_id);
  if (!canAccessCategory(req.user.id, category)) return res.status(403).json({ error: "Not available to you." });
  res.json(threadWithReplies(req.params.id));
});

router.post("/threads/:id/replies", (req, res) => {
  const thread = db.prepare("SELECT category_id FROM forum_threads WHERE id = ?").get(req.params.id);
  if (!thread) return res.status(404).json({ error: "Not found." });
  const category = getCategory(thread.category_id);
  if (!canAccessCategory(req.user.id, category)) return res.status(403).json({ error: "Not available to you." });
  const body = (req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "body is required." });
  db.prepare("INSERT INTO forum_replies (id, thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(uid(), req.params.id, req.user.id, body, nowISO());
  res.json(threadWithReplies(req.params.id));
});

function canModerate(userId, thread, category) {
  return thread.user_id === userId || category.owner_user_id === userId || isRealAdmin(userId);
}

router.delete("/threads/:id", (req, res) => {
  const thread = db.prepare("SELECT * FROM forum_threads WHERE id = ?").get(req.params.id);
  if (!thread) return res.status(404).json({ error: "Not found." });
  const category = getCategory(thread.category_id);
  if (!canModerate(req.user.id, thread, category)) return res.status(403).json({ error: "You can't delete this." });
  db.prepare("DELETE FROM forum_replies WHERE thread_id = ?").run(thread.id);
  db.prepare("DELETE FROM forum_threads WHERE id = ?").run(thread.id);
  res.json({ ok: true });
});

router.delete("/replies/:id", (req, res) => {
  const reply = db.prepare("SELECT * FROM forum_replies WHERE id = ?").get(req.params.id);
  if (!reply) return res.status(404).json({ error: "Not found." });
  const thread = db.prepare("SELECT * FROM forum_threads WHERE id = ?").get(reply.thread_id);
  const category = getCategory(thread.category_id);
  if (!(reply.user_id === req.user.id || category.owner_user_id === req.user.id || isRealAdmin(req.user.id))) {
    return res.status(403).json({ error: "You can't delete this." });
  }
  db.prepare("DELETE FROM forum_replies WHERE id = ?").run(reply.id);
  res.json({ ok: true });
});

module.exports = router;
