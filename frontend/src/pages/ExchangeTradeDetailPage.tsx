/**
 * frontend/src/pages/ExchangeTradeDetailPage.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 4:
 * Dedicated Trade Details Page:
 * Immutable Pricing & Fee Snapshots, Real-time Status Badges,
 * Trade Event Timeline, and Capacity-Release Cancellation.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ExchangeTradeItem } from '../types/exchange';
import { fetchTradeById, cancelTrade } from '../services/exchangeMarketplace';

export const ExchangeTradeDetailPage: React.FC = () => {
  const { tradeId } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.discordId;

  const [trade, setTrade] = useState<ExchangeTradeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadTradeData = useCallback(async () => {
    if (!tradeId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTradeById(tradeId);
      if (res && res.trade) {
        setTrade(res.trade);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load trade details.');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    loadTradeData();
  }, [loadTradeData]);

  const handleCancelTrade = async () => {
    if (!trade) return;
    const reason = window.prompt('Please enter the reason for cancellation:');
    if (reason === null) return; // User cancelled prompt

    try {
      setCancelling(true);
      setActionFeedback(null);
      const res = await cancelTrade(trade.id, reason);
      setActionFeedback({
        type: 'success',
        message: 'Trade cancelled and capacity released back to the buy order successfully.',
      });
      setTrade(res.trade);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to cancel trade.',
      });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090B' }}>
        <div style={{ color: '#FACC15', fontSize: '1.2rem', fontWeight: 600 }}>Loading Exchange Trade Details...</div>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div style={{ minHeight: '80vh', padding: '40px 20px', backgroundColor: '#09090B', color: '#F3F4F6' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', backgroundColor: '#13151C', padding: '32px', borderRadius: '12px', border: '1px solid #EF4444' }}>
          <h2 style={{ color: '#EF4444', marginBottom: '12px' }}>Trade Not Found</h2>
          <p style={{ color: '#9CA3AF', marginBottom: '20px' }}>{error || 'The requested trade does not exist or you do not have permission to view it.'}</p>
          <button
            onClick={() => navigate('/exchange')}
            style={{ padding: '10px 20px', backgroundColor: '#FACC15', color: '#000', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
          >
            ← Back to Marketplace
          </button>
        </div>
      </div>
    );
  }

  const isBuyer = currentUserId && trade.buyerUserId === currentUserId;
  const isSeller = currentUserId && trade.sellerUserId === currentUserId;
  const canCancel = trade.status === 'AWAITING_PAYMENT' && (isBuyer || isSeller);

  const multiplierBig = BigInt(trade.unitMultiplierSnapshot || '1');
  const tradeUnits = (BigInt(trade.quantityBaseUnits) / multiplierBig).toString();

  const grossUsd = (trade.grossValueCents / 100).toFixed(2);
  const buyerFeeUsd = (trade.buyerFeeCents / 100).toFixed(2);
  const buyerTotalUsd = (trade.buyerTotalPayableCents / 100).toFixed(2);
  const sellerFeeUsd = (trade.sellerFeeCents / 100).toFixed(2);
  const netSellerUsd = (trade.netSellerCents / 100).toFixed(2);
  const unitPriceUsd = (trade.pricePerUnitCentsSnapshot / 100).toFixed(2);

  // Status Badge Configuration
  const getStatusBadge = (statusStr: string) => {
    switch (statusStr) {
      case 'AWAITING_PAYMENT':
        return { label: 'Awaiting Payment', color: '#FACC15', bg: 'rgba(250, 204, 21, 0.15)', border: '#FACC15' };
      case 'PAYMENT_CONFIRMED':
        return { label: 'Payment Confirmed', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981' };
      case 'DELIVERY_IN_PROGRESS':
        return { label: 'Delivery in Progress', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6' };
      case 'PROOF_SUBMITTED':
        return { label: 'Proof Submitted', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)', border: '#8B5CF6' };
      case 'COMPLETED':
        return { label: 'Trade Completed', color: '#10B981', bg: 'rgba(16, 185, 129, 0.2)', border: '#10B981' };
      case 'CANCELLED':
        return { label: 'Trade Cancelled', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444' };
      case 'DISPUTED':
        return { label: 'Disputed', color: '#F97316', bg: 'rgba(249, 115, 22, 0.15)', border: '#F97316' };
      default:
        return { label: statusStr, color: '#9CA3AF', bg: 'rgba(156, 163, 175, 0.15)', border: '#4B5563' };
    }
  };

  const badge = getStatusBadge(trade.status);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#09090B', color: '#F3F4F6', padding: '32px 16px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Back Link & Header */}
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <Link to="/exchange" style={{ color: '#9CA3AF', textDecoration: 'none', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span>←</span> Back to Exchange Marketplace
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                Trade {trade.tradeCode}
              </h1>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  backgroundColor: badge.bg,
                  color: badge.color,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {badge.label}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link
              to={`/exchange/orders/${trade.buyOrderId}`}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1E202B',
                color: '#D1D5DB',
                borderRadius: '8px',
                border: '1px solid #374151',
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              View Order {trade.buyOrder?.orderCode || ''}
            </Link>

            {canCancel && (
              <button
                onClick={handleCancelTrade}
                disabled={cancelling}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#EF4444',
                  borderRadius: '8px',
                  border: '1px solid #EF4444',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                }}
              >
                {cancelling ? 'Cancelling...' : 'Cancel Trade'}
              </button>
            )}
          </div>
        </div>

        {/* Feedback Alert */}
        {actionFeedback && (
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              fontSize: '0.9rem',
              marginBottom: '24px',
              backgroundColor: actionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${actionFeedback.type === 'success' ? '#10B981' : '#EF4444'}`,
              color: actionFeedback.type === 'success' ? '#10B981' : '#EF4444',
            }}
          >
            {actionFeedback.message}
          </div>
        )}

        {/* Main Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>

          {/* Left Column: Trade Specifications & Public Participants */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Item & Game Info Card */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                {trade.game?.iconUrl && (
                  <img src={trade.game.iconUrl} alt={trade.game.name} style={{ width: '52px', height: '52px', borderRadius: '10px', objectFit: 'cover' }} />
                )}
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {trade.game?.name} {trade.region ? `• ${trade.region.name}` : ''}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FACC15' }}>
                    {trade.currency?.name}
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>SETTLED QUANTITY</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFFFFF' }}>
                    {tradeUnits}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                    {trade.unitLabelSnapshot}s
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>UNIT PRICE SNAPSHOT</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10B981' }}>
                    ${unitPriceUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                    per {trade.unitLabelSnapshot}
                  </div>
                </div>
              </div>
            </div>

            {/* Participants Card (Zero PII) */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Trade Participants
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ backgroundColor: '#1E202B', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>BUYER</div>
                  <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                    {trade.buyer?.displayName || trade.buyer?.username || 'Buyer'}
                  </div>
                  {isBuyer && (
                    <span style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 600 }}>
                      (You)
                    </span>
                  )}
                </div>

                <div style={{ backgroundColor: '#1E202B', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>SELLER</div>
                  <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                    {trade.seller?.displayName || trade.seller?.username || 'Seller'}
                  </div>
                  {isSeller && (
                    <span style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 600 }}>
                      (You)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Delivery Instructions */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Delivery Details
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>DELIVERY METHOD</div>
                  <div style={{ fontWeight: 600, color: '#FACC15', fontSize: '0.95rem' }}>
                    {trade.deliveryMethod?.name || 'In-Game Direct Delivery'}
                  </div>
                  {trade.deliveryMethod?.description && (
                    <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '2px' }}>
                      {trade.deliveryMethod.description}
                    </div>
                  )}
                </div>

                {trade.buyerInstructionsSnapshot && (
                  <div style={{ backgroundColor: '#1E202B', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>BUYER INSTRUCTIONS SNAPSHOT</div>
                    <div style={{ fontSize: '0.85rem', color: '#FFFFFF', whiteSpace: 'pre-wrap' }}>
                      {trade.buyerInstructionsSnapshot}
                    </div>
                  </div>
                )}

                {trade.sellerNotes && (
                  <div style={{ backgroundColor: '#1E202B', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>SELLER NOTES</div>
                    <div style={{ fontSize: '0.85rem', color: '#FFFFFF', whiteSpace: 'pre-wrap' }}>
                      {trade.sellerNotes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Immutable Financial Snapshot & Events Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Immutable Financial Breakdown Card */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                  Financial Breakdown
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#9CA3AF', backgroundColor: '#1E202B', padding: '3px 8px', borderRadius: '4px' }}>
                  Rule v{trade.feeRuleVersionSnapshot} ({trade.feeRuleScopeSnapshot})
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                  <span style={{ color: '#9CA3AF' }}>Gross Value:</span>
                  <span style={{ color: '#FFFFFF', fontWeight: 600 }}>${grossUsd}</span>
                </div>

                {/* Buyer Perspective */}
                <div style={{ backgroundColor: '#1E202B', borderRadius: '8px', padding: '12px', marginTop: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 700, marginBottom: '6px' }}>
                    BUYER SETTLEMENT
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                    <span style={{ color: '#9CA3AF' }}>Platform Fee ({(trade.buyerCommissionBpsSnapshot / 100).toFixed(2)}%):</span>
                    <span style={{ color: '#FFFFFF' }}>+${buyerFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px solid #374151', paddingTop: '6px', marginTop: '4px' }}>
                    <span style={{ color: '#FFFFFF' }}>Total Payable:</span>
                    <span style={{ color: '#FACC15' }}>${buyerTotalUsd}</span>
                  </div>
                </div>

                {/* Seller Perspective */}
                <div style={{ backgroundColor: '#1E202B', borderRadius: '8px', padding: '12px', marginTop: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700, marginBottom: '6px' }}>
                    SELLER SETTLEMENT
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                    <span style={{ color: '#9CA3AF' }}>Platform Fee ({(trade.sellerCommissionBpsSnapshot / 100).toFixed(2)}%):</span>
                    <span style={{ color: '#EF4444' }}>-${sellerFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px solid #374151', paddingTop: '6px', marginTop: '4px' }}>
                    <span style={{ color: '#FFFFFF' }}>Net Payout:</span>
                    <span style={{ color: '#10B981' }}>${netSellerUsd}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Events Timeline */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Trade Timeline & Audit Log
              </h3>

              {(!trade.events || trade.events.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#9CA3AF', fontSize: '0.85rem' }}>
                  No recorded events yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}>
                  {trade.events.map((ev, idx) => (
                    <div
                      key={ev.id || idx}
                      style={{
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                        paddingLeft: '6px',
                        borderLeft: '2px solid #374151',
                        paddingBottom: '4px',
                      }}
                    >
                      <div
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor:
                            ev.eventType === 'TRADE_CANCELLED'
                              ? '#EF4444'
                              : ev.eventType === 'OFFER_ACCEPTED'
                              ? '#10B981'
                              : '#FACC15',
                          marginTop: '4px',
                          marginLeft: '-6px',
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '0.85rem' }}>
                            {ev.eventType}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                            {new Date(ev.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {ev.note && (
                          <div style={{ fontSize: '0.8rem', color: '#D1D5DB', marginTop: '2px' }}>
                            {ev.note}
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '2px' }}>
                          By: {ev.actorRole || 'SYSTEM'} • {new Date(ev.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
