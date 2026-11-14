import React, { useState, useEffect } from 'react';
import { ExchangerOffer, P2pFundingQuote } from '../../types/exchange';
import { requestP2pFundingQuote, acceptP2pFundingQuote } from '../../services/exchange';


interface P2pFundingModalProps {
  initialOffer?: ExchangerOffer | null;
  onClose?: () => void;
  onFundingCreated?: (fundingRequest: any) => void;
}

export const P2pFundingModal: React.FC<P2pFundingModalProps> = ({
  initialOffer,
  onClose,
  onFundingCreated,
}) => {
  const [exchangerId, setExchangerId] = useState<string>(initialOffer?.exchangerId || '');
  const [offerId, setOfferId] = useState<string>(initialOffer?.id ? String(initialOffer.id) : '');
  const [targetUsd, setTargetUsd] = useState<string>('50.00');

  const [loadingQuote, setLoadingQuote] = useState<boolean>(false);
  const [acceptingQuote, setAcceptingQuote] = useState<boolean>(false);
  const [quote, setQuote] = useState<P2pFundingQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedFunding, setConfirmedFunding] = useState<any | null>(null);

  useEffect(() => {
    if (initialOffer) {
      setExchangerId(initialOffer.exchangerId);
      setOfferId(String(initialOffer.id));
    }
  }, [initialOffer]);

  const handleRequestQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setQuote(null);
    setConfirmedFunding(null);

    const targetCents = Math.round(parseFloat(targetUsd) * 100);
    if (isNaN(targetCents) || targetCents <= 0) {
      setError('Please enter a valid positive target USD amount.');
      return;
    }
    const offId = parseInt(offerId, 10);
    if (isNaN(offId) || offId <= 0) {
      setError('A valid Exchanger published Offer ID is required.');
      return;
    }
    if (!exchangerId.trim()) {
      setError('Exchanger Discord ID is required.');
      return;
    }

    setLoadingQuote(true);
    try {
      const res = await requestP2pFundingQuote({
        exchangerId: exchangerId.trim(),
        offerId: offId,
        targetUsdCents: targetCents,
      });
      if (res.success) {
        setQuote(res.quote);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to calculate P2P funding quote.');
    } finally {
      setLoadingQuote(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!quote) return;
    setError(null);
    setAcceptingQuote(true);
    try {
      const res = await acceptP2pFundingQuote(quote);
      if (res.success) {
        setConfirmedFunding(res.fundingRequest);
        if (onFundingCreated) onFundingCreated(res.fundingRequest);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to accept P2P funding quote.');
    } finally {
      setAcceptingQuote(false);
    }
  };

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal-card studio-modal-card-lg">
        <div className="studio-modal-header">
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              P2P IRT-to-USD Wallet Funding (Workflow C)
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Fund your Unified USD Wallet with Tomans through verified peer Exchangers backed by pre-reserved USD collateral.
            </p>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="studio-modal-close">
              ✕
            </button>
          )}
        </div>

        <div className="studio-modal-body">
          {/* Security Invariant Alert */}
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.5rem',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--accent-yellow)' }}>Security &amp; Accounting Invariant:</strong>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)' }}>
              External Toman payments alone <strong>never</strong> mint synthetic USD credits. The Exchanger must have verified USD balance in G4X which is reserved atomically before transfer.
            </p>
          </div>

          {error && (
            <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-danger)', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              {error}
            </div>
          )}

          {/* Confirmed Funding Result */}
          {confirmedFunding ? (
            <div
              style={{
                padding: '1.5rem',
                backgroundColor: 'rgba(250, 204, 21, 0.08)',
                border: '1px solid var(--accent-yellow)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
              <h3 style={{ color: 'var(--accent-yellow)', fontWeight: 800, fontSize: '1.3rem', margin: 0 }}>
                P2P Funding Request Created &amp; Exchanger USD Reserved!
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Funding Reference: <code style={{ color: '#fff', fontWeight: 700 }}>{confirmedFunding.fundingRef}</code>
              </p>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: '0.75rem' }}>
                Status: <strong>{confirmedFunding.status}</strong> | Target USD: <strong>${(confirmedFunding.targetUsdCents / 100).toFixed(2)}</strong>
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--accent-yellow)', marginTop: '0.25rem' }}>
                Total IRT Payable: <strong>{Number(confirmedFunding.externalAmountUnits).toLocaleString()} Toman</strong>
              </p>
              <div style={{ marginTop: '1.25rem', padding: '1rem', backgroundColor: 'rgba(13, 11, 18, 0.6)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', textAlign: 'left' }}>
                <strong>Next Steps:</strong>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)' }}>
                  Transfer the exact Toman amount to the verified Exchanger using the contact details agreed upon, and provide your payment proof. Exchanger USD funds remain locked in escrow until verified.
                </p>
              </div>
              <div style={{ marginTop: '1.25rem' }}>
                <button type="button" className="btn-secondary" onClick={() => { setConfirmedFunding(null); setQuote(null); }}>
                  Create Another Funding Request
                </button>
              </div>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleRequestQuote}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Exchanger Discord ID *
                  </label>
                  <input
                    type="text"
                    value={exchangerId}
                    onChange={(e) => setExchangerId(e.target.value)}
                    placeholder="Exchanger User ID"
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Exchanger Offer # ID *
                  </label>
                  <input
                    type="number"
                    value={offerId}
                    onChange={(e) => setOfferId(e.target.value)}
                    placeholder="Offer ID number"
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Target USD Funding ($) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={targetUsd}
                    onChange={(e) => setTargetUsd(e.target.value)}
                    placeholder="e.g. 50.00"
                    className="input"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button className="btn-cta" type="submit" disabled={loadingQuote}>
                  {loadingQuote ? 'Calculating Quote...' : 'Calculate P2P Funding Quote'}
                </button>
              </div>
            </form>
          )}

          {/* Quote Preview */}
          {quote && !confirmedFunding && (
            <div
              style={{
                marginTop: '1.5rem',
                padding: '1.5rem',
                backgroundColor: 'rgba(24, 27, 36, 0.95)',
                border: '1px solid var(--accent-yellow)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span className="badge badge-amber" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
                    P2P Indicative Quote
                  </span>
                  <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{quote.quoteRef}</code>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Expires: {new Date(quote.expiresAt).toLocaleTimeString()}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 15, 21, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target USD Cents</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    ${(quote.targetUsdCents / 100).toFixed(2)} USD
                  </div>
                </div>

                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 15, 21, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Admin Reference Rate</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                    {quote.referenceRate.toLocaleString()} Toman / USD
                  </div>
                </div>

                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 15, 21, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Exchanger Commission</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent-yellow)' }}>
                    {(quote.commissionPercentage * 100).toFixed(2)}% ({quote.commissionIrt.toLocaleString()} Toman)
                  </div>
                </div>

                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 15, 21, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Payable Toman</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-yellow)' }}>
                    {quote.totalIrtPayable.toLocaleString()} Toman
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-cta"
                  onClick={handleAcceptQuote}
                  disabled={acceptingQuote}
                >
                  {acceptingQuote ? 'Reserving USD Collateral...' : 'Accept Quote & Reserve USD from Exchanger'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setQuote(null)}>
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
