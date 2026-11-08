import React from 'react';
import { AdvertiserPerformance } from '../../types/advertiser';

interface AdvertiserMetricsProps {
  performance: AdvertiserPerformance;
}

export const AdvertiserMetrics: React.FC<AdvertiserMetricsProps> = ({ performance }) => {
  const cards = [
    {
      title: 'Total Orders Created',
      value: performance.totalOrdersCreated,
      icon: '📦',
      color: 'var(--text-primary, #f4f4f6)',
      borderColor: 'rgba(124, 58, 237, 0.25)',
    },
    {
      title: 'Active Orders',
      value: performance.activeOrdersCount,
      icon: '⚡',
      color: 'var(--accent-lime, #ccff00)',
      borderColor: 'rgba(204, 255, 0, 0.3)',
    },
    {
      title: 'Completed Orders',
      value: performance.completedOrdersCount,
      icon: '✅',
      color: '#34d399',
      borderColor: 'rgba(52, 211, 153, 0.3)',
    },
    {
      title: 'Cancelled Orders',
      value: performance.cancelledOrdersCount,
      icon: '❌',
      color: '#f87171',
      borderColor: 'rgba(248, 113, 113, 0.3)',
    },
    {
      title: 'Settled Boost Volume',
      value: `$${performance.totalGrossVolumeUsd}`,
      icon: '📊',
      color: '#a78bfa',
      borderColor: 'rgba(167, 139, 250, 0.3)',
    },
    {
      title: 'Total G4X Fees Paid',
      value: `$${performance.totalPlatformFeesPaidUsd}`,
      icon: '🛡️',
      color: 'var(--text-muted, #9490a6)',
      borderColor: 'rgba(148, 144, 166, 0.25)',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '1rem',
      }}
    >
      {cards.map((card, idx) => (
        <div
          key={idx}
          style={{
            backgroundColor: 'var(--bg-surface, #181524)',
            borderRadius: '14px',
            border: `1px solid ${card.borderColor}`,
            padding: '1.25rem 1rem',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted, #9490a6)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {card.title}
            </span>
            <span style={{ fontSize: '1.1rem' }}>{card.icon}</span>
          </div>

          <div
            style={{
              fontSize: '1.6rem',
              fontWeight: 800,
              color: card.color,
              fontFamily: 'monospace',
              letterSpacing: '-0.02em',
            }}
          >
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
};
