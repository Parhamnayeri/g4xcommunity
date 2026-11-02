import React, { useState, useEffect, useCallback } from 'react';
import { AdvertiserOverviewResponse, AdvertiserOrder } from '../types/advertiser';
import { fetchAdvertiserOverview } from '../services/advertiser';
import { AdvertiserProfileHeader } from '../components/advertiser/AdvertiserProfileHeader';
import { AdvertiserRankCard } from '../components/advertiser/AdvertiserRankCard';
import { AdvertiserWalletCard } from '../components/advertiser/AdvertiserWalletCard';
import { AdvertiserMetrics } from '../components/advertiser/AdvertiserMetrics';
import { ActiveOrdersSection } from '../components/advertiser/ActiveOrdersSection';
import { OrderHistorySection } from '../components/advertiser/OrderHistorySection';
import { EditNoteModal } from '../components/advertiser/EditNoteModal';
import { CancelRequestModal } from '../components/advertiser/CancelRequestModal';
import { CreateOrderModal } from '../components/advertiser/CreateOrderModal';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';

export const AdvertiserPage: React.FC = () => {
  const [data, setData] = useState<AdvertiserOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Modals state
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [editingNoteOrder, setEditingNoteOrder] = useState<AdvertiserOrder | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<AdvertiserOrder | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Success Notification Banner
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const loadOverview = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetchAdvertiserOverview();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load Advertiser Portal.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  const handleNoteSuccess = (updatedNotes: string) => {
    setEditingNoteOrder(null);
    showNotification('Order notes updated successfully.');
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleCancelSuccess = (status: 'cancelled' | 'pending_review', message: string) => {
    setCancellingOrder(null);
    showNotification(message, status === 'cancelled' ? 'success' : 'info');
    setRefreshTrigger((prev) => prev + 1);
    loadOverview(true);
  };

  const handleCreateOrderSuccess = (orderRef: string) => {
    setIsCreateModalOpen(false);
    showNotification(`Boost order ${orderRef} created and funded successfully!`);
    setRefreshTrigger((prev) => prev + 1);
    loadOverview(true);
  };

  if (loading) {
    return <LoadingState message="Loading your G4X Advertiser Workspace & Orders..." />;
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Advertiser Workspace Unavailable"
        message={error || 'Unable to connect to G4X Advertiser services.'}
        onRetry={() => loadOverview()}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            backgroundColor:
              notification.type === 'success' ? 'rgba(204, 255, 0, 0.12)' : 'rgba(124, 58, 237, 0.15)',
            border: `1px solid ${
              notification.type === 'success' ? 'rgba(204, 255, 0, 0.4)' : 'rgba(124, 58, 237, 0.4)'
            }`,
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            color: notification.type === 'success' ? 'var(--accent-lime, #ccff00)' : '#ddd6fe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span>{notification.type === 'success' ? '✓' : 'ℹ️'}</span>
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── 1. Profile Header ─────────────────────────────────────────────── */}
      <section id="advertiser-profile-header">
        <AdvertiserProfileHeader
          profile={data.profile}
          rank={data.rank}
          wallet={data.wallet}
          onCreateOrderClick={() => setIsCreateModalOpen(true)}
          onRefresh={() => {
            loadOverview(true);
            setRefreshTrigger((prev) => prev + 1);
          }}
          isRefreshing={refreshing}
        />
      </section>

      {/* ─── 2. Performance Metrics Counter Cards ─────────────────────────── */}
      <section id="advertiser-metrics">
        <AdvertiserMetrics performance={data.performance} />
      </section>

      {/* ─── 3. Top Grid: Rank Hierarchy (Left) & Wallet Balances (Right) ───── */}
      <div
        className="advertiser-two-col-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: '1.5rem',
          alignItems: 'stretch',
        }}
      >
        <AdvertiserRankCard rankData={data.rank} />
        <AdvertiserWalletCard wallet={data.wallet} />
      </div>

      {/* ─── 4. Orders Workspace Navigation (Active vs History Tabs) ────────── */}
      <section id="advertiser-orders-workspace" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
            paddingBottom: '0.5rem',
          }}
        >
          <button
            onClick={() => setActiveTab('active')}
            style={{
              backgroundColor: activeTab === 'active' ? 'var(--primary-purple, #7c3aed)' : 'transparent',
              color: activeTab === 'active' ? '#ffffff' : 'var(--text-muted, #9490a6)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.6rem 1.25rem',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}
          >
            <span>⚡ Active Orders</span>
            <span
              style={{
                backgroundColor: activeTab === 'active' ? 'rgba(0,0,0,0.25)' : 'rgba(124, 58, 237, 0.2)',
                color: activeTab === 'active' ? 'var(--accent-lime, #ccff00)' : 'var(--text-primary, #f4f4f6)',
                padding: '0.1rem 0.45rem',
                borderRadius: '12px',
                fontSize: '0.75rem',
              }}
            >
              {data.performance.activeOrdersCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            style={{
              backgroundColor: activeTab === 'history' ? 'var(--primary-purple, #7c3aed)' : 'transparent',
              color: activeTab === 'history' ? '#ffffff' : 'var(--text-muted, #9490a6)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.6rem 1.25rem',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}
          >
            <span>📜 Order History &amp; Settlements</span>
            <span
              style={{
                backgroundColor: activeTab === 'history' ? 'rgba(0,0,0,0.25)' : 'rgba(124, 58, 237, 0.2)',
                color: activeTab === 'history' ? '#c4b5fd' : 'var(--text-primary, #f4f4f6)',
                padding: '0.1rem 0.45rem',
                borderRadius: '12px',
                fontSize: '0.75rem',
              }}
            >
              {data.performance.completedOrdersCount + data.performance.cancelledOrdersCount}
            </span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'active' ? (
          <ActiveOrdersSection
            onEditNote={(order) => setEditingNoteOrder(order)}
            onCancelRequest={(order) => setCancellingOrder(order)}
            refreshTrigger={refreshTrigger}
          />
        ) : (
          <OrderHistorySection refreshTrigger={refreshTrigger} />
        )}
      </section>

      {/* ─── Modals ───────────────────────────────────────────────────────── */}
      {editingNoteOrder && (
        <EditNoteModal
          order={editingNoteOrder}
          onClose={() => setEditingNoteOrder(null)}
          onSuccess={handleNoteSuccess}
        />
      )}

      {cancellingOrder && (
        <CancelRequestModal
          order={cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          onSuccess={handleCancelSuccess}
        />
      )}

      {isCreateModalOpen && (
        <CreateOrderModal
          rankData={data.rank}
          wallet={data.wallet}
          discordInfo={data.discordIntegration}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handleCreateOrderSuccess}
        />
      )}

      {/* Responsive Styles */}
      <style>{`
        @media (max-width: 980px) {
          .advertiser-two-col-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};
export default AdvertiserPage;
