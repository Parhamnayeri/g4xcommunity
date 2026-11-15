/**
 * frontend/src/services/financialAccounts.ts
 * Client service for Financial Accounts & Balance Management API (Phase 1)
 */

import { apiRequest } from './api';
import {
  FinancialAccountItem,
  FinancialTransactionItem,
  PlatformBalanceOverviewResponse,
  TomanAccountsOverviewResponse,
  CreateAccountPayload,
  UpdateAccountPayload,
  ManualAdjustmentPayload,
  FinancialAccountCategory,
  FinancialAccountType,
  FinancialCurrency,
  FinancialAccountStatus,
} from '../types/financialAccounts';

export async function fetchPlatformBalanceOverview(): Promise<PlatformBalanceOverviewResponse> {
  return apiRequest<PlatformBalanceOverviewResponse>('/api/admin/financial-accounts/platform-overview');
}

export async function fetchTomanAccountsOverview(): Promise<TomanAccountsOverviewResponse> {
  return apiRequest<TomanAccountsOverviewResponse>('/api/admin/financial-accounts/toman-overview');
}

export async function fetchFinancialAccounts(params?: {
  category?: FinancialAccountCategory;
  accountType?: FinancialAccountType;
  currency?: FinancialCurrency;
  status?: FinancialAccountStatus;
  search?: string;
}): Promise<{ success: boolean; count: number; accounts: FinancialAccountItem[] }> {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.accountType) query.set('accountType', params.accountType);
  if (params?.currency) query.set('currency', params.currency);
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-accounts${qs ? `?${qs}` : ''}`);
}

export async function fetchFinancialAccountDetails(idOrRef: string): Promise<{
  success: boolean;
  account: FinancialAccountItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/${encodeURIComponent(idOrRef)}`);
}

export async function createFinancialAccount(payload: CreateAccountPayload): Promise<{
  success: boolean;
  message: string;
  account: FinancialAccountItem;
}> {
  return apiRequest('/api/admin/financial-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateFinancialAccountMetadata(
  idOrRef: string,
  payload: UpdateAccountPayload
): Promise<{
  success: boolean;
  message: string;
  account: FinancialAccountItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/${encodeURIComponent(idOrRef)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function setFinancialAccountStatus(
  idOrRef: string,
  status: FinancialAccountStatus
): Promise<{
  success: boolean;
  message: string;
  account: FinancialAccountItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/${encodeURIComponent(idOrRef)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function recordManualAdjustment(payload: ManualAdjustmentPayload): Promise<{
  success: boolean;
  message: string;
  transaction: FinancialTransactionItem;
}> {
  return apiRequest('/api/admin/financial-accounts/adjustments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAccountTransactions(
  idOrRef: string,
  params?: { page?: number; limit?: number; direction?: string }
): Promise<{
  success: boolean;
  transactions: FinancialTransactionItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.direction) query.set('direction', params.direction);
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-accounts/${encodeURIComponent(idOrRef)}/transactions${qs ? `?${qs}` : ''}`);
}
