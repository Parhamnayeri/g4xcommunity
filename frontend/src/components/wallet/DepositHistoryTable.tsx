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
  const [selectedDeposit, setSelectedDeposit] = useState<DepositHistoryItem | null>(null);

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
              <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && deposits.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading deposit records...
                </td>
              </tr>
            ) : deposits.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
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
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}
                      onClick={() => setSelectedDeposit(item)}
                    >
                      Details
                    </button>
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

      {/* Deposit Detail Inspection Modal */}
      {selectedDeposit && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="card-surface"
            style={{
              maxWidth: '540px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Deposit Record Details
                </h3>
                <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  Ref: {selectedDeposit.fundingRef}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDeposit(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '1.3rem',
                  cursor: 'pointer',
                  padding: '0.2rem 0.5rem',
                }}
              >
                ✕
              </button>
            </div>

            {/* Breakdown */}
            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                marginBottom: '1.25rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Status:</span>
                <div style={{ marginTop: '0.2rem' }}>{getStatusBadge(selectedDeposit.status)}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Funding Method:</span>
                <span>{selectedDeposit.fundingMethod}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Submitted Amount:</span>
                <strong style={{ color: 'var(--primary-purple)' }}>{selectedDeposit.submittedAmount}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Exchange Rate:</span>
                <span>{selectedDeposit.exchangeRate ? `${selectedDeposit.exchangeRate.toLocaleString()} Toman` : '1.0 (USDT)'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Expected USD:</span>
                <strong style={{ color: 'var(--accent-lime)' }}>${selectedDeposit.expectedUsd}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Credited USD:</span>
                <strong style={{ color: selectedDeposit.hasBackedCredit ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
                  {selectedDeposit.hasBackedCredit ? `$${selectedDeposit.creditedAmountUsd}` : '$0.00'}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Bank Tracking Ref:</span>
                <span style={{ fontFamily: 'monospace' }}>{selectedDeposit.evidenceRef || 'None'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Depositor / Card:</span>
                <span>{selectedDeposit.payerIdentifier || '—'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Submitted Date:</span>
                <span>{new Date(selectedDeposit.date).toLocaleString()}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Verification Outcome:</span>
                <span>{selectedDeposit.reviewOutcome}</span>
              </div>
              {selectedDeposit.adminNotes && (
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(45, 38, 69, 0.4)', paddingTop: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Reviewer Notes / Reason:</span>
                  <span>{selectedDeposit.adminNotes}</span>
                </div>
              )}
            </div>

            {/* Receipt Preview */}
            {selectedDeposit.receiptUrl ? (
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  padding: '0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '1.25rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                  Submitted Receipt Slip Evidence
                </div>
                <a href={selectedDeposit.receiptUrl} target="_blank" rel="noopener noreferrer" title="Click to view full receipt">
                  <img
                    src={selectedDeposit.receiptUrl}
                    alt="Receipt Slip"
                    style={{
                      maxHeight: '180px',
                      maxWidth: '100%',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      objectFit: 'contain',
                      cursor: 'pointer',
                    }}
                  />
                </a>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  Click screenshot to inspect full image in a new tab
                </div>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '1.25rem',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                }}
              >
                📎 No receipt screenshot attached for this record.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedDeposit(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
