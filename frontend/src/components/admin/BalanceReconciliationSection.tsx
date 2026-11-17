import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BalanceReconciliationItem,
  UserFinancialRoleInfo,
} from '../../types/financialLedger';
import { FinancialAccountItem } from '../../types/financialAccounts';
import {
  fetchBalanceReconciliations,
  performBalanceReconciliation,
  resolveReconciliationDiscrepancy,
} from '../../services/financialLedger';

interface Props {
  accounts: FinancialAccountItem[];
  userRole?: UserFinancialRoleInfo | null;
  onRefreshWorkspace?: () => void;
}

export const BalanceReconciliationSection: React.FC<Props> = ({
  accounts,
  userRole: _userRole,
  onRefreshWorkspace,
}) => {
  // ─── Reconciliation List State ──────────────────────────────────────────────
  const [reconciliations, setReconciliations] = useState<BalanceReconciliationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // ─── Perform Reconciliation Modal State ─────────────────────────────────────
  const [showReconcileModal, setShowReconcileModal] = useState<boolean>(false);
  const [submittingReconcile, setSubmittingReconcile] = useState<boolean>(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [actualBalanceInput, setActualBalanceInput] = useState<string>('');
  const [reconcileNotes, setReconcileNotes] = useState<string>('');
  const [reconcileAttachment, setReconcileAttachment] = useState<string>('');

  // ─── Resolve Discrepancy Modal State ────────────────────────────────────────
  const [resolvingItem, setResolvingItem] = useState<BalanceReconciliationItem | null>(null);
  const [submittingResolve, setSubmittingResolve] = useState<boolean>(false);
  const [resolveReason, setResolveReason] = useState<string>('');
  const [resolveNotes, setResolveNotes] = useState<string>('');
  const [resolveAttachment, setResolveAttachment] = useState<string>('');

  // Feedback states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  // Load Reconciliations
  const loadReconciliations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBalanceReconciliations({
        accountId: accountFilter !== 'all' ? accountFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        page,
        limit: 15,
      });

      if (res && res.reconciliations) {
        setReconciliations(res.reconciliations);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      }
    } catch (err: any) {
      console.warn('[Reconciliation] Failed to load reconciliations:', err);
    } finally {
      setLoading(false);
    }
  }, [accountFilter, statusFilter, page]);

  useEffect(() => {
    loadReconciliations();
  }, [loadReconciliations]);

  // Selected account object for live discrepancy preview in modal
  const targetAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId);
  }, [accounts, selectedAccountId]);

  // Calculated discrepancy preview
  const discrepancyPreview = useMemo(() => {
    if (!targetAccount) return null;
    const actualVal = parseFloat(actualBalanceInput);
    if (isNaN(actualVal)) return null;

    const actualMinor = targetAccount.currency === 'USD' ? Math.round(actualVal * 100) : Math.round(actualVal);
    const systemMinor = targetAccount.currentBalance;
    const diff = actualMinor - systemMinor;

    return {
      actualMinor,
      systemMinor,
      diff,
      formattedDiff: targetAccount.currency === 'USD'
        ? `${diff >= 0 ? '+' : ''}$${(diff / 100).toFixed(2)}`
        : `${diff >= 0 ? '+' : ''}${diff.toLocaleString()} Tomans`,
      isBalanced: diff === 0,
    };
  }, [targetAccount, actualBalanceInput]);

  // Handle Submit Reconciliation
  const handleSubmitReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) {
      setErrorMsg('Please select an account to reconcile');
      return;
    }
    const actualVal = parseFloat(actualBalanceInput);
    if (isNaN(actualVal) || actualVal < 0) {
      setErrorMsg('Please enter a valid non-negative actual verified balance');
      return;
    }

    setSubmittingReconcile(true);
    try {
      const actualMinor = targetAccount?.currency === 'USD'
        ? Math.round(actualVal * 100)
        : Math.round(actualVal);

      const res = await performBalanceReconciliation({
        accountId: selectedAccountId,
        actualBalanceMinor: actualMinor,
        notes: reconcileNotes.trim() || undefined,
        attachmentUrl: reconcileAttachment.trim() || undefined,
      });

      setSuccessMsg(res.message);
      setShowReconcileModal(false);
      setSelectedAccountId('');
      setActualBalanceInput('');
      setReconcileNotes('');
      setReconcileAttachment('');
      loadReconciliations();
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to perform balance reconciliation');
    } finally {
      setSubmittingReconcile(false);
    }
  };

  // Handle Resolve Discrepancy
  const handleExecuteResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingItem) return;
    if (!resolveReason.trim()) {
      setErrorMsg('An explicit reason/justification is required to resolve discrepancy');
      return;
    }

    setSubmittingResolve(true);
    try {
      const res = await resolveReconciliationDiscrepancy(resolvingItem.id, {
        reason: resolveReason.trim(),
        notes: resolveNotes.trim() || undefined,
        attachmentUrl: resolveAttachment.trim() || undefined,
      });

      setSuccessMsg(res.message);
      setResolvingItem(null);
      setResolveReason('');
      setResolveNotes('');
      setResolveAttachment('');
      loadReconciliations();
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resolve discrepancy');
    } finally {
      setSubmittingResolve(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* HEADER & RECONCILE ACTION                                                 */}
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
            <span style={{ fontSize: '1.5rem' }}>⚖️</span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              Balance Reconciliation &amp; Discrepancy Audit
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
              Phase 4 Financial Integrity
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: '6px 0 0 0' }}>
            Periodic audit comparison between System Balance and Actual Verified Balance across all 5 platform accounts, USD wallets, and Toman banks.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadReconciliations}
            disabled={loading}
          >
            ↻ Refresh
          </button>

          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => {
              setSelectedAccountId(accounts.length > 0 ? accounts[0].id : '');
              setShowReconcileModal(true);
            }}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              color: '#fff',
            }}
          >
            ⚖️ Perform Reconciliation Check
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
      {/* RECONCILIATIONS AUDIT HISTORY TABLE                                       */}
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
              Historical Reconciliation Audit Records
            </h4>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Total {totalCount} reconciliation comparisons
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            >
              <option value="all">All Statuses</option>
              <option value="BALANCED">Balanced (0 Difference)</option>
              <option value="DISCREPANCY">Discrepancy Detected</option>
              <option value="ADJUSTED">Adjusted &amp; Resolved</option>
            </select>

            <select
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', maxWidth: '200px' }}
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
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Audit Ref</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Account</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>System Balance</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Actual Verified</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Difference</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Admin / Notes</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Reconciled Date</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading reconciliation records...
                  </td>
                </tr>
              ) : reconciliations.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No reconciliation records recorded yet.
                  </td>
                </tr>
              ) : (
                reconciliations.map((r) => {
                  const hasDiff = r.differenceMinor !== 0;
                  const isAdjusted = r.status === 'ADJUSTED';

                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        backgroundColor:
                          hasDiff && !isAdjusted ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>
                        {r.reconciliationRef}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: '#C4B5FD' }}>
                        {r.accountName}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {r.formattedSystemBalance}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>
                        {r.formattedActualBalance}
                      </td>
                      <td
                        style={{
                          padding: '0.6rem 0.75rem',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 800,
                          color: hasDiff ? (r.differenceMinor > 0 ? '#34D399' : '#F87171') : 'var(--text-muted)',
                        }}
                      >
                        {r.formattedDifference}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 800,
                            backgroundColor:
                              r.status === 'BALANCED'
                                ? 'rgba(52, 211, 153, 0.15)'
                                : r.status === 'ADJUSTED'
                                ? 'rgba(139, 92, 246, 0.2)'
                                : 'rgba(239, 68, 68, 0.2)',
                            color:
                              r.status === 'BALANCED'
                                ? '#34D399'
                                : r.status === 'ADJUSTED'
                                ? '#C4B5FD'
                                : '#F87171',
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', maxWidth: '200px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#fff' }}>
                          {r.adminUsername || r.adminId || 'System'}
                        </div>
                        {r.notes && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.notes}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(r.reconciliationDate).toLocaleDateString()} {new Date(r.reconciliationDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        {hasDiff && !isAdjusted ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => {
                              setResolvingItem(r);
                              setResolveReason(`Resolve reconciliation discrepancy on ${r.accountName} (${r.formattedDifference})`);
                            }}
                            style={{
                              borderColor: 'rgba(139, 92, 246, 0.4)',
                              color: '#C4B5FD',
                            }}
                          >
                            Resolve Discrepancy
                          </button>
                        ) : isAdjusted ? (
                          <span style={{ fontSize: '0.7rem', color: '#A78BFA' }}>
                            Adjusted ✓
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#34D399' }}>
                            Match ✓
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
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
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: PERFORM RECONCILIATION CHECK                                    */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {showReconcileModal && (
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
              maxWidth: '520px',
              padding: '1.5rem',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>⚖️</span>
                <span>Perform Balance Reconciliation</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowReconcileModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Enter the verified external statement balance. Reconciliation audits the account and flags discrepancies without automatically modifying the balance.
            </p>

            <form onSubmit={handleSubmitReconcile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Target Financial Account *
                </label>
                <select
                  required
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="select"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency}) — Current: {a.formattedCurrent}
                    </option>
                  ))}
                </select>
              </div>

              {targetAccount && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      System Balance
                    </span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                      {targetAccount.formattedCurrent}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Currency
                    </span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#C4B5FD' }}>
                      {targetAccount.currency}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Actual Verified Balance ({targetAccount?.currency === 'USD' ? 'USD Dollars' : 'Tomans'}) *
                </label>
                <input
                  type="number"
                  step={targetAccount?.currency === 'USD' ? '0.01' : '1'}
                  min="0"
                  required
                  placeholder={targetAccount?.currency === 'USD' ? '500.00' : '10000000'}
                  value={actualBalanceInput}
                  onChange={(e) => setActualBalanceInput(e.target.value)}
                  className="input"
                  style={{ width: '100%', fontSize: '0.9rem', fontFamily: 'monospace' }}
                />
              </div>

              {discrepancyPreview && (
                <div
                  style={{
                    padding: '0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${discrepancyPreview.isBalanced ? 'rgba(52, 211, 153, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                    backgroundColor: discrepancyPreview.isBalanced ? 'rgba(52, 211, 153, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: discrepancyPreview.isBalanced ? '#34D399' : '#F87171' }}>
                    {discrepancyPreview.isBalanced ? '✓ Zero Discrepancy (Perfect Match)' : '⚠️ Discrepancy Preview:'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: discrepancyPreview.isBalanced ? '#34D399' : '#F87171' }}>
                    {discrepancyPreview.formattedDiff}
                  </span>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Audit Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Statement date, external ref, or bank reconciliation details..."
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                  className="textarea"
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Supporting Statement / Attachment URL
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={reconcileAttachment}
                  onChange={(e) => setReconcileAttachment(e.target.value)}
                  className="input"
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowReconcileModal(false)}
                  disabled={submittingReconcile}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={submittingReconcile}
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingReconcile ? 'Recording...' : 'Audit Balance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: RESOLVE DISCREPANCY VIA BALANCING ADJUSTMENT                     */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {resolvingItem && (
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
              maxWidth: '520px',
              padding: '1.5rem',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#C4B5FD', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>⚖️</span>
                <span>Resolve Discrepancy via Adjustment</span>
              </h3>
              <button
                type="button"
                onClick={() => setResolvingItem(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '0.85rem', backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Target Account:</span>
                <strong style={{ color: '#fff' }}>{resolvingItem.accountName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Discrepancy to Adjust:</span>
                <strong style={{ fontFamily: 'monospace', color: resolvingItem.differenceMinor > 0 ? '#34D399' : '#F87171' }}>
                  {resolvingItem.formattedDifference}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Adjustment Direction:</span>
                <strong style={{ color: resolvingItem.differenceMinor > 0 ? '#34D399' : '#F87171' }}>
                  {resolvingItem.differenceMinor > 0 ? 'CREDIT (+)' : 'DEBIT (-)'}
                </strong>
              </div>
            </div>

            <form onSubmit={handleExecuteResolve} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Required Justification / Reason *
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Explain why this adjustment is being made to align balances..."
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  className="textarea"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Audit Resolution Notes
                </label>
                <input
                  type="text"
                  placeholder="Additional supervisor or banking notes..."
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  className="input"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Receipt / Supporting Attachment URL
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={resolveAttachment}
                  onChange={(e) => setResolveAttachment(e.target.value)}
                  className="input"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setResolvingItem(null)}
                  disabled={submittingResolve}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={submittingResolve}
                  style={{
                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingResolve ? 'Applying Adjustment...' : 'Apply Balancing Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
