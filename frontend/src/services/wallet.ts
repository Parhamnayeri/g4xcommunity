/**
 * wallet.ts — Frontend API client service for Wallet Page (Website Phase 5)
 */

import { apiRequest } from './api';
import {
  WalletOverviewResponse,
  IrtQuoteResponse,
  ReceiptUploadResponse,
  SubmitIrtDepositInput,
  SubmitIrtDepositResponse,
  DepositHistoryResponse,
  LedgerHistoryResponse,
} from '../types/wallet';

/**
 * Fetch authoritative WalletV2 overview, separated breakdown, rates, and bank details
 */
export async function fetchWalletOverview(): Promise<WalletOverviewResponse> {
  return await apiRequest<WalletOverviewResponse>('/api/wallet/overview');
}

/**
 * Request an authoritative IRT quote based on target USD cents or Toman amount
 */
export async function fetchIrtQuote(options: {
  amountCents?: number;
  amountToman?: number;
}): Promise<IrtQuoteResponse> {
  const params = new URLSearchParams();
  if (options.amountCents !== undefined) {
    params.set('amountCents', String(options.amountCents));
  }
  if (options.amountToman !== undefined) {
    params.set('amountToman', String(options.amountToman));
  }
  return await apiRequest<IrtQuoteResponse>(`/api/wallet/quote/irt?${params.toString()}`);
}

/**
 * Upload receipt evidence image (PNG, JPEG, WEBP <= 5MB) to non-public server storage
 */
export async function uploadReceiptFile(
  fileData: string,
  fileName: string
): Promise<ReceiptUploadResponse> {
  return await apiRequest<ReceiptUploadResponse>('/api/wallet/receipts/upload', {
    method: 'POST',
    body: JSON.stringify({ fileData, fileName }),
  });
}

/**
 * Submit manual IRT deposit request with tracking reference and evidence
 */
export async function submitIrtDepositRequest(
  payload: SubmitIrtDepositInput
): Promise<SubmitIrtDepositResponse> {
  return await apiRequest<SubmitIrtDepositResponse>('/api/wallet/deposits/irt', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch paginated deposit history
 */
export async function fetchDepositHistory(
  page = 1,
  limit = 10
): Promise<DepositHistoryResponse> {
  return await apiRequest<DepositHistoryResponse>(
    `/api/wallet/deposits?page=${page}&limit=${limit}`
  );
}

/**
 * Fetch paginated double-entry ledger activity
 */
export async function fetchLedgerActivity(
  page = 1,
  limit = 10
): Promise<LedgerHistoryResponse> {
  return await apiRequest<LedgerHistoryResponse>(
    `/api/wallet/ledger?page=${page}&limit=${limit}`
  );
}
