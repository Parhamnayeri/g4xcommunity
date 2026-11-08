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

import { Prisma } from '@prisma/client';
import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import {
  AdvertiserFundingMethod,
  AdvertiserFundingStatus,
  GoldExchangeTradeStatus,
  LedgerV2EntryType,
  LedgerV2Direction,
  LedgerV2AccountType,
} from './financeV2Types';
import {
  creditAvailableCents,
  assertLiveCreditsEnabled,
  recordBalancedJournalPosting,
} from './financeV2WalletService';

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
  currencyPurchaseFeeRate: number; // درصد کارمزد خرید ارز مصوب مدیریت
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
 * قانون قطعی: نرخ کارمزد خرید ارز پیش‌فرض ۵٪ ندارد و باید صراحتاً توسط مدیریت تصویب و ارسال شود.
 */
export function calculateIrtFundingQuote(
  targetUsdCents: number,
  adminUsdIrtRate: number,
  currencyPurchaseFeeRate?: number | null
): IrtFundingQuote {
  if (currencyPurchaseFeeRate === undefined || currencyPurchaseFeeRate === null) {
    throw new Error(
      'MISSING_CURRENCY_PURCHASE_FEE_RATE: Advertiser IRT currency-purchase fee rate must be explicitly approved and configured by authorized management (no defaults permitted)'
    );
  }
  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error('INVALID_TARGET_AMOUNT: Target USD cents must be a positive safe integer');
  }
  if (!Number.isFinite(adminUsdIrtRate) || adminUsdIrtRate <= 0) {
    throw new Error('INVALID_EXCHANGE_RATE: Admin USD/IRT rate must be greater than zero');
  }
  if (!Number.isFinite(currencyPurchaseFeeRate) || currencyPurchaseFeeRate < 0 || currencyPurchaseFeeRate >= 1) {
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

  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error('INVALID_AMOUNT: Target USD cents must be a positive safe integer');
  }
  if (!evidenceRef || evidenceRef.trim().length < 6) {
    throw new Error('INVALID_EVIDENCE: Valid blockchain transaction hash or evidence reference is required');
  }

  const trimmedEvidence = evidenceRef.trim();

  // جلوگیری از ثبت مدارک واریز تکراری (Duplicate deposit evidence rejection)
  const existingEvidence = await prisma.advertiserFundingRequest.findFirst({
    where: {
      evidenceRef: trimmedEvidence,
      status: {
        in: [
          AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION,
          AdvertiserFundingStatus.CONFIRMED_CREDITED,
        ],
      },
    },
  });

  if (existingEvidence) {
    throw new Error(
      `DUPLICATE_DEPOSIT_EVIDENCE: Deposit evidence '${trimmedEvidence}' has already been submitted for funding request #${existingEvidence.id}`
    );
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
      evidenceRef: trimmedEvidence,
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
  const fundingRequestPre = await prisma.advertiserFundingRequest.findUnique({
    where: { id: fundingId },
    select: { advertiserId: true },
  });
  if (fundingRequestPre && fundingRequestPre.advertiserId === actorId) {
    throw new Error('SELF_APPROVAL_PROHIBITED: You cannot review or approve your own deposit request.');
  }

  assertLiveCreditsEnabled();

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

    if (fundingRequest.advertiserId === actorId) {
      throw new Error('SELF_APPROVAL_PROHIBITED: You cannot review or approve your own deposit request.');
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

    const postingGroupId = `POSTING_GRP_USDT_DEP_${fundingRequest.fundingRef}`;

    // ۲. ثبت سند متعادل دوطرفه (Double-Entry Balanced Journal Posting)
    // بستانکار: تعهد کیف‌پول کاربر | بدهکار: دارایی حساب تسویه خارجی تتر
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        referenceType: 'AdvertiserFundingRequest',
        referenceId: fundingRequest.id,
        legs: [
          {
            amountCents: fundingRequest.targetUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: LedgerV2AccountType.ASSET_EXTERNAL_USDT_CLEARING,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: fundingRequest.id,
            description: `External USDT asset clearing for funding #${fundingRequest.id}`,
            createdBy: actorId,
          },
          {
            userId: fundingRequest.advertiserId,
            amountCents: fundingRequest.targetUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: fundingRequest.id,
            description: `Advertiser USDT deposit confirmed by admin (${fundingRequest.targetUsdCents} cents)`,
            createdBy: actorId,
            metadata: {
              fundingRef: fundingRequest.fundingRef,
              externalAmountUnits: fundingRequest.externalAmountUnits,
              evidenceRef: fundingRequest.evidenceRef,
              network: fundingRequest.network,
              actorId,
            },
          },
        ],
      },
      tx
    );

    // به‌روزرسانی مانده والت
    const wallet = await tx.walletV2.findUnique({
      where: { userId: fundingRequest.advertiserId },
    });
    const newAvailable = (wallet?.availableCents ?? 0) + fundingRequest.targetUsdCents;
    const updatedWallet = await tx.walletV2.update({
      where: { userId: fundingRequest.advertiserId },
      data: { availableCents: newAvailable },
    });

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
          postingGroupId,
        }),
      },
    });

    return { request: updatedRequest, wallet: updatedWallet };
  });
}

/**
 * ۴. ثبت درخواست شارژ مستقیم با تومان (Direct IRT)
 */
export async function submitDirectIrtFunding(
  input: DirectIrtFundingInput,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const {
    advertiserId,
    targetUsdCents,
    adminUsdIrtRate,
    evidenceRef,
    payerIdentifier,
    adminNotes,
  } = input;

  let feeRate = input.currencyPurchaseFeeRate;

  // در صورت عدم ارسال نرخ، بررسی تنظیمات مصوب مدیریت در دیتابیس
  if (feeRate === undefined || feeRate === null) {
    const config = await client.systemFinancialConfig.findUnique({
      where: { key: 'advertiser_irt_purchase_fee_rate' },
    });
    if (!config || !config.value) {
      throw new Error(
        'MISSING_CURRENCY_PURCHASE_FEE_RATE: Advertiser IRT currency-purchase fee rate is not configured. Missing required rate blocks financial quote approval and request creation'
      );
    }
    feeRate = Number(config.value);
    if (isNaN(feeRate) || feeRate < 0 || feeRate >= 1) {
      throw new Error(`INVALID_CONFIGURED_FEE_RATE: Configured rate '${config.value}' is invalid`);
    }
  }

  const quote = calculateIrtFundingQuote(targetUsdCents, adminUsdIrtRate, feeRate);

  if (!evidenceRef || evidenceRef.trim().length < 4) {
    throw new Error('INVALID_EVIDENCE: Bank transaction tracking reference is required');
  }

  const trimmedEvidence = evidenceRef.trim();

  // جلوگیری از ثبت مدارک واریز تکراری تومانی (Duplicate deposit evidence rejection)
  const existingEvidence = await client.advertiserFundingRequest.findFirst({
    where: {
      evidenceRef: trimmedEvidence,
      status: {
        in: [
          AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION,
          AdvertiserFundingStatus.CONFIRMED_CREDITED,
        ],
      },
    },
  });

  if (existingEvidence) {
    throw new Error(
      `DUPLICATE_DEPOSIT_EVIDENCE: Deposit evidence '${trimmedEvidence}' has already been submitted for funding request #${existingEvidence.id}`
    );
  }

  const fundingRef = `FUND_IRT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const request = await client.advertiserFundingRequest.create({
    data: {
      fundingRef,
      advertiserId,
      fundingMethod: AdvertiserFundingMethod.IRT,
      status: AdvertiserFundingStatus.PENDING_ADMIN_VERIFICATION,
      targetUsdCents,
      externalCurrency: 'IRT',
      externalAmountUnits: String(quote.totalIrtPayable),
      exchangeRate: adminUsdIrtRate,
      currencyPurchaseFeeRate: feeRate,
      feeAmountUnits: String(quote.feeIrtUnits),
      evidenceRef: trimmedEvidence,
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
  const fundingRequestPre = await prisma.advertiserFundingRequest.findUnique({
    where: { id: fundingId },
    select: { advertiserId: true },
  });
  if (fundingRequestPre && fundingRequestPre.advertiserId === actorId) {
    throw new Error('SELF_APPROVAL_PROHIBITED: You cannot review or approve your own deposit request.');
  }

  assertLiveCreditsEnabled();

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

    if (fundingRequest.advertiserId === actorId) {
      throw new Error('SELF_APPROVAL_PROHIBITED: You cannot review or approve your own deposit request.');
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

    const postingGroupId = `POSTING_GRP_IRT_DEP_${fundingRequest.fundingRef}`;

    // سند حسابداری متعادل دوطرفه برای شارژ تومانی
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        referenceType: 'AdvertiserFundingRequest',
        referenceId: fundingRequest.id,
        legs: [
          {
            amountCents: fundingRequest.targetUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: LedgerV2AccountType.ASSET_EXTERNAL_BANK_CLEARING,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: fundingRequest.id,
            description: `External bank asset clearing for IRT funding #${fundingRequest.id}`,
            createdBy: actorId,
          },
          {
            userId: fundingRequest.advertiserId,
            amountCents: fundingRequest.targetUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.ADVERTISER_DEPOSIT,
            fundingRequestId: fundingRequest.id,
            description: `Advertiser IRT deposit confirmed by admin (${fundingRequest.targetUsdCents} cents)`,
            createdBy: actorId,
            metadata: {
              fundingRef: fundingRequest.fundingRef,
              totalIrtPaid: fundingRequest.externalAmountUnits,
              exchangeRate: fundingRequest.exchangeRate,
              currencyPurchaseFeeRate: fundingRequest.currencyPurchaseFeeRate,
              evidenceRef: fundingRequest.evidenceRef,
              actorId,
            },
          },
        ],
      },
      tx
    );

    // به‌روزرسانی مانده والت
    const wallet = await tx.walletV2.findUnique({
      where: { userId: fundingRequest.advertiserId },
    });
    const newAvailable = (wallet?.availableCents ?? 0) + fundingRequest.targetUsdCents;
    const updatedWallet = await tx.walletV2.update({
      where: { userId: fundingRequest.advertiserId },
      data: { availableCents: newAvailable },
    });

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
          postingGroupId,
        }),
      },
    });

    return { request: updatedRequest, wallet: updatedWallet };
  });
}

/**
 * ۶. ایجاد سفارش گردش‌کار مبادله طلا برای شارژ ادورتایزر (Gold Exchange Funding Workflow)
 * قید اکید: ایجاد سفارش با وضعیت تاییدنشده و مسدودی شارژ والت
 */
export async function createGoldExchangeFundingWorkflow(
  input: GoldExchangeFundingInput,
  actorId?: string
) {
  const {
    advertiserId,
    exchangerId,
    gameSlug = 'wow_midnight',
    goldQuantity,
    externalPaymentMethod,
    externalPaymentAmount,
  } = input;

  // احراز هویت متقاضی یا مدیر مالی
  if (actorId && actorId !== advertiserId) {
    const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
    if (!auth.allowed) {
      throw new Error(`UNAUTHORIZED: Applicant does not own the funding request and lacks finance permission`);
    }
  }

  // جلوگیری از خودصرافی (Advertiser cannot be their own Exchanger)
  if (advertiserId === exchangerId) {
    throw new Error('SELF_EXCHANGE_FORBIDDEN: Advertiser cannot act as the exchanger on their own trade');
  }

  // اعتبارسنجی وجود صراف و ادورتایزر در دیتابیس و بررسی نقش مصوب صراف
  const [advertiser, exchanger] = await Promise.all([
    prisma.user.findUnique({ where: { discordId: advertiserId } }),
    prisma.user.findUnique({
      where: { discordId: exchangerId },
      include: { userRoles: true },
    }),
  ]);

  if (!advertiser || !advertiser.isActive) {
    throw new Error(`ADVERTISER_NOT_FOUND: Advertiser '${advertiserId}' does not exist or is inactive`);
  }
  if (
    !exchanger ||
    !exchanger.isActive ||
    !exchanger.userRoles.some((r) => r.roleKey === 'exchanger' || r.roleKey === 'owner')
  ) {
    throw new Error(
      `INVALID_OR_INACTIVE_EXCHANGER: Exchanger '${exchangerId}' is not an active approved exchanger`
    );
  }

  if (!Number.isSafeInteger(goldQuantity) || goldQuantity <= 0) {
    throw new Error('INVALID_GOLD_QUANTITY: Gold quantity must be a positive safe integer');
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
  const trade = await prisma.goldExchangeTradeOrder.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold exchange trade #${tradeId} does not exist`);
  }

  if (trade.status !== GoldExchangeTradeStatus.TRADE_PENDING) {
    throw new Error(
      `INVALID_TRADE_STATUS: Cannot record in-game completion for trade in status '${trade.status}' (expected TRADE_PENDING)`
    );
  }

  if (!tradeEvidenceRef || tradeEvidenceRef.trim().length < 6) {
    throw new Error('INVALID_TRADE_EVIDENCE: Valid in-game trade evidence reference is required');
  }

  // بررسی دسترسی طرفین یا استف
  if (actorId !== trade.advertiserId && actorId !== trade.exchangerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_TRADE_ACTOR: Only participating advertiser, exchanger, or staff may record trade completion');
    }
  }

  return await prisma.goldExchangeTradeOrder.update({
    where: { id: tradeId },
    data: {
      status: GoldExchangeTradeStatus.TRADE_COMPLETED_IN_GAME,
      tradeEvidenceRef: tradeEvidenceRef.trim(),
      verifiedBy: actorId,
      verifiedAt: new Date(),
    },
  });
}

/**
 * ۷.ب. بررسی و تایید مستقل مدارک تبادل طلا توسط ناظر (Staff Independent Verification)
 */
export async function verifyInGameGoldTrade(
  tradeId: number,
  verifierId: string,
  notes?: string
) {
  const trade = await prisma.goldExchangeTradeOrder.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold exchange trade #${tradeId} does not exist`);
  }

  if (trade.status !== GoldExchangeTradeStatus.TRADE_COMPLETED_IN_GAME) {
    throw new Error(
      `INVALID_TRADE_STATUS: Cannot verify trade in status '${trade.status}' (expected TRADE_COMPLETED_IN_GAME)`
    );
  }

  // شرط استقلال ناظر: طرفین معامله حق تایید خود را ندارند (No self-verification)
  if (verifierId === trade.advertiserId || verifierId === trade.exchangerId) {
    throw new Error('SELF_VERIFICATION_FORBIDDEN: Advertiser or exchanger cannot verify their own trade completion');
  }

  const auth = await authorize(verifierId, Permission.PROOF_REVIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason || 'Insufficient permissions to verify trade evidence'}`);
  }

  return await prisma.goldExchangeTradeOrder.update({
    where: { id: tradeId },
    data: {
      status: GoldExchangeTradeStatus.TRADE_VERIFIED,
      verifiedBy: verifierId,
      verifiedAt: new Date(),
      rejectionReason: notes ? `Notes: ${notes}` : undefined,
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
  const trade = await prisma.goldExchangeTradeOrder.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold exchange trade #${tradeId} does not exist`);
  }

  if (
    trade.status === GoldExchangeTradeStatus.PAYMENT_CONFIRMED ||
    trade.status === GoldExchangeTradeStatus.RECONCILED
  ) {
    throw new Error('DUPLICATE_PAYMENT_CONFIRMATION: External payment for this trade has already been confirmed');
  }

  if (
    trade.status !== GoldExchangeTradeStatus.TRADE_COMPLETED_IN_GAME &&
    trade.status !== GoldExchangeTradeStatus.TRADE_VERIFIED
  ) {
    throw new Error(
      `INVALID_TRADE_STATUS: Cannot confirm payment for trade in status '${trade.status}' (expected TRADE_COMPLETED_IN_GAME or TRADE_VERIFIED)`
    );
  }

  // عدم امکان خودتاییدی پرداخت توسط ادورتایزر یا صراف (الزام استقلال بررسی)
  if (actorId === trade.advertiserId || actorId === trade.exchangerId) {
    throw new Error('SELF_REVIEW_NOT_PERMITTED: Self-verification not permitted. Independent review required to confirm external payment');
  }

  const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason || 'Insufficient permissions to confirm external trade payment'}`);
  }

  if (!externalPaymentRef || externalPaymentRef.trim().length < 6) {
    throw new Error('INVALID_PAYMENT_REF: Valid payment reference or bank tracking code is required');
  }

  return await prisma.goldExchangeTradeOrder.update({
    where: { id: tradeId },
    data: {
      status: GoldExchangeTradeStatus.PAYMENT_CONFIRMED,
      externalPaymentRef: externalPaymentRef.trim(),
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
