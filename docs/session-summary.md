# muraja'ah — Session Summary

## What It Is

A mobile-first PWA for Quran memorisation using the SM-2 spaced repetition algorithm. Tracks ayah ranges, schedules reviews, and helps hafidh maintain their hifz. Previously called "RetainFlow".

**Local dev:** `cd C:\Users\Amir_\Retainflow\backend && npm run dev` → `http://localhost:3000`
**iPhone (local):** `$env:HOST="0.0.0.0"; npm run dev` then visit `http://192.168.1.204:3000` from Safari
**Production:** https://amir-buoyant-coral-631.fly.dev

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 20, TypeScript 5, Fastify 5, better-sqlite3 v12 |
| Plugins | `@fastify/cors`, `@fastify/static`, `@fastify/compress`, `@fastify/rate-limit` |
| Testing | Vitest v2 — 37 tests, all passing |
| Frontend | Vanilla HTML / CSS / JS, PWA (manifest + service worker) |
| Fonts | Scheherazade New (Arabic), Cormorant Garamond (UI) |
| DB | SQLite WAL mode, FTS5 for Quran search, seeded with full Quran (6236 ayahs) |
| Hosting | Fly.io free tier, persistent volume at `/data`, region `lhr` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users` | Create/ensure user |
| POST | `/api/items` | Add item (auto-creates user; 5-item free tier) — rate limited 10/min |
| GET | `/api/items/:userId` | Get due items |
| GET | `/api/items/:userId/all` | Get all items (queue view + upcoming strip) |
| PUT | `/api/items/:itemId/review` | Submit review (`quality` + `user_id` required in body) |
| DELETE | `/api/items/:itemId` | Delete item (`user_id` required in body) |
| GET | `/api/stats/:userId` | Stats + review log |
| PUT | `/api/items/:itemId/notes` | Save notes (`user_id` required in body) |
| PUT | `/api/items/:itemId/snooze` | Snooze to tomorrow (`user_id` required in body) |
| GET | `/api/quran/search?q=` | FTS5 Quran search — rate limited 10/min |
| GET | `/api/quran/:surah/:from/:to` | Get ayah range |

**Important:** review, delete, notes, and snooze all require `user_id` in the request body.
**Rate limiting:** global 60 req/min; POST /api/items and GET /api/quran/search capped at 10/min.

---

## File-by-File State

### `backend/src/server.ts`
- Full Fastify REST API
- `bodyLimit: 600_000` on Fastify instance
- CORS locked to `ALLOWED_ORIGINS` env var (defaults to localhost)
- Gzip compression via `@fastify/compress`
- Rate limiting via `@fastify/rate-limit` — 60/min global, 10/min on add + search
- Security headers on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- **CSP header** on HTML responses (`script-src 'self' 'unsafe-inline'`, `style-src fonts.googleapis.com 'unsafe-inline'`, `font-src fonts.gstatic.com`, `media-src everyayah.com`)
- Cache headers: `no-cache, no-store` for `index.html`/`sw.js`, `no-cache` for JS/CSS, `max-age=86400` for images/fonts, `no-store` for API
- `requireUserId(user_id, reply)` helper — typed guard used by review/delete/notes/snooze endpoints
- `POST /api/items` calls `createUser()` first (idempotent — anonymous users may skip `/api/users`)

### `backend/src/database.ts`
- Tables: `users`, `items` (composite PK `(user_id, item_id)`), `review_log`, `quran_ayahs` (FTS5)
- **Schema migrations guarded by `PRAGMA user_version`:**
  - v0→1 (M1): add content/notes columns
  - v1→2 (M2): fix PK from `item_id TEXT PRIMARY KEY` → `PRIMARY KEY (user_id, item_id)`
- Free tier: 5 items max — `count >= 5` throws `LIMIT_REACHED`
- `addItem()` uses `INSERT OR IGNORE` + checks `changes === 0` → throws `DUPLICATE_ITEM`
- All single-item functions take `(db, userId, itemId, ...)` — composite key throughout
- `updateNotes` and `snoozeItem` throw `ITEM_NOT_FOUND` if `changes === 0`
- FTS5 LIKE fallback escapes `%`, `_`, `\` with `ESCAPE '\\'`
- **`seedQuranIfEmpty(db)`** — called from `initDb()`; creates quran_ayahs + FTS tables and seeds 6236 ayahs from `quran-json` package if count is 0. Runs on every startup, no-ops if already seeded.

### `frontend/index.html`
Full SPA with views: `view-landing`, `view-dashboard`, `view-add`, `view-review`, `view-complete`, `view-queue`, `view-stats`, plus `profile-overlay` and `#bottom-nav`.

**IMPORTANT:** `<script src="app.js">` and SW registration script must be placed **after** `<nav id="bottom-nav">` at the end of `<body>`. If placed before, `querySelectorAll('.nav-tab')` finds 0 elements at init time and no nav listeners are attached.

### `frontend/style.css`
- SW cache comment: `retainflow-v24`
- Light theme: `--bg: #fdf8e1`, `--accent: #7a5900`; dark: `--accent: #c9a227`
- `cursor: pointer` on `.lp-cta-btn` (iOS click event fix inside scroll container)
- `touch-action: manipulation` on `.nav-tab` (removes 300ms tap delay on iOS)
- Arabic font: `'Scheherazade New', Georgia, serif` — 2rem, centered, line-height 2.2
- Rating key CSS block: `.rating-key-wrap`, `.rating-key-popover` (z-index 101)
- Z-index stack: bottom-nav=90, review overlay=100, rating-key popover=101, profile overlay=110

### `frontend/app.js` (~1580 lines)

| Feature | Detail |
|---------|--------|
| UUID | `generateUUID()` polyfill (iOS <15.4 compat) used in `getOrCreateUserId` + profile creation |
| Profiles | `renderProfileList()` uses DOM methods — no innerHTML for user-supplied name |
| SM-2 review | `submitReview(quality)` → PUT /review with `user_id`; null guard at top |
| Rating key | `computeInterval(card, quality)` mirrors engine.ts; `previewIntervals(card)` uses `Object.fromEntries`; called in `startReview()` to populate ⓘ popover |
| ⓘ popover | Toggle on `#rating-key-btn` click; dismiss on outside click; `aria-expanded` kept in sync; reset on card advance |
| Notes | `apiFetch PUT /notes` includes `user_id: state.userId` |
| Snooze | `apiFetch PUT /snooze` includes `user_id: state.userId` |
| `prettyItemId(id)` | Looks up surah name from `SURAHS` array → `Al-Fatiha · 1–7`. Used in dashboard rows, delete aria-label, queue view, stats log. |

### `frontend/sw.js`
- Cache name: `retainflow-v24`
- Standard `c.addAll(SHELL)` on install (server sends `no-cache` for JS/CSS so SW always gets fresh files)
- Network-first for `/api/`, cache-first for shell assets

### `Dockerfile` (repo root)
- Multi-stage: `node:20-slim` builder + production image, both `--platform=linux/amd64`
- Builder installs `python3 make g++` for native addon compilation
- `npm ci` with `**/node_modules` excluded from `.dockerignore` (prevents Windows-compiled `better_sqlite3.node` from overwriting Linux build)
- Production image: `backend/dist/` + `backend/node_modules/` + `frontend/`
- CMD: `node backend/dist/server.js`

### `fly.toml` (repo root)
- App: `amir-buoyant-coral-631`, region `lhr`
- Volume `muraja_data` → `/data`, size 1GB
- `auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0`
- Health check: `GET /` every 15s

---

## Fly.io Deploy

```powershell
cd C:\Users\Amir_\Retainflow
fly deploy
```

**Secrets set:**
- `DB_PATH=/data/muraja.db`
- `ALLOWED_ORIGINS=https://amir-buoyant-coral-631.fly.dev`

**First deploy only:**
```powershell
fly launch --no-deploy
fly volumes create muraja_data --size 1 --region lhr
fly secrets set DB_PATH=/data/muraja.db ALLOWED_ORIGINS=https://amir-buoyant-coral-631.fly.dev
fly deploy
```

---

## Tests

**37 tests, all passing.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

---

## Recent Git Log

```
a4988f9 fix: move script tags after nav so querySelectorAll finds nav buttons at init
e9b9cd0 fix: touch-action manipulation on nav tabs to fix iOS tap issue, bump SW v24
bdd6892 feat: auto-seed Quran data on startup if quran_ayahs table is empty
205ceeb fix: replace fullwidth plus with plain + on nav add button
88f8b2e fix: exclude backend/node_modules from Docker build context (was overwriting Linux binary with Windows one)
452a33a fix: use npm_config_build_from_source=true to compile better-sqlite3 from source
dd50693 fix: switch to node:20-slim, explicit linux/amd64 platform for better-sqlite3
bd0b55f fix: Dockerfile add Alpine build tools for better-sqlite3
cdcfeeb fix: fly.toml app name, Dockerfile alpine build tools, auto-stop machines
eac2b9d feat: Fly.io deployment config — Dockerfile, fly.toml, persistent volume
6af9b2f chore: untrack junk files, add to .gitignore
62e2bf1 feat: add @fastify/rate-limit — 60/min global, 10/min on add+search
ce88c68 feat: dashboard friendly surah names, bump SW cache to v22
e19593c feat: mushaf-style Arabic — Scheherazade New font, larger size, centered
```

---

## Uncommitted Changes

None — working tree is clean.

---

## What Still Needs Doing

| Item | Priority | Notes |
|------|----------|-------|
| `og-image.png` (1200×630px) | Medium | Referenced in OG/Twitter meta tags but file missing |
| Custom domain | Medium | Currently on `amir-buoyant-coral-631.fly.dev` — rename app or add custom domain when ready. Meta tags still reference `retainflow.app` |
| Auth on GET user endpoints | Low | `/api/items/:userId` + `/api/stats/:userId` return data to any caller who knows a userId — acceptable for anonymous model but documented risk |
| Upgrade flow | Low | `alert('Upgrade coming soon!')` placeholder in `app.js` |
| `sitemap.xml` | Low | `robots.txt` references it but file missing |

---

## Key Architecture Decisions

- **Anonymous UUIDs**: No server-side auth. `user_id` is a UUID in `localStorage`. It is both identity and credential.
- **Composite PK**: `PRIMARY KEY (user_id, item_id)` so multiple profiles can independently track the same surah.
- **PRAGMA user_version**: Migration gates are O(1) version checks, not `PRAGMA table_info` on every startup.
- **SW + no-cache**: Service worker caches shell. Server sends `no-cache` for JS/CSS so SW always fetches fresh on install. Fonts/images keep `max-age=86400`.
- **iOS**: `generateUUID()` polyfill for <15.4; `cursor: pointer` required on all interactive elements inside `-webkit-overflow-scrolling: touch` containers; `touch-action: manipulation` on nav tabs.
- **Script placement**: `app.js` must come after `<nav id="bottom-nav">` in the HTML — if placed before, the nav buttons have no listeners at init time.
- **Docker + better-sqlite3**: `**/node_modules` in `.dockerignore` is critical — without it, Windows-compiled `.node` binary overwrites the Linux one built during `npm ci`.
- **Fly.io auto-seed**: `seedQuranIfEmpty()` in `initDb()` seeds 6236 ayahs on first boot. Idempotent — checks count before inserting.
