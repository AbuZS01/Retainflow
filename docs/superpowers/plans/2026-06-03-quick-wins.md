# Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent improvements: dashboard friendly names, rate limiting, junk cleanup, Fly.io deployment, and mushaf-style Arabic font.

**Architecture:** All frontend changes are in `frontend/app.js`, `frontend/style.css`, and `frontend/index.html`. Backend rate limiting is a Fastify plugin registered in `backend/src/server.ts`. Deployment artifacts live at the repo root. All tasks are independent — do them in any order.

**Tech Stack:** Node 20, TypeScript 5, Fastify 5, `@fastify/rate-limit`, vanilla JS/CSS, Google Fonts (Scheherazade New), Docker, Fly.io

---

## Task 1: Dashboard Friendly Names

**Files:**
- Modify: `frontend/app.js:461` (dashboard idSpan)
- Modify: `frontend/app.js:479` (delete button aria-label)
- Modify: `frontend/app.js:1074-1079` (prettyItemId function)
- Modify: `frontend/sw.js:1` (bump cache version)
- Modify: `frontend/style.css:1` (bump cache comment)

### Context

`prettyItemId()` at line 1074 currently outputs `Surah 67 · 1–30`. The `SURAHS` array at line 1210 is `[surah_number, 'Name', total_ayahs][]` — e.g. `[1,'Al-Fatiha',7]`. The dashboard item row at line 461 uses `item.item_id` raw instead of calling `prettyItemId`.

- [ ] **Step 1: Upgrade `prettyItemId` to include the surah name**

Replace lines 1074–1079 in `frontend/app.js`:

```js
function prettyItemId(id) {
  const m = id.match(/^surah-(\d+)-ayat-(\d+)-(\d+)$/);
  if (!m) return id;
  const surahNum = parseInt(m[1], 10);
  const entry = SURAHS.find(s => s[0] === surahNum);
  const name = entry ? entry[1] : `Surah ${surahNum}`;
  return `${name} · ${m[2]}–${m[3]}`;
}
```

- [ ] **Step 2: Apply `prettyItemId` in the dashboard item row**

In `frontend/app.js` at line 461, change:
```js
idSpan.textContent = item.item_id;
```
to:
```js
idSpan.textContent = prettyItemId(item.item_id);
```

- [ ] **Step 3: Update the delete button aria-label**

At line 479, change:
```js
deleteBtn.setAttribute('aria-label', `Remove ${item.item_id}`);
```
to:
```js
deleteBtn.setAttribute('aria-label', `Remove ${prettyItemId(item.item_id)}`);
```

- [ ] **Step 4: Bump SW cache version**

In `frontend/sw.js` line 1, change `retainflow-v21` → `retainflow-v22`.

In `frontend/style.css` line 1, change the comment to `/* Service worker cache: retainflow-v22 */`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js frontend/sw.js frontend/style.css
git commit -m "feat: dashboard friendly surah names, bump SW cache to v22"
```

---

## Task 2: Rate Limiting

**Files:**
- Modify: `backend/package.json` (add dependency)
- Modify: `backend/src/server.ts` (register plugin, per-route overrides)

### Context

`buildApp()` registers Fastify plugins in order. Add `@fastify/rate-limit` after the existing plugin registrations (compress, cors, static). Per-route config overrides the global limit.

- [ ] **Step 1: Install the package**

```bash
cd backend && npm install @fastify/rate-limit
```

Expected: package added to `package.json` dependencies, `node_modules/@fastify/rate-limit` exists.

- [ ] **Step 2: Add the import to `backend/src/server.ts`**

After the existing imports (around line 5), add:
```ts
import rateLimit from '@fastify/rate-limit';
```

- [ ] **Step 3: Register the global rate limit**

In `buildApp()`, after the `app.register(fastifyCompress, ...)` call (around line 32), add:

```ts
await app.register(rateLimit, {
  global: true,
  max: 60,
  timeWindow: '1 minute',
});
```

Note: `buildApp` is a sync function that returns the app — Fastify plugins registered with `register` are queued and resolved on `app.listen` / `app.ready`, so `await` here is not needed. Use the same style as the existing plugin registrations (check whether existing ones use `await` or not and match).

- [ ] **Step 4: Add per-route stricter limits**

Find `POST /api/items` handler and add a `config` option:

```ts
app.post('/api/items', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (request, reply) => {
```

Find `GET /api/quran/search` handler and add the same:

```ts
app.get('/api/quran/search', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (request, reply) => {
```

- [ ] **Step 5: Run tests to confirm nothing broke**

```bash
cd backend && npx vitest run
```

Expected: 37 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/server.ts
git commit -m "feat: add @fastify/rate-limit — 60/min global, 10/min on add+search"
```

---

## Task 3: Junk File Cleanup

**Files:**
- Modify: `.gitignore` (root)

### Context

These files are currently tracked by git and should not be:
- `.superpowers/` — brainstorm session artifacts
- `New Text Document.txt` — stray file
- `server_output.txt`, `server_error.txt` — dev server log captures

- [ ] **Step 1: Add entries to root `.gitignore`**

The root `.gitignore` currently contains:
```
node_modules/
dist/
*.db
*.db-shm
*.db-wal
```

Append these lines:
```
.superpowers/
New Text Document.txt
server_output.txt
server_error.txt
```

- [ ] **Step 2: Untrack the files without deleting them locally**

```bash
git rm --cached -r .superpowers/
git rm --cached "New Text Document.txt"
git rm --cached server_output.txt server_error.txt
```

Expected: files appear in `git status` as deleted (staged), but still exist on disk.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack junk files, add to .gitignore"
```

---

## Task 4: Fly.io Deployment

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)
- Create: `fly.toml` (repo root)

### Context

- TypeScript builds to `backend/dist/`
- The server entrypoint is `backend/dist/server.js`
- Frontend is served from `path.join(__dirname, '../../frontend')` where `__dirname` = `backend/dist/` at runtime → resolves to repo-root `frontend/`
- DB path comes from `DB_PATH` env var (defaults to `./retainflow.db`)
- On Fly.io, the persistent volume mounts at `/data` — set `DB_PATH=/data/muraja.db`

- [ ] **Step 1: Create `.dockerignore`**

Create `/.dockerignore` at the repo root:

```
node_modules
backend/dist
*.db
*.db-shm
*.db-wal
.superpowers
server_output.txt
server_error.txt
New Text Document.txt
docs
```

- [ ] **Step 2: Create `Dockerfile`**

Create `/Dockerfile` at the repo root:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend/ ./backend/
RUN cd backend && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY frontend/ ./frontend/
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "backend/dist/server.js"]
```

- [ ] **Step 3: Create `fly.toml`**

Create `/fly.toml` at the repo root. Replace `muraja-ah` with whatever name `fly launch` assigns (or pick your own — must be globally unique on fly.io):

```toml
app = "muraja-ah"
primary_region = "lhr"

[build]

[env]
  PORT = "3000"
  HOST = "0.0.0.0"

[mounts]
  source = "muraja_data"
  destination = "/data"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

  [[services.http_checks]]
    interval = "15s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/"
    protocol = "http"
```

- [ ] **Step 4: Test the Docker build locally**

```bash
docker build -t muraja-test .
docker run --rm -p 3000:3000 muraja-test
```

Visit `http://localhost:3000` — app should load. Ctrl+C to stop.

- [ ] **Step 5: Install Fly CLI and deploy**

Install (if not already): https://fly.io/docs/hands-on/install-flyctl/

```bash
fly auth login
fly launch --no-deploy   # interactive: accept app name, region lhr, say NO to postgres, NO to redis
fly volumes create muraja_data --size 1 --region lhr
fly secrets set DB_PATH=/data/muraja.db ALLOWED_ORIGINS=https://<your-app>.fly.dev
fly deploy
```

Expected: `fly deploy` completes, app URL printed. Visit it in browser.

- [ ] **Step 6: Commit the deployment config**

```bash
git add Dockerfile .dockerignore fly.toml
git commit -m "feat: Fly.io deployment config — Dockerfile, fly.toml, persistent volume"
```

---

## Task 5: Mushaf-Style Arabic Font

**Files:**
- Modify: `frontend/index.html:71-75` (Google Fonts URL — add Scheherazade New)
- Modify: `frontend/style.css:572-584` (Arabic font family and sizing)
- Modify: `frontend/sw.js:1` (bump cache — combine with Task 1 if doing together)
- Modify: `frontend/style.css:1` (bump cache comment)

### Context

Current font stack: `'Amiri Quran', 'Scheherazade New', Georgia, serif` — Amiri Quran leads but isn't loaded (the Google Fonts URL doesn't include Scheherazade New). Target: swap to Scheherazade New as primary (mushaf calligraphy style). Arabic display lives in `.ar-line` (review card word-level display) with `font-size: 1.25rem; line-height: 2.2`.

- [ ] **Step 1: Add Scheherazade New to the Google Fonts URL in `index.html`**

Replace all three occurrences of the Google Fonts URL (lines 71, 72, 74) — the current URL is:
```
https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap
```

Change to:
```
https://fonts.googleapis.com/css2?family=Scheherazade+New:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap
```

Also update the comment at line 70 from `Amiri Quran` to `Scheherazade New`.

- [ ] **Step 2: Update the CSS font family and size for Arabic**

In `frontend/style.css` at line 575, change the font-family rule:
```css
.ar-line,
.result-arabic,
.range-preview { font-family: 'Scheherazade New', 'Amiri Quran', Georgia, serif; }
```

At line 580, update `.ar-line` sizing — change `font-size: 1.25rem` to `font-size: 2rem` and `text-align: right; justify-content: flex-end` to `text-align: center; justify-content: center`:

The full updated rule (line 580):
```css
.ar-line { direction: rtl; text-align: center; line-height: 2.2; font-size: 2rem; color: var(--text); display: flex; flex-wrap: wrap; justify-content: center; gap: .2em; }
```

- [ ] **Step 3: Bump SW cache version** (skip if already done in Task 1)

In `frontend/sw.js` line 1: `retainflow-v21` → `retainflow-v22` (or `v23` if Task 1 already bumped to v22).

In `frontend/style.css` line 1: update comment to match.

- [ ] **Step 4: Start the dev server and check the review card**

```bash
cd backend && npm run dev
```

Open `http://localhost:3000`, add an item if needed, start a review. The Arabic text should render in Scheherazade New at a larger size, centered.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/style.css frontend/sw.js
git commit -m "feat: mushaf-style Arabic — Scheherazade New font, larger size, centered"
```
