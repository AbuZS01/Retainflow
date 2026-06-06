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
| Testing | Vitest v2 — 48 tests, all passing |
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
| PUT | `/api/items/:itemId/undo-review` | Undo last review (`user_id` + `prev_state` required) |
| PUT | `/api/items/:itemId/range` | Edit ayah range (`user_id`, `surah`, `from`, `to` required) |
| DELETE | `/api/items/:itemId` | Delete item (`user_id` required in body) |
| GET | `/api/stats/:userId` | Stats + review log |
| PUT | `/api/items/:itemId/notes` | Save notes (`user_id` required in body) |
| PUT | `/api/items/:itemId/snooze` | Snooze (`user_id` + optional `days`: 1/3/7/14, default 1) |
| GET | `/api/quran/search?q=` | FTS5 Quran search — rate limited 10/min |
| GET | `/api/quran/:surah/:from/:to` | Get ayah range |

**Important:** review, delete, notes, snooze, undo-review, range-edit all require `user_id` in the request body.
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
- `requireUserId(user_id, reply)` helper — typed guard used by review/delete/notes/snooze/undo/range endpoints

### `backend/src/database.ts`
- Tables: `users`, `items` (composite PK `(user_id, item_id)`), `review_log`, `quran_ayahs` (FTS5)
- **Schema migrations guarded by `PRAGMA user_version`:** v0→1 (M1), v1→2 (M2)
- **Free tier: 50 items max**
- `addItem()` uses `INSERT OR IGNORE` + checks `changes === 0` → throws `DUPLICATE_ITEM`
- `renameItem(db, userId, oldItemId, newItemId, newContent)` — transaction-wrapped insert+delete, preserves SM-2 state, throws `ITEM_NOT_FOUND` / `DUPLICATE_ITEM`
- `undoReview(db, userId, itemId, prevState)` — transaction-wrapped: restores SM-2 state + deletes last review_log entry
- `snoozeItem(db, userId, itemId, days=1)` — accepts days param (1/3/7/14)
- FTS5 LIKE fallback for search
- `seedQuranIfEmpty(db)` — seeds 6236 ayahs on first boot

### `frontend/index.html`
Full SPA with views: `view-landing`, `view-dashboard`, `view-add`, `view-review`, `view-complete`, `view-queue`, `view-stats`, plus `profile-overlay` and `#bottom-nav`.

- **`#desktop-gate`** — shown via CSS on non-touch desktop, contains QR code
- **`#playback-sheet`** — fixed bottom sheet for audio playback
- **`#resume-banner`** — shown on dashboard when a session was interrupted
- **`#edit-range-modal`** — bottom sheet modal for editing ayah range of a queue item
- **`#snooze-sheet`** — bottom sheet with 4 snooze duration options
- **`#onboarding-overlay`** — *(in UX/UI plan, not yet built)*
- Difficulty pills: "Know it but rusty" / "Just memorised" / "Know it well" with `<span class="diff-hint">` showing first review timing. Layout: 2-column grid, "Know it well" spans full width.
- Queue view has `#queue-search` filter input above `#queue-content`
- Profile panel has QR sync section (`#sync-qr-btn`, `#sync-qr-wrap`)
- Juz section has `#juz-single-wrap` — "Track Juz N as one item" button

### `frontend/style.css`
- SW cache comment: `retainflow-v33`
- Light theme: `--bg: #fdf8e1`, `--accent: #7a5900`; dark: `--accent: #c9a227`
- Rating buttons: `padding: .6rem .5rem; font-size: .9rem` (portrait); 4-column row in landscape
- `.difficulty-pills`: `grid-template-columns: 1fr 1fr`; last pill `grid-column: 1 / -1`
- `.toast` / `.toast-show`: fixed bottom, slides up, auto-dismisses
- `.resume-banner`: gold border, flex row with Resume/Discard buttons
- `.modal-overlay` / `.modal-panel`: fixed full-screen overlay, panel slides from bottom
- `.snooze-sheet` / `.snooze-sheet-inner`: same pattern as modal
- `.sync-qr-wrap`: column flex, hidden by default
- `.juz-review-summary`: centered card for juz review display
- Z-index stack: bottom-nav=90, review overlay=100, rating-key popover=101, profile overlay=110, playback-sheet=120, snooze-sheet=130, modal-overlay=150

### `frontend/app.js` (~2100 lines)

| Feature | Detail |
|---------|--------|
| Session helpers | `saveSession()`, `clearSession()`, `getSavedSession()` — localStorage key `rf_session` |
| QR sync | `handleSyncParam()` IIFE on load — reads `?sync=UUID`, imports as profile, cleans URL |
| `submitReview(quality)` | Captures `prevState` + `undoItemId` before API call; shows 5s undo toast after rating |
| Undo toast | Inline button in toast → `PUT /api/items/:id/undo-review` → `loadDashboard()` |
| `openEditModal(itemId)` | Shows edit-range modal populated with current surah/from/to |
| Edit save handler | `PUT /api/items/:id/range` → reloads queue on success |
| Snooze sheet | `snooze-btn` opens sheet; `.snooze-option` buttons call snooze with `days` |
| Queue search | `queueAllItems` stores all items; input filters by `prettyItemId()` |
| `addSingleJuzItem(juzNum)` | POSTs `juz-N` with empty content; handles 201/409/403 |
| `prettyItemId(id)` | Handles `juz-N` → "Juz N"; `surah-X-ayat-Y-Z` → "Surah · Y–Z" |
| `startReview(item)` | Juz items: renders `.juz-review-summary` with surah list; non-juz: normal flow |
| `initAudioForItem(itemId)` | Early return guard for `juz-\d+` items |
| Resume banner | `loadDashboard` shows banner if `rf_session` has pending items |
| Resume/Discard | `resume-btn` filters due items to saved pendingIds; `resume-discard-btn` clears session |
| `showToast(html, ms)` | Creates/reuses `#app-toast` div; adds `.toast-show`; auto-removes after ms |
| Upgrade flow | `upgrade-btn` → `showToast()` with mailto link (no modal) |

### `frontend/sw.js`
- Cache name: `retainflow-v33`
- Network-first for `/api/`, cache-first for shell assets

### `Dockerfile` (repo root)
- Multi-stage: `node:20-slim` builder + production image, both `--platform=linux/amd64`
- CMD: `node backend/dist/server.js`

### `fly.toml` (repo root)
- App: `amir-buoyant-coral-631`, region `lhr`
- Volume `muraja_data` → `/data`, size 1GB

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

**48 tests, all passing.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

---

## Recent Git Log

```
6146af3 fix: difficulty pills — Know it well on its own row (2+1 grid)
2dd25cf chore: bump SW cache to v32
[various] feat: juz tracking, QR sync, snooze sheet, undo review, edit range, session resume, queue search, difficulty reframe
19eeb33 test: add tests for renameItem, undoReview, extended snooze, new endpoints
afd638f feat: add range-edit, undo-review endpoints; extend snooze with days
4f9ad7e fix: wrap undoReview in transaction
516348c feat: add renameItem, undoReview; extend snoozeItem with days param
```

---

## Uncommitted Changes

None — working tree is clean.

---

## What Still Needs Doing

| Item | Priority | Plan doc |
|------|----------|----------|
| UX/UI polish (5 features) | High | `docs/superpowers/plans/2026-06-06-ux-ui-polish.md` |
| App Store / Play Store | Medium | PWA ready; wrap with Capacitor or TWA |
| Custom domain | Medium | User handling separately |
| `og-image.png` | Done | Live at `/og-image.png` (generated via PowerShell) |
| Upgrade flow | Done | Toast with mailto link |
| `sitemap.xml` | Done | At `/sitemap.xml` |
| Auth on GET user endpoints | Low | Acceptable for anonymous model |

### UX/UI Plan Summary (`2026-06-06-ux-ui-polish.md`)

| Task | Feature | Status |
|------|---------|--------|
| 1 | Review screen: interval hints on rating buttons + ⋯ overflow menu | Pending |
| 2 | Dashboard: circular SVG progress ring replaces flat goal bar | Pending |
| 3 | Add screen: 3-tab layout (Quick add / Browse Juz / Search) | Pending |
| 4 | Typography: full-bleed Arabic card, larger font (2.4rem), refined separators | Pending |
| 5 | Onboarding: level picker → suggested packs → first review | Pending |
| 6 | Cache bump v34 + deploy | Pending |

---

## Key Architecture Decisions

- **Anonymous UUIDs**: No server-side auth. `user_id` is a UUID in `localStorage`. It is both identity and credential.
- **QR sync**: User scans QR code (shown in profile panel) on new device → opens app with `?sync=UUID` → imported as profile. No auth server needed.
- **Composite PK**: `PRIMARY KEY (user_id, item_id)` so multiple profiles can independently track the same surah.
- **item_id formats**: `surah-{N}-ayat-{from}-{to}` for ayah ranges; `juz-{N}` for full-juz tracking (empty content, review shows surah summary).
- **renameItem**: insert new row + delete old in a transaction — preserves SM-2 state when editing range.
- **undoReview**: transaction-wrapped UPDATE + DELETE of last log entry — atomic, safe.
- **PRAGMA user_version**: Migration gates are O(1) version checks.
- **SW + no-cache**: SW caches shell. Server sends `no-cache` for JS/CSS.
- **Script placement**: `app.js` must come after `<nav id="bottom-nav">` in the HTML.
- **Docker + better-sqlite3**: `**/node_modules` in `.dockerignore` is critical.
- **Fly.io auto-seed**: `seedQuranIfEmpty()` seeds 6236 ayahs on first boot. Idempotent.
- **Desktop gate**: Pure CSS media query (`min-width:768px` + `pointer:fine`).
- **Playback sheet**: Fixed viewport bottom, swipe-down (>80px) adds `.sheet-dismissed`. Audio keeps playing.
- **Per-ayah sections**: `renderWordLevel` creates one `.ayah-section` per ayah. `data-ayah-num` lets `updateAudioUI` highlight without re-rendering.
- **Session resume**: `rf_session` localStorage key stores `{pendingIds, total}`. Cleared on complete/back/discard. Banner shown in `loadDashboard`.
