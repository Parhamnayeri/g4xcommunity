import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Tabs,
  TabItem,
  KpiCard,
  Input,
  LoadingState,
} from '../components/ui';
import { normalizePagination } from '../utils/pagination';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';
import { UserManagementWorkspace } from '../components/admin/UserManagementWorkspace';
import { WithdrawalQueueWorkspace } from '../components/admin/WithdrawalQueueWorkspace';
import { DepositQueueWorkspace } from '../components/admin/DepositQueueWorkspace';
import {
  ApplicationsWorkspace,
  GamesWorkspace,
  ChannelsWorkspace,
} from '../components/admin/NativeAdminModules';
import { KycManagementPage } from './KycManagementPage';
import { RulesManagementWorkspace } from '../components/admin/RulesManagementWorkspace';
import {
  AdminOverviewResponse,
  AdminTradeItem,
  AdminOfferItem,
  AdminAuditLogItem,
  RolesMatrixResponse,
} from '../types/adminPortal';
import {
  fetchAdminOverview,
  fetchAdminTrades,
  fetchAdminOffers,
  fetchAdminAuditLogs,
  fetchRolesMatrix,
} from '../services/adminPortal';

export type AdminTab =
  | 'overview'
  | 'orders'
  | 'users'
  | 'deposits'
  | 'withdrawals'
  | 'applications'
  | 'kyc'
  | 'exchange'
  | 'games'
  | 'discord'
  | 'rules'
  | 'audit'
  | 'roles';

const VALID_ADMIN_TABS: AdminTab[] = [
  'overview',
  'orders',
  'users',
  'deposits',
  'withdrawals',
  'applications',
  'kyc',
  'exchange',
  'games',
  'discord',
  'rules',
  'audit',
  'roles',
];

const ADMIN_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview & KPIs', icon: <span>📊</span> },
  { id: 'orders', label: 'Order Workspace', icon: <span>📦</span> },
  { id: 'users', label: 'User Management', icon: <span>👥</span> },
  { id: 'deposits', label: 'Manual IRT Deposits', icon: <span>💳</span> },
  { id: 'withdrawals', label: 'Withdrawal Queue', icon: <span>💸</span> },
  { id: 'applications', label: 'Member Applications', icon: <span>📋</span> },
  { id: 'kyc', label: 'KYC Management', icon: <span>🪪</span> },
  { id: 'exchange', label: 'Marketplace Oversight', icon: <span>🪙</span> },
  { id: 'games', label: 'Games & Services', icon: <span>🎮</span> },
  { id: 'discord', label: 'Discord Channels', icon: <span>💬</span> },
  { id: 'rules', label: 'Rules & Policies', icon: <span>⚖️</span> },
  { id: 'audit', label: 'Audit Trail', icon: <span>📜</span> },
  { id: 'roles', label: 'Role & Permissions', icon: <span>🛡️</span> },
];

export const AdminPage: React.FC<{ defaultTab?: AdminTab }> = ({ defaultTab = 'overview' }) => {
  const { hasRole } = useAuth();
  const isAdminOrOwner = hasRole('owner', 'manager', 'admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;

  // Navigation tab
  const [activeTab, setActiveTab] = useState<AdminTab>(
    tabParam && VALID_ADMIN_TABS.includes(tabParam) ? tabParam : defaultTab
  );

  useEffect(() => {
    if (tabParam && VALID_ADMIN_TABS.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab as AdminTab);
    setSearchParams({ tab: newTab });
  };

  // Overview state
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

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

  // Load Exchange Oversight
  const loadExchange = useCallback(async (page = 1) => {
    setExchangeLoading(true);
    try {
      const [tradesData, offersData] = await Promise.all([
        fetchAdminTrades({ page, limit: tradesPagination.limit }),
        fetchAdminOffers(),
      ]);
      setTrades(tradesData?.trades || []);
      setTradesPagination(normalizePagination(tradesData?.pagination || tradesData, page, tradesPagination.limit));
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
      setAuditPagination(normalizePagination(data?.pagination || data, page, auditPagination.limit));
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
    if (activeTab === 'exchange') loadExchange(1);
    if (activeTab === 'audit') loadAuditLogs(1);
    if (activeTab === 'roles') loadMatrix();
  }, [activeTab, isAdminOrOwner, loadExchange, loadAuditLogs, loadMatrix]);

  const offerColumns: Column<AdminOfferItem>[] = useMemo(
    () => [
      {
        key: 'offerRef',
        header: 'Offer Ref',
        render: (o) => <code style={{ fontFamily: 'monospace' }}>{o.offerRef}</code>,
      },
      {
        key: 'exchanger',
        header: 'Exchanger',
        render: (o) => o.exchanger,
      },
      {
        key: 'serviceType',
        header: 'Service Type',
        render: (o) => o.serviceType,
      },
      {
        key: 'commission',
        header: 'Commission',
        render: (o) => <span style={{ color: 'var(--accent-lime)' }}>{o.commissionFormatted}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (o) => <StatusBadge status={o.status} />,
      },
    ],
    []
  );

  const tradeColumns: Column<AdminTradeItem>[] = useMemo(
    () => [
      {
        key: 'tradeRef',
        header: 'Trade Ref',
        render: (t) => <code style={{ fontFamily: 'monospace' }}>{t.tradeRef}</code>,
      },
      {
        key: 'seller',
        header: 'Seller (Adv)',
        render: (t) => t.seller,
      },
      {
        key: 'buyer',
        header: 'Buyer (Exchanger)',
        render: (t) => t.buyer,
      },
      {
        key: 'goldQuantity',
        header: 'Gold Quantity',
        render: (t) => `${t.goldQuantity.toLocaleString()} Gold`,
      },
      {
        key: 'valuation',
        header: 'Valuation',
        render: (t) => <span style={{ color: 'var(--accent-lime)' }}>{t.valuationFormatted}</span>,
      },
      {
        key: 'method',
        header: 'Method',
        render: (t) => t.settlementMethod,
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => <StatusBadge status={t.tradeStatus} />,
      },
    ],
    []
  );

  const auditColumns: Column<AdminAuditLogItem>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'Timestamp',
        render: (l) => (
          <span style={{ color: 'var(--text-muted)' }}>
            {new Date(l.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'actor',
        header: 'Actor',
        render: (l) => (
          <div>
            <div>{l.actor}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.actorId}</div>
          </div>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        render: (l) => (
          <span style={{ fontFamily: 'monospace', color: 'var(--accent-lime)' }}>{l.action}</span>
        ),
      },
      {
        key: 'entity',
        header: 'Entity',
        render: (l) => `${l.entityType} #${l.entityId}`,
      },
      {
        key: 'reason',
        header: 'Reason / Notes',
        render: (l) => (
          <span style={{ maxWidth: '280px', color: 'var(--text-muted)', display: 'inline-block' }}>
            {l.reason || '—'}
          </span>
        ),
      },
      {
        key: 'outcome',
        header: 'Outcome',
        render: (l) => (
          <StatusBadge status={l.isSuccess ? 'completed' : 'rejected'} />
        ),
      },
    ],
    []
  );

  if (!isAdminOrOwner) {
    return (
      <Card style={{ padding: '3rem', textAlign: 'center', maxWidth: '650px', margin: '3rem auto' }}>
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
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Portal Header */}
      <Card
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (activeTab === 'overview') loadOverview();
              if (activeTab === 'exchange') loadExchange(tradesPagination.page);
              if (activeTab === 'audit') loadAuditLogs(auditPagination.page);
              if (activeTab === 'roles') loadMatrix();
            }}
          >
            ↻ Refresh View
          </Button>
          {hasRole('owner') && (
            <a href="/owner" className="btn btn-cta btn-sm" style={{ backgroundColor: 'var(--primary-purple)', color: '#fff' }}>
              👑 Open Owner Portal &rarr;
            </a>
          )}
        </div>
      </Card>

      {/* Navigation Sub-Tabs */}
      <Tabs
        tabs={ADMIN_TABS}
        activeTab={activeTab}
        onChange={handleTabChange}
        accent="lime"
      />

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: OVERVIEW & REAL KPIS                                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {loadingOverview ? (
            <LoadingState message="Fetching live platform metrics..." />
          ) : overviewError ? (
            <Card style={{ padding: '2rem', color: 'var(--status-danger)' }}>
              Error: {overviewError}
            </Card>
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
                <KpiCard
                  label="Total Community Members"
                  value={overview.kpis.totalUsers.toLocaleString()}
                  subtext={`● ${overview.kpis.activeUsers} active (${overview.kpis.deactivatedUsers} suspended)`}
                />

                <KpiCard
                  label="Pending Applications"
                  value={overview.kpis.pendingApplications}
                  subtext="Awaiting staff & identity review"
                />

                <KpiCard
                  label="Pending Manual Deposits"
                  value={overview.kpis.pendingDeposits.count}
                  subtext={`Value: $${(overview.kpis.pendingDeposits.sumUsdCents / 100).toFixed(2)} USD`}
                  highlight="lime"
                />

                <KpiCard
                  label="Pending Withdrawals"
                  value={overview.kpis.pendingWithdrawals.count}
                  subtext={`Value: $${(overview.kpis.pendingWithdrawals.sumUsdCents / 100).toFixed(2)} USD`}
                />

                <KpiCard
                  label="Disputes & Proofs"
                  value={`${overview.kpis.openDisputes} / ${overview.kpis.pendingProofs}`}
                  subtext="Active disputes / Pending proofs"
                />
              </div>

              {/* Roles Breakdown & Quick Audits */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                <Card style={{ padding: '1.5rem' }}>
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
                </Card>

                <Card style={{ padding: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}>Recent Administrative Audits</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {overview.recentAudits.slice(0, 6).map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', borderBottom: '1px solid rgba(45, 38, 69, 0.4)', paddingBottom: '0.4rem' }}>
                        <span style={{ color: 'var(--accent-lime)', fontFamily: 'monospace' }}>{a.action}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(a.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </Card>
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
        <UserManagementWorkspace
          canBan={true}
          canManageRoles={true}
          allowPrivilegedRoles={false}
          title="Community User Registry & RBAC"
          subtitle="Search users, review verification status, apply ban/unban moderation with mandatory reasons, and assign non-privileged operational roles."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: MANUAL DEPOSITS REVIEW QUEUE                                           */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'deposits' && (
        <DepositQueueWorkspace
          title="Manual IRT Deposit Administration"
          subtitle="Review incoming card-to-card IRT payment slips and confirm authoritative receipt."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: WITHDRAWAL QUEUE                                                       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'withdrawals' && (
        <WithdrawalQueueWorkspace
          canReview={true}
          canEditMetadata={true}
          title="Booster Withdrawal Queue"
          subtitle="Review reserved booster payout requests, verify disbursements, and edit administrative review metadata with full audit history."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: MEMBER APPLICATIONS                                                      */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'applications' && (
        <ApplicationsWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: KYC MANAGEMENT                                                           */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'kyc' && (
        <KycManagementPage embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: GAMES & SERVICES                                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'games' && (
        <GamesWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: DISCORD CHANNELS                                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'discord' && (
        <ChannelsWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: MARKETPLACE & EXCHANGE OVERSIGHT                                       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'exchange' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Exchanger Active Offers */}
          <Card style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Exchanger Active Fee Offers</h2>
            <DataTable
              columns={offerColumns}
              data={offers}
              keyField="id"
              loading={exchangeLoading}
              emptyMessage="No fee offers registered."
            />
          </Card>

          {/* Gold Trades Oversight */}
          <Card style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Gold Trades Activity</h2>
            <DataTable
              columns={tradeColumns}
              data={trades}
              keyField="id"
              loading={exchangeLoading}
              emptyMessage="No gold trades executed yet."
            />
          </Card>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 6: AUDIT TRAIL EXPLORATION                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <Card style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Administrative Audit Trail</h2>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <Input
                placeholder="Filter by action name..."
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadAuditLogs(1)}
              >
                Filter
              </Button>
            </div>
          </div>

          <DataTable
            columns={auditColumns}
            data={auditLogs}
            keyField="id"
            loading={auditLoading}
            emptyMessage="No audit records matching query."
          />

          <Pagination
            pagination={auditPagination}
            onPageChange={(page) => loadAuditLogs(page)}
          />
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* RULES & POLICIES CMS WORKSPACE                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'rules' && <RulesManagementWorkspace />}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 7: ROLE & PERMISSION MATRIX                                               */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && (
        <Card style={{ padding: '1.75rem' }}>
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
        </Card>
      )}
    </div>
  );
};

export default AdminPage;
