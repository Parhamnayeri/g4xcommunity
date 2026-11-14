import React, { useState, useEffect, useCallback } from 'react';
import { LoadingState } from '../ui/LoadingState';
import {
  fetchAdminUsers,
  updateAdminUserStatus,
  updateAdminUserRole,
  fetchUserBanHistory,
  sendUserKycDm,
} from '../../services/adminPortal';
import { AssistedKycModal } from './AssistedKycModal';

interface UserItem {
  discordId: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  advertiserRank: string | null;
  roles: Array<{ roleKey: string; grantedAt: string }>;
  createdAt: string;
}

interface BanHistoryRecord {
  id: number;
  action: string;
  reason: string | null;
  previousStatus: boolean | null;
  resultingStatus: boolean | null;
  createdAt: string;
  actor: { id: string; username: string; displayName: string | null } | null;
}

interface Props {
  canBan?: boolean;
  canManageRoles?: boolean;
  allowPrivilegedRoles?: boolean;
  title?: string;
  subtitle?: string;
}

export const UserManagementWorkspace: React.FC<Props> = ({
  canBan = false,
  canManageRoles = false,
  allowPrivilegedRoles = false,
  title = 'Community User Registry & RBAC',
  subtitle = 'Search and inspect verified user profiles, assigned roles, and account security history.',
}) => {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Selected User & Modals
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [modModalType, setModModalType] = useState<'status' | 'role' | null>(null);
  const [modReason, setModReason] = useState('');
  const [roleToModify, setRoleToModify] = useState(canManageRoles && !allowPrivilegedRoles ? 'staff' : 'booster');
  const [roleAction, setRoleAction] = useState<'grant' | 'revoke'>('grant');
  const [submittingMod, setSubmittingMod] = useState(false);
  const [modFeedback, setModFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Ban History Modal
  const [historyUser, setHistoryUser] = useState<UserItem | null>(null);
  const [banHistory, setBanHistory] = useState<BanHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Assisted KYC State
  const [assistedUser, setAssistedUser] = useState<UserItem | null>(null);
  const [kycDmFeedback, setKycDmFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [sendingDmId, setSendingDmId] = useState<string | null>(null);

  const handleSendKycDm = async (u: UserItem) => {
    setSendingDmId(u.discordId);
    setKycDmFeedback(null);
    try {
      const res = await sendUserKycDm(u.discordId);
      if (res.dmSent) {
        setKycDmFeedback({
          text: `✓ Verification link sent to ${u.displayName || u.username}'s Discord DM!`,
          type: 'success',
        });
      } else {
        setKycDmFeedback({
          text: `⚠️ User's Discord DMs are closed (${res.error || 'DM blocked'}). Direct URL: ${res.kycUrl}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setKycDmFeedback({
        text: err.message || 'Failed to dispatch KYC DM',
        type: 'error',
      });
    } finally {
      setSendingDmId(null);
    }
  };

  const loadUsers = useCallback(async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers({
        page,
        limit: 15,
        search: search.trim() || undefined,
        role: roleFilter || undefined,
        accountStatus: statusFilter !== 'all' ? statusFilter : undefined,
      });
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users directory.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    loadUsers(1);
  }, [loadUsers]);

  const handleOpenHistory = async (u: UserItem) => {
    setHistoryUser(u);
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetchUserBanHistory(u.discordId);
      setBanHistory(res.history || []);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load ban history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const allowedRoles = allowPrivilegedRoles
    ? ['owner', 'manager', 'admin', 'staff', 'booster', 'pilot', 'advertiser', 'exchanger']
    : ['admin', 'staff', 'booster', 'pilot', 'advertiser', 'exchanger'];

  return (
    <div className="card-surface" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="input"
            placeholder="Search username or Discord ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadUsers(1)}
            style={{ width: '220px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
          />
          <select
            className="input"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
          >
            <option value="">All Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
            <option value="booster">Booster</option>
            <option value="pilot">Pilot</option>
            <option value="advertiser">Advertiser</option>
            <option value="exchanger">Exchanger</option>
          </select>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadUsers(1)}>
            Filter
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--status-danger)', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}

      {kycDmFeedback && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: kycDmFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: kycDmFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border: `1px solid ${kycDmFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{kycDmFeedback.text}</span>
          <button
            type="button"
            onClick={() => setKycDmFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading registered users..." />
      ) : users.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '3rem' }}>
          <span className="empty-state-icon">👥</span>
          <p>No accounts matched the query criteria.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>User Profile</th>
                <th>Discord ID</th>
                <th>Account Status</th>
                <th>Assigned Roles</th>
                <th>Adv. Rank</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.discordId}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.displayName || u.username}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{u.username}</div>
                  </td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {u.discordId}
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge-green' : 'badge-danger'}`} style={{ fontSize: '0.75rem' }}>
                      {u.isActive ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {u.roles && u.roles.length > 0 ? (
                        u.roles.map((r) => (
                          <span key={r.roleKey} className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                            {r.roleKey}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Regular User</span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>
                    {u.advertiserRank || '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleOpenHistory(u)}
                        title="View account ban and unban history"
                      >
                        📜 History
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={sendingDmId === u.discordId}
                        onClick={() => handleSendKycDm(u)}
                        title="Send Discord DM with direct KYC link"
                      >
                        {sendingDmId === u.discordId ? '...' : '🪪 KYC DM'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-purple btn-xs"
                        onClick={() => setAssistedUser(u)}
                        title="Inspect, complete or verify KYC for user"
                      >
                        ✏️ Assist KYC
                      </button>
                      {canManageRoles && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            setSelectedUser(u);
                            setModModalType('role');
                            setModFeedback(null);
                            setModReason('');
                          }}
                        >
                          🛡️ Roles
                        </button>
                      )}
                      {canBan && (
                        <button
                          type="button"
                          className={u.isActive ? 'btn btn-danger btn-xs' : 'btn btn-cta btn-xs'}
                          onClick={() => {
                            setSelectedUser(u);
                            setModModalType('status');
                            setModFeedback(null);
                            setModReason('');
                          }}
                        >
                          {u.isActive ? '🚫 Suspend' : '✅ Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} total users)
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={pagination.page <= 1}
                className="btn btn-secondary btn-sm"
                onClick={() => loadUsers(pagination.page - 1)}
              >
                &larr; Prev
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                className="btn btn-secondary btn-sm"
                onClick={() => loadUsers(pagination.page + 1)}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Status / Role Management Modal */}
      {selectedUser && modModalType && (
        <div className="studio-modal-backdrop" onClick={() => { setSelectedUser(null); setModModalType(null); setModReason(''); }}>
          <div className="studio-modal-card" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {modModalType === 'status'
                  ? `${selectedUser.isActive ? 'Suspend' : 'Activate'} User Account`
                  : 'Manage Assigned User Roles'}
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => {
                  setSelectedUser(null);
                  setModModalType(null);
                  setModReason('');
                }}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Target: <strong>{selectedUser.displayName || selectedUser.username}</strong> ({selectedUser.discordId})
              </p>

              {modModalType === 'role' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Action
                    </label>
                    <select
                      className="input"
                      value={roleAction}
                      onChange={(e) => setRoleAction(e.target.value as any)}
                      style={{ width: '100%', padding: '0.5rem' }}
                    >
                      <option value="grant">Grant Role</option>
                      <option value="revoke">Revoke Role</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Role Key
                    </label>
                    <select
                      className="input"
                      value={roleToModify}
                      onChange={(e) => setRoleToModify(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem' }}
                    >
                      {allowedRoles.map((r) => (
                        <option key={r} value={r}>
                          {r.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Administrative Reason / Notes <span style={{ color: 'var(--status-danger)' }}>* (Min 5 chars required)</span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Document the operational or compliance reason for this modification..."
                  value={modReason}
                  onChange={(e) => setModReason(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', fontSize: '0.85rem' }}
                />
              </div>

              {modFeedback && (
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    marginBottom: '1rem',
                    backgroundColor: modFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: modFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                >
                  {modFeedback.text}
                </div>
              )}
            </div>

            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedUser(null);
                  setModModalType(null);
                  setModReason('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingMod || modReason.trim().length < 5}
                className="btn btn-cta btn-sm"
                onClick={async () => {
                  setSubmittingMod(true);
                  setModFeedback(null);
                  try {
                    if (modModalType === 'status') {
                      await updateAdminUserStatus(selectedUser.discordId, !selectedUser.isActive, modReason.trim());
                      setModFeedback({ text: 'Account status successfully updated.', type: 'success' });
                    } else {
                      await updateAdminUserRole(selectedUser.discordId, roleToModify, roleAction, modReason.trim());
                      setModFeedback({ text: `Role ${roleAction}ed successfully.`, type: 'success' });
                    }
                    setTimeout(() => {
                      setSelectedUser(null);
                      setModModalType(null);
                      setModReason('');
                      loadUsers(pagination.page);
                    }, 800);
                  } catch (err: any) {
                    setModFeedback({ text: err.message || 'Operation failed', type: 'error' });
                  } finally {
                    setSubmittingMod(false);
                  }
                }}
              >
                {submittingMod ? 'Saving...' : 'Confirm Mutation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Immutable Ban History Modal */}
      {historyUser && (
        <div className="studio-modal-backdrop" onClick={() => setHistoryUser(null)}>
          <div className="studio-modal-card studio-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-header">
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Account Ban &amp; Moderation History
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setHistoryUser(null)}
              >
                ✕
              </button>
            </div>

            <div className="studio-modal-body">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                User: <strong>{historyUser.displayName || historyUser.username}</strong> ({historyUser.discordId})
              </p>

              {loadingHistory ? (
                <LoadingState message="Loading immutable moderation history..." />
              ) : historyError ? (
                <div style={{ padding: '1rem', color: 'var(--status-danger)' }}>{historyError}</div>
              ) : banHistory.length === 0 ? (
                <div className="empty-state-box" style={{ padding: '2rem' }}>
                  <span className="empty-state-icon">🛡️</span>
                  <p>No recorded ban or suspension events for this user account.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {banHistory.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        padding: '0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.84rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span className={`badge ${h.resultingStatus ? 'badge-green' : 'badge-danger'}`} style={{ fontSize: '0.75rem' }}>
                          {h.action}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ marginBottom: '0.35rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Moderator: </span>
                        <strong>{h.actor?.displayName || h.actor?.username || 'Authoritative System'}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({h.actor?.id})</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Reason: </span>
                        <span style={{ color: 'var(--text-primary)' }}>{h.reason || 'No recorded notes'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="studio-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHistoryUser(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Assisted KYC Modal */}
      {assistedUser && (
        <AssistedKycModal
          userId={assistedUser.discordId}
          userDisplayName={assistedUser.displayName || assistedUser.username}
          isOpen={Boolean(assistedUser)}
          onClose={() => setAssistedUser(null)}
          onSuccess={() => loadUsers(pagination.page)}
        />
      )}
    </div>
  );
};
