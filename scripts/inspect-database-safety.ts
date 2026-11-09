/**
 * scripts/inspect-database-safety.ts
 *
 * Read-Only Pre-Production Database Safety Inspection Procedure.
 *
 * Safety Invariants:
 *  1. Purely read-only: performs zero writes, zero schema alterations, and zero deletes.
 *  2. Refuses to guess SQLite database path. Explicit DATABASE_URL or --database <path> is mandatory.
 *  3. Reports comprehensive migration status, foreign key health, execution channel duplication,
 *     and pointer discrepancy analysis.
 *
 * Usage:
 *   npx ts-node scripts/inspect-database-safety.ts --database /path/to/db.sqlite
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

export interface InspectionReport {
  databasePath: string;
  databaseSizeBytes: number;
  foreignKeyCheckPassed: boolean;
  foreignKeyViolations: any[];
  migrationsTableFound: boolean;
  totalMigrationsApplied: number;
  lastMigrationName: string | null;
  targetMigrationApplied: boolean;
  orderChannelsTableFound: boolean;
  ordersTableFound: boolean;
  totalOrderChannels: number;
  activeExecutionChannels: number;
  duplicateActiveOrderCount: number;
  duplicates: Array<{
    orderId: number;
    orderStatus: string;
    orderExecutionPointer: string | null;
    activeChannels: Array<{
      id: number;
      discordChannelId: string;
      createdAt: string;
      matchesPointer: boolean;
    }>;
    unresolvedReason?: string;
  }>;
  auditLogsForDuplicates: Array<{
    entityId: string;
    action: string;
    createdAt: string;
  }>;
  isReadyForSafeMigration: boolean;
  verdict: 'CLEAN' | 'RECONCILIATION_REQUIRED' | 'BLOCKED_BY_AMBIGUOUS_CONFLICTS' | 'DATABASE_ERROR';
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

export async function inspectDatabaseSafety(options: {
  databaseUrl?: string;
  prismaClient?: PrismaClient;
} = {}): Promise<InspectionReport> {
  const { databaseUrl, sqliteFilePath } = resolveDatabaseTarget({
    databaseUrl: options.databaseUrl,
  });

  const stats = fs.statSync(sqliteFilePath);
  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

  const report: InspectionReport = {
    databasePath: sqliteFilePath,
    databaseSizeBytes: stats.size,
    foreignKeyCheckPassed: true,
    foreignKeyViolations: [],
    migrationsTableFound: false,
    totalMigrationsApplied: 0,
    lastMigrationName: null,
    targetMigrationApplied: false,
    orderChannelsTableFound: false,
    ordersTableFound: false,
    totalOrderChannels: 0,
    activeExecutionChannels: 0,
    duplicateActiveOrderCount: 0,
    duplicates: [],
    auditLogsForDuplicates: [],
    isReadyForSafeMigration: false,
    verdict: 'CLEAN',
  };

  try {
    // 1. Foreign Key Integrity Check
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    if (fkViolations && fkViolations.length > 0) {
      report.foreignKeyCheckPassed = false;
      report.foreignKeyViolations = fkViolations;
    }

    // 2. Migration History Inspection
    const tables: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table';"
    );
    const tableNames = new Set(tables.map((t) => t.name));

    report.migrationsTableFound = tableNames.has('_prisma_migrations');
    report.orderChannelsTableFound = tableNames.has('order_channels');
    report.ordersTableFound = tableNames.has('orders');

    if (report.migrationsTableFound) {
      const migrations: Array<{ migration_name: string; finished_at: string | null }> = await prisma.$queryRawUnsafe(
        'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC;'
      );
      report.totalMigrationsApplied = migrations.filter((m) => m.finished_at !== null).length;
      if (migrations.length > 0) {
        report.lastMigrationName = migrations[migrations.length - 1].migration_name;
      }
      report.targetMigrationApplied = migrations.some(
        (m) => m.migration_name === '20261109150000_order_channel_active_execution_uniqueness' && m.finished_at !== null
      );
    }

    // 3. Channel Duplication Inspection
    if (report.orderChannelsTableFound) {
      const channelCounts: Array<{ total: number; active_exec: number }> = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN channel_type = 'execution' AND status = 'active' THEN 1 ELSE 0 END) as active_exec
        FROM order_channels;
      `);
      if (channelCounts.length > 0) {
        report.totalOrderChannels = channelCounts[0].total || 0;
        report.activeExecutionChannels = channelCounts[0].active_exec || 0;
      }

      const duplicateOrders: Array<{ order_id: number; count: number }> = await prisma.$queryRawUnsafe(`
        SELECT order_id, COUNT(*) as count
        FROM order_channels
        WHERE channel_type = 'execution' AND status = 'active'
        GROUP BY order_id
        HAVING COUNT(*) > 1;
      `);

      report.duplicateActiveOrderCount = duplicateOrders.length;

      for (const dup of duplicateOrders) {
        const orderId = dup.order_id;
        let orderStatus = 'UNKNOWN';
        let orderExecPointer: string | null = null;

        if (report.ordersTableFound) {
          const orders: Array<{ status: string; execution_channel_id: string | null }> = await prisma.$queryRawUnsafe(
            'SELECT status, execution_channel_id FROM orders WHERE id = ?;',
            orderId
          );
          if (orders.length > 0) {
            orderStatus = orders[0].status;
            orderExecPointer = orders[0].execution_channel_id;
          }
        }

        const activeChannels: Array<{
          id: number;
          discord_channel_id: string;
          created_at: string;
        }> = await prisma.$queryRawUnsafe(
          "SELECT id, discord_channel_id, created_at FROM order_channels WHERE order_id = ? AND channel_type = 'execution' AND status = 'active' ORDER BY id ASC;",
          orderId
        );

        let unresolvedReason: string | undefined;
        const matching = activeChannels.filter((c) => orderExecPointer && c.discord_channel_id === orderExecPointer.trim());

        if (!orderExecPointer) {
          unresolvedReason = 'Pointer is NULL in orders table.';
        } else if (matching.length === 0) {
          unresolvedReason = `Pointer '${orderExecPointer}' does not match any active channel record.`;
        } else if (matching.length > 1) {
          unresolvedReason = `Pointer '${orderExecPointer}' matches multiple active channel records.`;
        }

        report.duplicates.push({
          orderId,
          orderStatus,
          orderExecutionPointer: orderExecPointer,
          activeChannels: activeChannels.map((c) => ({
            id: c.id,
            discordChannelId: c.discord_channel_id,
            createdAt: c.created_at,
            matchesPointer: orderExecPointer ? c.discord_channel_id === orderExecPointer.trim() : false,
          })),
          unresolvedReason,
        });

        // Collect audit logs
        if (tableNames.has('audit_logs')) {
          const channelIds = activeChannels.map((c) => c.id.toString());
          if (channelIds.length > 0) {
            const logs: Array<{ entity_id: string; action: string; created_at: string }> = await prisma.$queryRawUnsafe(
              `SELECT entity_id, action, created_at FROM audit_logs WHERE entity_type = 'OrderChannel' AND entity_id IN (${channelIds.map(() => '?').join(', ')});`,
              ...channelIds
            );
            report.auditLogsForDuplicates.push(
              ...logs.map((l) => ({ entityId: l.entity_id, action: l.action, createdAt: l.created_at }))
            );
          }
        }
      }
    }

    // Determine overall verdict
    if (report.duplicateActiveOrderCount === 0) {
      report.isReadyForSafeMigration = true;
      report.verdict = 'CLEAN';
    } else {
      const hasUnresolved = report.duplicates.some((d) => Boolean(d.unresolvedReason));
      if (hasUnresolved) {
        report.isReadyForSafeMigration = false;
        report.verdict = 'BLOCKED_BY_AMBIGUOUS_CONFLICTS';
      } else {
        report.isReadyForSafeMigration = false;
        report.verdict = 'RECONCILIATION_REQUIRED';
      }
    }

    return report;
  } finally {
    if (!options.prismaClient) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  inspectDatabaseSafety()
    .then((report) => {
      console.log('\n--- Database Safety Inspection Report ---');
      console.log(JSON.stringify(report, null, 2));
      console.log(`\nVerdict: ${report.verdict} (Ready for Migration: ${report.isReadyForSafeMigration})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[InspectDatabaseSafety] ❌ Inspection failed:', err.message);
      process.exit(1);
    });
}
