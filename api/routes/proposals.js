const express = require('express');
const { body, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateProposalPDF }       = require('../services/pdf');
const { sendProposalPDF }           = require('../services/email');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];

// ── GET /api/proposals/client/my — client: own proposals ─
router.get('/client/my', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    const email   = userRes.rows[0]?.email;
    if (!email) return res.status(404).json({ error: 'User not found.' });

    const result = await pool.query(
      `SELECT id, quote_number, title, client_name, status, valid_until, total, created_at
       FROM proposals
       WHERE client_email = $1
       ORDER BY created_at DESC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Proposals] Client my error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/proposals/client/:id — client: single proposal ─
router.get('/client/:id', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    const email   = userRes.rows[0]?.email;

    const result = await pool.query(
      `SELECT p.*, q.name AS lead_name, q.service AS lead_service
       FROM proposals p
       LEFT JOIN quotes q ON q.id = p.lead_id
       WHERE p.id = $1 AND p.client_email = $2`,
      [req.params.id, email]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Proposals] Client single error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/proposals — admin: all proposals ─────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let sql = `
      SELECT p.*, q.name AS lead_name, q.service AS lead_service
      FROM proposals p
      LEFT JOIN quotes q ON q.id = p.lead_id`;
    const vals = [];

    if (status) {
      sql += ` WHERE p.status = $${vals.length + 1}`;
      vals.push(status);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
    vals.push(Number(limit), Number(offset));

    const [rows, count] = await Promise.all([
      pool.query(sql, vals),
      pool.query(
        `SELECT COUNT(*) FROM proposals${status ? ' WHERE status=$1' : ''}`,
        status ? [status] : []
      ),
    ]);

    res.json({ proposals: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[Proposals] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/proposals/:id/pdf — admin: download PDF ──
router.get('/:id/pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const proposal = result.rows[0];
    const pdf      = await generateProposalPDF(proposal);

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${proposal.quote_number}.pdf"`);
    res.setHeader('Content-Length',      pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('[Proposals] PDF error:', err.message);
    res.status(500).json({ error: 'Could not generate PDF.' });
  }
});

// ── POST /api/proposals/:id/email — admin: email PDF to client ──
router.post('/:id/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const proposal = result.rows[0];
    const pdf      = await generateProposalPDF(proposal);
    await sendProposalPDF(proposal, pdf);

    // Mark as sent if it was still a draft
    if (proposal.status === 'draft') {
      await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [req.params.id]);
    }

    res.json({ message: `Proposal emailed to ${proposal.client_email}.` });
  } catch (err) {
    console.error('[Proposals] Email PDF error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check email configuration.' });
  }
});

// ── GET /api/proposals/:id — admin: single proposal ───
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, q.name AS lead_name, q.service AS lead_service, q.email AS lead_email
       FROM proposals p
       LEFT JOIN quotes q ON q.id = p.lead_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Proposals] Get single error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/proposals — admin: create ───────────────
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('client_name').trim().notEmpty().withMessage('Client name is required'),
  body('client_email').isEmail().normalizeEmail().withMessage('Valid client email required'),
  body('client_company').optional().trim(),
  body('lead_id').optional({ nullable: true }).isInt(),
  body('valid_until').optional({ nullable: true }).isDate().withMessage('Invalid date'),
  body('items').isArray({ min: 1 }).withMessage('At least one line item is required'),
  body('notes').optional().trim(),
  body('discount').optional().isFloat({ min: 0 }),
  body('tax_rate').optional().isFloat({ min: 0, max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    title, client_name, client_email, client_company,
    lead_id, valid_until, items, notes,
    discount = 0, tax_rate = 0,
  } = req.body;

  const subtotal    = items.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
  const discountAmt = parseFloat(discount);
  const taxAmt      = (subtotal - discountAmt) * (parseFloat(tax_rate) / 100);
  const total       = subtotal - discountAmt + taxAmt;

  try {
    // Generate quote number: VTOS-Q-YYYY-NNN
    const yearCountRes = await pool.query(
      `SELECT COUNT(*) FROM proposals WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`
    );
    const seq          = parseInt(yearCountRes.rows[0].count) + 1;
    const quote_number = `VTOS-Q-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO proposals
         (quote_number, lead_id, client_name, client_email, client_company,
          title, valid_until, status, items, notes,
          subtotal, discount, tax_rate, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        quote_number,
        lead_id  || null,
        client_name, client_email,
        client_company || null,
        title,
        valid_until    || null,
        JSON.stringify(items),
        notes          || null,
        subtotal.toFixed(2),
        discountAmt.toFixed(2),
        tax_rate,
        total.toFixed(2),
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Proposals] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/proposals/:id — admin: update ──────────
router.patch('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('status').optional().isIn(VALID_STATUSES),
  body('valid_until').optional({ nullable: true }).isDate(),
  body('items').optional().isArray({ min: 1 }),
  body('notes').optional().trim(),
  body('discount').optional().isFloat({ min: 0 }),
  body('tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('client_name').optional().trim().notEmpty(),
  body('client_email').optional().isEmail().normalizeEmail(),
  body('client_company').optional().trim(),
  body('lead_id').optional({ nullable: true }).isInt(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const cur = existing.rows[0];
    const {
      title, status, valid_until, items, notes,
      discount, tax_rate, client_name, client_email, client_company, lead_id,
    } = req.body;

    const finalItems    = items      !== undefined ? items      : (Array.isArray(cur.items) ? cur.items : JSON.parse(cur.items || '[]'));
    const finalDiscount = discount   !== undefined ? parseFloat(discount)  : parseFloat(cur.discount);
    const finalTaxRate  = tax_rate   !== undefined ? parseFloat(tax_rate)  : parseFloat(cur.tax_rate);

    const subtotal = finalItems.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const taxAmt   = (subtotal - finalDiscount) * (finalTaxRate / 100);
    const total    = subtotal - finalDiscount + taxAmt;

    const result = await pool.query(
      `UPDATE proposals SET
        title          = COALESCE($1,  title),
        status         = COALESCE($2,  status),
        valid_until    = COALESCE($3,  valid_until),
        items          = $4,
        notes          = COALESCE($5,  notes),
        discount       = $6,
        tax_rate       = $7,
        subtotal       = $8,
        total          = $9,
        client_name    = COALESCE($10, client_name),
        client_email   = COALESCE($11, client_email),
        client_company = COALESCE($12, client_company),
        lead_id        = COALESCE($13, lead_id)
       WHERE id = $14
       RETURNING *`,
      [
        title        || null,
        status       || null,
        valid_until  !== undefined ? (valid_until || null) : null,
        JSON.stringify(finalItems),
        notes        !== undefined ? (notes || null) : null,
        finalDiscount.toFixed(2),
        finalTaxRate,
        subtotal.toFixed(2),
        total.toFixed(2),
        client_name   || null,
        client_email  || null,
        client_company !== undefined ? (client_company || null) : null,
        lead_id       !== undefined ? (lead_id || null) : null,
        req.params.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Proposals] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/proposals/:id — admin ─────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM proposals WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });
    res.json({ message: 'Proposal deleted.' });
  } catch (err) {
    console.error('[Proposals] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
