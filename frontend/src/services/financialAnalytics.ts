/**
 * frontend/src/services/financialAnalytics.ts
 * Client service for G4X Financial Snapshots, Advanced Analytics, P&L vs. Cash Flow, and Automated Reports (Phase 5).
 */

import { apiRequest } from './api';
import {
  SerializedFinancialSnapshot,
  SnapshotComparisonResult,
  AdvancedFinancialAnalytics,
  ProfitAndLossReportData,
  CashFlowReportData,
  SerializedAutomatedSchedule,
  SerializedGeneratedReport,
  SnapshotType,
  ReportExportFormat,
  ReportExportType,
} from '../types/financialAnalytics';

// ─── 1. SNAPSHOTS ─────────────────────────────────────────────────────────────

export interface ListSnapshotsParams {
  type?: SnapshotType;
  limit?: number;
}

export async function fetchFinancialSnapshots(
  params?: ListSnapshotsParams
): Promise<{ success: boolean; snapshots: SerializedFinancialSnapshot[] }> {
  const query = new URLSearchParams();
  if (params?.type) query.set('type', params.type);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest<{ success: boolean; snapshots: SerializedFinancialSnapshot[] }>(
    `/api/admin/financial-analytics/snapshots${qs ? `?${qs}` : ''}`
  );
}

export async function fetchFinancialSnapshotById(
  id: string
): Promise<{ success: boolean; snapshot: SerializedFinancialSnapshot }> {
  return apiRequest<{ success: boolean; snapshot: SerializedFinancialSnapshot }>(
    `/api/admin/financial-analytics/snapshots/${id}`
  );
}

export async function captureOnDemandSnapshot(data: {
  snapshotType?: SnapshotType;
  notes?: string;
}): Promise<{ success: boolean; snapshot: SerializedFinancialSnapshot }> {
  return apiRequest<{ success: boolean; snapshot: SerializedFinancialSnapshot }>(
    `/api/admin/financial-analytics/snapshots/capture`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function compareSnapshots(
  baseId: string,
  comparisonId: string
): Promise<{ success: boolean; comparison: SnapshotComparisonResult }> {
  const query = new URLSearchParams({ baseId, comparisonId });
  return apiRequest<{ success: boolean; comparison: SnapshotComparisonResult }>(
    `/api/admin/financial-analytics/snapshots/compare?${query.toString()}`
  );
}

// ─── 2. ADVANCED ANALYTICS & P&L / CASH FLOW ──────────────────────────────────

export interface AnalyticsFilterParams {
  periodType?: string;
  startDate?: string;
  endDate?: string;
  platform?: string;
}

export async function fetchAdvancedAnalytics(
  params?: AnalyticsFilterParams
): Promise<{ success: boolean; analytics: AdvancedFinancialAnalytics }> {
  const query = new URLSearchParams();
  if (params?.periodType) query.set('periodType', params.periodType);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.platform) query.set('platform', params.platform);
  const qs = query.toString();
  return apiRequest<{ success: boolean; analytics: AdvancedFinancialAnalytics }>(
    `/api/admin/financial-analytics/advanced${qs ? `?${qs}` : ''}`
  );
}

export async function fetchProfitAndLossReport(
  params?: AnalyticsFilterParams
): Promise<{ success: boolean; report: ProfitAndLossReportData }> {
  const query = new URLSearchParams();
  if (params?.periodType) query.set('periodType', params.periodType);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.platform) query.set('platform', params.platform);
  const qs = query.toString();
  return apiRequest<{ success: boolean; report: ProfitAndLossReportData }>(
    `/api/admin/financial-analytics/p-and-l${qs ? `?${qs}` : ''}`
  );
}

export async function fetchCashFlowReport(
  params?: AnalyticsFilterParams
): Promise<{ success: boolean; report: CashFlowReportData }> {
  const query = new URLSearchParams();
  if (params?.periodType) query.set('periodType', params.periodType);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  const qs = query.toString();
  return apiRequest<{ success: boolean; report: CashFlowReportData }>(
    `/api/admin/financial-analytics/cash-flow${qs ? `?${qs}` : ''}`
  );
}

export function getFinancialExportDownloadUrl(params: {
  reportType: ReportExportType;
  format: ReportExportFormat;
  periodType?: string;
  startDate?: string;
  endDate?: string;
  platform?: string;
}): string {
  const query = new URLSearchParams();
  query.set('reportType', params.reportType);
  query.set('format', params.format);
  if (params.periodType) query.set('periodType', params.periodType);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.platform) query.set('platform', params.platform);
  return `/api/admin/financial-analytics/export?${query.toString()}`;
}

// ─── 3. AUTOMATED REPORTING & SCHEDULES ───────────────────────────────────────

export async function fetchAutomatedSchedules(): Promise<{
  success: boolean;
  schedules: SerializedAutomatedSchedule[];
}> {
  return apiRequest<{ success: boolean; schedules: SerializedAutomatedSchedule[] }>(
    `/api/admin/financial-analytics/schedules`
  );
}

export async function updateAutomatedSchedule(
  id: string,
  data: Partial<{
    name: string;
    isEnabled: boolean;
    frequency: string;
    format: string;
    recipientEmails: string;
    targetPlatform: string;
  }>
): Promise<{ success: boolean; schedule: SerializedAutomatedSchedule }> {
  return apiRequest<{ success: boolean; schedule: SerializedAutomatedSchedule }>(
    `/api/admin/financial-analytics/schedules/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  );
}

export async function runAutomatedSchedule(
  id: string
): Promise<{ success: boolean; report: SerializedGeneratedReport }> {
  return apiRequest<{ success: boolean; report: SerializedGeneratedReport }>(
    `/api/admin/financial-analytics/schedules/${id}/run`,
    {
      method: 'POST',
    }
  );
}

export async function fetchGeneratedReports(limit = 50): Promise<{
  success: boolean;
  reports: SerializedGeneratedReport[];
}> {
  return apiRequest<{ success: boolean; reports: SerializedGeneratedReport[] }>(
    `/api/admin/financial-analytics/reports?limit=${limit}`
  );
}

export function getGeneratedReportDownloadUrl(id: string): string {
  return `/api/admin/financial-analytics/reports/${id}/download`;
}
