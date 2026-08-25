const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateReportPDF }         = require('../services/pdf');

const router = express.Router();

const VALID_STATUSES = ['draft', 'final', 'sent'];
const VALID_TYPES    = ['general', 'progress', 'completion', 'diagnostic', 'maintenance'];

// ── GET /api/reports — admin: all reports ─────────────
router.get('/', requireAuth, requireAdmin, [
  query('status').optional().isIn(VALID_STATUSES),
  query('report_type').optional().isIn(VALID_TYPES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, report_type, limit = 50, offset = 0 } = req.query;

  try {
    const where = [];
    const vals  = [];
    if (status)      { where.push(`status = $${vals.length + 1}`);      vals.push(status); }
    if (report_type) { where.push(`report_type = $${vals.length + 1}`); vals.push(report_type); }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const listSql = `SELECT * FROM client_reports${whereSql}
                     ORDER BY created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;

    const [rows, count] = await Promise.all([
      pool.query(listSql, [...vals, Number(limit), Number(offset)]),
      pool.query(`SELECT COUNT(*) FROM client_reports${whereSql}`, vals),
    ]);

    res.json({ reports: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[Reports] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/reports/:id/pdf — admin: download PDF ───
router.get('/:id/pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM client_reports WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Report not found.' });

    const report = result.rows[0];
    const pdf    = await generateReportPDF(report);

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.report_number}.pdf"`);
    res.setHeader('Content-Length',      pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('[Reports] PDF error:', err.message);
    res.status(500).json({ error: 'Could not generate PDF.' });
  }
});

// ── GET /api/reports/:id — admin: single report ───────
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM client_reports WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Report not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Reports] Get single error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/reports — admin: create ─────────────────
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('client_name').trim().notEmpty().withMessage('Client name is required'),
  body('client_email').isEmail().normalizeEmail().withMessage('Valid client email required'),
  body('client_company').optional({ nullable: true }).trim(),
  body('report_type').optional().isIn(VALID_TYPES),
  body('report_date').optional({ nullable: true }).isDate().withMessage('Invalid date'),
  body('status').optional().isIn(VALID_STATUSES),
  body('summary').optional({ nullable: true }).trim(),
  body('sections').isArray({ min: 1 }).withMessage('At least one section is required'),
  body('sections.*.heading').trim().notEmpty().withMessage('Each section needs a heading'),
  body('sections.*.body').trim().notEmpty().withMessage('Each section needs content'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    title, client_name, client_email, client_company,
    report_type = 'general', report_date, status = 'draft',
    summary, sections,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO client_reports
         (report_number, client_name, client_email, client_company,
          title, report_type, report_date, status, summary, sections, created_by)
       VALUES (
         'VTOS-R-' || EXTRACT(YEAR FROM NOW())::int
                   || '-' || LPAD(nextval('report_number_seq')::text, 3, '0'),
         $1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9,$10
       )
       RETURNING *`,
      [
        client_name, client_email,
        client_company || null,
        title, report_type,
        report_date || null,
        status,
        summary || null,
        JSON.stringify(sections),
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Reports] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/reports/:id — admin: update ────────────
router.patch('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('client_name').optional().trim().notEmpty(),
  body('client_email').optional().isEmail().normalizeEmail(),
  body('client_company').optional({ nullable: true }).trim(),
  body('report_type').optional().isIn(VALID_TYPES),
  body('report_date').optional({ nullable: true }).isDate(),
  body('status').optional().isIn(VALID_STATUSES),
  body('summary').optional({ nullable: true }).trim(),
  body('sections').optional().isArray({ min: 1 }),
  body('sections.*.heading').optional().trim().notEmpty(),
  body('sections.*.body').optional().trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await pool.query('SELECT id FROM client_reports WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Report not found.' });

    const b = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;
    const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

    if ('title'          in b) set('title',          b.title);
    if ('client_name'    in b) set('client_name',    b.client_name);
    if ('client_email'   in b) set('client_email',   b.client_email);
    if ('client_company' in b) set('client_company', b.client_company || null);
    if ('report_type'    in b) set('report_type',    b.report_type);
    if ('report_date'    in b) set('report_date',    b.report_date || null);
    if ('status'         in b) set('status',         b.status);
    if ('summary'        in b) set('summary',        b.summary || null);
    if ('sections'       in b) set('sections',       JSON.stringify(b.sections));

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE client_reports SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Reports] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/reports/:id — admin ───────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM client_reports WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Report not found.' });
    res.json({ message: 'Report deleted.' });
  } catch (err) {
    console.error('[Reports] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
