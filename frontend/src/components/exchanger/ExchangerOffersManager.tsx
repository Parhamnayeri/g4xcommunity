import React, { useState } from 'react';
import { ExchangerOffer } from '../../types/exchange';
import { createExchangerOffer, updateExchangerOffer } from '../../services/exchange';

interface ExchangerOffersManagerProps {
  offers: ExchangerOffer[];
  onRefresh: () => void;
}

export const ExchangerOffersManager: React.FC<ExchangerOffersManagerProps> = ({ offers, onRefresh }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [serviceType, setServiceType] = useState<'GOLD_TRADE' | 'P2P_FUNDING'>('GOLD_TRADE');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [targetCurrency, setTargetCurrency] = useState<'IRT' | 'USDT' | 'USD_WALLET'>('IRT');
  const [commissionBps, setCommissionBps] = useState<number>(300); // 3.00%
  const [minUsdCents, setMinUsdCents] = useState<number>(1000); // $10.00
  const [maxUsdCents, setMaxUsdCents] = useState<number>(100000); // $1,000.00
  const [settlementDetails, setSettlementDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionOfferId, setActionOfferId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleToggleOffer = async (offer: ExchangerOffer) => {
    setActionOfferId(offer.id);
    setErrorMsg(null);
    try {
      const isCurrentlyActive = offer.status ? offer.status === 'ACTIVE' : Boolean(offer.isActive);
      const nextStatus = isCurrentlyActive ? 'PAUSED' : 'ACTIVE';
      await updateExchangerOffer(offer.id, { status: nextStatus });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to update offer status');
    } finally {
      setActionOfferId(null);
    }
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await createExchangerOffer({
        serviceType,
        settlementCurrency: targetCurrency,
        commissionPercentage: Number(commissionBps) / 10000,
        minAmount: Number(minUsdCents) / 100,
        maxAmount: Number(maxUsdCents) / 100,
        terms: settlementDetails.trim() || undefined,
      });

      setSuccessMsg('Offer created and published successfully!');
      setTimeout(() => {
        setShowCreateModal(false);
        setSuccessMsg(null);
        onRefresh();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to create offer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-subtle)', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem' }}>My Marketplace Offers</h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Configure your exchange fee tiers and liquidity limits available to the community.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            padding: '10px 16px',
            backgroundColor: 'var(--primary-purple)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          + Create New Offer
        </button>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
          {errorMsg}
        </div>
      )}

      {offers.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon">📋</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No published offers yet.</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Click "+ Create New Offer" to list your liquidity on the marketplace.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service Type</th>
                <th>Target Currency</th>
                <th>Direction</th>
                <th>Commission Rate</th>
                <th>Min / Max Limit</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => {
                const targetCurr = offer.settlementCurrency || offer.targetCurrency || 'IRT';
                const isOfferActive = offer.status ? offer.status === 'ACTIVE' : Boolean(offer.isActive);
                const commissionText = offer.commissionPercentage !== undefined
                  ? `${(offer.commissionPercentage * 100).toFixed(2)}%`
                  : `${((offer.commissionRateBps || 0) / 100).toFixed(2)}%`;
                const minVal = offer.minAmount !== undefined && offer.minAmount !== null
                  ? offer.minAmount
                  : ((offer.minAmountUsdCents || 0) / 100);
                const maxVal = offer.maxAmount !== undefined && offer.maxAmount !== null
                  ? offer.maxAmount
                  : ((offer.maxAmountUsdCents || 0) / 100);

                return (
                  <tr key={offer.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {offer.serviceType === 'GOLD_TRADE' ? 'Gold Trade' : 'P2P Funding'}
                    </td>
                    <td>
                      <span
                        className={
                          targetCurr === 'IRT'
                            ? 'badge badge-yellow'
                            : targetCurr === 'USD_WALLET'
                            ? 'badge badge-purple'
                            : 'badge badge-blue'
                        }
                      >
                        {targetCurr}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {offer.direction || 'BUY'}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--accent-yellow)' }}>
                      {commissionText}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      ${minVal.toFixed(0)} - ${maxVal.toFixed(0)} USD
                    </td>
                    <td>
                      <span className={isOfferActive ? 'badge badge-green' : 'badge badge-muted'}>
                        {isOfferActive ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={isOfferActive ? 'btn-danger btn-xs' : 'btn-primary btn-xs'}
                        disabled={actionOfferId === offer.id}
                        onClick={() => handleToggleOffer(offer)}
                      >
                        {actionOfferId === offer.id ? '...' : isOfferActive ? 'Pause' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Offer Modal */}
      {showCreateModal && (
        <div className="studio-modal-backdrop">
          <div className="studio-modal-card">
            <div className="studio-modal-header">
              <div>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700 }}>
                  Publish New Offer
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Provide liquidity parameters for community gold trades or P2P funding.
                </p>
              </div>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              {errorMsg && (
                <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-danger)', color: '#ef4444', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div style={{ padding: '10px 14px', backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--status-success)', color: '#10b981', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                  {successMsg}
                </div>
              )}

              <form id="create-offer-form" onSubmit={handleCreateOffer}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Service Type
                  </label>
                  <select
                    className="input"
                    value={serviceType}
                    onChange={(e: any) => setServiceType(e.target.value)}
                  >
                    <option value="GOLD_TRADE">Gold Trade (Buy gold from community members)</option>
                    <option value="P2P_FUNDING">P2P Funding (Provide USD Wallet balance for Toman)</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Target Currency
                    </label>
                    <select
                      className="input"
                      value={targetCurrency}
                      onChange={(e: any) => setTargetCurrency(e.target.value)}
                    >
                      <option value="IRT">IRT (Toman Card / Sheba)</option>
                      <option value="USDT">USDT (Crypto BEP-20)</option>
                      <option value="USD_WALLET">G4X USD Wallet</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Direction
                    </label>
                    <select
                      className="input"
                      value={direction}
                      onChange={(e: any) => setDirection(e.target.value)}
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Commission Rate (basis points: 100 bps = 1.00%)
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={3000}
                      step={10}
                      value={commissionBps}
                      onChange={(e) => setCommissionBps(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-yellow)', minWidth: '80px', fontWeight: 600 }}>
                      {(commissionBps / 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Min Limit (USD Cents)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={100}
                      step={100}
                      value={minUsdCents}
                      onChange={(e) => setMinUsdCents(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      = ${(minUsdCents / 100).toFixed(2)} USD
                    </span>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Max Limit (USD Cents)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={100}
                      step={100}
                      value={maxUsdCents}
                      onChange={(e) => setMaxUsdCents(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      = ${(maxUsdCents / 100).toFixed(2)} USD
                    </span>
                  </div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Settlement Details / Bank Notes (Optional)
                  </label>
                  <input
                    className="input"
                    type="text"
                    value={settlementDetails}
                    onChange={(e) => setSettlementDetails(e.target.value)}
                    placeholder="e.g. Card/Sheba payment within 15 minutes of gold delivery"
                  />
                </div>
              </form>
            </div>

            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-offer-form"
                className="btn-cta"
                disabled={submitting}
              >
                {submitting ? 'Publishing...' : 'Publish Offer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
