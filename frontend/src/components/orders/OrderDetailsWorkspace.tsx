import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { OrderDiagnosticsData, OrderAuditLogItem } from '../../types/operations';
import { BoostSpecsBadgeGrid } from './BoostSpecsBadgeGrid';

export type Action =
  | 'publish'
  | 'refresh_card'
  | 'staff_review'
  | 'final_approve'
  | 'pay_wallet'
  | 'verify_payment'
  | 'cancel';

export const actionLabels: Record<Action, string> = {
  publish: 'Publish to Discord',
  refresh_card: 'Refresh Discord card',
  staff_review: 'Staff review',
  final_approve: 'Final operational approval',
  pay_wallet: 'Reserve creator wallet funds',
  verify_payment: 'Verify payment receipt',
  cancel: 'Cancel order',
};

const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

function Evidence({ value }: { value: string }) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) {
      return (
        <a href={url.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-lime)', textDecoration: 'underline' }}>
          Open evidence ↗
        </a>
      );
    }
  } catch {
    /* Private file references are shown as text. */
  }
  return <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{value}</span>;
}

export interface OrderDetailsWorkspaceProps {
  details: OrderDiagnosticsData;
  detailsLoading?: boolean;
  detailsError?: string;
  actionError?: string;
  feedback?: string;
  action: Action | null;
  setAction: (action: Action | null) => void;
  reason: string;
  setReason: (reason: string) => void;
  receipt: string;
  setReceipt: (receipt: string) => void;
  submitAction: (e: React.FormEvent) => void;
  busy: boolean;
  targetStatus: string;
  setTargetStatus: (status: string) => void;
  statusNote: string;
  setStatusNote: (note: string) => void;
  updatingStatus: boolean;
  statusFeedback: { text: string; type: 'success' | 'error' } | null;
  onUpdateStatus: (e: React.FormEvent) => Promise<void>;
  syncingChannel: boolean;
  syncChannelFeedback: { text: string; type: 'success' | 'error' } | null;
  onSyncChannel: () => Promise<void>;
  opNotes: string;
  setOpNotes: (notes: string) => void;
  opExternalId: string;
  setOpExternalId: (id: string) => void;
  opReason: string;
  setOpReason: (reason: string) => void;
  opFeedback: { text: string; type: 'success' | 'error' } | null;
  savingOp: boolean;
  onSaveOperational: (e: React.FormEvent) => Promise<void>;
  approvedBoosters: Array<{
    userId: string;
    username: string;
    displayName: string;
    roles: string[];
    hasActiveReservation: boolean;
    activeOrderId: number | null;
  }>;
  directBoosterUserId: string;
  setDirectBoosterUserId: (id: string) => void;
  directBoosterRole: string;
  setDirectBoosterRole: (role: string) => void;
  submittingDirectAssign: boolean;
  directAssignFeedback: { text: string; type: 'success' | 'error' } | null;
  onDirectBoosterAssign: (e: React.FormEvent) => Promise<void>;
  selectedClaims: Record<number, string>;
  setSelectedClaims: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onConfirmRoster: (e: React.FormEvent) => void;
  isReadOnly: boolean;
  hasRole: (role: string, ...rest: string[]) => boolean;
  onClose: () => void;
  onOpenFullEditor?: (orderId: number) => void;
  onRetry?: () => void;
}

export type WorkspaceTabKey =
  | 'overview'
  | 'lifecycle'
  | 'roster'
  | 'runs'
  | 'financial'
  | 'discord'
  | 'activity';

export const OrderDetailsWorkspace: React.FC<OrderDetailsWorkspaceProps> = ({
  details,
  actionError,
  feedback,
  action,
  setAction,
  reason,
  setReason,
  receipt,
  setReceipt,
  submitAction,
  busy,
  targetStatus,
  setTargetStatus,
  statusNote,
  setStatusNote,
  updatingStatus,
  statusFeedback,
  onUpdateStatus,
  syncingChannel,
  syncChannelFeedback,
  onSyncChannel,
  opNotes,
  setOpNotes,
  opExternalId,
  setOpExternalId,
  opReason,
  setOpReason,
  opFeedback,
  savingOp,
  onSaveOperational,
  approvedBoosters,
  directBoosterUserId,
  setDirectBoosterUserId,
  directBoosterRole,
  setDirectBoosterRole,
  submittingDirectAssign,
  directAssignFeedback,
  onDirectBoosterAssign,
  selectedClaims,
  setSelectedClaims,
  onConfirmRoster,
  isReadOnly,
  hasRole,
  onClose,
  onOpenFullEditor,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('overview');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);

  // Booster filtering in Team & Roster
  const [boosterSearch, setBoosterSearch] = useState('');
  const [boosterRoleFilter, setBoosterRoleFilter] = useState('all');

  // Audit Log filtering
  const [auditFilter, setAuditFilter] = useState<'all' | 'lifecycle' | 'financial' | 'roster' | 'system'>('all');

  // Financial calculations
  const grossNum = parseFloat(details.grossAmountUsd || '0') || 0;
  const feeNum = parseFloat(details.platformFeeUsd || '0') || 0;
  const poolNum = parseFloat(details.boosterPoolUsd || '0') || 0;
  const netPlatformMargin = Math.round((grossNum - feeNum - poolNum) * 100) / 100;

  // Pipeline Stepper calculations
  const statusLower = (details.status || '').toLowerCase();
  const isDoneStage =
    statusLower === 'done' ||
    statusLower === 'completed' ||
    details.boostReleaseTracker?.stage === 'AVAILABLE' ||
    Boolean(details.boostReleaseTracker?.isReleased);

  let activeStep = 1;
  if (statusLower === 'waiting_for_confirm') activeStep = 2;
  else if (statusLower === 'warranty') activeStep = 3;
  else if (isDoneStage) activeStep = 4;
  else if (['assigned', 'in_progress', 'pending_review'].includes(statusLower)) activeStep = 1;

  const steps = [
    { num: 1, title: 'Run Execution', subtitle: 'In Progress & Proof', icon: '⚔️' },
    { num: 2, title: 'Customer Confirm', subtitle: 'Waiting Confirm', icon: '⏳' },
    { num: 3, title: 'Warranty Period', subtitle: 'Safety Window', icon: '🛡️' },
    { num: 4, title: 'Done (Withdrawable)', subtitle: 'Instant Release', icon: '💰' },
  ];

  // Filtered boosters
  const filteredBoosters = useMemo(() => {
    return approvedBoosters.filter((b) => {
      const name = (b.displayName || b.username || '').toLowerCase();
      const matchesSearch = !boosterSearch || name.includes(boosterSearch.toLowerCase());
      const matchesRole = boosterRoleFilter === 'all' || b.roles.includes(boosterRoleFilter);
      return matchesSearch && matchesRole;
    });
  }, [approvedBoosters, boosterSearch, boosterRoleFilter]);

  // Filtered audit logs
  const filteredAuditLogs = useMemo(() => {
    if (!details.auditLogs) return [];
    if (auditFilter === 'all') return details.auditLogs;
    return details.auditLogs.filter((log) => {
      const act = (log.action || '').toLowerCase();
      if (auditFilter === 'lifecycle') {
        return act.includes('status') || act.includes('stage') || act.includes('lifecycle') || act.includes('complete') || act.includes('cancel');
      }
      if (auditFilter === 'financial') {
        return act.includes('finance') || act.includes('payment') || act.includes('payout') || act.includes('wallet') || act.includes('fee') || act.includes('pool');
      }
      if (auditFilter === 'roster') {
        return act.includes('assign') || act.includes('claim') || act.includes('roster') || act.includes('booster');
      }
      if (auditFilter === 'system') {
        return act.includes('discord') || act.includes('sync') || act.includes('system') || act.includes('channel');
      }
      return true;
    });
  }, [details.auditLogs, auditFilter]);

  const copyOrderRef = () => {
    if (details.orderRef) {
      navigator.clipboard?.writeText(details.orderRef);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1800);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    const s = (status || '').toLowerCase();
    if (['completed', 'approved', 'active', 'done'].includes(s)) return 'badge-green';
    if (['cancelled', 'disputed'].includes(s)) return 'badge-danger';
    if (['in_progress', 'warranty', 'waiting_for_confirm', 'assigned'].includes(s)) return 'badge-yellow';
    return 'badge-purple';
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '92vh',
        backgroundColor: '#0c0d14',
        borderRadius: '16px',
        overflow: 'hidden',
        color: 'var(--text-primary)',
      }}
    >
      {/* ─── 1. PERSISTENT STICKY ORDER HEADER ───────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: 'rgba(12, 13, 20, 0.96)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '14px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '260px', flex: '1 1 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
              {details.title || details.orderName || `Order #${details.orderId}`}
            </h2>
            <button
              type="button"
              onClick={copyOrderRef}
              title="Click to copy Order Ref"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                padding: '2px 8px',
                color: 'var(--accent-lime)',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>{details.orderRef}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{copiedRef ? '✓ Copied' : '📋'}</span>
            </button>
            {details.externalOrderId && (
              <span
                style={{
                  fontSize: '0.76rem',
                  fontFamily: 'monospace',
                  background: 'rgba(250, 204, 21, 0.1)',
                  color: 'var(--accent-yellow)',
                  border: '1px solid rgba(250, 204, 21, 0.25)',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontWeight: 600,
                }}
              >
                Ext: {details.externalOrderId}
              </span>
            )}
            <span
              style={{
                fontSize: '0.74rem',
                borderRadius: '6px',
                padding: '2px 8px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                background: details.externalOrderId ? 'rgba(139, 92, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: details.externalOrderId ? '#C4B5FD' : '#6EE7B7',
                border: details.externalOrderId ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              {details.externalOrderId ? 'Partner Order' : 'Direct G4X'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span>🎮 {details.gameName}</span>
            <span>•</span>
            <span style={{ color: '#E2E8F0' }}>{details.serviceName}</span>
            <span>•</span>
            <span className="badge badge-blue" style={{ fontSize: '0.72rem' }}>
              {details.orderMode === 'non_pilot' ? 'Self-Play' : 'Pilot'}
            </span>
            {details.boostModel && (
              <>
                <span>•</span>
                <span style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>{details.boostModel}</span>
              </>
            )}
            {details.vpnRequirement && (
              <>
                <span>•</span>
                <span style={{ color: 'var(--accent-lime)' }}>🛡️ {details.vpnRequirement}</span>
              </>
            )}
          </div>
        </div>

        {/* Header Right: KPIs & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Quick Financial pill */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total Order
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>
                ${details.grossAmountUsd} {details.currency}
              </div>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.08)' }} />
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--accent-yellow)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Booster Pool
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                ${details.boosterPoolUsd}
              </div>
            </div>
          </div>

          {/* Status badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
            <span className={`badge ${getStatusBadgeClass(details.status)}`} style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {details.status}
            </span>
            <span
              style={{
                fontSize: '0.72rem',
                color: details.paymentStatus === 'verified' ? '#10B981' : details.paymentStatus === 'pending' ? '#FBBF24' : 'var(--text-muted)',
              }}
            >
              Payment: <strong>{details.paymentStatus}</strong>
            </span>
          </div>

          {/* Actions */}
          {hasRole('admin', 'owner') && onOpenFullEditor && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{
                borderColor: 'rgba(250, 204, 21, 0.45)',
                color: '#facc15',
                backgroundColor: 'rgba(250, 204, 21, 0.06)',
                fontWeight: 600,
              }}
              title="Full Order Edit & Financial Override (Admin/Owner)"
              onClick={() => onOpenFullEditor(details.orderId)}
            >
              ✏️ Edit Order
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="studio-modal-close"
            aria-label="Close"
            style={{ fontSize: '1.1rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      </header>

      {/* ─── FEEDBACK & ALERTS BAR ─────────────────────────────────────────── */}
      {feedback && (
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderBottom: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px 24px', fontSize: '0.84rem', color: '#34D399' }}>
          ✓ {feedback}
        </div>
      )}
      {actionError && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', padding: '8px 24px', fontSize: '0.84rem', color: '#F87171' }}>
          ⚠️ {actionError}
        </div>
      )}

      {/* ─── TWO-COLUMN DESKTOP LAYOUT (MAIN 72% / STICKY SIDEBAR 28%) ───────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: '20px',
          padding: '20px 24px',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {/* ─── LEFT COLUMN (MAIN CONTENT 72%) ───────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {/* ─── NAVIGATION TABS ────────────────────────────────────────────── */}
          <nav
            style={{
              display: 'flex',
              gap: '6px',
              padding: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              overflowX: 'auto',
            }}
            aria-label="Order Workspace Tabs"
          >
            {[
              { id: 'overview', label: 'Overview', icon: '📋' },
              { id: 'lifecycle', label: 'Lifecycle', icon: '🔄' },
              { id: 'roster', label: 'Team & Roster', icon: '👥', count: details.assignments?.length },
              { id: 'runs', label: 'Runs & Proof', icon: '🏆', count: details.runs?.length },
              { id: 'financial', label: 'Financial', icon: '💰' },
              { id: 'discord', label: 'Discord', icon: '💬' },
              { id: 'activity', label: 'Activity Log', icon: '📜', count: details.auditLogs?.length },
            ].map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as WorkspaceTabKey)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '0.84rem',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#ffffff' : 'var(--text-muted)',
                    backgroundColor: isActive ? 'rgba(124, 58, 237, 0.3)' : 'transparent',
                    border: isActive ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                  {typeof t.count === 'number' && t.count > 0 && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        backgroundColor: isActive ? '#A855F7' : 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        fontWeight: 700,
                      }}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* ─── TAB CONTENT PANES ────────────────────────────────────────── */}

          {/* ── TAB 1: OVERVIEW ── */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Operational Warnings / Blockers Alert */}
              {details.publicationBlockReasons.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#F87171', fontWeight: 700, fontSize: '0.85rem' }}>
                    <span>⚠️</span>
                    <span>Publication Blockers Detected:</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem', color: '#FCA5A5' }}>
                    {details.publicationBlockReasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Visual G4X Completion Stepper */}
              <div
                style={{
                  background: 'linear-gradient(180deg, rgba(30, 27, 46, 0.7) 0%, rgba(15, 12, 28, 0.9) 100%)',
                  border: '1px solid rgba(124, 58, 237, 0.25)',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.1rem' }}>🔄</span>
                    <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#fff' }}>
                      G4X Order Completion &amp; Payout Pipeline
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {isDoneStage ? 'Released Booster Earnings:' : 'Pending Booster Earnings:'}
                    </span>
                    <span style={{ fontWeight: 800, color: isDoneStage ? '#10B981' : 'var(--accent-yellow)', fontSize: '0.92rem', fontFamily: 'monospace' }}>
                      ${details.boosterPoolUsd} USD
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {steps.map((st) => {
                    const isPast = activeStep > st.num;
                    const isCurrent = activeStep === st.num;
                    return (
                      <div
                        key={st.num}
                        style={{
                          background: isCurrent
                            ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.35) 0%, rgba(168, 85, 247, 0.2) 100%)'
                            : isPast
                            ? 'rgba(16, 185, 129, 0.1)'
                            : 'rgba(255, 255, 255, 0.02)',
                          border: isCurrent
                            ? '1px solid #A855F7'
                            : isPast
                            ? '1px solid rgba(16, 185, 129, 0.35)'
                            : '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.9rem' }}>{isPast ? '✅' : st.icon}</span>
                          <span
                            style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '8px',
                              background: isCurrent ? '#A855F7' : isPast ? '#10B981' : 'rgba(255,255,255,0.06)',
                              color: '#fff',
                            }}
                          >
                            Step {st.num}
                          </span>
                        </div>
                        <div style={{ fontWeight: isCurrent ? 800 : 600, fontSize: '0.8rem', color: isCurrent ? '#fff' : isPast ? '#D1FAE5' : 'var(--text-muted)' }}>
                          {st.title}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: isCurrent ? '#E9D5FF' : isPast ? '#6EE7B7' : 'rgba(255,255,255,0.3)' }}>
                          {st.subtitle}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {isDoneStage && (
                  <div
                    style={{
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                    }}
                  >
                    <span style={{ color: '#fff', fontWeight: 600 }}>
                      ✅ Order Completed &amp; Released: Booster earnings (${details.boosterPoolUsd} USD) ready for withdrawal.
                    </span>
                    <a href="/withdraw" className="btn btn-primary btn-xs" style={{ textDecoration: 'none' }}>
                      Request Withdrawal ↗
                    </a>
                  </div>
                )}
              </div>

              {/* Category-Specific Service Specifications */}
              <BoostSpecsBadgeGrid
                boostModel={details.boostModel}
                boostSpecs={details.boostSpecs}
                boostSpecsJson={details.boostSpecsJson}
              />

              {/* Order Meta & Parties Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Order &amp; Customer Information
                  </h4>
                  <div style={{ display: 'grid', gap: '6px', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Customer ID:</span>
                      <span style={{ fontFamily: 'monospace' }}>{details.customerId || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Creator ID:</span>
                      <span style={{ fontFamily: 'monospace' }}>{details.creatorId || '—'}</span>
                    </div>
                    {details.advertiserId && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Advertiser ID:</span>
                        <span style={{ fontFamily: 'monospace' }}>{details.advertiserId}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Source Platform:</span>
                      <span style={{ fontWeight: 600 }}>{details.externalOrderId ? 'External Partner' : 'Direct G4X'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>External Order ID:</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontWeight: 600 }}>
                        {details.externalOrderId || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Assigned Booster Summary
                  </h4>
                  {!details.assignments?.length ? (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '6px 0' }}>
                      No boosters assigned yet. Proceed to <strong>Team &amp; Roster</strong> tab to assign.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '6px' }}>
                      {details.assignments.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 8px',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: '6px',
                            fontSize: '0.82rem',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: '#fff' }}>{a.user.displayName || a.user.username}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginLeft: '6px' }}>({a.assignedRole})</span>
                          </div>
                          <span className={`badge ${a.status === 'assigned' ? 'badge-green' : 'badge-muted'}`} style={{ fontSize: '0.68rem' }}>
                            {a.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Instructions / Operational Notes */}
              {details.notes && (
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '14px', fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--accent-yellow)', display: 'block', marginBottom: '6px' }}>
                    📝 Customer / Run Notes:
                  </strong>
                  <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {details.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: LIFECYCLE ── */}
          {activeTab === 'lifecycle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Lifecycle status explanation */}
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🧭</span> Lifecycle Diagnostics &amp; Next Action
                  </h3>
                  <span className={`badge ${getStatusBadgeClass(details.status)}`}>{details.status}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {details.explanationEnglish}
                </div>
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.25)', fontSize: '0.82rem', color: '#C4B5FD' }}>
                  <strong style={{ color: '#fff' }}>Next Required Action:</strong> {details.requiredNextActionEnglish}
                </div>
              </div>

              {/* Lifecycle & Status Control */}
              {!isReadOnly && (
                <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🔄</span> Status Transition Control
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    Advance or transition order status. Actions validate against double-entry accounting and update Discord sync automatically.
                  </p>

                  <form onSubmit={onUpdateStatus} style={{ display: 'grid', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                      <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Target Lifecycle Status</span>
                        <select
                          className="input"
                          value={targetStatus}
                          onChange={(e) => setTargetStatus(e.target.value)}
                          disabled={updatingStatus}
                          style={{ padding: '8px 10px' }}
                        >
                          <option value="open_presign">Open Pre-sign (open_presign)</option>
                          <option value="assigned">Assigned / Squad Formed (assigned)</option>
                          <option value="in_progress">In Progress (in_progress)</option>
                          <option value="pending_review">Pending Final Review (pending_review)</option>
                          <option value="completed">Completed (completed)</option>
                          <option value="waiting_for_confirm">Waiting for Customer Confirmation (waiting_for_confirm)</option>
                          <option value="warranty">Warranty Period (warranty)</option>
                          <option value="done">Done (done - Instant Release &amp; Withdrawable)</option>
                          <option value="disputed">Disputed (disputed)</option>
                          <option value="cancelled">Cancelled (cancelled)</option>
                        </select>
                      </label>

                      <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Transition Note / Audit Reason</span>
                        <input
                          className="input"
                          placeholder="Audit reason or operational note..."
                          value={statusNote}
                          onChange={(e) => setStatusNote(e.target.value)}
                          disabled={updatingStatus}
                          style={{ padding: '8px 10px' }}
                        />
                      </label>
                    </div>

                    {/* Quick Select Buttons */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginRight: '4px' }}>Quick Select:</span>
                      {[
                        { id: 'open_presign', label: 'Open Pre-sign' },
                        { id: 'assigned', label: 'Assigned' },
                        { id: 'in_progress', label: 'In Progress' },
                        { id: 'pending_review', label: 'Pending Review' },
                        { id: 'completed', label: 'Completed' },
                        { id: 'waiting_for_confirm', label: 'Waiting Confirm' },
                        { id: 'warranty', label: 'Warranty' },
                        { id: 'done', label: 'Done' },
                        { id: 'disputed', label: 'Disputed' },
                        { id: 'cancelled', label: 'Cancelled' },
                      ].map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`btn btn-xs ${targetStatus === s.id ? 'btn-cta' : 'btn-secondary'}`}
                          onClick={() => setTargetStatus(s.id)}
                          disabled={updatingStatus}
                          style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    {statusFeedback && (
                      <p style={{ margin: 0, fontSize: '0.82rem', color: statusFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                        {statusFeedback.text}
                      </p>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                      <button
                        type="submit"
                        disabled={updatingStatus || !targetStatus || targetStatus === details.status}
                        className="btn btn-cta btn-sm"
                      >
                        {updatingStatus ? 'Updating Status…' : `Transition Status to '${targetStatus}'`}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: TEAM & ROSTER ── */}
          {activeTab === 'roster' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Required Roles Callout */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: '0.84rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Required Composition: </span>
                  <strong style={{ color: '#fff' }}>
                    {details.requiredRoles?.map((r) => `${r.quantity} ${r.roleName}`).join(', ') || 'Standard service roster'}
                  </strong>
                </div>
                <span className="badge badge-purple" style={{ fontSize: '0.74rem' }}>
                  {details.assignments?.length || 0} Booster(s) Assigned
                </span>
              </div>

              {/* Current Active Assignments */}
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚔️</span> Currently Assigned Roster
                </h3>

                {!details.assignments?.length ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No boosters assigned yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {details.assignments.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          fontSize: '0.84rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>{a.user.displayName || a.user.username}</span>
                          <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                            {a.assignedRole}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                            Assigned: {time(a.assignedAt)}
                          </span>
                        </div>
                        <span className={`badge ${a.status === 'assigned' ? 'badge-green' : 'badge-muted'}`} style={{ fontSize: '0.7rem' }}>
                          {a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Presigned Applicants Form */}
              {!isReadOnly && details.authorizedActions.includes('assign') && (
                <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📋</span> Registered Presign Applicants
                  </h3>
                  {!details.presigns?.length ? (
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No applicants presigned from Discord yet.</p>
                  ) : (
                    <form onSubmit={onConfirmRoster} style={{ display: 'grid', gap: '8px' }}>
                      {details.presigns.map((p) => (
                        <label
                          key={p.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            padding: '6px 10px',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: '6px',
                          }}
                        >
                          <span>
                            {p.user.displayName || p.user.username} {p.squadId ? `(Team ${p.squadId})` : ''}
                          </span>
                          <select
                            disabled={busy}
                            className="input"
                            style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                            value={selectedClaims[p.id] || ''}
                            onChange={(e) => {
                              const next = { ...selectedClaims };
                              if (e.target.value) next[p.id] = e.target.value;
                              else delete next[p.id];
                              setSelectedClaims(next);
                            }}
                          >
                            <option value="">Not selected</option>
                            {p.registeredRole
                              .split(',')
                              .filter((r) => ['tank', 'healer', 'dps', 'booster', 'pilot'].includes(r.trim()))
                              .map((r) => (
                                <option key={r} value={r.trim()}>
                                  {r.trim()}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <button
                          className="btn btn-cta btn-xs"
                          type="submit"
                          disabled={busy || !Object.keys(selectedClaims).length}
                        >
                          Confirm Selected Roster
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Direct Booster Assignment (Searchable & Filterable) */}
              {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                <div style={{ background: '#0e1017', border: '1px solid rgba(250, 204, 21, 0.25)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--accent-yellow)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>⚡</span> Direct Booster Assignment
                    </h3>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Assign directly without waiting for presign
                    </span>
                  </div>

                  {/* Filter & Search Bar */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto', gap: '8px' }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="Search approved boosters..."
                      value={boosterSearch}
                      onChange={(e) => setBoosterSearch(e.target.value)}
                      style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                    />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['all', 'tank', 'healer', 'dps', 'booster', 'pilot'].map((role) => (
                        <button
                          key={role}
                          type="button"
                          className={`btn btn-xs ${boosterRoleFilter === role ? 'btn-cta' : 'btn-secondary'}`}
                          onClick={() => setBoosterRoleFilter(role)}
                          style={{ fontSize: '0.72rem', textTransform: 'capitalize', padding: '2px 8px' }}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={onDirectBoosterAssign} style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '8px' }}>
                      <select
                        className="input"
                        value={directBoosterUserId}
                        onChange={(e) => setDirectBoosterUserId(e.target.value)}
                        required
                        style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                      >
                        <option value="">— Choose Approved Booster ({filteredBoosters.length} available) —</option>
                        {filteredBoosters.map((b) => (
                          <option key={b.userId} value={b.userId} disabled={b.hasActiveReservation}>
                            {b.displayName || b.username} ({b.roles.join(', ')})
                            {b.hasActiveReservation ? ` [Busy: Order #${b.activeOrderId}]` : ' [Available]'}
                          </option>
                        ))}
                      </select>

                      <select
                        className="input"
                        value={directBoosterRole}
                        onChange={(e) => setDirectBoosterRole(e.target.value)}
                        style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                      >
                        <option value="tank">Tank</option>
                        <option value="healer">Healer</option>
                        <option value="dps">DPS</option>
                        <option value="booster">Booster</option>
                        <option value="pilot">Pilot</option>
                      </select>

                      <button
                        type="submit"
                        className="btn btn-cta btn-sm"
                        disabled={submittingDirectAssign || !directBoosterUserId}
                      >
                        {submittingDirectAssign ? 'Assigning...' : 'Assign Booster'}
                      </button>
                    </div>

                    {directAssignFeedback && (
                      <p style={{ color: directAssignFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.8rem', margin: 0 }}>
                        {directAssignFeedback.text}
                      </p>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 4: RUNS & PROOF ── */}
          {activeTab === 'runs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🏆</span> Carry Runs &amp; Proof Submissions
                  </h3>
                  <span className="badge badge-purple">{details.runs?.length || 0} Run(s)</span>
                </div>

                {!details.runs?.length ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No carry runs recorded for this order yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {details.runs.map((run) => (
                      <div
                        key={run.id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '10px',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#fff' }}>Run #{run.runNumber}</span>
                          <span className={`badge ${run.status === 'completed' ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: '0.7rem' }}>
                            {run.status}
                          </span>
                        </div>

                        {!run.proofs?.length ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No proof attachments submitted yet.</div>
                        ) : (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            {run.proofs.map((proof) => (
                              <div
                                key={proof.id}
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  background: 'rgba(0,0,0,0.3)',
                                  border: '1px solid rgba(255,255,255,0.04)',
                                  fontSize: '0.8rem',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 600, color: 'var(--accent-yellow)' }}>
                                    Proof #{proof.id} ({proof.proofType})
                                  </span>
                                  <span className={`badge ${proof.status === 'approved' ? 'badge-green' : proof.status === 'rejected' ? 'badge-danger' : 'badge-yellow'}`} style={{ fontSize: '0.68rem' }}>
                                    {proof.status}
                                  </span>
                                </div>
                                <div>
                                  <Evidence value={proof.evidenceUrl} />
                                </div>
                                {proof.description && (
                                  <div style={{ color: 'var(--text-secondary)' }}>{proof.description}</div>
                                )}
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                                  <span>Submitted by: {proof.submittedBy?.username || 'Booster'}</span>
                                  <span>Reviewer: {proof.reviewedBy?.username || '—'}</span>
                                </div>
                                {proof.reviewNotes && (
                                  <div style={{ fontSize: '0.72rem', color: '#C4B5FD', background: 'rgba(139,92,246,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                    Note: {proof.reviewNotes}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 5: FINANCIAL ── */}
          {activeTab === 'financial' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Consolidated Authoritative Financial Ledger */}
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💰</span> Consolidated Financial Ledger
                  </h3>
                  <span className={`badge ${details.paymentStatus === 'verified' ? 'badge-green' : details.paymentStatus === 'pending' ? 'badge-yellow' : 'badge-muted'}`}>
                    Payment: {details.paymentStatus}
                  </span>
                </div>

                {/* 3-Column Authoritative KPI Bar */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '10px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    textAlign: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Gross Order
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                      ${grossNum.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--accent-yellow)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Booster Pool
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                      ${poolNum.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: netPlatformMargin >= 0 ? '#34D399' : '#EF4444', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Platform Margin
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: netPlatformMargin >= 0 ? '#34D399' : '#EF4444', fontFamily: 'monospace' }}>
                      ${netPlatformMargin.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Line Item Breakdown */}
                <div style={{ display: 'grid', gap: '8px', fontSize: '0.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Gross Amount:</span>
                    <span style={{ fontWeight: 700, color: '#fff' }}>{details.grossAmountUsd} {details.currency}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Platform Fee:</span>
                    <span>{details.platformFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Advertiser Fee:</span>
                    <span>{details.advertiserFeeUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Booster Pool:</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent-yellow)' }}>${details.boosterPoolUsd}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Escrow Policy:</span>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>Instant Payout (No Escrow)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Withdrawable Amount:</span>
                    <span style={{ color: isDoneStage ? '#10B981' : 'var(--text-muted)', fontWeight: 700 }}>
                      {isDoneStage ? `✅ $${details.boosterPoolUsd} USD (Ready)` : 'Pending Completion'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Staff Review:</span>
                    <span>{time(details.boostReleaseTracker?.staffReviewedAt || null)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Released At:</span>
                    <span>{time(details.boostReleaseTracker?.releasedAt || null)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Creator Wallet Available:</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {(details.creatorWalletAvailableCents / 100).toFixed(2)} USD
                    </span>
                  </div>
                </div>
              </div>

              {/* Disputes & Escrow Holds */}
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚖️</span> Active Disputes &amp; Escrow Holds
                </h3>
                {!details.disputes?.length && !details.escrowHolds?.length ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No active disputes or escrow holds on this order.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {details.disputes?.map((d) => (
                      <div key={d.id} style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#F87171', fontWeight: 700 }}>
                          <span>Dispute #{d.id} ({d.disputeType})</span>
                          <span>{d.status}</span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{d.description}</div>
                      </div>
                    ))}
                    {details.escrowHolds?.map((h) => (
                      <div key={h.id} style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.8rem', color: '#FBBF24' }}>
                        Hold #{h.id}: {h.status} · {h.reason}
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <Link to="/management?tab=disputes" className="btn btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                    Open Disputes Workspace ↗
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 6: DISCORD ── */}
          {activeTab === 'discord' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💬</span> Discord Synchronization Channels
                  </h3>
                  {details.executionChannelUrl || details.discordChannelUrl ? (
                    <a
                      href={details.executionChannelUrl || details.discordChannelUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-xs"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                    >
                      <span>💬</span> Open Discord Channel ↗
                    </a>
                  ) : !isReadOnly && (
                    <button
                      type="button"
                      disabled={syncingChannel}
                      className="btn btn-secondary btn-xs"
                      onClick={onSyncChannel}
                    >
                      {syncingChannel ? 'Provisioning…' : 'Create / Sync Discord Channel'}
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gap: '6px', fontSize: '0.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Public Order Board Message ID:</span>
                    <span style={{ fontFamily: 'monospace' }}>{details.discordMessageId || 'Not published'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Public Order Board Channel ID:</span>
                    <span style={{ fontFamily: 'monospace' }}>{details.discordChannelId || 'Not provisioned'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Private Execution Channel ID:</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {details.executionChannelId || 'Not provisioned'}
                      {(details.executionChannelUrl || details.discordChannelUrl) && (
                        <a
                          href={details.executionChannelUrl || details.discordChannelUrl || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ marginLeft: '8px', color: '#5865F2', textDecoration: 'underline' }}
                        >
                          [Open ↗]
                        </a>
                      )}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Review Channel ID:</span>
                    <span style={{ fontFamily: 'monospace' }}>{details.reviewChannelId || 'Not provisioned'}</span>
                  </div>
                </div>

                {syncChannelFeedback && (
                  <p style={{ margin: 0, fontSize: '0.82rem', color: syncChannelFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                    {syncChannelFeedback.text}
                  </p>
                )}
                <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  A private Discord channel is automatically provisioned when boosters are assigned, allowing direct communication between customer and squad.
                </p>
              </div>
            </div>
          )}

          {/* ── TAB 7: ACTIVITY LOG ── */}
          {activeTab === 'activity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#0e1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📜</span> Chronological Audit Timeline
                  </h3>
                  {/* Event Filters */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'lifecycle', label: 'Lifecycle' },
                      { id: 'financial', label: 'Financial' },
                      { id: 'roster', label: 'Roster' },
                      { id: 'system', label: 'System' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`btn btn-xs ${auditFilter === f.id ? 'btn-cta' : 'btn-secondary'}`}
                        onClick={() => setAuditFilter(f.id as any)}
                        style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {!details.auditAvailable ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Audit log access is restricted.</p>
                ) : !filteredAuditLogs.length ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No audit trail events matching filter.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {filteredAuditLogs.map((log: OrderAuditLogItem) => (
                      <details
                        key={log.id}
                        style={{
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          fontSize: '0.82rem',
                        }}
                      >
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: log.isSuccess ? '#10B981' : '#EF4444' }}>
                          {time(log.createdAt)} · {log.actor?.username || log.actorUsername || log.actorId || 'System'} · {log.action}
                        </summary>
                        {log.reason && <p style={{ margin: '6px 0 4px', color: 'var(--text-muted)' }}>{log.reason}</p>}
                        {(log.previousValues || log.newValues) && (
                          <pre
                            style={{
                              background: '#090A0F',
                              border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: '6px',
                              padding: '8px 10px',
                              fontSize: '0.74rem',
                              color: '#A5B4FC',
                              margin: '6px 0 0',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {log.previousValues || '—'}
                            {'\n→\n'}
                            {log.newValues || '—'}
                          </pre>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── 11. ADVANCED SETTINGS (COLLAPSIBLE DRAWER) ─────────────────── */}
          <div
            style={{
              marginTop: '8px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              backgroundColor: 'rgba(255, 255, 255, 0.015)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setShowAdvancedSettings((v) => !v)}
              style={{
                width: '100%',
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: '0.86rem',
                fontWeight: 600,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚙️</span>
                <span>Advanced Settings &amp; Operational Overrides</span>
              </div>
              <span>{showAdvancedSettings ? '▲ Collapse' : '▼ Expand'}</span>
            </button>

            {showAdvancedSettings && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '12px 0 0' }}>
                  Update operational notes or external reference. Historical payments remain unchanged.
                </p>

                {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                  <form onSubmit={onSaveOperational} style={{ display: 'grid', gap: '10px' }}>
                    <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Operational Notes</span>
                      <textarea
                        className="input"
                        rows={2}
                        value={opNotes}
                        onChange={(e) => setOpNotes(e.target.value)}
                        placeholder="Operational notes or customer requirements..."
                      />
                    </label>

                    <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>External Order ID</span>
                      <input
                        className="input"
                        value={opExternalId}
                        onChange={(e) => setOpExternalId(e.target.value)}
                        placeholder="e.g. SKY-123456"
                      />
                    </label>

                    <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Audit Reason * (Min 5 chars)</span>
                      <input
                        className="input"
                        required
                        minLength={5}
                        placeholder="Reason for audit trail..."
                        value={opReason}
                        onChange={(e) => setOpReason(e.target.value)}
                      />
                    </label>

                    {opFeedback && (
                      <p style={{ color: opFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.82rem', margin: 0 }}>
                        {opFeedback.text}
                      </p>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                      <button
                        type="submit"
                        disabled={busy || savingOp || opReason.trim().length < 5}
                        className="btn btn-secondary btn-sm"
                      >
                        {savingOp ? 'Saving…' : 'Save Operational Changes'}
                      </button>
                    </div>
                  </form>
                )}

                {hasRole('admin', 'owner') && onOpenFullEditor && (
                  <div
                    style={{
                      paddingTop: '12px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.82rem', color: '#facc15', fontWeight: 600, display: 'block' }}>
                        Admin/Owner Master Override
                      </span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Modify pricing, booster pool, game/service, platform, and full lifecycle fields.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ color: '#facc15', borderColor: 'rgba(250, 204, 21, 0.4)', backgroundColor: 'rgba(250, 204, 21, 0.08)', fontWeight: 600 }}
                      onClick={() => onOpenFullEditor(details.orderId)}
                    >
                      ✏️ Open Full Field Editor
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (STICKY CONTROL SIDEBAR 28%) ─────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 1. Lifecycle Fast Transition Card */}
          <div
            style={{
              background: '#0e1017',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Lifecycle Status
              </span>
              <span className={`badge ${getStatusBadgeClass(details.status)}`}>{details.status}</span>
            </div>

            <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <div style={{ color: 'var(--text-muted)' }}>Pipeline Step {activeStep} of 4:</div>
              <div style={{ fontWeight: 700, color: '#fff', marginTop: '2px' }}>
                {steps[activeStep - 1]?.title || details.status}
              </div>
            </div>

            {/* Quick target transition */}
            {!isReadOnly && (
              <form onSubmit={onUpdateStatus} style={{ display: 'grid', gap: '8px' }}>
                <select
                  className="input"
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  disabled={updatingStatus}
                  style={{ fontSize: '0.8rem', padding: '6px 8px' }}
                >
                  <option value="">— Select Target Status —</option>
                  <option value="open_presign">Open Pre-sign</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="pending_review">Pending Review</option>
                  <option value="completed">Completed</option>
                  <option value="waiting_for_confirm">Waiting Confirm</option>
                  <option value="warranty">Warranty</option>
                  <option value="done">Done (Released)</option>
                  <option value="disputed">Disputed</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <input
                  className="input"
                  placeholder="Optional transition note..."
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  disabled={updatingStatus}
                  style={{ fontSize: '0.78rem', padding: '6px 8px' }}
                />

                <button
                  type="submit"
                  disabled={updatingStatus || !targetStatus || targetStatus === details.status}
                  className="btn btn-cta btn-xs"
                  style={{ width: '100%' }}
                >
                  {updatingStatus ? 'Updating…' : 'Quick Transition'}
                </button>
              </form>
            )}
          </div>

          {/* 2. Authorized Quick Actions */}
          <div
            style={{
              background: '#0e1017',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Authorized Actions
            </span>

            {isReadOnly ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
                Read-only mode: administrative actions are restricted.
              </p>
            ) : !details.authorizedActions?.length ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
                No state actions available for current order status.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(Object.keys(actionLabels) as Action[])
                  .filter((a) => details.authorizedActions.includes(a))
                  .map((a) => (
                    <button
                      key={a}
                      className={`btn btn-xs ${action === a ? 'btn-cta' : 'btn-secondary'}`}
                      disabled={busy}
                      style={{ justifyContent: 'flex-start', padding: '6px 10px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setAction(a);
                        setReason('');
                        setReceipt(details.activeReceiptRef || '');
                      }}
                    >
                      {actionLabels[a]}
                    </button>
                  ))}
              </div>
            )}

            {/* Inline Action Confirmation Form */}
            {action && details.authorizedActions.includes(action) && (
              <form
                onSubmit={submitAction}
                style={{
                  display: 'grid',
                  gap: '8px',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(250, 204, 21, 0.3)',
                  marginTop: '4px',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-yellow)' }}>
                  Confirm: {actionLabels[action]}
                </div>

                {action === 'pay_wallet' && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Reserve ${details.grossAmountUsd} from creator wallet. (Available: ${(details.creatorWalletAvailableCents / 100).toFixed(2)} USD).
                  </p>
                )}

                {action === 'verify_payment' ? (
                  <label style={{ fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Receipt Ref:</span>
                    <input
                      className="input"
                      required
                      value={receipt}
                      onChange={(e) => setReceipt(e.target.value)}
                      style={{ fontSize: '0.76rem', padding: '4px 6px' }}
                    />
                  </label>
                ) : (
                  ['cancel', 'staff_review', 'final_approve'].includes(action) && (
                    <label style={{ fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Reason / Notes:</span>
                      <textarea
                        className="input"
                        required
                        minLength={5}
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ fontSize: '0.76rem', padding: '4px 6px' }}
                      />
                    </label>
                  )
                )}

                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '2px' }}>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn btn-secondary btn-xs"
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="btn btn-cta btn-xs">
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 3. Financial Summary Card */}
          <div
            style={{
              background: '#0e1017',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Financial Summary
            </span>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Gross Order:</span>
              <span style={{ fontWeight: 700, color: '#fff' }}>${details.grossAmountUsd}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--accent-yellow)' }}>Booster Pool:</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-yellow)' }}>${details.boosterPoolUsd}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ color: netPlatformMargin >= 0 ? '#34D399' : '#EF4444' }}>Platform Margin:</span>
              <span style={{ fontWeight: 700, color: netPlatformMargin >= 0 ? '#34D399' : '#EF4444' }}>
                ${netPlatformMargin.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ color: isDoneStage ? '#10B981' : 'var(--accent-yellow)', fontWeight: 600 }}>
                {isDoneStage ? 'Released' : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
