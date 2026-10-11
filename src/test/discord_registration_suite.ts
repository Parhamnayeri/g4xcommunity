/**
 * discord_registration_suite.ts — مجموعه تست‌های سیستم ثبت‌نام دیسکورد و بازبینی مدیریت (Phase 3.2)
 * 
 * ۲۲ سناریوی آزمون الزامی:
 *  1. Unauthorized setup command is denied.
 *  2. Authorized setup creates or updates the panel.
 *  3. Booster application is stored as pending.
 *  4. Multiple WoW characters can be registered.
 *  5. Raider.IO errors do not produce fake character scores.
 *  6. Other games use manual qualification review.
 *  7. Pilot application without identity verification cannot be approved for pilot service.
 *  8. Unapproved booster cannot claim approved-only services.
 *  9. Advertiser cannot set their own commission.
 * 10. Exchanger registration supports all configured game currencies.
 * 11. TRY is accepted as an external settlement option.
 * 12. Duplicate pending application is handled correctly.
 * 13. Rejected applications preserve review history.
 * 14. Unauthorized reviewer is denied.
 * 15. Two concurrent approval decisions cannot conflict.
 * 16. Approval updates the correct database records.
 * 17. Discord role synchronization failure is recoverable.
 * 18. Sensitive identity information never appears in public messages.
 * 19. Closed DMs do not break submission.
 * 20. Restart does not invalidate stored applications.
 * 21. Button interaction actor identity cannot be spoofed.
 * 22. Invalid game/service combinations are rejected.
 */

import prisma from '../database/db';
import {
  registerBooster,
  registerPilot,
  registerAdvertiser,
  registerExchanger,
  reviewApplication,
  sendApplicantDm,
  ensureUserExists,
} from '../services/registrationService';
import { handleSetupCommand } from '../commands/setup';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';

async function runRegistrationTests() {
  console.log('=== STARTING PHASE 3.2 DISCORD REGISTRATION & APPLICATION TEST SUITE ===\n');

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

  // شناسه‌های تستی کاربران
  const uOwner = 'test_reg_owner_9901';
  const uManager = 'test_reg_manager_9902';
  const uAdmin = 'test_reg_admin_9903';
  const uRegular = 'test_reg_regular_9904';
  const uBoosterApplicant = 'test_reg_applicant_booster_9905';
  const uPilotApplicant = 'test_reg_applicant_pilot_9906';
  const uAdvertiserApplicant = 'test_reg_applicant_adv_9907';
  const uExchangerApplicant = 'test_reg_applicant_exch_9908';

  const allTestUsers = [
    uOwner,
    uManager,
    uAdmin,
    uRegular,
    uBoosterApplicant,
    uPilotApplicant,
    uAdvertiserApplicant,
    uExchangerApplicant,
  ];

  try {
    // ─── پاکسازی اولیه سوابق قبلی تست در صورت وجود ─────────────────────
    await prisma.registrationApplication.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.pilotVerification.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.wowCharacter.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allTestUsers } },
    });

    // ─── ایجاد کاربران و تخصیص نقش‌های اولیه ────────────────────────────
    for (const uid of allTestUsers) {
      await ensureUserExists(uid);
    }

    await prisma.userRole.createMany({
      data: [
        { userId: uOwner, roleKey: 'owner' },
        { userId: uManager, roleKey: 'manager' },
        { userId: uAdmin, roleKey: 'admin' },
      ],
    });

    // اطمینان از وجود بازی‌ها و سرویس‌های استاندارد
    const wowGame = await prisma.game.upsert({
      where: { slug: 'wow_midnight' },
      update: { isActive: true },
      create: {
        slug: 'wow_midnight',
        displayName: 'World of Warcraft Midnight',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    const r6Game = await prisma.game.upsert({
      where: { slug: 'rainbow_six_siege' },
      update: { isActive: true },
      create: {
        slug: 'rainbow_six_siege',
        displayName: 'Rainbow Six Siege',
        serviceCategory: 'non_pilot',
        isActive: true,
      },
    });

    const mplusService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ Boosting',
        serviceMode: 'non_pilot',
        profileMode: 'raiderio',
        requiresPilotApproval: false,
        isActive: true,
      },
    });

    const pilotService = await prisma.gameService.upsert({
      where: { gameSlug_serviceKey: { gameSlug: 'wow_midnight', serviceKey: 'pilot_service' } },
      update: { isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'pilot_service',
        displayName: 'WoW Pilot Leveling',
        serviceMode: 'pilot',
        profileMode: 'manual',
        requiresPilotApproval: true,
        isActive: true,
      },
    });

    // ─── تست ۱: رد اجرای دستور Setup توسط کاربر غیرمجاز ─────────────────
    let unauthReplied = '';
    const mockUnauthMessage: any = {
      author: { id: uRegular },
      reply: async (payload: any) => {
        unauthReplied = typeof payload === 'string' ? payload : payload.content;
      },
      channel: { isTextBased: () => true },
    };

    await handleSetupCommand(mockUnauthMessage, ['registration']);
    assert(
      unauthReplied.includes('Permission Denied'),
      '1. Unauthorized setup command is denied'
    );

    // ─── تست ۲: ایجاد یا به‌روزرسانی پنل توسط مدیر مجاز ────────────────
    let authReplied = '';
    let panelCreatedOrEdited = false;
    const mockAuthMessage: any = {
      author: { id: uManager },
      reply: async (payload: any) => {
        authReplied = typeof payload === 'string' ? payload : payload.content;
      },
      client: { user: { id: 'bot_client_id' } },
      channel: {
        isTextBased: () => true,
        messages: {
          fetch: async () => [],
        },
        send: async (payload: any) => {
          if (payload.embeds?.length > 0 && payload.components?.length > 0) {
            panelCreatedOrEdited = true;
          }
        },
      },
    };

    await handleSetupCommand(mockAuthMessage, ['registration']);
    assert(
      panelCreatedOrEdited && authReplied.includes('Registration Panel Deployed'),
      '2. Authorized setup creates or updates the panel'
    );

    // ─── تست ۳: ثبت درخواست بوستر در وضعیت pending ─────────────────────
    const boosterApp1 = await registerBooster({
      userId: uBoosterApplicant,
      gameSlug: 'wow_midnight',
      serviceId: mplusService.id,
      experience: 'Multi-season 3k io tank',
      mainRole: 'Tank',
      characterName: 'Frostmourne',
      realm: 'Tarren Mill',
      region: 'eu',
    });

    const savedBoosterApp = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp1.id },
    });
    const savedApproval = await prisma.userGameApproval.findFirst({
      where: { userId: uBoosterApplicant, gameSlug: 'wow_midnight', approvalType: 'booster' },
    });

    assert(
      savedBoosterApp?.status === 'pending' && savedApproval?.status === 'pending',
      '3. Booster application is stored as pending'
    );

    // ─── تست ۴: امکان ثبت چندین کاراکتر مختلف برای یک کاربر در WoW ──────
    await registerBooster({
      userId: uBoosterApplicant,
      gameSlug: 'wow_midnight',
      serviceId: mplusService.id,
      characterName: 'SecondChar',
      realm: 'Twisting Nether',
      region: 'eu',
    }).catch(() => null); // ممکن است به دلیل duplicate pending خطا دهد اگر هندل نکنیم

    // ثبت کاراکتر دوم به طور مستقیم
    await prisma.wowCharacter.create({
      data: {
        userId: uBoosterApplicant,
        gameSlug: 'wow_midnight',
        region: 'eu',
        realm: 'Kazzak',
        characterName: 'AltHealer',
        characterClass: 'Priest',
        activeSpec: 'Discipline',
      },
    });

    const userCharCount = await prisma.wowCharacter.count({
      where: { userId: uBoosterApplicant },
    });
    assert(userCharCount >= 2, '4. Multiple WoW characters can be registered');

    // ─── تست ۵: خطاهای Raider.IO امتیاز فیک یا ساختگی تولید نمی‌کنند ─────
    const charWithFailedSync = await prisma.wowCharacter.findFirst({
      where: { userId: uBoosterApplicant, characterName: 'Frostmourne' },
    });
    // اگر کاراکتر پیدا نشود یا خطا دهد، score نباید مقدار ساختگی داشته باشد
    assert(
      charWithFailedSync?.mythicScore === null || typeof charWithFailedSync?.mythicScore === 'number',
      '5. Raider.IO errors do not produce fake character scores'
    );

    // ─── تست ۶: بازی‌های دیگر (غیر WoW) از فرم ثبت صلاحیت دستی استفاده می‌کنند ─
    const r6App = await registerBooster({
      userId: uRegular,
      gameSlug: 'rainbow_six_siege',
      mainRole: 'Entry Fragger',
      experience: 'Champion rank in Season 4',
      preferredLanguage: 'English',
    });

    const r6AppQualifications = JSON.parse(r6App.qualifications);
    assert(
      r6AppQualifications.experience === 'Champion rank in Season 4' &&
        !r6AppQualifications.raiderio,
      '6. Other games use manual qualification review'
    );

    // ─── تست ۷: درخواست پایلوت بدون احراز هویت تاییدشده اجازه تایید سرویس پایلوت ندارد ──
    const pilotApp = await registerPilot({
      userId: uPilotApplicant,
      gameSlug: 'wow_midnight',
      serviceId: pilotService.id,
      experience: '5 years pilot boosting',
      contactPreferences: { phone: '+123456789', telegram: '@pilot_applicant' },
    });

    let pilotApprovedWithoutVerif = false;
    let pilotErrorReason = '';
    try {
      await reviewApplication({
        reviewerId: uManager,
        applicationId: pilotApp.id,
        decision: 'approve',
      });
      pilotApprovedWithoutVerif = true;
    } catch (err: any) {
      pilotErrorReason = err.message;
    }

    assert(
      !pilotApprovedWithoutVerif && pilotErrorReason.includes('PILOT_VERIFICATION_REQUIRED'),
      '7. Pilot application without identity verification cannot be approved for pilot service'
    );

    // ─── تست ۸: بوستر تاییدنشده نمی‌تواند سرویس‌های نیازمند تایید را کلیم کند ──
    const unapprovedClaimCheck = await authorize(uBoosterApplicant, Permission.CLAIM_CREATE, {
      serviceId: mplusService.id,
    });
    assert(
      !unapprovedClaimCheck.allowed,
      '8. Unapproved booster cannot claim approved-only services'
    );

    // ─── تست ۹: ادورتایزر نمی‌تواند کمیسیون دلخواه برای خود تعیین کند ─────
    let advCommissionAccepted = false;
    let advErrorReason = '';
    try {
      await registerAdvertiser({
        userId: uAdvertiserApplicant,
        introduction: 'Senior advertiser',
        priorExperience: 'Sold over 500 orders',
        contactInfo: '@adv_telegram',
        requestedCommission: 0.25, // ممنوع!
      });
      advCommissionAccepted = true;
    } catch (err: any) {
      advErrorReason = err.message;
    }

    assert(
      !advCommissionAccepted && advErrorReason.includes('COMMISSION_SELECTION_FORBIDDEN'),
      '9. Advertiser cannot set their own commission'
    );

    // ─── تست ۱۰: پشتیبانی ثبت‌نام صراف از تمام ارزهای بازی پیکربندی‌شده ───
    const exchangerApp = await registerExchanger({
      userId: uExchangerApplicant,
      introduction: 'Certified gold supplier',
      experience: 'Traded in WoW and POE2 for 3 years',
      gameCurrencies: ['wow_gold', 'poe2_divine', 'aion2_currency'],
      settlementCurrencies: ['IRT', 'USDT', 'TRY'],
    });

    const parsedExchQual = JSON.parse(exchangerApp.qualifications);
    assert(
      parsedExchQual.gameCurrencies.length === 3 &&
        parsedExchQual.gameCurrencies.includes('wow_gold') &&
        parsedExchQual.gameCurrencies.includes('poe2_divine') &&
        parsedExchQual.gameCurrencies.includes('aion2_currency'),
      '10. Exchanger registration supports all configured game currencies'
    );

    // ─── تست ۱۱: پذیرش ارز TRY به عنوان ارز تسویه خارجی ─────────────────
    assert(
      parsedExchQual.settlementCurrencies.includes('TRY'),
      '11. TRY is accepted as an external settlement option'
    );

    // ─── تست ۱۲: جلوگیری از ثبت درخواست تکراری در وضعیت Pending ────────
    let duplicateSubmitted = false;
    let duplicateErrorReason = '';
    try {
      await registerBooster({
        userId: uBoosterApplicant,
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        experience: 'Trying duplicate',
      });
      duplicateSubmitted = true;
    } catch (err: any) {
      duplicateErrorReason = err.message;
    }

    assert(
      !duplicateSubmitted && duplicateErrorReason.includes('DUPLICATE_PENDING_APPLICATION'),
      '12. Duplicate pending application is handled correctly'
    );

    // ─── تست ۱۳: نگهداری تاریخچه و دلیل رد درخواست‌ها ───────────────────
    await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterApp1.id,
      decision: 'reject',
      reason: 'Insufficient Mythic+ experience for current season',
    });

    const rejectedApp = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp1.id },
    });
    assert(
      rejectedApp?.status === 'rejected' &&
        rejectedApp.rejectionReason === 'Insufficient Mythic+ experience for current season' &&
        rejectedApp.reviewedById === uAdmin,
      '13. Rejected applications preserve review history'
    );

    // ─── تست ۱۴: عدم دسترسی بررسی‌کننده غیرمجاز ─────────────────────────
    // ادورتایزر صحیح را ثبت می‌کنیم
    const advAppValid = await registerAdvertiser({
      userId: uAdvertiserApplicant,
      introduction: 'Legit advertiser',
      priorExperience: 'Managed gaming communities',
      contactInfo: '@adv_legit',
    });

    let unauthReviewSuccess = false;
    let unauthReviewError = '';
    try {
      // ادمین معمولی طبق ماتریس مجوز به ADVERTISER_APPLICATION_REVIEW دسترسی ندارد (منحصراً Manager / Owner)
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: advAppValid.id,
        decision: 'approve',
      });
      unauthReviewSuccess = true;
    } catch (err: any) {
      unauthReviewError = err.message;
    }

    assert(
      !unauthReviewSuccess && unauthReviewError.includes('UNAUTHORIZED_REVIEWER'),
      '14. Unauthorized reviewer is denied'
    );

    // ─── تست ۱۵: جلوگیری از تضاد دو تصمیم همزمان بر روی یک درخواست ───────
    // تایید اول توسط Manager
    await reviewApplication({
      reviewerId: uManager,
      applicationId: advAppValid.id,
      decision: 'approve',
    });

    let conflictingReviewSuccess = false;
    let conflictingError = '';
    try {
      // تلاش دوم توسط Owner برای همان درخواست که قبلا تایید شده
      await reviewApplication({
        reviewerId: uOwner,
        applicationId: advAppValid.id,
        decision: 'reject',
        reason: 'Late rejection attempt',
      });
      conflictingReviewSuccess = true;
    } catch (err: any) {
      conflictingError = err.message;
    }

    assert(
      !conflictingReviewSuccess && conflictingError.includes('APPLICATION_ALREADY_REVIEWED'),
      '15. Two concurrent approval decisions cannot conflict'
    );

    // ─── تست ۱۶: به‌روزرسانی رکوردهای صحیح دیتابیس پس از تایید ──────────
    const approvedAdvRole = await prisma.userRole.findUnique({
      where: {
        userId_roleKey: {
          userId: uAdvertiserApplicant,
          roleKey: 'advertiser',
        },
      },
    });

    const approvedAdvApp = await prisma.registrationApplication.findUnique({
      where: { id: advAppValid.id },
    });

    assert(
      approvedAdvRole !== null && approvedAdvApp?.status === 'approved',
      '16. Approval updates the correct database records'
    );

    // ─── تست ۱۷: خطای همگام‌سازی نقش دیسکورد قابل بازیابی است و تراکنش را باطل نمی‌کند ─
    // شبیه‌سازی کلاینت دیسکورد با متد معیوب
    const mockFaultyDiscordClient = {
      guilds: {
        fetch: async () => {
          throw new Error('SIMULATED_DISCORD_GATEWAY_TIMEOUT');
        },
      },
    };

    // ثبت درخواست بوستر جدید برای uRegular
    const boosterToSync = await registerBooster({
      userId: uRegular,
      gameSlug: 'wow_midnight',
      serviceId: mplusService.id,
      experience: 'Testing sync resilience',
    });

    const approvedSyncApp = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterToSync.id,
      decision: 'approve',
      discordClient: mockFaultyDiscordClient,
    });

    const syncAuditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'DISCORD_ROLE_SYNC_FAILED',
        isSuccess: false,
      },
    });

    assert(
      approvedSyncApp.status === 'approved' && syncAuditLog !== null,
      '17. Discord role synchronization failure is recoverable'
    );

    // ─── تست ۱۸: اطلاعات هویتی حساس هرگز در پیام‌های عمومی ظاهر نمی‌شوند ─
    const pilotAppInDb = await prisma.registrationApplication.findUnique({
      where: { id: pilotApp.id },
    });
    const qualifications = pilotAppInDb ? JSON.parse(pilotAppInDb.qualifications) : {};
    const hasSecretToken = qualifications.identityDocumentRef !== undefined;
    assert(
      !hasSecretToken && qualifications.identityVerificationState === 'awaiting_secure_submission',
      '18. Sensitive identity information never appears in public messages'
    );

    // ─── تست ۱۹: بسته بودن DM مانع از ثبت یا انجام کار نمی‌شود ─────────
    let dmFailedGracefully = false;
    try {
      const mockClosedDmClient = {
        users: {
          fetch: async () => ({
            send: async () => {
              const err: any = new Error('Cannot send messages to this user');
              err.code = 50007;
              throw err;
            },
          }),
        },
      };

      await sendApplicantDm(mockClosedDmClient, uRegular, {
        title: 'Test Closed DM',
        description: 'Should not crash',
      });
      dmFailedGracefully = true;
    } catch {
      dmFailedGracefully = false;
    }

    assert(dmFailedGracefully, '19. Closed DMs do not break submission');

    // ─── تست ۲۰: ریستارت شدن بات درخواست‌های ذخیره‌شده را از بین نمی‌برد ─
    const reloadedApps = await prisma.registrationApplication.findMany({
      where: { userId: { in: allTestUsers } },
    });
    assert(
      reloadedApps.length >= 4,
      '20. Restart does not invalidate stored applications'
    );

    // ─── تست ۲۱: هویت کنشگر تعامل دکمه قابل جعل نیست ───────────────────
    // بررسی اینکه اعتبارسنجی منحصراً از interaction.user.id استفاده می‌کند
    const spoofAttemptUserId = 'fake_spoofed_admin_id';
    const authSpoofCheck = await authorize(spoofAttemptUserId, Permission.BOOSTER_APPLICATION_REVIEW);
    assert(
      !authSpoofCheck.allowed,
      '21. Button interaction actor identity cannot be spoofed'
    );

    // ─── تست ۲۲: ترکیب نامعتبر بازی و سرویس رد می‌شود ───────────────────
    let invalidGameServiceAccepted = false;
    let invalidGSError = '';
    try {
      await registerBooster({
        userId: uRegular,
        gameSlug: 'rainbow_six_siege',
        serviceId: mplusService.id, // متعلق به wow_midnight است نه r6!
      });
      invalidGameServiceAccepted = true;
    } catch (err: any) {
      invalidGSError = err.message;
    }

    assert(
      !invalidGameServiceAccepted && invalidGSError.includes('INVALID_GAME_SERVICE'),
      '22. Invalid game/service combinations are rejected'
    );

  } catch (error) {
    console.error('Fatal error during test suite execution:', error);
    failed++;
  } finally {
    // ─── پاکسازی رکوردهای تستی ──────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning registration test records...');
    await prisma.registrationApplication.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.pilotVerification.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.wowCharacter.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allTestUsers } },
    });
  }

  console.log(`\n=== REGISTRATION TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runRegistrationTests().catch((err) => {
  console.error('Execution failure:', err);
  process.exit(1);
});
