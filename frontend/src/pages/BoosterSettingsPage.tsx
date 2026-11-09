import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingState } from '../components/ui/LoadingState';
import {
  UserSettings,
  RosterRole,
  BoosterAvailability,
  PreferredContact,
  BoosterPortalDataResponse,
  BoosterOrder,
  AvailableQueueOrder,
  BoosterRunProof,
  BoosterActivityItem,
} from '../types/profileSettings';
import {
  fetchUserSettings,
  updateUserSettings,
  fetchBoosterPortalData,
} from '../services/profileSettings';

type TabKey = 'overview' | 'available' | 'orders' | 'proofs' | 'history' | 'settings';

export const BoosterSettingsPage: React.FC = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Settings State
  const [settings, setSettings] = useState<UserSettings>({
    orderAssignedDm: true,
    orderCompletedDm: true,
    payoutAlertsDm: true,
    announcementDm: false,
    rosterRole: 'DPS',
    availability: 'AVAILABLE',
    rosterVisibility: true,
    preferredContact: 'DISCORD',
  });

  const [discordInfo, setDiscordInfo] = useState<{
    discordId: string;
    username: string;
    connected: boolean;
    guildId: string | null;
    serverName: string;
  } | null>(null);

  // Booster Portal Data
  const [portalData, setPortalData] = useState<BoosterPortalDataResponse | null>(null);

  // Filters
  const [availableSearch, setAvailableSearch] = useState<string>('');
  const [availableGameFilter, setAvailableGameFilter] = useState<string>('ALL');
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<string>('ALL');
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<string>('ALL');
  const [historyPage, setHistoryPage] = useState<number>(1);
  const HISTORY_PAGE_SIZE = 8;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, portalRes] = await Promise.all([
        fetchUserSettings(),
        fetchBoosterPortalData().catch(() => null),
      ]);

      if (settingsRes.success) {
        setSettings(settingsRes.settings);
        setDiscordInfo(settingsRes.discordLinkage);
      }
      if (portalRes && portalRes.success) {
        setPortalData(portalRes);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading booster hub and order queues.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await updateUserSettings(settings);
      if (res.success) {
        setSettings(res.settings);
        setSuccessMsg('Booster preferences and notification settings saved successfully.');
      } else {
        setError('Failed to update settings.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const boosterInfo = portalData?.boosterInfo;
  const overview = portalData?.overview;
  const availableQueue: AvailableQueueOrder[] = portalData?.availableQueue || [];
  const myOrders: BoosterOrder[] = portalData?.myOrders || [];
  const myRunsAndProofs: BoosterRunProof[] = portalData?.myRunsAndProofs || [];
  const activityHistory: BoosterActivityItem[] = portalData?.activityHistory || [];

  // Filtered available orders
  const filteredAvailable = useMemo(() => {
    return availableQueue.filter((ord) => {
      const matchesSearch =
        !availableSearch ||
        ord.title.toLowerCase().includes(availableSearch.toLowerCase()) ||
        (ord.orderRef && ord.orderRef.toLowerCase().includes(availableSearch.toLowerCase())) ||
        ord.gameSlug.toLowerCase().includes(availableSearch.toLowerCase());

      const matchesGame =
        availableGameFilter === 'ALL' || ord.gameSlug.toLowerCase() === availableGameFilter.toLowerCase();

      return matchesSearch && matchesGame;
    });
  }, [availableQueue, availableSearch, availableGameFilter]);

  // Unique games in available queue
  const availableGames = useMemo(() => {
    const set = new Set<string>();
    availableQueue.forEach((o) => {
      if (o.gameSlug) set.add(o.gameSlug);
    });
    return Array.from(set);
  }, [availableQueue]);

  // Filtered my orders
  const filteredOrders = useMemo(() => {
    return myOrders.filter((ord) => {
      if (ordersStatusFilter === 'ALL') return true;
      if (ordersStatusFilter === 'ACTIVE') {
        return ['assigned', 'in_progress', 'open_presign', 'presign_closed'].includes(ord.orderStatus);
      }
      if (ordersStatusFilter === 'COMPLETED') {
        return ord.orderStatus === 'completed';
      }
      if (ordersStatusFilter === 'REPLACED') {
        return ord.assignmentStatus === 'replaced' || ord.orderStatus === 'cancelled';
      }
      return true;
    });
  }, [myOrders, ordersStatusFilter]);

  // Filtered activity history
  const filteredHistory = useMemo(() => {
    return activityHistory.filter((item) => {
      if (historyCategoryFilter === 'ALL') return true;
      return item.category === historyCategoryFilter;
    });
  }, [activityHistory, historyCategoryFilter]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistory, historyPage]);

  if (loading) {
    return <LoadingState message="Loading booster hub and active assignments..." />;
  }

  return (
    <div className="space-y-6">
      {/* ─── Header Banner ──────────────────────────────────────────────── */}
      <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <span>⚡</span> Booster Hub
            </h1>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                settings.availability === 'AVAILABLE'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : settings.availability === 'BUSY'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30'
              }`}
            >
              ● {settings.availability}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border bg-purple-500/20 text-purple-300 border-purple-500/30">
              {boosterInfo?.pilotVerified ? '🛡️ Verified Pilot' : '⚔️ Selfplay Specialist'}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border bg-blue-500/20 text-blue-300 border-blue-500/30">
              Role: {settings.rosterRole}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Discord-First boosting coordination. Available orders are claimed exclusively via Discord bot interactions.
            Track your assignments, monitor runs, and review proof status below.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <a href="/withdraw" className="btn btn-cta text-xs px-3 py-2 flex items-center gap-1.5">
            💸 Withdrawals
          </a>
          <a href="/profile" className="btn btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
            👤 Member Profile
          </a>
        </div>
      </div>

      {/* ─── Global Notifications ────────────────────────────────────────── */}
      {error && (
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-500/40 text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white">
            ✕
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-900/30 border border-emerald-500/40 text-emerald-300 text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* ─── Navigation Tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-gray-800 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'overview'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>📊</span> Overview
        </button>

        <button
          onClick={() => setActiveTab('available')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'available'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>📋</span> Available Orders
          {availableQueue.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-900 text-purple-200">
              {availableQueue.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'orders'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>🎯</span> My Orders
          {myOrders.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-900 text-blue-200">
              {myOrders.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('proofs')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'proofs'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>📸</span> My Runs &amp; Proofs
          {overview?.proofsAwaitingReviewCount ? (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-900 text-amber-200">
              {overview.proofsAwaitingReviewCount}
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'history'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>📜</span> Activity History
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'settings'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>⚙️</span> Preferences &amp; Specialization
        </button>
      </div>

      {/* ─── TAB A: Overview ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] space-y-1">
              <span className="text-xs text-gray-400">Active Assigned Orders</span>
              <p className="text-2xl font-mono font-bold text-[var(--accent-lime)]">
                {overview?.assignedActiveCount ?? 0}
              </p>
              <span className="text-[11px] text-gray-500">In carry or coordination</span>
            </div>

            <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] space-y-1">
              <span className="text-xs text-gray-400">Runs In Progress</span>
              <p className="text-2xl font-mono font-bold text-blue-400">
                {overview?.runsInProgressCount ?? 0}
              </p>
              <span className="text-[11px] text-gray-500">Active dungeon runs</span>
            </div>

            <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] space-y-1">
              <span className="text-xs text-gray-400">Proofs Awaiting Review</span>
              <p className="text-2xl font-mono font-bold text-amber-400">
                {overview?.proofsAwaitingReviewCount ?? 0}
              </p>
              <span className="text-[11px] text-gray-500">Pending Staff verification</span>
            </div>

            <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] space-y-1">
              <span className="text-xs text-gray-400">Completed Orders</span>
              <p className="text-2xl font-mono font-bold text-emerald-400">
                {overview?.completedOrdersCount ?? 0}
              </p>
              <span className="text-[11px] text-gray-500">Successfully verified</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Assignments Quick List */}
            <div className="lg:col-span-2 card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🎯</span> Current Active Assignments
                </h2>
                <button
                  onClick={() => setActiveTab('orders')}
                  className="text-xs text-[var(--accent-lime)] hover:underline"
                >
                  View All ({myOrders.length}) &rarr;
                </button>
              </div>

              {myOrders.filter((o) => ['assigned', 'in_progress', 'open_presign'].includes(o.orderStatus))
                .length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-800 rounded-lg">
                  No active orders assigned right now. Browse public orders in the{' '}
                  <button
                    onClick={() => setActiveTab('available')}
                    className="text-[var(--accent-lime)] underline"
                  >
                    Available Orders
                  </button>{' '}
                  tab and pre-sign via Discord.
                </div>
              ) : (
                <div className="space-y-3">
                  {myOrders
                    .filter((o) => ['assigned', 'in_progress', 'open_presign'].includes(o.orderStatus))
                    .slice(0, 5)
                    .map((ord) => (
                      <div
                        key={ord.assignmentId}
                        className="p-3.5 rounded-lg bg-[#181427] border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[var(--accent-lime)]">
                              #{ord.orderRef}
                            </span>
                            <span className="font-semibold text-white text-xs">{ord.title}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 font-mono">
                              {ord.modeLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                            <span>Role: <strong className="text-white">{ord.assignedRole}</strong></span>
                            <span>Status: <strong className="text-amber-400 uppercase">{ord.orderStatus}</strong></span>
                            <span>Reward: <strong className="text-white">${ord.boosterPoolUsd} USD</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {ord.executionChannelUrl ? (
                            <a
                              href={ord.executionChannelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <span>🔒</span> Execution Channel
                            </a>
                          ) : (
                            <span className="text-[11px] text-gray-500">Channel not assigned</span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Recent Personal Activity Feed */}
            <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>⚡</span> Recent Activity
              </h2>

              {(!overview?.recentActivity || overview.recentActivity.length === 0) ? (
                <p className="text-xs text-gray-500 text-center py-6">No recent booster activity recorded.</p>
              ) : (
                <div className="space-y-3">
                  {overview.recentActivity.map((act) => (
                    <div key={act.id} className="text-xs border-b border-gray-800/60 pb-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{act.title}</span>
                        <span className="text-[10px] text-gray-500">
                          {new Date(act.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">{act.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB B: Available Orders (Discord-Only Claiming) ─────────────── */}
      {activeTab === 'available' && (
        <div className="space-y-4">
          {/* Rule A Informational Callout */}
          <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-500/30 text-purple-200 text-xs flex items-start gap-3">
            <span className="text-lg">ℹ️</span>
            <div>
              <p className="font-bold text-white">Discord-Only Order Pre-signing &amp; Claiming</p>
              <p className="mt-0.5 text-purple-300">
                In accordance with G4X Community Rule A, all boost claiming and pre-signing is performed strictly
                through authorized Discord bot interactions on the official server. Use the <strong>View in Discord</strong> button
                below to jump directly to the live order announcement card.
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <input
                type="text"
                placeholder="Search orders, games, ref..."
                value={availableSearch}
                onChange={(e) => setAvailableSearch(e.target.value)}
                className="bg-[#181427] border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent-lime)] w-full sm:w-64"
              />

              {availableGames.length > 0 && (
                <select
                  value={availableGameFilter}
                  onChange={(e) => setAvailableGameFilter(e.target.value)}
                  className="bg-[#181427] border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent-lime)]"
                >
                  <option value="ALL">All Games</option>
                  {availableGames.map((g) => (
                    <option key={g} value={g}>
                      {g.toUpperCase()}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="text-xs text-gray-400">
              Showing <strong className="text-white">{filteredAvailable.length}</strong> eligible public orders
            </div>
          </div>

          {/* Available Orders List */}
          {filteredAvailable.length === 0 ? (
            <div className="card-surface p-12 text-center text-xs text-gray-400 border border-[var(--border-subtle)] rounded-xl">
              No eligible orders available in the public queue matching your filters. Check back soon or visit Discord.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAvailable.map((ord) => {
                const rf = ord.rosterFulfillment;
                return (
                  <div
                    key={ord.id}
                    className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3 hover:border-gray-700 transition-colors"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-[var(--accent-lime)]">
                            #{ord.orderRef || ord.id}
                          </span>
                          <span className="font-semibold text-white text-sm">{ord.title}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 font-mono uppercase">
                            {ord.gameSlug}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 font-mono">
                            {ord.modeLabel || 'Selfplay'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                          <span>
                            Reward Pool: <strong className="text-[var(--accent-lime)]">${ord.boosterPoolUsd || (ord.totalAmountUsdCents / 100).toFixed(2)} USD</strong>
                          </span>
                          <span>
                            Created: <strong className="text-gray-300">{new Date(ord.createdAt).toLocaleDateString()}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Action: Discord Deep Link or Pending State */}
                      <div className="flex items-center gap-2">
                        {ord.discordLink ? (
                          <a
                            href={ord.discordLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-cta text-xs px-4 py-2 flex items-center gap-1.5"
                          >
                            <span>💬</span> View in Discord &rarr;
                          </a>
                        ) : (
                          <span className="text-xs px-3 py-1.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                            ⏳ Publication Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Roster Slots Breakdown */}
                    {rf && (
                      <div className="pt-2 border-t border-gray-800/80">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-gray-400 font-semibold">Roster Composition</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                              rf.isFull
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {rf.isFull ? 'Roster Complete' : `${rf.totalFilled}/4 Filled`}
                          </span>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div
                            className={`p-1.5 rounded border ${
                              rf.filledTanks >= 1
                                ? 'bg-blue-900/30 border-blue-500/40 text-blue-300'
                                : 'bg-black/20 border-gray-800 text-gray-500'
                            }`}
                          >
                            <p className="text-[10px] uppercase font-bold">Tank</p>
                            <p className="font-mono text-xs font-bold mt-0.5">{rf.filledTanks}/1</p>
                          </div>

                          <div
                            className={`p-1.5 rounded border ${
                              rf.filledHealers >= 1
                                ? 'bg-green-900/30 border-green-500/40 text-green-300'
                                : 'bg-black/20 border-gray-800 text-gray-500'
                            }`}
                          >
                            <p className="text-[10px] uppercase font-bold">Healer</p>
                            <p className="font-mono text-xs font-bold mt-0.5">{rf.filledHealers}/1</p>
                          </div>

                          <div
                            className={`p-1.5 rounded border ${
                              rf.filledDps >= 2
                                ? 'bg-red-900/30 border-red-500/40 text-red-300'
                                : 'bg-black/20 border-gray-800 text-gray-500'
                            }`}
                          >
                            <p className="text-[10px] uppercase font-bold">DPS</p>
                            <p className="font-mono text-xs font-bold mt-0.5">{rf.filledDps}/2</p>
                          </div>

                          <div
                            className={`p-1.5 rounded border ${
                              rf.hasKeyOwner
                                ? 'bg-amber-900/30 border-amber-500/40 text-amber-300'
                                : 'bg-black/20 border-gray-800 text-gray-500'
                            }`}
                          >
                            <p className="text-[10px] uppercase font-bold">Key Owner</p>
                            <p className="font-mono text-xs font-bold mt-0.5">
                              {rf.hasKeyOwner ? 'Verified' : 'Pending'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB C: My Orders ────────────────────────────────────────────── */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {/* Status Filter */}
          <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Filter Status:</span>
              {(['ALL', 'ACTIVE', 'COMPLETED', 'REPLACED'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setOrdersStatusFilter(st)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    ordersStatusFilter === st
                      ? 'bg-[var(--accent-lime)] text-black'
                      : 'bg-[#181427] text-gray-400 hover:text-white border border-gray-800'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{filteredOrders.length} Orders</span>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="card-surface p-12 text-center text-xs text-gray-400 border border-[var(--border-subtle)] rounded-xl">
              No orders found matching this status filter.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((ord) => (
                <div
                  key={ord.assignmentId}
                  className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[var(--accent-lime)]">
                          #{ord.orderRef}
                        </span>
                        <span className="font-semibold text-white text-sm">{ord.title}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 font-mono">
                          {ord.modeLabel}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-bold uppercase">
                          Role: {ord.assignedRole}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                        <span>Status: <strong className="text-amber-400 uppercase">{ord.orderStatus}</strong></span>
                        <span>Runs: <strong className="text-white">{ord.runsCount}</strong></span>
                        <span>Pool: <strong className="text-white">${ord.boosterPoolUsd} USD</strong></span>
                        <span>Assigned: <strong className="text-gray-300">{new Date(ord.assignedAt).toLocaleDateString()}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {ord.executionChannelUrl ? (
                        <a
                          href={ord.executionChannelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1.5"
                        >
                          <span>🔒</span> Open Execution Channel
                        </a>
                      ) : (
                        <span className="text-xs text-gray-500">Channel not assigned</span>
                      )}
                    </div>
                  </div>

                  {/* Team Members Roster */}
                  {ord.teamMembers && ord.teamMembers.length > 0 && (
                    <div className="pt-2 border-t border-gray-800 text-xs">
                      <span className="text-[11px] text-gray-400 font-semibold block mb-1">
                        Assigned Squad Members:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {ord.teamMembers.map((tm) => (
                          <div
                            key={tm.userId}
                            className="px-2.5 py-1 rounded bg-[#181427] border border-gray-800 flex items-center gap-2"
                          >
                            <span className="font-medium text-white">{tm.username}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-900/60 text-purple-300 uppercase font-mono">
                              {tm.assignedRole}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB D: My Runs & Proofs ─────────────────────────────────────── */}
      {activeTab === 'proofs' && (
        <div className="space-y-4">
          {/* Submission Instructions Callout */}
          <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-500/30 text-blue-200 text-xs flex items-start gap-3">
            <span className="text-lg">📸</span>
            <div>
              <p className="font-bold text-white">Discord-First Completion Proof Submission</p>
              <p className="mt-0.5 text-blue-300">
                To submit completion proofs, navigate to the assigned order's private Discord execution channel. Click the{' '}
                <strong>Submit Proof</strong> button or type <code className="bg-black/40 px-1 py-0.5 rounded">G4!proof</code>{' '}
                with your screenshot attachment. All submissions are automatically indexed for Staff verification and escrow release.
              </p>
            </div>
          </div>

          {myRunsAndProofs.length === 0 ? (
            <div className="card-surface p-12 text-center text-xs text-gray-400 border border-[var(--border-subtle)] rounded-xl">
              No proof records submitted yet. Complete a dungeon run and submit screenshots in your execution channel.
            </div>
          ) : (
            <div className="space-y-3">
              {myRunsAndProofs.map((p) => (
                <div
                  key={p.proofId}
                  className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[var(--accent-lime)]">
                        #{p.orderRef}
                      </span>
                      <span className="text-white font-semibold text-xs">Run #{p.runNumber}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                          p.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : p.status === 'rejected'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        ● {p.status}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                        {p.proofType}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={p.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary text-xs px-2.5 py-1 flex items-center gap-1"
                      >
                        🔍 View Evidence
                      </a>
                      {p.executionChannelUrl && (
                        <a
                          href={p.executionChannelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-cta text-xs px-2.5 py-1 flex items-center gap-1"
                        >
                          🔒 Channel
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-gray-400 space-y-1 pt-1">
                    {p.description && (
                      <p>
                        <strong className="text-gray-300">Notes:</strong> {p.description}
                      </p>
                    )}
                    {p.reviewNotes && (
                      <p className="text-purple-300">
                        <strong>Reviewer Feedback:</strong> {p.reviewNotes}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-[11px] text-gray-500 pt-1">
                      <span>Submitted: {new Date(p.submittedAt).toLocaleString()}</span>
                      {p.reviewedBy && (
                        <span>Reviewed by: {p.reviewedBy} ({p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString() : ''})</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB E: Activity History ─────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Category Filter */}
          <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Category:</span>
              {(['ALL', 'ASSIGNMENT', 'PROOF', 'DISPUTE'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setHistoryCategoryFilter(cat);
                    setHistoryPage(1);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    historyCategoryFilter === cat
                      ? 'bg-[var(--accent-lime)] text-black'
                      : 'bg-[#181427] text-gray-400 hover:text-white border border-gray-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">Total Events: {filteredHistory.length}</span>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="card-surface p-12 text-center text-xs text-gray-400 border border-[var(--border-subtle)] rounded-xl">
              No activity records found in this category.
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedHistory.map((item) => (
                <div
                  key={item.id}
                  className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-[var(--accent-lime)]">
                        #{item.orderRef}
                      </span>
                      <span className="text-white font-semibold text-xs">{item.title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-900/60 text-purple-300 font-mono">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400">{item.detail}</p>
                  </div>

                  <div className="text-right text-[11px] text-gray-500 font-mono">
                    {new Date(item.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {totalHistoryPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="btn btn-secondary text-xs px-3 py-1 disabled:opacity-40"
                  >
                    &larr; Prev
                  </button>
                  <span className="text-xs text-gray-400">
                    Page {historyPage} of {totalHistoryPages}
                  </span>
                  <button
                    disabled={historyPage >= totalHistoryPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    className="btn btn-secondary text-xs px-3 py-1 disabled:opacity-40"
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB F: Preferences & Specialization ─────────────────────────── */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Roster & Availability Card */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>⚡</span> Roster Specialization &amp; Availability
            </h2>
            <p className="text-xs text-gray-400">
              Set your primary role for WoW Mythic+ group composition (1 Tank, 1 Healer, 2 DPS) and live availability status.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Roster Specialization
                </label>
                <select
                  value={settings.rosterRole}
                  onChange={(e) =>
                    setSettings({ ...settings, rosterRole: e.target.value as RosterRole })
                  }
                  className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                >
                  <option value="TANK">🛡️ Tank (Defense Specialist)</option>
                  <option value="HEALER">💚 Healer (Support Specialist)</option>
                  <option value="DPS">⚔️ DPS (Damage Specialist)</option>
                  <option value="ANY">🔄 Any / Flex</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Live Availability Status
                </label>
                <select
                  value={settings.availability}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      availability: e.target.value as BoosterAvailability,
                    })
                  }
                  className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                >
                  <option value="AVAILABLE">🟢 Available (Ready for carry invitations)</option>
                  <option value="BUSY">🟡 Busy (In-run / temporarily unavailable)</option>
                  <option value="AWAY">🔴 Away (Offline / not taking orders)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Preferred Contact Channel
                </label>
                <select
                  value={settings.preferredContact}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      preferredContact: e.target.value as PreferredContact,
                    })
                  }
                  className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                >
                  <option value="DISCORD">Discord Direct Messages</option>
                  <option value="TELEGRAM">Telegram Direct Chat</option>
                  <option value="WHATSAPP">WhatsApp Direct Messages</option>
                </select>
              </div>

              <div className="flex items-center pt-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.rosterVisibility}
                    onChange={(e) =>
                      setSettings({ ...settings, rosterVisibility: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-gray-700 text-[var(--accent-lime)] focus:ring-[var(--accent-lime)]"
                  />
                  <span className="text-xs text-gray-300 font-semibold">
                    Visible in available squad rosters
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Discord Notification Preferences Card */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🔔</span> Discord Notification Preferences
            </h2>
            <p className="text-xs text-gray-400">
              Choose which automated notifications are dispatched to your direct Discord messages ({discordInfo?.username ? `@${discordInfo.username}` : user?.username ? `@${user.username}` : 'connected account'}) by the G4X Bot.
            </p>

            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#181427] border border-gray-800 cursor-pointer hover:border-gray-700">
                <input
                  type="checkbox"
                  checked={settings.orderAssignedDm}
                  onChange={(e) =>
                    setSettings({ ...settings, orderAssignedDm: e.target.checked })
                  }
                  className="w-4 h-4 mt-0.5 rounded border-gray-700 text-[var(--accent-lime)] focus:ring-[var(--accent-lime)]"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Order Assigned DMs</p>
                  <p className="text-[11px] text-gray-400">
                    Receive an instant direct message when you or your premade team is assigned to an order.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#181427] border border-gray-800 cursor-pointer hover:border-gray-700">
                <input
                  type="checkbox"
                  checked={settings.orderCompletedDm}
                  onChange={(e) =>
                    setSettings({ ...settings, orderCompletedDm: e.target.checked })
                  }
                  className="w-4 h-4 mt-0.5 rounded border-gray-700 text-[var(--accent-lime)] focus:ring-[var(--accent-lime)]"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Order Completed &amp; Verified DMs</p>
                  <p className="text-[11px] text-gray-400">
                    Receive confirmation when your run proof is accepted and funds are staged in escrow.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#181427] border border-gray-800 cursor-pointer hover:border-gray-700">
                <input
                  type="checkbox"
                  checked={settings.payoutAlertsDm}
                  onChange={(e) =>
                    setSettings({ ...settings, payoutAlertsDm: e.target.checked })
                  }
                  className="w-4 h-4 mt-0.5 rounded border-gray-700 text-[var(--accent-lime)] focus:ring-[var(--accent-lime)]"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Payout &amp; Withdrawal Alerts</p>
                  <p className="text-[11px] text-gray-400">
                    Direct alerts for withdrawal quotes, review updates and payout execution notices.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#181427] border border-gray-800 cursor-pointer hover:border-gray-700">
                <input
                  type="checkbox"
                  checked={settings.announcementDm}
                  onChange={(e) =>
                    setSettings({ ...settings, announcementDm: e.target.checked })
                  }
                  className="w-4 h-4 mt-0.5 rounded border-gray-700 text-[var(--accent-lime)] focus:ring-[var(--accent-lime)]"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Platform Announcements</p>
                  <p className="text-[11px] text-gray-400">
                    Occasional direct announcements regarding tournament events, season resets and platform updates.
                  </p>
                </div>
              </label>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="btn btn-cta px-6 py-2 text-sm flex items-center gap-2"
              >
                {savingSettings ? 'Saving Settings...' : 'Save All Preferences'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
