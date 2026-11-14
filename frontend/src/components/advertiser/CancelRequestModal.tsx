import React, { useState } from 'react';
import { requestOrderCancellation } from '../../services/advertiser';
import { AdvertiserOrder } from '../../types/advertiser';

interface CancelRequestModalProps {
  order: AdvertiserOrder;
  onClose: () => void;
  onSuccess: (status: 'cancelled' | 'pending_review', message: string) => void;
}

export const CancelRequestModal: React.FC<CancelRequestModalProps> = ({ order, onClose, onSuccess }) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirectCancellation =
    ['draft', 'payment_pending', 'open_presign'].includes(order.status) &&
    order.assignedCount === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || reason.trim().length < 5) {
      setError('Please provide a meaningful cancellation reason (minimum 5 characters).');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await requestOrderCancellation(order.id, reason.trim());
      onSuccess(res.status, res.message);
    } catch (err: any) {
      setError(err.message || 'Failed to submit cancellation request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="studio-modal-backdrop">
      <div className="studio-modal-card">
        {/* Header */}
        <div className="studio-modal-header">
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: 800,
                color: 'var(--status-danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>⚠️</span> Cancel Boost Order
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Order #{order.id} ({order.orderRef}) — {order.gameName} ({order.serviceName})
            </span>
          </div>
          <button
            type="button"
            className="studio-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form id="cancel-order-form" onSubmit={handleSubmit}>
          <div className="studio-modal-body">
            {/* Informative Workflow Banner */}
            <div
              style={{
                backgroundColor: isDirectCancellation
                  ? 'rgba(250, 204, 21, 0.08)'
                  : 'rgba(234, 179, 8, 0.1)',
                border: `1px solid ${
                  isDirectCancellation ? 'rgba(250, 204, 21, 0.25)' : 'rgba(234, 179, 8, 0.3)'
                }`,
                borderRadius: '10px',
                padding: '0.85rem',
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                marginBottom: '1rem',
              }}
            >
              {isDirectCancellation ? (
                <div>
                  <strong style={{ color: 'var(--accent-yellow)' }}>✓ Immediate Cancellation Available:</strong>{' '}
                  No boosters have been assigned to this order yet. Submitting will immediately cancel the order and
                  release any reserved wallet funds back to your spendable available balance.
                </div>
              ) : (
                <div>
                  <strong style={{ color: '#eab308' }}>🛡️ Management Approval Workflow Required:</strong> This order
                  has active booster assignments or is in progress. To protect financial integrity and prevent double-spending,
                  your cancellation request will be submitted to G4X management for verification and settlement.
                </div>
              )}
            </div>

            {error && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid var(--status-danger)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  color: '#f87171',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                {error}
              </div>
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.4rem',
                  fontWeight: 600,
                }}
              >
                Reason for Cancellation (required, min 5 chars):
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="E.g., Customer requested rescheduling, incorrect dungeon key selected, or duplicate order..."
                rows={4}
                maxLength={300}
                className="input"
                style={{
                  width: '100%',
                  minHeight: '100px',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {reason.length} / 300 characters
                </span>
              </div>
            </div>
          </div>

          <div className="studio-modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="submit"
              className="btn-danger"
              disabled={submitting}
            >
              {submitting
                ? 'Submitting...'
                : isDirectCancellation
                ? 'Confirm Cancellation'
                : 'Submit Review Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
