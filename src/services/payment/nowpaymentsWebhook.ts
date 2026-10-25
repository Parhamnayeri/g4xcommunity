/**
 * nowpaymentsWebhook.ts — پردازش امن هوک‌های IPN سرویس NOWPayments
 *
 * الزامات و استانداردهای اعتبارسنجی:
 *  ۱. اعتبارسنجی قطعی امضای x-nowpayments-sig با الگوریتم HMAC-SHA512 و مرتب‌سازی بازگشتی کلیدها.
 *  ۲. مقایسه زمان-ثابت (Constant-Time Comparison) با crypto.timingSafeEqual جهت جلوگیری از حملات Timing.
 *  ۳. دریافت مجدد وضعیت موثق از طریق API قبل از اعمال هرگونه تغییرات مالی نهایی (Double-Check via GET /v1/payment/:id).
 *  ۴. مدیریت دقیق وضعیت‌ها:
 *     - waiting: در انتظار
 *     - confirming / confirmed / sending: در حال پردازش، عدم آزادسازی سفارش
 *     - partially_paid: خطای کسری پرداختی، نیازمند بررسی ادمین
 *     - finished: تایید نهایی پس از تطبیق مبالغ
 *     - expired / failed: منقضی یا ناموفق
 *     - refunded: استرداد، بازبینی مالی
 *  ۵. شناسایی و مسدودسازی واریزهای مکرر (Re-deposits) و ارز اشتباه (Wrong-Asset Deposits) به بررسی دستی.
 *  ۶. تضمین عدم تکرارپذیری (Idempotency) و محافظت در برابر اعلان‌های نامرتب (Out-of-order).
 */

import crypto from 'crypto';
import prisma from '../../database/db';
import {
  PaymentAttemptStatus,
  PaymentRequestStatus,
  PaymentMethod,
  NowpaymentsIpnPayload,
  getNowpaymentsConfig,
} from './paymentTypes';
import { getNowpaymentsClient } from './nowpaymentsClient';
import { consumePaymentReceipt } from './paymentReconciliationService';

/**
 * مرتب‌سازی بازگشتی الفبایی کلیدهای آبجکت جهت ایجاد متن متعارف امضا (Canonical Signature)
 */
export function sortObject(obj: any): any {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj)
    .sort()
    .reduce((result: Record<string, any>, key: string) => {
      result[key] =
        obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])
          ? sortObject(obj[key])
          : obj[key];
      return result;
    }, {});
}

/**
 * اعتبارسنجی امضای HMAC-SHA512 هوک IPN
 */
export function verifyNowPaymentsSignature(
  payload: any,
  receivedSignature: string | undefined | null,
  customSecret?: string
): boolean {
  if (!receivedSignature || typeof receivedSignature !== 'string') {
    return false;
  }

  const config = getNowpaymentsConfig();
  const secret = (customSecret || config.ipnSecret).trim();

  if (!secret) {
    return false;
  }

  try {
    const sortedPayload = sortObject(payload);
    const serialized = JSON.stringify(sortedPayload);

    const hmac = crypto.createHmac('sha512', secret);
    hmac.update(serialized);
    const expectedSignature = hmac.digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(receivedSignature.trim().toLowerCase(), 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch (err) {
    return false;
  }
}

/**
 * پردازش رویداد IPN دریافتی از NOWPayments
 */
export async function handleNowPaymentsIpn(
  payload: NowpaymentsIpnPayload,
  signatureHeader: string | undefined | null,
  options?: { skipProviderApiCheck?: boolean; customSecret?: string }
) {
  // ۱. اعتبارسنجی امضای HMAC
  const isValidSig = verifyNowPaymentsSignature(payload, signatureHeader, options?.customSecret);
  if (!isValidSig) {
    // ثبت لاگ هشدار امنیتی
    await prisma.auditLog.create({
      data: {
        action: 'NOWPAYMENTS_IPN_SIGNATURE_REJECTED',
        entityType: 'Webhook',
        entityId: String(payload?.payment_id || 'unknown'),
        reason: 'HMAC-SHA512 signature mismatch or missing signature header',
        newValues: JSON.stringify({
          payment_id: payload?.payment_id,
          order_id: payload?.order_id,
        }),
        isSuccess: false,
      },
    });
    throw new Error('INVALID_IPN_SIGNATURE: Webhook signature verification failed');
  }

  const providerPaymentId = String(payload.payment_id);

  // ۲. یافتن رکورد PaymentAttempt متناظر
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { providerPaymentId },
    include: {
      paymentRequest: {
        include: { order: true, fundingRequest: true },
      },
      receipts: true,
    },
  });

  if (!attempt) {
    throw new Error(`PAYMENT_ATTEMPT_NOT_FOUND: No local payment attempt matches provider payment_id '${providerPaymentId}'`);
  }

  // ۳. استعلام وضعیت موثق از سرور NOWPayments جهت ایمنی قطعی در برابر جعل بدنه
  let authoritativeDetails: any = payload;
  if (!options?.skipProviderApiCheck) {
    try {
      const client = getNowpaymentsClient();
      authoritativeDetails = await client.getPaymentStatus(providerPaymentId);
    } catch (err: any) {
      // در صورت خطای شبکه یا تایم‌اوت موقت، تلاش بعدی IPN مجدداً پردازش می‌شود
      throw new Error(`PROVIDER_STATUS_VERIFICATION_FAILED: Could not re-verify status with NOWPayments API: ${err.message}`);
    }
  }

  const providerStatus = (authoritativeDetails.payment_status || payload.payment_status || '').toLowerCase();
  const rawPayloadStr = JSON.stringify(authoritativeDetails);

  // ۴. محافظت در برابر رویدادهای نامرتب (Out-of-order protection)
  // اگر قبلاً پرداخت تایید و بسته شده، وضعیت‌های قبلی (مانند confirming یا sending) نباید وضعیت را بازگردانند
  if (attempt.status === PaymentAttemptStatus.FINISHED) {
    return {
      success: true,
      idempotent: true,
      message: 'Payment attempt is already settled and finished.',
      attempt,
    };
  }

  // ۵. شناسایی واریزهای تکراری (Re-deposits)، ارزهای اشتباه، عدم تطابق رفرنس سفارش و مغایرت شرایط تسویه
  const isReDeposit = Boolean(
    payload.parent_payment_id ||
    authoritativeDetails.parent_payment_id
  );

  const expectedPayCurrency = (attempt.payCurrency || '').trim().toLowerCase();
  const receivedPayCurrency = (
    authoritativeDetails.pay_currency || payload.pay_currency || ''
  ).trim().toLowerCase();

  const isWrongAsset = Boolean(
    expectedPayCurrency &&
    receivedPayCurrency &&
    expectedPayCurrency !== receivedPayCurrency
  );

  const callbackOrderId = String(
    authoritativeDetails.order_id || payload.order_id || ''
  ).trim();
  const validOrderRefs = [
    attempt.paymentRequest.requestRef,
    attempt.paymentRequest.order?.orderRef,
    attempt.paymentRequest.fundingRequest?.fundingRef,
  ].filter(Boolean);

  const isOrderRefMismatch = Boolean(
    callbackOrderId &&
    validOrderRefs.length > 0 &&
    !validOrderRefs.includes(callbackOrderId)
  );

  const expectedUsdAmount = attempt.paymentRequest.amountUsdCents / 100;
  const reportedPriceAmount = Number(
    authoritativeDetails.price_amount ?? payload.price_amount ?? expectedUsdAmount
  );
  const reportedPriceCurrency = String(
    authoritativeDetails.price_currency ?? payload.price_currency ?? 'usd'
  ).trim().toLowerCase();

  const isPriceAmountMismatch =
    !isNaN(reportedPriceAmount) &&
    reportedPriceAmount > 0 &&
    Math.abs(reportedPriceAmount - expectedUsdAmount) > 0.01;

  const isPriceCurrencyMismatch =
    reportedPriceCurrency !== '' &&
    reportedPriceCurrency !== attempt.paymentRequest.currency.toLowerCase();

  const isSettlementTermsMismatch = isPriceAmountMismatch || isPriceCurrencyMismatch;

  if (isReDeposit || isWrongAsset || isOrderRefMismatch || isSettlementTermsMismatch) {
    let warningMsg = '';
    if (isReDeposit) {
      warningMsg = `REPEATED_DEPOSIT_DETECTED: Payment marked as re-deposit with parent_payment_id '${payload.parent_payment_id || authoritativeDetails.parent_payment_id}'. Routed to manual review.`;
    } else if (isWrongAsset) {
      warningMsg = `WRONG_ASSET_DETECTED: Received currency '${receivedPayCurrency}' does not match requested currency '${expectedPayCurrency}'. Routed to manual review.`;
    } else if (isOrderRefMismatch) {
      warningMsg = `ORDER_REFERENCE_MISMATCH: Callback order_id '${callbackOrderId}' does not match registered order refs (${validOrderRefs.join(', ')}). Routed to manual review.`;
    } else {
      warningMsg = `SETTLEMENT_TERMS_MISMATCH: Reported settlement terms ($${reportedPriceAmount} ${reportedPriceCurrency.toUpperCase()}) do not match expected terms ($${expectedUsdAmount} ${attempt.paymentRequest.currency}). Routed to manual review.`;
    }

    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.MANUAL_REVIEW,
        isReDeposit,
        isWrongAsset,
        providerParentPaymentId: String(payload.parent_payment_id || authoritativeDetails.parent_payment_id || ''),
        actualAmountReceived: String(payload.actually_paid || authoritativeDetails.actually_paid || '0'),
        actualCurrencyReceived: receivedPayCurrency || payload.pay_currency || authoritativeDetails.pay_currency,
        outcomeAmount: String(payload.outcome_amount || authoritativeDetails.outcome_amount || '0'),
        outcomeCurrency: payload.outcome_currency || authoritativeDetails.outcome_currency,
        rawCallbackPayload: rawPayloadStr,
        reviewReason: warningMsg,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'NOWPAYMENTS_DEPOSIT_FLAGGED_FOR_REVIEW',
        entityType: 'PaymentAttempt',
        entityId: String(attempt.id),
        reason: warningMsg,
        newValues: JSON.stringify({
          isReDeposit,
          isWrongAsset,
          isOrderRefMismatch,
          isSettlementTermsMismatch,
          providerPaymentId,
        }),
        isSuccess: true,
      },
    });

    return {
      success: true,
      requiresManualReview: true,
      message: warningMsg,
      attempt: updated,
    };
  }

  // ۶. نگاشت و اعمال وضعیت‌ها
  if (providerStatus === 'waiting') {
    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.WAITING,
        rawCallbackPayload: rawPayloadStr,
      },
    });
    return { success: true, status: 'waiting', attempt: updated };
  }

  if (['confirming', 'confirmed', 'sending'].includes(providerStatus)) {
    const nextStatus =
      providerStatus === 'confirming'
        ? PaymentAttemptStatus.CONFIRMING
        : providerStatus === 'confirmed'
        ? PaymentAttemptStatus.CONFIRMED
        : PaymentAttemptStatus.SENDING;

    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: nextStatus,
        actualAmountReceived: String(payload.actually_paid || authoritativeDetails.actually_paid || '0'),
        actualCurrencyReceived: payload.pay_currency || authoritativeDetails.pay_currency,
        rawCallbackPayload: rawPayloadStr,
      },
    });

    return { success: true, status: nextStatus, attempt: updated };
  }

  if (providerStatus === 'partially_paid') {
    const reason = `UNDERPAYMENT_EXCEPTION: Customer underpaid. Paid: ${payload.actually_paid || authoritativeDetails.actually_paid}, Expected: ${attempt.expectedAmount}`;
    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.PARTIALLY_PAID,
        actualAmountReceived: String(payload.actually_paid || authoritativeDetails.actually_paid || '0'),
        actualCurrencyReceived: payload.pay_currency || authoritativeDetails.pay_currency,
        rawCallbackPayload: rawPayloadStr,
        reviewReason: reason,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'NOWPAYMENTS_UNDERPAYMENT_DETECTED',
        entityType: 'PaymentAttempt',
        entityId: String(attempt.id),
        reason,
        newValues: JSON.stringify({
          actually_paid: payload.actually_paid || authoritativeDetails.actually_paid,
          expected: attempt.expectedAmount,
        }),
        isSuccess: true,
      },
    });

    return { success: true, status: 'partially_paid', requiresManualReview: true, attempt: updated };
  }

  if (['expired', 'failed'].includes(providerStatus)) {
    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: providerStatus === 'expired' ? PaymentAttemptStatus.EXPIRED : PaymentAttemptStatus.FAILED,
        rawCallbackPayload: rawPayloadStr,
        reviewReason: `Payment terminated by provider with status '${providerStatus}'`,
      },
    });
    return { success: true, status: providerStatus, attempt: updated };
  }

  if (providerStatus === 'refunded') {
    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.REFUNDED,
        rawCallbackPayload: rawPayloadStr,
        reviewReason: 'Payment refunded by merchant or provider. Financial audit required.',
      },
    });
    return { success: true, status: 'refunded', requiresManualReview: true, attempt: updated };
  }

  // ۷. وضعیت finished — بررسی شرایط تسویه و اعتبارسنجی
  if (providerStatus === 'finished') {
    const actuallyPaid = Number(payload.actually_paid ?? authoritativeDetails.actually_paid ?? 0);
    const expectedCrypto = Number(attempt.expectedAmount);

    // بررسی کسری واریز یا صفر بودن مبلغ پرداختی
    if (actuallyPaid < expectedCrypto || actuallyPaid <= 0 || isNaN(actuallyPaid)) {
      const underpayMsg = `UNDERPAYMENT_AT_FINISHED: Actually paid (${actuallyPaid}) does not fulfill expected amount (${expectedCrypto})`;
      const updated = await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PaymentAttemptStatus.PARTIALLY_PAID,
          actualAmountReceived: String(actuallyPaid),
          actualCurrencyReceived: payload.pay_currency || authoritativeDetails.pay_currency,
          rawCallbackPayload: rawPayloadStr,
          reviewReason: underpayMsg,
        },
      });
      return { success: true, status: 'partially_paid', requiresManualReview: true, attempt: updated };
    }

    // تسویه و ایجاد رسید قطعی در تراکنش دیتابیس
    return await prisma.$transaction(async (tx) => {
      // به‌روزرسانی وضعیت تلاش پرداخت به finished
      const updatedAttempt = await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PaymentAttemptStatus.FINISHED,
          actualAmountReceived: String(actuallyPaid),
          actualCurrencyReceived: payload.pay_currency || authoritativeDetails.pay_currency,
          outcomeAmount: String(payload.outcome_amount || authoritativeDetails.outcome_amount || '0'),
          outcomeCurrency: payload.outcome_currency || authoritativeDetails.outcome_currency,
          reconciledAt: new Date(),
          rawCallbackPayload: rawPayloadStr,
          reviewReason: 'NOWPayments IPN verified successfully',
        },
      });

      // صدور رسید یکتا
      const receiptRef = `REC_NOWP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptRef,
          paymentRequestId: attempt.paymentRequestId,
          paymentAttemptId: attempt.id,
          amountUsdCents: attempt.paymentRequest.amountUsdCents,
          paymentMethod: PaymentMethod.NOWPAYMENTS_CRYPTO,
          providerReference: providerPaymentId,
          verifiedBy: 'NOWPAYMENTS_IPN',
          verifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });

      // به‌روزرسانی درخواست پرداخت
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
          action: 'NOWPAYMENTS_PAYMENT_VERIFIED',
          entityType: 'PaymentAttempt',
          entityId: String(attempt.id),
          reason: `Verified via valid signed NOWPayments IPN. Issued receipt #${receipt.receiptRef}`,
          newValues: JSON.stringify({
            receiptRef: receipt.receiptRef,
            amountUsdCents: receipt.amountUsdCents,
            providerPaymentId,
            actuallyPaid,
          }),
          isSuccess: true,
        },
      });

      // ۸. اجرای اقدام تجاری مصرف‌کننده رسید (Business Action Consumption)
      const consumptionResult = await consumePaymentReceipt(receipt.id, 'NOWPAYMENTS_IPN', tx);

      return {
        success: true,
        status: 'finished',
        attempt: updatedAttempt,
        receipt,
        consumptionResult,
      };
    });
  }

  // وضعیت ناشناخته
  return {
    success: true,
    status: providerStatus,
    message: `Received unhandled provider status '${providerStatus}'`,
  };
}
