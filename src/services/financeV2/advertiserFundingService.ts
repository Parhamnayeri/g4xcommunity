/**
 * advertiserFundingService.ts — مدیریت گردش‌کارهای شارژ کیف‌پول ادورتایزر (Advertiser USD Wallet Funding)
 *
 * روش‌های شارژ:
 *  الف. پرداخت مستقیم تتر (Direct USDT - BEP20):
 *      - ثبت مشخصات تراکنش، هش شبکه، شناسه پرداخت‌کننده و مدارک
 *      - تایید واریز واقعی توسط ادمین مالی
 *      - شارژ والت دلار تنها پس از تایید مدیر و تطبیق نرخ
 *
 *  ب. پرداخت مستقیم تومان (Direct IRT):
 *      - تعیین نرخ روز دلار/تومان توسط ادمین
 *      - اعمال کارمزد مصوب خرید ارز (Currency Purchase Fee)
 *      - محاسبه ریاضی دقیق مبالغ و اخذ تاییدیه صریح از کاربر
 *      - تایید واریز بانکی توسط ادمین و سپس شارژ والت دلار
 *
 *  ج. گردش‌کار مبادله طلا (Gold Exchange Workflow):
 *      - سفارش اختصاصی مبادله میان ادورتایزر و صراف
 *      - ثبت شواهد تبادل درون‌بازی و تایید تراکنش
 *      - تایید پرداخت برون‌سیستمی تتر یا تومان
 *      - نکته حیاتی (CRITICAL): به دلیل مشخص نبودن جهت پرداخت و تحویل طلا از سوی مالک،
 *        هرگونه شارژ خودکار والت در این مرحله مسدود بوده و با وضعیت
 *        PENDING_BUSINESS_CONFIRMATION نگهداری می‌شود.
 */

import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  AdvertiserFundingMethod,
  AdvertiserFundingStatus,
  GoldExchangeTradeStatus,
  LedgerV2EntryType,
} from './financeV2Types';
import { creditAvailableCents } from './financeV2WalletService';

export interface DirectUsdtFundingInput {
  advertiserId: string;
  targetUsdCents: number;
  externalAmountUnits: string; // مقدار تتر ارسالی (مثلاً "50.00")
  network?: string; // پیش‌فرض BEP20
  evidenceRef: string; // هش تراکنش بلاکچین (TxHash)
  payerIdentifier: string; // آدرس والت فرستنده
  adminNotes?: string;
}

export interface IrtFundingQuote {
  targetUsdCents: number;
  adminUsdIrtRate: number; // نرخ دلار به تومان تعیین‌شده توسط ادمین
  currencyPurchaseFeeRate: number; // درصد کارمزد خرید ارز (مثلا 0.05 برای ۵٪)
  baseIrtUnits: number; // مبلغ پایه به تومان
  feeIrtUnits: number; // کارمزد به تومان
  totalIrtPayable: number; // کل مبلغ تومانی قابل پرداخت توسط ادورتایزر
}

export interface DirectIrtFundingInput {
  advertiserId: string;
  targetUsdCents: number;
  adminUsdIrtRate: number;
  currencyPurchaseFeeRate?: number;
  evidenceRef: string; // شماره پیگیری فیش بانکی/کارت‌به‌کارت
  payerIdentifier: string; // شماره کارت یا نام صاحب حساب پرداخت‌کننده
  adminNotes?: string;
}

export interface GoldExchangeFundingInput {
  advertiserId: string;
  exchangerId: string;
  gameSlug?: string;
  goldQuantity: number; // تعداد طلا درون‌بازی
  externalPaymentMethod: 'USDT' | 'IRT';
  externalPaymentAmount: string;
}

/**
 * ۱. استعلام پیش‌فاکتور محاسبه شارژ تومانی با اعمال دقیق کارمزد خرید ارز
 */
export function calculateIrtFundingQuote(
  targetUsdCents: number,
  adminUsdIrtRate: number,
  currencyPurchaseFeeRate: number = 0.05
): IrtFundingQuote {
  if (targetUsdCents <= 0) {
    throw new Error('INVALID_TARGET_AMOUNT: Target USD cents must be greater than zero');
  }
  if (adminUsdIrtRate <= 0) {
    throw new Error('INVALID_EXCHANGE_RATE: Admin USD/IRT rate must be greater than zero');
  }
  if (currencyPurchaseFeeRate < 0 || currencyPurchaseFeeRate >= 1) {
    throw new Error('INVALID_FEE_RATE: Currency purchase fee rate must be between 0 and 1');
  }

  const usdAmount = targetUsdCents / 100;
  const baseIrtUnits = Math.round(usdAmount * adminUsdIrtRate);
  const feeIrtUnits = Math.round(baseIrtUnits * currencyPurchaseFeeRate);
  const totalIrtPayable = baseIrtUnits + feeIrtUnits;

  return {
    targetUsdCents,
    adminUsdIrtRate,
    currencyPurchaseFeeRate,
    baseIrtUnits,
    feeIrtUnits,
    totalIrtPayable,
  };
}

/**
 * ۲. ثبت درخواست شارژ مستقیم با تتر (Direct USDT)
 */
export async function submitDirectUsdtFunding(input: DirectUsdtFundingInput) {
  const {
    advertiserId,
    targetUsdCents,
    externalAmountUnits,
    network = 'BEP20',
    evidenceRef,
    payerIdentifier,
    adminNotes,
  } = input;

  if (targetUsdCents <= 0) {
    throw new Error('INVALID_AMOUNT: Target USD cents must be greater than zero');
  }
  if (!evidenceRef || evidenceRef.trim().length < 6) {
    throw new Error('INVALID_EVIDENCE: Valid blockchain transaction hash or evidence reference is required');
  }

  const fundingRef = `FUND_USDT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const request = await prisma.advertiserFundingRequest.create({
    data: {
      fundingRef,
      advertiserId,
      fundingMethod: AdvertiserFundingMethod.USDT,
      status: AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION,
      targetUsdCents,
      externalCurrency: 'USDT',
      externalAmountUnits,
      network,
      exchangeRate: 1.0, // نسبت مبنای ۱ تتر = ۱ دلار
      currencyPurchaseFeeRate: 0,
      feeAmountUnits: '0',
      evidenceRef,
      payerIdentifier,
      adminNotes,
    },
  });

  return request;
}

/**
 * ۳. تایید واریز تتر توسط ادمین و شارژ قطعی والت دلار ادورتایزر
 */
export async function adminVerifyAndCreditUsdtFunding(
  fundingId: number,
  actorId: string,
  adminNotes?: string
) {
  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to verify funding'}`);
  }

  return await prisma.$transaction(async (tx) => {
    const fundingRequest = await tx.advertiserFundingRequest.findUnique({
      where: { id: fundingId },
    });

    if (!fundingRequest) {
      throw new Error(`FUNDING_REQUEST_NOT_FOUND: Request #${fundingId} does not exist`);
    }

    if (fundingRequest.status === AdvertiserFundingStatus.CONFIRMED_CREDITED) {
      throw new Error(`ALREADY_CREDITED: Funding request #${fundingId} has already been credited`);
    }

    if (fundingRequest.status !== AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION) {
      throw new Error(`INVALID_STATUS: Cannot credit funding request in status '${fundingRequest.status}'`);
    }

    // ۱. به‌روزرسانی وضعیت درخواست شارژ به تایید شده
    const updatedRequest = await tx.advertiserFundingRequest.update({
      where: { id: fundingId },
      data: {
        status: AdvertiserFundingStatus.CONFIRMED_CREDITED,
        verifiedBy: actorId,
        verifiedAt: new Date(),
        creditedAt: new Date(),
        adminNotes: adminNotes ? `${fundingRequest.adminNotes || ''} | ${adminNotes}`.trim() : fundingRequest.adminNotes,
      },
    });

    // ۲. شارژ معادل سنتی به موجودی در دسترس والت ادورتایزر
    const walletResult = await creditAvailableCents(
      fundingRequest.advertiserId,
      fundingRequest.targetUsdCents,
      LedgerV2EntryType.ADVERTISER_DEPOSIT,
      {
        entryRef: `LEDGER_DEP_USDT_${fundingRequest.fundingRef}`,
        fundingRequestId: fundingRequest.id,
        description: `Advertiser USDT deposit confirmed by admin (${fundingRequest.targetUsdCents} cents)`,
        metadata: {
          fundingRef: fundingRequest.fundingRef,
          externalAmountUnits: fundingRequest.externalAmountUnits,
          evidenceRef: fundingRequest.evidenceRef,
          network: fundingRequest.network,
          actorId,
        },
        createdBy: actorId,
      },
      tx
    );

    // ۳. ثبت لاگ ممیزی
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ADVERTISER_USDT_FUNDING_CREDITED',
        entityType: 'AdvertiserFundingRequest',
        entityId: String(fundingId),
        newValues: JSON.stringify({
          fundingRef: fundingRequest.fundingRef,
          targetUsdCents: fundingRequest.targetUsdCents,
          advertiserId: fundingRequest.advertiserId,
        }),
      },
    });

    return { request: updatedRequest, wallet: walletResult.wallet };
  });
}

/**
 * ۴. ثبت درخواست شارژ مستقیم با تومان (Direct IRT)
 */
export async function submitDirectIrtFunding(input: DirectIrtFundingInput) {
  const {
    advertiserId,
    targetUsdCents,
    adminUsdIrtRate,
    currencyPurchaseFeeRate = 0.05,
    evidenceRef,
    payerIdentifier,
    adminNotes,
  } = input;

  const quote = calculateIrtFundingQuote(targetUsdCents, adminUsdIrtRate, currencyPurchaseFeeRate);

  if (!evidenceRef || evidenceRef.trim().length < 4) {
    throw new Error('INVALID_EVIDENCE: Bank transaction tracking reference is required');
  }

  const fundingRef = `FUND_IRT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const request = await prisma.advertiserFundingRequest.create({
    data: {
      fundingRef,
      advertiserId,
      fundingMethod: AdvertiserFundingMethod.IRT,
      status: AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION,
      targetUsdCents,
      externalCurrency: 'IRT',
      externalAmountUnits: String(quote.totalIrtPayable),
      exchangeRate: adminUsdIrtRate,
      currencyPurchaseFeeRate,
      feeAmountUnits: String(quote.feeIrtUnits),
      evidenceRef,
      payerIdentifier,
      adminNotes,
    },
  });

  return { request, quote };
}

/**
 * ۵. تایید واریز تومانی توسط ادمین و شارژ والت دلار ادورتایزر
 */
export async function adminVerifyAndCreditIrtFunding(
  fundingId: number,
  actorId: string,
  adminNotes?: string
) {
  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to verify funding'}`);
  }

  return await prisma.$transaction(async (tx) => {
    const fundingRequest = await tx.advertiserFundingRequest.findUnique({
      where: { id: fundingId },
    });

    if (!fundingRequest) {
      throw new Error(`FUNDING_REQUEST_NOT_FOUND: Request #${fundingId} does not exist`);
    }

    if (fundingRequest.status === AdvertiserFundingStatus.CONFIRMED_CREDITED) {
      throw new Error(`ALREADY_CREDITED: Funding request #${fundingId} has already been credited`);
    }

    if (fundingRequest.status !== AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION) {
      throw new Error(`INVALID_STATUS: Cannot credit funding request in status '${fundingRequest.status}'`);
    }

    const updatedRequest = await tx.advertiserFundingRequest.update({
      where: { id: fundingId },
      data: {
        status: AdvertiserFundingStatus.CONFIRMED_CREDITED,
        verifiedBy: actorId,
        verifiedAt: new Date(),
        creditedAt: new Date(),
        adminNotes: adminNotes ? `${fundingRequest.adminNotes || ''} | ${adminNotes}`.trim() : fundingRequest.adminNotes,
      },
    });

    const walletResult = await creditAvailableCents(
      fundingRequest.advertiserId,
      fundingRequest.targetUsdCents,
      LedgerV2EntryType.ADVERTISER_DEPOSIT,
      {
        entryRef: `LEDGER_DEP_IRT_${fundingRequest.fundingRef}`,
        fundingRequestId: fundingRequest.id,
        description: `Advertiser IRT deposit confirmed by admin (${fundingRequest.targetUsdCents} cents)`,
        metadata: {
          fundingRef: fundingRequest.fundingRef,
          totalIrtPaid: fundingRequest.externalAmountUnits,
          exchangeRate: fundingRequest.exchangeRate,
          currencyPurchaseFeeRate: fundingRequest.currencyPurchaseFeeRate,
          evidenceRef: fundingRequest.evidenceRef,
          actorId,
        },
        createdBy: actorId,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ADVERTISER_IRT_FUNDING_CREDITED',
        entityType: 'AdvertiserFundingRequest',
        entityId: String(fundingId),
        newValues: JSON.stringify({
          fundingRef: fundingRequest.fundingRef,
          targetUsdCents: fundingRequest.targetUsdCents,
          totalIrtUnits: fundingRequest.externalAmountUnits,
          exchangeRate: fundingRequest.exchangeRate,
        }),
      },
    });

    return { request: updatedRequest, wallet: walletResult.wallet };
  });
}

/**
 * ۶. ایجاد سفارش گردش‌کار مبادله طلا برای شارژ ادورتایزر (Gold Exchange Funding Workflow)
 * قید اکید: ایجاد سفارش با وضعیت تاییدنشده و مسدودی شارژ والت
 */
export async function createGoldExchangeFundingWorkflow(input: GoldExchangeFundingInput) {
  const {
    advertiserId,
    exchangerId,
    gameSlug = 'wow_midnight',
    goldQuantity,
    externalPaymentMethod,
    externalPaymentAmount,
  } = input;

  if (goldQuantity <= 0) {
    throw new Error('INVALID_GOLD_QUANTITY: Gold quantity must be greater than zero');
  }

  const fundingRef = `FUND_GOLD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const tradeRef = `TRADE_GOLD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  return await prisma.$transaction(async (tx) => {
    // ایجاد رکورد سرپرست شارژ
    const fundingRequest = await tx.advertiserFundingRequest.create({
      data: {
        fundingRef,
        advertiserId,
        fundingMethod: AdvertiserFundingMethod.GOLD_EXCHANGE,
        status: AdvertiserFundingStatus.PENDING_BUSINESS_CONFIRMATION,
        targetUsdCents: 0, // تا زمان قطعی‌سازی جهت و نرخ، مقدار معادل صفر است
        externalCurrency: 'GOLD',
        externalAmountUnits: String(goldQuantity),
        adminNotes: 'Awaiting owner unambiguous decision on payment and delivery direction',
      },
    });

    // ایجاد رکورد سفارش مبادله طلا
    const tradeOrder = await tx.goldExchangeTradeOrder.create({
      data: {
        tradeRef,
        advertiserId,
        exchangerId,
        fundingRequestId: fundingRequest.id,
        gameSlug,
        goldQuantity,
        status: GoldExchangeTradeStatus.TRADE_PENDING,
        externalPaymentMethod,
        externalPaymentAmount,
        walletCreditStatus: 'BLOCKED_PENDING_DIRECTION_CONFIRMATION',
      },
    });

    return { fundingRequest, tradeOrder };
  });
}

/**
 * ۷. ثبت اتمام مبادله طلا درون‌بازی
 */
export async function recordInGameGoldTradeCompletion(
  tradeId: number,
  actorId: string,
  tradeEvidenceRef: string
) {
  return await prisma.goldExchangeTradeOrder.update({
    where: { id: tradeId },
    data: {
      status: GoldExchangeTradeStatus.TRADE_COMPLETED_IN_GAME,
      tradeEvidenceRef,
      verifiedBy: actorId,
      verifiedAt: new Date(),
    },
  });
}

/**
 * ۸. تایید پرداخت برون‌سیستمی تتر یا تومان مبادله
 */
export async function confirmExternalGoldTradePayment(
  tradeId: number,
  actorId: string,
  externalPaymentRef: string
) {
  return await prisma.goldExchangeTradeOrder.update({
    where: { id: tradeId },
    data: {
      status: GoldExchangeTradeStatus.PAYMENT_CONFIRMED,
      externalPaymentRef,
      externalPaymentConfirmedAt: new Date(),
    },
  });
}

/**
 * ۹. تلاش برای شارژ والت ادورتایزر از مبادله طلا (CRITICAL SAFEGUARD)
 * بررسی سیاست مصوب مالک؛ تا زمان تایید صریح جهت پرداخت و تحویل، اجرای شارژ والت اکیداً مسدود است.
 */
export async function attemptCreditGoldExchangeResult(tradeId: number, actorId: string) {
  // بررسی تنظیمات مصوب در جدول پیکربندی
  const config = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'gold_exchange_direction_approved' },
  });

  const isDirectionApproved = config?.value === 'true';

  if (!isDirectionApproved) {
    throw new Error(
      'GOLD_EXCHANGE_DIRECTION_UNAPPROVED: The owner has not yet confirmed the direction of Gold delivery and external payment flow. Automatic wallet credits are strictly blocked pending business confirmation.'
    );
  }

  // در صورت تایید شفاف در آینده، منطق تسویه با نظارت مدیر اعمال می‌گردد
  throw new Error('NOT_IMPLEMENTED: Gold exchange wallet credit logic requires owner authorization of pricing and beneficiary rules.');
}
