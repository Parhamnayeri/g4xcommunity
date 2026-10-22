/**
 * boosterWithdrawalService.ts — سرویس مدیریت تسویه و برداشت بوسترها (Finance V2 Booster Withdrawals)
 *
 * اصول و قوانین مصوب مالک:
 *  ۱. برداشت تتر (USDT BEP-20):
 *      - منحصراً روی شبکه BNB Smart Chain (BEP-20)
 *      - کارمزد ثابت ۴۰ سنت دلار ($0.40) کسر از مبلغ درخواستی
 *      - عدم اخذ کارمزد متغیر ثانویه شبکه از بوستر
 *      - Net USD Payout Value = Requested USD - $0.40
 *      - زمان‌بندی عملیاتی ۱ تا ۴۸ ساعت، تسویه کاملاً دستی توسط ادمین
 *
 *  ۲. برداشت تومانی (IRT Bank):
 *      - کارمزد ثابت ۱.۳۰ دلار ($1.30)
 *      - نرخ موثر تومانی: Effective Rate = Admin USD/IRT Rate - 3,000 IRT
 *      - Net IRT = (Requested USD - $1.30) * Effective IRT Rate
 *      - عدم اعمال کارمزد درصدی خرید ارز (آن کارمزد ویژه شارژ ادورتایزر است)
 *      - چرخه تسویه در روزهای شنبه و چهارشنبه
 *      - بازه تسویه چهارشنبه: درخواست‌های ثبت‌شده از شنبه ساعت ۰۸:۰۰ تا صبح سه‌شنبه
 *      - درخواست‌های پس از موعد سه‌شنبه: منتقل به چرخه تسویه شنبه
 *      - ساعت دقیق کات‌آف صبح سه‌شنبه نامشخص بوده و در صورت عدم تنظیم در دیتابیس، نهایی‌سازی خودکار زمان‌بندی مسدود می‌شود.
 *
 *  ۳. ماشین وضعیت امن درخواست برداشت:
 *      DRAFT -> QUOTED -> USER_CONFIRMED -> REQUESTED -> RESERVED -> UNDER_ADMIN_REVIEW -> PROCESSING -> PAID (or REJECTED / CANCELLED / FAILED)
 *
 *  ۴. پرداخت قطعی منوط به ثبت شناسه تراکنش (TxHash) یا فیش معتبر بانکی و ممیزی کامل دفاتر کل.
 */

import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  BoosterWithdrawalMethod,
  BoosterWithdrawalStatus,
  FINANCE_V2_CONSTANTS,
  PayoutCycleDay,
} from './financeV2Types';
import {
  getOrCreateWalletV2,
  reserveAvailableCents,
  settleReservedCents,
  reverseReservedCents,
} from './financeV2WalletService';

export interface UsdtQuoteInput {
  boosterId: string;
  requestedUsdCents: number;
  destinationAddress: string;
}

export interface IrtQuoteInput {
  boosterId: string;
  requestedUsdCents: number;
  destinationAddress: string; // شماره شبا یا کارت
  destinationAccountHolder?: string;
  adminUsdIrtRate: number; // نرخ مصوب دلار/تومان ادمین
}

export interface WithdrawalQuoteResult {
  boosterId: string;
  payoutMethod: BoosterWithdrawalMethod;
  requestedUsdCents: number;
  fixedFeeUsdCents: number;
  netUsdCents: number;
  quoteRate: number | null;
  effectiveRate: number | null;
  rateDiscount: number;
  quotedNetPayoutAmount: string;
  quotedCurrency: 'USDT' | 'IRT';
  destinationAddress: string;
  destinationAccountHolder?: string;
  quoteExpiresAt: Date;
}

export interface PayoutScheduleResult {
  scheduledCycleDay: PayoutCycleDay | null;
  scheduledCycleDate: Date | null;
  schedulingStatus: 'SCHEDULED' | 'BLOCKED_MISSING_CUTOFF_CONFIG';
  details: string;
}

/**
 * ۱. محاسبه پیش‌فاکتور برداشت تتر بوستر (USDT BEP-20)
 * کارمزد ثابت ۴۰ سنت ($0.40)
 */
export async function generateUsdtWithdrawalQuote(
  input: UsdtQuoteInput
): Promise<WithdrawalQuoteResult> {
  const { boosterId, requestedUsdCents, destinationAddress } = input;

  const fixedFee = FINANCE_V2_CONSTANTS.BOOSTER_USDT_WITHDRAWAL_FEE_CENTS;

  if (requestedUsdCents <= fixedFee) {
    throw new Error(
      `INVALID_AMOUNT: Requested amount ($${(requestedUsdCents / 100).toFixed(2)}) must be greater than the fixed fee of $${(fixedFee / 100).toFixed(2)}`
    );
  }

  if (!destinationAddress || !destinationAddress.startsWith('0x') || destinationAddress.length !== 42) {
    throw new Error('INVALID_BEP20_ADDRESS: Destination address must be a valid 42-character BEP-20 address starting with 0x');
  }

  // بررسی موجودی در دسترس
  const wallet = await getOrCreateWalletV2(boosterId);
  if (wallet.availableCents < requestedUsdCents) {
    throw new Error(
      `INSUFFICIENT_FUNDS: Available USD balance ($${(wallet.availableCents / 100).toFixed(2)}) is less than requested amount ($${(requestedUsdCents / 100).toFixed(2)})`
    );
  }

  const netUsdCents = requestedUsdCents - fixedFee;
  const quotedNetPayoutAmount = (netUsdCents / 100).toFixed(2);
  const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // معتبر به مدت ۱۵ دقیقه

  return {
    boosterId,
    payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
    requestedUsdCents,
    fixedFeeUsdCents: fixedFee,
    netUsdCents,
    quoteRate: 1.0,
    effectiveRate: 1.0,
    rateDiscount: 0,
    quotedNetPayoutAmount,
    quotedCurrency: 'USDT',
    destinationAddress,
    quoteExpiresAt,
  };
}

/**
 * ۲. محاسبه پیش‌فاکتور برداشت تومانی بوستر (IRT Bank)
 * کارمزد ثابت ۱.۳۰ دلار ($1.30)
 * نرخ موثر = نرخ ادمین منهای ۳,۰۰۰ تومان به ازای هر دلار
 */
export async function generateIrtWithdrawalQuote(
  input: IrtQuoteInput
): Promise<WithdrawalQuoteResult> {
  const {
    boosterId,
    requestedUsdCents,
    destinationAddress,
    destinationAccountHolder,
    adminUsdIrtRate,
  } = input;

  const fixedFee = FINANCE_V2_CONSTANTS.BOOSTER_IRT_WITHDRAWAL_FEE_CENTS;
  const rateDiscount = FINANCE_V2_CONSTANTS.BOOSTER_IRT_RATE_DISCOUNT_PER_USD;

  if (requestedUsdCents <= fixedFee) {
    throw new Error(
      `INVALID_AMOUNT: Requested amount ($${(requestedUsdCents / 100).toFixed(2)}) must be greater than fixed fee ($${(fixedFee / 100).toFixed(2)})`
    );
  }

  if (adminUsdIrtRate <= rateDiscount) {
    throw new Error(
      `INVALID_ADMIN_RATE: Admin USD/IRT rate (${adminUsdIrtRate}) must be strictly greater than the discount (${rateDiscount})`
    );
  }

  if (!destinationAddress || destinationAddress.trim().length < 10) {
    throw new Error('INVALID_BANK_DESTINATION: Valid IBAN (Sheba) or Card number is required');
  }

  const wallet = await getOrCreateWalletV2(boosterId);
  if (wallet.availableCents < requestedUsdCents) {
    throw new Error(
      `INSUFFICIENT_FUNDS: Available USD balance ($${(wallet.availableCents / 100).toFixed(2)}) is less than requested amount ($${(requestedUsdCents / 100).toFixed(2)})`
    );
  }

  const netUsdCents = requestedUsdCents - fixedFee;
  const effectiveRate = adminUsdIrtRate - rateDiscount;
  const netIrt = Math.round((netUsdCents / 100) * effectiveRate);

  const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // ۱۵ دقیقه

  return {
    boosterId,
    payoutMethod: BoosterWithdrawalMethod.IRT_BANK,
    requestedUsdCents,
    fixedFeeUsdCents: fixedFee,
    netUsdCents,
    quoteRate: adminUsdIrtRate,
    effectiveRate,
    rateDiscount,
    quotedNetPayoutAmount: String(netIrt),
    quotedCurrency: 'IRT',
    destinationAddress,
    destinationAccountHolder,
    quoteExpiresAt,
  };
}

/**
 * ۳. محاسبه چرخه تسویه روزهای چهارشنبه و شنبه با حفظ استقلال از تایم‌زون سرور
 * درخواست‌های شنبه ۰۸:۰۰ الی کات‌آف سه‌شنبه -> تسویه چهارشنبه
 * درخواست‌های بعد از کات‌آف سه‌شنبه -> تسویه شنبه
 * در صورت مشخص نبودن ساعت کات‌آف سه‌شنبه، وضعیت BLOCKED_MISSING_CUTOFF_CONFIG ثبت می‌شود.
 */
export function calculateIrtPayoutSchedule(
  submissionDate: Date,
  tuesdayCutoffHour?: number | null,
  timezoneOffsetHours: number = 3.5 // پیش‌فرض تایم‌زون ایران (UTC+3.5)
): PayoutScheduleResult {
  // ۱. بررسی مصوب بودن ساعت کات‌آف صبح سه‌شنبه توسط مالک
  if (tuesdayCutoffHour === undefined || tuesdayCutoffHour === null) {
    return {
      scheduledCycleDay: null,
      scheduledCycleDate: null,
      schedulingStatus: 'BLOCKED_MISSING_CUTOFF_CONFIG',
      details:
        'Tuesday morning cutoff hour has not been specified by owner. Automated scheduling blocked pending configuration.',
    };
  }

  // تبدیل تاریخ ثبت به زمان محلی مقصد بدون اتکا به سیستم‌عامل
  const utcMillis = submissionDate.getTime();
  const targetMillis = utcMillis + timezoneOffsetHours * 3600 * 1000;
  const localDate = new Date(targetMillis);

  // روز هفته در تقویم میلادی: 0 = یکشنبه، 1 = دوشنبه، 2 = سه‌شنبه، 3 = چهارشنبه، 4 = پنج‌شنبه، 5 = جمعه، 6 = شنبه
  const dayOfWeek = localDate.getUTCDay();
  const hour = localDate.getUTCHours();
  const minute = localDate.getUTCMinutes();
  const timeFraction = hour + minute / 60;

  let belongsToWednesday = false;

  if (dayOfWeek === 6) {
    // شنبه: از ساعت ۰۸:۰۰ به بعد متعلق به چهارشنبه است
    belongsToWednesday = timeFraction >= 8.0;
  } else if (dayOfWeek === 0 || dayOfWeek === 1) {
    // یکشنبه و دوشنبه: تمام روز متعلق به چهارشنبه است
    belongsToWednesday = true;
  } else if (dayOfWeek === 2) {
    // سه‌شنبه: تا قبل از ساعت کات‌آف متعلق به چهارشنبه است
    belongsToWednesday = timeFraction < tuesdayCutoffHour;
  } else {
    // سایر روزها (بعد از کات‌آف سه‌شنبه، چهارشنبه، پنج‌شنبه، جمعه، قبل از ۰۸:۰۰ شنبه): متعلق به شنبه
    belongsToWednesday = false;
  }

  const scheduledCycleDay = belongsToWednesday ? PayoutCycleDay.WEDNESDAY : PayoutCycleDay.SATURDAY;

  return {
    scheduledCycleDay,
    scheduledCycleDate: null, // تاریخ تقریبی چرخه بر اساس روز هفته
    schedulingStatus: 'SCHEDULED',
    details: `Assigned to ${scheduledCycleDay} payout cycle (Submission local hour: ${hour}:${minute.toString().padStart(2, '0')})`,
  };
}

/**
 * ۴. ایجاد پیش‌نویس اولیه درخواست برداشت بر اساس پیش‌فاکتور مصوب (Create Draft / Quoted)
 */
export async function createWithdrawalRequestFromQuote(quote: WithdrawalQuoteResult) {
  const withdrawalRef = `WDR_${quote.payoutMethod}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  // بررسی تنظیم ساعت کات‌آف برای درخواست‌های تومانی
  let scheduleResult: PayoutScheduleResult | null = null;
  if (quote.payoutMethod === BoosterWithdrawalMethod.IRT_BANK) {
    const config = await prisma.systemFinancialConfig.findUnique({
      where: { key: 'irt_payout_tuesday_cutoff_hour' },
    });
    const cutoffHour = config ? Number(config.value) : null;
    scheduleResult = calculateIrtPayoutSchedule(new Date(), cutoffHour);
  }

  const record = await prisma.boosterWithdrawalRequest.create({
    data: {
      withdrawalRef,
      boosterId: quote.boosterId,
      payoutMethod: quote.payoutMethod,
      status: BoosterWithdrawalStatus.QUOTED,
      requestedUsdCents: quote.requestedUsdCents,
      fixedFeeUsdCents: quote.fixedFeeUsdCents,
      netUsdCents: quote.netUsdCents,
      quoteRate: quote.quoteRate,
      effectiveRate: quote.effectiveRate,
      rateDiscount: quote.rateDiscount,
      quotedNetPayoutAmount: quote.quotedNetPayoutAmount,
      quotedCurrency: quote.quotedCurrency,
      quoteExpiresAt: quote.quoteExpiresAt,
      destinationAddress: quote.destinationAddress,
      destinationAccountHolder: quote.destinationAccountHolder,
      scheduledCycleDay: scheduleResult?.scheduledCycleDay ?? null,
      scheduledCycleDate: scheduleResult?.scheduledCycleDate ?? null,
      schedulingStatus: scheduleResult?.schedulingStatus ?? 'PENDING_SCHEDULE',
    },
  });

  return record;
}

/**
 * ۵. تایید پیش‌فاکتور توسط بوستر و رزرو قطعی موجودی (User Confirm & Reserve Funds)
 */
export async function confirmAndSubmitWithdrawalRequest(
  requestId: number,
  boosterId: string
) {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.boosterWithdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error(`WITHDRAWAL_NOT_FOUND: Request #${requestId} not found`);
    }

    if (request.boosterId !== boosterId) {
      throw new Error('PERMISSION_DENIED: Cannot confirm another user\'s withdrawal request');
    }

    if (request.status !== BoosterWithdrawalStatus.QUOTED) {
      throw new Error(`INVALID_STATUS: Withdrawal request is in '${request.status}' status, cannot confirm`);
    }

    // بررسی انقضای پیش‌فاکتور
    if (request.quoteExpiresAt && new Date() > request.quoteExpiresAt) {
      throw new Error('QUOTE_EXPIRED: The financial quote has expired. Please request a new quote with updated rates.');
    }

    // رزرو موجودی از والت دلار بوستر (کاهش از موجودی در دسترس و افزایش موجودی رزرو)
    const reserveResult = await reserveAvailableCents(
      boosterId,
      request.requestedUsdCents,
      undefined,
      {
        withdrawalRequestId: request.id,
        entryRef: `LEDGER_WDR_RES_${request.withdrawalRef}`,
        description: `Reserved funds for ${request.payoutMethod} withdrawal (#${request.id})`,
      },
      tx
    );

    // تغییر وضعیت به RESERVED
    const updatedRequest = await tx.boosterWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: BoosterWithdrawalStatus.RESERVED,
        userConfirmedAt: new Date(),
      },
    });

    return { request: updatedRequest, wallet: reserveResult.wallet };
  });
}

/**
 * ۶. تایید و پرداخت دستی توسط ادمین (Admin Manual Payout Execution)
 * منوط به ثبت هش تراکنش بلاکچین یا شماره پیگیری فیش بانکی
 */
export async function adminExecuteManualPayout(
  requestId: number,
  actorId: string,
  options: {
    externalTxHash?: string;
    bankReceiptRef?: string;
    notes?: string;
  }
) {
  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to execute payouts'}`);
  }

  const { externalTxHash, bankReceiptRef, notes } = options;

  return await prisma.$transaction(async (tx) => {
    const request = await tx.boosterWithdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error(`WITHDRAWAL_NOT_FOUND: Request #${requestId} not found`);
    }

    if (request.status === BoosterWithdrawalStatus.PAID) {
      return { request, alreadyPaid: true };
    }

    if (![BoosterWithdrawalStatus.RESERVED, BoosterWithdrawalStatus.UNDER_ADMIN_REVIEW, BoosterWithdrawalStatus.PROCESSING].includes(request.status as BoosterWithdrawalStatus)) {
      throw new Error(`INVALID_STATUS: Cannot execute payout on withdrawal in status '${request.status}'`);
    }

    // اعتبارسنجی ثبت مدارک برون‌سیستمی متناسب با روش پرداخت
    if (request.payoutMethod === BoosterWithdrawalMethod.USDT_BEP20 && (!externalTxHash || externalTxHash.trim().length < 10)) {
      throw new Error('MISSING_TX_HASH: A verified blockchain transaction hash (TxHash) is required for BEP-20 payouts');
    }

    if (request.payoutMethod === BoosterWithdrawalMethod.IRT_BANK && (!bankReceiptRef || bankReceiptRef.trim().length < 4)) {
      throw new Error('MISSING_BANK_RECEIPT: A verified bank receipt reference or tracking code is required for IRT payouts');
    }

    // انتقال قطعی وجوه از موجودی رزرو به پرداخت‌شده (Paid Cents)
    const settleResult = await settleReservedCents(
      request.boosterId,
      request.requestedUsdCents,
      {
        withdrawalRequestId: request.id,
        entryRef: `LEDGER_WDR_PAID_${request.withdrawalRef}`,
        description: `Settled ${request.payoutMethod} payout for withdrawal #${request.id}`,
        metadata: {
          externalTxHash,
          bankReceiptRef,
          notes,
          processedBy: actorId,
        },
        createdBy: actorId,
      },
      tx
    );

    const updatedRequest = await tx.boosterWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: BoosterWithdrawalStatus.PAID,
        processedBy: actorId,
        processedAt: new Date(),
        approvedBy: actorId,
        approvedAt: new Date(),
        externalTxHash: externalTxHash ?? null,
        bankReceiptRef: bankReceiptRef ?? null,
      },
    });

    // ثبت لاگ ممیزی
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'BOOSTER_WITHDRAWAL_PAID',
        entityType: 'BoosterWithdrawalRequest',
        entityId: String(requestId),
        newValues: JSON.stringify({
          withdrawalRef: request.withdrawalRef,
          payoutMethod: request.payoutMethod,
          requestedUsdCents: request.requestedUsdCents,
          quotedNetPayoutAmount: request.quotedNetPayoutAmount,
          quotedCurrency: request.quotedCurrency,
          externalTxHash,
          bankReceiptRef,
        }),
      },
    });

    return { request: updatedRequest, wallet: settleResult.wallet, alreadyPaid: false };
  });
}

/**
 * ۷. رد درخواست برداشت توسط ادمین و استرداد وجوه به موجودی در دسترس (Admin Reject)
 */
export async function adminRejectWithdrawal(
  requestId: number,
  actorId: string,
  rejectionReason: string
) {
  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to reject withdrawals'}`);
  }

  if (!rejectionReason || rejectionReason.trim().length < 5) {
    throw new Error('REASON_REQUIRED: A valid rejection reason is required');
  }

  return await prisma.$transaction(async (tx) => {
    const request = await tx.boosterWithdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error(`WITHDRAWAL_NOT_FOUND: Request #${requestId} not found`);
    }

    if (request.status === BoosterWithdrawalStatus.PAID) {
      throw new Error('CANNOT_REJECT_PAID: Cannot reject a withdrawal that has already been paid out');
    }

    if (request.status === BoosterWithdrawalStatus.REJECTED) {
      return { request, alreadyRejected: true };
    }

    // استرداد وجوه رزروشده به موجودی در دسترس
    let updatedWallet = null;
    if (request.status === BoosterWithdrawalStatus.RESERVED || request.status === BoosterWithdrawalStatus.UNDER_ADMIN_REVIEW || request.status === BoosterWithdrawalStatus.PROCESSING) {
      const rev = await reverseReservedCents(
        request.boosterId,
        request.requestedUsdCents,
        rejectionReason,
        {
          withdrawalRequestId: request.id,
          entryRef: `LEDGER_WDR_REJ_${request.withdrawalRef}`,
          createdBy: actorId,
        },
        tx
      );
      updatedWallet = rev.wallet;
    }

    const updatedRequest = await tx.boosterWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: BoosterWithdrawalStatus.REJECTED,
        rejectionReason,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'BOOSTER_WITHDRAWAL_REJECTED',
        entityType: 'BoosterWithdrawalRequest',
        entityId: String(requestId),
        reason: rejectionReason,
      },
    });

    return { request: updatedRequest, wallet: updatedWallet, alreadyRejected: false };
  });
}

/**
 * ۸. لغو درخواست برداشت توسط خود بوستر قبل از ارسال (Booster Cancel)
 */
export async function boosterCancelWithdrawal(
  requestId: number,
  boosterId: string,
  cancelReason: string = 'Cancelled by user'
) {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.boosterWithdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error(`WITHDRAWAL_NOT_FOUND: Request #${requestId} not found`);
    }

    if (request.boosterId !== boosterId) {
      throw new Error('PERMISSION_DENIED: Cannot cancel another user\'s withdrawal');
    }

    if (request.status === BoosterWithdrawalStatus.PAID) {
      throw new Error('CANNOT_CANCEL_PAID: Paid withdrawals cannot be cancelled');
    }

    if (request.status === BoosterWithdrawalStatus.PROCESSING) {
      throw new Error('PROCESSING_LOCKED: Withdrawal is currently being processed by finance team and cannot be self-cancelled');
    }

    let updatedWallet = null;
    if (request.status === BoosterWithdrawalStatus.RESERVED) {
      const rev = await reverseReservedCents(
        boosterId,
        request.requestedUsdCents,
        cancelReason,
        {
          withdrawalRequestId: request.id,
          entryRef: `LEDGER_WDR_CANCEL_${request.withdrawalRef}`,
          createdBy: boosterId,
        },
        tx
      );
      updatedWallet = rev.wallet;
    }

    const updatedRequest = await tx.boosterWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: BoosterWithdrawalStatus.CANCELLED,
        cancelReason,
      },
    });

    return { request: updatedRequest, wallet: updatedWallet };
  });
}
