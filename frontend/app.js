const API = '';  // Same-origin; server serves frontend


// Allowlist used when rendering server data into the DOM (XSS guard)
const VALID_LOG_QUALITIES = new Set(['forgot', 'hard', 'good', 'easy']);

// ── Starter packs ──────────────────────────────────────────────────────────
const STARTER_PACKS = [
  { label: 'Al-Fatiha',     surah:   1, from:  1, to:   7, sub: '7 ayahs · The Opening' },
  { label: 'Al-Ikhlas',     surah: 112, from:  1, to:   4, sub: '4 ayahs · Sincerity' },
  { label: 'Al-Falaq',      surah: 113, from:  1, to:   5, sub: '5 ayahs · The Daybreak' },
  { label: 'An-Nas',        surah: 114, from:  1, to:   6, sub: '6 ayahs · Mankind' },
  { label: 'Al-Mulk',       surah:  67, from:  1, to:  30, sub: '30 ayahs · The Sovereignty' },
  { label: 'Ar-Rahman',     surah:  55, from:  1, to:  78, sub: '78 ayahs · The Merciful' },
  { label: 'Al-Kahf 1–10',  surah:  18, from:  1, to:  10, sub: 'First 10 · The Cave' },
  { label: 'Ya-Sin',        surah:  36, from:  1, to:  83, sub: '83 ayahs · Ya-Sin' },
];

// ── Compat ─────────────────────────────────────────────────────────────────
// crypto.randomUUID() only available iOS 15.4+; fall back to getRandomValues
function generateUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}

// ── State ──────────────────────────────────────────────────────────────────
function getOrCreateUserId() {
  let id = localStorage.getItem('rf_user_id');
  if (!id) {
    id = generateUUID();
    localStorage.setItem('rf_user_id', id);
  }
  return id;
}

let state = {
  userId: getOrCreateUserId(),
  dueItems: [],
  reviewItem: null,
  atLimit: false,
  sessionTotal: 0,
  sessionDone: 0,
};

function saveSession() {
  if (state.dueItems.length === 0) return;
  localStorage.setItem('rf_session', JSON.stringify({
    pendingIds: state.dueItems.map(i => i.item_id),
    total: state.sessionTotal,
  }));
}
function clearSession() { localStorage.removeItem('rf_session'); }
function getSavedSession() {
  try { return JSON.parse(localStorage.getItem('rf_session') ?? 'null'); } catch { return null; }
}

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

// ── Dark mode (with system preference fallback) ────────────────────────────
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  // If user has never manually set a preference, follow the OS
  const saved = localStorage.getItem('rf_theme');
  applyTheme(saved ?? getSystemTheme());
}

document.getElementById('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('rf_theme', next);
});

// Auto-update if OS theme changes while app is open
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('rf_theme')) applyTheme(getSystemTheme());
});

// ── Streak ─────────────────────────────────────────────────────────────────
function getStreak() {
  const count = parseInt(localStorage.getItem('rf_streak_count') ?? '0', 10);
  const date  = localStorage.getItem('rf_streak_date') ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (date === today || date === yesterday) return count;
  return 0;
}

function incrementStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const date  = localStorage.getItem('rf_streak_date') ?? '';
  let count   = parseInt(localStorage.getItem('rf_streak_count') ?? '0', 10);
  if (date === today) return count;          // already counted today
  count = (date === yesterday) ? count + 1 : 1;
  localStorage.setItem('rf_streak_count', String(count));
  localStorage.setItem('rf_streak_date', today);
  return count;
}

// ── Multiple profiles ──────────────────────────────────────────────────────
function getProfiles() {
  try { return JSON.parse(localStorage.getItem('rf_profiles') ?? 'null') || null; } catch { return null; }
}

function initProfiles() {
  let profiles = getProfiles();
  if (!profiles) {
    // First time — seed with the existing anonymous user
    profiles = [{ name: 'My Profile', userId: state.userId }];
    localStorage.setItem('rf_profiles', JSON.stringify(profiles));
  }
  // Ensure current userId is in profiles
  if (!profiles.find(p => p.userId === state.userId)) {
    profiles.push({ name: 'My Profile', userId: state.userId });
    localStorage.setItem('rf_profiles', JSON.stringify(profiles));
  }
}

function renderProfileList() {
  const list = document.getElementById('profile-list');
  const profiles = getProfiles() ?? [];
  list.innerHTML = '';
  profiles.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'profile-item' + (p.userId === state.userId ? ' active' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'profile-item-name';
    nameSpan.textContent = p.name;
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:.4rem';
    if (p.userId === state.userId) {
      const check = document.createElement('span');
      check.className = 'profile-item-check';
      check.textContent = '✓';
      actions.appendChild(check);
    }
    if (profiles.length > 1) {
      const del = document.createElement('button');
      del.className = 'profile-item-delete';
      del.dataset.idx = String(idx);
      del.setAttribute('aria-label', 'Delete profile');
      del.textContent = '✕';
      actions.appendChild(del);
    }
    row.appendChild(nameSpan);
    row.appendChild(actions);
    // Switch on click (not on delete btn)
    row.addEventListener('click', (e) => {
      if (e.target.closest('.profile-item-delete')) return;
      switchProfile(p);
    });
    list.appendChild(row);
  });

  // Delete handler
  list.querySelectorAll('.profile-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const profiles = getProfiles() ?? [];
      const removing = profiles[idx];
      if (removing.userId === state.userId && profiles.length > 1) {
        // Switch to another profile before removing
        const other = profiles.find((_, i) => i !== idx);
        switchProfile(other, false);
      }
      profiles.splice(idx, 1);
      localStorage.setItem('rf_profiles', JSON.stringify(profiles));
      renderProfileList();
    });
  });
}

function switchProfile(profile, closeOverlay = true) {
  state.userId = profile.userId;
  localStorage.setItem('rf_user_id', profile.userId);
  if (closeOverlay) closeProfileOverlay();
  apiFetch('POST', '/api/users', { user_id: state.userId }).then(loadDashboard);
}

function openProfileOverlay() {
  renderProfileList();
  document.getElementById('profile-new-form').classList.add('hidden');
  document.getElementById('profile-name-input').value = '';
  document.getElementById('profile-overlay').classList.remove('hidden');
}

function closeProfileOverlay() {
  document.getElementById('profile-overlay').classList.add('hidden');
}

document.getElementById('profile-close-btn').addEventListener('click', closeProfileOverlay);
document.getElementById('menu-btn').addEventListener('click', openProfileOverlay);
document.getElementById('menu-stats-btn').addEventListener('click', () => {
  closeProfileOverlay();
  loadStats();
});
document.getElementById('profile-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeProfileOverlay();
});

document.getElementById('profile-add-btn').addEventListener('click', () => {
  document.getElementById('profile-new-form').classList.remove('hidden');
  document.getElementById('profile-name-input').focus();
});

document.getElementById('profile-save-btn').addEventListener('click', () => {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) return;
  const newUserId = generateUUID();
  const profiles = getProfiles() ?? [];
  profiles.push({ name, userId: newUserId });
  localStorage.setItem('rf_profiles', JSON.stringify(profiles));
  // Switch to new profile and register it
  switchProfile({ name, userId: newUserId });
});

document.getElementById('profile-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('profile-save-btn').click();
});

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

// ── Text mode (progressive hiding) ────────────────────────────────────────
const TEXT_MODES  = ['full', 'first', 'hidden'];
const MODE_LABELS = { full: '👁 Full', first: '👁 First word', hidden: '🙈 Hidden' };
let textMode = localStorage.getItem('rf_text_mode') ?? 'full';
let contentRevealed = false;

function updateTextModeBtn() {
  document.getElementById('text-mode-btn').textContent = MODE_LABELS[textMode];
}

function toArabicNumeral(n) {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}

function getStartAyah(itemId) {
  if (!itemId) return 1;
  const m = itemId.match(/ayat-(\d+)-\d+$/);
  return m ? parseInt(m[1], 10) : 1;
}

// Render ayah content with word-level Arabic display
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

  let wordCount = 0;
  blocks.forEach((block, blockIdx) => {
    const lines   = block.split('\n');
    const arabic  = lines[0] || '';
    const english = lines.slice(1).join(' ');
    const ayahNum = startAyah + blockIdx;
    const ayahIdx = audioState.ayahs.indexOf(ayahNum);

    // Wrapper section per ayah — used for highlight
    const section = document.createElement('div');
    section.className = 'ayah-section';
    section.dataset.ayahNum = String(ayahNum);

    const flowDiv = document.createElement('div');
    flowDiv.className = 'ar-flow';

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
        // Tap word → play from this ayah
        if (ayahIdx !== -1) {
          span.classList.add('ar-word--tappable');
          span.addEventListener('click', () => {
            audioState.singleAyahMode = false;
            showPlaybackSheet();
            playFromIdx(ayahIdx);
          });
        }
        flowDiv.appendChild(span);
        flowDiv.appendChild(document.createTextNode(' '));
      }
      wordCount++;
    });

    if (!isHidden) {
      const marker = document.createElement('span');
      marker.className = 'ayah-marker';
      marker.textContent = '۝' + toArabicNumeral(ayahNum);
      flowDiv.appendChild(marker);
    }

    section.appendChild(flowDiv);

    // English inline after each ayah
    if (!isHidden && showTranslation && english) {
      const enDiv = document.createElement('div');
      enDiv.className = 'en-verse';
      enDiv.textContent = english;
      section.appendChild(enDiv);
    }

    contentEl.appendChild(section);
  });
}

function applyTextMode(content) {
  contentRevealed = false;
  renderWordLevel(content);
}

document.getElementById('text-mode-btn').addEventListener('click', () => {
  const idx = TEXT_MODES.indexOf(textMode);
  textMode = TEXT_MODES[(idx + 1) % TEXT_MODES.length];
  localStorage.setItem('rf_text_mode', textMode);
  updateTextModeBtn();
  if (state.reviewItem) applyTextMode(filterContent(state.reviewItem.content ?? ''));
});

document.getElementById('reveal-btn').addEventListener('click', () => {
  contentRevealed = true;
  renderWordLevel(filterContent(state.reviewItem?.content ?? ''));
});

// ── Translation toggle ─────────────────────────────────────────────────────
let showTranslation = localStorage.getItem('rf_show_translation') !== 'false';

function filterContent(rawContent) {
  if (showTranslation || !rawContent) return rawContent;
  // Content format: "arabic\nenglish\n\narabic\nenglish\n\n..."
  // Strip all English lines — keep only the first line of each ayah block
  return rawContent
    .split('\n\n')
    .map((block) => block.split('\n')[0])
    .join('\n\n');
}

function updateTranslationBtn() {
  const btn = document.getElementById('translation-btn');
  btn.textContent = showTranslation ? 'EN ✓' : 'EN ✗';
  btn.style.opacity = showTranslation ? '1' : '0.55';
}

document.getElementById('translation-btn').addEventListener('click', () => {
  showTranslation = !showTranslation;
  localStorage.setItem('rf_show_translation', String(showTranslation));
  updateTranslationBtn();
  if (state.reviewItem) renderWordLevel(filterContent(state.reviewItem.content ?? ''));
});

// ── Haptics ────────────────────────────────────────────────────────────────
function haptic(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ── View helpers ───────────────────────────────────────────────────────────
// Views where the bottom nav must be hidden
const NAV_HIDDEN_VIEWS = new Set(['view-review', 'view-landing', 'view-complete']);

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.classList.toggle('nav-hidden', NAV_HIDDEN_VIEWS.has(id));
}

// ── Bottom nav active tab ─────────────────────────────────────────────────
function setActiveTab(action) {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.action === action);
  });
}

document.querySelectorAll('.nav-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const action = tab.dataset.action;
    switch (action) {
      case 'home':    setActiveTab('home');    loadDashboard();       break;
      case 'add':     setActiveTab('add');     openAddView();         break;
    }
  });
});

// ── API helpers ────────────────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: {} };
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  setActiveTab('home');
  showView('view-dashboard');
  state.sessionTotal = 0;
  state.sessionDone  = 0;

  const { data } = await apiFetch('GET', `/api/items/${state.userId}`);
  state.dueItems = Array.isArray(data) ? data : [];

  const saved = getSavedSession();
  const resumeBanner = document.getElementById('resume-banner');
  if (saved && saved.pendingIds?.length > 0) {
    const left = saved.pendingIds.length;
    document.getElementById('resume-label').textContent = `Session in progress — ${left} item${left !== 1 ? 's' : ''} left`;
    resumeBanner.classList.remove('hidden');
  } else {
    resumeBanner.classList.add('hidden');
  }

  if (state.atLimit) {
    document.getElementById('limit-banner').classList.remove('hidden');
  }

  showWelcomeBackIfNeeded();
  renderDueList();
  updateGoalBar();
  renderUpcomingStrip();
  renderStreakChip();
  maybeShowOnboarding();
}

function renderStreakChip() {
  const chip   = document.getElementById('streak-chip');
  if (!chip) return;
  const streak = getStreak();
  if (streak > 0) {
    chip.textContent = `🔥 ${streak}`;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

function showWelcomeBackIfNeeded() {
  const banner   = document.getElementById('welcome-back-banner');
  const textEl   = document.getElementById('welcome-back-text');
  const lastDate = localStorage.getItem('rf_streak_date') ?? '';
  const today    = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const hasItems = localStorage.getItem('rf_has_items') === 'true';
  const due      = state.dueItems.length;

  // Show only when: user has items, was away for >1 day, and has a queue
  if (!hasItems || !lastDate || lastDate === today || due === 0) {
    banner.classList.add('hidden');
    return;
  }

  const daysAway = lastDate === yesterday ? 1
    : Math.round((Date.now() - new Date(lastDate).getTime()) / 86_400_000);
  const daysText = daysAway === 1 ? 'yesterday' : `${daysAway} days ago`;

  textEl.textContent = `Welcome back! You last reviewed ${daysText} — your schedule has been adjusted. ${due} ayah${due === 1 ? '' : 's'} ready.`;
  banner.classList.remove('hidden');
}

function renderDueList() {
  const list       = document.getElementById('due-list');
  const onboard    = document.getElementById('empty-onboard');
  const caughtup   = document.getElementById('empty-caughtup');
  const startBtn   = document.getElementById('start-session-btn');
  const hasItems   = localStorage.getItem('rf_has_items') === 'true';
  list.innerHTML   = '';
  onboard.classList.add('hidden');
  caughtup.classList.add('hidden');
  startBtn.classList.add('hidden');

  if (state.dueItems.length === 0) {
    if (hasItems) caughtup.classList.remove('hidden');
    else          onboard.classList.remove('hidden');
    return;
  }

  // Show start-session button with count
  document.getElementById('start-session-count').textContent = state.dueItems.length;
  startBtn.classList.remove('hidden');

  state.dueItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'item-row';

    const idSpan = document.createElement('span');
    idSpan.className = 'item-id';
    idSpan.textContent = prettyItemId(item.item_id);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Remove';
    deleteBtn.setAttribute('aria-label', `Remove ${prettyItemId(item.item_id)}`);
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => removeItem(item.item_id));

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex;align-items:center;gap:.5rem';

    // Loss-aversion framing: name the decay, not just the lateness.
    const overdueDays = Math.floor((Date.now() - item.next_due_date) / 86_400_000);
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    if (overdueDays >= 2) {
      meta.textContent = `${overdueDays} days overdue — fading`;
      meta.classList.add('item-meta--risk');
    } else if (overdueDays >= 1) {
      meta.textContent = '1 day overdue';
      meta.classList.add('item-meta--risk');
    } else {
      meta.textContent = 'Due now';
    }
    rightGroup.appendChild(meta);
    rightGroup.appendChild(deleteBtn);

    row.appendChild(idSpan);
    row.appendChild(rightGroup);

    row.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      startReview(item);
    });

    list.appendChild(row);
  });
}


async function removeItem(itemId) {
  // Send user_id so the server can verify ownership
  await apiFetch('DELETE', `/api/items/${itemId}`, { user_id: state.userId });
  state.atLimit = false;
  document.getElementById('limit-banner').classList.add('hidden');
  await loadDashboard();
}

// ── Add item — search UI ───────────────────────────────────────────────────
let selectedSurah = null;

function renderStarterPacks() {
  const grid = document.getElementById('packs-grid');
  grid.innerHTML = '';
  STARTER_PACKS.forEach((pack) => {
    const card  = document.createElement('button');
    card.className = 'pack-card';
    const title = document.createElement('span');
    title.className = 'pack-title';
    title.textContent = pack.label;
    const sub   = document.createElement('span');
    sub.className = 'pack-sub';
    sub.textContent = pack.sub;
    card.appendChild(title);
    card.appendChild(sub);
    card.addEventListener('click', () => selectStarterPack(pack));
    grid.appendChild(card);
  });
}

function selectStarterPack(pack) {
  selectedSurah = { surah: pack.surah, name: pack.label };
  document.getElementById('range-surah-label').textContent = `${pack.label} (Surah ${pack.surah})`;
  document.getElementById('range-from').value = pack.from;
  document.getElementById('range-to').value   = pack.to;
  document.getElementById('range-selector').classList.remove('hidden');
  document.getElementById('add-error').classList.add('hidden');
  updateRangePreview();
  document.getElementById('range-selector').scrollIntoView({ behavior: 'smooth' });
}

function switchAddTab(tabName) {
  document.getElementById('range-selector').classList.add('hidden');
  document.querySelectorAll('.add-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('add-tab--active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.add-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `add-panel-${tabName}`);
  });
}
document.querySelectorAll('.add-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAddTab(tab.dataset.tab));
});

function openAddView() {
  setActiveTab('add');
  switchAddTab('quick');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('range-selector').classList.add('hidden');
  document.getElementById('add-error').classList.add('hidden');
  document.getElementById('juz-surahs').classList.add('hidden');
  document.getElementById('juz-single-wrap').classList.add('hidden');
  activeJuz = null;
  selectedSurah = null;
  selectedDifficulty = 'fresh';
  renderStarterPacks();
  renderJuzGrid();
  updateDifficultyPills();
  showView('view-add');
}

document.getElementById('start-session-btn').addEventListener('click', () => {
  if (state.dueItems.length > 0) startReview(state.dueItems[0]);
});

document.getElementById('empty-add-btn').addEventListener('click', openAddView);

// Live search as user types
let searchDebounce = null;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }
  searchDebounce = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  const { status, data } = await apiFetch('GET', `/api/quran/search?q=${encodeURIComponent(q)}`);
  const container = document.getElementById('search-results');
  container.innerHTML = '';
  if (status !== 200 || !Array.isArray(data) || data.length === 0) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--sub);font-size:.9rem;text-align:center;padding:1rem 0';
    msg.textContent = 'No results found.';
    container.appendChild(msg);
    return;
  }
  data.forEach((ayah) => {
    const el      = document.createElement('div');
    el.className  = 'search-result-item';
    const ref     = document.createElement('div');
    ref.className = 'result-ref';
    ref.textContent = `${ayah.surah_name} • ${ayah.surah}:${ayah.ayah}`;
    const arabic  = document.createElement('div');
    arabic.className = 'result-arabic';
    arabic.textContent = ayah.arabic;
    const english = document.createElement('div');
    english.className = 'result-english';
    english.textContent = ayah.english;
    el.appendChild(ref);
    el.appendChild(arabic);
    el.appendChild(english);
    el.addEventListener('click', () => selectAyah(ayah));
    container.appendChild(el);
  });
}

function selectAyah(ayah) {
  selectedSurah = { surah: ayah.surah, name: ayah.surah_name };
  document.getElementById('range-surah-label').textContent = `${ayah.surah_name} (Surah ${ayah.surah})`;
  document.getElementById('range-from').value = ayah.ayah;
  document.getElementById('range-to').value   = ayah.ayah;
  document.getElementById('range-selector').classList.remove('hidden');
  document.getElementById('add-error').classList.add('hidden');
  updateRangePreview();
  document.getElementById('range-selector').scrollIntoView({ behavior: 'smooth' });
}

async function updateRangePreview() {
  if (!selectedSurah) return;
  const from    = parseInt(document.getElementById('range-from').value, 10);
  const to      = parseInt(document.getElementById('range-to').value, 10);
  const preview = document.getElementById('range-preview');
  if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
    preview.textContent = 'Choose a valid range.';
    preview.classList.remove('has-content');
    return;
  }
  const { status, data } = await apiFetch('GET', `/api/quran/${selectedSurah.surah}/${from}/${to}`);
  if (status !== 200 || !Array.isArray(data)) return;
  preview.textContent = data.map((a, i) => `${a.arabic} ۝${toArabicNumeral(from + i)}`).join(' ');
  preview.classList.add('has-content');
}

['range-from', 'range-to'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateRangePreview);
});

document.getElementById('save-item-btn').addEventListener('click', async () => {
  if (!selectedSurah) return;
  const from = parseInt(document.getElementById('range-from').value, 10);
  const to   = parseInt(document.getElementById('range-to').value, 10);
  if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
    const errEl = document.getElementById('add-error');
    errEl.textContent = 'Please enter a valid ayah range.';
    errEl.classList.remove('hidden');
    return;
  }

  const { status: rangeStatus, data: rangeData } = await apiFetch('GET', `/api/quran/${selectedSurah.surah}/${from}/${to}`);
  if (rangeStatus !== 200 || !Array.isArray(rangeData)) {
    document.getElementById('add-error').textContent = 'Could not fetch ayah range.';
    document.getElementById('add-error').classList.remove('hidden');
    return;
  }

  const itemId  = `surah-${selectedSurah.surah}-ayat-${from}-${to}`;
  const content = rangeData.map((a) => `${a.arabic}\n${a.english}`).join('\n\n');

  const diffPreset = DIFFICULTY_INITIAL[selectedDifficulty];
  const initial = {
    interval:      diffPreset.interval,
    ease_factor:   diffPreset.ease_factor,
    repetitions:   diffPreset.repetitions,
    next_due_date: diffPreset.next_due_date(),
  };

  const { status, data } = await apiFetch('POST', '/api/items', {
    user_id: state.userId,
    item_id: itemId,
    content,
    initial,
  });

  if (status === 201) {
    localStorage.setItem('rf_has_items', 'true');
    await loadDashboard();
    announceAdded(prettyItemId(itemId), initial.next_due_date);
  } else if (status === 403) {
    const errEl = document.getElementById('add-error');
    errEl.textContent = data.message;
    errEl.classList.remove('hidden');
    state.atLimit = true;
  } else if (status === 409) {
    document.getElementById('add-error').textContent = 'This range is already in your queue.';
    document.getElementById('add-error').classList.remove('hidden');
  } else {
    document.getElementById('add-error').textContent = data.error ?? 'Unknown error';
    document.getElementById('add-error').classList.remove('hidden');
  }
});


// Tells the user exactly where their new item went and when it returns.
function announceAdded(name, nextDueMs) {
  const days = Math.ceil((nextDueMs - Date.now()) / 86_400_000);
  const when = days <= 0 ? 'today — it\'s in your due list below'
             : days === 1 ? 'tomorrow'
             : `in ${days} days`;
  showToast(`✓ ${name} added — first review ${when}`, 5000);
}

// ── Daily goal ─────────────────────────────────────────────────────────────
function getDailyGoal() {
  return parseInt(localStorage.getItem('rf_daily_goal') ?? '10', 10);
}

function getTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const d = JSON.parse(localStorage.getItem('rf_today_data') ?? '{}');
    return d.date === today ? (d.count ?? 0) : 0;
  } catch { return 0; }
}

function incrementTodayCount() {
  const today = new Date().toISOString().slice(0, 10);
  const count = getTodayCount() + 1;
  localStorage.setItem('rf_today_data', JSON.stringify({ date: today, count }));
  return count;
}

function updateGoalBar() {
  const goal = getDailyGoal();
  const done = getTodayCount();
  const bar  = document.getElementById('goal-bar');
  if (!bar) return;
  if (goal <= 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('goal-done-num').textContent = String(done);
  document.getElementById('goal-total-num').textContent = String(goal);
  const circumference = 175.9; // 2 * π * 28
  const pct = Math.min(done / goal, 1);
  document.getElementById('goal-ring-fill').style.strokeDashoffset = String(circumference * (1 - pct));
}

document.getElementById('goal-edit-btn').addEventListener('click', () => {
  const editor = document.getElementById('goal-editor');
  const input  = document.getElementById('goal-input');
  input.value  = getDailyGoal();
  editor.classList.remove('hidden');
  input.focus();
  input.select();
});

document.getElementById('goal-save-btn').addEventListener('click', () => {
  const val = parseInt(document.getElementById('goal-input').value, 10);
  if (!isNaN(val) && val > 0 && val <= 200) {
    localStorage.setItem('rf_daily_goal', String(val));
    updateGoalBar();
  }
  document.getElementById('goal-editor').classList.add('hidden');
});

document.getElementById('goal-cancel-btn').addEventListener('click', () => {
  document.getElementById('goal-editor').classList.add('hidden');
});

document.getElementById('goal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  document.getElementById('goal-save-btn').click();
  if (e.key === 'Escape') document.getElementById('goal-cancel-btn').click();
});

// ── Audio ──────────────────────────────────────────────────────────────────
const RECITERS = [
  { id: 'Hudhaify_128kbps',                      name: 'Shaykh Ali al-Hudhayfee' },
  { id: 'Salah_Al_Budair_128kbps',               name: 'Shaykh Salah al-Budair'  },
  { id: 'Abdullaah_3awwaad_Al-Juhaynee_128kbps', name: "Abdullāh al-Juhanī"      },
  { id: 'Ibrahim_Akhdar_64kbps',                 name: 'Sheikh Ibrahim al-Akhdar'},
];

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function getLoopMode() {
  const saved = localStorage.getItem('rf_loop_mode');
  if (saved === 'Infinity') return Infinity;
  const n = parseInt(saved ?? '1', 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

let audioState = {
  audio:          null,
  surah:          0,
  ayahs:          [],   // ordered list of ayah numbers to play
  currentIdx:     0,
  playing:        false,
  loopMode:       getLoopMode(),
  loopsDone:      0,
  singleAyahMode: false,
};

function pad3(n) { return String(n).padStart(3, '0'); }

function getReciter() {
  return localStorage.getItem('rf_reciter') ?? 'Hudhaify_128kbps';
}

function ayahAudioUrl(surah, ayah) {
  return `https://everyayah.com/data/${getReciter()}/${pad3(surah)}${pad3(ayah)}.mp3`;
}

function parseItemAyahs(itemId) {
  const m = itemId.match(/^surah-(\d+)-ayat-(\d+)-(\d+)$/);
  if (!m) return null;
  const surah = parseInt(m[1], 10);
  const from  = parseInt(m[2], 10);
  const to    = parseInt(m[3], 10);
  const ayahs = [];
  for (let i = from; i <= to; i++) ayahs.push(i);
  return { surah, ayahs };
}

function updateAudioUI() {
  const btn   = document.getElementById('audio-play-btn');
  const label = document.getElementById('audio-ayah-label');
  const dots  = document.getElementById('loop-dots');

  // Highlight the currently playing ayah section
  const playingAyah = audioState.playing && audioState.ayahs.length
    ? audioState.ayahs[Math.min(audioState.currentIdx, audioState.ayahs.length - 1)]
    : null;
  document.querySelectorAll('.ayah-section').forEach(s => {
    s.classList.toggle('ayah-section--playing', s.dataset.ayahNum === String(playingAyah));
  });

  btn.textContent = audioState.playing ? '▮▮' : '▶';
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

function stopAudio() {
  if (audioState.audio) {
    audioState.audio.pause();
    audioState.audio.src = '';
    audioState.audio = null;
  }
  audioState.singleAyahMode = false;
  audioState.loopsDone      = 0;
  audioState.playing        = false;
  const fill = document.getElementById('ps-fill');
  if (fill) fill.style.width = '0%';
  const cur = document.getElementById('ps-time-cur');
  const rem = document.getElementById('ps-time-rem');
  if (cur) cur.textContent = '0:00';
  if (rem) rem.textContent = '0:00';
  updateAudioUI();
}

function playFromIdx(idx) {
  stopAudio();
  if (!audioState.ayahs.length) return;
  audioState.currentIdx = idx < audioState.ayahs.length ? idx : 0;
  const ayah  = audioState.ayahs[audioState.currentIdx];
  const audio = new Audio(ayahAudioUrl(audioState.surah, ayah));
  audioState.audio   = audio;
  audioState.playing = true;
  updateAudioUI();
  audio.play().catch(() => {
    audioState.playing = false;
    updateAudioUI();
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    const fill = document.getElementById('ps-fill');
    if (fill) fill.style.width = pct + '%';
    const cur = document.getElementById('ps-time-cur');
    const rem = document.getElementById('ps-time-rem');
    if (cur) cur.textContent = fmtTime(audio.currentTime);
    if (rem) rem.textContent = '-' + fmtTime(audio.duration - audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    if (audioState.singleAyahMode) {
      audioState.singleAyahMode = false;
      audioState.loopsDone      = 0;
      audioState.playing        = false;
      updateAudioUI();
      return;
    }
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
}

function initAudioForItem(itemId) {
  if (itemId.match(/^juz-\d+$/)) return;
  stopAudio();
  const parsed = parseItemAyahs(itemId);
  const sheet = document.getElementById('playback-sheet');
  if (!parsed) { sheet.classList.add('hidden'); return; }
  audioState.surah          = parsed.surah;
  audioState.ayahs          = parsed.ayahs;
  audioState.currentIdx     = 0;
  audioState.singleAyahMode = false;
  audioState.loopsDone      = 0;
  audioState.loopMode       = getLoopMode();
  sheet.classList.add('hidden');
  updateAudioUI();
}

document.getElementById('audio-play-btn').addEventListener('click', () => {
  if (audioState.playing) {
    stopAudio();
  } else {
    showPlaybackSheet();
    playFromIdx(audioState.currentIdx);
  }
});

document.getElementById('reciter-select').addEventListener('change', (e) => {
  localStorage.setItem('rf_reciter', e.target.value);
  if (audioState.playing) {
    const idx = audioState.currentIdx;
    playFromIdx(idx);
  }
});

document.querySelectorAll('.loop-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.loop;
    audioState.loopMode  = val === 'Infinity' ? Infinity : parseInt(val, 10);
    audioState.loopsDone = 0;
    localStorage.setItem('rf_loop_mode', val);
    updateAudioUI();
  });
});

// ── Playback sheet swipe-to-dismiss ───────────────────────────────────────
(function () {
  const sheet = document.getElementById('playback-sheet');
  let startY = 0, dragging = false;

  sheet.addEventListener('touchstart', (e) => {
    startY    = e.touches[0].clientY;
    dragging  = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  sheet.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) {
      // Dismissed — slide out then mark as dismissed (audio keeps playing)
      sheet.classList.add('sheet-dismissed');
      sheet.style.transform = '';
    } else {
      // Snap back
      sheet.style.transform = '';
    }
  }, { passive: true });
})();

// ── iOS audio unlock ───────────────────────────────────────────────────────
// iOS blocks audio.play() unless a user gesture triggers it. We unlock once
// on the first tap anywhere in the review view so subsequent word taps work.
let audioUnlocked = false;
function ensureAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const silent = new Audio();
  silent.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  silent.play().catch(() => {});
}
document.getElementById('view-review').addEventListener('touchstart', ensureAudioUnlocked, { once: false, passive: true });

function showPlaybackSheet() {
  const sheet = document.getElementById('playback-sheet');
  sheet.classList.remove('hidden', 'sheet-dismissed');
  sheet.style.transform = '';
}

// ── Playback sheet buttons ─────────────────────────────────────────────────
document.getElementById('ps-prev').addEventListener('click', () => {
  if (audioState.currentIdx > 0) playFromIdx(audioState.currentIdx - 1);
  else playFromIdx(0);
});

document.getElementById('ps-replay').addEventListener('click', () => {
  playFromIdx(audioState.currentIdx);
});

document.getElementById('ps-next-ayah').addEventListener('click', () => {
  if (audioState.currentIdx < audioState.ayahs.length - 1) {
    playFromIdx(audioState.currentIdx + 1);
  }
});


document.getElementById('ps-track').addEventListener('click', (e) => {
  const audio = audioState.audio;
  if (!audio || !audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

function initReciterSelect() {
  const saved = getReciter();
  document.getElementById('reciter-select').value = saved;
}

// ── Review ─────────────────────────────────────────────────────────────────

function updateProgressBar() {
  const pct = state.sessionTotal > 0 ? (state.sessionDone / state.sessionTotal) * 100 : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('review-progress-text').textContent =
    `${state.sessionDone + 1} of ${state.sessionTotal}`;
}

function startReview(item) {
  document.getElementById('rating-key-popover')?.classList.remove('open');
  document.getElementById('rating-key-btn')?.setAttribute('aria-expanded', 'false');
  // Capture total on first card of a session
  if (state.sessionTotal === 0) {
    state.sessionTotal = state.dueItems.length;
    state.sessionDone  = 0;
    saveSession();
  }
  state.reviewItem = item;
  document.getElementById('review-item-id').textContent = item.item_id;
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
  updateProgressBar();
  initAudioForItem(item.item_id);
  haptic(15);
  const intervals = previewIntervals(item);
  ['forgot', 'hard', 'good', 'easy'].forEach(q => {
    const n = intervals[q];
    document.getElementById(`rk-days-${q}`).textContent = n === 1 ? '1 day' : `${n} days`;
  });
  updateIntervalHints(item);
  showView('view-review');
}

function computeInterval(card, quality) {
  const qMap = { forgot: 0, hard: 2, good: 4, easy: 5 };
  const q = qMap[quality];
  if (q < 3) return 1;
  if (card.repetitions === 0) return 1;
  if (card.repetitions === 1) return 6;
  return Math.round(card.interval * card.ease_factor);
}

function updateIntervalHints(card) {
  const intervals = previewIntervals(card);
  const fmt = d => d === 1 ? '1 day' : d < 30 ? `${d} days` : `${Math.round(d/30)}mo`;
  document.getElementById('qi-forgot').textContent = fmt(intervals.forgot);
  document.getElementById('qi-hard').textContent   = fmt(intervals.hard);
  document.getElementById('qi-good').textContent   = fmt(intervals.good);
  document.getElementById('qi-easy').textContent   = fmt(intervals.easy);
}

function previewIntervals(card) {
  return Object.fromEntries(
    ['forgot', 'hard', 'good', 'easy'].map(q => [q, computeInterval(card, q)])
  );
}

async function submitReview(quality) {
  if (!state.reviewItem) return;
  // Capture SM-2 state before review (for undo)
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
  const { data: reviewData } = await apiFetch('PUT', `/api/items/${state.reviewItem.item_id}/review`, { quality, user_id: state.userId });
  state.sessionDone++;
  // The reward moment: show what this review just earned before advancing.
  showIntervalPop(quality, prevState.interval, reviewData?.interval);
  await new Promise(r => setTimeout(r, 850));
  state.dueItems = state.dueItems.filter((i) => i.item_id !== state.reviewItem.item_id);
  if (state.dueItems.length > 0) saveSession(); else clearSession();
  state.reviewItem = null;


  if (state.dueItems.length === 0) showSessionComplete();
  else startReview(state.dueItems[0]);
}

document.getElementById('review-back-btn').addEventListener('click', () => {
  stopAudio();
  clearSession();
  loadDashboard();
});

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

// ── Interval-growth pop (the grading reward) ───────────────────────────────
function formatIvl(days) {
  if (!Number.isFinite(days)) return '';
  if (days < 14)  return `${days}d`;
  if (days < 60)  return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function showIntervalPop(quality, oldIvl, newIvl) {
  let pop = document.getElementById('interval-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'interval-pop';
    pop.setAttribute('role', 'status');
    document.body.appendChild(pop);
  }
  if (quality === 'forgot') {
    pop.textContent = 'Back to daily — we\'ll rebuild it together';
    pop.className = 'interval-pop pop-reset';
  } else if (Number.isFinite(newIvl) && newIvl > (oldIvl ?? 0)) {
    pop.textContent = `↑ ${formatIvl(oldIvl)} → ${formatIvl(newIvl)} — locked in`;
    pop.className = 'interval-pop pop-grow';
  } else if (Number.isFinite(newIvl)) {
    pop.textContent = `Next review in ${formatIvl(newIvl)}`;
    pop.className = 'interval-pop pop-grow';
  } else {
    return; // offline / error — skip the pop, never block the loop
  }
  void pop.offsetWidth; // restart animation
  pop.classList.add('pop-show');
  clearTimeout(pop._t);
  pop._t = setTimeout(() => pop.classList.remove('pop-show'), 800);
}

document.querySelectorAll('.q-btn').forEach((btn) => {
  btn.addEventListener('click', () => submitReview(btn.dataset.quality));
});

// ── Review ⋯ overflow menu ─────────────────────────────────────────────────
const reviewMoreBtn  = document.getElementById('review-more-btn');
const reviewMoreMenu = document.getElementById('review-more-menu');
reviewMoreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isNowHidden = reviewMoreMenu.classList.toggle('hidden');
  reviewMoreBtn.setAttribute('aria-expanded', String(!isNowHidden));
});
document.addEventListener('click', (e) => {
  if (reviewMoreMenu.classList.contains('hidden')) return;
  if (!reviewMoreMenu.contains(e.target) && e.target !== reviewMoreBtn) {
    reviewMoreMenu.classList.add('hidden');
    reviewMoreBtn.setAttribute('aria-expanded', 'false');
  }
});

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

// ── Keyboard shortcuts (desktop) ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Only active when review view is showing
  if (!document.getElementById('view-review').classList.contains('active')) return;
  // Don't fire if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const map = { '1': 'forgot', '2': 'hard', '3': 'good', '4': 'easy' };
  const quality = map[e.key];
  if (quality) {
    e.preventDefault();
    // Flash the button for visual feedback
    const btn = document.querySelector(`.q-btn.q-${quality}`);
    if (btn) { btn.style.transform = 'scale(.95)'; setTimeout(() => { btn.style.transform = ''; }, 120); }
    submitReview(quality);
  }
});

// ── Swipe gestures ─────────────────────────────────────────────────────────
const reviewCardEl = document.getElementById('review-card');
let swipeStartX = 0;
let swipeStartY = 0;

reviewCardEl.addEventListener('touchstart', (e) => {
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
  reviewCardEl.style.transition = 'none';
}, { passive: true });

reviewCardEl.addEventListener('touchmove', (e) => {
  const dx = e.touches[0].clientX - swipeStartX;
  const dy = e.touches[0].clientY - swipeStartY;
  if (Math.abs(dx) < Math.abs(dy)) return; // ignore vertical scroll
  const clamped = Math.max(-130, Math.min(130, dx));
  const pct     = Math.abs(clamped) / 130;
  reviewCardEl.style.transform = `translateX(${clamped * 0.35}px) rotate(${clamped * 0.025}deg)`;
  reviewCardEl.style.boxShadow = dx < 0
    ? `inset 0 0 40px rgba(176,48,48,${pct * 0.55})`
    : `inset 0 0 40px rgba(160,124,0,${pct * 0.55})`;
}, { passive: true });

reviewCardEl.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  reviewCardEl.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
  reviewCardEl.style.transform  = '';
  reviewCardEl.style.boxShadow  = '';
  setTimeout(() => { reviewCardEl.style.transition = ''; }, 220);

  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 80) {
    if (dx < 0) submitReview('forgot');
    else        submitReview('easy');
  }
}, { passive: true });

// ── Stats view ─────────────────────────────────────────────────────────────
const QUALITY_COLORS = { forgot: '#b03030', hard: '#b06000', good: '#2a6090', easy: '#a07c00' };

function relativeDay(ts) {
  const d = Math.round((Date.now() - ts) / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d}d ago`;
}

function prettyItemId(id) {
  const juzMatch = id.match(/^juz-(\d+)$/);
  if (juzMatch) return `Juz ${juzMatch[1]}`;
  const m = id.match(/^surah-(\d+)-ayat-(\d+)-(\d+)$/);
  if (!m) return id;
  const surahNum = parseInt(m[1], 10);
  const entry = SURAHS.find(s => s[0] === surahNum);
  const name = entry ? entry[1] : `Surah ${surahNum}`;
  return `${name} · ${m[2]}–${m[3]}`;
}

async function loadStats() {
  setActiveTab('stats');
  showView('view-stats');
  const { status, data } = await apiFetch('GET', `/api/stats/${state.userId}`);
  if (status !== 200) return;

  const { totalItems, allTimeReviews, log } = data;
  const today = new Date().toISOString().slice(0, 10);

  // Compute derived stats from log
  const reviewsByDay = {};
  const qualityCount = { forgot: 0, hard: 0, good: 0, easy: 0 };
  let todayReviews = 0, weekReviews = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;

  (log || []).forEach(entry => {
    const day = new Date(entry.reviewed_at).toISOString().slice(0, 10);
    reviewsByDay[day] = (reviewsByDay[day] || 0) + 1;
    if (entry.quality in qualityCount) qualityCount[entry.quality]++;
    if (day === today) todayReviews++;
    if (entry.reviewed_at >= weekAgo) weekReviews++;
  });

  // KPI grid
  const kpiEl = document.getElementById('stats-grid');
  kpiEl.innerHTML = '';
  [
    { num: totalItems,      label: 'ranges tracked' },
    { num: getTodayCount(), label: 'reviewed today' },
    { num: weekReviews,     label: 'this week' },
    { num: allTimeReviews,  label: 'all time' },
  ].forEach(({ num, label }) => {
    const box = document.createElement('div');
    box.className = 'stats-kpi';
    box.innerHTML = `<div class="stats-kpi-num">${num}</div><div class="stats-kpi-label">${label}</div>`;
    kpiEl.appendChild(box);
  });

  // Heatmap — last 14 days
  const hmEl = document.getElementById('stats-heatmap');
  hmEl.innerHTML = '';
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const count = reviewsByDay[d] || 0;
    const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
    const sq = document.createElement('div');
    sq.className = 'hm-day';
    sq.setAttribute('data-level', level);
    sq.title = `${d}: ${count} review${count !== 1 ? 's' : ''}`;
    hmEl.appendChild(sq);
  }

  // Quality bar
  const qEl = document.getElementById('stats-quality');
  const total = Object.values(qualityCount).reduce((a, b) => a + b, 0) || 1;
  qEl.innerHTML = '';
  const barWrap = document.createElement('div');
  barWrap.className = 'stats-quality-wrap';
  const legend = document.createElement('div');
  legend.className = 'quality-legend';
  Object.entries(qualityCount).forEach(([q, n]) => {
    if (n === 0) return; // skip zero-count qualities
    const seg = document.createElement('div');
    seg.className = 'quality-seg';
    seg.style.cssText = `background:${QUALITY_COLORS[q]};flex:${n}`;
    barWrap.appendChild(seg);
    const li = document.createElement('div');
    li.className = 'q-leg-item';
    const dot = document.createElement('span');
    dot.className = 'q-leg-dot';
    dot.style.background = QUALITY_COLORS[q];
    li.appendChild(dot);
    li.appendChild(document.createTextNode(`${q} (${n})`));
    legend.appendChild(li);
  });
  qEl.appendChild(barWrap);
  qEl.appendChild(legend);

  // Recent log
  const logEl = document.getElementById('stats-log');
  logEl.innerHTML = '';
  if (!log || log.length === 0) {
    logEl.innerHTML = '<p style="color:var(--sub);font-size:.85rem;text-align:center;padding:1rem 0">No reviews yet.</p>';
    return;
  }
  log.slice(0, 40).forEach(entry => {
    // Use DOM methods throughout — no innerHTML with server-sourced data (XSS prevention)
    const row = document.createElement('div');
    row.className = 'log-row';

    const itemSpan = document.createElement('span');
    itemSpan.className = 'log-item';
    itemSpan.textContent = prettyItemId(entry.item_id);

    const right = document.createElement('div');
    right.className = 'log-right';

    const qualitySpan = document.createElement('span');
    // Quality is server-validated to one of: forgot/hard/good/easy — safe as a class name
    qualitySpan.className = `log-quality ${VALID_LOG_QUALITIES.has(entry.quality) ? entry.quality : ''}`;
    qualitySpan.textContent = VALID_LOG_QUALITIES.has(entry.quality) ? entry.quality : '?';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'log-date';
    dateSpan.textContent = relativeDay(entry.reviewed_at);

    right.appendChild(qualitySpan);
    right.appendChild(dateSpan);
    row.appendChild(itemSpan);
    row.appendChild(right);
    logEl.appendChild(row);
  });
}


// ── Session complete ───────────────────────────────────────────────────────
function showSessionComplete() {
  clearSession();
  const streak = incrementStreak();
  haptic([40, 20, 40, 20, 80]);
  // Dismiss any lingering undo toast
  const toast = document.getElementById('app-toast');
  if (toast) { clearTimeout(toast._timer); toast.classList.remove('toast-show'); }
  document.getElementById('complete-count').textContent  = state.sessionDone;
  document.getElementById('complete-streak').textContent = streak;
  document.getElementById('complete-sub').textContent = 'Come back tomorrow to keep your streak going.';
  showView('view-complete');
  renderTomorrowHook(); // fire-and-forget — fills in the unfinished-state line
}

// Retention hook: surface tomorrow's due items so the session never feels "finished".
async function renderTomorrowHook() {
  const el = document.getElementById('complete-sub');
  const { status, data } = await apiFetch('GET', `/api/items/${state.userId}/all`);
  if (status !== 200 || !Array.isArray(data) || data.length === 0) return;

  const now = Date.now();
  const endOfTomorrow = new Date();
  endOfTomorrow.setHours(23, 59, 59, 999);
  const tomorrowCutoff = endOfTomorrow.getTime() + 86_400_000;

  const upcoming = data
    .filter(i => i.next_due_date > now)
    .sort((x, y) => x.next_due_date - y.next_due_date);
  if (upcoming.length === 0) return;

  const dueTomorrow = upcoming.filter(i => i.next_due_date <= tomorrowCutoff);
  if (dueTomorrow.length > 0) {
    const names = dueTomorrow.map(i => prettyItemId(i.item_id));
    if (names.length === 1)      el.textContent = `${names[0]} comes due tomorrow — your schedule continues.`;
    else if (names.length === 2) el.textContent = `${names[0]} and ${names[1]} come due tomorrow.`;
    else                         el.textContent = `${names[0]}, ${names[1]} and ${names.length - 2} more come due tomorrow.`;
  } else {
    const next = upcoming[0];
    const days = Math.max(1, Math.ceil((next.next_due_date - now) / 86_400_000));
    el.textContent = `Next up: ${prettyItemId(next.item_id)} in ${days} day${days === 1 ? '' : 's'}. Nothing slips on this schedule.`;
  }
}

document.getElementById('complete-add-btn').addEventListener('click', openAddView);
document.getElementById('complete-home-btn').addEventListener('click', loadDashboard);

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

// ── Toast helper ───────────────────────────────────────────────────────────
function showToast(html, durationMs = 4000, { top = false } = {}) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.className = 'toast' + (top ? ' toast--top' : '');
  el.innerHTML = html;
  el.classList.add('toast-show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('toast-show'), durationMs);
}

// ── Premium / Stripe checkout ──────────────────────────────────────────────
async function startCheckout() {
  showToast('Opening secure checkout…', 2000);
  const { status, data } = await apiFetch('POST', '/api/billing/checkout', { user_id: state.userId });
  if (status === 200 && data?.url) {
    window.location.href = data.url; // Stripe-hosted page
  } else if (status === 503) {
    showToast('✨ Premium opens soon — <a href="mailto:amrrehmandin@gmail.com">email us</a> for early access');
  } else {
    showToast('Could not start checkout. Please try again.');
  }
}
document.getElementById('upgrade-btn').addEventListener('click', startCheckout);
const settingsUpgrade = document.getElementById('settings-upgrade-btn');
if (settingsUpgrade) settingsUpgrade.addEventListener('click', startCheckout);

// Reflect tier in the UI; hide upgrade prompts for premium users.
async function refreshTier() {
  const { status, data } = await apiFetch('GET', `/api/me/${state.userId}`);
  if (status !== 200) return;
  const isPremium = data?.tier === 'premium';
  document.body.classList.toggle('is-premium', isPremium);
  const ps = document.getElementById('premium-status');
  const su = document.getElementById('settings-upgrade-btn');
  if (isPremium && ps) ps.textContent = '✓ Lifetime Premium active — unlimited ranges. Jazak Allahu khayran.';
  if (isPremium && su) su.style.display = 'none';
  if (isPremium) document.getElementById('limit-banner')?.classList.add('hidden');
}

// Handle Stripe redirect back to the app.
(function handleUpgradeReturn() {
  const p = new URLSearchParams(window.location.search);
  const r = p.get('upgrade');
  if (!r) return;
  window.history.replaceState({}, '', window.location.pathname);
  if (r === 'success') {
    // Webhook may lag a second or two; poll briefly.
    let tries = 0;
    const poll = setInterval(async () => {
      await refreshTier();
      if (document.body.classList.contains('is-premium') || ++tries > 5) {
        clearInterval(poll);
        if (document.body.classList.contains('is-premium'))
          showToast('✓ Premium unlocked — unlimited ranges enabled.');
      }
    }, 1500);
  } else if (r === 'cancelled') {
    showToast('Checkout cancelled — no charge made.');
  }
})();


// ── Recovery code, export, restore ─────────────────────────────────────────
function copyText(text, okMsg) {
  const done = () => showToast(okMsg ?? 'Copied');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => done());
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove(); done();
  }
}

function populateRecoveryUI() {
  const code = state.userId;
  const obCode = document.getElementById('ob-recovery-code');
  const setCode = document.getElementById('settings-recovery-code');
  if (obCode) obCode.textContent = code;
  if (setCode) setCode.textContent = code;
}

document.getElementById('ob-recovery-copy')?.addEventListener('click',
  () => copyText(state.userId, 'Recovery code copied — keep it safe'));
document.getElementById('settings-recovery-copy')?.addEventListener('click',
  () => copyText(state.userId, 'Recovery code copied — keep it safe'));

document.getElementById('export-btn')?.addEventListener('click', () => {
  // Direct download via the export endpoint (sets Content-Disposition).
  window.location.href = `/api/export/${encodeURIComponent(state.userId)}`;
});

document.getElementById('restore-code-btn')?.addEventListener('click', () => {
  const input = document.getElementById('restore-code-input');
  const code = (input?.value ?? '').trim();
  if (!code || code.length > 200) { showToast('Enter a valid recovery code'); return; }
  if (code === state.userId) { showToast('That code is already active'); return; }
  switchProfile({ name: 'Restored Profile', userId: code });
  showToast('Profile restored');
});

// Ask the browser to persist storage so iOS/Safari is less likely to evict it.
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {}
}

// ── Juz browser ────────────────────────────────────────────────────────────
// [surah_number, transliteration_name, total_ayahs]
const SURAHS = [
  [1,'Al-Fatiha',7],[2,'Al-Baqarah',286],[3,'Al-Imran',200],[4,'An-Nisa',176],
  [5,'Al-Maidah',120],[6,'Al-Anam',165],[7,'Al-Araf',206],[8,'Al-Anfal',75],
  [9,'At-Tawbah',129],[10,'Yunus',109],[11,'Hud',123],[12,'Yusuf',111],
  [13,"Ar-Ra'd",43],[14,'Ibrahim',52],[15,'Al-Hijr',99],[16,'An-Nahl',128],
  [17,"Al-Isra",111],[18,'Al-Kahf',110],[19,'Maryam',98],[20,'Ta-Ha',135],
  [21,"Al-Anbiya",112],[22,'Al-Hajj',78],[23,"Al-Muminun",118],[24,'An-Nur',64],
  [25,'Al-Furqan',77],[26,"Ash-Shuara",227],[27,'An-Naml',93],[28,'Al-Qasas',88],
  [29,"Al-Ankabut",69],[30,'Ar-Rum',60],[31,'Luqman',34],[32,'As-Sajdah',30],
  [33,'Al-Ahzab',73],[34,"Saba",54],[35,'Fatir',45],[36,'Ya-Sin',83],
  [37,"As-Saffat",182],[38,'Sad',88],[39,'Az-Zumar',75],[40,'Ghafir',85],
  [41,'Fussilat',54],[42,"Ash-Shura",53],[43,'Az-Zukhruf',89],[44,'Ad-Dukhan',59],
  [45,'Al-Jathiyah',37],[46,'Al-Ahqaf',35],[47,'Muhammad',38],[48,'Al-Fath',29],
  [49,'Al-Hujurat',18],[50,'Qaf',45],[51,"Adh-Dhariyat",60],[52,"At-Tur",49],
  [53,'An-Najm',62],[54,'Al-Qamar',55],[55,'Ar-Rahman',78],[56,'Al-Waqiah',96],
  [57,'Al-Hadid',29],[58,'Al-Mujadila',22],[59,'Al-Hashr',24],[60,'Al-Mumtahanah',13],
  [61,'As-Saf',14],[62,'Al-Jumuah',11],[63,'Al-Munafiqun',11],[64,'At-Taghabun',18],
  [65,'At-Talaq',12],[66,'At-Tahrim',12],[67,'Al-Mulk',30],[68,'Al-Qalam',52],
  [69,'Al-Haqqah',52],[70,"Al-Ma'arij",44],[71,'Nuh',28],[72,'Al-Jinn',28],
  [73,'Al-Muzzammil',20],[74,'Al-Muddaththir',56],[75,'Al-Qiyamah',40],
  [76,'Al-Insan',31],[77,'Al-Mursalat',50],[78,"An-Naba",40],[79,"An-Nazi'at",46],
  [80,"Abasa",42],[81,'At-Takwir',29],[82,'Al-Infitar',19],[83,'Al-Mutaffifin',36],
  [84,'Al-Inshiqaq',25],[85,'Al-Buruj',22],[86,'At-Tariq',17],[87,"Al-A'la",19],
  [88,'Al-Ghashiyah',26],[89,'Al-Fajr',30],[90,'Al-Balad',20],[91,'Ash-Shams',15],
  [92,'Al-Layl',21],[93,'Ad-Duha',11],[94,'Ash-Sharh',8],[95,'At-Tin',8],
  [96,'Al-Alaq',19],[97,'Al-Qadr',5],[98,'Al-Bayyinah',8],[99,'Az-Zalzalah',8],
  [100,"Al-'Adiyat",11],[101,'Al-Qariah',11],[102,'At-Takathur',8],[103,'Al-Asr',3],
  [104,'Al-Humazah',9],[105,'Al-Fil',5],[106,'Quraysh',4],[107,"Al-Ma'un",7],
  [108,'Al-Kawthar',3],[109,'Al-Kafirun',6],[110,'An-Nasr',3],[111,'Al-Masad',5],
  [112,'Al-Ikhlas',4],[113,'Al-Falaq',5],[114,'An-Nas',6],
];

// First surah:ayah of each Juz (1-indexed, so JUZ_STARTS[0] = Juz 1)
const JUZ_STARTS = [
  [1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],
  [9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],
  [29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1],
];

function getSurahsInJuz(juzNum) {
  const [startS, startA] = JUZ_STARTS[juzNum - 1];
  const [endS, endA] = juzNum < 30 ? JUZ_STARTS[juzNum] : [114, 6];
  const results = [];
  for (let s = startS; s <= endS; s++) {
    const surah = SURAHS.find(x => x[0] === s);
    if (!surah) continue;
    const totalAyahs = surah[2];
    const from = (s === startS) ? startA : 1;
    const to   = (s === endS)   ? endA   : totalAyahs;
    const partial = (from > 1 || to < totalAyahs);
    results.push({ surah: s, name: surah[1], from, to, total: totalAyahs, partial });
  }
  return results;
}

let activeJuz = null;

function renderJuzGrid() {
  const grid = document.getElementById('juz-grid');
  grid.innerHTML = '';
  for (let j = 1; j <= 30; j++) {
    const btn = document.createElement('button');
    btn.className = 'juz-btn';
    btn.textContent = j;
    btn.setAttribute('aria-label', `Juz ${j}`);
    btn.addEventListener('click', () => selectJuz(j, btn));
    grid.appendChild(btn);
  }
}

function getJuzChunk() {
  return parseInt(localStorage.getItem('rf_juz_chunk') ?? '10', 10);
}

async function addJuzItems(juzNum, chunkSize) {
  const difficulty = selectedDifficulty;
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
    if (rs !== 200 || !Array.isArray(rd)) {
      statusEl.textContent = `Network error fetching ${chunk.surah}:${chunk.from}–${chunk.to}. ${added} added so far.`;
      return;
    }

    const itemId  = `surah-${chunk.surah}-ayat-${chunk.from}-${chunk.to}`;
    const content = rd.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
    const preset  = DIFFICULTY_INITIAL[difficulty];

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

  if (added > 0) localStorage.setItem('rf_has_items', 'true');
  await loadDashboard();
  showToast(`✓ ${added} item${added !== 1 ? 's' : ''} added — first reviews start today`, 5000);
}

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
    await loadDashboard();
    announceAdded(`Juz ${juzNum}`, DIFFICULTY_INITIAL[selectedDifficulty].next_due_date());
  } else if (status === 409) {
    if (statusEl) statusEl.textContent = `Juz ${juzNum} is already in your queue.`;
  } else if (status === 403) {
    state.atLimit = true;
    if (statusEl) statusEl.textContent = data.message ?? 'Limit reached.';
  } else {
    if (statusEl) statusEl.textContent = data?.error ?? 'Error adding item.';
  }
}

document.getElementById('juz-single-btn').addEventListener('click', () => {
  if (activeJuz) addSingleJuzItem(activeJuz);
});

function selectJuz(juzNum, btn) {
  // Toggle off if same juz clicked again
  if (activeJuz === juzNum) {
    activeJuz = null;
    document.querySelectorAll('.juz-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('juz-surahs').classList.add('hidden');
    return;
  }
  activeJuz = juzNum;
  document.querySelectorAll('.juz-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

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
    const row = document.createElement('div');
    row.className = 'juz-surah-row';
    row.innerHTML = `
      <span class="juz-surah-name">${name}</span>
      <span class="juz-surah-meta">${partial ? `${from}–${to}` : `${to} ayahs`}</span>`;
    row.addEventListener('click', () => {
      selectedSurah = { surah, name };
      document.getElementById('range-surah-label').textContent = `${name} (Surah ${surah})`;
      document.getElementById('range-from').value = from;
      document.getElementById('range-to').value   = to;
      document.getElementById('range-selector').classList.remove('hidden');
      document.getElementById('add-error').classList.add('hidden');
      updateRangePreview();
      document.getElementById('range-selector').scrollIntoView({ behavior: 'smooth' });
    });
    container.appendChild(row);
  });
  container.classList.remove('hidden');
  document.getElementById('juz-single-num').textContent = juzNum;
  document.getElementById('juz-single-wrap').classList.remove('hidden');
}

// ── Difficulty calibration ─────────────────────────────────────────────────
let selectedDifficulty = 'fresh'; // 'fresh' | 'solid' | 'rusty'

const DIFFICULTY_INITIAL = {
  fresh: { interval: 1,  ease_factor: 2.5, repetitions: 0, next_due_date: () => Date.now() },
  solid: { interval: 7,  ease_factor: 2.7, repetitions: 2, next_due_date: () => Date.now() + 7 * 86_400_000 },
  rusty: { interval: 1,  ease_factor: 1.8, repetitions: 0, next_due_date: () => Date.now() },
};

function updateDifficultyPills() {
  document.querySelectorAll('.diff-pill').forEach(btn => {
    const isActive = btn.dataset.difficulty === selectedDifficulty;
    btn.classList.toggle('diff-pill--active', isActive);
  });
}

document.querySelectorAll('.diff-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedDifficulty = btn.dataset.difficulty;
    updateDifficultyPills();
  });
});

// ── Retention score ─────────────────────────────────────────────────────────
// 100 when every item is reviewed on schedule. Each item loses up to a full
// share as it goes overdue (capped at 7 days). Falls daily when you skip,
// recovers when you catch up — a thing to MAINTAIN, not a streak to lose once.
function updateRetentionChip(items) {
  const chip = document.getElementById('retention-chip');
  if (!chip) return;
  if (!items || items.length === 0) { chip.classList.add('hidden'); return; }
  const now = Date.now();
  const penalty = items.reduce((sum, i) => {
    const overdueDays = Math.max(0, (now - i.next_due_date) / 86_400_000);
    return sum + Math.min(overdueDays, 7) / 7;
  }, 0);
  const score = Math.round(100 * (1 - penalty / items.length));
  chip.textContent = `🛡 ${score}`;
  chip.classList.remove('hidden');
}

// ── Upcoming 7-day strip ───────────────────────────────────────────────────
async function renderUpcomingStrip() {
  const strip = document.getElementById('upcoming-strip');
  if (!strip) return;

  const { status, data } = await apiFetch('GET', `/api/items/${state.userId}/all`);
  updateRetentionChip(status === 200 && Array.isArray(data) ? data : []);
  if (status !== 200 || !Array.isArray(data) || data.length === 0) {
    strip.classList.add('hidden');
    return;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dayCounts = [];
  for (let d = 0; d < 7; d++) {
    const start = todayStart.getTime() + d * 86_400_000;
    const end   = start + 86_400_000;
    const count = data.filter(item => item.next_due_date >= start && item.next_due_date < end).length;
    let label;
    if      (d === 0) label = 'Today';
    else if (d === 1) label = 'Tmrw';
    else              label = new Date(start).toLocaleDateString('en', { weekday: 'short' });
    dayCounts.push({ label, count, isToday: d === 0 });
  }

  strip.innerHTML = '';
  dayCounts.forEach(({ label, count, isToday }) => {
    const cell = document.createElement('div');
    cell.className = 'upcoming-cell' + (isToday ? ' upcoming-today' : '');
    cell.innerHTML = `<span class="upcoming-count">${count > 0 ? count : '–'}</span><span class="upcoming-day">${label}</span>`;
    strip.appendChild(cell);
  });
  strip.classList.remove('hidden');
}

// ── My Queue view ──────────────────────────────────────────────────────────
let queueAllItems = [];

async function loadQueue(open = true) {
  const wrap = document.getElementById('queue-wrap');
  if (open) {
    wrap.classList.remove('hidden');
    updateQueueToggleLabel();
  }
  document.getElementById('queue-search').value = '';
  const { status, data } = await apiFetch('GET', `/api/items/${state.userId}/all`);
  if (status !== 200 || !Array.isArray(data)) return;
  queueAllItems = data;
  renderQueue(queueAllItems);
}

function renderQueue(items) {
  const container = document.getElementById('queue-content');
  container.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent = 'No ayah ranges tracked yet. Add some to get started.';
    container.appendChild(empty);
    return;
  }

  const now        = Date.now();
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const tomorrowEnd = new Date(todayEnd.getTime() + 86_400_000);
  const weekEnd     = new Date(todayEnd.getTime() + 6 * 86_400_000);

  const groups = [
    { label: 'Due now',   items: items.filter(i => i.next_due_date <= now) },
    { label: 'Tomorrow',  items: items.filter(i => i.next_due_date > now       && i.next_due_date <= tomorrowEnd.getTime()) },
    { label: 'This week', items: items.filter(i => i.next_due_date > tomorrowEnd.getTime() && i.next_due_date <= weekEnd.getTime()) },
    { label: 'Later',     items: items.filter(i => i.next_due_date > weekEnd.getTime()) },
  ];

  groups.forEach(({ label, items: groupItems }) => {
    if (groupItems.length === 0) return;
    const section = document.createElement('div');
    section.className = 'queue-section';
    const heading = document.createElement('h3');
    heading.className = 'queue-section-title';
    heading.textContent = `${label} (${groupItems.length})`;
    section.appendChild(heading);

    groupItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'queue-item-row';
      const daysUntil = Math.ceil((item.next_due_date - now) / 86_400_000);
      const dueText   = item.next_due_date <= now ? 'Due now'
                      : daysUntil === 1 ? 'Tomorrow'
                      : `In ${daysUntil}d`;
      const easeLabel = item.ease_factor < 1.7 ? 'Rusty'
                      : item.ease_factor > 2.4 ? 'Strong'
                      : 'Learning';
      // Use DOM methods — never innerHTML with server data (XSS prevention)
      const main = document.createElement('div');
      main.className = 'queue-item-main';
      const idSpan = document.createElement('span');
      idSpan.className = 'queue-item-id';
      idSpan.textContent = prettyItemId(item.item_id);
      const metaSpan = document.createElement('span');
      metaSpan.className = 'queue-item-meta';
      metaSpan.textContent = `${easeLabel} · ×${item.repetitions} rep`;
      main.appendChild(idSpan);
      main.appendChild(metaSpan);
      const dueSpan = document.createElement('span');
      dueSpan.className = 'queue-item-due';
      dueSpan.textContent = dueText;
      row.appendChild(main);
      row.appendChild(dueSpan);
      // Edit button (only for surah range items, not juz items)
      if (item.item_id.match(/^surah-\d+-ayat-\d+-\d+$/)) {
        const editBtn = document.createElement('button');
        editBtn.className = 'queue-edit-btn';
        editBtn.setAttribute('aria-label', 'Edit range');
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditModal(item.item_id);
        });
        row.appendChild(editBtn);
      }
      section.appendChild(row);
    });
    container.appendChild(section);
  });
}

// ── Edit range modal ──────────────────────────────────────────────────────
let editingItemId = null;

function openEditModal(itemId) {
  editingItemId = itemId;
  const m = itemId.match(/^surah-(\d+)-ayat-(\d+)-(\d+)$/);
  if (!m) return;
  const [, surah, from, to] = m;
  const surahName = SURAHS.find(s => s[0] === parseInt(surah, 10))?.[1] ?? `Surah ${surah}`;
  document.getElementById('edit-modal-surah').textContent = `${surahName} (Surah ${surah})`;
  document.getElementById('edit-range-from').value = from;
  document.getElementById('edit-range-to').value = to;
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
  const from = parseInt(document.getElementById('edit-range-from').value, 10);
  const to = parseInt(document.getElementById('edit-range-to').value, 10);
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
    await loadDashboard();
    if (!document.getElementById('queue-wrap').classList.contains('hidden')) await loadQueue(false);
  } else {
    document.getElementById('edit-range-error').textContent = data?.message ?? data?.error ?? 'Error saving.';
    document.getElementById('edit-range-error').classList.remove('hidden');
  }
});

// ── Daily notifications ────────────────────────────────────────────────────
function getNotifSettings() {
  try { return JSON.parse(localStorage.getItem('rf_notif') ?? 'null') || { enabled: false, time: '08:00' }; }
  catch { return { enabled: false, time: '08:00' }; }
}

function saveNotifSettings(s) {
  localStorage.setItem('rf_notif', JSON.stringify(s));
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function msUntilTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now    = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

let notifTimer = null;

function scheduleNotification() {
  clearTimeout(notifTimer);
  const s = getNotifSettings();
  if (!s.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  notifTimer = setTimeout(() => {
    new Notification("muraja'ah", {
      body: `Time for your daily Quran revision — your due ayahs are waiting.`,
      icon: '/icon-192.png',
    });
    scheduleNotification(); // reschedule for tomorrow
  }, msUntilTime(s.time));
}

function updateNotifUI() {
  const toggle    = document.getElementById('notif-toggle');
  const timeInput = document.getElementById('notif-time');
  const status    = document.getElementById('notif-status');
  if (!toggle) return;

  const s = getNotifSettings();
  timeInput.value = s.time;

  if (!('Notification' in window)) {
    toggle.disabled = true;
    status.textContent = 'Notifications not supported in this browser.';
    return;
  }
  if (Notification.permission === 'denied') {
    toggle.textContent = 'Enable';
    toggle.classList.remove('notif-on');
    status.textContent = 'Notifications blocked — allow in browser settings.';
    return;
  }
  if (s.enabled && Notification.permission === 'granted') {
    toggle.textContent = 'Disable';
    toggle.classList.add('notif-on');
    status.textContent = `Reminder set for ${s.time} daily.`;
  } else {
    toggle.textContent = 'Enable';
    toggle.classList.remove('notif-on');
    status.textContent = '';
  }
}

document.getElementById('notif-toggle').addEventListener('click', async () => {
  const s = getNotifSettings();
  s.time = document.getElementById('notif-time').value || '08:00';
  if (s.enabled) {
    s.enabled = false;
    clearTimeout(notifTimer);
  } else {
    const granted = await requestNotifPermission();
    if (!granted) { saveNotifSettings(s); updateNotifUI(); return; }
    s.enabled = true;
    scheduleNotification();
  }
  saveNotifSettings(s);
  updateNotifUI();
});

document.getElementById('notif-time').addEventListener('change', () => {
  const s = getNotifSettings();
  if (!s.enabled) return;
  s.time = document.getElementById('notif-time').value;
  saveNotifSettings(s);
  clearTimeout(notifTimer);
  scheduleNotification();
  updateNotifUI();
});

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

let obAdvancing = false;

function renderObSuggestions(packs) {
  const container = document.getElementById('ob-suggestions');
  container.innerHTML = '';
  packs.forEach(pack => {
    const row = document.createElement('div');
    row.className = 'ob-suggestion-item';

    const left = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'ob-suggestion-label';
    labelEl.textContent = pack.label;
    const subEl = document.createElement('div');
    subEl.className = 'ob-suggestion-sub';
    subEl.textContent = pack.sub;
    left.appendChild(labelEl);
    left.appendChild(subEl);
    const plus = document.createElement('span');
    plus.style.cssText = 'color:var(--accent);font-size:1.1rem';
    plus.textContent = '＋';
    row.appendChild(left);
    row.appendChild(plus);

    row.addEventListener('click', async () => {
      if (obAdvancing) return;
      row.style.opacity = '.5';
      row.style.pointerEvents = 'none';
      const { status: rs, data: rd } = await apiFetch('GET', `/api/quran/${pack.surah}/${pack.from}/${pack.to}`);
      if (rs !== 200) {
        row.style.opacity = '1';
        row.style.pointerEvents = '';
        return;
      }
      const content = rd.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
      const { status: ps } = await apiFetch('POST', '/api/items', {
        user_id: state.userId,
        item_id: `surah-${pack.surah}-ayat-${pack.from}-${pack.to}`,
        content,
        initial: { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: Date.now() },
      });
      if (ps !== 201) {
        row.style.opacity = '1';
        row.style.pointerEvents = '';
        return;
      }
      localStorage.setItem('rf_has_items', 'true');
      plus.textContent = '✓';
      plus.style.color = 'green';
      plus.style.fontSize = '1.1rem';
      row.style.opacity = '1';
      // Show step 3 after first add
      obAdvancing = true;
      setTimeout(() => {
        document.getElementById('ob-step-2').classList.add('hidden');
        document.getElementById('ob-step-3').classList.remove('hidden');
        populateRecoveryUI();
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

// ── Landing ────────────────────────────────────────────────────────────────
function startFromLanding() {
  localStorage.setItem('rf_has_visited', 'true');
  const lp = document.getElementById('view-landing');
  lp.classList.add('lp-exiting');
  setTimeout(() => {
    apiFetch('POST', '/api/users', { user_id: state.userId }).then(loadDashboard);
  }, 320);
}

document.getElementById('landing-cta-btn').addEventListener('click', startFromLanding);
document.getElementById('landing-cta-btn-2').addEventListener('click', startFromLanding);

function updateQueueToggleLabel() {
  const btn = document.getElementById('queue-toggle-btn');
  const open = !document.getElementById('queue-wrap').classList.contains('hidden');
  btn.textContent = open ? 'My full queue ▴' : 'My full queue ▾';
  btn.setAttribute('aria-expanded', String(open));
}

document.getElementById('queue-toggle-btn').addEventListener('click', async () => {
  const wrap = document.getElementById('queue-wrap');
  const opening = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden');
  updateQueueToggleLabel();
  if (opening) await loadQueue(false);
});

document.getElementById('queue-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderQueue(q
    ? queueAllItems.filter(i => prettyItemId(i.item_id).toLowerCase().includes(q))
    : queueAllItems
  );
});

// ── Init ───────────────────────────────────────────────────────────────────
initTheme();
initReciterSelect();
updateTranslationBtn();
updateTextModeBtn();
initProfiles();
updateNotifUI();
scheduleNotification();


// ── Install prompt (PWA) ───────────────────────────────────────────────────
let deferredInstall = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  maybeShowInstallBanner();
});

function maybeShowInstallBanner() {
  if (isStandalone) return;
  if (localStorage.getItem('rf_install_dismissed') === '1') return;
  const banner = document.getElementById('install-banner');
  const text = document.getElementById('install-banner-text');
  const btn = document.getElementById('install-banner-btn');
  if (!banner) return;
  if (isIOS) {
    // iOS has no install API — show the manual Share → Add to Home Screen hint.
    text.textContent = "Add to Home Screen so your progress isn't cleared: tap Share ⬆ then “Add to Home Screen”.";
    btn.style.display = 'none';
    banner.classList.remove('hidden');
  } else if (deferredInstall) {
    banner.classList.remove('hidden');
  }
}

document.getElementById('install-banner-btn')?.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  document.getElementById('install-banner').classList.add('hidden');
});
document.getElementById('install-banner-dismiss')?.addEventListener('click', () => {
  localStorage.setItem('rf_install_dismissed', '1');
  document.getElementById('install-banner').classList.add('hidden');
});

requestPersistentStorage();
populateRecoveryUI();
refreshTier();
maybeShowInstallBanner();

if (!localStorage.getItem('rf_has_visited')) {
  // First visit — show landing page
  showView('view-landing');
} else {
  // Returning user — go straight to dashboard
  apiFetch('POST', '/api/users', { user_id: state.userId }).then(loadDashboard);
}
