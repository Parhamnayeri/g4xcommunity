import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  StaffOverviewResponse,
  PendingProofItem,
  DisputeItem,
  PaginationMeta,
} from '../types/operations';
import {
  fetchStaffOverview,
  fetchPendingProofs,
  reviewProof,
  fetchStaffDisputes,
} from '../services/operations';
import { LoadingState } from '../components/ui/LoadingState';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';
import { UserManagementWorkspace } from '../components/admin/UserManagementWorkspace';

export const StaffPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabParam = searchParams.get('tab') as 'proofs' | 'orders' | 'users' | 'disputes' | 'activity' | null;

  // Overview State
  const [overview, setOverview] = useState<StaffOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'proofs' | 'orders' | 'users' | 'disputes' | 'activity'>(
    currentTabParam && ['proofs', 'orders', 'users', 'disputes', 'activity'].includes(currentTabParam)
      ? currentTabParam
      : 'proofs'
  );

  const handleTabChange = (newTab: 'proofs' | 'orders' | 'users' | 'disputes' | 'activity') => {
    setActiveTab(newTab);
    setSearchParams({ tab: newTab });
  };

  // Proofs State
  const [proofs, setProofs] = useState<PendingProofItem[]>([]);
  const [proofsPagination, setProofsPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [proofsLoading, setProofsLoading] = useState(false);
  const [proofStatusFilter, setProofStatusFilter] = useState('pending');

  // Disputes State
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [_disputesPagination, setDisputesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [disputesLoading, setDisputesLoading] = useState(false);

  // Review Modal State
  const [selectedProof, setSelectedProof] = useState<PendingProofItem | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected'>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load Overview
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchStaffOverview();
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load staff operational overview');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Load Proofs
  const loadProofs = useCallback(async (page: number = 1) => {
    setProofsLoading(true);
    try {
      const res = await fetchPendingProofs({
        page,
        limit: 10,
        status: proofStatusFilter || undefined,
      });
      setProofs(Array.isArray(res?.proofs) ? res.proofs : []);
      setProofsPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err: any) {
      console.error('Failed to load proofs:', err);
    } finally {
      setProofsLoading(false);
    }
  }, [proofStatusFilter]);

  // Load Disputes
  const loadDisputes = useCallback(async (page: number = 1) => {
    setDisputesLoading(true);
    try {
      const res = await fetchStaffDisputes({ page, limit: 10 });
      setDisputes(Array.isArray(res?.disputes) ? res.disputes : []);
      setDisputesPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err: any) {
      console.error('Failed to load disputes:', err);
    } finally {
      setDisputesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab === 'proofs') {
      loadProofs(1);
    } else if (activeTab === 'disputes') {
      loadDisputes(1);
    }
  }, [activeTab, loadProofs, loadDisputes]);

  const handleOpenProofModal = (proof: PendingProofItem) => {
    setSelectedProof(proof);
    setReviewAction('approved');
    setReviewNotes('');
    setReviewMessage(null);
  };

  const handleSubmitProofReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProof) return;
    setSubmittingReview(true);
    setReviewMessage(null);
    try {
      await reviewProof(selectedProof.id, reviewAction, reviewNotes);
      setReviewMessage({
        text: `Proof #${selectedProof.id} successfully marked as ${reviewAction}.`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedProof(null);
        loadProofs(proofsPagination.page);
        loadOverview();
      }, 1200);
    } catch (err: any) {
      setReviewMessage({
        text: err.message || 'Failed to submit proof review.',
        type: 'error',
      });
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loadingOverview) {
    return <LoadingState message="Loading staff operational platform..." />;
  }

  if (overviewError) {
    return (
      <div className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Access Denied or Server Error</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{overviewError}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Only authenticated users with verified Staff or Management roles may access this console.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header Banner */}
      <div
        className="card-surface"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem',
          borderLeft: '4px solid var(--accent-lime)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span
              style={{
                backgroundColor: 'rgba(204, 255, 0, 0.15)',
                color: 'var(--accent-lime)',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Operational Staff Console
            </span>
            {overview?.user.isManagerOrAdmin && (
              <span
                style={{
                  backgroundColor: 'rgba(124, 58, 237, 0.2)',
                  color: 'var(--primary-purple)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Manager Privileges Active
              </span>
            )}
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Staff Operations &amp; Verification</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem', margin: 0 }}>
            Logged in as <strong style={{ color: 'var(--text-primary)' }}>{overview?.user.displayName || overview?.user.username}</strong> ({overview?.user.discordId})
          </p>
        </div>

        {/* Quick KPI Counters */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div
            style={{
              backgroundColor: 'var(--bg-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1.25rem',
              textAlign: 'center',
              minWidth: '110px',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-lime)' }}>
              {overview?.metrics.pendingProofsCount ?? 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.2rem' }}>
              Pending Proofs
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1.25rem',
              textAlign: 'center',
              minWidth: '110px',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--status-warning)' }}>
              {overview?.metrics.activeDisputesCount ?? 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.2rem' }}>
              Open Disputes
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1.25rem',
              textAlign: 'center',
              minWidth: '110px',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary-purple)' }}>
              {overview?.metrics.pendingStaffReviewOrdersCount ?? 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.2rem' }}>
              Order Reviews
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          gap: '0.5rem',
          overflowX: 'auto',
          paddingBottom: '0.25rem',
        }}
      >
        <button
          type="button"
          onClick={() => handleTabChange('proofs')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'proofs' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'proofs' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.92rem',
            padding: '0.65rem 1rem',
            cursor: 'pointer',
            transition: 'var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
          }}
        >
          <span>🛡️ Pending Proofs</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({overview?.metrics.pendingProofsCount ?? 0})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('orders')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'orders' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'orders' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.92rem',
            padding: '0.65rem 1rem',
            cursor: 'pointer',
            transition: 'var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
          }}
        >
          <span>📦 Order Workspace</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('users')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'users' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'users' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.92rem',
            padding: '0.65rem 1rem',
            cursor: 'pointer',
            transition: 'var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
          }}
        >
          <span>👥 User Directory</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('disputes')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'disputes' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'disputes' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.92rem',
            padding: '0.65rem 1rem',
            cursor: 'pointer',
            transition: 'var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
          }}
        >
          <span>⚖️ Dispute Queue</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({overview?.metrics.activeDisputesCount ?? 0})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('activity')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'activity' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'activity' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.92rem',
            padding: '0.65rem 1rem',
            cursor: 'pointer',
            transition: 'var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
          }}
        >
          <span>📋 My Operational Activity</span>
        </button>
      </div>

      {/* Tab: Order Workspace (Read-Only) */}
      {activeTab === 'orders' && (
        <OrderManagementWorkspace
          readOnly={true}
          title="Staff Order Workspace (Read-Only)"
          subtitle="Inspect permitted orders, assignments, progress, and execution channel references in read-only mode."
        />
      )}

      {/* Tab: User Directory (Read-Only) */}
      {activeTab === 'users' && (
        <UserManagementWorkspace
          canBan={false}
          canManageRoles={false}
          title="Staff User Directory (Read-Only)"
          subtitle="Permitted directory of registered community members and verified account status."
        />
      )}

      {/* Tab 1: Proofs Queue */}
      {activeTab === 'proofs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status:</span>
              <select
                value={proofStatusFilter}
                onChange={(e) => setProofStatusFilter(e.target.value)}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="">All Statuses</option>
              </select>
            </div>

            <button
              onClick={() => loadProofs(proofsPagination?.page ?? 1)}
              className="btn btn-sm"
              style={{
                backgroundColor: 'var(--bg-surface-hover)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Refresh Queue
            </button>
          </div>

          {/* Table */}
          <div
            className="card-surface"
            style={{
              padding: 0,
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {proofsLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching proof queue..." />
              </div>
            ) : proofs.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-state-icon">🛡️</div>
                <p style={{ margin: 0, fontWeight: 600 }}>No run proofs found matching current filters.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Order / Run</th>
                      <th>Service</th>
                      <th>Booster</th>
                      <th>Type</th>
                      <th>Evidence</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proofs.map((proof) => {
                      const isSubmitter = user?.discordId === proof.submittedBy.id;
                      return (
                        <tr key={proof.id}>
                          <td style={{ fontWeight: 700 }}>#{proof.id}</td>
                          <td>
                            <div>Order #{proof.orderId ?? 'N/A'}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Run #{proof.runId}</div>
                          </td>
                          <td>
                            <div>{proof.game || 'WoW'}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{proof.service || 'Mythic+'}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{proof.submittedBy.displayName || proof.submittedBy.username}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{proof.submittedBy.id}</div>
                          </td>
                          <td>
                            <span className="badge badge-purple">
                              {proof.proofType}
                            </span>
                          </td>
                          <td>
                            <a
                              href={proof.evidenceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: 'var(--accent-yellow)',
                                textDecoration: 'none',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                              }}
                            >
                              View Evidence &nearr;
                            </a>
                          </td>
                          <td>
                            <span
                              className={
                                proof.status === 'approved'
                                  ? 'badge badge-green'
                                  : proof.status === 'rejected'
                                  ? 'badge badge-danger'
                                  : 'badge badge-amber'
                              }
                            >
                              {proof.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {proof.status === 'pending' ? (
                              isSubmitter ? (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  Self-review blocked
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleOpenProofModal(proof)}
                                  className="btn-primary btn-xs"
                                >
                                  Review Proof
                                </button>
                              )
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Closed by {proof.reviewedBy || 'Staff'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {(proofsPagination?.totalPages ?? 0) > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                <div>
                  Page {proofsPagination?.page ?? 1} of {proofsPagination?.totalPages || 1} ({proofsPagination?.total ?? 0} total proofs)
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    disabled={(proofsPagination?.page ?? 1) <= 1}
                    onClick={() => loadProofs((proofsPagination?.page ?? 1) - 1)}
                    className="btn btn-sm"
                    style={{
                      backgroundColor: 'var(--bg-surface-hover)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    &larr; Previous
                  </button>
                  <button
                    disabled={(proofsPagination?.page ?? 1) >= (proofsPagination?.totalPages || 1)}
                    onClick={() => loadProofs((proofsPagination?.page ?? 1) + 1)}
                    className="btn btn-sm"
                    style={{
                      backgroundColor: 'var(--bg-surface-hover)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Disputes Queue */}
      {activeTab === 'disputes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div
            className="card-surface"
            style={{
              padding: 0,
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {disputesLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching open disputes..." />
              </div>
            ) : disputes.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-state-icon">⚖️</div>
                <p style={{ margin: 0, fontWeight: 600 }}>No active disputes requiring review at this time.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Dispute ID</th>
                      <th>Order #</th>
                      <th>Claimant</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((dispute) => (
                      <tr key={dispute.id}>
                        <td style={{ fontWeight: 700 }}>#{dispute.id}</td>
                        <td>Order #{dispute.orderId}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{dispute.openedBy.displayName || dispute.openedBy.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dispute.openedBy.id}</div>
                        </td>
                        <td>
                          <span className="badge badge-purple">
                            {dispute.disputeType}
                          </span>
                        </td>
                        <td style={{ maxWidth: '300px' }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dispute.description}
                          </div>
                        </td>
                        <td>
                          <span
                            className={
                              dispute.status === 'resolved'
                                ? 'badge badge-green'
                                : dispute.status === 'open'
                                ? 'badge badge-danger'
                                : 'badge badge-amber'
                            }
                          >
                            {dispute.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {new Date(dispute.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Staff Activity History */}
      {activeTab === 'activity' && (
        <div className="card-surface" style={{ padding: '1.5rem', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontWeight: 700 }}>Recent Operational Decisions</h3>
          {overview?.recentActivity.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No recent logged staff actions found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {overview?.recentActivity.map((log) => (
                <div
                  key={log.id}
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '0.85rem 1.25rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent-lime)' }}>
                      {log.action}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {log.entityType} #{log.entityId} — {log.reason || 'Operational action'}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Proof Review Modal */}
      {selectedProof && (
        <div className="studio-modal-backdrop" onClick={() => setSelectedProof(null)}>
          <div
            className="studio-modal-card"
            style={{ maxWidth: '560px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Review Run Proof #{selectedProof.id}</h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setSelectedProof(null)}
              >
                &times;
              </button>
            </div>

            <div className="studio-modal-body">
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  padding: '1rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div>
                  <strong style={{ color: 'var(--text-muted)' }}>Order:</strong> #{selectedProof.orderId ?? 'N/A'} (Run #{selectedProof.runId})
                </div>
                <div>
                  <strong style={{ color: 'var(--text-muted)' }}>Booster:</strong> {selectedProof.submittedBy.displayName || selectedProof.submittedBy.username} ({selectedProof.submittedBy.id})
                </div>
                <div>
                  <strong style={{ color: 'var(--text-muted)' }}>Description:</strong> {selectedProof.description || 'No description provided'}
                </div>
                <div>
                  <strong style={{ color: 'var(--text-muted)' }}>Evidence URL:</strong>{' '}
                  <a
                    href={selectedProof.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-yellow)', textDecoration: 'underline' }}
                  >
                    {selectedProof.evidenceUrl}
                  </a>
                </div>
              </div>

              <form onSubmit={handleSubmitProofReview} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Decision
                  </label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value="approved"
                        checked={reviewAction === 'approved'}
                        onChange={() => setReviewAction('approved')}
                      />
                      <span className="badge badge-green" style={{ cursor: 'pointer' }}>Approve Proof</span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value="rejected"
                        checked={reviewAction === 'rejected'}
                        onChange={() => setReviewAction('rejected')}
                      />
                      <span className="badge badge-danger" style={{ cursor: 'pointer' }}>Reject Proof</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Review Notes / Audit Reason
                  </label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Enter audit notes (required if rejecting)..."
                    rows={3}
                    className="input"
                    style={{ resize: 'vertical' }}
                  />
                </div>

                {reviewMessage && (
                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      backgroundColor: reviewMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: reviewMessage.type === 'success' ? '#10b981' : '#ef4444',
                      border: `1px solid ${reviewMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {reviewMessage.text}
                  </div>
                )}

                <div className="studio-modal-footer" style={{ borderTop: 'none', padding: 0 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedProof(null)}
                    disabled={submittingReview}
                    className="btn btn-secondary btn-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReview}
                    className={`btn btn-sm ${reviewAction === 'approved' ? 'btn-cta' : 'btn-danger'}`}
                  >
                    {submittingReview ? 'Recording...' : `Confirm ${reviewAction === 'approved' ? 'Approval' : 'Rejection'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default StaffPage;
