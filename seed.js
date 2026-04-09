#!/usr/bin/env node
/**
 * seed.js — Database Reset & Test Account Seeder
 * 
 * Wipes ALL data and creates 3 test accounts:
 *   starter@resumexray.com  (Starter, 5 credits)
 *   pro@resumexray.com      (Pro, 15 credits)
 *   hustler@resumexray.com  (Hustler, 50 credits)
 * 
 * Usage: node seed.js
 */

const bcrypt = require('bcrypt');
const { getDb, closeDb } = require('./db/database');

const ACCOUNTS = [
  { email: 'starter@resumexray.com', name: 'Starter User', tier: 'starter', credits: 5 },
  { email: 'pro@resumexray.com', name: 'Pro User', tier: 'pro', credits: 15 },
  { email: 'hustler@resumexray.com', name: 'Hustler User', tier: 'hustler', credits: 50 },
];

const DEFAULT_PASSWORD = 'Password123!';

async function seed() {
  console.log('\n🧹 ResumeXray Database Seeder');
  console.log('─'.repeat(50));

  const db = getDb();

  // ── Step 1: Wipe all data tables ─────────────────────────────
  console.log('\n🗑️  Wiping all data...');
  const tables = [
    'credit_transactions', 'cover_letters', 'jobs',
    'scans', 'resumes', 'guest_scans', 'users'
  ];

  for (const table of tables) {
    try {
      db.exec(`DELETE FROM ${table}`);
      console.log(`   ✓ Cleared ${table}`);
    } catch (e) {
      console.log(`   ⚠ Skipped ${table}: ${e.message}`);
    }
  }

  // Reset autoincrement counters
  try {
    db.exec("DELETE FROM sqlite_sequence");
    console.log('   ✓ Reset auto-increment counters');
  } catch {}

  // ── Step 2: Seed test accounts ───────────────────────────────
  console.log('\n👤 Creating test accounts...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  for (const acct of ACCOUNTS) {
    try {
      const result = db.prepare(
        `INSERT INTO users (email, name, password_hash, tier, credit_balance, is_verified)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(acct.email, acct.name, passwordHash, acct.tier, acct.credits);

      const userId = result.lastInsertRowid;

      // Record signup bonus transaction
      db.prepare(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES (?, ?, 'signup_bonus', ?)`
      ).run(userId, acct.credits, `${acct.tier} tier — ${acct.credits} credits`);

      console.log(`   ✓ ${acct.email} → ${acct.tier} (${acct.credits} credits) [id: ${userId}]`);
    } catch (e) {
      console.error(`   ✗ Failed to create ${acct.email}: ${e.message}`);
    }
  }

  // ── Step 3: Verify ───────────────────────────────────────────
  console.log('\n📊 Verification:');
  const users = db.prepare('SELECT id, email, tier, credit_balance FROM users').all();
  console.table(users);

  const txns = db.prepare('SELECT user_id, amount, type, description FROM credit_transactions').all();
  console.table(txns);

  console.log(`\n✅ Seed complete! ${users.length} accounts created.`);
  console.log(`   Password for all accounts: ${DEFAULT_PASSWORD}\n`);

  closeDb();
}

seed().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
