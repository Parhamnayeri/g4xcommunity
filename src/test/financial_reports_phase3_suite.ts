/**
 * src/test/financial_reports_phase3_suite.ts — Automated Test Suite for Phase 3 Financial Reports & Advertiser Boosts
 *
 * Test Scenarios:
 *  1. Date Range & Period Math (Daily, Weekly, Monthly, Quarterly, Yearly, All Time, Custom, and Previous Period Determination)
 *  2. Metric Growth Percentage Calculations (Positive delta, Negative delta, Zero baseline handling)
 *  3. Specific Platform Report Calculation (13 Canonical Indicators: Gross, Fees, Net, Booster Costs, Profit, Orders)
 *  4. Dedicated Advertiser Boosts Report (Advertiser Orders, Booster Payouts, Net Advertiser Profit, Origin Breakdown)
 *  5. CRITICAL INVARIANT: Non-Duplicative Consolidated Accounting (An advertiser order originating on Eldorado appears in Eldorado report AND Advertiser Boosts report, but is counted EXACTLY ONCE in Consolidated All Platforms report)
 *  6. Reporting Orders List Query & Pagination (Search, Status Filter, Platform Filter, Pagination metadata)
 *  7. Financial Reports CSV Export (Headers, Data row formatting, Character encoding)
 *  8. REST API Security & Role-Based Access Control (401 Unauthenticated, 403 Regular User, 200 Admin Access)
 */

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import prisma from '../database/db';
import { router } from '../web/routes';
import {
  calculateDateRanges,
  computePercentageChange,
  getPlatformFinancialReport,
  getAdvertiserBoostsFinancialReport,
  getConsolidatedFinancialReport,
  listReportOrders,
  generateOrdersReportCsv,
  DateRangeCalculation,
  ReportPeriodType,
} from '../services/financialReportingService';
import { ensureDefaultFinancialAccounts } from '../services/financialAccountService';

// Setup Mock Express App for Supertest
const app = express();
app.use(express.json());
app.use(
  session({
    secret: 'test-financial-phase3-secret',
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
  req.session.csrfToken = 'test-phase3-csrf-token';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

app.use('/api', router);

async function runPhase3FinancialSuite() {
  console.log('================================================================');
  console.log('📊  RUNNING PHASE 3 — FINANCIAL REPORTS & ADVERTISER BOOSTS SUITE');
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

  const testId = `rep_p3_${Date.now().toString(36)}`;
  const adminDiscordId = `admin_${testId}`;
  const regularUserDiscordId = `user_${testId}`;
  const advertiserDiscordId = `adv_partner_${testId}`;

  try {
    // 0. Setup Default Accounts & Test Users
    await ensureDefaultFinancialAccounts();

    await prisma.role.upsert({
      where: { roleKey: 'admin' },
      update: {},
      create: { roleKey: 'admin', name: 'Admin' },
    });
    await prisma.role.upsert({
      where: { roleKey: 'booster' },
      update: {},
      create: { roleKey: 'booster', name: 'Booster' },
    });

    await prisma.user.create({
      data: {
        discordId: adminDiscordId,
        username: `AdminReporter_${testId}`,
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

    await prisma.user.create({
      data: {
        discordId: advertiserDiscordId,
        username: `AdvertiserUser_${testId}`,
        userRoles: {
          create: [{ roleKey: 'booster' }],
        },
      },
    });

    // Ensure a Game & GameService exist for testing
    let game = await prisma.game.findFirst();
    if (!game) {
      game = await prisma.game.create({
        data: {
          slug: 'test_wow',
          displayName: 'Test World of Warcraft',
          serviceCategory: 'both',
        },
      });
    }

    let service = await prisma.gameService.findFirst({
      where: { gameSlug: game.slug },
    });
    if (!service) {
      service = await prisma.gameService.create({
        data: {
          gameSlug: game.slug,
          serviceKey: 'mythic_plus',
          displayName: 'Mythic Plus Dungeons',
          profileMode: 'manual',
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. DATE RANGE & COMPARISON CALCULATION TESTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('▶ SCENARIO 1: Date Range & Period Calculations');

    const monthlyRange = calculateDateRanges('MONTHLY');
    assert(
      monthlyRange.startDate < monthlyRange.endDate,
      'Monthly range start date is before end date'
    );
    assert(
      monthlyRange.previousStartDate !== null &&
        monthlyRange.previousEndDate !== null &&
        monthlyRange.previousStartDate < monthlyRange.previousEndDate,
      'Previous period start date is before previous end date'
    );
    assert(
      monthlyRange.previousEndDate !== null &&
        monthlyRange.previousEndDate.getTime() === monthlyRange.startDate.getTime() - 1,
      'Previous period end date aligns seamlessly with current period start date'
    );

    const customRange = calculateDateRanges('CUSTOM', '2026-05-01', '2026-05-31');
    assert(
      customRange.startDate.toISOString().startsWith('2026-05-01'),
      'Custom range parses start date correctly'
    );
    assert(
      customRange.endDate.toISOString().startsWith('2026-05-31'),
      'Custom range parses end date correctly'
    );

    const allTimeRange = calculateDateRanges('ALL_TIME');
    assert(
      allTimeRange.startDate.getTime() === 0,
      'All Time range spans back to origin date baseline'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 2. METRIC GROWTH PERCENTAGE TESTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 2: Metric Growth Delta Calculations');

    const growthUp = computePercentageChange(1500, 1000);
    assert(
      growthUp.changePercentage === 50 && growthUp.trend === 'up',
      'Positive growth computes exact +50% with up trend'
    );

    const growthDown = computePercentageChange(800, 1000);
    assert(
      growthDown.changePercentage === -20 && growthDown.trend === 'down',
      'Negative growth computes exact -20% with down trend'
    );

    const growthZeroBaseline = computePercentageChange(500, 0);
    assert(
      growthZeroBaseline.changePercentage === 100.0 && growthZeroBaseline.trend === 'up',
      'Zero previous baseline returns +100% growth'
    );

    const growthNullBaseline = computePercentageChange(500, null);
    assert(
      growthNullBaseline.changePercentage === null && growthNullBaseline.trend === 'neutral',
      'Null previous baseline gracefully returns null change with neutral trend'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 3. SEED TEST ORDERS FOR REPORTING
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 3: Seeding Order Dataset for Financial Reporting');

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    // Order 1: Regular G4X Direct Order
    // Gross: $100.00 (10000 cents), Fee: $0, Booster Cost: $70.00 (7000 cents), Net Profit: $30.00
    const orderDirect = await prisma.order.create({
      data: {
        orderRef: `G4X-DIR-${testId}`,
        gameSlug: game.slug,
        serviceId: service.id,
        sourceWebsite: 'direct',
        status: 'confirmed',
        paymentStatus: 'verified',
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 10000,
        platformFeeMinor: 0,
        boosterPoolMinor: 7000,
        completedAt: oneHourAgo,
        createdAt: oneHourAgo,
      },
    });

    // Order 2: Normal Eldorado Order
    // Gross: $200.00 (20000 cents), Platform Fee: $20.00 (2000 cents), Booster Cost: $120.00 (12000 cents), Net Profit: $60.00
    const orderEldoradoNormal = await prisma.order.create({
      data: {
        orderRef: `G4X-ELD-${testId}`,
        gameSlug: game.slug,
        serviceId: service.id,
        sourceWebsite: 'eldorado',
        status: 'completed',
        paymentStatus: 'verified',
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 20000,
        platformFeeMinor: 2000,
        boosterPoolMinor: 12000,
        completedAt: oneHourAgo,
        createdAt: oneHourAgo,
      },
    });

    // Order 3: ADVERTISER BOOST Originating on Eldorado!
    // Gross: $300.00 (30000 cents), Platform Fee: $30.00 (3000 cents), Advertiser Cost: $250.00, Booster Cost: $180.00 (18000 cents)
    const orderEldoradoAdvertiser = await prisma.order.create({
      data: {
        orderRef: `G4X-ADV-${testId}`,
        gameSlug: game.slug,
        serviceId: service.id,
        sourceWebsite: 'eldorado',
        creatorType: 'advertiser',
        advertiserId: `adv_partner_${testId}`,
        status: 'completed',
        paymentStatus: 'verified',
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 30000,
        platformFeeMinor: 3000,
        advertiserFeeMinor: 2000,
        boosterPoolMinor: 18000,
        completedAt: oneHourAgo,
        createdAt: oneHourAgo,
        advertiserMetadata: {
          create: {
            advertiserOrderId: `EXT-ADV-${testId}-99`,
            additionalCostsMinor: 0,
            notes: 'Test advertiser metadata',
          },
        },
      },
    });

    // Order 4: Active In-Progress Skycoach Order (not completed)
    // Gross: $150.00 (15000 cents)
    const orderSkycoachActive = await prisma.order.create({
      data: {
        orderRef: `G4X-SKY-${testId}`,
        gameSlug: game.slug,
        serviceId: service.id,
        sourceWebsite: 'skycoach',
        status: 'in_progress',
        paymentStatus: 'verified',
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 15000,
        platformFeeMinor: 1500,
        boosterPoolMinor: 9000,
        createdAt: oneHourAgo,
      },
    });

    assert(
      orderDirect.id > 0 &&
        orderEldoradoNormal.id > 0 &&
        orderEldoradoAdvertiser.id > 0 &&
        orderSkycoachActive.id > 0,
      'Test order dataset seeded successfully with Direct, Eldorado, Advertiser Boost & Active orders'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 4. PLATFORM FINANCIAL REPORT METRICS VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 4: Platform Metrics Verification');

    const testRange: DateRangeCalculation = {
      startDate: new Date(now.getTime() - 86400000), // last 24h
      endDate: new Date(now.getTime() + 86400000),
      periodLabel: 'Test 24h',
      previousStartDate: new Date(now.getTime() - 172800000),
      previousEndDate: new Date(now.getTime() - 86400000),
      previousPeriodLabel: 'Previous 24h',
      periodType: 'CUSTOM' as ReportPeriodType,
    };

    // Check Eldorado Platform Report
    const eldoradoReport = await getPlatformFinancialReport('eldorado', testRange);

    // Eldorado has orderEldoradoNormal ($200) + orderEldoradoAdvertiser ($300) = $500 gross
    assert(
      eldoradoReport.completedOrders.count >= 2,
      'Eldorado report counts completed normal and advertiser orders'
    );
    assert(
      eldoradoReport.grossRevenue.valueMinor >= 50000,
      'Eldorado report contains both normal and advertiser gross revenue ($500.00+)'
    );
    assert(
      eldoradoReport.platformFees.valueMinor >= 5000,
      'Eldorado report accurately tallies platform fees ($50.00+)'
    );
    assert(
      eldoradoReport.boosterCosts.valueMinor >= 30000,
      'Eldorado report accurately tallies booster costs ($300.00+)'
    );

    // Check G4X Direct Report
    const directReport = await getPlatformFinancialReport('direct', testRange);
    assert(
      directReport.grossRevenue.valueMinor >= 10000,
      'Direct report contains direct order gross revenue ($100.00+)'
    );

    // Check Skycoach Report (Active Order)
    const skycoachReport = await getPlatformFinancialReport('skycoach', testRange);
    assert(
      skycoachReport.activeOrders.count >= 1,
      'Skycoach report accurately detects active in-progress order'
    );
    assert(
      skycoachReport.pendingOrderValueMinor >= 15000,
      'Skycoach report records pending order value ($150.00+)'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 5. DEDICATED ADVERTISER BOOSTS REPORT VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 5: Dedicated Advertiser Boosts Report');

    const advertiserReport = await getAdvertiserBoostsFinancialReport(testRange);

    assert(
      advertiserReport.completedAdvertiserOrders.count >= 1,
      'Advertiser report tracks completed advertiser orders'
    );
    assert(
      advertiserReport.grossAdvertiserRevenue.valueMinor >= 30000,
      'Advertiser report gross revenue includes the advertiser order ($300.00+)'
    );
    assert(
      advertiserReport.boosterPayouts.valueMinor >= 18000,
      'Advertiser report booster payouts match booster cost ($180.00+)'
    );

    const originEldorado = advertiserReport.originPlatformBreakdown.find(
      (o) => o.platformKey === 'eldorado'
    );
    assert(
      originEldorado !== undefined && originEldorado.ordersCount >= 1,
      'Advertiser origin breakdown accurately links the advertiser order to Eldorado'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CRITICAL INVARIANT: NON-DUPLICATIVE CONSOLIDATED MATH
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 6: CRITICAL INVARIANT — Zero Double Counting in Consolidated Report');

    const consolidated = await getConsolidatedFinancialReport('ALL_TIME');

    // In All Platforms:
    // The advertiser order originating on Eldorado is in Eldorado's report AND Advertiser Boosts report.
    // In Consolidated, it must be summed ONCE and only once.
    // Let's verify sum of completed orders matches the exact count of unique orders in db.
    const allCompletedOrders = await prisma.order.findMany({
      where: {
        status: { in: ['completed', 'confirmed', 'warranty', 'closed', 'resolved'] },
      },
    });

    const expectedTotalGrossMinor = allCompletedOrders.reduce(
      (acc, o) => acc + (o.grossAmountMinor || 0),
      0
    );

    assert(
      consolidated.summary.grossRevenue.valueMinor === expectedTotalGrossMinor,
      `Consolidated gross revenue ($${(consolidated.summary.grossRevenue.valueMinor / 100).toFixed(2)}) matches exact distinct orders sum ($${(expectedTotalGrossMinor / 100).toFixed(2)}) without duplication`
    );

    assert(
      consolidated.summary.completedOrders.count === allCompletedOrders.length,
      `Consolidated completed order count (${consolidated.summary.completedOrders.count}) equals exact distinct orders count (${allCompletedOrders.length})`
    );

    // Verify platform breakdown percentages sum to ~100%
    const breakdown = consolidated.charts.platformRevenueBreakdown;
    const totalShare = breakdown.reduce((acc, p) => acc + p.revenueSharePercentage, 0);
    assert(
      Math.abs(totalShare - 100) < 1.0,
      `Platform revenue shares sum to 100% (Actual: ${totalShare.toFixed(1)}%)`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 7. DETAILED ORDERS LIST & CSV EXPORT
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 7: Reporting Orders List & CSV Export');

    // Query orders list
    const ordersList = await listReportOrders({
      search: testId,
      limit: 10,
    });
    assert(
      ordersList.orders.length >= 3,
      'Orders list search finds orders created in test suite'
    );

    const advOrderInList = ordersList.orders.find((o) => o.orderRef === `G4X-ADV-${testId}`);
    assert(
      advOrderInList !== undefined && advOrderInList.isAdvertiserBoost === true,
      'Advertiser order in list is correctly flagged with isAdvertiserBoost: true'
    );

    // Generate CSV
    const csvData = await generateOrdersReportCsv({
      platform: 'eldorado',
    });
    assert(
      csvData.includes('Order Ref,External / Advertiser Order ID,Platform,Category,Game'),
      'CSV export contains correct standardized column headers'
    );
    assert(
      csvData.includes(`G4X-ELD-${testId}`),
      'CSV export includes the Eldorado normal order'
    );
    assert(
      csvData.includes(`G4X-ADV-${testId}`),
      'CSV export includes the Eldorado advertiser order'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 8. REST API SECURITY & RBAC VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n▶ SCENARIO 8: REST API Security & Role-Based Access Control');

    // 1. Unauthenticated -> 401
    const unauthRes = await request(app).get('/api/admin/financial-reports/consolidated');
    assert(
      unauthRes.status === 401,
      'Unauthenticated request to consolidated report is rejected with 401'
    );

    // 2. Regular user (non-admin) -> 403
    const userSession = request.agent(app);
    await userSession.post('/test/session/login').send({ userId: regularUserDiscordId });
    const forbiddenRes = await userSession.get('/api/admin/financial-reports/consolidated');
    assert(
      forbiddenRes.status === 403,
      'Regular user (non-admin) is blocked from financial reports with 403'
    );

    // 3. Admin user -> 200 Consolidated
    const adminSession = request.agent(app);
    await adminSession.post('/test/session/login').send({ userId: adminDiscordId });
    const adminConsolidatedRes = await adminSession.get('/api/admin/financial-reports/consolidated');
    assert(
      adminConsolidatedRes.status === 200 && adminConsolidatedRes.body.success === true,
      'Admin user successfully retrieves consolidated financial report'
    );
    assert(
      adminConsolidatedRes.body.summary.grossRevenue.formatted.startsWith('$'),
      'Report summary contains formatted monetary fields'
    );

    // 4. Admin user -> 200 Platform Report (Eldorado)
    const adminPlatRes = await adminSession.get('/api/admin/financial-reports/platform/eldorado');
    assert(
      adminPlatRes.status === 200 && adminPlatRes.body.platformKey === 'eldorado',
      'Admin user successfully retrieves platform-specific report for Eldorado'
    );

    // 5. Admin user -> 200 Advertiser Boosts Report
    const adminAdvRes = await adminSession.get('/api/admin/financial-reports/advertiser-boosts');
    assert(
      adminAdvRes.status === 200 && adminAdvRes.body.summary.grossAdvertiserRevenue !== undefined,
      'Admin user successfully retrieves dedicated Advertiser Boosts report'
    );

    // 6. Admin user -> 200 Orders List
    const adminOrdersRes = await adminSession.get('/api/admin/financial-reports/orders?limit=5');
    assert(
      adminOrdersRes.status === 200 && Array.isArray(adminOrdersRes.body.orders),
      'Admin user successfully queries reporting orders list'
    );

    // 7. Admin user -> 200 CSV Export
    const adminCsvRes = await adminSession.get('/api/admin/financial-reports/export-csv');
    assert(
      adminCsvRes.status === 200 && adminCsvRes.header['content-type'].includes('text/csv'),
      'Admin user successfully downloads financial reports CSV export'
    );

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 3 TESTS PASSED PERFECTLY!`);
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute test suite when run directly
runPhase3FinancialSuite().catch((e) => {
  console.error(e);
  process.exit(1);
});
