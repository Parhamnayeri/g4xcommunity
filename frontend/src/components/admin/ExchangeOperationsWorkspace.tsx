/**
 * frontend/src/components/admin/ExchangeOperationsWorkspace.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 7:
 * Comprehensive Admin Operations & Settlement Workspace.
 *
 * 9 Sub-Tabs:
 *  1. overview          — 9 PRD KPI Cards, Quick Stats, Recent Settlements
 *  2. approval_queue    — Trades Awaiting Final Review, Settle Payout, Reject, Request Proof
 *  3. kyc               — Exchanger KYC Requests & Verification
 *  4. exchangers        — Exchanger Management, Performance, and Limits
 *  5. trades            — All Active & Historic Exchange Trades (Filtering & Search)
 *  6. disputes          — Dispute Engine with 5 Resolution Outcomes
 *  7. payments_refunds  — Payments, Bank Receipt Verification, Escrow Status
 *  8. transactions      — Immutable Settlement History & Ledger Transactions
 *  9. audit             — Exchange Audit Trail Logs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '../ui/LoadingState';
import {
  ExchangeOperationsOverviewKpis,
  ExchangeApprovalQueueItem,
  ExchangeDisputeItem,
  ExchangeSettlementItem,
  ExchangePaymentItem,
  DisputeResolutionOutcome,
} from '../../types/exchange';
import {
  getExchangeAdminOverview,
  getExchangeApprovalQueue,
  approveExchangeTrade,
  rejectExchangeTrade,
  requestAdditionalExchangeProof,
  addTradeInternalNote,
  getExchangeAdminTrades,
  getExchangeAdminDisputes,
  resolveExchangeDispute,
  getExchangeAdminSettlements,
  getExchangeAdminExchangers,
  getExchangeAdminAuditLogs,
  adminFetchExchangePayments,
  adminReviewExchangePayment,
} from '../../services/exchangeMarketplace';

export type ExchangeOpsTab =
  | 'overview'
  | 'approval_queue'
  | 'kyc'
  | 'exchangers'
  | 'trades'
  | 'disputes'
  | 'payments_refunds'
  | 'transactions'
  | 'audit';

export const ExchangeOperationsWorkspace: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<ExchangeOpsTab>('overview');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Overview Data
  const [overviewKpis, setOverviewKpis] = useState<ExchangeOperationsOverviewKpis | null>(null);
  const [recentSettlements, setRecentSettlements] = useState<ExchangeSettlementItem[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Approval Queue Data
  const [approvalQueue, setApprovalQueue] = useState<ExchangeApprovalQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Exchangers Data
  const [exchangers, setExchangers] = useState<any[]>([]);
  const [loadingExchangers, setLoadingExchangers] = useState(false);

  // Trades Data
  const [trades, setTrades] = useState<any[]>([]);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesStatusFilter, setTradesStatusFilter] = useState('ALL');
  const [tradesSearch, setTradesSearch] = useState('');
  const [loadingTrades, setLoadingTrades] = useState(false);

  // Disputes Data
  const [disputes, setDisputes] = useState<ExchangeDisputeItem[]>([]);
  const [disputesTotal, setDisputesTotal] = useState(0);
  const [disputesPage, setDisputesPage] = useState(1);
  const [disputesStatusFilter, setDisputesStatusFilter] = useState('ALL');
  const [loadingDisputes, setLoadingDisputes] = useState(false);
  const [resolvingDispute, setResolvingDispute] = useState<ExchangeDisputeItem | null>(null);
  const [disputeOutcome, setDisputeOutcome] = useState<DisputeResolutionOutcome>('RELEASE_TO_SELLER');
  const [disputeBuyerRefundCents, setDisputeBuyerRefundCents] = useState(0);
  const [disputeSellerPayoutCents, setDisputeSellerPayoutCents] = useState(0);
  const [disputeNote, setDisputeNote] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);

  // Payments Data
  const [payments, setPayments] = useState<ExchangePaymentItem[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [reviewingPaymentId, setReviewingPaymentId] = useState<string | null>(null);

  // Settlements Data
  const [settlements, setSettlements] = useState<ExchangeSettlementItem[]>([]);
  const [settlementsTotal, setSettlementsTotal] = useState(0);
  const [settlementsPage, setSettlementsPage] = useState(1);
  const [loadingSettlements, setLoadingSettlements] = useState(false);

  // Audit Logs Data
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // ─── Data Loaders ──────────────────────────────────────────────────────────

  const loadOverview = useCallback(async () => {
    try {
      setLoadingOverview(true);
      const res = await getExchangeAdminOverview();
      if (res.success) {
        setOverviewKpis(res.kpis);
        setRecentSettlements(res.recentSettlements);
      }
    } catch (err: any) {
      console.error('Failed to load overview KPIs:', err);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      setLoadingQueue(true);
      const res = await getExchangeApprovalQueue();
      if (res.success) {
        setApprovalQueue(res.queue);
      }
    } catch (err: any) {
      console.error('Failed to load approval queue:', err);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const loadExchangers = useCallback(async () => {
    try {
      setLoadingExchangers(true);
      const res = await getExchangeAdminExchangers();
      if (res.success) {
        setExchangers(res.exchangers);
      }
    } catch (err: any) {
      console.error('Failed to load exchangers:', err);
    } finally {
      setLoadingExchangers(false);
    }
  }, []);

  const loadTrades = useCallback(async (page = 1) => {
    try {
      setLoadingTrades(true);
      const res = await getExchangeAdminTrades({
        page,
        status: tradesStatusFilter,
        search: tradesSearch,
      });
      if (res.success) {
        setTrades(res.trades);
        setTradesTotal(res.total);
        setTradesPage(page);
      }
    } catch (err: any) {
      console.error('Failed to load admin trades:', err);
    } finally {
      setLoadingTrades(false);
    }
  }, [tradesStatusFilter, tradesSearch]);

  const loadDisputes = useCallback(async (page = 1) => {
    try {
      setLoadingDisputes(true);
      const res = await getExchangeAdminDisputes({
        page,
        status: disputesStatusFilter,
      });
      if (res.success) {
        setDisputes(res.disputes);
        setDisputesTotal(res.total);
        setDisputesPage(page);
      }
    } catch (err: any) {
      console.error('Failed to load disputes:', err);
    } finally {
      setLoadingDisputes(false);
    }
  }, [disputesStatusFilter]);

  const loadPayments = useCallback(async () => {
    try {
      setLoadingPayments(true);
      const res = await adminFetchExchangePayments({ limit: 50 });
      if (res.success) {
        setPayments(res.payments);
      }
    } catch (err: any) {
      console.error('Failed to load payments:', err);
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  const loadSettlements = useCallback(async (page = 1) => {
    try {
      setLoadingSettlements(true);
      const res = await getExchangeAdminSettlements({ page, limit: 30 });
      if (res.success) {
        setSettlements(res.settlements);
        setSettlementsTotal(res.total);
        setSettlementsPage(page);
      }
    } catch (err: any) {
      console.error('Failed to load settlements:', err);
    } finally {
      setLoadingSettlements(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async (page = 1) => {
    try {
      setLoadingAudit(true);
      const res = await getExchangeAdminAuditLogs({ page, limit: 30 });
      if (res.success) {
        setAuditLogs(res.logs);
        setAuditLogsTotal(res.total);
        setAuditLogsPage(page);
      }
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  // Dispatch Tab Loads
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeSubTab === 'approval_queue') loadQueue();
    if (activeSubTab === 'exchangers') loadExchangers();
    if (activeSubTab === 'trades') loadTrades(1);
    if (activeSubTab === 'disputes') loadDisputes(1);
    if (activeSubTab === 'payments_refunds') loadPayments();
    if (activeSubTab === 'transactions') loadSettlements(1);
    if (activeSubTab === 'audit') loadAuditLogs(1);
  }, [activeSubTab, loadQueue, loadExchangers, loadTrades, loadDisputes, loadPayments, loadSettlements, loadAuditLogs]);

  // ─── Approval Queue Actions ────────────────────────────────────────────────

  const handleApproveTrade = async (tradeId: string) => {
    const note = window.prompt('Enter final approval note (optional):', 'Delivery verified. Payout approved.');
    if (note === null) return;
    try {
      setActionInProgress(tradeId);
      const res = await approveExchangeTrade(tradeId, note);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Trade ${res.trade.tradeCode} approved! $${(res.settlement.sellerNetPayoutCents / 100).toFixed(2)} USD settled to seller.`,
        });
        loadQueue();
        loadOverview();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to approve trade.' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRejectTrade = async (tradeId: string) => {
    const reason = window.prompt('Enter rejection reason (will alert seller to provide proof):');
    if (!reason || reason.trim().length < 5) {
      alert('Rejection reason must be at least 5 characters.');
      return;
    }
    try {
      setActionInProgress(tradeId);
      const res = await rejectExchangeTrade(tradeId, reason);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Trade ${res.trade.tradeCode} rejected from approval. Reverted to additional proof requested.`,
        });
        loadQueue();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to reject trade.' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRequestProof = async (tradeId: string) => {
    const reason = window.prompt('Enter specific proof instructions for seller:');
    if (!reason || reason.trim().length < 5) return;
    try {
      setActionInProgress(tradeId);
      const res = await requestAdditionalExchangeProof(tradeId, reason);
      if (res.success) {
        setFeedback({ type: 'success', message: `Additional proof requested for ${res.trade.tradeCode}.` });
        loadQueue();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to request proof.' });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAddInternalNote = async (tradeId: string) => {
    const note = window.prompt('Enter internal staff note (never visible to buyer/seller):');
    if (!note || note.trim().length === 0) return;
    try {
      setActionInProgress(tradeId);
      const res = await addTradeInternalNote(tradeId, note);
      if (res.success) {
        setFeedback({ type: 'success', message: 'Internal note saved.' });
        loadQueue();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to add internal note.' });
    } finally {
      setActionInProgress(null);
    }
  };

  // ─── Dispute Resolution Action ─────────────────────────────────────────────

  const handleResolveDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingDispute) return;
    if (!disputeNote || disputeNote.trim().length < 5) {
      alert('Please provide a detailed resolution rationale note.');
      return;
    }

    try {
      setSubmittingResolution(true);
      const res = await resolveExchangeDispute(resolvingDispute.id, {
        outcome: disputeOutcome,
        buyerRefundCents: disputeOutcome === 'PARTIAL_REFUND' ? disputeBuyerRefundCents : undefined,
        sellerPayoutCents: disputeOutcome === 'PARTIAL_REFUND' ? disputeSellerPayoutCents : undefined,
        note: disputeNote.trim(),
      });
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Dispute ${resolvingDispute.disputeCode} resolved with outcome: ${disputeOutcome}.`,
        });
        setResolvingDispute(null);
        setDisputeNote('');
        loadDisputes(disputesPage);
        loadOverview();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to resolve dispute.' });
    } finally {
      setSubmittingResolution(false);
    }
  };

  // ─── Bank Receipt Review Action ────────────────────────────────────────────

  const handleReviewBankPayment = async (paymentId: string, action: 'CONFIRM' | 'REJECT') => {
    const notes = window.prompt(`Enter note for ${action === 'CONFIRM' ? 'approving' : 'rejecting'} bank payment:`);
    if (notes === null) return;
    try {
      setReviewingPaymentId(paymentId);
      const res = await adminReviewExchangePayment(paymentId, { action, notes });
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Bank payment ${action === 'CONFIRM' ? 'confirmed & escrow funded' : 'rejected'}.`,
        });
        loadPayments();
        loadOverview();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to review payment.' });
    } finally {
      setReviewingPaymentId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header Banner */}
      <div
        style={{
          backgroundColor: '#13151C',
          borderRadius: '14px',
          border: '1px solid #27272A',
          padding: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
            🤝 G4X Exchange Operations & Settlement Hub
          </h2>
          <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '4px' }}>
            Comprehensive trade oversight, final approval queue, escrow releases, disputes, payments, and immutable audit logs.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => {
              loadOverview();
              if (activeSubTab === 'approval_queue') loadQueue();
              if (activeSubTab === 'trades') loadTrades(tradesPage);
              if (activeSubTab === 'disputes') loadDisputes(disputesPage);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#1E202B',
              color: '#FACC15',
              border: '1px solid #374151',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            🔄 Refresh Hub
          </button>
        </div>
      </div>

      {/* Feedback Message */}
      {feedback && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${feedback.type === 'success' ? '#10B981' : '#EF4444'}`,
            color: feedback.type === 'success' ? '#10B981' : '#EF4444',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Sub-Tab Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          backgroundColor: '#13151C',
          padding: '8px',
          borderRadius: '12px',
          border: '1px solid #27272A',
        }}
      >
        {[
          { key: 'overview', label: '📊 Overview' },
          { key: 'approval_queue', label: `⏳ Approval Queue ${overviewKpis?.awaitingFinalApprovalCount ? `(${overviewKpis.awaitingFinalApprovalCount})` : ''}` },
          { key: 'exchangers', label: '👥 Exchangers' },
          { key: 'trades', label: '📜 Trades' },
          { key: 'disputes', label: `🚨 Disputes ${overviewKpis?.activeDisputesCount ? `(${overviewKpis.activeDisputesCount})` : ''}` },
          { key: 'payments_refunds', label: '💳 Payments & Escrow' },
          { key: 'transactions', label: '💰 Settlements' },
          { key: 'audit', label: '🛡️ Audit Logs' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveSubTab(tab.key as ExchangeOpsTab)}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeSubTab === tab.key ? '#3B82F6' : 'transparent',
              color: activeSubTab === tab.key ? '#FFFFFF' : '#9CA3AF',
              fontWeight: activeSubTab === tab.key ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 1: OVERVIEW & 9 KPI CARDS                                      */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {loadingOverview && !overviewKpis ? (
            <LoadingState message="Loading Exchange KPI metrics..." />
          ) : (
            <>
              {/* 9 PRD KPI Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {/* 1. Total Completed Volume */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>COMPLETED VOLUME</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10B981', marginTop: '4px' }}>
                    ${((overviewKpis?.totalCompletedTradesVolumeCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>Total trade gross value finalized</div>
                </div>

                {/* 2. Platform Revenue */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>PLATFORM REVENUE</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#FACC15', marginTop: '4px' }}>
                    ${((overviewKpis?.totalPlatformRevenueCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>G4X fees retained in Treasury</div>
                </div>

                {/* 3. Active Escrow Reserved */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>ACTIVE ESCROW (RESERVED)</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#38BDF8', marginTop: '4px' }}>
                    ${((overviewKpis?.activeEscrowReservedCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>Funds protected in ongoing trades</div>
                </div>

                {/* 4. Disputed Escrow Frozen */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>DISPUTED (FROZEN) ESCROW</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#EF4444', marginTop: '4px' }}>
                    ${((overviewKpis?.disputedEscrowFrozenCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>Funds locked pending dispute review</div>
                </div>

                {/* 5. Awaiting Final Review */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #38BDF8', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#38BDF8', textTransform: 'uppercase', fontWeight: 700 }}>AWAITING FINAL APPROVAL</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', marginTop: '4px' }}>
                    {overviewKpis?.awaitingFinalApprovalCount || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '4px' }}>Buyer confirmed • Requires staff payout sign-off</div>
                </div>

                {/* 6. Active Disputes */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #EF4444', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#EF4444', textTransform: 'uppercase', fontWeight: 700 }}>ACTIVE DISPUTES</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', marginTop: '4px' }}>
                    {overviewKpis?.activeDisputesCount || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '4px' }}>Open cases needing staff mediation</div>
                </div>

                {/* 7. Pending Exchanger KYC */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>PENDING KYC REQUESTS</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', marginTop: '4px' }}>
                    {overviewKpis?.pendingKycRequestsCount || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>Exchangers awaiting document verification</div>
                </div>

                {/* 8. Active In-Delivery Trades */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>ACTIVE TRADES IN DELIVERY</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', marginTop: '4px' }}>
                    {overviewKpis?.activeTradesCount || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>Currently coordinating in Discord/Web</div>
                </div>

                {/* 9. Completed Trades Count */}
                <div style={{ backgroundColor: '#13151C', borderRadius: '12px', border: '1px solid #27272A', padding: '18px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase' }}>LIFETIME COMPLETED TRADES</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', marginTop: '4px' }}>
                    {overviewKpis?.totalCompletedTradesCount || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>100% fulfilled without issue</div>
                </div>
              </div>

              {/* Quick Actions & Recent Settlements */}
              <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                    ⚡ Recent Settled Transactions
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('transactions')}
                    style={{ background: 'none', border: 'none', color: '#3B82F6', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                  >
                    View All Settlements →
                  </button>
                </div>

                {recentSettlements.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF' }}>No settlements recorded yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #27272A', color: '#9CA3AF' }}>
                          <th style={{ padding: '10px' }}>SETTLEMENT CODE</th>
                          <th style={{ padding: '10px' }}>TRADE</th>
                          <th style={{ padding: '10px' }}>GROSS VALUE</th>
                          <th style={{ padding: '10px' }}>SELLER NET PAYOUT</th>
                          <th style={{ padding: '10px' }}>G4X REVENUE</th>
                          <th style={{ padding: '10px' }}>SETTLED AT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentSettlements.map((s) => (
                          <tr key={s.id} style={{ borderBottom: '1px solid #1E202B' }}>
                            <td style={{ padding: '12px 10px', fontWeight: 700, color: '#FACC15', fontFamily: 'monospace' }}>
                              {s.settlementCode}
                            </td>
                            <td style={{ padding: '12px 10px' }}>
                              <Link to={`/exchange/trades/${s.tradeId}`} style={{ color: '#38BDF8', textDecoration: 'none' }}>
                                {s.trade?.tradeCode || s.tradeId}
                              </Link>
                            </td>
                            <td style={{ padding: '12px 10px', color: '#FFFFFF' }}>
                              ${(s.grossValueCents / 100).toFixed(2)}
                            </td>
                            <td style={{ padding: '12px 10px', color: '#10B981', fontWeight: 700 }}>
                              ${(s.sellerNetPayoutCents / 100).toFixed(2)}
                            </td>
                            <td style={{ padding: '12px 10px', color: '#FACC15' }}>
                              ${(s.g4xTotalRevenueCents / 100).toFixed(2)}
                            </td>
                            <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                              {new Date(s.settledAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 2: APPROVAL QUEUE                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'approval_queue' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                ⏳ Final Approval & Payout Queue ({approvalQueue.length})
              </h3>
              <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '2px' }}>
                Buyer has confirmed receipt of goods. Review proof evidence and approve idempotent payout release to Seller.
              </div>
            </div>
            <button
              type="button"
              onClick={loadQueue}
              style={{
                padding: '6px 14px',
                backgroundColor: '#1E202B',
                color: '#D1D5DB',
                border: '1px solid #374151',
                borderRadius: '6px',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              🔄 Refresh Queue
            </button>
          </div>

          {loadingQueue ? (
            <LoadingState message="Loading approval queue..." />
          ) : approvalQueue.length === 0 ? (
            <div style={{ backgroundColor: '#1E202B', borderRadius: '10px', padding: '32px', textAlign: 'center', color: '#10B981' }}>
              🎉 All pending delivery confirmations have been processed! No trades awaiting final approval.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {approvalQueue.map((item) => (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: '#1E202B',
                    borderRadius: '12px',
                    border: '1px solid #374151',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FACC15' }}>
                        {item.tradeCode}
                      </span>
                      <span style={{ color: '#D1D5DB', fontSize: '0.9rem' }}>
                        {item.game?.displayName} • {item.currency?.displayName}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>
                        Confirmed on: {item.buyerConfirmedAt ? new Date(item.buyerConfirmedAt).toLocaleString() : 'N/A'}
                      </span>
                      <Link
                        to={`/exchange/trades/${item.id}`}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: '#13151C',
                          color: '#38BDF8',
                          borderRadius: '6px',
                          textDecoration: 'none',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          border: '1px solid #374151',
                        }}
                      >
                        Open Trade Page ↗
                      </Link>
                    </div>
                  </div>

                  {/* Financial & Delivery Details */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '12px',
                      backgroundColor: '#13151C',
                      padding: '14px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>BUYER</div>
                      <div style={{ color: '#FFFFFF', fontWeight: 700 }}>
                        {item.buyer?.displayName || item.buyer?.username || item.buyerDiscordId}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>SELLER</div>
                      <div style={{ color: '#FFFFFF', fontWeight: 700 }}>
                        {item.seller?.displayName || item.seller?.username || item.sellerDiscordId}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>PAYOUT TO SELLER</div>
                      <div style={{ color: '#10B981', fontWeight: 800, fontSize: '1.1rem' }}>
                        ${(item.netSellerCents / 100).toFixed(2)} USD
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>G4X REVENUE</div>
                      <div style={{ color: '#FACC15', fontWeight: 700 }}>
                        ${((item.buyerFeeCents + item.sellerFeeCents) / 100).toFixed(2)} USD
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>PROOFS SUBMITTED</div>
                      <div style={{ color: '#D1D5DB', fontWeight: 600 }}>
                        {item.proofs?.length || 0} Document(s)
                      </div>
                    </div>
                  </div>

                  {/* Proof Attachments Quick View */}
                  {item.proofs && item.proofs.length > 0 && (
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {item.proofs.map((p, i) => (
                        <a
                          key={p.id || i}
                          href={p.fileUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#27272A',
                            color: '#38BDF8',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            textDecoration: 'none',
                          }}
                        >
                          📎 Proof #{i + 1} ({p.submitterRole}) ↗
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Staff Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid #2D303E', paddingTop: '12px' }}>
                    <button
                      type="button"
                      onClick={() => handleApproveTrade(item.id)}
                      disabled={actionInProgress === item.id}
                      style={{
                        padding: '8px 18px',
                        backgroundColor: '#10B981',
                        color: '#000000',
                        fontWeight: 800,
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: actionInProgress === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {actionInProgress === item.id ? 'Processing...' : '✅ Approve & Settle Payout'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRejectTrade(item.id)}
                      disabled={actionInProgress === item.id}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        color: '#EF4444',
                        fontWeight: 700,
                        border: '1px solid #EF4444',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: actionInProgress === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ❌ Reject Payout
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRequestProof(item.id)}
                      disabled={actionInProgress === item.id}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#1E202B',
                        color: '#FACC15',
                        fontWeight: 600,
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: actionInProgress === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ⚠️ Request Proof
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAddInternalNote(item.id)}
                      disabled={actionInProgress === item.id}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#1E202B',
                        color: '#9CA3AF',
                        fontWeight: 600,
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: actionInProgress === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      📝 Internal Note
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 3: EXCHANGERS MANAGEMENT                                       */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'exchangers' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '16px' }}>
            👥 Exchangers & Verified Reserves ({exchangers.length})
          </h3>

          {loadingExchangers ? (
            <LoadingState message="Loading exchangers..." />
          ) : exchangers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>No registered exchangers found.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #27272A', color: '#9CA3AF' }}>
                    <th style={{ padding: '10px' }}>USER</th>
                    <th style={{ padding: '10px' }}>ROLES</th>
                    <th style={{ padding: '10px' }}>KYC STATUS</th>
                    <th style={{ padding: '10px' }}>COMPLETED TRADES</th>
                    <th style={{ padding: '10px' }}>TOTAL VOLUME</th>
                    <th style={{ padding: '10px' }}>SELLING PERMISSION</th>
                  </tr>
                </thead>
                <tbody>
                  {exchangers.map((u) => (
                    <tr key={u.discordId} style={{ borderBottom: '1px solid #1E202B' }}>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF', fontWeight: 600 }}>
                        {u.displayName || u.username} ({u.discordId})
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        {(u.roles || []).join(', ')}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor: u.latestKyc?.status === 'APPROVED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(250, 204, 21, 0.2)',
                            color: u.latestKyc?.status === 'APPROVED' ? '#10B981' : '#FACC15',
                          }}
                        >
                          {u.latestKyc?.status || 'NOT_SUBMITTED'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF', fontWeight: 700 }}>
                        {u.completedTradesCount}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#10B981', fontWeight: 700 }}>
                        ${((u.totalVolumeCents || 0) / 100).toFixed(2)} USD
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        {u.permissions?.canSell ? (
                          <span style={{ color: '#10B981', fontWeight: 700 }}>Active</span>
                        ) : (
                          <span style={{ color: '#EF4444' }}>Restricted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 4: ALL TRADES (FILTERABLE & PAGINATED)                           */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'trades' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              📜 All Exchange Trades ({tradesTotal})
            </h3>

            {/* Filter Bar */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search by code or Discord ID..."
                value={tradesSearch}
                onChange={(e) => setTradesSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadTrades(1);
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              />

              <select
                value={tradesStatusFilter}
                onChange={(e) => {
                  setTradesStatusFilter(e.target.value);
                  setTimeout(() => loadTrades(1), 50);
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1E202B',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="AWAITING_PAYMENT">Awaiting Payment</option>
                <option value="PAYMENT_CONFIRMED">Payment Confirmed</option>
                <option value="DELIVERY_IN_PROGRESS">Delivery in Progress</option>
                <option value="PROOF_SUBMITTED">Proof Submitted</option>
                <option value="AWAITING_FINAL_APPROVAL">Awaiting Final Approval</option>
                <option value="COMPLETED">Completed</option>
                <option value="DISPUTED">Disputed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <button
                type="button"
                onClick={() => loadTrades(1)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#3B82F6',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Filter
              </button>
            </div>
          </div>

          {loadingTrades ? (
            <LoadingState message="Loading exchange trades..." />
          ) : trades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>No trades match the filter.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #27272A', color: '#9CA3AF' }}>
                    <th style={{ padding: '10px' }}>TRADE CODE</th>
                    <th style={{ padding: '10px' }}>ITEM</th>
                    <th style={{ padding: '10px' }}>GROSS VALUE</th>
                    <th style={{ padding: '10px' }}>BUYER</th>
                    <th style={{ padding: '10px' }}>SELLER</th>
                    <th style={{ padding: '10px' }}>STATUS</th>
                    <th style={{ padding: '10px' }}>DATE</th>
                    <th style={{ padding: '10px' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1E202B' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 700, color: '#FACC15', fontFamily: 'monospace' }}>
                        {t.tradeCode}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF' }}>
                        {t.game?.name} • {t.currency?.name}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF', fontWeight: 600 }}>
                        ${(t.grossValueCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#9CA3AF' }}>
                        {t.buyer?.username || t.buyerDiscordId}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#9CA3AF' }}>
                        {t.seller?.username || t.sellerDiscordId}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor:
                              t.status === 'COMPLETED'
                                ? 'rgba(16, 185, 129, 0.2)'
                                : t.status === 'CANCELLED'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : t.status === 'AWAITING_FINAL_APPROVAL'
                                ? 'rgba(56, 189, 248, 0.2)'
                                : 'rgba(250, 204, 21, 0.2)',
                            color:
                              t.status === 'COMPLETED'
                                ? '#10B981'
                                : t.status === 'CANCELLED'
                                ? '#EF4444'
                                : t.status === 'AWAITING_FINAL_APPROVAL'
                                ? '#38BDF8'
                                : '#FACC15',
                          }}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <Link
                          to={`/exchange/trades/${t.id}`}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#1E202B',
                            color: '#38BDF8',
                            borderRadius: '4px',
                            textDecoration: 'none',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          Details ↗
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 5: DISPUTE MANAGEMENT                                           */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'disputes' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#EF4444', margin: 0 }}>
                🚨 Formal Disputes & Mediation ({disputesTotal})
              </h3>
              <div style={{ fontSize: '0.85rem', color: '#9CA3AF', marginTop: '2px' }}>
                Manage disputes with 5 resolution outcomes: Release to Seller, Full Refund, Partial Refund, Request Proof, or Cancel.
              </div>
            </div>

            <select
              value={disputesStatusFilter}
              onChange={(e) => {
                setDisputesStatusFilter(e.target.value);
                setTimeout(() => loadDisputes(1), 50);
              }}
              style={{
                padding: '8px 12px',
                backgroundColor: '#1E202B',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
              }}
            >
              <option value="ALL">All Disputes</option>
              <option value="OPEN">Open Cases</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="AWAITING_PROOF">Awaiting Proof</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {loadingDisputes ? (
            <LoadingState message="Loading disputes..." />
          ) : disputes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#10B981' }}>No disputes found. All trades peaceful!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {disputes.map((d) => (
                <div
                  key={d.id}
                  style={{
                    backgroundColor: '#1E202B',
                    borderRadius: '10px',
                    border: '1px solid #374151',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontWeight: 800, color: '#EF4444', fontSize: '1rem', fontFamily: 'monospace' }}>
                        {d.disputeCode}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: '#D1D5DB' }}>
                        Trade: <Link to={`/exchange/trades/${d.tradeId}`} style={{ color: '#38BDF8' }}>{d.trade?.tradeCode || d.tradeId}</Link>
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          backgroundColor: d.status === 'RESOLVED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: d.status === 'RESOLVED' ? '#10B981' : '#EF4444',
                        }}
                      >
                        {d.status}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                        {new Date(d.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.85rem', color: '#FACC15' }}>
                    <strong>Category:</strong> {d.category} • <strong>Filed By:</strong> {d.openedByRole} ({d.openedByUser?.username || d.openedByDiscordId})
                  </div>

                  <div style={{ backgroundColor: '#13151C', padding: '10px 14px', borderRadius: '6px', fontSize: '0.85rem', color: '#D1D5DB' }}>
                    {d.description}
                  </div>

                  {d.resolutionOutcome && (
                    <div style={{ fontSize: '0.85rem', color: '#10B981' }}>
                      <strong>Outcome:</strong> {d.resolutionOutcome} {d.resolutionNote ? `— ${d.resolutionNote}` : ''}
                    </div>
                  )}

                  {d.status !== 'RESOLVED' && d.status !== 'CLOSED' && (
                    <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setResolvingDispute(d);
                          setDisputeBuyerRefundCents(0);
                          setDisputeSellerPayoutCents(0);
                          setDisputeNote('');
                        }}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: '#EF4444',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                        }}
                      >
                        ⚖️ Intervene & Resolve Dispute
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 6: PAYMENTS & ESCROW                                           */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'payments_refunds' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '16px' }}>
            💳 Exchange Payments & Escrow Ledger ({payments.length})
          </h3>

          {loadingPayments ? (
            <LoadingState message="Loading exchange payments..." />
          ) : payments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>No payments logged yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #27272A', color: '#9CA3AF' }}>
                    <th style={{ padding: '10px' }}>CODE</th>
                    <th style={{ padding: '10px' }}>METHOD</th>
                    <th style={{ padding: '10px' }}>TOTAL DUE</th>
                    <th style={{ padding: '10px' }}>STATUS</th>
                    <th style={{ padding: '10px' }}>BANK RECEIPT</th>
                    <th style={{ padding: '10px' }}>DATE</th>
                    <th style={{ padding: '10px' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1E202B' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 700, color: '#FACC15', fontFamily: 'monospace' }}>
                        {p.paymentCode}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF' }}>
                        {p.method}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#10B981', fontWeight: 700 }}>
                        ${(p.totalPayableCents / 100).toFixed(2)} USD
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor:
                              p.status === 'CONFIRMED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(250, 204, 21, 0.2)',
                            color: p.status === 'CONFIRMED' ? '#10B981' : '#FACC15',
                          }}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        {p.bankReceiptUrl ? (
                          <a
                            href={p.bankReceiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#38BDF8', fontSize: '0.8rem' }}
                          >
                            View Receipt ↗
                          </a>
                        ) : (
                          <span style={{ color: '#6B7280' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        {p.method === 'BANK_TRANSFER' && p.status === 'PENDING_REVIEW' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => handleReviewBankPayment(p.id, 'CONFIRM')}
                              disabled={reviewingPaymentId === p.id}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: '#10B981',
                                color: '#000000',
                                fontWeight: 700,
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReviewBankPayment(p.id, 'REJECT')}
                              disabled={reviewingPaymentId === p.id}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: '#EF4444',
                                color: '#FFFFFF',
                                fontWeight: 700,
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 7: SETTLEMENTS                                                 */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'transactions' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '16px' }}>
            💰 Finalized Settlements Ledger ({settlementsTotal})
          </h3>

          {loadingSettlements ? (
            <LoadingState message="Loading settlements..." />
          ) : settlements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>No settlements recorded.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #27272A', color: '#9CA3AF' }}>
                    <th style={{ padding: '10px' }}>SETTLEMENT CODE</th>
                    <th style={{ padding: '10px' }}>TRADE</th>
                    <th style={{ padding: '10px' }}>TYPE</th>
                    <th style={{ padding: '10px' }}>GROSS VALUE</th>
                    <th style={{ padding: '10px' }}>SELLER NET PAYOUT</th>
                    <th style={{ padding: '10px' }}>G4X REVENUE</th>
                    <th style={{ padding: '10px' }}>BUYER REFUND</th>
                    <th style={{ padding: '10px' }}>SETTLED AT</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #1E202B' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 700, color: '#FACC15', fontFamily: 'monospace' }}>
                        {s.settlementCode}
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <Link to={`/exchange/trades/${s.tradeId}`} style={{ color: '#38BDF8', textDecoration: 'none' }}>
                          {s.trade?.tradeCode || s.tradeId}
                        </Link>
                      </td>
                      <td style={{ padding: '12px 10px', color: '#D1D5DB' }}>
                        {s.settlementType}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FFFFFF' }}>
                        ${(s.grossValueCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#10B981', fontWeight: 700 }}>
                        ${(s.sellerNetPayoutCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#FACC15' }}>
                        ${(s.g4xTotalRevenueCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 10px', color: s.buyerRefundCents > 0 ? '#38BDF8' : '#6B7280' }}>
                        ${(s.buyerRefundCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 8: AUDIT LOGS                                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'audit' && (
        <div style={{ backgroundColor: '#13151C', borderRadius: '14px', border: '1px solid #27272A', padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '16px' }}>
            🛡️ Immutable Exchange Audit Logs ({auditLogsTotal})
          </h3>

          {loadingAudit ? (
            <LoadingState message="Loading audit trail..." />
          ) : auditLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>No audit logs recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    backgroundColor: '#1E202B',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    border: '1px solid #2D303E',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, color: '#FACC15' }}>
                      {log.action} • {log.entityType} ({log.entityId})
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ color: '#D1D5DB' }}>
                    Actor: <span style={{ color: '#38BDF8' }}>{log.actorId}</span> {log.reason ? `• Reason: "${log.reason}"` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL: RESOLVE DISPUTE ─────────────────────────────────────────── */}
      {resolvingDispute && (
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
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#13151C',
              borderRadius: '14px',
              border: '1px solid #EF4444',
              padding: '24px',
              width: '100%',
              maxWidth: '540px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#EF4444', margin: 0 }}>
                ⚖️ Resolve Dispute ({resolvingDispute.disputeCode})
              </h3>
              <button
                type="button"
                onClick={() => setResolvingDispute(null)}
                style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '1.4rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleResolveDispute}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                  Select Resolution Outcome *
                </label>
                <select
                  value={disputeOutcome}
                  onChange={(e) => setDisputeOutcome(e.target.value as DisputeResolutionOutcome)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#FFFFFF',
                    fontSize: '0.9rem',
                  }}
                >
                  <option value="RELEASE_TO_SELLER">RELEASE_TO_SELLER — Settle trade in full to Seller</option>
                  <option value="FULL_REFUND_TO_BUYER">FULL_REFUND_TO_BUYER — Refund Buyer in full & cancel</option>
                  <option value="PARTIAL_REFUND">PARTIAL_REFUND — Split escrow funds between Buyer & Seller</option>
                  <option value="REQUEST_ADDITIONAL_PROOF">REQUEST_ADDITIONAL_PROOF — Require further evidence</option>
                  <option value="CANCEL_TRADE">CANCEL_TRADE — Cancel trade</option>
                </select>
              </div>

              {disputeOutcome === 'PARTIAL_REFUND' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px' }}>
                      Buyer Refund (Cents)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={disputeBuyerRefundCents}
                      onChange={(e) => setDisputeBuyerRefundCents(parseInt(e.target.value, 10) || 0)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#1E202B',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', marginBottom: '4px' }}>
                      Seller Payout (Cents)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={disputeSellerPayoutCents}
                      onChange={(e) => setDisputeSellerPayoutCents(parseInt(e.target.value, 10) || 0)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        backgroundColor: '#1E202B',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                      }}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#D1D5DB', marginBottom: '6px' }}>
                  Resolution Rationale / Note (Required) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Explain why this resolution was decided..."
                  value={disputeNote}
                  onChange={(e) => setDisputeNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#1E202B',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#FFFFFF',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setResolvingDispute(null)}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: '#1E202B',
                    color: '#D1D5DB',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingResolution}
                  style={{
                    padding: '10px 22px',
                    backgroundColor: '#EF4444',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    cursor: submittingResolution ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submittingResolution ? 'Executing...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
