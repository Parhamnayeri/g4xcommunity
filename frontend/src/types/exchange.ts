export interface ExchangerUserSummary {
  discordId: string;
  username: string;
  displayName?: string | null;
}

export interface ExchangerOffer {
  id: number;
  offerRef: string;
  exchangerId: string;
  serviceType: string;
  settlementCurrency: string;
  commissionPercentage: number;
  feeCalculationBasis: string;
  feePayer: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  terms?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  offerVersion: number;
  createdAt: string;
  updatedAt: string;
  exchanger?: ExchangerUserSummary;
  // Compatibility aliases
  targetCurrency?: string;
  direction?: 'BUY' | 'SELL' | string;
  commissionRateBps?: number;
  minAmountUsdCents?: number;
  maxAmountUsdCents?: number;
  isActive?: boolean;
}

export interface GoldTrade {
  id: number;
  tradeRef: string;
  sellerId: string;
  buyerId: string;
  gameSlug: string;
  region?: string | null;
  realm?: string | null;
  faction?: string | null;
  goldQuantity: number;
  goldUnit: string;
  agreedValuationUsdCents: number;
  settlementMethod: 'IRT_DIRECT' | 'USDT_DIRECT' | 'USD_WALLET' | string;
  commissionPercentage?: number | null;
  commissionAmountUnits?: string | null;
  feePayer?: string | null;
  referenceFxRate?: number | null;
  quotedPayableAmount?: string | null;
  quotedPayableCurrency?: string | null;
  acceptedOfferId?: number | null;
  acceptedOfferVersion?: number | null;
  quoteExpiresAt?: string | null;
  quoteHash?: string | null;
  goldDeliveryStatus: 'PENDING' | 'DELIVERED' | 'VERIFIED' | 'DISPUTED';
  paymentStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'CONFIRMED' | 'DISPUTED';
  tradeStatus: string;
  walletReservationId?: string | null;
  deliveryEvidenceRef?: string | null;
  deliveryReportedAt?: string | null;
  externalPaymentMethod?: string | null;
  externalPaymentRef?: string | null;
  externalPaymentAmount?: string | null;
  paymentSubmittedAt?: string | null;
  advertiserConfirmedReceiptAt?: string | null;
  disputeReason?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
  seller?: ExchangerUserSummary;
  buyer?: ExchangerUserSummary;
  simplifiedStatus?: {
    label: string;
    colorClass: string;
    rawStatus: string;
  };
  // Compatibility aliases
  status?: string;
  goldAmountK?: number;
  totalUsdCents?: number;
  settlementAmount?: number;
}

export interface GoldTradeQuote {
  tradeRef: string;
  sellerId: string;
  buyerId: string;
  offerId?: number;
  offerVersion?: number;
  gameSlug: string;
  region?: string;
  realm?: string;
  faction?: string;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  settlementMethod: string;
  commissionPercentage: number;
  commissionAmount: string;
  referenceFxRate?: number;
  quotedPayableAmount: string;
  quotedPayableCurrency: string;
  expiresAt: string;
  quoteHash: string;
}

export interface P2pFundingQuote {
  quoteRef: string;
  advertiserId: string;
  exchangerId: string;
  offerId: number;
  offerVersion: number;
  targetUsdCents: number;
  referenceRate: number;
  commissionPercentage: number;
  baseIrt: number;
  commissionIrt: number;
  totalIrtPayable: number;
  expiresAt: string;
}

export interface ExchangerStatusResponse {
  success: boolean;
  isApproved: boolean;
  role: string | null;
  application: {
    id: number;
    category: string;
    status: string;
    simplifiedStatus?: {
      label: string;
      colorClass: string;
    };
    submittedAt?: string;
    createdAt?: string;
    rejectionReason?: string | null;
    reviewNotes?: string | null;
  } | null;
}

export interface ExchangerOverviewResponse {
  success: boolean;
  profile?: {
    discordId: string;
    username: string;
    displayName: string;
  };
  exchanger?: {
    discordId: string;
    username: string;
    displayName: string;
  };
  wallet: {
    availableCents: number;
    availableUsd: string;
    reservedCents: number;
    reservedUsd: string;
  };
  metrics: {
    activeOffersCount: number;
    totalTradesCount: number;
    pendingDeliveryCount: number;
    pendingPaymentCount: number;
    settledTradesCount: number;
    settledVolumeUsdCents: number;
    settledVolumeUsd: string;
  };
  featureGates: {
    p2pSettlementEnabled: boolean;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
