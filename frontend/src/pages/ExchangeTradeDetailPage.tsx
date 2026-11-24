/**
 * frontend/src/pages/ExchangeTradeDetailPage.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 4 & Phase 5:
 * Dedicated Trade Details Page:
 *  - Immutable Pricing & Fee Snapshots
 *  - Real-time Status Badges & Lifecycle Tracking
 *  - Buyer Checkout Engine (G4X Wallet, NOWPayments Crypto, Bank Transfer)
 *  - Secured Escrow Holding Banner & Verification
 *  - Trade Event Timeline & Admin/Staff Controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ExchangeTradeItem,
  TradeCheckoutSummaryResponse,
} from '../types/exchange';
import {
  fetchTradeById,
  cancelTrade,
  fetchTradeCheckoutSummary,
  payTradeWithWallet,
  payTradeWithNowPayments,
  initiateBankTransfer,
  submitBankReceipt,
} from '../services/exchangeMarketplace';

export const ExchangeTradeDetailPage: React.FC = () => {
  const { tradeId } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.discordId;

  const [trade, setTrade] = useState<ExchangeTradeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Phase 5: Checkout State
  const [checkout, setCheckout] = useState<TradeCheckoutSummaryResponse | null>(null);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState<'WALLET' | 'NOWPAYMENTS' | 'BANK_TRANSFER'>('WALLET');

  // Wallet payment state
  const [payingWallet, setPayingWallet] = useState(false);

  // NOWPayments crypto state
  const [payingCrypto, setPayingCrypto] = useState(false);
  const [payCryptoCurrency, setPayCryptoCurrency] = useState('usdttrc20');
  const [cryptoInvoiceUrl, setCryptoInvoiceUrl] = useState<string | null>(null);

  // Bank Transfer state
  const [initiatingBank, setInitiatingBank] = useState(false);
  const [bankReceiptCode, setBankReceiptCode] = useState('');
  const [bankReceiptUrl, setBankReceiptUrl] = useState('');
  const [bankSenderNote, setBankSenderNote] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [activeBankPaymentId, setActiveBankPaymentId] = useState<string | null>(null);
  const [copiedCard, setCopiedCard] = useState(false);

  const loadTradeData = useCallback(async () => {
    if (!tradeId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTradeById(tradeId);
      if (res && res.trade) {
        setTrade(res.trade);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load trade details.');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  const loadCheckout = useCallback(async () => {
    if (!tradeId) return;
    try {
      setLoadingCheckout(true);
      const res = await fetchTradeCheckoutSummary(tradeId);
      if (res && res.success) {
        setCheckout(res);
        if (res.activePayment && res.activePayment.method === 'BANK_TRANSFER') {
          setActiveBankPaymentId(res.activePayment.id);
          setSelectedGateway('BANK_TRANSFER');
        } else if (res.activePayment && res.activePayment.method === 'NOWPAYMENTS' && res.activePayment.invoiceUrl) {
          setCryptoInvoiceUrl(res.activePayment.invoiceUrl);
          setSelectedGateway('NOWPAYMENTS');
        }
      }
    } catch (err: any) {
      // Checkout might fail if not buyer or not awaiting payment
      console.warn('Checkout summary not available:', err?.message);
    } finally {
      setLoadingCheckout(false);
    }
  }, [tradeId]);

  useEffect(() => {
    loadTradeData();
  }, [loadTradeData]);

  useEffect(() => {
    if (trade && trade.status === 'AWAITING_PAYMENT' && currentUserId && trade.buyerUserId === currentUserId) {
      loadCheckout();
    }
  }, [trade, currentUserId, loadCheckout]);

  const handleCancelTrade = async () => {
    if (!trade) return;
    const reason = window.prompt('Please enter the reason for cancellation:');
    if (reason === null) return;

    try {
      setCancelling(true);
      setActionFeedback(null);
      const res = await cancelTrade(trade.id, reason);
      setActionFeedback({
        type: 'success',
        message: 'Trade cancelled and capacity released back to the buy order successfully.',
      });
      setTrade(res.trade);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to cancel trade.',
      });
    } finally {
      setCancelling(false);
    }
  };

  // Payment Handler: Wallet
  const handlePayWallet = async () => {
    if (!trade) return;
    if (!window.confirm(`Are you sure you want to pay $${(trade.buyerTotalPayableCents / 100).toFixed(2)} USD from your central G4X wallet? Funds will be locked in Escrow until delivery is confirmed.`)) {
      return;
    }

    try {
      setPayingWallet(true);
      setActionFeedback(null);
      const res = await payTradeWithWallet(trade.id);
      setActionFeedback({
        type: 'success',
        message: 'Payment completed successfully! $ ' + (trade.buyerTotalPayableCents / 100).toFixed(2) + ' USD is secured in G4X Escrow.',
      });
      setTrade(res.trade);
      loadCheckout();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Wallet payment failed. Please check your balance.',
      });
    } finally {
      setPayingWallet(false);
    }
  };

  // Payment Handler: NOWPayments Crypto
  const handlePayCrypto = async () => {
    if (!trade) return;
    try {
      setPayingCrypto(true);
      setActionFeedback(null);
      const res = await payTradeWithNowPayments(trade.id, payCryptoCurrency);
      setCryptoInvoiceUrl(res.invoiceUrl);
      window.open(res.invoiceUrl, '_blank');
      setActionFeedback({
        type: 'success',
        message: 'NOWPayments invoice generated! If popup was blocked, click the Open Invoice button below.',
      });
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to initiate NOWPayments crypto invoice.',
      });
    } finally {
      setPayingCrypto(false);
    }
  };

  // Payment Handler: Bank Transfer Initiation
  const handleInitiateBankTransfer = async () => {
    if (!trade) return;
    try {
      setInitiatingBank(true);
      setActionFeedback(null);
      const res = await initiateBankTransfer(trade.id);
      setActiveBankPaymentId(res.payment.id);
      setActionFeedback({
        type: 'success',
        message: 'Bank transfer initiated. Please complete the card-to-card transfer and submit your receipt below.',
      });
      loadCheckout();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to initiate bank transfer.',
      });
    } finally {
      setInitiatingBank(false);
    }
  };

  // Payment Handler: Submit Bank Receipt
  const handleSubmitBankReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBankPaymentId) return;

    if (!bankReceiptUrl.trim()) {
      setActionFeedback({
        type: 'error',
        message: 'Please provide a receipt screenshot URL or image proof.',
      });
      return;
    }

    try {
      setSubmittingReceipt(true);
      setActionFeedback(null);
      await submitBankReceipt(activeBankPaymentId, {
        bankReference: bankReceiptCode.trim() || undefined,
        receiptUrl: bankReceiptUrl.trim(),
        senderNote: bankSenderNote.trim() || undefined,
      });

      setActionFeedback({
        type: 'success',
        message: 'Receipt submitted successfully! G4X Treasury staff will verify within 15–45 minutes.',
      });
      loadTradeData();
      loadCheckout();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to submit bank receipt.',
      });
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090B' }}>
        <div style={{ color: '#FACC15', fontSize: '1.2rem', fontWeight: 600 }}>Loading Exchange Trade Details...</div>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div style={{ minHeight: '80vh', padding: '40px 20px', backgroundColor: '#09090B', color: '#F3F4F6' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', backgroundColor: '#13151C', padding: '32px', borderRadius: '12px', border: '1px solid #EF4444' }}>
          <h2 style={{ color: '#EF4444', marginBottom: '12px' }}>Trade Not Found</h2>
          <p style={{ color: '#9CA3AF', marginBottom: '20px' }}>{error || 'The requested trade does not exist or you do not have permission to view it.'}</p>
          <button
            onClick={() => navigate('/exchange')}
            style={{ padding: '10px 20px', backgroundColor: '#FACC15', color: '#000', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
          >
            ← Back to Marketplace
          </button>
        </div>
      </div>
    );
  }

  const isBuyer = currentUserId && trade.buyerUserId === currentUserId;
  const isSeller = currentUserId && trade.sellerUserId === currentUserId;
  const canCancel = trade.status === 'AWAITING_PAYMENT' && (isBuyer || isSeller);

  const multiplierBig = BigInt(trade.unitMultiplierSnapshot || '1');
  const tradeUnits = (BigInt(trade.quantityBaseUnits) / multiplierBig).toString();

  const grossUsd = (trade.grossValueCents / 100).toFixed(2);
  const buyerFeeUsd = (trade.buyerFeeCents / 100).toFixed(2);
  const buyerTotalUsd = (trade.buyerTotalPayableCents / 100).toFixed(2);
  const sellerFeeUsd = (trade.sellerFeeCents / 100).toFixed(2);
  const netSellerUsd = (trade.netSellerCents / 100).toFixed(2);
  const unitPriceUsd = (trade.pricePerUnitCentsSnapshot / 100).toFixed(2);

  // Status Badge Configuration
  const getStatusBadge = (statusStr: string) => {
    switch (statusStr) {
      case 'AWAITING_PAYMENT':
        return { label: 'Awaiting Payment', color: '#FACC15', bg: 'rgba(250, 204, 21, 0.15)', border: '#FACC15' };
      case 'PAYMENT_CONFIRMED':
        return { label: 'Payment Confirmed & Escrow Secured', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981' };
      case 'DELIVERY_IN_PROGRESS':
        return { label: 'Delivery in Progress', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6' };
      case 'PROOF_SUBMITTED':
        return { label: 'Proof Submitted', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)', border: '#8B5CF6' };
      case 'BUYER_CONFIRMED':
        return { label: 'Buyer Confirmed Delivery', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981' };
      case 'COMPLETED':
        return { label: 'Trade Completed', color: '#10B981', bg: 'rgba(16, 185, 129, 0.2)', border: '#10B981' };
      case 'CANCELLED':
        return { label: 'Trade Cancelled', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444' };
      case 'DISPUTED':
        return { label: 'Disputed', color: '#F97316', bg: 'rgba(249, 115, 22, 0.15)', border: '#F97316' };
      default:
        return { label: statusStr, color: '#9CA3AF', bg: 'rgba(156, 163, 175, 0.15)', border: '#4B5563' };
    }
  };

  const badge = getStatusBadge(trade.status);
  const isEscrowSecured = trade.status !== 'AWAITING_PAYMENT' && trade.status !== 'CANCELLED';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#09090B', color: '#F3F4F6', padding: '32px 16px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Back Link & Header */}
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <Link to="/exchange" style={{ color: '#9CA3AF', textDecoration: 'none', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span>←</span> Back to Exchange Marketplace
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                Trade {trade.tradeCode}
              </h1>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  backgroundColor: badge.bg,
                  color: badge.color,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {badge.label}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link
              to={`/exchange/orders/${trade.buyOrderId}`}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1E202B',
                color: '#D1D5DB',
                borderRadius: '8px',
                border: '1px solid #374151',
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              View Order {trade.buyOrder?.orderCode || ''}
            </Link>

            {canCancel && (
              <button
                onClick={handleCancelTrade}
                disabled={cancelling}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#EF4444',
                  borderRadius: '8px',
                  border: '1px solid #EF4444',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                }}
              >
                {cancelling ? 'Cancelling...' : 'Cancel Trade'}
              </button>
            )}
          </div>
        </div>

        {/* Feedback Alert */}
        {actionFeedback && (
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              fontSize: '0.9rem',
              marginBottom: '24px',
              backgroundColor: actionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${actionFeedback.type === 'success' ? '#10B981' : '#EF4444'}`,
              color: actionFeedback.type === 'success' ? '#10B981' : '#EF4444',
            }}
          >
            {actionFeedback.message}
          </div>
        )}

        {/* Phase 5: SECURED ESCROW BANNER (When Paid & Reserved) */}
        {isEscrowSecured && (
          <div
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid #10B981',
              borderRadius: '12px',
              padding: '20px 24px',
              marginBottom: '28px',
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '2.5rem' }}>🛡️</div>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div style={{ color: '#10B981', fontWeight: 800, fontSize: '1.2rem', marginBottom: '4px' }}>
                Funds Secured & Reserved in G4X Escrow
              </div>
              <div style={{ color: '#D1D5DB', fontSize: '0.9rem', lineHeight: '1.4' }}>
                Total <strong>${buyerTotalUsd} USD</strong> is safely reserved by G4X Treasury. The seller has been notified to proceed with delivery. Funds will remain locked in escrow until you confirm delivery and final verification completes.
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '160px' }}>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>ESCROW STATUS</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10B981' }}>RESERVED</div>
            </div>
          </div>
        )}

        {/* Phase 5: BUYER SECURE CHECKOUT PANEL (When Awaiting Payment) */}
        {trade.status === 'AWAITING_PAYMENT' && isBuyer && (
          <div
            style={{
              backgroundColor: '#13151C',
              borderRadius: '14px',
              border: '1px solid #374151',
              padding: '24px',
              marginBottom: '32px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                  💳 Secure Checkout & Escrow Funding
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '4px' }}>
                  Choose your payment method to fund the trade escrow. Funds are held safely by G4X until you verify item delivery.
                  {loadingCheckout && (
                    <span style={{ color: '#FACC15', marginLeft: '10px', fontSize: '0.8rem' }}>
                      ⏳ Updating checkout rates...
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>TOTAL DUE</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#FACC15' }}>
                  ${buyerTotalUsd} USD
                </div>
              </div>
            </div>

            {/* Gateway Selection Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #27272A', paddingBottom: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedGateway('WALLET')}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: selectedGateway === 'WALLET' ? '1px solid #FACC15' : '1px solid #27272A',
                  backgroundColor: selectedGateway === 'WALLET' ? 'rgba(250, 204, 21, 0.15)' : '#1E202B',
                  color: selectedGateway === 'WALLET' ? '#FACC15' : '#D1D5DB',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>🪙</span> G4X Central Wallet
              </button>

              <button
                type="button"
                onClick={() => setSelectedGateway('NOWPAYMENTS')}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: selectedGateway === 'NOWPAYMENTS' ? '1px solid #3B82F6' : '1px solid #27272A',
                  backgroundColor: selectedGateway === 'NOWPAYMENTS' ? 'rgba(59, 130, 246, 0.15)' : '#1E202B',
                  color: selectedGateway === 'NOWPAYMENTS' ? '#60A5FA' : '#D1D5DB',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>⚡</span> Crypto (NOWPayments)
              </button>

              <button
                type="button"
                onClick={() => setSelectedGateway('BANK_TRANSFER')}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: selectedGateway === 'BANK_TRANSFER' ? '1px solid #10B981' : '1px solid #27272A',
                  backgroundColor: selectedGateway === 'BANK_TRANSFER' ? 'rgba(16, 185, 129, 0.15)' : '#1E202B',
                  color: selectedGateway === 'BANK_TRANSFER' ? '#34D399' : '#D1D5DB',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>💳</span> کارت به کارت (Bank Transfer)
              </button>
            </div>

            {/* TAB 1: G4X Central Wallet */}
            {selectedGateway === 'WALLET' && (
              <div>
                <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '18px', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>YOUR AVAILABLE WALLET BALANCE</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: checkout?.wallet.hasSufficientBalance ? '#10B981' : '#EF4444' }}>
                        {checkout ? checkout.wallet.availableUsd : '$--'} USD
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>TRADE AMOUNT PAYABLE</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF' }}>
                        ${buyerTotalUsd} USD
                      </div>
                    </div>
                  </div>

                  {checkout?.wallet.isFrozen && (
                    <div style={{ color: '#EF4444', fontSize: '0.85rem', marginTop: '12px', fontWeight: 600 }}>
                      ⚠️ Your wallet is frozen. Please contact administration.
                    </div>
                  )}

                  {!checkout?.wallet.hasSufficientBalance && !checkout?.wallet.isFrozen && (
                    <div style={{ color: '#FACC15', fontSize: '0.85rem', marginTop: '12px' }}>
                      ⚠️ Insufficient balance to cover this trade. Please deposit funds into your G4X wallet first.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {checkout?.wallet.hasSufficientBalance ? (
                    <button
                      type="button"
                      onClick={handlePayWallet}
                      disabled={payingWallet}
                      style={{
                        padding: '12px 28px',
                        backgroundColor: '#FACC15',
                        color: '#000000',
                        fontWeight: 800,
                        fontSize: '1rem',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: payingWallet ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {payingWallet ? 'Locking Escrow...' : `Pay $${buyerTotalUsd} USD from G4X Wallet`}
                    </button>
                  ) : (
                    <Link
                      to="/wallet"
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#3B82F6',
                        color: '#FFFFFF',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      + Top Up Wallet Balance
                    </Link>
                  )}
                  <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>
                    Instant reservation • Zero extra gateway fees
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: NOWPayments Crypto */}
            {selectedGateway === 'NOWPAYMENTS' && (
              <div>
                <p style={{ fontSize: '0.9rem', color: '#D1D5DB', marginBottom: '16px' }}>
                  Pay with crypto assets through NOWPayments hosted payment gateway. As soon as network confirmations complete, escrow will be funded automatically.
                </p>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '6px' }}>
                      Select Crypto Asset:
                    </label>
                    <select
                      value={payCryptoCurrency}
                      onChange={(e) => setPayCryptoCurrency(e.target.value)}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: '#1E202B',
                        color: '#FFFFFF',
                        borderRadius: '8px',
                        border: '1px solid #374151',
                        fontSize: '0.9rem',
                      }}
                    >
                      <option value="usdttrc20">USDT (TRC-20)</option>
                      <option value="usdterc20">USDT (ERC-20)</option>
                      <option value="usdtbsc">USDT (BEP-20)</option>
                      <option value="btc">Bitcoin (BTC)</option>
                      <option value="ltc">Litecoin (LTC)</option>
                      <option value="trx">Tron (TRX)</option>
                      <option value="eth">Ethereum (ETH)</option>
                    </select>
                  </div>

                  <div style={{ alignSelf: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handlePayCrypto}
                      disabled={payingCrypto}
                      style={{
                        padding: '11px 24px',
                        backgroundColor: '#3B82F6',
                        color: '#FFFFFF',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: payingCrypto ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {payingCrypto ? 'Generating Invoice...' : `Pay $${buyerTotalUsd} USD via NOWPayments`}
                    </button>
                  </div>
                </div>

                {cryptoInvoiceUrl && (
                  <div style={{ backgroundColor: '#1E202B', padding: '14px', borderRadius: '8px', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ fontSize: '0.85rem', color: '#10B981' }}>
                      ✓ Invoice generated. Waiting for crypto network payment...
                    </div>
                    <a
                      href={cryptoInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#2563EB',
                        color: '#FFFFFF',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      Open Invoice Page ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Bank Transfer (کارت به کارت) */}
            {selectedGateway === 'BANK_TRANSFER' && (
              <div>
                <p style={{ fontSize: '0.9rem', color: '#D1D5DB', marginBottom: '16px' }}>
                  Direct card-to-card transfer via Shetab banking. Once you transfer the amount, submit your tracking reference and receipt screenshot for rapid staff verification.
                </p>

                {/* Receiving Bank Card Info */}
                <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '18px', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>بانک مقصد (BANK)</div>
                      <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                        {checkout?.gateways.bankTransfer.bankDetails.bankName || 'بانک سامان'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>شماره کارت (CARD NUMBER)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 800, color: '#FACC15', fontSize: '1.1rem', letterSpacing: '0.05em' }}>
                          {checkout?.gateways.bankTransfer.bankDetails.cardNumber || '---- ---- ---- ----'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(checkout?.gateways.bankTransfer.bankDetails.cardNumber || '')}
                          style={{
                            padding: '3px 8px',
                            backgroundColor: '#374151',
                            color: '#FFFFFF',
                            borderRadius: '4px',
                            border: 'none',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedCard ? 'کپی شد!' : 'کپی'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>صاحب حساب (CARD HOLDER)</div>
                      <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                        {checkout?.gateways.bankTransfer.bankDetails.accountHolder || 'پلتفرم جی فور ایکس'}
                      </div>
                    </div>
                  </div>

                  {checkout?.gateways.bankTransfer.irtQuote && (
                    <div style={{ borderTop: '1px solid #374151', marginTop: '14px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>مبلغ معادل تومانی مصوب (با نرخ روز):</span>
                      <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10B981' }}>
                        {checkout.gateways.bankTransfer.irtQuote.totalIrtAmount.toLocaleString('fa-IR')} تومان
                      </span>
                    </div>
                  )}
                </div>

                {!activeBankPaymentId ? (
                  <button
                    type="button"
                    onClick={handleInitiateBankTransfer}
                    disabled={initiatingBank}
                    style={{
                      padding: '11px 24px',
                      backgroundColor: '#10B981',
                      color: '#000000',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: initiatingBank ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {initiatingBank ? 'در حال ثبت پیش‌فاکتور...' : 'شروع پرداخت و ثبت رسید واریز'}
                  </button>
                ) : (
                  /* Receipt Submission Form */
                  <form onSubmit={handleSubmitBankReceipt} style={{ backgroundColor: '#181A24', padding: '18px', borderRadius: '10px', border: '1px solid #27272A' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '14px' }}>
                      ثبت رسید و شناسه رهگیری پرداخت بانکی
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px' }}>
                          شماره پیگیری / ارجاع بانکی (Reference No):
                        </label>
                        <input
                          type="text"
                          placeholder="مثال: 8492048291"
                          value={bankReceiptCode}
                          onChange={(e) => setBankReceiptCode(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            backgroundColor: '#1E202B',
                            border: '1px solid #374151',
                            borderRadius: '6px',
                            color: '#FFFFFF',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px' }}>
                          لینک یا تصویر رسید بانکی (Image / URL): *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="https://... یا نام فایل رسید"
                          value={bankReceiptUrl}
                          onChange={(e) => setBankReceiptUrl(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            backgroundColor: '#1E202B',
                            border: '1px solid #374151',
                            borderRadius: '6px',
                            color: '#FFFFFF',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px' }}>
                        یادداشت اختیاری برای تیم مالی:
                      </label>
                      <input
                        type="text"
                        placeholder="۴ رقم آخر کارت واریزکننده یا ساعت پرداخت"
                        value={bankSenderNote}
                        onChange={(e) => setBankSenderNote(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          backgroundColor: '#1E202B',
                          border: '1px solid #374151',
                          borderRadius: '6px',
                          color: '#FFFFFF',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <button
                        type="submit"
                        disabled={submittingReceipt}
                        style={{
                          padding: '10px 24px',
                          backgroundColor: '#10B981',
                          color: '#000000',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          borderRadius: '6px',
                          border: 'none',
                          cursor: submittingReceipt ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {submittingReceipt ? 'در حال ارسال...' : 'ارسال رسید جهت بررسی اپراتور'}
                      </button>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>
                        زمان معمول تایید مالی: ۱۵ تا ۴۵ دقیقه
                      </span>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>

          {/* Left Column: Trade Specifications & Public Participants */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Item & Game Info Card */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                {trade.game?.iconUrl && (
                  <img src={trade.game.iconUrl} alt={trade.game.name} style={{ width: '52px', height: '52px', borderRadius: '10px', objectFit: 'cover' }} />
                )}
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {trade.game?.name} {trade.region ? `• ${trade.region.name}` : ''}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FACC15' }}>
                    {trade.currency?.name}
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>SETTLED QUANTITY</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFFFFF' }}>
                    {tradeUnits}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                    {trade.unitLabelSnapshot}s
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>UNIT PRICE SNAPSHOT</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10B981' }}>
                    ${unitPriceUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                    per {trade.unitLabelSnapshot}
                  </div>
                </div>
              </div>
            </div>

            {/* Participants Card (Zero PII) */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Trade Participants
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ backgroundColor: '#1E202B', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>BUYER</div>
                  <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                    {trade.buyer?.displayName || trade.buyer?.username || 'Buyer'}
                  </div>
                  {isBuyer && (
                    <span style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 600 }}>
                      (You)
                    </span>
                  )}
                </div>

                <div style={{ backgroundColor: '#1E202B', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>SELLER</div>
                  <div style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
                    {trade.seller?.displayName || trade.seller?.username || 'Seller'}
                  </div>
                  {isSeller && (
                    <span style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 600 }}>
                      (You)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Delivery Instructions */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Delivery Details
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>DELIVERY METHOD</div>
                  <div style={{ fontWeight: 600, color: '#FACC15', fontSize: '0.95rem' }}>
                    {trade.deliveryMethod?.name || 'In-Game Direct Delivery'}
                  </div>
                  {trade.deliveryMethod?.description && (
                    <div style={{ fontSize: '0.8rem', color: '#9CA3AF', marginTop: '2px' }}>
                      {trade.deliveryMethod.description}
                    </div>
                  )}
                </div>

                {trade.buyerInstructionsSnapshot && (
                  <div style={{ backgroundColor: '#1E202B', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>BUYER INSTRUCTIONS SNAPSHOT</div>
                    <div style={{ fontSize: '0.85rem', color: '#FFFFFF', whiteSpace: 'pre-wrap' }}>
                      {trade.buyerInstructionsSnapshot}
                    </div>
                  </div>
                )}

                {trade.sellerNotes && (
                  <div style={{ backgroundColor: '#1E202B', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '4px' }}>SELLER NOTES</div>
                    <div style={{ fontSize: '0.85rem', color: '#FFFFFF', whiteSpace: 'pre-wrap' }}>
                      {trade.sellerNotes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Immutable Financial Snapshot & Events Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Immutable Financial Breakdown Card */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                  Financial Breakdown
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#9CA3AF', backgroundColor: '#1E202B', padding: '3px 8px', borderRadius: '4px' }}>
                  Rule v{trade.feeRuleVersionSnapshot} ({trade.feeRuleScopeSnapshot})
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                  <span style={{ color: '#9CA3AF' }}>Gross Value:</span>
                  <span style={{ color: '#FFFFFF', fontWeight: 600 }}>${grossUsd}</span>
                </div>

                {/* Buyer Perspective */}
                <div style={{ backgroundColor: '#1E202B', borderRadius: '8px', padding: '12px', marginTop: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#8B5CF6', fontWeight: 700, marginBottom: '6px' }}>
                    BUYER SETTLEMENT
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                    <span style={{ color: '#9CA3AF' }}>Platform Fee ({(trade.buyerCommissionBpsSnapshot / 100).toFixed(2)}%):</span>
                    <span style={{ color: '#FFFFFF' }}>+${buyerFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px solid #374151', paddingTop: '6px', marginTop: '4px' }}>
                    <span style={{ color: '#FFFFFF' }}>Total Payable:</span>
                    <span style={{ color: '#FACC15' }}>${buyerTotalUsd}</span>
                  </div>
                </div>

                {/* Seller Perspective */}
                <div style={{ backgroundColor: '#1E202B', borderRadius: '8px', padding: '12px', marginTop: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700, marginBottom: '6px' }}>
                    SELLER SETTLEMENT
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                    <span style={{ color: '#9CA3AF' }}>Platform Fee ({(trade.sellerCommissionBpsSnapshot / 100).toFixed(2)}%):</span>
                    <span style={{ color: '#EF4444' }}>-${sellerFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px solid #374151', paddingTop: '6px', marginTop: '4px' }}>
                    <span style={{ color: '#FFFFFF' }}>Net Payout:</span>
                    <span style={{ color: '#10B981' }}>${netSellerUsd}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Events Timeline */}
            <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '16px' }}>
                Trade Timeline & Audit Log
              </h3>

              {(!trade.events || trade.events.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#9CA3AF', fontSize: '0.85rem' }}>
                  No recorded events yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}>
                  {trade.events.map((ev, idx) => (
                    <div
                      key={ev.id || idx}
                      style={{
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                        paddingLeft: '6px',
                        borderLeft: '2px solid #374151',
                        paddingBottom: '4px',
                      }}
                    >
                      <div
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor:
                            ev.eventType === 'TRADE_CANCELLED'
                              ? '#EF4444'
                              : ev.eventType === 'STATUS_CHANGED' && ev.toStatus === 'PAYMENT_CONFIRMED'
                              ? '#10B981'
                              : ev.eventType === 'OFFER_ACCEPTED'
                              ? '#10B981'
                              : '#FACC15',
                          marginTop: '4px',
                          marginLeft: '-6px',
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: '#FFFFFF', fontSize: '0.85rem' }}>
                            {ev.eventType}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                            {new Date(ev.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {ev.note && (
                          <div style={{ fontSize: '0.8rem', color: '#D1D5DB', marginTop: '2px' }}>
                            {ev.note}
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '2px' }}>
                          By: {ev.actorRole || 'SYSTEM'} • {new Date(ev.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
