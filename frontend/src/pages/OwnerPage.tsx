import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingState } from '../components/ui/LoadingState';
import {
  OwnerOverviewResponse,
  FeatureGateItem,
  FinancialConfigResponse,
  WalletsLedgersResponse,
  OwnerAuditLogItem,
  SecurityHealthResponse,
} from '../types/ownerPortal';
import {
  fetchOwnerOverview,
  fetchOwnerFeatureGates,
  fetchOwnerFinancialConfig,
  updateOwnerFinancialConfig,
  fetchOwnerWalletsLedgers,
  fetchOwnerAuditLogs,
  fetchOwnerSecurityHealth,
  fetchOwnerBackups,
  triggerOwnerBackup,
  restoreOwnerBackup,
} from '../services/ownerPortal';
import {
  OwnerBackupsResponse,
  BackupSnapshotItem,
} from '../types/ownerPortal';
import { useSearchParams } from 'react-router-dom';
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
  | 'security'
  | 'backups';

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
  'backups',
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

  const handleTabChange = (newTab: OwnerTab) => {
    setActiveTab(newTab);
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

  // Google Drive Backups & Disaster Recovery state
  const [backupsData, setBackupsData] = useState<OwnerBackupsResponse | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [selectedSnapshotForRestore, setSelectedSnapshotForRestore] = useState<BackupSnapshotItem | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [restoreStorage, setRestoreStorage] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);


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
      setAuditPagination(data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
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

  // Load Google Drive Backups
  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      const data = await fetchOwnerBackups();
      setBackupsData(data);
    } catch (err: any) {
      setBackupsError(err.message || 'Failed to query backup infrastructure status.');
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  const handleTriggerBackup = async () => {
    setRunningBackup(true);
    setBackupFeedback(null);
    try {
      const res = await triggerOwnerBackup();
      const snapName = res?.backup?.snapshotFilename || 'snapshot';
      const snapSize = res?.backup?.snapshotSizeFormatted || '';
      const isRemote = res?.backup?.uploadedToRemote;
      setBackupFeedback({
        text: `Backup created successfully! Snapshot: ${snapName} (${snapSize}). Destination: ${isRemote ? 'Uploaded to Google Drive ☁️' : 'Saved to Local Staging Mirror 💽'}.`,
        type: 'success',
      });
      await loadBackups();
    } catch (err: any) {
      setBackupFeedback({
        text: err.message || 'Failed to execute backup.',
        type: 'error',
      });
    } finally {
      setRunningBackup(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedSnapshotForRestore) return;
    if (confirmPhrase.trim() !== 'RESTORE') {
      setRestoreFeedback({ text: 'You must type RESTORE in all uppercase to confirm restore.', type: 'error' });
      return;
    }
    setRestoringBackup(true);
    setRestoreFeedback(null);
    try {
      const res = await restoreOwnerBackup(selectedSnapshotForRestore.filename, confirmPhrase, restoreStorage);
      const safetySnap = res?.report?.safetySnapshotFilename || 'saved in pre-restore';
      setRestoreFeedback({
        text: `Database successfully restored from ${selectedSnapshotForRestore.filename}! Pre-restore safety snapshot archived (${safetySnap}).`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedSnapshotForRestore(null);
        setConfirmPhrase('');
        setRestoreFeedback(null);
        loadBackups();
      }, 3000);
    } catch (err: any) {
      setRestoreFeedback({
        text: err.message || 'Database restoration failed.',
        type: 'error',
      });
    } finally {
      setRestoringBackup(false);
    }
  };

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
    if (activeTab === 'backups') loadBackups();
  }, [activeTab, isOwner, loadConfig, loadLedgers, loadGates, loadAudit, loadSecurity, loadBackups]);

  if (!isOwner) {
    return (
      <div className="card-surface" style={{ padding: '3.5rem', textAlign: 'center', maxWidth: '650px', margin: '3rem auto' }}>
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
          <button
            type="button"
            className="btn btn-cta btn-sm"
            style={{ backgroundColor: 'var(--primary-purple)', color: '#fff' }}
            onClick={() => {
              if (activeTab === 'overview') loadOverview();
              if (activeTab === 'config') loadConfig();
              if (activeTab === 'ledgers') loadLedgers(ledgerPage);
              if (activeTab === 'gates') loadGates();
              if (activeTab === 'audit') loadAudit(auditPagination.page);
              if (activeTab === 'security') loadSecurity();
              if (activeTab === 'backups') loadBackups();
            }}
          >
            ↻ Refresh System State
          </button>
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
          { key: 'overview', label: 'Executive Overview', icon: '🏛️' },
          { key: 'orders', label: 'Order Workspace', icon: '📦' },
          { key: 'users', label: 'User Management', icon: '👥' },
          { key: 'deposits', label: 'Manual IRT Deposits', icon: '💳' },
          { key: 'withdrawals', label: 'Withdrawal Queue', icon: '💸' },
          { key: 'applications', label: 'Member Applications', icon: '📋' },
          { key: 'kyc', label: 'KYC Management', icon: '🪪' },
          { key: 'games', label: 'Games & Services', icon: '🎮' },
          { key: 'discord', label: 'Discord Channels', icon: '💬' },
          { key: 'rules', label: 'Rules & Policies', icon: '⚖️' },
          { key: 'config', label: 'Financial Configuration', icon: '⚙️' },
          { key: 'ledgers', label: 'Wallets & Ledgers', icon: '📈' },
          { key: 'gates', label: 'Feature Gates Status', icon: '🔒' },
          { key: 'audit', label: 'Executive Audit Logs', icon: '📜' },
          { key: 'security', label: 'Security & Health', icon: '🛡️' },
          { key: 'backups', label: 'Drive Backups & Recovery', icon: '💾' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => handleTabChange(t.key as OwnerTab)}
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
      {/* TAB 1: EXECUTIVE OVERVIEW                                                     */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {overviewLoading ? (
            <LoadingState message="Connecting to secure OwnerGate data services..." />
          ) : overviewError ? (
            <div className="card-surface" style={{ padding: '2rem', color: 'var(--status-danger)' }}>
              Error: {overviewError}
            </div>
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
                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Total Registered Members
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: '#fff' }}>
                    {overview.stats.totalUsers.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--status-success)', marginTop: '0.25rem' }}>
                    {overview.stats.activeUsers} Active Accounts
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Published Boost Orders
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: 'var(--accent-lime)' }}>
                    {overview.stats.ordersTotal.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {overview.stats.openDisputes} Active Disputes
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    V2 Available Liabilities
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: '#38bdf8' }}>
                    ${((overview.stats.walletsOverview.v2.availableCents || 0) / 100).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Reserved: ${((overview.stats.walletsOverview.v2.reservedCents || 0) / 100).toFixed(2)} USD
                  </div>
                </div>

                <div className="card-surface" style={{ padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Total Audit Events
                  </div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 800, marginTop: '0.35rem', color: 'var(--primary-purple)' }}>
                    {overview.stats.auditLogsCount.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Immutable security trail
                  </div>
                </div>
              </div>

              {/* Financial Feature Gates Summary Table */}
              <div className="card-surface" style={{ padding: '1.5rem' }}>
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
              </div>
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
          <div className="card-surface" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>System Financial Parameters</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                  Controlled form backed by SystemFinancialConfig. Preserves historical quotes and snapshots.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-cta btn-sm"
                onClick={() => setSaveModalOpen(true)}
              >
                Save Configuration Changes
              </button>
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
                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Reference USD / IRT Rate (Toman)
                      </label>
                      <input
                        type="number"
                        value={formInputs.admin_usd_irt_rate || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, admin_usd_irt_rate: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>E.g. 60000 IRT per 1 USD</span>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Incoming Deposit Fee Rate (Decimal Fraction)
                      </label>
                      <input
                        type="number"
                        step="0.005"
                        value={formInputs.incoming_irt_fee_rate || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, incoming_irt_fee_rate: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>0.02 = 2.00% fee applied to manual deposits</span>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Deposit Quote TTL (Minutes)
                      </label>
                      <input
                        type="number"
                        value={formInputs.incoming_irt_quote_ttl_minutes || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, incoming_irt_quote_ttl_minutes: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Duration before unconfirmed quote expires</span>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Weekly Tuesday Payout Cutoff (Hour 0-23)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={formInputs.irt_payout_tuesday_cutoff_hour || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_payout_tuesday_cutoff_hour: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Cutoff hour for weekly booster settlement</span>
                    </div>
                  </div>
                </div>

                {/* Receiving Iranian Banking Details */}
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: '1rem', textTransform: 'uppercase' }}>
                    2. Official Receiving Iranian Bank Credentials
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Bank Name
                      </label>
                      <input
                        type="text"
                        value={formInputs.irt_bank_name || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_name: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Account Holder Name
                      </label>
                      <input
                        type="text"
                        value={formInputs.irt_bank_card_holder || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_card_holder: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)' }}
                      />
                    </div>

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
                      <input
                        type={showSensitiveCard ? 'text' : 'password'}
                        value={formInputs.irt_bank_card_number || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_card_number: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)', fontFamily: 'monospace' }}
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
                      <input
                        type={showSensitiveIban ? 'text' : 'password'}
                        value={formInputs.irt_bank_iban || ''}
                        onChange={(e) => setFormInputs({ ...formInputs, irt_bank_iban: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: '#fff', borderRadius: 'var(--radius-sm)', fontFamily: 'monospace' }}
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
                  <div style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>
                    {configData?.withdrawalDeductionPolicy?.description ||
                      'Per-transaction Iranian banking transfer fee of 3,000 Toman deducted solely from Booster IRT withdrawals. Strictly never applied to deposits.'}
                  </div>
                </div>

                {/* Advertiser Rank Commission Settings */}
                {configData?.advertiserRanks && (
                  <div style={{ backgroundColor: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-sm)' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: '1rem', textTransform: 'uppercase' }}>
                      3. Advertiser Rank Commission Matrix (Reference)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                      {configData.advertiserRanks.map((r) => (
                        <div key={r.rank} style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{r.label}</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
                            {r.percentageFormatted}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.basisPoints} bps</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save Confirmation Modal with Mandatory Reason */}
          {saveModalOpen && (
            <div
              className="studio-modal-backdrop"
              onClick={() => {
                setSaveModalOpen(false);
                setSaveReason('');
                setConfigMsg(null);
              }}
            >
              <div
                className="studio-modal-card"
                style={{ maxWidth: '520px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="studio-modal-header">
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                    Confirm Financial Configuration Update
                  </h3>
                  <button
                    type="button"
                    className="studio-modal-close"
                    onClick={() => {
                      setSaveModalOpen(false);
                      setSaveReason('');
                      setConfigMsg(null);
                    }}
                  >
                    &times;
                  </button>
                </div>

                <div className="studio-modal-body">
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                    Modifying platform exchange rates or banking coordinates affects future quote generation.
                    All changes are immutably audited under your Owner credentials.
                  </p>

                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Mandatory Audit Justification (min 5 characters)
                    </label>
                    <textarea
                      rows={3}
                      placeholder="E.g. Adjusted market reference rate following central bank FX revision..."
                      value={saveReason}
                      onChange={(e) => setSaveReason(e.target.value)}
                      className="input"
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  {configMsg && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        backgroundColor: configMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: configMsg.type === 'success' ? '#10b981' : '#ef4444',
                        border: `1px solid ${configMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      }}
                    >
                      {configMsg.text}
                    </div>
                  )}
                </div>

                <div className="studio-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSaveModalOpen(false);
                      setSaveReason('');
                      setConfigMsg(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingConfig || saveReason.trim().length < 5}
                    className="btn btn-cta btn-sm"
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
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: WALLETS & DOUBLE-ENTRY LEDGERS                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'ledgers' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Unified Finance V2 Double-Entry Ledgers</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Auditable transaction entries in LedgerEntryV2 and total platform liability balance.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadLedgers(ledgerPage)}
            >
              Refresh Ledgers
            </button>
          </div>

          {ledgersLoading ? (
            <LoadingState message="Loading double-entry ledger journals..." />
          ) : ledgersData ? (
            <>
              {/* Liability Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Available USD Liabilities</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
                    ${ledgersData.summary.aggregateBalances.availableUsd}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reserved Escrow USD</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.25rem' }}>
                    ${ledgersData.summary.aggregateBalances.reservedUsd}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pending Earnings</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--status-warning)', marginTop: '0.25rem' }}>
                    ${ledgersData.summary.aggregateBalances.pendingEarningsUsd}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Net Liabilities</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', marginTop: '0.25rem' }}>
                    ${ledgersData.summary.aggregateBalances.totalLiabilitiesUsd}
                  </div>
                </div>
              </div>

              {/* Ledger Entries Table */}
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Entry Ref</th>
                      <th>User</th>
                      <th>Direction / Amount</th>
                      <th>Entry Type</th>
                      <th>Associated Entity</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgersData.recentEntries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: 'monospace' }}>{e.entryRef}</td>
                        <td>
                          <div>{e.username || 'System Account'}</div>
                          {e.userId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.userId}</div>}
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color: e.direction === 'CREDIT' ? '#10b981' : '#ef4444',
                            }}
                          >
                            {e.direction === 'CREDIT' ? '+' : '-'} {e.amountFormatted}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-purple">
                            {e.entryType}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>
                          {e.relatedEntity || '—'}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>
                          {new Date(e.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Page {ledgersData?.pagination?.page ?? 1} of {ledgersData?.pagination?.totalPages || 1} ({ledgersData?.pagination?.total ?? 0} total)
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={(ledgersData?.pagination?.page ?? 1) <= 1}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadLedgers((ledgersData?.pagination?.page ?? 1) - 1)}
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={(ledgersData?.pagination?.page ?? 1) >= (ledgersData?.pagination?.totalPages || 1)}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadLedgers((ledgersData?.pagination?.page ?? 1) + 1)}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: FEATURE GATES STATUS                                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'gates' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
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
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: EXECUTIVE AUDIT LOG EXPLORATION                                         */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Executive Audit Log Exploration</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Complete platform event stream with previous and updated state snapshots.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                placeholder="Filter action..."
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
                onClick={() => loadAudit(1)}
              >
                Filter
              </button>
            </div>
          </div>

          {auditLoading ? (
            <LoadingState message="Loading audit trail..." />
          ) : auditLogs.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">📜</div>
              <div style={{ color: 'var(--text-muted)' }}>No audit logs matching query.</div>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Reason</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((l) => (
                      <tr key={l.id}>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(l.createdAt).toLocaleString()}
                        </td>
                        <td>
                          <div>{l.actor}</div>
                          {l.actorId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.actorId}</div>}
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontWeight: 600 }}>
                          {l.action}
                        </td>
                        <td>
                          {l.entityType} #{l.entityId}
                        </td>
                        <td style={{ maxWidth: '320px', color: 'var(--text-muted)' }}>
                          {l.reason || '—'}
                        </td>
                        <td>
                          <span className={`badge ${l.isSuccess ? 'badge-green' : 'badge-danger'}`}>
                            {l.isSuccess ? 'SUCCESS' : 'FAILED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Page {auditPagination?.page ?? 1} of {auditPagination?.totalPages || 1} ({auditPagination?.total ?? 0} total)
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={(auditPagination?.page ?? 1) <= 1}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadAudit((auditPagination?.page ?? 1) - 1)}
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={(auditPagination?.page ?? 1) >= (auditPagination?.totalPages || 1)}
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadAudit((auditPagination?.page ?? 1) + 1)}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 6: SECURITY & OPERATIONAL HEALTH                                          */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="card-surface" style={{ padding: '1.75rem' }}>
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
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* RULES & POLICIES CMS WORKSPACE                                                */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'rules' && <RulesManagementWorkspace />}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB: GOOGLE DRIVE HYBRID BACKUP & DISASTER RECOVERY                           */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'backups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Header & Status Card */}
          <div className="card-surface" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>💾</span>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Google Drive Hybrid Backup &amp; Recovery</h2>
                  <span
                    className="badge"
                    style={{
                      backgroundColor: backupsData?.rcloneStatus?.remoteReachable
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(250, 204, 21, 0.15)',
                      color: backupsData?.rcloneStatus?.remoteReachable ? 'var(--status-success)' : 'var(--accent-lime)',
                      border: `1px solid ${
                        backupsData?.rcloneStatus?.remoteReachable
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(250, 204, 21, 0.3)'
                      }`,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                    }}
                  >
                    {backupsData?.rcloneStatus?.remoteReachable
                      ? '5TB Google Drive Connected'
                      : backupsData?.rcloneStatus?.rcloneInstalled
                      ? 'Rclone Configured'
                      : 'Local Mirror Active'}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                  Atomic online SQLite snapshots (<code>VACUUM INTO</code> + <code>gzip</code>), SHA-256 manifests, incremental <code>storage/</code> synchronization to 5TB Google Drive, and crash-safe transactional disaster recovery.
                </p>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-cta"
                  disabled={runningBackup}
                  onClick={handleTriggerBackup}
                  style={{
                    backgroundColor: 'var(--accent-lime)',
                    color: '#000',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {runningBackup ? (
                    <>
                      <span className="spinner" style={{ width: '14px', height: '14px' }} />
                      Taking Atomic Snapshot...
                    </>
                  ) : (
                    <>
                      <span>☁️</span>
                      Backup Now to Google Drive
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={loadBackups}
                  disabled={backupsLoading}
                  style={{ color: 'var(--text-muted)' }}
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {/* Backup Feedback Alert Banner */}
            {backupFeedback && (
              <div
                style={{
                  padding: '0.85rem 1.25rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1.25rem',
                  backgroundColor:
                    backupFeedback.type === 'success'
                      ? 'rgba(34, 197, 94, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${
                    backupFeedback.type === 'success'
                      ? 'rgba(34, 197, 94, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'
                  }`,
                  color: backupFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{backupFeedback.text}</span>
                <button
                  type="button"
                  onClick={() => setBackupFeedback(null)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}
                >
                  &times;
                </button>
              </div>
            )}

            {/* Diagnostic Metric Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
              {/* Card 1: Cloud Remote */}
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Google Drive Target
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: backupsData?.rcloneStatus?.remoteReachable ? 'var(--status-success)' : 'var(--accent-lime)', marginTop: '0.35rem' }}>
                  {backupsData?.rcloneStatus?.remoteName || 'gdrive'}:{backupsData?.rcloneStatus?.baseFolder || 'G4X-Backups'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {backupsData?.rcloneStatus?.remoteReachable
                    ? 'Cloud sync connected & reachable'
                    : backupsData?.rcloneStatus?.rcloneInstalled
                    ? 'Rclone installed, remote pending verify'
                    : 'Local mirror mode active'}
                </div>
              </div>

              {/* Card 2: Scheduler */}
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Automated Scheduler
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: backupsData?.schedulerStatus?.enabled ? 'var(--accent-lime)' : 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {backupsData?.schedulerStatus?.enabled
                    ? `Active (Every ${backupsData.schedulerStatus.intervalHours}h)`
                    : 'Paused / Manual Only'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {backupsData?.schedulerStatus?.nextRunAt
                    ? `Next: ${new Date(backupsData.schedulerStatus.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Auto-prune older than 60 days'}
                </div>
              </div>

              {/* Card 3: Storage Safety */}
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  SQLite Snapshot Lock
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.35rem' }}>
                  VACUUM INTO Online Lock
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  Zero corruption during live traffic
                </div>
              </div>

              {/* Card 4: Disaster Recovery Safeguards */}
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Recovery Safeguard
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-purple)', marginTop: '0.35rem' }}>
                  Auto Pre-Restore Snapshots
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  Integrity + WAL purge on swap
                </div>
              </div>
            </div>

            {/* Setup Instructions banner if rclone not installed */}
            {(!backupsData?.rcloneStatus?.rcloneInstalled || !backupsData?.rcloneStatus?.remoteConfigured) && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '1.1rem 1.25rem',
                  backgroundColor: 'rgba(250, 204, 21, 0.05)',
                  border: '1px solid rgba(250, 204, 21, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--accent-lime)', marginBottom: '0.4rem' }}>
                  <span>ℹ️</span>
                  <span>Connect 5TB Google Drive Remote via Rclone</span>
                </div>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 0.6rem 0', lineHeight: '1.5' }}>
                  Local atomic snapshots are actively saved in <code>backups/database/</code>. To enable automatic cloud synchronization to your 5TB Google Drive, configure rclone on your host:
                </p>
                <div style={{ backgroundColor: 'var(--bg-main)', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', fontFamily: 'monospace', fontSize: '0.8rem', color: '#e2e8f0', overflowX: 'auto' }}>
                  1. Run: <span style={{ color: 'var(--accent-lime)' }}>rclone config</span> &rarr; Choose <strong>n</strong> (New remote) &rarr; Name: <strong>gdrive</strong> &rarr; Type: <strong>drive</strong><br />
                  2. Leave Client ID / Secret blank &rarr; Select Scope: <strong>1</strong> (Full access) &rarr; Authorize in browser.<br />
                  3. Verify: <span style={{ color: 'var(--accent-lime)' }}>npm run backup:gdrive</span>
                </div>
              </div>
            )}
          </div>

          {/* Snapshots Data Table Card */}
          <div className="card-surface" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Available Snapshots &amp; Manifests</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.2rem 0 0 0' }}>
                  Cryptographically verified SQLite database archives stored in Google Drive and local staging.
                </p>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Total Snapshots: <strong style={{ color: '#fff' }}>{backupsData?.snapshots?.length || 0}</strong>
              </div>
            </div>

            {backupsLoading ? (
              <LoadingState message="Querying Google Drive & local backup catalog..." />
            ) : backupsError ? (
              <div style={{ padding: '1.5rem', color: 'var(--status-danger)', textAlign: 'center' }}>
                {backupsError}
              </div>
            ) : !backupsData?.snapshots || backupsData.snapshots.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No database snapshots found yet. Click &quot;Backup Now to Google Drive&quot; above to create your first atomic snapshot.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Snapshot Filename</th>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Timestamp</th>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Size</th>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Location</th>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Checksum (SHA-256)</th>
                      <th style={{ padding: '0.75rem 0.6rem' }}>Row Counts</th>
                      <th style={{ padding: '0.75rem 0.6rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupsData.snapshots.map((s) => {
                      const manifest = s.manifest;
                      const rowSummary = manifest?.tableCounts
                        ? `Users: ${manifest.tableCounts.users ?? 0} | Orders: ${manifest.tableCounts.orders ?? 0} | Ledgers: ${manifest.tableCounts.ledgerEntries ?? 0}`
                        : '—';
                      return (
                        <tr
                          key={s.filename}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '0.85rem 0.6rem', fontFamily: 'monospace', fontWeight: 600, color: '#fff' }}>
                            {s.filename}
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {s.modifiedAt ? new Date(s.modifiedAt).toLocaleString() : '—'}
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                            {s.sizeFormatted}
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem' }}>
                            <span
                              className="badge"
                              style={{
                                backgroundColor: s.isRemote ? 'rgba(56, 189, 248, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                                color: s.isRemote ? '#38bdf8' : 'var(--primary-purple)',
                                border: `1px solid ${s.isRemote ? 'rgba(56, 189, 248, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}
                            >
                              {s.isRemote ? '☁️ Google Drive' : '💽 Local Staging'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {s.sha256 ? `${s.sha256.substring(0, 12)}...` : 'Manifest verified'}
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {rowSummary}
                          </td>
                          <td style={{ padding: '0.85rem 0.6rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSelectedSnapshotForRestore(s);
                                setConfirmPhrase('');
                                setRestoreStorage(false);
                                setRestoreFeedback(null);
                              }}
                              style={{
                                color: 'var(--status-danger)',
                                borderColor: 'rgba(239, 68, 68, 0.35)',
                                fontSize: '0.75rem',
                                padding: '0.35rem 0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              ⚠️ Restore
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Disaster Recovery Restore Confirmation Modal */}
          {selectedSnapshotForRestore && (
            <div
              className="studio-modal-backdrop"
              onClick={() => {
                if (!restoringBackup) {
                  setSelectedSnapshotForRestore(null);
                  setConfirmPhrase('');
                  setRestoreFeedback(null);
                }
              }}
            >
              <div
                className="studio-modal-card"
                style={{ maxWidth: '580px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="studio-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--status-danger)' }}>
                      Authoritative Database Restore Confirmation
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="studio-modal-close"
                    disabled={restoringBackup}
                    onClick={() => {
                      setSelectedSnapshotForRestore(null);
                      setConfirmPhrase('');
                      setRestoreFeedback(null);
                    }}
                  >
                    &times;
                  </button>
                </div>

                <div className="studio-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                  {/* Danger Notice Banner */}
                  <div
                    style={{
                      padding: '0.9rem 1.1rem',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.84rem',
                      lineHeight: '1.5',
                      color: '#fca5a5',
                    }}
                  >
                    <strong style={{ display: 'block', color: 'var(--status-danger)', marginBottom: '0.3rem' }}>
                      CRITICAL DISASTER RECOVERY SAFEGUARDS:
                    </strong>
                    Restoring this snapshot will immediately replace the active SQLite database with the selected point-in-time state.
                    An automatic pre-restore safety snapshot will be created in <code>backups/database/pre-restore/</code> prior to replacement.
                    Stale SQLite WAL and SHM frame caches will be purged automatically to prevent replay corruption.
                  </div>

                  {/* Target Snapshot Details */}
                  <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      Selected Archive
                    </div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: '0.92rem', wordBreak: 'break-all' }}>
                      {selectedSnapshotForRestore.filename}
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>Size: <strong style={{ color: 'var(--accent-lime)' }}>{selectedSnapshotForRestore.sizeFormatted}</strong></span>
                      <span>Modified: <strong style={{ color: '#fff' }}>{new Date(selectedSnapshotForRestore.modifiedAt).toLocaleString()}</strong></span>
                    </div>
                  </div>

                  {/* Optional Incremental Storage Restore Checkbox */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      backgroundColor: 'var(--bg-main)',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={restoreStorage}
                      disabled={restoringBackup}
                      onChange={(e) => setRestoreStorage(e.target.checked)}
                      style={{ accentColor: 'var(--accent-lime)' }}
                    />
                    <span>Also synchronize <code>storage/</code> files (KYC identities, receipts) from Google Drive</span>
                  </label>

                  {/* Confirmation Challenge Input */}
                  <div>
                    <label style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '0.4rem', color: '#fff' }}>
                      Type <span style={{ color: 'var(--status-danger)', fontFamily: 'monospace', fontWeight: 800 }}>RESTORE</span> to authorize disaster recovery:
                    </label>
                    <input
                      type="text"
                      value={confirmPhrase}
                      disabled={restoringBackup}
                      onChange={(e) => setConfirmPhrase(e.target.value)}
                      placeholder="RESTORE"
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: '#fff',
                        fontFamily: 'monospace',
                        fontSize: '0.95rem',
                        letterSpacing: '0.08em',
                      }}
                    />
                  </div>

                  {/* Restore Feedback */}
                  {restoreFeedback && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor:
                          restoreFeedback.type === 'success'
                            ? 'rgba(34, 197, 94, 0.12)'
                            : 'rgba(239, 68, 68, 0.12)',
                        border: `1px solid ${
                          restoreFeedback.type === 'success'
                            ? 'rgba(34, 197, 94, 0.3)'
                            : 'rgba(239, 68, 68, 0.3)'
                        }`,
                        color: restoreFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                        fontSize: '0.82rem',
                      }}
                    >
                      {restoreFeedback.text}
                    </div>
                  )}
                </div>

                <div className="studio-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={restoringBackup}
                    onClick={() => {
                      setSelectedSnapshotForRestore(null);
                      setConfirmPhrase('');
                      setRestoreFeedback(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-cta"
                    disabled={confirmPhrase.trim() !== 'RESTORE' || restoringBackup}
                    onClick={handleConfirmRestore}
                    style={{
                      backgroundColor: 'var(--status-danger)',
                      color: '#fff',
                      fontWeight: 700,
                      opacity: confirmPhrase.trim() !== 'RESTORE' || restoringBackup ? 0.5 : 1,
                      cursor: confirmPhrase.trim() !== 'RESTORE' || restoringBackup ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    {restoringBackup ? (
                      <>
                        <span className="spinner" style={{ width: '14px', height: '14px' }} />
                        Executing Atomic Restore...
                      </>
                    ) : (
                      'Authorize & Restore Live Database'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OwnerPage;
