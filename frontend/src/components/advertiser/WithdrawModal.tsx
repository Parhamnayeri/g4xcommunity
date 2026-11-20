import React, { useState } from 'react';
import { submitAdvertiserWithdrawal } from '../../services/advertiser';
import { AdvertiserWallet } from '../../types/advertiser';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: AdvertiserWallet;
  onSuccess: (message: string) => void;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  wallet,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [destinationAddress, setDestinationAddress] = useState<string>(wallet.payoutAddress || '');
  const [payoutMethod, setPayoutMethod] = useState<'USDT_BEP20' | 'USDT_TRC20' | 'IRT_BANK'>('USDT_BEP20');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const availableFloat = parseFloat(wallet.availableUsd) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (wallet.isFrozen) {
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
      setError('Please provide a valid destination payout address or bank IBAN.');
      return;
    }

    setLoading(true);
    try {
      const res = await submitAdvertiserWithdrawal(
        withdrawFloat,
        destinationAddress.trim(),
        payoutMethod,
        notes.trim() || undefined
      );
      const ref = res?.withdrawal?.ref || 'PENDING';
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
            borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(24, 21, 36, 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.25rem' }}>💸</span>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f4f4f6' }}>
              Withdraw Advertiser Funds
            </h3>
          </div>
          <button
            onClick={onClose}
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
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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

          {wallet.isFrozen && (
            <div
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                color: '#fcd34d',
                fontSize: '0.85rem',
              }}
            >
              ⚠️ <strong>Wallet Under Administrative Hold:</strong> Withdrawals are temporarily locked for this account.
            </div>
          )}

          {/* Balance info banner */}
          <div
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.7)',
              borderRadius: '10px',
              border: '1px solid rgba(124, 58, 237, 0.25)',
              padding: '0.9rem 1.1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9490a6', textTransform: 'uppercase' }}>Available to Withdraw</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-lime, #ccff00)', fontFamily: 'monospace' }}>
                ${wallet.availableUsd}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAmount(wallet.availableUsd)}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--accent-lime, #ccff00)',
                backgroundColor: 'rgba(204, 255, 0, 0.12)',
                color: 'var(--accent-lime, #ccff00)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Max All
            </button>
          </div>

          {/* Amount input */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
              Withdrawal Amount (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              max={availableFloat}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50.00"
              required
              disabled={wallet.isFrozen}
              style={{
                width: '100%',
                padding: '0.65rem 1rem',
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

          {/* Method selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
              Payout Method
            </label>
            <select
              value={payoutMethod}
              onChange={(e: any) => setPayoutMethod(e.target.value)}
              disabled={wallet.isFrozen}
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
              <option value="USDT_BEP20">USDT (BEP20 - Binance Smart Chain)</option>
              <option value="USDT_TRC20">USDT (TRC20 - Tron)</option>
              <option value="IRT_BANK">Iranian Bank Shaba / Card (IRT)</option>
            </select>
          </div>

          {/* Destination address */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
              Destination Address / Shaba IBAN
            </label>
            <input
              type="text"
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder={payoutMethod === 'IRT_BANK' ? 'IRxxxxxxxxxxxxxxxxxxxxxxxx' : '0x... or T...'}
              required
              disabled={wallet.isFrozen}
              style={{
                width: '100%',
                padding: '0.65rem 1rem',
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Optional Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
              Notes for Finance Staff (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any payment references or instructions..."
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
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
              disabled={loading || wallet.isFrozen}
              style={{
                padding: '0.6rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary-purple, #7c3aed)',
                color: '#ffffff',
                fontWeight: 800,
                cursor: loading || wallet.isFrozen ? 'not-allowed' : 'pointer',
                opacity: loading || wallet.isFrozen ? 0.6 : 1,
              }}
            >
              {loading ? 'Submitting...' : 'Submit Withdrawal Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
