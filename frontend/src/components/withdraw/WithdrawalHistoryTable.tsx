import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { WithdrawalHistoryItem } from '../../types/withdraw';
import { fetchWithdrawalHistory, cancelWithdrawalRequest } from '../../services/withdraw';

interface WithdrawalHistoryTableProps {
  lastUpdated?: number;
  onBalanceSync?: () => void;
}

export const WithdrawalHistoryTable: React.FC<WithdrawalHistoryTableProps> = ({ lastUpdated, onBalanceSync }) => {
  const [withdrawals, setWithdrawals] = useState<WithdrawalHistoryItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
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
        const pag = res.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 };
        setPage(pag.page ?? 1);
        setTotalPages(pag.totalPages ?? 1);
        setTotalCount(pag.total ?? 0);
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

  const getStatusBadge = (item: WithdrawalHistoryItem) => {
    const raw = (item.status || '').toUpperCase();
    if (raw === 'PAID') {
      return <span className="badge badge-green">Paid</span>;
    }
    if (raw === 'RESERVED' || raw === 'UNDER_ADMIN_REVIEW' || raw === 'PROCESSING') {
      return <span className="badge badge-purple">{item.simplifiedStatus.label}</span>;
    }
    if (raw === 'QUOTED' || raw === 'USER_CONFIRMED' || raw === 'REQUESTED') {
      return <span className="badge badge-amber">{item.simplifiedStatus.label}</span>;
    }
    if (raw === 'REJECTED' || raw === 'CANCELLED' || raw === 'FAILED') {
      return <span className="badge badge-muted">{item.simplifiedStatus.label}</span>;
    }
    return <span className="badge badge-muted">{raw}</span>;
  };

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
          <select
            className="input"
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: 'auto', padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
          >
            <option value="ALL">All Methods</option>
            <option value="USDT_BEP20">USDT (BEP-20)</option>
            <option value="IRT_BANK">Iranian Bank (IRT)</option>
          </select>

          <select
            className="input"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: 'auto', padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
          >
            <option value="ALL">All Statuses</option>
            <option value="PAID">Paid</option>
            <option value="RESERVED">Reserved</option>
            <option value="UNDER_ADMIN_REVIEW">Under Review</option>
            <option value="PROCESSING">Processing</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="REJECTED">Rejected</option>
          </select>
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

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Loading withdrawal records...
        </div>
      ) : withdrawals.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon">💸</div>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>No withdrawal requests found matching your filter criteria.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Date</th>
                <th>Method &amp; Destination</th>
                <th style={{ textAlign: 'right' }}>Requested</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th style={{ textAlign: 'right' }}>Net Payout</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th>Payment Receipt</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <td style={{ padding: '0.65rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
                    #{item.id} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({item.withdrawalRef})</span>
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(item.createdAt)}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontWeight: 700, color: item.payoutMethod === 'USDT_BEP20' ? 'var(--accent-lime)' : 'var(--status-info)' }}>
                      {item.payoutMethod === 'USDT_BEP20' ? 'USDT (BEP-20)' : 'Iranian Bank (IRT)'}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {item.maskedDestinationAddress}
                    </div>
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ${item.requestedUsd}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', color: 'var(--status-warning)' }}>
                    -${item.fixedFeeUsd}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 800, color: 'var(--accent-lime)' }}>
                    {item.payoutMethod === 'IRT_BANK'
                      ? `${Number(item.quotedNetPayoutAmount).toLocaleString()} Toman`
                      : `${item.quotedNetPayoutAmount} USDT`}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                    {getStatusBadge(item)}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.75rem' }}>
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
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                    {(item.status === 'RESERVED' || item.status === 'QUOTED') ? (
                      <button
                        type="button"
                        onClick={() => handleCancelRequest(item)}
                        disabled={cancellingId === item.id}
                        className="btn btn-danger btn-xs"
                        title="Cancel this withdrawal request and release locked funds"
                      >
                        {cancellingId === item.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>
            Showing page {page} of {totalPages} ({totalCount} total requests)
          </span>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => loadData(page - 1)}
              disabled={page <= 1 || loading}
              className="btn btn-secondary btn-sm"
            >
              &larr; Previous
            </button>
            <button
              type="button"
              onClick={() => loadData(page + 1)}
              disabled={page >= totalPages || loading}
              className="btn btn-secondary btn-sm"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};

