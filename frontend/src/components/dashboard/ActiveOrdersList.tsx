import React from 'react';
import { DashboardActiveOrder } from '../../types/dashboard';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export interface ActiveOrdersListProps {
  orders: DashboardActiveOrder[];
}

export const ActiveOrdersList: React.FC<ActiveOrdersListProps> = ({ orders }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Active Orders &amp; Runs</h2>
          <span className="badge badge-lime" style={{ fontSize: '0.72rem' }}>
            {orders.length} Active
          </span>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Orders you created or are actively assigned to as a verified booster.
        </p>
      </div>

      {orders.length === 0 ? (
        <Card highlight="none" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'rgba(124, 58, 237, 0.15)',
              color: '#c4b5fd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              margin: '0 auto 1rem',
            }}
          >
            📋
          </div>
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem', color: '#fff' }}>
            No Active Orders
          </h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 1.5rem' }}>
            You do not currently have any orders in progress. Check available community services to book a run or claim open listings on Discord.
          </p>
          <a href="/#services" style={{ textDecoration: 'none' }}>
            <Button variant="purple" size="sm">
              Explore Boost Services
            </Button>
          </a>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {orders.map((order) => {
            const isBooster = order.userRelation === 'booster';
            const roleBadgeClass = isBooster ? 'badge-lime' : 'badge-purple';
            const roleLabel = isBooster ? 'Assigned Booster' : 'Customer / Order Owner';

            const statusColor =
              order.status === 'in_progress'
                ? 'var(--accent-lime)'
                : order.status === 'assigned'
                ? '#38bdf8'
                : order.status === 'disputed'
                ? 'var(--status-danger)'
                : 'var(--text-muted)';

            return (
              <Card key={order.id} highlight={isBooster ? 'lime' : 'purple'} style={{ padding: '1.25rem' }}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    marginBottom: '1rem',
                  }}
                >
                  {/* Left: Ref and Title */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: '1rem' }}>
                        #{order.orderRef}
                      </span>
                      <span className={`badge ${roleBadgeClass}`} style={{ fontSize: '0.68rem' }}>
                        {roleLabel}
                      </span>
                      <span className="badge badge-muted" style={{ fontSize: '0.68rem', textTransform: 'capitalize' }}>
                        {order.orderMode.replace('_', ' ')}
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.15rem', color: '#fff', marginBottom: '0.25rem' }}>
                      {order.gameDisplayName} — <span style={{ color: 'var(--accent-lime)' }}>{order.serviceDisplayName}</span>
                    </h3>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Created: {new Date(order.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* Right: Status and Payout */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                      {isBooster ? 'Booster Allocation' : 'Order Gross Amount'}
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-lime)' }}>
                      ${order.payoutUsd} USD
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: statusColor, textTransform: 'uppercase' }}>
                      Status: {order.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>

                {/* Bottom Action and Details Bar */}
                <div
                  style={{
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '0.85rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  {/* Progress notes */}
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {order.runsCount > 0 && (
                      <span>
                        Run Progress: <strong style={{ color: '#fff' }}>{order.completedRunsCount} / {order.runsCount} completed</strong>
                      </span>
                    )}
                    {order.assignmentRole && (
                      <span>
                        Assigned Role: <strong style={{ color: '#c4b5fd' }}>{order.assignmentRole}</strong>
                      </span>
                    )}
                  </div>

                  {/* Private Channel Button if authorized */}
                  <div>
                    {order.channelUrl ? (
                      <a
                        href={order.channelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-purple btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z" />
                        </svg>
                        Open Private Discord Channel &nearr;
                      </a>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Channel pending coordination
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
