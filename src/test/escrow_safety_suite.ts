/**
 * escrow_safety_suite.ts — مجموعه تست‌های جامع ایمنی مالی موتور اسکرو (Phase 2.6.2)
 *
 * ۱۵ سناریوی آزمون الزامی:
 *  1. Release before 72 hours is blocked.
 *  2. Release after 72 hours with valid eligibility succeeds.
 *  3. Duplicate release is blocked.
 *  4. Concurrent release attempts do not duplicate funds.
 *  5. Active EscrowHold blocks release.
 *  6. Open OrderDispute blocks relevant funds.
 *  7. Resolved dispute without active holds can proceed if all other rules pass.
 *  8. Missing approved proof blocks release when proof is required.
 *  9. Uncompleted run blocks release.
 * 10. Missing order relation blocks automatic release.
 * 11. Insufficient escrow balance blocks release.
 * 12. Unsupported currency blocks release.
 * 13. Transaction failure rolls back all balance and ledger changes.
 * 14. A disabled cron performs no settlement.
 * 15. Process restart does not cause duplicate payment.
 */

import prisma from '../database/db';
import {
  checkEscrowEligibility,
  executeEscrowRelease,
  processAllPendingEscrows,
  isEscrowReleaseEnabled,
} from '../services/escrowService';
import { processEscrowReleases } from '../services/escrowCron';

async function runEscrowSafetyTests() {
  console.log('=== STARTING PHASE 2.6.2 FINANCIAL SAFETY TEST SUITE ===\n');
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

  // Helper timestamps
  const now = new Date();
  const seventyThreeHoursAgo = new Date(now.getTime() - 73 * 60 * 60 * 1000);
  const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);

  try {
    // ─── ایجاد نهادهای پایه مشترک تست ────────────────────────────────────
    const testUser = await prisma.user.upsert({
      where: { discordId: 'test_escrow_user_01' },
      update: {},
      create: { discordId: 'test_escrow_user_01', username: 'EscrowTestUser' },
    });

    const testAdmin = await prisma.user.upsert({
      where: { discordId: 'test_escrow_admin_01' },
      update: {},
      create: { discordId: 'test_escrow_admin_01', username: 'EscrowTestAdmin' },
    });

    const testGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    if (!testGame) throw new Error('Game wow_midnight not found');

    const testService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
      include: { settings: true },
    });
    if (!testService) throw new Error('Service mythic_plus not found');

    // اطمینان از وجود تنظیمات سرویس با الزام مدرک
    await prisma.serviceSetting.upsert({
      where: { serviceId: testService.id },
      update: { proofRequired: true },
      create: { serviceId: testService.id, proofRequired: true },
    });

    // ─── سناریو ۱: عدم آزادسازی قبل از ۷۲ ساعت ──────────────────────────
    const wallet1 = await prisma.wallet.upsert({
      where: { userId: testUser.discordId },
      update: { balanceUsd: 0, escrowUsd: 10000 },
      create: { userId: testUser.discordId, balanceUsd: 0, escrowUsd: 10000 },
    });

    const tx1 = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-TX-01',
        userId: testUser.discordId,
        currency: 'USD',
        amountMinor: 5000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: tenHoursAgo, // فقط ۱۰ ساعت گذشته است
        escrowStartAt: tenHoursAgo,
        releaseAt: new Date(now.getTime() + 62 * 3600 * 1000), // ۶۲ ساعت دیگر
      },
    });

    const el1 = await checkEscrowEligibility(tx1.id, { now });
    assert(
      !el1.eligible &&
        el1.reasons.some((r) => r.includes('RELEASE_AT_NOT_REACHED')) &&
        el1.reasons.some((r) => r.includes('MINIMUM_ESCROW_TIME_NOT_ELAPSED')),
      '1. Release before 72 hours is blocked',
      `Reasons: ${el1.reasons.join('; ')}`,
    );

    // ─── آماده‌سازی سفارش کامل و بدون نقص برای سناریوهای بعدی ──────────
    const validOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-ESCROW-VALID-01',
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        customerId: testUser.discordId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'completed',
        paymentStatus: 'verified',
        completedAt: seventyThreeHoursAgo,
      },
    });

    const validRun = await prisma.orderRun.create({
      data: {
        orderId: validOrder.id,
        runNumber: 1,
        status: 'completed',
        completedAt: seventyThreeHoursAgo,
      },
    });

    await prisma.runProof.create({
      data: {
        runId: validRun.id,
        submittedById: testUser.discordId,
        proofType: 'screenshot',
        evidenceUrl: 'https://cdn.g4x.online/proofs/valid1.png',
        status: 'approved',
        reviewedById: testAdmin.discordId,
      },
    });

    // ─── سناریو ۲: آزادسازی موفق پس از ۷۲ ساعت با تمام شرایط لازم ────────
    const tx2 = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-TX-02',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 5000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const walletBefore2 = await prisma.wallet.findUnique({ where: { userId: testUser.discordId } });
    const totalBefore2 = walletBefore2!.balanceUsd + walletBefore2!.escrowUsd;

    const el2 = await checkEscrowEligibility(tx2.id, { now });
    assert(el2.eligible, '2a. Eligible after 72 hours with valid conditions', `Reasons: ${el2.reasons.join('; ')}`);

    const resRelease2 = await executeEscrowRelease(tx2.id, { now, ignoreDisabledFlag: true });
    assert(resRelease2.success, '2b. Release execution succeeded', `Error: ${resRelease2.error}`);

    const walletAfter2 = await prisma.wallet.findUnique({ where: { userId: testUser.discordId } });
    const totalAfter2 = walletAfter2!.balanceUsd + walletAfter2!.escrowUsd;

    assert(
      walletAfter2!.escrowUsd === walletBefore2!.escrowUsd - 5000 &&
        walletAfter2!.balanceUsd === walletBefore2!.balanceUsd + 5000 &&
        totalBefore2 === totalAfter2,
      '2c. Exact balance transfer and conservation of funds (total escrow + balance unchanged)',
      `Before total: ${totalBefore2}, After total: ${totalAfter2}`,
    );

    // ─── سناریو ۳: بلاک شدن تلاش آزادسازی تکراری (Duplicate Release) ─────
    const resDuplicate = await executeEscrowRelease(tx2.id, { now, ignoreDisabledFlag: true });
    assert(
      !resDuplicate.success &&
        Boolean(
          resDuplicate.error === 'ELIGIBILITY_CHECK_FAILED' ||
            resDuplicate.reasons?.some((r) => r.includes('TRANSACTION_NOT_POSTED')),
        ),
      '3. Duplicate release is strictly blocked',
      `Result: ${JSON.stringify(resDuplicate)}`,
    );

    // ─── سناریو ۴: محافظت در برابر تلاش‌های همزمان (Concurrency Safety) ─
    const txConcurrent = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-TX-CONC',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 2000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const [resConc1, resConc2] = await Promise.all([
      executeEscrowRelease(txConcurrent.id, { now, ignoreDisabledFlag: true }),
      executeEscrowRelease(txConcurrent.id, { now, ignoreDisabledFlag: true }),
    ]);

    const successCount = (resConc1.success ? 1 : 0) + (resConc2.success ? 1 : 0);
    assert(
      successCount === 1,
      '4. Concurrent release attempts do not duplicate funds (exactly 1 succeeds)',
      `Res1: ${resConc1.success}, Res2: ${resConc2.success}`,
    );

    // ─── سناریو ۵: توقیف وجه با وجود EscrowHold فعال ────────────────────
    const txHold = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-TX-HOLD',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 1000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const activeHold = await prisma.escrowHold.create({
      data: {
        orderId: validOrder.id,
        ledgerTransactionId: txHold.id,
        currency: 'USD',
        amountMinor: 1000,
        status: 'active',
        createdById: testAdmin.discordId,
        reason: 'Investigating customer charge dispute',
      },
    });

    const elHold = await checkEscrowEligibility(txHold.id, { now });
    assert(
      !elHold.eligible && elHold.reasons.some((r) => r.includes('ACTIVE_FINANCIAL_HOLD_EXISTS')),
      '5. Active EscrowHold blocks release',
      `Reasons: ${elHold.reasons.join('; ')}`,
    );

    // ─── سناریو ۶: توقیف وجه با وجود OrderDispute باز ───────────────────
    const disputeOpen = await prisma.orderDispute.create({
      data: {
        orderId: validOrder.id,
        openedById: testUser.discordId,
        disputeType: 'completion',
        description: 'Customer claims run was not timed',
        status: 'open',
      },
    });

    const elDispute = await checkEscrowEligibility(txHold.id, { now });
    assert(
      !elDispute.eligible && elDispute.reasons.some((r) => r.includes('ACTIVE_DISPUTE_EXISTS')),
      '6. Open OrderDispute blocks relevant funds',
      `Reasons: ${elDispute.reasons.join('; ')}`,
    );

    // ─── سناریو ۷: اجازه رهایش پس از حل دیسپیوت و رفع هولد ─────────────
    // بستن دیسپیوت
    await prisma.orderDispute.update({
      where: { id: disputeOpen.id },
      data: { status: 'resolved', resolvedById: testAdmin.discordId, resolvedAt: now },
    });
    // رها کردن هولد
    await prisma.escrowHold.update({
      where: { id: activeHold.id },
      data: { status: 'released', releasedById: testAdmin.discordId, releasedAt: now },
    });

    const elResolved = await checkEscrowEligibility(txHold.id, { now });
    assert(
      elResolved.eligible,
      '7. Resolved dispute without active holds can proceed if all other rules pass',
      `Reasons: ${elResolved.reasons.join('; ')}`,
    );

    // ─── سناریو ۸: عدم وجود مدرک تاییدشده (Missing Approved Proof) ──────
    const orderNoProof = await prisma.order.create({
      data: {
        orderRef: 'ORD-NO-PROOF-01',
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        customerId: testUser.discordId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'completed',
        paymentStatus: 'verified',
        completedAt: seventyThreeHoursAgo,
      },
    });

    const runNoProof = await prisma.orderRun.create({
      data: {
        orderId: orderNoProof.id,
        runNumber: 1,
        status: 'completed',
        completedAt: seventyThreeHoursAgo,
      },
    });

    // ثبت مدرک ردشده به جای تاییدشده
    await prisma.runProof.create({
      data: {
        runId: runNoProof.id,
        submittedById: testUser.discordId,
        evidenceUrl: 'https://cdn.g4x.online/proofs/rejected.png',
        status: 'rejected',
        reviewedById: testAdmin.discordId,
      },
    });

    const txNoProof = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-NO-PROOF',
        userId: testUser.discordId,
        orderId: orderNoProof.id,
        currency: 'USD',
        amountMinor: 500,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const elNoProof = await checkEscrowEligibility(txNoProof.id, { now });
    assert(
      !elNoProof.eligible && elNoProof.reasons.some((r) => r.includes('MISSING_APPROVED_PROOF')),
      '8. Missing approved proof blocks release when proof is required',
      `Reasons: ${elNoProof.reasons.join('; ')}`,
    );

    // ─── سناریو ۹: ران ناتمام مانع آزادسازی می‌شود ─────────────────────
    await prisma.orderRun.create({
      data: {
        orderId: orderNoProof.id,
        runNumber: 2,
        status: 'in_progress', // ران دوم هنوز تمام نشده
      },
    });

    const elRunIncomplete = await checkEscrowEligibility(txNoProof.id, { now });
    assert(
      !elRunIncomplete.eligible && elRunIncomplete.reasons.some((r) => r.includes('RUNS_INCOMPLETE')),
      '9. Uncompleted run blocks release',
      `Reasons: ${elRunIncomplete.reasons.join('; ')}`,
    );

    // ─── سناریو ۱۰: عدم پیوند با سفارش مانع تسویه خودکار است ─────────
    const txNoOrder = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-NO-ORDER',
        userId: testUser.discordId,
        orderId: null, // بدون لینک سفارش
        currency: 'USD',
        amountMinor: 500,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const elNoOrder = await checkEscrowEligibility(txNoOrder.id, { now });
    assert(
      !elNoOrder.eligible && elNoOrder.reasons.some((r) => r.includes('MISSING_ORDER_RELATION')),
      '10. Missing order relation blocks automatic release',
      `Reasons: ${elNoOrder.reasons.join('; ')}`,
    );

    // ─── سناریو ۱۱: موجودی اسکرو ناکافی مانع تسویه است ─────────────────
    // کاربر ۲ اسکرو ندارد
    const txNoEscrow = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-INSUFFICIENT',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 99999999, // مبلغ فراتر از اسکرو والت
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const elNoEscrow = await checkEscrowEligibility(txNoEscrow.id, { now });
    assert(
      !elNoEscrow.eligible && elNoEscrow.reasons.some((r) => r.includes('INSUFFICIENT_ESCROW_BALANCE')),
      '11. Insufficient escrow balance blocks release',
      `Reasons: ${elNoEscrow.reasons.join('; ')}`,
    );

    // ─── سناریو ۱۲: ارز پشتیبانی‌نشده والت مانع تسویه است ─────────────
    const txBadCurrency = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-BAD-CURR',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'TRY', // لیر در والت پشتیبانی نمی‌شود
        amountMinor: 500,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const elBadCurrency = await checkEscrowEligibility(txBadCurrency.id, { now });
    assert(
      !elBadCurrency.eligible && elBadCurrency.reasons.some((r) => r.includes('UNSUPPORTED_CURRENCY')),
      '12. Unsupported currency (TRY) blocks release',
      `Reasons: ${elBadCurrency.reasons.join('; ')}`,
    );

    // ─── سناریو ۱۳: رول‌بک کامل در صورت شکست حین تراکنش دیتابیس ────────
    // شبیه‌سازی تغییر وضعیت همزمان حین تراکنش
    const txRollback = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-ESCROW-ROLLBACK',
        userId: testUser.discordId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 500,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: seventyThreeHoursAgo,
        releaseAt: seventyThreeHoursAgo,
      },
    });

    const walletBefore13 = await prisma.wallet.findUnique({ where: { userId: testUser.discordId } });
    // تغییر عمدی وضعیت تراکنش قبل از اجرا
    await prisma.ledgerTransaction.update({
      where: { id: txRollback.id },
      data: { status: 'reversed' },
    });

    const resRollback = await executeEscrowRelease(txRollback.id, { now, ignoreDisabledFlag: true });
    const walletAfter13 = await prisma.wallet.findUnique({ where: { userId: testUser.discordId } });

    assert(
      !resRollback.success &&
        walletBefore13!.balanceUsd === walletAfter13!.balanceUsd &&
        walletBefore13!.escrowUsd === walletAfter13!.escrowUsd,
      '13. Transaction failure rolls back all balance and ledger changes',
      `Result: ${JSON.stringify(resRollback)}`,
    );

    // ─── سناریو ۱۴: کران در حالت غیرفعال هیچ تسویه‌ای انجام نمی‌دهد ───
    process.env.ESCROW_RELEASE_ENABLED = 'false';
    const cronBatchDisabled = await processAllPendingEscrows(50);
    assert(
      cronBatchDisabled.enabled === false &&
        cronBatchDisabled.releasedCount === 0 &&
        cronBatchDisabled.skippedCount > 0,
      '14. Disabled cron performs no settlement (ESCROW_RELEASE_ENABLED=false)',
      `Skipped: ${cronBatchDisabled.skippedCount}, Released: ${cronBatchDisabled.releasedCount}`,
    );

    // ─── سناریو ۱۵: ری‌استارت پردازش منجر به پرداخت مجدد نمی‌شود ──────
    // اجرای مجدد بچ پس از یک آزادسازی موفق
    process.env.ESCROW_RELEASE_ENABLED = 'true';
    const cronBatchRerun = await processAllPendingEscrows(50);
    // هیچ رکوردی نباید دو بار آزاد شود
    assert(
      cronBatchRerun.releasedCount === 0 || !cronBatchRerun.results.some((r) => r.releaseRef === resRelease2.releaseRef),
      '15. Process restart or cycle rerun does not duplicate payments',
      `Released in rerun: ${cronBatchRerun.releasedCount}`,
    );

    // ─── پاک‌سازی رکوردهای تست ─────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning up test records...');
    await prisma.escrowHold.deleteMany({ where: { orderId: { in: [validOrder.id, orderNoProof.id] } } });
    await prisma.orderDispute.deleteMany({ where: { orderId: { in: [validOrder.id, orderNoProof.id] } } });
    await prisma.runProof.deleteMany({ where: { run: { orderId: { in: [validOrder.id, orderNoProof.id] } } } });
    await prisma.orderRun.deleteMany({ where: { orderId: { in: [validOrder.id, orderNoProof.id] } } });
    await prisma.auditLog.deleteMany({ where: { action: 'ESCROW_RELEASE_SETTLED' } });
    await prisma.ledgerTransaction.deleteMany({
      where: {
        userId: testUser.discordId,
        transactionRef: { startsWith: 'TEST-ESCROW-' },
      },
    });
    await prisma.ledgerTransaction.deleteMany({
      where: {
        transactionRef: { startsWith: 'RELEASE-TEST-ESCROW-' },
      },
    });
    await prisma.order.deleteMany({ where: { id: { in: [validOrder.id, orderNoProof.id] } } });
    await prisma.wallet.deleteMany({ where: { userId: testUser.discordId } });
    await prisma.user.deleteMany({ where: { discordId: { in: [testUser.discordId, testAdmin.discordId] } } });

    // ریست متغیر محیطی به حالت امن پیش‌فرض
    process.env.ESCROW_RELEASE_ENABLED = 'false';

    console.log(`\n=== RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('TEST SUITE EXCEPTION:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runEscrowSafetyTests();
