import React, { useState, useEffect, useCallback } from 'react';
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
import { sendUserKycDm } from '../services/adminPortal';
import { AssistedKycModal } from '../components/admin/AssistedKycModal';
import { LoadingState } from '../components/ui/LoadingState';

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

  // Detail & Decision Drawer
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

  // Assisted KYC & DM States
  const [showAssistModal, setShowAssistModal] = useState(false);
  const [sendingDm, setSendingDm] = useState(false);
  const [dmFeedback, setDmFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleSendKycDm = async () => {
    if (!detail?.application?.userId) return;
    setSendingDm(true);
    setDmFeedback(null);
    try {
      const res = await sendUserKycDm(
        detail.application.userId,
        `For application #${detail.application.id} (${detail.application.category})`
      );
      if (res.dmSent) {
        setDmFeedback({ text: '✓ KYC verification portal link sent to applicant Discord DM!', type: 'success' });
      } else {
        setDmFeedback({ text: `⚠️ User's DMs are closed (${res.error || 'Blocked'}). Direct link: ${res.kycUrl}`, type: 'error' });
      }
    } catch (err: any) {
      setDmFeedback({ text: err.message || 'Failed to dispatch KYC DM', type: 'error' });
    } finally {
      setSendingDm(false);
    }
  };

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
      setPagination(res?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
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
      </div>

      {error ? (
        <div className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>Restricted Compliance Area</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Generic Staff members do not hold identity review permissions. Management or Owner roles required.
          </p>
        </div>
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
              <select
                className="input"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ width: 'auto', padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
              >
                <option value="">All Verification Categories</option>
                <option value="pilot">Account Pilots (High-Risk)</option>
                <option value="exchanger">P2P Exchangers</option>
                <option value="booster">Boosters</option>
                <option value="advertiser">Advertisers</option>
              </select>

              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: 'auto', padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
              >
                <option value="pending">Pending Queue</option>
                <option value="info_requested">Info Requested</option>
                <option value="approved">Approved &amp; Verified</option>
                <option value="rejected">Rejected</option>
                <option value="">All Records</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => loadQueue(pagination?.page ?? 1)}
              className="btn btn-secondary btn-sm"
            >
              ↻ Refresh Queue
            </button>
          </div>

          {/* Applications Table */}
          <div className="card-surface" style={{ padding: '1.25rem', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            {loading ? (
              <div style={{ padding: '3rem' }}>
                <LoadingState message="Fetching identity verification records..." />
              </div>
            ) : applications.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-state-icon">🪪</div>
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>No KYC verification applications pending review under current filters.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>App #</th>
                      <th>Applicant</th>
                      <th>Category</th>
                      <th>Documents</th>
                      <th>App Status</th>
                      <th>Identity Status</th>
                      <th style={{ textAlign: 'right' }}>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => {
                      const isSelf = user?.discordId === app.userId;
                      return (
                        <tr key={app.id}>
                          <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>#{app.id}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{app.displayName || app.username}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{app.userId}</div>
                          </td>
                          <td>
                            <span className="badge badge-purple">{app.category}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <span className={app.hasIdentityDoc ? 'badge badge-green' : 'badge badge-muted'}>
                                ID {app.hasIdentityDoc ? '✓' : '—'}
                              </span>
                              <span className={app.hasPassportDoc ? 'badge badge-green' : 'badge badge-muted'}>
                                Passport {app.hasPassportDoc ? '✓' : '—'}
                              </span>
                              <span className={app.hasSelfieDoc ? 'badge badge-green' : 'badge badge-muted'}>
                                Selfie {app.hasSelfieDoc ? '✓' : '—'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                app.status === 'approved'
                                  ? 'badge-green'
                                  : app.status === 'rejected'
                                  ? 'badge-danger'
                                  : 'badge-amber'
                              }`}
                            >
                              {app.status}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                app.identityStatus === 'verified'
                                  ? 'badge-green'
                                  : app.identityStatus === 'rejected'
                                  ? 'badge-danger'
                                  : 'badge-amber'
                              }`}
                            >
                              {app.identityStatus}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {isSelf ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Self-review blocked
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => loadDetail(app.id)}
                                className="btn btn-cta btn-xs"
                              >
                                Inspect &amp; Decide
                              </button>
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
            {(pagination?.totalPages ?? 0) > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '1rem',
                  marginTop: '1rem',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                <div>
                  Page {pagination?.page ?? 1} of {pagination?.totalPages || 1} ({pagination?.total ?? 0} applications)
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={(pagination?.page ?? 1) <= 1}
                    onClick={() => loadQueue((pagination?.page ?? 1) - 1)}
                    className="btn btn-secondary btn-sm"
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={(pagination?.page ?? 1) >= (pagination?.totalPages || 1)}
                    onClick={() => loadQueue((pagination?.page ?? 1) + 1)}
                    className="btn btn-secondary btn-sm"
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* KYC Application Inspection & Decision Drawer / Modal */}
      {selectedAppId && (
        <div className="studio-modal-backdrop" onClick={() => { setSelectedAppId(null); setDetail(null); }}>
          <div className="studio-modal-card studio-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                  KYC Verification File #{selectedAppId}
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Confidential identity records
                </span>
              </div>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => {
                  setSelectedAppId(null);
                  setDetail(null);
                }}
              >
                &times;
              </button>
            </div>

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

                {/* Assisted KYC & Direct DM Toolbar */}
                <div
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    padding: '0.85rem 1rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-xs)',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={sendingDm}
                      onClick={handleSendKycDm}
                      className="btn btn-secondary btn-xs"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>✉️</span> {sendingDm ? 'Sending DM...' : 'Send KYC Request DM'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAssistModal(true)}
                      className="btn btn-purple btn-xs"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>✏️</span> Complete / Edit KYC for User
                    </button>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Single-Verification: Approving verifies user universally across all games.
                  </span>
                </div>

                {dmFeedback && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '0.8rem',
                      backgroundColor: dmFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: dmFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      border: `1px solid ${dmFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {dmFeedback.text}
                  </div>
                )}

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
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDocRef(detail.documents.identityDocumentRef);
                            setActiveDocType('identityDoc');
                          }}
                          className="btn btn-sm"
                          style={{
                            backgroundColor: 'var(--primary-purple)',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            padding: '0.25rem 0.5rem',
                          }}
                        >
                          View Document
                        </button>
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
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDocRef(detail.documents.passportDocumentRef);
                            setActiveDocType('passportDoc');
                          }}
                          className="btn btn-sm"
                          style={{
                            backgroundColor: 'var(--primary-purple)',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            padding: '0.25rem 0.5rem',
                          }}
                        >
                          View Document
                        </button>
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
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDocRef(detail.documents.selfieDocumentRef);
                            setActiveDocType('selfieDoc');
                          }}
                          className="btn btn-sm"
                          style={{
                            backgroundColor: 'var(--primary-purple)',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            padding: '0.25rem 0.5rem',
                          }}
                        >
                          View Document
                        </button>
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
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                      Reviewer Notes &amp; Audit Trail Rationale {decision === 'reject' && <span style={{ color: 'var(--status-danger)' }}>*</span>}
                    </label>
                    <textarea
                      value={reviewerNotes}
                      onChange={(e) => setReviewerNotes(e.target.value)}
                      placeholder="Enter verification notes, document checks performed, or rejection reason..."
                      rows={3}
                      required={decision === 'reject'}
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

                  {decisionFeedback && (
                    <div
                      style={{
                        padding: '0.75rem',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.85rem',
                        backgroundColor: decisionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: decisionFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      }}
                    >
                      {decisionFeedback.text}
                    </div>
                  )}

                  <div className="studio-modal-footer">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAppId(null);
                        setDetail(null);
                      }}
                      disabled={submitting}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-cta'} btn-sm`}
                    >
                      {submitting ? 'Applying Decision...' : 'Apply KYC Decision'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff Assisted KYC Modal */}
      {showAssistModal && detail && (
        <AssistedKycModal
          userId={detail.application.userId}
          userDisplayName={detail.application.displayName || detail.application.username}
          isOpen={showAssistModal}
          onClose={() => setShowAssistModal(false)}
          onSuccess={() => {
            loadDetail(detail.application.id);
            loadQueue(pagination.page);
          }}
        />
      )}
    </div>
  );
};
export default KycManagementPage;
