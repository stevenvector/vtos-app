const nodemailer = require('nodemailer');

// ── Domain helper — swap automatically when APP_URL env var is set ──
const APP_URL = () => (process.env.APP_URL || 'https://vtos.vercel.app').replace(/\/$/, '');

// ── HTML escape for any user-supplied string interpolated into templates ──
// Without this, a hostile lead can inject <script>/markup that the admin's
// HTML email client will render. Always wrap user-supplied ${…} with esc().
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Allow only http/https URLs in href/src — blocks javascript:, data:, etc.
function safeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '';
}

// ── Transporter ───────────────────────────────────────
// Honours explicit SMTP env vars (EMAIL_HOST / EMAIL_PORT / EMAIL_SECURE)
// when set — needed for Brevo, SendGrid, Mailgun, etc. Falls back to
// nodemailer's `service: 'gmail'` shortcut when only EMAIL_USER/EMAIL_PASS
// are configured. Gmail is capped at ~500 sends/day so production should
// move to a transactional provider.
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null; // email not configured — fail silently
  }
  const auth = {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  };
  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host:   process.env.EMAIL_HOST,
      port:   parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for 587/STARTTLS
      auth,
    });
  }
  return nodemailer.createTransport({ service: 'gmail', auth });
}

async function send(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] Not configured — skipping send to', to);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"VTOS — Vector Online Solutions" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log('[Email] Sent:', subject, '→', to);
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
  }
}

// ── Shared styles ─────────────────────────────────────
const BASE = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#e0e0e0;border-radius:12px;overflow:hidden">
    <div style="background:#111118;padding:28px 32px;border-bottom:2px solid #39FF14">
      <span style="font-size:22px;font-weight:700;color:#39FF14;letter-spacing:1px">VTOS</span>
      <span style="font-size:13px;color:#888;margin-left:8px">Vector Online Solutions</span>
    </div>
    <div style="padding:32px">
      {{BODY}}
    </div>
    <div style="background:#111118;padding:16px 32px;font-size:12px;color:#555;border-top:1px solid #222">
      Vector Online Solutions · info@vtos.co.za · +27 71 360 1539
    </div>
  </div>
`;

function wrap(body) {
  return BASE.replace('{{BODY}}', body);
}

// ── Admin: new quote lead ─────────────────────────────
async function notifyAdminNewQuote(quote) {
  const addonsRows = (quote.addons || []).length
    ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top">Add-ons</td><td style="padding:8px 0;color:#fff">${
        quote.addons.map(a => `${esc(a.name)} (+R${Number(a.price).toLocaleString()})`).join('<br/>')
      }</td></tr>`
    : '';
  const estimateRow = quote.estimate
    ? `<tr><td style="padding:8px 0;color:#888">Estimate</td><td style="padding:8px 0;color:#39FF14;font-weight:700;font-size:15px">R${Number(quote.estimate).toLocaleString()}</td></tr>`
    : '';

  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">🔔 New Quote Request</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#888;width:130px">Name</td><td style="padding:8px 0;color:#fff">${esc(quote.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#fff">${esc(quote.email)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0;color:#fff">${esc(quote.phone) || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Package</td><td style="padding:8px 0;color:#1E6FD9;font-weight:600">${esc(quote.package_tier || quote.service)}</td></tr>
      ${addonsRows}
      ${estimateRow}
      <tr><td style="padding:8px 0;color:#888">Consult?</td><td style="padding:8px 0;color:#fff">${quote.wants_consult ? 'Yes — schedule a call' : 'No'}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#111118;border-radius:8px;border-left:3px solid #1E6FD9">
      <p style="margin:0;color:#aaa;font-size:13px;font-weight:600">Requirements</p>
      <p style="margin:8px 0 0;color:#ddd">${esc(quote.description)}</p>
    </div>
    <a href="${APP_URL()}/admin/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none">Open in Admin Panel →</a>
  `);
  // Subject line is plain text (not HTML rendered) but still strip newlines/control chars
  // to prevent header-injection style issues, and trim length.
  const subjectName = String(quote.name || '').replace(/[\r\n]+/g, ' ').slice(0, 80);
  const subjectPkg  = String(quote.package_tier || quote.service || '').replace(/[\r\n]+/g, ' ').slice(0, 80);
  await send(process.env.EMAIL_USER, `New Quote — ${subjectName} · ${subjectPkg}`, html);
}

// ── Admin: new courier booking ────────────────────────
async function notifyAdminNewCourier(booking, user) {
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">📦 New Courier-In Booking</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#888;width:160px">Client</td><td style="padding:8px 0;color:#fff">${esc(user.first_name)} ${esc(user.last_name)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#fff">${esc(user.email)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Item Type</td><td style="padding:8px 0;color:#1E6FD9;font-weight:600">${esc(booking.item_type)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Item</td><td style="padding:8px 0;color:#fff">${esc(booking.item_description)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Courier</td><td style="padding:8px 0;color:#fff">${esc(booking.courier_company) || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Tracking #</td><td style="padding:8px 0;color:#fff;font-family:monospace">${esc(booking.tracking_number) || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Est. Arrival</td><td style="padding:8px 0;color:#fff">${esc(booking.estimated_arrival) || '—'}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#111118;border-radius:8px;border-left:3px solid #1E6FD9">
      <p style="margin:0;color:#aaa;font-size:13px;font-weight:600">Issue Description</p>
      <p style="margin:8px 0 0;color:#ddd">${esc(booking.issue_description)}</p>
    </div>
    <div style="margin-top:16px;padding:12px 16px;background:#111118;border-radius:8px">
      <span style="color:#888;font-size:13px">Booking Ref: </span>
      <span style="color:#39FF14;font-family:monospace;font-weight:700">VTOS-CIR-${String(booking.id).padStart(5,'0')}</span>
    </div>
    <a href="${APP_URL()}/admin/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none">View in Admin Panel</a>
  `);
  const subjFirst = String(user.first_name || '').replace(/[\r\n]+/g, ' ').slice(0, 40);
  const subjLast  = String(user.last_name  || '').replace(/[\r\n]+/g, ' ').slice(0, 40);
  const subjItem  = String(booking.item_type || '').replace(/[\r\n]+/g, ' ').slice(0, 40);
  await send(process.env.EMAIL_USER, `New Courier Booking — ${subjFirst} ${subjLast} (${subjItem})`, html);
}

// ── Client: quote confirmation ────────────────────────
async function confirmClientQuote(quote) {
  const firstName = String(quote.name || '').split(' ')[0];
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Thanks for reaching out, ${esc(firstName)}!</h2>
    <p style="color:#ccc;line-height:1.6">We've received your quote request and will get back to you within <strong style="color:#fff">24 hours</strong>.</p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 12px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Your Request Summary</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:90px;display:inline-block">Package:</span> <strong style="color:#1E6FD9">${esc(quote.package_tier || quote.service)}</strong></p>
      ${quote.estimate ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:90px;display:inline-block">Estimate:</span> <strong style="color:#39FF14">R${Number(quote.estimate).toLocaleString()}</strong></p>` : ''}
      ${(quote.addons || []).length ? `<p style="margin:8px 0 4px;color:#888;font-size:12px">Selected add-ons: ${esc(quote.addons.map(a => a.name).join(', '))}</p>` : ''}
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:90px;display:inline-block">Consult:</span> ${quote.wants_consult ? 'Yes — we\'ll be in touch to schedule a call' : 'No'}</p>
    </div>
    <p style="color:#888;font-size:14px">In the meantime, feel free to WhatsApp us directly at <a href="https://wa.me/27713601539" style="color:#39FF14">+27 71 360 1539</a> if you have any questions.</p>
  `);
  await send(quote.email, 'We received your quote request — VTOS', html);
}

// ── Client: courier booking confirmation ──────────────
async function confirmClientCourier(booking, user) {
  const ref = `VTOS-CIR-${String(booking.id).padStart(5,'0')}`;
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Courier Booking Confirmed!</h2>
    <p style="color:#ccc;line-height:1.6">Hi ${esc(user.first_name)}, your courier-in booking has been received. Keep this email for your reference.</p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 16px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Booking Details</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Reference:</span> <strong style="color:#39FF14;font-family:monospace">${ref}</strong></p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Item:</span> ${esc(booking.item_description)}</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Type:</span> ${esc(booking.item_type)}</p>
      ${booking.courier_company ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Courier:</span> ${esc(booking.courier_company)}</p>` : ''}
      ${booking.tracking_number ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Tracking #:</span> <span style="font-family:monospace;color:#1E6FD9">${esc(booking.tracking_number)}</span></p>` : ''}
      ${booking.estimated_arrival ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Est. Arrival:</span> ${esc(booking.estimated_arrival)}</p>` : ''}
    </div>
    <p style="color:#ccc;line-height:1.6">We'll update your booking status as your device moves through our workshop. You can track progress anytime in your <a href="${APP_URL()}/dashboard.html" style="color:#39FF14">client dashboard</a>.</p>
    <p style="color:#888;font-size:14px">Questions? WhatsApp us at <a href="https://wa.me/27713601539" style="color:#39FF14">+27 71 360 1539</a></p>
  `);
  await send(user.email, `Courier Booking Confirmed — ${ref}`, html);
}

// ── Client: proposal PDF ──────────────────────────────
async function sendProposalPDF(proposal, pdfBuffer) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] Not configured — skipping proposal PDF to', proposal.client_email);
    return;
  }

  const fmtDate = s => s ? new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const fmt     = n  => `R ${parseFloat(n || 0).toFixed(2)}`;

  const firstName = String(proposal.client_name || '').split(' ')[0];
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Your Quotation from VTOS</h2>
    <p style="color:#ccc;line-height:1.6">Hi ${esc(firstName)},</p>
    <p style="color:#ccc;line-height:1.6">
      Please find your formal quotation attached to this email as a PDF.
      Here's a quick summary:
    </p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 6px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Quote Summary</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Quote #:</span> <strong style="color:#39FF14;font-family:monospace">${esc(proposal.quote_number)}</strong></p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">For:</span> ${esc(proposal.title)}</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Total:</span> <strong style="color:#39FF14">${fmt(proposal.total)}</strong></p>
      ${proposal.valid_until ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Valid Until:</span> <span style="color:#ef4444">${fmtDate(proposal.valid_until)}</span></p>` : ''}
    </div>
    <p style="color:#ccc;line-height:1.6">
      To accept, decline, or ask any questions, please reply to this email or
      WhatsApp us at <a href="https://wa.me/27713601539" style="color:#39FF14">+27 71 360 1539</a>.
    </p>
    <p style="color:#888;font-size:13px;margin-top:24px">
      You can also log in to your
      <a href="${APP_URL()}/dashboard.html" style="color:#39FF14">VTOS Client Portal</a>
      to track the status of this proposal at any time.
    </p>
  `);

  try {
    await transporter.sendMail({
      from:        `"VTOS — Vector Online Solutions" <${process.env.EMAIL_USER}>`,
      to:          proposal.client_email,
      subject:     `Your Quote from VTOS — ${proposal.quote_number}`,
      html,
      attachments: [{
        filename:    `${proposal.quote_number}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    console.log('[Email] Proposal PDF sent:', proposal.quote_number, '→', proposal.client_email);
  } catch (err) {
    console.error('[Email] Proposal PDF send failed:', err.message);
    throw err;
  }
}

// ── Invoice PDF to client ─────────────────────────────
async function sendInvoicePDF(invoice, pdfBuffer) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] Not configured — skipping invoice PDF to', invoice.client_email);
    return;
  }

  const fmtDate = s => s ? new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const fmt     = n  => `R ${parseFloat(n || 0).toFixed(2)}`;

  const banking = (() => {
    const b = invoice.banking_details;
    if (!b) return null;
    try { return typeof b === 'string' ? JSON.parse(b) : b; }
    catch { return null; }
  })();

  const bankingBlock = banking ? `
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #1E6FD9">
      <p style="margin:0 0 6px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Payment Details</p>
      ${banking.bank_name      ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Bank:</span> ${esc(banking.bank_name)}</p>` : ''}
      ${banking.account_holder ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Account Holder:</span> ${esc(banking.account_holder)}</p>` : ''}
      ${banking.account_number ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Account Number:</span> <strong style="color:#fff;font-family:monospace">${esc(banking.account_number)}</strong></p>` : ''}
      ${banking.account_type   ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Account Type:</span> ${esc(banking.account_type)}</p>` : ''}
      ${banking.branch_code    ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Branch Code:</span> ${esc(banking.branch_code)}</p>` : ''}
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Reference:</span> <strong style="color:#39FF14;font-family:monospace">${esc(banking.reference || invoice.invoice_number)}</strong></p>
    </div>` : '';

  const firstName = String(invoice.client_name || '').split(' ')[0];
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Your Invoice from VTOS</h2>
    <p style="color:#ccc;line-height:1.6">Hi ${esc(firstName)},</p>
    <p style="color:#ccc;line-height:1.6">
      Please find your invoice attached to this email as a PDF.
      Here's a quick summary:
    </p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 6px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Invoice Summary</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Invoice #:</span> <strong style="color:#39FF14;font-family:monospace">${esc(invoice.invoice_number)}</strong></p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">For:</span> ${esc(invoice.title)}</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Amount Due:</span> <strong style="color:#39FF14">${fmt(invoice.total)}</strong></p>
      ${invoice.due_date ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Due Date:</span> <span style="color:#ef4444">${fmtDate(invoice.due_date)}</span></p>` : ''}
    </div>
    ${bankingBlock}
    <p style="color:#ccc;line-height:1.6">
      Please use the reference above when making payment so we can match it
      to your account. For any questions, reply to this email or
      WhatsApp us at <a href="https://wa.me/27713601539" style="color:#39FF14">+27 71 360 1539</a>.
    </p>
  `);

  try {
    await transporter.sendMail({
      from:        `"VTOS — Vector Online Solutions" <${process.env.EMAIL_USER}>`,
      to:          invoice.client_email,
      subject:     `Your Invoice from VTOS — ${invoice.invoice_number}`,
      html,
      attachments: [{
        filename:    `${invoice.invoice_number}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    console.log('[Email] Invoice PDF sent:', invoice.invoice_number, '→', invoice.client_email);
  } catch (err) {
    console.error('[Email] Invoice PDF send failed:', err.message);
    throw err;
  }
}

// ── Password reset ────────────────────────────────────
async function sendPasswordReset(email, resetUrl) {
  // Validate the URL is http(s) before placing it in href; refuse to send otherwise.
  const safe = safeUrl(resetUrl);
  if (!safe) {
    console.error('[Email] Refusing to send reset — invalid resetUrl');
    return;
  }
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Password Reset Request</h2>
    <p style="color:#ccc;line-height:1.6">We received a request to reset your VTOS account password. Click the button below to set a new password.</p>
    <a href="${safe}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none;font-size:15px">Reset My Password</a>
    <p style="color:#888;font-size:13px">This link expires in <strong style="color:#ccc">1 hour</strong>. If you didn't request this, you can safely ignore this email — your password won't change.</p>
    <p style="color:#555;font-size:12px;word-break:break-all">Or copy this link: ${safe}</p>
  `);
  await send(email, 'Reset your VTOS password', html);
}

module.exports = {
  notifyAdminNewQuote,
  notifyAdminNewCourier,
  confirmClientQuote,
  confirmClientCourier,
  sendPasswordReset,
  sendProposalPDF,
  sendInvoicePDF,
};
