/**
 * frontend/src/pages/ExchangeMarketplacePage.tsx
 *
 * G4X In-Game Currency & Items Exchange Marketplace (Phase 3).
 *
 * Studio Dark Theme:
 *  - Primary dark background: #09090B / #13151C / #1E202B
 *  - Accents: Gold #FACC15, Purple #8B5CF6, Green #10B981, Red #EF4444
 *
 * Features:
 *  - Real-time catalog filtering (Game, Currency, Region, Delivery Method, Price, Capacity, Sort)
 *  - Eligibility Strip with 8-State KYC status & one-click Apply / Create Buy Order
 *  - Public Buy Order Listings cards & table with visual capacity progress bars
 *  - Zero PII exposure (safe public profile cards with reputation score)
 *  - "View Order Details" modal with exact integer fee calculation breakdown
 *  - "Create Buy Order" studio modal with cascading catalog selectors & capacity previews
 *  - "My Buy Orders" management sub-tab (Publish, Pause, Resume, Cancel)
 *  - Embedded legacy WoW Gold & P2P tab for full backward compatibility
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  ExchangeBuyOrderItem,
  ExchangeEligibilityResponse,
  ExchangeGameItem,
  ExchangeCurrencyItem,
  ExchangeRegionItem,
  ExchangeDeliveryMethodItem,
  CreateBuyOrderPayload,
} from '../types/exchange';
import {
  fetchPublicCatalog,
  fetchExchangeEligibility,
  submitExchangeKyc,
  fetchMarketplaceOrders,
  fetchMyBuyOrders,
  createBuyOrder,
  transitionBuyOrderStatus,
} from '../services/exchangeMarketplace';
import { OfferMarketplaceTable } from '../components/exchange/OfferMarketplaceTable';
import { AdvertiserTradesTable } from '../components/exchange/AdvertiserTradesTable';
import { SellGoldModal } from '../components/exchange/SellGoldModal';
import { P2pFundingModal } from '../components/exchange/P2pFundingModal';
import { ExchangerOffer, GoldTrade, PaginationMeta } from '../types/exchange';
import { fetchAdvertiserTrades } from '../services/exchange';

export const ExchangeMarketplacePage: React.FC = () => {
  const { status } = useAuth();
  const isAuthenticated = status === 'authenticated';

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'marketplace' | 'my_orders' | 'legacy_gold'>('marketplace');

  // Catalog State
  const [catalogGames, setCatalogGames] = useState<ExchangeGameItem[]>([]);
  const [catalogCurrencies, setCatalogCurrencies] = useState<ExchangeCurrencyItem[]>([]);
  const [catalogRegions, setCatalogRegions] = useState<ExchangeRegionItem[]>([]);
  const [catalogDeliveryMethods, setCatalogDeliveryMethods] = useState<ExchangeDeliveryMethodItem[]>([]);

  // User Eligibility State
  const [eligibility, setEligibility] = useState<ExchangeEligibilityResponse | null>(null);

  // Marketplace Orders State
  const [orders, setOrders] = useState<ExchangeBuyOrderItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersLimit] = useState(20);

  // My Buy Orders State
  const [myOrders, setMyOrders] = useState<ExchangeBuyOrderItem[]>([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [myOrdersStatusFilter, setMyOrdersStatusFilter] = useState('ALL');

  // Filter Bar State
  const [filterGameId, setFilterGameId] = useState<string>('');
  const [filterCurrencyId, setFilterCurrencyId] = useState<string>('');
  const [filterRegionId, setFilterRegionId] = useState<string>('');
  const [filterDeliveryMethodId, setFilterDeliveryMethodId] = useState<string>('');
  const [filterMinPriceUsd, setFilterMinPriceUsd] = useState<string>('');
  const [filterMaxPriceUsd, setFilterMaxPriceUsd] = useState<string>('');
  const [filterSort, setFilterSort] = useState<string>('price_desc');

  // Modals
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<ExchangeBuyOrderItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);
  const [kycNotes, setKycNotes] = useState('');
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Legacy tab state
  const [legacyTrades, setLegacyTrades] = useState<GoldTrade[]>([]);
  const [legacyPagination, setLegacyPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [selectedOfferForGold, setSelectedOfferForGold] = useState<ExchangerOffer | null>(null);
  const [selectedOfferForP2p, setSelectedOfferForP2p] = useState<ExchangerOffer | null>(null);

  // ───────────────────────────────────────────────────────────────────────────
  // Data Loaders
  // ───────────────────────────────────────────────────────────────────────────

  const loadCatalog = useCallback(async () => {
    try {
      const data = await fetchPublicCatalog();
      setCatalogGames(data.games || []);
      setCatalogCurrencies(data.currencies || []);
      setCatalogRegions(data.regions || []);
      setCatalogDeliveryMethods(data.deliveryMethods || []);
    } catch (err) {
      console.error('Failed to load exchange catalog:', err);
    }
  }, []);

  const loadEligibility = useCallback(async () => {
    if (!isAuthenticated) {
      setEligibility(null);
      return;
    }
    try {
      const data = await fetchExchangeEligibility();
      setEligibility(data);
    } catch (err) {
      console.error('Failed to load exchange eligibility:', err);
    }
  }, [isAuthenticated]);

  const loadMarketplaceOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const minPriceCents = filterMinPriceUsd ? Math.round(parseFloat(filterMinPriceUsd) * 100) : undefined;
      const maxPriceCents = filterMaxPriceUsd ? Math.round(parseFloat(filterMaxPriceUsd) * 100) : undefined;

      const data = await fetchMarketplaceOrders({
        gameId: filterGameId || undefined,
        currencyId: filterCurrencyId || undefined,
        regionId: filterRegionId || undefined,
        deliveryMethodId: filterDeliveryMethodId || undefined,
        minPriceCents,
        maxPriceCents,
        sort: filterSort,
        page: 1,
        limit: ordersLimit,
      });

      setOrders(data.orders || []);
      setOrdersTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load marketplace orders:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [
    filterGameId,
    filterCurrencyId,
    filterRegionId,
    filterDeliveryMethodId,
    filterMinPriceUsd,
    filterMaxPriceUsd,
    filterSort,
    ordersLimit,
  ]);

  const loadMyOrders = useCallback(async () => {
    if (!isAuthenticated) return;
    setMyOrdersLoading(true);
    try {
      const res = await fetchMyBuyOrders({
        status: myOrdersStatusFilter !== 'ALL' ? myOrdersStatusFilter : undefined,
      });
      setMyOrders(res.orders || []);
    } catch (err) {
      console.error('Failed to load my buy orders:', err);
    } finally {
      setMyOrdersLoading(false);
    }
  }, [isAuthenticated, myOrdersStatusFilter]);

  const loadLegacyTrades = useCallback(async () => {
    if (!isAuthenticated) return;
    setLegacyLoading(true);
    try {
      const res = await fetchAdvertiserTrades({ page: 1, limit: 10, sortOrder: 'desc' });
      setLegacyTrades(Array.isArray(res?.trades) ? res.trades : []);
      setLegacyPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load legacy trades:', err);
    } finally {
      setLegacyLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility]);

  useEffect(() => {
    if (activeTab === 'marketplace') {
      loadMarketplaceOrders();
    } else if (activeTab === 'my_orders') {
      loadMyOrders();
    } else if (activeTab === 'legacy_gold') {
      loadLegacyTrades();
    }
  }, [activeTab, loadMarketplaceOrders, loadMyOrders, loadLegacyTrades]);

  // Filtered Currencies based on selected game
  const availableCurrencies = useMemo(() => {
    if (!filterGameId) return catalogCurrencies;
    return catalogCurrencies.filter((c) => c.gameId === filterGameId);
  }, [catalogCurrencies, filterGameId]);

  // Filtered Regions based on selected game
  const availableRegions = useMemo(() => {
    if (!filterGameId) return catalogRegions;
    return catalogRegions.filter((r) => !r.gameId || r.gameId === filterGameId);
  }, [catalogRegions, filterGameId]);

  // ───────────────────────────────────────────────────────────────────────────
  // KYC Application Handler
  // ───────────────────────────────────────────────────────────────────────────
  const handleSubmitKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setKycSubmitting(true);
    try {
      const res = await submitExchangeKyc({ notes: kycNotes });
      setFeedbackMessage({ type: 'success', text: res.message });
      setIsKycModalOpen(false);
      setKycNotes('');
      await loadEligibility();
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || 'Failed to submit KYC application' });
    } finally {
      setKycSubmitting(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Status Transition Handler for My Orders
  // ───────────────────────────────────────────────────────────────────────────
  const handleTransition = async (orderId: string, action: 'PUBLISH' | 'PAUSE' | 'RESUME' | 'CANCEL') => {
    try {
      await transitionBuyOrderStatus(orderId, action);
      setFeedbackMessage({ type: 'success', text: `Order successfully updated via ${action}` });
      await loadMyOrders();
      if (activeTab === 'marketplace') await loadMarketplaceOrders();
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || `Failed to ${action} order` });
    }
  };

  return (
    <div style={{ maxWidth: '1360px', margin: '0 auto', padding: '24px 16px', color: '#F4F4F5' }}>
      {/* Toast Feedback */}
      {feedbackMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            backgroundColor: feedbackMessage.type === 'success' ? '#064E3B' : '#7F1D1D',
            color: '#FFFFFF',
            padding: '14px 22px',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            border: `1px solid ${feedbackMessage.type === 'success' ? '#10B981' : '#EF4444'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span>{feedbackMessage.type === 'success' ? '✓' : '⚠️'}</span>
          <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{feedbackMessage.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              fontWeight: 700,
              marginLeft: '12px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── Hero Header & Eligibility Strip ─── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #13151C 0%, #1E202B 100%)',
          borderRadius: '14px',
          border: '1px solid #272A37',
          padding: '28px',
          marginBottom: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span
                style={{
                  background: 'rgba(250, 204, 21, 0.15)',
                  color: '#FACC15',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(250, 204, 21, 0.3)',
                }}
              >
                G4X EXCHANGE MARKETPLACE
              </span>
              <span style={{ color: '#4B5563' }}>•</span>
              <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>MULTI-GAME PRECISION ENGINE</span>
            </div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: '2.1rem', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
              In-Game Currency &amp; Items Exchange
            </h1>
            <p style={{ margin: 0, color: '#9CA3AF', fontSize: '0.95rem', maxWidth: '780px', lineHeight: 1.6 }}>
              Browse active buy orders from verified community Exchangers across World of Warcraft, Path of Exile, Diablo IV, and more.
              Transparent pricing, exact integer settlement, and zero hidden platform slippage.
            </p>
          </div>

          {/* Action Button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            {eligibility?.canCreateBuyOrder ? (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                style={{
                  backgroundColor: '#FACC15',
                  color: '#09090B',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(250, 204, 21, 0.35)',
                  transition: 'all 0.15s ease-in-out',
                }}
              >
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>+</span> Create Buy Order
              </button>
            ) : (
              <button
                onClick={() => setIsKycModalOpen(true)}
                style={{
                  backgroundColor: '#8B5CF6',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
                }}
              >
                🛡️ Apply for Exchanger Role
              </button>
            )}
            <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
              {eligibility?.canCreateBuyOrder
                ? 'Active Exchanger account ready to place orders'
                : 'Exchangers require approved KYC to place buy orders'}
            </span>
          </div>
        </div>

        {/* ─── Eligibility Status Strip ─── */}
        {isAuthenticated && eligibility && (
          <div
            style={{
              marginTop: '22px',
              paddingTop: '16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '0.85rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#9CA3AF' }}>Exchanger Status:</span>
                {eligibility.kycStatus === 'APPROVED' ? (
                  <span
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#10B981',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    ✓ Verified Exchanger
                  </span>
                ) : eligibility.kycStatus === 'PENDING_REVIEW' || eligibility.kycStatus === 'UNDER_REVIEW' ? (
                  <span
                    style={{
                      backgroundColor: 'rgba(250, 204, 21, 0.15)',
                      color: '#FACC15',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: '1px solid rgba(250, 204, 21, 0.3)',
                    }}
                  >
                    ⏳ KYC Under Review
                  </span>
                ) : eligibility.kycStatus === 'REJECTED' ? (
                  <span
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      color: '#EF4444',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    ✕ KYC Rejected
                  </span>
                ) : (
                  <span
                    style={{
                      backgroundColor: 'rgba(107, 114, 128, 0.2)',
                      color: '#D1D5DB',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: '1px solid rgba(107, 114, 128, 0.3)',
                    }}
                  >
                    Standard Member (Seller Eligible)
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#9CA3AF' }}>Selling Rights:</span>
                <span style={{ color: eligibility.canSubmitSellOffer ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {eligibility.canSubmitSellOffer ? '✓ Permitted (All G4X Roles)' : '✕ Restricted'}
                </span>
              </div>
            </div>

            {eligibility.blockingReasons.length > 0 && !eligibility.canCreateBuyOrder && (
              <div style={{ color: '#F87171', fontSize: '0.8rem' }}>
                Note: {eligibility.blockingReasons[0]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Navigation Tabs ─── */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          borderBottom: '1px solid #272A37',
          marginBottom: '24px',
        }}
      >
        <button
          onClick={() => setActiveTab('marketplace')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'marketplace' ? '3px solid #FACC15' : '3px solid transparent',
            color: activeTab === 'marketplace' ? '#FACC15' : '#9CA3AF',
            fontWeight: activeTab === 'marketplace' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          Marketplace Buy Orders ({ordersTotal})
        </button>

        {isAuthenticated && (
          <button
            onClick={() => setActiveTab('my_orders')}
            style={{
              padding: '12px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'my_orders' ? '3px solid #FACC15' : '3px solid transparent',
              color: activeTab === 'my_orders' ? '#FACC15' : '#9CA3AF',
              fontWeight: activeTab === 'my_orders' ? 700 : 500,
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            My Buy Orders
          </button>
        )}

        <button
          onClick={() => setActiveTab('legacy_gold')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'legacy_gold' ? '3px solid #FACC15' : '3px solid transparent',
            color: activeTab === 'legacy_gold' ? '#FACC15' : '#9CA3AF',
            fontWeight: activeTab === 'legacy_gold' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          Legacy WoW Gold &amp; P2P Offers
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 1: MARKETPLACE BUY ORDERS
          ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'marketplace' && (
        <div>
          {/* Filter Bar */}
          <div
            style={{
              background: '#13151C',
              border: '1px solid #272A37',
              borderRadius: '10px',
              padding: '18px',
              marginBottom: '20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px',
              alignItems: 'end',
            }}
          >
            {/* Game Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                GAME
              </label>
              <select
                value={filterGameId}
                onChange={(e) => {
                  setFilterGameId(e.target.value);
                  setFilterCurrencyId('');
                }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Games</option>
                {catalogGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Currency Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                CURRENCY / ITEM
              </label>
              <select
                value={filterCurrencyId}
                onChange={(e) => setFilterCurrencyId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Currencies</option>
                {availableCurrencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.unitLabel})
                  </option>
                ))}
              </select>
            </div>

            {/* Region Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                REGION / SERVER
              </label>
              <select
                value={filterRegionId}
                onChange={(e) => setFilterRegionId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Regions</option>
                {availableRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Delivery Method Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                DELIVERY METHOD
              </label>
              <select
                value={filterDeliveryMethodId}
                onChange={(e) => setFilterDeliveryMethodId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Methods</option>
                {catalogDeliveryMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Price Range Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                PRICE RANGE (USD)
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  placeholder="Min"
                  value={filterMinPriceUsd}
                  onChange={(e) => setFilterMinPriceUsd(e.target.value)}
                  style={{
                    width: '50%',
                    padding: '9px 8px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #272A37',
                    borderRadius: '6px',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                  }}
                />
                <span style={{ color: '#6B7280' }}>-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filterMaxPriceUsd}
                  onChange={(e) => setFilterMaxPriceUsd(e.target.value)}
                  style={{
                    width: '50%',
                    padding: '9px 8px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #272A37',
                    borderRadius: '6px',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
            </div>

            {/* Sort Dropdown */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                SORT BY
              </label>
              <select
                value={filterSort}
                onChange={(e) => setFilterSort(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="price_desc">Highest Price First</option>
                <option value="price_asc">Lowest Price First</option>
                <option value="newest">Newest Orders</option>
                <option value="oldest">Oldest Orders</option>
              </select>
            </div>
          </div>

          {/* Listings List */}
          {ordersLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#9CA3AF' }}>
              Loading active marketplace listings...
            </div>
          ) : orders.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px',
                background: '#13151C',
                borderRadius: '10px',
                border: '1px solid #272A37',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🪙</div>
              <h3 style={{ margin: '0 0 8px 0', color: '#FFFFFF', fontSize: '1.2rem' }}>No active buy orders found</h3>
              <p style={{ margin: '0 0 16px 0', color: '#9CA3AF', fontSize: '0.9rem' }}>
                Try adjusting your filters, or create the first buy order for this currency!
              </p>
              {eligibility?.canCreateBuyOrder && (
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  style={{
                    backgroundColor: '#FACC15',
                    color: '#09090B',
                    fontWeight: 700,
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  + Create Buy Order
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {orders.map((order) => {
                // Capacity calculations
                const totalBig = BigInt(order.totalCapacityBaseUnits || '0');
                const remainingBig = BigInt(order.remainingCapacityBaseUnits || '0');
                const percentRemaining = totalBig > 0n ? Number((remainingBig * 100n) / totalBig) : 0;

                // Multiplier label calculation
                const multiplier = BigInt(order.currency.unitMultiplier || '1');
                const humanRemainingUnits = multiplier > 1n ? (remainingBig / multiplier).toString() : remainingBig.toString();
                const humanTotalUnits = multiplier > 1n ? (totalBig / multiplier).toString() : totalBig.toString();

                return (
                  <div
                    key={order.id}
                    style={{
                      background: '#13151C',
                      border: '1px solid #272A37',
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '20px',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    {/* Left: Game & Currency info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: '260px' }}>
                      <div
                        style={{
                          width: '52px',
                          height: '52px',
                          borderRadius: '10px',
                          backgroundColor: '#1E202B',
                          border: '1px solid #272A37',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {order.game.iconUrl ? (
                          <img src={order.game.iconUrl} alt={order.game.name} style={{ width: '32px', height: '32px' }} />
                        ) : (
                          <span style={{ fontSize: '1.4rem' }}>🎮</span>
                        )}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#9CA3AF', fontWeight: 600 }}>{order.game.name}</span>
                          {order.region && (
                            <span
                              style={{
                                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                color: '#60A5FA',
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              {order.region.name}
                            </span>
                          )}
                          <span
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.06)',
                              color: '#9CA3AF',
                              fontSize: '0.7rem',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                            }}
                          >
                            {order.orderCode}
                          </span>
                        </div>

                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#FFFFFF' }}>
                          {order.currency.name}
                        </div>

                        <div style={{ fontSize: '0.8rem', color: '#6B7280', marginTop: '2px' }}>
                          Unit: {order.currency.unitLabel}
                        </div>
                      </div>
                    </div>

                    {/* Middle: Capacity Progress Bar & Trade Limits */}
                    <div style={{ flex: '1 1 240px', minWidth: '220px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                        <span style={{ color: '#9CA3AF' }}>Available Capacity:</span>
                        <span style={{ color: '#FACC15', fontWeight: 700 }}>
                          {humanRemainingUnits} / {humanTotalUnits} {order.currency.unitLabel}s
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div
                        style={{
                          width: '100%',
                          height: '8px',
                          backgroundColor: '#1E202B',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          marginBottom: '8px',
                        }}
                      >
                        <div
                          style={{
                            width: `${percentRemaining}%`,
                            height: '100%',
                            backgroundColor: percentRemaining > 20 ? '#10B981' : '#F59E0B',
                            borderRadius: '4px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6B7280' }}>
                        <span>
                          Min Trade: {(BigInt(order.minTradeBaseUnits) / multiplier).toString()} {order.currency.unitLabel}
                        </span>
                        <span>
                          Max Trade: {(BigInt(order.maxTradeBaseUnits) / multiplier).toString()} {order.currency.unitLabel}
                        </span>
                      </div>
                    </div>

                    {/* Middle Right: Unit Price */}
                    <div style={{ textAlign: 'right', minWidth: '150px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: 600 }}>
                        BUYING PRICE
                      </div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10B981', letterSpacing: '-0.02em' }}>
                        ${order.pricePerUnitUsd}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>per {order.currency.unitLabel}</div>
                    </div>

                    {/* Right: Buyer Profile (Zero PII) & Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', minWidth: '170px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#FFFFFF' }}>
                            {order.buyer.displayName || order.buyer.username}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#10B981' }}>
                            Reputation: {order.buyer.reputationScore}%
                          </div>
                        </div>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            backgroundColor: '#8B5CF6',
                            color: '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.8rem',
                          }}
                        >
                          {(order.buyer.displayName || order.buyer.username).substring(0, 2).toUpperCase()}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setSelectedOrderDetails(order)}
                          style={{
                            backgroundColor: '#1E202B',
                            color: '#D1D5DB',
                            border: '1px solid #272A37',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          View Details
                        </button>

                        <button
                          onClick={() => setSelectedOrderDetails(order)}
                          style={{
                            backgroundColor: '#FACC15',
                            color: '#09090B',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Sell to Buyer
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 2: MY BUY ORDERS (EXCHANGER MANAGEMENT)
          ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'my_orders' && (
        <div>
          {/* Status Filter for My Orders */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '18px',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              {['ALL', 'ACTIVE', 'DRAFT', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setMyOrdersStatusFilter(st)}
                  style={{
                    backgroundColor: myOrdersStatusFilter === st ? '#FACC15' : '#1E202B',
                    color: myOrdersStatusFilter === st ? '#09090B' : '#9CA3AF',
                    border: '1px solid #272A37',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {st}
                </button>
              ))}
            </div>

            {eligibility?.canCreateBuyOrder && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                style={{
                  backgroundColor: '#FACC15',
                  color: '#09090B',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                + New Order
              </button>
            )}
          </div>

          {/* Orders List */}
          {myOrdersLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#9CA3AF' }}>Loading your orders...</div>
          ) : myOrders.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px',
                background: '#13151C',
                borderRadius: '10px',
                border: '1px solid #272A37',
              }}
            >
              <h3 style={{ margin: '0 0 8px 0', color: '#FFFFFF' }}>No orders found</h3>
              <p style={{ margin: 0, color: '#9CA3AF', fontSize: '0.9rem' }}>
                You have not created any buy orders with status {myOrdersStatusFilter}.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {myOrders.map((order) => {
                const totalBig = BigInt(order.totalCapacityBaseUnits || '0');
                const filledBig = BigInt(order.filledCapacityBaseUnits || '0');
                const remainingBig = BigInt(order.remainingCapacityBaseUnits || '0');
                const multiplier = BigInt(order.currency.unitMultiplier || '1');

                return (
                  <div
                    key={order.id}
                    style={{
                      background: '#13151C',
                      border: '1px solid #272A37',
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <span
                          style={{
                            backgroundColor:
                              order.status === 'ACTIVE'
                                ? 'rgba(16, 185, 129, 0.15)'
                                : order.status === 'PAUSED'
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(107, 114, 128, 0.15)',
                            color:
                              order.status === 'ACTIVE'
                                ? '#10B981'
                                : order.status === 'PAUSED'
                                ? '#F59E0B'
                                : '#9CA3AF',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                          }}
                        >
                          {order.status}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#9CA3AF', fontFamily: 'monospace' }}>
                          {order.orderCode}
                        </span>
                        <span style={{ color: '#4B5563' }}>•</span>
                        <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{order.game.name}</span>
                      </div>

                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#FFFFFF' }}>
                        {order.currency.name} @ ${order.pricePerUnitUsd} / {order.currency.unitLabel}
                      </div>

                      <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '4px' }}>
                        Capacity: {(remainingBig / multiplier).toString()} / {(totalBig / multiplier).toString()} {order.currency.unitLabel}s remaining
                        ({(filledBig / multiplier).toString()} filled)
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {order.status === 'DRAFT' && (
                        <button
                          onClick={() => handleTransition(order.id, 'PUBLISH')}
                          style={{
                            backgroundColor: '#10B981',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Publish Live
                        </button>
                      )}

                      {['ACTIVE', 'PARTIALLY_FILLED'].includes(order.status) && (
                        <button
                          onClick={() => handleTransition(order.id, 'PAUSE')}
                          style={{
                            backgroundColor: '#F59E0B',
                            color: '#09090B',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Pause Order
                        </button>
                      )}

                      {order.status === 'PAUSED' && (
                        <button
                          onClick={() => handleTransition(order.id, 'RESUME')}
                          style={{
                            backgroundColor: '#10B981',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Resume Order
                        </button>
                      )}

                      {!['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(order.status) && (
                        <button
                          onClick={() => handleTransition(order.id, 'CANCEL')}
                          style={{
                            backgroundColor: '#EF4444',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel Order
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedOrderDetails(order)}
                        style={{
                          backgroundColor: '#1E202B',
                          color: '#D1D5DB',
                          border: '1px solid #272A37',
                          borderRadius: '6px',
                          padding: '8px 14px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 3: LEGACY WOW GOLD & P2P OFFERS
          ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'legacy_gold' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <OfferMarketplaceTable
              onSelectForSell={(offer) => setSelectedOfferForGold(offer)}
              onSelectForP2p={(offer) => setSelectedOfferForP2p(offer)}
            />
          </div>

          {isAuthenticated && (
            <div style={{ marginTop: '30px' }}>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '14px', color: '#FFFFFF' }}>My Trade History</h3>
              <AdvertiserTradesTable
                trades={legacyTrades}
                pagination={legacyPagination}
                loading={legacyLoading}
                onPageChange={() => loadLegacyTrades()}
                onFilterChange={() => loadLegacyTrades()}
                onRefresh={() => loadLegacyTrades()}
              />
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          ORDER DETAILS MODAL (WITH PRICING CALCULATOR PREVIEW)
          ───────────────────────────────────────────────────────────────────────── */}
      {selectedOrderDetails && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid #272A37',
              borderRadius: '14px',
              maxWidth: '620px',
              width: '100%',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontFamily: 'monospace' }}>
                  {selectedOrderDetails.orderCode}
                </span>
                <h2 style={{ margin: '2px 0 0 0', fontSize: '1.35rem', color: '#FFFFFF' }}>
                  {selectedOrderDetails.game.name} — {selectedOrderDetails.currency.name}
                </h2>
              </div>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9CA3AF',
                  fontSize: '1.4rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Price & Summary */}
            <div
              style={{
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '18px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>UNIT PRICE</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10B981' }}>
                  ${selectedOrderDetails.pricePerUnitUsd}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>per {selectedOrderDetails.currency.unitLabel}</div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>STATUS</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#FFFFFF', marginTop: '4px' }}>
                  {selectedOrderDetails.status}
                </div>
                {selectedOrderDetails.region && (
                  <div style={{ fontSize: '0.75rem', color: '#60A5FA', marginTop: '2px' }}>
                    Region: {selectedOrderDetails.region.name}
                  </div>
                )}
              </div>
            </div>

            {/* Buyer Instructions */}
            {selectedOrderDetails.instructions && (
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '0.8rem', color: '#9CA3AF', fontWeight: 600, marginBottom: '6px' }}>
                  BUYER INSTRUCTIONS
                </div>
                <div
                  style={{
                    backgroundColor: '#1E202B',
                    border: '1px solid #272A37',
                    borderRadius: '6px',
                    padding: '12px',
                    fontSize: '0.85rem',
                    color: '#D1D5DB',
                    lineHeight: 1.5,
                  }}
                >
                  {selectedOrderDetails.instructions}
                </div>
              </div>
            )}

            {/* Fee Preview Breakdown */}
            {selectedOrderDetails.pricingPreview && (
              <div
                style={{
                  backgroundColor: 'rgba(139, 92, 246, 0.08)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  borderRadius: '8px',
                  padding: '14px',
                  marginBottom: '18px',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ fontWeight: 700, color: '#A78BFA', marginBottom: '8px' }}>
                  FEE CALCULATION SIMULATOR (FOR MIN TRADE UNIT)
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#9CA3AF' }}>Gross Trade Value:</span>
                  <span style={{ color: '#FFFFFF', fontWeight: 600 }}>${selectedOrderDetails.pricingPreview.grossUsd}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#9CA3AF' }}>
                    Seller Platform Fee ({selectedOrderDetails.pricingPreview.sellerCommissionBps / 100}%):
                  </span>
                  <span style={{ color: '#EF4444' }}>-${selectedOrderDetails.pricingPreview.sellerFeeUsd}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: '6px',
                    borderTop: '1px solid rgba(139, 92, 246, 0.2)',
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: '#FFFFFF' }}>Net Seller Payout:</span>
                  <span style={{ color: '#10B981' }}>${selectedOrderDetails.pricingPreview.netSellerUsd}</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                style={{
                  backgroundColor: '#1E202B',
                  color: '#FFFFFF',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  padding: '9px 18px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          CREATE BUY ORDER MODAL
          ───────────────────────────────────────────────────────────────────────── */}
      {isCreateModalOpen && (
        <CreateBuyOrderModal
          catalogGames={catalogGames}
          catalogCurrencies={catalogCurrencies}
          catalogRegions={catalogRegions}
          catalogDeliveryMethods={catalogDeliveryMethods}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={async (newOrder) => {
            setIsCreateModalOpen(false);
            setFeedbackMessage({
              type: 'success',
              text: `Order ${newOrder.orderCode} successfully created!`,
            });
            await loadMarketplaceOrders();
            await loadMyOrders();
          }}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          EXCHANGER KYC APPLICATION MODAL
          ───────────────────────────────────────────────────────────────────────── */}
      {isKycModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid #272A37',
              borderRadius: '14px',
              maxWidth: '540px',
              width: '100%',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#FFFFFF' }}>🛡️ Apply for Exchanger Role</h2>
              <button
                onClick={() => setIsKycModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#9CA3AF', lineHeight: 1.5, marginBottom: '18px' }}>
              Exchangers have verified purchasing authority to publish live buy orders on the G4X Exchange Marketplace.
              Please submit your trader verification details below for review by our compliance team.
            </p>

            <form onSubmit={handleSubmitKyc}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                  Application Notes &amp; Trading Experience
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide your trading background, expected volume, preferred games, and any community references..."
                  value={kycNotes}
                  onChange={(e) => setKycNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #272A37',
                    borderRadius: '6px',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsKycModalOpen(false)}
                  style={{
                    backgroundColor: '#1E202B',
                    color: '#FFFFFF',
                    border: '1px solid #272A37',
                    borderRadius: '6px',
                    padding: '9px 18px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={kycSubmitting}
                  style={{
                    backgroundColor: '#8B5CF6',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '9px 20px',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {kycSubmitting ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Legacy modals */}
      {selectedOfferForGold && (
        <SellGoldModal
          initialOffer={selectedOfferForGold}
          onClose={() => setSelectedOfferForGold(null)}
          onTradeCreated={() => {
            setSelectedOfferForGold(null);
            loadLegacyTrades();
          }}
        />
      )}
      {selectedOfferForP2p && (
        <P2pFundingModal
          initialOffer={selectedOfferForP2p}
          onClose={() => setSelectedOfferForP2p(null)}
          onFundingCreated={() => {
            setSelectedOfferForP2p(null);
            loadLegacyTrades();
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE BUY ORDER STUDIO MODAL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface CreateBuyOrderModalProps {
  catalogGames: ExchangeGameItem[];
  catalogCurrencies: ExchangeCurrencyItem[];
  catalogRegions: ExchangeRegionItem[];
  catalogDeliveryMethods: ExchangeDeliveryMethodItem[];
  onClose: () => void;
  onCreated: (order: ExchangeBuyOrderItem) => void;
}

const CreateBuyOrderModal: React.FC<CreateBuyOrderModalProps> = ({
  catalogGames,
  catalogCurrencies,
  catalogRegions,
  catalogDeliveryMethods,
  onClose,
  onCreated,
}) => {
  const [gameId, setGameId] = useState(catalogGames[0]?.id || '');
  const [currencyId, setCurrencyId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [pricePerUnitUsd, setPricePerUnitUsd] = useState('1.00');
  const [minTradeUnits, setMinTradeUnits] = useState('1');
  const [maxTradeUnits, setMaxTradeUnits] = useState('100');
  const [totalCapacityUnits, setTotalCapacityUnits] = useState('1000');
  const [selectedDeliveryMethods, setSelectedDeliveryMethods] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-select currency when game changes
  const availableCurrencies = useMemo(() => {
    return catalogCurrencies.filter((c) => c.gameId === gameId);
  }, [catalogCurrencies, gameId]);

  useEffect(() => {
    if (availableCurrencies.length > 0 && !availableCurrencies.find((c) => c.id === currencyId)) {
      setCurrencyId(availableCurrencies[0].id);
    }
  }, [availableCurrencies, currencyId]);

  // Selected Currency Item
  const activeCurrency = useMemo(() => {
    return catalogCurrencies.find((c) => c.id === currencyId);
  }, [catalogCurrencies, currencyId]);

  // Regions for selected game
  const availableRegions = useMemo(() => {
    return catalogRegions.filter((r) => !r.gameId || r.gameId === gameId);
  }, [catalogRegions, gameId]);

  // Delivery methods available
  useEffect(() => {
    if (catalogDeliveryMethods.length > 0 && selectedDeliveryMethods.length === 0) {
      setSelectedDeliveryMethods([catalogDeliveryMethods[0].id]);
    }
  }, [catalogDeliveryMethods, selectedDeliveryMethods.length]);

  const toggleDeliveryMethod = (id: string) => {
    setSelectedDeliveryMethods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleCreate = async (publishImmediately: boolean) => {
    setErrorMsg('');
    if (!gameId || !currencyId) {
      setErrorMsg('Please select a game and currency');
      return;
    }
    if (selectedDeliveryMethods.length === 0) {
      setErrorMsg('Please select at least one accepted delivery method');
      return;
    }

    const priceCents = Math.round(parseFloat(pricePerUnitUsd) * 100);
    if (isNaN(priceCents) || priceCents <= 0) {
      setErrorMsg('Price per unit must be greater than $0.00');
      return;
    }

    const multiplier = BigInt(activeCurrency?.unitMultiplier || '1');
    const minUnitsNum = BigInt(minTradeUnits || '1');
    const maxUnitsNum = BigInt(maxTradeUnits || '1');
    const totalUnitsNum = BigInt(totalCapacityUnits || '1');

    if (minUnitsNum > maxUnitsNum) {
      setErrorMsg('Min trade units cannot exceed Max trade units');
      return;
    }
    if (totalUnitsNum < minUnitsNum) {
      setErrorMsg('Total capacity cannot be less than Min trade units');
      return;
    }

    const minBaseUnits = (minUnitsNum * multiplier).toString();
    const maxBaseUnits = (maxUnitsNum * multiplier).toString();
    const totalBaseUnits = (totalUnitsNum * multiplier).toString();

    setSubmitting(true);
    try {
      const payload: CreateBuyOrderPayload = {
        gameId,
        currencyId,
        regionId: regionId || null,
        pricePerUnitCents: priceCents,
        minTradeBaseUnits: minBaseUnits,
        maxTradeBaseUnits: maxBaseUnits,
        totalCapacityBaseUnits: totalBaseUnits,
        acceptedDeliveryMethodIds: selectedDeliveryMethods,
        instructions: instructions.trim() || undefined,
        publishImmediately,
      };

      const res = await createBuyOrder(payload);
      onCreated(res.order);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create buy order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#13151C',
          border: '1px solid #272A37',
          borderRadius: '14px',
          maxWidth: '680px',
          width: '100%',
          padding: '26px',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#FACC15', fontWeight: 700, letterSpacing: '0.05em' }}>
              EXCHANGER STUDIO
            </span>
            <h2 style={{ margin: '2px 0 0 0', fontSize: '1.4rem', color: '#FFFFFF' }}>Create New Buy Order</h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #EF4444',
              color: '#FCA5A5',
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              marginBottom: '16px',
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          {/* Game Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Game
            </label>
            <select
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
              }}
            >
              {catalogGames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Currency Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Currency / Item
            </label>
            <select
              value={currencyId}
              onChange={(e) => setCurrencyId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
              }}
            >
              {availableCurrencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.unitLabel})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          {/* Region Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Region / Server (Optional)
            </label>
            <select
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
              }}
            >
              <option value="">All Regions / Global</option>
              {availableRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </div>

          {/* Unit Price in USD */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Buying Price (USD per {activeCurrency?.unitLabel || 'Unit'})
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '10px', color: '#9CA3AF', fontSize: '0.9rem' }}>$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={pricePerUnitUsd}
                onChange={(e) => setPricePerUnitUsd(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 10px 10px 28px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #272A37',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {/* Quantities in Trade Units */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Min Trade ({activeCurrency?.unitLabel || 'Units'})
            </label>
            <input
              type="number"
              min="1"
              required
              value={minTradeUnits}
              onChange={(e) => setMinTradeUnits(e.target.value)}
              style={{
                width: '100%',
                padding: '9px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Max Trade ({activeCurrency?.unitLabel || 'Units'})
            </label>
            <input
              type="number"
              min="1"
              required
              value={maxTradeUnits}
              onChange={(e) => setMaxTradeUnits(e.target.value)}
              style={{
                width: '100%',
                padding: '9px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
              Total Capacity ({activeCurrency?.unitLabel || 'Units'})
            </label>
            <input
              type="number"
              min="1"
              required
              value={totalCapacityUnits}
              onChange={(e) => setTotalCapacityUnits(e.target.value)}
              style={{
                width: '100%',
                padding: '9px',
                backgroundColor: '#1E202B',
                border: '1px solid #272A37',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Accepted Delivery Methods */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '8px', fontWeight: 600 }}>
            Accepted Delivery Methods
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {catalogDeliveryMethods.map((m) => {
              const isChecked = selectedDeliveryMethods.includes(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => toggleDeliveryMethod(m.id)}
                  style={{
                    backgroundColor: isChecked ? 'rgba(250, 204, 21, 0.15)' : '#1E202B',
                    color: isChecked ? '#FACC15' : '#9CA3AF',
                    border: `1px solid ${isChecked ? '#FACC15' : '#272A37'}`,
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {isChecked ? '✓ ' : '+ '} {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Trade Instructions */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
            Trade Instructions (Optional)
          </label>
          <textarea
            rows={2}
            placeholder="e.g. In-game mail to character 'Aethelgard', or meet in Orgrimmar bank..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#1E202B',
              border: '1px solid #272A37',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '0.85rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              backgroundColor: '#1E202B',
              color: '#FFFFFF',
              border: '1px solid #272A37',
              borderRadius: '6px',
              padding: '10px 18px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => handleCreate(false)}
            style={{
              backgroundColor: '#374151',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 18px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Save Draft
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => handleCreate(true)}
            style={{
              backgroundColor: '#FACC15',
              color: '#09090B',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 22px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {submitting ? 'Creating...' : 'Publish Live'}
          </button>
        </div>
      </div>
    </div>
  );
};
