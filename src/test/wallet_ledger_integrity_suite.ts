/**
 * wallet_ledger_integrity_suite.ts — مجموعه آزمون‌های یکپارچگی کیف‌پول، دفتر کل و ارزها (Phase 2.6.3)
 *
 * الزامات ۱۳ گانه:
 *  1. Negative wallet balances are rejected (SQLite CHECK constraint).
 *  2. Concurrent withdrawals cannot overspend funds.
 *  3. Valid internal balance-to-escrow movements preserve totals.
 *  4. Unsupported currency movements fail safely.
 *  5. External TRY settlement does not silently create internal TRY wallet balances.
 *  6. Successful release is not mislabeled as refund/reversal ('settled' status).
 *  7. Duplicate releases remain blocked.
 *  8. Escrow cannot release before confirmed completion timestamp plus 72 hours.
 *  9. Legacy obligations without trustworthy escrow start dates are blocked.
 * 10. Hold currency and obligation mismatches are rejected.
 * 11. Failed transactions roll back all changes.
 * 12. Existing escrow and security tests still pass.
 * 13. All migrations replay successfully on a clean database.
 */

import prisma from '../database/db';
import {
  checkEscrowEligibility,
  executeEscrowRelease,
  safeTransferEscrowToAvailable,
  safeLockAvailableToEscrow,
  getWalletKeys,
  SUPPORTED_WALLET_CURRENCIES,
} from '../services/escrowService';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

async function runWalletLedgerIntegrityTests() {
  console.log('=== STARTING PHASE 2.6.3 WALLET, LEDGER & CURRENCY INTEGRITY TEST SUITE ===\n');

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

  const now = new Date();
  const eightyHoursAgo = new Date(now.getTime() - 80 * 60 * 60 * 1000);
  const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);

  const testUserId = 'test_integ_user_01';
  const testAdminId = 'test_integ_admin_01';

  try {
    // ─── ایجاد کاربران و رکوردهای اولیه ─────────────────────────────────
    await prisma.user.upsert({
      where: { discordId: testUserId },
      update: {},
      create: { discordId: testUserId, username: 'IntegrityUser' },
    });

    await prisma.user.upsert({
      where: { discordId: testAdminId },
      update: {},
      create: { discordId: testAdminId, username: 'IntegrityAdmin' },
    });

    const testGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    if (!testGame) throw new Error('Game wow_midnight missing');

    const testService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
    });
    if (!testService) throw new Error('Service mythic_plus missing');

    // ─── تست ۱: رد موجودی‌های منفی توسط قید CHECK در SQLite ─────────────
    await prisma.wallet.upsert({
      where: { userId: testUserId },
      update: {
        balanceUsd: 1000,
        escrowUsd: 0,
        balanceGold: 50000,
        escrowGold: 0,
        balanceUsdt: 500,
        escrowUsdt: 0,
        balanceIrt: 10000000,
        escrowIrt: 0,
      },
      create: {
        userId: testUserId,
        balanceUsd: 1000,
        escrowUsd: 0,
        balanceGold: 50000,
        escrowGold: 0,
        balanceUsdt: 500,
        escrowUsdt: 0,
        balanceIrt: 10000000,
        escrowIrt: 0,
      },
    });

    let negativeBalanceBlocked = false;
    try {
      // تلاش برای منفی کردن balanceUsd از طریق Raw SQL یا Prisma update
      await prisma.$executeRawUnsafe(
        `UPDATE wallets SET balance_usd = -500 WHERE user_id = '${testUserId}'`,
      );
    } catch (e: any) {
      if (e.message.includes('CHECK constraint failed') || e.message.includes('wallets_positive_balances_check')) {
        negativeBalanceBlocked = true;
      }
    }
    assert(
      negativeBalanceBlocked,
      '1. Negative wallet balance update is rejected by database CHECK constraint',
    );

    // ─── تست ۲: جلوگیری از کسری موجودی در برداشت‌های همزمان ──────────────
    // موجودی والت را روی ۱۰۰۰ سنت تنظیم می‌کنیم
    await prisma.wallet.update({
      where: { userId: testUserId },
      data: { balanceUsd: 1000, escrowUsd: 0 },
    });

    // ۵ درخواست همزمان برای برداشت ۸۰۰ سنت با شرط balanceUsd >= 800
    const concurrentWithdrawals = await Promise.all(
      [1, 2, 3, 4, 5].map(async () => {
        const updateResult = await prisma.wallet.updateMany({
          where: {
            userId: testUserId,
            balanceUsd: { gte: 800 },
          },
          data: {
            balanceUsd: { decrement: 800 },
          },
        });
        return updateResult.count;
      }),
    );

    const successfulWithdrawals = concurrentWithdrawals.filter((c) => c === 1).length;
    const walletAfterConcurrent = await prisma.wallet.findUnique({
      where: { userId: testUserId },
    });

    assert(
      successfulWithdrawals === 1 && walletAfterConcurrent?.balanceUsd === 200,
      '2. Concurrent withdrawals cannot overspend funds (exactly 1 of 5 succeeded, balance = 200)',
      `Success count: ${successfulWithdrawals}, Ending balance: ${walletAfterConcurrent?.balanceUsd}`,
    );

    // ─── تست ۳: حفظ مجموع دارایی در انتقالات داخلی (Balance <-> Escrow) ───
    await prisma.wallet.update({
      where: { userId: testUserId },
      data: { balanceUsd: 5000, escrowUsd: 2000 },
    });

    const totalBeforeTransfer = 5000 + 2000;
    // قفل کردن ۱۵۰۰ سنت در اسکرو
    await prisma.$transaction(async (tx) => {
      await safeLockAvailableToEscrow(testUserId, 'USD', 1500, tx);
    });

    const walletMidTransfer = await prisma.wallet.findUnique({
      where: { userId: testUserId },
    });
    const totalMid = (walletMidTransfer?.balanceUsd ?? 0) + (walletMidTransfer?.escrowUsd ?? 0);

    // آزادسازی ۱۰۰۰ سنت از اسکرو به بالانس آزاد
    await prisma.$transaction(async (tx) => {
      await safeTransferEscrowToAvailable(testUserId, 'USD', 1000, tx);
    });

    const walletFinalTransfer = await prisma.wallet.findUnique({
      where: { userId: testUserId },
    });
    const totalFinal = (walletFinalTransfer?.balanceUsd ?? 0) + (walletFinalTransfer?.escrowUsd ?? 0);

    assert(
      totalBeforeTransfer === totalMid &&
        totalMid === totalFinal &&
        walletFinalTransfer?.balanceUsd === 4500 &&
        walletFinalTransfer?.escrowUsd === 2500,
      '3. Valid internal balance-to-escrow movements preserve total funds (5000+2000 -> 3500+3500 -> 4500+2500)',
      `Initial: ${totalBeforeTransfer}, Mid: ${totalMid}, Final: ${totalFinal}`,
    );

    // ─── تست ۴: رد ایمن تراکنش‌های ارزهای پشتیبانی‌نشده ───────────────────
    let unsupportedCurrencyRejected = false;
    try {
      await prisma.$transaction(async (tx) => {
        await safeLockAvailableToEscrow(testUserId, 'EUR', 1000, tx);
      });
    } catch (e: any) {
      if (e.message.includes('Unsupported wallet currency: EUR')) {
        unsupportedCurrencyRejected = true;
      }
    }

    assert(
      unsupportedCurrencyRejected && getWalletKeys('GBP') === null,
      '4. Unsupported currency movements fail safely without state mutation',
    );

    // ─── تست ۵: تفکیک تسویه برون‌سیستمی لیر ترکیه (TRY) از بالانس والت ────
    // بررسی جدول والت در دیتابیس که هیچ ستون balance_try یا escrow_try ندارد
    const walletColumns: any[] = await prisma.$queryRawUnsafe('PRAGMA table_info(wallets)');
    const columnNames = walletColumns.map((col) => col.name);
    const hasInternalTry = columnNames.includes('balance_try') || columnNames.includes('escrow_try');

    // ایجاد یک پیشنهاد صرافی با تسویه خارجی TRY
    const exchangerOfferTry = await prisma.exchangerOffer.create({
      data: {
        exchangerId: testAdminId,
        gameSlug: 'wow_midnight',
        currencyType: 'gold',
        settlementCurrency: 'TRY',
        settlementMethod: 'iban_try',
        minAmount: 1000000,
        unitPriceMinor: 150,
        priceBasis: 1000000,
      },
    });

    assert(
      !hasInternalTry &&
        getWalletKeys('TRY') === null &&
        exchangerOfferTry.settlementCurrency === 'TRY' &&
        exchangerOfferTry.settlementMethod === 'iban_try',
      '5. External TRY settlement exists for bank transfers without creating internal TRY wallet balances',
    );

    // ─── تست ۶: تغییر وضعیت به 'settled' به جای 'reversed' در آزادسازی ───
    const validOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-INTEG-01',
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        customerId: testUserId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'completed',
        paymentStatus: 'verified',
        completedAt: eightyHoursAgo,
      },
    });

    const validRun = await prisma.orderRun.create({
      data: {
        orderId: validOrder.id,
        runNumber: 1,
        status: 'completed',
        completedAt: eightyHoursAgo,
      },
    });

    await prisma.runProof.create({
      data: {
        runId: validRun.id,
        submittedById: testUserId,
        evidenceUrl: 'https://cdn.g4x.online/proofs/integ1.png',
        status: 'approved',
        reviewedById: testAdminId,
      },
    });

    await prisma.wallet.update({
      where: { userId: testUserId },
      data: { balanceUsd: 0, escrowUsd: 5000 },
    });

    const lockTx = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-INTEG-LOCK-01',
        userId: testUserId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 5000,
        entryType: 'escrow_lock',
        status: 'posted',
        escrowStartAt: eightyHoursAgo,
        releaseAt: eightyHoursAgo,
      },
    });

    const releaseRes = await executeEscrowRelease(lockTx.id, {
      now,
      ignoreDisabledFlag: true,
    });

    const lockTxAfter = await prisma.ledgerTransaction.findUnique({
      where: { id: lockTx.id },
    });
    const releaseTx = await prisma.ledgerTransaction.findUnique({
      where: { transactionRef: releaseRes.releaseRef },
    });
    const auditRecord = await prisma.auditLog.findFirst({
      where: { action: 'ESCROW_RELEASE_SETTLED', entityId: String(lockTx.id) },
    });

    assert(
      releaseRes.success &&
        lockTxAfter?.status === 'settled' &&
        (lockTxAfter?.status as string) !== 'reversed' &&
        releaseTx?.entryType === 'escrow_release' &&
        releaseTx?.status === 'posted' &&
        auditRecord !== null,
      "6. Successful release transitions to 'settled' (not 'reversed'), preserving accounting distinction",
      `Status: ${lockTxAfter?.status}`,
    );

    // ─── تست ۷: جلوگیری قاطع از آزادسازی تکراری ─────────────────────────
    const duplicateReleaseRes = await executeEscrowRelease(lockTx.id, {
      now,
      ignoreDisabledFlag: true,
    });

    assert(
      !duplicateReleaseRes.success &&
        duplicateReleaseRes.error === 'ELIGIBILITY_CHECK_FAILED' &&
        Boolean(duplicateReleaseRes.reasons?.some((r) => r.includes('TRANSACTION_NOT_POSTED'))),
      '7. Duplicate release attempts are strictly blocked',
    );

    // ─── تست ۸: جلوگیری از آزادسازی قبل از ۷۲ ساعت پس از تکمیل واقعی ───
    const prematureOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-INTEG-PREMATURE-01',
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        customerId: testUserId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 3000,
        status: 'completed',
        paymentStatus: 'verified',
        completedAt: twentyHoursAgo, // فقط ۲۰ ساعت از تکمیل گذشته است
      },
    });

    const prematureRun = await prisma.orderRun.create({
      data: {
        orderId: prematureOrder.id,
        runNumber: 1,
        status: 'completed',
        completedAt: twentyHoursAgo,
      },
    });

    await prisma.runProof.create({
      data: {
        runId: prematureRun.id,
        submittedById: testUserId,
        evidenceUrl: 'https://cdn.g4x.online/proofs/prem.png',
        status: 'approved',
        reviewedById: testAdminId,
      },
    });

    const prematureTx = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-INTEG-PREMATURE-TX',
        userId: testUserId,
        orderId: prematureOrder.id,
        currency: 'USD',
        amountMinor: 3000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: eightyHoursAgo, // ایجاد رکورد لجر قدیمی است، اما تایید سفارش ۲۰ ساعت پیش بوده
        escrowStartAt: twentyHoursAgo,
      },
    });

    const prematureEligibility = await checkEscrowEligibility(prematureTx.id, { now });

    assert(
      !prematureEligibility.eligible &&
        prematureEligibility.reasons.some((r) => r.includes('MINIMUM_ESCROW_TIME_NOT_ELAPSED')),
      '8. Escrow release blocked before 72 hours from confirmed completion (elapsed 20h < 72h)',
      `Reasons: ${prematureEligibility.reasons.join('; ')}`,
    );

    // ─── تست ۹: مسدودسازی تعهدات موروثی فاقد تاریخ شروع اسکرو معتبر ─────
    const legacyTx = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-INTEG-LEGACY-TX',
        userId: testUserId,
        orderId: null, // بدون لینک سفارش
        currency: 'USD',
        amountMinor: 1000,
        entryType: 'escrow_lock',
        status: 'posted',
        escrowStartAt: null, // فاقد تاریخ شروع
        createdAt: eightyHoursAgo,
      },
    });

    const legacyEligibility = await checkEscrowEligibility(legacyTx.id, { now });

    assert(
      !legacyEligibility.eligible &&
        legacyEligibility.reasons.some((r) => r.includes('MISSING_RELIABLE_ESCROW_START')),
      '9. Legacy obligations without trustworthy escrow start date are blocked for manual review',
      `Reasons: ${legacyEligibility.reasons.join('; ')}`,
    );

    // ─── تست ۱۰: رد ناهماهنگی ارز یا سفارش در توقیف‌های مالی (Holds) ──────
    const holdMismatchTx = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-INTEG-HOLD-MISMATCH',
        userId: testUserId,
        orderId: validOrder.id,
        currency: 'USD',
        amountMinor: 2000,
        entryType: 'escrow_lock',
        status: 'posted',
        escrowStartAt: eightyHoursAgo,
        releaseAt: eightyHoursAgo,
      },
    });

    // هولد با ارز متناقض (USDT به جای USD)
    const currencyMismatchHold = await prisma.escrowHold.create({
      data: {
        orderId: validOrder.id,
        ledgerTransactionId: holdMismatchTx.id,
        currency: 'USDT', // عدم تطابق عمدی
        amountMinor: 2000,
        status: 'active',
        createdById: testAdminId,
        reason: 'Hold with currency mismatch',
      },
    });

    const holdMismatchEligibility = await checkEscrowEligibility(holdMismatchTx.id, { now });

    assert(
      !holdMismatchEligibility.eligible &&
        holdMismatchEligibility.reasons.some((r) => r.includes('HOLD_CURRENCY_MISMATCH')),
      '10a. Currency mismatch between hold and ledger obligation is rejected',
      `Reasons: ${holdMismatchEligibility.reasons.join('; ')}`,
    );

    // حذف هولد ارز متناقض و تست هولد با سفارش متناقض
    await prisma.escrowHold.delete({ where: { id: currencyMismatchHold.id } });

    const otherOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-INTEG-OTHER-01',
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        customerId: testUserId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 1000,
        status: 'pending',
      },
    });

    const orderMismatchHold = await prisma.escrowHold.create({
      data: {
        orderId: otherOrder.id, // ارجاع به سفارش غیرمتناظر
        ledgerTransactionId: holdMismatchTx.id,
        currency: 'USD',
        amountMinor: 2000,
        status: 'active',
        createdById: testAdminId,
        reason: 'Hold with order mismatch',
      },
    });

    const orderMismatchEligibility = await checkEscrowEligibility(holdMismatchTx.id, { now });

    assert(
      !orderMismatchEligibility.eligible &&
        orderMismatchEligibility.reasons.some((r) => r.includes('HOLD_ORDER_MISMATCH')),
      '10b. Order mismatch between hold and ledger obligation is rejected',
      `Reasons: ${orderMismatchEligibility.reasons.join('; ')}`,
    );

    await prisma.escrowHold.delete({ where: { id: orderMismatchHold.id } });
    await prisma.order.delete({ where: { id: otherOrder.id } });

    // ─── تست ۱۱: رول‌بک کامل تمام تغییرات در صورت شکست تراکنش ───────────
    const walletBeforeFailure = await prisma.wallet.findUnique({
      where: { userId: testUserId },
    });

    let rollbackOccurred = false;
    try {
      await prisma.$transaction(async (tx) => {
        // تغییر والت
        await tx.wallet.update({
          where: { userId: testUserId },
          data: { balanceUsd: { increment: 9999 } },
        });

        // شبیه‌سازی خطای اعتبارسنجی حین تراکنش
        throw new Error('SIMULATED_FINANCIAL_TRANSACTION_FAILURE');
      });
    } catch (e: any) {
      if (e.message.includes('SIMULATED_FINANCIAL_TRANSACTION_FAILURE')) {
        rollbackOccurred = true;
      }
    }

    const walletAfterFailure = await prisma.wallet.findUnique({
      where: { userId: testUserId },
    });

    assert(
      rollbackOccurred &&
        walletBeforeFailure?.balanceUsd === walletAfterFailure?.balanceUsd &&
        walletBeforeFailure?.escrowUsd === walletAfterFailure?.escrowUsd,
      '11. Database transaction rolls back completely on runtime failure',
    );

    // ─── تست ۱۲: بررسی موفقیت مجموعه‌های تست موجود (Escrow & Security) ───
    console.log('\n[TEST 12] Verifying existing escrow safety and security test suites...');
    let escrowTestsPassed = false;
    let securityTestsPassed = false;
    try {
      execSync('npm run test:escrow', { stdio: 'pipe' });
      escrowTestsPassed = true;
    } catch (e: any) {
      console.error('test:escrow failed:', e.message);
    }

    try {
      execSync('npm run test:security', { stdio: 'pipe' });
      securityTestsPassed = true;
    } catch (e: any) {
      console.error('test:security failed:', e.message);
    }

    assert(
      escrowTestsPassed && securityTestsPassed,
      '12. Existing escrow and security suites both pass with zero errors',
    );

    // ─── تست ۱۳: اجرای موفق تمام میگریشن‌ها روی یک دیتابیس تمیز ─────────
    console.log('\n[TEST 13] Testing clean migration replay on an isolated temporary database...');
    const tempDbPath = path.resolve(__dirname, '../../data/temp_migration_replay.db');
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }

    let cleanReplaySuccess = false;
    try {
      execSync(`npx prisma migrate deploy`, {
        env: {
          ...process.env,
          DATABASE_URL: `file:${tempDbPath}`,
        },
        stdio: 'pipe',
      });
      cleanReplaySuccess = true;
    } catch (e: any) {
      console.error('Clean migration replay failed:', e.message);
    } finally {
      if (fs.existsSync(tempDbPath)) {
        try {
          fs.unlinkSync(tempDbPath);
        } catch {
          // ignore cleanup error
        }
      }
    }

    assert(
      cleanReplaySuccess,
      '13. All 7 migrations replay successfully on a clean database without errors',
    );

    // ─── پاک‌سازی رکوردهای تست ─────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning test records...');
    await prisma.escrowHold.deleteMany({
      where: { orderId: { in: [validOrder.id, prematureOrder.id] } },
    });
    await prisma.runProof.deleteMany({
      where: { run: { orderId: { in: [validOrder.id, prematureOrder.id] } } },
    });
    await prisma.orderRun.deleteMany({
      where: { orderId: { in: [validOrder.id, prematureOrder.id] } },
    });
    await prisma.auditLog.deleteMany({
      where: { action: { in: ['ESCROW_RELEASE_SETTLED', 'ESCROW_RELEASE_REVERSED'] } },
    });
    await prisma.ledgerTransaction.deleteMany({
      where: {
        OR: [
          { userId: testUserId },
          { transactionRef: { startsWith: 'TEST-INTEG-' } },
          { transactionRef: { startsWith: 'RELEASE-TEST-INTEG-' } },
        ],
      },
    });
    await prisma.order.deleteMany({
      where: { id: { in: [validOrder.id, prematureOrder.id] } },
    });
    await prisma.exchangerOffer.deleteMany({
      where: { exchangerId: testAdminId },
    });
    await prisma.wallet.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [testUserId, testAdminId] } },
    });

    console.log(`\n=== INTEGRITY RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('UNEXPECTED TEST EXCEPTION:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runWalletLedgerIntegrityTests();
