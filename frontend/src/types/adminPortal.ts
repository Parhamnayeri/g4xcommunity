/**
 * frontend/src/types/adminPortal.ts — Admin Portal Data Models & Contracts
 */

export interface RoleCounts {
  [roleKey: string]: number;
}

export interface OrderCounts {
  [status: string]: number;
}

export interface AdminOverviewKPIs {
  totalUsers: number;
  activeUsers: number;
  deactivatedUsers: number;
  roleCounts: RoleCounts;
  pendingApplications: number;
  applicationsByCategory: Array<{ category: string; status: string; _count: { id: number } }>;
  openDisputes: number;
  pendingProofs: number;
  orderCounts: OrderCounts;
  pendingDeposits: {
    count: number;
    sumUsdCents: number;
  };
  pendingWithdrawals: {
    count: number;
    sumUsdCents: number;
  };
}

export interface FeatureGateStates {
  ESCROW_RELEASE_ENABLED: boolean;
  FINANCE_V2_LIVE_CREDITS_ENABLED: boolean;
  FINANCE_V2_LIVE_PAYOUTS_ENABLED: boolean;
  FINANCE_V2_P2P_SETTLEMENT_ENABLED: boolean;
  NOWPAYMENTS_LIVE_COLLECTION_ENABLED: boolean;
}

export interface AdminOverviewResponse {
  success: boolean;
  currentUser: {
    discordId: string;
    username: string;
    displayName: string | null;
    roles: string[];
  };
  kpis: AdminOverviewKPIs;
  featureGates: FeatureGateStates;
  recentAudits: Array<{
    id: number;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    isSuccess: boolean;
    createdAt: string;
  }>;
}

export interface AdminDepositItem {
  id: number;
  fundingRef: string;
  quoteRef: string | null;
  advertiserId: string;
  advertiserName: string;
  fundingMethod: string;
  status: string;
  targetUsdCents: number;
  targetUsdFormatted: string;
  externalCurrency: string;
  externalAmountUnits: string;
  exchangeRate: number | null;
  evidenceRef: string | null;
  payerIdentifier: string;
  rawPayerIdentifier?: string | null;
  adminNotes: string | null;
  receiptFileKey?: string | null;
  receiptUrl?: string | null;
  senderCardLast4?: string | null;
  paymentDate?: string | null;
  payerDescription?: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  creditedAt: string | null;
  createdAt: string;
}

export interface AdminTradeItem {
  id: number;
  tradeRef: string;
  seller: string;
  buyer: string;
  gameSlug: string;
  region: string | null;
  realm: string | null;
  faction: string | null;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  valuationFormatted: string;
  settlementMethod: string;
  tradeStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOfferItem {
  id: number;
  offerRef: string;
  exchanger: string;
  serviceType: string;
  settlementCurrency: string;
  commissionPercentage: number;
  commissionFormatted: string;
  minAmount: number | null;
  maxAmount: number | null;
  status: string;
  createdAt: string;
}

export interface AdminAuditLogItem {
  id: number;
  actor: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  isSuccess: boolean;
  createdAt: string;
}

export interface AdminUserItem {
  discordId: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  advertiserRank: string | null;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RolesMatrixResponse {
  success: boolean;
  roles: string[];
  permissionsMatrix: Record<string, string[]>;
  allPermissions: string[];
}

export interface PlatformFinanceBreakdown {
  source: 'direct' | 'g2g' | 'skycoach' | 'eldorado' | 'kingboost' | 'overgear';
  displayName: string;
  icon: string;
  feeRatePercent: string;
  orderCounts: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
  };
  grossVolumeMinor: number;
  grossVolumeUsd: string;
  feeDeductedMinor: number;
  feeDeductedUsd: string;
  netRevenueMinor: number;
  netRevenueUsd: string;
  boosterPoolMinor: number;
  boosterPoolUsd: string;
  availableBalanceMinor: number;
  availableBalanceUsd: string;
  pendingReleaseMinor: number;
  pendingReleaseUsd: string;
  withdrawnTotalMinor: number;
  withdrawnTotalUsd: string;
  receivedTotalMinor: number;
  receivedTotalUsd: string;
}

export interface FinanceTotals {
  dollarRate?: number;
  dollarRateFormatted?: string;
  grossVolumeMinor: number;
  grossVolumeUsd: string;
  grossVolumeToman?: string;
  platformFeesMinor: number;
  platformFeesUsd: string;
  netPlatformProfitMinor: number;
  netPlatformProfitUsd: string;
  netPlatformProfitToman?: string;
  boosterPoolMinor: number;
  boosterPoolUsd: string;
  boosterPoolToman?: string;
  activeEscrowMinor: number;
  activeEscrowUsd: string;
  activeEscrowToman?: string;
  completedVolumeMinor: number;
  completedVolumeUsd: string;
  completedVolumeToman?: string;
  boosterWalletLiabilityMinor: number;
  boosterWalletLiabilityUsd: string;
  boosterWalletLiabilityToman?: string;
  pendingWithdrawalsCount: number;
  pendingWithdrawalsMinor: number;
  pendingWithdrawalsUsd: string;
  pendingWithdrawalsToman?: string;
  paidWithdrawalsCount: number;
  paidWithdrawalsMinor: number;
  paidWithdrawalsUsd: string;
  netLiquidReserveMinor: number;
  netLiquidReserveUsd: string;
  netLiquidReserveToman?: string;
}

export interface AdminFinanceOverviewResponse {
  success: boolean;
  totals: FinanceTotals;
  byPlatform: PlatformFinanceBreakdown[];
  dollarRate?: {
    rate: number;
    formatted: string;
    updatedAt?: string;
    source: string;
  };
}

// ==========================================
// User Details Modal & Aggregated Data Types
// ==========================================

export interface AdminUserProfile {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
  isActive: boolean;
  status: 'Active' | 'Suspended';
  advertiserRank: string | null;
  phoneNumber: string | null;
  telegramUsername?: string | null;
  whatsappNumber?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserRoleItem {
  roleKey: string;
  grantedAt: string;
  grantedBy: string | null;
}

export interface AdminUserGameApprovalItem {
  id: string;
  gameSlug: string;
  gameName: string;
  serviceId: string | null;
  serviceName: string | null;
  approvalType: string;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

export interface AdminUserWowCharacterItem {
  id: string;
  characterName: string;
  realm: string;
  region: string;
  characterClass: string;
  activeSpec: string;
  itemLevel: number;
  mythicScore: number;
  activeRole: string;
  faction: string;
  isMain: boolean;
  isActive: boolean;
  syncStatus: string;
  lastSyncedAt: string | null;
}

export interface AdminUserPilotVerificationItem {
  id: string;
  gameSlug: string;
  gameName: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  hasIdentityDoc: boolean;
  hasPassportDoc: boolean;
  hasSelfieDoc: boolean;
}

export interface AdminUserKycInfo {
  status: string;
  isVerified: boolean;
  verifiedAt: string | null;
  legalName: string | null;
  country: string | null;
  idNumber: string | null;
  contactInfo: string | null;
  vpnConfirmed: boolean;
  adminNotes: string | null;
  documents: {
    identity: boolean;
    passport: boolean;
    selfie: boolean;
    totalUploaded: number;
  };
  pilotVerifications: AdminUserPilotVerificationItem[];
}

export interface AdminUserFinancialSummary {
  availableBalance: number;
  availableBalanceFormatted: string;
  pendingEscrowBalance: number;
  pendingEscrowBalanceFormatted: string;
  reservedBalance: number;
  reservedBalanceFormatted: string;
  totalLifetimeEarnings: number;
  totalLifetimeEarningsFormatted: string;
  totalWithdrawn: number;
  totalWithdrawnFormatted: string;
  totalOrdersCompleted: number;
  activeAssignedOrdersCount: number;
  currency: string;
  payoutAddress: string | null;
  payoutNetwork: string | null;
  bankAccountHolder: string | null;
  bankIban: string | null;
  cryptoAddress: string | null;
  cryptoNetwork: string | null;
}

export interface AdminUserAssignedOrder {
  assignmentId: string;
  orderId: string;
  orderRef: string;
  externalOrderId: string | null;
  title: string;
  platform: string;
  status: string;
  assignmentStatus: string;
  assignedRole: string;
  boosterPayoutShare: number;
  boosterPayoutShareFormatted: string;
  grossAmountUsd: number;
  assignedAt: string;
  completedAt: string | null;
}

export interface AdminUserCreatedOrder {
  orderId: string;
  orderRef: string;
  externalOrderId: string | null;
  title: string;
  platform: string;
  status: string;
  grossAmountUsd: number;
  grossAmountFormatted: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AdminUserPresign {
  id: string;
  orderId: string;
  orderRef: string;
  orderTitle: string;
  orderStatus: string;
  platform: string;
  claimType: string;
  registeredRole: string;
  hasKey: boolean;
  keyLevel: number | null;
  characterName: string | null;
  status: string;
  registeredAt: string;
}

export interface AdminUserLedgerTransaction {
  id: string | number;
  entryRef: string;
  type: string;
  direction: string;
  amountUsd: number;
  amountFormatted: string;
  description: string;
  createdAt: string;
}

export interface AdminUserWithdrawal {
  id: number;
  withdrawalRef: string;
  payoutMethod: string;
  status: string;
  requestedUsd: number;
  requestedFormatted: string;
  netUsd: number;
  netFormatted: string;
  fixedFeeUsd: number;
  destinationAddress: string;
  externalTxHash: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface AdminUserAuditLog {
  id: number;
  action: string;
  entityId: string;
  actorId: string;
  actorName: string;
  reason: string | null;
  previousValues: any;
  newValues: any;
  createdAt: string;
}

export interface AdminUserDetailsResponse {
  success: boolean;
  user: {
    profile: AdminUserProfile;
    roles: AdminUserRoleItem[];
    gameApprovals: AdminUserGameApprovalItem[];
    wowCharacters: AdminUserWowCharacterItem[];
    kyc: AdminUserKycInfo;
    financialSummary: AdminUserFinancialSummary;
    orders: {
      assignedOrders: AdminUserAssignedOrder[];
      createdOrders: AdminUserCreatedOrder[];
      preSigns: AdminUserPresign[];
      totalAssigned: number;
      totalCreated: number;
      totalPreSigns: number;
    };
    ledger: {
      transactions: AdminUserLedgerTransaction[];
      totalTransactions: number;
    };
    withdrawals: {
      requests: AdminUserWithdrawal[];
      totalRequests: number;
    };
    auditTrail: AdminUserAuditLog[];
  };
}

