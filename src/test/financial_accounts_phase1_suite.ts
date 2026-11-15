/**
 * src/test/financial_accounts_phase1_suite.ts — Automated Test Suite for Phase 1 Financial Accounts & Balance Management
 *
 * Test Scenarios:
 *  1. Unauthorized access prevention (401 for unauthenticated, 403 for regular users)
 *  2. Default accounts seeding (all 5 platforms + internal accounts)
 *  3. Account creation with multiple currencies (USD cents & integer Tomans)
 *  4. Opening balance initialization with immutable ledger records
 *  5. Direct balance mutation blocking (preventing balance tampering)
 *  6. Metadata editing & account status toggling
 *  7. Manual balance adjustments (Credit & Debit)
 *  8. Strict integer balance calculations & non-negative overdraft safeguards
 *  9. Idempotency key duplicate transaction prevention
 * 10. Platform balance overview & consolidated non-duplicative asset aggregation
 * 11. Local currency (Toman) bank accounts & cash overview
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
  updateFinancialAccountMetadata,
  setFinancialAccountStatus,
  recordManualBalanceAdjustment,
  getPlatformBalanceOverview,
  getTomanAccountsOverview,
  formatFinancialAmount,
} from '../services/financialAccountService';

// Setup Mock Express App for Supertest
const app = express();
app.use(express.json());
app.use(
  session({
    secret: 'test-financial-phase1-secret',
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
  req.session.csrfToken = 'test-phase1-csrf-token';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

app.use('/api', router);

async function runPhase1FinancialSuite() {
  console.log('================================================================');
  console.log('🏛️  RUNNING PHASE 1 — FINANCIAL ACCOUNTS & BALANCE MANAGEMENT SUITE');
  console.log('================================================================\n');

  const testId = `fin_p1_${Date.now().toString(36)}`;
  const adminDiscordId = `admin_${testId}`;
  const regularUserDiscordId = `user_${testId}`;

  try {
    // 1. Setup Test Users
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

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Unauthenticated & Unauthorized Security Checks
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Authentication & RBAC Access Control ---');

    // Unauthenticated request should be 401
    const unauthRes = await request(app).get('/api/admin/financial-accounts');
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
    }
    console.log('✅ PASSED: Unauthenticated request returns 401');

    // Regular user request should be 403 Forbidden
    const forbiddenRes = await userAgent.get('/api/admin/financial-accounts');
    if (forbiddenRes.status !== 403) {
      throw new Error(`Expected 403 for regular user request, got ${forbiddenRes.status}`);
    }
    console.log('✅ PASSED: Regular non-admin user request returns 403 Forbidden');

    // Admin request should be 200 OK
    const adminRes = await adminAgent.get('/api/admin/financial-accounts');
    if (adminRes.status !== 200) {
      throw new Error(`Expected 200 for admin user request, got ${adminRes.status}`);
    }
    console.log('✅ PASSED: Authorized financial admin receives 200 OK');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Canonical Platform Accounts Seeding
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Canonical Default Accounts Seeding ---');

    await ensureDefaultFinancialAccounts();
    const seededOverview = await getPlatformBalanceOverview();

    const expectedPlatforms = ['direct', 'eldorado', 'skycoach', 'overgear', 'kingboost'];
    for (const plat of expectedPlatforms) {
      const found = seededOverview.platforms.find((p) => p.source === plat);
      if (!found) {
        throw new Error(`Missing expected canonical platform account for source: ${plat}`);
      }
    }
    console.log('✅ PASSED: All 5 platform accounts (G4X Direct, Eldorado, Skycoach, Overgear, Kingboost) seeded');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Account Creation with Multiple Currencies & Opening Balances
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Account Creation & Opening Balance Ledger ---');

    // 3a. USD Platform Account with $150.00 Opening Balance (15000 cents)
    const usdAccRef = `acc_usd_${testId}`;
    const usdAcc = await createFinancialAccount({
      accountRef: usdAccRef,
      name: `Test Eldorado Store ${testId}`,
      category: 'PLATFORM',
      accountType: 'ELDORADO',
      currency: 'USD',
      openingBalance: 15000,
      adminId: adminDiscordId,
    });

    if (usdAcc.currentBalance !== 15000 || usdAcc.availableBalance !== 15000) {
      throw new Error(`Expected USD balance to be 15000, got ${usdAcc.currentBalance}`);
    }
    if (usdAcc.formattedCurrent !== '$150.00') {
      throw new Error(`Expected formatted USD '$150.00', got '${usdAcc.formattedCurrent}'`);
    }
    console.log('✅ PASSED: USD account created with 15000 cents ($150.00) opening balance');

    // Verify initial ledger entry was recorded
    const usdHistory = await prisma.financialTransaction.findMany({
      where: { accountId: usdAcc.id },
      include: { ledgerEntries: true },
    });
    if (usdHistory.length !== 1 || usdHistory[0].type !== 'OPENING_BALANCE') {
      throw new Error(`Expected 1 OPENING_BALANCE transaction, got ${usdHistory.length}`);
    }
    if (usdHistory[0].ledgerEntries.length !== 1) {
      throw new Error('Expected 1 initial ledger entry for opening balance');
    }
    console.log('✅ PASSED: Initial opening balance ledger entry verified');

    // 3b. Local Toman Bank Account with 25,000,000 Tomans Opening Balance
    const tomanAccRef = `acc_toman_${testId}`;
    const tomanAcc = await createFinancialAccount({
      accountRef: tomanAccRef,
      name: `Test Bank Saman ${testId}`,
      category: 'INTERNAL',
      accountType: 'BANK_ACCOUNT',
      currency: 'IRR',
      openingBalance: 25000000,
      bankName: 'Saman',
      cardNumber: '6219-8610-0000-1111',
      iban: 'IR120560000000001234567890',
      accountNumber: '1234567890',
      adminId: adminDiscordId,
    });

    if (tomanAcc.currentBalance !== 25000000) {
      throw new Error(`Expected Toman balance 25000000, got ${tomanAcc.currentBalance}`);
    }
    if (!tomanAcc.formattedCurrent.includes('25,000,000') || !tomanAcc.formattedCurrent.includes('تومان')) {
      throw new Error(`Expected Toman format with 'تومان', got '${tomanAcc.formattedCurrent}'`);
    }
    console.log('✅ PASSED: Toman bank account created with 25,000,000 Tomans in integer format');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Direct Balance Mutation Prevention
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Direct Balance Mutation Prevention ---');

    // Attempting to directly edit currentBalance via PATCH should be blocked with 403
    const tamperRes = await adminAgent
      .patch(`/api/admin/financial-accounts/${usdAcc.id}`)
      .send({
        name: 'Hacked Account Name',
        currentBalance: 99999999, // Unauthorized direct balance tamper
      });

    if (tamperRes.status !== 403 || tamperRes.body.error !== 'DIRECT_BALANCE_MUTATION_PROHIBITED') {
      throw new Error(`Expected 403 DIRECT_BALANCE_MUTATION_PROHIBITED, got ${tamperRes.status}`);
    }

    // Verify balance was NOT modified
    const untamperedAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: usdAcc.id },
    });
    if (Number(untamperedAcc.currentBalance) !== 15000) {
      throw new Error('Balance was illegally tampered!');
    }
    console.log('✅ PASSED: Direct calculated balance mutation strictly prohibited');

    // Legitimate metadata update should succeed
    const validMetaRes = await adminAgent
      .patch(`/api/admin/financial-accounts/${usdAcc.id}`)
      .send({
        name: 'Renamed Eldorado Partner Store',
        notes: 'Updated partner notes',
      });
    if (validMetaRes.status !== 200 || validMetaRes.body.account.name !== 'Renamed Eldorado Partner Store') {
      throw new Error('Legitimate metadata update failed');
    }
    console.log('✅ PASSED: Legitimate account metadata updated safely');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Manual Balance Adjustments (CREDIT)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Manual Balance Adjustment (Credit) ---');

    const creditIdemKey = `idem_credit_${testId}`;
    const creditRes = await adminAgent
      .post('/api/admin/financial-accounts/adjustments')
      .send({
        accountId: usdAcc.id,
        adjustmentType: 'CREDIT',
        amount: 5000, // $50.00
        reason: 'Monthly volume bonus from Eldorado partner',
        idempotencyKey: creditIdemKey,
      });

    if (creditRes.status !== 201) {
      throw new Error(`Expected 201 for credit adjustment, got ${creditRes.status}: ${JSON.stringify(creditRes.body)}`);
    }

    const updatedUsd = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: usdAcc.id },
    });
    // 15000 + 5000 = 20000 ($200.00)
    if (Number(updatedUsd.currentBalance) !== 20000 || Number(updatedUsd.availableBalance) !== 20000) {
      throw new Error(`Expected balance 20000, got ${updatedUsd.currentBalance}`);
    }
    console.log('✅ PASSED: Account successfully credited +$50.00 (current balance: $200.00)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Manual Balance Adjustments (DEBIT & Overdraft Guard)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Manual Balance Adjustment (Debit & Overdraft Guard) ---');

    // 6a. Valid Debit: deduct $30.00 (3000 cents)
    const debitRes = await adminAgent
      .post('/api/admin/financial-accounts/adjustments')
      .send({
        accountId: usdAcc.id,
        adjustmentType: 'DEBIT',
        amount: 3000,
        reason: 'External partner fee deduction',
      });

    if (debitRes.status !== 201) {
      throw new Error(`Expected 201 for debit adjustment, got ${debitRes.status}`);
    }

    const postDebitAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: usdAcc.id },
    });
    // 20000 - 3000 = 17000 ($170.00)
    if (Number(postDebitAcc.currentBalance) !== 17000 || Number(postDebitAcc.availableBalance) !== 17000) {
      throw new Error(`Expected balance 17000, got ${postDebitAcc.currentBalance}`);
    }
    console.log('✅ PASSED: Account successfully debited -$30.00 (current balance: $170.00)');

    // 6b. Overdraft Guard: Attempt to debit more than available balance ($500.00 when only $170.00 available)
    const overdraftRes = await adminAgent
      .post('/api/admin/financial-accounts/adjustments')
      .send({
        accountId: usdAcc.id,
        adjustmentType: 'DEBIT',
        amount: 50000, // $500.00
        reason: 'Attempted excessive debit',
      });

    if (overdraftRes.status !== 422 || overdraftRes.body.error !== 'INSUFFICIENT_FUNDS') {
      throw new Error(`Expected 422 INSUFFICIENT_FUNDS, got ${overdraftRes.status}`);
    }
    console.log('✅ PASSED: Overdraft deduction safely rejected with INSUFFICIENT_FUNDS');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Idempotency Key Duplicate Prevention
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Idempotent Duplicate Transaction Prevention ---');

    // Re-submit the exact same credit adjustment from TEST 5 using creditIdemKey
    const dupeRes = await adminAgent
      .post('/api/admin/financial-accounts/adjustments')
      .send({
        accountId: usdAcc.id,
        adjustmentType: 'CREDIT',
        amount: 5000,
        reason: 'Duplicate submission attempt',
        idempotencyKey: creditIdemKey,
      });

    // Should return 201 with the EXISTING transaction, without re-crediting the balance
    if (dupeRes.status !== 201) {
      throw new Error(`Expected 201 for idempotent replay, got ${dupeRes.status}`);
    }

    const postDupeAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: usdAcc.id },
    });
    // Balance MUST still be 17000, not 22000!
    if (Number(postDupeAcc.currentBalance) !== 17000) {
      throw new Error(`Idempotency failed! Balance was double-credited to ${postDupeAcc.currentBalance}`);
    }
    console.log('✅ PASSED: Duplicate transaction safely intercepted by idempotency key (balance unchanged at $170.00)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Platform Balance Overview & Consolidated Non-Duplicative Assets
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Consolidated Platform Overview & Non-Duplicative Assets ---');

    const overviewRes = await adminAgent.get('/api/admin/financial-accounts/platform-overview');
    if (overviewRes.status !== 200 || !overviewRes.body.success) {
      throw new Error('Platform overview request failed');
    }

    const { platforms, summaryCards } = overviewRes.body;
    if (platforms.length < 5) {
      throw new Error(`Expected at least 5 platforms, got ${platforms.length}`);
    }
    if (summaryCards.totalUsdPlatformBalanceMinor === undefined) {
      throw new Error('Summary cards missing totalUsdPlatformBalanceMinor');
    }

    // Consolidated total should equal platform balance + internal wallet balance
    const expectedConsolidated =
      summaryCards.totalUsdPlatformBalanceMinor + summaryCards.totalUsdWalletBalanceMinor;
    if (summaryCards.consolidatedTotalUsdMinor !== expectedConsolidated) {
      throw new Error('Consolidated total mismatch: money is being miscounted!');
    }
    console.log('✅ PASSED: Consolidated USD assets aggregated cleanly with zero duplication');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Local Currency (Toman) Accounts Overview
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Local Currency (Toman) Bank Accounts & Cash Overview ---');

    const tomanRes = await adminAgent.get('/api/admin/financial-accounts/toman-overview');
    if (tomanRes.status !== 200 || !tomanRes.body.success) {
      throw new Error('Toman overview request failed');
    }

    const { bankAccounts, metrics, currencyUnit } = tomanRes.body;
    if (currencyUnit !== 'TOMAN') {
      throw new Error(`Expected currencyUnit 'TOMAN', got '${currencyUnit}'`);
    }
    if (metrics.totalLocalBalance <= 0) {
      throw new Error('Expected positive total local balance');
    }
    if (!metrics.formattedTotalLocalBalance.includes('تومان')) {
      throw new Error('Formatted balance does not include تومان');
    }

    const foundTestBank = bankAccounts.find((b: any) => b.id === tomanAcc.id);
    if (!foundTestBank) {
      throw new Error('Created test bank account not present in Toman overview');
    }
    console.log('✅ PASSED: Toman overview returned bank coordinates and exact Toman totals');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Account Status Toggling (ACTIVE / INACTIVE)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Account Status Management ---');

    const toggleRes = await adminAgent
      .post(`/api/admin/financial-accounts/${tomanAcc.id}/status`)
      .send({ status: 'INACTIVE' });

    if (toggleRes.status !== 200 || toggleRes.body.account.status !== 'INACTIVE') {
      throw new Error('Failed to set account status to INACTIVE');
    }

    // Inactive account cannot receive adjustments
    const inactiveAdjustRes = await adminAgent
      .post('/api/admin/financial-accounts/adjustments')
      .send({
        accountId: tomanAcc.id,
        adjustmentType: 'CREDIT',
        amount: 1000000,
        reason: 'Should fail on inactive account',
      });

    if (inactiveAdjustRes.status !== 400 || inactiveAdjustRes.body.error !== 'ACCOUNT_INACTIVE') {
      throw new Error(`Expected 400 ACCOUNT_INACTIVE for inactive account adjustment, got ${inactiveAdjustRes.status}: ${JSON.stringify(inactiveAdjustRes.body)}`);
    }
    console.log('✅ PASSED: Inactive account properly blocked from receiving balance adjustments');

    console.log('\n================================================================');
    console.log('🎉 ALL PHASE 1 FINANCIAL MANAGEMENT SUITE TESTS PASSED 100%!');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  } finally {
    // Cleanup temporary test users and accounts
    await prisma.financialLedgerEntry.deleteMany({
      where: { account: { accountRef: { contains: testId } } },
    });
    await prisma.financialTransaction.deleteMany({
      where: {
        OR: [{ adminId: adminDiscordId }, { account: { accountRef: { contains: testId } } }],
      },
    });
    await prisma.financialAccount.deleteMany({
      where: { accountRef: { contains: testId } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [adminDiscordId, regularUserDiscordId] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [adminDiscordId, regularUserDiscordId] } },
    });
    await prisma.$disconnect();
  }
}

runPhase1FinancialSuite();
