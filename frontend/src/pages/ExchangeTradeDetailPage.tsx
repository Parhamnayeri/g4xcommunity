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
  ExchangeProofItem,
  ExchangeSettlementItem,
  ExchangeDisputeItem,
  DisputeCategory,
} from '../types/exchange';
import {
  fetchTradeById,
  cancelTrade,
  fetchTradeCheckoutSummary,
  payTradeWithWallet,
  payTradeWithNowPayments,
  initiateBankTransfer,
  submitBankReceipt,
  ensureDiscordRoom,
  archiveDiscordRoom,
  submitExchangeProof,
  getExchangeProofs,
  confirmExchangeDelivery,
  openExchangeDispute,
  getTradeDispute,
  getTradeSettlement,
} from '../services/exchangeMarketplace';

export const ExchangeTradeDetailPage: React.FC = () => {
  const { tradeId } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const currentUserId = user?.discordId;
  const isStaff = hasRole('owner', 'manager', 'admin', 'staff', 'moderator');

  const [trade, setTrade] = useState<ExchangeTradeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Phase 6: Discord Room State
  const [ensuringRoom, setEnsuringRoom] = useState(false);
  const [archivingRoom, setArchivingRoom] = useState(false);

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

  // Phase 7: Proofs, Confirmation, Disputes & Settlement
  const [proofs, setProofs] = useState<ExchangeProofItem[]>([]);
  const [showProofModal, setShowProofModal] = useState(false);
  const [proofFileUrl, setProofFileUrl] = useState('');
  const [proofInGameDetails, setProofInGameDetails] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [submittingProof, setSubmittingProof] = useState(false);

  // Buyer confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);

  // Dispute modal
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState<DisputeCategory>('BUYER_NOT_RECEIVED');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [tradeDispute, setTradeDispute] = useState<ExchangeDisputeItem | null>(null);

  // Settlement
  const [settlement, setSettlement] = useState<ExchangeSettlementItem | null>(null);

  const loadProofsAndSettlement = useCallback(async () => {
    if (!tradeId) return;
    try {
      const [proofsRes, disputeRes, settlementRes] = await Promise.all([
        getExchangeProofs(tradeId).catch(() => null),
        getTradeDispute(tradeId).catch(() => null),
        getTradeSettlement(tradeId).catch(() => null),
      ]);
      if (proofsRes && proofsRes.success) setProofs(proofsRes.proofs);
      if (disputeRes && disputeRes.success) setTradeDispute(disputeRes.dispute);
      if (settlementRes && settlementRes.success) setSettlement(settlementRes.settlement);
    } catch (err: any) {
      console.warn('Failed to load proofs/dispute/settlement:', err?.message);
    }
  }, [tradeId]);

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
      console.warn('Checkout summary not available:', err?.message);
    } finally {
      setLoadingCheckout(false);
    }
  }, [tradeId]);

  useEffect(() => {
    loadTradeData();
    loadProofsAndSettlement();
  }, [loadTradeData, loadProofsAndSettlement]);

  useEffect(() => {
    if (trade && trade.status === 'AWAITING_PAYMENT' && currentUserId && trade.buyerUserId === currentUserId) {
      loadCheckout();
    }
  }, [trade, currentUserId, loadCheckout]);

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tradeId) return;
    try {
      setSubmittingProof(true);
      const res = await submitExchangeProof(tradeId, {
        fileUrl: proofFileUrl.trim() || undefined,
        inGameDetails: proofInGameDetails.trim() || undefined,
        note: proofNote.trim() || undefined,
      });
      if (res.success) {
        setActionFeedback({ type: 'success', message: 'Delivery proof uploaded successfully!' });
        setShowProofModal(false);
        setProofFileUrl('');
        setProofInGameDetails('');
        setProofNote('');
        loadTradeData();
        loadProofsAndSettlement();
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to upload proof.' });
    } finally {
      setSubmittingProof(false);
    }
  };

  const handleConfirmDelivery = async () => {
    if (!tradeId) return;
    try {
      setConfirmingDelivery(true);
      const res = await confirmExchangeDelivery(tradeId, confirmNote.trim() || undefined);
      if (res.success) {
        setActionFeedback({
          type: 'success',
          message: 'Delivery confirmed! Trade has been sent to Staff for Final Review & Payout.',
        });
        setShowConfirmModal(false);
        loadTradeData();
        loadProofsAndSettlement();
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to confirm delivery.' });
    } finally {
      setConfirmingDelivery(false);
    }
  };

  const handleSubmitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tradeId) return;
    try {
      setSubmittingDispute(true);
      const links = disputeEvidence.trim() ? [disputeEvidence.trim()] : [];
      const res = await openExchangeDispute(tradeId, {
        category: disputeCategory,
        description: disputeDescription.trim(),
        evidenceLinks: links,
      });
      if (res.success) {
        setActionFeedback({
          type: 'success',
          message: `Dispute ${res.dispute.disputeCode} opened. Escrow funds frozen pending Staff investigation.`,
        });
        setShowDisputeModal(false);
        setDisputeDescription('');
        setDisputeEvidence('');
        loadTradeData();
        loadProofsAndSettlement();
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to open dispute.' });
    } finally {
      setSubmittingDispute(false);
    }
  };

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

  // Phase 6: Discord Room Handlers
  const handleEnsureDiscordRoom = async () => {
    if (!trade) return;
    try {
      setEnsuringRoom(true);
      setActionFeedback(null);
      const res = await ensureDiscordRoom(trade.id);
      setActionFeedback({
        type: 'success',
        message: res.message || 'Discord trade room connected successfully!',
      });
      if (res.discordRoom) {
        setTrade((prev) => (prev ? { ...prev, discordRoom: res.discordRoom } : prev));
      }
      loadTradeData();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to create or access Discord trade room.',
      });
    } finally {
      setEnsuringRoom(false);
    }
  };

  const handleArchiveDiscordRoom = async () => {
    if (!trade) return;
    if (
      !window.confirm(
        'Are you sure you want to archive this Discord trade room? The channel will be locked and moved to the archive category.'
      )
    ) {
      return;
    }
    try {
      setArchivingRoom(true);
      setActionFeedback(null);
      const res = await archiveDiscordRoom(trade.id, 'Archived by staff from Trade Details');
      setActionFeedback({
        type: 'success',
        message: res.message || 'Discord room archived successfully.',
      });
      if (res.discordRoom) {
        setTrade((prev) => (prev ? { ...prev, discordRoom: res.discordRoom } : prev));
      }
      loadTradeData();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err?.message || 'Failed to archive Discord trade room.',
      });
    } finally {
      setArchivingRoom(false);
    }
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
      case 'AWAITING_FINAL_APPROVAL':
        return { label: 'Awaiting Final Review & Payout', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)', border: '#38BDF8' };
      case 'ADDITIONAL_PROOF_REQUESTED':
        return { label: 'Additional Proof Requested', color: '#F97316', bg: 'rgba(249, 115, 22, 0.15)', border: '#F97316' };
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Phase 7: Participant Action Buttons */}
            {trade.status !== 'AWAITING_PAYMENT' && trade.status !== 'CANCELLED' && trade.status !== 'COMPLETED' && (
              <>
                <button
                  type="button"
                  onClick={() => setShowProofModal(true)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#8B5CF6',
                    color: '#FFFFFF',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📸 Upload Proof
                </button>

                {isBuyer && ['PROOF_SUBMITTED', 'DELIVERY_IN_PROGRESS', 'ADDITIONAL_PROOF_REQUESTED'].includes(trade.status) && (
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#10B981',
                      color: '#000000',
                      borderRadius: '8px',
                      border: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✅ Confirm Delivery
                  </button>
                )}

                {trade.status !== 'DISPUTED' && (
                  <button
                    type="button"
                    onClick={() => setShowDisputeModal(true)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'rgba(249, 115, 22, 0.15)',
                      color: '#F97316',
                      borderRadius: '8px',
                      border: '1px solid #F97316',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚠️ Report Dispute
                  </button>
                )}
              </>
            )}

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

        {/* Phase 7: COMPLETED SETTLEMENT CARD */}
        {trade.status === 'COMPLETED' && settlement && (
          <div
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid #10B981',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '28px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '2rem' }}>🎉</span>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10B981', margin: 0 }}>
                    Trade Finalized & Settled Successfully
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '2px' }}>
                    Settlement Code: <strong style={{ color: '#FFFFFF' }}>{settlement.settlementCode}</strong> • Settled on {new Date(settlement.settledAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  backgroundColor: '#10B981',
                  color: '#000000',
                }}
              >
                {settlement.settlementType}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', backgroundColor: '#13151C', padding: '16px', borderRadius: '10px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>SELLER NET PAYOUT</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10B981' }}>
                  ${(settlement.sellerNetPayoutCents / 100).toFixed(2)} USD
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>GROSS TRADE VALUE</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#FFFFFF' }}>
                  ${(settlement.grossValueCents / 100).toFixed(2)} USD
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>G4X PLATFORM REVENUE</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#FACC15' }}>
                  ${(settlement.g4xTotalRevenueCents / 100).toFixed(2)} USD
                </div>
              </div>
              {settlement.buyerRefundCents > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>BUYER REFUND</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#38BDF8' }}>
                    ${(settlement.buyerRefundCents / 100).toFixed(2)} USD
                  </div>
                </div>
              )}
            </div>

            {settlement.approvalNote && (
              <div style={{ marginTop: '12px', fontSize: '0.85rem', color: '#D1D5DB' }}>
                <strong>Staff Note:</strong> {settlement.approvalNote}
              </div>
            )}
          </div>
        )}

        {/* Phase 7: AWAITING FINAL APPROVAL BANNER */}
        {trade.status === 'AWAITING_FINAL_APPROVAL' && (
          <div
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid #38BDF8',
              borderRadius: '12px',
              padding: '20px 24px',
              marginBottom: '28px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '2.5rem' }}>⏳</div>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div style={{ color: '#38BDF8', fontWeight: 800, fontSize: '1.1rem', marginBottom: '4px' }}>
                Delivery Confirmed by Buyer — Queued for Final Review & Payout
              </div>
              <div style={{ color: '#D1D5DB', fontSize: '0.85rem', lineHeight: '1.4' }}>
                Buyer confirmed receipt of goods. This trade is currently in the G4X Admin/Owner Review Queue for final verification. Once approved, the Seller’s net payout of <strong>${netSellerUsd} USD</strong> will be released immediately to their central wallet balance.
              </div>
            </div>
            <span style={{ fontSize: '0.8rem', color: '#38BDF8', fontWeight: 700, backgroundColor: 'rgba(56, 189, 248, 0.2)', padding: '6px 12px', borderRadius: '6px' }}>
              REVIEW IN PROGRESS
            </span>
          </div>
        )}

        {/* Phase 7: ACTIVE DISPUTE BANNER */}
        {(trade.status === 'DISPUTED' || tradeDispute) && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #EF4444',
              borderRadius: '12px',
              padding: '20px 24px',
              marginBottom: '28px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '2rem' }}>🚨</span>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#EF4444', margin: 0 }}>
                    Formal Dispute Active {tradeDispute ? `(${tradeDispute.disputeCode})` : ''}
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#FCA5A5' }}>
                    Category: <strong>{tradeDispute?.category || 'TRADE_DISPUTE'}</strong> • Status: <strong>{tradeDispute?.status || 'UNDER_REVIEW'}</strong>
                  </div>
                </div>
              </div>
              <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, backgroundColor: '#EF4444', color: '#FFFFFF' }}>
                ESCROW FROZEN
              </span>
            </div>
            {tradeDispute?.description && (
              <div style={{ backgroundColor: '#13151C', padding: '12px', borderRadius: '8px', fontSize: '0.85rem', color: '#D1D5DB' }}>
                <strong>Issue Description:</strong> {tradeDispute.description}
              </div>
            )}
            {tradeDispute?.resolutionOutcome && (
              <div style={{ marginTop: '10px', fontSize: '0.85rem', color: '#10B981' }}>
                <strong>Resolution:</strong> {tradeDispute.resolutionOutcome} {tradeDispute.resolutionNote ? `— ${tradeDispute.resolutionNote}` : ''}
              </div>
            )}
          </div>
        )}

        {/* Phase 7: ADDITIONAL PROOF REQUESTED BANNER */}
        {trade.status === 'ADDITIONAL_PROOF_REQUESTED' && (
          <div
            style={{
              backgroundColor: 'rgba(249, 115, 22, 0.12)',
              border: '1px solid #F97316',
              borderRadius: '12px',
              padding: '20px 24px',
              marginBottom: '28px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '2.5rem' }}>⚠️</div>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div style={{ color: '#F97316', fontWeight: 800, fontSize: '1.1rem', marginBottom: '4px' }}>
                Additional Delivery Evidence Requested
              </div>
              <div style={{ color: '#D1D5DB', fontSize: '0.85rem', lineHeight: '1.4' }}>
                G4X Staff has requested additional delivery proof before approving payout. Please click <strong>Upload Proof</strong> above to attach full-screen screenshots or trade receipts.
              </div>
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

        {/* Phase 6: DISCORD TRADE ROOM PANEL */}
        {trade.status !== 'AWAITING_PAYMENT' && (
          <div
            style={{
              backgroundColor: '#13151C',
              borderRadius: '14px',
              border: '1px solid #5865F2',
              padding: '24px',
              marginBottom: '32px',
              boxShadow: '0 8px 24px rgba(88, 101, 242, 0.12)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.8rem' }}>💬</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                      Discord Trade Room
                    </h2>
                    {trade.discordRoom && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '9999px',
                          backgroundColor:
                            trade.discordRoom.status === 'ACTIVE'
                              ? 'rgba(16, 185, 129, 0.18)'
                              : 'rgba(156, 163, 175, 0.18)',
                          color: trade.discordRoom.status === 'ACTIVE' ? '#10B981' : '#9CA3AF',
                          border: `1px solid ${
                            trade.discordRoom.status === 'ACTIVE' ? '#10B981' : '#4B5563'
                          }`,
                        }}
                      >
                        {trade.discordRoom.status === 'ACTIVE' ? '● LIVE ROOM' : 'ARCHIVED'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#9CA3AF', marginTop: '2px' }}>
                    {trade.discordRoom
                      ? `Channel: #${trade.discordRoom.channelName}`
                      : 'Dedicated private Discord coordination channel between Buyer, Seller & Staff'}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {trade.discordRoom?.channelUrl && trade.discordRoom.status === 'ACTIVE' && (
                  <a
                    href={trade.discordRoom.channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: '#5865F2',
                      color: '#FFFFFF',
                      padding: '10px 20px',
                      borderRadius: '8px',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      boxShadow: '0 4px 12px rgba(88, 101, 242, 0.3)',
                    }}
                  >
                    <span>Open Discord Room</span>
                    <span>↗</span>
                  </a>
                )}

                {trade.discordRoom?.channelUrl && trade.discordRoom.status === 'ARCHIVED' && (
                  <a
                    href={trade.discordRoom.channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: '#27272A',
                      color: '#9CA3AF',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      border: '1px solid #3F3F46',
                    }}
                  >
                    <span>Open Preserved Channel</span>
                    <span>↗</span>
                  </a>
                )}

                {/* Staff Archive Button */}
                {isStaff &&
                  trade.discordRoom &&
                  trade.discordRoom.status === 'ACTIVE' &&
                  ['COMPLETED', 'CANCELLED'].includes(trade.status) && (
                    <button
                      type="button"
                      onClick={handleArchiveDiscordRoom}
                      disabled={archivingRoom}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        color: '#EF4444',
                        border: '1px solid #EF4444',
                        borderRadius: '8px',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: archivingRoom ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {archivingRoom ? 'Archiving...' : 'Archive Discord Room'}
                    </button>
                  )}

                {/* Staff Ensure/Retry Button if room missing on funded trade */}
                {isStaff && !trade.discordRoom && (
                  <button
                    type="button"
                    onClick={handleEnsureDiscordRoom}
                    disabled={ensuringRoom}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#5865F2',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: ensuringRoom ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {ensuringRoom ? 'Creating Room...' : 'Create / Retry Discord Room'}
                  </button>
                )}
              </div>
            </div>

            {/* Room Details & Command Cheat Sheet */}
            {trade.discordRoom?.status === 'ACTIVE' ? (
              <div
                style={{
                  backgroundColor: '#1E202B',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '0.85rem', color: '#D1D5DB' }}>
                  Use the private channel to communicate with your counterparty in real time. All trade interactions are logged securely.
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '10px',
                    fontSize: '0.8rem',
                    paddingTop: '8px',
                    borderTop: '1px solid #2D303E',
                  }}
                >
                  <div style={{ color: '#9CA3AF' }}>
                    <code style={{ color: '#FACC15', backgroundColor: '#13151C', padding: '2px 6px', borderRadius: '4px' }}>
                      G4!exchange info
                    </code>{' '}
                    — View live trade status
                  </div>
                  <div style={{ color: '#9CA3AF' }}>
                    <code style={{ color: '#8B5CF6', backgroundColor: '#13151C', padding: '2px 6px', borderRadius: '4px' }}>
                      G4!exchange proof
                    </code>{' '}
                    — Attach delivery proof screenshot
                  </div>
                  <div style={{ color: '#9CA3AF' }}>
                    <code style={{ color: '#10B981', backgroundColor: '#13151C', padding: '2px 6px', borderRadius: '4px' }}>
                      G4!exchange confirm
                    </code>{' '}
                    — Buyer confirms receipt
                  </div>
                  <div style={{ color: '#9CA3AF' }}>
                    <code style={{ color: '#EF4444', backgroundColor: '#13151C', padding: '2px 6px', borderRadius: '4px' }}>
                      G4!exchange dispute
                    </code>{' '}
                    — Freeze trade & alert staff
                  </div>
                </div>
              </div>
            ) : trade.discordRoom?.status === 'ARCHIVED' ? (
              <div
                style={{
                  backgroundColor: '#1E202B',
                  borderRadius: '10px',
                  padding: '14px 18px',
                  fontSize: '0.85rem',
                  color: '#9CA3AF',
                }}
              >
                🔒 This room was archived on {new Date(trade.discordRoom.archivedAt || trade.discordRoom.updatedAt).toLocaleString()}
                {trade.discordRoom.archiveReason ? ` (${trade.discordRoom.archiveReason})` : ''}. Messages are read-only for audit preservation.
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: '#1E202B',
                  borderRadius: '10px',
                  padding: '14px 18px',
                  fontSize: '0.85rem',
                  color: '#9CA3AF',
                }}
              >
                💬 Discord room creation in progress or pending bot connection. Once active, both parties receive private channel access.
              </div>
            )}
          </div>
        )}

        {/* Phase 7: DELIVERY PROOFS & VERIFICATION GALLERY */}
        {trade.status !== 'AWAITING_PAYMENT' && (
          <div
            style={{
              backgroundColor: '#13151C',
              borderRadius: '14px',
              border: '1px solid #27272A',
              padding: '24px',
              marginBottom: '32px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                  📸 Delivery Proofs & Evidence ({proofs.length})
                </h3>
                <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '2px' }}>
                  Cryptographically timestamped evidence submitted by participants and verified by G4X Escrow.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProofModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#8B5CF6',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Upload Evidence
              </button>
            </div>

            {proofs.length === 0 ? (
              <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '24px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.9rem' }}>
                No delivery proofs uploaded yet. Seller can attach screenshots of the in-game trade window or chat confirmation.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                {proofs.map((proof) => (
                  <div
                    key={proof.id}
                    style={{
                      backgroundColor: '#1E202B',
                      borderRadius: '10px',
                      border: '1px solid #374151',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          backgroundColor: proof.submitterRole === 'SELLER' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                          color: proof.submitterRole === 'SELLER' ? '#10B981' : '#8B5CF6',
                        }}
                      >
                        {proof.submitterRole}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                        {new Date(proof.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {proof.inGameDetails && (
                      <div style={{ fontSize: '0.85rem', color: '#FACC15' }}>
                        <strong>In-Game Details:</strong> {proof.inGameDetails}
                      </div>
                    )}

                    {proof.note && (
                      <div style={{ fontSize: '0.85rem', color: '#D1D5DB' }}>
                        {proof.note}
                      </div>
                    )}

                    {proof.fileUrl && (
                      <div style={{ marginTop: '4px' }}>
                        <a
                          href={proof.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#38BDF8',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            textDecoration: 'none',
                          }}
                        >
                          <span>🔍 View Full Attachment / Screenshot</span>
                          <span>↗</span>
                        </a>
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid #2D303E', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                      <span style={{ color: '#9CA3AF' }}>Status:</span>
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            proof.reviewStatus === 'ACCEPTED'
                              ? '#10B981'
                              : proof.reviewStatus === 'REJECTED'
                              ? '#EF4444'
                              : '#FACC15',
                        }}
                      >
                        {proof.reviewStatus}
                      </span>
                    </div>
                  </div>
                ))}
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

        {/* Phase 7: MODAL 1 — UPLOAD DELIVERY PROOF */}
        {showProofModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
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
                backgroundColor: '#13151C',
                borderRadius: '14px',
                border: '1px solid #374151',
                padding: '24px',
                width: '100%',
                maxWidth: '520px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                  📸 Upload Delivery Evidence
                </h3>
                <button
                  type="button"
                  onClick={() => setShowProofModal(false)}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmitProof}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    Evidence Screenshot or Document URL *
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://... (Imgur, Discord CDN, or direct image link)"
                    value={proofFileUrl}
                    onChange={(e) => setProofFileUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    In-Game Character / Trade Details
                  </label>
                  <input
                    type="text"
                    placeholder="Character name, timestamp, or realm details"
                    value={proofInGameDetails}
                    onChange={(e) => setProofInGameDetails(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    Additional Notes
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Describe how the delivery was executed..."
                    value={proofNote}
                    onChange={(e) => setProofNote(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowProofModal(false)}
                    style={{
                      padding: '10px 18px',
                      backgroundColor: '#1E202B',
                      color: '#D1D5DB',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingProof}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#8B5CF6',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      cursor: submittingProof ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submittingProof ? 'Uploading...' : 'Submit Evidence'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Phase 7: MODAL 2 — CONFIRM IN-GAME DELIVERY */}
        {showConfirmModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
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
                backgroundColor: '#13151C',
                borderRadius: '14px',
                border: '1px solid #10B981',
                padding: '24px',
                width: '100%',
                maxWidth: '520px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10B981', margin: 0 }}>
                  ✅ Confirm Delivery Receipt
                </h3>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '16px', marginBottom: '18px', fontSize: '0.9rem', color: '#D1D5DB', lineHeight: '1.5' }}>
                Please confirm that you have logged into your game and successfully received the agreed{' '}
                <strong style={{ color: '#FACC15' }}>{tradeUnits} {trade.currency?.name}</strong>.
                <br /><br />
                <span style={{ color: '#9CA3AF', fontSize: '0.8rem' }}>
                  ℹ️ Note: Confirming delivery queues the trade into the Admin Final Review queue. Funds are released after administrative verification.
                </span>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                  Optional Confirmation Note:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Received in-game at 14:30 from character X"
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#FFFFFF',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: '#1E202B',
                    color: '#D1D5DB',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Not Yet
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelivery}
                  disabled={confirmingDelivery}
                  style={{
                    padding: '10px 22px',
                    backgroundColor: '#10B981',
                    color: '#000000',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    cursor: confirmingDelivery ? 'not-allowed' : 'pointer',
                  }}
                >
                  {confirmingDelivery ? 'Confirming...' : 'Yes, I Received Goods'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 7: MODAL 3 — OPEN FORMAL DISPUTE */}
        {showDisputeModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
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
                backgroundColor: '#13151C',
                borderRadius: '14px',
                border: '1px solid #EF4444',
                padding: '24px',
                width: '100%',
                maxWidth: '540px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#EF4444', margin: 0 }}>
                  🚨 Report Issue & Open Dispute
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDisputeModal(false)}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #EF4444', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '0.85rem', color: '#FCA5A5' }}>
                ⚠️ <strong>Important:</strong> Opening a dispute immediately freezes trade escrow funds (<code style={{ color: '#FFFFFF' }}>FROZEN_DISPUTE</code>). G4X staff will review logs, chat history, and submitted evidence before making a binding decision.
              </div>

              <form onSubmit={handleSubmitDispute}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    Dispute Reason Category *
                  </label>
                  <select
                    value={disputeCategory}
                    onChange={(e) => setDisputeCategory(e.target.value as DisputeCategory)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  >
                    <option value="BUYER_NOT_RECEIVED">Buyer: Goods Not Received</option>
                    <option value="SELLER_CLAIMS_DELIVERED">Seller: Buyer Not Acknowledging Delivery</option>
                    <option value="PARTIAL_DELIVERY">Partial Delivery / Incomplete Amount</option>
                    <option value="INCORRECT_AMOUNT">Incorrect Quantity or Multiplier</option>
                    <option value="WRONG_REGION">Wrong Character, Realm, or Region</option>
                    <option value="PAYMENT_ISSUE">Payment / Escrow Discrepancy</option>
                    <option value="SUSPECTED_FRAUD">Suspected Fraud or Impersonation</option>
                    <option value="OTHER">Other Issue</option>
                  </select>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    Detailed Explanation *
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Provide a clear, factual explanation of what occurred..."
                    value={disputeDescription}
                    onChange={(e) => setDisputeDescription(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                    Evidence Links (Optional)
                  </label>
                  <input
                    type="url"
                    placeholder="https://... (screenshot / video link)"
                    value={disputeEvidence}
                    onChange={(e) => setDisputeEvidence(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#1E202B',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowDisputeModal(false)}
                    style={{
                      padding: '10px 18px',
                      backgroundColor: '#1E202B',
                      color: '#D1D5DB',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingDispute}
                    style={{
                      padding: '10px 22px',
                      backgroundColor: '#EF4444',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      cursor: submittingDispute ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submittingDispute ? 'Opening Dispute...' : 'Submit & Freeze Trade'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
