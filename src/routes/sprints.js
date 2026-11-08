const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");
const { CATEGORY_RANK, addDays } = require("../sprintLogic");

const router = express.Router();
router.use(requireAuth);

function queueItemRow(row) {
  return {
    id: row.id, category: row.category, title: row.title,
    important: !!row.important, completed: !!row.completed, notes: row.notes || "",
    ref: row.ref_json ? JSON.parse(row.ref_json) : null,
    carriedFromQueueItemId: row.carried_from_queue_item_id,
  };
}
function sprintRow(row, queueRows) {
  const queue = [...queueRows].sort((a, b) => {
    const r = (CATEGORY_RANK[a.category] ?? 99) - (CATEGORY_RANK[b.category] ?? 99);
    return r !== 0 ? r : a.sort_order - b.sort_order;
  });
  return {
    id: row.id, startDate: row.start_date, endDate: row.end_date, status: row.status,
    carriedFromSprintId: row.carried_from_sprint_id, queue: queue.map(queueItemRow),
  };
}

const queueStmt = db.prepare("SELECT * FROM queue_items WHERE sprint_id = ?");

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM sprints WHERE user_id = ? ORDER BY start_date DESC").all(req.user.id);
  res.json(rows.map((r) => sprintRow(r, queueStmt.all(r.id))));
});

router.post("/", (req, res) => {
  const startDate = req.body?.startDate;
  if (!startDate) return res.status(400).json({ error: "startDate is required." });
  const row = {
    id: uid(), start_date: startDate, end_date: addDays(startDate, 13),
    status: "active", carried_from_sprint_id: req.body?.carriedFromSprintId || null,
  };
  db.prepare(`
    INSERT INTO sprints (id, user_id, start_date, end_date, status, carried_from_sprint_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.id, req.user.id, row.start_date, row.end_date, row.status, row.carried_from_sprint_id);
  res.json(sprintRow(row, []));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM sprints WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const status = req.body?.status || row.status;
  db.prepare("UPDATE sprints SET status = ? WHERE id = ?").run(status, row.id);
  res.json(sprintRow({ ...row, status }, queueStmt.all(row.id)));
});

// Ends a sprint and starts the next one, cloning only the checked incomplete items
// (carriedFromQueueItemId set on each clone) — mirrors the old opt-in carry-forward flow.
router.post("/:id/end", (req, res) => {
  const sprint = db.prepare("SELECT * FROM sprints WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!sprint) return res.status(404).json({ error: "Not found." });
  const carryQueueItemIds = new Set(req.body?.carryQueueItemIds || []);
  const items = queueStmt.all(sprint.id);

  const newSprint = {
    id: uid(), start_date: req.body?.startDate || nowISO().slice(0, 10),
    status: "active", carried_from_sprint_id: sprint.id,
  };
  newSprint.end_date = addDays(newSprint.start_date, 13);

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE sprints SET status = 'completed' WHERE id = ?").run(sprint.id);
    db.prepare(`
      INSERT INTO sprints (id, user_id, start_date, end_date, status, carried_from_sprint_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newSprint.id, req.user.id, newSprint.start_date, newSprint.end_date, newSprint.status, newSprint.carried_from_sprint_id);

    const insertItem = db.prepare(`
      INSERT INTO queue_items (id, sprint_id, category, title, important, notes, ref_json, carried_from_queue_item_id, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    items.filter((q) => carryQueueItemIds.has(q.id)).forEach((q, i) => {
      insertItem.run(uid(), newSprint.id, q.category, q.title, q.important, q.notes, q.ref_json, q.id, i);
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  res.json({
    endedSprint: sprintRow({ ...sprint, status: "completed" }, items),
    newSprint: sprintRow(newSprint, queueStmt.all(newSprint.id)),
  });
});

router.post("/:id/queue-items", (req, res) => {
  const sprint = db.prepare("SELECT * FROM sprints WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!sprint) return res.status(404).json({ error: "Not found." });
  const { category, title, important, notes, ref } = req.body || {};
  if (!category || !String(title || "").trim()) return res.status(400).json({ error: "category and title are required." });
  const { max } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max FROM queue_items WHERE sprint_id = ? AND category = ?").get(sprint.id, category);
  const row = {
    id: uid(), category, title: title.trim(), important: important ? 1 : 0, completed: 0,
    notes: notes || "", ref_json: ref ? JSON.stringify(ref) : null, carried_from_queue_item_id: null, sort_order: max + 1,
  };
  db.prepare(`
    INSERT INTO queue_items (id, sprint_id, category, title, important, completed, notes, ref_json, carried_from_queue_item_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, sprint.id, row.category, row.title, row.important, row.completed, row.notes, row.ref_json, row.carried_from_queue_item_id, row.sort_order);
  res.json(queueItemRow(row));
});

function findQueueItemForUser(id, userId) {
  return db.prepare(`
    SELECT queue_items.* FROM queue_items JOIN sprints ON sprints.id = queue_items.sprint_id
    WHERE queue_items.id = ? AND sprints.user_id = ?
  `).get(id, userId);
}

router.patch("/queue-items/:id", (req, res) => {
  const row = findQueueItemForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const next = {
    title: req.body?.title !== undefined ? req.body.title.trim() : row.title,
    important: req.body?.important !== undefined ? (req.body.important ? 1 : 0) : row.important,
    completed: req.body?.completed !== undefined ? (req.body.completed ? 1 : 0) : row.completed,
    notes: req.body?.notes !== undefined ? req.body.notes : row.notes,
    ref_json: req.body?.ref !== undefined ? JSON.stringify(req.body.ref) : row.ref_json,
  };
  db.prepare("UPDATE queue_items SET title = ?, important = ?, completed = ?, notes = ?, ref_json = ? WHERE id = ?")
    .run(next.title, next.important, next.completed, next.notes, next.ref_json, row.id);
  res.json(queueItemRow({ ...row, ...next }));
});

router.delete("/queue-items/:id", (req, res) => {
  const row = findQueueItemForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM queue_items WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// Swaps sort_order with the adjacent item in the SAME category only (cross-category
// order is fixed by rank), matching the old client-side moveItem semantics exactly.
router.patch("/queue-items/:id/move", (req, res) => {
  const row = findQueueItemForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const dir = req.body?.direction === "up" ? -1 : 1;
  const sameCat = db.prepare("SELECT * FROM queue_items WHERE sprint_id = ? AND category = ? ORDER BY sort_order")
    .all(row.sprint_id, row.category);
  const idx = sameCat.findIndex((q) => q.id === row.id);
  const swapWith = sameCat[idx + dir];
  if (!swapWith) return res.json(queueItemRow(row));
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE queue_items SET sort_order = ? WHERE id = ?").run(swapWith.sort_order, row.id);
    db.prepare("UPDATE queue_items SET sort_order = ? WHERE id = ?").run(row.sort_order, swapWith.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json(queueItemRow({ ...row, sort_order: swapWith.sort_order }));
});

module.exports = router;
