const express = require("express");
const { db } = require("../db");
const { uid } = require("../ids");
const requireAuth = require("../middleware");

const router = express.Router();
router.use(requireAuth);

function rowToTuning(row) {
  return { id: row.id, name: row.name, strings: JSON.parse(row.strings_json) };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM custom_tunings WHERE user_id = ?").all(req.user.id);
  res.json(rows.map(rowToTuning));
});

router.post("/", (req, res) => {
  const name = (req.body?.name || "").trim();
  const strings = req.body?.strings;
  if (!name || !Array.isArray(strings)) return res.status(400).json({ error: "name and strings are required." });
  const row = { id: req.body?.id || uid(), name, strings_json: JSON.stringify(strings) };
  db.prepare("INSERT INTO custom_tunings (id, user_id, name, strings_json) VALUES (?, ?, ?, ?)")
    .run(row.id, req.user.id, row.name, row.strings_json);
  res.json(rowToTuning(row));
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM custom_tunings WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM custom_tunings WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
