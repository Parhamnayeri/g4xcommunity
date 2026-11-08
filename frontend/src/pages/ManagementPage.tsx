import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ManagementOverviewResponse,
  DisputeItem,
  PaginationMeta,
} from '../types/operations';
import {
  fetchManagementOverview,
  fetchManagementDisputes,
  resolveManagementDispute,
} from '../services/operations';
import { ApplicationsWorkspace, AdminModuleNavigation } from '../components/admin/NativeAdminModules';
import { LoadingState } from '../components/ui/LoadingState';
import { OrderManagementWorkspace } from '../components/orders/OrderManagementWorkspace';

interface ManagementPageProps {
  defaultTab?: 'orders' | 'applications' | 'disputes' | 'audit';
}

export const ManagementPage: React.FC<ManagementPageProps> = ({ defaultTab = 'orders' }) => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // Overview State
  const [overview, setOverview] = useState<ManagementOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'orders' | 'applications' | 'disputes' | 'audit'>(defaultTab);

  useEffect(() => {
    const tab = searchParams.get('tab');
    setActiveTab(tab === 'disputes' ? 'disputes' : defaultTab);
  }, [defaultTab, searchParams]);

  // Disputes State
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [disputesPagination, setDisputesPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [disputesLoading, setDisputesLoading] = useState(false);

  // Dispute Resolution Modal
  const [selectedDispute, setSelectedDispute] = useState<DisputeItem | null>(null);
  const [disputeDecision, setDisputeDecision] = useState<'refund_customer' | 'release_booster' | 'split' | 'dismiss'>('release_booster');
  const [disputeNotes, setDisputeNotes] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeMessage, setDisputeMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load Overview
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchManagementOverview();
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load executive management overview');
    } finally {
      setLoadingOverview(false);
    }
  }, []);


  // Load Disputes
  const loadDisputes = useCallback(async (page: number = 1) => {
    setDisputesLoading(true);
    try {
      const res = await fetchManagementDisputes({ page, limit: 10 });
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
    if (activeTab === 'disputes') {
      loadDisputes(1);
    }
  }, [activeTab, loadDisputes]);

  // Submit Dispute Resolution
  const handleSubmitDisputeResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute) return;
    if (!disputeNotes.trim()) {
      setDisputeMessage({ text: 'Resolution rationale is mandatory for audit records.', type: 'error' });
      return;
    }
    setSubmittingDispute(true);
    setDisputeMessage(null);
    try {
      await resolveManagementDispute(selectedDispute.id, disputeDecision, disputeNotes);
      setDisputeMessage({
        text: `Dispute #${selectedDispute.id} resolved with decision: ${disputeDecision}`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedDispute(null);
        loadDisputes(disputesPagination?.page ?? 1);
        loadOverview();
      }, 1200);
    } catch (err: any) {
      setDisputeMessage({
        text: err.message || 'Failed to resolve dispute',
        type: 'error',
      });
    } finally {
      setSubmittingDispute(false);
    }
  };

  if (loadingOverview) {
    return <LoadingState message="Loading executive management portal..." />;
  }

  if (overviewError) {
    return (
      <div className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Unauthorized Access</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{overviewError}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          This console requires Management, Admin or Owner role privileges.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <AdminModuleNavigation />
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
          borderLeft: '4px solid var(--primary-purple)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span
              style={{
                backgroundColor: 'rgba(124, 58, 237, 0.2)',
                color: 'var(--primary-purple)',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Management Console
            </span>
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Executive Operations &amp; Workload</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem', margin: 0 }}>
            Real-time pipeline oversight, booster capacity, dispute escalation, and registration verification.
          </p>
        </div>

        {/* KYC Portal Navigation Link */}
        <Link
          to="/management/kyc"
          className="btn btn-cta btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.25rem',
          }}
        >
          <span>🛡️ Open KYC Review Portal</span>
          <span
            style={{
              backgroundColor: 'var(--text-inverse)',
              color: 'var(--accent-lime)',
              borderRadius: '999px',
              padding: '0.1rem 0.5rem',
              fontSize: '0.75rem',
              fontWeight: 800,
            }}
          >
            {overview?.kpis.pendingKycVerificationsCount ?? 0}
          </span>
        </Link>
      </div>

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Orders</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-lime)', marginTop: '0.25rem' }}>
            {overview?.kpis.activeOrdersCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            G4X Marketplace: {overview?.kpis.externalOrdersCount ?? 0} | Advertiser: {overview?.kpis.advertiserOrdersCount ?? 0}
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Booster Pool</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            {overview?.kpis.totalActiveBoosters ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--status-info)', marginTop: '0.5rem' }}>
            Verified &amp; active roster capacity
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pending Applications</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--status-warning)', marginTop: '0.25rem' }}>
            {overview?.kpis.pendingApplicationsCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Boosters, Pilots, Advertisers, Exchangers
          </div>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Open Disputes</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--status-danger)', marginTop: '0.25rem' }}>
            {overview?.kpis.openDisputesCount ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Unresolved customer/booster claims
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', gap: '1rem', overflowX: 'auto' }}>
        <button
          onClick={() => setActiveTab('orders')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'orders' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'orders' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Order Pipeline ({overview?.kpis.activeOrdersCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('applications')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'applications' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'applications' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Registration Applications ({overview?.kpis.pendingApplicationsCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('disputes')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'disputes' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'disputes' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Dispute Escalations ({overview?.kpis.openDisputesCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'audit' ? '2px solid var(--accent-lime)' : '2px solid transparent',
            color: activeTab === 'audit' ? 'var(--accent-lime)' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
          }}
        >
          Platform Audit Trail
        </button>
      </div>

      {/* Tab 1: Unified Order Management Pipeline Workspace */}
      {activeTab === 'orders' && (
        <OrderManagementWorkspace
          title="Management Order Pipeline Oversight"
          subtitle="Real-time multi-criteria order pipeline, roster status, proof reviews, Discord board publishing, and diagnostics."
        />
      )}

      {activeTab === 'applications' && <ApplicationsWorkspace />}

      {/* Tab 3: Disputes Escalation */}
      {activeTab === 'disputes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card-surface" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            {disputesLoading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching disputes..." />
              </div>
            ) : disputes.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active disputes requiring management resolution.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Dispute ID</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Order #</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Claimant</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Description</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '0.9rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((dispute) => (
                      <tr key={dispute.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.9rem 1.25rem', fontWeight: 700 }}>#{dispute.id}</td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>Order #{dispute.orderId}</td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <div style={{ fontWeight: 600 }}>{dispute.openedBy.displayName || dispute.openedBy.username}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dispute.openedBy.id}</div>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>{dispute.disputeType}</td>
                        <td style={{ padding: '0.9rem 1.25rem', maxWidth: '300px' }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dispute.description}
                          </div>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem' }}>
                          <span
                            style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor:
                                dispute.status === 'resolved'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(239, 68, 68, 0.15)',
                              color:
                                dispute.status === 'resolved'
                                  ? 'var(--status-success)'
                                  : 'var(--status-danger)',
                            }}
                          >
                            {dispute.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.9rem 1.25rem', textAlign: 'right' }}>
                          {dispute.status !== 'resolved' && dispute.status !== 'cancelled' ? (
                            user?.discordId === dispute.openedBy.id ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Self-resolution blocked
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedDispute(dispute);
                                  setDisputeDecision('release_booster');
                                  setDisputeNotes('');
                                  setDisputeMessage(null);
                                }}
                                className="btn btn-sm"
                                style={{
                                  backgroundColor: 'var(--status-warning)',
                                  color: '#0d0b12',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  padding: '0.3rem 0.65rem',
                                }}
                              >
                                Resolve Dispute
                              </button>
                            )
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Closed ({dispute.resolutionNotes || 'Resolved'})
                            </span>
                          )}
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

      {/* Tab 4: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="card-surface" style={{ padding: '1.5rem', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontWeight: 700 }}>Platform Audit Events</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {overview?.recentAuditTrail.map((log) => (
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
                    Actor: {log.actorId} | {log.entityType} #{log.entityId} — {log.reason || 'Operational action'}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(log.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dispute Resolution Modal */}
      {selectedDispute && (
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
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            className="card-surface"
            style={{
              maxWidth: '560px',
              width: '100%',
              padding: '2rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Resolve Dispute #{selectedDispute.id}</h3>
              <button
                onClick={() => setSelectedDispute(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                padding: '1rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.85rem',
                marginBottom: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div><strong>Order:</strong> #{selectedDispute.orderId}</div>
              <div><strong>Claimant:</strong> {selectedDispute.openedBy.displayName || selectedDispute.openedBy.username} ({selectedDispute.openedBy.id})</div>
              <div><strong>Dispute Type:</strong> {selectedDispute.disputeType}</div>
              <div><strong>Description:</strong> {selectedDispute.description}</div>
            </div>

            <form onSubmit={handleSubmitDisputeResolution} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Resolution Decision
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="release_booster"
                      checked={disputeDecision === 'release_booster'}
                      onChange={() => setDisputeDecision('release_booster')}
                    />
                    <span>Release Funds to Booster (Proof Validated)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="refund_customer"
                      checked={disputeDecision === 'refund_customer'}
                      onChange={() => setDisputeDecision('refund_customer')}
                    />
                    <span>Refund Customer (Service Failed / Unfulfilled)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="split"
                      checked={disputeDecision === 'split'}
                      onChange={() => setDisputeDecision('split')}
                    />
                    <span>Split Settlement (Partial Completion)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="disputeDecision"
                      value="dismiss"
                      checked={disputeDecision === 'dismiss'}
                      onChange={() => setDisputeDecision('dismiss')}
                    />
                    <span>Dismiss Dispute (Unsubstantiated Claim)</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Resolution Notes &amp; Rationale <span style={{ color: 'var(--status-danger)' }}>*</span>
                </label>
                <textarea
                  value={disputeNotes}
                  onChange={(e) => setDisputeNotes(e.target.value)}
                  placeholder="Detailed rationale for audit trail..."
                  rows={3}
                  required
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text-primary)',
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              {disputeMessage && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '0.85rem',
                    backgroundColor: disputeMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: disputeMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                >
                  {disputeMessage.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedDispute(null)}
                  disabled={submittingDispute}
                  className="btn btn-sm"
                  style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDispute}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: 'var(--primary-purple)',
                    color: '#ffffff',
                    fontWeight: 700,
                  }}
                >
                  {submittingDispute ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default ManagementPage;
