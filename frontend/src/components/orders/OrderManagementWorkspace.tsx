import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/LoadingState';
import { OrderItem, OrderDiagnosticsData, OrderAuditLogItem, PaginationMeta } from '../../types/operations';
import {
  fetchManagementOrders,
  fetchOrderDiagnostics,
  fetchOrderAuditHistory,
  publishOrderCard,
  reviewOrderStaff,
  approveOrderAdmin,
  payOrderFromWallet,
  cancelOrder,
} from '../../services/operations';
import { useAuth } from '../../hooks/useAuth';

interface OrderManagementWorkspaceProps {
  initialTab?: 'g4x' | 'advertiser';
  title?: string;
  subtitle?: string;
}

export const OrderManagementWorkspace: React.FC<OrderManagementWorkspaceProps> = ({
  initialTab = 'g4x',
  title = 'Unified Order Management Workspace',
  subtitle = 'Inspect live order pipelines, roster assignments, proof lifecycle transitions, and Discord synchronization across G4X direct and advertiser operations.',
}) => {
  const { hasRole } = useAuth();
  const isPrivileged = hasRole('admin') || hasRole('owner') || hasRole('manager') || hasRole('staff');

  // Workspace tab: 'g4x' vs 'advertiser'
  const [tab, setTab] = useState<'g4x' | 'advertiser'>(initialTab);

  // Orders and Pagination state
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [counts, setCounts] = useState<{ g4x: number; advertiser: number; needsReview: number }>({
    g4x: 0,
    advertiser: 0,
    needsReview: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [gameSlugFilter, setGameSlugFilter] = useState<string>('all');
  const [sourceWebsiteFilter, setSourceWebsiteFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Diagnostics Modal state
  const [diagnosticsOrder, setDiagnosticsOrder] = useState<OrderDiagnosticsData | null>(null);
  const [diagnosticsAudit, setDiagnosticsAudit] = useState<OrderAuditLogItem[]>([]);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState<boolean>(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  // Cancel Modal state
  const [cancellingOrder, setCancellingOrder] = useState<OrderItem | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [submittingCancel, setSubmittingCancel] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Action execution state
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load orders from backend
  const loadOrders = useCallback(
    async (pageToLoad: number = 1) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchManagementOrders({
          tab,
          search: search.trim() || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          paymentStatus: paymentStatusFilter !== 'all' ? paymentStatusFilter : undefined,
          gameSlug: gameSlugFilter !== 'all' ? gameSlugFilter : undefined,
          sourceWebsite: tab === 'g4x' && sourceWebsiteFilter !== 'all' ? sourceWebsiteFilter : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          page: pageToLoad,
          limit: pagination.limit,
        });

        setOrders(res.orders || []);
        setPagination(res.pagination || { page: pageToLoad, limit: 15, total: 0, totalPages: 1 });
        if (res.counts) {
          setCounts(res.counts);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch orders from server.');
      } finally {
        setLoading(false);
      }
    },
    [tab, search, statusFilter, paymentStatusFilter, gameSlugFilter, sourceWebsiteFilter, startDate, endDate, pagination.limit]
  );

  useEffect(() => {
    loadOrders(1);
  }, [tab, loadOrders]);

  // Open Diagnostics & Audit Modal
  const handleOpenDiagnostics = async (orderId: number) => {
    setLoadingDiagnostics(true);
    setDiagnosticsError(null);
    setDiagnosticsOrder(null);
    setDiagnosticsAudit([]);
    try {
      const [diagRes, auditRes] = await Promise.all([
        fetchOrderDiagnostics(orderId),
        fetchOrderAuditHistory(orderId).catch(() => ({ success: false, auditLogs: [] })),
      ]);
      if (diagRes && diagRes.order) {
        setDiagnosticsOrder(diagRes.order);
      }
      if (auditRes && Array.isArray(auditRes.auditLogs)) {
        setDiagnosticsAudit(auditRes.auditLogs);
      }
    } catch (err: any) {
      setDiagnosticsError(err.message || 'Failed to retrieve order diagnostics.');
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  // Publish Order
  const handlePublish = async (orderId: number, orderRef?: string) => {
    if (!window.confirm(`Publish Order #${orderRef || orderId} to the live Discord Orders Board?`)) return;
    setActionInProgressId(orderId);
    setFeedback(null);
    try {
      const res = await publishOrderCard(orderId);
      setFeedback({ text: res.message || `Order #${orderRef || orderId} published to Discord.`, type: 'success' });
      loadOrders(pagination.page);
    } catch (err: any) {
      setFeedback({ text: err.message || `Failed to publish order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressId(null);
    }
  };

  // Staff Review Order
  const handleStaffReview = async (orderId: number, orderRef?: string) => {
    setActionInProgressId(orderId);
    setFeedback(null);
    try {
      await reviewOrderStaff(orderId, 'Verified via Order Management Workspace');
      setFeedback({ text: `Order #${orderRef || orderId} marked as staff-reviewed and ready for final approval.`, type: 'success' });
      loadOrders(pagination.page);
    } catch (err: any) {
      setFeedback({ text: err.message || `Failed to review order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressId(null);
    }
  };

  // Final Operational Approve
  const handleFinalApprove = async (orderId: number, orderRef?: string) => {
    setActionInProgressId(orderId);
    setFeedback(null);
    try {
      const res = await approveOrderAdmin(orderId, 'Final operational approval recorded via Order Management Workspace');
      setFeedback({ text: res.message || `Order #${orderRef || orderId} approved for release hold.`, type: 'success' });
      loadOrders(pagination.page);
    } catch (err: any) {
      setFeedback({ text: err.message || `Failed to approve order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressId(null);
    }
  };

  // Pay from Wallet
  const handlePayFromWallet = async (orderId: number, orderRef?: string) => {
    if (!window.confirm(`Pay for Order #${orderRef || orderId} from backed Wallet balance?`)) return;
    setActionInProgressId(orderId);
    setFeedback(null);
    try {
      const res = await payOrderFromWallet(orderId);
      setFeedback({ text: res.message || `Order #${orderRef || orderId} successfully funded from Wallet balance.`, type: 'success' });
      loadOrders(pagination.page);
    } catch (err: any) {
      setFeedback({ text: err.message || `Failed to pay for order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressId(null);
    }
  };

  // Confirm Cancel Order
  const handleConfirmCancel = async () => {
    if (!cancellingOrder) return;
    if (!cancelReason || cancelReason.trim().length < 5) {
      setCancelError('Please enter a cancellation reason of at least 5 characters.');
      return;
    }
    setSubmittingCancel(true);
    setCancelError(null);
    try {
      const res = await cancelOrder(cancellingOrder.id, cancelReason.trim());
      setFeedback({ text: res.message || `Order #${cancellingOrder.orderRef || cancellingOrder.id} cancelled.`, type: 'success' });
      setCancellingOrder(null);
      setCancelReason('');
      loadOrders(pagination.page);
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel order.');
    } finally {
      setSubmittingCancel(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPaymentStatusFilter('all');
    setGameSlugFilter('all');
    setSourceWebsiteFilter('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Workspace Header & Tabs */}
      <Card style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
              {title}
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, maxWidth: '850px' }}>
              {subtitle}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadOrders(pagination.page)}
              disabled={loading}
            >
              ↻ Refresh Orders
            </button>
          </div>
        </div>

        {/* Pipeline Tabs */}
        <div style={{ display: 'flex', gap: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'g4x' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
            onClick={() => setTab('g4x')}
          >
            <span>🛡️ G4X Direct &amp; Platform Orders</span>
            {counts.g4x > 0 && (
              <span className="badge badge-purple" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                {counts.g4x}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'advertiser' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
            onClick={() => setTab('advertiser')}
          >
            <span>💼 Advertiser Boost Orders</span>
            {counts.advertiser > 0 && (
              <span className="badge badge-purple" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                {counts.advertiser}
              </span>
            )}
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center' }}>
          <div style={{ flex: '1 1 200px' }}>
            <input
              type="text"
              placeholder="Search Ref, ID, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadOrders(1)}
              className="input"
              style={{ width: '100%', padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
            />
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input"
              style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Pipeline</option>
              <option value="payment_pending">Payment Pending</option>
              <option value="open_presign">Open Presign (Available)</option>
              <option value="assigned">Assigned / Roster Full</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="disputed">Disputed</option>
              <option value="history">History</option>
            </select>
          </div>

          <div>
            <select
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              className="input"
              style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
            >
              <option value="all">All Payment States</option>
              <option value="verified">Verified / Paid</option>
              <option value="pending">Payment Pending</option>
              <option value="unneeded">Unneeded (Internal)</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          <div>
            <select
              value={gameSlugFilter}
              onChange={(e) => setGameSlugFilter(e.target.value)}
              className="input"
              style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
            >
              <option value="all">All Games</option>
              <option value="wow">World of Warcraft</option>
              <option value="diablo4">Diablo IV</option>
              <option value="poe">Path of Exile</option>
            </select>
          </div>

          {tab === 'g4x' && (
            <div>
              <select
                value={sourceWebsiteFilter}
                onChange={(e) => setSourceWebsiteFilter(e.target.value)}
                className="input"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
              >
                <option value="all">All Platforms</option>
                <option value="direct">G4X Direct</option>
                <option value="g2g">G2G Marketplace</option>
                <option value="skycoach">SkyCoach</option>
                <option value="eldorado">Eldorado</option>
                <option value="needs_review">Needs Review</option>
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
              style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem' }}
              title="Start Date"
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input"
              style={{ padding: '0.4rem 0.5rem', fontSize: '0.8rem' }}
              title="End Date"
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => loadOrders(1)}
              style={{ fontSize: '0.8rem' }}
            >
              Apply Filter
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleResetFilters}
              style={{ fontSize: '0.8rem' }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Action Feedback Banner */}
        {feedback && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
              border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              ✕
            </button>
          </div>
        )}
      </Card>

      {/* Orders Table Card */}
      <Card style={{ padding: '1.25rem', backgroundColor: 'var(--bg-surface)' }}>
        {loading ? (
          <LoadingState message="Loading order workspace pipeline..." />
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--status-danger)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadOrders(pagination.page)}>
              Retry
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
            <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>No Orders Found</h4>
            <p style={{ fontSize: '0.85rem', margin: '0 0 1rem 0' }}>
              No orders matched your selected pipeline tab and filter criteria.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleResetFilters}>
              Clear Filters
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Order Ref / Date</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Game &amp; Service</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Source / Origin</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Customer / External</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Gross / Booster Pool</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Status &amp; Payment</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Roster</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const orderRef = o.orderRef || `ORD-${o.id}`;
                  const isPaid = o.paymentStatus === 'verified' || o.paymentStatus === 'unneeded';
                  const stage = o.boostReleaseTracker?.stage || o.releaseStage || '';

                  return (
                    <tr key={o.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      {/* Ref & Date */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {orderRef}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {new Date(o.createdAt).toLocaleDateString()}
                        </div>
                      </td>

                      {/* Game & Service */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 600 }}>{o.gameName || o.gameSlug || o.game || 'Game'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {o.serviceName || o.service || 'Boost Service'}
                        </div>
                      </td>

                      {/* Source / Origin */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span
                          className={`badge ${
                            o.sourceWebsite === 'g2g'
                              ? 'badge-purple'
                              : o.sourceWebsite === 'skycoach'
                              ? 'badge-blue'
                              : o.sourceWebsite === 'eldorado'
                              ? 'badge-lime'
                              : o.originType === 'advertiser' || o.source === 'advertiser'
                              ? 'badge-purple'
                              : 'badge-gray'
                          }`}
                          style={{ fontSize: '0.72rem' }}
                        >
                          {o.sourceLabel || o.sourceWebsite || o.originType || 'G4X'}
                        </span>
                      </td>

                      {/* Customer / External */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        {o.advertiser ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{o.advertiser.displayName}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              Rank: {o.advertiser.advertiserRank || 'Standard'}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>{o.externalOrderId || o.customerDiscordId || 'Direct Customer'}</div>
                            {o.platformAccount && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Acct: {o.platformAccount.displayName}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Amounts */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent-lime)' }}>
                          ${o.grossAmountUsd || ((o.grossAmountMinor || 0) / 100).toFixed(2)}
                        </div>
                        {o.feeInfo?.boosterPoolUsd && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Pool: ${o.feeInfo.boosterPoolUsd}
                          </div>
                        )}
                      </td>

                      {/* Status & Payment Badges */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                          <span
                            className={`badge ${
                              o.status === 'completed'
                                ? 'badge-success'
                                : o.status === 'cancelled' || o.status === 'disputed'
                                ? 'badge-danger'
                                : o.status === 'in_progress' || o.status === 'assigned'
                                ? 'badge-purple'
                                : o.status === 'payment_pending'
                                ? 'badge-warning'
                                : 'badge-lime'
                            }`}
                            style={{ fontSize: '0.72rem' }}
                          >
                            {o.simplifiedStatus || o.status}
                          </span>
                          <span
                            className={`badge ${
                              isPaid ? 'badge-success' : o.paymentStatus === 'pending' ? 'badge-warning' : 'badge-danger'
                            }`}
                            style={{ fontSize: '0.68rem' }}
                          >
                            Pay: {o.paymentStatus}
                          </span>
                        </div>
                      </td>

                      {/* Roster / Booster Count */}
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontSize: '0.8rem' }}>
                          {o.assignedBooster ? (
                            <span style={{ color: 'var(--accent-lime)' }}>✓ {o.assignedBooster}</span>
                          ) : o.assignedCount && o.assignedCount > 0 ? (
                            <span>{o.assignedCount} Booster(s)</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Unassigned (0)</span>
                          )}
                        </div>
                        {o.runsCount !== undefined && o.runsCount > 0 && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Runs: {o.runsCount}
                          </div>
                        )}
                      </td>

                      {/* Permitted Action Buttons */}
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {/* Diagnostics Button */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            title="View Lifecycle Diagnostics & Audit History"
                            onClick={() => handleOpenDiagnostics(o.id)}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                          >
                            🔎 Diag
                          </button>

                          {/* Publish Button */}
                          {(o.authorizedActions?.includes('publish') || (isPaid && !o.discordMessageId && o.status !== 'cancelled' && o.status !== 'completed')) && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={actionInProgressId === o.id}
                              onClick={() => handlePublish(o.id, orderRef)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            >
                              📢 Publish
                            </button>
                          )}

                          {/* Staff Review Button */}
                          {(o.authorizedActions?.includes('staff_review') || stage === 'PROOF_SUBMITTED') && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              disabled={actionInProgressId === o.id}
                              onClick={() => handleStaffReview(o.id, orderRef)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}
                            >
                              📋 Staff Rev
                            </button>
                          )}

                          {/* Final Approval Button */}
                          {(o.authorizedActions?.includes('final_approve') || stage === 'STAFF_REVIEW') && (
                            <button
                              type="button"
                              className="btn btn-cta btn-xs"
                              disabled={actionInProgressId === o.id}
                              onClick={() => handleFinalApprove(o.id, orderRef)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            >
                              ✅ Approve
                            </button>
                          )}

                          {/* Pay from Wallet Button */}
                          {(o.authorizedActions?.includes('pay_wallet') || o.paymentStatus === 'pending') && (
                            <button
                              type="button"
                              className="btn btn-xs"
                              disabled={actionInProgressId === o.id}
                              onClick={() => handlePayFromWallet(o.id, orderRef)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--status-success)' }}
                            >
                              💳 Pay
                            </button>
                          )}

                          {/* Cancel Button */}
                          {(o.authorizedActions?.includes('cancel') || (isPrivileged && o.status !== 'cancelled' && o.status !== 'completed')) && (
                            <button
                              type="button"
                              className="btn btn-xs"
                              disabled={actionInProgressId === o.id}
                              onClick={() => {
                                setCancellingOrder(o);
                                setCancelReason('');
                                setCancelError(null);
                              }}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--status-danger)' }}
                            >
                              ✕ Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} orders total)
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadOrders(pagination.page - 1)}
                >
                  &larr; Prev
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadOrders(pagination.page + 1)}
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Diagnostics & Audit History Modal */}
      {(loadingDiagnostics || diagnosticsOrder || diagnosticsError) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={() => {
            setDiagnosticsOrder(null);
            setDiagnosticsError(null);
          }}
        >
          <div
            className="card-surface"
            style={{ maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDiagnostics ? (
              <LoadingState message="Fetching order lifecycle diagnostics & audit records..." />
            ) : diagnosticsError ? (
              <div>
                <h3 style={{ color: 'var(--status-danger)', margin: '0 0 0.5rem 0' }}>Diagnostics Error</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{diagnosticsError}</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDiagnosticsError(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : diagnosticsOrder ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                      Order #{diagnosticsOrder.orderRef} Diagnostics
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {diagnosticsOrder.gameName} &bull; {diagnosticsOrder.serviceName} ({diagnosticsOrder.orderMode})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => setDiagnosticsOrder(null)}
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Key Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Gross Amount</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--accent-lime)' }}>
                      ${diagnosticsOrder.grossAmountUsd}
                    </div>
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Booster Pool</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#60a5fa' }}>
                      ${diagnosticsOrder.boosterPoolUsd}
                    </div>
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Platform Fee</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-purple)' }}>
                      ${diagnosticsOrder.platformFeeUsd}
                    </div>
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Payment State</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase' }}>
                      {diagnosticsOrder.paymentStatus}
                    </div>
                  </div>
                </div>

                {/* Lifecycle Diagnosis Explanation */}
                <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--border-subtle)', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Lifecycle Explanation:</div>
                  <p style={{ color: 'var(--text-muted)', margin: '0 0 0.5rem 0' }}>{diagnosticsOrder.explanationEnglish}</p>
                  <div style={{ fontWeight: 700, color: 'var(--status-warning)', marginBottom: '0.25rem' }}>Required Next Action:</div>
                  <p style={{ color: 'var(--status-warning)', margin: 0 }}>{diagnosticsOrder.requiredNextActionEnglish}</p>
                </div>

                {/* Publication Block Reasons (if any) */}
                {diagnosticsOrder.publicationBlockReasons && diagnosticsOrder.publicationBlockReasons.length > 0 && (
                  <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--status-danger)', marginBottom: '0.25rem' }}>Publication Blocked Reasons:</div>
                    <ul style={{ margin: '0 0 0 1.25rem', padding: 0, color: 'var(--text-primary)' }}>
                      {diagnosticsOrder.publicationBlockReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Discord & Channel Status */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
                  <div style={{ padding: '0.65rem 0.85rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ color: 'var(--text-muted)' }}>Discord Board Message:</div>
                    <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {diagnosticsOrder.discordMessageId ? `✓ Published (${diagnosticsOrder.discordMessageId})` : 'Not Published'}
                    </div>
                  </div>
                  <div style={{ padding: '0.65rem 0.85rem', backgroundColor: 'var(--bg-main)', borderRadius: '6px' }}>
                    <div style={{ color: 'var(--text-muted)' }}>Execution Channel:</div>
                    <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {diagnosticsOrder.executionChannelId ? `Channel ID: ${diagnosticsOrder.executionChannelId}` : 'Not Provisioned'}
                    </div>
                  </div>
                </div>

                {/* Audit Logs Table */}
                {diagnosticsAudit.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>Order Audit History</h4>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-main)', textAlign: 'left', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '0.4rem 0.5rem' }}>Date</th>
                            <th style={{ padding: '0.4rem 0.5rem' }}>Actor</th>
                            <th style={{ padding: '0.4rem 0.5rem' }}>Action</th>
                            <th style={{ padding: '0.4rem 0.5rem' }}>Reason / Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnosticsAudit.map((log) => (
                            <tr key={log.id} style={{ borderTop: '1px solid rgba(45, 38, 69, 0.4)' }}>
                              <td style={{ padding: '0.4rem 0.5rem' }}>{new Date(log.createdAt).toLocaleString()}</td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>{log.actorUsername || log.actorId}</td>
                              <td style={{ padding: '0.4rem 0.5rem' }}>
                                <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>{log.action}</span>
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-muted)' }}>{log.reason || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDiagnosticsOrder(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrder && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div className="card-surface" style={{ maxWidth: '480px', width: '100%', padding: '1.75rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--status-danger)' }}>
              Cancel Order #{cancellingOrder.orderRef || cancellingOrder.id}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>
              Cancelling this order will release any allocated roster assignments, update the order status, and clean up Discord channels. A meaningful cancellation reason is required.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Cancellation Reason *
              </label>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="E.g. Customer requested cancellation / Advertiser budget change..."
                className="input"
                style={{ width: '100%', fontSize: '0.85rem', resize: 'vertical' }}
              />
            </div>

            {cancelError && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--status-danger)',
                }}
              >
                {cancelError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCancellingOrder(null);
                  setCancelReason('');
                  setCancelError(null);
                }}
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={submittingCancel || cancelReason.trim().length < 5}
                className="btn btn-sm"
                onClick={handleConfirmCancel}
                style={{ backgroundColor: 'var(--status-danger)', color: '#fff' }}
              >
                {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
