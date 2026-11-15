/**
 * src/test/financial_ledger_phase4_suite.ts — Automated Test Suite for Phase 4:
 * Double-Entry Financial Ledger, Audit Trail, Transaction Reversals, and Balance Reconciliation.
 */

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import prisma from '../database/db';
import { router } from '../web/routes';
import {
  recordDoubleEntryJournalEntry,
  calculateTrialBalance,
  listDoubleEntryJournalEntries,
  recordFinancialAuditLog,
  listFinancialAuditLogs,
  performBalanceReconciliation,
  resolveReconciliationDiscrepancy,
  reverseFinancialTransaction,
  generateJournalCsv,
  generateAuditLogsCsv,
  resolveUserFinancialRole,
  hasFinancialPermission,
} from '../services/financialLedgerAndAuditService';
import {
  ensureDefaultFinancialAccounts,
  recordManualBalanceAdjustment,
  createFinancialAccount,
} from '../services/financialAccountService';

// Setup Mock Express App for Supertest
const app = express();
app.use(express.json());
app.use(
  session({
    secret: 'test-financial-phase4-secret',
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
  req.session.csrfToken = 'test-phase4-csrf-token';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

app.use('/api', router);

async function runPhase4FinancialSuite() {
  console.log('================================================================');
  console.log('📖  RUNNING PHASE 4 — FINANCIAL LEDGER, AUDIT & RECONCILIATION SUITE');
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

  const testId = `led_p4_${Date.now().toString(36)}`;
  const adminDiscordId = `admin_${testId}`;
  const regularUserDiscordId = `user_${testId}`;

  try {
    // 0. Ensure Default Financial Accounts & Setup Test Users
    await ensureDefaultFinancialAccounts();

    await prisma.role.upsert({
      where: { roleKey: 'admin' },
      update: {},
      create: { roleKey: 'admin', name: 'Admin' },
    });
    await prisma.role.upsert({
      where: { roleKey: 'owner' },
      update: {},
      create: { roleKey: 'owner', name: 'Owner' },
    });
    await prisma.role.upsert({
      where: { roleKey: 'booster' },
      update: {},
      create: { roleKey: 'booster', name: 'Booster' },
    });

    const adminUser = await prisma.user.create({
      data: {
        discordId: adminDiscordId,
        username: `AdminTester_${testId}`,
        userRoles: {
          create: [{ roleKey: 'owner' }],
        },
      },
    });

    const regularUser = await prisma.user.create({
      data: {
        discordId: regularUserDiscordId,
        username: `RegularUser_${testId}`,
        userRoles: {
          create: [{ roleKey: 'booster' }],
        },
      },
    });

    // Create Agent for API requests
    const agent = request.agent(app);

    // Fetch default accounts for testing
    const usdWallet = await prisma.financialAccount.findUniqueOrThrow({
      where: { accountRef: 'wallet_usd_treasury' },
    });
    const eldoradoAccount = await prisma.financialAccount.findUniqueOrThrow({
      where: { accountRef: 'eldorado_main' },
    });
    const tomanWallet = await prisma.financialAccount.findUniqueOrThrow({
      where: { accountRef: 'wallet_toman_main' },
    });
    const tomanCash = await prisma.financialAccount.findUniqueOrThrow({
      where: { accountRef: 'cash_tehran_vault' },
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 1: Double-Entry Journal Recording & Validation Rules
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('--- SCENARIO 1: Double-Entry Journal Posting & Constraints ---');

    // Test 1.1: Successful Double-Entry Journal Posting
    const entry1 = await recordDoubleEntryJournalEntry({
      transactionType: 'INTERNAL_TRANSFER',
      debitAccountId: usdWallet.id,
      creditAccountId: eldoradoAccount.id,
      amountMinor: 25000, // $250.00
      currency: 'USD',
      description: 'Transfer from Eldorado to USD Wallet',
    });

    assert(Boolean(entry1 && entry1.id), 'Record valid double-entry journal entry');
    assert(entry1.amountMinor === 25000, 'Journal entry preserves exact integer amount');
    assert(entry1.currency === 'USD', 'Journal entry preserves currency');
    assert(entry1.entryRef.startsWith('JNL-'), 'Journal entry generates canonical JNL- reference');

    // Test 1.2: Validation - Same Debit and Credit Account must be rejected
    let rejectedSameAccount = false;
    try {
      await recordDoubleEntryJournalEntry({
        transactionType: 'ADJUSTMENT',
        debitAccountId: usdWallet.id,
        creditAccountId: usdWallet.id,
        amountMinor: 10000,
        currency: 'USD',
      });
    } catch (err: any) {
      rejectedSameAccount = true;
      assert(err.message.includes('distinct'), 'Rejects double-entry with identical debit and credit accounts');
    }
    assert(rejectedSameAccount, 'Identical debit and credit account rejected');

    // Test 1.3: Validation - Currency Mismatch between accounts must be rejected
    let rejectedCurrencyMismatch = false;
    try {
      await recordDoubleEntryJournalEntry({
        transactionType: 'INTERNAL_TRANSFER',
        debitAccountId: usdWallet.id, // USD
        creditAccountId: tomanWallet.id, // IRR
        amountMinor: 10000,
        currency: 'USD',
      });
    } catch (err: any) {
      rejectedCurrencyMismatch = true;
      assert(err.message.includes('currency'), 'Rejects double-entry when account currency does not match entry currency');
    }
    assert(rejectedCurrencyMismatch, 'Currency mismatch rejected');

    // Test 1.4: Validation - Non-positive amount rejected
    let rejectedNegativeAmount = false;
    try {
      await recordDoubleEntryJournalEntry({
        transactionType: 'ADJUSTMENT',
        debitAccountId: usdWallet.id,
        creditAccountId: eldoradoAccount.id,
        amountMinor: -500,
        currency: 'USD',
      });
    } catch (err: any) {
      rejectedNegativeAmount = true;
    }
    assert(rejectedNegativeAmount, 'Negative or zero journal amounts are strictly rejected');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 2: Trial Balance Mathematical Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 2: Trial Balance Mathematical Verification ---');

    // Post additional balanced journal entries in USD and IRR
    await recordDoubleEntryJournalEntry({
      transactionType: 'ORDER_REVENUE',
      debitAccountId: eldoradoAccount.id,
      creditAccountId: usdWallet.id,
      amountMinor: 15000, // $150.00
      currency: 'USD',
    });

    await recordDoubleEntryJournalEntry({
      transactionType: 'INTERNAL_TRANSFER',
      debitAccountId: tomanCash.id,
      creditAccountId: tomanWallet.id,
      amountMinor: 50000000, // 50,000,000 Tomans
      currency: 'IRR',
    });

    // Test 2.1: USD Trial Balance
    const usdTrialBalance = await calculateTrialBalance('USD');
    assert(usdTrialBalance.currency === 'USD', 'USD trial balance reports USD currency');
    assert(usdTrialBalance.totalDebitsMinor === usdTrialBalance.totalCreditsMinor, 'USD Total Debits strictly equals Total Credits');
    assert(usdTrialBalance.discrepancyMinor === 0, 'USD Trial balance discrepancy is exactly 0');
    assert(usdTrialBalance.isBalanced === true, 'USD Trial balance is marked as isBalanced = true');
    assert(usdTrialBalance.accounts.length >= 2, 'USD Trial balance aggregates active accounts');

    // Test 2.2: IRR Trial Balance
    const irrTrialBalance = await calculateTrialBalance('IRR');
    assert(irrTrialBalance.currency === 'IRR', 'IRR trial balance reports IRR currency');
    assert(irrTrialBalance.totalDebitsMinor === irrTrialBalance.totalCreditsMinor, 'IRR Total Debits strictly equals Total Credits');
    assert(irrTrialBalance.discrepancyMinor === 0, 'IRR Trial balance discrepancy is exactly 0');
    assert(irrTrialBalance.isBalanced === true, 'IRR Trial balance is marked as isBalanced = true');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 3: Safe Transaction Reversals
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 3: Safe Transaction Reversals ---');

    // Create a standalone financial account with initial balance for reversal testing
    const testReversalAccount = await createFinancialAccount({
      name: `Reversal Test Account ${testId}`,
      accountRef: `rev_acc_${testId}`,
      category: 'INTERNAL',
      accountType: 'USD_WALLET',
      currency: 'USD',
      openingBalance: 100000, // $1,000.00
    });

    // Execute a credit manual adjustment to have a distinct transaction to reverse
    const creditAdjustment = await recordManualBalanceAdjustment({
      accountId: testReversalAccount.id,
      adjustmentType: 'CREDIT',
      amount: 20000, // $200.00
      reason: 'Bonus deposit for reversal testing',
      adminId: adminUser.discordId,
    });

    const originalTxId = creditAdjustment.id;
    const balanceBeforeReversal = Number((await prisma.financialAccount.findUniqueOrThrow({
      where: { id: testReversalAccount.id },
    })).currentBalance);

    // Test 3.1: Execute Transaction Reversal
    const reversalResult = await reverseFinancialTransaction({
      transactionIdOrRef: originalTxId,
      adminId: adminUser.discordId,
      reason: 'Accidental duplicate bonus payout',
      ipAddress: '127.0.0.1',
    });

    assert(Boolean(reversalResult && reversalResult.reversalTransactionId), 'Reversal transaction recorded');
    assert(reversalResult.originalTransactionId === originalTxId, 'Reversal correctly linked to original transaction');

    // Check reversal transaction record in database
    const revTxInDb = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: reversalResult.reversalTransactionId },
    });
    assert(revTxInDb.isReversal === true, 'Reversal entry flagged as isReversal = true');
    assert(revTxInDb.direction === 'DEBIT', 'Original CREDIT is counteracted by a DEBIT');
    assert(Number(revTxInDb.amount) === 20000, 'Reversal matches original amount exactly');

    // Verify balance after reversal
    const accountAfterReversal = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: testReversalAccount.id },
    });
    assert(
      Number(accountAfterReversal.currentBalance) === balanceBeforeReversal - 20000,
      'Account balance accurately decremented by reversal of credit'
    );

    // Verify original transaction is marked as REVERSED and NOT deleted
    const originalTxReloaded = await prisma.financialTransaction.findUniqueOrThrow({
      where: { id: originalTxId },
    });
    assert(originalTxReloaded.status === 'REVERSED', 'Original transaction status is REVERSED');
    assert(originalTxReloaded.reversedBy === adminUser.discordId, 'Original transaction records reversedBy');
    assert(originalTxReloaded.reversalReason === 'Accidental duplicate bonus payout', 'Original transaction records reversalReason');

    // Test 3.2: Reversing already reversed transaction must fail
    let duplicateReversalFailed = false;
    try {
      await reverseFinancialTransaction({
        transactionIdOrRef: originalTxId,
        adminId: adminUser.discordId,
        reason: 'Attempt duplicate reversal',
      });
    } catch (err: any) {
      duplicateReversalFailed = true;
      assert(err.message.toLowerCase().includes('already been reversed'), 'Rejects attempt to reverse an already reversed transaction', err.message);
    }
    assert(duplicateReversalFailed, 'Duplicate reversal prevention active');

    // Test 3.3: Reversing a reversal transaction itself must fail
    let reverseReversalFailed = false;
    try {
      await reverseFinancialTransaction({
        transactionIdOrRef: reversalResult.reversalTransactionId,
        adminId: adminUser.discordId,
        reason: 'Attempt to reverse a reversal',
      });
    } catch (err: any) {
      reverseReversalFailed = true;
      assert(err.message.includes('Cannot reverse a reversal transaction'), 'Rejects reversing a reversal');
    }
    assert(reverseReversalFailed, 'Reversal of a reversal blocked');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 4: Append-Only Financial Audit Trail
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 4: Append-Only Financial Audit Trail ---');

    // Test 4.1: Record Audit Log
    const auditEntry = await recordFinancialAuditLog({
      adminId: adminUser.discordId,
      actionType: 'BALANCE_ADJUSTED',
      relatedAccountId: testReversalAccount.id,
      previousState: { balance: 120000 },
      newState: { balance: 100000 },
      reason: 'Balance reconciliation adjustment test',
      ipAddress: '192.168.1.50',
    });

    assert(Boolean(auditEntry && auditEntry.id), 'Audit log successfully recorded');
    assert(auditEntry.logRef.startsWith('AUD-'), 'Audit log has canonical AUD- reference');
    assert(auditEntry.actionType === 'BALANCE_ADJUSTED', 'Audit log records correct actionType');
    assert(Boolean(auditEntry.previousState && auditEntry.newState), 'Audit log stores state diff JSON');

    // Test 4.2: List Audit Logs with filtering
    const auditLogsList = await listFinancialAuditLogs({
      relatedAccountId: testReversalAccount.id,
      actionType: 'BALANCE_ADJUSTED',
      limit: 10,
    });
    assert(auditLogsList.logs.length >= 1, 'Audit logs queried successfully with filters');
    assert(auditLogsList.total >= 1, 'Audit logs total count returned');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 5: Balance Reconciliation & Discrepancy Resolution
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 5: Balance Reconciliation & Discrepancy Resolution ---');

    const reconAccount = await createFinancialAccount({
      name: `Reconciliation Test Account ${testId}`,
      accountRef: `rec_acc_${testId}`,
      category: 'INTERNAL',
      accountType: 'USD_WALLET',
      currency: 'USD',
      openingBalance: 50000, // $500.00
    });

    // Test 5.1: Perform Reconciliation with Zero Discrepancy
    const matchRecon = await performBalanceReconciliation({
      accountId: reconAccount.id,
      actualBalanceMinor: 50000, // $500.00
      adminId: adminUser.discordId,
      notes: 'Statement matches system balance perfectly',
    });

    assert(matchRecon.status === 'BALANCED', 'Reconciliation with matching balance yields BALANCED status');
    assert(matchRecon.differenceMinor === 0, 'Reconciliation difference is 0');

    // Verify system balance was NOT modified
    const reconAccReload1 = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: reconAccount.id },
    });
    assert(Number(reconAccReload1.currentBalance) === 50000, 'System balance untouched by reconciliation check');

    // Test 5.2: Perform Reconciliation with Discrepancy (Actual = $550.00, System = $500.00)
    const discrepancyRecon = await performBalanceReconciliation({
      accountId: reconAccount.id,
      actualBalanceMinor: 55000, // $550.00
      adminId: adminUser.discordId,
      notes: 'Bank statement shows $550.00 (+$50.00 surplus)',
    });

    assert(discrepancyRecon.status === 'DISCREPANCY', 'Reconciliation with mismatch yields DISCREPANCY status');
    assert(discrepancyRecon.differenceMinor === 5000, 'Discrepancy difference calculation is accurate (+5000 minor)');

    // Invariant: System balance STILL untouched
    const reconAccReload2 = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: reconAccount.id },
    });
    assert(Number(reconAccReload2.currentBalance) === 50000, 'CRITICAL INVARIANT: Reconciliation check does NOT auto-mutate balance');

    // Test 5.3: Explicitly Resolve Discrepancy via Balancing Adjustment
    const resolveResult = await resolveReconciliationDiscrepancy({
      reconciliationId: discrepancyRecon.id,
      adminId: adminUser.discordId,
      reason: 'Confirmed unrecorded direct bank deposit',
    });

    assert(resolveResult.status === 'ADJUSTED', 'Reconciliation status transitioned to ADJUSTED');
    assert(Boolean(resolveResult.adjustmentTransactionId), 'Balancing adjustment transaction created and linked');

    // Verify account balance is now updated to align with actual verified balance
    const reconAccReload3 = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: reconAccount.id },
    });
    assert(Number(reconAccReload3.currentBalance) === 55000, 'Account balance aligned to actual verified statement balance');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 6: Financial Permissions & Role Tiers
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 6: Financial Permissions & RBAC Tiers ---');

    // Test 6.1: Owner / Super Admin Permissions
    const superAdminRole = resolveUserFinancialRole(['owner']);
    assert(superAdminRole === 'SUPER_ADMIN', 'Owner role resolves to SUPER_ADMIN tier');

    const adminRoleTier = resolveUserFinancialRole(['admin']);
    assert(adminRoleTier === 'FINANCIAL_ADMIN', 'Admin role resolves to FINANCIAL_ADMIN tier');

    const managerRoleTier = resolveUserFinancialRole(['manager']);
    assert(managerRoleTier === 'FINANCIAL_MANAGER', 'Manager role resolves to FINANCIAL_MANAGER tier');

    const viewerRoleTier = resolveUserFinancialRole(['staff']);
    assert(viewerRoleTier === 'FINANCIAL_VIEWER', 'Staff role resolves to FINANCIAL_VIEWER tier');

    // Test 6.2: Non-Admin Permissions
    const regularUserRole = resolveUserFinancialRole(['booster', 'customer']);
    assert(regularUserRole === null, 'Booster/customer role resolves to null financial tier');

    // Test 6.3: hasFinancialPermission helper
    assert(hasFinancialPermission(['owner'], 'FINANCIAL_VIEWER') === true, 'SUPER_ADMIN satisfies VIEWER');
    assert(hasFinancialPermission(['owner'], 'FINANCIAL_ADMIN') === true, 'SUPER_ADMIN satisfies ADMIN');
    assert(hasFinancialPermission(['admin'], 'FINANCIAL_ADMIN') === true, 'FINANCIAL_ADMIN satisfies ADMIN');
    assert(hasFinancialPermission(['staff'], 'FINANCIAL_ADMIN') === false, 'VIEWER cannot satisfy ADMIN');
    assert(hasFinancialPermission(['booster'], 'FINANCIAL_VIEWER') === false, 'Booster cannot satisfy VIEWER');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 7: CSV Exports Generation
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 7: CSV Exports Generation ---');

    const journalCsv = await generateJournalCsv({});
    assert(journalCsv.includes('Journal Ref,Transaction Type,Reference ID,Debit Account Ref'), 'Journal CSV contains correct header structure');
    assert(journalCsv.includes('JNL-'), 'Journal CSV contains recorded entries');

    const auditCsv = await generateAuditLogsCsv({});
    assert(auditCsv.includes('Audit Ref,Action Type,Admin Username,Admin ID'), 'Audit CSV contains correct header structure');
    assert(auditCsv.includes('AUD-'), 'Audit CSV contains recorded logs');

    // ─────────────────────────────────────────────────────────────────────────────
    // SCENARIO 8: REST API Security & Endpoint Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- SCENARIO 8: REST API Security & Endpoints ---');

    // Test 8.1: Unauthenticated request rejected with 401
    const unauthRes = await agent.get('/api/admin/financial-ledger/journal');
    assert(unauthRes.status === 401, 'Unauthenticated access to journal returns 401 Unauthorized');

    // Test 8.2: Regular user rejected with 403
    await agent.post('/test/session/login').send({ userId: regularUser.discordId });
    const forbiddenRes = await agent.get('/api/admin/financial-ledger/journal');
    assert(forbiddenRes.status === 403, 'Regular user without financial permissions receives 403 Forbidden');

    // Test 8.3: Admin user authenticated access
    await agent.post('/test/session/login').send({ userId: adminUser.discordId });

    // Role tier endpoint
    const roleTierRes = await agent.get('/api/admin/financial-ledger/role-tier');
    assert(roleTierRes.status === 200, 'GET /role-tier returns 200 OK for admin');
    assert(roleTierRes.body.financialTier === 'SUPER_ADMIN', 'GET /role-tier returns SUPER_ADMIN');

    // Trial balance endpoint
    const tbRes = await agent.get('/api/admin/financial-ledger/trial-balance?currency=USD');
    assert(tbRes.status === 200, 'GET /trial-balance returns 200 OK');
    assert(tbRes.body.trialBalance.isBalanced === true, 'GET /trial-balance returns isBalanced = true');

    // Journal listing endpoint
    const journalRes = await agent.get('/api/admin/financial-ledger/journal?limit=5');
    assert(journalRes.status === 200, 'GET /journal returns 200 OK');
    assert(Array.isArray(journalRes.body.entries), 'GET /journal returns entries array');

    // Audit logs listing endpoint
    const auditRes = await agent.get('/api/admin/financial-ledger/audit-logs?limit=5');
    assert(auditRes.status === 200, 'GET /audit-logs returns 200 OK');
    assert(Array.isArray(auditRes.body.logs), 'GET /audit-logs returns logs array');

    // Reconciliations listing endpoint
    const reconListRes = await agent.get('/api/admin/financial-ledger/reconciliations?limit=5');
    assert(reconListRes.status === 200, 'GET /reconciliations returns 200 OK');
    assert(Array.isArray(reconListRes.body.reconciliations), 'GET /reconciliations returns reconciliations array');

    // CSV export endpoint
    const exportRes = await agent.get('/api/admin/financial-ledger/export-csv?type=journal');
    assert(exportRes.status === 200, 'GET /export-csv returns 200 OK');
    assert(exportRes.headers['content-type'].includes('text/csv'), 'GET /export-csv sets text/csv Content-Type');

    console.log('\n================================================================');
    console.log(`🎉  ALL ${passedTests}/${totalTests} PHASE 4 FINANCIAL TESTS PASSED PERFECTLY!`);
    console.log('================================================================\n');
  } catch (error) {
    console.error('\n❌  PHASE 4 TEST SUITE ENCOUNTERED AN ERROR:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPhase4FinancialSuite();
