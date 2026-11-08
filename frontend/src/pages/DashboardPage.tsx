import React, { useState, useEffect, useCallback } from 'react';
import { DashboardOverviewResponse } from '../types/dashboard';
import { fetchDashboardOverview } from '../services/dashboard';
import { UserProfileCard } from '../components/dashboard/UserProfileCard';
import { FinancialSummary } from '../components/dashboard/FinancialSummary';
import { ActiveOrdersList } from '../components/dashboard/ActiveOrdersList';
import { OrderHistorySection } from '../components/dashboard/OrderHistorySection';
import { FinancialActivitySection } from '../components/dashboard/FinancialActivitySection';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetchDashboardOverview();
      setData(res);
    } catch (err: any) {
      console.error('[DashboardPage] Error loading overview:', err);
      setError(err.message || 'Failed to load member dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (loading) {
    return <LoadingState message="Loading your G4X Member Portal & Balances..." />;
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Dashboard Unavailable"
        message={error || 'Unable to connect to G4X services.'}
        onRetry={() => loadOverview()}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {/* ─── Top Section: Profile (Left) & Financial Overview (Right) ────────── */}
      <div
        className="dashboard-top-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: '1.5rem',
          alignItems: 'stretch',
        }}
      >
        {/* Left Column: Discord Profile */}
        <div>
          <UserProfileCard profile={data.profile} />
        </div>

        {/* Right Column: Financial Overview Cards */}
        <div>
          <FinancialSummary
            wallet={data.wallet}
            isRefreshing={refreshing}
            onRefresh={() => loadOverview(true)}
          />
        </div>
      </div>

      {/* ─── Active Orders ─────────────────────────────────────────────────── */}
      <section id="active-orders">
        <ActiveOrdersList orders={data.activeOrders} />
      </section>

      {/* ─── Order History ─────────────────────────────────────────────────── */}
      <section id="order-history">
        <OrderHistorySection />
      </section>

      {/* ─── Financial Activity ─────────────────────────────────────────────── */}
      <section id="financial-activity">
        <FinancialActivitySection />
      </section>

      {/* Responsive Stacking CSS */}
      <style>{`
        @media (max-width: 960px) {
          .dashboard-top-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};
export default DashboardPage;
