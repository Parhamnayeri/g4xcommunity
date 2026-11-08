import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export interface LegacyTransitionPageProps {
  moduleName: string;
  category: 'Authenticated' | 'Operations' | 'Owner';
  description: string;
  legacyTab?: string;
}

export const LegacyTransitionPage: React.FC<LegacyTransitionPageProps> = ({
  moduleName,
  category,
  description,
  legacyTab,
}) => {
  const legacyUrl = legacyTab ? `/legacy#${legacyTab}` : '/legacy';

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span className="badge badge-purple">{category}</span>
          <span className="badge badge-lime">Fully Operational via Legacy Engine</span>
        </div>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{moduleName}</h1>
        <p style={{ color: 'var(--text-muted)' }}>{description}</p>
      </div>

      <Card highlight="lime" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(204, 255, 0, 0.15)',
              color: 'var(--accent-lime)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '0.4rem' }}>
              Phase 1 Architectural Preservation
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '1.25rem' }}>
              In accordance with Phase 1 migration requirements, the backend financial and administrative engines remain authoritative and fully active. This section continues to run on our tested production engine at <code>/legacy</code> while the UI is being migrated to React components in Phase 2.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <a href={legacyUrl} style={{ textDecoration: 'none' }}>
                <Button variant="cta" size="md">
                  Launch {moduleName} in Legacy Portal &rarr;
                </Button>
              </a>
              <a href="/legacy" style={{ textDecoration: 'none' }}>
                <Button variant="outline" size="md">
                  Open Main Legacy Dashboard
                </Button>
              </a>
            </div>
          </div>
        </div>
      </Card>

      {/* Migration Status Overview */}
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '1rem', color: '#fff' }}>
          Website Redesign Architecture Status
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.6rem 0.75rem' }}>Module</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Phase 1 Status</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Live Engine Location</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>Landing Page &amp; Design System</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><span className="badge badge-lime">Migrated to React 18</span></td>
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>/ (Vite SPA)</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>Discord OAuth &amp; Header Shell</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><span className="badge badge-lime">Migrated to React 18</span></td>
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>Authoritative Express Backend</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{moduleName}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><span className="badge badge-purple">Preserved (Scheduled Phase 2)</span></td>
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--accent-lime)' }}>/legacy</td>
              </tr>
              <tr>
                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>OwnerGate Protection</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><span className="badge badge-lime">Timing-Safe Active</span></td>
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>/OwnerGate</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
