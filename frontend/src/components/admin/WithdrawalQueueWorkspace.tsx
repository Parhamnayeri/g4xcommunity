import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  LoadingState,
  DataTable,
  Column,
  StatusBadge,
  Modal,
  Input,
  Textarea,
} from '../ui';
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
  const [decision, setDecision] = useState<'approve_processing' | 'approve_paid' | 'reject'>('approve_processing');
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

  const columns: Column<WithdrawalItem>[] = [
    {
      key: 'withdrawalRef',
      header: 'Ref / Date',
      render: (w) => (
        <div>
          <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{w.withdrawalRef}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {new Date(w.createdAt).toLocaleDateString()}
          </div>
        </div>
      ),
    },
    {
      key: 'boosterName',
      header: 'Booster',
      render: (w) => (
        <div>
          <div style={{ fontWeight: 600 }}>{w.boosterName}</div>
          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{w.boosterId}</div>
        </div>
      ),
    },
    {
      key: 'payoutMethod',
      header: 'Method',
      render: (w) => (
        <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
          {w.payoutMethod}
        </span>
      ),
    },
    {
      key: 'requestedAmount',
      header: 'Requested / Net',
      numeric: true,
      render: (w) => (
        <div style={{ fontWeight: 700, color: 'var(--accent-lime)' }}>
          ${(w.requestedUsdCents ? w.requestedUsdCents / 100 : w.requestedUsd || 0).toFixed(2)}
        </div>
      ),
    },
    {
      key: 'destinationAddress',
      header: 'Destination',
      truncate: true,
      render: (w) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {w.destinationAddress
            ? `${w.destinationAddress.slice(0, 10)}...${w.destinationAddress.slice(-6)}`
            : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (w) => <StatusBadge status={w.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (w) => (
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
                setDecision('approve_processing');
                setTxHash('');
                setReviewNotes('');
                setReviewFeedback(null);
              }}
            >
              Review &amp; Payout
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', margin: '0.25rem 0 0' }}>{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadWithdrawals}>
          ↻ Refresh Queue
        </Button>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'var(--status-danger-bg)', color: 'var(--status-danger)', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}

      {/* Withdrawals DataTable */}
      <DataTable
        columns={columns}
        data={withdrawals}
        keyExtractor={(w) => w.id}
        isLoading={loading}
        emptyTitle="No booster withdrawal requests currently in queue."
        emptyMessage="Any pending payout requests submitted by boosters will appear here for operational verification."
      />

      {/* Review & Payout Modal (Admin/Owner only) */}
      {selectedWithdrawal && canReview && (
        <Modal
          isOpen={Boolean(selectedWithdrawal && canReview)}
          onClose={() => {
            setSelectedWithdrawal(null);
            setReviewFeedback(null);
          }}
          title={`Execute Payout Decision #${selectedWithdrawal.id}`}
          maxWidth="540px"
          footer={
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedWithdrawal(null);
                  setReviewFeedback(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                disabled={submittingReview || (decision === 'reject' && reviewNotes.trim().length < 5)}
                onClick={async () => {
                  setSubmittingReview(true);
                  setReviewFeedback(null);
                  try {
                    await reviewAdminWithdrawal(selectedWithdrawal.id, decision, {
                      txHash: decision === 'approve_paid' ? txHash.trim() : undefined,
                      notes: reviewNotes.trim() || undefined,
                      reason: decision === 'reject' ? reviewNotes.trim() : undefined,
                    });
                    setReviewFeedback({ text: 'Withdrawal review recorded successfully.', type: 'success' });
                    setTimeout(() => {
                      setSelectedWithdrawal(null);
                      loadWithdrawals();
                    }, 800);
                  } catch (err: any) {
                    setReviewFeedback({ text: err.message || 'Operation failed', type: 'error' });
                  } finally {
                    setSubmittingReview(false);
                  }
                }}
              >
                {submittingReview ? 'Submitting...' : 'Confirm Decision'}
              </Button>
            </div>
          }
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface-raised)',
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.25rem',
              fontSize: 'var(--font-size-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div>Booster: <strong>{selectedWithdrawal.boosterName}</strong></div>
            <div>Method: <strong>{selectedWithdrawal.payoutMethod}</strong></div>
            <div>
              Requested Amount:{' '}
              <strong style={{ color: 'var(--accent-lime)' }}>
                ${(selectedWithdrawal.requestedUsdCents ? selectedWithdrawal.requestedUsdCents / 100 : selectedWithdrawal.requestedUsd || 0).toFixed(2)} USD
              </strong>
            </div>
            <div>Destination: <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedWithdrawal.destinationAddress}</span></div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
              <input
                type="radio"
                name="decision"
                checked={decision === 'approve_processing'}
                onChange={() => setDecision('approve_processing')}
              />
              Approve for Manual Transfer (Processing)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
              <input
                type="radio"
                name="decision"
                checked={decision === 'approve_paid'}
                onChange={() => setDecision('approve_paid')}
              />
              Confirm Disbursement (Paid + Tx Proof)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
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
              <Input
                label="Transaction Hash / Payment Proof Reference"
                placeholder="e.g. 0xabc... or Bank Transfer Ref"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
              />
            </div>
          )}

          <Textarea
            label={decision === 'reject' ? 'Rejection Reason * (Min 5 chars)' : 'Reviewer Notes (Optional)'}
            required={decision === 'reject'}
            minLength={decision === 'reject' ? 5 : undefined}
            placeholder={
              decision === 'reject'
                ? 'State the reason for rejecting this withdrawal...'
                : 'Administrative notes or disbursement references...'
            }
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
          />

          {reviewFeedback && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                backgroundColor: reviewFeedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                color: reviewFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
              }}
            >
              {reviewFeedback.text}
            </div>
          )}
        </Modal>
      )}

      {/* Edit Metadata Modal */}
      {metadataItem && canEditMetadata && (
        <Modal
          isOpen={Boolean(metadataItem && canEditMetadata)}
          onClose={() => setMetadataItem(null)}
          title={`Update Metadata: ${metadataItem.withdrawalRef}`}
          maxWidth="540px"
          footer={
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
              <Button variant="outline" size="sm" onClick={() => setMetadataItem(null)}>
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                disabled={submittingMeta || metaReason.trim().length < 5}
                onClick={async () => {
                  setSubmittingMeta(true);
                  setMetaFeedback(null);
                  try {
                    await updateWithdrawalMetadata(metadataItem.id, {
                      notes: metaNotes.trim() || undefined,
                      adminNotes: metaAdminNotes.trim() || undefined,
                      reason: metaReason.trim(),
                    });
                    setMetaFeedback({ text: 'Metadata updated successfully.', type: 'success' });
                    setTimeout(() => {
                      setMetadataItem(null);
                      loadWithdrawals();
                    }, 800);
                  } catch (err: any) {
                    setMetaFeedback({ text: err.message || 'Update failed', type: 'error' });
                  } finally {
                    setSubmittingMeta(false);
                  }
                }}
              >
                {submittingMeta ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Textarea
              label="Booster Visible Notes"
              placeholder="Notes visible to the booster..."
              value={metaNotes}
              onChange={(e) => setMetaNotes(e.target.value)}
            />

            <Textarea
              label="Internal Admin Notes"
              placeholder="Internal notes visible only to operations staff..."
              value={metaAdminNotes}
              onChange={(e) => setMetaAdminNotes(e.target.value)}
            />

            <Input
              required
              minLength={5}
              label="Audit Reason * (Min 5 chars)"
              placeholder="Mandatory reason for this administrative update..."
              value={metaReason}
              onChange={(e) => setMetaReason(e.target.value)}
            />

            {metaFeedback && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  backgroundColor: metaFeedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                  color: metaFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                }}
              >
                {metaFeedback.text}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Audit History Modal */}
      {historyItem && (
        <Modal
          isOpen={Boolean(historyItem)}
          onClose={() => setHistoryItem(null)}
          title={`Disbursement Audit Trail: ${historyItem.withdrawalRef}`}
          maxWidth="680px"
          footer={
            <Button variant="outline" size="sm" onClick={() => setHistoryItem(null)}>
              Close Audit Trail
            </Button>
          }
        >
          {loadingHistory ? (
            <LoadingState message="Fetching immutable audit history..." />
          ) : historyError ? (
            <div style={{ color: 'var(--status-danger)' }}>{historyError}</div>
          ) : auditHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              No audit logs recorded for this withdrawal request.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {auditHistory.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '0.85rem',
                    backgroundColor: 'var(--bg-surface-raised)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.action}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {new Date(h.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--font-size-xs)', margin: '0.25rem 0', color: 'var(--text-muted)' }}>
                    Reason: <em>{h.reason || 'No specific note entered.'}</em>
                  </p>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Actor: {h.actor?.displayName || h.actor?.username || 'Automated Engine'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
};
