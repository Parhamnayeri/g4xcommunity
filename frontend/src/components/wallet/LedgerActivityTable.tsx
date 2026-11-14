import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { LedgerHistoryItem } from '../../types/wallet';
import { fetchLedgerActivity } from '../../services/wallet';

interface LedgerActivityTableProps {
  refreshTrigger?: number;
}

export const LedgerActivityTable: React.FC<LedgerActivityTableProps> = ({ refreshTrigger = 0 }) => {
  const [entries, setEntries] = useState<LedgerHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);

  const loadLedger = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLedgerActivity(targetPage, 10);
      if (res.success) {
        setEntries(res.entries || []);
        setPage(res.page || targetPage);
        setTotalPages(res.totalPages || 1);
        setTotal(res.total || 0);
      } else {
        setError(res.error || 'Failed to load ledger activity.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch ledger entries from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLedger(page);
  }, [loadLedger, page, refreshTrigger]);

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
            Ledger Activity &amp; Journal History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Immutable double-entry ledger postings recording all credit, debit, and escrow movements.
          </p>
        </div>

        <button
          onClick={() => loadLedger(page)}
          disabled={loading}
          className="btn btn-secondary btn-sm"
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
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Entry Ref</th>
              <th>Direction</th>
              <th>Type</th>
              <th>Amount USD</th>
              <th>Available After</th>
              <th>Reserved After</th>
              <th>Description</th>
              <th>Order Ref</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading ledger transactions...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div className="empty-state-box">
                    <span className="empty-state-icon">📊</span>
                    <p>No ledger activity recorded yet.</p>
                  </div>
                </td>
              </tr>
            ) : (
              entries.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {item.entryRef}
                  </td>
                  <td>
                    <span
                      className={`badge ${item.direction === 'CREDIT' ? 'badge-green' : 'badge-danger'}`}
                      style={{ fontSize: '0.7rem' }}
                    >
                      {item.direction === 'CREDIT' ? '+ CREDIT' : '- DEBIT'}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                      {item.entryType}
                    </span>
                  </td>
                  <td
                    style={{
                      fontWeight: 800,
                      color: item.direction === 'CREDIT' ? 'var(--accent-yellow)' : '#ef4444',
                    }}
                  >
                    {item.direction === 'CREDIT' ? `+$${item.amountUsd}` : `-$${item.amountUsd}`}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.balanceAfterAvailableUsd !== null ? `$${item.balanceAfterAvailableUsd}` : '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {item.balanceAfterReservedUsd !== null ? `$${item.balanceAfterReservedUsd}` : '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {item.description}
                  </td>
                  <td style={{ color: 'var(--accent-yellow)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                    {item.orderRef || '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            Showing Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total ledger entries)
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="btn btn-secondary btn-sm"
            >
              &larr; Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
