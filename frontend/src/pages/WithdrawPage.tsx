import React, { useState, useEffect, useCallback } from 'react';
import { WithdrawalOverviewCards } from '../components/withdraw/WithdrawalOverviewCards';
import { PayoutDestinationCard } from '../components/withdraw/PayoutDestinationCard';
import { WithdrawalQuoteForm } from '../components/withdraw/WithdrawalQuoteForm';
import { ManualScheduleNotice } from '../components/withdraw/ManualScheduleNotice';
import { WithdrawalHistoryTable } from '../components/withdraw/WithdrawalHistoryTable';
import {
  WithdrawalWalletData,
  WithdrawalPolicyData,
  UserPayoutPreferenceData,
} from '../types/withdraw';
import { fetchWithdrawalOverview } from '../services/withdraw';

export const WithdrawPage: React.FC = () => {
  const [wallet, setWallet] = useState<WithdrawalWalletData | null>(null);
  const [policy, setPolicy] = useState<WithdrawalPolicyData | null>(null);
  const [preference, setPreference] = useState<UserPayoutPreferenceData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  const loadOverview = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const data = await fetchWithdrawalOverview();
      if (data.success) {
        setWallet(data.wallet);
        setPolicy(data.policy);
        setPreference(data.payoutPreference);
      } else {
        setError(data.error || 'Failed to retrieve withdrawal overview.');
      }
    } catch (err: any) {
      if (err.status === 401) {
        window.location.href = '/auth/discord';
        return;
      }
      setError(err.message || 'Unable to connect to financial settlement service.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleWithdrawalSuccess = () => {
    loadOverview(true);
    setLastUpdated(Date.now());
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-main)', padding: '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Navigation Breadcrumb & Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</a>
            <span>/</span>
            <a href="/dashboard" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Dashboard</a>
            <span>/</span>
            <span style={{ color: 'var(--accent-lime)', fontWeight: 700 }}>Withdrawals</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '0 0 0.35rem 0' }}>
                Withdrawals &amp; Payout Preferences
              </h1>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                Manage your saved payout accounts, generate binding quotes, and track administrative disbursements.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <a href="/dashboard" className="btn btn-outline btn-sm">
                &larr; Return to Dashboard
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

        {/* Global Error Banner */}
        {error && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '1.25rem',
              marginBottom: '2rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <strong style={{ color: 'var(--status-danger)', display: 'block', marginBottom: '0.25rem' }}>
                Financial Gateway Notice
              </strong>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.88rem' }}>{error}</span>
            </div>
            <button onClick={() => loadOverview()} className="btn btn-outline btn-sm">
              Retry Connection
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div
              style={{
                height: '140px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                animation: 'pulse 1.5s infinite ease-in-out',
              }}
            />
            <div
              style={{
                height: '350px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                animation: 'pulse 1.5s infinite ease-in-out',
              }}
            />
          </div>
        )}

        {!loading && wallet && policy && (
          <>
            {/* 1. Authoritative Financial Balances */}
            <WithdrawalOverviewCards
              wallet={wallet}
              onRefresh={() => loadOverview(true)}
              isRefreshing={refreshing}
            />

            {/* 2. Main Two-Column Workflow (Quote Form on left, Payout Destinations on right) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '1.5rem',
                marginBottom: '1.5rem',
              }}
            >
              {/* Left Column: Request Withdrawal Form */}
              <div>
                <WithdrawalQuoteForm
                  wallet={wallet}
                  policy={policy}
                  preference={preference}
                  onWithdrawalConfirmed={handleWithdrawalSuccess}
                />
              </div>

              {/* Right Column: Payout Destination Preferences & Manual Notice */}
              <div>
                <PayoutDestinationCard
                  initialPreference={preference}
                  onUpdated={(newPref) => setPreference(newPref)}
                />
                <ManualScheduleNotice />
              </div>
            </div>

            {/* 3. Paginated Withdrawal History & Audit Receipts */}
            <WithdrawalHistoryTable
              lastUpdated={lastUpdated}
              onBalanceSync={() => loadOverview(true)}
            />
          </>
        )}
      </div>
    </div>
  );
};
