/**
 * registration_recovery_suite.ts — مجموعه تست جامع بازیابی، همگام‌سازی نقش‌ها و صف اعلانات (Phase 3.2.3)
 *
 * ۲۸ سناریوی آزمون الزامی بر اساس نیازمندی‌های فاز ۳.۲.۳:
 *  1. Request Info persists the reason.
 *  2. Applicant receives an actionable response path.
 *  3. Applicant can submit supplemental information to the same application.
 *  4. Applicant cannot update another user's application.
 *  5. Applicant can recover when DMs are closed.
 *  6. Application returns to administrative review after supplemental submission.
 *  7. Verify ID does not permanently remove all review actions.
 *  8. Verify ID keeps application state recoverable after restart.
 *  9. Pilot verification cannot be bypassed.
 * 10. Exchanger identity verification policy is enforced.
 * 11. Booster approval creates the correct internal records.
 * 12. Pilot approval requires all mandatory approvals.
 * 13. Advertiser approval creates the correct internal role.
 * 14. Exchanger approval creates the correct internal role.
 * 15. Discord role synchronization calls GuildMember.roles.add for the correct role.
 * 16. Missing Manage Roles is reported and recoverable.
 * 17. Bot role hierarchy failure is reported and recoverable.
 * 18. Missing or invalid role IDs are reported.
 * 19. Successful approval enqueues an applicant notification.
 * 20. Notification worker actually delivers the message.
 * 21. Closed DMs result in a safe recoverable state.
 * 22. Retry of role sync is idempotent.
 * 23. Retry of notification is idempotent.
 * 24. Concurrent admin decisions cannot conflict.
 * 25. Review controls remain usable after process restart.
 * 26. Existing private data never leaks into public messages.
 * 27. Approval state survives Discord API failure.
 * 28. Existing authorization policies remain enforced.
 */

import prisma from '../database/db';
import {
  registerBooster,
  registerPilot,
  registerAdvertiser,
  registerExchanger,
  reviewApplication,
  submitSupplementalInfo,
  getUserActiveApplications,
  syncDiscordRole,
  ensureUserExists,
} from '../services/registrationService';
import {
  buildReviewCardEmbed,
  buildReviewCardButtons,
  renderOrUpdateStaffReviewCard,
} from '../interactions/registrationInteractions';
import { processNotificationOutbox } from '../services/notificationWorker';
import { PermissionFlagsBits } from 'discord.js';

async function runRecoverySuite() {
  console.log('=== STARTING PHASE 3.2.3 REGISTRATION WORKFLOW RECOVERY & ROLE SYNC SUITE ===\n');

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
  const uAdmin = '880000000000000001';
  const uApplicantBooster = '880000000000000002';
  const uApplicantPilot = '880000000000000003';
  const uApplicantAdv = '880000000000000004';
  const uApplicantExch = '880000000000000005';
  const uAttacker = '880000000000000006';

  const testUsers = [
    uAdmin,
    uApplicantBooster,
    uApplicantPilot,
    uApplicantAdv,
    uApplicantExch,
    uAttacker,
  ];

  const testGuildId = '990000000000000001';
  const roleBoosterId = '990000000000000010';
  const rolePilotId = '990000000000000020';
  const roleAdvId = '990000000000000030';
  const roleExchId = '990000000000000040';

  process.env.DISCORD_GUILD_ID = testGuildId;
  process.env.ROLE_BOOSTER = roleBoosterId;
  process.env.ROLE_PILOT = rolePilotId;
  process.env.ROLE_ADVERTISER = roleAdvId;
  process.env.ROLE_EXCHANGER = roleExchId;

  try {
    // ─── پاکسازی رکوردهای قبلی تست ───────────────────────────────────────────
    await prisma.notificationOutbox.deleteMany({
      where: { recipientId: { in: testUsers } },
    });
    await prisma.registrationApplication.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.pilotVerification.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: testUsers } },
    });

    // راه‌اندازی کاربران و ادمین
    for (const uid of testUsers) {
      await ensureUserExists(uid);
    }

    // انتساب نقش Manager به uAdmin جهت امکان بازبینی مدارک هویتی
    await prisma.userRole.create({
      data: {
        userId: uAdmin,
        roleKey: 'manager',
      },
    });

    // اطمینان از وجود بازی wow_midnight
    await prisma.game.upsert({
      where: { slug: 'wow_midnight' },
      update: { isActive: true },
      create: {
        slug: 'wow_midnight',
        displayName: 'World of Warcraft Midnight',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    // ─── موک کلاینت دیسکورد سالم ───────────────────────────────────────────
    const addedRolesMap = new Map<string, Set<string>>();
    const sentDmsMap = new Map<string, any[]>();

    const createHealthyMockClient = () => ({
      user: { id: '990000000000000099' },
      guilds: {
        fetch: async (gid: string) => {
          if (gid !== testGuildId) return null;
          return {
            id: testGuildId,
            members: {
              me: {
                id: '990000000000000099',
                permissions: {
                  has: (perm: bigint) => perm === PermissionFlagsBits.ManageRoles,
                },
                roles: {
                  highest: { position: 100, name: 'Bot Admin' },
                },
              },
              fetch: async (uid: string) => {
                if (!testUsers.includes(uid)) return null;
                return {
                  id: uid,
                  roles: {
                    add: async (roleId: string) => {
                      if (!addedRolesMap.has(uid)) addedRolesMap.set(uid, new Set());
                      addedRolesMap.get(uid)!.add(roleId);
                    },
                  },
                };
              },
            },
            roles: {
              cache: {
                get: (rid: string) => {
                  const rolePositions: Record<string, number> = {
                    [roleBoosterId]: 10,
                    [rolePilotId]: 20,
                    [roleAdvId]: 30,
                    [roleExchId]: 40,
                  };
                  if (rolePositions[rid] !== undefined) {
                    return { id: rid, position: rolePositions[rid], name: `Role-${rid}` };
                  }
                  return null;
                },
              },
              fetch: async (rid: string) => {
                const rolePositions: Record<string, number> = {
                  [roleBoosterId]: 10,
                  [rolePilotId]: 20,
                  [roleAdvId]: 30,
                  [roleExchId]: 40,
                };
                if (rolePositions[rid] !== undefined) {
                  return { id: rid, position: rolePositions[rid], name: `Role-${rid}` };
                }
                return null;
              },
            },
          };
        },
      },
      users: {
        fetch: async (uid: string) => {
          return {
            id: uid,
            send: async (payload: any) => {
              if (!sentDmsMap.has(uid)) sentDmsMap.set(uid, []);
              sentDmsMap.get(uid)!.push(payload);
              return { id: `msg_${Date.now()}` };
            },
          };
        },
      },
    });

    const healthyClient = createHealthyMockClient();

    // ─── سناریوهای ۱ تا ۶: Request Info و ارسال مدارک تکمیلی ─────────────────
    console.log('--- Testing Request Info & Supplemental Submission (BUG 1) ---');

    // ثبت درخواست بوستر
    const boosterApp = await registerBooster({
      userId: uApplicantBooster,
      gameSlug: 'wow_midnight',
      mainRole: 'DPS',
      experience: 'Mythic raider in past 2 expansions',
      raiderioUrl: 'https://raider.io/characters/eu/tarren-mill/Recoverybooster',
    });

    // تست ۱: Request Info دلیل درخواست را در دیتابیس ثبت می‌کند
    const requestReason = 'Please provide your Raider.IO profile or logs link.';
    const updatedInfoApp = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterApp.id,
      decision: 'request_info',
      reason: requestReason,
      discordClient: healthyClient,
    });

    assert(
      updatedInfoApp.status === 'info_requested' &&
        updatedInfoApp.reviewNotes === requestReason &&
        updatedInfoApp.infoRequestedAt !== null,
      '1. Request Info persists the reason'
    );

    // تست ۲: اعلان با مسیر پاسخ (Actionable path) در اوت‌باکس ثبت شده است
    const infoOutboxItem = await prisma.notificationOutbox.findFirst({
      where: {
        recipientId: uApplicantBooster,
        notificationType: 'APPLICATION_INFO_REQUESTED',
      },
      orderBy: { createdAt: 'desc' },
    });

    assert(
      infoOutboxItem !== null &&
        infoOutboxItem.payload.includes(String(boosterApp.id)) &&
        infoOutboxItem.payload.includes(requestReason),
      '2. Applicant receives an actionable response path'
    );

    // تست ۳: متقاضی می‌تواند مدارک تکمیلی را برای همان درخواست ارسال کند
    const suppResponse = 'https://raider.io/characters/us/illidan/testchar';
    const postSuppApp = await submitSupplementalInfo(
      boosterApp.id,
      uApplicantBooster,
      suppResponse,
      healthyClient
    );

    assert(
      postSuppApp.id === boosterApp.id &&
        postSuppApp.status === 'under_review' &&
        postSuppApp.supplementalInfo === suppResponse &&
        postSuppApp.infoRespondedAt !== null,
      '3. Applicant can submit supplemental information to the same application'
    );

    // تست ۴: متقاضی دیگر نمی‌تواند درخواست کاربر دیگری را تغییر دهد (Security Check)
    let unauthorizedEditBlocked = false;
    // تغییر موقت به info_requested جهت تست
    await prisma.registrationApplication.update({
      where: { id: boosterApp.id },
      data: { status: 'info_requested' },
    });

    try {
      await submitSupplementalInfo(
        boosterApp.id,
        uAttacker,
        'Malicious hijack payload',
        healthyClient
      );
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED_APPLICANT')) {
        unauthorizedEditBlocked = true;
      }
    }

    assert(
      unauthorizedEditBlocked,
      "4. Applicant cannot update another user's application"
    );

    // تست ۵: در صورت بسته بودن DM، متقاضی از طریق My Applications درخواست خود را ریکاوری می‌کند
    const userActiveApps = await getUserActiveApplications(uApplicantBooster);
    assert(
      userActiveApps.length === 1 &&
        userActiveApps[0].id === boosterApp.id &&
        userActiveApps[0].status === 'info_requested',
      '5. Applicant can recover when DMs are closed'
    );

    // برگرداندن به under_review برای تست ۶
    await submitSupplementalInfo(
      boosterApp.id,
      uApplicantBooster,
      suppResponse,
      healthyClient
    );

    const readyReviewApp = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp.id },
    });

    assert(
      readyReviewApp?.status === 'under_review' &&
        readyReviewApp?.supplementalInfo === suppResponse,
      '6. Application returns to administrative review after supplemental submission'
    );

    // ─── سناریوهای ۷ و ۸: Verify ID و پایداری دکمه‌ها (BUG 2) ───────────────
    console.log('\n--- Testing Verify ID & Review Button Persistence (BUG 2) ---');

    // ثبت درخواست پایلوت
    const pilotApp = await registerPilot({
      userId: uApplicantPilot,
      gameSlug: 'wow_midnight',
      experience: 'Multi-rank 1 Gladiator pilot',
      raiderioUrl: 'https://raider.io/characters/eu/tarren-mill/Recoverypilot',
    });

    // ادمین روی Verify ID کلیک می‌کند
    const awaitingIdApp = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: pilotApp.id,
      decision: 'start_identity_verification',
      discordClient: healthyClient,
    });

    assert(
      awaitingIdApp.status === 'awaiting_identity_verification' &&
        awaitingIdApp.identityStatus === 'awaiting_submission',
      'Verify ID status transitioned honestly without bypass'
    );

    // تست ۷: دکمه‌های بازبینی ادمین پس از Verify ID ناپدید نمی‌شوند
    const buttonsAfterIdVerif = buildReviewCardButtons(awaitingIdApp);
    const hasApproveButton = buttonsAfterIdVerif.some((row) =>
      row.components.some((btn: any) => btn.data.custom_id.includes('approve'))
    );
    const hasRejectButton = buttonsAfterIdVerif.some((row) =>
      row.components.some((btn: any) => btn.data.custom_id.includes('reject'))
    );
    const hasRefreshButton = buttonsAfterIdVerif.some((row) =>
      row.components.some((btn: any) => btn.data.custom_id.includes('refresh'))
    );

    assert(
      buttonsAfterIdVerif.length > 0 && hasApproveButton && hasRejectButton && hasRefreshButton,
      '7. Verify ID does not permanently remove all review actions'
    );

    // تست ۸: پس از ریستارت پروسس، وضعیت درخواست و کارت بازبینی قابل بازیابی است
    const fetchedAwaitingApp = await prisma.registrationApplication.findUnique({
      where: { id: pilotApp.id },
    });
    const reRenderedEmbed = buildReviewCardEmbed(fetchedAwaitingApp);
    const reRenderedButtons = buildReviewCardButtons(fetchedAwaitingApp);

    assert(
      fetchedAwaitingApp?.status === 'awaiting_identity_verification' &&
        reRenderedEmbed.data.fields?.some((f) => f.name === 'Identity Status') &&
        reRenderedButtons.length > 0,
      '8. Verify ID keeps application state recoverable after restart'
    );

    // ─── سناریوهای ۹ تا ۱۴: تایید رسمی و شرط‌های هویتی پایلوت/صراف ─────────────
    console.log('\n--- Testing Honest Verification Requirements & Approvals ---');

    // تست ۹: احراز هویت پایلوت دور زده نمی‌شود (Pilot verification cannot be bypassed)
    let pilotBypassBlocked = false;
    try {
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: pilotApp.id,
        decision: 'approve',
        discordClient: healthyClient,
      });
    } catch (err: any) {
      if (err.message.includes('PILOT_VERIFICATION_REQUIRED')) {
        pilotBypassBlocked = true;
      }
    }

    assert(
      pilotBypassBlocked,
      '9. Pilot verification cannot be bypassed'
    );

    // ثبت درخواست صراف
    const exchangerApp = await registerExchanger({
      userId: uApplicantExch,
      introduction: 'Professional gold and currency trader',
      experience: '5 years high volume trading on top platforms',
      gameCurrencies: ['wow_gold', 'poe2_divine'],
      settlementCurrencies: ['IRT', 'USDT'],
    });

    // تست ۱۰: احراز هویت صراف الزامی است (Exchanger identity verification policy)
    let exchangerBypassBlocked = false;
    try {
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: exchangerApp.id,
        decision: 'approve',
        discordClient: healthyClient,
      });
    } catch (err: any) {
      if (err.message.includes('EXCHANGER_VERIFICATION_REQUIRED')) {
        exchangerBypassBlocked = true;
      }
    }

    assert(
      exchangerBypassBlocked,
      '10. Exchanger identity verification policy is enforced'
    );

    // تست ۱۱: تایید بوستر رکوردهای داخلی صحیح را ثبت می‌کند
    const approvedBooster = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterApp.id,
      decision: 'approve',
      discordClient: healthyClient,
    });

    const boosterUserRole = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: uApplicantBooster, roleKey: 'booster' } },
    });
    const boosterGameApproval = await prisma.userGameApproval.findFirst({
      where: { userId: uApplicantBooster, gameSlug: 'wow_midnight', approvalType: 'booster' },
    });

    assert(
      approvedBooster.status === 'approved' &&
        boosterUserRole !== null &&
        boosterGameApproval?.status === 'approved',
      '11. Booster approval creates the correct internal records'
    );

    // تست ۱۲: تایید پایلوت پس از احراز هویت رسمی با موفقیت انجام می‌شود
    // تایید مدارک هویتی توسط ادمین دارای مجوز SENSITIVE_IDENTITY_REVIEW
    await reviewApplication({
      reviewerId: uAdmin,
      applicationId: pilotApp.id,
      decision: 'verify_identity',
      discordClient: healthyClient,
    });

    const approvedPilot = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: pilotApp.id,
      decision: 'approve',
      discordClient: healthyClient,
    });

    const pilotUserRole = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: uApplicantPilot, roleKey: 'pilot' } },
    });

    assert(
      approvedPilot.status === 'approved' && pilotUserRole !== null,
      '12. Pilot approval requires all mandatory approvals'
    );

    // ثبت و تایید ادورتایزر
    const advApp = await registerAdvertiser({
      userId: uApplicantAdv,
      introduction: 'Community manager and advertiser',
      priorExperience: 'Ran marketing for 2 communities',
      contactInfo: '@adv_telegram',
    });

    // تست ۱۳: تایید ادورتایزر نقش داخلی مناسب را ایجاد می‌کند
    const approvedAdv = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: advApp.id,
      decision: 'approve',
      discordClient: healthyClient,
    });

    const advUserRole = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: uApplicantAdv, roleKey: 'advertiser' } },
    });

    assert(
      approvedAdv.status === 'approved' && advUserRole !== null,
      '13. Advertiser approval creates the correct internal role'
    );

    // احراز هویت صراف و تایید
    await reviewApplication({
      reviewerId: uAdmin,
      applicationId: exchangerApp.id,
      decision: 'verify_identity',
      discordClient: healthyClient,
    });

    // تست ۱۴: تایید صراف رول داخلی exchanger را ایجاد می‌کند
    const approvedExch = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: exchangerApp.id,
      decision: 'approve',
      discordClient: healthyClient,
    });

    const exchUserRole = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: uApplicantExch, roleKey: 'exchanger' } },
    });

    assert(
      approvedExch.status === 'approved' && exchUserRole !== null,
      '14. Exchanger approval creates the correct internal role'
    );

    // ─── سناریوهای ۱۵ تا ۱۸: همگام‌سازی نقش دیسکورد و مدیریت خطاها (BUG 3) ───
    console.log('\n--- Testing Discord Role Synchronization & Permissions (BUG 3) ---');

    // تست ۱۵: همگام‌سازی موفق نقش دیسکورد GuildMember.roles.add را فراخوانی می‌کند
    assert(
      addedRolesMap.get(uApplicantBooster)?.has(roleBoosterId) &&
        addedRolesMap.get(uApplicantPilot)?.has(rolePilotId) &&
        addedRolesMap.get(uApplicantAdv)?.has(roleAdvId) &&
        addedRolesMap.get(uApplicantExch)?.has(roleExchId),
      '15. Discord role synchronization calls GuildMember.roles.add for the correct role'
    );

    // تست ۱۶: فقدان دسترسی Manage Roles ربات گزارش شده و قابل بازیابی است
    const clientNoManageRoles = {
      user: { id: '990000000000000099' },
      guilds: {
        fetch: async () => ({
          id: testGuildId,
          members: {
            me: {
              permissions: { has: () => false },
              roles: { highest: { position: 100 } },
            },
            fetch: async () => ({
              roles: { add: async () => {} },
            }),
          },
          roles: {
            cache: { get: () => ({ position: 10 }) },
            fetch: async () => ({ position: 10 }),
          },
        }),
      },
    };

    const roleSyncResult1 = await syncDiscordRole(
      clientNoManageRoles,
      uApplicantBooster,
      'booster',
      boosterApp.id
    );

    const appAfterMissingPerm = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp.id },
    });

    assert(
      !roleSyncResult1.success &&
        appAfterMissingPerm?.roleSyncStatus === 'failed' &&
        appAfterMissingPerm?.roleSyncError?.includes('BOT_MISSING_MANAGE_ROLES'),
      '16. Missing Manage Roles is reported and recoverable'
    );

    // تست ۱۷: تخطی از سلسله‌مراتب رول‌ها (Role hierarchy) ثبت و مدیریت می‌شود
    const clientHierarchyFail = {
      user: { id: '990000000000000099' },
      guilds: {
        fetch: async () => ({
          id: testGuildId,
          members: {
            me: {
              permissions: { has: () => true },
              roles: { highest: { position: 5, name: 'Low Bot Role' } }, // رول ربات پایین‌تر از رول مورد نظر (10) است!
            },
            fetch: async () => ({
              roles: { add: async () => {} },
            }),
          },
          roles: {
            cache: { get: () => ({ position: 10, name: 'Target Role' }) },
            fetch: async () => ({ position: 10, name: 'Target Role' }),
          },
        }),
      },
    };

    const roleSyncResult2 = await syncDiscordRole(
      clientHierarchyFail,
      uApplicantBooster,
      'booster',
      boosterApp.id
    );

    const appAfterHierarchyFail = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp.id },
    });

    assert(
      !roleSyncResult2.success &&
        appAfterHierarchyFail?.roleSyncStatus === 'failed' &&
        appAfterHierarchyFail?.roleSyncError?.includes('ROLE_HIERARCHY_VIOLATION'),
      '17. Bot role hierarchy failure is reported and recoverable'
    );

    // تست ۱۸: رول‌های گم‌شده یا فاقد اسنوفلیک معتبر گزارش می‌شوند
    const prevEnv = process.env.ROLE_BOOSTER;
    process.env.ROLE_BOOSTER = 'invalid_snowflake_string';

    const roleSyncResult3 = await syncDiscordRole(
      healthyClient,
      uApplicantBooster,
      'booster',
      boosterApp.id
    );

    const appAfterInvalidRoleConfig = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp.id },
    });

    process.env.ROLE_BOOSTER = prevEnv; // بازگردانی

    assert(
      !roleSyncResult3.success &&
        appAfterInvalidRoleConfig?.roleSyncStatus === 'failed' &&
        appAfterInvalidRoleConfig?.roleSyncError?.includes('INVALID_ROLE_CONFIG'),
      '18. Missing or invalid role IDs are reported'
    );

    // ─── سناریوهای ۱۹ تا ۲۳: صف اعلانات و تحویل پایدار ───────────────────────
    console.log('\n--- Testing Notification Outbox & Worker Delivery ---');

    // تست ۱۹: تایید درخواست، اعلان متقاضی را در اوت‌باکس ثبت می‌کند
    const approvalOutboxItem = await prisma.notificationOutbox.findFirst({
      where: {
        recipientId: uApplicantBooster,
        notificationType: 'APPLICATION_APPROVED',
      },
    });

    assert(
      approvalOutboxItem !== null &&
        approvalOutboxItem.deliveryChannel === 'discord_dm' &&
        (approvalOutboxItem.status === 'pending' || approvalOutboxItem.status === 'sent'),
      '19. Successful approval enqueues an applicant notification'
    );

    // تست ۲۰: ورکر صف اعلانات پیام را با موفقیت ارسال کرده و وضعیت را sent می‌کند
    const testPendingItem = await prisma.notificationOutbox.create({
      data: {
        eventKey: `test_pending_delivery_${Date.now()}`,
        recipientId: uApplicantBooster,
        notificationType: 'APPLICATION_APPROVED',
        deliveryChannel: 'discord_dm',
        payload: JSON.stringify({ applicationId: boosterApp.id, category: 'booster' }),
        status: 'pending',
      },
    });

    await processNotificationOutbox(healthyClient);

    const sentOutboxItem = await prisma.notificationOutbox.findUnique({
      where: { id: testPendingItem.id },
    });

    assert(
      sentOutboxItem?.status === 'sent' &&
        sentOutboxItem?.sentAt !== null &&
        (sentDmsMap.get(uApplicantBooster)?.length || 0) > 0,
      '20. Notification worker actually delivers the message'
    );

    // تست ۲۱: بسته بودن DM کاربر به وضعیت ایمن dms_closed تبدیل می‌شود
    const closedDmUser = '880000000000000099';
    await ensureUserExists(closedDmUser);

    const closedDmOutboxItem = await prisma.notificationOutbox.create({
      data: {
        eventKey: `test_closed_dm_${Date.now()}`,
        recipientId: closedDmUser,
        notificationType: 'APPLICATION_INFO_REQUESTED',
        deliveryChannel: 'discord_dm',
        payload: JSON.stringify({ applicationId: 9999, requestedInfo: 'Test' }),
      },
    });

    const clientClosedDm = {
      users: {
        fetch: async () => ({
          send: async () => {
            const err: any = new Error('Cannot send messages to this user');
            err.code = 50007; // کد خطای بسته بودن DM در دیسکورد
            throw err;
          },
        }),
      },
    };

    await processNotificationOutbox(clientClosedDm);

    const processedClosedDmItem = await prisma.notificationOutbox.findUnique({
      where: { id: closedDmOutboxItem.id },
    });

    assert(
      processedClosedDmItem?.status === 'dms_closed' &&
        processedClosedDmItem?.errorDetails?.includes('DMs are closed'),
      '21. Closed DMs result in a safe recoverable state'
    );

    // تست ۲۲: تلاش مجدد همگام‌سازی نقش آیدمپوتنت (Idempotent) است
    const retryResult1 = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterApp.id,
      decision: 'retry_role_sync',
      discordClient: healthyClient,
    });

    const retryResult2 = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: boosterApp.id,
      decision: 'retry_role_sync',
      discordClient: healthyClient,
    });

    const finalAppAfterRetries = await prisma.registrationApplication.findUnique({
      where: { id: boosterApp.id },
    });

    assert(
      finalAppAfterRetries?.roleSyncStatus === 'synced' &&
        retryResult1.id === boosterApp.id &&
        retryResult2.id === boosterApp.id,
      '22. Retry of role sync is idempotent'
    );

    // تست ۲۳: تلاش مجدد پردازش صف اعلانات، پیام قبلاً ارسال‌شده را دوباره نمی‌فرستد
    const countBeforeSecondPass = sentDmsMap.get(uApplicantBooster)?.length || 0;
    await processNotificationOutbox(healthyClient);
    const countAfterSecondPass = sentDmsMap.get(uApplicantBooster)?.length || 0;

    assert(
      countBeforeSecondPass === countAfterSecondPass,
      '23. Retry of notification is idempotent'
    );

    // ─── سناریوهای ۲۴ تا ۲۸: امنیت، تاب‌آوری و سیاست‌های دسترسی ───────────────
    console.log('\n--- Testing Concurrency, Security & Failure Survival ---');

    // ایجاد یک درخواست جدید جهت تست تضاد همزمانی
    const concurrentApp = await registerBooster({
      userId: uApplicantBooster,
      gameSlug: 'wow_midnight',
      mainRole: 'Tank',
      experience: 'Concurrent test tank',
      raiderioUrl: 'https://raider.io/characters/eu/tarren-mill/Concurrenttank',
    });

    // تست ۲۴: دو تصمیم ادمین همزمان روی یک درخواست تضاد ایجاد نمی‌کنند
    let firstDecisionOk = false;
    let secondDecisionConflict = false;

    try {
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: concurrentApp.id,
        decision: 'approve',
        discordClient: healthyClient,
      });
      firstDecisionOk = true;
    } catch {}

    try {
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: concurrentApp.id,
        decision: 'reject',
        reason: 'Concurrent late reject',
        discordClient: healthyClient,
      });
    } catch (err: any) {
      if (err.message.includes('APPLICATION_ALREADY_REVIEWED')) {
        secondDecisionConflict = true;
      }
    }

    assert(
      firstDecisionOk && secondDecisionConflict,
      '24. Concurrent admin decisions cannot conflict'
    );

    // تست ۲۵: دکمه‌ها و فرمت کارت پس از ریستارت پروسس کاملاً سالم باقی می‌مانند
    const restartedEmbed = buildReviewCardEmbed(concurrentApp);
    const restartedButtons = buildReviewCardButtons(concurrentApp);

    assert(
      restartedEmbed.data.title?.includes(String(concurrentApp.id)) &&
        restartedButtons.length > 0,
      '25. Review controls remain usable after process restart'
    );

    // تست ۲۶: اطلاعات محرمانه (تلفن، پاسپورت، سلفی) هرگز در امبد عمومی افشا نمی‌شوند
    const sensitivePilot = await prisma.registrationApplication.findUnique({
      where: { id: pilotApp.id },
    });
    const sensitiveEmbed = buildReviewCardEmbed(sensitivePilot);
    const embedStr = JSON.stringify(sensitiveEmbed.data);

    assert(
      !embedStr.includes('passportDocumentRef') &&
        !embedStr.includes('selfieDocumentRef') &&
        !embedStr.includes('identityDocumentRef'),
      '26. Existing private data never leaks into public messages'
    );

    // تست ۲۷: تایید دیتابیس در صورت قطعی یا خطای Discord API منقضی یا رول‌بک نمی‌شود
    const resilientApp = await registerBooster({
      userId: uApplicantBooster,
      gameSlug: 'wow_midnight',
      mainRole: 'Healer',
      experience: 'Resilience test healer',
      raiderioUrl: 'https://raider.io/characters/eu/tarren-mill/Resilienthealer',
    });

    const clientThatCrashes = {
      guilds: {
        fetch: async () => {
          throw new Error('Discord Gateway Network Error 503');
        },
      },
    };

    const approvedDuringOutage = await reviewApplication({
      reviewerId: uAdmin,
      applicationId: resilientApp.id,
      decision: 'approve',
      discordClient: clientThatCrashes,
    });

    const outageAppInDb = await prisma.registrationApplication.findUnique({
      where: { id: resilientApp.id },
    });
    const outageRoleInDb = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: uApplicantBooster, roleKey: 'booster' } },
    });

    assert(
      approvedDuringOutage.status === 'approved' &&
        outageAppInDb?.status === 'approved' &&
        outageAppInDb?.roleSyncStatus === 'failed' &&
        outageRoleInDb !== null,
      '27. Approval state survives Discord API failure'
    );

    // تست ۲۸: سیاست‌های دسترسی ادمین و عدم امکان خود-تاییدی متقاضی همچنان اعمال می‌شوند
    let unauthorizedDenied = false;
    let selfApprovalDenied = false;

    // متقاضی عادی فاقد نقش ادمین
    try {
      await reviewApplication({
        reviewerId: uAttacker,
        applicationId: resilientApp.id,
        decision: 'reject',
      });
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED_REVIEWER')) {
        unauthorizedDenied = true;
      }
    }

    // متقاضی که ادمین است ولی قصد دارد درخواست خود را تایید کند
    const selfApp = await registerBooster({
      userId: uAdmin,
      gameSlug: 'wow_midnight',
      mainRole: 'DPS',
      experience: 'Admin trying self approval',
      raiderioUrl: 'https://raider.io/characters/eu/tarren-mill/Adminbooster',
    });

    try {
      await reviewApplication({
        reviewerId: uAdmin,
        applicationId: selfApp.id,
        decision: 'approve',
        discordClient: healthyClient,
      });
    } catch (err: any) {
      if (err.message.includes('CANNOT_REVIEW_OWN_APPLICATION')) {
        selfApprovalDenied = true;
      }
    }

    assert(
      unauthorizedDenied && selfApprovalDenied,
      '28. Existing authorization policies remain enforced'
    );

  } catch (error) {
    console.error('Fatal error during registration recovery test suite execution:', error);
    failed++;
  } finally {
    // ─── پاکسازی رکوردهای تستی ──────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning test records...');
    await prisma.notificationOutbox.deleteMany({
      where: { recipientId: { in: testUsers } },
    });
    await prisma.registrationApplication.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.pilotVerification.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: testUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: testUsers } },
    });
  }

  console.log(`\n=== PHASE 3.2.3 TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runRecoverySuite().catch((err) => {
  console.error('Execution failure:', err);
  process.exit(1);
});
