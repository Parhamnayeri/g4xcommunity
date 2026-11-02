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
              borderTopColor: 'var(--accent-lime)',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 0.75rem',
            }}
          />
          Loading historical orders...
        </Card>
      ) : orders.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No past orders matching the selected filter.
          </p>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', backgroundColor: 'rgba(13, 11, 18, 0.4)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Order Ref</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Game &amp; Service</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Your Role</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Completed Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const isCompleted = o.status === 'completed';
                  return (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: '1px solid rgba(45, 38, 69, 0.3)',
                        transition: 'background var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>
                        #{o.orderRef}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.serviceDisplayName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.gameDisplayName}</div>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span className={`badge ${o.userRelation === 'booster' ? 'badge-lime' : 'badge-purple'}`} style={{ fontSize: '0.68rem' }}>
                          {o.userRelation}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            color: isCompleted ? 'var(--status-success)' : 'var(--status-danger)',
                          }}
                        >
                          {isCompleted ? '✓ Completed' : '✕ Cancelled'}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 700, color: isCompleted ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
                        ${o.amountUsd} USD
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {o.completedAt ? new Date(o.completedAt).toLocaleDateString() : new Date(o.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                borderTop: '1px solid var(--border-subtle)',
                backgroundColor: 'rgba(13, 11, 18, 0.4)',
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
                Page <strong style={{ color: '#fff' }}>{page}</strong> of <strong style={{ color: '#fff' }}>{totalPages}</strong>
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
        </Card>
      )}
    </div>
  );
};
