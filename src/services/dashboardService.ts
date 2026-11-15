/**
 * dashboardService.ts — Member Dashboard Analytics & Financial Breakdown Engine
 *
 * G4X Community — Phase 10: Member Dashboard Overhaul
 *
 * Features:
 *  1. Authoritative wallet metrics calculation with strict financial separation:
 *     - Available Balance (Ready to withdraw)
 *     - Pending Withdrawals (Processing in payout queue)
 *     - In Active Orders (Engaged in ongoing runs / unreleased 24h escrow)
 *     - Total Earnings (Lifetime verified net earnings)
 *  2. Time-series earnings trend analysis (7D, 30D, 90D, ALL) with growth percentage & comparison.
 *  3. Granular order earnings breakdown (Order Ref, Game, Role, Status, Net Payout, Release Stage).
 */

import prisma from '../database/db';
import { WalletV2Summary } from './financeV2/financeV2WalletService';

export interface DashboardWalletMetrics {
  availableCents: number;
  availableUsd: string;
  pendingWithdrawalsCents: number;
  pendingWithdrawalsUsd: string;
  pendingWithdrawalsCount: number;
  inActiveOrdersCents: number;
  inActiveOrdersUsd: string;
  inActiveOrdersCount: number;
  totalEarningsCents: number;
  totalEarningsUsd: string;
  // Backward compatibility with previous wallet overview schema
  reservedCents: number;
  reservedUsd: string;
  pendingEarningsCents: number;
  pendingEarningsUsd: string;
  confirmedEarningsCents: number;
  confirmedEarningsUsd: string;
  paidCents: number;
  paidUsd: string;
  totalPaidCents: number;
  totalPaidUsd: string;
  refundedCents: number;
  refundedUsd: string;
  totalHeldCents: number;
  totalHeldUsd: string;
  lifetimeEarnedCents: number;
  lifetimeEarnedUsd: string;
  eligibleWithdrawalCents: number;
  eligibleWithdrawalUsd: string;
}

export interface EarningsChartPoint {
  date: string;       // YYYY-MM-DD
  label: string;      // Day or short date (e.g. "01", "15", "Nov 12")
  amountCents: number;
  amountUsd: string;
  orderCount: number;
}

export interface EarningsOverviewChartData {
  range: '7d' | '30d' | '90d' | 'all';
  periodLabel: string;
  currentPeriodTotalCents: number;
  currentPeriodTotalUsd: string;
  previousPeriodTotalCents: number;
  previousPeriodTotalUsd: string;
  growthPercentage: string;       // e.g. "+18.4%" or "-5.2%"
  growthDirection: 'up' | 'down' | 'neutral';
  points: EarningsChartPoint[];
}

export interface OrderEarningsBreakdownItem {
  orderId: number;
  orderRef: string;
  gameSlug: string;
  gameDisplayName: string;
  serviceDisplayName: string;
  assignmentRole: string;
  orderStatus: string;
  amountCents: number;
  amountUsd: string;
  earningsStage: 'released' | 'pending_escrow' | 'in_progress' | 'cancelled';
  stageLabel: string;
  date: string;
}

/**
 * Computes authoritative wallet metrics for the 4 primary dashboard cards.
 */
export async function getDashboardWalletMetrics(
  userId: string,
  walletSummary: WalletV2Summary
): Promise<DashboardWalletMetrics> {
  // 1. Pending Withdrawals: Sum of requested funds in processing/scheduled queue
  const pendingStatuses = [
    'QUOTED',
    'USER_CONFIRMED',
    'REQUESTED',
    'RESERVED',
    'UNDER_ADMIN_REVIEW',
    'PROCESSING',
  ];

  const pendingWithdrawalRows = await prisma.boosterWithdrawalRequest.findMany({
    where: {
      boosterId: userId,
      status: { in: pendingStatuses },
    },
    select: { requestedUsdCents: true },
  });

  const pendingWithdrawalsCount = pendingWithdrawalRows.length;
  let pendingWithdrawalsCents = pendingWithdrawalRows.reduce(
    (sum, r) => sum + r.requestedUsdCents,
    0
  );

  // If no withdrawal rows found but reservedCents exists, fallback to reservedCents
  if (pendingWithdrawalsCents === 0 && walletSummary.reservedCents > 0) {
    pendingWithdrawalsCents = walletSummary.reservedCents;
  }

  // 2. In Active Orders: Sum of booster's allocated share in currently active/in-progress orders
  const activeOrderStatuses = [
    'assigned',
    'in_progress',
    'waiting_for_confirm',
    'pending_review',
  ];

  const activeAssignments = await prisma.orderAssignment.findMany({
    where: {
      userId,
      status: { in: ['assigned', 'accepted'] },
      order: {
        status: { in: activeOrderStatuses },
      },
    },
    include: {
      order: {
        include: {
          boosterPayoutAllocations: { where: { boosterId: userId } },
          assignments: { where: { status: 'assigned' } },
        },
      },
    },
  });

  let inActiveOrdersCents = 0;
  for (const a of activeAssignments) {
    const o = a.order;
    const allocation = o.boosterPayoutAllocations[0];
    if (allocation && allocation.allocatedMinor > 0) {
      inActiveOrdersCents += allocation.allocatedMinor;
    } else if (o.boosterPoolMinor > 0) {
      const teamSize = Math.max(1, o.assignments.length);
      inActiveOrdersCents += Math.floor(o.boosterPoolMinor / teamSize);
    }
  }

  // Also include completed runs that are in the 24-hour mandatory escrow hold
  inActiveOrdersCents += walletSummary.pendingEarningsCents;

  const totalEarningsCents = Math.max(
    walletSummary.lifetimeEarnedCents,
    walletSummary.availableCents + walletSummary.reservedCents + walletSummary.paidCents
  );
  const eligibleWithdrawalCents = walletSummary.availableCents;

  return {
    availableCents: walletSummary.availableCents,
    availableUsd: (walletSummary.availableCents / 100).toFixed(2),
    pendingWithdrawalsCents,
    pendingWithdrawalsUsd: (pendingWithdrawalsCents / 100).toFixed(2),
    pendingWithdrawalsCount,
    inActiveOrdersCents,
    inActiveOrdersUsd: (inActiveOrdersCents / 100).toFixed(2),
    inActiveOrdersCount: activeAssignments.length,
    totalEarningsCents,
    totalEarningsUsd: (totalEarningsCents / 100).toFixed(2),

    // Backward-compatible fields
    reservedCents: walletSummary.reservedCents,
    reservedUsd: (walletSummary.reservedCents / 100).toFixed(2),
    pendingEarningsCents: walletSummary.pendingEarningsCents,
    pendingEarningsUsd: (walletSummary.pendingEarningsCents / 100).toFixed(2),
    confirmedEarningsCents: walletSummary.confirmedEarningsCents,
    confirmedEarningsUsd: (walletSummary.confirmedEarningsCents / 100).toFixed(2),
    paidCents: walletSummary.paidCents,
    paidUsd: (walletSummary.paidCents / 100).toFixed(2),
    totalPaidCents: walletSummary.paidCents,
    totalPaidUsd: (walletSummary.paidCents / 100).toFixed(2),
    refundedCents: walletSummary.refundedCents,
    refundedUsd: (walletSummary.refundedCents / 100).toFixed(2),
    totalHeldCents: walletSummary.totalHeldCents,
    totalHeldUsd: (walletSummary.totalHeldCents / 100).toFixed(2),
    lifetimeEarnedCents: walletSummary.lifetimeEarnedCents,
    lifetimeEarnedUsd: (walletSummary.lifetimeEarnedCents / 100).toFixed(2),
    eligibleWithdrawalCents,
    eligibleWithdrawalUsd: (eligibleWithdrawalCents / 100).toFixed(2),
  };
}

/**
 * Computes time-series earnings analytics for the interactive chart.
 */
export async function getDashboardEarningsChart(
  userId: string,
  range: '7d' | '30d' | '90d' | 'all' = '30d'
): Promise<EarningsOverviewChartData> {
  const now = new Date();
  let days = 30;
  let periodLabel = 'Net earnings this month';

  if (range === '7d') {
    days = 7;
    periodLabel = 'Net earnings this week';
  } else if (range === '90d') {
    days = 90;
    periodLabel = 'Net earnings last 90 days';
  } else if (range === 'all') {
    days = 365;
    periodLabel = 'Lifetime net earnings';
  }

  const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = new Date(currentStart.getTime() - days * 24 * 60 * 60 * 1000);

  // Fetch credit ledger entries for earnings
  const earningTypes = ['EARNING_CONFIRMED', 'AVAILABLE_RELEASE', 'EARNING_PENDING'];

  const [currentEntries, previousEntries] = await Promise.all([
    prisma.ledgerEntryV2.findMany({
      where: {
        userId,
        direction: 'CREDIT',
        entryType: { in: earningTypes },
        createdAt: { gte: currentStart, lte: now },
      },
      select: {
        amountCents: true,
        createdAt: true,
        orderId: true,
      },
    }),
    prisma.ledgerEntryV2.findMany({
      where: {
        userId,
        direction: 'CREDIT',
        entryType: { in: earningTypes },
        createdAt: { gte: previousStart, lt: currentStart },
      },
      select: {
        amountCents: true,
      },
    }),
  ]);

  const currentPeriodTotalCents = currentEntries.reduce((sum, e) => sum + e.amountCents, 0);
  const previousPeriodTotalCents = previousEntries.reduce((sum, e) => sum + e.amountCents, 0);

  // Growth percentage calculation
  let growthPercentage = '+0.0%';
  let growthDirection: 'up' | 'down' | 'neutral' = 'neutral';

  if (previousPeriodTotalCents > 0) {
    const diff = currentPeriodTotalCents - previousPeriodTotalCents;
    const pct = ((diff / previousPeriodTotalCents) * 100).toFixed(1);
    if (diff > 0) {
      growthPercentage = `+${pct}%`;
      growthDirection = 'up';
    } else if (diff < 0) {
      growthPercentage = `${pct}%`;
      growthDirection = 'down';
    } else {
      growthPercentage = '0.0%';
      growthDirection = 'neutral';
    }
  } else if (currentPeriodTotalCents > 0) {
    growthPercentage = '+100%';
    growthDirection = 'up';
  }

  // Construct discrete points across the duration
  // For 7D: 7 daily points
  // For 30D: 30 daily points
  // For 90D: 30 3-day buckets
  // For ALL: 12 monthly buckets
  const pointCount = days <= 30 ? days : 30;
  const bucketMs = (days * 24 * 60 * 60 * 1000) / pointCount;
  const points: EarningsChartPoint[] = [];

  for (let i = 0; i < pointCount; i++) {
    const bucketStart = new Date(currentStart.getTime() + i * bucketMs);
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);

    const matches = currentEntries.filter(
      (e) => e.createdAt >= bucketStart && e.createdAt < bucketEnd
    );
    const bucketCents = matches.reduce((sum, e) => sum + e.amountCents, 0);

    const dayNumber = String(bucketStart.getDate()).padStart(2, '0');
    const monthShort = bucketStart.toLocaleString('en-US', { month: 'short' });
    const label = days <= 7 ? `${monthShort} ${dayNumber}` : dayNumber;

    points.push({
      date: bucketStart.toISOString().split('T')[0],
      label,
      amountCents: bucketCents,
      amountUsd: (bucketCents / 100).toFixed(2),
      orderCount: matches.length,
    });
  }

  return {
    range,
    periodLabel,
    currentPeriodTotalCents,
    currentPeriodTotalUsd: (currentPeriodTotalCents / 100).toFixed(2),
    previousPeriodTotalCents,
    previousPeriodTotalUsd: (previousPeriodTotalCents / 100).toFixed(2),
    growthPercentage,
    growthDirection,
    points,
  };
}

/**
 * Computes granular order-by-order earnings breakdown for the booster.
 */
export async function getDashboardOrderEarningsBreakdown(
  userId: string
): Promise<OrderEarningsBreakdownItem[]> {
  const orders = await prisma.order.findMany({
    where: {
      assignments: { some: { userId } },
    },
    include: {
      game: { select: { slug: true, displayName: true } },
      service: { select: { displayName: true } },
      assignments: { where: { userId }, select: { assignedRole: true } },
      boosterPayoutAllocations: { where: { boosterId: userId } },
      boostReleaseTracker: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return orders.map((o) => {
    const alloc = o.boosterPayoutAllocations[0];
    const amountCents =
      alloc?.allocatedMinor ||
      (o.boosterPoolMinor > 0 ? o.boosterPoolMinor : o.grossAmountMinor);

    let earningsStage: 'released' | 'pending_escrow' | 'in_progress' | 'cancelled' =
      'in_progress';
    let stageLabel = 'In Active Run';

    if (o.status === 'completed' || o.status === 'done') {
      if (o.boostReleaseTracker?.isReleased) {
        earningsStage = 'released';
        stageLabel = 'Ready to withdraw';
      } else if (o.boostReleaseTracker?.stage === 'HOLDING') {
        earningsStage = 'pending_escrow';
        stageLabel = '24h Escrow Holding';
      } else {
        earningsStage = 'released';
        stageLabel = 'Ready to withdraw';
      }
    } else if (o.status === 'cancelled') {
      earningsStage = 'cancelled';
      stageLabel = 'Cancelled';
    } else if (o.status === 'waiting_for_confirm') {
      earningsStage = 'in_progress';
      stageLabel = 'Waiting Confirmation';
    }

    return {
      orderId: o.id,
      orderRef: o.orderRef,
      gameSlug: o.game.slug,
      gameDisplayName: o.game.displayName,
      serviceDisplayName: o.service.displayName,
      assignmentRole: o.assignments[0]?.assignedRole || 'Booster',
      orderStatus: o.status,
      amountCents,
      amountUsd: (amountCents / 100).toFixed(2),
      earningsStage,
      stageLabel,
      date: (o.completedAt || o.createdAt).toISOString(),
    };
  });
}
