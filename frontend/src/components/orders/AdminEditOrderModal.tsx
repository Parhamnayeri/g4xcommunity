import React, { useState, useEffect } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  fetchAdminOrderEditData,
  adminUpdateFullOrder,
  AdminOrderEditDataResponse,
  AdminOrderUpdatePayload,
} from '../../services/adminPortal';

interface Props {
  isOpen: boolean;
  orderId: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminEditOrderModal: React.FC<Props> = ({
  isOpen,
  orderId,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Raw data from server
  const [editData, setEditData] = useState<AdminOrderEditDataResponse | null>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [gameSlug, setGameSlug] = useState('wow');
  const [serviceId, setServiceId] = useState<number>(1);
  const [orderType, setOrderType] = useState('group');
  const [orderMode, setOrderMode] = useState('non_pilot');
  const [boostModel, setBoostModel] = useState('');
  const [vpnRequirement, setVpnRequirement] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [grossAmountUsd, setGrossAmountUsd] = useState('0.00');
  const [boosterPoolUsd, setBoosterPoolUsd] = useState('0.00');
  const [platformFeeUsd, setPlatformFeeUsd] = useState('0.00');
  const [currency, setCurrency] = useState('USD');
  const [sourceWebsite, setSourceWebsite] = useState('direct');
  const [sourceType, setSourceType] = useState('internal');
  const [externalOrderId, setExternalOrderId] = useState('');
  const [status, setStatus] = useState('open_presign');
  const [paymentStatus, setPaymentStatus] = useState('verified');
  const [advertiserId, setAdvertiserId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const [executionChannelId, setExecutionChannelId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!isOpen || !orderId) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    fetchAdminOrderEditData(orderId)
      .then((res) => {
        if (res.success && res.order) {
          setEditData(res);
          const o = res.order;
          setTitle(o.title || o.orderName || '');
          setGameSlug(o.gameSlug || 'wow');
          setServiceId(o.serviceId || (res.services[0]?.id ?? 1));
          setOrderType(o.orderType || 'group');
          setOrderMode(o.orderMode || 'non_pilot');
          setBoostModel(o.boostModel || '');
          setVpnRequirement(o.vpnRequirement || '');
          setQuantity(o.quantity || 1);
          setGrossAmountUsd(o.grossAmountUsd || '0.00');
          setBoosterPoolUsd(o.boosterPoolUsd || '0.00');
          setPlatformFeeUsd(o.platformFeeUsd || '0.00');
          setCurrency(o.currency || 'USD');
          setSourceWebsite(o.sourceWebsite || 'direct');
          setSourceType(o.sourceType || 'internal');
          setExternalOrderId(o.externalOrderId || '');
          setStatus(o.status || 'open_presign');
          setPaymentStatus(o.paymentStatus || 'verified');
          setAdvertiserId(o.advertiserId || '');
          setCustomerId(o.customerId || '');
          setCreatorId(o.creatorId || '');
          setExecutionChannelId(o.executionChannelId || '');
          setNotes(o.notes || '');
          setReason('');
        } else {
          setError('Failed to load order data.');
        }
      })
      .catch((err) => {
        setError(err.message || 'Error fetching order edit data.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, orderId]);

  if (!isOpen || !orderId) return null;

  // Filter available services for the selected game
  const availableServices = (editData?.services || []).filter(
    (s) => s.gameSlug === gameSlug
  );

  // Auto-calculate fee when gross or pool changes
  const handleGrossChange = (val: string) => {
    setGrossAmountUsd(val);
    const g = parseFloat(val) || 0;
    const p = parseFloat(boosterPoolUsd) || 0;
    setPlatformFeeUsd(Math.max(0, g - p).toFixed(2));
  };

  const handlePoolChange = (val: string) => {
    setBoosterPoolUsd(val);
    const g = parseFloat(grossAmountUsd) || 0;
    const p = parseFloat(val) || 0;
    setPlatformFeeUsd(Math.max(0, g - p).toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId) return;

    const gross = parseFloat(grossAmountUsd);
    const pool = parseFloat(boosterPoolUsd);

    if (isNaN(gross) || gross < 0) {
      setError('Gross Amount (Client Price) must be a non-negative number.');
      return;
    }

    if (isNaN(pool) || pool < 0) {
      setError('Booster Pool must be a non-negative number.');
      return;
    }

    if (gross > 0 && pool > gross) {
      setError(`Booster Pool ($${pool.toFixed(2)}) cannot exceed Gross Amount ($${gross.toFixed(2)}).`);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const payload: AdminOrderUpdatePayload = {
      title: title.trim(),
      orderName: title.trim(),
      gameSlug,
      serviceId,
      orderType,
      orderMode,
      boostModel: boostModel.trim() || undefined,
      vpnRequirement: vpnRequirement.trim() || undefined,
      quantity: Number(quantity) || 1,
      grossAmountUsd: gross,
      boosterPoolUsd: pool,
      platformFeeUsd: parseFloat(platformFeeUsd) || Math.max(0, gross - pool),
      currency: currency.toUpperCase().trim(),
      sourceWebsite: sourceWebsite.trim().toLowerCase(),
      sourceType,
      externalOrderId: externalOrderId.trim() || undefined,
      status,
      paymentStatus,
      advertiserId: advertiserId.trim() || undefined,
      customerId: customerId.trim() || undefined,
      creatorId: creatorId.trim() || undefined,
      executionChannelId: executionChannelId.trim() || undefined,
      notes: notes.trim(),
      reason: reason.trim() || 'Admin order modification',
    };

    try {
      const res = await adminUpdateFullOrder(orderId, payload);
      if (res.success) {
        setSuccessMsg(res.message || 'Order updated successfully!');
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      } else {
        setError(res.message || 'Failed to update order.');
      }
    } catch (err: any) {
      setError(err.message || 'Server error while updating order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="studio-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      style={{ zIndex: 1200 }}
    >
      <div
        className="studio-modal-card studio-modal-card-xl"
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0c0e14',
          border: '1px solid rgba(250, 204, 21, 0.3)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        }}
      >
        {/* Header */}
        <div
          className="studio-modal-header"
          style={{
            backgroundColor: '#12151f',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '1.25rem 1.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.3rem' }}>✏️</span>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f3f4f6', margin: 0 }}>
                Edit Order {editData?.order.orderRef ? `(${editData.order.orderRef})` : `#${orderId}`}
              </h2>
              <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                Admin &amp; Owner Override
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#9ca3af' }}>
              Fully correct financial splits, title, game metadata, execution status, and notes. All modifications are logged in the audit trail.
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="studio-modal-close"
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '0.4rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div
          className="studio-modal-body"
          style={{
            padding: '1.5rem 1.75rem',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {loading && <LoadingState message="Loading order data and game services..." />}

          {error && (
            <div
              style={{
                padding: '0.85rem 1.15rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                padding: '0.85rem 1.15rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#86efac',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>✓</span>
              <span>{successMsg}</span>
            </div>
          )}

          {!loading && editData && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* SECTION 1: Financial & Booster Pool */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(250, 204, 21, 0.3)',
                  backgroundColor: 'rgba(250, 204, 21, 0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>💰</span>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#facc15', fontWeight: 700 }}>
                    Financial &amp; Booster Reward Allocation
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  {/* Gross Amount */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Gross Amount / Client Price ($ USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={grossAmountUsd}
                      onChange={(e) => handleGrossChange(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'monospace' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '2px', display: 'block' }}>
                      Total customer/marketplace payment
                    </span>
                  </div>

                  {/* Booster Pool */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#facc15', marginBottom: '4px' }}>
                      Booster Reward Pool ($ USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={boosterPoolUsd}
                      onChange={(e) => handlePoolChange(e.target.value)}
                      className="input"
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        borderColor: '#facc15',
                        color: '#facc15',
                        backgroundColor: 'rgba(250, 204, 21, 0.06)',
                      }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#facc15', marginTop: '2px', display: 'block' }}>
                      Exact payout allocated to booster(s)
                    </span>
                  </div>

                  {/* Platform Fee / Net Margin */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#c084fc', marginBottom: '4px' }}>
                      Platform Margin ($ USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={platformFeeUsd}
                      onChange={(e) => setPlatformFeeUsd(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'monospace', color: '#c084fc' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '2px', display: 'block' }}>
                      Net platform profit (Gross - Pool)
                    </span>
                  </div>

                  {/* Currency */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="USD">USD ($)</option>
                      <option value="GOLD">GOLD</option>
                      <option value="USDT">USDT</option>
                      <option value="IRT">IRT (Toman)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTION 2: General Order Information */}
              <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>📋</span>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                    Order Details &amp; Game Service
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1rem' }}>
                  {/* Title / Order Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Order Title / Public Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Mythic+ 10 Keystone Timed Run"
                      className="input"
                      style={{ fontSize: '0.88rem' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  {/* Game Slug */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Game
                    </label>
                    <select
                      value={gameSlug}
                      onChange={(e) => {
                        const newGame = e.target.value;
                        setGameSlug(newGame);
                        const matched = (editData?.services || []).filter((s) => s.gameSlug === newGame);
                        if (matched.length > 0) setServiceId(matched[0].id);
                      }}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      {(editData?.games || []).map((g) => (
                        <option key={g.slug} value={g.slug}>
                          {g.displayName} ({g.slug})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Game Service */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Service
                    </label>
                    <select
                      value={serviceId}
                      onChange={(e) => setServiceId(Number(e.target.value))}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      {availableServices.length > 0 ? (
                        availableServices.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.displayName}
                          </option>
                        ))
                      ) : (
                        <option value={serviceId}>Current Service (#{serviceId})</option>
                      )}
                    </select>
                  </div>

                  {/* Order Type */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Order Type
                    </label>
                    <select
                      value={orderType}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="group">Group / Squad</option>
                      <option value="solo">Solo Booster</option>
                      <option value="pilot">Pilot Carry</option>
                      <option value="premade">Premade Roster</option>
                    </select>
                  </div>

                  {/* Order Mode */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Execution Mode
                    </label>
                    <select
                      value={orderMode}
                      onChange={(e) => setOrderMode(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="non_pilot">Self-Play (Non-Pilot)</option>
                      <option value="pilot">Account Share (Pilot)</option>
                    </select>
                  </div>

                  {/* Boost Model */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Boost Model
                    </label>
                    <input
                      type="text"
                      value={boostModel}
                      onChange={(e) => setBoostModel(e.target.value)}
                      placeholder="e.g. self_play, piloted"
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* Quantity */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Quantity / Runs Count
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* VPN Requirement */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      VPN Requirement
                    </label>
                    <input
                      type="text"
                      value={vpnRequirement}
                      onChange={(e) => setVpnRequirement(e.target.value)}
                      placeholder="e.g. None, Germany, Required"
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 3: Platform & Source IDs */}
              <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>🌐</span>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                    Source Platform &amp; External IDs
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  {/* Source Website */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Platform / Website
                    </label>
                    <select
                      value={sourceWebsite}
                      onChange={(e) => setSourceWebsite(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="direct">Direct / Internal G4X</option>
                      <option value="g2g">G2G Marketplace</option>
                      <option value="eldorado">Eldorado</option>
                      <option value="skycoach">Skycoach</option>
                      <option value="kingboost">Kingboost</option>
                      <option value="overgear">Overgear</option>
                      <option value="funpay">FunPay</option>
                    </select>
                  </div>

                  {/* Source Type */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Source Type
                    </label>
                    <select
                      value={sourceType}
                      onChange={(e) => setSourceType(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="internal">Internal G4X Order</option>
                      <option value="external">External Marketplace</option>
                      <option value="advertiser">Advertiser Placed</option>
                    </select>
                  </div>

                  {/* External Order ID */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      External Order ID / Marketplace Ref
                    </label>
                    <input
                      type="text"
                      value={externalOrderId}
                      onChange={(e) => setExternalOrderId(e.target.value)}
                      placeholder="e.g. G2G-1794305332"
                      className="input"
                      style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 4: Status & Discord Channel Routing */}
              <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>⚙️</span>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                    Lifecycle Status &amp; Account Identifiers
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  {/* Order Status */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Order Lifecycle Status *
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem', fontWeight: 600 }}
                    >
                      <option value="draft">Draft</option>
                      <option value="payment_pending">Payment Pending</option>
                      <option value="open_presign">Open Pre-sign (Accepting Claims)</option>
                      <option value="presign_closed">Pre-sign Closed</option>
                      <option value="assigned">Assigned to Booster(s)</option>
                      <option value="in_progress">In Progress (Active Run)</option>
                      <option value="pending_review">Pending Review</option>
                      <option value="waiting_for_confirm">Waiting for Customer Confirm</option>
                      <option value="warranty">Warranty Period</option>
                      <option value="done">Done (Completed)</option>
                      <option value="completed">Completed (Archived)</option>
                      <option value="disputed">Disputed / Escalated</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  {/* Payment Status */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Payment Status
                    </label>
                    <select
                      value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value)}
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="pending">Pending Receipt</option>
                      <option value="verified">Verified &amp; Cleared</option>
                      <option value="unneeded">Unneeded / Internal</option>
                      <option value="refunded">Refunded</option>
                    </select>
                  </div>

                  {/* Advertiser Discord ID */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Advertiser Discord ID
                    </label>
                    <input
                      type="text"
                      value={advertiserId}
                      onChange={(e) => setAdvertiserId(e.target.value)}
                      placeholder="e.g. 123456789012345678"
                      className="input"
                      style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}
                    />
                  </div>

                  {/* Execution Channel ID */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Execution Channel ID
                    </label>
                    <input
                      type="text"
                      value={executionChannelId}
                      onChange={(e) => setExecutionChannelId(e.target.value)}
                      placeholder="Discord Channel ID"
                      className="input"
                      style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 5: Notes & Modification Reason */}
              <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>📝</span>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                    Operational Instructions &amp; Audit Reason
                  </h4>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                      Operational Notes &amp; Customer Requirements
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add key level, dungeon names, special character requests, etc."
                      className="input"
                      style={{ fontSize: '0.85rem', resize: 'vertical' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#facc15', marginBottom: '4px' }}>
                      Reason for Modification (Logged in Audit History) *
                    </label>
                    <input
                      type="text"
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Corrected booster pool typo from client input, updated game service"
                      className="input"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '0.85rem',
                  paddingTop: '0.5rem',
                }}
              >
                <button
                  type="button"
                  disabled={saving}
                  onClick={onClose}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.6rem 1.25rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-cta"
                  style={{
                    fontSize: '0.88rem',
                    padding: '0.6rem 1.5rem',
                    fontWeight: 700,
                    backgroundColor: '#facc15',
                    color: '#000',
                  }}
                >
                  {saving ? 'Saving Changes...' : '💾 Save & Update Order'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
