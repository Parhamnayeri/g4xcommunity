import React from 'react';
import { Card } from '../ui/Card';
import { WalletBalanceData, WalletBreakdownData, RatesAndPoliciesData } from '../../types/wallet';

interface WalletOverviewCardsProps {
  wallet: WalletBalanceData;
  breakdown: WalletBreakdownData;
  ratesAndPolicies: RatesAndPoliciesData;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const WalletOverviewCards: React.FC<WalletOverviewCardsProps> = ({
  wallet,
  breakdown,
  ratesAndPolicies,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Header with Title and Refresh Button */}
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
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Authoritative WalletV2 Balances
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Authoritative ledger figures computed in integer USD cents.
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="btn btn-outline btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: isRefreshing ? 'rotate(360deg)' : 'none',
                transition: 'transform 0.5s ease',
              }}
            >
              ↻
            </span>
            {isRefreshing ? 'Syncing...' : 'Sync Balances'}
          </button>
        )}
      </div>

      {/* Primary Balance Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* 1. Available USD */}
        <Card highlight="lime" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Available USD
            </span>
            <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
              Liquid
            </span>
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--accent-lime)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.availableUsd}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Spendable funds ready for order funding or withdrawal.
          </p>
        </Card>

        {/* 2. Reserved USD */}
        <Card highlight="purple" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Reserved USD
            </span>
            <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
              Locked
            </span>
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--primary-purple-hover)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.reservedUsd}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Locked in active orders or in-flight withdrawal requests.
          </p>
        </Card>

        {/* 3. Pending Boost Earnings */}
        <Card highlight="none" style={{ padding: '1.25rem', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Pending Earnings
            </span>
            <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
              Escrow
            </span>
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#38bdf8', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.pendingEarningsUsd}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Unsettled boost runs awaiting completion verification.
          </p>
        </Card>

        {/* 4. Confirmed Lifetime Earnings */}
        <Card highlight="none" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Confirmed Earnings
            </span>
            <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>
              Backed
            </span>
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.confirmedEarningsUsd}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Total confirmed earnings backed by completed order runs.
          </p>
        </Card>
      </div>

      {/* Authoritative Separation Breakdown Card */}
      <Card style={{ padding: '1.25rem', backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Segregated Balance Accounting
            </span>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Separated ledger accounting ensures user earnings, advertiser deposits, and reservations are never co-mingled.
            </p>
          </div>
          <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
            Integer Cents Model
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              User Earnings (Confirmed)
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              ${breakdown.userEarningsConfirmedUsd}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Pending: ${breakdown.userEarningsPendingUsd}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Advertiser Funding Deposits
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-lime)', marginTop: '0.2rem' }}>
              ${breakdown.advertiserFundingDepositsUsd}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Backed by verified receipts
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Order Escrow Reservations
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-purple)', marginTop: '0.2rem' }}>
              ${breakdown.orderEscrowReservedUsd}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Locked in active boosts
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Withdrawal Reservations
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f59e0b', marginTop: '0.2rem' }}>
              ${breakdown.withdrawalReservedUsd}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Pending admin payout
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              External Unsettled Revenue
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              ${breakdown.externalUnsettledRevenueUsd}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Non-ledger unsettled
            </div>
          </div>
        </div>

        {/* Exchange Rate & Policy Banner */}
        <div
          style={{
            marginTop: '1.25rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(24, 21, 36, 0.8)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Authoritative Rate: </span>
              <strong style={{ fontSize: '0.85rem', color: 'var(--accent-lime)' }}>
                {ratesAndPolicies.adminUsdIrtRate
                  ? `1 USD = ${ratesAndPolicies.adminUsdIrtRate.toLocaleString()} Toman`
                  : 'Rate Not Configured'}
              </strong>
            </div>

            {ratesAndPolicies.incomingIrtFeeRate !== null && (
              <div>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Deposit Fee: </span>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {(ratesAndPolicies.incomingIrtFeeRate * 100).toFixed(1)}%
                </strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                backgroundColor: ratesAndPolicies.liveCreditsEnabled ? 'rgba(204, 255, 0, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: ratesAndPolicies.liveCreditsEnabled ? 'var(--accent-lime)' : '#ef4444',
                fontWeight: 600,
              }}
            >
              {ratesAndPolicies.liveCreditsEnabled ? 'Live Credits: Enabled' : 'Live Credits: Protected (Awaiting Approval)'}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};
