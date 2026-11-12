import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  Button,
  LoadingState,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Tabs,
  Input,
  Select,
  Textarea,
} from '../ui';
import { useAuth } from '../../hooks/useAuth';
import { OrderItem, OrderDiagnosticsData, PaginationMeta } from '../../types/operations';
import { normalizePagination } from '../../utils/pagination';
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

const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

function Evidence({ value }: { value: string }) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) {
      return (
        <a href={url.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-purple-light)', textDecoration: 'underline' }}>
          Open evidence
        </a>
      );
    }
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

  const [tab, setTab] = useState<'g4x' | 'advertiser'>(initialTab);
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
  const [createExternal, setCreateExternal] = useState({
    platform: 'g2g',
    accountId: '',
    siteId: '',
    game: '',
    service: '',
    mode: 'selfplay',
    gross: '',
    pool: '',
    runs: '1',
    boosters: '1',
    keyLevel: '',
    dungeon: '',
    notes: '',
  });
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
          if (nextGames[0]) {
            setCreateExternal((v) => ({
              ...v,
              game: nextGames[0].slug,
              service: String(nextGames[0].services?.[0]?.id || ''),
            }));
          }
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
        const norm = normalizePagination(res, limit);
        if (norm.page > norm.totalPages && norm.totalPages >= 1) {
          setPage(norm.totalPages);
          return;
        }
        setOrders(res.orders || []);
        setPagination(norm);
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
  }, [allowed, appliedFilters, tab, page, limit, revision, isReadOnly]);

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
  }, [selectedId, revision, isReadOnly]);

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
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
        );
        if (!nodes?.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
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
      const errMsg = err instanceof Error ? err.message : 'Order action failed';
      setActionError(errMsg);
      setRevision((n) => n + 1);
      setFeedback(errMsg);
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
    void mutate(operations[action], `Action ${action} completed for ${details.orderRef}`);
  };

  if (!allowed) {
    return (
      <Card style={{ margin: '2rem auto', maxWidth: '640px', padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--status-danger)', marginBottom: '0.75rem' }}>Access Denied</h2>
        <p>Operations or management access is required to view order operations.</p>
      </Card>
    );
  }

  const columns: Column<OrderItem>[] = [
    {
      key: 'orderRef',
      header: 'Order / Created',
      render: (o) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.orderRef}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{time(o.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'gameName',
      header: 'Game / Service',
      render: (o) => (
        <div>
          <div style={{ fontWeight: 600 }}>{o.gameName}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{o.serviceName}</div>
        </div>
      ),
    },
    {
      key: 'sourceLabel',
      header: 'Source / Customer',
      render: (o) => (
        <div>
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--primary-purple-light)' }}>
            {o.sourceLabel}
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)' }}>
            {o.originType === 'advertiser'
              ? o.advertiser?.displayName
              : o.externalOrderId || o.customerDiscordId || 'Direct'}
          </div>
          {o.platformAccount?.displayName && (
            <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-dim)' }}>
              {o.platformAccount.displayName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'grossAmountUsd',
      header: 'Amount / Pool',
      numeric: true,
      render: (o) => (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {o.grossAmountUsd} {o.currency}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-lime)' }}>
            Pool: {o.feeInfo?.boosterPoolUsd || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'simplifiedStatus',
      header: 'Order / Payment',
      render: (o) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
          <StatusBadge
            simplifiedStatus={typeof o.simplifiedStatus === 'object' ? o.simplifiedStatus : null}
            status={typeof o.simplifiedStatus === 'string' ? o.simplifiedStatus : o.status}
          />
          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
            Payment: {o.paymentStatus}
          </div>
          {o.releaseStage && (
            <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-dim)' }}>
              {o.releaseStage}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'assignedCount',
      header: 'Roster / Runs',
      render: (o) => (
        <div>
          <div>
            {o.assignedCount || 0} assigned / {o.runsCount || 0} runs
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
            {o.assignedBooster || 'Unassigned'}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (o) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e?.stopPropagation?.();
            openDetails(o.id);
          }}
        >
          Details &amp; actions
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* Workspace Header */}
      <div>
        <h1 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '0.25rem' }}>{title}</h1>
        <p style={{ fontSize: 'var(--font-size-sm)' }}>{subtitle}</p>
      </div>

      {feedback && (
        <div
          role="status"
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--purple-subtle)',
            border: '1px solid var(--primary-purple)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {feedback}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'g4x', label: 'G4X managed orders', count: counts.g4x },
          { id: 'advertiser', label: 'Advertiser orders', count: counts.advertiser },
        ]}
        activeTab={tab}
        onChange={(t) => {
          setTab(t as 'g4x' | 'advertiser');
          setPage(1);
        }}
      />

      {/* Filter Toolbar Card */}
      <Card style={{ padding: '1.25rem' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedFilters(filters);
            setPage(1);
          }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'end' }}
        >
          <Input
            label="Search"
            placeholder="Search orders..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />

          <Select
            label="Order status"
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
          </Select>

          <Select
            label="Payment"
            value={filters.paymentStatus}
            onChange={(e) => setFilters({ ...filters, paymentStatus: e.target.value })}
          >
            <option value="">All payment states</option>
            {['pending', 'verified', 'unneeded', 'refunded'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>

          <Select
            label="Game"
            value={filters.gameSlug}
            onChange={(e) => setFilters({ ...filters, gameSlug: e.target.value })}
          >
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.displayName}
              </option>
            ))}
          </Select>

          {tab === 'g4x' && (
            <Select
              label="Source"
              value={filters.sourceWebsite}
              onChange={(e) => setFilters({ ...filters, sourceWebsite: e.target.value })}
            >
              <option value="">All sources</option>
              {['direct', 'g2g', 'skycoach', 'eldorado', 'needs_review'].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}

          <Input
            type="date"
            label="From (UTC)"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />

          <Input
            type="date"
            label="Through (UTC)"
            value={filters.endDate}
            min={filters.startDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="purple" type="submit" size="sm">
              Apply filters
            </Button>
            <Button
              variant="outline"
              type="button"
              size="sm"
              onClick={() => {
                setFilters(initialFilters);
                setAppliedFilters(initialFilters);
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>

      {/* External Order Intake (Management Only) */}
      {!readOnly && tab === 'g4x' && (
        <Card style={{ padding: '1.25rem' }}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--text-primary)' }}>
              Create externally sourced G4X order
            </summary>
            <p style={{ fontSize: 'var(--font-size-xs)', margin: '0.5rem 0 1rem' }}>
              Management-only action. No manager wallet debit; settlement stays pending. Discord publication requires the bot.
            </p>
            <form
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'end' }}
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  () =>
                    createManagementExternalOrder({
                      sourcePlatform: createExternal.platform,
                      platformAccountId: Number(createExternal.accountId),
                      externalOrderId: createExternal.siteId,
                      gameSlug: createExternal.game,
                      serviceId: Number(createExternal.service),
                      orderMode: createExternal.mode,
                      grossAmountMinor: Math.round(Number(createExternal.gross) * 100),
                      boosterPoolMinor: Math.round(Number(createExternal.pool) * 100),
                      runsCount: Number(createExternal.runs),
                      requiredBoosterCount: Number(createExternal.boosters),
                      keyLevel: createExternal.keyLevel ? Number(createExternal.keyLevel) : null,
                      dungeonName: createExternal.dungeon || null,
                      notes: createExternal.notes,
                    }),
                  'External order created. Discord publication remains unavailable until the bot is online.'
                );
              }}
            >
              <Select
                label="Platform"
                value={createExternal.platform}
                onChange={(e) => setCreateExternal({ ...createExternal, platform: e.target.value, accountId: '' })}
              >
                {['g2g', 'skycoach', 'eldorado'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>

              <Select
                required
                label="Account"
                value={createExternal.accountId}
                onChange={(e) => setCreateExternal({ ...createExternal, accountId: e.target.value })}
              >
                <option value="">Select</option>
                {catalog.accounts
                  .filter((a) => a.platform === createExternal.platform)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName} ({a.accountRef})
                    </option>
                  ))}
              </Select>

              <Input
                required
                label="Site Order ID"
                value={createExternal.siteId}
                onChange={(e) => setCreateExternal({ ...createExternal, siteId: e.target.value })}
              />

              <Select
                required
                label="Game"
                value={createExternal.game}
                onChange={(e) => {
                  const g = catalog.games.find((x) => x.slug === e.target.value);
                  setCreateExternal({
                    ...createExternal,
                    game: e.target.value,
                    service: String(g?.services?.[0]?.id || ''),
                  });
                }}
              >
                {catalog.games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.displayName}
                  </option>
                ))}
              </Select>

              <Select
                required
                label="Service"
                value={createExternal.service}
                onChange={(e) => setCreateExternal({ ...createExternal, service: e.target.value })}
              >
                {(catalog.games.find((g) => g.slug === createExternal.game)?.services || []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </Select>

              <Select
                label="Mode"
                value={createExternal.mode}
                onChange={(e) => setCreateExternal({ ...createExternal, mode: e.target.value })}
              >
                <option value="selfplay">Selfplay</option>
                <option value="pilot">Pilot</option>
                <option value="mythicplus">Mythic+</option>
              </Select>

              <Input
                required
                type="number"
                step="0.01"
                min="0.01"
                label="Gross USD"
                value={createExternal.gross}
                onChange={(e) => setCreateExternal({ ...createExternal, gross: e.target.value })}
              />

              <Input
                required
                type="number"
                step="0.01"
                min="0.01"
                label="Pool USD"
                value={createExternal.pool}
                onChange={(e) => setCreateExternal({ ...createExternal, pool: e.target.value })}
              />

              <Button variant="cta" type="submit" size="sm">
                Create external order
              </Button>
            </form>
          </details>
        </Card>
      )}

      {/* Orders DataTable & Pagination */}
      {error ? (
        <Card style={{ padding: '2rem', textAlign: 'center' }}>
          <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>
            {error}
          </p>
          <Button variant="purple" size="sm" onClick={() => setRevision((n) => n + 1)}>
            Retry loading orders
          </Button>
        </Card>
      ) : (
        <div>
          <DataTable
            columns={columns}
            data={orders}
            keyExtractor={(o) => o.id}
            isLoading={loading}
            emptyTitle="No orders match these filters."
            emptyMessage="Try adjusting your search criteria or resetting active filters."
            onRowClick={(o) => openDetails(o.id)}
          />

          <Pagination
            pagination={pagination}
            onPageChange={(p) => setPage(p)}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Details Dialog */}
      {selectedId !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(13, 11, 18, 0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetails();
          }}
        >
          <div
            ref={detailsDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="card-surface"
            style={{
              padding: '1.5rem',
              width: 'min(1050px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              <h2 id="order-details-title" style={{ fontSize: 'var(--font-size-lg)', margin: 0 }}>
                Order {details?.orderRef || `#${selectedId}`}
              </h2>
              <button
                ref={closeButton}
                disabled={busy}
                onClick={closeDetails}
                className="btn btn-secondary"
                type="button"
              >
                Close
              </button>
            </div>

            {detailsLoading && <LoadingState message="Loading lifecycle, evidence and history…" />}
            {detailsError && <p role="alert" style={{ color: 'var(--status-danger)' }}>{detailsError}</p>}
            {actionError && <p role="alert" style={{ color: 'var(--status-danger)' }}>{actionError}</p>}
            {feedback && <p role="status" style={{ color: 'var(--accent-lime)' }}>{feedback}</p>}

            {!detailsLoading && !details && (
              <Button variant="purple" size="sm" onClick={() => setRevision((n) => n + 1)}>
                Retry details
              </Button>
            )}

            {!detailsLoading && details && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-surface-raised)', borderRadius: 'var(--radius-sm)' }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {details.gameName} · {details.serviceName}
                    </strong>
                    <p style={{ margin: '0.25rem 0' }}>
                      {details.orderMode === 'non_pilot' ? 'selfplay' : details.orderMode} · {details.status}
                    </p>
                    <p style={{ margin: '0.25rem 0' }}>Customer: {details.customerId || '—'}</p>
                    <p style={{ margin: '0.25rem 0' }}>Creator: {details.creatorId || '—'}</p>
                    <p style={{ margin: '0.25rem 0' }}>External reference: {details.externalOrderId || '—'}</p>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Payment: {details.paymentStatus}</strong>
                    <p style={{ margin: '0.25rem 0' }}>
                      Gross: {details.grossAmountUsd} {details.currency}
                    </p>
                    <p style={{ margin: '0.25rem 0' }}>Booster pool: {details.boosterPoolUsd}</p>
                    <p style={{ margin: '0.25rem 0' }}>
                      Platform / advertiser fee: {details.platformFeeUsd} / {details.advertiserFeeUsd}
                    </p>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Release: {details.boostReleaseTracker?.stage || 'Not applicable'}
                    </strong>
                    <p style={{ margin: '0.25rem 0' }}>Staff review: {time(details.boostReleaseTracker?.staffReviewedAt || null)}</p>
                    <p style={{ margin: '0.25rem 0' }}>Final approval: {time(details.boostReleaseTracker?.adminFinalApprovedAt || null)}</p>
                    <p style={{ margin: '0.25rem 0' }}>Hold expires: {time(details.boostReleaseTracker?.holdExpiresAt || null)}</p>
                  </div>
                </div>

                {details.notes && <p>Notes: {details.notes}</p>}

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Lifecycle &amp; next step</h3>
                  <p>{details.explanationEnglish}</p>
                  <p>{details.requiredNextActionEnglish}</p>
                  {details.publicationBlockReasons.map((r, i) => (
                    <p key={i} style={{ color: 'var(--status-warning)' }}>{r}</p>
                  ))}
                </section>

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Discord synchronization</h3>
                  <p>Board message: {details.discordMessageId || 'Not published'}</p>
                  <p>Board channel: {details.discordChannelId || 'Not provisioned'}</p>
                  <p>Execution channel: {details.executionChannelId || 'Not provisioned'}</p>
                  <p>Review channel: {details.reviewChannelId || 'Not provisioned'}</p>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
                    Stored channel/message references do not confirm live Discord connectivity.
                  </p>
                </section>

                {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                  <section style={{ paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
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
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Authorized actions</h3>
                  {isReadOnly ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      Staff read-only view: inspecting permitted orders. Creation, operational modification, cancellation, payment, and roster assignment actions are disabled.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.75rem' }}>
                        Operational approval does not release funds or enable real-money payouts.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                        {(Object.keys(actionLabels) as Action[])
                          .filter((a) => details.authorizedActions.includes(a))
                          .map((a) => (
                            <button
                              key={a}
                              type="button"
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
                          style={{ display: 'grid', gap: '.75rem', marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--bg-surface-raised)', borderRadius: 'var(--radius-sm)' }}
                        >
                          <h4 style={{ margin: 0 }}>{actionLabels[action]}</h4>
                          {action === 'pay_wallet' && (
                            <p style={{ fontSize: 'var(--font-size-sm)' }}>
                              Reserve {details.grossAmountUsd} from the order creator's backed wallet, not the
                              reviewing operator's wallet. Available:{' '}
                              {(details.creatorWalletAvailableCents / 100).toFixed(2)} USD. No payout is performed.
                            </p>
                          )}
                          {action === 'verify_payment' ? (
                            <Input
                              required
                              label="Verified order receipt reference"
                              value={receipt}
                              onChange={(e) => setReceipt(e.target.value)}
                            />
                          ) : (
                            ['cancel', 'staff_review', 'final_approve'].includes(action) && (
                              <Textarea
                                required
                                minLength={5}
                                label="Reason / review notes"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            )
                          )}
                          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                            Confirm this action on {details.orderRef}. The server will recheck current permissions, evidence and lifecycle state.
                          </p>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <Button type="submit" disabled={busy} variant="cta" size="sm">
                              {busy ? 'Working…' : 'Confirm action'}
                            </Button>
                            <Button
                              type="button"
                              disabled={busy}
                              variant="outline"
                              size="sm"
                              onClick={() => setAction(null)}
                            >
                              Go back
                            </Button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </section>

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Roster &amp; assignment history</h3>
                  <p style={{ fontSize: 'var(--font-size-sm)' }}>
                    Required:{' '}
                    {details.requiredRoles.map((r) => `${r.quantity} ${r.roleName}`).join(', ') || 'Service default'}
                  </p>
                  {!details.assignments.length && <p>No assignments.</p>}
                  {details.assignments.map((a) => (
                    <p key={a.id} style={{ fontSize: 'var(--font-size-sm)' }}>
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
                              }))
                            ),
                          'Roster assigned. Verify Discord synchronization status.'
                        );
                      }}
                      style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--bg-surface-raised)', borderRadius: 'var(--radius-sm)' }}
                    >
                      <h4>Assign registered applicants</h4>
                      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                        Select a complete roster. Eligibility, approved game/service roles, slot capacity and double-booking are checked by the server.
                      </p>
                      {!details.presigns.length && <p>No registered applicants.</p>}
                      {details.presigns.map((p) => (
                        <label key={p.id} style={{ display: 'block', margin: '.5rem 0', fontSize: 'var(--font-size-sm)' }}>
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
                            className="form-select"
                            style={{ display: 'inline-block', width: 'auto', marginLeft: '0.5rem' }}
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
                      <Button
                        variant="purple"
                        type="submit"
                        size="sm"
                        disabled={busy || !Object.keys(selectedClaims).length}
                      >
                        Confirm roster assignment
                      </Button>
                    </form>
                  )}

                  {!isReadOnly && details.authorizedActions.includes('assign') && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const candidates = directUsers
                          .split('\n')
                          .map((line) => {
                            const [userId, assignedRole] = line.split(',').map((v) => v.trim());
                            return { userId, assignedRole };
                          })
                          .filter((c) => c.userId && c.assignedRole);
                        void mutate(
                          () =>
                            directAssignOrder(details.orderId, {
                              candidates,
                              squadId: directSquadId ? Number(directSquadId) : undefined,
                              auditReason: directReason.trim(),
                            }),
                          'Management assignment recorded (not a booster claim).'
                        );
                      }}
                      style={{ display: 'grid', gap: '.5rem', marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--bg-surface-raised)', borderRadius: 'var(--radius-sm)' }}
                    >
                      <h4>Direct management assignment</h4>
                      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        For boosters agreed outside presign. This does not create or accept a Discord claim. One line per booster: user ID, role.
                      </p>
                      <Textarea
                        required
                        minLength={3}
                        placeholder={'booster-id-1, tank\nbooster-id-2, healer'}
                        value={directUsers}
                        onChange={(e) => setDirectUsers(e.target.value)}
                      />
                      <Input
                        type="number"
                        min="1"
                        placeholder="Optional premade team ID"
                        value={directSquadId}
                        onChange={(e) => setDirectSquadId(e.target.value)}
                      />
                      <Textarea
                        required
                        minLength={5}
                        placeholder="Mandatory audit reason"
                        value={directReason}
                        onChange={(e) => setDirectReason(e.target.value)}
                      />
                      <Button variant="outline" type="submit" size="sm" disabled={busy}>
                        Record direct management assignment
                      </Button>
                    </form>
                  )}
                </section>

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Runs &amp; proof</h3>
                  {!details.runs.length && <p>No runs.</p>}
                  {details.runs.map((run) => (
                    <div key={run.id} style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-surface-raised)', borderRadius: 'var(--radius-sm)' }}>
                      <h4>
                        Run {run.runNumber} · {run.status} · {time(run.completedAt)}
                      </h4>
                      {!run.proofs.length && <p>No proof submitted.</p>}
                      {run.proofs.map((proof) => (
                        <div key={proof.id} style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--border-subtle)' }}>
                          <p>
                            Proof #{proof.id}: {proof.proofType} · {proof.status} ·{' '}
                            {proof.submittedBy.username} · {time(proof.submittedAt)}
                          </p>
                          <Evidence value={proof.evidenceUrl} />
                          <p>{proof.description}</p>
                          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
                            Reviewer: {proof.reviewedBy?.username || '—'} · {time(proof.reviewedAt)} ·{' '}
                            {proof.reviewNotes || 'No review notes'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Disputes &amp; holds</h3>
                  {!details.disputes.length && <p>No disputes.</p>}
                  {details.disputes.map((d) => (
                    <div key={d.id} style={{ marginBottom: '0.75rem' }}>
                      <h4>
                        Dispute #{d.id} · {d.status} · {d.disputeType}
                      </h4>
                      <p>{d.description}</p>
                      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
                        Opened by {d.openedById} · {time(d.createdAt)}
                      </p>
                      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
                        Resolution: {d.resolutionNotes || 'Pending'} · {d.resolvedById || '—'}
                      </p>
                    </div>
                  ))}
                  {details.escrowHolds.map((h) => (
                    <p key={h.id}>
                      Hold #{h.id}: {h.status} · {h.reason}
                    </p>
                  ))}
                  <Link to="/management?tab=disputes" style={{ color: 'var(--primary-purple-light)', textDecoration: 'underline', fontSize: 'var(--font-size-sm)' }}>
                    Open dispute management
                  </Link>
                </section>

                <section>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: '0.5rem' }}>Audit history</h3>
                  {!details.auditAvailable ? (
                    <p>Audit access is not granted.</p>
                  ) : !details.auditLogs.length ? (
                    <p>No order audit events recorded.</p>
                  ) : (
                    details.auditLogs.map((log) => (
                      <details key={log.id} style={{ marginBottom: '0.5rem' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                          {time(log.createdAt)} · {log.actor?.username || log.actorId || 'System'} ·{' '}
                          {log.action} · {log.isSuccess ? 'Success' : 'Failed'}
                        </summary>
                        <p>{log.reason || 'No reason recorded'}</p>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)' }}>
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
export default OrderManagementWorkspace;
