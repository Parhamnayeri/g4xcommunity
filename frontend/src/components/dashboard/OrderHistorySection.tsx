import React, { useState, useEffect, useCallback } from 'react';
import { DashboardHistoricalOrder } from '../../types/dashboard';
import { fetchOrderHistory } from '../../services/dashboard';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export const OrderHistorySection: React.FC = () => {
  const [orders, setOrders] = useState<DashboardHistoricalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOrderHistory({
        page,
        limit: 8,
        status: statusFilter,
      });
      setOrders(res.orders || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      console.warn('[OrderHistory] Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleStatusChange = (status: 'all' | 'completed' | 'cancelled') => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header and Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Order History</h2>
            <span className="badge badge-muted" style={{ fontSize: '0.72rem' }}>
              {total} Total
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Completed and closed boost orders and service deliveries.
          </p>
        </div>

        {/* Status Filter Buttons */}
        <div style={{ display: 'flex', gap: '0.4rem', backgroundColor: 'var(--bg-surface)', padding: '0.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => handleStatusChange('all')}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'all' ? 'var(--primary-purple)' : 'transparent',
              color: statusFilter === 'all' ? '#fff' : 'var(--text-muted)',
              transition: 'all var(--transition-fast)',
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange('completed')}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'completed' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              color: statusFilter === 'completed' ? 'var(--status-success)' : 'var(--text-muted)',
              transition: 'all var(--transition-fast)',
            }}
          >
            Completed
          </button>
          <button
            type="button"
            onClick={() => handleStatusChange('cancelled')}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === 'cancelled' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
              color: statusFilter === 'cancelled' ? 'var(--status-danger)' : 'var(--text-muted)',
              transition: 'all var(--transition-fast)',
            }}
          >
            Cancelled
          </button>
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
          Loading historical orders...
        </Card>
      ) : orders.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '2.5rem 1rem' }}>
          <span className="empty-state-icon">📋</span>
          <p>No past orders matching the selected filter.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Game &amp; Service</th>
                <th>Your Role</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Completed Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isCompleted = o.status === 'completed';
                return (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
                      #{o.orderRef}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.serviceDisplayName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.gameDisplayName}</div>
                    </td>
                    <td>
                      <span className={`badge ${o.userRelation === 'booster' ? 'badge-yellow' : 'badge-purple'}`} style={{ fontSize: '0.68rem' }}>
                        {o.userRelation}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${isCompleted ? 'badge-green' : 'badge-danger'}`}
                        style={{ fontSize: '0.72rem' }}
                      >
                        {isCompleted ? '✓ Completed' : '✕ Cancelled'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: isCompleted ? 'var(--accent-yellow)' : 'var(--text-muted)' }}>
                      ${o.amountUsd} USD
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {o.completedAt ? new Date(o.completedAt).toLocaleDateString() : new Date(o.createdAt).toLocaleDateString()}
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
