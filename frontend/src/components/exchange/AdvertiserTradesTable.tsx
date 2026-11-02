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
        await reportGoldDelivery(actionTrade.id, deliveryNotes || undefined);
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
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
          No trades found. Create a gold sale or P2P funding trade from the marketplace offers.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 8px' }}>Trade ID</th>
                <th style={{ padding: '12px 8px' }}>Created</th>
                <th style={{ padding: '12px 8px' }}>Buyer (Exchanger)</th>
                <th style={{ padding: '12px 8px' }}>Gold (K)</th>
                <th style={{ padding: '12px 8px' }}>Settlement</th>
                <th style={{ padding: '12px 8px' }}>Amount to Receive</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const canDeliver = trade.status === 'PENDING_DELIVERY';
                const canConfirmReceipt = trade.status === 'PENDING_PAYMENT' && trade.settlementMethod !== 'USD_WALLET';
                const canDispute = trade.status === 'PENDING_PAYMENT' || trade.status === 'PENDING_DELIVERY';
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
                      {trade.buyer?.displayName || trade.buyer?.username || 'Exchanger'}
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
                        {canDeliver && (
                          <button
                            onClick={() => openAction(trade, 'deliver')}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: 'var(--accent-lime)',
                              color: 'var(--text-inverse)',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Report Delivery
                          </button>
                        )}
                        {canConfirmReceipt && (
                          <button
                            onClick={() => openAction(trade, 'confirm_receipt')}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: '#10b981',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Confirm Payment Received
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
                              cursor: 'pointer'
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
                              cursor: 'pointer'
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
                  fontSize: '0.85rem'
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
                  fontSize: '0.85rem'
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
            padding: '16px'
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
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '1.2rem' }}>
              {actionType === 'deliver' && 'Confirm In-Game Gold Delivery'}
              {actionType === 'confirm_receipt' && 'Confirm Bank/Crypto Payment Received'}
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
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="e.g. Traded to character X on Realm Y"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '0.875rem'
                    }}
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
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Describe the issue (e.g. exchanger has not sent payment after 2 hours)"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.875rem'
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
                  placeholder="e.g. No longer selling gold"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    fontSize: '0.875rem'
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
                  fontSize: '0.875rem'
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
                  fontSize: '0.875rem'
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
