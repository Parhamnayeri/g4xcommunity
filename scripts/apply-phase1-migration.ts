import fs from 'fs';
import path from 'path';
import prisma from '../src/database/db';

async function applyPhase1Migration() {
  const migrationPath = path.resolve(
    __dirname,
    '../prisma/migrations/20261115200000_phase1_financial_accounts_and_ledger/migration.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  console.log(`Running ${statements.length} migration statements...`);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log('✅ Phase 1 financial migration applied successfully to persistent SQLite/D1 database!');
}

applyPhase1Migration()
  .catch((err) => {
    console.error('Migration error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
