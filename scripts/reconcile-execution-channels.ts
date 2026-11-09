/**
 * scripts/reconcile-execution-channels.ts
 *
 * Deterministic, Transactional Reconciliation Tool for Duplicate Active Execution Channels.
 *
 * Safety Invariants:
 *  1. Refuses to guess SQLite database path. Explicit DATABASE_URL or --database <path> is mandatory.
 *  2. Default mode is read-only dry-run.
 *  3. Apply mode requires explicit confirmation (--confirm-apply-irreversible) AND backup verification (--verified-backup-taken).
 *  4. Transactional: updates and AuditLog writes happen inside prisma.$transaction.
 *  5. Concurrency-safe: re-verifies channel state inside the transaction; aborts if concurrent mutations occur.
 *  6. Non-destructive: never physically deletes records (no SQL DELETE).
 *  7. Pointer-authoritative: prioritizes orders.execution_channel_id.
 *  8. Fail-safe: missing, null, or contradictory pointers are treated as hard blocking conflicts. Never blindly archives terminal orders without pointer verification.
 *
 * Usage:
 *   npx ts-node scripts/reconcile-execution-channels.ts --database ./data.db [--dry-run]
 *   npx ts-node scripts/reconcile-execution-channels.ts --database ./data.db --apply --confirm-apply-irreversible --verified-backup-taken
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

export interface ReconciliationOptions {
  databaseUrl?: string;
  apply?: boolean;
  confirmApply?: boolean;
  verifiedBackupTaken?: boolean;
  prismaClient?: PrismaClient;
}

export interface UnresolvedConflict {
  orderId: number;
  orderStatus: string;
  executionChannelId: string | null;
  channelIds: string[];
  reason: string;
}

export interface ReconciliationReport {
  databasePath: string;
  mode: 'dry-run' | 'apply';
  scannedOrders: number;
  ordersWithDuplicates: number;
  channelsArchived: number;
  channelsRetained: number;
  unresolvedConflicts: UnresolvedConflict[];
  success: boolean;
  error?: string;
}

export function resolveDatabaseTarget(options?: { databaseUrl?: string; args?: string[] }): {
  databaseUrl: string;
  sqliteFilePath: string;
} {
  const args = options?.args || process.argv.slice(2);
  let rawUrl: string | undefined = options?.databaseUrl;

  // 1. Check CLI argument --database <path>
  const dbIndex = args.indexOf('--database');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    const rawPath = args[dbIndex + 1];
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    rawUrl = `file:${resolvedPath}`;
  }

  // 2. Fall back to process.env.DATABASE_URL
  if (!rawUrl && process.env.DATABASE_URL) {
    rawUrl = process.env.DATABASE_URL.trim();
  }

  // 3. Strict guard: NEVER guess default SQLite path
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

export async function reconcileExecutionChannels(options: ReconciliationOptions = {}): Promise<ReconciliationReport> {
  const args = process.argv.slice(2);
  const isApply = options.apply === true || args.includes('--apply');
  const confirmApply =
    options.confirmApply === true ||
    args.includes('--confirm-apply-irreversible') ||
    process.env.CONFIRM_RECONCILIATION === 'yes';
  const verifiedBackup =
    options.verifiedBackupTaken === true ||
    args.includes('--verified-backup-taken') ||
    process.env.VERIFIED_BACKUP_TAKEN === 'yes';

  const mode: 'dry-run' | 'apply' = isApply ? 'apply' : 'dry-run';

  if (isApply) {
    if (!confirmApply) {
      throw new Error(
        '[CRITICAL SAFETY ERROR] Apply mode requested without explicit confirmation. You MUST pass --confirm-apply-irreversible or set CONFIRM_RECONCILIATION=yes to execute state-altering reconciliation.'
      );
    }
    if (!verifiedBackup) {
      throw new Error(
        '[CRITICAL SAFETY ERROR] Backup verification missing. Modifying production or pre-migration SQLite databases requires a verified cold backup. You MUST pass --verified-backup-taken or set VERIFIED_BACKUP_TAKEN=yes.'
      );
    }
  }

  const { databaseUrl, sqliteFilePath } = resolveDatabaseTarget({
    databaseUrl: options.databaseUrl,
    args,
  });

  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });

  const report: ReconciliationReport = {
    databasePath: sqliteFilePath,
    mode,
    scannedOrders: 0,
    ordersWithDuplicates: 0,
    channelsArchived: 0,
    channelsRetained: 0,
    unresolvedConflicts: [],
    success: true,
  };

  try {
    console.log(`[ReconcileExecutionChannels] Operating on: ${sqliteFilePath} (Mode: ${mode.toUpperCase()})`);

    // 1. Verify foreign key integrity first
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    if (fkViolations && fkViolations.length > 0) {
      console.warn(`[ReconcileExecutionChannels] WARNING: Detected ${fkViolations.length} foreign key violation(s) in SQLite database!`);
    }

    // 2. Check if table order_channels exists
    const tables: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='order_channels';"
    );
    if (!tables || tables.length === 0) {
      console.log('[ReconcileExecutionChannels] Table order_channels does not exist in target database. Exiting safely.');
      return report;
    }

    // 3. Find order IDs with duplicate active execution channels
    const duplicateRows: Array<{ order_id: number; count: number }> = await prisma.$queryRawUnsafe(`
      SELECT order_id, COUNT(*) as count
      FROM order_channels
      WHERE channel_type = 'execution' AND status = 'active'
      GROUP BY order_id
      HAVING COUNT(*) > 1;
    `);

    report.scannedOrders = duplicateRows.length;
    report.ordersWithDuplicates = duplicateRows.length;

    if (duplicateRows.length === 0) {
      console.log('[ReconcileExecutionChannels] ✅ Zero duplicate active execution channels detected. System is clean.');
      return report;
    }

    console.log(`[ReconcileExecutionChannels] Found ${duplicateRows.length} order(s) with duplicate active execution channels.`);

    // 4. Process each duplicate group
    for (const dup of duplicateRows) {
      const orderId = dup.order_id;

      // Fetch the order
      const orders: Array<{ id: number; status: string; execution_channel_id: string | null }> = await prisma.$queryRawUnsafe(
        'SELECT id, status, execution_channel_id FROM orders WHERE id = ?;',
        orderId
      );
      const order = orders && orders.length > 0 ? orders[0] : null;

      // Fetch active execution channels for this order
      const activeChannels: Array<{
        id: number;
        discord_channel_id: string;
        channel_type: string;
        status: string;
        created_at: string;
      }> = await prisma.$queryRawUnsafe(
        "SELECT id, discord_channel_id, channel_type, status, created_at FROM order_channels WHERE order_id = ? AND channel_type = 'execution' AND status = 'active' ORDER BY id ASC;",
        orderId
      );

      if (!order) {
        report.unresolvedConflicts.push({
          orderId,
          orderStatus: 'UNKNOWN_ORPHAN_ORDER',
          executionChannelId: null,
          channelIds: activeChannels.map((c) => c.discord_channel_id),
          reason: `Orphan active channels: order #${orderId} does not exist in orders table.`,
        });
        continue;
      }

      const orderExecId = order.execution_channel_id ? order.execution_channel_id.trim() : null;
      const matchingChannels = activeChannels.filter((c) => orderExecId && c.discord_channel_id === orderExecId);

      // Deterministic Match Case: Authoritative pointer matches EXACTLY ONE active channel record
      if (orderExecId && matchingChannels.length === 1) {
        const keeper = matchingChannels[0];
        const obsolete = activeChannels.filter((c) => c.id !== keeper.id);

        console.log(
          `[ReconcileExecutionChannels] Order #${orderId}: Retaining channel record #${keeper.id} (${keeper.discord_channel_id}) matching orders.execution_channel_id. Candidate for archiving: ${obsolete.length} duplicate(s).`
        );

        if (isApply) {
          // Transactional update with concurrency re-verification
          await prisma.$transaction(async (tx) => {
            // Re-verify channel state inside transaction
            const currentActive: Array<{ id: number }> = await tx.$queryRawUnsafe(
              "SELECT id FROM order_channels WHERE order_id = ? AND channel_type = 'execution' AND status = 'active';",
              orderId
            );

            if (currentActive.length !== activeChannels.length) {
              throw new Error(
                `[CONCURRENT MUTATION DETECTED] Order #${orderId} active channel count changed during reconciliation transaction. Aborting.`
              );
            }

            for (const obs of obsolete) {
              await tx.$executeRawUnsafe(
                "UPDATE order_channels SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active';",
                obs.id
              );

              await tx.$executeRawUnsafe(
                `INSERT INTO audit_logs (action, entity_type, entity_id, new_values, reason, is_success, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);`,
                'ORDER_CHANNEL_RECONCILE_ARCHIVE',
                'OrderChannel',
                obs.id.toString(),
                JSON.stringify({
                  orderId,
                  archivedRecordId: obs.id,
                  archivedDiscordChannelId: obs.discord_channel_id,
                  retainedRecordId: keeper.id,
                  retainedDiscordChannelId: keeper.discord_channel_id,
                }),
                `Reconciled duplicate execution channel #${obs.id} in favor of authoritative order pointer #${keeper.id}`,
                1
              );
            }
          });
        }

        report.channelsRetained++;
        report.channelsArchived += obsolete.length;
        continue;
      }

      // Hard Blocker: Pointer is missing, null, empty, points to non-matching channel, or matches multiple
      let failureReason = '';
      if (!orderExecId) {
        failureReason = `Missing pointer: orders.execution_channel_id is NULL for order #${orderId} (status: ${order.status}). Cannot determine authoritative Discord channel without manual review.`;
      } else if (matchingChannels.length === 0) {
        failureReason = `Pointer mismatch: orders.execution_channel_id '${orderExecId}' does not match any active channel records ([${activeChannels.map((c) => c.discord_channel_id).join(', ')}]).`;
      } else {
        failureReason = `Ambiguous multiple matches: orders.execution_channel_id '${orderExecId}' matches multiple channel records ([${matchingChannels.map((c) => c.id).join(', ')}]).`;
      }

      console.warn(`[ReconcileExecutionChannels] ⚠️ FAIL-SAFE BLOCKER: Order #${orderId} - ${failureReason}`);
      report.unresolvedConflicts.push({
        orderId,
        orderStatus: order.status,
        executionChannelId: orderExecId,
        channelIds: activeChannels.map((c) => c.discord_channel_id),
        reason: failureReason,
      });
    }

    if (report.unresolvedConflicts.length > 0) {
      report.success = false;
      report.error = `Detected ${report.unresolvedConflicts.length} unresolved ambiguous conflict(s). Human operator review required.`;
    }

    return report;
  } finally {
    if (!options.prismaClient) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}

// Direct CLI Execution
if (require.main === module) {
  reconcileExecutionChannels()
    .then((report) => {
      console.log('\n--- Final Reconciliation Report ---');
      console.log(JSON.stringify(report, null, 2));
      if (!report.success) {
        console.error('\n[ReconcileExecutionChannels] ❌ Terminated with unresolved conflicts. Aborting.');
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[ReconcileExecutionChannels] ❌ Fatal error:', err.message);
      process.exit(1);
    });
}
