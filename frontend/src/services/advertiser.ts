import { apiRequest } from './api';
import {
  AdvertiserOverviewResponse,
  AdvertiserOrdersResponse,
  PublicGamesResponse,
  AdvertiserOrder,
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

export async function createAdvertiserOrder(orderData: {
  gameSlug: string;
  serviceId: number;
  grossAmountUsd: string | number;
  orderType?: string;
  notes?: string;
}): Promise<{ success: boolean; order: AdvertiserOrder }> {
  return await apiRequest<{ success: boolean; order: AdvertiserOrder }>('/api/orders/create', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });
}
