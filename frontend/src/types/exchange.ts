/**
 * frontend/src/types/exchange.ts
 *
 * Types for G4X Exchange:
 *  - Legacy P2P & Exchanger interfaces (ExchangerOffer, GoldTrade, etc.)
 *  - Phase 1 Owner Configuration & Precision Pricing Engine types
 */

// ─── Legacy Exchanger & P2P Types (Maintained for Backward Compatibility) ───

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
  };
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

// ─── Phase 1: Owner Exchange Configuration & Precision Pricing Engine Types ──

export interface ExchangeGameItem {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  currencies?: ExchangeCurrencyItem[];
  _count?: {
    currencies: number;
    feeRules: number;
    regions: number;
  };
}

export interface ExchangeCurrencyItem {
  id: string;
  gameId: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  unitLabel: string;
  unitMultiplier: string;
  decimalPrecision: number;
  minTradeBaseUnits: string;
  maxTradeBaseUnits: string;
  supportedRegionIdsJson: string;
  deliveryMethodIdsJson: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  game?: {
    id: string;
    name: string;
    slug: string;
  };
  _count?: {
    feeRules: number;
  };
}

export interface ExchangeRegionItem {
  id: string;
  gameId: string | null;
  name: string;
  code: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  game?: {
    id: string;
    name: string;
  } | null;
}

export interface ExchangeDeliveryMethodItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeFeeRuleItem {
  id: string;
  scope: 'GLOBAL' | 'GAME' | 'CURRENCY';
  gameId: string | null;
  currencyId: string | null;
  version: number;
  buyerCommissionBps: number;
  sellerCommissionBps: number;
  paymentProcessingMode: string;
  networkFeeMode: string;
  minCommissionCents: number | null;
  maxCommissionCents: number | null;
  isEnabled: boolean;
  effectiveFrom: string;
  createdByDiscordId: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  game?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  currency?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface TradePricingCalculation {
  quantityBaseUnits: string;
  unitMultiplier: string;
  tradeUnits: string;
  pricePerUnitCents: number;
  pricePerUnitUsd: string;
  grossCents: number;
  grossUsd: string;
  buyerCommissionBps: number;
  buyerFeeCents: number;
  buyerFeeUsd: string;
  totalBuyerCents: number;
  totalBuyerUsd: string;
  sellerCommissionBps: number;
  sellerFeeCents: number;
  sellerFeeUsd: string;
  netSellerCents: number;
  netSellerUsd: string;
  appliedFeeRuleId: string;
  appliedFeeRuleVersion: number;
  appliedFeeRuleScope: string;
  paymentProcessingMode: string;
  networkFeeMode: string;
  cappedBuyerMin: boolean;
  cappedBuyerMax: boolean;
  cappedSellerMin: boolean;
  cappedSellerMax: boolean;
}

export interface ExchangeAuditLogItem {
  id: number;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValues: string | null;
  newValues: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ExchangeOverviewStats {
  gamesCount: number;
  currenciesCount: number;
  regionsCount: number;
  deliveryMethodsCount: number;
  feeRulesCount: number;
  activeGlobalRule: ExchangeFeeRuleItem | null;
}

// ─── Phase 2 & 3: KYC Verification, Marketplace Listings & Buy Orders ───────

export type ExchangeKycStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING_REVIEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REQUIRES_ADDITIONAL_INFO'
  | 'EXPIRED'
  | 'SUSPENDED';

export interface ExchangeKycRequestItem {
  id: string;
  userId: string;
  status: ExchangeKycStatus;
  documentsMetaJson: string | null;
  notes: string | null;
  adminReviewNotes: string | null;
  reviewedByDiscordId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    discordId: string;
    username: string;
    displayName: string;
    roles: string[];
    createdAt: string;
  } | null;
}

export interface ExchangeEligibilityResponse {
  userId: string;
  hasExchangerRole: boolean;
  kycStatus: ExchangeKycStatus;
  kycExpiresAt: string | null;
  isSuspended: boolean;
  canCreateBuyOrder: boolean;
  canSubmitSellOffer: boolean;
  activeRoles: string[];
  blockingReasons: string[];
}

export type ExchangeBuyOrderStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PARTIALLY_FILLED'
  | 'FULLY_RESERVED'
  | 'COMPLETED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface ExchangeBuyOrderItem {
  id: string;
  orderCode: string;
  game: {
    id: string;
    name: string;
    slug: string;
    iconUrl: string | null;
  };
  currency: {
    id: string;
    name: string;
    slug: string;
    iconUrl: string | null;
    unitLabel: string;
    unitMultiplier: string;
    decimalPrecision: number;
  };
  region: {
    id: string;
    name: string;
    code: string;
  } | null;
  pricePerUnitCents: number;
  pricePerUnitUsd: string;
  unitLabelSnapshot: string;
  unitMultiplierSnapshot: string;
  minTradeBaseUnits: string;
  maxTradeBaseUnits: string;
  totalCapacityBaseUnits: string;
  reservedCapacityBaseUnits: string;
  remainingCapacityBaseUnits: string;
  filledCapacityBaseUnits: string;
  acceptedDeliveryMethodIds: string[];
  instructions: string | null;
  expiresAt: string | null;
  status: ExchangeBuyOrderStatus;
  createdAt: string;
  isMine?: boolean;
  pricingPreview?: TradePricingCalculation | null;
  buyer: {
    discordId: string;
    username: string;
    displayName: string;
    reputationScore: number;
    completedTradesCount: number;
    memberSince: string;
  };
}

export interface CreateBuyOrderPayload {
  gameId: string;
  currencyId: string;
  regionId?: string | null;
  pricePerUnitCents: number;
  minTradeBaseUnits: string;
  maxTradeBaseUnits: string;
  totalCapacityBaseUnits: string;
  acceptedDeliveryMethodIds: string[];
  instructions?: string;
  expiresAt?: string | null;
  publishImmediately?: boolean;
}

export interface UpdateBuyOrderPayload {
  pricePerUnitCents?: number;
  minTradeBaseUnits?: string;
  maxTradeBaseUnits?: string;
  totalCapacityBaseUnits?: string;
  acceptedDeliveryMethodIds?: string[];
  instructions?: string;
  expiresAt?: string | null;
}
