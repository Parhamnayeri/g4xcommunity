/**
 * phase6_exchange_security_hardening_suite.ts
 *
 * مجموعه تست‌های اعتبارسنجی امنیتی پیشرفته بازار مبادلات (Phase 6 Exchange Security Hardening)
 *
 * پوشش جامع آزمون‌ها:
 *  1. جعل و بازتولید هش با SHA-256 سنتی (Recomputed Forged SHA-256 Quote)
 *  2. دستکاری مبالغ یا نرخ کارمزد (Modified Amount or Commission)
 *  3. تغییر هویت خریدار/فروشنده و مبادله با خود (Modified Buyer/Seller & Self-Trading)
 *  4. ارجاع به آفر با نسخه نامعتبر/قدیمی (Wrong Offer ID / Version Mismatch)
 *  5. انقضای پیش‌فاکتور (Expired Quote Fail-Closed)
 *  6. بازپخش پیش‌فاکتور (Quote Replay Detection)
 *  7. فقدان یا نقص کلید امضای سرور (Missing / Short Signing Secret Fail-Closed)
 *  8. پذیرش همزمان یک معامله (Concurrent Acceptance of the Same Trade CAS)
 *  9. معاملات همزمان رقیب با موجودی محدود کیف‌پول (Concurrent Trades Competing for Balance)
 * 10. لغو مضاعف و جلوگیری از استرداد تکراری (Duplicate Reserve / Release Attempts)
 * 11. مسابقه لغو و تسویه (Cancellation vs Settlement Race Safety)
 * 12. گیت امنیتی تسویه P2P (Disabled P2P Settlement Gate)
 * 13. دسترسی غیرمجاز بین کاربران (Cross-User Trade Access Authorization)
 * 14. صراف تعلیق‌شده یا فاقد صلاحیت (Suspended / Deactivated Exchanger Guard)
 * 15. حریم خصوصی و سریالایزرهای مجاز (Financial Data Privacy Serialization)
 * 16. ناوردای دفتر کل و تراز دوبل (Double-Entry Ledger & Wallet Invariants)
 */

import crypto from 'crypto';
import prisma from '../database/db';
import {
  getExchangeQuoteSigningSecret,
  computeGoldTradeQuoteHash,
  verifyGoldTradeQuoteHash,
  computeP2pFundingQuoteHash,
  verifyP2pFundingQuoteHash,
  createExchangerFeeOffer,
  generateGoldTradeQuote,
  createGoldTradeOrder,
  acceptGoldTrade,
  settlePrepaidWalletGoldTrade,
  cancelGoldTrade,
  generateP2pFundingQuote,
  acceptP2pFundingRequest,
  settleP2pFunding,
  assertApprovedExchanger,
} from '../services/financeV2/exchangerMarketplaceService';
import {
  ExchangerOfferStatus,
  ExchangerOfferServiceType,
  GoldTradeSettlementMethod,
  GoldTradeStatus,
  GoldDeliveryStatus,
} from '../services/financeV2/financeV2Types';
import {
  serializePublicOffer,
  serializeAdvertiserTrade,
  serializeExchangerTrade,
  serializeAdminTrade,
} from '../web/marketplaceRoutes';
import {
  getOrCreateWalletV2,
  assertWalletInvariants,
} from '../services/financeV2/financeV2WalletService';

function assert(condition: boolean, testName: string, extraInfo?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (extraInfo) console.error(`   Details: ${extraInfo}`);
    throw new Error(`TEST FAILED: ${testName}`);
  }
}

async function runSecurityHardeningSuite() {
  console.log('\n============================================================');
  console.log('   PHASE 6 EXCHANGE FINANCIAL SECURITY HARDENING SUITE      ');
  console.log('============================================================\n');

  const now = Date.now();
  const testAdvId = `sec_adv_${now}`;
  const testExchId = `sec_exch_${now}`;
  const testExch2Id = `sec_exch2_${now}`;
  const testAttackerId = `sec_att_${now}`;
  const testSuspendedExchId = `sec_susp_exch_${now}`;

  const originalSecret = process.env.EXCHANGE_QUOTE_SIGNING_SECRET;

  try {
    // -------------------------------------------------------------
    // آماده‌سازی کاربران آزمایشی در پایگاه داده
    // -------------------------------------------------------------
    await prisma.user.createMany({
      data: [
        { discordId: testAdvId, username: 'SecAdvertiser', isActive: true },
        { discordId: testExchId, username: 'SecExchanger', isActive: true },
        { discordId: testExch2Id, username: 'SecExchanger2', isActive: true },
        { discordId: testAttackerId, username: 'SecAttacker', isActive: true },
        { discordId: testSuspendedExchId, username: 'SecSuspendedExchanger', isActive: false },
      ],
    });

    await prisma.userRole.createMany({
      data: [
        { userId: testAdvId, roleKey: 'advertiser' },
        { userId: testExchId, roleKey: 'exchanger' },
        { userId: testExch2Id, roleKey: 'exchanger' },
        { userId: testAttackerId, roleKey: 'advertiser' },
        { userId: testSuspendedExchId, roleKey: 'exchanger' },
      ],
    });

    // ایجاد کیف‌پول صراف با موجودی اولیه $100.00 (10,000 cents)
    await prisma.walletV2.create({
      data: {
        userId: testExchId,
        availableCents: 10000,
        reservedCents: 0,
      },
    });

    // ایجاد کیف‌پول ادورتایزر با موجودی 0
    await prisma.walletV2.create({
      data: {
        userId: testAdvId,
        availableCents: 0,
        reservedCents: 0,
      },
    });

    // ثبت نرخ مرجع مدیریت جهت تسویه‌ها
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: '60000' },
      create: { key: 'admin_usd_irt_rate', value: '60000', description: 'Admin USD/IRT Rate' },
    });

    // ایجاد آفر پایه صراف
    const baseOffer = await createExchangerFeeOffer(testExchId, {
      exchangerId: testExchId,
      serviceType: ExchangerOfferServiceType.GOLD_PURCHASE_WALLET,
      settlementCurrency: 'USD',
      commissionPercentage: 0.05,
      feePayer: 'ADVERTISER',
    });

    // ایجاد آفر P2P صراف
    const p2pOffer = await createExchangerFeeOffer(testExchId, {
      exchangerId: testExchId,
      serviceType: ExchangerOfferServiceType.IRT_TO_USD_FUNDING,
      settlementCurrency: 'USD',
      commissionPercentage: 0.03,
      feePayer: 'ADVERTISER',
    });

    // -------------------------------------------------------------
    // TEST 1: Recomputed Forged SHA-256 Quote
    // -------------------------------------------------------------
    console.log('\n--- 1. Recomputed Forged SHA-256 Quote ---');
    const validQuote = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 5000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });

    // تلاش مهاجم برای جایگزینی امضا با هش ساده SHA-256 بدون کلید سرور
    const fakeSha256 = crypto
      .createHash('sha256')
      .update(`${validQuote.tradeRef}|${testAdvId}|${testExchId}|5000`)
      .digest('hex');

    let forgedShaBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validQuote,
        quoteHash: fakeSha256,
      });
    } catch (e: any) {
      forgedShaBlocked = e.message.includes('QUOTE_TAMPERED');
    }
    assert(forgedShaBlocked, '1.1 Recomputed unkeyed SHA-256 quote is rejected fail-closed');

    // اطمینان از اینکه هیچ رکوردی در دیتابیس ساخته نشده
    const fakeRecord = await prisma.goldTrade.findFirst({
      where: { quoteHash: fakeSha256 },
    });
    assert(!fakeRecord, '1.2 Tampered quote produces zero database records');

    // -------------------------------------------------------------
    // TEST 2: Modified Amount or Commission
    // -------------------------------------------------------------
    console.log('\n--- 2. Modified Amount or Commission ---');
    let modifiedAmountBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validQuote,
        tradeRef: `TRD_MOD_${Date.now()}`,
        agreedValuationUsdCents: 999999, // تغییر مبلغ از ۵۰ دلار به ۹۹۹۹ دلار
      });
    } catch (e: any) {
      modifiedAmountBlocked = e.message.includes('QUOTE_TAMPERED');
    }
    assert(modifiedAmountBlocked, '2.1 Tampered agreed valuation is rejected by HMAC');

    let modifiedCommissionBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validQuote,
        tradeRef: `TRD_MOD2_${Date.now()}`,
        commissionPercentage: 0.0, // صفر کردن کارمزد صراف
      });
    } catch (e: any) {
      modifiedCommissionBlocked = e.message.includes('QUOTE_TAMPERED');
    }
    assert(modifiedCommissionBlocked, '2.2 Tampered commission percentage is rejected by HMAC');

    // -------------------------------------------------------------
    // TEST 3: Modified Buyer/Seller & Self-Trading
    // -------------------------------------------------------------
    console.log('\n--- 3. Modified Buyer/Seller & Self-Trading ---');
    let swappedBuyerBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validQuote,
        tradeRef: `TRD_SWAP_${Date.now()}`,
        buyerId: testAttackerId, // تغییر خریدار
      });
    } catch (e: any) {
      swappedBuyerBlocked = e.message.includes('QUOTE_TAMPERED') || e.message.includes('UNAPPROVED_EXCHANGER');
    }
    assert(swappedBuyerBlocked, '3.1 Swapped buyerId is rejected by quote verification');

    let selfTradeBlocked = false;
    try {
      await generateGoldTradeQuote({
        sellerId: testExchId,
        buyerId: testExchId,
        gameSlug: 'wow_midnight',
        goldQuantity: 100000,
        agreedValuationUsdCents: 1000,
        settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      });
    } catch (e: any) {
      selfTradeBlocked = e.message.includes('CANNOT_SELF_TRADE') || e.message.includes('CANNOT_TRADE_WITH_SELF');
    }
    assert(selfTradeBlocked, '3.2 Self-trading is rejected at quote generation');

    // -------------------------------------------------------------
    // TEST 4: Wrong Offer ID / Version Mismatch
    // -------------------------------------------------------------
    console.log('\n--- 4. Wrong Offer ID / Version Mismatch ---');
    let wrongVersionBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validQuote,
        tradeRef: `TRD_VER_${Date.now()}`,
        offerVersion: 999, // نسخه جعلی که هنوز در دیتابیس وجود ندارد
      });
    } catch (e: any) {
      wrongVersionBlocked = e.message.includes('QUOTE_TAMPERED') || e.message.includes('OFFER_VERSION_MISMATCH');
    }
    assert(wrongVersionBlocked, '4.1 Stale or mismatched offer version is rejected');

    // -------------------------------------------------------------
    // TEST 5: Expired Quote Fail-Closed
    // -------------------------------------------------------------
    console.log('\n--- 5. Expired Quote Fail-Closed ---');
    const expiredQuote = {
      ...validQuote,
      tradeRef: `TRD_EXP_${Date.now()}`,
      quoteExpiresAt: new Date(Date.now() - 60000), // ۱ دقیقه قبل منقضی شده
    };
    // بازتولید هش متناظر با تاریخ انقضای قدیمی
    const expiredHmac = computeGoldTradeQuoteHash({
      tradeRef: expiredQuote.tradeRef,
      sellerId: expiredQuote.sellerId,
      buyerId: expiredQuote.buyerId,
      offerId: expiredQuote.acceptedOfferId,
      offerVersion: expiredQuote.offerVersion,
      feePayer: expiredQuote.feePayer,
      gameSlug: expiredQuote.gameSlug,
      region: expiredQuote.region,
      realm: expiredQuote.realm,
      faction: expiredQuote.faction,
      goldQuantity: expiredQuote.goldQuantity,
      agreedValuationUsdCents: expiredQuote.agreedValuationUsdCents,
      settlementMethod: expiredQuote.settlementMethod,
      commissionPercentage: expiredQuote.commissionPercentage,
      quotedPayableAmount: expiredQuote.quotedPayableAmount,
      quotedPayableCurrency: expiredQuote.quotedPayableCurrency,
      expiresAt: expiredQuote.quoteExpiresAt,
    });
    expiredQuote.quoteHash = expiredHmac;

    let expiredBlockedAtCreate = false;
    try {
      await createGoldTradeOrder(expiredQuote);
    } catch (e: any) {
      expiredBlockedAtCreate = e.message.includes('QUOTE_EXPIRED');
    }
    assert(expiredBlockedAtCreate, '5.1 Expired quote cannot create a GoldTrade order');

    // -------------------------------------------------------------
    // TEST 6: Quote Replay Detection
    // -------------------------------------------------------------
    console.log('\n--- 6. Quote Replay Detection ---');
    const replayQuote = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 200000,
      agreedValuationUsdCents: 2000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });

    const firstOrder = await createGoldTradeOrder(replayQuote);
    assert(firstOrder.id > 0, '6.1 Initial trade order created successfully');

    let replayBlocked = false;
    try {
      await createGoldTradeOrder(replayQuote); // تلاش دوباره با همان tradeRef
    } catch (e: any) {
      replayBlocked = e.message.includes('QUOTE_REPLAY_DETECTED');
    }
    assert(replayBlocked, '6.2 Replay of the exact same quoteRef is blocked');

    // -------------------------------------------------------------
    // TEST 7: Missing / Short Signing Secret Fail-Closed
    // -------------------------------------------------------------
    console.log('\n--- 7. Missing / Short Signing Secret Fail-Closed ---');
    delete process.env.EXCHANGE_QUOTE_SIGNING_SECRET;

    let missingSecretBlocked = false;
    try {
      getExchangeQuoteSigningSecret();
    } catch (e: any) {
      missingSecretBlocked = e.message.includes('MISSING_EXCHANGE_QUOTE_SIGNING_SECRET');
    }
    assert(missingSecretBlocked, '7.1 Missing EXCHANGE_QUOTE_SIGNING_SECRET fails closed immediately');

    process.env.EXCHANGE_QUOTE_SIGNING_SECRET = 'short_key_under_32_bytes';
    let shortSecretBlocked = false;
    try {
      getExchangeQuoteSigningSecret();
    } catch (e: any) {
      shortSecretBlocked = e.message.includes('MISSING_EXCHANGE_QUOTE_SIGNING_SECRET');
    }
    assert(shortSecretBlocked, '7.2 Signing secret under 32 characters entropy is rejected');

    // بازگردانی کلید معتبر
    process.env.EXCHANGE_QUOTE_SIGNING_SECRET = originalSecret;

    // -------------------------------------------------------------
    // TEST 8: Concurrent Acceptance of the Same Trade (Atomic CAS)
    // -------------------------------------------------------------
    console.log('\n--- 8. Concurrent Acceptance of the Same Trade ---');
    const concurrentQuote = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 300000,
      agreedValuationUsdCents: 3000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });

    const concurrentOrder = await createGoldTradeOrder(concurrentQuote);

    // اجرای دو پذیرش همزمان روی یک معامله یکتا
    const [res1, res2] = await Promise.allSettled([
      acceptGoldTrade(concurrentOrder.id, testAdvId),
      acceptGoldTrade(concurrentOrder.id, testAdvId),
    ]);

    // باید هر دو یا یک موفقیت و یک بازیابی یکسان بدون خطا داشته باشند، و تعهد فقط ۱ بار ثبت شود
    assert(
      res1.status === 'fulfilled' || res2.status === 'fulfilled',
      '8.1 At least one concurrent acceptance executes cleanly'
    );

    // شمارش اسناد رزرو ثبت شده در دفتر کل برای این معامله
    const reservationsCount = await prisma.ledgerEntryV2.count({
      where: {
        goldTradeId: concurrentOrder.id,
        entryType: 'GOLD_TRADE_RESERVE',
      },
    });
    assert(reservationsCount === 1, '8.2 Exactly one ledger reservation created despite concurrency');

    // -------------------------------------------------------------
    // TEST 9: Concurrent Trades Competing for Balance
    // -------------------------------------------------------------
    console.log('\n--- 9. Concurrent Trades Competing for Balance ---');
    // موجودی صراف در حال حاضر: 10,000 - 3,000 (reserved) = 7,000 cents available
    // دو معامله جدید: هر کدام نیازمند ۵۰ دلار (5,000 cents) -> مجموع 10,000 > 7,000
    const quoteA = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 5000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });
    const quoteB = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 5000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });

    const orderA = await createGoldTradeOrder(quoteA);
    const orderB = await createGoldTradeOrder(quoteB);

    const [raceA, raceB] = await Promise.allSettled([
      acceptGoldTrade(orderA.id, testAdvId),
      acceptGoldTrade(orderB.id, testAdvId),
    ]);

    const successes = [raceA, raceB].filter((r) => r.status === 'fulfilled');
    const failures = [raceA, raceB].filter((r) => r.status === 'rejected');

    assert(successes.length === 1, '9.1 Exactly one trade wins limited available wallet balance');
    assert(failures.length === 1, '9.2 The second competing trade is strictly rejected');

    const exchWalletAfterRace = await prisma.walletV2.findUniqueOrThrow({
      where: { userId: testExchId },
    });
    assert(
      exchWalletAfterRace.availableCents >= 0,
      '9.3 Exchanger available cents never drops below zero',
      `Available: ${exchWalletAfterRace.availableCents}`
    );
    assertWalletInvariants(exchWalletAfterRace);

    // -------------------------------------------------------------
    // TEST 10: Duplicate Reserve and Release Attempts
    // -------------------------------------------------------------
    console.log('\n--- 10. Duplicate Reserve and Release Attempts ---');
    // لغو معامله موفقی که وجه رزرو دارد
    const winningOrderId = (successes[0] as any).value.id;
    const initialCancel = await cancelGoldTrade(winningOrderId, testAdvId, 'First cancel attempt');
    assert(initialCancel.tradeStatus === GoldTradeStatus.CANCELLED, '10.1 Trade cancelled successfully');

    const walletAfterFirstCancel = await prisma.walletV2.findUniqueOrThrow({
      where: { userId: testExchId },
    });

    // تلاش دوباره برای لغو معامله از قبل لغو شده
    const secondCancel = await cancelGoldTrade(winningOrderId, testAdvId, 'Duplicate cancel attempt');
    assert(secondCancel.tradeStatus === GoldTradeStatus.CANCELLED, '10.2 Duplicate cancel is idempotent');

    const walletAfterSecondCancel = await prisma.walletV2.findUniqueOrThrow({
      where: { userId: testExchId },
    });

    assert(
      walletAfterFirstCancel.availableCents === walletAfterSecondCancel.availableCents &&
        walletAfterFirstCancel.reservedCents === walletAfterSecondCancel.reservedCents,
      '10.3 Duplicate cancellation never produces double refund liabilities'
    );

    // -------------------------------------------------------------
    // TEST 11: Cancellation vs Settlement Race
    // -------------------------------------------------------------
    console.log('\n--- 11. Cancellation vs Settlement Race ---');
    // آماده‌سازی یک معامله با وضعیت تحویل تایید شده
    const raceQuote = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 200000,
      agreedValuationUsdCents: 2000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      offerId: baseOffer.id,
    });
    const raceOrder = await createGoldTradeOrder(raceQuote);
    await acceptGoldTrade(raceOrder.id, testAdvId);

    // به‌روزرسانی تحویل طلا به VERIFIED جهت واجد شرایط بودن برای تسویه
    await prisma.goldTrade.update({
      where: { id: raceOrder.id },
      data: { goldDeliveryStatus: GoldDeliveryStatus.VERIFIED },
    });

    // مسابقه تسویه و لغو همزمان
    const [settleRes, cancelRes] = await Promise.allSettled([
      settlePrepaidWalletGoldTrade(raceOrder.id, testAdvId),
      cancelGoldTrade(raceOrder.id, testAdvId, 'Race cancellation'),
    ]);

    const finalTradeState = await prisma.goldTrade.findUniqueOrThrow({
      where: { id: raceOrder.id },
    });

    assert(
      finalTradeState.tradeStatus === GoldTradeStatus.SETTLED ||
        finalTradeState.tradeStatus === GoldTradeStatus.CANCELLED,
      '11.1 Trade settles on an authoritative final state despite race',
      `Final status: ${finalTradeState.tradeStatus}`
    );

    // بررسی اینکه آیا هر دو همزمان موفق شدند (که نباید رخ دهد!)
    assert(
      !(settleRes.status === 'fulfilled' && cancelRes.status === 'fulfilled'),
      '11.2 Settle and Cancel cannot both succeed simultaneously'
    );

    // -------------------------------------------------------------
    // TEST 12: Disabled P2P Settlement
    // -------------------------------------------------------------
    console.log('\n--- 12. Disabled P2P Settlement ---');
    const p2pQuote = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 1000,
    });

    const p2pReq = await acceptP2pFundingRequest(testAdvId, p2pQuote);
    assert(p2pReq.status === 'AWAITING_PAYMENT', '12.1 P2P funding accepted and awaiting payment');

    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

    let p2pDisabledBlocked = false;
    try {
      await settleP2pFunding(p2pReq.id, testAdvId, 'REC_TEST_123');
    } catch (e: any) {
      p2pDisabledBlocked = e.message.includes('P2P_SETTLEMENT_DISABLED');
    }
    assert(p2pDisabledBlocked, '12.2 P2P settlement is blocked when feature gate is disabled');

    // -------------------------------------------------------------
    // TEST 13: Cross-User Trade Access
    // -------------------------------------------------------------
    console.log('\n--- 13. Cross-User Trade Access ---');
    let attackerBlocked = false;
    try {
      await cancelGoldTrade(concurrentOrder.id, testAttackerId, 'Attacker trying to cancel');
    } catch (e: any) {
      attackerBlocked = e.message.includes('UNAUTHORIZED_ACTOR');
    }
    assert(attackerBlocked, '13.1 Third-party user cannot cancel another user\'s trade');

    // -------------------------------------------------------------
    // TEST 14: Suspended Exchanger
    // -------------------------------------------------------------
    console.log('\n--- 14. Suspended Exchanger ---');
    let suspendedOfferBlocked = false;
    try {
      await assertApprovedExchanger(testSuspendedExchId);
    } catch (e: any) {
      suspendedOfferBlocked = e.message.includes('EXCHANGER_NOT_FOUND') || e.message.includes('UNAPPROVED_EXCHANGER');
    }
    assert(suspendedOfferBlocked, '14.1 Deactivated or suspended exchanger is rejected by assertApprovedExchanger');

    let suspendedQuoteBlocked = false;
    try {
      await generateGoldTradeQuote({
        sellerId: testAdvId,
        buyerId: testSuspendedExchId,
        gameSlug: 'wow_midnight',
        goldQuantity: 100000,
        agreedValuationUsdCents: 1000,
        settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
      });
    } catch (e: any) {
      suspendedQuoteBlocked = e.message.includes('UNAPPROVED_EXCHANGER') || e.message.includes('EXCHANGER_NOT_FOUND');
    }
    assert(suspendedQuoteBlocked, '14.2 Cannot generate quotes with suspended or unapproved exchanger');

    // -------------------------------------------------------------
    // TEST 15: Financial Data Privacy Serialization
    // -------------------------------------------------------------
    console.log('\n--- 15. Financial Data Privacy Serialization ---');
    const rawTradeObject = await prisma.goldTrade.findFirstOrThrow({
      where: { id: concurrentOrder.id },
      include: {
        buyer: { select: { discordId: true, username: true, displayName: true } },
        seller: { select: { discordId: true, username: true, displayName: true } },
      },
    });

    const publicOfferSerialized = serializePublicOffer(baseOffer);
    assert(!!publicOfferSerialized && !('internalNotes' in publicOfferSerialized), '15.1 Public offer serializer strips internal notes');

    const advertiserTradeSerialized = serializeAdvertiserTrade(rawTradeObject);
    assert(!!advertiserTradeSerialized && !('walletReservationId' in advertiserTradeSerialized), '15.2 Advertiser trade serializer strips walletReservationId');
    assert(!!advertiserTradeSerialized && !('notes' in advertiserTradeSerialized), '15.3 Advertiser trade serializer strips internal notes');

    const exchangerTradeSerialized = serializeExchangerTrade(rawTradeObject);
    assert(!!exchangerTradeSerialized && !('walletReservationId' in exchangerTradeSerialized), '15.4 Exchanger trade serializer strips internal reservation ID');

    const adminTradeSerialized = serializeAdminTrade(rawTradeObject);
    assert(!!adminTradeSerialized && 'tradeRef' in adminTradeSerialized && 'tradeStatus' in adminTradeSerialized, '15.5 Admin trade serializer preserves audit status');

    // -------------------------------------------------------------
    // TEST 16: Ledger Invariants
    // -------------------------------------------------------------
    console.log('\n--- 16. Double-Entry Ledger & Wallet Invariants ---');
    const finalExchWallet = await prisma.walletV2.findUniqueOrThrow({
      where: { userId: testExchId },
    });
    const finalAdvWallet = await prisma.walletV2.findUniqueOrThrow({
      where: { userId: testAdvId },
    });

    assertWalletInvariants(finalExchWallet);
    assertWalletInvariants(finalAdvWallet);
    assert(
      finalExchWallet.availableCents >= 0 && finalExchWallet.reservedCents >= 0,
      '16.1 Exchanger wallet non-negative invariants hold'
    );
    assert(
      finalAdvWallet.availableCents >= 0 && finalAdvWallet.reservedCents >= 0,
      '16.2 Advertiser wallet non-negative invariants hold'
    );

    console.log('\n============================================================');
    console.log('   ALL 16 PHASE 6 SECURITY HARDENING TESTS PASSED!          ');
    console.log('============================================================\n');
  } finally {
    // بازگردانی متغیرهای محیطی
    process.env.EXCHANGE_QUOTE_SIGNING_SECRET = originalSecret;
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

    // پاکسازی داده‌های تست
    await prisma.ledgerEntryV2.deleteMany({
      where: {
        userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId] },
      },
    });
    await prisma.goldTrade.deleteMany({
      where: {
        OR: [
          { sellerId: { in: [testAdvId, testExchId, testAttackerId] } },
          { buyerId: { in: [testAdvId, testExchId, testAttackerId] } },
        ],
      },
    });
    await prisma.advertiserFundingRequest.deleteMany({
      where: { advertiserId: testAdvId },
    });
    await prisma.exchangerFeeOffer.deleteMany({
      where: { exchangerId: { in: [testExchId, testExch2Id] } },
    });
    await prisma.walletV2.deleteMany({
      where: { userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId] } },
    });
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runSecurityHardeningSuite().catch((err) => {
    console.error('Fatal error in security hardening suite:', err);
    process.exit(1);
  });
}

export { runSecurityHardeningSuite };
