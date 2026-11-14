import React from 'react';
import { AdvertiserRankData } from '../../types/advertiser';

interface AdvertiserRankCardProps {
  rankData: AdvertiserRankData;
}

export const AdvertiserRankCard: React.FC<AdvertiserRankCardProps> = ({ rankData }) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface, #181524)',
        borderRadius: '16px',
        border: '1px solid rgba(124, 58, 237, 0.25)',
        padding: '1.75rem',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* Title & Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2
            style={{
              fontSize: '1.2rem',
              fontWeight: 800,
              color: 'var(--text-primary, #f4f4f6)',
              margin: '0 0 0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>🏆</span> Commercial Advertiser Ranks &amp; Fees
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #9490a6)' }}>
            Authoritative platform fee schedule applied to your direct boost orders.
          </p>
        </div>

        <div
          style={{
            backgroundColor: 'rgba(204, 255, 0, 0.1)',
            border: '1px solid rgba(204, 255, 0, 0.35)',
            borderRadius: '10px',
            padding: '0.4rem 0.9rem',
            textAlign: 'right',
          }}
        >
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #9490a6)', textTransform: 'uppercase' }}>
            Current Rate:
          </span>{' '}
          <strong style={{ color: 'var(--accent-lime, #ccff00)', fontSize: '1rem', fontFamily: 'monospace' }}>
            {rankData.commissionPercent}
          </strong>
        </div>
      </div>

      {/* Rank Hierarchy Table */}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Rank Tier</th>
              <th>Platform Fee</th>
              <th>Basis Points</th>
              <th>Description</th>
              <th style={{ textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rankData.rankHierarchy.map((item) => {
              const isCurrent = item.isCurrent;
              return (
                <tr
                  key={item.rank}
                  style={{
                    backgroundColor: isCurrent ? 'rgba(139, 92, 246, 0.12)' : undefined,
                  }}
                >
                  <td style={{ fontWeight: isCurrent ? 800 : 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isCurrent ? (
                        <span style={{ color: 'var(--accent-yellow)' }}>⭐</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>•</span>
                      )}
                      <span style={{ color: isCurrent ? '#ffffff' : 'var(--text-primary)' }}>
                        {item.label}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: isCurrent ? 'var(--accent-yellow)' : 'var(--primary-purple)',
                    }}
                  >
                    {item.percentage}
                  </td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {item.basisPoints} bps
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {item.description}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {isCurrent ? (
                      <span className="badge badge-yellow">
                        Active Tier
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Financial Immutability Notice */}
      <div
        style={{
          backgroundColor: 'rgba(13, 11, 18, 0.5)',
          borderRadius: '10px',
          border: '1px solid rgba(124, 58, 237, 0.2)',
          padding: '0.75rem 1rem',
          fontSize: '0.8rem',
          color: 'var(--text-muted, #9490a6)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.6rem',
        }}
      >
        <span style={{ fontSize: '1rem' }}>ℹ️</span>
        <div>
          <strong style={{ color: 'var(--text-primary, #f4f4f6)' }}>Accounting Integrity Rule:</strong> When an order
          is placed, G4X takes an immutable snapshot of your active rank commission rate. If your commercial rank changes in
          the future, earlier active and completed orders retain their historical snapshot rates and will never be
          retroactively recalculated.
        </div>
      </div>
    </div>
  );
};
