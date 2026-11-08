# Fretwork server

Multi-user version of the Fretwork practice tracker: accounts, per-user
data, and optional email notifications.

## Deploy

```bash
# On the server, in this directory:
npm install
cp .env.example .env
nano .env   # set JWT_SECRET and APP_URL at minimum
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it directly to test:
```bash
node server.js
```

It listens on the port set in `.env` (default 3300). Put nginx in front of
it as a reverse proxy (see deploy notes) rather than exposing this port
directly to the internet.

## Email

Leave the SMTP_* variables in `.env` blank to run without email — new
accounts auto-verify immediately, and reminder/summary emails just get
logged to the console instead of sent. Fill in SMTP_HOST/PORT/USER/PASS
and restart whenever you're ready for real email — verification and
delivery switch on automatically.

## Data

All data is stored as JSON files under `data/` — `data/users.json` for
accounts, and `data/kv/<user-id>.json` per user for their app data
(sessions, techniques, course material, notes, etc). Back up the `data/`
folder to back up everything.
