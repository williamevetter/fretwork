const express = require("express");
const fs = require("fs");
const path = require("path");
const { db } = require("../db");
const requireAuth = require("../middleware");

const RECORDINGS_DIR = path.join(__dirname, "..", "..", "data", "recordings");
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const router = express.Router();
router.use(requireAuth);

function findRecordingForUser(id, userId) {
  return db.prepare("SELECT * FROM audio_recordings WHERE id = ? AND user_id = ?").get(id, userId);
}

router.get("/:id/file", (req, res) => {
  const row = findRecordingForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const filePath = path.join(RECORDINGS_DIR, row.file_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing." });
  res.sendFile(filePath, { headers: { "Content-Type": row.mime_type } });
});

router.delete("/:id", (req, res) => {
  const row = findRecordingForUser(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const filePath = path.join(RECORDINGS_DIR, row.file_name);
  db.prepare("DELETE FROM audio_recordings WHERE id = ?").run(row.id);
  fs.promises.unlink(filePath).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
