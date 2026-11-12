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
import {
  Card,
  Button,
  LoadingState,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Tabs,
  KpiCard,
  Modal,
  Select,
  Textarea,
} from '../components/ui';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';
import { UserManagementWorkspace } from '../components/admin/UserManagementWorkspace';
import { normalizePagination } from '../utils/pagination';

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

  const handleTabChange = (newTab: string) => {
    const tabKey = newTab as 'proofs' | 'orders' | 'users' | 'disputes' | 'activity';
    setActiveTab(tabKey);
    setSearchParams({ tab: tabKey });
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
      setProofsPagination(normalizePagination(res?.pagination, 10));
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
      setDisputesPagination(normalizePagination(res?.pagination, 10));
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

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProof) return;

    setSubmittingReview(true);
    setReviewMessage(null);
    try {
      await reviewProof(selectedProof.id, reviewAction, reviewNotes.trim() || undefined);
      setReviewMessage({
        text: `Run Proof #${selectedProof.id} marked as ${reviewAction.toUpperCase()}.`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedProof(null);
        loadProofs(proofsPagination.page);
        loadOverview();
      }, 900);
    } catch (err: any) {
      setReviewMessage({ text: err.message || 'Proof review operation failed.', type: 'error' });
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loadingOverview) {
    return <LoadingState message="Loading staff operational platform..." />;
  }

  if (overviewError) {
    return (
      <Card style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Access Denied or Server Error</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{overviewError}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Only authenticated users with verified Staff or Management roles may access this console.
        </p>
      </Card>
    );
  }

  const proofColumns: Column<PendingProofItem>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (p) => <span style={{ fontWeight: 700 }}>#{p.id}</span>,
    },
    {
      key: 'order',
      header: 'Order / Run',
      render: (p) => (
        <div>
          <div style={{ fontWeight: 600 }}>Order #{p.orderId ?? 'N/A'}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Run #{p.runId}</div>
        </div>
      ),
    },
    {
      key: 'service',
      header: 'Service',
      render: (p) => (
        <div>
          <div>{p.game || 'WoW'}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{p.service || 'Mythic+'}</div>
        </div>
      ),
    },
    {
      key: 'booster',
      header: 'Booster',
      render: (p) => (
        <div>
          <div style={{ fontWeight: 600 }}>{p.submittedBy.displayName || p.submittedBy.username}</div>
          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.submittedBy.id}</div>
        </div>
      ),
    },
    {
      key: 'proofType',
      header: 'Type',
      render: (p) => <span className="badge badge-muted">{p.proofType}</span>,
    },
    {
      key: 'evidence',
      header: 'Evidence',
      render: (p) => (
        <a
          href={p.evidenceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-lime)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
        >
          View Evidence ↗
        </a>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <StatusBadge status={p.status} />,
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (p) => {
        const isSubmitter = user?.discordId === p.submittedBy.id;
        if (p.status === 'pending') {
          if (isSubmitter) {
            return (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Self-review blocked
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={() => handleOpenProofModal(p)}
              className="btn btn-purple btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
            >
              Review Proof
            </button>
          );
        }
        return (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Closed by {p.reviewedBy || 'Staff'}
          </span>
        );
      },
    },
  ];

  const disputeColumns: Column<DisputeItem>[] = [
    {
      key: 'id',
      header: 'Dispute ID',
      render: (d) => <span style={{ fontWeight: 700 }}>#{d.id}</span>,
    },
    {
      key: 'orderId',
      header: 'Order #',
      render: (d) => <span>Order #{d.orderId}</span>,
    },
    {
      key: 'claimant',
      header: 'Claimant',
      render: (d) => (
        <div>
          <div style={{ fontWeight: 600 }}>{d.openedBy.displayName || d.openedBy.username}</div>
          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{d.openedBy.id}</div>
        </div>
      ),
    },
    {
      key: 'disputeType',
      header: 'Type',
      render: (d) => <span className="badge badge-muted">{d.disputeType}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      truncate: true,
      render: (d) => <span>{d.description}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: 'createdAt',
      header: 'Date',
      render: (d) => <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>{new Date(d.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header Banner with KPIs */}
      <Card
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
            <span className="badge badge-lime">Operational Staff Console</span>
            {overview?.user.isManagerOrAdmin && (
              <span className="badge badge-purple">Manager Privileges Active</span>
            )}
          </div>
          <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800, margin: 0 }}>Staff Operations &amp; Verification</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: '0.35rem', margin: 0 }}>
            Logged in as <strong style={{ color: 'var(--text-primary)' }}>{overview?.user.displayName || overview?.user.username}</strong> ({overview?.user.discordId})
          </p>
        </div>

        {/* Quick KPI Counters */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <KpiCard
            label="Pending Proofs"
            value={overview?.metrics.pendingProofsCount ?? 0}
            highlight="lime"
            style={{ minWidth: '120px' }}
          />
          <KpiCard
            label="Open Disputes"
            value={overview?.metrics.activeDisputesCount ?? 0}
            highlight="purple"
            style={{ minWidth: '120px' }}
          />
          <KpiCard
            label="Order Reviews"
            value={overview?.metrics.pendingStaffReviewOrdersCount ?? 0}
            highlight="purple"
            style={{ minWidth: '120px' }}
          />
        </div>
      </Card>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'proofs', label: 'Pending Proofs', count: overview?.metrics.pendingProofsCount ?? 0 },
          { id: 'orders', label: 'Order Workspace' },
          { id: 'users', label: 'User Directory' },
          { id: 'disputes', label: 'Dispute Queue', count: overview?.metrics.activeDisputesCount ?? 0 },
          { id: 'activity', label: 'My Operational Activity' },
        ]}
        activeTab={activeTab}
        onChange={handleTabChange}
      />

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

      {/* Tab: Proofs Queue */}
      {activeTab === 'proofs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status:</span>
              <Select
                value={proofStatusFilter}
                onChange={(e) => setProofStatusFilter(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="">All Statuses</option>
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={() => loadProofs(proofsPagination?.page ?? 1)}>
              ↻ Refresh Queue
            </Button>
          </div>

          <div>
            <DataTable
              columns={proofColumns}
              data={proofs}
              keyExtractor={(p) => p.id}
              isLoading={proofsLoading}
              emptyTitle="No run proofs found matching current filters."
              emptyMessage="Proofs submitted by boosters for completed runs will appear here for staff review."
            />

            <Pagination
              pagination={proofsPagination}
              onPageChange={(p) => loadProofs(p)}
              showPageSizeSelector={false}
            />
          </div>
        </div>
      )}

      {/* Tab: Disputes Queue */}
      {activeTab === 'disputes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <DataTable
            columns={disputeColumns}
            data={disputes}
            keyExtractor={(d) => d.id}
            isLoading={disputesLoading}
            emptyTitle="No active disputes requiring review at this time."
            emptyMessage="Customer or booster disputes will be listed here when raised."
          />
        </div>
      )}

      {/* Tab: Staff Activity History */}
      {activeTab === 'activity' && (
        <Card style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontWeight: 700 }}>Recent Operational Decisions</h3>
          {overview?.recentActivity.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No recent logged staff actions found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {overview?.recentActivity.map((log) => (
                <div
                  key={log.id}
                  style={{
                    backgroundColor: 'var(--bg-surface-raised)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
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
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Proof Review Modal */}
      {selectedProof && (
        <Modal
          isOpen={Boolean(selectedProof)}
          onClose={() => setSelectedProof(null)}
          title={`Review Run Proof #${selectedProof.id}`}
          maxWidth="560px"
          footer={
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
              <Button variant="outline" size="sm" onClick={() => setSelectedProof(null)}>
                Cancel
              </Button>
              <Button
                variant={reviewAction === 'approved' ? 'cta' : 'purple'}
                size="sm"
                disabled={submittingReview}
                onClick={handleReviewSubmit}
              >
                {submittingReview
                  ? 'Submitting...'
                  : reviewAction === 'approved'
                  ? 'Approve Proof'
                  : 'Reject Proof'}
              </Button>
            </div>
          }
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface-raised)',
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
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
                style={{ color: 'var(--accent-lime)', textDecoration: 'underline' }}
              >
                {selectedProof.evidenceUrl}
              </a>
            </div>
          </div>

          <form onSubmit={handleReviewSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Operational Decision
              </label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="proofDecision"
                    checked={reviewAction === 'approved'}
                    onChange={() => setReviewAction('approved')}
                  />
                  <span>Approve Evidence</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="proofDecision"
                    checked={reviewAction === 'rejected'}
                    onChange={() => setReviewAction('rejected')}
                  />
                  <span style={{ color: 'var(--status-danger)' }}>Reject Evidence</span>
                </label>
              </div>
            </div>

            <Textarea
              label="Reviewer Notes / Feedback (Optional for approval, recommended for rejection)"
              placeholder="e.g. Cleared boss verified on score screen; or Incomplete screenshot provided..."
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
            />

            {reviewMessage && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  backgroundColor: reviewMessage.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                  color: reviewMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                }}
              >
                {reviewMessage.text}
              </div>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
};
