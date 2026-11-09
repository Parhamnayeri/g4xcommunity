/**
 * frontend/src/services/adminPortal.ts — Admin Portal Client Services
 */

import { apiRequest } from './api';
import { normalizePagination } from './operations';
import {
  AdminOverviewResponse,
  AdminDepositItem,
  AdminTradeItem,
  AdminOfferItem,
  AdminAuditLogItem,
  RolesMatrixResponse,
} from '../types/adminPortal';

export async function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  return apiRequest<AdminOverviewResponse>('/api/admin/overview');
}

export async function fetchAdminDeposits(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}): Promise<{
  deposits: AdminDepositItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  const res = await apiRequest<any>(`/api/admin/deposits?${query.toString()}`);
  return {
    deposits: Array.isArray(res?.deposits) ? res.deposits : [],
    pagination: normalizePagination(res, params?.limit || 20),
  };
}

export async function reviewAdminDeposit(
  depositId: number,
  action: 'APPROVE' | 'REJECT',
  notes?: string
): Promise<{ success: boolean; result: any }> {
  return apiRequest(`/api/admin/deposits/${depositId}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, notes }),
  });
}

export async function fetchAdminTrades(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<{
  trades: AdminTradeItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  const res = await apiRequest<any>(`/api/admin/exchange/trades?${query.toString()}`);
  return {
    trades: Array.isArray(res?.trades) ? res.trades : [],
    pagination: normalizePagination(res, params?.limit || 20),
  };
}

export async function fetchAdminOffers(): Promise<{ offers: AdminOfferItem[] }> {
  return apiRequest('/api/admin/exchange/offers');
}

export async function fetchAdminAuditLogs(params?: {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  actorId?: string;
}): Promise<{
  logs: AdminAuditLogItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.action) query.set('action', params.action);
  if (params?.entityType) query.set('entityType', params.entityType);
  if (params?.actorId) query.set('actorId', params.actorId);
  const res = await apiRequest<any>(`/api/admin/audit-logs?${query.toString()}`);
  return {
    logs: Array.isArray(res?.logs) ? res.logs : [],
    pagination: normalizePagination(res, params?.limit || 20),
  };
}

export async function fetchRolesMatrix(): Promise<RolesMatrixResponse> {
  return apiRequest<RolesMatrixResponse>('/api/admin/roles-matrix');
}

export async function fetchAdminUsers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  accountStatus?: string;
}): Promise<{
  users: Array<{
    discordId: string;
    username: string;
    displayName: string | null;
    isActive: boolean;
    advertiserRank: string | null;
    roles: Array<{ roleKey: string; grantedAt: string }>;
    createdAt: string;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  if (params?.role) query.set('role', params.role);
  if (params?.accountStatus) query.set('accountStatus', params.accountStatus);
  const res = await apiRequest<any>(`/api/admin/users?${query.toString()}`);
  return {
    users: Array.isArray(res?.users) ? res.users : [],
    pagination: normalizePagination(res, params?.limit || 20),
  };
}

export async function updateAdminUserStatus(
  discordId: string,
  isActive: boolean,
  reason: string
): Promise<{ success: boolean; user: any }> {
  return apiRequest(`/api/admin/users/${discordId}/status`, {
    method: 'POST',
    body: JSON.stringify({ isActive, reason }),
  });
}

export async function updateAdminUserRole(
  discordId: string,
  roleKey: string,
  action: 'grant' | 'revoke',
  reason: string
): Promise<{ success: boolean; result: any }> {
  return apiRequest(`/api/admin/users/${discordId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ roleKey, action, reason }),
  });
}

export async function fetchAdminWithdrawals(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<{
  withdrawals: Array<{
    id: number;
    withdrawalRef: string;
    boosterId: string;
    boosterName: string;
    payoutMethod: string;
    status: string;
    requestedUsd: number;
    netUsd: number;
    destinationAddress: string;
    createdAt: string;
  }>;
}> {
  return apiRequest('/api/admin/withdrawals');
}

export async function reviewAdminWithdrawal(
  id: number,
  decision: 'approve_paid' | 'reject',
  data: {
    txHash?: string;
    bankReceiptRef?: string;
    reason?: string;
    notes?: string;
  }
): Promise<{ success: boolean; request: any }> {
  return apiRequest(`/api/admin/withdrawals/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...data }),
  });
}

export async function fetchUserBanHistory(discordId: string): Promise<{
  discordId: string;
  username: string;
  history: Array<{
    id: number;
    action: string;
    reason: string | null;
    previousStatus: boolean | null;
    resultingStatus: boolean | null;
    createdAt: string;
    actor: { id: string; username: string; displayName: string | null } | null;
  }>;
}> {
  return apiRequest(`/api/admin/users/${discordId}/ban-history`);
}

export async function updateWithdrawalMetadata(
  id: number,
  data: { notes?: string; adminNotes?: string; reason: string }
): Promise<{ success: boolean; request: any }> {
  return apiRequest(`/api/admin/withdrawals/${id}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchWithdrawalAuditHistory(id: number): Promise<{
  id: number;
  withdrawalRef: string;
  history: Array<{
    id: number;
    action: string;
    reason: string | null;
    createdAt: string;
    details: any;
    actor: { id: string; username: string; displayName: string | null } | null;
  }>;
}> {
  return apiRequest(`/api/admin/withdrawals/${id}/audit-history`);
}
