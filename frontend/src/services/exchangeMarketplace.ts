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

