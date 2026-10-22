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
import { Prisma } from '@prisma/client';
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
 * تولید هش ضد‌دستکاری (Anti-Tamper Hash) برای پیش‌فاکتور معامله طلا
 */
export function computeGoldTradeQuoteHash(data: {
  tradeRef: string;
  sellerId: string;
  buyerId: string;
  goldQuantity: number;
  agreedValuationUsdCents: number;
  settlementMethod: string;
  commissionPercentage: number;
  quotedPayableAmount: string;
  quotedPayableCurrency: string;
  expiresAt: Date;
}): string {
  const payload = [
    data.tradeRef,
    data.sellerId,
    data.buyerId,
    data.goldQuantity.toString(),
    data.agreedValuationUsdCents.toString(),
    data.settlementMethod,
    data.commissionPercentage.toFixed(4),
    data.quotedPayableAmount,
    data.quotedPayableCurrency,
    data.expiresAt.toISOString(),
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
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
 */
export async function createGoldTradeOrder(quote: GoldTradeQuoteResult) {
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

  if (trade.tradeStatus !== GoldTradeStatus.QUOTED && trade.tradeStatus !== GoldTradeStatus.DRAFT) {
    throw new Error(`INVALID_TRADE_STATUS: Trade is in status '${trade.tradeStatus}', expected QUOTED`);
  }

  // اعتبارسنجی انقضا
  if (trade.quoteExpiresAt && new Date() > trade.quoteExpiresAt) {
    throw new Error('QUOTE_EXPIRED: Gold trade quote has expired. Please request a fresh quote');
  }

  // اعتبارسنجی تمامیت هش
  const expectedHash = computeGoldTradeQuoteHash({
    tradeRef: trade.tradeRef,
    sellerId: trade.sellerId,
    buyerId: trade.buyerId,
    goldQuantity: trade.goldQuantity,
    agreedValuationUsdCents: trade.agreedValuationUsdCents,
    settlementMethod: trade.settlementMethod,
    commissionPercentage: trade.commissionPercentage || 0,
    quotedPayableAmount: trade.quotedPayableAmount || '',
    quotedPayableCurrency: trade.quotedPayableCurrency || '',
    expiresAt: trade.quoteExpiresAt!,
  });

  if (trade.quoteHash !== expectedHash) {
    throw new Error('QUOTE_TAMPERED: Gold trade quote fields do not match cryptographic hash');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // اگر روش تسویه با کیف‌پول دلاری صراف باشد (WORKFLOW B):
  // موجودی دلاری مورد نیاز باید حتماً از کیف‌پول صراف رزرو گردد!
  // ─────────────────────────────────────────────────────────────────────────
  if (trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET) {
    return await prisma.$transaction(async (tx) => {
      const buyerWallet = await tx.walletV2.findUnique({
        where: { userId: trade.buyerId },
      });

      if (!buyerWallet) {
        throw new Error(`EXCHANGER_WALLET_NOT_FOUND: Exchanger '${trade.buyerId}' does not have a WalletV2`);
      }

      if (buyerWallet.availableCents < trade.agreedValuationUsdCents) {
        throw new Error(
          `INSUFFICIENT_EXCHANGER_BALANCE: Exchanger has ${buyerWallet.availableCents} cents available, but trade requires ${trade.agreedValuationUsdCents} cents`
        );
      }

      // ۱. رزرو ترنزاکشنال مبالغ از available به reserved در والت صراف
      const newAvailable = buyerWallet.availableCents - trade.agreedValuationUsdCents;
      const newReserved = buyerWallet.reservedCents + trade.agreedValuationUsdCents;

      const updatedBuyerWallet = await tx.walletV2.update({
        where: { userId: trade.buyerId },
        data: {
          availableCents: newAvailable,
          reservedCents: newReserved,
        },
      });

      assertWalletInvariants(updatedBuyerWallet);

      const reservationId = `RES_GOLD_${trade.id}_${Date.now()}`;

      // ۲. ثبت دفتر کل جهت رزرو
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
          balanceAfterAvailableCents: newAvailable,
          balanceAfterReservedCents: newReserved,
          idempotencyKey: `RES_${trade.tradeRef}`,
          description: `Reserved ${trade.agreedValuationUsdCents} cents for Gold trade #${trade.id}`,
          createdBy: actorId,
        },
      });

      return await tx.goldTrade.update({
        where: { id: tradeId },
        data: {
          tradeStatus: GoldTradeStatus.FUNDS_RESERVED,
          walletReservationId: reservationId,
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // اگر روش تسویه مستقیم برون‌سیستمی باشد (WORKFLOW A: IRT_DIRECT یا USDT_DIRECT):
  // وضعیت به ACCEPTED می‌رود و هیچ پولی در کیف‌پول پلتفرم دستکاری نمی‌شود!
  // ─────────────────────────────────────────────────────────────────────────
  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      tradeStatus: GoldTradeStatus.ACCEPTED,
    },
  });
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

  // ثبت وضعیت بدون دستکاری در کیف‌پول‌های پلتفرم
  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      tradeStatus: GoldTradeStatus.SETTLED,
      actualSettlementRef: settlementRef,
      settledAt: new Date(),
      settledBy: actorId,
    },
  });
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
    const buyerWallet = await tx.walletV2.findUnique({ where: { userId: trade.buyerId } });
    const sellerWallet = await getOrCreateWalletV2(trade.sellerId, tx);

    if (!buyerWallet) throw new Error(`EXCHANGER_WALLET_NOT_FOUND`);

    if (buyerWallet.reservedCents < trade.agreedValuationUsdCents) {
      throw new Error(
        `INSUFFICIENT_RESERVED_BALANCE: Exchanger has ${buyerWallet.reservedCents} cents reserved, needed ${trade.agreedValuationUsdCents}`
      );
    }

    // ۱. کسر از reserved صراف و افزودن به available ادورتایزر
    const newBuyerReserved = buyerWallet.reservedCents - trade.agreedValuationUsdCents;
    const newSellerAvailable = sellerWallet.availableCents + trade.agreedValuationUsdCents;

    const updatedBuyer = await tx.walletV2.update({
      where: { userId: trade.buyerId },
      data: { reservedCents: newBuyerReserved },
    });
    const updatedSeller = await tx.walletV2.update({
      where: { userId: trade.sellerId },
      data: { availableCents: newSellerAvailable },
    });

    assertWalletInvariants(updatedBuyer);
    assertWalletInvariants(updatedSeller);

    // ۲. ثبت سند متوازن دفتر کل (Double-Entry Balanced Journal Posting):
    // بدهکار: تعهد کیف‌پول صراف (کاهش تعهد پلتفرم به صراف)
    // بستانکار: تعهد کیف‌پول ادورتایزر (افزایش تعهد پلتفرم به ادورتایزر)
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

    return await tx.goldTrade.update({
      where: { id: tradeId },
      data: {
        tradeStatus: GoldTradeStatus.SETTLED,
        actualSettlementRef: postingGroupId,
        settledAt: new Date(),
        settledBy: actorId,
      },
    });
  });
}

/**
 * لغو امن معامله طلا و آزادسازی رزروهای صراف در صورت عدم اجرا
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

  // اگر وجهی رزرو شده باشد و معامله هنوز تسویه نشده باشد، وجه به موجودی صراف بازمی‌گردد
  if (
    trade.settlementMethod === GoldTradeSettlementMethod.USD_WALLET &&
    trade.walletReservationId &&
    trade.tradeStatus !== GoldTradeStatus.SETTLED
  ) {
    return await prisma.$transaction(async (tx) => {
      const buyerWallet = await tx.walletV2.findUnique({ where: { userId: trade.buyerId } });
      if (buyerWallet && buyerWallet.reservedCents >= trade.agreedValuationUsdCents) {
        const newAvailable = buyerWallet.availableCents + trade.agreedValuationUsdCents;
        const newReserved = buyerWallet.reservedCents - trade.agreedValuationUsdCents;

        await tx.walletV2.update({
          where: { userId: trade.buyerId },
          data: {
            availableCents: newAvailable,
            reservedCents: newReserved,
          },
        });

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
            balanceAfterAvailableCents: newAvailable,
            balanceAfterReservedCents: newReserved,
            description: `Unreserved ${trade.agreedValuationUsdCents} cents due to cancelled trade #${trade.id}`,
            createdBy: actorId,
          },
        });
      }

      return await tx.goldTrade.update({
        where: { id: tradeId },
        data: {
          tradeStatus: GoldTradeStatus.CANCELLED,
          cancellationReason: reason || 'Cancelled by user/admin',
          cancelledBy: actorId,
          cancelledAt: new Date(),
        },
      });
    });
  }

  return await prisma.goldTrade.update({
    where: { id: tradeId },
    data: {
      tradeStatus: GoldTradeStatus.CANCELLED,
      cancellationReason: reason || 'Cancelled by user/admin',
      cancelledBy: actorId,
      cancelledAt: new Date(),
    },
  });
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
  const { advertiserId, exchangerId, offerId, targetUsdCents } = params;

  if (advertiserId === exchangerId) {
    throw new Error('CANNOT_SELF_FUND: Advertiser and Exchanger cannot be the same account');
  }

  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error(`INVALID_TARGET_AMOUNT: Target USD cents must be a positive safe integer`);
  }

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
  };
}

/**
 * پذیرش درخواست شارژ P2P و رزرو موجودی دلار از کیف‌پول صراف
 * اصل حیاتی: واریز تومان به صراف مجوز خلق دلار اعتباری نیست؛ صراف باید موجودی واقعی داشته و رزرو گردد!
 */
export async function acceptP2pFundingRequest(
  actorId: string,
  quote: {
    advertiserId: string;
    exchangerId: string;
    offerId: number;
    targetUsdCents: number;
    totalIrtPayable: number;
    referenceRate: number;
    commissionPercentage: number;
  }
) {
  if (actorId !== quote.advertiserId && actorId !== quote.exchangerId) {
    throw new Error('UNAUTHORIZED_ACTOR: Only participating advertiser or exchanger may initiate funding');
  }

  return await prisma.$transaction(async (tx) => {
    // ۱. بررسی کفایت موجودی دلاری واقعی صراف
    const exchangerWallet = await tx.walletV2.findUnique({
      where: { userId: quote.exchangerId },
    });

    if (!exchangerWallet) {
      throw new Error(`EXCHANGER_WALLET_NOT_FOUND: Exchanger '${quote.exchangerId}' has no WalletV2`);
    }

    if (exchangerWallet.availableCents < quote.targetUsdCents) {
      throw new Error(
        `INSUFFICIENT_EXCHANGER_USD_BACKING: Exchanger has ${exchangerWallet.availableCents} cents available, but funding requires ${quote.targetUsdCents} cents`
      );
    }

    // ۲. رزرو اتمیک موجودی صراف
    const newAvailable = exchangerWallet.availableCents - quote.targetUsdCents;
    const newReserved = exchangerWallet.reservedCents + quote.targetUsdCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId: quote.exchangerId },
      data: {
        availableCents: newAvailable,
        reservedCents: newReserved,
      },
    });

    assertWalletInvariants(updatedWallet);

    const fundingRef = `FUND_P2P_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // ۳. ثبت رکورد درخواست شارژ
    const fundingRequest = await tx.advertiserFundingRequest.create({
      data: {
        fundingRef,
        advertiserId: quote.advertiserId,
        fundingMethod: 'IRT_P2P',
        status: 'AWAITING_PAYMENT',
        targetUsdCents: quote.targetUsdCents,
        externalCurrency: 'IRT',
        externalAmountUnits: quote.totalIrtPayable.toString(),
        exchangeRate: quote.referenceRate,
        currencyPurchaseFeeRate: quote.commissionPercentage,
        feeAmountUnits: quote.referenceRate ? (quote.totalIrtPayable - (quote.targetUsdCents / 100) * quote.referenceRate).toString() : null,
        adminNotes: `P2P funding through Exchanger ${quote.exchangerId} (Offer #${quote.offerId})`,
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
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: newReserved,
        idempotencyKey: `P2P_RES_${fundingRequest.id}`,
        description: `Reserved ${quote.targetUsdCents} cents from Exchanger for P2P funding #${fundingRequest.id}`,
        createdBy: actorId,
      },
    });

    return fundingRequest;
  });
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
    const exchangerWallet = await tx.walletV2.findUnique({ where: { userId: exchangerId } });
    const advertiserWallet = await getOrCreateWalletV2(funding.advertiserId, tx);

    if (!exchangerWallet) throw new Error(`EXCHANGER_WALLET_NOT_FOUND`);

    if (exchangerWallet.reservedCents < funding.targetUsdCents) {
      throw new Error(
        `INSUFFICIENT_EXCHANGER_RESERVED: Exchanger has ${exchangerWallet.reservedCents} cents reserved, needed ${funding.targetUsdCents}`
      );
    }

    const newExchangerReserved = exchangerWallet.reservedCents - funding.targetUsdCents;
    const newAdvertiserAvailable = advertiserWallet.availableCents + funding.targetUsdCents;

    const updatedExchanger = await tx.walletV2.update({
      where: { userId: exchangerId },
      data: { reservedCents: newExchangerReserved },
    });
    const updatedAdvertiser = await tx.walletV2.update({
      where: { userId: funding.advertiserId },
      data: { availableCents: newAdvertiserAvailable },
    });

    assertWalletInvariants(updatedExchanger);
    assertWalletInvariants(updatedAdvertiser);

    // ثبت سند دوطرفه متعادل
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

    return await tx.advertiserFundingRequest.update({
      where: { id: fundingRequestId },
      data: {
        status: 'CONFIRMED_CREDITED',
        evidenceRef: paymentReceiptRef,
        verifiedBy: actorId,
        verifiedAt: new Date(),
        creditedAt: new Date(),
      },
    });
  });
}
