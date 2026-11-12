import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Select,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';
import { WithdrawalHistoryItem } from '../../types/withdraw';
import { fetchWithdrawalHistory, cancelWithdrawalRequest } from '../../services/withdraw';

interface WithdrawalHistoryTableProps {
  lastUpdated?: number;
  onBalanceSync?: () => void;
}

export const WithdrawalHistoryTable: React.FC<WithdrawalHistoryTableProps> = ({ lastUpdated, onBalanceSync }) => {
  const [withdrawals, setWithdrawals] = useState<WithdrawalHistoryItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadData = async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithdrawalHistory({
        page: targetPage,
        limit: 10,
        status: statusFilter,
        payoutMethod: methodFilter,
      });

      if (res.success) {
        setWithdrawals(res.withdrawals || []);
        setPage(res.pagination?.page ?? targetPage);
        setPagination(normalizePagination(res.pagination || res, targetPage, 10));
      } else {
        setError(res.error || 'Failed to retrieve withdrawal history.');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred while loading withdrawal history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(1);
  }, [statusFilter, methodFilter, lastUpdated]);

  const handleCancelRequest = async (item: WithdrawalHistoryItem) => {
    const confirmCancel = window.confirm(
      `Cancel withdrawal #${item.id} (${item.withdrawalRef})? The reserved amount of $${item.requestedUsd} will be released back to your available balance.`
    );
    if (!confirmCancel) return;

    setCancellingId(item.id);
    setError(null);
    setActionSuccess(null);

    try {
      const res = await cancelWithdrawalRequest(item.id, 'Cancelled by user from portal');
      if (res.success) {
        setActionSuccess(`Withdrawal #${item.id} was successfully cancelled. Reserved funds returned to Available balance.`);
        loadData(page);
        if (onBalanceSync) onBalanceSync();
      } else {
        setError(res.error || 'Failed to cancel withdrawal request.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to cancel withdrawal request.');
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const columns: Column<WithdrawalHistoryItem>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'Reference',
        render: (item) => (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
            #{item.id} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({item.withdrawalRef})</span>
          </span>
        ),
      },
      {
        key: 'createdAt',
        header: 'Date',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {formatDate(item.createdAt)}
          </span>
        ),
      },
      {
        key: 'method',
        header: 'Method & Destination',
        render: (item) => (
          <div>
            <div style={{ fontWeight: 700, color: item.payoutMethod === 'USDT_BEP20' ? 'var(--accent-lime)' : 'var(--status-info)' }}>
              {item.payoutMethod === 'USDT_BEP20' ? 'USDT (BEP-20)' : 'Iranian Bank (IRT)'}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {item.maskedDestinationAddress}
            </div>
          </div>
        ),
      },
      {
        key: 'requestedUsd',
        header: 'Requested',
        align: 'right',
        render: (item) => (
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            ${item.requestedUsd}
          </span>
        ),
      },
      {
        key: 'fixedFeeUsd',
        header: 'Fee',
        align: 'right',
        render: (item) => (
          <span style={{ color: 'var(--status-warning)' }}>
            -${item.fixedFeeUsd}
          </span>
        ),
      },
      {
        key: 'quotedNetPayoutAmount',
        header: 'Net Payout',
        align: 'right',
        render: (item) => (
          <span style={{ fontWeight: 800, color: 'var(--accent-lime)' }}>
            {item.payoutMethod === 'IRT_BANK'
              ? `${Number(item.quotedNetPayoutAmount).toLocaleString()} Toman`
              : `${item.quotedNetPayoutAmount} USDT`}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        align: 'center',
        render: (item) => <StatusBadge status={item.status} simplifiedStatus={item.simplifiedStatus?.label} />,
      },
      {
        key: 'receipt',
        header: 'Payment Receipt',
        render: (item) => (
          <span style={{ fontSize: '0.75rem' }}>
            {item.externalTxHash ? (
              item.txExplorerUrl ? (
                <a
                  href={item.txExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: 'monospace',
                    color: 'var(--primary-purple)',
                    textDecoration: 'underline',
                  }}
                >
                  Tx: {item.externalTxHash} ↗
                </a>
              ) : (
                <span style={{ fontFamily: 'monospace', color: 'var(--primary-purple)' }}>
                  Tx: {item.externalTxHash}
                </span>
              )
            ) : item.bankSettled ? (
              <span style={{ fontFamily: 'monospace', color: 'var(--status-success)', fontWeight: 600 }}>
                ✓ Bank Settled
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending manual payout</span>
            )}
          </span>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        align: 'center',
        render: (item) => {
          const isCancellable = ['QUOTED', 'REQUESTED', 'USER_CONFIRMED', 'PENDING'].includes(item.status);
          if (!isCancellable) {
            return (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
            );
          }
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={cancellingId === item.id}
              onClick={() => handleCancelRequest(item)}
              style={{
                color: 'var(--status-danger)',
                borderColor: 'rgba(239, 68, 68, 0.4)',
                padding: '0.2rem 0.5rem',
                fontSize: '0.72rem',
              }}
            >
              {cancellingId === item.id ? 'Cancelling...' : 'Cancel'}
            </Button>
          );
        },
      },
    ],
    [cancellingId]
  );

  return (
    <Card highlight="none" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            Withdrawal Requests &amp; Payment History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Historical record of your submitted payouts, fees, cancellation and payment receipts.
          </p>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Select
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { label: 'All Methods', value: 'ALL' },
              { label: 'USDT (BEP-20)', value: 'USDT_BEP20' },
              { label: 'Iranian Bank (IRT)', value: 'IRT_BANK' },
            ]}
          />

          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { label: 'All Statuses', value: 'ALL' },
              { label: 'Paid', value: 'PAID' },
              { label: 'Reserved', value: 'RESERVED' },
              { label: 'Under Review', value: 'UNDER_ADMIN_REVIEW' },
              { label: 'Processing', value: 'PROCESSING' },
              { label: 'Cancelled', value: 'CANCELLED' },
              { label: 'Rejected', value: 'REJECTED' },
            ]}
          />
        </div>
      </div>

      {actionSuccess && (
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--status-success)', fontSize: '0.82rem' }}>
          ✓ {actionSuccess}
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--status-danger)', fontSize: '0.82rem' }}>
          ⚠ {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={withdrawals}
        keyField="id"
        loading={loading}
        emptyMessage="No withdrawal requests found matching your filter criteria."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(p) => loadData(p)}
      />
    </Card>
  );
};

export default WithdrawalHistoryTable;
