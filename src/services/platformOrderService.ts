/**
 * platformOrderService.ts — Authoritative Management of Externally Sourced G4X Orders
 * 
 * Key Responsibilities:
 *  1. Authoritative recording of external source platforms (G2G, SkyCoach, Eldorado).
 *  2. Explicit source selection & platform account linkage (PlatformAccount).
 *  3. Accurate gross/net input basis handling and immutable financial snapshot creation.
 *  4. Strict fee application:
 *     - G2G: 8.99% seller fee on gross; 0% if already platform net.
 *     - SkyCoach: 10% per order on gross; 0% if already platform net.
 *     - Eldorado: Per-game/category fee; blocks assumption of 0% on unknown categories.
 *  5. Batch withdrawal fees are NOT applied to individual orders (reconciled separately).
 *  6. Settlement proceeds are recorded as pending release, NEVER as actual received cash before settlement.
 *  7. Clear audit of the $15.00 Gross / $15.00 Booster Pool scenario (no unapproved full allocation).
 *  8. Strict isolation of G4X Direct vs. Advertiser Direct vs. External Platform orders.
 *  9. Explicit legacy order migration mapping (no silent reassignment).
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { validateGameAndService } from './orderValidationService';
import { calculateOrderFinancialSnapshot } from './financialCalculationEngine';
import { creditOrderSalesProceeds } from './platformBalanceService';

export const SUPPORTED_SOURCE_PLATFORMS = ['g2g', 'skycoach', 'eldorado'] as const;
export type SupportedSourcePlatform = typeof SUPPORTED_SOURCE_PLATFORMS[number];

export function isSupportedSourcePlatform(platform: string): platform is SupportedSourcePlatform {
  return SUPPORTED_SOURCE_PLATFORMS.includes(platform.toLowerCase() as SupportedSourcePlatform);
}

export interface ValidateExternalSourceInput {
  sourcePlatform: string;
  platformAccountId?: number | null;
  platformAccountRef?: string | null;
}

/**
 * Validates that the requested source platform is supported and that
 * an explicit, active, matching PlatformAccount exists.
 */
export async function validateExternalOrderSource(input: ValidateExternalSourceInput) {
  const { sourcePlatform, platformAccountId, platformAccountRef } = input;

  const normalizedPlatform = sourcePlatform?.toLowerCase();
  if (!normalizedPlatform || !isSupportedSourcePlatform(normalizedPlatform)) {
    throw new Error(
      `UNSUPPORTED_SOURCE_PLATFORM: Source platform '${sourcePlatform}' is not supported. Supported platforms: ${SUPPORTED_SOURCE_PLATFORMS.join(', ')}`
    );
  }

  if (!platformAccountId && !platformAccountRef) {
    throw new Error(
      `MISSING_PLATFORM_ACCOUNT: An explicit active platform account reference or ID is required for externally sourced orders on '${sourcePlatform}'.`
    );
  }

  let account = null;
  if (platformAccountId) {
    account = await prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
    });
    if (!account) {
      throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Platform account with ID #${platformAccountId} does not exist.`);
    }
  } else if (platformAccountRef) {
    account = await prisma.platformAccount.findUnique({
      where: { accountRef: platformAccountRef.toLowerCase() },
    });
    if (!account) {
      throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Platform account '${platformAccountRef}' does not exist.`);
    }
  }

  if (!account) {
    throw new Error('PLATFORM_ACCOUNT_NOT_FOUND: Could not resolve a valid platform account.');
  }

  if (!account.isActive) {
    throw new Error(`ACCOUNT_INACTIVE: Platform account '${account.accountRef}' is deactivated and cannot accept new orders.`);
  }

  if (account.platform.toLowerCase() !== normalizedPlatform) {
    throw new Error(
      `PLATFORM_MISMATCH: Platform account '${account.accountRef}' belongs to '${account.platform}', not '${sourcePlatform}'.`
    );
  }

  return account;
}

export interface CreateExternalOrderInput {
  gameSlug: string;
  serviceId: number;
  amountMinor: number;
  sourcePlatform: SupportedSourcePlatform | string;
  platformAccountRef?: string;
  platformAccountId?: number;
  sourceAmountType: 'gross_sale' | 'platform_net';
  externalOrderId?: string;
  boosterPoolMinor?: number;
  orderMode?: 'selfplay' | 'pilot' | 'mythicplus';
  runsCount?: number;
  keyLevel?: number | null;
  dungeonName?: string | null;
  requiredBoosterCount?: number;
  orderType?: string;
  listingCategory?: string;
  notes?: string;
  actorId: string;
  currency?: string;
}

/**
 * Authoritatively creates a new externally sourced G4X order.
 */
export async function createExternalOrder(input: CreateExternalOrderInput) {
  const {
    gameSlug,
    serviceId,
    amountMinor,
    sourcePlatform,
    platformAccountRef,
    platformAccountId,
    sourceAmountType,
    externalOrderId,
    boosterPoolMinor,
    orderMode = 'selfplay',
    runsCount = 1,
    keyLevel = null,
    dungeonName = null,
    requiredBoosterCount,
    orderType = 'group',
    listingCategory,
    notes,
    actorId,
    currency = 'USD',
  } = input;

  // 1. Authorization check
  const auth = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
  if (!auth.allowed) {
    throw new Error(
      `UNAUTHORIZED_ORDER_CREATION: ${auth.reason || 'You do not have permission to create external platform orders.'}`
    );
  }

  // 2. Validate domain game & service
  const { game, service } = await validateGameAndService(gameSlug, serviceId);

  // 3. Validate authoritative platform source & account
  const platformAccount = await validateExternalOrderSource({
    sourcePlatform,
    platformAccountId,
    platformAccountRef,
  });

  // 4. Validate monetary amount & basis
  if (!['gross_sale', 'platform_net'].includes(sourceAmountType)) {
    throw new Error(
      `INVALID_SOURCE_AMOUNT_TYPE: Source amount type must be 'gross_sale' or 'platform_net', got '${sourceAmountType}'.`
    );
  }

  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(
      `INVALID_ORDER_AMOUNT: Order amount must be a positive integer in minor units (cents), got ${amountMinor}.`
    );
  }
  const normalizedExternalOrderId = externalOrderId?.trim() || `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedPool = boosterPoolMinor ?? amountMinor;
  if (!Number.isSafeInteger(normalizedPool) || normalizedPool <= 0 || normalizedPool > amountMinor) {
    throw new Error('INVALID_BOOSTER_POOL');
  }
  const isMythic = service.serviceKey.toLowerCase().includes('mythic') || service.displayName.toLowerCase().includes('mythic');
  if (isMythic && (!Number.isSafeInteger(keyLevel) || (keyLevel as number) <= 0 || !dungeonName?.trim())) {
    throw new Error('MYTHIC_KEY_DETAILS_REQUIRED');
  }
  const normalizedRuns = Number.isSafeInteger(runsCount) && runsCount > 0 ? runsCount : 1;
  const normalizedRequired = requiredBoosterCount ?? (isMythic ? 4 : 1);
  if (!Number.isSafeInteger(normalizedRequired) || normalizedRequired <= 0) throw new Error('INVALID_REQUIRED_BOOSTER_COUNT');

  const orderRef = `ORD_EXT_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // 5. Create Order atomically, generate snapshot, credit platform pending balance, and record audit log
  const result = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.order.findFirst({
      where: { platformAccountId: platformAccount.id, externalOrderId: normalizedExternalOrderId },
      select: { id: true },
    });
    if (duplicate) throw new Error('DUPLICATE_SITE_ORDER_ID');
    // A. Create Order entity
    const ord = await tx.order.create({
      data: {
        orderRef,
        gameSlug,
        serviceId,
        creatorId: actorId,
        creatorType: 'g4x', // External sales platform orders are created by G4X staff on behalf of external buyers
        sourceType: 'external',
        sourceWebsite: platformAccount.platform,
        platformAccountId: platformAccount.id,
        orderType: isMythic ? 'group' : orderMode === 'pilot' ? 'pilot' : 'solo',
        orderMode: service.serviceMode === 'pilot' || orderMode === 'pilot' ? 'pilot' : 'non_pilot',
        quantity: normalizedRuns,
        currency: currency.toUpperCase(),
        grossAmountMinor: amountMinor,
        platformFeeMinor: 0, // Updated immediately below from calculated snapshot
        advertiserFeeMinor: 0,
        boosterPoolMinor: normalizedPool,
        paymentStatus: 'unneeded',
        status: 'open_presign',
        externalOrderId: normalizedExternalOrderId,
        notes: notes || null,
        runs: {
          create: Array.from({ length: normalizedRuns }, (_, i) => ({ runNumber: i + 1, status: 'pending' })),
        },
        ...(isMythic
          ? {
              requiredRoles: {
                create: [
                  { roleName: 'tank', quantity: 1 },
                  { roleName: 'healer', quantity: 1 },
                  { roleName: 'dps', quantity: 2 },
                ],
              },
            }
          : { requiredRoles: { create: [{ roleName: orderMode === 'pilot' ? 'pilot' : 'booster', quantity: normalizedRequired }] } }),
        ...(isMythic ? { keyRequirements: { create: [{ dungeonName: dungeonName!.trim(), keyLevel: keyLevel as number, isMandatory: true }] } } : {}),
      },
      include: {
        game: true,
        service: true,
        requiredRoles: true,
      },
    });

    // B. Calculate immutable financial snapshot at commitment point
    const snapshot = await calculateOrderFinancialSnapshot(
      {
        orderId: ord.id,
        sourcePlatform: platformAccount.platform as any,
        sourceAmountType,
        sourceAmountMinor: amountMinor,
        explicitBoosterPoolMinor: normalizedPool,
        platformAccountId: platformAccount.id,
        currency: currency.toUpperCase(),
        gameSlug,
        listingCategory,
        notes,
        actorId,
        allowProvisional: true,
      },
      tx
    );

    // C. Update order with calculated economics
    const updatedOrder = await tx.order.update({
      where: { id: ord.id },
      data: {
        platformFeeMinor: snapshot.platformSaleCommissionMinor,
        boosterPoolMinor: snapshot.boosterPoolMinor,
      },
      include: {
        game: true,
        service: true,
        requiredRoles: true,
        platformAccount: true,
        financialSnapshot: true,
      },
    });

    // D. Credit platform sales proceeds (Rule 8: marked as pendingRelease, NOT receivedTotalMinor)
    const proceedsCreditMinor = snapshot.platformOrderNetMinor;
    if (proceedsCreditMinor > 0) {
      await creditOrderSalesProceeds(
        {
          accountRef: platformAccount.accountRef,
          orderId: ord.id,
          orderRef: ord.orderRef,
          amountMinor: proceedsCreditMinor,
          currency: currency.toUpperCase(),
          isPendingRelease: true, // Crucial: NOT available received cash before settlement
          actorId,
        },
        tx
      );
    }

    // E. Record authoritative audit log
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_CREATED_EXTERNAL_PLATFORM',
        entityType: 'order',
        entityId: String(ord.id),
        newValues: JSON.stringify({
          orderId: ord.id,
          orderRef: ord.orderRef,
          sourcePlatform: platformAccount.platform,
          platformAccountId: platformAccount.id,
          platformAccountRef: platformAccount.accountRef,
          sourceAmountType,
          sourceAmountMinor: amountMinor,
          platformSaleCommissionMinor: snapshot.platformSaleCommissionMinor,
          boosterPoolMinor: snapshot.boosterPoolMinor,
          policyVersion: snapshot.policyVersion,
        }),
        reason: `External order created from ${platformAccount.platform.toUpperCase()} (${platformAccount.accountRef}) with ${sourceAmountType} basis.`,
        isSuccess: true,
      },
    });

    return {
      order: updatedOrder,
      snapshot,
      platformAccount,
    };
  });

  return result;
}

export interface MapLegacyOrderSourceInput {
  orderId: number;
  sourcePlatform: string;
  platformAccountRef?: string;
  platformAccountId?: number;
  sourceAmountType?: 'gross_sale' | 'platform_net';
  reason: string;
  actorId: string;
}

/**
 * Explicitly maps historical / legacy orders with missing source data to a verified platform source.
 * Rule 11: Silent automatic assignment is strictly prohibited.
 */
export async function mapLegacyOrderSource(input: MapLegacyOrderSourceInput) {
  const {
    orderId,
    sourcePlatform,
    platformAccountRef,
    platformAccountId,
    sourceAmountType = 'gross_sale',
    reason,
    actorId,
  } = input;

  const auth = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
  if (!auth.allowed) {
    throw new Error(
      `UNAUTHORIZED: ${auth.reason || 'You do not have permission to map legacy order sources.'}`
    );
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('MISSING_MIGRATION_REASON: Explicit audit reason is required when mapping legacy order source.');
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { platformAccount: true, financialSnapshot: true },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist.`);
  }

  if (order.sourceWebsite && order.platformAccountId) {
    throw new Error(
      `ORDER_SOURCE_ALREADY_MAPPED: Order #${orderId} already has recorded source '${order.sourceWebsite}' and platform account #${order.platformAccountId}. Cannot silently reassign.`
    );
  }

  const platformAccount = await validateExternalOrderSource({
    sourcePlatform,
    platformAccountId,
    platformAccountRef,
  });

  const previousValues = {
    sourceType: order.sourceType,
    sourceWebsite: order.sourceWebsite,
    platformAccountId: order.platformAccountId,
    platformFeeMinor: order.platformFeeMinor,
    boosterPoolMinor: order.boosterPoolMinor,
  };

  const updated = await prisma.$transaction(async (tx) => {
    // 1. Update order
    const ord = await tx.order.update({
      where: { id: orderId },
      data: {
        sourceType: 'external',
        sourceWebsite: platformAccount.platform,
        platformAccountId: platformAccount.id,
      },
    });

    // 2. Recalculate financial snapshot
    const snapshot = await calculateOrderFinancialSnapshot(
      {
        orderId,
        sourcePlatform: platformAccount.platform as any,
        sourceAmountType,
        sourceAmountMinor: ord.grossAmountMinor,
        platformAccountId: platformAccount.id,
        currency: ord.currency,
        gameSlug: ord.gameSlug,
        actorId,
        allowProvisional: true,
        notes: `LEGACY_MIGRATION: Source explicitly mapped to ${platformAccount.platform} (${platformAccount.accountRef}). Reason: ${reason}`,
      },
      tx
    );

    // 3. Update order economics
    const finalizedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        platformFeeMinor: snapshot.platformSaleCommissionMinor,
        boosterPoolMinor: snapshot.boosterPoolMinor,
      },
      include: {
        platformAccount: true,
        financialSnapshot: true,
      },
    });

    // 4. Audit Log
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'LEGACY_ORDER_SOURCE_MAPPED',
        entityType: 'order',
        entityId: String(orderId),
        previousValues: JSON.stringify(previousValues),
        newValues: JSON.stringify({
          sourceType: 'external',
          sourceWebsite: platformAccount.platform,
          platformAccountId: platformAccount.id,
          platformFeeMinor: snapshot.platformSaleCommissionMinor,
          boosterPoolMinor: snapshot.boosterPoolMinor,
          policyVersion: snapshot.policyVersion,
        }),
        reason,
        isSuccess: true,
      },
    });

    return {
      order: finalizedOrder,
      snapshot,
      platformAccount,
    };
  });

  return updated;
}

export interface CommercialSourceAuditResult {
  orderId: number;
  orderRef: string;
  creatorId: string | null;
  creatorType: string;
  commercialClassification: 'g4x_direct' | 'advertiser_direct' | 'external_platform';
  sourcePlatform: string;
  platformAccount: {
    id: number;
    accountRef: string;
    displayName: string;
    platform: string;
    isActive: boolean;
  } | null;
  grossAmountMinor: number;
  platformFeeMinor: number;
  boosterPoolMinor: number;
  sourceAmountType: string | null;
  isLegitimateDirect: boolean;
  isDeficitRisk: boolean;
  auditNotes: string[];
}

/**
 * Audits an order's commercial origin and economic allocation.
 * Addresses Task 9 ($15.00 Gross / $15.00 Booster Pool scenario).
 */
export async function auditOrderCommercialSource(orderId: number): Promise<CommercialSourceAuditResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      platformAccount: true,
      financialSnapshot: true,
    },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist.`);
  }

  const notes: string[] = [];
  let classification: 'g4x_direct' | 'advertiser_direct' | 'external_platform' = 'g4x_direct';
  let isLegitimateDirect = false;
  let isDeficitRisk = false;

  if (order.creatorType === 'advertiser' || order.advertiserId) {
    classification = 'advertiser_direct';
    notes.push('Commercial origin: Direct Advertiser order with rank commission structure.');
  } else if (order.sourceWebsite || order.sourceType === 'external' || order.platformAccountId) {
    classification = 'external_platform';
    notes.push(`Commercial origin: External sales platform (${order.sourceWebsite || 'unknown'}).`);
  } else {
    classification = 'g4x_direct';
    notes.push('Commercial origin: G4X Community direct order.');
  }

  // Audit of the $15.00 Gross / $15.00 Booster Pool scenario (Task 9)
  const isFullGrossToBooster = order.grossAmountMinor > 0 && order.boosterPoolMinor === order.grossAmountMinor;

  if (classification === 'g4x_direct') {
    if (isFullGrossToBooster) {
      isLegitimateDirect = true;
      notes.push(
        '100% allocation of gross amount to Booster Pool is legitimate for direct community orders with 0% G4X house fee.'
      );
    }
  } else if (classification === 'external_platform') {
    const inputBasis = order.financialSnapshot?.sourceAmountType || 'unknown';
    if (inputBasis === 'platform_net') {
      notes.push(
        'Input basis is platform_net: Seller commission was already deducted on external platform. Passing net proceeds to booster pool is valid.'
      );
    } else {
      // Input is gross or unrecorded on an external order
      if (isFullGrossToBooster && order.platformFeeMinor === 0) {
        isDeficitRisk = true;
        notes.push(
          'DEFICIT_RISK_DETECTED: Externally sourced order with gross input allocated 100% to Booster Pool without required seller platform fee deduction!'
        );
      }
    }
  }

  return {
    orderId: order.id,
    orderRef: order.orderRef,
    creatorId: order.creatorId,
    creatorType: order.creatorType,
    commercialClassification: classification,
    sourcePlatform: order.sourceWebsite || (classification === 'advertiser_direct' ? 'advertiser' : 'direct'),
    platformAccount: order.platformAccount
      ? {
          id: order.platformAccount.id,
          accountRef: order.platformAccount.accountRef,
          displayName: order.platformAccount.displayName,
          platform: order.platformAccount.platform,
          isActive: order.platformAccount.isActive,
        }
      : null,
    grossAmountMinor: order.grossAmountMinor,
    platformFeeMinor: order.platformFeeMinor,
    boosterPoolMinor: order.boosterPoolMinor,
    sourceAmountType: order.financialSnapshot?.sourceAmountType || null,
    isLegitimateDirect,
    isDeficitRisk,
    auditNotes: notes,
  };
}
