import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  FinancialAccountItem,
  InternalTransferItem,
  ExchangeRateItem,
} from '../../types/financialAccounts';
import {
  fetchExchangeRates,
  fetchActiveExchangeRate,
  createExchangeRate,
  executeInternalTransfer,
  fetchInternalTransfers,
  getTransfersCsvExportUrl,
} from '../../services/financialAccounts';

interface Props {
  accounts: FinancialAccountItem[];
  onRefreshWorkspace: () => void;
}

export const TransfersExchangeSection: React.FC<Props> = ({ accounts, onRefreshWorkspace }) => {
  // Exchange Rate State
  const [activeRate, setActiveRate] = useState<ExchangeRateItem | null>(null);
  const [rateHistory, setRateHistory] = useState<ExchangeRateItem[]>([]);
  const [showRateModal, setShowRateModal] = useState(false);
  const [showRateHistoryModal, setShowRateHistoryModal] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [newRateValue, setNewRateValue] = useState('');
  const [rateNotes, setRateNotes] = useState('');

  // Transfer List State
  const [transfers, setTransfers] = useState<InternalTransferItem[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [sourceFilter, setSourceFilter] = useState('all');
  const [destFilter, setDestFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');

  // Initiate Transfer Modal State
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [submittingTransfer, setSubmittingTransfer] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [sourceAmountInput, setSourceAmountInput] = useState('');
  const [feeInput, setFeeInput] = useState('');
  const [transferDescription, setTransferDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Feedback states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selected accounts objects
  const selectedSourceAccount = useMemo(
    () => accounts.find((a) => a.id === sourceAccountId),
    [accounts, sourceAccountId]
  );
  const selectedDestAccount = useMemo(
    () => accounts.find((a) => a.id === destinationAccountId),
    [accounts, destinationAccountId]
  );

  const isCurrencyConversion = useMemo(() => {
    if (!selectedSourceAccount || !selectedDestAccount) return false;
    return selectedSourceAccount.currency !== selectedDestAccount.currency;
  }, [selectedSourceAccount, selectedDestAccount]);

  // Real-time Destination Amount Calculation
  const calculatedDestinationAmount = useMemo(() => {
    if (!selectedSourceAccount || !selectedDestAccount) return null;
    const numAmount = parseFloat(sourceAmountInput);
    if (isNaN(numAmount) || numAmount <= 0) return null;
    const numFee = parseFloat(feeInput) || 0;
    const netSource = Math.max(0, numAmount - numFee);

    if (!isCurrencyConversion) {
      return {
        amount: netSource,
        formatted:
          selectedSourceAccount.currency === 'USD'
            ? `$${netSource.toFixed(2)}`
            : `${Math.round(netSource).toLocaleString()} Toman`,
      };
    }

    const rate = activeRate?.rate || 88500;
    if (selectedSourceAccount.currency === 'USD' && selectedDestAccount.currency === 'IRR') {
      // USD -> Toman: netSource ($) * rate
      const tomans = Math.round(netSource * rate);
      return {
        amount: tomans,
        formatted: `${tomans.toLocaleString()} Toman`,
      };
    } else if (selectedSourceAccount.currency === 'IRR' && selectedDestAccount.currency === 'USD') {
      // Toman -> USD: netSource (Tomans) / rate
      const dollars = netSource / rate;
      return {
        amount: dollars,
        formatted: `$${dollars.toFixed(2)}`,
      };
    }
    return null;
  }, [selectedSourceAccount, selectedDestAccount, sourceAmountInput, feeInput, isCurrencyConversion, activeRate]);

  // Load Active Exchange Rate
  const loadActiveRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const res = await fetchActiveExchangeRate('USD', 'IRR');
      if (res.success && res.rate) {
        setActiveRate(res.rate);
      }
    } catch (err: any) {
      console.error('Failed to load active exchange rate:', err);
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Load Rate History
  const loadRateHistory = useCallback(async () => {
    try {
      const res = await fetchExchangeRates();
      if (res.success && res.rates) {
        setRateHistory(res.rates);
      }
    } catch (err: any) {
      console.error('Failed to load rate history:', err);
    }
  }, []);

  // Load Transfers
  const loadTransfers = useCallback(async () => {
    setLoadingTransfers(true);
    try {
      const res = await fetchInternalTransfers({
        sourceAccountId: sourceFilter !== 'all' ? sourceFilter : undefined,
        destinationAccountId: destFilter !== 'all' ? destFilter : undefined,
        transferType: typeFilter !== 'all' ? typeFilter : undefined,
        currency: currencyFilter !== 'all' ? currencyFilter : undefined,
        page,
        limit: 15,
      });

      if (res.success) {
        setTransfers(res.transfers || []);
        setTotalPages(res.pagination.totalPages || 1);
        setTotalCount(res.pagination.total || 0);
      }
    } catch (err: any) {
      console.error('Failed to load internal transfers:', err);
      setErrorMsg(err.message || 'Failed to load internal transfers');
    } finally {
      setLoadingTransfers(false);
    }
  }, [sourceFilter, destFilter, typeFilter, currencyFilter, page]);

  useEffect(() => {
    loadActiveRate();
    loadTransfers();
  }, [loadActiveRate, loadTransfers]);

  // Auto-dismiss alerts
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  useEffect(() => {
    if (errorMsg) {
      const t = setTimeout(() => setErrorMsg(null), 6000);
      return () => clearTimeout(t);
    }
  }, [errorMsg]);

  // Submit New Exchange Rate
  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = parseFloat(newRateValue.replace(/,/g, ''));
    if (isNaN(rateNum) || rateNum <= 0) {
      setErrorMsg('Please enter a valid positive exchange rate in Toman per USD.');
      return;
    }
    setSavingRate(true);
    try {
      const res = await createExchangeRate({
        fromCurrency: 'USD',
        toCurrency: 'IRR',
        rate: rateNum,
        notes: rateNotes.trim() || undefined,
      });
      if (res.success) {
        setSuccessMsg(`New USD/IRR exchange rate set to ${res.rate.rate.toLocaleString()} Toman.`);
        setShowRateModal(false);
        setNewRateValue('');
        setRateNotes('');
        loadActiveRate();
        loadRateHistory();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to set exchange rate');
    } finally {
      setSavingRate(false);
    }
  };

  // Submit Transfer
  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceAccountId || !destinationAccountId) {
      setErrorMsg('Both source and destination accounts are required.');
      return;
    }
    if (sourceAccountId === destinationAccountId) {
      setErrorMsg('Source and destination accounts must be different.');
      return;
    }
    const numAmount = parseFloat(sourceAmountInput);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('Please enter a valid positive source amount.');
      return;
    }

    if (!selectedSourceAccount) return;

    // Convert amount to integer minor units (USD cents or integer Toman)
    const sourceMinor =
      selectedSourceAccount.currency === 'USD'
        ? Math.round(numAmount * 100)
        : Math.round(numAmount);

    const feeNum = parseFloat(feeInput) || 0;
    const feeMinor =
      selectedSourceAccount.currency === 'USD'
        ? Math.round(feeNum * 100)
        : Math.round(feeNum);

    if (sourceMinor <= 0) {
      setErrorMsg('Transfer amount must be greater than zero.');
      return;
    }

    if (sourceMinor > selectedSourceAccount.availableBalance) {
      setErrorMsg(
        `Insufficient available funds! Available: ${selectedSourceAccount.formattedAvailable}, Requested: ${
          selectedSourceAccount.currency === 'USD'
            ? `$${numAmount.toFixed(2)}`
            : `${Math.round(numAmount).toLocaleString()} Toman`
        }`
      );
      return;
    }

    setSubmittingTransfer(true);
    setErrorMsg(null);

    try {
      const idempotencyKey = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const res = await executeInternalTransfer({
        sourceAccountId,
        destinationAccountId,
        sourceAmount: sourceMinor,
        feeAmount: feeMinor,
        exchangeRate: isCurrencyConversion && activeRate ? activeRate.rate : undefined,
        description: transferDescription.trim() || undefined,
        attachmentUrl: attachmentUrl.trim() || undefined,
        idempotencyKey,
      });

      if (res.success) {
        setSuccessMsg(
          `Transfer successful! ${res.transfer.formattedSourceAmount} -> ${res.transfer.formattedDestinationAmount} (Ref: ${res.transfer.transferRef})`
        );
        setShowTransferModal(false);
        setSourceAccountId('');
        setDestinationAccountId('');
        setSourceAmountInput('');
        setFeeInput('');
        setTransferDescription('');
        setAttachmentUrl('');
        loadTransfers();
        onRefreshWorkspace();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Transfer failed. Check balance or contact administrator.');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Exchange Rate Hero Bar */}
      <div
        className="card-surface"
        style={{
          padding: '1.25rem 1.75rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(17, 24, 39, 0.95) 100%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              backgroundColor: 'rgba(139, 92, 246, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              border: '1px solid rgba(139, 92, 246, 0.4)',
            }}
          >
            💱
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Active Treasury Exchange Rate
              </span>
              <span className="badge badge-green" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                LIVE
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '2px' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                1 USD = {activeRate ? activeRate.rate.toLocaleString() : '88,500'} Toman
              </span>
              {activeRate && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  (Eff. {new Date(activeRate.effectiveAt).toLocaleDateString()})
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              loadRateHistory();
              setShowRateHistoryModal(true);
            }}
            style={{ fontSize: '0.8rem' }}
          >
            📜 Rate History
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={rateLoading}
            onClick={() => {
              setNewRateValue(activeRate ? String(activeRate.rate) : '88500');
              setShowRateModal(true);
            }}
            style={{
              borderColor: 'rgba(139, 92, 246, 0.5)',
              color: '#C4B5FD',
              fontSize: '0.8rem',
            }}
          >
            {rateLoading ? 'Loading...' : '✏️ Update Rate'}
          </button>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => {
              setSourceAccountId('');
              setDestinationAccountId('');
              setSourceAmountInput('');
              setFeeInput('');
              setShowTransferModal(true);
            }}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
              color: '#fff',
              fontSize: '0.82rem',
              fontWeight: 700,
              boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)',
            }}
          >
            🔄 Initiate Internal Transfer
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '10px',
            color: '#34D399',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.88rem',
          }}
        >
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.88rem',
          }}
        >
          <span>⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filters & Actions Bar */}
      <div
        className="card-surface"
        style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Filters:</span>
          {/* Source Account Filter */}
          <select
            className="input-field"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '160px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Sources</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency})
              </option>
            ))}
          </select>

          {/* Destination Account Filter */}
          <select
            className="input-field"
            value={destFilter}
            onChange={(e) => {
              setDestFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '160px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Destinations</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency})
              </option>
            ))}
          </select>

          {/* Transfer Type Filter */}
          <select
            className="input-field"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '160px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Transfer Types</option>
            <option value="SAME_CURRENCY">Same Currency</option>
            <option value="CURRENCY_CONVERSION">Currency Conversion</option>
          </select>

          {/* Currency Filter */}
          <select
            className="input-field"
            value={currencyFilter}
            onChange={(e) => {
              setCurrencyFilter(e.target.value);
              setPage(1);
            }}
            style={{ width: '110px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
          >
            <option value="all">Currencies</option>
            <option value="USD">USD</option>
            <option value="IRR">Toman</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <a
            href={getTransfersCsvExportUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span>📥</span>
            <span>Export CSV</span>
          </a>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadTransfers}
            disabled={loadingTransfers}
            style={{ fontSize: '0.78rem' }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Transfer History Table */}
      <div className="card-surface" style={{ padding: '0', overflow: 'hidden' }}>
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#fff' }}>
              Internal Transfers &amp; Conversion Ledger
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Total transfers: {totalCount} | Double-entry balanced entries verified
            </p>
          </div>
          <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
            Zero Revenue Impact Enforced
          </span>
        </div>

        {loadingTransfers ? (
          <div style={{ padding: '3rem' }}>
            <LoadingState message="Loading internal transfer records..." />
          </div>
        ) : transfers.length === 0 ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>🔄</span>
            No transfer records found matching the specified filters.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Source Account</th>
                  <th>Source Amount</th>
                  <th>Destination Account</th>
                  <th>Dest Amount</th>
                  <th>Type</th>
                  <th>Rate</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>Admin</th>
                  <th>Date</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((tx) => (
                  <tr key={tx.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.74rem', fontWeight: 700 }}>
                      {tx.transferRef}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#fff' }}>
                        {tx.sourceAccountName || tx.sourceAccountId}
                      </div>
                      <span className="badge" style={{ fontSize: '0.65rem', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                        {tx.sourceCurrency}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#F87171' }}>
                      -{tx.formattedSourceAmount}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#fff' }}>
                        {tx.destinationAccountName || tx.destinationAccountId}
                      </div>
                      <span className="badge" style={{ fontSize: '0.65rem', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                        {tx.destinationCurrency}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#34D399' }}>
                      +{tx.formattedDestinationAmount}
                    </td>
                    <td>
                      {tx.transferType === 'CURRENCY_CONVERSION' ? (
                        <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                          Conversion
                        </span>
                      ) : (
                        <span className="badge" style={{ fontSize: '0.68rem', backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#C4B5FD' }}>
                          Same Currency
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.76rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {tx.exchangeRate ? `${tx.exchangeRate.toLocaleString()} Toman` : '—'}
                    </td>
                    <td style={{ fontSize: '0.76rem', color: tx.feeAmount > 0 ? 'var(--accent-yellow)' : 'var(--text-muted)' }}>
                      {tx.formattedFee || '0'}
                    </td>
                    <td>
                      <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>
                        {tx.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {tx.adminUsername || tx.adminId || 'System'}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      {tx.attachmentUrl ? (
                        <a
                          href={tx.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-xs"
                          title="View Attachment / Receipt"
                          style={{ fontSize: '0.68rem' }}
                        >
                          📎 Receipt
                        </a>
                      ) : (
                        <span style={{ color: 'rgba(255, 255, 255, 0.2)', fontSize: '0.7rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Showing Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                &larr; Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: INITIATE INTERNAL TRANSFER                                 */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {showTransferModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '620px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🔄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>Initiate Internal Transfer</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Transfer funds between Platform accounts, USD Wallets, and Toman accounts
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowTransferModal(false)}
                disabled={submittingTransfer}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Source Account */}
                <div>
                  <label className="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Source Account *</span>
                    {selectedSourceAccount && (
                      <span style={{ color: '#34D399', fontSize: '0.76rem', fontWeight: 700 }}>
                        Avail: {selectedSourceAccount.formattedAvailable}
                      </span>
                    )}
                  </label>
                  <select
                    className="input-field"
                    required
                    value={sourceAccountId}
                    onChange={(e) => setSourceAccountId(e.target.value)}
                  >
                    <option value="">-- Select Source Account --</option>
                    {accounts
                      .filter((a) => a.status === 'ACTIVE')
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.category} - {acc.currency}) | Avail: {acc.formattedAvailable}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Destination Account */}
                <div>
                  <label className="field-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Destination Account *</span>
                    {selectedDestAccount && (
                      <span style={{ color: '#C4B5FD', fontSize: '0.76rem' }}>
                        Current: {selectedDestAccount.formattedCurrent}
                      </span>
                    )}
                  </label>
                  <select
                    className="input-field"
                    required
                    value={destinationAccountId}
                    onChange={(e) => setDestinationAccountId(e.target.value)}
                  >
                    <option value="">-- Select Destination Account --</option>
                    {accounts
                      .filter((a) => a.status === 'ACTIVE' && a.id !== sourceAccountId)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.category} - {acc.currency})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Amounts Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="field-label">
                      Source Amount ({selectedSourceAccount ? selectedSourceAccount.currency : 'Units'}) *
                    </label>
                    <input
                      type="number"
                      step={selectedSourceAccount?.currency === 'USD' ? '0.01' : '1'}
                      min="0.01"
                      className="input-field"
                      placeholder={selectedSourceAccount?.currency === 'USD' ? 'e.g. 500.00' : 'e.g. 50000000'}
                      required
                      value={sourceAmountInput}
                      onChange={(e) => setSourceAmountInput(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Transfer / Network Fee (Optional)</label>
                    <input
                      type="number"
                      step={selectedSourceAccount?.currency === 'USD' ? '0.01' : '1'}
                      min="0"
                      className="input-field"
                      placeholder="0.00"
                      value={feeInput}
                      onChange={(e) => setFeeInput(e.target.value)}
                    />
                  </div>
                </div>

                {/* Conversion Banner & Destination Preview */}
                {selectedSourceAccount && selectedDestAccount && (
                  <div
                    style={{
                      padding: '1rem',
                      borderRadius: '10px',
                      backgroundColor: isCurrencyConversion
                        ? 'rgba(139, 92, 246, 0.12)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: isCurrencyConversion
                        ? '1px solid rgba(139, 92, 246, 0.35)'
                        : '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        {isCurrencyConversion ? '💱 Currency Conversion' : '🔄 Same Currency Transfer'}
                      </span>
                      {isCurrencyConversion && (
                        <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                          Rate: {activeRate ? activeRate.rate.toLocaleString() : '88,500'} Toman/$
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        Estimated Destination Credit:
                      </span>
                      <span
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 800,
                          color: '#34D399',
                          fontFamily: 'monospace',
                        }}
                      >
                        {calculatedDestinationAmount ? calculatedDestinationAmount.formatted : '—'}
                      </span>
                    </div>

                    {isCurrencyConversion && (
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        ℹ️ Accounting Note: Currency conversions debit and credit balanced ledger positions without recognizing revenue.
                      </p>
                    )}
                  </div>
                )}

                {/* Description & Receipt */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="field-label">Description / Note</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Eldorado to USD Wallet sweep"
                      value={transferDescription}
                      onChange={(e) => setTransferDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Receipt / Attachment URL</label>
                    <input
                      type="url"
                      className="input-field"
                      placeholder="https://..."
                      value={attachmentUrl}
                      onChange={(e) => setAttachmentUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTransferModal(false)}
                  disabled={submittingTransfer}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={submittingTransfer || !calculatedDestinationAmount}
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                  }}
                >
                  {submittingTransfer ? 'Executing Transfer...' : 'Confirm & Execute Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: UPDATE EXCHANGE RATE                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {showRateModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '480px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>✏️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>Update USD / IRR Exchange Rate</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Sets the active operational exchange rate for treasury conversions
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowRateModal(false)}
                disabled={savingRate}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveRate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label className="field-label">Rate (Toman per 1 USD) *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="input-field"
                    required
                    placeholder="e.g. 89000"
                    value={newRateValue}
                    onChange={(e) => setNewRateValue(e.target.value)}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Note: Enter rate in Toman (not Rial).
                  </span>
                </div>

                <div>
                  <label className="field-label">Reason / Reference Notes</label>
                  <textarea
                    className="input-field"
                    rows={2}
                    placeholder="e.g. Daily market rate update based on Bonbast / Nobitex"
                    value={rateNotes}
                    onChange={(e) => setRateNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRateModal(false)}
                  disabled={savingRate}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={savingRate}
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                    color: '#fff',
                  }}
                >
                  {savingRate ? 'Saving...' : 'Set Active Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: EXCHANGE RATE HISTORY                                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {showRateHistoryModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '650px', width: '95%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>📜</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>Exchange Rate History</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Historical USD / IRR exchange rates. Past settled transactions are never modified retroactively.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowRateHistoryModal(false)}
              >
                &times;
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {rateHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No historical rate records yet.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Rate (Toman/USD)</th>
                      <th>Status</th>
                      <th>Effective Date</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateHistory.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{r.rateRef}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#C4B5FD' }}>
                          {r.rate.toLocaleString()} Toman
                        </td>
                        <td>
                          {r.isActive ? (
                            <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                              ACTIVE
                            </span>
                          ) : (
                            <span className="badge" style={{ fontSize: '0.65rem', backgroundColor: 'rgba(255, 255, 255, 0.08)' }}>
                              EXPIRED
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {new Date(r.effectiveAt).toLocaleDateString()} {new Date(r.effectiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {r.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowRateHistoryModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
