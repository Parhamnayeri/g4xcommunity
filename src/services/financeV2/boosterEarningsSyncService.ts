/**
 * boosterEarningsSyncService.ts — Authoritative Idempotent Linkage between Order Completion,
 * BoosterPayoutAllocation, and WalletV2 Earnings (Pending -> Confirmed).
 *
 * SAFETY & ACCOUNTING INVARIANTS:
 *  1. Clear strict separation: calculated (BoosterPayoutAllocation) -> pendingEarningsCents -> confirmedEarningsCents -> (ESCROW_RELEASE_ENABLED) -> availableCents.
 *  2. NEVER writes to WalletV2.availableCents directly; locked balances remain strictly non-withdrawable until explicit ESCROW_RELEASE_ENABLED release.
 *  3. Deterministic idempotency keys (`EARN_PEND_ORD_<id>_BOOSTER_<uid>`, `EARN_CONF_ORD_<id>_BOOSTER_<uid>`) guarantee zero double credits on retries or concurrent requests.
 *  4. Strictly skips orders with `historical_imported` snapshot status (legacy Discord intake never auto-credits historical earnings).
 */

import prisma from '../../database/db';
import { Prisma } from '@prisma/client';
import { recordPendingEarnings, confirmPendingEarnings } from './financeV2WalletService';

function equalSplitMinor(poolMinor: number, boosterIds: string[]): Array<{ boosterId: string; allocatedMinor: number }> {
  if (boosterIds.length === 0 || poolMinor <= 0) return [];
  const sorted = [...boosterIds].sort();
  const baseShare = Math.floor(poolMinor / sorted.length);
  const remainder = poolMinor % sorted.length;
  return sorted.map((boosterId, idx) => ({
    boosterId,
    allocatedMinor: baseShare + (idx < remainder ? 1 : 0),
  }));
}

async function resolveParticipatingBoosters(orderId: number, tx: Prisma.TransactionClient): Promise<string[]> {
  const completedRuns = await tx.orderRun.findMany({
    where: { orderId, status: 'completed' },
    include: {
      runAssignments: {
        where: { status: { in: ['completed', 'assigned'] } },
        include: { assignment: true },
      },
    },
  });

  const ids = new Set<string>();
  for (const run of completedRuns) {
    for (const ra of run.runAssignments) {
      if (ra.assignment?.userId) {
        ids.add(ra.assignment.userId);
      }
    }
  }

  if (ids.size === 0) {
    const assignments = await tx.orderAssignment.findMany({
      where: { orderId, status: { in: ['assigned', 'completed'] } },
      orderBy: { id: 'asc' },
    });
    for (const a of assignments) {
      ids.add(a.userId);
    }
  }

  return Array.from(ids);
}

/**
 * Ensures BoosterPayoutAllocation records exist for an order when boosters and a positive pool exist,
 * without deleting or overwriting already-credited allocations.
 */
async function ensureOrderAllocationsInTx(orderId: number, tx: Prisma.TransactionClient) {
  const existing = await tx.boosterPayoutAllocation.findMany({
    where: { orderId },
    orderBy: { id: 'asc' },
  });
  if (existing.length > 0) {
    return existing;
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { financialSnapshot: true },
  });
  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  const poolMinor = order.financialSnapshot?.boosterPoolMinor ?? order.boosterPoolMinor;
  if (!poolMinor || poolMinor <= 0) {
    return [];
  }

  const boosterIds = await resolveParticipatingBoosters(orderId, tx);
  if (boosterIds.length === 0) {
    return [];
  }

  const shares = equalSplitMinor(poolMinor, boosterIds);
  const created = [];
  for (const share of shares) {
    if (share.allocatedMinor <= 0) continue;
    const record = await tx.boosterPayoutAllocation.create({
      data: {
        orderId,
        boosterId: share.boosterId,
        allocatedMinor: share.allocatedMinor,
        currency: (order.financialSnapshot?.currency || order.currency || 'USD').toUpperCase(),
        payoutRole: shares.length === 1 ? 'solo' : 'team_member',
      },
    });
    created.push(record);
  }
  return created;
}

export interface EarningsSyncResult {
  orderId: number;
  skippedReason?: string;
  allocationsCount: number;
  newlyCreditedCount: number;
}

/**
 * Idempotently credits `pendingEarningsCents` in WalletV2 for all BoosterPayoutAllocation records
 * of a verified, non-historical order. Never modifies `availableCents`.
 */
export async function syncOrderPendingEarnings(
  orderId: number,
  actorId?: string,
  externalTx?: Prisma.TransactionClient
): Promise<EarningsSyncResult> {
  const execute = async (): Promise<EarningsSyncResult> => {
    const runInTx = async (tx: Prisma.TransactionClient): Promise<EarningsSyncResult> => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { financialSnapshot: true },
      });

      if (!order) {
        throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
      }

      if (order.status === 'cancelled' || order.paymentStatus === 'refunded') {
        return { orderId, skippedReason: 'ORDER_CANCELLED_OR_REFUNDED', allocationsCount: 0, newlyCreditedCount: 0 };
      }

      if (order.financialSnapshot?.calculationStatus === 'historical_imported') {
        return { orderId, skippedReason: 'HISTORICAL_IMPORT_NO_AUTO_CREDIT', allocationsCount: 0, newlyCreditedCount: 0 };
      }

      const supportedCurrency = ['USD', 'USDT'].includes((order.currency || '').toUpperCase());
      if (!supportedCurrency) {
        return { orderId, skippedReason: `NON_USD_CURRENCY_${order.currency}`, allocationsCount: 0, newlyCreditedCount: 0 };
      }

      if (!['verified', 'unneeded', 'paid'].includes(order.paymentStatus)) {
        return { orderId, skippedReason: `UNVERIFIED_PAYMENT_${order.paymentStatus}`, allocationsCount: 0, newlyCreditedCount: 0 };
      }

      const allocations = await ensureOrderAllocationsInTx(orderId, tx);
      if (allocations.length === 0) {
        return { orderId, skippedReason: 'NO_ELIGIBLE_ALLOCATIONS', allocationsCount: 0, newlyCreditedCount: 0 };
      }

      let newlyCreditedCount = 0;
      for (const alloc of allocations) {
        if (alloc.allocatedMinor <= 0) continue;
        const idempotencyKey = `EARN_PEND_ORD_${orderId}_BOOSTER_${alloc.boosterId}`;
        const existingEntry = await tx.ledgerEntryV2.findUnique({
          where: { idempotencyKey },
        });
        if (existingEntry) {
          continue;
        }

        await recordPendingEarnings(
          alloc.boosterId,
          alloc.allocatedMinor,
          {
            orderId,
            entryRef: `LEDGER_PEND_ORD_${orderId}_${alloc.boosterId}`,
            idempotencyKey,
            description: `Pending boost earnings recorded for order #${orderId}`,
            createdBy: actorId,
          },
          tx
        );
        newlyCreditedCount++;
      }

      return {
        orderId,
        allocationsCount: allocations.length,
        newlyCreditedCount,
      };
    };

    if (externalTx) {
      return await runInTx(externalTx);
    }
    return await prisma.$transaction(runInTx);
  };

  try {
    return await execute();
  } catch (err: any) {
    // Handle SQLite concurrent unique constraint race cleanly after transaction rollback
    if (err?.code === 'P2002' && !externalTx) {
      return await execute();
    }
    throw err;
  }
}

/**
 * Idempotently ensures pending earnings exist, then promotes them to `confirmedEarningsCents`
 * upon verified review/approval. Remains locked until ESCROW_RELEASE_ENABLED=true release.
 */
export async function confirmOrderBoosterEarnings(
  orderId: number,
  actorId: string,
  externalTx?: Prisma.TransactionClient
): Promise<EarningsSyncResult> {
  const execute = async (): Promise<EarningsSyncResult> => {
    const runInTx = async (tx: Prisma.TransactionClient): Promise<EarningsSyncResult> => {
      const pendRes = await syncOrderPendingEarnings(orderId, actorId, tx);
      if (pendRes.skippedReason && pendRes.allocationsCount === 0) {
        return pendRes;
      }

      const allocations = await tx.boosterPayoutAllocation.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      });

      let newlyConfirmedCount = 0;
      for (const alloc of allocations) {
        if (alloc.allocatedMinor <= 0) continue;
        const idempotencyKey = `EARN_CONF_ORD_${orderId}_BOOSTER_${alloc.boosterId}`;
        const existingEntry = await tx.ledgerEntryV2.findUnique({
          where: { idempotencyKey },
        });
        if (existingEntry) {
          continue;
        }

        await confirmPendingEarnings(
          alloc.boosterId,
          alloc.allocatedMinor,
          {
            orderId,
            entryRef: `LEDGER_CONF_ORD_${orderId}_${alloc.boosterId}`,
            idempotencyKey,
            description: `Confirmed boost earnings for order #${orderId}`,
            createdBy: actorId,
          },
          tx
        );
        newlyConfirmedCount++;
      }

      return {
        orderId,
        allocationsCount: allocations.length,
        newlyCreditedCount: newlyConfirmedCount,
      };
    };

    if (externalTx) {
      return await runInTx(externalTx);
    }
    return await prisma.$transaction(runInTx);
  };

  try {
    return await execute();
  } catch (err: any) {
    if (err?.code === 'P2002' && !externalTx) {
      return await execute();
    }
    throw err;
  }
}
