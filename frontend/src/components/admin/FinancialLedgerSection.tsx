import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  JournalRecordItem,
  TrialBalanceData,
  DoubleEntryTransactionType,
  UserFinancialRoleInfo,
} from '../../types/financialLedger';
import { FinancialAccountItem } from '../../types/financialAccounts';
import {
  fetchDoubleEntryJournal,
  fetchTrialBalance,
  recordManualDoubleEntry,
  reverseFinancialTransaction,
  downloadLedgerCsv,
} from '../../services/financialLedger';

interface Props {
  accounts: FinancialAccountItem[];
  userRole?: UserFinancialRoleInfo | null;
  onRefreshWorkspace?: () => void;
}

export const FinancialLedgerSection: React.FC<Props> = ({ accounts, userRole, onRefreshWorkspace }) => {
  // ─── Trial Balance State ────────────────────────────────────────────────────
  const [tbCurrency, setTbCurrency] = useState<'USD' | 'IRR'>('USD');
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null);
  const [tbLoading, setTbLoading] = useState<boolean>(true);

  // ─── Double-Entry Journal State ─────────────────────────────────────────────
  const [journalEntries, setJournalEntries] = useState<JournalRecordItem[]>([]);
  const [journalLoading, setJournalLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ─── Reversal Modal State ───────────────────────────────────────────────────
  const [showReverseModal, setShowReverseModal] = useState<boolean>(false);
  const [reverseTargetId, setReverseTargetId] = useState<string>('');
  const [reverseReason, setReverseReason] = useState<string>('');
  const [reversing, setReversing] = useState<boolean>(false);

  // ─── Manual Journal Entry Modal State ───────────────────────────────────────
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [submittingManual, setSubmittingManual] = useState<boolean>(false);
  const [manualForm, setManualForm] = useState({
    transactionType: 'ADJUSTMENT' as DoubleEntryTransactionType,
    debitAccountId: '',
    creditAccountId: '',
    amount: '',
    currency: 'USD',
    referenceId: '',
    description: '',
  });

  // Feedback states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // Auto-dismiss banners
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  useEffect(() => {
    if (errorMsg) {
      const t = setTimeout(() => setErrorMsg(null), 6000);
      return () => clearTimeout(t);
    }
  }, [errorMsg]);

  // Load Trial Balance
  const loadTrialBalance = useCallback(async () => {
    setTbLoading(true);
    try {
      const res = await fetchTrialBalance(tbCurrency);
      if (res && res.trialBalance) {
        setTrialBalance(res.trialBalance);
      }
    } catch (err: any) {
      console.warn('[FinancialLedger] Failed to load trial balance:', err);
    } finally {
      setTbLoading(false);
    }
  }, [tbCurrency]);

  // Load Journal Entries
  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    try {
      const res = await fetchDoubleEntryJournal({
        transactionType: typeFilter !== 'all' ? typeFilter : undefined,
        currency: currencyFilter !== 'all' ? currencyFilter : undefined,
        accountId: accountFilter !== 'all' ? accountFilter : undefined,
        search: searchQuery.trim() || undefined,
        page,
        limit: 15,
      });

      if (res && res.entries) {
        setJournalEntries(res.entries);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      }
    } catch (err: any) {
      console.warn('[FinancialLedger] Failed to load journal:', err);
    } finally {
      setJournalLoading(false);
    }
  }, [typeFilter, currencyFilter, accountFilter, searchQuery, page]);

  useEffect(() => {
    loadTrialBalance();
  }, [loadTrialBalance]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  // Handle Reverse Transaction
  const handleExecuteReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTargetId.trim()) {
      setErrorMsg('Please enter a valid Transaction Ref or ID to reverse');
      return;
    }
    if (!reverseReason.trim()) {
      setErrorMsg('A clear justification/reason is strictly required for reversals');
      return;
    }

    setReversing(true);
    try {
      const res = await reverseFinancialTransaction(reverseTargetId.trim(), {
        reason: reverseReason.trim(),
      });
      setSuccessMsg(res.message);
      setShowReverseModal(false);
      setReverseTargetId('');
      setReverseReason('');
      loadJournal();
      loadTrialBalance();
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reverse transaction');
    } finally {
      setReversing(false);
    }
  };

  // Handle Manual Journal Submission
  const handleSubmitManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.debitAccountId || !manualForm.creditAccountId) {
      setErrorMsg('Both Debit and Credit accounts must be selected');
      return;
    }
    if (manualForm.debitAccountId === manualForm.creditAccountId) {
      setErrorMsg('Debit and Credit accounts must be distinct');
      return;
    }
    const amt = parseFloat(manualForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg('Please enter a positive numeric amount');
      return;
    }

    setSubmittingManual(true);
    try {
      const minor = manualForm.currency === 'USD' ? Math.round(amt * 100) : Math.round(amt);
      const res = await recordManualDoubleEntry({
        transactionType: manualForm.transactionType,
        debitAccountId: manualForm.debitAccountId,
        creditAccountId: manualForm.creditAccountId,
        amountMinor: minor,
        currency: manualForm.currency,
        referenceId: manualForm.referenceId.trim() || undefined,
        description: manualForm.description.trim() || undefined,
      });

      setSuccessMsg(res.message);
      setShowManualModal(false);
      setManualForm({
        transactionType: 'ADJUSTMENT',
        debitAccountId: '',
        creditAccountId: '',
        amount: '',
        currency: 'USD',
        referenceId: '',
        description: '',
      });
      loadJournal();
      loadTrialBalance();
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to post manual journal entry');
    } finally {
      setSubmittingManual(false);
    }
  };

  // CSV Export
  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await downloadLedgerCsv('journal', {
        transactionType: typeFilter !== 'all' ? typeFilter : '',
        currency: currencyFilter !== 'all' ? currencyFilter : '',
      });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingCsv(false);
    }
  };

  const filteredAccountsForManual = accounts.filter(
    (a) => a.currency === manualForm.currency && a.status === 'ACTIVE'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* HEADER & CONTROLS                                                         */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        className="card-surface"
        style={{
          padding: '1.5rem',
          border: '1px solid rgba(139, 92, 246, 0.25)',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📖</span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              Double-Entry Financial Ledger
            </h2>
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: 'rgba(139, 92, 246, 0.25)',
                color: '#C4B5FD',
                fontWeight: 700,
                border: '1px solid rgba(139, 92, 246, 0.4)',
              }}
            >
              Phase 4 Core Accounting
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: '6px 0 0 0' }}>
            Immutable double-entry journal records, mathematical trial balance verification, and safe counter-entry transaction reversals.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              loadTrialBalance();
              loadJournal();
            }}
            disabled={tbLoading || journalLoading}
          >
            ↻ Refresh Ledger
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowReverseModal(true)}
            style={{
              borderColor: 'rgba(239, 68, 68, 0.4)',
              color: '#F87171',
            }}
          >
            ↩ Reverse Transaction
          </button>

          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => setShowManualModal(true)}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              color: '#fff',
            }}
          >
            + Post Journal Entry
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleExportCsv}
            disabled={exportingCsv}
          >
            📥 Export Journal
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
            fontSize: '0.9rem',
          }}
        >
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* TRIAL BALANCE EXECUTIVE SUMMARY CARDS                                     */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        className="card-surface"
        style={{
          padding: '1.25rem',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              Trial Balance Verification (Debit / Credit Equality)
            </h3>
            {trialBalance && (
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  backgroundColor: trialBalance.isBalanced ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: trialBalance.isBalanced ? '#34D399' : '#F87171',
                  border: `1px solid ${trialBalance.isBalanced ? 'rgba(52, 211, 153, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                }}
              >
                {trialBalance.isBalanced ? '✓ PERFECTLY BALANCED' : '⚠️ DISCREPANCY DETECTED'}
              </span>
            )}
          </div>

          {/* Currency Toggle */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['USD', 'IRR'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTbCurrency(c)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: tbCurrency === c ? '1px solid #8B5CF6' : '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: tbCurrency === c ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                  color: tbCurrency === c ? '#fff' : 'var(--text-muted)',
                }}
              >
                {c === 'USD' ? 'USD ($)' : 'Toman (IRT)'}
              </button>
            ))}
          </div>
        </div>

        {tbLoading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Calculating trial balance debits and credits...
          </div>
        ) : trialBalance ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {/* Total Debits */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                Total Debits
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#38BDF8', fontFamily: 'monospace', margin: '4px 0' }}>
                {trialBalance.formattedTotalDebits}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Sum of all debit journal postings
              </div>
            </div>

            {/* Total Credits */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                Total Credits
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34D399', fontFamily: 'monospace', margin: '4px 0' }}>
                {trialBalance.formattedTotalCredits}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Sum of all credit journal postings
              </div>
            </div>

            {/* Discrepancy */}
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                Equation Discrepancy
              </div>
              <div
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 800,
                  color: trialBalance.isBalanced ? '#34D399' : '#F87171',
                  fontFamily: 'monospace',
                  margin: '4px 0',
                }}
              >
                {trialBalance.formattedDiscrepancy}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Debits minus credits (must equal 0)
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* DOUBLE-ENTRY JOURNAL TABLE WITH FILTERS & PAGINATION                      */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        className="card-surface"
        style={{
          padding: '1.5rem',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              Posted Journal Entries
            </h4>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Total {totalCount} double-entry records
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search entry ref, desc..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="input"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', width: '180px' }}
            />

            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            >
              <option value="all">All Types</option>
              <option value="INTERNAL_TRANSFER">Internal Transfer</option>
              <option value="WITHDRAWAL">Withdrawal</option>
              <option value="ORDER_REVENUE">Order Revenue</option>
              <option value="PLATFORM_FEE">Platform Fee</option>
              <option value="BOOSTER_PAYOUT">Booster Payout</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="REVERSAL">Reversal</option>
            </select>

            <select
              value={currencyFilter}
              onChange={(e) => {
                setCurrencyFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            >
              <option value="all">All Currencies</option>
              <option value="USD">USD</option>
              <option value="IRR">IRR (Toman)</option>
            </select>

            <select
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', maxWidth: '170px' }}
            >
              <option value="all">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Journal Ref</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Debit Account (Dr)</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Credit Account (Cr)</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {journalLoading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading double-entry journal...
                  </td>
                </tr>
              ) : journalEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No journal records found matching the current criteria.
                  </td>
                </tr>
              ) : (
                journalEntries.map((j) => (
                  <tr
                    key={j.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background-color 0.1s ease',
                    }}
                  >
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, fontFamily: 'monospace', color: '#fff' }}>
                      {j.entryRef}
                      {j.referenceId && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Ref: {j.referenceId}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          backgroundColor:
                            j.transactionType === 'REVERSAL'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : j.transactionType === 'INTERNAL_TRANSFER'
                              ? 'rgba(139, 92, 246, 0.2)'
                              : 'rgba(255, 255, 255, 0.06)',
                          color:
                            j.transactionType === 'REVERSAL'
                              ? '#F87171'
                              : j.transactionType === 'INTERNAL_TRANSFER'
                              ? '#C4B5FD'
                              : 'var(--text-secondary)',
                        }}
                      >
                        {j.transactionType}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#38BDF8', fontWeight: 600 }}>
                      {j.debitAccountName}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#34D399', fontWeight: 600 }}>
                      {j.creditAccountName}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', color: '#fff' }}>
                      {j.formattedAmount}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)', maxWidth: '220px' }}>
                      {j.description || '—'}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(j.createdAt).toLocaleDateString()} {new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '0.75rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Page {page} of {totalPages} ({totalCount} items)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page <= 1 || journalLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page >= totalPages || journalLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: REVERSE TRANSACTION                                              */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {showReverseModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
              width: '100%',
              maxWidth: '480px',
              padding: '1.5rem',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#F87171', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>↩</span>
                <span>Reverse Transaction</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowReverseModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Posted transactions are never deleted. A new counter-reversal transaction and double-entry entry will be created, linking history and reversing the balances safely.
            </p>

            <form onSubmit={handleExecuteReversal} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Transaction Ref or ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FTX-..., ORD-..., or UUID"
                  value={reverseTargetId}
                  onChange={(e) => setReverseTargetId(e.target.value)}
                  className="input"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Reversal Reason / Explanation *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Explain why this transaction must be reversed..."
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  className="textarea"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowReverseModal(false)}
                  disabled={reversing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={reversing}
                  style={{
                    backgroundColor: '#DC2626',
                    borderColor: '#EF4444',
                    color: '#fff',
                  }}
                >
                  {reversing ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: MANUAL DOUBLE-ENTRY JOURNAL POSTING                              */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {showManualModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
              width: '100%',
              maxWidth: '540px',
              padding: '1.5rem',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📖</span>
                <span>Post Double-Entry Journal Entry</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitManualEntry} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Currency *
                  </label>
                  <select
                    value={manualForm.currency}
                    onChange={(e) => setManualForm({ ...manualForm, currency: e.target.value, debitAccountId: '', creditAccountId: '' })}
                    className="select"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="IRR">IRR (Toman)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Transaction Type *
                  </label>
                  <select
                    value={manualForm.transactionType}
                    onChange={(e) => setManualForm({ ...manualForm, transactionType: e.target.value as any })}
                    className="select"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  >
                    <option value="ADJUSTMENT">ADJUSTMENT</option>
                    <option value="ORDER_REVENUE">ORDER_REVENUE</option>
                    <option value="PLATFORM_FEE">PLATFORM_FEE</option>
                    <option value="BOOSTER_PAYOUT">BOOSTER_PAYOUT</option>
                    <option value="DEPOSIT">DEPOSIT</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#38BDF8', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                    Debit Account (Dr) *
                  </label>
                  <select
                    required
                    value={manualForm.debitAccountId}
                    onChange={(e) => setManualForm({ ...manualForm, debitAccountId: e.target.value })}
                    className="select"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="">Select Account</option>
                    {filteredAccountsForManual.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.formattedAvailable})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', color: '#34D399', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                    Credit Account (Cr) *
                  </label>
                  <select
                    required
                    value={manualForm.creditAccountId}
                    onChange={(e) => setManualForm({ ...manualForm, creditAccountId: e.target.value })}
                    className="select"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="">Select Account</option>
                    {filteredAccountsForManual.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.formattedAvailable})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Amount ({manualForm.currency === 'USD' ? 'USD Dollars' : 'Tomans'}) *
                  </label>
                  <input
                    type="number"
                    step={manualForm.currency === 'USD' ? '0.01' : '1'}
                    min={manualForm.currency === 'USD' ? '0.01' : '1'}
                    required
                    placeholder={manualForm.currency === 'USD' ? '100.00' : '1000000'}
                    value={manualForm.amount}
                    onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                    className="input"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Reference ID (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ORD-..., INV-..."
                    value={manualForm.referenceId}
                    onChange={(e) => setManualForm({ ...manualForm, referenceId: e.target.value })}
                    className="input"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Description / Justification
                </label>
                <input
                  type="text"
                  placeholder="Reason for double-entry posting..."
                  value={manualForm.description}
                  onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                  className="input"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowManualModal(false)}
                  disabled={submittingManual}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={submittingManual}
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingManual ? 'Posting...' : 'Post Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
