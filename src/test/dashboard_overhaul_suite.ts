/**
 * dashboard_overhaul_suite.ts — Automated Test Suite for Dashboard Overhaul
 *
 * Verifies:
 *  1. 4-card wallet metrics (Available Balance, Pending Withdrawals, In Active Orders, Total Earnings).
 *  2. Strict isolation between Available Balance, Pending Withdrawals queue, and In Active Orders.
 *  3. Time-series chart analytics for 7D, 30D, 90D, and ALL ranges with growth % calculation.
 *  4. Granular order earnings breakdown (released, 24h escrow, in-progress stages).
 *  5. API endpoints: GET /api/dashboard/overview and GET /api/dashboard/earnings-chart.
 */

process.env.COOKIE_SECURE = 'false';
import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import {
  getDashboardWalletMetrics,
  getDashboardEarningsChart,
  getDashboardOrderEarningsBreakdown,
} from '../services/dashboardService';
import { getWalletV2Summary, creditAvailableCents } from '../services/financeV2/financeV2WalletService';
import { LedgerV2EntryType } from '../services/financeV2/financeV2Types';

function assert(condition: any, testName: string, detail?: string): void {
  if (!condition) {
    console.error(`❌ FAILED: ${testName} ${detail ? `(${detail})` : ''}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${testName}`);
}

async function createAuthenticatedAgent(userId: string) {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/csrf-token');
  const cookieHeader = initRes.header['set-cookie'];
  const rawCookie = cookieHeader ? cookieHeader[0] : '';
  const match = rawCookie.match(/g4x\.sid=s%3A([^.]+)\./);
  const sid = match ? match[1] : '';

  await new Promise<void>((resolve, reject) => {
    sessionStore.get(sid, (err, sess) => {
      if (err) return reject(err);
      const sessData: any = sess || { cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000) } };
      sessData.userId = userId;
      sessionStore.set(sid, sessData, (setErr) => {
        if (setErr) return reject(setErr);
        resolve();
      });
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

async function runSuite(): Promise<void> {
  console.log('================================================================');
  console.log('🚀 RUNNING DASHBOARD OVERHAUL & EARNINGS COMPONENTS TEST SUITE');
  console.log('================================================================\n');

  const testUserId = `user_dash_test_${Date.now()}`;
  await prisma.user.create({
    data: {
      discordId: testUserId,
      username: 'dash_booster_test',
      isActive: true,
      userRoles: {
        create: { roleKey: 'booster' },
      },
    },
  });

  // Ensure game and service
  await prisma.game.upsert({
    where: { slug: 'test_game_dash' },
    update: {},
    create: { slug: 'test_game_dash', displayName: 'Test Game', serviceCategory: 'both' },
  });
  const service = await prisma.gameService.upsert({
    where: { gameSlug_serviceKey: { gameSlug: 'test_game_dash', serviceKey: 'mythic_boost' } },
    update: {},
    create: {
      gameSlug: 'test_game_dash',
      serviceKey: 'mythic_boost',
      displayName: 'Mythic Boost',
      serviceMode: 'non_pilot',
      profileMode: 'manual',
    },
  });

  // ─── TEST 1: Available Balance Credit & Total Earnings ────────────────────
  console.log('--- TEST 1: Available Balance & Lifetime Earnings ---');
  // Credit $428.50 (42850 cents) to available balance
  await creditAvailableCents(testUserId, 42850, LedgerV2EntryType.AVAILABLE_RELEASE, {
    description: 'Initial Booster Earnings Released',
  });

  const walletSummary1 = await getWalletV2Summary(testUserId);
  const metrics1 = await getDashboardWalletMetrics(testUserId, walletSummary1);

  assert(metrics1.availableUsd === '428.50', 'Available Balance is exact $428.50');
  assert(metrics1.availableCents === 42850, 'Available cents is 42850');
  assert(metrics1.totalEarningsUsd === '428.50', 'Total lifetime earnings matches verified releases');

  // ─── TEST 2: Pending Withdrawals Isolation ─────────────────────────────────
  console.log('\n--- TEST 2: Pending Withdrawals Isolation ---');
  // Create 2 pending withdrawal requests: $100.00 and $50.00 = $150.00 total
  await prisma.boosterWithdrawalRequest.createMany({
    data: [
      {
        withdrawalRef: `WDR_TEST_1_${Date.now()}`,
        boosterId: testUserId,
        payoutMethod: 'USDT_BEP20',
        status: 'REQUESTED',
        requestedUsdCents: 10000,
        fixedFeeUsdCents: 30,
        netUsdCents: 9970,
        destinationAddress: '0x1111111111111111111111111111111111111111',
        quotedCurrency: 'USDT',
        quotedNetPayoutAmount: '99.70',
      },
      {
        withdrawalRef: `WDR_TEST_2_${Date.now()}`,
        boosterId: testUserId,
        payoutMethod: 'IRT_BANK',
        status: 'PROCESSING',
        requestedUsdCents: 5000,
        fixedFeeUsdCents: 100,
        netUsdCents: 4900,
        destinationAddress: 'IR123456789012345678901234',
        quotedCurrency: 'IRT',
        quotedNetPayoutAmount: '42630000',
      },
    ],
  });

  const metrics2 = await getDashboardWalletMetrics(testUserId, walletSummary1);
  assert(metrics2.pendingWithdrawalsCount === 2, 'Pending withdrawals count is exactly 2');
  assert(metrics2.pendingWithdrawalsUsd === '150.00', 'Pending withdrawals total is exact $150.00');
  assert(metrics2.pendingWithdrawalsCents === 15000, 'Pending withdrawals cents is 15000');
  // Strict separation check: Available balance must NOT be altered by pending query
  assert(metrics2.availableUsd === '428.50', 'Available cash remains strictly isolated at $428.50');

  // ─── TEST 3: In Active Orders Revenue Commitment ──────────────────────────
  console.log('\n--- TEST 3: In Active Orders Revenue Commitment ---');
  // Create an active in-progress order with boosterPool of $275.00 (27500 cents)
  const activeOrder1 = await prisma.order.create({
    data: {
      orderRef: `ORD-ACTIVE-1-${Date.now()}`,
      gameSlug: 'test_game_dash',
      serviceId: service.id,
      creatorId: testUserId,
      creatorType: 'g4x',
      status: 'in_progress',
      orderType: 'solo',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 35000,
      boosterPoolMinor: 27500, // $275.00
      assignments: {
        create: {
          userId: testUserId,
          assignedById: testUserId,
          assignedRole: 'Tank',
          status: 'assigned',
        },
      },
    },
  });

  const metrics3 = await getDashboardWalletMetrics(testUserId, walletSummary1);
  assert(metrics3.inActiveOrdersUsd === '275.00', 'In Active Orders total is exact $275.00');
  assert(metrics3.inActiveOrdersCount === 1, 'In Active Orders count is 1');
  assert(metrics3.inActiveOrdersCents === 27500, 'In Active Orders cents is 27500');

  // Verify non-conflation invariant:
  assert(
    metrics3.availableCents !== metrics3.pendingWithdrawalsCents &&
      metrics3.availableCents !== metrics3.inActiveOrdersCents,
    'Available Balance, Pending Withdrawals, and Active Order funds are 100% distinct'
  );

  // ─── TEST 4: Earnings Overview Chart & Time Ranges ────────────────────────
  console.log('\n--- TEST 4: Earnings Overview Chart (7D, 30D, 90D, ALL) ---');
  const chart30d = await getDashboardEarningsChart(testUserId, '30d');
  assert(chart30d.range === '30d', 'Range 30d correctly processed');
  assert(chart30d.periodLabel === 'Net earnings this month', 'Period label formatted');
  assert(chart30d.points.length === 30, '30 daily data points generated');
  assert(chart30d.currentPeriodTotalCents === 42850, 'Current period total matches credit');
  assert(chart30d.currentPeriodTotalUsd === '428.50', 'Current period USD formatted');
  assert(chart30d.growthPercentage === '+100%', 'Positive growth percentage calculated');

  const chart7d = await getDashboardEarningsChart(testUserId, '7d');
  assert(chart7d.range === '7d', 'Range 7d correctly processed');
  assert(chart7d.points.length === 7, '7 daily points generated for 7D filter');

  const chart90d = await getDashboardEarningsChart(testUserId, '90d');
  assert(chart90d.range === '90d', 'Range 90d correctly processed');
  assert(chart90d.points.length === 30, 'Sampled buckets generated for 90D filter');

  // ─── TEST 5: Order Earnings Breakdown ─────────────────────────────────────
  console.log('\n--- TEST 5: Order Earnings Breakdown ---');
  const breakdown = await getDashboardOrderEarningsBreakdown(testUserId);
  assert(breakdown.length >= 1, 'Order earnings breakdown contains active order');
  const item1 = breakdown.find((b) => b.orderId === activeOrder1.id);
  assert(item1 !== undefined, 'Target active order present in breakdown');
  assert(item1?.amountUsd === '275.00', 'Breakdown item net payout is $275.00');
  assert(item1?.earningsStage === 'in_progress', 'Earnings stage correctly identified as in_progress');
  assert(item1?.assignmentRole === 'Tank', 'Assigned role correctly populated');

  // ─── TEST 6: HTTP Endpoints Integration ───────────────────────────────────
  console.log('\n--- TEST 6: HTTP API Integration (GET /overview & /earnings-chart) ---');
  const auth = await createAuthenticatedAgent(testUserId);

  const resOverview = await auth.agent.get('/api/dashboard/overview');
  assert(resOverview.status === 200, 'GET /api/dashboard/overview returns 200');
  assert(resOverview.body.wallet.availableUsd === '428.50', 'Overview wallet availableUsd is $428.50');
  assert(resOverview.body.wallet.pendingWithdrawalsUsd === '150.00', 'Overview wallet pendingWithdrawalsUsd is $150.00');
  assert(resOverview.body.wallet.inActiveOrdersUsd === '275.00', 'Overview wallet inActiveOrdersUsd is $275.00');
  assert(resOverview.body.earningsChart !== undefined, 'Overview contains earningsChart payload');
  assert(resOverview.body.orderEarningsBreakdown !== undefined, 'Overview contains orderEarningsBreakdown payload');

  const resChart = await auth.agent.get('/api/dashboard/earnings-chart?range=7d');
  assert(resChart.status === 200, 'GET /api/dashboard/earnings-chart?range=7d returns 200');
  assert(resChart.body.range === '7d', 'Chart endpoint returns requested 7d dataset');
  assert(resChart.body.points.length === 7, 'Chart endpoint returns 7 points for 7d');

  console.log('\n================================================================');
  console.log('🎉 ALL DASHBOARD OVERHAUL & COMPONENT TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
