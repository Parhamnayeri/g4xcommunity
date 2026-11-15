import prisma from '../src/database/db';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('Applying Phase 3 migration...');
  const migrationPath = path.join(__dirname, '../prisma/migrations/20261115220000_phase3_financial_reports_advertiser_boosts/migration.sql');
  const rawSql = fs.readFileSync(migrationPath, 'utf8');
  
  const cleanedSql = rawSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanedSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
      console.log('Executed statement successfully.');
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log('Table or index already exists, skipping.');
      } else {
        console.error('Failed executing statement:', statement, err);
        throw err;
      }
    }
  }

  console.log('Phase 3 migration applied successfully!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
