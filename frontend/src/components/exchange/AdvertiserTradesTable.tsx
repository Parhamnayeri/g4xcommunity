import React, { useState } from 'react';
import { GoldTrade, PaginationMeta } from '../../types/exchange';
import { reportGoldDelivery, confirmExternalPaymentReceipt, disputeTrade, cancelTrade } from '../../services/exchange';

interface AdvertiserTradesTableProps {
  trades: GoldTrade[];
  pagination: PaginationMeta;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  onFilterChange: (status: string) => void;
  onRefresh: () => void;
}

export const AdvertiserTradesTable: React.FC<AdvertiserTradesTableProps> = ({
  trades,
  pagination,
  loading,
  onPageChange,
  onFilterChange,
  onRefresh,
}) => {
  const safePagination = pagination || { page: 1, limit: 10, total: trades?.length || 0, totalPages: 1 };
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [actionTrade, setActionTrade] = useState<GoldTrade | null>(null);
  const [actionType, setActionType] = useState<'deliver' | 'confirm_receipt' | 'dispute' | 'cancel' | null>(null);
  const [deliveryNotes, setDeliveryNotes] = useState('');
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

  const openAction = (trade: GoldTrade, type: 'deliver' | 'confirm_receipt' | 'dispute' | 'cancel') => {
    setActionTrade(trade);
    setActionType(type);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeliveryNotes('');
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
      if (actionType === 'deliver') {
        await reportGoldDelivery(actionTrade.id, deliveryNotes.trim() || 'IN_GAME_DELIVERY');
        setSuccessMsg('Gold delivery reported successfully. Awaiting exchanger verification.');
      } else if (actionType === 'confirm_receipt') {
        await confirmExternalPaymentReceipt(actionTrade.id);
        setSuccessMsg('Payment receipt confirmed. Trade has been finalized.');
      } else if (actionType === 'dispute') {
        if (!disputeReason.trim()) {
          setErrorMsg('Dispute reason is required.');
          setSubmitting(false);
          return;
        }
        await disputeTrade(actionTrade.id, disputeReason.trim());
        setSuccessMsg('Trade moved to disputed status. Management review initiated.');
      } else if (actionType === 'cancel') {
        await cancelTrade(actionTrade.id, cancelReason.trim() || undefined);
        setSuccessMsg('Trade cancelled successfully.');
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
        return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Pending Delivery</span>;
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
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem' }}>My Gold Sales & Trades</h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Trades where you are selling gold or funding through verified Exchangers.
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
              fontSize: '0.875rem'
            }}
          >
            <option value="">All Statuses</option>
            <option value="PENDING_DELIVERY">Pending Delivery</option>
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
              fontSize: '0.875rem'
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading your trade history...</div>
      ) : trades.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '3rem 1rem' }}>
          <span className="empty-state-icon">🪙</span>
          <p>No trades found. Create a gold sale or P2P funding trade from the marketplace offers.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trade ID</th>
                <th>Created</th>
                <th>Buyer (Exchanger)</th>
                <th>Gold (K)</th>
                <th>Settlement</th>
                <th>Amount to Receive</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const canDeliver = trade.status === 'PENDING_DELIVERY';
                const canConfirmReceipt = trade.status === 'PENDING_PAYMENT' && trade.settlementMethod !== 'USD_WALLET';
                const canDispute = trade.status === 'PENDING_PAYMENT' || trade.status === 'PENDING_DELIVERY';
                const canCancel = trade.status === 'PENDING_DELIVERY';

                return (
                  <tr key={trade.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 700 }}>
                      #{trade.tradeRef || String(trade.id)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(trade.createdAt).toLocaleDateString()} {new Date(trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {trade.buyer?.displayName || trade.buyer?.username || 'Exchanger'}
                    </td>
                    <td style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>
                      {((trade.goldAmountK ?? (trade.goldQuantity / 1000)) || 0).toLocaleString()}k
                    </td>
                    <td>
                      <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                        {trade.settlementMethod}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {trade.settlementMethod === 'USD_WALLET' && `$${(((trade.totalUsdCents ?? trade.agreedValuationUsdCents) || 0) / 100).toFixed(2)} USD`}
                      {trade.settlementMethod === 'IRT_CARD' && `${(trade.settlementAmount || 0).toLocaleString()} Toman`}
                      {trade.settlementMethod === 'CRYPTO_USDT' && `${trade.settlementAmount || (((trade.totalUsdCents ?? trade.agreedValuationUsdCents) || 0) / 100)} USDT`}
                    </td>
                    <td>{formatStatus(trade.status || trade.tradeStatus)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canDeliver && (
                          <button
                            type="button"
                            className="btn btn-cta btn-xs"
                            onClick={() => openAction(trade, 'deliver')}
                          >
                            Report Delivery
                          </button>
                        )}
                        {canConfirmReceipt && (
                          <button
                            type="button"
                            className="btn btn-cta btn-xs"
                            onClick={() => openAction(trade, 'confirm_receipt')}
                          >
                            Confirm Receipt
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
                {actionType === 'deliver' && 'Confirm In-Game Gold Delivery'}
                {actionType === 'confirm_receipt' && 'Confirm Bank/Crypto Payment Received'}
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
                Trade #{actionTrade.tradeRef || String(actionTrade.id)} — {((actionTrade.goldAmountK ?? (actionTrade.goldQuantity / 1000)) || 0).toLocaleString()}k Gold (
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

              {actionType === 'deliver' && (
                <div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '12px' }}>
                    Have you transferred the agreed gold in-game to the exchanger character?
                  </p>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      Delivery Notes / In-Game Character (Optional)
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      placeholder="e.g. Traded to character X on Realm Y"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              {actionType === 'confirm_receipt' && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '16px', lineHeight: 1.5 }}>
                  Please check your bank account or crypto wallet. Once you confirm receipt of payment, this trade will be
                  marked as settled. This action is irreversible.
                </p>
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
                    placeholder="Describe the issue (e.g. exchanger has not sent payment after 2 hours)"
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
                    placeholder="e.g. No longer selling gold"
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
