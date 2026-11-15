/**
 * frontend/src/services/financialLedger.ts
 * Client service for G4X Financial Ledger, Audit Trail & Reconciliation (Phase 4)
 */

import { apiRequest } from './api';
import {
  UserFinancialRoleInfo,
  JournalRecordItem,
  TrialBalanceData,
  FinancialAuditLogItem,
  BalanceReconciliationItem,
  DoubleEntryTransactionType,
} from '../types/financialLedger';

export async function fetchUserFinancialRole(): Promise<UserFinancialRoleInfo> {
  return apiRequest<UserFinancialRoleInfo>('/api/admin/financial-ledger/role-tier');
}

export async function fetchDoubleEntryJournal(params?: {
  transactionType?: string;
  currency?: string;
  accountId?: string;
  referenceId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  entries: JournalRecordItem[];
}> {
  const query = new URLSearchParams();
  if (params?.transactionType) query.set('transactionType', params.transactionType);
  if (params?.currency) query.set('currency', params.currency);
  if (params?.accountId) query.set('accountId', params.accountId);
  if (params?.referenceId) query.set('referenceId', params.referenceId);
  if (params?.search) query.set('search', params.search);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-ledger/journal${qs ? `?${qs}` : ''}`);
}

export async function fetchTrialBalance(
  currency: 'USD' | 'IRR' = 'USD'
): Promise<{ success: boolean; trialBalance: TrialBalanceData }> {
  return apiRequest(`/api/admin/financial-ledger/trial-balance?currency=${currency}`);
}

export async function recordManualDoubleEntry(payload: {
  transactionType: DoubleEntryTransactionType;
  debitAccountId: string;
  creditAccountId: string;
  amountMinor: number;
  currency: string;
  referenceId?: string;
  description?: string;
}): Promise<{ success: boolean; message: string; journalRecord: JournalRecordItem }> {
  return apiRequest('/api/admin/financial-ledger/journal', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchFinancialAuditLogs(params?: {
  actionType?: string;
  adminId?: string;
  relatedAccountId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  logs: FinancialAuditLogItem[];
}> {
  const query = new URLSearchParams();
  if (params?.actionType) query.set('actionType', params.actionType);
  if (params?.adminId) query.set('adminId', params.adminId);
  if (params?.relatedAccountId) query.set('relatedAccountId', params.relatedAccountId);
  if (params?.search) query.set('search', params.search);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-ledger/audit-logs${qs ? `?${qs}` : ''}`);
}

export async function fetchBalanceReconciliations(params?: {
  accountId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  reconciliations: BalanceReconciliationItem[];
}> {
  const query = new URLSearchParams();
  if (params?.accountId) query.set('accountId', params.accountId);
  if (params?.status) query.set('status', params.status);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest(`/api/admin/financial-ledger/reconciliations${qs ? `?${qs}` : ''}`);
}

export async function performBalanceReconciliation(payload: {
  accountId: string;
  actualBalanceMinor: number;
  notes?: string;
  attachmentUrl?: string;
}): Promise<{
  success: boolean;
  message: string;
  reconciliation: BalanceReconciliationItem;
}> {
  return apiRequest('/api/admin/financial-ledger/reconciliations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resolveReconciliationDiscrepancy(
  reconciliationId: string,
  payload: {
    reason: string;
    notes?: string;
    attachmentUrl?: string;
  }
): Promise<{
  success: boolean;
  message: string;
  reconciliation: BalanceReconciliationItem;
}> {
  return apiRequest(`/api/admin/financial-ledger/reconciliations/${encodeURIComponent(reconciliationId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function reverseFinancialTransaction(
  transactionIdOrRef: string,
  payload: { reason: string }
): Promise<{
  success: boolean;
  message: string;
  originalTransactionId: string;
  reversalTransactionId: string;
  reversalRef: string;
}> {
  return apiRequest(`/api/admin/financial-ledger/transactions/${encodeURIComponent(transactionIdOrRef)}/reverse`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getLedgerCsvExportUrl(type: 'journal' | 'audit', params?: Record<string, string>): string {
  const query = new URLSearchParams({ type, ...(params || {}) });
  return `/api/admin/financial-ledger/export-csv?${query.toString()}`;
}

export async function downloadLedgerCsv(type: 'journal' | 'audit', params?: Record<string, string>): Promise<void> {
  const url = getLedgerCsvExportUrl(type, params);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Export failed with HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `g4x-${type}-export-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
