import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
  submitRoleApplication,
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

  // KYC / Role Application Form state
  const [showKycModal, setShowKycModal] = useState<boolean>(false);
  const [kycCategory, setKycCategory] = useState<'booster' | 'pilot' | 'advertiser' | 'exchanger'>('booster');
  const [kycGame, setKycGame] = useState<string>('all');
  const [kycExperience, setKycExperience] = useState<string>('');
  const [kycRaiderio, setKycRaiderio] = useState<string>('');
  const [kycVpn, setKycVpn] = useState<boolean>(true);
  const [kycNotes, setKycNotes] = useState<string>('');
  const [submittingKyc, setSubmittingKyc] = useState<boolean>(false);
  const [kycFeedback, setKycFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycExperience.trim()) {
      setKycFeedback({ text: 'Please detail your experience and background.', type: 'error' });
      return;
    }
    setSubmittingKyc(true);
    setKycFeedback(null);
    try {
      const res = await submitRoleApplication({
        category: kycCategory,
        gameSlug: kycGame === 'all' ? undefined : kycGame,
        experience: kycExperience.trim(),
        raiderioUrl: kycRaiderio.trim() || undefined,
        vpnAvailability: kycVpn,
        notes: kycNotes.trim() || undefined,
      });
      if (res.success) {
        const requiresKyc = ['pilot', 'advertiser', 'exchanger'].includes(kycCategory);
        setKycFeedback({
          text: requiresKyc
            ? `Application as ${kycCategory.toUpperCase()} submitted! A direct KYC link was dispatched to your Discord DMs. You can also verify at /profile/kyc.`
            : `Booster application submitted for management review! No KYC required for standard booster carries.`,
          type: 'success',
        });
        setTimeout(() => {
          setShowKycModal(false);
          loadProfile();
        }, 2000);
      }
    } catch (err: any) {
      setKycFeedback({ text: err.message || 'Failed to submit application', type: 'error' });
    } finally {
      setSubmittingKyc(false);
    }
  };

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

  const isKycVerified = pilotVerification?.status === 'approved' || latestApplication?.identityStatus === 'verified';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="card-surface p-6 rounded-xl border border-[var(--border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <img
            src={profile.avatarUrl}
            alt={profile.username}
            className="w-20 h-20 rounded-full border-2 border-[var(--accent-yellow)] object-cover shadow-lg"
            style={{ width: '80px', height: '80px', minWidth: '80px', minHeight: '80px', borderRadius: '50%' }}
          />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">
                {profile.displayName || profile.username}
              </h1>
              <span className={`badge ${profile.isActive ? 'badge-green' : 'badge-danger'}`}>
                {profile.isActive ? 'Active Member' : 'Inactive'}
              </span>
              {profile.roles.map((r) => (
                <span key={r} className="badge badge-purple">
                  {r}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
              <span className="px-2.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mono text-[var(--accent-yellow)] font-semibold">
                @{profile.username}
              </span>
              <span className="px-2 py-0.5 rounded bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] font-mono text-gray-400">
                {profile.discordId}
              </span>
              <span className="text-gray-400 text-xs ml-1">
                Member for {activitySummary.joinedDaysAgo} days &bull; Joined{' '}
                {new Date(profile.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={() => {
              setShowKycModal(true);
              setKycFeedback(null);
            }}
            className="btn btn-cta text-xs px-3.5 py-2 flex items-center gap-1.5"
          >
            ⭐ Apply for Role / KYC
          </button>
          <a href="/wallet" className="btn btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5">
            💳 Wallet &amp; Balances
          </a>
          <a href="/booster/settings" className="btn btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5">
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
          <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider">Active Assignments</p>
          <p className="text-2xl font-bold text-[var(--accent-yellow)] mt-1.5">
            {activitySummary.activeAssignmentsCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider">Completed Runs</p>
          <p className="text-2xl font-bold text-white mt-1.5">
            {activitySummary.completedRunsCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider">Associated Orders</p>
          <p className="text-2xl font-bold text-white mt-1.5">
            {activitySummary.ordersCount}
          </p>
        </div>
        <div className="card-surface p-4 rounded-xl border border-[var(--border-subtle)] text-center">
          <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider">Advertiser Tier</p>
          <p className="text-2xl font-bold text-[var(--primary-purple)] mt-1.5 uppercase">
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  maxLength={50}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Commander Nova"
                  className="input"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">Maximum 50 characters</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+98 912 000 0000"
                    className="input"
                  />
                  <span className="text-[11px] text-gray-500 mt-1 block">7-20 digits with optional +</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                    WhatsApp Number
                  </label>
                  <input
                    type="tel"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+98 912 000 0000"
                    className="input"
                  />
                  <span className="text-[11px] text-gray-500 mt-1 block">Used for urgent notifications</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                  Telegram Username
                </label>
                <div className="flex items-center">
                  <span className="bg-[#181B24] border border-r-0 border-[var(--border-subtle)] px-3 py-2 rounded-l-lg text-sm text-gray-400 font-mono">
                    @
                  </span>
                  <input
                    type="text"
                    value={telegramUsername.replace(/^@/, '')}
                    onChange={(e) => setTelegramUsername(e.target.value)}
                    placeholder="username"
                    className="input rounded-l-none"
                  />
                </div>
                <span className="text-[11px] text-gray-500 mt-1 block">3-32 alphanumeric characters</span>
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
                className="mb-6 p-4 rounded-xl bg-[#13151C] border border-[rgba(255,255,255,0.08)] space-y-4"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-yellow)' }}>
                  Register New WoW Character
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Character Name</label>
                    <input
                      type="text"
                      required
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      placeholder="e.g. Sylvanas"
                      className="input text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Realm</label>
                    <input
                      type="text"
                      required
                      value={charRealm}
                      onChange={(e) => setCharRealm(e.target.value)}
                      placeholder="e.g. Kazzak"
                      className="input text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Region</label>
                    <select
                      value={charRegion}
                      onChange={(e) => setCharRegion(e.target.value)}
                      className="input text-xs"
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
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Class</label>
                    <select
                      value={charClass}
                      onChange={(e) => setCharClass(e.target.value)}
                      className="input text-xs"
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
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Specialization</label>
                    <input
                      type="text"
                      value={charSpec}
                      onChange={(e) => setCharSpec(e.target.value)}
                      placeholder="e.g. Protection"
                      className="input text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Roster Role</label>
                    <select
                      value={charRole}
                      onChange={(e) => setCharRole(e.target.value)}
                      className="input text-xs"
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
              <div className="empty-state-box">
                <div className="empty-state-icon">⚔️</div>
                <div>No WoW characters linked yet.</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)' }}>Click "+ Add Character" to register your main raider.</div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Character</th>
                      <th>Realm / Region</th>
                      <th>Class / Spec</th>
                      <th>Role</th>
                      <th>iLvl</th>
                      <th>Mythic Score</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {characters.map((char) => (
                      <tr key={char.id}>
                        <td style={{ fontWeight: 600, color: '#ffffff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{char.name}</span>
                            {char.isMain && (
                              <span className="badge badge-yellow" style={{ fontSize: '0.65rem' }}>
                                MAIN
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {char.realm} ({char.region.toUpperCase()})
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {char.spec ? `${char.spec} ` : ''}
                          {char.class}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              char.role === 'TANK'
                                ? 'badge-blue'
                                : char.role === 'HEALER'
                                ? 'badge-green'
                                : 'badge-danger'
                            }`}
                          >
                            {char.role}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {char.itemLevel || '—'}
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontWeight: 700 }}>
                          {char.mythicScore || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                            {!char.isMain && (
                              <button
                                type="button"
                                onClick={() => handleSetMain(char.id)}
                                disabled={charActionLoading}
                                className="btn btn-secondary btn-xs"
                              >
                                Set Main
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveChar(char.id)}
                              disabled={charActionLoading}
                              className="btn btn-danger btn-xs"
                            >
                              Remove
                            </button>
                          </div>
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
              <div className="flex justify-between py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                <span className="text-gray-400">Connection State</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  ● Connected
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                <span className="text-gray-400">Discord User</span>
                <span className="text-[var(--accent-yellow)] font-mono">@{discordLinkage.username}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                <span className="text-gray-400">Discord ID</span>
                <span className="text-gray-300 font-mono">{discordLinkage.discordId}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-400">Community Guild</span>
                <span className="text-gray-300">{discordLinkage.serverName}</span>
              </div>
            </div>
          </div>

          {/* Identity Verification (KYC) Card */}
          <div className={`card-surface p-5 rounded-xl border ${isKycVerified ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-[var(--border-subtle)]'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🪪</span> Identity Verification (KYC)
              </h3>
              {isKycVerified ? (
                <span className="badge badge-green">✓ Verified</span>
              ) : pilotVerification?.status === 'pending' || latestApplication?.identityStatus === 'awaiting_submission' ? (
                <span className="badge badge-amber">⏳ In Review</span>
              ) : pilotVerification?.status === 'rejected' ? (
                <span className="badge badge-danger">✕ Rejected</span>
              ) : (
                <span className="badge badge-secondary">Unverified</span>
              )}
            </div>

            {isKycVerified ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Single-Verification</span>
                  <span className="text-emerald-400 font-bold font-mono">COMPLETE &amp; ACTIVE</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Eligibility Scope</span>
                  <span className="text-purple-300 font-medium">Pilot, Exchanger, Advertiser</span>
                </div>
                {pilotVerification?.submittedAt && (
                  <div className="flex justify-between py-1.5">
                    <span className="text-gray-400">Verified Since</span>
                    <span className="text-gray-400">
                      {new Date(pilotVerification.submittedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                  <span className="text-[11px] text-emerald-300/80">Zero redundant uploads required</span>
                  <Link to="/profile/kyc" className="text-xs text-[var(--accent-yellow)] hover:underline font-semibold flex items-center gap-1">
                    Manage Identity &rarr;
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-gray-400 leading-relaxed">
                  {pilotVerification?.status === 'pending'
                    ? 'Your verification documents are currently under review by G4X staff.'
                    : 'Verify your identity once to qualify for Piloted Carries, P2P Exchanger escrow, and Advertiser operations across all platform games.'}
                </p>
                <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Universal Single-Verification</span>
                  <Link to="/profile/kyc" className="btn btn-cta btn-xs flex items-center gap-1">
                    {pilotVerification?.status === 'pending' ? 'View Status &rarr;' : 'Complete KYC &rarr;'}
                  </Link>
                </div>
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
                    className="p-2.5 rounded-lg bg-[#181B24] border border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-white">{game.displayName}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{game.gameSlug}</p>
                    </div>
                    <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
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
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Category</span>
                  <span className="text-white capitalize">{latestApplication.category}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[rgba(255,255,255,0.06)]">
                  <span className="text-gray-400">Status</span>
                  <span
                    className={`badge ${
                      latestApplication.status === 'approved'
                        ? 'badge-green'
                        : latestApplication.status === 'pending'
                        ? 'badge-amber'
                        : 'badge-danger'
                    }`}
                  >
                    {latestApplication.status}
                  </span>
                </div>
                {['pilot', 'advertiser', 'exchanger'].includes(latestApplication.category) && (
                  <div className="flex justify-between py-1 border-b border-[rgba(255,255,255,0.06)]">
                    <span className="text-gray-400">KYC Requirement</span>
                    <span
                      className={`badge ${
                        latestApplication.identityStatus === 'verified'
                          ? 'badge-green'
                          : latestApplication.identityStatus === 'rejected'
                          ? 'badge-danger'
                          : 'badge-purple'
                      }`}
                    >
                      {latestApplication.identityStatus === 'awaiting_submission'
                        ? 'Pending Submission'
                        : latestApplication.identityStatus || 'Required'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1">
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

      {/* KYC / Role Application Modal */}
      {showKycModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowKycModal(false)}>
          <div
            className="studio-modal-card studio-modal-card-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="studio-modal-header">
              <div>
                <h3>⭐ Apply for Community Role / KYC</h3>
                <p>
                  Boosters apply globally across all platform games (no KYC required). Pilot, Advertiser, and Exchanger applications register mandatory identity verification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowKycModal(false)}
                className="studio-modal-close"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleKycSubmit}>
              <div className="studio-modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label>Role Category *</label>
                    <select
                      className="input"
                      value={kycCategory}
                      onChange={(e) => setKycCategory(e.target.value as any)}
                    >
                      <option value="booster">Booster (Standard Carry — No KYC Required)</option>
                      <option value="pilot">Pilot Booster (Account Sharing — Mandatory KYC)</option>
                      <option value="advertiser">Advertiser (Sales &amp; Growth — Mandatory KYC)</option>
                      <option value="exchanger">Exchanger (Currency Trading — Mandatory KYC)</option>
                    </select>
                  </div>

                  <div>
                    <label>Game Scope</label>
                    <select
                      className="input"
                      value={kycGame}
                      onChange={(e) => setKycGame(e.target.value)}
                    >
                      <option value="all">Universal / All Supported Games</option>
                      <option value="wow_midnight">World of Warcraft: Midnight</option>
                      <option value="wow_classic_tbc">WoW Classic TBC</option>
                      <option value="poe2">Path of Exile 2</option>
                      <option value="aion_2">Aion 2</option>
                      <option value="escape_from_tarkov">Escape from Tarkov</option>
                    </select>
                    {['booster', 'pilot'].includes(kycCategory) && (
                      <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px', marginBottom: 0 }}>
                        ✦ Booster &amp; Pilot approvals are platform-wide. Universal applies to all games.
                      </p>
                    )}
                  </div>
                </div>

                {isKycVerified && ['pilot', 'advertiser', 'exchanger'].includes(kycCategory) && (
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      color: '#a7f3d0',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>✓</span>
                    <span>
                      <strong>Identity Verified (KYC Complete):</strong> Your identity is verified on file. This application automatically reuses your existing KYC approval with zero redundant uploads.
                    </span>
                  </div>
                )}

                <div>
                  <label>Raider.io / WarcraftLogs / Armory Profile Link</label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://raider.io/characters/eu/..."
                    value={kycRaiderio}
                    onChange={(e) => setKycRaiderio(e.target.value)}
                  />
                </div>

                <div>
                  <label>Gaming Experience & Character Qualifications *</label>
                  <textarea
                    className="input"
                    rows={3}
                    required
                    placeholder="Describe your active specs, Mythic rating (e.g. 3200+ IO), CE raid history, tournament experience..."
                    value={kycExperience}
                    onChange={(e) => setKycExperience(e.target.value)}
                  />
                </div>

                {kycCategory === 'pilot' && (
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: 'rgba(139, 92, 246, 0.1)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '10px',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={kycVpn}
                        onChange={(e) => setKycVpn(e.target.checked)}
                        style={{ width: '18px', height: '18px', accentColor: 'var(--accent-yellow)' }}
                      />
                      <span>I confirm I have premium VPN access to match the client's city/country IP location</span>
                    </label>
                  </div>
                )}

                <div>
                  <label>Additional Notes / ID Reference (Optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="National ID / Passport reference, timezone availability..."
                    value={kycNotes}
                    onChange={(e) => setKycNotes(e.target.value)}
                  />
                </div>

                {kycFeedback && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '10px',
                      fontSize: '0.85rem',
                      backgroundColor: kycFeedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                      color: kycFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      border: `1px solid ${kycFeedback.type === 'success' ? 'var(--status-success-border)' : 'var(--status-danger-border)'}`,
                      fontWeight: 500,
                    }}
                  >
                    {kycFeedback.text}
                  </div>
                )}
              </div>

              <div className="studio-modal-footer">
                <button
                  type="button"
                  onClick={() => setShowKycModal(false)}
                  className="btn btn-secondary"
                  disabled={submittingKyc}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingKyc}
                  className="btn btn-cta"
                >
                  {submittingKyc ? 'Submitting Application...' : 'Submit for Admin Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default ProfilePage;
