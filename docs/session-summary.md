# muraja'ah — Session Summary

## What It Is

A mobile-first PWA for Quran memorisation using the SM-2 spaced repetition algorithm. Tracks ayah ranges, schedules reviews, and helps hafidh maintain their hifz. Previously called "RetainFlow".

**Local dev:** `cd C:\Users\Amir_\Retainflow\backend && npm run dev` → `http://localhost:3000`
**iPhone (local):** `$env:HOST="0.0.0.0"; npm run dev` then visit `http://192.168.1.204:3000` from Safari
**Production:** Render — see deploy section below (Fly.io trial ended)
**GitHub:** https://github.com/AbuZS01/Retainflow

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 20, TypeScript 5, Fastify 5, better-sqlite3 v12 |
| Plugins | `@fastify/cors`, `@fastify/static`, `@fastify/compress`, `@fastify/rate-limit` |
| Testing | Vitest v2 — 48 tests, all passing |
| Frontend | Vanilla HTML / CSS / JS, PWA (manifest + service worker) |
| Fonts | Scheherazade New (Arabic), Cormorant Garamond (UI) |
| DB | SQLite WAL mode, FTS5 for Quran search, seeded with full Quran (6236 ayahs) |
| Hosting | Render (Docker + persistent disk at `/data`) — migrated from Fly.io |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users` | Create/ensure user |
| POST | `/api/items` | Add item (auto-creates user; 50-item free tier) — rate limited 10/min |
| GET | `/api/items/:userId` | Get due items |
| GET | `/api/items/:userId/all` | Get all items (queue view + upcoming strip) |
| PUT | `/api/items/:itemId/review` | Submit review (`quality` + `user_id` required in body) |
| PUT | `/api/items/:itemId/undo-review` | Undo last review (`user_id` + `prev_state` required) — endpoint kept, UI removed |
| PUT | `/api/items/:itemId/range` | Edit ayah range (`user_id`, `surah`, `from`, `to` required) |
| DELETE | `/api/items/:itemId` | Delete item (`user_id` required in body) |
| GET | `/api/stats/:userId` | Stats + review log |
| PUT | `/api/items/:itemId/notes` | Save notes (`user_id` required in body) — endpoint kept, UI removed |
| PUT | `/api/items/:itemId/snooze` | Snooze (`user_id` + optional `days`: 1/3/7/14, default 1) |
| GET | `/api/quran/search?q=` | FTS5 Quran search — rate limited 10/min |
| GET | `/api/quran/:surah/:from/:to` | Get ayah range |

**Important:** review, delete, snooze, undo-review, range-edit all require `user_id` in the request body.
**Rate limiting:** global 60 req/min; POST /api/items and GET /api/quran/search capped at 10/min.

---

## File-by-File State

### `backend/src/server.ts`
- Full Fastify REST API
- `bodyLimit: 600_000` on Fastify instance
- CORS locked to `ALLOWED_ORIGINS` env var (defaults to localhost)
- Gzip compression via `@fastify/compress`
- Rate limiting via `@fastify/rate-limit` — 60/min global, 10/min on add + search
- Security headers on all responses
- **CSP header** on HTML responses: `script-src 'self' 'unsafe-inline'`, `style-src fonts.googleapis.com 'unsafe-inline'`, `font-src fonts.gstatic.com`, `media-src everyayah.com`, `img-src 'self' data: https://api.qrserver.com`
- `requireUserId(user_id, reply)` helper — typed guard used by review/delete/snooze/undo/range endpoints

### `backend/src/database.ts`
- Tables: `users`, `items` (composite PK `(user_id, item_id)`), `review_log`, `quran_ayahs` (FTS5)
- **Schema migrations guarded by `PRAGMA user_version`:** v0→1 (M1), v1→2 (M2)
- **Free tier: 50 items max**
- `addItem()` uses `INSERT OR IGNORE` + checks `changes === 0` → throws `DUPLICATE_ITEM`
- `renameItem(db, userId, oldItemId, newItemId, newContent)` — transaction-wrapped insert+delete, preserves SM-2 state
- `undoReview(db, userId, itemId, prevState)` — transaction-wrapped: restores SM-2 state + deletes last review_log entry
- `snoozeItem(db, userId, itemId, days=1)` — accepts days param (1/3/7/14)
- FTS5 LIKE fallback for search
- `seedQuranIfEmpty(db)` — seeds 6236 ayahs on first boot

### `frontend/index.html`
Full SPA with views: `view-landing`, `view-dashboard`, `view-add`, `view-review`, `view-complete`, `view-queue`, `view-stats`, plus `profile-overlay` and `#bottom-nav`.

- **`#desktop-gate`** — shown via CSS on non-touch desktop, contains QR code
- **`#playback-sheet`** — fixed bottom sheet for audio playback; dark brown/gold colour scheme
- **`#resume-banner`** — shown on dashboard when a session was interrupted
- **`#edit-range-modal`** — bottom sheet modal for editing ayah range of a queue item
- **`#snooze-sheet`** — bottom sheet with 4 snooze duration options
- **`#onboarding-overlay`** — 3-step first-run flow (level picker → suggestions → first review)
- Difficulty pills: 2-column grid, last pill spans full width
- Queue view has `#queue-search` filter input above `#queue-content`
- Profile panel has QR sync section (`#sync-qr-btn`, `#sync-qr-wrap`)
- Add screen: 3-tab layout — Quick add / Browse Juz / Search tabs (`#add-panel-quick`, `#add-panel-juz`, `#add-panel-search`); `#range-selector` is outside panels (shared)
- Playback sheet controls: `◄◄` (ps-prev), ▶/▮▮ (audio-play-btn), `►►` (ps-next-ayah); replay `↺` is in the loop button row
- No notes UI (backend endpoint still exists)
- No undo UI (backend endpoint still exists)

### `frontend/style.css`
- SW cache comment: `retainflow-v41`
- Light theme: `--bg: #fdf8e1`, `--accent: #7a5900`; dark: `--accent: #c9a227`
- Rating buttons: 4-column row with interval hints below label (`.q-interval`)
- `.review-card`: borderless/full-bleed (transparent background, no border)
- `.ar-flow`: `font-size: 2.4rem`; `.ayah-section + .ayah-section`: gold separator line
- `.goal-ring-wrap`: circular SVG progress ring on dashboard
- `.add-tabs` / `.add-tab` / `.add-tab--active` / `.add-panel`: 3-tab add screen
- `.onboarding-overlay` / `.ob-*`: full onboarding flow styles
- `.review-more-menu` / `.review-menu-item`: ⋯ overflow menu for display options
- `.playback-sheet`: `background: var(--accent)` (brown), gold controls (`#c9a227`)
- `.loop-btn`: gold border/text; `.loop-btn.active`: gold fill, dark text
- No `.nav-tab.active::after` dot (removed)
- No `.ps-pill` (removed)
- No `.ps-next-verse-btn` (removed)
- No `.notes-indicator`, `.notes-row`, `.notes-textarea` (removed)
- Z-index stack: bottom-nav=90, review overlay=100, rating-key popover=101, profile overlay=110, playback-sheet=120, snooze-sheet=130, modal-overlay=150, onboarding=200

### `frontend/app.js` (~2200 lines)

| Feature | Detail |
|---------|--------|
| Session helpers | `saveSession()`, `clearSession()`, `getSavedSession()` — localStorage key `rf_session` |
| QR sync | `handleSyncParam()` IIFE on load — reads `?sync=UUID`, imports as profile, cleans URL |
| `submitReview(quality)` | Submits rating; no undo toast shown |
| `updateIntervalHints(card)` | Populates `qi-forgot/hard/good/easy` spans using `previewIntervals()`; called in `startReview` |
| ⋯ menu | `review-more-btn` toggles `review-more-menu`; click-outside closes it |
| `updateGoalBar()` | Drives SVG ring: `stroke-dashoffset = 175.9 * (1 - pct)` |
| `switchAddTab(tabName)` | Toggles add-screen panels; hides `#range-selector` on switch; called in `openAddView` |
| Onboarding | `maybeShowOnboarding()` — guards with `rf_onboarding_done` + `rf_has_items`; called at end of `loadDashboard` |
| `renderObSuggestions(packs)` | DOM-built (no innerHTML); checks POST status before advancing; `obAdvancing` flag debounces |
| `openEditModal(itemId)` | Shows edit-range modal populated with current surah/from/to |
| Snooze sheet | `snooze-btn` opens sheet; `.snooze-option` buttons call snooze with `days` |
| Queue search | `queueAllItems` stores all items; input filters by `prettyItemId()` |
| `addSingleJuzItem(juzNum)` | POSTs `juz-N` with empty content; handles 201/409/403 |
| `prettyItemId(id)` | Handles `juz-N` → "Juz N"; `surah-X-ayat-Y-Z` → "Surah · Y–Z" |
| `startReview(item)` | Juz items: renders `.juz-review-summary`; non-juz: normal flow; calls `updateIntervalHints` |
| `initAudioForItem(itemId)` | Early return guard for `juz-\d+` items |
| `showSessionComplete()` | Clears active toast before showing completion screen |
| `showToast(html, ms, {top})` | `top:true` → positions at top of screen; `top:false` (default) → bottom |
| `ps-next-verse` | Removed — no skip button in audio player |
| Queue rows | No notes button; no rep-count meta; just item name + delete button |

### `frontend/sw.js`
- Cache name: `retainflow-v41`
- Network-first for `/api/`, cache-first for shell assets

### `Dockerfile` (repo root)
- Multi-stage: `node:20-slim` builder + production image, both `--platform=linux/amd64`
- CMD: `node backend/dist/server.js`

### `render.yaml` (repo root)
- Web service using Docker runtime
- Persistent disk at `/data`, 1GB
- Env vars: `DB_PATH`, `ALLOWED_ORIGINS`, `PORT`

---

## Render Deploy

**First-time setup (do once on render.com dashboard):**
1. Go to https://render.com → New → Web Service
2. Connect GitHub repo: `AbuZS01/Retainflow`
3. Runtime: **Docker**
4. Add Persistent Disk: mount path `/data`, size 1 GB
5. Set environment variables:
   - `DB_PATH` = `/data/muraja.db`
   - `ALLOWED_ORIGINS` = `https://retainflow.onrender.com`
   - `PORT` = `3000`
6. Deploy

**Subsequent deploys:** push to GitHub main branch — Render auto-deploys.

**Manual redeploy:**
```powershell
git push origin main
```

**Important:** Free Render services **sleep after 15 minutes of inactivity**. First request after sleep takes ~30 seconds to wake up. Upgrade to $7/month to keep always-on.

---

## Environment Variables (production)

| Variable | Value |
|----------|-------|
| `DB_PATH` | `/data/muraja.db` |
| `ALLOWED_ORIGINS` | `https://retainflow.onrender.com` |
| `PORT` | `3000` |

---

## Tests

**48 tests, all passing.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

---

## Recent Git Log

```
14b2f85 fix: playback sheet bg matches Plus button accent colour
4f160b4 fix: remove undo btn, dark-brown/gold playback sheet, no blue flash on play
6fd76a5 fix: remove nav dot, replay btn to loop row, centre 3 playback controls
43abeb2 fix: remove pill dot/next btn/notes, brown nav icons, quality breakdown legend visible
6940fda fix: audio next btn, centre loop btns, theme colours, remove dots, quality bar
3975a95 fix: dismiss undo toast when session completes
f387e5a fix: undo toast pinned to top; bump SW cache to v35
f4109dc chore: bump SW cache to v34
e516275 fix: onboarding — check POST result, debounce pack taps, textContent XSS fix
80c84a3 feat: guided onboarding — level picker, suggested packs, direct to first review
8eee2a5 feat: typography — full-bleed review card, larger Arabic, refined ayah separators
c001145 feat: add screen — tabbed Quick add / Browse Juz / Search layout
bb9feff fix: dashboard ring — remove goal-input clobber, cleanup CSS, restore aria-label
10af51f feat: dashboard — circular progress ring replaces flat goal bar
990aeb6 feat: review screen — interval hints on rating buttons, controls in ⋯ menu
```

---

## Uncommitted Changes

None — working tree is clean.

---

## What Still Needs Doing

| Item | Priority | Notes |
|------|----------|-------|
| Render deploy | **NEXT** | Setup on render.com dashboard — see deploy section above |
| Update `ALLOWED_ORIGINS` after Render URL known | High | Set in Render dashboard env vars |
| App Store / Play Store | Medium | PWA ready; wrap with Capacitor or TWA |
| Custom domain | Medium | User handling separately |
| Undo UI | Low | Backend works; UI was removed — could re-add in a non-intrusive way |

---

## Key Architecture Decisions

- **Anonymous UUIDs**: No server-side auth. `user_id` is a UUID in `localStorage`. It is both identity and credential.
- **QR sync**: User scans QR code (shown in profile panel) on new device → opens app with `?sync=UUID` → imported as profile. No auth server needed.
- **Composite PK**: `PRIMARY KEY (user_id, item_id)` so multiple profiles can independently track the same surah.
- **item_id formats**: `surah-{N}-ayat-{from}-{to}` for ayah ranges; `juz-{N}` for full-juz tracking.
- **renameItem**: insert new row + delete old in a transaction — preserves SM-2 state when editing range.
- **undoReview**: transaction-wrapped UPDATE + DELETE of last log entry — atomic, safe.
- **PRAGMA user_version**: Migration gates are O(1) version checks.
- **SW + no-cache**: SW caches shell. Server sends `no-cache` for JS/CSS. Cache currently at v41.
- **Script placement**: `app.js` must come after `<nav id="bottom-nav">` in the HTML.
- **Docker + better-sqlite3**: `**/node_modules` in `.dockerignore` is critical.
- **Auto-seed**: `seedQuranIfEmpty()` seeds 6236 ayahs on first boot. Idempotent.
- **Desktop gate**: Pure CSS media query (`min-width:768px` + `pointer:fine`).
- **Playback sheet**: Fixed viewport bottom, swipe-down (>80px) adds `.sheet-dismissed`. Brown bg (`var(--accent)`), gold controls.
- **Per-ayah sections**: `renderWordLevel` creates one `.ayah-section` per ayah. `data-ayah-num` lets `updateAudioUI` highlight without re-rendering.
- **Session resume**: `rf_session` localStorage key stores `{pendingIds, total}`. Cleared on complete/back/discard.
- **Onboarding guard**: `rf_onboarding_done` + `rf_has_items` in localStorage. Existing users never see it.
- **Render sleep**: Free tier sleeps after 15min inactivity — first load after sleep is slow (~30s).
