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
 *  1. Canonical Target Resolution: strictly matches Prisma CLI schema-relative path rules.
 *  2. Foreign-Key Integrity Fail-Closed: any PRAGMA foreign_key_check violation strictly halts execution.
 *  3. Incomplete Migration Fail-Closed: any migration in _prisma_migrations with finished_at IS NULL
 *     or rolled_back_at IS NOT NULL immediately halts execution.
 *  4. Checksum Verification: verifies all recorded migrations against on-disk migration.sql files.
 *  5. Execution Channel Gate: if migration 20261109150000 has NOT finished and ANY duplicate
 *     active execution channels exist, it blocks deployment with exit code 1.
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
import { resolveCanonicalDatabaseTarget, findPrismaSchemaDir } from './canonical-db-path';

dotenv.config();

export interface PreMigrationGateResult {
  databasePath: string;
  databaseUrl: string;
  isMigrationAlreadyApplied: boolean;
  duplicateActiveCount: number;
  duplicateOrderIds: number[];
  checksumValid: boolean;
  canProceed: boolean;
  reason: string;
}

export async function runPreMigrationGate(options: {
  databaseUrl?: string;
  prismaClient?: PrismaClient;
  args?: string[];
} = {}): Promise<PreMigrationGateResult> {
  const args = options.args || process.argv.slice(2);
  const target = resolveCanonicalDatabaseTarget({
    databaseUrl: options.databaseUrl,
    args,
  });

  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: {
        db: { url: target.canonicalUrl },
      },
    });

  const targetMigrationName = '20261109150000_order_channel_active_execution_uniqueness';
  const externalOrderMigrationName = '20261112132400_management_external_orders';
  const schemaDir = findPrismaSchemaDir();

  try {
    console.log(`[PreMigrationGate] Evaluating pre-migration safety for: ${target.canonicalPath}`);

    // 1. Strict Foreign Key Integrity Check (BLOCKS ON ANY VIOLATION)
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(
        `[FATAL INTEGRITY VIOLATION] PRAGMA foreign_key_check detected ${fkViolations.length} foreign key violation(s) in SQLite database! All migration operations are strictly BLOCKED until referential integrity is restored.`
      );
    }

    // 2. Inspect _prisma_migrations table
    const migrationsTable: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';"
    );
    const hasMigrationsTable = migrationsTable && migrationsTable.length > 0;

    let isApplied = false;
    let externalOrderMigrationApplied = false;
    let checksumMatches = true;

    if (hasMigrationsTable) {
      // Check for incomplete or failed migrations
      const recordedMigrations: Array<{
        id: string;
        migration_name: string;
        finished_at: string | null;
        rolled_back_at: string | null;
        checksum: string;
      }> = await prisma.$queryRawUnsafe(
        'SELECT id, migration_name, finished_at, rolled_back_at, checksum FROM _prisma_migrations;'
      );

      for (const m of recordedMigrations) {
        if (m.finished_at === null) {
          throw new Error(
            `[FATAL MIGRATION STATE] Migration '${m.migration_name}' (ID: ${m.id}) is in an incomplete / failed state (finished_at is NULL). Prisma migrations are strictly BLOCKED until manual recovery is performed.`
          );
        }
        if (m.rolled_back_at !== null) {
          throw new Error(
            `[FATAL MIGRATION STATE] Migration '${m.migration_name}' (ID: ${m.id}) was rolled back. Prisma migrations are strictly BLOCKED until manual review is performed.`
          );
        }

        // Verify checksum against disk if file exists
        const sqlPath = path.resolve(schemaDir, 'migrations', m.migration_name, 'migration.sql');
        if (fs.existsSync(sqlPath)) {
          const sql = fs.readFileSync(sqlPath, 'utf8');
          const hash = crypto.createHash('sha256').update(sql).digest('hex');
          if (hash !== m.checksum) {
            checksumMatches = false;
            console.error(
              `[PreMigrationGate] ❌ CHECKSUM DRIFT: Migration '${m.migration_name}' database checksum '${m.checksum}' differs from disk '${hash}'.`
            );
          }
        }

        if (m.migration_name === targetMigrationName && m.finished_at !== null) {
          isApplied = true;
        }
        if (m.migration_name === externalOrderMigrationName && m.finished_at !== null) {
          externalOrderMigrationApplied = true;
        }
      }
    }

    // 3. Inspect order_channels for duplicate active execution channels
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

    // Decision Logic
    if (!checksumMatches) {
      return {
        databasePath: target.canonicalPath,
        databaseUrl: target.canonicalUrl,
        isMigrationAlreadyApplied: isApplied,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: false,
        canProceed: false,
        reason: 'Checksum mismatch detected on historical migrations. Prisma migrate deploy would fail with P3008.',
      };
    }

    if (isApplied) {
      console.log(`[PreMigrationGate] ✅ Target migration '${targetMigrationName}' is already applied and verified.`);
      return {
        databasePath: target.canonicalPath,
        databaseUrl: target.canonicalUrl,
        isMigrationAlreadyApplied: true,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: true,
        canProceed: true,
        reason: `Target migration '${targetMigrationName}' is already recorded as finished in _prisma_migrations.`,
      };
    }

    if (duplicateOrderIds.length > 0) {
      const errorMsg = `BLOCKED: Target database has ${duplicateOrderIds.length} order(s) ([${duplicateOrderIds.join(
        ', '
      )}]) with multiple active execution channels. Migration '${targetMigrationName}' is pending and contains an unsafe fallback query (ORDER BY id DESC). You MUST run 'reconcile-execution-channels.ts' before applying migrations!`;
      console.error(`[PreMigrationGate] ❌ ${errorMsg}`);
      return {
        databasePath: target.canonicalPath,
        databaseUrl: target.canonicalUrl,
        isMigrationAlreadyApplied: false,
        duplicateActiveCount: duplicateOrderIds.length,
        duplicateOrderIds,
        checksumValid: true,
        canProceed: false,
        reason: errorMsg,
      };
    }

    if (!externalOrderMigrationApplied) {
      const ordersTable: Array<{ name: string }> = await prisma.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='orders';"
      );
      if (ordersTable.length > 0) {
        const orderColumns: Array<{ name: string }> = await prisma.$queryRawUnsafe(
          "PRAGMA table_info('orders');"
        );
        const hasExternalOrderColumns = new Set(orderColumns.map((column) => column.name)).has('external_order_id') &&
          new Set(orderColumns.map((column) => column.name)).has('platform_account_id');
        if (hasExternalOrderColumns) {
          const emptyExternalIds: Array<{ id: number }> = await prisma.$queryRawUnsafe(`
            SELECT id FROM orders
            WHERE external_order_id IS NOT NULL AND trim(external_order_id) = '';
          `);
          const duplicateExternalIds: Array<{ platform_account_id: number | null; external_order_id: string; row_count: number }> =
            await prisma.$queryRawUnsafe(`
              SELECT platform_account_id, external_order_id, COUNT(*) AS row_count
              FROM orders
              WHERE external_order_id IS NOT NULL AND trim(external_order_id) <> ''
              GROUP BY platform_account_id, external_order_id
              HAVING COUNT(*) > 1;
            `);
          if (emptyExternalIds.length > 0 || duplicateExternalIds.length > 0) {
            return {
              databasePath: target.canonicalPath,
              databaseUrl: target.canonicalUrl,
              isMigrationAlreadyApplied: isApplied,
              duplicateActiveCount: duplicateOrderIds.length,
              duplicateOrderIds,
              checksumValid: true,
              canProceed: false,
              reason: `BLOCKED: external order IDs require manual review before ${externalOrderMigrationName}; empty rows=${emptyExternalIds.map((r) => r.id).join(',') || 'none'}, duplicate groups=${duplicateExternalIds.length}. No order records were changed.`,
            };
          }
        }
      }
    }

    console.log(`[PreMigrationGate] ✅ Pre-migration safety check passed: zero duplicate active channels.`);
    return {
      databasePath: target.canonicalPath,
      databaseUrl: target.canonicalUrl,
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
      console.log('\n[PreMigrationGate] 🟢 GATE PASSED: Safe to proceed with migration deployment.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[PreMigrationGate] ❌ Fatal error:', err.message);
      process.exit(1);
    });
}
