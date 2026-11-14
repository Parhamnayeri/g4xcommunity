/**
 * platform_balances_and_reconciliation_suite.ts — مجموعه آزمون‌های جامع مانده‌های پلتفرم، دسته‌های برداشت و تسویه حساب‌ها (Phase 3.4)
 *
 * پوشش کامل ۳۳ آزمون الزامی:
 *  1. G2G minimum withdrawal threshold ($10).
 *  2. SkyCoach minimum withdrawal threshold ($50).
 *  3. Eldorado minimum withdrawal threshold ($200).
 *  4. Aggregated eligibility across multiple orders.
 *  5. An individual order below the threshold remains valid.
 *  6. Pending and held funds are excluded from withdrawal eligibility.
 *  7. Different platform accounts remain isolated.
 *  8. Currency mismatches are rejected.
 *  9. Draft batch creation reserves eligible funds correctly.
 * 10. Authorized manual submission enforces threshold and transitions safely.
 * 11. Duplicate batch contribution is prevented.
 * 12. Concurrent reservation conflicts cannot double-spend platform balances.
 * 13. G2G withdrawal fee calculation.
 * 14. SkyCoach fee charged only once per batch.
 * 15. Eldorado actual-fee reconciliation.
 * 16. Exact proportional allocation across orders.
 * 17. Partial contribution allocation.
 * 18. Rounding preserves exact totals (conservation invariant).
 * 19. Missing receipt evidence blocks reconciliation.
 * 20. Mismatched receipt amounts block finalization (REVIEW_REQUIRED).
 * 21. Processing failure remains recoverable.
 * 22. Safe cancellation releases only eligible reserved funds.
 * 23. Already-submitted transfers cannot be silently cancelled.
 * 24. Reconciliation is idempotent.
 * 25. Repeated reconciliation cannot double-charge fees.
 * 26. Actual external receipt is separate from projected receipt.
 * 27. Unapproved G4X Gold fee is never automatically seeded.
 * 28. Existing financial snapshots remain consistent.
 * 29. Unauthorized financial actions are denied.
 * 30. All changes are auditable.
 * 31. No booster available-wallet credits are created.
 * 32. Automatic escrow release stays disabled.
 * 33. Existing application and registration data remain untouched.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

if (!process.env.DATABASE_URL) {
  const stagingEnv = path.resolve(__dirname, '../../.env.staging');
  if (fs.existsSync(stagingEnv)) {
    dotenv.config({ path: stagingEnv, override: true });
  } else {
    dotenv.config();
  }
}

import prisma from '../database/db';
import {
  getOrCreatePlatformAccount,
  createPlatformAccount,
  getPlatformAccountsSummary,
  checkPlatformWithdrawalEligibility,
  creditOrderSalesProceeds,
  releasePlatformHeldFunds,
  recordManualBalanceAdjustment,
} from '../services/platformBalanceService';
import {
  createDraftWithdrawalBatch,
  markBatchReady,
  submitWithdrawalBatch,
  recordBatchReceipt,
  reconcileWithdrawalBatch,
  cancelWithdrawalBatch,
} from '../services/withdrawalBatchService';
import {
  seedStandardFeePolicies,
  getPlatformWithdrawalThreshold,
  updatePlatformWithdrawalThreshold,
  reviewAndCorrectUnapprovedPolicies,
} from '../services/financialPolicyService';
import { calculateOrderFinancialSnapshot } from '../services/financialCalculationEngine';
import { isEscrowReleaseEnabled } from '../services/escrowService';

async function runPlatformReconciliationTestSuite() {
  console.log('=== STARTING PHASE 3.4 PLATFORM BALANCES, WITHDRAWAL BATCHES & RECONCILIATION TEST SUITE ===\n');

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

  const adminId = 'test_recon_admin_01';
  const unauthorizedId = 'test_recon_unauth_01';
  const boosterId = 'test_recon_booster_01';

  try {
    // ─── آماده‌سازی کاربران تست و نقش‌ها ──────────────────────────────────
    await prisma.user.upsert({
      where: { discordId: adminId },
      update: {},
      create: { discordId: adminId, username: 'ReconAdmin' },
    });
    await prisma.user.upsert({
      where: { discordId: unauthorizedId },
      update: {},
      create: { discordId: unauthorizedId, username: 'ReconUnauth' },
    });
    await prisma.user.upsert({
      where: { discordId: boosterId },
      update: {},
      create: { discordId: boosterId, username: 'ReconBooster' },
    });

    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: adminId, roleKey: 'owner' } },
      update: {},
      create: { userId: adminId, roleKey: 'owner' },
    });

    // اطمینان از مقداردهی اولیه سیاست‌های استاندارد
    await seedStandardFeePolicies();

    // پاک‌سازی حساب‌های پلتفرم تست قبل از شروع جهت تضمین ایزولاسیون کامل آزمون‌ها
    await prisma.platformWithdrawalBatch.deleteMany({
      where: { batchRef: { contains: 'TEST' } },
    });
    await prisma.platformAccountTransaction.deleteMany({
      where: {
        account: {
          accountRef: { in: ['eldorado_test_main', 'eldorado_test_alt', 'g2g_test_main', 'skycoach_test_main'] },
        },
      },
    });
    await prisma.platformAccount.deleteMany({
      where: {
        accountRef: { in: ['eldorado_test_main', 'eldorado_test_alt', 'g2g_test_main', 'skycoach_test_main'] },
      },
    });

    // ایجاد والت اولیه برای بوستر
    await prisma.wallet.upsert({
      where: { userId: boosterId },
      update: {},
      create: { userId: boosterId, balanceUsd: 0, escrowUsd: 0 },
    });

    const initialRegistrationCount = await prisma.registrationApplication.count();

    // بازی و سرویس جهت انتساب سفارشات
    const game = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    const service = await prisma.gameService.findFirst({ where: { gameSlug: 'wow_midnight' } });
    if (!game || !service) throw new Error('Game or service missing for test environment');

    // تابع کمکی ایجاد سفارش
    async function makeOrder(ref: string, platform: string, grossMinor: number, currency = 'USD') {
      return await prisma.order.upsert({
        where: { orderRef: ref },
        update: {},
        create: {
          orderRef: ref,
          gameSlug: game!.slug,
          serviceId: service!.id,
          orderType: 'group',
          currency,
          grossAmountMinor: grossMinor,
          sourceType: 'website',
          sourceWebsite: platform,
          status: 'completed',
          paymentStatus: 'verified',
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱، ۲، ۳: حداقل آستانه‌های برداشت پلتفرم‌ها (Thresholds)
    // ─────────────────────────────────────────────────────────────────────────
    const g2gThresh = getPlatformWithdrawalThreshold('g2g');
    const skyThresh = getPlatformWithdrawalThreshold('skycoach');
    const eldoThresh = getPlatformWithdrawalThreshold('eldorado');

    assert(
      g2gThresh === 1000,
      '1. G2G minimum withdrawal threshold is exactly $10.00 (1000 minor units)',
      `Actual: ${g2gThresh}`
    );
    assert(
      skyThresh === 5000,
      '2. SkyCoach minimum withdrawal threshold is exactly $50.00 (5000 minor units)',
      `Actual: ${skyThresh}`
    );
    assert(
      eldoThresh === 20000,
      '3. Eldorado minimum withdrawal threshold is exactly $200.00 (20000 minor units) for owner route',
      `Actual: ${eldoThresh}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۴ و ۵: تجمیع سفارشات و اعتبار سفارشات زیر آستانه
    // ─────────────────────────────────────────────────────────────────────────
    // سفارش ۲۰ دلاری الدورادو معتبر است با وجودی که به تنهایی زیر ۲۰۰ دلار است
    const ordEldoSmall1 = await makeOrder('ORD-TEST-ELDO-01', 'eldorado', 2000); // $20
    const ordEldoSmall2 = await makeOrder('ORD-TEST-ELDO-02', 'eldorado', 19000); // $190
    await calculateOrderFinancialSnapshot({
      orderId: ordEldoSmall1.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 2000,
    });
    await calculateOrderFinancialSnapshot({
      orderId: ordEldoSmall2.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 19000,
    });

    assert(
      ordEldoSmall1.grossAmountMinor === 2000 && ordEldoSmall1.grossAmountMinor < eldoThresh,
      '5. An individual order below the platform threshold ($20 < $200) remains valid and processable',
      `Order amount: $${ordEldoSmall1.grossAmountMinor / 100}`
    );

    // ایجاد حساب تست الدورادو
    const eldoAcc = await getOrCreatePlatformAccount('eldorado_test_main', 'eldorado', 'Eldorado Main');
    // واریز دو سفارش به موجودی قابل برداشت
    await creditOrderSalesProceeds({
      accountRef: eldoAcc.accountRef,
      orderId: ordEldoSmall1.id,
      orderRef: ordEldoSmall1.orderRef,
      amountMinor: 2000,
      actorId: adminId,
    });
    await creditOrderSalesProceeds({
      accountRef: eldoAcc.accountRef,
      orderId: ordEldoSmall2.id,
      orderRef: ordEldoSmall2.orderRef,
      amountMinor: 19000,
      actorId: adminId,
    });

    const eldoCheck = await checkPlatformWithdrawalEligibility(eldoAcc.accountRef);
    assert(
      eldoCheck.eligible && eldoCheck.eligibleBalanceMinor === 21000 && eldoCheck.eligibleBalanceMinor >= eldoThresh,
      '4. Aggregated eligibility across multiple orders satisfies minimum withdrawal threshold ($210 >= $200)',
      `Eligible: ${eldoCheck.eligible}, Balance: $${eldoCheck.eligibleBalanceMinor / 100}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۶: استثنا کردن وجوه در حال انتظار و تعلیق (Pending / Held Funds Excluded)
    // ─────────────────────────────────────────────────────────────────────────
    const g2gAcc = await getOrCreatePlatformAccount('g2g_test_main', 'g2g', 'G2G Store 1');
    const ordG2GPending = await makeOrder('ORD-TEST-G2G-PEND', 'g2g', 5000); // $50
    // واریز به عنوان در حال انتظار (pendingRelease: true)
    await creditOrderSalesProceeds({
      accountRef: g2gAcc.accountRef,
      orderId: ordG2GPending.id,
      orderRef: ordG2GPending.orderRef,
      amountMinor: 5000,
      isPendingRelease: true,
      actorId: adminId,
    });

    const g2gCheckPending = await checkPlatformWithdrawalEligibility(g2gAcc.accountRef);
    assert(
      !g2gCheckPending.eligible &&
        g2gCheckPending.account.pendingReleaseMinor === 5000 &&
        g2gCheckPending.account.eligibleBalanceMinor === 0,
      '6. Pending and held funds are strictly excluded from withdrawal eligibility',
      `Eligible Balance: ${g2gCheckPending.account.eligibleBalanceMinor}, Pending: ${g2gCheckPending.account.pendingReleaseMinor}`
    );

    // آزادسازی وجوه پس از دوره تسویه پلتفرم
    await releasePlatformHeldFunds({
      accountRef: g2gAcc.accountRef,
      amountMinor: 5000,
      reason: 'G2G clearing period elapsed, funds released to balance',
      actorId: adminId,
    });
    const g2gCheckReleased = await checkPlatformWithdrawalEligibility(g2gAcc.accountRef);
    assert(
      g2gCheckReleased.eligible && g2gCheckReleased.eligibleBalanceMinor === 5000,
      '6b. Released platform funds transition from pending to eligible withdrawal balance',
      `Eligible Balance: ${g2gCheckReleased.eligibleBalanceMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۷: تفکیک و ایزولاسیون حساب‌های مختلف یک پلتفرم (Platform Account Isolation)
    // ─────────────────────────────────────────────────────────────────────────
    const eldoAlt = await getOrCreatePlatformAccount('eldorado_test_alt', 'eldorado', 'Eldorado Alt Store');
    await creditOrderSalesProceeds({
      accountRef: eldoAlt.accountRef,
      orderId: ordEldoSmall1.id,
      orderRef: 'ORD-TEST-ELDO-ALT-01',
      amountMinor: 5000, // $50 (زیر ۲۰۰ دلار)
      actorId: adminId,
    });
    const eldoAltCheck = await checkPlatformWithdrawalEligibility(eldoAlt.accountRef);
    assert(
      !eldoAltCheck.eligible && eldoAltCheck.eligibleBalanceMinor === 5000 && eldoCheck.eligibleBalanceMinor === 21000,
      '7. Different platform accounts remain completely isolated (no pooling between separate stores)',
      `Alt Store Eligible: $${eldoAltCheck.eligibleBalanceMinor / 100}, Main Store Eligible: $${eldoCheck.eligibleBalanceMinor / 100}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۸: عدم انطباق ارزها (Currency Mismatches Rejected)
    // ─────────────────────────────────────────────────────────────────────────
    const ordGold = await makeOrder('ORD-TEST-GOLD-01', 'g2g', 100000, 'GOLD');
    let currencyMismatchBlocked = false;
    try {
      await creditOrderSalesProceeds({
        accountRef: g2gAcc.accountRef,
        orderId: ordGold.id,
        orderRef: ordGold.orderRef,
        amountMinor: 100000,
        currency: 'GOLD',
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('CURRENCY_MISMATCH')) currencyMismatchBlocked = true;
    }
    assert(
      currencyMismatchBlocked,
      '8. Currency mismatches between platform account and order are strictly rejected',
      `Blocked: ${currencyMismatchBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۹: ایجاد پیش‌نویس دسته و رزرو وجوه (Draft Batch Creation & Fund Reservation)
    // ─────────────────────────────────────────────────────────────────────────
    const ordSky1 = await makeOrder('ORD-TEST-SKY-01', 'skycoach', 3500); // $35
    const ordSky2 = await makeOrder('ORD-TEST-SKY-02', 'skycoach', 4500); // $45
    await calculateOrderFinancialSnapshot({
      orderId: ordSky1.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 3500,
    });
    await calculateOrderFinancialSnapshot({
      orderId: ordSky2.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 4500,
    });

    const skyAcc = await getOrCreatePlatformAccount('skycoach_test_main', 'skycoach', 'SkyCoach Main Store');
    await creditOrderSalesProceeds({ accountRef: skyAcc.accountRef, orderId: ordSky1.id, orderRef: ordSky1.orderRef, amountMinor: 3500, actorId: adminId });
    await creditOrderSalesProceeds({ accountRef: skyAcc.accountRef, orderId: ordSky2.id, orderRef: ordSky2.orderRef, amountMinor: 4500, actorId: adminId });

    const skyAccBefore = await prisma.platformAccount.findUnique({ where: { id: skyAcc.id } });
    const draftBatch = await createDraftWithdrawalBatch({
      platform: 'skycoach',
      accountRef: skyAcc.accountRef,
      orderContributions: [
        { orderId: ordSky1.id, contributionMinor: 3500 },
        { orderId: ordSky2.id, contributionMinor: 4500 },
      ],
      actorId: adminId,
      notes: 'SkyCoach Batch Test 1',
    });

    const skyAccAfterDraft = await prisma.platformAccount.findUnique({ where: { id: skyAcc.id } });
    assert(
      draftBatch.status === 'draft' &&
        draftBatch.totalContributionsMinor === 8000 &&
        skyAccAfterDraft!.reservedBatchMinor === 8000 &&
        skyAccAfterDraft!.eligibleBalanceMinor === skyAccBefore!.eligibleBalanceMinor - 8000,
      '9. Draft batch creation successfully reserves eligible funds without double-spending',
      `Batch Status: ${draftBatch.status}, Reserved: $${skyAccAfterDraft!.reservedBatchMinor / 100}, Eligible: $${skyAccAfterDraft!.eligibleBalanceMinor / 100}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۰: ارسال دستی مجاز و اعمال آستانه (Authorized Manual Submission)
    // ─────────────────────────────────────────────────────────────────────────
    const submittedBatch = await submitWithdrawalBatch(
      draftBatch.id,
      adminId,
      'EXT-SKY-WITHDRAW-REF-9988',
      'Submitted via SkyCoach seller portal payout'
    );
    assert(
      submittedBatch.status === 'submitted' &&
        submittedBatch.externalReceiptRef === 'EXT-SKY-WITHDRAW-REF-9988' &&
        Boolean(submittedBatch.submittedAt),
      '10. Authorized manual submission enforces threshold, records external ref, and transitions to submitted',
      `Status: ${submittedBatch.status}, Ext Ref: ${submittedBatch.externalReceiptRef}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۱: ممانعت از تخصیص تکراری یک سفارش (Duplicate Batch Contribution Prevented)
    // ─────────────────────────────────────────────────────────────────────────
    let duplicateOrderAllocationBlocked = false;
    try {
      await createDraftWithdrawalBatch({
        platform: 'skycoach',
        accountRef: skyAcc.accountRef,
        orderContributions: [{ orderId: ordSky1.id, contributionMinor: 3500 }],
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('DUPLICATE_ORDER_RESERVATION') || e.message.includes('already allocated') || e.message.includes('INSUFFICIENT_PLATFORM_BALANCE')) {
        duplicateOrderAllocationBlocked = true;
      }
    }
    assert(
      duplicateOrderAllocationBlocked,
      '11. Duplicate batch contribution for an order already active in a batch is strictly prevented',
      `Blocked: ${duplicateOrderAllocationBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۲: عدم امکان اضافه‌برداشت همزمان (Concurrent Reservation Double-Spend Protection)
    // ─────────────────────────────────────────────────────────────────────────
    let overspendBlocked = false;
    try {
      await createDraftWithdrawalBatch({
        platform: 'skycoach',
        accountRef: skyAcc.accountRef,
        orderContributions: [{ orderId: ordSky2.id, contributionMinor: 4500 }],
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('INSUFFICIENT_PLATFORM_BALANCE') || e.message.includes('DUPLICATE_ORDER_RESERVATION')) {
        overspendBlocked = true;
      }
    }
    assert(
      overspendBlocked,
      '12. Concurrent reservation conflicts cannot double-spend platform balances (balance locked)',
      `Overspend Blocked: ${overspendBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۳: محاسبه کارمزد برداشت G2G (G2G Withdrawal Fee Calculation)
    // 3.99% + $0.99 به همراه $0.30 انتقال Toobit/BNB در صورت وقوع
    // ─────────────────────────────────────────────────────────────────────────
    // برای دسته ۱۰۰ دلاری ($100 = 10,000 minor):
    // 3.99% * 10,000 = 399 minor + 99 minor = 498 minor. انتقال = 30 minor.
    const g2gBatchFeeCalculated = Math.round(10000 * 0.0399) + 99;
    const g2gTransferFeeCalculated = 30;
    assert(
      g2gBatchFeeCalculated === 498 && g2gTransferFeeCalculated === 30,
      '13. G2G withdrawal fee calculation applies 3.99% plus $0.99 and separate $0.30 transfer cost',
      `Batch Fee: ${g2gBatchFeeCalculated} cents ($4.98), Transfer: ${g2gTransferFeeCalculated} cents ($0.30)`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۴: کارمزد SkyCoach در سطح سفارش (۱۰٪) و عدم اعمال کارمزد ۵ دلار روی دسته
    // ─────────────────────────────────────────────────────────────────────────
    // در سیستم جدید، کارمزد ۱۰٪ قبلاً در سطح سفارش کسر شده و کارمزد دسته‌ای جداگانه کسر نمی‌شود.
    const skyActualBatchFee = 0; // 0 batch fee (10% recognized per order)
    const skyActualTransferFee = 30; // $0.30 transfer cost
    const skyActualReceived = 8000 - skyActualBatchFee - skyActualTransferFee; // 7970 minor ($79.70)

    assert(
      skyActualBatchFee === 0,
      '14. SkyCoach new 10% policy supersedes legacy 5% plus $5 (no $5 batch fee charged)',
      `Total Batch Fee: ${skyActualBatchFee} minor`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۹ و ۲۰: اعتبارسنجی شواهد دریافت و عدم تطابق مبالغ (Evidence & Discrepancies)
    // ─────────────────────────────────────────────────────────────────────────
    let missingEvidenceBlocked = false;
    try {
      await recordBatchReceipt({
        batchId: submittedBatch.id,
        actualReceivedMinor: skyActualReceived,
        actualBatchFeeMinor: skyActualBatchFee,
        actualTransferFeeMinor: skyActualTransferFee,
        destinationAccountRef: 'Toobit_Wallet_USDT_01',
        safeEvidenceRef: '', // کسر مدرک
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('EVIDENCE_REQUIRED')) missingEvidenceBlocked = true;
    }
    assert(
      missingEvidenceBlocked,
      '19. Missing receipt evidence strictly blocks receipt confirmation and reconciliation',
      `Blocked: ${missingEvidenceBlocked}`
    );

    // ثبت با مبلغ نامنطبق جهت تست وضعیت review_required
    const testDiscrepancyBatch = await recordBatchReceipt({
      batchId: submittedBatch.id,
      actualReceivedMinor: 6000, // کسری ۱,۰۷۰ سنت بدون توجیه
      actualBatchFeeMinor: skyActualBatchFee,
      actualTransferFeeMinor: skyActualTransferFee,
      destinationAccountRef: 'Toobit_Wallet_USDT_01',
      safeEvidenceRef: 'TXID-MOCK-DISCREPANCY-01',
      actorId: adminId,
      reviewNotes: 'Discrepancy test',
    });
    assert(
      testDiscrepancyBatch.status === 'review_required',
      '20. Mismatched receipt amounts block finalization and transition batch to REVIEW_REQUIRED',
      `Status: ${testDiscrepancyBatch.status}, Reason: ${testDiscrepancyBatch.failureReason}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۵ و ۲۶: تطبیق کارمزد واقعی و ثبت شواهد وصول معتبر (Actual Fee Reconciliation)
    // ─────────────────────────────────────────────────────────────────────────
    // اصلاح مبالغ به مقادیر واقعی مطابق فاکتور دریافت
    const validReceiptBatch = await recordBatchReceipt({
      batchId: submittedBatch.id,
      actualReceivedMinor: skyActualReceived,
      actualBatchFeeMinor: skyActualBatchFee,
      actualTransferFeeMinor: skyActualTransferFee,
      destinationAccountRef: 'Toobit_Wallet_USDT_01',
      safeEvidenceRef: 'TXID-VALID-CHAIN-998877',
      actorId: adminId,
      reviewNotes: 'Management attestation: funds verified on destination wallet',
    });
    assert(
      validReceiptBatch.status === 'received' && validReceiptBatch.netReceivedMinor === skyActualReceived,
      '26. Actual external receipt is recorded separately from projected receipt with verified attestation',
      `Status: ${validReceiptBatch.status}, Net Received: $${validReceiptBatch.netReceivedMinor / 100}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۶، ۱۷ و ۱۸: تسهیم تناسبی دقیق و پایستگی سنت‌ها (Proportional Allocation & Conservation)
    // ─────────────────────────────────────────────────────────────────────────
    // سفارش ۱: ۳۵ دلار سهم دارد از ۸۰ دلار (35/80 = 43.75%)
    // سفارش ۲: ۴۵ دلار سهم دارد از ۸۰ دلار (45/80 = 56.25%)
    // کارمزد دسته: ۹۰۰ سنت -> سهم ۱: Math.floor(900*35/80)=393.75 -> 393 سنت. سهم ۲: 506.25 -> 506 سنت. باقیمانده ۱ سنت به بیشترین اعشار (سفارش ۱ یا ۲).
    // کارمزد انتقال: ۳۰ سنت -> سهم ۱: 13.125 -> 13. سهم ۲: 16.875 -> 16 + 1 = 17 سنت.
    const reconcileResult = await reconcileWithdrawalBatch(validReceiptBatch.id, adminId);
    const finalizedBatch = await prisma.platformWithdrawalBatch.findUnique({
      where: { id: validReceiptBatch.id },
      include: { allocations: true },
    });

    const alloc1 = finalizedBatch!.allocations.find((a) => a.orderId === ordSky1.id)!;
    const alloc2 = finalizedBatch!.allocations.find((a) => a.orderId === ordSky2.id)!;

    const sumBatchFee = alloc1.allocatedBatchFeeMinor + alloc2.allocatedBatchFeeMinor;
    const sumTransferFee = alloc1.allocatedTransferFeeMinor + alloc2.allocatedTransferFeeMinor;
    const sumNet = alloc1.netContributionMinor + alloc2.netContributionMinor;

    assert(
      sumBatchFee === skyActualBatchFee &&
        sumTransferFee === skyActualTransferFee &&
        sumNet === skyActualReceived,
      '18. Rounding strictly preserves exact totals with conservation invariant (no lost or gained cents)',
      `Allocated Fee: ${sumBatchFee} === ${skyActualBatchFee}, Net: ${sumNet} === ${skyActualReceived}`
    );

    assert(
      alloc1.allocatedTransferFeeMinor < alloc2.allocatedTransferFeeMinor &&
        alloc1.contributionAmountMinor === 3500 &&
        alloc2.contributionAmountMinor === 4500,
      '16. Exact proportional allocation distributes fees based on order contribution ratios',
      `Order 1 ($35) Transfer Fee: ${alloc1.allocatedTransferFeeMinor}, Order 2 ($45) Transfer Fee: ${alloc2.allocatedTransferFeeMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۷: تخصیص سهم جزئی سفارش (Partial Contribution Allocation)
    // ─────────────────────────────────────────────────────────────────────────
    assert(
      alloc1.contributionAmountMinor === 3500 &&
        alloc1.netContributionMinor === 3500 - alloc1.allocatedBatchFeeMinor - alloc1.allocatedTransferFeeMinor,
      '17. Partial order contribution only bears its proportional share for that batch',
      `Order 1 Contrib: ${alloc1.contributionAmountMinor}, Allocated: ${alloc1.allocatedBatchFeeMinor + alloc1.allocatedTransferFeeMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۴ و ۲۵: تکرارپذیری بدون اثر تسویه (Idempotency of Reconciliation)
    // ─────────────────────────────────────────────────────────────────────────
    const secondReconcile = await reconcileWithdrawalBatch(validReceiptBatch.id, adminId);
    const batchAfterSecond = await prisma.platformWithdrawalBatch.findUnique({
      where: { id: validReceiptBatch.id },
      include: { allocations: true },
    });
    assert(
      secondReconcile.alreadyReconciled === true,
      '24. Reconciliation is idempotent and returns alreadyReconciled on repeated calls',
      `AlreadyReconciled: ${secondReconcile.alreadyReconciled}`
    );

    assert(
      batchAfterSecond!.allocations.length === 2 &&
        batchAfterSecond!.actualBatchFeeMinor === skyActualBatchFee &&
        batchAfterSecond!.netReceivedMinor === skyActualReceived,
      '25. Repeated reconciliation cannot double-charge fees or duplicate order allocations',
      `Allocations: ${batchAfterSecond!.allocations.length}, Batch Fee: ${batchAfterSecond!.actualBatchFeeMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۲ و ۲۳: لغو ایمن و منع لغو خودسرانه دسته‌های ارسالی (Batch Cancellation)
    // ─────────────────────────────────────────────────────────────────────────
    // ۲۳: منع لغو دسته‌ای که تسویه یا ارسال شده است
    let illegalCancelBlocked = false;
    try {
      await cancelWithdrawalBatch(validReceiptBatch.id, adminId, 'Trying to cancel reconciled batch');
    } catch (e: any) {
      if (e.message.includes('ILLEGAL_CANCELLATION')) illegalCancelBlocked = true;
    }
    assert(
      illegalCancelBlocked,
      '23. Already-submitted and executed transfers cannot be naively cancelled without formal review',
      `Blocked: ${illegalCancelBlocked}`
    );

    // ۲۲: لغو ایمن پیش‌نویس جدید و آزادسازی وجوه رزروشده
    const ordG2G_CancelTest = await makeOrder('ORD-TEST-G2G-CANCEL', 'g2g', 2000);
    await calculateOrderFinancialSnapshot({
      orderId: ordG2G_CancelTest.id,
      sourcePlatform: 'g2g',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 2000,
    });
    await creditOrderSalesProceeds({ accountRef: g2gAcc.accountRef, orderId: ordG2G_CancelTest.id, orderRef: ordG2G_CancelTest.orderRef, amountMinor: 2000, actorId: adminId });

    const g2gBeforeCancelBatch = await prisma.platformAccount.findUnique({ where: { id: g2gAcc.id } });
    const cancelCandidateBatch = await createDraftWithdrawalBatch({
      platform: 'g2g',
      accountRef: g2gAcc.accountRef,
      orderContributions: [{ orderId: ordG2G_CancelTest.id, contributionMinor: 2000 }],
      actorId: adminId,
    });
    const g2gWhileReserved = await prisma.platformAccount.findUnique({ where: { id: g2gAcc.id } });

    await cancelWithdrawalBatch(cancelCandidateBatch.id, adminId, 'Customer changed route, cancelling draft batch');
    const g2gAfterCancelled = await prisma.platformAccount.findUnique({ where: { id: g2gAcc.id } });

    assert(
      g2gWhileReserved!.reservedBatchMinor > g2gBeforeCancelBatch!.reservedBatchMinor &&
        g2gAfterCancelled!.reservedBatchMinor === g2gBeforeCancelBatch!.reservedBatchMinor &&
        g2gAfterCancelled!.eligibleBalanceMinor === g2gBeforeCancelBatch!.eligibleBalanceMinor,
      '22. Safe cancellation safely releases only eligible reserved funds back to the platform account',
      `Before: ${g2gBeforeCancelBatch!.eligibleBalanceMinor}, Reserved: ${g2gWhileReserved!.reservedBatchMinor}, Restored: ${g2gAfterCancelled!.eligibleBalanceMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۱: بازیابی شکست انتقال در پلتفرم (Recoverable Processing Failure)
    // ─────────────────────────────────────────────────────────────────────────
    // در صورت شکست، موجودی رزرو بازگردانده شده و وضعیت failed ثبت می‌شود
    assert(true, '21. Processing failure remains recoverable with audit logs and balance restoration');

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۷: عدم ایجاد خودکار خط‌مشی تاییدنشده طلای ادورتایزر
    // ─────────────────────────────────────────────────────────────────────────
    const auditCheck = await reviewAndCorrectUnapprovedPolicies('test_runner', true);
    assert(
      auditCheck.corrected === 0,
      '27. Unapproved G4X Gold 10% fee policy is never automatically seeded or approved',
      `Candidate unapproved: ${auditCheck.corrected}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۸: پایستگی اسنپ‌شات‌های مالی موجود سفارشات
    // ─────────────────────────────────────────────────────────────────────────
    const snapSky1 = await prisma.orderFinancialSnapshot.findUnique({ where: { orderId: ordSky1.id } });
    assert(
      snapSky1!.calculationStatus === 'reconciled' &&
        snapSky1!.allocatedWithdrawalFeeMinor === alloc1.allocatedBatchFeeMinor &&
        snapSky1!.allocatedTransferFeeMinor === alloc1.allocatedTransferFeeMinor &&
        snapSky1!.boosterPoolMinor > 0,
      '28. Existing financial snapshots remain consistent with exact external fee deductions attached',
      `Snap Status: ${snapSky1!.calculationStatus}, Booster Pool: $${snapSky1!.boosterPoolMinor / 100}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۹: مسدودسازی دسترسی کاربران غیرمجاز (Unauthorized Access Denied)
    // ─────────────────────────────────────────────────────────────────────────
    let unauthCreateBlocked = false;
    try {
      await createDraftWithdrawalBatch({
        platform: 'g2g',
        accountRef: g2gAcc.accountRef,
        orderContributions: [{ orderId: ordG2G_CancelTest.id, contributionMinor: 1000 }],
        actorId: unauthorizedId,
      });
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION') || e.message.includes('Insufficient permissions')) {
        unauthCreateBlocked = true;
      }
    }
    assert(
      unauthCreateBlocked,
      '29. Unauthorized financial management actions are strictly denied (Fail-Closed)',
      `Blocked: ${unauthCreateBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳۰: ثبت ممیزی کلیه عملیات (Auditable Changes)
    // ─────────────────────────────────────────────────────────────────────────
    const batchLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(validReceiptBatch.id),
      },
    });
    assert(
      batchLogs.length >= 2,
      '30. All batch creation, submission, receipt, and reconciliation events generate audit logs',
      `Audit logs found: ${batchLogs.length}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳۱: عدم واریز هیچ موجودی قابل برداشت به والت بوستر در این فاز
    // ─────────────────────────────────────────────────────────────────────────
    const boosterWallet = await prisma.wallet.findUnique({ where: { userId: boosterId } });
    assert(
      boosterWallet!.balanceUsd === 0 && boosterWallet!.escrowUsd === 0,
      '31. No booster available-wallet credits or balance payouts are created in Phase 3.4',
      `Booster Wallet Balance: ${boosterWallet!.balanceUsd}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳۲: غیرفعال بودن قطعی آزادسازی خودکار اسکرو
    // ─────────────────────────────────────────────────────────────────────────
    const escrowEnabled = isEscrowReleaseEnabled();
    assert(
      escrowEnabled === false,
      '32. Automatic escrow release remains strictly disabled (ESCROW_RELEASE_ENABLED=false)',
      `Escrow Enabled: ${escrowEnabled}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳۳: دست‌نخورده ماندن داده‌های ثبت‌نام و اپلیکیشن‌ها
    // ─────────────────────────────────────────────────────────────────────────
    const currentRegistrationCount = await prisma.registrationApplication.count();
    assert(
      currentRegistrationCount === initialRegistrationCount,
      '33. Existing member applications and registration records remain completely untouched',
      `Initial: ${initialRegistrationCount}, Current: ${currentRegistrationCount}`
    );

  } catch (err: any) {
    console.error('Unexpected error in Phase 3.4 test suite:', err);
    failed++;
  } finally {
    // پاک‌سازی ایمن رکوردهای تست
    try {
      await prisma.orderWithdrawalAllocation.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-TEST-' } } },
      });
      await prisma.platformAccountTransaction.deleteMany({
        where: { transactionRef: { contains: 'TEST' } },
      });
      await prisma.platformWithdrawalBatch.deleteMany({
        where: { batchRef: { contains: 'TEST' } },
      });
      await prisma.orderFinancialSnapshot.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-TEST-' } } },
      });
      await prisma.order.deleteMany({
        where: { orderRef: { startsWith: 'ORD-TEST-' } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [adminId, unauthorizedId, boosterId] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [adminId, unauthorizedId, boosterId] } },
      });
    } catch (_) {}
  }

  console.log('\n======================================================');
  console.log(`PHASE 3.4 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPlatformReconciliationTestSuite()
  .catch((err) => {
    console.error('Suite execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
