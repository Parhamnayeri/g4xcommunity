import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAdvertiserOrders, fetchPublicGames } from '../../services/advertiser';
import { AdvertiserOrder, PublicGame } from '../../types/advertiser';
import {
  Card,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Select,
  Input,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';

interface OrderHistorySectionProps {
  refreshTrigger: number;
}

export const OrderHistorySection: React.FC<OrderHistorySectionProps> = ({ refreshTrigger }) => {
  const [orders, setOrders] = useState<AdvertiserOrder[]>([]);
  const [games, setGames] = useState<PublicGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [selectedGame, setSelectedGame] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('history');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  useEffect(() => {
    fetchPublicGames()
      .then((res) => setGames(res.games || []))
      .catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdvertiserOrders({
        page,
        limit: 10,
        status: selectedStatus,
        gameSlug: selectedGame !== 'all' ? selectedGame : undefined,
        search: search.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      setOrders(res.orders || []);
      setPagination(normalizePagination(res.pagination || res, page, 10));
    } catch (err: any) {
      setError(err.message || 'Failed to load order history.');
    } finally {
      setLoading(false);
    }
  }, [page, selectedGame, selectedStatus, search, startDate, endDate]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshTrigger]);

  const columns: Column<AdvertiserOrder>[] = useMemo(
    () => [
      {
        key: 'orderRef',
        header: 'Order Ref / Title',
        render: (o) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
              #{o.id} — {o.orderRef}
            </span>
            {o.orderName ? (
              <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>{o.orderName}</span>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Direct Boost Order
              </span>
            )}
            {o.notes && (
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  maxWidth: '220px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={o.notes}
              >
                📝 {o.notes}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'game',
        header: 'Game & Service',
        render: (o) => (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.gameName}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.serviceName}</div>
          </div>
        ),
      },
      {
        key: 'gross',
        header: 'Historical Gross',
        align: 'right',
        render: (o) => (
          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#f4f4f6' }}>
            ${o.grossAmountUsd}
          </span>
        ),
      },
      {
        key: 'fee',
        header: 'Fee Snapshot',
        align: 'right',
        render: (o) => (
          <div>
            <div style={{ fontFamily: 'monospace', color: '#c4b5fd', fontWeight: 600 }}>
              ${o.feeInfo.advertiserFeeUsd || '0.00'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Tier: {o.advertiser.commissionPercent}
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (o) => (
          <StatusBadge
            status={o.status}
            simplifiedStatus={o.simplifiedStatus}
          />
        ),
      },
      {
        key: 'boosters',
        header: 'Booster Settlement',
        render: (o) => (
          <div style={{ fontSize: '0.85rem' }}>
            {o.assignedBooster ? (
              <span style={{ color: 'var(--text-primary)' }}>
                👤 {o.assignedBooster}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>
            )}
          </div>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created Date',
        render: (o) => (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {new Date(o.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <Card style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header & Filter Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              margin: '0 0 0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>📜</span> Order History &amp; Completed Boosts ({pagination.total})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Immutable historical records of completed settlements and cancellations.
          </p>
        </div>

        {/* Filter Toolbar */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            value={selectedGame}
            onChange={(e) => {
              setSelectedGame(e.target.value);
              setPage(1);
            }}
            options={[
              { label: 'All Games', value: 'all' },
              ...games.map((g) => ({ label: g.displayName, value: g.slug })),
            ]}
          />

          <Select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { label: 'All Historical States', value: 'history' },
              { label: 'Completed', value: 'completed' },
              { label: 'Cancelled', value: 'cancelled' },
              { label: 'Refunded', value: 'refunded' },
            ]}
          />

          <Input
            placeholder="Search ref or notes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />

          <Input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />

          <Input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem',
            color: 'var(--status-danger)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Orders Table */}
      <DataTable
        columns={columns}
        data={orders}
        keyField="id"
        loading={loading}
        emptyMessage="No historical orders found matching your filters."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(p) => setPage(p)}
      />
    </Card>
  );
};

export default OrderHistorySection;
