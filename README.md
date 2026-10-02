# Reformat Your Brain in 28 Days

A 28-day mindset program web app. Members sign up, unlock one lesson per day,
and complete Take Action Now assignments. Trainers get full visibility into
member answers, a lesson editor, cohorts, and a live session view.

## Run locally

```bash
npm install
npm run seed     # load the 28 lessons (only needed once)
npm start        # http://localhost:3000
```

## Environment variables

| Variable         | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `PORT`           | Port to listen on (default 3000)                               |
| `DB_PATH`        | SQLite file location (default `./data/app.db`)                 |
| `COACH_CODE`     | Secret code trainers enter at signup to get the trainer role   |
| `SESSION_SECRET` | Secret for login sessions (set a long random string)           |
| `COOKIE_SECURE`  | Set to `1` in production (HTTPS)                               |

## Deploy

See `DEPLOY.md` for Render deployment instructions (Docker + persistent disk).
