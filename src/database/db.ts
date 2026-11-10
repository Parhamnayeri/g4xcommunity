/**
 * db.ts — Prisma Client Singleton
 *
 * اتصال به دیتابیس SQLite با استفاده از Prisma Client
 */
import { PrismaClient } from '@prisma/client';

let activePrismaOverride: PrismaClient | null = null;
let defaultPrismaInstance: PrismaClient | null = null;

export function setGlobalPrismaClient(client: PrismaClient | null): void {
  activePrismaOverride = client;
}

export function getGlobalPrismaClient(): PrismaClient {
  if (activePrismaOverride) {
    return activePrismaOverride;
  }
  if (!defaultPrismaInstance) {
    defaultPrismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return defaultPrismaInstance;
}

export function isGlobalPrismaOverridden(): boolean {
  return activePrismaOverride !== null;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getGlobalPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
  set(_target, prop, value, receiver) {
    const client = getGlobalPrismaClient();
    return Reflect.set(client, prop, value, receiver);
  },
});

export default prisma;
export { prisma };

/**
 * تضمین ایجاد ایندکس‌های یکتای جزئی در سطح موتور دیتابیس SQLite
 * جهت ممانعت قطعی از ثبت هش تراکنش یا شماره فیش تکراری در شرایط همروندی (Race Condition)
 */
export async function ensureWithdrawalEvidenceUniqueIndexes(client: PrismaClient = prisma): Promise<void> {
  try {
    const tables: Array<{ name: string }> = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='booster_withdrawal_requests';"
    );
    if (!tables || tables.length === 0) return;

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
    console.error('[DB FATAL] Failed to ensure withdrawal evidence unique indexes:', err.message);
    throw err;
  }
}

/**
 * تضمین ایجاد ایندکس یکتای جزئی بر روی کانال‌های اجرای فعال در SQLite
 * ممانعت قطعی از ثبت بیش از یک کانال اجرای فعال برای هر سفارش در شرایط همروندی (Race Condition)
 */
export async function ensureOrderChannelUniqueIndexes(client: PrismaClient = prisma): Promise<void> {
  try {
    const tables: Array<{ name: string }> = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='order_channels';"
    );
    if (!tables || tables.length === 0) return;

    await client.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_channels_active_execution
      ON order_channels(order_id)
      WHERE channel_type = 'execution' AND status = 'active';
    `);
  } catch (err: any) {
    console.error('[DB FATAL] Failed to ensure order channel unique indexes:', err.message);
    throw err;
  }
}

/**
 * اعتبارسنجی قطعی یکپارچگی کلیدهای خارجی و تضمین حضور ایندکس‌های امنیتی یکتا در SQLite
 */
export async function ensureSecurityAndIntegrityIndexes(client: PrismaClient = prisma): Promise<void> {
  // 1. Foreign key constraint verification
  const fkViolations: any[] = await client.$queryRawUnsafe('PRAGMA foreign_key_check;');
  if (fkViolations && fkViolations.length > 0) {
    const errorMsg = `[DB FATAL] Foreign key constraint violations detected: ${JSON.stringify(fkViolations)}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Partial unique indexes
  await ensureWithdrawalEvidenceUniqueIndexes(client);
  await ensureOrderChannelUniqueIndexes(client);

  // 3. Verify presence of indexes in sqlite_master
  const tables: Array<{ name: string }> = await client.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('booster_withdrawal_requests', 'order_channels');"
  );
  const tableNames = new Set(tables.map((t) => t.name));

  if (tableNames.has('booster_withdrawal_requests')) {
    const indexes: Array<{ name: string }> = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_bwr_settled_tx_hash_unique', 'idx_bwr_settled_bank_receipt_unique');"
    );
    const indexNames = new Set(indexes.map((i) => i.name));
    if (!indexNames.has('idx_bwr_settled_tx_hash_unique') || !indexNames.has('idx_bwr_settled_bank_receipt_unique')) {
      throw new Error('[DB FATAL] Failed to verify booster_withdrawal_requests partial unique indexes in SQLite schema');
    }
  }

  if (tableNames.has('order_channels')) {
    const indexes: Array<{ name: string }> = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_order_channels_active_execution';"
    );
    if (!indexes || indexes.length === 0) {
      throw new Error('[DB FATAL] Failed to verify idx_order_channels_active_execution partial unique index in SQLite schema');
    }
  }
}

