const nodemailer = require('nodemailer');

// ── Transporter ───────────────────────────────────────
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null; // email not configured — fail silently
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
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
      Vector Online Solutions · vtechonlinesolutions@gmail.com · +27 73 418 5106
    </div>
  </div>
`;

function wrap(body) {
  return BASE.replace('{{BODY}}', body);
}

// ── Admin: new quote lead ─────────────────────────────
async function notifyAdminNewQuote(quote) {
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">🔔 New Quote Request</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#888;width:130px">Name</td><td style="padding:8px 0;color:#fff">${quote.name}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#fff">${quote.email}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0;color:#fff">${quote.phone || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Service</td><td style="padding:8px 0;color:#1E6FD9;font-weight:600">${quote.service}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Budget</td><td style="padding:8px 0;color:#fff">${quote.budget || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Consult?</td><td style="padding:8px 0;color:#fff">${quote.wants_consult ? 'Yes' : 'No'}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#111118;border-radius:8px;border-left:3px solid #1E6FD9">
      <p style="margin:0;color:#aaa;font-size:13px;font-weight:600">Description</p>
      <p style="margin:8px 0 0;color:#ddd">${quote.description}</p>
    </div>
    <a href="https://vtos.vercel.app/admin/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none">View in Admin Panel</a>
  `);
  await send(process.env.EMAIL_USER, `New Quote Request — ${quote.name} (${quote.service})`, html);
}

// ── Admin: new courier booking ────────────────────────
async function notifyAdminNewCourier(booking, user) {
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">📦 New Courier-In Booking</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#888;width:160px">Client</td><td style="padding:8px 0;color:#fff">${user.first_name} ${user.last_name}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0;color:#fff">${user.email}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Item Type</td><td style="padding:8px 0;color:#1E6FD9;font-weight:600">${booking.item_type}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Item</td><td style="padding:8px 0;color:#fff">${booking.item_description}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Courier</td><td style="padding:8px 0;color:#fff">${booking.courier_company || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Tracking #</td><td style="padding:8px 0;color:#fff;font-family:monospace">${booking.tracking_number || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Est. Arrival</td><td style="padding:8px 0;color:#fff">${booking.estimated_arrival || '—'}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#111118;border-radius:8px;border-left:3px solid #1E6FD9">
      <p style="margin:0;color:#aaa;font-size:13px;font-weight:600">Issue Description</p>
      <p style="margin:8px 0 0;color:#ddd">${booking.issue_description}</p>
    </div>
    <div style="margin-top:16px;padding:12px 16px;background:#111118;border-radius:8px">
      <span style="color:#888;font-size:13px">Booking Ref: </span>
      <span style="color:#39FF14;font-family:monospace;font-weight:700">VTOS-CIR-${String(booking.id).padStart(5,'0')}</span>
    </div>
    <a href="https://vtos.vercel.app/admin/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none">View in Admin Panel</a>
  `);
  await send(process.env.EMAIL_USER, `New Courier Booking — ${user.first_name} ${user.last_name} (${booking.item_type})`, html);
}

// ── Client: quote confirmation ────────────────────────
async function confirmClientQuote(quote) {
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Thanks for reaching out, ${quote.name.split(' ')[0]}!</h2>
    <p style="color:#ccc;line-height:1.6">We've received your quote request and will get back to you within <strong style="color:#fff">24 hours</strong>.</p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 12px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Your Request Summary</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:80px;display:inline-block">Service:</span> <strong style="color:#1E6FD9">${quote.service}</strong></p>
      ${quote.budget ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:80px;display:inline-block">Budget:</span> ${quote.budget}</p>` : ''}
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:80px;display:inline-block">Consult:</span> ${quote.wants_consult ? 'Yes — we\'ll suggest a time' : 'No'}</p>
    </div>
    <p style="color:#888;font-size:14px">In the meantime, feel free to WhatsApp us directly at <a href="https://wa.me/27734185106" style="color:#39FF14">+27 73 418 5106</a> if you have any questions.</p>
  `);
  await send(quote.email, 'We received your quote request — VTOS', html);
}

// ── Client: courier booking confirmation ──────────────
async function confirmClientCourier(booking, user) {
  const ref = `VTOS-CIR-${String(booking.id).padStart(5,'0')}`;
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Courier Booking Confirmed!</h2>
    <p style="color:#ccc;line-height:1.6">Hi ${user.first_name}, your courier-in booking has been received. Keep this email for your reference.</p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 16px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Booking Details</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Reference:</span> <strong style="color:#39FF14;font-family:monospace">${ref}</strong></p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Item:</span> ${booking.item_description}</p>
      <p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Type:</span> ${booking.item_type}</p>
      ${booking.courier_company ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Courier:</span> ${booking.courier_company}</p>` : ''}
      ${booking.tracking_number ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Tracking #:</span> <span style="font-family:monospace;color:#1E6FD9">${booking.tracking_number}</span></p>` : ''}
      ${booking.estimated_arrival ? `<p style="margin:4px 0;color:#ddd"><span style="color:#888;min-width:140px;display:inline-block">Est. Arrival:</span> ${booking.estimated_arrival}</p>` : ''}
    </div>
    <p style="color:#ccc;line-height:1.6">We'll update your booking status as your device moves through our workshop. You can track progress anytime in your <a href="https://vtos.vercel.app/dashboard.html" style="color:#39FF14">client dashboard</a>.</p>
    <p style="color:#888;font-size:14px">Questions? WhatsApp us at <a href="https://wa.me/27734185106" style="color:#39FF14">+27 73 418 5106</a></p>
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

  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Your Quotation from VTOS</h2>
    <p style="color:#ccc;line-height:1.6">Hi ${proposal.client_name.split(' ')[0]},</p>
    <p style="color:#ccc;line-height:1.6">
      Please find your formal quotation attached to this email as a PDF.
      Here's a quick summary:
    </p>
    <div style="margin:24px 0;padding:20px;background:#111118;border-radius:8px;border-left:3px solid #39FF14">
      <p style="margin:0 0 6px;color:#aaa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Quote Summary</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Quote #:</span> <strong style="color:#39FF14;font-family:monospace">${proposal.quote_number}</strong></p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">For:</span> ${proposal.title}</p>
      <p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Total:</span> <strong style="color:#39FF14">${fmt(proposal.total)}</strong></p>
      ${proposal.valid_until ? `<p style="margin:6px 0;color:#ddd"><span style="color:#888;min-width:120px;display:inline-block">Valid Until:</span> <span style="color:#ef4444">${fmtDate(proposal.valid_until)}</span></p>` : ''}
    </div>
    <p style="color:#ccc;line-height:1.6">
      To accept, decline, or ask any questions, please reply to this email or
      WhatsApp us at <a href="https://wa.me/27734185106" style="color:#39FF14">+27 73 418 5106</a>.
    </p>
    <p style="color:#888;font-size:13px;margin-top:24px">
      You can also log in to your
      <a href="https://vtos.vercel.app/dashboard.html" style="color:#39FF14">VTOS Client Portal</a>
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

// ── Password reset ────────────────────────────────────
async function sendPasswordReset(email, resetUrl) {
  const html = wrap(`
    <h2 style="color:#39FF14;margin-top:0">Password Reset Request</h2>
    <p style="color:#ccc;line-height:1.6">We received a request to reset your VTOS account password. Click the button below to set a new password.</p>
    <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#39FF14;color:#0a0a0f;font-weight:700;border-radius:8px;text-decoration:none;font-size:15px">Reset My Password</a>
    <p style="color:#888;font-size:13px">This link expires in <strong style="color:#ccc">1 hour</strong>. If you didn't request this, you can safely ignore this email — your password won't change.</p>
    <p style="color:#555;font-size:12px;word-break:break-all">Or copy this link: ${resetUrl}</p>
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
};
