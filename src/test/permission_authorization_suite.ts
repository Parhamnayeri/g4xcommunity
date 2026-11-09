/**
 * permission_authorization_suite.ts — مجموعه تست‌های جامع سیستم متمرکز مجوزها و اختیارات (Phase 3.1)
 *
 * ۲۵ سناریوی آزمون الزامی:
 *  1. Unregistered user denied.
 *  2. User with no roles denied privileged actions.
 *  3. Owner permitted for authorized administrative operations.
 *  4. Manager denied owner-only infrastructure actions.
 *  5. Admin permitted to verify a currency deposit.
 *  6. Staff denied currency deposit verification.
 *  7. Staff denied financial balance adjustment.
 *  8. Advertiser can manage an authorized order.
 *  9. Advertiser denied access to unrelated order management.
 * 10. Advertiser can assign on an authorized order.
 * 11. Advertiser cannot approve final completion.
 * 12. Booster can submit proof for an assigned run.
 * 13. Booster cannot submit proof for an unrelated run.
 * 14. Booster cannot approve their own final completion.
 * 15. Pilot without approved verification denied pilot service.
 * 16. Exchanger can manage own offer.
 * 17. Exchanger denied another exchanger's offer management.
 * 18. Exchanger denied confidential boost order source information.
 * 19. Unauthorized identity document access denied.
 * 20. Inactive approval denied.
 * 21. Multiple-role user receives the permitted union without bypassing resource scope.
 * 22. Direct in_progress to completed transition is rejected.
 * 23. Escrow with missing associated order remains blocked.
 * 24. Permission denial generates appropriate audit metadata.
 * 25. Authorization database failure does not grant access.
 */

import prisma from '../database/db';
import { authorize, assertAuthorized } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { validateOrderTransition } from '../services/orderValidationService';
import { checkEscrowEligibility } from '../services/escrowService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

async function runPermissionTests() {
  console.log('=== STARTING PHASE 3.1 CENTRAL PERMISSION & AUTHORIZATION TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  const now = new Date();
  const hundredHoursAgo = new Date(now.getTime() - 100 * 60 * 60 * 1000);

  // شناسه کاربران تست
  const uOwner = 'test_perm_owner';
  const uManager = 'test_perm_manager';
  const uAdmin = 'test_perm_admin';
  const uStaff = 'test_perm_staff';
  const uAdvA = 'test_perm_adv_a';
  const uAdvB = 'test_perm_adv_b';
  const uBooster = 'test_perm_booster';
  const uPilotNoVerif = 'test_perm_pilot_noverif';
  const uExchangerA = 'test_perm_exch_a';
  const uExchangerB = 'test_perm_exch_b';
  const uNoRoles = 'test_perm_no_roles';
  const uMulti = 'test_perm_multi_role';

  try {
    // ─── ۱. آماده‌سازی کاربران و نقش‌ها در دیتابیس ───────────────────────
    const users = [
      { id: uOwner, name: 'OwnerUser', role: 'owner' },
      { id: uManager, name: 'ManagerUser', role: 'manager' },
      { id: uAdmin, name: 'AdminUser', role: 'admin' },
      { id: uStaff, name: 'StaffUser', role: 'staff' },
      { id: uAdvA, name: 'AdvertiserA', role: 'advertiser' },
      { id: uAdvB, name: 'AdvertiserB', role: 'advertiser' },
      { id: uBooster, name: 'BoosterUser', role: 'booster' },
      { id: uPilotNoVerif, name: 'PilotNoVerif', role: 'pilot' },
      { id: uExchangerA, name: 'ExchangerA', role: 'exchanger' },
      { id: uExchangerB, name: 'ExchangerB', role: 'exchanger' },
      { id: uNoRoles, name: 'UserWithNoRoles', role: null },
      { id: uMulti, name: 'MultiRoleUser', role: null }, // دارای چندین نقش
    ];

    for (const u of users) {
      await prisma.user.upsert({
        where: { discordId: u.id },
        update: {},
        create: { discordId: u.id, username: u.name },
      });
      if (u.role) {
        await prisma.userRole.upsert({
          where: { userId_roleKey: { userId: u.id, roleKey: u.role } },
          update: {},
          create: { userId: u.id, roleKey: u.role },
        });
      }
    }

    // انتساب چند نقش به uMulti (هم ادورتایزر و هم بوستر)
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: uMulti, roleKey: 'advertiser' } },
      update: {},
      create: { userId: uMulti, roleKey: 'advertiser' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: uMulti, roleKey: 'booster' } },
      update: {},
      create: { userId: uMulti, roleKey: 'booster' },
    });

    // دریافت بازی و سرویس
    const wowGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    if (!wowGame) throw new Error('wow_midnight missing');
    const mplusService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
    });
    if (!mplusService) throw new Error('mplusService missing');

    const pilotService = await prisma.gameService.findFirst({
      where: { serviceMode: 'pilot' },
    });
    if (!pilotService) throw new Error('pilotService missing');

    // ایجاد سفارش‌های تست
    const orderAdvA = await prisma.order.create({
      data: {
        orderRef: 'ORD-PERM-ADV-A',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'open_presign',
      },
    });

    const orderAdvB = await prisma.order.create({
      data: {
        orderRef: 'ORD-PERM-ADV-B',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvB,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'open_presign',
      },
    });

    const runAdvA = await prisma.orderRun.create({
      data: {
        orderId: orderAdvA.id,
        runNumber: 1,
        status: 'in_progress',
      },
    });

    // انتساب بوستر به ران متعلق به سفارش ادورتایزر A
    await prisma.orderAssignment.create({
      data: {
        orderId: orderAdvA.id,
        userId: uBooster,
        assignedById: uAdmin,
        assignedRole: 'dps',
        status: 'assigned',
      },
    });

    // ایجاد آفر صرافی
    const offerA = await prisma.exchangerOffer.create({
      data: {
        exchangerId: uExchangerA,
        gameSlug: 'wow_midnight',
        currencyType: 'gold',
        settlementCurrency: 'IRT',
        settlementMethod: 'sheba',
      },
    });

    // ─── تست ۱: رد کاربر ثبت‌نشده (Unregistered user denied) ─────────────
    const res1 = await authorize('unknown_discord_9999', Permission.ORDER_VIEW_PRIVATE);
    assert(!res1.allowed && res1.reason?.includes('USER_NOT_FOUND_OR_INACTIVE'), '1. Unregistered user denied');

    // ─── تست ۲: رد کاربر بدون نقش در عملیات‌های امتیازی ───────────────────
    const res2 = await authorize(uNoRoles, Permission.ORDER_PAYMENT_VERIFY);
    assert(!res2.allowed && res2.reason?.includes('NO_ROLES_ASSIGNED'), '2. User with no roles denied privileged actions');

    // ─── تست ۳: دسترسی مالک به عملیات‌های حساس زیرساختی ───────────────────
    const res3 = await authorize(uOwner, Permission.SYSTEM_CONFIG_MANAGE);
    assert(res3.allowed, '3. Owner permitted for authorized administrative operations');

    // ─── تست ۴: سلب دسترسی منیجر به عملیات انحصاری زیرساخت مالک ──────────
    const res4 = await authorize(uManager, Permission.SYSTEM_CONFIG_MANAGE);
    assert(!res4.allowed && res4.reason?.includes('OWNER_ONLY_INFRASTRUCTURE'), '4. Manager denied owner-only infrastructure actions');

    // ─── تست ۵: دسترسی ادمین به تایید واریزی سفارش ────────────────────────
    const res5 = await authorize(uAdmin, Permission.ORDER_PAYMENT_VERIFY);
    assert(res5.allowed, '5. Admin permitted to verify a currency deposit');

    // ─── تست ۶: سلب دسترسی استاف به تایید واریزی ارز ───────────────────────
    const res6 = await authorize(uStaff, Permission.ORDER_PAYMENT_VERIFY);
    assert(!res6.allowed && res6.reason?.includes('PAYMENT_VERIFY_FORBIDDEN'), '6. Staff denied currency deposit verification');

    // ─── تست ۷: سلب دسترسی استاف به تعدیل مانده و جابجایی مالی ───────────
    const res7 = await authorize(uStaff, Permission.FINANCE_ADJUST);
    assert(!res7.allowed && res7.reason?.includes('FINANCE_ADJUST_FORBIDDEN'), '7. Staff denied financial balance adjustment');

    // ─── تست ۸: ادورتایزر مجاز به مدیریت سفارش متعلق به خودش است ──────────
    const res8 = await authorize(uAdvA, Permission.ORDER_CANCEL, { orderId: orderAdvA.id });
    assert(res8.allowed, '8. Advertiser can manage an authorized order');

    // ─── تست ۹: سلب دسترسی ادورتایزر به سفارش نامرتبط متعلق به دیگری ─────
    const res9 = await authorize(uAdvA, Permission.ORDER_CANCEL, { orderId: orderAdvB.id });
    assert(!res9.allowed && res9.reason?.includes('UNAUTHORIZED_ORDER_SCOPE'), '9. Advertiser denied access to unrelated order management');

    // ─── تست ۱۰: ادورتایزر می‌تواند روی سفارش مجاز خود بوستر تخصیص دهد ────
    const res10 = await authorize(uAdvA, Permission.ORDER_ASSIGN, { orderId: orderAdvA.id });
    assert(res10.allowed, '10. Advertiser can assign on an authorized order');

    // ─── تست ۱۱: ادورتایزر نمی‌تواند تایید نهایی اتمام سفارش را صادر کند ──
    const res11 = await authorize(uAdvA, Permission.ORDER_FINAL_APPROVE, { orderId: orderAdvA.id });
    assert(!res11.allowed && res11.reason?.includes('FINAL_APPROVE_FORBIDDEN'), '11. Advertiser cannot approve final completion');

    // ─── تست ۱۲: بوستر می‌تواند مدرک ران منتسب به خودش را ارسال کند ──────
    const res12 = await authorize(uBooster, Permission.PROOF_SUBMIT_ASSIGNED, { runId: runAdvA.id });
    assert(res12.allowed, '12. Booster can submit proof for an assigned run');

    // ─── تست ۱۳: بوستر نمی‌تواند برای ران نامرتبط مدرک ارسال کند ─────────
    const runAdvB = await prisma.orderRun.create({
      data: { orderId: orderAdvB.id, runNumber: 1, status: 'in_progress' },
    });
    const res13 = await authorize(uBooster, Permission.PROOF_SUBMIT_ASSIGNED, { runId: runAdvB.id });
    assert(!res13.allowed && res13.reason?.includes('UNASSIGNED_RUN_PROOF'), '13. Booster cannot submit proof for an unrelated run');

    // ─── تست ۱۴: بوستر نمی‌تواند اتمام نهایی سفارش را تایید کند ───────────
    const res14 = await authorize(uBooster, Permission.ORDER_FINAL_APPROVE, { orderId: orderAdvA.id });
    assert(!res14.allowed && res14.reason?.includes('FINAL_APPROVE_FORBIDDEN'), '14. Booster cannot approve their own final completion');

    // ─── تست ۱۵: رد پایلوت فاقد احراز هویت تاییدشده در سرویس پایلوت ────────
    const res15 = await authorize(uPilotNoVerif, Permission.CLAIM_CREATE, { serviceId: pilotService.id });
    assert(!res15.allowed && res15.reason?.includes('PILOT_VERIFICATION_REQUIRED'), '15. Pilot without approved verification denied pilot service');

    // ─── تست ۱۶: صراف می‌تواند پیشنهاد متعلق به خودش را مدیریت کند ────────
    const res16 = await authorize(uExchangerA, Permission.EXCHANGER_OFFER_MANAGE_OWN, { offerId: offerA.id });
    assert(res16.allowed, '16. Exchanger can manage own offer');

    // ─── تست ۱۷: صراف نمی‌تواند آفر صراف دیگری را مدیریت کند ─────────────
    const res17 = await authorize(uExchangerB, Permission.EXCHANGER_OFFER_MANAGE_OWN, { offerId: offerA.id });
    assert(!res17.allowed && res17.reason?.includes('UNAUTHORIZED_EXCHANGER_OFFER'), '17. Exchanger denied another exchangers offer management');

    // ─── تست ۱۸: سلب دسترسی صراف به اطلاعات محرمانه سفارشات بوست ──────────
    const res18 = await authorize(uExchangerA, Permission.ORDER_VIEW_PRIVATE, { orderId: orderAdvA.id });
    assert(!res18.allowed && res18.reason?.includes('EXCHANGER_CONFIDENTIAL_DENIED'), '18. Exchanger denied confidential boost order source information');

    // ─── تست ۱۹: دسترسی ادمین و مالک به بررسی مدارک هویتی حساس و سلب دسترسی منیجر و استاف ───────────────
    const res19Admin = await authorize(uAdmin, Permission.SENSITIVE_IDENTITY_REVIEW);
    const res19Manager = await authorize(uManager, Permission.SENSITIVE_IDENTITY_REVIEW);
    const res19Staff = await authorize(uStaff, Permission.SENSITIVE_IDENTITY_REVIEW);
    assert(res19Admin.allowed, '19a. Admin permitted for sensitive identity review');
    assert(!res19Manager.allowed && res19Manager.reason?.includes('SENSITIVE_IDENTITY_ACCESS_DENIED'), '19b. Manager denied sensitive identity review');
    assert(!res19Staff.allowed, '19c. Staff denied sensitive identity review');

    // ─── تست ۲۰: رد درخواست با تاییدیه صلاحیت معلق یا نامعتبر ─────────────
    await prisma.userGameApproval.upsert({
      where: { userId_gameSlug_serviceId_approvalType: { userId: uBooster, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster' } },
      update: { status: 'suspended' },
      create: { userId: uBooster, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster', status: 'suspended' },
    });

    const res20 = await authorize(uBooster, Permission.CLAIM_CREATE, { gameSlug: 'wow_midnight' });
    assert(!res20.allowed && res20.reason?.includes('INACTIVE_OR_MISSING_APPROVAL'), '20. Inactive/suspended approval denied');

    // ─── تست ۲۱: اجتماع نقش‌های چندگانه بدون دور زدن دامنه منبع ──────────
    // uMulti دارای هر دو نقش advertiser و booster است:
    // ۱. باید بتواند سفارش ادورتایزر ایجاد کند:
    const res21a = await authorize(uMulti, Permission.ORDER_CREATE_ADVERTISER);
    // ۲. نباید بتواند سفارش ادورتایزر B را مدیریت کند:
    const res21b = await authorize(uMulti, Permission.ORDER_ASSIGN, { orderId: orderAdvB.id });
    // ۳. نباید بتواند اتمام نهایی را تایید کند:
    const res21c = await authorize(uMulti, Permission.ORDER_FINAL_APPROVE, { orderId: orderAdvA.id });

    assert(
      res21a.allowed && !res21b.allowed && !res21c.allowed,
      '21. Multiple-role user receives the permitted union without bypassing resource scope',
    );

    // ─── تست ۲۲: رد پرش مستقیم از in_progress به completed ───────────────
    let test22Passed = false;
    try {
      validateOrderTransition('in_progress', 'completed');
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.INVALID_ORDER_TRANSITION) {
        test22Passed = true;
      }
    }
    assert(test22Passed, '22. Direct in_progress to completed transition is rejected (must go via pending_review)');

    // ─── تست ۲۳: اسکروی فاقد سفارش مرتبط مسدود می‌ماند ────────────────────
    const txNoOrder = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-PERM-NO-ORDER-TX',
        userId: uBooster,
        orderId: null, // بدون سفارش متصل
        currency: 'USD',
        amountMinor: 1000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: hundredHoursAgo,
        escrowStartAt: hundredHoursAgo,
        releaseAt: hundredHoursAgo,
      },
    });

    const elNoOrder = await checkEscrowEligibility(txNoOrder.id, { now });
    assert(
      !elNoOrder.eligible && elNoOrder.reasons.some((r) => r.includes('MISSING_ORDER_RELATION')),
      '23. Escrow with missing associated order remains strictly blocked',
    );

    // ─── تست ۲۴: تولید متادیتای ممیزی در رد دسترسی‌های حساس ───────────────
    const auditDenial = await prisma.auditLog.findFirst({
      where: {
        actorId: uStaff,
        action: 'AUTH_ORDER_PAYMENT_VERIFY_DENIED',
        isSuccess: false,
      },
    });
    assert(auditDenial !== null, '24. Permission denial generates appropriate audit metadata in audit_logs');

    // ─── تست ۲۵: خطای دیتابیس منجر به اعطای دسترسی نمی‌شود (Fail-Closed) ───
    const res25 = await authorize(
      uAdmin,
      Permission.ORDER_PAYMENT_VERIFY,
      undefined,
      {
        user: {
          findUnique: async () => {
            throw new Error('SIMULATED_DB_DISCONNECTION');
          },
        },
      } as any,
    );
    assert(
      !res25.allowed && res25.reason?.includes('DATABASE_OR_INTERNAL_ERROR'),
      '25. Authorization database failure does not grant access (Fail-Closed)',
    );

    // ─── پاک‌سازی رکوردهای تست ─────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning permission test records...');
    await prisma.ledgerTransaction.deleteMany({ where: { transactionRef: 'TEST-PERM-NO-ORDER-TX' } });
    await prisma.orderAssignment.deleteMany({ where: { orderId: { in: [orderAdvA.id, orderAdvB.id] } } });
    await prisma.orderRun.deleteMany({ where: { id: { in: [runAdvA.id, runAdvB.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [orderAdvA.id, orderAdvB.id] } } });
    await prisma.exchangerOffer.deleteMany({ where: { id: offerA.id } });
    await prisma.userGameApproval.deleteMany({ where: { userId: uBooster } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { discordId: { in: users.map((u) => u.id) } } });

    console.log(`\n=== PERMISSION TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
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

runPermissionTests();
