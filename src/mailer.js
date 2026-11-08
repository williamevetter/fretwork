const nodemailer = require("nodemailer");

const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — logging instead of sending.\n  To: ${to}\n  Subject: ${subject}\n  ${text}\n`);
    return { delivered: false, logged: true };
  }
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"Fretwork" <no-reply@${process.env.MAIL_DOMAIN || "localhost"}>`,
      to,
      subject,
      text,
      html: html || undefined,
    });
    return { delivered: true };
  } catch (e) {
    console.error("[mailer] send failed:", e.message);
    return { delivered: false, error: e.message };
  }
}

module.exports = { sendEmail, SMTP_CONFIGURED };
