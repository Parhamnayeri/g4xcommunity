import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../components/ui/LoadingState';
import {
  UserSettings,
  RosterRole,
  BoosterAvailability,
  PreferredContact,
  BoosterPortalDataResponse,
} from '../types/profileSettings';
import {
  fetchUserSettings,
  updateUserSettings,
  fetchBoosterPortalData,
} from '../services/profileSettings';

export const BoosterSettingsPage: React.FC = () => {
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
      setError(err.message || 'Error loading booster preferences and order queues.');
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

  if (loading) {
    return <LoadingState message="Loading booster portal and preferences..." />;
  }

  const boosterInfo = portalData?.boosterInfo;
  const assignedOrders = portalData?.assignedOrders || [];
  const availableQueue = portalData?.availableQueue || [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Booster Hub &amp; Settings</h1>
            <span
              className={`badge ${
                settings.availability === 'AVAILABLE'
                  ? 'badge-green'
                  : settings.availability === 'BUSY'
                  ? 'badge-amber'
                  : 'badge-danger'
              }`}
            >
              ● {settings.availability}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Configure your active roster role, availability alerts, Discord DM notifications and view your
            carry assignments.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <a href="/profile" className="btn btn-cta text-xs px-3.5 py-2 flex items-center gap-1.5">
            🛡️ KYC &amp; Pilot Application
          </a>
          <a href="/withdraw" className="btn btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5">
            💸 Booster Withdrawals
          </a>
          <a href="/profile" className="btn btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5">
            👤 Member Profile
          </a>
        </div>
      </div>

      {/* Notifications */}
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

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Roster Preferences & Discord DM Notifications */}
        <div className="lg:col-span-2 space-y-6">
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
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                    Roster Specialization
                  </label>
                  <select
                    value={settings.rosterRole}
                    onChange={(e) =>
                      setSettings({ ...settings, rosterRole: e.target.value as RosterRole })
                    }
                    className="input"
                  >
                    <option value="TANK">🛡️ Tank (Defense Specialist)</option>
                    <option value="HEALER">💚 Healer (Support Specialist)</option>
                    <option value="DPS">⚔️ DPS (Damage Specialist)</option>
                    <option value="ANY">🔄 Any / Flex</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
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
                    className="input"
                  >
                    <option value="AVAILABLE">🟢 Available (Ready for carry invitations)</option>
                    <option value="BUSY">🟡 Busy (In-run / temporarily unavailable)</option>
                    <option value="AWAY">🔴 Away (Offline / not taking orders)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
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
                    className="input"
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
                      style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)', cursor: 'pointer' }}
                    />
                    <span className="text-xs text-gray-300 font-semibold">
                      Visible in available squad rosters
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Discord & Notification Preferences Card */}
            <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🔔</span> Discord Notification Preferences
              </h2>
              <p className="text-xs text-gray-400">
                Choose which automated notifications are dispatched to your direct Discord messages by the G4X Bot.
              </p>

              <div className="space-y-3 pt-2">
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.06)] cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.orderAssignedDm}
                    onChange={(e) =>
                      setSettings({ ...settings, orderAssignedDm: e.target.checked })
                    }
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)', cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">Order Assigned DMs</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Receive an instant direct message when you or your premade team is assigned to a customer order.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.06)] cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.orderCompletedDm}
                    onChange={(e) =>
                      setSettings({ ...settings, orderCompletedDm: e.target.checked })
                    }
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)', cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">Order Completed &amp; Verified DMs</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Receive confirmation when a run proof is accepted and funds are staged in escrow.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.06)] cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.payoutAlertsDm}
                    onChange={(e) =>
                      setSettings({ ...settings, payoutAlertsDm: e.target.checked })
                    }
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)', cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">Payout &amp; Withdrawal Alerts</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Direct alerts for withdrawal quotes, review updates and payout execution notices.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.06)] cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.announcementDm}
                    onChange={(e) =>
                      setSettings({ ...settings, announcementDm: e.target.checked })
                    }
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)', cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">Platform Announcements</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
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

          {/* Assigned Orders Queue */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🎯</span> Your Active Assigned Orders
            </h2>
            {assignedOrders.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-state-icon">🎯</div>
                <div>No active orders assigned to you currently.</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)' }}>Check the available queue below or on Discord execution channels.</div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Title / Service</th>
                      <th>Game</th>
                      <th>Assigned Role</th>
                      <th>Order Status</th>
                      <th>Reward Pool</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedOrders.map((ord) => (
                      <tr key={ord.assignmentId}>
                        <td style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontWeight: 700 }}>
                          #{ord.orderId}
                        </td>
                        <td style={{ fontWeight: 600, color: '#ffffff' }}>{ord.orderTitle}</td>
                        <td>
                          <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                            {ord.gameSlug}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-blue">
                            {ord.assignedRole}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${ord.status === 'COMPLETED' ? 'badge-green' : 'badge-amber'}`}>
                            {ord.status}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: '#ffffff', fontWeight: 600 }}>
                          ${(ord.totalAmountUsdCents / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Available Queue with Mythic+ Roster Requirements */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>📋</span> Available Orders &amp; Mythic+ Roster Queue
              </h2>
              <p className="text-xs text-gray-400">
                WoW Mythic+ runs strictly require exactly 1 Tank, 1 Healer, 2 DPS, and a distinct Key Owner.
                Premade teams are assigned atomically.
              </p>
            </div>

            {availableQueue.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-state-icon">📋</div>
                <div>No unassigned orders in the public queue right now.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {availableQueue.map((order) => {
                  const rf = order.rosterFulfillment;
                  return (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.08)] space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[var(--accent-yellow)]">
                              #{order.id}
                            </span>
                            <span className="font-semibold text-white text-sm">{order.title}</span>
                            <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                              {order.gameSlug}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            Order Value: ${(order.totalAmountUsdCents / 100).toFixed(2)} USD
                          </p>
                        </div>
                        <span
                          className={`badge ${
                            rf.isFull ? 'badge-green' : 'badge-amber'
                          }`}
                        >
                          {rf.isFull ? 'Roster Complete' : `${rf.totalFilled}/4 Boosters Filled`}
                        </span>
                      </div>

                      {/* Roster composition slots */}
                      <div className="grid grid-cols-4 gap-2 pt-1 text-center text-xs">
                        <div
                          className={`p-2.5 rounded-lg border ${
                            rf.filledTanks >= 1
                              ? 'bg-blue-900/30 border-blue-500/40 text-blue-300'
                              : 'bg-black/30 border-[rgba(255,255,255,0.06)] text-gray-500'
                          }`}
                        >
                          <p className="text-[10px] uppercase font-bold tracking-wider">Tank</p>
                          <p className="font-mono text-xs font-bold mt-0.5">{rf.filledTanks}/1</p>
                        </div>

                        <div
                          className={`p-2.5 rounded-lg border ${
                            rf.filledHealers >= 1
                              ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-300'
                              : 'bg-black/30 border-[rgba(255,255,255,0.06)] text-gray-500'
                          }`}
                        >
                          <p className="text-[10px] uppercase font-bold tracking-wider">Healer</p>
                          <p className="font-mono text-xs font-bold mt-0.5">{rf.filledHealers}/1</p>
                        </div>

                        <div
                          className={`p-2.5 rounded-lg border ${
                            rf.filledDps >= 2
                              ? 'bg-purple-900/30 border-purple-500/40 text-purple-300'
                              : 'bg-black/30 border-[rgba(255,255,255,0.06)] text-gray-500'
                          }`}
                        >
                          <p className="text-[10px] uppercase font-bold tracking-wider">DPS</p>
                          <p className="font-mono text-xs font-bold mt-0.5">{rf.filledDps}/2</p>
                        </div>

                        <div
                          className={`p-2.5 rounded-lg border ${
                            rf.hasKeyOwner
                              ? 'bg-amber-900/30 border-amber-500/40 text-amber-300'
                              : 'bg-black/30 border-[rgba(255,255,255,0.06)] text-gray-500'
                          }`}
                        >
                          <p className="text-[10px] uppercase font-bold tracking-wider">Key Owner</p>
                          <p className="font-mono text-xs font-bold mt-0.5">
                            {rf.hasKeyOwner ? 'Verified' : 'Pending'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col): Booster Status & Discord OAuth Linkage */}
        <div className="space-y-6">
          {/* Booster Identity Card */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>🎖️</span> Booster Credentials
            </h3>
            {boosterInfo ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Pilot Verified</span>
                  <span
                    className={`badge ${
                      boosterInfo.pilotVerified ? 'badge-green' : 'badge-secondary'
                    }`}
                  >
                    {boosterInfo.pilotVerified ? '✓ Verified Pilot' : 'Self-Play Only'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Roster Role</span>
                  <span className="text-[var(--accent-yellow)] font-bold">{boosterInfo.rosterRole}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Availability</span>
                  <span className="text-white font-semibold">{boosterInfo.availability}</span>
                </div>
                <div className="pt-2">
                  <span className="text-gray-400 block mb-2 font-semibold">Cleared Games:</span>
                  {boosterInfo.approvedGames.length === 0 ? (
                    <span className="text-gray-500">No games cleared yet</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {boosterInfo.approvedGames.map((g) => (
                        <span
                          key={g}
                          className="badge badge-purple"
                          style={{ fontSize: '0.65rem' }}
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Loading credentials...</p>
            )}
          </div>

          {/* Discord Connection Status */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💬</span> Discord Linkage Status
            </h3>
            <p className="text-[11px] text-gray-400">
              Identity and server roles are synchronized via official Discord OAuth2. Password and bot token
              credentials are never requested or stored.
            </p>
            {discordInfo && (
              <div className="space-y-2 text-xs pt-1">
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Status</span>
                  <span className="badge badge-green">● Linked &amp; Active</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Discord ID</span>
                  <span className="text-gray-300 font-mono">{discordInfo.discordId}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Username</span>
                  <span className="text-[var(--accent-yellow)] font-mono">@{discordInfo.username}</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-gray-400">Server</span>
                  <span className="text-gray-300">{discordInfo.serverName}</span>
                </div>
              </div>
            )}
          </div>

          {/* Earnings & Financial Accounting */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)] space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💰</span> Booster Earnings &amp; Payouts
            </h3>
            <p className="text-[11px] text-gray-400">
              All financial transactions, escrow releases and booster payout requests are audited and settled
              through the Finance V2 double-entry accounting engine.
            </p>
            <div className="pt-2 space-y-2">
              <a
                href="/withdraw"
                className="btn btn-cta text-xs w-full py-2 flex items-center justify-center gap-2"
              >
                Request Withdrawal &rarr;
              </a>
              <a
                href="/wallet"
                className="btn btn-secondary text-xs w-full py-2 flex items-center justify-center gap-2"
              >
                View Financial Ledger &rarr;
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default BoosterSettingsPage;
