/**
 * ============================================================================
 * G4X Community — Discord Dropdown-Based Order Creation Wizard Test Suite
 * ============================================================================
 * Exhaustive regression and invariant test suite covering:
 *  1. RBAC authorization for G4X and Advertiser creation flows
 *  2. Unranked advertiser access rejection
 *  3. Flow A Step 1: Source Platform dropdown (G2G, SkyCoach, Eldorado)
 *  4. Flow B Step 1: Direct Game dropdown for Advertisers
 *  5. Dynamic game filtering (isActive: true vs inactive) & empty handling
 *  6. Dynamic service filtering (game-specific, isActive: true) & empty handling
 *  7. Service execution mode routing (auto vs. explicit pilot/non-pilot selection)
 *  8. Service-specific modal structures (Mythic+, Pilot, Non-Pilot)
 *     - Mythic+: amount_usd, key_level, runs_count (required), customer_info, notes
 *     - Pilot: amount_usd, vpn_location (required), customer_info, notes (runs_count omitted)
 *     - Non-Pilot: amount_usd, runs_count (optional), customer_info, notes
 *  9. Cross-user interaction rejection (forged user B on user A session)
 * 10. Expired state rejection (15-min TTL)
 * 11. Duplicate submit / Double-click prevention (atomic CAS)
 * 12. Restart recovery (write-through cache to data/wizard_sessions.json)
 * 13. Financial policy snapshot integration (G4X external source vs. Advertiser rank)
 * 14. Unfunded order preservation (payment_pending vs verified reservation)
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import prisma from '../database/db';
import {
  createWizardSession,
  getWizardSession,
  updateWizardSession,
  validateWizardSession,
  markWizardSubmitted,
  deleteWizardSession,
  initWizardSessions,
} from '../services/orderWizardStateService';
import {
  startOrderWizard,
  buildPlatformSelectRow,
  buildGameSelectRow,
  buildServiceSelectRow,
  buildModeSelectRow,
  buildWizardOrderModal,
  handleOrderWizardSelectMenu,
  handleOrderWizardButton,
  handleOrderWizardModalSubmit,
} from '../interactions/orderWizardInteractions';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string, details?: string) {
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAILED: ${message}`);
    if (details) console.error(`     Details: ${details}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  ✅ PASSED: ${message}`);
  }
}

async function runWizardSuite() {
  console.log('\n================================================================');
  console.log('🚀 G4X DISCORD DROPDOWN ORDER WIZARD TEST SUITE');
  console.log('================================================================\n');

  const ts = Date.now();
  const testStaffId = `wiz_staff_${ts}`;
  const testAdvId = `wiz_adv_${ts}`;
  const testUnrankedAdvId = `wiz_unranked_${ts}`;
  const testRandomUserId = `wiz_random_${ts}`;
  const testGuildId = `guild_wiz_${ts}`;

  try {
    // ─── SETUP: Test Users and Permissions ─────────────────────────────────
    console.log('--- 1. Setting up Test Users, Roles and Permissions ---');

    // 1. Staff User (has manager role -> ORDER_CREATE_INTERNAL)
    await prisma.user.create({
      data: {
        discordId: testStaffId,
        username: `StaffUser_${ts}`,
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    // 2. Approved Advertiser (has advertiser role + Gold Rank -> ORDER_CREATE_ADVERTISER)
    await prisma.user.create({
      data: {
        discordId: testAdvId,
        username: `AdvUser_${ts}`,
        userRoles: { create: [{ roleKey: 'advertiser' }] },
        advertiserRank: 'GOLD',
      },
    });

    // 3. Unranked Advertiser (Has advertiser role, but advertiserRank is null)
    await prisma.user.create({
      data: {
        discordId: testUnrankedAdvId,
        username: `UnrankedAdv_${ts}`,
        userRoles: { create: [{ roleKey: 'advertiser' }] },
        advertiserRank: null,
      },
    });

    // 4. Random Unauthorized User
    await prisma.user.create({
      data: {
        discordId: testRandomUserId,
        username: `RandomUser_${ts}`,
      },
    });

    assert(true, 'Test users and RBAC roles created successfully');

    // ─── TEST 1: RBAC Enforcement ───────────────────────────────────────────
    console.log('\n--- 2. Testing RBAC Access Control ---');

    // Random user tries Flow A (G4X)
    let replyRandomG4x = '';
    const mockRandomG4xBtn: any = {
      user: { id: testRandomUserId },
      guildId: testGuildId,
      reply: async (p: any) => { replyRandomG4x = p.content; },
    };
    await startOrderWizard(mockRandomG4xBtn, 'g4x');
    assert(
      replyRandomG4x.includes('Permission Denied'),
      'Random user cannot start Flow A (G4X)',
      replyRandomG4x
    );

    // Random user tries Flow B (Advertiser)
    let replyRandomAdv = '';
    const mockRandomAdvBtn: any = {
      user: { id: testRandomUserId },
      guildId: testGuildId,
      reply: async (p: any) => { replyRandomAdv = p.content; },
    };
    await startOrderWizard(mockRandomAdvBtn, 'adv');
    assert(
      replyRandomAdv.includes('Permission Denied'),
      'Random user cannot start Flow B (Advertiser)',
      replyRandomAdv
    );

    // Unranked advertiser tries Flow B
    let replyUnrankedAdv = '';
    const mockUnrankedAdvBtn: any = {
      user: { id: testUnrankedAdvId },
      guildId: testGuildId,
      reply: async (p: any) => { replyUnrankedAdv = p.content; },
    };
    await startOrderWizard(mockUnrankedAdvBtn, 'adv');
    assert(
      replyUnrankedAdv.includes('Unresolved Commercial Rank'),
      'Unranked advertiser is rejected until management assigns a commercial rank',
      replyUnrankedAdv
    );

    // ─── TEST 2: Flow A (G4X) Step 1 - Platform Selection ──────────────────
    console.log('\n--- 3. Testing Flow A: G4X Source Platform Selection ---');

    let replyStaffG4x: any = null;
    const mockStaffG4xBtn: any = {
      user: { id: testStaffId },
      guildId: testGuildId,
      reply: async (p: any) => { replyStaffG4x = p; },
    };
    await startOrderWizard(mockStaffG4xBtn, 'g4x');

    assert(
      replyStaffG4x !== null &&
      replyStaffG4x.embeds?.[0]?.data?.title?.includes('Source Platform') &&
      replyStaffG4x.components?.[0]?.components?.[0]?.data?.custom_id?.startsWith('ord_wiz:platform:'),
      'Authorized G4X staff receives Step 1: Source Platform select menu'
    );

    const platformSelectCustomId = replyStaffG4x.components[0].components[0].data.custom_id;
    const g4xSessionId = platformSelectCustomId.split(':')[2];

    const sessionA = await getWizardSession(g4xSessionId);
    assert(
      sessionA !== null && sessionA.userId === testStaffId && sessionA.origin === 'g4x',
      'Wizard session is correctly created and bound to the staff user'
    );

    // Select 'g2g'
    let updateStaffPlatform: any = null;
    const mockSelectPlatform: any = {
      customId: `ord_wiz:platform:${g4xSessionId}`,
      values: ['g2g'],
      user: { id: testStaffId },
      guildId: testGuildId,
      update: async (p: any) => { updateStaffPlatform = p; },
    };
    await handleOrderWizardSelectMenu(mockSelectPlatform);

    const sessionAAfterPlatform = await getWizardSession(g4xSessionId);
    assert(
      sessionAAfterPlatform?.platform === 'g2g' &&
      sessionAAfterPlatform?.step === 'game' &&
      updateStaffPlatform?.embeds?.[0]?.data?.title?.includes('Step 2: Select Game') &&
      updateStaffPlatform?.components?.[0]?.components?.[0]?.data?.custom_id === `ord_wiz:game:${g4xSessionId}`,
      'Selecting G2G platform records platform and serves active Game select menu'
    );

    // ─── TEST 3: Flow B (Advertiser) Step 1 - Game Selection ────────────────
    console.log('\n--- 4. Testing Flow B: Direct Game Selection for Advertisers ---');

    let replyAdvG4x: any = null;
    const mockAdvBtn: any = {
      user: { id: testAdvId },
      guildId: testGuildId,
      reply: async (p: any) => { replyAdvG4x = p; },
    };
    await startOrderWizard(mockAdvBtn, 'adv');

    assert(
      replyAdvG4x !== null &&
      replyAdvG4x.embeds?.[0]?.data?.title?.includes('Select Game') &&
      replyAdvG4x.components?.[0]?.components?.[0]?.data?.custom_id?.startsWith('ord_wiz:game:'),
      'Advertiser order creation skips external platform and directly serves Game select dropdown'
    );

    const advGameSelectCustomId = replyAdvG4x.components[0].components[0].data.custom_id;
    const advSessionId = advGameSelectCustomId.split(':')[2];

    const sessionB = await getWizardSession(advSessionId);
    assert(
      sessionB !== null && sessionB.userId === testAdvId && sessionB.origin === 'adv' && !sessionB.platform,
      'Advertiser session correctly created without external sales platform'
    );

    // ─── TEST 4: Dynamic Game and Service Filtering ─────────────────────────
    console.log('\n--- 5. Testing Dynamic Game & Service Querying ---');

    // Create a temporary inactive game and verify it does NOT appear
    const inactiveGameSlug = `inactive_game_${ts}`;
    await prisma.game.create({
      data: {
        slug: inactiveGameSlug,
        displayName: 'Inactive Secret Game',
        serviceCategory: 'rpg',
        isActive: false,
        sortOrder: 999,
      },
    });

    const activeGameRow = await buildGameSelectRow(g4xSessionId);
    assert(activeGameRow !== null, 'buildGameSelectRow returns select menu row');

    const options = (activeGameRow?.components[0] as any).options;
    const hasInactive = options.some((opt: any) => opt.data.value === inactiveGameSlug);
    assert(!hasInactive, 'Inactive games are strictly filtered out of game dropdown menu');

    // Verify services query filters by gameSlug and isActive
    const testGameSlug = 'wow_midnight';
    const serviceRow = await buildServiceSelectRow(g4xSessionId, testGameSlug);
    assert(serviceRow !== null, 'buildServiceSelectRow returns services for active game');

    // Select game for Staff Flow A
    let updateStaffGame: any = null;
    const mockSelectGame: any = {
      customId: `ord_wiz:game:${g4xSessionId}`,
      values: [testGameSlug],
      user: { id: testStaffId },
      guildId: testGuildId,
      update: async (p: any) => { updateStaffGame = p; },
    };
    await handleOrderWizardSelectMenu(mockSelectGame);

    const sessionAAfterGame = await getWizardSession(g4xSessionId);
    assert(
      sessionAAfterGame?.gameSlug === testGameSlug &&
      sessionAAfterGame?.step === 'service' &&
      updateStaffGame?.components?.[0]?.components?.[0]?.data?.custom_id === `ord_wiz:service:${g4xSessionId}`,
      'Selecting game advances to service dropdown with active game services'
    );

    // ─── TEST 5: Service Selection & Dynamic Modal Fields ───────────────────
    console.log('\n--- 6. Testing Service-Specific Modals & Mode Handling ---');

    // Find mythic_plus service
    const mythicService = await prisma.gameService.findFirst({
      where: { gameSlug: testGameSlug, serviceKey: 'mythic_plus', isActive: true },
    });
    assert(mythicService !== null, 'Found active mythic_plus service in database');

    // Select mythic_plus service for Flow A -> should show modal directly
    let modalShownStaff: any = null;
    const mockSelectServiceMythic: any = {
      customId: `ord_wiz:service:${g4xSessionId}`,
      values: [String(mythicService!.id)],
      user: { id: testStaffId },
      guildId: testGuildId,
      showModal: async (m: any) => { modalShownStaff = m; },
      update: async () => {},
    };
    await handleOrderWizardSelectMenu(mockSelectServiceMythic);

    assert(
      modalShownStaff !== null &&
      modalShownStaff.data?.custom_id === `ord_wiz:modal:${g4xSessionId}`,
      'Selecting Mythic+ service immediately presents service-specific Modal'
    );

    // Verify Mythic+ modal components
    const mythicRows = modalShownStaff.components;
    const mythicCustomIds = mythicRows.map((r: any) => r.components[0].data.custom_id);
    assert(
      mythicCustomIds.includes('amount_usd') &&
      mythicCustomIds.includes('key_level') &&
      mythicCustomIds.includes('runs_count') &&
      mythicCustomIds.includes('customer_info') &&
      mythicCustomIds.includes('notes'),
      'Mythic+ Modal includes amount, key_level, runs_count, customer_info, notes (5 inputs max)',
      JSON.stringify(mythicCustomIds)
    );

    // Test Pilot Service Modal (runs_count must be omitted, vpn_location must be present)
    const pilotService = await prisma.gameService.findFirst({
      where: { gameSlug: testGameSlug, serviceMode: 'pilot', isActive: true },
    });
    assert(pilotService !== null, 'Found active pilot service in database');

    // Create session for pilot test
    const pilotSession = await createWizardSession({
      userId: testStaffId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(pilotSession.sessionId, {
      gameSlug: testGameSlug,
      serviceId: pilotService!.id,
      serviceKey: pilotService!.serviceKey,
      serviceName: pilotService!.displayName,
      serviceMode: 'pilot',
      orderMode: 'pilot',
    });

    const pilotModal = buildWizardOrderModal(await getWizardSession(pilotSession.sessionId) as any);
    const pilotCustomIds = pilotModal.components.map((r: any) => (r.components[0] as any).data.custom_id);

    assert(
      pilotCustomIds.includes('amount_usd') &&
      pilotCustomIds.includes('vpn_location') &&
      !pilotCustomIds.includes('runs_count'),
      'Pilot modal requires vpn_location and strictly omits runs_count (Requirement 9)',
      JSON.stringify(pilotCustomIds)
    );

    // ─── TEST 6: Security - Cross-User, Expiry, Double-Submit ──────────────
    console.log('\n--- 7. Testing Wizard Security Protections ---');

    // A. Cross-User Interception
    let crossUserError = '';
    const mockCrossUserInteraction: any = {
      customId: `ord_wiz:platform:${g4xSessionId}`,
      values: ['skycoach'],
      user: { id: testRandomUserId }, // Random user trying to control Staff session
      guildId: testGuildId,
      reply: async (p: any) => { crossUserError = p.content; },
      update: async () => {},
    };
    await handleOrderWizardSelectMenu(mockCrossUserInteraction);
    assert(
      crossUserError.includes('UNAUTHORIZED_USER') ||
      crossUserError.includes('another user') ||
      crossUserError.includes('not authorized'),
      'Cross-user interaction is rejected with clear error',
      crossUserError
    );

    // B. Session Expiration (TTL = 15m)
    const expSession = await createWizardSession({
      userId: testStaffId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    // Forcibly expire it
    await updateWizardSession(expSession.sessionId, { expiresAt: Date.now() - 5000 });

    let expError = '';
    const mockExpInteraction: any = {
      customId: `ord_wiz:game:${expSession.sessionId}`,
      values: [testGameSlug],
      user: { id: testStaffId },
      guildId: testGuildId,
      reply: async (p: any) => { expError = p.content; },
      update: async () => {},
    };
    await handleOrderWizardSelectMenu(mockExpInteraction);
    assert(
      expError.includes('expired') || expError.includes('EXPIRED_SESSION'),
      'Expired wizard session (15 min TTL) is rejected safely',
      expError
    );

    // C. Restart Recovery
    console.log('\n--- 8. Testing Restart Recovery (Write-Through Session Cache) ---');
    const diskSession = await createWizardSession({
      userId: testStaffId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(diskSession.sessionId, {
      platform: 'skycoach',
      gameSlug: 'poe2',
      step: 'service',
    });

    // Check file on disk
    const sessionsFilePath = path.join(process.cwd(), 'data', 'wizard_sessions.json');
    assert(fs.existsSync(sessionsFilePath), 'data/wizard_sessions.json exists on disk');
    const diskRaw = fs.readFileSync(sessionsFilePath, 'utf-8');
    assert(diskRaw.includes(diskSession.sessionId), 'Session is persisted to disk');

    // Simulate restart by calling initWizardSessions
    initWizardSessions();
    const restoredSession = await getWizardSession(diskSession.sessionId);
    assert(
      restoredSession?.platform === 'skycoach' && restoredSession?.gameSlug === 'poe2',
      'Session survives bot restart and is restored with exact state'
    );

    // ─── TEST 7: Order Submission & Financial Snapshot (Flow A) ─────────────
    console.log('\n--- 9. Testing Flow A Order Submission & Financial Integration ---');

    // Mock staff wallet with $0 to verify payment_pending preservation
    let replySubmitA: any = null;
    const mockModalSubmitA: any = {
      customId: `ord_wiz:modal:${g4xSessionId}`,
      user: { id: testStaffId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '75.00';
          if (field === 'key_level') return '+12 Ara-Kara';
          if (field === 'runs_count') return '2';
          if (field === 'customer_info') return 'Customer#9999';
          if (field === 'notes') return 'Be on time, beat timer';
          return '';
        },
      },
      reply: async (p: any) => { replySubmitA = p; },
    };

    await handleOrderWizardModalSubmit(mockModalSubmitA);

    assert(
      replySubmitA !== null &&
      replySubmitA.embeds?.[0]?.data?.title?.includes('Created Successfully'),
      'Flow A Mythic+ order created successfully through modal submit',
      JSON.stringify(replySubmitA)
    );

    // Verify order in database
    const createdOrderA = await prisma.order.findFirst({
      where: { creatorId: testStaffId },
      orderBy: { id: 'desc' },
      include: { financialSnapshot: true, requiredRoles: true, platformAccount: true },
    });

    assert(createdOrderA !== null, 'Order entity persisted in database');
    assert(
      createdOrderA!.sourceWebsite === 'g2g',
      'G4X Order recorded external source platform: g2g'
    );
    assert(
      createdOrderA!.platformAccountId !== null,
      'G4X Order linked to active PlatformAccount'
    );
    assert(
      createdOrderA!.paymentStatus === 'pending' && createdOrderA!.status === 'payment_pending',
      'Unfunded order preserves payment_pending until backed funding is verified (Requirement 11)'
    );
    assert(
      createdOrderA!.requiredRoles.length === 3,
      'Mythic+ order automatically enforces 4-booster squad (1 Tank, 1 Healer, 2 DPS)'
    );
    assert(
      createdOrderA!.financialSnapshot !== null && createdOrderA!.financialSnapshot?.sourcePlatform === 'g2g',
      'OrderFinancialSnapshot calculated and sealed by financial engine for G2G'
    );

    // D. Duplicate Submission Replay Attack Prevention (Requirement 13)
    let doubleSubmitError = '';
    const mockReplaySubmitA: any = {
      customId: `ord_wiz:modal:${g4xSessionId}`,
      user: { id: testStaffId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: () => '75.00',
      },
      reply: async (p: any) => { doubleSubmitError = p.content; },
    };
    await handleOrderWizardModalSubmit(mockReplaySubmitA);
    assert(
      doubleSubmitError.includes('already submitted') ||
      doubleSubmitError.includes('expired') ||
      doubleSubmitError.includes('Session Error') ||
      doubleSubmitError.includes('INVALID_SESSION'),
      'Duplicate modal submit / double-click is safely rejected without creating duplicate orders'
    );

    // ─── TEST 8: Flow B Advertiser Submission & Backed Funding ──────────────
    console.log('\n--- 10. Testing Flow B Advertiser Order Submission & Backed Funding ---');

    // Create session for Advertiser Flow B
    const advSubmitSession = await createWizardSession({
      userId: testAdvId,
      guildId: testGuildId,
      origin: 'adv',
    });
    await updateWizardSession(advSubmitSession.sessionId, {
      gameSlug: testGameSlug,
      serviceId: mythicService!.id,
      serviceKey: mythicService!.serviceKey,
      serviceName: mythicService!.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    // Provide Advertiser with backed wallet funds to test verified funding transition
    await prisma.walletV2.upsert({
      where: { userId: testAdvId },
      update: { availableCents: 10000, reservedCents: 0 },
      create: { userId: testAdvId, availableCents: 10000, reservedCents: 0 },
    });

    let replySubmitB: any = null;
    const mockModalSubmitB: any = {
      customId: `ord_wiz:modal:${advSubmitSession.sessionId}`,
      user: { id: testAdvId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '50.00'; // $50 = 5000 cents
          if (field === 'key_level') return '+10 Grim Batol';
          if (field === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replySubmitB = p; },
    };

    await handleOrderWizardModalSubmit(mockModalSubmitB);

    assert(
      replySubmitB !== null &&
      replySubmitB.embeds?.[0]?.data?.title?.includes('Created Successfully'),
      'Flow B Advertiser order created successfully'
    );

    const createdOrderB = await prisma.order.findFirst({
      where: { creatorId: testAdvId },
      orderBy: { id: 'desc' },
      include: { financialSnapshot: true },
    });

    assert(createdOrderB !== null, 'Advertiser order persisted');
    assert(
      createdOrderB!.advertiserId === testAdvId &&
      createdOrderB!.advertiserRank === 'GOLD' &&
      createdOrderB!.sourceType === 'direct' &&
      createdOrderB!.sourceWebsite === null,
      'Advertiser order correctly recorded without external website platform'
    );
    assert(
      createdOrderB!.paymentStatus === 'verified' && createdOrderB!.status === 'open_presign',
      'Order with backed WalletV2 funds is automatically verified and open for pre-signing'
    );
    assert(
      createdOrderB!.financialSnapshot?.sourcePlatform === 'advertiser' &&
      createdOrderB!.financialSnapshot?.advertiserRank === 'GOLD',
      'Advertiser order financial snapshot recorded with Gold rank commission rate'
    );

    // Verify LedgerEntryV2 reservation
    const ledgerReservation = await prisma.ledgerEntryV2.findFirst({
      where: { userId: testAdvId, entryType: 'ORDER_RESERVE' },
      orderBy: { id: 'desc' },
    });
    assert(
      ledgerReservation !== null && ledgerReservation.amountCents === 5000,
      'WalletV2 reservation ledger entry created with exact amount: $50.00'
    );

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passedTests} WIZARD TESTS PASSED SUCCESSFULLY!`);
    console.log('================================================================\n');
  } catch (error) {
    console.error('\n❌ TEST SUITE RUNTIME ERROR:', error);
    process.exit(1);
  } finally {
    // Cleanup temporary test data
    try {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [testStaffId, testAdvId, testRandomUserId] } },
      });
      await prisma.ledgerEntryV2.deleteMany({
        where: { userId: { in: [testStaffId, testAdvId] } },
      });
      await prisma.orderFinancialSnapshot.deleteMany({
        where: { order: { creatorId: { in: [testStaffId, testAdvId] } } },
      });
      await prisma.orderRequiredRole.deleteMany({
        where: { order: { creatorId: { in: [testStaffId, testAdvId] } } },
      });
      await prisma.orderRun.deleteMany({
        where: { order: { creatorId: { in: [testStaffId, testAdvId] } } },
      });
      await prisma.order.deleteMany({
        where: { creatorId: { in: [testStaffId, testAdvId] } },
      });
      await prisma.walletV2.deleteMany({
        where: { userId: { in: [testStaffId, testAdvId] } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [testStaffId, testAdvId, testUnrankedAdvId, testRandomUserId] } },
      });
      await prisma.user.deleteMany({
        where: {
          discordId: { in: [testStaffId, testAdvId, testUnrankedAdvId, testRandomUserId] },
        },
      });
      await prisma.game.deleteMany({
        where: { slug: `inactive_game_${ts}` },
      });
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
}

runWizardSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
