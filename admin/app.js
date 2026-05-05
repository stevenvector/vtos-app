/* =====================================================
   VTOS Admin Panel — app.js
   ===================================================== */

const API = '/api';

let adminToken = localStorage.getItem('vtos_admin_token');
let currentQuoteId     = null;
let currentCourierId   = null;
let editingPortfolioId = null;
let editingUserId      = null;
let currentProposalId  = null;
let lineItemCounter    = 0;

const SERVICE_TEMPLATES = {
  // ── Website packages ──────────────────────────────
  'Starter Website': [
    { desc: 'Website Design & Wireframing (up to 5 pages)', qty: 1, price: 1400 },
    { desc: 'Responsive Frontend Development',              qty: 1, price: 1200 },
    { desc: 'Contact Form Integration',                     qty: 1, price:  200 },
    { desc: 'Basic SEO Setup',                              qty: 1, price:  150 },
    { desc: 'Social Media Links & Icons',                   qty: 1, price:   50 },
  ],
  'Professional Website': [
    { desc: 'UI/UX Design & Wireframing (up to 8 pages)',  qty: 1, price: 2200 },
    { desc: 'Responsive Frontend Development',              qty: 1, price: 2000 },
    { desc: 'Blog / News System',                           qty: 1, price:  700 },
    { desc: 'Image Gallery',                                qty: 1, price:  400 },
    { desc: 'WhatsApp Chat & Social Integration',           qty: 1, price:  400 },
    { desc: 'Advanced SEO Setup & Sitemap',                 qty: 1, price:  500 },
    { desc: 'Testing & Launch',                             qty: 1, price:  300 },
  ],
  // ── Web Application ───────────────────────────────
  'Web Application': [
    { desc: 'System Architecture & Database Design',        qty: 1, price: 2000 },
    { desc: 'Backend API Development',                      qty: 1, price: 3000 },
    { desc: 'User Authentication & Role Management',        qty: 1, price: 1500 },
    { desc: 'Frontend Dashboard / Client Portal',           qty: 1, price: 2000 },
    { desc: 'CRM / Booking / Inventory Module',             qty: 1, price: 1500 },
    { desc: 'Testing, Security Audit & Deployment',         qty: 1, price:  999 },
  ],
  // ── E-Commerce ────────────────────────────────────
  'E-Commerce Store': [
    { desc: 'Store Design & Branding',                      qty: 1, price: 2500 },
    { desc: 'Product Catalogue & Management System',        qty: 1, price: 2000 },
    { desc: 'PayFast / Yoco Payment Gateway Integration',   qty: 1, price: 2500 },
    { desc: 'Shopping Cart & Checkout Flow',                qty: 1, price: 2000 },
    { desc: 'Order Management & Email Notifications',       qty: 1, price: 2000 },
    { desc: 'Customer Accounts & Wishlist',                 qty: 1, price: 1500 },
    { desc: 'Testing & Launch',                             qty: 1, price:  999 },
    { desc: 'Stock-level Alerts',                           qty: 1, price:  500 },
  ],
  // ── PC / Hardware ─────────────────────────────────
  'Hardware Repair': [
    { desc: 'Diagnostic Assessment',                        qty: 1, price:  350 },
    { desc: 'Parts & Labour',                               qty: 1, price:  800 },
    { desc: 'Data Backup & Recovery',                       qty: 1, price:  500 },
    { desc: 'OS Reinstall / Software Setup',                qty: 1, price:  300 },
    { desc: 'Quality Check & Testing',                      qty: 1, price:  200 },
  ],
  // ── IT Support ────────────────────────────────────
  'IT Support': [
    { desc: 'On-site or Remote Assessment (per hour)',      qty: 2, price:  450 },
    { desc: 'Software Configuration & Updates',             qty: 1, price:  600 },
    { desc: 'Network Setup & Security',                     qty: 1, price:  800 },
    { desc: 'Documentation & User Training',                qty: 1, price:  500 },
  ],
  // ── Common add-ons (quick pick) ───────────────────
  'Add-ons Only': [
    { desc: 'Domain Registration (1 year)',                 qty: 1, price:  299 },
    { desc: 'Hosting Setup',                                qty: 1, price:  499 },
    { desc: 'Professional Email (1 yr, 10 accounts)',       qty: 1, price: 1200 },
    { desc: 'Logo & Brand Design',                          qty: 1, price: 1499 },
    { desc: 'SEO Kickstart Package (3 months)',             qty: 1, price: 2499 },
    { desc: 'Google My Business Setup',                     qty: 1, price:  499 },
    { desc: 'WhatsApp Chat Widget',                         qty: 1, price:  699 },
    { desc: 'Payment Gateway Integration',                  qty: 1, price: 1499 },
    { desc: 'Monthly Maintenance Plan (per month)',         qty: 1, price:  499 },
  ],
};

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
  const atbUser = document.getElementById('atbUserName');
  if (atbUser) atbUser.textContent = user.first_name;
  // Open sidebar by default on desktop
  if (window.innerWidth >= 900) {
    document.getElementById('adminApp').classList.add('sidebar-open');
  }
  loadDashboard();
}

// ── Sidebar ───────────────────────────────────────────
function toggleAdminSidebar() {
  document.getElementById('adminApp').classList.toggle('sidebar-open');
}
function closeAdminSidebar() {
  document.getElementById('adminApp').classList.remove('sidebar-open');
}

window.addEventListener('resize', () => {
  const app = document.getElementById('adminApp');
  if (app && !app.classList.contains('hidden') && window.innerWidth >= 900) {
    app.classList.add('sidebar-open');
  }
});

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
    case 'dashboard': loadDashboard();  break;
    case 'quotes':    loadQuotes();     break;
    case 'courier':   loadCourier();    break;
    case 'portfolio': loadPortfolio();  break;
    case 'users':     loadUsers();      break;
    case 'proposals': loadProposals();  break;
  }
  // Auto-close sidebar on mobile after navigation
  if (window.innerWidth < 900) closeAdminSidebar();
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

    // Render addons list if present
    const addonsArr = (() => {
      try { return Array.isArray(q.addons) ? q.addons : (q.addons ? JSON.parse(q.addons) : []); }
      catch { return []; }
    })();
    const addonsHtml = addonsArr.length
      ? `<div class="detail-item detail-full">
           <div class="di-label">Add-ons Selected</div>
           <div class="di-val">${addonsArr.map(a =>
             `<span style="display:inline-flex;align-items:center;gap:.35rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:.78rem;margin:.2rem .2rem 0 0">
               ${esc(a.name)} <span style="color:var(--green);font-weight:600">+R${Number(a.price||0).toLocaleString()}</span>
             </span>`).join('')}
           </div>
         </div>`
      : '';

    document.getElementById('qm-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">Name</div><div class="di-val">${esc(q.name)}</div></div>
        <div class="detail-item"><div class="di-label">Company</div><div class="di-val">${esc(q.company || '–')}</div></div>
        <div class="detail-item"><div class="di-label">Email</div><div class="di-val"><a href="mailto:${esc(q.email)}" style="color:var(--green)">${esc(q.email)}</a></div></div>
        <div class="detail-item"><div class="di-label">Phone</div><div class="di-val">${q.phone ? `<a href="https://wa.me/${q.phone.replace(/\D/g,'')}" target="_blank" style="color:#25d366">${esc(q.phone)}</a>` : '–'}</div></div>
        <div class="detail-item"><div class="di-label">Package</div><div class="di-val" style="color:var(--blue);font-weight:600">${esc(q.package_tier || q.service)}</div></div>
        <div class="detail-item"><div class="di-label">Estimate</div><div class="di-val" style="color:var(--green);font-weight:700;font-size:1.05rem">${q.estimate ? `R${Number(q.estimate).toLocaleString()}` : (q.budget || '–')}</div></div>
        <div class="detail-item"><div class="di-label">Wants Consult</div><div class="di-val" style="color:${q.wants_consult?'var(--green)':'var(--muted)'}">${q.wants_consult ? '✓ Yes' : 'No'}</div></div>
        <div class="detail-item"><div class="di-label">Submitted</div><div class="di-val">${formatDate(q.created_at)}</div></div>
        ${addonsHtml}
        <div class="detail-item detail-full"><div class="di-label">Requirements</div><div class="di-val" style="white-space:pre-wrap">${esc(q.description)}</div></div>
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

// ── Users / Account Control ───────────────────────────
async function loadUsers() {
  const el     = document.getElementById('usersTable');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  const q      = document.getElementById('uac-search')?.value       || '';
  const role   = document.getElementById('uac-role-filter')?.value  || '';
  const status = document.getElementById('uac-status-filter')?.value || '';

  const params = new URLSearchParams({ limit: 200, q, role, status });

  try {
    const res  = await apiFetch(`/admin/users?${params}`);
    const data = await res.json();

    // Update stats strip
    if (data.stats) {
      document.getElementById('uac-total').textContent    = data.stats.total    ?? '–';
      document.getElementById('uac-active').textContent   = data.stats.active   ?? '–';
      document.getElementById('uac-disabled').textContent = data.stats.disabled ?? '–';
      document.getElementById('uac-admins').textContent   = data.stats.admins   ?? '–';
      document.getElementById('uac-clients').textContent  = data.stats.clients  ?? '–';
    }

    if (!data.users?.length) {
      el.innerHTML = emptyState('No users match your search');
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>User</th>
            <th>Phone</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.users.map(u => `
            <tr class="clickable-row ${u.role === 'admin' ? 'user-row-admin' : ''}"
                onclick="openUserDetail(${u.id})">
              <td class="td-muted">${u.id}</td>
              <td>
                <div class="td-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
                <div class="td-muted">${esc(u.email)}</div>
              </td>
              <td class="td-muted">
                ${u.phone
                  ? `<a href="https://wa.me/${u.phone.replace(/\D/g,'')}" target="_blank"
                        style="color:#25d366" onclick="event.stopPropagation()">${esc(u.phone)}</a>`
                  : '–'}
              </td>
              <td>
                <span class="badge badge-${u.role === 'admin' ? 'new' : 'contacted'}">
                  ${u.role === 'admin' ? '⚡ Admin' : 'Client'}
                </span>
              </td>
              <td>
                <span class="badge ${u.is_active ? 'badge-converted' : 'badge-closed'}">
                  ${u.is_active ? 'Active' : 'Disabled'}
                </span>
              </td>
              <td class="td-date">${formatDate(u.created_at)}</td>
              <td class="td-actions" onclick="event.stopPropagation()">
                <button class="btn-outline btn-sm"
                        onclick="openUserModal(${u.id})">Edit</button>
                ${u.role !== 'admin' ? `
                <button class="btn-outline ${u.is_active ? 'danger' : 'success'} btn-sm"
                        onclick="toggleUser(${u.id})">
                  ${u.is_active ? 'Disable' : 'Enable'}
                </button>
                <button class="btn-outline danger btn-sm"
                        onclick="deleteUser(${u.id},'${esc(u.first_name)} ${esc(u.last_name)}',event)">
                  Delete
                </button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:.75rem 1rem;font-size:.8rem;color:var(--muted)">
        Showing ${data.users.length} of ${data.total} users
      </div>`;
  } catch {
    el.innerHTML = errorState('Failed to load users');
  }
}

function clearUserFilters() {
  document.getElementById('uac-search').value        = '';
  document.getElementById('uac-role-filter').value   = '';
  document.getElementById('uac-status-filter').value = '';
  loadUsers();
}

async function openUserDetail(id) {
  const modal   = document.getElementById('userDetailModal');
  const content = document.getElementById('ud-content');
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  modal.classList.add('open');

  try {
    const res = await apiFetch(`/admin/users/${id}`);
    if (!res.ok) throw new Error();
    const u = await res.json();

    const initials = `${u.first_name?.[0] || ''}${u.last_name?.[0] || ''}`.toUpperCase();
    const roleColour = u.role === 'admin' ? 'var(--blue)' : 'var(--green)';

    const recentQuotes = u.recent_quotes || [];
    const recentProps  = u.recent_proposals || [];
    const recentCour   = u.recent_courier || [];

    content.innerHTML = `
      <!-- Header -->
      <div class="ud-header">
        <div class="ud-avatar" style="background:${u.role==='admin'?'rgba(30,111,217,.15)':'var(--green-dim)'};border-color:${roleColour};color:${roleColour}">
          ${initials}
        </div>
        <div style="flex:1">
          <div class="ud-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
          <div class="ud-email">${esc(u.email)}</div>
          <div class="ud-meta">
            ${u.phone ? `<span class="ud-meta-item">📱 <a href="https://wa.me/${u.phone.replace(/\D/g,'')}" target="_blank" style="color:#25d366">${esc(u.phone)}</a></span>` : ''}
            <span class="ud-meta-item">🗓 Joined ${formatDate(u.created_at)}</span>
            <span class="badge badge-${u.role==='admin'?'new':'contacted'}" style="font-size:.72rem">
              ${u.role === 'admin' ? '⚡ Admin' : 'Client'}
            </span>
            <span class="badge ${u.is_active?'badge-converted':'badge-closed'}" style="font-size:.72rem">
              ${u.is_active ? 'Active' : 'Disabled'}
            </span>
          </div>
        </div>
        <div class="ud-header-actions">
          <button class="btn-outline btn-sm" onclick="openUserModal(${u.id});document.getElementById('userDetailModal').classList.remove('open')">
            Edit Account
          </button>
          ${u.role !== 'admin' ? `
          <button class="btn-outline ${u.is_active?'danger':'success'} btn-sm"
                  onclick="toggleUser(${u.id});document.getElementById('userDetailModal').classList.remove('open')">
            ${u.is_active ? 'Disable' : 'Enable'}
          </button>` : ''}
        </div>
      </div>

      <!-- Activity Stats -->
      <div class="ud-activity-strip">
        <div class="ud-act-card">
          <div class="ud-act-val">${u.quote_count || 0}</div>
          <div class="ud-act-lbl">Quote Requests</div>
        </div>
        <div class="ud-act-card">
          <div class="ud-act-val">${u.proposal_count || 0}</div>
          <div class="ud-act-lbl">Proposals</div>
        </div>
        <div class="ud-act-card">
          <div class="ud-act-val">${u.courier_count || 0}</div>
          <div class="ud-act-lbl">Courier Jobs</div>
        </div>
      </div>

      <!-- Recent Quotes -->
      ${recentQuotes.length ? `
      <div class="ud-section-title">Recent Quote Requests</div>
      <div class="ud-activity-list">
        ${recentQuotes.map(q => `
          <div class="ud-act-row" onclick="document.getElementById('userDetailModal').classList.remove('open');openQuoteModal(${q.id})">
            <div class="ud-act-row-info">
              <div class="ud-act-row-title">${esc(q.service)}</div>
              <div class="ud-act-row-sub">${formatDate(q.created_at)}</div>
            </div>
            <span class="badge badge-${q.status}">${q.status}</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- Recent Proposals -->
      ${recentProps.length ? `
      <div class="ud-section-title">Proposals Sent</div>
      <div class="ud-activity-list">
        ${recentProps.map(p => `
          <div class="ud-act-row" onclick="document.getElementById('userDetailModal').classList.remove('open');openProposalModal(${p.id})">
            <div class="ud-act-row-info">
              <div class="ud-act-row-title">${esc(p.title)}</div>
              <div class="ud-act-row-sub">${esc(p.quote_number)} · ${formatDate(p.created_at)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;color:var(--green);font-size:.85rem">R ${parseFloat(p.total).toFixed(2)}</div>
              <span class="badge badge-${p.status}" style="font-size:.7rem">${p.status}</span>
            </div>
          </div>`).join('')}
      </div>` : ''}

      <!-- Recent Courier -->
      ${recentCour.length ? `
      <div class="ud-section-title">Courier Bookings</div>
      <div class="ud-activity-list">
        ${recentCour.map(c => `
          <div class="ud-act-row" onclick="document.getElementById('userDetailModal').classList.remove('open');openCourierModal(${c.id})">
            <div class="ud-act-row-info">
              <div class="ud-act-row-title">${esc(c.item_type)}</div>
              <div class="ud-act-row-sub">${formatDate(c.created_at)}</div>
            </div>
            <span class="badge badge-${c.status}">${statusLabel(c.status)}</span>
          </div>`).join('')}
      </div>` : ''}

      ${!recentQuotes.length && !recentProps.length && !recentCour.length ? `
        <div class="empty-state" style="padding:1.5rem 0">No activity on this account yet</div>
      ` : ''}
    `;
  } catch {
    content.innerHTML = errorState('Failed to load user details.');
  }
}

async function toggleUser(id) {
  await apiFetch(`/admin/users/${id}/toggle`, { method: 'PATCH' });
  loadUsers();
}

function openUserModal(id = null) {
  editingUserId = id;
  const modal = document.getElementById('userModal');
  document.getElementById('um-feedback').classList.add('hidden');
  document.getElementById('um-title').textContent    = id ? 'Edit User' : 'New User';
  document.getElementById('um-pw-label').textContent = id
    ? 'New Password (leave blank to keep current)'
    : 'Password *';
  document.getElementById('um-password').required = !id;

  if (id) {
    apiFetch(`/admin/users/${id}`).then(r => r.json()).then(u => {
      document.getElementById('um-fname').value    = u.first_name;
      document.getElementById('um-lname').value    = u.last_name;
      document.getElementById('um-email').value    = u.email;
      document.getElementById('um-phone').value    = u.phone || '';
      document.getElementById('um-role').value     = u.role;
      document.getElementById('um-active').checked = u.is_active;
      document.getElementById('um-password').value = '';
    });
  } else {
    document.querySelector('#userModal form').reset();
    document.getElementById('um-active').checked = true;
    document.getElementById('um-role').value = 'client';
  }
  modal.classList.add('open');
}

async function saveUser(e) {
  e.preventDefault();
  const btn = document.querySelector('#userModal .btn-g');
  const fb  = document.getElementById('um-feedback');
  btn.textContent = 'Saving…'; btn.disabled = true;
  fb.classList.add('hidden');

  const payload = {
    first_name: document.getElementById('um-fname').value,
    last_name:  document.getElementById('um-lname').value,
    email:      document.getElementById('um-email').value,
    phone:      document.getElementById('um-phone').value || null,
    role:       document.getElementById('um-role').value,
    is_active:  document.getElementById('um-active').checked,
  };
  const pw = document.getElementById('um-password').value;
  if (pw) payload.password = pw;

  try {
    const res = editingUserId
      ? await apiFetch(`/admin/users/${editingUserId}`, { method: 'PUT',  body: JSON.stringify(payload) })
      : await apiFetch('/admin/users',                  { method: 'POST', body: JSON.stringify(payload) });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.errors?.[0]?.msg || err.error || 'Save failed');
    }

    fb.className = 'success-msg';
    fb.textContent = editingUserId ? 'User updated!' : 'User created!';
    fb.classList.remove('hidden');
    loadUsers();
    refreshStats();
    setTimeout(() => document.getElementById('userModal').classList.remove('open'), 700);
  } catch (err) {
    fb.className = 'error-msg';
    fb.textContent = err.message || 'Save failed.';
    fb.classList.remove('hidden');
  } finally {
    btn.textContent = 'Save User'; btn.disabled = false;
  }
}

async function deleteUser(id, name, e) {
  e.stopPropagation();
  if (!confirm(`Delete user "${name}"?\n\nThis is permanent and cannot be undone.`)) return;
  try {
    const res = await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Delete failed.'); return; }
    loadUsers();
    refreshStats();
  } catch { alert('Delete failed.'); }
}

// ── Proposals ─────────────────────────────────────────
async function loadProposals() {
  const status = document.getElementById('proposalStatusFilter')?.value || '';
  const el = document.getElementById('proposalsTable');
  el.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const res  = await apiFetch(`/proposals?${status ? `status=${status}&` : ''}limit=100`);
    const data = await res.json();

    if (!data.proposals?.length) {
      el.innerHTML = emptyState('No proposals yet. Create your first quote!');
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Quote #</th>
            <th>Client</th>
            <th>Title</th>
            <th>Total</th>
            <th>Status</th>
            <th>Valid Until</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${data.proposals.map(p => `
            <tr onclick="openProposalModal(${p.id})">
              <td><code style="color:var(--green);font-size:.78rem">${esc(p.quote_number)}</code></td>
              <td>
                <div class="td-name">${esc(p.client_name)}</div>
                <div class="td-muted">${esc(p.client_email)}</div>
              </td>
              <td>${esc(p.title)}</td>
              <td style="font-weight:700;color:var(--green)">R ${parseFloat(p.total).toFixed(2)}</td>
              <td><span class="badge badge-${p.status}">${p.status}</span></td>
              <td class="td-date">${p.valid_until ? formatDate(p.valid_until) : '–'}</td>
              <td class="td-date">${formatDate(p.created_at)}</td>
              <td class="td-actions" onclick="event.stopPropagation()">
                <button class="btn-outline btn-sm" title="Download PDF" onclick="downloadProposalPDF(${p.id})">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  PDF
                </button>
                <button class="btn-outline success btn-sm" title="Email PDF to client" onclick="emailProposalPDF(${p.id}, event)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  Email
                </button>
                <button class="btn-outline danger btn-sm" title="Delete proposal" onclick="deleteProposal(${p.id},event)">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:.75rem 1rem;font-size:.8rem;color:var(--muted)">${data.total} total proposals</div>`;
  } catch {
    el.innerHTML = errorState('Failed to load proposals');
  }
}

async function openProposalModal(id = null) {
  currentProposalId = id;
  document.getElementById('prm-items').innerHTML = '';
  lineItemCounter = 0;
  document.getElementById('prm-feedback').classList.add('hidden');

  if (id) {
    document.getElementById('prm-modal-title').textContent = 'Edit Proposal';
    try {
      const res = await apiFetch(`/proposals/${id}`);
      const p   = await res.json();
      document.getElementById('prm-title').value    = p.title;
      document.getElementById('prm-cname').value    = p.client_name;
      document.getElementById('prm-cemail').value   = p.client_email;
      document.getElementById('prm-ccompany').value = p.client_company || '';
      document.getElementById('prm-valid').value    = p.valid_until ? p.valid_until.split('T')[0] : '';
      document.getElementById('prm-status').value   = p.status;
      document.getElementById('prm-discount').value = parseFloat(p.discount) || 0;
      document.getElementById('prm-tax').value      = parseFloat(p.tax_rate) || 15;
      document.getElementById('prm-notes').value    = p.notes || '';

      const items = Array.isArray(p.items) ? p.items : JSON.parse(p.items || '[]');
      items.forEach(item => addLineItem(item.description, item.quantity, item.unit_price));

      await loadLeadOptions(p.lead_id);
    } catch {
      document.getElementById('prm-feedback').className = 'error-msg';
      document.getElementById('prm-feedback').textContent = 'Failed to load proposal.';
      document.getElementById('prm-feedback').classList.remove('hidden');
    }
  } else {
    document.getElementById('prm-modal-title').textContent = 'New Proposal';
    document.getElementById('prm-title').value    = '';
    document.getElementById('prm-cname').value    = '';
    document.getElementById('prm-cemail').value   = '';
    document.getElementById('prm-ccompany').value = '';
    document.getElementById('prm-valid').value    = '';
    document.getElementById('prm-status').value   = 'draft';
    document.getElementById('prm-discount').value = '0';
    document.getElementById('prm-tax').value      = '15';
    document.getElementById('prm-notes').value    = '';
    addLineItem();
    await loadLeadOptions(null);
  }

  // Show PDF buttons only when editing an existing proposal
  const pdfBtn   = document.getElementById('prm-pdf-btn');
  const emailBtn = document.getElementById('prm-email-btn');
  if (pdfBtn)   pdfBtn.style.display   = id ? 'inline-flex' : 'none';
  if (emailBtn) emailBtn.style.display = id ? 'inline-flex' : 'none';

  recalcTotals();
  document.getElementById('proposalModal').classList.add('open');
}

async function loadLeadOptions(selectedLeadId = null) {
  const select = document.getElementById('prm-lead');
  select.innerHTML = '<option value="">— Not linked to a lead —</option>';
  try {
    const res  = await apiFetch('/quotes?limit=200');
    const data = await res.json();
    (data.quotes || []).forEach(q => {
      const opt = document.createElement('option');
      opt.value       = q.id;
      opt.textContent = `#${q.id} — ${q.name} (${q.service})`;
      if (selectedLeadId && q.id === selectedLeadId) opt.selected = true;
      select.appendChild(opt);
    });
  } catch { /* lead linking is optional — fail silently */ }
}

function fillClientFromLead() {
  const leadId = document.getElementById('prm-lead').value;
  if (!leadId) return;
  apiFetch(`/quotes/${leadId}`).then(r => r.json()).then(q => {
    document.getElementById('prm-cname').value    = q.name    || '';
    document.getElementById('prm-cemail').value   = q.email   || '';
    document.getElementById('prm-ccompany').value = q.company || '';

    if (!document.getElementById('prm-title').value) {
      document.getElementById('prm-title').value = q.package_tier || q.service || '';
    }

    // Auto-apply matching template from the client's package selection
    const pkg = q.package_tier || q.service || '';
    const templateKey = Object.keys(SERVICE_TEMPLATES).find(k =>
      pkg.toLowerCase().includes(k.toLowerCase().split(' ')[0])
    );
    if (templateKey && !document.querySelector('#prm-items tr')) {
      applyTemplate(templateKey);
    }

    // Pre-load add-ons from the lead as extra line items
    const addons = (() => {
      try { return Array.isArray(q.addons) ? q.addons : (q.addons ? JSON.parse(q.addons) : []); }
      catch { return []; }
    })();
    addons.forEach(a => {
      if (a.price > 0) addLineItem(a.name, 1, a.price);
    });
  }).catch(() => {});
}

function addLineItem(desc = '', qty = 1, price = 0) {
  const id    = ++lineItemCounter;
  const tbody = document.getElementById('prm-items');
  const tr    = document.createElement('tr');
  tr.id = `li-${id}`;
  tr.innerHTML = `
    <td><input type="text"   class="li-desc"  style="width:100%" placeholder="Service or item description" value="${esc(String(desc))}" oninput="recalcTotals()" /></td>
    <td><input type="number" class="li-qty"   style="width:100%" value="${Math.round(qty)}"   min="1" step="1" oninput="recalcTotals()" /></td>
    <td><input type="number" class="li-price" style="width:100%" value="${price}" min="0"    step="0.01" oninput="recalcTotals()" /></td>
    <td class="li-total-val">R 0.00</td>
    <td style="text-align:center">
      <button type="button" onclick="removeLineItem('li-${id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;padding:.2rem .4rem" title="Remove">✕</button>
    </td>`;
  tbody.appendChild(tr);
  recalcTotals();
}

function removeLineItem(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  recalcTotals();
}

function recalcTotals() {
  let subtotal = 0;
  document.querySelectorAll('#prm-items tr').forEach(row => {
    const qty   = parseInt(row.querySelector('.li-qty')?.value,   10) || 0;
    const price = parseFloat(row.querySelector('.li-price')?.value)    || 0;
    const line  = qty * price;
    subtotal   += line;
    const cell  = row.querySelector('.li-total-val');
    if (cell) cell.textContent = `R ${line.toFixed(2)}`;
  });

  const discount = parseFloat(document.getElementById('prm-discount')?.value) || 0;
  const taxRate  = parseFloat(document.getElementById('prm-tax')?.value)      || 0;
  const taxAmt   = (subtotal - discount) * (taxRate / 100);
  const total    = subtotal - discount + taxAmt;

  const s = document.getElementById('prm-subtotal');
  const t = document.getElementById('prm-tax-display');
  const g = document.getElementById('prm-total-display');
  if (s) s.textContent = `R ${subtotal.toFixed(2)}`;
  if (t) t.textContent = `R ${taxAmt.toFixed(2)}`;
  if (g) g.textContent = `R ${total.toFixed(2)}`;
}

function applyTemplate(name) {
  const items = SERVICE_TEMPLATES[name];
  if (!items) return;
  document.getElementById('prm-items').innerHTML = '';
  lineItemCounter = 0;
  items.forEach(i => addLineItem(i.desc, i.qty, i.price));
  recalcTotals();
}

async function saveProposal(e) {
  e.preventDefault();
  const btn = document.querySelector('#proposalModal .save-btn');
  const fb  = document.getElementById('prm-feedback');
  btn.textContent = 'Saving…'; btn.disabled = true;
  fb.classList.add('hidden');

  const items = [];
  document.querySelectorAll('#prm-items tr').forEach(row => {
    const desc  = row.querySelector('.li-desc')?.value?.trim() || '';
    const qty   = parseInt(row.querySelector('.li-qty')?.value,   10) || 1;
    const price = parseFloat(row.querySelector('.li-price')?.value) || 0;
    if (desc) items.push({ description: desc, quantity: qty, unit_price: price });
  });

  if (!items.length) {
    fb.className = 'error-msg';
    fb.textContent = 'Please add at least one line item.';
    fb.classList.remove('hidden');
    btn.textContent = 'Save Proposal'; btn.disabled = false;
    return;
  }

  const payload = {
    title:          document.getElementById('prm-title').value,
    client_name:    document.getElementById('prm-cname').value,
    client_email:   document.getElementById('prm-cemail').value,
    client_company: document.getElementById('prm-ccompany').value || null,
    lead_id:        document.getElementById('prm-lead').value     || null,
    valid_until:    document.getElementById('prm-valid').value    || null,
    status:         document.getElementById('prm-status').value,
    items,
    notes:    document.getElementById('prm-notes').value    || null,
    discount: parseFloat(document.getElementById('prm-discount').value) || 0,
    tax_rate: parseFloat(document.getElementById('prm-tax').value)      || 0,
  };

  try {
    const res = currentProposalId
      ? await apiFetch(`/proposals/${currentProposalId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await apiFetch('/proposals',                       { method: 'POST',  body: JSON.stringify(payload) });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.errors?.[0]?.msg || err.error || 'Save failed');
    }

    fb.className = 'success-msg';
    fb.textContent = currentProposalId ? 'Proposal updated!' : 'Proposal created!';
    fb.classList.remove('hidden');
    loadProposals();
    setTimeout(() => document.getElementById('proposalModal').classList.remove('open'), 700);
  } catch (err) {
    fb.className = 'error-msg';
    fb.textContent = err.message || 'Save failed.';
    fb.classList.remove('hidden');
  } finally {
    btn.textContent = 'Save Proposal'; btn.disabled = false;
  }
}

async function deleteProposal(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this proposal? This cannot be undone.')) return;
  await apiFetch(`/proposals/${id}`, { method: 'DELETE' });
  loadProposals();
}

// ── PDF Download ──────────────────────────────────────
async function downloadProposalPDF(id) {
  try {
    const res = await apiFetch(`/proposals/${id}/pdf`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Could not generate PDF.');
      return;
    }
    // Get the filename from the content-disposition header
    const cd       = res.headers.get('Content-Disposition') || '';
    const match    = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `VTOS-Quote-${id}.pdf`;

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Failed to download PDF. Please try again.');
  }
}

// ── Email PDF to Client ───────────────────────────────
async function emailProposalPDF(id, e) {
  if (e) e.stopPropagation();
  const btn = e?.target?.closest('button');

  const originalHTML = btn?.innerHTML;
  if (btn) { btn.innerHTML = 'Sending…'; btn.disabled = true; }

  try {
    const res  = await apiFetch(`/proposals/${id}/email`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      if (btn) {
        btn.innerHTML = '✓ Sent!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.innerHTML  = originalHTML;
          btn.classList.remove('success');
          btn.disabled   = false;
        }, 3000);
      }
      // Refresh table so status updates to "sent" if it was draft
      loadProposals();
    } else {
      alert(data.error || 'Failed to send email.');
      if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
    }
  } catch {
    alert('Failed to send email. Please check your email configuration.');
    if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
  }
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
