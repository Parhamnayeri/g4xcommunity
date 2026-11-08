import React, { useState } from 'react';
import { ExchangerStatusResponse } from '../../types/exchange';
import { submitExchangerApplication } from '../../services/exchange';

interface ExchangerApplicationCardProps {
  statusData: ExchangerStatusResponse;
  onApplicationSubmitted: () => void;
}

export const ExchangerApplicationCard: React.FC<ExchangerApplicationCardProps> = ({
  statusData,
  onApplicationSubmitted,
}) => {
  const application = statusData.application;
  const [fullName, setFullName] = useState('');
  const [contactHandle, setContactHandle] = useState('');
  const [methods, setMethods] = useState<string[]>(['IRT_CARD', 'CRYPTO_USDT']);
  const [dailyVolume, setDailyVolume] = useState('1,000 - 5,000 USD');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const toggleMethod = (method: string) => {
    if (methods.includes(method)) {
      setMethods(methods.filter((m) => m !== method));
    } else {
      setMethods([...methods, method]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !contactHandle.trim()) {
      setErrorMsg('Full name and contact handle are required.');
      return;
    }
    if (methods.length === 0) {
      setErrorMsg('Please select at least one settlement capability.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        fullName: fullName.trim(),
        contactHandle: contactHandle.trim(),
        supportedMethods: methods,
        estimatedDailyVolume: dailyVolume,
        experienceNotes: notes.trim() || undefined,
      };
      await submitExchangerApplication(payload);
      setSuccessMsg('Your Exchanger application has been submitted to management for review.');
      setTimeout(() => {
        onApplicationSubmitted();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  // If user has an existing application
  if (application) {
    const isPending = application.status === 'pending' || application.status === 'under_review';
    const isRejected = application.status === 'rejected';

    return (
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '640px',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.25rem' }}>Exchanger Application Status</h3>
          <span
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 600,
              backgroundColor: isPending
                ? 'rgba(245, 158, 11, 0.15)'
                : isRejected
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(56, 189, 248, 0.15)',
              color: isPending ? '#f59e0b' : isRejected ? '#ef4444' : '#38bdf8',
            }}
          >
            {application.status.toUpperCase()}
          </span>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '20px' }}>
          {isPending &&
            'Your application to become a certified G4X Exchanger is currently under review by community management. Exchanger vetting ensures liquidity and transactional security for all community members.'}
          {isRejected &&
            'Your application to become a certified G4X Exchanger was not approved at this time. Please see the review notes below.'}
          {application.status === 'info_requested' &&
            'Additional documentation or information is requested to finalize your Exchanger approval.'}
        </p>

        <div style={{ backgroundColor: 'var(--bg-main)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.875rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>APPLICATION ID</span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>#{String(application.id)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>SUBMITTED DATE</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {new Date(application.submittedAt || application.createdAt || Date.now()).toLocaleDateString()}
              </span>
            </div>
            {application.reviewNotes && (
              <div style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>REVIEWER NOTES</span>
                <span style={{ color: '#ef4444', fontStyle: 'italic' }}>{application.reviewNotes}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={onApplicationSubmitted}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--bg-surface-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Refresh Status
          </button>
        </div>
      </div>
    );
  }

  // Application form if no application exists yet
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '640px',
        margin: '0 auto',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'rgba(124, 58, 237, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px auto',
            color: 'var(--primary-purple)',
            fontSize: '1.5rem',
          }}
        >
          ⚖️
        </div>
        <h3 style={{ margin: '0 0 6px 0', color: 'var(--text-primary)', fontSize: '1.35rem' }}>
          Apply to Become an Approved Exchanger
        </h3>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Approved Exchangers provide gold liquidity and P2P exchange services directly to the G4X Community.
        </p>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: '#ef4444',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.85rem',
          }}
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#10b981',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.85rem',
          }}
        >
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Full Legal / Business Name <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Parham Nayeri / GoldVault Exchange"
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Direct Contact Handle (Discord Tag / Telegram) <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={contactHandle}
            onChange={(e) => setContactHandle(e.target.value)}
            placeholder="e.g. @parham_g4x on Discord"
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Supported Settlement Capabilities <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { id: 'IRT_CARD', label: 'Toman / IRT Card & Sheba' },
              { id: 'CRYPTO_USDT', label: 'Crypto (USDT BEP-20 / TRC-20)' },
              { id: 'USD_WALLET', label: 'G4X Prepaid USD Wallet' },
            ].map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  backgroundColor: methods.includes(opt.id) ? 'rgba(124, 58, 237, 0.2)' : 'var(--bg-main)',
                  border: `1px solid ${methods.includes(opt.id) ? 'var(--primary-purple)' : 'var(--border-subtle)'}`,
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={methods.includes(opt.id)}
                  onChange={() => toggleMethod(opt.id)}
                  style={{ accentColor: 'var(--primary-purple)' }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Estimated Daily Liquidity Capacity
          </label>
          <select
            value={dailyVolume}
            onChange={(e) => setDailyVolume(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '0.9rem',
            }}
          >
            <option value="500 - 1,000 USD">500 – 1,000 USD / Day</option>
            <option value="1,000 - 5,000 USD">1,000 – 5,000 USD / Day</option>
            <option value="5,000 - 20,000 USD">5,000 – 20,000 USD / Day</option>
            <option value="20,000+ USD">20,000+ USD / Day</option>
          </select>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Exchange Experience & References (Optional)
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Tell us about your history with WoW gold trading or P2P financial settlements..."
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: 'var(--primary-purple)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
          }}
        >
          {submitting ? 'Submitting Application...' : 'Submit Exchanger Application'}
        </button>
      </form>
    </div>
  );
};
