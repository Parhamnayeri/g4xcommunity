import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingState } from '../components/ui/LoadingState';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';
import {
  AdminOverviewResponse,
  AdminDepositItem,
  AdminTradeItem,
  AdminOfferItem,
  AdminAuditLogItem,
  RolesMatrixResponse,
} from '../types/adminPortal';
import {
  fetchAdminOverview,
  fetchAdminDeposits,
  reviewAdminDeposit,
  fetchAdminTrades,
  fetchAdminOffers,
  fetchAdminAuditLogs,
  fetchRolesMatrix,
  fetchAdminUsers,
  updateAdminUserStatus,
  updateAdminUserRole,
  fetchAdminWithdrawals,
  reviewAdminWithdrawal,
} from '../services/adminPortal';

export const AdminPage: React.FC = () => {
  const { user, hasRole } = useAuth();
  const isAdminOrOwner = hasRole('owner', 'manager', 'admin');

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'users' | 'deposits' | 'withdrawals' | 'exchange' | 'audit' | 'roles'>('overview');

  // Overview state
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Users state
  const [users, setUsers] = useState<any[]>([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('all');

  // User moderation modal
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [modModalType, setModModalType] = useState<'status' | 'role' | null>(null);
  const [modReason, setModReason] = useState('');
  const [roleToModify, setRoleToModify] = useState('booster');
  const [roleAction, setRoleAction] = useState<'grant' | 'revoke'>('grant');
  const [submittingUserMod, setSubmittingUserMod] = useState(false);
  const [userModMsg, setUserModMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Deposits state
  const [deposits, setDeposits] = useState<AdminDepositItem[]>([]);
  const [depositsPagination, setDepositsPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositStatusFilter, setDepositStatusFilter] = useState('PENDING_ADMIN_VERIFICATION');
  const [selectedDeposit, setSelectedDeposit] = useState<AdminDepositItem | null>(null);
  const [depositAction, setDepositAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [depositNotes, setDepositNotes] = useState('');
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [depositReviewMsg, setDepositReviewMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Withdrawals state
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any | null>(null);
  const [withdrawalDecision, setWithdrawalDecision] = useState<'approve_paid' | 'reject'>('approve_paid');
  const [withdrawalTxHash, setWithdrawalTxHash] = useState('');
  const [withdrawalNotes, setWithdrawalNotes] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalReviewMsg, setWithdrawalReviewMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Exchange state
  const [trades, setTrades] = useState<AdminTradeItem[]>([]);
  const [tradesPagination, setTradesPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });
  const [offers, setOffers] = useState<AdminOfferItem[]>([]);
  const [exchangeLoading, setExchangeLoading] = useState(false);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState('');

  // Roles Matrix state
  const [rolesMatrix, setRolesMatrix] = useState<RolesMatrixResponse | null>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);

  // Load Overview Data
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchAdminOverview();
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load admin overview metrics.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Load Users Data
  const loadUsers = useCallback(async (page = 1) => {
    setUsersLoading(true);
    try {
      const data = await fetchAdminUsers({
        page,
        limit: usersPagination.limit,
        search: userSearch || undefined,
        role: userRoleFilter || undefined,
        accountStatus: userStatusFilter !== 'all' ? userStatusFilter : undefined,
      });
      setUsers(data?.users || []);
      setUsersPagination(data?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setUsersLoading(false);
    }
  }, [usersPagination.limit, userSearch, userRoleFilter, userStatusFilter]);

  // Load Deposits
  const loadDeposits = useCallback(async (page = 1) => {
    setDepositsLoading(true);
    try {
      const data = await fetchAdminDeposits({
        page,
        limit: depositsPagination.limit,
        status: depositStatusFilter,
      });
      setDeposits(data?.deposits || []);
      setDepositsPagination(data?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load deposits:', err);
    } finally {
      setDepositsLoading(false);
    }
  }, [depositsPagination.limit, depositStatusFilter]);

  // Load Withdrawals
  const loadWithdrawals = useCallback(async () => {
    setWithdrawalsLoading(true);
    try {
      const data = await fetchAdminWithdrawals();
      setWithdrawals(data?.withdrawals || []);
    } catch (err) {
      console.error('Failed to load withdrawals:', err);
    } finally {
      setWithdrawalsLoading(false);
    }
  }, []);

  // Load Exchange Oversight
  const loadExchange = useCallback(async (page = 1) => {
    setExchangeLoading(true);
    try {
      const [tradesData, offersData] = await Promise.all([
        fetchAdminTrades({ page, limit: tradesPagination.limit }),
        fetchAdminOffers(),
      ]);
      setTrades(tradesData?.trades || []);
      setTradesPagination(tradesData?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
      setOffers(offersData?.offers || []);
    } catch (err) {
      console.error('Failed to load exchange oversight:', err);
    } finally {
      setExchangeLoading(false);
    }
  }, [tradesPagination.limit]);

  // Load Audit Logs
  const loadAuditLogs = useCallback(async (page = 1) => {
    setAuditLoading(true);
    try {
      const data = await fetchAdminAuditLogs({
        page,
        limit: auditPagination.limit,
        action: auditActionFilter || undefined,
      });
      setAuditLogs(data?.logs || []);
      setAuditPagination(data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [auditPagination.limit, auditActionFilter]);

  // Load Roles Matrix
  const loadMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    try {
      const data = await fetchRolesMatrix();
      setRolesMatrix(data);
    } catch (err) {
      console.error('Failed to load roles matrix:', err);
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  useEffect(() => {
    if (isAdminOrOwner) {
      loadOverview();
    }
  }, [isAdminOrOwner, loadOverview]);

  useEffect(() => {
    if (!isAdminOrOwner) return;
    if (activeTab === 'users') loadUsers(1);
    if (activeTab === 'deposits') loadDeposits(1);
    if (activeTab === 'withdrawals') loadWithdrawals();
    if (activeTab === 'exchange') loadExchange(1);
    if (activeTab === 'audit') loadAuditLogs(1);
    if (activeTab === 'roles') loadMatrix();
  }, [activeTab, isAdminOrOwner, loadUsers, loadDeposits, loadWithdrawals, loadExchange, loadAuditLogs, loadMatrix]);

  if (!isAdminOrOwner) {
    return (
      <div className="card-surface" style={{ padding: '3rem', textAlign: 'center', maxWidth: '650px', margin: '3rem auto' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛡️</div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--status-danger)', marginBottom: '0.75rem' }}>
          Access Denied: Administrative Privilege Required
        </h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '2rem' }}>
          The G4X Admin Operations Portal is strictly reserved for authorized Admin, Manager, and Owner accounts.
          Privileges are verified live server-side on every request.
        </p>
        <a href="/dashboard" className="btn btn-secondary">
          Return to Member Dashboard
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Portal Header */}
      <div
        className="card-surface"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.25rem',
          borderLeft: '4px solid var(--accent-lime)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.2rem' }}>⚙️</span>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>G4X Admin Operations Portal</h1>
            <span className="badge badge-purple" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
              Level: Operations
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Operational oversight, user account moderation, manual financial queues, and system audit history.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (activeTab === 'overview') loadOverview();
              if (activeTab === 'users') loadUsers(usersPagination.page);
              if (activeTab === 'deposits') loadDeposits(depositsPagination.page);
              if (activeTab === 'withdrawals') loadWithdrawals();
              if (activeTab === 'exchange') loadExchange(tradesPagination.page);
              if (activeTab === 'audit') loadAuditLogs(auditPagination.page);
              if (activeTab === 'roles') loadMatrix();
            }}
          >
            ↻ Refresh View
          </button>
          {hasRole('owner') && (
            <a href="/owner" className="btn btn-cta btn-sm" style={{ backgroundColor: 'var(--primary-purple)', color: '#fff' }}>
              👑 Open Owner Portal &rarr;
            </a>
          )}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
        }}
      >
        {[
          { key: 'overview', label: 'Overview & KPIs', icon: '📊' },
          { key: 'orders', label: 'Order Workspace', icon: '📦' },
          { key: 'users', label: 'User Management', icon: '👥' },
          { key: 'deposits', label: 'Manual IRT Deposits', icon: '💳' },
          { key: 'withdrawals', label: 'Withdrawal Queue', icon: '💸' },
          { key: 'exchange', label: 'Marketplace Oversight', icon: '🪙' },
          { key: 'audit', label: 'Audit Trail', icon: '📜' },
          { key: 'roles', label: 'Role & Permissions', icon: '🛡️' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key as any)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: activeTab === t.key ? 'var(--bg-surface-hover)' : 'transparent',
              color: activeTab === t.key ? 'var(--accent-lime)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: OVERVIEW & REAL KPIS                                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {loadingOverview ? (
            <LoadingState message="Fetching live platform metrics..." />
          ) : overviewError ? (
            <div className="card-surface" style={{ padding: '2rem', color: 'var(--status-danger)' }}>
              Error: {overviewError}
            </div>
          ) : overview ? (
            <>
              {/* Feature Gate Safeguard Notice */}
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>🔒</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fca5a5' }}>
                      Financial Security Enforcement Active
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      All live payout and live wallet crediting switches remain strictly disabled in this phase.
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: '0.7rem' }}>
                    ESCROW_RELEASE: OFF
                  </span>
                  <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: '0.7rem' }}>
                    LIVE_CREDITS: OFF
                  </span>
                  <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: '0.7rem' }}>
                    LIVE_PAYOUTS: OFF
                  </span>
                </div>
              </div>

              {/* Real KPI Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                }}
              >
                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Total Community Members
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: '#fff' }}>
                    {overview.kpis.totalUsers.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--status-success)', marginTop: '0.25rem' }}>
                    ● {overview.kpis.activeUsers} active ({overview.kpis.deactivatedUsers} suspended)
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Pending Applications
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: 'var(--status-warning)' }}>
                    {overview.kpis.pendingApplications}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Awaiting staff &amp; identity review
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Pending Manual Deposits
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: 'var(--accent-lime)' }}>
                    {overview.kpis.pendingDeposits.count}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Value: ${(overview.kpis.pendingDeposits.sumUsdCents / 100).toFixed(2)} USD
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Pending Withdrawals
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: '#38bdf8' }}>
                    {overview.kpis.pendingWithdrawals.count}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Value: ${(overview.kpis.pendingWithdrawals.sumUsdCents / 100).toFixed(2)} USD
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Disputes &amp; Proofs
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: overview.kpis.openDisputes > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                    {overview.kpis.openDisputes} / {overview.kpis.pendingProofs}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Active disputes / Pending proofs
                  </div>
                </div>
              </div>

              {/* Roles Breakdown & Quick Audits */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div className="card-surface" style={{ padding: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>Role Distribution</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {Object.entries(overview.kpis.roleCounts).map(([role, count]) => (
                      <div key={role} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(45, 38, 69, 0.4)', paddingBottom: '0.4rem' }}>
                        <span style={{ textTransform: 'capitalize', fontSize: '0.88rem' }}>{role}</span>
                        <span className="badge badge-purple" style={{ fontSize: '0.8rem' }}>
                          {count} users
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>Recent Administrative Audits</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {overview.recentAudits.slice(0, 6).map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', borderBottom: '1px solid rgba(45, 38, 69, 0.4)', paddingBottom: '0.4rem' }}>
                        <span style={{ color: 'var(--accent-lime)', fontFamily: 'monospace' }}>{a.action}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(a.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1.5: UNIFIED ORDER MANAGEMENT WORKSPACE                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'orders' && (
        <OrderManagementWorkspace
          title="Admin Order Management Workspace"
          subtitle="Operational diagnostics, Discord board publishing, proof transitions, and multi-criteria order oversight."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: USER MANAGEMENT & ACCOUNT STATUS                                       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Community User Registry &amp; RBAC</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search username, ID..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Roles</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
                <option value="booster">Booster</option>
                <option value="pilot">Pilot</option>
                <option value="advertiser">Advertiser</option>
                <option value="exchanger">Exchanger</option>
              </select>
              <select
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="suspended">Suspended Only</option>
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadUsers(1)}
              >
                Filter
              </button>
            </div>
          </div>

          {usersLoading ? (
            <LoadingState message="Loading users..." />
          ) : users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No users matching search filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>User</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Discord Snowflake</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Roles</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Adv. Rank</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.discordId} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 600 }}>{u.displayName || u.username}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{u.username}</div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {u.discordId}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span className={`badge ${u.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.75rem' }}>
                          {u.isActive ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {u.roles && u.roles.length > 0 ? (
                            u.roles.map((r: any) => (
                              <span key={r.roleKey} className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                                {r.roleKey}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--accent-lime)' }}>
                        {u.advertiserRank || '—'}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                            onClick={() => {
                              setSelectedUser(u);
                              setModModalType('role');
                              setUserModMsg(null);
                            }}
                          >
                            Roles
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.25rem 0.6rem',
                              backgroundColor: u.isActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                              color: u.isActive ? 'var(--status-danger)' : 'var(--status-success)',
                            }}
                            onClick={() => {
                              setSelectedUser(u);
                              setModModalType('status');
                              setUserModMsg(null);
                            }}
                          >
                            {u.isActive ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Page {usersPagination.page} of {usersPagination.totalPages || 1} ({usersPagination.total} total)
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={usersPagination.page <= 1}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadUsers(usersPagination.page - 1)}
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={usersPagination.page >= usersPagination.totalPages}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadUsers(usersPagination.page + 1)}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* User Moderation Modal */}
          {selectedUser && modModalType && (
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
                zIndex: 1000,
                padding: '1rem',
              }}
            >
              <div className="card-surface" style={{ maxWidth: '480px', width: '100%', padding: '1.75rem' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {modModalType === 'status'
                    ? `${selectedUser.isActive ? 'Suspend' : 'Activate'} Account`
                    : `Manage Roles: ${selectedUser.username}`}
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                  Target: {selectedUser.displayName || selectedUser.username} ({selectedUser.discordId})
                </p>

                {modModalType === 'role' && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Action
                      </label>
                      <select
                        value={roleAction}
                        onChange={(e) => setRoleAction(e.target.value as any)}
                        style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      >
                        <option value="grant">Grant Role</option>
                        <option value="revoke">Revoke Role</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Role Key
                      </label>
                      <select
                        value={roleToModify}
                        onChange={(e) => setRoleToModify(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      >
                        <option value="booster">booster</option>
                        <option value="pilot">pilot</option>
                        <option value="advertiser">advertiser</option>
                        <option value="exchanger">exchanger</option>
                        <option value="staff">staff</option>
                        <option value="admin">admin</option>
                        <option value="manager">manager</option>
                      </select>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Mandatory Audit Reason (min 5 characters)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Explain the administrative justification for this change..."
                    value={modReason}
                    onChange={(e) => setModReason(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-main)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      resize: 'vertical',
                    }}
                  />
                </div>

                {userModMsg && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      marginBottom: '1rem',
                      backgroundColor: userModMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: userModMsg.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                    }}
                  >
                    {userModMsg.text}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSelectedUser(null);
                      setModModalType(null);
                      setModReason('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingUserMod || modReason.trim().length < 5}
                    className="btn btn-cta btn-sm"
                    onClick={async () => {
                      setSubmittingUserMod(true);
                      setUserModMsg(null);
                      try {
                        if (modModalType === 'status') {
                          await updateAdminUserStatus(selectedUser.discordId, !selectedUser.isActive, modReason);
                          setUserModMsg({ text: 'Account status successfully updated.', type: 'success' });
                        } else {
                          await updateAdminUserRole(selectedUser.discordId, roleToModify, roleAction, modReason);
                          setUserModMsg({ text: `Role ${roleAction}ed successfully.`, type: 'success' });
                        }
                        setTimeout(() => {
                          setSelectedUser(null);
                          setModModalType(null);
                          setModReason('');
                          loadUsers(usersPagination.page);
                        }, 800);
                      } catch (err: any) {
                        setUserModMsg({ text: err.message || 'Operation failed', type: 'error' });
                      } finally {
                        setSubmittingUserMod(false);
                      }
                    }}
                  >
                    {submittingUserMod ? 'Saving...' : 'Confirm Mutation'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: MANUAL DEPOSITS REVIEW QUEUE                                           */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'deposits' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Manual IRT Deposit Administration</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Review incoming card-to-card IRT payment slips and confirm authoritative receipt.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <select
                value={depositStatusFilter}
                onChange={(e) => setDepositStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="PENDING_ADMIN_VERIFICATION">Pending Verification</option>
                <option value="CONFIRMED_CREDITED">Confirmed &amp; Credited</option>
                <option value="REJECTED">Rejected</option>
                <option value="all">All Statuses</option>
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadDeposits(1)}
              >
                Refresh
              </button>
            </div>
          </div>

          {depositsLoading ? (
            <LoadingState message="Loading deposit requests..." />
          ) : deposits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No deposit requests currently pending verification.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Ref / Date</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Advertiser</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Method / Currency</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Target USD</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Payer Evidence</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{d.fundingRef}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(d.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div>{d.advertiserName}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.advertiserId}</div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                          {d.fundingMethod} ({d.externalAmountUnits} {d.externalCurrency})
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                        {d.targetUsdFormatted}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontSize: '0.8rem' }}>Card: {d.payerIdentifier || '—'}</div>
                        {d.evidenceRef && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Doc: {d.evidenceRef}</div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span
                          className={`badge ${
                            d.status === 'CONFIRMED_CREDITED'
                              ? 'badge-success'
                              : d.status === 'REJECTED'
                              ? 'badge-danger'
                              : 'badge-warning'
                          }`}
                          style={{ fontSize: '0.75rem' }}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        {d.status === 'PENDING_ADMIN_VERIFICATION' && (
                          <button
                            type="button"
                            className="btn btn-cta btn-sm"
                            style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                            onClick={() => {
                              setSelectedDeposit(d);
                              setDepositAction('APPROVE');
                              setDepositNotes('');
                              setDepositReviewMsg(null);
                            }}
                          >
                            Review Slip
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Enhanced Deposit Review Modal */}
          {selectedDeposit && (() => {
            const isSelfReview = Boolean(user && user.discordId === selectedDeposit.advertiserId);
            const isRejectionInvalid = depositAction === 'REJECT' && (!depositNotes || depositNotes.trim().length < 5);

            return (
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
                  zIndex: 1000,
                  padding: '1rem',
                }}
              >
                <div className="card-surface" style={{ maxWidth: '580px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                      Review Manual Deposit #{selectedDeposit.id}
                    </h3>
                    <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {selectedDeposit.fundingRef}
                    </span>
                  </div>

                  {/* Anti-Self-Approval Guard Alert */}
                  {isSelfReview && (
                    <div
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid var(--status-danger)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.75rem 1rem',
                        fontSize: '0.82rem',
                        color: 'var(--status-danger)',
                        marginBottom: '1rem',
                        fontWeight: 600,
                      }}
                    >
                      ⚠️ <strong>Anti-Self-Approval Guard:</strong> You are the depositor of this funding request. An independent administrator or owner must perform this review.
                    </div>
                  )}

                  {/* Deposit Information Box */}
                  <div
                    style={{
                      backgroundColor: 'var(--bg-main)',
                      padding: '1rem',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: '1rem',
                      fontSize: '0.84rem',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '0.6rem',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Advertiser: </span>
                      <strong>{selectedDeposit.advertiserName}</strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>{selectedDeposit.advertiserId}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Requested IRT: </span>
                      <strong style={{ color: 'var(--accent-lime)' }}>
                        {Number(selectedDeposit.externalAmountUnits).toLocaleString()} {selectedDeposit.externalCurrency}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Quoted USD Credit: </span>
                      <strong>{selectedDeposit.targetUsdFormatted}</strong>
                      {selectedDeposit.exchangeRate && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                          Rate: {selectedDeposit.exchangeRate.toLocaleString()} IRT/USD
                        </span>
                      )}
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Depositor Name / Card: </span>
                      <strong>{selectedDeposit.rawPayerIdentifier || selectedDeposit.payerIdentifier}</strong>
                      {selectedDeposit.senderCardLast4 && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                          Card Last 4: {selectedDeposit.senderCardLast4}
                        </span>
                      )}
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Bank Tracking Reference: </span>
                      <strong style={{ fontFamily: 'monospace' }}>{selectedDeposit.evidenceRef || 'None'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Payment Date: </span>
                      <strong>{selectedDeposit.paymentDate || new Date(selectedDeposit.createdAt).toLocaleDateString()}</strong>
                    </div>
                    {selectedDeposit.payerDescription && (
                      <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(45, 38, 69, 0.4)', paddingTop: '0.4rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Payer Description / Remarks: </span>
                        <span>{selectedDeposit.payerDescription}</span>
                      </div>
                    )}
                  </div>

                  {/* Secure Receipt Screenshot Preview */}
                  {selectedDeposit.receiptUrl ? (
                    <div
                      style={{
                        backgroundColor: 'var(--bg-main)',
                        padding: '0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        marginBottom: '1rem',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                        Payment Receipt Screenshot Evidence
                      </div>
                      <a href={selectedDeposit.receiptUrl} target="_blank" rel="noopener noreferrer" title="Click to view full image in a new tab">
                        <img
                          src={selectedDeposit.receiptUrl}
                          alt="Payment Receipt Slip"
                          style={{
                            maxHeight: '180px',
                            maxWidth: '100%',
                            borderRadius: '6px',
                            border: '1px solid var(--border-subtle)',
                            objectFit: 'contain',
                            cursor: 'pointer',
                          }}
                        />
                      </a>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        Click screenshot to inspect original in new browser tab
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--bg-main)',
                        padding: '0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        marginBottom: '1rem',
                        textAlign: 'center',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      📎 No receipt screenshot attached (Historical deposit submission)
                    </div>
                  )}

                  {/* Gate Notice Warning */}
                  <div
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem',
                      color: '#fca5a5',
                      marginBottom: '1rem',
                    }}
                  >
                    ⚠️ <strong>Live Credits Feature Gate Notice:</strong> Live balance crediting is currently disabled by system policy (FINANCE_V2_LIVE_CREDITS_ENABLED=false). Approving will record verified status without injecting live balances.
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input
                        type="radio"
                        name="depAction"
                        checked={depositAction === 'APPROVE'}
                        onChange={() => setDepositAction('APPROVE')}
                      />
                      Approve &amp; Record Verification
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input
                        type="radio"
                        name="depAction"
                        checked={depositAction === 'REJECT'}
                        onChange={() => setDepositAction('REJECT')}
                      />
                      Reject Deposit
                    </label>
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Reviewer Notes / Verification Reference {depositAction === 'REJECT' && <span style={{ color: 'var(--status-danger)' }}>* (Min 5 chars required)</span>}
                    </label>
                    <textarea
                      rows={2}
                      placeholder={
                        depositAction === 'REJECT'
                          ? 'Please provide a clear reason for rejecting this deposit (min 5 chars)...'
                          : 'E.g. Bank tracking number verified via online banking statement'
                      }
                      value={depositNotes}
                      onChange={(e) => setDepositNotes(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>

                  {depositReviewMsg && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.82rem',
                        marginBottom: '1rem',
                        backgroundColor: depositReviewMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: depositReviewMsg.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      }}
                    >
                      {depositReviewMsg.text}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSelectedDeposit(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={submittingDeposit || isSelfReview || isRejectionInvalid}
                      className="btn btn-cta btn-sm"
                      onClick={async () => {
                        setSubmittingDeposit(true);
                        setDepositReviewMsg(null);
                        try {
                          await reviewAdminDeposit(selectedDeposit.id, depositAction, depositNotes);
                          setDepositReviewMsg({ text: 'Decision successfully processed.', type: 'success' });
                          setTimeout(() => {
                            setSelectedDeposit(null);
                            loadDeposits(depositsPagination.page);
                          }, 800);
                        } catch (err: any) {
                          setDepositReviewMsg({ text: err.message || 'Review submission failed', type: 'error' });
                        } finally {
                          setSubmittingDeposit(false);
                        }
                      }}
                    >
                      {submittingDeposit ? 'Submitting...' : 'Submit Decision'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: WITHDRAWAL QUEUE                                                       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'withdrawals' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Booster Withdrawal Queue</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Review reserved booster payout requests and verify external disbursement proofs.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadWithdrawals}
            >
              Refresh Queue
            </button>
          </div>

          {withdrawalsLoading ? (
            <LoadingState message="Loading withdrawal requests..." />
          ) : withdrawals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No booster withdrawal requests currently in queue.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Ref / Date</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Booster</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Method</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Requested / Net</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Destination</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr key={w.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{w.withdrawalRef}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(w.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div>{w.boosterName}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.boosterId}</div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                          {w.payoutMethod}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent-lime)' }}>
                          ${(w.requestedUsdCents ? w.requestedUsdCents / 100 : w.requestedUsd || 0).toFixed(2)}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {w.destinationAddress ? `${w.destinationAddress.slice(0, 10)}...${w.destinationAddress.slice(-6)}` : '—'}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                          {w.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                          onClick={() => {
                            setSelectedWithdrawal(w);
                            setWithdrawalDecision('approve_paid');
                            setWithdrawalTxHash('');
                            setWithdrawalNotes('');
                            setWithdrawalReviewMsg(null);
                          }}
                        >
                          Review &amp; Payout
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Withdrawal Review Modal */}
          {selectedWithdrawal && (
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
                zIndex: 1000,
                padding: '1rem',
              }}
            >
              <div className="card-surface" style={{ maxWidth: '520px', width: '100%', padding: '2rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Execute Payout Decision #{selectedWithdrawal.id}
                </h3>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                  <div>Booster: <strong>{selectedWithdrawal.boosterName}</strong></div>
                  <div>Method: <strong>{selectedWithdrawal.payoutMethod}</strong></div>
                  <div>Destination: <strong style={{ wordBreak: 'break-all' }}>{selectedWithdrawal.destinationAddress}</strong></div>
                </div>

                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    color: '#fca5a5',
                    marginBottom: '1rem',
                  }}
                >
                  ⚠️ <strong>Live Payouts Feature Gate Notice:</strong> Live disbursements are disabled (FINANCE_V2_LIVE_PAYOUTS_ENABLED=false). Review mutations are recorded safely without executing automated blockchain or Iranian bank transfers.
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Blockchain TxHash or Bank Receipt Reference
                  </label>
                  <input
                    type="text"
                    placeholder="Enter external settlement reference or hash..."
                    value={withdrawalTxHash}
                    onChange={(e) => setWithdrawalTxHash(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-main)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>

                {withdrawalReviewMsg && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      marginBottom: '1rem',
                      backgroundColor: withdrawalReviewMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: withdrawalReviewMsg.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                    }}
                  >
                    {withdrawalReviewMsg.text}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedWithdrawal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingWithdrawal}
                    className="btn btn-cta btn-sm"
                    onClick={async () => {
                      setSubmittingWithdrawal(true);
                      setWithdrawalReviewMsg(null);
                      try {
                        await reviewAdminWithdrawal(selectedWithdrawal.id, withdrawalDecision, {
                          txHash: withdrawalTxHash.trim() || undefined,
                          notes: withdrawalNotes.trim() || undefined,
                        });
                        setWithdrawalReviewMsg({ text: 'Withdrawal review recorded.', type: 'success' });
                        setTimeout(() => {
                          setSelectedWithdrawal(null);
                          loadWithdrawals();
                        }, 800);
                      } catch (err: any) {
                        setWithdrawalReviewMsg({ text: err.message || 'Review failed', type: 'error' });
                      } finally {
                        setSubmittingWithdrawal(false);
                      }
                    }}
                  >
                    {submittingWithdrawal ? 'Saving...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: MARKETPLACE & EXCHANGE OVERSIGHT                                       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'exchange' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Exchanger Active Offers */}
          <div className="card-surface" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Exchanger Active Fee Offers</h2>
            {exchangeLoading ? (
              <LoadingState message="Loading exchange offers..." />
            ) : offers.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No fee offers registered.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Offer Ref</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Exchanger</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Service Type</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Commission</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                        <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>{o.offerRef}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{o.exchanger}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{o.serviceType}</td>
                        <td style={{ padding: '0.65rem 0.5rem', color: 'var(--accent-lime)' }}>{o.commissionFormatted}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{o.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Gold Trades Oversight */}
          <div className="card-surface" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Gold Trades Activity</h2>
            {exchangeLoading ? (
              <LoadingState message="Loading gold trades..." />
            ) : trades.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No gold trades executed yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Trade Ref</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Seller (Adv)</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Buyer (Exchanger)</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Gold Quantity</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Valuation</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Method</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                        <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>{t.tradeRef}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{t.seller}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{t.buyer}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{t.goldQuantity.toLocaleString()} Gold</td>
                        <td style={{ padding: '0.65rem 0.5rem', color: 'var(--accent-lime)' }}>{t.valuationFormatted}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{t.settlementMethod}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>{t.tradeStatus}</span>
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

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 6: AUDIT TRAIL EXPLORATION                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Administrative Audit Trail</h2>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                placeholder="Filter by action name..."
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadAuditLogs(1)}
              >
                Filter
              </button>
            </div>
          </div>

          {auditLoading ? (
            <LoadingState message="Loading audit history..." />
          ) : auditLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No audit records matching query.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Timestamp</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Actor</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Action</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Entity</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Reason / Notes</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div>{l.actor}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.actorId}</div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', color: 'var(--accent-lime)' }}>
                        {l.action}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        {l.entityType} #{l.entityId}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', maxWidth: '280px', color: 'var(--text-muted)' }}>
                        {l.reason || '—'}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span className={`badge ${l.isSuccess ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.72rem' }}>
                          {l.isSuccess ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Page {auditPagination.page} of {auditPagination.totalPages || 1} ({auditPagination.total} total)
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={auditPagination.page <= 1}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadAuditLogs(auditPagination.page - 1)}
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={auditPagination.page >= auditPagination.totalPages}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadAuditLogs(auditPagination.page + 1)}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 7: ROLE & PERMISSION MATRIX                                               */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>System RBAC Permission Matrix</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Authoritative static role-permission assignments evaluated live server-side.
          </p>

          {loadingMatrix ? (
            <LoadingState message="Loading permissions matrix..." />
          ) : rolesMatrix ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {rolesMatrix.roles.map((role) => (
                <div key={role} style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-lime)', fontSize: '0.95rem' }}>
                      {role}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {(rolesMatrix.permissionsMatrix[role] || []).length} assigned permissions
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                    {(rolesMatrix.permissionsMatrix[role] || []).map((perm) => (
                      <span key={perm} className="badge badge-purple" style={{ fontSize: '0.72rem', fontFamily: 'monospace' }}>
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default AdminPage;
