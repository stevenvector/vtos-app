const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateProposalPDF }       = require('../services/pdf');
const { sendProposalPDF }           = require('../services/email');
const { cleanBanking }              = require('./invoices');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];
const CATEGORIES     = ['web', 'led', 'it'];

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
router.get('/', requireAuth, requireAdmin, [
  query('status').optional().isIn(VALID_STATUSES),
  query('category').optional().isIn(CATEGORIES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, category, limit = 50, offset = 0 } = req.query;

  try {
    const conds = [];
    const vals  = [];
    if (status)   { conds.push(`status = $${vals.length + 1}`);   vals.push(status); }
    if (category) { conds.push(`category = $${vals.length + 1}`); vals.push(category); }
    // The list query aliases proposals as p; the count query doesn't.
    const whereP = conds.length ? ` WHERE ${conds.map(c => `p.${c}`).join(' AND ')}` : '';
    const where  = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT p.*, q.name AS lead_name, q.service AS lead_service
      FROM proposals p
      LEFT JOIN quotes q ON q.id = p.lead_id${whereP}
      ORDER BY p.created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;

    const [rows, count] = await Promise.all([
      pool.query(sql, [...vals, Number(limit), Number(offset)]),
      pool.query(`SELECT COUNT(*) FROM proposals${where}`, vals),
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
  // Per-item validation guards against NaN sneaking into the totals when a
  // client sends quantity:'abc' or unit_price:''.
  body('items.*.description').trim().notEmpty().withMessage('Each item needs a description'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Quantity must be > 0'),
  body('items.*.unit_price').isFloat({ min: 0 }).withMessage('Unit price must be ≥ 0'),
  body('notes').optional().trim(),
  body('discount').optional().isFloat({ min: 0 }),
  body('tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('category').optional().isIn(CATEGORIES),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    title, client_name, client_email, client_company,
    lead_id, valid_until, items, notes,
    discount = 0, tax_rate = 0, category,
  } = req.body;

  const banking     = cleanBanking(req.body.banking_details);
  const subtotal    = items.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
  const discountAmt = parseFloat(discount);
  const taxAmt      = (subtotal - discountAmt) * (parseFloat(tax_rate) / 100);
  const total       = subtotal - discountAmt + taxAmt;

  try {
    // Atomic quote-number generation:
    // The number is built INSIDE the INSERT using nextval() on a Postgres
    // sequence — this eliminates the race condition that the old
    // `SELECT COUNT(*)+1` approach had under concurrent submissions.
    // Format: VTOS-Q-YYYY-NNN (numbers don't reset per year — globally sequential).
    const result = await pool.query(
      `INSERT INTO proposals
         (quote_number, lead_id, client_name, client_email, client_company,
          title, valid_until, status, items, notes, banking_details,
          subtotal, discount, tax_rate, total, created_by, category)
       VALUES (
         'VTOS-Q-' || EXTRACT(YEAR FROM NOW())::int
                   || '-' || LPAD(nextval('proposal_number_seq')::text, 3, '0'),
         $1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15
       )
       RETURNING *`,
      [
        lead_id  || null,
        client_name, client_email,
        client_company || null,
        title,
        valid_until    || null,
        JSON.stringify(items),
        notes          || null,
        banking ? JSON.stringify(banking) : null,
        subtotal.toFixed(2),
        discountAmt.toFixed(2),
        tax_rate,
        total.toFixed(2),
        req.user.id,
        category || 'web',
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Proposals] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/proposals/:id — admin: update ──────────
// Dynamic SET — only fields present in req.body are updated. This fixes
// the previous COALESCE behaviour that prevented clearing notes/
// client_company/valid_until/lead_id once they were set. Totals are
// recomputed when items/discount/tax_rate move.
router.patch('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('status').optional().isIn(VALID_STATUSES),
  body('valid_until').optional({ nullable: true }).isDate(),
  body('items').optional().isArray({ min: 1 }),
  body('items.*.description').optional().trim().notEmpty(),
  body('items.*.quantity').optional().isFloat({ gt: 0 }).withMessage('Quantity must be > 0'),
  body('items.*.unit_price').optional().isFloat({ min: 0 }).withMessage('Unit price must be ≥ 0'),
  body('notes').optional({ nullable: true }).trim(),
  body('discount').optional().isFloat({ min: 0 }),
  body('tax_rate').optional().isFloat({ min: 0, max: 100 }),
  body('client_name').optional().trim().notEmpty(),
  body('client_email').optional().isEmail().normalizeEmail(),
  body('client_company').optional({ nullable: true }).trim(),
  body('lead_id').optional({ nullable: true }).isInt(),
  body('category').optional().isIn(CATEGORIES),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const cur = existing.rows[0];
    const b = req.body;

    // Always recompute totals from the resolved items/discount/tax_rate so
    // they stay consistent with whatever's in the row after this update.
    const finalItems    = 'items'    in b ? b.items                : (Array.isArray(cur.items) ? cur.items : JSON.parse(cur.items || '[]'));
    const finalDiscount = 'discount' in b ? parseFloat(b.discount) : parseFloat(cur.discount);
    const finalTaxRate  = 'tax_rate' in b ? parseFloat(b.tax_rate) : parseFloat(cur.tax_rate);

    const subtotal = finalItems.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const taxAmt   = (subtotal - finalDiscount) * (finalTaxRate / 100);
    const total    = subtotal - finalDiscount + taxAmt;

    // Build SET clause dynamically. `'X' in body` distinguishes "field absent"
    // from "field present but null/empty" — letting us actually clear fields.
    const sets = [];
    const vals = [];
    let idx = 1;
    const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

    if ('title'          in b) set('title',          b.title);
    if ('status'         in b) set('status',         b.status);
    if ('valid_until'    in b) set('valid_until',    b.valid_until || null);
    if ('client_name'    in b) set('client_name',    b.client_name);
    if ('client_email'   in b) set('client_email',   b.client_email);
    if ('client_company' in b) set('client_company', b.client_company || null);
    if ('lead_id'        in b) set('lead_id',        b.lead_id || null);
    if ('category'       in b) set('category',       b.category);
    if ('notes'          in b) set('notes',          b.notes || null);
    if ('banking_details' in b) {
      const banking = cleanBanking(b.banking_details);
      set('banking_details', banking ? JSON.stringify(banking) : null);
    }

    // Items + recomputed financials always go together.
    set('items',    JSON.stringify(finalItems));
    set('discount', finalDiscount.toFixed(2));
    set('tax_rate', finalTaxRate);
    set('subtotal', subtotal.toFixed(2));
    set('total',    total.toFixed(2));

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE proposals SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
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
