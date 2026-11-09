/**
 * schema.ts — مقداردهی اولیه Prisma Client و اعتبارسنجی اتصال
 */
import prisma, { ensureSecurityAndIntegrityIndexes } from './db';

export async function initializeDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[DB] ✅ Connected to SQLite database via Prisma.');
    await ensureSecurityAndIntegrityIndexes(prisma);
    console.log('[DB] ✅ Verified foreign key constraints and security integrity indexes.');
  } catch (error) {
    console.error('[DB] ❌ Failed to initialize database:', error);
    throw error;
  }
}

export default initializeDatabase;

if (require.main === module) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
