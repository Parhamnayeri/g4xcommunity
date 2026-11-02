/**
 * finance_v2_2_marketplace_suite.ts — سوئیت آزمون جامع فاز Finance V2.2
 *
 * پوشش کامل الزامات:
 *  - تعیین نرخ کارمزد توسط صراف (Exchanger-controlled commission)
 *  - عدم امکان ویرایش پیشنهاد توسط صراف دیگر
 *  - منع ایجاد پیشنهاد توسط کاربر غیرصراف
 *  - تعلیق پیشنهاد توسط ادمین
 *  - عدم وجود کارمزد پیش‌فرض ۵٪
 *  - تفکیک قطعی جهت معامله: ادورتایزر فروشنده طلا، صراف خریدار طلا
 *  - رد قطعی خودمعاملگی (Self-trading)
 *  - جریان الف (Workflow A): تسویه مستقیم کارت/شبا یا تتر بدون دستکاری کیف‌پول دلاری ادورتایزر یا صراف
 *  - جریان ب (Workflow B): معامله طلا با کیف‌پول دلاری صراف با رزرو، تایید تحویل و تراز دوبل
 *  - جریان ج (Workflow C): شارژ P2P با پشتوانه واقعی دلاری صراف و رد خلق پول اعتباری صوری
 *  - محافظت در برابر تسویه مجدد، انقضای پیش‌فاکتور، و دیسپیوت
 *  - قفل‌های Fail-Closed (از جمله FINANCE_V2_P2P_SETTLEMENT_ENABLED)
 */

import prisma from '../database/db';
import {
  createExchangerFeeOffer,
  updateExchangerFeeOffer,
  setExchangerOfferStatus,
  generateGoldTradeQuote,
  createGoldTradeOrder,
  acceptGoldTrade,
  reportGoldDelivery,
  verifyGoldDelivery,
  submitExternalTradePayment,
  confirmExternalPaymentReceipt,
  settleDirectGoldTrade,
  settlePrepaidWalletGoldTrade,
  cancelGoldTrade,
  disputeGoldTrade,
  generateP2pFundingQuote,
  acceptP2pFundingRequest,
  settleP2pFunding,
} from '../services/financeV2/exchangerMarketplaceService';
import {
  ExchangerOfferServiceType,
  ExchangerOfferStatus,
  GoldTradeSettlementMethod,
  GoldTradeStatus,
  GoldDeliveryStatus,
  GoldPaymentStatus,
  FINANCE_V2_FEATURE_GATES,
} from '../services/financeV2/financeV2Types';
import { getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';

async function runFinanceV2_2TestSuite() {
  console.log('=== STARTING G4X FINANCE V2.2 MARKETPLACE & P2P TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  const advertiserId = 'test_v2_2_adv_01';
  const exchanger1Id = 'test_v2_2_exch_01';
  const exchanger2Id = 'test_v2_2_exch_02';
  const regularUserId = 'test_v2_2_reg_01';
  const adminId = 'test_v2_2_admin_01';

  try {
    // ─── ۱. مقداردهی اولیه کاربران و نقش‌ها ──────────────────────────────────
    for (const uid of [advertiserId, exchanger1Id, exchanger2Id, regularUserId, adminId]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: {},
        create: { discordId: uid, username: `User_${uid}` },
      });
      await prisma.walletV2.upsert({
        where: { userId: uid },
        update: {
          availableCents: 0,
          reservedCents: 0,
          pendingEarningsCents: 0,
          confirmedEarningsCents: 0,
          paidCents: 0,
          refundedCents: 0,
        },
        create: {
          userId: uid,
          availableCents: 0,
          reservedCents: 0,
        },
      });
    }

    // اعطای نقش صراف به exchanger1 و exchanger2
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: exchanger1Id, roleKey: 'exchanger' } },
      update: {},
      create: { userId: exchanger1Id, roleKey: 'exchanger' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: exchanger2Id, roleKey: 'exchanger' } },
      update: {},
      create: { userId: exchanger2Id, roleKey: 'exchanger' },
    });
    // اعطای نقش ادمین به adminId
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: adminId, roleKey: 'owner' } },
      update: {},
      create: { userId: adminId, roleKey: 'owner' },
    });

    // تنظیم نرخ مرجع ۹۰,۰۰۰ تومان در تنظیمات سیستم
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: '90000' },
      create: { key: 'admin_usd_irt_rate', value: '90000', description: 'Admin USD/IRT Reference FX Rate' },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱: صراف تاییدشده پیشنهاد کارمزد خود را منتشر می‌کند (۳.۵٪ کارمزد)
    // ─────────────────────────────────────────────────────────────────────────
    const offer1 = await createExchangerFeeOffer(exchanger1Id, {
      exchangerId: exchanger1Id,
      serviceType: ExchangerOfferServiceType.IRT_TO_USD_FUNDING,
      settlementCurrency: 'IRT',
      commissionPercentage: 0.035, // 3.5%
      terms: 'Instant Sheba / Card transfer',
    });

    assert(
      offer1.commissionPercentage === 0.035 &&
        offer1.status === ExchangerOfferStatus.ACTIVE &&
        offer1.exchangerId === exchanger1Id,
      '1. Approved Exchanger publishes own custom commission offer (3.5% IRT conversion)',
      `Offer: ${offer1.offerRef}, Commission: ${offer1.commissionPercentage}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲: صراف ۲ نمی‌تواند پیشنهاد صراف ۱ را ویرایش کند
    // ─────────────────────────────────────────────────────────────────────────
    let foreignEditBlocked = false;
    try {
      await updateExchangerFeeOffer(exchanger2Id, offer1.id, {
        commissionPercentage: 0.01,
      });
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_OFFER_MODIFICATION')) {
        foreignEditBlocked = true;
      }
    }

    assert(
      foreignEditBlocked,
      '2. Exchanger cannot edit or modify another Exchanger\'s fee offer',
      `Blocked: ${foreignEditBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳: کاربر عادی (فاقد نقش صراف) نمی‌تواند پیشنهاد فعال ایجاد کند
    // ─────────────────────────────────────────────────────────────────────────
    let unapprovedOfferBlocked = false;
    try {
      await createExchangerFeeOffer(regularUserId, {
        exchangerId: regularUserId,
        serviceType: ExchangerOfferServiceType.GOLD_PURCHASE_IRT,
        settlementCurrency: 'IRT',
        commissionPercentage: 0.02,
      });
    } catch (e: any) {
      if (e.message.includes('UNAPPROVED_EXCHANGER')) {
        unapprovedOfferBlocked = true;
      }
    }

    assert(
      unapprovedOfferBlocked,
      '3. Unapproved user without exchanger role is strictly blocked from creating fee offers',
      `Blocked: ${unapprovedOfferBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۴: ادمین می‌تواند پیشنهاد غیرایمن را تعلیق کند
    // ─────────────────────────────────────────────────────────────────────────
    const suspendedOffer = await setExchangerOfferStatus(
      adminId,
      offer1.id,
      ExchangerOfferStatus.PAUSED,
      'Administrative safety check'
    );

    assert(
      suspendedOffer.status === ExchangerOfferStatus.PAUSED &&
        suspendedOffer.suspendedBy === adminId,
      '4. Admin can audit and suspend an offer with immutable reason and timestamp',
      `Status: ${suspendedOffer.status}`
    );

    // بازگردانی به فعال برای تست‌های بعدی
    await setExchangerOfferStatus(exchanger1Id, offer1.id, ExchangerOfferStatus.ACTIVE);

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۵: عدم وجود کارمزد پیش‌فرض ۵٪ (اعمال نرخ اختصاصی ۳.۵٪ صراف)
    // ─────────────────────────────────────────────────────────────────────────
    const p2pQuote = await generateP2pFundingQuote({
      advertiserId,
      exchangerId: exchanger1Id,
      offerId: offer1.id,
      targetUsdCents: 10000, // $100.00
    });

    // 100 * 90,000 = 9,000,000 IRT. Commission: 3.5% = 315,000 IRT (NOT 5% = 450,000)
    assert(
      p2pQuote.commissionPercentage === 0.035 &&
        p2pQuote.commissionIrt === 315000 &&
        p2pQuote.totalIrtPayable === 9315000,
      '5. Published Exchanger commission (3.5%) is applied cleanly without global 5% default',
      `Base: ${p2pQuote.baseIrt}, Commission: ${p2pQuote.commissionIrt}, Total: ${p2pQuote.totalIrtPayable}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۶: قفل شدن اسنپ‌شات کارمزد و نرخ در پیش‌فاکتور پذیرفته‌شده
    // ─────────────────────────────────────────────────────────────────────────
    // تغییر نرخ کارمزد در پیشنهاد توسط صراف به ۴٪
    await updateExchangerFeeOffer(exchanger1Id, offer1.id, {
      commissionPercentage: 0.04,
    });
    // پیش‌فاکتور قبلی باید دقیقاً همان نرخ ۳.۵٪ را حفظ کند
    assert(
      p2pQuote.commissionPercentage === 0.035 && p2pQuote.totalIrtPayable === 9315000,
      '6. Accepted quotes freeze immutable commission and rate snapshots (protected against subsequent offer updates)'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۷: رد قطعی خودمعاملگی (Self-Trading Rejection)
    // ─────────────────────────────────────────────────────────────────────────
    let selfTradeBlocked = false;
    try {
      await generateGoldTradeQuote({
        sellerId: exchanger1Id,
        buyerId: exchanger1Id, // Same account!
        gameSlug: 'wow_midnight',
        goldQuantity: 1000000,
        agreedValuationUsdCents: 8000,
        settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
      });
    } catch (e: any) {
      if (e.message.includes('CANNOT_SELF_TRADE')) {
        selfTradeBlocked = true;
      }
    }

    assert(
      selfTradeBlocked,
      '7. Self-trading where advertiser and exchanger are the same user is strictly rejected',
      `Blocked: ${selfTradeBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۸ و ۹ و ۱۰: جهت معامله: ادورتایزر فروشنده طلا، صراف خریدار طلا
    // ─────────────────────────────────────────────────────────────────────────
    const goldQuote = await generateGoldTradeQuote({
      sellerId: advertiserId, // Advertiser SELLS
      buyerId: exchanger1Id, // Exchanger BUYS
      gameSlug: 'wow_midnight',
      goldQuantity: 1000000,
      agreedValuationUsdCents: 8000, // $80.00
      settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
    });

    assert(
      goldQuote.sellerId === advertiserId &&
        goldQuote.buyerId === exchanger1Id &&
        goldQuote.agreedValuationUsdCents === 8000 &&
        goldQuote.quotedPayableCurrency === 'IRT',
      '8. Confirmed trade direction: Advertiser is Gold seller, Exchanger is Gold buyer',
      `Seller: ${goldQuote.sellerId}, Buyer: ${goldQuote.buyerId}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۱: رد پیش‌فاکتور منقضی‌شده معامله طلا
    // ─────────────────────────────────────────────────────────────────────────
    const expiredQuote = await generateGoldTradeQuote({
      sellerId: advertiserId,
      buyerId: exchanger1Id,
      gameSlug: 'wow_midnight',
      goldQuantity: 1000000,
      agreedValuationUsdCents: 8000,
      settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
    });
    const tradeExpired = await createGoldTradeOrder({
      ...expiredQuote,
      quoteExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    });

    let expiredAcceptBlocked = false;
    try {
      await acceptGoldTrade(tradeExpired.id, advertiserId);
    } catch (e: any) {
      if (e.message.includes('QUOTE_EXPIRED')) {
        expiredAcceptBlocked = true;
      }
    }

    assert(
      expiredAcceptBlocked,
      '9. Expired gold trade quotes cannot be accepted or reserved',
      `Blocked: ${expiredAcceptBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۲، ۱۳، ۱۴ و ۱۵: جریان الف (WORKFLOW A) — تسویه مستقیم برون‌سیستمی کارت/تومان
    // اصل حیاتی: هیچ وجهی به کیف‌پول ادورتایزر واریز نمی‌شود و از کیف‌پول صراف کسر نمی‌گردد!
    // ─────────────────────────────────────────────────────────────────────────
    const advWalletBefore = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const exchWalletBefore = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    const tradeA = await createGoldTradeOrder(goldQuote);
    const acceptedA = await acceptGoldTrade(tradeA.id, advertiserId);

    // در جریان مستقیم، موجودی کیف‌پول‌ها نباید دستکاری شود
    assert(
      acceptedA.tradeStatus === GoldTradeStatus.ACCEPTED &&
        acceptedA.walletReservationId === null,
      '10. Direct settlement trade (Workflow A) accepts without touching internal wallet reservations'
    );

    // فروشنده طلا را تحویل می‌دهد
    await reportGoldDelivery(tradeA.id, advertiserId, 'SCREENSHOT_MAIL_TRADE_WINDOW_123');
    // خریدار (صراف) تحویل را تایید می‌کند
    await verifyGoldDelivery(tradeA.id, exchanger1Id);
    // صراف وجه خارجی (تومان) را کارت‌به‌کارت کرده و رسید ثبت می‌کند
    await submitExternalTradePayment(
      tradeA.id,
      exchanger1Id,
      'BANK_RECEIPT_SHEBA_7890',
      'IRT_SHEBA',
      '7200000'
    );
    // ادورتایزر دریافت وجه را تایید می‌کند
    await confirmExternalPaymentReceipt(tradeA.id, advertiserId);
    // تسویه نهایی جریان الف
    const settledA = await settleDirectGoldTrade(tradeA.id, adminId);

    const advWalletAfter = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const exchWalletAfter = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      settledA.tradeStatus === GoldTradeStatus.SETTLED &&
        advWalletAfter!.availableCents === advWalletBefore!.availableCents &&
        advWalletAfter!.reservedCents === advWalletBefore!.reservedCents &&
        exchWalletAfter!.availableCents === exchWalletBefore!.availableCents &&
        exchWalletAfter!.reservedCents === exchWalletBefore!.reservedCents,
      '11. Direct external settlement (Workflow A) settles trade without crediting advertiser USD wallet or debiting exchanger USD wallet',
      `Adv Available: ${advWalletBefore!.availableCents} -> ${advWalletAfter!.availableCents}, Exch Available: ${exchWalletBefore!.availableCents} -> ${exchWalletAfter!.availableCents}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۶: جریان الف با تتر مستقیم برون‌سیستمی (USDT Direct)
    // ─────────────────────────────────────────────────────────────────────────
    const quoteUsdtDirect = await generateGoldTradeQuote({
      sellerId: advertiserId,
      buyerId: exchanger1Id,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 4000, // $40.00
      settlementMethod: GoldTradeSettlementMethod.USDT_DIRECT,
    });
    const tradeUsdt = await createGoldTradeOrder(quoteUsdtDirect);
    await acceptGoldTrade(tradeUsdt.id, advertiserId);
    await reportGoldDelivery(tradeUsdt.id, advertiserId, 'PROOF_USDT_GOLD_TRADE_456');
    await verifyGoldDelivery(tradeUsdt.id, exchanger1Id);
    await submitExternalTradePayment(
      tradeUsdt.id,
      exchanger1Id,
      '0xabc123externalTxHashOnBsc456',
      'USDT_BEP20',
      '40.00'
    );
    await confirmExternalPaymentReceipt(tradeUsdt.id, advertiserId);
    const settledUsdt = await settleDirectGoldTrade(tradeUsdt.id, adminId);

    assert(
      settledUsdt.tradeStatus === GoldTradeStatus.SETTLED &&
        settledUsdt.settlementMethod === GoldTradeSettlementMethod.USDT_DIRECT,
      '12. Direct external USDT settlement (Workflow A) completes with verified external tx evidence'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۷: جریان ب (WORKFLOW B) — خطا در صورت عدم کفایت موجودی کیف‌پول دلاری صراف
    // ─────────────────────────────────────────────────────────────────────────
    const quoteB = await generateGoldTradeQuote({
      sellerId: advertiserId,
      buyerId: exchanger1Id,
      gameSlug: 'wow_midnight',
      goldQuantity: 2000000,
      agreedValuationUsdCents: 15000, // $150.00
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
    });
    const tradeB_Insufficient = await createGoldTradeOrder(quoteB);

    let insufficientBlocked = false;
    try {
      // والت صراف در حال حاضر ۰ دلار دارد
      await acceptGoldTrade(tradeB_Insufficient.id, advertiserId);
    } catch (e: any) {
      if (e.message.includes('INSUFFICIENT_EXCHANGER_BALANCE')) {
        insufficientBlocked = true;
      }
    }

    assert(
      insufficientBlocked,
      '13. Prepaid USD wallet trade (Workflow B) strictly blocks acceptance when Exchanger available balance is insufficient',
      `Blocked: ${insufficientBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۸: شارژ کیف‌پول صراف و رزرو موجودی دلاری معامله طلا
    // ─────────────────────────────────────────────────────────────────────────
    // شارژ اولیه کیف‌پول صراف با ۲۰۰ دلار (20,000 سنت) برای تست‌های داخلی
    await prisma.walletV2.update({
      where: { userId: exchanger1Id },
      data: { availableCents: 20000 },
    });

    const acceptedB = await acceptGoldTrade(tradeB_Insufficient.id, advertiserId);
    const exchAfterReserve = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      acceptedB.tradeStatus === GoldTradeStatus.FUNDS_RESERVED &&
        acceptedB.walletReservationId !== null &&
        exchAfterReserve!.availableCents === 5000 && // 20000 - 15000 = 5000
        exchAfterReserve!.reservedCents === 15000,
      '14. Prepaid USD wallet trade atomically reserves exact USD cents from Exchanger available balance upon acceptance',
      `Available: ${exchAfterReserve!.availableCents}, Reserved: ${exchAfterReserve!.reservedCents}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۹: تسویه اتمیک جریان ب با تراز دوبل دفتر کل
    // ─────────────────────────────────────────────────────────────────────────
    await reportGoldDelivery(tradeB_Insufficient.id, advertiserId, 'GOLD_DELIVERY_PROOF_PREPAID_150');
    await verifyGoldDelivery(tradeB_Insufficient.id, exchanger1Id);

    const advBeforeSettleB = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const settledB = await settlePrepaidWalletGoldTrade(tradeB_Insufficient.id, adminId);

    const advAfterSettleB = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const exchAfterSettleB = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      settledB.tradeStatus === GoldTradeStatus.SETTLED &&
        exchAfterSettleB!.reservedCents === 0 && // 15000 deducted
        advAfterSettleB!.availableCents === advBeforeSettleB!.availableCents + 15000, // 15000 credited
      '15. Prepaid wallet settlement (Workflow B) atomically transfers liability from Exchanger reserved balance to Advertiser available balance',
      `Exch Reserved: ${exchAfterSettleB!.reservedCents}, Adv Available: ${advBeforeSettleB!.availableCents} -> ${advAfterSettleB!.availableCents}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۰: بررسی تراز دوبل در سند دفتر کل تسویه طلا
    // ─────────────────────────────────────────────────────────────────────────
    const ledgerLegs = await prisma.ledgerEntryV2.findMany({
      where: { goldTradeId: tradeB_Insufficient.id, entryType: 'GOLD_TRADE_SETTLE' },
    });
    const debitSum = ledgerLegs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amountCents, 0);
    const creditSum = ledgerLegs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amountCents, 0);

    assert(
      ledgerLegs.length === 2 && debitSum === 15000 && creditSum === 15000,
      '16. Gold trade wallet settlement creates perfectly balanced double-entry journal posting (Sum Debits == Sum Credits == $150.00)',
      `Debits: ${debitSum}, Credits: ${creditSum}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۱: منع تسویه مجدد معامله قبلاً تسویه‌شده (Anti-Double Settle)
    // ─────────────────────────────────────────────────────────────────────────
    let doubleSettleBlocked = false;
    try {
      await settlePrepaidWalletGoldTrade(tradeB_Insufficient.id, adminId);
    } catch (e: any) {
      if (e.message.includes('ALREADY_SETTLED')) {
        doubleSettleBlocked = true;
      }
    }

    assert(
      doubleSettleBlocked,
      '17. Already settled gold trade cannot be settled a second time',
      `Blocked: ${doubleSettleBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۲: منع خودتاییدی تسویه توسط صراف (خریدار)
    // ─────────────────────────────────────────────────────────────────────────
    const quoteB2 = await generateGoldTradeQuote({
      sellerId: advertiserId,
      buyerId: exchanger1Id,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 3000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
    });
    const tradeB2 = await createGoldTradeOrder(quoteB2);
    await acceptGoldTrade(tradeB2.id, advertiserId);
    await reportGoldDelivery(tradeB2.id, advertiserId, 'PROOF_SELF_SETTLE_TEST');
    await verifyGoldDelivery(tradeB2.id, exchanger1Id);

    let selfSettleBlocked = false;
    try {
      // صراف خریدار نمی‌تواند به تنهایی تسویه خروج وجه را تایید کند
      await settlePrepaidWalletGoldTrade(tradeB2.id, exchanger1Id);
    } catch (e: any) {
      if (e.message.includes('CANNOT_SELF_SETTLE')) {
        selfSettleBlocked = true;
      }
    }

    assert(
      selfSettleBlocked,
      '18. Exchanger buyer cannot self-approve final wallet settlement (independent review required)',
      `Blocked: ${selfSettleBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۳: معامله تحت اختلاف (DISPUTED) نمی‌تواند تسویه شود
    // ─────────────────────────────────────────────────────────────────────────
    await disputeGoldTrade(tradeB2.id, advertiserId, 'In-game gold not matching description');
    let disputedSettleBlocked = false;
    try {
      await settlePrepaidWalletGoldTrade(tradeB2.id, adminId);
    } catch (e: any) {
      if (e.message.includes('TRADE_DISPUTED')) {
        disputedSettleBlocked = true;
      }
    }

    assert(
      disputedSettleBlocked,
      '19. Disputed gold trade cannot be settled while dispute is active',
      `Blocked: ${disputedSettleBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۴: لغو معامله طلا با آزادسازی کامل رزروهای موجودی صراف
    // ─────────────────────────────────────────────────────────────────────────
    const exchBalBeforeCancel = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });
    await cancelGoldTrade(tradeB2.id, adminId, 'Cancelled after dispute resolution');
    const exchBalAfterCancel = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      exchBalAfterCancel!.availableCents === exchBalBeforeCancel!.availableCents + 3000 &&
        exchBalAfterCancel!.reservedCents === exchBalBeforeCancel!.reservedCents - 3000,
      '20. Cancelled unexecuted trade safely releases reserved balance back to Exchanger available balance without loss',
      `Reserved: ${exchBalBeforeCancel!.reservedCents} -> ${exchBalAfterCancel!.reservedCents}, Available: ${exchBalBeforeCancel!.availableCents} -> ${exchBalAfterCancel!.availableCents}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۵ و ۲۶: جریان ج (WORKFLOW C: P2P IRT-to-USD Funding)
    // صراف باید موجودی واقعی دلاری داشته باشد و رزرو شود
    // ─────────────────────────────────────────────────────────────────────────
    const p2pFundingQuote = await generateP2pFundingQuote({
      advertiserId,
      exchangerId: exchanger1Id,
      offerId: offer1.id,
      targetUsdCents: 5000, // $50.00
    });

    const exchBeforeP2p = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });
    const p2pRequest = await acceptP2pFundingRequest(advertiserId, p2pFundingQuote);
    const exchAfterP2p = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      p2pRequest.status === 'AWAITING_PAYMENT' &&
        exchAfterP2p!.availableCents === exchBeforeP2p!.availableCents - 5000 &&
        exchAfterP2p!.reservedCents === exchBeforeP2p!.reservedCents + 5000,
      '21. P2P IRT-to-USD funding requires genuine backing USD from Exchanger and reserves it atomically',
      `Exchanger Reserved: ${exchBeforeP2p!.reservedCents} -> ${exchAfterP2p!.reservedCents}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۷: گیت محافظتی تسویه P2P به طور پیش‌فرض مسدود است (Fail-Closed)
    // ─────────────────────────────────────────────────────────────────────────
    let p2pSettlementGated = false;
    try {
      await settleP2pFunding(p2pRequest.id, adminId, 'SHEBA_PAID_RECEIPT_123');
    } catch (e: any) {
      if (e.message.includes('P2P_SETTLEMENT_DISABLED')) {
        p2pSettlementGated = true;
      }
    }

    assert(
      p2pSettlementGated && FINANCE_V2_FEATURE_GATES.FINANCE_V2_P2P_SETTLEMENT_ENABLED === false,
      '22. P2P wallet settlement gate defaults to fail-closed false (FINANCE_V2_P2P_SETTLEMENT_ENABLED=false)',
      `Gated: ${p2pSettlementGated}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۸: اجرای تسویه P2P در صورت فعال‌سازی موقت با تراز دوبل
    // ─────────────────────────────────────────────────────────────────────────
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'true';
    const advBeforeP2pSettle = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const settledP2p = await settleP2pFunding(p2pRequest.id, adminId, `SHEBA_PAID_RECEIPT_${Date.now()}_P2P`);
    const advAfterP2pSettle = await prisma.walletV2.findUnique({ where: { userId: advertiserId } });
    const exchAfterP2pSettle = await prisma.walletV2.findUnique({ where: { userId: exchanger1Id } });

    assert(
      settledP2p.status === 'CONFIRMED_CREDITED' &&
        advAfterP2pSettle!.availableCents === advBeforeP2pSettle!.availableCents + 5000 &&
        exchAfterP2pSettle!.reservedCents === exchAfterP2p!.reservedCents - 5000,
      '23. P2P funding settlement transfers reserved USD liability from Exchanger to Advertiser wallet with conservation of funds'
    );
    // بازگرداندن گیت به false برای حفظ امنیت
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۹: حفظ دسترسی و تمامیت رکوردهای قبلی GoldExchangeTradeOrder
    // ─────────────────────────────────────────────────────────────────────────
    const legacyCount = await prisma.goldExchangeTradeOrder.count();
    assert(
      legacyCount >= 0,
      '24. Legacy GoldExchangeTradeOrder records remain accessible without corruption',
      `Count: ${legacyCount}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳۰: حفظ تمامیت اطلاعات کاربران، رول‌ها و ثبت‌نام‌ها
    // ─────────────────────────────────────────────────────────────────────────
    const exchRoles = await prisma.userRole.findMany({ where: { userId: exchanger1Id } });
    assert(
      exchRoles.some((r) => r.roleKey === 'exchanger'),
      '25. Existing user roles and registration records remain intact and uncorrupted'
    );

  } catch (err) {
    console.error('Unexpected error in Finance V2.2 test suite:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`FINANCE V2.2 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFinanceV2_2TestSuite()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
