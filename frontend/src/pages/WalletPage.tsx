import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { WalletOverviewCards } from '../components/wallet/WalletOverviewCards';
import { DepositMethodSelector, DepositMethod } from '../components/wallet/DepositMethodSelector';
import { IrtDepositForm } from '../components/wallet/IrtDepositForm';
import { CryptoDepositPanel } from '../components/wallet/CryptoDepositPanel';
import { DepositHistoryTable } from '../components/wallet/DepositHistoryTable';
import { LedgerActivityTable } from '../components/wallet/LedgerActivityTable';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { Card } from '../components/ui/Card';
import { WalletOverviewResponse } from '../types/wallet';
import { fetchWalletOverview } from '../services/wallet';

export const WALLET_ROLES = ['advertiser', 'exchanger', 'staff', 'manager', 'admin', 'owner'];

export const WalletPage: React.FC = () => {
  const { user, status, hasRole } = useAuth();

  const [data, setData] = useState<WalletOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDepositMethod, setActiveDepositMethod] = useState<DepositMethod>('irt');
  const [activeHistoryTab, setActiveHistoryTab] = useState<'deposits' | 'ledger'>('deposits');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const loadOverview = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await fetchWalletOverview();
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || 'Failed to retrieve authoritative wallet overview.');
      }
    } catch (err: any) {
      if (err.status === 401) {
        window.location.href = '/auth/discord';
        return;
      }
      setError(err.message || 'Unable to connect to financial wallet services.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      loadOverview();
    }
  }, [loadOverview, status]);

  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  const handleDepositSuccess = () => {
    showNotification('Deposit request submitted successfully! It is now pending administrative verification.');
    setRefreshTrigger((prev) => prev + 1);
    loadOverview(true);
  };

  if (status === 'loading' || loading) {
    return <LoadingState message="Loading your G4X Unified USD Wallet & Ledger..." />;
  }

  // Permissions Guard (Section 2)
  const userRoles = user?.roles || [];
  const isOwner = hasRole('owner');
  const hasWalletAccess = isOwner || WALLET_ROLES.some((r) => userRoles.includes(r));

  if (!hasWalletAccess) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <Card style={{ maxWidth: '580px', padding: '2.5rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              margin: '0 auto 1.25rem',
            }}
          >
            🚫
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Access Denied
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
            The Unified Wallet &amp; Deposit Center is reserved for authorized{' '}
            <strong style={{ color: 'var(--text-primary)' }}>Advertisers, Exchangers, Staff, and Administrators</strong>.
            Your current account roles do not include wallet access.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/dashboard" className="btn btn-outline btn-sm">
              &larr; Return to Dashboard
            </a>
            <a href="/withdraw" className="btn btn-primary btn-sm">
              Booster Withdrawals &rarr;
            </a>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Wallet Services Unavailable"
        message={error || 'Unable to connect to G4X financial ledger services.'}
        onRetry={() => loadOverview()}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-main)', padding: '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Navigation Breadcrumb & Header */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</a>
            <span>/</span>
            <a href="/dashboard" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Dashboard</a>
            <span>/</span>
            <span style={{ color: 'var(--accent-lime)', fontWeight: 700 }}>Wallet &amp; Deposits</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '0 0 0.35rem 0' }}>
                Unified USD Wallet &amp; Deposit Center
              </h1>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                Manage your spendable USD balance, request manual IRT deposits, and audit immutable ledger activity.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <a href="/dashboard" className="btn btn-outline btn-sm">
                &larr; Dashboard
              </a>
              <button
                onClick={() => loadOverview(true)}
                disabled={refreshing || loading}
                className="btn btn-primary btn-sm"
              >
                {refreshing ? 'Updating...' : '↻ Sync Balances'}
              </button>
            </div>
          </div>
        </div>

        {/* Global Toast Notification */}
        {notification && (
          <div
            style={{
              padding: '1rem 1.25rem',
              borderRadius: '8px',
              backgroundColor: notification.type === 'success' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(56, 189, 248, 0.15)',
              border: `1px solid ${notification.type === 'success' ? 'var(--accent-lime)' : '#38bdf8'}`,
              color: notification.type === 'success' ? 'var(--accent-lime)' : '#38bdf8',
              fontSize: '0.88rem',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              ×
            </button>
          </div>
        )}

        {/* 1. Authoritative WalletV2 Overview Cards */}
        <WalletOverviewCards
          wallet={data.wallet}
          breakdown={data.breakdown}
          ratesAndPolicies={data.ratesAndPolicies}
          onRefresh={() => loadOverview(true)}
          isRefreshing={refreshing}
        />

        {/* 2. Deposit Rail Section */}
        <div>
          <DepositMethodSelector
            activeMethod={activeDepositMethod}
            onChange={setActiveDepositMethod}
            isCryptoActive={data.ratesAndPolicies.isCryptoActive}
          />

          {activeDepositMethod === 'irt' ? (
            <IrtDepositForm
              bankDetails={data.bankDetails}
              ratesAndPolicies={data.ratesAndPolicies}
              onSuccess={handleDepositSuccess}
            />
          ) : (
            <CryptoDepositPanel ratesAndPolicies={data.ratesAndPolicies} />
          )}
        </div>

        {/* 3. Financial Activity Section (Tabs for Deposit History & Ledger Activity) */}
        <div>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: '1.25rem', gap: '1.5rem' }}>
            <button
              type="button"
              onClick={() => setActiveHistoryTab('deposits')}
              style={{
                padding: '0.75rem 0.25rem',
                background: 'none',
                border: 'none',
                borderBottom: activeHistoryTab === 'deposits' ? '3px solid var(--accent-lime)' : '3px solid transparent',
                color: activeHistoryTab === 'deposits' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: activeHistoryTab === 'deposits' ? 800 : 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Deposit Requests History
            </button>

            <button
              type="button"
              onClick={() => setActiveHistoryTab('ledger')}
              style={{
                padding: '0.75rem 0.25rem',
                background: 'none',
                border: 'none',
                borderBottom: activeHistoryTab === 'ledger' ? '3px solid var(--primary-purple)' : '3px solid transparent',
                color: activeHistoryTab === 'ledger' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: activeHistoryTab === 'ledger' ? 800 : 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Ledger Journal Activity
            </button>
          </div>

          {activeHistoryTab === 'deposits' ? (
            <DepositHistoryTable refreshTrigger={refreshTrigger} />
          ) : (
            <LedgerActivityTable refreshTrigger={refreshTrigger} />
          )}
        </div>
      </div>
    </div>
  );
};
