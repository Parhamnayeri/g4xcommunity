import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '../components/ui/LoadingState';
import { fetchMyKyc, submitMyKyc, UserKycStatusResponse } from '../services/profileSettings';

export const ProfileKycPage: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<UserKycStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [legalName, setLegalName] = useState<string>('');
  const [country, setCountry] = useState<string>('IR');
  const [idType, setIdType] = useState<string>('national_id');
  const [idNumber, setIdNumber] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [vpnConfirmed, setVpnConfirmed] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');

  // File uploads state
  const [identityFile, setIdentityFile] = useState<{ name: string; dataUrl: string; sizeKb: number } | null>(null);
  const [selfieFile, setSelfieFile] = useState<{ name: string; dataUrl: string; sizeKb: number } | null>(null);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadKyc = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyKyc();
      if (res.success) {
        setData(res);
        if (res.profileData) {
          if (res.profileData.legalName) setLegalName(res.profileData.legalName);
          if (res.profileData.country) setCountry(res.profileData.country);
          if (res.profileData.idNumber) setIdNumber(res.profileData.idNumber);
          if (res.profileData.phoneNumber) setPhoneNumber(res.profileData.phoneNumber);
          if (res.profileData.vpnConfirmed !== undefined) setVpnConfirmed(Boolean(res.profileData.vpnConfirmed));
        }
      } else {
        setError(res.message || 'Failed to retrieve KYC status.');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKyc();
  }, [loadKyc]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!legalName.trim()) {
      setFeedback({ text: 'Please enter your legal full name matching your document.', type: 'error' });
      return;
    }
    if (!idNumber.trim()) {
      setFeedback({ text: 'Please enter your government ID / National Code number.', type: 'error' });
      return;
    }
    if (!identityFile && !data?.documents?.identity) {
      setFeedback({ text: 'Please upload a photo of your Government ID document.', type: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitMyKyc({
        legalName: legalName.trim(),
        country: country.trim(),
        idType,
        idNumber: idNumber.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        vpnConfirmed,
        notes: notes.trim() || undefined,
        identityDocData: identityFile?.dataUrl,
        identityDocName: identityFile?.name,
        selfieDocData: selfieFile?.dataUrl,
        selfieDocName: selfieFile?.name,
      });

      if (res.success) {
        setFeedback({
          text: res.message || 'KYC submitted successfully and is now under staff review!',
          type: 'success',
        });
        setTimeout(() => {
          loadKyc();
        }, 1500);
      } else {
        setFeedback({ text: res.message || 'Submission failed.', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to submit KYC documents.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingState message="Checking identity verification status..." />;
  }

  const isVerified = data?.isVerified || data?.status === 'verified';
  const isPending = !isVerified && (data?.status === 'pending');
  const isRejected = !isVerified && (data?.status === 'rejected');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Navigation & Breadcrumbs */}
      <div className="flex items-center justify-between">
        <Link to="/profile" className="btn btn-secondary btn-sm flex items-center gap-2">
          <span>&larr;</span> Back to Profile
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Security &amp; Identity</span>
          <span className="text-xs text-gray-600">/</span>
          <span className="text-xs font-semibold text-white">KYC Verification</span>
        </div>
      </div>

      {/* Main Header Card */}
      <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🪪</span>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide">Identity Verification (KYC)</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                Single-Verification System: Verify your identity once to unlock Pilot Boosting, P2P Exchanger escrow, and Advertiser operations.
              </p>
            </div>
          </div>
        </div>
        <div>
          {isVerified ? (
            <span className="badge badge-green px-3 py-1 text-xs">
              ✓ Verified &amp; Active
            </span>
          ) : isPending ? (
            <span className="badge badge-amber px-3 py-1 text-xs">
              ⏳ Under Staff Review
            </span>
          ) : isRejected ? (
            <span className="badge badge-danger px-3 py-1 text-xs">
              ✕ Verification Rejected
            </span>
          ) : (
            <span className="badge badge-secondary px-3 py-1 text-xs">
              Unverified
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* CASE 1: USER IS ALREADY GLOBALLY VERIFIED */}
      {isVerified && (
        <div className="card-surface p-6 rounded-xl border border-emerald-500/30 bg-emerald-950/10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-2xl text-emerald-400">
              ✓
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Identity Verified (KYC Complete)</h2>
              <p className="text-xs text-emerald-300/80 mt-0.5">
                Your legal identity has been authenticated and approved by G4X Staff.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Verification Status</span>
              <span className="text-emerald-400 font-bold font-mono text-sm">AUTHENTICATED</span>
            </div>
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Verified Date</span>
              <span className="text-white font-mono text-sm">
                {data?.verifiedAt ? new Date(data.verifiedAt).toLocaleDateString() : 'Active'}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Platform Scope</span>
              <span className="text-purple-300 font-bold text-sm">Universal (All Roles)</span>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] text-xs text-emerald-200 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <span>🛡️</span> Single-Verification Guarantee Active
            </div>
            <p className="text-emerald-300/80 leading-relaxed">
              You will never be asked to re-upload government documents or complete redundant KYC submissions for any game, pilot booster role, exchanger desk, or advertiser account. Your verification status is automatically reused across the entire G4X platform.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/profile" className="btn btn-secondary btn-sm">
              Return to Profile
            </Link>
            <Link to="/booster/settings" className="btn btn-purple btn-sm">
              Booster Settings &amp; Queue
            </Link>
          </div>
        </div>
      )}

      {/* CASE 2: UNDER REVIEW */}
      {isPending && (
        <div className="card-surface p-6 rounded-xl border border-amber-500/30 bg-amber-950/10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl text-amber-400">
              ⏳
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Identity Verification Under Review</h2>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Your submitted documents are securely stored and queued for compliance review.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Queue Status</span>
              <span className="text-amber-400 font-bold font-mono text-sm">AWAITING REVIEW</span>
            </div>
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Submitted Date</span>
              <span className="text-white font-mono text-sm">
                {data?.pilotVerification?.submittedAt
                  ? new Date(data.pilotVerification.submittedAt).toLocaleDateString()
                  : data?.latestApplication?.submittedAt
                  ? new Date(data.latestApplication.submittedAt).toLocaleDateString()
                  : 'Recent'}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-gray-400 block mb-1">Documents on File</span>
              <span className="text-gray-300 font-mono text-sm">
                {data?.documents?.identity ? 'ID Document ✓' : 'Submitted'}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            Staff reviews are typically processed within 24 hours. You will automatically receive a Discord notification once your verification is finalized. If you have questions or urgent orders, reach out in Discord #support.
          </p>

          <div className="pt-2">
            <Link to="/profile" className="btn btn-secondary btn-sm">
              Return to Profile
            </Link>
          </div>
        </div>
      )}

      {/* CASE 3: UNVERIFIED OR REJECTED (SHOW SUBMISSION FORM) */}
      {!isVerified && !isPending && (
        <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-6">
          {isRejected && (
            <div className="p-4 rounded-lg bg-red-950/40 border border-red-500/40 text-red-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-sm text-red-300">
                <span>⚠️</span> Previous Verification Attempt Was Rejected
              </div>
              <p className="text-red-300/80">
                {data?.pilotVerification?.reviewNote || data?.latestApplication?.reviewNotes || 'The submitted documents were incomplete or unclear. Please submit clear, un-cropped photos.'}
              </p>
            </div>
          )}

          <div className="border-b border-[rgba(255,255,255,0.08)] pb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>📋</span> Submit Your Legal Identity Documents
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              All documents are encrypted and accessible strictly by authorized G4X compliance administrators.
            </p>
          </div>

          {feedback && (
            <div
              className="p-3.5 rounded-lg text-xs"
              style={{
                backgroundColor: feedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                border: `1px solid ${feedback.type === 'success' ? 'var(--status-success-border)' : 'var(--status-danger-border)'}`,
              }}
            >
              {feedback.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Legal Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ali Rezaei"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-purple)]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Country / Operational Region <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Iran / IR"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-purple)]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  ID Document Type <span className="text-red-400">*</span>
                </label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white focus:outline-none focus:border-[var(--primary-purple)]"
                >
                  <option value="national_id">National ID Card (کارت ملی)</option>
                  <option value="passport">Passport (گذرنامه)</option>
                  <option value="drivers_license">Driver's License (گواهینامه رانندگی)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Government ID / National Code Number <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 0012345678"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-purple)]"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Contact Phone Number (Optional for SMS / Direct Coordination)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 09123456789"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-purple)]"
                />
              </div>
            </div>

            {/* Document Uploads */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Document 1: Front ID */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>📄</span> Government Photo ID (Front) <span className="text-red-400">*</span>
                  </span>
                  {identityFile && (
                    <span className="badge badge-green text-[10px]">Ready ({identityFile.sizeKb} KB)</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 leading-normal">
                  High-resolution photo or scan of your National ID or Passport photo page. All 4 corners must be visible.
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => handleFileChange(e, 'identity')}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary-purple)] file:text-white hover:file:opacity-90 cursor-pointer"
                />
                {identityFile && (
                  <div className="text-[11px] text-emerald-400 truncate">
                    Selected: {identityFile.name}
                  </div>
                )}
              </div>

              {/* Document 2: Selfie / Handwritten */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🤳</span> Selfie with ID Document
                  </span>
                  {selfieFile && (
                    <span className="badge badge-green text-[10px]">Ready ({selfieFile.sizeKb} KB)</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 leading-normal">
                  Clear photo of your face holding the ID next to your face, or a handwritten note with "G4X Community" and today's date.
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => handleFileChange(e, 'selfie')}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary-purple)] file:text-white hover:file:opacity-90 cursor-pointer"
                />
                {selfieFile && (
                  <div className="text-[11px] text-emerald-400 truncate">
                    Selected: {selfieFile.name}
                  </div>
                )}
              </div>
            </div>

            {/* VPN Confirmation */}
            <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vpnConfirmed}
                  onChange={(e) => setVpnConfirmed(e.target.checked)}
                  className="mt-1 rounded border-gray-600 text-[var(--primary-purple)] focus:ring-0"
                />
                <span className="text-xs text-gray-300 leading-relaxed">
                  <strong>Residential VPN / Dedicated Static IP Confirmation:</strong> I confirm that I have reliable, clean residential static IP or VPN matching customer server regions to prevent account lockouts during piloted carries.
                </span>
              </label>
            </div>

            {/* Additional Notes */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Additional Notes / Telegram / WhatsApp Handles (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Any special details, secondary contact methods, or platform notes for reviewing staff..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-purple)] resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link to="/profile" className="btn btn-secondary btn-sm">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="btn btn-cta btn-sm"
              >
                {submitting ? 'Encrypting & Submitting...' : 'Submit Identity Documents for Review'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ProfileKycPage;
