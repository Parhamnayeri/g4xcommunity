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
