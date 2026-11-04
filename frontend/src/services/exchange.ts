import { apiRequest } from './api';
import { normalizePagination } from './operations';
import {
  ExchangerOffer,
  GoldTrade,
  GoldTradeQuote,
  P2pFundingQuote,
  ExchangerStatusResponse,
  ExchangerOverviewResponse,
  PaginationMeta,
} from '../types/exchange';

export interface OffersResponse {
  success: boolean;
  offers: ExchangerOffer[];
  pagination: PaginationMeta;
}

export interface TradesResponse {
  success: boolean;
  trades: GoldTrade[];
  pagination: PaginationMeta;
}

export async function fetchActiveOffers(params?: {
  serviceType?: string;
  currency?: string;
  page?: number;
  limit?: number;
  sortOrder?: string;
}): Promise<OffersResponse> {
  const query = new URLSearchParams();
  if (params?.serviceType && params.serviceType !== 'ALL') query.append('serviceType', params.serviceType);
  if (params?.currency && params.currency !== 'ALL') query.append('currency', params.currency);
  if (params?.page) query.append('page', String(params.page));
  if (params?.limit) query.append('limit', String(params.limit));
  if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

  const qs = query.toString();
  const res = await apiRequest<any>(`/api/marketplace/offers${qs ? `?${qs}` : ''}`);
  return {
    success: res?.success ?? true,
    offers: Array.isArray(res?.offers) ? res.offers : [],
    pagination: normalizePagination(res, params?.limit || 20),
  };
}

export async function fetchOfferById(id: number): Promise<{ success: boolean; offer: ExchangerOffer }> {
  return apiRequest<{ success: boolean; offer: ExchangerOffer }>(`/api/marketplace/offers/${id}`);
}

export async function fetchExchangerStatus(): Promise<ExchangerStatusResponse> {
  return apiRequest<ExchangerStatusResponse>('/api/marketplace/exchanger/status');
}

export async function fetchExchangerOverview(): Promise<ExchangerOverviewResponse> {
  const res = await apiRequest<any>('/api/marketplace/exchanger/overview');
  const userSummary = res?.profile || res?.exchanger || {
    discordId: '',
    username: 'Exchanger',
    displayName: 'Exchanger',
  };
  return {
    success: res?.success ?? true,
    profile: userSummary,
    exchanger: userSummary,
    wallet: res?.wallet || {
      availableCents: 0,
      availableUsd: '0.00',
      reservedCents: 0,
      reservedUsd: '0.00',
    },
    metrics: res?.metrics || {
      activeOffersCount: 0,
      totalTradesCount: 0,
      pendingDeliveryCount: 0,
      pendingPaymentCount: 0,
      settledTradesCount: 0,
      settledVolumeUsdCents: 0,
      settledVolumeUsd: '0.00',
    },
    featureGates: res?.featureGates || {
      p2pSettlementEnabled: false,
    },
  };
}

export async function fetchExchangerOffers(): Promise<{ success: boolean; offers: ExchangerOffer[] }> {
  return apiRequest<{ success: boolean; offers: ExchangerOffer[] }>('/api/marketplace/exchanger/offers');
}

export async function createExchangerOffer(input: {
  serviceType: string;
  settlementCurrency: string;
  commissionPercentage: number;
  feeCalculationBasis?: string;
  feePayer?: string;
  minAmount?: number;
  maxAmount?: number;
  terms?: string;
}): Promise<{ success: boolean; offer: ExchangerOffer }> {
  return apiRequest<{ success: boolean; offer: ExchangerOffer }>('/api/marketplace/exchanger/offers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateExchangerOffer(
  id: number,
  input: {
    commissionPercentage?: number;
    minAmount?: number;
    maxAmount?: number;
    terms?: string;
    status?: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  }
): Promise<{ success: boolean; offer: ExchangerOffer }> {
  return apiRequest<{ success: boolean; offer: ExchangerOffer }>(`/api/marketplace/exchanger/offers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function fetchExchangerTrades(params?: {
  status?: string;
  settlementMethod?: string;
  page?: number;
  limit?: number;
  sortOrder?: string;
}): Promise<TradesResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'ALL') query.append('status', params.status);
  if (params?.settlementMethod && params.settlementMethod !== 'ALL') query.append('settlementMethod', params.settlementMethod);
  if (params?.page) query.append('page', String(params.page));
  if (params?.limit) query.append('limit', String(params.limit));
  if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

  const qs = query.toString();
  const res = await apiRequest<any>(`/api/marketplace/exchanger/trades${qs ? `?${qs}` : ''}`);
  return {
    success: res?.success ?? true,
    trades: Array.isArray(res?.trades) ? res.trades : [],
    pagination: normalizePagination(res, params?.limit || 10),
  };
}

export async function submitExchangerPayment(
  tradeId: number,
  paymentRef: string,
  paymentMethod: string,
  amount?: string
): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/exchanger/trades/${tradeId}/payment`, {
    method: 'POST',
    body: JSON.stringify({ paymentRef, paymentMethod, amount }),
  });
}

export async function verifyExchangerGold(tradeId: number): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/exchanger/trades/${tradeId}/verify-gold`, {
    method: 'POST',
  });
}

export async function fetchAdvertiserTrades(params?: {
  status?: string;
  settlementMethod?: string;
  page?: number;
  limit?: number;
  sortOrder?: string;
}): Promise<TradesResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'ALL') query.append('status', params.status);
  if (params?.settlementMethod && params.settlementMethod !== 'ALL') query.append('settlementMethod', params.settlementMethod);
  if (params?.page) query.append('page', String(params.page));
  if (params?.limit) query.append('limit', String(params.limit));
  if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

  const qs = query.toString();
  const res = await apiRequest<any>(`/api/marketplace/advertiser/trades${qs ? `?${qs}` : ''}`);
  return {
    success: res?.success ?? true,
    trades: Array.isArray(res?.trades) ? res.trades : [],
    pagination: normalizePagination(res, params?.limit || 10),
  };
}

export async function requestGoldTradeQuote(params: {
  buyerId: string;
  offerId?: number;
  gameSlug?: string;
  region?: string;
  realm?: string;
  faction?: string;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  settlementMethod: string;
}): Promise<{ success: boolean; quote: GoldTradeQuote }> {
  return apiRequest<{ success: boolean; quote: GoldTradeQuote }>('/api/marketplace/advertiser/trades/quote', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function acceptGoldTradeQuote(quote: GoldTradeQuote): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>('/api/marketplace/advertiser/trades/accept', {
    method: 'POST',
    body: JSON.stringify({ quote }),
  });
}

export async function reportGoldDelivery(
  tradeId: number,
  deliveryEvidenceRef: string
): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/advertiser/trades/${tradeId}/delivery`, {
    method: 'POST',
    body: JSON.stringify({ deliveryEvidenceRef }),
  });
}

export async function confirmExternalPaymentReceipt(tradeId: number): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/advertiser/trades/${tradeId}/confirm-payment`, {
    method: 'POST',
  });
}

export async function disputeTrade(tradeId: number, reason: string): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/advertiser/trades/${tradeId}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function cancelTrade(tradeId: number, reason?: string): Promise<{ success: boolean; trade: GoldTrade }> {
  return apiRequest<{ success: boolean; trade: GoldTrade }>(`/api/marketplace/trades/${tradeId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function requestP2pFundingQuote(params: {
  exchangerId: string;
  offerId: number;
  targetUsdCents: number;
}): Promise<{ success: boolean; quote: P2pFundingQuote }> {
  return apiRequest<{ success: boolean; quote: P2pFundingQuote }>('/api/marketplace/advertiser/p2p-funding/quote', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function acceptP2pFundingQuote(quote: P2pFundingQuote): Promise<{ success: boolean; fundingRequest: any }> {
  return apiRequest<{ success: boolean; fundingRequest: any }>('/api/marketplace/advertiser/p2p-funding/accept', {
    method: 'POST',
    body: JSON.stringify({ quote }),
  });
}

export async function submitExchangerApplication(input: {
  introduction: string;
  experience: string;
  gameCurrencies: string[];
  settlementCurrencies: string[];
  contactInfo?: string;
}): Promise<{ success: boolean; application: any }> {
  return apiRequest<{ success: boolean; application: any }>('/api/applications', {
    method: 'POST',
    body: JSON.stringify({
      category: 'exchanger',
      ...input,
    }),
  });
}
