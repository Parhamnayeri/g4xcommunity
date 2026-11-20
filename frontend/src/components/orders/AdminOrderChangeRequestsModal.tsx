import React, { useState, useEffect, useCallback } from 'react';
import { fetchOrderChangeRequests, resolveOrderChangeRequest } from '../../services/advertiser';
import { OrderChangeRequest } from '../../types/advertiser';

interface AdminOrderChangeRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

export const AdminOrderChangeRequestsModal: React.FC<AdminOrderChangeRequestsModalProps> = ({
  isOpen,
  onClose,
  onResolved,
}) => {
  const [requests, setRequests] = useState<OrderChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = filterStatus === 'ALL' ? undefined : filterStatus;
      const res = await fetchOrderChangeRequests(statusParam);
      setRequests(res.changeRequests || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load order change requests');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    if (isOpen) {
      loadRequests();
    }
  }, [isOpen, loadRequests]);

  if (!isOpen) return null;

  const handleResolve = async (id: number, decision: 'APPROVED' | 'REJECTED', note?: string) => {
    setActionLoadingId(id);
    setFeedback(null);
    try {
      const res = await resolveOrderChangeRequest(id, decision, note);
      setFeedback({ text: res.message || `Request #${id} marked as ${decision}`, type: 'success' });
      setRejectingId(null);
      setRejectNote('');
      await loadRequests();
      onResolved();
    } catch (err: any) {
      setFeedback({ text: err.message || `Failed to ${decision.toLowerCase()} request`, type: 'error' });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 4, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          borderRadius: '16px',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '88vh',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(24, 21, 36, 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.3rem' }}>📋</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f4f4f6' }}>
                Advertiser Order Change &amp; Cancellation Requests
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#9490a6' }}>
                Review and approve advertiser order modifications and cancellations with automatic escrow refunds.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #9490a6)',
              fontSize: '1.25rem',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Filter Toolbar */}
        <div
          style={{
            padding: '0.75rem 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            backgroundColor: 'rgba(13, 11, 18, 0.4)',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: filterStatus === st ? '1px solid var(--accent-lime, #ccff00)' : '1px solid rgba(124, 58, 237, 0.25)',
                  backgroundColor: filterStatus === st ? 'rgba(204, 255, 0, 0.15)' : 'transparent',
                  color: filterStatus === st ? 'var(--accent-lime, #ccff00)' : '#9490a6',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {st}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadRequests}
            disabled={loading}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid rgba(148, 144, 166, 0.3)',
              backgroundColor: 'transparent',
              color: '#f4f4f6',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* Feedback message */}
        {feedback && (
          <div
            style={{
              margin: '1rem 1.5rem 0',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: feedback.type === 'success' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${feedback.type === 'success' ? 'rgba(204, 255, 0, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
              color: feedback.type === 'success' ? 'var(--accent-lime, #ccff00)' : '#fca5a5',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            {feedback.text}
          </div>
        )}

        {/* List Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9490a6' }}>
              Loading change requests...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#f87171' }}>
              {error}
            </div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9490a6' }}>
              No {filterStatus !== 'ALL' ? filterStatus.toLowerCase() : ''} change requests found.
            </div>
          ) : (
            requests.map((cr) => {
              const isPending = cr.status === 'PENDING';
              const isLoading = actionLoadingId === cr.id;
              const isRejectFormOpen = rejectingId === cr.id;

              return (
                <div
                  key={cr.id}
                  style={{
                    backgroundColor: 'rgba(13, 11, 18, 0.7)',
                    borderRadius: '12px',
                    border: `1px solid ${
                      cr.requestType === 'CANCEL' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(124, 58, 237, 0.35)'
                    }`,
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {/* Top Bar: Order ID, Type Badge, Requester */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span
                        style={{
                          backgroundColor: cr.requestType === 'CANCEL' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: cr.requestType === 'CANCEL' ? '#f87171' : '#60a5fa',
                          border: `1px solid ${cr.requestType === 'CANCEL' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)'}`,
                          borderRadius: '6px',
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                        }}
                      >
                        {cr.requestType === 'CANCEL' ? '🛑 CANCELLATION REQUEST' : '✏️ EDIT REQUEST'}
                      </span>
                      <strong style={{ color: '#ffffff', fontSize: '0.95rem' }}>
                        Order #{cr.orderRef || cr.orderId}
                      </strong>
                      <span style={{ color: '#9490a6', fontSize: '0.85rem' }}>
                        {cr.gameName} ({cr.serviceName})
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          backgroundColor:
                            cr.status === 'APPROVED'
                              ? 'rgba(204, 255, 0, 0.15)'
                              : cr.status === 'REJECTED'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(245, 158, 11, 0.15)',
                          color:
                            cr.status === 'APPROVED'
                              ? 'var(--accent-lime, #ccff00)'
                              : cr.status === 'REJECTED'
                              ? '#f87171'
                              : '#f59e0b',
                          borderRadius: '6px',
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        {cr.status}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#9490a6' }}>
                        {new Date(cr.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Requester info */}
                  <div style={{ fontSize: '0.8rem', color: '#9490a6', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>
                      Requested by: <strong style={{ color: '#ffffff' }}>{cr.requester?.displayName || cr.requester?.username}</strong>
                    </span>
                    <span>
                      Advertiser Rank: <strong style={{ color: 'var(--accent-lime, #ccff00)' }}>{cr.requester?.advertiserRank || 'BRONZE'}</strong>
                    </span>
                    <span>
                      Order Value: <strong style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>${cr.grossAmountUsd}</strong>
                    </span>
                  </div>

                  {/* Reason Box */}
                  <div
                    style={{
                      backgroundColor: 'rgba(24, 21, 36, 0.8)',
                      borderRadius: '8px',
                      padding: '0.75rem 1rem',
                      fontSize: '0.85rem',
                      borderLeft: `3px solid ${cr.requestType === 'CANCEL' ? '#ef4444' : '#3b82f6'}`,
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', color: '#9490a6', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                      Requester Reason:
                    </div>
                    <div style={{ color: '#f4f4f6', lineHeight: 1.4 }}>{cr.reason}</div>
                  </div>

                  {/* Proposed changes if EDIT */}
                  {cr.requestType === 'EDIT' && cr.proposedChanges && Object.keys(cr.proposedChanges).length > 0 && (
                    <div
                      style={{
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: '0.35rem' }}>
                        Proposed Modifications:
                      </div>
                      {cr.proposedChanges.title && (
                        <div>
                          <strong>New Title:</strong> {cr.proposedChanges.title}
                        </div>
                      )}
                      {cr.proposedChanges.notes && (
                        <div>
                          <strong>New Notes:</strong> {cr.proposedChanges.notes}
                        </div>
                      )}
                      {cr.proposedChanges.boosterPoolUsd && (
                        <div>
                          <strong>New Booster Pool:</strong> ${Number(cr.proposedChanges.boosterPoolUsd).toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cancellation refund note */}
                  {cr.requestType === 'CANCEL' && (
                    <div style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                      ℹ️ Approving cancellation will cancel Order #{cr.orderRef} and automatically refund <strong>${cr.grossAmountUsd}</strong> back to the advertiser's spendable wallet.
                    </div>
                  )}

                  {/* Review note if resolved */}
                  {cr.reviewNote && (
                    <div style={{ fontSize: '0.8rem', color: '#9490a6', fontStyle: 'italic' }}>
                      Review note: {cr.reviewNote} {cr.reviewedBy ? `(by ${cr.reviewedBy})` : ''}
                    </div>
                  )}

                  {/* Actions for PENDING */}
                  {isPending && (
                    <div>
                      {!isRejectFormOpen ? (
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                          <button
                            type="button"
                            onClick={() => setRejectingId(cr.id)}
                            disabled={isLoading}
                            style={{
                              padding: '0.45rem 1rem',
                              borderRadius: '6px',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#f87171',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Reject...
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolve(cr.id, 'APPROVED')}
                            disabled={isLoading}
                            style={{
                              padding: '0.45rem 1.25rem',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: 'var(--accent-lime, #ccff00)',
                              color: '#0d0b12',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: isLoading ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isLoading ? 'Processing...' : '✓ Approve & Apply'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <input
                            type="text"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Reason for rejection (optional)..."
                            style={{
                              padding: '0.5rem 0.75rem',
                              backgroundColor: 'rgba(13, 11, 18, 0.8)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              borderRadius: '6px',
                              color: '#ffffff',
                              fontSize: '0.8rem',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingId(null);
                                setRejectNote('');
                              }}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(148, 144, 166, 0.3)',
                                backgroundColor: 'transparent',
                                color: '#9490a6',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolve(cr.id, 'REJECTED', rejectNote)}
                              disabled={isLoading}
                              style={{
                                padding: '0.35rem 0.9rem',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: '#ef4444',
                                color: '#ffffff',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Confirm Rejection
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
