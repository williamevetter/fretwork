const fs = require("fs");
const path = require("path");
const express = require("express");

const router = express.Router();
// Single source of truth — the same file GitHub renders as repo documentation.
// No separate "current version" constant to keep in sync: it's just the last
// "## v..." heading in this file.
const CHANGELOG_PATH = path.join(__dirname, "..", "..", "CHANGELOG.md");

function parseChangelog() {
  const raw = fs.readFileSync(CHANGELOG_PATH, "utf8");
  const sections = raw.split(/\n## /).slice(1); // drop the intro text before the first entry
  const entries = sections.map((section) => {
    const lines = section.split("\n");
    const heading = lines[0].trim(); // e.g. "v11.1 — Fix document viewer resize on PDF/YouTube"
    const dashIndex = heading.indexOf("—");
    const version = (dashIndex === -1 ? heading : heading.slice(0, dashIndex)).trim();
    const title = (dashIndex === -1 ? "" : heading.slice(dashIndex + 1)).trim();
    const rest = lines.slice(1).join("\n").trim();
    const tagMatch = rest.match(/^\*(\w+)\*/);
    const tag = tagMatch ? tagMatch[1] : "";
    const body = rest.replace(/^\*(\w+)\*/, "").trim();
    return { version, title, tag, body };
  });
  entries.reverse(); // newest first
  return { currentVersion: entries[0] ? entries[0].version : null, entries };
}

router.get("/", (req, res) => {
  try {
    res.json(parseChangelog());
  } catch (e) {
    res.status(500).json({ error: "Couldn't read the changelog." });
  }
});

module.exports = router;
