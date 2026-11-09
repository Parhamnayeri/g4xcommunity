import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { useAuth } from '../../hooks/useAuth';
import { LoadingState } from '../ui/LoadingState';

export const DashboardLayout: React.FC = () => {
  const { user, status, hasRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingState message="Verifying session and permissions..." />
        </main>
        <Footer />
      </div>
    );
  }

  if (status === 'unauthenticated' || !user) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Header />
        <main style={{ flex: 1, padding: '4rem 1.5rem', textAlign: 'center' }}>
          <div className="container" style={{ maxWidth: '500px' }}>
            <div className="card-surface" style={{ padding: '2.5rem' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(124, 58, 237, 0.2)',
                  color: 'var(--primary-purple)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1.5rem',
                }}
              >
                🔒
              </div>
              <h2 style={{ marginBottom: '0.75rem', fontSize: '1.4rem' }}>Authentication Required</h2>
              <p style={{ marginBottom: '2rem', fontSize: '0.9rem' }}>
                You must sign in with your verified Discord account to access this section of the G4X Portal.
              </p>
              <a href="/auth/discord" className="btn btn-cta" style={{ width: '100%' }}>
                Sign In with Discord
              </a>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '1.25rem 0',
        }}
      >
        <div className="container" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Member Dashboard</h1>
            <p style={{ fontSize: '0.85rem' }}>
              Welcome back, <span style={{ color: 'var(--accent-lime)', fontWeight: 600 }}>{user.displayName || user.username}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <a href="/legacy" className="btn btn-cta btn-sm">
              Launch Full Legacy Dashboard &rarr;
            </a>
          </div>
        </div>
      </div>

      {/* Navigation Sub-bar */}
      <div
        style={{
          backgroundColor: 'rgba(24, 21, 36, 0.5)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.5rem 0',
        }}
      >
        <div className="container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
          <Link
            to="/dashboard"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: location.pathname === '/dashboard' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: location.pathname === '/dashboard' ? '2px solid var(--accent-lime)' : 'none',
            }}
          >
            Overview
          </Link>
          <Link
            to="/wallet"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: location.pathname === '/wallet' ? 'var(--accent-lime)' : 'var(--text-muted)',
            }}
          >
            Wallet
          </Link>
          <Link
            to="/exchange"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: location.pathname === '/exchange' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: location.pathname === '/exchange' ? '2px solid var(--accent-lime)' : 'none',
            }}
          >
            Exchange
          </Link>
          <Link
            to="/exchanger"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: location.pathname === '/exchanger' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: location.pathname === '/exchanger' ? '2px solid var(--accent-lime)' : 'none',
            }}
          >
            Exchanger Portal
          </Link>
          <Link
            to="/profile"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: location.pathname === '/profile' ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: location.pathname === '/profile' ? '2px solid var(--accent-lime)' : 'none',
            }}
          >
            Profile &amp; Characters
          </Link>
          <Link
            to="/booster/settings"
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: ['/booster/settings', '/settings'].includes(location.pathname) ? 'var(--accent-lime)' : 'var(--text-muted)',
              borderBottom: ['/booster/settings', '/settings'].includes(location.pathname) ? '2px solid var(--accent-lime)' : 'none',
            }}
          >
            Booster Hub
          </Link>
          {hasRole('advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner') && (
            <Link
              to="/discord-commands"
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: location.pathname === '/discord-commands' ? 'var(--accent-lime)' : 'var(--text-muted)',
                borderBottom: location.pathname === '/discord-commands' ? '2px solid var(--accent-lime)' : 'none',
              }}
            >
              Discord Commands
            </Link>
          )}
          {hasRole('staff', 'manager', 'admin', 'owner') && (
            <Link
              to="/staff"
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: location.pathname === '/staff' ? 'var(--accent-lime)' : 'var(--text-muted)',
                borderBottom: location.pathname === '/staff' ? '2px solid var(--accent-lime)' : 'none',
              }}
            >
              Staff Portal
            </Link>
          )}
          {hasRole('manager', 'admin', 'owner') && (
            <>
              <Link
                to="/management"
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: location.pathname === '/management' ? 'var(--accent-lime)' : 'var(--text-muted)',
                  borderBottom: location.pathname === '/management' ? '2px solid var(--accent-lime)' : 'none',
                }}
              >
                Management
              </Link>
              <Link
                to="/management/kyc"
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: location.pathname === '/management/kyc' ? 'var(--accent-lime)' : 'var(--text-muted)',
                  borderBottom: location.pathname === '/management/kyc' ? '2px solid var(--accent-lime)' : 'none',
                }}
              >
                KYC Review
              </Link>
            </>
          )}
          {hasRole('admin', 'manager', 'owner') && (
            <Link
              to="/admin"
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: location.pathname.startsWith('/admin') ? 'var(--accent-lime)' : 'var(--text-muted)',
                borderBottom: location.pathname.startsWith('/admin') ? '2px solid var(--accent-lime)' : 'none',
              }}
            >
              Admin Hub
            </Link>
          )}
          {hasRole('owner') && (
            <Link
              to="/owner"
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: location.pathname.startsWith('/owner') ? 'var(--accent-lime)' : 'var(--text-muted)',
                borderBottom: location.pathname.startsWith('/owner') ? '2px solid var(--accent-lime)' : 'none',
              }}
            >
              👑 Owner Portal
            </Link>
          )}
        </div>
      </div>

      <main style={{ flex: 1, padding: '2rem 0' }}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
};
