/**
 * frontend/src/pages/ExchangeBuyOrderDetailPage.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 4:
 * Dedicated Buy Order Details, Real-time Capacity Tracking,
 * Live Seller Payout Calculator & Offer Submission,
 * and Buyer Offer Acceptance / Rejection Panel.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ExchangeBuyOrderItem,
  ExchangeSellOfferItem,
  SellOfferPreviewData,
  ExchangeDeliveryMethodItem,
} from '../types/exchange';
import {
  fetchMarketplaceOrderById,
  fetchOffersOnBuyOrder,
  previewSellOffer,
  submitSellOffer,
  acceptSellOffer,
  rejectSellOffer,
  fetchPublicCatalog,
} from '../services/exchangeMarketplace';

export const ExchangeBuyOrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, status } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const currentUserId = user?.discordId;

  // Order & Catalog State
  const [order, setOrder] = useState<ExchangeBuyOrderItem | null>(null);
  const [deliveryMethods, setDeliveryMethods] = useState<ExchangeDeliveryMethodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Incoming Offers State (for Buyer / Staff)
  const [offers, setOffers] = useState<ExchangeSellOfferItem[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);

  // Seller Offer Submission Form State
  const [offerAmount, setOfferAmount] = useState<string>('');
  const [selectedDeliveryMethodId, setSelectedDeliveryMethodId] = useState<string>('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(30);
  const [sellerNotes, setSellerNotes] = useState<string>('');
  const [previewData, setPreviewData] = useState<SellOfferPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [submittingOffer, setSubmittingOffer] = useState<boolean>(false);
  const [offerFeedback, setOfferFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Buyer Action State
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [buyerFeedback, setBuyerFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isBuyer = order && currentUserId && order.buyer.discordId === currentUserId;

  // Load Order and Delivery Methods
  const loadOrderData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [orderRes, catalogRes] = await Promise.all([
        fetchMarketplaceOrderById(id),
        fetchPublicCatalog().catch(() => ({ deliveryMethods: [] })),
      ]);
      setOrder(orderRes);
      if (catalogRes && catalogRes.deliveryMethods) {
        setDeliveryMethods(catalogRes.deliveryMethods);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load order details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load incoming offers if current user is the buyer
  const loadOffers = useCallback(async () => {
    if (!id || !isBuyer) return;
    try {
      setLoadingOffers(true);
      const res = await fetchOffersOnBuyOrder(id);
      if (res && res.offers) {
        setOffers(res.offers);
      }
    } catch (err: any) {
      console.error('Failed to load offers on buy order:', err);
    } finally {
      setLoadingOffers(false);
    }
  }, [id, isBuyer]);

  useEffect(() => {
    loadOrderData();
  }, [loadOrderData]);

  useEffect(() => {
    if (order && isBuyer) {
      loadOffers();
    }
  }, [order, isBuyer, loadOffers]);

  // Set default delivery method when order is loaded
  useEffect(() => {
    if (order && order.acceptedDeliveryMethodIds && order.acceptedDeliveryMethodIds.length > 0) {
      setSelectedDeliveryMethodId(order.acceptedDeliveryMethodIds[0]);
    }
  }, [order]);

  // Debounced Pricing Preview
  useEffect(() => {
    if (!order || !offerAmount || !/^\d+$/.test(offerAmount) || offerAmount === '0') {
      setPreviewData(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        const preview = await previewSellOffer(order.id, offerAmount);
        setPreviewData(preview);
      } catch (err) {
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [order, offerAmount]);

  // Calculations for capacity bar
  const capacityMetrics = useMemo(() => {
    if (!order) return { total: 0n, remaining: 0n, reserved: 0n, pctRemaining: 0, pctReserved: 0 };
    try {
      const total = BigInt(order.totalCapacityBaseUnits || '1');
      const remaining = BigInt(order.remainingCapacityBaseUnits || '0');
      const reserved = BigInt(order.reservedCapacityBaseUnits || '0');
      const mult = BigInt(order.unitMultiplierSnapshot || '1');

      const pctRemaining = total > 0n ? Number((remaining * 100n) / total) : 0;
      const pctReserved = total > 0n ? Number((reserved * 100n) / total) : 0;

      return {
        total,
        remaining,
        reserved,
        mult,
        totalUnits: (total / mult).toString(),
        remainingUnits: (remaining / mult).toString(),
        reservedUnits: (reserved / mult).toString(),
        pctRemaining,
        pctReserved,
      };
    } catch (e) {
      return { total: 0n, remaining: 0n, reserved: 0n, pctRemaining: 0, pctReserved: 0 };
    }
  }, [order]);

  // Handle Offer Submission
  const handleOfferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !isAuthenticated) {
      setOfferFeedback({ type: 'error', message: 'Please sign in to submit a sell offer.' });
      return;
    }

    if (isBuyer) {
      setOfferFeedback({ type: 'error', message: 'You cannot submit a sell offer to your own buy order.' });
      return;
    }

    if (!offerAmount || !/^\d+$/.test(offerAmount) || offerAmount === '0') {
      setOfferFeedback({ type: 'error', message: 'Please enter a valid positive integer quantity.' });
      return;
    }

    if (!selectedDeliveryMethodId) {
      setOfferFeedback({ type: 'error', message: 'Please select an accepted delivery method.' });
      return;
    }

    try {
      setSubmittingOffer(true);
      setOfferFeedback(null);

      const res = await submitSellOffer(order.id, {
        offeredAmountBaseUnits: offerAmount,
        deliveryMethodId: selectedDeliveryMethodId,
        estimatedDeliveryMinutes: estimatedMinutes,
        additionalInfo: sellerNotes,
      });

      setOfferFeedback({
        type: 'success',
        message: `Sell offer ${res.offer.offerCode} submitted successfully! The buyer has been notified.`,
      });

      // Clear input
      setOfferAmount('');
      setSellerNotes('');
      setPreviewData(null);
    } catch (err: any) {
      setOfferFeedback({
        type: 'error',
        message: err?.message || 'Failed to submit sell offer.',
      });
    } finally {
      setSubmittingOffer(false);
    }
  };

  // Handle Buyer Accept Offer
  const handleAcceptOffer = async (offerId: string) => {
    if (!window.confirm('Are you sure you want to accept this offer? This will reserve order capacity and initiate a trade.')) {
      return;
    }

    try {
      setActionLoadingId(offerId);
      setBuyerFeedback(null);
      const res = await acceptSellOffer(offerId);
      setBuyerFeedback({
        type: 'success',
        message: `Offer accepted! Trade ${res.trade.tradeCode} created. Redirecting...`,
      });
      setTimeout(() => {
        navigate(`/exchange/trades/${res.trade.id}`);
      }, 1200);
    } catch (err: any) {
      setBuyerFeedback({
        type: 'error',
        message: err?.message || 'Failed to accept offer. Capacity may have changed concurrently.',
      });
      loadOrderData();
      loadOffers();
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Buyer Reject Offer
  const handleRejectOffer = async (offerId: string) => {
    const reason = window.prompt('Please enter a rejection reason (optional):');
    if (reason === null) return; // User cancelled prompt

    try {
      setActionLoadingId(offerId);
      setBuyerFeedback(null);
      await rejectSellOffer(offerId, reason);
      setBuyerFeedback({ type: 'success', message: 'Offer rejected successfully.' });
      loadOffers();
    } catch (err: any) {
      setBuyerFeedback({ type: 'error', message: err?.message || 'Failed to reject offer.' });
    } finally {
      setActionLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090B' }}>
        <div style={{ color: '#FACC15', fontSize: '1.2rem', fontWeight: 600 }}>Loading Buy Order Details...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ minHeight: '80vh', padding: '40px 20px', backgroundColor: '#09090B', color: '#F3F4F6' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', backgroundColor: '#13151C', padding: '32px', borderRadius: '12px', border: '1px solid #EF4444' }}>
          <h2 style={{ color: '#EF4444', marginBottom: '12px' }}>Order Not Found</h2>
          <p style={{ color: '#9CA3AF', marginBottom: '20px' }}>{error || 'The requested buy order does not exist or has been removed.'}</p>
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

  const multiplierBig = BigInt(order.unitMultiplierSnapshot || '1');
  const minTradeUnits = (BigInt(order.minTradeBaseUnits) / multiplierBig).toString();
  const maxTradeUnits = (BigInt(order.maxTradeBaseUnits) / multiplierBig).toString();

  // Filter accepted delivery methods
  const acceptedMethods = deliveryMethods.filter((dm) =>
    order.acceptedDeliveryMethodIds.includes(dm.id)
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#09090B', color: '#F3F4F6', padding: '32px 16px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Back Link & Header */}
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <Link to="/exchange" style={{ color: '#9CA3AF', textDecoration: 'none', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span>←</span> Back to Exchange Marketplace
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                Buy Order {order.orderCode}
              </h1>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  backgroundColor:
                    order.status === 'ACTIVE'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : order.status === 'PARTIALLY_FILLED'
                      ? 'rgba(250, 204, 21, 0.15)'
                      : 'rgba(156, 163, 175, 0.15)',
                  color:
                    order.status === 'ACTIVE'
                      ? '#10B981'
                      : order.status === 'PARTIALLY_FILLED'
                      ? '#FACC15'
                      : '#9CA3AF',
                  border: `1px solid ${
                    order.status === 'ACTIVE'
                      ? '#10B981'
                      : order.status === 'PARTIALLY_FILLED'
                      ? '#FACC15'
                      : '#4B5563'
                  }`,
                }}
              >
                {order.status}
              </span>
            </div>
          </div>

          {isBuyer && (
            <div style={{ padding: '6px 12px', backgroundColor: 'rgba(139, 92, 246, 0.15)', border: '1px solid #8B5CF6', borderRadius: '8px', color: '#C4B5FD', fontSize: '0.85rem', fontWeight: 600 }}>
              ★ You are the Buyer of this order
            </div>
          )}
        </div>

        {/* Grid: Order Details & Seller Calculator */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>

          {/* Left Column: Order Specs & Buyer Profile */}
          <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid #27272A', paddingBottom: '16px' }}>
              {order.game.iconUrl && (
                <img src={order.game.iconUrl} alt={order.game.name} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
              )}
              <div>
                <div style={{ fontSize: '0.85rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {order.game.name} {order.region ? `• ${order.region.name}` : ''}
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FACC15' }}>
                  {order.currency.name}
                </div>
              </div>
            </div>

            {/* Pricing Strip */}
            <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>OFFER PRICE</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10B981' }}>
                  ${order.pricePerUnitUsd}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                  per {order.unitLabelSnapshot}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>TRADE RANGE</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {minTradeUnits} – {maxTradeUnits}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                  {order.currency.unitLabel}s per trade
                </div>
              </div>
            </div>

            {/* Capacity Progress Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                <span style={{ color: '#9CA3AF' }}>Fulfillment Capacity:</span>
                <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
                  {capacityMetrics.remainingUnits} / {capacityMetrics.totalUnits} {order.currency.unitLabel}s remaining
                </span>
              </div>
              <div style={{ width: '100%', height: '10px', backgroundColor: '#27272A', borderRadius: '5px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${capacityMetrics.pctRemaining}%`, backgroundColor: '#10B981', height: '100%' }} title="Remaining Open" />
                <div style={{ width: `${capacityMetrics.pctReserved}%`, backgroundColor: '#FACC15', height: '100%' }} title="Reserved in Trade" />
              </div>
              <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.75rem', color: '#9CA3AF' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', backgroundColor: '#10B981', borderRadius: '2px' }}></span> Available: {capacityMetrics.remainingUnits}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', backgroundColor: '#FACC15', borderRadius: '2px' }}></span> Reserved: {capacityMetrics.reservedUnits}
                </span>
              </div>
            </div>

            {/* Accepted Delivery Methods */}
            <div>
              <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginBottom: '8px' }}>Accepted Delivery Methods:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {acceptedMethods.map((dm) => (
                  <span
                    key={dm.id}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(250, 204, 21, 0.08)',
                      border: '1px solid rgba(250, 204, 21, 0.25)',
                      color: '#FACC15',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    ✓ {dm.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Instructions */}
            {order.instructions && (
              <div style={{ backgroundColor: '#1E202B', borderRadius: '8px', padding: '12px', borderLeft: '3px solid #FACC15' }}>
                <div style={{ fontSize: '0.75rem', color: '#FACC15', fontWeight: 700, marginBottom: '4px' }}>BUYER INSTRUCTIONS</div>
                <div style={{ fontSize: '0.85rem', color: '#D1D5DB', whiteSpace: 'pre-wrap' }}>{order.instructions}</div>
              </div>
            )}

            {/* Public Buyer Profile Card (Zero PII) */}
            <div style={{ marginTop: 'auto', borderTop: '1px solid #27272A', paddingTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>BUYER PUBLIC PROFILE</div>
                <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                  {order.buyer.displayName || order.buyer.username}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                  Member since {new Date(order.buyer.memberSince).toLocaleDateString()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10B981' }}>
                  ★ {order.buyer.reputationScore} Rep
                </div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                  {order.buyer.completedTradesCount} Trades Completed
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Seller Offer Submission / Live Calculator */}
          <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#FACC15' }}>⚡</span> Sell to this Buyer
            </h2>

            {isBuyer ? (
              <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#1E202B', borderRadius: '10px', color: '#9CA3AF', marginTop: 'auto', marginBottom: 'auto' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🛡️</div>
                <div style={{ fontWeight: 700, color: '#FFFFFF', marginBottom: '6px' }}>This is your Buy Order</div>
                <div style={{ fontSize: '0.85rem' }}>You cannot submit sell offers to your own order. Review incoming seller offers in the panel below.</div>
              </div>
            ) : order.status !== 'ACTIVE' && order.status !== 'PARTIALLY_FILLED' ? (
              <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#1E202B', borderRadius: '10px', color: '#9CA3AF', marginTop: 'auto', marginBottom: 'auto' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔒</div>
                <div style={{ fontWeight: 700, color: '#FFFFFF', marginBottom: '6px' }}>Order Not Open for Offers</div>
                <div style={{ fontSize: '0.85rem' }}>This order is currently {order.status} and cannot receive new offers.</div>
              </div>
            ) : (
              <form onSubmit={handleOfferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Quantity Input */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 600 }}>
                      Quantity to Sell ({order.currency.unitLabel}s)
                    </label>
                    <button
                      type="button"
                      onClick={() => setOfferAmount(order.remainingCapacityBaseUnits)}
                      style={{ background: 'none', border: 'none', color: '#FACC15', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      Max Available ({capacityMetrics.remainingUnits})
                    </button>
                  </div>
                  <input
                    type="text"
                    value={offerAmount}
                    onChange={(e) => setOfferAmount(e.target.value.replace(/\D/g, ''))}
                    placeholder={`e.g. ${order.minTradeBaseUnits}`}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '1rem',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>
                    Trade bounds: {minTradeUnits} – {maxTradeUnits} {order.currency.unitLabel}s
                  </div>
                </div>

                {/* Delivery Method Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 600, marginBottom: '6px' }}>
                    Select Delivery Method
                  </label>
                  <select
                    value={selectedDeliveryMethodId}
                    onChange={(e) => setSelectedDeliveryMethodId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  >
                    {acceptedMethods.map((dm) => (
                      <option key={dm.id} value={dm.id}>
                        {dm.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estimated Delivery Time */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 600, marginBottom: '6px' }}>
                    Estimated Delivery Time (Minutes)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="1440"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(Math.max(5, parseInt(e.target.value || '30', 10)))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Additional Notes */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#9CA3AF', fontWeight: 600, marginBottom: '6px' }}>
                    Notes for Buyer (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={sellerNotes}
                    onChange={(e) => setSellerNotes(e.target.value)}
                    placeholder="e.g. Available on Discord now, ready to trade at Orgrimmar AH"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Live Payout Breakdown Card */}
                {previewLoading ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.85rem' }}>
                    Calculating live payout...
                  </div>
                ) : previewData ? (
                  <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '14px', border: '1px solid #374151' }}>
                    <div style={{ fontSize: '0.8rem', color: '#FACC15', fontWeight: 700, marginBottom: '8px' }}>
                      FINANCIAL ESTIMATE (ZERO-FLOAT PRECISION)
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                      <span style={{ color: '#9CA3AF' }}>Gross Value:</span>
                      <span style={{ color: '#FFFFFF', fontWeight: 600 }}>${previewData.pricing.grossUsd}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                      <span style={{ color: '#9CA3AF' }}>Platform Fee ({(previewData.pricing.sellerCommissionBps / 100).toFixed(2)}%):</span>
                      <span style={{ color: '#EF4444' }}>-${previewData.pricing.sellerFeeUsd}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px solid #374151', paddingTop: '8px', marginTop: '6px' }}>
                      <span style={{ color: '#10B981' }}>Your Net Payout:</span>
                      <span style={{ color: '#10B981' }}>${previewData.pricing.netSellerUsd}</span>
                    </div>
                  </div>
                ) : null}

                {/* Feedback Message */}
                {offerFeedback && (
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      backgroundColor: offerFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      border: `1px solid ${offerFeedback.type === 'success' ? '#10B981' : '#EF4444'}`,
                      color: offerFeedback.type === 'success' ? '#10B981' : '#EF4444',
                    }}
                  >
                    {offerFeedback.message}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submittingOffer || !offerAmount || offerAmount === '0'}
                  style={{
                    padding: '14px',
                    backgroundColor: submittingOffer ? '#4B5563' : '#FACC15',
                    color: '#000000',
                    fontWeight: 800,
                    fontSize: '1rem',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: submittingOffer ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {submittingOffer ? 'Submitting Offer...' : 'Submit Sell Offer'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Bottom Section for Buyer: Incoming Sell Offers */}
        {isBuyer && (
          <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                  Incoming Sell Offers ({offers.length})
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#9CA3AF', margin: '4px 0 0 0' }}>
                  Review offers from verified sellers. Accepting an offer will reserve order capacity and initiate a trade.
                </p>
              </div>
              <button
                onClick={loadOffers}
                disabled={loadingOffers}
                style={{ padding: '6px 14px', backgroundColor: '#1E202B', color: '#D1D5DB', border: '1px solid #374151', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                {loadingOffers ? 'Refreshing...' : '↻ Refresh Offers'}
              </button>
            </div>

            {buyerFeedback && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                  backgroundColor: buyerFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: `1px solid ${buyerFeedback.type === 'success' ? '#10B981' : '#EF4444'}`,
                  color: buyerFeedback.type === 'success' ? '#10B981' : '#EF4444',
                }}
              >
                {buyerFeedback.message}
              </div>
            )}

            {offers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px', color: '#9CA3AF', backgroundColor: '#1E202B', borderRadius: '8px' }}>
                No sell offers have been submitted for this order yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {offers.map((offer) => {
                  const offerUnits = (BigInt(offer.offeredAmountBaseUnits) / multiplierBig).toString();
                  const isActionable = offer.status === 'PENDING';
                  const isProcessing = actionLoadingId === offer.id;

                  return (
                    <div
                      key={offer.id}
                      style={{
                        backgroundColor: '#1E202B',
                        borderRadius: '10px',
                        padding: '16px',
                        border: '1px solid #27272A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '16px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <span style={{ fontWeight: 800, color: '#FFFFFF', fontSize: '1rem' }}>
                            {offer.offerCode}
                          </span>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor:
                                offer.status === 'PENDING'
                                  ? 'rgba(250, 204, 21, 0.15)'
                                  : offer.status === 'ACCEPTED'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(239, 68, 68, 0.15)',
                              color:
                                offer.status === 'PENDING'
                                  ? '#FACC15'
                                  : offer.status === 'ACCEPTED'
                                  ? '#10B981'
                                  : '#EF4444',
                            }}
                          >
                            {offer.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#D1D5DB' }}>
                          Seller: <strong style={{ color: '#FFFFFF' }}>{offer.seller?.displayName || offer.seller?.username || 'Verified Seller'}</strong> • Delivery via: <strong>{offer.deliveryMethod?.name || 'Standard'}</strong> (~{offer.estimatedDeliveryMinutes}m)
                        </div>
                        {offer.additionalInfo && (
                          <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '4px', fontStyle: 'italic' }}>
                            "{offer.additionalInfo}"
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>
                          Submitted: {new Date(offer.createdAt).toLocaleString()}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FACC15' }}>
                            {offerUnits} {order.currency.unitLabel}s
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                            Offered Amount
                          </div>
                        </div>

                        {isActionable ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleAcceptOffer(offer.id)}
                              disabled={isProcessing}
                              style={{
                                padding: '8px 16px',
                                backgroundColor: '#10B981',
                                color: '#FFFFFF',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: 'none',
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                              }}
                            >
                              {isProcessing ? 'Processing...' : 'Accept Offer'}
                            </button>
                            <button
                              onClick={() => handleRejectOffer(offer.id)}
                              disabled={isProcessing}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#27272A',
                                color: '#EF4444',
                                fontWeight: 600,
                                borderRadius: '6px',
                                border: '1px solid #374151',
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        ) : offer.trade ? (
                          <Link
                            to={`/exchange/trades/${offer.trade.id}`}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#8B5CF6',
                              color: '#FFFFFF',
                              fontWeight: 700,
                              borderRadius: '6px',
                              textDecoration: 'none',
                              fontSize: '0.85rem',
                              display: 'inline-block',
                            }}
                          >
                            View Trade {offer.trade.tradeCode} →
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
