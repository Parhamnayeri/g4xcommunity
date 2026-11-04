import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ManagementOverviewResponse,
  OrderItem,
  RegistrationApplicationItem,
  DisputeItem,
  PaginationMeta,
} from '../types/operations';
import {
  fetchManagementOverview,
  fetchManagementOrders,
  approveOrderAdmin,
  publishOrderCard,
  fetchRegistrationApplications,
  reviewRegistrationApplication,
  fetchManagementDisputes,
  resolveManagementDispute,
} from '../services/operations';
import { LoadingState } from '../components/ui/LoadingState';

export const ManagementPage: React.FC = () => {
  const { user } = useAuth();

  // Overview State
  const [overview, setOverview] = useState<ManagementOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'orders' | 'applications' | 'disputes' | 'audit'>('orders');

  // Orders State
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [ordersPagination, setOrdersPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSourceFilter, setOrderSourceFilter] = useState<'all' | 'advertiser' | 'external_g4x'>('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [orderSearch, setOrderSearch] = useState('');

  // Applications State
  const [applications, setApplications] = useState<RegistrationApplicationItem[]>([]);
  const [appsPagination, setAppsPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [appsLoading, setAppsLoading] = useState(false);
  const [appCategoryFilter, setAppCategoryFilter] = useState('');
  const [appStatusFilter, setAppStatusFilter] = useState('pending');

  // Application Review Modal
  const [selectedApp, setSelectedApp] = useState<RegistrationApplicationItem | null>(null);
  const [appDecision, setAppDecision] = useState<'approve' | 'reject' | 'request_info'>('approve');
  const [appReviewNotes, setAppReviewNotes] = useState('');
  const [submittingAppReview, setSubmittingAppReview] = useState(false);
  const [appReviewMessage, setAppReviewMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Disputes State
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [disputesPagination, setDisputesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [disputesLoading, setDisputesLoading] = useState(false);

  // Dispute Resolution Modal
  const [selectedDispute, setSelectedDispute] = useState<DisputeItem | null>(null);
  const [disputeDecision, setDisputeDecision] = useState<'refund_customer' | 'release_booster' | 'split' | 'dismiss'>('release_booster');
  const [disputeNotes, setDisputeNotes] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeMessage, setDisputeMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Order Action State
  const [actionInProgressOrderId, setActionInProgressOrderId] = useState<number | null>(null);
  const [orderActionFeedback, setOrderActionFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load Overview
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchManagementOverview();
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load executive management overview');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Load Orders
  const loadOrders = useCallback(async (page: number = 1) => {
    setOrdersLoading(true);
    try {
      const res = await fetchManagementOrders({
        source: orderSourceFilter === 'all' ? undefined : orderSourceFilter,
        status: orderStatusFilter || undefined,
        search: orderSearch || undefined,
        page,
        limit: 10,
      });
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
      setOrdersPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err: any) {
      console.error('Failed to load management orders:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [orderSourceFilter, orderStatusFilter, orderSearch]);

  // Load Applications
  const loadApplications = useCallback(async (page: number = 1) => {
    setAppsLoading(true);
    try {
      const res = await fetchRegistrationApplications({
        category: appCategoryFilter || undefined,
        status: appStatusFilter || undefined,
        page,
        limit: 10,
      });
      setApplications(Array.isArray(res?.applications) ? res.applications : []);
      setAppsPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err: any) {
      console.error('Failed to load applications:', err);
    } finally {
      setAppsLoading(false);
    }
  }, [appCategoryFilter, appStatusFilter]);

  // Load Disputes
  const loadDisputes = useCallback(async (page: number = 1) => {
    setDisputesLoading(true);
    try {
      const res = await fetchManagementDisputes({ page, limit: 10 });
      setDisputes(Array.isArray(res?.disputes) ? res.disputes : []);
      setDisputesPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err: any) {
      console.error('Failed to load disputes:', err);
    } finally {
      setDisputesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab === 'orders') {
      loadOrders(1);
    } else if (activeTab === 'applications') {
      loadApplications(1);
    } else if (activeTab === 'disputes') {
      loadDisputes(1);
    }
  }, [activeTab, loadOrders, loadApplications, loadDisputes]);

  // Order Admin Final Approval Handler
  const handleApproveOrder = async (orderId: number) => {
    setActionInProgressOrderId(orderId);
    setOrderActionFeedback(null);
    try {
      const res = await approveOrderAdmin(orderId, 'Operational final approval by Manager console');
      setOrderActionFeedback({ text: res.message || `Order #${orderId} approved successfully.`, type: 'success' });
      loadOrders(ordersPagination?.page ?? 1);
      loadOverview();
    } catch (err: any) {
      setOrderActionFeedback({ text: err.message || `Failed to approve order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressOrderId(null);
    }
  };

  // Order Discord Publish Handler
  const handlePublishOrder = async (orderId: number) => {
    setActionInProgressOrderId(orderId);
    setOrderActionFeedback(null);
    try {
      const res = await publishOrderCard(orderId);
      setOrderActionFeedback({ text: res.message || `Order #${orderId} published to Discord.`, type: 'success' });
      loadOrders(ordersPagination?.page ?? 1);
    } catch (err: any) {
      setOrderActionFeedback({ text: err.message || `Failed to publish order #${orderId}`, type: 'error' });
    } finally {
      setActionInProgressOrderId(null);
    }
  };

  // Submit Application Review
  const handleSubmitAppReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;
    setSubmittingAppReview(true);
    setAppReviewMessage(null);
    try {
      await reviewRegistrationApplication(selectedApp.id, appDecision, appReviewNotes);
      setAppReviewMessage({
        text: `Application #${selectedApp.id} updated with decision: ${appDecision}`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedApp(null);
        loadApplications(appsPagination?.page ?? 1);
        loadOverview();
      }, 1200);
    } catch (err: any) {
      setAppReviewMessage({
        text: err.message || 'Failed to submit application review',
        type: 'error',
      });
    } finally {
      setSubmittingAppReview(false);
    }
  };

  // Submit Dispute Resolution
  const handleSubmitDisputeResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute) return;
    if (!disputeNotes.trim()) {
      setDisputeMessage({ text: 'Resolution rationale is mandatory for audit records.', type: 'error' });
      return;
    }
    setSubmittingDispute(true);
    setDisputeMessage(null);
    try {
      await resolveManagementDispute(selectedDispute.id, disputeDecision, disputeNotes);
      setDisputeMessage({
        text: `Dispute #${selectedDispute.id} resolved with decision: ${disputeDecision}`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedDispute(null);
        loadDisputes(disputesPagination?.page ?? 1);
        loadOverview();
      }, 1200);
    } catch (err: any) {
      setDisputeMessage({
        text: err.message || 'Failed to resolve dispute',
        type: 'error',
      });
    } finally {
      setSubmittingDispute(false);
    }
  };

  if (loadingOverview) {
    return <LoadingState message="Loading executive management portal..." />;
  }

  if (overviewError) {
    return (
      <div className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Unauthorized Access</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{overviewError}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          This console requires Management, Admin or Owner role privileges.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header Banner */}
      <div
        className="card-surface"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem',
          borderLeft: '4px solid var(--primary-purple)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span
              style={{
                backgroundColor: 'rgba(124, 58, 237, 0.2)',
                color: 'var(--primary-purple)',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Management Console
            </span>
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Executive Operations &amp; Workload</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem', margin: 0 }}>
            Real-time pipeline oversight, booster capacity, dispute escalation, and registration verification.
          </p>
        </div>

        {/* KYC Portal Navigation Link */}
        <Link
          to="/management/kyc"
          className="btn btn-cta btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.25rem',
          }}
        >
          <span>🛡️ Open KYC Review Portal</span>
          <span
            style={{
              backgroundColor: 'var(--text-inverse)',
              color: 'var(--accent-lime)',
              borderRadius: '999px',
              padding: '0.1rem 0.5rem',
              fontSize: '0.75rem',
              fontWeight: 800,
            }}
          >
            {overview?.kpis.pendingKycVerificationsCount ?? 0}
          </span>
        </Link>
      </div>

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Orders</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
            {overview?.kpis.activeOrdersCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            G4X Marketplace: {overview?.kpis.externalOrdersCount ?? 0} | Advertiser: {overview?.kpis.advertiserOrdersCount ?? 0}
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Booster Pool</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            {overview?.kpis.totalActiveBoosters ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--status-info)', marginTop: '0.5rem' }}>
            Verified &amp; active roster capacity
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pending Applications</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--status-warning)', marginTop: '0.25rem' }}>
            {overview?.kpis.pendingApplicationsCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Boosters, Pilots, Advertisers, Exchangers
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Open Disputes</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--status-danger)', marginTop: '0.25rem' }}>
            {overview?.kpis.openDisputesCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Unresolved customer/booster claims
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', gap: '1rem', overflowX: 'auto' }}>
        <button
          onClick={() => setActiveTab('orders')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'orders' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'orders' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Order Pipeline ({overview?.kpis.activeOrdersCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('applications')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'applications' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'applications' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Registration Applications ({overview?.kpis.pendingApplicationsCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('disputes')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'disputes' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'disputes' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Dispute Escalations ({overview?.kpis.openDisputesCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'audit' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'audit' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Platform Audit Trail
        </button>
      </div>

      {/* Global Feedback Banner */}
      {orderActionFeedback && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-xs)',
            fontSize: '0.85rem',
            backgroundColor: orderActionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: orderActionFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border: `1px solid ${orderActionFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)'}`,
          }}
        >
          {orderActionFeedback.text}
        </div>
      )}

      {/* Tab 1: Order Pipeline */}
      {activeTab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Controls */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={orderSourceFilter}
                onChange={(e) => setOrderSourceFilter(e.target.value as any)}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">All Sources (G4X &amp; Advertiser)</option>
                <option value="external_g4x">G4X Marketplace Orders</option>
                <option value="advertiser">External Advertiser Orders</option>
              </select>

              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Statuses</option>
                <option value="CREATED">Created</option>
                <option value="ROSTERING">Rostering</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <input
                type="text"
                placeholder="Search order ID or customer..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '0.85rem',
                  width: '220px',
                }}
              />
            </div>

            <button
              onClick={() => loadOrders(ordersPagination?.page ?? 1)}
              className="btn btn-sm"
              style={{
                backgroundColor: 'var(--bg-surface-hover)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Refresh Orders
            </button>
          </div>

          {/* Orders Table */}
          <div className="card-surface" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            {ordersLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching pipeline orders..." />
              </div>
            ) : orders.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No orders match current criteria.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Order ID</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Source</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Service</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Customer</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Payment</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Roster</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const isPublishable =
                        (order.status === 'CREATED' || order.status === 'ROSTERING') &&
                        !order.discordMessageId &&
                        ['ESCROW_LOCKED', 'PAID', 'OVERPAID'].includes(order.paymentStatus);

                      const isAwaitingAdminApproval =
                        order.boostReleaseTracker?.stage === 'staff_reviewed' &&
                        !order.boostReleaseTracker?.adminApprovedAt;

                      const isBusy = actionInProgressOrderId === order.id;

                      return (
                        <tr key={order.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '0.9rem 1.25rem', fontWeight: 700 }}>#{order.id}</td>
                          <td style={{ padding: '0.9rem 1.25rem' }}>
                            <span
                              style={{
                                padding: '0.2rem 0.5rem',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                backgroundColor:
                                  order.source === 'external_g4x'
                                    ? 'rgba(204, 255, 0, 0.15)'
                                    : 'rgba(124, 58, 237, 0.15)',
                                color:
                                  order.source === 'external_g4x'
                                    ? 'var(--accent-lime)'
                                    : 'var(--primary-purple)',
                              }}
                            >
                              {order.source === 'external_g4x' ? 'G4X Market' : `Adv: ${order.advertiserName || 'External'}`}
                            </span>
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem' }}>
                            <div>{order.game}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{order.service}</div>
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {order.customerDiscordId}
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem' }}>
                            <span
                              style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              }}
                            >
                              {order.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem' }}>
                            <span
                              style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: ['ESCROW_LOCKED', 'PAID', 'OVERPAID'].includes(order.paymentStatus)
                                  ? 'var(--status-success)'
                                  : 'var(--status-warning)',
                              }}
                            >
                              {order.paymentStatus}
                            </span>
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem' }}>
                            <div style={{ fontSize: '0.8rem' }}>
                              {order.slots?.filter((s) => s.boosterUserId).length || 0} / {order.slots?.length || 0} slots
                            </div>
                          </td>
                          <td style={{ padding: '0.9rem 1.25rem', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              {isPublishable && (
                                <button
                                  disabled={isBusy}
                                  onClick={() => handlePublishOrder(order.id)}
                                  className="btn btn-sm"
                                  style={{
                                    backgroundColor: 'var(--primary-purple)',
                                    color: '#ffffff',
                                    fontSize: '0.75rem',
                                    padding: '0.3rem 0.6rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  {isBusy ? '...' : 'Publish Card'}
                                </button>
                              )}
                              {isAwaitingAdminApproval && (
                                <button
                                  disabled={isBusy}
                                  onClick={() => handleApproveOrder(order.id)}
                                  className="btn btn-sm"
                                  style={{
                                    backgroundColor: 'var(--status-success)',
                                    color: '#0d0b12',
                                    fontSize: '0.75rem',
                                    padding: '0.3rem 0.6rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  {isBusy ? '...' : 'Approve Run'}
                                </button>
                              )}
                              {!isPublishable && !isAwaitingAdminApproval && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {order.discordMessageId ? 'Published' : 'Locked'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {(ordersPagination?.totalPages ?? 0) > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                <div>
                  Page {ordersPagination?.page ?? 1} of {ordersPagination?.totalPages || 1} ({ordersPagination?.total ?? 0} orders)
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    disabled={(ordersPagination?.page ?? 1) <= 1}
                    onClick={() => loadOrders((ordersPagination?.page ?? 1) - 1)}
                    className="btn btn-sm"
                    style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)' }}
                  >
                    &larr; Prev
                  </button>
                  <button
                    disabled={(ordersPagination?.page ?? 1) >= (ordersPagination?.totalPages || 1)}
                    onClick={() => loadOrders((ordersPagination?.page ?? 1) + 1)}
                    className="btn btn-sm"
                    style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)' }}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Registration Applications Queue */}
      {activeTab === 'applications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <select
              value={appCategoryFilter}
              onChange={(e) => setAppCategoryFilter(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '0.4rem 0.8rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
              }}
            >
              <option value="">All Categories</option>
              <option value="booster">Booster</option>
              <option value="pilot">Account Pilot</option>
              <option value="advertiser">Advertiser</option>
              <option value="exchanger">Exchanger</option>
            </select>

            <select
              value={appStatusFilter}
              onChange={(e) => setAppStatusFilter(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '0.4rem 0.8rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
              }}
            >
              <option value="pending">Pending</option>
              <option value="info_requested">Info Requested</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="">All Statuses</option>
            </select>
          </div>

          <div className="card-surface" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            {appsLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching registration applications..." />
              </div>
            ) : applications.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No registration applications found.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>App ID</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>User</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Category</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Identity</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Submitted</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.9rem 1.25rem', fontWeight: 700 }}>#{app.id}</td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <div style={{ fontWeight: 600 }}>{app.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{app.userId}</div>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <span
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              padding: '0.2rem 0.5rem',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: '0.75rem',
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {app.category}
                          </span>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <span
                            style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              textTransform: 'capitalize',
                              backgroundColor:
                                app.status === 'approved'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : app.status === 'rejected'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(245, 158, 11, 0.15)',
                              color:
                                app.status === 'approved'
                                  ? 'var(--status-success)'
                                  : app.status === 'rejected'
                                  ? 'var(--status-danger)'
                                  : 'var(--status-warning)',
                            }}
                          >
                            {app.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: app.identityStatus === 'verified' ? 'var(--status-success)' : 'var(--text-muted)',
                            }}
                          >
                            {app.identityStatus}
                          </span>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {new Date(app.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem', textAlign: 'right' }}>
                          {user?.discordId === app.userId ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Self-review blocked
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedApp(app);
                                setAppDecision('approve');
                                setAppReviewNotes('');
                                setAppReviewMessage(null);
                              }}
                              className="btn btn-sm"
                              style={{
                                backgroundColor: 'var(--primary-purple)',
                                color: '#ffffff',
                                fontSize: '0.75rem',
                                padding: '0.3rem 0.65rem',
                              }}
                            >
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Disputes Escalation */}
      {activeTab === 'disputes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card-surface" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            {disputesLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching disputes..." />
              </div>
            ) : disputes.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active disputes requiring management resolution.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Dispute ID</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Order #</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Claimant</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Description</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((dispute) => (
                      <tr key={dispute.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.9rem 1.25rem', fontWeight: 700 }}>#{dispute.id}</td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>Order #{dispute.orderId}</td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <div style={{ fontWeight: 600 }}>{dispute.openedBy.displayName || dispute.openedBy.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dispute.openedBy.id}</div>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>{dispute.disputeType}</td>
                        <td style={{ padding: '0.9rem 1.25rem', maxWidth: '300px' }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dispute.description}
                          </div>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <span
                            style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor:
                                dispute.status === 'resolved'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(239, 68, 68, 0.15)',
                              color:
                                dispute.status === 'resolved'
                                  ? 'var(--status-success)'
                                  : 'var(--status-danger)',
                            }}
                          >
                            {dispute.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem', textAlign: 'right' }}>
                          {dispute.status !== 'resolved' && dispute.status !== 'cancelled' ? (
                            user?.discordId === dispute.openedBy.id ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Self-resolution blocked
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedDispute(dispute);
                                  setDisputeDecision('release_booster');
                                  setDisputeNotes('');
                                  setDisputeMessage(null);
                                }}
                                className="btn btn-sm"
                                style={{
                                  backgroundColor: 'var(--status-warning)',
                                  color: '#0d0b12',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  padding: '0.3rem 0.65rem',
                                }}
                              >
                                Resolve Dispute
                              </button>
                            )
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Closed ({dispute.resolutionNotes || 'Resolved'})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="card-surface" style={{ padding: '1.5rem', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontWeight: 700 }}>Platform Audit Events</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {overview?.recentAuditTrail.map((log) => (
              <div
                key={log.id}
                style={{
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '0.85rem 1.25rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent-lime)' }}>
                    {log.action}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Actor: {log.actorId} | {log.entityType} #{log.entityId} — {log.reason || 'Operational action'}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(log.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Application Review Modal */}
      {selectedApp && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            className="card-surface"
            style={{
              maxWidth: '540px',
              width: '100%',
              padding: '2rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Review Application #{selectedApp.id}</h3>
              <button
                onClick={() => setSelectedApp(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
                marginBottom: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div><strong>Applicant:</strong> {selectedApp.username} ({selectedApp.userId})</div>
              <div><strong>Role Category:</strong> {selectedApp.category.toUpperCase()}</div>
              <div><strong>Qualifications:</strong> {selectedApp.qualifications || 'None provided'}</div>
              <div><strong>Identity Status:</strong> {selectedApp.identityStatus}</div>
            </div>

            <form onSubmit={handleSubmitAppReview} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Decision</label>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="appDecision"
                      value="approve"
                      checked={appDecision === 'approve'}
                      onChange={() => setAppDecision('approve')}
                    />
                    <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>Approve</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="appDecision"
                      value="request_info"
                      checked={appDecision === 'request_info'}
                      onChange={() => setAppDecision('request_info')}
                    />
                    <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>Request Info</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="appDecision"
                      value="reject"
                      checked={appDecision === 'reject'}
                      onChange={() => setAppDecision('reject')}
                    />
                    <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}>Reject</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Audit Review Notes
                </label>
                <textarea
                  value={appReviewNotes}
                  onChange={(e) => setAppReviewNotes(e.target.value)}
                  placeholder="Review notes or feedback for applicant..."
                  rows={3}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text-primary)',
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              {appReviewMessage && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '0.85rem',
                    backgroundColor: appReviewMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: appReviewMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                >
                  {appReviewMessage.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  disabled={submittingAppReview}
                  className="btn btn-sm"
                  style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAppReview}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: appDecision === 'approve' ? 'var(--status-success)' : 'var(--status-danger)',
                    color: '#ffffff',
                    fontWeight: 700,
                  }}
                >
                  {submittingAppReview ? 'Submitting...' : 'Confirm Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispute Resolution Modal */}
      {selectedDispute && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            className="card-surface"
            style={{
              maxWidth: '560px',
              width: '100%',
              padding: '2rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Resolve Dispute #{selectedDispute.id}</h3>
              <button
                onClick={() => setSelectedDispute(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
                marginBottom: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div><strong>Order:</strong> #{selectedDispute.orderId}</div>
              <div><strong>Claimant:</strong> {selectedDispute.openedBy.displayName || selectedDispute.openedBy.username} ({selectedDispute.openedBy.id})</div>
              <div><strong>Dispute Type:</strong> {selectedDispute.disputeType}</div>
              <div><strong>Description:</strong> {selectedDispute.description}</div>
            </div>

            <form onSubmit={handleSubmitDisputeResolution} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Resolution Decision
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="release_booster"
                      checked={disputeDecision === 'release_booster'}
                      onChange={() => setDisputeDecision('release_booster')}
                    />
                    <span>Release Funds to Booster (Proof Validated)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="refund_customer"
                      checked={disputeDecision === 'refund_customer'}
                      onChange={() => setDisputeDecision('refund_customer')}
                    />
                    <span>Refund Customer (Service Failed / Unfulfilled)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="split"
                      checked={disputeDecision === 'split'}
                      onChange={() => setDisputeDecision('split')}
                    />
                    <span>Split Settlement (Partial Completion)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="dismiss"
                      checked={disputeDecision === 'dismiss'}
                      onChange={() => setDisputeDecision('dismiss')}
                    />
                    <span>Dismiss Dispute (Unsubstantiated Claim)</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Resolution Notes &amp; Rationale <span style={{ color: 'var(--status-danger)' }}>*</span>
                </label>
                <textarea
                  value={disputeNotes}
                  onChange={(e) => setDisputeNotes(e.target.value)}
                  placeholder="Detailed rationale for audit trail..."
                  rows={3}
                  required
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text-primary)',
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              {disputeMessage && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '0.85rem',
                    backgroundColor: disputeMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: disputeMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                >
                  {disputeMessage.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedDispute(null)}
                  disabled={submittingDispute}
                  className="btn btn-sm"
                  style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDispute}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: 'var(--primary-purple)',
                    color: '#ffffff',
                    fontWeight: 700,
                  }}
                >
                  {submittingDispute ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default ManagementPage;
