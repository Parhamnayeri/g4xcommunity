import React from 'react';

export type DepositMethod = 'irt' | 'crypto';

interface DepositMethodSelectorProps {
  activeMethod: DepositMethod;
  onChange: (method: DepositMethod) => void;
  isCryptoActive: boolean;
}

export const DepositMethodSelector: React.FC<DepositMethodSelectorProps> = ({
  activeMethod,
  onChange,
  isCryptoActive,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
      <div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
          Select Deposit Method
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Choose your funding rail. All requests require independent evidence verification before wallet crediting.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Method 1: Card-to-Card IRT */}
        <button
          type="button"
          onClick={() => onChange('irt')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.1rem 1.25rem',
            backgroundColor: activeMethod === 'irt' ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
            border: activeMethod === 'irt' ? '2px solid var(--accent-lime)' : '1px solid var(--border-subtle)',
            borderRadius: '8px',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            boxShadow: activeMethod === 'irt' ? '0 0 15px rgba(204, 255, 0, 0.15)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                backgroundColor: activeMethod === 'irt' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(124, 58, 237, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
              }}
            >
              💳
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Card-to-Card (IRT)
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Official Iranian bank transfer with screenshot receipt
              </div>
            </div>
          </div>
          <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
            Supported
          </span>
        </button>

        {/* Method 2: Cryptocurrency (USDT BEP-20) */}
        <button
          type="button"
          onClick={() => onChange('crypto')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.1rem 1.25rem',
            backgroundColor: activeMethod === 'crypto' ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
            border: activeMethod === 'crypto' ? '2px solid var(--primary-purple)' : '1px solid var(--border-subtle)',
            borderRadius: '8px',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            boxShadow: activeMethod === 'crypto' ? '0 0 15px rgba(124, 58, 237, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
              }}
            >
              🪙
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Crypto (NOWPayments)
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                USDT (BEP-20) / BTC / ETH automated collection
              </div>
            </div>
          </div>
          <span
            className={isCryptoActive ? 'badge badge-purple' : 'badge badge-gray'}
            style={{ fontSize: '0.65rem' }}
          >
            {isCryptoActive ? 'Live Collection' : 'Inactive Gate'}
          </span>
        </button>
      </div>
    </div>
  );
};
