import React, { useState, useEffect, useCallback } from 'react';
import {
  AdminDepositInvoice,
  GatewayHealth,
  DepositKpis,
  IpnHistoryEntry,
  fetchAdminDeposits,
  syncAdminDeposit,
  confirmAdminDeposit,
  cancelAdminDeposit,
} from '../../services/adminWalletService';

export const AdminDepositInvoicesSection: React.FC = () => {
  const [deposits, setDeposits] = useState<AdminDepositInvoice[]>([]);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [kpis, setKpis] = useState<DepositKpis>({
    totalConfirmedUsd: 0,
    pendingCount: 0,
    partiallyPaidCount: 0,
    failedOrExpiredCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);

  // Inspector Modal State
  const [selectedDeposit, setSelectedDeposit] = useState<AdminDepositInvoice | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedIpnIndex, setExpandedIpnIndex] = useState<number | null>(null);

  // Manual Credit Prompt State inside Modal
  const [showManualCreditForm, setShowManualCreditForm] = useState(false);
  const [customCreditAmount, setCustomCreditAmount] = useState<string>('');
  const [manualCreditReason, setManualCreditReason] = useState<string>('');

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
        if (res.gatewayHealth) setGatewayHealth(res.gatewayHealth);
        if (res.kpis) setKpis(res.kpis);

        // Keep inspector in sync if open
        if (selectedDeposit) {
          const updated = (res.deposits || []).find((d) => d.id === selectedDeposit.id);
          if (updated) setSelectedDeposit(updated);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load deposit invoices.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, selectedDeposit?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadDeposits();
    }, 200);
    return () => clearTimeout(timer);
  }, [statusFilter, searchQuery]);

  const copyToClipboard = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleSyncLive = async (deposit: AdminDepositInvoice) => {
    setActionInProgressId(deposit.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await syncAdminDeposit(deposit.id);
      if (res.success) {
        setSuccessMsg(res.message || `Deposit #${deposit.id} synced with NOWPayments.`);
        if (selectedDeposit && selectedDeposit.id === deposit.id && res.deposit) {
          setSelectedDeposit(res.deposit);
        }
        await loadDeposits();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to sync with NOWPayments API.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleConfirm = async (deposit: AdminDepositInvoice, customAmount?: number, reason?: string) => {
    const finalAmount = customAmount != null && customAmount > 0 ? customAmount : deposit.amountUsd;
    const finalReason = reason && reason.trim() ? reason.trim() : 'Manual approval of NOWPayments cryptocurrency deposit';

    setActionInProgressId(deposit.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await confirmAdminDeposit(deposit.id, finalReason, finalAmount);
      if (res.success) {
        setSuccessMsg(res.message || `Deposit #${deposit.intentRef} ($${finalAmount.toFixed(2)}) confirmed and credited.`);
        setShowManualCreditForm(false);
        setCustomCreditAmount('');
        setManualCreditReason('');
        await loadDeposits();
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
        if (selectedDeposit && selectedDeposit.id === deposit.id && res.deposit) {
          setSelectedDeposit(res.deposit);
        }
        await loadDeposits();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel deposit invoice.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const getStatusBadge = (status: string, gatewayStatus?: string) => {
    const upper = (status || '').toUpperCase();
    const gw = (gatewayStatus || '').toLowerCase();

    if (upper === 'CONFIRMED' || gw === 'finished') {
      return (
        <span
          style={{
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 800,
            backgroundColor: 'rgba(204, 255, 0, 0.15)',
            color: 'var(--accent-lime, #ccff00)',
            border: '1px solid rgba(204, 255, 0, 0.35)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          ✓ CONFIRMED
        </span>
      );
    }

    if (upper === 'PARTIALLY_PAID' || gw === 'partially_paid') {
      return (
        <span
          style={{
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 800,
            backgroundColor: 'rgba(245, 158, 11, 0.18)',
            color: '#f59e0b',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          ⚡ PARTIALLY PAID
        </span>
      );
    }

    if (upper === 'PROCESSING' || ['confirming', 'confirmed', 'sending'].includes(gw)) {
      return (
        <span
          style={{
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 800,
            backgroundColor: 'rgba(59, 130, 246, 0.18)',
            color: '#60a5fa',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          🔄 PROCESSING ({gw})
        </span>
      );
    }

    if (upper === 'CANCELLED' || gw === 'cancelled') {
      return (
        <span
          style={{
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 800,
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          ✕ CANCELLED
        </span>
      );
    }

    if (upper === 'EXPIRED' || gw === 'expired') {
      return (
        <span
          style={{
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 700,
            backgroundColor: 'rgba(156, 163, 175, 0.15)',
            color: '#9ca3af',
            border: '1px solid rgba(156, 163, 175, 0.3)',
          }}
        >
          ⏱ EXPIRED
        </span>
      );
    }

    // Default: WAITING
    return (
      <span
        style={{
          padding: '0.25rem 0.6rem',
          borderRadius: '6px',
          fontSize: '0.72rem',
          fontWeight: 700,
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        ⏳ WAITING
      </span>
    );
  };

  return (
    <div className="card-surface" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
      {/* 1. Header & Live Gateway Status Strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: '#f4f4f6' }}>
              User Payments &amp; NOWPayments Deposits
            </h3>
            <span
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                color: '#c4b5fd',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                padding: '0.15rem 0.5rem',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              API v1 Telemetry
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#9490a6' }}>
            Forensic cryptocurrency ledger with signed HMAC-SHA512 IPN webhook tracking, live sync, and atomic wallet crediting.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadDeposits}
            disabled={loading}
            style={{ fontWeight: 600 }}
          >
            🔄 {loading ? 'Refreshing...' : 'Refresh Ledger'}
          </button>
        </div>
      </div>

      {/* 2. Gateway Status Chips Bar */}
      {gatewayHealth && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(15, 12, 29, 0.65)',
            border: '1px solid rgba(139, 92, 246, 0.25)',
            borderRadius: '10px',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '0.78rem', color: '#9490a6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🔌</span> Gateway Status:
          </span>

          {/* API Key Status */}
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: gatewayHealth.configured ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: gatewayHealth.configured ? '#34D399' : '#f87171',
              border: `1px solid ${gatewayHealth.configured ? 'rgba(52, 211, 153, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {gatewayHealth.configured ? '● API Key Active' : '○ API Key Missing'}
          </span>

          {/* IPN Secret Status */}
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: gatewayHealth.ipnSecretConfigured ? 'rgba(204, 255, 0, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: gatewayHealth.ipnSecretConfigured ? 'var(--accent-lime, #ccff00)' : '#fbbf24',
              border: `1px solid ${gatewayHealth.ipnSecretConfigured ? 'rgba(204, 255, 0, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {gatewayHealth.ipnSecretConfigured ? '🔒 HMAC-SHA512 Verified' : '⚠️ IPN Secret Missing'}
          </span>

          {/* Mode: Sandbox vs Live */}
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: gatewayHealth.isSandbox ? 'rgba(245, 158, 11, 0.18)' : 'rgba(59, 130, 246, 0.18)',
              color: gatewayHealth.isSandbox ? '#f59e0b' : '#60a5fa',
              border: `1px solid ${gatewayHealth.isSandbox ? 'rgba(245, 158, 11, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
            }}
          >
            {gatewayHealth.isSandbox ? '🧪 SANDBOX TESTNET' : '🌐 PRODUCTION LIVE'}
          </span>

          {/* Base URL */}
          <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'monospace', marginLeft: 'auto' }}>
            {gatewayHealth.baseUrl}
          </span>
        </div>
      )}

      {/* 3. Alerts */}
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

      {/* 4. KPI Summary Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.85rem' }}>
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(204, 255, 0, 0.05)',
            border: '1px solid rgba(204, 255, 0, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#9490a6', fontWeight: 600, textTransform: 'uppercase' }}>
            Confirmed &amp; Settled
          </span>
          <span style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-lime, #ccff00)' }}>
            ${kpis.totalConfirmedUsd.toFixed(2)} USD
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Credited into advertiser wallets</span>
        </div>

        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(245, 158, 11, 0.06)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#9490a6', fontWeight: 600, textTransform: 'uppercase' }}>
            Awaiting / Pending
          </span>
          <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#fbbf24' }}>
            {kpis.pendingCount}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Waiting for on-chain confirmations</span>
        </div>

        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(249, 115, 22, 0.06)',
            border: '1px solid rgba(249, 115, 22, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#9490a6', fontWeight: 600, textTransform: 'uppercase' }}>
            Partially Paid (Action Required)
          </span>
          <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#f97316' }}>
            {kpis.partiallyPaidCount}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Requires admin review or partial credit</span>
        </div>

        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#9490a6', fontWeight: 600, textTransform: 'uppercase' }}>
            Failed / Expired / Cancelled
          </span>
          <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#f87171' }}>
            {kpis.failedOrExpiredCount}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Expired invoices or failed payments</span>
        </div>
      </div>

      {/* 5. Search & Status Filter Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by invoice ref, invoiceId, paymentId, payAddress, username, or Discord ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '260px', fontSize: '0.85rem' }}
        />

        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: '200px', fontSize: '0.85rem' }}
        >
          <option value="all">All Invoices ({deposits.length})</option>
          <option value="WAITING">Awaiting (WAITING)</option>
          <option value="PROCESSING">Processing (confirming/sending)</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="CONFIRMED">Confirmed &amp; Credited</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {/* 6. Deposits Table */}
      {deposits.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#9490a6', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: '8px' }}>
          {loading ? 'Querying NOWPayments deposits ledger...' : 'No payment records match your search/filter criteria.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle, rgba(124, 58, 237, 0.25))', color: '#9490a6', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>User / Advertiser</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Amount (USD)</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Crypto Telemetry</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Gateway Status</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Reference / IDs</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Timestamps</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => {
                const hasValidUrl =
                  Boolean(d.invoiceUrl) &&
                  (d.invoiceUrl!.startsWith('http://') || d.invoiceUrl!.startsWith('https://'));

                const isPartiallyPaid = d.status === 'PARTIALLY_PAID' || d.gatewayStatus === 'partially_paid';

                return (
                  <tr
                    key={d.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      backgroundColor: isPartiallyPaid ? 'rgba(245, 158, 11, 0.04)' : undefined,
                    }}
                  >
                    {/* User */}
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(139, 92, 246, 0.3)',
                            color: '#c4b5fd',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '0.75rem',
                          }}
                        >
                          {(d.displayName || d.username || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#f4f4f6' }}>{d.displayName || d.username}</div>
                          <div style={{ fontSize: '0.7rem', color: '#9490a6', fontFamily: 'monospace' }}>
                            {d.userId} • <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{d.advertiserRank}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Amount USD */}
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--accent-lime, #ccff00)' }}>
                        ${Number(d.amountUsd).toFixed(2)}
                      </div>
                      {d.priceAmount != null && d.priceAmount !== d.amountUsd && (
                        <div style={{ fontSize: '0.68rem', color: '#9490a6' }}>
                          Price: ${d.priceAmount.toFixed(2)}
                        </div>
                      )}
                    </td>

                    {/* Crypto Details */}
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span
                          style={{
                            backgroundColor: 'rgba(124, 58, 237, 0.18)',
                            padding: '0.12rem 0.45rem',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            color: '#c4b5fd',
                            border: '1px solid rgba(124, 58, 237, 0.3)',
                          }}
                        >
                          {d.payCurrency}
                        </span>
                        {d.isSandbox && (
                          <span style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700 }}>
                            [TESTNET]
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#9490a6' }}>
                        {d.actuallyPaid != null ? (
                          <span>
                            Paid: <strong style={{ color: isPartiallyPaid ? '#f59e0b' : '#34D399' }}>{d.actuallyPaid}</strong>
                            {d.payAmount ? ` / ${d.payAmount}` : ''}
                          </span>
                        ) : d.payAmount ? (
                          <span>Expected: {d.payAmount}</span>
                        ) : (
                          <span style={{ color: '#6b7280' }}>Awaiting tx</span>
                        )}
                      </div>
                    </td>

                    {/* Gateway Status */}
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {getStatusBadge(d.status, d.gatewayStatus)}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: '#9490a6' }}>
                          {d.ipnVerified ? (
                            <span style={{ color: '#34D399', fontWeight: 700 }} title="HMAC-SHA512 Verified">
                              🔒 IPN Verified
                            </span>
                          ) : (
                            <span style={{ color: '#6b7280' }}>Pending IPN</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Reference / IDs */}
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{d.intentRef}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(d.intentRef, `ref-${d.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9490a6', padding: '0 2px' }}
                          title="Copy Intent Reference"
                        >
                          {copiedKey === `ref-${d.id}` ? '✓' : '📋'}
                        </button>
                      </div>
                      {d.paymentId && (
                        <div style={{ fontSize: '0.68rem', color: '#9490a6' }}>
                          PayID: {d.paymentId.substring(0, 12)}...
                        </div>
                      )}
                      {d.invoiceId && (
                        <div style={{ fontSize: '0.68rem', color: '#9490a6' }}>
                          InvID: {d.invoiceId}
                        </div>
                      )}
                    </td>

                    {/* Timestamps */}
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9490a6', fontSize: '0.72rem' }}>
                      <div>
                        {new Date(d.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      {d.confirmedAt ? (
                        <div style={{ color: 'var(--accent-lime, #ccff00)', fontSize: '0.68rem' }}>
                          ✓ Credited
                        </div>
                      ) : d.lastIpnAt ? (
                        <div style={{ color: '#60a5fa', fontSize: '0.68rem' }}>
                          Last IPN: {new Date(d.lastIpnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      ) : null}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* Inspect Details Button */}
                        <button
                          type="button"
                          className="btn btn-xs btn-secondary"
                          onClick={() => {
                            setSelectedDeposit(d);
                            setShowManualCreditForm(false);
                          }}
                          style={{ fontWeight: 600 }}
                        >
                          🔍 Inspect
                        </button>

                        {/* Live Sync Button */}
                        {(d.status === 'WAITING' || d.status === 'PROCESSING' || isPartiallyPaid) && (
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => handleSyncLive(d)}
                            disabled={actionInProgressId === d.id}
                            style={{
                              backgroundColor: 'rgba(59, 130, 246, 0.15)',
                              border: '1px solid rgba(59, 130, 246, 0.35)',
                              color: '#60a5fa',
                              fontWeight: 600,
                            }}
                            title="Query live payment status from NOWPayments API"
                          >
                            {actionInProgressId === d.id ? 'Syncing...' : 'Live Sync'}
                          </button>
                        )}

                        {/* Manual Confirm & Credit Button */}
                        {(d.status === 'WAITING' || isPartiallyPaid) && (
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => {
                              setSelectedDeposit(d);
                              setShowManualCreditForm(true);
                              setCustomCreditAmount(d.amountUsd.toString());
                            }}
                            disabled={actionInProgressId === d.id}
                            style={{
                              backgroundColor: 'rgba(204, 255, 0, 0.18)',
                              border: '1px solid rgba(204, 255, 0, 0.45)',
                              color: 'var(--accent-lime, #ccff00)',
                              fontWeight: 700,
                            }}
                          >
                            Confirm &amp; Credit
                          </button>
                        )}

                        {/* Hosted Portal Link */}
                        {hasValidUrl && (
                          <a
                            href={d.invoiceUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-xs btn-secondary"
                            style={{ textDecoration: 'none', color: '#c4b5fd' }}
                          >
                            Portal ↗
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* 7. FORENSIC INSPECTOR MODAL (.studio-modal-card)                          */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {selectedDeposit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(5px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedDeposit(null);
              setShowManualCreditForm(false);
            }
          }}
        >
          <div
            className="studio-modal-card studio-modal-card-lg"
            style={{
              backgroundColor: '#110e24',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              borderRadius: '14px',
              maxWidth: '850px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#f4f4f6' }}>
                    Deposit Inspector #{selectedDeposit.id}
                  </h3>
                  {getStatusBadge(selectedDeposit.status, selectedDeposit.gatewayStatus)}
                  {selectedDeposit.isSandbox && (
                    <span style={{ fontSize: '0.65rem', backgroundColor: '#f59e0b', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>
                      TESTNET
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#9490a6', fontFamily: 'monospace' }}>
                  Ref: {selectedDeposit.intentRef} • User: {selectedDeposit.username} ({selectedDeposit.userId})
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedDeposit(null);
                  setShowManualCreditForm(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9490a6',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Telemetry Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.85rem',
                  backgroundColor: 'rgba(15, 12, 29, 0.75)',
                  padding: '1rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>Deposit Amount USD</span>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--accent-lime, #ccff00)' }}>
                    ${selectedDeposit.amountUsd.toFixed(2)} USD
                  </strong>
                </div>

                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>Crypto Currency</span>
                  <span style={{ fontWeight: 700, color: '#c4b5fd', fontFamily: 'monospace' }}>
                    {selectedDeposit.payCurrency}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>Crypto Expected</span>
                  <span style={{ fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {selectedDeposit.payAmount != null ? selectedDeposit.payAmount : 'N/A'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>Crypto Actually Received</span>
                  <strong style={{ fontWeight: 700, color: selectedDeposit.actuallyPaid ? '#34D399' : '#9490a6', fontFamily: 'monospace' }}>
                    {selectedDeposit.actuallyPaid != null ? selectedDeposit.actuallyPaid : 'None recorded'}
                  </strong>
                </div>

                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>Net Outcome Settled</span>
                  <span style={{ fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {selectedDeposit.outcomeAmount != null
                      ? `${selectedDeposit.outcomeAmount} ${selectedDeposit.outcomeCurrency || ''}`
                      : 'Pending settlement'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.7rem', color: '#9490a6', display: 'block' }}>NOWPayments Status</span>
                  <span style={{ fontWeight: 700, color: '#f4f4f6', textTransform: 'uppercase' }}>
                    {selectedDeposit.gatewayStatus}
                  </span>
                </div>
              </div>

              {/* Identifiers & Addressing */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  padding: '1rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ color: '#9490a6' }}>Invoice ID:</span>
                  <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{selectedDeposit.invoiceId || 'N/A'}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ color: '#9490a6' }}>Payment ID:</span>
                  <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{selectedDeposit.paymentId || 'N/A'}</span>
                </div>

                {selectedDeposit.purchaseId && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ color: '#9490a6' }}>Purchase ID:</span>
                    <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{selectedDeposit.purchaseId}</span>
                  </div>
                )}

                {selectedDeposit.payAddress && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ color: '#9490a6' }}>Destination Pay Address:</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--accent-lime, #ccff00)', wordBreak: 'break-all' }}>
                      {selectedDeposit.payAddress}
                    </span>
                  </div>
                )}

                {selectedDeposit.creditedLedgerId && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ color: '#9490a6' }}>Ledger Ref (Credited):</span>
                    <span style={{ fontFamily: 'monospace', color: '#34D399' }}>{selectedDeposit.creditedLedgerId}</span>
                  </div>
                )}
              </div>

              {/* Manual Credit Sub-Form (e.g. for partially paid deposits) */}
              {showManualCreditForm && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'rgba(204, 255, 0, 0.05)',
                    border: '1px solid rgba(204, 255, 0, 0.3)',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: '0.92rem', color: 'var(--accent-lime, #ccff00)', fontWeight: 800 }}>
                    Manual Approval &amp; Custom Balance Credit
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#9490a6' }}>
                    Credit the user&apos;s wallet immediately. If this was a partial payment, adjust the amount below to match the verified crypto received.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: '#9490a6', display: 'block', marginBottom: '4px' }}>
                        Credit Amount (USD):
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-input"
                        value={customCreditAmount}
                        onChange={(e) => setCustomCreditAmount(e.target.value)}
                        placeholder="USD amount"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: '#9490a6', display: 'block', marginBottom: '4px' }}>
                        Reason / Audit Note:
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        value={manualCreditReason}
                        onChange={(e) => setManualCreditReason(e.target.value)}
                        placeholder="e.g. Verified partial payment on BSC network"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowManualCreditForm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        handleConfirm(
                          selectedDeposit,
                          parseFloat(customCreditAmount) || selectedDeposit.amountUsd,
                          manualCreditReason
                        )
                      }
                      disabled={actionInProgressId === selectedDeposit.id}
                      style={{
                        backgroundColor: 'var(--accent-lime, #ccff00)',
                        color: '#000',
                        fontWeight: 800,
                      }}
                    >
                      {actionInProgressId === selectedDeposit.id ? 'Crediting Wallet...' : 'Execute Credit'}
                    </button>
                  </div>
                </div>
              )}

              {/* IPN Event History Log */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#f4f4f6', fontWeight: 700 }}>
                  IPN Callback &amp; API Sync Audit History ({selectedDeposit.ipnHistory?.length || 0})
                </h4>

                {(!selectedDeposit.ipnHistory || selectedDeposit.ipnHistory.length === 0) ? (
                  <div style={{ padding: '1rem', backgroundColor: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', color: '#9490a6', fontSize: '0.8rem', textAlign: 'center' }}>
                    No webhook callbacks or sync events recorded yet for this deposit.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto' }}>
                    {selectedDeposit.ipnHistory.map((entry: IpnHistoryEntry, idx: number) => {
                      const isExpanded = expandedIpnIndex === idx;
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '0.65rem 0.85rem',
                            backgroundColor: 'rgba(15, 12, 29, 0.85)',
                            border: '1px solid rgba(255, 255, 255, 0.07)',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{
                                  backgroundColor: entry.source === 'IPN' ? 'rgba(52, 211, 153, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                                  color: entry.source === 'IPN' ? '#34D399' : '#60a5fa',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  fontWeight: 700,
                                  fontSize: '0.68rem',
                                }}
                              >
                                {entry.source}
                              </span>
                              <span style={{ fontWeight: 700, color: '#f4f4f6' }}>
                                Status: {entry.status}
                              </span>
                              {entry.actuallyPaid != null && (
                                <span style={{ color: '#9490a6' }}>
                                  • Paid: {entry.actuallyPaid} {entry.payCurrency || ''}
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                              {entry.raw && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedIpnIndex(isExpanded ? null : idx)}
                                  style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline' }}
                                >
                                  {isExpanded ? 'Hide Raw' : 'Raw JSON'}
                                </button>
                              )}
                            </div>
                          </div>

                          {isExpanded && entry.raw && (
                            <pre
                              style={{
                                marginTop: '0.5rem',
                                padding: '0.5rem',
                                backgroundColor: '#090714',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
                                color: '#a78bfa',
                                overflowX: 'auto',
                              }}
                            >
                              {JSON.stringify(entry.raw, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div
              style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid rgba(139, 92, 246, 0.2)',
                backgroundColor: 'rgba(10, 8, 20, 0.6)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {/* Sync Live Button */}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSyncLive(selectedDeposit)}
                  disabled={actionInProgressId === selectedDeposit.id}
                >
                  🔄 {actionInProgressId === selectedDeposit.id ? 'Syncing...' : 'Sync Live Status'}
                </button>

                {/* Open Hosted Invoice */}
                {selectedDeposit.invoiceUrl && (
                  <a
                    href={selectedDeposit.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    Open NOWPayments Portal ↗
                  </a>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedDeposit.status === 'WAITING' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleCancel(selectedDeposit)}
                    disabled={actionInProgressId === selectedDeposit.id}
                  >
                    Cancel Invoice
                  </button>
                )}

                {selectedDeposit.status !== 'CONFIRMED' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setShowManualCreditForm(true);
                      setCustomCreditAmount(selectedDeposit.amountUsd.toString());
                    }}
                    style={{
                      backgroundColor: 'rgba(204, 255, 0, 0.2)',
                      border: '1px solid rgba(204, 255, 0, 0.5)',
                      color: 'var(--accent-lime, #ccff00)',
                      fontWeight: 800,
                    }}
                  >
                    Confirm &amp; Credit
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSelectedDeposit(null);
                    setShowManualCreditForm(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
