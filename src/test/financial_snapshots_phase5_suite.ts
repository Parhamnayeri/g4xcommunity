/**
 * src/test/financial_snapshots_phase5_suite.ts — Automated Test Suite for Phase 5:
 * Financial Snapshots, Advanced Analytics, Cash Flow vs. P&L, Financial Exports, and Automated Schedules.
 */

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import prisma from '../database/db';
import { router } from '../web/routes';
import {
  captureFinancialSnapshot,
  getFinancialSnapshotById,
  listFinancialSnapshots,
  compareHistoricalSnapshots,
  getAdvancedFinancialAnalytics,
  getProfitAndLossReport,
  getCashFlowReport,
  exportFinancialStatement,
  ensureDefaultReportSchedules,
  listAutomatedSchedules,
  updateAutomatedSchedule,
  executeReportSchedule,
  listGeneratedFinancialReports,
  getGeneratedReportFile,
} from '../services/financialSnapshotsAndAnalyticsService';
import {
  ensureDefaultFinancialAccounts,
  recordManualBalanceAdjustment,
} from '../services/financialAccountService';
import { executeInternalTransfer } from '../services/financialTransferAndWithdrawalService';

// Setup Mock Express App for Supertest
const app = express();
app.use(express.json());
app.use(
  session({
    secret: 'test-financial-phase5-secret',
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
  req.session.csrfToken = 'test-phase5-csrf-token';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

app.use('/api', router);

// Test Runner
let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function runPhase5TestSuite() {
  console.log('\n================================================================');
  console.log('🧪 G4X FINANCIAL MANAGEMENT SYSTEM — PHASE 5 TEST SUITE');
  console.log('================================================================\n');

  try {
    // ─── 0. SETUP TEST ENVIRONMENT & USERS ──────────────────────────────────────
    console.log('📋 Preparing Test Users and Accounts...');

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

    const adminUser = await prisma.user.upsert({
      where: { discordId: 'test_phase5_admin' },
      update: { username: 'Phase5Admin' },
      create: {
        discordId: 'test_phase5_admin',
        username: 'Phase5Admin',
        userRoles: { create: [{ roleKey: 'owner' }] },
      },
    });

    // Ensure admin role link exists
    await prisma.userRole.upsert({
      where: {
        userId_roleKey: {
          userId: adminUser.discordId,
          roleKey: 'owner',
        },
      },
      update: {},
      create: {
        userId: adminUser.discordId,
        roleKey: 'owner',
      },
    });

    const boosterUser = await prisma.user.upsert({
      where: { discordId: 'test_phase5_booster' },
      update: { username: 'Phase5Booster' },
      create: {
        discordId: 'test_phase5_booster',
        username: 'Phase5Booster',
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    const customerUser = await prisma.user.upsert({
      where: { discordId: 'test_phase5_customer' },
      update: { username: 'Phase5Customer' },
      create: { discordId: 'test_phase5_customer', username: 'Phase5Customer' },
    });

    await ensureDefaultFinancialAccounts();
    await ensureDefaultReportSchedules();

    const directAcc = await prisma.financialAccount.findUnique({ where: { accountRef: 'g4x_direct' } });
    const eldoradoAcc = await prisma.financialAccount.findUnique({ where: { accountRef: 'eldorado_main' } });
    const usdWallet = await prisma.financialAccount.findUnique({ where: { accountRef: 'wallet_usd_treasury' } });
    const pasargadAcc = await prisma.financialAccount.findUnique({ where: { accountRef: 'bank_mellat_corporate' } });

    assert(!!directAcc && !!eldoradoAcc && !!usdWallet && !!pasargadAcc, 'Default accounts exist for testing');

    // Create a mock game & service for test orders if not present
    await prisma.game.upsert({
      where: { slug: 'wow' },
      update: {},
      create: { slug: 'wow', displayName: 'World of Warcraft', serviceCategory: 'both' },
    });

    const testService = await prisma.gameService.upsert({
      where: { id: 99999 },
      update: {},
      create: {
        id: 99999,
        gameSlug: 'wow',
        serviceKey: 'mythic_dungeon_test',
        displayName: 'Mythic Dungeon Run',
        profileMode: 'none',
        description: 'Test Service',
      },
    });

    // ─── 1. MODULE 1: FINANCIAL SNAPSHOTS CREATION & IMMUTABILITY ──────────────
    console.log('\n📸 [Module 1] Financial Snapshots Creation & Immutability:');

    // Fund accounts
    await recordManualBalanceAdjustment({
      accountId: directAcc!.id,
      amount: 150000, // $1,500.00
      adjustmentType: 'CREDIT',
      reason: 'Phase 5 Direct Sales Inflow',
      adminId: adminUser.discordId,
    });

    await recordManualBalanceAdjustment({
      accountId: eldoradoAcc!.id,
      amount: 80000, // $800.00
      adjustmentType: 'CREDIT',
      reason: 'Phase 5 Eldorado Sales Inflow',
      adminId: adminUser.discordId,
    });

    const snap1 = await captureFinancialSnapshot({
      snapshotType: 'DAILY',
      notes: 'Test Daily Treasury Snapshot 1',
      adminId: adminUser.discordId,
    });

    assert(!!snap1 && !!snap1.snapshotRef, 'Successfully captured Snapshot 1 with authoritative reference');
    assert(snap1.snapshotType === 'DAILY', 'Snapshot 1 type matches DAILY');
    assert(snap1.g4xDirectBalance >= 150000, 'Captured G4X Direct balance reflects current balance');
    assert(snap1.eldoradoBalance >= 80000, 'Captured Eldorado balance reflects current balance');
    assert(snap1.totalUsdAssets > 0, 'Captured total USD assets is computed and positive');

    // Immutability Check: Now alter current account balance, verify historical snapshot is unchanged
    const originalTotalUsd = snap1.totalUsdAssets;
    await recordManualBalanceAdjustment({
      accountId: directAcc!.id,
      amount: 50000, // +$500.00
      adjustmentType: 'CREDIT',
      reason: 'Post-Snapshot Balance Change',
      adminId: adminUser.discordId,
    });

    const retrievedSnap1 = await getFinancialSnapshotById(snap1.id);
    assert(retrievedSnap1?.totalUsdAssets === originalTotalUsd, 'Invariant: Historical snapshot values remain immutable after balance movements');

    // ─── 2. MODULE 2: HISTORICAL OVERVIEW & SNAPSHOT COMPARISON ────────────────
    console.log('\n⚖️ [Module 2] Historical Overview & Snapshot Comparison:');

    const snap2 = await captureFinancialSnapshot({
      snapshotType: 'DAILY',
      notes: 'Test Daily Treasury Snapshot 2 (Higher Assets)',
      adminId: adminUser.discordId,
    });

    assert(snap2.totalUsdAssets > snap1.totalUsdAssets, 'Snapshot 2 has higher total assets than Snapshot 1');

    const listRes = await listFinancialSnapshots({ snapshotType: 'DAILY' });
    assert(listRes.snapshots.length >= 2, 'Listed snapshots filtering by DAILY returns at least 2 entries');

    const comparison = await compareHistoricalSnapshots(snap1.id, snap2.id);
    assert(comparison.deltas.totalUsdAssets === snap2.totalUsdAssets - snap1.totalUsdAssets, 'Comparison accurately computes totalUsdAssets delta');
    assert(comparison.deltas.totalUsdAssetsGrowthPct !== null && comparison.deltas.totalUsdAssetsGrowthPct > 0, 'Comparison calculates positive asset growth percentage');
    assert(comparison.deltas.platformBalances.direct === 50000, 'Comparison platform balance movement for direct matches exactly +$500.00 (50000 cents)');

    // ─── 3. MODULE 3: ADVANCED FINANCIAL ANALYTICS ────────────────────────────
    console.log('\n📊 [Module 3] Advanced Financial Analytics Engine:');

    // Create test completed orders for analytics
    await prisma.order.create({
      data: {
        orderRef: `TEST-ORD-P5-1-${Date.now()}`,
        gameSlug: 'wow',
        serviceId: testService.id,
        customerId: customerUser.discordId,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000, // $100.00
        platformFeeMinor: 1000,  // $10.00
        boosterPoolMinor: 7000,  // $70.00
        advertiserFeeMinor: 0,
        sourceWebsite: 'eldorado',
        creatorType: 'g4x',
        status: 'completed',
        completedAt: new Date(),
      },
    });

    await prisma.order.create({
      data: {
        orderRef: `TEST-ADV-P5-2-${Date.now()}`,
        gameSlug: 'wow',
        serviceId: testService.id,
        customerId: customerUser.discordId,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 15000, // $150.00
        platformFeeMinor: 1500,  // $15.00
        boosterPoolMinor: 9000,  // $90.00
        advertiserFeeMinor: 2000,// $20.00 advertiser commission
        sourceWebsite: 'direct',
        creatorType: 'advertiser',
        advertiserId: customerUser.discordId,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    const analytics = await getAdvancedFinancialAnalytics({ periodType: 'MONTHLY' });
    assert(analytics.revenueTrends.length > 0, 'Revenue trends generated daily trend points');
    assert(analytics.netProfitTrends.length > 0, 'Net profit trends calculated with margins');
    assert(analytics.platformPerformanceRanking.length > 0, 'Platform performance ranking computed');
    assert(analytics.platformPerformanceRanking[0].rank === 1, 'Top platform assigned rank 1');

    assert(analytics.advertiserBoostsProfitability.totalOrders >= 1, 'Advertiser boosts profitability tracked orders');
    assert(analytics.advertiserBoostsProfitability.grossRevenueMinor >= 15000, 'Advertiser boosts revenue captures advertiser order');
    assert(analytics.advertiserBoostsProfitability.netProfitMinor > 0, 'Advertiser boosts net profit is positive');

    assert(analytics.platformBalanceDistribution.length > 0, 'Platform balance distribution contains active accounts');
    const totalDistPct = analytics.platformBalanceDistribution.reduce((sum, a) => sum + a.percentageOfTotalUsd, 0);
    assert(totalDistPct >= 99 && totalDistPct <= 101, 'Platform balance distribution percentages sum to ~100%');

    // ─── 4. MODULE 4: SEPARATE CASH FLOW VS. PROFIT & LOSS ────────────────────
    console.log('\n📑 [Module 4] Strict Separation: Cash Flow vs. Profit & Loss:');

    const pnl = await getProfitAndLossReport({ periodType: 'MONTHLY' });
    assert(pnl.grossRevenueMinor >= 25000, 'P&L accrual gross revenue accounts for completed orders');
    assert(pnl.platformFeesMinor >= 2500, 'P&L tracks marketplace platform fees');
    assert(pnl.boosterCostsMinor >= 16000, 'P&L tracks booster delivery costs');
    assert(pnl.netOperatingProfitMinor === pnl.grossRevenueMinor - pnl.totalExpensesMinor, 'P&L net operating profit equals gross minus total expenses');
    // Fund usdWallet before transfer
    await recordManualBalanceAdjustment({
      accountId: usdWallet!.id,
      amount: 10000, // $100.00
      adjustmentType: 'CREDIT',
      reason: 'Phase 5 Fund USD Wallet for conversion test',
      adminId: adminUser.discordId,
    });

    // Execute an internal transfer (USD Wallet -> Pasargad bank account with conversion)
    await executeInternalTransfer({
      sourceAccountId: usdWallet!.id,
      destinationAccountId: pasargadAcc!.id,
      sourceAmount: 2000, // $20.00
      exchangeRate: 90000,
      feeAmount: 0,
      description: 'Phase 5 Non-Revenue Internal Liquidity Conversion',
      adminId: adminUser.discordId,
    });

    const cashFlow = await getCashFlowReport({ periodType: 'MONTHLY' });
    assert(cashFlow.accountingRulesVerified.transfersExcludedFromRevenueAndExpenses === true, 'Accounting Invariant: Transfers strictly excluded from revenue & expenses');
    assert(cashFlow.accountingRulesVerified.withdrawalsExcludedFromSalesRevenue === true, 'Accounting Invariant: Withdrawals strictly excluded from sales revenue');
    assert(cashFlow.currencyConversionsCount >= 1, 'Cash flow tracks currency conversion operations separately');
    assert(cashFlow.netCashFlowMinor !== undefined, 'Net liquid cash flow computed cleanly');

    // ─── 5. MODULE 5: FINANCIAL EXPORT ENGINE (CSV, XLSX, PDF/HTML, JSON) ─────
    console.log('\n💾 [Module 5] Financial Export Engine:');

    // CSV Export
    const csvExport = await exportFinancialStatement({
      reportType: 'P_AND_L',
      format: 'CSV',
      periodType: 'MONTHLY',
    });
    assert(csvExport.contentType.includes('text/csv'), 'CSV export returns text/csv content type');
    assert(csvExport.content.includes('Gross Business Revenue'), 'CSV export contains line item headers');

    // XLSX Export
    const xlsxExport = await exportFinancialStatement({
      reportType: 'CASH_FLOW',
      format: 'XLSX',
      periodType: 'MONTHLY',
    });
    assert(xlsxExport.contentType.includes('spreadsheetml'), 'XLSX export returns proper XML spreadsheet MIME type');
    assert(xlsxExport.content.includes('urn:schemas-microsoft-com:office:spreadsheet'), 'XLSX export conforms to XML Spreadsheet 2003 standard');

    // PDF/HTML Export
    const pdfExport = await exportFinancialStatement({
      reportType: 'PLATFORM',
      format: 'PDF',
      periodType: 'MONTHLY',
    });
    assert(pdfExport.contentType.includes('text/html'), 'PDF export returns printable HTML document with print CSS');
    assert(pdfExport.content.includes('@media print'), 'PDF export contains professional @media print styling');

    // JSON Export
    const jsonExport = await exportFinancialStatement({
      reportType: 'P_AND_L',
      format: 'JSON',
      periodType: 'MONTHLY',
    });
    const parsedJson = JSON.parse(jsonExport.content);
    assert(parsedJson.reportType === 'P_AND_L' && Array.isArray(parsedJson.records), 'JSON export parses with reportType and records array');

    // ─── 6. MODULE 6: AUTOMATED REPORTING & SCHEDULES ─────────────────────────
    console.log('\n⏰ [Module 6] Automated Reporting Schedules & Archives:');

    const schedules = await listAutomatedSchedules();
    assert(schedules.length >= 3, 'Default schedules (Daily, Weekly, Monthly) initialized automatically');

    const dailySched = schedules.find((s: any) => s.frequency === 'DAILY') || schedules[0];
    const toggled = await updateAutomatedSchedule(dailySched.id, { isEnabled: false });
    assert(toggled.isEnabled === false, 'Automated schedule can be toggled off');

    const reToggled = await updateAutomatedSchedule(dailySched.id, { isEnabled: true });
    assert(reToggled.isEnabled === true, 'Automated schedule can be re-enabled');

    // Run schedule on-demand
    const genReport = await executeReportSchedule(dailySched.id, adminUser.discordId);
    assert(!!genReport && !!genReport.reportRef, 'Automated schedule execution generates authoritative report record');
    assert(genReport.fileSizeBytes > 0, 'Generated report has non-zero file size');

    const reportList = await listGeneratedFinancialReports();
    assert(reportList.some((r: any) => r.id === genReport.id), 'Generated report is listed in historical report archive');

    const downloadData = await getGeneratedReportFile(genReport.id);
    assert(!!downloadData && downloadData.content.length > 0, 'Generated report download content retrieved successfully');

    // ─── 7. MODULE 7: API ROUTE & RBAC INTEGRATION TESTS ──────────────────────
    console.log('\n🛡️ [Module 7] API Routes & RBAC Security Verification:');

    const agent = request.agent(app);

    // 7.1 Unauthenticated requests return 401
    const unauthSnap = await agent.get('/api/admin/financial-analytics/snapshots');
    assert(unauthSnap.status === 401, 'Unauthenticated GET /snapshots returns 401 Unauthorized');

    const unauthPnl = await agent.get('/api/admin/financial-analytics/p-and-l');
    assert(unauthPnl.status === 401, 'Unauthenticated GET /p-and-l returns 401 Unauthorized');

    // 7.2 Non-admin (booster) returns 403 Forbidden
    await agent.post('/test/session/login').send({ userId: boosterUser.discordId });
    const boosterSnap = await agent.get('/api/admin/financial-analytics/snapshots');
    assert(boosterSnap.status === 403, 'Booster GET /snapshots returns 403 Forbidden');

    const boosterExport = await agent.get('/api/admin/financial-analytics/export?reportType=P_AND_L&format=CSV');
    assert(boosterExport.status === 403, 'Booster GET /export returns 403 Forbidden');

    // 7.3 Admin returns 200 OK
    await agent.post('/test/session/login').send({ userId: adminUser.discordId });

    const adminSnap = await agent.get('/api/admin/financial-analytics/snapshots');
    assert(adminSnap.status === 200 && adminSnap.body.success === true, 'Admin GET /snapshots returns 200 OK with list');

    const adminCapture = await agent
      .post('/api/admin/financial-analytics/snapshots/capture')
      .send({ snapshotType: 'MANUAL', notes: 'API integration test capture' });
    assert(adminCapture.status === 200 && adminCapture.body.success === true, 'Admin POST /snapshots/capture returns 200 OK with snapshot');

    const adminAnalytics = await agent.get('/api/admin/financial-analytics/advanced?periodType=MONTHLY');
    assert(adminAnalytics.status === 200 && adminAnalytics.body.success === true, 'Admin GET /advanced returns 200 OK with analytics metrics');

    const adminPnl = await agent.get('/api/admin/financial-analytics/p-and-l?periodType=MONTHLY');
    assert(adminPnl.status === 200 && adminPnl.body.report.grossRevenueMinor > 0, 'Admin GET /p-and-l returns 200 OK with P&L statement');

    const adminCashFlow = await agent.get('/api/admin/financial-analytics/cash-flow?periodType=MONTHLY');
    assert(adminCashFlow.status === 200 && adminCashFlow.body.report.accountingRulesVerified.transfersExcludedFromRevenueAndExpenses === true, 'Admin GET /cash-flow returns 200 OK with verified accounting invariants');

    const adminExport = await agent.get('/api/admin/financial-analytics/export?reportType=P_AND_L&format=CSV&periodType=MONTHLY');
    assert(adminExport.status === 200 && adminExport.headers['content-type'].includes('text/csv'), 'Admin GET /export returns 200 OK with CSV file download');

    const adminSchedules = await agent.get('/api/admin/financial-analytics/schedules');
    assert(adminSchedules.status === 200 && Array.isArray(adminSchedules.body.schedules), 'Admin GET /schedules returns 200 OK with schedules array');

    const adminRunSched = await agent.post(`/api/admin/financial-analytics/schedules/${dailySched.id}/run`).send({});
    assert(adminRunSched.status === 200 && adminRunSched.body.success === true, 'Admin POST /schedules/:id/run returns 200 OK with generated report');

    const adminReports = await agent.get('/api/admin/financial-analytics/reports');
    assert(adminReports.status === 200 && adminReports.body.reports.length > 0, 'Admin GET /reports returns 200 OK with generated reports list');

    const adminDownload = await agent.get(`/api/admin/financial-analytics/reports/${genReport.id}/download`);
    assert(adminDownload.status === 200 && adminDownload.headers['content-disposition'].includes('attachment'), 'Admin GET /reports/:id/download returns 200 OK attachment');

    // ─── SUMMARY ─────────────────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err: any) {
    console.error('\n❌ Uncaught error during Phase 5 test execution:', err);
    process.exit(1);
  }
}

runPhase5TestSuite();
