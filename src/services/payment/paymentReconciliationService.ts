/**
 * paymentReconciliationService.ts — تطبیق و مصرف رسیدهای تاییدشده پرداخت (Payment Reconciliation & Receipt Engine)
 *
 * اصول محوری:
 *  ۱. تفکیک کامل:
 *     - صدور و ثبت درخواست پرداخت (PaymentRequest)
 *     - ثبت یک یا چند تلاش مجزا (PaymentAttempt)
 *     - صدور رسید تاییدشده یکتا (PaymentReceipt)
 *     - مصرف اتمیک رسید توسط اقدام تجاری مقصد (Business Action: Order Funding / Wallet Top-Up)
 *  ۲. یک پرداخت خارجی هرگز نمی‌تواند همزمان هم والت را شارژ کند و هم سفارشی را تامین مالی نماید.
 *  ۳. هر رسید منحصراً یکبار قابل مصرف است (Single-Use Consumed Invariant).
 *  ۴. مسدودسازی میانبرهای غیرمجاز: هیچ سفارشی بدون رسید معتبر به paymentStatus='verified' تبدیل نمی‌شود.
 */

import prisma from '../../database/db';
import { Prisma } from '@prisma/client';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentRequestStatus,
  PaymentAttemptStatus,
  PaymentReceiptStatus,
  PaymentBusinessType,
  NowpaymentsCreateInput,
  getNowpaymentsConfig,
} from './paymentTypes';
import { getNowpaymentsClient } from './nowpaymentsClient';
import {
  assertLiveCreditsEnabled,
  recordBalancedJournalPosting,
} from '../financeV2/financeV2WalletService';
import {
  LedgerV2EntryType,
  LedgerV2Direction,
  LedgerV2AccountType,
} from '../financeV2/financeV2Types';

/**
 * ۱. ایجاد یا واکشی درخواست پرداخت برای یک سفارش
 */
export async function getOrCreatePaymentRequestForOrder(orderId: number, actorId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }

  // بررسی درخواست موجود باز
  let request = await prisma.paymentRequest.findFirst({
    where: {
      orderId,
      status: { in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.PROCESSING] },
    },
    include: { attempts: true, receipts: true },
  });

  if (!request) {
    const requestRef = `PAY_REQ_ORD_${order.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    request = await prisma.paymentRequest.create({
      data: {
        requestRef,
        businessType: PaymentBusinessType.ORDER,
        orderId: order.id,
        userId: actorId || order.creatorId || order.advertiserId || 'system',
        amountUsdCents: order.grossAmountMinor,
        currency: 'USD',
        status: order.paymentStatus === 'verified' ? PaymentRequestStatus.VERIFIED : PaymentRequestStatus.PENDING,
      },
      include: { attempts: true, receipts: true },
    });
  }

  return request;
}

/**
 * ۲. ایجاد یا واکشی درخواست پرداخت برای شارژ کیف‌پول ادورتایزر
 */
export async function getOrCreatePaymentRequestForFunding(
  fundingRequestId: number,
  actorId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const funding = await client.advertiserFundingRequest.findUnique({
    where: { id: fundingRequestId },
  });

  if (!funding) {
    throw new Error(`FUNDING_REQUEST_NOT_FOUND: Funding request #${fundingRequestId} does not exist`);
  }

  let request = await client.paymentRequest.findFirst({
    where: {
      fundingRequestId,
      status: { in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.PROCESSING] },
    },
    include: { attempts: true, receipts: true },
  });

  if (!request) {
    const requestRef = `PAY_REQ_FUND_${funding.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    request = await client.paymentRequest.create({
      data: {
        requestRef,
        businessType: PaymentBusinessType.WALLET_FUNDING,
        fundingRequestId: funding.id,
        userId: actorId || funding.advertiserId,
        amountUsdCents: funding.targetUsdCents,
        currency: 'USD',
        status: funding.status === 'CONFIRMED_CREDITED' ? PaymentRequestStatus.VERIFIED : PaymentRequestStatus.PENDING,
      },
      include: { attempts: true, receipts: true },
    });
  }

  return request;
}

/**
 * ۳. ایجاد یک تلاش جدید برای پرداخت کریپتو با NOWPayments
 */
export async function createNowpaymentsPaymentAttempt(input: NowpaymentsCreateInput) {
  const { paymentRequestId, payCurrency, actorId } = input;
  const config = getNowpaymentsConfig();

  // بررسی سوئیچ امنیتی فعال‌سازی دریافت کریپتو
  if (!config.isCollectionActive) {
    throw new Error(
      `NOWPAYMENTS_COLLECTION_DISABLED: Cryptocurrency payment collection is disabled in this environment (mode='${config.mode}', sandboxEnabled=${config.sandboxEnabled}, liveCollectionEnabled=${config.liveCollectionEnabled})`
    );
  }

  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    include: { order: true, fundingRequest: true },
  });

  if (!paymentRequest) {
    throw new Error(`PAYMENT_REQUEST_NOT_FOUND: Payment request #${paymentRequestId} does not exist`);
  }

  if (paymentRequest.status === PaymentRequestStatus.VERIFIED) {
    throw new Error('PAYMENT_ALREADY_VERIFIED: This payment request has already been verified and settled.');
  }

  const cleanCurrency = payCurrency.trim().toLowerCase();

  // جلوگیری از ایجاد پرداخت‌های تکراری شارژپذیر در صورت وجود تلاش فعال منقضی‌نشده با همان ارز
  const activeExistingAttempt = await prisma.paymentAttempt.findFirst({
    where: {
      paymentRequestId,
      provider: PaymentProvider.NOWPAYMENTS,
      payCurrency: cleanCurrency,
      status: PaymentAttemptStatus.WAITING,
      quoteExpiresAt: { gt: new Date() },
    },
  });

  if (activeExistingAttempt) {
    return {
      attempt: activeExistingAttempt,
      isReused: true,
      message: 'Active unexpired payment attempt already exists for this currency. Reused existing payment instructions.',
    };
  }

  const client = getNowpaymentsClient();

  // ۱. بررسی دسترسی‌پذیری ارائه‌دهنده
  await client.getStatus();

  // ۲. بررسی پشتیبانی از ارز درخواستی
  const availableCurrencies = await client.getAvailableCurrencies(true);
  if (availableCurrencies.length > 0 && !availableCurrencies.includes(cleanCurrency)) {
    throw new Error(
      `UNSUPPORTED_CURRENCY: Cryptocurrency asset '${cleanCurrency}' is not supported by NOWPayments fixed-rate payment API`
    );
  }

  const targetUsdAmount = paymentRequest.amountUsdCents / 100;

  // ۳. بررسی حداقل مبلغ مجاز برای پرداخت
  const minAmountRes = await client.getMinimumAmount(cleanCurrency, 'usd');
  const minAllowedUsd = minAmountRes.fiat_equivalent ?? minAmountRes.min_amount;
  if (minAllowedUsd && targetUsdAmount < minAllowedUsd) {
    throw new Error(
      `PAYMENT_AMOUNT_BELOW_MINIMUM: Order amount ($${targetUsdAmount.toFixed(2)}) is below provider minimum ($${minAllowedUsd.toFixed(2)}) for ${cleanCurrency.toUpperCase()}`
    );
  }

  // ۴. فراخوانی API رسمی ایجاد پرداخت NOWPayments
  const attemptRef = `ATT_NOWP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const orderRef = paymentRequest.order?.orderRef || paymentRequest.fundingRequest?.fundingRef || paymentRequest.requestRef;

  const providerRes = await client.createPayment({
    priceAmount: targetUsdAmount,
    priceCurrency: 'usd',
    payCurrency: cleanCurrency,
    orderId: paymentRequest.requestRef,
    orderDescription: `G4X Payment for ${orderRef}`,
    isFixedRate: true,
    isFeePaidByUser: false,
  });

  // ۵. ذخیره امن اطلاعات پرداخت در دیتابیس
  const quoteExpiresAt = providerRes.valid_until
    ? new Date(providerRes.valid_until)
    : providerRes.expiration_estimate_date
    ? new Date(providerRes.expiration_estimate_date)
    : new Date(Date.now() + 10 * 60 * 1000); // ۱۰ دقیقه پیش‌فرض برای نرخ ثابت

  const attempt = await prisma.paymentAttempt.create({
    data: {
      attemptRef,
      paymentRequestId,
      method: PaymentMethod.NOWPAYMENTS_CRYPTO,
      provider: PaymentProvider.NOWPAYMENTS,
      status: PaymentAttemptStatus.WAITING,
      providerPaymentId: String(providerRes.payment_id),
      providerPurchaseId: providerRes.purchase_id ? String(providerRes.purchase_id) : null,
      payCurrency: providerRes.pay_currency,
      payNetwork: providerRes.network || null,
      payAddress: providerRes.pay_address,
      payExtraId: providerRes.payin_extra_id || null,
      expectedAmount: String(providerRes.pay_amount),
      expectedCurrency: providerRes.pay_currency,
      exchangeRate: targetUsdAmount > 0 && providerRes.pay_amount > 0 ? targetUsdAmount / providerRes.pay_amount : null,
      quoteExpiresAt,
      quoteSnapshot: JSON.stringify(providerRes),
    },
  });

  return {
    attempt,
    isReused: false,
    message: 'NOWPayments crypto payment created successfully',
  };
}

/**
 * ۴. مصرف قطعی و اتمیک رسید تاییدشده پرداخت (Authoritative Receipt Consumption)
 * تضمین مصرف تک‌باره (Single-Use Invariant) حتی در صورت ارسال درخواست‌های هم‌زمان (Concurrent Requests)
 */
export async function consumePaymentReceipt(
  receiptId: number,
  actorId: string,
  txClient?: Prisma.TransactionClient
) {
  if (!txClient) {
    return await prisma.$transaction(async (tx) => {
      return await executeConsumePaymentReceipt(receiptId, actorId, tx);
    });
  }
  return await executeConsumePaymentReceipt(receiptId, actorId, txClient);
}

async function executeConsumePaymentReceipt(
  receiptId: number,
  actorId: string,
  runner: Prisma.TransactionClient
) {
  const receipt = await runner.paymentReceipt.findUnique({
    where: { id: receiptId },
    include: {
      paymentRequest: {
        include: { order: true, fundingRequest: true },
      },
    },
  });

  if (!receipt) {
    throw new Error(`RECEIPT_NOT_FOUND: Payment receipt #${receiptId} not found`);
  }

  if (receipt.status === PaymentReceiptStatus.CONSUMED) {
    throw new Error(
      `RECEIPT_ALREADY_CONSUMED: Payment receipt #${receipt.receiptRef} has already been consumed for ${receipt.consumedAction} (${receipt.consumedReferenceId})`
    );
  }

  if (receipt.status === PaymentReceiptStatus.VOIDED) {
    throw new Error(`RECEIPT_VOIDED: Payment receipt #${receipt.receiptRef} is voided and cannot back any financial action`);
  }

  const { paymentRequest } = receipt;

  // بررسی وجود کاربر تاییدکننده در سیستم جهت رعایت محدودیت‌های کلید خارجی
  const verifierUser = actorId
    ? await runner.user.findUnique({ where: { discordId: actorId } })
    : null;
  const paymentVerifiedBy = verifierUser ? verifierUser.discordId : null;

  // ۱. اقدام تجاری برای سفارش بوستینگ (ORDER_FUNDING)
  if (paymentRequest.businessType === PaymentBusinessType.ORDER && paymentRequest.orderId) {
    const order = await runner.order.findUnique({
      where: { id: paymentRequest.orderId },
    });

    if (!order) {
      throw new Error(`ORDER_NOT_FOUND: Order #${paymentRequest.orderId} does not exist`);
    }

    // به‌روزرسانی وضعیت سفارش به پرداخت شده و انتقال به open_presign
    const updatedOrder = await runner.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'verified',
        status: order.status === 'payment_pending' ? 'open_presign' : order.status,
        paymentVerifiedBy,
        paymentVerifiedAt: new Date(),
      },
    });

    // علامت‌گذاری اتمیک رسید به عنوان مصرف‌شده (Compare-and-Swap جهت جلوگیری از Race Condition)
    const updateResult = await runner.paymentReceipt.updateMany({
      where: {
        id: receipt.id,
        status: PaymentReceiptStatus.ACTIVE,
      },
      data: {
        status: PaymentReceiptStatus.CONSUMED,
        consumedAction: 'ORDER_FUNDING',
        consumedReferenceId: order.orderRef,
        consumedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      throw new Error(
        `RECEIPT_ALREADY_CONSUMED: Payment receipt #${receipt.receiptRef} was already consumed or transitioned concurrently.`
      );
    }

    const updatedReceipt = await runner.paymentReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });

    // ثبت لاگ ممیزی
    await runner.auditLog.create({
      data: {
        actorId: paymentVerifiedBy,
        action: 'ORDER_FUNDED_BY_VERIFIED_RECEIPT',
        entityType: 'Order',
        entityId: String(order.id),
        reason: `Order #${order.id} verified and backed by payment receipt #${receipt.receiptRef}`,
        previousValues: JSON.stringify({
          paymentStatus: order.paymentStatus,
          status: order.status,
        }),
        newValues: JSON.stringify({
          paymentStatus: 'verified',
          status: updatedOrder.status,
          receiptRef: receipt.receiptRef,
        }),
        isSuccess: true,
      },
    });

    return {
      success: true,
      businessAction: 'ORDER_FUNDING',
      order: updatedOrder,
      receipt: updatedReceipt,
    };
  }

  // ۲. اقدام تجاری برای شارژ کیف‌پول ادورتایزر (WALLET_FUNDING)
  if (paymentRequest.businessType === PaymentBusinessType.WALLET_FUNDING && paymentRequest.fundingRequestId) {
    // الزامات ایمنی پروداکشن: بررسی سوئیچ شارژ زنده والت
    assertLiveCreditsEnabled();

    const funding = await runner.advertiserFundingRequest.findUnique({
      where: { id: paymentRequest.fundingRequestId },
    });

    if (!funding) {
      throw new Error(`FUNDING_REQUEST_NOT_FOUND: Funding request #${paymentRequest.fundingRequestId} not found`);
    }

    if (funding.status === 'CONFIRMED_CREDITED') {
      throw new Error(`ALREADY_CREDITED: Funding request #${funding.id} has already been credited`);
    }

    // به‌روزرسانی وضعیت درخواست شارژ
    const safeCreatorId = paymentVerifiedBy || funding.advertiserId;

    const updatedFunding = await runner.advertiserFundingRequest.update({
      where: { id: funding.id },
      data: {
        status: 'CONFIRMED_CREDITED',
        verifiedBy: safeCreatorId,
        verifiedAt: new Date(),
        creditedAt: new Date(),
      },
    });

    const postingGroupId = `POSTING_GRP_PAY_${receipt.receiptRef}`;
    const clearingAccount =
      receipt.paymentMethod === PaymentMethod.NOWPAYMENTS_CRYPTO
        ? LedgerV2AccountType.ASSET_EXTERNAL_USDT_CLEARING
        : LedgerV2AccountType.ASSET_EXTERNAL_BANK_CLEARING;

    // ثبت سند دوطرفه متعادل حسابداری
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        referenceType: 'PaymentReceipt',
        referenceId: receipt.id,
        legs: [
          {
            amountCents: receipt.amountUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: clearingAccount,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: funding.id,
            description: `Clearing asset for verified payment receipt #${receipt.receiptRef}`,
            createdBy: safeCreatorId,
          },
          {
            userId: funding.advertiserId,
            amountCents: receipt.amountUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: funding.id,
            description: `Advertiser deposit backed by verified payment receipt #${receipt.receiptRef}`,
            createdBy: safeCreatorId,
          },
        ],
      },
      runner
    );

    // افزایش موجودی در دسترس والت
    const wallet = await runner.walletV2.findUnique({
      where: { userId: funding.advertiserId },
    });
    const newAvailable = (wallet?.availableCents ?? 0) + receipt.amountUsdCents;
    const updatedWallet = await runner.walletV2.update({
      where: { userId: funding.advertiserId },
      data: { availableCents: newAvailable },
    });

    // علامت‌گذاری اتمیک رسید به عنوان مصرف‌شده (Compare-and-Swap جهت جلوگیری از Race Condition)
    const updateResult = await runner.paymentReceipt.updateMany({
      where: {
        id: receipt.id,
        status: PaymentReceiptStatus.ACTIVE,
      },
      data: {
        status: PaymentReceiptStatus.CONSUMED,
        consumedAction: 'WALLET_CREDIT',
        consumedReferenceId: funding.fundingRef,
        consumedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      throw new Error(
        `RECEIPT_ALREADY_CONSUMED: Payment receipt #${receipt.receiptRef} was already consumed or transitioned concurrently.`
      );
    }

    const updatedReceipt = await runner.paymentReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });

    return {
      success: true,
      businessAction: 'WALLET_FUNDING',
      fundingRequest: updatedFunding,
      wallet: updatedWallet,
      receipt: updatedReceipt,
    };
  }

  throw new Error(`UNSUPPORTED_BUSINESS_TYPE: Unknown business type '${paymentRequest.businessType}'`);
}

/**
 * ۵. تایید اختصاصی سفارش از طریق رسید تاییدشده (جایگزین میانبر ناامن قبلی)
 */
export async function verifyOrderWithReceipt(
  orderId: number,
  receiptRef: string,
  actorId: string
) {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { receiptRef },
    include: { paymentRequest: true },
  });

  if (!receipt) {
    throw new Error(`RECEIPT_NOT_FOUND: Verified payment receipt '${receiptRef}' does not exist`);
  }

  if (
    receipt.paymentRequest.businessType !== PaymentBusinessType.ORDER ||
    receipt.paymentRequest.orderId !== orderId
  ) {
    throw new Error(
      `RECEIPT_ORDER_MISMATCH: Receipt '${receiptRef}' was issued for ${receipt.paymentRequest.businessType} (order #${receipt.paymentRequest.orderId}), not order #${orderId}`
    );
  }

  return await consumePaymentReceipt(receipt.id, actorId);
}
