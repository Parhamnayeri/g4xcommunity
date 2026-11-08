import React, { useState } from 'react';
import { updateOrderNotes } from '../../services/advertiser';
import { AdvertiserOrder } from '../../types/advertiser';

interface EditNoteModalProps {
  order: AdvertiserOrder;
  onClose: () => void;
  onSuccess: (updatedNotes: string) => void;
}

export const EditNoteModal: React.FC<EditNoteModalProps> = ({ order, onClose, onSuccess }) => {
  const [notes, setNotes] = useState(order.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (notes.length > 500) {
      setError('Notes cannot exceed 500 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await updateOrderNotes(order.id, notes);
      onSuccess(res.notes);
    } catch (err: any) {
      setError(err.message || 'Failed to update order notes.');
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
          border: '1px solid rgba(124, 58, 237, 0.4)',
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
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary, #f4f4f6)' }}>
              Edit Order Notes
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', fontFamily: 'monospace' }}>
              Order #{order.id} ({order.orderRef})
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
              Order Instructions &amp; Notes for Boosters:
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="E.g., Specific dungeon keystones, scheduling preferences, or customer character info..."
              rows={5}
              maxLength={500}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                backgroundColor: 'rgba(13, 11, 18, 0.8)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: '8px',
                padding: '0.75rem',
                color: 'var(--text-primary, #f4f4f6)',
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--primary-purple, #7c3aed)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(124, 58, 237, 0.3)')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: notes.length > 450 ? '#f87171' : 'var(--text-muted, #9490a6)',
                }}
              >
                {notes.length} / 500 characters
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
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: 'var(--primary-purple, #7c3aed)',
                border: 'none',
                borderRadius: '8px',
                padding: '0.6rem 1.4rem',
                color: '#ffffff',
                fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
                fontSize: '0.9rem',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.35)',
              }}
            >
              {submitting ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
