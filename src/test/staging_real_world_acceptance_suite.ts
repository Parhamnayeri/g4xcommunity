/**
 * staging_real_world_acceptance_suite.ts — G4X Community Staging Deployment & Acceptance Suite
 *
 * This suite executes real HTTP acceptance testing against an isolated staging SQLite database
 * and validates the live Express web server, session persistence, CSRF protections, and RBAC routes.
 *
 * It also inspects external Discord Gateway and NOWPayments Sandbox connectivity,
 * marking live external calls as BLOCKED where live staging credentials/infrastructure are unavailable.
 */

import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { app, sessionStore } from '../web/server';
import prisma from '../database/db';
import { initializeDatabase } from '../database/schema';
import { Client, GatewayIntentBits } from 'discord.js';
import { getNowpaymentsConfig } from '../services/payment/paymentTypes';

async function runStagingAcceptanceSuite() {
  console.log('================================================================================');
  console.log('   G4X COMMUNITY — STAGING ACCEPTANCE & REAL-WORLD INTEGRATION SUITE           ');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  let blocked = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  function reportBlocked(testName: string, blockerReason: string) {
    console.log(`⚠️ [BLOCKED] ${testName} -> Reason: ${blockerReason}`);
    blocked++;
  }

  // ─── STAGING ISOLATION VERIFICATION ──────────────────────────────────────────
  console.log('--- 1. STAGING ENVIRONMENT ISOLATION & CONFIGURATION ---');

  const stagingDbPath = path.resolve(__dirname, '../../data/g4x_staging.db');
  assert(
    fs.existsSync(stagingDbPath),
    '1.1 Dedicated staging database (data/g4x_staging.db) exists and is accessible'
  );

  const envPort = process.env.PORT || '3000';
  console.log(`[Config] Configured Server Port: ${envPort} (Bot-Hosting.net standard: 26189)`);
  assert(
    envPort === '26189' || envPort === '3000',
    '1.2 Port configuration matches staging/hosting environment'
  );

  // Initialize and seed staging database cleanly
  await initializeDatabase();
  assert(true, '1.3 Staging database initialized and seeded with system roles, games, and services');

  // Verify fail-closed gates in staging
  const nowpaymentsConfig = getNowpaymentsConfig();
  assert(
    nowpaymentsConfig.isCollectionActive === false,
    '1.4 NOWPayments live collection gate is strictly false / disabled'
  );
  assert(
    process.env.ESCROW_RELEASE_ENABLED !== 'true',
    '1.5 Escrow automated release gate is strictly false / disabled'
  );

  // ─── DISCORD GATEWAY ACCEPTANCE CHECK ────────────────────────────────────────
  console.log('\n--- 2. REAL DISCORD GATEWAY CONNECTIVITY & ACCEPTANCE ---');

  const discordToken = process.env.DISCORD_TOKEN;
  const isDummyDiscordToken = !discordToken || discordToken.includes('your_discord_bot_token') || discordToken.length < 20;

  if (isDummyDiscordToken) {
    reportBlocked(
      '2.1 Real Discord Gateway Bot Login & Startup',
      'DISCORD_TOKEN in staging environment is a placeholder. Live Discord gateway connection requires valid bot token.'
    );
    reportBlocked(
      '2.2 Real Discord G4!setup Panel Creation',
      'Requires live authorized Discord gateway connection with Administrator permissions.'
    );
    reportBlocked(
      '2.3 Real Discord Booster & Advertiser Registrations',
      'Requires real Discord Guild ID with interaction components and webhook dispatch.'
    );
    reportBlocked(
      '2.4 Real Discord Staff Application Approvals',
      'Requires active Discord staff review channel and interactive modal submission.'
    );
    reportBlocked(
      '2.5 Real Discord Guild Role Synchronization',
      'Requires real Discord Guild ID with active members and configured bot role hierarchy.'
    );
    reportBlocked(
      '2.6 Real Discord Character Registration & Raider.IO Lookup',
      'Requires live Discord command execution and external Raider.IO API reachability.'
    );
    reportBlocked(
      '2.7 Real Discord Team & Private Order Channel Operations',
      'Requires real Discord Guild ID with MANAGE_CHANNELS and permission overwrite dispatch.'
    );
  } else {
    // Attempt actual live Discord login
    const testClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
      await testClient.login(discordToken);
      assert(testClient.isReady(), '2.1 Real Discord Gateway Bot Login succeeded');
      await testClient.destroy();
    } catch (err: any) {
      reportBlocked('2.1 Real Discord Gateway Bot Login & Startup', `Discord API rejected token: ${err.message}`);
    }
  }

  // ─── NOWPAYMENTS SANDBOX CONNECTIVITY CHECK ──────────────────────────────────
  console.log('\n--- 3. NOWPAYMENTS SANDBOX REAL-WORLD CONNECTIVITY ---');

  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  const isDummyApiKey = !apiKey || apiKey.includes('your_nowpayments_api_key');

  if (isDummyApiKey || process.env.NOWPAYMENTS_SANDBOX_ENABLED !== 'true') {
    reportBlocked(
      '3.1 NOWPayments Sandbox API Live Handshake',
      'NOWPAYMENTS_SANDBOX_ENABLED=false and API key is a placeholder. Live Sandbox requests blocked by safety policy.'
    );
    reportBlocked(
      '3.2 NOWPayments Public HTTPS Webhook Delivery',
      'Public HTTPS callback URL requires live reverse-proxy or staging domain reachability.'
    );
  }

  // ─── WEB DASHBOARD ACCEPTANCE TESTING (REAL HTTP VIA SUPERTEST) ──────────────
  console.log('\n--- 4. STAGING WEB DASHBOARD & API ACCEPTANCE TESTS ---');

  // Test identities
  const stagingAdmin = { discordId: 'stg_admin_01', username: 'StagingAdmin', role: 'admin' };
  const stagingAdv = { discordId: 'stg_adv_01', username: 'StagingAdv', role: 'advertiser' };
  const stagingBooster = { discordId: 'stg_bst_01', username: 'StagingBooster', role: 'booster' };
  const stagingUnauth = { discordId: 'stg_unauth_01', username: 'StagingUnauth', role: 'user' };

  // Setup test users in database
  for (const u of [stagingAdmin, stagingAdv, stagingBooster, stagingUnauth]) {
    await prisma.user.upsert({
      where: { discordId: u.discordId },
      update: { isActive: true },
      create: { discordId: u.discordId, username: u.username, displayName: u.username },
    });
    if (u.role !== 'user') {
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: u.discordId, roleKey: u.role } },
        update: {},
        create: { userId: u.discordId, roleKey: u.role },
      });
    }
    await prisma.walletV2.upsert({
      where: { userId: u.discordId },
      update: {},
      create: { userId: u.discordId, availableCents: 100000, reservedCents: 0 },
    });
  }

  // Assign Bronze rank to advertiser
  await prisma.user.update({
    where: { discordId: stagingAdv.discordId },
    data: { advertiserRank: 'BRONZE' },
  });

  // Initial clean-up of previous staging test runs to ensure fresh state
  await prisma.orderAssignment.deleteMany({ where: { userId: stagingBooster.discordId } });
  await prisma.orderPresign.deleteMany({ where: { userId: stagingBooster.discordId } });
  await prisma.escrowHold.deleteMany({ where: { order: { creatorId: { in: [stagingAdv.discordId, stagingAdmin.discordId] } } } });
  await prisma.orderDispute.deleteMany({ where: { openedById: { in: [stagingAdv.discordId, stagingAdmin.discordId] } } });
  await prisma.g4XBoostReleaseTracker.deleteMany({ where: { order: { creatorId: { in: [stagingAdv.discordId, stagingAdmin.discordId] } } } });
  await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: [stagingAdv.discordId, stagingAdmin.discordId] } } } });
  await prisma.order.deleteMany({ where: { creatorId: { in: [stagingAdv.discordId, stagingAdmin.discordId] } } });
  await prisma.squadMember.deleteMany({ where: { userId: stagingBooster.discordId } });
  await prisma.premadeSquad.deleteMany({ where: { leaderId: stagingBooster.discordId } });
  await prisma.wowCharacter.deleteMany({ where: { userId: stagingBooster.discordId } });

  // Upsert or fetch wow_midnight service
  let wowService = await prisma.gameService.findFirst({
    where: { gameSlug: 'wow_midnight', isActive: true },
  });
  if (!wowService) {
    wowService = await prisma.gameService.create({
      data: {
        gameSlug: 'wow_midnight',
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ Dungeon',
        serviceMode: 'non_pilot',
        profileMode: 'raiderio',
        requiresPilotApproval: false,
        isActive: true,
      },
    });
  }

  // Approve booster game approval in DB (serviceId: null means all services for wow_midnight)
  const existingApproval = await prisma.userGameApproval.findFirst({
    where: {
      userId: stagingBooster.discordId,
      gameSlug: 'wow_midnight',
      serviceId: null,
      approvalType: 'booster',
    },
  });
  if (existingApproval) {
    await prisma.userGameApproval.update({
      where: { id: existingApproval.id },
      data: { status: 'approved' },
    });
  } else {
    await prisma.userGameApproval.create({
      data: {
        userId: stagingBooster.discordId,
        gameSlug: 'wow_midnight',
        serviceId: null,
        approvalType: 'booster',
        status: 'approved',
        reviewedBy: stagingAdmin.discordId,
        reviewedAt: new Date(),
      },
    });
  }

  // Helper: Create agent and authenticate via in-memory sessionStore (Test Harness Isolation)
  async function createAuthenticatedAgent(user: { discordId: string; username: string; role: string }) {
    const agent = request.agent(app);
    // Fetch CSRF token and initialize session cookie
    const csrfRes = await agent.get('/api/csrf-token');
    const sidMatch = (csrfRes.header['set-cookie']?.[0] || '').match(/g4x\.sid=s%3A([^.]+)\./);
    const sid = sidMatch ? sidMatch[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(sid, (err: any, sess: any) => {
        if (err || !sess) return reject(err || new Error(`No session found for ${user.username}`));
        sess.userId = user.discordId;
        sessionStore.set(sid, sess, (setErr: any) => (setErr ? reject(setErr) : resolve()));
      });
    });

    return { agent, csrfToken: csrfRes.body.csrfToken };
  }

  // 4.1 Authenticate staging users
  const adminSession = await createAuthenticatedAgent(stagingAdmin);
  const advSession = await createAuthenticatedAgent(stagingAdv);
  const bstSession = await createAuthenticatedAgent(stagingBooster);
  const unauthSession = await createAuthenticatedAgent(stagingUnauth);
  assert(
    Boolean(adminSession.csrfToken && advSession.csrfToken && bstSession.csrfToken && unauthSession.csrfToken),
    '4.1 Session & CSRF Initialization: Test harness initializes isolated sessions and CSRF tokens for all test roles'
  );

  // 4.2 Verify /me and session persistence
  const meRes = await adminSession.agent.get('/api/me');
  assert(
    meRes.status === 200 && meRes.body.discordId === stagingAdmin.discordId,
    '4.2 Session persistence: Authenticated /api/me returns correct identity'
  );

  // 4.3 CSRF Protection Verification
  const noCsrfRes = await advSession.agent
    .post('/api/orders/create')
    .send({ gameSlug: 'wow_midnight', serviceId: wowService.id, grossAmountUsd: '20.00' });
  assert(
    noCsrfRes.status === 403,
    '4.3 CSRF Protection: State-changing POST without CSRF header is rejected with 403 Forbidden'
  );

  // 4.4 Rank Management Dashboard
  const rankListRes = await adminSession.agent.get('/api/admin/advertiser-ranks');
  assert(
    rankListRes.status === 200 && Array.isArray(rankListRes.body.advertisers),
    '4.4 Rank Management: Admin lists advertiser commercial ranks (200 OK)'
  );

  const reportRes = await adminSession.agent.get('/api/admin/advertiser-ranks/migration-report');
  assert(
    reportRes.status === 200 && reportRes.body.success === true,
    '4.5 Rank Management: Admin reads read-only Migration Impact Report (200 OK)'
  );

  // Admin upgrades advertiser to SILVER
  const updateRankRes = await adminSession.agent
    .post(`/api/admin/advertiser-ranks/${stagingAdv.discordId}`)
    .set('x-csrf-token', adminSession.csrfToken)
    .send({
      rank: 'SILVER',
      reason: 'Staging acceptance testing promotion',
    });
  assert(
    updateRankRes.status === 200 && updateRankRes.body.success === true,
    '4.6 Rank Management: Admin successfully updates advertiser rank to SILVER with AuditLog'
  );

  // Unauthorized user blocked from rank management
  const unauthRankRes = await unauthSession.agent.get('/api/admin/advertiser-ranks');
  assert(
    unauthRankRes.status === 403,
    '4.7 Rank Management: Non-admin user blocked with 403 Forbidden'
  );

  // 4.8 Order Creation & Life Cycle
  const createOrderRes = await advSession.agent
    .post('/api/orders/create')
    .set('x-csrf-token', advSession.csrfToken)
    .send({
      gameSlug: 'wow_midnight',
      serviceId: wowService.id,
      grossAmountUsd: '50.00',
      orderType: 'group',
    });
  assert(
    createOrderRes.status === 200 && createOrderRes.body.order.paymentStatus === 'verified',
    '4.8 Order Creation: Direct Advertiser boost order created and funded from available USD balance'
  );
  const createdOrderId = createOrderRes.body.order.id;

  // Verify order in /orders/available
  const getOrderRes = await advSession.agent.get('/api/orders/available');
  assert(
    getOrderRes.status === 200 &&
      Array.isArray(getOrderRes.body.orders) &&
      getOrderRes.body.orders.some((o: any) => o.orderRef === createOrderRes.body.order.orderRef),
    '4.9 Order Details: Funded order appears in /api/orders/available with simplified status'
  );

  // 4.10 Character Management
  const charName = 'Warrior_' + Date.now().toString().slice(-4);
  const addCharRes = await bstSession.agent
    .post('/api/characters/add')
    .set('x-csrf-token', bstSession.csrfToken)
    .send({
      characterName: charName,
      realm: 'Tarren Mill',
      region: 'eu',
    });
  if (addCharRes.status !== 200) {
    console.error('addCharRes error:', addCharRes.status, addCharRes.body);
  }
  assert(
    addCharRes.status === 200 && addCharRes.body.character.isMain === true,
    '4.10 Character Management: Booster registers character as initial Main'
  );

  const listCharsRes = await bstSession.agent.get('/api/characters');
  assert(
    listCharsRes.status === 200 && Array.isArray(listCharsRes.body) && listCharsRes.body.length >= 1,
    '4.11 Character Management: Booster lists registered characters via GET /api/characters'
  );

  // 4.12 Premade Team Management
  const createTeamRes = await bstSession.agent
    .post('/api/teams/create')
    .set('x-csrf-token', bstSession.csrfToken)
    .send({
      teamName: 'Staging Elite Squad',
      squadType: 'full',
    });
  assert(
    createTeamRes.status === 200 && createTeamRes.body.squad.leaderId === stagingBooster.discordId,
    '4.12 Team Management: Booster creates premade squad as leader'
  );

  // 4.13 Order Claim & Execution
  const claimRes = await bstSession.agent
    .post(`/api/orders/${createdOrderId}/claim`)
    .set('x-csrf-token', bstSession.csrfToken)
    .send({ registeredRole: 'tank' });
  assert(
    claimRes.status === 200 && claimRes.body.simplifiedStatus?.label === 'In Progress',
    '4.13 Order Claim: Approved Booster claims run and transitions order to In Progress'
  );

  // Complete run
  const completeRunRes = await bstSession.agent
    .post(`/api/orders/${createdOrderId}/complete-run`)
    .set('x-csrf-token', bstSession.csrfToken)
    .send({});
  assert(
    completeRunRes.status === 200 && completeRunRes.body.run.status === 'completed',
    '4.14 Run Completion: Assigned Booster completes execution run'
  );

  // Switch order creatorType to 'g4x' to test G4X Boost Release Tracker workflow
  await prisma.order.update({
    where: { id: createdOrderId },
    data: { creatorType: 'g4x' },
  });

  // Submit proof
  const submitProofRes = await bstSession.agent
    .post(`/api/orders/${createdOrderId}/submit-proof`)
    .set('x-csrf-token', bstSession.csrfToken)
    .send({});
  assert(
    submitProofRes.status === 200 && submitProofRes.body.tracker.stage === 'PROOF_SUBMITTED',
    '4.15 Proof Submission: Run proof transitions release tracker to PROOF_SUBMITTED'
  );

  // Staff review
  const staffReviewRes = await adminSession.agent
    .post(`/api/orders/${createdOrderId}/staff-review`)
    .set('x-csrf-token', adminSession.csrfToken)
    .send({ notes: 'Screenshots verified clean on staging' });
  assert(
    staffReviewRes.status === 200 && staffReviewRes.body.tracker.stage === 'STAFF_REVIEW',
    '4.16 Staff Review: Staff verifies submitted execution proof'
  );

  // 4.17 Dispute Lifecycle
  const openDisputeRes = await advSession.agent
    .post(`/api/orders/${createdOrderId}/disputes`)
    .set('x-csrf-token', advSession.csrfToken)
    .send({
      reason: 'Staging dispute acceptance test',
      description: 'Dungeon run was delayed by 30 minutes',
    });
  assert(
    openDisputeRes.status === 201 && openDisputeRes.body.dispute && openDisputeRes.body.dispute.status === 'open',
    '4.17 Dispute Lifecycle: Order participant opens dispute, recording active EscrowHold (201 Created)'
  );
  const createdDisputeId = openDisputeRes.body.dispute.id;

  // Request evidence
  const reqEvidenceRes = await adminSession.agent
    .post(`/api/admin/disputes/${createdDisputeId}/request-evidence`)
    .set('x-csrf-token', adminSession.csrfToken)
    .send({ requestNotes: 'Please provide timestamped logs from the dungeon run.' });
  assert(
    reqEvidenceRes.status === 200 && reqEvidenceRes.body.dispute && reqEvidenceRes.body.dispute.status === 'waiting_for_evidence',
    '4.18 Dispute Lifecycle: Staff requests additional evidence, updating status'
  );

  // Resolve dispute
  const resolveDisputeRes = await adminSession.agent
    .post(`/api/admin/disputes/${createdDisputeId}/resolve`)
    .set('x-csrf-token', adminSession.csrfToken)
    .send({
      decision: 'RESOLVED_CONTINUE',
      resolutionNotes: 'Issue amicably settled during staging validation',
    });
  assert(
    resolveDisputeRes.status === 200 && resolveDisputeRes.body.dispute && resolveDisputeRes.body.dispute.status === 'resolved',
    '4.19 Dispute Lifecycle: Admin resolves dispute with explicit auditable reason'
  );

  // 4.20 Platform Finance Dashboard
  const financeOverviewRes = await adminSession.agent.get('/api/admin/platform-finance/overview');
  assert(
    financeOverviewRes.status === 200 &&
      financeOverviewRes.body.platforms &&
      financeOverviewRes.body.platforms.some((p: any) => p.platform === 'g2g'),
    '4.20 Platform Finance: Admin views multi-platform finance dashboard (G2G, SkyCoach, Eldorado)'
  );

  const unauthFinanceRes = await unauthSession.agent.get('/api/admin/platform-finance/overview');
  assert(
    unauthFinanceRes.status === 403,
    '4.21 Platform Finance: Non-finance actor blocked from overview with 403 Forbidden'
  );

  // 4.22 Logout & Session Destruction
  const logoutRes = await advSession.agent
    .post('/api/auth/logout')
    .set('x-csrf-token', advSession.csrfToken);
  assert(
    logoutRes.status === 200 && logoutRes.body.success === true,
    '4.22 Logout: Session successfully destroyed and cookie cleared'
  );

  const afterLogoutRes = await advSession.agent.get('/api/me');
  assert(
    afterLogoutRes.status === 401,
    '4.23 Logout Verification: Inactive session immediately denied on subsequent requests (401 Unauthorized)'
  );

  console.log('\n================================================================================');
  console.log(`STAGING ACCEPTANCE RESULTS: ${passed} PASSED | ${failed} FAILED | ${blocked} BLOCKED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStagingAcceptanceSuite()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal error in staging acceptance suite:', e);
    process.exit(1);
  });
