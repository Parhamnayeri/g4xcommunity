/**
 * scripts/inspect-database-safety.ts
 *
 * Read-Only Pre-Production Database Safety Inspection Procedure.
 *
 * Safety Invariants:
 *  1. Purely read-only: performs zero writes, zero schema alterations, and zero deletes.
 *  2. Canonical Target Resolution: strictly matches Prisma CLI schema-relative path rules.
 *  3. Reports comprehensive migration status, foreign key health, execution channel duplication,
 *     and pointer discrepancy analysis.
 *  4. Identifies failed, incomplete, or rolled-back migration records.
 *
 * Usage:
 *   npx ts-node scripts/inspect-database-safety.ts --database /path/to/db.sqlite
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { resolveCanonicalDatabaseTarget } from './canonical-db-path';

dotenv.config();

export interface InspectionReport {
  databasePath: string;
  databaseUrl: string;
  databaseSizeBytes: number;
  foreignKeyCheckPassed: boolean;
  foreignKeyViolations: any[];
  migrationsTableFound: boolean;
  totalMigrationsApplied: number;
  incompleteMigrationsFound: Array<{ id: string; migration_name: string }>;
  rolledBackMigrationsFound: Array<{ id: string; migration_name: string }>;
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

export async function inspectDatabaseSafety(options: {
  databaseUrl?: string;
  prismaClient?: PrismaClient;
  args?: string[];
} = {}): Promise<InspectionReport> {
  const args = options.args || process.argv.slice(2);
  const target = resolveCanonicalDatabaseTarget({
    databaseUrl: options.databaseUrl,
    args,
  });

  const stats = fs.statSync(target.canonicalPath);
  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: { db: { url: target.canonicalUrl } },
    });

  const report: InspectionReport = {
    databasePath: target.canonicalPath,
    databaseUrl: target.canonicalUrl,
    databaseSizeBytes: stats.size,
    foreignKeyCheckPassed: true,
    foreignKeyViolations: [],
    migrationsTableFound: false,
    totalMigrationsApplied: 0,
    incompleteMigrationsFound: [],
    rolledBackMigrationsFound: [],
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
    // 1. Strict Foreign Key Integrity Check
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
      const migrations: Array<{
        id: string;
        migration_name: string;
        finished_at: string | null;
        rolled_back_at: string | null;
      }> = await prisma.$queryRawUnsafe(
        'SELECT id, migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at ASC;'
      );

      const completed = migrations.filter((m) => m.finished_at !== null && m.rolled_back_at === null);
      report.totalMigrationsApplied = completed.length;
      if (completed.length > 0) {
        report.lastMigrationName = completed[completed.length - 1].migration_name;
      }

      report.incompleteMigrationsFound = migrations
        .filter((m) => m.finished_at === null)
        .map((m) => ({ id: m.id, migration_name: m.migration_name }));

      report.rolledBackMigrationsFound = migrations
        .filter((m) => m.rolled_back_at !== null)
        .map((m) => ({ id: m.id, migration_name: m.migration_name }));

      report.targetMigrationApplied = completed.some(
        (m) => m.migration_name === '20261109150000_order_channel_active_execution_uniqueness'
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
    if (!report.foreignKeyCheckPassed || report.incompleteMigrationsFound.length > 0 || report.rolledBackMigrationsFound.length > 0) {
      report.isReadyForSafeMigration = false;
      report.verdict = 'DATABASE_ERROR';
    } else if (report.duplicateActiveOrderCount === 0) {
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
      if (report.verdict === 'DATABASE_ERROR' || report.verdict === 'BLOCKED_BY_AMBIGUOUS_CONFLICTS') {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[InspectDatabaseSafety] ❌ Inspection failed:', err.message);
      process.exit(1);
    });
}
