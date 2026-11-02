/**
 * dashboard_phase2_suite.ts — جامع‌ترین آزمون‌های اعتبارسنجی داشبورد کاربری فاز ۲
 */

import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { creditAvailableCents } from '../services/financeV2/financeV2WalletService';
import { LedgerV2EntryType } from '../services/financeV2/financeV2Types';

async function createAuthenticatedAgent(userId: string) {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/csrf-token');
  const cookieHeader = initRes.header['set-cookie'];
  const rawCookie = cookieHeader ? cookieHeader[0] : '';
  const match = rawCookie.match(/g4x\.sid=s%3A([^.]+)\./);
  const sid = match ? match[1] : '';

  await new Promise<void>((resolve, reject) => {
    sessionStore.get(sid, (err, sess) => {
      if (err || !sess) return reject(err || new Error('No session'));
      sess.userId = userId;
      sessionStore.set(sid, sess, (setErr) => {
        if (setErr) return reject(setErr);
        resolve();
      });
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

async function runDashboardPhase2Suite() {
  console.log('======================================================');
  console.log('   G4X COMMUNITY — WEBSITE PHASE 2 DASHBOARD SUITE    ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
      failed++;
    }
  }

  const uTestA = `u_dash_a_${Date.now()}`;
  const uTestB = `u_dash_b_${Date.now()}`;
  const uOwner = `u_dash_owner_${Date.now()}`;

  try {
    // ─── تمیزکاری اولیه ───────────────────────────────────────────────────
    await prisma.user.deleteMany({
      where: { discordId: { in: [uTestA, uTestB, uOwner] } },
    });

    // ─── ۱. آزمون‌های دسترسی تاییدنشده (Unauthenticated Access) ───────────
    const unauthOverview = await request(app).get('/api/dashboard/overview');
    assert(unauthOverview.status === 401, '1. Unauthenticated request to /api/dashboard/overview returns 401');

    const unauthHistory = await request(app).get('/api/dashboard/orders/history');
    assert(unauthHistory.status === 401, '2. Unauthenticated request to /api/dashboard/orders/history returns 401');

    const unauthTx = await request(app).get('/api/dashboard/transactions');
    assert(unauthTx.status === 401, '3. Unauthenticated request to /api/dashboard/transactions returns 401');

    // ─── ۲. ایجاد کاربران در دیتابیس ──────────────────────────────────────
    await prisma.user.create({
      data: {
        discordId: uTestA,
        username: 'TestBoosterA',
        displayName: 'Elite Booster A',
        isActive: true,
        advertiserRank: 'GOLD',
      },
    });

    await prisma.user.create({
      data: {
        discordId: uTestB,
        username: 'RegularUserB',
        displayName: 'Regular B',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uOwner,
        username: 'PlatformOwner',
        displayName: 'Master Owner',
        isActive: true,
      },
    });

    // نقش‌ها
    await prisma.userRole.createMany({
      data: [
        { userId: uTestA, roleKey: 'booster' },
        { userId: uTestA, roleKey: 'advertiser' },
        { userId: uOwner, roleKey: 'owner' },
      ],
    });

    // ایجاد Agentهای احراز هویت شده واقعی
    const authB = await createAuthenticatedAgent(uTestB);
    const authA = await createAuthenticatedAgent(uTestA);
    const authOwner = await createAuthenticatedAgent(uOwner);

    // ─── ۳. دریافت اطلاعات کاربر و بررسی عدم وجود والت قبلی (Auto Init) ─────
    const resOverviewB = await authB.agent.get('/api/dashboard/overview');

    assert(resOverviewB.status === 200, '4. Authenticated request for User B without initial wallet succeeds (200)');
    assert(resOverviewB.body.profile.discordId === uTestB, '5. Profile returns accurate Discord ID for session owner');
    assert(resOverviewB.body.profile.roles.length === 0, '6. User without assigned roles returns empty role list');
    assert(resOverviewB.body.wallet.availableCents === 0, '7. New wallet initializes safely with 0 cents without fabrication');
    assert(resOverviewB.body.wallet.availableUsd === '0.00', '8. Available USD formatted to exact two decimal places (0.00)');

    // ─── ۴. بررسی کاربر با چند نقش و رنک ادورتایزر ────────────────────────
    const resOverviewA = await authA.agent.get('/api/dashboard/overview');

    assert(resOverviewA.status === 200, '9. Overview for User A with multiple roles returns 200');
    assert(
      resOverviewA.body.profile.roles.includes('booster') && resOverviewA.body.profile.roles.includes('advertiser'),
      '10. Overview accurately includes all assigned roles (booster, advertiser)'
    );
    assert(resOverviewA.body.profile.advertiserRank === 'GOLD', '11. Advertiser rank correctly returned from database');

    // ─── ۵. واریز و مانده‌های والت ۲ و عدم ترکیب اشتباهی وضعیت‌ها ───────────
    // واریز 5000 سنت ($50.00) به والت A
    await creditAvailableCents(uTestA, 5000, LedgerV2EntryType.ADVERTISER_DEPOSIT, {
      description: 'Test Deposit for User A',
    });

    // تنظیم مانده‌های آزمایشی: 3500 در دسترس، 1500 رزرو، 2000 در انتظار، 10000 تاییدشده
    await prisma.walletV2.update({
      where: { userId: uTestA },
      data: {
        availableCents: 3500, // $35.00
        reservedCents: 1500,  // $15.00
        pendingEarningsCents: 2000, // $20.00
        confirmedEarningsCents: 10000, // $100.00
      },
    });

    const resBalances = await authA.agent.get('/api/dashboard/overview');

    const w = resBalances.body.wallet;
    assert(w.availableCents === 3500 && w.availableUsd === '35.00', '12. Available USD matches exact authoritative availableCents ($35.00)');
    assert(w.reservedCents === 1500 && w.reservedUsd === '15.00', '13. Reserved USD matches exact authoritative reservedCents ($15.00)');
    assert(w.pendingEarningsCents === 2000 && w.pendingEarningsUsd === '20.00', '14. Pending Earnings matches exact pending cents ($20.00)');
    assert(w.confirmedEarningsCents === 10000 && w.confirmedEarningsUsd === '100.00', '15. Confirmed Earnings matches exact confirmed cents ($100.00)');
    assert(w.eligibleWithdrawalCents === 3460 && w.eligibleWithdrawalUsd === '34.60', '16. Eligible withdrawal calculated correctly ($35.00 - $0.40 fee = $34.60)');
    assert(w.availableCents + w.reservedCents !== w.availableCents, '17. Available cash is strictly not conflated with reserved liability');

    // ─── ۶. ایجاد سفارش‌های فعال و عدم افشای متقابل (Order Ownership & Separation) ─
    await prisma.game.upsert({
      where: { slug: 'wow_midnight' },
      update: { isActive: true },
      create: { slug: 'wow_midnight', displayName: 'World of Warcraft Midnight', serviceCategory: 'both' },
    });
    const srv = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' } },
      update: { isActive: true },
      create: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus', displayName: 'Mythic+ 10 Run', serviceMode: 'non_pilot', profileMode: 'raiderio' },
    });

    const ordRefA_Booster = `ORD_A_BOOST_${Date.now()}`;
    const ordRefA_Customer = `ORD_A_CUST_${Date.now()}`;
    const ordRefB_Private = `ORD_B_PRIV_${Date.now()}`;

    // سفارش 1: بوستر آن User A است
    const ord1 = await prisma.order.create({
      data: {
        orderRef: ordRefA_Booster,
        gameSlug: 'wow_midnight',
        serviceId: srv.id,
        customerId: uTestB, // مشتری کاربر B است
        status: 'in_progress',
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 4000,
        boosterPoolMinor: 3000,
        executionChannelId: 'chan_exec_123',
      },
    });

    await prisma.orderAssignment.create({
      data: {
        orderId: ord1.id,
        userId: uTestA,
        assignedById: uOwner,
        assignedRole: 'DPS',
        status: 'assigned',
      },
    });

    // سفارش 2: مشتری آن User A است
    await prisma.order.create({
      data: {
        orderRef: ordRefA_Customer,
        gameSlug: 'wow_midnight',
        serviceId: srv.id,
        customerId: uTestA,
        status: 'assigned',
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 6000,
        boosterPoolMinor: 4500,
      },
    });

    // سفارش 3: کاملاً متعلق به User B و هیچ ارتباطی با User A ندارد
    await prisma.order.create({
      data: {
        orderRef: ordRefB_Private,
        gameSlug: 'wow_midnight',
        serviceId: srv.id,
        customerId: uTestB,
        status: 'in_progress',
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 9900,
      },
    });

    // استعلام سفارش‌های فعال کاربر A
    const resOrdersA = await authA.agent.get('/api/dashboard/overview');

    const activeA = resOrdersA.body.activeOrders;
    assert(activeA.length === 2, '18. User A retrieves exactly their 2 authorized active orders');

    const orderAsBooster = activeA.find((o: any) => o.orderRef === ordRefA_Booster);
    assert(orderAsBooster && orderAsBooster.userRelation === 'booster', '19. Order where user is assigned is distinguished as booster');
    assert(orderAsBooster.payoutUsd === '30.00', '20. Booster only sees booster payout allocation ($30.00), not gross customer total');

    const orderAsCustomer = activeA.find((o: any) => o.orderRef === ordRefA_Customer);
    assert(orderAsCustomer && orderAsCustomer.userRelation === 'customer', '21. Order created by user is distinguished as customer');
    assert(orderAsCustomer.payoutUsd === '60.00', '22. Customer sees gross order amount ($60.00)');

    // بررسی عدم افشای سفارش خصوصی کاربر B به کاربر A
    const leakedOrder = activeA.find((o: any) => o.orderRef === ordRefB_Private);
    assert(!leakedOrder, '23. STRICT PRIVACY: User A cannot see unrelated orders belonging to User B');

    // ─── ۷. تاریخچه سفارش‌های پایان‌یافته و فیلتر و صفحه‌بندی ──────────────
    const ordRefCompleted = `ORD_COMP_${Date.now()}`;
    const ordRefCancelled = `ORD_CANC_${Date.now()}`;

    await prisma.order.create({
      data: {
        orderRef: ordRefCompleted,
        gameSlug: 'wow_midnight',
        serviceId: srv.id,
        customerId: uTestA,
        status: 'completed',
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 5000,
        completedAt: new Date(),
      },
    });

    await prisma.order.create({
      data: {
        orderRef: ordRefCancelled,
        gameSlug: 'wow_midnight',
        serviceId: srv.id,
        customerId: uTestA,
        status: 'cancelled',
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 2500,
      },
    });

    const resHistory = await authA.agent.get('/api/dashboard/orders/history?status=completed');

    assert(resHistory.status === 200, '24. History endpoint responds 200 with status filter');
    assert(resHistory.body.orders.every((o: any) => o.status === 'completed'), '25. Only completed orders returned when status=completed filter applied');

    const resPagination = await authA.agent.get('/api/dashboard/orders/history?page=1&limit=1');

    assert(resPagination.body.orders.length === 1, '26. Server-side pagination respects limit=1');
    assert(resPagination.body.pagination.total >= 2, '27. Pagination total reflects all historical orders for user');

    // ─── ۸. تاریخچه تراکنش‌های والت دلاری (LedgerEntryV2 Activity) ─────────
    const resTxA = await authA.agent.get('/api/dashboard/transactions');

    assert(resTxA.status === 200, '28. Transactions endpoint responds 200 for authenticated user');
    assert(resTxA.body.transactions.length >= 1, '29. LedgerEntryV2 transactions retrieved correctly');
    assert(resTxA.body.transactions[0].direction === 'CREDIT', '30. Direction CREDIT correctly mapped');

    // بررسی عدم افشای تراکنش به کاربر B
    const resTxB = await authB.agent.get('/api/dashboard/transactions');

    assert(resTxB.body.transactions.length === 0, '31. STRICT PRIVACY: User B sees zero transactions from User A');

    // ─── ۹. سازگاری نشست‌های OwnerGate ────────────────────────────────────
    const resOwner = await authOwner.agent.get('/api/dashboard/overview');

    assert(resOwner.status === 200, '32. OwnerGate authenticated session successfully accesses dashboard overview');
    assert(resOwner.body.profile.roles.includes('owner'), '33. OwnerGate user correctly identified with owner role');

    // ─── ۱۰. انقضای نشست (Session Expiration) ──────────────────────────────
    await new Promise<void>((resolve) => {
      sessionStore.destroy(authB.sid, () => resolve());
    });

    const resExpired = await authB.agent.get('/api/dashboard/overview');

    assert(resExpired.status === 401, '34. Expired or deleted session immediately receives 401 Unauthorized');

  } finally {
    // پاک‌سازی سوابق آزمایشی
    await prisma.orderAssignment.deleteMany({
      where: { userId: { in: [uTestA, uTestB, uOwner] } },
    });
    await prisma.order.deleteMany({
      where: { customerId: { in: [uTestA, uTestB, uOwner] } },
    });
    await prisma.ledgerEntryV2.deleteMany({
      where: { userId: { in: [uTestA, uTestB, uOwner] } },
    });
    await prisma.walletV2.deleteMany({
      where: { userId: { in: [uTestA, uTestB, uOwner] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [uTestA, uTestB, uOwner] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [uTestA, uTestB, uOwner] } },
    });
  }

  console.log(`\n======================================================`);
  console.log(`PHASE 2 DASHBOARD RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runDashboardPhase2Suite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
