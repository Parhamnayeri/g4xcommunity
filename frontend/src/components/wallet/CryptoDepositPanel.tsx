import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { RatesAndPoliciesData } from '../../types/wallet';
import { createWalletCryptoDepositIntent, cancelWalletDepositIntent } from '../../services/wallet';

interface CryptoDepositPanelProps {
  ratesAndPolicies: RatesAndPoliciesData;
  onDepositSuccess?: () => void;
}

export const CryptoDepositPanel: React.FC<CryptoDepositPanelProps> = ({
  ratesAndPolicies,
  onDepositSuccess,
}) => {
  const [amount, setAmount] = useState<string>('50');
  const [payCurrency, setPayCurrency] = useState<string>('USDTTRC20');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<{
    id: number;
    intentRef: string;
    amountUsd: number;
    payCurrency: string;
    invoiceUrl: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState<boolean>(false);

  const presets = [25, 50, 100, 250, 500];

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      setError('Deposit amount must be at least $1.00 USD.');
      return;
    }

    setLoading(true);
    try {
      const res = await createWalletCryptoDepositIntent(parsedAmount, payCurrency);
      if (res.success && res.invoiceUrl && res.deposit) {
        setActiveInvoice({
          id: res.deposit.id,
          intentRef: res.deposit.intentRef,
          amountUsd: res.deposit.amountUsd,
          payCurrency: res.deposit.payCurrency,
          invoiceUrl: res.invoiceUrl,
        });
        if (onDepositSuccess) {
          onDepositSuccess();
        }
      } else {
        setError(res.message || res.error || 'Failed to generate crypto invoice.');
      }
    } catch (err: any) {
      setError(err?.message || (typeof err === 'string' ? err : 'Unable to create crypto invoice.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelInvoice = async () => {
    if (!activeInvoice) return;
    setCancelling(true);
    try {
      await cancelWalletDepositIntent(activeInvoice.id);
      setActiveInvoice(null);
      if (onDepositSuccess) {
        onDepositSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel invoice.');
    } finally {
      setCancelling(false);
    }
  };

  const isLive = ratesAndPolicies.cryptoLiveCollectionEnabled;

  return (
    <Card style={{ padding: '1.75rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
              Cryptocurrency Deposit Rail (NOWPayments)
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Automated invoice generation for USDT (TRC-20 &amp; BEP-20), Bitcoin, and Ethereum.
            </p>
          </div>
          <span
            className={isLive ? 'badge badge-lime' : 'badge badge-gray'}
            style={{ fontSize: '0.7rem' }}
          >
            {isLive ? '● Live Gateway Active' : '○ Collection Inactive'}
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
          }}
        >
          {error}
        </div>
      )}

      {/* When Live Collection is Enabled */}
      {isLive ? (
        <div>
          {activeInvoice ? (
            /* Active Invoice Display */
            <div
              style={{
                padding: '1.75rem',
                backgroundColor: 'rgba(204, 255, 0, 0.04)',
                border: '1px solid rgba(204, 255, 0, 0.3)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>⚡</span>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      Invoice Generated: #{activeInvoice.intentRef}
                    </h4>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Amount: ${activeInvoice.amountUsd.toFixed(2)} USD ({activeInvoice.payCurrency})
                    </span>
                  </div>
                </div>
                <span className="badge badge-amber" style={{ fontSize: '0.75rem' }}>
                  Waiting for Payment
                </span>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                Please click the button below to open the official NOWPayments secure payment portal. Your wallet balance will be credited automatically upon blockchain confirmation.
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <a
                  href={activeInvoice.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--accent-lime, #ccff00)',
                    color: '#000',
                    fontWeight: 800,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.65rem 1.4rem',
                  }}
                >
                  Pay via NOWPayments Portal ↗
                </a>

                <button
                  type="button"
                  onClick={handleCancelInvoice}
                  disabled={cancelling}
                  className="btn btn-outline btn-sm"
                  style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Invoice'}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveInvoice(null)}
                  className="btn btn-outline btn-sm"
                >
                  Create Another Invoice
                </button>
              </div>
            </div>
          ) : (
            /* Live Deposit Creation Form */
            <form onSubmit={handleGenerateInvoice} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Select Preset Deposit Amount (USD)
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {presets.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmount(String(val))}
                      className={amount === String(val) ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                      style={{
                        minWidth: '65px',
                        fontWeight: 700,
                        backgroundColor: amount === String(val) ? 'var(--accent-lime)' : undefined,
                        color: amount === String(val) ? '#000' : undefined,
                      }}
                    >
                      ${val}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700 }}>
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="Enter custom USD amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={loading}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem 0.75rem 2.2rem',
                      backgroundColor: 'rgba(0, 0, 0, 0.35)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '1rem',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Payment Currency / Network
                </label>
                <select
                  value={payCurrency}
                  onChange={(e) => setPayCurrency(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    backgroundColor: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                >
                  <option value="USDTTRC20">USDT (TRON / TRC-20) — Recommended (Fast &amp; Low Fees)</option>
                  <option value="USDTBSC">USDT (BNB Smart Chain / BEP-20)</option>
                  <option value="BTC">Bitcoin (BTC)</option>
                  <option value="ETH">Ethereum (ETH)</option>
                  <option value="LTC">Litecoin (LTC)</option>
                  <option value="TRX">TRON (TRX)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--accent-lime, #ccff00)',
                    color: '#000',
                    fontWeight: 800,
                    padding: '0.75rem 1.75rem',
                  }}
                >
                  {loading ? 'Generating Invoice...' : 'Generate NOWPayments Invoice ⚡'}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        /* Disabled / Fail-Closed Notice State */
        <div
          style={{
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            backgroundColor: 'var(--bg-main)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: 'rgba(124, 58, 237, 0.15)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
            }}
          >
            🔒
          </div>

          <div style={{ maxWidth: '520px' }}>
            <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
              Automated Crypto Deposits Temporarily Unavailable
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              In strict compliance with G4X financial safety policy, live cryptocurrency invoice and address creation is
              currently disabled (<code style={{ color: 'var(--text-primary)', fontSize: '0.78rem' }}>NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false</code>).
              No external deposit addresses or invoices will be issued until authorized by management.
            </p>
          </div>

          <div
            style={{
              marginTop: '0.5rem',
              padding: '0.75rem 1.25rem',
              backgroundColor: 'rgba(24, 21, 36, 0.8)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>💡</span>
            <span>
              Please use the <strong>Manual IRT Bank Transfer (کارت به کارت)</strong> method above to fund your wallet, or contact financial management.
            </span>
          </div>

          {/* Feature Gate Safeguard Badges */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
            <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
              NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false
            </span>
            <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
              FINANCE_V2_LIVE_CREDITS_ENABLED=false
            </span>
            <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
              Zero Exposure of Provider Secrets
            </span>
          </div>
        </div>
      )}
    </Card>
  );
};
