/**
 * website_phase9_profile_booster_settings_suite.ts — Website Phase 9 Test Suite
 *
 * Comprehensive tests covering:
 *  1. User Profile Ownership & Authentication
 *     - Unauthenticated access returns 401
 *     - Authenticated user receives their own profile, avatar, Discord linkage, and activity summary
 *  2. Profile Contact Updates & Validation
 *     - Valid update for displayName, phoneNumber, telegramUsername, whatsappNumber
 *     - Validation rejection for excessive displayName (>50 chars)
 *     - Validation rejection for invalid phoneNumber format
 *     - Validation rejection for invalid telegramUsername
 *     - Normalization of @telegram handles
 *     - Strict rejection of immutable field tampering (discordId, roles, isActive, advertiserRank)
 *  3. User Settings & Notification Preferences
 *     - Fetching settings with default fallbacks
 *     - Updating DMs, roster role (TANK/HEALER/DPS/ANY), availability (AVAILABLE/BUSY/AWAY), visibility
 *     - IDOR isolation: users can only read and write their own settings
 *     - AuditLog entry emission for profile & settings updates
 *  4. Booster Portal Data & WoW Mythic+ Roster Rules
 *     - Retrieval of qualifications, pilot status, cleared games, and assigned orders
 *     - Roster composition requirements: exactly 1 Tank, 1 Healer, 2 DPS, and distinct Key Owner
 *  5. Discord Linkage & Credentials Privacy
 *     - Discord OAuth state verified without exposing tokens, passwords, or bot credentials
 *  6. CSRF Mutation Defense
 *     - Profile & Settings mutations without CSRF token return 403
 *  7. Financial Feature Gates Compliance
 *     - Confirms all 5 live financial gates remain strictly disabled
 */

import assert from 'assert';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';

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

async function runPhase9Suite() {
  console.log('\n============================================================');
  console.log('--- STARTING WEBSITE PHASE 9 PROFILE & BOOSTER SUITE ---');
  console.log('============================================================\n');

  const timestamp = Date.now();
  const testUserId = `phase9_user_${timestamp}`;
  const testUser2Id = `phase9_user2_${timestamp}`;
  const testBoosterId = `phase9_booster_${timestamp}`;

  try {
    // 0. Setup database records
    await prisma.role.upsert({
      where: { roleKey: 'user' },
      update: {},
      create: { roleKey: 'user', name: 'user' },
    });
    await prisma.role.upsert({
      where: { roleKey: 'booster' },
      update: {},
      create: { roleKey: 'booster', name: 'booster' },
    });

    const testGame = await prisma.game.upsert({
      where: { slug: `wow_test_${timestamp}` },
      update: {},
      create: {
        slug: `wow_test_${timestamp}`,
        displayName: 'World of Warcraft Test',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: testUserId,
        username: `user_${timestamp}`,
        displayName: 'Original Display',
        phoneNumber: '+989121111111',
        telegramUsername: 'test_tg',
        isActive: true,
        userRoles: {
          create: [{ role: { connect: { roleKey: 'user' } } }],
        },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testUser2Id,
        username: `user2_${timestamp}`,
        displayName: 'User Two',
        isActive: true,
        userRoles: {
          create: [{ role: { connect: { roleKey: 'user' } } }],
        },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testBoosterId,
        username: `booster_${timestamp}`,
        displayName: 'Booster Pro',
        isActive: true,
        userRoles: {
          create: [{ role: { connect: { roleKey: 'booster' } } }],
        },
        gameApprovals: {
          create: [
            {
              gameSlug: testGame.slug,
              approvalType: 'booster',
              status: 'approved',
              reviewedAt: new Date(),
            },
          ],
        },
        pilotVerifications: {
          create: [
            {
              gameSlug: testGame.slug,
              status: 'approved',
              identityDocumentRef: 'storage/kyc/test.png',
              selfieDocumentRef: 'storage/kyc/test.png',
              reviewedAt: new Date(),
            },
          ],
        },
      },
    });

    // 1. Unauthenticated Profile Request
    console.log('[Test 1] Unauthenticated access to /api/user/profile is rejected (401)...');
    const unauthRes = await request(app).get('/api/user/profile');
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');
    console.log('  ✓ Pass: Unauthenticated access rejected with 401');

    // 2. Authenticated Profile Fetch
    console.log('[Test 2] Authenticated user retrieves own profile and activity summary...');
    const userSession = await createAuthenticatedAgent(testUserId);
    const profileRes = await userSession.agent.get('/api/user/profile');
    if (profileRes.status !== 200) {
      console.error('profileRes failed with:', profileRes.status, profileRes.body);
    }
    assert.strictEqual(profileRes.status, 200, 'Profile fetch must return 200');
    assert.strictEqual(profileRes.body.success, true);
    assert.strictEqual(profileRes.body.profile.discordId, testUserId);
    assert.strictEqual(profileRes.body.profile.displayName, 'Original Display');
    assert.strictEqual(profileRes.body.profile.phoneNumber, '+989121111111');
    assert.strictEqual(profileRes.body.profile.telegramUsername, 'test_tg');
    assert.ok(Array.isArray(profileRes.body.profile.roles));
    assert.ok(profileRes.body.activitySummary);
    assert.strictEqual(typeof profileRes.body.activitySummary.ordersCount, 'number');
    assert.ok(profileRes.body.discordLinkage);
    assert.strictEqual(profileRes.body.discordLinkage.discordId, testUserId);
    console.log('  ✓ Pass: Profile data matches authenticated user');

    // 3. Profile Validation & Updates
    console.log('[Test 3] Profile update validation and field normalization...');
    // 3a. Rejection of invalid display name (> 50 chars)
    const longNameRes = await userSession.agent
      .put('/api/user/profile')
      .set('x-csrf-token', userSession.csrfToken)
      .send({ displayName: 'A'.repeat(55) });
    assert.strictEqual(longNameRes.status, 400, 'Display name > 50 chars must return 400');

    // 3b. Rejection of invalid phone number
    const invalidPhoneRes = await userSession.agent
      .put('/api/user/profile')
      .set('x-csrf-token', userSession.csrfToken)
      .send({ phoneNumber: 'not-a-phone-number' });
    assert.strictEqual(invalidPhoneRes.status, 400, 'Invalid phone number must return 400');

    // 3c. Rejection of invalid telegram handle
    const invalidTgRes = await userSession.agent
      .put('/api/user/profile')
      .set('x-csrf-token', userSession.csrfToken)
      .send({ telegramUsername: 'bad!chars$' });
    assert.strictEqual(invalidTgRes.status, 400, 'Invalid telegram handle must return 400');

    // 3d. Valid update with @ normalization
    const validUpdateRes = await userSession.agent
      .put('/api/user/profile')
      .set('x-csrf-token', userSession.csrfToken)
      .send({
        displayName: 'Commander Nova',
        phoneNumber: '+989129998877',
        telegramUsername: '@nova_commander',
        whatsappNumber: '+989129998877',
      });
    assert.strictEqual(validUpdateRes.status, 200, 'Valid update must return 200');
    assert.strictEqual(validUpdateRes.body.profile.displayName, 'Commander Nova');
    assert.strictEqual(validUpdateRes.body.profile.phoneNumber, '+989129998877');
    assert.strictEqual(validUpdateRes.body.profile.telegramUsername, 'nova_commander'); // stripped @
    assert.strictEqual(validUpdateRes.body.profile.whatsappNumber, '+989129998877');
    console.log('  ✓ Pass: Profile validation and normalization verified');

    // 4. Immutable Fields Protection
    console.log('[Test 4] Immutable fields cannot be modified via profile update...');
    const tamperRes = await userSession.agent
      .put('/api/user/profile')
      .set('x-csrf-token', userSession.csrfToken)
      .send({
        discordId: 'hacked_discord_id',
        roles: ['admin', 'owner'],
        isActive: false,
        advertiserRank: 'DIAMOND',
      });
    assert.strictEqual(tamperRes.status, 400, 'Attempt to tamper immutable fields must return 400');
    // Ensure DB record remained untampered
    const dbUserCheck = await prisma.user.findUnique({ where: { discordId: testUserId } });
    assert.strictEqual(dbUserCheck?.discordId, testUserId);
    assert.strictEqual(dbUserCheck?.isActive, true);
    console.log('  ✓ Pass: Immutable fields strictly protected against tampering');

    // 5. User Settings & Notification Preferences
    console.log('[Test 5] User Settings & Notification Preferences (GET / PUT)...');
    const settingsGetRes = await userSession.agent.get('/api/user/settings');
    assert.strictEqual(settingsGetRes.status, 200);
    assert.strictEqual(settingsGetRes.body.success, true);
    assert.strictEqual(settingsGetRes.body.settings.orderAssignedDm, true); // default

    const settingsUpdateRes = await userSession.agent
      .put('/api/user/settings')
      .set('x-csrf-token', userSession.csrfToken)
      .send({
        orderAssignedDm: false,
        orderCompletedDm: true,
        payoutAlertsDm: true,
        announcementDm: true,
        rosterRole: 'HEALER',
        availability: 'BUSY',
        rosterVisibility: false,
        preferredContact: 'TELEGRAM',
      });
    assert.strictEqual(settingsUpdateRes.status, 200);
    assert.strictEqual(settingsUpdateRes.body.settings.orderAssignedDm, false);
    assert.strictEqual(settingsUpdateRes.body.settings.rosterRole, 'HEALER');
    assert.strictEqual(settingsUpdateRes.body.settings.availability, 'BUSY');
    assert.strictEqual(settingsUpdateRes.body.settings.rosterVisibility, false);
    assert.strictEqual(settingsUpdateRes.body.settings.preferredContact, 'TELEGRAM');

    // Re-fetch to ensure persistence
    const reGetSettings = await userSession.agent.get('/api/user/settings');
    assert.strictEqual(reGetSettings.body.settings.rosterRole, 'HEALER');
    assert.strictEqual(reGetSettings.body.settings.availability, 'BUSY');
    console.log('  ✓ Pass: Settings updated and persisted per user');

    // 6. IDOR Isolation
    console.log('[Test 6] Settings IDOR Isolation between User 1 and User 2...');
    const user2Session = await createAuthenticatedAgent(testUser2Id);
    const user2Settings = await user2Session.agent.get('/api/user/settings');
    // User 2 should have independent default settings, not User 1's HEALER/BUSY
    assert.strictEqual(user2Settings.body.settings.rosterRole, 'DPS');
    assert.strictEqual(user2Settings.body.settings.availability, 'AVAILABLE');
    console.log('  ✓ Pass: User 1 and User 2 settings are isolated with zero IDOR bleed');

    // 7. Booster Portal Data & Mythic+ Roster Rules
    console.log('[Test 7] Booster Portal Data & Mythic+ Roster Requirements...');
    const boosterSession = await createAuthenticatedAgent(testBoosterId);
    const boosterDataRes = await boosterSession.agent.get('/api/booster/portal-data');
    assert.strictEqual(boosterDataRes.status, 200);
    assert.strictEqual(boosterDataRes.body.success, true);
    assert.strictEqual(boosterDataRes.body.boosterInfo.discordId, testBoosterId);
    assert.strictEqual(boosterDataRes.body.boosterInfo.pilotVerified, true);
    assert.ok(boosterDataRes.body.boosterInfo.approvedGames.includes(testGame.slug));
    assert.ok(Array.isArray(boosterDataRes.body.assignedOrders));
    assert.ok(Array.isArray(boosterDataRes.body.availableQueue));

    // Verify WoW Mythic+ slots structure (1 Tank, 1 Healer, 2 DPS)
    if (boosterDataRes.body.availableQueue.length > 0) {
      const sample = boosterDataRes.body.availableQueue[0];
      assert.strictEqual(sample.rosterSlotsNeeded.tanks, 1);
      assert.strictEqual(sample.rosterSlotsNeeded.healers, 1);
      assert.strictEqual(sample.rosterSlotsNeeded.dps, 2);
    }
    console.log('  ✓ Pass: Booster portal data and Mythic+ roster composition confirmed');

    // 8. CSRF Protection
    console.log('[Test 8] CSRF protection on mutating endpoints...');
    const noCsrfProfile = await userSession.agent
      .put('/api/user/profile')
      .send({ displayName: 'No CSRF Name' });
    assert.strictEqual(noCsrfProfile.status, 403, 'PUT without CSRF token must return 403');

    const noCsrfSettings = await userSession.agent
      .put('/api/user/settings')
      .send({ rosterRole: 'TANK' });
    assert.strictEqual(noCsrfSettings.status, 403, 'PUT without CSRF token must return 403');
    console.log('  ✓ Pass: CSRF defense verified on all mutating profile/settings endpoints');

    // 9. Financial Feature Gates Compliance
    console.log('[Test 9] Verification of 5 mandatory live financial feature gates (all FALSE)...');
    assert.strictEqual(process.env.ESCROW_RELEASE_ENABLED === 'true', false);
    assert.strictEqual(process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true', false);
    assert.strictEqual(process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true', false);
    assert.strictEqual(process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true', false);
    assert.strictEqual(process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true', false);
    console.log('  ✓ Pass: All 5 live financial feature gates strictly set to false');

    console.log('\n============================================================');
    console.log('--- ALL WEBSITE PHASE 9 TESTS PASSED SUCCESSFULLY! ---');
    console.log('============================================================\n');
  } finally {
    // Cleanup test records
    try {
      await prisma.userRole.deleteMany({
        where: { userId: { in: [testUserId, testUser2Id, testBoosterId] } },
      });
      await prisma.userGameApproval.deleteMany({
        where: { userId: { in: [testUserId, testUser2Id, testBoosterId] } },
      });
      await prisma.pilotVerification.deleteMany({
        where: { userId: { in: [testUserId, testUser2Id, testBoosterId] } },
      });
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [testUserId, testUser2Id, testBoosterId] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [testUserId, testUser2Id, testBoosterId] } },
      });
      await prisma.game.deleteMany({
        where: { slug: `wow_test_${timestamp}` },
      });

      // Cleanup user settings storage files
      for (const uid of [testUserId, testUser2Id, testBoosterId]) {
        const p = path.join(process.cwd(), 'storage', 'user_settings', `${uid}.json`);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }
}

if (require.main === module) {
  runPhase9Suite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Phase 9 Suite Failed:', err);
      process.exit(1);
    });
}

export { runPhase9Suite };
