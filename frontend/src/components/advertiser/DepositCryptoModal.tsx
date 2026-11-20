import React, { useState } from 'react';
import { createDepositIntent } from '../../services/advertiser';
import { DepositIntent } from '../../types/advertiser';

interface DepositCryptoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (deposit: DepositIntent) => void;
}

const PRESET_AMOUNTS = [25, 50, 100, 250, 500];

const SUPPORTED_CURRENCIES = [
  { code: 'usdttrc20', label: 'USDT (TRC20 - Tron)', icon: '🟢' },
  { code: 'usdtbsc', label: 'USDT (BEP20 - Binance Smart Chain)', icon: '🟡' },
  { code: 'usdterc20', label: 'USDT (ERC20 - Ethereum)', icon: '🔷' },
  { code: 'usdc', label: 'USDC (USD Coin)', icon: '🔵' },
  { code: 'btc', label: 'Bitcoin (BTC)', icon: '₿' },
  { code: 'eth', label: 'Ethereum (ETH)', icon: 'Ξ' },
  { code: 'ltc', label: 'Litecoin (LTC)', icon: 'Ł' },
];

export const DepositCryptoModal: React.FC<DepositCryptoModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [amountUsd, setAmountUsd] = useState<number | string>(100);
  const [payCurrency, setPayCurrency] = useState('usdttrc20');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositResult, setDepositResult] = useState<{
    deposit: DepositIntent;
    instructions: { message: string; invoiceUrl?: string | null; payCurrency: string; amountUsd: number; provider: string };
  } | null>(null);

  if (!isOpen) return null;

  const handleCreateIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = typeof amountUsd === 'number' ? amountUsd : parseFloat(amountUsd);
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      setError('Minimum deposit amount is $1.00 USD.');
      return;
    }

    setLoading(true);
    try {
      const res = await createDepositIntent(parsedAmount, payCurrency);
      setDepositResult(res);
      onSuccess(res.deposit);
    } catch (err: any) {
      setError(err.message || 'Failed to create deposit intent.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDepositResult(null);
    setError(null);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 4, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          borderRadius: '16px',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          maxWidth: '540px',
          width: '100%',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(24, 21, 36, 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.25rem' }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f4f4f6' }}>
              Top Up Wallet (Crypto / NOWPayments)
            </h3>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #9490a6)',
              fontSize: '1.25rem',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}

          {!depositResult ? (
            <form onSubmit={handleCreateIntent} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Preset Amounts */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Quick Select Amount (USD)
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {PRESET_AMOUNTS.map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      onClick={() => setAmountUsd(amt)}
                      style={{
                        padding: '0.45rem 0.9rem',
                        borderRadius: '8px',
                        border: Number(amountUsd) === amt ? '1px solid var(--accent-lime, #ccff00)' : '1px solid rgba(124, 58, 237, 0.3)',
                        backgroundColor: Number(amountUsd) === amt ? 'rgba(204, 255, 0, 0.15)' : 'rgba(35, 30, 52, 0.6)',
                        color: Number(amountUsd) === amt ? 'var(--accent-lime, #ccff00)' : '#f4f4f6',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Amount */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Amount in USD ($)
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '1rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--accent-lime, #ccff00)',
                      fontWeight: 800,
                    }}
                  >
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amountUsd}
                    onChange={(e) => setAmountUsd(e.target.value)}
                    placeholder="100.00"
                    required
                    style={{
                      width: '100%',
                      padding: '0.65rem 1rem 0.65rem 2.2rem',
                      backgroundColor: 'rgba(13, 11, 18, 0.8)',
                      border: '1px solid rgba(124, 58, 237, 0.4)',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '1rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Payment Currency */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Payment Cryptocurrency
                </label>
                <select
                  value={payCurrency}
                  onChange={(e) => setPayCurrency(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                  }}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.icon} {c.label}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem', display: 'block' }}>
                  Processed securely via NOWPayments gateway. Instant confirmation via IPN webhook.
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    padding: '0.6rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(148, 144, 166, 0.3)',
                    backgroundColor: 'transparent',
                    color: '#9490a6',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '0.6rem 1.5rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'var(--accent-lime, #ccff00)',
                    color: '#0d0b12',
                    fontWeight: 800,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {loading ? 'Generating Invoice...' : 'Generate Crypto Invoice'}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  backgroundColor: 'rgba(204, 255, 0, 0.1)',
                  border: '1px solid rgba(204, 255, 0, 0.35)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>🎉</span>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent-lime, #ccff00)', fontSize: '1.1rem' }}>
                  Deposit Invoice Ready!
                </h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#f4f4f6' }}>
                  {depositResult.instructions.message}
                </p>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(13, 11, 18, 0.7)',
                  borderRadius: '10px',
                  border: '1px solid rgba(124, 58, 237, 0.25)',
                  padding: '1rem',
                  fontSize: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9490a6' }}>Deposit Reference:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ffffff' }}>
                    {depositResult.deposit.intentRef}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9490a6' }}>Amount:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-lime, #ccff00)' }}>
                    ${Number(depositResult.deposit.amountUsd).toFixed(2)} USD
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9490a6' }}>Pay Currency:</span>
                  <span style={{ fontFamily: 'monospace', textTransform: 'uppercase', color: '#c4b5fd' }}>
                    {depositResult.deposit.payCurrency}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9490a6' }}>Status:</span>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>
                    ⏳ Awaiting Payment Confirmation
                  </span>
                </div>
              </div>

              {depositResult.deposit.invoiceUrl && (
                <a
                  href={depositResult.deposit.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '0.75rem',
                    backgroundColor: 'var(--accent-lime, #ccff00)',
                    color: '#0d0b12',
                    borderRadius: '8px',
                    textAlign: 'center',
                    fontWeight: 800,
                    textDecoration: 'none',
                    display: 'block',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Open NOWPayments Payment Portal ↗
                </a>
              )}

              <button
                onClick={handleClose}
                style={{
                  padding: '0.65rem',
                  backgroundColor: 'rgba(124, 58, 237, 0.2)',
                  border: '1px solid rgba(124, 58, 237, 0.4)',
                  color: '#ffffff',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
