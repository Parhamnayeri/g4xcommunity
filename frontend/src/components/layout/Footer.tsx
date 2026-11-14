import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../brand/Logo';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        marginTop: 'auto',
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '3.5rem 0 2rem 0',
      }}
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '2.5rem',
            marginBottom: '3rem',
          }}
        >
          {/* Brand Info */}
          <div>
            <Logo size="md" />
            <p
              style={{
                marginTop: '1rem',
                fontSize: '0.88rem',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              The premier gaming boost marketplace and high-tier community. Powered by Discord authentication, verified pilot reviews and balanced accounting.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4
              style={{
                fontSize: '0.9rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent-yellow)',
                marginBottom: '1rem',
              }}
            >
              Navigation
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <li>
                <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Home
                </Link>
              </li>
              <li>
                <a href="/#services" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Supported Services
                </a>
              </li>
              <li>
                <a href="/#recruitment" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Join the Team
                </a>
              </li>
              <li>
                <Link to="/dashboard" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Member Dashboard
                </Link>
              </li>
            </ul>
          </div>

          {/* Governance & Policies */}
          <div>
            <h4
              style={{
                fontSize: '0.9rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent-yellow)',
                marginBottom: '1rem',
              }}
            >
              Governance
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <li>
                <Link to="/rules" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Community Rules
                </Link>
              </li>
              <li>
                <Link to="/privacy" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Community & Support */}
          <div>
            <h4
              style={{
                fontSize: '0.9rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent-yellow)',
                marginBottom: '1rem',
              }}
            >
              Community
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <li>
                <a
                  href="/auth/discord"
                  style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                  Discord Server
                </a>
              </li>
              <li>
                <a
                  href="/#recruitment"
                  style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                  Booster Application
                </a>
              </li>
              <li>
                <a
                  href="/#recruitment"
                  style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                  Support &amp; Inquiries
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '1.5rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            &copy; {new Date().getFullYear()} G4X Community. All rights reserved.
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <Link to="/rules" style={{ color: 'var(--text-muted)' }}>
              Rules
            </Link>
            <Link to="/privacy" style={{ color: 'var(--text-muted)' }}>
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
