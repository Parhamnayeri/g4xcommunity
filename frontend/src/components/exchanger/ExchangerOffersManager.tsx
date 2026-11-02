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
  const [actionOfferId, setActionOfferId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleToggleOffer = async (offer: ExchangerOffer) => {
    setActionOfferId(offer.id);
    setErrorMsg(null);
    try {
      await updateExchangerOffer(offer.id, { isActive: !offer.isActive });
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
      let parsedSettlement = undefined;
      if (settlementDetails.trim()) {
        try {
          parsedSettlement = JSON.parse(settlementDetails.trim());
        } catch {
          parsedSettlement = { info: settlementDetails.trim() };
        }
      }

      await createExchangerOffer({
        serviceType,
        direction,
        targetCurrency,
        commissionRateBps: Number(commissionBps),
        minAmountUsdCents: Number(minUsdCents),
        maxAmountUsdCents: Number(maxUsdCents),
        settlementDetails: parsedSettlement,
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
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
          You have not published any offers yet. Click "+ Create New Offer" to list your liquidity.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 8px' }}>Service Type</th>
                <th style={{ padding: '12px 8px' }}>Target Currency</th>
                <th style={{ padding: '12px 8px' }}>Direction</th>
                <th style={{ padding: '12px 8px' }}>Commission Rate</th>
                <th style={{ padding: '12px 8px' }}>Min / Max Limit</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {offer.serviceType === 'GOLD_TRADE' ? 'Gold Trade' : 'P2P Funding'}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        backgroundColor:
                          offer.targetCurrency === 'IRT'
                            ? 'rgba(204, 255, 0, 0.15)'
                            : offer.targetCurrency === 'USD_WALLET'
                            ? 'rgba(124, 58, 237, 0.2)'
                            : 'rgba(56, 189, 248, 0.2)',
                        color:
                          offer.targetCurrency === 'IRT'
                            ? 'var(--accent-lime)'
                            : offer.targetCurrency === 'USD_WALLET'
                            ? 'var(--primary-purple)'
                            : '#38bdf8',
                      }}
                    >
                      {offer.targetCurrency}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {offer.direction}
                  </td>
                  <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--accent-lime)' }}>
                    {(offer.commissionRateBps / 100).toFixed(2)}%
                  </td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    ${(offer.minAmountUsdCents / 100).toFixed(0)} - ${(offer.maxAmountUsdCents / 100).toFixed(0)} USD
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: offer.isActive ? '#10b981' : '#6b7280',
                        marginRight: '6px',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: offer.isActive ? '#10b981' : '#6b7280' }}>
                      {offer.isActive ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <button
                      disabled={actionOfferId === offer.id}
                      onClick={() => handleToggleOffer(offer)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: offer.isActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        color: offer.isActive ? '#ef4444' : '#10b981',
                        border: `1px solid ${offer.isActive ? '#ef4444' : '#10b981'}`,
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        cursor: actionOfferId === offer.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {actionOfferId === offer.id ? '...' : offer.isActive ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Offer Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '520px',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Publish New Offer</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div style={{ padding: '10px 14px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                {successMsg}
              </div>
            )}

            <form onSubmit={handleCreateOffer}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Service Type
                </label>
                <select
                  value={serviceType}
                  onChange={(e: any) => setServiceType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                  }}
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
                    value={targetCurrency}
                    onChange={(e: any) => setTargetCurrency(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                    }}
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
                    value={direction}
                    onChange={(e: any) => setDirection(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                    }}
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
                    type="number"
                    min={0}
                    max={3000}
                    step={10}
                    value={commissionBps}
                    onChange={(e) => setCommissionBps(Number(e.target.value))}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                    }}
                  />
                  <span style={{ fontSize: '0.9rem', color: 'var(--accent-lime)', minWidth: '80px', fontWeight: 600 }}>
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
                    type="number"
                    min={100}
                    step={100}
                    value={minUsdCents}
                    onChange={(e) => setMinUsdCents(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    = ${(minUsdCents / 100).toFixed(2)} USD
                  </span>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Max Limit (USD Cents)
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={maxUsdCents}
                    onChange={(e) => setMaxUsdCents(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    = ${(maxUsdCents / 100).toFixed(2)} USD
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Settlement Details / Bank Notes (Optional)
                </label>
                <input
                  type="text"
                  value={settlementDetails}
                  onChange={(e) => setSettlementDetails(e.target.value)}
                  placeholder="e.g. Card/Sheba payment within 15 minutes of gold delivery"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submitting}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'var(--primary-purple)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  {submitting ? 'Publishing...' : 'Publish Offer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
