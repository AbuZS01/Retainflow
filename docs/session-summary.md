# RetainFlow — Session Summary

## What RetainFlow Is

A mobile-first PWA for Quran memorisation using the SM-2 spaced repetition algorithm. Tracks ayah ranges, schedules reviews, and helps hafidh maintain their hifz.

**Server:** `cd ~/Retainflow/backend && npm run dev` → `http://localhost:3000`

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
| POST | `/api/items` | Add item (with `initial` difficulty params, 5-item free tier) |
| GET | `/api/items/:userId` | Get due items |
| GET | `/api/items/:userId/all` | Get all items (queue view + upcoming strip) |
| PUT | `/api/items/:itemId/review` | Submit review (with ownership check) |
| DELETE | `/api/items/:itemId` | Delete item (with ownership check) |
| GET | `/api/stats/:userId` | Stats + review log |
| PUT | `/api/items/:itemId/notes` | Save notes (10k char limit) |
| PUT | `/api/items/:itemId/snooze` | Snooze to tomorrow |
| GET | `/api/quran/search?q=` | FTS5 Quran search |
| GET | `/api/quran/:surah/:from/:to` | Get ayah range |

---

## File-by-File State

### `backend/src/server.ts`
- Full Fastify REST API
- CORS locked to `ALLOWED_ORIGINS` env var (defaults to localhost)
- Gzip compression via `@fastify/compress`
- Security headers on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- Cache headers: `no-cache` for `index.html`/`sw.js`, `max-age=86400` for JS/CSS/images, `no-store` for API responses
- Host/port from `process.env.HOST` / `process.env.PORT` (defaults `127.0.0.1:3000`)

### `backend/src/database.ts`
- Tables: `users`, `items` (with `content`, `notes` columns), `review_log`, `quran_ayahs` (FTS5)
- Free tier: 5 items max — `count >= 5` throws `LIMIT_REACHED`
- `addItem()` accepts `InitialDifficulty` params: `interval`, `ease_factor`, `repetitions`, `next_due_date`
- FTS5 injection protection: wraps query in `"..."*` pattern, falls back to LIKE on 0 results

### `frontend/index.html`
Full SPA with the following views:

| View ID | Purpose |
|---------|---------|
| `view-landing` | Marketing landing page — shown on first visit only |
| `view-dashboard` | Due items list, streak chip, start-session button, goal bar, 7-day upcoming strip |
| `view-add` | Starter packs, juz browser, search, range selector with difficulty pills |
| `view-review` | **3-zone full-screen**: `.review-top-bar` / `.review-scroll-area` / `.review-bottom-dock` |
| `view-complete` | Session complete screen with reviewed count + streak |
| `view-queue` | All items grouped by due date |
| `view-stats` | KPI grid, 14-day heatmap, quality breakdown, review log |
| `profile-overlay` | Profile switcher, dark mode toggle, daily notification settings |

Plus `<nav id="bottom-nav">` — 5-tab fixed bottom navigation: **Home · Queue · ＋ · Stats · Profile**

### `frontend/style.css`
- **Light theme (default):** `--bg: #fdf8e1`, `--accent: #7a5900` (darkened for 6.1:1 contrast)
- **Dark theme:** `[data-theme="dark"]` — `--accent: #c9a227`
- `--btn-text` variable: `#fff` light / `#000` dark — all accent-background buttons use this
- iOS safe area: `#app` padding-bottom = `calc(56px + env(safe-area-inset-bottom, 0) + 1rem)`
- **Bottom nav:** `.bottom-nav` fixed at z-index 90, `.nav-tab--add` is elevated accent circle
- **Review full-screen:** `#view-review.active { position: fixed; inset: 0; z-index: 100; display: flex !important }`
- **Review zones:** `.review-top-bar` (fixed header), `.review-scroll-area` (flex:1, scrollable), `.review-bottom-dock` (pinned buttons)
- Arabic text: `font-family: 'Amiri Quran'`, `.ar-line`, `.ar-word`, `.ar-faded`, `.ar-placeholder`
- **Z-index stack:** bottom-nav = 90 · review overlay = 100 · profile overlay = 110
- Service worker cache: `retainflow-v15`

### `frontend/app.js` (~1500 lines)

| Feature | Detail |
|---------|--------|
| Auth | No login — anonymous UUID per device in `localStorage` |
| Profiles | Multiple profiles via `rf_profiles` array |
| Dark mode | Follows OS preference, user can override; toggle in profile panel |
| SM-2 review | `submitReview()` → PUT /review, advances session queue |
| Swipe gestures | Left = forgot, right = easy on `.review-card` |
| Keyboard shortcuts | 1/2/3/4 for forgot/hard/good/easy during review |
| Arabic display | `renderWordLevel()`: full / first-only / hidden modes with placeholder chips |
| Audio | everyayah.com CDN, 4 reciters, sequential ayah playback |
| Notifications | Web Notifications API with daily auto-reschedule |
| Streak | localStorage tracking, shown in header chip |
| Daily goal | Inline editor, progress bar |
| Upcoming strip | Fetches /all, counts reviews per day for 7 days |
| Difficulty calibration | 3 pills (rusty / fresh / solid) set initial SM-2 params on add |
| Bottom nav | `NAV_HIDDEN_VIEWS = Set(['view-review', 'view-landing', 'view-complete'])` |
| Tab state | `setActiveTab(action)` called at start of each view-loading function |

### `frontend/sw.js`
- Cache name: `retainflow-v15`
- Network-first for `/api/` calls, cache-first for shell assets
- Cached shell: `/`, `/index.html`, `/style.css`, `/app.js`, `/manifest.json`

### `frontend/manifest.json`
- PWA descriptor with maskable icons, `orientation: "portrait"`, `categories: ["education"]`
- Shortcuts: "Start Review" and "Add Ayat"

### `frontend/robots.txt`
- Allows all crawlers, blocks `/api/`, references sitemap URL

---

## Lighthouse Scores

| Category | Score |
|----------|-------|
| Performance | 88 |
| Accessibility | 98 |
| Best Practices | 96 |
| SEO | 100 |

Gzip active, no render-blocking resources, all colour contrast issues fixed.

---

## Tests

**37 tests, all passing.**

```bash
cd ~/Retainflow/backend && npx vitest run
```

| File | Tests |
|------|-------|
| `tests/engine.test.ts` | 13 — SM-2 algorithm |
| `tests/database.test.ts` | 15 — DB layer + freemium limit |
| `tests/server.test.ts` | 9 — API endpoints |

---

## Recent Git Log

```
d967a71 fix(mobile): hide bottom nav on session-complete screen
fd2324c feat(mobile): wire bottom nav JS and remove old topbar button listeners
4844f30 fix(mobile): profile-overlay z-index, remove empty body rule, clean media query
8e6e4d2 feat(mobile): bottom nav and full-screen review CSS
10c40bc feat(mobile): restructure HTML for bottom nav and full-screen review
5a7af8c feat: reframe dashboard messaging, welcome-back banner, SM-2 explainer, limit copy
280ca48 feat: raise free tier limit from 3 to 5 items
633afff feat: progressive text hiding, curated starter packs
190d7bc feat: dark mode, session progress bar, session complete screen, haptics, swipe gestures
93883bb feat: remove login screen, auto-generate anonymous user ID on first visit
```

---

## Uncommitted Changes (working tree)

These files have been modified but not committed — they are working and tested but were changed outside a formal commit cycle:

- `backend/src/server.ts` — security headers, cache headers, compress plugin
- `backend/src/database.ts` — InitialDifficulty interface, updated addItem signature
- `backend/scripts/seed-quran.ts` — Quran seeding script
- `frontend/manifest.json` — maskable icons, shortcuts, categories
- `backend/package.json` / `package-lock.json` — @fastify/compress added

To commit all of these:
```bash
cd ~/Retainflow
git add backend/src/server.ts backend/src/database.ts backend/scripts/seed-quran.ts frontend/manifest.json backend/package.json backend/package-lock.json
git commit -m "feat: security headers, gzip compression, manifest polish, initial difficulty params"
```

---

## What Still Needs Doing

| Item | Priority | Notes |
|------|----------|-------|
| Commit uncommitted changes above | High | See section above |
| `og-image.png` (1200×630px) | Medium | Referenced in OG meta tags but file doesn't exist yet |
| Production deployment | Medium | No Vercel/deployment config yet |
| Upgrade flow | Low | `alert('Upgrade coming soon!')` placeholder in `app.js` |
| `sitemap.xml` | Low | `robots.txt` references it but file doesn't exist |
