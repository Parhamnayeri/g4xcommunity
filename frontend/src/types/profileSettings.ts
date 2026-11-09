/**
 * frontend/src/types/profileSettings.ts — Type definitions for Profile, Settings & Booster Portal
 */

export type RosterRole = 'TANK' | 'HEALER' | 'DPS' | 'ANY';
export type BoosterAvailability = 'AVAILABLE' | 'BUSY' | 'AWAY';
export type PreferredContact = 'DISCORD' | 'TELEGRAM' | 'WHATSAPP';

export interface UserSettings {
  orderAssignedDm: boolean;
  orderCompletedDm: boolean;
  payoutAlertsDm: boolean;
  announcementDm: boolean;
  rosterRole: RosterRole;
  availability: BoosterAvailability;
  rosterVisibility: boolean;
  preferredContact: PreferredContact;
}

export interface UserProfileData {
  discordId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarUrl: string;
  phoneNumber: string | null;
  telegramUsername: string | null;
  whatsappNumber: string | null;
  roles: string[];
  isActive: boolean;
  advertiserRank: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedGame {
  gameSlug: string;
  displayName: string;
  status: string;
  approvedAt: string | null;
}

export interface PilotVerificationInfo {
  status: string;
  gameSlug: string;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface LatestApplicationInfo {
  id: number;
  category: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface WowCharacter {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  role: string;
  itemLevel: number;
  mythicScore: number;
  isMain: boolean;
}

export interface ActivitySummary {
  activeAssignmentsCount: number;
  completedRunsCount: number;
  ordersCount: number;
  joinedDaysAgo: number;
}

export interface PayoutPreferenceInfo {
  hasIban: boolean;
  maskedIban: string | null;
  hasCryptoAddress: boolean;
  maskedCryptoAddress: string | null;
}

export interface DiscordLinkageInfo {
  discordId: string;
  username: string;
  connected: boolean;
  serverName: string;
  rolesInGuild: string[];
}

export interface UserProfileResponse {
  success: boolean;
  profile: UserProfileData;
  approvedGames: ApprovedGame[];
  pilotVerification: PilotVerificationInfo | null;
  latestApplication: LatestApplicationInfo | null;
  characters: WowCharacter[];
  activitySummary: ActivitySummary;
  payoutPreference: PayoutPreferenceInfo;
  settings: UserSettings;
  discordLinkage: DiscordLinkageInfo;
}

export interface ProfileUpdateRequest {
  displayName?: string | null;
  phoneNumber?: string | null;
  telegramUsername?: string | null;
  whatsappNumber?: string | null;
}

export interface UserSettingsResponse {
  success: boolean;
  settings: UserSettings;
  discordLinkage: {
    discordId: string;
    username: string;
    connected: boolean;
    guildId: string | null;
    serverName: string;
  };
}

export interface UserSettingsUpdateRequest {
  orderAssignedDm?: boolean;
  orderCompletedDm?: boolean;
  payoutAlertsDm?: boolean;
  announcementDm?: boolean;
  rosterRole?: RosterRole;
  availability?: BoosterAvailability;
  rosterVisibility?: boolean;
  preferredContact?: PreferredContact;
}

export interface BoosterAssignment {
  assignmentId: number;
  orderId: number;
  assignedRole: string;
  assignedAt: string;
  orderTitle: string;
  gameSlug: string;
  status: string;
  totalAmountUsdCents: number;
}

export interface BoosterOverviewData {
  assignedActiveCount: number;
  runsInProgressCount: number;
  proofsAwaitingReviewCount: number;
  completedOrdersCount: number;
  recentActivity: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    timestamp: string;
    status: string;
  }>;
}

export interface AvailableQueueOrder {
  id: number;
  orderRef?: string;
  title: string;
  gameSlug: string;
  gameName?: string;
  serviceName?: string;
  orderMode?: string;
  modeLabel?: string;
  status: string;
  totalAmountUsdCents: number;
  boosterPoolUsd?: string;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  discordLink?: string | null;
  rosterSlotsNeeded: {
    tanks: number;
    healers: number;
    dps: number;
  };
  rosterFulfillment: {
    hasKeyOwner: boolean;
    filledTanks: number;
    filledHealers: number;
    filledDps: number;
    totalFilled: number;
    isFull: boolean;
  };
  createdAt: string;
}

export interface BoosterOrderTeamMember {
  userId: string;
  username: string;
  displayName: string | null;
  assignedRole: string;
  status: string;
}

export interface BoosterOrder {
  assignmentId: number;
  orderId: number;
  orderRef: string;
  title: string;
  gameSlug: string;
  gameName: string;
  serviceName: string;
  orderMode: string;
  modeLabel: string;
  assignedRole: string;
  assignmentStatus: string;
  orderStatus: string;
  totalAmountUsdCents: number;
  boosterPoolUsd: string;
  assignedAt: string;
  runsCount: number;
  executionChannelId: string | null;
  executionChannelUrl: string | null;
  teamMembers: BoosterOrderTeamMember[];
}

export interface BoosterRunProof {
  proofId: number;
  runId: number;
  runNumber: number;
  orderId: number;
  orderRef: string;
  gameSlug: string;
  proofType: string;
  evidenceUrl: string;
  description: string | null;
  status: string;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  executionChannelUrl: string | null;
}

export interface BoosterActivityItem {
  id: string;
  category: string;
  orderId: number;
  orderRef: string;
  title: string;
  detail: string;
  status: string;
  timestamp: string;
}

export interface BoosterPortalDataResponse {
  success: boolean;
  overview?: BoosterOverviewData;
  myOrders?: BoosterOrder[];
  myRunsAndProofs?: BoosterRunProof[];
  activityHistory?: BoosterActivityItem[];
  boosterInfo: {
    discordId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string;
    roles: string[];
    pilotVerified: boolean;
    rosterRole: RosterRole;
    availability: BoosterAvailability;
    approvedGames: string[];
  };
  assignedOrders: BoosterAssignment[];
  availableQueue: AvailableQueueOrder[];
}
