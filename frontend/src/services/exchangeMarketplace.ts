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
