/**
 * frontend/src/services/exchangeConfig.ts
 *
 * Client API service for G4X In-Game Currency & Items Exchange Configuration (Phase 1).
 */

import { apiRequest } from './api';
import {
  ExchangeOverviewStats,
  ExchangeGameItem,
  ExchangeCurrencyItem,
  ExchangeRegionItem,
  ExchangeDeliveryMethodItem,
  ExchangeFeeRuleItem,
  TradePricingCalculation,
  ExchangeAuditLogItem,
} from '../types/exchange';

export async function fetchExchangeOverview(): Promise<ExchangeOverviewStats> {
  const res = await apiRequest<{ success: boolean; data: ExchangeOverviewStats }>('/api/owner/exchange/overview');
  return res.data;
}

export async function fetchExchangeGames(): Promise<ExchangeGameItem[]> {
  const res = await apiRequest<{ success: boolean; data: ExchangeGameItem[] }>('/api/owner/exchange/games');
  return res.data;
}

export async function createExchangeGame(data: {
  name: string;
  slug: string;
  iconUrl?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
  reason?: string;
}): Promise<ExchangeGameItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeGameItem }>('/api/owner/exchange/games', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateExchangeGame(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    iconUrl: string;
    description: string;
    displayOrder: number;
    isActive: boolean;
    reason: string;
  }>
): Promise<ExchangeGameItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeGameItem }>(`/api/owner/exchange/games/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchExchangeCurrencies(gameId?: string): Promise<ExchangeCurrencyItem[]> {
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  const res = await apiRequest<{ success: boolean; data: ExchangeCurrencyItem[] }>(`/api/owner/exchange/currencies${query}`);
  return res.data;
}

export async function createExchangeCurrency(data: {
  gameId: string;
  name: string;
  slug: string;
  iconUrl?: string;
  unitLabel?: string;
  unitMultiplier: string;
  decimalPrecision?: number;
  minTradeBaseUnits: string;
  maxTradeBaseUnits: string;
  supportedRegionIds?: string[];
  deliveryMethodIds?: string[];
  displayOrder?: number;
  isActive?: boolean;
  reason?: string;
}): Promise<ExchangeCurrencyItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeCurrencyItem }>('/api/owner/exchange/currencies', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateExchangeCurrency(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    iconUrl: string;
    unitLabel: string;
    unitMultiplier: string;
    decimalPrecision: number;
    minTradeBaseUnits: string;
    maxTradeBaseUnits: string;
    supportedRegionIds: string[];
    deliveryMethodIds: string[];
    displayOrder: number;
    isActive: boolean;
    reason: string;
  }>
): Promise<ExchangeCurrencyItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeCurrencyItem }>(`/api/owner/exchange/currencies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchExchangeRegions(gameId?: string): Promise<ExchangeRegionItem[]> {
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  const res = await apiRequest<{ success: boolean; data: ExchangeRegionItem[] }>(`/api/owner/exchange/regions${query}`);
  return res.data;
}

export async function createExchangeRegion(data: {
  code: string;
  name: string;
  gameId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  reason?: string;
}): Promise<ExchangeRegionItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeRegionItem }>('/api/owner/exchange/regions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateExchangeRegion(
  id: string,
  data: Partial<{
    code: string;
    name: string;
    gameId: string | null;
    displayOrder: number;
    isActive: boolean;
    reason: string;
  }>
): Promise<ExchangeRegionItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeRegionItem }>(`/api/owner/exchange/regions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchExchangeDeliveryMethods(): Promise<ExchangeDeliveryMethodItem[]> {
  const res = await apiRequest<{ success: boolean; data: ExchangeDeliveryMethodItem[] }>('/api/owner/exchange/delivery-methods');
  return res.data;
}

export async function createExchangeDeliveryMethod(data: {
  code: string;
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
  reason?: string;
}): Promise<ExchangeDeliveryMethodItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeDeliveryMethodItem }>('/api/owner/exchange/delivery-methods', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateExchangeDeliveryMethod(
  id: string,
  data: Partial<{
    code: string;
    name: string;
    description: string;
    displayOrder: number;
    isActive: boolean;
    reason: string;
  }>
): Promise<ExchangeDeliveryMethodItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeDeliveryMethodItem }>(`/api/owner/exchange/delivery-methods/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchExchangeFeeRules(): Promise<ExchangeFeeRuleItem[]> {
  const res = await apiRequest<{ success: boolean; data: ExchangeFeeRuleItem[] }>('/api/owner/exchange/fee-rules');
  return res.data;
}

export async function createExchangeFeeRule(data: {
  scope: 'GLOBAL' | 'GAME' | 'CURRENCY';
  gameId?: string | null;
  currencyId?: string | null;
  buyerCommissionBps: number;
  sellerCommissionBps: number;
  paymentProcessingMode?: string;
  networkFeeMode?: string;
  minCommissionCents?: number | null;
  maxCommissionCents?: number | null;
  effectiveFrom?: string;
  isEnabled?: boolean;
  reason?: string;
}): Promise<ExchangeFeeRuleItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeFeeRuleItem }>('/api/owner/exchange/fee-rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function toggleExchangeFeeRule(
  id: string,
  isEnabled?: boolean,
  reason?: string
): Promise<ExchangeFeeRuleItem> {
  const res = await apiRequest<{ success: boolean; data: ExchangeFeeRuleItem }>(`/api/owner/exchange/fee-rules/${id}/toggle`, {
    method: 'PATCH',
    body: JSON.stringify({ isEnabled, reason }),
  });
  return res.data;
}

export async function previewExchangeFee(data: {
  quantityBaseUnits: string;
  unitMultiplier: string;
  pricePerUnitCents: number;
  gameId?: string | null;
  currencyId?: string | null;
  customRule?: any;
}): Promise<{ calculation: TradePricingCalculation; appliedRule: any }> {
  const res = await apiRequest<{
    success: boolean;
    data: { calculation: TradePricingCalculation; appliedRule: any };
  }>('/api/owner/exchange/fee-rules/preview', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function fetchExchangeAuditLogs(limit = 50, entityType?: string): Promise<ExchangeAuditLogItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (entityType) query.set('entityType', entityType);
  const res = await apiRequest<{ success: boolean; data: ExchangeAuditLogItem[] }>(`/api/owner/exchange/audit-logs?${query}`);
  return res.data;
}

export async function bootstrapExchangeDefaults(): Promise<any> {
  const res = await apiRequest<{ success: boolean; data: any }>('/api/owner/exchange/bootstrap', {
    method: 'POST',
  });
  return res.data;
}
