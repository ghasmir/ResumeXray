#!/usr/bin/env node
/**
 * Migration Script: Encrypt existing plaintext emails and backfill email_hash
 *
 * This script:
 *   1. For each user, computes email_hash = SHA-256(email)
 *   2. Encrypts the email with AES-256-GCM (if PII_ENCRYPTION_KEY is set)
 *   3. Updates the row: email = encrypted_email, email_hash = hash
 *   4. For users whose email is already encrypted, just backfills the hash
 *
 * Usage:
 *   DRY_RUN=true DB_ENGINE=pg DATABASE_URL=... PII_ENCRYPTION_KEY=... node db/migrate-pii-encryption.js
 *   DB_ENGINE=sqlite PII_ENCRYPTION_KEY=... node db/migrate-pii-encryption.js
 *
 * Set DRY_RUN=true to preview changes without writing to the database.
 */

require('dotenv').config();

const DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();

async function main() {
  const db = require(DB_ENGINE === 'pg' ? './pg-database' : './database');

  // Wait for PG connection if needed
  if (DB_ENGINE === 'pg') {
    await new Promise(r => setTimeout(r, 2000));
  }

  const isDryRun = process.env.DRY_RUN === 'true';
  console.log(`\n🔒 PII Email Encryption Migration`);
  console.log(`   Engine: ${DB_ENGINE}`);
  console.log(`   Mode:   ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE — will modify data'}\n`);

  let users;
  if (DB_ENGINE === 'pg') {
    const { rows } = await db.getDb().query('SELECT id, email, email_hash FROM users');
    users = rows;
  } else {
    users = db.getDb().prepare('SELECT id, email, email_hash FROM users').all();
  }

  console.log(`Found ${users.length} users to process.\n`);

  let encrypted = 0;
  let hashOnly = 0;
  let skipped = 0;

  for (const user of users) {
    const hash = db.emailHash(user.email);
    const isEncrypted = user.email && user.email.includes(':'); // encrypted format is iv:authTag:ciphertext

    if (user.email_hash && user.email_hash === hash) {
      // Already has correct hash, and email may or may not be encrypted
      skipped++;
      continue;
    }

    if (isEncrypted) {
      // Email is already encrypted but missing hash — backfill hash
      console.log(`  [hash-only] User ${user.id}: backfill email_hash`);
      if (!isDryRun) {
        if (DB_ENGINE === 'pg') {
          await db.getDb().query('UPDATE users SET email_hash = $1 WHERE id = $2', [hash, user.id]);
        } else {
          db.getDb().prepare('UPDATE users SET email_hash = ? WHERE id = ?').run(hash, user.id);
        }
      }
      hashOnly++;
    } else {
      // Plaintext email — encrypt and set hash
      console.log(`  [encrypt]   User ${user.id}: encrypt email, set email_hash`);
      if (!isDryRun) {
        const encrypted = db.encryptPii(user.email);
        if (DB_ENGINE === 'pg') {
          await db
            .getDb()
            .query('UPDATE users SET email = $1, email_hash = $2 WHERE id = $3', [
              encrypted,
              hash,
              user.id,
            ]);
        } else {
          db.getDb()
            .prepare('UPDATE users SET email = ?, email_hash = ? WHERE id = ?')
            .run(encrypted, hash, user.id);
        }
      }
      encrypted++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Users processed: ${users.length}`);
  console.log(`   Emails encrypted: ${encrypted}`);
  console.log(`   Hash-only backfills: ${hashOnly}`);
  console.log(`   Skipped (already done): ${skipped}`);
  if (isDryRun) {
    console.log(`\n   ⚠️  DRY RUN — no changes were written to the database.`);
    console.log(`   Run without DRY_RUN=true to apply changes.\n`);
  } else {
    console.log(`\n   ✅ Migration complete.\n`);
  }

  if (DB_ENGINE === 'pg') await db.closeDb();
  else db.closeDb();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
