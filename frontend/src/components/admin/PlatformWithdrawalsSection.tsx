import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  FinancialAccountItem,
  PlatformWithdrawalItem,
} from '../../types/financialAccounts';
import {
  requestPlatformWithdrawal,
  fetchPlatformWithdrawals,
  markWithdrawalProcessing,
  completePlatformWithdrawal,
  rejectPlatformWithdrawal,
  cancelPlatformWithdrawal,
} from '../../services/financialAccounts';

interface Props {
  accounts: FinancialAccountItem[];
  onRefreshWorkspace: () => void;
}

export const PlatformWithdrawalsSection: React.FC<Props> = ({ accounts, onRefreshWorkspace }) => {
  // Withdrawals List State
  const [withdrawals, setWithdrawals] = useState<PlatformWithdrawalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  // Request Withdrawal Modal State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [feeInput, setFeeInput] = useState('');
  const [destinationType, setDestinationType] = useState('EXTERNAL_BANK');
  const [destinationDetails, setDestinationDetails] = useState('');
  const [withdrawalDescription, setWithdrawalDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Settle / Complete Modal State
  const [settlingWithdrawal, setSettlingWithdrawal] = useState<PlatformWithdrawalItem | null>(null);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [settlementReceiptUrl, setSettlementReceiptUrl] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [submittingSettle, setSubmittingSettle] = useState(false);

  // Reject Modal State
  const [rejectingWithdrawal, setRejectingWithdrawal] = useState<PlatformWithdrawalItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);

  // Feedback states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selected Source Account
  const selectedSourceAccount = useMemo(
    () => accounts.find((a) => a.id === sourceAccountId),
    [accounts, sourceAccountId]
  );

  // Net Amount Calculation
  const netAmountCalculated = useMemo(() => {
    const gross = parseFloat(amountInput);
    if (isNaN(gross) || gross <= 0) return 0;
    const fee = parseFloat(feeInput) || 0;
    return Math.max(0, gross - fee);
  }, [amountInput, feeInput]);

  // Load Withdrawals
  const loadWithdrawals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPlatformWithdrawals({
        sourceAccountId: sourceFilter !== 'all' ? sourceFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        currency: currencyFilter !== 'all' ? currencyFilter : undefined,
        page,
        limit: 15,
      });

      if (res.success) {
        setWithdrawals(res.withdrawals || []);
        setTotalPages(res.pagination.totalPages || 1);
        setTotalCount(res.pagination.total || 0);
      }
    } catch (err: any) {
      console.error('Failed to load platform withdrawals:', err);
      setErrorMsg(err.message || 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, statusFilter, currencyFilter, page]);

  useEffect(() => {
    loadWithdrawals();
  }, [loadWithdrawals]);

  // Auto-dismiss alerts
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

  // Metrics summary
  const metrics = useMemo(() => {
    let pendingCount = 0;
    let processingCount = 0;
    let completedCount = 0;
    let pendingUsd = 0;
    let processingUsd = 0;
    let completedUsd = 0;
    let pendingIrt = 0;
    let processingIrt = 0;
    let completedIrt = 0;

    for (const w of withdrawals) {
      if (w.status === 'PENDING') {
        pendingCount++;
        if (w.currency === 'USD') pendingUsd += w.amount;
        else pendingIrt += w.amount;
      } else if (w.status === 'PROCESSING') {
        processingCount++;
        if (w.currency === 'USD') processingUsd += w.amount;
        else processingIrt += w.amount;
      } else if (w.status === 'COMPLETED') {
        completedCount++;
        if (w.currency === 'USD') completedUsd += w.amount;
        else completedIrt += w.amount;
      }
    }

    return {
      pendingCount,
      processingCount,
      completedCount,
      pendingUsd: (pendingUsd / 100).toFixed(2),
      processingUsd: (processingUsd / 100).toFixed(2),
      completedUsd: (completedUsd / 100).toFixed(2),
      pendingIrt: pendingIrt.toLocaleString(),
      processingIrt: processingIrt.toLocaleString(),
      completedIrt: completedIrt.toLocaleString(),
    };
  }, [withdrawals]);

  // Submit Request Withdrawal
  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSourceAccount) {
      setErrorMsg('Please select a source account.');
      return;
    }
    const numAmount = parseFloat(amountInput);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('Please enter a valid positive withdrawal amount.');
      return;
    }

    const amountMinor =
      selectedSourceAccount.currency === 'USD'
        ? Math.round(numAmount * 100)
        : Math.round(numAmount);

    const feeNum = parseFloat(feeInput) || 0;
    const feeMinor =
      selectedSourceAccount.currency === 'USD'
        ? Math.round(feeNum * 100)
        : Math.round(feeNum);

    if (amountMinor > selectedSourceAccount.availableBalance) {
      setErrorMsg(
        `Insufficient available funds! Available: ${selectedSourceAccount.formattedAvailable}, Requested: ${
          selectedSourceAccount.currency === 'USD'
            ? `$${numAmount.toFixed(2)}`
            : `${Math.round(numAmount).toLocaleString()} Toman`
        }`
      );
      return;
    }

    setSubmittingRequest(true);
    setErrorMsg(null);

    try {
      const idempotencyKey = `wth_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const res = await requestPlatformWithdrawal({
        sourceAccountId,
        amount: amountMinor,
        fee: feeMinor,
        destinationType,
        destinationDetails: destinationDetails.trim() || undefined,
        description: withdrawalDescription.trim() || undefined,
        attachmentUrl: attachmentUrl.trim() || undefined,
        idempotencyKey,
      });

      if (res.success) {
        setSuccessMsg(
          `Withdrawal requested! ${res.withdrawal.formattedAmount} reserved from ${selectedSourceAccount.name} (Ref: ${res.withdrawal.withdrawalRef})`
        );
        setShowRequestModal(false);
        setSourceAccountId('');
        setAmountInput('');
        setFeeInput('');
        setDestinationDetails('');
        setWithdrawalDescription('');
        setAttachmentUrl('');
        loadWithdrawals();
        onRefreshWorkspace();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit withdrawal request');
    } finally {
      setSubmittingRequest(false);
    }
  };

  // Mark Processing
  const handleMarkProcessing = async (w: PlatformWithdrawalItem) => {
    try {
      const res = await markWithdrawalProcessing(w.id);
      if (res.success) {
        setSuccessMsg(`Withdrawal ${w.withdrawalRef} marked as PROCESSING.`);
        loadWithdrawals();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to advance withdrawal to PROCESSING');
    }
  };

  // Settle / Complete Submit
  const handleExecuteComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingWithdrawal) return;

    setSubmittingSettle(true);
    try {
      const res = await completePlatformWithdrawal(settlingWithdrawal.id, {
        referenceNumber: referenceNumber.trim() || undefined,
        attachmentUrl: settlementReceiptUrl.trim() || undefined,
        notes: settlementNotes.trim() || undefined,
      });

      if (res.success) {
        setSuccessMsg(
          `Withdrawal ${res.withdrawal.withdrawalRef} settled and completed! Reserved funds deducted.`
        );
        setSettlingWithdrawal(null);
        setReferenceNumber('');
        setSettlementReceiptUrl('');
        setSettlementNotes('');
        loadWithdrawals();
        onRefreshWorkspace();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete withdrawal');
    } finally {
      setSubmittingSettle(false);
    }
  };

  // Reject Submit
  const handleExecuteReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingWithdrawal) return;
    if (!rejectionReason.trim()) {
      setErrorMsg('Rejection reason is required.');
      return;
    }

    setSubmittingReject(true);
    try {
      const res = await rejectPlatformWithdrawal(rejectingWithdrawal.id, rejectionReason.trim());
      if (res.success) {
        setSuccessMsg(`Withdrawal ${res.withdrawal.withdrawalRef} rejected. Reserved funds restored!`);
        setRejectingWithdrawal(null);
        setRejectionReason('');
        loadWithdrawals();
        onRefreshWorkspace();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reject withdrawal');
    } finally {
      setSubmittingReject(false);
    }
  };

  // Cancel
  const handleCancelWithdrawal = async (w: PlatformWithdrawalItem) => {
    if (!window.confirm(`Are you sure you want to cancel withdrawal ${w.withdrawalRef}? Reserved funds will be released.`)) {
      return;
    }
    try {
      const res = await cancelPlatformWithdrawal(w.id, 'Cancelled by admin request');
      if (res.success) {
        setSuccessMsg(`Withdrawal ${w.withdrawalRef} cancelled. Reserved funds released.`);
        loadWithdrawals();
        onRefreshWorkspace();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to cancel withdrawal');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Overview Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
        {/* Pending Card */}
        <div
          className="card-surface"
          style={{
            padding: '1.25rem',
            borderLeft: '4px solid #FBBF24',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Pending Queue
            </span>
            <span className="badge badge-yellow" style={{ fontSize: '0.7rem' }}>
              {metrics.pendingCount} Requests
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FBBF24', fontFamily: 'monospace' }}>
            ${metrics.pendingUsd}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            + {metrics.pendingIrt} Toman
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Funds currently reserved from available balances
          </div>
        </div>

        {/* Processing Card */}
        <div
          className="card-surface"
          style={{
            padding: '1.25rem',
            borderLeft: '4px solid #8B5CF6',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Under Processing
            </span>
            <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
              {metrics.processingCount} Active
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#C4B5FD', fontFamily: 'monospace' }}>
            ${metrics.processingUsd}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            + {metrics.processingIrt} Toman
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Awaiting payout execution &amp; banking reference
          </div>
        </div>

        {/* Completed Card */}
        <div
          className="card-surface"
          style={{
            padding: '1.25rem',
            borderLeft: '4px solid #34D399',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Settled &amp; Completed
            </span>
            <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>
              {metrics.completedCount} Settled
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#34D399', fontFamily: 'monospace' }}>
            ${metrics.completedUsd}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            + {metrics.completedIrt} Toman
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Reserved funds deducted &amp; final debits recorded
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '10px',
            color: '#34D399',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.88rem',
          }}
        >
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.88rem',
          }}
        >
          <span>⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Action and Filter Controls */}
      <div
        className="card-surface"
        style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Filters:</span>
          {/* Status Filter */}
          <select
            className="input-field"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '150px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="COMPLETED">Completed</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Source Account Filter */}
          <select
            className="input-field"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '160px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Source Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency})
              </option>
            ))}
          </select>

          {/* Currency Filter */}
          <select
            className="input-field"
            value={currencyFilter}
            onChange={(e) => {
              setCurrencyFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '110px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">Currencies</option>
            <option value="USD">USD</option>
            <option value="IRR">Toman</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadWithdrawals}
            disabled={loading}
            style={{ fontSize: '0.78rem' }}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => {
              setSourceAccountId('');
              setAmountInput('');
              setFeeInput('');
              setDestinationDetails('');
              setWithdrawalDescription('');
              setAttachmentUrl('');
              setShowRequestModal(true);
            }}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 700,
              boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)',
            }}
          >
            💸 Request Platform Withdrawal
          </button>
        </div>
      </div>

      {/* Withdrawals Table */}
      <div className="card-surface" style={{ padding: '0', overflow: 'hidden' }}>
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#fff' }}>
              Platform, Wallet &amp; Toman Withdrawals Queue
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Total entries: {totalCount} | Multi-stage lifecycle with guaranteed reservation lock
            </p>
          </div>
          <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
            Anti-Double-Deduction Protected
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '3rem' }}>
            <LoadingState message="Loading withdrawal records..." />
          </div>
        ) : withdrawals.length === 0 ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>💸</span>
            No withdrawal records found matching the specified filters.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Source Account</th>
                  <th>Gross Amount</th>
                  <th>Fee</th>
                  <th>Net Payout</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Admin / Processor</th>
                  <th>Requested Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.74rem', fontWeight: 700 }}>
                      {w.withdrawalRef}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#fff' }}>
                        {w.sourceAccountName || w.sourceAccountId}
                      </div>
                      <span className="badge" style={{ fontSize: '0.65rem', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                        {w.currency}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#F87171' }}>
                      {w.formattedAmount}
                    </td>
                    <td style={{ fontSize: '0.76rem', color: w.fee > 0 ? 'var(--accent-yellow)' : 'var(--text-muted)' }}>
                      {w.formattedFee}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#34D399' }}>
                      {w.formattedNetAmount}
                    </td>
                    <td>
                      <div style={{ fontSize: '0.78rem', color: '#fff' }}>
                        <span className="badge" style={{ fontSize: '0.65rem', marginRight: '4px', backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#C4B5FD' }}>
                          {w.destinationType}
                        </span>
                        {w.destinationAccountName && <span>{w.destinationAccountName}</span>}
                      </div>
                      {w.destinationDetails && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.destinationDetails}>
                          {w.destinationDetails}
                        </div>
                      )}
                    </td>
                    <td>
                      {w.status === 'PENDING' && (
                        <span className="badge badge-yellow" style={{ fontSize: '0.68rem' }}>
                          PENDING
                        </span>
                      )}
                      {w.status === 'PROCESSING' && (
                        <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                          PROCESSING
                        </span>
                      )}
                      {w.status === 'COMPLETED' && (
                        <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>
                          COMPLETED
                        </span>
                      )}
                      {w.status === 'REJECTED' && (
                        <span className="badge badge-red" style={{ fontSize: '0.68rem' }}>
                          REJECTED
                        </span>
                      )}
                      {w.status === 'CANCELLED' && (
                        <span className="badge" style={{ fontSize: '0.68rem', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                          CANCELLED
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      <div>{w.adminUsername || w.adminId || 'System'}</div>
                      {w.processorUsername && (
                        <div style={{ fontSize: '0.68rem', color: '#C4B5FD' }}>Proc: {w.processorUsername}</div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(w.requestedAt).toLocaleDateString()} {new Date(w.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {w.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => handleMarkProcessing(w)}
                              style={{ borderColor: '#8B5CF6', color: '#C4B5FD', fontSize: '0.68rem' }}
                            >
                              Process
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => {
                                setRejectingWithdrawal(w);
                                setRejectionReason('');
                              }}
                              style={{ color: '#F87171', fontSize: '0.68rem' }}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => handleCancelWithdrawal(w)}
                              style={{ fontSize: '0.68rem' }}
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {w.status === 'PROCESSING' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-cta btn-xs"
                              onClick={() => {
                                setSettlingWithdrawal(w);
                                setReferenceNumber('');
                                setSettlementReceiptUrl('');
                                setSettlementNotes('');
                              }}
                              style={{
                                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                color: '#fff',
                                fontSize: '0.68rem',
                              }}
                            >
                              ✓ Settle
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => {
                                setRejectingWithdrawal(w);
                                setRejectionReason('');
                              }}
                              style={{ color: '#F87171', fontSize: '0.68rem' }}
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {w.status === 'COMPLETED' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {w.referenceNumber && (
                              <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#34D399' }}>
                                Ref: {w.referenceNumber}
                              </span>
                            )}
                            {w.attachmentUrl && (
                              <a
                                href={w.attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary btn-xs"
                                style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                              >
                                📎 Receipt
                              </a>
                            )}
                          </div>
                        )}

                        {w.status === 'REJECTED' && w.rejectionReason && (
                          <span
                            style={{ fontSize: '0.68rem', color: '#F87171', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={w.rejectionReason}
                          >
                            Reason: {w.rejectionReason}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Showing Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                &larr; Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: REQUEST WITHDRAWAL                                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {showRequestModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '600px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>💸</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>Request Platform Withdrawal</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Withdraw funds from a Platform balance, USD Wallet, or Toman account
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowRequestModal(false)}
                disabled={submittingRequest}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleRequestWithdrawal}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Source Account */}
                <div>
                  <label className="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Source Account *</span>
                    {selectedSourceAccount && (
                      <span style={{ color: '#34D399', fontSize: '0.76rem', fontWeight: 700 }}>
                        Avail: {selectedSourceAccount.formattedAvailable}
                      </span>
                    )}
                  </label>
                  <select
                    className="input-field"
                    required
                    value={sourceAccountId}
                    onChange={(e) => setSourceAccountId(e.target.value)}
                  >
                    <option value="">-- Select Source Account --</option>
                    {accounts
                      .filter((a) => a.status === 'ACTIVE')
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.category} - {acc.currency}) | Avail: {acc.formattedAvailable}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Amounts Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="field-label">
                      Gross Withdrawal Amount ({selectedSourceAccount?.currency || 'Units'}) *
                    </label>
                    <input
                      type="number"
                      step={selectedSourceAccount?.currency === 'USD' ? '0.01' : '1'}
                      min="0.01"
                      className="input-field"
                      placeholder={selectedSourceAccount?.currency === 'USD' ? 'e.g. 250.00' : 'e.g. 25000000'}
                      required
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Estimated Fee (Optional)</label>
                    <input
                      type="number"
                      step={selectedSourceAccount?.currency === 'USD' ? '0.01' : '1'}
                      min="0"
                      className="input-field"
                      placeholder="0.00"
                      value={feeInput}
                      onChange={(e) => setFeeInput(e.target.value)}
                    />
                  </div>
                </div>

                {/* Net Payout Preview */}
                {selectedSourceAccount && (
                  <div
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(139, 92, 246, 0.1)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 600 }}>
                      Estimated Net Payout:
                    </span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#34D399', fontFamily: 'monospace' }}>
                      {selectedSourceAccount.currency === 'USD'
                        ? `$${netAmountCalculated.toFixed(2)}`
                        : `${Math.round(netAmountCalculated).toLocaleString()} Toman`}
                    </span>
                  </div>
                )}

                {/* Destination Details */}
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem' }}>
                  <div>
                    <label className="field-label">Destination *</label>
                    <select
                      className="input-field"
                      value={destinationType}
                      onChange={(e) => setDestinationType(e.target.value)}
                    >
                      <option value="EXTERNAL_BANK">Bank Card / IBAN</option>
                      <option value="CRYPTO_WALLET">Crypto (USDT)</option>
                      <option value="INTERNAL_ACCOUNT">Internal Account</option>
                      <option value="CASH">Cash / Safe</option>
                    </select>
                  </div>

                  <div>
                    <label className="field-label">Destination Payout Details</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder={
                        destinationType === 'EXTERNAL_BANK'
                          ? 'e.g. Card: 6037-xxxx-xxxx-xxxx / Shaba: IR...'
                          : destinationType === 'CRYPTO_WALLET'
                          ? 'e.g. USDT (TRC20): T...'
                          : 'Destination details...'
                      }
                      value={destinationDetails}
                      onChange={(e) => setDestinationDetails(e.target.value)}
                    />
                  </div>
                </div>

                {/* Description & Receipt */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="field-label">Notes / Purpose</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Owner payout / Treasury liquidation"
                      value={withdrawalDescription}
                      onChange={(e) => setWithdrawalDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Attachment URL (Optional)</label>
                    <input
                      type="url"
                      className="input-field"
                      placeholder="https://..."
                      value={attachmentUrl}
                      onChange={(e) => setAttachmentUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRequestModal(false)}
                  disabled={submittingRequest}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={submittingRequest || netAmountCalculated <= 0}
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingRequest ? 'Submitting & Reserving...' : 'Submit & Reserve Funds'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: SETTLE / COMPLETE WITHDRAWAL                               */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {settlingWithdrawal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '520px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>✓</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>Settle Withdrawal Payout</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Ref: {settlingWithdrawal.withdrawalRef} | Amount: {settlingWithdrawal.formattedAmount}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSettlingWithdrawal(null)}
                disabled={submittingSettle}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteComplete}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: 'rgba(52, 211, 153, 0.1)',
                    border: '1px solid rgba(52, 211, 153, 0.3)',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    color: '#34D399',
                  }}
                >
                  Confirming settlement will permanently deduct the reserved {settlingWithdrawal.formattedAmount} from{' '}
                  <strong>{settlingWithdrawal.sourceAccountName || settlingWithdrawal.sourceAccountId}</strong> and record the final balanced transaction.
                </div>

                <div>
                  <label className="field-label">Reference / Tracking Number *</label>
                  <input
                    type="text"
                    className="input-field"
                    required
                    placeholder="e.g. Bank Tracking #, TxHash, or Transfer Slip ID"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                  />
                </div>

                <div>
                  <label className="field-label">Receipt / Slip Attachment URL</label>
                  <input
                    type="url"
                    className="input-field"
                    placeholder="https://..."
                    value={settlementReceiptUrl}
                    onChange={(e) => setSettlementReceiptUrl(e.target.value)}
                  />
                </div>

                <div>
                  <label className="field-label">Settlement Notes (Optional)</label>
                  <textarea
                    className="input-field"
                    rows={2}
                    placeholder="e.g. Settled via Mellat online banking"
                    value={settlementNotes}
                    onChange={(e) => setSettlementNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSettlingWithdrawal(null)}
                  disabled={submittingSettle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={submittingSettle || !referenceNumber.trim()}
                  style={{
                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingSettle ? 'Settling...' : 'Confirm Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: REJECT WITHDRAWAL                                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {rejectingWithdrawal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '480px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>Reject Withdrawal Request</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Ref: {rejectingWithdrawal.withdrawalRef} | Amount: {rejectingWithdrawal.formattedAmount}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRejectingWithdrawal(null)}
                disabled={submittingReject}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteReject}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    color: '#F87171',
                  }}
                >
                  Rejecting this withdrawal will immediately <strong>release the reserved funds ({rejectingWithdrawal.formattedAmount})</strong> back to the available balance of {rejectingWithdrawal.sourceAccountName || rejectingWithdrawal.sourceAccountId}.
                </div>

                <div>
                  <label className="field-label">Rejection Reason *</label>
                  <textarea
                    className="input-field"
                    required
                    rows={3}
                    placeholder="e.g. Invalid bank card number / Requested cancellation by owner"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRejectingWithdrawal(null)}
                  disabled={submittingReject}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={submittingReject || !rejectionReason.trim()}
                  style={{
                    backgroundColor: '#EF4444',
                    color: '#fff',
                  }}
                >
                  {submittingReject ? 'Rejecting...' : 'Reject & Release Funds'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
