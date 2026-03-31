const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[DB] ERROR: DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon.tech connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Neon.tech
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('[DB] Connection failed:', err.message);
    console.error('[DB] Check your DATABASE_URL in .env');
  } else {
    console.log('[DB] Connected to Neon.tech PostgreSQL');
    release();
  }
});

module.exports = pool;
