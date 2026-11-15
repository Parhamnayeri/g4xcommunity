/**
 * src/test/financial_transfers_phase2_suite.ts — Automated Test Suite for Phase 2 Transfers, Exchange & Withdrawals
 *
 * Test Scenarios:
 *  1. Exchange Rate Management (Create, Active Rate Resolution, History, Immutability)
 *  2. Same Currency Internal Transfer (Eldorado USD -> USD Wallet, Balanced Ledger, Fee deduction)
 *  3. Currency Conversion Transfer (USD -> Toman at live exchange rate, exact integer calculation)
 *  4. Currency Conversion Transfer (Toman -> USD at live exchange rate, exact cents calculation)
 *  5. Overdraft Prevention (Transfer exceeding available balance rejected with INSUFFICIENT_FUNDS)
 *  6. Platform Withdrawal Request & Fund Reservation (availableBalance debited, reservedBalance credited, currentBalance preserved)
 *  7. Multi-stage Lifecycle: PENDING -> PROCESSING transition
 *  8. Withdrawal Settlement: Final deduction of reserved funds, immutable ledger debit, anti-double-deduction
 *  9. Withdrawal Rejection: Immediate release of reserved funds back to available balance
 * 10. Transfer & Withdrawal Idempotency Enforcement
 * 11. REST API Security & Role-Based Access Control (401 / 403 / 200)
 * 12. Transfers CSV Export verification
 */

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import prisma from '../database/db';
import { router } from '../web/routes';
import {
  ensureDefaultFinancialAccounts,
  createFinancialAccount,
  recordManualBalanceAdjustment,
} from '../services/financialAccountService';
import {
  ensureDefaultExchangeRates,
  getActiveExchangeRate,
  createExchangeRate,
  listExchangeRates,
  executeInternalTransfer,
  listInternalTransfers,
  requestPlatformWithdrawal,
  markWithdrawalProcessing,
  completePlatformWithdrawal,
  rejectPlatformWithdrawal,
  cancelPlatformWithdrawal,
  listPlatformWithdrawals,
} from '../services/financialTransferAndWithdrawalService';

// Setup Mock Express App for Supertest
const app = express();
app.use(express.json());
app.use(
  session({
    secret: 'test-financial-phase2-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// Session injection helper for test endpoints
app.post('/test/session/login', async (req, res) => {
  const { userId } = req.body;
  if (!req.session) {
    res.status(500).json({ error: 'No session' });
    return;
  }
  req.session.userId = userId;
  req.session.csrfToken = 'test-phase2-csrf-token';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

app.use('/api', router);

async function runPhase2FinancialSuite() {
  console.log('================================================================');
  console.log('🔄  RUNNING PHASE 2 — TRANSFERS, EXCHANGE & WITHDRAWALS TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ [TEST ${totalTests}] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ✗ [FAIL ${totalTests}] ${testName}`);
      if (detail) console.error(`     Reason: ${detail}`);
      throw new Error(`Test assertion failed: ${testName} - ${detail || ''}`);
    }
  }

  const testId = `fin_p2_${Date.now().toString(36)}`;
  const adminDiscordId = `admin_${testId}`;
  const regularUserDiscordId = `user_${testId}`;

  try {
    // 0. Setup Test Users
    await prisma.user.create({
      data: {
        discordId: adminDiscordId,
        username: `AdminTester_${testId}`,
        userRoles: {
          create: [{ roleKey: 'admin' }],
        },
      },
    });

    await prisma.user.create({
      data: {
        discordId: regularUserDiscordId,
        username: `RegularUser_${testId}`,
        userRoles: {
          create: [{ roleKey: 'booster' }],
        },
      },
    });

    const adminAgent = request.agent(app);
    await adminAgent.post('/test/session/login').send({ userId: adminDiscordId });

    const userAgent = request.agent(app);
    await userAgent.post('/test/session/login').send({ userId: regularUserDiscordId });

    // Ensure baseline accounts & default exchange rates
    await ensureDefaultFinancialAccounts();
    await ensureDefaultExchangeRates();

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Exchange Rate Management
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 1: Exchange Rate Management & Effective Pricing ---');

    const activeRateInitial = await getActiveExchangeRate('USD', 'IRR');
    assert(
      activeRateInitial > 0,
      'Active exchange rate for USD/IRR is seeded and retrievable',
      `Rate: ${activeRateInitial}`
    );

    const initialRateValue = activeRateInitial;
    const newRateCreated = await createExchangeRate({
      fromCurrency: 'USD',
      toCurrency: 'IRR',
      rate: 90000,
      notes: 'Test update to 90,000 Toman',
      adminId: adminDiscordId,
    });

    assert(newRateCreated.rate === 90000 && newRateCreated.isActive, 'New exchange rate created and active');

    const activeRateUpdated = await getActiveExchangeRate('USD', 'IRR');
    assert(activeRateUpdated === 90000, 'getActiveExchangeRate returns latest active rate (90,000)');

    const ratesHistory = await listExchangeRates({ fromCurrency: 'USD', toCurrency: 'IRR' });
    assert(ratesHistory.length >= 2, 'Rate history preserves previous rates immutably');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Same Currency Internal Transfer (USD -> USD)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 2: Same Currency Internal Transfer (USD -> USD) ---');

    // Create 2 test accounts with known balances
    const eldoradoAccount = await createFinancialAccount({
      accountRef: `ELD_${testId}`,
      name: `Eldorado Testing ${testId}`,
      category: 'PLATFORM',
      accountType: 'ELDORADO',
      currency: 'USD',
      openingBalance: 100000, // $1,000.00
      adminId: adminDiscordId,
    });

    const usdWalletAccount = await createFinancialAccount({
      accountRef: `WAL_${testId}`,
      name: `USD Treasury ${testId}`,
      category: 'INTERNAL',
      accountType: 'USD_WALLET',
      currency: 'USD',
      openingBalance: 0,
      adminId: adminDiscordId,
    });

    // Transfer $300.00 (30,000 cents) with $5.00 (500 cents) fee
    const sameCurrencyTransfer = await executeInternalTransfer({
      sourceAccountId: eldoradoAccount.id,
      destinationAccountId: usdWalletAccount.id,
      sourceAmount: 30000,
      feeAmount: 500,
      description: 'Monthly platform revenue sweep',
      adminId: adminDiscordId,
      idempotencyKey: `idemp_trf_same_${testId}`,
    });

    assert(sameCurrencyTransfer.transferType === 'SAME_CURRENCY', 'Transfer recognized as SAME_CURRENCY');
    assert(sameCurrencyTransfer.sourceAmount === 30000, 'Source amount is 30,000 cents ($300.00)');
    assert(sameCurrencyTransfer.destinationAmount === 29500, 'Destination amount is 29,500 cents ($295.00 after $5 fee)');
    assert(sameCurrencyTransfer.feeAmount === 500, 'Fee amount recorded as 500 cents ($5.00)');

    // Verify source account balance
    const sourceAccAfter = await prisma.financialAccount.findUniqueOrThrow({ where: { id: eldoradoAccount.id } });
    assert(
      Number(sourceAccAfter.currentBalance) === 70000 && Number(sourceAccAfter.availableBalance) === 70000,
      'Source account debited by full source amount (100,000 - 30,000 = 70,000 cents)',
      `Actual balance: ${sourceAccAfter.currentBalance}`
    );

    // Verify destination account balance
    const destAccAfter = await prisma.financialAccount.findUniqueOrThrow({ where: { id: usdWalletAccount.id } });
    assert(
      Number(destAccAfter.currentBalance) === 29500 && Number(destAccAfter.availableBalance) === 29500,
      'Destination account credited by net destination amount (0 + 29,500 = 29,500 cents)',
      `Actual balance: ${destAccAfter.currentBalance}`
    );

    // Verify balanced double-entry ledger entries
    const ledgerEntries = await prisma.financialLedgerEntry.findMany({
      where: {
        transaction: {
          transactionRef: { contains: sameCurrencyTransfer.transferRef },
        },
      },
    });
    assert(ledgerEntries.length >= 2, 'Balanced double-entry ledger entries created');
    const debitEntry = ledgerEntries.find((e) => e.entryType === 'DEBIT');
    const creditEntry = ledgerEntries.find((e) => e.entryType === 'CREDIT');
    assert(debitEntry !== undefined && Number(debitEntry.amount) === 30000, 'Ledger DEBIT entry matches source amount');
    assert(creditEntry !== undefined && Number(creditEntry.amount) === 29500, 'Ledger CREDIT entry matches net dest amount');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Currency Conversion Transfer (USD -> Toman)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 3: Currency Conversion Transfer (USD -> Toman) ---');

    const tomanBankAccount = await createFinancialAccount({
      accountRef: `BNK_${testId}`,
      name: `Mellat Treasury ${testId}`,
      category: 'INTERNAL',
      accountType: 'BANK_ACCOUNT',
      currency: 'IRR',
      openingBalance: 0,
      bankName: 'Mellat',
      accountNumber: '12345678',
      adminId: adminDiscordId,
    });

    // Transfer $100.00 (10,000 cents) from USD Wallet to Toman Bank at 90,000 rate with 0 fee
    // Expected: 100 * 90,000 = 9,000,000 Toman
    const usdToIrtTransfer = await executeInternalTransfer({
      sourceAccountId: usdWalletAccount.id,
      destinationAccountId: tomanBankAccount.id,
      sourceAmount: 10000, // $100.00
      feeAmount: 0,
      exchangeRate: 90000,
      description: 'Treasury liquidation USD -> Toman',
      adminId: adminDiscordId,
      idempotencyKey: `idemp_conv_usd_irt_${testId}`,
    });

    assert(usdToIrtTransfer.transferType === 'CURRENCY_CONVERSION', 'Transfer recognized as CURRENCY_CONVERSION');
    assert(usdToIrtTransfer.sourceAmount === 10000, 'Source amount is 10,000 cents ($100.00)');
    assert(usdToIrtTransfer.destinationAmount === 9000000, 'Destination amount is exact integer 9,000,000 Toman');
    assert(usdToIrtTransfer.destinationCurrency === 'IRR', 'Destination currency is IRR (Toman)');

    const tomanAccAfterConv = await prisma.financialAccount.findUniqueOrThrow({ where: { id: tomanBankAccount.id } });
    assert(
      Number(tomanAccAfterConv.currentBalance) === 9000000,
      'Toman bank account credited with exactly 9,000,000 Toman',
      `Actual balance: ${tomanAccAfterConv.currentBalance}`
    );

    const usdWalletAfterConv = await prisma.financialAccount.findUniqueOrThrow({ where: { id: usdWalletAccount.id } });
    assert(
      Number(usdWalletAfterConv.currentBalance) === 19500,
      'USD Wallet debited by $100.00 (29,500 - 10,000 = 19,500 cents)',
      `Actual balance: ${usdWalletAfterConv.currentBalance}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Currency Conversion Transfer (Toman -> USD)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 4: Currency Conversion Transfer (Toman -> USD) ---');

    // Transfer 4,500,000 Toman -> USD Wallet at 90,000 rate
    // Expected: (4,500,000 / 90,000) = $50.00 -> 5,000 cents
    const irtToUsdTransfer = await executeInternalTransfer({
      sourceAccountId: tomanBankAccount.id,
      destinationAccountId: usdWalletAccount.id,
      sourceAmount: 4500000,
      feeAmount: 0,
      exchangeRate: 90000,
      description: 'Buy USDT from Toman',
      adminId: adminDiscordId,
    });

    assert(irtToUsdTransfer.destinationAmount === 5000, 'Destination amount is exact integer 5,000 cents ($50.00)');
    const usdWalletAfterBuy = await prisma.financialAccount.findUniqueOrThrow({ where: { id: usdWalletAccount.id } });
    assert(
      Number(usdWalletAfterBuy.currentBalance) === 24500,
      'USD wallet credited with $50.00 (19,500 + 5,000 = 24,500 cents)'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Overdraft Prevention on Internal Transfers
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 5: Overdraft Prevention on Internal Transfers ---');

    let overdraftFailed = false;
    try {
      await executeInternalTransfer({
        sourceAccountId: usdWalletAccount.id,
        destinationAccountId: eldoradoAccount.id,
        sourceAmount: 1000000, // $10,000.00 (available is only $245.00)
        adminId: adminDiscordId,
      });
    } catch (err: any) {
      overdraftFailed = true;
      assert(err.message.includes('INSUFFICIENT_FUNDS'), 'Overdraft throws INSUFFICIENT_FUNDS error', err.message);
    }
    assert(overdraftFailed, 'Transfer exceeding available balance strictly blocked');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Withdrawal Request & Strict Fund Reservation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 6: Withdrawal Request & Strict Fund Reservation ---');

    // eldoradoAccount currently has 70,000 cents ($700.00) available.
    // Request withdrawal of $200.00 (20,000 cents) with $5.00 (500 cents) fee
    const withdrawal = await requestPlatformWithdrawal({
      sourceAccountId: eldoradoAccount.id,
      amount: 20000,
      fee: 500,
      withdrawalType: 'PLATFORM_WITHDRAWAL',
      destinationType: 'CRYPTO_WALLET',
      destinationDetails: 'USDT TRC20: TXYZ1234567890',
      description: 'Platform liquidation to USDT wallet',
      adminId: adminDiscordId,
      idempotencyKey: `idemp_wth_${testId}`,
    });

    assert(withdrawal.status === 'PENDING', 'Withdrawal status is PENDING');
    assert(withdrawal.amount === 20000, 'Withdrawal amount is 20,000 cents ($200.00)');
    assert(withdrawal.netAmount === 19500, 'Net payout amount is 19,500 cents ($195.00)');

    // Verify reservation invariant:
    // currentBalance is UNCHANGED (still 70,000)
    // reservedBalance is CREDITED (0 -> 20,000)
    // availableBalance is DEBITED (70,000 -> 50,000)
    const sourceAccDuringWth = await prisma.financialAccount.findUniqueOrThrow({ where: { id: eldoradoAccount.id } });
    assert(
      Number(sourceAccDuringWth.currentBalance) === 70000,
      'currentBalance is NOT deducted during PENDING request (still 70,000 cents)',
      `Actual: ${sourceAccDuringWth.currentBalance}`
    );
    assert(
      Number(sourceAccDuringWth.reservedBalance) === 20000,
      'reservedBalance is credited by requested gross amount (+20,000 cents)',
      `Actual: ${sourceAccDuringWth.reservedBalance}`
    );
    assert(
      Number(sourceAccDuringWth.availableBalance) === 50000,
      'availableBalance is debited by requested gross amount (70,000 - 20,000 = 50,000 cents)',
      `Actual: ${sourceAccDuringWth.availableBalance}`
    );

    // Double spending test: attempt another withdrawal of $600.00 when only $500.00 is available
    let doubleSpendBlocked = false;
    try {
      await requestPlatformWithdrawal({
        sourceAccountId: eldoradoAccount.id,
        amount: 60000,
        adminId: adminDiscordId,
      });
    } catch (err: any) {
      doubleSpendBlocked = true;
      assert(err.message.includes('INSUFFICIENT_FUNDS'), 'Cannot withdraw reserved funds', err.message);
    }
    assert(doubleSpendBlocked, 'Reserved funds cannot be withdrawn concurrently');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Withdrawal Processing Transition
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 7: Withdrawal Processing Lifecycle Transition ---');

    const processingWth = await markWithdrawalProcessing(withdrawal.id);
    assert(processingWth.status === 'PROCESSING', 'Withdrawal advanced to PROCESSING');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Withdrawal Settlement / Completion (Deduction of Reserved Funds)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 8: Withdrawal Settlement / Completion ---');

    const completedWth = await completePlatformWithdrawal({
      withdrawalId: withdrawal.id,
      referenceNumber: `TXHASH_${testId}_9988`,
      attachmentUrl: 'https://cdn.g4x.online/receipts/test-payout.pdf',
      notes: 'USDT TRC20 confirmed on Tronscan',
      processedBy: adminDiscordId,
    });

    assert(completedWth.status === 'COMPLETED', 'Withdrawal status updated to COMPLETED');
    assert(completedWth.referenceNumber === `TXHASH_${testId}_9988`, 'Settlement reference number stored');

    // Verify balance settlement invariant:
    // currentBalance is now DEDUCTED (70,000 - 20,000 = 50,000)
    // reservedBalance is RELEASED/DEDUCTED (20,000 - 20,000 = 0)
    // availableBalance remains 50,000
    const sourceAccSettled = await prisma.financialAccount.findUniqueOrThrow({ where: { id: eldoradoAccount.id } });
    assert(
      Number(sourceAccSettled.currentBalance) === 50000,
      'currentBalance permanently deducted on completion (70,000 - 20,000 = 50,000 cents)',
      `Actual: ${sourceAccSettled.currentBalance}`
    );
    assert(
      Number(sourceAccSettled.reservedBalance) === 0,
      'reservedBalance cleared back to 0',
      `Actual: ${sourceAccSettled.reservedBalance}`
    );
    assert(
      Number(sourceAccSettled.availableBalance) === 50000,
      'availableBalance remains 50,000 cents',
      `Actual: ${sourceAccSettled.availableBalance}`
    );

    // Anti-double-deduction: attempt to complete again
    let doubleCompleteBlocked = false;
    try {
      await completePlatformWithdrawal({
        withdrawalId: withdrawal.id,
        processedBy: adminDiscordId,
      });
    } catch (err: any) {
      doubleCompleteBlocked = true;
      assert(err.message.includes('INVALID_STATUS'), 'Cannot settle an already completed withdrawal', err.message);
    }
    assert(doubleCompleteBlocked, 'Settling an already completed withdrawal is strictly rejected');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Withdrawal Rejection & Safe Release of Reserved Funds
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 9: Withdrawal Rejection & Safe Release of Reserved Funds ---');

    // Request new withdrawal of $100.00 (10,000 cents) from Eldorado
    const wthToReject = await requestPlatformWithdrawal({
      sourceAccountId: eldoradoAccount.id,
      amount: 10000,
      adminId: adminDiscordId,
    });

    const accDuringRejectable = await prisma.financialAccount.findUniqueOrThrow({ where: { id: eldoradoAccount.id } });
    assert(Number(accDuringRejectable.availableBalance) === 40000, 'Available balance debited to 40,000');
    assert(Number(accDuringRejectable.reservedBalance) === 10000, 'Reserved balance credited to 10,000');

    // Reject the withdrawal
    const rejectedWth = await rejectPlatformWithdrawal({
      withdrawalId: wthToReject.id,
      reason: 'Invalid recipient crypto address network',
      adminId: adminDiscordId,
    });

    assert(rejectedWth.status === 'REJECTED', 'Withdrawal status set to REJECTED');
    assert(Boolean(rejectedWth.rejectionReason?.includes('Invalid recipient')), 'Rejection reason recorded');

    // Verify funds restoration:
    // reservedBalance decremented (10,000 -> 0)
    // availableBalance incremented (40,000 -> 50,000)
    // currentBalance was NEVER altered (remains 50,000)
    const accAfterRejection = await prisma.financialAccount.findUniqueOrThrow({ where: { id: eldoradoAccount.id } });
    assert(
      Number(accAfterRejection.reservedBalance) === 0,
      'reservedBalance cleared back to 0 on rejection'
    );
    assert(
      Number(accAfterRejection.availableBalance) === 50000,
      'availableBalance restored back to 50,000 cents on rejection'
    );
    assert(
      Number(accAfterRejection.currentBalance) === 50000,
      'currentBalance remained completely untouched at 50,000 cents'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Idempotency Key Duplicate Request Protection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 10: Idempotency Enforcement ---');

    const duplicateTransfer = await executeInternalTransfer({
      sourceAccountId: eldoradoAccount.id,
      destinationAccountId: usdWalletAccount.id,
      sourceAmount: 30000,
      feeAmount: 500,
      adminId: adminDiscordId,
      idempotencyKey: `idemp_trf_same_${testId}`, // Same key as Test 2!
    });

    assert(
      duplicateTransfer.id === sameCurrencyTransfer.id,
      'Duplicate transfer call with same idempotency key returns existing record without re-execution'
    );

    const duplicateWithdrawal = await requestPlatformWithdrawal({
      sourceAccountId: eldoradoAccount.id,
      amount: 20000,
      adminId: adminDiscordId,
      idempotencyKey: `idemp_wth_${testId}`, // Same key as Test 6!
    });

    assert(
      duplicateWithdrawal.id === withdrawal.id,
      'Duplicate withdrawal call with same idempotency key returns existing record without double reservation'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: REST API Permissions & Role-Based Access Control
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 11: REST API Permissions & RBAC ---');

    // Unauthenticated request to /api/admin/financial-accounts/transfers
    const unauthRes = await request(app).get('/api/admin/financial-accounts/transfers');
    assert(unauthRes.status === 401, 'Unauthenticated request to transfers API returns 401 Unauthorized');

    // Regular user request to /api/admin/financial-accounts/transfers
    const forbiddenRes = await userAgent.get('/api/admin/financial-accounts/transfers');
    assert(forbiddenRes.status === 403, 'Regular user request to transfers API returns 403 Forbidden');

    // Admin request to /api/admin/financial-accounts/transfers
    const adminTransfersRes = await adminAgent.get('/api/admin/financial-accounts/transfers');
    if (adminTransfersRes.status !== 200) {
      console.log('adminTransfersRes failed:', adminTransfersRes.status, adminTransfersRes.body);
    }
    assert(adminTransfersRes.status === 200 && adminTransfersRes.body.success, 'Admin request returns 200 OK with transfers list', JSON.stringify(adminTransfersRes.body));

    // Admin request to /api/admin/financial-accounts/withdrawals
    const adminWthRes = await adminAgent.get('/api/admin/financial-accounts/withdrawals');
    assert(adminWthRes.status === 200 && adminWthRes.body.success, 'Admin request returns 200 OK with withdrawals list');

    // Admin request to active exchange rate
    const adminRateRes = await adminAgent.get('/api/admin/financial-accounts/exchange-rates/active');
    assert(adminRateRes.status === 200 && adminRateRes.body.rate?.rate === 90000, 'Admin request returns active exchange rate');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12: Transfers CSV Export
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 12: Transfers CSV Export ---');

    const csvRes = await adminAgent.get('/api/admin/financial-accounts/transfers/export-csv');
    assert(csvRes.status === 200, 'CSV export returns HTTP 200');
    assert(Boolean(csvRes.headers['content-type']?.includes('text/csv')), 'Content-Type is text/csv');
    assert(csvRes.text.includes('Transfer Ref'), 'CSV includes header column "Transfer Ref"');
    assert(csvRes.text.includes(sameCurrencyTransfer.transferRef), 'CSV includes settled transfer reference');

    console.log('\n================================================================');
    console.log(`✅  ALL PHASE 2 TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
    console.log('================================================================\n');
  } finally {
    // Cleanup test users and test accounts
    try {
      await prisma.userRole.deleteMany({
        where: { user: { discordId: { in: [adminDiscordId, regularUserDiscordId] } } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [adminDiscordId, regularUserDiscordId] } },
      });
    } catch (_) {}
  }
}

// Run test suite
runPhase2FinancialSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌  PHASE 2 TEST SUITE FAILED:', err);
    process.exit(1);
  });
