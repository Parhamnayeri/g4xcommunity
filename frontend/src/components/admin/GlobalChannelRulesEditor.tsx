import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';

const DEFAULT_RULES = `🔒 **G4X Community — Fixed Operational Rules**
1. **Confidentiality:** Do not share customer information, account credentials, or internal details outside this channel.
2. **Streaming & Recording:** Streaming is strictly prohibited unless explicitly approved in order specifications.
3. **Communication:** Keep all order-related coordination strictly inside this temporary execution channel.
4. **Completion Proof:** Clear screenshot/video proof must be posted here upon completion before requesting closure.
5. **VPN & Security:** Follow the VPN and safety instructions specified for this order at all times.`;

export const GlobalChannelRulesEditor: React.FC = () => {
  const [rules, setRules] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ success: boolean; rules: string }>('/api/admin/settings/channel-rules')
      .then((res) => {
        if (active && res && res.rules) {
          setRules(res.rules);
        }
      })
      .catch((err) => {
        if (active) {
          console.warn('Failed to load global rules:', err);
          setRules(DEFAULT_RULES);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ success: boolean; rules: string }>(
        '/api/admin/settings/channel-rules',
        {
          method: 'PUT',
          body: JSON.stringify({ rules }),
        }
      );
      if (res && res.success) {
        setFeedback({ text: 'Global channel rules updated successfully.', type: 'success' });
      } else {
        setFeedback({ text: 'Failed to update rules.', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err?.message || 'Error saving global rules', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-surface" style={{
      padding: '1.25rem',
      marginTop: '1.5rem',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔒</span> Global Temporary Channel Rules (Fixed Part 1)
          </h3>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            These fixed operational rules are automatically prepended as Part 1 to every private temporary Discord order channel created across all games.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => setRules(DEFAULT_RULES)}
          >
            ↺ Reset Defaults
          </button>
          <button
            type="button"
            className="btn btn-cta btn-xs"
            disabled={saving || loading}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Global Rules'}
          </button>
        </div>
      </div>

      {feedback && (
        <p style={{
          margin: '0 0 0.75rem 0',
          fontSize: '0.82rem',
          color: feedback.type === 'success' ? 'var(--status-success, #10b981)' : 'var(--status-danger, #ef4444)'
        }}>
          {feedback.text}
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading rules configuration...</p>
      ) : (
        <textarea
          className="input"
          rows={7}
          style={{
            width: '100%',
            padding: '0.65rem',
            fontSize: '0.82rem',
            fontFamily: 'monospace',
            lineHeight: 1.45,
            borderRadius: 'var(--radius-sm)',
            boxSizing: 'border-box'
          }}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
        />
      )}
    </div>
  );
};
