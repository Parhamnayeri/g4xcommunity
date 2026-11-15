import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  AdvancedFinancialAnalytics,
  ProfitAndLossReportData,
  CashFlowReportData,
  ReportExportFormat,
  ReportExportType,
} from '../../types/financialAnalytics';
import {
  fetchAdvancedAnalytics,
  fetchProfitAndLossReport,
  fetchCashFlowReport,
  getFinancialExportDownloadUrl,
} from '../../services/financialAnalytics';

export const AdvancedAnalyticsSection: React.FC = () => {
  // ─── Active Sub-View & Filters ─────────────────────────────────────────────
  const [activeView, setActiveView] = useState<'analytics' | 'pnl' | 'cash_flow'>('analytics');
  const [periodType, setPeriodType] = useState<string>('MONTHLY');
  const [platform, setPlatform] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // ─── Data States ───────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<AdvancedFinancialAnalytics | null>(null);
  const [pnlReport, setPnlReport] = useState<ProfitAndLossReportData | null>(null);
  const [cashFlowReport, setCashFlowReport] = useState<CashFlowReportData | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        periodType,
        platform: platform !== 'all' ? platform : undefined,
        startDate: periodType === 'CUSTOM' ? startDate : undefined,
        endDate: periodType === 'CUSTOM' ? endDate : undefined,
      };

      if (activeView === 'analytics') {
        const res = await fetchAdvancedAnalytics(params);
        setAnalytics(res.analytics);
      } else if (activeView === 'pnl') {
        const res = await fetchProfitAndLossReport(params);
        setPnlReport(res.report);
      } else if (activeView === 'cash_flow') {
        const res = await fetchCashFlowReport(params);
        setCashFlowReport(res.report);
      }
    } catch (err: any) {
      console.error('[AdvancedAnalytics] Load error:', err);
      setError(err.message || 'Failed to fetch financial analytics data');
    } finally {
      setLoading(false);
    }
  }, [activeView, periodType, platform, startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = (format: ReportExportFormat) => {
    let reportType: ReportExportType = 'MONTHLY';
    if (activeView === 'pnl') reportType = 'P_AND_L';
    else if (activeView === 'cash_flow') reportType = 'CASH_FLOW';
    else reportType = 'PLATFORM';

    const url = getFinancialExportDownloadUrl({
      reportType,
      format,
      periodType,
      startDate: periodType === 'CUSTOM' ? startDate : undefined,
      endDate: periodType === 'CUSTOM' ? endDate : undefined,
      platform: platform !== 'all' ? platform : undefined,
    });
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* ─── Header & View Switcher ───────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-xl shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-lg text-lg font-bold">
              📈
            </span>
            <h2 className="text-xl font-bold text-zinc-100">Advanced Analytics, P&L & Cash Flow</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Enterprise analytics engine with strict separation of Profit & Loss (Accrual) vs. Cash Flow movements.
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-zinc-800 p-1 rounded-xl border border-zinc-700">
          <button
            onClick={() => setActiveView('analytics')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeView === 'analytics'
                ? 'bg-purple-600 text-white shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            📊 Analytics & Rankings
          </button>
          <button
            onClick={() => setActiveView('pnl')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeView === 'pnl'
                ? 'bg-purple-600 text-white shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            📑 Profit & Loss (P&L)
          </button>
          <button
            onClick={() => setActiveView('cash_flow')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeView === 'cash_flow'
                ? 'bg-purple-600 text-white shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            💧 Cash Flow Statement
          </button>
        </div>
      </div>

      {/* ─── Global Filters & Export Bar ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900/90 border border-zinc-800 p-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-3">
          {/* Period Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-400">Period:</span>
            {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'ALL_TIME', 'CUSTOM'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriodType(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  periodType === p
                    ? 'bg-purple-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Platform Filter */}
          {activeView !== 'cash_flow' && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs font-semibold text-zinc-400">Platform:</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="px-2.5 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-xs focus:outline-none focus:border-purple-500"
              >
                <option value="all">All Platforms</option>
                <option value="direct">G4X Direct</option>
                <option value="eldorado">Eldorado</option>
                <option value="skycoach">Skycoach</option>
                <option value="overgear">Overgear</option>
                <option value="kingboost">Kingboost</option>
              </select>
            </div>
          )}

          {/* Custom Date Range */}
          {periodType === 'CUSTOM' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-xs"
              />
              <span className="text-zinc-500 text-xs">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-xs"
              />
            </div>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 mr-1">Download:</span>
          <button
            onClick={() => handleExport('CSV')}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport('XLSX')}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-emerald-400 text-xs font-medium rounded-lg transition-colors"
          >
            XLSX
          </button>
          <button
            onClick={() => handleExport('PDF')}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-rose-400 text-xs font-medium rounded-lg transition-colors"
          >
            PDF
          </button>
          <button
            onClick={() => handleExport('JSON')}
            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-purple-300 text-xs font-medium rounded-lg transition-colors"
          >
            JSON
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300 font-bold ml-4">✕</button>
        </div>
      )}

      {loading ? (
        <div className="p-16 bg-zinc-900 border border-zinc-800 rounded-xl">
          <LoadingState message="Processing advanced financial analytics..." />
        </div>
      ) : (
        <>
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* VIEW 1: EXECUTIVE ANALYTICS & RANKINGS                            */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeView === 'analytics' && analytics && (
            <div className="space-y-6">
              {/* Top Executive KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg">
                  <span className="text-xs text-zinc-400">Gross Business Revenue</span>
                  <div className="text-2xl font-bold text-zinc-100 mt-1">
                    {analytics.revenueVsExpenses.formattedGrossRevenue}
                  </div>
                  <span className="text-xs text-purple-400">Total client order billing</span>
                </div>

                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg">
                  <span className="text-xs text-zinc-400">Total Operating Expenses</span>
                  <div className="text-2xl font-bold text-rose-400 mt-1">
                    {analytics.revenueVsExpenses.formattedTotalExpenses}
                  </div>
                  <span className="text-xs text-zinc-400">Fees + Booster costs + Adv margins</span>
                </div>

                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg">
                  <span className="text-xs text-zinc-400">Net Business Profit</span>
                  <div className={`text-2xl font-bold mt-1 ${analytics.revenueVsExpenses.netProfitMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {analytics.revenueVsExpenses.formattedNetProfit}
                  </div>
                  <span className="text-xs text-emerald-400">Net retained business surplus</span>
                </div>

                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg">
                  <span className="text-xs text-zinc-400">Net Liquid Cash Flow</span>
                  <div className={`text-2xl font-bold mt-1 ${analytics.cashFlowAnalysis.netCashFlowMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {analytics.cashFlowAnalysis.formattedNetCashFlow}
                  </div>
                  <span className="text-xs text-zinc-400">Inflows minus settled withdrawals</span>
                </div>
              </div>

              {/* Platform Performance Rankings Table */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                    <span>🏆</span> Platform Performance Ranking
                  </h3>
                  <span className="text-xs text-zinc-400">Sorted by Gross Revenue</span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-sm text-zinc-300">
                    <thead className="bg-zinc-800/80 text-zinc-400 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="p-3 text-center">Rank</th>
                        <th className="p-3">Platform</th>
                        <th className="p-3 text-right">Gross Revenue</th>
                        <th className="p-3 text-center">Total Orders</th>
                        <th className="p-3 text-center">Completed</th>
                        <th className="p-3 text-right">Platform Fees</th>
                        <th className="p-3 text-right">Booster Costs</th>
                        <th className="p-3 text-right">Net Profit</th>
                        <th className="p-3 text-right">Margin %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {analytics.platformPerformanceRanking.map((p) => (
                        <tr key={p.platform} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="p-3 text-center font-bold text-purple-400">#{p.rank}</td>
                          <td className="p-3 font-semibold text-zinc-100 uppercase">{p.platform}</td>
                          <td className="p-3 text-right font-medium text-zinc-200">{p.formattedGrossRevenue}</td>
                          <td className="p-3 text-center text-zinc-400">{p.orderCount}</td>
                          <td className="p-3 text-center text-zinc-300">{p.completedOrders}</td>
                          <td className="p-3 text-right text-rose-400">
                            ${(p.platformFeesMinor / 100).toFixed(2)}
                          </td>
                          <td className="p-3 text-right text-rose-400">
                            ${(p.boosterCostsMinor / 100).toFixed(2)}
                          </td>
                          <td className={`p-3 text-right font-bold ${p.netProfitMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {p.formattedNetProfit}
                          </td>
                          <td className="p-3 text-right font-semibold text-purple-300">
                            {p.profitMarginPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Advertiser Boosts & Currency Conversion Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Advertiser Boosts Profitability */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg space-y-4">
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <span>📢</span> Advertiser Boosts Profitability
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Gross Advertiser Revenue</span>
                      <div className="text-base font-bold text-zinc-100 mt-0.5">
                        {analytics.advertiserBoostsProfitability.formattedGrossRevenue}
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Net Profit from Advertisers</span>
                      <div className="text-base font-bold text-emerald-400 mt-0.5">
                        {analytics.advertiserBoostsProfitability.formattedNetProfit}
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Booster Payouts</span>
                      <div className="text-base font-bold text-rose-400 mt-0.5">
                        {analytics.advertiserBoostsProfitability.formattedBoosterPayouts}
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Profit Margin</span>
                      <div className="text-base font-bold text-purple-400 mt-0.5">
                        {analytics.advertiserBoostsProfitability.profitMarginPct}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Currency Conversion Analysis */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg space-y-4">
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <span>💱</span> Currency Conversion Performance
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Total USD Converted</span>
                      <div className="text-base font-bold text-zinc-100 mt-0.5">
                        {analytics.currencyConversionAnalysis.formattedTotalUsdConverted}
                      </div>
                      <span className="text-[10px] text-zinc-500">{analytics.currencyConversionAnalysis.usdToTomanTransfersCount} transfers</span>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Total Toman Converted</span>
                      <div className="text-base font-bold text-zinc-100 mt-0.5">
                        {analytics.currencyConversionAnalysis.formattedTotalTomanConverted}
                      </div>
                      <span className="text-[10px] text-zinc-500">{analytics.currencyConversionAnalysis.tomanToUsdTransfersCount} transfers</span>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Conversion Fees</span>
                      <div className="text-base font-bold text-emerald-400 mt-0.5">
                        {analytics.currencyConversionAnalysis.formattedConversionFeesUsd}
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-800/60 rounded-lg">
                      <span className="text-zinc-400">Avg Exchange Rate</span>
                      <div className="text-base font-bold text-purple-400 mt-0.5">
                        {analytics.currencyConversionAnalysis.averageExchangeRate.toLocaleString()} Toman
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Platform Balance Distribution */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg space-y-4">
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>🏦</span> Liquidity & Account Balance Distribution
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {analytics.platformBalanceDistribution.map((a) => (
                    <div key={a.accountRef} className="p-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-xs">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span className="truncate">{a.accountName}</span>
                        <span className="font-mono text-purple-300 font-bold">{a.percentageOfTotalUsd}%</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 mt-1">{a.formattedBalance}</div>
                      <span className="text-[10px] text-zinc-500 uppercase">{a.category} • {a.currency}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* VIEW 2: PROFIT & LOSS (P&L) STATEMENT (ACCRUAL)                  */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeView === 'pnl' && pnlReport && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl space-y-6">
              <div className="border-b border-zinc-800 pb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-zinc-100">Profit & Loss Statement (Income Statement)</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Accrual basis: Tracks earned customer revenue vs. delivery costs and marketplace fees.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-zinc-400">Period: {new Date(pnlReport.startDate).toLocaleDateString()} — {new Date(pnlReport.endDate).toLocaleDateString()}</span>
                  <div className="text-xs font-semibold text-purple-400">{pnlReport.ordersCount} Completed Orders</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/60">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">Gross Business Revenue</div>
                    <div className="text-xs text-zinc-400">Total customer collections from completed services</div>
                  </div>
                  <div className="text-lg font-bold text-zinc-100">{pnlReport.formattedGrossRevenue}</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                  <div>
                    <div className="text-sm font-semibold text-rose-300">Platform Marketplace Fees</div>
                    <div className="text-xs text-rose-400/80">Eldorado, Skycoach, Overgear, and Kingboost platform deductions</div>
                  </div>
                  <div className="text-base font-bold text-rose-400">-{pnlReport.formattedPlatformFees}</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                  <div>
                    <div className="text-sm font-semibold text-rose-300">Booster Delivery Costs</div>
                    <div className="text-xs text-rose-400/80">Direct payouts earned by service delivery boosters</div>
                  </div>
                  <div className="text-base font-bold text-rose-400">-{pnlReport.formattedBoosterCosts}</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                  <div>
                    <div className="text-sm font-semibold text-rose-300">Advertiser Partner Costs</div>
                    <div className="text-xs text-rose-400/80">Third-party advertiser commission margins</div>
                  </div>
                  <div className="text-base font-bold text-rose-400">-{pnlReport.formattedAdvertiserCosts}</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-800/80 rounded-xl border border-zinc-700">
                  <div>
                    <div className="text-sm font-bold text-zinc-200">Total Cost of Goods & Operating Expenses</div>
                    <div className="text-xs text-zinc-400">Sum of marketplace fees, booster rewards, and partner costs</div>
                  </div>
                  <div className="text-lg font-bold text-rose-400">-{pnlReport.formattedTotalExpenses}</div>
                </div>

                <div className="flex items-center justify-between p-5 bg-gradient-to-r from-purple-950/40 to-indigo-950/40 rounded-xl border border-purple-500/40 shadow-lg">
                  <div>
                    <div className="text-base font-bold text-purple-200">Net Operating Profit</div>
                    <div className="text-xs text-purple-300/80">
                      Operating Profit Margin: <span className="font-bold text-emerald-400">{pnlReport.profitMarginPercentage}%</span>
                    </div>
                  </div>
                  <div className={`text-2xl font-bold ${pnlReport.netOperatingProfitMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pnlReport.formattedNetOperatingProfit}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* VIEW 3: CASH FLOW STATEMENT                                       */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeView === 'cash_flow' && cashFlowReport && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl space-y-6">
              <div className="border-b border-zinc-800 pb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-zinc-100">Statement of Cash Flows</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Liquid Cash Movement: Real operating receipts and disbursements without accrual estimates.
                  </p>
                </div>
                {/* Accounting Integrity Badge */}
                <div className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 font-medium">
                  ✓ Strict Invariants: Non-revenue transfers & withdrawals separated
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/60 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Cash Flow from Operating Activities</h4>
                  <div className="flex items-center justify-between text-sm py-1">
                    <span className="text-zinc-300">Customer Collections (Completed Order Inflows)</span>
                    <span className="font-bold text-emerald-400">+{cashFlowReport.formattedOperatingInflows}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-1 border-t border-zinc-700/40 pt-2">
                    <span className="text-zinc-300">Settled Withdrawals & Outbound Disbursements</span>
                    <span className="font-bold text-rose-400">-{cashFlowReport.formattedOperatingOutflows}</span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/60 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Treasury Movements (Non-Revenue Balanced)</h4>
                  <div className="flex items-center justify-between text-sm py-1">
                    <div>
                      <span className="text-zinc-300">Internal Account Transfers</span>
                      <span className="text-xs text-zinc-500 block">{cashFlowReport.internalTransfersCount} transfers (zero net change)</span>
                    </div>
                    <span className="font-bold text-zinc-200">{cashFlowReport.formattedInternalTransfersVolume}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-1 border-t border-zinc-700/40 pt-2">
                    <div>
                      <span className="text-zinc-300">Currency Conversion Operations</span>
                      <span className="text-xs text-zinc-500 block">{cashFlowReport.currencyConversionsCount} conversions executed</span>
                    </div>
                    <span className="font-bold text-zinc-200">{cashFlowReport.formattedCurrencyConversionsVolume}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-5 bg-gradient-to-r from-emerald-950/40 to-teal-950/40 rounded-xl border border-emerald-500/40 shadow-lg">
                  <div>
                    <div className="text-base font-bold text-emerald-200">Net Increase / (Decrease) in Liquid Cash</div>
                    <div className="text-xs text-emerald-400/80">Net liquid operational cash generated during period</div>
                  </div>
                  <div className={`text-2xl font-bold ${cashFlowReport.netCashFlowMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {cashFlowReport.formattedNetCashFlow}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
