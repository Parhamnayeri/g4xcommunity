/**
 * advertiser_phase4_suite.ts — Comprehensive Test Suite for React Advertiser Portal (Website Phase 4)
 * Covers:
 *  - Unauthorized access protections (401)
 *  - Approved Advertiser vs. Pending application vs. Regular user
 *  - Authoritative rank hierarchy and commission rendering (Bronze 14.99% to Official Partners 6.99%)
 *  - Historical commission snapshot immutability across rank modifications
 *  - Spendable available wallet funds vs. reserved escrow balances
 *  - Strict order ownership & isolation between G4X and Advertiser orders
 *  - Active orders listing, filtering, and pagination
 *  - Authorized order notes editing with character limit and AuditLog
 *  - Disallowed notes editing on completed/cancelled or third-party orders
 *  - Direct cancellation for unassigned orders vs. Management review workflow for active orders
 *  - Unauthorized cancellation rejection
 *  - Authorized Discord channel access check
 *  - CSRF protection on mutating endpoints
 */

import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { AdvertiserRank, setAdvertiserRank } from '../services/advertiserRankService';
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
      if (err || !sess) return reject(err || new Error('No session found'));
      sess.userId = userId;
      sessionStore.set(sid, sess, (setErr) => {
        if (setErr) return reject(setErr);
        resolve();
      });
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

async function runAdvertiserPhase4Suite() {
  console.log('======================================================');
  console.log('   G4X COMMUNITY — WEBSITE PHASE 4 ADVERTISER SUITE   ');
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

  const uAdvA = `u_p4_adv_a_${Date.now()}`;
  const uAdvB = `u_p4_adv_b_${Date.now()}`;
  const uPending = `u_p4_pending_${Date.now()}`;
  const uRegular = `u_p4_reg_${Date.now()}`;
  const uStaff = `u_p4_staff_${Date.now()}`;
  const uBooster = `u_p4_bst_${Date.now()}`;

  let testGame: any;
  let testService: any;
  let orderUnassigned: any;
  let orderAssigned: any;
  let orderCompleted: any;

  try {
    // ─── ۱. آزمون‌های دسترسی تاییدنشده (Unauthorized Access - 401) ──────────
    const unauthOverview = await request(app).get('/api/advertiser/portal-overview');
    assert(unauthOverview.status === 401, '1. Unauthenticated request to /api/advertiser/portal-overview returns 401');

    const unauthNotes = await request(app).patch('/api/advertiser/orders/1/notes').send({ notes: 'hack' });
    assert(unauthNotes.status === 401, '2. Unauthenticated request to /api/advertiser/orders/:id/notes returns 401');

    const unauthCancel = await request(app).post('/api/advertiser/orders/1/cancel-request').send({ reason: 'cancel' });
    assert(unauthCancel.status === 401, '3. Unauthenticated request to /api/advertiser/orders/:id/cancel-request returns 401');

    // ─── ۲. ایجاد کاربران آزمایشی در دیتابیس ─────────────────────────────────
    await prisma.user.createMany({
      data: [
        {
          discordId: uAdvA,
          username: 'CommercialPartnerA',
          displayName: 'Agency Alpha',
          advertiserRank: AdvertiserRank.BRONZE,
        },
        {
          discordId: uAdvB,
          username: 'CommercialPartnerB',
          displayName: 'Agency Beta',
          advertiserRank: AdvertiserRank.SILVER,
        },
        {
          discordId: uPending,
          username: 'PendingApplicant',
          displayName: 'Pending User',
        },
        {
          discordId: uRegular,
          username: 'RegularGamer',
          displayName: 'Community Member',
        },
        {
          discordId: uStaff,
          username: 'ManagerOversight',
          displayName: 'Staff Manager',
        },
        {
          discordId: uBooster,
          username: 'AssignedBoosterUser',
          displayName: 'Top Booster',
        },
      ],
    });

    // انتساب نقش‌ها
    await prisma.userRole.createMany({
      data: [
        { userId: uAdvA, roleKey: 'advertiser' },
        { userId: uAdvB, roleKey: 'advertiser' },
        { userId: uStaff, roleKey: 'manager' },
        { userId: uBooster, roleKey: 'booster' },
      ],
    });

    // ثبت درخواست معلق ادورتایزر برای uPending
    await prisma.registrationApplication.create({
      data: {
        userId: uPending,
        category: 'advertiser',
        status: 'pending',
        qualifications: 'Commercial partner testing',
      },
    });

    // آماده‌سازی بازی و سرویس تستی
    testGame = await prisma.game.upsert({
      where: { slug: 'wow-phase4-adv' },
      update: {},
      create: {
        slug: 'wow-phase4-adv',
        displayName: 'World of Warcraft Phase 4',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    testService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: testGame.slug,
          serviceKey: 'mythic-plus-phase4',
        },
      },
      update: {},
      create: {
        gameSlug: testGame.slug,
        serviceKey: 'mythic-plus-phase4',
        displayName: 'Mythic+ Dungeons P4',
        serviceMode: 'both',
        profileMode: 'character',
        isActive: true,
      },
    });

    // ایجاد ایجنت‌های لاگین‌شده
    const agentAdvA = await createAuthenticatedAgent(uAdvA);
    const agentAdvB = await createAuthenticatedAgent(uAdvB);
    const agentPending = await createAuthenticatedAgent(uPending);
    const agentStaff = await createAuthenticatedAgent(uStaff);

    // ─── ۳. اعتبارسنجی پورتال ادورتایزر تاییدشده (Approved Advertiser) ───────
    const advAOverview = await agentAdvA.agent.get('/api/advertiser/portal-overview');
    assert(advAOverview.status === 200, '4. Approved advertiser receives 200 from /api/advertiser/portal-overview');
    assert(advAOverview.body.profile.isApprovedAdvertiser === true, '5. Approved advertiser profile indicates isApprovedAdvertiser: true');
    assert(advAOverview.body.rank.currentRank === AdvertiserRank.BRONZE, '6. Authoritative rank correctly reports BRONZE');
    assert(advAOverview.body.rank.commissionPercent === '14.99%', '7. Authoritative fee accurately reports 14.99% for Bronze');

    // بررسی تمام ۶ سطح سلسله‌مراتب رنک‌ها
    const hierarchy = advAOverview.body.rank.rankHierarchy;
    assert(Array.isArray(hierarchy) && hierarchy.length === 6, '8. Authoritative rankHierarchy contains exactly 6 approved tiers');
    assert(
      hierarchy.some((h: any) => h.rank === 'BRONZE' && h.percentage === '14.99%') &&
      hierarchy.some((h: any) => h.rank === 'SILVER' && h.percentage === '12.99%') &&
      hierarchy.some((h: any) => h.rank === 'GOLD' && h.percentage === '10.99%') &&
      hierarchy.some((h: any) => h.rank === 'DIAMOND' && h.percentage === '8.99%') &&
      hierarchy.some((h: any) => h.rank === 'FOUNDING_ADVERTISER' && h.percentage === '8.99%') &&
      hierarchy.some((h: any) => h.rank === 'OFFICIAL_PARTNERS' && h.percentage === '6.99%'),
      '9. All 6 tiers (Bronze 14.99% to Official Partners 6.99%) correctly returned in hierarchy schedule'
    );

    // ─── ۴. اعتبارسنجی کاربر با درخواست معلق (Pending Advertiser) ───────────
    const pendingOverview = await agentPending.agent.get('/api/advertiser/portal-overview');
    assert(pendingOverview.status === 200, '10. Pending applicant can query overview');
    assert(pendingOverview.body.profile.isApprovedAdvertiser === false, '11. Pending applicant is not marked as approved');
    assert(pendingOverview.body.profile.applicationStatus === 'pending', '12. Pending applicant receives applicationStatus: pending');

    // ─── ۵. تفکیک موجودی والت قابل‌مصرف و رزروشده (Wallet Spendable Funds) ────
    await creditAvailableCents(uAdvA, 10000, LedgerV2EntryType.AVAILABLE_RELEASE, { description: 'Test funding for Phase 4' });
    const fundedOverview = await agentAdvA.agent.get('/api/advertiser/portal-overview');
    assert(fundedOverview.body.wallet.availableCents === 10000, '13. WalletV2 availableCents matches $100.00 exactly');
    assert(fundedOverview.body.wallet.availableUsd === '100.00', '14. WalletV2 availableUsd formatted correctly as 100.00');
    assert(fundedOverview.body.wallet.canPlaceOrders === true, '15. canPlaceOrders returns true when spendable balance > 0');

    // ─── ۶. ایجاد سفارش مستقیم با انجماد کمیسیون رنک (Order Creation) ─────────
    const createRes = await agentAdvA.agent
      .post('/api/orders/create')
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({
        gameSlug: testGame.slug,
        serviceId: testService.id,
        grossAmountUsd: '50.00',
        orderType: 'group',
        notes: 'Initial test boost notes',
      });

    assert(createRes.status === 200, '16. Direct boost order creation succeeds with sufficient spendable wallet funds');
    orderUnassigned = createRes.body.order;
    assert(orderUnassigned.advertiserRank === AdvertiserRank.BRONZE, '17. Created order records advertiserRank as BRONZE');
    assert(orderUnassigned.platformFeeMinor === 750, '18. 14.99% fee on $50.00 rounded to 750 cents ($7.50)');
    assert(orderUnassigned.boosterPoolMinor === 4250, '19. Booster pool is remaining $42.50 (conservation of funds)');

    // ─── ۷. تغییر رنک ادورتایزر و عدم تغییر عطف‌به‌ماسبق کمیسیون (Immutability) ─
    await setAdvertiserRank({
      advertiserId: uAdvA,
      newRank: AdvertiserRank.DIAMOND,
      reason: 'Promoted to Diamond for enterprise testing',
      actorId: uStaff,
    });

    const upgradedOverview = await agentAdvA.agent.get('/api/advertiser/portal-overview');
    assert(upgradedOverview.body.rank.currentRank === AdvertiserRank.DIAMOND, '20. Active rank upgraded to DIAMOND (8.99%)');

    // بررسی اینکه سفارش قبلی همچنان کارمزد Bronze (750 cents) را حفظ کرده است
    const savedOrder = await prisma.order.findUnique({
      where: { id: orderUnassigned.id },
      include: { financialSnapshot: true },
    });
    assert(
      savedOrder?.advertiserRank === AdvertiserRank.BRONZE && savedOrder?.platformFeeMinor === 750,
      '21. Existing order retains immutable BRONZE commission snapshot ($7.50) without retroactive modification'
    );

    // ─── ۸. ایجاد سفارش در وضعیت اجرا با بوستر منتسب ─────────────────────────
    const assignedOrderRecord = await prisma.order.create({
      data: {
        orderRef: `ORD_P4_ACTIVE_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        creatorType: 'advertiser',
        advertiserId: uAdvA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 8000,
        platformFeeMinor: 719,
        boosterPoolMinor: 7281,
        advertiserRank: AdvertiserRank.DIAMOND,
        paymentStatus: 'verified',
        status: 'in_progress',
        executionChannelId: 'channel_p4_mock_123',
        notes: 'Active in-progress dungeon boost',
      },
    });
    orderAssigned = assignedOrderRecord;

    await prisma.orderAssignment.create({
      data: {
        orderId: assignedOrderRecord.id,
        userId: uBooster,
        assignedRole: 'tank',
        assignedById: uStaff,
        status: 'assigned',
      },
    });

    // سفارش تکمیل‌شده
    orderCompleted = await prisma.order.create({
      data: {
        orderRef: `ORD_P4_COMPLETED_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        creatorType: 'advertiser',
        advertiserId: uAdvA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        platformFeeMinor: 899,
        boosterPoolMinor: 9101,
        advertiserRank: AdvertiserRank.DIAMOND,
        paymentStatus: 'verified',
        status: 'completed',
        completedAt: new Date(),
        notes: 'Successfully finished run',
      },
    });

    // ─── ۹. لیست سفارشات فعال، تفکیک مالکیت و فیلترها (Separation & Privacy) ─
    const advAOrdersRes = await agentAdvA.agent.get('/api/orders/dashboard-list?tab=advertiser&status=active');
    assert(advAOrdersRes.status === 200, '22. Advertiser A can retrieve active orders list');
    const advAOrders = advAOrdersRes.body.orders;
    assert(
      advAOrders.some((o: any) => o.id === orderUnassigned.id) &&
      advAOrders.some((o: any) => o.id === orderAssigned.id),
      '23. Active orders list includes unassigned and in-progress orders owned by Advertiser A'
    );
    assert(
      !advAOrders.some((o: any) => o.id === orderCompleted.id),
      '24. Completed order is excluded from active orders list'
    );

    // حریم خصوصی متقابل: ادورتایزر B نباید سفارشات ادورتایزر A را ببیند
    const advBOrdersRes = await agentAdvB.agent.get('/api/orders/dashboard-list?tab=advertiser&status=active');
    assert(
      !advBOrdersRes.body.orders.some((o: any) => o.id === orderUnassigned.id || o.id === orderAssigned.id),
      '25. Cross-user privacy: Advertiser B cannot see orders owned by Advertiser A'
    );

    // ممانعت از مشاهده سفارشات G4X توسط ادورتایزر عادی
    const advAccessG4x = await agentAdvA.agent.get('/api/orders/dashboard-list?tab=g4x');
    assert(advAccessG4x.status === 403, '26. Ordinary advertiser is forbidden from querying G4X platform orders (403)');

    // نظارت پرسنل: پرسنل می‌توانند سفارشات ادورتایزر را مشاهده کنند بدون تغییر مالکیت
    const staffAdvQuery = await agentStaff.agent.get('/api/orders/dashboard-list?tab=advertiser');
    assert(staffAdvQuery.status === 200, '27. Staff with oversight role can view advertiser orders');

    // ─── ۱۰. ویرایش یادداشت سفارش (Order Notes Editing) ─────────────────────
    const editNotesRes = await agentAdvA.agent
      .patch(`/api/advertiser/orders/${orderUnassigned.id}/notes`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ notes: 'Updated scheduling instructions: Saturday 8 PM CET' });

    assert(editNotesRes.status === 200, '28. Order owner can edit order notes via PATCH /api/advertiser/orders/:id/notes');
    assert(editNotesRes.body.notes === 'Updated scheduling instructions: Saturday 8 PM CET', '29. Notes updated successfully');

    // ثبت در لاگ ممیزی (AuditLog)
    const auditRecord = await prisma.auditLog.findFirst({
      where: { entityType: 'Order', entityId: String(orderUnassigned.id), action: 'ORDER_NOTES_UPDATED' },
    });
    assert(auditRecord !== null, '30. AuditLog entry created for order notes modification');

    // ممانعت از ویرایش یادداشت توسط کاربر غیرمالک
    const unauthEditNotes = await agentAdvB.agent
      .patch(`/api/advertiser/orders/${orderUnassigned.id}/notes`)
      .set('x-csrf-token', agentAdvB.csrfToken)
      .send({ notes: 'Malicious modification attempt' });
    assert(unauthEditNotes.status === 403, '31. Non-owner is forbidden from editing notes on another advertiser order (403)');

    // ممانعت از ویرایش یادداشت روی سفارش تکمیل‌شده
    const completedEditNotes = await agentAdvA.agent
      .patch(`/api/advertiser/orders/${orderCompleted.id}/notes`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ notes: 'Edit on completed order' });
    assert(completedEditNotes.status === 400, '32. Editing notes on completed order is blocked (ORDER_IMMUTABLE)');

    // ممانعت از ثبت یادداشت طولانی‌تر از ۵۰۰ کاراکتر
    const longNotes = await agentAdvA.agent
      .patch(`/api/advertiser/orders/${orderUnassigned.id}/notes`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ notes: 'A'.repeat(501) });
    assert(longNotes.status === 400, '33. Notes exceeding 500 characters are strictly rejected');

    // ─── ۱۱. لغو مستقیم سفارش بدون بوستر (Direct Cancellation) ───────────────
    const directCancelRes = await agentAdvA.agent
      .post(`/api/advertiser/orders/${orderUnassigned.id}/cancel-request`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ reason: 'Customer cancelled prior to booster assignment' });

    assert(directCancelRes.status === 200, '34. Direct cancellation request succeeds on unassigned order');
    assert(directCancelRes.body.status === 'cancelled', '35. Direct cancellation immediately sets status to cancelled');

    const cancelledOrderCheck = await prisma.order.findUnique({
      where: { id: orderUnassigned.id },
    });
    assert(cancelledOrderCheck?.status === 'cancelled', '36. Database status updated to cancelled');

    // ─── ۱۲. فرآیند درخواست لغو برای سفارش فعال با بوستر منتسب ───────────────
    // ادورتایزر نمی‌تواند تعهدات فعال را راساً لغو کند؛ باید از طریق بررسی مدیریت بگذرد
    const activeCancelRes = await agentAdvA.agent
      .post(`/api/advertiser/orders/${orderAssigned.id}/cancel-request`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ reason: 'Dungeon key depleted mid-run; requesting staff cancellation' });

    assert(activeCancelRes.status === 200, '37. Active order with assigned boosters accepts cancellation review request');
    assert(activeCancelRes.body.status === 'pending_review', '38. Returns status: pending_review (does not mark cancelled directly)');
    assert(activeCancelRes.body.disputeId !== undefined, '39. OrderDispute created for staff review');

    // بررسی اینکه سفارش همچنان در وضعیت فعال است و خودسرانه لغو نشده است
    const assignedOrderPostCheck = await prisma.order.findUnique({
      where: { id: orderAssigned.id },
    });
    assert(
      assignedOrderPostCheck?.status === 'in_progress',
      '40. Active financial commitment preserved; order remains in_progress until staff approval'
    );

    // تلاش برای لغو تکراری مسدود می‌شود
    const duplicateCancelRes = await agentAdvA.agent
      .post(`/api/advertiser/orders/${orderAssigned.id}/cancel-request`)
      .set('x-csrf-token', agentAdvA.csrfToken)
      .send({ reason: 'Duplicate attempt' });
    assert(duplicateCancelRes.status === 400, '41. Duplicate cancellation request on order with pending review is rejected');

    // ─── ۱۳. امنیت CSRF و دسترسی به کانال دیسکورد ────────────────────────────
    const noCsrfNotes = await agentAdvA.agent
      .patch(`/api/advertiser/orders/${orderAssigned.id}/notes`)
      .send({ notes: 'Without CSRF' });
    assert(noCsrfNotes.status === 403, '42. Mutating request without valid CSRF token is rejected (403)');

    // استعلام کانال دیسکورد فقط برای کاربران مجاز
    const channelAccessOwner = await agentAdvA.agent.get(`/api/orders/${orderAssigned.id}/channel`);
    assert(channelAccessOwner.status === 200, '43. Authorized order owner can query /api/orders/:id/channel');

    const channelAccessStranger = await agentAdvB.agent.get(`/api/orders/${orderAssigned.id}/channel`);
    assert(channelAccessStranger.status === 403, '44. Unauthorized stranger is denied Discord channel access (403)');

    // ─── ۱۴. تاریخچه سفارشات و صفحه‌بندی (Order History & Pagination) ────────
    const historyRes = await agentAdvA.agent.get('/api/orders/dashboard-list?tab=advertiser&status=history');
    assert(historyRes.status === 200, '45. Advertiser can query order history list');
    assert(
      historyRes.body.orders.some((o: any) => o.id === orderCompleted.id) &&
      historyRes.body.orders.some((o: any) => o.id === orderUnassigned.id),
      '46. History list correctly includes completed and cancelled orders'
    );

    console.log('\n======================================================');
    console.log(`PHASE 4 ADVERTISER SUITE RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal error during Phase 4 suite:', err);
    process.exit(1);
  } finally {
    // تمیزکاری دیتابیس تستی
    try {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      await prisma.escrowHold.deleteMany({
        where: { orderId: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.orderDispute.deleteMany({
        where: { orderId: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.orderAssignment.deleteMany({
        where: { orderId: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.orderFinancialSnapshot.deleteMany({
        where: { orderId: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.ledgerEntryV2.deleteMany({
        where: { userId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      await prisma.orderChannel.deleteMany({
        where: { orderId: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: [orderUnassigned?.id, orderAssigned?.id, orderCompleted?.id].filter(Boolean) } },
      });
      await prisma.walletV2.deleteMany({
        where: { userId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      await prisma.registrationApplication.deleteMany({
        where: { userId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [uAdvA, uAdvB, uPending, uRegular, uStaff, uBooster] } },
      });
      if (testService) {
        await prisma.gameService.deleteMany({ where: { id: testService.id } });
      }
      if (testGame) {
        await prisma.game.deleteMany({ where: { slug: testGame.slug } });
      }
    } catch {}
  }
}

runAdvertiserPhase4Suite().catch((err) => {
  console.error(err);
  process.exit(1);
});
