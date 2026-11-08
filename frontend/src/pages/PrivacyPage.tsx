import React from 'react';
import { Card } from '../components/ui/Card';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="container" style={{ padding: '3.5rem 1.5rem', maxWidth: '850px' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <span className="badge badge-purple" style={{ marginBottom: '0.75rem' }}>
          Data Protection
        </span>
        <h1 style={{ fontSize: '2.4rem', marginBottom: '0.75rem' }}>Privacy Policy</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
          Last revised: 2026. G4X Community values user privacy, security, and transparent data processing.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Card>
          <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '0.75rem' }}>
            1. Information We Collect
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            When logging into G4X via Discord OAuth2, we obtain your Discord User ID, username, and public avatar. We do not receive or store your Discord password. For withdrawal and banking verification, optional contact details (such as Telegram or phone numbers) provided voluntarily are encrypted.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '0.75rem' }}>
            2. Cookies and Session Storage
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Our web services utilize strictly necessary HttpOnly, SameSite session cookies (`g4x.sid`) for authentication and CSRF token cookies to prevent cross-site request forgery. We do not use third-party advertising or tracking trackers.
          </p>
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '0.75rem' }}>
            3. Financial Records &amp; Auditing
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Double-entry transactions, wallet balances, and order execution logs are maintained for accounting reconciliation and fraud prevention purposes in accordance with our community safety policies.
          </p>
        </Card>
      </div>
    </div>
  );
};
