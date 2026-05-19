const API = '';  // Same-origin; server serves frontend

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  userId: localStorage.getItem('rf_user_id') ?? null,
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
  document.getElementById('user-label').textContent = `User: ${state.userId}`;

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

// ── Add item ───────────────────────────────────────────────────────────────
document.getElementById('add-btn').addEventListener('click', () => {
  document.getElementById('item-id-input').value = '';
  document.getElementById('add-error').classList.add('hidden');
  showView('view-add');
});

document.getElementById('back-btn').addEventListener('click', loadDashboard);

document.getElementById('save-item-btn').addEventListener('click', async () => {
  const itemId = document.getElementById('item-id-input').value.trim();
  if (!itemId) return;

  const { status, data } = await apiFetch('POST', '/api/items', {
    user_id: state.userId,
    item_id: itemId,
  });

  if (status === 201) {
    await loadDashboard();
  } else if (status === 403) {
    const errEl = document.getElementById('add-error');
    errEl.textContent = data.message;
    errEl.classList.remove('hidden');
    state.atLimit = true;
    // Stay on add view so user can read the error — don't navigate
  } else {
    const errEl = document.getElementById('add-error');
    errEl.textContent = data.error ?? 'Unknown error';
    errEl.classList.remove('hidden');
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

// ── Login ──────────────────────────────────────────────────────────────────
async function ensureUser(userId) {
  await apiFetch('POST', '/api/users', { user_id: userId });
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const userId = document.getElementById('login-input').value.trim();
  if (!userId) return;
  await ensureUser(userId);
  state.userId = userId;
  localStorage.setItem('rf_user_id', userId);
  await loadDashboard();
});

document.getElementById('login-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

// ── Init ───────────────────────────────────────────────────────────────────
if (state.userId) {
  ensureUser(state.userId).then(loadDashboard);
} else {
  showView('view-login');
}
