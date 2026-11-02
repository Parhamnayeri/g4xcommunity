import React from 'react';
import { Card } from '../ui/Card';
import { WithdrawalWalletData } from '../../types/withdraw';

interface WithdrawalOverviewCardsProps {
  wallet: WithdrawalWalletData;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const WithdrawalOverviewCards: React.FC<WithdrawalOverviewCardsProps> = ({
  wallet,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Authoritative Withdrawal Balances
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Real-time balance breakdown derived from WalletV2 integer cents.
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="btn btn-outline btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span style={{ display: 'inline-block', transform: isRefreshing ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s ease' }}>
              ↻
            </span>
            {isRefreshing ? 'Refreshing...' : 'Refresh Balances'}
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* 1. Available Balance */}
        <Card highlight="lime" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Available Balance
            </span>
            <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
              Liquid
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--accent-lime)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.availableUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Settled backed funds ready for withdrawal request.
          </p>
        </Card>

        {/* 2. Amount Eligible to Request */}
        <Card highlight="none" style={{ padding: '1.25rem', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Eligible to Request
            </span>
            <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
              Gross
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--status-info)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.eligibleWithdrawalUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Before method-specific fees ($0.40 USDT / $1.30 IRT).
          </p>
        </Card>

        {/* 3. Reserved Liability */}
        <Card highlight="purple" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Reserved USD
            </span>
            <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
              Locked
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--primary-purple)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.reservedUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Locked in submitted requests awaiting admin payout.
          </p>
        </Card>

        {/* 4. In-Flight Requests */}
        <Card highlight="none" style={{ padding: '1.25rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Pending Requests
            </span>
            <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
              In-Flight
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--status-warning)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.pendingWithdrawalRequestsUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Sum of active requests in review or batch schedule.
          </p>
        </Card>

        {/* 5. Confirmed Earnings */}
        <Card highlight="none" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Confirmed Earnings
            </span>
            <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
              Audit
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.confirmedEarningsUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Verified releases from completed boosting orders.
          </p>
        </Card>

        {/* 6. Total Previously Paid */}
        <Card highlight="none" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Total Paid
            </span>
            <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
              Historical
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--status-success)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.35rem' }}>
            ${wallet.totalPaidUsd}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, margin: 0 }}>
            Authoritative historical sum of verified disbursements.
          </p>
        </Card>
      </div>
    </div>
  );
};
