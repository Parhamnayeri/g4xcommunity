/**
 * orderValidationService.ts — اعتبارسنجی بازی، سرویس و چرخه حیات سفارشات (G4X Core Order Service)
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { Prisma } from '@prisma/client';

export type OrderStatus =
  | 'draft'
  | 'payment_pending'
  | 'open_presign'
  | 'presign_closed'
  | 'assigned'
  | 'in_progress'
  | 'pending_review'
  | 'completed'
  | 'cancelled';

/**
 * ماتریس انتقالات مجاز چرخه حیات سفارش (Order State Machine)
 */
export const LEGAL_ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ['payment_pending', 'open_presign', 'cancelled'],
  payment_pending: ['open_presign', 'cancelled'],
  open_presign: ['presign_closed', 'cancelled'],
  presign_closed: ['assigned', 'open_presign', 'cancelled'],
  assigned: ['in_progress', 'presign_closed', 'cancelled'],
  in_progress: ['pending_review', 'cancelled'], // فاز ۳.۱: الزام عبور از مسیر pending_review؛ تکمیل مستقیم ممنوع است
  pending_review: ['completed', 'in_progress', 'cancelled'],
  completed: [], // وضعیت نهایی (Terminal)
  cancelled: [], // وضعیت نهایی (Terminal)
};

/**
 * اعتبارسنجی بازی و سرویس انتخابی
 */
export async function validateGameAndService(
  gameSlug: string,
  serviceId: number,
  orderMode?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const game = await client.game.findUnique({
    where: { slug: gameSlug },
  });

  if (!game) {
    throw new DomainError(DomainErrorCode.GAME_NOT_FOUND, `Game '${gameSlug}' not found`);
  }
  if (!game.isActive) {
    throw new DomainError(DomainErrorCode.GAME_NOT_ACTIVE, `Game '${gameSlug}' is inactive`);
  }

  const service = await client.gameService.findUnique({
    where: { id: serviceId },
    include: { settings: true },
  });

  if (!service) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_FOUND, `Service #${serviceId} not found`);
  }
  if (!service.isActive) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_ACTIVE, `Service '${service.serviceKey}' is inactive`);
  }
  if (service.gameSlug !== gameSlug) {
    throw new DomainError(
      DomainErrorCode.SERVICE_GAME_MISMATCH,
      `Service #${serviceId} does not belong to game '${gameSlug}'`,
    );
  }

  if (orderMode) {
    if (orderMode === 'pilot' && service.serviceMode !== 'pilot' && !service.requiresPilotApproval) {
      throw new DomainError(
        DomainErrorCode.SERVICE_MODE_MISMATCH,
        `Service does not support pilot mode`,
      );
    }
    if (orderMode === 'non_pilot' && service.serviceMode === 'pilot') {
      throw new DomainError(
        DomainErrorCode.SERVICE_MODE_MISMATCH,
        `Pilot service cannot be ordered in non_pilot mode`,
      );
    }
  }

  return { game, service };
}

/**
 * اعتبارسنجی تایید صلاحیت کاربر برای بازی و سرویس موردنظر
 */
export async function validateUserApproval(
  userId: string,
  gameSlug: string,
  serviceId: number,
  approvalType: 'booster' | 'pilot' = 'booster',
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const service = await client.gameService.findUnique({
    where: { id: serviceId },
  });
  if (!service) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_FOUND, `Service #${serviceId} not found`);
  }

  // بررسی تایید صلاحیت بازی/سرویس (به صورت سراسری در بازی یا مختص سرویس)
  const approval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug,
      OR: [{ serviceId: null }, { serviceId }],
      approvalType,
    },
  });

  if (!approval) {
    throw new DomainError(
      approvalType === 'pilot' ? DomainErrorCode.PILOT_NOT_APPROVED : DomainErrorCode.BOOSTER_NOT_APPROVED,
      `User '${userId}' has no '${approvalType}' approval for game '${gameSlug}'`,
    );
  }

  if (approval.status !== 'approved') {
    throw new DomainError(
      DomainErrorCode.APPROVAL_EXPIRED_OR_SUSPENDED,
      `User '${userId}' approval status is '${approval.status}' (must be 'approved')`,
    );
  }

  // در صورتی که سرویس نیاز به Pilot دارد، احراز هویت خلبان نیز چک می‌شود
  if (approvalType === 'pilot' || service.requiresPilotApproval || service.serviceMode === 'pilot') {
    const pilotVerif = await client.pilotVerification.findFirst({
      where: {
        userId,
        gameSlug,
        status: 'approved',
      },
    });

    if (!pilotVerif) {
      throw new DomainError(
        DomainErrorCode.PILOT_NOT_APPROVED,
        `User '${userId}' requires approved Pilot verification for game '${gameSlug}'`,
      );
    }

    if (pilotVerif.expiresAt && pilotVerif.expiresAt < new Date()) {
      throw new DomainError(
        DomainErrorCode.APPROVAL_EXPIRED_OR_SUSPENDED,
        `Pilot verification for user '${userId}' expired at ${pilotVerif.expiresAt.toISOString()}`,
      );
    }
  }

  return approval;
}

/**
 * بررسی مجاز بودن گذار وضعیت در ماشین حالت سفارش
 */
export function validateOrderTransition(currentStatus: string, nextStatus: string) {
  const allowedNext = LEGAL_ORDER_TRANSITIONS[currentStatus];
  if (!allowedNext) {
    throw new DomainError(
      DomainErrorCode.INVALID_ORDER_TRANSITION,
      `Unknown current order status '${currentStatus}'`,
    );
  }

  if (!allowedNext.includes(nextStatus)) {
    throw new DomainError(
      DomainErrorCode.INVALID_ORDER_TRANSITION,
      `Invalid order transition from '${currentStatus}' to '${nextStatus}'. Allowed: [${allowedNext.join(', ')}]`,
    );
  }
}

/**
 * اطمینان از اینکه سفارش در وضعیت بسته یا لغوشده قرار ندارد
 */
export function ensureOrderAcceptsOperations(order: { status: string; id?: number }) {
  if (order.status === 'completed' || order.status === 'cancelled') {
    throw new DomainError(
      DomainErrorCode.ORDER_ALREADY_CLOSED,
      `Order is in terminal state '${order.status}' and cannot accept claims, assignments or mutations`,
    );
  }
}

/**
 * پیش‌نیازهای انتشار و عمومی‌سازی سفارش جهت دریافت درخواست بوسترها
 */
export async function validateOrderPublishPrerequisites(
  orderId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      game: true,
      service: true,
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  ensureOrderAcceptsOperations(order);
  await validateGameAndService(order.gameSlug, order.serviceId, order.orderMode, client);

  // بررسی وضعیت پرداخت: سفارش بدون پرداخت تاییدشده نباید برای عموم بوسترها باز شود
  if (order.paymentStatus !== 'verified' && order.paymentStatus !== 'unneeded') {
    throw new DomainError(
      DomainErrorCode.PAYMENT_NOT_VERIFIED,
      `Order #${orderId} cannot be opened for presign. Payment status is '${order.paymentStatus}'`,
    );
  }

  return order;
}

/**
 * اعتبارسنجی تایید نهایی اتمام سفارش
 */
export async function validateOrderCompletion(
  orderId: number,
  approvingUserId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      runs: true,
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  ensureOrderAcceptsOperations(order);

  // بررسی وضعیت سفارش: سفارش برای تایید نهایی اتمام باید حتماً در وضعیت pending_review باشد
  if (order.status !== 'pending_review') {
    throw new DomainError(
      DomainErrorCode.INVALID_ORDER_TRANSITION,
      `Order #${orderId} must be in 'pending_review' status before final completion (current status: '${order.status}'). Direct completion from in_progress is strictly forbidden.`,
    );
  }

  // بررسی نقش کاربر تاییدکننده: فقط Admin, Manager, Owner می‌توانند تایید نهایی کنند
  const userRoles = await client.userRole.findMany({
    where: { userId: approvingUserId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey);
  const isAuthorizedManager = roleKeys.some((k) => ['owner', 'manager', 'admin'].includes(k));

  if (!isAuthorizedManager) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${approvingUserId}' does not have authority to approve order completion. Advertisers and boosters cannot approve completion.`,
    );
  }

  // تمام ران‌های سفارش باید تعریف شده و کامل شده باشند
  if (order.runs.length < order.quantity) {
    throw new DomainError(
      DomainErrorCode.ORDER_QUANTITY_MISMATCH,
      `Order requires ${order.quantity} run(s), but only ${order.runs.length} run(s) are created`,
    );
  }

  const incompleteRuns = order.runs.filter((r) => r.status !== 'completed');
  if (incompleteRuns.length > 0) {
    throw new DomainError(
      DomainErrorCode.INCOMPLETE_RUNS_EXIST,
      `Cannot complete order: ${incompleteRuns.length} run(s) are incomplete (${incompleteRuns.map((r) => `#${r.runNumber}: ${r.status}`).join(', ')})`,
    );
  }

  return order;
}
