# Quick Wins — Design Spec
**Date:** 2026-06-03

## 1. Dashboard Friendly Names

**Problem:** Dashboard item rows display raw IDs like `surah-1-ayat-1-7` instead of `Al-Fatiha · 1–7`.

**Fix:**
- Upgrade `prettyItemId()` in `frontend/app.js` to look up the surah name from the existing `SURAHS` array (already in-file) → `Al-Fatiha · 1–7`
- Apply `prettyItemId()` to the dashboard `idSpan.textContent` (currently `item.item_id`)
- Update the delete button `aria-label` to use the pretty name
- Bump SW cache version

## 2. Rate Limiting

**Problem:** No rate limiting — DoS risk on search/add endpoints.

**Fix:**
- Install `@fastify/rate-limit` in `backend/`
- Register globally: `max: 60, timeWindow: '1 minute'`
- Override with stricter `max: 10` on `POST /api/items` and `GET /api/quran/search`

## 3. Junk File Cleanup

**Problem:** `.superpowers/`, `New Text Document.txt`, `server_output.txt`, `server_error.txt` are tracked by git.

**Fix:**
- Add all four patterns to root `.gitignore`
- `git rm --cached` to untrack without deleting locally
- Single commit

## 4. Fly.io Deployment

**Goal:** Production deployment on Fly.io free tier with persistent SQLite.

**Artifacts:**
- `Dockerfile` at repo root — builds backend TypeScript, copies `frontend/` into the image, exposes port 3000
- `fly.toml` — app name, primary region, internal port 3000, HTTP health check on `/`
- Persistent volume mounted at `/data` — SQLite file lives at `/data/muraja.db`
- Env vars: `DATABASE_PATH=/data/muraja.db`, `ALLOWED_ORIGINS=https://<your-domain>`
- `.dockerignore` to exclude `node_modules`, `*.db`, `.superpowers/`

**Deploy workflow:** `fly launch` (once) → `fly deploy` (subsequent)

## 5. Arabic Text Styling

**Problem:** Arabic text in the review card is too small/compact and hard to read.

**Fix:**
- Swap `Amiri Quran` → `Scheherazade New` (Google Fonts) — Uthmani mushaf calligraphy style
- Increase Arabic font size from current value to ~`2.6rem`
- Line height: `2.2`
- Ensure `text-align: center` and `direction: rtl` on the Arabic block
- Bump SW cache version (can combine with item 1's bump)
