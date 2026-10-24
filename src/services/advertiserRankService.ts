/**
 * advertiserRankService.ts — Commercial Advertiser Rank System & Manual Management Engine
 *
 * OWNER-APPROVED G4X COMMISSIONS FOR DIRECT ADVERTISER BOOST ORDERS:
 *  - BRONZE:              14.99% (1499 bps) -> Default for newly approved advertisers
 *  - SILVER:              12.99% (1299 bps)
 *  - GOLD:                10.99% (1099 bps)
 *  - DIAMOND:              8.99% ( 899 bps)
 *  - OFFICIAL_PARTNERS:    6.99% ( 699 bps)
 *  - FOUNDING_ADVERTISER:  8.99% ( 899 bps) -> Distinct special rank for early G4X partners
 *
 * INVARIANTS:
 *  1. Manual management only. No automated volume-threshold or tier-calculation promotions.
 *  2. Stored accurately as integer basis points (bps / 10000). Never binary floating-point as fee source.
 *  3. Applies strictly to direct Advertiser boost orders in G4X. External platforms (G2G 8.99%, SkyCoach 10%, Eldorado),
 *     Exchangers, and Gold Trades remain completely untouched.
 *  4. Commercial tier only, not a Discord authorization role.
 *  5. Complete audit trail in AuditLog for every rank modification with mandatory reason and actor.
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission, SystemRoleKey } from './permissionTypes';

export enum AdvertiserRank {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  DIAMOND = 'DIAMOND',
  OFFICIAL_PARTNERS = 'OFFICIAL_PARTNERS',
  FOUNDING_ADVERTISER = 'FOUNDING_ADVERTISER',
}

export const ADVERTISER_RANK_RATES_BPS: Record<AdvertiserRank, number> = {
  [AdvertiserRank.BRONZE]: 1499,
  [AdvertiserRank.SILVER]: 1299,
  [AdvertiserRank.GOLD]: 1099,
  [AdvertiserRank.DIAMOND]: 899,
  [AdvertiserRank.OFFICIAL_PARTNERS]: 699,
  [AdvertiserRank.FOUNDING_ADVERTISER]: 899,
};

export const ADVERTISER_RANK_LABELS: Record<AdvertiserRank, string> = {
  [AdvertiserRank.BRONZE]: 'Bronze (14.99%)',
  [AdvertiserRank.SILVER]: 'Silver (12.99%)',
  [AdvertiserRank.GOLD]: 'Gold (10.99%)',
  [AdvertiserRank.DIAMOND]: 'Diamond (8.99%)',
  [AdvertiserRank.OFFICIAL_PARTNERS]: 'Official Partners (6.99%)',
  [AdvertiserRank.FOUNDING_ADVERTISER]: 'Founding Advertiser (8.99%)',
};

export const ADVERTISER_RANK_POLICY_VERSION = 1;

/**
 * Validates if a string is an approved AdvertiserRank enum value
 */
export function isValidAdvertiserRank(rank: string | null | undefined): rank is AdvertiserRank {
  if (!rank) return false;
  return Object.values(AdvertiserRank).includes(rank as AdvertiserRank);
}

/**
 * Returns integer basis points (bps) for an approved advertiser rank
 */
export function getRankBasisPoints(rank: AdvertiserRank): number {
  const bps = ADVERTISER_RANK_RATES_BPS[rank];
  if (bps === undefined) {
    throw new Error(`INVALID_ADVERTISER_RANK: Unknown advertiser rank '${rank}'`);
  }
  return bps;
}

/**
 * Formats basis points into human-readable percentage (e.g. 1499 -> '14.99%')
 */
export function formatBasisPoints(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export interface RankCommissionCalculation {
  grossAmountMinor: number;
  rank: AdvertiserRank;
  rankCommissionBasisPoints: number;
  g4xFeeMinor: number;
  remainingMinor: number;
}

/**
 * Exact integer basis points calculation for direct Advertiser boost orders:
 *   g4xFeeCents = roundToNearestCent(grossOrderUsdCents * rankCommissionBasisPoints / 10000)
 *   remainingCents = grossOrderUsdCents - g4xFeeCents
 */
export function calculateRankCommission(grossAmountMinor: number, rank: AdvertiserRank): RankCommissionCalculation {
  if (grossAmountMinor < 0) {
    throw new Error('INVALID_AMOUNT: Order gross amount cannot be negative');
  }

  const bps = getRankBasisPoints(rank);
  const g4xFeeMinor = Math.round((grossAmountMinor * bps) / 10000);
  const remainingMinor = grossAmountMinor - g4xFeeMinor;

  if (g4xFeeMinor < 0 || remainingMinor < 0) {
    throw new Error('CALCULATION_OVERFLOW: Negative commission or remaining amount detected');
  }

  if (g4xFeeMinor + remainingMinor !== grossAmountMinor) {
    throw new Error('CONSERVATION_VIOLATION: Sum of G4X fee and remaining amount does not equal gross amount');
  }

  return {
    grossAmountMinor,
    rank,
    rankCommissionBasisPoints: bps,
    g4xFeeMinor,
    remainingMinor,
  };
}

/**
 * Retrieves the authoritative active Advertiser rank for a user
 */
export async function getAdvertiserRank(advertiserId: string): Promise<AdvertiserRank | null> {
  const user = await prisma.user.findUnique({
    where: { discordId: advertiserId },
    select: { advertiserRank: true },
  });

  if (user && isValidAdvertiserRank(user.advertiserRank)) {
    return user.advertiserRank as AdvertiserRank;
  }

  return null;
}

export interface SetAdvertiserRankInput {
  advertiserId: string;
  newRank: AdvertiserRank;
  reason: string;
  actorId: string;
}

/**
 * Manually updates an Advertiser's rank with strict permission checks and an immutable audit log
 */
export async function setAdvertiserRank(input: SetAdvertiserRankInput) {
  const { advertiserId, newRank, reason, actorId } = input;

  if (!actorId) {
    throw new Error('MISSING_ACTOR_ID: Actor identifier is required to modify advertiser rank');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    throw new Error('MANDATORY_REASON_REQUIRED: A valid non-empty reason (at least 3 characters) is mandatory for manual rank changes');
  }

  if (!isValidAdvertiserRank(newRank)) {
    throw new Error(`INVALID_ADVERTISER_RANK: '${newRank}' is not an approved advertiser rank`);
  }

  // 1. Authorization verification
  // Self-modification is strictly forbidden
  if (actorId === advertiserId) {
    throw new Error('PERMISSION_DENIED: Advertisers are strictly prohibited from modifying their own commercial rank');
  }

  // Check management permissions
  const authPolicy = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  const authAdvReview = await authorize(actorId, Permission.ADVERTISER_APPLICATION_REVIEW);

  // Check role union on actor
  const actor = await prisma.user.findUnique({
    where: { discordId: actorId },
    include: { userRoles: true },
  });

  const actorRoles = actor?.userRoles.map((r) => r.roleKey as SystemRoleKey) || [];
  const isAuthorizedManagement =
    authPolicy.allowed ||
    authAdvReview.allowed ||
    actorRoles.includes('owner') ||
    actorRoles.includes('manager') ||
    actorRoles.includes('admin');

  if (!isAuthorizedManagement) {
    throw new Error('PERMISSION_DENIED: Only authorized management (Owner, Manager, Admin) can manage advertiser ranks');
  }

  // Exchangers or ordinary staff without management rank cannot modify ranks
  if (actorRoles.includes('exchanger') && !actorRoles.some((r) => ['owner', 'manager', 'admin'].includes(r))) {
    throw new Error('PERMISSION_DENIED: Exchangers have no authority to modify advertiser ranks');
  }

  // 2. Validate target advertiser
  const targetUser = await prisma.user.findUnique({
    where: { discordId: advertiserId },
    include: { userRoles: true },
  });

  if (!targetUser) {
    throw new Error(`USER_NOT_FOUND: User '${advertiserId}' does not exist`);
  }

  const isTargetAdvertiser = targetUser.userRoles.some((r) => r.roleKey === 'advertiser');
  if (!isTargetAdvertiser) {
    throw new Error(`TARGET_NOT_AN_ADVERTISER: User '${advertiserId}' is not registered with the advertiser role`);
  }

  const oldRank = targetUser.advertiserRank as AdvertiserRank | null;
  const oldBps = oldRank && isValidAdvertiserRank(oldRank) ? getRankBasisPoints(oldRank) : null;
  const newBps = getRankBasisPoints(newRank);

  // 3. Atomic database update and audit log recording
  return await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { discordId: advertiserId },
      data: { advertiserRank: newRank },
      select: {
        discordId: true,
        username: true,
        displayName: true,
        advertiserRank: true,
        updatedAt: true,
      },
    });

    const auditLog = await tx.auditLog.create({
      data: {
        actorId,
        action: 'ADVERTISER_RANK_CHANGED',
        entityType: 'AdvertiserRank',
        entityId: advertiserId,
        previousValues: JSON.stringify({
          rank: oldRank,
          basisPoints: oldBps,
          commissionRate: oldBps !== null ? formatBasisPoints(oldBps) : null,
        }),
        newValues: JSON.stringify({
          rank: newRank,
          basisPoints: newBps,
          commissionRate: formatBasisPoints(newBps),
          policyVersion: ADVERTISER_RANK_POLICY_VERSION,
        }),
        reason: reason.trim(),
        isSuccess: true,
      },
    });

    return {
      user: updatedUser,
      effectiveBasisPoints: newBps,
      effectiveCommissionRate: formatBasisPoints(newBps),
      auditLog,
    };
  });
}

export interface AdvertiserMigrationDetail {
  discordId: string;
  username: string;
  displayName: string | null;
  currentRank: AdvertiserRank | null;
  effectiveCommissionRate: string | null;
  legacyW1CustomRate: number | null;
  legacyW2CustomRate: number | null;
  hasLegacyCustomRate: boolean;
  isMigrationUnresolved: boolean;
  openOrdersCount: number;
  finalizedSnapshotsCount: number;
}

export interface MigrationImpactReport {
  timestamp: Date;
  totalAdvertisers: number;
  advertisersWithAssignedRank: number;
  advertisersWithLegacyCustomRates: number;
  advertisersWithNoExplicitRateOrRank: number;
  unresolvedAdvertisersCount: number;
  openOrdersAtRiskCount: number;
  finalizedHistoricalSnapshotsCount: number;
  advertisers: AdvertiserMigrationDetail[];
}

/**
 * Read-only Migration Impact Report for existing Advertisers:
 *  - Identifies advertisers with legacy customCommissionRate
 *  - Identifies advertisers with no explicit rate or rank
 *  - Identifies existing rank assignments
 *  - Identifies open orders relying on unresolved configurations
 *  - Reports finalized snapshots preserved intact
 */
export async function getAdvertiserMigrationImpactReport(): Promise<MigrationImpactReport> {
  const advertiserUsers = await prisma.user.findMany({
    where: {
      userRoles: {
        some: { roleKey: 'advertiser' },
      },
    },
    include: {
      wallet: { select: { customCommissionRate: true } },
      walletV2: { select: { customCommissionRate: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const details: AdvertiserMigrationDetail[] = [];
  let openOrdersAtRiskCount = 0;
  let finalizedHistoricalSnapshotsCount = 0;
  let legacyCustomRatesCount = 0;
  let assignedRankCount = 0;
  let noExplicitRateOrRankCount = 0;
  let unresolvedCount = 0;

  for (const user of advertiserUsers) {
    const currentRank = isValidAdvertiserRank(user.advertiserRank) ? (user.advertiserRank as AdvertiserRank) : null;
    const w1Rate = user.wallet?.customCommissionRate ?? null;
    const w2Rate = user.walletV2?.customCommissionRate ?? null;
    const hasLegacy = w1Rate !== null || w2Rate !== null;
    const isUnresolved = currentRank === null;

    if (currentRank !== null) {
      assignedRankCount++;
    } else {
      unresolvedCount++;
      if (hasLegacy) {
        legacyCustomRatesCount++;
      } else {
        noExplicitRateOrRankCount++;
      }
    }

    // Check open orders for this advertiser
    const openOrders = await prisma.order.count({
      where: {
        OR: [{ advertiserId: user.discordId }, { creatorId: user.discordId, creatorType: 'advertiser' }],
        status: { notIn: ['completed', 'cancelled'] },
      },
    });

    if (isUnresolved && openOrders > 0) {
      openOrdersAtRiskCount += openOrders;
    }

    // Check finalized historical snapshots
    const finalizedSnaps = await prisma.orderFinancialSnapshot.count({
      where: {
        order: {
          OR: [{ advertiserId: user.discordId }, { creatorId: user.discordId, creatorType: 'advertiser' }],
        },
        calculationStatus: 'finalized',
      },
    });

    finalizedHistoricalSnapshotsCount += finalizedSnaps;

    details.push({
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      currentRank,
      effectiveCommissionRate: currentRank ? formatBasisPoints(getRankBasisPoints(currentRank)) : null,
      legacyW1CustomRate: w1Rate,
      legacyW2CustomRate: w2Rate,
      hasLegacyCustomRate: hasLegacy,
      isMigrationUnresolved: isUnresolved,
      openOrdersCount: openOrders,
      finalizedSnapshotsCount: finalizedSnaps,
    });
  }

  return {
    timestamp: new Date(),
    totalAdvertisers: advertiserUsers.length,
    advertisersWithAssignedRank: assignedRankCount,
    advertisersWithLegacyCustomRates: legacyCustomRatesCount,
    advertisersWithNoExplicitRateOrRank: noExplicitRateOrRankCount,
    unresolvedAdvertisersCount: unresolvedCount,
    openOrdersAtRiskCount,
    finalizedHistoricalSnapshotsCount,
    advertisers: details,
  };
}

/**
 * Retrieves the complete rank change audit trail for an advertiser
 */
export async function getAdvertiserRankAuditHistory(advertiserId: string) {
  return await prisma.auditLog.findMany({
    where: {
      entityType: 'AdvertiserRank',
      entityId: advertiserId,
    },
    include: {
      actor: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
