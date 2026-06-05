# Mushaf Display + Juz Bulk Add + Audio Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three features — mushaf-style flowing Arabic text with ۝ markers, one-click bulk add for an entire Juz, and looping audio playback.

**Architecture:** All three features are pure frontend changes except raising the free-tier item limit (one-line backend change). `renderWordLevel()` in `app.js` is refactored to render inline flowing Arabic; Juz bulk-add builds on the existing `JUZ_STARTS` constant and `getSurahsInJuz()` helper already in `app.js`; audio loop adds two fields to `audioState` and a small UI block in `index.html`.

**Tech Stack:** Vanilla JS / HTML / CSS frontend; Node.js + Fastify backend; better-sqlite3; Vitest for backend tests.

---

## Reference: key locations

| Symbol | File | Approx line |
|--------|------|-------------|
| `renderWordLevel(rawContent)` | `frontend/app.js` | ~225 |
| `filterContent(rawContent)` | `frontend/app.js` | ~304 |
| `updateRangePreview()` | `frontend/app.js` | ~644 |
| `audioState` object | `frontend/app.js` | ~783 |
| `playFromIdx(idx)` | `frontend/app.js` | ~836 |
| `updateAudioUI()` | `frontend/app.js` | ~812 |
| `initAudioForItem(itemId)` | `frontend/app.js` | ~862 |
| `JUZ_STARTS` constant | `frontend/app.js` | ~1245 |
| `getSurahsInJuz(juzNum)` | `frontend/app.js` | ~1251 |
| `selectJuz(juzNum, btn)` | `frontend/app.js` | ~1282 |
| `state.atLimit` flag | `frontend/app.js` | ~42 |
| `#audio-player` HTML block | `frontend/index.html` | ~355 |
| `addItem()` free-tier check | `backend/src/database.ts` | ~194 |
| Limit banner text | `frontend/index.html` | ~239 |
| SW cache name | `frontend/sw.js` | line 1 |
| SW cache version comment | `frontend/style.css` | line 1 |

---

## Task 1: Raise free-tier limit to 50 + fix tests

**Files:**
- Modify: `backend/src/database.ts:194`
- Modify: `backend/tests/database.test.ts`

- [ ] **Step 1: Update the limit check in `database.ts`**

Find this block (around line 194):
```typescript
if (count >= 5) {
  throw new Error('LIMIT_REACHED');
}
```
Change to:
```typescript
if (count >= 50) {
  throw new Error('LIMIT_REACHED');
}
```

- [ ] **Step 2: Update the limit tests in `database.test.ts`**

Replace the entire `describe('addItem — freemium tier limit', ...)` block with:

```typescript
describe('addItem — freemium tier limit', () => {
  it('allows adding the 50th item for a free user', () => {
    createUser(db, 'user-free');
    // Insert 49 items directly to keep the test fast
    for (let i = 1; i <= 49; i++) {
      db.prepare(
        `INSERT INTO items (user_id, item_id, content, interval, ease_factor, repetitions, next_due_date)
         VALUES (?, ?, '', 1, 2.5, 0, 0)`
      ).run('user-free', `item-${i}`);
    }
    expect(() => addItem(db, 'user-free', 'item-50')).not.toThrow();
  });

  it('blocks the 51st item for a free user with LIMIT_REACHED', () => {
    createUser(db, 'user-free2');
    for (let i = 1; i <= 50; i++) {
      db.prepare(
        `INSERT INTO items (user_id, item_id, content, interval, ease_factor, repetitions, next_due_date)
         VALUES (?, ?, '', 1, 2.5, 0, 0)`
      ).run('user-free2', `item-${i}`);
    }
    expect(() => addItem(db, 'user-free2', 'item-51')).toThrow('LIMIT_REACHED');
  });

  it('allows more than 50 items for a premium user', () => {
    createUser(db, 'user-prem');
    db.prepare(`UPDATE users SET is_premium = 1 WHERE user_id = ?`).run('user-prem');
    for (let i = 1; i <= 51; i++) {
      expect(() => addItem(db, 'user-prem', `item-${i}`)).not.toThrow();
    }
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Update limit banner text in `index.html`**

Find:
```html
<span>Starter set full <strong>(5 ranges)</strong> — upgrade to track unlimited ayah ranges.</span>
```
Change to:
```html
<span>Starter set full <strong>(50 ranges)</strong> — upgrade to track unlimited ayah ranges.</span>
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/database.ts backend/tests/database.test.ts frontend/index.html
git commit -m "feat: raise free tier limit from 5 to 50 items"
```

---

## Task 2: Fix `filterContent` separator bug

**Files:**
- Modify: `frontend/app.js` (~line 308)

The current code joins ayah blocks with `\n` after stripping English, but `renderWordLevel` splits by `\n\n`. When translation is off, only the first ayah's Arabic is shown. Fix by keeping `\n\n` as the separator.

- [ ] **Step 1: Fix `filterContent`**

Find:
```javascript
  return rawContent
    .split('\n\n')
    .map((block) => block.split('\n')[0])
    .join('\n');
```
Change to:
```javascript
  return rawContent
    .split('\n\n')
    .map((block) => block.split('\n')[0])
    .join('\n\n');
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app.js
git commit -m "fix: filterContent must join blocks with double newline so all ayahs render"
```

---

## Task 3: Mushaf flow display

**Files:**
- Modify: `frontend/app.js` (~lines 224–281, 644–657)
- Modify: `frontend/style.css`

- [ ] **Step 1: Add `getStartAyah` and `toArabicNumeral` helpers in `app.js`**

Add these two functions immediately before `renderWordLevel` (around line 224):

```javascript
function toArabicNumeral(n) {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}

function getStartAyah(itemId) {
  if (!itemId) return 1;
  const m = itemId.match(/ayat-(\d+)-\d+$/);
  return m ? parseInt(m[1], 10) : 1;
}
```

- [ ] **Step 2: Replace `renderWordLevel` in `app.js`**

Replace the entire `renderWordLevel` function (from `function renderWordLevel(rawContent) {` to its closing `}`) with:

```javascript
function renderWordLevel(rawContent) {
  const contentEl = document.getElementById('review-content');
  const revealBtn = document.getElementById('reveal-btn');
  contentEl.innerHTML = '';

  if (!rawContent) { revealBtn.classList.add('hidden'); return; }

  const isHidden    = textMode === 'hidden' && !contentRevealed;
  const isFirstOnly = textMode === 'first'  && !contentRevealed;

  revealBtn.classList.toggle('hidden', !isHidden);

  const startAyah = getStartAyah(state.reviewItem?.item_id);
  const blocks    = rawContent.split('\n\n').filter(b => b.trim());

  // Single flowing Arabic paragraph
  const flowDiv = document.createElement('div');
  flowDiv.className = 'ar-flow';

  let wordCount = 0;
  blocks.forEach((block, blockIdx) => {
    const lines   = block.split('\n');
    const arabic  = lines[0] || '';
    const ayahNum = startAyah + blockIdx;

    arabic.split(/\s+/).filter(w => w).forEach(word => {
      if (isHidden) {
        const chip = document.createElement('span');
        chip.className = 'ar-placeholder';
        flowDiv.appendChild(chip);
      } else {
        const span = document.createElement('span');
        span.className = 'ar-word';
        if (isFirstOnly && wordCount > 0) span.classList.add('ar-faded');
        span.textContent = word;
        flowDiv.appendChild(span);
      }
      wordCount++;
    });

    if (!isHidden) {
      const marker = document.createElement('span');
      marker.className = 'ayah-marker';
      marker.textContent = '۝' + toArabicNumeral(ayahNum);
      flowDiv.appendChild(marker);
    }
  });

  contentEl.appendChild(flowDiv);

  // English translations listed below the Arabic flow
  if (!isHidden && showTranslation) {
    blocks.forEach((block, blockIdx) => {
      const lines   = block.split('\n');
      const english = lines.slice(1).join(' ');
      if (!english) return;
      const enLine = document.createElement('div');
      enLine.className = 'en-line';
      enLine.textContent = `(${startAyah + blockIdx}) ${english}`;
      contentEl.appendChild(enLine);
    });
  }
}
```

- [ ] **Step 3: Update add-screen preview in `updateRangePreview`**

Find (around line 656):
```javascript
  preview.textContent = data.map((a) => a.arabic).join('  ');
```
Change to:
```javascript
  preview.textContent = data.map((a, i) => `${a.arabic} ۝${toArabicNumeral(from + i)}`).join(' ');
```

- [ ] **Step 4: Add CSS for `.ar-flow` and `.ayah-marker` in `style.css`**

Add after the existing `.ar-line` rule (search for `.ar-line {`):

```css
.ar-flow {
  direction: rtl;
  text-align: right;
  font-family: 'Scheherazade New', Georgia, serif;
  font-size: 2rem;
  line-height: 2.2;
  color: var(--text);
  margin-bottom: 0.5rem;
}

.ar-flow .ar-word {
  display: inline;
  cursor: default;
}

.ar-flow .ar-placeholder {
  display: inline-block;
}

.ayah-marker {
  display: inline;
  font-family: 'Scheherazade New', Georgia, serif;
  font-size: 1rem;
  color: var(--accent);
  margin: 0 0.15em;
  user-select: none;
}
```

- [ ] **Step 5: Manually verify**

Start dev server: `cd C:\Users\Amir_\Retainflow\backend && npm run dev`

Open `http://localhost:3000` in browser. Add or open a review item with multiple ayahs. Confirm:
- Arabic text flows inline with ۝١ ۝٢ markers between ayahs
- Toggling translation off/on still works
- "Hidden" text mode still shows placeholder chips
- "First word" mode fades everything after the first word
- The add-screen preview also shows ۝ markers

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js frontend/style.css
git commit -m "feat: mushaf flow display — inline Arabic with ayah markers"
```

---

## Task 4: Juz bulk add

**Files:**
- Modify: `frontend/app.js` (~line 1282, `selectJuz` function + new `addJuzItems` function)
- Modify: `frontend/style.css`

- [ ] **Step 1: Add `getJuzChunk` helper and `addJuzItems` function in `app.js`**

Add these two functions immediately before `selectJuz` (around line 1282):

```javascript
function getJuzChunk() {
  return parseInt(localStorage.getItem('rf_juz_chunk') ?? '10', 10);
}

async function addJuzItems(juzNum, chunkSize) {
  const surahs = getSurahsInJuz(juzNum);
  const chunks = [];
  surahs.forEach(({ surah, from, to }) => {
    for (let start = from; start <= to; start += chunkSize) {
      chunks.push({ surah, from: start, to: Math.min(start + chunkSize - 1, to) });
    }
  });

  const statusEl = document.getElementById('juz-add-status');
  if (!statusEl) return;
  let added = 0;

  for (const chunk of chunks) {
    statusEl.textContent = `Adding item ${added + 1} of ${chunks.length}…`;

    const { status: rs, data: rd } = await apiFetch('GET', `/api/quran/${chunk.surah}/${chunk.from}/${chunk.to}`);
    if (rs !== 200 || !Array.isArray(rd)) continue;

    const itemId  = `surah-${chunk.surah}-ayat-${chunk.from}-${chunk.to}`;
    const content = rd.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
    const preset  = DIFFICULTY_INITIAL[selectedDifficulty];

    const { status, data } = await apiFetch('POST', '/api/items', {
      user_id: state.userId,
      item_id: itemId,
      content,
      initial: {
        interval:      preset.interval,
        ease_factor:   preset.ease_factor,
        repetitions:   preset.repetitions,
        next_due_date: preset.next_due_date(),
      },
    });

    if (status === 409) { added++; continue; } // duplicate — already tracked
    if (status !== 200 && status !== 201) {
      if (data?.error === 'LIMIT_REACHED') {
        state.atLimit = true;
        statusEl.textContent = `Limit reached — ${added} item${added !== 1 ? 's' : ''} added.`;
        await loadDashboard();
        return;
      }
      statusEl.textContent = `Error on item ${added + 1}. ${added} added so far.`;
      return;
    }
    added++;
  }

  statusEl.textContent = `✓ ${added} item${added !== 1 ? 's' : ''} added to your queue`;
  await loadDashboard();
}
```

- [ ] **Step 2: Update `selectJuz` to inject bulk-add UI**

In `selectJuz`, find the block that clears the container and renders surah rows:

```javascript
  const surahs = getSurahsInJuz(juzNum);
  const container = document.getElementById('juz-surahs');
  container.innerHTML = '';
  surahs.forEach(({ surah, name, from, to, partial }) => {
```

Replace with:

```javascript
  const surahs = getSurahsInJuz(juzNum);
  const container = document.getElementById('juz-surahs');
  container.innerHTML = '';

  // ── Bulk-add row ──────────────────────────────────────────────────────────
  const bulkRow = document.createElement('div');
  bulkRow.className = 'juz-bulk-row';

  const chunkLabel = document.createElement('span');
  chunkLabel.className = 'juz-chunk-label';
  chunkLabel.textContent = 'Ayahs per item:';
  bulkRow.appendChild(chunkLabel);

  const chunkBtns = document.createElement('div');
  chunkBtns.className = 'juz-chunk-btns';
  [5, 10, 15, 20].forEach(n => {
    const cb = document.createElement('button');
    cb.className = 'juz-chunk-btn' + (n === getJuzChunk() ? ' active' : '');
    cb.textContent = n;
    cb.setAttribute('aria-label', `${n} ayahs per item`);
    cb.addEventListener('click', () => {
      localStorage.setItem('rf_juz_chunk', String(n));
      chunkBtns.querySelectorAll('.juz-chunk-btn').forEach(b => b.classList.remove('active'));
      cb.classList.add('active');
    });
    chunkBtns.appendChild(cb);
  });
  bulkRow.appendChild(chunkBtns);

  const addAllBtn = document.createElement('button');
  addAllBtn.className = 'btn-primary juz-add-all-btn';
  addAllBtn.textContent = `Add Juz ${juzNum}`;
  addAllBtn.addEventListener('click', () => {
    addAllBtn.disabled = true;
    addJuzItems(juzNum, getJuzChunk()).finally(() => { addAllBtn.disabled = false; });
  });
  bulkRow.appendChild(addAllBtn);

  const statusEl = document.createElement('div');
  statusEl.id = 'juz-add-status';
  statusEl.className = 'juz-add-status';

  container.appendChild(bulkRow);
  container.appendChild(statusEl);
  // ── End bulk-add row ──────────────────────────────────────────────────────

  surahs.forEach(({ surah, name, from, to, partial }) => {
```

- [ ] **Step 3: Add CSS for bulk-add row in `style.css`**

Add after the `.juz-surah-row` rule (search for `.juz-surah-row {`):

```css
.juz-bulk-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.65rem 0.75rem;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border, #e8dfc0);
  border-radius: 8px;
  margin-bottom: 0.5rem;
}

.juz-chunk-label {
  font-size: 0.8rem;
  color: var(--sub);
  white-space: nowrap;
}

.juz-chunk-btns {
  display: flex;
  gap: 0.3rem;
}

.juz-chunk-btn {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  border: 1.5px solid var(--border, #d4b87a);
  background: transparent;
  color: var(--text);
  font-size: 0.8rem;
  cursor: pointer;
}

.juz-chunk-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.juz-add-all-btn {
  margin-left: auto;
  padding: 0.35rem 0.85rem;
  font-size: 0.85rem;
}

.juz-add-status {
  width: 100%;
  font-size: 0.8rem;
  color: var(--sub);
  min-height: 1.25rem;
  padding: 0 0.1rem;
}
```

- [ ] **Step 4: Manually verify**

Open `http://localhost:3000`, go to Add view, click Browse by Juz. Click a Juz number (e.g. Juz 30). Confirm:
- Bulk-add row appears above the surah list with chunk buttons and "Add Juz 30" button
- Chunk buttons toggle active state and persist on re-click
- Clicking "Add Juz 30" shows progress ("Adding item 1 of N…") and then "✓ N items added"
- Items appear in the queue

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js frontend/style.css
git commit -m "feat: bulk add entire Juz with configurable ayah chunk size"
```

---

## Task 5: Audio loop

**Files:**
- Modify: `frontend/index.html` (~line 362, inside `#audio-player`)
- Modify: `frontend/app.js` (~lines 783, 812, 836, 862)
- Modify: `frontend/style.css`

- [ ] **Step 1: Add loop controls markup to `index.html`**

Find inside `#audio-player`:
```html
            <div class="audio-controls">
              <button id="audio-play-btn" class="audio-play-btn" aria-label="Play audio">▶</button>
              <span id="audio-ayah-label" class="audio-ayah-label"></span>
            </div>
```
Replace with:
```html
            <div class="audio-controls">
              <button id="audio-play-btn" class="audio-play-btn" aria-label="Play audio">▶</button>
              <span id="audio-ayah-label" class="audio-ayah-label"></span>
            </div>
            <div class="loop-controls">
              <span class="loop-label">Repeat</span>
              <div class="loop-btns">
                <button class="loop-btn" data-loop="1" aria-label="No repeat">1×</button>
                <button class="loop-btn" data-loop="2" aria-label="Repeat 2 times">2×</button>
                <button class="loop-btn" data-loop="5" aria-label="Repeat 5 times">5×</button>
                <button class="loop-btn" data-loop="Infinity" aria-label="Repeat infinitely">∞</button>
              </div>
              <div id="loop-dots" class="loop-dots hidden"></div>
            </div>
```

- [ ] **Step 2: Add `getLoopMode` helper and update `audioState` in `app.js`**

Add this function immediately before `let audioState = {` (around line 783):

```javascript
function getLoopMode() {
  const saved = localStorage.getItem('rf_loop_mode');
  if (saved === 'Infinity') return Infinity;
  const n = parseInt(saved ?? '1', 10);
  return isNaN(n) || n < 1 ? 1 : n;
}
```

Then update `audioState` to add two new fields:

```javascript
let audioState = {
  audio:      null,
  surah:      0,
  ayahs:      [],
  currentIdx: 0,
  playing:    false,
  loopMode:   getLoopMode(),
  loopsDone:  0,
};
```

- [ ] **Step 3: Update `updateAudioUI` in `app.js`**

Replace the entire `updateAudioUI` function with:

```javascript
function updateAudioUI() {
  const btn   = document.getElementById('audio-play-btn');
  const label = document.getElementById('audio-ayah-label');
  const dots  = document.getElementById('loop-dots');

  btn.textContent = audioState.playing ? '⏸' : '▶';
  btn.setAttribute('aria-label', audioState.playing ? 'Pause audio' : 'Play audio');

  if (audioState.ayahs.length > 0) {
    const idx  = Math.min(audioState.currentIdx, audioState.ayahs.length - 1);
    const ayah = audioState.ayahs[idx];
    if (audioState.loopMode > 1 && audioState.playing) {
      const done  = audioState.loopsDone + 1;
      const total = audioState.loopMode === Infinity ? '∞' : audioState.loopMode;
      label.textContent = `${audioState.surah}:${ayah} · loop ${done}/${total}`;
    } else {
      label.textContent = `${audioState.surah}:${ayah}`;
    }
  } else {
    label.textContent = '';
  }

  // Sync loop button active states
  document.querySelectorAll('.loop-btn').forEach(b => {
    const val    = b.dataset.loop;
    const active = val === 'Infinity'
      ? audioState.loopMode === Infinity
      : parseInt(val, 10) === audioState.loopMode;
    b.classList.toggle('active', active);
  });

  // Progress dots for finite loops
  if (dots) {
    dots.innerHTML = '';
    if (audioState.loopMode > 1 && audioState.loopMode !== Infinity) {
      for (let i = 0; i < audioState.loopMode; i++) {
        const dot = document.createElement('span');
        dot.className = 'loop-dot' + (i < audioState.loopsDone ? ' done' : '');
        dots.appendChild(dot);
      }
      dots.classList.remove('hidden');
    } else {
      dots.classList.add('hidden');
    }
  }
}
```

- [ ] **Step 4: Update the `ended` handler inside `playFromIdx` in `app.js`**

Find the `ended` event listener inside `playFromIdx`:
```javascript
  audio.addEventListener('ended', () => {
    audioState.currentIdx++;
    if (audioState.currentIdx < audioState.ayahs.length) {
      playFromIdx(audioState.currentIdx);
    } else {
      // Finished the full range — reset to start
      audioState.currentIdx = 0;
      audioState.playing    = false;
      updateAudioUI();
    }
  });
```
Replace with:
```javascript
  audio.addEventListener('ended', () => {
    audioState.currentIdx++;
    if (audioState.currentIdx < audioState.ayahs.length) {
      playFromIdx(audioState.currentIdx);
    } else {
      audioState.loopsDone++;
      if (audioState.loopsDone < audioState.loopMode) {
        // Start next loop
        audioState.currentIdx = 0;
        playFromIdx(0);
      } else {
        // All loops done — reset
        audioState.currentIdx = 0;
        audioState.loopsDone  = 0;
        audioState.playing    = false;
        updateAudioUI();
      }
    }
  });
```

- [ ] **Step 5: Update `initAudioForItem` to reset loop state in `app.js`**

Find:
```javascript
  audioState.surah      = parsed.surah;
  audioState.ayahs      = parsed.ayahs;
  audioState.currentIdx = 0;
  playerEl.classList.remove('hidden');
```
Replace with:
```javascript
  audioState.surah      = parsed.surah;
  audioState.ayahs      = parsed.ayahs;
  audioState.currentIdx = 0;
  audioState.loopsDone  = 0;
  audioState.loopMode   = getLoopMode();
  playerEl.classList.remove('hidden');
```

- [ ] **Step 6: Add loop button event listeners in `app.js`**

Add these lines immediately after the `reciter-select` change listener (around line 891):

```javascript
document.querySelectorAll('.loop-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.loop;
    audioState.loopMode  = val === 'Infinity' ? Infinity : parseInt(val, 10);
    audioState.loopsDone = 0;
    localStorage.setItem('rf_loop_mode', val);
    updateAudioUI();
  });
});
```

- [ ] **Step 7: Add CSS for loop controls in `style.css`**

Add after the `.audio-controls` rule (search for `.audio-controls {`):

```css
.loop-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.loop-label {
  font-size: 0.75rem;
  color: var(--sub);
  margin-right: 0.1rem;
}

.loop-btns {
  display: flex;
  gap: 0.3rem;
}

.loop-btn {
  padding: 0.25rem 0.55rem;
  border-radius: 20px;
  border: 1.5px solid var(--accent);
  background: transparent;
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
}

.loop-btn.active {
  background: var(--accent);
  color: #fff;
}

.loop-dots {
  display: flex;
  gap: 0.3rem;
  width: 100%;
  padding-left: 0.1rem;
  margin-top: 0.3rem;
}

.loop-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.25;
}

.loop-dot.done {
  opacity: 1;
}
```

- [ ] **Step 8: Manually verify**

Open `http://localhost:3000`, open a review card that has audio. Confirm:
- Repeat row appears below the play controls with 1× 2× 5× ∞ buttons
- Default is 1× (highlighted gold)
- Clicking 2× then pressing play — audio plays through all ayahs twice, label shows "2:1 · loop 1/2" then "2:1 · loop 2/2"
- Two dots appear; first fills in after loop 1 completes
- At end of loop 2, player resets to stopped
- ∞ mode plays continuously until manually paused
- Selected mode persists after page refresh

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html frontend/app.js frontend/style.css
git commit -m "feat: audio loop — repeat recitation 2x, 5x, or infinitely"
```

---

## Task 6: Bump service worker cache

**Files:**
- Modify: `frontend/sw.js` (line 1, cache name string)
- Modify: `frontend/style.css` (line 1, cache version comment)

- [ ] **Step 1: Bump SW cache name in `sw.js`**

Find on line 1:
```javascript
const CACHE = 'retainflow-v24';
```
Change to:
```javascript
const CACHE = 'retainflow-v25';
```

- [ ] **Step 2: Bump cache version comment in `style.css`**

Find the cache comment on line 1 (e.g. `/* SW cache comment: retainflow-v24 */`).
Change `v24` to `v25`.

- [ ] **Step 3: Run full test suite**

```powershell
cd C:\Users\Amir_\Retainflow\backend; npx vitest run
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/sw.js frontend/style.css
git commit -m "chore: bump SW cache to v25"
```

---

## Task 7: Deploy to Fly.io

- [ ] **Step 1: Deploy**

```powershell
cd C:\Users\Amir_\Retainflow
fly deploy
```

- [ ] **Step 2: Smoke test production**

Open `https://amir-buoyant-coral-631.fly.dev` on a mobile browser. Verify:
1. A review card shows mushaf-style flowing Arabic with ۝ markers
2. Add view → Browse by Juz → click Juz 30 → bulk-add row appears → "Add Juz 30" works
3. Audio player shows Repeat row; loop works through 2 cycles
