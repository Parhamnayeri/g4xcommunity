/**
 * runValidationService.ts — اعتبارسنجی ران‌ها و تخصیص‌های اجرایی (Order Run & Execution Integrity)
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureOrderAcceptsOperations } from './orderValidationService';
import { Prisma } from '@prisma/client';

/**
 * اعتبارسنجی تعلق ران به سفارش و تخصیص مربوطه
 */
export async function validateRunAssignmentBelonging(
  runId: number,
  assignmentId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const run = await client.orderRun.findUnique({
    where: { id: runId },
  });
  if (!run) {
    throw new DomainError(DomainErrorCode.RUN_NOT_FOUND, `Run #${runId} not found`);
  }

  const assignment = await client.orderAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) {
    throw new DomainError(
      DomainErrorCode.ASSIGNMENT_CONFLICT,
      `Assignment #${assignmentId} not found`,
    );
  }

  if (run.orderId !== assignment.orderId) {
    throw new DomainError(
      DomainErrorCode.RUN_ORDER_MISMATCH,
      `Run #${runId} belongs to order #${run.orderId}, but assignment #${assignmentId} belongs to order #${assignment.orderId}`,
    );
  }

  return { run, assignment };
}

/**
 * اعتبارسنجی شروع ران
 */
export async function validateStartRun(
  runId: number,
  operatorId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const run = await client.orderRun.findUnique({
    where: { id: runId },
    include: { order: true },
  });

  if (!run) {
    throw new DomainError(DomainErrorCode.RUN_NOT_FOUND, `Run #${runId} not found`);
  }

  ensureOrderAcceptsOperations(run.order);

  if (run.status === 'cancelled') {
    throw new DomainError(
      DomainErrorCode.RUN_CANCELLED,
      `Cannot start cancelled run #${runId}`,
    );
  }

  if (run.status === 'completed') {
    throw new DomainError(
      DomainErrorCode.RUN_ALREADY_COMPLETED,
      `Run #${runId} has already been completed`,
    );
  }

  // بررسی انتساب اپراتور: کاربر باید عضو منتسب فعال همین سفارش باشد
  const activeAssignment = await client.orderAssignment.findFirst({
    where: {
      orderId: run.orderId,
      userId: operatorId,
      status: 'assigned',
    },
  });

  if (!activeAssignment) {
    throw new DomainError(
      DomainErrorCode.RUN_OPERATOR_UNASSIGNED,
      `User '${operatorId}' is not an active assigned booster for order #${run.orderId}`,
    );
  }

  return run;
}

/**
 * اعتبارسنجی و ثبت اتمام یک ران
 * توجه: اتمام یک ران به تنهایی سفارش را به وضعیت completed نمی‌برد!
 */
export async function completeOrderRun(
  runId: number,
  completedById: string,
  notes?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const run = await client.orderRun.findUnique({
    where: { id: runId },
    include: { order: true },
  });

  if (!run) {
    throw new DomainError(DomainErrorCode.RUN_NOT_FOUND, `Run #${runId} not found`);
  }

  ensureOrderAcceptsOperations(run.order);

  if (run.status === 'completed') {
    throw new DomainError(
      DomainErrorCode.RUN_ALREADY_COMPLETED,
      `Run #${runId} is already completed at ${run.completedAt?.toISOString()}`,
    );
  }

  if (run.status === 'cancelled') {
    throw new DomainError(
      DomainErrorCode.RUN_CANCELLED,
      `Cannot complete cancelled run #${runId}`,
    );
  }

  // بررسی فعال بودن کاربر انجام‌دهنده
  const activeAssignment = await client.orderAssignment.findFirst({
    where: {
      orderId: run.orderId,
      userId: completedById,
      status: 'assigned',
    },
  });

  if (!activeAssignment) {
    throw new DomainError(
      DomainErrorCode.RUN_OPERATOR_UNASSIGNED,
      `User '${completedById}' is not an assigned booster for order #${run.orderId}`,
    );
  }

  const now = new Date();
  const updatedRun = await client.orderRun.update({
    where: { id: runId },
    data: {
      status: 'completed',
      completedAt: now,
      finishedAt: now,
      completedBy: completedById,
      notes: notes ?? run.notes,
    },
  });

  return updatedRun;
}

/**
 * جایگزینی یک بوستر منتسب با حفظ کامل تاریخچه (Replacement Preservation)
 */
export async function replaceAssignment(
  assignmentId: number,
  replacementUserId: string,
  replacedById: string,
  reason: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return await (client as typeof prisma).$transaction(async (tx) => {
    const existing = await tx.orderAssignment.findUnique({
      where: { id: assignmentId },
      include: { order: true },
    });

    if (!existing) {
      throw new DomainError(
        DomainErrorCode.ASSIGNMENT_CONFLICT,
        `Assignment #${assignmentId} not found`,
      );
    }

    ensureOrderAcceptsOperations(existing.order);

    // ۱. آزادسازی رزرو بوستر قبلی
    await tx.boosterReservation.updateMany({
      where: {
        userId: existing.userId,
        orderId: existing.orderId,
        status: 'active',
      },
      data: {
        status: 'released',
        releasedAt: new Date(),
        releaseReason: `Replaced by ${replacementUserId}: ${reason}`,
      },
    });

    // ۲. ایجاد تخصیص جدید برای بوستر جایگزین
    const newAssignment = await tx.orderAssignment.create({
      data: {
        orderId: existing.orderId,
        userId: replacementUserId,
        assignedById: replacedById,
        assignedRole: existing.assignedRole,
        squadId: existing.squadId,
        status: 'assigned',
      },
    });

    // ۳. به‌روزرسانی تخصیص قدیمی و پیوند با تخصیص جدید (حفظ تاریخچه)
    const updatedOldAssignment = await tx.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'replaced',
        replacedById: newAssignment.id,
        replacedAt: new Date(),
        replacementReason: reason,
      },
    });

    // ۴. ایجاد رزرو فعال برای بوستر جایگزین
    await tx.boosterReservation.create({
      data: {
        userId: replacementUserId,
        orderId: existing.orderId,
        status: 'active',
        createdById: replacedById,
      },
    });

    return {
      oldAssignment: updatedOldAssignment,
      newAssignment,
    };
  });
}
