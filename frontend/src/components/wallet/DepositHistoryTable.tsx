import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { DepositHistoryItem } from '../../types/wallet';
import { fetchDepositHistory } from '../../services/wallet';

interface DepositHistoryTableProps {
  refreshTrigger?: number;
}

export const DepositHistoryTable: React.FC<DepositHistoryTableProps> = ({ refreshTrigger = 0 }) => {
  const [deposits, setDeposits] = useState<DepositHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);

  const loadHistory = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDepositHistory(targetPage, 10);
      if (res.success) {
        setDeposits(res.deposits || []);
        setPage(res.page || targetPage);
        setTotalPages(res.totalPages || 1);
        setTotal(res.total || 0);
      } else {
        setError(res.error || 'Failed to load deposit history.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch deposit history from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory(page);
  }, [loadHistory, page, refreshTrigger]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED_CREDITED':
        return <span className="badge badge-lime">Credited</span>;
      case 'PENDING_ADMIN_VERIFICATION':
      case 'WAITING':
      case 'PENDING':
        return <span className="badge badge-yellow">Pending Review</span>;
      case 'REJECTED':
        return <span className="badge badge-red">Rejected</span>;
      case 'CANCELLED':
        return <span className="badge badge-gray">Cancelled</span>;
      default:
        return <span className="badge badge-gray">{status}</span>;
    }
  };

  return (
    <Card style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            Deposit Requests &amp; Funding History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Audit trail of your submitted funding requests, verification outcomes, and ledger credits.
          </p>
        </div>

        <button
          onClick={() => loadHistory(page)}
          disabled={loading}
          className="btn btn-outline btn-sm"
        >
          {loading ? 'Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Table Container */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Reference</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Method</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Submitted Amount</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Exchange Rate</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Expected USD</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Credited USD</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Status</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Review Outcome</th>
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading && deposits.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading deposit records...
                </td>
              </tr>
            ) : deposits.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No deposit requests found. Submit an IRT bank transfer above to fund your wallet.
                </td>
              </tr>
            ) : (
              deposits.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {item.fundingRef}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-primary)' }}>
                    <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
                      {item.fundingMethod}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.submittedAmount}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                    {item.exchangeRate ? `${item.exchangeRate.toLocaleString()} Toman` : '1.0 (USDT)'}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                    ${item.expectedUsd}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: item.hasBackedCredit ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
                    {item.hasBackedCredit ? `$${item.creditedAmountUsd}` : '$0.00'}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    {getStatusBadge(item.status)}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {item.reviewOutcome}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            Showing Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total requests)
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="btn btn-outline btn-sm"
            >
              &larr; Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="btn btn-outline btn-sm"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};
