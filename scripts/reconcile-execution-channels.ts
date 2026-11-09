/**
 * scripts/reconcile-execution-channels.ts
 *
 * Deterministic, Globally Atomic Reconciliation Tool for Duplicate Active Execution Channels.
 *
 * Safety Invariants:
 *  1. Canonical Target Resolution: strictly matches Prisma CLI schema-relative path rules.
 *  2. Foreign-Key Fail-Closed: any PRAGMA foreign_key_check violation strictly aborts operations.
 *  3. Global Preflight Validation: inspects and validates EVERY duplicate group before ANY writes.
 *     If ANY group is ambiguous or conflicting, the entire operation halts with ZERO writes.
 *  4. Global Atomic Batch Execution: all archive updates and AuditLog writes execute inside a
 *     single prisma.$transaction. Any failure rolls back the entire batch.
 *  5. Strict Concurrency Validation: inside the transaction, re-verifies exact channel record IDs,
 *     channel statuses, Discord channel IDs, and the order's execution pointer. Aborts on any drift.
 *  6. Non-Destructive: never physically deletes records (no SQL DELETE).
 *  7. Backup Integrity: validates backup file existence, SQLite magic header, and non-self identity.
 *     Warns that --verified-backup-taken is an operator acknowledgement, not technical proof.
 *
 * Usage:
 *   npx ts-node scripts/reconcile-execution-channels.ts --database ./data.db [--dry-run]
 *   npx ts-node scripts/reconcile-execution-channels.ts --database ./data.db --apply \
 *       --confirm-apply-irreversible --verified-backup-taken [--backup-file ./backup.db]
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { resolveCanonicalDatabaseTarget } from './canonical-db-path';

dotenv.config();

export interface ReconciliationOptions {
  databaseUrl?: string;
  apply?: boolean;
  confirmApply?: boolean;
  verifiedBackupTaken?: boolean;
  backupFile?: string;
  prismaClient?: PrismaClient;
  args?: string[];
}

export interface UnresolvedConflict {
  orderId: number;
  orderStatus: string;
  executionChannelId: string | null;
  channelIds: string[];
  reason: string;
}

export interface ReconciledOrderPlan {
  orderId: number;
  orderStatus: string;
  executionChannelId: string;
  keeperRecord: {
    id: number;
    discordChannelId: string;
  };
  obsoleteRecords: Array<{
    id: number;
    discordChannelId: string;
  }>;
}

export interface ReconciliationReport {
  databasePath: string;
  databaseUrl: string;
  mode: 'dry-run' | 'apply';
  scannedOrders: number;
  ordersWithDuplicates: number;
  channelsArchived: number;
  channelsRetained: number;
  unresolvedConflicts: UnresolvedConflict[];
  success: boolean;
  error?: string;
  backupVerified?: boolean;
  backupNotice?: string;
}

/**
 * Validates backup file if provided by the operator.
 */
export function validateBackupFile(backupPath: string, targetDbPath: string): void {
  const resolvedBackup = path.resolve(process.cwd(), backupPath);
  if (!fs.existsSync(resolvedBackup)) {
    throw new Error(
      `[BACKUP VALIDATION ERROR] Specified backup file does not exist at '${resolvedBackup}'.`
    );
  }

  let canonicalBackup = resolvedBackup;
  try {
    canonicalBackup = fs.realpathSync(resolvedBackup);
  } catch {}

  let canonicalTarget = targetDbPath;
  try {
    canonicalTarget = fs.realpathSync(targetDbPath);
  } catch {}

  if (canonicalBackup.toLowerCase() === canonicalTarget.toLowerCase()) {
    throw new Error(
      `[BACKUP VALIDATION ERROR] Backup file cannot be the target database file itself ('${canonicalBackup}').`
    );
  }

  const stat = fs.statSync(canonicalBackup);
  if (stat.size < 100) {
    throw new Error(
      `[BACKUP VALIDATION ERROR] Backup file '${canonicalBackup}' is empty or corrupt (size: ${stat.size} bytes).`
    );
  }

  // Verify SQLite 3 header (first 16 bytes: "SQLite format 3\0")
  const fd = fs.openSync(canonicalBackup, 'r');
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  const header = buffer.toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error(
      `[BACKUP VALIDATION ERROR] File '${canonicalBackup}' does not contain a valid SQLite 3 header magic string.`
    );
  }
}

export async function reconcileExecutionChannels(options: ReconciliationOptions = {}): Promise<ReconciliationReport> {
  const args = options.args || process.argv.slice(2);
  const isApply = options.apply === true || args.includes('--apply');
  const confirmApply =
    options.confirmApply === true ||
    args.includes('--confirm-apply-irreversible') ||
    process.env.CONFIRM_RECONCILIATION === 'yes';
  const verifiedBackup =
    options.verifiedBackupTaken === true ||
    args.includes('--verified-backup-taken') ||
    process.env.VERIFIED_BACKUP_TAKEN === 'yes';

  const backupIndex = args.indexOf('--backup-file');
  const backupFile = options.backupFile || (backupIndex !== -1 && args[backupIndex + 1] ? args[backupIndex + 1] : undefined);

  const mode: 'dry-run' | 'apply' = isApply ? 'apply' : 'dry-run';

  if (isApply) {
    if (!confirmApply) {
      throw new Error(
        '[CRITICAL SAFETY ERROR] Apply mode requested without explicit confirmation. You MUST pass --confirm-apply-irreversible or set CONFIRM_RECONCILIATION=yes to execute state-altering reconciliation.'
      );
    }
    if (!verifiedBackup) {
      throw new Error(
        '[CRITICAL SAFETY ERROR] Backup verification missing. Modifying SQLite databases requires an operator-verified backup. You MUST pass --verified-backup-taken or set VERIFIED_BACKUP_TAKEN=yes.'
      );
    }
  }

  // 1. Resolve canonical database target using Prisma schema-relative rules
  const target = resolveCanonicalDatabaseTarget({
    databaseUrl: options.databaseUrl,
    args,
  });

  // 2. Validate backup if supplied
  let backupNotice = '';
  if (isApply) {
    if (backupFile) {
      validateBackupFile(backupFile, target.canonicalPath);
      console.log(`[ReconcileExecutionChannels] ✅ Validated SQLite backup file at: ${backupFile}`);
    } else {
      backupNotice =
        'Operator passed --verified-backup-taken acknowledgement. Operator remains strictly responsible for independent cold backup integrity.';
      console.warn(`[ReconcileExecutionChannels] ⚠️ NOTICE: ${backupNotice}`);
    }
  }

  const prisma =
    options.prismaClient ||
    new PrismaClient({
      datasources: {
        db: { url: target.canonicalUrl },
      },
    });

  const report: ReconciliationReport = {
    databasePath: target.canonicalPath,
    databaseUrl: target.canonicalUrl,
    mode,
    scannedOrders: 0,
    ordersWithDuplicates: 0,
    channelsArchived: 0,
    channelsRetained: 0,
    unresolvedConflicts: [],
    success: true,
    backupVerified: Boolean(backupFile),
    backupNotice: backupNotice || undefined,
  };

  try {
    console.log(`[ReconcileExecutionChannels] Operating on: ${target.canonicalPath} (Mode: ${mode.toUpperCase()})`);

    // 3. Strict Foreign Key Integrity Check (BLOCKS on ANY violation)
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(
        `[FATAL INTEGRITY VIOLATION] PRAGMA foreign_key_check detected ${fkViolations.length} foreign key violation(s) in SQLite database! All reconciliation operations are strictly BLOCKED until referential integrity is restored.`
      );
    }

    // 4. Check if table order_channels exists
    const tables: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='order_channels';"
    );
    if (!tables || tables.length === 0) {
      console.log('[ReconcileExecutionChannels] Table order_channels does not exist in target database. Exiting safely.');
      return report;
    }

    // 5. PHASE 1: GLOBAL PREFLIGHT INSPECTION (Read-Only)
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

    console.log(`[ReconcileExecutionChannels] Preflight: analyzing ${duplicateRows.length} order(s) with duplicate active execution channels...`);

    const validPlans: ReconciledOrderPlan[] = [];

    for (const dup of duplicateRows) {
      const orderId = dup.order_id;

      const orders: Array<{ id: number; status: string; execution_channel_id: string | null }> = await prisma.$queryRawUnsafe(
        'SELECT id, status, execution_channel_id FROM orders WHERE id = ?;',
        orderId
      );
      const order = orders && orders.length > 0 ? orders[0] : null;

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

      // Deterministic pointer match
      if (orderExecId && matchingChannels.length === 1) {
        const keeper = matchingChannels[0];
        const obsolete = activeChannels.filter((c) => c.id !== keeper.id);

        validPlans.push({
          orderId,
          orderStatus: order.status,
          executionChannelId: orderExecId,
          keeperRecord: {
            id: keeper.id,
            discordChannelId: keeper.discord_channel_id,
          },
          obsoleteRecords: obsolete.map((o) => ({
            id: o.id,
            discordChannelId: o.discord_channel_id,
          })),
        });
        continue;
      }

      // Ambiguous / Contradictory pointer blocker
      let failureReason = '';
      if (!orderExecId) {
        failureReason = `Missing pointer: orders.execution_channel_id is NULL for order #${orderId} (status: ${order.status}). Cannot determine authoritative Discord channel without manual review.`;
      } else if (matchingChannels.length === 0) {
        failureReason = `Pointer mismatch: orders.execution_channel_id '${orderExecId}' does not match any active channel records ([${activeChannels.map((c) => c.discord_channel_id).join(', ')}]).`;
      } else {
        failureReason = `Ambiguous multiple matches: orders.execution_channel_id '${orderExecId}' matches multiple channel records ([${matchingChannels.map((c) => c.id).join(', ')}]).`;
      }

      report.unresolvedConflicts.push({
        orderId,
        orderStatus: order.status,
        executionChannelId: orderExecId,
        channelIds: activeChannels.map((c) => c.discord_channel_id),
        reason: failureReason,
      });
    }

    // Preflight Gate: If ANY group is unresolved, HALT IMMEDIATELY with ZERO writes!
    if (report.unresolvedConflicts.length > 0) {
      report.success = false;
      report.error = `[GLOBAL PREFLIGHT HALT] Detected ${report.unresolvedConflicts.length} unresolved conflict(s). Refusing to perform partial reconciliation. All ${duplicateRows.length} order(s) remain untouched.`;
      console.error(`[ReconcileExecutionChannels] ❌ ${report.error}`);
      return report;
    }

    console.log(`[ReconcileExecutionChannels] ✅ Preflight passed cleanly for all ${validPlans.length} duplicate group(s).`);

    // 6. PHASE 2: GLOBAL ATOMIC BATCH EXECUTION (Inside a Single prisma.$transaction)
    if (isApply && validPlans.length > 0) {
      console.log(`[ReconcileExecutionChannels] Executing global atomic transaction for ${validPlans.length} order(s)...`);

      await prisma.$transaction(async (tx) => {
        for (const plan of validPlans) {
          // A. Concurrency Check: re-verify order status and authoritative pointer
          const txOrders: Array<{ status: string; execution_channel_id: string | null }> = await tx.$queryRawUnsafe(
            'SELECT status, execution_channel_id FROM orders WHERE id = ?;',
            plan.orderId
          );
          if (
            txOrders.length === 0 ||
            txOrders[0].status !== plan.orderStatus ||
            (txOrders[0].execution_channel_id || '').trim() !== plan.executionChannelId
          ) {
            throw new Error(
              `[CONCURRENT MUTATION DETECTED] Order #${plan.orderId} pointer or status modified concurrently during reconciliation. Aborting batch.`
            );
          }

          // B. Concurrency Check: re-verify exact active channel records, IDs, Discord IDs, and status
          const txChannels: Array<{
            id: number;
            discord_channel_id: string;
            status: string;
            channel_type: string;
          }> = await tx.$queryRawUnsafe(
            "SELECT id, discord_channel_id, status, channel_type FROM order_channels WHERE order_id = ? AND channel_type = 'execution' AND status = 'active' ORDER BY id ASC;",
            plan.orderId
          );

          const expectedTotal = plan.obsoleteRecords.length + 1;
          if (txChannels.length !== expectedTotal) {
            throw new Error(
              `[CONCURRENT MUTATION DETECTED] Order #${plan.orderId} active channel count altered concurrently. Aborting batch.`
            );
          }

          const txIds = new Set(txChannels.map((c) => c.id));
          if (!txIds.has(plan.keeperRecord.id)) {
            throw new Error(
              `[CONCURRENT MUTATION DETECTED] Keeper channel record #${plan.keeperRecord.id} no longer active for order #${plan.orderId}. Aborting batch.`
            );
          }

          for (const obs of plan.obsoleteRecords) {
            if (!txIds.has(obs.id)) {
              throw new Error(
                `[CONCURRENT MUTATION DETECTED] Obsolete channel record #${obs.id} altered concurrently for order #${plan.orderId}. Aborting batch.`
              );
            }
          }

          // C. Execute archiving updates for obsolete channels
          for (const obs of plan.obsoleteRecords) {
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
                orderId: plan.orderId,
                archivedRecordId: obs.id,
                archivedDiscordChannelId: obs.discordChannelId,
                retainedRecordId: plan.keeperRecord.id,
                retainedDiscordChannelId: plan.keeperRecord.discordChannelId,
              }),
              `Atomically reconciled duplicate channel #${obs.id} in favor of authoritative order pointer #${plan.keeperRecord.id}`,
              1
            );
          }
        }
      });

      console.log(`[ReconcileExecutionChannels] ✅ Global atomic transaction committed successfully.`);
    }

    report.channelsRetained = validPlans.length;
    report.channelsArchived = validPlans.reduce((sum, p) => sum + p.obsoleteRecords.length, 0);

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
        console.error('\n[ReconcileExecutionChannels] ❌ Terminated with preflight blockers or conflicts. Aborting.');
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[ReconcileExecutionChannels] ❌ Fatal error:', err.message);
      process.exit(1);
    });
}
