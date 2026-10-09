const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const rawUrl = process.env.DATABASE_URL || '';
const connectionString = rawUrl.replace(/^DATABASE_URL=/, '').trim();

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  query_timeout: 15000,
  ssl: connectionString.includes('supabase.com') ? { rejectUnauthorized: false } : undefined,
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err.code || 'unavailable');
});

module.exports = pool;
