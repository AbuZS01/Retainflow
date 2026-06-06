# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 8 UX improvements: edit range, undo review, cross-device sync via QR, extended snooze, session resume, queue search, difficulty reframe, and juz-level tracking.

**Architecture:** All backend changes go in `backend/src/database.ts` (new DB functions) and `backend/src/server.ts` (new/modified endpoints). All frontend changes go in `frontend/index.html`, `frontend/app.js`, and `frontend/style.css`. No new files needed. SW cache version bumped at the end.

**Tech Stack:** Node.js 20, TypeScript, Fastify 5, better-sqlite3, Vitest · Vanilla JS/HTML/CSS frontend

---

## Files Modified

| File | Changes |
|------|---------|
| `backend/src/database.ts` | Add `renameItem`, `undoReview`; modify `snoozeItem` to accept `days` param |
| `backend/src/server.ts` | Add `PUT /api/items/:itemId/range`, `PUT /api/items/:itemId/undo-review`; modify snooze endpoint |
| `backend/tests/server.test.ts` | Tests for 3 new/modified endpoints |
| `backend/tests/database.test.ts` | Tests for `renameItem`, `undoReview`, `snoozeItem` with days |
| `frontend/index.html` | Difficulty labels, snooze sheet, queue search input, sync QR section, edit modal, juz "Track as Juz" button |
| `frontend/app.js` | All frontend logic for 8 features |
| `frontend/style.css` | Styles for snooze sheet, edit modal, sync QR, queue search, diff hints |
| `frontend/sw.js` + `style.css` comment | Bump cache version to v32 |

---

## Task 1: DB — `renameItem` (edit range)

**Files:**
- Modify: `backend/src/database.ts`

- [ ] **Step 1: Add `renameItem` function to `database.ts`** after the `deleteItem` function (line 241).

```typescript
export function renameItem(
  db: Db,
  userId: string,
  oldItemId: string,
  newItemId: string,
  newContent: string
): void {
  if (oldItemId === newItemId) return;
  const old = getItem(db, userId, oldItemId);
  if (!old) throw new Error(`ITEM_NOT_FOUND: ${oldItemId}`);
  if (getItem(db, userId, newItemId)) throw new Error('DUPLICATE_ITEM');
  db.transaction(() => {
    db.prepare(
      `INSERT INTO items (user_id, item_id, content, notes, interval, ease_factor, repetitions, next_due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, newItemId, newContent, old.notes, old.interval, old.ease_factor, old.repetitions, old.next_due_date);
    db.prepare('DELETE FROM items WHERE user_id = ? AND item_id = ?').run(userId, oldItemId);
  })();
}
```

- [ ] **Step 2: Add `renameItem` to the import line in `server.ts`** (line 9).

Change:
```typescript
import { initDb, createUser, addItem, getDueItems, getAllItems, getItem, updateItem, deleteItem, searchAyahs, getAyahRange, logReview, getReviewLog, getStats, updateNotes, snoozeItem } from './database.js';
```
To:
```typescript
import { initDb, createUser, addItem, getDueItems, getAllItems, getItem, updateItem, deleteItem, renameItem, searchAyahs, getAyahRange, logReview, getReviewLog, getStats, updateNotes, snoozeItem, undoReview } from './database.js';
```
(Also includes `undoReview` added in Task 2 — do this once.)

---

## Task 2: DB — `undoReview`

**Files:**
- Modify: `backend/src/database.ts`

- [ ] **Step 1: Add `undoReview` to `database.ts`** after `logReview`.

```typescript
export function undoReview(
  db: Db,
  userId: string,
  itemId: string,
  prevState: { interval: number; ease_factor: number; repetitions: number; next_due_date: number }
): void {
  const { changes } = db.prepare(
    `UPDATE items SET interval = ?, ease_factor = ?, repetitions = ?, next_due_date = ?
     WHERE user_id = ? AND item_id = ?`
  ).run(prevState.interval, prevState.ease_factor, prevState.repetitions, prevState.next_due_date, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
  db.prepare(
    `DELETE FROM review_log WHERE id = (
       SELECT id FROM review_log WHERE item_id = ? AND user_id = ? ORDER BY reviewed_at DESC LIMIT 1
     )`
  ).run(itemId, userId);
}
```

---

## Task 3: DB — `snoozeItem` with `days` param

**Files:**
- Modify: `backend/src/database.ts`

- [ ] **Step 1: Update `snoozeItem` signature** (currently line 250–254).

Replace:
```typescript
export function snoozeItem(db: Db, userId: string, itemId: string): void {
  const tomorrow = Date.now() + 86_400_000;
  const { changes } = db.prepare('UPDATE items SET next_due_date = ? WHERE user_id = ? AND item_id = ?').run(tomorrow, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}
```
With:
```typescript
export function snoozeItem(db: Db, userId: string, itemId: string, days = 1): void {
  const future = Date.now() + days * 86_400_000;
  const { changes } = db.prepare('UPDATE items SET next_due_date = ? WHERE user_id = ? AND item_id = ?').run(future, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}
```

---

## Task 4: Server — new and modified endpoints

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Add `PUT /api/items/:itemId/range` endpoint** — insert after the DELETE endpoint (after line 154).

```typescript
// PUT /api/items/:itemId/range
app.put('/api/items/:itemId/range', async (req, reply) => {
  const { itemId } = req.params as { itemId: string };
  const { user_id, surah, from, to } = req.body as {
    user_id?: string; surah?: number; from?: number; to?: number;
  };
  if (!requireUserId(user_id, reply)) return;
  if (
    typeof surah !== 'number' || typeof from !== 'number' || typeof to !== 'number' ||
    surah < 1 || surah > 114 || from < 1 || to < from || to - from > 300
  ) return reply.status(400).send({ error: 'invalid range' });

  const newItemId = `surah-${surah}-ayat-${from}-${to}`;
  const ayahs = getAyahRange(db, surah, from, to);
  const newContent = ayahs.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
  try {
    renameItem(db, user_id, itemId, newItemId, newContent);
    return reply.send({ ok: true, item_id: newItemId });
  } catch (err: any) {
    if (err.message.startsWith('ITEM_NOT_FOUND'))
      return reply.status(404).send({ error: 'ITEM_NOT_FOUND' });
    if (err.message === 'DUPLICATE_ITEM')
      return reply.status(409).send({ error: 'DUPLICATE_ITEM', message: 'That range is already tracked.' });
    throw err;
  }
});
```

- [ ] **Step 2: Add `PUT /api/items/:itemId/undo-review` endpoint** — insert after the review endpoint.

```typescript
// PUT /api/items/:itemId/undo-review
app.put('/api/items/:itemId/undo-review', async (req, reply) => {
  const { itemId } = req.params as { itemId: string };
  const { user_id, prev_state } = req.body as {
    user_id?: string;
    prev_state?: { interval: number; ease_factor: number; repetitions: number; next_due_date: number };
  };
  if (!requireUserId(user_id, reply)) return;
  if (
    !prev_state ||
    typeof prev_state.interval !== 'number' ||
    typeof prev_state.ease_factor !== 'number' ||
    typeof prev_state.repetitions !== 'number' ||
    typeof prev_state.next_due_date !== 'number'
  ) return reply.status(400).send({ error: 'prev_state required with interval, ease_factor, repetitions, next_due_date' });

  try {
    undoReview(db, user_id, itemId, prev_state);
    return reply.send({ ok: true });
  } catch (err: any) {
    if (err.message.startsWith('ITEM_NOT_FOUND'))
      return reply.status(404).send({ error: 'ITEM_NOT_FOUND' });
    throw err;
  }
});
```

- [ ] **Step 3: Update `PUT /api/items/:itemId/snooze`** to accept `days`.

Replace the handler body:
```typescript
app.put('/api/items/:itemId/snooze', async (req, reply) => {
  const { itemId } = req.params as { itemId: string };
  const { user_id, days = 1 } = req.body as { user_id?: string; days?: number };
  if (!requireUserId(user_id, reply)) return;
  if (![1, 3, 7, 14].includes(days))
    return reply.status(400).send({ error: 'days must be 1, 3, 7, or 14' });
  snoozeItem(db, user_id, itemId, days);
  return reply.send({ ok: true });
});
```

---

## Task 5: Backend tests

**Files:**
- Modify: `backend/tests/database.test.ts`
- Modify: `backend/tests/server.test.ts`

- [ ] **Step 1: Add database tests** — append to `backend/tests/database.test.ts`.

```typescript
describe('renameItem', () => {
  it('preserves SM-2 state while changing item_id and content', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename');
    addItem(db, 'u-rename', 'surah-1-ayat-1-7', 'old content', { interval: 5, ease_factor: 2.1, repetitions: 3 });
    renameItem(db, 'u-rename', 'surah-1-ayat-1-7', 'surah-1-ayat-1-10', 'new content');
    const old = getItem(db, 'u-rename', 'surah-1-ayat-1-7');
    const updated = getItem(db, 'u-rename', 'surah-1-ayat-1-10');
    expect(old).toBeNull();
    expect(updated?.interval).toBe(5);
    expect(updated?.ease_factor).toBeCloseTo(2.1);
    expect(updated?.repetitions).toBe(3);
    expect(updated?.content).toBe('new content');
  });

  it('throws ITEM_NOT_FOUND for unknown item', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename2');
    expect(() => renameItem(db, 'u-rename2', 'nope', 'new', '')).toThrow('ITEM_NOT_FOUND');
  });

  it('throws DUPLICATE_ITEM if new id already exists', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename3');
    addItem(db, 'u-rename3', 'item-a', '');
    addItem(db, 'u-rename3', 'item-b', '');
    expect(() => renameItem(db, 'u-rename3', 'item-a', 'item-b', '')).toThrow('DUPLICATE_ITEM');
  });
});

describe('undoReview', () => {
  it('restores SM-2 state and removes last log entry', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-undo');
    addItem(db, 'u-undo', 'item-1', '', { interval: 1, ease_factor: 2.5, repetitions: 0 });
    const prev = { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: Date.now() };
    logReview(db, 'item-1', 'u-undo', 'good');
    updateItem(db, 'u-undo', 'item-1', { interval: 6, ease_factor: 2.5, repetitions: 1, next_due_date: Date.now() + 6 * 86_400_000 });
    undoReview(db, 'u-undo', 'item-1', prev);
    const restored = getItem(db, 'u-undo', 'item-1');
    expect(restored?.interval).toBe(1);
    expect(restored?.repetitions).toBe(0);
    const log = getReviewLog(db, 'u-undo', 10);
    expect(log.length).toBe(0);
  });
});

describe('snoozeItem with days', () => {
  it('snoozes by the given number of days', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-snooze2');
    addItem(db, 'u-snooze2', 'item-snz', '');
    const before = Date.now();
    snoozeItem(db, 'u-snooze2', 'item-snz', 7);
    const item = getItem(db, 'u-snooze2', 'item-snz');
    expect(item!.next_due_date).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 100);
  });
});
```

- [ ] **Step 2: Add `renameItem`, `undoReview`, `snoozeItem` to the database test import line.**

The import at the top of `database.test.ts` should include all new exports:
```typescript
import { initDb, createUser, addItem, getItem, getDueItems, updateItem, deleteItem, logReview, getReviewLog, renameItem, undoReview, snoozeItem } from '../src/database.js';
```

- [ ] **Step 3: Add server tests** — append to `backend/tests/server.test.ts`.

```typescript
describe('PUT /api/items/:itemId/range', () => {
  it('renames item and returns new item_id', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-editrange' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-editrange', item_id: 'surah-1-ayat-1-3' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-1-ayat-1-3/range',
      payload: { user_id: 'u-editrange', surah: 1, from: 1, to: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).item_id).toBe('surah-1-ayat-1-5');
  });

  it('returns 400 for invalid range', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-1-ayat-1-3/range',
      payload: { user_id: 'u-editrange', surah: 1, from: 5, to: 3 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/items/:itemId/undo-review', () => {
  it('restores item state', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-undo2' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-undo2', item_id: 'surah-2-ayat-1-5' } });
    await app.inject({ method: 'PUT', url: '/api/items/surah-2-ayat-1-5/review', payload: { user_id: 'u-undo2', quality: 'easy' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-2-ayat-1-5/undo-review',
      payload: { user_id: 'u-undo2', prev_state: { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: 0 } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 if prev_state missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-2-ayat-1-5/undo-review',
      payload: { user_id: 'u-undo2' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/items/:itemId/snooze with days', () => {
  it('accepts days=7', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-snoozedays' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-snoozedays', item_id: 'surah-3-ayat-1-5' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-3-ayat-1-5/snooze',
      payload: { user_id: 'u-snoozedays', days: 7 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for invalid days', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-3-ayat-1-5/snooze',
      payload: { user_id: 'u-snoozedays', days: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 4: Run tests.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

Expected: all tests pass (37 existing + ~10 new).

- [ ] **Step 5: Commit backend.**

```powershell
git add backend/src/database.ts backend/src/server.ts backend/tests/database.test.ts backend/tests/server.test.ts
git commit -m "feat: add renameItem, undoReview, extended snooze endpoints"
```

---

## Task 6: Frontend — difficulty reframe (#7)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Update difficulty pill labels and add `data-hint` in `index.html`** (currently lines 332–336).

Replace:
```html
<div class="difficulty-picker">
  <p class="difficulty-label">How well do you know this?</p>
  <div class="difficulty-pills">
    <button class="diff-pill" data-difficulty="rusty">Very rusty</button>
    <button class="diff-pill diff-pill--active" data-difficulty="fresh">Freshly memorised</button>
    <button class="diff-pill" data-difficulty="solid">Know it well</button>
  </div>
</div>
```
With:
```html
<div class="difficulty-picker">
  <p class="difficulty-label">How well do you know this right now?</p>
  <div class="difficulty-pills">
    <button class="diff-pill" data-difficulty="rusty">Know it but rusty<span class="diff-hint">First review: today</span></button>
    <button class="diff-pill diff-pill--active" data-difficulty="fresh">Just memorised<span class="diff-hint">First review: today</span></button>
    <button class="diff-pill" data-difficulty="solid">Know it well<span class="diff-hint">First review: in 7 days</span></button>
  </div>
</div>
```

- [ ] **Step 2: Add `.diff-hint` CSS** — append to `style.css`.

```css
.diff-hint { display: block; font-size: .72rem; font-weight: 400; opacity: .7; margin-top: 2px; }
```

---

## Task 7: Frontend — queue search/filter (#6)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add search input to queue view** in `index.html` (currently lines 413–416).

Replace:
```html
<div id="view-queue" class="view">
  <h2>My Queue</h2>
  <p class="add-subhead">All your tracked ayah ranges, grouped by when they need review.</p>
  <div id="queue-content" class="queue-content"></div>
</div>
```
With:
```html
<div id="view-queue" class="view">
  <h2>My Queue</h2>
  <p class="add-subhead">All your tracked ayah ranges, grouped by when they need review.</p>
  <input id="queue-search" type="search" placeholder="Filter by surah…" class="queue-search-input" autocomplete="off" />
  <div id="queue-content" class="queue-content"></div>
</div>
```

- [ ] **Step 2: Add CSS for queue search input** — append to `style.css`.

```css
.queue-search-input { width: 100%; padding: .6rem .9rem; border: 1px solid var(--border); border-radius: 10px; background: var(--card-bg); color: var(--text); font-size: .95rem; margin-bottom: 1rem; }
.queue-search-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
```

- [ ] **Step 3: Add queue filter logic in `app.js`** — add a `queueAllItems` variable and wire up the search input. Find the `loadQueue` function and replace it:

```javascript
let queueAllItems = [];

async function loadQueue() {
  setActiveTab('queue');
  showView('view-queue');
  document.getElementById('queue-search').value = '';
  const { status, data } = await apiFetch('GET', `/api/items/${state.userId}/all`);
  if (status !== 200 || !Array.isArray(data)) return;
  queueAllItems = data;
  renderQueue(queueAllItems);
}
```

- [ ] **Step 4: Wire up the search input** — add event listener near the bottom of `app.js` (alongside other event listeners):

```javascript
document.getElementById('queue-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderQueue(q
    ? queueAllItems.filter(i => prettyItemId(i.item_id).toLowerCase().includes(q))
    : queueAllItems
  );
});
```

---

## Task 8: Frontend — session resume (#5)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add resume banner to dashboard in `index.html`** — insert before `#limit-banner` (before line 250).

```html
<div id="resume-banner" class="resume-banner hidden">
  <span id="resume-label">Resume session</span>
  <div class="resume-actions">
    <button id="resume-btn" class="btn-resume">Resume</button>
    <button id="resume-discard-btn" class="resume-discard">Discard</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS** — append to `style.css`.

```css
.resume-banner { background: var(--card-bg); border: 1px solid var(--accent); border-radius: 10px; padding: .75rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .75rem; }
.resume-banner.hidden { display: none; }
.resume-actions { display: flex; gap: .5rem; align-items: center; }
.btn-resume { background: var(--accent); color: var(--btn-text); border: none; border-radius: 8px; padding: .4rem .9rem; font-size: .85rem; font-weight: 600; cursor: pointer; }
.resume-discard { background: none; border: none; color: var(--sub); font-size: .85rem; cursor: pointer; text-decoration: underline; }
```

- [ ] **Step 3: Add session save/restore logic in `app.js`** — add these helper functions near the state section (after the `state` object):

```javascript
function saveSession() {
  if (state.dueItems.length === 0) return;
  localStorage.setItem('rf_session', JSON.stringify({
    pendingIds: state.dueItems.map(i => i.item_id),
    total: state.sessionTotal,
  }));
}

function clearSession() {
  localStorage.removeItem('rf_session');
}

function getSavedSession() {
  try { return JSON.parse(localStorage.getItem('rf_session') ?? 'null'); } catch { return null; }
}
```

- [ ] **Step 4: Call `saveSession()` when a session starts** — in the `startReview` function, find the block that sets `state.sessionTotal` and `state.sessionDone` (currently inside `if (!state.reviewItem)` guard). Add `saveSession()` right after:

```javascript
if (!state.reviewItem) {
  state.sessionTotal = state.dueItems.length;
  state.sessionDone  = 0;
  saveSession();
}
```

- [ ] **Step 5: Update session on each review in `submitReview`** — after `state.dueItems = state.dueItems.filter(...)`, add:

```javascript
if (state.dueItems.length > 0) saveSession();
else clearSession();
```

- [ ] **Step 6: Clear session on back button and session complete** — in the `review-back-btn` listener add `clearSession()`:

```javascript
document.getElementById('review-back-btn').addEventListener('click', () => {
  stopAudio();
  clearSession();
  loadDashboard();
});
```

And in `showSessionComplete` (find the function) add `clearSession()` at the start.

- [ ] **Step 7: Show resume banner in `loadDashboard`** — inside `loadDashboard`, after the due items are loaded, add this block (before the existing code that shows/hides the start-session button):

```javascript
// Resume banner
const saved = getSavedSession();
const resumeBanner = document.getElementById('resume-banner');
if (saved && saved.pendingIds?.length > 0) {
  const left = saved.pendingIds.length;
  document.getElementById('resume-label').textContent =
    `Session in progress — ${left} item${left !== 1 ? 's' : ''} left`;
  resumeBanner.classList.remove('hidden');
} else {
  resumeBanner.classList.add('hidden');
}
```

- [ ] **Step 8: Wire up resume and discard buttons** — add near other event listeners:

```javascript
document.getElementById('resume-btn').addEventListener('click', () => {
  const saved = getSavedSession();
  if (!saved || !saved.pendingIds?.length) return;
  const pendingSet = new Set(saved.pendingIds);
  state.dueItems = state.dueItems.filter(i => pendingSet.has(i.item_id));
  state.sessionTotal = saved.total;
  state.sessionDone  = saved.total - state.dueItems.length;
  if (state.dueItems.length > 0) startReview(state.dueItems[0]);
});

document.getElementById('resume-discard-btn').addEventListener('click', () => {
  clearSession();
  document.getElementById('resume-banner').classList.add('hidden');
});
```

---

## Task 9: Frontend — edit range UI (#1)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add edit modal to `index.html`** — insert before the closing `</body>` tag.

```html
<!-- Edit range modal -->
<div id="edit-range-modal" class="modal-overlay hidden" role="dialog" aria-label="Edit range">
  <div class="modal-panel">
    <div class="modal-hd">
      <span id="edit-modal-title" class="modal-title">Edit range</span>
      <button id="edit-modal-close" class="btn-icon-sm" aria-label="Close">✕</button>
    </div>
    <p id="edit-modal-surah" class="edit-modal-surah"></p>
    <div class="range-inputs">
      <div class="range-field">
        <label for="edit-range-from">From ayah</label>
        <input id="edit-range-from" type="number" min="1" aria-label="From ayah" />
      </div>
      <div class="range-field">
        <label for="edit-range-to">To ayah</label>
        <input id="edit-range-to" type="number" min="1" aria-label="To ayah" />
      </div>
    </div>
    <div id="edit-range-error" class="error-msg hidden" role="alert"></div>
    <button id="edit-range-save-btn" class="btn-primary" style="margin-top:.75rem;width:100%">Save changes</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS** — append to `style.css`.

```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 150; display: flex; align-items: flex-end; justify-content: center; }
.modal-overlay.hidden { display: none; }
.modal-panel { background: var(--card-bg); border-radius: 16px 16px 0 0; padding: 1.25rem 1rem 2rem; width: 100%; max-width: 480px; }
.modal-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: .75rem; }
.modal-title { font-weight: 600; font-size: 1rem; }
.edit-modal-surah { color: var(--sub); font-size: .88rem; margin-bottom: .75rem; }
```

- [ ] **Step 3: Add edit icon to each queue row in `renderQueue`** — inside the `groupItems.forEach` loop, after `row.appendChild(dueSpan)`, add an edit button:

```javascript
const editBtn = document.createElement('button');
editBtn.className = 'queue-edit-btn';
editBtn.setAttribute('aria-label', 'Edit range');
editBtn.textContent = '✎';
editBtn.dataset.itemId = item.item_id;
editBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openEditModal(item.item_id);
});
row.appendChild(editBtn);
```

- [ ] **Step 4: Add `.queue-edit-btn` CSS** — append to `style.css`.

```css
.queue-edit-btn { background: none; border: none; color: var(--sub); font-size: 1rem; cursor: pointer; padding: .25rem .4rem; border-radius: 6px; }
.queue-edit-btn:hover { color: var(--accent); }
```

- [ ] **Step 5: Add `openEditModal` and save logic in `app.js`** — add near the queue section:

```javascript
let editingItemId = null;

function openEditModal(itemId) {
  editingItemId = itemId;
  const m = itemId.match(/^surah-(\d+)-ayat-(\d+)-(\d+)$/);
  if (!m) return; // juz items not editable this way
  const [, surah, from, to] = m;
  const surahName = SURAHS.find(s => s[0] === parseInt(surah, 10))?.[1] ?? `Surah ${surah}`;
  document.getElementById('edit-modal-surah').textContent = `${surahName} (Surah ${surah})`;
  document.getElementById('edit-range-from').value = from;
  document.getElementById('edit-range-to').value   = to;
  document.getElementById('edit-range-error').classList.add('hidden');
  document.getElementById('edit-range-modal').classList.remove('hidden');
}

document.getElementById('edit-modal-close').addEventListener('click', () => {
  document.getElementById('edit-range-modal').classList.add('hidden');
});

document.getElementById('edit-range-save-btn').addEventListener('click', async () => {
  if (!editingItemId) return;
  const m = editingItemId.match(/^surah-(\d+)-ayat-\d+-\d+$/);
  if (!m) return;
  const surah = parseInt(m[1], 10);
  const from  = parseInt((document.getElementById('edit-range-from') as HTMLInputElement).value, 10);
  const to    = parseInt((document.getElementById('edit-range-to') as HTMLInputElement).value, 10);
  if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
    document.getElementById('edit-range-error').textContent = 'Enter a valid range.';
    document.getElementById('edit-range-error').classList.remove('hidden');
    return;
  }
  const { status, data } = await apiFetch('PUT', `/api/items/${editingItemId}/range`, {
    user_id: state.userId, surah, from, to,
  });
  if (status === 200) {
    document.getElementById('edit-range-modal').classList.add('hidden');
    await loadQueue();
  } else {
    document.getElementById('edit-range-error').textContent = data?.message ?? data?.error ?? 'Error saving.';
    document.getElementById('edit-range-error').classList.remove('hidden');
  }
});
```

Note: Since `app.js` is vanilla JS (not TypeScript), remove the `as HTMLInputElement` casts — just use `document.getElementById('edit-range-from').value`.

---

## Task 10: Frontend — undo review (#2)

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Capture prev state before submitting** — in `submitReview`, add these lines immediately before the `apiFetch` call:

```javascript
async function submitReview(quality) {
  if (!state.reviewItem) return;
  // Capture state before it changes (for undo)
  const prevState = {
    interval:      state.reviewItem.interval,
    ease_factor:   state.reviewItem.ease_factor,
    repetitions:   state.reviewItem.repetitions,
    next_due_date: state.reviewItem.next_due_date,
  };
  const undoItemId = state.reviewItem.item_id;
  stopAudio();
  haptic(25);
  incrementTodayCount();
  await apiFetch('PUT', `/api/items/${state.reviewItem.item_id}/review`, { quality, user_id: state.userId });
  state.sessionDone++;
  state.dueItems = state.dueItems.filter((i) => i.item_id !== state.reviewItem.item_id);
  if (state.dueItems.length > 0) saveSession();
  else clearSession();
  state.reviewItem = null;

  // Show undo toast
  showToast(
    `Marked ${quality} · <button id="undo-review-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline">Undo</button>`,
    5000
  );
  document.getElementById('undo-review-btn')?.addEventListener('click', async () => {
    document.getElementById('app-toast')?.classList.remove('toast-show');
    await apiFetch('PUT', `/api/items/${undoItemId}/undo-review`, {
      user_id: state.userId,
      prev_state: prevState,
    });
    clearSession();
    await loadDashboard();
    showToast('Review undone');
  });

  if (state.dueItems.length === 0) showSessionComplete();
  else startReview(state.dueItems[0]);
}
```

(This replaces the existing `submitReview` function entirely.)

---

## Task 11: Frontend — extended snooze UI (#4)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add snooze options sheet in `index.html`** — find the existing snooze button (in `view-review`) and add the sheet as a sibling. Locate `id="snooze-btn"` and add after the review bottom dock:

```html
<!-- Snooze options sheet -->
<div id="snooze-sheet" class="snooze-sheet hidden" role="dialog" aria-label="Snooze options">
  <div class="snooze-sheet-inner">
    <p class="snooze-sheet-title">Snooze until…</p>
    <button class="snooze-option" data-days="1">Tomorrow</button>
    <button class="snooze-option" data-days="3">In 3 days</button>
    <button class="snooze-option" data-days="7">In 1 week</button>
    <button class="snooze-option" data-days="14">In 2 weeks</button>
    <button id="snooze-cancel-btn" class="snooze-cancel">Cancel</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS** — append to `style.css`.

```css
.snooze-sheet { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 130; display: flex; align-items: flex-end; justify-content: center; }
.snooze-sheet.hidden { display: none; }
.snooze-sheet-inner { background: var(--card-bg); border-radius: 16px 16px 0 0; padding: 1rem 1rem 2rem; width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: .5rem; }
.snooze-sheet-title { font-weight: 600; font-size: .9rem; color: var(--sub); text-align: center; margin-bottom: .25rem; }
.snooze-option { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: .75rem; font-size: 1rem; font-weight: 500; color: var(--text); cursor: pointer; text-align: center; }
.snooze-option:hover { border-color: var(--accent); color: var(--accent); }
.snooze-cancel { background: none; border: none; color: var(--sub); font-size: .9rem; cursor: pointer; text-align: center; padding: .5rem; text-decoration: underline; }
```

- [ ] **Step 3: Replace snooze button handler in `app.js`** — find the existing snooze handler and replace:

```javascript
document.getElementById('snooze-btn').addEventListener('click', () => {
  haptic(10);
  document.getElementById('snooze-sheet').classList.remove('hidden');
});

document.getElementById('snooze-cancel-btn').addEventListener('click', () => {
  document.getElementById('snooze-sheet').classList.add('hidden');
});

document.querySelectorAll('.snooze-option').forEach(btn => {
  btn.addEventListener('click', async () => {
    const days = parseInt(btn.dataset.days, 10);
    document.getElementById('snooze-sheet').classList.add('hidden');
    await apiFetch('PUT', `/api/items/${state.reviewItem.item_id}/snooze`, {
      user_id: state.userId, days,
    });
    stopAudio();
    state.dueItems = state.dueItems.filter(i => i.item_id !== state.reviewItem.item_id);
    state.reviewItem = null;
    if (state.dueItems.length === 0) showSessionComplete();
    else startReview(state.dueItems[0]);
  });
});
```

---

## Task 12: Frontend — QR sync (#3)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add sync section to profile panel in `index.html`** — add before the closing `</div>` of `.profile-panel` (after the notifications section).

```html
<!-- Sync -->
<div class="profile-sync-section">
  <p class="profile-notif-label">Sync to another device</p>
  <button id="sync-qr-btn" class="sync-qr-btn">Show QR code</button>
  <div id="sync-qr-wrap" class="sync-qr-wrap hidden">
    <img id="sync-qr-img" src="" alt="Scan to sync profile" width="180" height="180" />
    <p class="sync-qr-hint">Scan this QR code on your other device to load this profile</p>
  </div>
</div>
```

- [ ] **Step 2: Add CSS** — append to `style.css`.

```css
.profile-sync-section { border-top: 1px solid var(--border); padding-top: .75rem; margin-top: .75rem; }
.sync-qr-btn { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: .6rem; font-size: .9rem; color: var(--text); cursor: pointer; }
.sync-qr-wrap { display: flex; flex-direction: column; align-items: center; gap: .5rem; margin-top: .75rem; }
.sync-qr-wrap.hidden { display: none; }
.sync-qr-wrap img { border-radius: 8px; }
.sync-qr-hint { font-size: .78rem; color: var(--sub); text-align: center; }
```

- [ ] **Step 3: Wire up QR button in `app.js`** — add after profile overlay logic:

```javascript
document.getElementById('sync-qr-btn').addEventListener('click', () => {
  const wrap = document.getElementById('sync-qr-wrap');
  if (!wrap.classList.contains('hidden')) {
    wrap.classList.add('hidden');
    return;
  }
  const url = `${window.location.origin}?sync=${encodeURIComponent(state.userId)}`;
  document.getElementById('sync-qr-img').src =
    `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  wrap.classList.remove('hidden');
});
```

- [ ] **Step 4: Handle `?sync=` param on startup** — add in the init block (near `getOrCreateUserId`, before `loadDashboard`/`showLanding`):

```javascript
(function handleSyncParam() {
  const syncId = new URLSearchParams(window.location.search).get('sync');
  if (!syncId || syncId.length > 200) return;
  const profiles = getProfiles() ?? [];
  if (!profiles.find(p => p.userId === syncId)) {
    profiles.push({ name: 'Synced Profile', userId: syncId });
    localStorage.setItem('rf_profiles', JSON.stringify(profiles));
  }
  state.userId = syncId;
  localStorage.setItem('rf_user_id', syncId);
  window.history.replaceState({}, '', window.location.pathname);
})();
```

---

## Task 13: Frontend — juz-level tracking (#8)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add "Track as single Juz" button to the juz surah list in `index.html`** — find `id="juz-surahs"` (line 304) and add a sibling:

```html
<div id="juz-surahs" class="juz-surahs hidden"></div>
<div id="juz-single-wrap" class="juz-single-wrap hidden">
  <button id="juz-single-btn" class="juz-single-btn">Track Juz <span id="juz-single-num"></span> as one item</button>
  <p class="juz-single-sub">Revise the whole Juz at once — best for a complete hafidh</p>
</div>
```

- [ ] **Step 2: CSS** — append to `style.css`.

```css
.juz-single-wrap { margin-top: .75rem; }
.juz-single-wrap.hidden { display: none; }
.juz-single-btn { width: 100%; background: var(--card-bg); border: 2px solid var(--accent); border-radius: 10px; padding: .7rem; font-size: .95rem; font-weight: 600; color: var(--accent); cursor: pointer; }
.juz-single-sub { font-size: .8rem; color: var(--sub); margin-top: .35rem; text-align: center; }
.juz-review-summary { padding: 1rem; background: var(--card-bg); border-radius: 10px; text-align: center; }
.juz-review-summary h3 { color: var(--accent); margin-bottom: .5rem; }
.juz-review-surahs { font-size: .88rem; color: var(--sub); line-height: 1.6; }
```

- [ ] **Step 3: Show the single-juz button when a juz is selected** — in `selectJuz` function, after showing `#juz-surahs`, add:

```javascript
document.getElementById('juz-single-num').textContent = juzNum;
document.getElementById('juz-single-wrap').classList.remove('hidden');
```

And hide it in `openAddView`:
```javascript
document.getElementById('juz-single-wrap').classList.add('hidden');
```

- [ ] **Step 4: Add `addSingleJuzItem` in `app.js`** — near `addJuzItems`:

```javascript
async function addSingleJuzItem(juzNum) {
  const preset = DIFFICULTY_INITIAL[selectedDifficulty];
  const { status, data } = await apiFetch('POST', '/api/items', {
    user_id: state.userId,
    item_id: `juz-${juzNum}`,
    content: '',
    initial: {
      interval:      preset.interval,
      ease_factor:   preset.ease_factor,
      repetitions:   preset.repetitions,
      next_due_date: preset.next_due_date(),
    },
  });
  const statusEl = document.getElementById('juz-add-status');
  if (status === 201) {
    localStorage.setItem('rf_has_items', 'true');
    if (statusEl) statusEl.textContent = `Juz ${juzNum} added to your queue.`;
    await loadDashboard();
  } else if (status === 409) {
    if (statusEl) statusEl.textContent = `Juz ${juzNum} is already in your queue.`;
  } else if (status === 403) {
    state.atLimit = true;
    if (statusEl) statusEl.textContent = data.message;
  } else {
    if (statusEl) statusEl.textContent = data?.error ?? 'Error adding item.';
  }
}

document.getElementById('juz-single-btn').addEventListener('click', () => {
  if (activeJuz) addSingleJuzItem(activeJuz);
});
```

- [ ] **Step 5: Update `prettyItemId` to handle juz items** — find the `prettyItemId` function and prepend:

```javascript
function prettyItemId(id) {
  const juzMatch = id.match(/^juz-(\d+)$/);
  if (juzMatch) return `Juz ${juzMatch[1]}`;
  // ... rest of existing function unchanged
```

- [ ] **Step 6: Update review card to handle juz items** — in `startReview`, find where `applyTextMode(filterContent(item.content ?? ''))` is called, and replace with:

```javascript
if (item.item_id.match(/^juz-(\d+)$/)) {
  const juzNum = parseInt(item.item_id.split('-')[1], 10);
  const surahs = getSurahsInJuz(juzNum);
  const contentEl = document.getElementById('review-content');
  contentEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'juz-review-summary';
  const title = document.createElement('h3');
  title.textContent = `Juz ${juzNum}`;
  const surahList = document.createElement('p');
  surahList.className = 'juz-review-surahs';
  surahList.textContent = surahs.map(s => s.name).join(' · ');
  wrap.appendChild(title);
  wrap.appendChild(surahList);
  contentEl.appendChild(wrap);
  document.getElementById('reveal-btn').classList.add('hidden');
} else {
  applyTextMode(filterContent(item.content ?? ''));
}
updateTextModeBtn();
updateTranslationBtn();
```

- [ ] **Step 7: Suppress audio init for juz items** — in `initAudioForItem`, add a guard at the top:

```javascript
function initAudioForItem(itemId) {
  if (itemId.match(/^juz-\d+$/)) return; // juz items have no verse audio
  // ... rest unchanged
```

---

## Task 14: SW cache bump + commit

**Files:**
- Modify: `frontend/sw.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Bump SW cache version.**

In `frontend/sw.js`, change:
```javascript
const CACHE = 'retainflow-v31';
```
To:
```javascript
const CACHE = 'retainflow-v32';
```

In `frontend/style.css`, update the comment on line 1:
```css
/* Service worker cache: retainflow-v32 */
```

- [ ] **Step 2: Build backend to verify TypeScript compiles.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all tests.**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit everything.**

```powershell
git add frontend/index.html frontend/app.js frontend/style.css frontend/sw.js
git commit -m "feat: difficulty reframe, queue search, session resume, edit range, undo review, QR sync, extended snooze, juz tracking"
```

- [ ] **Step 5: Deploy.**

```powershell
cd C:\Users\Amir_\Retainflow; fly deploy
```

---

## Self-Review Checklist

- [x] Feature 1 (edit range): Task 1 (DB), Task 4 (server endpoint), Task 9 (frontend UI)
- [x] Feature 2 (undo): Task 2 (DB), Task 4 (server), Task 10 (frontend)
- [x] Feature 3 (QR sync): Task 12 (frontend only — no backend needed)
- [x] Feature 4 (extended snooze): Task 3 (DB), Task 4 (server), Task 11 (frontend)
- [x] Feature 5 (session resume): Task 8 (frontend only)
- [x] Feature 6 (queue search): Task 7 (frontend only)
- [x] Feature 7 (difficulty reframe): Task 6 (frontend only)
- [x] Feature 8 (juz tracking): Task 13 (frontend) — backend handles via existing POST /api/items
- [x] All new DB functions exported and imported in server.ts
- [x] Tests cover all new endpoints (Task 5)
- [x] SW cache bumped (Task 14)
- [x] No TypeScript casts in app.js (vanilla JS — no `as HTMLInputElement` etc.)
- [x] No innerHTML with server data (edit modal uses `.value`, queue edit uses DOM methods)
