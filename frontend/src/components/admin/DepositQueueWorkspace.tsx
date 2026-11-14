import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LoadingState } from '../ui/LoadingState';
import { AdminDepositItem } from '../../types/adminPortal';
import {
  fetchAdminDeposits,
  fetchAdminDepositDetails,
  reviewAdminDeposit,
} from '../../services/adminPortal';

interface Props {
  title?: string;
  subtitle?: string;
  isExecutive?: boolean;
}

interface AuditRecord {
  id: number;
  actor: string;
  actorId?: string;
  action: string;
  reason: string | null;
  previousValues?: string | null;
  newValues: string | null;
  createdAt: string;
}

export const DepositQueueWorkspace: React.FC<Props> = ({
  title = 'Manual IRT Deposit Administration',
  subtitle = 'Review incoming card-to-card IRT payment slips and confirm authoritative bank receipt.',
  isExecutive = false,
}) => {
  const { user } = useAuth();

  // Queue state
  const [deposits, setDeposits] = useState<AdminDepositItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('PENDING_ADMIN_VERIFICATION');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [applicantFilter, setApplicantFilter] = useState<string>('');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');

  // Review & Details Modal State
  const [selectedDeposit, setSelectedDeposit] = useState<AdminDepositItem | null>(null);
  const [modalAuditTrail, setModalAuditTrail] = useState<AuditRecord[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [depositAction, setDepositAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [depositNotes, setDepositNotes] = useState<string>('');
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [depositReviewMsg, setDepositReviewMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load Queue Data
  const loadDeposits = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdminDeposits({
          page,
          limit: pagination.limit,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: searchQuery.trim() || undefined,
          applicant: applicantFilter.trim() || undefined,
          startDate: startDateFilter || undefined,
          endDate: endDateFilter || undefined,
        });
        setDeposits(data.deposits || []);
        setPagination(data.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
      } catch (err: any) {
        setError(err.message || 'Failed to load deposit requests from server.');
      } finally {
        setLoading(false);
      }
    },
    [pagination.limit, statusFilter, searchQuery, applicantFilter, startDateFilter, endDateFilter]
  );

  useEffect(() => {
    loadDeposits(1);
  }, [loadDeposits]);

  // Open Details Modal and fetch audit trail
  const handleOpenDetails = async (deposit: AdminDepositItem) => {
    setSelectedDeposit(deposit);
    setDepositAction('APPROVE');
    setDepositNotes('');
    setDepositReviewMsg(null);
    setModalAuditTrail([]);
    setLoadingDetails(true);

    try {
      const res = await fetchAdminDepositDetails(deposit.id);
      if (res.success && res.deposit) {
        setSelectedDeposit(res.deposit);
        setModalAuditTrail(res.auditTrail || []);
      }
    } catch (err) {
      console.warn('Could not load deposit audit trail:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleReviewSubmit = async () => {
    if (!selectedDeposit) return;

    if (!depositNotes || depositNotes.trim().length < 5) {
      setDepositReviewMsg({
        text: 'Reviewer notes are mandatory (at least 5 characters required).',
        type: 'error',
      });
      return;
    }

    setSubmittingDeposit(true);
    setDepositReviewMsg(null);

    try {
      await reviewAdminDeposit(selectedDeposit.id, depositAction, depositNotes.trim());
      setDepositReviewMsg({
        text: `Deposit #${selectedDeposit.id} successfully ${depositAction === 'APPROVE' ? 'approved' : 'rejected'}.`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedDeposit(null);
        loadDeposits(pagination.page);
      }, 1000);
    } catch (err: any) {
      setDepositReviewMsg({
        text: err.message || 'Failed to submit review decision.',
        type: 'error',
      });
    } finally {
      setSubmittingDeposit(false);
    }
  };

  const isSelfReview = Boolean(user && selectedDeposit && user.discordId === selectedDeposit.advertiserId);
  const isNotesValid = depositNotes.trim().length >= 5;

  return (
    <div className="card-surface" style={{ padding: '1.75rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '1.25rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              {title}
            </h2>
            {isExecutive && (
              <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                Executive Treasury
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {subtitle}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadDeposits(pagination.page)}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : '↻ Refresh Queue'}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.85rem',
          marginBottom: '1.5rem',
          padding: '1rem',
          backgroundColor: 'var(--bg-main)',
          borderRadius: '8px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            Search (ID, Ref, User, Card, Doc)
          </label>
          <input
            type="text"
            className="input input-sm"
            style={{ width: '100%', fontSize: '0.82rem' }}
            placeholder="e.g. 101, FUND_IRT, Ali..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDeposits(1)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            Status Filter
          </label>
          <select
            className="input input-sm"
            style={{ width: '100%', fontSize: '0.82rem', backgroundColor: 'var(--bg-surface)' }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
            }}
          >
            <option value="PENDING_ADMIN_VERIFICATION">Pending Review</option>
            <option value="CONFIRMED_CREDITED">Confirmed &amp; Credited</option>
            <option value="REJECTED">Rejected</option>
            <option value="all">All Statuses</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            Applicant Discord ID
          </label>
          <input
            type="text"
            className="input input-sm"
            style={{ width: '100%', fontSize: '0.82rem' }}
            placeholder="Filter by Discord ID"
            value={applicantFilter}
            onChange={(e) => setApplicantFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDeposits(1)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            From Date
          </label>
          <input
            type="date"
            className="input input-sm"
            style={{ width: '100%', fontSize: '0.82rem' }}
            value={startDateFilter}
            onChange={(e) => setStartDateFilter(e.target.value)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            To Date
          </label>
          <input
            type="date"
            className="input input-sm"
            style={{ width: '100%', fontSize: '0.82rem' }}
            value={endDateFilter}
            onChange={(e) => setEndDateFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: '0.85rem 1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Table Content */}
      {loading ? (
        <LoadingState message="Loading Manual IRT deposit queue..." />
      ) : deposits.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '3.5rem 1rem' }}>
          <span className="empty-state-icon">📥</span>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            No deposit requests match your filter criteria.
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Try adjusting search terms, dates, or status filters.
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ref / Date</th>
                <th>Depositor / Advertiser</th>
                <th>Method &amp; Toman Amount</th>
                <th>Expected USD</th>
                <th>Payer Details &amp; Tracking</th>
                <th>Receipt</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                      #{d.id} • {d.fundingRef}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {new Date(d.createdAt).toLocaleDateString()} {new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.advertiserName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {d.advertiserId}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--accent-yellow)' }}>
                      {Number(d.externalAmountUnits).toLocaleString()} Toman
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Rate: {d.exchangeRate ? `${d.exchangeRate.toLocaleString()} IRT` : '—'}
                    </div>
                  </td>
                  <td style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                    {d.targetUsdFormatted}
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      {d.payerIdentifier || '—'}
                      {d.senderCardLast4 && (
                        <span style={{ color: 'var(--accent-yellow)', marginLeft: '0.35rem' }}>
                          (•••• {d.senderCardLast4})
                        </span>
                      )}
                    </div>
                    {d.evidenceRef && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        Ref: {d.evidenceRef}
                      </div>
                    )}
                  </td>
                  <td>
                    {d.receiptUrl ? (
                      <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>
                        ✓ Slip Attached
                      </span>
                    ) : (
                      <span className="badge badge-muted" style={{ fontSize: '0.68rem' }}>
                        No Image
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        d.status === 'CONFIRMED_CREDITED'
                          ? 'badge-green'
                          : d.status === 'REJECTED'
                          ? 'badge-danger'
                          : 'badge-amber'
                      }`}
                      style={{ fontSize: '0.72rem' }}
                    >
                      {d.status === 'CONFIRMED_CREDITED'
                        ? 'Confirmed & Credited'
                        : d.status === 'REJECTED'
                        ? 'Rejected'
                        : 'Pending Review'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={d.status === 'PENDING_ADMIN_VERIFICATION' ? 'btn btn-cta btn-xs' : 'btn btn-secondary btn-xs'}
                      onClick={() => handleOpenDetails(d)}
                    >
                      {d.status === 'PENDING_ADMIN_VERIFICATION' ? 'Review Slip' : 'Inspect'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.25rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.total} deposit requests)
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => loadDeposits(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1 || loading}
              className="btn btn-secondary btn-sm"
            >
              &larr; Previous
            </button>
            <button
              onClick={() => loadDeposits(Math.min(pagination.totalPages, pagination.page + 1))}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="btn btn-secondary btn-sm"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* REVIEW & INSPECTION MODAL                                                    */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {selectedDeposit && (
        <div className="studio-modal-backdrop" onClick={() => setSelectedDeposit(null)}>
          <div className="studio-modal-card studio-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="studio-modal-header">
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Deposit Request #{selectedDeposit.id}
                </h3>
                <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  {selectedDeposit.fundingRef} • {new Date(selectedDeposit.createdAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setSelectedDeposit(null)}
              >
                ✕
              </button>
            </div>

            {/* Anti-Self-Approval Guard Alert */}
            {isSelfReview && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid var(--status-danger)',
                  borderRadius: '6px',
                  padding: '0.75rem 1rem',
                  fontSize: '0.82rem',
                  color: '#ef4444',
                  marginBottom: '1rem',
                  fontWeight: 600,
                }}
              >
                ⚠️ <strong>Anti-Self-Approval Enforcement:</strong> You are the depositor of this funding request. An independent administrator or owner must perform this review. Approval actions are disabled.
              </div>
            )}

            {/* Financial Details Box */}
            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1.15rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                fontSize: '0.84rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.85rem',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Advertiser Account</span>
                <strong style={{ color: 'var(--text-primary)' }}>{selectedDeposit.advertiserName}</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontFamily: 'monospace' }}>
                  {selectedDeposit.advertiserId}
                </span>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Payable Toman (IRT)</span>
                <strong style={{ color: 'var(--accent-lime)', fontSize: '1rem' }}>
                  {Number(selectedDeposit.externalAmountUnits).toLocaleString()} Toman
                </strong>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Expected USD Credit</span>
                <strong style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>
                  {selectedDeposit.targetUsdFormatted}
                </strong>
                {selectedDeposit.exchangeRate && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
                    Rate: {selectedDeposit.exchangeRate.toLocaleString()} IRT/USD
                  </span>
                )}
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Depositor / Account Holder</span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {selectedDeposit.rawPayerIdentifier || selectedDeposit.payerIdentifier}
                </strong>
                {selectedDeposit.senderCardLast4 && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-lime)', display: 'block' }}>
                    Card Suffix: •••• {selectedDeposit.senderCardLast4}
                  </span>
                )}
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Bank Tracking Reference</span>
                <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                  {selectedDeposit.evidenceRef || 'None'}
                </strong>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Payment Date</span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {selectedDeposit.paymentDate || new Date(selectedDeposit.createdAt).toLocaleDateString()}
                </strong>
              </div>

              {selectedDeposit.payerDescription && (
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(45, 38, 69, 0.4)', paddingTop: '0.65rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block' }}>Depositor Remarks / Notes</span>
                  <span style={{ color: 'var(--text-primary)' }}>{selectedDeposit.payerDescription}</span>
                </div>
              )}
            </div>

            {/* Secure Receipt Screenshot Preview */}
            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                border: '1px solid var(--border-subtle)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                Payment Receipt Evidence
              </div>
              {selectedDeposit.receiptUrl ? (
                <div>
                  <a href={selectedDeposit.receiptUrl} target="_blank" rel="noopener noreferrer" title="Click to inspect full screenshot in new tab">
                    <img
                      src={selectedDeposit.receiptUrl}
                      alt="Bank Payment Slip"
                      style={{
                        maxHeight: '220px',
                        maxWidth: '100%',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        objectFit: 'contain',
                        cursor: 'pointer',
                      }}
                    />
                  </a>
                  <div style={{ fontSize: '0.72rem', color: 'var(--accent-lime)', marginTop: '0.4rem' }}>
                    Click image to inspect full size in new tab (Authorized non-public receipt storage)
                  </div>
                </div>
              ) : (
                <div style={{ padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  📎 No receipt screenshot attached (Historical deposit submission)
                </div>
              )}
            </div>

            {/* Decision & Verification Section (Pending Requests Only) */}
            {selectedDeposit.status === 'PENDING_ADMIN_VERIFICATION' ? (
              <div
                style={{
                  backgroundColor: 'rgba(24, 21, 36, 0.6)',
                  padding: '1.25rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '1.25rem',
                }}
              >
                <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.85rem 0', color: 'var(--text-primary)' }}>
                  Administrative Verification Decision
                </h4>

                {/* Gate Policy Notice */}
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    color: '#fca5a5',
                    marginBottom: '1rem',
                  }}
                >
                  🔒 <strong>Live Financial Gate Enforcement:</strong> Live wallet crediting is currently disabled by system configuration (FINANCE_V2_LIVE_CREDITS_ENABLED=false). Approving will record verified review status without injecting live balances.
                </div>

                {/* Radio selection */}
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                    <input
                      type="radio"
                      name="depositDecision"
                      checked={depositAction === 'APPROVE'}
                      onChange={() => setDepositAction('APPROVE')}
                    />
                    <span style={{ fontWeight: 700, color: 'var(--accent-lime)' }}>
                      Approve &amp; Record Verification
                    </span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                    <input
                      type="radio"
                      name="depositDecision"
                      checked={depositAction === 'REJECT'}
                      onChange={() => setDepositAction('REJECT')}
                    />
                    <span style={{ fontWeight: 700, color: 'var(--status-danger)' }}>
                      Reject Deposit
                    </span>
                  </label>
                </div>

                {/* Reviewer Notes */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    Reviewer Verification Notes * (Min 5 chars)
                  </label>
                  <textarea
                    rows={3}
                    className="input"
                    style={{ width: '100%', fontSize: '0.84rem' }}
                    placeholder={
                      depositAction === 'REJECT'
                        ? 'Mandatory reason for rejection (e.g. Reference number not found in bank statement)...'
                        : 'Mandatory verification reference (e.g. Bank statement tracking number verified via portal)...'
                    }
                    value={depositNotes}
                    onChange={(e) => setDepositNotes(e.target.value)}
                  />
                  <span style={{ fontSize: '0.72rem', color: isNotesValid ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
                    {depositNotes.trim().length}/5 characters minimum
                  </span>
                </div>

                {depositReviewMsg && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.82rem',
                      marginBottom: '1rem',
                      backgroundColor: depositReviewMsg.type === 'success' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: depositReviewMsg.type === 'success' ? 'var(--accent-lime)' : 'var(--status-danger)',
                      border: `1px solid ${depositReviewMsg.type === 'success' ? 'var(--accent-lime)' : 'var(--status-danger)'}`,
                    }}
                  >
                    {depositReviewMsg.text}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedDeposit(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-cta btn-sm"
                    disabled={submittingDeposit || isSelfReview || !isNotesValid}
                    onClick={handleReviewSubmit}
                  >
                    {submittingDeposit ? 'Processing...' : depositAction === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}
                  </button>
                </div>
              </div>
            ) : (
              /* Already Reviewed State Information */
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  padding: '1rem',
                  borderRadius: '8px',
                  marginBottom: '1.25rem',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Decision Recorded
                  </span>
                  <span
                    className={`badge ${
                      selectedDeposit.status === 'CONFIRMED_CREDITED' ? 'badge-lime' : 'badge-red'
                    }`}
                  >
                    {selectedDeposit.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Verified By: <strong>{selectedDeposit.verifiedBy || 'Admin'}</strong>
                  {selectedDeposit.verifiedAt && ` on ${new Date(selectedDeposit.verifiedAt).toLocaleString()}`}
                </div>
              </div>
            )}

            {/* Audit Trail Timeline */}
            <div>
              <h4 style={{ fontSize: '0.92rem', fontWeight: 800, margin: '0 0 0.65rem 0', color: 'var(--text-primary)' }}>
                Immutable Audit Trail History
              </h4>
              {loadingDetails ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading audit records...</div>
              ) : modalAuditTrail.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                  Created on {new Date(selectedDeposit.createdAt).toLocaleString()} by depositor {selectedDeposit.advertiserName}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {modalAuditTrail.map((record) => (
                    <div
                      key={record.id}
                      style={{
                        padding: '0.65rem 0.85rem',
                        backgroundColor: 'var(--bg-main)',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ color: 'var(--accent-lime)', fontFamily: 'monospace' }}>
                          {record.action}
                        </strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                          {new Date(record.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                        Actor: <span style={{ color: 'var(--text-primary)' }}>{record.actor}</span>
                        {record.reason && (
                          <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)' }}>
                            Notes: {record.reason}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
