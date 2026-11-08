/**
 * claimService.ts — مدیریت و اعتبارسنجی ثبت کلیم‌های مستقل بوسترها (Booster Claims / Pre-sign)
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { validateUserApproval, ensureOrderAcceptsOperations } from './orderValidationService';
import { validatePremadeSquad } from './squadValidationService';
import { Prisma } from '@prisma/client';

export interface CreateClaimInput {
  orderId: number;
  userId: string;
  claimType: 'individual' | 'squad';
  registeredRole: string;
  characterId?: number | null;
  squadId?: number | null;
  hasKey?: 'yes' | 'no' | 'unknown';
  keyDungeon?: string | null;
  keyLevel?: number | null;
}

/**
 * ثبت کلیم مستقل برای سفارش
 */
export async function createOrderClaim(
  input: CreateClaimInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const now = new Date();

  // ۱. بررسی وضعیت سفارش و مهلت زمانی
  const order = await client.order.findUnique({
    where: { id: input.orderId },
    include: {
      requiredRoles: true,
      service: {
        include: {
          settings: true,
        },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${input.orderId} not found`);
  }

  ensureOrderAcceptsOperations(order);

  if (order.status !== 'open_presign') {
    throw new DomainError(
      DomainErrorCode.ORDER_NOT_OPEN_FOR_CLAIMS,
      `Order #${input.orderId} is not in 'open_presign' status (current status: '${order.status}')`,
    );
  }

  // Payment verification guard: Unfunded/unverified orders cannot be claimed
  if (order.paymentStatus !== 'verified' && order.paymentStatus !== 'unneeded') {
    throw new DomainError(
      DomainErrorCode.PAYMENT_NOT_VERIFIED,
      `Order #${input.orderId} cannot be claimed. Payment status is '${order.paymentStatus}'`,
    );
  }

  if (order.presignDeadline && now > order.presignDeadline) {
    throw new DomainError(
      DomainErrorCode.PRESIGN_WINDOW_CLOSED,
      `Presign deadline for order #${input.orderId} expired at ${order.presignDeadline.toISOString()}`,
    );
  }

  // ۲. اعتبارسنجی بوستر
  const serviceMode = order.service.serviceMode === 'pilot' ? 'pilot' : 'booster';
  await validateUserApproval(input.userId, order.gameSlug, order.serviceId, serviceMode, client);

  // ۳. اعتبارسنجی رول انتخابی در صورت تعریف رول‌های سفارش
  if (order.requiredRoles && order.requiredRoles.length > 0) {
    const validRoleNames = order.requiredRoles.map((r) => r.roleName.toLowerCase());
    if (!validRoleNames.includes(input.registeredRole.toLowerCase()) && input.registeredRole !== 'team') {
      throw new DomainError(
        DomainErrorCode.INVALID_ASSIGNED_ROLE,
        `Role '${input.registeredRole}' is not one of the required roles for order #${input.orderId} [${validRoleNames.join(', ')}]`,
      );
    }
  }

  // ۴. بررسی مالکیت و وضعیت کاراکتر
  let effectiveCharacterId = input.characterId;
  if (effectiveCharacterId) {
    const character = await client.wowCharacter.findUnique({
      where: { id: effectiveCharacterId },
    });
    if (!character) {
      throw new DomainError(
        DomainErrorCode.CHARACTER_NOT_FOUND,
        `Character #${effectiveCharacterId} not found`,
      );
    }
    if (character.userId !== input.userId) {
      throw new DomainError(
        DomainErrorCode.CHARACTER_NOT_OWNED,
        `Character '${character.characterName}' does not belong to user '${input.userId}'`,
      );
    }
    if (!character.isActive) {
      throw new DomainError(
        DomainErrorCode.CHARACTER_INACTIVE,
        `Character '${character.characterName}' is inactive.`,
      );
    }
  } else if (order.gameSlug.startsWith('wow') || order.gameSlug === 'wow_midnight' || order.gameSlug === 'wow') {
    // در صورت عدم انتخاب دستی در سفارش‌های WoW، کاراکتر اصلی فعال بوستر الصاق می‌شود
    const mainChar = await client.wowCharacter.findFirst({
      where: { userId: input.userId, isActive: true, isMain: true },
    });
    if (mainChar) {
      effectiveCharacterId = mainChar.id;
    }
  }

  // ۵. اعتبارسنجی تیم در کلیم‌های تیمی
  if (input.claimType === 'squad') {
    if (!input.squadId) {
      throw new DomainError(
        DomainErrorCode.SQUAD_NOT_FOUND,
        `Squad claim requires a valid squadId`,
      );
    }
    await validatePremadeSquad(input.squadId, order.gameSlug, order.serviceId, input.userId, client);
  }

  // ۶. ایجاد کلیم جدید با حفظ شناسه و تایم‌استمپ مستقل (بدون رزرو خودکار بوستر)
  const presign = await client.orderPresign.create({
    data: {
      orderId: input.orderId,
      userId: input.userId,
      characterId: effectiveCharacterId ?? null,
      squadId: input.claimType === 'squad' ? input.squadId : null,
      claimType: input.claimType,
      registeredRole: input.registeredRole,
      hasKey: input.hasKey ?? 'unknown',
      keyDungeon: input.keyDungeon ?? null,
      keyLevel: input.keyLevel ?? null,
      status: 'registered',
    },
  });

  return presign;
}

/**
 * پس‌گرفتن کلیم توسط بوستر با حفظ سابقه تاریخی
 */
export async function withdrawOrderClaim(
  claimId: number,
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const claim = await client.orderPresign.findUnique({
    where: { id: claimId },
    include: { order: true },
  });

  if (!claim) {
    throw new DomainError(DomainErrorCode.CLAIM_NOT_FOUND, `Claim #${claimId} not found`);
  }

  if (claim.userId !== userId) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${userId}' cannot withdraw claim belonging to '${claim.userId}'`,
    );
  }

  ensureOrderAcceptsOperations(claim.order);

  const updatedClaim = await client.orderPresign.update({
    where: { id: claimId },
    data: { status: 'withdrawn' },
  });

  return updatedClaim;
}
