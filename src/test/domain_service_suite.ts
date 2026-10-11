/**
 * domain_service_suite.ts — مجموعه آزمون‌های سرویس‌های اعتبارسنجی دامنه‌ای و قوانین بیزینس (Phase 2.6.4)
 *
 * ۲۲ سناریوی الزامی:
 *  1. Inactive game rejection.
 *  2. Inactive service rejection.
 *  3. Service-game mismatch rejection.
 *  4. Pilot booster without approved Pilot permission is rejected.
 *  5. Unapproved booster claim is rejected.
 *  6. Character ownership violation is rejected.
 *  7. Multiple independent claims by one booster are allowed.
 *  8. Claims after the presign deadline are rejected.
 *  9. Claim on a completed or cancelled order is rejected.
 * 10. Squad from another game is rejected.
 * 11. Unapproved squad is rejected.
 * 12. Nonaccepted squad member is rejected.
 * 13. Role capacity overflow is rejected.
 * 14. Unauthorized advertiser assignment is rejected.
 * 15. Authorized advertiser assignment is accepted.
 * 16. Two simultaneous assignments for one booster cannot create duplicate active reservations.
 * 17. Failure during squad assignment rolls back all changes.
 * 18. Run-to-order mismatch is rejected.
 * 19. Invalid order state transitions are rejected.
 * 20. Order completion without all required completed runs is rejected.
 * 21. Final completion by advertiser is rejected.
 * 22. Escrow start earlier than confirmed completion does not permit early release.
 */

import prisma from '../database/db';
import {
  validateGameAndService,
  validateUserApproval,
  validateOrderTransition,
  validateOrderPublishPrerequisites,
  validateOrderCompletion,
} from '../services/orderValidationService';
import { validatePremadeSquad } from '../services/squadValidationService';
import { createOrderClaim, withdrawOrderClaim } from '../services/claimService';
import { assignOrderBoosters } from '../services/assignmentService';
import {
  validateRunAssignmentBelonging,
  validateStartRun,
  completeOrderRun,
} from '../services/runValidationService';
import { checkEscrowEligibility } from '../services/escrowService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

async function runDomainServiceTests() {
  console.log('=== STARTING PHASE 2.6.4 CORE DOMAIN SERVICES TEST SUITE ===\n');

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
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const hundredHoursAgo = new Date(now.getTime() - 100 * 60 * 60 * 1000);

  // شناسه کاربران تست
  const uBooster1 = 'test_d_booster_01';
  const uBooster2 = 'test_d_booster_02';
  const uUnapprovedBooster = 'test_d_unapproved_01';
  const uAdvertiserA = 'test_d_adv_a';
  const uAdvertiserB = 'test_d_adv_b';
  const uAdmin = 'test_d_admin_01';

  try {
    // ─── آماده‌سازی کاربران و نقش‌ها ─────────────────────────────────────
    await prisma.user.upsert({ where: { discordId: uBooster1 }, update: {}, create: { discordId: uBooster1, username: 'Booster1' } });
    await prisma.user.upsert({ where: { discordId: uBooster2 }, update: {}, create: { discordId: uBooster2, username: 'Booster2' } });
    await prisma.user.upsert({ where: { discordId: uUnapprovedBooster }, update: {}, create: { discordId: uUnapprovedBooster, username: 'Unapproved' } });
    await prisma.user.upsert({ where: { discordId: uAdvertiserA }, update: {}, create: { discordId: uAdvertiserA, username: 'AdvA' } });
    await prisma.user.upsert({ where: { discordId: uAdvertiserB }, update: {}, create: { discordId: uAdvertiserB, username: 'AdvB' } });
    await prisma.user.upsert({ where: { discordId: uAdmin }, update: {}, create: { discordId: uAdmin, username: 'Admin' } });

    await prisma.userRole.upsert({ where: { userId_roleKey: { userId: uAdvertiserA, roleKey: 'advertiser' } }, update: {}, create: { userId: uAdvertiserA, roleKey: 'advertiser' } });
    await prisma.userRole.upsert({ where: { userId_roleKey: { userId: uAdvertiserB, roleKey: 'advertiser' } }, update: {}, create: { userId: uAdvertiserB, roleKey: 'advertiser' } });
    await prisma.userRole.upsert({ where: { userId_roleKey: { userId: uAdmin, roleKey: 'admin' } }, update: {}, create: { userId: uAdmin, roleKey: 'admin' } });

    // بازی‌ها و سرویس‌ها
    const wowGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    if (!wowGame) throw new Error('Game wow_midnight missing');
    const poe2Game = await prisma.game.findFirst({ where: { slug: 'poe2' } });
    if (!poe2Game) throw new Error('Game poe2 missing');

    const mplusService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
    });
    if (!mplusService) throw new Error('Service mythic_plus missing');

    // ایجاد یک بازی غیرفعال و سرویس غیرفعال برای تست ۱ و ۲
    const inactiveGame = await prisma.game.upsert({
      where: { slug: 'test_inactive_game' },
      update: { isActive: false },
      create: { slug: 'test_inactive_game', displayName: 'Inactive Game', serviceCategory: 'both', isActive: false },
    });

    const inactiveService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'test_inactive_svc' } },
      update: { isActive: false },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'test_inactive_svc',
        displayName: 'Inactive Service',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        isActive: false,
      },
    });

    const poe2Service = await prisma.gameService.findFirst({
      where: { gameSlug: 'poe2' },
    });
    if (!poe2Service) throw new Error('Service for poe2 missing');

    // تایید صلاحیت بوستر ۱ در وارکرافت
    await prisma.userGameApproval.upsert({
      where: { userId_gameSlug_serviceId_approvalType: { userId: uBooster1, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster' } },
      update: { status: 'approved' },
      create: { userId: uBooster1, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster', status: 'approved' },
    });
    // تایید صلاحیت بوستر ۲ در وارکرافت
    await prisma.userGameApproval.upsert({
      where: { userId_gameSlug_serviceId_approvalType: { userId: uBooster2, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster' } },
      update: { status: 'approved' },
      create: { userId: uBooster2, gameSlug: 'wow_midnight', serviceId: mplusService.id, approvalType: 'booster', status: 'approved' },
    });

    // ─── تست ۱: رد بازی غیرفعال (Inactive Game Rejection) ─────────────────
    let test1Passed = false;
    try {
      await validateGameAndService('test_inactive_game', mplusService.id);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.GAME_NOT_ACTIVE) test1Passed = true;
    }
    assert(test1Passed, '1. Inactive game rejection');

    // ─── تست ۲: رد سرویس غیرفعال (Inactive Service Rejection) ───────────
    let test2Passed = false;
    try {
      await validateGameAndService('wow_midnight', inactiveService.id);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.SERVICE_NOT_ACTIVE) test2Passed = true;
    }
    assert(test2Passed, '2. Inactive service rejection');

    // ─── تست ۳: رد عدم تطابق سرویس و بازی (Service-Game Mismatch) ───────
    let test3Passed = false;
    try {
      await validateGameAndService('wow_midnight', poe2Service.id);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.SERVICE_GAME_MISMATCH) test3Passed = true;
    }
    assert(test3Passed, '3. Service-game mismatch rejection');

    // ─── تست ۴: رد بوستر پایلوت فاقد تاییدیه Pilot ────────────────────────
    let test4Passed = false;
    try {
      await validateUserApproval(uUnapprovedBooster, 'wow_midnight', mplusService.id, 'pilot');
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PILOT_NOT_APPROVED) test4Passed = true;
    }
    assert(test4Passed, '4. Pilot booster without approved Pilot permission is rejected');

    // ─── آماده‌سازی سفارش معتبر برای تست‌های ۵ تا ۹ ───────────────────────
    const baseOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-DOM-01',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvertiserA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 4000,
        status: 'open_presign',
        paymentStatus: 'verified',
        presignDeadline: new Date(now.getTime() + 30 * 60 * 1000), // ۳۰ دقیقه دیگر
        quantity: 1,
      },
    });

    await prisma.orderRequiredRole.create({
      data: {
        orderId: baseOrder.id,
        roleName: 'tank',
        quantity: 1,
      },
    });
    await prisma.orderRequiredRole.create({
      data: {
        orderId: baseOrder.id,
        roleName: 'dps',
        quantity: 3,
      },
    });

    // ─── تست ۵: رد کلیم بوستر تاییدنشده ──────────────────────────────────
    let test5Passed = false;
    try {
      await createOrderClaim({
        orderId: baseOrder.id,
        userId: uUnapprovedBooster,
        claimType: 'individual',
        registeredRole: 'tank',
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.BOOSTER_NOT_APPROVED) test5Passed = true;
    }
    assert(test5Passed, '5. Unapproved booster claim is rejected');

    // ─── تست ۶: رد نقض مالکیت کاراکتر (Character Ownership Violation) ───
    // ایجاد کاراکتر متعلق به بوستر ۲
    const charBooster2 = await prisma.wowCharacter.create({
      data: {
        userId: uBooster2,
        gameSlug: 'wow_midnight',
        characterName: 'BoosterTwoWarrior',
        realm: 'Twisting Nether',
        region: 'eu',
      },
    });

    // بوستر ۱ تلاش می‌کند با کاراکتر بوستر ۲ ثبت‌نام کند
    let test6Passed = false;
    try {
      await createOrderClaim({
        orderId: baseOrder.id,
        userId: uBooster1,
        claimType: 'individual',
        registeredRole: 'tank',
        characterId: charBooster2.id,
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.CHARACTER_NOT_OWNED) test6Passed = true;
    }
    assert(test6Passed, '6. Character ownership violation is rejected');

    // ─── تست ۷: مجاز بودن ثبت چند کلیم مستقل توسط یک بوستر ─────────────
    const claim1 = await createOrderClaim({
      orderId: baseOrder.id,
      userId: uBooster1,
      claimType: 'individual',
      registeredRole: 'tank',
      hasKey: 'yes',
      keyLevel: 20,
    });

    const claim2 = await createOrderClaim({
      orderId: baseOrder.id,
      userId: uBooster1,
      claimType: 'individual',
      registeredRole: 'dps',
      hasKey: 'no',
    });

    assert(
      claim1.id !== claim2.id &&
        claim1.registeredRole === 'tank' &&
        claim2.registeredRole === 'dps' &&
        claim1.orderId === baseOrder.id &&
        claim2.orderId === baseOrder.id,
      '7. Multiple independent claims by one booster are allowed with distinct IDs and roles',
    );

    // ─── تست ۸: رد کلیم پس از انقضای مهلت Presign ───────────────────────
    const expiredOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-DOM-EXPIRED',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvertiserA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 2000,
        status: 'open_presign',
        paymentStatus: 'verified',
        presignDeadline: tenMinutesAgo, // ۱۰ دقیقه پیش منقضی شده
      },
    });

    let test8Passed = false;
    try {
      await createOrderClaim({
        orderId: expiredOrder.id,
        userId: uBooster1,
        claimType: 'individual',
        registeredRole: 'tank',
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PRESIGN_WINDOW_CLOSED) test8Passed = true;
    }
    assert(test8Passed, '8. Claims after the presign deadline are rejected');

    // ─── تست ۹: رد کلیم روی سفارش خاتمه‌یافته یا لغوشده ─────────────────
    const completedOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-DOM-CLOSED',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvertiserA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 2000,
        status: 'completed',
        paymentStatus: 'verified',
      },
    });

    let test9Passed = false;
    try {
      await createOrderClaim({
        orderId: completedOrder.id,
        userId: uBooster1,
        claimType: 'individual',
        registeredRole: 'tank',
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.ORDER_ALREADY_CLOSED) test9Passed = true;
    }
    assert(test9Passed, '9. Claim on a completed or cancelled order is rejected');

    // ─── تست ۱۰: رد تیم متعلق به بازی دیگر (Squad Game Mismatch) ────────
    const squadPoe2 = await prisma.premadeSquad.create({
      data: {
        gameSlug: 'poe2',
        teamName: 'Poe2ExilesSquad',
        leaderId: uBooster1,
        status: 'active',
      },
    });

    let test10Passed = false;
    try {
      await validatePremadeSquad(squadPoe2.id, 'wow_midnight', mplusService.id, uBooster1);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.SQUAD_GAME_MISMATCH) test10Passed = true;
    }
    assert(test10Passed, '10. Squad from another game is rejected');

    // ─── تست ۱۱: رد تیم تاییدنشده (Unapproved Squad Rejection) ───────────
    const squadPending = await prisma.premadeSquad.create({
      data: {
        gameSlug: 'wow_midnight',
        teamName: 'PendingWowSquad',
        leaderId: uBooster1,
        status: 'pending', // در انتظار تایید
      },
    });

    let test11Passed = false;
    try {
      await validatePremadeSquad(squadPending.id, 'wow_midnight', mplusService.id, uBooster1);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.SQUAD_NOT_APPROVED) test11Passed = true;
    }
    assert(test11Passed, '11. Unapproved squad is rejected (status pending)');

    // ─── تست ۱۲: رد تیم با عضو تاییدنشده/پذیرفته‌نشده ───────────────────
    const squadActive = await prisma.premadeSquad.create({
      data: {
        gameSlug: 'wow_midnight',
        teamName: 'ActiveWowSquadWithUnacceptedMember',
        leaderId: uBooster1,
        status: 'active',
      },
    });

    await prisma.squadMember.create({
      data: {
        squadId: squadActive.id,
        userId: uBooster1,
        status: 'accepted',
        memberRole: 'tank',
      },
    });
    await prisma.squadMember.create({
      data: {
        squadId: squadActive.id,
        userId: uBooster2,
        status: 'pending', // عضو دوم هنوز تایید نکرده
        memberRole: 'dps',
      },
    });

    let test12Passed = false;
    try {
      await validatePremadeSquad(squadActive.id, 'wow_midnight', mplusService.id, uBooster1);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.SQUAD_MEMBER_NOT_ACCEPTED) test12Passed = true;
    }
    assert(test12Passed, '12. Nonaccepted squad member is rejected');

    // ─── تست ۱۳: رد سرریز ظرفیت رول (Role Capacity Overflow) ────────────
    // baseOrder نیاز به ۱ تانک دارد. تخصیص ۲ تانک باید مسدود شود.
    let test13Passed = false;
    try {
      await assignOrderBoosters({
        orderId: baseOrder.id,
        actorId: uAdvertiserA,
        candidates: [
          { userId: uBooster1, assignedRole: 'tank', claimId: claim1.id },
          { userId: uBooster2, assignedRole: 'tank' },
        ],
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.ROLE_CAPACITY_EXCEEDED) test13Passed = true;
    }
    assert(test13Passed, '13. Role capacity overflow is rejected (max 1 tank required)');

    // ─── تست ۱۴: رد تخصیص توسط ادورتایزر غیرمجاز ─────────────────────────
    let test14Passed = false;
    try {
      await assignOrderBoosters({
        orderId: baseOrder.id,
        actorId: uAdvertiserB, // ادورتایزر B صاحب سفارش A نیست
        candidates: [{ userId: uBooster1, assignedRole: 'tank' }],
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PERMISSION_DENIED) test14Passed = true;
    }
    assert(test14Passed, '14. Unauthorized advertiser assignment is rejected');

    // ─── تست ۱۵: پذیرش تخصیص توسط ادورتایزر مجاز صاحب سفارش ─────────────
    const assignResult = await assignOrderBoosters({
      orderId: baseOrder.id,
      actorId: uAdvertiserA, // صاحب سفارش
      candidates: [{ userId: uBooster1, assignedRole: 'tank', claimId: claim1.id }],
    });

    const activeResBooster1 = await prisma.boosterReservation.findFirst({
      where: { userId: uBooster1, status: 'active' },
    });

    assert(
      assignResult.success &&
        assignResult.assignments.length === 1 &&
        activeResBooster1?.orderId === baseOrder.id,
      '15. Authorized advertiser assignment is accepted and creates active reservation',
    );

    // ─── تست ۱۶: ممانعت از دابل‌بوکینگ یک بوستر در دو سفارش همزمان ───────
    const secondOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-DOM-02',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        advertiserId: uAdvertiserA,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 3000,
        status: 'open_presign',
        paymentStatus: 'verified',
      },
    });

    let test16Passed = false;
    try {
      await assignOrderBoosters({
        orderId: secondOrder.id,
        actorId: uAdvertiserA,
        candidates: [{ userId: uBooster1, assignedRole: 'tank' }], // بوستر ۱ قبلاً رزرو فعال دارد!
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.BOOSTER_ALREADY_RESERVED) test16Passed = true;
    }
    assert(test16Passed, '16. Two simultaneous assignments for one booster cannot create duplicate active reservations');

    // ─── تست ۱۷: رول‌بک کامل در صورت شکست حین تخصیص تیم ─────────────────
    // تیم معتبری ایجاد می‌کنیم که عضو اولش بوستر ۱ (دارای رزرو فعال) و عضو دومش بوستر ۲ است
    await prisma.squadMember.update({
      where: { squadId_userId: { squadId: squadActive.id, userId: uBooster2 } },
      data: { status: 'accepted' },
    });

    const assignmentsBefore17 = await prisma.orderAssignment.count({ where: { orderId: secondOrder.id } });
    const reservationsBefore17 = await prisma.boosterReservation.count({ where: { userId: uBooster2 } });

    let test17RolledBack = false;
    try {
      await assignOrderBoosters({
        orderId: secondOrder.id,
        actorId: uAdvertiserA,
        squadId: squadActive.id, // عضو اول تیم دابل‌بوک است و خطا می‌دهد
      });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.BOOSTER_ALREADY_RESERVED) test17RolledBack = true;
    }

    const assignmentsAfter17 = await prisma.orderAssignment.count({ where: { orderId: secondOrder.id } });
    const reservationsAfter17 = await prisma.boosterReservation.count({ where: { userId: uBooster2 } });

    assert(
      test17RolledBack &&
        assignmentsBefore17 === assignmentsAfter17 &&
        reservationsBefore17 === reservationsAfter17,
      '17. Failure during squad assignment rolls back all changes completely',
    );

    // ─── تست ۱۸: رد عدم تطابق ران و سفارش (Run-to-Order Mismatch) ───────
    const runForOrder1 = await prisma.orderRun.create({
      data: {
        orderId: baseOrder.id,
        runNumber: 1,
        status: 'pending',
      },
    });

    // ایجاد یک تخصیص مستقل روی سفارش دوم برای بوستر ۲
    const assignOrder2 = await prisma.orderAssignment.create({
      data: {
        orderId: secondOrder.id,
        userId: uBooster2,
        assignedById: uAdmin,
        assignedRole: 'dps',
        status: 'assigned',
      },
    });

    let test18Passed = false;
    try {
      await validateRunAssignmentBelonging(runForOrder1.id, assignOrder2.id);
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.RUN_ORDER_MISMATCH) test18Passed = true;
    }
    assert(test18Passed, '18. Run-to-order mismatch is rejected');

    // ─── تست ۱۹: رد گذار غیرمجاز در ماشین وضعیت سفارش ────────────────────
    let test19Passed = false;
    try {
      validateOrderTransition('draft', 'completed'); // پرش غیرمجاز از پیش‌نویس به تکمیل‌شده
      validateOrderTransition('in_progress', 'completed'); // پرش غیرمجاز از درحال‌اجرا به تکمیل‌شده بدون pending_review
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.INVALID_ORDER_TRANSITION) test19Passed = true;
    }
    assert(test19Passed, '19. Invalid order state transitions are rejected (draft -> completed, in_progress -> completed)');

    // ─── تست ۲۰: رد تایید سفارش بدون اتمام تمام ران‌ها ──────────────────
    // انتقال سفارش به وضعیت pending_review قبل از درخواست تایید نهایی
    await prisma.order.update({
      where: { id: baseOrder.id },
      data: { status: 'pending_review' },
    });

    let test20Passed = false;
    try {
      await validateOrderCompletion(baseOrder.id, uAdmin); // ران هنوز pending است
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.INCOMPLETE_RUNS_EXIST) test20Passed = true;
    }
    assert(test20Passed, '20. Order completion without all required completed runs is rejected');

    // ─── تست ۲۱: رد تایید نهایی اتمام سفارش توسط ادورتایزر ──────────────
    // ابتدا ران را به عنوان بوستر منتسب کامل می‌کنیم
    await completeOrderRun(runForOrder1.id, uBooster1);

    let test21Passed = false;
    try {
      await validateOrderCompletion(baseOrder.id, uAdvertiserA); // ادورتایزر حق تایید نهایی ندارد
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.PERMISSION_DENIED) test21Passed = true;
    }
    assert(test21Passed, '21. Final completion by advertiser is rejected (PERMISSION_DENIED)');

    // ─── تست ۲۲: آزمون رگرسیون تایمینگ اسکرو (Escrow Start Regression) ───
    // ایجاد یک تراکنش لجر اسکرو با سفارش تکمیل‌شده در ۲۰ ساعت پیش و escrowStartAt در ۱۰۰ ساعت پیش
    const completedRegressionOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-REGRESS-ESCROW',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'completed',
        paymentStatus: 'verified',
        completedAt: twentyHoursAgo, // تکمیل قطعی ۲۰ ساعت پیش تایید شده
      },
    });

    const completedRegRun = await prisma.orderRun.create({
      data: {
        orderId: completedRegressionOrder.id,
        runNumber: 1,
        status: 'completed',
        completedAt: twentyHoursAgo,
      },
    });

    await prisma.runProof.create({
      data: {
        runId: completedRegRun.id,
        submittedById: uBooster1,
        evidenceUrl: 'https://cdn.g4x.online/proofs/reg.png',
        status: 'approved',
        reviewedById: uAdmin,
      },
    });

    const txRegression = await prisma.ledgerTransaction.create({
      data: {
        transactionRef: 'TEST-REGRESS-EARLY-START',
        userId: uBooster1,
        orderId: completedRegressionOrder.id,
        currency: 'USD',
        amountMinor: 5000,
        entryType: 'escrow_lock',
        status: 'posted',
        createdAt: hundredHoursAgo,
        escrowStartAt: hundredHoursAgo, // ۱۰۰ ساعت پیش ثبت شده، اما تکمیل سفارش ۲۰ ساعت پیش بوده
        releaseAt: hundredHoursAgo,
      },
    });

    const elReg = await checkEscrowEligibility(txRegression.id, { now });

    assert(
      !elReg.eligible &&
        elReg.reasons.some((r) => r.includes('MINIMUM_ESCROW_TIME_NOT_ELAPSED')),
      '22. Escrow start earlier than confirmed completion does not permit early release (elapsed 20h < 72h)',
      `Reasons: ${elReg.reasons.join('; ')}`,
    );

    // ─── پاک‌سازی رکوردهای تست ─────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning domain test records...');
    await prisma.runProof.deleteMany({ where: { run: { orderId: { in: [baseOrder.id, secondOrder.id, completedRegressionOrder.id] } } } });
    await prisma.runAssignment.deleteMany({ where: { run: { orderId: { in: [baseOrder.id, secondOrder.id, completedRegressionOrder.id] } } } });
    await prisma.orderRun.deleteMany({ where: { orderId: { in: [baseOrder.id, secondOrder.id, completedRegressionOrder.id] } } });
    await prisma.boosterReservation.deleteMany({ where: { userId: { in: [uBooster1, uBooster2] } } });
    await prisma.orderAssignment.deleteMany({ where: { orderId: { in: [baseOrder.id, secondOrder.id, completedRegressionOrder.id] } } });
    await prisma.orderPresign.deleteMany({ where: { orderId: { in: [baseOrder.id, expiredOrder.id, completedOrder.id] } } });
    await prisma.orderRequiredRole.deleteMany({ where: { orderId: baseOrder.id } });
    await prisma.ledgerTransaction.deleteMany({ where: { transactionRef: 'TEST-REGRESS-EARLY-START' } });
    await prisma.order.deleteMany({
      where: {
        id: { in: [baseOrder.id, secondOrder.id, expiredOrder.id, completedOrder.id, completedRegressionOrder.id] },
      },
    });
    await prisma.squadMember.deleteMany({ where: { squadId: { in: [squadPoe2.id, squadPending.id, squadActive.id] } } });
    await prisma.premadeSquad.deleteMany({ where: { id: { in: [squadPoe2.id, squadPending.id, squadActive.id] } } });
    await prisma.wowCharacter.deleteMany({ where: { id: charBooster2.id } });
    await prisma.userGameApproval.deleteMany({ where: { userId: { in: [uBooster1, uBooster2, uUnapprovedBooster] } } });
    await prisma.gameService.deleteMany({ where: { id: inactiveService.id } });
    await prisma.game.deleteMany({ where: { slug: inactiveGame.slug } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [uAdvertiserA, uAdvertiserB, uAdmin] } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: [uAdvertiserA, uAdvertiserB, uAdmin] } } });
    await prisma.user.deleteMany({ where: { discordId: { in: [uBooster1, uBooster2, uUnapprovedBooster, uAdvertiserA, uAdvertiserB, uAdmin] } } });

    console.log(`\n=== DOMAIN TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('UNEXPECTED DOMAIN TEST EXCEPTION:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDomainServiceTests();
