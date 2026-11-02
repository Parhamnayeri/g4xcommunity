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
  LedgerV2EntryType,
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
  const testAdminId = `sec_admin_${now}`;

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
        { discordId: testAdminId, username: 'SecAdmin', isActive: true },
      ],
    });

    await prisma.userRole.createMany({
      data: [
        { userId: testAdvId, roleKey: 'advertiser' },
        { userId: testExchId, roleKey: 'exchanger' },
        { userId: testExch2Id, roleKey: 'exchanger' },
        { userId: testAttackerId, roleKey: 'advertiser' },
        { userId: testSuspendedExchId, roleKey: 'exchanger' },
        { userId: testAdminId, roleKey: 'admin' },
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

    // Equivalent safe retry returns the existing trade idempotently without duplicating records
    const secondOrder = await createGoldTradeOrder(replayQuote);
    assert(secondOrder.id === firstOrder.id, '6.2 Safe retry of exact matching tradeRef returns existing trade idempotently');

    // Mismatched terms with existing tradeRef is strictly rejected
    let mismatchedTermsBlocked = false;
    try {
      await createGoldTradeOrder({
        ...replayQuote,
        goldQuantity: 300000,
        quoteHash: computeGoldTradeQuoteHash({
          tradeRef: replayQuote.tradeRef,
          sellerId: replayQuote.sellerId,
          buyerId: replayQuote.buyerId,
          offerId: replayQuote.acceptedOfferId,
          offerVersion: replayQuote.offerVersion,
          feePayer: replayQuote.feePayer,
          gameSlug: replayQuote.gameSlug,
          region: replayQuote.region,
          realm: replayQuote.realm,
          faction: replayQuote.faction,
          goldQuantity: 300000,
          agreedValuationUsdCents: replayQuote.agreedValuationUsdCents,
          settlementMethod: replayQuote.settlementMethod,
          commissionPercentage: replayQuote.commissionPercentage,
          quotedPayableAmount: replayQuote.quotedPayableAmount,
          quotedPayableCurrency: replayQuote.quotedPayableCurrency,
          expiresAt: new Date(replayQuote.quoteExpiresAt),
        }),
      });
    } catch (e: any) {
      mismatchedTermsBlocked = e.message.includes('QUOTE_MISMATCH');
    }
    assert(mismatchedTermsBlocked, '6.3 Replay of existing tradeRef with mismatched terms is rejected');

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

    // -------------------------------------------------------------
    // TEST 17: Concurrent Acceptance of the SAME P2P Quote (With Sufficient Balance)
    // -------------------------------------------------------------
    console.log('\n--- 17. Concurrent Acceptance of SAME P2P Quote ---');
    // Ensure Exchanger has plenty of balance ($500)
    await prisma.walletV2.update({
      where: { userId: testExchId },
      data: { availableCents: 50000, reservedCents: 0 },
    });
    const p2pQuoteConcurrent = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 5000, // $50.00
    });

    // Run two concurrent accept requests for the SAME quote
    const [resP2p1, resP2p2] = await Promise.all([
      acceptP2pFundingRequest(testAdvId, p2pQuoteConcurrent),
      acceptP2pFundingRequest(testAdvId, p2pQuoteConcurrent),
    ]);

    assert(resP2p1.id === resP2p2.id, '17.1 Both concurrent accept calls resolve to the same funding request');
    assert(resP2p1.quoteRef === p2pQuoteConcurrent.quoteRef, '17.2 Authoritative quoteRef persisted');

    // Exactly one funding liability
    const fundingCount = await prisma.advertiserFundingRequest.count({
      where: { quoteRef: p2pQuoteConcurrent.quoteRef },
    });
    assert(fundingCount === 1, '17.3 Exactly one funding liability created in database for quote');

    // Exactly one wallet reservation (only $50 reserved, not $100)
    const exchAfterConcurrent = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    assert(
      exchAfterConcurrent.availableCents === 45000 && exchAfterConcurrent.reservedCents === 5000,
      `17.4 Exactly one wallet reservation performed: available 45000, reserved 5000 (got avail=${exchAfterConcurrent.availableCents}, res=${exchAfterConcurrent.reservedCents})`
    );

    // Exactly one ledger reservation entry
    const ledgerP2pResCount = await prisma.ledgerEntryV2.count({
      where: { fundingRequestId: resP2p1.id, entryType: LedgerV2EntryType.P2P_FUNDING_RESERVE },
    });
    assert(ledgerP2pResCount === 1, '17.5 Exactly one ledger reservation entry recorded');

    // -------------------------------------------------------------
    // TEST 18: Two DIFFERENT Quotes Competing for Insufficient Balance
    // -------------------------------------------------------------
    console.log('\n--- 18. Competing Quotes for Insufficient Balance ---');
    // Set exchanger balance to exactly $60 (6000 cents) available, 0 reserved
    await prisma.walletV2.update({
      where: { userId: testExchId },
      data: { availableCents: 6000, reservedCents: 0 },
    });
    // Two different valid quotes for $50 each (total $100 needed, but only $60 available)
    const quoteCompeteA = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 5000,
    });
    const quoteCompeteB = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 5000,
    });

    const competeResults = await Promise.allSettled([
      acceptP2pFundingRequest(testAdvId, quoteCompeteA),
      acceptP2pFundingRequest(testAdvId, quoteCompeteB),
    ]);

    const fulfilledCount = competeResults.filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = competeResults.filter((r) => r.status === 'rejected').length;
    assert(fulfilledCount === 1, '18.1 Exactly one competing quote succeeds');
    assert(rejectedCount === 1, '18.2 Exactly one competing quote fails due to insufficient balance');

    const failedReason = (competeResults.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason?.message;
    assert(
      failedReason?.includes('INSUFFICIENT_EXCHANGER_USD_BACKING'),
      '18.3 Competing loser received INSUFFICIENT_EXCHANGER_USD_BACKING'
    );

    const exchAfterCompete = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    assert(
      exchAfterCompete.availableCents === 1000 && exchAfterCompete.reservedCents === 5000,
      '18.4 Wallet balances correctly reflect exactly one deduction (available=1000, reserved=5000)'
    );

    // -------------------------------------------------------------
    // TEST 19: Repeated P2P Quote with Different Terms Rejected
    // -------------------------------------------------------------
    console.log('\n--- 19. Repeated Quote with Different Terms ---');
    let tamperedTermsBlocked = false;
    try {
      await acceptP2pFundingRequest(testAdvId, {
        ...p2pQuoteConcurrent,
        targetUsdCents: 99999, // tampered amount
      });
    } catch (e: any) {
      tamperedTermsBlocked = e.message.includes('QUOTE_CONFLICT') || e.message.includes('QUOTE_TAMPERED');
    }
    assert(tamperedTermsBlocked, '19.1 Repeated quote with modified target amount is strictly rejected');

    let tamperedRateBlocked = false;
    try {
      await acceptP2pFundingRequest(testAdvId, {
        ...p2pQuoteConcurrent,
        referenceRate: 1000000, // tampered rate
      });
    } catch (e: any) {
      tamperedRateBlocked = e.message.includes('QUOTE_CONFLICT') || e.message.includes('QUOTE_TAMPERED');
    }
    assert(tamperedRateBlocked, '19.2 Repeated quote with modified exchange rate is strictly rejected');

    // -------------------------------------------------------------
    // TEST 20: Cross-User P2P Quote Replay Rejected
    // -------------------------------------------------------------
    console.log('\n--- 20. Cross-User P2P Quote Replay ---');
    let crossUserP2pBlocked = false;
    try {
      // testAttackerId attempts to replay testAdvId's quote
      await acceptP2pFundingRequest(testAttackerId, {
        ...p2pQuoteConcurrent,
        advertiserId: testAttackerId,
      });
    } catch (e: any) {
      crossUserP2pBlocked =
        e.message.includes('CROSS_USER_QUOTE_REPLAY') ||
        e.message.includes('QUOTE_TAMPERED') ||
        e.message.includes('UNAUTHORIZED_ACTOR');
    }
    assert(crossUserP2pBlocked, '20.1 Different authenticated user replaying another user quote is rejected');

    // -------------------------------------------------------------
    // TEST 21: Quote Already Consumed (Settled) Replay Rejected
    // -------------------------------------------------------------
    console.log('\n--- 21. Quote Already Consumed Replay Rejected ---');
    // Enable P2P settlement temporarily to settle resP2p1
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'true';
    await settleP2pFunding(resP2p1.id, testAdminId, `EVID_P2P_${Date.now()}`);
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

    let consumedQuoteBlocked = false;
    try {
      await acceptP2pFundingRequest(testAdvId, p2pQuoteConcurrent);
    } catch (e: any) {
      consumedQuoteBlocked = e.message.includes('QUOTE_ALREADY_CONSUMED');
    }
    assert(consumedQuoteBlocked, '21.1 Quote already settled/consumed cannot be accepted again');

    // -------------------------------------------------------------
    // TEST 22: Duplicate Wallet Reservation & Ledger Invariants Prevented on Safe Retries
    // -------------------------------------------------------------
    console.log('\n--- 22. Duplicate Wallet Reservation & Ledger Invariant on Safe Retries ---');
    // Top up exchanger with $200
    await prisma.walletV2.update({
      where: { userId: testExchId },
      data: { availableCents: 20000, reservedCents: 0 },
    });
    const quoteInFlight = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 3000, // $30.00
    });

    const firstAccept = await acceptP2pFundingRequest(testAdvId, quoteInFlight);
    const exchAfterFirst = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    assert(exchAfterFirst.availableCents === 17000 && exchAfterFirst.reservedCents === 3000, '22.1 First accept reserves $30');

    // Safe retry 1
    const secondAccept = await acceptP2pFundingRequest(testAdvId, quoteInFlight);
    assert(secondAccept.id === firstAccept.id, '22.2 Safe retry returns identical request');

    // Safe retry 2
    const thirdAccept = await acceptP2pFundingRequest(testAdvId, quoteInFlight);
    assert(thirdAccept.id === firstAccept.id, '22.3 Repeated retry returns identical request');

    const exchAfterRetries = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    assert(
      exchAfterRetries.availableCents === 17000 && exchAfterRetries.reservedCents === 3000,
      '22.4 No duplicate wallet reservation: balances unchanged after multiple retries'
    );

    const ledgerCountForInFlight = await prisma.ledgerEntryV2.count({
      where: { fundingRequestId: firstAccept.id, entryType: LedgerV2EntryType.P2P_FUNDING_RESERVE },
    });
    assert(ledgerCountForInFlight === 1, '22.5 Exactly 1 ledger reservation entry across all safe retries');

    // -------------------------------------------------------------
    // TEST 23: Gold tradeRef Reused with a Forged Quote Rejected
    // -------------------------------------------------------------
    console.log('\n--- 23. Gold tradeRef Reused with Forged Quote Rejected ---');
    // Top up exchanger
    await prisma.walletV2.update({
      where: { userId: testExchId },
      data: { availableCents: 30000, reservedCents: 0 },
    });
    const validGoldQuoteForReuse = await generateGoldTradeQuote({
      sellerId: testAdvId,
      buyerId: testExchId,
      gameSlug: 'wow_midnight',
      goldQuantity: 100000,
      agreedValuationUsdCents: 1000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
    });
    const tradeInitial = await createGoldTradeOrder(validGoldQuoteForReuse);

    let forgedReuseBlocked = false;
    try {
      await createGoldTradeOrder({
        ...validGoldQuoteForReuse,
        agreedValuationUsdCents: 99999, // tampered amount with valid tradeRef
        quoteHash: '0000000000000000000000000000000000000000000000000000000000000000',
      });
    } catch (e: any) {
      forgedReuseBlocked = e.message.includes('QUOTE_TAMPERED') || e.message.includes('QUOTE_MISMATCH');
    }
    assert(forgedReuseBlocked, '23.1 Existing tradeRef with forged quote hash is strictly rejected');

    let termsMismatchBlocked = false;
    try {
      // Compute valid HMAC for modified terms but reusing old tradeRef
      const tamperedHmac = computeGoldTradeQuoteHash({
        tradeRef: validGoldQuoteForReuse.tradeRef,
        sellerId: validGoldQuoteForReuse.sellerId,
        buyerId: validGoldQuoteForReuse.buyerId,
        offerId: validGoldQuoteForReuse.acceptedOfferId,
        offerVersion: validGoldQuoteForReuse.offerVersion,
        feePayer: validGoldQuoteForReuse.feePayer,
        gameSlug: validGoldQuoteForReuse.gameSlug,
        region: validGoldQuoteForReuse.region,
        realm: validGoldQuoteForReuse.realm,
        faction: validGoldQuoteForReuse.faction,
        goldQuantity: 200000, // changed gold quantity!
        agreedValuationUsdCents: 2000, // changed price!
        settlementMethod: validGoldQuoteForReuse.settlementMethod,
        commissionPercentage: validGoldQuoteForReuse.commissionPercentage,
        quotedPayableAmount: validGoldQuoteForReuse.quotedPayableAmount,
        quotedPayableCurrency: validGoldQuoteForReuse.quotedPayableCurrency,
        expiresAt: new Date(validGoldQuoteForReuse.quoteExpiresAt),
      });

      await createGoldTradeOrder({
        ...validGoldQuoteForReuse,
        goldQuantity: 200000,
        agreedValuationUsdCents: 2000,
        quoteHash: tamperedHmac,
      });
    } catch (e: any) {
      termsMismatchBlocked = e.message.includes('QUOTE_MISMATCH');
    }
    assert(termsMismatchBlocked, '23.2 Existing tradeRef with altered terms (even with matching HMAC) is rejected with QUOTE_MISMATCH');

    // -------------------------------------------------------------
    // TEST 24: Gold tradeRef Reused with Valid Matching Terms (Safe Idempotency)
    // -------------------------------------------------------------
    console.log('\n--- 24. Gold tradeRef Reused with Matching Terms ---');
    const tradeRetried = await createGoldTradeOrder(validGoldQuoteForReuse);
    assert(tradeRetried.id === tradeInitial.id, '24.1 Re-creating order with exact same valid quote returns existing trade');

    const totalTradesForRef = await prisma.goldTrade.count({
      where: { tradeRef: validGoldQuoteForReuse.tradeRef },
    });
    assert(totalTradesForRef === 1, '24.2 No duplicate GoldTrade record created');

    // Accept it
    const acceptedTrade = await acceptGoldTrade(tradeInitial.id, testAdvId);
    assert(acceptedTrade.tradeStatus === GoldTradeStatus.FUNDS_RESERVED, '24.3 Accepted trade status is FUNDS_RESERVED');

    // Re-accepting returns the existing trade without duplicate reservation
    const exchBeforeReAccept = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    const reAccepted = await acceptGoldTrade(tradeInitial.id, testAdvId);
    const exchAfterReAccept = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    assert(reAccepted.id === acceptedTrade.id, '24.4 Re-accept returns same trade');
    assert(
      exchBeforeReAccept.availableCents === exchAfterReAccept.availableCents &&
      exchBeforeReAccept.reservedCents === exchAfterReAccept.reservedCents,
      '24.5 Re-accept does not duplicate wallet reservation'
    );

    // -------------------------------------------------------------
    // TEST 25: Missing Signing Secret Fail-Closed
    // -------------------------------------------------------------
    console.log('\n--- 25. Missing Signing Secret Fail-Closed ---');
    delete process.env.EXCHANGE_QUOTE_SIGNING_SECRET;
    let missingSecretBlockedP2p = false;
    try {
      await acceptP2pFundingRequest(testAdvId, quoteInFlight);
    } catch (e: any) {
      missingSecretBlockedP2p = e.message.includes('MISSING_EXCHANGE_QUOTE_SIGNING_SECRET');
    }
    process.env.EXCHANGE_QUOTE_SIGNING_SECRET = originalSecret;
    assert(missingSecretBlockedP2p, '25.1 Missing signing secret strictly fails closed on acceptP2pFundingRequest');

    // -------------------------------------------------------------
    // TEST 26: Failed Transaction Rollback Leaves Zero Trace
    // -------------------------------------------------------------
    console.log('\n--- 26. Failed Transaction Rollback ---');
    const exchBeforeFailed = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    const ledgerCountBefore = await prisma.ledgerEntryV2.count({ where: { userId: testExchId } });
    const fundingCountBefore = await prisma.advertiserFundingRequest.count();

    // Create quote for more than exchanger's available balance to force rollback
    const hugeQuote = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 9999999, // $99,999.99
    });

    let rollbackTriggered = false;
    try {
      await acceptP2pFundingRequest(testAdvId, hugeQuote);
    } catch (e: any) {
      rollbackTriggered = e.message.includes('INSUFFICIENT_EXCHANGER_USD_BACKING');
    }
    assert(rollbackTriggered, '26.1 Insufficient balance triggered expected error');

    const exchAfterFailed = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testExchId } });
    const ledgerCountAfter = await prisma.ledgerEntryV2.count({ where: { userId: testExchId } });
    const fundingCountAfter = await prisma.advertiserFundingRequest.count();

    assert(
      exchBeforeFailed.availableCents === exchAfterFailed.availableCents &&
      exchBeforeFailed.reservedCents === exchAfterFailed.reservedCents,
      '26.2 Exchanger wallet balances perfectly preserved on rollback'
    );
    assert(ledgerCountBefore === ledgerCountAfter, '26.3 Zero ledger entries created on rollback');
    assert(fundingCountBefore === fundingCountAfter, '26.4 Zero funding liabilities created on rollback');

    // -------------------------------------------------------------
    // TEST 27: No Phantom Wallet Credits on Acceptance
    // -------------------------------------------------------------
    console.log('\n--- 27. No Phantom Wallet Credits ---');
    const advWalletBeforeAccept = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testAdvId } });
    const freshP2pQuoteForCheck = await generateP2pFundingQuote({
      advertiserId: testAdvId,
      exchangerId: testExchId,
      offerId: p2pOffer.id,
      targetUsdCents: 2000,
    });
    await acceptP2pFundingRequest(testAdvId, freshP2pQuoteForCheck);
    const advWalletAfterAccept = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testAdvId } });
    assert(
      advWalletBeforeAccept.availableCents === advWalletAfterAccept.availableCents,
      '27.1 P2P quote acceptance never creates phantom available balance for advertiser'
    );

    // -------------------------------------------------------------
    // TEST 28: Database-Enforced quoteRef Uniqueness on AdvertiserFundingRequest
    // -------------------------------------------------------------
    console.log('\n--- 28. Database-Enforced quoteRef Uniqueness ---');
    let dbUniqueConstraintThrown = false;
    try {
      await prisma.advertiserFundingRequest.create({
        data: {
          fundingRef: `FUND_TEST_DUP_REF_${Date.now()}`,
          quoteRef: p2pQuoteConcurrent.quoteRef, // reuse existing unique quoteRef!
          advertiserId: testAdvId,
          fundingMethod: 'IRT_P2P',
          status: 'AWAITING_PAYMENT',
          targetUsdCents: 5000,
          externalCurrency: 'IRT',
          externalAmountUnits: '50000000',
        },
      });
    } catch (e: any) {
      dbUniqueConstraintThrown = e.message.includes('Unique constraint failed') || e.code === 'P2002';
    }
    assert(dbUniqueConstraintThrown, '28.1 Database partial unique index strictly prevents duplicate quoteRef insertion');

    console.log('\n============================================================');
    console.log('   ALL 28 PHASE 6 SECURITY HARDENING TESTS PASSED!          ');
    console.log('============================================================\n');
  } finally {
    // بازگردانی متغیرهای محیطی
    process.env.EXCHANGE_QUOTE_SIGNING_SECRET = originalSecret;
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

    // پاکسازی داده‌های تست
    await prisma.ledgerEntryV2.deleteMany({
      where: {
        userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId, testAdminId] },
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
      where: { userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId, testAdminId] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId, testAdminId] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [testAdvId, testExchId, testExch2Id, testAttackerId, testSuspendedExchId, testAdminId] } },
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
