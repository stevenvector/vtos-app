/* =====================================================
   VTOS Admin Panel — app.js
   ===================================================== */

const API = '/api';

let adminToken = localStorage.getItem('vtos_admin_token');
let currentQuoteId   = null;
let currentCourierId = null;
let editingPortfolioId = null;

// ── Boot ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    verifyAndBoot();
  } else {
    showLogin();
  }
});

async function verifyAndBoot() {
  try {
    const res = await apiFetch('/auth/me');
    if (!res.ok) { adminLogout(); return; }
    const user = await res.json();
    if (user.role !== 'admin') { adminLogout(); return; }
    bootApp(user);
  } catch {
    adminLogout();
  }
}

function bootApp(user) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  document.getElementById('dashGreeting').textContent =
    `Welcome back, ${user.first_name}`;
  loadDashboard();
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminApp').classList.add('hidden');
}

// ── Auth ─────────────────────────────────────────────
async function adminLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  err.classList.add('hidden');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:    document.getElementById('a-email').value,
        password: document.getElementById('a-pass').value,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      err.textContent = data.error || 'Login failed.';
      err.classList.remove('hidden');
      return;
    }

    if (data.user.role !== 'admin') {
      err.textContent = 'Admin access required.';
      err.classList.remove('hidden');
      return;
    }

    adminToken = data.token;
    localStorage.setItem('vtos_admin_token', adminToken);
    bootApp(data.user);
  } catch {
    err.textContent = 'Could not reach API. Is the server running?';
    err.classList.remove('hidden');
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

function adminLogout() {
  adminToken = null;
  localStorage.removeItem('vtos_admin_token');
  showLogin();
}

// ── API helper ────────────────────────────────────────
function apiFetch(path, options = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(options.headers || {}),
    },
  });
}

// ── Page Navigation ───────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(b => b.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  const btn  = document.querySelector(`[data-page="${name}"]`);
  if (page) page.classList.add('active');
  if (btn)  btn.classList.add('active');

  switch (name) {
    case 'dashboard': loadDashboard(); break;
    case 'quotes':    loadQuotes();    break;
    case 'courier':   loadCourier();   break;
    case 'portfolio': loadPortfolio(); break;
    case 'users':     loadUsers();     break;
  }
}

// ── Dashboard ─────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([refreshStats(), loadRecent()]);
}

async function refreshStats() {
  try {
    const res  = await apiFetch('/admin/stats');
    const data = await res.json();

    document.getElementById('s-newLeads').textContent    = data.quotes?.new_leads  ?? '–';
    document.getElementById('s-totalLeads').textContent  = data.quotes?.total      ?? '–';
    document.getElementById('s-activeCourier').textContent = data.courier?.active  ?? '–';
    document.getElementById('s-clients').textContent     = data.users?.clients     ?? '–';

    const newLeads = parseInt(data.quotes?.new_leads || 0);
    const badge = document.getElementById('newQuotesBadge');
    badge.textContent = newLeads > 0 ? newLeads : '';
    badge.style.display = newLeads > 0 ? '' : 'none';

    const active = parseInt(data.courier?.active || 0);
    const cbadge = document.getElementById('activeCourierBadge');
    cbadge.textContent = active > 0 ? active : '';
    cbadge.style.display = active > 0 ? '' : 'none';
  } catch (err) {
    console.error('Stats error:', err);
  }
}

async function loadRecent() {
  try {
    const res  = await apiFetch('/admin/recent');
    const data = await res.json();

    const qEl = document.getElementById('recentQuotes');
    if (data.recent_quotes?.length) {
      qEl.innerHTML = data.recent_quotes.map(q => `
        <div class="mini-item" onclick="openQuoteModal(${q.id})">
          <div class="mini-item-info">
            <span class="mini-item-name">${esc(q.name)}</span>
            <span class="mini-item-sub">${esc(q.service)}</span>
          </div>
          <span class="badge badge-${q.status}">${q.status}</span>
        </div>`).join('');
    } else {
      qEl.innerHTML = '<div class="empty-state">No recent leads</div>';
    }

    const cEl = document.getElementById('recentCourier');
    if (data.recent_courier?.length) {
      cEl.innerHTML = data.recent_courier.map(c => `
        <div class="mini-item" onclick="openCourierModal(${c.id})">
          <div class="mini-item-info">
            <span class="mini-item-name">${esc(c.first_name)} ${esc(c.last_name)}</span>
            <span class="mini-item-sub">${esc(c.item_type)}</span>
          </div>
          <span class="badge badge-${c.status}">${statusLabel(c.status)}</span>
        </div>`).join('');
    } else {
      cEl.innerHTML = '<div class="empty-state">No recent bookings</div>';
    }
  } catch (err) {
    console.error('Recent error:', err);
  }
}

// ── Quotes ────────────────────────────────────────────
async function loadQuotes() {
  const status = document.getElementById('quoteStatusFilter')?.value || '';
  const el = document.getElementById('quotesTable');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res  = await apiFetch(`/quotes?${status ? `status=${status}&` : ''}limit=100`);
    const data = await res.json();

    if (!data.quotes?.length) {
      el.innerHTML = emptyState('No quotes found');
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Service</th>
            <th>Budget</th>
            <th>Consultation</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${data.quotes.map(q => `
            <tr onclick="openQuoteModal(${q.id})">
              <td class="td-muted">${q.id}</td>
              <td><div class="td-name">${esc(q.name)}</div><div class="td-muted">${esc(q.email)}</div></td>
              <td>${esc(q.service)}</td>
              <td class="td-muted">${q.budget || '–'}</td>
              <td>${q.wants_consult ? '<span style="color:var(--green)">Yes</span>' : '<span class="td-muted">No</span>'}</td>
              <td><span class="badge badge-${q.status}">${q.status}</span></td>
              <td class="td-date">${formatDate(q.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:.75rem 1rem;font-size:.8rem;color:var(--muted)">${data.total} total records</div>`;
  } catch (err) {
    el.innerHTML = errorState('Failed to load quotes');
  }
}

async function openQuoteModal(id) {
  currentQuoteId = id;
  const modal = document.getElementById('quoteModal');
  document.getElementById('qm-feedback').classList.add('hidden');
  modal.classList.add('open');
  document.getElementById('qm-body').innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res  = await apiFetch(`/quotes/${id}`);
    const q    = await res.json();

    document.getElementById('qm-title').textContent = `Quote #${q.id} — ${q.name}`;
    document.getElementById('qm-status').value = q.status;
    document.getElementById('qm-notes').value  = q.admin_notes || '';

    document.getElementById('qm-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">Name</div><div class="di-val">${esc(q.name)}</div></div>
        <div class="detail-item"><div class="di-label">Company</div><div class="di-val">${esc(q.company || '–')}</div></div>
        <div class="detail-item"><div class="di-label">Email</div><div class="di-val"><a href="mailto:${esc(q.email)}" style="color:var(--green)">${esc(q.email)}</a></div></div>
        <div class="detail-item"><div class="di-label">Phone</div><div class="di-val">${q.phone ? `<a href="https://wa.me/${q.phone.replace(/\D/g,'')}" target="_blank" style="color:#25d366">${esc(q.phone)}</a>` : '–'}</div></div>
        <div class="detail-item"><div class="di-label">Service</div><div class="di-val">${esc(q.service)}</div></div>
        <div class="detail-item"><div class="di-label">Budget</div><div class="di-val">${esc(q.budget || '–')}</div></div>
        <div class="detail-item"><div class="di-label">Wants Consult</div><div class="di-val" style="color:${q.wants_consult?'var(--green)':'var(--muted)'}">${q.wants_consult ? 'Yes' : 'No'}</div></div>
        <div class="detail-item"><div class="di-label">Submitted</div><div class="di-val">${formatDate(q.created_at)}</div></div>
        <div class="detail-item detail-full"><div class="di-label">Description</div><div class="di-val" style="white-space:pre-wrap">${esc(q.description)}</div></div>
      </div>`;
  } catch {
    document.getElementById('qm-body').innerHTML = errorState('Failed to load quote');
  }
}

async function saveQuoteUpdate() {
  const btn = document.querySelector('#quoteModal .btn-g');
  const fb  = document.getElementById('qm-feedback');
  btn.textContent = 'Saving…'; btn.disabled = true;
  fb.classList.add('hidden');

  try {
    const res = await apiFetch(`/quotes/${currentQuoteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:      document.getElementById('qm-status').value,
        admin_notes: document.getElementById('qm-notes').value,
      }),
    });

    if (!res.ok) throw new Error();
    fb.className = 'success-msg';
    fb.textContent = 'Saved successfully.';
    fb.classList.remove('hidden');
    loadQuotes();
    refreshStats();
    setTimeout(() => document.getElementById('quoteModal').classList.remove('open'), 800);
  } catch {
    fb.className = 'error-msg';
    fb.textContent = 'Save failed. Please try again.';
    fb.classList.remove('hidden');
  } finally {
    btn.textContent = 'Save Changes'; btn.disabled = false;
  }
}

// ── Courier ───────────────────────────────────────────
async function loadCourier() {
  const status = document.getElementById('courierStatusFilter')?.value || '';
  const el = document.getElementById('courierTable');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res  = await apiFetch(`/courier?${status ? `status=${status}&` : ''}limit=100`);
    const data = await res.json();

    if (!data.bookings?.length) {
      el.innerHTML = emptyState('No courier bookings found');
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Client</th>
            <th>Item</th>
            <th>Courier / Tracking</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${data.bookings.map(b => `
            <tr onclick="openCourierModal(${b.id})">
              <td class="td-muted">${b.id}</td>
              <td><div class="td-name">${esc(b.first_name)} ${esc(b.last_name)}</div><div class="td-muted">${esc(b.email)}</div></td>
              <td><div class="td-name">${esc(b.item_type)}</div><div class="td-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.item_description)}</div></td>
              <td class="td-muted">${b.courier_company ? esc(b.courier_company) : '–'}${b.tracking_number ? `<br><code style="font-size:.75rem;color:var(--green)">${esc(b.tracking_number)}</code>` : ''}</td>
              <td><span class="badge badge-${b.status}">${esc(b.status_label || b.status)}</span></td>
              <td class="td-date">${formatDate(b.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:.75rem 1rem;font-size:.8rem;color:var(--muted)">${data.total} total records</div>`;
  } catch {
    el.innerHTML = errorState('Failed to load courier bookings');
  }
}

async function openCourierModal(id) {
  currentCourierId = id;
  const modal = document.getElementById('courierModal');
  document.getElementById('cm-feedback').classList.add('hidden');
  modal.classList.add('open');
  document.getElementById('cm-body').innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res = await apiFetch(`/courier/${id}`);
    const b   = await res.json();

    document.getElementById('cm-title').textContent = `Courier #${b.id} — ${b.first_name} ${b.last_name}`;
    document.getElementById('cm-status').value          = b.status;
    document.getElementById('cm-notes').value           = b.admin_notes || '';
    document.getElementById('cm-return-tracking').value = b.return_tracking || '';
    document.getElementById('cm-return-courier').value  = b.return_courier  || '';

    document.getElementById('cm-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">Client</div><div class="di-val">${esc(b.first_name)} ${esc(b.last_name)}</div></div>
        <div class="detail-item"><div class="di-label">Email</div><div class="di-val"><a href="mailto:${esc(b.email)}" style="color:var(--green)">${esc(b.email)}</a></div></div>
        <div class="detail-item"><div class="di-label">Phone</div><div class="di-val">${b.phone ? `<a href="https://wa.me/${b.phone.replace(/\D/g,'')}" target="_blank" style="color:#25d366">${esc(b.phone)}</a>` : '–'}</div></div>
        <div class="detail-item"><div class="di-label">Submitted</div><div class="di-val">${formatDate(b.created_at)}</div></div>
        <div class="detail-item"><div class="di-label">Item Type</div><div class="di-val">${esc(b.item_type)}</div></div>
        <div class="detail-item"><div class="di-label">Courier Co.</div><div class="di-val">${esc(b.courier_company || '–')}</div></div>
        <div class="detail-item"><div class="di-label">Tracking #</div><div class="di-val"><code style="color:var(--green)">${esc(b.tracking_number || '–')}</code></div></div>
        <div class="detail-item"><div class="di-label">Est. Arrival</div><div class="di-val">${b.estimated_arrival ? formatDate(b.estimated_arrival) : '–'}</div></div>
        <div class="detail-item detail-full"><div class="di-label">Item Description</div><div class="di-val">${esc(b.item_description)}</div></div>
        <div class="detail-item detail-full"><div class="di-label">Issue / Reason</div><div class="di-val" style="white-space:pre-wrap">${esc(b.issue_description)}</div></div>
      </div>`;
  } catch {
    document.getElementById('cm-body').innerHTML = errorState('Failed to load booking');
  }
}

async function saveCourierUpdate() {
  const btn = document.querySelector('#courierModal .btn-g');
  const fb  = document.getElementById('cm-feedback');
  btn.textContent = 'Saving…'; btn.disabled = true;
  fb.classList.add('hidden');

  try {
    const res = await apiFetch(`/courier/${currentCourierId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:          document.getElementById('cm-status').value,
        admin_notes:     document.getElementById('cm-notes').value,
        return_tracking: document.getElementById('cm-return-tracking').value,
        return_courier:  document.getElementById('cm-return-courier').value,
      }),
    });

    if (!res.ok) throw new Error();
    fb.className = 'success-msg';
    fb.textContent = 'Saved successfully.';
    fb.classList.remove('hidden');
    loadCourier();
    refreshStats();
    setTimeout(() => document.getElementById('courierModal').classList.remove('open'), 800);
  } catch {
    fb.className = 'error-msg';
    fb.textContent = 'Save failed. Please try again.';
    fb.classList.remove('hidden');
  } finally {
    btn.textContent = 'Save Changes'; btn.disabled = false;
  }
}

// ── Portfolio ─────────────────────────────────────────
async function loadPortfolio() {
  const el = document.getElementById('portfolioGrid');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res   = await apiFetch('/portfolio/all');
    const items = await res.json();

    if (!items.length) {
      el.innerHTML = emptyState('No portfolio items yet. Add your first project!');
      return;
    }

    el.innerHTML = items.map(item => `
      <div class="p-admin-card ${item.is_visible ? '' : 'hidden-item'}">
        <div class="p-admin-img">
          ${item.screenshot_url
            ? `<img src="${esc(item.screenshot_url)}" alt="${esc(item.title)}" onerror="this.parentElement.innerHTML='<div class=\\'no-img\\'>No preview</div>'" />`
            : '<div class="no-img"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="3" width="20" height="14" rx="2"/></svg><br>No screenshot</div>'}
          ${!item.is_visible ? '<div class="p-admin-hidden-overlay">Hidden</div>' : ''}
        </div>
        <div class="p-admin-body">
          <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem">
            <span class="badge badge-${item.tag === 'website' ? 'new' : item.tag === 'webapp' ? 'contacted' : 'in_progress'}">${item.tag}</span>
          </div>
          <h4>${esc(item.title)}</h4>
          <p>${esc(item.description)}</p>
          <div class="p-admin-actions">
            <button class="btn-outline btn-sm" onclick="openPortfolioForm(${item.id})">Edit</button>
            <button class="btn-outline ${item.is_visible ? 'danger' : 'success'} btn-sm" onclick="togglePortfolio(${item.id})">
              ${item.is_visible ? 'Hide' : 'Show'}
            </button>
            ${item.project_url ? `<a href="${esc(item.project_url)}" target="_blank" class="btn-outline btn-sm" style="text-decoration:none">View →</a>` : ''}
            <button class="btn-outline danger btn-sm" onclick="deletePortfolioItem(${item.id}, event)">Delete</button>
          </div>
        </div>
      </div>`).join('') +
      `<div class="p-admin-card" style="border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;min-height:200px;cursor:pointer" onclick="openPortfolioForm()">
        <div style="text-align:center;color:var(--muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <p style="margin-top:.5rem;font-size:.85rem">Add Project</p>
        </div>
      </div>`;
  } catch {
    el.innerHTML = errorState('Failed to load portfolio');
  }
}

function openPortfolioForm(id = null) {
  editingPortfolioId = id;
  const modal = document.getElementById('portfolioModal');
  document.getElementById('pm-feedback').classList.add('hidden');

  if (id) {
    document.getElementById('pm-title').textContent = 'Edit Portfolio Item';
    apiFetch(`/portfolio/all`).then(r => r.json()).then(items => {
      const item = items.find(i => i.id === id);
      if (!item) return;
      document.getElementById('pm-title-in').value  = item.title;
      document.getElementById('pm-tag').value        = item.tag;
      document.getElementById('pm-order').value      = item.display_order;
      document.getElementById('pm-desc').value       = item.description;
      document.getElementById('pm-screenshot').value = item.screenshot_url || '';
      document.getElementById('pm-url').value        = item.project_url || '';
      document.getElementById('pm-visible').checked  = item.is_visible;
    });
  } else {
    document.getElementById('pm-title').textContent = 'Add Portfolio Item';
    document.querySelector('#portfolioModal form').reset();
    document.getElementById('pm-visible').checked = true;
  }

  modal.classList.add('open');
}

async function savePortfolioItem(e) {
  e.preventDefault();
  const btn = document.querySelector('#portfolioModal .btn-g');
  const fb  = document.getElementById('pm-feedback');
  btn.textContent = 'Saving…'; btn.disabled = true;
  fb.classList.add('hidden');

  const payload = {
    title:          document.getElementById('pm-title-in').value,
    tag:            document.getElementById('pm-tag').value,
    description:    document.getElementById('pm-desc').value,
    screenshot_url: document.getElementById('pm-screenshot').value || null,
    project_url:    document.getElementById('pm-url').value || null,
    display_order:  parseInt(document.getElementById('pm-order').value) || 0,
    is_visible:     document.getElementById('pm-visible').checked,
  };

  try {
    const res = editingPortfolioId
      ? await apiFetch(`/portfolio/${editingPortfolioId}`, { method: 'PUT',  body: JSON.stringify(payload) })
      : await apiFetch('/portfolio',                        { method: 'POST', body: JSON.stringify(payload) });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Save failed');
    }

    fb.className = 'success-msg';
    fb.textContent = 'Project saved!';
    fb.classList.remove('hidden');
    loadPortfolio();
    setTimeout(() => document.getElementById('portfolioModal').classList.remove('open'), 700);
  } catch (err) {
    fb.className = 'error-msg';
    fb.textContent = err.message || 'Save failed.';
    fb.classList.remove('hidden');
  } finally {
    btn.textContent = 'Save Project'; btn.disabled = false;
  }
}

async function togglePortfolio(id) {
  await apiFetch(`/portfolio/${id}/toggle`, { method: 'PATCH' });
  loadPortfolio();
}

async function deletePortfolioItem(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this portfolio item? This cannot be undone.')) return;
  await apiFetch(`/portfolio/${id}`, { method: 'DELETE' });
  loadPortfolio();
}

// ── Users ─────────────────────────────────────────────
async function loadUsers() {
  const el = document.getElementById('usersTable');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res  = await apiFetch('/admin/users?limit=100');
    const data = await res.json();

    if (!data.users?.length) {
      el.innerHTML = emptyState('No registered users');
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.users.filter(u => u.role !== 'admin').map(u => `
            <tr>
              <td class="td-muted">${u.id}</td>
              <td class="td-name">${esc(u.first_name)} ${esc(u.last_name)}</td>
              <td class="td-muted">${esc(u.email)}</td>
              <td class="td-muted">${u.phone ? `<a href="https://wa.me/${u.phone.replace(/\D/g,'')}" target="_blank" style="color:#25d366">${esc(u.phone)}</a>` : '–'}</td>
              <td><span class="badge ${u.is_active ? 'badge-converted' : 'badge-closed'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
              <td class="td-date">${formatDate(u.created_at)}</td>
              <td class="td-actions">
                <button class="btn-outline ${u.is_active ? 'danger' : 'success'} btn-sm" onclick="toggleUser(${u.id})">
                  ${u.is_active ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:.75rem 1rem;font-size:.8rem;color:var(--muted)">${data.total} total users</div>`;
  } catch {
    el.innerHTML = errorState('Failed to load users');
  }
}

async function toggleUser(id) {
  await apiFetch(`/admin/users/${id}/toggle`, { method: 'PATCH' });
  loadUsers();
}

// ── Modal helpers ─────────────────────────────────────
function closeModal(e, id) {
  if (e.target.id === id) document.getElementById(id).classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ── Password toggle ────────────────────────────────────
function togglePw(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ── Helpers ────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(str) {
  if (!str) return '–';
  return new Date(str).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function statusLabel(s) {
  const map = {
    pending: 'Pending', awaiting_pickup: 'Awaiting Pickup', in_transit: 'In Transit',
    received: 'Received', diagnosing: 'Diagnosing', awaiting_approval: 'Awaiting Approval',
    repairing: 'Repairing', ready_to_return: 'Ready to Return', returned: 'Returned', closed: 'Closed',
  };
  return map[s] || s;
}

function emptyState(msg) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
    <p style="margin-top:.5rem">${msg}</p>
  </div>`;
}

function errorState(msg) {
  return `<div class="error-msg" style="margin:0">${msg}</div>`;
}
