import React, { useState, useEffect, useCallback } from 'react';
import {
  FinancialAuditLogItem,
  UserFinancialRoleInfo,
} from '../../types/financialLedger';
import { FinancialAccountItem } from '../../types/financialAccounts';
import {
  fetchFinancialAuditLogs,
  downloadLedgerCsv,
} from '../../services/financialLedger';

interface Props {
  accounts: FinancialAccountItem[];
  userRole?: UserFinancialRoleInfo | null;
  onRefreshWorkspace?: () => void;
}

export const FinancialAuditLogsSection: React.FC<Props> = ({
  accounts,
  userRole: _userRole,
  onRefreshWorkspace: _onRefreshWorkspace,
}) => {
  // ─── Audit Log State ────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<FinancialAuditLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ─── Inspect State Diff Modal State ─────────────────────────────────────────
  const [selectedLog, setSelectedLog] = useState<FinancialAuditLogItem | null>(null);

  // Export State
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load Audit Logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchFinancialAuditLogs({
        actionType: actionFilter !== 'all' ? actionFilter : undefined,
        relatedAccountId: accountFilter !== 'all' ? accountFilter : undefined,
        search: searchQuery.trim() || undefined,
        page,
        limit: 15,
      });

      if (res && res.logs) {
        setLogs(res.logs);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      }
    } catch (err: any) {
      console.warn('[FinancialAuditLogs] Failed to load audit logs:', err);
      setErrorMsg(err.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, accountFilter, searchQuery, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // CSV Export
  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await downloadLedgerCsv('audit', {
        actionType: actionFilter !== 'all' ? actionFilter : '',
        relatedAccountId: accountFilter !== 'all' ? accountFilter : '',
      });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingCsv(false);
    }
  };

  // Helper to resolve account name
  const getAccountName = (accId: string | null) => {
    if (!accId) return '—';
    const acc = accounts.find((a) => a.id === accId);
    return acc ? acc.name : accId.slice(0, 8) + '...';
  };

  // Action Badge Color Helper
  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'TRANSACTION_REVERSED':
        return { bg: 'rgba(239, 68, 68, 0.2)', text: '#F87171' };
      case 'WITHDRAWAL_SETTLED':
      case 'DISCREPANCY_RESOLVED':
        return { bg: 'rgba(52, 211, 153, 0.2)', text: '#34D399' };
      case 'BALANCE_ADJUSTED':
      case 'RATE_CHANGED':
        return { bg: 'rgba(245, 158, 11, 0.2)', text: '#FBBF24' };
      case 'TRANSFER_EXECUTED':
      case 'ACCOUNT_CREATED':
        return { bg: 'rgba(139, 92, 246, 0.2)', text: '#C4B5FD' };
      case 'WITHDRAWAL_REQUESTED':
        return { bg: 'rgba(56, 189, 248, 0.2)', text: '#38BDF8' };
      case 'RECONCILIATION_PERFORMED':
        return { bg: 'rgba(167, 139, 250, 0.2)', text: '#DDD6FE' };
      default:
        return { bg: 'rgba(255, 255, 255, 0.08)', text: 'var(--text-secondary)' };
    }
  };

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
            <span style={{ fontSize: '1.5rem' }}>🛡️</span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              Financial Audit Logs
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
              Append-Only Immutability
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', margin: '6px 0 0 0' }}>
            Permanent, tamper-proof administrative audit trail tracking account modifications, balance adjustments, transfers, rate updates, reversals, and reconciliation events.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadLogs}
            disabled={loading}
          >
            ↻ Refresh Logs
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleExportCsv}
            disabled={exportingCsv}
          >
            📥 Export Audit CSV
          </button>
        </div>
      </div>

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
      {/* AUDIT LOG TABLE & FILTERS                                                 */}
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
              Audit Trail Records
            </h4>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Total {totalCount} administrative audit entries recorded
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search ref, admin, reason..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="input"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', width: '200px' }}
            />

            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            >
              <option value="all">All Action Types</option>
              <option value="ACCOUNT_CREATED">Account Created</option>
              <option value="ACCOUNT_UPDATED">Account Updated</option>
              <option value="BALANCE_ADJUSTED">Balance Adjusted</option>
              <option value="TRANSFER_EXECUTED">Transfer Executed</option>
              <option value="WITHDRAWAL_REQUESTED">Withdrawal Requested</option>
              <option value="WITHDRAWAL_SETTLED">Withdrawal Settled</option>
              <option value="WITHDRAWAL_REJECTED">Withdrawal Rejected</option>
              <option value="RATE_CHANGED">Exchange Rate Changed</option>
              <option value="TRANSACTION_REVERSED">Transaction Reversed</option>
              <option value="RECONCILIATION_PERFORMED">Reconciliation Performed</option>
              <option value="DISCREPANCY_RESOLVED">Discrepancy Resolved</option>
            </select>

            <select
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value);
                setPage(1);
              }}
              className="select"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', maxWidth: '180px' }}
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
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Action Type</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Admin / Operator</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Related Account</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Transaction ID</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Reason / Details</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>IP Address</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Timestamp</th>
                <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem' }}>State Diff</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading financial audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No financial audit log entries found matching the criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const badge = getActionBadgeColor(log.actionType);
                  const hasStateDiff = Boolean(log.previousState || log.newState);

                  return (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        transition: 'background-color 0.1s ease',
                      }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, fontFamily: 'monospace', color: '#fff' }}>
                        {log.logRef}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            backgroundColor: badge.bg,
                            color: badge.text,
                          }}
                        >
                          {log.actionType}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#fff', fontWeight: 600 }}>
                        {log.adminUsername || log.adminId || 'System / Automated'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#C4B5FD' }}>
                        {getAccountName(log.relatedAccountId)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {log.transactionId ? log.transactionId.slice(0, 12) + '...' : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)', maxWidth: '240px' }}>
                        {log.reason || '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {log.ipAddress || '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        {hasStateDiff ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => setSelectedLog(log)}
                            style={{
                              borderColor: 'rgba(139, 92, 246, 0.4)',
                              color: '#C4B5FD',
                            }}
                          >
                            Inspect Diff
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
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
      {/* MODAL: INSPECT STATE DIFF                                                 */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {selectedLog && (
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
              maxWidth: '750px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '1.5rem',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🔍</span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  Audit State Diff — {selectedLog.logRef}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Action:</span>
                <strong style={{ color: '#C4B5FD' }}>{selectedLog.actionType}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Admin:</span>
                <strong style={{ color: '#fff' }}>{selectedLog.adminUsername || selectedLog.adminId || 'System'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Timestamp:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{new Date(selectedLog.createdAt).toLocaleString()}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Reason:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{selectedLog.reason || 'None specified'}</span>
              </div>
            </div>

            {/* Side-by-Side Diff */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Previous State */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#F87171', textTransform: 'uppercase' }}>
                  Previous State
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '0.75rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: '#FCA5A5',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    minHeight: '140px',
                  }}
                >
                  {selectedLog.previousState
                    ? JSON.stringify(selectedLog.previousState, null, 2)
                    : '(Initial / None)'}
                </pre>
              </div>

              {/* New State */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34D399', textTransform: 'uppercase' }}>
                  New State
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '0.75rem',
                    backgroundColor: 'rgba(52, 211, 153, 0.05)',
                    border: '1px solid rgba(52, 211, 153, 0.2)',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: '#6EE7B7',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    minHeight: '140px',
                  }}
                >
                  {selectedLog.newState
                    ? JSON.stringify(selectedLog.newState, null, 2)
                    : '(None)'}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedLog(null)}
              >
                Close Diff Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
