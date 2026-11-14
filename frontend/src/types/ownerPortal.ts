/**
 * frontend/src/types/ownerPortal.ts — Owner Portal Data Models & Contracts
 */

export interface FeatureGateItem {
  key: string;
  name: string;
  isEnabled: boolean;
  description: string;
  policy?: string;
  statusNotice?: string;
}

export interface FinancialConfigField {
  key: string;
  value: string;
  maskedValue?: string;
  unit: string;
  description: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface FinancialConfigMap {
  admin_usd_irt_rate: FinancialConfigField;
  incoming_irt_fee_rate: FinancialConfigField;
  incoming_irt_quote_ttl_minutes: FinancialConfigField;
  irt_bank_name: FinancialConfigField;
  irt_bank_card_holder: FinancialConfigField;
  irt_bank_card_number: FinancialConfigField;
  irt_bank_iban: FinancialConfigField;
  irt_payout_tuesday_cutoff_hour: FinancialConfigField;
}

export interface AdvertiserRankSetting {
  rank: string;
  label: string;
  basisPoints: number;
  percentageFormatted: string;
}

export interface FinancialConfigResponse {
  success: boolean;
  configs: FinancialConfigMap;
  advertiserRanks: AdvertiserRankSetting[];
  withdrawalDeductionPolicy: {
    fixedDeductionToman: number;
    description: string;
  };
  auditTrail: Array<{
    id: number;
    actor: string;
    action: string;
    configKey: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface OwnerOverviewResponse {
  success: boolean;
  owner: {
    discordId: string;
    username: string;
    displayName: string | null;
    establishedOwnerId: string | undefined;
    isAuthoritativeOwner: boolean;
  };
  stats: {
    totalUsers: number;
    activeUsers: number;
    ordersTotal: number;
    openDisputes: number;
    auditLogsCount: number;
    walletsOverview: {
      v1: {
        balanceUsd: number | null;
        escrowUsd: number | null;
        balanceGold: number | null;
        escrowGold: number | null;
        balanceUsdt: number | null;
        balanceIrt: number | null;
      };
      v2: {
        availableCents: number | null;
        reservedCents: number | null;
        pendingEarningsCents: number | null;
        confirmedEarningsCents: number | null;
        paidCents: number | null;
      };
    };
  };
  featureGates: FeatureGateItem[];
  recentAudits: Array<{
    id: number;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    isSuccess: boolean;
    createdAt: string;
    reason: string | null;
  }>;
}

export interface LedgerEntryItem {
  id: number;
  entryRef: string;
  userId: string | null;
  username: string | null;
  amountCents: number;
  amountFormatted: string;
  direction: 'CREDIT' | 'DEBIT';
  entryType: string;
  accountType: string | null;
  description: string | null;
  relatedEntity: string | null;
  createdAt: string;
}

export interface WalletsLedgersResponse {
  success: boolean;
  summary: {
    totalWalletsV2: number;
    totalLedgerEntries: number;
    aggregateBalances: {
      availableUsd: string;
      reservedUsd: string;
      pendingEarningsUsd: string;
      totalLiabilitiesUsd: string;
    };
  };
  recentEntries: LedgerEntryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface OwnerAuditLogItem {
  id: number;
  actor: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues: string | null;
  newValues: string | null;
  reason: string | null;
  isSuccess: boolean;
  createdAt: string;
}

export interface SecurityHealthResponse {
  success: boolean;
  securityStatus: {
    databaseOwnerStatus: string;
    ownerSnowflake?: string;
    ownerUsername?: string;
    activeSessions: number;
    nodeEnv: string;
    rateLimiterWindowMinutes: number;
  };
}

export interface RcloneHealthStatus {
  rcloneInstalled: boolean;
  rcloneVersion?: string;
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteName: string;
  baseFolder: string;
  remoteDatabasePath: string;
  remoteStoragePath: string;
  configuredRemotes: string[];
  totalSpaceBytes?: number;
  usedSpaceBytes?: number;
  freeSpaceBytes?: number;
  error?: string;
  setupInstructions?: string[];
}

export interface BackupSchedulerStatus {
  enabled: boolean;
  intervalHours: number;
  isRunning: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastError?: string;
}

export interface BackupSnapshotItem {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  modifiedAt: string;
  sha256?: string;
  isRemote: boolean;
  isLocal: boolean;
  manifest?: any;
}

export interface OwnerBackupsResponse {
  success: boolean;
  rcloneStatus: RcloneHealthStatus;
  schedulerStatus: BackupSchedulerStatus;
  snapshots: BackupSnapshotItem[];
}

