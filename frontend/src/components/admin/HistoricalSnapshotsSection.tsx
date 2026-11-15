import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  SerializedFinancialSnapshot,
  SnapshotComparisonResult,
  SnapshotType,
} from '../../types/financialAnalytics';
import {
  fetchFinancialSnapshots,
  captureOnDemandSnapshot,
  compareSnapshots,
} from '../../services/financialAnalytics';

export const HistoricalSnapshotsSection: React.FC = () => {
  const [snapshots, setSnapshots] = useState<SerializedFinancialSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Detail Modal
  const [selectedSnapshot, setSelectedSnapshot] = useState<SerializedFinancialSnapshot | null>(null);

  // Capture Modal
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [captureType, setCaptureType] = useState<SnapshotType>('MANUAL');
  const [captureNotes, setCaptureNotes] = useState('');
  const [capturing, setCapturing] = useState(false);

  // Comparison State
  const [compareMode, setCompareMode] = useState(false);
  const [baseId, setBaseId] = useState<string>('');
  const [comparisonId, setComparisonId] = useState<string>('');
  const [comparisonResult, setComparisonResult] = useState<SnapshotComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFinancialSnapshots({
        type: typeFilter === 'ALL' ? undefined : (typeFilter as SnapshotType),
        limit: 100,
      });
      setSnapshots(res.snapshots || []);
    } catch (err: any) {
      console.error('[HistoricalSnapshots] Error:', err);
      setError(err.message || 'Failed to load historical snapshots');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    setCapturing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await captureOnDemandSnapshot({
        snapshotType: captureType,
        notes: captureNotes.trim() || undefined,
      });
      setSuccessMsg(`Snapshot ${res.snapshot.snapshotRef} captured successfully!`);
      setShowCaptureModal(false);
      setCaptureNotes('');
      await loadSnapshots();
    } catch (err: any) {
      console.error('[HistoricalSnapshots] Capture error:', err);
      setError(err.message || 'Failed to capture snapshot');
    } finally {
      setCapturing(false);
    }
  };

  const handleRunComparison = async () => {
    if (!baseId || !comparisonId) {
      setError('Please select both a Base Snapshot and a Comparison Snapshot.');
      return;
    }
    if (baseId === comparisonId) {
      setError('Please select two distinct snapshots to compare.');
      return;
    }
    setComparing(true);
    setError(null);
    try {
      const res = await compareSnapshots(baseId, comparisonId);
      setComparisonResult(res.comparison);
    } catch (err: any) {
      console.error('[HistoricalSnapshots] Compare error:', err);
      setError(err.message || 'Failed to execute snapshot comparison');
    } finally {
      setComparing(false);
    }
  };

  const formatDelta = (val: number, isCurrency = true, unit = '$') => {
    const sign = val > 0 ? '+' : '';
    const num = isCurrency ? (val / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val.toLocaleString();
    return `${sign}${unit}${num}`;
  };

  const formatPct = (pct: number | null) => {
    if (pct === null) return 'N/A';
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      {/* ─── Header & Top Actions ────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-xl shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-lg text-lg font-bold">
              📸
            </span>
            <h2 className="text-xl font-bold text-zinc-100">Historical Financial Snapshots</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Authoritative, immutable snapshots capturing platform balances, wallets, liquidity, and P&L.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setComparisonResult(null);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors border ${
              compareMode
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            ⚖️ {compareMode ? 'Exit Comparison' : 'Compare Snapshots'}
          </button>
          <button
            onClick={() => setShowCaptureModal(true)}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-900/30 transition-all"
          >
            + Capture On-Demand
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300 font-bold ml-4">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-300 font-bold ml-4">✕</button>
        </div>
      )}

      {/* ─── Comparison View ────────────────────────────────────────────── */}
      {compareMode && (
        <div className="bg-zinc-900 border border-purple-500/30 rounded-xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div>
              <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <span>⚖️</span> Snapshot Comparison Engine
              </h3>
              <p className="text-xs text-zinc-400">
                Select two historical snapshots to compute exact asset growth, net revenue deltas, and platform balance shifts.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Base Snapshot (Older)</label>
              <select
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">-- Select Base Snapshot --</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotRef} ({s.snapshotType}) — {new Date(s.snapshotDate).toLocaleDateString()} — {s.formattedTotalUsdAssets}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Comparison Snapshot (Newer)</label>
              <select
                value={comparisonId}
                onChange={(e) => setComparisonId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">-- Select Comparison Snapshot --</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotRef} ({s.snapshotType}) — {new Date(s.snapshotDate).toLocaleDateString()} — {s.formattedTotalUsdAssets}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleRunComparison}
              disabled={comparing || !baseId || !comparisonId}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {comparing ? 'Calculating...' : 'Compute Comparison'}
            </button>
          </div>

          {comparisonResult && (
            <div className="mt-6 space-y-6 pt-4 border-t border-zinc-800">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-zinc-800/60 border border-zinc-700/60 rounded-xl">
                  <span className="text-xs text-zinc-400">Total USD Assets Delta</span>
                  <div className={`text-xl font-bold mt-1 ${comparisonResult.deltas.totalUsdAssets >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatDelta(comparisonResult.deltas.totalUsdAssets)}
                  </div>
                  <span className="text-xs font-medium text-zinc-400">
                    Growth: {formatPct(comparisonResult.deltas.totalUsdAssetsGrowthPct)}
                  </span>
                </div>

                <div className="p-4 bg-zinc-800/60 border border-zinc-700/60 rounded-xl">
                  <span className="text-xs text-zinc-400">Net Profit Delta</span>
                  <div className={`text-xl font-bold mt-1 ${comparisonResult.deltas.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatDelta(comparisonResult.deltas.netProfit)}
                  </div>
                  <span className="text-xs font-medium text-zinc-400">
                    Growth: {formatPct(comparisonResult.deltas.netProfitGrowthPct)}
                  </span>
                </div>

                <div className="p-4 bg-zinc-800/60 border border-zinc-700/60 rounded-xl">
                  <span className="text-xs text-zinc-400">Business Revenue Delta</span>
                  <div className={`text-xl font-bold mt-1 ${comparisonResult.deltas.businessRevenue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatDelta(comparisonResult.deltas.businessRevenue)}
                  </div>
                  <span className="text-xs font-medium text-zinc-400">
                    Growth: {formatPct(comparisonResult.deltas.businessRevenueGrowthPct)}
                  </span>
                </div>

                <div className="p-4 bg-zinc-800/60 border border-zinc-700/60 rounded-xl">
                  <span className="text-xs text-zinc-400">Toman Assets Delta</span>
                  <div className={`text-xl font-bold mt-1 ${comparisonResult.deltas.totalTomanAssets >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatDelta(comparisonResult.deltas.totalTomanAssets, false, '')} Toman
                  </div>
                  <span className="text-xs font-medium text-zinc-400">
                    Growth: {formatPct(comparisonResult.deltas.totalTomanAssetsGrowthPct)}
                  </span>
                </div>
              </div>

              {/* Platform Balance Shifts Table */}
              <div>
                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Platform Balance Movements</h4>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-800/80 text-zinc-400 font-medium">
                      <tr>
                        <th className="p-3">Account / Platform</th>
                        <th className="p-3 text-right">Base Snapshot</th>
                        <th className="p-3 text-right">Comparison Snapshot</th>
                        <th className="p-3 text-right">Net Movement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      <tr>
                        <td className="p-3 font-medium text-zinc-200">G4X Direct</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.g4xDirectBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.g4xDirectBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.platformBalances.direct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.platformBalances.direct)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 font-medium text-zinc-200">Eldorado</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.eldoradoBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.eldoradoBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.platformBalances.eldorado >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.platformBalances.eldorado)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 font-medium text-zinc-200">Skycoach</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.skycoachBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.skycoachBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.platformBalances.skycoach >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.platformBalances.skycoach)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 font-medium text-zinc-200">Overgear</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.overgearBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.overgearBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.platformBalances.overgear >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.platformBalances.overgear)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 font-medium text-zinc-200">Kingboost</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.kingboostBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.kingboostBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.platformBalances.kingboost >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.platformBalances.kingboost)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 font-medium text-purple-300">USD Wallet Treasury</td>
                        <td className="p-3 text-right">${(comparisonResult.baseSnapshot.usdWalletBalance / 100).toFixed(2)}</td>
                        <td className="p-3 text-right">${(comparisonResult.comparisonSnapshot.usdWalletBalance / 100).toFixed(2)}</td>
                        <td className={`p-3 text-right font-semibold ${comparisonResult.deltas.usdWallet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatDelta(comparisonResult.deltas.usdWallet)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Filter Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-400">Frequency:</span>
          {['ALL', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'MANUAL'].map((freq) => (
            <button
              key={freq}
              onClick={() => setTypeFilter(freq)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === freq
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
              }`}
            >
              {freq}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-400">
          Showing <span className="text-zinc-200 font-semibold">{snapshots.length}</span> recorded snapshots
        </div>
      </div>

      {/* ─── Snapshots Table ────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-12">
            <LoadingState message="Loading historical financial snapshots..." />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="p-12 text-center text-zinc-400 space-y-3">
            <div className="text-3xl">📸</div>
            <p className="text-base font-medium text-zinc-300">No financial snapshots captured yet</p>
            <p className="text-xs text-zinc-500">
              Click &quot;Capture On-Demand&quot; above to capture the current state of all platforms, wallets, and revenues.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-800/80 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                <tr>
                  <th className="p-4">Reference</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Snapshot Date</th>
                  <th className="p-4 text-right">Total USD Assets</th>
                  <th className="p-4 text-right">Net Profit</th>
                  <th className="p-4 text-right">Revenue</th>
                  <th className="p-4 text-right">Toman Assets</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {snapshots.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="p-4 font-mono text-xs text-purple-400 font-semibold">
                      {s.snapshotRef}
                    </td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 text-xs rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-medium">
                        {s.snapshotType}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-zinc-400">
                      {new Date(s.snapshotDate).toLocaleDateString()} {new Date(s.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-4 text-right font-semibold text-zinc-100">
                      {s.formattedTotalUsdAssets}
                    </td>
                    <td className={`p-4 text-right font-semibold ${s.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {s.formattedNetProfitUsd}
                    </td>
                    <td className="p-4 text-right text-zinc-300">
                      {s.formattedRevenueUsd}
                    </td>
                    <td className="p-4 text-right text-zinc-300">
                      {s.formattedTotalTomanAssets}
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => setSelectedSnapshot(s)}
                        className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-purple-300 hover:text-purple-200 rounded-lg transition-colors border border-zinc-700"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Inspect Snapshot Modal ─────────────────────────────────────── */}
      {selectedSnapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <span className="text-xs font-mono text-purple-400">{selectedSnapshot.snapshotRef}</span>
                <h3 className="text-lg font-bold text-zinc-100">
                  Snapshot Details — {selectedSnapshot.snapshotType}
                </h3>
                <span className="text-xs text-zinc-400">
                  Captured at: {new Date(selectedSnapshot.capturedAt).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xl font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* Balances Breakdown */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Platform Liquidity Distribution</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">G4X Direct</span>
                  <div className="text-base font-bold text-zinc-100">${(selectedSnapshot.g4xDirectBalance / 100).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Eldorado</span>
                  <div className="text-base font-bold text-zinc-100">${(selectedSnapshot.eldoradoBalance / 100).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Skycoach</span>
                  <div className="text-base font-bold text-zinc-100">${(selectedSnapshot.skycoachBalance / 100).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Overgear</span>
                  <div className="text-base font-bold text-zinc-100">${(selectedSnapshot.overgearBalance / 100).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Kingboost</span>
                  <div className="text-base font-bold text-zinc-100">${(selectedSnapshot.kingboostBalance / 100).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-purple-950/40 rounded-xl border border-purple-500/30">
                  <span className="text-xs text-purple-300">USD Wallet Treasury</span>
                  <div className="text-base font-bold text-purple-200">${(selectedSnapshot.usdWalletBalance / 100).toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* Performance Summary */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Financial Summary & P&L</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Total USD Assets</span>
                  <div className="text-base font-bold text-zinc-100">{selectedSnapshot.formattedTotalUsdAssets}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Net Profit</span>
                  <div className={`text-base font-bold ${selectedSnapshot.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedSnapshot.formattedNetProfitUsd}
                  </div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Revenue</span>
                  <div className="text-base font-bold text-zinc-100">{selectedSnapshot.formattedRevenueUsd}</div>
                </div>
                <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                  <span className="text-xs text-zinc-400">Expenses</span>
                  <div className="text-base font-bold text-zinc-100">{selectedSnapshot.formattedExpensesUsd}</div>
                </div>
              </div>
            </div>

            {selectedSnapshot.notes && (
              <div className="p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/40 text-xs text-zinc-300">
                <span className="font-semibold text-zinc-400">Admin Notes: </span>
                {selectedSnapshot.notes}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-semibold rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Capture On-Demand Modal ────────────────────────────────────── */}
      {showCaptureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <span>📸</span> Capture Financial Snapshot
              </h3>
              <button
                onClick={() => setShowCaptureModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCapture} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Snapshot Type</label>
                <select
                  value={captureType}
                  onChange={(e) => setCaptureType(e.target.value as SnapshotType)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="MANUAL">MANUAL (On-demand ad hoc)</option>
                  <option value="DAILY">DAILY (Treasury close)</option>
                  <option value="WEEKLY">WEEKLY (Period snapshot)</option>
                  <option value="MONTHLY">MONTHLY (Month-end closing)</option>
                  <option value="QUARTERLY">QUARTERLY (Quarterly report)</option>
                  <option value="YEARLY">YEARLY (Fiscal year closing)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Notes / Description (Optional)</label>
                <textarea
                  value={captureNotes}
                  onChange={(e) => setCaptureNotes(e.target.value)}
                  placeholder="e.g. Month-end reconciliation verification snapshot"
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-300">
                🔒 Note: Once captured, financial snapshots are authoritative and immutable.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCaptureModal(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={capturing}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow-md shadow-purple-900/40"
                >
                  {capturing ? 'Capturing...' : 'Capture Snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
