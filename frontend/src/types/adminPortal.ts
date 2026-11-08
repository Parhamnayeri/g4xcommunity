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
