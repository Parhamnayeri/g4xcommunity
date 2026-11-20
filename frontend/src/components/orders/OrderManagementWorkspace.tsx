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
  updateOrderStatus,
  ensureOrderDiscordChannel,
  createManagementOrder,
  fetchApprovedBoosters,
} from '../../services/operations';
import { fetchAdminFinanceOverview } from '../../services/adminPortal';
import { AdminFinanceOverviewResponse } from '../../types/adminPortal';
import { PlatformBalancesStrip } from '../admin/PlatformBalancesStrip';
import { extractExternalOrderIdAndCleanNotes, has13PercentFee, calculate13PercentSplit } from '../../utils/orderParsers';
import { AdminEditOrderModal } from './AdminEditOrderModal';
import { AdminOrderChangeRequestsModal } from './AdminOrderChangeRequestsModal';
import { fetchOrderChangeRequests } from '../../services/advertiser';
import { DynamicServiceFormRenderer } from './DynamicServiceFormRenderer';
import { DiscordWelcomeMessagePreview } from './DiscordWelcomeMessagePreview';
// BoostSpecsBadgeGrid imported in details workspace
import { BoostCategoryKey } from '../../types/boostSpecs';
import { OrderDetailsWorkspace, Action, actionLabels } from './OrderDetailsWorkspace';

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
const panelStyle: React.CSSProperties = { padding: '1rem', display: 'grid', gap: '1rem' };
const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
// Never render untrusted evidence references as executable URLs.
export function Evidence({ value }: { value: string }) {
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
  const [games, setGames] = useState<Array<{ slug: string; displayName: string; services?: Array<{ id: number; serviceKey: string; displayName: string; serviceMode?: string; formSchemaJson?: string | null; tempChannelTemplate?: string | null }> }>>([]);
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

  // Lifecycle & Status Control State
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [statusNote, setStatusNote] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Discord Channel Sync State
  const [syncingChannel, setSyncingChannel] = useState(false);

  // Admin & Owner Full Order Edit Modal State
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [syncChannelFeedback, setSyncChannelFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Financial Overview & Real-Time Platform Balances
  const [financeOverview, setFinanceOverview] = useState<AdminFinanceOverviewResponse | null>(null);
  const [loadingFinance, setLoadingFinance] = useState(false);

  // Change Requests Review State
  const [showChangeRequestsModal, setShowChangeRequestsModal] = useState(false);
  const [pendingChangeRequestsCount, setPendingChangeRequestsCount] = useState(0);

  // Create Order Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCategory, setCreateCategory] = useState<BoostCategoryKey>('mythic_plus');
  const [createBoostSpecs, setCreateBoostSpecs] = useState<Record<string, any>>({
    regionFaction: 'EU - Cross-Faction',
    keystoneLevel: '+10',
    runsCount: 1,
    dungeonSelection: '',
    timerGuarantee: 'Timed (In-Time)',
    armorStack: 'No Loot Traders',
  });
  const [createTitle, setCreateTitle] = useState('Mythic+ 10-20 Timed Bundle');
  const [createBoostModel, setCreateBoostModel] = useState('Mythic+ Keystone');
  const [createVpnRequirement, setCreateVpnRequirement] = useState('No VPN Required (Self-Play)');
  const [createGame, setCreateGame] = useState('wow_midnight');
  const [createServiceId, setCreateServiceId] = useState<number | ''>('');
  const [createAmountUsd, setCreateAmountUsd] = useState('');
  const [createBoosterPoolUsd, setCreateBoosterPoolUsd] = useState('');
  const [boosterPoolCustomized, setBoosterPoolCustomized] = useState(false);
  const [createOrderType, setCreateOrderType] = useState('group');
  const [createOrderMode, setCreateOrderMode] = useState('non_pilot');
  const [createRunsCount, setCreateRunsCount] = useState(1);
  const [createNotes, setCreateNotes] = useState('');
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
    if (!allowed) return;
    let current = true;
    fetchOrderChangeRequests('PENDING')
      .then((res) => {
        if (current && res?.changeRequests) {
          setPendingChangeRequestsCount(res.changeRequests.length);
        }
      })
      .catch(() => {});
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
          setTargetStatus(res.order.status || '');
          setStatusNote('');
          setStatusFeedback(null);
          setSyncChannelFeedback(null);
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
    if (pool > amount) {
      setCreateFeedback({ text: `Booster pool ($${pool.toFixed(2)}) cannot exceed the gross order amount ($${amount.toFixed(2)}).`, type: 'error' });
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

    const { externalOrderId: parsedOrderId, title: parsedTitle, cleanNotes } = extractExternalOrderIdAndCleanNotes(
      createNotes,
      createExternalOrderId,
      createTitle
    );

    setSubmittingCreate(true);
    setCreateFeedback(null);
    try {
      const res = await createManagementOrder({
        title: parsedTitle || undefined,
        boostModel: createBoostModel || undefined,
        vpnRequirement: createVpnRequirement || undefined,
        boostSpecs: createBoostSpecs,
        gameSlug: createGame,
        serviceId: Number(createServiceId),
        amountUsd: amount,
        boosterPoolUsd: pool,
        orderType: createOrderType,
        orderMode: createOrderMode,
        runsCount: createRunsCount,
        notes: cleanNotes || undefined,
        externalOrderId: parsedOrderId || undefined,
        sourcePlatform: createSourcePlatform,
      });
      setCreateFeedback({ text: res.message || 'Order created successfully!', type: 'success' });
      setTimeout(() => {
        setShowCreateModal(false);
        setCreateAmountUsd('');
        setCreateBoosterPoolUsd('');
        setBoosterPoolCustomized(false);
        setCreateTitle('Mythic+ 10-20 Timed Bundle');
        setCreateBoostModel('Mythic+ Keystone');
        setCreateCategory('mythic_plus');
        setCreateBoostSpecs({
          regionFaction: 'EU - Cross-Faction',
          keystoneLevel: '+10',
          runsCount: 1,
          dungeonSelection: '',
          timerGuarantee: 'Timed (In-Time)',
          armorStack: 'No Loot Traders',
        });
        setCreateVpnRequirement('No VPN Required (Self-Play)');
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
    setTargetStatus('');
    setStatusNote('');
    setStatusFeedback(null);
    setSyncChannelFeedback(null);
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
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{
                position: 'relative',
                borderColor: pendingChangeRequestsCount > 0 ? '#f59e0b' : undefined,
                color: pendingChangeRequestsCount > 0 ? '#fcd34d' : undefined,
                fontWeight: pendingChangeRequestsCount > 0 ? 700 : undefined,
              }}
              onClick={() => setShowChangeRequestsModal(true)}
              title="Review advertiser order edit and cancellation requests"
            >
              📋 Change Requests
              {pendingChangeRequestsCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    borderRadius: '10px',
                    padding: '0.1rem 0.45rem',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    marginLeft: '0.4rem',
                  }}
                >
                  {pendingChangeRequestsCount}
                </span>
              )}
            </button>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              className="btn btn-cta btn-sm"
              onClick={() => {
                setShowCreateModal(true);
                setCreateFeedback(null);
                setCreateAmountUsd('');
                setCreateBoosterPoolUsd('');
                setBoosterPoolCustomized(false);
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
                'waiting_for_confirm',
                'warranty',
                'done',
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
                    const statusLower = (o.status || '').toLowerCase();
                    let statusText = typeof o.simplifiedStatus === 'object'
                      ? o.simplifiedStatus.label
                      : o.simplifiedStatus || o.status;
                    let statusClass = 'badge-amber';

                    if (statusLower === 'waiting_for_confirm') {
                      statusText = '⏳ Waiting Confirm';
                      statusClass = 'badge-yellow';
                    } else if (statusLower === 'warranty') {
                      statusText = '🛡️ Warranty';
                      statusClass = 'badge-blue';
                    } else if (statusLower === 'done') {
                      statusText = '🔒 Done (24H Escrow)';
                      statusClass = 'badge-purple';
                    } else if (statusLower === 'completed') {
                      statusText = '✅ Completed';
                      statusClass = 'badge-green';
                    } else if (['approved', 'active'].includes(statusLower)) {
                      statusClass = 'badge-green';
                    } else if (['cancelled', 'disputed', 'rejected'].includes(statusLower)) {
                      statusClass = 'badge-danger';
                    } else if (['assigned', 'in_progress'].includes(statusLower)) {
                      statusClass = 'badge-blue';
                    }

                    return (
                      <tr key={o.id}>
                        <td>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-yellow)', fontSize: '0.9rem' }}>
                            {o.title || o.orderName || o.orderRef}
                          </div>
                          {(o.title || o.orderName) && (
                            <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--accent-lime)' }}>
                              {o.orderRef}
                            </div>
                          )}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {time(o.createdAt)}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                            {o.boostModel && (
                              <span className="badge badge-purple" style={{ fontSize: '0.65rem', padding: '1px 6px' }}>
                                {o.boostModel}
                              </span>
                            )}
                            {o.vpnRequirement && (
                              <span className="badge badge-blue" style={{ fontSize: '0.65rem', padding: '1px 6px' }}>
                                🛡️ {o.vpnRequirement}
                              </span>
                            )}
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
                          {['completed', 'done', 'waiting_for_confirm', 'warranty'].includes(statusLower) && (
                            <div style={{ fontSize: '0.68rem', color: (statusLower === 'done' || statusLower === 'completed') ? '#10B981' : 'var(--accent-lime)', fontFamily: 'monospace', marginTop: '2px' }}>
                              {(statusLower === 'done' || statusLower === 'completed') ? '✅ Withdrawable' : 'Pending Earnings'}: ${o.feeInfo?.boosterPoolUsd || '—'}
                            </div>
                          )}
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
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {hasRole('admin', 'owner') && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{
                                  borderColor: 'rgba(250, 204, 21, 0.45)',
                                  color: '#facc15',
                                  backgroundColor: 'rgba(250, 204, 21, 0.05)',
                                  fontWeight: 600,
                                }}
                                title="Full Order Edit & Financial Override (Admin/Owner)"
                                onClick={() => setEditingOrderId(o.id)}
                              >
                                ✏️ Edit
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openDetails(o.id)}
                            >
                              Details &amp; Actions
                            </button>
                          </div>
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
        <div className="studio-modal-backdrop workspace-backdrop" onClick={closeDetails}>
          <div
            ref={detailsDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="studio-modal-card studio-modal-card-workspace"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '90vw',
              maxWidth: '1400px',
              minWidth: 'min(1000px, 96vw)',
              height: '90vh',
              maxHeight: '90vh',
              padding: 0,
              backgroundColor: '#0c0d14',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {detailsLoading && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <LoadingState message="Loading lifecycle, evidence and history…" />
              </div>
            )}
            {detailsError && (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <p role="alert" style={{ color: '#EF4444' }}>{detailsError}</p>
                <button onClick={() => setRevision((n) => n + 1)} className="btn btn-secondary btn-sm">Retry details</button>
              </div>
            )}
            {!detailsLoading && !details && !detailsError && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)' }}>No order details available.</p>
                <button onClick={() => setRevision((n) => n + 1)} className="btn btn-secondary btn-sm">Retry details</button>
              </div>
            )}
            {!detailsLoading && details && (
              <OrderDetailsWorkspace
                details={details}
                actionError={actionError}
                feedback={feedback}
                action={action}
                setAction={setAction}
                reason={reason}
                setReason={setReason}
                receipt={receipt}
                setReceipt={setReceipt}
                submitAction={submitAction}
                busy={busy}
                targetStatus={targetStatus}
                setTargetStatus={setTargetStatus}
                statusNote={statusNote}
                setStatusNote={setStatusNote}
                updatingStatus={updatingStatus}
                statusFeedback={statusFeedback}
                onUpdateStatus={async (e) => {
                  e.preventDefault();
                  if (!targetStatus || targetStatus === details.status) return;
                  setUpdatingStatus(true);
                  setStatusFeedback(null);
                  try {
                    const res = await updateOrderStatus(details.orderId, targetStatus, statusNote.trim() || undefined);
                    setStatusFeedback({ text: res.message || 'Status updated successfully.', type: 'success' });
                    setStatusNote('');
                    setRevision((n) => n + 1);
                  } catch (err: any) {
                    setStatusFeedback({ text: err.message || 'Failed to update order status', type: 'error' });
                  } finally {
                    setUpdatingStatus(false);
                  }
                }}
                syncingChannel={syncingChannel}
                syncChannelFeedback={syncChannelFeedback}
                onSyncChannel={async () => {
                  setSyncingChannel(true);
                  setSyncChannelFeedback(null);
                  try {
                    const res = await ensureOrderDiscordChannel(details.orderId);
                    setSyncChannelFeedback({ text: res.message || 'Discord coordination channel synchronized.', type: 'success' });
                    setRevision((n) => n + 1);
                  } catch (err: any) {
                    setSyncChannelFeedback({ text: err.message || 'Failed to provision channel', type: 'error' });
                  } finally {
                    setSyncingChannel(false);
                  }
                }}
                opNotes={opNotes}
                setOpNotes={setOpNotes}
                opExternalId={opExternalId}
                setOpExternalId={setOpExternalId}
                opReason={opReason}
                setOpReason={setOpReason}
                opFeedback={opFeedback}
                savingOp={savingOp}
                onSaveOperational={async (e) => {
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
                approvedBoosters={approvedBoosters}
                directBoosterUserId={directBoosterUserId}
                setDirectBoosterUserId={setDirectBoosterUserId}
                directBoosterRole={directBoosterRole}
                setDirectBoosterRole={setDirectBoosterRole}
                submittingDirectAssign={submittingDirectAssign}
                directAssignFeedback={directAssignFeedback}
                onDirectBoosterAssign={handleDirectBoosterAssign}
                selectedClaims={selectedClaims}
                setSelectedClaims={setSelectedClaims}
                onConfirmRoster={(e) => {
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
                isReadOnly={isReadOnly}
                hasRole={hasRole}
                onClose={closeDetails}
                onOpenFullEditor={(orderId) => setEditingOrderId(orderId)}
              />
            )}
          </div>
        </div>
      )}
      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div
            className="studio-modal-card studio-modal-card-lg"
            style={{ width: 'min(1100px, 95vw)', maxWidth: '1100px', maxHeight: '92vh', overflowY: 'auto' }}
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
                {/* 1. Game & Service Selection (Top Level) */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.85rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                    🎮 Game *
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
                      style={{ width: '100%', marginTop: '0.35rem' }}
                    >
                      {games.map((g) => (
                        <option key={g.slug} value={g.slug}>
                          {g.displayName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                    ⚡ Service *
                    <select
                      className="input"
                      value={createServiceId}
                      onChange={(e) => setCreateServiceId(Number(e.target.value))}
                      style={{ width: '100%', marginTop: '0.35rem' }}
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

                {/* 2. Order Title */}
                <label style={{ fontSize: '0.82rem', display: 'block', marginBottom: '0.75rem' }}>
                  Order Title (Descriptive Name) *
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Mythic+ 10-20 Timed Bundle (4 Runs)"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </label>

                {/* 3. Dynamic Service Form Specifications */}
                <div style={{ marginBottom: '0.85rem' }}>
                  <DynamicServiceFormRenderer
                    selectedService={games.find((g) => g.slug === createGame)?.services?.find((s) => s.id === Number(createServiceId))}
                    activeCategory={createCategory}
                    onSelectCategory={(key, model, defTitle) => {
                      setCreateCategory(key);
                      setCreateBoostModel(model);
                      if (!createTitle || createTitle.includes('Bundle') || createTitle.includes('Clear') || createTitle.includes('Boost') || createTitle.includes('Package')) {
                        setCreateTitle(defTitle);
                      }
                    }}
                    specs={createBoostSpecs}
                    onUpdateSpecs={setCreateBoostSpecs}
                  />
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
                        if (!boosterPoolCustomized) {
                          if (has13PercentFee(createSourcePlatform)) {
                            const split = calculate13PercentSplit(num);
                            setCreateBoosterPoolUsd(split.netAvailable.toFixed(2));
                          } else {
                            setCreateBoosterPoolUsd(val);
                          }
                        }
                      }
                    }}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </label>

                <label style={{ fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Booster Pool Amount (USD) *</span>
                    {has13PercentFee(createSourcePlatform) && (parseFloat(createAmountUsd) || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const num = parseFloat(createAmountUsd) || 0;
                          if (num > 0) {
                            const split = calculate13PercentSplit(num);
                            setCreateBoosterPoolUsd(split.netAvailable.toFixed(2));
                            setBoosterPoolCustomized(true);
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-lime, #a3e635)',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        Auto-fill 87% (${calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable.toFixed(2)})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="input"
                    placeholder="e.g. 40.00"
                    value={createBoosterPoolUsd}
                    onChange={(e) => {
                      setCreateBoosterPoolUsd(e.target.value);
                      setBoosterPoolCustomized(true);
                    }}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </label>
              </div>

              {/* Live Financial Breakdown & Margin Preview */}
              {(() => {
                const parsedGross = parseFloat(createAmountUsd) || 0;
                const is13Fee = has13PercentFee(createSourcePlatform);
                const platformFeeAmount = is13Fee ? calculate13PercentSplit(parsedGross).platformFee : 0;
                const parsedPool = parseFloat(createBoosterPoolUsd) || 0;
                const netMargin = Math.round((parsedGross - platformFeeAmount - parsedPool) * 100) / 100;

                return (
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                      gap: '0.75rem',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Gross Sale
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                        ${parsedGross.toFixed(2)}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.68rem', color: is13Fee ? '#F87171' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {is13Fee ? '13% Market Fee' : 'Platform Fee'}
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: is13Fee ? '#F87171' : 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {is13Fee ? `-$${platformFeeAmount.toFixed(2)}` : '$0.00'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--accent-yellow)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Booster Pool
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                        ${parsedPool.toFixed(2)}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.68rem', color: netMargin >= 0 ? '#34D399' : '#EF4444', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Platform Margin
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: netMargin >= 0 ? '#34D399' : '#EF4444', fontFamily: 'monospace' }}>
                        ${netMargin.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {(parseFloat(createAmountUsd) || 0) > 0 && (parseFloat(createBoosterPoolUsd) || 0) > (parseFloat(createAmountUsd) || 0) && (
                <p style={{ color: 'var(--status-danger, #ef4444)', fontSize: '0.8rem', margin: 0 }}>
                  ⚠️ Warning: Booster Pool (${(parseFloat(createBoosterPoolUsd) || 0).toFixed(2)}) cannot exceed the Gross Sale Amount (${(parseFloat(createAmountUsd) || 0).toFixed(2)}).
                </p>
              )}

              {has13PercentFee(createSourcePlatform) &&
                (parseFloat(createAmountUsd) || 0) > 0 &&
                (parseFloat(createBoosterPoolUsd) || 0) > calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable && (
                  <p style={{ color: 'var(--status-danger, #ef4444)', fontSize: '0.8rem', margin: 0 }}>
                    ⚠️ Warning: Booster Pool (${(parseFloat(createBoosterPoolUsd) || 0).toFixed(2)}) exceeds defensible net available after 13% platform fee (${calculate13PercentSplit(parseFloat(createAmountUsd) || 0).netAvailable.toFixed(2)}).
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
                      if (!isNaN(num) && num > 0 && !boosterPoolCustomized) {
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

                <label style={{ fontSize: '0.82rem' }}>
                  VPN &amp; Security Requirement
                  <select
                    className="input"
                    value={createVpnRequirement}
                    onChange={(e) => setCreateVpnRequirement(e.target.value)}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                  >
                    <option value="No VPN Required (Self-Play)">No VPN Required (Self-Play)</option>
                    <option value="VPN Required — Client Country (Match IP)">VPN Required — Client Country (Match IP)</option>
                    <option value="VPN Required — EU Region">VPN Required — EU Region</option>
                    <option value="VPN Required — US Region">VPN Required — US Region</option>
                    <option value="ExitLag / Gaming VPN Recommended">ExitLag / Gaming VPN Recommended</option>
                  </select>
                </label>
              </div>

              <label style={{ fontSize: '0.82rem' }}>
                Order Notes / Special Instructions
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Buyer notes, contact handle, schedule requirements... (e.g. <t=&quot;Fast 10-20&quot;> <#JC100> fast)"
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  style={{ width: '100%', marginTop: '0.25rem' }}
                />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                  Tip: You can also use &lt;t="Order Title"&gt; and &lt;#EXT_ID&gt; tags inside Notes.
                </p>
                {createNotes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i) && (
                  <p style={{ color: 'var(--accent-lime)', fontSize: '0.78rem', marginTop: '0.2rem', marginBottom: 0 }}>
                    💡 Auto-detected Order Title: <strong>{createNotes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[1] || createNotes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[2] || createNotes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[3]}</strong> (will be automatically extracted and stripped from notes).
                  </p>
                )}
                {createNotes.match(/<#([^>]+)>/) && (
                  <p style={{ color: 'var(--accent-lime)', fontSize: '0.78rem', marginTop: '0.2rem', marginBottom: 0 }}>
                    💡 Auto-detected External Order ID: <strong>{createNotes.match(/<#([^>]+)>/)?.[1]}</strong> (will be automatically extracted and stripped from notes).
                  </p>
                )}
              </label>

              {/* 4. Discord Temporary Channel Welcome Message Live Preview */}
              <div style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                <DiscordWelcomeMessagePreview
                  orderTitle={createTitle}
                  orderIdPlaceholder="NEW"
                  boostModel={createBoostModel}
                  vpnRequirement={createVpnRequirement}
                  specs={createBoostSpecs}
                  notes={createNotes}
                  grossAmount={createAmountUsd || '0.00'}
                  boosterPool={createBoosterPoolUsd || '0.00'}
                  serviceTemplate={games.find((g) => g.slug === createGame)?.services?.find((s) => s.id === Number(createServiceId))?.tempChannelTemplate}
                />
              </div>

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

      {editingOrderId && (
        <AdminEditOrderModal
          isOpen={Boolean(editingOrderId)}
          orderId={editingOrderId}
          onClose={() => setEditingOrderId(null)}
          onSuccess={() => {
            setRevision((r) => r + 1);
            if (details && details.orderId === editingOrderId) {
              openDetails(editingOrderId);
            }
          }}
        />
      )}

      {showChangeRequestsModal && (
        <AdminOrderChangeRequestsModal
          isOpen={showChangeRequestsModal}
          onClose={() => setShowChangeRequestsModal(false)}
          onResolved={() => {
            setRevision((r) => r + 1);
          }}
        />
      )}
    </div>
  );
};
