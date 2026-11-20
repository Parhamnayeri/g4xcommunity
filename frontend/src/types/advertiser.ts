export interface RankHierarchyItem {
  rank: string;
  label: string;
  basisPoints: number;
  percentage: string;
  description: string;
  isCurrent: boolean;
}

export interface AdvertiserProfile {
  discordId: string;
  username: string;
  displayName: string;
  roles: string[];
  isApprovedAdvertiser: boolean;
  isStaffOversight: boolean;
  advertiserRank: string | null;
  rankLabel: string;
  applicationStatus: string;
  applicationDate: string | null;
}

export interface AdvertiserRankData {
  currentRank: string | null;
  rankLabel: string;
  basisPoints: number;
  commissionPercent: string;
  rankHierarchy: RankHierarchyItem[];
}

export interface AdvertiserWallet {
  availableCents: number;
  availableUsd: string;
  reservedCents: number;
  reservedUsd: string;
  pendingEarningsCents: number;
  pendingEarningsUsd: string;
  paidCents: number;
  paidUsd: string;
  frozenCents?: number;
  frozenUsd?: string;
  isFrozen?: boolean;
  payoutAddress?: string | null;
  canPlaceOrders: boolean;
}

export interface AdvertiserPerformance {
  totalOrdersCreated: number;
  activeOrdersCount: number;
  completedOrdersCount: number;
  cancelledOrdersCount: number;
  totalGrossVolumeUsd: string;
  totalPlatformFeesPaidUsd: string;
}

export interface DiscordIntegrationInfo {
  guildId: string | null;
  ordersChannelId: string | null;
  becomeAdvChannelId: string | null;
  orderEntryUrl: string | null;
}

export interface AdvertiserOverviewResponse {
  success: boolean;
  profile: AdvertiserProfile;
  rank: AdvertiserRankData;
  wallet: AdvertiserWallet;
  performance: AdvertiserPerformance;
  discordIntegration: DiscordIntegrationInfo;
}

export interface AdvertiserOrder {
  id: number;
  orderRef: string;
  orderName: string | null;
  originType: 'advertiser' | 'g4x' | 'needs_review';
  gameSlug: string;
  gameName: string;
  serviceId: number;
  serviceName: string;
  sourceType: string;
  sourceWebsite: string | null;
  sourceLabel: string;
  advertiser: {
    id: string | null;
    username: string | null;
    displayName: string;
    advertiserRank: string;
    rankCommissionBps: number;
    commissionPercent: string;
  };
  grossAmountMinor: number;
  grossAmountUsd: string;
  currency: string;
  feeInfo: {
    platformFeeUsd?: string;
    advertiserFeeUsd?: string;
    boosterPoolUsd?: string;
    netAmountUsd?: string;
    settlementState?: string;
  };
  paymentStatus: string;
  status: string;
  simplifiedStatus: {
    label: string;
    colorClass: string;
    rawStatus: string;
  };
  runsCount: number;
  assignedCount: number;
  assignedBooster: string | null;
  releaseStage: string | null;
  isPublishable: boolean;
  authorizedActions: string[];
  notes: string | null;
  externalOrderId: string | null;
  discordChannelId: string | null;
  createdAt: string;
}

export interface AdvertiserOrdersResponse {
  success: boolean;
  tab: string;
  counts: {
    g4x: number;
    advertiser: number;
    needsReview: number;
  };
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  orders: AdvertiserOrder[];
}

export interface PublicGameService {
  id: number;
  gameSlug: string;
  serviceKey: string;
  displayName: string;
  serviceMode: string;
  sortOrder: number;
  formSchemaJson?: string | null;
  tempChannelTemplate?: string | null;
}

export interface PublicGame {
  slug: string;
  displayName: string;
  serviceCategory: string;
  sortOrder: number;
  services: PublicGameService[];
}

export interface PublicGamesResponse {
  success: boolean;
  games: PublicGame[];
  config: {
    discordGuildId?: string;
    discordInviteUrl?: string;
    bookingDestination?: string;
    channels?: {
      orders?: string;
      becomeBooster?: string;
      becomeAdvertiser?: string;
    };
  };
}

export interface CreateOrderRequest {
  title?: string;
  boostModel?: string;
  vpnRequirement?: string;
  boostSpecs?: Record<string, any>;
  gameSlug: string;
  serviceId: number;
  grossAmountUsd: string | number;
  boosterPoolUsd?: string | number;
  orderMode?: 'pilot' | 'non_pilot';
  runsCount?: number;
  keyLevel?: string;
  vpnLocation?: string;
  customerInfo?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface DepositIntent {
  id: number;
  intentRef: string;
  amountUsd: number;
  payCurrency: string;
  paymentId?: string | null;
  invoiceUrl?: string | null;
  status: 'WAITING' | 'CONFIRMED' | 'EXPIRED';
  createdAt: string;
  confirmedAt?: string | null;
}

export interface OrderChangeRequest {
  id: number;
  orderId: number;
  orderRef?: string;
  orderTitle?: string;
  orderStatus?: string;
  gameName?: string;
  serviceName?: string;
  grossAmountUsd?: string;
  boosterPoolUsd?: string;
  requester?: {
    discordId?: string;
    username?: string;
    displayName?: string;
    advertiserRank?: string;
  };
  requestType: 'EDIT' | 'CANCEL';
  reason: string;
  proposedChanges?: any;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote?: string | null;
  reviewedBy?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface DepositIntentResponse {
  success: boolean;
  deposit: DepositIntent;
  instructions: {
    message: string;
    invoiceUrl?: string | null;
    payCurrency: string;
    amountUsd: number;
    provider: string;
  };
}

export interface WithdrawalResponse {
  success: boolean;
  withdrawal: {
    id: number;
    ref: string;
    amountUsd: string;
    status: string;
    payoutAddress: string;
    createdAt: string;
  };
  message: string;
}

