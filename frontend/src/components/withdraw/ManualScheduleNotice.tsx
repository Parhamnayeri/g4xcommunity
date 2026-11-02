import React from 'react';
import { Card } from '../ui/Card';

export const ManualScheduleNotice: React.FC = () => {
  return (
    <Card highlight="none" style={{ padding: '1.25rem', marginBottom: '1.5rem', backgroundColor: 'rgba(20, 16, 36, 0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
        <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>⏱</span>
        <div>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.35rem 0' }}>
            Administrative Manual Disbursement Schedule &amp; Anti-Fraud Policy
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.45, margin: '0 0 0.75rem 0' }}>
            In strict compliance with G4X financial safety standards, automated hot-wallet payouts are disabled (<code>FINANCE_V2_LIVE_PAYOUTS_ENABLED=false</code>). Every withdrawal undergoes rigorous multi-party accounting verification before funds are released.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '0.75rem',
              fontSize: '0.78rem',
            }}
          >
            <div style={{ backgroundColor: 'rgba(10, 8, 20, 0.6)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '0.65rem 0.8rem' }}>
              <strong style={{ color: 'var(--accent-lime)', display: 'block', marginBottom: '0.2rem' }}>
                USDT (BNB Smart Chain BEP-20)
              </strong>
              <span style={{ color: 'var(--text-muted)' }}>
                Operational window: 1 to 48 hours. Disbursed manually by platform managers with verifiable on-chain TxHash. Fixed fee: $0.40 USD.
              </span>
            </div>

            <div style={{ backgroundColor: 'rgba(10, 8, 20, 0.6)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '0.65rem 0.8rem' }}>
              <strong style={{ color: 'var(--status-info)', display: 'block', marginBottom: '0.2rem' }}>
                Iranian Bank Transfer (Sheba)
              </strong>
              <span style={{ color: 'var(--text-muted)' }}>
                Disbursed on Wednesday and Saturday batches. Submissions before Tuesday cutoff (Asia/Tehran) disburse Wednesday; later submissions disburse Saturday. Fixed fee: $1.30 USD.
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
