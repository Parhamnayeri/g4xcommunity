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
  WowCharacter,
  RaiderIOPreviewData,
  CharacterDetailsResponse,
} from '../types/profileSettings';
import {
  fetchUserSettings,
  updateUserSettings,
  fetchBoosterPortalData,
  fetchUserCharacters,
  fetchCharacterDetails,
  previewRaiderIOCharacter,
  addWowCharacter,
  setMainCharacter,
  syncWowCharacter,
  removeCharacter,
  reactivateCharacter,
} from '../services/profileSettings';

type TabKey = 'overview' | 'characters' | 'available' | 'orders' | 'proofs' | 'history' | 'settings';

const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  'Druid': '#FF7C0A',
  'Evoker': '#33937F',
  'Hunter': '#AAD372',
  'Mage': '#3FC7EB',
  'Monk': '#00FF98',
  'Paladin': '#F48CBA',
  'Priest': '#FFFFFF',
  'Rogue': '#FFF468',
  'Shaman': '#0070DD',
  'Warlock': '#8788EE',
  'Warrior': '#C69B6D',
};

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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

  // Character Roster State
  const [characters, setCharacters] = useState<WowCharacter[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<number, number>>({});
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  // Add Character State
  const [addMode, setAddMode] = useState<'url' | 'manual'>('url');
  const [urlInput, setUrlInput] = useState<string>('');
  const [regionInput, setRegionInput] = useState<string>('eu');
  const [realmInput, setRealmInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [previewData, setPreviewData] = useState<RaiderIOPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [addingCharacter, setAddingCharacter] = useState<boolean>(false);

  // Character Details Modal State
  const [selectedCharDetails, setSelectedCharDetails] = useState<CharacterDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);

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
      const [settingsRes, portalRes, charsRes] = await Promise.all([
        fetchUserSettings(),
        fetchBoosterPortalData().catch(() => null),
        fetchUserCharacters(true).catch(() => []),
      ]);

      if (settingsRes.success) {
        setSettings(settingsRes.settings);
        setDiscordInfo(settingsRes.discordLinkage);
      }
      if (portalRes && portalRes.success) {
        setPortalData(portalRes);
      }
      if (charsRes && Array.isArray(charsRes)) {
        setCharacters(charsRes);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading booster hub and order queues.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCharacters = useCallback(async () => {
    try {
      const [chars, portal] = await Promise.all([
        fetchUserCharacters(true).catch(() => []),
        fetchBoosterPortalData().catch(() => null),
      ]);
      if (chars && Array.isArray(chars)) {
        setCharacters(chars);
      }
      if (portal && portal.success) {
        setPortalData(portal);
      }
    } catch (err: any) {
      console.error('Failed to refresh characters:', err);
    }
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    const hasActiveCooldown = Object.values(cooldowns).some((cd) => cd > 0);
    if (!hasActiveCooldown) return;

    const timer = setInterval(() => {
      setCooldowns((prev) => {
        const next: Record<number, number> = {};
        for (const [idStr, val] of Object.entries(prev)) {
          const id = Number(idStr);
          if (val > 1) {
            next[id] = val - 1;
          }
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldowns]);

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

  const activeCharacters = useMemo(
    () => characters.filter((c) => c.isActive !== false),
    [characters]
  );
  const inactiveCharacters = useMemo(
    () => characters.filter((c) => c.isActive === false),
    [characters]
  );
  const mainCharacter = useMemo(
    () => activeCharacters.find((c) => c.isMain) || activeCharacters[0] || null,
    [activeCharacters]
  );

  const handlePreviewCharacter = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const payload =
        addMode === 'url'
          ? { url: urlInput.trim() }
          : { region: regionInput, realm: realmInput.trim(), characterName: nameInput.trim() };
      const res = await previewRaiderIOCharacter(payload);
      if (res.success && res.preview) {
        setPreviewData(res.preview);
      } else {
        setError('Character profile could not be found or verified on Raider.IO.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to preview Raider.IO profile.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAddCharacter = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAddingCharacter(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload =
        addMode === 'url'
          ? { raiderioUrl: urlInput.trim() }
          : { region: regionInput, realm: realmInput.trim(), characterName: nameInput.trim() };

      const res = await addWowCharacter(payload);
      if (res.success) {
        setSuccessMsg(`Character ${res.character.characterName} registered successfully.`);
        setUrlInput('');
        setNameInput('');
        setRealmInput('');
        setPreviewData(null);
        await refreshCharacters();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add character.');
    } finally {
      setAddingCharacter(false);
    }
  };

  const handleSetMain = async (charId: number) => {
    setActionLoadingId(charId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await setMainCharacter(charId);
      if (res.success) {
        setSuccessMsg(`${res.character.characterName} is now set as your Main character.`);
        await refreshCharacters();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to set main character.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSyncCharacter = async (charId: number) => {
    if ((cooldowns[charId] || 0) > 0) return;
    setSyncingId(charId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await syncWowCharacter(charId);
      if (res.success) {
        setSuccessMsg(`Raider.IO stats refreshed for ${res.character.characterName}.`);
        setCooldowns((prev) => ({ ...prev, [charId]: 60 }));
        await refreshCharacters();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync character.');
    } finally {
      setSyncingId(null);
    }
  };

  const handleRemoveCharacter = async (charId: number, charName: string) => {
    if (
      !window.confirm(
        `Deactivate ${charName}? Historical orders, teams, and run references will be safely preserved.`
      )
    ) {
      return;
    }
    setActionLoadingId(charId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await removeCharacter(charId);
      if (res.success) {
        setSuccessMsg(`Character ${charName} deactivated.`);
        await refreshCharacters();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate character.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReactivateCharacter = async (charId: number, charName: string) => {
    setActionLoadingId(charId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await reactivateCharacter(charId);
      if (res.success) {
        setSuccessMsg(`Character ${charName} reactivated and restored to roster.`);
        await refreshCharacters();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate character.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenDetails = async (charId: number) => {
    setDetailsLoading(true);
    setDetailsModalOpen(true);
    setSelectedCharDetails(null);
    setError(null);
    try {
      const res = await fetchCharacterDetails(charId);
      if (res.success) {
        setSelectedCharDetails(res);
        if (res.cooldownRemainingSeconds > 0) {
          setCooldowns((prev) => ({ ...prev, [charId]: res.cooldownRemainingSeconds }));
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load character details.');
      setDetailsModalOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

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
          onClick={() => setActiveTab('characters')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'characters'
              ? 'text-[var(--accent-lime)] border-b-2 border-[var(--accent-lime)] bg-[#1e1b2e]'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span>⚔️</span> My Characters
          {activeCharacters.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-900 text-emerald-200">
              {activeCharacters.length}
            </span>
          )}
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

          {/* Main Character & Raider.IO Profile Showcase */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] bg-gradient-to-r from-[#171427] via-[#1b1730] to-[#171427]">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  {mainCharacter?.thumbnailUrl ? (
                    <img
                      src={mainCharacter.thumbnailUrl}
                      alt={mainCharacter.characterName}
                      className="w-14 h-14 rounded-full border-2 border-[var(--accent-lime)] object-cover shadow-lg"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center text-xl">
                      🛡️
                    </div>
                  )}
                  {mainCharacter?.isMain && (
                    <span className="absolute -bottom-1 -right-1 text-xs bg-amber-500 text-black px-1 rounded-full font-bold">
                      ★
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">
                      {mainCharacter ? (
                        <>
                          <span style={{ color: CLASS_COLORS[mainCharacter.characterClass || ''] || '#fff' }}>
                            {mainCharacter.characterName}
                          </span>
                          <span className="text-gray-400 font-normal text-sm ml-1.5">
                            — {mainCharacter.realm} ({mainCharacter.region?.toUpperCase()})
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-300">No Main Character Linked</span>
                      )}
                    </span>
                    {mainCharacter?.isMain && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                        ⭐ Main Roster
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {mainCharacter ? (
                      <>
                        <span>
                          {mainCharacter.activeSpec || mainCharacter.characterClass || 'World of Warcraft'}
                        </span>
                        {mainCharacter.itemLevel ? (
                          <span className="ml-2 font-mono text-gray-300">ilvl {mainCharacter.itemLevel}</span>
                        ) : null}
                        {mainCharacter.raidProgression ? (
                          <span className="ml-2 text-purple-300">({mainCharacter.raidProgression})</span>
                        ) : null}
                      </>
                    ) : (
                      'Link your World of Warcraft character with Raider.IO to verify rating and unlock high-tier carries.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-800">
                {mainCharacter ? (
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Current-Season M+ Rating</div>
                    <div className="text-2xl font-mono font-bold text-[var(--accent-lime)]">
                      {mainCharacter.mythicScore && mainCharacter.mythicScore > 0 ? (
                        mainCharacter.mythicScore
                      ) : (
                        <span className="text-xs font-normal text-gray-400">Not available</span>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('characters')}
                    className="btn btn-secondary text-xs px-3 py-2 flex items-center gap-1.5"
                  >
                    <span>⚔️</span> {mainCharacter ? 'Manage Characters' : 'Add Character'}
                  </button>
                  {mainCharacter && (
                    <button
                      onClick={() => handleSyncCharacter(mainCharacter.id)}
                      disabled={syncingId === mainCharacter.id || (cooldowns[mainCharacter.id] || 0) > 0}
                      className="btn btn-cta text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-50"
                      title="Refresh current season scores from Raider.IO (60s cooldown)"
                    >
                      <span>🔄</span>
                      {syncingId === mainCharacter.id
                        ? 'Syncing...'
                        : (cooldowns[mainCharacter.id] || 0) > 0
                        ? `${cooldowns[mainCharacter.id]}s`
                        : 'Sync Raider.IO'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-gray-800/60 flex items-center justify-between text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                Scores reflect the active season from Raider.IO. Missing scores show as Not available.
              </span>
              <span className="text-[10px] text-gray-400">
                Data provided by{' '}
                <a
                  href="https://raider.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:underline"
                >
                  Raider.IO
                </a>
              </span>
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

      {/* ─── TAB: My Characters (WoW & Raider.IO Roster) ────────────────── */}
      {activeTab === 'characters' && (
        <div className="space-y-6">
          {/* Header & Attribution Card */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-2">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>⚔️</span> World of Warcraft Character Roster
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Manage your characters, sync current-season Mythic+ scores from Raider.IO, and designate one Main
                  Character for team composition and roster priority.
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] px-2.5 py-1 rounded-full bg-purple-900/40 text-purple-300 border border-purple-500/30">
                  Data provided by Raider.IO API
                </span>
              </div>
            </div>
            <div className="pt-2 text-[11px] text-gray-400 border-t border-gray-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <span>
                Notice: Raider.IO data is used for non-commercial community verification. Commercial deployment requires
                a formal commercial licensing agreement with Raider.IO.
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-800/50 whitespace-nowrap">
                Live Sync Gated (Pending Commercial Agreement)
              </span>
            </div>
          </div>

          {/* Add Character Section */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>➕</span> Add World of Warcraft Character
                </h3>
                <p className="text-xs text-gray-400">
                  Register a character via Raider.IO URL or standard realm credentials.
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-[#13111e] p-1 rounded-lg border border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setAddMode('url');
                    setPreviewData(null);
                  }}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    addMode === 'url' ? 'bg-[var(--accent-lime)] text-black font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  🔗 Raider.IO URL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMode('manual');
                    setPreviewData(null);
                  }}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    addMode === 'manual'
                      ? 'bg-[var(--accent-lime)] text-black font-bold'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ✍️ Manual Entry
                </button>
              </div>
            </div>

            <form onSubmit={handleAddCharacter} className="space-y-4">
              {addMode === 'url' ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Raider.IO Profile URL <span className="text-[var(--accent-lime)]">*</span>
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://raider.io/characters/eu/tarren-mill/CharacterName"
                      className="input-field flex-1 text-xs"
                      required
                    />
                    <button
                      type="button"
                      onClick={handlePreviewCharacter}
                      disabled={previewLoading || !urlInput.trim()}
                      className="btn btn-secondary text-xs px-4 py-2 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      {previewLoading ? 'Inspecting...' : '🔍 Preview Profile'}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Only HTTPS URLs on raider.io are accepted. URLs are sanitized against SSRF and host whitelists.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Region</label>
                    <select
                      value={regionInput}
                      onChange={(e) => setRegionInput(e.target.value)}
                      className="input-field text-xs w-full"
                    >
                      <option value="eu">Europe (EU)</option>
                      <option value="us">Americas &amp; Oceania (US)</option>
                      <option value="kr">Korea (KR)</option>
                      <option value="tw">Taiwan (TW)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-300 mb-1">
                      Realm Name <span className="text-[var(--accent-lime)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={realmInput}
                      onChange={(e) => setRealmInput(e.target.value)}
                      placeholder="e.g. Tarren Mill, Kazzak, Twisting Nether"
                      className="input-field text-xs w-full"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">
                      Character Name <span className="text-[var(--accent-lime)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="e.g. Frostblade"
                      className="input-field text-xs w-full"
                      required
                    />
                  </div>

                  <div className="sm:col-span-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handlePreviewCharacter}
                      disabled={previewLoading || !realmInput.trim() || !nameInput.trim()}
                      className="btn btn-secondary text-xs px-4 py-2 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {previewLoading ? 'Inspecting...' : '🔍 Preview Profile'}
                    </button>
                  </div>
                </div>
              )}

              {/* Preview Card */}
              {previewData && (
                <div className="p-4 rounded-xl border border-[var(--accent-lime)]/40 bg-[#161324] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--accent-lime)] flex items-center gap-1.5">
                      <span>✓</span> Raider.IO Profile Verified
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewData(null)}
                      className="text-xs text-gray-500 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {previewData.thumbnailUrl ? (
                        <img
                          src={previewData.thumbnailUrl}
                          alt={previewData.name}
                          className="w-12 h-12 rounded-full border border-gray-700 object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-lg">
                          🛡️
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <span style={{ color: CLASS_COLORS[previewData.class] || '#fff' }}>{previewData.name}</span>
                          <span className="text-xs text-gray-400 font-normal">
                            — {previewData.realm} ({previewData.region.toUpperCase()})
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {previewData.activeSpec || previewData.class}
                          {previewData.itemLevel ? ` · ilvl ${previewData.itemLevel}` : ''}
                          {previewData.faction ? ` · ${previewData.faction}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[10px] text-gray-400">Current Season M+</span>
                        <div className="text-lg font-mono font-bold text-[var(--accent-lime)]">
                          {previewData.mythicScore && previewData.mythicScore > 0 ? (
                            previewData.mythicScore
                          ) : (
                            <span className="text-xs font-normal text-gray-400">Not available</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={addingCharacter}
                        className="btn btn-cta text-xs px-4 py-2 font-bold disabled:opacity-50"
                      >
                        {addingCharacter ? 'Adding...' : 'Confirm & Add Character'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!previewData && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      addingCharacter ||
                      (addMode === 'url' ? !urlInput.trim() : !realmInput.trim() || !nameInput.trim())
                    }
                    className="btn btn-cta text-xs px-5 py-2 font-bold disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>➕</span> {addingCharacter ? 'Adding Character...' : 'Add Character to Roster'}
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Active Characters Roster */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🛡️</span> Active Characters ({activeCharacters.length})
              </h3>
              <span className="text-xs text-gray-400">
                ⭐ One character serves as your active Main for boost carries.
              </span>
            </div>

            {activeCharacters.length === 0 ? (
              <div className="card-surface p-8 rounded-xl border border-dashed border-gray-800 text-center space-y-2">
                <p className="text-sm font-semibold text-gray-300">No active WoW characters registered.</p>
                <p className="text-xs text-gray-500">
                  Add your primary character above to enable Mythic+ verification and unlock order execution.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeCharacters.map((char) => {
                  const cooldownSec = cooldowns[char.id] || 0;
                  const isSyncing = syncingId === char.id;
                  const isLoadingAction = actionLoadingId === char.id;

                  return (
                    <div
                      key={char.id}
                      className={`card-surface p-5 rounded-xl border transition-all flex flex-col justify-between gap-4 ${
                        char.isMain
                          ? 'border-[var(--accent-lime)]/60 bg-[#19152b]'
                          : 'border-[var(--border-subtle)] hover:border-gray-700'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Top: Avatar + Name + Main Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            {char.thumbnailUrl ? (
                              <img
                                src={char.thumbnailUrl}
                                alt={char.characterName}
                                className="w-12 h-12 rounded-full border border-gray-700 object-cover shadow-md"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-lg">
                                🛡️
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className="text-sm font-bold"
                                  style={{ color: CLASS_COLORS[char.characterClass || ''] || '#fff' }}
                                >
                                  {char.characterName}
                                </span>
                                {char.isMain && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                    ⭐ Main
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                {char.realm} ({char.region?.toUpperCase()})
                              </p>
                            </div>
                          </div>

                          {/* Role Badge */}
                          {char.activeRole && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 font-medium">
                              {char.activeRole}
                            </span>
                          )}
                        </div>

                        {/* Middle: Class, Spec, Ilvl */}
                        <div className="flex items-center justify-between text-xs border-y border-gray-800/60 py-2">
                          <div>
                            <span className="text-gray-400">Spec: </span>
                            <span className="text-white font-medium">
                              {char.activeSpec || char.characterClass || 'WoW'}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">Item Level: </span>
                            <span className="font-mono text-[var(--accent-lime)] font-bold">
                              {char.itemLevel ? char.itemLevel : 'N/A'}
                            </span>
                          </div>
                        </div>

                        {/* Scores Breakdown */}
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-gray-400">Current M+ Score:</span>
                            <span className="text-base font-mono font-bold text-[var(--accent-lime)]">
                              {char.mythicScore && char.mythicScore > 0 ? (
                                char.mythicScore
                              ) : (
                                <span className="text-xs font-normal text-gray-400">Not available</span>
                              )}
                            </span>
                          </div>

                          {(char.tankScore || char.healerScore || char.dpsScore) && (
                            <div className="flex items-center justify-between text-[11px] text-gray-500 font-mono">
                              <span>Tank: {char.tankScore ?? 0}</span>
                              <span>Healer: {char.healerScore ?? 0}</span>
                              <span>DPS: {char.dpsScore ?? 0}</span>
                            </div>
                          )}

                          {char.raidProgression && (
                            <div className="text-[11px] text-purple-300/80 truncate pt-0.5">
                              🏰 {char.raidProgression}
                            </div>
                          )}
                        </div>

                        {/* Sync Status Alert */}
                        {char.syncStatus === 'failed' ? (
                          <div className="p-2 rounded bg-red-950/30 border border-red-500/30 text-red-300 text-[11px] space-y-0.5">
                            <div className="font-semibold flex items-center gap-1">
                              <span>⚠️</span> Sync Failed
                            </div>
                            <p className="text-[10px] text-red-400">{char.syncError || 'Temporary API error.'}</p>
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-500 flex items-center justify-between">
                            <span>Status: Verified</span>
                            <span>{formatRelativeTime(char.lastSyncedAt)}</span>
                          </div>
                        )}
                      </div>

                      {/* Bottom Actions */}
                      <div className="border-t border-gray-800/60 pt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          {!char.isMain ? (
                            <button
                              type="button"
                              onClick={() => handleSetMain(char.id)}
                              disabled={isLoadingAction}
                              className="btn btn-secondary text-xs py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              <span>⭐</span> Set Main
                            </button>
                          ) : (
                            <span className="text-xs py-1.5 flex items-center justify-center gap-1 text-amber-400 font-medium">
                              <span>★</span> Active Main
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleSyncCharacter(char.id)}
                            disabled={isSyncing || cooldownSec > 0}
                            className="btn btn-cta text-xs py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
                            title="Refresh character scores from Raider.IO (60s cooldown)"
                          >
                            <span>🔄</span>
                            {isSyncing ? 'Syncing...' : cooldownSec > 0 ? `${cooldownSec}s` : 'Sync RIO'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => handleOpenDetails(char.id)}
                            className="text-xs text-[var(--accent-lime)] hover:underline flex items-center gap-1"
                          >
                            <span>📋</span> View Details &amp; Runs
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveCharacter(char.id, char.characterName)}
                            disabled={isLoadingAction}
                            className="text-xs text-red-400 hover:text-red-300"
                            title="Deactivate character (preserves order history)"
                          >
                            Deactivate
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Archived / Inactive Characters Section */}
          {inactiveCharacters.length > 0 && (
            <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3">
              <button
                type="button"
                onClick={() => setShowArchived((prev) => !prev)}
                className="w-full flex items-center justify-between text-xs font-bold text-gray-300 hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <span>📦</span> Archived &amp; Deactivated Characters ({inactiveCharacters.length})
                </span>
                <span>{showArchived ? '▲ Collapse' : '▼ Expand'}</span>
              </button>

              {showArchived && (
                <div className="space-y-2 pt-2 border-t border-gray-800">
                  <p className="text-[11px] text-gray-400 mb-2">
                    Deactivated characters are kept for historical order, squad, and dispute integrity. You can
                    reactivate any character at any time.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {inactiveCharacters.map((char) => (
                      <div
                        key={char.id}
                        className="p-3 rounded-lg border border-gray-800 bg-[#12101d] flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-xs font-bold text-gray-300">
                            {char.characterName} — {char.realm} ({char.region?.toUpperCase()})
                          </div>
                          <p className="text-[11px] text-gray-500">
                            {char.activeSpec || char.characterClass} · Score:{' '}
                            {char.mythicScore && char.mythicScore > 0 ? char.mythicScore : 'N/A'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleReactivateCharacter(char.id, char.characterName)}
                          disabled={actionLoadingId === char.id}
                          className="btn btn-secondary text-xs px-3 py-1 flex items-center gap-1 disabled:opacity-50"
                        >
                          <span>↺</span> Reactivate
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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

      {/* ─── Character Details Modal ────────────────────────────────────── */}
      {detailsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="card-surface w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 p-6 space-y-5 shadow-2xl">
            {detailsLoading ? (
              <div className="py-12 text-center">
                <LoadingState message="Loading character details and dungeon runs..." />
              </div>
            ) : selectedCharDetails ? (
              <>
                {/* Modal Header */}
                <div className="flex items-start justify-between gap-4 border-b border-gray-800 pb-4">
                  <div className="flex items-center gap-3">
                    {selectedCharDetails.character.thumbnailUrl ? (
                      <img
                        src={selectedCharDetails.character.thumbnailUrl}
                        alt={selectedCharDetails.character.characterName}
                        className="w-14 h-14 rounded-full border-2 border-[var(--accent-lime)] object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-xl">
                        🛡️
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-lg font-bold"
                          style={{
                            color:
                              CLASS_COLORS[selectedCharDetails.character.characterClass || ''] || '#fff',
                          }}
                        >
                          {selectedCharDetails.character.characterName}
                        </span>
                        {selectedCharDetails.character.isMain && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                            ⭐ Main Character
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        {selectedCharDetails.character.realm} ({selectedCharDetails.character.region?.toUpperCase()}) ·{' '}
                        {selectedCharDetails.character.activeSpec || selectedCharDetails.character.characterClass}
                        {selectedCharDetails.character.itemLevel
                          ? ` · ilvl ${selectedCharDetails.character.itemLevel}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDetailsModalOpen(false)}
                    className="text-gray-400 hover:text-white text-lg p-1"
                  >
                    ✕
                  </button>
                </div>

                {/* Score & Progression Highlights */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-[#141221] border border-gray-800">
                    <span className="text-[10px] text-gray-400">Current Season M+</span>
                    <p className="text-xl font-mono font-bold text-[var(--accent-lime)]">
                      {selectedCharDetails.character.mythicScore && selectedCharDetails.character.mythicScore > 0 ? (
                        selectedCharDetails.character.mythicScore
                      ) : (
                        <span className="text-xs font-normal text-gray-400">Not available</span>
                      )}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[#141221] border border-gray-800">
                    <span className="text-[10px] text-gray-400">Tank Rating</span>
                    <p className="text-xl font-mono font-bold text-blue-400">
                      {selectedCharDetails.character.tankScore ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[#141221] border border-gray-800">
                    <span className="text-[10px] text-gray-400">Healer Rating</span>
                    <p className="text-xl font-mono font-bold text-emerald-400">
                      {selectedCharDetails.character.healerScore ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[#141221] border border-gray-800">
                    <span className="text-[10px] text-gray-400">DPS Rating</span>
                    <p className="text-xl font-mono font-bold text-purple-400">
                      {selectedCharDetails.character.dpsScore ?? 0}
                    </p>
                  </div>
                </div>

                {selectedCharDetails.character.raidProgression && (
                  <div className="p-3 rounded-lg bg-[#141221] border border-gray-800 text-xs">
                    <span className="text-gray-400">Raid Progression: </span>
                    <span className="text-white font-medium">
                      🏰 {selectedCharDetails.character.raidProgression}
                    </span>
                  </div>
                )}

                {/* Recent Dungeon Runs */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center justify-between">
                    <span>Recent Mythic+ Runs (Active Season)</span>
                    <span className="text-[10px] text-gray-400">
                      {selectedCharDetails.recentRuns?.length ?? 0} runs recorded
                    </span>
                  </h4>

                  {!selectedCharDetails.recentRuns || selectedCharDetails.recentRuns.length === 0 ? (
                    <p className="text-xs text-gray-500 py-3 text-center border border-dashed border-gray-800 rounded-lg">
                      No recent dungeon runs recorded in the active season.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {selectedCharDetails.recentRuns.map((run, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg border border-gray-800 bg-[#12101e] flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-semibold text-white">{run.dungeon}</span>
                            <span className="ml-2 font-mono text-[var(--accent-lime)] font-bold">
                              +{run.mythicLevel}
                            </span>
                            {run.numKeystoneUpgrades && run.numKeystoneUpgrades > 0 ? (
                              <span className="ml-1.5 text-[10px] text-amber-300">
                                {'★'.repeat(run.numKeystoneUpgrades)}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-right text-[11px] text-gray-400">
                            {run.score ? <span className="mr-3 font-mono text-purple-300">{run.score} pts</span> : null}
                            <span>{new Date(run.completedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer / Attribution & Links */}
                <div className="border-t border-gray-800 pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="text-[11px] text-gray-500">
                    {selectedCharDetails.attribution?.notice || 'Data provided by Raider.IO'}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedCharDetails.character.raiderioUrl && (
                      <a
                        href={selectedCharDetails.character.raiderioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                      >
                        <span>↗️</span> View on Raider.IO
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailsModalOpen(false)}
                      className="btn btn-cta text-xs px-4 py-1.5"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-6 text-center text-xs text-red-400">
                Failed to load character details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
