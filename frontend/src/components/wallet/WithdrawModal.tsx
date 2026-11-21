import React, { useState, useEffect } from 'react';
import { submitWalletWithdrawal } from '../../services/wallet';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableUsd: string;
  isFrozen?: boolean;
  frozenUsd?: string;
  defaultPayoutAddress?: string | null;
  defaultPayoutMethod?: string | null;
  onSuccess: (message: string) => void;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  availableUsd,
  isFrozen = false,
  frozenUsd = '0.00',
  defaultPayoutAddress = '',
  defaultPayoutMethod = 'USDT_BEP20',
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [destinationAddress, setDestinationAddress] = useState<string>(defaultPayoutAddress || '');
  const [payoutMethod, setPayoutMethod] = useState<'USDT_BEP20' | 'USDT_TRC20' | 'IRT_BANK'>('USDT_BEP20');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultPayoutAddress) {
      setDestinationAddress(defaultPayoutAddress);
    }
  }, [defaultPayoutAddress]);

  useEffect(() => {
    if (defaultPayoutMethod) {
      if (['USDT_BEP20', 'USDT_TRC20', 'IRT_BANK'].includes(defaultPayoutMethod)) {
        setPayoutMethod(defaultPayoutMethod as any);
      }
    }
  }, [defaultPayoutMethod]);

  if (!isOpen) return null;

  const availableFloat = parseFloat(availableUsd) || 0;

  const handleMaxClick = () => {
    setAmount(availableFloat.toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isFrozen) {
      setError('Your wallet is currently frozen or under administrative hold. Withdrawals are disabled.');
      return;
    }

    const withdrawFloat = parseFloat(amount);
    if (isNaN(withdrawFloat) || withdrawFloat < 1) {
      setError('Minimum withdrawal amount is $1.00 USD.');
      return;
    }

    if (withdrawFloat > availableFloat) {
      setError(`Requested amount ($${withdrawFloat.toFixed(2)}) exceeds your available balance ($${availableFloat.toFixed(2)}).`);
      return;
    }

    if (!destinationAddress.trim()) {
      setError('Please provide a valid destination payout address or bank IBAN/Card.');
      return;
    }

    setLoading(true);
    try {
      const res = await submitWalletWithdrawal({
        amountUsd: withdrawFloat,
        payoutMethod,
        payoutAddress: destinationAddress.trim(),
        notes: notes.trim() || undefined,
      });

      const ref = res?.withdrawal?.ref || 'REQUESTED';
      onSuccess(`Withdrawal of $${withdrawFloat.toFixed(2)} requested successfully (Ref: ${ref}).`);
      onClose();
    } catch (err: any) {
      setError(err?.message || (typeof err === 'string' ? err : 'Failed to submit withdrawal request.'));
    } finally {
      setLoading(false);
    }
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
        className="studio-modal-card"
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          borderRadius: '16px',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          maxWidth: '520px',
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
            borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.4rem' }}>💸</span>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary, #fff)', margin: 0 }}>
                Withdraw Wallet Funds
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', margin: 0 }}>
                Transfer spendable funds to your crypto wallet or bank account.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #94a3b8)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {error && (
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}

          {isFrozen && (
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fbbf24',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>⚠️</span>
              <span>
                Your account balance is currently on hold (${frozenUsd} USD). Withdrawals are disabled until administrative review is complete.
              </span>
            </div>
          )}

          {/* Available Balance Banner */}
          <div
            style={{
              padding: '0.9rem 1.1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(204, 255, 0, 0.05)',
              border: '1px solid rgba(204, 255, 0, 0.25)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Available Liquid Balance
              </span>
              <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-lime, #ccff00)', marginTop: '0.1rem' }}>
                ${availableUsd} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 500 }}>USD</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleMaxClick}
              disabled={isFrozen || availableFloat <= 0}
              className="btn btn-outline btn-xs"
              style={{
                borderColor: 'var(--accent-lime, #ccff00)',
                color: 'var(--accent-lime, #ccff00)',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.3rem 0.65rem',
              }}
            >
              Max
            </button>
          </div>

          {/* Amount Input */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary, #fff)', marginBottom: '0.4rem' }}>
              Withdrawal Amount (USD) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #94a3b8)', fontWeight: 700 }}>
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                max={availableFloat}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading || isFrozen}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.2rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '1rem',
                  outline: 'none',
                }}
              />
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', marginTop: '0.3rem', display: 'block' }}>
              Minimum withdrawal: $1.00 USD. Funds will be held in escrow upon submission.
            </span>
          </div>

          {/* Payout Method */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary, #fff)', marginBottom: '0.4rem' }}>
              Payout Method / Network <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value as any)}
              disabled={loading || isFrozen}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            >
              <option value="USDT_BEP20">USDT (BNB Smart Chain / BEP-20) — $0.30 fixed fee</option>
              <option value="USDT_TRC20">USDT (TRON / TRC-20) — $0.30 fixed fee</option>
              <option value="IRT_BANK">IRT Bank Card / Shaba (کارت به کارت / شبا) — $1.00 fixed fee</option>
            </select>
          </div>

          {/* Destination Address / Account */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary, #fff)', marginBottom: '0.4rem' }}>
              {payoutMethod === 'IRT_BANK' ? 'Destination IBAN (شبا) or Card Number' : 'Destination Crypto Wallet Address'} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              placeholder={
                payoutMethod === 'IRT_BANK'
                  ? 'IR000000000000000000000000 or 16-digit Card'
                  : payoutMethod === 'USDT_TRC20'
                  ? 'T...'
                  : '0x...'
              }
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              disabled={loading || isFrozen}
              required
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Notes (Optional) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted, #94a3b8)', marginBottom: '0.4rem' }}>
              Notes or Account Holder Name (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Account holder name or memo"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading || isFrozen}
              style={{
                width: '100%',
                padding: '0.65rem 1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn btn-outline btn-sm"
              style={{ padding: '0.65rem 1.25rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isFrozen || availableFloat <= 0}
              className="btn btn-primary btn-sm"
              style={{
                padding: '0.65rem 1.4rem',
                backgroundColor: 'var(--accent-lime, #ccff00)',
                color: '#000',
                fontWeight: 800,
                border: 'none',
              }}
            >
              {loading ? 'Submitting Request...' : 'Confirm & Request Withdrawal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
