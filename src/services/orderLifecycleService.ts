/**
 * orderLifecycleService.ts — Authoritative G4X Order Lifecycle Controls & Funding Management
 *
 * Implements strict domain state machine transitions, categorized admin listings,
 * publication eligibility diagnosis, backed WalletV2 reservations, authoritative receipt verification,
 * and immutable audit logging.
 *
 * INVARIANTS:
 * 1. No "Mark Paid" or "Force Publish" shortcuts that bypass real evidence or backed wallet reserves.
 * 2. Unpaid orders (e.g. #1603 in payment_pending / paymentStatus='pending') are strictly blocked from Discord card publication.
 * 3. One-time receipt consumption (CAS update on PaymentReceiptStatus.ACTIVE -> CONSUMED).
 * 4. Strict separation between order funding and wallet top-up receipts.
 * 5. Full server-side RBAC, CSRF, and AuditLog on all mutations.
 */

import prisma from '../database/db';
import { Prisma } from '@prisma/client';
import { mapOrderStatus } from './statusSimplifier';
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureOrderAcceptsOperations, LEGAL_ORDER_TRANSITIONS, validateGameAndService } from './orderValidationService';
import { publishOrRefreshOrderCard } from './orderDiscordService';
import { handleOrderCancellationChannel } from './orderExecutionChannelService';
import { verifyOrderWithReceipt } from './payment/paymentReconciliationService';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import {
  AdvertiserRank,
  isValidAdvertiserRank,
  calculateRankCommission,
  ADVERTISER_RANK_POLICY_VERSION,
} from './advertiserRankService';
import { assertWalletInvariants } from './financeV2/financeV2WalletService';

export { LEGAL_ORDER_TRANSITIONS };

export type OrderLifecycleCategory =
  | 'pending_payment'
  | 'publishable'
  | 'published'
  | 'in_progress'
  | 'proof_review'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export interface OrderDiagnostics {
  orderId: number;
  orderRef: string;
  gameSlug: string;
  gameName: string;
  serviceId: number;
  serviceName: string;
  grossAmountMinor: number;
  grossAmountUsd: string;
  boosterPoolUsd: string;
  currency: string;
  status: string;
  paymentStatus: string;
  creatorId: string | null;
  creatorUsername: string | null;
  sourceType: string;
  sourceWebsite: string | null;
  platformAccountName: string | null;
  category: OrderLifecycleCategory;
  isPublishable: boolean;
  publicationBlockReasons: string[];
  explanationEnglish: string;
  requiredNextActionEnglish: string;
  supportedActions: string[];
  discordMessageId: string | null;
  publishedAt: Date | null;
  hasActivePaymentRequest: boolean;
  activeReceiptRef: string | null;
  creatorWalletAvailableCents: number;
  hasSufficientWalletBalance: boolean;
}

/**
 * Categorizes an order based on its authoritative DB state.
 */
export function categorizeOrder(order: {
  status: string;
  paymentStatus: string;
  discordMessageId?: string | null;
  boostReleaseTracker?: { stage: string | null } | null;
  disputes?: any[];
}): OrderLifecycleCategory {
  if (order.status === 'disputed' || (order.disputes && order.disputes.length > 0 && order.disputes.some((d) => d.status === 'open'))) {
    return 'disputed';
  }
  if (order.status === 'cancelled') {
    return 'cancelled';
  }
  if (order.status === 'completed') {
    return 'completed';
  }
  if (order.status === 'pending_review' || (order.boostReleaseTracker && order.boostReleaseTracker.stage && order.boostReleaseTracker.stage !== 'completed')) {
    return 'proof_review';
  }
  if (order.status === 'assigned' || order.status === 'in_progress' || order.status === 'presign_closed') {
    return 'in_progress';
  }
  if (order.paymentStatus === 'verified' || order.paymentStatus === 'unneeded') {
    if (order.discordMessageId) {
      return 'published';
    }
    return 'publishable';
  }
  return 'pending_payment';
}

/**
 * Evaluates publication eligibility and compiles a detailed diagnosis.
 */
export function evaluatePublicationEligibility(order: {
  id: number;
  grossAmountMinor: number;
  status: string;
  paymentStatus: string;
  discordMessageId?: string | null;
  walletAvailableCents?: number;
}): {
  isPublishable: boolean;
  reasons: string[];
  explanation: string;
  nextAction: string;
} {
  const reasons: string[] = [];
  const grossUsd = (order.grossAmountMinor / 100).toFixed(2);
  const isPaid = order.paymentStatus === 'verified' || order.paymentStatus === 'unneeded';

  if (!isPaid) {
    reasons.push(
      `ORDER_UNPAID: Payment status is '${order.paymentStatus}'. Gross required: $${grossUsd}. Unfunded orders cannot be published to the public Discord Orders Board to protect booster claims.`
    );
  }

  if (order.status !== 'open_presign' && order.status !== 'payment_pending' && order.status !== 'draft') {
    reasons.push(
      `INVALID_LIFECYCLE_STATUS: Order is currently in status '${order.status}'. Publication is only valid for open_presign orders.`
    );
  }

  const isPublishable = reasons.length === 0 && isPaid;

  let explanation: string;
  let nextAction: string;

  if (isPublishable) {
    if (order.discordMessageId) {
      explanation = `Order #${order.id} is verified and already published on the Discord Orders Board (Message ID: ${order.discordMessageId}).`;
      nextAction = 'Monitor booster pre-signs and proceed to squad assignment when roster requirements are met.';
    } else {
      explanation = `Order #${order.id} is fully verified and eligible for publication.`;
      nextAction = 'Publish the order card to Discord using POST /orders/' + order.id + '/publish or Discord command `G4!order publish ' + order.id + '`.';
    }
  } else {
    explanation = `Order #${order.id} cannot be published. ${reasons.join(' ')}`;
    if (!isPaid) {
      const avail = order.walletAvailableCents ?? 0;
      if (avail >= order.grossAmountMinor) {
        nextAction = `Creator wallet has sufficient funds ($${(avail / 100).toFixed(2)} available). Authorize order funding via POST /orders/${order.id}/pay-from-wallet or \`G4!order pay-wallet ${order.id}\` to reserve funds and transition order to publishable status.`;
      } else {
        nextAction = `Funding is required ($${grossUsd}). Legitimate options: 1) Deposit funds to WalletV2 and fund via POST /orders/${order.id}/pay-from-wallet, OR 2) Create a Payment Request (GET /payments/orders/${order.id}/request) for NOWPayments crypto or manual IRT bank transfer, submit payment evidence, and verify the resulting Payment Receipt (POST /orders/${order.id}/verify-payment or \`G4!order verify-payment ${order.id} <receiptRef>\`).`;
      }
    } else {
      nextAction = 'Resolve lifecycle state issues before retrying publication.';
    }
  }

  return { isPublishable, reasons, explanation, nextAction };
}

/**
 * Returns comprehensive order diagnostics including funding status, eligibility, and next actions.
 */
export async function getOrderDiagnostics(orderId: number): Promise<OrderDiagnostics> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      game: true,
      service: true,
      creator: true,
      platformAccount: true,
      boostReleaseTracker: true,
      disputes: true,
      paymentRequests: {
        include: {
          attempts: { orderBy: { createdAt: 'desc' } },
          receipts: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} does not exist`);
  }

  const creatorId = order.creatorId || order.advertiserId;
  let walletAvailableCents = 0;
  if (creatorId) {
    const wallet = await prisma.walletV2.findUnique({
      where: { userId: creatorId },
    });
    if (wallet) {
      walletAvailableCents = wallet.availableCents;
    }
  }

  const category = categorizeOrder(order);
  const eligibility = evaluatePublicationEligibility({
    id: order.id,
    grossAmountMinor: order.grossAmountMinor,
    status: order.status,
    paymentStatus: order.paymentStatus,
    discordMessageId: order.discordMessageId,
    walletAvailableCents,
  });

  // Check active receipts
  let activeReceiptRef: string | null = null;
  for (const pr of order.paymentRequests) {
    for (const r of pr.receipts) {
      if (r.status === 'ACTIVE') {
        activeReceiptRef = r.receiptRef;
        break;
      }
    }
    if (activeReceiptRef) break;
  }

  const supportedActions: string[] = ['VIEW_DETAILS'];
  if (order.status !== 'completed' && order.status !== 'cancelled') {
    supportedActions.push('CANCEL');
  }
  if (order.paymentStatus === 'pending') {
    supportedActions.push('CHECK_FUNDING', 'PAY_FROM_WALLET', 'CREATE_PAYMENT_REQUEST', 'VERIFY_RECEIPT');
  }
  if (eligibility.isPublishable && !order.discordMessageId) {
    supportedActions.push('PUBLISH');
  } else if (order.discordMessageId) {
    supportedActions.push('REFRESH_CARD');
  }

  return {
    orderId: order.id,
    orderRef: order.orderRef,
    gameSlug: order.gameSlug,
    gameName: order.game.displayName,
    serviceId: order.serviceId,
    serviceName: order.service.displayName,
    grossAmountMinor: order.grossAmountMinor,
    grossAmountUsd: (order.grossAmountMinor / 100).toFixed(2),
    boosterPoolUsd: (order.boosterPoolMinor / 100).toFixed(2),
    currency: order.currency,
    status: order.status,
    paymentStatus: order.paymentStatus,
    creatorId: order.creatorId,
    creatorUsername: order.creator?.username || null,
    sourceType: order.sourceType,
    sourceWebsite: order.sourceWebsite,
    platformAccountName: order.platformAccount?.displayName || null,
    category,
    isPublishable: eligibility.isPublishable,
    publicationBlockReasons: eligibility.reasons,
    explanationEnglish: eligibility.explanation,
    requiredNextActionEnglish: eligibility.nextAction,
    supportedActions,
    discordMessageId: order.discordMessageId,
    publishedAt: order.publishedAt,
    hasActivePaymentRequest: order.paymentRequests.length > 0,
    activeReceiptRef,
    creatorWalletAvailableCents: walletAvailableCents,
    hasSufficientWalletBalance: walletAvailableCents >= order.grossAmountMinor,
  };
}

/**
 * Returns categorized orders organized into the 7 admin categories required by Task 3.
 */
export async function getCategorizedOrders(options?: {
  limit?: number;
  gameSlug?: string;
}): Promise<{
  counts: Record<OrderLifecycleCategory, number>;
  orders: Record<OrderLifecycleCategory, any[]>;
}> {
  const limit = options?.limit || 100;
  const where: any = {};
  if (options?.gameSlug) {
    where.gameSlug = options.gameSlug;
  }

  const allOrders = await prisma.order.findMany({
    where,
    include: {
      game: true,
      service: true,
      platformAccount: true,
      boostReleaseTracker: true,
      disputes: true,
      paymentRequests: {
        include: {
          receipts: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const categorized: Record<OrderLifecycleCategory, any[]> = {
    pending_payment: [],
    publishable: [],
    published: [],
    in_progress: [],
    proof_review: [],
    completed: [],
    cancelled: [],
    disputed: [],
  };

  for (const o of allOrders) {
    const cat = categorizeOrder(o);
    const eligibility = evaluatePublicationEligibility({
      id: o.id,
      grossAmountMinor: o.grossAmountMinor,
      status: o.status,
      paymentStatus: o.paymentStatus,
      discordMessageId: o.discordMessageId,
    });

    categorized[cat].push({
      id: o.id,
      orderRef: o.orderRef,
      gameSlug: o.gameSlug,
      gameName: o.game.displayName,
      serviceName: o.service.displayName,
      status: o.status,
      paymentStatus: o.paymentStatus,
      grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
      boosterPoolUsd: (o.boosterPoolMinor / 100).toFixed(2),
      sourceType: o.sourceType,
      sourceWebsite: o.sourceWebsite,
      platformAccount: o.platformAccount?.displayName || null,
      creatorId: o.creatorId,
      discordMessageId: o.discordMessageId,
      publishedAt: o.publishedAt,
      createdAt: o.createdAt,
      isPublishable: eligibility.isPublishable,
      blockReason: eligibility.reasons.length > 0 ? eligibility.reasons[0] : null,
      nextAction: eligibility.nextAction,
    });
  }

  const counts: Record<OrderLifecycleCategory, number> = {
    pending_payment: categorized.pending_payment.length,
    publishable: categorized.publishable.length,
    published: categorized.published.length,
    in_progress: categorized.in_progress.length,
    proof_review: categorized.proof_review.length,
    completed: categorized.completed.length,
    cancelled: categorized.cancelled.length,
    disputed: categorized.disputed.length,
  };

  return { counts, orders: categorized };
}

/**
 * Authoritatively publishes an eligible order to the public Discord Orders Board.
 * Rejects unpaid or ineligible orders with clear English explanation.
 */
export async function publishOrder(
  orderId: number,
  actorId: string,
  client?: any,
  options?: { guildId?: string; targetChannelId?: string }
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} does not exist`);
  }

  // Permission verification
  const authInternal = await authorize(actorId, Permission.ORDER_PUBLISH);
  const authCreate = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
  if (!authInternal.allowed && !authCreate.allowed) {
    throw new Error(`Permission denied: Actor '${actorId}' lacks ORDER_PUBLISH permission.`);
  }

  // Publication payment guard
  const eligibility = evaluatePublicationEligibility({
    id: order.id,
    grossAmountMinor: order.grossAmountMinor,
    status: order.status,
    paymentStatus: order.paymentStatus,
    discordMessageId: order.discordMessageId,
  });

  if (!eligibility.isPublishable) {
    throw new DomainError(
      DomainErrorCode.PAYMENT_NOT_VERIFIED,
      `CANNOT_PUBLISH_ORDER: ${eligibility.explanation} Next action required: ${eligibility.nextAction}`
    );
  }

  const pubResult = await publishOrRefreshOrderCard(client, order.id, options);

  if (!pubResult.success) {
    throw new Error(pubResult.error || 'Failed to publish order card to Discord');
  }

  // AuditLog
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'ORDER_PUBLISHED',
      entityType: 'Order',
      entityId: String(order.id),
      reason: `Order #${order.id} published to Discord Orders Board (channel: ${pubResult.channelId}, message: ${pubResult.messageId})`,
      newValues: JSON.stringify({
        messageId: pubResult.messageId,
        channelId: pubResult.channelId,
        publishedAt: new Date(),
      }),
      isSuccess: true,
    },
  });

  return {
    success: true,
    messageId: pubResult.messageId,
    channelId: pubResult.channelId,
    isNew: pubResult.isNew,
  };
}

/**
 * Checks if a service corresponds to a World of Warcraft Mythic+ service.
 */
export function isMythicPlusService(service: { serviceKey: string; displayName?: string | null }): boolean {
  const key = (service.serviceKey || '').toLowerCase();
  const name = (service.displayName || '').toLowerCase();
  return key === 'mythic_plus' || key.includes('mythic') || name.includes('mythic');
}

export interface CreateAdvertiserBoostOrderInput {
  gameSlug: string;
  serviceId: number;
  grossAmountMinor: number;
  orderMode?: 'pilot' | 'non_pilot';
  runsCount?: number;
  keyLevel?: string | null;
  dungeonName?: string | null;
  requiredBoosterCount?: number | null;
  requiredRoles?: Array<{ roleName: string; quantity: number }> | null;
  vpnLocation?: string | null;
  customerInfo?: string | null;
  notes?: string | null;
  actorId: string;
  idempotencyKey?: string | null;
  actionSource?: 'web' | 'web_portal' | 'discord_wizard';
}

export interface CreateAdvertiserBoostOrderResult {
  order: any;
  snapshot: any;
  isFunded: boolean;
  isDuplicate?: boolean;
}

/**
 * Shared authoritative contract for creating Advertiser Boost Orders across Web and Discord.
 * Enforces:
 *  1. Authoritative game and service validation.
 *  2. Required service mode (pilot vs. non_pilot) and role composition (1 Tank, 1 Healer, 2 DPS for Mythic+).
 *  3. Mandatory target key level for Mythic+ and required VPN location for Pilot orders.
 *  4. Verified advertiser commercial rank and immutable fee snapshot.
 *  5. Atomic WalletV2 funds reservation (or safe payment_pending without false verification).
 *  6. Idempotency against duplicate submissions.
 */
export async function createAdvertiserBoostOrder(
  input: CreateAdvertiserBoostOrderInput
): Promise<CreateAdvertiserBoostOrderResult> {
  const { gameSlug, serviceId, grossAmountMinor, actorId } = input;

  if (!Number.isSafeInteger(grossAmountMinor) || grossAmountMinor <= 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      'Order gross amount must be a positive integer in cents'
    );
  }

  // 1. Authoritative game and service validation
  const { game, service } = await validateGameAndService(gameSlug, serviceId, input.orderMode);
  const isMythic = isMythicPlusService(service);
  const runsCount = Math.max(1, Math.floor(Number(input.runsCount) || 1));

  // 2. Validate service-specific requirements
  let orderMode: 'pilot' | 'non_pilot' = input.orderMode === 'pilot' ? 'pilot' : 'non_pilot';
  if (service.serviceMode === 'pilot') {
    orderMode = 'pilot';
  } else if (service.serviceMode === 'non_pilot' && !service.requiresPilotApproval) {
    orderMode = 'non_pilot';
  }

  if (orderMode === 'pilot') {
    if (!input.vpnLocation || !input.vpnLocation.trim()) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        'Pilot orders require a specified VPN location (e.g. Country & City)'
      );
    }
  }

  let keyLevel = input.keyLevel?.trim() || null;
  let dungeonName = input.dungeonName?.trim() || null;

  if (isMythic) {
    if (!keyLevel && !dungeonName) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        'Target dungeon and key level are required for Mythic+ orders (e.g. "+10 Ara-Kara")'
      );
    }
    const combined = `${keyLevel || ''} ${dungeonName || ''}`.trim();
    const hasDigits = /\d+/.test(combined);
    const textWithoutDigits = combined.replace(/[\d+]/g, '').trim();
    if (!hasDigits || textWithoutDigits.length < 2) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        'Target dungeon and key level are required for Mythic+ orders (e.g. "+10 Ara-Kara")'
      );
    }
  }

  // Assemble notes deterministically
  let assembledNotes = '';
  if (isMythic && (keyLevel || dungeonName)) {
    assembledNotes += `[Mythic+ Target: ${keyLevel || dungeonName}]`;
  }
  if (orderMode === 'pilot' && input.vpnLocation) {
    assembledNotes += `[Required VPN: ${input.vpnLocation.trim()}]`;
  }
  if (input.customerInfo && input.customerInfo.trim()) {
    assembledNotes += ` [Customer: ${input.customerInfo.trim()}]`;
  }
  if (input.notes && input.notes.trim()) {
    assembledNotes += ` ${input.notes.trim()}`;
  }
  assembledNotes = assembledNotes.trim();

  // 3. Verify advertiser or staff role and authoritative commercial rank if advertiser
  const user = await prisma.user.findUnique({
    where: { discordId: actorId },
    include: { userRoles: true },
  });
  if (!user) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `User '${actorId}' does not exist`);
  }
  const userRoles = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
  const isAdv = userRoles.includes('advertiser');
  const isStaffOrAdmin = userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r));

  if (!isAdv && !isStaffOrAdmin) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'PERMISSION_DENIED: Only registered advertisers or authorized staff can place direct boost orders'
    );
  }

  let advRank: AdvertiserRank | null = null;
  let platformFeeMinor = 0;
  let boosterPoolMinor = grossAmountMinor;
  let rankCommissionBps: number | null = null;

  if (isAdv) {
    advRank = user.advertiserRank as AdvertiserRank;
    if (!advRank || !isValidAdvertiserRank(advRank)) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        'UNRESOLVED_ADVERTISER_RANK: Direct Advertiser Boost order creation is blocked because the advertiser lacks an approved rank. Commercial rank must be assigned by management.'
      );
    }

    const calc = calculateRankCommission(grossAmountMinor, advRank);
    platformFeeMinor = calc.g4xFeeMinor;
    boosterPoolMinor = calc.remainingMinor;
    rankCommissionBps = calc.rankCommissionBasisPoints;
  }

  // 4. Atomic Execution within Database Transaction
  return await prisma.$transaction(async (tx) => {
    // Idempotency check if idempotencyKey supplied
    if (input.idempotencyKey) {
      const existingOrder = await tx.order.findFirst({
        where: { orderRef: `ORD_${input.idempotencyKey}` },
        include: { service: true, runs: true },
      });
      if (existingOrder) {
        return {
          order: existingOrder,
          snapshot: null,
          isFunded: existingOrder.paymentStatus === 'verified',
          isDuplicate: true,
        };
      }
    }

    const orderRef = input.idempotencyKey
      ? `ORD_${input.idempotencyKey}`
      : `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Atomic CAS reservation on available funds
    const updateResult = await tx.walletV2.updateMany({
      where: {
        userId: actorId,
        availableCents: { gte: grossAmountMinor },
      },
      data: {
        availableCents: { decrement: grossAmountMinor },
        reservedCents: { increment: grossAmountMinor },
      },
    });

    let paymentStatus = 'pending';
    let orderStatus = 'payment_pending';
    let paymentVerifiedBy: string | null = null;
    let paymentVerifiedAt: Date | null = null;

    if (updateResult.count > 0) {
      // Wallet had sufficient settled available funds
      const updatedWallet = await tx.walletV2.findUniqueOrThrow({
        where: { userId: actorId },
      });
      assertWalletInvariants(updatedWallet);

      const entryRef = `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const resIdempKey = input.idempotencyKey ? `ORDER_RES_${input.idempotencyKey}` : `ORDER_RES_${orderRef}`;

      await tx.ledgerEntryV2.create({
        data: {
          entryRef,
          userId: actorId,
          amountCents: grossAmountMinor,
          entryType: 'ORDER_RESERVE',
          direction: 'DEBIT',
          balanceAfterAvailableCents: updatedWallet.availableCents,
          balanceAfterReservedCents: updatedWallet.reservedCents,
          description: `Authoritative funds reserved from available USD balance for Order #${orderRef}`,
          idempotencyKey: resIdempKey,
          createdBy: actorId,
        },
      });

      paymentStatus = 'verified';
      orderStatus = 'open_presign';
      paymentVerifiedBy = actorId;
      paymentVerifiedAt = new Date();
    }

    const orderType = isMythic ? 'group' : (orderMode === 'pilot' ? 'pilot' : (runsCount > 1 || service.serviceMode === 'both' ? 'group' : 'solo'));

    const ord = await tx.order.create({
      data: {
        orderRef,
        gameSlug: game.slug,
        serviceId: service.id,
        creatorId: actorId,
        creatorType: isAdv ? 'advertiser' : 'g4x',
        advertiserId: isAdv ? actorId : null,
        advertiserRank: advRank,
        rankCommissionBps,
        orderType,
        orderMode,
        quantity: runsCount,
        currency: 'USD',
        grossAmountMinor,
        platformFeeMinor,
        advertiserFeeMinor: platformFeeMinor,
        boosterPoolMinor,
        paymentStatus,
        status: orderStatus,
        paymentVerifiedBy,
        paymentVerifiedAt,
        notes: assembledNotes || null,
        sourceType: 'direct',
        sourceWebsite: null,
        runs: {
          create: Array.from({ length: runsCount }, (_, i) => ({
            runNumber: i + 1,
            status: 'pending',
          })),
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
          : (orderMode === 'pilot'
              ? {
                  requiredRoles: {
                    create: [{ roleName: 'pilot', quantity: 1 }],
                  },
                }
              : (input.requiredRoles && input.requiredRoles.length > 0
                  ? {
                      requiredRoles: {
                        create: input.requiredRoles.map((r) => ({
                          roleName: r.roleName.toLowerCase(),
                          quantity: Math.max(1, Math.floor(Number(r.quantity) || 1)),
                        })),
                      },
                    }
                  : (input.requiredBoosterCount && input.requiredBoosterCount > 0
                      ? {
                          requiredRoles: {
                            create: [{ roleName: 'booster', quantity: Math.floor(input.requiredBoosterCount) }],
                          },
                        }
                      : {})))),
      },
      include: {
        service: true,
        runs: true,
        requiredRoles: true,
        game: true,
      },
    });

    if (updateResult.count > 0) {
      const resIdempKey = input.idempotencyKey ? `ORDER_RES_${input.idempotencyKey}` : `ORDER_RES_${orderRef}`;
      await tx.ledgerEntryV2.updateMany({
        where: { idempotencyKey: resIdempKey },
        data: { orderId: ord.id },
      });
    }

    if (isMythic && (keyLevel || dungeonName)) {
      const combined = `${keyLevel || ''} ${dungeonName || ''}`.trim();
      const numLevel = parseInt(combined.replace(/\D/g, ''), 10) || null;
      const parsedDungeon = dungeonName || keyLevel?.replace(/[+\d]/g, '').trim() || keyLevel;
      await tx.orderKeyRequirement.create({
        data: {
          orderId: ord.id,
          dungeonName: parsedDungeon || keyLevel,
          keyLevel: numLevel,
          isMandatory: true,
          notes: `Target Mythic+ dungeon & key: ${keyLevel || combined}`,
        },
      });
    }

    // Persist immutable commercial snapshot at authoritative commitment point if advertiser
    let snapshot = null;
    if (isAdv && advRank && rankCommissionBps !== null) {
      snapshot = await tx.orderFinancialSnapshot.create({
        data: {
          orderId: ord.id,
          sourcePlatform: 'advertiser',
          sourceAmountType: 'gross_sale',
          sourceAmountMinor: grossAmountMinor,
          grossSaleMinor: grossAmountMinor,
          platformOrderNetMinor: grossAmountMinor,
          externalNetBaseMinor: grossAmountMinor,
          g4xFeeRate: rankCommissionBps / 10000,
          g4xFeeMinor: platformFeeMinor,
          advertiserFeeMinor: 0,
          boosterPoolMinor,
          currency: 'USD',
          calculationStatus: 'provisional',
          policyVersion: ADVERTISER_RANK_POLICY_VERSION,
          advertiserId: actorId,
          advertiserRank: advRank,
          rankFeeBasisPoints: rankCommissionBps,
          remainingAmountMinor: boosterPoolMinor,
          snapshotTimestamp: new Date(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: input.actionSource === 'discord_wizard' ? 'ORDER_CREATED_DISCORD_WIZARD' : 'ORDER_CREATED_WEB_PORTAL',
        entityType: 'Order',
        entityId: String(ord.id),
        newValues: JSON.stringify({
          orderId: ord.id,
          orderRef: ord.orderRef,
          gameSlug: ord.gameSlug,
          serviceId: ord.serviceId,
          grossAmountUsd: (grossAmountMinor / 100).toFixed(2),
          paymentStatus,
          status: orderStatus,
          runsCount,
          isMythic,
          orderMode: ord.orderMode,
        }),
        reason: `Advertiser direct boost order created via ${input.actionSource || 'web portal'}`,
        isSuccess: true,
      },
    });

    (ord as any).financialSnapshot = snapshot;

    return {
      order: ord,
      snapshot,
      isFunded: paymentStatus === 'verified',
    };
  });
}

/**
 * Funds an order from creator's or advertiser's backed available WalletV2 balance.
 * Atomically reserves funds in WalletV2 using CAS and creates an ORDER_RESERVE ledger entry.
 */
export async function payOrderFromWallet(orderId: number, actorId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} does not exist`);
  }

  // Allowed payer: order creator, order advertiser, or management
  const isCreatorOrAdv = order.creatorId === actorId || order.advertiserId === actorId;
  if (!isCreatorOrAdv) {
    const authInternal = await authorize(actorId, Permission.ORDER_PAYMENT_VERIFY);
    if (!authInternal.allowed) {
      throw new Error(
        `Only the order creator or authorized administrator can fund Order #${orderId} from wallet.`
      );
    }
  }

  if (order.paymentStatus === 'verified') {
    return {
      success: true,
      alreadyVerified: true,
      message: `Order #${orderId} is already funded and verified.`,
      order,
    };
  }

  const fundingUserId = order.creatorId || order.advertiserId || actorId;

  return await prisma.$transaction(async (tx) => {
    // Atomic CAS update to prevent concurrent double-spending
    const updateResult = await tx.walletV2.updateMany({
      where: {
        userId: fundingUserId,
        availableCents: { gte: order.grossAmountMinor },
      },
      data: {
        availableCents: { decrement: order.grossAmountMinor },
        reservedCents: { increment: order.grossAmountMinor },
      },
    });

    if (updateResult.count === 0) {
      const wallet = await tx.walletV2.findUnique({ where: { userId: fundingUserId } });
      const avail = wallet ? (wallet.availableCents / 100).toFixed(2) : '0.00';
      const required = (order.grossAmountMinor / 100).toFixed(2);
      throw new Error(
        `INSUFFICIENT_FUNDS: Available wallet balance ($${avail}) is insufficient to fund Order #${orderId} ($${required}).`
      );
    }

    const updatedWallet = await tx.walletV2.findUniqueOrThrow({ where: { userId: fundingUserId } });
    assertWalletInvariants(updatedWallet);

    const entryRef = `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        userId: fundingUserId,
        orderId: order.id,
        amountCents: order.grossAmountMinor,
        entryType: 'ORDER_RESERVE',
        direction: 'DEBIT',
        balanceAfterAvailableCents: updatedWallet.availableCents,
        balanceAfterReservedCents: updatedWallet.reservedCents,
        description: `Payment reserved from available USD balance for Order #${order.orderRef}`,
        idempotencyKey: `ORDER_RES_${order.orderRef}`,
        createdBy: actorId,
      },
    });

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'verified',
        status: order.status === 'payment_pending' || order.status === 'draft' ? 'open_presign' : order.status,
        paymentVerifiedBy: actorId,
        paymentVerifiedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_WALLET_FUNDED',
        entityType: 'Order',
        entityId: String(orderId),
        previousValues: JSON.stringify({ paymentStatus: order.paymentStatus, status: order.status }),
        newValues: JSON.stringify({
          paymentStatus: 'verified',
          status: updatedOrder.status,
          ledgerEntryRef: entryRef,
          amountCents: order.grossAmountMinor,
        }),
        reason: `Order #${orderId} funded by reserving $${(order.grossAmountMinor / 100).toFixed(2)} from wallet of user '${fundingUserId}'`,
        isSuccess: true,
      },
    });

    return {
      success: true,
      message: `Order #${orderId} successfully funded and reserved from available wallet balance.`,
      order: updatedOrder,
    };
  });
}

/**
 * Cancels an order according to lifecycle rules.
 * Strictly idempotent and atomic:
 *  - Uses atomic CAS on order status to block concurrent duplicate cancellations.
 *  - Releases funds ONLY from genuine ORDER_RESERVE entries and never issues duplicate refunds.
 *  - Idempotently returns the cancelled order if already cancelled.
 */
export async function cancelOrderWithLifecycle(
  orderId: number,
  actorId: string,
  reason: string = 'Cancelled via order lifecycle management',
  client?: any
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      assignments: { where: { status: 'assigned' } },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  // Idempotency: if already cancelled, return existing cancelled order cleanly
  if (order.status === 'cancelled') {
    return {
      success: true,
      status: 'cancelled',
      message: `Order #${orderId} is already cancelled.`,
      order,
    };
  }

  if (order.status === 'completed') {
    throw new DomainError(
      DomainErrorCode.ORDER_ALREADY_CLOSED,
      `Order #${orderId} is completed and cannot be cancelled.`
    );
  }

  // Authorization check
  const auth = await authorize(actorId, Permission.ORDER_CANCEL, {
    orderId,
    targetUserId: actorId,
  });

  if (!auth.allowed) {
    throw new Error(
      `Permission denied: ${auth.reason || 'You do not have permission to cancel this order.'}`
    );
  }

  const fundingUserId = order.creatorId || order.advertiserId;

  const result = await prisma.$transaction(async (tx) => {
    // Atomic CAS transition on order status to block concurrent duplicate cancellations
    const updateCount = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { notIn: ['cancelled', 'completed'] },
      },
      data: { status: 'cancelled' },
    });

    if (updateCount.count === 0) {
      // Concurrently cancelled or completed by another request
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (current?.status === 'completed') {
        throw new DomainError(DomainErrorCode.ORDER_ALREADY_CLOSED, `Order #${orderId} was completed concurrently.`);
      }
      return {
        success: true,
        status: 'cancelled',
        message: `Order #${orderId} was already cancelled concurrently.`,
        order: current || order,
      };
    }

    // Release funds ONLY if genuinely funded and not already refunded
    if (order.paymentStatus === 'verified' && fundingUserId && order.grossAmountMinor > 0) {
      const existingReserve = await tx.ledgerEntryV2.findFirst({
        where: {
          userId: fundingUserId,
          entryType: 'ORDER_RESERVE',
          OR: [
            { orderId: order.id },
            { description: { contains: order.orderRef } },
          ],
        },
      });

      const releaseIdempKey = `ORDER_REL_${order.orderRef}`;
      const existingRelease = await tx.ledgerEntryV2.findFirst({
        where: {
          OR: [
            { idempotencyKey: releaseIdempKey },
            {
              userId: fundingUserId,
              entryType: 'ORDER_RELEASE',
              description: { contains: order.orderRef },
            },
          ],
        },
      });

      if (existingReserve && !existingRelease) {
        // Atomic CAS reversal of reserved balance
        const walletUpdate = await tx.walletV2.updateMany({
          where: {
            userId: fundingUserId,
            reservedCents: { gte: order.grossAmountMinor },
          },
          data: {
            reservedCents: { decrement: order.grossAmountMinor },
            availableCents: { increment: order.grossAmountMinor },
          },
        });

        if (walletUpdate.count > 0) {
          const updatedWallet = await tx.walletV2.findUniqueOrThrow({
            where: { userId: fundingUserId },
          });
          assertWalletInvariants(updatedWallet);

          await tx.ledgerEntryV2.create({
            data: {
              entryRef: `LEDGER_ORD_REL_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              userId: fundingUserId,
              orderId: order.id,
              amountCents: order.grossAmountMinor,
              entryType: 'ORDER_RELEASE',
              direction: 'CREDIT',
              balanceAfterAvailableCents: updatedWallet.availableCents,
              balanceAfterReservedCents: updatedWallet.reservedCents,
              description: `Reserved funds returned to available USD balance upon cancellation of Order #${order.orderRef}`,
              idempotencyKey: releaseIdempKey,
              reversalOfEntryRef: existingReserve.entryRef,
              createdBy: actorId,
            },
          });
        }
      }
    }

    await tx.boosterReservation.updateMany({
      where: { orderId: order.id, status: 'active' },
      data: {
        status: 'cancelled',
        releaseReason: reason,
        releasedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_CANCELLED',
        entityType: 'Order',
        entityId: String(orderId),
        previousValues: JSON.stringify({ status: order.status }),
        newValues: JSON.stringify({ status: 'cancelled', reason }),
        reason,
        isSuccess: true,
      },
    });

    const finalizedOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { service: true, runs: true },
    });

    return {
      success: true,
      status: 'cancelled',
      message: `Order #${orderId} successfully cancelled.`,
      order: finalizedOrder,
    };
  });

  if (client) {
    publishOrRefreshOrderCard(client, orderId).catch(() => {});
    handleOrderCancellationChannel(orderId, reason, client).catch(() => {});
  }

  return result;
}

/**
 * Returns audit logs for a specific order.
 */
export async function getOrderAuditHistory(orderId: number) {
  return await prisma.auditLog.findMany({
    where: {
      entityType: 'Order',
      entityId: String(orderId),
    },
    include: {
      actor: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Separated G4X and Advertiser Order Lists (Domain Engine & Privacy Enforcement)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderOriginClassification = 'g4x' | 'advertiser' | 'needs_review';

export interface SeparatedOrderListItem {
  id: number;
  orderRef: string;
  originType: OrderOriginClassification;
  gameSlug: string;
  gameName: string;
  serviceId: number;
  serviceName: string;
  sourceType: string;
  sourceWebsite: string | null;
  sourceLabel: string;
  platformAccount: {
    id: number;
    displayName: string;
    accountRef: string;
    platform: string;
  } | null;
  advertiser: {
    id: string | null;
    username: string | null;
    displayName: string;
    advertiserRank: string;
    rankCommissionBps: number;
    commissionPercent: string;
  };
  grossAmountMinor: number;
  grossAmountUsd: string;
  currency: string;
  feeInfo: {
    platformFeeUsd?: string;
    advertiserFeeUsd?: string;
    boosterPoolUsd?: string;
    netAmountUsd?: string;
    platformAccountName?: string | null;
    platformAccountRef?: string | null;
    settlementState?: string;
  };
  paymentStatus: string;
  status: string;
  simplifiedStatus: {
    label: string;
    colorClass: string;
    rawStatus: string;
  };
  runsCount: number;
  assignedCount: number;
  assignedBooster: string | null;
  releaseStage: string | null;
  isPublishable: boolean;
  authorizedActions: string[];
  notes: string | null;
  externalOrderId: string | null;
  orderName: string | null;
  discordChannelId: string | null;
  createdAt: string;
}

export interface SeparatedOrdersQuery {
  tab?: 'g4x' | 'advertiser';
  origin?: 'g4x' | 'advertiser' | 'needs_review';
  page?: number | string;
  limit?: number | string;
  search?: string;
  status?: string;
  paymentStatus?: string;
  gameSlug?: string;
  source?: string; // 'all' | 'direct' | 'g2g' | 'skycoach' | 'eldorado' | 'needs_review'
  startDate?: string;
  endDate?: string;
  user: {
    discordId: string;
    userRoles: Array<{ roleKey?: string; role?: string }>;
  };
}

export interface SeparatedOrdersResult {
  success: true;
  tab: 'g4x' | 'advertiser';
  counts: {
    g4x: number;
    advertiser: number;
    needsReview: number;
  };
  pagination: {
    page: number;
    limit: number;
    total?: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  orders: SeparatedOrderListItem[];
}

/**
 * Classifies an order's financial origin deterministically from authoritative DB fields.
 * Never infers origin from Discord category names, channel IDs, or freeform text labels.
 */
export function classifyOrderOrigin(order: {
  creatorType?: string | null;
  advertiserId?: string | null;
  sourceWebsite?: string | null;
  sourceType?: string | null;
}): OrderOriginClassification {
  const cType = (order.creatorType || '').toLowerCase().trim();
  const hasAdvId = Boolean(order.advertiserId && order.advertiserId.trim());

  // Indeterminate / unrecognized creator types that conflict with domain invariants
  if (cType && cType !== 'g4x' && cType !== 'advertiser') {
    return 'needs_review';
  }

  // Advertiser-originated orders (either explicitly creatorType=advertiser or owned by advertiserId)
  if (hasAdvId || cType === 'advertiser') {
    return 'advertiser';
  }

  // Pure G4X-managed orders
  if (cType === 'g4x' && !hasAdvId) {
    return 'g4x';
  }

  // Historical records with empty creatorType but platform/source indicators
  if (!cType && !hasAdvId) {
    if (order.sourceWebsite || order.sourceType) {
      return 'g4x';
    }
    return 'needs_review';
  }

  return 'needs_review';
}

/**
 * Authoritative separated order listing service for the web dashboard.
 * Enforces server-side RBAC, strict advertiser ownership isolation (no cross-owner data leakage),
 * multi-criteria filtering, and server-side pagination.
 */
export async function getSeparatedOrdersList(
  query: SeparatedOrdersQuery
): Promise<SeparatedOrdersResult> {
  const userRoleNames = (query.user.userRoles || []).map((r) => ((r.roleKey || r.role || '') as string).toLowerCase());
  const isStaff = userRoleNames.some((r) => ['owner', 'admin', 'manager', 'staff'].includes(r));
  const isAdvertiser = userRoleNames.includes('advertiser');

  const tab = (query.tab || query.origin || 'g4x') === 'advertiser' ? 'advertiser' : 'g4x';

  // Strict Authorization & Privacy Enforcements
  if (tab === 'g4x') {
    if (!isStaff) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'Access denied. Only G4X administrators and staff can view G4X-managed internal and platform orders.'
      );
    }
  } else {
    // tab === 'advertiser'
    if (!isStaff && !isAdvertiser) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'Access denied. You must be an advertiser or administrator to view advertiser orders.'
      );
    }
  }

  // Build WHERE conditions
  const andFilters: Prisma.OrderWhereInput[] = [];

  if (tab === 'g4x') {
    if (query.source === 'g2g') {
      andFilters.push({ sourceWebsite: 'g2g', advertiserId: null });
    } else if (query.source === 'skycoach') {
      andFilters.push({ sourceWebsite: 'skycoach', advertiserId: null });
    } else if (query.source === 'eldorado') {
      andFilters.push({ sourceWebsite: 'eldorado', advertiserId: null });
    } else if (query.source === 'direct') {
      andFilters.push({ sourceWebsite: null, advertiserId: null, creatorType: { not: 'advertiser' } });
    } else if (query.source === 'needs_review') {
      andFilters.push({
        OR: [
          { creatorType: { notIn: ['g4x', 'advertiser'] } },
          { creatorType: 'g4x', advertiserId: { not: null } },
        ],
      });
    } else {
      // 'all' G4X orders
      andFilters.push({
        OR: [
          { creatorType: 'g4x', advertiserId: null },
          { creatorType: { notIn: ['advertiser'] }, advertiserId: null },
        ],
      });
    }
  } else {
    // tab === 'advertiser'
    if (!isStaff) {
      // Strict privacy & ownership isolation: Ordinary Advertisers ONLY see orders they own that are genuine advertiser orders
      andFilters.push({
        sourceWebsite: null,
        OR: [
          { advertiserId: query.user.discordId },
          { creatorId: query.user.discordId, creatorType: 'advertiser' },
        ],
      });
    } else {
      // Staff viewing advertiser orders
      andFilters.push({
        sourceWebsite: null,
        OR: [
          { creatorType: 'advertiser' },
          { advertiserId: { not: null } },
        ],
      });
    }
  }

  // Common filters
  if (query.status && query.status !== 'all') {
    if (query.status === 'active') {
      andFilters.push({
        status: { in: ['draft', 'payment_pending', 'open_presign', 'presign_closed', 'assigned', 'in_progress', 'disputed'] },
      });
    } else if (query.status === 'history') {
      andFilters.push({
        status: { in: ['completed', 'cancelled'] },
      });
    } else {
      andFilters.push({ status: query.status });
    }
  }

  if (query.paymentStatus && query.paymentStatus !== 'all') {
    andFilters.push({ paymentStatus: query.paymentStatus });
  }

  if (query.gameSlug && query.gameSlug !== 'all') {
    andFilters.push({ gameSlug: query.gameSlug });
  }

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    andFilters.push({
      OR: [
        { orderRef: { contains: term } },
        { externalOrderId: { contains: term } },
        { notes: { contains: term } },
      ],
    });
  }

  if (query.startDate) {
    const start = new Date(query.startDate);
    if (!isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      andFilters.push({ createdAt: { gte: start } });
    }
  }

  if (query.endDate) {
    const end = new Date(query.endDate);
    if (!isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      andFilters.push({ createdAt: { lte: end } });
    }
  }

  const where: Prisma.OrderWhereInput = andFilters.length > 0 ? { AND: andFilters } : {};

  // Server-side pagination
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const totalCount = await prisma.order.count({ where });
  const orders = await prisma.order.findMany({
    where,
    include: {
      game: true,
      service: true,
      advertiser: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
          advertiserRank: true,
        },
      },
      creator: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
      platformAccount: true,
      runs: true,
      assignments: {
        where: { status: { in: ['assigned', 'accepted'] } },
        include: {
          user: {
            select: {
              discordId: true,
              username: true,
              displayName: true,
            },
          },
        },
      },
      boostReleaseTracker: true,
      financialSnapshot: true,
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const totalPages = Math.ceil(totalCount / limit) || 1;

  // Counts for tabs
  let counts = { g4x: 0, advertiser: 0, needsReview: 0 };
  if (isStaff) {
    const [g4xCount, advCount, revCount] = await Promise.all([
      prisma.order.count({
        where: {
          OR: [
            { creatorType: 'g4x', advertiserId: null },
            { creatorType: { notIn: ['advertiser'] }, advertiserId: null },
          ],
        },
      }),
      prisma.order.count({
        where: {
          OR: [
            { creatorType: 'advertiser' },
            { advertiserId: { not: null } },
          ],
        },
      }),
      prisma.order.count({
        where: {
          OR: [
            { creatorType: { notIn: ['g4x', 'advertiser'] } },
            { creatorType: 'g4x', advertiserId: { not: null } },
          ],
        },
      }),
    ]);
    counts = { g4x: g4xCount, advertiser: advCount, needsReview: revCount };
  } else if (isAdvertiser) {
    const myAdvCount = await prisma.order.count({
      where: {
        OR: [
          { advertiserId: query.user.discordId },
          { creatorId: query.user.discordId },
        ],
      },
    });
    counts = { g4x: 0, advertiser: myAdvCount, needsReview: 0 };
  }

  // Format DTOs
  const mappedOrders: SeparatedOrderListItem[] = orders.map((o) => {
    const origin = classifyOrderOrigin(o);

    let sourceBadge = 'G4X Direct';
    if (origin === 'g4x') {
      if (o.sourceWebsite === 'g2g') sourceBadge = 'G2G';
      else if (o.sourceWebsite === 'skycoach') sourceBadge = 'SkyCoach';
      else if (o.sourceWebsite === 'eldorado') sourceBadge = 'Eldorado';
      else sourceBadge = 'G4X Direct';
    } else if (origin === 'advertiser') {
      sourceBadge = 'Advertiser';
    } else {
      sourceBadge = 'Needs Review';
    }

    const advDisplayName =
      o.advertiser?.displayName ||
      o.advertiser?.username ||
      o.creator?.displayName ||
      o.creator?.username ||
      o.advertiserId ||
      'Unassigned';
    const advRank = o.advertiserRank || o.advertiser?.advertiserRank || 'STANDARD';
    const commissionBps = o.rankCommissionBps ?? 0;
    const commissionPercent = commissionBps > 0 ? `${(commissionBps / 100).toFixed(1)}%` : 'Standard';

    const feeInfo: SeparatedOrderListItem['feeInfo'] = {};
    if (isStaff) {
      feeInfo.platformFeeUsd = (o.platformFeeMinor / 100).toFixed(2);
      feeInfo.advertiserFeeUsd = (o.advertiserFeeMinor / 100).toFixed(2);
      feeInfo.boosterPoolUsd = (o.boosterPoolMinor / 100).toFixed(2);
      feeInfo.platformAccountName = o.platformAccount?.displayName || null;
      feeInfo.platformAccountRef = o.platformAccount?.accountRef || null;
      feeInfo.settlementState = o.boostReleaseTracker?.stage || 'PENDING';
    } else {
      feeInfo.advertiserFeeUsd = (o.advertiserFeeMinor / 100).toFixed(2);
      feeInfo.netAmountUsd = ((o.grossAmountMinor - o.advertiserFeeMinor) / 100).toFixed(2);
      feeInfo.settlementState = o.boostReleaseTracker?.stage || 'PENDING';
    }

    const activeAssignment = o.assignments?.[0]?.user;
    const assignedBooster = activeAssignment ? (activeAssignment.displayName || activeAssignment.username) : null;

    const actions: string[] = ['view_diagnostics'];
    const isPaid = o.paymentStatus === 'verified' || o.paymentStatus === 'unneeded';

    if (isStaff) {
      if (isPaid && !o.discordMessageId && o.status !== 'cancelled' && o.status !== 'completed') {
        actions.push('publish');
      }
      if (o.status !== 'cancelled' && o.status !== 'completed') {
        actions.push('cancel');
      }
      if (o.boostReleaseTracker?.stage === 'PROOF_SUBMITTED') {
        actions.push('staff_review');
      }
      if (o.boostReleaseTracker?.stage === 'STAFF_REVIEW') {
        actions.push('final_approve');
      }
      if (o.paymentStatus === 'pending') {
        actions.push('pay_wallet');
        actions.push('verify_payment');
      }
    } else if (isAdvertiser && (o.advertiserId === query.user.discordId || o.creatorId === query.user.discordId)) {
      if (o.paymentStatus === 'pending') {
        actions.push('pay_wallet');
      }
      if (['draft', 'payment_pending', 'open_presign'].includes(o.status) && o.assignments.length === 0) {
        actions.push('cancel');
      }
    }

    return {
      id: o.id,
      orderRef: o.orderRef,
      originType: origin,
      gameSlug: o.gameSlug,
      gameName: o.game.displayName,
      serviceId: o.serviceId,
      serviceName: o.service.displayName,
      sourceType: o.sourceType,
      sourceWebsite: o.sourceWebsite,
      sourceLabel: sourceBadge,
      platformAccount: isStaff && o.platformAccount ? {
        id: o.platformAccount.id,
        displayName: o.platformAccount.displayName,
        accountRef: o.platformAccount.accountRef,
        platform: o.platformAccount.platform,
      } : null,
      advertiser: {
        id: o.advertiserId,
        username: o.advertiser?.username || null,
        displayName: advDisplayName,
        advertiserRank: advRank,
        rankCommissionBps: commissionBps,
        commissionPercent,
      },
      grossAmountMinor: o.grossAmountMinor,
      grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
      currency: o.currency,
      feeInfo,
      paymentStatus: o.paymentStatus,
      status: o.status,
      simplifiedStatus: mapOrderStatus(o.status, o.boostReleaseTracker?.stage),
      runsCount: o.runs.length,
      assignedCount: o.assignments.length,
      assignedBooster,
      releaseStage: o.boostReleaseTracker?.stage || null,
      isPublishable: isPaid && !o.discordMessageId && o.status !== 'cancelled' && o.status !== 'completed',
      authorizedActions: actions,
      notes: o.notes,
      externalOrderId: o.externalOrderId,
      orderName: o.orderName || null,
      discordChannelId: o.executionChannelId || o.discordChannelId || null,
      createdAt: o.createdAt.toISOString(),
    };
  });

  return {
    success: true,
    tab,
    counts,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalCount,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    orders: mappedOrders,
  };
}
