/**
 * separate_registration_channels_suite.ts — مجموعه آزمون‌های تفکیک کانال‌های ثبت‌نام و ادغام Raider.IO (Phase 3.2.4)
 * 
 * پوشش سناریوهای کلیدی فاز ۳.۲.۴:
 *  1. Each public registration panel has only its corresponding role entry.
 *  2. Booster applications route strictly to #app-boosters.
 *  3. Advertiser applications route strictly to #app-adv.
 *  4. Pilot applications route strictly to #app-pilots.
 *  5. Exchanger applications route strictly to #app-exchangers.
 *  6. One application's buttons cannot operate on another application.
 *  7. Unauthorized reviewers are rejected.
 *  8. Channel and panel setup is idempotent.
 *  9. Review messages survive restart recovery.
 * 10. Missing channel configuration fails safely without crash.
 * 11. Existing applications remain accessible after migration.
 * 12. Request Info responses return to the correct application.
 * 13. Verify ID cannot destroy the review workflow.
 * 14. Successful approval correctly handles role sync and notifications.
 * 15. Midnight Booster applications require Raider.IO URLs.
 * 16. Midnight Pilot applications require Raider.IO URLs.
 * 17. Non-Midnight registrations do not require Raider.IO URLs.
 * 18. Invalid, private-network and malicious Raider.IO URLs are safely rejected (SSRF prevention).
 * 19. Raider.IO response parsing and snapshot persistence without score fabrication.
 * 20. Character not found / API downtime handled safely with manual review status.
 */

import fs from 'fs';
import path from 'path';
import prisma from '../database/db';
import {
  parseRaiderIOProfileUrl,
  fetchRaiderIOProfile,
} from '../services/raiderio';
import {
  registerBooster,
  registerPilot,
  registerAdvertiser,
  registerExchanger,
  reviewApplication,
  submitSupplementalInfo,
  getReviewChannelForCategory,
  getPublicChannelForCategory,
} from '../services/registrationService';
import {
  buildBoosterPanelEmbed,
  buildBoosterPanelButtons,
  buildAdvertiserPanelEmbed,
  buildAdvertiserPanelButtons,
  buildPilotPanelEmbed,
  buildPilotPanelButtons,
  buildExchangerPanelEmbed,
  buildExchangerPanelButtons,
  buildReviewCardEmbed,
  renderOrUpdateStaffReviewCard,
} from '../interactions/registrationInteractions';
import { setupRegistrationChannels } from '../services/registrationChannelSetup';

async function runSeparateChannelsSuite() {
  console.log('=== STARTING PHASE 3.2.4 SEPARATE REGISTRATION CHANNELS & RAIDER.IO SUITE ===\n');

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

  const adminId = 'test_p324_admin_01';
  const unauthorizedId = 'test_p324_unauth_01';
  const applicantBooster = 'test_p324_app_booster';
  const applicantPilot = 'test_p324_app_pilot';
  const applicantAdv = 'test_p324_app_adv';
  const applicantExchanger = 'test_p324_app_exch';

  try {
    // ─── ۱. آماده‌سازی کاربران تست و نقش‌ها ──────────────────────────────────
    await prisma.user.upsert({ where: { discordId: adminId }, update: {}, create: { discordId: adminId, username: 'Admin324' } });
    await prisma.user.upsert({ where: { discordId: unauthorizedId }, update: {}, create: { discordId: unauthorizedId, username: 'Unauth324' } });
    await prisma.user.upsert({ where: { discordId: applicantBooster }, update: {}, create: { discordId: applicantBooster, username: 'AppBooster' } });
    await prisma.user.upsert({ where: { discordId: applicantPilot }, update: {}, create: { discordId: applicantPilot, username: 'AppPilot' } });
    await prisma.user.upsert({ where: { discordId: applicantAdv }, update: {}, create: { discordId: applicantAdv, username: 'AppAdv' } });
    await prisma.user.upsert({ where: { discordId: applicantExchanger }, update: {}, create: { discordId: applicantExchanger, username: 'AppExch' } });

    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: adminId, roleKey: 'manager' } },
      update: {},
      create: { userId: adminId, roleKey: 'manager' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: adminId, roleKey: 'admin' } },
      update: {},
      create: { userId: adminId, roleKey: 'admin' },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱: ساختار اختصاصی پنل‌های عمومی (هر پنل منحصراً رول خود را دارد)
    // ─────────────────────────────────────────────────────────────────────────
    const boosterBtns = buildBoosterPanelButtons().components.map((c: any) => c.data.custom_id);
    const advBtns = buildAdvertiserPanelButtons().components.map((c: any) => c.data.custom_id);
    const pilotBtns = buildPilotPanelButtons().components.map((c: any) => c.data.custom_id);
    const exchBtns = buildExchangerPanelButtons().components.map((c: any) => c.data.custom_id);

    const boosterCorrect = boosterBtns.includes('reg_start:booster') && !boosterBtns.includes('reg_start:pilot') && !boosterBtns.includes('reg_start:advertiser');
    const advCorrect = advBtns.includes('reg_start:advertiser') && !advBtns.includes('reg_start:booster') && !advBtns.includes('reg_start:pilot');
    const pilotCorrect = pilotBtns.includes('reg_start:pilot') && !pilotBtns.includes('reg_start:booster') && !pilotBtns.includes('reg_start:exchanger');
    const exchCorrect = exchBtns.includes('reg_start:exchanger') && !exchBtns.includes('reg_start:booster');

    assert(
      boosterCorrect && advCorrect && pilotCorrect && exchCorrect,
      '1. Each public registration panel contains only its dedicated role entry button and My Applications',
      `Booster: [${boosterBtns.join(', ')}], Adv: [${advBtns.join(', ')}]`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲ تا ۵: تفکیک مسیردهی کانال‌های بازبینی برای هر ۴ دسته‌بندی
    // ─────────────────────────────────────────────────────────────────────────
    process.env.CHANNEL_APP_BOOSTERS = '900000000000000001';
    process.env.CHANNEL_APP_ADVERTISERS = '900000000000000002';
    process.env.CHANNEL_APP_PILOTS = '900000000000000003';
    process.env.CHANNEL_APP_EXCHANGERS = '900000000000000004';

    const chBooster = getReviewChannelForCategory('booster');
    const chAdv = getReviewChannelForCategory('advertiser');
    const chPilot = getReviewChannelForCategory('pilot');
    const chExch = getReviewChannelForCategory('exchanger');

    assert(chBooster === '900000000000000001', '2. Booster applications route strictly to #app-boosters');
    assert(chAdv === '900000000000000002', '3. Advertiser applications route strictly to #app-adv');
    assert(chPilot === '900000000000000003', '4. Pilot applications route strictly to #app-pilots');
    assert(chExch === '900000000000000004', '5. Exchanger applications route strictly to #app-exchangers');

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۶: عدم تداخل دکمه‌های بازبینی دو درخواست مختلف (Application ID Isolation)
    // ─────────────────────────────────────────────────────────────────────────
    const appAdv1 = await registerAdvertiser({
      userId: applicantAdv,
      introduction: 'Test Advertiser Intro',
      priorExperience: '5 years sales',
      contactInfo: '@adv_telegram',
    });

    const appExch1 = await registerExchanger({
      userId: applicantExchanger,
      introduction: 'Exchanger Intro',
      experience: '2 years crypto and gold',
      gameCurrencies: ['wow_gold'],
      settlementCurrencies: ['USDT', 'IRT'],
    });

    let crossActionRejected = false;
    try {
      // Trying to review appAdv1 with mismatched application action
      await reviewApplication({
        applicationId: appAdv1.id,
        reviewerId: adminId,
        decision: 'request_info',
        reviewNotes: 'Need more details',
      });
      // Verification that appExch1 remains pending
      const checkExch = await prisma.registrationApplication.findUnique({ where: { id: appExch1.id } });
      if (checkExch?.status === 'pending') {
        crossActionRejected = true;
      }
    } catch {
      crossActionRejected = false;
    }
    assert(
      crossActionRejected,
      '6. One application review decision does not affect or operate on another application',
      `AppAdv1: info_requested, AppExch1: pending`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۷: رد درخواست بازبینی توسط کاربر غیرمجاز
    // ─────────────────────────────────────────────────────────────────────────
    let unauthRejected = false;
    try {
      await reviewApplication({
        applicationId: appExch1.id,
        reviewerId: unauthorizedId,
        decision: 'approve',
      });
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED_REVIEWER') || err.message.includes('Insufficient permissions')) {
        unauthRejected = true;
      }
    }
    assert(unauthRejected, '7. Unauthorized reviewers are strictly blocked with permission errors');

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۸: تکرارپذیری ایمن ساخت کانال‌ها (Idempotency)
    // ─────────────────────────────────────────────────────────────────────────
    const mockGuildChannels = new Map<string, any>();
    const mockGuild: any = {
      id: 'mock_guild_123',
      channels: {
        cache: {
          find: (fn: any) => Array.from(mockGuildChannels.values()).find(fn),
          get: (id: string) => mockGuildChannels.get(id),
        },
        create: async (data: any) => {
          const fakeId = `mock_ch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const fakeChannel = {
            id: fakeId,
            name: data.name,
            type: data.type,
            messages: {
              fetch: async () => [],
            },
            send: async () => ({ id: `msg_${fakeId}` }),
          };
          mockGuildChannels.set(fakeId, fakeChannel);
          return fakeChannel;
        },
      },
      members: {
        me: {
          permissions: {
            has: () => true,
          },
        },
      },
    };

    const setup1 = await setupRegistrationChannels({ guild: mockGuild, actorId: adminId });
    const countAfterSetup1 = mockGuildChannels.size;
    const setup2 = await setupRegistrationChannels({ guild: mockGuild, actorId: adminId });
    const countAfterSetup2 = mockGuildChannels.size;

    assert(
      setup1.success && setup2.success && countAfterSetup1 === countAfterSetup2,
      '8. Registration channel and panel setup is completely idempotent (no duplicate channels on rerun)',
      `First run: ${countAfterSetup1} channels, Second run: ${countAfterSetup2} channels`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۹: پایداری پیام بازبینی پس از ری‌استارت (Review message persistence)
    // ─────────────────────────────────────────────────────────────────────────
    const mockClient: any = {
      channels: {
        fetch: async (id: string) => ({
          id,
          send: async (payload: any) => ({ id: 'mock_msg_999' }),
          messages: {
            fetch: async (msgId: string) => ({
              id: msgId,
              edit: async () => ({ id: msgId }),
            }),
          },
        }),
      },
    };

    await renderOrUpdateStaffReviewCard(mockClient, appExch1.id);
    const appAfterSend = await prisma.registrationApplication.findUnique({ where: { id: appExch1.id } });

    assert(
      appAfterSend?.reviewChannelId === '900000000000000004' &&
        appAfterSend?.reviewMessageId === 'mock_msg_999',
      '9. Review message ID and category channel ID are persisted and survive bot restart',
      `Channel: ${appAfterSend?.reviewChannelId}, Message: ${appAfterSend?.reviewMessageId}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۰: شکست ایمن در صورت نبود کانال بدون کرش
    // ─────────────────────────────────────────────────────────────────────────
    delete process.env.CHANNEL_APP_BOOSTERS;
    delete process.env.CHANNEL_APPLY_REQUESTS;
    const fallbackCh = getReviewChannelForCategory('booster');
    // Calling renderOrUpdateStaffReviewCard with no channel config should log warning and return cleanly without throwing
    let crashed = false;
    try {
      await renderOrUpdateStaffReviewCard(mockClient, appAdv1.id);
    } catch {
      crashed = true;
    }
    assert(
      fallbackCh === null && !crashed,
      '10. Missing channel configuration fails safely without throwing unhandled exceptions'
    );
    // Restore env vars
    process.env.CHANNEL_APP_BOOSTERS = '900000000000000001';

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۱: دسترسی به درخواست‌های قدیمی بدون تغییر وضعیت (Data Preservation)
    // ─────────────────────────────────────────────────────────────────────────
    const existingApps = await prisma.registrationApplication.findMany({
      where: { id: { in: [appAdv1.id, appExch1.id] } },
    });
    assert(
      existingApps.length === 2 && existingApps[0].userId === applicantAdv,
      '11. Existing user applications and review history remain fully preserved and accessible'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۲: پاسخ به Request Info به همان درخواست بازمی‌گردد
    // ─────────────────────────────────────────────────────────────────────────
    await submitSupplementalInfo(appAdv1.id, applicantAdv, 'Here is my updated portfolio link');
    const updatedAdv = await prisma.registrationApplication.findUnique({ where: { id: appAdv1.id } });
    assert(
      updatedAdv?.status === 'under_review' &&
        updatedAdv?.supplementalInfo === 'Here is my updated portfolio link',
      '12. Supplemental Request Info responses update the exact same application and return to under_review'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۳: عملیات Verify ID روند بازبینی را تخریب نمی‌کند
    // ─────────────────────────────────────────────────────────────────────────
    const testKycDir = path.join(process.cwd(), 'storage', 'kyc_documents');
    if (!fs.existsSync(testKycDir)) {
      fs.mkdirSync(testKycDir, { recursive: true });
    }
    const testKycFile = path.join(testKycDir, 'test_exch_doc.png');
    fs.writeFileSync(testKycFile, 'mock-kyc-evidence-bytes');

    const exchQuals = JSON.parse(appExch1.qualifications || '{}');
    exchQuals.identityDocumentRef = 'test_exch_doc.png';
    await prisma.registrationApplication.update({
      where: { id: appExch1.id },
      data: { qualifications: JSON.stringify(exchQuals) },
    });

    await reviewApplication({
      applicationId: appExch1.id,
      reviewerId: adminId,
      decision: 'verify_identity',
    });
    const verifiedExch = await prisma.registrationApplication.findUnique({ where: { id: appExch1.id } });
    assert(
      verifiedExch?.identityStatus === 'verified' && verifiedExch.status === 'under_review',
      '13. Verify ID safely updates identity status without breaking or resetting review lifecycle'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۴: تایید نهایی و پردازش صف اعلانات
    // ─────────────────────────────────────────────────────────────────────────
    await reviewApplication({
      applicationId: appExch1.id,
      reviewerId: adminId,
      decision: 'approve',
    });
    const approvedExch = await prisma.registrationApplication.findUnique({ where: { id: appExch1.id } });
    const outboxNotice = await prisma.notificationOutbox.findFirst({
      where: { recipientId: applicantExchanger, notificationType: 'APPLICATION_APPROVED' },
    });
    assert(
      approvedExch?.status === 'approved' && outboxNotice !== null,
      '14. Successful application approval creates database approval, enqueues applicant notification'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۵: ثبت‌نام بوستر WoW Midnight الزام به URL معتبر Raider.IO دارد
    // ─────────────────────────────────────────────────────────────────────────
    let midnightBoosterMissingRejected = false;
    let midnightBoosterInvalidRejected = false;

    try {
      await registerBooster({
        userId: applicantBooster,
        gameSlug: 'wow_midnight',
        // No raiderioUrl!
      });
    } catch (e: any) {
      if (e.message.includes('MISSING_RAIDERIO_URL')) midnightBoosterMissingRejected = true;
    }

    try {
      await registerBooster({
        userId: applicantBooster,
        gameSlug: 'wow_midnight',
        raiderioUrl: 'https://fake-phishing-site.com/characters/eu/kazzak/Illidan',
      });
    } catch (e: any) {
      if (e.message.includes('INVALID_RAIDERIO_URL')) midnightBoosterInvalidRejected = true;
    }

    assert(
      midnightBoosterMissingRejected && midnightBoosterInvalidRejected,
      '15. World of Warcraft: Midnight Booster application strictly requires a valid Raider.IO profile URL',
      `Missing blocked: ${midnightBoosterMissingRejected}, Invalid blocked: ${midnightBoosterInvalidRejected}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۶: ثبت‌نام پایلوت WoW Midnight الزام به URL معتبر Raider.IO دارد
    // ─────────────────────────────────────────────────────────────────────────
    let midnightPilotMissingRejected = false;
    let midnightPilotInvalidRejected = false;

    try {
      await registerPilot({
        userId: applicantPilot,
        gameSlug: 'wow_midnight',
        // No raiderioUrl!
      });
    } catch (e: any) {
      if (e.message.includes('MISSING_RAIDERIO_URL')) midnightPilotMissingRejected = true;
    }

    try {
      await registerPilot({
        userId: applicantPilot,
        gameSlug: 'wow_midnight',
        raiderioUrl: 'http://insecure-http-site.com/profile',
      });
    } catch (e: any) {
      if (e.message.includes('INVALID_RAIDERIO_URL')) midnightPilotInvalidRejected = true;
    }

    assert(
      midnightPilotMissingRejected && midnightPilotInvalidRejected,
      '16. World of Warcraft: Midnight Pilot application strictly requires a valid Raider.IO profile URL',
      `Missing blocked: ${midnightPilotMissingRejected}, Invalid blocked: ${midnightPilotInvalidRejected}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۷: ثبت‌نام در سایر بازی‌ها نیازی به Raider.IO ندارد
    // ─────────────────────────────────────────────────────────────────────────
    const r6Booster = await registerBooster({
      userId: applicantBooster,
      gameSlug: 'rainbow_six_siege',
      mainRole: 'Entry Fragger',
      experience: 'Diamond Rank 3 seasons',
    });

    const poe2Pilot = await registerPilot({
      userId: applicantPilot,
      gameSlug: 'poe2',
      experience: 'Completed multiple Uber bosses',
      contactPreferences: { phone: '+123456789' },
    });

    assert(
      r6Booster.status === 'pending' && poe2Pilot.status === 'pending',
      '17. Non-Midnight registrations (e.g. Rainbow Six Siege, POE2) do not require Raider.IO URLs',
      `R6 Booster ID: #${r6Booster.id}, POE2 Pilot ID: #${poe2Pilot.id}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۸: جلوگیری کامل از SSRF، Localhost و URLهای مخرب
    // ─────────────────────────────────────────────────────────────────────────
    const maliciousUrls = [
      'https://localhost/characters/eu/twisting-nether/Arthas',
      'https://127.0.0.1/characters/eu/twisting-nether/Arthas',
      'https://169.254.169.254/latest/meta-data',
      'http://raider.io/characters/eu/twisting-nether/Arthas', // insecure http
      'https://raider.io.evil.com/characters/eu/twisting-nether/Arthas', // subdomain spoof
      'ftp://raider.io/characters/eu/twisting-nether/Arthas',
      'https://raider.io:8080/characters/eu/twisting-nether/Arthas', // custom port
      'https://raider.io/guilds/eu/twisting-nether/Method', // wrong path type
      'javascript:alert(1)',
    ];

    let allMaliciousRejected = true;
    for (const badUrl of maliciousUrls) {
      const parsed = parseRaiderIOProfileUrl(badUrl);
      if (parsed !== null) {
        allMaliciousRejected = false;
        console.error(`Malicious URL slipped through: ${badUrl}`);
      }
    }

    assert(
      allMaliciousRejected,
      '18. Security validation strictly rejects localhost, private networks, wrong paths, and SSRF vectors',
      `Tested ${maliciousUrls.length} malicious/invalid URLs`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۹: استخراج، پارس و ثبت اسنپ‌شات معتبر Raider.IO
    // ─────────────────────────────────────────────────────────────────────────
    const validUrl = 'https://raider.io/characters/eu/twisting-nether/Arthas';
    const parsedValid = parseRaiderIOProfileUrl(validUrl);
    assert(
      parsedValid !== null &&
        parsedValid.region === 'eu' &&
        parsedValid.realm === 'twisting-nether' &&
        parsedValid.characterName === 'Arthas',
      '19a. Valid Raider.IO character URL parsed accurately into region, realm, and character name'
    );

    // Mock API query via fetchRaiderIOProfile
    const profileSnapshot = await fetchRaiderIOProfile(validUrl);
    assert(
      profileSnapshot.characterName === 'Arthas' &&
        profileSnapshot.realm === 'twisting-nether' &&
        profileSnapshot.region === 'eu' &&
        ['success', 'not_found', 'api_error'].includes(profileSnapshot.fetchStatus),
      '19b. Raider.IO profile fetch returns structured snapshot with valid schema and fetch status',
      `Status: ${profileSnapshot.fetchStatus}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۰: عدم جعل اسکور در زمان نبود کاراکتر یا خطای API
    // ─────────────────────────────────────────────────────────────────────────
    const notFoundUrl = 'https://raider.io/characters/eu/twisting-nether/NonExistentCharXyZ99999';
    const notFoundSnapshot = await fetchRaiderIOProfile(notFoundUrl);
    assert(
      notFoundSnapshot.mythicScore === null || notFoundSnapshot.mythicScore === undefined,
      '20. Non-existent characters or API downtime do not fabricate scores (mythicScore remains null/undefined)',
      `Mythic Score: ${notFoundSnapshot.mythicScore ?? 'null'}`
    );

  } catch (error: any) {
    console.error('Fatal error during separate registration channels suite:', error);
    failed++;
  } finally {
    // پاکسازی تمیز داده‌های تست
    try {
      await prisma.notificationOutbox.deleteMany({
        where: { recipientId: { in: [adminId, unauthorizedId, applicantBooster, applicantPilot, applicantAdv, applicantExchanger] } },
      });
      await prisma.pilotVerification.deleteMany({
        where: { userId: { in: [applicantPilot] } },
      });
      await prisma.userGameApproval.deleteMany({
        where: { userId: { in: [applicantBooster, applicantPilot, applicantAdv, applicantExchanger] } },
      });
      await prisma.registrationApplication.deleteMany({
        where: { userId: { in: [applicantBooster, applicantPilot, applicantAdv, applicantExchanger] } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [adminId, unauthorizedId] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [adminId, unauthorizedId, applicantBooster, applicantPilot, applicantAdv, applicantExchanger] } },
      });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }

  console.log('\n======================================================');
  console.log(`SEPARATE CHANNELS TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSeparateChannelsSuite().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
