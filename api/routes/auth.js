const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool     = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.first_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/register ───────────────────────────
router.post('/register', [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { first_name, last_name, email, password, phone } = req.body;

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, phone, role, created_at`,
      [first_name, last_name, email, hash, phone || null]
    );

    const user  = result.rows[0];
    const token = signToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user);
    const { password_hash, ...safeUser } = user;

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, first_name, last_name, email, phone, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/auth/profile ───────────────────────────
router.patch('/profile', requireAuth, [
  body('first_name').optional().trim().notEmpty(),
  body('last_name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { first_name, last_name, phone } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name  = COALESCE($2, last_name),
        phone      = COALESCE($3, phone)
       WHERE id = $4
       RETURNING id, first_name, last_name, email, phone, role`,
      [first_name || null, last_name || null, phone || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Auth] Profile update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── PATCH /api/auth/password ──────────────────────────
router.patch('/password', requireAuth, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { current_password, new_password } = req.body;

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid  = await bcrypt.compare(current_password, result.rows[0].password_hash);

    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[Auth] Password change error:', err.message);
    res.status(500).json({ error: 'Password update failed.' });
  }
});

module.exports = router;
