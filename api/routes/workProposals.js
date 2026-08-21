const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateWorkProposalPDF }   = require('../services/pdf');

const router = express.Router();

const VALID_STATUSES = ['draft', 'sent', 'accepted', 'declined'];

// ── GET /api/work-proposals — admin: all ──────────────
router.get('/', requireAuth, requireAdmin, [
  query('status').optional().isIn(VALID_STATUSES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let sql = 'SELECT * FROM work_proposals';
    const vals = [];

    if (status) {
      sql += ` WHERE status = $${vals.length + 1}`;
      vals.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
    vals.push(Number(limit), Number(offset));

    const [rows, count] = await Promise.all([
      pool.query(sql, vals),
      pool.query(
        `SELECT COUNT(*) FROM work_proposals${status ? ' WHERE status=$1' : ''}`,
        status ? [status] : []
      ),
    ]);

    res.json({ proposals: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[WorkProposals] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/work-proposals/:id/pdf — admin: download PDF ──
router.get('/:id/pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM work_proposals WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const proposal = result.rows[0];
    const pdf      = await generateWorkProposalPDF(proposal);

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${proposal.proposal_number}.pdf"`);
    res.setHeader('Content-Length',      pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('[WorkProposals] PDF error:', err.message);
    res.status(500).json({ error: 'Could not generate PDF.' });
  }
});

// ── GET /api/work-proposals/:id — admin: single ───────
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM work_proposals WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[WorkProposals] Get single error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/work-proposals — admin: create ──────────
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('client_name').trim().notEmpty().withMessage('Client name is required'),
  body('client_email').isEmail().normalizeEmail().withMessage('Valid client email required'),
  body('client_company').optional({ nullable: true }).trim(),
  body('overview').optional({ nullable: true }).trim(),
  body('valid_until').optional({ nullable: true }).isDate().withMessage('Invalid date'),
  body('status').optional().isIn(VALID_STATUSES),
  body('work_items').isArray({ min: 1 }).withMessage('At least one work item is required'),
  body('work_items.*.title').trim().notEmpty().withMessage('Each work item needs a title'),
  body('work_items.*.description').trim().notEmpty().withMessage('Each work item needs a description'),
  body('work_items.*.timeline').optional({ nullable: true }).trim(),
  body('work_items.*.estimate').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    title, client_name, client_email, client_company,
    overview, valid_until, status = 'draft', work_items, notes,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO work_proposals
         (proposal_number, client_name, client_email, client_company,
          title, overview, valid_until, status, work_items, notes, created_by)
       VALUES (
         'VTOS-P-' || EXTRACT(YEAR FROM NOW())::int
                   || '-' || LPAD(nextval('work_proposal_number_seq')::text, 3, '0'),
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
       )
       RETURNING *`,
      [
        client_name, client_email,
        client_company || null,
        title,
        overview    || null,
        valid_until || null,
        status,
        JSON.stringify(work_items),
        notes || null,
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[WorkProposals] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/work-proposals/:id — admin: update ─────
router.patch('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('client_name').optional().trim().notEmpty(),
  body('client_email').optional().isEmail().normalizeEmail(),
  body('client_company').optional({ nullable: true }).trim(),
  body('overview').optional({ nullable: true }).trim(),
  body('valid_until').optional({ nullable: true }).isDate(),
  body('status').optional().isIn(VALID_STATUSES),
  body('work_items').optional().isArray({ min: 1 }),
  body('work_items.*.title').optional().trim().notEmpty(),
  body('work_items.*.description').optional().trim().notEmpty(),
  body('work_items.*.timeline').optional({ nullable: true }).trim(),
  body('work_items.*.estimate').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await pool.query('SELECT id FROM work_proposals WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });

    const b = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;
    const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

    if ('title'          in b) set('title',          b.title);
    if ('client_name'    in b) set('client_name',    b.client_name);
    if ('client_email'   in b) set('client_email',   b.client_email);
    if ('client_company' in b) set('client_company', b.client_company || null);
    if ('overview'       in b) set('overview',       b.overview || null);
    if ('valid_until'    in b) set('valid_until',    b.valid_until || null);
    if ('status'         in b) set('status',         b.status);
    if ('work_items'     in b) set('work_items',     JSON.stringify(b.work_items));
    if ('notes'          in b) set('notes',          b.notes || null);

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE work_proposals SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[WorkProposals] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/work-proposals/:id — admin ────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM work_proposals WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Proposal not found.' });
    res.json({ message: 'Proposal deleted.' });
  } catch (err) {
    console.error('[WorkProposals] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
