import { apiRequest } from './api';
import {
  DashboardOverviewResponse,
  DashboardOrdersHistoryResponse,
  DashboardTransactionsResponse,
} from '../types/dashboard';

export async function fetchDashboardOverview(): Promise<DashboardOverviewResponse> {
  return await apiRequest<DashboardOverviewResponse>('/api/dashboard/overview');
}

export async function fetchOrderHistory(params: {
  page?: number;
  limit?: number;
  status?: string;
  gameSlug?: string;
} = {}): Promise<DashboardOrdersHistoryResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.gameSlug && params.gameSlug !== 'all') query.set('gameSlug', params.gameSlug);

  const endpoint = `/api/dashboard/orders/history${query.toString() ? '?' + query.toString() : ''}`;
  return await apiRequest<DashboardOrdersHistoryResponse>(endpoint);
}

export async function fetchWalletTransactions(params: {
  page?: number;
  limit?: number;
} = {}): Promise<DashboardTransactionsResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));

  const endpoint = `/api/dashboard/transactions${query.toString() ? '?' + query.toString() : ''}`;
  return await apiRequest<DashboardTransactionsResponse>(endpoint);
}
