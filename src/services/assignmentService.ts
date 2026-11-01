/**
 * assignmentService.ts — تخصیص اتمیک بوسترها و جلوگیری از دابل‌بوکینگ (Atomic Assignment & Double-Booking Protection)
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { validateUserApproval, ensureOrderAcceptsOperations } from './orderValidationService';
import { validatePremadeSquad } from './squadValidationService';
import { getOrCreateOrderExecutionChannel } from './orderExecutionChannelService';
import { publishOrRefreshOrderCard } from './orderDiscordService';
import { Prisma } from '@prisma/client';

export interface AssignCandidate {
  userId: string;
  assignedRole: string;
  claimId?: number | null;
}

export interface AssignOrderInput {
  orderId: number;
  actorId: string;
  candidates?: AssignCandidate[];
  squadId?: number | null;
  discordClient?: any;
}

/**
 * بررسی مجوز اختصاص سفارش بر اساس نقش کاربر
 */
export async function verifyAssignmentActorPermissions(
  actorId: string,
  order: { advertiserId?: string | null; creatorId?: string | null },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const userRoles = await client.userRole.findMany({
    where: { userId: actorId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey);

  // مدیران ارشد همواره مجاز هستند
  const isManagement = roleKeys.some((k) => ['owner', 'manager', 'admin'].includes(k));
  if (isManagement) {
    return true;
  }

  // ادورتایزر فقط مجاز به تخصیص سفارشات متعلق به خودش است
  const isAdvertiser = roleKeys.includes('advertiser');
  if (isAdvertiser) {
    const isOwnerOfOrder =
      (order.advertiserId && order.advertiserId === actorId) ||
      (order.creatorId && order.creatorId === actorId);

    if (isOwnerOfOrder) {
      return true;
    }
  }

  throw new DomainError(
    DomainErrorCode.PERMISSION_DENIED,
    `Actor '${actorId}' is not authorized to assign boosters to this order`,
  );
}

/**
 * تخصیص اتمیک بوسترها به سفارش به همراه ایجاد رزرو یکتا در سطح پلتفرم
 */
export async function assignOrderBoosters(
  input: AssignOrderInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const result = await (client as typeof prisma).$transaction(async (tx) => {
    // ۱. دریافت اطلاعات کامل سفارش و پیش‌نیازها
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        requiredRoles: true,
        assignments: {
          where: { status: 'assigned' },
        },
      },
    });

    if (!order) {
      throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${input.orderId} not found`);
    }

    ensureOrderAcceptsOperations(order);

    // ۲. اعتبارسنجی دسترسی شخص تخصیص‌دهنده
    await verifyAssignmentActorPermissions(input.actorId, order, tx);

    // ۳. جمع‌آوری کاندیداها (از ورودی مستقیم یا گسترش تیم آماده)
    const effectiveCandidates: AssignCandidate[] = [];

    if (input.candidates && input.candidates.length > 0) {
      effectiveCandidates.push(...input.candidates);
    }

    if (input.squadId) {
      const squad = await validatePremadeSquad(
        input.squadId,
        order.gameSlug,
        order.serviceId,
        undefined,
        tx,
        { enforceMythicPlusSize: false },
      );

      for (const member of squad.members) {
        effectiveCandidates.push({
          userId: member.userId,
          assignedRole: member.memberRole ?? 'booster',
        });
      }
    }

    if (effectiveCandidates.length === 0) {
      throw new DomainError(
        DomainErrorCode.ASSIGNMENT_CONFLICT,
        'No booster candidates or valid squad provided for assignment',
      );
    }

    // ۴. اعتبارسنجی ظرفیت و نقش‌های مورد نیاز (Role Capacity Validation)
    if (order.requiredRoles && order.requiredRoles.length > 0) {
      const currentRoleCounts: Record<string, number> = {};
      for (const a of order.assignments) {
        const role = a.assignedRole.toLowerCase();
        currentRoleCounts[role] = (currentRoleCounts[role] ?? 0) + 1;
      }

      for (const candidate of effectiveCandidates) {
        const role = candidate.assignedRole.toLowerCase();
        const required = order.requiredRoles.find((r) => r.roleName.toLowerCase() === role);
        if (required) {
          const nextCount = (currentRoleCounts[role] ?? 0) + 1;
          if (nextCount > required.quantity) {
            throw new DomainError(
              DomainErrorCode.ROLE_CAPACITY_EXCEEDED,
              `Role capacity for '${candidate.assignedRole}' exceeded. Required: ${required.quantity}, Current active: ${currentRoleCounts[role] ?? 0}`,
            );
          }
          currentRoleCounts[role] = nextCount;
        }
      }
    }

    // ۵. اعتبارسنجی تایید صلاحیت، دابل‌بوکینگ و تخصیص تک‌تک بوسترها
    const createdAssignments = [];
    const createdReservations = [];

    for (const candidate of effectiveCandidates) {
      // ۵.۱. تایید صلاحیت بوستر در بازی و سرویس
      await validateUserApproval(
        candidate.userId,
        order.gameSlug,
        order.serviceId,
        order.orderMode === 'pilot' ? 'pilot' : 'booster',
        tx,
      );

      // ۵.۲. بررسی دابل‌بوکینگ در سطح کد قبل از درج
      const existingActiveReservation = await tx.boosterReservation.findFirst({
        where: {
          userId: candidate.userId,
          status: 'active',
        },
      });

      if (existingActiveReservation) {
        throw new DomainError(
          DomainErrorCode.BOOSTER_ALREADY_RESERVED,
          `Booster '${candidate.userId}' already has an active execution reservation on order #${existingActiveReservation.orderId}`,
        );
      }

      // ۵.۳. ایجاد رزرو سراسری پلتفرم برای بوستر (محافظت‌شده با Partial Unique Index در SQLite)
      const reservation = await tx.boosterReservation.create({
        data: {
          userId: candidate.userId,
          orderId: order.id,
          status: 'active',
          createdById: input.actorId,
        },
      });
      createdReservations.push(reservation);

      // ۵.۴. ایجاد رکورد تخصیص سفارش
      const assignment = await tx.orderAssignment.create({
        data: {
          orderId: order.id,
          userId: candidate.userId,
          assignedById: input.actorId,
          assignedRole: candidate.assignedRole,
          claimId: candidate.claimId ?? null,
          squadId: input.squadId ?? null,
          status: 'assigned',
        },
      });
      createdAssignments.push(assignment);

      // ۵.۵. به‌روزرسانی وضعیت کلیم در صورت وجود
      if (candidate.claimId) {
        await tx.orderPresign.update({
          where: { id: candidate.claimId },
          data: { status: 'selected' },
        });
      }
    }

    // ۶. به‌روزرسانی وضعیت سفارش به 'assigned'
    if (['draft', 'open_presign', 'presign_closed'].includes(order.status)) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'assigned' },
      });
    }

    // ۷. ثبت لاگ ممیزی اتمیک
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'ORDER_ASSIGNMENT_CREATED',
        entityType: 'order',
        entityId: String(order.id),
        newValues: JSON.stringify({
          assignmentsCount: createdAssignments.length,
          squadId: input.squadId ?? null,
          assignedUsers: effectiveCandidates.map((c) => c.userId),
        }),
      },
    });

    return {
      success: true,
      orderId: order.id,
      assignments: createdAssignments,
      reservations: createdReservations,
    };
  });

  if (input.discordClient) {
    try {
      await getOrCreateOrderExecutionChannel(input.orderId, input.discordClient, { actorId: input.actorId });
    } catch (chanErr) {
      console.warn(`[AssignmentService] Could not auto-create execution channel for order #${input.orderId}:`, chanErr);
    }

    try {
      await publishOrRefreshOrderCard(input.discordClient, input.orderId);
    } catch (cardErr) {
      console.warn(`[AssignmentService] Could not refresh publication card for order #${input.orderId}:`, cardErr);
    }
  }

  return result;
}
