const jwt  = require('jsonwebtoken');
const pool = require('../db/connection');

// Fail fast if JWT_SECRET is missing or trivially weak — every request
// downstream depends on it. Without this check, the first authed request
// would 401 with a generic error instead of pointing at config.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error(
    '[Auth] FATAL: JWT_SECRET is missing or shorter than 32 chars. ' +
    'Set a long random value in env (e.g. `openssl rand -hex 32`).'
  );
  // Don't crash the serverless cold start outright — that takes the whole
  // app down. Log loudly and let auth fail per-request below.
}

/**
 * Verify JWT. Attaches decoded payload to req.user, then re-checks the user
 * against the DB so soft-deleted / deactivated users can't keep using a
 * still-valid token. The DB hit is one indexed lookup per authenticated
 * request — acceptable for a small-business app and worth it to honour
 * deletion immediately.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || '');
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // Liveness check — block tokens belonging to soft-deleted or deactivated
  // users so deletion is immediate rather than waiting up to 7d for the JWT
  // to expire.
  try {
    const result = await pool.query(
      `SELECT id, email, role, first_name
         FROM users
        WHERE id = $1 AND deleted_at IS NULL AND is_active = true`,
      [decoded.id]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Account no longer active. Please log in again.' });
    }
    // Use the DB row as the source of truth — role/email may have changed
    // since the token was issued.
    const u = result.rows[0];
    req.user = { id: u.id, email: u.email, role: u.role, name: u.first_name };
    next();
  } catch (err) {
    console.error('[Auth] Liveness check error:', err.message);
    // If the DB is briefly unavailable, fall back to the token payload so
    // the whole site doesn't lock out — better than 500-ing every request.
    req.user = decoded;
    next();
  }
}

/**
 * Require admin role. Must be used after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
