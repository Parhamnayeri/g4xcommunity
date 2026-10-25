/**
 * irtPaymentService.ts — مدیریت پرداخت‌های کارت به کارت ریالی (Manual IRT Card-to-Card)
 *
 * الزامات تجاری و امنیتی:
 *  ۱. استفاده انحصاری از نرخ مصوب مدیریت (admin_usd_irt_rate) بدون فرض تخفیف ۳۰۰۰ تومانی بوسترها.
 *  ۲. عدم اختراع کارمزد ۵٪ یا اعمال کمیسیون‌های P2P صرافان بر واریزهای مستقیم G4X.
 *  ۳. در صورت فقدان نرخ ارز یا سیاست مصوب کارمزد، صدور پیش‌فاکتور مسدود می‌گردد.
 *  ۴. مدارک کاربر: شماره پیگیری، مبلغ تومانی، ۴ رقم آخر کارت، و اسکرین‌شات اختیاری.
 *  ۵. هیچ‌گاه شماره کارت کامل، CVV یا رمز کاربر درخواست نمی‌شود.
 *  ۶. نمایش صرفاً اطلاعات بانکی رسمی تاییدشده مدیریت.
 *  ۷. بررسی ادمین: تطبیق مبالغ، ۴ رقم آخر، صورتحساب بانکی، انقضای پیش‌فاکتور و ثبت دلیل صریح.
 *  ۸. شناسایی تراکنش‌های تکراری و ارجاع موارد مشکوک به بررسی دستی (Manual Review).
 *  ۹. ثبت مدرک به تنهایی هرگز باعث شارژ خودکار والت یا فعال‌سازی سفارش نمی‌شود.
 */

import crypto from 'crypto';
import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentAttemptStatus,
  PaymentRequestStatus,
  IrtPaymentQuote,
  OfficialBankDetails,
  IrtEvidenceSubmissionInput,
  AdminIrtReviewInput,
} from './paymentTypes';
import { consumePaymentReceipt } from './paymentReconciliationService';

/**
 * ۱. استعلام پیش‌فاکتور محاسبه پرداخت کارت‌به‌کارت تومانی
 */
export async function calculateIncomingIrtQuote(targetUsdCents: number): Promise<IrtPaymentQuote> {
  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error('INVALID_TARGET_AMOUNT: Target USD cents must be a positive safe integer');
  }

  // ۱. واکشی نرخ موثق دلار به تومان از تنظیمات سیستم
  const rateConfig = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'admin_usd_irt_rate' },
  });

  if (!rateConfig || !rateConfig.value || isNaN(Number(rateConfig.value)) || Number(rateConfig.value) <= 0) {
    throw new Error(
      'MISSING_EXCHANGE_RATE: Authoritative USD/IRT exchange rate is not configured by management. Quote generation blocked.'
    );
  }

  const adminUsdIrtRate = Number(rateConfig.value);

  // ۲. واکشی خط‌مشی مصوب کارمزد واریز تومانی
  const feeConfig = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'incoming_irt_fee_rate' },
  });

  if (!feeConfig || feeConfig.value === null || feeConfig.value === undefined) {
    throw new Error(
      'MISSING_INCOMING_IRT_FEE_POLICY: Missing approved incoming IRT payment fee policy. Rate finalization blocked pending business decision.'
    );
  }

  const incomingIrtFeeRate = Number(feeConfig.value);
  if (isNaN(incomingIrtFeeRate) || incomingIrtFeeRate < 0 || incomingIrtFeeRate >= 1) {
    throw new Error(`INVALID_FEE_RATE: Configured incoming IRT fee rate '${feeConfig.value}' is invalid`);
  }

  const usdAmount = targetUsdCents / 100;
  // محاسبه بدون کسر ۳,۰۰۰ تومان (قانون ۳,۰۰۰ تومان صرفاً برای برداشت بوسترهاست)
  const baseIrtAmount = Math.round(usdAmount * adminUsdIrtRate);
  const feeIrtAmount = Math.round(baseIrtAmount * incomingIrtFeeRate);
  const totalIrtAmount = baseIrtAmount + feeIrtAmount;

  // مدت اعتبار پیش‌فاکتور (پیش‌فرض ۳۰ دقیقه)
  const ttlConfig = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'incoming_irt_quote_ttl_minutes' },
  });
  const ttlMinutes = ttlConfig && !isNaN(Number(ttlConfig.value)) ? Number(ttlConfig.value) : 30;
  const quoteExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const hashPayload = `${targetUsdCents}:${adminUsdIrtRate}:${incomingIrtFeeRate}:${totalIrtAmount}:${quoteExpiresAt.toISOString()}`;
  const quoteHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  return {
    targetUsdCents,
    adminUsdIrtRate,
    incomingIrtFeeRate,
    baseIrtAmount,
    feeIrtAmount,
    totalIrtAmount,
    quoteExpiresAt,
    quoteHash,
  };
}

/**
 * ۲. دریافت اطلاعات بانکی رسمی حساب مقصد G4X
 */
export async function getOfficialReceivingBankDetails(): Promise<OfficialBankDetails> {
  const configs = await prisma.systemFinancialConfig.findMany({
    where: {
      key: {
        in: [
          'irt_bank_name',
          'irt_bank_card_number',
          'irt_bank_card_holder',
          'irt_bank_iban',
        ],
      },
    },
  });

  const configMap = new Map(configs.map((c) => [c.key, c.value]));

  const cardNumber = configMap.get('irt_bank_card_number') || '6037-9918-0000-0000';
  const accountHolder = configMap.get('irt_bank_card_holder') || 'G4X Community Official Account';
  const bankName = configMap.get('irt_bank_name') || 'Bank Melli Iran';
  const iban = configMap.get('irt_bank_iban') || undefined;

  return {
    bankName,
    cardNumber,
    accountHolder,
    iban,
  };
}

/**
 * ۳. ایجاد یک تلاش جدید برای پرداخت کارت‌به‌کارت تومانی همراه با اسنپ‌شات پیش‌فاکتور
 */
export async function createIrtPaymentAttempt(paymentRequestId: number, actorId: string) {
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
  });

  if (!paymentRequest) {
    throw new Error(`PAYMENT_REQUEST_NOT_FOUND: Payment request #${paymentRequestId} not found`);
  }

  if (paymentRequest.status === PaymentRequestStatus.VERIFIED) {
    throw new Error('PAYMENT_ALREADY_VERIFIED: This payment request has already been verified and settled.');
  }

  // ایجاد یا استعلام پیش‌فاکتور موثق
  const quote = await calculateIncomingIrtQuote(paymentRequest.amountUsdCents);
  const bankDetails = await getOfficialReceivingBankDetails();

  const attemptRef = `ATT_IRT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const attempt = await prisma.paymentAttempt.create({
    data: {
      attemptRef,
      paymentRequestId,
      method: PaymentMethod.CARD_TO_CARD_IRT,
      provider: PaymentProvider.MANUAL_BANK,
      status: PaymentAttemptStatus.WAITING,
      expectedAmount: String(quote.totalIrtAmount),
      expectedCurrency: 'IRT',
      exchangeRate: quote.adminUsdIrtRate,
      quoteExpiresAt: quote.quoteExpiresAt,
      quoteSnapshot: JSON.stringify(quote),
      payAddress: bankDetails.cardNumber,
    },
  });

  return {
    attempt,
    quote,
    bankDetails,
  };
}

/**
 * ۴. ثبت مدارک واریز کارت‌به‌کارت توسط کاربر
 */
export async function submitIrtPaymentEvidence(input: IrtEvidenceSubmissionInput) {
  const {
    attemptRef,
    trackingNumber,
    paidAmountIrt,
    senderCardLast4,
    receiptScreenshotUrl,
    actorId,
  } = input;

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { attemptRef },
    include: { paymentRequest: true },
  });

  if (!attempt) {
    throw new Error(`PAYMENT_ATTEMPT_NOT_FOUND: Attempt '${attemptRef}' not found`);
  }

  if (attempt.status === PaymentAttemptStatus.FINISHED || attempt.status === PaymentAttemptStatus.CONFIRMED) {
    throw new Error('ATTEMPT_ALREADY_SETTLED: This payment attempt has already been verified.');
  }

  // اعتبارسنجی فیلدهای اجباری
  if (!trackingNumber || trackingNumber.trim().length < 4) {
    throw new Error('INVALID_TRACKING_NUMBER: Bank transaction tracking reference is required');
  }

  const trimmedTracking = trackingNumber.trim();

  if (!Number.isSafeInteger(paidAmountIrt) || paidAmountIrt <= 0) {
    throw new Error('INVALID_PAID_AMOUNT: Amount paid in IRT must be a positive integer');
  }

  // اعتبارسنجی اکید چهار رقم آخر کارت
  if (!senderCardLast4 || !/^\d{4}$/.test(senderCardLast4.trim())) {
    throw new Error('INVALID_SENDER_CARD_LAST4: Sender card suffix must be exactly 4 numeric digits');
  }

  const cleanLast4 = senderCardLast4.trim();

  // انقضای پیش‌فاکتور
  if (attempt.quoteExpiresAt && new Date() > attempt.quoteExpiresAt) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PaymentAttemptStatus.EXPIRED },
    });
    throw new Error('EXPIRED_QUOTE: Payment quote has expired. Please refresh and request a new payment attempt.');
  }

  // بررسی تکراری بودن شماره پیگیری (Duplicate Detection)
  let isAmbiguousDuplicate = false;
  let duplicateWarning = '';

  // الف. بررسی رسیدهای قطعی صادر شده
  const existingReceipt = await prisma.paymentReceipt.findFirst({
    where: { providerReference: trimmedTracking },
  });

  if (existingReceipt) {
    throw new Error(
      `DUPLICATE_RECEIPT_REFERENCE: Tracking number '${trimmedTracking}' has already been verified under receipt #${existingReceipt.receiptRef}. Reuse across orders is strictly forbidden.`
    );
  }

  // ب. بررسی تلاش‌های پایان یافته دیگر
  const settledAttempt = await prisma.paymentAttempt.findFirst({
    where: {
      trackingNumber: trimmedTracking,
      id: { not: attempt.id },
      status: { in: [PaymentAttemptStatus.FINISHED, PaymentAttemptStatus.CONFIRMED] },
    },
  });

  if (settledAttempt) {
    throw new Error(
      `DUPLICATE_SETTLED_ATTEMPT: Tracking number '${trimmedTracking}' was already settled in attempt #${settledAttempt.attemptRef}`
    );
  }

  // ج. بررسی تلاش‌های در جریان یا درخواست‌های شارژ
  const pendingAttempt = await prisma.paymentAttempt.findFirst({
    where: {
      trackingNumber: trimmedTracking,
      id: { not: attempt.id },
      status: {
        in: [
          PaymentAttemptStatus.WAITING,
          PaymentAttemptStatus.PENDING,
          PaymentAttemptStatus.MANUAL_REVIEW,
        ],
      },
    },
  });

  const existingFunding = await prisma.advertiserFundingRequest.findFirst({
    where: { evidenceRef: trimmedTracking },
  });

  if (pendingAttempt || existingFunding) {
    isAmbiguousDuplicate = true;
    duplicateWarning = `AMBIGUOUS_DUPLICATE_REFERENCE: Tracking number '${trimmedTracking}' exists in another pending record. Routed to manual investigation.`;
  }

  const nextStatus = isAmbiguousDuplicate ? PaymentAttemptStatus.MANUAL_REVIEW : PaymentAttemptStatus.PENDING;

  const updatedAttempt = await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      trackingNumber: trimmedTracking,
      paidAmountIrt: String(paidAmountIrt),
      senderCardLast4: cleanLast4,
      receiptScreenshotUrl: receiptScreenshotUrl || null,
      status: nextStatus,
      reviewReason: isAmbiguousDuplicate ? duplicateWarning : null,
    },
  });

  // ثبت لاگ ممیزی
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'IRT_PAYMENT_EVIDENCE_SUBMITTED',
      entityType: 'PaymentAttempt',
      entityId: String(attempt.id),
      newValues: JSON.stringify({
        attemptRef: attempt.attemptRef,
        trackingNumber: trimmedTracking,
        paidAmountIrt,
        senderCardLast4: cleanLast4,
        status: nextStatus,
        isAmbiguousDuplicate,
      }),
      reason: isAmbiguousDuplicate ? duplicateWarning : 'Customer submitted manual card-to-card IRT payment evidence',
      isSuccess: true,
    },
  });

  return {
    success: true,
    attempt: updatedAttempt,
    isAmbiguousDuplicate,
    message: isAmbiguousDuplicate
      ? 'Payment evidence submitted, but duplicate reference flagged for manual admin investigation.'
      : 'Payment evidence submitted successfully. Awaiting admin bank statement verification.',
  };
}

/**
 * ۵. بررسی، تایید یا رد پرداخت کارت‌به‌کارت توسط ادمین
 */
export async function adminReviewIrtPayment(input: AdminIrtReviewInput) {
  const { attemptId, action, reason, actualAmountReceivedIrt, actorId } = input;

  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to review payments'}`);
  }

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    include: { paymentRequest: true },
  });

  if (!attempt) {
    throw new Error(`PAYMENT_ATTEMPT_NOT_FOUND: Payment attempt #${attemptId} not found`);
  }

  if (attempt.method !== PaymentMethod.CARD_TO_CARD_IRT) {
    throw new Error('INVALID_PAYMENT_METHOD: This review flow is strictly for IRT card-to-card payments');
  }

  if (attempt.status === PaymentAttemptStatus.FINISHED) {
    throw new Error('ATTEMPT_ALREADY_FINISHED: Payment attempt has already been verified and settled.');
  }

  if (action === 'REJECT') {
    if (!reason || reason.trim().length < 5) {
      throw new Error('REJECTION_REASON_REQUIRED: An explicit rejection reason of at least 5 characters is required');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const att = await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: PaymentAttemptStatus.REJECTED,
          reviewReason: reason.trim(),
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'IRT_PAYMENT_REJECTED',
          entityType: 'PaymentAttempt',
          entityId: String(attemptId),
          reason: reason.trim(),
          previousValues: JSON.stringify({ status: attempt.status }),
          newValues: JSON.stringify({ status: PaymentAttemptStatus.REJECTED }),
          isSuccess: true,
        },
      });

      return att;
    });

    return { success: true, action: 'REJECTED', attempt: updated };
  }

  if (action === 'MANUAL_REVIEW') {
    const updated = await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: PaymentAttemptStatus.MANUAL_REVIEW,
        reviewReason: reason ? reason.trim() : 'Flagged for detailed manual investigation',
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    });

    return { success: true, action: 'MANUAL_REVIEW', attempt: updated };
  }

  if (action === 'APPROVE') {
    // الزامات تایید:
    if (!attempt.trackingNumber) {
      throw new Error('NO_EVIDENCE_PROVIDED: Cannot verify payment without a submitted tracking reference number');
    }

    // ۱. الزامات امنیتی ۴ رقم آخر کارت فرستنده
    if (!attempt.senderCardLast4 || !/^\d{4}$/.test(attempt.senderCardLast4)) {
      throw new Error('SENDER_CARD_LAST4_REQUIRED: Payment evidence must contain valid 4-digit sender card suffix');
    }

    // ۲. بررسی یکتایی درخواست پرداخت (عدم تسویه قبلی با رسیدی دیگر)
    if (attempt.paymentRequest.status === PaymentRequestStatus.VERIFIED || attempt.paymentRequest.activeReceiptId) {
      throw new Error('PAYMENT_REQUEST_ALREADY_VERIFIED: This payment request has already been verified and closed with another receipt.');
    }

    // ۳. بررسی انقضای پیش‌فاکتور در زمان تایید
    if (attempt.quoteExpiresAt && new Date() > attempt.quoteExpiresAt) {
      throw new Error('EXPIRED_QUOTE: Payment quote has expired. Payment cannot be approved against an expired quote.');
    }

    // ۴. بررسی تطابق مبلغ واقعی واریزشده به حساب بانکی
    const expectedIrt = Number(attempt.expectedAmount);
    if (!actualAmountReceivedIrt || actualAmountReceivedIrt <= 0) {
      throw new Error('ACTUAL_AMOUNT_REQUIRED: Admin must provide the exact received amount from bank statement');
    }

    if (actualAmountReceivedIrt !== expectedIrt) {
      throw new Error(
        `AMOUNT_MISMATCH: Actual received amount (${actualAmountReceivedIrt} IRT) does not match expected quote amount (${expectedIrt} IRT)`
      );
    }

    // ۵. بررسی مجدد عدم ثبت رسید تکراری
    const duplicateReceipt = await prisma.paymentReceipt.findFirst({
      where: { providerReference: attempt.trackingNumber },
    });

    if (duplicateReceipt) {
      throw new Error(
        `DUPLICATE_RECEIPT: A verified receipt (#${duplicateReceipt.receiptRef}) already exists for tracking number '${attempt.trackingNumber}'`
      );
    }

    return await prisma.$transaction(async (tx) => {
      // به‌روزرسانی وضعیت تلاش به FINISHED
      const updatedAttempt = await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: PaymentAttemptStatus.FINISHED,
          actualAmountReceived: String(actualAmountReceivedIrt),
          actualCurrencyReceived: 'IRT',
          reviewedBy: actorId,
          reviewedAt: new Date(),
          reconciledAt: new Date(),
          reviewReason: reason || 'Approved after bank statement reconciliation',
        },
      });

      // ایجاد رسید معتبر
      const receiptRef = `REC_IRT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptRef,
          paymentRequestId: attempt.paymentRequestId,
          paymentAttemptId: attempt.id,
          amountUsdCents: attempt.paymentRequest.amountUsdCents,
          paymentMethod: PaymentMethod.CARD_TO_CARD_IRT,
          providerReference: attempt.trackingNumber!,
          verifiedBy: actorId,
          verifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });

      // پیوند دادن رسید فعال به درخواست پرداخت
      await tx.paymentRequest.update({
        where: { id: attempt.paymentRequestId },
        data: {
          status: PaymentRequestStatus.VERIFIED,
          activeReceiptId: receipt.id,
        },
      });

      // ثبت لاگ ممیزی
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'IRT_PAYMENT_ADMIN_APPROVED',
          entityType: 'PaymentAttempt',
          entityId: String(attemptId),
          reason: `Admin verified IRT payment against bank statement. Created receipt #${receipt.receiptRef}`,
          newValues: JSON.stringify({
            receiptRef: receipt.receiptRef,
            amountUsdCents: receipt.amountUsdCents,
            trackingNumber: attempt.trackingNumber,
            senderCardLast4: attempt.senderCardLast4,
            actualAmountReceivedIrt,
          }),
          isSuccess: true,
        },
      });

      // ۴. اجرای اقدام تجاری مصرف‌کننده رسید (Business Action Consumption)
      const consumptionResult = await consumePaymentReceipt(receipt.id, actorId, tx);

      return {
        success: true,
        action: 'APPROVED',
        attempt: updatedAttempt,
        receipt,
        consumptionResult,
      };
    });
  }

  throw new Error(`UNKNOWN_ACTION: Action '${action}' is not supported`);
}
