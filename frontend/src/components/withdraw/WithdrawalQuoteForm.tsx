import React, { useState } from 'react';
import { Card } from '../ui/Card';
import {
  WithdrawalWalletData,
  WithdrawalPolicyData,
  UserPayoutPreferenceData,
  WithdrawalPayoutMethod,
  WithdrawalQuoteData,
} from '../../types/withdraw';
import { requestWithdrawalQuote, confirmWithdrawalRequest } from '../../services/withdraw';

interface WithdrawalQuoteFormProps {
  wallet: WithdrawalWalletData;
  policy: WithdrawalPolicyData;
  preference: UserPayoutPreferenceData | null;
  onWithdrawalConfirmed?: () => void;
}

export const WithdrawalQuoteForm: React.FC<WithdrawalQuoteFormProps> = ({
  wallet,
  policy,
  preference,
  onWithdrawalConfirmed,
}) => {
  const [method, setMethod] = useState<WithdrawalPayoutMethod>('USDT_BEP20');
  const [amountStr, setAmountStr] = useState<string>('');
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [accountHolder, setAccountHolder] = useState<string>('');
  const [useSavedDestination, setUseSavedDestination] = useState<boolean>(true);

  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [activeQuote, setActiveQuote] = useState<WithdrawalQuoteData | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  // Sync destination if using saved preference
  React.useEffect(() => {
    if (useSavedDestination && preference) {
      if (method === 'USDT_BEP20') {
        setDestinationAddress(preference.cryptoAddress || '');
        setAccountHolder('');
      } else {
        setDestinationAddress(preference.bankIban || '');
        setAccountHolder(preference.bankAccountHolder || '');
      }
    }
  }, [method, useSavedDestination, preference]);

  const handlePercentageSelect = (pct: number) => {
    const available = wallet.availableCents / 100;
    const calc = Math.floor(available * pct * 100) / 100;
    setAmountStr(calc > 0 ? calc.toFixed(2) : '0.00');
    setActiveQuote(null);
    setQuoteError(null);
  };

  const handleGenerateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoteError(null);
    setConfirmSuccess(null);
    setActiveQuote(null);

    const amountNum = parseFloat(amountStr);
    const amountCents = Math.round(amountNum * 100);

    if (isNaN(amountNum) || amountCents <= 0) {
      setQuoteError('Please enter a valid withdrawal amount greater than zero.');
      return;
    }

    const minFee = method === 'USDT_BEP20' ? policy.usdtBep20FeeCents : policy.irtBankFeeCents;
    if (amountCents <= minFee) {
      setQuoteError(
        `Requested amount ($${(amountCents / 100).toFixed(2)}) must exceed the fixed fee ($${(minFee / 100).toFixed(2)}).`
      );
      return;
    }

    if (amountCents > wallet.availableCents) {
      setQuoteError(
        `Insufficient liquid funds. Your available balance is $${wallet.availableUsd}.`
      );
      return;
    }

    const dest = destinationAddress.trim();
    if (!dest) {
      setQuoteError('Destination payout address is required.');
      return;
    }

    if (method === 'IRT_BANK' && !policy.adminUsdIrtRate) {
      setQuoteError(
        'Authoritative USD/IRT exchange rate is not configured by financial management. Quote generation blocked.'
      );
      return;
    }

    setLoadingQuote(true);
    try {
      const res = await requestWithdrawalQuote({
        payoutMethod: method,
        requestedUsdCents: amountCents,
        destinationAddress: dest,
        destinationAccountHolder: method === 'IRT_BANK' ? accountHolder.trim() : undefined,
      });

      if (res.success && res.quote) {
        setActiveQuote(res.quote);
      } else {
        setQuoteError(res.error || 'Failed to generate authoritative quote.');
      }
    } catch (err: any) {
      setQuoteError(err.message || 'Error occurred while contacting quote engine.');
    } finally {
      setLoadingQuote(false);
    }
  };

  const handleConfirmWithdrawal = async () => {
    if (!activeQuote) return;
    setConfirming(true);
    setQuoteError(null);

    try {
      const res = await confirmWithdrawalRequest(activeQuote.id);
      if (res.success) {
        setConfirmSuccess(
          `Withdrawal #${res.request.id} (${res.request.withdrawalRef}) successfully confirmed! Funds have been reserved for manual payout review.`
        );
        setActiveQuote(null);
        setAmountStr('');
        if (onWithdrawalConfirmed) {
          onWithdrawalConfirmed();
        }
      } else {
        setQuoteError(res.error || 'Failed to confirm withdrawal reservation.');
      }
    } catch (err: any) {
      setQuoteError(err.message || 'Error occurred while confirming withdrawal.');
    } finally {
      setConfirming(false);
    }
  };

  const currentFeeUsd = method === 'USDT_BEP20' ? policy.usdtBep20FeeUsd : policy.irtBankFeeUsd;

  return (
    <Card highlight="none" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.25rem 0' }}>
          Request Manual Withdrawal
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          Generate a binding quote and lock funds for administrative disbursement.
        </p>
      </div>

      {confirmSuccess && (
        <div
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem',
            marginBottom: '1.25rem',
            color: '#4ade80',
            fontSize: '0.86rem',
            lineHeight: 1.4,
          }}
        >
          <strong>✓ Withdrawal Reserved:</strong> {confirmSuccess}
        </div>
      )}

      {quoteError && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            color: '#f87171',
            fontSize: '0.85rem',
          }}
        >
          ⚠ {quoteError}
        </div>
      )}

      {/* Method Selection Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <button
          type="button"
          onClick={() => {
            setMethod('USDT_BEP20');
            setActiveQuote(null);
            setQuoteError(null);
          }}
          style={{
            backgroundColor: method === 'USDT_BEP20' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(15, 12, 28, 0.5)',
            border: `1px solid ${method === 'USDT_BEP20' ? 'var(--accent-lime)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '0.85rem',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: method === 'USDT_BEP20' ? 'var(--accent-lime)' : 'var(--text-main)' }}>
              💎 USDT (BSC BEP-20)
            </span>
            <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
              $0.40 Fee
            </span>
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
            1–48h disbursement with verified TxHash.
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMethod('IRT_BANK');
            setActiveQuote(null);
            setQuoteError(null);
          }}
          style={{
            backgroundColor: method === 'IRT_BANK' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 12, 28, 0.5)',
            border: `1px solid ${method === 'IRT_BANK' ? '#818cf8' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '0.85rem',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: method === 'IRT_BANK' ? '#93c5fd' : 'var(--text-main)' }}>
              🏦 Iranian Bank (IRT)
            </span>
            <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
              $1.30 Fee
            </span>
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
            Wed &amp; Sat batch cycle with Sheba transfer.
          </span>
        </button>
      </div>

      <form onSubmit={handleGenerateQuote}>
        {/* Amount Input */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Withdrawal Amount (USD)
            </label>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Available Liquid: <strong style={{ color: 'var(--accent-lime)' }}>${wallet.availableUsd}</strong>
            </span>
          </div>

          <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
            <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700 }}>
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={wallet.availableCents / 100}
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                setActiveQuote(null);
              }}
              placeholder="0.00"
              style={{
                width: '100%',
                backgroundColor: 'rgba(10, 8, 20, 0.8)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.7rem 0.85rem 0.7rem 2rem',
                fontSize: '1.1rem',
                fontWeight: 700,
                color: 'var(--text-main)',
              }}
            />
          </div>

          {/* Quick Percent Buttons */}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {[
              { label: '25%', val: 0.25 },
              { label: '50%', val: 0.5 },
              { label: '75%', val: 0.75 },
              { label: 'Max Liquid', val: 1.0 },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                onClick={() => handlePercentageSelect(btn.val)}
                className="btn btn-outline btn-sm"
                style={{ flex: 1, fontSize: '0.72rem', padding: '0.3rem 0.5rem' }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Destination Picker */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {method === 'USDT_BEP20' ? 'USDT BEP-20 Wallet Address' : 'Iranian IBAN / Sheba'}
            </label>

            {preference && (
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useSavedDestination}
                  onChange={(e) => setUseSavedDestination(e.target.checked)}
                />
                Use Saved Profile Address
              </label>
            )}
          </div>

          {method === 'IRT_BANK' && (
            <input
              type="text"
              value={accountHolder}
              onChange={(e) => {
                setAccountHolder(e.target.value);
                setUseSavedDestination(false);
              }}
              placeholder="Account holder full name (e.g. Parham Nayeri)"
              style={{
                width: '100%',
                backgroundColor: 'rgba(10, 8, 20, 0.8)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.6rem 0.85rem',
                color: 'var(--text-main)',
                fontSize: '0.85rem',
                marginBottom: '0.5rem',
              }}
            />
          )}

          <input
            type="text"
            value={destinationAddress}
            onChange={(e) => {
              setDestinationAddress(e.target.value);
              setUseSavedDestination(false);
            }}
            placeholder={
              method === 'USDT_BEP20'
                ? '0x1234567890abcdef1234567890abcdef12345678 (BNB Smart Chain only)'
                : 'IR020170000000109968843003'
            }
            style={{
              width: '100%',
              backgroundColor: 'rgba(10, 8, 20, 0.8)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.6rem 0.85rem',
              color: method === 'USDT_BEP20' ? '#c4b5fd' : '#93c5fd',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
            Fixed method fee: ${currentFeeUsd} USD. Double-check your destination carefully.
          </span>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={loadingQuote}
        >
          {loadingQuote ? 'Generating Authoritative Quote...' : 'Calculate Payout Quote →'}
        </button>
      </form>

      {/* Itemized Quote Preview */}
      {activeQuote && (
        <div
          style={{
            marginTop: '1.5rem',
            backgroundColor: 'rgba(24, 20, 42, 0.8)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Itemized Binding Quote
              </span>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'monospace' }}>
                {activeQuote.withdrawalRef}
              </div>
            </div>

            <span className={`badge ${activeQuote.simplifiedStatus.colorClass}`}>
              {activeQuote.simplifiedStatus.label}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.86rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Gross Requested USD:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>${activeQuote.requestedUsd}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Fixed Service Fee:</span>
              <span style={{ fontWeight: 700, color: '#f59e0b' }}>-${activeQuote.fixedFeeUsd}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Net Subtotal USD:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>${activeQuote.netUsd}</span>
            </div>

            {activeQuote.payoutMethod === 'IRT_BANK' && activeQuote.quoteRate && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Admin USD/IRT Rate:</span>
                  <span style={{ color: 'var(--text-main)' }}>{activeQuote.quoteRate.toLocaleString()} Toman</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Withdrawal Adjustment:</span>
                  <span style={{ color: '#ef4444' }}>-{activeQuote.rateDiscount?.toLocaleString()} Toman / USD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Effective IRT Rate:</span>
                  <span style={{ fontWeight: 700, color: '#93c5fd' }}>{activeQuote.effectiveRate?.toLocaleString()} Toman</span>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
              <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>Expected Net Payout:</span>
              <span style={{ fontWeight: 900, fontSize: '1.15rem', color: 'var(--accent-lime)' }}>
                {activeQuote.payoutMethod === 'IRT_BANK'
                  ? `${Number(activeQuote.quotedNetPayoutAmount).toLocaleString()} Toman`
                  : `${activeQuote.quotedNetPayoutAmount} USDT`}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Destination:</span>
              <span style={{ fontFamily: 'monospace', color: '#c4b5fd' }}>{activeQuote.maskedDestinationAddress}</span>
            </div>

            {activeQuote.scheduledCycleDay && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Disbursement Cycle:</span>
                <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{activeQuote.scheduledCycleDay} Batch</span>
              </div>
            )}
          </div>

          {/* Safety Notice regarding feature gate */}
          <div
            style={{
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.25)',
              borderRadius: 'var(--radius-xs)',
              padding: '0.65rem 0.8rem',
              marginBottom: '1rem',
              fontSize: '0.75rem',
              color: '#fef08a',
              lineHeight: 1.35,
            }}
          >
            ℹ <strong>Manual Payout Safeguard:</strong> Automated wallet disbursements are disabled (
            <code>FINANCE_V2_LIVE_PAYOUTS_ENABLED=false</code>). Confirming will lock funds in <code>RESERVED</code> status for manual administrator verification.
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setActiveQuote(null)}
              className="btn btn-outline btn-sm"
              style={{ flex: 1 }}
              disabled={confirming}
            >
              Cancel Quote
            </button>
            <button
              type="button"
              onClick={handleConfirmWithdrawal}
              className="btn btn-success btn-sm"
              style={{ flex: 2 }}
              disabled={confirming}
            >
              {confirming ? 'Locking Funds...' : 'Confirm & Reserve Funds →'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};
