# Fretwork — Release Notes

Versioning scheme used below: **major.significant.minor**
- **Major** (whole number bump, e.g. 3 → 4): a new subsystem or a foundational architecture change.
- **Significant** (`.1`, e.g. 4 → 4.1): a real capability added to something that already exists.
- **Minor** (`.x.1`, e.g. 4.1 → 4.1.1): a small addition or a bug fix.

---

## v1 — SQL backend migration
*Major*

Rebuilt the storage layer from a single whole-JSON-blob-per-user file to a proper SQLite database with per-resource tables and row-level writes. This was a direct fix for a cross-device data-loss bug: the old architecture overwrote a user's entire data blob on every save, so two devices saving around the same time would silently clobber each other. Verified with a live two-device simulation against production.

## v1.1 — Time-range analytics & Sprint vs Session KPI
*Significant*

Added a date-range picker to the Dashboard (This Sprint / Previous Sprint / Last Month / custom range, etc.) and a Sprint vs Session time-split chart showing how practice time divides between sprint-linked and ad-hoc work.

## v2 — Start Session page & Sessions Search
*Major*

New live session workflow: start a session, start/stop timers on individual blocks in real time, with crash-safety proven by killing and reloading mid-timer and confirming the elapsed time survives. Added a separate Sessions Search tab for browsing logged sessions by date range.

## v3 — Tools panel: Tuner, Metronome, Recording
*Major*

New persistent Tools panel (survives tab navigation) with a quick chromatic tuner, a scheduling-grade metronome (Web Audio lookahead scheduling for drift-free timing, with Plain and Dynamic Duration modes), and audio recording attached to sessions.

## v3.0.1 — Custom-block timer fix
*Minor*

The live Start/Stop timer only worked on techniques, sprint queue items, and the three freeform activity types. Added a "▶ Start" option for any typed-in custom material, reusing the existing timer logic.

## v4 — Admin dashboard
*Major*

New owner-only admin dashboard: per-user storage usage, impersonate a user to see what they see (full functional access, time-boxed to 1 hour), send a one-time notice banner for their next login, see last-login times, and reset passwords. Every admin action is written to an audit log.

## v4.0.1 — Second admin account
*Minor*

Granted admin access to a second account after discovering the first admin button only appears for the account it was originally scoped to by email.

## v4.1 — Delete, edit, and force-password-change for admin
*Significant*

Added three admin capabilities: permanently delete a user (and every row that depends on them, including recording files on disk), edit a user's email, and force a password change on next login (a mandatory "set a new password" screen, no need to know their current one).

## v4.2 — Email sending enabled
*Significant*

Configured real SMTP delivery through Gmail. Previously every verification/reset/notification email was just logged to the console instead of sent. This also switches new registrations from auto-verified to requiring an email click, now that verification mail can actually be delivered.

## v5 — Topics & Questions + email contacts
*Major*

Renamed the Topics tab to Topics & Questions and added the ability to select items and email them — to yourself or to a saved contact — with a dedicated "manage email contacts" screen.

## v5.0.1 — Personalized subject line and note field
*Minor*

Emailed topics now use the subject "A new Guitar Question from {name} ({email})" instead of a generic subject, and a free-text note can be appended to the email. Added an optional display name to the account settings to support this.

## v6 — Session recording overhaul
*Major*

Ad-hoc session flag (hides the Planned vs Actual comparison when there's no plan to compare against), a table-friendly notes editor, per-block and whole-session audio recording with an auto-generated Date-Time-Sprint-Topic-note name, a new dedicated Recordings tab searchable by date/name/sprint, and download links everywhere a recording appears.

## v6.0.1 — Tuner twitchiness fix
*Minor*

Slowed the pitch-detection poll rate and added a median-of-3 filter so a single noisy reading no longer yanks the tuner needle.

## v6.0.2 — Utilities menu fix
*Minor*

The Utilities dropdown closed before the mouse reached it, because it was positioned outside its parent's hoverable layout box. Added a short cancelable close-delay.

## v6.1 — Planned/Actual time fields, sprint-link checkbox, editable dates
*Significant*

Added session-level Planned Time and Actual Time fields (entered as Hours + Minutes) independent of per-block tracking, a checkbox/picker to link a session to the current sprint, and made the session date directly editable instead of fixed at creation.

## v7 — Courses/Sprints/Sessions unification, phase 1
*Major*

Each course now runs its own configurable sprint cadence (days/weeks/months/years), and multiple sprints can be active concurrently — one per course, each on its own clock — replacing the old single-global-sprint model. Closed a related gap where more than one sprint could silently end up "active" at once.

## v8 — Technique tagging & multi-course lessons, phases 2+3
*Major*

Techniques can now be tagged on a Course, Sprint, Session, or Lesson, with tagging a Course/Sprint cascading the tag down to everything underneath it. Lessons can now belong to more than one course, and a new course can be spun up directly from an existing lesson. Also fixed a bug introduced in v7 where deleting a course with sprint history would fail outright.

## v8.0.1 — YouTube links in Course Material
*Minor*

Lessons can now be a pasted YouTube link instead of an uploaded file, with a choice to play it embedded or open it directly on YouTube.

## v8.0.2 — Edit planned sessions without starting them
*Minor*

Added an Edit button on planned sessions that loads the plan into the existing form without starting it, with a "Save changes" button that only appears once something's actually been changed.

## v8.1 — Planned blocks on a plan
*Significant*

Planned sessions can now include structured work-item blocks (category, material, planned time), which carry over as real session blocks when "Start session now" turns the plan into a live session.

## v9 — Role-based test accounts
*Major*

New account roles (admin / test_admin / test_instructor / test_user / user) with a scoping rule enforced on every admin action: a test_admin can only manage test_instructor/test_user accounts — never real admins, other test_admins, or real production users. Provisioned 9 test accounts (3 of each test role) to exercise this.

## v10 — User acceptance statement
*Major*

Every account must now accept a terms/warnings statement before using the app — a full-screen gate shown right after login (same pattern as the existing forced-password-change screen). Admins (real admins only, not test_admins) can edit the statement text from the Admin dashboard; saving a change bumps its version, which forces every user — including people who already accepted — to accept it again on their next login.

## v11 — Calendar, course lifecycle, resizable document viewer, deferred session logging
*Major*

New Calendar tab (month grid + day drill-down) overlaying sessions, sprint date ranges, recordings, per-course "focus day" markers, and US federal holidays. Courses can now be marked completed with a short checkup questionnaire, reopened, or continued into a linked "Part 2" course that copies sprint cadence and focus days — also fixed a pre-existing bug where editing a course's sprint length 500'd on every call. The document viewer can now be resized vertically. Sessions no longer get logged the instant "Start blank" is clicked — a session is only actually created once a timer starts, a block is saved, a recording finishes, or the new "Save session" button is used.

## v11.1 — Fix document viewer resize on PDF/YouTube
*Minor*

The resizable wrapper added in v11 gave PDF/YouTube content zero padding, so the embedded `<iframe>` covered the native resize grip's hit area at the bottom-right corner — an iframe is its own browsing context, so the drag never started. Reserved a bare strip of real padding along the bottom so that corner stays on the outer div.

## v11.2 — Version number + in-app changelog
*Significant*

Added a small version badge to the header (read straight from this file, so there's no separate version constant to keep in sync) that opens a Changelog modal mirroring these release notes exactly — same file, parsed into entries, newest first. The modal also links out to reporting a bug or idea, by email or by opening a new GitHub issue.

## v12 — Instructor accounts, Forums, Message Board
*Major*

A real admin can promote a user to an instructor, who can then invite students (pending → accept/decline), view their roster, reset a student's password, and unenroll them — each instructor also gets their own exclusive forum category, auto-created on promotion. Forums got three global categories (FAQs, Help Needed technical/musical) open to everyone, with threads and replies. A new Message Board gives every account a personal inbox — contacts are always resolved through an actual relationship (your enrolled instructor, an instructor's own students, or an admin's existing visibility), never an open user directory. CAPTCHA/anti-spam on these forms is deferred pending provider access (tracked separately); so is "assign curriculum to a student" and SMS mass messaging.

## v13 — Responsive interface, color schemes, Course Material & Techniques merge
*Major*

Real CSS breakpoints now adapt the nav/header/main layout to phone/tablet/computer screen widths, with a per-account "Interface" setting that can force a specific one regardless of actual screen size. Added a light color theme alongside the existing dark default, switchable per-account — every color became a CSS variable lookup so switching is instant with no reload. Course Material and Techniques are now one nav entry with a sub-tab switcher between them (navigation only; the two stayed fully separate underneath). Also: "make courses optionally indefinite" turned out to already be true since v11's course-lifecycle work — nothing needed building there.

## v14 — Course details: description edit, URL, notes, dates, time goals
*Significant*

The course detail view gained a Details card (editable description, a URL field, free-text notes, start/end dates with an "Indefinite" checkbox) and a Goals card: a time-spent target in minutes, windowed by a configurable period — custom (all-time total), sprint (the current active sprint), session (most recent session), or daily/weekly/monthly (a rolling window) — shown as a progress bar, plus a goal type and free-text description. Found and fixed a real bug while testing: the "most recent session" date sort broke on same-day ties.

## v15 — Dashboard sprint/session telemetry, breakdown pies, top exercises
*Significant*

Each Active Sprint card on the Dashboard now shows that sprint's own Total practiced / Avg per session / Sessions logged. Added three pie charts sharing the dashboard's date-range filter — Sprint breakdown, Course breakdown, Technique breakdown — plus a Top 5 Logged Exercises list ranked by time spent. Pure frontend change, no schema/backend involved.

## v15.1 — Fix broken selected-state backgrounds
*Minor*

v13's CSS-variable conversion missed a second form of the old hex-alpha-suffix trick (`C.brass + "22"`, not just the `${C.brass}66` template-literal form that got fixed at the time), silently breaking the selected/active background on every chip picker, tab, and toggle using it — 14 spots across technique tags, plan-form pickers, quiz answers, and more. Fixed the same way as before: `color-mix()` via the existing `alpha()` helper.

## v16 — Multi-technique/material blocks, technique & lesson rename, per-course breakdown
*Major*

A session block can now cover several techniques and/or course materials at once, sharing one timer — a "Use session timer for all techniques/materials" checkbox toggles the picker between single-select and multi-select chips, in both the live session block form and the Plan form's block editor. The full elapsed minutes credit every linked technique (not split). Added rename for techniques (previously add/remove only) and uploaded course materials (previously upload/delete only), plus a per-course Technique Breakdown pie. Scoped from issue #15's broader hierarchy discussion — most of the Course → Sprint → Session hierarchy it asked about already existed; this is the genuinely new pieces confirmed in discussion.

## v16.0.1 — Fix technique-delete FK violation
*Minor*

Deleting a technique that had been tagged on a block before v16's multi-technique migration (and never re-saved through the new system) failed outright — the legacy single-technique column on that block, left in place unused, still enforced its own foreign key. Cleared it on delete, alongside the two join-table deletes already handled.

## v17 — "General" becomes a real course; every session always has a sprint
*Major*

First phase of issue #17 (Course → Sprint → Session as a real, navigable hierarchy). Every user now has their own real "General" course (previously a `course_id IS NULL` convention, invisible as a course in its own right) and every session always ends up linked to a sprint — unspecified sprints default to General's active one, created automatically if needed. A session's sprint link can now be changed to any sprint you own, past or active, for backfilling a missed or misfiled entry, and a past sprint's own start/end dates are now directly editable (its queue items already were).
