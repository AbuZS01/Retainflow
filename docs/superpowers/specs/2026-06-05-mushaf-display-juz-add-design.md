# Design: Mushaf Flow Display + Bulk Add by Juz

**Date:** 2026-06-05  
**Status:** Approved

---

## Summary

Two features:

1. **Mushaf flow display** — render the Arabic text of a review card as continuous flowing prose with inline ۝ ayah markers, matching the visual experience of reading a physical mushaf.
2. **Bulk add by Juz** — let users add an entire Juz at once by picking a chunk size (5 / 10 / 15 / 20 ayahs), which auto-creates multiple items without manual range entry.

---

## Feature 1: Mushaf Flow Display

### What changes

`renderCardContent()` in `frontend/app.js` currently renders each ayah as a stacked block (`ar-line` class). It will be changed to render all ayahs as a single inline-flowing Arabic paragraph.

Each ayah is followed by its ۝ marker and Arabic-script numeral (e.g. ۝١, ۝٢) inline. This matches how ayahs are separated in a printed mushaf.

Ayah numbers are derived from the item ID at render time — `surah-2-ayat-1-10` → ayahs 1–10 — so no extra data is needed from the server.

Word masking is preserved: each Arabic word is still wrapped in a `<span>` so the hide/reveal mechanic continues to work. The spans just flow inline instead of being stacked.

The small Arabic preview shown in the add screen (before confirming a new item) is also updated to use the same flowing style.

### What does NOT change

- Content storage format in the DB (`arabic\nenglish\n\narabic\nenglish...`)
- API responses
- English translation rendering
- Word masking / hide mechanic
- Any backend code

---

## Feature 2: Bulk Add by Juz

### UI

A **"By Juz" tab** is added to the add view alongside the existing search/starter-pack flow. It contains:

- A **Juz dropdown** (1–30), labelled with the Juz number and its start/end surahs (e.g. "Juz 1 · Al-Fatiha – Al-Baqarah 141").
- A **chunk size selector** — four toggle buttons: `5` / `10` / `15` / `20` (ayahs per item). The last-used value is persisted in `localStorage` under `rf_juz_chunk`.
- An **Add button** that triggers batch creation.
- During creation: a progress label ("Adding item 3 of 8…").
- On completion: a summary toast ("8 items added").

### Logic (all client-side)

A `JUZ_BOUNDARIES` constant in `app.js` defines the 30 Juz start points as `{ juz, surah, ayah }` entries. Juz end is inferred from the next entry (Juz 30 ends at 114:6).

On add:
1. Enumerate every ayah in the selected Juz, grouped by surah.
2. Within each surah, slice into chunks of N ayahs. The last chunk in a surah takes the remaining ayahs (may be fewer than N). Chunks never span surah boundaries — this preserves the existing `surah-X-ayat-FROM-TO` item ID format.
3. Call `POST /api/items` for each chunk sequentially.
4. On `LIMIT_REACHED` error, stop and report how many were added.

No new API endpoints are required.

### Free tier limit

Raised from **5 to 50 items** in `database.ts`. This accommodates 2–3 Juzs at any chunk size.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/app.js` | `renderCardContent()` — inline flow rendering; add-screen preview update; `JUZ_BOUNDARIES` constant; By Juz tab UI + batch add logic |
| `frontend/style.css` | Styles for ۝ marker, By Juz tab, chunk size buttons; bump SW cache version comment |
| `frontend/sw.js` | Bump cache name (e.g. `retainflow-v25`) |
| `backend/src/database.ts` | Change free tier limit from 5 to 50 |

No changes to `server.ts`, `engine.ts`, or the DB schema.

---

## Out of Scope

- Rub' al-hizb or page-based splitting
- Intensive day / override-schedule mode
- Cross-surah chunk items
- Any auth or upgrade flow changes
