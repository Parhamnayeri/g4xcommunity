/**
 * withdrawalBatchService.ts — مدیریت چرخه حیات دسته‌های برداشت، تطبیق دریافت و تسهیم کارمزدها (Phase 3.4)
 *
 * چرخه حیات دسته‌ها (Batch Lifecycle):
 *  DRAFT -> READY -> SUBMITTED -> PROCESSING -> RECEIVED -> RECONCILED
 *  حالت‌های استثنا و کنترلی:
 *  - CANCELLED (فقط قبل از ارسال وجه به پلتفرم مجاز است؛ لغو دسته‌های ارسالی ممنوع بوده و نیازمند فرآیند بازبینی است)
 *  - FAILED (در صورت رد شدن یا شکست تراکنش توسط پلتفرم با ثبت دلیل و استرداد موجودی رزرو)
 *  - REVIEW_REQUIRED (در صورت عدم تطابق مبالغ دریافتی یا کسری مدارک که مانع از نهایی‌سازی مالی می‌شود)
 *
 * امنیت و انطباق:
 *  - دسترسی منحصراً به مدیران مالی مجاز (FINANCIAL_POLICY_MANAGE)
 *  - عدم ایجاد هرگونه اعتبار در والت بوسترها یا آزادسازی اسکرو در این فاز
 *  - پایستگی کامل سنت‌ها در تسهیم تناسبی با متد Largest Remainder
 *  - ثبت قطعی لاگ ممیزی و اسناد شواهد (Management Attestation)
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { getOrCreatePlatformAccount } from './platformBalanceService';
import { getPlatformWithdrawalThreshold } from './financialPolicyService';
import { allocateProportionalWithRemainder } from './financialCalculationEngine';
import { Prisma } from '@prisma/client';

export type BatchLifecycleStatus =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'processing'
  | 'received'
  | 'reconciled'
  | 'cancelled'
  | 'failed'
  | 'review_required';

export interface OrderContributionItem {
  orderId: number;
  contributionMinor: number;
}

export interface CreateBatchInput {
  platform: 'g2g' | 'skycoach' | 'eldorado';
  accountRef: string;
  currency?: string;
  orderContributions: OrderContributionItem[];
  actorId: string;
  notes?: string;
}

export interface RecordReceiptInput {
  batchId: number;
  actualReceivedMinor: number;
  actualBatchFeeMinor: number;
  actualTransferFeeMinor?: number;
  destinationAccountRef: string;
  safeEvidenceRef: string;
  actorId: string;
  externalReceiptRef?: string;
  reviewNotes?: string;
}

/**
 * ۱. ایجاد دسته برداشت اولیه (Draft Withdrawal Batch)
 * رزرو موجودی سفارشات انتخاب‌شده از حساب پلتفرم مربوطه جهت جلوگیری از برداشت دوباره (Double-Spend Prevention)
 */
export async function createDraftWithdrawalBatch(input: CreateBatchInput) {
  const { platform, accountRef, currency = 'USD', orderContributions, actorId, notes } = input;

  // بررسی احراز هویت و دسترسی مدیر مالی
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to create withdrawal batches'}`);
  }

  if (!orderContributions || orderContributions.length === 0) {
    throw new Error('EMPTY_BATCH: Withdrawal batch must contain at least one order contribution');
  }

  // اعتبارسنجی مبالغ مشارکت‌ها
  const totalContributionsMinor = orderContributions.reduce((sum, item) => {
    if (item.contributionMinor <= 0) {
      throw new Error(`INVALID_CONTRIBUTION: Order ${item.orderId} contribution must be greater than zero`);
    }
    return sum + item.contributionMinor;
  }, 0);

  return await prisma.$transaction(async (tx) => {
    // ۱. دریافت حساب پلتفرم
    const account = await getOrCreatePlatformAccount(accountRef, platform, undefined, currency, tx);

    if (!account.isActive) {
      throw new Error(`ACCOUNT_DEACTIVATED: Platform account '${accountRef}' is not active`);
    }

    // ۲. بررسی مانده قابل برداشت حساب پلتفرم
    if (account.eligibleBalanceMinor < totalContributionsMinor) {
      throw new Error(
        `INSUFFICIENT_PLATFORM_BALANCE: Account '${accountRef}' has eligible balance of $${(account.eligibleBalanceMinor / 100).toFixed(2)}, cannot reserve $${(totalContributionsMinor / 100).toFixed(2)}`
      );
    }

    // ۳. اعتبارسنجی تک‌تک سفارشات
    const orderIds = orderContributions.map((c) => c.orderId);
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        financialSnapshot: true,
        withdrawalAllocations: {
          include: {
            batch: true,
          },
        },
      },
    });

    if (orders.length !== orderIds.length) {
      throw new Error('ORDER_NOT_FOUND: One or more specified orders could not be found');
    }

    for (const contrib of orderContributions) {
      const order = orders.find((o) => o.id === contrib.orderId);
      if (!order) {
        throw new Error(`ORDER_NOT_FOUND: Order #${contrib.orderId} not found`);
      }

      // بررسی تطابق پلتفرم
      const orderPlatform = (order.sourceWebsite || order.financialSnapshot?.sourcePlatform || '').toLowerCase();
      if (orderPlatform !== platform.toLowerCase()) {
        throw new Error(
          `PLATFORM_MISMATCH: Order #${order.id} belongs to platform '${orderPlatform}', not batch platform '${platform}'`
        );
      }

      // بررسی تطابق ارز
      if (order.currency.toUpperCase() !== currency.toUpperCase()) {
        throw new Error(
          `CURRENCY_MISMATCH: Order #${order.id} currency (${order.currency}) does not match batch currency (${currency})`
        );
      }

      // بررسی تداخل رزرو قبلی فعال برای سفارش (Concurrent Reservation Prevention)
      const activeAllocations = order.withdrawalAllocations.filter(
        (a) => !['cancelled', 'failed'].includes(a.batch.status.toLowerCase())
      );

      const alreadyAllocatedMinor = activeAllocations.reduce((sum, a) => sum + a.contributionAmountMinor, 0);
      const orderNetMinor = order.financialSnapshot?.platformOrderNetMinor ?? order.grossAmountMinor;

      if (alreadyAllocatedMinor + contrib.contributionMinor > orderNetMinor) {
        throw new Error(
          `DUPLICATE_ORDER_RESERVATION: Order #${order.id} net proceeds is $${(orderNetMinor / 100).toFixed(2)}, but already allocated $${(alreadyAllocatedMinor / 100).toFixed(2)}. Cannot allocate additional $${(contrib.contributionMinor / 100).toFixed(2)}`
        );
      }
    }

    // ۴. ایجاد دسته در وضعیت پیش‌نویس (DRAFT)
    const batchRef = `BATCH_${platform.toUpperCase()}_${Date.now()}`;
    const batch = await tx.platformWithdrawalBatch.create({
      data: {
        batchRef,
        platform: platform.toLowerCase(),
        platformAccountId: account.id,
        accountRef: account.accountRef,
        currency: currency.toUpperCase(),
        status: 'draft',
        totalContributionsMinor,
        actualBatchFeeMinor: 0,
        actualTransferFeeMinor: 0,
        expectedNetMinor: totalContributionsMinor,
        netReceivedMinor: 0,
        externalReceiptNotes: notes ?? null,
      },
    });

    // ۵. ثبت رکوردهای سهم هر سفارش
    for (const contrib of orderContributions) {
      await tx.orderWithdrawalAllocation.create({
        data: {
          batchId: batch.id,
          orderId: contrib.orderId,
          contributionAmountMinor: contrib.contributionMinor,
          allocatedBatchFeeMinor: 0,
          allocatedTransferFeeMinor: 0,
          netContributionMinor: contrib.contributionMinor,
        },
      });
    }

    // ۶. رزرو وجوه در حساب پلتفرم (انتقال از eligible به reserved)
    await tx.platformAccount.update({
      where: { id: account.id },
      data: {
        eligibleBalanceMinor: { decrement: totalContributionsMinor },
        reservedBatchMinor: { increment: totalContributionsMinor },
      },
    });

    // ۷. ثبت تراکنش رزرو در دفتر کل پلتفرم
    await tx.platformAccountTransaction.create({
      data: {
        transactionRef: `PTX_RES_${batchRef}`,
        accountId: account.id,
        entryType: 'batch_reserve',
        amountMinor: totalContributionsMinor,
        currency: currency.toUpperCase(),
        batchId: batch.id,
        reason: `Reserved funds for withdrawal batch ${batchRef}`,
        createdBy: actorId,
      },
    });

    // ۸. ثبت لاگ ممیزی
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_WITHDRAWAL_BATCH_CREATED',
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
        newValues: JSON.stringify({
          batchRef,
          platform,
          accountRef,
          totalContributionsMinor,
          orderCount: orderContributions.length,
        }),
      },
    });

    return batch;
  });
}

/**
 * ۲. تغییر وضعیت دسته به آماده ارسال (Mark Batch Ready)
 * اعتبارسنجی حداقل آستانه مجاز پلتفرم
 */
export async function markBatchReady(batchId: number, actorId: string) {
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to manage withdrawal batches'}`);
  }

  const batch = await prisma.platformWithdrawalBatch.findUnique({
    where: { id: batchId },
  });

  if (!batch) {
    throw new Error(`BATCH_NOT_FOUND: Withdrawal batch #${batchId} not found`);
  }

  if (batch.status !== 'draft') {
    throw new Error(`INVALID_STATE_TRANSITION: Cannot transition batch from '${batch.status}' to 'ready'`);
  }

  const minThresholdMinor = getPlatformWithdrawalThreshold(batch.platform);
  if (batch.totalContributionsMinor < minThresholdMinor) {
    throw new Error(
      `THRESHOLD_NOT_MET: Platform '${batch.platform}' requires minimum withdrawal of $${(minThresholdMinor / 100).toFixed(2)}, batch has $${(batch.totalContributionsMinor / 100).toFixed(2)}`
    );
  }

  const updated = await prisma.platformWithdrawalBatch.update({
    where: { id: batchId },
    data: { status: 'ready' },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'PLATFORM_WITHDRAWAL_BATCH_READY',
      entityType: 'PlatformWithdrawalBatch',
      entityId: String(batch.id),
      previousValues: JSON.stringify({ status: batch.status }),
      newValues: JSON.stringify({ status: 'ready' }),
    },
  });

  return updated;
}

/**
 * ۳. ثبت ارسال دستی درخواست برداشت در پلتفرم خارجی (Submit Batch)
 */
export async function submitWithdrawalBatch(
  batchId: number,
  actorId: string,
  externalReceiptRef?: string,
  notes?: string
) {
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions'}`);
  }

  const batch = await prisma.platformWithdrawalBatch.findUnique({
    where: { id: batchId },
  });

  if (!batch) {
    throw new Error(`BATCH_NOT_FOUND: Batch #${batchId} not found`);
  }

  if (!['draft', 'ready'].includes(batch.status)) {
    throw new Error(`INVALID_STATE_TRANSITION: Cannot submit batch with status '${batch.status}'`);
  }

  const minThresholdMinor = getPlatformWithdrawalThreshold(batch.platform);
  if (batch.totalContributionsMinor < minThresholdMinor) {
    throw new Error(
      `THRESHOLD_NOT_MET: Minimum withdrawal of $${(minThresholdMinor / 100).toFixed(2)} required`
    );
  }

  const updated = await prisma.platformWithdrawalBatch.update({
    where: { id: batchId },
    data: {
      status: 'submitted',
      submittedAt: new Date(),
      submittedBy: actorId,
      externalReceiptRef: externalReceiptRef ?? batch.externalReceiptRef,
      externalReceiptNotes: notes ? [batch.externalReceiptNotes, notes].filter(Boolean).join(' | ') : batch.externalReceiptNotes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'PLATFORM_WITHDRAWAL_BATCH_SUBMITTED',
      entityType: 'PlatformWithdrawalBatch',
      entityId: String(batch.id),
      previousValues: JSON.stringify({ status: batch.status }),
      newValues: JSON.stringify({ status: 'submitted', externalReceiptRef }),
      reason: 'Batch submitted externally on platform by financial manager',
    },
  });

  return updated;
}

/**
 * ۴. لغو ایمن دسته پیش‌نویس (Safe Batch Cancellation)
 * بازگرداندن کامل وجوه رزروشده به موجودی قابل برداشت حساب پلتفرم
 * نکته امنیتی: لغو دسته‌های ارسالی (submitted/processing/received) اکیداً ممنوع است.
 */
export async function cancelWithdrawalBatch(batchId: number, actorId: string, reason: string) {
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions'}`);
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('AUDIT_REASON_REQUIRED: A valid audit reason is required for batch cancellation');
  }

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.platformWithdrawalBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new Error(`BATCH_NOT_FOUND: Batch #${batchId} not found`);
    }

    if (batch.status === 'cancelled') {
      return batch; // Idempotent
    }

    // جلوگیری از لغو خودسرانه دسته‌هایی که به پلتفرم ارسال شده‌اند
    if (!['draft', 'ready'].includes(batch.status)) {
      throw new Error(
        `ILLEGAL_CANCELLATION: Cannot naively cancel batch in '${batch.status}' status. Transfer has already been submitted or executed on the external platform. Requires explicit financial review/reversal procedure.`
      );
    }

    // ۱. آزادسازی وجوه رزروشده در حساب پلتفرم
    if (batch.platformAccountId) {
      await tx.platformAccount.update({
        where: { id: batch.platformAccountId },
        data: {
          reservedBatchMinor: { decrement: batch.totalContributionsMinor },
          eligibleBalanceMinor: { increment: batch.totalContributionsMinor },
        },
      });

      // ۲. ثبت در دفتر کل تراکنش‌ها
      await tx.platformAccountTransaction.create({
        data: {
          transactionRef: `PTX_REL_${batch.batchRef}_${Date.now()}`,
          accountId: batch.platformAccountId,
          entryType: 'batch_release',
          amountMinor: batch.totalContributionsMinor,
          currency: batch.currency,
          batchId: batch.id,
          reason: `Batch cancelled: ${reason}`,
          createdBy: actorId,
        },
      });
    }

    // ۳. تغییر وضعیت دسته به cancelled
    const updatedBatch = await tx.platformWithdrawalBatch.update({
      where: { id: batchId },
      data: {
        status: 'cancelled',
        reviewNotes: [batch.reviewNotes, `CANCELLED: ${reason}`].filter(Boolean).join(' | '),
      },
    });

    // ۴. ثبت لاگ ممیزی لغو
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_WITHDRAWAL_BATCH_CANCELLED',
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
        previousValues: JSON.stringify({ status: batch.status }),
        newValues: JSON.stringify({ status: 'cancelled', reason }),
        reason,
      },
    });

    return updatedBatch;
  });
}

/**
 * ۵. ثبت دریافت واقعی وجوه و تطبیق کارمزدها (Record Receipt & Attestation)
 * ثبت شواهد امن، حساب مقصد، کارمزدهای واقعی و تفکیک وصول واقعی از وصول تخمینی
 */
export async function recordBatchReceipt(input: RecordReceiptInput) {
  const {
    batchId,
    actualReceivedMinor,
    actualBatchFeeMinor,
    actualTransferFeeMinor = 0,
    destinationAccountRef,
    safeEvidenceRef,
    actorId,
    externalReceiptRef,
    reviewNotes,
  } = input;

  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions'}`);
  }

  if (!destinationAccountRef || destinationAccountRef.trim().length === 0) {
    throw new Error('DESTINATION_REQUIRED: Management destination account reference is required');
  }

  if (!safeEvidenceRef || safeEvidenceRef.trim().length === 0) {
    throw new Error('EVIDENCE_REQUIRED: Safe transaction evidence reference (e.g. TXID / receipt ref) is required');
  }

  if (actualReceivedMinor <= 0) {
    throw new Error('INVALID_RECEIVED_AMOUNT: Actually received amount must be greater than zero');
  }

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.platformWithdrawalBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new Error(`BATCH_NOT_FOUND: Batch #${batchId} not found`);
    }

    if (batch.status === 'reconciled') {
      return batch; // Idempotent
    }

    if (!['submitted', 'processing', 'ready', 'review_required'].includes(batch.status)) {
      throw new Error(`INVALID_STATE_TRANSITION: Cannot record receipt for batch in '${batch.status}' status`);
    }

    // بررسی انطباق مبالغ: دریافتی + کارمزدها باید برابر با کل مبلغ برداشت باشد
    const accountedTotal = actualReceivedMinor + actualBatchFeeMinor + actualTransferFeeMinor;
    const isDiscrepancy = accountedTotal !== batch.totalContributionsMinor;

    const nextStatus: BatchLifecycleStatus = isDiscrepancy ? 'review_required' : 'received';

    const updatedBatch = await tx.platformWithdrawalBatch.update({
      where: { id: batchId },
      data: {
        status: nextStatus,
        actualReceivedMinor,
        actualBatchFeeMinor,
        actualTransferFeeMinor,
        netReceivedMinor: actualReceivedMinor,
        destinationAccountRef,
        safeEvidenceRef,
        receiptConfirmedAt: new Date(),
        receiptConfirmedBy: actorId,
        externalReceiptRef: externalReceiptRef ?? batch.externalReceiptRef,
        failureReason: isDiscrepancy
          ? `DISCREPANCY_DETECTED: Accounted sum ($${(accountedTotal / 100).toFixed(2)}) does not match batch contribution total ($${(batch.totalContributionsMinor / 100).toFixed(2)})`
          : null,
        reviewNotes: reviewNotes
          ? [batch.reviewNotes, reviewNotes].filter(Boolean).join(' | ')
          : batch.reviewNotes,
      },
    });

    // در صورت عدم مغایرت، به‌روزرسانی مانده حساب پلتفرم (انتقال از reserved به withdrawn)
    if (!isDiscrepancy && batch.platformAccountId) {
      await tx.platformAccount.update({
        where: { id: batch.platformAccountId },
        data: {
          reservedBatchMinor: { decrement: batch.totalContributionsMinor },
          withdrawnTotalMinor: { increment: batch.totalContributionsMinor },
          receivedTotalMinor: { increment: actualReceivedMinor },
        },
      });

      await tx.platformAccountTransaction.create({
        data: {
          transactionRef: `PTX_REC_${batch.batchRef}`,
          accountId: batch.platformAccountId,
          entryType: 'funds_received',
          amountMinor: actualReceivedMinor,
          currency: batch.currency,
          batchId: batch.id,
          reason: `Actual funds received at ${destinationAccountRef} (fees: batch $${(actualBatchFeeMinor / 100).toFixed(2)}, transfer $${(actualTransferFeeMinor / 100).toFixed(2)})`,
          createdBy: actorId,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_WITHDRAWAL_RECEIPT_RECORDED',
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
        newValues: JSON.stringify({
          actualReceivedMinor,
          actualBatchFeeMinor,
          actualTransferFeeMinor,
          destinationAccountRef,
          safeEvidenceRef,
          status: nextStatus,
        }),
      },
    });

    return updatedBatch;
  });
}

/**
 * ۶. تسویه و تسهیم قطعی تناسبی هزینه‌ها میان سفارشات (Reconcile Batch & Exact Allocation)
 * اجرای متد Largest Remainder، به‌روزرسانی اسنپ‌شات سفارشات بدون شارژ مجدد یا اعتبار والت
 */
export async function reconcileWithdrawalBatch(batchId: number, actorId: string) {
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to reconcile batches'}`);
  }

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.platformWithdrawalBatch.findUnique({
      where: { id: batchId },
      include: {
        allocations: true,
      },
    });

    if (!batch) {
      throw new Error(`BATCH_NOT_FOUND: Batch #${batchId} not found`);
    }

    // قانون Idempotency: اگر قبلاً تسویه شده، بدون تغییر بازگردانده می‌شود
    if (batch.status === 'reconciled') {
      return { batch, alreadyReconciled: true };
    }

    // فقط دسته‌های با وضعیت received مجاز به تسویه هستند
    if (batch.status !== 'received') {
      throw new Error(
        `RECONCILIATION_BLOCKED: Batch status is '${batch.status}'. Actual receipt must be confirmed and matched before financial reconciliation.`
      );
    }

    if (!batch.safeEvidenceRef) {
      throw new Error('MISSING_RECEIPT_EVIDENCE: Cannot reconcile batch without verified receipt evidence');
    }

    const allocations = batch.allocations;
    if (allocations.length === 0) {
      throw new Error('EMPTY_ALLOCATIONS: No order allocations found in batch');
    }

    // ۱. تسهیم تناسبی کارمزد دسته (Batch Fee)
    const batchFeeAllocations = allocateProportionalWithRemainder(
      batch.actualBatchFeeMinor,
      allocations.map((a) => ({ id: a.orderId, contributionMinor: a.contributionAmountMinor }))
    );

    // ۲. تسهیم تناسبی کارمزد انتقال (Transfer Fee)
    const transferFeeAllocations = allocateProportionalWithRemainder(
      batch.actualTransferFeeMinor,
      allocations.map((a) => ({ id: a.orderId, contributionMinor: a.contributionAmountMinor }))
    );

    // ۳. به‌روزرسانی سهم هر سفارش و اسنپ‌شات‌های مالی
    for (const alloc of allocations) {
      const bAlloc = batchFeeAllocations.find((a) => a.id === alloc.orderId)?.allocatedMinor || 0;
      const tAlloc = transferFeeAllocations.find((a) => a.id === alloc.orderId)?.allocatedMinor || 0;
      const netContrib = alloc.contributionAmountMinor - bAlloc - tAlloc;

      await tx.orderWithdrawalAllocation.update({
        where: { id: alloc.id },
        data: {
          allocatedBatchFeeMinor: bAlloc,
          allocatedTransferFeeMinor: tAlloc,
          netContributionMinor: netContrib,
        },
      });

      // به‌روزرسانی اسنپ‌شات مالی سفارش بر مبنای مبلغ خالص وصول‌شده واقعی
      const existingSnapshot = await tx.orderFinancialSnapshot.findUnique({
        where: { orderId: alloc.orderId },
      });

      if (existingSnapshot) {
        // محاسبه خالص برون‌سازمانی پس از کسر کارمزدهای واقعی دسته و انتقال
        const newExternalNet = Math.max(
          0,
          existingSnapshot.platformOrderNetMinor - bAlloc - tAlloc - existingSnapshot.otherExternalFeesMinor
        );

        let newG4xFee = existingSnapshot.g4xFeeMinor;
        if (existingSnapshot.g4xFeeRate !== null && existingSnapshot.g4xFeeRate !== undefined) {
          // کارمزد G4X منحصراً بر پایه خالص پس از کسر کسورات خارجی محاسبه می‌شود
          newG4xFee = Math.round(newExternalNet * existingSnapshot.g4xFeeRate);
        }

        const newBoosterPool = Math.max(0, newExternalNet - newG4xFee);

        await tx.orderFinancialSnapshot.update({
          where: { orderId: alloc.orderId },
          data: {
            allocatedWithdrawalFeeMinor: bAlloc,
            allocatedTransferFeeMinor: tAlloc,
            externalNetBaseMinor: newExternalNet,
            g4xFeeMinor: newG4xFee,
            boosterPoolMinor: newBoosterPool,
            calculationStatus: 'reconciled',
            notes: [existingSnapshot.notes, `Reconciled with batch ${batch.batchRef}`]
              .filter(Boolean)
              .join(' | '),
          },
        });
      }
    }

    // ۴. به‌روزرسانی وضعیت دسته به reconciled
    const reconciledBatch = await tx.platformWithdrawalBatch.update({
      where: { id: batchId },
      data: {
        status: 'reconciled',
        reconciledAt: new Date(),
        reconciledBy: actorId,
      },
    });

    // ۵. ثبت لاگ ممیزی تسویه
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_WITHDRAWAL_BATCH_RECONCILED',
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
        newValues: JSON.stringify({
          batchRef: batch.batchRef,
          actualBatchFeeMinor: batch.actualBatchFeeMinor,
          actualTransferFeeMinor: batch.actualTransferFeeMinor,
          netReceivedMinor: batch.netReceivedMinor,
          orderCount: allocations.length,
        }),
      },
    });

    // نکته امنیتی: هیچ اعتباری به کیف‌پول بوسترها اضافه نمی‌شود (No wallet credits in Phase 3.4)
    return { batch: reconciledBatch, alreadyReconciled: false };
  });
}
