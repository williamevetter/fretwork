const cron = require("node-cron");
const { db } = require("./db");
const { sendEmail, SMTP_CONFIGURED } = require("./mailer");
const { techniqueTimesForBlocks, techniqueIdsForBlocks } = require("./routes/sessions");

function fmtMin(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

async function checkPracticeAndGearReminders() {
  if (!SMTP_CONFIGURED) return;
  const users = db.prepare("SELECT * FROM users WHERE verified = 1").all();
  const now = Date.now();

  for (const user of users) {
    if (user.notify_practice_reminders) {
      const lastSession = db.prepare("SELECT MAX(date) AS lastDate FROM sessions WHERE user_id = ?").get(user.id);
      const lastDate = lastSession?.lastDate || null;
      const daysSince = lastDate ? Math.floor((now - new Date(lastDate).getTime()) / 86400000) : Infinity;
      if (daysSince >= 3) {
        await sendEmail({
          to: user.email,
          subject: "Haven't practiced in a few days?",
          text: `It's been ${daysSince === Infinity ? "a while" : daysSince + " days"} since your last logged practice session. A short session today keeps things moving.`,
        });
      }
    }

    if (user.notify_gear_reminders) {
      const gearItems = db.prepare("SELECT * FROM gear WHERE user_id = ?").all(user.id);
      const dueItems = gearItems.filter((g) => {
        const last = db.prepare("SELECT MAX(date) AS lastDate FROM gear_maintenance WHERE gear_id = ?").get(g.id)?.lastDate;
        const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : Infinity;
        return days >= (user.gear_reminder_days || 90);
      });
      if (dueItems.length) {
        await sendEmail({
          to: user.email,
          subject: "Gear maintenance is due",
          text: `These could use attention: ${dueItems.map((g) => g.name).join(", ")}.`,
        });
      }
    }
  }
}

async function sendWeeklySummaries() {
  if (!SMTP_CONFIGURED) return;
  const users = db.prepare("SELECT * FROM users WHERE verified = 1").all();
  const weekAgoISO = new Date(Date.now() - 7 * 86400000).toISOString();

  for (const user of users) {
    if (!user.notify_weekly_summary) continue;
    const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND date >= ?").all(user.id, weekAgoISO.slice(0, 10));
    if (sessions.length === 0) continue; // don't nag with an empty summary

    const blocks = db.prepare(`
      SELECT session_blocks.* FROM session_blocks JOIN sessions ON sessions.id = session_blocks.session_id
      WHERE sessions.user_id = ? AND sessions.date >= ?
    `).all(user.id, weekAgoISO.slice(0, 10));

    const totalMin = blocks.reduce((sum, b) => sum + (Number(b.actual_minutes) || 0), 0);
    const techMap = techniqueIdsForBlocks(blocks.map((b) => b.id));
    const techTotals = techniqueTimesForBlocks(blocks, techMap);

    const topTech = Object.entries(techTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, min]) => {
        const t = db.prepare("SELECT name FROM techniques WHERE id = ?").get(id);
        return `${t?.name || id} (${fmtMin(min)})`;
      })
      .join(", ");

    await sendEmail({
      to: user.email,
      subject: "Your week in practice",
      text: `You practiced ${fmtMin(totalMin)} across ${sessions.length} session(s) this week.${topTech ? " Top techniques: " + topTech + "." : ""}`,
    });
  }
}

// Daily at 8am server time
cron.schedule("0 8 * * *", checkPracticeAndGearReminders);
// Weekly, Sunday at 6pm server time
cron.schedule("0 18 * * 0", sendWeeklySummaries);

module.exports = { checkPracticeAndGearReminders, sendWeeklySummaries };
