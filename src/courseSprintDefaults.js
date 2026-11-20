const { db } = require("./db");
const { uid, nowISO } = require("./ids");
const { addDays, sprintLengthDays } = require("./sprintLogic");

// Every user has exactly one "General" course, created lazily on first need
// (not at registration -- every read path already goes through this, so eager
// creation would just write an extra row for accounts that never log a session).
function ensureGeneralCourse(userId) {
  const existing = db.prepare("SELECT * FROM courses WHERE user_id = ? AND name = 'General'").get(userId);
  if (existing) return existing;
  const row = { id: uid(), name: "General", description: "", sprint_length_value: 2, sprint_length_unit: "week" };
  db.prepare("INSERT INTO courses (id, user_id, name, description, sprint_length_value, sprint_length_unit) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, userId, row.name, row.description, row.sprint_length_value, row.sprint_length_unit);
  return { ...row, user_id: userId };
}

function ensureActiveSprintForCourse(userId, courseId) {
  const active = db.prepare("SELECT * FROM sprints WHERE user_id = ? AND course_id = ? AND status = 'active'").get(userId, courseId);
  if (active) return active;
  const course = db.prepare("SELECT sprint_length_value, sprint_length_unit FROM courses WHERE id = ?").get(courseId);
  const startDate = nowISO().slice(0, 10);
  const endDate = addDays(startDate, sprintLengthDays(course.sprint_length_value, course.sprint_length_unit) - 1);
  const row = { id: uid(), start_date: startDate, end_date: endDate, status: "active", course_id: courseId, carried_from_sprint_id: null };
  db.prepare("INSERT INTO sprints (id, user_id, start_date, end_date, status, course_id, carried_from_sprint_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, userId, row.start_date, row.end_date, row.status, row.course_id, row.carried_from_sprint_id);
  return { ...row, user_id: userId };
}

// The one entry point to call when a session is logged with no sprintId: "give
// me *a* sprint id for this user" -- always General's active sprint.
function ensureDefaultSprintId(userId) {
  return ensureActiveSprintForCourse(userId, ensureGeneralCourse(userId).id).id;
}

module.exports = { ensureGeneralCourse, ensureActiveSprintForCourse, ensureDefaultSprintId };
