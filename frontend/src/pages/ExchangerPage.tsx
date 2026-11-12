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
import { Tabs } from '../components/ui';

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

  // Trades State
  const [trades, setTrades] = useState<GoldTrade[]>([]);
  const [tradesPagination, setTradesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesStatusFilter, setTradesStatusFilter] = useState('');
  const [tradesMethodFilter, setTradesMethodFilter] = useState('');

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

  // Load Exchanger Offers
  const loadOffers = useCallback(async () => {
    try {
      const res = await fetchExchangerOffers();
      setOffers(res.offers || []);
    } catch (err) {
      console.error('Failed to load exchanger offers:', err);
    }
  }, []);

  // Load Exchanger Trades
  const loadTrades = useCallback(async (page: number = 1) => {
    setTradesLoading(true);
    try {
      const res = await fetchExchangerTrades({
        status: tradesStatusFilter || undefined,
        settlementMethod: tradesMethodFilter || undefined,
        page,
        limit: 10,
        sortOrder: 'desc',
      });
      setTrades(Array.isArray(res?.trades) ? res.trades : []);
      setTradesPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load exchanger trades:', err);
    } finally {
      setTradesLoading(false);
    }
  }, [tradesStatusFilter, tradesMethodFilter]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (statusData?.isApproved) {
      if (activeTab === 'offers') {
        loadOffers();
      } else {
        loadTrades(1);
      }
    }
  }, [statusData, activeTab, loadOffers, loadTrades]);

  // 1. Loading State
  if (authLoading || loadingStatus) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
        Loading Exchanger Portal...
      </div>
    );
  }

  // 2. Unauthenticated
  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '600px', margin: '40px auto', padding: '24px', textAlign: 'center' }}>
        <div style={{ backgroundColor: 'var(--bg-surface)', padding: '36px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Exchanger Portal</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
            Please authenticate with your Discord account to access the Exchanger management console.
          </p>
          <a
            href={loginUrl}
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
    const isManagement = ['admin', 'owner', 'manager'].some((r) =>
      (user?.roles || []).map((x) => x.toLowerCase()).includes(r)
    );

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
            🛡️ <strong>Management Oversight Notice:</strong> You are logged in with role(s) <code>{(user?.roles || []).join(', ')}</code>.
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
      <div style={{ marginBottom: '24px' }}>
        <Tabs
          tabs={[
            { id: 'trades', label: 'Gold Trades & Settlement' },
            { id: 'offers', label: 'My Marketplace Offers' },
          ]}
          activeTab={activeTab}
          onChange={(t) => setActiveTab(t as 'trades' | 'offers')}
          accent="purple"
        />
      </div>

      {/* Tab 1: Trades Queue */}
      {activeTab === 'trades' && (
        <ExchangerTradesTable
          trades={trades}
          pagination={tradesPagination}
          loading={tradesLoading}
          p2pSettlementEnabled={overview?.featureGates?.p2pSettlementEnabled}
          onPageChange={(page) => loadTrades(page)}
          onFilterChange={(status, method) => {
            setTradesStatusFilter(status === 'ALL' ? '' : status);
            setTradesMethodFilter(method === 'ALL' ? '' : method);
          }}
          onRefresh={() => loadTrades(tradesPagination?.page ?? 1)}
        />
      )}

      {/* Tab 2: Offers Manager */}
      {activeTab === 'offers' && (
        <ExchangerOffersManager
          offers={offers}
          onRefresh={loadOffers}
        />
      )}
    </div>
  );
};

export default ExchangerPage;
