import React, { useState, useMemo } from 'react';
import { GoldTrade, PaginationMeta } from '../../types/exchange';
import {
  reportGoldDelivery,
  confirmExternalPaymentReceipt,
  disputeTrade,
  cancelTrade,
} from '../../services/exchange';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Modal,
  Select,
  Textarea,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';

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

  const handleStatusFilter = (val: string) => {
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
        if (!deliveryNotes.trim()) {
          setErrorMsg('Delivery screenshot link or in-game transaction ref is required.');
          setSubmitting(false);
          return;
        }
        await reportGoldDelivery(actionTrade.id, deliveryNotes.trim());
        setSuccessMsg('Delivery reported. Exchanger will inspect and release payment.');
      } else if (actionType === 'confirm_receipt') {
        await confirmExternalPaymentReceipt(actionTrade.id);
        setSuccessMsg('Payment receipt confirmed. Trade settled successfully.');
      } else if (actionType === 'dispute') {
        if (!disputeReason.trim()) {
          setErrorMsg('Dispute reason is required.');
          setSubmitting(false);
          return;
        }
        await disputeTrade(actionTrade.id, disputeReason.trim());
        setSuccessMsg('Trade placed in dispute. Management will review logs.');
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

  const columns: Column<GoldTrade>[] = useMemo(
    () => [
      {
        key: 'tradeRef',
        header: 'Trade Ref',
        render: (trade) => (
          <div>
            <strong style={{ fontFamily: 'monospace' }}>#{trade.tradeRef || String(trade.id)}</strong>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {trade.gameSlug}
            </div>
          </div>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        render: (trade) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            {new Date(trade.createdAt).toLocaleDateString()} {new Date(trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ),
      },
      {
        key: 'buyer',
        header: 'Buyer (Exchanger)',
        render: (trade) => trade.buyer?.displayName || trade.buyer?.username || trade.buyerId,
      },
      {
        key: 'goldQuantity',
        header: 'Gold',
        align: 'right',
        render: (trade) => (
          <span style={{ color: 'var(--accent-lime)', fontWeight: 700 }}>
            {(trade.goldQuantity / 1000).toLocaleString()}k
          </span>
        ),
      },
      {
        key: 'settlementMethod',
        header: 'Settlement',
        render: (trade) => (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-xs)',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor:
                trade.settlementMethod === 'USD_WALLET'
                  ? 'rgba(124, 58, 237, 0.2)'
                  : trade.settlementMethod === 'IRT_DIRECT' || trade.settlementMethod === 'IRT_CARD'
                  ? 'rgba(204, 255, 0, 0.15)'
                  : 'rgba(56, 189, 248, 0.2)',
              color:
                trade.settlementMethod === 'USD_WALLET'
                  ? 'var(--primary-purple)'
                  : trade.settlementMethod === 'IRT_DIRECT' || trade.settlementMethod === 'IRT_CARD'
                  ? 'var(--accent-lime)'
                  : '#38bdf8',
            }}
          >
            {trade.settlementMethod}
          </span>
        ),
      },
      {
        key: 'payableAmount',
        header: 'Amount to Receive',
        align: 'right',
        render: (trade) => (
          <span style={{ fontWeight: 700 }}>
            {trade.quotedPayableAmount
              ? `${trade.quotedPayableAmount} ${trade.quotedPayableCurrency || ''}`
              : `$${((trade.agreedValuationUsdCents || 0) / 100).toFixed(2)} USD`}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (trade) => (
          <StatusBadge
            status={trade.tradeStatus.toLowerCase()}
            simplifiedStatus={trade.simplifiedStatus?.label}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (trade) => {
          const status = trade.tradeStatus;
          const canDeliver = trade.goldDeliveryStatus === 'PENDING' || status === 'PENDING_DELIVERY';
          const canConfirmReceipt =
            (trade.paymentStatus === 'SUBMITTED' || status === 'PENDING_PAYMENT') &&
            trade.settlementMethod !== 'USD_WALLET';
          const canDispute = status !== 'SETTLED' && status !== 'CANCELLED' && status !== 'DISPUTED';
          const canCancel = trade.goldDeliveryStatus === 'PENDING' && status === 'PENDING_DELIVERY';

          return (
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {canDeliver && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openAction(trade, 'deliver')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    backgroundColor: 'var(--accent-lime)',
                    color: '#0d0b12',
                  }}
                >
                  Report Delivery
                </Button>
              )}
              {canConfirmReceipt && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openAction(trade, 'confirm_receipt')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    backgroundColor: '#10b981',
                    color: '#fff',
                  }}
                >
                  Confirm Payment
                </Button>
              )}
              {canDispute && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openAction(trade, 'dispute')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    color: 'var(--status-danger)',
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                  }}
                >
                  Dispute
                </Button>
              )}
              {canCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openAction(trade, 'cancel')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <Card style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 800 }}>
            My Trades &amp; Orders
          </h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Track the progress of your gold sales and P2P exchange settlements.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={selectedStatus}
            onChange={(e) => handleStatusFilter(e.target.value)}
            options={[
              { label: 'All Statuses', value: '' },
              { label: 'Pending Delivery', value: 'PENDING_DELIVERY' },
              { label: 'Pending Payment', value: 'PENDING_PAYMENT' },
              { label: 'Settled', value: 'SETTLED' },
              { label: 'Disputed', value: 'DISPUTED' },
              { label: 'Cancelled', value: 'CANCELLED' },
            ]}
          />

          <Button
            onClick={onRefresh}
            variant="outline"
            size="sm"
          >
            ↻ Refresh
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={trades}
        keyField="id"
        loading={loading}
        emptyMessage="No trades found. Create a gold sale or P2P funding trade from the marketplace offers."
      />

      <Pagination
        pagination={normalizePagination(pagination, pagination?.page ?? 1, 10)}
        onPageChange={(p) => onPageChange(p)}
      />

      {/* Action Modal */}
      {actionTrade && actionType && (
        <Modal
          isOpen={!!actionTrade}
          onClose={closeAction}
          title={
            actionType === 'deliver'
              ? `Report Gold Delivery - #${actionTrade.tradeRef || actionTrade.id}`
              : actionType === 'confirm_receipt'
              ? `Confirm Payment Received - #${actionTrade.tradeRef || actionTrade.id}`
              : actionType === 'dispute'
              ? `Raise Dispute - #${actionTrade.tradeRef || actionTrade.id}`
              : `Cancel Trade - #${actionTrade.tradeRef || actionTrade.id}`
          }
          size="md"
        >
          {errorMsg && (
            <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.85rem' }}>
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div style={{ padding: '10px 14px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.85rem' }}>
              {successMsg}
            </div>
          )}

          {actionType === 'deliver' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                Deliver <strong>{(actionTrade.goldQuantity / 1000).toLocaleString()}k Gold</strong> to buyer <strong>{actionTrade.buyer?.displayName || actionTrade.buyerId}</strong> in <strong>{actionTrade.gameSlug}</strong>.
              </p>
              <Textarea
                label="Delivery Evidence Link / Notes *"
                placeholder="Paste imgur link, video recording URL, or in-game mail confirmation code..."
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {actionType === 'confirm_receipt' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                Please check your bank account or crypto wallet to verify that you received the expected settlement amount before confirming.
              </p>
              {actionTrade.externalPaymentRef && (
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-xs)', fontSize: '0.82rem' }}>
                  Exchanger Payment Reference: <code>{actionTrade.externalPaymentRef}</code>
                </div>
              )}
            </div>
          )}

          {actionType === 'dispute' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Textarea
                label="Dispute Reason *"
                placeholder="State the reason for this dispute clearly..."
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {actionType === 'cancel' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Textarea
                label="Cancellation Reason (Optional)"
                placeholder="Why do you wish to cancel this trade request?..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeAction}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={submitting}
              onClick={handleExecuteAction}
              style={{
                backgroundColor:
                  actionType === 'dispute'
                    ? 'var(--status-danger)'
                    : actionType === 'deliver'
                    ? 'var(--accent-lime)'
                    : '#10b981',
                color: actionType === 'deliver' ? '#0d0b12' : '#ffffff',
                fontWeight: 700,
              }}
            >
              {submitting ? 'Executing...' : 'Confirm Action'}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
};

export default AdvertiserTradesTable;
