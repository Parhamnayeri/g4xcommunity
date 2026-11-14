import React, { useState, useEffect, useCallback } from 'react';
import { fetchAdvertiserOrders, fetchPublicGames } from '../../services/advertiser';
import { AdvertiserOrder, PublicGame } from '../../types/advertiser';

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
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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
      setTotalPages(res.pagination.totalPages || 1);
      setTotalCount(res.pagination.totalCount || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load order history.');
    } finally {
      setLoading(false);
    }
  }, [page, selectedGame, selectedStatus, search, startDate, endDate]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshTrigger]);

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
            <span>📜</span> Order History &amp; Completed Boosts ({totalCount})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Immutable historical records of completed settlements and cancellations.
          </p>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
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
            style={{ minWidth: '140px' }}
          >
            <option value="history">All History</option>
            <option value="completed">Completed Only</option>
            <option value="cancelled">Cancelled Only</option>
          </select>

          {/* Date range inputs */}
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
            title="Start Date"
            style={{ width: '135px' }}
          />

          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            title="End Date"
            style={{ width: '135px' }}
          />

          {/* Search box */}
          <input
            type="text"
            className="input"
            placeholder="Search ref..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: '140px' }}
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

      {/* History Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading order history...
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon">🗃️</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No past orders found matching your criteria.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order Ref / Title</th>
                <th>Game &amp; Service</th>
                <th>Historical Gross</th>
                <th>Fee Snapshot</th>
                <th>Status</th>
                <th>Booster Settlement</th>
                <th>Created Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isCompleted = o.status === 'completed';
                const isCancelled = o.status === 'cancelled';

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

                    {/* Historical Gross USD */}
                    <td>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--text-primary)' }}>
                        ${o.grossAmountUsd}
                      </div>
                    </td>

                    {/* Immutable Fee Snapshot */}
                    <td>
                      <div style={{ fontFamily: 'monospace', color: 'var(--primary-purple)', fontWeight: 600 }}>
                        ${o.feeInfo.advertiserFeeUsd || '0.00'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Tier: {o.advertiser.commissionPercent}
                      </div>
                    </td>

                    {/* Status */}
                    <td>
                      {isCompleted ? (
                        <span className="badge badge-green">
                          Completed
                        </span>
                      ) : isCancelled ? (
                        <span className="badge badge-danger">
                          Cancelled
                        </span>
                      ) : (
                        <span className="badge badge-muted">
                          {o.simplifiedStatus.label}
                        </span>
                      )}
                    </td>

                    {/* Booster Settlement */}
                    <td>
                      {o.assignedBooster ? (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                          {o.assignedBooster}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>
                      )}
                    </td>

                    {/* Created Date */}
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {new Date(o.createdAt).toLocaleDateString()}
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
            Page {page} of {totalPages} ({totalCount} total history records)
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
