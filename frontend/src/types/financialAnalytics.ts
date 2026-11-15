/**
 * frontend/src/types/financialAnalytics.ts
 * Type definitions for G4X Phase 5: Financial Snapshots, Advanced Analytics, P&L vs. Cash Flow, and Automated Reports.
 */

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
  createdAt: string;
}

export interface SerializedGeneratedReport {
  id: string;
  reportRef: string;
  scheduleId: string | null;
  scheduleName: string | null;
  reportType: string;
  format: string;
  fileName: string;
  fileSizeBytes: number;
  generatedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  adminId: string | null;
}
