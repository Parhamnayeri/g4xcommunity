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
  Modal,
  Input,
  Textarea,
  LoadingState,
} from '../components/ui';
import { normalizePagination } from '../utils/pagination';
import {
  OwnerOverviewResponse,
  FeatureGateItem,
  FinancialConfigResponse,
  WalletsLedgersResponse,
  OwnerAuditLogItem,
  SecurityHealthResponse,
  LedgerEntryItem,
} from '../types/ownerPortal';
import {
  fetchOwnerOverview,
  fetchOwnerFeatureGates,
  fetchOwnerFinancialConfig,
  updateOwnerFinancialConfig,
  fetchOwnerWalletsLedgers,
  fetchOwnerAuditLogs,
  fetchOwnerSecurityHealth,
} from '../services/ownerPortal';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';
import { UserManagementWorkspace } from '../components/admin/UserManagementWorkspace';
import { WithdrawalQueueWorkspace } from '../components/admin/WithdrawalQueueWorkspace';
import {
  ApplicationsWorkspace,
  GamesWorkspace,
  ChannelsWorkspace,
} from '../components/admin/NativeAdminModules';
import { KycManagementPage } from './KycManagementPage';
import { DepositQueueWorkspace } from '../components/admin/DepositQueueWorkspace';
import { RulesManagementWorkspace } from '../components/admin/RulesManagementWorkspace';

export type OwnerTab =
  | 'overview'
  | 'orders'
  | 'users'
  | 'deposits'
  | 'withdrawals'
  | 'applications'
  | 'kyc'
  | 'games'
  | 'discord'
  | 'rules'
  | 'config'
  | 'ledgers'
  | 'gates'
  | 'audit'
  | 'security';

const VALID_OWNER_TABS: OwnerTab[] = [
  'overview',
  'orders',
  'users',
  'deposits',
  'withdrawals',
  'applications',
  'kyc',
  'games',
  'discord',
  'rules',
  'config',
  'ledgers',
  'gates',
  'audit',
  'security',
];

const OWNER_TABS: TabItem[] = [
  { id: 'overview', label: 'Executive Overview', icon: <span>🏛️</span> },
  { id: 'orders', label: 'Order Workspace', icon: <span>📦</span> },
  { id: 'users', label: 'User Management', icon: <span>👥</span> },
  { id: 'deposits', label: 'Manual IRT Deposits', icon: <span>💳</span> },
  { id: 'withdrawals', label: 'Withdrawal Queue', icon: <span>💸</span> },
  { id: 'applications', label: 'Member Applications', icon: <span>📋</span> },
  { id: 'kyc', label: 'KYC Management', icon: <span>🪪</span> },
  { id: 'games', label: 'Games & Services', icon: <span>🎮</span> },
  { id: 'discord', label: 'Discord Channels', icon: <span>💬</span> },
  { id: 'rules', label: 'Rules & Policies', icon: <span>⚖️</span> },
  { id: 'config', label: 'Financial Configuration', icon: <span>⚙️</span> },
  { id: 'ledgers', label: 'Wallets & Ledgers', icon: <span>📈</span> },
  { id: 'gates', label: 'Feature Gates Status', icon: <span>🔒</span> },
  { id: 'audit', label: 'Executive Audit Logs', icon: <span>📜</span> },
  { id: 'security', label: 'Security & Health', icon: <span>🛡️</span> },
];

export const OwnerPage: React.FC<{ defaultTab?: OwnerTab }> = ({ defaultTab = 'overview' }) => {
  const { hasRole } = useAuth();
  const isOwner = hasRole('owner');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as OwnerTab | null;

  // Navigation tab
  const [activeTab, setActiveTab] = useState<OwnerTab>(
    tabParam && VALID_OWNER_TABS.includes(tabParam) ? tabParam : defaultTab
  );

  useEffect(() => {
    if (tabParam && VALID_OWNER_TABS.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab as OwnerTab);
    setSearchParams({ tab: newTab });
  };

  // Overview state
  const [overview, setOverview] = useState<OwnerOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Financial Config state
  const [configData, setConfigData] = useState<FinancialConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [formInputs, setFormInputs] = useState<Record<string, string>>({});
  const [showSensitiveCard, setShowSensitiveCard] = useState(false);
  const [showSensitiveIban, setShowSensitiveIban] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveReason, setSaveReason] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Wallets & Ledgers state
  const [ledgersData, setLedgersData] = useState<WalletsLedgersResponse | null>(null);
  const [ledgersLoading, setLedgersLoading] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);

  // Feature Gates state
  const [gatesList, setGatesList] = useState<FeatureGateItem[]>([]);
  const [gatesLoading, setGatesLoading] = useState(false);

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<OwnerAuditLogItem[]>([]);
  const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState('');

  // Security Health state
  const [securityHealth, setSecurityHealth] = useState<SecurityHealthResponse | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);

  // Load Overview
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await fetchOwnerOverview();
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load owner executive overview.');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // Load Financial Config
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await fetchOwnerFinancialConfig();
      setConfigData(data);
      setFormInputs({
        admin_usd_irt_rate: data.configs.admin_usd_irt_rate.value,
        incoming_irt_fee_rate: data.configs.incoming_irt_fee_rate.value,
        incoming_irt_quote_ttl_minutes: data.configs.incoming_irt_quote_ttl_minutes.value,
        irt_bank_name: data.configs.irt_bank_name.value,
        irt_bank_card_holder: data.configs.irt_bank_card_holder.value,
        irt_bank_card_number: data.configs.irt_bank_card_number.value,
        irt_bank_iban: data.configs.irt_bank_iban.value,
        irt_payout_tuesday_cutoff_hour: data.configs.irt_payout_tuesday_cutoff_hour.value,
      });
    } catch (err: any) {
      console.error('Failed to load financial config:', err);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // Load Ledgers
  const loadLedgers = useCallback(async (page = 1) => {
    setLedgersLoading(true);
    try {
      const data = await fetchOwnerWalletsLedgers({ page, limit: 20 });
      setLedgersData(data);
      setLedgerPage(page);
    } catch (err) {
      console.error('Failed to load ledgers:', err);
    } finally {
      setLedgersLoading(false);
    }
  }, []);

  // Load Feature Gates
  const loadGates = useCallback(async () => {
    setGatesLoading(true);
    try {
      const data = await fetchOwnerFeatureGates();
      setGatesList(data.gates);
    } catch (err) {
      console.error('Failed to load gates:', err);
    } finally {
      setGatesLoading(false);
    }
  }, []);

  // Load Audit
  const loadAudit = useCallback(async (page = 1) => {
    setAuditLoading(true);
    try {
      const data = await fetchOwnerAuditLogs({
        page,
        limit: auditPagination.limit,
        action: auditActionFilter || undefined,
      });
      setAuditLogs(data?.logs || []);
      setAuditPagination(normalizePagination(data?.pagination || data, page, auditPagination.limit));
    } catch (err) {
      console.error('Failed to load owner audit:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [auditPagination.limit, auditActionFilter]);

  // Load Security Health
  const loadSecurity = useCallback(async () => {
    setSecurityLoading(true);
    try {
      const data = await fetchOwnerSecurityHealth();
      setSecurityHealth(data);
    } catch (err) {
      console.error('Failed to load security health:', err);
    } finally {
      setSecurityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOwner) {
      loadOverview();
    }
  }, [isOwner, loadOverview]);

  useEffect(() => {
    if (!isOwner) return;
    if (activeTab === 'config') loadConfig();
    if (activeTab === 'ledgers') loadLedgers(1);
    if (activeTab === 'gates') loadGates();
    if (activeTab === 'audit') loadAudit(1);
    if (activeTab === 'security') loadSecurity();
  }, [activeTab, isOwner, loadConfig, loadLedgers, loadGates, loadAudit, loadSecurity]);

  const ledgerColumns: Column<LedgerEntryItem>[] = useMemo(
    () => [
      {
        key: 'entryRef',
        header: 'Entry Ref',
        render: (e) => <code style={{ fontFamily: 'monospace' }}>{e.entryRef}</code>,
      },
      {
        key: 'user',
        header: 'User',
        render: (e) => (
          <div>
            <div>{e.username || 'System Account'}</div>
            {e.userId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.userId}</div>}
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Direction / Amount',
        render: (e) => (
          <span
            style={{
              fontWeight: 700,
              color: e.direction === 'CREDIT' ? 'var(--status-success)' : 'var(--status-danger)',
            }}
          >
            {e.direction === 'CREDIT' ? '+' : '-'} {e.amountFormatted}
          </span>
        ),
      },
      {
        key: 'entryType',
        header: 'Entry Type',
        render: (e) => <StatusBadge status={e.entryType.toLowerCase()} />,
      },
      {
        key: 'relatedEntity',
        header: 'Associated Entity',
        render: (e) => <span style={{ color: 'var(--text-muted)' }}>{e.relatedEntity || '—'}</span>,
      },
      {
        key: 'createdAt',
        header: 'Timestamp',
        render: (e) => (
          <span style={{ color: 'var(--text-muted)' }}>
            {new Date(e.createdAt).toLocaleString()}
          </span>
        ),
      },
    ],
    []
  );

  const auditColumns: Column<OwnerAuditLogItem>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'Time',
        render: (l) => (
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
        header: 'Reason',
        render: (l) => (
          <span style={{ maxWidth: '320px', color: 'var(--text-muted)', display: 'inline-block' }}>
            {l.reason || '—'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (l) => <StatusBadge status={l.isSuccess ? 'completed' : 'rejected'} />,
      },
    ],
    []
  );

  if (!isOwner) {
    return (
      <Card style={{ padding: '3.5rem', textAlign: 'center', maxWidth: '650px', margin: '3rem auto' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>👑</div>
        <h2 style={{ fontSize: '1.6rem', color: 'var(--status-danger)', marginBottom: '0.75rem' }}>
          OwnerGate Authorization Required
        </h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '2rem' }}>
          The Executive Owner Portal is guarded by the OwnerGate subsystem and strict live database snowflake verification.
          Non-owner and standard administrative accounts are prevented from accessing infrastructure configurations.
        </p>
        <a href="/OwnerGate" className="btn btn-cta" style={{ backgroundColor: 'var(--primary-purple)', color: '#fff' }}>
          Authenticate via OwnerGate &rarr;
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
          borderLeft: '4px solid var(--primary-purple)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.3rem' }}>👑</span>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>G4X Owner Executive Portal</h1>
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(204, 255, 0, 0.15)',
                color: 'var(--accent-lime)',
                border: '1px solid rgba(204, 255, 0, 0.3)',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              Authoritative Owner Gate
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Authoritative platform infrastructure, financial configuration, feature gates, and double-entry ledger oversight.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button
            type="button"
            variant="primary"
            size="sm"
            style={{ backgroundColor: 'var(--primary-purple)', color: '#fff' }}
            onClick={() => {
              if (activeTab === 'overview') loadOverview();
              if (activeTab === 'config') loadConfig();
              if (activeTab === 'ledgers') loadLedgers(ledgerPage);
              if (activeTab === 'gates') loadGates();
              if (activeTab === 'audit') loadAudit(auditPagination.page);
              if (activeTab === 'security') loadSecurity();
            }}
          >
            ↻ Refresh System State
          </Button>
        </div>
      </Card>

      {/* Navigation Sub-Tabs */}
      <Tabs
        tabs={OWNER_TABS}
        activeTab={activeTab}
        onChange={handleTabChange}
        accent="purple"
      />

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: EXECUTIVE OVERVIEW                                                     */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {overviewLoading ? (
            <LoadingState message="Connecting to secure OwnerGate data services..." />
          ) : overviewError ? (
            <Card style={{ padding: '2rem', color: 'var(--status-danger)' }}>
              Error: {overviewError}
            </Card>
          ) : overview ? (
            <>
              {/* Identity & Gate Banner */}
              <div
                style={{
                  backgroundColor: 'rgba(124, 58, 237, 0.1)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff', marginBottom: '0.2rem' }}>
                    Authoritative Database Owner: <span style={{ color: 'var(--accent-lime)' }}>@{overview.owner.username}</span> ({overview.owner.discordId})
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Owner identity is strictly bound to the singular active database owner record. Superuser access verified.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <span className="badge badge-success" style={{ fontSize: '0.78rem' }}>
                    OWNERGATE: VERIFIED
                  </span>
                </div>
              </div>

              {/* KPI Summary Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                }}
              >
                <KpiCard
                  label="Total Registered Members"
                  value={overview.stats.totalUsers.toLocaleString()}
                  subtext={`${overview.stats.activeUsers} Active Accounts`}
                />

                <KpiCard
                  label="Published Boost Orders"
                  value={overview.stats.ordersTotal.toLocaleString()}
                  subtext={`${overview.stats.openDisputes} Active Disputes`}
                  highlight="lime"
                />

                <KpiCard
                  label="V2 Available Liabilities"
                  value={`$${((overview.stats.walletsOverview.v2.availableCents || 0) / 100).toFixed(2)}`}
                  subtext={`Reserved: $${((overview.stats.walletsOverview.v2.reservedCents || 0) / 100).toFixed(2)} USD`}
                />

                <KpiCard
                  label="Total Audit Events"
                  value={overview.stats.auditLogsCount.toLocaleString()}
                  subtext="Immutable security trail"
                  highlight="purple"
                />
              </div>

              {/* Financial Feature Gates Summary Table */}
              <Card style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Live Financial Gates Status</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                  Critical switches that govern live automated treasury movements. All switches remain strictly disabled.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {overview.featureGates.map((g) => (
                    <div
                      key={g.key}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: 'var(--bg-main)',
                        padding: '1rem',
                        borderRadius: 'var(--radius-sm)',
                        borderLeft: `4px solid ${g.isEnabled ? 'var(--status-success)' : 'var(--status-danger)'}`,
                        gap: '0.75rem',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', fontFamily: 'monospace' }}>
                          {g.key}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          {g.description}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span
                          className={`badge ${g.isEnabled ? 'badge-success' : 'badge-danger'}`}
                          style={{ fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          {g.isEnabled ? 'ENABLED (LIVE)' : 'DISABLED (SAFE)'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: UNIFIED ORDER MANAGEMENT WORKSPACE                                      */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'orders' && (
        <OrderManagementWorkspace title="Executive Order Pipeline & Operations Workspace" />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: EXECUTIVE USER MANAGEMENT & RBAC                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <UserManagementWorkspace
          canBan={true}
          canManageRoles={true}
          allowPrivilegedRoles={true}
          title="Executive User Registry & Multi-Role Governance"
          subtitle="Full authoritative oversight, privileged role grants, and immutable ban history audit."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: BOOSTER WITHDRAWAL QUEUE & ADMINISTRATION                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'withdrawals' && (
        <WithdrawalQueueWorkspace
          canReview={true}
          canEditMetadata={true}
          title="Executive Booster Withdrawal Administration"
          subtitle="Review payout requests, update operational destination metadata, and inspect full audit trail."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: MEMBER REGISTRATION APPLICATIONS                                        */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'applications' && (
        <ApplicationsWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: KYC IDENTITY DOCUMENTS MANAGEMENT                                        */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'kyc' && (
        <KycManagementPage />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: GAMES & SERVICES REGISTRY                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'games' && (
        <GamesWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: DISCORD CHANNELS & PROVISIONING                                          */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'discord' && (
        <ChannelsWorkspace embedded={true} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: MANUAL IRT DEPOSITS REVIEW QUEUE                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'deposits' && (
        <DepositQueueWorkspace
          isExecutive={true}
          title="Executive IRT Deposit Administration"
          subtitle="Authoritative review and verification of incoming card-to-card IRT payment slips and bank tracking evidence."
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: FINANCIAL CONFIGURATION FORMS                                          */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <Card style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>System Financial Parameters</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                  Controlled form backed by SystemFinancialConfig. Preserves historical quotes and snapshots.
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setSaveModalOpen(true)}
              >
                Save Configuration Changes
              </Button>
            </div>

            {configLoading ? (
              <LoadingState message="Loading system financial parameters..." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Exchange Rates & Quoting Policy */}
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: '1rem', textTransform: 'uppercase' }}>
                    1. Currency Conversion &amp; Deposit Policy
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
                    <Input
                      label="Reference USD / IRT Rate (Toman)"
                      type="number"
                      value={formInputs.admin_usd_irt_rate || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, admin_usd_irt_rate: e.target.value })}
                      helperText="E.g. 60000 IRT per 1 USD"
                    />

                    <Input
                      label="Incoming Deposit Fee Rate (Decimal Fraction)"
                      type="number"
                      step="0.005"
                      value={formInputs.incoming_irt_fee_rate || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, incoming_irt_fee_rate: e.target.value })}
                      helperText="0.02 = 2.00% fee applied to manual deposits"
                    />

                    <Input
                      label="Deposit Quote TTL (Minutes)"
                      type="number"
                      value={formInputs.incoming_irt_quote_ttl_minutes || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, incoming_irt_quote_ttl_minutes: e.target.value })}
                      helperText="Duration before unconfirmed quote expires"
                    />

                    <Input
                      label="Weekly Tuesday Payout Cutoff (Hour 0-23)"
                      type="number"
                      min="0"
                      max="23"
                      value={formInputs.irt_payout_tuesday_cutoff_hour || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, irt_payout_tuesday_cutoff_hour: e.target.value })}
                      helperText="Cutoff hour for weekly booster settlement"
                    />
                  </div>
                </div>

                {/* Receiving Iranian Banking Details */}
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: '1rem', textTransform: 'uppercase' }}>
                    2. Official Receiving Iranian Bank Credentials
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
                    <Input
                      label="Bank Name"
                      type="text"
                      value={formInputs.irt_bank_name || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, irt_bank_name: e.target.value })}
                    />

                    <Input
                      label="Account Holder Name"
                      type="text"
                      value={formInputs.irt_bank_card_holder || ''}
                      onChange={(e) => setFormInputs({ ...formInputs, irt_bank_card_holder: e.target.value })}
                    />

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Bank Card Number</label>
                        <button
                          type="button"
                          onClick={() => setShowSensitiveCard(!showSensitiveCard)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-lime)', fontSize: '0.72rem', cursor: 'pointer' }}
                        >
                          {showSensitiveCard ? 'Hide' : 'Reveal'}
                        </button>
                      </div>
                      <Input
                        type={showSensitiveCard ? 'text' : 'password'}
                        value={formInputs.irt_bank_card_number || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_card_number: e.target.value })}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Iranian Sheba (IBAN)</label>
                        <button
                          type="button"
                          onClick={() => setShowSensitiveIban(!showSensitiveIban)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-lime)', fontSize: '0.72rem', cursor: 'pointer' }}
                        >
                          {showSensitiveIban ? 'Hide' : 'Reveal'}
                        </button>
                      </div>
                      <Input
                        type={showSensitiveIban ? 'text' : 'password'}
                        value={formInputs.irt_bank_iban || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_iban: e.target.value })}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 3,000 Toman Deduction Policy Callout */}
                <div
                  style={{
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    padding: '1.25rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '0.35rem' }}>
                    Fixed 3,000-Toman Bank Fee Policy Specification
                  </div>
                  <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                    Per G4X platform policies, an authoritative bank transaction fee of exactly 3,000 Toman is deducted from the disbursed total on Iranian bank transfers. The ledger retains record of both gross entitlement and net bank payload.
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* Modal for Justification & Confirmation */}
          <Modal
            isOpen={saveModalOpen}
            onClose={() => {
              setSaveModalOpen(false);
              setSaveReason('');
              setConfigMsg(null);
            }}
            title="Confirm System Financial Parameter Updates"
            size="md"
          >
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
              Modifying platform exchange rates or banking coordinates affects future quote generation.
              All changes are immutably audited under your Owner credentials.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <Textarea
                rows={3}
                label="Mandatory Audit Justification (min 5 characters)"
                placeholder="E.g. Adjusted market reference rate following central bank FX revision..."
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
              />
            </div>

            {configMsg && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                  backgroundColor: configMsg.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                  color: configMsg.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                }}
              >
                {configMsg.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSaveModalOpen(false);
                  setSaveReason('');
                  setConfigMsg(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={savingConfig || saveReason.trim().length < 5}
                onClick={async () => {
                  setSavingConfig(true);
                  setConfigMsg(null);
                  try {
                    const res = await updateOwnerFinancialConfig(formInputs, saveReason);
                    setConfigMsg({ text: res.message, type: 'success' });
                    setTimeout(() => {
                      setSaveModalOpen(false);
                      setSaveReason('');
                      loadConfig();
                    }, 800);
                  } catch (err: any) {
                    setConfigMsg({ text: err.message || 'Update failed', type: 'error' });
                  } finally {
                    setSavingConfig(false);
                  }
                }}
              >
                {savingConfig ? 'Saving...' : 'Confirm & Audit'}
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: WALLETS & DOUBLE-ENTRY LEDGERS                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'ledgers' && (
        <Card style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Unified Finance V2 Double-Entry Ledgers</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Auditable transaction entries in LedgerEntryV2 and total platform liability balance.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadLedgers(ledgerPage)}
            >
              Refresh Ledgers
            </Button>
          </div>

          {ledgersLoading ? (
            <LoadingState message="Loading double-entry ledger journals..." />
          ) : ledgersData ? (
            <>
              {/* Liability Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <KpiCard
                  label="Available USD Liabilities"
                  value={`$${ledgersData.summary.aggregateBalances.availableUsd}`}
                  highlight="lime"
                />
                <KpiCard
                  label="Reserved Escrow USD"
                  value={`$${ledgersData.summary.aggregateBalances.reservedUsd}`}
                />
                <KpiCard
                  label="Pending Earnings"
                  value={`$${ledgersData.summary.aggregateBalances.pendingEarningsUsd}`}
                />
                <KpiCard
                  label="Total Net Liabilities"
                  value={`$${ledgersData.summary.aggregateBalances.totalLiabilitiesUsd}`}
                />
              </div>

              {/* Ledger Entries Table */}
              <DataTable
                columns={ledgerColumns}
                data={ledgersData.recentEntries}
                keyField="id"
                loading={ledgersLoading}
                emptyMessage="No ledger entries recorded."
              />

              {/* Pagination */}
              <Pagination
                pagination={normalizePagination(ledgersData.pagination, ledgerPage, 20)}
                onPageChange={(page) => loadLedgers(page)}
              />
            </>
          ) : null}
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: FEATURE GATES STATUS                                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'gates' && (
        <Card style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Financial Feature Gates Status</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>
            Production readiness controls for live treasury movement. Per platform policy, all switches remain statically disabled.
            No UI toggles exist to activate these switches; live enablement requires dedicated future authorization.
          </p>

          {gatesLoading ? (
            <LoadingState message="Inspecting feature-gate configuration..." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {gatesList.map((g) => (
                <div
                  key={g.key}
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    padding: '1.25rem',
                    borderRadius: 'var(--radius-sm)',
                    borderLeft: `4px solid ${g.isEnabled ? 'var(--status-success)' : 'var(--status-danger)'}`,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <div style={{ maxWidth: '650px' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', fontFamily: 'monospace', color: '#fff' }}>
                      {g.key}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                      {g.name}: {g.description}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--status-danger)', marginTop: '0.25rem' }}>
                      Policy: {g.policy}
                    </div>
                  </div>
                  <span
                    className={`badge ${g.isEnabled ? 'badge-success' : 'badge-danger'}`}
                    style={{ fontSize: '0.8rem', fontWeight: 800, padding: '0.35rem 0.75rem' }}
                  >
                    {g.isEnabled ? 'LIVE ENABLED' : 'LOCKED (FALSE)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: EXECUTIVE AUDIT LOG EXPLORATION                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <Card style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Executive Audit Log Exploration</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Complete platform event stream with previous and updated state snapshots.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <Input
                placeholder="Filter action..."
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadAudit(1)}
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
            emptyMessage="No audit logs matching query."
          />

          <Pagination
            pagination={auditPagination}
            onPageChange={(page) => loadAudit(page)}
          />
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 6: SECURITY & OPERATIONAL HEALTH                                          */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <Card style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Security Diagnostics &amp; Health</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            OwnerGate cryptographic authentication status, session validity, and server environment health.
          </p>

          {securityLoading ? (
            <LoadingState message="Querying security diagnostics..." />
          ) : securityHealth ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Database Owner Status</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--status-success)', marginTop: '0.25rem' }}>
                  {securityHealth.securityStatus.databaseOwnerStatus}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Snowflake: {securityHealth.securityStatus.ownerSnowflake}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active Server Sessions</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', marginTop: '0.25rem' }}>
                  {securityHealth.securityStatus.activeSessions} Active
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Stored in PrismaSessionStore
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>OwnerGate Rate Limiter</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
                  ACTIVE (15-min window)
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  In-memory IP brute-force guard
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Environment Mode</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.25rem' }}>
                  {securityHealth.securityStatus.nodeEnv.toUpperCase()}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  HttpOnly sameSite=lax cookies
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* RULES & POLICIES CMS WORKSPACE                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'rules' && <RulesManagementWorkspace />}
    </div>
  );
};

export default OwnerPage;
