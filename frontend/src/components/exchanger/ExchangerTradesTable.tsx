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
  const safePagination = pagination || { page: 1, limit: 10, total: trades?.length || 0, totalPages: 1 };
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
        await verifyExchangerGold(actionTrade.id);
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
        await submitExchangerPayment(
          actionTrade.id,
          paymentRef.trim(),
          actionTrade.settlementMethod || 'MANUAL'
        );
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
        <div className="empty-state-box" style={{ padding: '3rem 1rem' }}>
          <span className="empty-state-icon">🪙</span>
          <p>No trades found. Published offers will appear here when sellers initiate trades.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trade ID</th>
                <th>Created</th>
                <th>Seller (Community)</th>
                <th>Gold (K)</th>
                <th>Settlement</th>
                <th>Payable Amount</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const currentStatus = trade.tradeStatus || trade.status || 'PENDING_DELIVERY';
                const canVerifyGold = currentStatus === 'PENDING_DELIVERY' || trade.goldDeliveryStatus === 'PENDING';
                const canSubmitPayment = (currentStatus === 'PENDING_PAYMENT' || trade.paymentStatus === 'PENDING') && trade.settlementMethod !== 'USD_WALLET';
                const canDispute = currentStatus === 'PENDING_DELIVERY' || currentStatus === 'PENDING_PAYMENT';
                const canCancel = currentStatus === 'PENDING_DELIVERY';
                const goldK = trade.goldAmountK !== undefined ? trade.goldAmountK : (trade.goldQuantity ? Math.round(trade.goldQuantity / 1000) : 0);
                const usdCents = trade.totalUsdCents !== undefined ? trade.totalUsdCents : (trade.agreedValuationUsdCents || 0);
                const settlementAmt = trade.settlementAmount !== undefined && trade.settlementAmount !== null
                  ? trade.settlementAmount
                  : (trade.quotedPayableAmount ? Number(trade.quotedPayableAmount) : (usdCents / 100));

                return (
                  <tr key={trade.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 700 }}>
                      #{trade.tradeRef || String(trade.id)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(trade.createdAt).toLocaleDateString()} {new Date(trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {trade.seller?.displayName || trade.seller?.username || 'Seller'}
                    </td>
                    <td style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>
                      {goldK.toLocaleString()}k
                    </td>
                    <td>
                      <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                        {trade.settlementMethod}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {trade.settlementMethod === 'USD_WALLET' && `$${(usdCents / 100).toFixed(2)} USD`}
                      {trade.settlementMethod === 'IRT_CARD' && `${(settlementAmt || 0).toLocaleString()} Toman`}
                      {trade.settlementMethod !== 'USD_WALLET' && trade.settlementMethod !== 'IRT_CARD' && `${settlementAmt || (usdCents / 100)} USDT`}
                    </td>
                    <td>{formatStatus(currentStatus)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canVerifyGold && (
                          <button
                            type="button"
                            className="btn btn-cta btn-xs"
                            onClick={() => openAction(trade, 'verify_gold')}
                          >
                            Verify Gold
                          </button>
                        )}
                        {canSubmitPayment && (
                          <button
                            type="button"
                            className="btn btn-cta btn-xs"
                            onClick={() => openAction(trade, 'submit_payment')}
                          >
                            Submit Payment
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => openAction(trade, 'cancel')}
                          >
                            Cancel
                          </button>
                        )}
                        {canDispute && (
                          <button
                            type="button"
                            className="btn btn-danger btn-xs"
                            onClick={() => openAction(trade, 'dispute')}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Showing {trades.length} of {safePagination.total} trades (Page {safePagination.page} of {safePagination.totalPages || 1})
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                disabled={safePagination.page <= 1}
                onClick={() => onPageChange(safePagination.page - 1)}
                className="btn btn-secondary btn-sm"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={safePagination.page >= safePagination.totalPages}
                onClick={() => onPageChange(safePagination.page + 1)}
                className="btn btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Execution Modal */}
      {actionTrade && actionType && (
        <div className="studio-modal-backdrop" onClick={closeAction}>
          <div className="studio-modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700 }}>
                {actionType === 'verify_gold' && 'Verify In-Game Gold Received'}
                {actionType === 'submit_payment' && 'Submit Payment Details to Seller'}
                {actionType === 'dispute' && 'Raise Trade Dispute'}
                {actionType === 'cancel' && 'Cancel Gold Trade'}
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={closeAction}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Trade #{actionTrade.tradeRef || String(actionTrade.id)} — {(actionTrade.goldAmountK ?? (actionTrade.goldQuantity ? Math.round(actionTrade.goldQuantity / 1000) : 0)).toLocaleString()}k Gold (
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
                    Confirm that you have received the exact amount of {(actionTrade.goldAmountK ?? (actionTrade.goldQuantity ? Math.round(actionTrade.goldQuantity / 1000) : 0)).toLocaleString()}k Gold in-game.
                  </p>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Verification Notes (Optional)
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={verificationNotes}
                      onChange={(e) => setVerificationNotes(e.target.value)}
                      placeholder="e.g. Received on character Y"
                      style={{ width: '100%' }}
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
                        : `${actionTrade.settlementAmount || ((actionTrade.totalUsdCents || actionTrade.agreedValuationUsdCents || 0) / 100)} USDT`}
                    </strong>
                  </p>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Payment Reference / Bank Tracking ID / TXID <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="input"
                      required
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      placeholder="e.g. Ref# 928371928 or BSC TX Hash"
                      style={{ width: '100%' }}
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
                    className="input"
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="Describe the issue (e.g. seller did not show up in-game)"
                    style={{ width: '100%' }}
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
                    className="input"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="e.g. In-game server maintenance"
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>

            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={closeAction}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={actionType === 'dispute' || actionType === 'cancel' ? 'btn btn-danger btn-sm' : 'btn btn-cta btn-sm'}
                onClick={handleExecuteAction}
                disabled={submitting}
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
