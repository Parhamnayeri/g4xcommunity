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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '520px',
          padding: '1.75rem',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: 800,
                color: '#f87171',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>⚠️</span> Cancel Boost Order
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', fontFamily: 'monospace' }}>
              Order #{order.id} ({order.orderRef}) — {order.gameName} ({order.serviceName})
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #9490a6)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Informative Workflow Banner */}
        <div
          style={{
            backgroundColor: isDirectCancellation
              ? 'rgba(204, 255, 0, 0.08)'
              : 'rgba(234, 179, 8, 0.1)',
            border: `1px solid ${
              isDirectCancellation ? 'rgba(204, 255, 0, 0.25)' : 'rgba(234, 179, 8, 0.3)'
            }`,
            borderRadius: '10px',
            padding: '0.85rem',
            fontSize: '0.85rem',
            color: 'var(--text-primary, #f4f4f6)',
          }}
        >
          {isDirectCancellation ? (
            <div>
              <strong style={{ color: 'var(--accent-lime, #ccff00)' }}>✓ Immediate Cancellation Available:</strong>{' '}
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
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              padding: '0.75rem',
              color: '#f87171',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                color: 'var(--text-muted, #9490a6)',
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
              style={{
                width: '100%',
                boxSizing: 'border-box',
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '0.75rem',
                color: 'var(--text-primary, #f4f4f6)',
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#f87171')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(239, 68, 68, 0.3)')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>
                {reason.length} / 300 characters
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid rgba(148, 144, 166, 0.3)',
                borderRadius: '8px',
                padding: '0.6rem 1.2rem',
                color: 'var(--text-muted, #9490a6)',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Back
            </button>

            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: '#dc2626',
                border: 'none',
                borderRadius: '8px',
                padding: '0.6rem 1.4rem',
                color: '#ffffff',
                fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
                fontSize: '0.9rem',
                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.35)',
              }}
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
