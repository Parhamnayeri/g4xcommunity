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

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'badge badge-yellow';
      case 'assigned':
        return 'badge badge-purple';
      case 'open_presign':
        return 'badge badge-blue';
      case 'disputed':
        return 'badge badge-danger';
      default:
        return 'badge badge-muted';
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: '16px',
        border: '1px solid var(--border-subtle)',
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
              color: 'var(--text-primary)',
              margin: '0 0 0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚡</span> Active Boost Orders ({totalCount})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Real-time status, booster assignments, and actions for your active operations.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Game filter */}
          <select
            className="input"
            value={selectedGame}
            onChange={(e) => {
              setSelectedGame(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: '130px' }}
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
            className="input"
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: '150px' }}
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
            className="input"
            placeholder="Search ref or notes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: '180px' }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-danger)',
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
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading active orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon">📭</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No active orders matching this view.</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Place a new order above or adjust your search filters.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order Ref / Title</th>
                <th>Game &amp; Service</th>
                <th>Financials</th>
                <th>Status</th>
                <th>Boosters</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const badgeClass = getStatusBadgeClass(o.status);
                const isResolvingThis = resolvingChannelId === o.id;

                return (
                  <tr key={o.id}>
                    {/* Order Ref & Name */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                          #{o.id} — {o.orderRef}
                        </span>
                        {o.orderName ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--primary-purple)' }}>{o.orderName}</span>
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
                    </td>

                    {/* Game & Service */}
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.gameName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.serviceName}</div>
                    </td>

                    {/* Financials (Gross, Fee, Net) */}
                    <td>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--accent-yellow)' }}>
                        ${o.grossAmountUsd}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Fee: ${o.feeInfo.advertiserFeeUsd || '0.00'}{' '}
                        <span style={{ opacity: 0.7 }}>({o.advertiser.commissionPercent})</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td>
                      <span className={badgeClass}>
                        {o.simplifiedStatus.label}
                      </span>
                    </td>

                    {/* Boosters Assigned */}
                    <td>
                      {o.assignedCount > 0 ? (
                        <div>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {o.assignedBooster || `${o.assignedCount} booster(s)`}
                          </span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-yellow)' }}>
                            {o.runsCount > 0 ? `${o.runsCount} run(s) logged` : 'Active assignment'}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          Awaiting Boosters
                        </span>
                      )}
                    </td>

                    {/* Created Date */}
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {new Date(o.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                        {/* Discord Channel button */}
                        <button
                          onClick={() => handleOpenChannel(o.id)}
                          disabled={isResolvingThis}
                          title="Open private Discord coordination channel"
                          className="btn-secondary btn-xs"
                        >
                          {isResolvingThis ? '...' : 'Discord ↗'}
                        </button>

                        {/* Edit Note button */}
                        <button
                          onClick={() => onEditNote(o)}
                          title="Edit order instructions"
                          className="btn-primary btn-xs"
                        >
                          Notes
                        </button>

                        {/* Cancel Request button */}
                        <button
                          onClick={() => onCancelRequest(o)}
                          title="Request cancellation"
                          className="btn-danger btn-xs"
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
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Page {page} of {totalPages} ({totalCount} total orders)
          </span>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary btn-xs"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-secondary btn-xs"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
