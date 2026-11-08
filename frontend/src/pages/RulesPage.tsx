import React from 'react';
import { Card } from '../components/ui/Card';

export const RulesPage: React.FC = () => {
  return (
    <div className="container" style={{ padding: '3.5rem 1.5rem', maxWidth: '850px' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <span className="badge badge-purple" style={{ marginBottom: '0.75rem' }}>
          Platform Standards
        </span>
        <h1 style={{ fontSize: '2.4rem', marginBottom: '0.75rem' }}>G4X Community Rules &amp; Guidelines</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
          Effective: 2026. All community members, boosters, advertisers, and exchangers must adhere to these policies.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Card>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--accent-lime)', marginBottom: '0.75rem' }}>
            1. Member Integrity &amp; Account Security
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Every member is responsible for the security of their authenticated Discord account. Multi-accounting, credential sharing, and unauthorized session transfers are strictly prohibited and result in immediate revocation of platform roles.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--accent-lime)', marginBottom: '0.75rem' }}>
            2. Boost Delivery &amp; Run Protocol
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Boosters must initiate presigns on assigned Discord channels within the configured countdown window (10 minutes). Screenshot proofs and run completion validation are required before any payout allocation can be requested.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--accent-lime)', marginBottom: '0.75rem' }}>
            3. Financial &amp; Escrow Safety
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            All trades and boost settlements are processed via G4X Finance V2 double-entry accounting. Direct off-platform payment solicitations bypassing the community escrow are considered a critical breach of trust.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--accent-lime)', marginBottom: '0.75rem' }}>
            4. Fair Play &amp; Pilot Verification
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Piloted services require full verification through G4X Staff. Automated bots, cheats, memory-injection tools, and unauthorized third-party software are forbidden without exception.
          </p>
        </Card>
      </div>
    </div>
  );
};
