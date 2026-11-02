/**
 * withdraw.ts — سرویس کلاینت برای دریافت اطلاعات تسویه حساب، ثبت مقاصد پرداخت و درخواست برداشت
 */

import { apiRequest } from './api';
import {
  WithdrawalOverviewResponse,
  WithdrawalQuoteResponse,
  WithdrawalConfirmResponse,
  WithdrawalHistoryResponse,
  UserPayoutPreferenceData,
  WithdrawalPayoutMethod,
} from '../types/withdraw';

export async function fetchWithdrawalOverview(): Promise<WithdrawalOverviewResponse> {
  return await apiRequest<WithdrawalOverviewResponse>('/api/withdrawals/overview');
}

export async function updatePayoutPreferences(
  data: Partial<UserPayoutPreferenceData>
): Promise<{ success: boolean; preference: UserPayoutPreferenceData; error?: string }> {
  return await apiRequest('/api/payout-preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function requestWithdrawalQuote(data: {
  payoutMethod: WithdrawalPayoutMethod;
  requestedUsdCents: number;
  destinationAddress: string;
  destinationAccountHolder?: string;
}): Promise<WithdrawalQuoteResponse> {
  return await apiRequest<WithdrawalQuoteResponse>('/api/withdrawals/quote', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function confirmWithdrawalRequest(
  requestId: number
): Promise<WithdrawalConfirmResponse> {
  return await apiRequest<WithdrawalConfirmResponse>('/api/withdrawals/confirm', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
}

export async function cancelWithdrawalRequest(
  requestId: number,
  reason?: string
): Promise<{ success: boolean; request: any; wallet: any; error?: string }> {
  return await apiRequest('/api/withdrawals/cancel', {
    method: 'POST',
    body: JSON.stringify({ requestId, reason }),
  });
}

export async function fetchWithdrawalHistory(params: {
  page?: number;
  limit?: number;
  status?: string;
  payoutMethod?: string;
} = {}): Promise<WithdrawalHistoryResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status && params.status !== 'ALL') query.set('status', params.status);
  if (params.payoutMethod && params.payoutMethod !== 'ALL') query.set('payoutMethod', params.payoutMethod);

  return await apiRequest<WithdrawalHistoryResponse>(`/api/withdrawals/history?${query.toString()}`);
}

