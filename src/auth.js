const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { db } = require("./db");
const { uid, nowISO } = require("./ids");
const { sendEmail, SMTP_CONFIGURED } = require("./mailer");
const requireAuth = require("./middleware");

const router = express.Router();

const APP_URL = process.env.APP_URL || "http://localhost:3300";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const DEFAULT_TECHNIQUES = [
  "Alternate Picking", "Sweep Picking", "Legato", "Economy Picking", "Tapping",
  "Fingerstyle", "Hybrid Picking", "String Skipping", "Bending & Vibrato", "Palm Muting",
];

function issueToken(req, res, user) {
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.cookie("fw_token", token, { ...COOKIE_OPTS, secure: req.secure });
}
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    notifyPrefs: {
      practiceReminders: !!row.notify_practice_reminders,
      weeklySummary: !!row.notify_weekly_summary,
      gearReminders: !!row.notify_gear_reminders,
    },
    gearReminderDays: row.gear_reminder_days,
  };
}

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email || "")) return res.status(400).json({ error: "Enter a valid email address." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const existing = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (existing) return res.status(400).json({ error: "An account with that email already exists." });

  const passwordHash = await bcrypt.hash(password, 10);
  const needsVerification = SMTP_CONFIGURED;
  const user = {
    id: uid(),
    email,
    passwordHash,
    verified: !needsVerification,
    verifyToken: needsVerification ? uid() : null,
    createdAt: nowISO(),
  };

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, verified, verify_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.id, user.email, user.passwordHash, user.verified ? 1 : 0, user.verifyToken, user.createdAt);

    const insertTechnique = db.prepare("INSERT INTO techniques (id, user_id, name) VALUES (?, ?, ?)");
    DEFAULT_TECHNIQUES.forEach((name, i) => insertTechnique.run(`t${i}-${user.id}`, user.id, name));

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  if (needsVerification) {
    const link = `${APP_URL}/api/auth/verify?token=${user.verifyToken}`;
    await sendEmail({
      to: email,
      subject: "Verify your Fretwork account",
      text: `Welcome to Fretwork! Verify your account: ${link}`,
      html: `<p>Welcome to Fretwork.</p><p><a href="${link}">Verify your account</a></p>`,
    });
    return res.json({ ok: true, verified: false });
  }

  issueToken(req, res, user);
  res.json({ ok: true, verified: true });
});

router.get("/verify", (req, res) => {
  const { token } = req.query;
  const user = db.prepare("SELECT * FROM users WHERE verify_token = ?").get(token);
  if (!user) return res.status(400).send("Invalid or expired verification link.");
  db.prepare("UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?").run(user.id);
  res.redirect("/?verified=1");
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email || "");
  if (!user) return res.status(401).json({ error: "Incorrect email or password." });
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect email or password." });
  if (!user.verified) return res.status(403).json({ error: "Please verify your email before logging in." });
  issueToken(req, res, { id: user.id, email: user.email });
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  res.clearCookie("fw_token", { ...COOKIE_OPTS, secure: req.secure });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "Not found." });
  const { notifyPrefs, gearReminderDays } = rowToUser(user);
  res.json({ email: user.email, notifyPrefs, gearReminderDays });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email || "");
  if (user) {
    const resetToken = uid();
    const resetTokenExpires = Date.now() + 60 * 60 * 1000;
    db.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?").run(resetToken, resetTokenExpires, user.id);
    const link = `${APP_URL}/reset-password?token=${resetToken}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your Fretwork password",
      text: `Reset your password (expires in 1 hour): ${link}`,
      html: `<p><a href="${link}">Reset your password</a> (expires in 1 hour)</p>`,
    });
  }
  // Always respond ok whether or not the email exists, to avoid leaking which emails are registered.
  res.json({ ok: true });
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const user = db.prepare("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?").get(token, Date.now());
  if (!user) return res.status(400).json({ error: "Invalid or expired reset link." });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?").run(passwordHash, user.id);
  res.json({ ok: true });
});

router.put("/account/prefs", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found." });
  const prefs = req.body.notifyPrefs || {};
  const practiceReminders = prefs.practiceReminders !== undefined ? !!prefs.practiceReminders : !!user.notify_practice_reminders;
  const weeklySummary = prefs.weeklySummary !== undefined ? !!prefs.weeklySummary : !!user.notify_weekly_summary;
  const gearReminders = prefs.gearReminders !== undefined ? !!prefs.gearReminders : !!user.notify_gear_reminders;
  const gearReminderDays = req.body.gearReminderDays ? Number(req.body.gearReminderDays) : user.gear_reminder_days;
  db.prepare(`
    UPDATE users SET notify_practice_reminders = ?, notify_weekly_summary = ?, notify_gear_reminders = ?, gear_reminder_days = ?
    WHERE id = ?
  `).run(practiceReminders ? 1 : 0, weeklySummary ? 1 : 0, gearReminders ? 1 : 0, gearReminderDays, req.user.id);
  res.json({ ok: true });
});

router.put("/account/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found." });
  const ok = await bcrypt.compare(currentPassword || "", user.password_hash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
