import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  SerializedAutomatedSchedule,
  SerializedGeneratedReport,
} from '../../types/financialAnalytics';
import {
  fetchAutomatedSchedules,
  updateAutomatedSchedule,
  runAutomatedSchedule,
  fetchGeneratedReports,
  getGeneratedReportDownloadUrl,
} from '../../services/financialAnalytics';

export const AutomatedReportingSection: React.FC = () => {
  const [schedules, setSchedules] = useState<SerializedAutomatedSchedule[]>([]);
  const [reports, setReports] = useState<SerializedGeneratedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Triggering State
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [schedRes, repRes] = await Promise.all([
        fetchAutomatedSchedules(),
        fetchGeneratedReports(50),
      ]);
      setSchedules(schedRes.schedules || []);
      setReports(repRes.reports || []);
    } catch (err: any) {
      console.error('[AutomatedReporting] Load error:', err);
      setError(err.message || 'Failed to load automated reporting schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleToggle = async (schedule: SerializedAutomatedSchedule) => {
    setTogglingId(schedule.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await updateAutomatedSchedule(schedule.id, {
        isEnabled: !schedule.isEnabled,
      });
      setSchedules((prev) =>
        prev.map((s) => (s.id === schedule.id ? res.schedule : s))
      );
      setSuccessMsg(`Schedule "${schedule.name}" is now ${res.schedule.isEnabled ? 'Active' : 'Disabled'}.`);
    } catch (err: any) {
      console.error('[AutomatedReporting] Toggle error:', err);
      setError(err.message || 'Failed to update schedule status');
    } finally {
      setTogglingId(null);
    }
  };

  const handleRunNow = async (schedule: SerializedAutomatedSchedule) => {
    setRunningId(schedule.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await runAutomatedSchedule(schedule.id);
      setSuccessMsg(`Report generated successfully: ${res.report.fileName}`);
      // Refresh reports archive
      setReportsLoading(true);
      const repRes = await fetchGeneratedReports(50);
      setReports(repRes.reports || []);
    } catch (err: any) {
      console.error('[AutomatedReporting] Run now error:', err);
      setError(err.message || 'Failed to trigger schedule execution');
    } finally {
      setRunningId(null);
      setReportsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFormatBadge = (fmt: string) => {
    switch (fmt.toUpperCase()) {
      case 'CSV':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'XLSX':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'PDF':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'JSON':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      default:
        return 'bg-zinc-800 text-zinc-300 border-zinc-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-xl shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-lg text-lg font-bold">
              ⏰
            </span>
            <h2 className="text-xl font-bold text-zinc-100">Automated Financial Reporting</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Configure automated report generation routines, cron schedules, and access generated historical report archives.
          </p>
        </div>
        <button
          onClick={loadAll}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
        >
          🔄 Refresh
        </button>
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

      {loading ? (
        <div className="p-16 bg-zinc-900 border border-zinc-800 rounded-xl">
          <LoadingState message="Loading automated report schedules..." />
        </div>
      ) : (
        <>
          {/* ─── Schedules Configuration Table ───────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  <span>📅</span> Active Automated Schedules
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Automated schedules generate authoritative financial statements and save downloadable archives.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-sm text-zinc-300">
                <thead className="bg-zinc-800/80 text-zinc-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Schedule Name</th>
                    <th className="p-3">Frequency</th>
                    <th className="p-3">Cron / Timing</th>
                    <th className="p-3">Format</th>
                    <th className="p-3">Last Run</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="p-3 font-semibold text-zinc-200">
                        {s.name}
                        <span className="block text-xs font-mono text-zinc-500 font-normal">{s.scheduleRef}</span>
                      </td>
                      <td className="p-3 text-xs text-zinc-300 font-medium">
                        {s.frequency}
                      </td>
                      <td className="p-3 font-mono text-xs text-purple-300">
                        {s.cronExpression}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded border ${getFormatBadge(s.format)}`}>
                          {s.format}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-zinc-400">
                        {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggle(s)}
                          disabled={togglingId === s.id}
                          className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                            s.isEnabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700'
                          }`}
                        >
                          {togglingId === s.id ? 'Saving...' : s.isEnabled ? '● Active' : '○ Disabled'}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleRunNow(s)}
                          disabled={runningId === s.id}
                          className="px-3 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg transition-colors shadow-sm"
                        >
                          {runningId === s.id ? 'Generating...' : '⚡ Run Now'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Generated Reports Archive ─────────────────────────────────── */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  <span>📂</span> Generated Report Archive
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Historical statements generated by automated schedules and on-demand triggers.
                </p>
              </div>
              <span className="text-xs text-zinc-400">
                {reports.length} statements archived
              </span>
            </div>

            {reportsLoading ? (
              <div className="p-8">
                <LoadingState message="Refreshing archive..." />
              </div>
            ) : reports.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-sm">
                No reports generated yet. Click &quot;⚡ Run Now&quot; above to create your first financial statement.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-sm text-zinc-300">
                  <thead className="bg-zinc-800/80 text-zinc-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="p-3">Reference</th>
                      <th className="p-3">Schedule / Source</th>
                      <th className="p-3">Report Type</th>
                      <th className="p-3">Format</th>
                      <th className="p-3">Generated At</th>
                      <th className="p-3">Size</th>
                      <th className="p-3 text-right">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {reports.map((r) => (
                      <tr key={r.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="p-3 font-mono text-xs text-purple-400 font-semibold">
                          {r.reportRef}
                        </td>
                        <td className="p-3 text-xs text-zinc-200">
                          {r.scheduleName || 'On-Demand'}
                        </td>
                        <td className="p-3 text-xs text-zinc-300 font-medium">
                          {r.reportType}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 text-xs font-bold rounded border ${getFormatBadge(r.format)}`}>
                            {r.format}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-zinc-400">
                          {new Date(r.generatedAt).toLocaleString()}
                        </td>
                        <td className="p-3 text-xs text-zinc-400 font-mono">
                          {formatFileSize(r.fileSizeBytes)}
                        </td>
                        <td className="p-3 text-right">
                          <a
                            href={getGeneratedReportDownloadUrl(r.id)}
                            download={r.fileName}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-purple-300 hover:text-purple-200 border border-zinc-700 rounded-lg transition-colors"
                          >
                            ⬇ Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
