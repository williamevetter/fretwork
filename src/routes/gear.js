const express = require("express");
const { db } = require("../db");
const { uid, nowISO } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToGear(row, maintenance) {
  return {
    id: row.id, name: row.name, type: row.type, status: row.status,
    maintenance: (maintenance || []).map((m) => ({ date: m.date, note: m.note })),
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM gear WHERE user_id = ?").all(req.user.id);
  const maintStmt = db.prepare("SELECT * FROM gear_maintenance WHERE gear_id = ? ORDER BY id DESC");
  res.json(rows.map((row) => rowToGear(row, maintStmt.all(row.id))));
});

router.post("/", (req, res) => {
  const name = (req.body?.name || "").trim();
  const type = req.body?.type || "Electric";
  const status = req.body?.status || "Good";
  if (!name) return res.status(400).json({ error: "name is required." });
  const row = { id: uid(), name, type, status };
  db.prepare("INSERT INTO gear (id, user_id, name, type, status) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, req.user.id, row.name, row.type, row.status);
  res.json(rowToGear(row, []));
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM gear WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const status = req.body?.status || row.status;
  db.prepare("UPDATE gear SET status = ? WHERE id = ?").run(status, row.id);
  const maintenance = db.prepare("SELECT * FROM gear_maintenance WHERE gear_id = ? ORDER BY id DESC").all(row.id);
  res.json(rowToGear({ ...row, status }, maintenance));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM gear WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM gear_maintenance WHERE gear_id = ?").run(row.id);
    db.prepare("DELETE FROM gear WHERE id = ?").run(row.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true });
});

router.post("/:id/maintenance", (req, res) => {
  const row = db.prepare("SELECT * FROM gear WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  const note = (req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "note is required." });
  const date = req.body?.date || nowISO().slice(0, 10);
  db.prepare("INSERT INTO gear_maintenance (gear_id, date, note) VALUES (?, ?, ?)").run(row.id, date, note);
  const maintenance = db.prepare("SELECT * FROM gear_maintenance WHERE gear_id = ? ORDER BY id DESC").all(row.id);
  res.json(rowToGear(row, maintenance));
});

module.exports = router;
