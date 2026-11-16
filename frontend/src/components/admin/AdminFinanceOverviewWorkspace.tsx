import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingState } from '../ui/LoadingState';
import { fetchOwnerFinanceOverview } from '../../services/ownerPortal';
import { AdminFinanceOverviewResponse } from '../../types/adminPortal';
import { PlatformBalancesStrip } from './PlatformBalancesStrip';

interface Props {
  onNavigateTab?: (tab: string) => void;
}

export const AdminFinanceOverviewWorkspace: React.FC<Props> = ({ onNavigateTab }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminFinanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOwnerFinanceOverview();
      if (res?.success) {
        setData(res);
        setLastRefreshedAt(new Date());
      } else {
        setError('Server returned unsuccessful response');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch financial overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenWithdrawals = () => {
    if (onNavigateTab) {
      onNavigateTab('withdrawals');
    } else {
      navigate('/owner?tab=withdrawals');
    }
  };

  const handleOpenOrders = (platform?: string) => {
    if (onNavigateTab) {
      onNavigateTab('orders');
    } else {
      navigate(platform ? `/owner?tab=orders&source=${platform}` : '/owner?tab=orders');
    }
  };

  if (loading && !data) {
    return (
      <div className="card-surface" style={{ padding: '3rem', minHeight: '300px' }}>
        <LoadingState message="Aggregating ecosystem financial ledgers & platform balances..." />
      </div>
    );
  }

  const totals = data?.totals;
  const platforms = data?.byPlatform || [];
  const filteredPlatforms = selectedPlatform
    ? platforms.filter((p) => p.source.toLowerCase() === selectedPlatform.toLowerCase())
    : platforms;

  const isSolvent = (totals?.netLiquidReserveMinor || 0) >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Workspace Header */}
      <div
        className="card-surface"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.25rem',
          borderLeft: '4px solid var(--accent-yellow)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.3rem' }}>💰</span>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: '#fff' }}>
              Authoritative Financial Overview &amp; Liquidity Engine
            </h2>
            <span className="badge badge-yellow" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
              Ecosystem Reserves
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.6rem', borderRadius: '6px', background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.35)' }}>
              <span style={{ fontSize: '0.72rem', color: '#C4B5FD', fontWeight: 600 }}>💵 Dollar Price:</span>
              <strong style={{ fontSize: '0.82rem', color: '#fff', fontFamily: 'monospace' }}>
                {totals?.dollarRateFormatted || (totals?.dollarRate ? `${totals.dollarRate.toLocaleString()} Toman` : '90,000 Toman')}
              </strong>
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: 0 }}>
            Unified real-time tracking across 6 platform sources, booster escrow liabilities, and liquidity solvency.
            Dollar rate sourced live from <strong>Financial Configuration</strong>.
            Last reconciled: <strong style={{ color: '#fff' }}>{lastRefreshedAt.toLocaleTimeString()}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadData}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : '↻ Refresh Financials'}
          </button>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={handleOpenWithdrawals}
          >
            💸 Open Payout Queue &rarr;
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--status-danger)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          {error}
        </div>
      )}

      {/* Top Executive KPI Cards */}
      {totals && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* KPI 0: Dollar Rate from Financial Config */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.4)', background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(109,40,217,0.03) 100%)' }}>
            <div style={{ fontSize: '0.68rem', color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Dollar Price / نرخ دلار</span>
              <span style={{ fontSize: '0.62rem', background: '#7C3AED', color: '#fff', padding: '1px 5px', borderRadius: '3px' }}>Live Config</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', color: '#DDD6FE', margin: '4px 0 2px' }}>
              {totals.dollarRateFormatted || (totals.dollarRate ? `${totals.dollarRate.toLocaleString()} Toman` : '90,000 Toman')}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Source: <strong>SystemFinancialConfig</strong>
            </div>
          </div>

          {/* KPI 1: Gross Platform Volume */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Total Gross Volume
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: '#fff', margin: '4px 0 2px' }}>
              {totals.grossVolumeUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {totals.grossVolumeToman ? <strong style={{ color: '#C4B5FD' }}>{totals.grossVolumeToman}</strong> : `Completed: ${totals.completedVolumeUsd}`}
            </div>
          </div>

          {/* KPI 2: Net Platform Retained Profit */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Net G4X Retained Margin
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: '#34D399', margin: '4px 0 2px' }}>
              {totals.netPlatformProfitUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {totals.netPlatformProfitToman ? <strong style={{ color: '#34D399' }}>{totals.netPlatformProfitToman}</strong> : 'Platform cuts & commission fees'}
            </div>
          </div>

          {/* KPI 3: Booster Pool Allocation */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Booster Pool Allocation
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent-yellow)', margin: '4px 0 2px' }}>
              {totals.boosterPoolUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {totals.boosterPoolToman ? <strong style={{ color: 'var(--accent-yellow)' }}>{totals.boosterPoolToman}</strong> : 'Payable pool to active rosters'}
            </div>
          </div>

          {/* KPI 4: Active Escrow Liability */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Active Escrow Volume
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: '#FBBF24', margin: '4px 0 2px' }}>
              {totals.activeEscrowUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {totals.activeEscrowToman ? <strong style={{ color: '#FBBF24' }}>{totals.activeEscrowToman}</strong> : 'In-progress orders pending proof'}
            </div>
          </div>

          {/* KPI 5: Pending Withdrawals */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Pending USDT Payouts
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: '#F87171', margin: '4px 0 2px' }}>
              {totals.pendingWithdrawalsUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <strong>{totals.pendingWithdrawalsCount}</strong> claims {totals.pendingWithdrawalsToman ? `(${totals.pendingWithdrawalsToman})` : 'in queue'}
            </div>
          </div>

          {/* KPI 6: Net Liquid Reserve */}
          <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Net Liquid Surplus
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'monospace', color: isSolvent ? '#38BDF8' : '#EF4444', margin: '4px 0 2px' }}>
              {totals.netLiquidReserveUsd}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {totals.netLiquidReserveToman ? <strong style={{ color: isSolvent ? '#38BDF8' : '#EF4444' }}>{totals.netLiquidReserveToman}</strong> : 'Liquid margin after pending claims'}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Platform Balances Strip */}
      <div className="card-surface" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <PlatformBalancesStrip
          breakdown={platforms}
          selectedPlatform={selectedPlatform}
          onSelectPlatform={(src) => setSelectedPlatform(src)}
          loading={loading}
        />
      </div>

      {/* Comparative Per-Platform Data Table */}
      <div className="card-surface" style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#fff' }}>
              Multi-Platform Financial Ledger Comparison
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Authoritative ledger metrics broken down by external partner and direct website orders.
            </p>
          </div>
          {selectedPlatform && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setSelectedPlatform('')}
            >
              Show All Platforms
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Platform Source</th>
                <th>Fee Cut Policy</th>
                <th>Order Activity</th>
                <th>Gross Volume</th>
                <th>Fee Cut Deducted</th>
                <th>Net G4X Margin</th>
                <th>Booster Pool</th>
                <th>Available Balance</th>
                <th>Pending Release</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlatforms.map((p) => (
                <tr key={p.source}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.1rem' }}>{p.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, color: '#fff' }}>{p.displayName}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          source: {p.source}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                      {p.feeRatePercent}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.82rem', color: '#fff' }}>
                      <strong>{p.orderCounts.active}</strong> active / {p.orderCounts.total} total
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {p.orderCounts.completed} completed · {p.orderCounts.cancelled} cancelled
                    </div>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>
                      {p.grossVolumeUsd}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', color: '#F87171' }}>
                      {p.feeDeductedUsd}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#34D399' }}>
                      {p.netRevenueUsd}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-yellow)' }}>
                      {p.boosterPoolUsd}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: p.availableBalanceMinor > 0 ? 'var(--accent-yellow)' : '#94A3B8',
                      }}
                    >
                      {p.availableBalanceUsd}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', color: '#FBBF24' }}>
                      {p.pendingReleaseUsd}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => handleOpenOrders(p.source)}
                      title={`Inspect ${p.displayName} orders in workspace`}
                    >
                      Orders &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payout & Liquidity Health Panel */}
      {totals && (
        <div
          className="card-surface"
          style={{
            padding: '1.75rem',
            borderRadius: '12px',
            border: isSolvent ? '1px solid rgba(52, 211, 153, 0.25)' : '1px solid rgba(239, 68, 68, 0.3)',
            backgroundColor: isSolvent ? 'rgba(52, 211, 153, 0.04)' : 'rgba(239, 68, 68, 0.04)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '1.25rem' }}>{isSolvent ? '🛡️' : '⚠️'}</span>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: isSolvent ? '#34D399' : '#EF4444' }}>
                Liquidity Health &amp; Payout Solvency: {isSolvent ? 'Fully Backed' : 'Reserve Attention Required'}
              </h4>
            </div>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
              The platform maintains an authoritative reserve across active seller accounts and internal treasury.
              Current total booster wallet liabilities equal <strong style={{ color: '#fff' }}>{totals.boosterWalletLiabilityUsd}</strong>,
              with <strong style={{ color: '#fff' }}>{totals.pendingWithdrawalsUsd}</strong> pending immediate disbursement.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleOpenOrders()}
            >
              Inspect All Orders
            </button>
            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={handleOpenWithdrawals}
            >
              Open Payout Queue ({totals.pendingWithdrawalsCount} Pending) &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
