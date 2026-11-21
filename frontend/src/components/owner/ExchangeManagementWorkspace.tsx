/**
 * frontend/src/components/owner/ExchangeManagementWorkspace.tsx
 *
 * Dedicated Owner Panel for G4X In-Game Currency & Items Exchange Configuration (Phase 1).
 * Features:
 *  - Games Management (CRUD, slug, active status)
 *  - Currencies & Multipliers (CRUD, unit multiplier presets 1, 1K, 10K, 100K, 1M, min/max limits)
 *  - Regions & Delivery Methods (CRUD, codes, descriptions)
 *  - Immutable Versioned Fee Rules & Interactive Zero-Drift Pricing Simulator
 *  - Real-Time Audit Log History with expandable JSON diffs
 *  - Studio Dark Theme (#09090B / #13151C, accents #FACC15, #8B5CF6, #10B981)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ExchangeGameItem,
  ExchangeCurrencyItem,
  ExchangeRegionItem,
  ExchangeDeliveryMethodItem,
  ExchangeFeeRuleItem,
  TradePricingCalculation,
  ExchangeAuditLogItem,
  ExchangeOverviewStats,
} from '../../types/exchange';
import {
  fetchExchangeOverview,
  fetchExchangeGames,
  createExchangeGame,
  updateExchangeGame,
  fetchExchangeCurrencies,
  createExchangeCurrency,
  updateExchangeCurrency,
  fetchExchangeRegions,
  createExchangeRegion,
  updateExchangeRegion,
  fetchExchangeDeliveryMethods,
  createExchangeDeliveryMethod,
  updateExchangeDeliveryMethod,
  fetchExchangeFeeRules,
  createExchangeFeeRule,
  toggleExchangeFeeRule,
  previewExchangeFee,
  fetchExchangeAuditLogs,
  bootstrapExchangeDefaults,
} from '../../services/exchangeConfig';

type SubTab = 'games' | 'currencies' | 'regions_delivery' | 'fee_rules' | 'audit';

export const ExchangeManagementWorkspace: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('fee_rules');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Data states
  const [overview, setOverview] = useState<ExchangeOverviewStats | null>(null);
  const [games, setGames] = useState<ExchangeGameItem[]>([]);
  const [currencies, setCurrencies] = useState<ExchangeCurrencyItem[]>([]);
  const [regions, setRegions] = useState<ExchangeRegionItem[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<ExchangeDeliveryMethodItem[]>([]);
  const [feeRules, setFeeRules] = useState<ExchangeFeeRuleItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<ExchangeAuditLogItem[]>([]);

  // Filter states
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>('ALL');

  // Modals state
  const [isGameModalOpen, setIsGameModalOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<ExchangeGameItem | null>(null);

  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<ExchangeCurrencyItem | null>(null);

  const [isRegionModalOpen, setIsRegionModalOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<ExchangeRegionItem | null>(null);

  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<ExchangeDeliveryMethodItem | null>(null);

  const [isFeeModalOpen, setIsFeeModalOpen] = useState(false);

  // Simulator state
  const [simGameId, setSimGameId] = useState<string>('');
  const [simCurrencyId, setSimCurrencyId] = useState<string>('');
  const [simQuantity, setSimQuantity] = useState<string>('20000000');
  const [simMultiplier, setSimMultiplier] = useState<string>('100000');
  const [simPriceUsd, setSimPriceUsd] = useState<string>('0.85');
  const [simResult, setSimResult] = useState<TradePricingCalculation | null>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);

  // Audit log expanded rows
  const [expandedLogIds, setExpandedLogIds] = useState<Record<number, boolean>>({});

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovData, gamesData, currenciesData, regionsData, deliveryData, feeData, auditData] =
        await Promise.all([
          fetchExchangeOverview().catch(() => null),
          fetchExchangeGames().catch(() => []),
          fetchExchangeCurrencies().catch(() => []),
          fetchExchangeRegions().catch(() => []),
          fetchExchangeDeliveryMethods().catch(() => []),
          fetchExchangeFeeRules().catch(() => []),
          fetchExchangeAuditLogs(50).catch(() => []),
        ]);

      setOverview(ovData);
      setGames(gamesData);
      setCurrencies(currenciesData);
      setRegions(regionsData);
      setDeliveryMethods(deliveryData);
      setFeeRules(feeData);
      setAuditLogs(auditData);

      if (gamesData.length > 0 && !simGameId) {
        setSimGameId(gamesData[0].id);
        const gameCurrs = currenciesData.filter((c) => c.gameId === gamesData[0].id);
        if (gameCurrs.length > 0) {
          setSimCurrencyId(gameCurrs[0].id);
          setSimMultiplier(gameCurrs[0].unitMultiplier);
        }
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to load exchange configurations');
    } finally {
      setLoading(false);
    }
  }, [simGameId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Live Simulator auto-refresh on changes
  const runSimulation = useCallback(async () => {
    if (!simQuantity || !simMultiplier || !simPriceUsd) return;
    setSimLoading(true);
    try {
      const priceCents = Math.round(parseFloat(simPriceUsd) * 100);
      const res = await previewExchangeFee({
        quantityBaseUnits: simQuantity,
        unitMultiplier: simMultiplier,
        pricePerUnitCents: priceCents,
        gameId: simGameId || undefined,
        currencyId: simCurrencyId || undefined,
      });
      setSimResult(res.calculation);
    } catch (err: any) {
      // Keep silent or show subtle warning in simulator
    } finally {
      setSimLoading(false);
    }
  }, [simQuantity, simMultiplier, simPriceUsd, simGameId, simCurrencyId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      runSimulation();
    }, 300);
    return () => clearTimeout(timer);
  }, [runSimulation]);

  // Handle bootstrap seeder
  const handleBootstrap = async () => {
    if (!window.confirm('Seed default exchange games, currencies, regions, and global fee rules?')) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await bootstrapExchangeDefaults();
      showNotification('success', `Defaults seeded: ${res.gamesSeeded} games, ${res.regionsSeeded} regions, ${res.deliveryMethodsSeeded} delivery methods, ${res.feeRulesSeeded} fee rules.`);
      await loadAllData();
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to bootstrap defaults');
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle Fee Rule
  const handleToggleFeeRule = async (rule: ExchangeFeeRuleItem) => {
    setActionLoading(true);
    try {
      await toggleExchangeFeeRule(rule.id, !rule.isEnabled, `Owner toggled rule ${rule.id} to ${!rule.isEnabled}`);
      showNotification('success', `Fee rule version ${rule.version} status updated.`);
      await loadAllData();
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to toggle fee rule');
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered Currencies
  const filteredCurrencies = useMemo(() => {
    if (selectedGameFilter === 'ALL') return currencies;
    return currencies.filter((c) => c.gameId === selectedGameFilter);
  }, [currencies, selectedGameFilter]);

  // Active Global Rule from overview or rules list
  const activeGlobalRule = useMemo(() => {
    return feeRules.find((r) => r.scope === 'GLOBAL' && r.isEnabled) || overview?.activeGlobalRule;
  }, [feeRules, overview]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        padding: '1.5rem',
        backgroundColor: '#09090B',
        color: '#EDEDED',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        minHeight: '80vh',
      }}
    >
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* HEADER & TOP STATS BAR                                                    */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '1.25rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.5rem' }}>💱</span>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Exchange Management
            </h1>
            <span
              style={{
                backgroundColor: 'rgba(250, 204, 21, 0.12)',
                color: '#FACC15',
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                border: '1px solid rgba(250, 204, 21, 0.25)',
              }}
            >
              Owner Restricted
            </span>
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#A1A1AA' }}>
            Configure tradeable games, currency unit multipliers, regions, delivery methods, and immutable versioned fee rules with zero float arithmetic.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleBootstrap}
            disabled={actionLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#1E293B',
              color: '#94A3B8',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '0.5rem 0.9rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Seed default games (WoW, PoE, Diablo IV), regions, delivery methods, and global fee rule"
          >
            <span>⚡</span>
            <span>Seed Default Config</span>
          </button>

          <button
            type="button"
            onClick={loadAllData}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#18181B',
              color: '#E4E4E7',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              padding: '0.5rem 0.9rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span>🔄</span>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor:
              notification.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: notification.type === 'success' ? '#10B981' : '#EF4444',
            border: `1px solid ${
              notification.type === 'success' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
            }`,
          }}
        >
          <span>{notification.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            backgroundColor: '#13151C',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '1rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: '#A1A1AA', textTransform: 'uppercase', fontWeight: 600 }}>
            Active Games
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#EDEDED', marginTop: '0.35rem' }}>
            {overview?.gamesCount ?? games.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#10B981', marginTop: '0.2rem' }}>
            {games.filter((g) => g.isActive).length} active in catalog
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#13151C',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '1rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: '#A1A1AA', textTransform: 'uppercase', fontWeight: 600 }}>
            Tradeable Currencies
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#EDEDED', marginTop: '0.35rem' }}>
            {overview?.currenciesCount ?? currencies.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#8B5CF6', marginTop: '0.2rem' }}>
            Across {games.length} games
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#13151C',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '1rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: '#A1A1AA', textTransform: 'uppercase', fontWeight: 600 }}>
            Regions & Delivery
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#EDEDED', marginTop: '0.35rem' }}>
            {(overview?.regionsCount ?? regions.length) + (overview?.deliveryMethodsCount ?? deliveryMethods.length)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#38BDF8', marginTop: '0.2rem' }}>
            {regions.length} regions / {deliveryMethods.length} methods
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#13151C',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '1rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: '#A1A1AA', textTransform: 'uppercase', fontWeight: 600 }}>
            Global Fee (Buyer / Seller)
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#FACC15', marginTop: '0.35rem' }}>
            {activeGlobalRule ? `${(activeGlobalRule.buyerCommissionBps / 100).toFixed(2)}% / ${(activeGlobalRule.sellerCommissionBps / 100).toFixed(2)}%` : '1.00% / 2.00%'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A1A1AA', marginTop: '0.2rem' }}>
            {activeGlobalRule ? `Version ${activeGlobalRule.version} active` : 'Default baseline'}
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TABS NAVIGATION                                                       */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '0.5rem',
          overflowX: 'auto',
        }}
      >
        {[
          { key: 'fee_rules', label: 'Fee Rules & Simulator', icon: '⚖️' },
          { key: 'games', label: 'Games Catalog', icon: '🎮' },
          { key: 'currencies', label: 'Currencies & Units', icon: '🪙' },
          { key: 'regions_delivery', label: 'Regions & Delivery', icon: '🌍' },
          { key: 'audit', label: 'Config Audit Logs', icon: '📜' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveSubTab(tab.key as SubTab)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeSubTab === tab.key ? '#1E293B' : 'transparent',
              color: activeSubTab === tab.key ? '#FACC15' : '#A1A1AA',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 1: FEE CONFIGURATION & INTERACTIVE PRICING SIMULATOR             */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'fee_rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Top Row: Active Rule Card + Action */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Fee Rules & Precision Simulator</h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#A1A1AA' }}>
                Resolution priority: Currency Override &gt; Game Override &gt; Global Default. Commission rates in Basis Points with optional Min/Max caps.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsFeeModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: '#FACC15',
                color: '#000',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.1rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span>+</span>
              <span>Create New Versioned Rule</span>
            </button>
          </div>

          {/* Interactive Live Simulator Box */}
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid rgba(250, 204, 21, 0.25)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🧮</span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#FACC15' }}>
                  Interactive Zero-Drift Trade Pricing Simulator
                </span>
              </div>
              <span style={{ fontSize: '0.78rem', color: '#A1A1AA' }}>
                Pure integer arithmetic • Exact half-up Basis Points rounding • Zero float precision loss
                {simLoading && <span style={{ color: '#FACC15', marginLeft: '0.5rem' }}>[Calculating...]</span>}
              </span>
            </div>

            {/* Inputs Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.85rem',
              }}
            >
              {/* Game Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                  Game
                </label>
                <select
                  value={simGameId}
                  onChange={(e) => {
                    const newGameId = e.target.value;
                    setSimGameId(newGameId);
                    const gameCurrs = currencies.filter((c) => c.gameId === newGameId);
                    if (gameCurrs.length > 0) {
                      setSimCurrencyId(gameCurrs[0].id);
                      setSimMultiplier(gameCurrs[0].unitMultiplier);
                    }
                  }}
                  style={{
                    width: '100%',
                    backgroundColor: '#1E293B',
                    color: '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="">Global (No Game)</option>
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Currency Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                  Currency
                </label>
                <select
                  value={simCurrencyId}
                  onChange={(e) => {
                    const newCurrId = e.target.value;
                    setSimCurrencyId(newCurrId);
                    const curr = currencies.find((c) => c.id === newCurrId);
                    if (curr) setSimMultiplier(curr.unitMultiplier);
                  }}
                  style={{
                    width: '100%',
                    backgroundColor: '#1E293B',
                    color: '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="">None (Use Game/Global Rule)</option>
                  {(simGameId ? currencies.filter((c) => c.gameId === simGameId) : currencies).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.unitLabel})
                    </option>
                  ))}
                </select>
              </div>

              {/* Trade Quantity in Base Units */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                  Trade Quantity (Base Units)
                </label>
                <input
                  type="text"
                  value={simQuantity}
                  onChange={(e) => setSimQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 20000000"
                  style={{
                    width: '100%',
                    backgroundColor: '#1E293B',
                    color: '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              {/* Unit Multiplier */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                  Unit Multiplier
                </label>
                <input
                  type="text"
                  value={simMultiplier}
                  onChange={(e) => setSimMultiplier(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 100000"
                  style={{
                    width: '100%',
                    backgroundColor: '#1E293B',
                    color: '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              {/* Unit Price in USD */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                  Price per Unit (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={simPriceUsd}
                  onChange={(e) => setSimPriceUsd(e.target.value)}
                  placeholder="e.g. 0.85"
                  style={{
                    width: '100%',
                    backgroundColor: '#1E293B',
                    color: '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
            </div>

            {/* Simulation Results Display */}
            {simResult && (
              <div
                style={{
                  backgroundColor: '#09090B',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                  marginTop: '0.5rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Quoted Trade Units</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#38BDF8', marginTop: '0.2rem' }}>
                    {simResult.tradeUnits} Units
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#71717A', marginTop: '0.1rem' }}>
                    {parseInt(simResult.quantityBaseUnits, 10).toLocaleString()} base units
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Gross Trade Value</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#EDEDED', marginTop: '0.2rem' }}>
                    ${simResult.grossUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#71717A', marginTop: '0.1rem' }}>
                    {simResult.grossCents} cents gross
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>
                    Buyer Fee ({(simResult.buyerCommissionBps / 100).toFixed(2)}%)
                    {simResult.cappedBuyerMin && <span style={{ color: '#FACC15' }}> [Min Cap]</span>}
                    {simResult.cappedBuyerMax && <span style={{ color: '#FACC15' }}> [Max Cap]</span>}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#EF4444', marginTop: '0.2rem' }}>
                    +${simResult.buyerFeeUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#10B981', marginTop: '0.1rem', fontWeight: 600 }}>
                    Buyer Total: ${simResult.totalBuyerUsd}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>
                    Seller Fee ({(simResult.sellerCommissionBps / 100).toFixed(2)}%)
                    {simResult.cappedSellerMin && <span style={{ color: '#FACC15' }}> [Min Cap]</span>}
                    {simResult.cappedSellerMax && <span style={{ color: '#FACC15' }}> [Max Cap]</span>}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#F97316', marginTop: '0.2rem' }}>
                    -${simResult.sellerFeeUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#10B981', marginTop: '0.1rem', fontWeight: 600 }}>
                    Seller Payout: ${simResult.netSellerUsd}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Resolved Rule Info</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#FACC15', marginTop: '0.2rem' }}>
                    {simResult.appliedFeeRuleScope} Scope (v{simResult.appliedFeeRuleVersion})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#71717A', marginTop: '0.1rem' }}>
                    Rule: {simResult.appliedFeeRuleId}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Versioned Rules History Table */}
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>All Versioned Fee Rules</div>
              <span style={{ fontSize: '0.78rem', color: '#A1A1AA' }}>
                Immutable historical versions are preserved for auditing
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#A1A1AA' }}>
                    <th style={{ padding: '0.65rem' }}>Version</th>
                    <th style={{ padding: '0.65rem' }}>Scope</th>
                    <th style={{ padding: '0.65rem' }}>Target</th>
                    <th style={{ padding: '0.65rem' }}>Buyer Commission</th>
                    <th style={{ padding: '0.65rem' }}>Seller Commission</th>
                    <th style={{ padding: '0.65rem' }}>Min / Max Caps</th>
                    <th style={{ padding: '0.65rem' }}>Effective From</th>
                    <th style={{ padding: '0.65rem' }}>Status</th>
                    <th style={{ padding: '0.65rem', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {feeRules.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: '#71717A' }}>
                        No fee rules configured yet. Click "Seed Default Config" above to initialize.
                      </td>
                    </tr>
                  ) : (
                    feeRules.map((rule) => {
                      const targetName =
                        rule.scope === 'CURRENCY'
                          ? `${rule.currency?.name || 'Currency'} (${rule.game?.name || ''})`
                          : rule.scope === 'GAME'
                          ? rule.game?.name || 'Game'
                          : 'Global Default';

                      return (
                        <tr
                          key={rule.id}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            backgroundColor: rule.isEnabled ? 'transparent' : 'rgba(255, 255, 255, 0.01)',
                          }}
                        >
                          <td style={{ padding: '0.65rem' }}>
                            <span
                              style={{
                                backgroundColor: '#1E293B',
                                color: '#38BDF8',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontWeight: 700,
                                fontSize: '0.78rem',
                              }}
                            >
                              v{rule.version}
                            </span>
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <span
                              style={{
                                backgroundColor:
                                  rule.scope === 'GLOBAL'
                                    ? 'rgba(250, 204, 21, 0.12)'
                                    : rule.scope === 'GAME'
                                    ? 'rgba(139, 92, 246, 0.12)'
                                    : 'rgba(56, 189, 248, 0.12)',
                                color:
                                  rule.scope === 'GLOBAL'
                                    ? '#FACC15'
                                    : rule.scope === 'GAME'
                                    ? '#C084FC'
                                    : '#38BDF8',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                              }}
                            >
                              {rule.scope}
                            </span>
                          </td>
                          <td style={{ padding: '0.65rem', fontWeight: 600 }}>{targetName}</td>
                          <td style={{ padding: '0.65rem', color: '#10B981', fontWeight: 600 }}>
                            {(rule.buyerCommissionBps / 100).toFixed(2)}% ({rule.buyerCommissionBps} bps)
                          </td>
                          <td style={{ padding: '0.65rem', color: '#F97316', fontWeight: 600 }}>
                            {(rule.sellerCommissionBps / 100).toFixed(2)}% ({rule.sellerCommissionBps} bps)
                          </td>
                          <td style={{ padding: '0.65rem', color: '#A1A1AA' }}>
                            {rule.minCommissionCents != null ? `$${(rule.minCommissionCents / 100).toFixed(2)}` : 'None'} /{' '}
                            {rule.maxCommissionCents != null ? `$${(rule.maxCommissionCents / 100).toFixed(2)}` : 'None'}
                          </td>
                          <td style={{ padding: '0.65rem', color: '#71717A', fontSize: '0.78rem' }}>
                            {new Date(rule.effectiveFrom).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <span
                              style={{
                                color: rule.isEnabled ? '#10B981' : '#71717A',
                                fontWeight: 600,
                                fontSize: '0.78rem',
                              }}
                            >
                              {rule.isEnabled ? '● Active' : '○ Inactive'}
                            </span>
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => handleToggleFeeRule(rule)}
                              disabled={actionLoading}
                              style={{
                                backgroundColor: 'transparent',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                color: rule.isEnabled ? '#EF4444' : '#10B981',
                                borderRadius: '6px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {rule.isEnabled ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 2: GAMES CATALOG                                                  */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'games' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Games Catalog</h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#A1A1AA' }}>
                Manage supported game franchises available in the Exchange marketplace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingGame(null);
                setIsGameModalOpen(true);
              }}
              style={{
                backgroundColor: '#FACC15',
                color: '#000',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.1rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Add Game
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '1rem',
            }}
          >
            {games.map((g) => (
              <div
                key={g.id}
                style={{
                  backgroundColor: '#13151C',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    {g.iconUrl ? (
                      <img src={g.iconUrl} alt={g.name} style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: '#1E293B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        🎮
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{g.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#71717A' }}>slug: {g.slug}</div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '9999px',
                      backgroundColor: g.isActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      color: g.isActive ? '#10B981' : '#EF4444',
                    }}
                  >
                    {g.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {g.description && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#A1A1AA', lineHeight: 1.4 }}>
                    {g.description}
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: '#71717A', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.65rem', marginTop: 'auto' }}>
                  <span>{g._count?.currencies ?? g.currencies?.length ?? 0} Currencies</span>
                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGame(g);
                        setIsGameModalOpen(true);
                      }}
                      style={{
                        backgroundColor: '#1E293B',
                        color: '#EDEDED',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '6px',
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateExchangeGame(g.id, { isActive: !g.isActive, reason: 'Owner toggled game active state' });
                        showNotification('success', `Game status updated.`);
                        await loadAllData();
                      }}
                      style={{
                        backgroundColor: 'transparent',
                        color: g.isActive ? '#EF4444' : '#10B981',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '6px',
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      {g.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 3: CURRENCIES & UNITS                                             */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'currencies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Game Currencies & Multipliers</h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#A1A1AA' }}>
                Configure base units, multipliers (Per 1, Per 1K, Per 10K, Per 100K, Per 1M), and trade limits.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <select
                value={selectedGameFilter}
                onChange={(e) => setSelectedGameFilter(e.target.value)}
                style={{
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="ALL">All Games ({currencies.length})</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setEditingCurrency(null);
                  setIsCurrencyModalOpen(true);
                }}
                style={{
                  backgroundColor: '#FACC15',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.55rem 1.1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add Currency
              </button>
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#A1A1AA', backgroundColor: '#181A22' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Game</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Currency</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Unit Label & Multiplier</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Trade Limits (Base Units)</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCurrencies.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#71717A' }}>
                      No currencies configured for selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredCurrencies.map((c) => {
                    const game = games.find((g) => g.id === c.gameId);
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{game?.name || c.game?.name || 'Unknown'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ fontWeight: 700 }}>{c.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#71717A' }}>slug: {c.slug}</div>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span
                            style={{
                              backgroundColor: '#1E293B',
                              color: '#FACC15',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.78rem',
                            }}
                          >
                            {c.unitLabel}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#A1A1AA', marginLeft: '0.5rem' }}>
                            (×{parseInt(c.unitMultiplier, 10).toLocaleString()} base units)
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#A1A1AA' }}>
                          Min: {parseInt(c.minTradeBaseUnits, 10).toLocaleString()} | Max:{' '}
                          {parseInt(c.maxTradeBaseUnits, 10).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span
                            style={{
                              color: c.isActive ? '#10B981' : '#71717A',
                              fontWeight: 600,
                              fontSize: '0.78rem',
                            }}
                          >
                            {c.isActive ? '● Active' : '○ Disabled'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCurrency(c);
                              setIsCurrencyModalOpen(true);
                            }}
                            style={{
                              backgroundColor: '#1E293B',
                              color: '#EDEDED',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              padding: '0.25rem 0.6rem',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              marginRight: '0.4rem',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await updateExchangeCurrency(c.id, { isActive: !c.isActive, reason: 'Owner toggled currency' });
                              showNotification('success', 'Currency status updated.');
                              await loadAllData();
                            }}
                            style={{
                              backgroundColor: 'transparent',
                              color: c.isActive ? '#EF4444' : '#10B981',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              padding: '0.25rem 0.6rem',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            {c.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 4: REGIONS & DELIVERY METHODS                                     */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'regions_delivery' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
          {/* Regions Table */}
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Supported Regions & Servers</h3>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA' }}>Global or game-specific server regions</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingRegion(null);
                  setIsRegionModalOpen(true);
                }}
                style={{
                  backgroundColor: '#38BDF8',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add Region
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#A1A1AA' }}>
                  <th style={{ padding: '0.5rem' }}>Code</th>
                  <th style={{ padding: '0.5rem' }}>Name</th>
                  <th style={{ padding: '0.5rem' }}>Game</th>
                  <th style={{ padding: '0.5rem' }}>Status</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 700, color: '#38BDF8' }}>{r.code}</td>
                    <td style={{ padding: '0.5rem' }}>{r.name}</td>
                    <td style={{ padding: '0.5rem', color: '#71717A' }}>
                      {r.game ? r.game.name : 'Global (All)'}
                    </td>
                    <td style={{ padding: '0.5rem', color: r.isActive ? '#10B981' : '#71717A' }}>
                      {r.isActive ? 'Active' : 'Disabled'}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegion(r);
                          setIsRegionModalOpen(true);
                        }}
                        style={{
                          backgroundColor: '#1E293B',
                          color: '#EDEDED',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          marginRight: '0.3rem',
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Delivery Methods Table */}
          <div
            style={{
              backgroundColor: '#13151C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Delivery Methods</h3>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA' }}>In-Game Trade, Mail, Auction House, etc.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingDelivery(null);
                  setIsDeliveryModalOpen(true);
                }}
                style={{
                  backgroundColor: '#8B5CF6',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add Method
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#A1A1AA' }}>
                  <th style={{ padding: '0.5rem' }}>Code</th>
                  <th style={{ padding: '0.5rem' }}>Name</th>
                  <th style={{ padding: '0.5rem' }}>Status</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveryMethods.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 700, color: '#C084FC' }}>{m.code}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      {m.description && <div style={{ fontSize: '0.72rem', color: '#71717A' }}>{m.description}</div>}
                    </td>
                    <td style={{ padding: '0.5rem', color: m.isActive ? '#10B981' : '#71717A' }}>
                      {m.isActive ? 'Active' : 'Disabled'}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDelivery(m);
                          setIsDeliveryModalOpen(true);
                        }}
                        style={{
                          backgroundColor: '#1E293B',
                          color: '#EDEDED',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 5: AUDIT LOGS                                                     */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'audit' && (
        <div
          style={{
            backgroundColor: '#13151C',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Exchange Configuration Audit Logs</h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#A1A1AA' }}>
                Immutable historical telemetry of every game, currency, fee rule, and region mutation.
              </p>
            </div>
            <button
              type="button"
              onClick={loadAllData}
              style={{
                backgroundColor: '#1E293B',
                color: '#EDEDED',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Refresh Logs
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#A1A1AA' }}>
                <th style={{ padding: '0.65rem' }}>Timestamp</th>
                <th style={{ padding: '0.65rem' }}>Actor</th>
                <th style={{ padding: '0.65rem' }}>Action</th>
                <th style={{ padding: '0.65rem' }}>Entity</th>
                <th style={{ padding: '0.65rem' }}>Reason</th>
                <th style={{ padding: '0.65rem', textAlign: 'right' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#71717A' }}>
                    No exchange audit logs recorded yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => {
                  const isExpanded = Boolean(expandedLogIds[log.id]);
                  return (
                    <React.Fragment key={log.id}>
                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '0.65rem', color: '#71717A', fontSize: '0.78rem' }}>
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.65rem', fontWeight: 600 }}>{log.actorId || 'SYSTEM'}</td>
                        <td style={{ padding: '0.65rem' }}>
                          <span
                            style={{
                              backgroundColor: '#1E293B',
                              color: '#FACC15',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem', color: '#A1A1AA' }}>
                          {log.entityType} ({log.entityId.slice(0, 8)}...)
                        </td>
                        <td style={{ padding: '0.65rem', color: '#D4D4D8' }}>{log.reason || '—'}</td>
                        <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLogIds((prev) => ({ ...prev, [log.id]: !prev[log.id] }))
                            }
                            style={{
                              backgroundColor: 'transparent',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#38BDF8',
                              borderRadius: '4px',
                              padding: '0.2rem 0.5rem',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                          >
                            {isExpanded ? 'Hide Diff' : 'View Diff'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ backgroundColor: '#09090B' }}>
                          <td colSpan={6} style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.75rem' }}>
                              <div>
                                <div style={{ color: '#EF4444', fontWeight: 600, marginBottom: '0.3rem' }}>
                                  Previous Values:
                                </div>
                                <pre
                                  style={{
                                    backgroundColor: '#13151C',
                                    padding: '0.5rem',
                                    borderRadius: '6px',
                                    overflowX: 'auto',
                                    margin: 0,
                                    color: '#A1A1AA',
                                  }}
                                >
                                  {log.previousValues
                                    ? JSON.stringify(JSON.parse(log.previousValues), null, 2)
                                    : 'null (Initial Creation)'}
                                </pre>
                              </div>
                              <div>
                                <div style={{ color: '#10B981', fontWeight: 600, marginBottom: '0.3rem' }}>
                                  New Values:
                                </div>
                                <pre
                                  style={{
                                    backgroundColor: '#13151C',
                                    padding: '0.5rem',
                                    borderRadius: '6px',
                                    overflowX: 'auto',
                                    margin: 0,
                                    color: '#A1A1AA',
                                  }}
                                >
                                  {log.newValues
                                    ? JSON.stringify(JSON.parse(log.newValues), null, 2)
                                    : 'null'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: CREATE VERSIONED FEE RULE                                          */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {isFeeModalOpen && (
        <FeeRuleModal
          games={games}
          currencies={currencies}
          onClose={() => setIsFeeModalOpen(false)}
          onSuccess={async () => {
            setIsFeeModalOpen(false);
            showNotification('success', 'New versioned fee rule created successfully.');
            await loadAllData();
          }}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: GAME CREATE / EDIT                                                 */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {isGameModalOpen && (
        <GameModal
          game={editingGame}
          onClose={() => setIsGameModalOpen(false)}
          onSuccess={async () => {
            setIsGameModalOpen(false);
            showNotification('success', editingGame ? 'Game updated.' : 'Game created.');
            await loadAllData();
          }}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: CURRENCY CREATE / EDIT                                             */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {isCurrencyModalOpen && (
        <CurrencyModal
          currency={editingCurrency}
          games={games}
          regions={regions}
          deliveryMethods={deliveryMethods}
          onClose={() => setIsCurrencyModalOpen(false)}
          onSuccess={async () => {
            setIsCurrencyModalOpen(false);
            showNotification('success', editingCurrency ? 'Currency updated.' : 'Currency created.');
            await loadAllData();
          }}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: REGION CREATE / EDIT                                               */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {isRegionModalOpen && (
        <RegionModal
          region={editingRegion}
          games={games}
          onClose={() => setIsRegionModalOpen(false)}
          onSuccess={async () => {
            setIsRegionModalOpen(false);
            showNotification('success', editingRegion ? 'Region updated.' : 'Region created.');
            await loadAllData();
          }}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: DELIVERY METHOD CREATE / EDIT                                      */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {isDeliveryModalOpen && (
        <DeliveryModal
          delivery={editingDelivery}
          onClose={() => setIsDeliveryModalOpen(false)}
          onSuccess={async () => {
            setIsDeliveryModalOpen(false);
            showNotification('success', editingDelivery ? 'Delivery method updated.' : 'Delivery method created.');
            await loadAllData();
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-MODAL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

interface FeeModalProps {
  games: ExchangeGameItem[];
  currencies: ExchangeCurrencyItem[];
  onClose: () => void;
  onSuccess: () => void;
}

const FeeRuleModal: React.FC<FeeModalProps> = ({ games, currencies, onClose, onSuccess }) => {
  const [scope, setScope] = useState<'GLOBAL' | 'GAME' | 'CURRENCY'>('GLOBAL');
  const [gameId, setGameId] = useState<string>('');
  const [currencyId, setCurrencyId] = useState<string>('');
  const [buyerBps, setBuyerBps] = useState<number>(100); // 1.00%
  const [sellerBps, setSellerBps] = useState<number>(200); // 2.00%
  const [minCapUsd, setMinCapUsd] = useState<string>('0.50');
  const [maxCapUsd, setMaxCapUsd] = useState<string>('100.00');
  const [paymentMode, setPaymentMode] = useState<string>('ACTUAL_COST');
  const [networkMode, setNetworkMode] = useState<string>('ACTUAL_COST');
  const [reason, setReason] = useState<string>('Policy adjustment for marketplace volume');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createExchangeFeeRule({
        scope,
        gameId: scope === 'GAME' ? gameId : null,
        currencyId: scope === 'CURRENCY' ? currencyId : null,
        buyerCommissionBps: Number(buyerBps),
        sellerCommissionBps: Number(sellerBps),
        minCommissionCents: minCapUsd ? Math.round(parseFloat(minCapUsd) * 100) : null,
        maxCommissionCents: maxCapUsd ? Math.round(parseFloat(maxCapUsd) * 100) : null,
        paymentProcessingMode: paymentMode,
        networkFeeMode: networkMode,
        reason,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create fee rule');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#13151C',
          border: '1px solid rgba(250, 204, 21, 0.3)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '520px',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          color: '#EDEDED',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#FACC15' }}>
            Create New Versioned Fee Rule
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#A1A1AA', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.6rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderRadius: '6px', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {/* Scope */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
              Rule Scope
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              style={{
                width: '100%',
                backgroundColor: '#1E293B',
                color: '#EDEDED',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '0.5rem',
                fontSize: '0.85rem',
              }}
            >
              <option value="GLOBAL">GLOBAL (Baseline platform fee)</option>
              <option value="GAME">GAME (Override for specific game)</option>
              <option value="CURRENCY">CURRENCY (Override for specific currency)</option>
            </select>
          </div>

          {scope === 'GAME' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Target Game
              </label>
              <select
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                required
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">Select a game...</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scope === 'CURRENCY' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Target Currency
              </label>
              <select
                value={currencyId}
                onChange={(e) => setCurrencyId(e.target.value)}
                required
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">Select a currency...</option>
                {currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.game?.name || c.unitLabel})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Basis Points Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Buyer Commission ({((buyerBps || 0) / 100).toFixed(2)}%)
              </label>
              <input
                type="number"
                min="0"
                max="5000"
                value={buyerBps}
                onChange={(e) => setBuyerBps(parseInt(e.target.value, 10) || 0)}
                placeholder="100 bps = 1.00%"
                required
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              />
              <span style={{ fontSize: '0.72rem', color: '#71717A' }}>In basis points (100 = 1%)</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Seller Commission ({((sellerBps || 0) / 100).toFixed(2)}%)
              </label>
              <input
                type="number"
                min="0"
                max="5000"
                value={sellerBps}
                onChange={(e) => setSellerBps(parseInt(e.target.value, 10) || 0)}
                placeholder="200 bps = 2.00%"
                required
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              />
              <span style={{ fontSize: '0.72rem', color: '#71717A' }}>In basis points (200 = 2%)</span>
            </div>
          </div>

          {/* USD Caps */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Min Commission ($ USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={minCapUsd}
                onChange={(e) => setMinCapUsd(e.target.value)}
                placeholder="0.50"
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Max Commission ($ USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxCapUsd}
                onChange={(e) => setMaxCapUsd(e.target.value)}
                placeholder="100.00"
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          </div>
          {/* Payment & Network Fee Modes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Payment Fee Mode
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="ACTUAL_COST">ACTUAL_COST</option>
                <option value="INCLUDED">INCLUDED</option>
                <option value="NONE">NONE</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
                Network Fee Mode
              </label>
              <select
                value={networkMode}
                onChange={(e) => setNetworkMode(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#1E293B',
                  color: '#EDEDED',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="ACTUAL_COST">ACTUAL_COST</option>
                <option value="INCLUDED">INCLUDED</option>
                <option value="NONE">NONE</option>
              </select>
            </div>
          </div>

          {/* Audit Reason */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.3rem' }}>
              Reason for Version Change (Mandatory Audit Note)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Revised seller fee structure for season launch"
              required
              style={{
                width: '100%',
                backgroundColor: '#1E293B',
                color: '#EDEDED',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '0.5rem',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: 'transparent',
                color: '#A1A1AA',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: '#FACC15',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '0.5rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {loading ? 'Creating...' : 'Create Fee Version'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GAME MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface GameModalProps {
  game: ExchangeGameItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

const GameModal: React.FC<GameModalProps> = ({ game, onClose, onSuccess }) => {
  const [name, setName] = useState(game?.name || '');
  const [slug, setSlug] = useState(game?.slug || '');
  const [iconUrl, setIconUrl] = useState(game?.iconUrl || '');
  const [description, setDescription] = useState(game?.description || '');
  const [displayOrder, setDisplayOrder] = useState<number>(game?.displayOrder || 0);
  const [isActive, setIsActive] = useState<boolean>(game ? game.isActive : true);
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (game) {
        await updateExchangeGame(game.id, {
          name,
          slug,
          iconUrl,
          description,
          displayOrder,
          isActive,
          reason: reason || 'Updated game settings',
        });
      } else {
        await createExchangeGame({
          name,
          slug,
          iconUrl,
          description,
          displayOrder,
          isActive,
          reason: reason || 'Created new game',
        });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <div style={{ backgroundColor: '#13151C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', width: '100%', maxWidth: '460px', padding: '1.5rem', color: '#EDEDED' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>
          {game ? 'Edit Game' : 'Add New Game'}
        </h3>
        {error && <div style={{ padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.8rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. World of Warcraft" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Slug (Unique URL identifier)</label>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} required placeholder="e.g. wow" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Icon URL</label>
            <input type="url" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://..." style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Display Order</label>
            <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)} style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Audit Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Audit reason for game settings" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active in catalog</span>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ backgroundColor: 'transparent', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.45rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ backgroundColor: '#FACC15', color: '#000', border: 'none', borderRadius: '6px', padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface CurrencyModalProps {
  currency: ExchangeCurrencyItem | null;
  games: ExchangeGameItem[];
  regions: ExchangeRegionItem[];
  deliveryMethods: ExchangeDeliveryMethodItem[];
  onClose: () => void;
  onSuccess: () => void;
}

const CurrencyModal: React.FC<CurrencyModalProps> = ({ currency, games, onClose, onSuccess }) => {
  const [gameId, setGameId] = useState(currency?.gameId || (games[0]?.id || ''));
  const [name, setName] = useState(currency?.name || '');
  const [slug, setSlug] = useState(currency?.slug || '');
  const [unitLabel, setUnitLabel] = useState(currency?.unitLabel || '100K Gold');
  const [unitMultiplier, setUnitMultiplier] = useState(currency?.unitMultiplier || '100000');
  const [minTrade, setMinTrade] = useState(currency?.minTradeBaseUnits || '100000');
  const [maxTrade, setMaxTrade] = useState(currency?.maxTradeBaseUnits || '100000000');
  const [isActive, setIsActive] = useState(currency ? currency.isActive : true);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    { label: 'Per 1', multiplier: '1', defaultUnitLabel: '1 Unit' },
    { label: 'Per 1K', multiplier: '1000', defaultUnitLabel: '1K Units' },
    { label: 'Per 10K', multiplier: '10000', defaultUnitLabel: '10K Units' },
    { label: 'Per 100K', multiplier: '100000', defaultUnitLabel: '100K Units' },
    { label: 'Per 1M', multiplier: '1000000', defaultUnitLabel: '1M Units' },
    { label: 'Per 100M', multiplier: '100000000', defaultUnitLabel: '100M Units' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (currency) {
        await updateExchangeCurrency(currency.id, {
          name,
          slug,
          unitLabel,
          unitMultiplier,
          minTradeBaseUnits: minTrade,
          maxTradeBaseUnits: maxTrade,
          isActive,
          reason: reason || 'Updated currency settings',
        });
      } else {
        await createExchangeCurrency({
          gameId,
          name,
          slug,
          unitLabel,
          unitMultiplier,
          minTradeBaseUnits: minTrade,
          maxTradeBaseUnits: maxTrade,
          isActive,
          reason: reason || 'Created new currency',
        });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <div style={{ backgroundColor: '#13151C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '1.5rem', color: '#EDEDED' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>
          {currency ? 'Edit Currency' : 'Add Game Currency'}
        </h3>
        {error && <div style={{ padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.8rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Parent Game</label>
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} disabled={Boolean(currency)} style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Currency Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Gold" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Slug</label>
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} required placeholder="e.g. gold" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
          </div>

          {/* Unit Multiplier Presets */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Unit Multiplier Presets</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
              {presets.map((p) => (
                <button
                  key={p.multiplier}
                  type="button"
                  onClick={() => {
                    setUnitMultiplier(p.multiplier);
                    if (!unitLabel || unitLabel.includes('Units') || unitLabel.includes('Gold')) {
                      setUnitLabel(p.defaultUnitLabel.replace('Units', name || 'Units'));
                    }
                  }}
                  style={{
                    backgroundColor: unitMultiplier === p.multiplier ? '#FACC15' : '#1E293B',
                    color: unitMultiplier === p.multiplier ? '#000' : '#EDEDED',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Display Unit Label</label>
              <input type="text" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} required placeholder="e.g. 100K Gold" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Multiplier (Base Units)</label>
              <input type="text" value={unitMultiplier} onChange={(e) => setUnitMultiplier(e.target.value.replace(/[^0-9]/g, ''))} required placeholder="100000" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Min Trade (Base Units)</label>
              <input type="text" value={minTrade} onChange={(e) => setMinTrade(e.target.value.replace(/[^0-9]/g, ''))} required placeholder="100000" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Max Trade (Base Units)</label>
              <input type="text" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value.replace(/[^0-9]/g, ''))} required placeholder="100000000" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Audit Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Audit reason for currency change" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active in currency list</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ backgroundColor: 'transparent', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.45rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ backgroundColor: '#FACC15', color: '#000', border: 'none', borderRadius: '6px', padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// REGION MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface RegionModalProps {
  region: ExchangeRegionItem | null;
  games: ExchangeGameItem[];
  onClose: () => void;
  onSuccess: () => void;
}

const RegionModal: React.FC<RegionModalProps> = ({ region, games, onClose, onSuccess }) => {
  const [code, setCode] = useState(region?.code || '');
  const [name, setName] = useState(region?.name || '');
  const [gameId, setGameId] = useState(region?.gameId || '');
  const [isActive, setIsActive] = useState(region ? region.isActive : true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (region) {
        await updateExchangeRegion(region.id, { code, name, gameId: gameId || null, isActive });
      } else {
        await createExchangeRegion({ code, name, gameId: gameId || null, isActive });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <div style={{ backgroundColor: '#13151C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', width: '100%', maxWidth: '420px', padding: '1.5rem', color: '#EDEDED' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>{region ? 'Edit Region' : 'Add Region'}</h3>
        {error && <div style={{ padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.8rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Region Code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="e.g. EU, US, ASIA" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Region Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Europe" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Scope Game (Optional)</label>
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }}>
              <option value="">Global / Cross-Game</option>
              {games.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active in region list</span>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ backgroundColor: 'transparent', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.45rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ backgroundColor: '#38BDF8', color: '#000', border: 'none', borderRadius: '6px', padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY METHOD MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface DeliveryModalProps {
  delivery: ExchangeDeliveryMethodItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

const DeliveryModal: React.FC<DeliveryModalProps> = ({ delivery, onClose, onSuccess }) => {
  const [code, setCode] = useState(delivery?.code || '');
  const [name, setName] = useState(delivery?.name || '');
  const [description, setDescription] = useState(delivery?.description || '');
  const [isActive, setIsActive] = useState(delivery ? delivery.isActive : true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (delivery) {
        await updateExchangeDeliveryMethod(delivery.id, { code, name, description, isActive });
      } else {
        await createExchangeDeliveryMethod({ code, name, description, isActive });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <div style={{ backgroundColor: '#13151C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', width: '100%', maxWidth: '420px', padding: '1.5rem', color: '#EDEDED' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>{delivery ? 'Edit Delivery Method' : 'Add Delivery Method'}</h3>
        {error && <div style={{ padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.8rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Method Code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} required placeholder="e.g. IN_GAME_TRADE" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Display Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. In-Game Face-to-Face Trade" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#A1A1AA', marginBottom: '0.25rem' }}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Instructions on how this delivery is completed" style={{ width: '100%', backgroundColor: '#1E293B', color: '#EDEDED', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', padding: '0.45rem', fontSize: '0.85rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>Active delivery method</span>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ backgroundColor: 'transparent', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.45rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ backgroundColor: '#8B5CF6', color: '#FFF', border: 'none', borderRadius: '6px', padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
