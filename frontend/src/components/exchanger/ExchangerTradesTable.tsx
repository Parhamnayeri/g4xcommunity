import React, { useState } from 'react';
import { GoldTrade, PaginationMeta } from '../../types/exchange';
import { verifyExchangerGold, submitExchangerPayment, disputeTrade, cancelTrade } from '../../services/exchange';

interface ExchangerTradesTableProps {
  trades: GoldTrade[];
  pagination: PaginationMeta;
  loading: boolean;
  p2pSettlementEnabled: boolean;
  onPageChange: (newPage: number) => void;
  onFilterChange: (status: string) => void;
  onRefresh: () => void;
}

export const ExchangerTradesTable: React.FC<ExchangerTradesTableProps> = ({
  trades,
  pagination,
  loading,
  p2pSettlementEnabled,
  onPageChange,
  onFilterChange,
  onRefresh,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [actionTrade, setActionTrade] = useState<GoldTrade | null>(null);
  const [actionType, setActionType] = useState<'verify_gold' | 'submit_payment' | 'dispute' | 'cancel' | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleStatusFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedStatus(val);
    onFilterChange(val);
  };

  const openAction = (trade: GoldTrade, type: 'verify_gold' | 'submit_payment' | 'dispute' | 'cancel') => {
    setActionTrade(trade);
    setActionType(type);
    setErrorMsg(null);
    setSuccessMsg(null);
    setPaymentRef('');
    setVerificationNotes('');
    setDisputeReason('');
    setCancelReason('');
  };

  const closeAction = () => {
    setActionTrade(null);
    setActionType(null);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleExecuteAction = async () => {
    if (!actionTrade || !actionType) return;
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (actionType === 'verify_gold') {
        const res = await verifyExchangerGold(actionTrade.id, verificationNotes || undefined);
        if (actionTrade.settlementMethod === 'USD_WALLET') {
          if (p2pSettlementEnabled) {
            setSuccessMsg('Gold verified and USD Wallet settlement completed successfully.');
          } else {
            setSuccessMsg('Gold verified. Automated wallet settlement is gated for review (FINANCE_V2_P2P_SETTLEMENT_ENABLED=false).');
          }
        } else {
          setSuccessMsg('Gold verified. Please proceed with Card/Crypto payment to the seller.');
        }
      } else if (actionType === 'submit_payment') {
        if (!paymentRef.trim()) {
          setErrorMsg('Payment reference or transaction ID is required.');
          setSubmitting(false);
          return;
        }
        await submitExchangerPayment(actionTrade.id, paymentRef.trim());
        setSuccessMsg('Payment submitted. The seller has been notified to verify their funds.');
      } else if (actionType === 'dispute') {
        if (!disputeReason.trim()) {
          setErrorMsg('Dispute reason is required.');
          setSubmitting(false);
          return;
        }
        await disputeTrade(actionTrade.id, disputeReason.trim());
        setSuccessMsg('Trade placed in dispute. Management will review transaction logs.');
      } else if (actionType === 'cancel') {
        await cancelTrade(actionTrade.id, cancelReason.trim() || undefined);
        setSuccessMsg('Trade cancelled successfully. Any reserved funds have been returned.');
      }
      setTimeout(() => {
        closeAction();
        onRefresh();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'PENDING_DELIVERY':
        return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Pending Gold Delivery</span>;
      case 'PENDING_PAYMENT':
        return <span style={{ color: '#38bdf8', fontWeight: 600 }}>Pending Payment</span>;
      case 'SETTLED':
        return <span style={{ color: '#10b981', fontWeight: 600 }}>Settled</span>;
      case 'CANCELLED':
        return <span style={{ color: '#ef4444', fontWeight: 600 }}>Cancelled</span>;
      case 'DISPUTED':
        return <span style={{ color: '#ec4899', fontWeight: 600 }}>Disputed</span>;
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-subtle)', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Purchases & Fulfilled Trades</h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Trades where community members are delivering gold or requesting P2P funding through you.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={selectedStatus}
            onChange={handleStatusFilter}
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '0.875rem',
            }}
          >
            <option value="">All Statuses</option>
            <option value="PENDING_DELIVERY">Pending Gold Delivery</option>
            <option value="PENDING_PAYMENT">Pending Payment</option>
            <option value="SETTLED">Settled</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="DISPUTED">Disputed</option>
          </select>
          <button
            onClick={onRefresh}
            style={{
              padding: '8px 14px',
              backgroundColor: 'var(--bg-surface-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {!p2pSettlementEnabled && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.825rem',
            color: '#f59e0b',
          }}
        >
          ℹ️ <strong>Settlement Safety Mode Active:</strong> Direct WalletV2 automatic releases are disabled. USD wallet trades verify safely and queue for financial review.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading assigned trades...</div>
      ) : trades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
          No trades found. Published offers will appear here when sellers initiate trades.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 8px' }}>Trade ID</th>
                <th style={{ padding: '12px 8px' }}>Created</th>
                <th style={{ padding: '12px 8px' }}>Seller (Community)</th>
                <th style={{ padding: '12px 8px' }}>Gold (K)</th>
                <th style={{ padding: '12px 8px' }}>Settlement</th>
                <th style={{ padding: '12px 8px' }}>Payable Amount</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const canVerifyGold = trade.status === 'PENDING_DELIVERY';
                const canSubmitPayment = trade.status === 'PENDING_PAYMENT' && trade.settlementMethod !== 'USD_WALLET';
                const canDispute = trade.status === 'PENDING_DELIVERY' || trade.status === 'PENDING_PAYMENT';
                const canCancel = trade.status === 'PENDING_DELIVERY';

                return (
                  <tr key={trade.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                      #{trade.id.substring(0, 8)}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(trade.createdAt).toLocaleDateString()} {new Date(trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-primary)' }}>
                      {trade.seller?.displayName || trade.seller?.username || 'Seller'}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--accent-lime)', fontWeight: 600 }}>
                      {trade.goldAmountK.toLocaleString()}k
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          backgroundColor:
                            trade.settlementMethod === 'USD_WALLET'
                              ? 'rgba(124, 58, 237, 0.2)'
                              : trade.settlementMethod === 'IRT_CARD'
                              ? 'rgba(204, 255, 0, 0.15)'
                              : 'rgba(56, 189, 248, 0.2)',
                          color:
                            trade.settlementMethod === 'USD_WALLET'
                              ? 'var(--primary-purple)'
                              : trade.settlementMethod === 'IRT_CARD'
                              ? 'var(--accent-lime)'
                              : '#38bdf8',
                        }}
                      >
                        {trade.settlementMethod}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {trade.settlementMethod === 'USD_WALLET' && `$${(trade.totalUsdCents / 100).toFixed(2)} USD`}
                      {trade.settlementMethod === 'IRT_CARD' && `${(trade.settlementAmount || 0).toLocaleString()} Toman`}
                      {trade.settlementMethod === 'CRYPTO_USDT' && `${trade.settlementAmount || (trade.totalUsdCents / 100)} USDT`}
                    </td>
                    <td style={{ padding: '12px 8px' }}>{formatStatus(trade.status)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canVerifyGold && (
                          <button
                            onClick={() => openAction(trade, 'verify_gold')}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: 'var(--accent-lime)',
                              color: 'var(--text-inverse)',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Verify Gold
                          </button>
                        )}
                        {canSubmitPayment && (
                          <button
                            onClick={() => openAction(trade, 'submit_payment')}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: 'var(--primary-purple)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Submit Payment
                          </button>
                        )}
                        {canCancel && (
                          <button
                            onClick={() => openAction(trade, 'cancel')}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: 'transparent',
                              color: '#ef4444',
                              border: '1px solid #ef4444',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        {canDispute && (
                          <button
                            onClick={() => openAction(trade, 'dispute')}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: 'transparent',
                              color: '#ec4899',
                              border: '1px solid #ec4899',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            Dispute
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Showing {trades.length} of {pagination.total} trades (Page {pagination.page} of {pagination.totalPages || 1})
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(pagination.page - 1)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--bg-main)',
                  color: pagination.page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Previous
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange(pagination.page + 1)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'var(--bg-main)',
                  color: pagination.page >= pagination.totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {actionTrade && actionType && (
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
              maxWidth: '480px',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '1.2rem' }}>
              {actionType === 'verify_gold' && 'Verify In-Game Gold Received'}
              {actionType === 'submit_payment' && 'Submit Payment Details to Seller'}
              {actionType === 'dispute' && 'Raise Trade Dispute'}
              {actionType === 'cancel' && 'Cancel Gold Trade'}
            </h3>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Trade #{actionTrade.id.substring(0, 8)} — {actionTrade.goldAmountK.toLocaleString()}k Gold (
              {actionTrade.settlementMethod})
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

            {actionType === 'verify_gold' && (
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '12px' }}>
                  Confirm that you have received the exact amount of {actionTrade.goldAmountK.toLocaleString()}k Gold in-game.
                </p>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Verification Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={verificationNotes}
                    onChange={(e) => setVerificationNotes(e.target.value)}
                    placeholder="e.g. Received on character Y"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>
            )}

            {actionType === 'submit_payment' && (
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '12px' }}>
                  Payable Amount:{' '}
                  <strong>
                    {actionTrade.settlementMethod === 'IRT_CARD'
                      ? `${(actionTrade.settlementAmount || 0).toLocaleString()} Toman`
                      : `${actionTrade.settlementAmount || (actionTrade.totalUsdCents / 100)} USDT`}
                  </strong>
                </p>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Payment Reference / Bank Tracking ID / TXID <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="e.g. Ref# 928371928 or BSC TX Hash"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>
            )}

            {actionType === 'dispute' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Reason for Dispute <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  rows={3}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Describe the issue (e.g. seller did not show up in-game)"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            )}

            {actionType === 'cancel' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Reason for Cancellation (Optional)
                </label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. In-game server maintenance"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={closeAction}
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
                type="button"
                onClick={handleExecuteAction}
                disabled={submitting}
                style={{
                  padding: '10px 20px',
                  backgroundColor:
                    actionType === 'dispute' || actionType === 'cancel' ? '#ef4444' : 'var(--accent-lime)',
                  color: actionType === 'dispute' || actionType === 'cancel' ? '#fff' : 'var(--text-inverse)',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                {submitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
