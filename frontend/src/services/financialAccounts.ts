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

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 API CALLS: EXCHANGE RATES
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchExchangeRates(): Promise<{
  success: boolean;
  rates: import('../types/financialAccounts').ExchangeRateItem[];
}> {
  return apiRequest('/api/admin/financial-accounts/exchange-rates');
}

export async function fetchActiveExchangeRate(
  from = 'USD',
  to = 'IRR'
): Promise<{
  success: boolean;
  rate: import('../types/financialAccounts').ExchangeRateItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/exchange-rates/active?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function createExchangeRate(
  payload: import('../types/financialAccounts').CreateExchangeRatePayload
): Promise<{
  success: boolean;
  message: string;
  rate: import('../types/financialAccounts').ExchangeRateItem;
}> {
  return apiRequest('/api/admin/financial-accounts/exchange-rates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 API CALLS: INTERNAL TRANSFERS
// ─────────────────────────────────────────────────────────────────────────────

export async function executeInternalTransfer(
  payload: import('../types/financialAccounts').CreateTransferPayload
): Promise<{
  success: boolean;
  message: string;
  transfer: import('../types/financialAccounts').InternalTransferItem;
}> {
  return apiRequest('/api/admin/financial-accounts/transfers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchInternalTransfers(params?: {
  sourceAccountId?: string;
  destinationAccountId?: string;
  transferType?: string;
  currency?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  transfers: import('../types/financialAccounts').InternalTransferItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.sourceAccountId) query.set('sourceAccountId', params.sourceAccountId);
  if (params?.destinationAccountId) query.set('destinationAccountId', params.destinationAccountId);
  if (params?.transferType) query.set('transferType', params.transferType);
  if (params?.currency) query.set('currency', params.currency);
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-accounts/transfers${qs ? `?${qs}` : ''}`);
}

export function getTransfersCsvExportUrl(): string {
  return '/api/admin/financial-accounts/transfers/export-csv';
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 API CALLS: WITHDRAWALS & WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────

export async function requestPlatformWithdrawal(
  payload: import('../types/financialAccounts').RequestWithdrawalPayload
): Promise<{
  success: boolean;
  message: string;
  withdrawal: import('../types/financialAccounts').PlatformWithdrawalItem;
}> {
  return apiRequest('/api/admin/financial-accounts/withdrawals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPlatformWithdrawals(params?: {
  sourceAccountId?: string;
  status?: string;
  currency?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  withdrawals: import('../types/financialAccounts').PlatformWithdrawalItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.sourceAccountId) query.set('sourceAccountId', params.sourceAccountId);
  if (params?.status) query.set('status', params.status);
  if (params?.currency) query.set('currency', params.currency);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-accounts/withdrawals${qs ? `?${qs}` : ''}`);
}

export async function markWithdrawalProcessing(
  id: string
): Promise<{
  success: boolean;
  message: string;
  withdrawal: import('../types/financialAccounts').PlatformWithdrawalItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/withdrawals/${encodeURIComponent(id)}/process`, {
    method: 'POST',
  });
}

export async function completePlatformWithdrawal(
  id: string,
  payload: { referenceNumber?: string; attachmentUrl?: string; notes?: string }
): Promise<{
  success: boolean;
  message: string;
  withdrawal: import('../types/financialAccounts').PlatformWithdrawalItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/withdrawals/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function rejectPlatformWithdrawal(
  id: string,
  reason: string
): Promise<{
  success: boolean;
  message: string;
  withdrawal: import('../types/financialAccounts').PlatformWithdrawalItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/withdrawals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function cancelPlatformWithdrawal(
  id: string,
  reason?: string
): Promise<{
  success: boolean;
  message: string;
  withdrawal: import('../types/financialAccounts').PlatformWithdrawalItem;
}> {
  return apiRequest(`/api/admin/financial-accounts/withdrawals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

