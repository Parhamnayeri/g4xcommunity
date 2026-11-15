import fs from 'fs';
import path from 'path';
import prisma from '../src/database/db';

async function applyPhase2Migration(): Promise<void> {
  const migrationPath = path.resolve(
    __dirname,
    '../prisma/migrations/20261115210000_phase2_transfers_exchange_withdrawals/migration.sql'
  );
  const rawSql = fs.readFileSync(migrationPath, 'utf8');
  const cleanedSql = rawSql
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanedSql
    .split(';')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  console.log(`Running ${statements.length} Phase 2 migration statements...`);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log('✅ Phase 2 migration (transfers, withdrawals, exchange rates) applied successfully!');
}

applyPhase2Migration()
  .catch((err) => {
    console.error('Phase 2 Migration error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
