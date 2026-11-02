import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ExchangerOffer, GoldTrade, PaginationMeta } from '../types/exchange';
import { fetchActiveOffers, fetchAdvertiserTrades } from '../services/exchange';
import { OfferMarketplaceTable } from '../components/exchange/OfferMarketplaceTable';
import { SellGoldModal } from '../components/exchange/SellGoldModal';
import { P2pFundingModal } from '../components/exchange/P2pFundingModal';
import { AdvertiserTradesTable } from '../components/exchange/AdvertiserTradesTable';

export const ExchangePage: React.FC = () => {
  const { user, status } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const authLoading = status === 'loading';

  // Tab State
  const [activeTab, setActiveTab] = useState<'offers' | 'my_trades'>('offers');

  // Offers State
  const [offers, setOffers] = useState<ExchangerOffer[]>([]);
  const [offersPagination, setOffersPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersServiceFilter, setOffersServiceFilter] = useState('');
  const [offersCurrencyFilter, setOffersCurrencyFilter] = useState('');
  const [offersSortOrder, setOffersSortOrder] = useState<'asc' | 'desc'>('asc');

  // Trades State
  const [trades, setTrades] = useState<GoldTrade[]>([]);
  const [tradesPagination, setTradesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesStatusFilter, setTradesStatusFilter] = useState('');

  // Modals
  const [selectedOfferForGold, setSelectedOfferForGold] = useState<ExchangerOffer | null>(null);
  const [selectedOfferForP2p, setSelectedOfferForP2p] = useState<ExchangerOffer | null>(null);

  // Load Offers
  const loadOffers = useCallback(async (page: number = 1) => {
    setOffersLoading(true);
    try {
      const res = await fetchActiveOffers({
        serviceType: offersServiceFilter || undefined,
        targetCurrency: offersCurrencyFilter || undefined,
        sortOrder: offersSortOrder,
        page,
        limit: 10,
      });
      setOffers(res.offers);
      setOffersPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load marketplace offers:', err);
    } finally {
      setOffersLoading(false);
    }
  }, [offersServiceFilter, offersCurrencyFilter, offersSortOrder]);

  // Load Trades
  const loadTrades = useCallback(async (page: number = 1) => {
    if (!isAuthenticated) return;
    setTradesLoading(true);
    try {
      const res = await fetchAdvertiserTrades({
        status: tradesStatusFilter || undefined,
        page,
        limit: 10,
        sortOrder: 'desc',
      });
      setTrades(res.trades);
      setTradesPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load user trades:', err);
    } finally {
      setTradesLoading(false);
    }
  }, [isAuthenticated, tradesStatusFilter]);

  useEffect(() => {
    loadOffers(1);
  }, [loadOffers]);

  useEffect(() => {
    if (activeTab === 'my_trades') {
      loadTrades(1);
    }
  }, [activeTab, loadTrades]);

  const handleSelectOffer = (offer: ExchangerOffer) => {
    if (offer.serviceType === 'GOLD_TRADE') {
      setSelectedOfferForGold(offer);
    } else {
      setSelectedOfferForP2p(offer);
    }
  };

  const handleTradeCreated = () => {
    setSelectedOfferForGold(null);
    setSelectedOfferForP2p(null);
    setActiveTab('my_trades');
    loadTrades(1);
  };

  if (authLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
        Authenticating session...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--primary-purple)', fontWeight: 600, letterSpacing: '0.05em' }}>
            G4X FINANCE V2
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>PEER-TO-PEER MARKETPLACE</span>
        </div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '2rem', color: 'var(--text-primary)', fontWeight: 700 }}>
          Exchange Marketplace
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '720px', lineHeight: 1.5 }}>
          Trade in-game World of Warcraft gold or request P2P USD funding with approved community Exchangers.
          All quotes are cryptographically signed with authoritative server rates.
        </p>
      </div>

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
          Marketplace Offers
        </button>
        <button
          onClick={() => setActiveTab('my_trades')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'my_trades' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'my_trades' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'my_trades' ? 600 : 400,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          My Trade History
        </button>
      </div>

      {/* Tab 1: Marketplace Offers */}
      {activeTab === 'offers' && (
        <div>
          <OfferMarketplaceTable
            offers={offers}
            pagination={offersPagination}
            loading={offersLoading}
            currentUserId={user?.discordId}
            onPageChange={(page) => loadOffers(page)}
            onFilterChange={(service, currency, sort) => {
              setOffersServiceFilter(service);
              setOffersCurrencyFilter(currency);
              setOffersSortOrder(sort);
            }}
            onSelectOffer={handleSelectOffer}
          />
        </div>
      )}

      {/* Tab 2: User Trade History */}
      {activeTab === 'my_trades' && (
        <div>
          <AdvertiserTradesTable
            trades={trades}
            pagination={tradesPagination}
            loading={tradesLoading}
            onPageChange={(page) => loadTrades(page)}
            onFilterChange={(status) => setTradesStatusFilter(status)}
            onRefresh={() => loadTrades(tradesPagination.page)}
          />
        </div>
      )}

      {/* Sell Gold Modal */}
      {selectedOfferForGold && (
        <SellGoldModal
          offer={selectedOfferForGold}
          onClose={() => setSelectedOfferForGold(null)}
          onTradeCreated={handleTradeCreated}
        />
      )}

      {/* P2P Funding Modal */}
      {selectedOfferForP2p && (
        <P2pFundingModal
          offer={selectedOfferForP2p}
          onClose={() => setSelectedOfferForP2p(null)}
          onTradeCreated={handleTradeCreated}
        />
      )}
    </div>
  );
};
