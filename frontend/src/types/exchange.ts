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
  hasPrivilegedBuyerRole?: boolean;
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

// ─── Phase 4 Sell Offers & Trades Types ───────────────────────────────────────

export type ExchangeSellOfferStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'EXPIRED';

export interface ExchangeSellOfferItem {
  id: string;
  offerCode: string;
  buyOrderId: string;
  sellerUserId: string;
  sellerDiscordId: string;
  currencyId: string;
  regionId?: string | null;
  offeredAmountBaseUnits: string;
  deliveryMethodId: string;
  estimatedDeliveryMinutes: number;
  additionalInfo?: string | null;
  status: ExchangeSellOfferStatus;
  rejectionReason?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  seller?: {
    discordId: string;
    username: string;
    displayName?: string | null;
  };
  deliveryMethod?: {
    id: string;
    name: string;
    description?: string | null;
  };
  buyOrder?: any;
  trade?: {
    id: string;
    tradeCode: string;
    status: string;
  } | null;
}

export type ExchangeTradeStatus =
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'DELIVERY_IN_PROGRESS'
  | 'PROOF_SUBMITTED'
  | 'BUYER_CONFIRMED'
  | 'AWAITING_FINAL_APPROVAL'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface ExchangeTradeEventItem {
  id: string;
  tradeId: string;
  eventType: string;
  actorUserId?: string | null;
  actorDiscordId?: string | null;
  actorRole?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface ExchangeTradeItem {
  id: string;
  tradeCode: string;
  buyOrderId: string;
  sellOfferId: string;
  buyerUserId: string;
  buyerDiscordId: string;
  sellerUserId: string;
  sellerDiscordId: string;
  gameId: string;
  currencyId: string;
  regionId?: string | null;
  deliveryMethodId: string;
  quantityBaseUnits: string;
  unitLabelSnapshot: string;
  unitMultiplierSnapshot: string;
  pricePerUnitCentsSnapshot: number;
  grossValueCents: number;
  feeRuleIdSnapshot?: string | null;
  feeRuleVersionSnapshot: number;
  feeRuleScopeSnapshot: string;
  buyerCommissionBpsSnapshot: number;
  sellerCommissionBpsSnapshot: number;
  paymentProcessingModeSnapshot: string;
  networkFeeModeSnapshot: string;
  buyerFeeCents: number;
  sellerFeeCents: number;
  netSellerCents: number;
  buyerTotalPayableCents: number;
  status: ExchangeTradeStatus;
  capacityReserved: boolean;
  estimatedDeliveryMinutes?: number | null;
  sellerNotes?: string | null;
  buyerInstructionsSnapshot?: string | null;
  cancelledByDiscordId?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  game?: { id: string; name: string; slug: string; iconUrl?: string | null };
  currency?: { id: string; name: string; unitLabel: string; unitMultiplier: string; decimalPrecision?: number };
  region?: { id: string; name: string; code: string } | null;
  deliveryMethod?: { id: string; name: string; description?: string | null };
  buyer?: { discordId: string; username: string; displayName?: string | null };
  seller?: { discordId: string; username: string; displayName?: string | null };
  buyOrder?: { id: string; orderCode: string; instructions?: string | null };
  events?: ExchangeTradeEventItem[];
  discordRoom?: ExchangeDiscordRoomItem | null;
}

export interface SubmitSellOfferPayload {
  offeredAmountBaseUnits: string;
  deliveryMethodId: string;
  estimatedDeliveryMinutes?: number;
  additionalInfo?: string;
}

export interface SellOfferPreviewData {
  pricing: TradePricingCalculation;
  buyOrder: {
    id: string;
    orderCode: string;
    unitLabelSnapshot: string;
    unitMultiplierSnapshot: string;
    pricePerUnitCents: number;
    remainingCapacityBaseUnits: string;
  };
}

export type ExchangePaymentMethod = 'WALLET' | 'NOWPAYMENTS' | 'BANK_TRANSFER';
export type ExchangePaymentStatus =
  | 'INITIATED'
  | 'PENDING_REVIEW'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED';
export type ExchangeEscrowStatus = 'RESERVED' | 'RELEASED' | 'REFUNDED' | 'DISPUTED_HOLD';

export interface ExchangePaymentItem {
  id: string;
  paymentCode: string;
  tradeId: string;
  buyerUserId: string;
  buyerDiscordId: string;
  method: ExchangePaymentMethod;
  baseAmountCents: number;
  buyerFeeCents: number;
  paymentProcessingFeeCents: number;
  networkFeeCents: number;
  totalPayableCents: number;
  status: ExchangePaymentStatus;
  confirmedAt?: string | null;
  confirmedByDiscordId?: string | null;
  providerOrderId?: string | null;
  invoiceId?: string | null;
  invoiceUrl?: string | null;
  providerPaymentId?: string | null;
  payAddress?: string | null;
  payCurrency?: string | null;
  payAmount?: string | null;
  actuallyPaid?: string | null;
  outcomeAmount?: string | null;
  outcomeCurrency?: string | null;
  gatewayStatus?: string | null;
  ipnVerified: boolean;
  bankReference?: string | null;
  receiptUrl?: string | null;
  senderNote?: string | null;
  reviewedByDiscordId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  trade?: ExchangeTradeItem;
  buyer?: { discordId: string; username: string; displayName?: string | null };
  escrow?: ExchangeEscrowItem | null;
}

export interface ExchangeEscrowItem {
  id: string;
  tradeId: string;
  paymentId: string;
  buyerUserId: string;
  sellerUserId: string;
  fundingSource: ExchangePaymentMethod;
  reservedAmountCents: number;
  tradeGrossCents: number;
  buyerFeeCents: number;
  sellerFeeCents: number;
  netSellerCents: number;
  status: ExchangeEscrowStatus;
  reservedAt: string;
  releasedAt?: string | null;
  refundedAt?: string | null;
  refundedAmountCents: number;
  resolutionNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeCheckoutSummaryResponse {
  success: boolean;
  trade: {
    id: string;
    tradeCode: string;
    status: string;
    quantityBaseUnits: string;
    unitLabelSnapshot: string;
    unitMultiplierSnapshot: string;
    pricePerUnitCentsSnapshot: number;
    pricePerUnitUsd: string;
    buyerTotalPayableCents: number;
    buyerTotalPayableUsd: string;
    grossValueCents: number;
    grossValueUsd: string;
    buyerFeeCents: number;
    buyerFeeUsd: string;
    sellerFeeCents: number;
    netSellerCents: number;
    netSellerUsd: string;
    buyerUserId: string;
    sellerUserId: string;
    gameDisplayName: string;
    currencyDisplayName: string;
    deliveryMethodName: string;
  };
  pricingBreakdown: {
    baseAmountCents: number;
    baseAmountUsd: string;
    buyerFeeCents: number;
    buyerFeeUsd: string;
    paymentProcessingFeeCents: number;
    paymentProcessingFeeUsd: string;
    networkFeeCents: number;
    networkFeeUsd: string;
    totalPayableCents: number;
    totalPayableUsd: string;
  };
  wallet: {
    balanceUsdCents: number;
    balanceUsd: string;
    reservedCents: number;
    reservedUsd: string;
    frozenCents: number;
    isFrozen: boolean;
    availableCents: number;
    availableUsd: string;
    hasSufficientBalance: boolean;
    insufficientReason: string | null;
  };
  gateways: {
    wallet: {
      enabled: boolean;
      available: boolean;
      canPay: boolean;
    };
    nowpayments: {
      enabled: boolean;
      configured: boolean;
      isSandbox: boolean;
    };
    bankTransfer: {
      enabled: boolean;
      bankDetails: {
        bankName: string;
        cardNumber: string;
        accountHolder: string;
        iban?: string;
      };
      note: string;
      irtQuote?: {
        totalIrtAmount: number;
        adminUsdIrtRate: number;
      };
    };
  };
  activePayment: ExchangePaymentItem | null;
  escrow: ExchangeEscrowItem | null;
  discordRoom?: ExchangeDiscordRoomItem | null;
}

export interface ExchangeDiscordRoomItem {
  id: string;
  tradeId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  channelUrl: string;
  categoryId?: string | null;
  archiveCategoryId?: string | null;
  welcomeMessageId?: string | null;
  status: 'ACTIVE' | 'LOCKED' | 'ARCHIVED';
  buyerDiscordId: string;
  sellerDiscordId: string;
  archivedByDiscordId?: string | null;
  archivedAt?: string | null;
  archiveReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeDiscordConfig {
  exchangeCategoryId: string;
  exchangeArchiveCategoryId: string;
  exchangeAlertChannelId: string;
}

// ─── Phase 7: Delivery Proofs, Settlements, Disputes & Notifications ─────────

export interface ExchangeProofItem {
  id: string;
  tradeId: string;
  submittedByUserId: string;
  submittedByDiscordId: string;
  submitterRole: 'SELLER' | 'BUYER' | 'ADMIN' | 'OWNER';
  proofType: 'DELIVERY_PROOF' | 'ADDITIONAL_PROOF' | 'DISPUTE_EVIDENCE';
  fileUrl?: string | null;
  evidenceLinksJson: string;
  inGameDetails?: string | null;
  note?: string | null;
  reviewStatus: 'PENDING' | 'ACCEPTED' | 'ADDITIONAL_REQUIRED' | 'REJECTED';
  reviewedByDiscordId?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeSettlementItem {
  id: string;
  settlementCode: string;
  tradeId: string;
  escrowId: string;
  buyerUserId: string;
  sellerUserId: string;
  settlementType: 'STANDARD_RELEASE' | 'DISPUTE_RELEASE' | 'PARTIAL_SETTLEMENT';
  grossValueCents: number;
  buyerCommissionCents: number;
  sellerCommissionCents: number;
  g4xTotalRevenueCents: number;
  sellerNetPayoutCents: number;
  buyerRefundCents: number;
  buyerEscrowDebitLedgerId?: string | null;
  sellerCreditLedgerId?: string | null;
  buyerRefundLedgerId?: string | null;
  approvedByDiscordId: string;
  approvalNote?: string | null;
  settledAt: string;
  createdAt: string;
  trade?: any;
}

export type DisputeCategory =
  | 'BUYER_NOT_RECEIVED'
  | 'SELLER_CLAIMS_DELIVERED'
  | 'PARTIAL_DELIVERY'
  | 'INCORRECT_AMOUNT'
  | 'WRONG_REGION'
  | 'PAYMENT_ISSUE'
  | 'SUSPECTED_FRAUD'
  | 'OTHER';

export type DisputeResolutionOutcome =
  | 'RELEASE_TO_SELLER'
  | 'FULL_REFUND_TO_BUYER'
  | 'PARTIAL_REFUND'
  | 'REQUEST_ADDITIONAL_PROOF'
  | 'CANCEL_TRADE';

export interface ExchangeDisputeItem {
  id: string;
  disputeCode: string;
  tradeId: string;
  openedByUserId: string;
  openedByDiscordId: string;
  openedByRole: string;
  category: DisputeCategory;
  description: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_PROOF' | 'RESOLVED' | 'CLOSED';
  resolutionOutcome?: DisputeResolutionOutcome | null;
  resolutionBuyerRefundCents?: number | null;
  resolutionSellerPayoutCents?: number | null;
  resolutionNote?: string | null;
  resolvedByDiscordId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  trade?: any;
  openedByUser?: {
    discordId: string;
    username: string;
  };
}

export interface ExchangeNotificationItem {
  id: string;
  recipientDiscordId?: string | null;
  recipientRole?: string | null;
  tradeId?: string | null;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface ExchangeOperationsOverviewKpis {
  totalCompletedTradesVolumeCents: number;
  totalPlatformRevenueCents: number;
  activeEscrowReservedCents: number;
  disputedEscrowFrozenCents: number;
  awaitingFinalApprovalCount: number;
  activeDisputesCount: number;
  pendingKycRequestsCount: number;
  activeTradesCount: number;
  totalCompletedTradesCount: number;
}

export interface ExchangeApprovalQueueItem {
  id: string;
  tradeCode: string;
  status: string;
  quantityBaseUnits: string;
  unitLabelSnapshot: string;
  unitMultiplierSnapshot: string;
  pricePerUnitCentsSnapshot: number;
  grossValueCents: number;
  buyerFeeCents: number;
  sellerFeeCents: number;
  netSellerCents: number;
  buyerTotalPayableCents: number;
  buyerUserId: string;
  buyerDiscordId: string;
  sellerUserId: string;
  sellerDiscordId: string;
  buyerConfirmedAt?: string | null;
  createdAt: string;
  game?: { id: string; displayName: string };
  currency?: { id: string; displayName: string };
  deliveryMethod?: { id: string; name: string };
  escrow?: ExchangeEscrowItem | null;
  proofs?: ExchangeProofItem[];
  buyer?: { discordId: string; username: string; displayName?: string | null };
  seller?: { discordId: string; username: string; displayName?: string | null };
}

// ─── Phase 8: Reputation & User Dashboard Types ───────────────────────────────

export interface UserReputationSummary {
  userId: string;
  role: 'BUYER' | 'SELLER';
  score: number;
  rating: number;
  tier: 'New Trader' | 'Verified' | 'Trusted' | 'Elite';
  tierColor: string;
  totalTradesCount: number;
  completedTradesCount: number;
  cancelledTradesCount: number;
  disputesLostCount: number;
  completionRatePercent: number;
  avgConfirmationMinutes: number | null;
  avgDeliveryMinutes: number | null;
}

export interface BuyerDashboardData {
  success: boolean;
  summary: {
    activeBuyOrdersCount: number;
    activeTradesCount: number;
    completedTradesCount: number;
    pendingPaymentsCount: number;
    pendingApprovalsCount: number;
    cancelledOrdersCount: number;
    totalSpentCents: number;
    totalSpentUsd: string;
    wallet: {
      balanceUsdCents: number;
      balanceUsdFormatted: string;
      availableBalanceCents: number;
      availableBalanceFormatted: string;
      reservedBalanceCents: number;
      reservedBalanceFormatted: string;
      frozenBalanceCents: number;
      isFrozen: boolean;
    };
    reputation: UserReputationSummary;
    badge: {
      isExchanger: boolean;
      hasPrivilegedBuyerRole?: boolean;
      kycStatus: string;
      canCreateBuyOrder: boolean;
    };
  };
  tabs: {
    myBuyOrders: any[];
    activeTrades: any[];
    completedTrades: any[];
    pendingPayments: any[];
    pendingApprovals: (any & { waitingMinutes: number })[];
    cancelledOrders: {
      cancelledBuyOrders: any[];
      cancelledTrades: any[];
    };
    tradeHistory: any[];
  };
}

export interface SellerVolumeItem {
  gameName: string;
  currencyName: string;
  unitLabel: string;
  totalBaseUnits: string;
  formattedVolume: string;
}

export interface SellerDashboardData {
  success: boolean;
  summary: {
    totalEarningsCents: number;
    totalEarningsUsd: string;
    pendingEarningsCents: number;
    pendingEarningsUsd: string;
    activeTradesCount: number;
    completedTradesCount: number;
    totalOffersCount: number;
    pendingOffersCount: number;
    totalCurrencySold: SellerVolumeItem[];
    wallet: {
      balanceUsdCents: number;
      balanceUsdFormatted: string;
      availableBalanceCents: number;
      availableBalanceFormatted: string;
      reservedBalanceCents: number;
      reservedBalanceFormatted: string;
      frozenBalanceCents: number;
      isFrozen: boolean;
    };
    reputation: UserReputationSummary;
  };
  tabs: {
    mySellOffers: any[];
    activeTrades: any[];
    completedTrades: any[];
  };
}

export interface ExchangeTransactionDetailsItem {
  tradeId: string;
  tradeCode: string;
  orderId: string;
  orderCode: string;
  buyer: {
    discordId: string;
    username: string;
    displayName: string;
    memberSince: string;
    reputation: UserReputationSummary;
  };
  seller: {
    discordId: string;
    username: string;
    displayName: string;
    memberSince: string;
    reputation: UserReputationSummary;
  };
  game: {
    id: string;
    name: string;
    slug: string;
    iconUrl?: string | null;
  };
  currency: {
    id: string;
    name: string;
    slug?: string;
    unitLabel: string;
    unitMultiplier: string;
  };
  region?: {
    id: string;
    name: string;
    code: string;
  } | null;
  quantity: {
    quantityBaseUnits: string;
    unitLabel: string;
    unitMultiplier: string;
    formattedDisplay: string;
  };
  unitPriceCents: number;
  unitPriceUsd: string;
  grossValueCents: number;
  grossValueUsd: string;
  buyerFeeCents: number;
  buyerFeeUsd: string;
  buyerCommissionBpsSnapshot: number;
  sellerFeeCents: number;
  sellerFeeUsd: string;
  sellerCommissionBpsSnapshot: number;
  netSellerCents: number;
  netSellerUsd: string;
  buyerTotalPayableCents: number;
  buyerTotalPayableUsd: string;
  paymentMethod: string;
  paymentStatus: {
    method: string;
    status: string;
    paymentCode?: string | null;
    confirmedAt?: string | null;
    gatewayStatus?: string | null;
    totalPayableCents: number;
  };
  deliveryStatus: {
    tradeStatus: string;
    deliveryMethod?: { id: string; name: string } | null;
    estimatedDeliveryMinutes?: number | null;
    discordRoom?: {
      channelId: string;
      channelName: string;
      channelUrl?: string | null;
      status: string;
      isArchived: boolean;
    } | null;
  };
  proofs: Array<{
    id: string;
    submitterRole: string;
    proofType: string;
    fileUrl?: string | null;
    evidenceLinks: string[];
    inGameDetails?: string | null;
    note?: string | null;
    reviewStatus: string;
    createdAt: string;
  }>;
  approvalStatus: {
    tradeStatus: string;
    buyerConfirmedAt?: string | null;
    finalApprovedAt?: string | null;
    completedAt?: string | null;
    waitingMinutes?: number | null;
    isAwaitingFinalApproval: boolean;
    dispute?: {
      disputeCode: string;
      status: string;
      category: string;
      description: string;
      outcome?: string | null;
      resolvedAt?: string | null;
    } | null;
  };
  settlementDetails?: {
    settlementCode: string;
    settlementType: string;
    sellerNetPayoutCents: number;
    sellerNetPayoutUsd: string;
    buyerRefundCents: number;
    buyerRefundUsd: string;
    g4xTotalRevenueCents?: number;
    g4xTotalRevenueUsd?: string;
    buyerEscrowDebitLedgerId?: string | null;
    sellerCreditLedgerId?: string | null;
    buyerRefundLedgerId?: string | null;
    settledAt: string;
  } | null;
  timeline: Array<{
    id: string;
    eventType: string;
    actorRole: string;
    actorDiscordId?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string | null;
    metadata: Record<string, any>;
    createdAt: string;
  }>;
  viewerContext: {
    isBuyer: boolean;
    isSeller: boolean;
    isStaff: boolean;
  };
  createdAt: string;
  updatedAt: string;
}




