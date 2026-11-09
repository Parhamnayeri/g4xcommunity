import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  fetchAdminWithdrawals,
  reviewAdminWithdrawal,
  updateWithdrawalMetadata,
  fetchWithdrawalAuditHistory,
} from '../../services/adminPortal';

interface WithdrawalItem {
  id: number;
  withdrawalRef: string;
  boosterId: string;
  boosterName: string;
  payoutMethod: string;
  status: string;
  requestedUsd: number;
  requestedUsdCents?: number;
  netUsd: number;
  destinationAddress: string;
  createdAt: string;
  notes?: string | null;
  adminNotes?: string | null;
}

interface AuditRecord {
  id: number;
  action: string;
  reason: string | null;
  createdAt: string;
  details: any;
  actor: { id: string; username: string; displayName: string | null } | null;
}

interface Props {
  canReview?: boolean;
  canEditMetadata?: boolean;
  title?: string;
  subtitle?: string;
}

export const WithdrawalQueueWorkspace: React.FC<Props> = ({
  canReview = false,
  canEditMetadata = false,
  title = 'Booster Withdrawal Queue',
  subtitle = 'Inspect reserved booster payout requests and authoritative disbursement proofs.',
}) => {
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review Modal State
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalItem | null>(null);
  const [decision, setDecision] = useState<'approve_paid' | 'reject'>('approve_paid');
  const [txHash, setTxHash] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Metadata Edit Modal State
  const [metadataItem, setMetadataItem] = useState<WithdrawalItem | null>(null);
  const [metaNotes, setMetaNotes] = useState('');
  const [metaAdminNotes, setMetaAdminNotes] = useState('');
  const [metaReason, setMetaReason] = useState('');
  const [submittingMeta, setSubmittingMeta] = useState(false);
  const [metaFeedback, setMetaFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Audit History Modal State
  const [historyItem, setHistoryItem] = useState<WithdrawalItem | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadWithdrawals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminWithdrawals();
      setWithdrawals(Array.isArray(data?.withdrawals) ? data.withdrawals : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load booster withdrawals queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWithdrawals();
  }, [loadWithdrawals]);

  const handleOpenHistory = async (w: WithdrawalItem) => {
    setHistoryItem(w);
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetchWithdrawalAuditHistory(w.id);
      setAuditHistory(res.history || []);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to fetch withdrawal audit history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenMetadataEdit = (w: WithdrawalItem) => {
    setMetadataItem(w);
    setMetaNotes(w.notes || '');
    setMetaAdminNotes(w.adminNotes || '');
    setMetaReason('');
    setMetaFeedback(null);
  };

  return (
    <div className="card-surface" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{subtitle}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={loadWithdrawals}>
          ↻ Refresh Queue
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--status-danger)', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading withdrawal requests..." />
      ) : withdrawals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No booster withdrawal requests currently in queue.
        </div>
      ) : (
        <div className="table-responsive-container" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>Ref / Date</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Booster</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Method</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Requested / Net</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Destination</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
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
                    <div style={{ fontWeight: 600 }}>{w.boosterName}</div>
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
                    <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                        onClick={() => handleOpenHistory(w)}
                        title="View audit history"
                      >
                        📜 History
                      </button>
                      {canEditMetadata && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                          onClick={() => handleOpenMetadataEdit(w)}
                          title="Edit administrative notes"
                        >
                          ✏️ Notes
                        </button>
                      )}
                      {canReview && (
                        <button
                          type="button"
                          className="btn btn-cta btn-sm"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                          onClick={() => {
                            setSelectedWithdrawal(w);
                            setDecision('approve_paid');
                            setTxHash('');
                            setReviewNotes('');
                            setReviewFeedback(null);
                          }}
                        >
                          Review &amp; Payout
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review & Payout Modal (Admin/Owner only) */}
      {selectedWithdrawal && canReview && (
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
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Execute Payout Decision #{selectedWithdrawal.id}
            </h3>
            <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <div>Booster: <strong>{selectedWithdrawal.boosterName}</strong></div>
              <div>Method: <strong>{selectedWithdrawal.payoutMethod}</strong></div>
              <div>Requested Amount: <strong style={{ color: 'var(--accent-lime)' }}>${(selectedWithdrawal.requestedUsdCents ? selectedWithdrawal.requestedUsdCents / 100 : selectedWithdrawal.requestedUsd || 0).toFixed(2)} USD</strong></div>
              <div>Destination: <span style={{ fontFamily: 'monospace' }}>{selectedWithdrawal.destinationAddress}</span></div>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="decision"
                  checked={decision === 'approve_paid'}
                  onChange={() => setDecision('approve_paid')}
                />
                Confirm Disbursement
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="decision"
                  checked={decision === 'reject'}
                  onChange={() => setDecision('reject')}
                />
                Reject &amp; Refund Reserve
              </label>
            </div>

            {decision === 'approve_paid' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Transaction Hash / Payment Proof Reference
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 0xabc... or Bank Transfer Ref"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
                />
              </div>
            )}

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Reviewer Notes {decision === 'reject' && <span style={{ color: 'var(--status-danger)' }}>* (Required)</span>}
              </label>
              <textarea
                className="input"
                rows={2}
                placeholder="Authoritative audit notes..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            {reviewFeedback && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                  backgroundColor: reviewFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: reviewFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                }}
              >
                {reviewFeedback.text}
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
                disabled={submittingReview || (decision === 'reject' && !reviewNotes.trim())}
                className="btn btn-cta btn-sm"
                onClick={async () => {
                  setSubmittingReview(true);
                  setReviewFeedback(null);
                  try {
                    await reviewAdminWithdrawal(selectedWithdrawal.id, decision, {
                      txHash: txHash.trim() || undefined,
                      reason: reviewNotes.trim() || undefined,
                      notes: reviewNotes.trim() || undefined,
                    });
                    setReviewFeedback({ text: 'Payout decision recorded successfully.', type: 'success' });
                    setTimeout(() => {
                      setSelectedWithdrawal(null);
                      loadWithdrawals();
                    }, 800);
                  } catch (err: any) {
                    setReviewFeedback({ text: err.message || 'Payout decision execution failed', type: 'error' });
                  } finally {
                    setSubmittingReview(false);
                  }
                }}
              >
                {submittingReview ? 'Executing...' : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Edit Modal (Admin/Owner only) */}
      {metadataItem && canEditMetadata && (
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
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Edit Withdrawal Metadata #{metadataItem.id}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Ref: <strong>{metadataItem.withdrawalRef}</strong> — Financial amounts and balances cannot be edited here.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Operational Notes
              </label>
              <textarea
                className="input"
                rows={2}
                value={metaNotes}
                onChange={(e) => setMetaNotes(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Internal Admin Notes
              </label>
              <textarea
                className="input"
                rows={2}
                value={metaAdminNotes}
                onChange={(e) => setMetaAdminNotes(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Audit Reason <span style={{ color: 'var(--status-danger)' }}>* (Min 5 chars required)</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="Reason for modifying metadata..."
                value={metaReason}
                onChange={(e) => setMetaReason(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            {metaFeedback && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                  backgroundColor: metaFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: metaFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                }}
              >
                {metaFeedback.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setMetadataItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingMeta || metaReason.trim().length < 5}
                className="btn btn-cta btn-sm"
                onClick={async () => {
                  setSubmittingMeta(true);
                  setMetaFeedback(null);
                  try {
                    await updateWithdrawalMetadata(metadataItem.id, {
                      notes: metaNotes.trim() || undefined,
                      adminNotes: metaAdminNotes.trim() || undefined,
                      reason: metaReason.trim(),
                    });
                    setMetaFeedback({ text: 'Metadata updated with immutable audit log.', type: 'success' });
                    setTimeout(() => {
                      setMetadataItem(null);
                      loadWithdrawals();
                    }, 800);
                  } catch (err: any) {
                    setMetaFeedback({ text: err.message || 'Failed to update metadata', type: 'error' });
                  } finally {
                    setSubmittingMeta(false);
                  }
                }}
              >
                {submittingMeta ? 'Saving...' : 'Save Metadata'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {historyItem && (
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
          <div className="card-surface" style={{ maxWidth: '650px', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Withdrawal #{historyItem.id} Audit History
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHistoryItem(null)}
              >
                ✕ Close
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Ref: <strong>{historyItem.withdrawalRef}</strong> — Booster: {historyItem.boosterName}
            </p>

            {loadingHistory ? (
              <LoadingState message="Loading immutable audit events..." />
            ) : historyError ? (
              <div style={{ padding: '1rem', color: 'var(--status-danger)' }}>{historyError}</div>
            ) : auditHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                No recorded audit events for this withdrawal request.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {auditHistory.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      padding: '0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-main)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.84rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span className="badge badge-purple" style={{ fontSize: '0.75rem' }}>
                        {h.action}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ marginBottom: '0.35rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Actor: </span>
                      <strong>{h.actor?.displayName || h.actor?.username || 'Authoritative System'}</strong>{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({h.actor?.id})</span>
                    </div>
                    <div style={{ marginBottom: '0.35rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Reason: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{h.reason || 'No recorded notes'}</span>
                    </div>
                    {h.details && (
                      <pre style={{ margin: '0.35rem 0 0', padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-xs)', fontSize: '0.75rem', overflowX: 'auto' }}>
                        {typeof h.details === 'string' ? h.details : JSON.stringify(h.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
