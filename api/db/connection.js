const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[DB] ERROR: DATABASE_URL is not set.');
}

// Strip channel_binding param — not supported by pg v8 (Neon adds it in newer connection strings)
const dbUrl = (process.env.DATABASE_URL || '')
  .replace(/[&?]channel_binding=[^&]*/g, '')
  .replace(/\?&/, '?');

// Single pool instance — works for both local dev and Vercel serverless
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,               // Serverless: keep connection count low
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

module.exports = pool;
