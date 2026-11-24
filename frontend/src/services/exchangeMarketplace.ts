/**
 * frontend/src/services/exchangeMarketplace.ts
 *
 * Client API service for G4X Exchange Phase 2 & 3:
 * Eligibility, KYC Applications, Marketplace Listings, and Buy Orders Management.
 */

import { apiRequest } from './api';
import {
  ExchangeEligibilityResponse,
  ExchangeKycRequestItem,
  ExchangeBuyOrderItem,
  CreateBuyOrderPayload,
  UpdateBuyOrderPayload,
  ExchangeGameItem,
  ExchangeCurrencyItem,
  ExchangeRegionItem,
  ExchangeDeliveryMethodItem,
  ExchangeSellOfferItem,
  ExchangeTradeItem,
  SubmitSellOfferPayload,
  SellOfferPreviewData,
  ExchangePaymentItem,
  ExchangeEscrowItem,
  TradeCheckoutSummaryResponse,
  ExchangeDiscordRoomItem,
  ExchangeDiscordConfig,
  ExchangeProofItem,
  ExchangeSettlementItem,
  ExchangeDisputeItem,
  ExchangeNotificationItem,
  ExchangeOperationsOverviewKpis,
  ExchangeApprovalQueueItem,
  DisputeCategory,
  DisputeResolutionOutcome,
  BuyerDashboardData,
  SellerDashboardData,
  ExchangeTransactionDetailsItem,
} from '../types/exchange';

export interface PublicCatalogResponse {
  games: ExchangeGameItem[];
  currencies: ExchangeCurrencyItem[];
  regions: ExchangeRegionItem[];
  deliveryMethods: ExchangeDeliveryMethodItem[];
}

export interface MarketplaceOrdersResponse {
  orders: ExchangeBuyOrderItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminKycListResponse {
  items: ExchangeKycRequestItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Fetches public active catalog for games, currencies, regions, delivery methods
 */
export async function fetchPublicCatalog(): Promise<PublicCatalogResponse> {
  const res = await apiRequest<{ success: boolean; data: PublicCatalogResponse }>('/api/exchange/catalog');
  return res.data;
}

/**
 * Fetches current authenticated user's eligibility and KYC status
 */
export async function fetchExchangeEligibility(): Promise<ExchangeEligibilityResponse> {
  return await apiRequest<ExchangeEligibilityResponse>('/api/exchange/eligibility');
}

/**
 * Submits or resubmits Exchanger KYC application
 */
export async function submitExchangeKyc(data: { notes?: string; documentsMetaJson?: any }): Promise<{
  success: boolean;
  message: string;
  kyc: ExchangeKycRequestItem;
}> {
  return await apiRequest('/api/exchange/kyc/apply', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Admin: lists KYC requests
 */
export async function fetchAdminKycRequests(params?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<AdminKycListResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const queryString = query.toString() ? `?${query.toString()}` : '';

  return await apiRequest<AdminKycListResponse>(`/api/admin/exchange/kyc-requests${queryString}`);
}

/**
 * Admin: reviews KYC request
 */
export async function reviewAdminKycRequest(
  id: string,
  data: {
    action: 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'SUSPEND' | 'EXPIRE';
    notes?: string;
    expiresAt?: string;
  }
): Promise<{ success: boolean; message: string; kyc: ExchangeKycRequestItem }> {
  return await apiRequest(`/api/admin/exchange/kyc-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Admin: grants or revokes exchanger role directly
 */
export async function setAdminExchangerRole(
  discordId: string,
  data: { grant: boolean; reason?: string }
): Promise<{ success: boolean; targetDiscordId: string; grant: boolean }> {
  return await apiRequest(`/api/admin/exchange/users/${discordId}/exchanger-role`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Fetches marketplace listings with full filters
 */
export async function fetchMarketplaceOrders(params?: {
  gameId?: string;
  currencyId?: string;
  regionId?: string;
  deliveryMethodId?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  minAmountBaseUnits?: string;
  maxAmountBaseUnits?: string;
  minAvailableCapacity?: string;
  sort?: string;
  page?: number;
  limit?: number;
}): Promise<MarketplaceOrdersResponse> {
  const query = new URLSearchParams();
  if (params?.gameId) query.set('gameId', params.gameId);
  if (params?.currencyId) query.set('currencyId', params.currencyId);
  if (params?.regionId) query.set('regionId', params.regionId);
  if (params?.deliveryMethodId) query.set('deliveryMethodId', params.deliveryMethodId);
  if (params?.minPriceCents !== undefined && params.minPriceCents > 0)
    query.set('minPriceCents', String(params.minPriceCents));
  if (params?.maxPriceCents !== undefined && params.maxPriceCents > 0)
    query.set('maxPriceCents', String(params.maxPriceCents));
  if (params?.minAmountBaseUnits) query.set('minAmountBaseUnits', params.minAmountBaseUnits);
  if (params?.maxAmountBaseUnits) query.set('maxAmountBaseUnits', params.maxAmountBaseUnits);
  if (params?.minAvailableCapacity) query.set('minAvailableCapacity', params.minAvailableCapacity);
  if (params?.sort) query.set('sort', params.sort);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const queryString = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest<MarketplaceOrdersResponse>(`/api/exchange/orders${queryString}`);
}

/**
 * Fetches a single order by ID or orderCode
 */
export async function fetchMarketplaceOrderById(id: string): Promise<ExchangeBuyOrderItem> {
  return await apiRequest<ExchangeBuyOrderItem>(`/api/exchange/orders/${id}`);
}

/**
 * Fetches authenticated Exchanger's own orders
 */
export async function fetchMyBuyOrders(params?: { status?: string }): Promise<{ orders: ExchangeBuyOrderItem[] }> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest<{ orders: ExchangeBuyOrderItem[] }>(`/api/exchange/my-buy-orders${queryString}`);
}

/**
 * Creates a new Buy Order
 */
export async function createBuyOrder(data: CreateBuyOrderPayload): Promise<{
  success: boolean;
  message: string;
  order: ExchangeBuyOrderItem;
}> {
  return await apiRequest('/api/exchange/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Edits an order in DRAFT or PAUSED state
 */
export async function updateBuyOrder(
  id: string,
  data: UpdateBuyOrderPayload
): Promise<{ success: boolean; message: string; order: ExchangeBuyOrderItem }> {
  return await apiRequest(`/api/exchange/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Transitions order status (PUBLISH, PAUSE, RESUME, CANCEL)
 */
export async function transitionBuyOrderStatus(
  id: string,
  action: 'PUBLISH' | 'PAUSE' | 'RESUME' | 'CANCEL'
): Promise<{ success: boolean; message: string; order: ExchangeBuyOrderItem }> {
  return await apiRequest(`/api/exchange/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

// ─── Phase 4: Sell Offers & Trades API ───────────────────────────────────────

/**
 * Previews pricing, fees, and net payout for an intended sell offer
 */
export async function previewSellOffer(
  orderId: string,
  offeredAmountBaseUnits: string
): Promise<SellOfferPreviewData> {
  const res = await apiRequest<{ success: boolean; preview: SellOfferPreviewData }>(
    `/api/exchange/orders/${orderId}/offers/preview`,
    {
      method: 'POST',
      body: JSON.stringify({ offeredAmountBaseUnits }),
    }
  );
  return res.preview;
}

/**
 * Submits a new sell offer on a buy order
 */
export async function submitSellOffer(
  orderId: string,
  data: SubmitSellOfferPayload
): Promise<{ success: boolean; message: string; offer: ExchangeSellOfferItem }> {
  return await apiRequest(`/api/exchange/orders/${orderId}/offers`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Lists offers submitted on a buy order (Buyer/Staff/Owner only)
 */
export async function fetchOffersOnBuyOrder(
  orderId: string
): Promise<{ success: boolean; offers: ExchangeSellOfferItem[] }> {
  return await apiRequest<{ success: boolean; offers: ExchangeSellOfferItem[] }>(
    `/api/exchange/orders/${orderId}/offers`
  );
}

/**
 * Lists sell offers submitted by the current seller
 */
export async function fetchMySellOffers(): Promise<{
  success: boolean;
  offers: ExchangeSellOfferItem[];
}> {
  return await apiRequest<{ success: boolean; offers: ExchangeSellOfferItem[] }>(
    '/api/exchange/my-sell-offers'
  );
}

/**
 * Buyer accepts a pending sell offer -> creates trade & reserves capacity
 */
export async function acceptSellOffer(
  offerId: string
): Promise<{ success: boolean; message: string; trade: ExchangeTradeItem }> {
  return await apiRequest(`/api/exchange/offers/${offerId}/accept`, {
    method: 'POST',
  });
}

/**
 * Buyer rejects a pending sell offer
 */
export async function rejectSellOffer(
  offerId: string,
  reason?: string
): Promise<{ success: boolean; message: string; offer: ExchangeSellOfferItem }> {
  return await apiRequest(`/api/exchange/offers/${offerId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Seller withdraws their own pending sell offer
 */
export async function withdrawSellOffer(
  offerId: string
): Promise<{ success: boolean; message: string; offer: ExchangeSellOfferItem }> {
  return await apiRequest(`/api/exchange/offers/${offerId}/withdraw`, {
    method: 'POST',
  });
}

/**
 * Lists user's trades (as buyer or seller)
 */
export async function fetchTrades(params?: {
  role?: 'buyer' | 'seller';
  status?: string;
}): Promise<{ success: boolean; trades: ExchangeTradeItem[] }> {
  const query = new URLSearchParams();
  if (params?.role) query.set('role', params.role);
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest<{ success: boolean; trades: ExchangeTradeItem[] }>(
    `/api/exchange/trades${queryString}`
  );
}

/**
 * Fetches full trade details by ID or code
 */
export async function fetchTradeById(
  tradeId: string
): Promise<{ success: boolean; trade: ExchangeTradeItem }> {
  return await apiRequest<{ success: boolean; trade: ExchangeTradeItem }>(
    `/api/exchange/trades/${tradeId}`
  );
}

/**
 * Cancels an unpaid trade (AWAITING_PAYMENT) and releases capacity
 */
export async function cancelTrade(
  tradeId: string,
  reason?: string
): Promise<{ success: boolean; message: string; trade: ExchangeTradeItem }> {
  return await apiRequest(`/api/exchange/trades/${tradeId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ─── Phase 5: Payment Engine, Escrow & Checkout API ──────────────────────────

/**
 * Fetches trade checkout calculation preview, live wallet balances, and available gateways
 */
export async function fetchTradeCheckoutSummary(
  tradeId: string
): Promise<TradeCheckoutSummaryResponse> {
  return await apiRequest<TradeCheckoutSummaryResponse>(
    `/api/exchange/trades/${tradeId}/checkout`
  );
}

/**
 * Pays trade using buyer's central G4X wallet balance (immediate escrow lock)
 */
export async function payTradeWithWallet(
  tradeId: string
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem; escrow: ExchangeEscrowItem; trade: ExchangeTradeItem }> {
  return await apiRequest(
    `/api/exchange/trades/${tradeId}/pay/wallet`,
    {
      method: 'POST',
    }
  );
}

/**
 * Initiates hosted crypto payment via NOWPayments
 */
export async function payTradeWithNowPayments(
  tradeId: string,
  payCurrency?: string
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem; invoiceUrl: string }> {
  return await apiRequest(
    `/api/exchange/trades/${tradeId}/pay/nowpayments`,
    {
      method: 'POST',
      body: JSON.stringify({ payCurrency }),
    }
  );
}

/**
 * Initiates Bank Transfer / کارت به کارت checkout
 */
export async function initiateBankTransfer(
  tradeId: string
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem; bankDetails: any; instructions: string }> {
  return await apiRequest(
    `/api/exchange/trades/${tradeId}/pay/bank-transfer`,
    {
      method: 'POST',
    }
  );
}

/**
 * Submits bank payment receipt proof and reference (moves to PENDING_REVIEW)
 */
export async function submitBankReceipt(
  paymentId: string,
  data: {
    bankReference?: string;
    receiptUrl: string;
    senderNote?: string;
  }
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem }> {
  return await apiRequest(
    `/api/exchange/payments/${paymentId}/bank-receipt`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

/**
 * Admin: lists exchange payments with optional filters
 */
export async function adminFetchExchangePayments(params?: {
  tradeId?: string;
  status?: string;
  method?: string;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; payments: ExchangePaymentItem[]; totalCount: number }> {
  const query = new URLSearchParams();
  if (params?.tradeId) query.set('tradeId', params.tradeId);
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.method && params.method !== 'ALL') query.set('method', params.method);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest<{ success: boolean; payments: ExchangePaymentItem[]; totalCount: number }>(
    `/api/admin/exchange/payments${queryString}`
  );
}

/**
 * Admin: approves bank transfer payment, funds escrow, and confirms trade
 */
export async function adminApproveBankPayment(
  paymentId: string,
  reviewNote?: string
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem; escrow: ExchangeEscrowItem; trade: ExchangeTradeItem }> {
  return await apiRequest(
    `/api/admin/exchange/payments/${paymentId}/approve-bank`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewNote }),
    }
  );
}

/**
 * Admin: rejects bank transfer payment
 */
export async function adminRejectBankPayment(
  paymentId: string,
  reason?: string
): Promise<{ success: boolean; message: string; payment: ExchangePaymentItem }> {
  return await apiRequest(
    `/api/admin/exchange/payments/${paymentId}/reject-bank`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

/**
 * Admin: reviews bank transfer payment (approve or reject)
 */
export async function adminReviewExchangePayment(
  paymentId: string,
  options: { action: 'CONFIRM' | 'REJECT'; notes?: string }
): Promise<{ success: boolean; message: string }> {
  if (options.action === 'CONFIRM') {
    return await adminApproveBankPayment(paymentId, options.notes);
  } else {
    return await adminRejectBankPayment(paymentId, options.notes);
  }
}

/**
 * Admin: forces live status synchronization with NOWPayments API
 */
export async function adminSyncNowPayments(
  paymentId: string
): Promise<{ success: boolean; status: string; payment: ExchangePaymentItem }> {
  return await apiRequest(
    `/api/admin/exchange/payments/${paymentId}/sync-nowpayments`,
    {
      method: 'POST',
    }
  );
}

/**
 * Admin: cancels a trade and refunds funds back to the buyer
 */
export async function adminCancelRefundTrade(
  tradeId: string,
  reason?: string
): Promise<{ success: boolean; message: string; trade: ExchangeTradeItem }> {
  return await apiRequest(
    `/api/admin/exchange/trades/${tradeId}/cancel-refund`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

// ─── Phase 6: Discord Trade Rooms & Settings API ────────────────────────────

/**
 * Admin/Staff: manually ensures or retries creating the private Discord trade channel
 */
export async function ensureDiscordRoom(
  tradeId: string
): Promise<{ success: boolean; message: string; discordRoom: ExchangeDiscordRoomItem }> {
  return await apiRequest(
    `/api/admin/exchange/trades/${tradeId}/discord-room/ensure`,
    {
      method: 'POST',
    }
  );
}

/**
 * Admin/Staff: archives a completed or cancelled Discord trade room
 */
export async function archiveDiscordRoom(
  tradeId: string,
  reason?: string
): Promise<{ success: boolean; message: string; discordRoom: ExchangeDiscordRoomItem }> {
  return await apiRequest(
    `/api/admin/exchange/trades/${tradeId}/discord-room/archive`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

/**
 * Staff/Owner: retrieves current Discord Portal Category & Alert Channel settings
 */
export async function getExchangeDiscordConfig(): Promise<{
  success: boolean;
  config: ExchangeDiscordConfig;
}> {
  return await apiRequest<{ success: boolean; config: ExchangeDiscordConfig }>(
    `/api/exchange/config/discord`
  );
}

/**
 * Owner: updates Discord Portal Category & Alert Channel settings
 */
export async function updateExchangeDiscordConfig(data: {
  exchangeCategoryId?: string;
  exchangeArchiveCategoryId?: string;
  exchangeAlertChannelId?: string;
  reason?: string;
}): Promise<{
  success: boolean;
  message: string;
  config: ExchangeDiscordConfig;
}> {
  return await apiRequest(
    `/api/exchange/config/discord`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
}

// ─── Phase 7: Proofs, Confirmation, Disputes, Notifications & Admin Operations ───

export async function submitExchangeProof(
  tradeId: string,
  data: {
    proofType?: 'DELIVERY_PROOF' | 'ADDITIONAL_PROOF' | 'DISPUTE_EVIDENCE';
    fileUrl?: string;
    evidenceLinks?: string[];
    inGameDetails?: string;
    note?: string;
  }
): Promise<{ success: boolean; proof: ExchangeProofItem }> {
  return await apiRequest(`/api/exchange/trades/${tradeId}/proofs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getExchangeProofs(
  tradeId: string
): Promise<{ success: boolean; proofs: ExchangeProofItem[] }> {
  return await apiRequest<{ success: boolean; proofs: ExchangeProofItem[] }>(
    `/api/exchange/trades/${tradeId}/proofs`
  );
}

export async function confirmExchangeDelivery(
  tradeId: string,
  note?: string
): Promise<{ success: boolean; trade: ExchangeTradeItem; message: string }> {
  return await apiRequest(`/api/exchange/trades/${tradeId}/confirm-delivery`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function openExchangeDispute(
  tradeId: string,
  data: {
    category: DisputeCategory;
    description: string;
    evidenceLinks?: string[];
  }
): Promise<{ success: boolean; dispute: ExchangeDisputeItem }> {
  return await apiRequest(`/api/exchange/trades/${tradeId}/disputes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTradeDispute(
  tradeId: string
): Promise<{ success: boolean; dispute: ExchangeDisputeItem | null }> {
  return await apiRequest<{ success: boolean; dispute: ExchangeDisputeItem | null }>(
    `/api/exchange/trades/${tradeId}/dispute`
  );
}

export async function getTradeSettlement(
  tradeId: string
): Promise<{ success: boolean; settlement: ExchangeSettlementItem | null }> {
  return await apiRequest<{ success: boolean; settlement: ExchangeSettlementItem | null }>(
    `/api/exchange/trades/${tradeId}/settlement`
  );
}

export async function getExchangeNotifications(): Promise<{
  success: boolean;
  notifications: ExchangeNotificationItem[];
  unreadCount: number;
}> {
  return await apiRequest<{
    success: boolean;
    notifications: ExchangeNotificationItem[];
    unreadCount: number;
  }>(`/api/exchange/notifications`);
}

export async function markNotificationRead(
  notificationId: string
): Promise<{ success: boolean; notification: ExchangeNotificationItem }> {
  return await apiRequest(`/api/exchange/notifications/${notificationId}/read`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsRead(): Promise<{ success: boolean; message: string }> {
  return await apiRequest(`/api/exchange/notifications/mark-all-read`, {
    method: 'POST',
  });
}

// Admin Operations Workspace Services

export async function getExchangeAdminOverview(): Promise<{
  success: boolean;
  kpis: ExchangeOperationsOverviewKpis;
  recentSettlements: ExchangeSettlementItem[];
}> {
  return await apiRequest<{
    success: boolean;
    kpis: ExchangeOperationsOverviewKpis;
    recentSettlements: ExchangeSettlementItem[];
  }>(`/api/admin/exchange/overview`);
}

export async function getExchangeApprovalQueue(): Promise<{
  success: boolean;
  queue: ExchangeApprovalQueueItem[];
}> {
  return await apiRequest<{ success: boolean; queue: ExchangeApprovalQueueItem[] }>(
    `/api/admin/exchange/approval-queue`
  );
}

export async function approveExchangeTrade(
  tradeId: string,
  note?: string
): Promise<{ success: boolean; settlement: ExchangeSettlementItem; trade: ExchangeTradeItem; message: string }> {
  return await apiRequest(`/api/admin/exchange/trades/${tradeId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function rejectExchangeTrade(
  tradeId: string,
  reason: string
): Promise<{ success: boolean; trade: ExchangeTradeItem; message: string }> {
  return await apiRequest(`/api/admin/exchange/trades/${tradeId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function requestAdditionalExchangeProof(
  tradeId: string,
  reason: string
): Promise<{ success: boolean; trade: ExchangeTradeItem }> {
  return await apiRequest(`/api/admin/exchange/trades/${tradeId}/request-proof`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function addTradeInternalNote(
  tradeId: string,
  note: string
): Promise<{ success: boolean; trade: ExchangeTradeItem }> {
  return await apiRequest(`/api/admin/exchange/trades/${tradeId}/internal-note`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function getExchangeAdminTrades(params?: {
  page?: number;
  limit?: number;
  status?: string;
  gameId?: string;
  search?: string;
}): Promise<{
  success: boolean;
  trades: any[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.gameId && params.gameId !== 'ALL') query.set('gameId', params.gameId);
  if (params?.search) query.set('search', params.search);
  const qStr = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest(`/api/admin/exchange/trades${qStr}`);
}

export async function getExchangeAdminDisputes(params?: {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
}): Promise<{
  success: boolean;
  disputes: ExchangeDisputeItem[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.category && params.category !== 'ALL') query.set('category', params.category);
  const qStr = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest(`/api/admin/exchange/disputes${qStr}`);
}

export async function getExchangeAdminDisputeById(
  disputeId: string
): Promise<{ success: boolean; dispute: ExchangeDisputeItem }> {
  return await apiRequest(`/api/admin/exchange/disputes/${disputeId}`);
}

export async function resolveExchangeDispute(
  disputeId: string,
  data: {
    outcome: DisputeResolutionOutcome;
    buyerRefundCents?: number;
    sellerPayoutCents?: number;
    note: string;
  }
): Promise<{ success: boolean; dispute: ExchangeDisputeItem; message: string }> {
  return await apiRequest(`/api/admin/exchange/disputes/${disputeId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getExchangeAdminSettlements(params?: {
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  settlements: ExchangeSettlementItem[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qStr = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest(`/api/admin/exchange/settlements${qStr}`);
}

export async function getExchangeAdminExchangers(): Promise<{
  success: boolean;
  exchangers: any[];
}> {
  return await apiRequest(`/api/admin/exchange/exchangers`);
}

export async function getExchangeAdminAuditLogs(params?: {
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  logs: any[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qStr = query.toString() ? `?${query.toString()}` : '';
  return await apiRequest(`/api/admin/exchange/audit-logs${qStr}`);
}

// ─── Phase 8: User Dashboard & Transaction Details API Clients ────────────────

/**
 * Fetches comprehensive Buyer dashboard data, live reputation, and categorized lists
 */
export async function getExchangeBuyerDashboard(): Promise<BuyerDashboardData> {
  return await apiRequest('/api/exchange/dashboard/buyer');
}

/**
 * Fetches comprehensive Seller dashboard data, live reputation, currency volume, and categorized lists
 */
export async function getExchangeSellerDashboard(): Promise<SellerDashboardData> {
  return await apiRequest('/api/exchange/dashboard/seller');
}

/**
 * Fetches independent transaction details for a trade (all 16 PRD §12 fields)
 */
export async function getExchangeTransactionDetails(
  tradeId: string
): Promise<{ success: boolean; transaction: ExchangeTransactionDetailsItem }> {
  return await apiRequest(`/api/exchange/transactions/${tradeId}`);
}




