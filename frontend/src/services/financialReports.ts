/**
 * frontend/src/services/financialReports.ts
 * Client service for G4X Financial Reports & Advertiser Boosts (Phase 3)
 */

import { apiRequest } from './api';
import {
  ConsolidatedFinancialReportResponse,
  PlatformDetailReportResponse,
  AdvertiserBoostsReportResponse,
  ReportingOrderItem,
  ReportPeriodType,
} from '../types/financialReports';

export interface FetchReportParams {
  period?: ReportPeriodType;
  from?: string;
  to?: string;
}

export interface ListReportOrdersParams {
  platform?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface ListReportOrdersResponse {
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  orders: ReportingOrderItem[];
}

export async function fetchConsolidatedFinancialReport(
  params?: FetchReportParams
): Promise<ConsolidatedFinancialReportResponse> {
  const query = new URLSearchParams();
  if (params?.period) query.set('period', params.period);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const qs = query.toString();
  return apiRequest<ConsolidatedFinancialReportResponse>(
    `/api/admin/financial-reports/consolidated${qs ? `?${qs}` : ''}`
  );
}

export async function fetchPlatformFinancialReport(
  platform: string,
  params?: FetchReportParams
): Promise<PlatformDetailReportResponse> {
  const query = new URLSearchParams();
  if (params?.period) query.set('period', params.period);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const qs = query.toString();
  return apiRequest<PlatformDetailReportResponse>(
    `/api/admin/financial-reports/platform/${encodeURIComponent(platform)}${qs ? `?${qs}` : ''}`
  );
}

export async function fetchAdvertiserBoostsReport(
  params?: FetchReportParams
): Promise<AdvertiserBoostsReportResponse> {
  const query = new URLSearchParams();
  if (params?.period) query.set('period', params.period);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const qs = query.toString();
  return apiRequest<AdvertiserBoostsReportResponse>(
    `/api/admin/financial-reports/advertiser-boosts${qs ? `?${qs}` : ''}`
  );
}

export async function fetchReportOrders(
  params: ListReportOrdersParams
): Promise<ListReportOrdersResponse> {
  const query = new URLSearchParams();
  if (params.platform) query.set('platform', params.platform);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortDirection) query.set('sortDirection', params.sortDirection);
  const qs = query.toString();
  return apiRequest<ListReportOrdersResponse>(
    `/api/admin/financial-reports/orders${qs ? `?${qs}` : ''}`
  );
}

export function getReportsCsvExportUrl(params?: {
  platform?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const query = new URLSearchParams();
  if (params?.platform) query.set('platform', params.platform);
  if (params?.status) query.set('status', params.status);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  const qs = query.toString();
  return `/api/admin/financial-reports/export-csv${qs ? `?${qs}` : ''}`;
}

export async function downloadReportsCsv(params?: {
  platform?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<void> {
  const url = getReportsCsvExportUrl(params);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Export failed with HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `g4x-financial-report-${params?.platform || 'all'}-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
