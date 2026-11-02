/**
 * db.ts — Prisma Client Singleton
 *
 * اتصال به دیتابیس SQLite با استفاده از Prisma Client
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export default prisma;
export { prisma };

/**
 * تضمین ایجاد ایندکس‌های یکتای جزئی در سطح موتور دیتابیس SQLite
 * جهت ممانعت قطعی از ثبت هش تراکنش یا شماره فیش تکراری در شرایط همروندی (Race Condition)
 */
export async function ensureWithdrawalEvidenceUniqueIndexes(client: PrismaClient = prisma): Promise<void> {
  try {
    await client.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bwr_settled_tx_hash_unique
      ON booster_withdrawal_requests(external_tx_hash)
      WHERE external_tx_hash IS NOT NULL AND status IN ('PAID', 'PROCESSING');
    `);
    await client.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bwr_settled_bank_receipt_unique
      ON booster_withdrawal_requests(bank_receipt_ref)
      WHERE bank_receipt_ref IS NOT NULL AND status IN ('PAID', 'PROCESSING');
    `);
  } catch (err: any) {
    if (!err.message?.includes('no such table')) {
      console.warn('[DB] Warning creating partial unique indexes on withdrawal requests:', err.message);
    }
  }
}

// مقداردهی اولیه ایندکس‌های امنیتی تسویه در پس‌زمینه
ensureWithdrawalEvidenceUniqueIndexes().catch(() => {});

