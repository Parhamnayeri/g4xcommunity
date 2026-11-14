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
    <div className="studio-modal-backdrop">
      <div className="studio-modal-card">
        {/* Header */}
        <div className="studio-modal-header">
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Edit Order Notes
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Order #{order.id} ({order.orderRef})
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

        <form id="edit-note-form" onSubmit={handleSubmit}>
          <div className="studio-modal-body">
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
                Order Instructions &amp; Notes for Boosters:
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g., Specific dungeon keystones, scheduling preferences, or customer character info..."
                rows={5}
                maxLength={500}
                className="input"
                style={{
                  width: '100%',
                  minHeight: '120px',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: notes.length > 450 ? 'var(--status-danger)' : 'var(--text-muted)',
                  }}
                >
                  {notes.length} / 500 characters
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
              Cancel
            </button>
            <button
              type="submit"
              className="btn-cta"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
