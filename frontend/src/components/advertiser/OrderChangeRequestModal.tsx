import React, { useState } from 'react';
import { submitOrderChangeRequest } from '../../services/advertiser';
import { AdvertiserOrder } from '../../types/advertiser';

interface OrderChangeRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: AdvertiserOrder | null;
  initialType?: 'EDIT' | 'CANCEL';
  onSuccess: (message: string) => void;
}

export const OrderChangeRequestModal: React.FC<OrderChangeRequestModalProps> = ({
  isOpen,
  onClose,
  order,
  initialType = 'EDIT',
  onSuccess,
}) => {
  const [requestType, setRequestType] = useState<'EDIT' | 'CANCEL'>(initialType);
  const [reason, setReason] = useState('');
  const [newTitle, setNewTitle] = useState(order?.orderName || '');
  const [newNotes, setNewNotes] = useState(order?.notes || '');
  const [newBoosterPool, setNewBoosterPool] = useState(order?.feeInfo?.boosterPoolUsd || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (reason.trim().length < 3) {
      setError('Please provide a reason with at least 3 characters.');
      return;
    }

    setLoading(true);
    try {
      const proposedChanges: any = {};
      if (requestType === 'EDIT') {
        if (newTitle.trim() && newTitle.trim() !== order.orderName) {
          proposedChanges.title = newTitle.trim();
        }
        if (newNotes.trim() !== (order.notes || '')) {
          proposedChanges.notes = newNotes.trim();
        }
        if (newBoosterPool && newBoosterPool !== order.feeInfo?.boosterPoolUsd) {
          const poolNum = parseFloat(newBoosterPool);
          if (!isNaN(poolNum) && poolNum > 0) {
            proposedChanges.boosterPoolUsd = poolNum;
          }
        }
      }

      const res = await submitOrderChangeRequest(order.id, {
        requestType,
        reason: reason.trim(),
        proposedChanges: Object.keys(proposedChanges).length > 0 ? proposedChanges : undefined,
      });

      onSuccess(res.message || `Change request for #${order.orderRef} submitted for staff approval.`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit change request.');
    } finally {
      setLoading(false);
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
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          borderRadius: '16px',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
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
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f4f4f6' }}>
              Request Order {requestType === 'EDIT' ? 'Modification' : 'Cancellation'}
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', fontFamily: 'monospace' }}>
              Order #{order.orderRef} • {order.gameName} ({order.serviceName})
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
            }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}

          {/* Toggle Type */}
          <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'rgba(13, 11, 18, 0.7)', padding: '0.35rem', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setRequestType('EDIT')}
              style={{
                flex: 1,
                padding: '0.55rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: requestType === 'EDIT' ? 'var(--primary-purple, #7c3aed)' : 'transparent',
                color: requestType === 'EDIT' ? '#ffffff' : '#9490a6',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              ✏️ Request Edit
            </button>
            <button
              type="button"
              onClick={() => setRequestType('CANCEL')}
              style={{
                flex: 1,
                padding: '0.55rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: requestType === 'CANCEL' ? 'rgba(239, 68, 68, 0.8)' : 'transparent',
                color: requestType === 'CANCEL' ? '#ffffff' : '#9490a6',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              🛑 Request Cancellation
            </button>
          </div>

          {requestType === 'CANCEL' ? (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '1rem',
                fontSize: '0.85rem',
                color: '#fecaca',
                lineHeight: 1.5,
              }}
            >
              ⚠️ <strong>Refund Policy:</strong> Cancellation requests require admin approval to ensure no boosters are currently inside an active dungeon/raid run. Once approved, the full order amount of <strong>${order.grossAmountUsd}</strong> will be immediately unlocked and credited back to your spendable wallet balance.
            </div>
          ) : (
            <>
              {/* New Title */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Order Title / Headline
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. +10 M+ Mythic Timed Run"
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Instructions / Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Updated Notes &amp; Boost Instructions
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={3}
                  placeholder="Specify realm, character name, battletag, or key adjustments..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Booster Pool */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9490a6', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Target Booster Pool ($ USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newBoosterPool}
                  onChange={(e) => setNewBoosterPool(e.target.value)}
                  placeholder="Booster payout share"
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}

          {/* Reason (Mandatory) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#f4f4f6', marginBottom: '0.4rem', fontWeight: 700 }}>
              Reason for this request <span style={{ color: 'var(--accent-lime, #ccff00)' }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
              placeholder="e.g. Customer requested schedule shift / wrong character spec provided..."
              style={{
                width: '100%',
                padding: '0.65rem 1rem',
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid rgba(148, 144, 166, 0.3)',
                backgroundColor: 'transparent',
                color: '#9490a6',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.6rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: requestType === 'CANCEL' ? '#ef4444' : 'var(--primary-purple, #7c3aed)',
                color: '#ffffff',
                fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Submitting...' : `Submit ${requestType === 'EDIT' ? 'Edit' : 'Cancellation'} Request`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
