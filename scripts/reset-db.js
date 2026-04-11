/**
 * reset-db.js
 * Truncates all ResumeXray tables in Supabase (PostgreSQL).
 * Run: node scripts/reset-db.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function resetDatabase() {
  const client = await pool.connect();
  try {
    console.log('🗑️  Connecting to Supabase…');

    // TRUNCATE CASCADE handles all FK dependencies in one shot.
    // Sequences are reset so IDs start from 1 again.
    await client.query(`
      TRUNCATE TABLE
        stripe_events,
        download_history,
        cover_letters,
        jobs,
        credit_transactions,
        scan_sessions,
        guest_scans,
        scans,
        resumes,
        "session",
        users
      RESTART IDENTITY CASCADE;
    `);

    console.log('✅  All tables truncated and ID sequences reset.');
    console.log('📋  Tables cleared:');
    console.log('    • users');
    console.log('    • resumes');
    console.log('    • scans');
    console.log('    • scan_sessions');
    console.log('    • guest_scans');
    console.log('    • cover_letters');
    console.log('    • jobs');
    console.log('    • credit_transactions');
    console.log('    • download_history');
    console.log('    • stripe_events');
    console.log('    • session');
  } catch (err) {
    console.error('❌  Reset failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

resetDatabase();
