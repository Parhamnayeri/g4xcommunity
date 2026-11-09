/**
 * scripts/reconcile-execution-channels.ts
 *
 * Deterministic Reconciliation Tool for Duplicate Active Execution Channels.
 * 
 * Safety Guarantees:
 *  - Non-destructive: never physically deletes records (no SQL DELETE).
 *  - Prioritizes authoritative pointer `orders.execution_channel_id`.
 *  - Fails safe: unresolved / ambiguous conflicts are flagged for operator review.
 *  - Preserves complete audit trail via AuditLog table.
 *  - Supports --dry-run (default) and --apply modes.
 *
 * Usage:
 *   npx ts-node scripts/reconcile-execution-channels.ts [--dry-run | --apply]
 */

import dotenv from 'dotenv';
dotenv.config();
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}
import prisma from '../src/database/db';

export interface ReconciliationReport {
  scannedOrders: number;
  ordersWithDuplicates: number;
  channelsArchived: number;
  channelsRetained: number;
  unresolvedConflicts: Array<{
    orderId: number;
    orderStatus: string;
    executionChannelId: string | null;
    channelIds: string[];
    reason: string;
  }>;
  mode: 'dry-run' | 'apply';
}

export async function reconcileExecutionChannels(options: { apply?: boolean } = {}): Promise<ReconciliationReport> {
  const isApply = options.apply === true;
  const mode = isApply ? 'apply' : 'dry-run';

  console.log(`[ReconcileExecutionChannels] Starting execution channel audit (mode: ${mode.toUpperCase()})...`);

  // 1. Group active execution channels by order_id
  const duplicateGroups: Array<{ orderId: number }> = await prisma.$queryRawUnsafe(`
    SELECT order_id as orderId
    FROM order_channels
    WHERE channel_type = 'execution' AND status = 'active'
    GROUP BY order_id
    HAVING COUNT(*) > 1;
  `);

  const report: ReconciliationReport = {
    scannedOrders: duplicateGroups.length,
    ordersWithDuplicates: duplicateGroups.length,
    channelsArchived: 0,
    channelsRetained: 0,
    unresolvedConflicts: [],
    mode,
  };

  if (duplicateGroups.length === 0) {
    console.log('[ReconcileExecutionChannels] ✅ Zero duplicate active execution channels detected. System is clean.');
    return report;
  }

  console.warn(`[ReconcileExecutionChannels] ⚠️ Found ${duplicateGroups.length} orders with multiple active execution channels.`);

  for (const group of duplicateGroups) {
    const orderId = Number(group.orderId);

    const [order, activeChannels] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.orderChannel.findMany({
        where: { orderId, channelType: 'execution', status: 'active' },
        orderBy: { id: 'asc' },
      }),
    ]);

    if (!order) {
      report.unresolvedConflicts.push({
        orderId,
        orderStatus: 'UNKNOWN',
        executionChannelId: null,
        channelIds: activeChannels.map((c) => c.discordChannelId),
        reason: 'Order record does not exist for order_channels foreign key reference.',
      });
      continue;
    }

    const orderExecId = order.executionChannelId;
    const matchingChannels = activeChannels.filter((c) => c.discordChannelId === orderExecId);

    // Case 1: Order is completed or cancelled -> Archive all execution channels
    if (['completed', 'cancelled', 'refunded'].includes(order.status.toLowerCase())) {
      console.log(`[Reconcile] Order #${orderId} is terminal (${order.status}). Archiving all ${activeChannels.length} active channels.`);
      for (const ch of activeChannels) {
        if (isApply) {
          await prisma.orderChannel.update({
            where: { id: ch.id },
            data: { status: 'archived', archivedAt: new Date() },
          });
          await prisma.auditLog.create({
            data: {
              actorId: null,
              action: 'ORDER_CHANNEL_RECONCILE_ARCHIVE',
              entityType: 'OrderChannel',
              entityId: ch.id.toString(),
              newValues: JSON.stringify({
                orderId,
                discordChannelId: ch.discordChannelId,
                reason: `Order is in terminal state '${order.status}'`,
              }),
              reason: `Order #${orderId} is in terminal state '${order.status}'`,
              isSuccess: true,
            },
          });
        }
        report.channelsArchived++;
      }
      continue;
    }

    // Case 2: Authoritative pointer matches exactly one active channel
    if (orderExecId && matchingChannels.length === 1) {
      const keeper = matchingChannels[0];
      const obsolete = activeChannels.filter((c) => c.id !== keeper.id);

      console.log(`[Reconcile] Order #${orderId}: Retaining channel #${keeper.id} (${keeper.discordChannelId}) matching orders.execution_channel_id. Archiving ${obsolete.length} duplicate(s).`);

      report.channelsRetained++;

      for (const obs of obsolete) {
        if (isApply) {
          await prisma.orderChannel.update({
            where: { id: obs.id },
            data: { status: 'archived', archivedAt: new Date() },
          });
          await prisma.auditLog.create({
            data: {
              actorId: null,
              action: 'ORDER_CHANNEL_RECONCILE_ARCHIVE',
              entityType: 'OrderChannel',
              entityId: obs.id.toString(),
              newValues: JSON.stringify({
                orderId,
                discordChannelId: obs.discordChannelId,
                retainedChannelId: keeper.discordChannelId,
                reason: 'Archived duplicate channel in favor of orders.execution_channel_id pointer',
              }),
              reason: 'Archived duplicate channel in favor of orders.execution_channel_id pointer',
              isSuccess: true,
            },
          });
        }
        report.channelsArchived++;
      }
      continue;
    }

    // Case 3: Ambiguous or missing pointer -> Fail safe! Do not delete or archive arbitrarily!
    report.unresolvedConflicts.push({
      orderId,
      orderStatus: order.status,
      executionChannelId: orderExecId,
      channelIds: activeChannels.map((c) => c.discordChannelId),
      reason: orderExecId
        ? `Pointer '${orderExecId}' matches ${matchingChannels.length} records in order_channels.`
        : 'orders.execution_channel_id is null; cannot determine true Discord channel safely.',
    });
    console.warn(`[Reconcile] ⚠️ Order #${orderId} conflict cannot be resolved automatically:`, {
      orderExecId,
      activeChannels: activeChannels.map((c) => ({ id: c.id, discordChannelId: c.discordChannelId })),
    });
  }

  console.log(`[ReconcileExecutionChannels] Finished. Retained: ${report.channelsRetained}, Archived: ${report.channelsArchived}, Unresolved: ${report.unresolvedConflicts.length}`);
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  reconcileExecutionChannels({ apply })
    .then((report) => {
      console.log('\n--- Final Reconciliation Report ---');
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.unresolvedConflicts.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('[ReconcileExecutionChannels] Fatal error:', err);
      process.exit(1);
    });
}
