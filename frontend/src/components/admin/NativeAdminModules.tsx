import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { apiRequest } from '../../services/api';
import { normalizePagination } from '../../services/operations';

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
  gap: '1rem',
};
const box: React.CSSProperties = { padding: '1.25rem', display: 'grid', gap: '1rem' };
const snowflake = '[1-9][0-9]{16,19}';
function ErrorMessage({ error }: { error: string }) {
  return error ? <p role="alert">{error}</p> : null;
}
function useResource<T>(url: string, initial: T) {
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, refresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setData(initial);
    apiRequest<T>(url)
      .then((value) => {
        if (current) {
          if (!value || typeof value !== 'object') throw Error('Malformed API response');
          const collection = url.includes('/applications?')
            ? 'applications'
            : url.includes('/channel-mappings')
              ? 'mappings'
              : url === '/api/admin/games'
                ? 'games'
                : '';
          const raw = value as Record<string, any>;
          if (
            collection &&
            (!Array.isArray(raw[collection]) ||
              raw[collection].some(
                (r: any) =>
                  !r ||
                  typeof r !== 'object' ||
                  (collection === 'games'
                    ? typeof r.slug !== 'string' ||
                      typeof r.displayName !== 'string' ||
                      typeof r.serviceCategory !== 'string' ||
                      !Array.isArray(r.services) ||
                      r.services.some(
                        (s: any) =>
                          !s ||
                          typeof s.id !== 'number' ||
                          typeof s.displayName !== 'string' ||
                          typeof s.serviceKey !== 'string',
                      )
                    : collection === 'applications'
                      ? typeof r.id !== 'number' ||
                        typeof r.username !== 'string' ||
                        typeof r.submittedAt !== 'string' ||
                        typeof r.category !== 'string' ||
                        typeof r.status !== 'string'
                      : typeof r.channelKey !== 'string' ||
                        typeof r.guildId !== 'string' ||
                        typeof r.purpose !== 'string' ||
                        typeof r.syncStatus !== 'string' ||
                        (r.discordChannelId !== null && typeof r.discordChannelId !== 'string')),
              ))
          )
            throw Error('Malformed API response');
          if (
            /\/applications\/\d+$/.test(url) &&
            (!raw.application ||
              typeof raw.application.id !== 'number' ||
              typeof raw.application.username !== 'string' ||
              !Array.isArray(raw.application.actions) ||
              !Array.isArray(raw.history) ||
              raw.history.some(
                (event: any) => !event || typeof event.id !== 'number' || typeof event.action !== 'string',
              ))
          )
            throw Error('Malformed application details');
          setData(value);
        }
      })
      .catch((e) => {
        if (current)
          setError(
            e.status === 401
              ? 'Sign in to continue.'
              : e.status === 403
                ? 'You do not have permission for this operation.'
                : e.message,
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [url, revision]);
  return { data, loading, error, reload: () => refresh((n) => n + 1) };
}
function useMutation(reload: () => void) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const run = async (url: string, method: string, body?: unknown) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      setMessage('Saved successfully.');
      reload();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, message };
}
export function AdminModuleNavigation() {
  const { hasRole } = useAuth();
  return hasRole('owner', 'manager', 'admin') ? (
    <nav aria-label="Administration modules" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
      <Link to="/management/applications" className="btn btn-secondary btn-sm">Member Applications</Link>
      <Link to="/admin/games" className="btn btn-secondary btn-sm">Games &amp; Services</Link>
      <Link to="/admin/discord" className="btn btn-secondary btn-sm">Discord Channels</Link>
      <Link to="/management" className="btn btn-secondary btn-sm">Management</Link>
      <Link to="/admin" className="btn btn-secondary btn-sm">Admin</Link>
    </nav>
  ) : null;
}
function Shell({ title, embedded = false, children }: { title: string; embedded?: boolean; children: React.ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole('owner', 'manager', 'admin')) return <p role="alert">Management or Admin access required.</p>;
  return (
    <section className="card-surface" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      {!embedded && <AdminModuleNavigation />}
      {children}
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  disabled = false,
  pattern,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  pattern?: string;
}) {
  return (
    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label}
      <input
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        pattern={pattern}
        style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
      />
    </label>
  );
}
function Select({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v ? v.replace(/_/g, ' ') : 'All'}
          </option>
        ))}
      </select>
    </label>
  );
}
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>
        Page {page} of {totalPages || 1}
      </span>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="btn btn-secondary btn-sm"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="btn btn-secondary btn-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}

interface Application {
  id: number;
  userId: string;
  username: string;
  displayName?: string;
  category: string;
  status: string;
  identityStatus: string;
  submittedAt: string;
  reviewerNotes?: string;
  supplementalInfo?: string;
  rejectionReason?: string;
  game?: { displayName: string };
  service?: { displayName: string };
  reviewedBy?: { username: string };
  qualifications?: Record<string, unknown>;
  actions?: string[];
}
export function ApplicationsWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const [filters, setFilters] = useState({
      search: '',
      category: '',
      status: 'pending',
      startDate: '',
      endDate: '',
    }),
    [query, setQuery] = useState('status=pending'),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<number | null>(null);
  const list = useResource<{ applications?: Application[] }>(
    `/api/management/applications?${query}&page=${page}&limit=15`,
    {},
  );
  const detail = useResource<{
    application?: Application;
    history?: Array<{
      id: number;
      action: string;
      reason: string | null;
      notes?: string | null;
      createdAt: string;
      actor: { username: string } | null;
    }>;
  }>(selected ? `/api/management/applications/${selected}` : '/api/csrf-token', {});
  const action = useMutation(() => {
    list.reload();
    detail.reload();
  });
  const [decision, setDecision] = useState('request_info'),
    [notes, setNotes] = useState('');
  const pagination = normalizePagination(list.data, 15);
  const applications = Array.isArray(list.data.applications) ? list.data.applications : [];
  return (
    <Shell title="Member Applications" embedded={embedded}>
      <form
        style={grid}
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(new URLSearchParams(filters).toString());
        }}
      >
        <Field
          label="Applicant / Discord ID"
          value={filters.search}
          onChange={(search) => setFilters({ ...filters, search })}
        />
        <Select
          label="Application type"
          value={filters.category}
          values={['', 'booster', 'pilot', 'advertiser', 'exchanger']}
          onChange={(category) => setFilters({ ...filters, category })}
        />
        <Select
          label="Status"
          value={filters.status}
          values={[
            'all',
            'pending',
            'under_review',
            'info_requested',
            'awaiting_identity_verification',
            'approved',
            'rejected',
            'cancelled',
          ]}
          onChange={(status) => setFilters({ ...filters, status })}
        />
        <Field
          label="Submitted from (UTC)"
          type="date"
          value={filters.startDate}
          onChange={(startDate) => setFilters({ ...filters, startDate })}
        />
        <Field
          label="Submitted through (UTC)"
          type="date"
          value={filters.endDate}
          onChange={(endDate) => setFilters({ ...filters, endDate })}
        />
        <div style={{ alignSelf: 'end' }}>
          <button type="submit" className="btn btn-primary btn-sm">Apply filters</button>
        </div>
      </form>
      <ErrorMessage error={list.error || action.error} />
      {action.message && <p role="status" style={{ color: 'var(--status-success)' }}>{action.message}</p>}
      {list.error && <button className="btn btn-secondary btn-sm" onClick={list.reload}>Retry</button>}
      {list.error ? null : list.loading ? (
        <p role="status" style={{ color: 'var(--text-muted)' }}>Loading applications…</p>
      ) : !applications.length ? (
        <p style={{ color: 'var(--text-muted)' }}>No matching applications.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>Applicant</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Type</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Submitted</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid rgba(45, 38, 69, 0.4)' }}>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    <div style={{ fontWeight: 600 }}>{a.displayName || a.username}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{a.userId}</div>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>{a.category}</span>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    <span
                      className={`badge ${
                        a.status === 'approved'
                          ? 'badge-success'
                          : a.status === 'rejected'
                            ? 'badge-danger'
                            : 'badge-warning'
                      }`}
                      style={{ fontSize: '0.72rem' }}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                    {new Date(a.submittedAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSelected(a.id);
                        setNotes('');
                      }}
                    >
                      View #{a.id}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onChange={setPage} />
      {selected !== null && (
        <section
          aria-label="Application details"
          className="card-surface"
          style={{
            ...box,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            marginTop: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Application #{selected}</h3>
            <button className="btn btn-secondary btn-sm" disabled={action.busy} onClick={() => setSelected(null)}>
              Close details
            </button>
          </div>
          <ErrorMessage error={detail.error} />
          {detail.loading ? (
            <p>Loading details…</p>
          ) : (
            detail.data.application?.id === selected &&
            detail.data.application &&
            (() => {
              const a = detail.data.application;
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', backgroundColor: 'var(--bg-main)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Applicant: </span>
                      <strong>{a.username}</strong> ({a.userId})
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Type: </span>
                      <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>{a.category}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Status: </span>
                      <span className={`badge ${a.status === 'approved' ? 'badge-success' : a.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.72rem' }}>{a.status}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Identity: </span>
                      <strong>{a.identityStatus}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Game / Service: </span>
                      <strong>{a.game?.displayName || '—'} / {a.service?.displayName || '—'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Reviewer: </span>
                      <strong>{a.reviewedBy?.username || 'Not reviewed'}</strong>
                    </div>
                  </div>
                  {a.reviewerNotes && (
                    <p style={{ fontSize: '0.85rem', margin: 0 }}>
                      <strong>Reviewer Notes: </strong>{a.reviewerNotes}
                    </p>
                  )}
                  {a.rejectionReason && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--status-danger)', margin: 0 }}>
                      <strong>Rejection reason: </strong>{a.rejectionReason}
                    </p>
                  )}
                  {a.supplementalInfo && (
                    <p style={{ fontSize: '0.85rem', margin: 0 }}>
                      <strong>Supplemental information: </strong>{a.supplementalInfo}
                    </p>
                  )}
                  <div style={{ margin: '0.5rem 0' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Qualifications Payload:</span>
                    <pre style={{ whiteSpace: 'pre-wrap', backgroundColor: 'var(--bg-main)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', border: '1px solid var(--border-subtle)' }}>
                      {JSON.stringify(a.qualifications || {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <Link to="/management/kyc" className="btn btn-secondary btn-sm" style={{ display: 'inline-block', margin: '0.25rem 0' }}>
                      Open protected KYC review
                    </Link>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    Pilot and Exchanger approvals still require identity verification. This screen cannot
                    verify identity.
                  </p>
                  {a.actions?.length ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await action.run(`/api/management/applications/${a.id}/review`, 'POST', {
                          decision,
                          reviewerNotes: notes.trim(),
                          reason: notes.trim(),
                        });
                      }}
                      style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}
                    >
                      <Select label="Decision" value={decision} values={a.actions} onChange={setDecision} />
                      <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        Reviewer notes
                        <textarea
                          className="input"
                          minLength={5}
                          required
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          style={{ padding: '0.5rem' }}
                        />
                      </label>
                      <div>
                        <button className="btn btn-cta btn-sm" disabled={action.busy}>Confirm decision</button>
                      </div>
                    </form>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No authorized decisions available. Self-review and terminal decisions are blocked.</p>
                  )}
                  <h4 style={{ margin: '0.75rem 0 0.25rem', fontSize: '0.95rem' }}>Decision history</h4>
                  {Array.isArray(detail.data.history) && detail.data.history.length ? (
                    detail.data.history.map((h) => (
                      <p key={h.id} style={{ fontSize: '0.82rem', margin: '0.2rem 0', color: 'var(--text-muted)' }}>
                        {new Date(h.createdAt).toLocaleString()} · {h.actor?.username || 'System'} ·{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>{h.action}</strong> · {h.notes || h.reason || '—'}
                      </p>
                    ))
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No recorded decisions.</p>
                  )}
                </>
              );
            })()
          )}
        </section>
      )}
    </Shell>
  );
}

interface Service {
  id: number;
  serviceKey: string;
  displayName: string;
  serviceMode: string;
  profileMode: string;
  requiresPilotApproval: boolean;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  settings?: Record<string, any>;
  _count?: { orders: number; approvals: number; registrationApplications: number };
}
interface Game {
  slug: string;
  displayName: string;
  description?: string;
  serviceCategory: string;
  sortOrder: number;
  isActive: boolean;
  services: Service[];
  _count?: { orders: number; characters: number };
}
const emptyGame = {
  slug: '',
  displayName: '',
  description: '',
  serviceCategory: 'both',
  sortOrder: 0,
  isActive: true,
};
const emptyService = {
  serviceKey: '',
  displayName: '',
  description: '',
  serviceMode: 'non_pilot',
  profileMode: 'none',
  requiresPilotApproval: false,
  sortOrder: 0,
  isActive: true,
  settings: {
    claimWindowSeconds: 600,
    proofRequired: true,
    allowPause: false,
    allowReplacement: false,
    acceptsSquads: false,
    requiresRoles: false,
    requiresKey: false,
    isActive: true,
  } as Record<string, any>,
};
export function GamesWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const resource = useResource<{ games?: Game[] }>('/api/admin/games', {}),
    action = useMutation(resource.reload);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [editGame, setEditGame] = useState<string | null>(null),
    [gameForm, setGameForm] = useState(emptyGame),
    [editService, setEditService] = useState<number | null>(null),
    [serviceForm, setServiceForm] = useState(emptyService),
    [serviceOpen, setServiceOpen] = useState(false);
  const games = Array.isArray(resource.data.games) ? resource.data.games : [];
  const filtered = games.filter(
    (g) =>
      `${g.slug} ${g.displayName}`.toLowerCase().includes(search.toLowerCase()) &&
      (!status || String(g.isActive) === status),
  );
  const game = games.find((g) => g.slug === selected);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, pages);
  return (
    <Shell title="Game Registry & Services" embedded={embedded}>
      <ErrorMessage error={resource.error || action.error} />
      {action.message && <p role="status">{action.message}</p>}
      <div style={grid}>
        <Field
          label="Search games"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <Select
          label="Enabled"
          value={status}
          values={['', 'true', 'false']}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <button onClick={resource.reload}>Refresh registry</button>
      </div>
      {resource.error ? null : resource.loading ? (
        <p>Loading registry…</p>
      ) : !filtered.length ? (
        <p>No matching games.</p>
      ) : (
        filtered.slice((current - 1) * 10, current * 10).map((g) => (
          <div key={g.slug} style={grid}>
            <strong>
              {g.displayName} ({g.slug})
            </strong>
            <span>
              {g.serviceCategory} · {g.isActive ? 'Enabled' : 'Disabled'} · Order references:{' '}
              {g._count?.orders || 0}
            </span>
            <button
              onClick={() => {
                setSelected(g.slug);
                setServiceOpen(false);
              }}
            >
              Manage services
            </button>
            <button
              onClick={() => {
                setEditGame(g.slug);
                setGameForm({ ...emptyGame, ...g, description: g.description || '' });
              }}
            >
              Edit game
            </button>
            <button
              disabled={action.busy}
              onClick={() => {
                if (
                  window.confirm(
                    `${g.isActive ? 'Disable' : 'Enable'} ${g.displayName}? Historical orders are retained.`,
                  )
                )
                  void action.run(`/api/admin/games/${encodeURIComponent(g.slug)}/status`, 'PATCH', {
                    isActive: !g.isActive,
                  });
              }}
            >
              {g.isActive ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))
      )}
      <Pagination page={current} totalPages={pages} onChange={setPage} />
      <h3>{editGame ? `Edit ${editGame}` : 'Create game'}</h3>
      <form
        style={grid}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action.run(
              editGame ? `/api/admin/games/${encodeURIComponent(editGame)}` : '/api/admin/games',
              editGame ? 'PUT' : 'POST',
              gameForm,
            )
          ) {
            setEditGame(null);
            setGameForm(emptyGame);
          }
        }}
      >
        <Field
          label="Unique slug"
          value={gameForm.slug}
          onChange={(slug) => setGameForm({ ...gameForm, slug })}
          required
          pattern="[a-z0-9_-]{2,50}"
          disabled={editGame !== null}
        />
        <Field
          label="Display name"
          value={gameForm.displayName}
          onChange={(displayName) => setGameForm({ ...gameForm, displayName })}
          required
        />
        <Field
          label="Description"
          value={gameForm.description}
          onChange={(description) => setGameForm({ ...gameForm, description })}
        />
        <Select
          label="Service category"
          value={gameForm.serviceCategory}
          values={['both', 'non_pilot', 'pilot']}
          onChange={(serviceCategory) => setGameForm({ ...gameForm, serviceCategory })}
        />
        <Field
          label="Display order"
          type="number"
          value={gameForm.sortOrder}
          onChange={(v) => setGameForm({ ...gameForm, sortOrder: Number(v) })}
        />
        <button disabled={action.busy}>Save game</button>
        <button
          type="button"
          onClick={() => {
            setEditGame(null);
            setGameForm(emptyGame);
          }}
        >
          New / Cancel edit
        </button>
      </form>
      {game && (
        <section style={box}>
          <h3>{game.displayName}: services</h3>
          <p>
            Identifiers remain fixed when editing. Disable obsolete services; historical references are
            retained.
          </p>
          {(Array.isArray(game.services) ? game.services : []).map((s) => (
            <div key={s.id} style={grid}>
              <span>
                {s.displayName} · {s.serviceKey} · {s.isActive ? 'Enabled' : 'Disabled'} · Orders:{' '}
                {s._count?.orders || 0}
              </span>
              <button
                onClick={() => {
                  setEditService(s.id);
                  setServiceForm({
                    ...emptyService,
                    ...s,
                    description: s.description || '',
                    settings: { ...emptyService.settings, ...s.settings },
                  });
                  setServiceOpen(true);
                }}
              >
                Edit service
              </button>
              <button
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm(`Change availability of ${s.displayName}?`))
                    void action.run(`/api/admin/services/${s.id}/status`, 'PATCH', { isActive: !s.isActive });
                }}
              >
                Toggle availability
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              setEditService(null);
              setServiceForm(emptyService);
              setServiceOpen(true);
            }}
          >
            Create service
          </button>
          {serviceOpen && (
            <form
              style={grid}
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await action.run(
                    editService
                      ? `/api/admin/services/${editService}`
                      : `/api/admin/games/${encodeURIComponent(game.slug)}/services`,
                    editService ? 'PUT' : 'POST',
                    serviceForm,
                  )
                )
                  setServiceOpen(false);
              }}
            >
              <Field
                label="Unique service key"
                value={serviceForm.serviceKey}
                required
                pattern="[a-z0-9_-]{2,50}"
                disabled={editService !== null}
                onChange={(serviceKey) => setServiceForm({ ...serviceForm, serviceKey })}
              />
              <Field
                label="Service display name"
                value={serviceForm.displayName}
                required
                onChange={(displayName) => setServiceForm({ ...serviceForm, displayName })}
              />
              <Field
                label="Service description"
                value={serviceForm.description}
                onChange={(description) => setServiceForm({ ...serviceForm, description })}
              />
              <Select
                label="Execution mode"
                value={serviceForm.serviceMode}
                values={['non_pilot', 'pilot']}
                onChange={(serviceMode) => setServiceForm({ ...serviceForm, serviceMode })}
              />
              <Select
                label="Profile mode"
                value={serviceForm.profileMode}
                values={['none', 'manual', 'raiderio']}
                onChange={(profileMode) => setServiceForm({ ...serviceForm, profileMode })}
              />
              <Field
                label="Service display order"
                type="number"
                value={serviceForm.sortOrder}
                onChange={(v) => setServiceForm({ ...serviceForm, sortOrder: Number(v) })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={serviceForm.requiresPilotApproval}
                  onChange={(e) =>
                    setServiceForm({ ...serviceForm, requiresPilotApproval: e.target.checked })
                  }
                />
                Pilot approval required
              </label>
              <Field
                label="Claim window (seconds)"
                type="number"
                value={serviceForm.settings.claimWindowSeconds}
                onChange={(v) =>
                  setServiceForm({
                    ...serviceForm,
                    settings: { ...serviceForm.settings, claimWindowSeconds: Number(v) },
                  })
                }
              />
              {[
                'proofRequired',
                'allowPause',
                'allowReplacement',
                'acceptsSquads',
                'requiresRoles',
                'requiresKey',
                'isActive',
              ].map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={Boolean(serviceForm.settings[k])}
                    onChange={(e) =>
                      setServiceForm({
                        ...serviceForm,
                        settings: { ...serviceForm.settings, [k]: e.target.checked },
                      })
                    }
                  />
                  {k}
                </label>
              ))}
              <button disabled={action.busy}>Save service</button>
              <button type="button" onClick={() => setServiceOpen(false)}>
                Cancel
              </button>
            </form>
          )}
        </section>
      )}
    </Shell>
  );
}

interface Mapping {
  channelKey: string;
  guildId: string;
  discordChannelId: string | null;
  purpose: string;
  categoryName: string;
  channelName: string;
  channelType: string;
  gameSlug: string | null;
  serviceId: number | null;
  serviceMode: string | null;
  isActive: boolean;
  syncStatus: string;
  lastSyncResult: string | null;
}
const emptyMapping = {
  channelKey: '',
  guildId: '',
  discordChannelId: '',
  purpose: '',
  categoryName: '',
  channelName: '',
  channelType: 'GUILD_TEXT',
  gameSlug: '',
  serviceId: '',
  serviceMode: '',
  isActive: true,
};
export function ChannelsWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const { hasRole } = useAuth();
  const writable = hasRole('owner', 'manager');
  const resource = useResource<{ mappings?: Mapping[] }>('/api/management/channel-mappings', {}),
    registry = useResource<{ games?: Game[] }>('/api/admin/games', {}),
    action = useMutation(resource.reload);
  const [search, setSearch] = useState(''),
    [guild, setGuild] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<string | null>(null),
    [form, setForm] = useState(emptyMapping),
    [verification, setVerification] = useState('');
  const mappings = Array.isArray(resource.data.mappings) ? resource.data.mappings : [];
  const filtered = mappings.filter(
    (m) =>
      `${m.channelKey} ${m.purpose} ${m.gameSlug || ''}`.toLowerCase().includes(search.toLowerCase()) &&
      (!guild || m.guildId.includes(guild)) &&
      (!status || m.syncStatus === status),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    current = Math.min(page, pages);
  const games = Array.isArray(registry.data.games) ? registry.data.games : [];
  const game = games.find((g) => g.slug === form.gameSlug);
  return (
    <Shell title="Discord Channel Management" embedded={embedded}>
      <p>
        Saved configuration is separate from live Discord verification. Saving never deletes Discord channels.
        Active order workflows prevent replacement or removal.
      </p>
      {!writable && <p>Read-only: channel configuration requires Manager or Owner permission.</p>}
      <ErrorMessage error={resource.error || action.error} />
      {action.message && <p role="status">{action.message}</p>}
      {verification && <p role="status">{verification}</p>}
      <div style={grid}>
        <Field
          label="Purpose / key / game"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <Field
          label="Guild ID filter"
          value={guild}
          onChange={(v) => {
            setGuild(v);
            setPage(1);
          }}
        />
        <Select
          label="Saved status"
          value={status}
          values={['', 'SAVED', 'VERIFIED', 'UNAVAILABLE', 'DEGRADED', 'RECONCILIATION_REQUIRED', 'PENDING', 'MANUAL', 'DISABLED']}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <button onClick={resource.reload}>Refresh mappings</button>
      </div>
      {resource.error ? null : resource.loading ? (
        <p>Loading saved mappings…</p>
      ) : !filtered.length ? (
        <p>No matching channel mappings.</p>
      ) : (
        filtered.slice((current - 1) * 10, current * 10).map((m) => (
          <div key={m.channelKey} className="card-surface" style={box}>
            <strong>
              {m.channelKey} · {m.purpose}
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: '8px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor:
                    m.syncStatus === 'VERIFIED' || m.syncStatus === 'SYNCED'
                      ? '#065f46'
                      : m.syncStatus === 'DEGRADED'
                        ? '#78350f'
                        : m.syncStatus === 'UNAVAILABLE' || m.syncStatus === 'MISSING' || m.syncStatus === 'INVALID'
                          ? '#7f1d1d'
                          : m.syncStatus === 'RECONCILIATION_REQUIRED'
                            ? '#581c87'
                            : '#374151',
                  color:
                    m.syncStatus === 'VERIFIED' || m.syncStatus === 'SYNCED'
                      ? '#6ee7b7'
                      : m.syncStatus === 'DEGRADED'
                        ? '#fde68a'
                        : m.syncStatus === 'UNAVAILABLE' || m.syncStatus === 'MISSING' || m.syncStatus === 'INVALID'
                          ? '#fca5a5'
                          : m.syncStatus === 'RECONCILIATION_REQUIRED'
                            ? '#d8b4fe'
                            : '#d1d5db',
                }}
              >
                {m.syncStatus}
              </span>
            </strong>
            <p>
              Guild: {m.guildId} · Channel: {m.discordChannelId || 'Not configured'}
            </p>
            <p>
              {m.gameSlug || 'Global workflow'} · Service: {m.serviceId || '—'} · {m.serviceMode || 'all'} ·{' '}
              {m.isActive ? 'Enabled' : 'Disabled'} · Saved status: {m.syncStatus}
            </p>
            <p>{m.lastSyncResult}</p>
            {writable && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                <button
                  onClick={() => {
                    setEditing(m.channelKey);
                    setForm({
                      ...emptyMapping,
                      ...m,
                      discordChannelId: m.discordChannelId || '',
                      gameSlug: m.gameSlug || '',
                      serviceId: m.serviceId ? String(m.serviceId) : '',
                      serviceMode: m.serviceMode || '',
                    });
                  }}
                >
                  Edit mapping
                </button>
                <button
                  disabled={action.busy}
                  onClick={async () => {
                    if (
                      window.confirm(
                        `Remove saved mapping ${m.channelKey}? The Discord channel itself is retained.`,
                      )
                    )
                      await action.run(
                        `/api/management/channel-mappings/${encodeURIComponent(m.channelKey)}`,
                        'DELETE',
                      );
                  }}
                >
                  Remove mapping
                </button>
                <button
                  onClick={async () => {
                    try {
                      const result = await apiRequest<{ valid: boolean; status?: string; error?: string; checkedAt?: string }>(
                        `/api/management/channel-mappings/${encodeURIComponent(m.channelKey)}/verify`,
                        { method: 'POST' },
                      );
                      setVerification(
                        `${m.channelKey}: ${result.valid ? `Live channel verified at ${result.checkedAt}` : `${result.status || 'FAILED'}: ${result.error || 'Live validation failed'}`}`,
                      );
                      resource.reload();
                    } catch (e: any) {
                      setVerification(e.message);
                    }
                  }}
                >
                  Verify live connectivity
                </button>
                <button
                  onClick={async () => {
                    try {
                      const result = await apiRequest<{ success: boolean; observation?: { valid: boolean; status?: string; error?: string } }>(
                        `/api/management/channel-mappings/${encodeURIComponent(m.channelKey)}/reconcile`,
                        { method: 'POST' },
                      );
                      setVerification(
                        `${m.channelKey}: Reconciled (Status: ${result.observation?.status || (result.observation?.valid ? 'VERIFIED' : 'UNAVAILABLE')}).`,
                      );
                      resource.reload();
                    } catch (e: any) {
                      setVerification(e.message);
                    }
                  }}
                >
                  Reconcile mapping
                </button>
              </div>
            )}
          </div>
        ))
      )}
      <Pagination page={current} totalPages={pages} onChange={setPage} />
      {writable && (
        <>
          <h3>{editing ? 'Edit mapping' : 'Create mapping'}</h3>
          <form
            style={grid}
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action.run(
                  `/api/management/channel-mappings/${encodeURIComponent(form.channelKey)}`,
                  editing ? 'PUT' : 'POST',
                  { ...form, serviceId: form.serviceId ? Number(form.serviceId) : null },
                )
              ) {
                setEditing(null);
                setForm(emptyMapping);
              }
            }}
          >
            <Field
              label="Workflow mapping key"
              value={form.channelKey}
              required
              pattern="(reg|order_panel|publication|execution):[a-z0-9_:\-]{1,120}"
              disabled={editing !== null}
              onChange={(channelKey) => setForm({ ...form, channelKey })}
            />
            <Field
              label="Discord guild/server ID"
              value={form.guildId}
              required
              pattern={snowflake}
              onChange={(guildId) => setForm({ ...form, guildId })}
            />
            <Field
              label="Discord channel ID"
              value={form.discordChannelId}
              required
              pattern={snowflake}
              onChange={(discordChannelId) => setForm({ ...form, discordChannelId })}
            />
            <Field
              label="Mapping purpose"
              value={form.purpose}
              required
              onChange={(purpose) => setForm({ ...form, purpose })}
            />
            <Field
              label="Category name"
              value={form.categoryName}
              required
              onChange={(categoryName) => setForm({ ...form, categoryName })}
            />
            <Field
              label="Channel name"
              value={form.channelName}
              required
              onChange={(channelName) => setForm({ ...form, channelName })}
            />
            <Select
              label="Channel type"
              value={form.channelType}
              values={['GUILD_TEXT', 'GUILD_CATEGORY']}
              onChange={(channelType) => setForm({ ...form, channelType })}
            />
            <label>
              Related game
              <select
                className="input"
                value={form.gameSlug}
                onChange={(e) => setForm({ ...form, gameSlug: e.target.value, serviceId: '' })}
              >
                <option value="">Global</option>
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Related service
              <select
                className="input"
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
              >
                <option value="">All services</option>
                {(game && Array.isArray(game.services) ? game.services : []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Select
              label="Workflow mode"
              value={form.serviceMode}
              values={['', 'non_pilot', 'pilot']}
              onChange={(serviceMode) => setForm({ ...form, serviceMode })}
            />
            <label>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Enabled
            </label>
            <button disabled={action.busy}>Save configuration (unverified)</button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(emptyMapping);
              }}
            >
              New / Cancel edit
            </button>
          </form>
          <p>
            Editing cannot repurpose a mapping's game, service, mode or channel type; create a separate
            mapping for a new workflow. Use existing workflow keys (reg:public, reg:mgmt, order_panel,
            publication or execution). Purpose is a display description; it does not create a new bot
            workflow.
          </p>
        </>
      )}
    </Shell>
  );
}
