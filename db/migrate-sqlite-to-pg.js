#!/usr/bin/env node
/**
 * SQLite → PostgreSQL Migration Script — Phase 5 §3
 *
 * One-time data migration from SQLite to Supabase PostgreSQL.
 * Reads all tables from the local SQLite database and inserts them
 * into the PostgreSQL database referenced by DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node db/migrate-sqlite-to-pg.js
 *
 * Prerequisites:
 *   1. Run pg-schema.sql against Supabase first (or let pg-database.js auto-init)
 *   2. Backup SQLite: cp db/resumexray.db db/resumexray.db.bak
 *
 * Safety:
 *   - Uses INSERT ... ON CONFLICT DO NOTHING to avoid duplicates
 *   - Runs in a single transaction per table
 *   - Logs progress for each table
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const DB_PATH = path.join(__dirname, 'resumexray.db');

async function migrate() {
  console.log('═══ SQLite → PostgreSQL Migration ═══\n');

  // Validate env
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required.');
    console.error('Example: DATABASE_URL=postgresql://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    process.exit(1);
  }

  // Open SQLite
  const sqlite = new Database(DB_PATH, { readonly: true });
  console.log(`SQLite: ${DB_PATH}`);

  // Connect to PostgreSQL
  const pg = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  try {
    await pg.query('SELECT 1');
    console.log(`PostgreSQL: connected\n`);
  } catch (err) {
    console.error('ERROR: Cannot connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  // ── Migration order (respects foreign keys) ────────────────────────────────
  const tables = [
    { name: 'users', pk: 'id' },
    { name: 'credit_transactions', pk: 'id' },
    { name: 'resumes', pk: 'id' },
    { name: 'scans', pk: 'id' },
    { name: 'jobs', pk: 'id' },
    { name: 'cover_letters', pk: 'id' },
    { name: 'guest_scans', pk: 'id' },
    { name: 'scan_sessions', pk: 'id' },
  ];

  for (const { name, pk } of tables) {
    try {
      const rows = sqlite.prepare(`SELECT * FROM ${name}`).all();
      if (rows.length === 0) {
        console.log(`  ${name}: 0 rows (skipped)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const insertSql = `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pk}) DO NOTHING`;

      const client = await pg.connect();
      try {
        await client.query('BEGIN');
        let inserted = 0;
        for (const row of rows) {
          const values = columns.map(col => row[col]);
          const result = await client.query(insertSql, values);
          inserted += result.rowCount;
        }
        await client.query('COMMIT');
        console.log(`  ${name}: ${inserted}/${rows.length} rows migrated`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ${name}: FAILED — ${err.message}`);
      } finally {
        client.release();
      }
    } catch (err) {
      // Table may not exist in SQLite (e.g., download_history added later)
      console.log(`  ${name}: table not found in SQLite (skipped)`);
    }
  }

  // Reset sequences for BIGSERIAL columns
  console.log('\nResetting PostgreSQL sequences...');
  const serialTables = ['users', 'credit_transactions', 'resumes', 'scans', 'jobs', 'cover_letters', 'guest_scans'];
  for (const table of serialTables) {
    try {
      await pg.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1)) FROM ${table}`);
      console.log(`  ${table}_id_seq: reset`);
    } catch (err) {
      console.log(`  ${table}_id_seq: ${err.message}`);
    }
  }

  sqlite.close();
  await pg.end();
  console.log('\n═══ Migration Complete ═══');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
