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

export interface AvailableQueueOrder {
  id: number;
  title: string;
  gameSlug: string;
  status: string;
  totalAmountUsdCents: number;
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

export interface BoosterPortalDataResponse {
  success: boolean;
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
