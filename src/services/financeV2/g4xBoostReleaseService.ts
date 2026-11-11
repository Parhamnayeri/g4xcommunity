/**
 * g4xBoostReleaseService.ts — مدیریت مراحل تایید اتمام و آزادسازی بوست‌های منتشره G4X (Phase 3.5 / Finance V2)
 *
 * مراحل هفت‌گانه مصوب:
 *  RUN_COMPLETED -> PROOF_SUBMITTED -> STAFF_REVIEW -> ADMIN_FINAL_APPROVED -> HOLD_24_HOURS -> ELIGIBLE_FOR_RELEASE -> AVAILABLE
 *
 * اصول و شروط کلیدی:
 *  ۱. دوره هولد ۲۴ ساعته منحصراً از تایم‌استمپ رسمی تایید نهایی ادمین (Admin Final Approval) محاسبه می‌شود.
 *  ۲. قانون ۲۴ ساعت صرفاً و منحصراً بر سفارشات منتشره توسط خود G4X (creatorType === 'g4x') اعمال می‌شود.
 *     سایر سفارشات (نظیر ادورتایزر یا پلتفرم‌های دیگر) بدون خط‌مشی مصوب نباید مشمول قاعده ۲۴ ساعته شوند.
 *  ۳. شروط غیرقابل مذاکره آزادسازی:
 *      - وصول و تسویه واقعی وجوه (Funds Received & Reconciled)
 *      - نهایی‌سازی محاسبات مالی سفارش (Snapshot Finalized)
 *      - عدم وجود هرگونه اختلاف یا توقیف فعال (No Active Dispute or Escrow Hold)
 *      - حضور بوسترهای واجد شرایط در ران‌های تکمیل‌شده
 *  ۴. کلید سراسری آزادسازی واقعی والت در این فاز اکیداً غیرفعال باقی می‌ماند (ESCROW_RELEASE_ENABLED=false).
 */

import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  G4XBoostReleaseStage,
  FINANCE_V2_CONSTANTS,
} from './financeV2Types';
import { releaseConfirmedEarningsToAvailable } from './financeV2WalletService';
import {
  syncOrderPendingEarnings,
  confirmOrderBoosterEarnings,
} from './boosterEarningsSyncService';

export interface EligibilityEvaluationResult {
  orderId: number;
  eligible: boolean;
  reasons: string[];
  stage: G4XBoostReleaseStage;
  adminFinalApprovedAt: Date | null;
  holdExpiresAt: Date | null;
  hoursElapsed: number;
  hoursRemaining: number;
  isFundsReconciled: boolean;
  isCalculationFinalized: boolean;
  hasActiveDispute: boolean;
  hasActiveHold: boolean;
}

/**
 * ۱. مقداردهی اولیه یا واکشی ردیاب مراحل آزادسازی بوست G4X
 */
export async function getOrCreateG4XBoostReleaseTracker(orderId: number) {
  const existing = await prisma.g4XBoostReleaseTracker.findUnique({
    where: { orderId },
  });

  if (existing) {
    return existing;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  return await prisma.g4XBoostReleaseTracker.create({
    data: {
      orderId,
      stage: G4XBoostReleaseStage.RUN_COMPLETED,
      holdDurationHours: FINANCE_V2_CONSTANTS.G4X_BOOST_HOLD_HOURS,
    },
  });
}

/**
 * ۲. ثبت ارسال شواهد و اسکرین‌شات اتمام ران (PROOF_SUBMITTED)
 */
export async function recordProofSubmitted(orderId: number, actorId?: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      runs: {
        where: { status: 'completed' },
      },
    },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  if (order.creatorType !== 'g4x') {
    throw new Error(
      `NOT_G4X_PUBLISHED_BOOST: Order creator type is '${order.creatorType}'. The 24-hour hold policy applies strictly to G4X-published boosts.`
    );
  }

  if (!order.runs || order.runs.length === 0) {
    throw new Error('NO_COMPLETED_RUNS: Cannot submit proof for an order with no completed runs');
  }

  const tracker = await getOrCreateG4XBoostReleaseTracker(orderId);

  // بررسی وضعیت‌های قبلی — جلوگیری از بازگشت پس از تایید نهایی بدون ممیزی
  if (tracker.stage === G4XBoostReleaseStage.HOLD_24_HOURS || tracker.stage === G4XBoostReleaseStage.AVAILABLE) {
    throw new Error(`INVALID_STAGE_TRANSITION: Cannot resubmit proof when order is already in '${tracker.stage}'`);
  }

  const updated = await prisma.g4XBoostReleaseTracker.update({
    where: { id: tracker.id },
    data: {
      stage: G4XBoostReleaseStage.PROOF_SUBMITTED,
      proofSubmittedAt: new Date(),
    },
  });

  await syncOrderPendingEarnings(orderId, actorId);
  return updated;
}

/**
 * ۳. ثبت بررسی اولیه مدارک توسط استف/ناظر (STAFF_REVIEW)
 */
export async function recordStaffReview(
  orderId: number,
  staffId: string,
  notes?: string
) {
  const auth = await authorize(staffId, Permission.PROOF_REVIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason || 'Insufficient permissions to review proof'}`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  if (order.creatorType !== 'g4x') {
    throw new Error(
      `NOT_G4X_PUBLISHED_BOOST: Order creator type is '${order.creatorType}'. The 24-hour hold policy applies strictly to G4X-published boosts.`
    );
  }

  const tracker = await getOrCreateG4XBoostReleaseTracker(orderId);

  // عدم امکان پرش از روی مرحله ثبت مدارک (Cannot skip PROOF_SUBMITTED stage)
  if (!tracker.proofSubmittedAt && tracker.stage === G4XBoostReleaseStage.RUN_COMPLETED) {
    throw new Error(
      'INVALID_STAGE_TRANSITION: Cannot conduct staff review before valid proof record is submitted (expected PROOF_SUBMITTED)'
    );
  }

  const updated = await prisma.g4XBoostReleaseTracker.update({
    where: { id: tracker.id },
    data: {
      stage: G4XBoostReleaseStage.STAFF_REVIEW,
      staffReviewedAt: new Date(),
      staffReviewedBy: staffId,
      notes: notes ? `${tracker.notes || ''} | Staff: ${notes}`.trim() : tracker.notes,
    },
  });

  await confirmOrderBoosterEarnings(orderId, staffId);
  return updated;
}

/**
 * ۴. تایید نهایی و حاکمیتی ادمین و آغاز رسمی دوره هولد ۲۴ ساعته (ADMIN_FINAL_APPROVED -> HOLD_24_HOURS)
 * الزامات قطعی امنیت و استیت ماشین:
 *  - احراز هویت و دسترسی ادمین مالی
 *  - تعلق انحصاری سفارش به گردش‌کار بوست‌های منتشرشده G4X (creatorType === 'g4x')
 *  - اتمام واقعی ران‌ها
 *  - ثبت معتبر مدارک (proofSubmittedAt)
 *  - انجام و ثبت معتبر بررسی توسط استف (staffReviewedAt)
 *  - جلوگیری اکید از پرش مستقیم به تایید نهایی
 *  - رد درخواست‌های تکراری و جلوگیری از ری‌استارت تصادفی ساعت ۲۴ ساعته هولد
 */
export async function recordAdminFinalApproval(
  orderId: number,
  adminId: string,
  notes?: string
) {
  const auth = await authorize(adminId, Permission.ORDER_FINAL_APPROVE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason || 'Insufficient permissions for final order approval'}`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      runs: {
        where: { status: 'completed' },
      },
      disputes: {
        where: { status: { in: ['open', 'under_review', 'waiting_for_evidence'] } },
      },
      escrowHolds: {
        where: { status: 'active' },
      },
    },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  // ۱. بررسی انحصاری بودن خط‌مشی برای بوست‌های منتشره G4X
  if (order.creatorType !== 'g4x') {
    throw new Error(
      `NOT_G4X_PUBLISHED_BOOST: Order creator type is '${order.creatorType}'. The 24-hour hold policy applies strictly to G4X-published boosts.`
    );
  }

  // ۲. بررسی اتمام واقعی ران‌ها
  if (!order.runs || order.runs.length === 0) {
    throw new Error('NO_COMPLETED_RUNS: Cannot grant Admin Final Approval for order with no completed runs');
  }

  // ۳. بررسی عدم وجود اختلاف یا توقیف فعال
  if (order.disputes && order.disputes.length > 0) {
    throw new Error(`ACTIVE_DISPUTE: Cannot grant Admin Final Approval while order has ${order.disputes.length} active dispute(s)`);
  }
  if (order.escrowHolds && order.escrowHolds.length > 0) {
    throw new Error(`ACTIVE_ESCROW_HOLD: Cannot grant Admin Final Approval while order has ${order.escrowHolds.length} active escrow hold(s)`);
  }

  const tracker = await getOrCreateG4XBoostReleaseTracker(orderId);

  // ۴. جلوگیری از تایید تکراری و راه‌اندازی مجدد ساعت ۲۴ ساعته (Duplicate Approval Clock-Restart Guard)
  if (
    tracker.adminFinalApprovedAt !== null ||
    tracker.stage === G4XBoostReleaseStage.HOLD_24_HOURS ||
    tracker.stage === G4XBoostReleaseStage.ELIGIBLE_FOR_RELEASE ||
    tracker.stage === G4XBoostReleaseStage.AVAILABLE
  ) {
    throw new Error(
      'ALREADY_FINAL_APPROVED: Order has already received Admin Final Approval. 24-hour clock cannot be restarted without an audited reopening process.'
    );
  }

  // ۵. جلوگیری اکید از پرش از روی مراحل بررسی مدارک و استف (No skipping to ADMIN_FINAL_APPROVED)
  if (!tracker.proofSubmittedAt || !tracker.staffReviewedAt || tracker.stage !== G4XBoostReleaseStage.STAFF_REVIEW) {
    throw new Error(
      `INVALID_STAGE_TRANSITION: Cannot grant final approval before proof submission and staff review stages are completed (Current stage: ${tracker.stage})`
    );
  }

  const approvedAt = new Date();
  const holdHours = tracker.holdDurationHours || FINANCE_V2_CONSTANTS.G4X_BOOST_HOLD_HOURS;
  const holdExpiresAt = new Date(approvedAt.getTime() + holdHours * 3600 * 1000);

  const updatedTracker = await prisma.g4XBoostReleaseTracker.update({
    where: { id: tracker.id },
    data: {
      stage: G4XBoostReleaseStage.HOLD_24_HOURS,
      adminFinalApprovedAt: approvedAt,
      adminFinalApprovedBy: adminId,
      holdExpiresAt,
      notes: notes ? `${tracker.notes || ''} | Admin: ${notes}`.trim() : tracker.notes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'G4X_BOOST_ADMIN_FINAL_APPROVED',
      entityType: 'Order',
      entityId: String(orderId),
      newValues: JSON.stringify({
        orderId,
        approvedAt,
        holdHours,
        holdExpiresAt,
      }),
    },
  });

  await confirmOrderBoosterEarnings(orderId, adminId);

  return updatedTracker;
}

/**
 * ۵. ارزیابی جامع اهلیت آزادسازی سفارش بر اساس شروط هفت‌گانه
 */
export async function evaluateG4XReleaseEligibility(
  orderId: number,
  options?: { now?: Date }
): Promise<EligibilityEvaluationResult> {
  const now = options?.now ?? new Date();
  const reasons: string[] = [];

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      boostReleaseTracker: true,
      financialSnapshot: true,
      disputes: {
        where: { status: { in: ['open', 'under_review', 'waiting_for_evidence'] } },
      },
      escrowHolds: {
        where: { status: 'active' },
      },
      runs: {
        where: { status: 'completed' },
      },
    },
  });

  if (!order) {
    return {
      orderId,
      eligible: false,
      reasons: ['ORDER_NOT_FOUND'],
      stage: G4XBoostReleaseStage.RUN_COMPLETED,
      adminFinalApprovedAt: null,
      holdExpiresAt: null,
      hoursElapsed: 0,
      hoursRemaining: 0,
      isFundsReconciled: false,
      isCalculationFinalized: false,
      hasActiveDispute: false,
      hasActiveHold: false,
    };
  }

  // شرط ۲: قانون ۲۴ ساعته منحصراً برای بوست‌های منتشرشده توسط G4X است
  if (order.creatorType !== 'g4x') {
    reasons.push(
      `NOT_G4X_PUBLISHED_BOOST: Order creator type is '${order.creatorType}'. The 24-hour hold policy applies strictly to G4X-published boosts.`
    );
  }

  const tracker = order.boostReleaseTracker;
  if (!tracker) {
    reasons.push('MISSING_RELEASE_TRACKER: No release tracker exists for this order');
  }

  const adminApprovedAt = tracker?.adminFinalApprovedAt ?? null;
  const holdExpiresAt = tracker?.holdExpiresAt ?? null;

  let hoursElapsed = 0;
  let hoursRemaining = 0;

  if (adminApprovedAt && holdExpiresAt) {
    hoursElapsed = Math.max(0, (now.getTime() - adminApprovedAt.getTime()) / (3600 * 1000));
    hoursRemaining = Math.max(0, (holdExpiresAt.getTime() - now.getTime()) / (3600 * 1000));

    // شرط ۱: اتمام کامل دوره ۲۴ ساعت از زمان تایید ادمین
    if (now < holdExpiresAt) {
      reasons.push(
        `HOLD_24_HOURS_ACTIVE: 24-hour holding period has not elapsed (${hoursRemaining.toFixed(1)} hours remaining)`
      );
    }
  } else {
    reasons.push('ADMIN_FINAL_APPROVAL_REQUIRED: Order has not received authoritative Admin Final Approval');
  }

  // شرط ۳: وصول و تسویه قطعی وجوه
  let isFundsReconciled = false;
  if (order.sourceType === 'internal') {
    isFundsReconciled = order.paymentStatus === 'verified' || order.paymentStatus === 'paid';
  } else {
    // پلتفرم‌های خارجی نیازمند تسویه دسته برداشت هستند
    isFundsReconciled = order.financialSnapshot?.calculationStatus === 'reconciled' ||
                         order.financialSnapshot?.calculationStatus === 'finalized';
  }

  if (!isFundsReconciled) {
    reasons.push('UNRECONCILED_FUNDS: Order funds have not been reconciled via actual verified receipt');
  }

  // شرط ۴: نهایی‌سازی محاسبات مالی
  const isCalculationFinalized = order.financialSnapshot?.calculationStatus === 'finalized';
  if (!isCalculationFinalized) {
    reasons.push('FINANCIAL_CALCULATION_NOT_FINALIZED: Financial snapshot calculation is not finalized');
  }

  // شرط ۵: عدم وجود اختلاف فعال
  const hasActiveDispute = (order.disputes && order.disputes.length > 0) || false;
  if (hasActiveDispute) {
    reasons.push(`ACTIVE_DISPUTE: Order has ${order.disputes.length} active dispute(s)`);
  }

  // شرط ۶: عدم وجود مسدودی/توقیف فعال
  const hasActiveHold = (order.escrowHolds && order.escrowHolds.length > 0) || false;
  if (hasActiveHold) {
    reasons.push(`ACTIVE_ESCROW_HOLD: Order has ${order.escrowHolds.length} active financial hold(s)`);
  }

  // شرط ۷: بررسی ران‌های تکمیل‌شده
  if (!order.runs || order.runs.length === 0) {
    reasons.push('NO_COMPLETED_RUNS: Order has no completed runs');
  }

  const eligible = reasons.length === 0;

  return {
    orderId,
    eligible,
    reasons,
    stage: (tracker?.stage as G4XBoostReleaseStage) || G4XBoostReleaseStage.RUN_COMPLETED,
    adminFinalApprovedAt: adminApprovedAt,
    holdExpiresAt,
    hoursElapsed,
    hoursRemaining,
    isFundsReconciled,
    isCalculationFinalized,
    hasActiveDispute,
    hasActiveHold,
  };
}

/**
 * ۶. تلاش برای آزادسازی نهایی موجودی به والت در دسترس (Release Execution)
 * قید غیرقابل دورزدن: احراز هویت، Idempotency، و قفل fail-closed منوط به ESCROW_RELEASE_ENABLED=true
 */
export async function executeG4XBoostRelease(orderId: number, actorId: string) {
  const auth = await authorize(actorId, Permission.ORDER_FINAL_APPROVE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason || 'Insufficient permissions to execute boost release'}`);
  }

  const tracker = await prisma.g4XBoostReleaseTracker.findUnique({
    where: { orderId },
  });

  if (tracker?.isReleased || tracker?.stage === G4XBoostReleaseStage.AVAILABLE) {
    throw new Error(`ALREADY_RELEASED: Order #${orderId} boost earnings have already been released`);
  }

  const evalResult = await evaluateG4XReleaseEligibility(orderId);

  if (!evalResult.eligible) {
    throw new Error(`RELEASE_INELIGIBLE: Cannot release order #${orderId}: ${evalResult.reasons.join('; ')}`);
  }

  // بررسی سوئیچ ایمنی پروداکشن
  if (process.env.ESCROW_RELEASE_ENABLED !== 'true') {
    // به‌روزرسانی ردیاب به وضعیت واجد شرایط، اما توقف واریز
    await prisma.g4XBoostReleaseTracker.update({
      where: { orderId },
      data: {
        stage: G4XBoostReleaseStage.ELIGIBLE_FOR_RELEASE,
        notes: 'Eligible for release; real wallet balance credit blocked by ESCROW_RELEASE_ENABLED=false',
      },
    });

    return {
      success: false,
      blockedByConfig: true,
      stage: G4XBoostReleaseStage.ELIGIBLE_FOR_RELEASE,
      message: 'Order is fully eligible for release, but real payouts and wallet releases are globally disabled (ESCROW_RELEASE_ENABLED=false).',
    };
  }

  // در صورت فعال بودن واقعی در آینده، واریز به ازای تخصیص‌های استخر انجام می‌شود
  return await prisma.$transaction(async (tx) => {
    await confirmOrderBoosterEarnings(orderId, actorId, tx);

    const allocations = await tx.boosterPayoutAllocation.findMany({
      where: { orderId },
      orderBy: { id: 'asc' },
    });

    for (const alloc of allocations) {
      if (alloc.allocatedMinor <= 0) continue;
      const releaseKey = `EARN_REL_G4X_ORD_${orderId}_BOOSTER_${alloc.boosterId}`;
      const alreadyRel = await tx.ledgerEntryV2.findUnique({ where: { idempotencyKey: releaseKey } });
      if (alreadyRel) continue;

      await releaseConfirmedEarningsToAvailable(
        alloc.boosterId,
        alloc.allocatedMinor,
        {
          orderId,
          entryRef: `LEDGER_REL_G4X_ORD_${orderId}_${alloc.boosterId}`,
          idempotencyKey: releaseKey,
          description: `Released G4X boost earnings for order #${orderId}`,
          createdBy: actorId,
        },
        tx
      );
    }

    const updatedTracker = await tx.g4XBoostReleaseTracker.update({
      where: { orderId },
      data: {
        stage: G4XBoostReleaseStage.AVAILABLE,
        isReleased: true,
        releasedAt: new Date(),
      },
    });

    return {
      success: true,
      blockedByConfig: false,
      stage: G4XBoostReleaseStage.AVAILABLE,
      tracker: updatedTracker,
    };
  });
}
