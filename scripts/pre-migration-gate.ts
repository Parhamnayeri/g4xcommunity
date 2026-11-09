/**
 * scripts/pre-migration-gate.ts
 *
 * Pre-Migration Safety Gate for G4X Community.
 *
 * MISSION:
 *  Strictly prevent execution of Prisma migrations if unsafe or ambiguous duplicate
 *  active execution channels exist in the database, protecting against the destructive
 *  fallback query in migration 20261109150000_order_channel_active_execution_uniqueness.
 *
 * Safety Invariants:
 *  1. Refuses to guess SQLite database path. Explicit DATABASE_URL or --database <path> is mandatory.
 *  2. Inspects _prisma_migrations to determine whether 20261109150000 has already run.
 *  3. If migration has NOT run: inspects order_channels. If any duplicate active execution channels
 *     exist, it FAILS CLOSED with exit code 1 and blocks deployment.
 *  4. If migration HAS already run: verifies checksum against disk migration.sql to prevent P3008 drift.
 *  5. Verifies SQLite foreign key integrity (PRAGMA foreign_key_check).
 *
 * Usage:
 *   npx ts-node scripts/pre-migration-gate.ts --database /path/to/sqlite.db
 *   npm run migrate:safe
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

export interface PreMigrationGateResult {
  databasePath: string;
  isMigrationAlreadyApplied: boolean;
  duplicateActiveCount: number;
  duplicateOrderIds: number[];
  checksumValid: boolean;
  canProceed: boolean;
  reason: string;
}

export function resolveDatabaseTarget(options?: { databaseUrl?: string; args?: string[] }): {
  databaseUrl: string;
  sqliteFilePath: string;
} {
  const args = options?.args || process.argv.slice(2);
  let rawUrl: string | undefined = options?.databaseUrl;

  const dbIndex = args.indexOf('--database');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    const rawPath = args[dbIndex + 1];
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    rawUrl = `file:${resolvedPath}`;
  }

  if (!rawUrl && process.env.DATABASE_URL) {
    rawUrl = process.env.DATABASE_URL.trim();
  }

  if (!rawUrl) {
    throw new Error(
      '[CRITICAL SAFETY ERROR] Missing database configuration. Explicit DATABASE_URL environment variable or --database <path> argument is REQUIRED. Guessed defaults (e.g. dev.db) are strictly forbidden.'
    );
  }

  let sqliteFilePath = rawUrl;
  if (rawUrl.startsWith('file:')) {
    sqliteFilePath = rawUrl.replace(/^file:/, '');
  }
  sqliteFilePath = path.resolve(process.cwd(), sqliteFilePath);

  if (!fs.existsSync(sqliteFilePath)) {
    throw new Error(
      `[CRITICAL SAFETY ERROR] Target SQLite database file does not exist at '${sqliteFilePath}'. Refusing to operate on non-existent database.`
    );
  }

  return { databaseUrl: rawUrl, sqliteFilePath };
}

export async function runPreMigrationGate(options: {
  databaseUrl?: string;
  prismaClient?: PrismaClient;
} = {}): Promise<PreMigrationGateResult> {
  const { databaseUrl, sqliteFilePath } = resolveDatabaseTarget({
    databaseUrl: options.databaseUrl,
  });

  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });

  const targetMigrationName = '20261109150000_order_channel_active_execution_uniqueness';

  try {
    console.log(`[PreMigrationGate] Evaluating pre-migration safety for: ${sqliteFilePath}`);

    // 1. Foreign key check
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    if (fkViolations && fkViolations.length > 0) {
      console.warn(`[PreMigrationGate] WARNING: Detected ${fkViolations.length} foreign key violation(s) in SQLite database!`);
    }

    // 2. Check if _prisma_migrations exists
    const migrationsTable: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';"
    );
    const hasMigrationsTable = migrationsTable && migrationsTable.length > 0;

    let isApplied = false;
    let checksumMatches = true;

    if (hasMigrationsTable) {
      const recorded: Array<{
        migration_name: string;
        finished_at: string | null;
        checksum: string;
      }> = await prisma.$queryRawUnsafe(
        'SELECT migration_name, finished_at, checksum FROM _prisma_migrations WHERE migration_name = ?;',
        targetMigrationName
      );

      if (recorded.length > 0 && recorded[0].finished_at !== null) {
        isApplied = true;
        const migrationSqlPath = path.resolve(
          process.cwd(),
          'prisma',
          'migrations',
          targetMigrationName,
          'migration.sql'
        );
        if (fs.existsSync(migrationSqlPath)) {
          const sqlContent = fs.readFileSync(migrationSqlPath, 'utf8');
          const currentHash = crypto.createHash('sha256').update(sqlContent).digest('hex');
          if (currentHash !== recorded[0].checksum) {
            checksumMatches = false;
            console.error(
              `[PreMigrationGate] ❌ CHECKSUM DRIFT: Database recorded checksum '${recorded[0].checksum}' differs from disk '${currentHash}'.`
            );
          }
        }
      }
    }

    // 3. Check for duplicate active execution channels if table order_channels exists
    const orderChannelsTable: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='order_channels';"
    );
    const hasOrderChannels = orderChannelsTable && orderChannelsTable.length > 0;

    let duplicateOrderIds: number[] = [];
    if (hasOrderChannels) {
      const duplicateRows: Array<{ order_id: number }> = await prisma.$queryRawUnsafe(`
        SELECT order_id
        FROM order_channels
        WHERE channel_type = 'execution' AND status = 'active'
        GROUP BY order_id
        HAVING COUNT(*) > 1;
      `);
      duplicateOrderIds = duplicateRows.map((r) => r.order_id);
    }

    // Evaluate gate decision
    if (!checksumMatches) {
      return {
        databasePath: sqliteFilePath,
        isMigrationAlreadyApplied: isApplied,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: false,
        canProceed: false,
        reason: `Checksum mismatch for applied migration '${targetMigrationName}'. Prisma migrate deploy will fail with P3008.`,
      };
    }

    if (isApplied) {
      console.log(`[PreMigrationGate] ✅ Migration '${targetMigrationName}' is already applied and verified.`);
      return {
        databasePath: sqliteFilePath,
        isMigrationAlreadyApplied: true,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: true,
        canProceed: true,
        reason: `Migration '${targetMigrationName}' is already recorded as finished in _prisma_migrations.`,
      };
    }

    // If migration is pending and duplicate active execution channels exist -> BLOCK!
    if (duplicateOrderIds.length > 0) {
      const errorMsg = `BLOCKED: Target database has ${duplicateOrderIds.length} order(s) ([${duplicateOrderIds.join(
        ', '
      )}]) with multiple active execution channels. Migration '${targetMigrationName}' is pending and contains an unsafe fallback query (ORDER BY id DESC). You MUST run 'reconcile-execution-channels.ts' before applying migrations!`;
      console.error(`[PreMigrationGate] ❌ ${errorMsg}`);
      return {
        databasePath: sqliteFilePath,
        isMigrationAlreadyApplied: false,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: true,
        canProceed: false,
        reason: errorMsg,
      };
    }

    console.log(`[PreMigrationGate] ✅ Pre-migration safety check passed: zero duplicate active channels.`);
    return {
      databasePath: sqliteFilePath,
      isMigrationAlreadyApplied: false,
      duplicateActiveCount: 0,
      duplicateOrderIds: [],
      checksumValid: true,
      canProceed: true,
      reason: 'Zero duplicate active execution channels detected. Safe to apply Prisma migrations.',
    };
  } finally {
    if (!options.prismaClient) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  runPreMigrationGate()
    .then((result) => {
      console.log('\n--- Pre-Migration Gate Summary ---');
      console.log(JSON.stringify(result, null, 2));
      if (!result.canProceed) {
        console.error(`\n[PreMigrationGate] ❌ GATE BLOCKED: ${result.reason}`);
        process.exit(1);
      }
      console.log('\n[PreMigrationGate] 🟢 GATE PASSED: Proceed with prisma migrate deploy.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[PreMigrationGate] ❌ Fatal error:', err.message);
      process.exit(1);
    });
}
