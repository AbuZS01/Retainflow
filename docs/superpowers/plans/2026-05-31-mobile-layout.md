# Mobile Layout — Bottom Nav + Full-screen Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded topbar with a bottom navigation bar and make the review view full-screen with quality buttons always pinned to the bottom.

**Architecture:** Pure frontend change — three files touched in sequence (HTML → CSS → JS). No backend changes. No new dependencies.

**Tech Stack:** Vanilla HTML5 / CSS custom properties / Vanilla JS. The Fastify server serves the files unchanged.

---

## File Map

| File | What changes |
|------|-------------|
| `frontend/index.html` | Remove `topbar-actions`; add theme row to profile panel; remove 3 back-buttons; restructure `#view-review`; add `<nav id="bottom-nav">` |
| `frontend/style.css` | Add bottom-nav styles; update `#app` padding; add review full-screen + 3-zone styles; remove `.review-topbar` + `.swipe-hint`; add `.nav-hidden` |
| `frontend/app.js` | Update `applyTheme()`; remove 8 old button listeners; add `setActiveTab()`; update `showView()`; wire nav tabs; add `setActiveTab()` calls |
| `frontend/sw.js` | Bump cache version |

---

## Task 1: HTML — Topbar cleanup, review restructure, bottom nav

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Remove the topbar-actions block from dashboard**

In `frontend/index.html`, inside `<div id="view-dashboard">`, delete the entire `<div class="topbar-actions">` element (all 7 lines including the 5 buttons and the wrapping div).

Replace this block:
```html
        <div class="topbar-actions">
          <button id="profile-btn" class="btn-icon" title="Profiles" aria-label="Switch profile">👤</button>
          <button id="queue-btn" class="btn-icon" title="My Queue" aria-label="View all items">☰</button>
          <button id="stats-btn" class="btn-icon" title="Progress" aria-label="View progress">📊</button>
          <button id="theme-btn" class="btn-icon" title="Toggle dark mode" aria-label="Toggle dark mode">🌙</button>
          <button id="add-btn" class="btn-icon" title="Add Item" aria-label="Add Item">＋</button>
        </div>
```

With nothing (delete it entirely). The `<header class="topbar">` now contains only the `<div class="logo-group">`.

- [ ] **Step 2: Add theme toggle to profile panel**

In `frontend/index.html`, inside `<div class="profile-panel">`, locate `.profile-notif-section` and insert a new theme section immediately **before** it:

```html
        <!-- Dark mode toggle -->
        <div class="profile-theme-section">
          <p class="profile-notif-label">Appearance</p>
          <div class="notif-row">
            <span style="font-size:.875rem;color:var(--text);flex:1">Dark mode</span>
            <button id="theme-btn" class="notif-toggle-btn" aria-label="Toggle dark mode">🌙</button>
          </div>
        </div>
```

- [ ] **Step 3: Remove back-buttons from Add, Queue, and Stats views**

In `frontend/index.html`:

1. In `<div id="view-add" class="view">`, delete: `<button id="back-btn" class="btn-back">← Back</button>`

2. In `<div id="view-queue" class="view">`, delete: `<button id="queue-back-btn" class="btn-back">← Dashboard</button>`

3. In `<div id="view-stats" class="view">`, delete: `<button id="stats-back-btn" class="btn-back">← Dashboard</button>`

- [ ] **Step 4: Restructure the review view into three zones**

Replace the entire contents of `<div id="view-review" class="view">` with:

```html
    <!-- Review View -->
    <div id="view-review" class="view">
      <!-- Zone 1: fixed top bar -->
      <div class="review-top-bar">
        <button id="review-back-btn" class="btn-back review-back">← Dashboard</button>
        <div class="session-progress">
          <span id="review-progress-text" class="progress-text"></span>
          <div class="progress-track"><div id="progress-fill" class="progress-fill"></div></div>
        </div>
      </div>

      <!-- Zone 2: scrollable content -->
      <div class="review-scroll-area">
        <div class="review-card" id="review-card">
          <div class="review-card-header">
            <div class="item-id-display" id="review-item-id"></div>
            <div style="display:flex;gap:.4rem;flex-shrink:0">
              <button id="translation-btn" class="btn-text-mode" title="Toggle translation" aria-label="Toggle English translation">EN ✓</button>
              <button id="text-mode-btn" class="btn-text-mode" title="Cycle text visibility">👁 Full</button>
            </div>
          </div>
          <div class="review-content" id="review-content"></div>
          <button id="reveal-btn" class="btn-reveal hidden">Tap to reveal</button>
          <!-- Audio player -->
          <div id="audio-player" class="audio-player hidden">
            <select id="reciter-select" class="reciter-select" aria-label="Choose reciter">
              <option value="Hudhaify_128kbps">Shaykh Ali al-Hudhayfee</option>
              <option value="Salah_Al_Budair_128kbps">Shaykh Salah al-Budair</option>
              <option value="Abdullaah_3awwaad_Al-Juhaynee_128kbps">Abdullāh al-Juhanī</option>
              <option value="Ibrahim_Akhdar_64kbps">Sheikh Ibrahim al-Akhdar</option>
            </select>
            <div class="audio-controls">
              <button id="audio-play-btn" class="audio-play-btn" aria-label="Play audio">▶</button>
              <span id="audio-ayah-label" class="audio-ayah-label"></span>
            </div>
          </div>
          <a id="review-link" class="review-link" target="_blank" rel="noopener noreferrer">Open on Quran.com →</a>
        </div>
      </div>

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
    </div>
```

Note: the `<p class="swipe-hint">` line is gone — it's no longer needed with the pinned dock.

- [ ] **Step 5: Add the bottom navigation bar**

Immediately before `</body>` (after the two `<script>` tags), add:

```html
  <!-- Bottom navigation bar — hidden on review and landing -->
  <nav id="bottom-nav" class="bottom-nav" aria-label="Main navigation">
    <button class="nav-tab active" data-action="home" aria-label="Home">
      <span class="nav-icon">🏠</span>
      <span class="nav-label">Home</span>
    </button>
    <button class="nav-tab" data-action="queue" aria-label="My Queue">
      <span class="nav-icon">☰</span>
      <span class="nav-label">Queue</span>
    </button>
    <button class="nav-tab nav-tab--add" data-action="add" aria-label="Add ayah range">
      <span class="nav-icon">＋</span>
    </button>
    <button class="nav-tab" data-action="stats" aria-label="Progress">
      <span class="nav-icon">📊</span>
      <span class="nav-label">Stats</span>
    </button>
    <button class="nav-tab" data-action="profile" aria-label="Profile">
      <span class="nav-icon">👤</span>
      <span class="nav-label">Profile</span>
    </button>
  </nav>
```

- [ ] **Step 6: Commit HTML changes**

```bash
git add frontend/index.html
git commit -m "feat(mobile): restructure HTML for bottom nav and full-screen review"
```

---

## Task 2: CSS — Bottom nav, app padding, review full-screen

**Files:**
- Modify: `frontend/style.css`
- Modify: `frontend/sw.js`

- [ ] **Step 1: Update `#app` padding to account for the bottom nav**

Find and replace:
```css
#app { max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem; min-height: 100%; }
```
With:
```css
#app { max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem calc(56px + env(safe-area-inset-bottom, 0) + 1rem); min-height: 100%; }
```

Also, the existing `body { padding-bottom: env(safe-area-inset-bottom, 0); }` rule is now handled by the bottom nav itself — replace it with just:
```css
body { }
```
(or remove the padding-bottom from it if there are other body rules — just remove the `padding-bottom` property from the body rule)

- [ ] **Step 2: Add bottom navigation styles**

Append to `frontend/style.css`, after the existing `.hidden` rule at the very end:

```css
/* ── Bottom navigation bar ─────────────────────────────────────────────────── */
.bottom-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 90;
  max-width: 480px;        /* keep aligned with #app */
  left: 50%;
  transform: translateX(-50%);
}

@media (max-width: 480px) {
  .bottom-nav { left: 0; right: 0; transform: none; max-width: 100%; }
}

.bottom-nav.nav-hidden { display: none; }

.nav-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: none;
  border: none;
  color: var(--sub);
  cursor: pointer;
  padding: 4px 8px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  position: relative;
  transition: color .15s;
}
.nav-tab .nav-icon { font-size: 1.3rem; line-height: 1; }
.nav-tab .nav-label { font-size: .58rem; letter-spacing: .03em; white-space: nowrap; }
.nav-tab.active { color: var(--accent); }
.nav-tab.active .nav-label { font-weight: 600; }
.nav-tab.active::after {
  content: '';
  position: absolute;
  bottom: 4px;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--accent);
}

/* Centre Add tab — elevated pill */
.nav-tab--add {
  background: var(--accent);
  border-radius: 50%;
  width: 46px;
  height: 46px;
  color: var(--btn-text);
  padding: 0;
  flex-shrink: 0;
}
.nav-tab--add .nav-icon { font-size: 1.5rem; }
.nav-tab--add::after { display: none; } /* no active dot on add tab */
.nav-tab--add:hover { opacity: .85; }
```

- [ ] **Step 3: Add review full-screen zone styles**

Append to `frontend/style.css`:

```css
/* ── Review — full-screen three-zone layout ──────────────────────────────── */

/* When active, the review view takes the whole viewport */
#view-review.active {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex !important;   /* override .view display:none reset */
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

/* Zone 1 — fixed top bar */
.review-top-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  min-height: 52px;
}

.review-back {
  /* btn-back already handles most styles; just ensure it doesn't grow */
  flex-shrink: 0;
  margin-bottom: 0;    /* override default margin-bottom on .btn-back */
  padding: .4rem 0;
}

/* Zone 2 — scrollable content */
.review-scroll-area {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: .75rem 1rem 0;
}

/* Zone 3 — always-visible bottom dock */
.review-bottom-dock {
  flex-shrink: 0;
  padding: .75rem 1rem;
  padding-bottom: calc(.75rem + env(safe-area-inset-bottom, 0));
  border-top: 1px solid var(--border);
  background: var(--surface);
}

/* review-card sits inside scroll-area — no need for its own margin */
#view-review .review-card {
  margin: 0 0 .75rem;
}
```

- [ ] **Step 4: Remove / replace outdated review rules**

Find and delete (or comment out) these now-unused rules:

1. Delete the rule: `.review-topbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }`

2. Delete the rule: `.swipe-hint { text-align: center; font-size: .75rem; color: var(--sub); margin-bottom: .75rem; letter-spacing: .02em; }`

3. In `.btn-back`, remove `margin-bottom: 1.25rem;` — that value is now overridden per-context via `.review-back` for the review back button, but it still applies elsewhere so leave the base rule and let `.review-back` override it.

Actually: only delete `.review-topbar` and `.swipe-hint`. Leave `.btn-back` as-is.

- [ ] **Step 5: Add a theme toggle style for the profile panel**

Append to `frontend/style.css`:

```css
/* Profile panel — theme section (mirrors notif-section layout) */
.profile-theme-section {
  padding: .75rem 0 .5rem;
  border-top: 1px solid var(--border);
  margin-top: .5rem;
}
```

- [ ] **Step 6: Bump service worker cache version**

In `frontend/sw.js`, change:
```js
const CACHE = 'retainflow-v14';
```
To:
```js
const CACHE = 'retainflow-v15';
```

(If the current version is not `v14`, increment whatever it currently is by 1.)

- [ ] **Step 7: Commit CSS + SW changes**

```bash
git add frontend/style.css frontend/sw.js
git commit -m "feat(mobile): bottom nav and full-screen review CSS"
```

---

## Task 3: JS — Navigation wiring

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Update `applyTheme()` to reference the new `theme-btn` location**

The `theme-btn` now lives in the profile panel instead of the topbar, but **keeps the same ID** (`theme-btn`). Only one change is needed: the `applyTheme()` function currently always finds the button via `document.getElementById('theme-btn')`. Since the ID is preserved, `applyTheme()` works unchanged.

Verify the current code is:
```js
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}
```

If so — no change needed here. ✓

- [ ] **Step 2: Remove the old topbar button `click` listeners**

Find and delete these five listener blocks (they reference buttons that no longer exist in the topbar):

```js
document.getElementById('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('rf_theme', next);
});
```

```js
document.getElementById('profile-btn').addEventListener('click', openProfileOverlay);
```

```js
document.getElementById('add-btn').addEventListener('click', openAddView);
```

```js
document.getElementById('stats-btn').addEventListener('click', loadStats);
```

```js
document.getElementById('queue-btn').addEventListener('click', loadQueue);
```

And these three back-button listeners:
```js
document.getElementById('back-btn').addEventListener('click', loadDashboard);
```

```js
document.getElementById('queue-back-btn').addEventListener('click', loadDashboard);
```

```js
document.getElementById('stats-back-btn').addEventListener('click', loadDashboard);
```

**Important:** `theme-btn` still exists in the new profile panel HTML (same ID), so re-add the theme click listener right after removing the old placement — see Step 3.

- [ ] **Step 3: Re-add theme click listener (now profile-panel button)**

Add this block immediately after the `initTheme()` function definition (around line 48):

```js
document.getElementById('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('rf_theme', next);
});
```

This is the same logic as before — we're just keeping it close to `applyTheme()` in the file for readability.

- [ ] **Step 4: Add `setActiveTab()` helper**

Add this function immediately after the `showView()` function:

```js
// ── Bottom nav active tab ─────────────────────────────────────────────────
function setActiveTab(action) {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.action === action);
  });
}
```

- [ ] **Step 5: Update `showView()` to toggle bottom-nav visibility**

Replace:
```js
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
```

With:
```js
// Views where the bottom nav must be hidden
const NAV_HIDDEN_VIEWS = new Set(['view-review', 'view-landing']);

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.classList.toggle('nav-hidden', NAV_HIDDEN_VIEWS.has(id));
}
```

- [ ] **Step 6: Wire bottom nav tab clicks**

Add this block immediately after the `setActiveTab()` function:

```js
document.querySelectorAll('.nav-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const action = tab.dataset.action;
    switch (action) {
      case 'home':    setActiveTab('home');    loadDashboard();       break;
      case 'queue':   setActiveTab('queue');   loadQueue();           break;
      case 'add':     setActiveTab('add');     openAddView();         break;
      case 'stats':   setActiveTab('stats');   loadStats();           break;
      case 'profile': /* profile opens overlay, no tab stays active */
        openProfileOverlay(); break;
    }
  });
});
```

- [ ] **Step 7: Add `setActiveTab()` calls into the view-loading functions**

Make these four edits so the bottom nav always reflects the current view:

**In `loadDashboard()`**, add `setActiveTab('home');` as the first line inside the function body:
```js
async function loadDashboard() {
  setActiveTab('home');
  showView('view-dashboard');
  // ... rest unchanged
```

**In `loadStats()`**, add `setActiveTab('stats');` as the first line:
```js
async function loadStats() {
  setActiveTab('stats');
  showView('view-stats');
  // ... rest unchanged
```

**In `loadQueue()`**, add `setActiveTab('queue');` as the first line:
```js
async function loadQueue() {
  setActiveTab('queue');
  showView('view-queue');
  // ... rest unchanged
```

**In `openAddView()`**, add `setActiveTab('add');` as the first line:
```js
function openAddView() {
  setActiveTab('add');
  // ... rest unchanged (search reset, renderStarterPacks, etc.)
```

- [ ] **Step 8: Verify `startFromLanding()` resets tab to home**

The `startFromLanding()` function calls `loadDashboard()` which now calls `setActiveTab('home')`. No change needed — this works automatically. ✓

- [ ] **Step 9: Commit JS changes**

```bash
git add frontend/app.js
git commit -m "feat(mobile): wire bottom nav JS and remove old topbar button listeners"
```

---

## Task 4: Smoke test

- [ ] **Step 1: Start the server**

```bash
cd backend && npm run dev
```
Expected: `RetainFlow running at http://127.0.0.1:3000`

- [ ] **Step 2: Open DevTools in mobile simulation**

Open `http://localhost:3000` in Chrome. Press F12 → toggle device toolbar → select iPhone 14 Pro (393×852).

- [ ] **Step 3: Verify bottom nav**

Check:
- Five tab buttons appear at the bottom, all reachable without scrolling
- The Add tab (centre) is a filled circle, visually elevated
- Home tab shows the active-dot indicator on first load
- Tapping Queue loads the queue view with Queue tab highlighted
- Tapping Stats loads the stats view with Stats tab highlighted
- Tapping Add opens the add view with Add tab highlighted
- Tapping Profile opens the profile overlay (no tab stays highlighted)
- Tapping Home returns to dashboard with Home tab highlighted

- [ ] **Step 4: Verify review full-screen**

- Tap an item from the dashboard
- Review view should cover the entire screen — no topbar or nav bar visible
- Arabic content is in the upper scrollable area
- Quality buttons (Forgot / Hard / Good / Easy) and snooze are always visible at the bottom
- If the ayah range has many ayahs, scrolling the content does NOT scroll the quality buttons off-screen
- Swiping left on the card submits "forgot"; swiping right submits "easy"
- "← Dashboard" back button in the top-left returns to dashboard with bottom nav reappearing

- [ ] **Step 5: Verify profile panel theme toggle**

- Open Profile (bottom nav)
- Dark mode toggle is visible in the panel
- Tapping it switches the theme correctly

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: mobile layout complete — bottom nav + full-screen review"
```

---

## Self-review checklist

| Spec requirement | Covered in |
|-----------------|-----------|
| Five-tab bottom nav (Home/Queue/Add/Stats/Profile) | Task 1 Step 5, Task 2 Step 2, Task 3 Steps 6–7 |
| Topbar stripped to logo + streak | Task 1 Step 1 |
| Theme toggle moves to Profile panel | Task 1 Step 2, Task 3 Steps 2–3 |
| Back-buttons removed from Add/Queue/Stats | Task 1 Step 3 |
| Review view full-screen fixed overlay | Task 2 Step 3 |
| Review: top-bar / scroll-area / bottom-dock zones | Task 1 Step 4, Task 2 Step 3 |
| Quality buttons always visible (pinned dock) | Task 1 Step 4, Task 2 Step 3 |
| Nav hidden during review and landing | Task 3 Step 5 |
| Swipe gesture preserved | No change needed (swipe is on `#review-card` which stays in DOM) |
| Active tab reflects current view | Task 3 Steps 4, 6, 7 |
| iOS safe area respected | Task 2 Steps 1, 3 (`env(safe-area-inset-bottom)`) |
| Service worker cache bumped | Task 2 Step 6 |
