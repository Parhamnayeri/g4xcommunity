import React, { useState, useEffect, useCallback } from 'react';
import { fetchAdvertiserOrders, fetchOrderChannelAccess, fetchPublicGames } from '../../services/advertiser';
import { AdvertiserOrder, PublicGame } from '../../types/advertiser';

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
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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
      setTotalPages(res.pagination.totalPages || 1);
      setTotalCount(res.pagination.totalCount || 0);
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

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'in_progress':
        return { bg: 'rgba(204, 255, 0, 0.15)', text: 'var(--accent-lime, #ccff00)', border: 'rgba(204, 255, 0, 0.35)' };
      case 'assigned':
        return { bg: 'rgba(124, 58, 237, 0.2)', text: '#c4b5fd', border: 'rgba(124, 58, 237, 0.4)' };
      case 'open_presign':
        return { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' };
      case 'disputed':
        return { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.35)' };
      default:
        return { bg: 'rgba(148, 144, 166, 0.15)', text: 'var(--text-muted, #9490a6)', border: 'rgba(148, 144, 166, 0.3)' };
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface, #181524)',
        borderRadius: '16px',
        border: '1px solid rgba(124, 58, 237, 0.25)',
        padding: '1.75rem',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
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
              color: 'var(--text-primary, #f4f4f6)',
              margin: '0 0 0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚡</span> Active Boost Orders ({totalCount})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #9490a6)' }}>
            Real-time status, booster assignments, and actions for your active operations.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Game filter */}
          <select
            value={selectedGame}
            onChange={(e) => {
              setSelectedGame(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          >
            <option value="all">All Games</option>
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.displayName}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          >
            <option value="active">All Active States</option>
            <option value="open_presign">Open Presign</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="disputed">Under Dispute / Review</option>
          </select>

          {/* Search box */}
          <input
            type="text"
            placeholder="Search ref or notes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.85rem',
              outline: 'none',
              width: '180px',
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '0.75rem',
            color: '#f87171',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Orders Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #9490a6)' }}>
          Loading active orders...
        </div>
      ) : orders.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem 1rem',
            backgroundColor: 'rgba(13, 11, 18, 0.4)',
            borderRadius: '12px',
            border: '1px dashed rgba(124, 58, 237, 0.25)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
          <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary, #f4f4f6)', fontWeight: 600 }}>
            No active orders matching this view.
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
            Place a new order above or adjust your search filters.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid rgba(124, 58, 237, 0.15)' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: 'rgba(13, 11, 18, 0.7)',
                  borderBottom: '1px solid rgba(124, 58, 237, 0.2)',
                  color: 'var(--text-muted, #9490a6)',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <th style={{ padding: '0.85rem 1rem' }}>Order Ref / Title</th>
                <th style={{ padding: '0.85rem 1rem' }}>Game &amp; Service</th>
                <th style={{ padding: '0.85rem 1rem' }}>Financials</th>
                <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                <th style={{ padding: '0.85rem 1rem' }}>Boosters</th>
                <th style={{ padding: '0.85rem 1rem' }}>Created</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const badgeStyle = getStatusBadgeStyle(o.status);
                const isResolvingThis = resolvingChannelId === o.id;

                return (
                  <tr
                    key={o.id}
                    style={{
                      borderBottom: '1px solid rgba(124, 58, 237, 0.1)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(124, 58, 237, 0.06)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* Order Ref & Name */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary, #f4f4f6)', fontFamily: 'monospace' }}>
                          #{o.id} — {o.orderRef}
                        </span>
                        {o.orderName ? (
                          <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>{o.orderName}</span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>
                            Direct Boost Order
                          </span>
                        )}
                        {o.notes && (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted, #9490a6)',
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
                    </td>

                    {/* Game & Service */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary, #f4f4f6)' }}>{o.gameName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>{o.serviceName}</div>
                    </td>

                    {/* Financials (Gross, Fee, Net) */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--accent-lime, #ccff00)' }}>
                        ${o.grossAmountUsd}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>
                        Fee: ${o.feeInfo.advertiserFeeUsd || '0.00'}{' '}
                        <span style={{ opacity: 0.7 }}>({o.advertiser.commissionPercent})</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        style={{
                          backgroundColor: badgeStyle.bg,
                          color: badgeStyle.text,
                          border: `1px solid ${badgeStyle.border}`,
                          borderRadius: '8px',
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        {o.simplifiedStatus.label}
                      </span>
                    </td>

                    {/* Boosters Assigned */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {o.assignedCount > 0 ? (
                        <div>
                          <span style={{ color: 'var(--text-primary, #f4f4f6)', fontWeight: 600 }}>
                            {o.assignedBooster || `${o.assignedCount} booster(s)`}
                          </span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-lime, #ccff00)' }}>
                            {o.runsCount > 0 ? `${o.runsCount} run(s) logged` : 'Active assignment'}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted, #9490a6)', fontSize: '0.8rem' }}>
                          Awaiting Boosters
                        </span>
                      )}
                    </td>

                    {/* Created Date */}
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted, #9490a6)', fontSize: '0.75rem' }}>
                      {new Date(o.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                        {/* Discord Channel button */}
                        <button
                          onClick={() => handleOpenChannel(o.id)}
                          disabled={isResolvingThis}
                          title="Open private Discord coordination channel"
                          style={{
                            backgroundColor: 'rgba(88, 101, 242, 0.15)',
                            border: '1px solid rgba(88, 101, 242, 0.4)',
                            borderRadius: '6px',
                            color: '#818cf8',
                            padding: '0.35rem 0.6rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: isResolvingThis ? 'wait' : 'pointer',
                          }}
                        >
                          {isResolvingThis ? '...' : 'Discord ↗'}
                        </button>

                        {/* Edit Note button */}
                        <button
                          onClick={() => onEditNote(o)}
                          title="Edit order instructions"
                          style={{
                            backgroundColor: 'rgba(124, 58, 237, 0.15)',
                            border: '1px solid rgba(124, 58, 237, 0.35)',
                            borderRadius: '6px',
                            color: '#ddd6fe',
                            padding: '0.35rem 0.6rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Notes
                        </button>

                        {/* Cancel Request button */}
                        <button
                          onClick={() => onCancelRequest(o)}
                          title="Request cancellation"
                          style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '6px',
                            color: '#f87171',
                            padding: '0.35rem 0.6rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
            Page {page} of {totalPages} ({totalCount} total orders)
          </span>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: '6px',
                padding: '0.4rem 0.8rem',
                color: page <= 1 ? 'var(--text-muted, #9490a6)' : 'var(--text-primary, #f4f4f6)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: '6px',
                padding: '0.4rem 0.8rem',
                color: page >= totalPages ? 'var(--text-muted, #9490a6)' : 'var(--text-primary, #f4f4f6)',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
