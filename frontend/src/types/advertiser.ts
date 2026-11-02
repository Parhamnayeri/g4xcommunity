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
