import React, { useState, useEffect } from 'react';
import { fetchUserKyc, assistUserKyc, sendUserKycDm } from '../../services/adminPortal';
import { LoadingState } from '../ui/LoadingState';

interface Props {
  userId: string;
  userDisplayName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AssistedKycModal: React.FC<Props> = ({
  userId,
  userDisplayName,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(true);
  const [kycData, setKycData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [legalName, setLegalName] = useState('');
  const [country, setCountry] = useState('IR');
  const [idType, setIdType] = useState('national_id');
  const [idNumber, setIdNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [vpnConfirmed, setVpnConfirmed] = useState(true);
  const [adminNotes, setAdminNotes] = useState('');
  const [markAsVerified, setMarkAsVerified] = useState(true);

  // File Uploads
  const [identityFile, setIdentityFile] = useState<{ name: string; dataUrl: string; sizeKb: number } | null>(null);
  const [selfieFile, setSelfieFile] = useState<{ name: string; dataUrl: string; sizeKb: number } | null>(null);

  // Submitting / DM state
  const [saving, setSaving] = useState(false);
  const [sendingDm, setSendingDm] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!isOpen || !userId) return;

    setLoading(true);
    setError(null);
    setFeedback(null);
    setIdentityFile(null);
    setSelfieFile(null);

    fetchUserKyc(userId)
      .then((res) => {
        setKycData(res);
        if (res.profileData) {
          if (res.profileData.legalName) setLegalName(res.profileData.legalName);
          if (res.profileData.country) setCountry(res.profileData.country);
          if (res.profileData.idNumber) setIdNumber(res.profileData.idNumber);
          if (res.profileData.phoneNumber) setPhoneNumber(res.profileData.phoneNumber);
          if (res.profileData.vpnConfirmed !== undefined) setVpnConfirmed(Boolean(res.profileData.vpnConfirmed));
          if (res.profileData.adminNotes) setAdminNotes(res.profileData.adminNotes);
        }
        setMarkAsVerified(Boolean(res.isVerified || res.status === 'verified'));
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch user KYC status');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, target: 'identity' | 'selfie') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setFeedback({ text: 'File size must be under 15MB', type: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        const fileObj = {
          name: file.name,
          dataUrl: result,
          sizeKb: Math.round(file.size / 1024),
        };
        if (target === 'identity') setIdentityFile(fileObj);
        else setSelfieFile(fileObj);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendDm = async () => {
    setSendingDm(true);
    setFeedback(null);
    try {
      const res = await sendUserKycDm(userId, adminNotes ? `Staff note: ${adminNotes}` : undefined);
      if (res.dmSent) {
        setFeedback({ text: `✓ KYC direct portal link successfully dispatched to user's Discord DM!`, type: 'success' });
      } else {
        setFeedback({
          text: `⚠️ Discord DM could not be delivered (${res.error || 'User DMs closed'}). Link: ${res.kycUrl}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to dispatch Discord DM', type: 'error' });
    } finally {
      setSendingDm(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const res = await assistUserKyc(userId, {
        legalName: legalName.trim() || undefined,
        country: country.trim() || undefined,
        idType,
        idNumber: idNumber.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        vpnConfirmed,
        adminNotes: adminNotes.trim() || undefined,
        identityDocData: identityFile?.dataUrl,
        identityDocName: identityFile?.name,
        selfieDocData: selfieFile?.dataUrl,
        selfieDocName: selfieFile?.name,
        markAsVerified,
      });

      if (res.success) {
        setFeedback({
          text: markAsVerified
            ? '✓ User KYC successfully verified and applied globally across all platform roles!'
            : '✓ User KYC details updated successfully.',
          type: 'success',
        });
        if (onSuccess) onSuccess();
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setFeedback({ text: res.message || 'Operation failed', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to save assisted KYC data', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="studio-modal-backdrop" onClick={onClose}>
      <div
        className="studio-modal-card studio-modal-card-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: '640px' }}
      >
        <div className="studio-modal-header">
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              🪪 Staff Assisted KYC &amp; Verification
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>
              Target User: <strong>{userDisplayName || userId}</strong> (<code>{userId}</code>)
            </p>
          </div>
          <button type="button" onClick={onClose} className="studio-modal-close" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem' }}>
            <LoadingState message="Fetching user KYC record..." />
          </div>
        ) : error ? (
          <div style={{ padding: '1.5rem', color: 'var(--status-danger)', fontSize: '0.9rem' }}>
            {error}
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <div className="studio-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Current Status Strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  backgroundColor: kycData?.isVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${kycData?.isVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: '8px',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Current Platform Status
                  </span>
                  <strong style={{ fontSize: '0.85rem', color: kycData?.isVerified ? '#34d399' : '#f3f4f6' }}>
                    {kycData?.isVerified
                      ? `✓ GLOBALLY VERIFIED (${kycData?.verifiedAt ? new Date(kycData.verifiedAt).toLocaleDateString() : 'Active'})`
                      : kycData?.status === 'pending'
                      ? '⏳ AWAITING VERIFICATION / UNDER REVIEW'
                      : kycData?.status === 'rejected'
                      ? '✕ REJECTED'
                      : 'NO RECORD / UNVERIFIED'}
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={handleSendDm}
                  disabled={sendingDm}
                  className="btn btn-secondary btn-xs"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>✉️</span> {sendingDm ? 'Sending DM...' : 'Send KYC Link DM'}
                </button>
              </div>

              {feedback && (
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    marginBottom: '1rem',
                    backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                    border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  }}
                >
                  {feedback.text}
                </div>
              )}

              {/* Form Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Legal Full Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Legal name on document"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Country / Region
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Iran / IR"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Document Type
                  </label>
                  <select
                    className="input"
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                  >
                    <option value="national_id">National ID Card (کارت ملی)</option>
                    <option value="passport">Passport (گذرنامه)</option>
                    <option value="drivers_license">Driver's License (گواهینامه)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Government ID / National Code
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 0012345678"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Contact Phone Number (Syncs to User Profile)
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 09123456789"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                  />
                </div>
              </div>

              {/* Upload or Replace Documents */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f3f4f6' }}>
                      📄 Photo ID Document
                    </span>
                    {kycData?.documents?.identity && (
                      <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>On File</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => handleFileChange(e, 'identity')}
                    style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%' }}
                  />
                  {identityFile && (
                    <div style={{ fontSize: '0.7rem', color: '#34d399', marginTop: '4px' }}>
                      New: {identityFile.name} ({identityFile.sizeKb} KB)
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f3f4f6' }}>
                      🤳 Selfie Verification
                    </span>
                    {kycData?.documents?.selfie && (
                      <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>On File</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => handleFileChange(e, 'selfie')}
                    style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%' }}
                  />
                  {selfieFile && (
                    <div style={{ fontSize: '0.7rem', color: '#34d399', marginTop: '4px' }}>
                      New: {selfieFile.name} ({selfieFile.sizeKb} KB)
                    </div>
                  )}
                </div>
              </div>

              {/* VPN confirmation toggle */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={vpnConfirmed}
                    onChange={(e) => setVpnConfirmed(e.target.checked)}
                  />
                  <span>Residential VPN / Clean Dedicated IP confirmed for operator</span>
                </label>
              </div>

              {/* Staff Audit Notes */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Staff Reviewer Notes / Audit Justification
                </label>
                <textarea
                  rows={2}
                  className="input"
                  placeholder="e.g. Identity verified via Discord video call / Iranian national card inspected..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  style={{ width: '100%', fontSize: '0.85rem', padding: '0.45rem 0.65rem' }}
                />
              </div>

              {/* Immediate Verification Toggle */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: markAsVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${markAsVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={markAsVerified}
                    onChange={(e) => setMarkAsVerified(e.target.checked)}
                    style={{ marginTop: '2px' }}
                  />
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: markAsVerified ? '#34d399' : '#f3f4f6', display: 'block' }}>
                      Approve &amp; Verify KYC Immediately (Single-Verification Active)
                    </strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, display: 'block', marginTop: '2px' }}>
                      Enabling this permanently marks the user as KYC Verified. They will be immediately cleared for Piloted Carries, Exchanger P2P escrow, and Advertiser operations without redundant checks.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="studio-modal-footer">
              <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`btn ${markAsVerified ? 'btn-cta' : 'btn-purple'} btn-sm`}
              >
                {saving ? 'Saving...' : markAsVerified ? 'Verify & Save User KYC' : 'Save KYC Changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default AssistedKycModal;
