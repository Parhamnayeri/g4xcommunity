import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  LoadingState,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Modal,
  Input,
  Select,
  Textarea,
} from '../ui';
import {
  fetchAdminUsers,
  updateAdminUserStatus,
  updateAdminUserRole,
  fetchUserBanHistory,
} from '../../services/adminPortal';
import { normalizePagination } from '../../utils/pagination';

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
      setUsers(data?.users || []);
      setPagination(normalizePagination(data?.pagination, 15));
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
      setHistoryError(err.message || 'Failed to fetch withdrawal audit history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const allowedRoles = allowPrivilegedRoles
    ? ['booster', 'pilot', 'staff', 'manager', 'admin', 'advertiser', 'exchanger']
    : ['booster', 'pilot', 'staff', 'advertiser', 'exchanger'];

  const columns: Column<UserItem>[] = [
    {
      key: 'user',
      header: 'Member / Discord Profile',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.displayName || u.username}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>@{u.username}</div>
        </div>
      ),
    },
    {
      key: 'discordId',
      header: 'Discord ID',
      render: (u) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {u.discordId}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <StatusBadge status={u.isActive ? 'active' : 'suspended'} />,
    },
    {
      key: 'roles',
      header: 'Assigned Roles',
      render: (u) => (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {u.roles && u.roles.length > 0 ? (
            u.roles.map((r) => (
              <span key={r.roleKey} className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                {r.roleKey}
              </span>
            ))
          ) : (
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Regular User</span>
          )}
        </div>
      ),
    },
    {
      key: 'advertiserRank',
      header: 'ADV Rank',
      render: (u) => (
        <span style={{ color: 'var(--accent-lime)', fontWeight: 600 }}>{u.advertiserRank || '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u) => (
        <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
            onClick={() => handleOpenHistory(u)}
            title="View account ban and unban history"
          >
            📜 History
          </button>
          {canManageRoles && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
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
              className="btn btn-sm"
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.55rem',
                backgroundColor: u.isActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                color: u.isActive ? 'var(--status-danger)' : 'var(--status-success)',
                border: `1px solid ${u.isActive ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
              }}
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
      ),
    },
  ];

  return (
    <Card style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', margin: '0.25rem 0 0' }}>{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadUsers(pagination.page)}>
          ↻ Refresh List
        </Button>
      </div>

      {/* Filter Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadUsers(1);
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '1rem',
          alignItems: 'end',
          backgroundColor: 'var(--bg-surface-raised)',
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Input
          label="Search User / Discord ID"
          placeholder="Filter by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Select
          label="Filter by Role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
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
        </Select>

        <Select
          label="Account Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="suspended">Suspended Only</option>
        </Select>

        <Button variant="purple" size="sm" type="submit">
          Apply Filters
        </Button>
      </form>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'var(--status-danger-bg)', color: 'var(--status-danger)', borderRadius: 'var(--radius-sm)' }}>
          {error}
        </div>
      )}

      {/* Users DataTable */}
      <div>
        <DataTable
          columns={columns}
          data={users}
          keyExtractor={(u) => u.discordId}
          isLoading={loading}
          emptyTitle="No members found matching filter criteria."
          emptyMessage="Try adjusting your search terms or clearing role filters."
        />

        <Pagination
          pagination={pagination}
          onPageChange={(p) => loadUsers(p)}
          showPageSizeSelector={false}
        />
      </div>

      {/* Account Status / Role Management Modal */}
      {selectedUser && modModalType && (
        <Modal
          isOpen={Boolean(selectedUser && modModalType)}
          onClose={() => {
            setSelectedUser(null);
            setModModalType(null);
            setModReason('');
          }}
          title={
            modModalType === 'status'
              ? `${selectedUser.isActive ? 'Suspend' : 'Activate'} User Account`
              : 'Manage Assigned User Roles'
          }
          subtitle={`Target: ${selectedUser.displayName || selectedUser.username} (${selectedUser.discordId})`}
          maxWidth="520px"
          footer={
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedUser(null);
                  setModModalType(null);
                  setModReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                disabled={submittingMod || modReason.trim().length < 5}
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
              </Button>
            </div>
          }
        >
          {modModalType === 'role' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <Select
                label="Action"
                value={roleAction}
                onChange={(e) => setRoleAction(e.target.value as any)}
              >
                <option value="grant">Grant Role</option>
                <option value="revoke">Revoke Role</option>
              </Select>

              <Select
                label="Role Key"
                value={roleToModify}
                onChange={(e) => setRoleToModify(e.target.value)}
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <Textarea
            label="Administrative Reason / Notes (Min 5 chars required)"
            required
            minLength={5}
            placeholder="Document the operational or compliance reason for this modification..."
            value={modReason}
            onChange={(e) => setModReason(e.target.value)}
          />

          {modFeedback && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                backgroundColor: modFeedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                color: modFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
              }}
            >
              {modFeedback.text}
            </div>
          )}
        </Modal>
      )}

      {/* Immutable Ban History Modal */}
      {historyUser && (
        <Modal
          isOpen={Boolean(historyUser)}
          onClose={() => setHistoryUser(null)}
          title="Account Security & Suspension Audit Log"
          subtitle={`Immutable history for ${historyUser.displayName || historyUser.username} (${historyUser.discordId})`}
          maxWidth="680px"
          footer={
            <Button variant="outline" size="sm" onClick={() => setHistoryUser(null)}>
              Close Audit Trail
            </Button>
          }
        >
          {loadingHistory ? (
            <LoadingState message="Fetching immutable security audit records..." />
          ) : historyError ? (
            <div style={{ color: 'var(--status-danger)' }}>{historyError}</div>
          ) : banHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              No recorded suspension or activation events for this member.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {banHistory.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '0.85rem',
                    backgroundColor: 'var(--bg-surface-raised)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.action}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {new Date(h.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--font-size-xs)', margin: '0.25rem 0', color: 'var(--text-muted)' }}>
                    Reason: <em>{h.reason || 'No documentation provided.'}</em>
                  </p>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Recorded By: {h.actor?.displayName || h.actor?.username || 'System Engine'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
};
