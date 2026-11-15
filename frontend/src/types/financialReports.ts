/**
 * frontend/src/types/financialReports.ts — Phase 3 Financial Reports & Advertiser Boosts Types
 */

export type ReportPeriodType =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY'
  | 'CUSTOM'
  | 'ALL_TIME';

export interface MetricWithComparison {
  valueMinor: number;
  formatted: string;
  previousValueMinor: number | null;
  formattedPrevious: string | null;
  changePercentage: number | null;
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

  totalOrders: CountWithComparison;
  completedOrders: CountWithComparison;
  activeOrders: CountWithComparison;
  cancelledOrders: CountWithComparison;

  grossRevenue: MetricWithComparison;
  platformFees: MetricWithComparison;
  netRevenue: MetricWithComparison;
  boosterCosts: MetricWithComparison;
  advertiserCosts: MetricWithComparison;
  netProfit: MetricWithComparison;

  totalWithdrawalsMinor: number;
  formattedTotalWithdrawals: string;
  pendingWithdrawalsMinor: number;
  formattedPendingWithdrawals: string;
  currentPlatformBalanceMinor: number;
  formattedCurrentPlatformBalance: string;
  pendingOrderValueMinor: number;
  formattedPendingOrderValue: string;
}

export interface AdvertiserOriginPoint {
  platformKey: string;
  platformName: string;
  ordersCount: number;
  grossRevenueMinor: number;
  formattedGrossRevenue: string;
  netProfitMinor: number;
  formattedNetProfit: string;
}

export interface AdvertiserBoostSummary {
  totalAdvertiserOrders: CountWithComparison;
  completedAdvertiserOrders: CountWithComparison;
  activeAdvertiserOrders: CountWithComparison;
  cancelledAdvertiserOrders: CountWithComparison;

  grossAdvertiserRevenue: MetricWithComparison;
  platformFees: MetricWithComparison;
  advertiserPayment: MetricWithComparison;
  boosterPayouts: MetricWithComparison;
  additionalCosts: MetricWithComparison;
  netAdvertiserProfit: MetricWithComparison;

  originPlatformBreakdown: AdvertiserOriginPoint[];
}

export interface ChartDataPoint {
  date: string;
  label: string;
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
