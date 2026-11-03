/**
 * frontend/src/services/ownerPortal.ts — Owner Portal Client Services
 */

import { apiRequest } from './api';
import {
  OwnerOverviewResponse,
  FeatureGateItem,
  FinancialConfigResponse,
  WalletsLedgersResponse,
  OwnerAuditLogItem,
  SecurityHealthResponse,
} from '../types/ownerPortal';

export async function fetchOwnerOverview(): Promise<OwnerOverviewResponse> {
  return apiRequest<OwnerOverviewResponse>('/api/owner/overview');
}

export async function fetchOwnerFeatureGates(): Promise<{
  success: boolean;
  gates: FeatureGateItem[];
  policyNotice: string;
}> {
  return apiRequest('/api/owner/feature-gates');
}

export async function fetchOwnerFinancialConfig(): Promise<FinancialConfigResponse> {
  return apiRequest<FinancialConfigResponse>('/api/owner/financial-config');
}

export async function updateOwnerFinancialConfig(
  configs: Record<string, string | number>,
  reason: string
): Promise<{ success: boolean; message: string; updatedKeys: string[] }> {
  return apiRequest('/api/owner/financial-config', {
    method: 'PUT',
    body: JSON.stringify({ configs, reason }),
  });
}

export async function fetchOwnerWalletsLedgers(params?: {
  page?: number;
  limit?: number;
}): Promise<WalletsLedgersResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  return apiRequest<WalletsLedgersResponse>(`/api/owner/wallets-ledgers?${query.toString()}`);
}

export async function fetchOwnerAuditLogs(params?: {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  actorId?: string;
}): Promise<{
  logs: OwnerAuditLogItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.action) query.set('action', params.action);
  if (params?.entityType) query.set('entityType', params.entityType);
  if (params?.actorId) query.set('actorId', params.actorId);
  return apiRequest(`/api/owner/audit-logs?${query.toString()}`);
}

export async function fetchOwnerSecurityHealth(): Promise<SecurityHealthResponse> {
  return apiRequest<SecurityHealthResponse>('/api/owner/security-health');
}
