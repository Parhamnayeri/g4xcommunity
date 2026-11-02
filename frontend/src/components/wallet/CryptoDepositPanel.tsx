import React from 'react';
import { Card } from '../ui/Card';
import { RatesAndPoliciesData } from '../../types/wallet';

interface CryptoDepositPanelProps {
  ratesAndPolicies: RatesAndPoliciesData;
}

export const CryptoDepositPanel: React.FC<CryptoDepositPanelProps> = ({ ratesAndPolicies }) => {
  return (
    <Card style={{ padding: '1.75rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
              Cryptocurrency Deposit Rail (NOWPayments)
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Automated invoice generation for USDT (BEP-20), Bitcoin, and Ethereum.
            </p>
          </div>
          <span
            className={ratesAndPolicies.isCryptoActive ? 'badge badge-purple' : 'badge badge-gray'}
            style={{ fontSize: '0.7rem' }}
          >
            {ratesAndPolicies.isCryptoActive ? 'Gate Active' : 'Collection Inactive'}
          </span>
        </div>
      </div>

      {/* Disabled / Fail-Closed Notice State */}
      <div
        style={{
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          backgroundColor: 'var(--bg-main)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            backgroundColor: 'rgba(124, 58, 237, 0.15)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
          }}
        >
          🔒
        </div>

        <div style={{ maxWidth: '520px' }}>
          <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
            Automated Crypto Deposits Temporarily Unavailable
          </h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            In strict compliance with G4X financial safety policy, live cryptocurrency invoice and address creation is
            currently disabled (<code style={{ color: 'var(--text-primary)', fontSize: '0.78rem' }}>NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false</code>).
            No external deposit addresses or invoices will be issued until authorized by management.
          </p>
        </div>

        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.75rem 1.25rem',
            backgroundColor: 'rgba(24, 21, 36, 0.8)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>💡</span>
          <span>
            Please use the <strong>Manual IRT Bank Transfer (کارت به کارت)</strong> method above to fund your wallet, or contact financial management.
          </span>
        </div>

        {/* Feature Gate Safeguard Badges */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
          <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
            NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
          </span>
          <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
            FINANCE_V2_LIVE_CREDITS_ENABLED=false
          </span>
          <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
            Zero Exposure of Provider Secrets
          </span>
        </div>
      </div>
    </Card>
  );
};
