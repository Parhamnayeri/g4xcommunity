import { apiRequest } from './api';
import {
  AdvertiserOverviewResponse,
  AdvertiserOrdersResponse,
  PublicGamesResponse,
  AdvertiserOrder,
  CreateOrderRequest,
  DepositIntent,
} from '../types/advertiser';

export async function fetchAdvertiserOverview(): Promise<AdvertiserOverviewResponse> {
  return await apiRequest<AdvertiserOverviewResponse>('/api/advertiser/portal-overview');
}

export async function fetchAdvertiserOrders(params: {
  page?: number;
  limit?: number;
  status?: string;
  gameSlug?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<AdvertiserOrdersResponse> {
  const query = new URLSearchParams();
  query.set('tab', 'advertiser');
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.gameSlug && params.gameSlug !== 'all') query.set('gameSlug', params.gameSlug);
  if (params.search && params.search.trim()) query.set('search', params.search.trim());
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);

  const endpoint = `/api/orders/dashboard-list?${query.toString()}`;
  return await apiRequest<AdvertiserOrdersResponse>(endpoint);
}

export async function updateOrderNotes(
  orderId: number,
  notes: string
): Promise<{ success: boolean; orderId: number; notes: string; message: string }> {
  return await apiRequest<{ success: boolean; orderId: number; notes: string; message: string }>(
    `/api/advertiser/orders/${orderId}/notes`,
    {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    }
  );
}

export async function requestOrderCancellation(
  orderId: number,
  reason: string
): Promise<{ success: boolean; status: 'cancelled' | 'pending_review'; message: string; disputeId?: number }> {
  return await apiRequest<{ success: boolean; status: 'cancelled' | 'pending_review'; message: string; disputeId?: number }>(
    `/api/advertiser/orders/${orderId}/cancel-request`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export async function fetchOrderChannelAccess(
  orderId: number
): Promise<{ success: boolean; channelId?: string; channelUrl?: string; channelName?: string; error?: string }> {
  return await apiRequest<{ success: boolean; channelId?: string; channelUrl?: string; channelName?: string; error?: string }>(
    `/api/orders/${orderId}/channel`
  );
}

export async function fetchPublicGames(): Promise<PublicGamesResponse> {
  return await apiRequest<PublicGamesResponse>('/api/public/games');
}

export async function createAdvertiserOrder(
  orderData: CreateOrderRequest
): Promise<{ success: boolean; order: AdvertiserOrder; isFunded?: boolean }> {
  return await apiRequest<{ success: boolean; order: AdvertiserOrder; isFunded?: boolean }>('/api/orders/create', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });
}

export async function createDepositIntent(
  amountUsd: number,
  payCurrency: string
): Promise<{
  success: boolean;
  deposit: any;
  instructions: { message: string; invoiceUrl?: string | null; payCurrency: string; amountUsd: number; provider: string };
}> {
  return await apiRequest('/api/advertiser/deposits/intent', {
    method: 'POST',
    body: JSON.stringify({ amountUsd, payCurrency }),
  });
}

export async function submitAdvertiserWithdrawal(
  amountUsd: number,
  destinationAddress: string,
  payoutMethod = 'USDT_BEP20',
  notes?: string
): Promise<{
  success: boolean;
  withdrawal: { id: number; ref: string; amountUsd: string; status: string; payoutAddress: string; createdAt: string };
  message: string;
}> {
  return await apiRequest('/api/advertiser/withdrawals', {
    method: 'POST',
    body: JSON.stringify({ amount: amountUsd, payoutAddress: destinationAddress, payoutMethod, notes }),
  });
}

export async function submitOrderChangeRequest(
  orderId: number,
  data: { requestType: 'EDIT' | 'CANCEL'; reason: string; proposedChanges?: any }
): Promise<{ success: boolean; changeRequest: any; message: string }> {
  return await apiRequest(`/api/advertiser/orders/${orderId}/change-request`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchOrderChangeRequests(
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
): Promise<{ success: boolean; changeRequests: any[] }> {
  const query = status ? `?status=${status}` : '';
  return await apiRequest(`/api/admin/order-change-requests${query}`);
}

export async function resolveOrderChangeRequest(
  id: number,
  decision: 'APPROVED' | 'REJECTED',
  reviewNote?: string
): Promise<{ success: boolean; status: string; message: string }> {
  return await apiRequest(`/api/admin/order-change-requests/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, reviewNote }),
  });
}

export async function updateAdvertiserRank(
  discordId: string,
  advertiserRank: string,
  reason?: string
): Promise<{ success: boolean; user: any; message: string }> {
  return await apiRequest(`/api/admin/users/${discordId}/advertiser-rank`, {
    method: 'PATCH',
    body: JSON.stringify({ advertiserRank, reason }),
  });
}

export async function fetchAdvertiserDeposits(): Promise<{ success: boolean; deposits: DepositIntent[] }> {
  return await apiRequest<{ success: boolean; deposits: DepositIntent[] }>('/api/advertiser/deposits');
}

export async function cancelAdvertiserDeposit(
  depositId: number
): Promise<{ success: boolean; message: string; deposit: DepositIntent }> {
  return await apiRequest<{ success: boolean; message: string; deposit: DepositIntent }>(
    `/api/advertiser/deposits/${depositId}/cancel`,
    {
      method: 'POST',
    }
  );
}
