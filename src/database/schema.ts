/**
 * schema.ts — مقداردهی اولیه Prisma Client و اعتبارسنجی اتصال
 */
import prisma from './db';

export async function initializeDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[DB] ✅ Connected to SQLite database via Prisma.');
    // Connectivity only. Fresh installations run the explicit, additive db:seed command.
    // Startup must never rewrite administrator configuration or historical references.
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
