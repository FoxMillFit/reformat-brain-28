# Deploying "Reformat Your Brain in 28 Days"

The app is a standard Node.js web app (Express + SQLite). It needs a host with a
persistent disk for the SQLite file. Easiest path: **Render**.

## What you need
- A Render account (render.com) — free to start
- This code in a GitHub repo (see step 1)
- 2 environment variables: `COACH_CODE` and `SESSION_SECRET`

## Steps (Render)

1. **Put the code on GitHub.** Create a new repo (e.g. `reformat-brain-28`), then:
   ```
   cd ~/workspace/reformat-brain-app
   git init && git add -A && git commit -m "Reformat Your Brain in 28 Days"
   git remote add origin <your-new-repo-url>
   git push -u origin main
   ```
   (Cav can do this with you when you're ready.)

2. **Create a Web Service** on Render → "New +" → "Web Service" → connect the repo.
   - Runtime: **Docker** (it will use the included Dockerfile)
   - No build/start command needed (Docker handles it)

3. **Add a persistent disk** (critical — otherwise the database resets on every
   restart and you lose member answers):
   - In the service → "Disks" → Add Disk
   - Name: `appdata`, Mount Path: `/app/data`, Size: 1 GB

4. **Environment variables** (service → "Environment"):
   - `COACH_CODE` = a secret code only you know (trainers enter it at signup to get the trainer role — e.g. `fithealth-coach-2026`)
   - `SESSION_SECRET` = any long random string (keeps logins secure)
   - `COOKIE_SECURE` = `1`
   - `DB_PATH` = `/app/data/app.db` (already the Docker default)

5. **Deploy.** Render builds and starts it. On first boot the 28 lessons seed
   automatically from the bundled content.

6. **Your link** will be something like `https://reformat-brain-28.onrender.com`.
   That's the link you send to members. They sign themselves up; you handle
   payment separately as planned.

## Your trainer login
Sign up on the site with the `COACH_CODE` in the "Trainer code" field — you get
the trainer role: every lesson unlocked, the member dashboard, the lesson
editor, cohorts, and the live session view.

## Notes
- SQLite + 1 GB disk comfortably handles hundreds of members.
- Backups: Render disks can be snapshotted. For extra safety, ask Cav to set up
  a nightly database download.
- To update lesson content or code later: push to GitHub → Render redeploys
  automatically. Member accounts and answers live in the database on the
  persistent disk and are NOT touched by redeploys.
