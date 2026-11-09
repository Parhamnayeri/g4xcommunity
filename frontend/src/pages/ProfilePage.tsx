import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../components/ui/LoadingState';
import {
  UserProfileResponse,
  ProfileUpdateRequest,
} from '../types/profileSettings';
import {
  fetchUserProfile,
  updateUserProfile,
  addWowCharacter,
  setMainCharacter,
  removeCharacter,
} from '../services/profileSettings';

export const ProfilePage: React.FC = () => {

  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<UserProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Profile Edit Form state
  const [displayName, setDisplayName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [telegramUsername, setTelegramUsername] = useState<string>('');
  const [whatsappNumber, setWhatsappNumber] = useState<string>('');
  const [savingProfile, setSavingProfile] = useState<boolean>(false);

  // New WoW Character Form state
  const [showAddChar, setShowAddChar] = useState<boolean>(false);
  const [charName, setCharName] = useState<string>('');
  const [charRealm, setCharRealm] = useState<string>('');
  const [charRegion, setCharRegion] = useState<string>('eu');
  const [charClass, setCharClass] = useState<string>('Warrior');
  const [charSpec, setCharSpec] = useState<string>('');
  const [charRole, setCharRole] = useState<string>('DPS');
  const [charActionLoading, setCharActionLoading] = useState<boolean>(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchUserProfile();
      if (res.success) {
        setData(res);
        setDisplayName(res.profile.displayName || '');
        setPhoneNumber(res.profile.phoneNumber || '');
        setTelegramUsername(res.profile.telegramUsername || '');
        setWhatsappNumber(res.profile.whatsappNumber || '');
      } else {
        setError('Failed to retrieve user profile data.');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // Client-side validations
    if (displayName.trim().length > 50) {
      setError('Display name must not exceed 50 characters.');
      return;
    }
    if (phoneNumber.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(phoneNumber.trim())) {
      setError('Phone number must be between 7 and 20 digits.');
      return;
    }
    if (telegramUsername.trim()) {
      const cleanedTg = telegramUsername.trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanedTg)) {
        setError('Telegram username must be 3-32 characters alphanumeric or underscore.');
        return;
      }
    }
    if (whatsappNumber.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(whatsappNumber.trim())) {
      setError('WhatsApp number must be between 7 and 20 digits.');
      return;
    }

    setSavingProfile(true);
    try {
      const payload: ProfileUpdateRequest = {
        displayName: displayName.trim() || null,
        phoneNumber: phoneNumber.trim() || null,
        telegramUsername: telegramUsername.trim() || null,
        whatsappNumber: whatsappNumber.trim() || null,
      };

      const res = await updateUserProfile(payload);
      if (res.success) {
        setSuccessMsg('Profile contact information updated successfully.');
        await loadProfile();
      } else {
        setError('Failed to update profile.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAddCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!charName.trim() || !charRealm.trim()) {
      setError('Character name and realm are required.');
      return;
    }
    setCharActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await addWowCharacter({
        name: charName.trim(),
        realm: charRealm.trim(),
        region: charRegion.toLowerCase(),
        class: charClass,
        spec: charSpec.trim() || undefined,
        role: charRole,
      });
      setSuccessMsg(`Character ${charName} added successfully.`);
      setShowAddChar(false);
      setCharName('');
      setCharRealm('');
      await loadProfile();
    } catch (err: any) {
      setError(err.message || 'Failed to add character.');
    } finally {
      setCharActionLoading(false);
    }
  };

  const handleSetMain = async (charId: number) => {
    setCharActionLoading(true);
    setError(null);
    try {
      await setMainCharacter(charId);
      setSuccessMsg('Main character updated.');
      await loadProfile();
    } catch (err: any) {
      setError(err.message || 'Failed to set main character.');
    } finally {
      setCharActionLoading(false);
    }
  };

  const handleRemoveChar = async (charId: number) => {
    if (!window.confirm('Are you sure you want to remove this character?')) return;
    setCharActionLoading(true);
    setError(null);
    try {
      await removeCharacter(charId);
      setSuccessMsg('Character removed.');
      await loadProfile();
    } catch (err: any) {
      setError(err.message || 'Failed to remove character.');
    } finally {
      setCharActionLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading user profile and credentials..." />;
  }

  if (!data) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="text-red-400 mb-4">{error || 'Unable to load profile.'}</p>
        <button onClick={loadProfile} className="btn btn-cta">
          Retry
        </button>
      </div>
    );
  }

  const { profile, approvedGames, pilotVerification, latestApplication, characters, activitySummary, discordLinkage } =
    data;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <img
            src={profile.avatarUrl}
            alt={profile.username}
            className="w-20 h-20 rounded-full border-2 border-[var(--accent-lime)] object-cover shadow-lg"
          />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">
                {profile.displayName || profile.username}
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {profile.isActive ? 'Active Member' : 'Inactive'}
              </span>
              {profile.roles.map((r) => (
                <span
                  key={r}
                  className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-900/40 text-purple-300 border border-purple-700/50 uppercase"
                >
                  {r}
                </span>
              ))}
            </div>
            <p className="text-sm text-gray-400 mt-1">
              Discord: <span className="text-gray-200 font-mono">@{profile.username}</span> ({profile.discordId})
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Member for {activitySummary.joinedDaysAgo} days &bull; Joined{' '}
              {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <a href="/wallet" className="btn btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
            💳 Wallet &amp; Balances
          </a>
          <a href="/booster/settings" className="btn btn-cta text-xs px-3 py-2 flex items-center gap-1.5">
            ⚙️ Booster Hub &amp; Settings
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

      {/* Activity Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-xs text-gray-400 uppercase font-semibold">Active Assignments</p>
          <p className="text-2xl font-bold text-[var(--accent-lime)] mt-1">
            {activitySummary.activeAssignmentsCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-xs text-gray-400 uppercase font-semibold">Completed Runs</p>
          <p className="text-2xl font-bold text-white mt-1">
            {activitySummary.completedRunsCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-xs text-gray-400 uppercase font-semibold">Associated Orders</p>
          <p className="text-2xl font-bold text-white mt-1">
            {activitySummary.ordersCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-xs text-gray-400 uppercase font-semibold">Advertiser Tier</p>
          <p className="text-2xl font-bold text-purple-300 mt-1 uppercase">
            {profile.advertiserRank || 'Standard'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Editable Contact & Identity Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)]">
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <span>👤</span> Contact &amp; Public Profile
            </h2>
            <p className="text-xs text-gray-400 mb-6">
              Update your direct communications contact details for order coordination and administrative notices.
              Authoritative credentials (Discord ID, security roles, financial ledger) cannot be modified.
            </p>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Display Name</label>
                <input
                  type="text"
                  maxLength={50}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Commander Nova"
                  className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                />
                <span className="text-[11px] text-gray-500">Maximum 50 characters</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+98 912 000 0000"
                    className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                  />
                  <span className="text-[11px] text-gray-500">7-20 digits with optional +</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    WhatsApp Number
                  </label>
                  <input
                    type="tel"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+98 912 000 0000"
                    className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                  />
                  <span className="text-[11px] text-gray-500">Used for urgent notifications</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Telegram Username
                </label>
                <div className="flex items-center">
                  <span className="bg-[#2a243d] border border-r-0 border-[var(--border-subtle)] px-3 py-2 rounded-l-lg text-sm text-gray-400">
                    @
                  </span>
                  <input
                    type="text"
                    value={telegramUsername.replace(/^@/, '')}
                    onChange={(e) => setTelegramUsername(e.target.value)}
                    placeholder="username"
                    className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded-r-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent-lime)]"
                  />
                </div>
                <span className="text-[11px] text-gray-500">3-32 alphanumeric characters</span>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="btn btn-cta px-6 py-2 text-sm flex items-center gap-2"
                >
                  {savingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>

          {/* WoW Characters Section */}
          <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>⚔️</span> World of Warcraft Characters
                </h2>
                <p className="text-xs text-gray-400">
                  Linked characters for Mythic+ rosters, raid lockouts and key ownership verification.
                </p>
              </div>
              <button
                onClick={() => setShowAddChar(!showAddChar)}
                className="btn btn-secondary text-xs px-3 py-1.5"
              >
                {showAddChar ? 'Cancel' : '+ Add Character'}
              </button>
            </div>

            {/* Add Character Inline Form */}
            {showAddChar && (
              <form
                onSubmit={handleAddCharacter}
                className="mb-6 p-4 rounded-lg bg-[#181427] border border-[var(--primary-purple)]/40 space-y-3"
              >
                <h3 className="text-xs font-bold uppercase text-[var(--accent-lime)]">
                  Register New WoW Character
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Character Name</label>
                    <input
                      type="text"
                      required
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      placeholder="e.g. Sylvanas"
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Realm</label>
                    <input
                      type="text"
                      required
                      value={charRealm}
                      onChange={(e) => setCharRealm(e.target.value)}
                      placeholder="e.g. Kazzak"
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Region</label>
                    <select
                      value={charRegion}
                      onChange={(e) => setCharRegion(e.target.value)}
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="eu">EU (Europe)</option>
                      <option value="us">US (Americas)</option>
                      <option value="kr">KR (Korea)</option>
                      <option value="tw">TW (Taiwan)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Class</label>
                    <select
                      value={charClass}
                      onChange={(e) => setCharClass(e.target.value)}
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    >
                      {[
                        'Death Knight',
                        'Demon Hunter',
                        'Druid',
                        'Evoker',
                        'Hunter',
                        'Mage',
                        'Monk',
                        'Paladin',
                        'Priest',
                        'Rogue',
                        'Shaman',
                        'Warlock',
                        'Warrior',
                      ].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Specialization</label>
                    <input
                      type="text"
                      value={charSpec}
                      onChange={(e) => setCharSpec(e.target.value)}
                      placeholder="e.g. Protection"
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Roster Role</label>
                    <select
                      value={charRole}
                      onChange={(e) => setCharRole(e.target.value)}
                      className="w-full bg-[#1e1b2e] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="TANK">Tank</option>
                      <option value="HEALER">Healer</option>
                      <option value="DPS">DPS</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={charActionLoading}
                    className="btn btn-cta text-xs px-4 py-1.5"
                  >
                    {charActionLoading ? 'Saving...' : 'Add Character'}
                  </button>
                </div>
              </form>
            )}

            {/* Character Table */}
            {characters.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-700 rounded-lg">
                No WoW characters linked yet. Click "+ Add Character" to register your main raider.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400">
                      <th className="py-2.5 px-3">Character</th>
                      <th className="py-2.5 px-3">Realm / Region</th>
                      <th className="py-2.5 px-3">Class / Spec</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3">iLvl</th>
                      <th className="py-2.5 px-3">Mythic Score</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {characters.map((char) => (
                      <tr key={char.id} className="hover:bg-[#1f1b31]">
                        <td className="py-3 px-3 font-semibold text-white flex items-center gap-2">
                          {char.name}
                          {char.isMain && (
                            <span className="bg-[var(--accent-lime)] text-black text-[10px] font-extrabold px-1.5 py-0.5 rounded">
                              MAIN
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-300">
                          {char.realm} ({char.region.toUpperCase()})
                        </td>
                        <td className="py-3 px-3 text-gray-300">
                          {char.spec ? `${char.spec} ` : ''}
                          {char.class}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              char.role === 'TANK'
                                ? 'bg-blue-900/40 text-blue-300'
                                : char.role === 'HEALER'
                                ? 'bg-green-900/40 text-green-300'
                                : 'bg-red-900/40 text-red-300'
                            }`}
                          >
                            {char.role}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-gray-200">
                          {char.itemLevel || '—'}
                        </td>
                        <td className="py-3 px-3 font-mono text-[var(--accent-lime)] font-bold">
                          {char.mythicScore || '—'}
                        </td>
                        <td className="py-3 px-3 text-right space-x-2">
                          {!char.isMain && (
                            <button
                              onClick={() => handleSetMain(char.id)}
                              disabled={charActionLoading}
                              className="text-[11px] text-purple-300 hover:text-white underline"
                            >
                              Set Main
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveChar(char.id)}
                            disabled={charActionLoading}
                            className="text-[11px] text-red-400 hover:text-red-200"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Approvals, Qualifications & Discord Sync */}
        <div className="space-y-6">
          {/* Discord OAuth Linkage Status */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)]">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <span>💬</span> Discord OAuth Linkage
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-gray-800">
                <span className="text-gray-400">Connection State</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  ● Connected
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-800">
                <span className="text-gray-400">Discord User</span>
                <span className="text-white font-mono">@{discordLinkage.username}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-800">
                <span className="text-gray-400">Discord ID</span>
                <span className="text-gray-300 font-mono">{discordLinkage.discordId}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-400">Community Guild</span>
                <span className="text-gray-300">{discordLinkage.serverName}</span>
              </div>
            </div>
          </div>

          {/* Pilot Verification Card */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)]">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <span>🛡️</span> Pilot Identity Verification
            </h3>
            {pilotVerification ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Verification Status</span>
                  <span
                    className={`font-semibold capitalize ${
                      pilotVerification.status === 'approved'
                        ? 'text-emerald-400'
                        : pilotVerification.status === 'pending'
                        ? 'text-amber-400'
                        : 'text-red-400'
                    }`}
                  >
                    {pilotVerification.status}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Primary Game</span>
                  <span className="text-white font-mono uppercase">{pilotVerification.gameSlug}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Submitted</span>
                  <span className="text-gray-400">
                    {new Date(pilotVerification.submittedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-400 py-2">
                No active pilot verification on file. Apply through the Booster portal to qualify for piloted carries.
              </div>
            )}
          </div>

          {/* Approved Games & Qualifications */}
          <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)]">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <span>🎮</span> Approved Games &amp; Services
            </h3>
            {approvedGames.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">
                You have not yet received verified game approvals. Submit a Booster Application to get cleared.
              </p>
            ) : (
              <div className="space-y-2">
                {approvedGames.map((game) => (
                  <div
                    key={game.gameSlug}
                    className="p-2.5 rounded-lg bg-[#181427] border border-gray-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-white">{game.displayName}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{game.gameSlug}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      APPROVED
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Latest Application Status */}
          {latestApplication && (
            <div className="card-surface p-5 rounded-xl border border-[var(--border-subtle)]">
              <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                <span>📋</span> Application Status
              </h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Category</span>
                  <span className="text-white capitalize">{latestApplication.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span
                    className={`font-semibold capitalize ${
                      latestApplication.status === 'approved'
                        ? 'text-emerald-400'
                        : latestApplication.status === 'pending'
                        ? 'text-amber-400'
                        : 'text-red-400'
                    }`}
                  >
                    {latestApplication.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Filed On</span>
                  <span className="text-gray-400">
                    {new Date(latestApplication.submittedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default ProfilePage;
