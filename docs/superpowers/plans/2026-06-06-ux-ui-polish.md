# UX/UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five UX/UI improvements: review screen declutter, dashboard clarity, add screen simplification, Arabic typography upgrade, and guided onboarding.

**Architecture:** All changes are frontend-only (index.html, app.js, style.css). No backend changes. SW cache bumped at the end.

**Tech Stack:** Vanilla HTML/CSS/JS, SW cache currently at `retainflow-v33`

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/index.html` | Review overflow menu, dashboard ring, add screen tabs, onboarding flow |
| `frontend/app.js` | All JS logic for 5 features |
| `frontend/style.css` | All CSS for 5 features |
| `frontend/sw.js` + `style.css` comment | Bump cache to v34 |

---

## Task 1: Review screen — rating buttons show intervals, controls decluttered

**Goal:** Remove cognitive load from the review screen. Inline next-interval hints directly on the rating buttons. Move text-mode and translation toggles into a single ⋯ overflow menu.

**Files:** `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

### HTML changes

- [ ] **Step 1: Replace the two standalone toggle buttons with a single ⋯ menu button** in the review card header. Find `id="text-mode-btn"` and `id="translation-btn"` in `view-review`. Replace both with:

```html
<div class="review-controls-wrap" style="position:relative">
  <button id="review-more-btn" class="btn-icon-sm" aria-label="Display options" aria-expanded="false">⋯</button>
  <div id="review-more-menu" class="review-more-menu hidden" role="menu">
    <button id="text-mode-btn" class="review-menu-item" role="menuitem">👁 Full</button>
    <button id="translation-btn" class="review-menu-item" role="menuitem">EN ✓</button>
  </div>
</div>
```

- [ ] **Step 2: Add interval hints to rating buttons** — add `<span>` inside each `.q-btn` to show the scheduled interval. The spans will be populated by JS. Update the q-btn HTML:

```html
<button class="q-btn q-forgot" data-quality="forgot">Forgot<span class="q-interval" id="qi-forgot"></span></button>
<button class="q-btn q-hard"   data-quality="hard">Hard<span class="q-interval" id="qi-hard"></span></button>
<button class="q-btn q-good"   data-quality="good">Good<span class="q-interval" id="qi-good"></span></button>
<button class="q-btn q-easy"   data-quality="easy">Easy<span class="q-interval" id="qi-easy"></span></button>
```

### CSS changes

- [ ] **Step 3: Add styles** — append to `style.css`:

```css
.review-more-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.15); z-index: 105; display: flex; flex-direction: column; min-width: 140px; padding: .3rem; }
.review-more-menu.hidden { display: none; }
.review-menu-item { background: none; border: none; padding: .55rem .75rem; font-size: .9rem; color: var(--text); border-radius: 7px; cursor: pointer; text-align: left; }
.review-menu-item:hover { background: var(--bg); }
.q-interval { display: block; font-size: .7rem; font-weight: 400; opacity: .8; margin-top: 2px; }
```

### JS changes

- [ ] **Step 4: Wire up the ⋯ menu** — find `ratingKeyBtn` event listener section and add nearby:

```javascript
const reviewMoreBtn = document.getElementById('review-more-btn');
const reviewMoreMenu = document.getElementById('review-more-menu');
reviewMoreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = reviewMoreMenu.classList.toggle('hidden');
  reviewMoreBtn.setAttribute('aria-expanded', String(!open));
});
document.addEventListener('click', (e) => {
  if (!reviewMoreMenu.contains(e.target) && e.target !== reviewMoreBtn) {
    reviewMoreMenu.classList.add('hidden');
    reviewMoreBtn.setAttribute('aria-expanded', 'false');
  }
});
```

- [ ] **Step 5: Populate interval hints when a review starts** — in `startReview`, after `previewIntervals` is called (or call it again), populate the spans. Find where the rating key popover days are set (`rk-days-*`) and add alongside:

```javascript
function updateIntervalHints(card) {
  const intervals = previewIntervals(card);
  const fmt = d => d === 1 ? '1 day' : d < 30 ? `${d}d` : `${Math.round(d/30)}mo`;
  document.getElementById('qi-forgot').textContent = fmt(intervals.forgot);
  document.getElementById('qi-hard').textContent   = fmt(intervals.hard);
  document.getElementById('qi-good').textContent   = fmt(intervals.good);
  document.getElementById('qi-easy').textContent   = fmt(intervals.easy);
}
```

Call `updateIntervalHints(item)` inside `startReview` after the item is set.

- [ ] **Step 6: Commit**

```powershell
git add frontend/ && git commit -m "feat: review screen — interval hints on rating buttons, controls in ⋯ menu"
```

---

## Task 2: Dashboard — circular progress ring + dominant start button

**Goal:** Replace the flat goal bar with a circular SVG progress ring. Make "Start session" the clear hero element.

**Files:** `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

### HTML changes

- [ ] **Step 1: Replace `#goal-bar` with ring layout** — find `id="goal-bar"` and replace the entire div with:

```html
<div id="goal-bar" class="goal-ring-wrap hidden">
  <div class="goal-ring-left">
    <svg class="goal-ring-svg" viewBox="0 0 64 64" aria-hidden="true">
      <circle class="goal-ring-track" cx="32" cy="32" r="28"/>
      <circle class="goal-ring-fill" id="goal-ring-fill" cx="32" cy="32" r="28"/>
    </svg>
    <div class="goal-ring-label">
      <span id="goal-done-num" class="goal-done-num">0</span>
      <span class="goal-ring-of">/ <span id="goal-total-num">10</span></span>
    </div>
  </div>
  <div class="goal-ring-right">
    <span class="goal-ring-caption">today's goal</span>
    <button id="goal-edit-btn" class="goal-edit-btn">Change goal</button>
    <div id="goal-editor" class="goal-editor hidden">
      <input id="goal-input" type="number" min="1" max="200" class="goal-input" aria-label="Daily goal" />
      <button id="goal-save-btn" class="goal-save-btn">Save</button>
      <button id="goal-cancel-btn" class="goal-cancel-btn">✕</button>
    </div>
  </div>
</div>
```

### CSS changes

- [ ] **Step 2: Add ring CSS** — append to `style.css`:

```css
.goal-ring-wrap { display: flex; align-items: center; gap: 1rem; margin-bottom: .75rem; }
.goal-ring-wrap.hidden { display: none; }
.goal-ring-left { position: relative; flex-shrink: 0; width: 64px; height: 64px; }
.goal-ring-svg { width: 64px; height: 64px; transform: rotate(-90deg); }
.goal-ring-track { fill: none; stroke: var(--border); stroke-width: 6; }
.goal-ring-fill { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 175.9; stroke-dashoffset: 175.9; transition: stroke-dashoffset .5s ease; }
.goal-ring-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; line-height: 1; }
.goal-done-num { font-size: 1.1rem; font-weight: 700; color: var(--accent); }
.goal-ring-of { font-size: .65rem; color: var(--sub); }
.goal-ring-right { display: flex; flex-direction: column; gap: .3rem; }
.goal-ring-caption { font-size: .75rem; color: var(--sub); text-transform: uppercase; letter-spacing: .05em; }
```

### JS changes

- [ ] **Step 3: Update `updateGoalBar` function** — replace the existing `updateGoalBar` implementation with one that drives the ring:

```javascript
function updateGoalBar() {
  const goal = getDailyGoal();
  const done = getTodayCount();
  const bar  = document.getElementById('goal-bar');
  if (!bar) return;
  if (goal <= 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('goal-done-num').textContent = String(done);
  document.getElementById('goal-total-num').textContent = String(goal);
  document.getElementById('goal-input').value = String(goal);
  const circumference = 175.9; // 2 * π * 28
  const pct = Math.min(done / goal, 1);
  document.getElementById('goal-ring-fill').style.strokeDashoffset = String(circumference * (1 - pct));
}
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/ && git commit -m "feat: dashboard — circular progress ring replaces flat goal bar"
```

---

## Task 3: Add screen — tabbed sections

**Goal:** Replace the long scrolling add screen with three tabs: Quick add | Browse Juz | Search. One section visible at a time.

**Files:** `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

### HTML changes

- [ ] **Step 1: Wrap existing add-screen sections in tab panels** — in `id="view-add"`, replace the content after the `<h2>` and `<p class="add-subhead">` with:

```html
<!-- Tab bar -->
<div class="add-tabs" role="tablist">
  <button class="add-tab add-tab--active" data-tab="quick" role="tab" aria-selected="true">Quick add</button>
  <button class="add-tab" data-tab="juz" role="tab" aria-selected="false">Browse Juz</button>
  <button class="add-tab" data-tab="search" role="tab" aria-selected="false">Search</button>
</div>

<!-- Panel: Quick add (starter packs + difficulty + range selector) -->
<div id="add-panel-quick" class="add-panel" role="tabpanel">
  <!-- [move existing starter-packs div here] -->
  <!-- [move existing range-selector div here] -->
  <!-- [move existing difficulty-picker div here] -->
  <!-- [move existing save-item-btn and add-error here] -->
</div>

<!-- Panel: Browse Juz -->
<div id="add-panel-juz" class="add-panel hidden" role="tabpanel">
  <!-- [move existing juz-section div here] -->
  <!-- [move existing juz-single-wrap div here] -->
</div>

<!-- Panel: Search -->
<div id="add-panel-search" class="add-panel hidden" role="tabpanel">
  <div class="search-bar">
    <input id="search-input" type="text" placeholder="e.g. Al-Mulk, mercy, bismillah..." autocomplete="off" aria-label="Search Quran" />
  </div>
  <div id="search-results" class="search-results"></div>
  <!-- [range selector is shared — keep it outside panels or duplicate reference] -->
</div>
```

> **Implementation note:** The range selector (`#range-selector`) is shared between Quick add and Search. Keep it outside the tab panels (after them) so it appears below whichever tab is active. The `starter-divider` can be removed.

### CSS changes

- [ ] **Step 2: Add tab styles** — append to `style.css`:

```css
.add-tabs { display: flex; gap: .35rem; margin-bottom: 1rem; background: var(--surface); border-radius: 10px; padding: .25rem; }
.add-tab { flex: 1; background: none; border: none; border-radius: 8px; padding: .5rem; font-size: .85rem; color: var(--sub); cursor: pointer; transition: background .15s, color .15s; }
.add-tab--active { background: var(--accent); color: var(--btn-text); font-weight: 600; }
.add-panel { }
.add-panel.hidden { display: none; }
```

### JS changes

- [ ] **Step 3: Add tab switching logic** — add to app.js:

```javascript
function switchAddTab(tabName) {
  document.querySelectorAll('.add-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('add-tab--active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.add-panel').forEach(p => {
    p.classList.toggle('hidden', !p.id.endsWith(tabName));
  });
}
document.querySelectorAll('.add-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAddTab(tab.dataset.tab));
});
```

- [ ] **Step 4: Reset to "quick" tab in `openAddView`** — add `switchAddTab('quick');` inside `openAddView`.

- [ ] **Step 5: Commit**

```powershell
git add frontend/ && git commit -m "feat: add screen — tabbed Quick add / Browse Juz / Search layout"
```

---

## Task 4: Typography — full-bleed Arabic, larger text, refined ayah markers

**Goal:** Make the Arabic text the hero of the review card. Remove the card border, increase font size, refine ayah markers to gold dots.

**Files:** `frontend/style.css`, `frontend/app.js`

### CSS changes

- [ ] **Step 1: Make review card borderless and full-bleed** — find `.review-card` and update:

```css
.review-card { background: transparent; border: none; border-radius: 0; padding: .5rem 0 1.5rem; text-align: center; margin: 0; touch-action: pan-y; user-select: none; }
```

- [ ] **Step 2: Increase Arabic font size** — find `.ar-flow` and update `font-size` from `2rem` to `2.4rem`:

```css
.ar-flow { direction: rtl; font-size: 2.4rem; font-family: 'Scheherazade New', serif; line-height: 2; overflow-wrap: break-word; }
```

- [ ] **Step 3: Refine ayah markers** — find `.ayah-marker` and update to a subtler inline style:

```css
.ayah-marker { color: var(--accent); opacity: .6; font-size: 1.2rem; margin: 0 .15rem; }
```

- [ ] **Step 4: Add a thin gold separator line between ayah sections** — append:

```css
.ayah-section + .ayah-section { border-top: 1px solid var(--border); margin-top: .75rem; padding-top: .75rem; }
```

- [ ] **Step 5: Commit**

```powershell
git add frontend/style.css && git commit -m "feat: typography — full-bleed review card, larger Arabic, refined ayah separators"
```

---

## Task 5: Onboarding — guided first-run flow

**Goal:** New users see a 3-step guided setup: (1) pick level, (2) get a suggested starter pack, (3) get shown to the review immediately.

**Files:** `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

### HTML changes

- [ ] **Step 1: Add onboarding overlay** — insert inside `#app` before `#view-landing`:

```html
<div id="onboarding-overlay" class="onboarding-overlay hidden" role="dialog" aria-label="Welcome to muraja'ah">
  <div class="onboarding-panel">
    <!-- Step 1: Level -->
    <div class="ob-step" id="ob-step-1">
      <div class="ob-icon">📖</div>
      <h2 class="ob-title">How much have you memorised?</h2>
      <div class="ob-level-grid">
        <button class="ob-level-btn" data-level="beginner">
          <span class="ob-level-label">Beginner</span>
          <span class="ob-level-sub">A few short surahs</span>
        </button>
        <button class="ob-level-btn" data-level="intermediate">
          <span class="ob-level-label">Intermediate</span>
          <span class="ob-level-sub">Juz 'Amma or more</span>
        </button>
        <button class="ob-level-btn" data-level="advanced">
          <span class="ob-level-label">Advanced</span>
          <span class="ob-level-sub">Multiple juz</span>
        </button>
        <button class="ob-level-btn" data-level="hafidh">
          <span class="ob-level-label">Ḥāfiẓ</span>
          <span class="ob-level-sub">Complete Quran</span>
        </button>
      </div>
    </div>
    <!-- Step 2: Suggestion -->
    <div class="ob-step hidden" id="ob-step-2">
      <div class="ob-icon">✨</div>
      <h2 class="ob-title">Here's a good starting point</h2>
      <p class="ob-desc" id="ob-desc"></p>
      <div id="ob-suggestions" class="ob-suggestions"></div>
      <button id="ob-custom-btn" class="ob-skip-btn">I'll choose my own →</button>
    </div>
    <!-- Step 3: Ready -->
    <div class="ob-step hidden" id="ob-step-3">
      <div class="ob-icon">🌟</div>
      <h2 class="ob-title">You're all set!</h2>
      <p class="ob-desc">Your first items have been added. Let's do a quick review to calibrate the schedule.</p>
      <button id="ob-start-btn" class="btn-primary" style="width:100%;margin-top:1rem">Start first review →</button>
      <button id="ob-skip-final-btn" class="ob-skip-btn" style="margin-top:.5rem">Go to dashboard</button>
    </div>
  </div>
</div>
```

### CSS changes

- [ ] **Step 2: Add onboarding CSS** — append to `style.css`:

```css
.onboarding-overlay { position: fixed; inset: 0; background: var(--bg); z-index: 200; display: flex; align-items: flex-end; justify-content: center; padding-bottom: env(safe-area-inset-bottom); }
.onboarding-overlay.hidden { display: none; }
.onboarding-panel { background: var(--surface); border-radius: 20px 20px 0 0; padding: 2rem 1.25rem 2.5rem; width: 100%; max-width: 480px; }
.ob-step { display: flex; flex-direction: column; align-items: center; gap: .75rem; }
.ob-step.hidden { display: none; }
.ob-icon { font-size: 2.5rem; }
.ob-title { font-size: 1.2rem; font-weight: 700; text-align: center; }
.ob-desc { font-size: .9rem; color: var(--sub); text-align: center; line-height: 1.55; }
.ob-level-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; width: 100%; }
.ob-level-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: .9rem .75rem; cursor: pointer; text-align: center; display: flex; flex-direction: column; gap: .2rem; transition: border-color .15s; }
.ob-level-btn:hover, .ob-level-btn.selected { border-color: var(--accent); background: var(--surface); }
.ob-level-label { font-weight: 600; font-size: .9rem; color: var(--text); }
.ob-level-sub { font-size: .75rem; color: var(--sub); }
.ob-suggestions { display: flex; flex-direction: column; gap: .5rem; width: 100%; }
.ob-suggestion-item { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: .75rem 1rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: border-color .15s; }
.ob-suggestion-item:hover { border-color: var(--accent); }
.ob-suggestion-label { font-size: .9rem; font-weight: 600; color: var(--text); }
.ob-suggestion-sub { font-size: .75rem; color: var(--sub); }
.ob-skip-btn { background: none; border: none; color: var(--sub); font-size: .85rem; cursor: pointer; text-decoration: underline; width: 100%; text-align: center; padding: .5rem; }
```

### JS changes

- [ ] **Step 3: Add onboarding logic** — add to app.js. The onboarding runs only on first launch (check `rf_has_items` and `rf_onboarding_done`):

```javascript
// ── Onboarding ─────────────────────────────────────────────────────────────
const OB_SUGGESTIONS = {
  beginner:     [
    { label: 'Al-Ikhlas', sub: '4 ayahs · Sincerity', surah: 112, from: 1, to: 4 },
    { label: 'Al-Falaq',  sub: '5 ayahs · Daybreak',  surah: 113, from: 1, to: 5 },
    { label: 'An-Nas',    sub: '6 ayahs · Mankind',   surah: 114, from: 1, to: 6 },
  ],
  intermediate: [
    { label: 'Al-Fatiha', sub: '7 ayahs · The Opening',       surah: 1,   from: 1, to: 7  },
    { label: 'Al-Mulk',   sub: '30 ayahs · The Sovereignty',  surah: 67,  from: 1, to: 30 },
    { label: 'Ya-Sin',    sub: '83 ayahs · Ya-Sin',            surah: 36,  from: 1, to: 83 },
  ],
  advanced: [
    { label: 'Al-Kahf 1–10', sub: 'First 10 ayahs',    surah: 18, from: 1, to: 10 },
    { label: 'Ar-Rahman',    sub: '78 ayahs',           surah: 55, from: 1, to: 78 },
  ],
  hafidh: [], // skip to Juz tracking
};

function maybeShowOnboarding() {
  const done = localStorage.getItem('rf_onboarding_done');
  const hasItems = localStorage.getItem('rf_has_items');
  if (done || hasItems) return;
  document.getElementById('onboarding-overlay').classList.remove('hidden');
}

let obSelectedLevel = null;

document.querySelectorAll('.ob-level-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    obSelectedLevel = btn.dataset.level;
    document.querySelectorAll('.ob-level-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    // Show step 2
    document.getElementById('ob-step-1').classList.add('hidden');
    const step2 = document.getElementById('ob-step-2');
    step2.classList.remove('hidden');
    if (obSelectedLevel === 'hafidh') {
      document.getElementById('ob-desc').textContent = 'As a ḥāfiẓ, you can track full juz. Head to Browse Juz after setup.';
      document.getElementById('ob-suggestions').innerHTML = '';
    } else {
      document.getElementById('ob-desc').textContent = 'Tap any range to add it to your review queue.';
      renderObSuggestions(OB_SUGGESTIONS[obSelectedLevel] ?? []);
    }
  });
});

function renderObSuggestions(packs) {
  const container = document.getElementById('ob-suggestions');
  container.innerHTML = '';
  packs.forEach(pack => {
    const row = document.createElement('div');
    row.className = 'ob-suggestion-item';
    row.innerHTML = `<div><div class="ob-suggestion-label">${pack.label}</div><div class="ob-suggestion-sub">${pack.sub}</div></div><span style="color:var(--accent);font-size:1.1rem">＋</span>`;
    row.addEventListener('click', async () => {
      row.style.opacity = '.5';
      row.style.pointerEvents = 'none';
      const { status: rs, data: rd } = await apiFetch('GET', `/api/quran/${pack.surah}/${pack.from}/${pack.to}`);
      if (rs !== 200) return;
      const content = rd.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
      await apiFetch('POST', '/api/items', {
        user_id: state.userId,
        item_id: `surah-${pack.surah}-ayat-${pack.from}-${pack.to}`,
        content,
        initial: { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: Date.now() },
      });
      localStorage.setItem('rf_has_items', 'true');
      row.innerHTML = `<div><div class="ob-suggestion-label">${pack.label}</div><div class="ob-suggestion-sub">${pack.sub}</div></div><span style="color:green">✓</span>`;
      row.style.opacity = '1';
      // Show step 3 after first add
      setTimeout(() => {
        document.getElementById('ob-step-2').classList.add('hidden');
        document.getElementById('ob-step-3').classList.remove('hidden');
      }, 600);
    });
    container.appendChild(row);
  });
}

document.getElementById('ob-custom-btn').addEventListener('click', () => {
  localStorage.setItem('rf_onboarding_done', '1');
  document.getElementById('onboarding-overlay').classList.add('hidden');
  openAddView();
});

document.getElementById('ob-start-btn').addEventListener('click', async () => {
  localStorage.setItem('rf_onboarding_done', '1');
  document.getElementById('onboarding-overlay').classList.add('hidden');
  await loadDashboard();
  if (state.dueItems.length > 0) startReview(state.dueItems[0]);
});

document.getElementById('ob-skip-final-btn').addEventListener('click', () => {
  localStorage.setItem('rf_onboarding_done', '1');
  document.getElementById('onboarding-overlay').classList.add('hidden');
  loadDashboard();
});
```

- [ ] **Step 4: Call `maybeShowOnboarding()` at the end of the app init block** — after `loadDashboard()` is called on first run (find where the app decides to show landing or dashboard, and add `maybeShowOnboarding()` for non-first-time users who have no items).

Actually: call it inside `loadDashboard` after checking `rf_has_items`:
```javascript
// At the end of loadDashboard, before the final return:
maybeShowOnboarding();
```

- [ ] **Step 5: Commit**

```powershell
git add frontend/ && git commit -m "feat: guided onboarding — level picker, suggested packs, direct to first review"
```

---

## Task 6: SW cache bump + deploy

- [ ] **Step 1: Bump `retainflow-v33` → `retainflow-v34`** in `frontend/sw.js` and `frontend/style.css` comment line 1.

- [ ] **Step 2: Run tests**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```

Expected: 48 tests pass.

- [ ] **Step 3: Commit and deploy**

```powershell
git add frontend/sw.js frontend/style.css
git commit -m "chore: bump SW cache to v34"
cd C:\Users\Amir_\Retainflow; fly deploy
```

---

## Self-Review

- [x] Task 1 (review declutter): ⋯ menu, interval hints on buttons
- [x] Task 2 (dashboard ring): SVG ring replaces flat bar, same JS hooks
- [x] Task 3 (add tabs): 3 tabs, range selector kept outside panels (shared)
- [x] Task 4 (typography): borderless card, larger Arabic, separator lines
- [x] Task 5 (onboarding): level → suggestions → first review, guarded by `rf_onboarding_done`
- [x] Task 6: cache bump v34, deploy
- [x] No backend changes needed
- [x] Onboarding guard uses `rf_has_items` so existing users never see it
