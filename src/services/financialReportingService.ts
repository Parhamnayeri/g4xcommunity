/**
 * src/services/financialReportingService.ts — G4X Financial Reports & Advertiser Boosts (Phase 3)
 *
 * Core Modules:
 *  1. Unified Reporting Engine for All Platforms, Individual Platforms & Advertiser Boosts
 *  2. Non-Duplicative Consolidated Asset & Revenue Calculations
 *  3. Global Date Filtering (Daily, Weekly, Monthly, Quarterly, Yearly, Custom, All Time)
 *  4. Period Comparison Engine with Percentage Deltas
 *  5. Cross-Platform Advertiser Boost Attribution
 *  6. Time-Series Trend Aggregations for Interactive Visualizations
 *  7. Full CSV Export Generator
 */

import prisma from '../database/db';
import { formatFinancialAmount } from './financialAccountService';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPES & DATA CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

export type ReportPeriodType =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY'
  | 'CUSTOM'
  | 'ALL_TIME';

export type PlatformKey = 'all' | 'direct' | 'eldorado' | 'skycoach' | 'overgear' | 'kingboost' | 'advertiser';

export interface DateRangeCalculation {
  periodType: ReportPeriodType;
  startDate: Date;
  endDate: Date;
  previousStartDate: Date | null;
  previousEndDate: Date | null;
  periodLabel: string;
  previousPeriodLabel: string;
}

export interface MetricWithComparison {
  valueMinor: number;
  formatted: string;
  previousValueMinor: number | null;
  formattedPrevious: string | null;
  changePercentage: number | null; // e.g. +18.4, -5.2
  trend: 'up' | 'down' | 'neutral';
}

export interface CountWithComparison {
  count: number;
  previousCount: number | null;
  changePercentage: number | null;
  trend: 'up' | 'down' | 'neutral';
}

export interface PlatformReportSummary {
  platformKey: string;
  platformName: string;
  currency: 'USD';
  
  // Order counts
  totalOrders: CountWithComparison;
  completedOrders: CountWithComparison;
  activeOrders: CountWithComparison;
  cancelledOrders: CountWithComparison;

  // Financial Metrics
  grossRevenue: MetricWithComparison;
  platformFees: MetricWithComparison;
  netRevenue: MetricWithComparison;
  boosterCosts: MetricWithComparison;
  advertiserCosts: MetricWithComparison;
  netProfit: MetricWithComparison;

  // Balance & Payout Status
  totalWithdrawalsMinor: number;
  formattedTotalWithdrawals: string;
  pendingWithdrawalsMinor: number;
  formattedPendingWithdrawals: string;
  currentPlatformBalanceMinor: number;
  formattedCurrentPlatformBalance: string;
  pendingOrderValueMinor: number;
  formattedPendingOrderValue: string;
}

export interface AdvertiserBoostSummary {
  totalAdvertiserOrders: CountWithComparison;
  completedAdvertiserOrders: CountWithComparison;
  activeAdvertiserOrders: CountWithComparison;
  cancelledAdvertiserOrders: CountWithComparison;

  grossAdvertiserRevenue: MetricWithComparison;
  platformFees: MetricWithComparison;
  advertiserPayment: MetricWithComparison; // Net received from advertiser (gross - platform fee)
  boosterPayouts: MetricWithComparison;
  additionalCosts: MetricWithComparison;
  netAdvertiserProfit: MetricWithComparison;

  // Origin distribution across platforms
  originPlatformBreakdown: {
    platformKey: string;
    platformName: string;
    ordersCount: number;
    grossRevenueMinor: number;
    formattedGrossRevenue: string;
    netProfitMinor: number;
    formattedNetProfit: string;
  }[];
}

export interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Oct 15"
  grossRevenueMinor: number;
  netRevenueMinor: number;
  netProfitMinor: number;
  boosterCostsMinor: number;
  ordersCount: number;
  advertiserRevenueMinor?: number;
}

export interface PlatformBreakdownPoint {
  platformKey: string;
  platformName: string;
  grossRevenueMinor: number;
  formattedGrossRevenue: string;
  netProfitMinor: number;
  formattedNetProfit: string;
  ordersCount: number;
  revenueSharePercentage: number;
}

export interface ConsolidatedFinancialReportResponse {
  success: boolean;
  periodType: ReportPeriodType;
  dateRange: {
    startDate: string;
    endDate: string;
    periodLabel: string;
    previousPeriodLabel: string;
  };
  summary: PlatformReportSummary;
  platforms: PlatformReportSummary[];
  advertiserBoosts: AdvertiserBoostSummary;
  charts: {
    revenueOverTime: ChartDataPoint[];
    platformRevenueBreakdown: PlatformBreakdownPoint[];
  };
  generatedAt: string;
}

export interface PlatformDetailReportResponse {
  success: boolean;
  platformKey: string;
  platformName: string;
  periodType: ReportPeriodType;
  dateRange: {
    startDate: string;
    endDate: string;
    periodLabel: string;
    previousPeriodLabel: string;
  };
  summary: PlatformReportSummary;
  charts: {
    revenueOverTime: ChartDataPoint[];
  };
  generatedAt: string;
}

export interface AdvertiserBoostsReportResponse {
  success: boolean;
  periodType: ReportPeriodType;
  dateRange: {
    startDate: string;
    endDate: string;
    periodLabel: string;
    previousPeriodLabel: string;
  };
  summary: AdvertiserBoostSummary;
  charts: {
    performanceOverTime: ChartDataPoint[];
  };
  generatedAt: string;
}

export interface ReportingOrderItem {
  id: number;
  orderRef: string;
  externalOrderId: string | null;
  gameSlug: string;
  platformKey: string;
  platformName: string;
  isAdvertiserBoost: boolean;
  advertiserId: string | null;
  advertiserName: string | null;
  status: string;
  paymentStatus: string;
  currency: string;
  grossAmountMinor: number;
  formattedGross: string;
  platformFeeMinor: number;
  formattedPlatformFee: string;
  boosterCostMinor: number;
  formattedBoosterCost: string;
  advertiserCostMinor: number;
  formattedAdvertiserCost: string;
  netProfitMinor: number;
  formattedNetProfit: string;
  createdAt: string;
  completedAt: string | null;
}

// Canonical Platforms Configuration
export const CANONICAL_PLATFORMS: { key: string; name: string; accountType: string }[] = [
  { key: 'direct', name: 'G4X Direct Store', accountType: 'G4X_DIRECT' },
  { key: 'eldorado', name: 'Eldorado Platform', accountType: 'ELDORADO' },
  { key: 'skycoach', name: 'Skycoach Platform', accountType: 'SKYCOACH' },
  { key: 'overgear', name: 'Overgear Platform', accountType: 'OVERGEAR' },
  { key: 'kingboost', name: 'Kingboost Platform', accountType: 'KINGBOOST' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATE RANGE & COMPARISON CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

export function calculateDateRanges(
  periodType: ReportPeriodType = 'MONTHLY',
  customFrom?: string | Date,
  customTo?: string | Date
): DateRangeCalculation {
  const now = new Date();

  let startDate: Date;
  let endDate: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let previousStartDate: Date | null = null;
  let previousEndDate: Date | null = null;
  let periodLabel = '';
  let previousPeriodLabel = '';

  switch (periodType.toUpperCase() as ReportPeriodType) {
    case 'DAILY': {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      previousStartDate = new Date(startDate.getTime() - 24 * 3600 * 1000);
      previousEndDate = new Date(endDate.getTime() - 24 * 3600 * 1000);
      periodLabel = 'Today';
      previousPeriodLabel = 'Yesterday';
      break;
    }
    case 'WEEKLY': {
      // Last 7 days
      startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      startDate.setHours(0, 0, 0, 0);
      previousStartDate = new Date(startDate.getTime() - 7 * 24 * 3600 * 1000);
      previousEndDate = new Date(startDate.getTime() - 1);
      periodLabel = 'Past 7 Days';
      previousPeriodLabel = 'Preceding 7 Days';
      break;
    }
    case 'MONTHLY': {
      // Last 30 days
      startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      startDate.setHours(0, 0, 0, 0);
      previousStartDate = new Date(startDate.getTime() - 30 * 24 * 3600 * 1000);
      previousEndDate = new Date(startDate.getTime() - 1);
      periodLabel = 'Past 30 Days';
      previousPeriodLabel = 'Preceding 30 Days';
      break;
    }
    case 'QUARTERLY': {
      // Last 90 days
      startDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
      startDate.setHours(0, 0, 0, 0);
      previousStartDate = new Date(startDate.getTime() - 90 * 24 * 3600 * 1000);
      previousEndDate = new Date(startDate.getTime() - 1);
      periodLabel = 'Past 90 Days';
      previousPeriodLabel = 'Preceding 90 Days';
      break;
    }
    case 'YEARLY': {
      // Last 365 days
      startDate = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
      startDate.setHours(0, 0, 0, 0);
      previousStartDate = new Date(startDate.getTime() - 365 * 24 * 3600 * 1000);
      previousEndDate = new Date(startDate.getTime() - 1);
      periodLabel = 'Past 365 Days';
      previousPeriodLabel = 'Preceding 365 Days';
      break;
    }
    case 'CUSTOM': {
      if (!customFrom || !customTo) {
        throw new Error('VALIDATION_ERROR: Both customFrom and customTo dates are required for CUSTOM range');
      }
      startDate = new Date(customFrom);
      endDate = new Date(customTo);
      endDate.setHours(23, 59, 59, 999);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('VALIDATION_ERROR: Invalid custom date format');
      }
      const durationMs = endDate.getTime() - startDate.getTime();
      previousStartDate = new Date(startDate.getTime() - durationMs);
      previousEndDate = new Date(startDate.getTime() - 1);
      periodLabel = `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
      previousPeriodLabel = `${previousStartDate.toLocaleDateString()} - ${previousEndDate.toLocaleDateString()}`;
      break;
    }
    case 'ALL_TIME':
    default: {
      startDate = new Date(0);
      endDate = new Date(now.getFullYear() + 10, 11, 31, 23, 59, 59, 999);
      periodLabel = 'All Time';
      previousPeriodLabel = 'N/A';
      break;
    }
  }

  return {
    periodType,
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
    periodLabel,
    previousPeriodLabel,
  };
}

export function computePercentageChange(current: number, previous: number | null): {
  changePercentage: number | null;
  trend: 'up' | 'down' | 'neutral';
} {
  if (previous === null) return { changePercentage: null, trend: 'neutral' };
  if (previous === 0) {
    if (current > 0) return { changePercentage: 100.0, trend: 'up' };
    if (current < 0) return { changePercentage: -100.0, trend: 'down' };
    return { changePercentage: 0.0, trend: 'neutral' };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const trend = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'neutral';
  return { changePercentage: rounded, trend };
}

export function normalizeOrderPlatform(sourceWebsite?: string | null): string {
  if (!sourceWebsite) return 'direct';
  const sw = sourceWebsite.toLowerCase().trim();
  if (sw === 'eldorado') return 'eldorado';
  if (sw === 'skycoach') return 'skycoach';
  if (sw === 'overgear') return 'overgear';
  if (sw === 'kingboost') return 'kingboost';
  if (sw === 'g2g') return 'eldorado'; // Map historical G2G to Eldorado platform
  return 'direct';
}

export function isAdvertiserOrder(order: {
  advertiserId?: string | null;
  creatorType?: string | null;
}): boolean {
  if (order.advertiserId && order.advertiserId.trim().length > 0) return true;
  if ((order.creatorType || '').toLowerCase().trim() === 'advertiser') return true;
  return false;
}

export const COMPLETED_ORDER_STATUSES = ['completed', 'confirmed', 'warranty', 'closed', 'resolved'];
export function isOrderCompleted(status?: string | null): boolean {
  if (!status) return false;
  return COMPLETED_ORDER_STATUSES.includes(status.toLowerCase().trim());
}

export const CANCELLED_ORDER_STATUSES = ['cancelled', 'canceled', 'refunded'];
export function isOrderCancelled(status?: string | null): boolean {
  if (!status) return false;
  return CANCELLED_ORDER_STATUSES.includes(status.toLowerCase().trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CORE CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

interface RawOrderMetrics {
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  cancelledOrders: number;
  grossRevenueMinor: number;
  platformFeesMinor: number;
  netRevenueMinor: number;
  boosterCostsMinor: number;
  advertiserCostsMinor: number;
  netProfitMinor: number;
  pendingOrderValueMinor: number;
}

function calculateRawMetricsFromOrders(orders: any[]): RawOrderMetrics {
  let totalOrders = 0;
  let completedOrders = 0;
  let activeOrders = 0;
  let cancelledOrders = 0;

  let grossRevenueMinor = 0;
  let platformFeesMinor = 0;
  let boosterCostsMinor = 0;
  let advertiserCostsMinor = 0;
  let pendingOrderValueMinor = 0;

  for (const o of orders) {
    totalOrders++;
    const st = (o.status || '').toLowerCase().trim();

    if (isOrderCompleted(st)) {
      completedOrders++;
      grossRevenueMinor += o.grossAmountMinor || 0;
      platformFeesMinor += o.platformFeeMinor || 0;
      boosterCostsMinor += o.boosterPoolMinor || 0;
      advertiserCostsMinor += o.advertiserFeeMinor || 0;
    } else if (isOrderCancelled(st)) {
      cancelledOrders++;
    } else {
      activeOrders++;
      const net = (o.grossAmountMinor || 0) - (o.platformFeeMinor || 0);
      pendingOrderValueMinor += Math.max(0, net);
    }
  }

  const netRevenueMinor = grossRevenueMinor - platformFeesMinor;
  const netProfitMinor = netRevenueMinor - boosterCostsMinor - advertiserCostsMinor;

  return {
    totalOrders,
    completedOrders,
    activeOrders,
    cancelledOrders,
    grossRevenueMinor,
    platformFeesMinor,
    netRevenueMinor,
    boosterCostsMinor,
    advertiserCostsMinor,
    netProfitMinor,
    pendingOrderValueMinor,
  };
}

function buildMetricWithComparison(currentMinor: number, prevMinor: number | null): MetricWithComparison {
  const { changePercentage, trend } = computePercentageChange(currentMinor, prevMinor);
  return {
    valueMinor: currentMinor,
    formatted: formatFinancialAmount(currentMinor, 'USD'),
    previousValueMinor: prevMinor,
    formattedPrevious: prevMinor !== null ? formatFinancialAmount(prevMinor, 'USD') : null,
    changePercentage,
    trend,
  };
}

function buildCountWithComparison(current: number, prev: number | null): CountWithComparison {
  const { changePercentage, trend } = computePercentageChange(current, prev);
  return {
    count: current,
    previousCount: prev,
    changePercentage,
    trend,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PLATFORM REPORT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export async function getPlatformFinancialReport(
  platformKey: string,
  range: DateRangeCalculation
): Promise<PlatformReportSummary> {
  const platConfig = CANONICAL_PLATFORMS.find((p) => p.key === platformKey) || {
    key: platformKey,
    name: `${platformKey.toUpperCase()} Platform`,
    accountType: 'ELDORADO',
  };

  // Find linked FinancialAccount
  const finAcc = await prisma.financialAccount.findFirst({
    where: {
      category: 'PLATFORM',
      accountType: platConfig.accountType as any,
    },
  });

  const currentBalanceMinor = finAcc ? Number(finAcc.currentBalance) : 0;

  // Withdrawals for this account
  let totalWithdrawalsMinor = 0;
  let pendingWithdrawalsMinor = 0;

  if (finAcc) {
    const withdrawals = await prisma.platformWithdrawal.findMany({
      where: { sourceAccountId: finAcc.id },
      select: { amount: true, status: true },
    });
    for (const w of withdrawals) {
      if (w.status === 'COMPLETED') totalWithdrawalsMinor += Number(w.amount);
      else if (w.status === 'PENDING' || w.status === 'PROCESSING') pendingWithdrawalsMinor += Number(w.amount);
    }
  }

  // Fetch Current Period Orders
  const currentOrders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
    },
    select: {
      id: true,
      status: true,
      sourceWebsite: true,
      grossAmountMinor: true,
      platformFeeMinor: true,
      boosterPoolMinor: true,
      advertiserFeeMinor: true,
    },
  });

  const filteredCurrent = currentOrders.filter((o) => normalizeOrderPlatform(o.sourceWebsite) === platformKey);
  const currentMetrics = calculateRawMetricsFromOrders(filteredCurrent);

  // Fetch Previous Period Orders if applicable
  let prevMetrics: RawOrderMetrics | null = null;
  if (range.previousStartDate && range.previousEndDate) {
    const prevOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: range.previousStartDate, lte: range.previousEndDate },
      },
      select: {
        id: true,
        status: true,
        sourceWebsite: true,
        grossAmountMinor: true,
        platformFeeMinor: true,
        boosterPoolMinor: true,
        advertiserFeeMinor: true,
      },
    });
    const filteredPrev = prevOrders.filter((o) => normalizeOrderPlatform(o.sourceWebsite) === platformKey);
    prevMetrics = calculateRawMetricsFromOrders(filteredPrev);
  }

  return {
    platformKey,
    platformName: platConfig.name,
    currency: 'USD',

    totalOrders: buildCountWithComparison(currentMetrics.totalOrders, prevMetrics ? prevMetrics.totalOrders : null),
    completedOrders: buildCountWithComparison(currentMetrics.completedOrders, prevMetrics ? prevMetrics.completedOrders : null),
    activeOrders: buildCountWithComparison(currentMetrics.activeOrders, prevMetrics ? prevMetrics.activeOrders : null),
    cancelledOrders: buildCountWithComparison(currentMetrics.cancelledOrders, prevMetrics ? prevMetrics.cancelledOrders : null),

    grossRevenue: buildMetricWithComparison(currentMetrics.grossRevenueMinor, prevMetrics ? prevMetrics.grossRevenueMinor : null),
    platformFees: buildMetricWithComparison(currentMetrics.platformFeesMinor, prevMetrics ? prevMetrics.platformFeesMinor : null),
    netRevenue: buildMetricWithComparison(currentMetrics.netRevenueMinor, prevMetrics ? prevMetrics.netRevenueMinor : null),
    boosterCosts: buildMetricWithComparison(currentMetrics.boosterCostsMinor, prevMetrics ? prevMetrics.boosterCostsMinor : null),
    advertiserCosts: buildMetricWithComparison(currentMetrics.advertiserCostsMinor, prevMetrics ? prevMetrics.advertiserCostsMinor : null),
    netProfit: buildMetricWithComparison(currentMetrics.netProfitMinor, prevMetrics ? prevMetrics.netProfitMinor : null),

    totalWithdrawalsMinor,
    formattedTotalWithdrawals: formatFinancialAmount(totalWithdrawalsMinor, 'USD'),
    pendingWithdrawalsMinor,
    formattedPendingWithdrawals: formatFinancialAmount(pendingWithdrawalsMinor, 'USD'),
    currentPlatformBalanceMinor: currentBalanceMinor,
    formattedCurrentPlatformBalance: formatFinancialAmount(currentBalanceMinor, 'USD'),
    pendingOrderValueMinor: currentMetrics.pendingOrderValueMinor,
    formattedPendingOrderValue: formatFinancialAmount(currentMetrics.pendingOrderValueMinor, 'USD'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ADVERTISER BOOSTS REPORT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export async function getAdvertiserBoostsFinancialReport(
  range: DateRangeCalculation
): Promise<AdvertiserBoostSummary> {
  // Query all current period orders
  const currentOrders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
    },
    include: {
      advertiserMetadata: true,
    },
  });

  const advertiserCurrentOrders = currentOrders.filter(isAdvertiserOrder);

  // Calculate current advertiser metrics
  let totalAdvertiserOrders = 0;
  let completedAdvertiserOrders = 0;
  let activeAdvertiserOrders = 0;
  let cancelledAdvertiserOrders = 0;

  let grossAdvertiserRevenueMinor = 0;
  let platformFeesMinor = 0;
  let boosterPayoutsMinor = 0;
  let additionalCostsMinor = 0;

  // Platform origin map
  const originMap = new Map<string, { count: number; gross: number; profit: number }>();
  for (const p of CANONICAL_PLATFORMS) {
    originMap.set(p.key, { count: 0, gross: 0, profit: 0 });
  }

  for (const o of advertiserCurrentOrders) {
    totalAdvertiserOrders++;
    const st = (o.status || '').toLowerCase().trim();
    const platKey = normalizeOrderPlatform(o.sourceWebsite);

    const orig = originMap.get(platKey) || { count: 0, gross: 0, profit: 0 };
    orig.count++;

    if (isOrderCompleted(st)) {
      completedAdvertiserOrders++;
      const gross = o.grossAmountMinor || 0;
      const fee = o.platformFeeMinor || 0;
      const booster = o.boosterPoolMinor || 0;
      const addl = o.advertiserMetadata?.additionalCostsMinor || 0;

      grossAdvertiserRevenueMinor += gross;
      platformFeesMinor += fee;
      boosterPayoutsMinor += booster;
      additionalCostsMinor += addl;

      const profit = gross - fee - booster - addl;
      orig.gross += gross;
      orig.profit += profit;
    } else if (isOrderCancelled(st)) {
      cancelledAdvertiserOrders++;
    } else {
      activeAdvertiserOrders++;
    }

    originMap.set(platKey, orig);
  }

  const advertiserPaymentMinor = grossAdvertiserRevenueMinor - platformFeesMinor;
  const netAdvertiserProfitMinor = grossAdvertiserRevenueMinor - platformFeesMinor - boosterPayoutsMinor - additionalCostsMinor;

  // Previous period comparison if applicable
  let prevTotal: number | null = null;
  let prevCompleted: number | null = null;
  let prevActive: number | null = null;
  let prevCancelled: number | null = null;
  let prevGross: number | null = null;
  let prevFee: number | null = null;
  let prevPayment: number | null = null;
  let prevBooster: number | null = null;
  let prevAddl: number | null = null;
  let prevProfit: number | null = null;

  if (range.previousStartDate && range.previousEndDate) {
    const prevOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: range.previousStartDate, lte: range.previousEndDate },
      },
      include: {
        advertiserMetadata: true,
      },
    });

    const advPrev = prevOrders.filter(isAdvertiserOrder);
    prevTotal = advPrev.length;
    prevCompleted = 0;
    prevActive = 0;
    prevCancelled = 0;
    prevGross = 0;
    prevFee = 0;
    prevBooster = 0;
    prevAddl = 0;

    for (const po of advPrev) {
      const st = (po.status || '').toLowerCase().trim();
      if (isOrderCompleted(st)) {
        prevCompleted++;
        prevGross += po.grossAmountMinor || 0;
        prevFee += po.platformFeeMinor || 0;
        prevBooster += po.boosterPoolMinor || 0;
        prevAddl += po.advertiserMetadata?.additionalCostsMinor || 0;
      } else if (isOrderCancelled(st)) {
        prevCancelled++;
      } else {
        prevActive++;
      }
    }

    prevPayment = prevGross - prevFee;
    prevProfit = prevGross - prevFee - prevBooster - prevAddl;
  }

  const originPlatformBreakdown = CANONICAL_PLATFORMS.map((p) => {
    const val = originMap.get(p.key) || { count: 0, gross: 0, profit: 0 };
    return {
      platformKey: p.key,
      platformName: p.name,
      ordersCount: val.count,
      grossRevenueMinor: val.gross,
      formattedGrossRevenue: formatFinancialAmount(val.gross, 'USD'),
      netProfitMinor: val.profit,
      formattedNetProfit: formatFinancialAmount(val.profit, 'USD'),
    };
  });

  return {
    totalAdvertiserOrders: buildCountWithComparison(totalAdvertiserOrders, prevTotal),
    completedAdvertiserOrders: buildCountWithComparison(completedAdvertiserOrders, prevCompleted),
    activeAdvertiserOrders: buildCountWithComparison(activeAdvertiserOrders, prevActive),
    cancelledAdvertiserOrders: buildCountWithComparison(cancelledAdvertiserOrders, prevCancelled),

    grossAdvertiserRevenue: buildMetricWithComparison(grossAdvertiserRevenueMinor, prevGross),
    platformFees: buildMetricWithComparison(platformFeesMinor, prevFee),
    advertiserPayment: buildMetricWithComparison(advertiserPaymentMinor, prevPayment),
    boosterPayouts: buildMetricWithComparison(boosterPayoutsMinor, prevBooster),
    additionalCosts: buildMetricWithComparison(additionalCostsMinor, prevAddl),
    netAdvertiserProfit: buildMetricWithComparison(netAdvertiserProfitMinor, prevProfit),

    originPlatformBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TIME-SERIES CHART AGGREGATIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function generateChartDataPoints(
  range: DateRangeCalculation,
  platformKey = 'all'
): Promise<ChartDataPoint[]> {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
    },
    select: {
      id: true,
      status: true,
      sourceWebsite: true,
      advertiserId: true,
      creatorType: true,
      grossAmountMinor: true,
      platformFeeMinor: true,
      boosterPoolMinor: true,
      advertiserFeeMinor: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const filtered = orders.filter((o) => {
    if (platformKey === 'all') return true;
    if (platformKey === 'advertiser') return isAdvertiserOrder(o);
    return normalizeOrderPlatform(o.sourceWebsite) === platformKey;
  });

  // Decide bucket size: daily for <= 35 days, weekly for <= 120 days, monthly otherwise
  const totalDays = Math.max(1, Math.ceil((range.endDate.getTime() - range.startDate.getTime()) / (24 * 3600 * 1000)));

  const bucketMap = new Map<string, ChartDataPoint>();

  if (totalDays <= 35) {
    // Daily buckets
    const curr = new Date(range.startDate);
    while (curr <= range.endDate) {
      const dStr = curr.toISOString().split('T')[0];
      const lbl = `${curr.getMonth() + 1}/${curr.getDate()}`;
      bucketMap.set(dStr, {
        date: dStr,
        label: lbl,
        grossRevenueMinor: 0,
        netRevenueMinor: 0,
        netProfitMinor: 0,
        boosterCostsMinor: 0,
        ordersCount: 0,
        advertiserRevenueMinor: 0,
      });
      curr.setDate(curr.getDate() + 1);
    }
  } else {
    // 10 to 15 aggregated evenly spaced intervals
    const intervalDays = Math.ceil(totalDays / 12);
    const curr = new Date(range.startDate);
    while (curr <= range.endDate) {
      const dStr = curr.toISOString().split('T')[0];
      const lbl = `${curr.getMonth() + 1}/${curr.getDate()}`;
      bucketMap.set(dStr, {
        date: dStr,
        label: lbl,
        grossRevenueMinor: 0,
        netRevenueMinor: 0,
        netProfitMinor: 0,
        boosterCostsMinor: 0,
        ordersCount: 0,
        advertiserRevenueMinor: 0,
      });
      curr.setDate(curr.getDate() + intervalDays);
    }
  }

  // Populate buckets
  const sortedBucketKeys = Array.from(bucketMap.keys()).sort();

  for (const o of filtered) {
    const oDate = o.completedAt || o.createdAt;
    const oDateStr = oDate.toISOString().split('T')[0];

    // Find closest bucket key
    let targetKey = sortedBucketKeys[0];
    for (const bk of sortedBucketKeys) {
      if (bk <= oDateStr) {
        targetKey = bk;
      } else {
        break;
      }
    }

    const b = bucketMap.get(targetKey);
    if (!b) continue;

    b.ordersCount++;
    const st = (o.status || '').toLowerCase().trim();
    if (isOrderCompleted(st)) {
      const gross = o.grossAmountMinor || 0;
      const fee = o.platformFeeMinor || 0;
      const booster = o.boosterPoolMinor || 0;
      const adv = o.advertiserFeeMinor || 0;
      const netRev = gross - fee;
      const profit = netRev - booster - adv;

      b.grossRevenueMinor += gross;
      b.netRevenueMinor += netRev;
      b.boosterCostsMinor += booster;
      b.netProfitMinor += profit;

      if (isAdvertiserOrder(o)) {
        b.advertiserRevenueMinor = (b.advertiserRevenueMinor || 0) + gross;
      }
    }
  }

  return Array.from(bucketMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CONSOLIDATED ALL-PLATFORMS REPORT (ZERO DUPLICATION GUARANTEED)
// ─────────────────────────────────────────────────────────────────────────────

export async function getConsolidatedFinancialReport(
  periodType: ReportPeriodType = 'MONTHLY',
  customFrom?: string | Date,
  customTo?: string | Date
): Promise<ConsolidatedFinancialReportResponse> {
  const range = calculateDateRanges(periodType, customFrom, customTo);

  // Generate 5 Platform reports
  const platformReports: PlatformReportSummary[] = [];
  for (const p of CANONICAL_PLATFORMS) {
    const pRep = await getPlatformFinancialReport(p.key, range);
    platformReports.push(pRep);
  }

  // Generate Dedicated Advertiser Boosts Report
  const advertiserBoosts = await getAdvertiserBoostsFinancialReport(range);

  // Generate Non-Duplicative Consolidated Summary across All Platforms
  // Summing unique order records ensures zero revenue is counted twice!
  let consolidatedTotalOrders = 0;
  let consolidatedCompletedOrders = 0;
  let consolidatedActiveOrders = 0;
  let consolidatedCancelledOrders = 0;

  let consolidatedGrossMinor = 0;
  let consolidatedPlatformFeesMinor = 0;
  let consolidatedNetRevenueMinor = 0;
  let consolidatedBoosterCostsMinor = 0;
  let consolidatedAdvertiserCostsMinor = 0;
  let consolidatedNetProfitMinor = 0;

  let consolidatedWithdrawalsMinor = 0;
  let consolidatedPendingWithdrawalsMinor = 0;
  let consolidatedCurrentBalanceMinor = 0;
  let consolidatedPendingOrderValueMinor = 0;

  let prevTotalOrders: number | null = 0;
  let prevCompletedOrders: number | null = 0;
  let prevActiveOrders: number | null = 0;
  let prevCancelledOrders: number | null = 0;
  let prevGrossMinor: number | null = 0;
  let prevFeesMinor: number | null = 0;
  let prevNetRevenueMinor: number | null = 0;
  let prevBoosterCostsMinor: number | null = 0;
  let prevAdvCostsMinor: number | null = 0;
  let prevNetProfitMinor: number | null = 0;

  let hasPrevious = range.previousStartDate !== null;

  for (const pr of platformReports) {
    consolidatedTotalOrders += pr.totalOrders.count;
    consolidatedCompletedOrders += pr.completedOrders.count;
    consolidatedActiveOrders += pr.activeOrders.count;
    consolidatedCancelledOrders += pr.cancelledOrders.count;

    consolidatedGrossMinor += pr.grossRevenue.valueMinor;
    consolidatedPlatformFeesMinor += pr.platformFees.valueMinor;
    consolidatedNetRevenueMinor += pr.netRevenue.valueMinor;
    consolidatedBoosterCostsMinor += pr.boosterCosts.valueMinor;
    consolidatedAdvertiserCostsMinor += pr.advertiserCosts.valueMinor;
    consolidatedNetProfitMinor += pr.netProfit.valueMinor;

    consolidatedWithdrawalsMinor += pr.totalWithdrawalsMinor;
    consolidatedPendingWithdrawalsMinor += pr.pendingWithdrawalsMinor;
    consolidatedCurrentBalanceMinor += pr.currentPlatformBalanceMinor;
    consolidatedPendingOrderValueMinor += pr.pendingOrderValueMinor;

    if (hasPrevious) {
      prevTotalOrders! += pr.totalOrders.previousCount || 0;
      prevCompletedOrders! += pr.completedOrders.previousCount || 0;
      prevActiveOrders! += pr.activeOrders.previousCount || 0;
      prevCancelledOrders! += pr.cancelledOrders.previousCount || 0;

      prevGrossMinor! += pr.grossRevenue.previousValueMinor || 0;
      prevFeesMinor! += pr.platformFees.previousValueMinor || 0;
      prevNetRevenueMinor! += pr.netRevenue.previousValueMinor || 0;
      prevBoosterCostsMinor! += pr.boosterCosts.previousValueMinor || 0;
      prevAdvCostsMinor! += pr.advertiserCosts.previousValueMinor || 0;
      prevNetProfitMinor! += pr.netProfit.previousValueMinor || 0;
    }
  }

  const consolidatedSummary: PlatformReportSummary = {
    platformKey: 'all',
    platformName: 'All Platforms (Consolidated)',
    currency: 'USD',

    totalOrders: buildCountWithComparison(consolidatedTotalOrders, hasPrevious ? prevTotalOrders : null),
    completedOrders: buildCountWithComparison(consolidatedCompletedOrders, hasPrevious ? prevCompletedOrders : null),
    activeOrders: buildCountWithComparison(consolidatedActiveOrders, hasPrevious ? prevActiveOrders : null),
    cancelledOrders: buildCountWithComparison(consolidatedCancelledOrders, hasPrevious ? prevCancelledOrders : null),

    grossRevenue: buildMetricWithComparison(consolidatedGrossMinor, hasPrevious ? prevGrossMinor : null),
    platformFees: buildMetricWithComparison(consolidatedPlatformFeesMinor, hasPrevious ? prevFeesMinor : null),
    netRevenue: buildMetricWithComparison(consolidatedNetRevenueMinor, hasPrevious ? prevNetRevenueMinor : null),
    boosterCosts: buildMetricWithComparison(consolidatedBoosterCostsMinor, hasPrevious ? prevBoosterCostsMinor : null),
    advertiserCosts: buildMetricWithComparison(consolidatedAdvertiserCostsMinor, hasPrevious ? prevAdvCostsMinor : null),
    netProfit: buildMetricWithComparison(consolidatedNetProfitMinor, hasPrevious ? prevNetProfitMinor : null),

    totalWithdrawalsMinor: consolidatedWithdrawalsMinor,
    formattedTotalWithdrawals: formatFinancialAmount(consolidatedWithdrawalsMinor, 'USD'),
    pendingWithdrawalsMinor: consolidatedPendingWithdrawalsMinor,
    formattedPendingWithdrawals: formatFinancialAmount(consolidatedPendingWithdrawalsMinor, 'USD'),
    currentPlatformBalanceMinor: consolidatedCurrentBalanceMinor,
    formattedCurrentPlatformBalance: formatFinancialAmount(consolidatedCurrentBalanceMinor, 'USD'),
    pendingOrderValueMinor: consolidatedPendingOrderValueMinor,
    formattedPendingOrderValue: formatFinancialAmount(consolidatedPendingOrderValueMinor, 'USD'),
  };

  // Time-series Chart
  const revenueOverTime = await generateChartDataPoints(range, 'all');

  // Platform Distribution
  const platformRevenueBreakdown: PlatformBreakdownPoint[] = platformReports.map((p) => {
    const gross = p.grossRevenue.valueMinor;
    const share = consolidatedGrossMinor > 0 ? Math.round((gross / consolidatedGrossMinor) * 1000) / 10 : 0;
    return {
      platformKey: p.platformKey,
      platformName: p.platformName,
      grossRevenueMinor: gross,
      formattedGrossRevenue: p.grossRevenue.formatted,
      netProfitMinor: p.netProfit.valueMinor,
      formattedNetProfit: p.netProfit.formatted,
      ordersCount: p.totalOrders.count,
      revenueSharePercentage: share,
    };
  });

  return {
    success: true,
    periodType,
    dateRange: {
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
      periodLabel: range.periodLabel,
      previousPeriodLabel: range.previousPeriodLabel,
    },
    summary: consolidatedSummary,
    platforms: platformReports,
    advertiserBoosts,
    charts: {
      revenueOverTime,
      platformRevenueBreakdown,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. ORDERS REPORT TABLE WITH PAGINATION & SEARCH
// ─────────────────────────────────────────────────────────────────────────────

export async function listReportOrders(params: {
  platform?: string; // all | direct | eldorado | skycoach | overgear | kingboost | advertiser
  status?: string; // all | completed | active | cancelled
  search?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}): Promise<{
  success: boolean;
  orders: ReportingOrderItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  // Date filtering
  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) where.createdAt.gte = new Date(params.startDate);
    if (params.endDate) {
      const eDate = new Date(params.endDate);
      eDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = eDate;
    }
  }

  // Status filtering
  if (params.status && params.status !== 'all') {
    if (params.status === 'completed') {
      where.status = 'completed';
    } else if (params.status === 'cancelled') {
      where.status = 'cancelled';
    } else if (params.status === 'active') {
      where.status = { notIn: ['completed', 'cancelled'] };
    }
  }

  // Search filtering
  if (params.search && params.search.trim().length > 0) {
    const q = params.search.trim();
    where.OR = [
      { orderRef: { contains: q } },
      { externalOrderId: { contains: q } },
      { title: { contains: q } },
    ];
  }

  // Fetch orders matching base filters
  const rawOrders = await prisma.order.findMany({
    where,
    include: {
      advertiser: { select: { displayName: true, username: true } },
      advertiserMetadata: true,
    },
    orderBy: { createdAt: params.sortDirection === 'asc' ? 'asc' : 'desc' },
  });

  // Filter in memory for platform / advertiser logic
  const filtered = rawOrders.filter((o) => {
    if (!params.platform || params.platform === 'all') return true;
    if (params.platform === 'advertiser') return isAdvertiserOrder(o);
    return normalizeOrderPlatform(o.sourceWebsite) === params.platform;
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const pageSlice = filtered.slice(skip, skip + limit);

  const mappedOrders: ReportingOrderItem[] = pageSlice.map((o) => {
    const pKey = normalizeOrderPlatform(o.sourceWebsite);
    const pConf = CANONICAL_PLATFORMS.find((p) => p.key === pKey);
    const isAdv = isAdvertiserOrder(o);

    const gross = o.grossAmountMinor || 0;
    const fee = o.platformFeeMinor || 0;
    const booster = o.boosterPoolMinor || 0;
    const adv = o.advertiserFeeMinor || 0;
    const addl = o.advertiserMetadata?.additionalCostsMinor || 0;
    const profit = gross - fee - booster - adv - addl;

    return {
      id: o.id,
      orderRef: o.orderRef,
      externalOrderId: o.externalOrderId || o.advertiserMetadata?.advertiserOrderId || null,
      gameSlug: o.gameSlug,
      platformKey: pKey,
      platformName: pConf ? pConf.name : pKey,
      isAdvertiserBoost: isAdv,
      advertiserId: o.advertiserId || null,
      advertiserName: o.advertiser?.displayName || o.advertiser?.username || null,
      status: o.status,
      paymentStatus: o.paymentStatus,
      currency: o.currency || 'USD',
      grossAmountMinor: gross,
      formattedGross: formatFinancialAmount(gross, 'USD'),
      platformFeeMinor: fee,
      formattedPlatformFee: formatFinancialAmount(fee, 'USD'),
      boosterCostMinor: booster,
      formattedBoosterCost: formatFinancialAmount(booster, 'USD'),
      advertiserCostMinor: adv + addl,
      formattedAdvertiserCost: formatFinancialAmount(adv + addl, 'USD'),
      netProfitMinor: profit,
      formattedNetProfit: formatFinancialAmount(profit, 'USD'),
      createdAt: o.createdAt.toISOString(),
      completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    };
  });

  return {
    success: true,
    orders: mappedOrders,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. CSV EXPORT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

export async function generateOrdersReportCsv(params: {
  platform?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<string> {
  const { orders } = await listReportOrders({
    platform: params.platform,
    status: params.status,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: 5000,
  });

  const headers = [
    'Order Ref',
    'External / Advertiser Order ID',
    'Platform',
    'Category',
    'Game',
    'Status',
    'Payment Status',
    'Gross Revenue ($)',
    'Platform Fee ($)',
    'Booster Cost ($)',
    'Advertiser Cost ($)',
    'Net Profit ($)',
    'Created Date',
    'Completed Date',
  ];

  const rows = orders.map((o) => [
    `"${o.orderRef}"`,
    `"${o.externalOrderId || ''}"`,
    `"${o.platformName}"`,
    `"${o.isAdvertiserBoost ? 'Advertiser Boost' : 'Standard Boost'}"`,
    `"${o.gameSlug}"`,
    `"${o.status}"`,
    `"${o.paymentStatus}"`,
    (o.grossAmountMinor / 100).toFixed(2),
    (o.platformFeeMinor / 100).toFixed(2),
    (o.boosterCostMinor / 100).toFixed(2),
    (o.advertiserCostMinor / 100).toFixed(2),
    (o.netProfitMinor / 100).toFixed(2),
    `"${o.createdAt}"`,
    `"${o.completedAt || ''}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}
