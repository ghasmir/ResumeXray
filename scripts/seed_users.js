const { getDb, closeDb } = require('../db/database');
const bcrypt = require('bcrypt');

async function seed() {
  const db = getDb();
  console.log('🌱 Seeding database...');

  const password = await bcrypt.hash('Password123!', 10);

  const users = [
    { email: 'starter@resumexray.pro', name: 'Starter User', tier: 'starter', credits: 5 },
    { email: 'pro@resumexray.pro', name: 'Pro User', tier: 'pro', credits: 15 },
    { email: 'hustler@resumexray.pro', name: 'Hustler User', tier: 'hustler', credits: 50 },
  ];

  for (const u of users) {
    try {
      const res = db.prepare('INSERT INTO users (email, name, password_hash, tier, credit_balance, is_verified) VALUES (?, ?, ?, ?, ?, 1)').run(
        u.email, u.name, password, u.tier, u.credits
      );
      console.log('✅ Created user:', u.email, 'ID:', res.lastInsertRowid);
      
      // Add signup bonus transaction
      db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
        res.lastInsertRowid, u.credits, 'signup_bonus', 'Initial tier credits'
      );
    } catch (err) {
      console.error('❌ Failed to create user:', u.email, err.message);
    }
  }

  console.log('✅ Seeding complete.');
  closeDb();
}

seed();
