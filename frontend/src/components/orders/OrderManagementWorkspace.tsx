import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { OrderItem, OrderDiagnosticsData, PaginationMeta } from '../../types/operations';
import { apiRequest } from '../../services/api';
import {
  fetchManagementOrders,
  fetchStaffOrders,
  fetchOrderDiagnostics,
  fetchStaffOrderDetails,
  publishOrderCard,
  reviewOrderStaff,
  approveOrderAdmin,
  payOrderFromWallet,
  cancelOrder,
  verifyOrderPayment,
  assignOrderRoster,
  refreshOrderDiscord,
  updateOrderOperational,
  fetchManagementOrderCatalog,
  createManagementExternalOrder,
  directAssignOrder,
} from '../../services/operations';

interface Props {
  initialTab?: 'g4x' | 'advertiser';
  title?: string;
  subtitle?: string;
  readOnly?: boolean;
}
const initialFilters = {
  search: '',
  status: '',
  paymentStatus: '',
  gameSlug: '',
  sourceWebsite: '',
  startDate: '',
  endDate: '',
};
type Action =
  | 'publish'
  | 'refresh_card'
  | 'staff_review'
  | 'final_approve'
  | 'pay_wallet'
  | 'verify_payment'
  | 'cancel';
const actionLabels: Record<Action, string> = {
  publish: 'Publish to Discord',
  refresh_card: 'Refresh Discord card',
  staff_review: 'Staff review',
  final_approve: 'Final operational approval',
  pay_wallet: 'Reserve creator wallet funds',
  verify_payment: 'Verify payment receipt',
  cancel: 'Cancel order',
};
const panelStyle: React.CSSProperties = { padding: '1rem', display: 'grid', gap: '1rem' };
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.75rem',
};
const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
// Never render untrusted evidence references as executable URLs.
function Evidence({ value }: { value: string }) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol))
      return (
        <a href={url.href} target="_blank" rel="noopener noreferrer">
          Open evidence
        </a>
      );
  } catch {
    /* Private file references are shown as text. */
  }
  return <span>{value}</span>;
}

export const OrderManagementWorkspace: React.FC<Props> = ({
  initialTab = 'g4x',
  title = 'Order Management',
  subtitle = 'Orders, funding, roster, proof and Discord status in one workspace.',
  readOnly = false,
}) => {
  const { hasRole } = useAuth();
  const allowed = readOnly
    ? hasRole('staff', 'manager', 'admin', 'owner')
    : hasRole('manager', 'admin', 'owner');
  const isReadOnly = Boolean(readOnly || !hasRole('manager', 'admin', 'owner'));
  const [tab, setTab] = useState(initialTab);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [revision, setRevision] = useState(0);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
  });
  const [counts, setCounts] = useState({ g4x: 0, advertiser: 0, needsReview: 0 });
  const [games, setGames] = useState<Array<{ slug: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<OrderDiagnosticsData | null>(null);
  const [detailsError, setDetailsError] = useState('');
  const [actionError, setActionError] = useState('');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState('');
  const [selectedClaims, setSelectedClaims] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [opNotes, setOpNotes] = useState('');
  const [opExternalId, setOpExternalId] = useState('');
  const [opReason, setOpReason] = useState('');
  const [opFeedback, setOpFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [savingOp, setSavingOp] = useState(false);
  const [catalog, setCatalog] = useState<{ games: any[]; accounts: any[] }>({ games: [], accounts: [] });
  const [createExternal, setCreateExternal] = useState({ platform: 'g2g', accountId: '', siteId: '', game: '', service: '', mode: 'selfplay', gross: '', pool: '', runs: '1', boosters: '1', keyLevel: '', dungeon: '', notes: '' });
  const [directUsers, setDirectUsers] = useState('');
  const [directSquadId, setDirectSquadId] = useState('');
  const [directReason, setDirectReason] = useState('');
  const mutationLock = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const detailsDialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    (typeof fetchManagementOrderCatalog === 'function'
      ? fetchManagementOrderCatalog()
      : apiRequest<{ games: Array<{ slug: string; displayName: string }>; accounts?: any[] }>('/api/public/games'))
      .then((res) => {
        if (current) {
          const nextGames = res?.games || [];
          setGames(nextGames.map((g: any) => ({ slug: g.slug, displayName: g.displayName })));
          setCatalog({ games: nextGames, accounts: res?.accounts || [] });
          if (nextGames[0]) setCreateExternal((v) => ({ ...v, game: nextGames[0].slug, service: String(nextGames[0].services?.[0]?.id || '') }));
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    setLoading(true);
    setError('');
    const fetchOrdersMethod = isReadOnly ? fetchStaffOrders : fetchManagementOrders;
    fetchOrdersMethod({
      ...appliedFilters,
      tab,
      sourceWebsite: tab === 'g4x' ? appliedFilters.sourceWebsite : undefined,
      page,
      limit,
    })
      .then((res) => {
        if (!current) return;
        if (res.pagination.page > res.pagination.totalPages) {
          setPage(res.pagination.totalPages);
          return;
        }
        setOrders(res.orders);
        setPagination(res.pagination);
        if (res.counts) setCounts(res.counts);
      })
      .catch((err) => {
        if (current) {
          setOrders([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [allowed, appliedFilters, tab, page, limit, revision]);

  useEffect(() => {
    if (selectedId === null) return;
    let current = true;
    setDetailsLoading(true);
    setDetailsError('');
    setDetails(null);
    const fetchDetailsMethod = isReadOnly ? fetchStaffOrderDetails : fetchOrderDiagnostics;
    fetchDetailsMethod(selectedId)
      .then((res) => {
        if (current) {
          setDetails(res.order);
          setOpNotes(res.order.notes || '');
          setOpExternalId(res.order.externalOrderId || '');
        }
      })
      .catch((err) => {
        if (current) setDetailsError(err.message);
      })
      .finally(() => {
        if (current) setDetailsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selectedId, revision]);

  const closeDetails = useCallback(() => {
    if (mutationLock.current) return;
    setSelectedId(null);
    setAction(null);
    setSelectedClaims({});
    opener.current?.focus();
  }, []);
  useEffect(() => {
    if (selectedId === null) return;
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetails();
      if (event.key === 'Tab') {
        const nodes = detailsDialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [selectedId, closeDetails]);

  const openDetails = (id: number) => {
    opener.current = document.activeElement as HTMLElement;
    setSelectedId(id);
    setAction(null);
    setActionError('');
    setFeedback('');
    setReason('');
    setReceipt('');
    setSelectedClaims({});
    setOpReason('');
    setOpFeedback(null);
  };
  const mutate = async (operation: () => Promise<unknown>, message: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setFeedback('');
    setDetailsError('');
    setActionError('');
    try {
      await operation();
      setFeedback(message);
      setAction(null);
      setReason('');
      setReceipt('');
      setSelectedClaims({});
      setRevision((n) => n + 1);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Order action failed');
      // Refresh both capabilities and lifecycle after a rejected or concurrent transition.
      setRevision((n) => n + 1);
      setFeedback(err instanceof Error ? err.message : 'Order action failed');
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };
  const submitAction = (event: React.FormEvent) => {
    event.preventDefault();
    if (!details || !action || !details.authorizedActions.includes(action)) return;
    const id = details.orderId;
    const operations: Record<Action, () => Promise<unknown>> = {
      publish: () => publishOrderCard(id),
      refresh_card: () => refreshOrderDiscord(id),
      staff_review: () => reviewOrderStaff(id, reason.trim()),
      final_approve: () => approveOrderAdmin(id, reason.trim()),
      pay_wallet: () => payOrderFromWallet(id),
      verify_payment: () => verifyOrderPayment(id, receipt.trim()),
      cancel: () => cancelOrder(id, reason.trim()),
    };
    void mutate(operations[action], `${actionLabels[action]} completed for ${details.orderRef}.`);
  };

  if (!allowed)
    return (
      <Card>
        <p role="alert">
          {readOnly
            ? 'Staff, Manager, Admin or Owner access is required.'
            : 'Manager, Admin or Owner access is required.'}
        </p>
      </Card>
    );
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <Card style={panelStyle}>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <nav aria-label="Order portals" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {hasRole('manager', 'admin', 'owner') && <Link to="/management/orders">Management orders</Link>}
          {hasRole('admin', 'manager', 'owner') && <Link to="/admin/orders">Admin orders</Link>}
          {hasRole('owner') && <Link to="/owner/orders">Owner orders</Link>}
        </nav>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(['g4x', 'advertiser'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn ${tab === value ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                setPage(1);
              }}
            >
              {value === 'g4x' ? 'G4X / Platform' : 'Advertiser'} ({counts[value]})
            </button>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh
          </button>
        </div>
        {counts.needsReview > 0 && (
          <p>
            {counts.needsReview} historical order(s) need origin review. Use the Needs review source filter;
            no historical records are changed.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedFilters({ ...filters });
            setPage(1);
          }}
          style={gridStyle}
        >
          <label>
            Search
            <input
              className="input"
              value={filters.search}
              placeholder="Reference, ID, customer, name or notes"
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </label>
          <label>
            Order status
            <select
              className="input"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {[
                'active',
                'history',
                'draft',
                'payment_pending',
                'open_presign',
                'presign_closed',
                'assigned',
                'in_progress',
                'pending_review',
                'disputed',
                'completed',
                'cancelled',
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment
            <select
              className="input"
              value={filters.paymentStatus}
              onChange={(e) => setFilters({ ...filters, paymentStatus: e.target.value })}
            >
              <option value="">All payment states</option>
              {['pending', 'verified', 'unneeded', 'refunded'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Game
            <select
              className="input"
              value={filters.gameSlug}
              onChange={(e) => setFilters({ ...filters, gameSlug: e.target.value })}
            >
              <option value="">All games</option>
              {games.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.displayName}
                </option>
              ))}
            </select>
          </label>
          {tab === 'g4x' && (
            <label>
              Source
              <select
                className="input"
                value={filters.sourceWebsite}
                onChange={(e) => setFilters({ ...filters, sourceWebsite: e.target.value })}
              >
                <option value="">All sources</option>
                {['direct', 'g2g', 'skycoach', 'eldorado', 'needs_review'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            From (UTC)
            <input
              type="date"
              className="input"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </label>
          <label>
            Through (UTC)
            <input
              type="date"
              className="input"
              value={filters.endDate}
              min={filters.startDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </label>
          <div>
            <button className="btn btn-primary" type="submit">
              Apply filters
            </button>{' '}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setFilters(initialFilters);
                setAppliedFilters(initialFilters);
                setPage(1);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </Card>
      {!readOnly && tab === 'g4x' && (
        <Card style={panelStyle}>
          <details>
            <summary><strong>Create externally sourced G4X order</strong></summary>
            <p>Management-only action. No manager wallet debit; settlement stays pending. Discord publication requires the bot.</p>
            <form style={gridStyle} onSubmit={(e) => { e.preventDefault(); void mutate(() => createManagementExternalOrder({
              sourcePlatform: createExternal.platform, platformAccountId: Number(createExternal.accountId), externalOrderId: createExternal.siteId,
              gameSlug: createExternal.game, serviceId: Number(createExternal.service), orderMode: createExternal.mode,
              grossAmountMinor: Math.round(Number(createExternal.gross) * 100), boosterPoolMinor: Math.round(Number(createExternal.pool) * 100),
              runsCount: Number(createExternal.runs), requiredBoosterCount: Number(createExternal.boosters),
              keyLevel: createExternal.keyLevel ? Number(createExternal.keyLevel) : null, dungeonName: createExternal.dungeon || null, notes: createExternal.notes,
            }), 'External order created. Discord publication remains unavailable until the bot is online.'); }}>
              <label>Platform<select className="input" value={createExternal.platform} onChange={(e) => setCreateExternal({ ...createExternal, platform: e.target.value, accountId: '' })}>{['g2g', 'skycoach', 'eldorado'].map((p) => <option key={p}>{p}</option>)}</select></label>
              <label>Account<select required className="input" value={createExternal.accountId} onChange={(e) => setCreateExternal({ ...createExternal, accountId: e.target.value })}><option value="">Select</option>{catalog.accounts.filter((a) => a.platform === createExternal.platform).map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.accountRef})</option>)}</select></label>
              <label>Site Order ID<input required className="input" value={createExternal.siteId} onChange={(e) => setCreateExternal({ ...createExternal, siteId: e.target.value })} /></label>
              <label>Game<select required className="input" value={createExternal.game} onChange={(e) => { const g = catalog.games.find((x) => x.slug === e.target.value); setCreateExternal({ ...createExternal, game: e.target.value, service: String(g?.services?.[0]?.id || '') }); }}>{catalog.games.map((g) => <option key={g.slug} value={g.slug}>{g.displayName}</option>)}</select></label>
              <label>Service<select required className="input" value={createExternal.service} onChange={(e) => setCreateExternal({ ...createExternal, service: e.target.value })}>{(catalog.games.find((g) => g.slug === createExternal.game)?.services || []).map((s: any) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
              <label>Mode<select className="input" value={createExternal.mode} onChange={(e) => setCreateExternal({ ...createExternal, mode: e.target.value })}><option value="selfplay">Selfplay</option><option value="pilot">Pilot</option><option value="mythicplus">Mythic+</option></select></label>
              <label>Gross USD<input required type="number" step="0.01" min="0.01" className="input" value={createExternal.gross} onChange={(e) => setCreateExternal({ ...createExternal, gross: e.target.value })} /></label>
              <label>Pool USD<input required type="number" step="0.01" min="0.01" className="input" value={createExternal.pool} onChange={(e) => setCreateExternal({ ...createExternal, pool: e.target.value })} /></label>
              <label>Runs<input required type="number" min="1" className="input" value={createExternal.runs} onChange={(e) => setCreateExternal({ ...createExternal, runs: e.target.value })} /></label>
              <label>Boosters<input required type="number" min="1" className="input" value={createExternal.boosters} onChange={(e) => setCreateExternal({ ...createExternal, boosters: e.target.value })} /></label>
              <label>Key level<input type="number" min="1" className="input" value={createExternal.keyLevel} onChange={(e) => setCreateExternal({ ...createExternal, keyLevel: e.target.value })} /></label>
              <label>Dungeon<input className="input" value={createExternal.dungeon} onChange={(e) => setCreateExternal({ ...createExternal, dungeon: e.target.value })} /></label>
              <label>Notes<textarea className="input" value={createExternal.notes} onChange={(e) => setCreateExternal({ ...createExternal, notes: e.target.value })} /></label>
              <button className="btn btn-primary" type="submit" disabled={busy || !createExternal.accountId}>Create external order</button>
            </form>
          </details>
        </Card>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {error ? (
        <Card>
          <p role="alert">{error}</p>
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </Card>
      ) : loading ? (
        <LoadingState message="Loading orders…" />
      ) : (
        <Card style={panelStyle}>
          {!orders.length ? (
            <p>No orders match these filters.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderSpacing: '0 1rem' }}>
                <thead>
                  <tr>
                    {[
                      'Order / Created',
                      'Game / Service',
                      'Source / Customer',
                      'Amount / Pool',
                      'Order / Payment',
                      'Roster / Runs',
                      'Actions',
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.orderRef}
                        <br />
                        <small>{time(o.createdAt)}</small>
                      </td>
                      <td>
                        {o.gameName}
                        <br />
                        {o.serviceName}
                      </td>
                      <td>
                        {o.sourceLabel}
                        <br />
                        {o.originType === 'advertiser'
                          ? o.advertiser?.displayName
                          : o.externalOrderId || o.customerDiscordId || 'Direct'}
                        <br />
                        <small>{o.platformAccount?.displayName}</small>
                      </td>
                      <td>
                        {o.grossAmountUsd} {o.currency}
                        <br />
                        <small>Pool: {o.feeInfo?.boosterPoolUsd || '—'}</small>
                      </td>
                      <td>
                        {typeof o.simplifiedStatus === 'object'
                          ? o.simplifiedStatus.label
                          : o.simplifiedStatus || o.status}
                        <br />
                        <small>Payment: {o.paymentStatus}</small>
                        <br />
                        <small>{o.releaseStage}</small>
                      </td>
                      <td>
                        {o.assignedCount || 0} assigned / {o.runsCount || 0} runs
                        <br />
                        {o.assignedBooster || 'Unassigned'}
                      </td>
                      <td>
                        <button className="btn btn-secondary" onClick={() => openDetails(o.id)}>
                          Details &amp; actions
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              {pagination.total} orders · Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className="btn btn-secondary"
              disabled={loading || pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-secondary"
              disabled={loading || pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </button>
            <label>
              Per page{' '}
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[15, 30, 50].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      )}
      {selectedId !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.8)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            ref={detailsDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="card-surface"
            style={{ ...panelStyle, width: 'min(1050px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <h2 id="order-details-title">Order {details?.orderRef || `#${selectedId}`}</h2>
              <button ref={closeButton} disabled={busy} onClick={closeDetails} className="btn btn-secondary">
                Close
              </button>
            </div>
            {detailsLoading && <LoadingState message="Loading lifecycle, evidence and history…" />}
            {detailsError && <p role="alert">{detailsError}</p>}
            {actionError && <p role="alert">{actionError}</p>}
            {feedback && <p role="status">{feedback}</p>}
            {!detailsLoading && !details && (
              <button onClick={() => setRevision((n) => n + 1)}>Retry details</button>
            )}
            {!detailsLoading && details && (
              <>
                <div style={gridStyle}>
                  <div>
                    <strong>
                      {details.gameName} · {details.serviceName}
                    </strong>
                    <p>
                      {details.orderMode === 'non_pilot' ? 'selfplay' : details.orderMode} · {details.status}
                    </p>
                    <p>Customer: {details.customerId || '—'}</p>
                    <p>Creator: {details.creatorId || '—'}</p>
                    <p>External reference: {details.externalOrderId || '—'}</p>
                  </div>
                  <div>
                    <strong>Payment: {details.paymentStatus}</strong>
                    <p>
                      Gross: {details.grossAmountUsd} {details.currency}
                    </p>
                    <p>Booster pool: {details.boosterPoolUsd}</p>
                    <p>
                      Platform / advertiser fee: {details.platformFeeUsd} / {details.advertiserFeeUsd}
                    </p>
                  </div>
                  <div>
                    <strong>Release: {details.boostReleaseTracker?.stage || 'Not applicable'}</strong>
                    <p>Staff review: {time(details.boostReleaseTracker?.staffReviewedAt || null)}</p>
                    <p>Final approval: {time(details.boostReleaseTracker?.adminFinalApprovedAt || null)}</p>
                    <p>Hold expires: {time(details.boostReleaseTracker?.holdExpiresAt || null)}</p>
                  </div>
                </div>
                {details.notes && <p>Notes: {details.notes}</p>}
                <section>
                  <h3>Lifecycle &amp; next step</h3>
                  <p>{details.explanationEnglish}</p>
                  <p>{details.requiredNextActionEnglish}</p>
                  {details.publicationBlockReasons.map((r, i) => (
                    <p key={i}>{r}</p>
                  ))}
                </section>
                <section>
                  <h3>Discord synchronization</h3>
                  <p>Board message: {details.discordMessageId || 'Not published'}</p>
                  <p>Board channel: {details.discordChannelId || 'Not provisioned'}</p>
                  <p>Execution channel: {details.executionChannelId || 'Not provisioned'}</p>
                  <p>Review channel: {details.reviewChannelId || 'Not provisioned'}</p>
                  <p>Stored channel/message references do not confirm live Discord connectivity.</p>
                </section>
                {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                  <section style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
                    <h3 style={{ margin: '0 0 0.35rem' }}>Operational Fields</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
                      Update operational notes or external reference. Historical payments and assignments remain unchanged.
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (opReason.trim().length < 5) return;
                        setSavingOp(true);
                        setOpFeedback(null);
                        try {
                          await updateOrderOperational(details.orderId, {
                            notes: opNotes.trim() || undefined,
                            externalOrderId: opExternalId.trim() || undefined,
                            reason: opReason.trim(),
                          });
                          setOpFeedback({ text: 'Operational fields saved successfully.', type: 'success' });
                          setRevision((n) => n + 1);
                        } catch (err: any) {
                          setOpFeedback({ text: err.message || 'Operational update failed', type: 'error' });
                        } finally {
                          setSavingOp(false);
                        }
                      }}
                      style={{ display: 'grid', gap: '0.65rem' }}
                    >
                      <label style={{ fontSize: '0.85rem' }}>
                        Operational Notes
                        <textarea
                          className="input"
                          rows={2}
                          value={opNotes}
                          onChange={(e) => setOpNotes(e.target.value)}
                          style={{ width: '100%', marginTop: '0.25rem' }}
                        />
                      </label>
                      <label style={{ fontSize: '0.85rem' }}>
                        External Order ID
                        <input
                          className="input"
                          value={opExternalId}
                          onChange={(e) => setOpExternalId(e.target.value)}
                          style={{ width: '100%', marginTop: '0.25rem' }}
                        />
                      </label>
                      <label style={{ fontSize: '0.85rem' }}>
                        Audit Reason * (Min 5 chars)
                        <input
                          className="input"
                          required
                          minLength={5}
                          placeholder="Reason for operational changes..."
                          value={opReason}
                          onChange={(e) => setOpReason(e.target.value)}
                          style={{ width: '100%', marginTop: '0.25rem' }}
                        />
                      </label>
                      {opFeedback && (
                        <p style={{ color: opFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.85rem', margin: 0 }}>
                          {opFeedback.text}
                        </p>
                      )}
                      <div>
                        <button
                          type="submit"
                          disabled={busy || savingOp || opReason.trim().length < 5}
                          className="btn btn-secondary btn-sm"
                        >
                          {savingOp ? 'Saving…' : 'Save Operational Changes'}
                        </button>
                      </div>
                    </form>
                  </section>
                )}
                <section>
                  <h3>Authorized actions</h3>
                  {isReadOnly ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      Staff read-only view: inspecting permitted orders. Creation, operational modification, cancellation, payment, and roster assignment actions are disabled.
                    </p>
                  ) : (
                    <>
                      <p>Operational approval does not release funds or enable real-money payouts.</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                        {(Object.keys(actionLabels) as Action[])
                          .filter((a) => details.authorizedActions.includes(a))
                          .map((a) => (
                            <button
                              key={a}
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => {
                                setAction(a);
                                setReason('');
                                setReceipt(details.activeReceiptRef || '');
                              }}
                            >
                              {actionLabels[a]}
                            </button>
                          ))}
                      </div>
                      {action && details.authorizedActions.includes(action) && (
                        <form
                          onSubmit={submitAction}
                          style={{ display: 'grid', gap: '.5rem', marginTop: '1rem' }}
                        >
                          <h4>{actionLabels[action]}</h4>
                          {action === 'pay_wallet' && (
                            <p>
                              Reserve {details.grossAmountUsd} from the order creator's backed wallet, not the
                              reviewing operator's wallet. Available:{' '}
                              {(details.creatorWalletAvailableCents / 100).toFixed(2)} USD. No payout is
                              performed.
                            </p>
                          )}
                          {action === 'verify_payment' ? (
                            <label>
                              Verified order receipt reference
                              <input
                                className="input"
                                required
                                value={receipt}
                                onChange={(e) => setReceipt(e.target.value)}
                              />
                            </label>
                          ) : (
                            ['cancel', 'staff_review', 'final_approve'].includes(action) && (
                              <label>
                                Reason / review notes
                                <textarea
                                  className="input"
                                  required
                                  minLength={5}
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                />
                              </label>
                            )
                          )}
                          <p>
                            Confirm this action on {details.orderRef}. The server will recheck current
                            permissions, evidence and lifecycle state.
                          </p>
                          <div>
                            <button type="submit" disabled={busy} className="btn btn-primary">
                              {busy ? 'Working…' : 'Confirm action'}
                            </button>{' '}
                            <button
                              type="button"
                              disabled={busy}
                              className="btn btn-secondary"
                              onClick={() => setAction(null)}
                            >
                              Go back
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </section>
                <section>
                  <h3>Roster &amp; assignment history</h3>
                  <p>
                    Required:{' '}
                    {details.requiredRoles.map((r) => `${r.quantity} ${r.roleName}`).join(', ') ||
                      'Service default'}
                  </p>
                  {!details.assignments.length && <p>No assignments.</p>}
                  {details.assignments.map((a) => (
                    <p key={a.id}>
                      {a.user.displayName || a.user.username} ({a.userId}) · {a.assignedRole} · {a.status} ·{' '}
                      {time(a.assignedAt)} {a.replacementReason && `· ${a.replacementReason}`}
                    </p>
                  ))}
                  {!isReadOnly && details.authorizedActions.includes('assign') && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate(
                          () =>
                            assignOrderRoster(
                              details.orderId,
                              Object.entries(selectedClaims).map(([id, assignedRole]) => ({
                                claimId: Number(id),
                                assignedRole,
                              })),
                            ),
                          'Roster assigned. Verify Discord synchronization status.',
                        );
                      }}
                    >
                      <h4>Assign registered applicants</h4>
                      <p>
                        Select a complete roster. Eligibility, approved game/service roles, slot capacity and
                        double-booking are checked by the server.
                      </p>
                      {!details.presigns.length && <p>No registered applicants.</p>}
                      {details.presigns.map((p) => (
                        <label key={p.id} style={{ display: 'block', margin: '.5rem 0' }}>
                          {p.user.displayName || p.user.username} ({p.userId})
                          {p.squadId ? ` · Team ${p.squadId}` : ''}{' '}
                          <select
                            disabled={busy}
                            value={selectedClaims[p.id] || ''}
                            onChange={(e) => {
                              const next = { ...selectedClaims };
                              if (e.target.value) next[p.id] = e.target.value;
                              else delete next[p.id];
                              setSelectedClaims(next);
                            }}
                          >
                            <option value="">Not selected</option>
                            {p.registeredRole
                              .split(',')
                              .filter((r) => ['tank', 'healer', 'dps', 'booster', 'pilot'].includes(r.trim()))
                              .map((r) => (
                                <option key={r} value={r.trim()}>
                                  {r.trim()}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={busy || !Object.keys(selectedClaims).length}
                      >
                        Confirm roster assignment
                      </button>
                    </form>
                  )}
                  {!isReadOnly && details.authorizedActions.includes('assign') && (
                    <form onSubmit={(e) => {
                    e.preventDefault();
                    const candidates = directUsers.split('\n').map((line) => {
                      const [userId, assignedRole] = line.split(',').map((v) => v.trim());
                      return { userId, assignedRole };
                    }).filter((c) => c.userId && c.assignedRole);
                    void mutate(() => directAssignOrder(details.orderId, { candidates, squadId: directSquadId ? Number(directSquadId) : undefined, auditReason: directReason.trim() }), 'Management assignment recorded (not a booster claim).');
                    }} style={{ display: 'grid', gap: '.5rem', marginTop: '1rem' }}>
                    <h4>Direct management assignment</h4>
                    <p>For boosters agreed outside presign. This does not create or accept a Discord claim. One line per booster: user ID, role.</p>
                    <textarea required minLength={3} className="input" placeholder={'booster-id-1, tank\nbooster-id-2, healer'} value={directUsers} onChange={(e) => setDirectUsers(e.target.value)} />
                    <input className="input" type="number" min="1" placeholder="Optional premade team ID" value={directSquadId} onChange={(e) => setDirectSquadId(e.target.value)} />
                    <textarea required minLength={5} className="input" placeholder="Mandatory audit reason" value={directReason} onChange={(e) => setDirectReason(e.target.value)} />
                    <button className="btn btn-secondary" type="submit" disabled={busy}>Record direct management assignment</button>
                    </form>
                  )}
                </section>
                <section>
                  <h3>Runs &amp; proof</h3>
                  {!details.runs.length && <p>No runs.</p>}
                  {details.runs.map((run) => (
                    <div key={run.id}>
                      <h4>
                        Run {run.runNumber} · {run.status} · {time(run.completedAt)}
                      </h4>
                      {!run.proofs.length && <p>No proof submitted.</p>}
                      {run.proofs.map((proof) => (
                        <div key={proof.id}>
                          <p>
                            Proof #{proof.id}: {proof.proofType} · {proof.status} ·{' '}
                            {proof.submittedBy.username} · {time(proof.submittedAt)}
                          </p>
                          <Evidence value={proof.evidenceUrl} />
                          <p>{proof.description}</p>
                          <p>
                            Reviewer: {proof.reviewedBy?.username || '—'} · {time(proof.reviewedAt)} ·{' '}
                            {proof.reviewNotes || 'No review notes'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
                <section>
                  <h3>Disputes &amp; holds</h3>
                  {!details.disputes.length && <p>No disputes.</p>}
                  {details.disputes.map((d) => (
                    <div key={d.id}>
                      <h4>
                        Dispute #{d.id} · {d.status} · {d.disputeType}
                      </h4>
                      <p>{d.description}</p>
                      <p>
                        Opened by {d.openedById} · {time(d.createdAt)}
                      </p>
                      <p>
                        Resolution: {d.resolutionNotes || 'Pending'} · {d.resolvedById || '—'}
                      </p>
                    </div>
                  ))}
                  {details.escrowHolds.map((h) => (
                    <p key={h.id}>
                      Hold #{h.id}: {h.status} · {h.reason}
                    </p>
                  ))}
                  <Link to="/management?tab=disputes">Open dispute management</Link>
                </section>
                <section>
                  <h3>Audit history</h3>
                  {!details.auditAvailable ? (
                    <p>Audit access is not granted.</p>
                  ) : !details.auditLogs.length ? (
                    <p>No order audit events recorded.</p>
                  ) : (
                    details.auditLogs.map((log) => (
                      <details key={log.id}>
                        <summary>
                          {time(log.createdAt)} · {log.actor?.username || log.actorId || 'System'} ·{' '}
                          {log.action} · {log.isSuccess ? 'Success' : 'Failed'}
                        </summary>
                        <p>{log.reason || 'No reason recorded'}</p>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {log.previousValues || '—'}
                          {'\n→\n'}
                          {log.newValues || '—'}
                        </pre>
                      </details>
                    ))
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
