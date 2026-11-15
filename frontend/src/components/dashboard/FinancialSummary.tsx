import React from 'react';
import { WalletOverviewData } from '../../types/dashboard';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export interface FinancialSummaryProps {
  wallet: WalletOverviewData;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export const FinancialSummary: React.FC<FinancialSummaryProps> = ({
  wallet,
  isRefreshing = false,
  onRefresh,
}) => {
  // Extract values with graceful fallbacks
  const availableUsd = wallet.availableUsd || (wallet.availableCents / 100).toFixed(2);
  const pendingUsd = wallet.pendingWithdrawalsUsd ?? wallet.reservedUsd ?? '0.00';
  const pendingCount = wallet.pendingWithdrawalsCount ?? (Number(pendingUsd) > 0 ? 1 : 0);
  const activeOrdersUsd = wallet.inActiveOrdersUsd ?? wallet.pendingEarningsUsd ?? '0.00';
  const totalEarningsUsd = wallet.totalEarningsUsd ?? wallet.lifetimeEarnedUsd ?? '0.00';

  const pendingSubtitle =
    pendingCount > 0
      ? `${pendingCount} request${pendingCount !== 1 ? 's' : ''} processing`
      : 'No pending requests';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ─── Financial Section Header: My Wallet & Action Buttons ─────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '0.25rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.25rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              My Wallet
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '9999px',
                padding: '0.2rem 0.65rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  boxShadow: '0 0 6px #10b981',
                }}
              />
              Active
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Authoritative double-entry ledger with strict financial isolation.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              isLoading={isRefreshing}
              title="Refresh wallet balances"
              leftIcon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              }
            >
              Refresh
            </Button>
          )}

          <a
            href="/withdraw"
            className="btn btn-primary btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontWeight: 700,
              padding: '0.45rem 1rem',
              boxShadow: '0 2px 10px rgba(16, 185, 129, 0.25)',
              textDecoration: 'none',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            Withdraw Funds
          </a>
        </div>
      </div>

      {/* ─── The 4 Primary Revenue Cards (Main Focus of Dashboard) ─────────── */}
      <div
        className="wallet-cards-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Card 1: Available Balance */}
        <Card
          highlight="lime"
          style={{
            padding: '1.25rem',
            backgroundColor: 'rgba(20, 24, 22, 0.75)',
            borderColor: 'rgba(16, 185, 129, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                }}
              >
                Available Balance
              </span>
              <span
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                Liquid
              </span>
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 900,
                color: 'var(--accent-lime, #10b981)',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                margin: '0.2rem 0',
              }}
            >
              ${availableUsd}
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#a7f3d0' }}>
              Ready to withdraw
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0', lineHeight: 1.25 }}>
              Settled balance ready for payout or funding orders.
            </p>
          </div>
        </Card>

        {/* Card 2: Pending Withdrawals */}
        <Card
          highlight="none"
          style={{
            padding: '1.25rem',
            backgroundColor: 'rgba(28, 24, 18, 0.75)',
            borderColor: 'rgba(245, 158, 11, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                }}
              >
                Pending Withdrawals
              </span>
              <span
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#fbbf24',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                In Queue
              </span>
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 900,
                color: '#fbbf24',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                margin: '0.2rem 0',
              }}
            >
              ${pendingUsd}
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fde68a' }}>
              {pendingSubtitle}
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0', lineHeight: 1.25 }}>
              Reserved funds scheduled for disbursement cycles.
            </p>
          </div>
        </Card>

        {/* Card 3: In Active Orders */}
        <Card
          highlight="none"
          style={{
            padding: '1.25rem',
            backgroundColor: 'rgba(16, 24, 32, 0.75)',
            borderColor: 'rgba(56, 189, 248, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                }}
              >
                In Active Orders
              </span>
              <span
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                Active Runs
              </span>
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 900,
                color: '#38bdf8',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                margin: '0.2rem 0',
              }}
            >
              ${activeOrdersUsd}
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#bae6fd' }}>
              Not yet released
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0', lineHeight: 1.25 }}>
              Funds engaged in ongoing orders or pending verification.
            </p>
          </div>
        </Card>

        {/* Card 4: Total Earnings */}
        <Card
          highlight="none"
          style={{
            padding: '1.25rem',
            backgroundColor: 'rgba(24, 20, 36, 0.75)',
            borderColor: 'rgba(168, 85, 247, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                }}
              >
                Total Earnings
              </span>
              <span
                style={{
                  backgroundColor: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                Lifetime
              </span>
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 900,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                margin: '0.2rem 0',
              }}
            >
              ${totalEarningsUsd}
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e9d5ff' }}>
              Lifetime net earnings
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0', lineHeight: 1.25 }}>
              Cumulative net income credited across all finalized orders.
            </p>
          </div>
        </Card>
      </div>

      {/* ─── Financial Separation Assurance Sub-Banner ─────────────────────── */}
      <div
        style={{
          backgroundColor: 'rgba(20, 18, 30, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 'var(--radius-sm, 8px)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          fontSize: '0.84rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>🔒</span>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Financial Separation Principle: </span>
            <strong style={{ color: '#ffffff' }}>Available Balance (${availableUsd})</strong>
            <span style={{ color: 'var(--text-muted)' }}> is strictly isolated from Pending Withdrawals (${pendingUsd}) and Active Order commitments (${activeOrdersUsd}).</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <a
            href="/withdraw"
            style={{
              color: 'var(--accent-lime, #10b981)',
              fontWeight: 600,
              fontSize: '0.82rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            Manage Payouts &rarr;
          </a>
        </div>
      </div>
    </div>
  );
};
export default FinancialSummary;
