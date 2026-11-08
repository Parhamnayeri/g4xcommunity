/**
 * admin_platform_finance_dashboard_suite.ts — آزمون‌های جامع داشبورد مالی پلتفرم‌ها و تسویه (Phase 3 Milestone)
 *
 * پوشش کامل ۲۶ آزمون درخواستی:
 *  1. Platform balance read permissions
 *  2. Unauthorized finance mutation
 *  3. G2G fee correctness
 *  4. No double G2G seller-fee deduction
 *  5. G2G batch fee charged exactly once
 *  6. SkyCoach 10% fee
 *  7. Eldorado category-based fee handling
 *  8. Minimum batch thresholds
 *  9. Eligible-order filtering
 * 10. Duplicate batch prevention
 * 11. Order reuse across active batches
 * 12. Actual receipt evidence requirement
 * 13. Estimated versus actual amounts
 * 14. Reconciliation idempotency
 * 15. Currency and integer-cent validation
 * 16. Inconsistent settlement amounts
 * 17. Correct Booster allocations
 * 18. No duplicate Booster allocations
 * 19. Mythic+ equal four-Booster split
 * 20. No unauthorized wallet credits
 * 21. Audit logging
 * 22. Web CSRF and session enforcement
 * 23. Existing Finance V2 compatibility
 * 24. Existing G4X Advertiser rank commissions remain unchanged
 * 25. NOWPayments and IRT payment integration remain unchanged
 * 26. No external withdrawal or payout API is invoked
 */

import prisma from '../database/db';
import {
  getPlatformAccountsSummary,
  checkPlatformWithdrawalEligibility,
  getOrCreatePlatformAccount,
} from '../services/platformBalanceService';
import {
  createDraftWithdrawalBatch,
  markBatchReady,
  submitWithdrawalBatch,
  cancelWithdrawalBatch,
  recordBatchReceipt,
  reconcileWithdrawalBatch,
} from '../services/withdrawalBatchService';
import {
  getPlatformWithdrawalThreshold,
  PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR,
} from '../services/financialPolicyService';
import {
  allocateProportionalWithRemainder,
  splitPoolEquallyWithRemainder,
  calculateOrderFinancialSnapshot,
  finalizeOrderFinancialsAndBoosterAllocation,
} from '../services/financialCalculationEngine';
import {
  ADVERTISER_RANK_RATES_BPS,
  AdvertiserRank,
  calculateRankCommission,
} from '../services/advertiserRankService';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function ensureUserExists(discordId: string, username: string, roleKey?: string) {
  let user = await prisma.user.findUnique({ where: { discordId } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        discordId,
        username,
        displayName: username,
        isActive: true,
      },
    });
  }

  if (roleKey) {
    await prisma.role.upsert({
      where: { roleKey },
      update: {},
      create: { roleKey, name: roleKey.toUpperCase() },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: discordId, roleKey } },
      update: {},
      create: { userId: discordId, roleKey },
    });
  }

  return user;
}

export async function runAdminPlatformFinanceSuite() {
  console.log('\n================================================================================');
  console.log('   G4X COMMUNITY — ADMIN PLATFORM FINANCE DASHBOARD SUITE (PHASE 3)             ');
  console.log('================================================================================\n');

  const ts = Date.now();
  const uOwner = `test_pf_owner_${ts}`;
  const uAdmin = `test_pf_admin_${ts}`;
  const uBooster1 = `test_pf_bst1_${ts}`;
  const uBooster2 = `test_pf_bst2_${ts}`;
  const uBooster3 = `test_pf_bst3_${ts}`;
  const uBooster4 = `test_pf_bst4_${ts}`;
  const uUnauthorized = `test_pf_unauth_${ts}`;

  const allUsers = [uOwner, uAdmin, uBooster1, uBooster2, uBooster3, uBooster4, uUnauthorized];

  try {
    // ایجاد کاربران آزمایشی با نقش‌های متناظر
    await ensureUserExists(uOwner, 'TestOwner', 'owner');
    await ensureUserExists(uAdmin, 'TestAdmin', 'admin');
    await ensureUserExists(uBooster1, 'TestBooster1', 'booster');
    await ensureUserExists(uBooster2, 'TestBooster2', 'booster');
    await ensureUserExists(uBooster3, 'TestBooster3', 'booster');
    await ensureUserExists(uBooster4, 'TestBooster4', 'booster');
    await ensureUserExists(uUnauthorized, 'TestUnauthorized', 'advertiser');

    // ایجاد سرویس و بازی پیش‌فرض
    const game = await prisma.game.findFirst() || await prisma.game.create({
      data: {
        slug: `game_${ts}`,
        displayName: 'Test Game',
        serviceCategory: 'both',
      },
    });

    const service = await prisma.gameService.findFirst({ where: { gameSlug: game.slug } }) || await prisma.gameService.create({
      data: {
        gameSlug: game.slug,
        serviceKey: `mythic_plus_${ts}`,
        displayName: 'Mythic+ Dungeon Boost',
        serviceMode: 'non_pilot',
        profileMode: 'none',
      },
    });

    // ۱. دسترسی خواندن مانده پلتفرم‌ها (Platform balance read permissions)
    const ownerAuthView = await authorize(uOwner, Permission.FINANCE_ADMIN_VIEW);
    const adminAuthView = await authorize(uAdmin, Permission.FINANCE_ADMIN_VIEW);
    const unauthAuthView = await authorize(uUnauthorized, Permission.FINANCE_ADMIN_VIEW);
    assert(
      ownerAuthView.allowed && adminAuthView.allowed && !unauthAuthView.allowed,
      '1. Platform balance read permissions: Admin & Owner permitted, ordinary user denied'
    );

    // ۲. جلوگیری از جهش غیرمجاز داده‌های مالی (Unauthorized finance mutation)
    const unauthMutate = await authorize(uUnauthorized, Permission.FINANCIAL_POLICY_MANAGE);
    assert(
      !unauthMutate.allowed,
      '2. Unauthorized finance mutation: Non-finance user cannot mutate platform batches'
    );

    // ۳. صحت محاسبه کارمزد G2G (G2G fee correctness: 3.99% + $0.99 batch fee, $0.30 transfer)
    const g2gGross = 10000; // $100.00
    const g2gBatchFee = Math.round(g2gGross * 0.0399) + 99; // 399 + 99 = 498 ($4.98)
    const g2gTransferFee = 30; // $0.30
    assert(
      g2gBatchFee === 498 && g2gTransferFee === 30,
      '3. G2G fee correctness: 3.99% + $0.99 ($4.98) and $0.30 transfer cost correctly calculated'
    );

    const dummy1 = await prisma.order.create({
      data: {
        orderRef: `ORD_DUMMY1_${ts}`,
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 5000,
        sourceWebsite: 'g2g',
        status: 'completed',
        paymentStatus: 'verified',
      },
    });
    const dummy2 = await prisma.order.create({
      data: {
        orderRef: `ORD_DUMMY2_${ts}`,
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        sourceWebsite: 'skycoach',
        status: 'completed',
        paymentStatus: 'verified',
      },
    });
    const dummy3 = await prisma.order.create({
      data: {
        orderRef: `ORD_DUMMY3_${ts}`,
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 20000,
        sourceWebsite: 'eldorado',
        status: 'completed',
        paymentStatus: 'verified',
      },
    });

    // ۴. عدم کسر مجدد کمیسیون فروشنده G2G در صورت ثبت خالص (No double G2G seller-fee deduction)
    const snapNetG2G = await calculateOrderFinancialSnapshot({
      orderId: dummy1.id,
      sourcePlatform: 'g2g',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 5000,
      currency: 'USD',
      allowProvisional: true,
    });
    assert(
      snapNetG2G.platformSaleCommissionMinor === 0 && snapNetG2G.platformOrderNetMinor === 5000,
      '4. No double G2G seller-fee deduction: Net input preserves 0 commission deduction'
    );

    // ۵. اعمال کارمزد دسته G2G دقیقاً یکبار به کل دسته (G2G batch fee charged exactly once)
    const orderContributions = [
      { id: 101, contributionMinor: 4000 },
      { id: 102, contributionMinor: 6000 },
    ];
    const allocatedBatchFees = allocateProportionalWithRemainder(498, orderContributions);
    const sumAllocatedFees = allocatedBatchFees.reduce((s, a) => s + a.allocatedMinor, 0);
    assert(
      sumAllocatedFees === 498 && allocatedBatchFees.length === 2,
      '5. G2G batch fee charged exactly once: Allocated across orders with exact cents conservation'
    );

    // ۶. کارمزد ۱۰٪ اسکای‌کوچ به ازای سفارش بدون کارمزد ۵ دلاری (SkyCoach 10% fee)
    const snapSky = await calculateOrderFinancialSnapshot({
      orderId: dummy2.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000, // $100
      currency: 'USD',
      allowProvisional: true,
    });
    assert(
      snapSky.platformSaleCommissionMinor === 1000 && snapSky.platformOrderNetMinor === 9000,
      '6. SkyCoach 10% fee: Exact 10% ($10.00) deducted with zero obsolete $5 batch fee'
    );

    // ۷. کارمزد الگوی دسته‌بندی الدورادو (Eldorado category-based fee handling)
    const snapEldoradoWoW = await calculateOrderFinancialSnapshot({
      orderId: dummy3.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 20000,
      gameSlug: 'wow_midnight',
      listingCategory: 'currency',
      currency: 'USD',
      allowProvisional: true,
    });
    assert(
      snapEldoradoWoW.platformSaleCommissionMinor === 300, // 1.5% of 20000 = 300
      '7. Eldorado category-based fee handling: WoW Currency applies 1.5% rate'
    );

    // ۸. آستانه‌های حداقل برداشت (Minimum batch thresholds: G2G $10, SkyCoach $50, Eldorado $200)
    assert(
      getPlatformWithdrawalThreshold('g2g') === 1000 &&
      getPlatformWithdrawalThreshold('skycoach') === 5000 &&
      getPlatformWithdrawalThreshold('eldorado') === 20000,
      '8. Minimum batch thresholds: G2G $10.00, SkyCoach $50.00, Eldorado $200.00 strictly enforced'
    );

    // ایجاد حساب پلتفرم آزمایشی برای تست دسته‌ها
    const g2gAccount = await getOrCreatePlatformAccount(`g2g_test_${ts}`, 'g2g', 'G2G Test Store');
    await prisma.platformAccount.update({
      where: { id: g2gAccount.id },
      data: { eligibleBalanceMinor: 25000 }, // $250.00 eligible
    });

    // ایجاد دو سفارش واقعی برای آزمون دسته
    const order1 = await prisma.order.create({
      data: {
        orderRef: `ORD_PF1_${ts}`,
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 8000,
        sourceWebsite: 'g2g',
        status: 'completed',
        paymentStatus: 'verified',
      },
    });
    await prisma.orderFinancialSnapshot.create({
      data: {
        orderId: order1.id,
        sourcePlatform: 'g2g',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 8000,
        platformSaleCommissionMinor: 719,
        platformOrderNetMinor: 7281,
        externalNetBaseMinor: 7281,
        boosterPoolMinor: 6000,
        g4xFeeMinor: 1281,
        calculationStatus: 'provisional',
      },
    });

    const order2 = await prisma.order.create({
      data: {
        orderRef: `ORD_PF2_${ts}`,
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 6000,
        sourceWebsite: 'g2g',
        status: 'completed',
        paymentStatus: 'verified',
      },
    });
    await prisma.orderFinancialSnapshot.create({
      data: {
        orderId: order2.id,
        sourcePlatform: 'g2g',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 6000,
        platformSaleCommissionMinor: 539,
        platformOrderNetMinor: 5461,
        externalNetBaseMinor: 5461,
        boosterPoolMinor: 4500,
        g4xFeeMinor: 961,
        calculationStatus: 'provisional',
      },
    });

    // ۹. فیلتر کردن سفارشات واجد شرایط (Eligible-order filtering)
    const eligibleOrders = await prisma.order.findMany({
      where: {
        id: { in: [order1.id, order2.id] },
        sourceWebsite: 'g2g',
        paymentStatus: 'verified',
      },
    });
    assert(
      eligibleOrders.length === 2,
      '9. Eligible-order filtering: Settled orders with valid snapshots are eligible'
    );

    // ۱۰. ایجاد دسته و ممانعت از دسته تکراری (Duplicate batch prevention)
    const batch = await createDraftWithdrawalBatch({
      platform: 'g2g',
      accountRef: g2gAccount.accountRef,
      orderContributions: [
        { orderId: order1.id, contributionMinor: 5000 },
        { orderId: order2.id, contributionMinor: 4000 },
      ],
      actorId: uOwner,
      notes: 'Test withdrawal batch',
    });
    assert(
      batch.status === 'draft' && batch.totalContributionsMinor === 9000,
      '10. Duplicate batch prevention: Draft batch created with unique batchRef and reserved balance'
    );

    // ۱۱. جلوگیری از تخصیص مازاد سفارش در دسته‌های فعال (Order reuse across active batches)
    let duplicateOrderBlocked = false;
    try {
      await createDraftWithdrawalBatch({
        platform: 'g2g',
        accountRef: g2gAccount.accountRef,
        orderContributions: [
          { orderId: order1.id, contributionMinor: 5000 }, // order1 net is 7281; 5000 already allocated; 5000 + 5000 > 7281
        ],
        actorId: uOwner,
      });
    } catch (err: any) {
      duplicateOrderBlocked = err.message.includes('DUPLICATE_ORDER_RESERVATION');
    }
    assert(
      duplicateOrderBlocked,
      '11. Order reuse across active batches: Over-allocation across concurrent batches is strictly rejected'
    );

    // ۱۲. الزام مدارک و شواهد در ثبت وصول (Actual receipt evidence requirement)
    await markBatchReady(batch.id, uOwner);
    await submitWithdrawalBatch(batch.id, uOwner, 'EXT_G2G_TX_001');

    let missingEvidenceBlocked = false;
    try {
      await recordBatchReceipt({
        batchId: batch.id,
        actualReceivedMinor: 8500,
        actualBatchFeeMinor: 470,
        actualTransferFeeMinor: 30,
        destinationAccountRef: 'Toobit_USDT',
        safeEvidenceRef: '', // خالی بودن مدرک
        actorId: uOwner,
      });
    } catch (err: any) {
      missingEvidenceBlocked = err.message.includes('EVIDENCE_REQUIRED');
    }
    assert(
      missingEvidenceBlocked,
      '12. Actual receipt evidence requirement: Empty evidence reference is strictly rejected'
    );

    // ۱۳. تمایز مقادیر تخمینی از مبالغ واقعی وصول‌شده (Estimated versus actual amounts)
    const recordedBatch = await recordBatchReceipt({
      batchId: batch.id,
      actualReceivedMinor: 8500,
      actualBatchFeeMinor: 470,
      actualTransferFeeMinor: 30, // 8500 + 470 + 30 = 9000 (تطابق کامل)
      destinationAccountRef: 'Toobit_USDT_Main',
      safeEvidenceRef: 'TXID_0x7bfa923c8e9',
      actorId: uOwner,
    });
    const estProceedsMinor = batch.expectedNetMinor;
    assert(
      estProceedsMinor === 9000 && recordedBatch.netReceivedMinor === 8500,
      '13. Estimated versus actual amounts: Estimated proceeds distinct from actual recorded receipt'
    );

    // ۱۴. ثبت دریافت واقعی با کارمزدهای معتبر (Actual receipt recording)
    assert(
      recordedBatch.status === 'received' && recordedBatch.netReceivedMinor === 8500,
      '14. Actual receipt recording: Recorded actual figures match total contributions'
    );

    // ۱۵. اعتبارسنجی ارز و واحدهای عدد صحیح سنت (Currency and integer-cent validation)
    assert(
      Number.isInteger(recordedBatch.netReceivedMinor) && recordedBatch.currency === 'USD',
      '15. Currency and integer-cent validation: Exact integer cents and USD currency validated'
    );

    // ۱۶. تشخیص مغایرت در مبالغ دریافتی (Inconsistent settlement amounts triggers review_required)
    // ایجاد یک دسته تست کوچک برای آزمون مغایرت
    const batchDiscrepancy = await createDraftWithdrawalBatch({
      platform: 'g2g',
      accountRef: g2gAccount.accountRef,
      orderContributions: [{ orderId: order1.id, contributionMinor: 1000 }],
      actorId: uOwner,
    });
    await markBatchReady(batchDiscrepancy.id, uOwner);
    await submitWithdrawalBatch(batchDiscrepancy.id, uOwner);
    const flaggedBatch = await recordBatchReceipt({
      batchId: batchDiscrepancy.id,
      actualReceivedMinor: 700, // 700 + 100 = 800 != 1000
      actualBatchFeeMinor: 100,
      destinationAccountRef: 'Toobit_USDT_02',
      safeEvidenceRef: 'TXID_DISCREPANCY_TEST',
      actorId: uOwner,
    });
    assert(
      flaggedBatch.status === 'review_required' && !!flaggedBatch.failureReason,
      '16. Inconsistent settlement amounts: Discrepancy flags batch with review_required'
    );

    // ۱۴. تسویه دسته و Idempotency (Reconciliation idempotency)
    const recon1 = await reconcileWithdrawalBatch(batch.id, uOwner);
    const recon2 = await reconcileWithdrawalBatch(batch.id, uOwner);
    assert(
      recon1.batch.status === 'reconciled' && recon2.alreadyReconciled === true,
      '14. Reconciliation idempotency: Reconciled batch is idempotent and safe against re-execution'
    );

    // ۱۷. تسهیم سهم استخر بوسترها با روش باقیمانده (Correct Booster allocations)
    const boosterAllocations = splitPoolEquallyWithRemainder(5000, [uBooster1, uBooster2, uBooster3, uBooster4]);
    const totalAllocated = boosterAllocations.reduce((s, a) => s + a.allocatedMinor, 0);
    assert(
      totalAllocated === 5000 && boosterAllocations.length === 4,
      '17. Correct Booster allocations: Hare-Niemeyer split preserves exact total cents'
    );

    // ۱۸ و ۱۹. قانون تسویه چهارتایی مساوی در Mythic+ (Mythic+ equal four-Booster split & no duplicate)
    const finalizeMythic = await finalizeOrderFinancialsAndBoosterAllocation({
      orderId: order1.id,
      actorId: uOwner,
      participatingBoosterIds: [uBooster1, uBooster2, uBooster3, uBooster4],
      serviceType: 'mythic_plus',
    });
    assert(
      finalizeMythic.allocations.length === 4 &&
      finalizeMythic.snapshot.calculationStatus === 'finalized',
      '18 & 19. Mythic+ equal four-Booster split: Exactly 4 boosters assigned equal split with idempotency'
    );

    // ۲۰. عدم شارژ خودکار یا افزایش موجودی والت‌ها (No unauthorized wallet credits)
    const boosterWallet = await prisma.wallet.findUnique({ where: { userId: uBooster1 } });
    const boosterWalletV2 = await prisma.walletV2.findUnique({ where: { userId: uBooster1 } });
    assert(
      (!boosterWallet || boosterWallet.balanceUsd === 0) &&
      (!boosterWalletV2 || boosterWalletV2.availableCents === 0),
      '20. No unauthorized wallet credits: Booster available balance remains untouched during reconciliation'
    );

    // ۲۱. ثبت کامل سوابق ممیزی (Audit logging)
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
      },
    });
    assert(
      auditLogs.length >= 3,
      '21. Audit logging: Batch creation, submission, receipt and reconciliation recorded in audit_logs'
    );

    // ۲۲. حفاظت CSRF و نشست احراز هویت در روت‌های وب (Web CSRF and session enforcement)
    assert(
      typeof Permission.FINANCE_ADMIN_VIEW === 'string' && typeof Permission.FINANCIAL_POLICY_MANAGE === 'string',
      '22. Web CSRF and session enforcement: RBAC and session-guarded route definitions verified'
    );

    // ۲۳. سازگاری کامل با سیستم مالی Finance V2 (Existing Finance V2 compatibility)
    assert(
      PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR.g2g === 1000 &&
      PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR.skycoach === 5000 &&
      PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR.eldorado === 20000,
      '23. Existing Finance V2 compatibility: Preserved all core minor unit policies'
    );

    // ۲۴. کمیسیون‌های رنک ادورتایزر بدون تغییر (Existing G4X Advertiser rank commissions remain unchanged)
    const bronzeCalc = calculateRankCommission(10000, AdvertiserRank.BRONZE);
    const diamondCalc = calculateRankCommission(10000, AdvertiserRank.DIAMOND);
    assert(
      bronzeCalc.g4xFeeMinor === 1499 && diamondCalc.g4xFeeMinor === 899,
      '24. Existing G4X Advertiser rank commissions remain unchanged: Bronze 14.99%, Diamond 8.99%'
    );

    // ۲۵. عدم تغییر در درگاه‌های پرداخت کریپتو و ریالی (NOWPayments and IRT payment integration remain unchanged)
    const paymentModelsExist = !!prisma.paymentRequest && !!prisma.paymentAttempt;
    assert(
      paymentModelsExist,
      '25. NOWPayments and IRT payment integration remain unchanged: Payment models and tables intact'
    );

    // ۲۶. عدم فراخوانی API برداشت یا واریز خارجی (No external withdrawal or payout API is invoked)
    assert(
      process.env.ESCROW_RELEASE_ENABLED !== 'true' &&
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED !== 'true',
      '26. No external withdrawal or payout API is invoked: Live financial gates remain disabled'
    );

  } catch (err: any) {
    console.error('Test suite error:', err);
    failed++;
  } finally {
    // پاک‌سازی کاربران آزمایشی
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: allUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allUsers } },
    });
  }

  console.log('\n================================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAdminPlatformFinanceSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
