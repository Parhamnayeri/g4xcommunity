import React, { useState, useEffect } from 'react';
import { ExchangerOffer, GoldTradeQuote, GoldTrade } from '../../types/exchange';
import { requestGoldTradeQuote, acceptGoldTradeQuote } from '../../services/exchange';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface SellGoldModalProps {
  initialOffer?: ExchangerOffer | null;
  onClose?: () => void;
  onTradeCreated: (trade: GoldTrade) => void;
}

export const SellGoldModal: React.FC<SellGoldModalProps> = ({
  initialOffer,
  onClose,
  onTradeCreated,
}) => {
  const [buyerId, setBuyerId] = useState<string>(initialOffer?.exchangerId || '');
  const [offerId, setOfferId] = useState<number | undefined>(initialOffer?.id);
  const [gameSlug, setGameSlug] = useState<string>('wow_midnight');
  const [region, setRegion] = useState<string>('EU');
  const [realm, setRealm] = useState<string>('Tarren Mill');
  const [faction, setFaction] = useState<string>('Horde');
  const [goldQuantity, setGoldQuantity] = useState<number>(1000000);
  const [valuationUsd, setValuationUsd] = useState<string>('80.00');
  const [settlementMethod, setSettlementMethod] = useState<string>('IRT_DIRECT');

  const [loadingQuote, setLoadingQuote] = useState<boolean>(false);
  const [acceptingQuote, setAcceptingQuote] = useState<boolean>(false);
  const [quote, setQuote] = useState<GoldTradeQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedTrade, setConfirmedTrade] = useState<GoldTrade | null>(null);

  useEffect(() => {
    if (initialOffer) {
      setBuyerId(initialOffer.exchangerId);
      setOfferId(initialOffer.id);
      if (initialOffer.settlementCurrency === 'USDT') {
        setSettlementMethod('USDT_DIRECT');
      } else if (initialOffer.settlementCurrency === 'USD') {
        setSettlementMethod('USD_WALLET');
      } else {
        setSettlementMethod('IRT_DIRECT');
      }
    }
  }, [initialOffer]);

  const handleRequestQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setQuote(null);
    setConfirmedTrade(null);

    const valCents = Math.round(parseFloat(valuationUsd) * 100);
    if (isNaN(valCents) || valCents <= 0) {
      setError('Please enter a valid positive agreed USD valuation.');
      return;
    }
    if (!buyerId.trim()) {
      setError('Buyer (Exchanger Discord ID) is required.');
      return;
    }
    if (goldQuantity <= 0) {
      setError('Gold quantity must be a positive number.');
      return;
    }

    setLoadingQuote(true);
    try {
      const res = await requestGoldTradeQuote({
        buyerId: buyerId.trim(),
        offerId,
        gameSlug,
        region,
        realm,
        faction,
        goldQuantity,
        agreedValuationUsdCents: valCents,
        settlementMethod,
      });
      if (res.success) {
        setQuote(res.quote);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to calculate quote.');
    } finally {
      setLoadingQuote(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!quote) return;
    setError(null);
    setAcceptingQuote(true);
    try {
      const res = await acceptGoldTradeQuote(quote);
      if (res.success) {
        setConfirmedTrade(res.trade);
        onTradeCreated(res.trade);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to accept trade quote.');
    } finally {
      setAcceptingQuote(false);
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--bg-surface)', padding: '1.75rem', marginBottom: '1.5rem', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Sell In-Game Gold (Workflows A &amp; B)
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem', marginBottom: 0 }}>
            Trade your in-game gold to an approved Exchanger buyer with server-side rate authority and escrow protection.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn btn-outline btn-sm" style={{ padding: '0.25rem 0.5rem' }}>
            ✕ Close
          </button>
        )}
      </div>

      {/* Explanation Banner */}
      <div
        style={{
          padding: '1rem',
          backgroundColor: 'rgba(124, 58, 237, 0.1)',
          border: '1px solid rgba(124, 58, 237, 0.3)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: 'var(--accent-lime)' }}>Domain Rules &amp; Settlement Routes:</strong>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', color: 'var(--text-muted)' }}>
          <li>
            <strong style={{ color: 'var(--text-primary)' }}>Workflow A (Direct External Payout):</strong> Exchanger pays directly to your Iranian Bank Card (IRT) or BEP-20 Wallet (USDT). No balance is minted into your G4X wallet.
          </li>
          <li>
            <strong style={{ color: 'var(--text-primary)' }}>Workflow B (Prepaid USD Wallet):</strong> Exchanger's pre-funded G4X USD Wallet is reserved and transferred atomically to your account upon verified gold delivery.
          </li>
          <li>
            <strong style={{ color: 'var(--text-primary)' }}>Direction Rule:</strong> You are the verified <span style={{ color: '#fff' }}>Seller</span>; the Exchanger is the verified <span style={{ color: '#fff' }}>Buyer</span>.
          </li>
        </ul>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-danger)', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
          {error}
        </div>
      )}

      {/* Confirmed Trade Result */}
      {confirmedTrade ? (
        <div
          style={{
            padding: '1.5rem',
            backgroundColor: 'rgba(204, 255, 0, 0.08)',
            border: '1px solid var(--accent-lime)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
          <h3 style={{ color: 'var(--accent-lime)', fontWeight: 800, fontSize: '1.3rem', margin: 0 }}>
            Gold Trade Order Confirmed!
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Trade Reference: <code style={{ color: '#fff', fontWeight: 700 }}>{confirmedTrade.tradeRef}</code>
          </p>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: '0.75rem' }}>
            Initial Status: <strong>{confirmedTrade.tradeStatus}</strong> | Route: <strong>{confirmedTrade.settlementMethod}</strong>
          </p>
          {confirmedTrade.walletReservationId && (
            <p style={{ fontSize: '0.8rem', color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
              Exchanger USD Wallet Reservation: <code>{confirmedTrade.walletReservationId}</code>
            </p>
          )}
          <div style={{ marginTop: '1.25rem', padding: '1rem', backgroundColor: 'rgba(13, 11, 18, 0.6)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', textAlign: 'left' }}>
            <strong>Next Steps:</strong>
            <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.25rem', color: 'var(--text-muted)' }}>
              <li>Deliver the agreed <strong>{confirmedTrade.goldQuantity.toLocaleString()} gold</strong> in-game to the buyer.</li>
              <li>Go to the <em>My Trade History</em> tab below and click <strong>Report Delivery</strong> with screenshot/chat proof.</li>
              <li>Once the Exchanger verifies gold and submits external payment, confirm receipt to conclude the trade.</li>
            </ol>
          </div>
          <div style={{ marginTop: '1.25rem' }}>
            <Button variant="outline" size="sm" onClick={() => { setConfirmedTrade(null); setQuote(null); }}>
              Create Another Trade
            </Button>
          </div>
        </div>
      ) : (
        /* Form */
        <form onSubmit={handleRequestQuote}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Exchanger Discord ID (Buyer) *
              </label>
              <input
                type="text"
                value={buyerId}
                onChange={(e) => setBuyerId(e.target.value)}
                placeholder="e.g. 123456789012345678"
                className="form-control"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Game Title
              </label>
              <select value={gameSlug} onChange={(e) => setGameSlug(e.target.value)} className="form-control">
                <option value="wow_midnight">World of Warcraft: Midnight</option>
                <option value="wow_classic_tbc">WoW Classic TBC</option>
                <option value="wow_classic_era">WoW Classic Era</option>
                <option value="poe2">Path of Exile 2</option>
                <option value="aion_2">Aion 2</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Region &amp; Realm
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select value={region} onChange={(e) => setRegion(e.target.value)} className="form-control" style={{ width: '40%' }}>
                  <option value="EU">EU</option>
                  <option value="US">US</option>
                </select>
                <input
                  type="text"
                  value={realm}
                  onChange={(e) => setRealm(e.target.value)}
                  placeholder="Realm name"
                  className="form-control"
                  style={{ width: '60%' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Faction
              </label>
              <select value={faction} onChange={(e) => setFaction(e.target.value)} className="form-control">
                <option value="Horde">Horde</option>
                <option value="Alliance">Alliance</option>
                <option value="Neutral">Neutral</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Gold Quantity (Units) *
              </label>
              <input
                type="number"
                value={goldQuantity}
                onChange={(e) => setGoldQuantity(Math.max(1, parseInt(e.target.value, 10) || 0))}
                placeholder="e.g. 1,000,000"
                className="form-control"
                min="1"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Agreed Valuation ($ USD) *
              </label>
              <input
                type="number"
                step="0.01"
                value={valuationUsd}
                onChange={(e) => setValuationUsd(e.target.value)}
                placeholder="e.g. 80.00"
                className="form-control"
                min="0.01"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
                Settlement Method *
              </label>
              <select
                value={settlementMethod}
                onChange={(e) => setSettlementMethod(e.target.value)}
                className="form-control"
              >
                <option value="IRT_DIRECT">External Direct IRT Card/Bank (Workflow A)</option>
                <option value="USDT_DIRECT">External Direct USDT BEP-20 (Workflow A)</option>
                <option value="USD_WALLET">Exchanger Prepaid USD Wallet (Workflow B)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Button variant="purple" size="md" type="submit" disabled={loadingQuote}>
              {loadingQuote ? 'Generating Authoritative Quote...' : 'Generate Cryptographic Quote'}
            </Button>
          </div>
        </form>
      )}

      {/* Quote Preview Card (Indicative vs Confirmed) */}
      {quote && !confirmedTrade && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1.5rem',
            backgroundColor: 'rgba(24, 21, 36, 0.9)',
            border: '1px solid var(--primary-purple)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span className="badge badge-amber" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
                Indicative Quote (Not Yet Confirmed)
              </span>
              <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{quote.tradeRef}</code>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Expires: {new Date(quote.expiresAt).toLocaleTimeString()}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 11, 18, 0.5)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Agreed USD Valuation</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                ${(quote.agreedValuationUsdCents / 100).toFixed(2)} USD
              </div>
            </div>

            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 11, 18, 0.5)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Net Payable Amount</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-lime)' }}>
                {quote.quotedPayableAmount} {quote.quotedPayableCurrency}
              </div>
            </div>

            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 11, 18, 0.5)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Exchanger Commission</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                {(quote.commissionPercentage * 100).toFixed(2)}% ({quote.commissionAmount} {quote.quotedPayableCurrency})
              </div>
            </div>

            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(13, 11, 18, 0.5)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Settlement Method</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {quote.settlementMethod}
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.25rem', fontFamily: 'monospace' }}>
            Anti-Tamper Hash: {quote.quoteHash}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Button
              variant="lime"
              size="md"
              onClick={handleAcceptQuote}
              disabled={acceptingQuote}
            >
              {acceptingQuote ? 'Locking Trade & Contract...' : 'Accept Quote & Confirm Financial Commitment'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuote(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
