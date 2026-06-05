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
| POST | `/api/items` | Add item (auto-creates user; 50-item free tier) — rate limited 10/min |
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
- **CSP header** on HTML responses: `script-src 'self' 'unsafe-inline'`, `style-src fonts.googleapis.com 'unsafe-inline'`, `font-src fonts.gstatic.com`, `media-src everyayah.com`, `img-src 'self' data: https://api.qrserver.com`
- Cache headers: `no-cache, no-store` for `index.html`/`sw.js`, `no-cache` for JS/CSS, `max-age=86400` for images/fonts, `no-store` for API
- `requireUserId(user_id, reply)` helper — typed guard used by review/delete/notes/snooze endpoints
- `POST /api/items` calls `createUser()` first (idempotent — anonymous users may skip `/api/users`)
- Free tier error message: "Free tier is limited to 50 parallel tracking decks"

### `backend/src/database.ts`
- Tables: `users`, `items` (composite PK `(user_id, item_id)`), `review_log`, `quran_ayahs` (FTS5)
- **Schema migrations guarded by `PRAGMA user_version`:**
  - v0→1 (M1): add content/notes columns
  - v1→2 (M2): fix PK from `item_id TEXT PRIMARY KEY` → `PRIMARY KEY (user_id, item_id)`
- **Free tier: 50 items max** — `count >= 50` throws `LIMIT_REACHED` (raised from 5 this session)
- `addItem()` uses `INSERT OR IGNORE` + checks `changes === 0` → throws `DUPLICATE_ITEM`
- All single-item functions take `(db, userId, itemId, ...)` — composite key throughout
- `updateNotes` and `snoozeItem` throw `ITEM_NOT_FOUND` if `changes === 0`
- FTS5 LIKE fallback escapes `%`, `_`, `\` with `ESCAPE '\\'`
- **`seedQuranIfEmpty(db)`** — called from `initDb()`; creates quran_ayahs + FTS tables and seeds 6236 ayahs from `quran-json` package if count is 0. Runs on every startup, no-ops if already seeded.

### `frontend/index.html`
Full SPA with views: `view-landing`, `view-dashboard`, `view-add`, `view-review`, `view-complete`, `view-queue`, `view-stats`, plus `profile-overlay` and `#bottom-nav`.

- **`#desktop-gate`** — shown via CSS (`@media (min-width:768px) and (pointer:fine)`) to non-touch desktop visitors. Contains QR code from `api.qrserver.com` pointing to the live app URL. The app (`#app`, `#bottom-nav`) is hidden on desktop.
- **`#playback-sheet`** — fixed bottom sheet for audio playback (replaces old `#audio-player` inside the review card). Contains: reciter select, ayah label (`#audio-ayah-label`), progress bar (`#ps-track` / `#ps-fill`), time displays (`#ps-time-cur`, `#ps-time-rem`), controls (⏮`#ps-prev`, ↺`#ps-replay`, ▶`#audio-play-btn`, ⏭`#ps-next-ayah`, `#ps-next-verse`), loop buttons (`.loop-btn`), loop dots (`#loop-dots`).
- `<script src="app.js">` and SW registration script must be placed **after** `<nav id="bottom-nav">` at the end of `<body>`. If placed before, `querySelectorAll('.nav-tab')` finds 0 elements at init time and no nav listeners are attached.

### `frontend/style.css`
- SW cache comment: `retainflow-v29`
- Light theme: `--bg: #fdf8e1`, `--accent: #7a5900`; dark: `--accent: #c9a227`
- **Desktop gate:** `#desktop-gate { display:none }` by default; shown + app hidden under `@media (min-width:768px) and (pointer:fine)`
- **Ayah sections:** `.ayah-section` wrapper per ayah; `.ayah-section--playing` adds gold tint highlight on active ayah; `.en-verse` for inline English below each ayah
- **Tappable words:** `.ar-word--tappable` with pointer cursor and hover highlight
- **Playback sheet:** `.playback-sheet` fixed bottom, `border-radius: 16px 16px 0 0`, `touch-action: pan-x`, transition for smooth swipe-dismiss; `.sheet-dismissed` slides it off with `translateY(110%)`
- `.review-scroll-area` has `padding-bottom: 200px` so content isn't hidden behind the sheet
- Arabic flow: `.ar-flow` (direction:rtl, 2rem, Scheherazade New, `overflow-wrap: break-word`), `.ayah-marker` (accent colour, inline)
- Z-index stack: bottom-nav=90, review overlay=100, rating-key popover=101, profile overlay=110, playback-sheet=120

### `frontend/app.js` (~1750 lines)

| Feature | Detail |
|---------|--------|
| UUID | `generateUUID()` polyfill (iOS <15.4 compat) |
| Profiles | `renderProfileList()` uses DOM methods — no innerHTML for user-supplied name |
| SM-2 review | `submitReview(quality)` → PUT /review with `user_id` |
| Rating key | `computeInterval` / `previewIntervals` — populate ⓘ popover in `startReview()` |
| `prettyItemId(id)` | Surah name lookup → `Al-Fatiha · 1–7` |
| `toArabicNumeral(n)` | Converts ASCII digits → Eastern Arabic (٠١٢٣…) |
| `getStartAyah(itemId)` | Parses `surah-X-ayat-FROM-TO` → returns FROM |
| `fmtTime(s)` | Formats seconds → `m:ss` for progress bar |
| `filterContent(rawContent)` | Strips English when translation off — joins with `\n\n` (critical: keeps all ayah blocks) |
| `renderWordLevel(rawContent)` | Per-ayah `.ayah-section` divs each containing `.ar-flow` (Arabic + ۝ marker) + `.en-verse` (English inline). Each word is `.ar-word--tappable` — click calls `showPlaybackSheet()` then `playFromIdx(ayahIdx)`. |
| Juz browser | `JUZ_STARTS` (30 entries), `getSurahsInJuz(juz)`, `selectJuz()` with bulk-add row |
| `getJuzChunk()` | Reads `rf_juz_chunk`, defaults 10 |
| `addJuzItems(juzNum, chunkSize)` | Batch add: captures difficulty at call time, handles errors, sets `rf_has_items`, calls `loadDashboard()` |
| `audioState` | `{ audio, surah, ayahs, currentIdx, playing, loopMode, loopsDone, singleAyahMode }` |
| `getLoopMode()` | Reads `rf_loop_mode`; handles `'Infinity'` string |
| `playFromIdx(idx)` | Plays ayah; `timeupdate` drives `#ps-fill` / time labels; `ended` respects `singleAyahMode` and `loopMode` |
| `stopAudio()` | Pauses, clears, resets state + progress bar |
| `initAudioForItem(itemId)` | Shows `#playback-sheet`, resets all state |
| `showPlaybackSheet()` | Removes `hidden` + `sheet-dismissed` — call before `playFromIdx` when re-showing after swipe dismiss |
| Swipe dismiss | IIFE: `touchstart/move/end` on sheet; dy > 80px → `sheet-dismissed`; audio keeps playing |
| Sheet buttons | `ps-prev`, `ps-replay`, `audio-play-btn`, `ps-next-ayah`, `ps-next-verse` (advances to next review card), `ps-track` click (seek) |
| Loop controls | `.loop-btn` `data-loop` attr; persisted to `rf_loop_mode`; `#loop-dots` for finite modes |
| `updateAudioUI()` | Syncs play btn, label, loop btns, dots, **highlights `.ayah-section--playing`** by matching `data-ayah-num` |

### `frontend/sw.js`
- Cache name: `retainflow-v29`
- Network-first for `/api/`, cache-first for shell assets

### `Dockerfile` (repo root)
- Multi-stage: `node:20-slim` builder + production image, both `--platform=linux/amd64`
- Builder installs `python3 make g++` for native addon compilation
- `npm ci` with `**/node_modules` excluded from `.dockerignore`
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

---

## Tests

**37 tests, all passing.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

---

## Recent Git Log

```
3558baf feat: swipe down to dismiss playback sheet, tap word to restore it
192dfd0 feat: bottom sheet player, tap-word-to-play, inline English per verse
1358a8f feat: desktop QR gate + tap ayah marker to play from/play single ayah
1ef5c93 fix: add spaces between Arabic word spans and overflow-wrap to fix text cutoff
475fed8 fix: set rf_has_items flag after Juz bulk add so empty state is correct
f66452f fix: reset loopsDone in stopAudio, fix loop button aria-label
f3cf6ef feat: audio loop — repeat recitation 2x, 5x, or infinitely
59f522e fix: surface network errors in Juz bulk add, capture difficulty at call time
3f18f68 feat: bulk add entire Juz with configurable ayah chunk size
3226d88 feat: mushaf flow display — inline Arabic with ayah markers
0e61aed fix: filterContent must join blocks with double newline so all ayahs render
6ed27b4 feat: raise free tier limit from 5 to 50 items
a4988f9 fix: move script tags after nav so querySelectorAll finds nav buttons at init
```

---

## Uncommitted Changes

None — working tree is clean.

---

## What Still Needs Doing

| Item | Priority | Notes |
|------|----------|-------|
| App Store / Play Store | High | PWA is ready; wrap with Capacitor or TWA for store listing |
| Custom domain | Medium | Currently on `amir-buoyant-coral-631.fly.dev` — meta tags still reference `retainflow.app` |
| `og-image.png` (1200×630px) | Medium | Referenced in OG/Twitter meta tags but file missing |
| Upgrade flow | Low | `alert('Upgrade coming soon!')` placeholder in `app.js` |
| `sitemap.xml` | Low | `robots.txt` references it but file missing |
| Auth on GET user endpoints | Low | `/api/items/:userId` + `/api/stats/:userId` — acceptable for anonymous model but documented risk |

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
- **Desktop gate**: Pure CSS media query (`min-width:768px` + `pointer:fine`) — no JS, no redirect. Desktop users see QR code; mobile users see the app.
- **Playback sheet**: Fixed to viewport bottom (`position:fixed`), not inside the scroll container. Swipe-down (>80px) adds `.sheet-dismissed` (translateY 110%) — audio keeps playing. Tapping any Arabic word calls `showPlaybackSheet()` then `playFromIdx()` to restore it.
- **Per-ayah sections**: `renderWordLevel` creates one `.ayah-section` per ayah with Arabic + inline English. `data-ayah-num` attribute lets `updateAudioUI` highlight the playing section without re-rendering.
