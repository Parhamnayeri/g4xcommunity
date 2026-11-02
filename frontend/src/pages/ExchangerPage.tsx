import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  ExchangerStatusResponse,
  ExchangerOverviewResponse,
  ExchangerOffer,
  GoldTrade,
  PaginationMeta,
} from '../types/exchange';
import {
  fetchExchangerStatus,
  fetchExchangerOverview,
  fetchExchangerOffers,
  fetchExchangerTrades,
} from '../services/exchange';
import { ExchangerApplicationCard } from '../components/exchanger/ExchangerApplicationCard';
import { ExchangerOverviewCards } from '../components/exchanger/ExchangerOverviewCards';
import { ExchangerOffersManager } from '../components/exchanger/ExchangerOffersManager';
import { ExchangerTradesTable } from '../components/exchanger/ExchangerTradesTable';

export const ExchangerPage: React.FC = () => {
  const { user, status, loginUrl } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const authLoading = status === 'loading';

  // Status & Overview
  const [statusData, setStatusData] = useState<ExchangerStatusResponse | null>(null);
  const [overview, setOverview] = useState<ExchangerOverviewResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Tabs for Approved Exchangers
  const [activeTab, setActiveTab] = useState<'trades' | 'offers'>('trades');

  // Offers State
  const [offers, setOffers] = useState<ExchangerOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);

  // Trades State
  const [trades, setTrades] = useState<GoldTrade[]>([]);
  const [tradesPagination, setTradesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesStatusFilter, setTradesStatusFilter] = useState('');

  // Load Status
  const loadStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    try {
      const data = await fetchExchangerStatus();
      setStatusData(data);
      if (data.isApproved) {
        const ov = await fetchExchangerOverview();
        setOverview(ov);
      }
    } catch (err) {
      console.error('Failed to load exchanger status:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, [isAuthenticated]);

  // Load Exchanger's Offers
  const loadMyOffers = useCallback(async () => {
    if (!statusData?.isApproved) return;
    setOffersLoading(true);
    try {
      const res = await fetchExchangerOffers();
      setOffers(res.offers);
    } catch (err) {
      console.error('Failed to load exchanger offers:', err);
    } finally {
      setOffersLoading(false);
    }
  }, [statusData?.isApproved]);

  // Load Exchanger's Trades
  const loadMyTrades = useCallback(async (page: number = 1) => {
    if (!statusData?.isApproved) return;
    setTradesLoading(true);
    try {
      const res = await fetchExchangerTrades({
        status: tradesStatusFilter || undefined,
        page,
        limit: 10,
        sortOrder: 'desc',
      });
      setTrades(res.trades);
      setTradesPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load exchanger trades:', err);
    } finally {
      setTradesLoading(false);
    }
  }, [statusData?.isApproved, tradesStatusFilter]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (statusData?.isApproved) {
      loadMyOffers();
      loadMyTrades(1);
    }
  }, [statusData?.isApproved, loadMyOffers, loadMyTrades]);

  // 1. Loading State
  if (authLoading || loadingStatus) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
        Verifying Exchanger authorization...
      </div>
    );
  }

  // 2. Unauthenticated State
  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', padding: '24px', textAlign: 'center' }}>
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '36px 24px',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🔐</div>
          <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px 0' }}>Exchanger Portal Access</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '24px', lineHeight: 1.5 }}>
            Please authenticate via Discord to access the certified Exchanger portal and review assigned community trades.
          </p>
          <a
            href={loginUrl || '/auth/discord'}
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              backgroundColor: 'var(--primary-purple)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '1rem',
              textDecoration: 'none',
            }}
          >
            Login with Discord
          </a>
        </div>
      </div>
    );
  }

  // 3. Not an Approved Exchanger (Unapproved, Application Pending, or Rejected)
  if (!statusData?.isApproved) {
    const isManagement = ['admin', 'owner', 'manager'].includes(user?.role?.toLowerCase() || '');

    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 16px' }}>
        {isManagement && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(124, 58, 237, 0.1)',
              border: '1px solid var(--primary-purple)',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
            }}
          >
            🛡️ <strong>Management Oversight Notice:</strong> You are logged in with role <code>{user?.role}</code>.
            While you possess administrative oversight, domain policy requires a designated certified Exchanger account
            to publish offers and fulfill trades.
          </div>
        )}

        <ExchangerApplicationCard statusData={statusData!} onApplicationSubmitted={loadStatus} />
      </div>
    );
  }

  // 4. Approved Exchanger Dashboard
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--primary-purple)', fontWeight: 600, letterSpacing: '0.05em' }}>
            G4X FINANCE V2
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>EXCHANGER PORTAL</span>
        </div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '2rem', color: 'var(--text-primary)', fontWeight: 700 }}>
          Exchanger Portal
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Manage your liquidity tiers, fulfill community gold trades, and track your prepaid USD wallet.
        </p>
      </div>

      {/* Overview Metrics Cards */}
      {overview && <ExchangerOverviewCards overview={overview} />}

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '24px',
        }}
      >
        <button
          onClick={() => setActiveTab('trades')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'trades' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'trades' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'trades' ? 600 : 400,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          Assigned Purchases & Fulfilled Trades
        </button>
        <button
          onClick={() => setActiveTab('offers')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'offers' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'offers' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'offers' ? 600 : 400,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          My Marketplace Offers
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'trades' && (
        <ExchangerTradesTable
          trades={trades}
          pagination={tradesPagination}
          loading={tradesLoading}
          p2pSettlementEnabled={overview?.featureGates?.p2pSettlementEnabled ?? false}
          onPageChange={(page) => loadMyTrades(page)}
          onFilterChange={(status) => setTradesStatusFilter(status)}
          onRefresh={() => {
            loadStatus();
            loadMyTrades(tradesPagination.page);
          }}
        />
      )}

      {activeTab === 'offers' && (
        <ExchangerOffersManager
          offers={offers}
          onRefresh={() => {
            loadStatus();
            loadMyOffers();
          }}
        />
      )}
    </div>
  );
};
