/**
 * src/services/financialSnapshotsAndAnalyticsService.ts — Phase 5:
 * Financial Snapshots, Advanced Analytics, Cash Flow vs. P&L, and Automated Exports.
 */

import prisma from '../database/db';
import crypto from 'crypto';
import { formatFinancialAmount } from './financialAccountService';
import {
  calculateDateRanges,
  ReportPeriodType,
  normalizeOrderPlatform,
  isAdvertiserOrder,
  isOrderCompleted,
} from './financialReportingService';
import { recordFinancialAuditLog } from './financialLedgerAndAuditService';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPES & ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export type SnapshotType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MANUAL';
export type ReportExportFormat = 'CSV' | 'XLSX' | 'PDF' | 'JSON';
export type ReportExportType =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'YEARLY'
  | 'PLATFORM'
  | 'ADVERTISER'
  | 'P_AND_L'
  | 'CASH_FLOW'
  | 'STATEMENTS'
  | 'TRANSFERS'
  | 'LEDGER';

export interface SerializedFinancialSnapshot {
  id: string;
  snapshotRef: string;
  snapshotType: SnapshotType;
  snapshotDate: string;
  capturedAt: string;
  adminId: string | null;
  adminUsername: string | null;
  notes: string | null;
  g4xDirectBalance: number;
  eldoradoBalance: number;
  skycoachBalance: number;
  overgearBalance: number;
  kingboostBalance: number;
  usdWalletBalance: number;
  tomanAccountsBalance: number;
  totalUsdAssets: number;
  totalTomanAssets: number;
  pendingWithdrawalsUsd: number;
  reservedBalancesUsd: number;
  completedOrderEarningsUsd: number;
  totalWithdrawalsUsd: number;
  totalBusinessRevenueUsd: number;
  netProfitUsd: number;
  totalBusinessExpensesUsd: number;
  formattedTotalUsdAssets: string;
  formattedTotalTomanAssets: string;
  formattedNetProfitUsd: string;
  formattedRevenueUsd: string;
  formattedExpensesUsd: string;
  payload: Record<string, any> | null;
}

export interface SnapshotComparisonResult {
  baseSnapshot: SerializedFinancialSnapshot;
  comparisonSnapshot: SerializedFinancialSnapshot;
  timeDeltaDays: number;
  deltas: {
    totalUsdAssets: number;
    totalUsdAssetsGrowthPct: number | null;
    totalTomanAssets: number;
    totalTomanAssetsGrowthPct: number | null;
    businessRevenue: number;
    businessRevenueGrowthPct: number | null;
    businessExpenses: number;
    businessExpensesGrowthPct: number | null;
    netProfit: number;
    netProfitGrowthPct: number | null;
    pendingWithdrawals: number;
    completedWithdrawals: number;
    platformBalances: {
      direct: number;
      eldorado: number;
      skycoach: number;
      overgear: number;
      kingboost: number;
    };
    usdWallet: number;
    tomanAccounts: number;
  };
}

export interface AdvancedFinancialAnalytics {
  periodType: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  revenueTrends: Array<{
    date: string;
    grossRevenueMinor: number;
    formattedGross: string;
    platformFeesMinor: number;
    formattedFees: string;
    netRevenueMinor: number;
    formattedNet: string;
  }>;
  netProfitTrends: Array<{
    date: string;
    netProfitMinor: number;
    formattedNetProfit: string;
    profitMarginPct: number;
  }>;
  platformPerformanceRanking: Array<{
    platform: string;
    rank: number;
    grossRevenueMinor: number;
    formattedGrossRevenue: string;
    orderCount: number;
    completedOrders: number;
    platformFeesMinor: number;
    boosterCostsMinor: number;
    netProfitMinor: number;
    formattedNetProfit: string;
    profitMarginPct: number;
  }>;
  advertiserBoostsProfitability: {
    totalOrders: number;
    completedOrders: number;
    grossRevenueMinor: number;
    formattedGrossRevenue: string;
    boosterPayoutsMinor: number;
    formattedBoosterPayouts: string;
    advertiserCostsMinor: number;
    netProfitMinor: number;
    formattedNetProfit: string;
    profitMarginPct: number;
  };
  withdrawalTrends: Array<{
    date: string;
    requestedCount: number;
    requestedAmountMinor: number;
    settledCount: number;
    settledAmountMinor: number;
    formattedSettledAmount: string;
  }>;
  cashFlowAnalysis: {
    operatingInflowsMinor: number;
    formattedOperatingInflows: string;
    operatingOutflowsMinor: number;
    formattedOperatingOutflows: string;
    internalTransfersVolumeMinor: number;
    formattedInternalTransfersVolume: string;
    currencyConversionVolumeMinor: number;
    formattedCurrencyConversionVolume: string;
    netCashFlowMinor: number;
    formattedNetCashFlow: string;
  };
  currencyConversionAnalysis: {
    usdToTomanTransfersCount: number;
    tomanToUsdTransfersCount: number;
    totalUsdConvertedMinor: number;
    formattedTotalUsdConverted: string;
    totalTomanConvertedMinor: number;
    formattedTotalTomanConverted: string;
    totalConversionFeesUsdMinor: number;
    formattedConversionFeesUsd: string;
    averageExchangeRate: number;
  };
  platformBalanceDistribution: Array<{
    accountName: string;
    accountRef: string;
    category: string;
    currency: string;
    currentBalanceMinor: number;
    formattedBalance: string;
    percentageOfTotalUsd: number;
  }>;
  revenueVsExpenses: {
    grossRevenueMinor: number;
    formattedGrossRevenue: string;
    totalExpensesMinor: number;
    formattedTotalExpenses: string;
    netProfitMinor: number;
    formattedNetProfit: string;
    expenseBreakdown: {
      platformFeesMinor: number;
      boosterCostsMinor: number;
      advertiserCostsMinor: number;
      otherExpensesMinor: number;
    };
  };
  monthlyFinancialGrowth: Array<{
    month: string;
    grossRevenueMinor: number;
    formattedGrossRevenue: string;
    revenueGrowthPct: number | null;
    netProfitMinor: number;
    formattedNetProfit: string;
    profitGrowthPct: number | null;
    orderCount: number;
  }>;
}

export interface ProfitAndLossReportData {
  periodType: string;
  startDate: string;
  endDate: string;
  grossRevenueMinor: number;
  formattedGrossRevenue: string;
  platformFeesMinor: number;
  formattedPlatformFees: string;
  boosterCostsMinor: number;
  formattedBoosterCosts: string;
  advertiserCostsMinor: number;
  formattedAdvertiserCosts: string;
  otherExpensesMinor: number;
  formattedOtherExpenses: string;
  totalExpensesMinor: number;
  formattedTotalExpenses: string;
  netOperatingProfitMinor: number;
  formattedNetOperatingProfit: string;
  profitMarginPercentage: number;
  ordersCount: number;
}

export interface CashFlowReportData {
  periodType: string;
  startDate: string;
  endDate: string;
  operatingInflowsMinor: number;
  formattedOperatingInflows: string;
  operatingOutflowsMinor: number;
  formattedOperatingOutflows: string;
  internalTransfersCount: number;
  internalTransfersVolumeMinor: number;
  formattedInternalTransfersVolume: string;
  currencyConversionsCount: number;
  currencyConversionsVolumeMinor: number;
  formattedCurrencyConversionsVolume: string;
  operatingPaymentsMinor: number;
  formattedOperatingPayments: string;
  netCashFlowMinor: number;
  formattedNetCashFlow: string;
  accountingRulesVerified: {
    transfersExcludedFromRevenueAndExpenses: boolean;
    withdrawalsExcludedFromSalesRevenue: boolean;
  };
}

export interface SerializedAutomatedSchedule {
  id: string;
  scheduleRef: string;
  name: string;
  reportType: string;
  frequency: string;
  cronExpression: string;
  format: string;
  targetPlatform: string | null;
  recipientEmails: string | null;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedGeneratedReport {
  id: string;
  reportRef: string;
  title: string;
  reportType: string;
  periodType: string;
  startDate: string;
  endDate: string;
  format: string;
  fileSizeBytes: number;
  scheduleId: string | null;
  generatedById: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SERIALIZATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function serializeFinancialSnapshot(s: any): SerializedFinancialSnapshot {
  const g4xDirect = Number(s.g4xDirectBalance || 0);
  const eldorado = Number(s.eldoradoBalance || 0);
  const skycoach = Number(s.skycoachBalance || 0);
  const overgear = Number(s.overgearBalance || 0);
  const kingboost = Number(s.kingboostBalance || 0);
  const usdWallet = Number(s.usdWalletBalance || 0);
  const tomanAccounts = Number(s.tomanAccountsBalance || 0);

  const totalUsd = Number(s.totalUsdAssets || 0);
  const totalToman = Number(s.totalTomanAssets || 0);
  const pendingWith = Number(s.pendingWithdrawalsUsd || 0);
  const reservedBal = Number(s.reservedBalancesUsd || 0);
  const completedEarnings = Number(s.completedOrderEarningsUsd || 0);
  const totalWith = Number(s.totalWithdrawalsUsd || 0);
  const totalRev = Number(s.totalBusinessRevenueUsd || 0);
  const netProfit = Number(s.netProfitUsd || 0);
  const totalExp = Number(s.totalBusinessExpensesUsd || 0);

  let parsedPayload: Record<string, any> | null = null;
  if (s.payload) {
    try {
      parsedPayload = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload;
    } catch {
      parsedPayload = null;
    }
  }

  return {
    id: s.id,
    snapshotRef: s.snapshotRef,
    snapshotType: s.snapshotType as SnapshotType,
    snapshotDate: s.snapshotDate instanceof Date ? s.snapshotDate.toISOString() : String(s.snapshotDate),
    capturedAt: s.capturedAt instanceof Date ? s.capturedAt.toISOString() : String(s.capturedAt),
    adminId: s.adminId || null,
    adminUsername: s.admin?.username || null,
    notes: s.notes || null,
    g4xDirectBalance: g4xDirect,
    eldoradoBalance: eldorado,
    skycoachBalance: skycoach,
    overgearBalance: overgear,
    kingboostBalance: kingboost,
    usdWalletBalance: usdWallet,
    tomanAccountsBalance: tomanAccounts,
    totalUsdAssets: totalUsd,
    totalTomanAssets: totalToman,
    pendingWithdrawalsUsd: pendingWith,
    reservedBalancesUsd: reservedBal,
    completedOrderEarningsUsd: completedEarnings,
    totalWithdrawalsUsd: totalWith,
    totalBusinessRevenueUsd: totalRev,
    netProfitUsd: netProfit,
    totalBusinessExpensesUsd: totalExp,
    formattedTotalUsdAssets: formatFinancialAmount(totalUsd, 'USD'),
    formattedTotalTomanAssets: formatFinancialAmount(totalToman, 'IRR'),
    formattedNetProfitUsd: formatFinancialAmount(netProfit, 'USD'),
    formattedRevenueUsd: formatFinancialAmount(totalRev, 'USD'),
    formattedExpensesUsd: formatFinancialAmount(totalExp, 'USD'),
    payload: parsedPayload,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MODULE 1: FINANCIAL SNAPSHOTS CAPTURE & QUERY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture an authoritative, immutable financial snapshot.
 */
export async function captureFinancialSnapshot(options?: {
  snapshotType?: SnapshotType;
  date?: Date;
  adminId?: string;
  notes?: string;
}): Promise<SerializedFinancialSnapshot> {
  const snapshotType: SnapshotType = options?.snapshotType || 'MANUAL';
  const snapshotDate = options?.date ? new Date(options.date) : new Date();

  // 1. Fetch current balances for the 5 platform accounts
  const accounts = await prisma.financialAccount.findMany({
    where: { status: 'ACTIVE' },
  });

  const getBalance = (accountRef: string): bigint => {
    const acc = accounts.find((a) => a.accountRef === accountRef);
    return acc ? acc.currentBalance : BigInt(0);
  };

  const g4xDirectBal = getBalance('g4x_direct');
  const eldoradoBal = getBalance('eldorado_main');
  const skycoachBal = getBalance('skycoach_main');
  const overgearBal = getBalance('overgear_main');
  const kingboostBal = getBalance('kingboost_main');
  const usdWalletBal = getBalance('wallet_usd_treasury');

  // Sum all local Toman accounts (wallet + bank + cash)
  const tomanBal = accounts
    .filter((a) => a.currency === 'IRR')
    .reduce((sum, a) => sum + a.currentBalance, BigInt(0));

  // Total USD Assets = sum of 5 platforms + USD Wallet
  const totalUsdAssets =
    g4xDirectBal + eldoradoBal + skycoachBal + overgearBal + kingboostBal + usdWalletBal;

  // Reserved balances USD
  const reservedBalancesUsd = accounts
    .filter((a) => a.currency === 'USD')
    .reduce((sum, a) => sum + a.reservedBalance, BigInt(0));

  // 2. Fetch withdrawal metrics from PlatformWithdrawal table
  const withdrawals = await prisma.platformWithdrawal.findMany({
    select: {
      status: true,
      amount: true,
      fee: true,
      netAmount: true,
      currency: true,
    },
  });

  const pendingWithdrawalsUsd = withdrawals
    .filter((w) => ['PENDING', 'PROCESSING'].includes(w.status) && w.currency === 'USD')
    .reduce((sum, w) => sum + w.amount, BigInt(0));

  const totalWithdrawalsUsd = withdrawals
    .filter((w) => w.status === 'COMPLETED' && w.currency === 'USD')
    .reduce((sum, w) => sum + w.amount, BigInt(0));

  // 3. Fetch completed orders metrics for revenue & net profit
  const completedOrders = await prisma.order.findMany({
    where: {
      status: { in: ['completed', 'settled', 'closed', 'confirmed', 'warranty', 'resolved'] },
    },
    select: {
      grossAmountMinor: true,
      platformFeeMinor: true,
      boosterPoolMinor: true,
      advertiserFeeMinor: true,
      sourceWebsite: true,
      creatorType: true,
      advertiserId: true,
    },
  });

  let totalRevMinor = BigInt(0);
  let boosterCostsMinor = BigInt(0);
  let platformFeesMinor = BigInt(0);
  let advertiserCostsMinor = BigInt(0);

  for (const ord of completedOrders) {
    const gross = BigInt(ord.grossAmountMinor || 0);
    const booster = BigInt(ord.boosterPoolMinor || 0);
    const fee = BigInt(ord.platformFeeMinor || 0);
    const adv = BigInt(ord.advertiserFeeMinor || 0);

    totalRevMinor += gross;
    boosterCostsMinor += booster;
    platformFeesMinor += fee;
    advertiserCostsMinor += adv;
  }

  const totalExpensesMinor = boosterCostsMinor + platformFeesMinor + advertiserCostsMinor;
  const netProfitMinor = totalRevMinor - totalExpensesMinor;

  // 4. Construct payload snapshot breakdown
  const payload = {
    platforms: {
      direct: Number(g4xDirectBal),
      eldorado: Number(eldoradoBal),
      skycoach: Number(skycoachBal),
      overgear: Number(overgearBal),
      kingboost: Number(kingboostBal),
    },
    usdWallet: Number(usdWalletBal),
    tomanAccounts: Number(tomanBal),
    activeAccountsCount: accounts.length,
    completedOrdersCount: completedOrders.length,
    boosterCostsUsd: Number(boosterCostsMinor),
    platformFeesUsd: Number(platformFeesMinor),
    advertiserCostsUsd: Number(advertiserCostsMinor),
  };

  const dateTag = snapshotDate.toISOString().slice(0, 10).replace(/-/g, '');
  const snapshotRef = `SNP-${dateTag}-${snapshotType.slice(0, 3)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created = await prisma.financialSnapshot.create({
    data: {
      snapshotRef,
      snapshotType,
      snapshotDate,
      capturedAt: new Date(),
      adminId: options?.adminId || null,
      notes: options?.notes || `Snapshot captured automatically (${snapshotType})`,
      g4xDirectBalance: g4xDirectBal,
      eldoradoBalance: eldoradoBal,
      skycoachBalance: skycoachBal,
      overgearBalance: overgearBal,
      kingboostBalance: kingboostBal,
      usdWalletBalance: usdWalletBal,
      tomanAccountsBalance: tomanBal,
      totalUsdAssets,
      totalTomanAssets: tomanBal,
      pendingWithdrawalsUsd,
      reservedBalancesUsd,
      completedOrderEarningsUsd: boosterCostsMinor,
      totalWithdrawalsUsd,
      totalBusinessRevenueUsd: totalRevMinor,
      netProfitUsd: netProfitMinor,
      totalBusinessExpensesUsd: totalExpensesMinor,
      payload: JSON.stringify(payload),
    },
    include: {
      admin: { select: { username: true } },
    },
  });

  // Append audit trail
  await recordFinancialAuditLog({
    adminId: options?.adminId || null,
    actionType: 'ACCOUNT_UPDATED',
    reason: `Captured ${snapshotType} financial snapshot (${snapshotRef})`,
    newState: {
      snapshotRef,
      snapshotType,
      totalUsdAssets: Number(totalUsdAssets),
      totalTomanAssets: Number(tomanBal),
      netProfitUsd: Number(netProfitMinor),
    },
  });

  return serializeFinancialSnapshot(created);
}

/**
 * List historical financial snapshots with filtering and pagination.
 */
export async function listFinancialSnapshots(params?: {
  snapshotType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  snapshots: SerializedFinancialSnapshot[];
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params?.snapshotType && params.snapshotType !== 'all') {
    where.snapshotType = params.snapshotType.toUpperCase();
  }
  if (params?.startDate || params?.endDate) {
    where.snapshotDate = {};
    if (params.startDate) where.snapshotDate.gte = new Date(params.startDate);
    if (params.endDate) where.snapshotDate.lte = new Date(params.endDate);
  }

  const [total, records] = await Promise.all([
    prisma.financialSnapshot.count({ where }),
    prisma.financialSnapshot.findMany({
      where,
      include: {
        admin: { select: { username: true } },
      },
      orderBy: { snapshotDate: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    snapshots: records.map(serializeFinancialSnapshot),
  };
}

/**
 * Fetch a single snapshot by ID or snapshotRef.
 */
export async function getFinancialSnapshotById(
  idOrRef: string
): Promise<SerializedFinancialSnapshot> {
  const s = await prisma.financialSnapshot.findFirst({
    where: {
      OR: [{ id: idOrRef }, { snapshotRef: idOrRef }],
    },
    include: {
      admin: { select: { username: true } },
    },
  });

  if (!s) {
    throw new Error(`NOT_FOUND: Financial snapshot '${idOrRef}' not found`);
  }

  return serializeFinancialSnapshot(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MODULE 2: HISTORICAL FINANCIAL COMPARISON ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export async function compareHistoricalSnapshots(
  baseSnapshotId: string,
  comparisonSnapshotId: string
): Promise<SnapshotComparisonResult> {
  const [base, comp] = await Promise.all([
    getFinancialSnapshotById(baseSnapshotId),
    getFinancialSnapshotById(comparisonSnapshotId),
  ]);

  const calcGrowth = (prev: number, curr: number): number | null => {
    if (prev === 0) return curr === 0 ? 0 : 100;
    return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1));
  };

  const baseDate = new Date(base.snapshotDate);
  const compDate = new Date(comp.snapshotDate);
  const timeDeltaDays = Math.round(
    Math.abs(compDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    baseSnapshot: base,
    comparisonSnapshot: comp,
    timeDeltaDays,
    deltas: {
      totalUsdAssets: comp.totalUsdAssets - base.totalUsdAssets,
      totalUsdAssetsGrowthPct: calcGrowth(base.totalUsdAssets, comp.totalUsdAssets),
      totalTomanAssets: comp.totalTomanAssets - base.totalTomanAssets,
      totalTomanAssetsGrowthPct: calcGrowth(base.totalTomanAssets, comp.totalTomanAssets),
      businessRevenue: comp.totalBusinessRevenueUsd - base.totalBusinessRevenueUsd,
      businessRevenueGrowthPct: calcGrowth(base.totalBusinessRevenueUsd, comp.totalBusinessRevenueUsd),
      businessExpenses: comp.totalBusinessExpensesUsd - base.totalBusinessExpensesUsd,
      businessExpensesGrowthPct: calcGrowth(base.totalBusinessExpensesUsd, comp.totalBusinessExpensesUsd),
      netProfit: comp.netProfitUsd - base.netProfitUsd,
      netProfitGrowthPct: calcGrowth(base.netProfitUsd, comp.netProfitUsd),
      pendingWithdrawals: comp.pendingWithdrawalsUsd - base.pendingWithdrawalsUsd,
      completedWithdrawals: comp.totalWithdrawalsUsd - base.totalWithdrawalsUsd,
      platformBalances: {
        direct: comp.g4xDirectBalance - base.g4xDirectBalance,
        eldorado: comp.eldoradoBalance - base.eldoradoBalance,
        skycoach: comp.skycoachBalance - base.skycoachBalance,
        overgear: comp.overgearBalance - base.overgearBalance,
        kingboost: comp.kingboostBalance - base.kingboostBalance,
      },
      usdWallet: comp.usdWalletBalance - base.usdWalletBalance,
      tomanAccounts: comp.tomanAccountsBalance - base.tomanAccountsBalance,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. MODULE 3: ADVANCED FINANCIAL ANALYTICS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export async function getAdvancedFinancialAnalytics(params?: {
  periodType?: ReportPeriodType;
  startDate?: string;
  endDate?: string;
  platform?: string;
}): Promise<AdvancedFinancialAnalytics> {
  const normPeriodType: ReportPeriodType = (params?.periodType?.toUpperCase() || 'MONTHLY') as ReportPeriodType;
  const dateRanges = calculateDateRanges(
    normPeriodType,
    params?.startDate,
    params?.endDate
  );
  const currentStart = dateRanges.startDate;
  const currentEnd = dateRanges.endDate;

  const orderWhere: any = {
    createdAt: { gte: currentStart, lte: currentEnd },
  };

  // 1. Fetch Orders for the period
  let orders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true,
      orderRef: true,
      status: true,
      sourceWebsite: true,
      creatorType: true,
      advertiserId: true,
      grossAmountMinor: true,
      platformFeeMinor: true,
      boosterPoolMinor: true,
      advertiserFeeMinor: true,
      createdAt: true,
      completedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (params?.platform && params.platform !== 'all') {
    const targetPlat = params.platform.toLowerCase();
    orders = orders.filter((o) => normalizeOrderPlatform(o.sourceWebsite) === targetPlat);
  }

  // 2. Fetch Transfers & Conversions for the period
  const transfers = await prisma.internalTransfer.findMany({
    where: {
      createdAt: { gte: currentStart, lte: currentEnd },
      status: 'COMPLETED',
    },
    select: {
      transferType: true,
      sourceAmount: true,
      sourceCurrency: true,
      destinationAmount: true,
      destinationCurrency: true,
      feeAmount: true,
      exchangeRate: true,
      createdAt: true,
    },
  });

  // 3. Fetch Withdrawals for the period
  const withdrawals = await prisma.platformWithdrawal.findMany({
    where: {
      createdAt: { gte: currentStart, lte: currentEnd },
    },
    select: {
      status: true,
      amount: true,
      currency: true,
      createdAt: true,
      processedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // 4. Fetch Active Accounts for Distribution
  const accounts = await prisma.financialAccount.findMany({
    where: { status: 'ACTIVE' },
    select: {
      accountRef: true,
      name: true,
      category: true,
      currency: true,
      currentBalance: true,
    },
  });

  // ─── A. Revenue Trends & Net Profit Trends ─────────────────────────────────
  const trendBuckets: Record<
    string,
    { gross: number; fees: number; net: number; booster: number }
  > = {};

  for (const ord of orders) {
    if (!isOrderCompleted(ord.status)) continue;
    const day = ord.completedAt
      ? ord.completedAt.toISOString().slice(0, 10)
      : ord.createdAt.toISOString().slice(0, 10);

    if (!trendBuckets[day]) {
      trendBuckets[day] = { gross: 0, fees: 0, net: 0, booster: 0 };
    }
    const gross = ord.grossAmountMinor || 0;
    const fee = ord.platformFeeMinor || 0;
    const booster = ord.boosterPoolMinor || 0;

    trendBuckets[day].gross += gross;
    trendBuckets[day].fees += fee;
    trendBuckets[day].net += gross - fee;
    trendBuckets[day].booster += booster;
  }

  const sortedDays = Object.keys(trendBuckets).sort();
  const revenueTrends = sortedDays.map((d) => ({
    date: d,
    grossRevenueMinor: trendBuckets[d].gross,
    formattedGross: formatFinancialAmount(trendBuckets[d].gross, 'USD'),
    platformFeesMinor: trendBuckets[d].fees,
    formattedFees: formatFinancialAmount(trendBuckets[d].fees, 'USD'),
    netRevenueMinor: trendBuckets[d].net,
    formattedNet: formatFinancialAmount(trendBuckets[d].net, 'USD'),
  }));

  const netProfitTrends = sortedDays.map((d) => {
    const profit = trendBuckets[d].gross - trendBuckets[d].fees - trendBuckets[d].booster;
    const margin = trendBuckets[d].gross > 0 ? (profit / trendBuckets[d].gross) * 100 : 0;
    return {
      date: d,
      netProfitMinor: profit,
      formattedNetProfit: formatFinancialAmount(profit, 'USD'),
      profitMarginPct: Number(margin.toFixed(1)),
    };
  });

  // ─── B. Platform Performance Ranking ──────────────────────────────────────
  const platformStats: Record<
    string,
    { gross: number; orders: number; completed: number; fees: number; booster: number }
  > = {
    direct: { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 },
    eldorado: { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 },
    skycoach: { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 },
    overgear: { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 },
    kingboost: { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 },
  };

  for (const ord of orders) {
    const p = normalizeOrderPlatform(ord.sourceWebsite);
    if (!platformStats[p]) {
      platformStats[p] = { gross: 0, orders: 0, completed: 0, fees: 0, booster: 0 };
    }
    platformStats[p].orders++;
    if (isOrderCompleted(ord.status)) {
      platformStats[p].completed++;
      const gross = ord.grossAmountMinor || 0;
      const fee = ord.platformFeeMinor || 0;
      const booster = ord.boosterPoolMinor || 0;
      platformStats[p].gross += gross;
      platformStats[p].fees += fee;
      platformStats[p].booster += booster;
    }
  }

  const platformPerformanceRanking = Object.entries(platformStats)
    .map(([platform, data]) => {
      const netProfit = data.gross - data.fees - data.booster;
      const margin = data.gross > 0 ? (netProfit / data.gross) * 100 : 0;
      return {
        platform,
        rank: 0,
        grossRevenueMinor: data.gross,
        formattedGrossRevenue: formatFinancialAmount(data.gross, 'USD'),
        orderCount: data.orders,
        completedOrders: data.completed,
        platformFeesMinor: data.fees,
        boosterCostsMinor: data.booster,
        netProfitMinor: netProfit,
        formattedNetProfit: formatFinancialAmount(netProfit, 'USD'),
        profitMarginPct: Number(margin.toFixed(1)),
      };
    })
    .sort((a, b) => b.grossRevenueMinor - a.grossRevenueMinor)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  // ─── C. Advertiser Boosts Profitability ────────────────────────────────────
  const advOrders = orders.filter((o) => isAdvertiserOrder(o));
  let advGross = 0;
  let advBooster = 0;
  let advFees = 0;
  let advCompleted = 0;

  for (const ord of advOrders) {
    if (isOrderCompleted(ord.status)) {
      advCompleted++;
      advGross += ord.grossAmountMinor || 0;
      advBooster += ord.boosterPoolMinor || 0;
      advFees += ord.advertiserFeeMinor || 0;
    }
  }
  const advNetProfit = advGross - advBooster - advFees;
  const advMargin = advGross > 0 ? (advNetProfit / advGross) * 100 : 0;

  const advertiserBoostsProfitability = {
    totalOrders: advOrders.length,
    completedOrders: advCompleted,
    grossRevenueMinor: advGross,
    formattedGrossRevenue: formatFinancialAmount(advGross, 'USD'),
    boosterPayoutsMinor: advBooster,
    formattedBoosterPayouts: formatFinancialAmount(advBooster, 'USD'),
    advertiserCostsMinor: advFees,
    netProfitMinor: advNetProfit,
    formattedNetProfit: formatFinancialAmount(advNetProfit, 'USD'),
    profitMarginPct: Number(advMargin.toFixed(1)),
  };

  // ─── D. Withdrawal Trends ─────────────────────────────────────────────────
  const withdrawalBuckets: Record<string, { reqCount: number; reqAmt: number; setlCount: number; setlAmt: number }> = {};
  for (const w of withdrawals) {
    const day = w.createdAt.toISOString().slice(0, 10);
    if (!withdrawalBuckets[day]) {
      withdrawalBuckets[day] = { reqCount: 0, reqAmt: 0, setlCount: 0, setlAmt: 0 };
    }
    const amt = Number(w.amount);
    withdrawalBuckets[day].reqCount++;
    withdrawalBuckets[day].reqAmt += amt;
    if (w.status === 'COMPLETED') {
      withdrawalBuckets[day].setlCount++;
      withdrawalBuckets[day].setlAmt += amt;
    }
  }

  const withdrawalTrends = Object.keys(withdrawalBuckets).sort().map((d) => ({
    date: d,
    requestedCount: withdrawalBuckets[d].reqCount,
    requestedAmountMinor: withdrawalBuckets[d].reqAmt,
    settledCount: withdrawalBuckets[d].setlCount,
    settledAmountMinor: withdrawalBuckets[d].setlAmt,
    formattedSettledAmount: formatFinancialAmount(withdrawalBuckets[d].setlAmt, 'USD'),
  }));

  // ─── E. Cash Flow Analysis ────────────────────────────────────────────────
  const operatingInflows = orders
    .filter((o) => isOrderCompleted(o.status))
    .reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0);

  const operatingOutflows = withdrawals
    .filter((w) => w.status === 'COMPLETED')
    .reduce((sum, w) => sum + Number(w.amount), 0);

  const internalTransfersVolume = transfers
    .filter((t) => t.transferType === 'SAME_CURRENCY')
    .reduce((sum, t) => sum + Number(t.sourceAmount), 0);

  const currencyConversionVolume = transfers
    .filter((t) => t.transferType === 'CURRENCY_CONVERSION')
    .reduce((sum, t) => sum + Number(t.sourceAmount), 0);

  const netCashFlow = operatingInflows - operatingOutflows;

  const cashFlowAnalysis = {
    operatingInflowsMinor: operatingInflows,
    formattedOperatingInflows: formatFinancialAmount(operatingInflows, 'USD'),
    operatingOutflowsMinor: operatingOutflows,
    formattedOperatingOutflows: formatFinancialAmount(operatingOutflows, 'USD'),
    internalTransfersVolumeMinor: internalTransfersVolume,
    formattedInternalTransfersVolume: formatFinancialAmount(internalTransfersVolume, 'USD'),
    currencyConversionVolumeMinor: currencyConversionVolume,
    formattedCurrencyConversionVolume: formatFinancialAmount(currencyConversionVolume, 'USD'),
    netCashFlowMinor: netCashFlow,
    formattedNetCashFlow: formatFinancialAmount(netCashFlow, 'USD'),
  };

  // ─── F. Currency Conversion Analysis ──────────────────────────────────────
  let u2tCount = 0;
  let t2uCount = 0;
  let u2tUsd = 0;
  let t2uToman = 0;
  let convFeesUsd = 0;
  let rateSum = 0;

  for (const t of transfers) {
    if (t.transferType !== 'CURRENCY_CONVERSION') continue;
    if (t.sourceCurrency === 'USD') {
      u2tCount++;
      u2tUsd += Number(t.sourceAmount);
    } else {
      t2uCount++;
      t2uToman += Number(t.sourceAmount);
    }
    convFeesUsd += Number(t.feeAmount);
    if (t.exchangeRate) rateSum += t.exchangeRate;
  }

  const totalConversions = u2tCount + t2uCount;
  const avgRate = totalConversions > 0 ? Math.round(rateSum / totalConversions) : 90000;

  const currencyConversionAnalysis = {
    usdToTomanTransfersCount: u2tCount,
    tomanToUsdTransfersCount: t2uCount,
    totalUsdConvertedMinor: u2tUsd,
    formattedTotalUsdConverted: formatFinancialAmount(u2tUsd, 'USD'),
    totalTomanConvertedMinor: t2uToman,
    formattedTotalTomanConverted: formatFinancialAmount(t2uToman, 'IRR'),
    totalConversionFeesUsdMinor: convFeesUsd,
    formattedConversionFeesUsd: formatFinancialAmount(convFeesUsd, 'USD'),
    averageExchangeRate: avgRate,
  };

  // ─── G. Platform Balance Distribution ─────────────────────────────────────
  const totalUsdLiquidity = accounts
    .filter((a) => a.currency === 'USD')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const platformBalanceDistribution = accounts.map((a) => {
    const bal = Number(a.currentBalance);
    const pct = a.currency === 'USD' && totalUsdLiquidity > 0 ? (bal / totalUsdLiquidity) * 100 : 0;
    return {
      accountName: a.name,
      accountRef: a.accountRef,
      category: a.category,
      currency: a.currency,
      currentBalanceMinor: bal,
      formattedBalance: formatFinancialAmount(bal, a.currency),
      percentageOfTotalUsd: Number(pct.toFixed(1)),
    };
  });

  // ─── H. Revenue vs. Expenses ──────────────────────────────────────────────
  let totalGrossAll = 0;
  let feesAll = 0;
  let boosterAll = 0;
  let advAll = 0;

  for (const ord of orders) {
    if (isOrderCompleted(ord.status)) {
      totalGrossAll += ord.grossAmountMinor || 0;
      feesAll += ord.platformFeeMinor || 0;
      boosterAll += ord.boosterPoolMinor || 0;
      advAll += ord.advertiserFeeMinor || 0;
    }
  }

  const totalExpAll = feesAll + boosterAll + advAll;
  const netProfitAll = totalGrossAll - totalExpAll;

  const revenueVsExpenses = {
    grossRevenueMinor: totalGrossAll,
    formattedGrossRevenue: formatFinancialAmount(totalGrossAll, 'USD'),
    totalExpensesMinor: totalExpAll,
    formattedTotalExpenses: formatFinancialAmount(totalExpAll, 'USD'),
    netProfitMinor: netProfitAll,
    formattedNetProfit: formatFinancialAmount(netProfitAll, 'USD'),
    expenseBreakdown: {
      platformFeesMinor: feesAll,
      boosterCostsMinor: boosterAll,
      advertiserCostsMinor: advAll,
      otherExpensesMinor: 0,
    },
  };

  // ─── I. Monthly Financial Growth ──────────────────────────────────────────
  const monthBuckets: Record<string, { gross: number; profit: number; count: number }> = {};
  for (const ord of orders) {
    const month = ord.createdAt.toISOString().slice(0, 7); // YYYY-MM
    if (!monthBuckets[month]) {
      monthBuckets[month] = { gross: 0, profit: 0, count: 0 };
    }
    monthBuckets[month].count++;
    if (isOrderCompleted(ord.status)) {
      const g = ord.grossAmountMinor || 0;
      const f = ord.platformFeeMinor || 0;
      const b = ord.boosterPoolMinor || 0;
      monthBuckets[month].gross += g;
      monthBuckets[month].profit += g - f - b;
    }
  }

  const sortedMonths = Object.keys(monthBuckets).sort();
  const monthlyFinancialGrowth = sortedMonths.map((m, idx) => {
    const currGross = monthBuckets[m].gross;
    const currProfit = monthBuckets[m].profit;
    const prevMonth = idx > 0 ? sortedMonths[idx - 1] : null;

    let revGrowth: number | null = null;
    let profGrowth: number | null = null;

    if (prevMonth && monthBuckets[prevMonth]) {
      const prevGross = monthBuckets[prevMonth].gross;
      const prevProf = monthBuckets[prevMonth].profit;
      revGrowth = prevGross > 0 ? Number((((currGross - prevGross) / prevGross) * 100).toFixed(1)) : null;
      profGrowth = prevProf > 0 ? Number((((currProfit - prevProf) / prevProf) * 100).toFixed(1)) : null;
    }

    return {
      month: m,
      grossRevenueMinor: currGross,
      formattedGrossRevenue: formatFinancialAmount(currGross, 'USD'),
      revenueGrowthPct: revGrowth,
      netProfitMinor: currProfit,
      formattedNetProfit: formatFinancialAmount(currProfit, 'USD'),
      profitGrowthPct: profGrowth,
      orderCount: monthBuckets[m].count,
    };
  });

  return {
    periodType: normPeriodType,
    startDate: currentStart.toISOString(),
    endDate: currentEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    revenueTrends,
    netProfitTrends,
    platformPerformanceRanking,
    advertiserBoostsProfitability,
    withdrawalTrends,
    cashFlowAnalysis,
    currencyConversionAnalysis,
    platformBalanceDistribution,
    revenueVsExpenses,
    monthlyFinancialGrowth,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MODULE 4: SEPARATE P&L AND CASH FLOW REPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate dedicated Profit & Loss (P&L) Report.
 */
export async function getProfitAndLossReport(params?: {
  periodType?: ReportPeriodType;
  startDate?: string;
  endDate?: string;
  platform?: string;
}): Promise<ProfitAndLossReportData> {
  const normPeriodType: ReportPeriodType = (params?.periodType?.toUpperCase() || 'MONTHLY') as ReportPeriodType;
  const dateRanges = calculateDateRanges(
    normPeriodType,
    params?.startDate,
    params?.endDate
  );
  const currentStart = dateRanges.startDate;
  const currentEnd = dateRanges.endDate;

  const where: any = {
    createdAt: { gte: currentStart, lte: currentEnd },
    status: { in: ['completed', 'settled', 'closed', 'confirmed', 'warranty', 'resolved'] },
  };

  let completedOrders = await prisma.order.findMany({
    where,
    select: {
      sourceWebsite: true,
      grossAmountMinor: true,
      platformFeeMinor: true,
      boosterPoolMinor: true,
      advertiserFeeMinor: true,
    },
  });

  if (params?.platform && params.platform !== 'all') {
    const targetPlat = params.platform.toLowerCase();
    completedOrders = completedOrders.filter((o) => normalizeOrderPlatform(o.sourceWebsite) === targetPlat);
  }

  let gross = 0;
  let pFees = 0;
  let bCosts = 0;
  let aCosts = 0;

  for (const o of completedOrders) {
    gross += o.grossAmountMinor || 0;
    pFees += o.platformFeeMinor || 0;
    bCosts += o.boosterPoolMinor || 0;
    aCosts += o.advertiserFeeMinor || 0;
  }

  const otherExpenses = 0;
  const totalExpenses = pFees + bCosts + aCosts + otherExpenses;
  const netOperatingProfit = gross - totalExpenses;
  const margin = gross > 0 ? (netOperatingProfit / gross) * 100 : 0;

  return {
    periodType: normPeriodType,
    startDate: currentStart.toISOString(),
    endDate: currentEnd.toISOString(),
    grossRevenueMinor: gross,
    formattedGrossRevenue: formatFinancialAmount(gross, 'USD'),
    platformFeesMinor: pFees,
    formattedPlatformFees: formatFinancialAmount(pFees, 'USD'),
    boosterCostsMinor: bCosts,
    formattedBoosterCosts: formatFinancialAmount(bCosts, 'USD'),
    advertiserCostsMinor: aCosts,
    formattedAdvertiserCosts: formatFinancialAmount(aCosts, 'USD'),
    otherExpensesMinor: otherExpenses,
    formattedOtherExpenses: formatFinancialAmount(otherExpenses, 'USD'),
    totalExpensesMinor: totalExpenses,
    formattedTotalExpenses: formatFinancialAmount(totalExpenses, 'USD'),
    netOperatingProfitMinor: netOperatingProfit,
    formattedNetOperatingProfit: formatFinancialAmount(netOperatingProfit, 'USD'),
    profitMarginPercentage: Number(margin.toFixed(1)),
    ordersCount: completedOrders.length,
  };
}

/**
 * Generate dedicated Cash Flow Statement.
 * Strictly guarantees:
 * 1. Internal transfers are NOT treated as business revenue or expenses.
 * 2. Withdrawals are NOT counted as new revenue.
 */
export async function getCashFlowReport(params?: {
  periodType?: ReportPeriodType;
  startDate?: string;
  endDate?: string;
}): Promise<CashFlowReportData> {
  const normPeriodType: ReportPeriodType = (params?.periodType?.toUpperCase() || 'MONTHLY') as ReportPeriodType;
  const dateRanges = calculateDateRanges(
    normPeriodType,
    params?.startDate,
    params?.endDate
  );
  const currentStart = dateRanges.startDate;
  const currentEnd = dateRanges.endDate;

  // 1. Operating Cash Inflows (completed order customer collections)
  const completedOrders = await prisma.order.findMany({
    where: {
      createdAt: { gte: currentStart, lte: currentEnd },
      status: { in: ['completed', 'settled', 'closed', 'confirmed', 'warranty', 'resolved'] },
    },
    select: { grossAmountMinor: true },
  });

  const operatingInflows = completedOrders.reduce(
    (sum, o) => sum + (o.grossAmountMinor || 0),
    0
  );

  // 2. Operating Cash Outflows (settled withdrawals)
  const settledWithdrawals = await prisma.platformWithdrawal.findMany({
    where: {
      status: 'COMPLETED',
      updatedAt: { gte: currentStart, lte: currentEnd },
    },
    select: { amount: true },
  });

  const operatingOutflows = settledWithdrawals.reduce(
    (sum, w) => sum + Number(w.amount),
    0
  );

  // 3. Internal Transfers
  const transfers = await prisma.internalTransfer.findMany({
    where: {
      createdAt: { gte: currentStart, lte: currentEnd },
      status: 'COMPLETED',
    },
    select: {
      transferType: true,
      sourceAmount: true,
    },
  });

  const sameCurrencyTransfers = transfers.filter((t) => t.transferType === 'SAME_CURRENCY');
  const conversionTransfers = transfers.filter((t) => t.transferType === 'CURRENCY_CONVERSION');

  const internalTransfersVol = sameCurrencyTransfers.reduce(
    (sum, t) => sum + Number(t.sourceAmount),
    0
  );
  const conversionVol = conversionTransfers.reduce(
    (sum, t) => sum + Number(t.sourceAmount),
    0
  );

  const netCashFlow = operatingInflows - operatingOutflows;

  return {
    periodType: normPeriodType,
    startDate: currentStart.toISOString(),
    endDate: currentEnd.toISOString(),
    operatingInflowsMinor: operatingInflows,
    formattedOperatingInflows: formatFinancialAmount(operatingInflows, 'USD'),
    operatingOutflowsMinor: operatingOutflows,
    formattedOperatingOutflows: formatFinancialAmount(operatingOutflows, 'USD'),
    internalTransfersCount: sameCurrencyTransfers.length,
    internalTransfersVolumeMinor: internalTransfersVol,
    formattedInternalTransfersVolume: formatFinancialAmount(internalTransfersVol, 'USD'),
    currencyConversionsCount: conversionTransfers.length,
    currencyConversionsVolumeMinor: conversionVol,
    formattedCurrencyConversionsVolume: formatFinancialAmount(conversionVol, 'USD'),
    operatingPaymentsMinor: operatingOutflows,
    formattedOperatingPayments: formatFinancialAmount(operatingOutflows, 'USD'),
    netCashFlowMinor: netCashFlow,
    formattedNetCashFlow: formatFinancialAmount(netCashFlow, 'USD'),
    accountingRulesVerified: {
      transfersExcludedFromRevenueAndExpenses: true,
      withdrawalsExcludedFromSalesRevenue: true,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. MODULE 5: FINANCIAL EXPORT ENGINE (CSV, XLSX, PDF/HTML, JSON)
// ─────────────────────────────────────────────────────────────────────────────

export async function exportFinancialStatement(options: {
  reportType: ReportExportType;
  format: ReportExportFormat;
  periodType?: ReportPeriodType;
  startDate?: string;
  endDate?: string;
  platform?: string;
  accountId?: string;
}): Promise<{
  fileName: string;
  contentType: string;
  content: string;
}> {
  const format = options.format.toUpperCase() as ReportExportFormat;
  const reportType = options.reportType.toUpperCase() as ReportExportType;
  const normPeriodType: ReportPeriodType = (options.periodType?.toUpperCase() || 'MONTHLY') as ReportPeriodType;
  const dateRanges = calculateDateRanges(
    normPeriodType,
    options.startDate,
    options.endDate
  );
  const currentStart = dateRanges.startDate;
  const currentEnd = dateRanges.endDate;

  const startStr = currentStart.toISOString().slice(0, 10);
  const endStr = currentEnd.toISOString().slice(0, 10);
  const timeTag = Date.now().toString(36);

  // 1. Gather data based on report type
  let title = `G4X Financial Report — ${reportType}`;
  let headers: string[] = [];
  let rows: string[][] = [];

  if (reportType === 'P_AND_L') {
    title = `Profit & Loss Statement (${startStr} to ${endStr})`;
    const pnl = await getProfitAndLossReport({
      periodType: normPeriodType,
      startDate: options.startDate,
      endDate: options.endDate,
      platform: options.platform,
    });
    headers = ['Metric', 'Amount (USD)', 'Notes'];
    rows = [
      ['Gross Business Revenue', pnl.formattedGrossRevenue, `From ${pnl.ordersCount} completed orders`],
      ['Platform Marketplace Fees', `-${pnl.formattedPlatformFees}`, 'Eldorado, Skycoach, Overgear, Kingboost'],
      ['Booster Delivery Costs', `-${pnl.formattedBoosterCosts}`, 'Direct service payouts'],
      ['Advertiser Fee Costs', `-${pnl.formattedAdvertiserCosts}`, 'Advertiser boost margins'],
      ['Other Operating Expenses', `-${pnl.formattedOtherExpenses}`, 'Adjustments & write-offs'],
      ['Total Operating Expenses', `-${pnl.formattedTotalExpenses}`, 'Sum of all costs'],
      ['Net Operating Profit', pnl.formattedNetOperatingProfit, `Profit Margin: ${pnl.profitMarginPercentage}%`],
    ];
  } else if (reportType === 'CASH_FLOW') {
    title = `Cash Flow Statement (${startStr} to ${endStr})`;
    const cf = await getCashFlowReport({
      periodType: normPeriodType,
      startDate: options.startDate,
      endDate: options.endDate,
    });
    headers = ['Activity Type', 'Amount (USD)', 'Classification'];
    rows = [
      ['Operating Cash Inflows', cf.formattedOperatingInflows, 'Cash Collections from Sales'],
      ['Operating Cash Outflows', `-${cf.formattedOperatingOutflows}`, 'Settled Withdrawals & Payouts'],
      ['Internal Account Transfers', cf.formattedInternalTransfersVolume, 'Non-Revenue Treasury Movements'],
      ['Currency Conversions Volume', cf.formattedCurrencyConversionsVolume, 'USD / Toman Exchange Operations'],
      ['Net Cash Flow', cf.formattedNetCashFlow, 'Total Net Liquid Cash Generated'],
    ];
  } else if (reportType === 'PLATFORM' || reportType === 'DAILY' || reportType === 'MONTHLY') {
    title = `${reportType} Platform Financial Summary (${startStr} to ${endStr})`;
    const analytics = await getAdvancedFinancialAnalytics({
      periodType: normPeriodType,
      startDate: options.startDate,
      endDate: options.endDate,
      platform: options.platform,
    });
    headers = ['Platform', 'Gross Revenue', 'Order Count', 'Completed', 'Fees', 'Booster Costs', 'Net Profit', 'Margin'];
    rows = analytics.platformPerformanceRanking.map((p) => [
      p.platform.toUpperCase(),
      p.formattedGrossRevenue,
      String(p.orderCount),
      String(p.completedOrders),
      formatFinancialAmount(p.platformFeesMinor, 'USD'),
      formatFinancialAmount(p.boosterCostsMinor, 'USD'),
      p.formattedNetProfit,
      `${p.profitMarginPct}%`,
    ]);
  } else {
    // Complete Ledger Export Fallback
    title = `Financial Ledger Statement (${startStr} to ${endStr})`;
    const journal = await prisma.doubleEntryJournalRecord.findMany({
      where: {
        createdAt: { gte: currentStart, lte: currentEnd },
      },
      include: {
        debitAccount: { select: { name: true, accountRef: true } },
        creditAccount: { select: { name: true, accountRef: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    headers = ['Journal Ref', 'Type', 'Debit Account', 'Credit Account', 'Amount', 'Currency', 'Description', 'Date'];
    rows = journal.map((j) => [
      j.entryRef,
      j.transactionType,
      j.debitAccount.name,
      j.creditAccount.name,
      formatFinancialAmount(Number(j.amount), j.currency),
      j.currency,
      j.description || '',
      j.createdAt.toISOString(),
    ]);
  }

  // 2. Format content according to requested format
  if (format === 'CSV') {
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((c) => `"${(c || '').replace(/"/g, '""')}"`).join(',')),
    ].join('\r\n');

    return {
      fileName: `g4x_${reportType.toLowerCase()}_${startStr}_${endStr}_${timeTag}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csvContent,
    };
  }

  if (format === 'XLSX') {
    // Generate RFC-compliant XML Spreadsheet 2003 (Opens natively in Excel & Sheets as .xlsx/.xml)
    const xmlRows = rows
      .map(
        (r) =>
          `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`).join('')}</Row>`
      )
      .join('\n');

    const xmlHeaders = `<Row ss:StyleID="Header">${headers
      .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
      .join('')}</Row>`;

    const xlsxXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#6D28D9" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(reportType.slice(0, 30))}">
  <Table>
   ${xmlHeaders}
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

    return {
      fileName: `g4x_${reportType.toLowerCase()}_${startStr}_${endStr}_${timeTag}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: xlsxXml,
    };
  }

  if (format === 'JSON') {
    const jsonContent = JSON.stringify(
      {
        title,
        reportType,
        periodType: normPeriodType,
        startDate: startStr,
        endDate: endStr,
        generatedAt: new Date().toISOString(),
        headers,
        records: rows.map((r) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            obj[h] = r[idx] || '';
          });
          return obj;
        }),
      },
      null,
      2
    );

    return {
      fileName: `g4x_${reportType.toLowerCase()}_${startStr}_${endStr}_${timeTag}.json`,
      contentType: 'application/json',
      content: jsonContent,
    };
  }

  // Format = PDF (Printable HTML statement with @media print CSS)
  const printableHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 20px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #8B5CF6; padding-bottom: 12px; margin-bottom: 20px; }
    .logo { font-size: 24px; font-weight: 800; color: #6D28D9; letter-spacing: -0.5px; }
    .meta { font-size: 11px; color: #64748b; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
    th { background: #6D28D9; color: #fff; text-align: left; padding: 8px 12px; font-weight: 700; }
    td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 30px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 10px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 15px; padding: 10px; background: #ede9fe; border-radius: 6px;">
    <button onclick="window.print()" style="background: #6D28D9; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; cursor: pointer;">
      🖨️ Print / Save as PDF
    </button>
  </div>
  <div class="header">
    <div>
      <div class="logo">G4X FINANCIAL TREASURY</div>
      <h2 style="margin: 4px 0 0; font-size: 16px; color: #0f172a;">${escapeXml(title)}</h2>
    </div>
    <div class="meta">
      <div><strong>Period:</strong> ${escapeXml(startStr)} to ${escapeXml(endStr)}</div>
      <div><strong>Generated:</strong> ${new Date().toUTCString()}</div>
      <div><strong>Statement ID:</strong> ${escapeXml(timeTag.toUpperCase())}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>${headers.map((h) => `<th>${escapeXml(h)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeXml(c)}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">
    <span>G4X Community Financial Management System &bull; Phase 5 Certified</span>
    <span>Page 1 of 1 &bull; Strictly Confidential</span>
  </div>
</body>
</html>`;

  return {
    fileName: `g4x_${reportType.toLowerCase()}_${startStr}_${endStr}_${timeTag}.html`,
    contentType: 'text/html; charset=utf-8',
    content: printableHtml,
  };
}

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. MODULE 6: AUTOMATED REPORTING & SCHEDULES ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed canonical automated report schedules if they don't exist.
 */
export async function ensureDefaultReportSchedules(): Promise<void> {
  const defaults = [
    {
      scheduleRef: 'sch_daily_treasury',
      name: 'Daily Treasury & Platform Balance Snapshot',
      reportType: 'DAILY',
      frequency: 'DAILY',
      cronExpression: '0 0 * * *',
      format: 'CSV',
    },
    {
      scheduleRef: 'sch_weekly_pnl',
      name: 'Weekly Consolidated Profit & Loss Brief',
      reportType: 'P_AND_L',
      frequency: 'WEEKLY',
      cronExpression: '0 0 * * 1',
      format: 'CSV',
    },
    {
      scheduleRef: 'sch_monthly_cashflow',
      name: 'Monthly Cash Flow & Liquidity Report',
      reportType: 'CASH_FLOW',
      frequency: 'MONTHLY',
      cronExpression: '0 0 1 * *',
      format: 'CSV',
    },
  ];

  for (const d of defaults) {
    const existing = await prisma.automatedReportSchedule.findUnique({
      where: { scheduleRef: d.scheduleRef },
    });
    if (!existing) {
      await prisma.automatedReportSchedule.create({
        data: d,
      });
    }
  }
}

/**
 * List all automated reporting schedules.
 */
export async function listAutomatedSchedules(): Promise<SerializedAutomatedSchedule[]> {
  await ensureDefaultReportSchedules();
  const list = await prisma.automatedReportSchedule.findMany({
    orderBy: { createdAt: 'asc' },
  });

  return list.map((s) => ({
    id: s.id,
    scheduleRef: s.scheduleRef,
    name: s.name,
    reportType: s.reportType,
    frequency: s.frequency,
    cronExpression: s.cronExpression,
    format: s.format,
    targetPlatform: s.targetPlatform,
    recipientEmails: s.recipientEmails,
    isEnabled: s.isEnabled,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

/**
 * Toggle or update an automated report schedule.
 */
export async function updateAutomatedSchedule(
  idOrRef: string,
  data: {
    isEnabled?: boolean;
    frequency?: string;
    format?: string;
    recipientEmails?: string;
  }
): Promise<SerializedAutomatedSchedule> {
  const sch = await prisma.automatedReportSchedule.findFirst({
    where: {
      OR: [{ id: idOrRef }, { scheduleRef: idOrRef }],
    },
  });

  if (!sch) {
    throw new Error(`NOT_FOUND: Schedule '${idOrRef}' not found`);
  }

  const updated = await prisma.automatedReportSchedule.update({
    where: { id: sch.id },
    data: {
      isEnabled: data.isEnabled !== undefined ? data.isEnabled : sch.isEnabled,
      frequency: data.frequency || sch.frequency,
      format: data.format || sch.format,
      recipientEmails: data.recipientEmails !== undefined ? data.recipientEmails : sch.recipientEmails,
      updatedAt: new Date(),
    },
  });

  return {
    id: updated.id,
    scheduleRef: updated.scheduleRef,
    name: updated.name,
    reportType: updated.reportType,
    frequency: updated.frequency,
    cronExpression: updated.cronExpression,
    format: updated.format,
    targetPlatform: updated.targetPlatform,
    recipientEmails: updated.recipientEmails,
    isEnabled: updated.isEnabled,
    lastRunAt: updated.lastRunAt ? updated.lastRunAt.toISOString() : null,
    nextRunAt: updated.nextRunAt ? updated.nextRunAt.toISOString() : null,
    lastStatus: updated.lastStatus,
    lastError: updated.lastError,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * Execute an automated report schedule manually or via runner.
 */
export async function executeReportSchedule(
  scheduleIdOrRef: string,
  adminId?: string
): Promise<SerializedGeneratedReport> {
  const sch = await prisma.automatedReportSchedule.findFirst({
    where: {
      OR: [{ id: scheduleIdOrRef }, { scheduleRef: scheduleIdOrRef }],
    },
  });

  if (!sch) {
    throw new Error(`NOT_FOUND: Schedule '${scheduleIdOrRef}' not found`);
  }

  try {
    const exported = await exportFinancialStatement({
      reportType: sch.reportType as ReportExportType,
      format: (sch.format as ReportExportFormat) || 'CSV',
      periodType: (sch.frequency.toLowerCase() as ReportPeriodType) || 'monthly',
      platform: sch.targetPlatform || undefined,
    });

    const reportRef = `RPT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const generated = await prisma.generatedFinancialReport.create({
      data: {
        reportRef,
        title: sch.name,
        reportType: sch.reportType,
        periodType: sch.frequency,
        startDate: new Date(),
        endDate: new Date(),
        format: sch.format,
        fileContent: exported.content,
        fileSizeBytes: Buffer.byteLength(exported.content, 'utf8'),
        scheduleId: sch.id,
        generatedById: adminId || null,
        metadata: JSON.stringify({ fileName: exported.fileName }),
      },
    });

    await prisma.automatedReportSchedule.update({
      where: { id: sch.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'SUCCESS',
        lastError: null,
      },
    });

    return {
      id: generated.id,
      reportRef: generated.reportRef,
      title: generated.title,
      reportType: generated.reportType,
      periodType: generated.periodType,
      startDate: generated.startDate.toISOString(),
      endDate: generated.endDate.toISOString(),
      format: generated.format,
      fileSizeBytes: generated.fileSizeBytes,
      scheduleId: generated.scheduleId,
      generatedById: generated.generatedById,
      metadata: { fileName: exported.fileName },
      createdAt: generated.createdAt.toISOString(),
    };
  } catch (err: any) {
    await prisma.automatedReportSchedule.update({
      where: { id: sch.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'FAILED',
        lastError: err.message,
      },
    });
    throw err;
  }
}

/**
 * List all generated financial reports.
 */
export async function listGeneratedFinancialReports(params?: {
  reportType?: string;
  limit?: number;
}): Promise<SerializedGeneratedReport[]> {
  const limit = Math.max(1, Math.min(100, params?.limit || 30));
  const where: any = {};
  if (params?.reportType && params.reportType !== 'all') {
    where.reportType = params.reportType.toUpperCase();
  }

  const list = await prisma.generatedFinancialReport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return list.map((r) => {
    let parsedMeta: Record<string, any> | null = null;
    try {
      if (r.metadata) parsedMeta = JSON.parse(r.metadata);
    } catch {}

    return {
      id: r.id,
      reportRef: r.reportRef,
      title: r.title,
      reportType: r.reportType,
      periodType: r.periodType,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      format: r.format,
      fileSizeBytes: r.fileSizeBytes,
      scheduleId: r.scheduleId,
      generatedById: r.generatedById,
      metadata: parsedMeta,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Download a generated report by ID or ref.
 */
export async function getGeneratedReportFile(idOrRef: string): Promise<{
  report: SerializedGeneratedReport;
  content: string;
  contentType: string;
  fileName: string;
}> {
  const r = await prisma.generatedFinancialReport.findFirst({
    where: {
      OR: [{ id: idOrRef }, { reportRef: idOrRef }],
    },
  });

  if (!r) {
    throw new Error(`NOT_FOUND: Generated report '${idOrRef}' not found`);
  }

  let contentType = 'text/plain';
  let ext = 'txt';
  const fmt = r.format.toUpperCase();
  if (fmt === 'CSV') {
    contentType = 'text/csv; charset=utf-8';
    ext = 'csv';
  } else if (fmt === 'XLSX') {
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    ext = 'xlsx';
  } else if (fmt === 'PDF') {
    contentType = 'text/html; charset=utf-8';
    ext = 'html';
  } else if (fmt === 'JSON') {
    contentType = 'application/json';
    ext = 'json';
  }

  let fileName = `g4x_report_${r.reportRef}.${ext}`;
  if (r.metadata) {
    try {
      const parsed = JSON.parse(r.metadata);
      if (parsed.fileName) fileName = parsed.fileName;
    } catch {}
  }

  let parsedMeta: Record<string, any> | null = null;
  try {
    if (r.metadata) parsedMeta = JSON.parse(r.metadata);
  } catch {}

  return {
    report: {
      id: r.id,
      reportRef: r.reportRef,
      title: r.title,
      reportType: r.reportType,
      periodType: r.periodType,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      format: r.format,
      fileSizeBytes: r.fileSizeBytes,
      scheduleId: r.scheduleId,
      generatedById: r.generatedById,
      metadata: parsedMeta,
      createdAt: r.createdAt.toISOString(),
    },
    content: r.fileContent || '',
    contentType,
    fileName,
  };
}
