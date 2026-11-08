const { db } = require("./db");
const { uid, nowISO } = require("./ids");

function insertAssignment(userId, techniqueId, scopeType, scopeId, inheritedFrom) {
  const exists = db.prepare("SELECT id FROM technique_assignments WHERE technique_id = ? AND scope_type = ? AND scope_id = ?")
    .get(techniqueId, scopeType, scopeId);
  if (exists) return; // already tagged here (directly or inherited) — nothing to add
  db.prepare(`
    INSERT INTO technique_assignments (id, user_id, technique_id, scope_type, scope_id, inherited_from, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid(), userId, techniqueId, scopeType, scopeId, inheritedFrom || null, nowISO());
}

// Direct assignment at a given scope, cascading down to every CURRENT descendant —
// course -> its sprints -> their sessions, or sprint -> its sessions. Session/lesson
// are leaves (no further cascade).
function assignTechnique(userId, techniqueId, scopeType, scopeId) {
  insertAssignment(userId, techniqueId, scopeType, scopeId, null);
  if (scopeType === "course") {
    const sprintIds = db.prepare("SELECT id FROM sprints WHERE course_id = ?").all(scopeId).map((r) => r.id);
    sprintIds.forEach((sid) => insertAssignment(userId, techniqueId, "sprint", sid, `course:${scopeId}`));
    if (sprintIds.length) {
      const placeholders = sprintIds.map(() => "?").join(",");
      const sessionIds = db.prepare(`SELECT id FROM sessions WHERE sprint_id IN (${placeholders})`).all(...sprintIds).map((r) => r.id);
      sessionIds.forEach((sid) => insertAssignment(userId, techniqueId, "session", sid, `course:${scopeId}`));
    }
  } else if (scopeType === "sprint") {
    const sessionIds = db.prepare("SELECT id FROM sessions WHERE sprint_id = ?").all(scopeId).map((r) => r.id);
    sessionIds.forEach((sid) => insertAssignment(userId, techniqueId, "session", sid, `sprint:${scopeId}`));
  }
}

// Removes a direct tag at this scope, and every row that was cascaded down FROM it —
// never touches a tag some descendant added on its own (inherited_from IS NULL there).
function unassignTechnique(techniqueId, scopeType, scopeId) {
  db.prepare("DELETE FROM technique_assignments WHERE technique_id = ? AND scope_type = ? AND scope_id = ? AND inherited_from IS NULL")
    .run(techniqueId, scopeType, scopeId);
  db.prepare("DELETE FROM technique_assignments WHERE technique_id = ? AND inherited_from = ?")
    .run(techniqueId, `${scopeType}:${scopeId}`);
}

// Called right after a new sprint is created under `courseId` — copies the course's
// current tags down onto it (mirrors what assignTechnique would already do for a
// PRE-existing sprint; this covers the sprint-didn't-exist-yet case).
function inheritForNewSprint(userId, sprintId, courseId) {
  if (!courseId) return;
  const rows = db.prepare("SELECT technique_id FROM technique_assignments WHERE scope_type = 'course' AND scope_id = ?").all(courseId);
  rows.forEach((r) => insertAssignment(userId, r.technique_id, "sprint", sprintId, `course:${courseId}`));
}

// Called when a session is newly created under `sprintId`, or when an existing
// session's sprintId changes — resyncs its inherited tags to match whatever the
// (new) sprint currently carries. Tags the session picked up directly (inherited_from
// IS NULL) are left untouched. Pass a falsy sprintId to just clear inherited tags.
function syncSessionInheritance(userId, sessionId, sprintId) {
  db.prepare("DELETE FROM technique_assignments WHERE scope_type = 'session' AND scope_id = ? AND inherited_from IS NOT NULL").run(sessionId);
  if (!sprintId) return;
  const rows = db.prepare("SELECT technique_id, inherited_from FROM technique_assignments WHERE scope_type = 'sprint' AND scope_id = ?").all(sprintId);
  // Preserve the ROOT source (course:X), not just the immediate parent — otherwise
  // removing a course-level tag wouldn't cascade-clean a session that inherited it
  // via an intermediate sprint rather than a direct course->session cascade.
  rows.forEach((r) => insertAssignment(userId, r.technique_id, "session", sessionId, r.inherited_from || `sprint:${sprintId}`));
}

module.exports = { assignTechnique, unassignTechnique, inheritForNewSprint, syncSessionInheritance };
