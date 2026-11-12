import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  KycApplicationItem,
  KycDetailResponse,
  PaginationMeta,
} from '../types/operations';
import {
  fetchKycApplications,
  fetchKycDetail,
  submitKycDecision,
} from '../services/operations';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Modal,
  Select,
  Textarea,
  LoadingState,
} from '../components/ui';
import { normalizePagination } from '../utils/pagination';

export const KycManagementPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { user } = useAuth();

  // Queue State
  const [applications, setApplications] = useState<KycApplicationItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');

  // Detail & Decision Modal
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [detail, setDetail] = useState<KycDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decision, setDecision] = useState<'verify_identity' | 'start_identity_verification' | 'request_info' | 'reject'>('verify_identity');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Secure Document Viewer State
  const [activeDocRef, setActiveDocRef] = useState<string | null>(null);
  const [activeDocType, setActiveDocType] = useState<'identityDoc' | 'passportDoc' | 'selfieDoc' | null>(null);

  // Load Queue
  const loadQueue = useCallback(async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchKycApplications({
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        page,
        limit: 10,
      });
      setApplications(Array.isArray(res?.applications) ? res.applications : []);
      setPagination(normalizePagination(res?.pagination || res, page, 10));
    } catch (err: any) {
      setError(err.message || 'Failed to load KYC verification queue');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, statusFilter]);

  // Load Single Application Detail
  const loadDetail = useCallback(async (id: number) => {
    setSelectedAppId(id);
    setDetailLoading(true);
    setDecisionFeedback(null);
    setReviewerNotes('');
    setActiveDocRef(null);
    setActiveDocType(null);
    try {
      const res = await fetchKycDetail(id);
      setDetail(res);
      setDecision('verify_identity');
    } catch (err: any) {
      setDecisionFeedback({ text: err.message || 'Failed to load KYC details', type: 'error' });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue(1);
  }, [loadQueue]);

  // Handle Decision Submit
  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) return;

    if (decision === 'reject' && !reviewerNotes.trim()) {
      setDecisionFeedback({ text: 'Rejection reason is mandatory.', type: 'error' });
      return;
    }

    setSubmitting(true);
    setDecisionFeedback(null);
    try {
      await submitKycDecision(selectedAppId, decision, reviewerNotes);
      setDecisionFeedback({
        text: `KYC Application #${selectedAppId} decision '${decision}' successfully applied.`,
        type: 'success',
      });
      setTimeout(() => {
        setSelectedAppId(null);
        setDetail(null);
        loadQueue(pagination?.page ?? 1);
      }, 1500);
    } catch (err: any) {
      setDecisionFeedback({ text: err.message || 'Failed to execute KYC decision', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<KycApplicationItem>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'App #',
        width: '80px',
        render: (app) => <strong>#{app.id}</strong>,
      },
      {
        key: 'applicant',
        header: 'Applicant',
        render: (app) => (
          <div>
            <div style={{ fontWeight: 600 }}>{app.displayName || app.username}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{app.userId}</div>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        render: (app) => (
          <span
            style={{
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-xs)',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              backgroundColor: app.category === 'pilot' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: app.category === 'pilot' ? 'var(--accent-lime)' : 'var(--text-primary)',
            }}
          >
            {app.category}
          </span>
        ),
      },
      {
        key: 'documents',
        header: 'Documents',
        render: (app) => (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.4rem',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: app.hasIdentityDoc ? 'var(--status-success-bg)' : 'rgba(255, 255, 255, 0.05)',
                color: app.hasIdentityDoc ? 'var(--status-success)' : 'var(--text-muted)',
              }}
            >
              ID {app.hasIdentityDoc ? '✓' : '—'}
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.4rem',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: app.hasPassportDoc ? 'var(--status-success-bg)' : 'rgba(255, 255, 255, 0.05)',
                color: app.hasPassportDoc ? 'var(--status-success)' : 'var(--text-muted)',
              }}
            >
              Passport {app.hasPassportDoc ? '✓' : '—'}
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.4rem',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: app.hasSelfieDoc ? 'var(--status-success-bg)' : 'rgba(255, 255, 255, 0.05)',
                color: app.hasSelfieDoc ? 'var(--status-success)' : 'var(--text-muted)',
              }}
            >
              Selfie {app.hasSelfieDoc ? '✓' : '—'}
            </span>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'App Status',
        render: (app) => <StatusBadge status={app.status} />,
      },
      {
        key: 'identityStatus',
        header: 'Identity Status',
        render: (app) => <StatusBadge status={app.identityStatus} />,
      },
      {
        key: 'actions',
        header: 'Review',
        align: 'right',
        render: (app) => {
          const isSelf = user?.discordId === app.userId;
          if (isSelf) {
            return (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Self-review blocked
              </span>
            );
          }
          return (
            <Button
              size="sm"
              variant="primary"
              onClick={() => loadDetail(app.id)}
              style={{
                backgroundColor: 'var(--accent-lime)',
                color: '#0d0b12',
                fontSize: '0.75rem',
                fontWeight: 800,
                padding: '0.35rem 0.75rem',
              }}
            >
              Inspect &amp; Decide
            </Button>
          );
        },
      },
    ],
    [user?.discordId, loadDetail]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header Banner */}
      <Card
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
              Secure KYC &amp; Pilot Review
            </span>
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
              Permission: SENSITIVE_IDENTITY_REVIEW
            </span>
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Identity Verification Portal</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem', margin: 0 }}>
            Restricted compliance console. Inspect applicant identity documents, passport records, and selfie proofs.
          </p>
        </div>

        {!embedded && (
          <Link
            to="/management"
            className="btn btn-sm"
            style={{
              backgroundColor: 'var(--bg-surface-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            &larr; Back to Management Overview
          </Link>
        )}
      </Card>

      {error ? (
        <Card className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Restricted Compliance Area</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Generic Staff members do not hold identity review permissions. Management or Owner roles required.
          </p>
        </Card>
      ) : (
        <>
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
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                options={[
                  { label: 'All Verification Categories', value: '' },
                  { label: 'Account Pilots (High-Risk)', value: 'pilot' },
                  { label: 'P2P Exchangers', value: 'exchanger' },
                  { label: 'Boosters', value: 'booster' },
                  { label: 'Advertisers', value: 'advertiser' },
                ]}
              />

              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { label: 'Pending Queue', value: 'pending' },
                  { label: 'Info Requested', value: 'info_requested' },
                  { label: 'Approved & Verified', value: 'approved' },
                  { label: 'Rejected', value: 'rejected' },
                  { label: 'All Records', value: '' },
                ]}
              />
            </div>

            <Button
              onClick={() => loadQueue(pagination?.page ?? 1)}
              variant="outline"
              size="sm"
            >
              Refresh Verification Queue
            </Button>
          </div>

          {/* Applications Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <DataTable
              columns={columns}
              data={applications}
              keyField="id"
              loading={loading}
              emptyMessage="No KYC verification applications pending review under current filters."
            />

            <Pagination
              pagination={pagination}
              onPageChange={(page) => loadQueue(page)}
            />
          </Card>
        </>
      )}

      {/* KYC Application Inspection & Decision Modal */}
      <Modal
        isOpen={!!selectedAppId}
        onClose={() => {
          setSelectedAppId(null);
          setDetail(null);
        }}
        title={`KYC Verification File #${selectedAppId}`}
        subtitle="Confidential identity records"
        size="lg"
      >
        {detailLoading || !detail ? (
          <LoadingState message="Fetching encrypted KYC file..." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Applicant Summary */}
            <div
              style={{
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xs)',
                padding: '1.25rem',
                fontSize: '0.85rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Applicant Name:</span>
                <strong>{detail.application.displayName || detail.application.username}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Discord ID:</span>
                <code>{detail.application.userId}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Role Category:</span>
                <strong style={{ color: 'var(--accent-lime)' }}>{detail.application.category.toUpperCase()}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Verification Status:</span>
                <strong style={{ textTransform: 'capitalize' }}>{detail.application.identityStatus}</strong>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Qualifications:</span>
                <div>{detail.application.qualifications || 'No qualifications stated'}</div>
              </div>
            </div>

            {/* Submitted Documents Inspection */}
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                Submitted Identity Documents
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '1rem',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Identity Document</div>
                  <div style={{ margin: '0.5rem 0', fontWeight: 600 }}>
                    {detail.documents.identityDocumentRef ? 'Present' : 'Missing'}
                  </div>
                  {detail.documents.identityDocumentRef ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setActiveDocRef(detail.documents.identityDocumentRef);
                        setActiveDocType('identityDoc');
                      }}
                      style={{
                        backgroundColor: 'var(--primary-purple)',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      View Document
                    </Button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Not submitted</span>
                  )}
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '1rem',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Passport / National ID</div>
                  <div style={{ margin: '0.5rem 0', fontWeight: 600 }}>
                    {detail.documents.passportDocumentRef ? 'Present' : 'Missing'}
                  </div>
                  {detail.documents.passportDocumentRef ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setActiveDocRef(detail.documents.passportDocumentRef);
                        setActiveDocType('passportDoc');
                      }}
                      style={{
                        backgroundColor: 'var(--primary-purple)',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      View Document
                    </Button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Not submitted</span>
                  )}
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '1rem',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Selfie Verification Proof</div>
                  <div style={{ margin: '0.5rem 0', fontWeight: 600 }}>
                    {detail.documents.selfieDocumentRef ? 'Present' : 'Missing'}
                  </div>
                  {detail.documents.selfieDocumentRef ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setActiveDocRef(detail.documents.selfieDocumentRef);
                        setActiveDocType('selfieDoc');
                      }}
                      style={{
                        backgroundColor: 'var(--primary-purple)',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      View Document
                    </Button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Not submitted</span>
                  )}
                </div>
              </div>
            </div>

            {/* Secure Document Previewer */}
            {activeDocRef && activeDocType && (
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--accent-lime)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                    Secure Document Preview: {activeDocType} ({activeDocRef})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDocRef(null);
                      setActiveDocType(null);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    Close Preview &times;
                  </button>
                </div>
                <div style={{ textAlign: 'center', padding: '1rem', backgroundColor: '#000000', borderRadius: 'var(--radius-xs)' }}>
                  <img
                    src={`/api/management/kyc/applications/${detail.application.id}/documents/${activeDocType}`}
                    alt="KYC Evidence"
                    style={{ maxWidth: '100%', maxHeight: '350px', objectFit: 'contain' }}
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Encrypted token stream delivered via authenticated session.
                  </p>
                </div>
              </div>
            )}

            {/* Decision Form */}
            <form onSubmit={handleDecisionSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Compliance Review Decision
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="kycDecision"
                      value="verify_identity"
                      checked={decision === 'verify_identity'}
                      onChange={() => setDecision('verify_identity')}
                    />
                    <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>Verify Identity (Approve)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="kycDecision"
                      value="start_identity_verification"
                      checked={decision === 'start_identity_verification'}
                      onChange={() => setDecision('start_identity_verification')}
                    />
                    <span style={{ color: 'var(--status-info)', fontWeight: 600 }}>Open / Request Submission</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="kycDecision"
                      value="request_info"
                      checked={decision === 'request_info'}
                      onChange={() => setDecision('request_info')}
                    />
                    <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>Request Supplemental Info</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="kycDecision"
                      value="reject"
                      checked={decision === 'reject'}
                      onChange={() => setDecision('reject')}
                    />
                    <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}>Reject Application</span>
                  </label>
                </div>
              </div>

              <div>
                <Textarea
                  label={`Reviewer Notes & Audit Trail Rationale ${decision === 'reject' ? '*' : ''}`}
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Enter verification notes, document checks performed, or rejection reason..."
                  rows={3}
                  required={decision === 'reject'}
                />
              </div>

              {decisionFeedback && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '0.85rem',
                    backgroundColor: decisionFeedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                    color: decisionFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                >
                  {decisionFeedback.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedAppId(null);
                    setDetail(null);
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting}
                  style={{
                    backgroundColor: decision === 'verify_identity' ? 'var(--status-success)' : decision === 'reject' ? 'var(--status-danger)' : 'var(--primary-purple)',
                    color: decision === 'verify_identity' ? '#0d0b12' : '#ffffff',
                    fontWeight: 800,
                  }}
                >
                  {submitting ? 'Applying Decision...' : 'Apply KYC Decision'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
};
export default KycManagementPage;
