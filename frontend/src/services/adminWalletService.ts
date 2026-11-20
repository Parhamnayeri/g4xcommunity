/**
 * frontend/src/services/adminWalletService.ts
 *
 * Client service for Administrator & Owner User/Booster Wallet Controls:
 *  - Listing wallets with search & balance breakdowns
 *  - Adjusting balances (Bonus / Deduct)
 *  - Freezing/unfreezing funds or toggling account freeze state
 */

import { apiRequest } from './api';

export interface AdminWalletUser {
  discordId: string;
  username: string;
  displayName: string;
  roles: string[];
  availableBalance: number;
  availableBalanceCents: number;
  pendingEscrowBalance: number;
  pendingEscrowCents: number;
  frozenBalance: number;
  frozenBalanceCents: number;
  isFrozen: boolean;
  payoutAddress: string | null;
  payoutMethod: string | null;
  updatedAt: string;
}

export interface AdminWalletListResponse {
  success: boolean;
  wallets: AdminWalletUser[];
  totals: {
    totalUsersCount: number;
    totalAvailableUsd: number;
    totalEscrowUsd: number;
    totalFrozenUsd: number;
    frozenWalletsCount: number;
  };
}

export interface AdjustWalletPayload {
  action: 'BONUS' | 'DEDUCT';
  amount: number;
  reason: string;
  allowNegative?: boolean;
}

export interface FreezeWalletPayload {
  mode: 'FREEZE_AMOUNT' | 'UNFREEZE_AMOUNT' | 'FREEZE_WALLET' | 'UNFREEZE_WALLET';
  amount?: number;
  reason: string;
}

export interface WalletOperationResponse {
  success: boolean;
  message: string;
  wallet?: {
    discordId: string;
    availableBalance: number;
    pendingEscrowBalance: number;
    frozenBalance: number;
    isFrozen: boolean;
  };
}

export async function fetchAdminWallets(search?: string): Promise<AdminWalletListResponse> {
  const query = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiRequest<AdminWalletListResponse>(`/api/admin/finance/wallets${query}`);
}

export async function adjustAdminWallet(
  discordId: string,
  payload: AdjustWalletPayload
): Promise<WalletOperationResponse> {
  return apiRequest<WalletOperationResponse>(
    `/api/admin/finance/wallets/${encodeURIComponent(discordId)}/adjust`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function freezeAdminWallet(
  discordId: string,
  payload: FreezeWalletPayload
): Promise<WalletOperationResponse> {
  return apiRequest<WalletOperationResponse>(
    `/api/admin/finance/wallets/${encodeURIComponent(discordId)}/freeze`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export interface AdminDepositInvoice {
  id: number;
  intentRef: string;
  userId: string;
  username: string;
  displayName: string;
  advertiserRank: string;
  amountUsd: number;
  payCurrency: string;
  paymentId: string | null;
  invoiceUrl: string | null;
  status: 'WAITING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  provider: string;
}

export interface AdminDepositListResponse {
  success: boolean;
  deposits: AdminDepositInvoice[];
}

export async function fetchAdminDeposits(params?: {
  status?: string;
  search?: string;
}): Promise<AdminDepositListResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'all') query.set('status', params.status);
  if (params?.search && params.search.trim()) query.set('search', params.search.trim());
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<AdminDepositListResponse>(`/api/admin/finance/deposits${qs}`);
}

export async function confirmAdminDeposit(
  id: number,
  reason?: string
): Promise<{ success: boolean; message: string; deposit: any; wallet?: any }> {
  return apiRequest(`/api/admin/finance/deposits/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function cancelAdminDeposit(
  id: number,
  reason?: string
): Promise<{ success: boolean; message: string; deposit: any }> {
  return apiRequest(`/api/admin/finance/deposits/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
