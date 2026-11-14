import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { OrderItem, OrderDiagnosticsData, PaginationMeta } from '../../types/operations';
import { apiRequest } from '../../services/api';
import {
  fetchManagementOrders,
  fetchOrderDiagnostics,
  publishOrderCard,
  reviewOrderStaff,
  approveOrderAdmin,
  payOrderFromWallet,
  cancelOrder,
  verifyOrderPayment,
  assignOrderRoster,
  refreshOrderDiscord,
  updateOrderOperational,
  createManagementOrder,
  fetchApprovedBoosters,
} from '../../services/operations';
import { fetchAdminFinanceOverview } from '../../services/adminPortal';
import { AdminFinanceOverviewResponse } from '../../types/adminPortal';
import { PlatformBalancesStrip } from '../admin/PlatformBalancesStrip';
import { extractExternalOrderIdAndCleanNotes, has13PercentFee, calculate13PercentSplit } from '../../utils/orderParsers';

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
  const allowed = hasRole('staff', 'manager', 'admin', 'owner');
  const isReadOnly = Boolean(readOnly || !hasRole('staff', 'manager', 'admin', 'owner'));
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
  const [games, setGames] = useState<Array<{ slug: string; displayName: string; services?: Array<{ id: number; serviceKey: string; displayName: string; serviceMode?: string }> }>>([]);
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

  // Financial Overview & Real-Time Platform Balances
  const [financeOverview, setFinanceOverview] = useState<AdminFinanceOverviewResponse | null>(null);
  const [loadingFinance, setLoadingFinance] = useState(false);

  // Create Order Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createGame, setCreateGame] = useState('wow_midnight');
  const [createServiceId, setCreateServiceId] = useState<number | ''>('');
  const [createAmountUsd, setCreateAmountUsd] = useState('');
  const [createBoosterPoolUsd, setCreateBoosterPoolUsd] = useState('');
  const [createOrderType, setCreateOrderType] = useState('group');
  const [createOrderMode, setCreateOrderMode] = useState('non_pilot');
  const [createRunsCount, setCreateRunsCount] = useState(1);
  const [createNotes, setCreateNotes] = useState('');
  const [createMythicKeyLevel, setCreateMythicKeyLevel] = useState('');
  const [createDungeonName, setCreateDungeonName] = useState('');
  const [createVpnLocation, setCreateVpnLocation] = useState('');
  const [createSourcePlatform, setCreateSourcePlatform] = useState('direct');
  const [createExternalOrderId, setCreateExternalOrderId] = useState('');
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Direct Booster Assignment State
  const [approvedBoosters, setApprovedBoosters] = useState<Array<{
    userId: string;
    username: string;
    displayName: string;
    roles: string[];
    hasActiveReservation: boolean;
    activeOrderId: number | null;
  }>>([]);
  const [directBoosterUserId, setDirectBoosterUserId] = useState('');
  const [directBoosterRole, setDirectBoosterRole] = useState('dps');
  const [submittingDirectAssign, setSubmittingDirectAssign] = useState(false);
  const [directAssignFeedback, setDirectAssignFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const mutationLock = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const detailsDialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    apiRequest<{ games: Array<{ slug: string; displayName: string }> }>('/api/public/games')
      .then((res) => {
        if (current) setGames(res.games || []);
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
    fetchManagementOrders({
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
    if (!allowed) return;
    let current = true;
    setLoadingFinance(true);
    fetchAdminFinanceOverview()
      .then((res) => {
        if (current && res?.success) {
          setFinanceOverview(res);
        }
      })
      .catch((err) => console.error('Failed to load finance overview in orders workspace:', err))
      .finally(() => {
        if (current) setLoadingFinance(false);
      });
    return () => {
      current = false;
    };
  }, [allowed, revision]);

  useEffect(() => {
    if (selectedId === null) return;
    let current = true;
    setDetailsLoading(true);
    setDetailsError('');
    setDetails(null);
    fetchOrderDiagnostics(selectedId)
      .then((res) => {
        if (current) {
          setDetails(res.order);
          setOpNotes(res.order.notes || '');
          setOpExternalId(res.order.externalOrderId || '');
          setDirectAssignFeedback(null);
          setDirectBoosterUserId('');
          fetchApprovedBoosters(res.order.gameSlug)
            .then((bRes) => {
              if (current) setApprovedBoosters(bRes.boosters || []);
            })
            .catch(() => {
              if (current) setApprovedBoosters([]);
            });
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

  const handleDirectBoosterAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!details || !directBoosterUserId) return;
    setSubmittingDirectAssign(true);
    setDirectAssignFeedback(null);
    try {
      const res = await assignOrderRoster(
        details.orderId,
        [{ userId: directBoosterUserId, assignedRole: directBoosterRole }],
        false
      );
      setDirectAssignFeedback({ text: res.message || 'Booster assigned directly!', type: 'success' });
      setDirectBoosterUserId('');
      setRevision((n) => n + 1);
    } catch (err: any) {
      setDirectAssignFeedback({ text: err.message || 'Direct assignment failed', type: 'error' });
    } finally {
      setSubmittingDirectAssign(false);
    }
  };

  const handleCreateOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(createAmountUsd);
    if (isNaN(amount) || amount <= 0) {
      setCreateFeedback({ text: 'Please enter a valid positive order amount in USD.', type: 'error' });
      return;
    }
    const pool = createBoosterPoolUsd ? parseFloat(createBoosterPoolUsd) : amount;
    if (isNaN(pool) || pool <= 0) {
      setCreateFeedback({ text: 'Please enter a valid booster pool amount in USD.', type: 'error' });
      return;
    }
    if (!createServiceId) {
      setCreateFeedback({ text: 'Please select a game service.', type: 'error' });
      return;
    }

    if (has13PercentFee(createSourcePlatform)) {
      const split = calculate13PercentSplit(amount);
      if (pool > split.netAvailable) {
        setCreateFeedback({
          text: `Booster pool ($${pool.toFixed(2)}) exceeds defensible net available after 13% platform fee ($${split.netAvailable.toFixed(2)}).`,
          type: 'error',
        });
        return;
      }
    }

    const { externalOrderId: parsedOrderId, cleanNotes } = extractExternalOrderIdAndCleanNotes(
      createNotes,
      createExternalOrderId
    );

    setSubmittingCreate(true);
    setCreateFeedback(null);
    try {
      const res = await createManagementOrder({
        gameSlug: createGame,
        serviceId: Number(createServiceId),
        amountUsd: amount,
        boosterPoolUsd: pool,
        orderType: createOrderType,
        orderMode: createOrderMode,
        runsCount: createRunsCount,
        notes: cleanNotes || undefined,
        externalOrderId: parsedOrderId || undefined,
        mythicKeyLevel: createMythicKeyLevel ? Number(createMythicKeyLevel) : undefined,
        dungeonName: createDungeonName.trim() || undefined,
        vpnLocation: createVpnLocation.trim() || undefined,
        sourcePlatform: createSourcePlatform,
      });
      setCreateFeedback({ text: res.message || 'Order created successfully!', type: 'success' });
      setTimeout(() => {
        setShowCreateModal(false);
        setCreateExternalOrderId('');
        setCreateNotes('');
        setRevision((n) => n + 1);
      }, 1200);
    } catch (err: any) {
      setCreateFeedback({ text: err.message || 'Failed to create order', type: 'error' });
    } finally {
      setSubmittingCreate(false);
    }
  };

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
      <Card style={{ padding: '1.5rem', display: 'grid', gap: '1rem', backgroundColor: 'var(--bg-surface)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#fff' }}>{title}</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{subtitle}</p>
          </div>
          <nav aria-label="Order portals" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {hasRole('manager', 'admin', 'owner') && (
              <Link to="/management/orders" className="btn btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                Management Portal
              </Link>
            )}
            {hasRole('admin', 'manager', 'owner') && (
              <Link to="/admin/orders" className="btn btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                Admin Portal
              </Link>
            )}
            {hasRole('owner') && (
              <Link to="/owner/orders" className="btn btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                Owner Portal
              </Link>
            )}
          </nav>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {(['g4x', 'advertiser'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm ${tab === value ? 'btn-cta' : 'btn-secondary'}`}
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
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => setRevision((n) => n + 1)}
            >
              ↻ Refresh
            </button>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={() => {
                setShowCreateModal(true);
                setCreateFeedback(null);
                if (!createServiceId && games.length > 0) {
                  const firstGame = games[0];
                  setCreateGame(firstGame.slug);
                  if (firstGame.services && firstGame.services.length > 0) {
                    setCreateServiceId(firstGame.services[0].id);
                  }
                }
              }}
            >
              + Create G4X Order
            </button>
          )}
        </div>

        {/* 4-Card Authoritative Financial Summary Grid */}
        {financeOverview?.totals && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '0.85rem',
            }}
          >
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                Total Gross Volume
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#fff', margin: '4px 0 2px' }}>
                {financeOverview.totals.grossVolumeUsd}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                All ecosystem orders
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                Net Platform Revenue
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#34D399', margin: '4px 0 2px' }}>
                {financeOverview.totals.netPlatformProfitUsd}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Earned G4X margins &amp; fees
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                Booster Pool Allocation
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent-yellow)', margin: '4px 0 2px' }}>
                {financeOverview.totals.boosterPoolUsd}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Payable to roster boosters
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                Active Escrow vs Completed
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: '#FBBF24', margin: '4px 0 2px' }}>
                {financeOverview.totals.activeEscrowUsd}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Settled: <strong style={{ color: '#fff' }}>{financeOverview.totals.completedVolumeUsd}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Per-Site Platform Balances Strip */}
        {tab === 'g4x' && financeOverview && (
          <PlatformBalancesStrip
            breakdown={financeOverview.byPlatform || []}
            selectedPlatform={filters.sourceWebsite}
            onSelectPlatform={(src) => {
              setFilters((f) => ({ ...f, sourceWebsite: src }));
              setAppliedFilters((f) => ({ ...f, sourceWebsite: src }));
              setPage(1);
            }}
            loading={loadingFinance}
          />
        )}

        {/* Origin Review Callout Banner */}
        {counts.needsReview > 0 && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.28)',
              color: '#FBBF24',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span>
              <strong>{counts.needsReview}</strong> historical order(s) need origin review. Use the <em>Needs review</em> source filter; no historical records are changed.
            </span>
          </div>
        )}

        {/* Filter Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedFilters({ ...filters });
            setPage(1);
          }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '0.85rem',
            alignItems: 'end',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            padding: '1.25rem',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Search Keywords
            </span>
            <input
              className="input"
              value={filters.search}
              placeholder="Ref, ID, customer, notes..."
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Order Status
            </span>
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Payment State
            </span>
            <select
              className="input"
              value={filters.paymentStatus}
              onChange={(e) => setFilters({ ...filters, paymentStatus: e.target.value })}
            >
              <option value="">All payment states</option>
              {['pending', 'verified', 'unneeded', 'refunded'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Game Service
            </span>
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
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                Platform Source
              </span>
              <select
                className="input"
                value={filters.sourceWebsite}
                onChange={(e) => setFilters({ ...filters, sourceWebsite: e.target.value })}
              >
                <option value="">All sources</option>
                {['direct', 'g2g', 'skycoach', 'eldorado', 'kingboost', 'overgear', 'needs_review'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              From Date (UTC)
            </span>
            <input
              type="date"
              className="input"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Through Date (UTC)
            </span>
            <input
              type="date"
              className="input"
              value={filters.endDate}
              min={filters.startDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', gridColumn: '1 / -1', paddingTop: '0.5rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => {
                setFilters(initialFilters);
                setAppliedFilters(initialFilters);
                setPage(1);
              }}
            >
              Reset Filters
            </button>
            <button className="btn btn-cta btn-sm" type="submit">
              Apply Filters
            </button>
          </div>
        </form>
      </Card>
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
            <div className="empty-state-box">
              <div className="empty-state-icon">📦</div>
              <div>No orders match these filters.</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)' }}>Try adjusting your search criteria or resetting filters.</div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID / Date</th>
                    <th>Platform</th>
                    <th>Game / Service</th>
                    <th>Price &amp; Net Pool</th>
                    <th>Status</th>
                    <th>Assigned Booster</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const statusText = typeof o.simplifiedStatus === 'object'
                      ? o.simplifiedStatus.label
                      : o.simplifiedStatus || o.status;
                    const statusLower = (o.status || '').toLowerCase();
                    const statusClass = ['completed', 'approved', 'active'].includes(statusLower)
                      ? 'badge-green'
                      : ['cancelled', 'disputed', 'rejected'].includes(statusLower)
                      ? 'badge-danger'
                      : ['assigned', 'in_progress'].includes(statusLower)
                      ? 'badge-blue'
                      : 'badge-amber';

                    return (
                      <tr key={o.id}>
                        <td>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-yellow)', fontSize: '0.9rem' }}>
                            {o.orderRef}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {time(o.createdAt)}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                            <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>
                              {o.sourceLabel}
                            </span>
                            {(o.externalOrderId || o.platformAccount?.displayName) && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                {o.externalOrderId ? `#${o.externalOrderId}` : o.platformAccount?.displayName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#ffffff' }}>{o.gameName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.serviceName}</div>
                        </td>
                        <td>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ffffff' }}>
                            ${o.grossAmountUsd} {o.currency}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                            Pool: ${o.feeInfo?.boosterPoolUsd || '—'}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span className={`badge ${statusClass}`}>
                              {statusText}
                            </span>
                            {o.paymentStatus && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                Pay: {o.paymentStatus}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: o.assignedBooster ? 600 : 400, color: o.assignedBooster ? '#ffffff' : 'var(--text-subtle)' }}>
                              {o.assignedBooster || 'Unassigned'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {o.assignedCount || 0} assigned · {o.runsCount || 0} runs
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openDetails(o.id)}
                          >
                            Details &amp; Actions
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
        <div className="studio-modal-backdrop" onClick={closeDetails}>
          <div
            ref={detailsDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="studio-modal-card studio-modal-card-xl"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(1050px, 100%)', maxHeight: '90vh' }}
          >
            <div className="studio-modal-header">
              <div>
                <h2 id="order-details-title" style={{ margin: 0, fontSize: '1.25rem' }}>
                  Order {details?.orderRef || `#${selectedId}`}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Lifecycle tracking, financial calculations, booster assignment roster, and proof review.
                </p>
              </div>
              <button
                ref={closeButton}
                type="button"
                disabled={busy}
                onClick={closeDetails}
                className="studio-modal-close"
                aria-label="Close"
              >
                ✕
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
                <div className="studio-modal-body" style={{ display: 'grid', gap: '1.25rem' }}>
                  {/* Top 3 Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    {/* Card 1: Game & Service */}
                    <div style={{ background: '#0E1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>
                          {details.gameName}
                        </span>
                        <span className="badge badge-purple">{details.serviceName}</span>
                      </div>
                      <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.84rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Mode &amp; Status:</span>
                          <span style={{ display: 'flex', gap: '6px' }}>
                            <span className="badge badge-blue">{details.orderMode === 'non_pilot' ? 'selfpay' : details.orderMode}</span>
                            <span className={`badge ${['completed', 'approved', 'active'].includes((details.status || '').toLowerCase()) ? 'badge-green' : ['cancelled', 'disputed'].includes((details.status || '').toLowerCase()) ? 'badge-danger' : 'badge-yellow'}`}>
                              {details.status}
                            </span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Customer:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.customerId || '—'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Creator:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.creatorId || '—'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>External Ref:</span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--accent-yellow)', fontWeight: 600 }}>{details.externalOrderId || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Payment & Fees */}
                    <div style={{ background: '#0E1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>Financial Ledger</span>
                        <span className={`badge ${details.paymentStatus === 'verified' ? 'badge-green' : details.paymentStatus === 'pending' ? 'badge-yellow' : 'badge-muted'}`}>
                          {details.paymentStatus}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.84rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Gross Amount:</span>
                          <span style={{ fontWeight: 700, color: '#fff' }}>{details.grossAmountUsd} {details.currency}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Booster Pool:</span>
                          <span style={{ fontWeight: 700, color: 'var(--accent-yellow)' }}>{details.boosterPoolUsd}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Platform Fee:</span>
                          <span>{details.platformFeeUsd}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Advertiser Fee:</span>
                          <span>{details.advertiserFeeUsd}</span>
                        </div>
                      </div>
                    </div>

                    {/* Card 3: Release Status */}
                    <div style={{ background: '#0E1017', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>Release &amp; Escrow</span>
                        <span className="badge badge-purple">{details.boostReleaseTracker?.stage || 'Not applicable'}</span>
                      </div>
                      <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.84rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Staff Review:</span>
                          <span>{time(details.boostReleaseTracker?.staffReviewedAt || null)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Final Approval:</span>
                          <span>{time(details.boostReleaseTracker?.adminFinalApprovedAt || null)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Hold Expires:</span>
                          <span style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>{time(details.boostReleaseTracker?.holdExpiresAt || null)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notes Callout */}
                  {details.notes && (
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '12px 16px', fontSize: '0.85rem' }}>
                      <strong style={{ color: 'var(--accent-yellow)', display: 'block', marginBottom: '4px' }}>Customer / Order Instructions:</strong>
                      <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{details.notes}</div>
                    </div>
                  )}

                  {/* Detailed Dashboard Sub-Cards (2-Column Grid on Desktop) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
                    {/* Sub-Card 1: Lifecycle & Next Step */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🧭</span> Lifecycle &amp; Required Actions
                      </h3>
                      <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {details.explanationEnglish}
                      </div>
                      <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.25)', fontSize: '0.82rem', color: '#C4B5FD' }}>
                        <strong style={{ color: '#fff' }}>Next Action:</strong> {details.requiredNextActionEnglish}
                      </div>
                      {details.publicationBlockReasons.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#EF4444', textTransform: 'uppercase' }}>Publication Blockers:</span>
                          {details.publicationBlockReasons.map((r, i) => (
                            <div key={i} style={{ fontSize: '0.8rem', color: '#FCA5A5', paddingLeft: '8px', borderLeft: '2px solid #EF4444' }}>
                              {r}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Sub-Card 2: Discord Synchronization */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>💬</span> Discord Synchronization
                      </h3>
                      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Board Message:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.discordMessageId || 'Not published'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Board Channel:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.discordChannelId || 'Not provisioned'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Execution Channel:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.executionChannelId || 'Not provisioned'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Review Channel:</span>
                          <span style={{ fontFamily: 'monospace' }}>{details.reviewChannelId || 'Not provisioned'}</span>
                        </div>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Stored channel/message references do not confirm live Discord connectivity.
                      </p>
                    </div>

                    {/* Sub-Card 3: Operational Fields */}
                    {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>⚙️</span> Operational Fields
                        </h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                          Update operational notes or external reference. Historical payments remain unchanged.
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
                          <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Operational Notes</span>
                            <textarea
                              className="input"
                              rows={2}
                              value={opNotes}
                              onChange={(e) => setOpNotes(e.target.value)}
                              placeholder="Operational notes or customer requirements..."
                            />
                          </label>
                          <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>External Order ID</span>
                            <input
                              className="input"
                              value={opExternalId}
                              onChange={(e) => setOpExternalId(e.target.value)}
                              placeholder="e.g. SKY-123456"
                            />
                          </label>
                          <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Audit Reason * (Min 5 chars)</span>
                            <input
                              className="input"
                              required
                              minLength={5}
                              placeholder="Reason for audit trail..."
                              value={opReason}
                              onChange={(e) => setOpReason(e.target.value)}
                            />
                          </label>
                          {opFeedback && (
                            <p style={{ color: opFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.82rem', margin: 0 }}>
                              {opFeedback.text}
                            </p>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                            <button
                              type="submit"
                              disabled={busy || savingOp || opReason.trim().length < 5}
                              className="btn btn-secondary btn-sm"
                            >
                              {savingOp ? 'Saving…' : 'Save Operational Changes'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* Sub-Card 4: Authorized Actions */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚡</span> Authorized Actions
                      </h3>
                      {isReadOnly ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', margin: 0 }}>
                          Staff read-only view: inspecting permitted orders. Creation, operational modification, cancellation, payment, and roster assignment actions are disabled.
                        </p>
                      ) : (
                        <>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                            Operational approval transitions order lifecycle. Real-money payouts remain guarded under double-entry escrow policy.
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {(Object.keys(actionLabels) as Action[])
                              .filter((a) => details.authorizedActions.includes(a))
                              .map((a) => (
                                <button
                                  key={a}
                                  className="btn btn-secondary btn-xs"
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
                              style={{ display: 'grid', gap: '0.65rem', padding: '12px', borderRadius: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
                            >
                              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent-yellow)' }}>{actionLabels[action]}</h4>
                              {action === 'pay_wallet' && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                                  Reserve {details.grossAmountUsd} from the creator's backed wallet. Available: {(details.creatorWalletAvailableCents / 100).toFixed(2)} USD.
                                </p>
                              )}
                              {action === 'verify_payment' ? (
                                <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Verified Order Receipt Ref</span>
                                  <input
                                    className="input"
                                    required
                                    value={receipt}
                                    onChange={(e) => setReceipt(e.target.value)}
                                  />
                                </label>
                              ) : (
                                ['cancel', 'staff_review', 'final_approve'].includes(action) && (
                                  <label style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Reason / Review Notes</span>
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
                              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="btn btn-secondary btn-xs"
                                  onClick={() => setAction(null)}
                                >
                                  Go back
                                </button>
                                <button type="submit" disabled={busy} className="btn btn-cta btn-xs">
                                  {busy ? 'Working…' : 'Confirm Action'}
                                </button>
                              </div>
                            </form>
                          )}
                        </>
                      )}
                    </div>

                    {/* Sub-Card 5: Roster & Direct Booster Assignment */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>👥</span> Roster &amp; Assignment
                      </h3>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Required Roles: <strong style={{ color: '#fff' }}>{details.requiredRoles.map((r) => `${r.quantity} ${r.roleName}`).join(', ') || 'Service default'}</strong>
                      </div>

                      {/* Current assignments */}
                      <div style={{ display: 'grid', gap: '0.4rem' }}>
                        {!details.assignments.length ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No boosters assigned yet.</div>
                        ) : (
                          details.assignments.map((a) => (
                            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', fontSize: '0.82rem' }}>
                              <div>
                                <span style={{ fontWeight: 600, color: '#fff' }}>{a.user.displayName || a.user.username}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '6px' }}>({a.assignedRole})</span>
                              </div>
                              <span className={`badge ${a.status === 'assigned' ? 'badge-green' : 'badge-muted'}`} style={{ fontSize: '0.68rem' }}>
                                {a.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Presign Applicants Form */}
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
                          style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.84rem' }}>Assign Registered Applicants</h4>
                          {!details.presigns.length ? (
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>No applicants presigned.</p>
                          ) : (
                            details.presigns.map((p) => (
                              <label key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', margin: '4px 0' }}>
                                <span>{p.user.displayName || p.user.username} {p.squadId ? `(Team ${p.squadId})` : ''}</span>
                                <select
                                  disabled={busy}
                                  className="input"
                                  style={{ padding: '2px 8px', fontSize: '0.78rem' }}
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
                            ))
                          )}
                          <button
                            className="btn btn-cta btn-xs"
                            type="submit"
                            style={{ marginTop: '0.5rem' }}
                            disabled={busy || !Object.keys(selectedClaims).length}
                          >
                            Confirm Roster
                          </button>
                        </form>
                      )}

                      {/* Direct Booster Assignment */}
                      {!isReadOnly && !['completed', 'cancelled'].includes(details.status) && (
                        <div style={{ padding: '10px', backgroundColor: 'rgba(250, 204, 21, 0.04)', borderRadius: '10px', border: '1px solid rgba(250, 204, 21, 0.2)' }}>
                          <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.84rem', color: 'var(--accent-yellow)' }}>⚡ Direct Booster Assignment</h4>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                            Assign an approved booster directly without requiring a presign.
                          </p>
                          <form onSubmit={handleDirectBoosterAssign} style={{ display: 'grid', gap: '0.5rem' }}>
                            <select
                              className="input"
                              value={directBoosterUserId}
                              onChange={(e) => setDirectBoosterUserId(e.target.value)}
                              required
                              style={{ fontSize: '0.8rem' }}
                            >
                              <option value="">— Choose Approved Booster —</option>
                              {approvedBoosters.map((b) => (
                                <option key={b.userId} value={b.userId} disabled={b.hasActiveReservation}>
                                  {b.displayName || b.username} ({b.roles.join(', ')}){b.hasActiveReservation ? ` [Busy: Order #${b.activeOrderId}]` : ''}
                                </option>
                              ))}
                            </select>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <select
                                className="input"
                                value={directBoosterRole}
                                onChange={(e) => setDirectBoosterRole(e.target.value)}
                                style={{ fontSize: '0.8rem', flex: 1 }}
                              >
                                <option value="tank">Tank</option>
                                <option value="healer">Healer</option>
                                <option value="dps">DPS</option>
                                <option value="booster">Booster</option>
                                <option value="pilot">Pilot</option>
                              </select>
                              <button
                                type="submit"
                                className="btn btn-cta btn-xs"
                                disabled={submittingDirectAssign || !directBoosterUserId}
                              >
                                {submittingDirectAssign ? 'Assigning...' : 'Assign'}
                              </button>
                            </div>
                          </form>
                          {directAssignFeedback && (
                            <p style={{ color: directAssignFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.8rem', marginTop: '0.4rem', marginBottom: 0 }}>
                              {directAssignFeedback.text}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Sub-Card 6: Runs & Proof */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🏆</span> Runs &amp; Proof Submission
                      </h3>
                      {!details.runs.length ? (
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No carry runs recorded.</p>
                      ) : (
                        details.runs.map((run) => (
                          <div key={run.id} style={{ padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff' }}>Run #{run.runNumber}</span>
                              <span className={`badge ${run.status === 'completed' ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: '0.68rem' }}>
                                {run.status}
                              </span>
                            </div>
                            {!run.proofs.length ? (
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No proof submitted yet.</div>
                            ) : (
                              run.proofs.map((proof) => (
                                <div key={proof.id} style={{ marginTop: '6px', fontSize: '0.8rem', padding: '6px 8px', borderRadius: '6px', background: 'rgba(0,0,0,0.25)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-yellow)' }}>
                                    <span>Proof #{proof.id} ({proof.proofType})</span>
                                    <span>{proof.status}</span>
                                  </div>
                                  <div style={{ margin: '4px 0' }}>
                                    <Evidence value={proof.evidenceUrl} />
                                  </div>
                                  {proof.description && <div style={{ color: 'var(--text-secondary)' }}>{proof.description}</div>}
                                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Reviewer: {proof.reviewedBy?.username || '—'} · {proof.reviewNotes || 'No notes'}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Sub-Card 7: Disputes & Holds */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚖️</span> Disputes &amp; Escrow Holds
                      </h3>
                      {!details.disputes.length && !details.escrowHolds.length ? (
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No active disputes or escrow holds on this order.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                          {details.disputes.map((d) => (
                            <div key={d.id} style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.82rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#F87171', fontWeight: 700 }}>
                                <span>Dispute #{d.id} ({d.disputeType})</span>
                                <span>{d.status}</span>
                              </div>
                              <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{d.description}</div>
                            </div>
                          ))}
                          {details.escrowHolds.map((h) => (
                            <div key={h.id} style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.8rem', color: '#FBBF24' }}>
                              Hold #{h.id}: {h.status} · {h.reason}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ paddingTop: '0.25rem' }}>
                        <Link to="/management?tab=disputes" className="btn btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                          Open Dispute Workspace &rarr;
                        </Link>
                      </div>
                    </div>

                    {/* Sub-Card 8: Audit History */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem', gridColumn: '1 / -1' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📜</span> Audit History Trail
                      </h3>
                      {!details.auditAvailable ? (
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Audit access is not granted.</p>
                      ) : !details.auditLogs.length ? (
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No order audit events recorded.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                          {details.auditLogs.map((log) => (
                            <details key={log.id} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px 12px', fontSize: '0.82rem' }}>
                              <summary style={{ cursor: 'pointer', fontWeight: 600, color: log.isSuccess ? '#10B981' : '#EF4444' }}>
                                {time(log.createdAt)} · {log.actor?.username || log.actorId || 'System'} · {log.action}
                              </summary>
                              {log.reason && <p style={{ margin: '6px 0 4px', color: 'var(--text-muted)' }}>{log.reason}</p>}
                              <pre style={{ background: '#090A0F', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px', fontSize: '0.76rem', color: '#A5B4FC', margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                {log.previousValues || '—'}
                                {'\n→\n'}
                                {log.newValues || '—'}
                              </pre>
                            </details>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="studio-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={closeDetails}
                  >
                    Close Details
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div
            className="studio-modal-card studio-modal-card-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="studio-modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Create G4X Order (Direct / External)</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  Create and fund an internal G4X or external partner order (G2G, SkyCoach, Eldorado, Kingboost, Overgear) with Discord sync.
                </p>
              </div>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setShowCreateModal(false)}
                disabled={submittingCreate}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrderSubmit}>
              <div className="studio-modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.82rem' }}>
                  Game *
                  <select
                    className="input"
                    value={createGame}
                    onChange={(e) => {
                      const newGameSlug = e.target.value;
                      setCreateGame(newGameSlug);
                      const g = games.find((item) => item.slug === newGameSlug);
                      if (g?.services && g.services.length > 0) {
                        setCreateServiceId(g.services[0].id);
                      } else {
                        setCreateServiceId('');
                      }
                    }}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  >
                    {games.map((g) => (
                      <option key={g.slug} value={g.slug}>
                        {g.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Service *
                  <select
                    className="input"
                    value={createServiceId}
                    onChange={(e) => setCreateServiceId(Number(e.target.value))}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  >
                    <option value="">— Select Service —</option>
                    {(games.find((g) => g.slug === createGame)?.services || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName} ({s.serviceKey})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.82rem' }}>
                  Gross Sale Amount (USD) *
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="input"
                    placeholder="e.g. 50.00"
                    value={createAmountUsd}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCreateAmountUsd(val);
                      const num = parseFloat(val);
                      if (!isNaN(num) && num > 0) {
                        if (has13PercentFee(createSourcePlatform)) {
                          const split = calculate13PercentSplit(num);
                          setCreateBoosterPoolUsd(split.netAvailable.toFixed(2));
                        } else if (!createBoosterPoolUsd) {
                          setCreateBoosterPoolUsd(val);
                        }
                      }
                    }}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Booster Pool Amount (USD) *
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="input"
                    placeholder="e.g. 40.00"
                    value={createBoosterPoolUsd}
                    onChange={(e) => setCreateBoosterPoolUsd(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </label>
              </div>

              {has13PercentFee(createSourcePlatform) && (parseFloat(createAmountUsd) || 0) > 0 && (
                <div
                  style={{
                    background: 'rgba(124, 58, 237, 0.15)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.82rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>
                    13% Platform Deduction: <strong>-${calculate13PercentSplit(parseFloat(createAmountUsd) || 0).platformFee.toFixed(2)}</strong>
                  </span>
                  <span style={{ color: 'var(--accent-lime)', fontWeight: 600 }}>
                    Net Available Base (87%): ${calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable.toFixed(2)}
                  </span>
                </div>
              )}

              {has13PercentFee(createSourcePlatform) &&
                (parseFloat(createAmountUsd) || 0) > 0 &&
                (parseFloat(createBoosterPoolUsd) || 0) > calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable && (
                  <p style={{ color: 'var(--status-danger, #ef4444)', fontSize: '0.8rem', margin: 0 }}>
                    ⚠️ Warning: Booster Pool ($${(parseFloat(createBoosterPoolUsd) || 0).toFixed(2)}) exceeds defensible net available after 13% platform fee ($${calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable.toFixed(2)}).
                  </p>
                )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.82rem' }}>
                  Order Source
                  <select
                    className="input"
                    value={createSourcePlatform}
                    onChange={(e) => {
                      const newPlat = e.target.value;
                      setCreateSourcePlatform(newPlat);
                      const num = parseFloat(createAmountUsd);
                      if (!isNaN(num) && num > 0) {
                        if (has13PercentFee(newPlat)) {
                          const split = calculate13PercentSplit(num);
                          setCreateBoosterPoolUsd(split.netAvailable.toFixed(2));
                        } else {
                          setCreateBoosterPoolUsd(createAmountUsd);
                        }
                      }
                    }}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  >
                    <option value="direct">Direct G4X</option>
                    <option value="g2g">G2G Marketplace</option>
                    <option value="skycoach">SkyCoach (13% Fee)</option>
                    <option value="eldorado">Eldorado</option>
                    <option value="kingboost">Kingboost (13% Fee)</option>
                    <option value="overgear">Overgear (13% Fee)</option>
                  </select>
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  External Order ID
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. JC100 (or use <#ID> in notes)"
                    value={createExternalOrderId}
                    onChange={(e) => setCreateExternalOrderId(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  />
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Order Type
                  <select
                    className="input"
                    value={createOrderType}
                    onChange={(e) => setCreateOrderType(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  >
                    <option value="group">Group</option>
                    <option value="solo">Solo</option>
                  </select>
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Order Mode
                  <select
                    className="input"
                    value={createOrderMode}
                    onChange={(e) => setCreateOrderMode(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  >
                    <option value="non_pilot">Selfplay (Non-Pilot)</option>
                    <option value="pilot">Piloted (Account Access)</option>
                  </select>
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Runs Count
                  <input
                    type="number"
                    min="1"
                    max="50"
                    className="input"
                    value={createRunsCount}
                    onChange={(e) => setCreateRunsCount(parseInt(e.target.value, 10) || 1)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.82rem' }}>
                  Mythic Key Level
                  <input
                    type="number"
                    min="2"
                    max="35"
                    className="input"
                    placeholder="e.g. 10"
                    value={createMythicKeyLevel}
                    onChange={(e) => setCreateMythicKeyLevel(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  />
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  Dungeon Name
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Ara-Kara"
                    value={createDungeonName}
                    onChange={(e) => setCreateDungeonName(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  />
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  VPN Location
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Germany / Frankfurt"
                    value={createVpnLocation}
                    onChange={(e) => setCreateVpnLocation(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  />
                </label>
              </div>

              <label style={{ fontSize: '0.82rem' }}>
                Order Notes / Special Instructions
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Buyer notes, contact handle, schedule requirements... (e.g. <#JC100> fast)"
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  style={{ width: '100%', marginTop: '0.25rem' }}
                />
                {createNotes.match(/<#([^>]+)>/) && (
                  <p style={{ color: 'var(--accent-lime)', fontSize: '0.78rem', marginTop: '0.35rem', marginBottom: 0 }}>
                    💡 Auto-detected External Order ID: <strong>{createNotes.match(/<#([^>]+)>/)?.[1]}</strong> (will be automatically extracted and stripped from notes).
                  </p>
                )}
              </label>

              {createFeedback && (
                <p style={{ color: createFeedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.85rem', margin: 0 }}>
                  {createFeedback.text}
                </p>
              )}

              </div>

              <div className="studio-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submittingCreate}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-cta"
                  disabled={submittingCreate || !createServiceId || !createAmountUsd}
                >
                  {submittingCreate ? 'Creating Order...' : 'Create & Fund Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
