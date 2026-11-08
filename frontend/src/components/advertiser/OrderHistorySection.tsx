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
            <span>📜</span> Order History &amp; Completed Boosts ({totalCount})
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #9490a6)' }}>
            Immutable historical records of completed settlements and cancellations.
          </p>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
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
              padding: '0.45rem 0.7rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.8rem',
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
              padding: '0.45rem 0.7rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.8rem',
              outline: 'none',
            }}
          >
            <option value="history">All History</option>
            <option value="completed">Completed Only</option>
            <option value="cancelled">Cancelled Only</option>
          </select>

          {/* Date range inputs */}
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
            title="Start Date"
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.45rem 0.6rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.8rem',
              outline: 'none',
            }}
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            title="End Date"
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.45rem 0.6rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.8rem',
              outline: 'none',
            }}
          />

          {/* Search box */}
          <input
            type="text"
            placeholder="Search ref..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{
              backgroundColor: 'rgba(13, 11, 18, 0.8)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '8px',
              padding: '0.45rem 0.7rem',
              color: 'var(--text-primary, #f4f4f6)',
              fontSize: '0.8rem',
              outline: 'none',
              width: '140px',
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

      {/* History Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #9490a6)' }}>
          Loading order history...
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
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗃️</div>
          <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary, #f4f4f6)', fontWeight: 600 }}>
            No past orders found matching your criteria.
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
                <th style={{ padding: '0.85rem 1rem' }}>Historical Gross</th>
                <th style={{ padding: '0.85rem 1rem' }}>Fee Snapshot</th>
                <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                <th style={{ padding: '0.85rem 1rem' }}>Booster Settlement</th>
                <th style={{ padding: '0.85rem 1rem' }}>Created Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isCompleted = o.status === 'completed';
                const isCancelled = o.status === 'cancelled';

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

                    {/* Historical Gross USD */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#f4f4f6' }}>
                        ${o.grossAmountUsd}
                      </div>
                    </td>

                    {/* Immutable Fee Snapshot */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontFamily: 'monospace', color: '#c4b5fd', fontWeight: 600 }}>
                        ${o.feeInfo.advertiserFeeUsd || '0.00'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>
                        Tier: {o.advertiser.commissionPercent}
                      </div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {isCompleted ? (
                        <span
                          style={{
                            backgroundColor: 'rgba(52, 211, 153, 0.15)',
                            color: '#34d399',
                            border: '1px solid rgba(52, 211, 153, 0.35)',
                            borderRadius: '8px',
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          Completed
                        </span>
                      ) : isCancelled ? (
                        <span
                          style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: '8px',
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          Cancelled
                        </span>
                      ) : (
                        <span
                          style={{
                            backgroundColor: 'rgba(148, 144, 166, 0.15)',
                            color: 'var(--text-muted, #9490a6)',
                            border: '1px solid rgba(148, 144, 166, 0.3)',
                            borderRadius: '8px',
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.75rem',
                          }}
                        >
                          {o.simplifiedStatus.label}
                        </span>
                      )}
                    </td>

                    {/* Booster Settlement */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {o.assignedBooster ? (
                        <span style={{ color: 'var(--text-primary, #f4f4f6)', fontWeight: 600 }}>
                          {o.assignedBooster}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted, #9490a6)', fontSize: '0.8rem' }}>None</span>
                      )}
                    </td>

                    {/* Created Date */}
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted, #9490a6)', fontSize: '0.75rem' }}>
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
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
            Page {page} of {totalPages} ({totalCount} total history records)
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
