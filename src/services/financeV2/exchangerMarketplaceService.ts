/**
 * exchangerMarketplaceService.ts — سرویس متمرکز بازار مبادلات صرافی، معاملات طلا و شارژ همتا‌به‌همتا (P2P)
 *
 * مسئولیت‌ها و اصول معماری فاز Finance V2.2:
 *  ۱. جداسازی کامل سه جریان مالی (Workflows A, B, C):
 *     - جریان الف (Workflow A): معامله طلا با تسویه مستقیم برون‌سیستمی (کارت/شبا تومان یا تتر).
 *       * اصل حیاتی: هیچ وجهی به کیف‌پول ادورتایزر واریز نمی‌شود و از کیف‌پول صراف کسر نمی‌گردد!
 *     - جریان ب (Workflow B): معامله طلا با تسویه از موجودی پیش‌شارژشده کیف‌پول دلاری صراف (USD_WALLET).
 *       * رزرو موجودی از کیف‌پول صراف -> تایید تحویل طلا -> انتقال اتمیک تعهد از صراف به ادورتایزر با تراز دوبل.
 *     - جریان ج (Workflow C): شارژ کیف‌پول ادورتایزر با تومان از طریق صراف (P2P IRT-to-USD Funding).
 *       * اصل حیاتی: واریز تومان به صراف به تنهایی مجوز خلق دلار اعتباری نیست! صراف باید موجودی واقعی داشته و رزرو گردد.
 *  ۲. تعیین نرخ کارمزد توسط خود صراف (Exchanger-Controlled Commission) بر اساس پیشنهادهای مستقل.
 *  ۳. جهت معامله قطعی: ادورتایزر طلا می‌فروشد (Seller) و صراف طلا می‌خرد (Buyer).
 *  ۴. گیت‌های Fail-Closed و منع خودتاییدی (Anti Self-Approval / Anti Self-Trade).
 */

import crypto from 'crypto';
import prisma from '../../database/db';
import { Prisma, AdvertiserFundingRequest } from '@prisma/client';
import {
  ExchangerOfferServiceType,
  ExchangerOfferStatus,
  GoldTradeSettlementMethod,
  GoldTradeStatus,
  GoldDeliveryStatus,
  GoldPaymentStatus,
  LedgerV2EntryType,
  LedgerV2Direction,
  LedgerV2AccountType,
  CreateExchangerOfferInput,
  UpdateExchangerOfferInput,
  GoldTradeQuoteResult,
} from './financeV2Types';
import {
  assertP2pSettlementEnabled,
  assertWalletInvariants,
  recordBalancedJournalPosting,
  getOrCreateWalletV2,
} from './financeV2WalletService';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';

/**
 * دریافت کلید امضای پیش‌فاکتورهای صرافی و P2P به صورت امن از محیط
 * Fail-Closed: در صورت فقدان یا ضعف کلید، فوراً مسدود می‌شود.
 */
export function getExchangeQuoteSigningSecret(): string {
  const secret = process.env.EXCHANGE_QUOTE_SIGNING_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'MISSING_EXCHANGE_QUOTE_SIGNING_SECRET: Dedicated server-side EXCHANGE_QUOTE_SIGNING_SECRET with at least 32 characters of entropy is strictly required for exchange and marketplace quote operations.'
    );
  }
  return secret.trim();
}

/**
 * تولید امضای رمزنگاری‌شده ضد‌دستکاری (HMAC-SHA256) برای پیش‌فاکتور معامله طلا
 * پیوند تمام متغیرهای اقتصادی، هویتی، آفر و انقضا به امضا
 */
export function computeGoldTradeQuoteHash(data: {
  tradeRef: string;
  sellerId: string;
  buyerId: string;
  offerId?: number | null;
  offerVersion?: number | null;
  feePayer?: string | null;
  gameSlug?: string | null;
  region?: string | null;
  realm?: string | null;
  faction?: string | null;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  settlementMethod: string;
  commissionPercentage: number;
  quotedPayableAmount: string;
  quotedPayableCurrency: string;
  expiresAt: Date;
}): string {
  const secret = getExchangeQuoteSigningSecret();
  const payload = [
    'V2_GOLD_QUOTE_HMAC',
    data.tradeRef,
    data.sellerId,
    data.buyerId,
    data.offerId ? data.offerId.toString() : 'NONE',
    data.offerVersion ? data.offerVersion.toString() : '0',
    data.feePayer || 'EXCHANGER',
    data.gameSlug || 'wow_midnight',
    data.region || 'EU',
    data.realm || 'NONE',
    data.faction || 'NONE',
    data.goldQuantity.toString(),
    data.agreedValuationUsdCents.toString(),
    data.settlementMethod,
    Number(data.commissionPercentage || 0).toFixed(4),
    data.quotedPayableAmount,
    data.quotedPayableCurrency,
    new Date(data.expiresAt).toISOString(),
  ].join('|');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * بررسی زمان‌ثابت (Timing-Safe) تمامیت امضای پیش‌فاکتور طلا
 */
export function verifyGoldTradeQuoteHash(
  data: Parameters<typeof computeGoldTradeQuoteHash>[0],
  providedHash: string
): boolean {
  if (!providedHash || typeof providedHash !== 'string') return false;
  try {
    const expectedHash = computeGoldTradeQuoteHash(data);
    const providedBuf = Buffer.from(providedHash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * تولید امضای رمزنگاری‌شده ضد‌دستکاری (HMAC-SHA256) برای پیش‌فاکتور شارژ P2P
 */
export function computeP2pFundingQuoteHash(data: {
  quoteRef: string;
  advertiserId: string;
  exchangerId: string;
  offerId: number;
  offerVersion: number;
  targetUsdCents: number;
  referenceRate: number;
  commissionPercentage: number;
  baseIrt: number;
  commissionIrt: number;
  totalIrtPayable: number;
  expiresAt: Date;
}): string {
  const secret = getExchangeQuoteSigningSecret();
  const payload = [
    'V2_P2P_QUOTE_HMAC',
    data.quoteRef,
    data.advertiserId,
    data.exchangerId,
    data.offerId.toString(),
    data.offerVersion.toString(),
    data.targetUsdCents.toString(),
    data.referenceRate.toString(),
    Number(data.commissionPercentage || 0).toFixed(4),
    data.baseIrt.toString(),
    data.commissionIrt.toString(),
    data.totalIrtPayable.toString(),
    new Date(data.expiresAt).toISOString(),
  ].join('|');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * بررسی زمان‌ثابت تمامیت امضای پیش‌فاکتور شارژ P2P
 */
export function verifyP2pFundingQuoteHash(
  data: Parameters<typeof computeP2pFundingQuoteHash>[0],
  providedHash: string
): boolean {
  if (!providedHash || typeof providedHash !== 'string') return false;
  try {
    const expectedHash = computeP2pFundingQuoteHash(data);
    const providedBuf = Buffer.from(providedHash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * اعتبارسنجی احراز صلاحیت صراف فعال در پایگاه داده
 */
export async function assertApprovedExchanger(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { discordId: userId },
    include: { userRoles: true },
  });

  if (!user || !user.isActive) {
    throw new Error(`EXCHANGER_NOT_FOUND: User '${userId}' not found or inactive`);
  }

  const isApproved = user.userRoles.some(
    (r) => r.roleKey === 'exchanger' || r.roleKey === 'owner'
  );
  if (!isApproved) {
    throw new Error(`UNAPPROVED_EXCHANGER: User '${userId}' is not an active approved exchanger`);
  }

  // بررسی عدم تعلیق
  const suspendedApp = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'exchanger',
      status: { in: ['SUSPENDED', 'BANNED', 'REJECTED'] },
    },
  });
  if (suspendedApp && !user.userRoles.some((r) => r.roleKey === 'owner')) {
    throw new Error(`EXCHANGER_SUSPENDED: Exchanger profile for '${userId}' is suspended or revoked`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ۱. مدیریت پیشنهادهای کارمزد صرافان (Exchanger Fee Offers)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ایجاد پیشنهاد کارمزد خدمات توسط صراف تاییدشده
 */
export async function createExchangerFeeOffer(
  actorId: string,
  input: CreateExchangerOfferInput
) {
  // ۱. بررسی هویت: بازیگر باید همان صراف باشد یا مالک سیستم
  if (actorId !== input.exchangerId) {
    const auth = await authorize(actorId, Permission.SYSTEM_CONFIG_MANAGE);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_EXCHANGER_ACTION: You may only create offers for your own exchanger profile');
    }
  }

  // ۲. بررسی تایید صلاحیت صراف در دیتابیس
  const exchanger = await prisma.user.findUnique({
    where: { discordId: input.exchangerId },
    include: { userRoles: true },
  });

  if (!exchanger || !exchanger.isActive) {
    throw new Error(`EXCHANGER_NOT_FOUND: User '${input.exchangerId}' not found or inactive`);
  }

  const isApprovedExchanger = exchanger.userRoles.some(
    (r) => r.roleKey === 'exchanger' || r.roleKey === 'owner'
  );
  if (!isApprovedExchanger) {
    throw new Error(`UNAPPROVED_EXCHANGER: User '${input.exchangerId}' is not an active approved exchanger`);
  }

  // ۳. اعتبارسنجی مقادیر کارمزد و دامنه‌ها (عدم پذیرش مقادیر نامعتبر)
  if (
    typeof input.commissionPercentage !== 'number' ||
    isNaN(input.commissionPercentage) ||
    !isFinite(input.commissionPercentage) ||
    input.commissionPercentage < 0 ||
    input.commissionPercentage >= 1.0
  ) {
    throw new Error(
      `INVALID_COMMISSION_PERCENTAGE: Commission rate must be a valid number between 0.0 and 0.9999, got ${input.commissionPercentage}`
    );
  }

  if (input.minAmount !== undefined && (input.minAmount < 0 || isNaN(input.minAmount))) {
    throw new Error('INVALID_MIN_AMOUNT: Minimum amount cannot be negative');
  }
  if (input.maxAmount !== undefined && input.minAmount !== undefined && input.maxAmount < input.minAmount) {
    throw new Error('INVALID_MAX_AMOUNT: Maximum amount cannot be less than minimum amount');
  }

  const offerRef = `OFFER_${input.serviceType}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  return await prisma.exchangerFeeOffer.create({
    data: {
      offerRef,
      exchangerId: input.exchangerId,
      serviceType: input.serviceType,
      settlementCurrency: input.settlementCurrency.toUpperCase(),
      commissionPercentage: input.commissionPercentage,
      feeCalculationBasis: input.feeCalculationBasis || 'GROSS_INPUT',
      feePayer: input.feePayer || 'ADVERTISER',
      referenceFxPolicy: input.referenceFxPolicy || 'ADMIN_USD_IRT_REFERENCE',
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      offerVersion: 1,
      status: ExchangerOfferStatus.ACTIVE,
      terms: input.terms || null,
    },
  });
}

/**
 * ویرایش پیشنهاد کارمزد صراف (تنها توسط خود صراف با نسخه جدید)
 */
export async function updateExchangerFeeOffer(
  actorId: string,
  offerId: number,
  input: UpdateExchangerOfferInput
) {
  const existing = await prisma.exchangerFeeOffer.findUnique({
    where: { id: offerId },
  });

  if (!existing) {
    throw new Error(`OFFER_NOT_FOUND: Exchanger offer #${offerId} not found`);
  }

  // اعتبارسنجی مالکیت: صراف نمی‌تواند پیشنهاد صراف دیگری را ویرایش کند
  if (actorId !== existing.exchangerId) {
    const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_OFFER_MODIFICATION: Cannot edit another exchanger\'s fee offer');
    }
  }

  if (input.commissionPercentage !== undefined) {
    if (
      typeof input.commissionPercentage !== 'number' ||
      isNaN(input.commissionPercentage) ||
      !isFinite(input.commissionPercentage) ||
      input.commissionPercentage < 0 ||
      input.commissionPercentage >= 1.0
    ) {
      throw new Error(`INVALID_COMMISSION_PERCENTAGE: Rate must be between 0.0 and 0.9999`);
    }
  }

  return await prisma.exchangerFeeOffer.update({
    where: { id: offerId },
    data: {
      commissionPercentage: input.commissionPercentage ?? existing.commissionPercentage,
      minAmount: input.minAmount !== undefined ? input.minAmount : existing.minAmount,
      maxAmount: input.maxAmount !== undefined ? input.maxAmount : existing.maxAmount,
      terms: input.terms !== undefined ? input.terms : existing.terms,
      status: input.status ? input.status : existing.status,
      offerVersion: existing.offerVersion + 1,
    },
  });
}

/**
 * تعلیق یا لغو پیشنهاد توسط مدیریت (Admin Suspend / Revoke)
 */
export async function setExchangerOfferStatus(
  actorId: string,
  offerId: number,
  status: ExchangerOfferStatus,
  reason?: string
) {
  const existing = await prisma.exchangerFeeOffer.findUnique({
    where: { id: offerId },
  });

  if (!existing) {
    throw new Error(`OFFER_NOT_FOUND: Exchanger offer #${offerId} not found`);
  }

  // اگر صراف خودش بخواهد مکث (PAUSED) یا فعال کند مجاز است، اما REVOKED نیاز به دسترسی ادمین دارد
  if (actorId !== existing.exchangerId) {
    const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_OFFER_ACTION: Insufficient administrative permissions to modify offer status');
    }
  }

  return await prisma.exchangerFeeOffer.update({
    where: { id: offerId },
    data: {
      status,
      suspendedReason: reason || null,
      suspendedBy: actorId,
      suspendedAt: status === ExchangerOfferStatus.PAUSED || status === ExchangerOfferStatus.REVOKED ? new Date() : null,
      offerVersion: existing.offerVersion + 1,
    },
  });
}

/**
 * دریافت لیست پیشنهادات فعال بر اساس نوع سرویس
 */
export async function getActiveExchangerOffers(
  serviceType?: ExchangerOfferServiceType | string,
  currency?: string
) {
  return await prisma.exchangerFeeOffer.findMany({
    where: {
      status: ExchangerOfferStatus.ACTIVE,
      serviceType: serviceType || undefined,
      settlementCurrency: currency ? currency.toUpperCase() : undefined,
      exchanger: {
        isActive: true,
      },
    },
    include: {
      exchanger: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
    },
    orderBy: {
      commissionPercentage: 'asc', // نمایش مناسب‌ترین کارمزدها در صدر لیست
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۲. استعلام و پیش‌فاکتور معامله طلا (Gold Trade Quotation)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ایجاد پیش‌فاکتور معامله طلا با بررسی سخت‌گیرانه مرزها و جهت معامله
 * جهت مصوب: ادورتایزر فروشنده است (sellerId) و صراف خریدار است (buyerId).
 */
export async function generateGoldTradeQuote(params: {
  sellerId: string; // Advertiser
  buyerId: string; // Exchanger
  gameSlug: string;
  region?: string;
  realm?: string;
  faction?: string;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  settlementMethod: GoldTradeSettlementMethod | string;
  offerId?: number;
}): Promise<GoldTradeQuoteResult> {
  const { sellerId, buyerId, goldQuantity, agreedValuationUsdCents, settlementMethod, offerId } = params;

  // ۱. بررسی جهت معامله و عدم خودمعاملگی
  if (sellerId === buyerId) {
    throw new Error('CANNOT_SELF_TRADE: Advertiser (seller) and Exchanger (buyer) cannot be the same account');
  }

  if (!Number.isSafeInteger(goldQuantity) || goldQuantity <= 0) {
    throw new Error(`INVALID_GOLD_QUANTITY: Gold quantity must be a positive safe integer, got ${goldQuantity}`);
  }

  if (!Number.isSafeInteger(agreedValuationUsdCents) || agreedValuationUsdCents <= 0) {
    throw new Error(`INVALID_VALUATION: Agreed valuation must be a positive integer USD cents, got ${agreedValuationUsdCents}`);
  }

  // ۲. احراز صلاحیت صراف
  const buyer = await prisma.user.findUnique({
    where: { discordId: buyerId },
    include: { userRoles: true },
  });
  if (!buyer || !buyer.isActive || !buyer.userRoles.some((r) => r.roleKey === 'exchanger' || r.roleKey === 'owner')) {
    throw new Error(`UNAPPROVED_EXCHANGER: Buyer '${buyerId}' is not an active approved exchanger`);
  }

  // ۳. واکشی خط‌مشی کارمزد صراف (اگر offerId ارسال شده باشد)
  let commissionPercentage = 0;
  let feePayer = 'ADVERTISER';
  let acceptedOfferVersion: number | undefined;

  if (offerId) {
    const offer = await prisma.exchangerFeeOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer || offer.status !== ExchangerOfferStatus.ACTIVE || offer.exchangerId !== buyerId) {
      throw new Error(`INVALID_EXCHANGER_OFFER: Offer #${offerId} is not active or does not belong to buyer '${buyerId}'`);
    }
    commissionPercentage = offer.commissionPercentage;
    feePayer = offer.feePayer;
    acceptedOfferVersion = offer.offerVersion;
  }

  // ۴. محاسبه مبالغ قابل پرداخت و تفکیک جریان‌های تسویه
  let referenceFxRate: number | undefined;
  let quotedPayableAmount = '0';
  let quotedPayableCurrency = 'USD';

  if (settlementMethod === GoldTradeSettlementMethod.USDT_DIRECT) {
    // 1:1 USDT Valuation
    quotedPayableCurrency = 'USDT';
    const grossUsdt = agreedValuationUsdCents / 100;
    const netUsdt = feePayer === 'ADVERTISER' ? grossUsdt * (1 - commissionPercentage) : grossUsdt;
    quotedPayableAmount = netUsdt.toFixed(2);
  } else if (settlementMethod === GoldTradeSettlementMethod.IRT_DIRECT) {
    quotedPayableCurrency = 'IRT';
    const fxConfig = await prisma.systemFinancialConfig.findUnique({
      where: { key: 'admin_usd_irt_rate' },
    });
    if (!fxConfig || !Number(fxConfig.value)) {
      throw new Error('MISSING_REFERENCE_FX_RATE: Authorized Admin USD/IRT reference rate is not configured');
    }
    referenceFxRate = Number(fxConfig.value);

    const grossIrt = Math.round((agreedValuationUsdCents / 100) * referenceFxRate);
    const netIrt = feePayer === 'ADVERTISER' ? Math.round(grossIrt * (1 - commissionPercentage)) : grossIrt;
    quotedPayableAmount = netIrt.toString();
  } else if (settlementMethod === GoldTradeSettlementMethod.USD_WALLET) {
    quotedPayableCurrency = 'USD';
    const grossUsdCents = agreedValuationUsdCents;
    const netUsdCents = feePayer === 'ADVERTISER' ? Math.round(grossUsdCents * (1 - commissionPercentage)) : grossUsdCents;
    quotedPayableAmount = (netUsdCents / 100).toFixed(2);
  } else {
    throw new Error(`UNSUPPORTED_SETTLEMENT_METHOD: Settlement method '${settlementMethod}' is not supported`);
  }

  const tradeRef = `TRD_GOLD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 دقیقه انقضا

  const quoteHash = computeGoldTradeQuoteHash({
    tradeRef,
    sellerId,
    buyerId,
    offerId,
    offerVersion: acceptedOfferVersion,
    feePayer,
    gameSlug: params.gameSlug || 'wow_midnight',
    region: params.region || 'EU',
    realm: params.realm,
    faction: params.faction,
    goldQuantity,
    agreedValuationUsdCents,
    settlementMethod,
    commissionPercentage,
    quotedPayableAmount,
    quotedPayableCurrency,
    expiresAt: quoteExpiresAt,
  });

  return {
    tradeRef,
    sellerId,
    buyerId,
    gameSlug: params.gameSlug || 'wow_midnight',
    region: params.region || 'EU',
    realm: params.realm,
    faction: params.faction,
    goldQuantity,
    agreedValuationUsdCents,
    settlementMethod,
    commissionPercentage,
    feePayer,
    referenceFxRate,
    quotedPayableAmount,
    quotedPayableCurrency,
    acceptedOfferId: offerId,
    offerVersion: acceptedOfferVersion,
    quoteHash,
    quoteExpiresAt,
  };
}

/**
 * ثبت رکورد پیش‌نویس معامله طلا بر اساس پیش‌فاکتور مصوب
 * امنیت حیاتی: اعتبارسنجی قطعی امضای HMAC و وضعیت صراف پیش از درج هرگونه رکورد در پایگاه داده
 */
export async function createGoldTradeOrder(quote: GoldTradeQuoteResult) {
  // ۱. اعتبارسنجی وجود کلید اختصاصی امضا (Fail-Closed)
  getExchangeQuoteSigningSecret();

  // ۲. اعتبارسنجی انقضای پیش‌فاکتور
  if (quote.quoteExpiresAt && new Date() > new Date(quote.quoteExpiresAt)) {
    throw new Error('QUOTE_EXPIRED: Gold trade quote has expired. Please request a fresh quote');
  }

  // ۳. اعتبارسنجی زمان‌ثابت امضای رمزنگاری‌شده (HMAC-SHA256 Anti-Tamper Verification)
  const isValidSignature = verifyGoldTradeQuoteHash(
    {
      tradeRef: quote.tradeRef,
      sellerId: quote.sellerId,
      buyerId: quote.buyerId,
      offerId: quote.acceptedOfferId,
      offerVersion: quote.offerVersion,
      feePayer: quote.feePayer,
      gameSlug: quote.gameSlug,
      region: quote.region,
      realm: quote.realm,
      faction: quote.faction,
      goldQuantity: quote.goldQuantity,
      agreedValuationUsdCents: quote.agreedValuationUsdCents,
      settlementMethod: quote.settlementMethod,
      commissionPercentage: quote.commissionPercentage || 0,
      quotedPayableAmount: quote.quotedPayableAmount || '',
      quotedPayableCurrency: quote.quotedPayableCurrency || '',
      expiresAt: new Date(quote.quoteExpiresAt),
    },
    quote.quoteHash
  );

  if (!isValidSignature) {
    throw new Error('QUOTE_TAMPERED: Gold trade quote fields do not match cryptographic hash');
  }

  // ۴. منع خودمعامله‌گری (Self-Trading Prevention)
  if (quote.sellerId === quote.buyerId) {
    throw new Error('CANNOT_TRADE_WITH_SELF: Seller and buyer cannot be the same account');
  }

  // ۵. جلوگیری از بازپخش و مبادله چندباره یک پیش‌فاکتور (Anti-Replay & Safe Idempotent Retry)
  const existingTrade = await prisma.goldTrade.findUnique({
    where: { tradeRef: quote.tradeRef },
  });
  if (existingTrade) {
    if (existingTrade.sellerId !== quote.sellerId) {
      throw new Error('CROSS_USER_QUOTE_REPLAY: Gold trade was created by another seller');
    }

    const matchesPersisted =
      existingTrade.buyerId === quote.buyerId &&
      existingTrade.gameSlug === quote.gameSlug &&
      (existingTrade.region || '') === (quote.region || '') &&
      (existingTrade.realm || '') === (quote.realm || '') &&
      (existingTrade.faction || '') === (quote.faction || '') &&
      existingTrade.goldQuantity === quote.goldQuantity &&
      existingTrade.agreedValuationUsdCents === quote.agreedValuationUsdCents &&
      existingTrade.settlementMethod === quote.settlementMethod &&
      Math.abs((existingTrade.commissionPercentage ?? 0) - (quote.commissionPercentage || 0)) < 0.0001 &&
      existingTrade.feePayer === quote.feePayer &&
      (existingTrade.quotedPayableAmount || '') === (quote.quotedPayableAmount || '') &&
      (existingTrade.quotedPayableCurrency || '') === (quote.quotedPayableCurrency || '') &&
      (existingTrade.acceptedOfferId || null) === (quote.acceptedOfferId || null) &&
      (existingTrade.acceptedOfferVersion || null) === (quote.offerVersion || null) &&
      existingTrade.quoteHash === quote.quoteHash;

    if (!matchesPersisted) {
      throw new Error('QUOTE_MISMATCH: Supplied quote terms do not match original persisted trade');
    }

    return existingTrade;
  }

  // ۶. بررسی صلاحیت و فعال بودن صراف خریدار
  await assertApprovedExchanger(quote.buyerId);

  // ۷. بررسی صلاحیت و سازگاری نسخه آفر
  if (quote.acceptedOfferId) {
    const offer = await prisma.exchangerFeeOffer.findUnique({
      where: { id: quote.acceptedOfferId },
    });
    if (!offer || offer.status !== ExchangerOfferStatus.ACTIVE || offer.exchangerId !== quote.buyerId) {
      throw new Error(`INVALID_EXCHANGER_OFFER: Offer #${quote.acceptedOfferId} is not active or does not belong to buyer '${quote.buyerId}'`);
    }
    if (quote.offerVersion !== undefined && offer.offerVersion !== quote.offerVersion) {
      throw new Error(`OFFER_VERSION_MISMATCH: Offer #${quote.acceptedOfferId} version mismatch (expected ${offer.offerVersion}, got ${quote.offerVersion})`);
    }
  }

  // ۸. ایجاد رکورد معامله در وضعیت مجاز اولیه
  return await prisma.goldTrade.create({
    data: {
      tradeRef: quote.tradeRef,
      sellerId: quote.sellerId,
      buyerId: quote.buyerId,
      gameSlug: quote.gameSlug,
      region: quote.region,
      realm: quote.realm || null,
      faction: quote.faction || null,
      goldQuantity: quote.goldQuantity,
      goldUnit: 'RAW_GOLD',
      agreedValuationUsdCents: quote.agreedValuationUsdCents,
      settlementMethod: quote.settlementMethod,
      commissionPercentage: quote.commissionPercentage,
      feePayer: quote.feePayer,
      referenceFxRate: quote.referenceFxRate || null,
      quotedPayableAmount: quote.quotedPayableAmount,
      quotedPayableCurrency: quote.quotedPayableCurrency,
      acceptedOfferId: quote.acceptedOfferId || null,
      acceptedOfferVersion: quote.offerVersion || null,
      quoteExpiresAt: quote.quoteExpiresAt,
      quoteHash: quote.quoteHash,
      goldDeliveryStatus: GoldDeliveryStatus.PENDING,
      paymentStatus: GoldPaymentStatus.PENDING,
      tradeStatus: GoldTradeStatus.QUOTED,
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۳. پذیرش معامله و تفکیک جریان‌های A و B
// ═════════════════════════════════════════════════════════════════════════════

/**
 * پذیرش معامله طلا و رزرو موجودی در صورت انتخاب روش کیف‌پول پیش‌شارژشده
 * استفاده از به‌روزرسانی شرطی اتمیک (Atomic Conditional CAS) برای کیف‌پول و وضعیت معامله
 */
export async function acceptGoldTrade(tradeId: number, actorId: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  // اعتبارسنجی مجاز بودن طرفین
  if (actorId !== trade.sellerId && actorId !== trade.buyerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_ACTOR: Only seller or buyer may accept the trade');
    }
  }

  // اعتبارسنجی انقضا
  if (trade.quoteExpiresAt && new Date() > trade.quoteExpiresAt) {
    throw new Error('QUOTE_EXPIRED: Gold trade quote has expired. Please request a fresh quote');
  }

  // اعتبارسنجی تمامیت هش HMAC
  const isValid = verifyGoldTradeQuoteHash(
    {
      tradeRef: trade.tradeRef,
      sellerId: trade.sellerId,
      buyerId: trade.buyerId,
      offerId: trade.acceptedOfferId,
      offerVersion: trade.acceptedOfferVersion,
      feePayer: trade.feePayer,
      gameSlug: trade.gameSlug,
      region: trade.region,
      realm: trade.realm || undefined,
      faction: trade.faction || undefined,
      goldQuantity: trade.goldQuantity,
      agreedValuationUsdCents: trade.agreedValuationUsdCents,
      settlementMethod: trade.settlementMethod,
      commissionPercentage: trade.commissionPercentage || 0,
      quotedPayableAmount: trade.quotedPayableAmount || '',
      quotedPayableCurrency: trade.quotedPayableCurrency || '',
      expiresAt: trade.quoteExpiresAt!,
    },
    trade.quoteHash || ''
  );

  if (!isValid) {
    throw new Error('QUOTE_TAMPERED: Gold trade quote fields do not match cryptographic hash');
  }

  // بازیابی بدون تعهد مجدد در صورت فراخوانی مکرر و حفظ وضعیت‌های معتبر (Safe Idempotency & Terminal State Preservation)
  if (
    trade.tradeStatus === GoldTradeStatus.FUNDS_RESERVED ||
    trade.tradeStatus === GoldTradeStatus.ACCEPTED ||
    trade.tradeStatus === GoldTradeStatus.GOLD_DELIVERED ||
    trade.tradeStatus === GoldTradeStatus.READY_TO_SETTLE ||
    trade.tradeStatus === GoldTradeStatus.SETTLED
  ) {
    return trade;
  }

  if (trade.tradeStatus === GoldTradeStatus.CANCELLED) {
    throw new Error('CANNOT_ACCEPT_CANCELLED_TRADE: Trade has been cancelled and cannot be accepted');
  }

  if (trade.tradeStatus === GoldTradeStatus.DISPUTED) {
    throw new Error('CANNOT_ACCEPT_DISPUTED_TRADE: Trade is currently disputed and cannot be accepted');
  }

  if (trade.tradeStatus !== GoldTradeStatus.QUOTED && trade.tradeStatus !== GoldTradeStatus.DRAFT) {
    throw new Error(`INVALID_TRADE_STATUS: Trade is in status '${trade.tradeStatus}', expected QUOTED`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // اگر روش تسویه با کیف‌پول دلاری صراف باشد (WORKFLOW B):
  // موجودی دلاری مورد نیاز به صورت اتمیک و شرطی از کیف‌پول صراف رزرو می‌گردد!
  // ─────────────────────────────────────────────────────────────────────────
  if (trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET) {
    return await prisma.$transaction(async (tx) => {
      const reservationId = trade.walletReservationId || `RES_GOLD_${trade.id}_${trade.tradeRef}`;

      // ۱. گذار شرطی پایگاه داده برای جلوگیری از پذیرش همزمان یک معامله (Atomic CAS on GoldTrade)
      const tradeUpdate = await tx.goldTrade.updateMany({
        where: {
          id: tradeId,
          tradeStatus: { in: [GoldTradeStatus.QUOTED, GoldTradeStatus.DRAFT] },
        },
        data: {
          tradeStatus: GoldTradeStatus.FUNDS_RESERVED,
          walletReservationId: reservationId,
        },
      });

      if (tradeUpdate.count !== 1) {
        const freshTrade = await tx.goldTrade.findUnique({ where: { id: tradeId } });
        if (freshTrade?.tradeStatus === GoldTradeStatus.FUNDS_RESERVED && freshTrade.walletReservationId) {
          return freshTrade;
        }
        throw new Error(`INVALID_TRADE_STATUS: Trade is in status '${freshTrade?.tradeStatus}', expected QUOTED`);
      }

      // ۲. رزرو اتمیک و شرطی موجودی از availableCents به reservedCents در یک دستور updateMany
      const walletRes = await tx.walletV2.updateMany({
        where: {
          userId: trade.buyerId,
          availableCents: { gte: trade.agreedValuationUsdCents },
        },
        data: {
          availableCents: { decrement: trade.agreedValuationUsdCents },
          reservedCents: { increment: trade.agreedValuationUsdCents },
        },
      });

      if (walletRes.count !== 1) {
        throw new Error(
          `INSUFFICIENT_EXCHANGER_BALANCE: Exchanger has insufficient available balance for trade #${tradeId}`
        );
      }

      const updatedBuyerWallet = await tx.walletV2.findUniqueOrThrow({
        where: { userId: trade.buyerId },
      });

      assertWalletInvariants(updatedBuyerWallet);

      // ۳. ثبت سند دفتر کل جهت رزرو وجه با کلید یکتا و ارجاع دقیق
      await tx.ledgerEntryV2.create({
        data: {
          entryRef: `LEDGER_RES_${trade.tradeRef}`,
          postingGroupId: reservationId,
          accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
          userId: trade.buyerId,
          goldTradeId: trade.id,
          amountCents: trade.agreedValuationUsdCents,
          entryType: LedgerV2EntryType.GOLD_TRADE_RESERVE,
          direction: LedgerV2Direction.DEBIT,
          balanceAfterAvailableCents: updatedBuyerWallet.availableCents,
          balanceAfterReservedCents: updatedBuyerWallet.reservedCents,
          idempotencyKey: `RES_${trade.tradeRef}`,
          description: `Reserved ${trade.agreedValuationUsdCents} cents for Gold trade #${trade.id}`,
          createdBy: actorId,
        },
      });

      return await tx.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // اگر روش تسویه مستقیم برون‌سیستمی باشد (WORKFLOW A: IRT_DIRECT یا USDT_DIRECT):
  // تغییر وضعیت شرطی به ACCEPTED بدون دستکاری کیف‌پول پلتفرم
  // ─────────────────────────────────────────────────────────────────────────
  const directTradeUpdate = await prisma.goldTrade.updateMany({
    where: {
      id: tradeId,
      tradeStatus: { in: [GoldTradeStatus.QUOTED, GoldTradeStatus.DRAFT] },
    },
    data: {
      tradeStatus: GoldTradeStatus.ACCEPTED,
    },
  });

  if (directTradeUpdate.count !== 1) {
    const freshTrade = await prisma.goldTrade.findUnique({ where: { id: tradeId } });
    if (freshTrade?.tradeStatus === GoldTradeStatus.ACCEPTED) {
      return freshTrade;
    }
    throw new Error(`INVALID_TRADE_STATUS: Trade is in status '${freshTrade?.tradeStatus}', expected QUOTED`);
  }

  return await prisma.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۴. مراحل تحویل طلا درون‌بازی و تایید شواهد
// ═════════════════════════════════════════════════════════════════════════════

/**
 * گزارش تحویل طلا درون‌بازی توسط فروشنده (Advertiser)
 */
export async function reportGoldDelivery(
  tradeId: number,
  actorId: string,
  deliveryEvidenceRef: string
) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  if (actorId !== trade.sellerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_SELLER: Only seller may report gold delivery');
    }
  }

  if (
    trade.tradeStatus !== GoldTradeStatus.ACCEPTED &&
    trade.tradeStatus !== GoldTradeStatus.FUNDS_RESERVED
  ) {
    throw new Error(`INVALID_TRADE_STATUS: Cannot report delivery in status '${trade.tradeStatus}'`);
  }

  if (!deliveryEvidenceRef || deliveryEvidenceRef.trim().length < 6) {
    throw new Error('INVALID_DELIVERY_EVIDENCE: Valid delivery evidence reference is required');
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      goldDeliveryStatus: GoldDeliveryStatus.DELIVERED,
      tradeStatus: GoldTradeStatus.GOLD_DELIVERED,
      deliveryEvidenceRef: deliveryEvidenceRef.trim(),
      deliveryReportedAt: new Date(),
    },
  });
}

/**
 * تایید مستقل تحویل طلا توسط صراف (خریدار) یا ناظر استاف
 */
export async function verifyGoldDelivery(tradeId: number, verifierId: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  // خریدار (صراف) یا استاف مجاز به تایید دریافت طلا هستند
  if (verifierId !== trade.buyerId) {
    const auth = await authorize(verifierId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_VERIFIER: Only buyer or authorized staff may verify gold delivery');
    }
  }

  if (trade.goldDeliveryStatus !== GoldDeliveryStatus.DELIVERED) {
    throw new Error(`INVALID_DELIVERY_STATUS: Cannot verify delivery in status '${trade.goldDeliveryStatus}'`);
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      goldDeliveryStatus: GoldDeliveryStatus.VERIFIED,
      deliveryVerifiedBy: verifierId,
      deliveryVerifiedAt: new Date(),
      tradeStatus:
        trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET
          ? GoldTradeStatus.READY_TO_SETTLE
          : trade.tradeStatus,
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۵. مراحل پرداخت مستقیم برون‌سیستمی (WORKFLOW A: IRT / USDT Direct)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ثبت شواهد پرداخت خارجی توسط صراف (خریدار)
 */
export async function submitExternalTradePayment(
  tradeId: number,
  actorId: string,
  paymentRef: string,
  paymentMethod: string,
  amount: string
) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  if (actorId !== trade.buyerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_BUYER: Only buyer may submit external payment evidence');
    }
  }

  if (trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET) {
    throw new Error('INVALID_PAYMENT_ROUTE: External payment cannot be submitted for prepaid USD wallet trades');
  }

  if (!paymentRef || paymentRef.trim().length < 4) {
    throw new Error('INVALID_PAYMENT_REF: Valid payment reference is required');
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      paymentStatus: GoldPaymentStatus.SUBMITTED,
      externalPaymentRef: paymentRef.trim(),
      externalPaymentMethod: paymentMethod,
      externalPaymentAmount: amount,
      paymentSubmittedAt: new Date(),
      tradeStatus: GoldTradeStatus.PAYMENT_PENDING,
    },
  });
}

/**
 * تایید دریافت وجه برون‌سیستمی توسط فروشنده طلا (Advertiser Confirm Receipt)
 */
export async function confirmExternalPaymentReceipt(tradeId: number, actorId: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  // تنها فروشنده (ادورتایزر) یا مدیریت می‌تواند دریافت پول در حساب بانکی/تتری خود را تایید کند
  if (actorId !== trade.sellerId) {
    const auth = await authorize(actorId, Permission.ORDER_PAYMENT_VERIFY);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_CONFIRMATION: Only the selling advertiser or staff may confirm payment receipt');
    }
  }

  if (trade.paymentStatus !== GoldPaymentStatus.SUBMITTED && trade.paymentStatus !== GoldPaymentStatus.VERIFIED) {
    throw new Error(`INVALID_PAYMENT_STATUS: Payment is in status '${trade.paymentStatus}', expected SUBMITTED`);
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      paymentStatus: GoldPaymentStatus.CONFIRMED,
      advertiserConfirmedReceiptAt: new Date(),
      tradeStatus:
        trade.goldDeliveryStatus === GoldDeliveryStatus.VERIFIED
          ? GoldTradeStatus.READY_TO_SETTLE
          : trade.tradeStatus,
    },
  });
}

/**
 * تسویه نهایی معامله مستقیم برون‌سیستمی (WORKFLOW A: Direct Settlement Outside G4X)
 * اصل حیاتی: هیچ وجهی به کیف‌پول ادورتایزر واریز نمی‌شود و از کیف‌پول صراف کسر نمی‌گردد!
 */
export async function settleDirectGoldTrade(tradeId: number, actorId: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  if (
    trade.settlementMethod !== GoldTradeSettlementMethod.IRT_DIRECT &&
    trade.settlementMethod !== GoldTradeSettlementMethod.USDT_DIRECT
  ) {
    throw new Error(`INVALID_WORKFLOW: settleDirectGoldTrade only applies to direct external settlements`);
  }

  if (trade.tradeStatus === GoldTradeStatus.SETTLED) {
    throw new Error('ALREADY_SETTLED: Gold trade is already marked as settled');
  }

  if (trade.goldDeliveryStatus !== GoldDeliveryStatus.VERIFIED) {
    throw new Error(`GOLD_NOT_VERIFIED: In-game gold delivery is not verified (status: ${trade.goldDeliveryStatus})`);
  }

  if (
    trade.paymentStatus !== GoldPaymentStatus.CONFIRMED &&
    trade.paymentStatus !== GoldPaymentStatus.VERIFIED
  ) {
    throw new Error(`PAYMENT_NOT_CONFIRMED: External payment has not been confirmed or verified`);
  }

  if (trade.tradeStatus === GoldTradeStatus.DISPUTED) {
    throw new Error('TRADE_DISPUTED: Disputed trades cannot be settled without formal dispute resolution');
  }

  const settlementRef = `SETTLE_DIR_${trade.tradeRef}_${Date.now()}`;

  // گذار شرطی پایگاه داده برای جلوگیری از تسویه یا لغو همزمان
  const updateRes = await prisma.goldTrade.updateMany({
    where: {
      id: tradeId,
      tradeStatus: { notIn: [GoldTradeStatus.SETTLED, GoldTradeStatus.CANCELLED, GoldTradeStatus.DISPUTED] },
      goldDeliveryStatus: GoldDeliveryStatus.VERIFIED,
      paymentStatus: { in: [GoldPaymentStatus.CONFIRMED, GoldPaymentStatus.VERIFIED] },
    },
    data: {
      tradeStatus: GoldTradeStatus.SETTLED,
      actualSettlementRef: settlementRef,
      settledAt: new Date(),
      settledBy: actorId,
    },
  });

  if (updateRes.count !== 1) {
    const fresh = await prisma.goldTrade.findUnique({ where: { id: tradeId } });
    if (fresh?.tradeStatus === GoldTradeStatus.SETTLED) {
      throw new Error('ALREADY_SETTLED: Gold trade is already marked as settled');
    }
    throw new Error(`CONCURRENT_STATE_CONFLICT: Trade #${tradeId} could not be settled due to state conflict`);
  }

  return await prisma.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۶. تسویه معامله طلا با کیف‌پول دلاری صراف (WORKFLOW B: Prepaid USD Wallet)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * تسویه اتمیک انتقال تعهد دلاری از صراف به ادورتایزر با تراز دوبل دفتر کل
 */
export async function settlePrepaidWalletGoldTrade(tradeId: number, actorId: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: Gold trade #${tradeId} not found`);
  }

  if (trade.settlementMethod !== GoldTradeSettlementMethod.USD_WALLET) {
    throw new Error('INVALID_WORKFLOW: settlePrepaidWalletGoldTrade only applies to USD_WALLET settlements');
  }

  if (trade.tradeStatus === GoldTradeStatus.SETTLED) {
    throw new Error('ALREADY_SETTLED: Trade is already settled');
  }

  if (trade.goldDeliveryStatus !== GoldDeliveryStatus.VERIFIED) {
    throw new Error(`GOLD_NOT_VERIFIED: Gold delivery must be verified before settling wallet funds`);
  }

  if (trade.tradeStatus === GoldTradeStatus.DISPUTED) {
    throw new Error('TRADE_DISPUTED: Disputed trades cannot be settled without formal dispute resolution');
  }

  // منع خودتاییدی تسویه توسط خود صراف (خریدار)
  if (actorId === trade.buyerId) {
    const auth = await authorize(actorId, Permission.FINANCE_ADJUST);
    if (!auth.allowed) {
      throw new Error('CANNOT_SELF_SETTLE: Exchanger buyer cannot self-approve final wallet settlement');
    }
  }

  const postingGroupId = `POST_GOLD_${trade.tradeRef}`;
  const idempotencyKey = `SETTLE_GOLD_TRADE_${trade.id}_${trade.tradeRef}`;

  return await prisma.$transaction(async (tx) => {
    // ۱. گذار شرطی وضعیت معامله از FUNDS_RESERVED به SETTLED
    const updateRes = await tx.goldTrade.updateMany({
      where: {
        id: tradeId,
        tradeStatus: { in: [GoldTradeStatus.READY_TO_SETTLE, GoldTradeStatus.FUNDS_RESERVED, GoldTradeStatus.ACCEPTED] },
        goldDeliveryStatus: GoldDeliveryStatus.VERIFIED,
      },
      data: {
        tradeStatus: GoldTradeStatus.SETTLED,
        actualSettlementRef: postingGroupId,
        settledAt: new Date(),
        settledBy: actorId,
      },
    });

    if (updateRes.count !== 1) {
      const fresh = await tx.goldTrade.findUnique({ where: { id: tradeId } });
      if (fresh?.tradeStatus === GoldTradeStatus.SETTLED) {
        throw new Error('ALREADY_SETTLED: Trade is already settled');
      }
      throw new Error(`CONCURRENT_STATE_CONFLICT: Trade #${tradeId} could not be settled due to state conflict`);
    }

    // ۲. کسر اتمیک و شرطی از موجودی رزروشده صراف
    const buyerWalletUpdate = await tx.walletV2.updateMany({
      where: {
        userId: trade.buyerId,
        reservedCents: { gte: trade.agreedValuationUsdCents },
      },
      data: {
        reservedCents: { decrement: trade.agreedValuationUsdCents },
      },
    });

    if (buyerWalletUpdate.count !== 1) {
      throw new Error(
        `INSUFFICIENT_RESERVED_BALANCE: Exchanger has insufficient reserved balance to settle trade #${tradeId}`
      );
    }

    // ۳. افزودن اتمیک به موجودی قابل استفاده ادورتایزر
    await getOrCreateWalletV2(trade.sellerId, tx);
    const sellerWalletUpdate = await tx.walletV2.updateMany({
      where: { userId: trade.sellerId },
      data: {
        availableCents: { increment: trade.agreedValuationUsdCents },
      },
    });

    if (sellerWalletUpdate.count !== 1) {
      throw new Error(`SELLER_WALLET_UPDATE_FAILED: Could not credit advertiser wallet`);
    }

    const updatedBuyer = await tx.walletV2.findUniqueOrThrow({ where: { userId: trade.buyerId } });
    const updatedSeller = await tx.walletV2.findUniqueOrThrow({ where: { userId: trade.sellerId } });

    assertWalletInvariants(updatedBuyer);
    assertWalletInvariants(updatedSeller);

    // ۴. ثبت سند متوازن دفتر کل (Double-Entry Balanced Journal Posting)
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        idempotencyKey,
        legs: [
          {
            userId: trade.buyerId,
            amountCents: trade.agreedValuationUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
            entryType: LedgerV2EntryType.GOLD_TRADE_SETTLE,
            goldTradeId: trade.id,
            description: `Exchanger settled ${trade.agreedValuationUsdCents} cents for Gold trade #${trade.id}`,
            createdBy: actorId,
          },
          {
            userId: trade.sellerId,
            amountCents: trade.agreedValuationUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.GOLD_TRADE_SETTLE,
            goldTradeId: trade.id,
            description: `Advertiser received ${trade.agreedValuationUsdCents} cents for Gold trade #${trade.id}`,
            createdBy: actorId,
          },
        ],
      },
      tx
    );

    return await tx.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
  });
}

/**
 * لغو امن معامله طلا و آزادسازی رزروهای صراف در صورت عدم اجرا
 * گذار شرطی اتمیک و منع اکید استرداد مضاعف (Double Refund Prevention)
 */
export async function cancelGoldTrade(tradeId: number, actorId: string, reason?: string) {
  const trade = await prisma.goldTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) throw new Error(`TRADE_NOT_FOUND`);

  if (trade.tradeStatus === GoldTradeStatus.SETTLED) {
    throw new Error('CANNOT_CANCEL_SETTLED_TRADE: Already settled trades cannot be cancelled');
  }

  // بررسی دسترسی
  if (actorId !== trade.sellerId && actorId !== trade.buyerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) throw new Error('UNAUTHORIZED_ACTOR');
  }

  // اگر وجهی در روش کیف‌پول رزرو شده باشد
  if (
    trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET &&
    trade.walletReservationId
  ) {
    return await prisma.$transaction(async (tx) => {
      // ۱. انتقال شرطی وضعیت برای جلوگیری از لغو مضاعف یا مسابقه با تسویه
      const cancelRes = await tx.goldTrade.updateMany({
        where: {
          id: tradeId,
          tradeStatus: { notIn: [GoldTradeStatus.SETTLED, GoldTradeStatus.CANCELLED] },
        },
        data: {
          tradeStatus: GoldTradeStatus.CANCELLED,
          cancellationReason: reason || 'Cancelled by user/admin',
          cancelledBy: actorId,
          cancelledAt: new Date(),
        },
      });

      if (cancelRes.count !== 1) {
        const fresh = await tx.goldTrade.findUnique({ where: { id: tradeId } });
        if (fresh?.tradeStatus === GoldTradeStatus.CANCELLED) {
          return fresh; // idempotent
        }
        throw new Error(`CANNOT_CANCEL_TRADE: Trade #${tradeId} is in status '${fresh?.tradeStatus}' and cannot be cancelled`);
      }

      // ۲. آزادسازی اتمیک و شرطی موجودی از reservedCents به availableCents صراف
      const unresUpdate = await tx.walletV2.updateMany({
        where: {
          userId: trade.buyerId,
          reservedCents: { gte: trade.agreedValuationUsdCents },
        },
        data: {
          reservedCents: { decrement: trade.agreedValuationUsdCents },
          availableCents: { increment: trade.agreedValuationUsdCents },
        },
      });

      if (unresUpdate.count !== 1) {
        throw new Error(
          `FAILED_TO_UNRESERVE: Exchanger does not have enough reserved cents to release for trade #${tradeId}`
        );
      }

      const updatedBuyer = await tx.walletV2.findUniqueOrThrow({ where: { userId: trade.buyerId } });
      assertWalletInvariants(updatedBuyer);

      // ۳. ثبت سند دفتر کل جهت آزادسازی وجه رزرو شده
      await tx.ledgerEntryV2.create({
        data: {
          entryRef: `LEDGER_UNRES_${trade.tradeRef}`,
          postingGroupId: `UNRES_${trade.tradeRef}`,
          accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
          userId: trade.buyerId,
          goldTradeId: trade.id,
          amountCents: trade.agreedValuationUsdCents,
          entryType: LedgerV2EntryType.GOLD_TRADE_UNRESERVE,
          direction: LedgerV2Direction.CREDIT,
          balanceAfterAvailableCents: updatedBuyer.availableCents,
          balanceAfterReservedCents: updatedBuyer.reservedCents,
          idempotencyKey: `UNRES_${trade.tradeRef}`,
          description: `Unreserved ${trade.agreedValuationUsdCents} cents due to cancelled trade #${trade.id}`,
          createdBy: actorId,
        },
      });

      return await tx.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
    });
  }

  // در سایر روش‌های تسویه یا بدون رزرو کیف‌پول
  const cancelRes = await prisma.goldTrade.updateMany({
    where: {
      id: tradeId,
      tradeStatus: { notIn: [GoldTradeStatus.SETTLED, GoldTradeStatus.CANCELLED] },
    },
    data: {
      tradeStatus: GoldTradeStatus.CANCELLED,
      cancellationReason: reason || 'Cancelled by user/admin',
      cancelledBy: actorId,
      cancelledAt: new Date(),
    },
  });

  if (cancelRes.count !== 1) {
    const fresh = await prisma.goldTrade.findUnique({ where: { id: tradeId } });
    if (fresh?.tradeStatus === GoldTradeStatus.CANCELLED) return fresh;
    throw new Error(`CANNOT_CANCEL_TRADE: Trade #${tradeId} is in status '${fresh?.tradeStatus}' and cannot be cancelled`);
  }

  return await prisma.goldTrade.findUniqueOrThrow({ where: { id: tradeId } });
}

/**
 * اعلام اختلاف در معامله (Dispute Gold Trade)
 */
export async function disputeGoldTrade(tradeId: number, actorId: string, reason: string) {
  const trade = await prisma.goldTrade.findUnique({ where: { id: tradeId } });
  if (!trade) throw new Error(`TRADE_NOT_FOUND`);

  if (trade.tradeStatus === GoldTradeStatus.SETTLED) {
    throw new Error('CANNOT_DISPUTE_SETTLED_TRADE: Already settled trades must be handled via support ticket');
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      tradeStatus: GoldTradeStatus.DISPUTED,
      disputeReason: reason,
      disputedBy: actorId,
      disputedAt: new Date(),
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ۷. شارژ همتا‌به‌همتا (WORKFLOW C: Advertiser IRT-to-USD P2P Funding)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * استعلام شارژ کیف‌پول ادورتایزر از طریق صراف (P2P IRT-to-USD Funding Quote)
 * بر اساس پیشنهادهای منتشرشده خود صراف و نرخ مرجع مدیریت
 */
export async function generateP2pFundingQuote(params: {
  advertiserId: string;
  exchangerId: string;
  offerId: number;
  targetUsdCents: number;
}) {
  getExchangeQuoteSigningSecret();

  const { advertiserId, exchangerId, offerId, targetUsdCents } = params;

  if (advertiserId === exchangerId) {
    throw new Error('CANNOT_SELF_FUND: Advertiser and Exchanger cannot be the same account');
  }

  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error(`INVALID_TARGET_AMOUNT: Target USD cents must be a positive safe integer`);
  }

  // بررسی صلاحیت صراف
  await assertApprovedExchanger(exchangerId);

  // ۱. واکشی پیشنهاد صراف
  const offer = await prisma.exchangerFeeOffer.findUnique({
    where: { id: offerId },
  });

  if (!offer || offer.status !== ExchangerOfferStatus.ACTIVE || offer.exchangerId !== exchangerId) {
    throw new Error(`INVALID_OFFER: Offer #${offerId} is not active or does not belong to exchanger '${exchangerId}'`);
  }

  if (offer.serviceType !== ExchangerOfferServiceType.IRT_TO_USD_FUNDING) {
    throw new Error(`INVALID_SERVICE_TYPE: Offer #${offerId} is not an IRT_TO_USD_FUNDING service`);
  }

  // ۲. واکشی نرخ مرجع دلار/تومان مدیریت
  const fxConfig = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'admin_usd_irt_rate' },
  });
  if (!fxConfig || !Number(fxConfig.value)) {
    throw new Error('MISSING_REFERENCE_FX_RATE: Authorized Admin USD/IRT reference rate is not configured');
  }
  const referenceRate = Number(fxConfig.value);

  // ۳. محاسبه تومان پایه و کارمزد مشخص صراف
  const baseIrt = Math.round((targetUsdCents / 100) * referenceRate);
  const commissionIrt = Math.round(baseIrt * offer.commissionPercentage);
  const totalIrtPayable = baseIrt + commissionIrt;

  const quoteRef = `QUOTE_P2P_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const quoteSignature = computeP2pFundingQuoteHash({
    quoteRef,
    advertiserId,
    exchangerId,
    offerId: offer.id,
    offerVersion: offer.offerVersion,
    targetUsdCents,
    referenceRate,
    commissionPercentage: offer.commissionPercentage,
    baseIrt,
    commissionIrt,
    totalIrtPayable,
    expiresAt,
  });

  return {
    quoteRef,
    advertiserId,
    exchangerId,
    offerId: offer.id,
    offerVersion: offer.offerVersion,
    targetUsdCents,
    referenceRate,
    commissionPercentage: offer.commissionPercentage,
    baseIrt,
    commissionIrt,
    totalIrtPayable,
    expiresAt,
    quoteSignature,
    quoteHash: quoteSignature,
  };
}

/**
 * اعتبارسنجی مشترک و یکپارچه برای پیش‌فاکتور شارژ P2P در رکوردهای موجود
 * تضمین پردازش دقیقاً یک‌باره و اعمال اعتبارسنجی یکسان در هر دو شاخه عادی و بازیابی P2002
 */
export function validateExistingP2pFundingRequest(
  existing: AdvertiserFundingRequest,
  quote: {
    quoteRef?: string;
    advertiserId: string;
    exchangerId: string;
    offerId: number;
    offerVersion?: number;
    targetUsdCents: number;
    totalIrtPayable: number;
    referenceRate: number;
    commissionPercentage: number;
  }
): AdvertiserFundingRequest {
  // ۱. بررسی یکتایی ارجاع پیش‌فاکتور (Quote Reference)
  if (quote.quoteRef && existing.quoteRef && existing.quoteRef !== quote.quoteRef) {
    throw new Error('QUOTE_CONFLICT: Quote reference does not match existing record');
  }

  // ۲. بررسی هویت تبلیغ‌دهنده (منع اکید بازپخش توسط کاربر دیگر)
  if (existing.advertiserId !== quote.advertiserId) {
    throw new Error('CROSS_USER_QUOTE_REPLAY: Quote was issued to another advertiser');
  }

  // ۳. بررسی متد و ارز
  if (existing.fundingMethod !== 'IRT_P2P' || existing.externalCurrency !== 'IRT') {
    throw new Error('QUOTE_CONFLICT: Funding method or currency does not match original request');
  }

  // ۴. بررسی شرایط اقتصادی، نرخ‌ها و مبالغ
  const amountsMatch =
    existing.targetUsdCents === quote.targetUsdCents &&
    existing.externalAmountUnits === quote.totalIrtPayable.toString();

  const ratesMatch =
    Math.abs((existing.exchangeRate ?? 0) - quote.referenceRate) < 0.0001 &&
    Math.abs((existing.currencyPurchaseFeeRate ?? 0) - quote.commissionPercentage) < 0.0001;

  // ۵. بررسی صراف و آفر مرتبط
  const adminNotes = existing.adminNotes || '';
  const exchangerMatch = adminNotes.includes(`Exchanger ${quote.exchangerId}`);
  const offerMatch = adminNotes.includes(`Offer #${quote.offerId}`);

  if (!amountsMatch || !ratesMatch || !exchangerMatch || !offerMatch) {
    throw new Error('QUOTE_CONFLICT: Quote terms do not match original request');
  }

  // ۶. اعتبارسنجی وضعیت: رد اکید وضعیت‌های ترمینال و تسویه‌شده (Terminal / Consumed States)
  if (existing.status === 'CONFIRMED_CREDITED') {
    throw new Error('QUOTE_ALREADY_CONSUMED: P2P funding quote has already been settled and credited');
  }

  if (existing.status === 'CANCELLED' || existing.status === 'REJECTED') {
    throw new Error(`QUOTE_ALREADY_CONSUMED: P2P funding quote is in terminal status '${existing.status}'`);
  }

  const SAFE_RECOVERY_STATUSES = ['AWAITING_PAYMENT', 'PENDING_PAYMENT_SUBMISSION', 'PENDING_ADMIN_VERIFICATION'];
  if (!SAFE_RECOVERY_STATUSES.includes(existing.status)) {
    throw new Error(`QUOTE_ALREADY_CONSUMED: P2P funding quote is in non-recoverable status '${existing.status}'`);
  }

  return existing;
}

/**
 * پذیرش درخواست شارژ P2P و رزرو موجودی دلار از کیف‌پول صراف
 * اصل حیاتی: واریز تومان به صراف مجوز خلق دلار اعتباری نیست؛ صراف باید موجودی واقعی داشته و رزرو گردد!
 */
export async function acceptP2pFundingRequest(
  actorId: string,
  quote: {
    quoteRef?: string;
    advertiserId: string;
    exchangerId: string;
    offerId: number;
    offerVersion?: number;
    targetUsdCents: number;
    totalIrtPayable: number;
    referenceRate: number;
    commissionPercentage: number;
    baseIrt?: number;
    commissionIrt?: number;
    expiresAt?: Date | string;
    quoteSignature?: string;
    quoteHash?: string;
  }
) {
  // ۱. اعتبارسنجی کلید امضا
  getExchangeQuoteSigningSecret();

  if (actorId !== quote.advertiserId && actorId !== quote.exchangerId) {
    const auth = await authorize(actorId, Permission.PROOF_REVIEW);
    if (!auth.allowed) {
      throw new Error('UNAUTHORIZED_ACTOR: Only participating advertiser or exchanger may initiate funding');
    }
  }

  // ۲. منع خودتامین‌کنندگی
  if (quote.advertiserId === quote.exchangerId) {
    throw new Error('CANNOT_SELF_FUND: Advertiser and Exchanger cannot be the same account');
  }

  // ۳. اعتبارسنجی انقضا
  if (quote.expiresAt && new Date() > new Date(quote.expiresAt)) {
    throw new Error('QUOTE_EXPIRED: P2P funding quote has expired. Please request a fresh quote');
  }

  // ۴. اعتبارسنجی امضای رمزنگاری‌شده HMAC
  const signatureToVerify = quote.quoteSignature || quote.quoteHash;
  if (!signatureToVerify || !quote.quoteRef) {
    throw new Error('QUOTE_TAMPERED: P2P funding quote signature or reference is missing');
  }

  const isValidSignature = verifyP2pFundingQuoteHash(
    {
      quoteRef: quote.quoteRef,
      advertiserId: quote.advertiserId,
      exchangerId: quote.exchangerId,
      offerId: quote.offerId,
      offerVersion: quote.offerVersion || 1,
      targetUsdCents: quote.targetUsdCents,
      referenceRate: quote.referenceRate,
      commissionPercentage: quote.commissionPercentage,
      baseIrt: quote.baseIrt || Math.round((quote.targetUsdCents / 100) * quote.referenceRate),
      commissionIrt: quote.commissionIrt || Math.round((quote.baseIrt || ((quote.targetUsdCents / 100) * quote.referenceRate)) * quote.commissionPercentage),
      totalIrtPayable: quote.totalIrtPayable,
      expiresAt: quote.expiresAt ? new Date(quote.expiresAt) : new Date(),
    },
    signatureToVerify
  );

  if (!isValidSignature) {
    throw new Error('QUOTE_TAMPERED: P2P funding quote fields do not match cryptographic HMAC signature');
  }

  // ۵. بررسی صلاحیت صراف در دیتابیس
  await assertApprovedExchanger(quote.exchangerId);

  // ۶. بررسی وضعیت پیشنهاد صراف و تطابق نسخه
  const offer = await prisma.exchangerFeeOffer.findUnique({
    where: { id: quote.offerId },
  });
  if (!offer || offer.status !== ExchangerOfferStatus.ACTIVE || offer.exchangerId !== quote.exchangerId) {
    throw new Error(`INVALID_OFFER: Offer #${quote.offerId} is not active or does not belong to exchanger '${quote.exchangerId}'`);
  }
  if (quote.offerVersion !== undefined && offer.offerVersion !== quote.offerVersion) {
    throw new Error(`OFFER_VERSION_MISMATCH: Offer #${quote.offerId} version mismatch`);
  }

  // ۷. ثبت یا بازیابی درخواست شارژ به صورت اتمیک و یکتا در پایگاه داده (Durable Atomic Quote Consumption & Idempotency)
  try {
    return await prisma.$transaction(async (tx) => {
      // ۱. بررسی یکتایی بر اساس ستون اختصاصی و ایندکس‌شده quoteRef
      const existing = await tx.advertiserFundingRequest.findFirst({
        where: { quoteRef: quote.quoteRef },
      });

      if (existing) {
        return validateExistingP2pFundingRequest(existing, quote);
      }

      // ۲. رزرو اتمیک و شرطی موجودی دلار صراف با updateMany
      const walletRes = await tx.walletV2.updateMany({
        where: {
          userId: quote.exchangerId,
          availableCents: { gte: quote.targetUsdCents },
        },
        data: {
          availableCents: { decrement: quote.targetUsdCents },
          reservedCents: { increment: quote.targetUsdCents },
        },
      });

      if (walletRes.count !== 1) {
        throw new Error(
          `INSUFFICIENT_EXCHANGER_USD_BACKING: Exchanger has insufficient available USD backing to fulfill funding request`
        );
      }

      const updatedWallet = await tx.walletV2.findUniqueOrThrow({
        where: { userId: quote.exchangerId },
      });
      assertWalletInvariants(updatedWallet);

      const fundingRef = `FUND_P2P_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // ۳. ثبت رکورد درخواست شارژ با ارجاع صریح به پیش‌فاکتور یکتا و صراف
      const fundingRequest = await tx.advertiserFundingRequest.create({
        data: {
          fundingRef,
          quoteRef: quote.quoteRef,
          advertiserId: quote.advertiserId,
          fundingMethod: 'IRT_P2P',
          status: 'AWAITING_PAYMENT',
          targetUsdCents: quote.targetUsdCents,
          externalCurrency: 'IRT',
          externalAmountUnits: quote.totalIrtPayable.toString(),
          exchangeRate: quote.referenceRate,
          currencyPurchaseFeeRate: quote.commissionPercentage,
          feeAmountUnits: quote.referenceRate ? (quote.totalIrtPayable - (quote.targetUsdCents / 100) * quote.referenceRate).toString() : null,
          adminNotes: `P2P funding through Exchanger ${quote.exchangerId} (Offer #${quote.offerId}) [QuoteRef: ${quote.quoteRef}]`,
        },
      });

      // ۴. ثبت دفتر کل رزرو
      await tx.ledgerEntryV2.create({
        data: {
          entryRef: `LEDGER_P2P_RES_${fundingRef}`,
          postingGroupId: `RES_P2P_${fundingRequest.id}`,
          accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
          userId: quote.exchangerId,
          fundingRequestId: fundingRequest.id,
          amountCents: quote.targetUsdCents,
          entryType: LedgerV2EntryType.P2P_FUNDING_RESERVE,
          direction: LedgerV2Direction.DEBIT,
          balanceAfterAvailableCents: updatedWallet.availableCents,
          balanceAfterReservedCents: updatedWallet.reservedCents,
          idempotencyKey: `P2P_RES_${fundingRequest.id}`,
          description: `Reserved ${quote.targetUsdCents} cents from Exchanger for P2P funding #${fundingRequest.id}`,
          createdBy: actorId,
        },
      });

      return fundingRequest;
    });
  } catch (err: any) {
    // در صورت وقوع مسابقه همزمانی در تراکنش موازی (P2002 Unique Constraint Race)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.advertiserFundingRequest.findFirst({
        where: { quoteRef: quote.quoteRef },
      });
      if (existing) {
        return validateExistingP2pFundingRequest(existing, quote);
      }
    }
    throw err;
  }
}

/**
 * تسویه نهایی شارژ P2P پس از تایید واریز تومان به صراف
 * انتقال اتمیک تعهد از کیف‌پول صراف به کیف‌پول ادورتایزر (تحت گیت محافظتی)
 */
export async function settleP2pFunding(
  fundingRequestId: number,
  actorId: string,
  paymentReceiptRef: string
) {
  // بررسی گیت محافظتی پیش‌فرض پروداکشن (Fail-Closed)
  assertP2pSettlementEnabled();

  const funding = await prisma.advertiserFundingRequest.findUnique({
    where: { id: fundingRequestId },
  });

  if (!funding) throw new Error(`FUNDING_NOT_FOUND`);

  if (funding.status === 'CONFIRMED_CREDITED') {
    throw new Error('ALREADY_SETTLED: Funding request is already settled');
  }

  // استخراج شناسه صراف از یادداشت یا رکورد مرتبط
  const match = funding.adminNotes?.match(/Exchanger ([a-zA-Z0-9_-]+)/);
  if (!match || !match[1]) {
    throw new Error('INVALID_P2P_METADATA: Associated exchanger could not be determined');
  }
  const exchangerId = match[1];

  const postingGroupId = `POST_P2P_${funding.fundingRef}`;
  const idempotencyKey = `SETTLE_P2P_${funding.id}`;

  return await prisma.$transaction(async (tx) => {
    // ۱. گذار شرطی وضعیت درخواست شارژ برای جلوگیری از تسویه تکراری
    const updateRes = await tx.advertiserFundingRequest.updateMany({
      where: {
        id: fundingRequestId,
        status: { in: ['AWAITING_PAYMENT', 'PENDING_PAYMENT', 'PENDING_REVIEW'] },
      },
      data: {
        status: 'CONFIRMED_CREDITED',
        evidenceRef: paymentReceiptRef,
        verifiedBy: actorId,
        verifiedAt: new Date(),
        creditedAt: new Date(),
      },
    });

    if (updateRes.count !== 1) {
      const fresh = await tx.advertiserFundingRequest.findUnique({ where: { id: fundingRequestId } });
      if (fresh?.status === 'CONFIRMED_CREDITED') {
        throw new Error('ALREADY_SETTLED: Funding request is already settled');
      }
      throw new Error(`CONCURRENT_STATE_CONFLICT: Funding request cannot be settled in status '${fresh?.status}'`);
    }

    // ۲. کسر اتمیک و شرطی از موجودی رزروشده صراف
    const exchRes = await tx.walletV2.updateMany({
      where: {
        userId: exchangerId,
        reservedCents: { gte: funding.targetUsdCents },
      },
      data: {
        reservedCents: { decrement: funding.targetUsdCents },
      },
    });

    if (exchRes.count !== 1) {
      throw new Error(
        `INSUFFICIENT_EXCHANGER_RESERVED: Exchanger has insufficient reserved cents to complete P2P settlement`
      );
    }

    // ۳. افزایش موجودی در دسترس ادورتایزر
    await getOrCreateWalletV2(funding.advertiserId, tx);
    const advRes = await tx.walletV2.updateMany({
      where: { userId: funding.advertiserId },
      data: {
        availableCents: { increment: funding.targetUsdCents },
      },
    });

    if (advRes.count !== 1) {
      throw new Error(`ADVERTISER_WALLET_UPDATE_FAILED: Could not credit advertiser wallet`);
    }

    const updatedExchanger = await tx.walletV2.findUniqueOrThrow({ where: { userId: exchangerId } });
    const updatedAdvertiser = await tx.walletV2.findUniqueOrThrow({ where: { userId: funding.advertiserId } });

    assertWalletInvariants(updatedExchanger);
    assertWalletInvariants(updatedAdvertiser);

    // ۴. ثبت سند دوطرفه متعادل دفتر کل
    await recordBalancedJournalPosting(
      {
        postingGroupId,
        idempotencyKey,
        legs: [
          {
            userId: exchangerId,
            amountCents: funding.targetUsdCents,
            direction: LedgerV2Direction.DEBIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
            entryType: LedgerV2EntryType.P2P_FUNDING_SETTLE,
            fundingRequestId: funding.id,
            description: `Transferred ${funding.targetUsdCents} cents from Exchanger to Advertiser for P2P funding #${funding.id}`,
            createdBy: actorId,
          },
          {
            userId: funding.advertiserId,
            amountCents: funding.targetUsdCents,
            direction: LedgerV2Direction.CREDIT,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.P2P_FUNDING_SETTLE,
            fundingRequestId: funding.id,
            description: `Credited ${funding.targetUsdCents} cents to Advertiser for P2P funding #${funding.id}`,
            createdBy: actorId,
          },
        ],
      },
      tx
    );

    return await tx.advertiserFundingRequest.findUniqueOrThrow({ where: { id: fundingRequestId } });
  });
}
