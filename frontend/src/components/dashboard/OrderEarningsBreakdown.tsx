import React, { useState, useMemo } from 'react';
import { OrderEarningsBreakdownItem } from '../../types/dashboard';
import { Card } from '../ui/Card';

export interface OrderEarningsBreakdownProps {
  items?: OrderEarningsBreakdownItem[];
}

export const OrderEarningsBreakdown: React.FC<OrderEarningsBreakdownProps> = ({ items = [] }) => {
  const [filterStage, setFilterStage] = useState<'all' | 'released' | 'in_progress' | 'pending_escrow'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Stage filter
      if (filterStage !== 'all' && item.earningsStage !== filterStage) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesRef = item.orderRef.toLowerCase().includes(q);
        const matchesGame = item.gameDisplayName.toLowerCase().includes(q);
        const matchesService = item.serviceDisplayName.toLowerCase().includes(q);
        const matchesRole = item.assignmentRole.toLowerCase().includes(q);
        return matchesRef || matchesGame || matchesService || matchesRole;
      }
      return true;
    });
  }, [items, filterStage, searchQuery]);

  const totalFilteredUsd = useMemo(() => {
    const cents = filteredItems.reduce((sum, item) => sum + item.amountCents, 0);
    return (cents / 100).toFixed(2);
  }, [filteredItems]);

  return (
    <Card
      style={{
        padding: '1.5rem',
        backgroundColor: 'rgba(20, 18, 30, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* ─── Header & Search / Filters ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
              Order Earnings Breakdown
            </h3>
            <span
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '0.12rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}
            >
              {items.length} Orders
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Itemized revenue attribution across active and finalized orders.
          </p>
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'rgba(10, 10, 18, 0.8)',
              padding: '0.2rem',
              borderRadius: 'var(--radius-sm, 8px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              gap: '0.15rem',
            }}
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'released', label: 'Ready / Released' },
                { id: 'in_progress', label: 'Active Runs' },
                { id: 'pending_escrow', label: '24h Hold' },
              ] as const
            ).map((tab) => {
              const isActive = filterStage === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterStage(tab.id)}
                  style={{
                    backgroundColor: isActive ? 'var(--accent-lime, #10b981)' : 'transparent',
                    color: isActive ? '#052e16' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: '5px',
                    padding: '0.3rem 0.65rem',
                    fontSize: '0.75rem',
                    fontWeight: isActive ? 800 : 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Quick Search Box */}
          <input
            type="text"
            placeholder="Search orders, games, roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backgroundColor: 'rgba(10, 10, 18, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              color: '#ffffff',
              outline: 'none',
              minWidth: '180px',
            }}
          />
        </div>
      </div>

      {/* ─── Itemized Orders Table / Cards ─────────────────────────────────── */}
      {filteredItems.length === 0 ? (
        <div
          style={{
            padding: '2.5rem 1rem',
            textAlign: 'center',
            backgroundColor: 'rgba(10, 10, 18, 0.4)',
            borderRadius: 'var(--radius-sm, 8px)',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>📦</div>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            No Matching Order Earnings Found
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
            {searchQuery
              ? `No orders matched "${searchQuery}". Try a different search term.`
              : 'As you pick up and complete boost orders, their earnings attribution will appear here.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-muted)',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <th style={{ padding: '0.6rem 0.75rem' }}>Order Reference</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Game / Service</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Assigned Role</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Date</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Earnings Status</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Net Payout</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                // Determine stage badge styling
                let badgeBg = 'rgba(56, 189, 248, 0.15)';
                let badgeColor = '#38bdf8';
                let badgeBorder = 'rgba(56, 189, 248, 0.3)';

                if (item.earningsStage === 'released') {
                  badgeBg = 'rgba(16, 185, 129, 0.15)';
                  badgeColor = '#34d399';
                  badgeBorder = 'rgba(16, 185, 129, 0.3)';
                } else if (item.earningsStage === 'pending_escrow') {
                  badgeBg = 'rgba(245, 158, 11, 0.15)';
                  badgeColor = '#fbbf24';
                  badgeBorder = 'rgba(245, 158, 11, 0.3)';
                } else if (item.earningsStage === 'cancelled') {
                  badgeBg = 'rgba(239, 68, 68, 0.15)';
                  badgeColor = '#f87171';
                  badgeBorder = 'rgba(239, 68, 68, 0.3)';
                }

                return (
                  <tr
                    key={`order-breakdown-${item.orderId}`}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* Order Reference */}
                    <td style={{ padding: '0.75rem', fontWeight: 700 }}>
                      <span style={{ color: '#ffffff', fontFamily: 'monospace' }}>
                        {item.orderRef}
                      </span>
                    </td>

                    {/* Game & Service */}
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{item.gameDisplayName}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {item.serviceDisplayName}
                      </div>
                    </td>

                    {/* Assigned Role */}
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.06)',
                          color: '#cbd5e1',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        {item.assignmentRole}
                      </span>
                    </td>

                    {/* Date */}
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {new Date(item.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>

                    {/* Earnings Status Badge */}
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          backgroundColor: badgeBg,
                          color: badgeColor,
                          border: `1px solid ${badgeBorder}`,
                          padding: '0.15rem 0.55rem',
                          borderRadius: '9999px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            backgroundColor: badgeColor,
                          }}
                        />
                        {item.stageLabel}
                      </span>
                    </td>

                    {/* Net Payout Amount */}
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          color: item.earningsStage === 'released' ? 'var(--accent-lime, #10b981)' : '#ffffff',
                        }}
                      >
                        +${item.amountUsd}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Footer Summary ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Showing <strong>{filteredItems.length}</strong> of <strong>{items.length}</strong> orders
        </span>
        <div>
          <span>Filtered Volume: </span>
          <strong style={{ color: 'var(--accent-lime, #10b981)', fontSize: '0.95rem' }}>
            ${totalFilteredUsd} USD
          </strong>
        </div>
      </div>
    </Card>
  );
};
export default OrderEarningsBreakdown;
