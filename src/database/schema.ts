/**
 * schema.ts — مقداردهی اولیه Prisma Client و اعتبارسنجی اتصال
 */
import prisma from './db';
import { seed } from './seed';

export async function initializeDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[DB] ✅ Connected to SQLite database via Prisma.');
    // اجرای seed برای اطمینان از وجود داده‌های پایه (roles, games, services)
    await seed();
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
