import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardHistoricalOrder } from '../../types/dashboard';
import { fetchOrderHistory } from '../../services/dashboard';
import { Card, DataTable, Column, Pagination, StatusBadge } from '../ui';
import { normalizePagination, NormalizedPagination } from '../../utils/pagination';

export const OrderHistorySection: React.FC = () => {
  const [orders, setOrders] = useState<DashboardHistoricalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [pagination, setPagination] = useState<NormalizedPagination>({
    page: 1,
    limit: 8,
    total: 0,
    totalPages: 1,
  });

  const loadHistory = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await fetchOrderHistory({
        page: targetPage,
        limit: 8,
        status: statusFilter,
      });
      setOrders(res.orders || []);
      setPagination(normalizePagination(res.pagination || res, targetPage, 8));
    } catch (err) {
      console.warn('[OrderHistory] Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadHistory(1);
  }, [loadHistory]);

  const handleStatusChange = (status: 'all' | 'completed' | 'cancelled') => {
    setStatusFilter(status);
  };

  const columns: Column<DashboardHistoricalOrder>[] = useMemo(
    () => [
      {
        key: 'orderRef',
        header: 'Order Ref',
        render: (o) => (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>
            #{o.orderRef}
          </span>
        ),
      },
      {
        key: 'service',
        header: 'Game & Service',
        render: (o) => (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.serviceDisplayName}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.gameDisplayName}</div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Your Role',
        render: (o) => (
          <span className={`badge ${o.userRelation === 'booster' ? 'badge-lime' : 'badge-purple'}`}>
            {o.userRelation}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (o) => <StatusBadge status={o.status} />,
      },
      {
        key: 'amount',
        header: 'Amount',
        numeric: true,
        render: (o) => {
          const isCompleted = o.status === 'completed';
          return (
            <span style={{ fontWeight: 700, color: isCompleted ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
              ${o.amountUsd} USD
            </span>
          );
        },
      },
      {
        key: 'date',
        header: 'Completed Date',
        render: (o) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {o.completedAt ? new Date(o.completedAt).toLocaleDateString() : new Date(o.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <Card style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header and Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>Order History</h2>
            <span className="badge badge-muted" style={{ fontSize: '0.72rem' }}>
              {pagination.total} Total
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
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

      <DataTable<DashboardHistoricalOrder>
        columns={columns}
        data={orders}
        keyField="id"
        loading={loading}
        emptyTitle="No past orders found"
        emptyMessage="No historical orders match the selected filter."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(nextPage) => loadHistory(nextPage)}
      />
    </Card>
  );
};
