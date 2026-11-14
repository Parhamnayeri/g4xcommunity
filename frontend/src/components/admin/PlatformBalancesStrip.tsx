import React from 'react';
import { PlatformFinanceBreakdown } from '../../types/adminPortal';

interface Props {
  breakdown: PlatformFinanceBreakdown[];
  selectedPlatform?: string;
  onSelectPlatform?: (source: string) => void;
  loading?: boolean;
}

export const PlatformBalancesStrip: React.FC<Props> = ({
  breakdown,
  selectedPlatform,
  onSelectPlatform,
  loading = false,
}) => {
  if (loading && (!breakdown || breakdown.length === 0)) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.85rem',
          padding: '0.5rem 0',
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            style={{
              height: '130px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              animation: 'pulse 1.5s infinite',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Platform Balances &amp; Volume
          </span>
          <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
            {breakdown.length} Ecosystem Sources
          </span>
        </div>
        {selectedPlatform && onSelectPlatform && (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => onSelectPlatform('')}
            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
          >
            ✕ Reset Platform Filter
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '0.85rem',
        }}
      >
        {breakdown.map((p) => {
          const isSelected = selectedPlatform?.toLowerCase() === p.source.toLowerCase();
          const hasBalance = p.availableBalanceMinor > 0;

          return (
            <div
              key={p.source}
              role={onSelectPlatform ? 'button' : undefined}
              tabIndex={onSelectPlatform ? 0 : undefined}
              onClick={() => {
                if (onSelectPlatform) {
                  onSelectPlatform(isSelected ? '' : p.source);
                }
              }}
              onKeyDown={(e) => {
                if (onSelectPlatform && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSelectPlatform(isSelected ? '' : p.source);
                }
              }}
              style={{
                background: isSelected
                  ? 'linear-gradient(145deg, rgba(250, 204, 21, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)'
                  : 'rgba(14, 16, 23, 0.85)',
                border: isSelected
                  ? '1px solid rgba(250, 204, 21, 0.65)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: isSelected
                  ? '0 0 16px rgba(250, 204, 21, 0.12), inset 0 0 8px rgba(250, 204, 21, 0.05)'
                  : 'none',
                borderRadius: '12px',
                padding: '14px 16px',
                cursor: onSelectPlatform ? 'pointer' : 'default',
                transition: 'all 0.18s ease-in-out',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                userSelect: 'none',
              }}
            >
              {/* Card Header: Icon, Name & Cut badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '1.05rem' }}>{p.icon}</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: isSelected ? 'var(--accent-yellow)' : '#fff' }}>
                    {p.displayName}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: ['13%', '8.99%'].some((cut) => p.feeRatePercent.includes(cut))
                      ? 'rgba(139, 92, 246, 0.18)'
                      : 'rgba(255, 255, 255, 0.08)',
                    color: ['13%', '8.99%'].some((cut) => p.feeRatePercent.includes(cut))
                      ? '#C4B5FD'
                      : '#94A3B8',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  {p.feeRatePercent}
                </span>
              </div>

              {/* Middle: Available Balance */}
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Available Balance
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    color: hasBalance ? 'var(--accent-yellow)' : '#94A3B8',
                    letterSpacing: '-0.02em',
                    marginTop: '1px',
                  }}
                >
                  {p.availableBalanceUsd}
                </div>
              </div>

              {/* Bottom Metrics: Gross Volume, Net Cut & Orders */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.35rem 0.5rem',
                  fontSize: '0.75rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.66rem' }}>GROSS VOL</span>
                  <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>{p.grossVolumeUsd}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.66rem' }}>NET PROFIT</span>
                  <span style={{ color: '#34D399', fontWeight: 600, fontFamily: 'monospace' }}>{p.netRevenueUsd}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.66rem' }}>ORDERS</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#fff' }}>{p.orderCounts.active}</strong> active / {p.orderCounts.total}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.66rem' }}>PENDING RELEASE</span>
                  <span style={{ color: '#FBBF24', fontFamily: 'monospace', fontWeight: 600 }}>{p.pendingReleaseUsd}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
