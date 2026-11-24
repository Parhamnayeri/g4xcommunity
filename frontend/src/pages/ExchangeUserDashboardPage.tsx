/**
 * frontend/src/pages/ExchangeUserDashboardPage.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 8 (Final):
 * User Exchange Dashboard:
 *  - Dual View Switcher: Buyer Dashboard vs. Seller Dashboard
 *  - Live Deterministic Reputation Display (Tiers, Rating, Score, Penalties, Speed)
 *  - Live Central Wallet Unified Balance Integration (Available, Reserved, Frozen)
 *  - Buyer 7 Categorized PRD §12 Sub-Tabs (Orders, Active, Pending Payments, Approvals, Completed, Cancelled, History)
 *  - Seller 3 Categorized PRD §12 Sub-Tabs (Offers, Active, Completed) + Volume Sold Breakdown
 *  - Direct links to Independent Transaction Details (/exchange/transactions/:tradeId)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  BuyerDashboardData,
  SellerDashboardData,
  UserReputationSummary,
} from '../types/exchange';
import {
  getExchangeBuyerDashboard,
  getExchangeSellerDashboard,
} from '../services/exchangeMarketplace';

type DashboardRole = 'BUYER' | 'SELLER';
type BuyerSubTab =
  | 'myBuyOrders'
  | 'activeTrades'
  | 'pendingPayments'
  | 'pendingApprovals'
  | 'completedTrades'
  | 'cancelledOrders'
  | 'tradeHistory';
type SellerSubTab = 'mySellOffers' | 'activeTrades' | 'completedTrades';

export const ExchangeUserDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeRole, setActiveRole] = useState<DashboardRole>('BUYER');
  const [buyerTab, setBuyerTab] = useState<BuyerSubTab>('activeTrades');
  const [sellerTab, setSellerTab] = useState<SellerSubTab>('activeTrades');

  const [buyerData, setBuyerData] = useState<BuyerDashboardData | null>(null);
  const [sellerData, setSellerData] = useState<SellerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeRole === 'BUYER') {
        const data = await getExchangeBuyerDashboard();
        setBuyerData(data);
      } else {
        const data = await getExchangeSellerDashboard();
        setSellerData(data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load exchange dashboard.');
    } finally {
      setLoading(false);
    }
  }, [activeRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderReputationBadge = (rep: UserReputationSummary) => {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.25rem 0.6rem',
          borderRadius: '9999px',
          backgroundColor: `${rep.tierColor}1A`,
          border: `1px solid ${rep.tierColor}4D`,
          color: rep.tierColor,
          fontWeight: 700,
          fontSize: '0.78rem',
        }}
      >
        <span style={{ fontSize: '0.9rem' }}>★</span>
        <span>{rep.tier}</span>
        <span style={{ opacity: 0.8 }}>({rep.rating.toFixed(1)}/5.0)</span>
      </div>
    );
  };

  const renderStatusPill = (status: string) => {
    let bg = 'rgba(156, 163, 175, 0.15)';
    let color = '#9CA3AF';
    let border = '1px solid rgba(156, 163, 175, 0.3)';

    if (['COMPLETED', 'RELEASED', 'APPROVED', 'VERIFIED'].includes(status)) {
      bg = 'rgba(16, 185, 129, 0.15)';
      color = '#10B981';
      border = '1px solid rgba(16, 185, 129, 0.4)';
    } else if (['AWAITING_PAYMENT', 'PENDING', 'AWAITING_PROOF'].includes(status)) {
      bg = 'rgba(245, 158, 11, 0.15)';
      color = '#F59E0B';
      border = '1px solid rgba(245, 158, 11, 0.4)';
    } else if (['PAYMENT_CONFIRMED', 'DELIVERY_IN_PROGRESS', 'PROOF_SUBMITTED', 'ACTIVE'].includes(status)) {
      bg = 'rgba(59, 130, 246, 0.15)';
      color = '#3B82F6';
      border = '1px solid rgba(59, 130, 246, 0.4)';
    } else if (status === 'AWAITING_FINAL_APPROVAL') {
      bg = 'rgba(139, 92, 246, 0.2)';
      color = '#A78BFA';
      border = '1px solid rgba(139, 92, 246, 0.5)';
    } else if (['DISPUTED', 'CANCELLED', 'FROZEN_DISPUTE', 'REJECTED'].includes(status)) {
      bg = 'rgba(239, 68, 68, 0.15)';
      color = '#EF4444';
      border = '1px solid rgba(239, 68, 68, 0.4)';
    }

    return (
      <span
        style={{
          display: 'inline-block',
          padding: '0.2rem 0.55rem',
          borderRadius: '4px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          backgroundColor: bg,
          color,
          border,
        }}
      >
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ─── Top Header & Role Switcher ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid var(--border-subtle, #27272A)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#F4F4F5' }}>
              Exchange Workspace
            </h1>
            <span
              style={{
                backgroundColor: 'rgba(250, 204, 21, 0.15)',
                color: '#FACC15',
                border: '1px solid rgba(250, 204, 21, 0.3)',
                padding: '0.15rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              Phase 8 Final
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#A1A1AA' }}>
            Unified trading dashboard, deterministic reputation tracking, and auditable transaction dossiers.
          </p>
        </div>

        {/* View Switcher: Buyer vs Seller */}
        <div
          style={{
            display: 'inline-flex',
            backgroundColor: '#18181B',
            padding: '0.3rem',
            borderRadius: '8px',
            border: '1px solid #27272A',
          }}
        >
          <button
            onClick={() => setActiveRole('BUYER')}
            style={{
              padding: '0.45rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              backgroundColor: activeRole === 'BUYER' ? '#3B82F6' : 'transparent',
              color: activeRole === 'BUYER' ? '#FFFFFF' : '#A1A1AA',
              transition: 'all 0.15s ease',
            }}
          >
            🛒 Buyer Dashboard
          </button>
          <button
            onClick={() => setActiveRole('SELLER')}
            style={{
              padding: '0.45rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              backgroundColor: activeRole === 'SELLER' ? '#10B981' : 'transparent',
              color: activeRole === 'SELLER' ? '#FFFFFF' : '#A1A1AA',
              transition: 'all 0.15s ease',
            }}
          >
            ⚡ Seller Dashboard
          </button>
        </div>
      </div>

      {/* ─── Error Alert ─── */}
      {error && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#F87171',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={loadData}
            style={{
              background: '#EF4444',
              color: '#FFF',
              border: 'none',
              borderRadius: '4px',
              padding: '0.25rem 0.6rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ─── Loading State ─── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: '#A1A1AA' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #27272A',
              borderTopColor: '#3B82F6',
              borderRadius: '50%',
              margin: '0 auto 1rem',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Loading verified trading metrics...</p>
        </div>
      )}

      {/* ─── BUYER VIEW ─── */}
      {!loading && activeRole === 'BUYER' && buyerData && (
        <div>
          {/* Top KPI Cards Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            {/* Live Reputation Card */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>BUYER REPUTATION</span>
                {renderReputationBadge(buyerData.summary.reputation)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F4F4F5' }}>
                  {buyerData.summary.reputation.score}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>/ 100 Score</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>Completed: <strong style={{ color: '#10B981' }}>{buyerData.summary.reputation.completedTradesCount}</strong></span>
                <span>Success Rate: <strong style={{ color: '#F4F4F5' }}>{buyerData.summary.reputation.completionRatePercent}%</strong></span>
                <span>Lost Disputes: <strong style={{ color: buyerData.summary.reputation.disputesLostCount > 0 ? '#EF4444' : '#71717A' }}>{buyerData.summary.reputation.disputesLostCount}</strong></span>
                {buyerData.summary.reputation.avgConfirmationMinutes !== null && (
                  <span>Avg Confirm: <strong style={{ color: '#3B82F6' }}>{buyerData.summary.reputation.avgConfirmationMinutes}m</strong></span>
                )}
              </div>
            </div>

            {/* Central Wallet Balances */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>CENTRAL G4X WALLET</span>
                <Link
                  to="/wallet"
                  style={{
                    fontSize: '0.75rem',
                    color: '#3B82F6',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Manage Wallet →
                </Link>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10B981' }}>
                  {buyerData.summary.wallet.availableBalanceFormatted}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>Available</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>Reserved: <strong style={{ color: '#F59E0B' }}>{buyerData.summary.wallet.reservedBalanceFormatted}</strong></span>
                <span>Total Balance: <strong style={{ color: '#F4F4F5' }}>{buyerData.summary.wallet.balanceUsdFormatted}</strong></span>
                {buyerData.summary.wallet.isFrozen && (
                  <span style={{ color: '#EF4444', fontWeight: 700 }}>WALLET FROZEN</span>
                )}
              </div>
            </div>

            {/* Trading Summary KPIs */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>BUYER ACTIVITY</span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.45rem',
                    borderRadius: '4px',
                    backgroundColor: buyerData.summary.badge.isExchanger ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                    color: buyerData.summary.badge.isExchanger ? '#10B981' : '#9CA3AF',
                  }}
                >
                  {buyerData.summary.badge.isExchanger ? 'VERIFIED EXCHANGER' : 'STANDARD BUYER'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F4F4F5' }}>
                  ${buyerData.summary.totalSpentUsd}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>Total Spent</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>Active Orders: <strong style={{ color: '#3B82F6' }}>{buyerData.summary.activeBuyOrdersCount}</strong></span>
                <span>Active Trades: <strong style={{ color: '#F59E0B' }}>{buyerData.summary.activeTradesCount}</strong></span>
                <span>Pending Approvals: <strong style={{ color: '#A78BFA' }}>{buyerData.summary.pendingApprovalsCount}</strong></span>
              </div>
            </div>
          </div>

          {/* ─── Buyer 7 Sub-Tabs Navigation ─── */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              overflowX: 'auto',
              borderBottom: '1px solid #27272A',
              marginBottom: '1.25rem',
              paddingBottom: '0.5rem',
            }}
          >
            {[
              { id: 'activeTrades', label: 'Active Trades', count: buyerData.tabs.activeTrades.length },
              { id: 'pendingPayments', label: 'Pending Payments', count: buyerData.tabs.pendingPayments.length },
              { id: 'pendingApprovals', label: 'Pending Approvals', count: buyerData.tabs.pendingApprovals.length },
              { id: 'myBuyOrders', label: 'My Buy Orders', count: buyerData.tabs.myBuyOrders.length },
              { id: 'completedTrades', label: 'Completed Trades', count: buyerData.tabs.completedTrades.length },
              { id: 'cancelledOrders', label: 'Cancelled', count: buyerData.tabs.cancelledOrders.cancelledTrades.length + buyerData.tabs.cancelledOrders.cancelledBuyOrders.length },
              { id: 'tradeHistory', label: 'Full Trade History', count: buyerData.tabs.tradeHistory.length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setBuyerTab(tab.id as BuyerSubTab)}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: buyerTab === tab.id ? '#27272A' : 'transparent',
                  color: buyerTab === tab.id ? '#F4F4F5' : '#71717A',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    style={{
                      backgroundColor: buyerTab === tab.id ? '#3B82F6' : '#3F3F46',
                      color: '#FFF',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      borderRadius: '9999px',
                      padding: '0.1rem 0.4rem',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ─── Buyer Sub-Tab Contents ─── */}

          {/* 1. Active Trades */}
          {buyerTab === 'activeTrades' && (
            <div>
              {buyerData.tabs.activeTrades.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No active trades in progress.</p>
                  <Link to="/exchange" style={{ color: '#3B82F6', fontSize: '0.85rem', textDecoration: 'none' }}>
                    Browse Exchange Marketplace →
                  </Link>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Game & Currency</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Seller</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Total Payable</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerData.tabs.activeTrades.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</div>
                            <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                              {new Date(t.createdAt).toLocaleDateString()}
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#E4E4E7' }}>{t.game?.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#A1A1AA' }}>
                              {t.quantityBaseUnits} {t.currency?.unitLabel || 'units'}
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                            {t.seller?.displayName || t.seller?.username || 'Seller'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#10B981' }}>
                            ${((t.buyerTotalPayableCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(t.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                              <Link
                                to={`/exchange/trades/${t.id}`}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#27272A',
                                  color: '#F4F4F5',
                                  textDecoration: 'none',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                Trade Room
                              </Link>
                              <Link
                                to={`/exchange/transactions/${t.id}`}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#3B82F6',
                                  color: '#FFFFFF',
                                  textDecoration: 'none',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                Transaction Dossier
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 2. Pending Payments */}
          {buyerTab === 'pendingPayments' && (
            <div>
              {buyerData.tabs.pendingPayments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No trades awaiting payment.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Game</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Payable Amount</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerData.tabs.pendingPayments.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#E4E4E7' }}>{t.game?.name}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#F59E0B' }}>
                            ${((t.buyerTotalPayableCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(t.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/trades/${t.id}`}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '4px',
                                backgroundColor: '#F59E0B',
                                color: '#000000',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                              }}
                            >
                              Checkout & Pay →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 3. Pending Approvals */}
          {buyerTab === 'pendingApprovals' && (
            <div>
              {buyerData.tabs.pendingApprovals.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No trades awaiting final staff approval.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Confirmed By You</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Waiting Duration</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerData.tabs.pendingApprovals.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                            {t.buyerConfirmedAt ? new Date(t.buyerConfirmedAt).toLocaleString() : 'Confirmed'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span
                              style={{
                                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                                color: '#A78BFA',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontWeight: 700,
                                fontSize: '0.75rem',
                              }}
                            >
                              ⏱ {t.waitingMinutes}m waiting for admin payout
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(t.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/transactions/${t.id}`}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '4px',
                                backgroundColor: '#8B5CF6',
                                color: '#FFFFFF',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              Inspect Dossier
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 4. My Buy Orders */}
          {buyerTab === 'myBuyOrders' && (
            <div>
              {buyerData.tabs.myBuyOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>You have not created any Buy Orders yet.</p>
                  <Link to="/exchange" style={{ color: '#3B82F6', fontSize: '0.85rem', textDecoration: 'none' }}>
                    Post a Buy Order on Marketplace →
                  </Link>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Order Code</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Game & Currency</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Unit Price</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Capacity Progress</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerData.tabs.myBuyOrders.map((o: any) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{o.orderCode}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#E4E4E7' }}>{o.game?.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#A1A1AA' }}>{o.currency?.name}</div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>
                            ${((o.pricePerUnitCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#A1A1AA', marginBottom: '0.2rem' }}>
                              Filled: {o.totalFilledBaseUnits || '0'} / Max: {o.maxQuantityBaseUnits}
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(o.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/orders/${o.id}`}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '4px',
                                backgroundColor: '#27272A',
                                color: '#F4F4F5',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              Manage Order
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 5. Completed Trades */}
          {buyerTab === 'completedTrades' && (
            <div>
              {buyerData.tabs.completedTrades.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No completed trades yet.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Settlement</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Seller</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Total Paid</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Completed Date</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Dossier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerData.tabs.completedTrades.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#A78BFA', fontWeight: 600 }}>
                            {t.settlement?.settlementCode || 'SETTLED'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                            {t.seller?.displayName || t.seller?.username}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#10B981' }}>
                            ${((t.buyerTotalPayableCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#71717A' }}>
                            {t.completedAt ? new Date(t.completedAt).toLocaleDateString() : 'Completed'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/transactions/${t.id}`}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '4px',
                                backgroundColor: '#10B981',
                                color: '#FFFFFF',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              View Dossier →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 6. Cancelled */}
          {buyerTab === 'cancelledOrders' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#E4E4E7', marginBottom: '0.5rem' }}>
                  Cancelled Trades ({buyerData.tabs.cancelledOrders.cancelledTrades.length})
                </h3>
                {buyerData.tabs.cancelledOrders.cancelledTrades.length === 0 ? (
                  <p style={{ color: '#71717A', fontSize: '0.85rem' }}>No cancelled trades.</p>
                ) : (
                  <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Game</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Amount</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Cancellation Reason</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Dossier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyerData.tabs.cancelledOrders.cancelledTrades.map((t: any) => (
                          <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#EF4444' }}>{t.tradeCode}</td>
                            <td style={{ padding: '0.75rem 1rem', color: '#E4E4E7' }}>{t.game?.name}</td>
                            <td style={{ padding: '0.75rem 1rem' }}>${((t.buyerTotalPayableCents || 0) / 100).toFixed(2)}</td>
                            <td style={{ padding: '0.75rem 1rem', color: '#A1A1AA' }}>{t.cancellationReason || 'N/A'}</td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                              <Link
                                to={`/exchange/transactions/${t.id}`}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#27272A',
                                  color: '#F4F4F5',
                                  textDecoration: 'none',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                View Details
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 7. Full Trade History */}
          {buyerTab === 'tradeHistory' && (
            <div>
              <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Game & Currency</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Seller</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Total</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Created</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Dossier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyerData.tabs.tradeHistory.map((t: any) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#E4E4E7' }}>{t.game?.name}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                          {t.seller?.displayName || t.seller?.username}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>
                          ${((t.buyerTotalPayableCents || 0) / 100).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(t.status)}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#71717A' }}>
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <Link
                            to={`/exchange/transactions/${t.id}`}
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: '4px',
                              backgroundColor: '#3B82F6',
                              color: '#FFFFFF',
                              textDecoration: 'none',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            Details →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── SELLER VIEW ─── */}
      {!loading && activeRole === 'SELLER' && sellerData && (
        <div>
          {/* Top KPI Cards Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            {/* Live Seller Reputation Card */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>SELLER REPUTATION</span>
                {renderReputationBadge(sellerData.summary.reputation)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F4F4F5' }}>
                  {sellerData.summary.reputation.score}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>/ 100 Score</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>Completed: <strong style={{ color: '#10B981' }}>{sellerData.summary.reputation.completedTradesCount}</strong></span>
                <span>Success Rate: <strong style={{ color: '#F4F4F5' }}>{sellerData.summary.reputation.completionRatePercent}%</strong></span>
                <span>Lost Disputes: <strong style={{ color: sellerData.summary.reputation.disputesLostCount > 0 ? '#EF4444' : '#71717A' }}>{sellerData.summary.reputation.disputesLostCount}</strong></span>
                {sellerData.summary.reputation.avgDeliveryMinutes !== null && (
                  <span>Avg Delivery: <strong style={{ color: '#10B981' }}>{sellerData.summary.reputation.avgDeliveryMinutes}m</strong></span>
                )}
              </div>
            </div>

            {/* Central Wallet Balances */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>CENTRAL G4X WALLET</span>
                <Link
                  to="/wallet"
                  style={{
                    fontSize: '0.75rem',
                    color: '#10B981',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Withdraw Earnings →
                </Link>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10B981' }}>
                  {sellerData.summary.wallet.availableBalanceFormatted}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>Available</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>Total Balance: <strong style={{ color: '#F4F4F5' }}>{sellerData.summary.wallet.balanceUsdFormatted}</strong></span>
                {sellerData.summary.wallet.reservedBalanceCents > 0 && (
                  <span>Reserved: <strong style={{ color: '#F59E0B' }}>{sellerData.summary.wallet.reservedBalanceFormatted}</strong></span>
                )}
              </div>
            </div>

            {/* Earnings Breakdown */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.1rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>SELLER EARNINGS</span>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>
                  {sellerData.summary.completedTradesCount} settled trades
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10B981' }}>
                  ${sellerData.summary.totalEarningsUsd}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#71717A' }}>Net Settled</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
                <span>In-Flight Pending: <strong style={{ color: '#F59E0B' }}>${sellerData.summary.pendingEarningsUsd}</strong></span>
                <span>Active Trades: <strong style={{ color: '#3B82F6' }}>{sellerData.summary.activeTradesCount}</strong></span>
              </div>
            </div>
          </div>

          {/* Total Currency Volume Sold Strip */}
          {sellerData.summary.totalCurrencySold.length > 0 && (
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1rem',
                border: '1px solid #27272A',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600, marginBottom: '0.5rem' }}>
                VERIFIED VOLUME SOLD TO DATE
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                {sellerData.summary.totalCurrencySold.map((vol, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: '#27272A',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#F4F4F5' }}>
                      {vol.gameName}
                    </span>
                    <span style={{ color: '#71717A' }}>•</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#10B981' }}>
                      {vol.formattedVolume}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Seller 3 Sub-Tabs Navigation ─── */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              overflowX: 'auto',
              borderBottom: '1px solid #27272A',
              marginBottom: '1.25rem',
              paddingBottom: '0.5rem',
            }}
          >
            {[
              { id: 'activeTrades', label: 'Active Delivery Trades', count: sellerData.tabs.activeTrades.length },
              { id: 'mySellOffers', label: 'My Sell Offers', count: sellerData.tabs.mySellOffers.length },
              { id: 'completedTrades', label: 'Completed & Settled', count: sellerData.tabs.completedTrades.length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSellerTab(tab.id as SellerSubTab)}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: sellerTab === tab.id ? '#27272A' : 'transparent',
                  color: sellerTab === tab.id ? '#F4F4F5' : '#71717A',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    style={{
                      backgroundColor: sellerTab === tab.id ? '#10B981' : '#3F3F46',
                      color: '#FFF',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      borderRadius: '9999px',
                      padding: '0.1rem 0.4rem',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ─── Seller Sub-Tab Contents ─── */}

          {/* 1. Active Delivery Trades */}
          {sellerTab === 'activeTrades' && (
            <div>
              {sellerData.tabs.activeTrades.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No active trades currently awaiting your fulfillment.</p>
                  <Link to="/exchange" style={{ color: '#10B981', fontSize: '0.85rem', textDecoration: 'none' }}>
                    Find Buy Orders to Sell →
                  </Link>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Game & Currency</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Buyer</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Net Payout</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerData.tabs.activeTrades.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#E4E4E7' }}>{t.game?.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#A1A1AA' }}>
                              {t.quantityBaseUnits} {t.currency?.unitLabel || 'units'}
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                            {t.buyer?.displayName || t.buyer?.username}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#10B981' }}>
                            ${((t.netSellerCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(t.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                              <Link
                                to={`/exchange/trades/${t.id}`}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#10B981',
                                  color: '#000000',
                                  textDecoration: 'none',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                }}
                              >
                                Submit Proof / Chat
                              </Link>
                              <Link
                                to={`/exchange/transactions/${t.id}`}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#27272A',
                                  color: '#F4F4F5',
                                  textDecoration: 'none',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                Dossier
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 2. My Sell Offers */}
          {sellerTab === 'mySellOffers' && (
            <div>
              {sellerData.tabs.mySellOffers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>You have not submitted any sell offers.</p>
                  <Link to="/exchange" style={{ color: '#10B981', fontSize: '0.85rem', textDecoration: 'none' }}>
                    Browse Buy Orders to Sell →
                  </Link>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Buy Order</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Game & Currency</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Offered Units</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Unit Price</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Created</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerData.tabs.mySellOffers.map((o: any) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>
                            {o.buyOrder?.orderCode || o.buyOrderId}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#E4E4E7' }}>
                            {o.buyOrder?.game?.name}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#F4F4F5' }}>
                            {o.offeredQuantityBaseUnits}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#10B981', fontWeight: 700 }}>
                            ${((o.buyOrder?.pricePerUnitCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{renderStatusPill(o.status)}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#71717A' }}>
                            {new Date(o.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/orders/${o.buyOrderId}`}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '4px',
                                backgroundColor: '#27272A',
                                color: '#F4F4F5',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              View Order
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 3. Completed & Settled */}
          {sellerTab === 'completedTrades' && (
            <div>
              {sellerData.tabs.completedTrades.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#71717A', backgroundColor: '#18181B', borderRadius: '8px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No settled trades yet.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', backgroundColor: '#18181B', borderRadius: '8px', border: '1px solid #27272A' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Trade</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Settlement</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Buyer</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Net Credited</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Completed Date</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Dossier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerData.tabs.completedTrades.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #222226' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#F4F4F5' }}>{t.tradeCode}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#A78BFA', fontWeight: 600 }}>
                            {t.settlement?.settlementCode || 'SETTLED'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#D4D4D8' }}>
                            {t.buyer?.displayName || t.buyer?.username}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#10B981' }}>
                            ${((t.settlement?.sellerNetPayoutCents || t.netSellerCents || 0) / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#71717A' }}>
                            {t.completedAt ? new Date(t.completedAt).toLocaleDateString() : 'Completed'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <Link
                              to={`/exchange/transactions/${t.id}`}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '4px',
                                backgroundColor: '#10B981',
                                color: '#FFFFFF',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              View Dossier →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
