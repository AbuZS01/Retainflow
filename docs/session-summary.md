# muraja'ah — Session Summary

## What It Is

A mobile-first PWA for Quran memorisation using the SM-2 spaced repetition algorithm. Tracks ayah ranges, schedules reviews, and helps hafidh maintain their hifz. Previously called "RetainFlow".

**Server:** `cd ~/Retainflow/backend && npm run dev` → `http://localhost:3000`
**iPhone:** `$env:HOST="0.0.0.0"; npm run dev` then visit `http://192.168.1.204:3000` from Safari

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 20, TypeScript 5, Fastify 5, better-sqlite3 v12 |
| Plugins | `@fastify/cors`, `@fastify/static`, `@fastify/compress` |
| Testing | Vitest v2 — 37 tests, all passing |
| Frontend | Vanilla HTML / CSS / JS, PWA (manifest + service worker) |
| Fonts | Amiri Quran (Arabic), Cormorant Garamond (UI) |
| DB | SQLite WAL mode, FTS5 for Quran search, seeded with full Quran |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users` | Create/ensure user |
| POST | `/api/items` | Add item (auto-creates user; 5-item free tier) |
| GET | `/api/items/:userId` | Get due items |
| GET | `/api/items/:userId/all` | Get all items (queue view + upcoming strip) |
| PUT | `/api/items/:itemId/review` | Submit review (`quality` + `user_id` required in body) |
| DELETE | `/api/items/:itemId` | Delete item (`user_id` required in body) |
| GET | `/api/stats/:userId` | Stats + review log |
| PUT | `/api/items/:itemId/notes` | Save notes (`user_id` required in body) |
| PUT | `/api/items/:itemId/snooze` | Snooze to tomorrow (`user_id` required in body) |
| GET | `/api/quran/search?q=` | FTS5 Quran search |
| GET | `/api/quran/:surah/:from/:to` | Get ayah range |

**Important:** review, delete, notes, and snooze all now require `user_id` in the request body.

---

## File-by-File State

### `backend/src/server.ts`
- Full Fastify REST API
- `bodyLimit: 600_000` on Fastify instance
- CORS locked to `ALLOWED_ORIGINS` env var (defaults to localhost)
- Gzip compression via `@fastify/compress`
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

### `frontend/index.html`
Full SPA with views: `view-landing`, `view-dashboard`, `view-add`, `view-review`, `view-complete`, `view-queue`, `view-stats`, plus `profile-overlay` and `#bottom-nav`.

**Review bottom dock structure (added this session):**
```html
<div class="review-bottom-dock">
  <div class="rating-key-wrap">
    <span class="dock-label">How did it go?</span>
    <button id="rating-key-btn" aria-label="Rating key" aria-expanded="false">ⓘ</button>
    <div id="rating-key-popover" class="rating-key-popover">
      <div class="rk-row"><span class="rk-dot rk-forgot"></span><span class="rk-label">Forgot</span><span class="rk-days" id="rk-days-forgot">—</span></div>
      <!-- hard / good / easy rows -->
    </div>
  </div>
  <div class="quality-btns">...</div>
  <button id="snooze-btn">...</button>
</div>
```

### `frontend/style.css`
- SW cache comment: `retainflow-v21`
- Light theme: `--bg: #fdf8e1`, `--accent: #7a5900`; dark: `--accent: #c9a227`
- `cursor: pointer` on `.lp-cta-btn` (iOS click event fix inside scroll container)
- Rating key CSS block: `.rating-key-wrap` (position:relative, flex), `.rating-key-btn` (ghost circle), `.rating-key-popover` (display:none → .open:display:block, position:absolute, z-index:101), `.rk-row/.rk-dot/.rk-label/.rk-days`
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

### `frontend/sw.js`
- Cache name: `retainflow-v21`
- Standard `c.addAll(SHELL)` on install (server sends `no-cache` for JS/CSS so SW always gets fresh files)
- Network-first for `/api/`, cache-first for shell assets

---

## Tests

**37 tests, all passing.**

```bash
cd ~/Retainflow/backend && npx vitest run
```

---

## Recent Git Log

```
153ed74 security: CSP header, bodyLimit, innerHTML→DOM in profiles, LIKE wildcard escape, updateNotes/snoozeItem ownership check
7fddc3e simplify: PRAGMA user_version migrations, requireUserId helper, previewIntervals fromEntries, remove redundant SW no-store
d4378c4 fix: SW fetches assets with no-store on install; serve app.js+style.css with no-cache headers
a4348bd fix: composite primary key (user_id, item_id) — multiple users can now track the same surah range
6b0bd14 fix: auto-create user on addItem, remove debug code, bump SW cache to v20
23aeb15 fix: add cursor:pointer to lp-cta-btn for iOS click events in scroll container
15f2ae0 fix: polyfill crypto.randomUUID for iOS < 15.4, bump SW cache to v18
239cdf6 feat: rename app to muraja'ah, bump SW cache to v17
1eaea97 fix(review-key): close popover when advancing to next card
e6b119c feat(review-key): compute and display per-card intervals in popover
```

---

## Uncommitted Changes

None — working tree is clean.

---

## What Still Needs Doing

| Item | Priority | Notes |
|------|----------|-------|
| Dashboard item labels | Medium | Shows raw `surah-1-ayat-1-7` instead of "Al-Fatiha · 1–7". Queue view already has friendly names — same parsing logic needs applying to dashboard `.item-row` labels |
| Rate limiting | Medium | No `@fastify/rate-limit` yet — DoS risk on search/add. Add `app.register(rateLimit, { max: 60, timeWindow: '1 minute' })` |
| `og-image.png` (1200×630px) | Medium | Referenced in OG/Twitter meta tags but file missing |
| Production deployment | Medium | No Vercel/deployment config. Domain `retainflow.app` still in meta tags — update to muraja'ah domain when ready |
| Auth on GET user endpoints | Low | `/api/items/:userId` + `/api/stats/:userId` return data to any caller who knows a userId — acceptable for anonymous model but documented risk |
| Upgrade flow | Low | `alert('Upgrade coming soon!')` placeholder in `app.js` |
| `sitemap.xml` | Low | `robots.txt` references it but file missing |
| Clean up committed junk | Low | `.superpowers/` brainstorm artifacts, `New Text Document.txt`, `server_output.txt`, `server_error.txt` are committed — add to `.gitignore` and remove |

---

## Key Architecture Decisions

- **Anonymous UUIDs**: No server-side auth. `user_id` is a UUID in `localStorage`. It is both identity and credential.
- **Composite PK**: `PRIMARY KEY (user_id, item_id)` so multiple profiles can independently track the same surah.
- **PRAGMA user_version**: Migration gates are O(1) version checks, not `PRAGMA table_info` on every startup.
- **SW + no-cache**: Service worker caches shell. Server sends `no-cache` for JS/CSS so SW always fetches fresh on install. Fonts/images keep `max-age=86400`.
- **iOS**: `generateUUID()` polyfill for <15.4; `cursor: pointer` required on all interactive elements inside `-webkit-overflow-scrolling: touch` containers or iOS drops click events silently.
