# Review Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ⓘ button to the review screen that opens a popover showing the exact next-review interval each rating button would produce for the current card.

**Architecture:** Three pure frontend changes — HTML adds the button and popover shell, CSS styles and shows/hides the popover via an `.open` class, and JS adds two pure functions (`computeInterval`, `previewIntervals`) plus wires the toggle and calls `previewIntervals` at the end of `startReview`. No backend changes.

**Tech Stack:** Vanilla HTML/CSS/JS — no libraries.

---

## Files

| File | Change |
|------|--------|
| `frontend/index.html` | Add `.rating-key-wrap` container, `#rating-key-btn` ⓘ button, `#rating-key-popover` div inside `.review-bottom-dock` |
| `frontend/style.css` | Style `.rating-key-wrap`, `.rating-key-btn`, `.rating-key-popover`, `.rating-key-popover.open` |
| `frontend/app.js` | Add `computeInterval()`, `previewIntervals()`, call in `startReview()`, wire ⓘ toggle |

---

## Task 1: Add HTML structure

**Files:**
- Modify: `frontend/index.html` (around line 372 — the `.review-bottom-dock` div)

- [ ] **Step 1: Replace the `.review-bottom-dock` opening with a label row containing the ⓘ button**

Find this block (lines 372–380):

```html
      <!-- Zone 3: always-visible bottom dock -->
      <div class="review-bottom-dock">
        <div class="quality-btns">
          <button class="q-btn q-forgot" data-quality="forgot">Forgot<span class="q-key">1</span></button>
          <button class="q-btn q-hard"   data-quality="hard">Hard<span class="q-key">2</span></button>
          <button class="q-btn q-good"   data-quality="good">Good<span class="q-key">3</span></button>
          <button class="q-btn q-easy"   data-quality="easy">Easy<span class="q-key">4</span></button>
        </div>
        <button id="snooze-btn" class="btn-snooze">⏳ Remind me tomorrow</button>
      </div>
```

Replace with:

```html
      <!-- Zone 3: always-visible bottom dock -->
      <div class="review-bottom-dock">
        <div class="rating-key-wrap">
          <span class="dock-label">How did it go?</span>
          <button id="rating-key-btn" class="rating-key-btn" aria-label="Rating key" aria-expanded="false">ⓘ</button>
          <div id="rating-key-popover" class="rating-key-popover" role="tooltip">
            <div class="rk-row"><span class="rk-dot rk-forgot"></span><span class="rk-label">Forgot</span><span class="rk-days" id="rk-days-forgot">—</span></div>
            <div class="rk-row"><span class="rk-dot rk-hard"></span><span class="rk-label">Hard</span><span class="rk-days" id="rk-days-hard">—</span></div>
            <div class="rk-row"><span class="rk-dot rk-good"></span><span class="rk-label">Good</span><span class="rk-days" id="rk-days-good">—</span></div>
            <div class="rk-row"><span class="rk-dot rk-easy"></span><span class="rk-label">Easy</span><span class="rk-days" id="rk-days-easy">—</span></div>
          </div>
        </div>
        <div class="quality-btns">
          <button class="q-btn q-forgot" data-quality="forgot">Forgot<span class="q-key">1</span></button>
          <button class="q-btn q-hard"   data-quality="hard">Hard<span class="q-key">2</span></button>
          <button class="q-btn q-good"   data-quality="good">Good<span class="q-key">3</span></button>
          <button class="q-btn q-easy"   data-quality="easy">Easy<span class="q-key">4</span></button>
        </div>
        <button id="snooze-btn" class="btn-snooze">⏳ Remind me tomorrow</button>
      </div>
```

- [ ] **Step 2: Verify the HTML renders without errors**

Open `frontend/index.html` in a browser (or via the dev server at `http://localhost:3000`). Navigate to the review view. The dock should show a small ⓘ button to the right of a "How did it go?" label above the four rating buttons. The popover is invisible at this stage.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat(review-key): add popover HTML structure"
```

---

## Task 2: Add CSS

**Files:**
- Modify: `frontend/style.css` (append after the Zone 3 block ending around line 731)

- [ ] **Step 1: Add styles after the `.review-bottom-dock` block**

Find the comment `/* review-card sits inside scroll-area — no need for its own margin */` (around line 733) and insert the following block immediately before it:

```css
/* Rating key */
.rating-key-wrap {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: .5rem;
}
.dock-label {
  flex: 1;
  font-size: .75rem;
  color: var(--text-muted, #888);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.rating-key-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  font-size: .75rem;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted, #888);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.rating-key-btn:hover { opacity: .7; }
.rating-key-popover {
  display: none;
  position: absolute;
  bottom: calc(100% + .5rem);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.15);
  padding: .6rem .8rem;
  min-width: 180px;
  z-index: 101;
}
.rating-key-popover.open { display: block; }
.rk-row {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .2rem 0;
  font-size: .85rem;
}
.rk-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rk-forgot { background: #b03030; }
.rk-hard   { background: #b06000; }
.rk-good   { background: #2a6090; }
.rk-easy   { background: var(--accent); }
.rk-label  { flex: 1; }
.rk-days   { font-weight: 600; color: var(--accent); }
```

- [ ] **Step 2: Verify styling in browser**

With the dev server running (`cd ~/Retainflow/backend && npm run dev`), open `http://localhost:3000` and navigate to the review view. Confirm:
- "How did it go?" label is visible left of the ⓘ button
- ⓘ button is a small ghost circle
- The popover is not visible yet (no `.open` class)

- [ ] **Step 3: Commit**

```bash
git add frontend/style.css
git commit -m "feat(review-key): add popover and key-button styles"
```

---

## Task 3: Add JS logic and wire interactions

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add `computeInterval` and `previewIntervals` functions**

Find the `submitReview` function (around line 907). Insert the two new functions immediately before it:

```js
function computeInterval(card, quality) {
  const qMap = { forgot: 0, hard: 2, good: 4, easy: 5 };
  const q = qMap[quality];
  if (q < 3) return 1;
  if (card.repetitions === 0) return 1;
  if (card.repetitions === 1) return 6;
  return Math.round(card.interval * card.ease_factor);
}

function previewIntervals(card) {
  return {
    forgot: computeInterval(card, 'forgot'),
    hard:   computeInterval(card, 'hard'),
    good:   computeInterval(card, 'good'),
    easy:   computeInterval(card, 'easy'),
  };
}
```

- [ ] **Step 2: Call `previewIntervals` at the end of `startReview`**

Find `startReview` (around line 889). It currently ends with calls to `updateTextModeBtn()` and `updateTranslationBtn()`. Add the popover update immediately after those lines, before the closing `}`:

```js
  // Update rating-key popover with intervals for this card
  const intervals = previewIntervals(item);
  ['forgot', 'hard', 'good', 'easy'].forEach(q => {
    const n = intervals[q];
    document.getElementById(`rk-days-${q}`).textContent = n === 1 ? '1 day' : `${n} days`;
  });
```

- [ ] **Step 3: Wire the ⓘ toggle and outside-click dismiss**

Find the block that begins `document.querySelectorAll('.q-btn').forEach` (around line 939). Insert the following block immediately after it:

```js
// ── Rating key popover ─────────────────────────────────────────────────────
const ratingKeyBtn = document.getElementById('rating-key-btn');
const ratingKeyPopover = document.getElementById('rating-key-popover');

ratingKeyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = ratingKeyPopover.classList.toggle('open');
  ratingKeyBtn.setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (e) => {
  if (!ratingKeyPopover.contains(e.target) && e.target !== ratingKeyBtn) {
    ratingKeyPopover.classList.remove('open');
    ratingKeyBtn.setAttribute('aria-expanded', 'false');
  }
});
```

- [ ] **Step 4: Verify end-to-end in the browser**

With the dev server running, start a review session (you need at least one due item). Confirm:
1. The popover values update when each new card loads (check Forgot shows 1 day; check Good/Easy show the correct computed value based on the card's `repetitions` and `interval`)
2. Tapping ⓘ opens the popover
3. Tapping ⓘ again closes it
4. Tapping outside the popover closes it
5. `aria-expanded` toggles correctly (inspect in DevTools)
6. Dark mode: popover background and text are readable

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat(review-key): compute and display per-card intervals in popover"
```

---

## Task 4: Bump service worker cache version

The service worker caches shell assets. A CSS and JS change won't be picked up by returning users until the cache version is bumped.

**Files:**
- Modify: `frontend/sw.js` — bump cache name version
- Modify: `frontend/style.css` — update the comment reference if present

- [ ] **Step 1: Bump cache version in `sw.js`**

Open `frontend/sw.js`. Find the `cacheName` constant (currently `retainflow-v15`). Change it to `retainflow-v16`:

```js
const cacheName = 'retainflow-v16';
```

- [ ] **Step 2: Update the cache version comment in `style.css`**

Open `frontend/style.css`. Find the comment `/* Service worker cache: retainflow-v15 */` (near the top or bottom). Update it to `retainflow-v16`.

- [ ] **Step 3: Commit**

```bash
git add frontend/sw.js frontend/style.css
git commit -m "chore: bump SW cache to v16 for review-key assets"
```
