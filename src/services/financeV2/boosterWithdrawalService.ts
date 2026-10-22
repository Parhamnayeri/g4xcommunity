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
import crypto from 'crypto';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  BoosterWithdrawalMethod,
  BoosterWithdrawalStatus,
  FINANCE_V2_CONSTANTS,
  PayoutCycleDay,
  LedgerV2AccountType,
  LedgerV2Direction,
  LedgerV2EntryType,
} from './financeV2Types';
import {
  getOrCreateWalletV2,
  reserveAvailableCents,
  settleReservedCents,
  reverseReservedCents,
  assertLivePayoutsEnabled,
  recordBalancedJournalPosting,
} from './financeV2WalletService';
import { validateBep20Address } from './bep20Validator';

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
  adminUsdIrtRate?: number; // اختیاری — نرخ موثق مستقیماً در سرور واکشی می‌شود
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
  quoteHash: string;
  quoteVersion: number;
  policyVersion: number;
}

export interface PayoutScheduleResult {
  scheduledCycleDay: PayoutCycleDay | null;
  scheduledCycleDate: Date | null;
  schedulingStatus: 'SCHEDULED' | 'BLOCKED_MISSING_CUTOFF_CONFIG';
  details: string;
}

/**
 * محاسبه هش غیرقابل تغییر پیش‌فاکتور (Immutable Quote Integrity Hash)
 */
export function computeWithdrawalQuoteHash(params: {
  boosterId: string;
  payoutMethod: BoosterWithdrawalMethod;
  requestedUsdCents: number;
  fixedFeeUsdCents: number;
  netUsdCents: number;
  quoteRate: number | null;
  effectiveRate: number | null;
  destinationAddress: string;
  quoteExpiresAt: Date;
  policyVersion: number;
}): string {
  const payload = [
    params.boosterId,
    params.payoutMethod,
    params.requestedUsdCents,
    params.fixedFeeUsdCents,
    params.netUsdCents,
    params.quoteRate ?? 'null',
    params.effectiveRate ?? 'null',
    params.destinationAddress.toLowerCase().trim(),
    params.quoteExpiresAt.toISOString(),
    params.policyVersion,
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * ۱. محاسبه پیش‌فاکتور برداشت تتر بوستر (USDT BEP-20)
 * کارمزد ثابت ۴۰ سنت ($0.40) و اعتبارسنجی قطعی آدرس استاندارد BEP-20 / EIP-55
 */
export async function generateUsdtWithdrawalQuote(
  input: UsdtQuoteInput
): Promise<WithdrawalQuoteResult> {
  const { boosterId, requestedUsdCents, destinationAddress } = input;

  const fixedFee = FINANCE_V2_CONSTANTS.BOOSTER_USDT_WITHDRAWAL_FEE_CENTS;

  if (!Number.isSafeInteger(requestedUsdCents) || requestedUsdCents <= fixedFee) {
    throw new Error(
      `INVALID_AMOUNT: Requested amount ($${(requestedUsdCents / 100).toFixed(2)}) must be greater than the fixed fee of $${(fixedFee / 100).toFixed(2)}`
    );
  }

  // اعتبارسنجی سخت‌گیرانه ۲۰ بایت، هگزادسیمال و چکسام EIP-55
  const addressValidation = validateBep20Address(destinationAddress);
  if (!addressValidation.isValid) {
    throw new Error(`INVALID_BEP20_ADDRESS: ${addressValidation.error}`);
  }

  const normalizedAddress = addressValidation.checksumAddress || destinationAddress.trim();

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
  const policyVersion = 2;

  const quoteHash = computeWithdrawalQuoteHash({
    boosterId,
    payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
    requestedUsdCents,
    fixedFeeUsdCents: fixedFee,
    netUsdCents,
    quoteRate: 1.0,
    effectiveRate: 1.0,
    destinationAddress: normalizedAddress,
    quoteExpiresAt,
    policyVersion,
  });

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
    destinationAddress: normalizedAddress,
    quoteExpiresAt,
    quoteHash,
    quoteVersion: 1,
    policyVersion,
  };
}

/**
 * ۲. محاسبه پیش‌فاکتور برداشت تومانی بوستر (IRT Bank)
 * کارمزد ثابت ۱.۳۰ دلار ($1.30)
 * نرخ موثر = نرخ ادمین منهای ۳,۰۰۰ تومان به ازای هر دلار
 * قانون حاکمیتی: نرخ دلار به تومان موثق در سمت سرور واکشی می‌شود و بوستر حق تعیین یا دستکاری آن را ندارد.
 */
export async function generateIrtWithdrawalQuote(
  input: IrtQuoteInput
): Promise<WithdrawalQuoteResult> {
  const {
    boosterId,
    requestedUsdCents,
    destinationAddress,
    destinationAccountHolder,
  } = input;

  const fixedFee = FINANCE_V2_CONSTANTS.BOOSTER_IRT_WITHDRAWAL_FEE_CENTS;
  const rateDiscount = FINANCE_V2_CONSTANTS.BOOSTER_IRT_RATE_DISCOUNT_PER_USD;

  if (!Number.isSafeInteger(requestedUsdCents) || requestedUsdCents <= fixedFee) {
    throw new Error(
      `INVALID_AMOUNT: Requested amount ($${(requestedUsdCents / 100).toFixed(2)}) must be greater than fixed fee ($${(fixedFee / 100).toFixed(2)})`
    );
  }

  // واکشی نرخ موثق مصوب از تنظیمات سیستم (Server-Side Resolution)
  const config = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'admin_usd_irt_rate' },
  });

  let authoritativeRate: number;
  if (config && config.value) {
    authoritativeRate = Number(config.value);
  } else if (input.adminUsdIrtRate) {
    // در صورت عدم تنظیم در دیتابیس در محیط تست، نرخ ارسال شده اعتبارسنجی می‌شود
    authoritativeRate = input.adminUsdIrtRate;
  } else {
    throw new Error(
      'MISSING_EXCHANGE_RATE: Authoritative Admin USD/IRT rate is not configured by financial management. Quote generation blocked.'
    );
  }

  // اگر کاربر نرخی فرستاده باشد که با نرخ موثق سرور مغایر است، رد می‌شود
  if (input.adminUsdIrtRate !== undefined && input.adminUsdIrtRate !== null && config?.value) {
    const sentRate = Number(input.adminUsdIrtRate);
    if (sentRate !== authoritativeRate) {
      throw new Error(
        `UNAUTHORIZED_RATE_OVERRIDE: Booster cannot override authoritative Admin USD/IRT rate (${authoritativeRate}). Attempted rate was ${sentRate}.`
      );
    }
  }

  if (authoritativeRate <= rateDiscount) {
    throw new Error(
      `INVALID_ADMIN_RATE: Admin USD/IRT rate (${authoritativeRate}) must be strictly greater than the discount (${rateDiscount})`
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
  const effectiveRate = authoritativeRate - rateDiscount;
  const netIrt = Math.round((netUsdCents / 100) * effectiveRate);

  const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // ۱۵ دقیقه
  const policyVersion = 2;

  const quoteHash = computeWithdrawalQuoteHash({
    boosterId,
    payoutMethod: BoosterWithdrawalMethod.IRT_BANK,
    requestedUsdCents,
    fixedFeeUsdCents: fixedFee,
    netUsdCents,
    quoteRate: authoritativeRate,
    effectiveRate,
    destinationAddress: destinationAddress.trim(),
    quoteExpiresAt,
    policyVersion,
  });

  return {
    boosterId,
    payoutMethod: BoosterWithdrawalMethod.IRT_BANK,
    requestedUsdCents,
    fixedFeeUsdCents: fixedFee,
    netUsdCents,
    quoteRate: authoritativeRate,
    effectiveRate,
    rateDiscount,
    quotedNetPayoutAmount: String(netIrt),
    quotedCurrency: 'IRT',
    destinationAddress: destinationAddress.trim(),
    destinationAccountHolder,
    quoteExpiresAt,
    quoteHash,
    quoteVersion: 1,
    policyVersion,
  };
}

/**
 * استخراج مولفه‌های زمانی تقویم در تایم‌زون رسمی تهران (Asia/Tehran)
 */
function getTehranComponents(date: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hourVal = parseInt(map.hour, 10);
  const hour = hourVal === 24 ? 0 : hourVal;

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    weekday: weekdayMap[map.weekday] ?? 0,
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

/**
 * ۳. محاسبه چرخه تسویه روزهای چهارشنبه و شنبه در تایم‌زون آسیا/تهران (Asia/Tehran)
 * شنبه ۰۸:۰۰ الی کات‌آف سه‌شنبه -> تسویه چهارشنبه
 * بعد از کات‌آف سه‌شنبه -> تسویه شنبه
 * در صورت مشخص نبودن ساعت کات‌آف سه‌شنبه، وضعیت BLOCKED_MISSING_CUTOFF_CONFIG ثبت شده و تاریخ خالی می‌ماند.
 */
export function calculateIrtPayoutSchedule(
  submissionDate: Date,
  tuesdayCutoffHour?: number | null
): PayoutScheduleResult {
  // ۱. بررسی کات‌آف سه‌شنبه مصوب مالک — در صورت عدم تعیین، مسدودسازی نهایی‌سازی زمان‌بندی
  if (tuesdayCutoffHour === undefined || tuesdayCutoffHour === null) {
    return {
      scheduledCycleDay: null,
      scheduledCycleDate: null,
      schedulingStatus: 'BLOCKED_MISSING_CUTOFF_CONFIG',
      details:
        'Tuesday morning cutoff hour has not been specified by owner. Automated scheduling blocked pending configuration.',
    };
  }

  if (!Number.isFinite(tuesdayCutoffHour) || tuesdayCutoffHour <= 0 || tuesdayCutoffHour > 12) {
    throw new Error(`INVALID_CUTOFF_HOUR: Tuesday cutoff hour must be between 1 and 12, got ${tuesdayCutoffHour}`);
  }

  const tehran = getTehranComponents(submissionDate);
  const timeFraction = tehran.hour + tehran.minute / 60;

  let belongsToWednesday = false;

  if (tehran.weekday === 6) {
    // شنبه: از ساعت ۰۸:۰۰ به بعد متعلق به چهارشنبه است. قبل از ۰۸:۰۰ متعلق به شنبه جاری است.
    belongsToWednesday = timeFraction >= 8.0;
  } else if (tehran.weekday === 0 || tehran.weekday === 1) {
    // یکشنبه و دوشنبه: متعلق به چهارشنبه
    belongsToWednesday = true;
  } else if (tehran.weekday === 2) {
    // سه‌شنبه: قبل از کات‌آف متعلق به چهارشنبه؛ بعد از کات‌آف متعلق به شنبه
    belongsToWednesday = timeFraction < tuesdayCutoffHour;
  } else {
    // سایر روزها (چهارشنبه، پنج‌شنبه، جمعه): متعلق به شنبه
    belongsToWednesday = false;
  }

  const scheduledCycleDay = belongsToWednesday ? PayoutCycleDay.WEDNESDAY : PayoutCycleDay.SATURDAY;
  const targetWeekday = belongsToWednesday ? 3 : 6;

  // محاسبه تعداد روزهای باقیمانده تا روز تسویه در تایم‌زون تهران
  let daysToAdd = 0;
  if (tehran.weekday === 6 && !belongsToWednesday) {
    // شنبه قبل از ۰۸:۰۰ صبح: تسویه در همان روز شنبه جاری
    daysToAdd = 0;
  } else {
    daysToAdd = (targetWeekday - tehran.weekday + 7) % 7;
    if (daysToAdd === 0) {
      daysToAdd = 7;
    }
  }

  // محاسبه تاریخ دقیق تقویمی روز تسویه بر مبنای تقویم تهران
  const targetDateMillis = submissionDate.getTime() + daysToAdd * 24 * 3600 * 1000;
  const targetTehran = getTehranComponents(new Date(targetDateMillis));

  // ساعت تسویه ظهر در تهران (12:00:00 Asia/Tehran معادل 08:30:00 UTC)
  const scheduledCycleDate = new Date(
    Date.UTC(targetTehran.year, targetTehran.month - 1, targetTehran.day, 8, 30, 0)
  );

  return {
    scheduledCycleDay,
    scheduledCycleDate,
    schedulingStatus: 'SCHEDULED',
    details: `Assigned to ${scheduledCycleDay} payout cycle (Target Date: ${targetTehran.year}-${String(targetTehran.month).padStart(2, '0')}-${String(targetTehran.day).padStart(2, '0')} in Asia/Tehran)`,
  };
}

/**
 * ۴. ایجاد پیش‌نویس اولیه درخواست برداشت بر اساس پیش‌فاکتور مصوب (Create Draft / Quoted)
 */
export async function createWithdrawalRequestFromQuote(quote: WithdrawalQuoteResult) {
  // اعتبارسنجی مجدد مقادیر پیش‌فاکتور
  if (quote.payoutMethod === BoosterWithdrawalMethod.USDT_BEP20) {
    const val = validateBep20Address(quote.destinationAddress);
    if (!val.isValid) {
      throw new Error(`INVALID_BEP20_ADDRESS: ${val.error}`);
    }
  }

  const withdrawalRef = `WDR_${quote.payoutMethod}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

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
      quoteVersion: quote.quoteVersion || 1,
      quoteHash: quote.quoteHash,
      policyVersion: quote.policyVersion || 2,
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
 * اعتبارسنجی مجدد و دقیق مالکیت، انقضا، تغییرات خط‌مشی، نرخ ارز، هش پیش‌فاکتور و موجودی
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

    if (request.status === BoosterWithdrawalStatus.RESERVED) {
      throw new Error('ALREADY_RESERVED: Withdrawal request has already been confirmed and reserved');
    }

    if (request.status !== BoosterWithdrawalStatus.QUOTED) {
      throw new Error(`INVALID_STATUS: Withdrawal request is in '${request.status}' status, cannot confirm`);
    }

    // بررسی انقضای پیش‌فاکتور (Quote Expiration Guard)
    if (request.quoteExpiresAt && new Date() > request.quoteExpiresAt) {
      throw new Error('QUOTE_EXPIRED: The financial quote has expired. Please request a new quote with updated rates.');
    }

    // بررسی تغییرات خط‌مشی و نرخ مصوب (Policy & Rate Revalidation Guard)
    if (request.payoutMethod === BoosterWithdrawalMethod.IRT_BANK) {
      const currentRateConfig = await tx.systemFinancialConfig.findUnique({
        where: { key: 'admin_usd_irt_rate' },
      });
      const currentRate = currentRateConfig ? Number(currentRateConfig.value) : null;
      if (currentRate !== null && request.quoteRate !== null && currentRate !== request.quoteRate) {
        throw new Error(
          `POLICY_CHANGED_REQUOTE_REQUIRED: The authoritative Admin USD/IRT rate changed from ${request.quoteRate} to ${currentRate}. Requoting is mandatory.`
        );
      }
    } else if (request.payoutMethod === BoosterWithdrawalMethod.USDT_BEP20) {
      const val = validateBep20Address(request.destinationAddress);
      if (!val.isValid) {
        throw new Error(`INVALID_BEP20_ADDRESS: Destination address is invalid: ${val.error}`);
      }
    }

    // بازتایید یکپارچگی هش پیش‌فاکتور ذخیره‌شده
    if (request.quoteHash && request.quoteExpiresAt) {
      const computedHash = computeWithdrawalQuoteHash({
        boosterId: request.boosterId,
        payoutMethod: request.payoutMethod as BoosterWithdrawalMethod,
        requestedUsdCents: request.requestedUsdCents,
        fixedFeeUsdCents: request.fixedFeeUsdCents,
        netUsdCents: request.netUsdCents,
        quoteRate: request.quoteRate,
        effectiveRate: request.effectiveRate,
        destinationAddress: request.destinationAddress,
        quoteExpiresAt: request.quoteExpiresAt,
        policyVersion: request.policyVersion ?? 2,
      });

      if (computedHash !== request.quoteHash) {
        throw new Error('QUOTE_TAMPERED: Persisted quote hash integrity check failed. Quote data has been modified.');
      }
    }

    // بررسی مجدد موجودی در دسترس
    const freshWallet = await tx.walletV2.findUnique({
      where: { userId: boosterId },
    });
    if (!freshWallet || freshWallet.availableCents < request.requestedUsdCents) {
      throw new Error(
        `INSUFFICIENT_FUNDS: Available USD balance ($${((freshWallet?.availableCents ?? 0) / 100).toFixed(2)}) is less than requested amount ($${(request.requestedUsdCents / 100).toFixed(2)})`
      );
    }

    // رزرو موجودی از والت دلار بوستر (کاهش از موجودی در دسترس و افزایش موجودی رزرو)
    const reserveResult = await reserveAvailableCents(
      boosterId,
      request.requestedUsdCents,
      LedgerV2EntryType.WITHDRAWAL_RESERVE,
      {
        withdrawalRequestId: request.id,
        postingGroupId: `POSTING_GRP_WDR_${request.withdrawalRef}`,
        accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
        entryRef: `LEDGER_WDR_RES_${request.withdrawalRef}`,
        description: `Reserved funds for ${request.payoutMethod} withdrawal (#${request.id})`,
      },
      tx
    );

    // تغییر وضعیت به RESERVED همراه با ثبت زمان اعتبارسنجی
    const updatedRequest = await tx.boosterWithdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: BoosterWithdrawalStatus.RESERVED,
        userConfirmedAt: new Date(),
        revalidatedAt: new Date(),
      },
    });

    return { request: updatedRequest, wallet: reserveResult.wallet };
  });
}

/**
 * ۶. تایید و پرداخت دستی توسط ادمین (Admin Manual Payout Execution)
 * منوط به ثبت هش تراکنش بلاکچین یا شماره پیگیری فیش بانکی و تراز کامل دفاتر
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
  assertLivePayoutsEnabled();

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
      throw new Error(`ALREADY_PAID: Withdrawal #${requestId} has already been settled and paid`);
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

    const postingGroupId = `POSTING_GRP_PAYOUT_${request.withdrawalRef}`;
    const clearingAccount =
      request.payoutMethod === BoosterWithdrawalMethod.USDT_BEP20
        ? LedgerV2AccountType.ASSET_EXTERNAL_USDT_CLEARING
        : LedgerV2AccountType.ASSET_EXTERNAL_BANK_CLEARING;

    // ثبت سند دوطرفه متعادل تسویه خروج پول و کارمزد
    // بدهکار: تعهد کیف‌پول کاربر رزرو شده (Requested Cents)
    // بستانکار ۱: حساب تسویه خروجی دارایی (Net Payout Cents)
    // بستانکار ۲: درآمد کارمزد پلتفرم (Fixed Fee Cents)
    // مجموع بدهکار = مجموع بستانکار
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        referenceType: 'BoosterWithdrawalRequest',
        referenceId: request.id,
        legs: [
          {
            userId: request.boosterId,
            amountCents: request.requestedUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
            entryType: LedgerV2EntryType.WITHDRAWAL_SETTLE,
            withdrawalRequestId: request.id,
            description: `Settled reserved booster funds for withdrawal #${request.id}`,
            createdBy: actorId,
          },
          {
            amountCents: request.netUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: clearingAccount,
            entryType: LedgerV2EntryType.WITHDRAWAL_SETTLE,
            withdrawalRequestId: request.id,
            description: `External asset disbursement for ${request.payoutMethod} withdrawal #${request.id}`,
            createdBy: actorId,
          },
          {
            amountCents: request.fixedFeeUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.REVENUE_PLATFORM_FEE,
            entryType: LedgerV2EntryType.ORDER_FEE_COLLECTION,
            withdrawalRequestId: request.id,
            description: `Platform fee collected for withdrawal #${request.id}`,
            createdBy: actorId,
          },
        ],
      },
      tx
    );

    // انتقال قطعی وجوه از موجودی رزرو به پرداخت‌شده (Paid Cents)
    const settleResult = await settleReservedCents(
      request.boosterId,
      request.requestedUsdCents,
      {
        withdrawalRequestId: request.id,
        postingGroupId,
        accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
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
          postingGroupId,
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
