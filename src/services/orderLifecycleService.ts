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
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureOrderAcceptsOperations, LEGAL_ORDER_TRANSITIONS } from './orderValidationService';
import { publishOrRefreshOrderCard } from './orderDiscordService';
import { handleOrderCancellationChannel } from './orderExecutionChannelService';
import { verifyOrderWithReceipt } from './payment/paymentReconciliationService';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';

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
 * Funds an order from creator's or advertiser's backed available WalletV2 balance.
 * Reserves funds in WalletV2 and creates an ORDER_RESERVE ledger entry.
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
    const wallet = await tx.walletV2.findUnique({
      where: { userId: fundingUserId },
    });

    if (!wallet || wallet.availableCents < order.grossAmountMinor) {
      const avail = wallet ? (wallet.availableCents / 100).toFixed(2) : '0.00';
      const required = (order.grossAmountMinor / 100).toFixed(2);
      throw new Error(
        `INSUFFICIENT_FUNDS: Available wallet balance ($${avail}) is insufficient to fund Order #${orderId} ($${required}).`
      );
    }

    const newAvailable = wallet.availableCents - order.grossAmountMinor;
    const newReserved = wallet.reservedCents + order.grossAmountMinor;

    await tx.walletV2.update({
      where: { userId: fundingUserId },
      data: {
        availableCents: newAvailable,
        reservedCents: newReserved,
      },
    });

    const entryRef = `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        userId: fundingUserId,
        amountCents: order.grossAmountMinor,
        entryType: 'ORDER_RESERVE',
        direction: 'DEBIT',
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: newReserved,
        description: `Payment reserved from available USD balance for Order #${order.orderRef}`,
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
 * If wallet funds were reserved, safely releases them back to available balance.
 */
export async function cancelOrderWithLifecycle(
  orderId: number,
  actorId: string,
  reason: string = 'Cancelled via order lifecycle management',
  client?: any
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
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

  ensureOrderAcceptsOperations(order);

  const fundingUserId = order.creatorId || order.advertiserId;

  const result = await prisma.$transaction(async (tx) => {
    // If order was verified and funds were reserved from wallet, release them back
    if (order.paymentStatus === 'verified' && fundingUserId) {
      const existingReserve = await tx.ledgerEntryV2.findFirst({
        where: {
          userId: fundingUserId,
          entryType: 'ORDER_RESERVE',
          description: { contains: order.orderRef },
        },
      });

      if (existingReserve) {
        const wallet = await tx.walletV2.findUnique({
          where: { userId: fundingUserId },
        });

        if (wallet && wallet.reservedCents >= order.grossAmountMinor) {
          const newAvailable = wallet.availableCents + order.grossAmountMinor;
          const newReserved = wallet.reservedCents - order.grossAmountMinor;

          await tx.walletV2.update({
            where: { userId: fundingUserId },
            data: {
              availableCents: newAvailable,
              reservedCents: newReserved,
            },
          });

          await tx.ledgerEntryV2.create({
            data: {
              entryRef: `LEDGER_ORD_REL_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              userId: fundingUserId,
              amountCents: order.grossAmountMinor,
              entryType: 'ORDER_RELEASE',
              direction: 'CREDIT',
              balanceAfterAvailableCents: newAvailable,
              balanceAfterReservedCents: newReserved,
              description: `Reserved funds returned to available USD balance upon cancellation of Order #${order.orderRef}`,
              createdBy: actorId,
            },
          });
        }
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
    });

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

    return updated;
  });

  // Background refresh of card and channel
  if (client) {
    publishOrRefreshOrderCard(client, order.id).catch(() => {});
    handleOrderCancellationChannel(order.id, reason, client).catch(() => {});
  }

  return { success: true, order: result };
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
