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
import { mapWithdrawalStatus, SimplifiedStatusResult } from '../services/statusSimplifier';
import { maskCryptoAddress, maskIban } from '../services/financeV2/iranianIbanValidator';

import { getEffectivePermissions, Permission } from '../services/permissionTypes';

export interface SerializedUser {
  discordId: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  roles: string[];
  permissions: Permission[];
  advertiserRank?: string | null;
  advertiserCommissionBps?: number | null;
  advertiserCommissionRateFormatted?: string | null;
}

export function serializeUser(
  user: User & { userRoles?: { roleKey: string }[] },
): SerializedUser {
  const roleKeys = user.userRoles ? user.userRoles.map((r) => r.roleKey) : [];
  const permissions = getEffectivePermissions(roleKeys);
  const isAdv = roleKeys.includes('advertiser');
  const rank = isAdv && user.advertiserRank && isValidAdvertiserRank(user.advertiserRank) ? (user.advertiserRank as AdvertiserRank) : null;
  const bps = rank ? getRankBasisPoints(rank) : null;

  return {
    discordId: user.discordId,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: roleKeys,
    permissions,
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

export interface SerializedUserWithdrawal {
  id: number;
  withdrawalRef: string;
  payoutMethod: string;
  requestedUsdCents: number;
  requestedUsd: string;
  fixedFeeUsdCents: number;
  fixedFeeUsd: string;
  netUsdCents: number;
  netUsd: string;
  quotedNetPayoutAmount: string;
  quotedCurrency: string;
  quoteRate: number | null;
  effectiveRate: number | null;
  rateDiscount?: number | null;
  maskedDestinationAddress: string;
  scheduledCycleDay?: string | null;
  scheduledCycleDate?: Date | null;
  schedulingStatus?: string;
  status: string;
  simplifiedStatus: SimplifiedStatusResult;
  externalTxHash?: string | null;
  maskedTxHash?: string | null;
  txExplorerUrl?: string | null;
  bankSettled?: boolean;
  rejectionReason?: string | null;
  cancelReason?: string | null;
  createdAt: Date;
  processedAt?: Date | null;
  userConfirmedAt?: Date | null;
}

export interface SerializedAdminWithdrawal extends SerializedUserWithdrawal {
  boosterId: string;
  booster?: {
    discordId: string;
    username: string;
    displayName: string | null;
  };
  destinationAddress: string;
  destinationAccountHolder?: string | null;
  rawTxHash?: string | null;
  bankReceiptRef?: string | null;
  processedBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

/**
 * سریالایزر تاریخچه و وضعیت تسویه برای کاربران عادی
 * حداقل‌سازی داده‌ها: عدم افشای آدرس کامل، نام صاحب حساب، کد تراکنش خام یا کد پیگیری بانکی
 */
export function serializeUserWithdrawal(r: any): SerializedUserWithdrawal {
  const isUsdt = r.payoutMethod === 'USDT_BEP20' || r.payoutMethod === 'USDT';
  const maskedDest = isUsdt
    ? maskCryptoAddress(r.destinationAddress || '')
    : maskIban(r.destinationAddress || '');

  const hasTx = !!r.externalTxHash;
  const maskedTx = hasTx ? maskCryptoAddress(r.externalTxHash) : null;
  const explorerUrl =
    isUsdt && hasTx && r.status === 'PAID'
      ? `https://bscscan.com/tx/${r.externalTxHash}`
      : null;

  return {
    id: r.id,
    withdrawalRef: r.withdrawalRef,
    payoutMethod: r.payoutMethod,
    requestedUsdCents: r.requestedUsdCents,
    requestedUsd: (r.requestedUsdCents / 100).toFixed(2),
    fixedFeeUsdCents: r.fixedFeeUsdCents,
    fixedFeeUsd: (r.fixedFeeUsdCents / 100).toFixed(2),
    netUsdCents: r.netUsdCents,
    netUsd: (r.netUsdCents / 100).toFixed(2),
    quotedNetPayoutAmount: r.quotedNetPayoutAmount,
    quotedCurrency: r.quotedCurrency,
    quoteRate: r.quoteRate ?? null,
    effectiveRate: r.effectiveRate ?? null,
    rateDiscount: r.rateDiscount ?? null,
    maskedDestinationAddress: maskedDest,
    scheduledCycleDay: r.scheduledCycleDay ?? null,
    scheduledCycleDate: r.scheduledCycleDate ?? null,
    schedulingStatus: r.schedulingStatus ?? 'PENDING_SCHEDULE',
    status: r.status,
    simplifiedStatus: mapWithdrawalStatus(r.status),
    externalTxHash: maskedTx,
    maskedTxHash: maskedTx,
    txExplorerUrl: explorerUrl,
    bankSettled: !!r.bankReceiptRef && r.status === 'PAID',
    rejectionReason: r.rejectionReason ?? null,
    cancelReason: r.cancelReason ?? null,
    createdAt: r.createdAt,
    processedAt: r.processedAt ?? null,
    userConfirmedAt: r.userConfirmedAt ?? null,
  };
}

/**
 * سریالایزر ویژه پنل مالی ادمین با دسترسی کامل به مدارک تسویه جهت انطباق و تایید
 */
export function serializeAdminWithdrawal(r: any): SerializedAdminWithdrawal {
  const base = serializeUserWithdrawal(r);
  return {
    ...base,
    boosterId: r.boosterId,
    booster: r.booster
      ? {
          discordId: r.booster.discordId,
          username: r.booster.username,
          displayName: r.booster.displayName,
        }
      : undefined,
    destinationAddress: r.destinationAddress,
    destinationAccountHolder: r.destinationAccountHolder ?? null,
    rawTxHash: r.externalTxHash ?? null,
    bankReceiptRef: r.bankReceiptRef ?? null,
    processedBy: r.processedBy ?? null,
    approvedBy: r.approvedBy ?? null,
    approvedAt: r.approvedAt ?? null,
  };
}

