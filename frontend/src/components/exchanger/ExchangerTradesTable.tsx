import React, { useState, useMemo } from 'react';
import { GoldTrade, PaginationMeta } from '../../types/exchange';
import {
  verifyExchangerGold,
  submitExchangerPayment,
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
  Input,
  Select,
  Textarea,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';

interface ExchangerTradesTableProps {
  trades: GoldTrade[];
  pagination: PaginationMeta;
  loading: boolean;
  p2pSettlementEnabled?: boolean;
  onPageChange: (newPage: number) => void;
  onFilterChange: (status: string, settlementMethod: string) => void;
  onRefresh: () => void;
}

export const ExchangerTradesTable: React.FC<ExchangerTradesTableProps> = ({
  trades,
  pagination,
  loading,
  p2pSettlementEnabled = false,
  onPageChange,
  onFilterChange,
  onRefresh,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedMethod, setSelectedMethod] = useState<string>('ALL');
  const [actionTrade, setActionTrade] = useState<GoldTrade | null>(null);
  const [actionType, setActionType] = useState<'verify_gold' | 'submit_payment' | 'dispute' | 'cancel' | null>(null);

  // Action form state
  const [paymentRef, setPaymentRef] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleStatusFilter = (val: string) => {
    setSelectedStatus(val);
    onFilterChange(val, selectedMethod);
  };

  const handleMethodFilter = (val: string) => {
    setSelectedMethod(val);
    onFilterChange(selectedStatus, val);
  };

  const openAction = (trade: GoldTrade, type: 'verify_gold' | 'submit_payment' | 'dispute' | 'cancel') => {
    setActionTrade(trade);
    setActionType(type);
    setErrorMsg(null);
    setSuccessMsg(null);
    setPaymentRef('');
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
          actionTrade.settlementMethod,
          actionTrade.quotedPayableAmount || String((actionTrade.agreedValuationUsdCents || 0) / 100)
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
        key: 'seller',
        header: 'Seller (Community)',
        render: (trade) => trade.seller?.displayName || trade.seller?.username || trade.sellerId,
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
        header: 'Payable Amount',
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
          const canVerifyGold = trade.goldDeliveryStatus === 'DELIVERED' || status === 'PENDING_DELIVERY' || status === 'DELIVERY_REPORTED';
          const canSubmitPayment = (trade.goldDeliveryStatus === 'VERIFIED' || status === 'PENDING_PAYMENT') && trade.settlementMethod !== 'USD_WALLET';
          const canDispute = status !== 'SETTLED' && status !== 'CANCELLED' && status !== 'DISPUTED';
          const canCancel = status === 'PENDING_DELIVERY';

          return (
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {canVerifyGold && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openAction(trade, 'verify_gold')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    backgroundColor: 'var(--accent-lime)',
                    color: '#0d0b12',
                  }}
                >
                  Verify Gold
                </Button>
              )}
              {canSubmitPayment && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openAction(trade, 'submit_payment')}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.72rem',
                    backgroundColor: 'var(--primary-purple)',
                    color: '#fff',
                  }}
                >
                  Submit Payment
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
            Gold Trade &amp; Settlement Queue
          </h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Verify incoming game gold deliveries from members and disburse fiat / crypto payouts.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Select
            value={selectedStatus}
            onChange={(e) => handleStatusFilter(e.target.value)}
            options={[
              { label: 'All Statuses', value: 'ALL' },
              { label: 'Pending Delivery', value: 'PENDING_DELIVERY' },
              { label: 'Pending Payment', value: 'PENDING_PAYMENT' },
              { label: 'Settled', value: 'SETTLED' },
              { label: 'Disputed', value: 'DISPUTED' },
              { label: 'Cancelled', value: 'CANCELLED' },
            ]}
          />

          <Select
            value={selectedMethod}
            onChange={(e) => handleMethodFilter(e.target.value)}
            options={[
              { label: 'All Settlement Methods', value: 'ALL' },
              { label: 'USD Wallet (Internal)', value: 'USD_WALLET' },
              { label: 'IRT Bank (Card)', value: 'IRT_DIRECT' },
              { label: 'Crypto USDT', value: 'USDT_DIRECT' },
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
        emptyMessage="No trade requests match the selected filters."
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
            actionType === 'verify_gold'
              ? `Verify Delivery - Trade #${actionTrade.tradeRef || actionTrade.id}`
              : actionType === 'submit_payment'
              ? `Confirm Payment - Trade #${actionTrade.tradeRef || actionTrade.id}`
              : actionType === 'dispute'
              ? `Raise Dispute - Trade #${actionTrade.tradeRef || actionTrade.id}`
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

          {actionType === 'verify_gold' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                Confirm that you received <strong>{(actionTrade.goldQuantity / 1000).toLocaleString()}k Gold</strong> in {actionTrade.gameSlug} from seller <strong>{actionTrade.seller?.displayName || actionTrade.sellerId}</strong>.
              </p>
              {actionTrade.deliveryEvidenceRef && (
                <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-xs)', fontSize: '0.82rem' }}>
                  Delivery Evidence: <code>{actionTrade.deliveryEvidenceRef}</code>
                </div>
              )}
            </div>
          )}

          {actionType === 'submit_payment' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                Payable amount: <strong>{actionTrade.quotedPayableAmount || `$${((actionTrade.agreedValuationUsdCents || 0) / 100).toFixed(2)}`}</strong> via <strong>{actionTrade.settlementMethod}</strong>.
              </p>
              <Input
                label="Bank Tracking Code or Blockchain TxID *"
                placeholder="e.g. 12345678 or 0xabc..."
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
              />
            </div>
          )}

          {actionType === 'dispute' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Textarea
                label="Dispute Reason *"
                placeholder="Explain the discrepancy (e.g. Incomplete gold amount, wrong realm, no delivery within deadline)..."
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
                placeholder="Reason for cancelling this pending order..."
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
                    : actionType === 'verify_gold'
                    ? 'var(--accent-lime)'
                    : 'var(--primary-purple)',
                color: actionType === 'verify_gold' ? '#0d0b12' : '#ffffff',
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

export default ExchangerTradesTable;
