import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAdvertiserOrders, fetchOrderChannelAccess, fetchPublicGames } from '../../services/advertiser';
import { AdvertiserOrder, PublicGame } from '../../types/advertiser';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Select,
  Input,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';

interface ActiveOrdersSectionProps {
  onEditNote: (order: AdvertiserOrder) => void;
  onCancelRequest: (order: AdvertiserOrder) => void;
  refreshTrigger: number;
}

export const ActiveOrdersSection: React.FC<ActiveOrdersSectionProps> = ({
  onEditNote,
  onCancelRequest,
  refreshTrigger,
}) => {
  const [orders, setOrders] = useState<AdvertiserOrder[]>([]);
  const [games, setGames] = useState<PublicGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [selectedGame, setSelectedGame] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  // Channel Opening State
  const [resolvingChannelId, setResolvingChannelId] = useState<number | null>(null);

  // Load Games for Filter
  useEffect(() => {
    fetchPublicGames()
      .then((res) => setGames(res.games || []))
      .catch(() => {});
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdvertiserOrders({
        page,
        limit: 10,
        status: selectedStatus,
        gameSlug: selectedGame !== 'all' ? selectedGame : undefined,
        search: search.trim() || undefined,
      });

      setOrders(res.orders || []);
      setPagination(normalizePagination(res.pagination || res, page, 10));
    } catch (err: any) {
      setError(err.message || 'Failed to load active orders.');
    } finally {
      setLoading(false);
    }
  }, [page, selectedGame, selectedStatus, search]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders, refreshTrigger]);

  const handleOpenChannel = async (orderId: number) => {
    setResolvingChannelId(orderId);
    try {
      const res = await fetchOrderChannelAccess(orderId);
      if (res.channelUrl) {
        window.open(res.channelUrl, '_blank', 'noopener,noreferrer');
      } else {
        alert(res.error || 'Discord execution channel is not yet provisioned for this order.');
      }
    } catch (err: any) {
      alert(err.message || 'Unable to open Discord channel.');
    } finally {
      setResolvingChannelId(null);
    }
  };

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
        key: 'financials',
        header: 'Financials',
        align: 'right',
        render: (o) => (
          <div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--accent-lime)' }}>
              ${o.grossAmountUsd}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Fee: ${o.feeInfo.advertiserFeeUsd || '0.00'}{' '}
              <span style={{ opacity: 0.7 }}>({o.advertiser.commissionPercent})</span>
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
        header: 'Booster',
        render: (o) => (
          <div style={{ fontSize: '0.85rem' }}>
            {o.assignedBooster ? (
              <span style={{ color: 'var(--text-primary)' }}>
                👤 {o.assignedBooster}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending claim</span>
            )}
          </div>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        render: (o) => (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {new Date(o.createdAt).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (o) => {
          const isResolvingThis = resolvingChannelId === o.id;
          return (
            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="outline"
                disabled={isResolvingThis}
                onClick={() => handleOpenChannel(o.id)}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              >
                {isResolvingThis ? 'Opening...' : '💬 Discord'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEditNote(o)}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              >
                📝 Note
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCancelRequest(o)}
                style={{
                  fontSize: '0.72rem',
                  padding: '0.25rem 0.5rem',
                  color: 'var(--status-danger)',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                }}
              >
                ✕ Cancel
              </Button>
            </div>
          );
        },
      },
    ],
    [resolvingChannelId, onEditNote, onCancelRequest]
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
            <span>⚡</span> Active Pipeline &amp; In-Progress Boosts ({pagination.total})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Monitor open presign orders, active assignments, and channel execution in real time.
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
              { label: 'All Active States', value: 'active' },
              { label: 'Open Presign', value: 'open_presign' },
              { label: 'Assigned', value: 'assigned' },
              { label: 'In Progress', value: 'in_progress' },
              { label: 'Under Dispute / Review', value: 'disputed' },
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
        emptyMessage="No active orders matching this view. Place a new order above or adjust your search filters."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(p) => setPage(p)}
      />
    </Card>
  );
};

export default ActiveOrdersSection;
