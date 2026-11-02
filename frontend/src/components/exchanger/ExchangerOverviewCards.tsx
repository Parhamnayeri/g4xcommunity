import React from 'react';
import { ExchangerOverviewResponse } from '../../types/exchange';

interface ExchangerOverviewCardsProps {
  overview: ExchangerOverviewResponse;
}

export const ExchangerOverviewCards: React.FC<ExchangerOverviewCardsProps> = ({ overview }) => {
  const { exchanger, wallet, metrics, featureGates } = overview;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '28px' }}>
      {/* Exchanger Profile Header Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: 'rgba(124, 58, 237, 0.2)',
              border: '2px solid var(--primary-purple)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}
          >
            🛡️
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.3rem' }}>
                {exchanger.displayName || exchanger.username}
              </h2>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                ✓ Approved Exchanger
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Discord ID: <span style={{ fontFamily: 'monospace' }}>{exchanger.discordId}</span>
            </p>
          </div>
        </div>

        {/* Financial Gate Indicator */}
        <div
          style={{
            padding: '8px 14px',
            backgroundColor: featureGates.p2pSettlementEnabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            border: `1px solid ${featureGates.p2pSettlementEnabled ? '#10b981' : '#f59e0b'}`,
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: featureGates.p2pSettlementEnabled ? '#10b981' : '#f59e0b',
          }}
        >
          <strong>Settlement Engine: </strong>
          {featureGates.p2pSettlementEnabled ? 'Live P2P Settlement' : 'Manual Review Gate (Safe)'}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {/* Wallet Balance Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '18px',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Prepaid USD Wallet
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--accent-lime)', marginTop: '8px' }}>
            ${(wallet.availableCents / 100).toFixed(2)} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>USD</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Reserved: ${(wallet.reservedCents / 100).toFixed(2)} USD
          </div>
        </div>

        {/* Active Offers */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '18px',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active Offers
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '8px' }}>
            {metrics.activeOffersCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Published on public marketplace
          </div>
        </div>

        {/* Pending Trades */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '18px',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Awaiting Action
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f59e0b', marginTop: '8px' }}>
            {metrics.pendingDeliveryCount + metrics.pendingPaymentCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            {metrics.pendingDeliveryCount} delivery, {metrics.pendingPaymentCount} payment
          </div>
        </div>

        {/* Settled Volume */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '18px',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Settled Trades
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#10b981', marginTop: '8px' }}>
            {metrics.settledTradesCount}{' '}
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              (${metrics.settledVolumeUsdCents ? (metrics.settledVolumeUsdCents / 100).toFixed(0) : '0'})
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Across {metrics.totalTradesCount} lifetime trades
          </div>
        </div>
      </div>
    </div>
  );
};
