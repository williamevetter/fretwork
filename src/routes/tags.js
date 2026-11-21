const express = require("express");
const { db } = require("../db");
const requireAuth = require("../middleware");
const { assignTechnique, unassignTechnique } = require("../techniqueAssignments");

const router = express.Router();
router.use(requireAuth);

const SCOPE_TABLES = { course: "courses", sprint: "sprints", session: "sessions" };

function ownsScope(scopeType, scopeId, userId) {
  if (scopeType === "lesson") {
    // Direct ownership (issue #17) -- a lesson can be standalone, with no
    // course to derive ownership through.
    return !!db.prepare("SELECT 1 FROM lessons WHERE id = ? AND user_id = ?").get(scopeId, userId);
  }
  const table = SCOPE_TABLES[scopeType];
  if (!table) return false;
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(scopeId, userId);
}

router.get("/:scopeType/:scopeId", (req, res) => {
  const { scopeType, scopeId } = req.params;
  if (!ownsScope(scopeType, scopeId, req.user.id)) return res.status(404).json({ error: "Not found." });
  const rows = db.prepare(`
    SELECT ta.*, t.name AS technique_name FROM technique_assignments ta
    JOIN techniques t ON t.id = ta.technique_id
    WHERE ta.scope_type = ? AND ta.scope_id = ?
  `).all(scopeType, scopeId);
  res.json(rows.map((r) => ({ techniqueId: r.technique_id, techniqueName: r.technique_name, inheritedFrom: r.inherited_from })));
});

router.post("/:scopeType/:scopeId", (req, res) => {
  const { scopeType, scopeId } = req.params;
  const techniqueId = req.body?.techniqueId;
  if (!ownsScope(scopeType, scopeId, req.user.id)) return res.status(404).json({ error: "Not found." });
  const technique = db.prepare("SELECT id FROM techniques WHERE id = ? AND user_id = ?").get(techniqueId, req.user.id);
  if (!technique) return res.status(404).json({ error: "Technique not found." });
  assignTechnique(req.user.id, techniqueId, scopeType, scopeId);
  res.json({ ok: true });
});

router.delete("/:scopeType/:scopeId/:techniqueId", (req, res) => {
  const { scopeType, scopeId, techniqueId } = req.params;
  if (!ownsScope(scopeType, scopeId, req.user.id)) return res.status(404).json({ error: "Not found." });
  unassignTechnique(techniqueId, scopeType, scopeId);
  res.json({ ok: true });
});

module.exports = router;
