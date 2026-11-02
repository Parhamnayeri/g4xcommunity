import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { WithdrawalHistoryItem } from '../../types/withdraw';
import { fetchWithdrawalHistory } from '../../services/withdraw';

interface WithdrawalHistoryTableProps {
  lastUpdated?: number;
}

export const WithdrawalHistoryTable: React.FC<WithdrawalHistoryTableProps> = ({ lastUpdated }) => {
  const [withdrawals, setWithdrawals] = useState<WithdrawalHistoryItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
        setWithdrawals(res.withdrawals);
        setPage(res.pagination.page);
        setTotalPages(res.pagination.totalPages);
        setTotalCount(res.pagination.total);
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
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.25rem 0' }}>
            Withdrawal Requests &amp; Payment History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Historical record of your submitted payouts, fees and payment receipts.
          </p>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(15, 12, 28, 0.7)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              padding: '0.4rem 0.65rem',
              color: 'var(--text-main)',
              fontSize: '0.78rem',
            }}
          >
            <option value="ALL">All Methods</option>
            <option value="USDT_BEP20">USDT (BEP-20)</option>
            <option value="IRT_BANK">Iranian Bank (IRT)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(15, 12, 28, 0.7)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              padding: '0.4rem 0.65rem',
              color: 'var(--text-main)',
              fontSize: '0.78rem',
            }}
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

      {error && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#f87171', fontSize: '0.82rem' }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Loading withdrawal records...
        </div>
      ) : withdrawals.length === 0 ? (
        <div
          style={{
            padding: '2.5rem',
            textAlign: 'center',
            backgroundColor: 'rgba(15, 12, 28, 0.4)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            fontSize: '0.88rem',
          }}
        >
          No withdrawal requests found matching your filter criteria.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>Reference</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>Date</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>Method &amp; Destination</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Requested</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Fee</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Net Payout</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700, textAlign: 'center' }}>Status</th>
                <th style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>Payment Receipt</th>
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
                  <td style={{ padding: '0.65rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-main)' }}>
                    #{item.id} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({item.withdrawalRef})</span>
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(item.createdAt)}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    <div style={{ fontWeight: 700, color: item.payoutMethod === 'USDT_BEP20' ? 'var(--accent-lime)' : '#93c5fd' }}>
                      {item.payoutMethod === 'USDT_BEP20' ? 'USDT (BEP-20)' : 'Iranian Bank (IRT)'}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {item.maskedDestinationAddress}
                    </div>
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-main)' }}>
                    ${item.requestedUsd}
                  </td>

                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', color: '#f59e0b' }}>
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
                      <span style={{ fontFamily: 'monospace', color: '#a78bfa' }} title={item.rawTxHash || ''}>
                        Tx: {item.externalTxHash}
                      </span>
                    ) : item.bankReceiptRef ? (
                      <span style={{ fontFamily: 'monospace', color: '#93c5fd' }}>
                        Ref: {item.bankReceiptRef}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending manual payout</span>
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
              className="btn btn-outline btn-sm"
              style={{ padding: '0.25rem 0.6rem' }}
            >
              &larr; Previous
            </button>
            <button
              type="button"
              onClick={() => loadData(page + 1)}
              disabled={page >= totalPages || loading}
              className="btn btn-outline btn-sm"
              style={{ padding: '0.25rem 0.6rem' }}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};
