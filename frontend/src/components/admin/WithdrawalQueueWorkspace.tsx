import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  fetchAdminWithdrawals,
  reviewAdminWithdrawal,
  updateWithdrawalMetadata,
  fetchWithdrawalAuditHistory,
  fetchAdminFinanceOverview,
} from '../../services/adminPortal';
import { AdminFinanceOverviewResponse } from '../../types/adminPortal';

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
  quotedNetPayoutAmount?: string;
  quotedCurrency?: string;
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
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'USDT_BEP20' | 'IRT_BANK'>('ALL');
  const [financeOverview, setFinanceOverview] = useState<AdminFinanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review Modal State
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalItem | null>(null);
  const [decision, setDecision] = useState<'approve_processing' | 'approve_paid' | 'reject'>('approve_processing');
  const [txHash, setTxHash] = useState('');
  const [finalPaidAmount, setFinalPaidAmount] = useState('');
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
      const [wData, fData] = await Promise.all([
        fetchAdminWithdrawals(),
        fetchAdminFinanceOverview().catch(() => null),
      ]);
      setWithdrawals(Array.isArray(wData?.withdrawals) ? wData.withdrawals : []);
      if (fData?.success) {
        setFinanceOverview(fData);
      }
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

      {/* 4-Card Withdrawal & Liquidity Summary Grid */}
      {financeOverview?.totals && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '0.85rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Pending USDT Requests
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent-yellow)', margin: '4px 0 2px' }}>
              {financeOverview.totals.pendingWithdrawalsUsd}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <strong>{financeOverview.totals.pendingWithdrawalsCount}</strong> awaiting review / payout
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Total Paid Out (USDT)
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#34D399', margin: '4px 0 2px' }}>
              {financeOverview.totals.paidWithdrawalsUsd}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <strong>{financeOverview.totals.paidWithdrawalsCount}</strong> settled disbursements
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Booster Wallet Liability
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#A78BFA', margin: '4px 0 2px' }}>
              {financeOverview.totals.boosterWalletLiabilityUsd}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Total unwithdrawn wallet balances
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '14px 16px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Platform Net Liquid Reserve
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#38BDF8', margin: '4px 0 2px' }}>
              {financeOverview.totals.netLiquidReserveUsd}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Liquid margin after pending claims
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--status-danger)', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}

      {/* Payout Method Separation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Payout Method:</span>
        <button
          type="button"
          className={`btn btn-xs ${methodFilter === 'ALL' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMethodFilter('ALL')}
        >
          All ({withdrawals.length})
        </button>
        <button
          type="button"
          className={`btn btn-xs ${methodFilter === 'USDT_BEP20' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMethodFilter('USDT_BEP20')}
        >
          💎 USDT (BEP-20) ({withdrawals.filter((w) => w.payoutMethod === 'USDT_BEP20').length})
        </button>
        <button
          type="button"
          className={`btn btn-xs ${methodFilter === 'IRT_BANK' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMethodFilter('IRT_BANK')}
        >
          🏦 Toman (IRT) ({withdrawals.filter((w) => w.payoutMethod === 'IRT_BANK').length})
        </button>
      </div>

      {loading ? (
        <LoadingState message="Loading withdrawal requests..." />
      ) : withdrawals.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '3rem' }}>
          <span className="empty-state-icon">💸</span>
          <p>No booster withdrawal requests currently in queue.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ref / Date</th>
                <th>Booster</th>
                <th>Method</th>
                <th>Requested / Net</th>
                <th>Destination</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals
                .filter((w) => (methodFilter === 'ALL' ? true : w.payoutMethod === methodFilter))
                .map((w) => (
                <tr key={w.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{w.withdrawalRef}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(w.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{w.boosterName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.boosterId}</div>
                  </td>
                  <td>
                    <span className={`badge ${w.payoutMethod === 'IRT_BANK' ? 'badge-blue' : 'badge-purple'}`} style={{ fontSize: '0.72rem' }}>
                      {w.payoutMethod === 'IRT_BANK' ? '🏦 IRT Bank' : '💎 USDT'}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--accent-yellow)' }}>
                      ${(w.requestedUsdCents ? w.requestedUsdCents / 100 : w.requestedUsd || 0).toFixed(2)}
                    </div>
                    {w.payoutMethod === 'IRT_BANK' && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--status-info)' }}>
                        (Approx. Toman)
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                    {w.destinationAddress ? `${w.destinationAddress.slice(0, 10)}...${w.destinationAddress.slice(-6)}` : '—'}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        w.status === 'PAID'
                          ? 'badge-green'
                          : w.status === 'PROCESSING'
                          ? 'badge-amber'
                          : w.status === 'REJECTED'
                          ? 'badge-danger'
                          : w.status === 'CANCELLED'
                          ? 'badge-muted'
                          : 'badge-purple'
                      }`}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {w.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleOpenHistory(w)}
                        title="View audit history"
                      >
                        📜 History
                      </button>
                      {canEditMetadata && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => handleOpenMetadataEdit(w)}
                          title="Edit administrative notes"
                        >
                          ✏️ Notes
                        </button>
                      )}
                      {canReview && w.status === 'QUOTED' && (
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          style={{ color: 'var(--status-danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                          onClick={async () => {
                            if (window.confirm(`Are you sure you want to cancel quote #${w.id} (${w.withdrawalRef})?`)) {
                              try {
                                await reviewAdminWithdrawal(w.id, 'reject', { reason: 'Cancelled by owner' });
                                loadWithdrawals();
                              } catch (err: any) {
                                alert(err.message || 'Failed to cancel quote');
                              }
                            }
                          }}
                          title="Cancel Quoted Request"
                        >
                          ✕ Cancel Quote
                        </button>
                      )}
                      {canReview && (
                        <button
                          type="button"
                          className="btn btn-cta btn-xs"
                          onClick={() => {
                            setSelectedWithdrawal(w);
                            setDecision(w.payoutMethod === 'IRT_BANK' ? 'approve_paid' : 'approve_processing');
                            setTxHash('');
                            setFinalPaidAmount(w.quotedNetPayoutAmount ? String(w.quotedNetPayoutAmount) : '');
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
        <div className="studio-modal-backdrop" onClick={() => setSelectedWithdrawal(null)}>
          <div className="studio-modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {selectedWithdrawal.payoutMethod === 'IRT_BANK'
                  ? `Manual Toman Bank Transfer Payout #${selectedWithdrawal.id}`
                  : `Execute Payout Decision #${selectedWithdrawal.id}`}
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setSelectedWithdrawal(null)}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              <div style={{ backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                <div>Booster: <strong>{selectedWithdrawal.boosterName}</strong></div>
                <div>Method: <strong style={{ color: selectedWithdrawal.payoutMethod === 'IRT_BANK' ? '#38BDF8' : '#A78BFA' }}>
                  {selectedWithdrawal.payoutMethod === 'IRT_BANK' ? '🏦 IRT Bank (Toman)' : '💎 USDT (BEP-20)'}
                </strong></div>
                <div>Status: <span className="badge badge-purple" style={{ fontSize: '0.72rem', marginLeft: '4px' }}>{selectedWithdrawal.status}</span></div>
                <div>Requested Amount: <strong style={{ color: 'var(--accent-yellow)' }}>${(selectedWithdrawal.requestedUsdCents ? selectedWithdrawal.requestedUsdCents / 100 : selectedWithdrawal.requestedUsd || 0).toFixed(2)} USD</strong></div>
                {selectedWithdrawal.payoutMethod === 'IRT_BANK' && (
                  <div>Estimated Net Toman: <strong style={{ color: '#34D399' }}>{selectedWithdrawal.quotedNetPayoutAmount ? Number(selectedWithdrawal.quotedNetPayoutAmount).toLocaleString() + ' Toman' : '—'}</strong></div>
                )}
                <div>Destination Account: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedWithdrawal.destinationAddress}</span></div>
              </div>

              {selectedWithdrawal.status === 'QUOTED' && (
                <div style={{ backgroundColor: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.35)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.82rem', color: '#E9D5FF', lineHeight: 1.4 }}>
                  ℹ <strong>Unconfirmed Quote:</strong> Approving or disbursing will automatically verify and reserve <strong>${(selectedWithdrawal.requestedUsdCents ? selectedWithdrawal.requestedUsdCents / 100 : selectedWithdrawal.requestedUsd || 0).toFixed(2)} USD</strong> from the booster's wallet.
                </div>
              )}

              {/* Toman (IRT_BANK): Direct Manual Paid Form */}
              {selectedWithdrawal.payoutMethod === 'IRT_BANK' ? (
                <>
                  <div style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.84rem', color: '#BAE6FD', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>🏦</span>
                    <div>
                      <strong style={{ display: 'block', color: '#38BDF8' }}>Manual Bank Transfer (Direct Paid)</strong>
                      <span style={{ fontSize: '0.76rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                        Disburse funds via your banking portal, then enter the tracking code and final sent amount below.
                      </span>
                    </div>
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                      Bank Transaction / Tracking Reference *
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. TRACK-987654321, Satna, or Paya Reference No."
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem', fontSize: '0.85rem' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--status-info)', display: 'block', marginTop: '0.25rem' }}>
                      ✓ Only a valid bank tracking/reference code is required to confirm this payout.
                    </span>
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                      Final Sent Amount (Toman) *
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. 5200000"
                      value={finalPaidAmount}
                      onChange={(e) => setFinalPaidAmount(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem', fontSize: '0.85rem', fontFamily: 'monospace' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                      Quote estimate was: {selectedWithdrawal.quotedNetPayoutAmount ? Number(selectedWithdrawal.quotedNetPayoutAmount).toLocaleString() + ' Toman' : 'N/A'}
                    </span>
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Reviewer Notes (Optional)
                    </label>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Optional administrative or audit notes..."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem' }}
                    />
                  </div>
                </>
              ) : (
                /* Crypto (USDT): Standard 3-state radio flow */
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === 'approve_processing'}
                        onChange={() => setDecision('approve_processing')}
                      />
                      {selectedWithdrawal.status === 'QUOTED' ? 'Auto-Reserve & Approve for Transfer (Processing)' : 'Approve for Manual Transfer (Processing)'}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === 'approve_paid'}
                        onChange={() => setDecision('approve_paid')}
                      />
                      {selectedWithdrawal.status === 'QUOTED' ? 'Auto-Reserve & Confirm Disbursement (Paid + Tx Proof)' : 'Confirm Disbursement (Paid + Tx Proof)'}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === 'reject'}
                        onChange={() => setDecision('reject')}
                      />
                      {selectedWithdrawal.status === 'QUOTED' ? 'Reject & Cancel Unconfirmed Quote' : 'Reject & Refund Reserve'}
                    </label>
                  </div>

                  {decision === 'approve_paid' && (
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        Transaction Hash / Payment Proof Reference *
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g. 0xabc... (BEP-20 TxHash)"
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
                </>
              )}

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
            </div>

            <div className="studio-modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {selectedWithdrawal.status === 'QUOTED' && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ color: 'var(--status-danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    disabled={submittingReview}
                    onClick={async () => {
                      if (window.confirm(`Are you sure you want to cancel quote #${selectedWithdrawal.id}?`)) {
                        setSubmittingReview(true);
                        try {
                          await reviewAdminWithdrawal(selectedWithdrawal.id, 'reject', { reason: 'Cancelled by owner' });
                          setSelectedWithdrawal(null);
                          loadWithdrawals();
                        } catch (err: any) {
                          setReviewFeedback({ text: err.message || 'Failed to cancel quote', type: 'error' });
                        } finally {
                          setSubmittingReview(false);
                        }
                      }
                    }}
                  >
                    ✕ Cancel Quote
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedWithdrawal(null)}
                >
                  Close
                </button>
                {selectedWithdrawal.payoutMethod === 'IRT_BANK' ? (
                  <button
                    type="button"
                    disabled={submittingReview || !txHash.trim() || !finalPaidAmount.trim()}
                    className="btn btn-cta btn-sm"
                    onClick={async () => {
                      setSubmittingReview(true);
                      setReviewFeedback(null);
                      try {
                        await reviewAdminWithdrawal(selectedWithdrawal.id, 'approve_paid', {
                          txHash: txHash.trim(),
                          bankReceiptRef: txHash.trim(),
                          finalPaidAmount: finalPaidAmount.trim(),
                          notes: reviewNotes.trim() || undefined,
                        });
                        setReviewFeedback({ text: 'Toman payment confirmed & disbursed successfully.', type: 'success' });
                        setTimeout(() => {
                          setSelectedWithdrawal(null);
                          loadWithdrawals();
                        }, 800);
                      } catch (err: any) {
                        setReviewFeedback({ text: err.message || 'Payout confirmation failed', type: 'error' });
                      } finally {
                        setSubmittingReview(false);
                      }
                    }}
                  >
                    {submittingReview ? 'Confirming...' : '✓ Confirm Manual Payment (PAID)'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={submittingReview || (decision === 'reject' && selectedWithdrawal.status !== 'QUOTED' && !reviewNotes.trim())}
                    className="btn btn-cta btn-sm"
                    onClick={async () => {
                      setSubmittingReview(true);
                      setReviewFeedback(null);
                      try {
                        await reviewAdminWithdrawal(selectedWithdrawal.id, decision, {
                          txHash: decision === 'approve_paid' && txHash.trim() ? txHash.trim() : undefined,
                          reason: reviewNotes.trim() || (selectedWithdrawal.status === 'QUOTED' ? 'Cancelled by owner' : undefined),
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
                    {submittingReview ? 'Executing...' : selectedWithdrawal.status === 'QUOTED' && decision !== 'reject' ? 'Auto-Reserve & Confirm' : 'Confirm Decision'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Edit Modal (Admin/Owner only) */}
      {metadataItem && canEditMetadata && (
        <div className="studio-modal-backdrop" onClick={() => setMetadataItem(null)}>
          <div className="studio-modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Edit Withdrawal Metadata #{metadataItem.id}
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setMetadataItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
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
            </div>

            <div className="studio-modal-footer">
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
        <div className="studio-modal-backdrop" onClick={() => setHistoryItem(null)}>
          <div className="studio-modal-card studio-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Withdrawal #{historyItem.id} Audit History
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setHistoryItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Ref: <strong>{historyItem.withdrawalRef}</strong> — Booster: {historyItem.boosterName}
              </p>

              {loadingHistory ? (
                <LoadingState message="Loading immutable audit events..." />
              ) : historyError ? (
                <div style={{ padding: '1rem', color: 'var(--status-danger)' }}>{historyError}</div>
              ) : auditHistory.length === 0 ? (
                <div className="empty-state-box" style={{ padding: '2rem' }}>
                  <span className="empty-state-icon">📜</span>
                  <p>No recorded audit events for this withdrawal request.</p>
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

            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHistoryItem(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
