import React, { useState, useEffect, useCallback } from 'react';
import { DashboardTransaction } from '../../types/dashboard';
import { fetchWalletTransactions } from '../../services/dashboard';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export const FinancialActivitySection: React.FC = () => {
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWalletTransactions({
        page,
        limit: 10,
      });
      setTransactions(res.transactions || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      console.warn('[FinancialActivity] Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const formatEntryType = (type: string) => {
    switch (type) {
      case 'EARNING_PENDING':
        return 'Boost Run Completed (Pending)';
      case 'EARNING_CONFIRMED':
        return 'Boost Release Approved (Confirmed)';
      case 'AVAILABLE_RELEASE':
        return 'Escrow Released to Available';
      case 'WITHDRAWAL_RESERVE':
        return 'Withdrawal Request Reserved';
      case 'WITHDRAWAL_SETTLE':
        return 'Withdrawal Paid (Settled)';
      case 'WITHDRAWAL_REVERSE':
        return 'Withdrawal Reversed';
      case 'ADVERTISER_DEPOSIT':
        return 'Advertiser Balance Top-up';
      case 'GOLD_TRADE_SETTLE':
        return 'P2P Gold Trade Settlement';
      case 'P2P_FUNDING_SETTLE':
        return 'P2P Funding Settlement';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Wallet &amp; Ledger Activity</h2>
            <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
              {total} Entries
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Immutable, double-entry audit records for all balance additions and allocations.
          </p>
        </div>
      </div>

      {loading ? (
        <Card style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: '2px solid var(--border-subtle)',
              borderTopColor: 'var(--accent-yellow)',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 0.75rem',
            }}
          />
          Loading ledger entries...
        </Card>
      ) : transactions.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '2.5rem 1rem' }}>
          <span className="empty-state-icon">💳</span>
          <p>No financial activity recorded yet for this wallet.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entry Ref</th>
                <th>Transaction Type</th>
                <th>Description / Order</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Available After</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const isCredit = t.direction === 'CREDIT';
                return (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                      {t.entryRef}
                    </td>
                    <td>
                      <span
                        className={`badge ${isCredit ? 'badge-green' : 'badge-danger'}`}
                        style={{ fontSize: '0.68rem', textTransform: 'none' }}
                      >
                        {formatEntryType(t.entryType)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      <div>{t.description || '—'}</div>
                      {t.orderRef && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                          Ref: #{t.orderRef}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color: isCredit ? 'var(--accent-yellow)' : 'var(--status-danger)',
                      }}
                    >
                      {isCredit ? `+$${t.amountUsd}` : `-$${t.amountUsd}`} USD
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {t.balanceAfterAvailableUsd !== null ? `$${t.balanceAfterAvailableUsd}` : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                &larr; Previous
              </Button>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{totalPages}</strong>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next &rarr;
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
