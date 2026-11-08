const express = require("express");
const fs = require("fs");
const path = require("path");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");
const { CATEGORIES, addDays } = require("../sprintLogic");

const RECORDINGS_DIR = path.join(__dirname, "..", "..", "data", "recordings");
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const router = express.Router();
router.use(requireAuth);

function blockRow(row) {
  return {
    id: row.id, queueItemId: row.queue_item_id, material: row.material, category: row.category,
    techniqueId: row.technique_id, actualMinutes: row.actual_minutes, plannedMinutes: row.planned_minutes,
    completed: !!row.completed, important: !!row.important, ref: row.ref_json ? JSON.parse(row.ref_json) : null,
    notes: row.notes || "", importedEntryId: row.imported_entry_id, createdAt: row.created_at, updatedAt: row.updated_at,
    timerStartedAt: row.timer_started_at || null,
  };
}
function recordingRow(row) {
  return {
    id: row.id, fileName: row.file_name, mimeType: row.mime_type,
    durationSeconds: row.duration_seconds, createdAt: row.created_at,
  };
}
// Queries recordings itself (by row.id) rather than taking them as a parameter —
// every existing call site stays unchanged, nothing to thread through.
function sessionWithBlocks(row, blockRows) {
  const duration = blockRows.reduce((s, b) => s + (Number(b.actual_minutes) || 0), 0);
  const techniqueTimes = {};
  blockRows.forEach((b) => {
    if (b.technique_id) techniqueTimes[b.technique_id] = (techniqueTimes[b.technique_id] || 0) + (Number(b.actual_minutes) || 0);
  });
  const recordings = db.prepare("SELECT * FROM audio_recordings WHERE session_id = ? ORDER BY created_at").all(row.id);
  return {
    id: row.id, date: row.date, sprintId: row.sprint_id, notes: row.notes || "",
    duration, techniqueTimes, blocks: blockRows.map(blockRow), recordings: recordings.map(recordingRow),
  };
}

const blocksStmt = db.prepare("SELECT * FROM session_blocks WHERE session_id = ? ORDER BY created_at");

router.get("/", (req, res) => {
  const { from, to, sprintId } = req.query;
  let sql = "SELECT * FROM sessions WHERE user_id = ?";
  const params = [req.user.id];
  if (from) { sql += " AND date >= ?"; params.push(from); }
  if (to) { sql += " AND date <= ?"; params.push(to); }
  if (sprintId) { sql += " AND sprint_id = ?"; params.push(sprintId); }
  sql += " ORDER BY date DESC";
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => sessionWithBlocks(r, blocksStmt.all(r.id))));
});

router.post("/", (req, res) => {
  const date = req.body?.date;
  if (!date) return res.status(400).json({ error: "date is required." });
  const now = nowISO();
  const row = { id: uid(), date, sprint_id: req.body?.sprintId || null, notes: req.body?.notes || "", created_at: now, updated_at: now };
  db.prepare("INSERT INTO sessions (id, user_id, date, sprint_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.date, row.sprint_id, row.notes, row.created_at, row.updated_at);
  res.json(sessionWithBlocks(row, []));
});

function findSessionForUser(id, userId) {
  return db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(id, userId);
}

router.patch("/:id", (req, res) => {
  const row = findSessionForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const notes = req.body?.notes !== undefined ? req.body.notes : row.notes;
  const date = req.body?.date !== undefined ? req.body.date : row.date;
  const sprint_id = req.body?.sprintId !== undefined ? req.body.sprintId : row.sprint_id;
  const updated_at = nowISO();
  db.prepare("UPDATE sessions SET notes = ?, date = ?, sprint_id = ?, updated_at = ? WHERE id = ?").run(notes, date, sprint_id, updated_at, row.id);
  res.json(sessionWithBlocks({ ...row, notes, date, sprint_id, updated_at }, blocksStmt.all(row.id)));
});

router.delete("/:id", (req, res) => {
  const row = findSessionForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const recordingFiles = db.prepare("SELECT file_name FROM audio_recordings WHERE session_id = ?").all(row.id);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM session_blocks WHERE session_id = ?").run(row.id);
    db.prepare("DELETE FROM audio_recordings WHERE session_id = ?").run(row.id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  recordingFiles.forEach((r) => fs.promises.unlink(path.join(RECORDINGS_DIR, r.file_name)).catch(() => {}));
  res.json({ ok: true });
});

router.post("/:id/recordings", (req, res) => {
  const session = findSessionForUser(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: "Not found." });
  const { mimeType, dataBase64, durationSeconds } = req.body || {};
  if (!mimeType || !dataBase64) return res.status(400).json({ error: "mimeType and dataBase64 are required." });
  const ext = (mimeType.split("/")[1] || "webm").split(";")[0];
  const id = uid();
  const fileName = `${id}.${ext}`;
  let buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch (e) {
    return res.status(400).json({ error: "dataBase64 is not valid base64." });
  }
  fs.writeFileSync(path.join(RECORDINGS_DIR, fileName), buffer);
  db.prepare(`
    INSERT INTO audio_recordings (id, session_id, user_id, file_name, mime_type, duration_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, session.id, req.user.id, fileName, mimeType, durationSeconds != null ? Number(durationSeconds) : null, nowISO());
  res.json(sessionWithBlocks(session, blocksStmt.all(session.id)));
});

router.post("/:id/blocks", (req, res) => {
  const session = findSessionForUser(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: "Not found." });
  const { queueItemId, material, category, techniqueId, actualMinutes, plannedMinutes, completed, important, ref, notes, timerStartedAt } = req.body || {};
  if (!String(material || "").trim() || !category) return res.status(400).json({ error: "material and category are required." });
  const now = nowISO();
  const row = {
    id: uid(), session_id: session.id, queue_item_id: queueItemId || null, technique_id: techniqueId || null,
    material: material.trim(), category, actual_minutes: Number(actualMinutes) || 0, planned_minutes: plannedMinutes != null ? Number(plannedMinutes) : null,
    completed: completed ? 1 : 0, important: important ? 1 : 0, ref_json: ref ? JSON.stringify(ref) : null,
    notes: notes || "", imported_entry_id: null, timer_started_at: timerStartedAt || null, created_at: now, updated_at: now,
  };
  db.prepare(`
    INSERT INTO session_blocks (id, session_id, queue_item_id, technique_id, material, category, actual_minutes, planned_minutes, completed, important, ref_json, notes, imported_entry_id, timer_started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.session_id, row.queue_item_id, row.technique_id, row.material, row.category, row.actual_minutes, row.planned_minutes, row.completed, row.important, row.ref_json, row.notes, row.imported_entry_id, row.timer_started_at, row.created_at, row.updated_at);
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, session.id);
  res.json(sessionWithBlocks(session, blocksStmt.all(session.id)));
});

function findBlockForUser(id, userId) {
  return db.prepare(`
    SELECT session_blocks.* FROM session_blocks JOIN sessions ON sessions.id = session_blocks.session_id
    WHERE session_blocks.id = ? AND sessions.user_id = ?
  `).get(id, userId);
}

router.patch("/blocks/:id", (req, res) => {
  const row = findBlockForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const b = req.body || {};
  const next = {
    material: b.material !== undefined ? b.material.trim() : row.material,
    category: b.category !== undefined ? b.category : row.category,
    technique_id: b.techniqueId !== undefined ? b.techniqueId : row.technique_id,
    actual_minutes: b.actualMinutes !== undefined ? Number(b.actualMinutes) || 0 : row.actual_minutes,
    planned_minutes: b.plannedMinutes !== undefined ? (b.plannedMinutes != null ? Number(b.plannedMinutes) : null) : row.planned_minutes,
    completed: b.completed !== undefined ? (b.completed ? 1 : 0) : row.completed,
    important: b.important !== undefined ? (b.important ? 1 : 0) : row.important,
    ref_json: b.ref !== undefined ? (b.ref ? JSON.stringify(b.ref) : null) : row.ref_json,
    notes: b.notes !== undefined ? b.notes : row.notes,
    timer_started_at: b.timerStartedAt !== undefined ? b.timerStartedAt : row.timer_started_at,
    updated_at: nowISO(),
  };
  db.prepare(`
    UPDATE session_blocks SET material = ?, category = ?, technique_id = ?, actual_minutes = ?, planned_minutes = ?,
      completed = ?, important = ?, ref_json = ?, notes = ?, timer_started_at = ?, updated_at = ? WHERE id = ?
  `).run(next.material, next.category, next.technique_id, next.actual_minutes, next.planned_minutes, next.completed, next.important, next.ref_json, next.notes, next.timer_started_at, next.updated_at, row.id);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(row.session_id);
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(next.updated_at, session.id);
  res.json(sessionWithBlocks(session, blocksStmt.all(session.id)));
});

router.delete("/blocks/:id", (req, res) => {
  const row = findBlockForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM session_blocks WHERE id = ?").run(row.id);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(row.session_id);
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(nowISO(), session.id);
  res.json(sessionWithBlocks(session, blocksStmt.all(session.id)));
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Direct SQL port of the already-tested classifyImportEntries/applyChecklistImport logic.
// Classification (preview) touches nothing; apply runs as one transaction.
function classifyEntries(entries, userId) {
  const buckets = { new: [], changed: [], duplicate: [], invalid: [] };
  const blocksByImportId = {};
  db.prepare(`
    SELECT session_blocks.* FROM session_blocks JOIN sessions ON sessions.id = session_blocks.session_id
    WHERE sessions.user_id = ? AND session_blocks.imported_entry_id IS NOT NULL
  `).all(userId).forEach((b) => { blocksByImportId[b.imported_entry_id] = b; });

  (entries || []).forEach((entry) => {
    const errors = [];
    if (!entry || !entry.id) errors.push("missing id");
    if (!entry || !ISO_DATE_RE.test(entry.sprint_start || "")) errors.push("invalid sprint_start");
    if (!entry || !ISO_DATE_RE.test(entry.practice_date || "")) errors.push("invalid practice_date");
    if (!entry || !CATEGORIES.includes(entry.category)) errors.push("unknown category" + (entry ? `: "${entry.category}"` : ""));
    if (!entry || !String(entry.material || "").trim()) errors.push("missing material");
    if (!entry || typeof entry.minutes !== "number" || entry.minutes < 0) errors.push("invalid minutes");
    if (errors.length > 0) { buckets.invalid.push({ entry, errors }); return; }

    const existing = blocksByImportId[entry.id];
    if (!existing) { buckets.new.push(entry); return; }
    const same = existing.category === entry.category && existing.material === entry.material
      && existing.actual_minutes === entry.minutes && !!existing.important === !!entry.important
      && !!existing.completed === !!entry.completed && (existing.notes || "") === (entry.notes || "");
    (same ? buckets.duplicate : buckets.changed).push(entry);
  });
  return buckets;
}

function applyImport(entries, userId) {
  const sprintIdFor = {};
  entries.forEach((entry) => {
    if (sprintIdFor[entry.sprint_start] !== undefined) return;
    const existing = db.prepare("SELECT id FROM sprints WHERE user_id = ? AND start_date = ?").get(userId, entry.sprint_start);
    if (existing) { sprintIdFor[entry.sprint_start] = existing.id; return; }
    const id = uid();
    db.prepare("INSERT INTO sprints (id, user_id, start_date, end_date, status) VALUES (?, ?, ?, ?, 'active')")
      .run(id, userId, entry.sprint_start, addDays(entry.sprint_start, 13));
    sprintIdFor[entry.sprint_start] = id;
  });

  const queueKey = (entry) => entry.sprint_start + "|" + entry.category + "|" + entry.material;
  const queueItemIdFor = {};
  entries.forEach((entry) => {
    const key = queueKey(entry);
    if (queueItemIdFor[key] !== undefined) return;
    const sprintId = sprintIdFor[entry.sprint_start];
    const existing = db.prepare("SELECT id FROM queue_items WHERE sprint_id = ? AND category = ? AND title = ?")
      .get(sprintId, entry.category, entry.material);
    if (existing) { queueItemIdFor[key] = existing.id; return; }
    const id = uid();
    const { max } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max FROM queue_items WHERE sprint_id = ? AND category = ?").get(sprintId, entry.category);
    db.prepare("INSERT INTO queue_items (id, sprint_id, category, title, important, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, sprintId, entry.category, entry.material, entry.important ? 1 : 0, max + 1);
    queueItemIdFor[key] = id;
  });

  const sessionKey = (sprintId, date) => sprintId + "|" + date;
  const sessionIdFor = {};
  entries.forEach((entry) => {
    const sprintId = sprintIdFor[entry.sprint_start];
    const key = sessionKey(sprintId, entry.practice_date);
    if (sessionIdFor[key] !== undefined) return;
    const existing = db.prepare("SELECT id FROM sessions WHERE user_id = ? AND sprint_id = ? AND date = ?")
      .get(userId, sprintId, entry.practice_date);
    if (existing) { sessionIdFor[key] = existing.id; return; }
    const id = uid();
    const now = nowISO();
    db.prepare("INSERT INTO sessions (id, user_id, date, sprint_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?)")
      .run(id, userId, entry.practice_date, sprintId, now, now);
    sessionIdFor[key] = id;
  });

  const touchedSessionIds = new Set();
  entries.forEach((entry) => {
    const sprintId = sprintIdFor[entry.sprint_start];
    const sessionId = sessionIdFor[sessionKey(sprintId, entry.practice_date)];
    touchedSessionIds.add(sessionId);
    const queueItemId = queueItemIdFor[queueKey(entry)];
    const existingBlock = db.prepare("SELECT id FROM session_blocks WHERE session_id = ? AND imported_entry_id = ?").get(sessionId, entry.id);
    const now = nowISO();
    if (existingBlock) {
      // Per decision: the checklist file is the source of truth — reimport always
      // overwrites, even a manual correction made to this block in between.
      db.prepare(`
        UPDATE session_blocks SET category = ?, material = ?, actual_minutes = ?, important = ?, completed = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(entry.category, entry.material, Number(entry.minutes), entry.important ? 1 : 0, entry.completed ? 1 : 0, entry.notes || "", now, existingBlock.id);
    } else {
      db.prepare(`
        INSERT INTO session_blocks (id, session_id, queue_item_id, material, category, actual_minutes, completed, important, notes, imported_entry_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uid(), sessionId, queueItemId, entry.material, entry.category, Number(entry.minutes), entry.completed ? 1 : 0, entry.important ? 1 : 0, entry.notes || "", entry.id, now, now);
    }
  });
  touchedSessionIds.forEach((id) => db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(nowISO(), id));
  return [...touchedSessionIds];
}

router.post("/import/preview", (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "entries array is required." });
  res.json(classifyEntries(entries, req.user.id));
});

router.post("/import", (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "entries array is required." });
  db.exec("BEGIN");
  let touchedSessionIds;
  try {
    touchedSessionIds = applyImport(entries, req.user.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const sessions = touchedSessionIds.map((id) => {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return sessionWithBlocks(row, blocksStmt.all(id));
  });
  res.json({ sessions });
});

module.exports = router;
