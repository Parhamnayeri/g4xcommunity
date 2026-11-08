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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Financial Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Unified USD Wallet (V2)</h2>
            <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
              Double-Entry Ledger
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Authoritative balances calculated from immutable integer cent journal entries.
          </p>
        </div>

        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            isLoading={isRefreshing}
            leftIcon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            }
          >
            Refresh Balances
          </Button>
        )}
      </div>

      {/* 4 Primary Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* 1. Available USD */}
        <Card highlight="lime" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Available Balance
            </span>
            <span className="badge badge-lime" style={{ fontSize: '0.68rem' }}>
              Liquid
            </span>
          </div>
          <div
            style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: 'var(--accent-lime)',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              marginBottom: '0.4rem',
            }}
          >
            ${wallet.availableUsd}
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            Settled funds available for withdrawals or boost orders.
          </p>
        </Card>

        {/* 2. Pending Earnings */}
        <Card highlight="none" style={{ padding: '1.25rem', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Pending Earnings
            </span>
            <span
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                color: 'var(--status-warning)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '0.15rem 0.45rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              24h Holding
            </span>
          </div>
          <div
            style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: '#fde68a',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              marginBottom: '0.4rem',
            }}
          >
            ${wallet.pendingEarningsUsd}
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            Completed runs awaiting mandatory 24-hour escrow holding.
          </p>
        </Card>

        {/* 3. Reserved USD */}
        <Card highlight="purple" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Reserved Liability
            </span>
            <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
              Locked
            </span>
          </div>
          <div
            style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: '#c4b5fd',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              marginBottom: '0.4rem',
            }}
          >
            ${wallet.reservedUsd}
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            Locked in active withdrawal requests or P2P gold reservations.
          </p>
        </Card>

        {/* 4. Confirmed Lifetime Earnings */}
        <Card highlight="none" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Confirmed Earnings
            </span>
            <span className="badge badge-muted" style={{ fontSize: '0.68rem' }}>
              Historical
            </span>
          </div>
          <div
            style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              marginBottom: '0.4rem',
            }}
          >
            ${wallet.confirmedEarningsUsd}
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            Total released earnings historically verified by platform administration.
          </p>
        </Card>
      </div>

      {/* Eligible Withdrawal Sub-banner */}
      <div
        style={{
          backgroundColor: 'rgba(24, 21, 36, 0.6)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.9rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          fontSize: '0.88rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.2rem' }}>💳</span>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Eligible to Request (Gross Liquid): </span>
            <span style={{ fontWeight: 800, color: 'var(--accent-lime)' }}>
              ${wallet.eligibleWithdrawalUsd} USD
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
              Method fees apply upon submission: $0.40 (USDT BEP-20) or $1.30 (IRT Bank). Wednesday &amp; Saturday cycles.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a href="/withdraw" className="btn btn-outline btn-sm">
            Manage &amp; Withdraw &rarr;
          </a>
        </div>
      </div>
    </div>
  );
};
