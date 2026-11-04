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
} from '../services/ownerPortal';

export const OwnerPage: React.FC = () => {
  const { user, hasRole } = useAuth();
  const isOwner = hasRole('owner');

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'ledgers' | 'gates' | 'audit' | 'security'>('overview');

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
          <a href="/admin" className="btn btn-secondary btn-sm">
            &larr; Switch to Admin Hub
          </a>
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
          { key: 'config', label: 'Financial Configuration', icon: '⚙️' },
          { key: 'ledgers', label: 'Wallets & Ledgers', icon: '📈' },
          { key: 'gates', label: 'Feature Gates Status', icon: '🔒' },
          { key: 'audit', label: 'Executive Audit Logs', icon: '📜' },
          { key: 'security', label: 'Security & Health', icon: '🛡️' },
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
              <div className="card-surface" style={{ maxWidth: '480px', width: '100%', padding: '2rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Confirm Financial Configuration Update
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
                  Modifying platform exchange rates or banking coordinates affects future quote generation.
                  All changes are immutably audited under your Owner credentials.
                </p>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Mandatory Audit Justification (min 5 characters)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="E.g. Adjusted market reference rate following central bank FX revision..."
                    value={saveReason}
                    onChange={(e) => setSaveReason(e.target.value)}
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

                {configMsg && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      marginBottom: '1rem',
                      backgroundColor: configMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: configMsg.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                    }}
                  >
                    {configMsg.text}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
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
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Entry Ref</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>User</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Direction / Amount</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Entry Type</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Associated Entity</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgersData.recentEntries.map((e) => (
                      <tr key={e.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>{e.entryRef}</td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <div>{e.username || 'System Account'}</div>
                          {e.userId && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.userId}</div>}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span
                            style={{
                              fontWeight: 700,
                              color: e.direction === 'CREDIT' ? 'var(--status-success)' : 'var(--status-danger)',
                            }}
                          >
                            {e.direction === 'CREDIT' ? '+' : '-'} {e.amountFormatted}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                            {e.entryType}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                          {e.relatedEntity || '—'}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
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
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No audit logs matching query.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Time</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Actor</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Action</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Entity</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Reason</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
                      <td style={{ padding: '0.75rem 0.5rem', maxWidth: '320px', color: 'var(--text-muted)' }}>
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
            </div>
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
    </div>
  );
};

export default OwnerPage;
