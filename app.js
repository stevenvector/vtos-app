/* =====================================================
   VTOS — Vector Online Solutions | Frontend App
   ===================================================== */

const API = '/api';

let vtosToken = localStorage.getItem('vtos_token');
let vtosUser  = null;

// ── API helper ────────────────────────────────────────
function apiFetch(path, opts = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(vtosToken ? { Authorization: `Bearer ${vtosToken}` } : {}),
      ...(opts.headers || {}),
    },
  });
}

// ── Navbar scroll effect ──────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

// ── Mobile hamburger ──────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const open = navLinks.classList.contains('open');
  hamburger.querySelectorAll('span')[0].style.transform = open ? 'rotate(45deg) translate(5px,5px)'  : '';
  hamburger.querySelectorAll('span')[1].style.opacity   = open ? '0' : '1';
  hamburger.querySelectorAll('span')[2].style.transform = open ? 'rotate(-45deg) translate(5px,-5px)' : '';
});

navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ── Intersection Observer (scroll reveal) ────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('aos-animate');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('[data-aos]').forEach(el => revealObserver.observe(el));

// ── Active nav highlight ──────────────────────────────
const sections    = document.querySelectorAll('section[id]');
const navAnchors  = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navAnchors.forEach(a => a.classList.remove('nav-active'));
      const active = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (active) active.classList.add('nav-active');
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(s => sectionObserver.observe(s));

// ── Smooth scroll ─────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 72;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── Modal helpers ─────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  }
});

// ── Auth tab switch ───────────────────────────────────
function switchTab(tab) {
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab     = document.getElementById('loginTab');
  const registerTab  = document.getElementById('registerTab');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
  } else {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
  }
}

function togglePass(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ── Auth state on page load ───────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (vtosToken) checkAuthState();
  loadPortfolioItems();
});

async function checkAuthState() {
  try {
    const res = await apiFetch('/auth/me');
    if (res.ok) {
      vtosUser = await res.json();
      updateNavForLoggedIn();
    } else {
      vtosToken = null;
      localStorage.removeItem('vtos_token');
    }
  } catch { /* API offline — silent fail on public page */ }
}

function updateNavForLoggedIn() {
  if (!vtosUser) return;
  const loginLink = document.querySelector('.nav-login');
  if (loginLink) {
    loginLink.textContent = vtosUser.first_name;
    loginLink.href = 'dashboard.html';
    loginLink.onclick = null;
  }
}

// ── Login handler ─────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const errEl = document.getElementById('loginModalErr');

  btn.textContent = 'Signing in…';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    const res  = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email:    document.getElementById('l-email').value,
        password: document.getElementById('l-pass').value,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errEl) { errEl.textContent = data.error || 'Login failed.'; errEl.classList.remove('hidden'); }
      return;
    }

    vtosToken = data.token;
    vtosUser  = data.user;
    localStorage.setItem('vtos_token', vtosToken);
    closeModal('loginModal');
    updateNavForLoggedIn();
    window.location.href = 'dashboard.html';
  } catch {
    if (errEl) { errEl.textContent = 'Could not reach server. Please try again.'; errEl.classList.remove('hidden'); }
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

// ── Register handler ──────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const errEl = document.getElementById('registerModalErr');

  btn.textContent = 'Creating account…';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        first_name: document.getElementById('r-fname').value,
        last_name:  document.getElementById('r-lname').value,
        email:      document.getElementById('r-email').value,
        phone:      document.getElementById('r-phone').value,
        password:   document.getElementById('r-pass').value,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.errors?.[0]?.msg || data.error || 'Registration failed.';
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      return;
    }

    vtosToken = data.token;
    vtosUser  = data.user;
    localStorage.setItem('vtos_token', vtosToken);
    closeModal('loginModal');
    updateNavForLoggedIn();
    window.location.href = 'dashboard.html';
  } catch {
    if (errEl) { errEl.textContent = 'Could not reach server. Please try again.'; errEl.classList.remove('hidden'); }
  } finally {
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}

// ── Quote form submit → API ───────────────────────────
async function submitQuote(e) {
  e.preventDefault();

  const form = document.getElementById('quoteForm');
  const sent = document.getElementById('quoteSent');
  const btn  = form.querySelector('button[type="submit"]');

  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Sending…';
  btn.disabled = true;

  const payload = {
    name:          document.getElementById('q-name').value,
    company:       document.getElementById('q-company').value,
    email:         document.getElementById('q-email').value,
    phone:         document.getElementById('q-phone').value,
    service:       document.getElementById('q-service').value,
    budget:        document.getElementById('q-budget').value,
    description:   document.getElementById('q-desc').value,
    wants_consult: document.getElementById('q-consult').checked,
  };

  try {
    const res = await apiFetch('/quotes', { method: 'POST', body: JSON.stringify(payload) });

    if (res.ok) {
      form.classList.add('hidden');
      sent.classList.remove('hidden');
    } else {
      const data = await res.json();
      alert(data.error || 'Submission failed. Please try again.');
    }
  } catch {
    // API offline — still show success (form data is logged in console as fallback)
    console.warn('[VTOS] API unreachable, quote logged locally:', payload);
    form.classList.add('hidden');
    sent.classList.remove('hidden');
  } finally {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Submit Quote Request';
    btn.disabled = false;
  }
}

// ── Portfolio — load from API ─────────────────────────
async function loadPortfolioItems() {
  const grid = document.getElementById('portfolioGrid');
  if (!grid) return;

  try {
    const res   = await apiFetch('/portfolio');
    if (!res.ok) return; // keep placeholder cards on failure

    const items = await res.json();
    if (!items.length) return;

    // Replace placeholder cards with real data (keep the add card at end)
    const addCard = document.getElementById('portfolioAddCard');

    // Remove existing placeholder items
    grid.querySelectorAll('.portfolio-item').forEach(el => el.remove());

    const tagClass = { website: '', webapp: 'webapp-tag', ecommerce: 'ecom-tag', other: '' };
    const tagLabel = { website: 'Website', webapp: 'Web App', ecommerce: 'E-Commerce', other: 'Project' };

    items.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = `portfolio-item ${item.tag}`;
      div.setAttribute('data-aos', 'fade-up');
      div.setAttribute('data-aos-delay', String((i % 3) * 100));

      div.innerHTML = `
        <div class="portfolio-img ${item.screenshot_url ? '' : 'placeholder-img'}">
          ${item.screenshot_url
            ? `<img src="${item.screenshot_url}" alt="${escHtml(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('placeholder-img');this.remove()" />`
            : `<div class="placeholder-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5" width="32" height="32"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <span>${escHtml(tagLabel[item.tag] || 'Project')}</span>
              </div>`
          }
        </div>
        <div class="portfolio-info">
          <span class="portfolio-tag ${tagClass[item.tag] || ''}">${escHtml(tagLabel[item.tag] || item.tag)}</span>
          <h4>${escHtml(item.title)}</h4>
          <p>${escHtml(item.description)}</p>
          ${item.project_url
            ? `<a href="${item.project_url}" class="portfolio-link" target="_blank" rel="noopener">View Project →</a>`
            : ''}
        </div>`;

      grid.insertBefore(div, addCard);
      revealObserver.observe(div); // trigger scroll animation
    });
  } catch { /* keep placeholder cards */ }
}

// ── Portfolio filter ──────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    const filter = this.dataset.filter;
    document.querySelectorAll('.portfolio-item').forEach(item => {
      const show = filter === 'all' || item.classList.contains(filter);
      item.style.display = show ? '' : 'none';
      if (show) {
        item.classList.remove('aos-animate');
        setTimeout(() => item.classList.add('aos-animate'), 50);
      }
    });
  });
});

// ── Courier-In service card CTA ───────────────────────
document.querySelectorAll('.service-cta').forEach(btn => {
  if (btn.textContent.includes('Courier')) {
    btn.addEventListener('click', e => {
      e.preventDefault();
      // If logged in, go straight to courier page; otherwise prompt login
      if (vtosToken) {
        window.location.href = 'courier.html';
      } else {
        openModal('loginModal');
      }
    });
  }
});

// ── CSS spin keyframe (for loading states) ────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

// ── Helper: HTML escape ───────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Console brand ─────────────────────────────────────
console.log(
  '%c VTOS %c Vector Online Solutions ',
  'background:#39FF14;color:#000;font-weight:900;font-size:14px;padding:4px 8px;border-radius:4px 0 0 4px;',
  'background:#1E6FD9;color:#fff;font-weight:700;font-size:14px;padding:4px 8px;border-radius:0 4px 4px 0;'
);
