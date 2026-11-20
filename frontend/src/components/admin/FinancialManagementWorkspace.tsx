import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  FinancialAccountItem,
  FinancialTransactionItem,
  PlatformOverviewItem,
  PlatformOverviewSummaryCards,
  TomanOverviewMetrics,
  FinancialAccountCategory,
  FinancialCurrency,
  FinancialAccountStatus,
  TransactionDirection,
} from '../../types/financialAccounts';
import {
  fetchPlatformBalanceOverview,
  fetchTomanAccountsOverview,
  fetchFinancialAccounts,
  createFinancialAccount,
  updateFinancialAccountMetadata,
  setFinancialAccountStatus,
  recordManualAdjustment,
  fetchAccountTransactions,
} from '../../services/financialAccounts';
import { TransfersExchangeSection } from './TransfersExchangeSection';
import { PlatformWithdrawalsSection } from './PlatformWithdrawalsSection';
import { FinancialReportsSection } from './FinancialReportsSection';
import { FinancialLedgerSection } from './FinancialLedgerSection';
import { BalanceReconciliationSection } from './BalanceReconciliationSection';
import { FinancialAuditLogsSection } from './FinancialAuditLogsSection';
import { HistoricalSnapshotsSection } from './HistoricalSnapshotsSection';
import { AdvancedAnalyticsSection } from './AdvancedAnalyticsSection';
import { AutomatedReportingSection } from './AutomatedReportingSection';
import { UserBoosterWalletControlsSection } from './UserBoosterWalletControlsSection';
import { AdminDepositInvoicesSection } from './AdminDepositInvoicesSection';
import { UserFinancialRoleInfo } from '../../types/financialLedger';
import { fetchUserFinancialRole } from '../../services/financialLedger';

function formatFinancialAmount(amount: number | string, currency: string = 'USD'): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount)) || 0;
  if (currency === 'USD') {
    return `$${(num / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${num.toLocaleString()} ${currency}`;
}

interface Props {
  onNavigateTab?: (tab: string) => void;
}

export const FinancialManagementWorkspace: React.FC<Props> = ({ onNavigateTab: _onNavigateTab }) => {
  // Navigation Sub-tab
  const [subTab, setSubTab] = useState<
    | 'wallets'
    | 'deposits'
    | 'platform'
    | 'snapshots'
    | 'analytics'
    | 'automated'
    | 'reports'
    | 'transfers'
    | 'withdrawals'
    | 'ledger'
    | 'reconciliation'
    | 'audit'
    | 'toman'
    | 'accounts'
    | 'adjustments'
  >('wallets');
  const [userRole, setUserRole] = useState<UserFinancialRoleInfo | null>(null);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Platform Overview State
  const [platforms, setPlatforms] = useState<PlatformOverviewItem[]>([]);
  const [summaryCards, setSummaryCards] = useState<PlatformOverviewSummaryCards | null>(null);

  // Toman Overview State
  const [tomanBankAccounts, setTomanBankAccounts] = useState<FinancialAccountItem[]>([]);
  const [tomanCashAccounts, setTomanCashAccounts] = useState<FinancialAccountItem[]>([]);
  const [tomanMetrics, setTomanMetrics] = useState<TomanOverviewMetrics | null>(null);

  // All Accounts State & Filters
  const [allAccounts, setAllAccounts] = useState<FinancialAccountItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Account for Details / Transactions Drawer
  const [selectedAccount, setSelectedAccount] = useState<FinancialAccountItem | null>(null);
  const [accountHistory, setAccountHistory] = useState<FinancialTransactionItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

  // Create Account Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    accountRef: '',
    category: 'INTERNAL' as FinancialAccountCategory,
    accountType: 'BANK_ACCOUNT' as any,
    currency: 'IRR' as FinancialCurrency,
    openingBalance: 0,
    bankName: '',
    accountNumber: '',
    iban: '',
    cardNumber: '',
    notes: '',
  });

  // Edit Metadata Modal State
  const [editingAccount, setEditingAccount] = useState<FinancialAccountItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    status: 'ACTIVE' as FinancialAccountStatus,
    bankName: '',
    accountNumber: '',
    iban: '',
    cardNumber: '',
    notes: '',
  });

  // Manual Adjustment Modal State
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    accountId: '',
    adjustmentType: 'CREDIT' as TransactionDirection,
    amount: '',
    reason: '',
    description: '',
    attachmentUrl: '',
    idempotencyKey: '',
  });

  // Global recent adjustments
  const [recentAdjustments, setRecentAdjustments] = useState<FinancialTransactionItem[]>([]);

  // Auto-dismiss banners
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Load Platform Overview Data
  const loadPlatformData = useCallback(async () => {
    try {
      const res = await fetchPlatformBalanceOverview();
      if (res.success) {
        setPlatforms(res.platforms || []);
        setSummaryCards(res.summaryCards || null);
      }
    } catch (err: any) {
      console.error('Failed to load platform balances:', err);
      setError(err.message || 'Failed to load platform balances');
    }
  }, []);

  // Load Toman Data
  const loadTomanData = useCallback(async () => {
    try {
      const res = await fetchTomanAccountsOverview();
      if (res.success) {
        setTomanBankAccounts(res.bankAccounts || []);
        setTomanCashAccounts(res.cashAccounts || []);
        setTomanMetrics(res.metrics || null);
      }
    } catch (err: any) {
      console.error('Failed to load Toman accounts:', err);
    }
  }, []);

  // Load All Accounts
  const loadAllAccounts = useCallback(async () => {
    try {
      const res = await fetchFinancialAccounts({
        category: categoryFilter !== 'all' ? (categoryFilter as FinancialAccountCategory) : undefined,
        currency: currencyFilter !== 'all' ? (currencyFilter as FinancialCurrency) : undefined,
        status: statusFilter !== 'all' ? (statusFilter as FinancialAccountStatus) : undefined,
        search: searchQuery || undefined,
      });
      if (res.success) {
        setAllAccounts(res.accounts || []);
      }
    } catch (err: any) {
      console.error('Failed to load accounts list:', err);
    }
  }, [categoryFilter, currencyFilter, statusFilter, searchQuery]);

  // Load User Role Tier
  const loadUserRole = useCallback(async () => {
    try {
      const res = await fetchUserFinancialRole();
      if (res && res.success) {
        setUserRole(res);
      }
    } catch (err: any) {
      console.warn('Failed to load user financial role:', err);
    }
  }, []);

  // Initial Load
  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadPlatformData(), loadTomanData(), loadAllAccounts(), loadUserRole()]);
    } catch (err: any) {
      setError(err.message || 'Failed to load financial workspace data');
    } finally {
      setLoading(false);
    }
  }, [loadPlatformData, loadTomanData, loadAllAccounts, loadUserRole]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // Open Account Details Drawer & Load Transactions
  const handleOpenAccountHistory = async (acc: FinancialAccountItem, page = 1) => {
    setSelectedAccount(acc);
    setHistoryPage(page);
    setHistoryLoading(true);
    try {
      const res = await fetchAccountTransactions(acc.id, { page, limit: 15 });
      if (res.success) {
        setAccountHistory(res.transactions || []);
        setHistoryTotalPages(res.pagination.totalPages || 1);
      }
    } catch (err: any) {
      console.error('Failed to load transactions:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (acc: FinancialAccountItem) => {
    setEditingAccount(acc);
    setEditForm({
      name: acc.name,
      status: acc.status,
      bankName: acc.bankName || '',
      accountNumber: acc.accountNumber || '',
      iban: acc.iban || '',
      cardNumber: acc.cardNumber || '',
      notes: acc.notes || '',
    });
  };

  // Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setSavingEdit(true);
    try {
      const res = await updateFinancialAccountMetadata(editingAccount.id, editForm);
      if (res.success) {
        setSuccessMsg(`Account '${res.account.name}' metadata updated successfully.`);
        setEditingAccount(null);
        loadWorkspace();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update account metadata');
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle Account Status
  const handleToggleStatus = async (acc: FinancialAccountItem) => {
    const nextStatus: FinancialAccountStatus = acc.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await setFinancialAccountStatus(acc.id, nextStatus);
      if (res.success) {
        setSuccessMsg(`Account '${acc.name}' status set to ${nextStatus}`);
        loadWorkspace();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle status');
    }
  };

  // Open Adjustment Modal for an account
  const handleOpenAdjustModal = (acc?: FinancialAccountItem) => {
    const chosen = acc || (allAccounts.length > 0 ? allAccounts[0] : null);
    setAdjustForm({
      accountId: chosen ? chosen.id : '',
      adjustmentType: 'CREDIT',
      amount: '',
      reason: '',
      description: '',
      attachmentUrl: '',
      idempotencyKey: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    });
    setShowAdjustModal(true);
  };

  // Submit Manual Adjustment
  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustForm.accountId) {
      setError('Please select a target account');
      return;
    }
    const amt = parseFloat(adjustForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid positive adjustment amount');
      return;
    }
    if (!adjustForm.reason.trim()) {
      setError('A reason is strictly required for all manual balance adjustments');
      return;
    }

    setAdjusting(true);
    try {
      const res = await recordManualAdjustment({
        accountId: adjustForm.accountId,
        adjustmentType: adjustForm.adjustmentType,
        amount: Math.floor(amt),
        reason: adjustForm.reason.trim(),
        description: adjustForm.description.trim() || undefined,
        attachmentUrl: adjustForm.attachmentUrl.trim() || undefined,
        idempotencyKey: adjustForm.idempotencyKey.trim() || undefined,
      });

      if (res.success) {
        setSuccessMsg(res.message);
        setShowAdjustModal(false);
        setRecentAdjustments((prev) => [res.transaction, ...prev]);
        loadWorkspace();
        if (selectedAccount && selectedAccount.id === adjustForm.accountId) {
          handleOpenAccountHistory(selectedAccount, 1);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute manual adjustment');
    } finally {
      setAdjusting(false);
    }
  };

  // Submit Create Account
  const handleSubmitCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setError('Account name is required');
      return;
    }
    setCreating(true);
    try {
      const res = await createFinancialAccount({
        name: createForm.name.trim(),
        accountRef: createForm.accountRef.trim() || undefined,
        category: createForm.category,
        accountType: createForm.accountType,
        currency: createForm.currency,
        openingBalance: createForm.openingBalance ? Math.floor(createForm.openingBalance) : 0,
        bankName: createForm.bankName.trim() || undefined,
        accountNumber: createForm.accountNumber.trim() || undefined,
        iban: createForm.iban.trim() || undefined,
        cardNumber: createForm.cardNumber.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      });

      if (res.success) {
        setSuccessMsg(`Account '${res.account.name}' created successfully.`);
        setShowCreateModal(false);
        setCreateForm({
          name: '',
          accountRef: '',
          category: 'INTERNAL',
          accountType: 'BANK_ACCOUNT',
          currency: 'IRR',
          openingBalance: 0,
          bankName: '',
          accountNumber: '',
          iban: '',
          cardNumber: '',
          notes: '',
        });
        loadWorkspace();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !summaryCards) {
    return (
      <div className="card-surface" style={{ padding: '3rem', minHeight: '350px' }}>
        <LoadingState message="Connecting to G4X Financial Accounts & Double-Entry Ledger..." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Workspace Header */}
      <div
        className="card-surface"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.25rem',
          borderLeft: '4px solid #8B5CF6',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🏛️</span>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: '#fff' }}>
              Financial Management &amp; Treasury Operations
            </h2>
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.25)',
                color: '#C4B5FD',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              Phase 1 &amp; 2 Core Treasury &amp; Transfers
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: 0 }}>
            Platform balances across 5 partner sources, internal USD treasury, local Toman bank accounts, transfers &amp; exchange, and withdrawal operations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadWorkspace}
            disabled={loading}
          >
            ↻ Refresh All
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleOpenAdjustModal()}
            style={{
              borderColor: 'rgba(250, 204, 21, 0.4)',
              color: 'var(--accent-yellow)',
            }}
          >
            ⚖️ Record Adjustment
          </button>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => setShowCreateModal(true)}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              color: '#fff',
              boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)',
            }}
          >
            + Create Account
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '10px',
            color: '#34D399',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Sub-Tabs Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
          overflowX: 'auto',
        }}
      >
        {[
          { key: 'wallets', label: 'User & Booster Wallets', icon: '👛' },
          { key: 'deposits', label: 'User Payments & NOWPayments Deposits', icon: '📥' },
          { key: 'platform', label: 'Platform Balances', icon: '🌐', count: platforms.length },
          { key: 'snapshots', label: 'Financial Snapshots', icon: '📸' },
          { key: 'analytics', label: 'Advanced Analytics & P&L', icon: '📈' },
          { key: 'automated', label: 'Automated Reporting', icon: '⏰' },
          { key: 'reports', label: 'Financial Reports', icon: '📊' },
          { key: 'transfers', label: 'Transfers & Exchange', icon: '🔄' },
          { key: 'withdrawals', label: 'Withdrawal Operations', icon: '💸' },
          { key: 'ledger', label: 'Double-Entry Ledger', icon: '📖' },
          { key: 'reconciliation', label: 'Balance Reconciliation', icon: '⚖️' },
          { key: 'audit', label: 'Audit Trail', icon: '🛡️' },
          { key: 'toman', label: 'Local Currency (Toman)', icon: '🇮🇷', count: tomanBankAccounts.length + tomanCashAccounts.length },
          { key: 'accounts', label: 'All Accounts & Management', icon: '🏛️', count: allAccounts.length },
          { key: 'adjustments', label: 'Manual Adjustments', icon: '📝' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key as any)}
            style={{
              padding: '0.55rem 1.15rem',
              borderRadius: '8px',
              border: subTab === t.key ? '1px solid #8B5CF6' : '1px solid transparent',
              backgroundColor: subTab === t.key ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              color: subTab === t.key ? '#C4B5FD' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {t.count !== undefined && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: subTab === t.key ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  color: '#fff',
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 0: USER & BOOSTER WALLET CONTROLS                                     */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'wallets' && (
        <UserBoosterWalletControlsSection onRefreshParent={loadWorkspace} />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 0.1: ADVERTISER CRYPTO DEPOSIT INVOICES (NOWPAYMENTS & TOP-UPS)       */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'deposits' && (
        <AdminDepositInvoicesSection />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 1: PLATFORM BALANCE OVERVIEW                                          */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'platform' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary Cards: 4 Core Asset Metrics + Non-Duplicative Consolidation */}
          {summaryCards && (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem',
                }}
              >
                {/* Total USD Platform Balance */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    background: 'linear-gradient(145deg, rgba(139, 92, 246, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total USD Platform Balance
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#C4B5FD', margin: '4px 0', fontFamily: 'monospace' }}>
                    {summaryCards.totalUsdPlatformBalanceUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Aggregated across 5 external seller stores
                  </div>
                </div>

                {/* Total USD Wallet Balance */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(52, 211, 153, 0.3)',
                    background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total USD Wallet Balance
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#34D399', margin: '4px 0', fontFamily: 'monospace' }}>
                    {summaryCards.totalUsdWalletBalanceUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Internal treasury &amp; settlement reserve
                  </div>
                </div>

                {/* Total Reserved Funds */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    background: 'linear-gradient(145deg, rgba(251, 191, 36, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total Reserved Funds
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#FBBF24', margin: '4px 0', fontFamily: 'monospace' }}>
                    {summaryCards.totalReservedFundsUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Locked for active withdrawals &amp; holds
                  </div>
                </div>

                {/* Total Available Funds */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    background: 'linear-gradient(145deg, rgba(56, 189, 248, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total Available Funds
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#38BDF8', margin: '4px 0', fontFamily: 'monospace' }}>
                    {summaryCards.totalAvailableFundsUsd}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Immediate liquid liquidity ready for payout
                  </div>
                </div>
              </div>

              {/* Strict Non-Duplicative Consolidation Banner */}
              <div
                style={{
                  padding: '0.85rem 1.25rem',
                  backgroundColor: 'rgba(139, 92, 246, 0.06)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  borderRadius: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.1rem' }}>🛡️</span>
                  <span style={{ fontSize: '0.84rem', color: '#C4B5FD', fontWeight: 600 }}>
                    Consolidated Asset Protection Rule:
                  </span>
                  <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Internal wallets and platform funds are strictly partitioned. Money is never counted twice.
                  </span>
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
                  Consolidated Net USD: <span style={{ color: '#34D399', fontFamily: 'monospace' }}>{summaryCards.consolidatedTotalUsdUsd}</span>
                </div>
              </div>
            </div>
          )}

          {/* 5 Platforms Data Table */}
          <div className="card-surface" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Authoritative Platform Balances &amp; Order Earnings
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  Real-time balances across the five supported external and direct channels.
                </p>
              </div>
              <span className="badge badge-purple" style={{ fontSize: '0.75rem' }}>
                5 Active Channels
              </span>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Platform Channel</th>
                    <th>Current Balance</th>
                    <th>Available</th>
                    <th>Reserved</th>
                    <th>Completed Earnings</th>
                    <th>Pending Earnings</th>
                    <th>Total Withdrawals</th>
                    <th>Last Update</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {platforms.map((p) => (
                    <tr key={p.source}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.2rem' }}>
                            {p.source === 'direct' ? '🌐' : p.source === 'eldorado' ? '⚡' : p.source === 'skycoach' ? '🚀' : p.source === 'overgear' ? '⚔️' : '👑'}
                          </span>
                          <div>
                            <div style={{ fontWeight: 700, color: '#fff' }}>{p.name}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                              ref: {p.accountRef || p.source}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#fff', fontSize: '0.95rem' }}>
                        {p.currentBalanceUsd}
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', color: '#38BDF8' }}>
                        {p.availableBalanceUsd}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#FBBF24' }}>
                        {p.reservedBalanceUsd}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#34D399' }}>
                        {p.completedOrderEarningsUsd}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#A78BFA' }}>
                        {p.pendingOrderEarningsUsd}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {p.totalSuccessfulWithdrawalsUsd}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(p.lastBalanceUpdate).toLocaleDateString()} {new Date(p.lastBalanceUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => {
                              const acc = allAccounts.find((a) => a.id === p.accountId || a.accountRef === p.accountRef);
                              if (acc) handleOpenAccountHistory(acc);
                            }}
                            title="Inspect transactions"
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => {
                              const acc = allAccounts.find((a) => a.id === p.accountId || a.accountRef === p.accountRef);
                              if (acc) handleOpenAdjustModal(acc);
                            }}
                            style={{ color: 'var(--accent-yellow)' }}
                            title="Record manual adjustment"
                          >
                            Adjust
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* User & Booster Wallet Controls Section on Main Overview */}
          <UserBoosterWalletControlsSection onRefreshParent={loadWorkspace} />
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: HISTORICAL FINANCIAL SNAPSHOTS (PHASE 5)                             */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'snapshots' && (
        <HistoricalSnapshotsSection />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: ADVANCED ANALYTICS, P&L & CASH FLOW (PHASE 5)                        */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'analytics' && (
        <AdvancedAnalyticsSection />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: AUTOMATED FINANCIAL REPORTING (PHASE 5)                              */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'automated' && (
        <AutomatedReportingSection />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: FINANCIAL REPORTS & ADVERTISER BOOSTS (PHASE 3)                      */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'reports' && (
        <FinancialReportsSection />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: TRANSFERS & CURRENCY CONVERSION (PHASE 2)                            */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'transfers' && (
        <TransfersExchangeSection
          accounts={allAccounts}
          onRefreshWorkspace={loadWorkspace}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: PLATFORM WITHDRAWAL OPERATIONS (PHASE 2)                            */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'withdrawals' && (
        <PlatformWithdrawalsSection
          accounts={allAccounts}
          onRefreshWorkspace={loadWorkspace}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: DOUBLE-ENTRY FINANCIAL LEDGER (PHASE 4)                              */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'ledger' && (
        <FinancialLedgerSection
          accounts={allAccounts}
          userRole={userRole}
          onRefreshWorkspace={loadWorkspace}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: BALANCE RECONCILIATION & AUDIT (PHASE 4)                             */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'reconciliation' && (
        <BalanceReconciliationSection
          accounts={allAccounts}
          userRole={userRole}
          onRefreshWorkspace={loadWorkspace}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB: FINANCIAL AUDIT TRAIL (PHASE 4)                                      */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'audit' && (
        <FinancialAuditLogsSection
          accounts={allAccounts}
          userRole={userRole}
          onRefreshWorkspace={loadWorkspace}
        />
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 2: LOCAL CURRENCY (TOMAN) ACCOUNTS                                    */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'toman' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Toman Executive Metrics Cards */}
          {tomanMetrics && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1rem',
              }}
            >
              {/* Total Local Balance */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  border: '1px solid rgba(52, 211, 153, 0.3)',
                  background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Total Local Balance
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#34D399', margin: '4px 0', fontFamily: 'monospace' }}>
                  {tomanMetrics.formattedTotalLocalBalance}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Combined across {tomanMetrics.banksCount} banks &amp; {tomanMetrics.cashCount} cash accounts
                </div>
              </div>

              {/* Total Available */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  background: 'linear-gradient(145deg, rgba(56, 189, 248, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Available for Payout
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#38BDF8', margin: '4px 0', fontFamily: 'monospace' }}>
                  {tomanMetrics.formattedTotalAvailable}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Ready for instant booster bank transfer
                </div>
              </div>

              {/* Total Deposits */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  background: 'linear-gradient(145deg, rgba(139, 92, 246, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Total Recorded Inflow
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#C4B5FD', margin: '4px 0', fontFamily: 'monospace' }}>
                  {tomanMetrics.formattedTotalDeposits}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Total credits into Iranian banking channels
                </div>
              </div>

              {/* Total Withdrawals */}
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  background: 'linear-gradient(145deg, rgba(248, 113, 113, 0.08) 0%, rgba(14, 16, 23, 0.95) 100%)',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Total Recorded Outflow
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#F87171', margin: '4px 0', fontFamily: 'monospace' }}>
                  {tomanMetrics.formattedTotalWithdrawals}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Total debits disbursed to booster cards
                </div>
              </div>
            </div>
          )}

          {/* Currency Documentation Note */}
          <div
            style={{
              padding: '0.85rem 1.25rem',
              backgroundColor: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '10px',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>ℹ️</span>
            <span>
              <strong>Currency Standard Note:</strong> All Iranian local amounts are displayed in <strong>Tomans (تومان)</strong>.
              Internally, balances are stored as exact 64-bit integers in Tomans (1 Toman = 10 Rials), preventing decimal inaccuracies.
            </span>
          </div>

          {/* Multiple Bank Accounts Section */}
          <div className="card-surface" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Corporate Iranian Bank Accounts
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  Authorized bank accounts for incoming advertiser deposits and outgoing booster disbursements.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCreateForm((prev) => ({
                    ...prev,
                    category: 'INTERNAL',
                    accountType: 'BANK_ACCOUNT',
                    currency: 'IRR',
                  }));
                  setShowCreateModal(true);
                }}
              >
                + Add Bank Account
              </button>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bank &amp; Account</th>
                    <th>Card Number</th>
                    <th>Sheba (IBAN)</th>
                    <th>Current Balance</th>
                    <th>Available</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tomanBankAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: '#fff' }}>{acc.name}</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Bank: <strong>{acc.bankName || 'General'}</strong> | Acc: {acc.accountNumber || '—'}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                        {acc.cardNumber || '—'}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {acc.iban || '—'}
                      </td>
                      <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#34D399', fontSize: '0.95rem' }}>
                        {acc.formattedCurrent}
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', color: '#38BDF8' }}>
                        {acc.formattedAvailable}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            acc.status === 'ACTIVE' ? 'badge-green' : acc.status === 'SUSPENDED' ? 'badge-red' : 'badge-gray'
                          }`}
                          style={{ fontSize: '0.72rem' }}
                        >
                          {acc.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAccountHistory(acc)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAdjustModal(acc)}
                            style={{ color: 'var(--accent-yellow)' }}
                          >
                            Adjust
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenEdit(acc)}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tomanBankAccounts.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No local bank accounts registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cash Drawers & Physical Reserves */}
          <div className="card-surface" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Cash Accounts &amp; Physical Vaults
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  On-hand local cash reserves for in-person settlements and office operations.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCreateForm((prev) => ({
                    ...prev,
                    category: 'INTERNAL',
                    accountType: 'CASH_ACCOUNT',
                    currency: 'IRR',
                  }));
                  setShowCreateModal(true);
                }}
              >
                + Add Cash Account
              </button>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vault / Drawer Name</th>
                    <th>Ref</th>
                    <th>Current Balance</th>
                    <th>Available</th>
                    <th>Notes</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tomanCashAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <td style={{ fontWeight: 700, color: '#fff' }}>
                        💵 {acc.name}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {acc.accountRef}
                      </td>
                      <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#34D399', fontSize: '0.95rem' }}>
                        {acc.formattedCurrent}
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', color: '#38BDF8' }}>
                        {acc.formattedAvailable}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {acc.notes || '—'}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            acc.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'
                          }`}
                          style={{ fontSize: '0.72rem' }}
                        >
                          {acc.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAccountHistory(acc)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAdjustModal(acc)}
                            style={{ color: 'var(--accent-yellow)' }}
                          >
                            Adjust
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tomanCashAccounts.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No cash accounts registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 3: ALL FINANCIAL ACCOUNTS LIST & MANAGEMENT                           */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'accounts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Filters Bar */}
          <div
            className="card-surface"
            style={{
              padding: '1.25rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">All Categories</option>
                <option value="PLATFORM">Platform Accounts</option>
                <option value="INTERNAL">Internal Accounts</option>
              </select>

              {/* Currency Filter */}
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">All Currencies</option>
                <option value="USD">USD ($)</option>
                <option value="IRR">Toman (IRT)</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>

              {/* Search Box */}
              <input
                type="text"
                placeholder="Search account by name, ref, card, bank..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  minWidth: '260px',
                }}
              />
            </div>

            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={() => setShowCreateModal(true)}
              style={{
                background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                color: '#fff',
              }}
            >
              + Create New Account
            </button>
          </div>

          {/* Accounts Table */}
          <div className="card-surface" style={{ padding: '1.5rem' }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account Name &amp; Ref</th>
                    <th>Category &amp; Type</th>
                    <th>Currency</th>
                    <th>Current Balance</th>
                    <th>Available Balance</th>
                    <th>Reserved</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: '#fff' }}>{acc.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {acc.accountRef}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span
                            className="badge"
                            style={{
                              backgroundColor: acc.category === 'PLATFORM' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                              color: acc.category === 'PLATFORM' ? '#C4B5FD' : '#38BDF8',
                              fontSize: '0.68rem',
                              width: 'fit-content',
                            }}
                          >
                            {acc.category}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                            {acc.accountType}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                          {acc.currency === 'USD' ? 'USD ($)' : 'Toman (IRT)'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#fff', fontSize: '0.92rem' }}>
                        {acc.formattedCurrent}
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', color: '#38BDF8' }}>
                        {acc.formattedAvailable}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#FBBF24' }}>
                        {acc.formattedReserved}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            acc.status === 'ACTIVE' ? 'badge-green' : acc.status === 'SUSPENDED' ? 'badge-red' : 'badge-gray'
                          }`}
                          style={{ fontSize: '0.72rem' }}
                        >
                          {acc.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAccountHistory(acc)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenAdjustModal(acc)}
                            style={{ color: 'var(--accent-yellow)' }}
                          >
                            Adjust
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenEdit(acc)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleToggleStatus(acc)}
                            title={acc.status === 'ACTIVE' ? 'Deactivate account' : 'Activate account'}
                          >
                            {acc.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {allAccounts.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                        No financial accounts matched the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 4: MANUAL ADJUSTMENTS LOG & CONTROLS                                  */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {subTab === 'adjustments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Action Callout */}
          <div
            className="card-surface"
            style={{
              padding: '1.75rem',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              borderLeft: '4px solid var(--accent-yellow)',
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                Manual Balance Adjustments &amp; Double-Entry Audit Trail
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Every manual credit or debit creates an immutable ledger entry and requires a mandatory administrative reason.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={() => handleOpenAdjustModal()}
              style={{
                backgroundColor: 'var(--accent-yellow)',
                color: '#000',
                fontWeight: 700,
              }}
            >
              ⚖️ Record New Adjustment
            </button>
          </div>

          {/* Quick Adjustment Table / Recent Activity */}
          <div className="card-surface" style={{ padding: '1.5rem' }}>
            <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 1rem', color: '#fff' }}>
              Recent Administrative Adjustments
            </h4>
            {recentAdjustments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                No manual adjustments recorded during this session.
                Use the &ldquo;Record New Adjustment&rdquo; button above to create one.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Transaction Ref</th>
                      <th>Account Ref</th>
                      <th>Direction</th>
                      <th>Amount</th>
                      <th>Reason</th>
                      <th>Admin ID</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAdjustments.map((tx) => (
                      <tr key={tx.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {tx.transactionRef}
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          {tx.accountRef || tx.accountId}
                        </td>
                        <td>
                          <span
                            className={`badge ${tx.direction === 'CREDIT' ? 'badge-green' : 'badge-red'}`}
                            style={{ fontSize: '0.72rem' }}
                          >
                            {tx.direction}
                          </span>
                        </td>
                        <td
                          style={{
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            color: tx.direction === 'CREDIT' ? '#34D399' : '#F87171',
                          }}
                        >
                          {tx.direction === 'CREDIT' ? '+' : '-'}{tx.formattedAmount}
                        </td>
                        <td style={{ fontSize: '0.82rem', color: '#fff' }}>
                          {tx.reason}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {tx.adminUsername || tx.adminId || 'Admin'}
                        </td>
                        <td>
                          <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                            {tx.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {new Date(tx.createdAt).toLocaleTimeString()}
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
      {/* MODAL: CREATE FINANCIAL ACCOUNT                                               */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                Create Financial Account
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitCreateAccount} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Account Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bank Pasargad Corporate, Eldorado Main..."
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Category *
                  </label>
                  <select
                    value={createForm.category}
                    onChange={(e) => setCreateForm({ ...createForm, category: e.target.value as any })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  >
                    <option value="INTERNAL">INTERNAL Account</option>
                    <option value="PLATFORM">PLATFORM Channel</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Account Type *
                  </label>
                  <select
                    value={createForm.accountType}
                    onChange={(e) => setCreateForm({ ...createForm, accountType: e.target.value as any })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  >
                    <option value="BANK_ACCOUNT">Bank Account</option>
                    <option value="CASH_ACCOUNT">Cash Account</option>
                    <option value="USD_WALLET">USD Wallet</option>
                    <option value="TOMAN_WALLET">Toman Wallet</option>
                    <option value="G4X_DIRECT">G4X Direct Store</option>
                    <option value="ELDORADO">Eldorado</option>
                    <option value="SKYCOACH">Skycoach</option>
                    <option value="OVERGEAR">Overgear</option>
                    <option value="KINGBOOST">Kingboost</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Currency *
                  </label>
                  <select
                    value={createForm.currency}
                    onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value as any })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  >
                    <option value="IRR">Toman (IRR/IRT)</option>
                    <option value="USD">USD (Cents)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Opening Balance ({createForm.currency === 'USD' ? 'cents, e.g. 1000 = $10' : 'Tomans'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={createForm.openingBalance || ''}
                    onChange={(e) => setCreateForm({ ...createForm, openingBalance: Number(e.target.value) })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  />
                </div>
              </div>

              {/* Bank Details (if bank account) */}
              {createForm.accountType === 'BANK_ACCOUNT' && (
                <div style={{ padding: '0.85rem', backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#C4B5FD' }}>
                    Banking Coordinates
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Bank Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Mellat, Saman, Melli..."
                        value={createForm.bankName}
                        onChange={(e) => setCreateForm({ ...createForm, bankName: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Account Number</label>
                      <input
                        type="text"
                        placeholder="Bank account number"
                        value={createForm.accountNumber}
                        onChange={(e) => setCreateForm({ ...createForm, accountNumber: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Card Number</label>
                      <input
                        type="text"
                        placeholder="16-digit card number"
                        value={createForm.cardNumber}
                        onChange={(e) => setCreateForm({ ...createForm, cardNumber: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>IBAN (Sheba)</label>
                      <input
                        type="text"
                        placeholder="IR..."
                        value={createForm.iban}
                        onChange={(e) => setCreateForm({ ...createForm, iban: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Operational Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Internal notes, store keys reference, responsible staff..."
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={creating}
                  style={{ background: '#8B5CF6', color: '#fff' }}
                >
                  {creating ? 'Creating Account…' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: EDIT ACCOUNT METADATA (NO DIRECT BALANCES MUTATION)                     */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {editingAccount && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Edit Account Metadata
                </h3>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  ref: {editingAccount.accountRef}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setEditingAccount(null)}
              >
                ✕
              </button>
            </div>

            {/* Invariant Alert */}
            <div
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(250, 204, 21, 0.08)',
                border: '1px solid rgba(250, 204, 21, 0.3)',
                borderRadius: '8px',
                fontSize: '0.8rem',
                color: 'var(--accent-yellow)',
                marginBottom: '1rem',
              }}
            >
              🔒 <strong>Balance Integrity Notice:</strong> Direct editing of calculated balances is prohibited.
              Current balance ({editingAccount.formattedCurrent}) can only be adjusted via recorded ledger adjustments.
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Account Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>

              {editingAccount.accountType === 'BANK_ACCOUNT' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Bank Name</label>
                    <input
                      type="text"
                      value={editForm.bankName}
                      onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Account Number</label>
                    <input
                      type="text"
                      value={editForm.accountNumber}
                      onChange={(e) => setEditForm({ ...editForm, accountNumber: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Card Number</label>
                    <input
                      type="text"
                      value={editForm.cardNumber}
                      onChange={(e) => setEditForm({ ...editForm, cardNumber: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>IBAN</label>
                    <input
                      type="text"
                      value={editForm.iban}
                      onChange={(e) => setEditForm({ ...editForm, iban: e.target.value })}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Operational Notes
                </label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingAccount(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={savingEdit}
                  style={{ background: '#8B5CF6', color: '#fff' }}
                >
                  {savingEdit ? 'Saving…' : 'Save Metadata'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: MANUAL BALANCE ADJUSTMENT                                              */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {showAdjustModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '560px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Record Manual Balance Adjustment
                </h3>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Atomic ledger credit or debit with required audit explanation
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setShowAdjustModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitAdjustment} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Target Account *
                </label>
                <select
                  required
                  value={adjustForm.accountId}
                  onChange={(e) => setAdjustForm({ ...adjustForm, accountId: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                >
                  <option value="">Select target financial account...</option>
                  {allAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.category} · {a.currency} · Avail: {a.formattedAvailable})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Adjustment Type *
                  </label>
                  <select
                    value={adjustForm.adjustmentType}
                    onChange={(e) => setAdjustForm({ ...adjustForm, adjustmentType: e.target.value as any })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  >
                    <option value="CREDIT">🟢 CREDIT (Add funds)</option>
                    <option value="DEBIT">🔴 DEBIT (Deduct funds)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Amount (Integer units / Tomans) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    placeholder="e.g. 5000000 Tomans or 5000 cents"
                    value={adjustForm.amount}
                    onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--accent-yellow)', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  Mandatory Adjustment Reason *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bank reconciliation discrepancy, cash replenishment, store fee correction..."
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid rgba(250, 204, 21, 0.4)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Detailed Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Provide supporting context or reference IDs..."
                  value={adjustForm.description}
                  onChange={(e) => setAdjustForm({ ...adjustForm, description: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Attachment / Receipt URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://... or doc ref"
                    value={adjustForm.attachmentUrl}
                    onChange={(e) => setAdjustForm({ ...adjustForm, attachmentUrl: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Idempotency Key
                  </label>
                  <input
                    type="text"
                    value={adjustForm.idempotencyKey}
                    onChange={(e) => setAdjustForm({ ...adjustForm, idempotencyKey: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.76rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAdjustModal(false)}
                  disabled={adjusting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={adjusting}
                  style={{
                    backgroundColor: adjustForm.adjustmentType === 'CREDIT' ? '#10B981' : '#EF4444',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {adjusting ? 'Recording Ledger Entry…' : `Confirm ${adjustForm.adjustmentType} Adjustment`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* DRAWER / MODAL: ACCOUNT TRANSACTION HISTORY                                   */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {selectedAccount && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '780px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                    {selectedAccount.name}
                  </h3>
                  <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                    {selectedAccount.currency}
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
                  ID: {selectedAccount.id} | Ref: {selectedAccount.accountRef}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setSelectedAccount(null)}
              >
                ✕ Close
              </button>
            </div>

            {/* Balances Overview Strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.75rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Opening</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>
                  {formatFinancialAmount(selectedAccount.openingBalance, selectedAccount.currency)}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'monospace', color: '#34D399' }}>
                  {selectedAccount.formattedCurrent}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Available</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'monospace', color: '#38BDF8' }}>
                  {selectedAccount.formattedAvailable}
                </div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reserved</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'monospace', color: '#FBBF24' }}>
                  {selectedAccount.formattedReserved}
                </div>
              </div>
            </div>

            {/* Transactions Ledger */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#fff' }}>
                Immutable Ledger History
              </h4>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => handleOpenAdjustModal(selectedAccount)}
                style={{ color: 'var(--accent-yellow)' }}
              >
                + Record Adjustment
              </button>
            </div>

            {historyLoading ? (
              <LoadingState message="Loading account transactions..." />
            ) : accountHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                No recorded transactions for this account yet.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Type</th>
                      <th>Direction</th>
                      <th>Amount</th>
                      <th>Reason / Note</th>
                      <th>Admin</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountHistory.map((tx) => (
                      <tr key={tx.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.76rem', fontWeight: 700 }}>
                          {tx.transactionRef}
                        </td>
                        <td>
                          <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                            {tx.type}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${tx.direction === 'CREDIT' ? 'badge-green' : 'badge-red'}`}
                            style={{ fontSize: '0.7rem' }}
                          >
                            {tx.direction}
                          </span>
                        </td>
                        <td
                          style={{
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            color: tx.direction === 'CREDIT' ? '#34D399' : '#F87171',
                          }}
                        >
                          {tx.direction === 'CREDIT' ? '+' : '-'}{tx.formattedAmount}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#fff' }}>
                          <div>{tx.reason}</div>
                          {tx.description && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{tx.description}</div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {tx.adminUsername || tx.adminId || 'System'}
                        </td>
                        <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {historyTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  disabled={historyPage <= 1}
                  onClick={() => handleOpenAccountHistory(selectedAccount, historyPage - 1)}
                >
                  &larr; Prev
                </button>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                  Page {historyPage} of {historyTotalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  disabled={historyPage >= historyTotalPages}
                  onClick={() => handleOpenAccountHistory(selectedAccount, historyPage + 1)}
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
