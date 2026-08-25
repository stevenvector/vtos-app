const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateInvoicePDF }        = require('../services/pdf');
const { sendInvoicePDF }            = require('../services/email');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
const CATEGORIES     = ['web', 'led', 'it'];

// Whitelist + stringify banking detail fields so arbitrary JSON can't be stored.
const BANKING_FIELDS = ['bank_name', 'account_holder', 'account_number', 'account_type', 'branch_code', 'reference'];
function cleanBanking(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const f of BANKING_FIELDS) {
    const v = input[f];
    if (v != null && String(v).trim() !== '') out[f] = String(v).trim().slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

// ── GET /api/invoices/client/my — client: own invoices ─
router.get('/client/my', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    const email   = userRes.rows[0]?.email;
    if (!email) return res.status(404).json({ error: 'User not found.' });

    const result = await pool.query(
      `SELECT id, invoice_number, title, client_name, status, due_date, total, created_at
       FROM invoices
       WHERE client_email = $1
       ORDER BY created_at DESC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Invoices] Client my error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/invoices — admin: all invoices ───────────
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
    // The list query aliases invoices as i; the count query doesn't.
    const whereI = conds.length ? ` WHERE ${conds.map(c => `i.${c}`).join(' AND ')}` : '';
    const where  = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT i.*, p.quote_number AS source_quote_number
      FROM invoices i
      LEFT JOIN proposals p ON p.id = i.proposal_id${whereI}
      ORDER BY i.created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;

    const [rows, count] = await Promise.all([
      pool.query(sql, [...vals, Number(limit), Number(offset)]),
      pool.query(`SELECT COUNT(*) FROM invoices${where}`, vals),
    ]);

    res.json({ invoices: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[Invoices] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/invoices/:id/pdf — admin: download PDF ───
router.get('/:id/pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invoice not found.' });

    const invoice = result.rows[0];
    const pdf     = await generateInvoicePDF(invoice);

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.setHeader('Content-Length',      pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('[Invoices] PDF error:', err.message);
    res.status(500).json({ error: 'Could not generate PDF.' });
  }
});

// ── POST /api/invoices/:id/email — admin: email PDF to client ──
router.post('/:id/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invoice not found.' });

    const invoice = result.rows[0];
    const pdf     = await generateInvoicePDF(invoice);
    await sendInvoicePDF(invoice, pdf);

    // Mark as sent if it was still a draft
    if (invoice.status === 'draft') {
      await pool.query("UPDATE invoices SET status = 'sent' WHERE id = $1", [req.params.id]);
    }

    res.json({ message: `Invoice emailed to ${invoice.client_email}.` });
  } catch (err) {
    console.error('[Invoices] Email PDF error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check email configuration.' });
  }
});

// ── GET /api/invoices/:id — admin: single invoice ─────
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, p.quote_number AS source_quote_number
       FROM invoices i
       LEFT JOIN proposals p ON p.id = i.proposal_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invoice not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Invoices] Get single error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/invoices — admin: create ────────────────
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('client_name').trim().notEmpty().withMessage('Client name is required'),
  body('client_email').isEmail().normalizeEmail().withMessage('Valid client email required'),
  body('client_company').optional().trim(),
  body('proposal_id').optional({ nullable: true }).isInt(),
  body('due_date').optional({ nullable: true }).isDate().withMessage('Invalid date'),
  body('items').isArray({ min: 1 }).withMessage('At least one line item is required'),
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
    proposal_id, due_date, items, notes,
    discount = 0, tax_rate = 0, category,
  } = req.body;

  const banking     = cleanBanking(req.body.banking_details);
  const subtotal    = items.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
  const discountAmt = parseFloat(discount);
  const taxAmt      = (subtotal - discountAmt) * (parseFloat(tax_rate) / 100);
  const total       = subtotal - discountAmt + taxAmt;

  try {
    // Atomic invoice-number generation via Postgres sequence.
    // Format: VTOS-INV-YYYY-NNN (globally sequential — see schema.sql).
    const result = await pool.query(
      `INSERT INTO invoices
         (invoice_number, proposal_id, client_name, client_email, client_company,
          title, due_date, status, items, notes, banking_details,
          subtotal, discount, tax_rate, total, created_by, category)
       VALUES (
         'VTOS-INV-' || EXTRACT(YEAR FROM NOW())::int
                     || '-' || LPAD(nextval('invoice_number_seq')::text, 3, '0'),
         $1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15
       )
       RETURNING *`,
      [
        proposal_id || null,
        client_name, client_email,
        client_company || null,
        title,
        due_date       || null,
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
    console.error('[Invoices] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/invoices/:id — admin: update ───────────
// Dynamic SET, same pattern as proposals — only fields present in the body
// are updated; totals are always recomputed from the resolved values.
router.patch('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('status').optional().isIn(VALID_STATUSES),
  body('due_date').optional({ nullable: true }).isDate(),
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
  body('proposal_id').optional({ nullable: true }).isInt(),
  body('category').optional().isIn(CATEGORIES),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Invoice not found.' });

    const cur = existing.rows[0];
    const b = req.body;

    const finalItems    = 'items'    in b ? b.items                : (Array.isArray(cur.items) ? cur.items : JSON.parse(cur.items || '[]'));
    const finalDiscount = 'discount' in b ? parseFloat(b.discount) : parseFloat(cur.discount);
    const finalTaxRate  = 'tax_rate' in b ? parseFloat(b.tax_rate) : parseFloat(cur.tax_rate);

    const subtotal = finalItems.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const taxAmt   = (subtotal - finalDiscount) * (finalTaxRate / 100);
    const total    = subtotal - finalDiscount + taxAmt;

    const sets = [];
    const vals = [];
    let idx = 1;
    const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

    if ('title'           in b) set('title',           b.title);
    if ('status'          in b) set('status',          b.status);
    if ('due_date'        in b) set('due_date',        b.due_date || null);
    if ('client_name'     in b) set('client_name',     b.client_name);
    if ('client_email'    in b) set('client_email',    b.client_email);
    if ('client_company'  in b) set('client_company',  b.client_company || null);
    if ('proposal_id'     in b) set('proposal_id',     b.proposal_id || null);
    if ('category'        in b) set('category',        b.category);
    if ('notes'           in b) set('notes',           b.notes || null);
    if ('banking_details' in b) {
      const banking = cleanBanking(b.banking_details);
      set('banking_details', banking ? JSON.stringify(banking) : null);
    }

    set('items',    JSON.stringify(finalItems));
    set('discount', finalDiscount.toFixed(2));
    set('tax_rate', finalTaxRate);
    set('subtotal', subtotal.toFixed(2));
    set('total',    total.toFixed(2));

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Invoices] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/invoices/:id — admin ──────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ message: 'Invoice deleted.' });
  } catch (err) {
    console.error('[Invoices] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
module.exports.cleanBanking = cleanBanking;
