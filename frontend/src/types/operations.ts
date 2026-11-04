/**
 * G4X Operations Platform Types — Staff, Management & KYC
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface StaffOverviewResponse {
  success: boolean;
  user: {
    discordId: string;
    username: string;
    displayName: string | null;
    roles: string[];
    isManagerOrAdmin: boolean;
  };
  metrics: {
    pendingProofsCount: number;
    activeDisputesCount: number;
    pendingStaffReviewOrdersCount: number;
  };
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface PendingProofItem {
  id: number;
  runId: number;
  orderId: number | null;
  orderRef?: string | null;
  orderName?: string | null;
  game?: string | null;
  gameSlug?: string | null;
  service?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  proofType: string;
  evidenceUrl: string;
  description: string | null;
  notes?: string | null;
  submittedBy: {
    id: string;
    discordId?: string;
    username: string;
    displayName: string | null;
  };
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  submittedAt?: string;
  createdAt: string;
}

export interface DisputeItem {
  id: number;
  orderId: number;
  orderRef?: string;
  gameSlug?: string;
  disputeType: string;
  status: 'open' | 'under_review' | 'waiting_for_evidence' | 'resolved' | 'cancelled';
  description: string;
  evidenceUrls: string[];
  openedBy: {
    id: string;
    discordId?: string;
    username: string;
    displayName: string | null;
  };
  assignedStaffId: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface PendingProofsResponse {
  success: boolean;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pagination?: PaginationMeta;
  proofs: PendingProofItem[];
}

export interface DisputesResponse {
  success: boolean;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pagination?: PaginationMeta;
  disputes: DisputeItem[];
}

export interface RegistrationApplicationsResponse {
  success: boolean;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pagination?: PaginationMeta;
  applications: RegistrationApplicationItem[];
}

export interface KycApplicationsResponse {
  success: boolean;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pagination?: PaginationMeta;
  applications: KycApplicationItem[];
}

export interface ManagementOrdersResponse {
  success: boolean;
  tab?: string;
  counts?: { g4x: number; advertiser: number; needsReview: number };
  page?: number;
  limit?: number;
  total?: number;
  totalCount?: number;
  totalPages?: number;
  pagination?: PaginationMeta & { totalCount?: number; hasNext?: boolean; hasPrev?: boolean };
  orders: OrderItem[];
}

export interface ManagementOverviewResponse {
  success: boolean;
  kpis: {
    activeOrdersCount: number;
    externalOrdersCount: number;
    advertiserOrdersCount: number;
    openDisputesCount: number;
    pendingProofsCount: number;
    pendingApplicationsCount: number;
    pendingKycVerificationsCount: number;
    totalActiveBoosters: number;
  };
  recentAuditTrail: Array<{
    id: number;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface OrderRosterSlot {
  id: number;
  role: string;
  status: string;
  boosterUserId: string | null;
  boosterPayoutMinor: number;
}

export interface OrderItem {
  id: number;
  customerDiscordId: string;
  game: string;
  service: string;
  status: string;
  paymentStatus: string;
  source: 'advertiser' | 'external_g4x';
  advertiserDiscordId: string | null;
  advertiserName: string | null;
  grossAmountMinor: number;
  customerPriceMinor: number;
  discordMessageId: string | null;
  createdAt: string;
  boostReleaseTracker?: {
    stage: string;
    proofSubmittedAt: string | null;
    staffReviewedAt: string | null;
    adminApprovedAt: string | null;
  } | null;
  slots: OrderRosterSlot[];
}

export interface RegistrationApplicationItem {
  id: number;
  userId: string;
  username: string;
  category: 'booster' | 'pilot' | 'advertiser' | 'exchanger';
  status: 'pending' | 'approved' | 'rejected' | 'info_requested';
  identityStatus: 'none' | 'awaiting_submission' | 'verified' | 'rejected';
  qualifications: string | null;
  supplementalInfo: string | null;
  reviewerNotes: string | null;
  reviewedAt: string | null;
  reviewerId: string | null;
  createdAt: string;
}

export interface KycApplicationItem {
  id: number;
  userId: string;
  username: string;
  displayName: string | null;
  category: string;
  status: string;
  identityStatus: string;
  hasIdentityDoc: boolean;
  hasPassportDoc: boolean;
  hasSelfieDoc: boolean;
  verificationStatus: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface KycDetailResponse {
  success: boolean;
  application: {
    id: number;
    userId: string;
    username: string;
    displayName: string | null;
    category: string;
    status: string;
    identityStatus: string;
    qualifications: string | null;
    supplementalInfo: string | null;
    verificationStatus: string | null;
    reviewNote: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
  };
  documents: {
    identityDocumentRef: string | null;
    passportDocumentRef: string | null;
    selfieDocumentRef: string | null;
  };
  auditTrail: Array<{
    id: number;
    action: string;
    actorId: string;
    reason: string | null;
    createdAt: string;
  }>;
}
