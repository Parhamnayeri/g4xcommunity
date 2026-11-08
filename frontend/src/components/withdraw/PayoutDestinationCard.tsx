import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { UserPayoutPreferenceData } from '../../types/withdraw';
import { updatePayoutPreferences } from '../../services/withdraw';

interface PayoutDestinationCardProps {
  initialPreference: UserPayoutPreferenceData | null;
  onUpdated?: (pref: UserPayoutPreferenceData) => void;
}

export const PayoutDestinationCard: React.FC<PayoutDestinationCardProps> = ({
  initialPreference,
  onUpdated,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [bankAccountHolder, setBankAccountHolder] = useState(initialPreference?.bankAccountHolder || '');
  const [bankIban, setBankIban] = useState(initialPreference?.bankIban || '');
  const [cryptoAddress, setCryptoAddress] = useState(initialPreference?.cryptoAddress || '');
  const [cryptoNetwork] = useState(initialPreference?.cryptoNetwork || 'BNB_SMART_CHAIN_BEP20');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialPreference) {
      setBankAccountHolder(initialPreference.bankAccountHolder || '');
      setBankIban(initialPreference.bankIban || '');
      setCryptoAddress(initialPreference.cryptoAddress || '');
    }
  }, [initialPreference]);

  // Client-side Sheba validation helper
  const validateIbanFormat = (val: string) => {
    const clean = val.trim().toUpperCase().replace(/\s+/g, '');
    if (!clean) return { valid: false, message: 'IBAN is required for bank payouts' };
    if (!clean.startsWith('IR')) return { valid: false, message: 'Must start with IR' };
    if (clean.length !== 26) return { valid: false, message: `Must be exactly 26 chars (got ${clean.length})` };
    if (!/^IR\d{24}$/.test(clean)) return { valid: false, message: 'Only digits allowed after IR' };
    try {
      const rearranged = clean.substring(4) + '1827' + clean.substring(2, 4);
      if (BigInt(rearranged) % 97n !== 1n) {
        return { valid: false, message: 'Invalid mathematical IBAN checksum' };
      }
    } catch {
      return { valid: false, message: 'Checksum evaluation failed' };
    }
    return { valid: true, message: 'Valid Iranian IBAN (Sheba)' };
  };

  // Client-side BEP-20 validation helper
  const validateCryptoFormat = (val: string) => {
    const clean = val.trim();
    if (!clean) return { valid: false, message: 'Address required for crypto payouts' };
    if (!clean.startsWith('0x') && !clean.startsWith('0X')) return { valid: false, message: 'Must begin with 0x' };
    if (clean.length !== 42) return { valid: false, message: `Must be exactly 42 characters (got ${clean.length})` };
    if (!/^0x[0-9a-fA-F]{40}$/i.test(clean)) return { valid: false, message: 'Non-hexadecimal characters detected' };
    if (/^0x0{40}$/i.test(clean)) return { valid: false, message: 'Burn/Zero address rejected' };
    return { valid: true, message: 'Valid BEP-20 address format' };
  };

  const ibanStatus = bankIban ? validateIbanFormat(bankIban) : null;
  const cryptoStatus = cryptoAddress ? validateCryptoFormat(cryptoAddress) : null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (bankIban && !validateIbanFormat(bankIban).valid) {
      setError(validateIbanFormat(bankIban).message);
      return;
    }
    if (cryptoAddress && !validateCryptoFormat(cryptoAddress).valid) {
      setError(validateCryptoFormat(cryptoAddress).message);
      return;
    }

    setSaving(true);
    try {
      const res = await updatePayoutPreferences({
        bankAccountHolder: bankAccountHolder.trim() || null,
        bankIban: bankIban.trim().toUpperCase() || null,
        cryptoAddress: cryptoAddress.trim() || null,
        cryptoNetwork,
      });

      if (res.success && res.preference) {
        setSuccessMsg('Payout preferences saved securely.');
        setIsEditing(false);
        if (onUpdated) onUpdated(res.preference);
      } else {
        setError(res.error || 'Failed to update preferences.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while saving preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card highlight="purple" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Saved Payout Destinations
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Encrypted accounts used to disburse your manual booster withdrawals.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsEditing(!isEditing);
            setError(null);
            setSuccessMsg(null);
          }}
          className="btn btn-outline btn-sm"
        >
          {isEditing ? 'Cancel Edit' : 'Edit Destinations'}
        </button>
      </div>

      {successMsg && (
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 0.9rem', marginBottom: '1rem', color: 'var(--status-success)', fontSize: '0.82rem' }}>
          ✓ {successMsg}
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 0.9rem', marginBottom: '1rem', color: 'var(--status-danger)', fontSize: '0.82rem' }}>
          ⚠ {error}
        </div>
      )}

      {!isEditing ? (
        // Masked View Mode
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Bank Destination Box */}
          <div
            style={{
              backgroundColor: 'rgba(15, 12, 28, 0.5)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                🏦 Iranian Bank (Sheba)
              </span>
              <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                $1.30 Fee
              </span>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Account Holder</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {initialPreference?.bankAccountHolder || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not configured</span>}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>IBAN / Sheba Number</span>
              <span style={{ fontSize: '0.92rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--status-info)' }}>
                {initialPreference?.maskedBankIban || (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'inherit' }}>None saved</span>
                )}
              </span>
            </div>
          </div>

          {/* Crypto Destination Box */}
          <div
            style={{
              backgroundColor: 'rgba(15, 12, 28, 0.5)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                💎 USDT (BEP-20)
              </span>
              <span className="badge badge-lime" style={{ fontSize: '0.65rem' }}>
                $0.40 Fee
              </span>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Network</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                BNB Smart Chain (BEP-20)
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Wallet Address</span>
              <span style={{ fontSize: '0.92rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary-purple)' }}>
                {initialPreference?.maskedCryptoAddress || (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'inherit' }}>None saved</span>
                )}
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Form Edit Mode
        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            {/* Bank Form */}
            <div style={{ backgroundColor: 'rgba(15, 12, 28, 0.6)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                Iranian Bank Transfer (IRT)
              </h4>

              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Account Holder Name
                </label>
                <input
                  type="text"
                  value={bankAccountHolder}
                  onChange={(e) => setBankAccountHolder(e.target.value)}
                  placeholder="e.g. Parham Nayeri"
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(10, 8, 20, 0.8)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '0.55rem 0.75rem',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Iranian IBAN / Sheba (26 characters)
                </label>
                <input
                  type="text"
                  value={bankIban}
                  onChange={(e) => setBankIban(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="IR200170000000109968843003"
                  maxLength={26}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(10, 8, 20, 0.8)',
                    border: `1px solid ${ibanStatus ? (ibanStatus.valid ? 'var(--status-success)' : 'var(--status-danger)') : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-xs)',
                    padding: '0.55rem 0.75rem',
                    color: 'var(--status-info)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
                {ibanStatus && (
                  <span style={{ fontSize: '0.72rem', color: ibanStatus.valid ? 'var(--status-success)' : 'var(--status-danger)', display: 'block', marginTop: '0.25rem' }}>
                    {ibanStatus.valid ? '✓ ' : '✕ '} {ibanStatus.message}
                  </span>
                )}
              </div>
            </div>

            {/* Crypto Form */}
            <div style={{ backgroundColor: 'rgba(15, 12, 28, 0.6)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                Cryptocurrency USDT (BEP-20)
              </h4>

              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Designated Network
                </label>
                <div style={{ backgroundColor: 'rgba(204, 255, 0, 0.08)', border: '1px solid rgba(204, 255, 0, 0.25)', borderRadius: 'var(--radius-xs)', padding: '0.55rem 0.75rem', fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-lime)' }}>
                  BNB Smart Chain (BSC BEP-20)
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  USDT BEP-20 Wallet Address (42 characters)
                </label>
                <input
                  type="text"
                  value={cryptoAddress}
                  onChange={(e) => setCryptoAddress(e.target.value.trim())}
                  placeholder="0x1234567890abcdef1234567890abcdef12345678"
                  maxLength={42}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(10, 8, 20, 0.8)',
                    border: `1px solid ${cryptoStatus ? (cryptoStatus.valid ? 'var(--status-success)' : 'var(--status-danger)') : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-xs)',
                    padding: '0.55rem 0.75rem',
                    color: 'var(--primary-purple)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
                {cryptoStatus && (
                  <span style={{ fontSize: '0.72rem', color: cryptoStatus.valid ? 'var(--status-success)' : 'var(--status-danger)', display: 'block', marginTop: '0.25rem' }}>
                    {cryptoStatus.valid ? '✓ ' : '✕ '} {cryptoStatus.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="btn btn-outline btn-sm"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving}
            >
              {saving ? 'Saving Preferences...' : 'Save Payout Preferences'}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.75rem', fontSize: '0.73rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span>🔒</span>
        <span>Security policy: Private keys or passphrases are never requested or stored. Addresses are masked in normal views.</span>
      </div>
    </Card>
  );
};
