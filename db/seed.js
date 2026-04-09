#!/usr/bin/env node
/**
 * Database Seed Script — Creates fresh DB with demo data
 * Run: node db/seed.js
 */
const path = require('path');
const bcrypt = require('bcrypt');

// Must require database AFTER ensuring old DB is removed
const { getDb, closeDb } = require('./database');

async function seed() {
  console.log('🌱 Seeding database...');
  const db = getDb();

  // ── Demo Users ────────────────────────────────────────────────
  const demoPassword = await bcrypt.hash('demo1234', 12);
  const proPassword = await bcrypt.hash('pro12345', 12);

  // Free tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('demo@resumexray.com', 'Demo User', demoPassword, 'free', 3, 1);

  // Pro tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('pro@resumexray.com', 'Pro User', proPassword, 'pro', 25, 1);

  // Hustler tier demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (email, name, password_hash, tier, credit_balance, is_verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('hustler@resumexray.com', 'Hustler User', proPassword, 'hustler', 100, 1);

  console.log('  ✓ Demo users created');
  console.log('    demo@resumexray.com / demo1234 (free, 3 credits)');
  console.log('    pro@resumexray.com / pro12345 (pro, 25 credits)');
  console.log('    hustler@resumexray.com / pro12345 (hustler, 100 credits)');

  // ── Credit Transactions ───────────────────────────────────────
  const proUser = db.prepare('SELECT id FROM users WHERE email = ?').get('pro@resumexray.com');
  if (proUser) {
    db.prepare(`
      INSERT INTO credit_transactions (user_id, amount, type, description)
      VALUES (?, ?, ?, ?)
    `).run(proUser.id, 25, 'purchase', 'Pro plan — 25 credits');

    db.prepare(`
      INSERT INTO credit_transactions (user_id, amount, type, description)
      VALUES (?, ?, ?, ?)
    `).run(proUser.id, -1, 'scan', 'ATS scan — Software Engineer at Google');
  }

  console.log('  ✓ Sample credit transactions created');
  console.log('');
  console.log('🎉 Seed complete! Start server with: node server.js');

  closeDb();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
