import React, { useState, useEffect, useCallback } from 'react';
import {
  AdminDepositInvoice,
  fetchAdminDeposits,
  confirmAdminDeposit,
  cancelAdminDeposit,
} from '../../services/adminWalletService';

export const AdminDepositInvoicesSection: React.FC = () => {
  const [deposits, setDeposits] = useState<AdminDepositInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);

  const loadDeposits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminDeposits({
        status: statusFilter,
        search: searchQuery,
      });
      if (res.success) {
        setDeposits(res.deposits || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load deposit invoices.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadDeposits();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadDeposits]);

  const handleConfirm = async (deposit: AdminDepositInvoice) => {
    const promptReason = window.prompt(
      `Confirm and credit $${deposit.amountUsd.toFixed(2)} USD to user ${deposit.username} (${deposit.userId})?\n\nEnter administrative reason / notes:`,
      'Manual approval of NOWPayments cryptocurrency deposit'
    );
    if (promptReason === null) return; // cancelled

    setActionInProgressId(deposit.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await confirmAdminDeposit(deposit.id, promptReason.trim() || undefined);
      if (res.success) {
        setSuccessMsg(res.message || `Deposit #${deposit.intentRef} successfully confirmed and credited.`);
        loadDeposits();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm deposit invoice.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleCancel = async (deposit: AdminDepositInvoice) => {
    const promptReason = window.prompt(
      `Are you sure you want to cancel deposit invoice #${deposit.intentRef} ($${deposit.amountUsd.toFixed(2)})?\n\nEnter reason for cancellation:`,
      'Cancelled by administrative review'
    );
    if (promptReason === null) return;

    setActionInProgressId(deposit.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await cancelAdminDeposit(deposit.id, promptReason.trim() || undefined);
      if (res.success) {
        setSuccessMsg(res.message || `Deposit #${deposit.intentRef} cancelled.`);
        loadDeposits();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel deposit invoice.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const waitingCount = deposits.filter((d) => d.status === 'WAITING').length;
  const confirmedCount = deposits.filter((d) => d.status === 'CONFIRMED').length;

  return (
    <div className="card-surface" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Title & Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.35rem 0', color: '#f4f4f6' }}>
            📥 Deposit Invoices (NOWPayments &amp; Manual Top-Ups)
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#9490a6' }}>
            Monitor, approve, credit, or cancel advertiser cryptocurrency deposits and gateway top-up invoices.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadDeposits}
            disabled={loading}
          >
            🔄 {loading ? 'Refreshing...' : 'Refresh Invoices'}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          style={{
            padding: '0.85rem 1.15rem',
            backgroundColor: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '8px',
            color: '#34D399',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>✓ {successMsg}</span>
          <button
            onClick={() => setSuccessMsg(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '0.85rem 1.15rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '8px',
            color: '#F87171',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>⚠️ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Metrics Badges */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: '#e2e8f0' }}>
          Total Invoices: <strong>{deposits.length}</strong>
        </span>
        <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.35)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: '#fbbf24' }}>
          Pending / Waiting: <strong>{waitingCount}</strong>
        </span>
        <span style={{ backgroundColor: 'rgba(204, 255, 0, 0.15)', border: '1px solid rgba(204, 255, 0, 0.35)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--accent-lime, #ccff00)' }}>
          Confirmed &amp; Credited: <strong>{confirmedCount}</strong>
        </span>
      </div>

      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by invoice ref, payment ID, username, or Discord ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '240px', fontSize: '0.85rem' }}
        />

        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: '180px', fontSize: '0.85rem' }}
        >
          <option value="all">All Statuses</option>
          <option value="WAITING">Awaiting (WAITING)</option>
          <option value="CONFIRMED">Confirmed (CONFIRMED)</option>
          <option value="CANCELLED">Cancelled (CANCELLED)</option>
          <option value="EXPIRED">Expired (EXPIRED)</option>
        </select>
      </div>

      {/* Table */}
      {deposits.length === 0 ? (
        <div style={{ padding: '2.5rem', textAlign: 'center', color: '#9490a6' }}>
          {loading ? 'Loading deposit invoices...' : 'No deposit invoices match your search/filter.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle, rgba(124, 58, 237, 0.25))', color: '#9490a6', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>Ref / ID</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Advertiser</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Amount USD</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Pay Currency</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Gateway Portal</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Date Created</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Administrative Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => {
                const hasValidUrl =
                  Boolean(d.invoiceUrl) &&
                  (d.invoiceUrl!.startsWith('http://') || d.invoiceUrl!.startsWith('https://'));

                let statusBadge = (
                  <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, backgroundColor: 'rgba(148, 144, 166, 0.15)', color: '#9490a6' }}>
                    {d.status}
                  </span>
                );

                if (d.status === 'WAITING') {
                  statusBadge = (
                    <span style={{ padding: '0.2rem 0.55rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
                      ⏳ WAITING
                    </span>
                  );
                } else if (d.status === 'CONFIRMED') {
                  statusBadge = (
                    <span style={{ padding: '0.2rem 0.55rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, backgroundColor: 'rgba(204, 255, 0, 0.15)', color: 'var(--accent-lime, #ccff00)', border: '1px solid rgba(204, 255, 0, 0.35)' }}>
                      ✓ CONFIRMED
                    </span>
                  );
                } else if (d.status === 'CANCELLED') {
                  statusBadge = (
                    <span style={{ padding: '0.2rem 0.55rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.35)' }}>
                      ✕ CANCELLED
                    </span>
                  );
                }

                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontWeight: 600 }}>
                      <div>{d.intentRef}</div>
                      <div style={{ fontSize: '0.7rem', color: '#9490a6' }}>ID: #{d.id}</div>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ fontWeight: 600, color: '#f4f4f6' }}>{d.displayName || d.username}</div>
                      <div style={{ fontSize: '0.7rem', color: '#9490a6', fontFamily: 'monospace' }}>
                        {d.userId} • <span style={{ color: '#c4b5fd' }}>{d.advertiserRank}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 800, color: 'var(--accent-lime, #ccff00)' }}>
                      ${Number(d.amountUsd).toFixed(2)} USD
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span style={{ backgroundColor: 'rgba(124, 58, 237, 0.15)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace', textTransform: 'uppercase', color: '#c4b5fd' }}>
                        {d.payCurrency}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{statusBadge}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      {hasValidUrl ? (
                        <a
                          href={d.invoiceUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: 'var(--accent-lime, #ccff00)',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textDecoration: 'underline',
                          }}
                        >
                          Open Portal ↗
                        </a>
                      ) : (
                        <span style={{ color: '#9490a6', fontSize: '0.75rem' }}>
                          Manual / Setup Mode
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9490a6', fontSize: '0.75rem' }}>
                      {new Date(d.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      {d.status === 'WAITING' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleConfirm(d)}
                            disabled={actionInProgressId === d.id}
                            style={{
                              backgroundColor: 'rgba(204, 255, 0, 0.2)',
                              border: '1px solid rgba(204, 255, 0, 0.5)',
                              color: 'var(--accent-lime, #ccff00)',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {actionInProgressId === d.id ? 'Processing...' : 'Confirm & Credit'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleCancel(d)}
                            disabled={actionInProgressId === d.id}
                            style={{
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#f87171',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: '#9490a6', fontSize: '0.75rem' }}>
                          {d.status === 'CONFIRMED' ? 'Credited to Wallet' : 'Archived'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
