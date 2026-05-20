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
};

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

  const { data } = await apiFetch('GET', `/api/items/${state.userId}`);
  state.dueItems = Array.isArray(data) ? data : [];

  if (state.atLimit) {
    document.getElementById('limit-banner').classList.remove('hidden');
  }

  renderDueList();
}

function renderDueList() {
  const list = document.getElementById('due-list');
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

document.getElementById('add-btn').addEventListener('click', () => {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('range-selector').classList.add('hidden');
  document.getElementById('add-error').classList.add('hidden');
  selectedSurah = null;
  showView('view-add');
});

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
    const el = document.createElement('div');
    el.className = 'search-result-item';
    const ref = document.createElement('div');
    ref.className = 'result-ref';
    ref.textContent = `${ayah.surah_name} • ${ayah.surah}:${ayah.ayah}`;
    const arabic = document.createElement('div');
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
  document.getElementById('range-to').value = ayah.ayah;
  document.getElementById('range-selector').classList.remove('hidden');
  document.getElementById('add-error').classList.add('hidden');
  updateRangePreview();
  document.getElementById('range-selector').scrollIntoView({ behavior: 'smooth' });
}

async function updateRangePreview() {
  if (!selectedSurah) return;
  const from = parseInt(document.getElementById('range-from').value, 10);
  const to = parseInt(document.getElementById('range-to').value, 10);
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
  const to = parseInt(document.getElementById('range-to').value, 10);
  if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
    const errEl = document.getElementById('add-error');
    errEl.textContent = 'Please enter a valid ayah range.';
    errEl.classList.remove('hidden');
    return;
  }

  // Fetch the range text to store as content
  const { status: rangeStatus, data: rangeData } = await apiFetch('GET', `/api/quran/${selectedSurah.surah}/${from}/${to}`);
  if (rangeStatus !== 200 || !Array.isArray(rangeData)) {
    document.getElementById('add-error').textContent = 'Could not fetch ayah range.';
    document.getElementById('add-error').classList.remove('hidden');
    return;
  }

  const itemId = `surah-${selectedSurah.surah}-ayat-${from}-${to}`;
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
    const errEl = document.getElementById('add-error');
    errEl.textContent = 'This range is already in your queue.';
    errEl.classList.remove('hidden');
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

function startReview(item) {
  state.reviewItem = item;
  document.getElementById('review-item-id').textContent = item.item_id;
  document.getElementById('review-content').textContent = item.content ?? '';
  document.getElementById('review-link').href = buildQuranLink(item.item_id);
  showView('view-review');
}

document.getElementById('review-back-btn').addEventListener('click', loadDashboard);

document.querySelectorAll('.q-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const quality = btn.dataset.quality;
    await apiFetch('PUT', `/api/items/${state.reviewItem.item_id}/review`, { quality });
    state.dueItems = state.dueItems.filter((i) => i.item_id !== state.reviewItem.item_id);
    state.reviewItem = null;
    await loadDashboard();
  });
});

// ── Upgrade placeholder ────────────────────────────────────────────────────
document.getElementById('upgrade-btn').addEventListener('click', () => {
  alert('Upgrade coming soon! Contact us to unlock unlimited decks.');
});

// ── Init ───────────────────────────────────────────────────────────────────
apiFetch('POST', '/api/users', { user_id: state.userId }).then(loadDashboard);
