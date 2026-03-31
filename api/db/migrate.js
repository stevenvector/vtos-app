/**
 * VTOS Database Migration Runner
 * Run: node db/migrate.js
 *
 * This reads schema.sql and applies it to your Neon.tech database.
 * It is idempotent — safe to run multiple times (uses IF NOT EXISTS).
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./connection');
const bcrypt = require('bcryptjs');

async function migrate() {
  console.log('[Migrate] Running schema migration...');

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  try {
    await pool.query(sql);
    console.log('[Migrate] Schema applied successfully.');
  } catch (err) {
    console.error('[Migrate] Schema error:', err.message);
    process.exit(1);
  }

  // Seed initial admin account if it doesn't exist
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass  = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPass) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(adminPass, 12);
      await pool.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin')`,
        ['VTOS', 'Admin', adminEmail, hash]
      );
      console.log(`[Migrate] Admin account created: ${adminEmail}`);
      console.log('[Migrate] IMPORTANT: Change your admin password after first login!');
    } else {
      console.log('[Migrate] Admin account already exists — skipping seed.');
    }
  }

  console.log('[Migrate] Done.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[Migrate] Fatal error:', err);
  process.exit(1);
});
