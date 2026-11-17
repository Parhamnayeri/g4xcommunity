import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  ReportPeriodType,
  ConsolidatedFinancialReportResponse,
  PlatformDetailReportResponse,
  AdvertiserBoostsReportResponse,
  PlatformReportSummary,
  AdvertiserBoostSummary,
  ReportingOrderItem,
  ChartDataPoint,
} from '../../types/financialReports';
import {
  fetchConsolidatedFinancialReport,
  fetchPlatformFinancialReport,
  fetchAdvertiserBoostsReport,
  fetchReportOrders,
  downloadReportsCsv,
} from '../../services/financialReports';

export type ReportTab =
  | 'all'
  | 'direct'
  | 'eldorado'
  | 'skycoach'
  | 'overgear'
  | 'kingboost'
  | 'advertiser';

export const FinancialReportsSection: React.FC = () => {
  // ─── Active Tabs & Filters ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ReportTab>('all');
  const [period, setPeriod] = useState<ReportPeriodType>('MONTHLY');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  // ─── Report States ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedFinancialReportResponse | null>(null);
  const [platformData, setPlatformData] = useState<PlatformDetailReportResponse | null>(null);
  const [advertiserData, setAdvertiserData] = useState<AdvertiserBoostsReportResponse | null>(null);

  // ─── Orders Table State ─────────────────────────────────────────────────────
  const [orders, setOrders] = useState<ReportingOrderItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState<boolean>(false);
  const [ordersPage, setOrdersPage] = useState<number>(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState<number>(1);
  const [ordersTotalCount, setOrdersTotalCount] = useState<number>(0);
  const [ordersSearch, setOrdersSearch] = useState<string>('');
  const [ordersStatus, setOrdersStatus] = useState<string>('all');
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // ─── Chart Hover Tooltip State ──────────────────────────────────────────────
  const [hoveredChartPoint, setHoveredChartPoint] = useState<ChartDataPoint | null>(null);

  // ─── Fetch Active Report ────────────────────────────────────────────────────
  const loadActiveReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        period,
        from: period === 'CUSTOM' ? customFrom : undefined,
        to: period === 'CUSTOM' ? customTo : undefined,
      };

      if (activeTab === 'all') {
        const res = await fetchConsolidatedFinancialReport(params);
        setConsolidatedData(res);
        setPlatformData(null);
        setAdvertiserData(null);
      } else if (activeTab === 'advertiser') {
        const res = await fetchAdvertiserBoostsReport(params);
        setAdvertiserData(res);
        setConsolidatedData(null);
        setPlatformData(null);
      } else {
        const res = await fetchPlatformFinancialReport(activeTab, params);
        setPlatformData(res);
        setConsolidatedData(null);
        setAdvertiserData(null);
      }
    } catch (err: any) {
      console.error('[FinancialReports] Failed to fetch report:', err);
      setError(err.message || 'Failed to generate financial report');
    } finally {
      setLoading(false);
    }
  }, [activeTab, period, customFrom, customTo]);

  // ─── Fetch Detailed Orders ──────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      let platformParam: string | undefined = undefined;
      if (activeTab !== 'all') {
        platformParam = activeTab;
      }

      const res = await fetchReportOrders({
        platform: platformParam,
        status: ordersStatus !== 'all' ? ordersStatus : undefined,
        search: ordersSearch.trim() || undefined,
        startDate: period === 'CUSTOM' && customFrom ? customFrom : undefined,
        endDate: period === 'CUSTOM' && customTo ? customTo : undefined,
        page: ordersPage,
        limit: 15,
        sortBy: 'completedAt',
        sortDirection: 'desc',
      });

      if (res && res.orders) {
        setOrders(res.orders);
        setOrdersTotalPages(res.totalPages || 1);
        setOrdersTotalCount(res.total || 0);
      }
    } catch (err: any) {
      console.warn('[FinancialReports] Failed to fetch orders table:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [activeTab, ordersStatus, ordersSearch, period, customFrom, customTo, ordersPage]);

  // Reload data when active tab or period changes
  useEffect(() => {
    loadActiveReport();
    setOrdersPage(1);
  }, [loadActiveReport]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ─── Handle CSV Export ──────────────────────────────────────────────────────
  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await downloadReportsCsv({
        platform: activeTab !== 'all' ? activeTab : undefined,
        status: ordersStatus !== 'all' ? ordersStatus : undefined,
        startDate: period === 'CUSTOM' && customFrom ? customFrom : undefined,
        endDate: period === 'CUSTOM' && customTo ? customTo : undefined,
      });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingCsv(false);
    }
  };

  // ─── Tab definitions ────────────────────────────────────────────────────────
  const tabs: { key: ReportTab; label: string; icon: string; badge?: string }[] = [
    { key: 'all', label: 'All Platforms', icon: '🌐' },
    { key: 'direct', label: 'G4X Direct', icon: '⚡' },
    { key: 'eldorado', label: 'Eldorado', icon: '🏛️' },
    { key: 'skycoach', label: 'Skycoach', icon: '🚀' },
    { key: 'overgear', label: 'Overgear', icon: '⚙️' },
    { key: 'kingboost', label: 'Kingboost', icon: '👑' },
    { key: 'advertiser', label: 'Advertiser Boosts', icon: '📢', badge: 'Special' },
  ];

  // ─── Active Summary Resolution ──────────────────────────────────────────────
  const activeSummary: PlatformReportSummary | null = useMemo(() => {
    if (activeTab === 'all' && consolidatedData) return consolidatedData.summary;
    if (activeTab !== 'all' && activeTab !== 'advertiser' && platformData) return platformData.summary;
    return null;
  }, [activeTab, consolidatedData, platformData]);

  const activeAdvertiserSummary: AdvertiserBoostSummary | null = useMemo(() => {
    if (activeTab === 'advertiser' && advertiserData) return advertiserData.summary;
    if (activeTab === 'all' && consolidatedData) return consolidatedData.advertiserBoosts;
    return null;
  }, [activeTab, advertiserData, consolidatedData]);

  const dateRangeLabel = useMemo(() => {
    if (consolidatedData) return consolidatedData.dateRange.periodLabel;
    if (platformData) return platformData.dateRange.periodLabel;
    if (advertiserData) return advertiserData.dateRange.periodLabel;
    return '';
  }, [consolidatedData, platformData, advertiserData]);

  const previousDateRangeLabel = useMemo(() => {
    if (consolidatedData) return consolidatedData.dateRange.previousPeriodLabel;
    if (platformData) return platformData.dateRange.previousPeriodLabel;
    if (advertiserData) return advertiserData.dateRange.previousPeriodLabel;
    return 'previous period';
  }, [consolidatedData, platformData, advertiserData]);

  // ─── Chart points calculation ───────────────────────────────────────────────
  const chartPoints: ChartDataPoint[] = useMemo(() => {
    if (activeTab === 'all' && consolidatedData) return consolidatedData.charts.revenueOverTime;
    if (activeTab === 'advertiser' && advertiserData) return advertiserData.charts.performanceOverTime;
    if (platformData) return platformData.charts.revenueOverTime;
    return [];
  }, [activeTab, consolidatedData, platformData, advertiserData]);

  // ─── Helper Metric Badge Component ──────────────────────────────────────────
  const renderDeltaBadge = (changePercentage: number | null, _trend: 'up' | 'down' | 'neutral', reverseGood = false) => {
    if (changePercentage === null) {
      return (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          No prev data
        </span>
      );
    }
    const isPositive = changePercentage > 0;
    const isZero = changePercentage === 0;

    let isGood = isPositive;
    if (reverseGood) {
      isGood = !isPositive; // For costs / fees, reduction is good
    }

    const color = isZero ? '#94A3B8' : isGood ? '#34D399' : '#F87171';
    const bg = isZero
      ? 'rgba(148, 163, 184, 0.12)'
      : isGood
      ? 'rgba(52, 211, 153, 0.12)'
      : 'rgba(239, 68, 68, 0.12)';
    const arrow = isPositive ? '↑' : changePercentage < 0 ? '↓' : '→';

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '0.72rem',
          fontWeight: 700,
          backgroundColor: bg,
          color,
        }}
        title={`Comparison with ${previousDateRangeLabel}`}
      >
        <span>{arrow}</span>
        <span>{Math.abs(changePercentage).toFixed(1)}%</span>
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* HEADER & GLOBAL PERIOD SELECTOR                                          */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        className="card-surface"
        style={{
          padding: '1.5rem',
          border: '1px solid rgba(139, 92, 246, 0.25)',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                Financial Reports &amp; Platform Analytics
              </h2>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(139, 92, 246, 0.25)',
                  color: '#C4B5FD',
                  fontWeight: 700,
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                }}
              >
                Phase 3 Enterprise Treasury
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: '6px 0 0 0' }}>
              Consolidated multi-platform reporting, booster and advertiser payout auditing, and unified non-duplicative earnings intelligence.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                loadActiveReport();
                loadOrders();
              }}
              disabled={loading}
              title="Refresh reporting data"
            >
              ↻ Refresh Report
            </button>
            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={handleExportCsv}
              disabled={exportingCsv}
              style={{
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>📥</span>
              <span>{exportingCsv ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>
        </div>

        {/* Global Period Filter Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            paddingTop: '0.75rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Period:
            </span>
            {(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'ALL_TIME', 'CUSTOM'] as ReportPeriodType[]).map(
              (p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: period === p ? '1px solid #8B5CF6' : '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: period === p ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                    color: period === p ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {p === 'ALL_TIME' ? 'All Time' : p.charAt(0) + p.slice(1).toLowerCase()}
                </button>
              )
            )}
          </div>

          {/* Custom Date Range Pickers (shown when period === 'CUSTOM') */}
          {period === 'CUSTOM' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', width: '135px' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', width: '135px' }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => loadActiveReport()}
              >
                Apply
              </button>
            </div>
          )}

          {/* Active Period Label Display */}
          {dateRangeLabel && (
            <div style={{ fontSize: '0.8rem', color: '#A78BFA', fontWeight: 600 }}>
              📅 {dateRangeLabel}{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 400 }}>
                (compared vs {previousDateRangeLabel})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* 7 SUB-TABS: All Platforms, Direct, Eldorado, Skycoach, Overgear, Kingboost, Advertiser */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '0.4rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
          overflowX: 'auto',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '8px',
              border: activeTab === t.key ? '1px solid #8B5CF6' : '1px solid transparent',
              backgroundColor: activeTab === t.key ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
              color: activeTab === t.key ? '#C4B5FD' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {t.badge && (
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '2px 5px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(236, 72, 153, 0.25)',
                  color: '#F472B6',
                  fontWeight: 800,
                  border: '1px solid rgba(236, 72, 153, 0.4)',
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── ERROR STATE ──────────────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* ─── LOADING STATE ────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: '3rem 0' }}>
          <LoadingState message="Calculating multi-platform financial intelligence &amp; comparisons..." />
        </div>
      ) : (
        <>
          {/* ───────────────────────────────────────────────────────────────────── */}
          {/* 13 PLATFORM REPORT METRICS (For All Platforms or Specific Platforms) */}
          {/* ───────────────────────────────────────────────────────────────────── */}
          {activeSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  {activeTab === 'all'
                    ? 'Consolidated Platform Metrics (13 Enterprise Indicators)'
                    : `${activeSummary.platformName} Performance Metrics`}
                </h3>
                {activeTab === 'all' && (
                  <span style={{ fontSize: '0.75rem', color: '#34D399', fontWeight: 600 }}>
                    🛡️ Non-Duplicative Consolidation Enforced
                  </span>
                )}
              </div>

              {/* Row 1: Core Financials (Gross, Platform Fees, Net Revenue, Net Profit) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* 1. Gross Revenue */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Gross Revenue
                    </span>
                    {renderDeltaBadge(activeSummary.grossRevenue.changePercentage, activeSummary.grossRevenue.trend)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeSummary.grossRevenue.formatted}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Total customer order values before deductions
                  </div>
                </div>

                {/* 2. Platform Fees */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(248, 113, 113, 0.25)',
                    background: 'linear-gradient(145deg, rgba(239, 68, 68, 0.05) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Platform Fees
                    </span>
                    {renderDeltaBadge(activeSummary.platformFees.changePercentage, activeSummary.platformFees.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F87171', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeSummary.platformFees.formatted}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Marketplace commissions &amp; transaction deductions
                  </div>
                </div>

                {/* 3. Net Revenue */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    background: 'linear-gradient(145deg, rgba(56, 189, 248, 0.05) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Net Revenue
                    </span>
                    {renderDeltaBadge(activeSummary.netRevenue.changePercentage, activeSummary.netRevenue.trend)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#38BDF8', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeSummary.netRevenue.formatted}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Gross revenue minus platform commissions
                  </div>
                </div>

                {/* 4. Net Profit */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(52, 211, 153, 0.35)',
                    background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Net Profit
                    </span>
                    {renderDeltaBadge(activeSummary.netProfit.changePercentage, activeSummary.netProfit.trend)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#34D399', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeSummary.netProfit.formatted}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    True retainable bottom line after booster payouts
                  </div>
                </div>
              </div>

              {/* Row 2: Operational Costs & Balances */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* 5. Booster Costs */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Booster Costs
                    </span>
                    {renderDeltaBadge(activeSummary.boosterCosts.changePercentage, activeSummary.boosterCosts.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FBBF24', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.boosterCosts.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Payouts owed / credited to boosters
                  </div>
                </div>

                {/* 6. Advertiser Costs */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Advertiser Costs
                    </span>
                    {renderDeltaBadge(activeSummary.advertiserCosts.changePercentage, activeSummary.advertiserCosts.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#EC4899', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.advertiserCosts.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Direct advertiser order payments
                  </div>
                </div>

                {/* 7. Total Withdrawals */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total Withdrawals
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#A78BFA', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.formattedTotalWithdrawals}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Successfully paid out from platform
                  </div>
                </div>

                {/* 8. Pending Withdrawals */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Pending Withdrawals
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#F59E0B', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.formattedPendingWithdrawals}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Withdrawals in queue / processing
                  </div>
                </div>

                {/* 9. Current Platform Balance */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Platform Balance
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#6EE7B7', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.formattedCurrentPlatformBalance}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Real-time available account balance
                  </div>
                </div>

                {/* 10. Pending Order Value */}
                <div className="card-surface" style={{ padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Pending Order Value
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#C084FC', margin: '4px 0', fontFamily: 'monospace' }}>
                    {activeSummary.formattedPendingOrderValue}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Locked in active in-progress orders
                  </div>
                </div>
              </div>

              {/* Row 3: Order Counts Breakdown (Total, Completed, Cancelled) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* 11. Total Orders */}
                <div className="card-surface" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Total Orders
                    </span>
                    {renderDeltaBadge(activeSummary.totalOrders.changePercentage, activeSummary.totalOrders.trend)}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', margin: '3px 0' }}>
                    {activeSummary.totalOrders.count}
                  </div>
                </div>

                {/* 12. Completed Orders */}
                <div className="card-surface" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Completed Orders
                    </span>
                    {renderDeltaBadge(activeSummary.completedOrders.changePercentage, activeSummary.completedOrders.trend)}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#34D399', margin: '3px 0' }}>
                    {activeSummary.completedOrders.count}
                  </div>
                </div>

                {/* 13. Active Orders */}
                <div className="card-surface" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Active In-Progress
                    </span>
                    {renderDeltaBadge(activeSummary.activeOrders.changePercentage, activeSummary.activeOrders.trend)}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38BDF8', margin: '3px 0' }}>
                    {activeSummary.activeOrders.count}
                  </div>
                </div>

                {/* 14. Cancelled Orders */}
                <div className="card-surface" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Cancelled Orders
                    </span>
                    {renderDeltaBadge(activeSummary.cancelledOrders.changePercentage, activeSummary.cancelledOrders.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#F87171', margin: '3px 0' }}>
                    {activeSummary.cancelledOrders.count}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────────────── */}
          {/* DEDICATED ADVERTISER BOOSTS SUMMARY (When on Advertiser Tab)          */}
          {/* ───────────────────────────────────────────────────────────────────── */}
          {activeTab === 'advertiser' && activeAdvertiserSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#F472B6', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>📢</span>
                  <span>Dedicated Advertiser Boosts Report</span>
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  All orders initiated by platform advertisers
                </span>
              </div>

              {/* KPI Cards for Advertisers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* Gross Advertiser Revenue */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(236, 72, 153, 0.3)',
                    background: 'linear-gradient(145deg, rgba(236, 72, 153, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Gross Advertiser Revenue
                    </span>
                    {renderDeltaBadge(activeAdvertiserSummary.grossAdvertiserRevenue.changePercentage, activeAdvertiserSummary.grossAdvertiserRevenue.trend)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeAdvertiserSummary.grossAdvertiserRevenue.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Total revenue generated from advertiser boosts
                  </div>
                </div>

                {/* Advertiser Fees */}
                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Advertiser Fees
                    </span>
                    {renderDeltaBadge(activeAdvertiserSummary.platformFees.changePercentage, activeAdvertiserSummary.platformFees.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F87171', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeAdvertiserSummary.platformFees.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Platform commission on advertiser orders
                  </div>
                </div>

                {/* Booster Payouts */}
                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Booster Payouts
                    </span>
                    {renderDeltaBadge(activeAdvertiserSummary.boosterPayouts.changePercentage, activeAdvertiserSummary.boosterPayouts.trend, true)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FBBF24', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeAdvertiserSummary.boosterPayouts.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Paid out to executing boosters
                  </div>
                </div>

                {/* Net Advertiser Profit */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(52, 211, 153, 0.35)',
                    background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Net Advertiser Profit
                    </span>
                    {renderDeltaBadge(activeAdvertiserSummary.netAdvertiserProfit.changePercentage, activeAdvertiserSummary.netAdvertiserProfit.trend)}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#34D399', margin: '6px 0', fontFamily: 'monospace' }}>
                    {activeAdvertiserSummary.netAdvertiserProfit.formatted}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Net profit retained by G4X on advertiser orders
                  </div>
                </div>
              </div>

              {/* Cross-Platform Origin Breakdown */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
                  Origin Platform Breakdown for Advertiser Boosts
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  {activeAdvertiserSummary.originPlatformBreakdown.map((origin) => (
                    <div
                      key={origin.platformKey}
                      style={{
                        padding: '1rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#C4B5FD', fontSize: '0.85rem' }}>
                        {origin.platformName}
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', margin: '4px 0', fontFamily: 'monospace' }}>
                        {origin.formattedGrossRevenue}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Orders: {origin.ordersCount}</span>
                        <span style={{ color: '#34D399' }}>Profit: {origin.formattedNetProfit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────────────── */}
          {/* INTERACTIVE DATA VISUALIZATIONS & SVG CHARTS                         */}
          {/* ───────────────────────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.25rem' }}>
            {/* Chart 1: Revenue & Profit Over Time */}
            <div
              className="card-surface"
              style={{
                padding: '1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                    {activeTab === 'advertiser' ? 'Advertiser Performance Over Time' : 'Revenue & Profit Over Time'}
                  </h4>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Daily / weekly breakdown of earnings
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#8B5CF6' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>Gross</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#34D399' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>Net Profit</span>
                  </div>
                </div>
              </div>

              {/* Responsive SVG Chart */}
              {chartPoints.length > 0 ? (
                <div style={{ width: '100%', height: '220px', position: 'relative' }}>
                  <svg
                    viewBox="0 0 600 200"
                    preserveAspectRatio="none"
                    style={{ width: '100%', height: '100%', overflow: 'visible' }}
                  >
                    <defs>
                      <linearGradient id="grossGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#34D399" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    {[0, 50, 100, 150].map((y) => (
                      <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2="600"
                        y2={y}
                        stroke="rgba(255, 255, 255, 0.05)"
                        strokeDasharray="4 4"
                      />
                    ))}

                    {/* Calculate Max Y for scaling */}
                    {(() => {
                      const maxVal = Math.max(
                        ...chartPoints.map((p) => Math.max(p.grossRevenueMinor, p.netProfitMinor)),
                        1000
                      );
                      const chartH = 170;
                      const chartW = 600;
                      const stepX = chartPoints.length > 1 ? chartW / (chartPoints.length - 1) : chartW;

                      const grossCoords = chartPoints.map((p, i) => {
                        const x = i * stepX;
                        const y = chartH - (p.grossRevenueMinor / maxVal) * chartH + 15;
                        return { x, y, point: p };
                      });

                      const profitCoords = chartPoints.map((p, i) => {
                        const x = i * stepX;
                        const y = chartH - (p.netProfitMinor / maxVal) * chartH + 15;
                        return { x, y, point: p };
                      });

                      const grossPath = grossCoords.reduce(
                        (acc, curr, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${curr.x} ${curr.y}`,
                        ''
                      );
                      const profitPath = profitCoords.reduce(
                        (acc, curr, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${curr.x} ${curr.y}`,
                        ''
                      );

                      return (
                        <>
                          {/* Profit Area & Line */}
                          <path
                            d={`${profitPath} L ${chartW} 185 L 0 185 Z`}
                            fill="url(#profitGradient)"
                          />
                          <path
                            d={profitPath}
                            fill="none"
                            stroke="#34D399"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />

                          {/* Gross Area & Line */}
                          <path
                            d={`${grossPath} L ${chartW} 185 L 0 185 Z`}
                            fill="url(#grossGradient)"
                          />
                          <path
                            d={grossPath}
                            fill="none"
                            stroke="#8B5CF6"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />

                          {/* Hover Dots */}
                          {grossCoords.map((c, idx) => (
                            <circle
                              key={`dot-gross-${idx}`}
                              cx={c.x}
                              cy={c.y}
                              r={hoveredChartPoint?.date === c.point.date ? 6 : 3}
                              fill="#8B5CF6"
                              stroke="#fff"
                              strokeWidth={hoveredChartPoint?.date === c.point.date ? 2 : 1}
                              style={{ cursor: 'pointer', transition: 'all 0.1s ease' }}
                              onMouseEnter={() => {
                                setHoveredChartPoint(c.point);
                              }}
                              onMouseLeave={() => setHoveredChartPoint(null)}
                            />
                          ))}

                          {profitCoords.map((c, idx) => (
                            <circle
                              key={`dot-profit-${idx}`}
                              cx={c.x}
                              cy={c.y}
                              r={hoveredChartPoint?.date === c.point.date ? 6 : 3}
                              fill="#34D399"
                              stroke="#fff"
                              strokeWidth={hoveredChartPoint?.date === c.point.date ? 2 : 1}
                              style={{ cursor: 'pointer', transition: 'all 0.1s ease' }}
                              onMouseEnter={() => {
                                setHoveredChartPoint(c.point);
                              }}
                              onMouseLeave={() => setHoveredChartPoint(null)}
                            />
                          ))}
                        </>
                      );
                    })()}
                  </svg>

                  {/* Chart Tooltip Overlay */}
                  {hoveredChartPoint && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        backgroundColor: 'rgba(15, 17, 26, 0.95)',
                        border: '1px solid rgba(139, 92, 246, 0.4)',
                        borderRadius: '8px',
                        padding: '0.6rem 0.85rem',
                        fontSize: '0.78rem',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#C4B5FD', marginBottom: '4px' }}>
                        📅 {hoveredChartPoint.label || hoveredChartPoint.date}
                      </div>
                      <div style={{ color: '#fff', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <span>Gross:</span>
                        <strong style={{ fontFamily: 'monospace' }}>
                          ${(hoveredChartPoint.grossRevenueMinor / 100).toFixed(2)}
                        </strong>
                      </div>
                      <div style={{ color: '#34D399', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <span>Net Profit:</span>
                        <strong style={{ fontFamily: 'monospace' }}>
                          ${(hoveredChartPoint.netProfitMinor / 100).toFixed(2)}
                        </strong>
                      </div>
                      <div style={{ color: '#FBBF24', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <span>Booster Payout:</span>
                        <strong style={{ fontFamily: 'monospace' }}>
                          ${(hoveredChartPoint.boosterCostsMinor / 100).toFixed(2)}
                        </strong>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                        Orders: {hoveredChartPoint.ordersCount}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  No historical order data points for selected date range
                </div>
              )}
            </div>

            {/* Chart 2: Platform Revenue Distribution or Origin Share */}
            {activeTab === 'all' && consolidatedData?.charts.platformRevenueBreakdown ? (
              <div
                className="card-surface"
                style={{
                  padding: '1.5rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: '0 0 1rem 0' }}>
                  Revenue Share by Platform (Distinct &amp; Non-Duplicative)
                </h4>

                {/* Visual Distribution Bar */}
                <div
                  style={{
                    height: '24px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    display: 'flex',
                    marginBottom: '1.25rem',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  {consolidatedData.charts.platformRevenueBreakdown.map((p, idx) => {
                    const colors = ['#8B5CF6', '#38BDF8', '#34D399', '#FBBF24', '#EC4899'];
                    const color = colors[idx % colors.length];
                    if (p.revenueSharePercentage <= 0) return null;
                    return (
                      <div
                        key={p.platformKey}
                        style={{
                          width: `${p.revenueSharePercentage}%`,
                          backgroundColor: color,
                          transition: 'width 0.3s ease',
                        }}
                        title={`${p.platformName}: ${p.revenueSharePercentage.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>

                {/* Platforms Breakdown List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {consolidatedData.charts.platformRevenueBreakdown.map((p, idx) => {
                    const colors = ['#8B5CF6', '#38BDF8', '#34D399', '#FBBF24', '#EC4899'];
                    const color = colors[idx % colors.length];
                    return (
                      <div
                        key={p.platformKey}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: color }} />
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>
                            {p.platformName}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {p.ordersCount} orders
                          </span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                            {p.formattedGrossRevenue}
                          </span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: `${color}15`,
                              minWidth: '45px',
                              textAlign: 'right',
                            }}
                          >
                            {p.revenueSharePercentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Single Platform Performance Highlights */
              <div
                className="card-surface"
                style={{
                  padding: '1.5rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: '0 0 1rem 0' }}>
                  Financial Efficiency Breakdown
                </h4>
                {activeSummary && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Efficiency metric 1: Net Margin */}
                    <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Net Margin (Profit / Gross)</span>
                        <strong style={{ color: '#34D399' }}>
                          {activeSummary.grossRevenue.valueMinor > 0
                            ? ((activeSummary.netProfit.valueMinor / activeSummary.grossRevenue.valueMinor) * 100).toFixed(1)
                            : 0}
                          %
                        </strong>
                      </div>
                      <div style={{ height: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            backgroundColor: '#34D399',
                            width: `${Math.min(
                              100,
                              Math.max(
                                0,
                                activeSummary.grossRevenue.valueMinor > 0
                                  ? (activeSummary.netProfit.valueMinor / activeSummary.grossRevenue.valueMinor) * 100
                                  : 0
                              )
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Efficiency metric 2: Platform Take-Rate (Commission / Gross) */}
                    <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Platform Fee Share</span>
                        <strong style={{ color: '#F87171' }}>
                          {activeSummary.grossRevenue.valueMinor > 0
                            ? ((activeSummary.platformFees.valueMinor / activeSummary.grossRevenue.valueMinor) * 100).toFixed(1)
                            : 0}
                          %
                        </strong>
                      </div>
                      <div style={{ height: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            backgroundColor: '#F87171',
                            width: `${Math.min(
                              100,
                              Math.max(
                                0,
                                activeSummary.grossRevenue.valueMinor > 0
                                  ? (activeSummary.platformFees.valueMinor / activeSummary.grossRevenue.valueMinor) * 100
                                  : 0
                              )
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Efficiency metric 3: Booster Share (Booster Costs / Gross) */}
                    <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Booster Payout Share</span>
                        <strong style={{ color: '#FBBF24' }}>
                          {activeSummary.grossRevenue.valueMinor > 0
                            ? ((activeSummary.boosterCosts.valueMinor / activeSummary.grossRevenue.valueMinor) * 100).toFixed(1)
                            : 0}
                          %
                        </strong>
                      </div>
                      <div style={{ height: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            backgroundColor: '#FBBF24',
                            width: `${Math.min(
                              100,
                              Math.max(
                                0,
                                activeSummary.grossRevenue.valueMinor > 0
                                  ? (activeSummary.boosterCosts.valueMinor / activeSummary.grossRevenue.valueMinor) * 100
                                  : 0
                              )
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ───────────────────────────────────────────────────────────────────── */}
          {/* DETAILED ORDERS AUDIT TABLE WITH SEARCH, FILTERS & CSV EXPORT        */}
          {/* ───────────────────────────────────────────────────────────────────── */}
          <div
            className="card-surface"
            style={{
              padding: '1.5rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {/* Table Header & Controls */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  Detailed Orders Financial Ledger
                </h4>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Total {ordersTotalCount} orders matching current reporting criteria
                </div>
              </div>

              {/* Filters & Search */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search order ref, game, advertiser..."
                  value={ordersSearch}
                  onChange={(e) => {
                    setOrdersSearch(e.target.value);
                    setOrdersPage(1);
                  }}
                  className="input"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', width: '220px' }}
                />

                <select
                  value={ordersStatus}
                  onChange={(e) => {
                    setOrdersStatus(e.target.value);
                    setOrdersPage(1);
                  }}
                  className="select"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem' }}
                >
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed / Confirmed</option>
                  <option value="active">Active In-Progress</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {/* Table Content */}
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Order Ref</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Platform</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Game</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Status</th>
                    <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Gross Revenue</th>
                    <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Platform Fee</th>
                    <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Booster Payout</th>
                    <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Net Profit</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Completed At</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        Loading orders ledger...
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No orders recorded matching the current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr
                        key={o.id}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          transition: 'background-color 0.1s ease',
                        }}
                      >
                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>
                          <span style={{ color: '#fff', fontFamily: 'monospace' }}>{o.orderRef}</span>
                          {o.isAdvertiserBoost && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '0.65rem',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(236, 72, 153, 0.2)',
                                color: '#F472B6',
                                fontWeight: 700,
                              }}
                            >
                              Advertiser
                            </span>
                          )}
                          {o.externalOrderId && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Ext: {o.externalOrderId}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              color: '#C4B5FD',
                            }}
                          >
                            {o.platformName}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)' }}>
                          {o.gameSlug}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor:
                                o.status === 'completed' || o.status === 'confirmed' || o.status === 'warranty'
                                  ? 'rgba(52, 211, 153, 0.15)'
                                  : o.status === 'cancelled'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(56, 189, 248, 0.15)',
                              color:
                                o.status === 'completed' || o.status === 'confirmed' || o.status === 'warranty'
                                  ? '#34D399'
                                  : o.status === 'cancelled'
                                  ? '#F87171'
                                  : '#38BDF8',
                            }}
                          >
                            {o.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>
                          {o.formattedGross}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#F87171' }}>
                          {o.formattedPlatformFee}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#FBBF24' }}>
                          {o.formattedBoosterCost}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', color: '#34D399' }}>
                          {o.formattedNetProfit}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {o.completedAt ? new Date(o.completedAt).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {ordersTotalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Page {ordersPage} of {ordersTotalPages} ({ordersTotalCount} items)
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    disabled={ordersPage <= 1 || ordersLoading}
                    onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    disabled={ordersPage >= ordersTotalPages || ordersLoading}
                    onClick={() => setOrdersPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
