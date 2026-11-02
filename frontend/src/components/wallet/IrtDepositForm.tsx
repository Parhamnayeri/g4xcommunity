import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { OfficialBankDetailsData, RatesAndPoliciesData, IrtQuoteData } from '../../types/wallet';
import { fetchIrtQuote, uploadReceiptFile, submitIrtDepositRequest } from '../../services/wallet';

interface IrtDepositFormProps {
  bankDetails: OfficialBankDetailsData;
  ratesAndPolicies: RatesAndPoliciesData;
  onSuccess: () => void;
}

export const IrtDepositForm: React.FC<IrtDepositFormProps> = ({
  bankDetails,
  ratesAndPolicies,
  onSuccess,
}) => {
  // Input fields
  const [tomanAmount, setTomanAmount] = useState<string>('');
  const [targetUsd, setTargetUsd] = useState<string>('10');
  const [payerIdentifier, setPayerIdentifier] = useState<string>('');
  const [senderCardLast4, setSenderCardLast4] = useState<string>('');
  const [evidenceRef, setEvidenceRef] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [adminNotes, setAdminNotes] = useState<string>('');

  // Receipt file upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState<boolean>(false);

  // Quote State
  const [quote, setQuote] = useState<IrtQuoteData | null>(null);
  const [loadingQuote, setLoadingQuote] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Copy status
  const [copiedCard, setCopiedCard] = useState<boolean>(false);

  // Calculate quote whenever targetUsd changes
  const calculateQuote = useCallback(async (usd: number) => {
    if (!usd || isNaN(usd) || usd <= 0) {
      setQuote(null);
      return;
    }
    const cents = Math.round(usd * 100);
    setLoadingQuote(true);
    setQuoteError(null);

    try {
      const res = await fetchIrtQuote({ amountCents: cents });
      if (res.success && res.quote) {
        setQuote(res.quote);
        setTomanAmount(String(res.quote.totalIrtAmount));
      } else {
        setQuoteError(res.error || 'Failed to generate authoritative quote.');
      }
    } catch (err: any) {
      setQuoteError(err.message || 'Error fetching exchange quote from server.');
      setQuote(null);
    } finally {
      setLoadingQuote(false);
    }
  }, []);

  useEffect(() => {
    const parsedUsd = parseFloat(targetUsd);
    if (!isNaN(parsedUsd) && parsedUsd > 0) {
      const timer = setTimeout(() => {
        calculateQuote(parsedUsd);
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setQuote(null);
    }
  }, [targetUsd, calculateQuote]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setSubmitError('Invalid file type. Only PNG, JPEG, and WEBP screenshot images are accepted.');
      return;
    }

    // Validate size (max 5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('File too large. Maximum permitted receipt size is 5 MB.');
      return;
    }

    setSubmitError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      setFilePreview(loadEvent.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCopyCard = () => {
    if (!bankDetails.cardNumber) return;
    navigator.clipboard.writeText(bankDetails.cardNumber.replace(/\s+/g, ''));
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    if (!quote || quote.targetUsdCents <= 0) {
      setSubmitError('Please enter a valid deposit amount to generate an official quote.');
      return;
    }

    if (!evidenceRef || evidenceRef.trim().length < 4) {
      setSubmitError('Bank transaction tracking reference number is required (minimum 4 characters).');
      return;
    }

    if (!payerIdentifier || payerIdentifier.trim().length < 2) {
      setSubmitError('Depositor name or card details are required.');
      return;
    }

    if (senderCardLast4 && !/^\d{4}$/.test(senderCardLast4.trim())) {
      setSubmitError('Sender card suffix must be exactly 4 numeric digits.');
      return;
    }

    setSubmitting(true);

    try {
      let fileKey = uploadedFileKey;

      // 1. Upload receipt if selected and not yet uploaded
      if (selectedFile && filePreview && !fileKey) {
        setUploadingReceipt(true);
        const uploadRes = await uploadReceiptFile(filePreview, selectedFile.name);
        if (!uploadRes.success || !uploadRes.fileKey) {
          throw new Error(uploadRes.error || 'Failed to upload receipt screenshot.');
        }
        fileKey = uploadRes.fileKey;
        setUploadedFileKey(fileKey);
        setUploadingReceipt(false);
      }

      // 2. Submit IRT Deposit Request
      const depositRes = await submitIrtDepositRequest({
        targetUsdCents: quote.targetUsdCents,
        evidenceRef: evidenceRef.trim(),
        payerIdentifier: payerIdentifier.trim(),
        senderCardLast4: senderCardLast4 ? senderCardLast4.trim() : undefined,
        receiptFileKey: fileKey || undefined,
        paymentDate: paymentDate || undefined,
        adminNotes: adminNotes.trim() || undefined,
      });

      if (!depositRes.success) {
        throw new Error(depositRes.error || 'Deposit request submission failed.');
      }

      setSubmitSuccess(
        `Deposit request #${depositRes.fundingRequest?.fundingRef || ''} submitted successfully! Status: PENDING_ADMIN_VERIFICATION.`
      );

      // Reset form fields
      setEvidenceRef('');
      setSenderCardLast4('');
      setAdminNotes('');
      setSelectedFile(null);
      setFilePreview(null);
      setUploadedFileKey(null);

      // Trigger overview refresh
      onSuccess();
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred while submitting your deposit request.');
    } finally {
      setSubmitting(false);
      setUploadingReceipt(false);
    }
  };

  return (
    <Card style={{ padding: '1.75rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
              Manual IRT Bank Transfer (کارت به کارت)
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Transfer the exact calculated Toman amount to our official recipient account, then submit your receipt evidence below.
            </p>
          </div>
          <span className="badge badge-lime" style={{ fontSize: '0.7rem' }}>
            Indicative Quote
          </span>
        </div>
      </div>

      {/* Owner-Configured Official Bank Account Card */}
      <div
        style={{
          marginBottom: '1.5rem',
          padding: '1.25rem',
          backgroundColor: 'var(--bg-main)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Official Recipient Bank Account
          </span>
          <span className={bankDetails.isConfigured ? 'badge badge-lime' : 'badge badge-gray'} style={{ fontSize: '0.65rem' }}>
            {bankDetails.isConfigured ? 'Owner-Configured' : 'Configuration Pending'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bank Name</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {bankDetails.bankName || 'Bank Melli Iran'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Account Holder</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {bankDetails.accountHolder || 'G4X Official Treasury'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Card Number</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--accent-lime)', letterSpacing: '0.05em' }}>
                {bankDetails.cardNumber}
              </span>
              <button
                type="button"
                onClick={handleCopyCard}
                className="btn btn-outline btn-sm"
                style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
              >
                {copiedCard ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {bankDetails.iban && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>IBAN (شبا)</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {bankDetails.iban}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prominent Legal & Safety Disclaimer */}
      <div
        style={{
          marginBottom: '1.5rem',
          padding: '0.85rem 1rem',
          backgroundColor: 'rgba(124, 58, 237, 0.12)',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          borderRadius: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
          <span style={{ fontSize: '1.1rem' }}>ℹ️</span>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
            <strong>Important Policy Notice:</strong> Submitting a bank receipt or tracking reference{' '}
            <span style={{ color: 'var(--accent-lime)', fontWeight: 700 }}>does NOT credit your wallet instantly</span>.
            All manual payments undergo independent administrative review against official bank statements.
            No credit is issued based solely on a user-provided screenshot or reference number.
          </div>
        </div>
      </div>

      {/* Error & Success Messages */}
      {submitError && (
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '0.85rem',
          }}
        >
          {submitError}
        </div>
      )}

      {submitSuccess && (
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1rem',
            backgroundColor: 'rgba(204, 255, 0, 0.15)',
            border: '1px solid var(--accent-lime)',
            borderRadius: '6px',
            color: 'var(--accent-lime)',
            fontSize: '0.85rem',
          }}
        >
          {submitSuccess}
        </div>
      )}

      {/* The Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Row 1: Amount Calculation & Live Indicative Quote */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* Target USD Cents */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Expected Credit (USD) *
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                max="5000"
                value={targetUsd}
                onChange={(e) => setTargetUsd(e.target.value)}
                required
                className="input"
                style={{ width: '100%', paddingLeft: '1.75rem' }}
                placeholder="10.00"
              />
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Target USD amount to be credited to your wallet.
            </span>
          </div>

          {/* Computed Toman Amount */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Payable Amount in Toman (تومان)
            </label>
            <input
              type="text"
              readOnly
              value={quote ? `${quote.totalIrtAmount.toLocaleString()} Toman` : loadingQuote ? 'Calculating...' : '—'}
              className="input"
              style={{
                width: '100%',
                backgroundColor: 'rgba(24, 21, 36, 0.5)',
                color: 'var(--accent-lime)',
                fontWeight: 800,
                cursor: 'default',
              }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Exact amount you must transfer to the bank card above.
            </span>
          </div>
        </div>

        {/* Live Quote Breakdown Details */}
        {quote && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: 'rgba(24, 21, 36, 0.6)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <span>Authoritative Rate: </span>
              <strong style={{ color: 'var(--text-primary)' }}>1 USD = {quote.adminUsdIrtRate.toLocaleString()} Toman</strong>
            </div>
            <div>
              <span>Base: </span>
              <strong style={{ color: 'var(--text-primary)' }}>{quote.baseIrtAmount.toLocaleString()} Toman</strong>
            </div>
            <div>
              <span>Fee ({(quote.incomingIrtFeeRate * 100).toFixed(1)}%): </span>
              <strong style={{ color: 'var(--text-primary)' }}>{quote.feeIrtAmount.toLocaleString()} Toman</strong>
            </div>
            <div>
              <span>Total Payable: </span>
              <strong style={{ color: 'var(--accent-lime)' }}>{quote.totalIrtAmount.toLocaleString()} Toman</strong>
            </div>
          </div>
        )}

        {quoteError && (
          <div style={{ color: '#ef4444', fontSize: '0.78rem' }}>
            Quote calculation notice: {quoteError}
          </div>
        )}

        {/* Row 2: Depositor Details & Bank Tracking Reference */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* Depositor Name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Depositor Name / Account Holder *
            </label>
            <input
              type="text"
              value={payerIdentifier}
              onChange={(e) => setPayerIdentifier(e.target.value)}
              required
              className="input"
              style={{ width: '100%' }}
              placeholder="e.g. Ali Rezaei"
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Full name of the bank account holder sending the funds.
            </span>
          </div>

          {/* Sender Card Suffix (Last 4 Digits) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Sender Card Last 4 Digits
            </label>
            <input
              type="text"
              maxLength={4}
              pattern="\d{4}"
              value={senderCardLast4}
              onChange={(e) => setSenderCardLast4(e.target.value.replace(/\D/g, ''))}
              className="input"
              style={{ width: '100%' }}
              placeholder="e.g. 1234"
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Last 4 digits of your card for bank statement reconciliation.
            </span>
          </div>

          {/* Bank Transfer Reference (شماره پیگیری) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Bank Tracking Reference (شماره پیگیری / مرجع) *
            </label>
            <input
              type="text"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
              required
              className="input"
              style={{ width: '100%' }}
              placeholder="e.g. 987654321"
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Unique reference number issued by your bank app / ATM receipt.
            </span>
          </div>

          {/* Payment Date */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Payment Date *
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
              className="input"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Row 3: Secure Receipt Screenshot Upload */}
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            Upload Payment Receipt Screenshot (Optional but recommended)
          </label>
          <div
            style={{
              border: '2px dashed var(--border-subtle)',
              borderRadius: '8px',
              padding: '1.25rem',
              textAlign: 'center',
              backgroundColor: 'var(--bg-main)',
              cursor: 'pointer',
            }}
            onClick={() => document.getElementById('receipt-file-input')?.click()}
          >
            <input
              id="receipt-file-input"
              type="file"
              accept="image/png, image/jpeg, image/webp"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            {filePreview ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <img
                  src={filePreview}
                  alt="Receipt Preview"
                  style={{ maxHeight: '120px', borderRadius: '4px', objectFit: 'contain' }}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--accent-lime)' }}>
                  ✓ {selectedFile?.name} ({(selectedFile ? selectedFile.size / 1024 : 0).toFixed(1)} KB)
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Click to choose a different image
                </span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>📎</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Click to select payment screenshot
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Supported formats: PNG, JPEG, WEBP (Max 5 MB). Stored securely in non-public storage.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Optional Explanatory Notes */}
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            Additional Explanatory Note (Optional)
          </label>
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={2}
            className="input"
            style={{ width: '100%', resize: 'vertical' }}
            placeholder="Add any additional details or bank transfer comments..."
          />
        </div>

        {/* Submit Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button
            type="submit"
            disabled={submitting || uploadingReceipt || !quote}
            className="btn btn-primary"
            style={{ minWidth: '180px' }}
          >
            {submitting || uploadingReceipt ? 'Submitting Evidence...' : 'Submit Deposit Request'}
          </button>
        </div>
      </form>
    </Card>
  );
};
