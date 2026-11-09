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
          backgroundColor: 'rgba(24, 21, 36, 0.65)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.4rem 0',
          position: 'sticky',
          top: '74px',
          zIndex: 90,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="container">
          <nav
            className="tabs-nav-bar"
            aria-label="Portal Navigation"
            style={{ marginBottom: 0, borderBottom: 'none', padding: '0.25rem 0' }}
          >
            <Link
              to="/dashboard"
              className={`tab-btn ${location.pathname === '/dashboard' ? 'tab-btn-active' : ''}`}
            >
              Overview
            </Link>
            <Link
              to="/wallet"
              className={`tab-btn ${location.pathname === '/wallet' ? 'tab-btn-active' : ''}`}
            >
              Wallet
            </Link>
            <Link
              to="/exchange"
              className={`tab-btn ${location.pathname === '/exchange' ? 'tab-btn-active' : ''}`}
            >
              Exchange
            </Link>
            <Link
              to="/exchanger"
              className={`tab-btn ${location.pathname === '/exchanger' ? 'tab-btn-active' : ''}`}
            >
              Exchanger Portal
            </Link>
            <Link
              to="/profile"
              className={`tab-btn ${location.pathname === '/profile' ? 'tab-btn-active' : ''}`}
            >
              Profile &amp; Characters
            </Link>
            <Link
              to="/booster/settings"
              className={`tab-btn ${['/booster/settings', '/settings'].includes(location.pathname) ? 'tab-btn-active' : ''}`}
            >
              Booster Hub
            </Link>
            {hasRole('staff', 'manager', 'admin', 'owner') && (
              <Link
                to="/staff"
                className={`tab-btn ${location.pathname === '/staff' ? 'tab-btn-active' : ''}`}
              >
                Staff Portal
              </Link>
            )}
            {hasRole('manager', 'admin', 'owner') && (
              <Link
                to="/management"
                className={`tab-btn ${location.pathname === '/management' ? 'tab-btn-active' : ''}`}
              >
                Management
              </Link>
            )}
            {hasRole('admin', 'owner') && (
              <Link
                to="/management/kyc"
                className={`tab-btn ${location.pathname === '/management/kyc' ? 'tab-btn-active' : ''}`}
              >
                KYC Review
              </Link>
            )}
            {hasRole('admin', 'owner') && (
              <Link
                to="/admin"
                className={`tab-btn ${location.pathname.startsWith('/admin') ? 'tab-btn-active' : ''}`}
              >
                Admin Portal
              </Link>
            )}
            {hasRole('owner') && (
              <Link
                to="/owner"
                className={`tab-btn ${location.pathname.startsWith('/owner') ? 'tab-btn-active' : ''}`}
              >
                👑 Owner Portal
              </Link>
            )}
          </nav>
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
