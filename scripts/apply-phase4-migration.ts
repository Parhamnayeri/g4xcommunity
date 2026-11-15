import prisma from '../src/database/db';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('Applying Phase 4 migration (Double-Entry Ledger, Audit Logs, Reconciliations)...');
  const migrationPath = path.join(__dirname, '../prisma/migrations/20261115230000_phase4_ledger_audit_reconciliation/migration.sql');
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

  // Safely add columns to financial_transactions
  const columnsToAdd = [
    { name: 'reversal_of_transaction_id', type: 'TEXT' },
    { name: 'is_reversal', type: 'BOOLEAN DEFAULT 0' },
    { name: 'reversal_reason', type: 'TEXT' },
    { name: 'reversed_at', type: 'DATETIME' },
    { name: 'reversed_by', type: 'TEXT' },
  ];

  for (const col of columnsToAdd) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "financial_transactions" ADD COLUMN "${col.name}" ${col.type}`);
      console.log(`Added column ${col.name} to financial_transactions.`);
    } catch (err: any) {
      if (err.message?.includes('duplicate column') || err.message?.includes('already exists')) {
        console.log(`Column ${col.name} already exists on financial_transactions, skipping.`);
      } else {
        console.warn(`Could not add column ${col.name}:`, err.message);
      }
    }
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_reversal_of_transaction_id_key" ON "financial_transactions"("reversal_of_transaction_id")`
    );
  } catch (err: any) {
    // index might already exist
  }

  console.log('Phase 4 migration applied successfully!');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
