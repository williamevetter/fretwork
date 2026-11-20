require("dotenv").config();

if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET in .env — refusing to start with an insecure default. See .env.example.");
  process.exit(1);
}

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const authRouter = require("./src/auth");
const techniquesRouter = require("./src/routes/techniques");
const sprintsRouter = require("./src/routes/sprints");
const sessionsRouter = require("./src/routes/sessions");
const plansRouter = require("./src/routes/plans");
const topicsRouter = require("./src/routes/topics");
const gearRouter = require("./src/routes/gear");
const theoryRouter = require("./src/routes/theory");
const coursesRouter = require("./src/routes/courses");
const notesRouter = require("./src/routes/notes");
const tuningsRouter = require("./src/routes/tunings");
const recordingsRouter = require("./src/routes/recordings");
const adminRouter = require("./src/routes/admin");
const noticesRouter = require("./src/routes/notices");
const contactsRouter = require("./src/routes/contacts");
const tagsRouter = require("./src/routes/tags");
const changelogRouter = require("./src/routes/changelog");
const enrollmentsRouter = require("./src/routes/enrollments");
const forumsRouter = require("./src/routes/forums");
const messagesRouter = require("./src/routes/messages");
require("./src/reminders"); // schedules cron jobs as a side effect

const app = express();
app.set("trust proxy", 1); // behind nginx — needed so req.secure reflects X-Forwarded-Proto
app.use(express.json({ limit: "50mb" })); // lessons can include base64 PDFs/images; recordings arrive as base64 too
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/techniques", techniquesRouter);
app.use("/api/sprints", sprintsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/topics", topicsRouter);
app.use("/api/gear", gearRouter);
app.use("/api/theory", theoryRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/notes", notesRouter);
app.use("/api/tunings", tuningsRouter);
app.use("/api/recordings", recordingsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/notices", noticesRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/changelog", changelogRouter);
app.use("/api/enrollments", enrollmentsRouter);
app.use("/api/forums", forumsRouter);
app.use("/api/messages", messagesRouter);

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Fretwork server listening on :${PORT}`);
});
