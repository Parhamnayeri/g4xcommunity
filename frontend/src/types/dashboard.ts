export interface UserProfileData {
  discordId: string;
  username: string;
  displayName: string | null;
  roles: string[];
  advertiserRank?: string | null;
  registrationStatus: string;
  registrationCategory?: string | null;
  approvedGames: {
    gameSlug: string;
    gameName: string;
    approvalType: string;
  }[];
  createdAt: string;
}

export interface WalletOverviewData {
  availableCents: number;
  availableUsd: string;
  reservedCents: number;
  reservedUsd: string;
  pendingEarningsCents: number;
  pendingEarningsUsd: string;
  confirmedEarningsCents: number;
  confirmedEarningsUsd: string;
  paidCents: number;
  paidUsd: string;
  totalPaidCents?: number;
  totalPaidUsd?: string;
  refundedCents: number;
  refundedUsd: string;
  totalHeldCents: number;
  totalHeldUsd: string;
  lifetimeEarnedCents: number;
  lifetimeEarnedUsd: string;
  eligibleWithdrawalCents: number;
  eligibleWithdrawalUsd: string;
}

export interface DashboardActiveOrder {
  id: number;
  orderRef: string;
  gameSlug: string;
  gameDisplayName: string;
  serviceDisplayName: string;
  orderMode: string; // 'pilot' | 'non_pilot'
  status: string;
  userRelation: 'booster' | 'customer' | 'advertiser' | 'creator';
  assignmentRole: string | null;
  assignmentStatus: string | null;
  payoutCents: number;
  payoutUsd: string;
  channelUrl: string | null;
  runsCount: number;
  completedRunsCount: number;
  createdAt: string;
}

export interface DashboardHistoricalOrder {
  id: number;
  orderRef: string;
  gameSlug: string;
  gameDisplayName: string;
  serviceDisplayName: string;
  orderMode: string;
  status: string;
  userRelation: 'booster' | 'customer' | 'advertiser' | 'creator';
  amountCents: number;
  amountUsd: string;
  currency: string;
  completedAt: string | null;
  createdAt: string;
}

export interface DashboardTransaction {
  id: number;
  entryRef: string;
  entryType: string;
  direction: 'CREDIT' | 'DEBIT';
  amountCents: number;
  amountUsd: string;
  balanceAfterAvailableCents: number | null;
  balanceAfterAvailableUsd: string | null;
  balanceAfterReservedCents: number | null;
  balanceAfterReservedUsd: string | null;
  description: string | null;
  orderRef: string | null;
  createdAt: string;
}

export interface DashboardOverviewResponse {
  success: boolean;
  profile: UserProfileData;
  wallet: WalletOverviewData;
  activeOrders: DashboardActiveOrder[];
  counts: {
    activeOrdersCount: number;
    completedOrdersCount: number;
    totalTransactionsCount: number;
  };
}

export interface DashboardOrdersHistoryResponse {
  success: boolean;
  orders: DashboardHistoricalOrder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardTransactionsResponse {
  success: boolean;
  transactions: DashboardTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
