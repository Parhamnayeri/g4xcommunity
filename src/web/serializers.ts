/**
 * serializers.ts — DTO Serializers جهت جلوگیری از افشای فیلدهای حساس و PI داده‌ها
 */

import { User, Wallet, WowCharacter, Order, GameService } from '@prisma/client';
import {
  AdvertiserRank,
  isValidAdvertiserRank,
  getRankBasisPoints,
  formatBasisPoints,
} from '../services/advertiserRankService';

export interface SerializedUser {
  discordId: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  roles: string[];
  advertiserRank?: string | null;
  advertiserCommissionBps?: number | null;
  advertiserCommissionRateFormatted?: string | null;
}

export function serializeUser(
  user: User & { userRoles?: { roleKey: string }[] },
): SerializedUser {
  const isAdv = user.userRoles ? user.userRoles.some((r) => r.roleKey === 'advertiser') : false;
  const rank = isAdv && user.advertiserRank && isValidAdvertiserRank(user.advertiserRank) ? (user.advertiserRank as AdvertiserRank) : null;
  const bps = rank ? getRankBasisPoints(rank) : null;

  return {
    discordId: user.discordId,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: user.userRoles ? user.userRoles.map((r) => r.roleKey) : [],
    advertiserRank: rank,
    advertiserCommissionBps: bps,
    advertiserCommissionRateFormatted: bps !== null ? formatBasisPoints(bps) : null,
  };
}

export interface SerializedWallet {
  userId: string;
  balanceUsd: number;
  escrowUsd: number;
  balanceGold: number;
  escrowGold: number;
  balanceUsdt: number;
  escrowUsdt: number;
  balanceIrt: number;
  escrowIrt: number;
  updatedAt: Date;
}

export function serializeWallet(wallet: Wallet): SerializedWallet {
  return {
    userId: wallet.userId,
    balanceUsd: wallet.balanceUsd,
    escrowUsd: wallet.escrowUsd,
    balanceGold: wallet.balanceGold,
    escrowGold: wallet.escrowGold,
    balanceUsdt: wallet.balanceUsdt,
    escrowUsdt: wallet.escrowUsdt,
    balanceIrt: wallet.balanceIrt,
    escrowIrt: wallet.escrowIrt,
    updatedAt: wallet.updatedAt,
  };
}

export interface SerializedWowCharacter {
  id: number;
  characterName: string;
  realm: string;
  region: string;
  characterClass: string | null;
  activeSpec: string | null;
  itemLevel: number | null;
  mythicScore: number | null;
  tankScore: number | null;
  healerScore: number | null;
  dpsScore: number | null;
  raidProgression: string | null;
  raiderioUrl: string | null;
  isMain: boolean;
  isActive: boolean;
  syncStatus: string;
  lastSyncedAt: Date | null;
}

export function serializeCharacter(character: WowCharacter): SerializedWowCharacter {
  return {
    id: character.id,
    characterName: character.characterName,
    realm: character.realm,
    region: character.region,
    characterClass: character.characterClass,
    activeSpec: character.activeSpec,
    itemLevel: character.itemLevel,
    mythicScore: character.mythicScore,
    tankScore: character.tankScore,
    healerScore: character.healerScore,
    dpsScore: character.dpsScore,
    raidProgression: character.raidProgression,
    raiderioUrl: character.raiderioUrl,
    isMain: character.isMain,
    isActive: character.isActive,
    syncStatus: character.syncStatus,
    lastSyncedAt: character.lastSyncedAt,
  };
}

export interface SerializedSquadMember {
  squadId: number;
  userId: string;
  username?: string;
  displayName?: string | null;
  memberRole: string | null;
  characterId: number | null;
  character?: SerializedWowCharacter | null;
  status: string;
  joinedAt: Date;
}

export interface SerializedSquad {
  id: number;
  gameSlug: string;
  teamName: string;
  leaderId: string;
  leaderName?: string;
  squadType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  members: SerializedSquadMember[];
}

export function serializeSquad(squad: any): SerializedSquad {
  return {
    id: squad.id,
    gameSlug: squad.gameSlug,
    teamName: squad.teamName,
    leaderId: squad.leaderId,
    leaderName: squad.leader ? (squad.leader.displayName || squad.leader.username) : undefined,
    squadType: squad.squadType,
    status: squad.status,
    createdAt: squad.createdAt,
    updatedAt: squad.updatedAt,
    members: (squad.members || []).map((m: any) => ({
      squadId: m.squadId,
      userId: m.userId,
      username: m.user?.username,
      displayName: m.user?.displayName,
      memberRole: m.memberRole,
      characterId: m.characterId,
      character: m.character ? serializeCharacter(m.character) : null,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
  };
}

export interface SerializedOrderHistory {
  id: number;
  orderRef: string;
  gameSlug: string;
  serviceName: string;
  orderType: string;
  currency: string;
  grossAmountMinor: number;
  boosterPoolMinor: number;
  platformFeeMinor?: number;
  sourceType?: string;
  sourceWebsite?: string | null;
  platformAccountId?: number | null;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
}

export function serializeOrderHistory(
  order: Order & { service: GameService },
): SerializedOrderHistory {
  return {
    id: order.id,
    orderRef: order.orderRef,
    gameSlug: order.gameSlug,
    serviceName: order.service.displayName,
    orderType: order.orderType,
    currency: order.currency,
    grossAmountMinor: order.grossAmountMinor,
    boosterPoolMinor: order.boosterPoolMinor,
    platformFeeMinor: order.platformFeeMinor,
    sourceType: order.sourceType,
    sourceWebsite: order.sourceWebsite,
    platformAccountId: order.platformAccountId,
    status: order.status,
    completedAt: order.completedAt,
    createdAt: order.createdAt,
  };
}
