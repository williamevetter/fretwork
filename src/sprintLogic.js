// Mirrors the frontend's CATEGORIES/CATEGORY_RANK/addDays exactly — kept in sync by hand,
// since both sides need the same ranking/date-math semantics.
const CATEGORIES = ["Warm-up", "A1A", "Fretboard Biology", "Tertiary & cheatsheets", "Repeat miscellaneous", "Cooldown"];
const CATEGORY_RANK = { "A1A": 0, "Fretboard Biology": 1, "Tertiary & cheatsheets": 2, "Repeat miscellaneous": 3 };

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { CATEGORIES, CATEGORY_RANK, addDays };
