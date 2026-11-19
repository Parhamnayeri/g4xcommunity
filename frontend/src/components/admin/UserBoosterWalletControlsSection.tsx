import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AdminWalletUser,
  fetchAdminWallets,
  adjustAdminWallet,
  freezeAdminWallet,
} from '../../services/adminWalletService';

interface Props {
  onRefreshParent?: () => void;
}

type ModalMode =
  | 'BONUS'
  | 'DEDUCT'
  | 'FREEZE_AMOUNT'
  | 'UNFREEZE_AMOUNT'
  | 'FREEZE_WALLET'
  | 'UNFREEZE_WALLET';

type FilterPill = 'ALL' | 'HAS_BALANCE' | 'FROZEN';

export const UserBoosterWalletControlsSection: React.FC<Props> = ({ onRefreshParent }) => {
  const [wallets, setWallets] = useState<AdminWalletUser[]>([]);
  const [totals, setTotals] = useState<{
    totalUsersCount: number;
    totalAvailableUsd: number;
    totalEscrowUsd: number;
    totalFrozenUsd: number;
    frozenWalletsCount: number;
  } | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterPill, setFilterPill] = useState<FilterPill>('ALL');

  // Modal State
  const [selectedUser, setSelectedUser] = useState<AdminWalletUser | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>('BONUS');
  const [amountInput, setAmountInput] = useState<string>('');
  const [reasonInput, setReasonInput] = useState<string>('');
  const [allowNegative, setAllowNegative] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Load Wallets
  const loadWallets = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminWallets(search);
      if (res.success) {
        setWallets(res.wallets);
        setTotals(res.totals);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load user and booster wallets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallets();
  }, [loadWallets]);

  // Handle Search Input Debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      loadWallets(searchQuery);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery, loadWallets]);

  // Auto-dismiss alerts
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Filtered List
  const filteredWallets = useMemo(() => {
    return wallets.filter((w) => {
      if (filterPill === 'HAS_BALANCE') {
        const total = w.availableBalance + w.pendingEscrowBalance + w.frozenBalance;
        if (total <= 0) return false;
      } else if (filterPill === 'FROZEN') {
        if (!w.isFrozen && w.frozenBalance <= 0) return false;
      }
      return true;
    });
  }, [wallets, filterPill]);

  // Open Modal Helpers
  const handleOpenModal = (user: AdminWalletUser, mode: ModalMode) => {
    setSelectedUser(user);
    setModalMode(mode);
    setAmountInput('');
    setReasonInput('');
    setAllowNegative(false);
    setModalError(null);
  };

  const handleCloseModal = () => {
    if (submitting) return;
    setSelectedUser(null);
    setModalError(null);
  };

  // Submit Modal Action
  const handleSubmitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (!reasonInput.trim()) {
      setModalError('A descriptive reason is strictly required for this operation.');
      return;
    }

    const isAmountMode = ['BONUS', 'DEDUCT', 'FREEZE_AMOUNT', 'UNFREEZE_AMOUNT'].includes(modalMode);
    const parsedAmount = parseFloat(amountInput);

    if (isAmountMode) {
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setModalError('Please enter a valid positive dollar amount.');
        return;
      }
    }

    setSubmitting(true);
    setModalError(null);

    try {
      if (modalMode === 'BONUS' || modalMode === 'DEDUCT') {
        const res = await adjustAdminWallet(selectedUser.discordId, {
          action: modalMode,
          amount: parsedAmount,
          reason: reasonInput.trim(),
          allowNegative,
        });

        if (res.success) {
          setSuccessMsg(res.message);
          setSelectedUser(null);
          await loadWallets(searchQuery);
          if (onRefreshParent) onRefreshParent();
        }
      } else {
        const res = await freezeAdminWallet(selectedUser.discordId, {
          mode: modalMode,
          amount: isAmountMode ? parsedAmount : undefined,
          reason: reasonInput.trim(),
        });

        if (res.success) {
          setSuccessMsg(res.message);
          setSelectedUser(null);
          await loadWallets(searchQuery);
          if (onRefreshParent) onRefreshParent();
        }
      }
    } catch (err: any) {
      setModalError(err.message || 'Operation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Live Preview Calculations
  const previewCalculation = useMemo(() => {
    if (!selectedUser) return null;
    const currentAvail = selectedUser.availableBalance;
    const currentFrozen = selectedUser.frozenBalance;
    const amt = parseFloat(amountInput) || 0;

    let newAvail = currentAvail;
    let newFrozen = currentFrozen;
    let newFrozenStatus = selectedUser.isFrozen;

    if (modalMode === 'BONUS') {
      newAvail = currentAvail + amt;
    } else if (modalMode === 'DEDUCT') {
      newAvail = currentAvail - amt;
    } else if (modalMode === 'FREEZE_AMOUNT') {
      newAvail = currentAvail - amt;
      newFrozen = currentFrozen + amt;
    } else if (modalMode === 'UNFREEZE_AMOUNT') {
      newAvail = currentAvail + amt;
      newFrozen = Math.max(0, currentFrozen - amt);
    } else if (modalMode === 'FREEZE_WALLET') {
      newFrozenStatus = true;
    } else if (modalMode === 'UNFREEZE_WALLET') {
      newFrozenStatus = false;
    }

    return {
      currentAvail,
      currentFrozen,
      newAvail,
      newFrozen,
      newFrozenStatus,
      isNegative: newAvail < 0,
    };
  }, [selectedUser, modalMode, amountInput]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Banner Alert */}
      {successMsg && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '10px',
            color: '#34D399',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Strip */}
      {totals && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div className="card-surface" style={{ padding: '1.15rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Total Booster &amp; User Wallets
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.35rem', color: '#fff' }}>
              {totals.totalUsersCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              All registered platform accounts
            </div>
          </div>

          <div className="card-surface" style={{ padding: '1.15rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Available Withdrawable Balance
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.35rem', color: '#38bdf8' }}>
              ${totals.totalAvailableUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Instant booster withdrawal liquidity
            </div>
          </div>

          <div className="card-surface" style={{ padding: '1.15rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Pending Escrow Holds
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.35rem', color: '#FBBF24' }}>
              ${totals.totalEscrowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Locked in active run executions
            </div>
          </div>

          <div className="card-surface" style={{ padding: '1.15rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Total Frozen / On-Hold Funds
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.35rem', color: '#F87171' }}>
              ${totals.totalFrozenUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {totals.frozenWalletsCount} wallets under security hold
            </div>
          </div>
        </div>
      )}

      {/* Main Section Card */}
      <div className="card-surface" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Header & Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.35rem' }}>👛</span>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                User &amp; Booster Wallet Controls
              </h3>
              <span
                className="badge"
                style={{
                  backgroundColor: 'rgba(139, 92, 246, 0.2)',
                  color: '#C4B5FD',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Direct Ledger Injection
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.3rem 0 0 0' }}>
              Credit bonuses, apply operational deductions, hold specific amounts, or freeze accounts with immutable double-entry ledger audits.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadWallets(searchQuery)}
              disabled={loading}
            >
              ↻ Refresh Wallets
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1rem',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {/* Search Box */}
          <div style={{ flex: '1 1 320px', position: 'relative' }}>
            <input
              type="text"
              placeholder="Search user by Username, Display Name, or Discord ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{
                width: '100%',
                padding: '0.55rem 1rem 0.55rem 2.2rem',
                backgroundColor: 'var(--bg-main)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.85rem',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: '0.9rem',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { key: 'ALL', label: 'All Users', icon: '👥' },
              { key: 'HAS_BALANCE', label: 'Has Balance (> $0)', icon: '💰' },
              { key: 'FROZEN', label: 'Frozen / On Hold', icon: '❄️' },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setFilterPill(p.key as FilterPill)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: filterPill === p.key ? '1px solid #8B5CF6' : '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: filterPill === p.key ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                  color: filterPill === p.key ? '#C4B5FD' : 'var(--text-muted)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Wallets Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'left' }}>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>User / Booster</th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Roles</th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>
                  Available Balance
                </th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>
                  Pending Escrow
                </th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>
                  Frozen / Hold
                </th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>
                  Wallet Status
                </th>
                <th style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>
                  Authoritative Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Loading user wallets from database...
                  </td>
                </tr>
              ) : filteredWallets.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No wallets matched the search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredWallets.map((w) => {
                  return (
                    <tr
                      key={w.discordId}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        backgroundColor: w.isFrozen ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
                        transition: 'background-color 0.12s ease',
                      }}
                    >
                      {/* User Cell */}
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              backgroundColor: '#8B5CF6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              color: '#fff',
                              fontSize: '0.85rem',
                              flexShrink: 0,
                            }}
                          >
                            {w.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 700, color: '#fff' }}>{w.displayName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              <span>@{w.username}</span>
                              <span>•</span>
                              <span style={{ fontFamily: 'monospace' }}>{w.discordId}</span>
                            </div>
                            {w.payoutAddress && (
                              <div style={{ fontSize: '0.7rem', color: '#A78BFA', marginTop: '2px', fontFamily: 'monospace' }}>
                                💳 {w.payoutMethod || 'Payout'}: {w.payoutAddress.slice(0, 10)}...{w.payoutAddress.slice(-6)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Roles */}
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {w.roles.length > 0 ? (
                            w.roles.map((r) => (
                              <span
                                key={r}
                                className="badge"
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '2px 6px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                  color: '#E2E8F0',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {r}
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>user</span>
                          )}
                        </div>
                      </td>

                      {/* Available Balance */}
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'right' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.95rem', color: w.availableBalance > 0 ? '#38BDF8' : 'var(--text-muted)' }}>
                          ${w.availableBalance.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>USD</div>
                      </td>

                      {/* Pending Escrow */}
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'right' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: w.pendingEscrowBalance > 0 ? '#FBBF24' : 'var(--text-muted)' }}>
                          ${w.pendingEscrowBalance.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>USD</div>
                      </td>

                      {/* Frozen Balance */}
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'right' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: w.frozenBalance > 0 ? '#F87171' : 'var(--text-muted)' }}>
                          ${w.frozenBalance.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>USD</div>
                      </td>

                      {/* Wallet Status */}
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'center' }}>
                        {w.isFrozen ? (
                          <span
                            className="badge badge-danger"
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              backgroundColor: 'rgba(239, 68, 68, 0.2)',
                              color: '#F87171',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                            }}
                          >
                            ❄️ FROZEN
                          </span>
                        ) : (
                          <span
                            className="badge badge-success"
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              backgroundColor: 'rgba(52, 211, 153, 0.2)',
                              color: '#34D399',
                              border: '1px solid rgba(52, 211, 153, 0.4)',
                            }}
                          >
                            ✓ ACTIVE
                          </span>
                        )}
                      </td>

                      {/* Action Buttons */}
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleOpenModal(w, 'BONUS')}
                            style={{
                              backgroundColor: 'rgba(52, 211, 153, 0.15)',
                              color: '#34D399',
                              border: '1px solid rgba(52, 211, 153, 0.4)',
                              fontWeight: 700,
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px',
                            }}
                          >
                            + Bonus
                          </button>

                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleOpenModal(w, 'DEDUCT')}
                            style={{
                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                              color: '#FBBF24',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              fontWeight: 700,
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px',
                            }}
                          >
                            - Deduct
                          </button>

                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleOpenModal(w, 'FREEZE_AMOUNT')}
                            style={{
                              backgroundColor: 'rgba(139, 92, 246, 0.15)',
                              color: '#C4B5FD',
                              border: '1px solid rgba(139, 92, 246, 0.4)',
                              fontWeight: 700,
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px',
                            }}
                          >
                            ❄️ Freeze / Hold
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wallet Adjustment & Freeze Modal */}
      {selectedUser && (
        <div
          className="studio-modal-backdrop"
          onClick={handleCloseModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '1rem',
          }}
        >
          <div
            className="studio-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#0c0d14',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              borderRadius: '16px',
              width: 'min(640px, 96vw)',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8), 0 0 25px rgba(139, 92, 246, 0.15)',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.35rem' }}>⚖️</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                    Authoritative Wallet Controls
                  </h3>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Target: <strong style={{ color: '#fff' }}>{selectedUser.displayName}</strong> (@{selectedUser.username}) •{' '}
                  <span style={{ fontFamily: 'monospace' }}>{selectedUser.discordId}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={submitting}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '1.4rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Current Balance Snapshot Card */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.75rem',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                padding: '1rem',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Available (USD)
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#38BDF8', fontFamily: 'monospace' }}>
                  ${selectedUser.availableBalance.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Pending Escrow
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FBBF24', fontFamily: 'monospace' }}>
                  ${selectedUser.pendingEscrowBalance.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Frozen / Hold
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#F87171', fontFamily: 'monospace' }}>
                  ${selectedUser.frozenBalance.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Operation Mode Selector Tabs */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                Select Action Mode
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginBottom: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => setModalMode('BONUS')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'BONUS' ? '1px solid #34D399' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'BONUS' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'BONUS' ? '#34D399' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  + Add Bonus
                </button>

                <button
                  type="button"
                  onClick={() => setModalMode('DEDUCT')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'DEDUCT' ? '1px solid #FBBF24' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'DEDUCT' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'DEDUCT' ? '#FBBF24' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  - Deduct Balance
                </button>

                <button
                  type="button"
                  onClick={() => setModalMode('FREEZE_AMOUNT')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'FREEZE_AMOUNT' ? '1px solid #8B5CF6' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'FREEZE_AMOUNT' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'FREEZE_AMOUNT' ? '#C4B5FD' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  ❄️ Freeze Amount
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => setModalMode('UNFREEZE_AMOUNT')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'UNFREEZE_AMOUNT' ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'UNFREEZE_AMOUNT' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'UNFREEZE_AMOUNT' ? '#38BDF8' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  ☀️ Unfreeze Amount
                </button>

                <button
                  type="button"
                  onClick={() => setModalMode('FREEZE_WALLET')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'FREEZE_WALLET' ? '1px solid #F87171' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'FREEZE_WALLET' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'FREEZE_WALLET' ? '#F87171' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  🚫 Freeze Entire Wallet
                </button>

                <button
                  type="button"
                  onClick={() => setModalMode('UNFREEZE_WALLET')}
                  style={{
                    padding: '0.55rem',
                    borderRadius: '8px',
                    border: modalMode === 'UNFREEZE_WALLET' ? '1px solid #34D399' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: modalMode === 'UNFREEZE_WALLET' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: modalMode === 'UNFREEZE_WALLET' ? '#34D399' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  🔓 Unfreeze Entire Wallet
                </button>
              </div>
            </div>

            {/* Error Message inside modal */}
            {modalError && (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '8px',
                  color: '#F87171',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                ⚠️ {modalError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmitModal}>
              {['BONUS', 'DEDUCT', 'FREEZE_AMOUNT', 'UNFREEZE_AMOUNT'].includes(modalMode) && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    Amount (USD) <span style={{ color: '#F87171' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '0.85rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        fontWeight: 700,
                      }}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="e.g. 25.00"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        padding: '0.65rem 1rem 0.65rem 2rem',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '1rem',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                </div>
              )}

              {modalMode === 'DEDUCT' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={allowNegative}
                      onChange={(e) => setAllowNegative(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span>Allow balance to go negative (debt/overdraft penalty)</span>
                  </label>
                </div>
              )}

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  Reason / Operational Audit Note <span style={{ color: '#F87171' }}>*</span>
                </label>
                <textarea
                  placeholder="Detail the authoritative reason for this financial modification (e.g. Compensation for Keystone +15 overtime, Order #123 penalty correction, Security verification hold)..."
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  required
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.85rem',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Live Preview Box */}
              {previewCalculation && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    border: '1px solid rgba(139, 92, 246, 0.25)',
                    borderRadius: '8px',
                    marginBottom: '1.25rem',
                    fontSize: '0.82rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#C4B5FD', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>👁️</span>
                    <span>Live Balance Impact Preview:</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Available Balance: </span>
                      <strong style={{ color: '#38BDF8', fontFamily: 'monospace' }}>
                        ${previewCalculation.newAvail.toFixed(2)}
                      </strong>{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        (was ${previewCalculation.currentAvail.toFixed(2)})
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Frozen / Hold: </span>
                      <strong style={{ color: '#F87171', fontFamily: 'monospace' }}>
                        ${previewCalculation.newFrozen.toFixed(2)}
                      </strong>{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        (was ${previewCalculation.currentFrozen.toFixed(2)})
                      </span>
                    </div>
                  </div>
                  <div style={{ marginTop: '0.4rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Wallet Status: </span>
                    <strong style={{ color: previewCalculation.newFrozenStatus ? '#F87171' : '#34D399' }}>
                      {previewCalculation.newFrozenStatus ? '❄️ FROZEN (Withdrawals Blocked)' : '✓ ACTIVE'}
                    </strong>
                  </div>
                  {previewCalculation.isNegative && !allowNegative && (
                    <div style={{ marginTop: '0.5rem', color: '#F87171', fontWeight: 700 }}>
                      ⚠️ Resulting balance will be negative! Check &apos;Allow negative balance&apos; to authorize debt.
                    </div>
                  )}
                </div>
              )}

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCloseModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta btn-sm"
                  disabled={submitting || (previewCalculation?.isNegative && !allowNegative)}
                  style={{
                    background:
                      modalMode === 'BONUS'
                        ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                        : modalMode === 'DEDUCT'
                        ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)'
                        : 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {submitting ? 'Executing Ledger Write...' : 'Confirm & Apply to Ledger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
