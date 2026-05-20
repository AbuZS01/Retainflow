const API = '';  // Same-origin; server serves frontend

// ── State ──────────────────────────────────────────────────────────────────
function getOrCreateUserId() {
  let id = localStorage.getItem('rf_user_id');
  if (!id) {
    id = crypto.randomUUID();
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

// ── Dark mode ──────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('rf_theme') ?? 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-btn').textContent = saved === 'dark' ? '☀️' : '🌙';
}

document.getElementById('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('rf_theme', next);
  document.getElementById('theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
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

// ── Haptics ────────────────────────────────────────────────────────────────
function haptic(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ── View helpers ───────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

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
  showView('view-dashboard');
  state.sessionTotal = 0;
  state.sessionDone  = 0;

  const { data } = await apiFetch('GET', `/api/items/${state.userId}`);
  state.dueItems = Array.isArray(data) ? data : [];

  if (state.atLimit) {
    document.getElementById('limit-banner').classList.remove('hidden');
  }

  renderDueList();
}

function renderDueList() {
  const list  = document.getElementById('due-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';

  if (state.dueItems.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  state.dueItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'item-row';

    const idSpan = document.createElement('span');
    idSpan.className = 'item-id';
    idSpan.textContent = item.item_id;

    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = `×${item.repetitions} rep`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Remove';
    deleteBtn.setAttribute('aria-label', `Remove ${item.item_id}`);
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => removeItem(item.item_id));

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex;align-items:center;gap:.5rem';
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
  await apiFetch('DELETE', `/api/items/${itemId}`);
  state.atLimit = false;
  document.getElementById('limit-banner').classList.add('hidden');
  await loadDashboard();
}

// ── Add item — search UI ───────────────────────────────────────────────────
let selectedSurah = null;

function openAddView() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('range-selector').classList.add('hidden');
  document.getElementById('add-error').classList.add('hidden');
  selectedSurah = null;
  showView('view-add');
}

document.getElementById('add-btn').addEventListener('click', openAddView);
document.getElementById('back-btn').addEventListener('click', loadDashboard);

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
  preview.textContent = data.map((a) => a.arabic).join('  ');
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

  const { status, data } = await apiFetch('POST', '/api/items', {
    user_id: state.userId,
    item_id: itemId,
    content,
  });

  if (status === 201) {
    await loadDashboard();
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

// ── Review ─────────────────────────────────────────────────────────────────
function buildQuranLink(itemId) {
  const match = itemId.match(/^surah-(\d+)/);
  if (match) return `https://quran.com/${match[1]}`;
  const pageMatch = itemId.match(/^mushaf-page-(\d+)/);
  if (pageMatch) return `https://quran.com/page/${pageMatch[1]}`;
  return `https://quran.com`;
}

function updateProgressBar() {
  const pct = state.sessionTotal > 0 ? (state.sessionDone / state.sessionTotal) * 100 : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('review-progress-text').textContent =
    `${state.sessionDone + 1} of ${state.sessionTotal}`;
}

function startReview(item) {
  // Capture total on first card of a session
  if (state.sessionTotal === 0) {
    state.sessionTotal = state.dueItems.length;
    state.sessionDone  = 0;
  }
  state.reviewItem = item;
  document.getElementById('review-item-id').textContent  = item.item_id;
  document.getElementById('review-content').textContent  = item.content ?? '';
  document.getElementById('review-link').href = buildQuranLink(item.item_id);
  updateProgressBar();
  haptic(15);
  showView('view-review');
}

async function submitReview(quality) {
  haptic(25);
  await apiFetch('PUT', `/api/items/${state.reviewItem.item_id}/review`, { quality });
  state.sessionDone++;
  state.dueItems = state.dueItems.filter((i) => i.item_id !== state.reviewItem.item_id);
  state.reviewItem = null;

  if (state.dueItems.length === 0) {
    showSessionComplete();
  } else {
    startReview(state.dueItems[0]);
  }
}

document.getElementById('review-back-btn').addEventListener('click', loadDashboard);

document.querySelectorAll('.q-btn').forEach((btn) => {
  btn.addEventListener('click', () => submitReview(btn.dataset.quality));
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

// ── Session complete ───────────────────────────────────────────────────────
function showSessionComplete() {
  const streak = incrementStreak();
  haptic([40, 20, 40, 20, 80]);
  document.getElementById('complete-count').textContent  = state.sessionDone;
  document.getElementById('complete-streak').textContent = streak;
  showView('view-complete');
}

document.getElementById('complete-add-btn').addEventListener('click', openAddView);
document.getElementById('complete-home-btn').addEventListener('click', loadDashboard);

// ── Upgrade placeholder ────────────────────────────────────────────────────
document.getElementById('upgrade-btn').addEventListener('click', () => {
  alert('Upgrade coming soon! Contact us to unlock unlimited decks.');
});

// ── Init ───────────────────────────────────────────────────────────────────
initTheme();
apiFetch('POST', '/api/users', { user_id: state.userId }).then(loadDashboard);
