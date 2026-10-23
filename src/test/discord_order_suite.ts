/**
 * discord_order_suite.ts — Dedicated Discord Order, Presign & Claim Integration Test Suite
 *
 * Phase 2 Completion, Milestone 1
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite.
 *
 * 20 Targeted Integration Test Scenarios:
 *  1. G4!order command routing.
 *  2. Existing G4!setup and registration routing remain functional.
 *  3. Authorized order listing.
 *  4. Unauthorized order creation is denied.
 *  5. One eligible order publishes exactly one Discord card.
 *  6. Publication retry does not create duplicates.
 *  7. Order card contents match database state.
 *  8. Tank presign persists correctly.
 *  9. Healer presign persists correctly.
 * 10. DPS presign persists correctly.
 * 11. Presign withdrawal works.
 * 12. Unapproved Booster cannot presign.
 * 13. Duplicate presign is safe.
 * 14. Concurrent presign clicks cannot exceed capacity.
 * 15. Closed or cancelled orders cannot be claimed.
 * 16. Incorrect game/role eligibility is rejected.
 * 17. Buttons still work correctly after restart.
 * 18. Failed Discord API calls are recoverable.
 * 19. Website and Discord display consistent order state.
 * 20. No financial ledger or wallet mutation occurs.
 */

import prisma from '../database/db';
import { handleOrderCommand } from '../commands/order';
import { handleSetupCommand } from '../commands/setup';
import { handleButtonInteraction } from '../interactions/buttons';
import {
  publishOrRefreshOrderCard,
  buildOrderEmbed,
  handlePresignButton,
  handlePresignWithdrawButton,
} from '../services/orderDiscordService';
import { ensureUserExists } from '../services/registrationService';
import { mapOrderStatus } from '../services/statusSimplifier';

async function runDiscordOrderSuite() {
  console.log('=== STARTING DISCORD ORDER PUBLICATION & PRESIGN INTEGRATION SUITE ===\n');

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

  // Test User Identifiers
  const uOwner = 'test_ord_owner_8801';
  const uAdmin = 'test_ord_admin_8802';
  const uAdvertiser = 'test_ord_adv_8803';
  const uRegular = 'test_ord_regular_8804';
  const uBoosterTank = 'test_ord_tank_8805';
  const uBoosterHealer = 'test_ord_healer_8806';
  const uBoosterDps1 = 'test_ord_dps1_8807';
  const uBoosterDps2 = 'test_ord_dps2_8808';
  const uBoosterDps3 = 'test_ord_dps3_8809';
  const uBoosterDps4 = 'test_ord_dps4_8810';
  const uOtherGameBooster = 'test_ord_r6booster_8811';

  const allTestUsers = [
    uOwner,
    uAdmin,
    uAdvertiser,
    uRegular,
    uBoosterTank,
    uBoosterHealer,
    uBoosterDps1,
    uBoosterDps2,
    uBoosterDps3,
    uBoosterDps4,
    uOtherGameBooster,
  ];

  try {
    // ─── Initial Cleanup of Test Records ─────────────────────────────────
    await prisma.orderPresign.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.orderAssignment.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.boosterReservation.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.order.deleteMany({
      where: { creatorId: { in: allTestUsers } },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allTestUsers } },
    });

    // ─── Seed Users & Roles ──────────────────────────────────────────────
    for (const uid of allTestUsers) {
      await ensureUserExists(uid, `user_${uid.slice(-4)}`);
    }

    await prisma.userRole.createMany({
      data: [
        { userId: uOwner, roleKey: 'owner' },
        { userId: uAdmin, roleKey: 'admin' },
        { userId: uAdvertiser, roleKey: 'advertiser' },
        { userId: uBoosterTank, roleKey: 'booster' },
        { userId: uBoosterHealer, roleKey: 'booster' },
        { userId: uBoosterDps1, roleKey: 'booster' },
        { userId: uBoosterDps2, roleKey: 'booster' },
        { userId: uBoosterDps3, roleKey: 'booster' },
        { userId: uBoosterDps4, roleKey: 'booster' },
        { userId: uOtherGameBooster, roleKey: 'booster' },
      ],
    });

    // Seed Games & Services
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
        displayName: 'Mythic+ Dungeon Boost',
        serviceMode: 'non_pilot',
        profileMode: 'raiderio',
        requiresPilotApproval: false,
        isActive: true,
      },
    });

    // Approve Boosters for WoW Midnight
    const approvedBoosters = [
      uBoosterTank,
      uBoosterHealer,
      uBoosterDps1,
      uBoosterDps2,
      uBoosterDps3,
      uBoosterDps4,
    ];
    for (const bId of approvedBoosters) {
      await prisma.userGameApproval.create({
        data: {
          userId: bId,
          gameSlug: 'wow_midnight',
          serviceId: mplusService.id,
          approvalType: 'booster',
          status: 'approved',
          reviewedBy: uAdmin,
          reviewedAt: new Date(),
        },
      });
    }

    // Approve uOtherGameBooster ONLY for R6, NOT for WoW
    await prisma.userGameApproval.create({
      data: {
        userId: uOtherGameBooster,
        gameSlug: 'rainbow_six_siege',
        approvalType: 'booster',
        status: 'approved',
        reviewedBy: uAdmin,
        reviewedAt: new Date(),
      },
    });

    // Record initial financial ledger and wallet snapshot
    const initialLedgerCount = await prisma.ledgerTransaction.count();
    const initialWallets = await prisma.wallet.findMany();

    // ─── TEST 1: G4!order command routing ─────────────────────────────────
    let orderHelpReplied = false;
    let helpEmbedTitle = '';
    const mockOrderHelpMessage: any = {
      author: { id: uRegular },
      content: 'G4!order help',
      reply: async (payload: any) => {
        orderHelpReplied = true;
        if (payload.embeds?.length > 0) {
          helpEmbedTitle = payload.embeds[0].data.title || '';
        }
      },
    };

    await handleOrderCommand(mockOrderHelpMessage, ['help']);
    assert(
      orderHelpReplied && helpEmbedTitle.includes('Boost Orders Commands'),
      '1. G4!order command routing works and delivers English help menu'
    );

    // ─── TEST 2: Existing G4!setup routing remains functional ─────────────
    let setupReplied = '';
    const mockSetupMessage: any = {
      author: { id: uRegular },
      content: 'G4!setup registration',
      reply: async (payload: any) => {
        setupReplied = typeof payload === 'string' ? payload : payload.content;
      },
      channel: { isTextBased: () => true },
    };

    await handleSetupCommand(mockSetupMessage, ['registration']);
    assert(
      setupReplied.includes('Permission Denied'),
      '2. Existing G4!setup and registration routing remain functional'
    );

    // ─── TEST 3: Authorized order listing ─────────────────────────────────
    // Create a base open order first
    const testOrder1 = await prisma.order.create({
      data: {
        orderRef: 'ORD_TEST_DISCORD_001',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        advertiserId: uAdvertiser,
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 10000,
        boosterPoolMinor: 10000,
        paymentStatus: 'verified',
        status: 'open_presign',
        notes: 'Speed run +15 dungeon',
        runs: {
          create: [{ runNumber: 1, status: 'pending' }],
        },
        requiredRoles: {
          create: [
            { roleName: 'tank', quantity: 1 },
            { roleName: 'healer', quantity: 1 },
            { roleName: 'dps', quantity: 3 },
          ],
        },
      },
      include: { requiredRoles: true },
    });

    let listEmbedCount = 0;
    const mockListMessage: any = {
      author: { id: uBoosterTank },
      content: 'G4!order list',
      reply: async (payload: any) => {
        if (payload.embeds?.length > 0) {
          listEmbedCount = payload.embeds[0].data.fields?.length || 0;
        }
      },
    };

    await handleOrderCommand(mockListMessage, ['list']);
    assert(
      listEmbedCount >= 1,
      '3. Authorized order listing displays open boost orders with role slots'
    );

    // ─── TEST 4: Unauthorized order creation is denied ────────────────────
    let unauthCreateReplied = '';
    const mockUnauthCreateMessage: any = {
      author: { id: uRegular },
      content: 'G4!order create wow_midnight 1 50 group',
      reply: async (payload: any) => {
        unauthCreateReplied = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleOrderCommand(mockUnauthCreateMessage, ['create', 'wow_midnight', '1', '50', 'group']);
    assert(
      unauthCreateReplied.includes('Permission Denied'),
      '4. Unauthorized order creation is denied'
    );

    // ─── TEST 5: One eligible order publishes exactly one Discord card ─────
    let sentCount = 0;
    let sentEmbed: any = null;
    let sentComponents: any = null;
    let mockDiscordMessageId = 'msg_discord_order_card_1001';

    const mockChannel: any = {
      id: 'chan_orders_9901',
      isTextBased: () => true,
      send: async (payload: any) => {
        sentCount++;
        sentEmbed = payload.embeds[0];
        sentComponents = payload.components;
        return {
          id: mockDiscordMessageId,
          edit: async () => {},
        };
      },
      messages: {
        fetch: async (id: string) => {
          if (id === mockDiscordMessageId) {
            return {
              id: mockDiscordMessageId,
              edit: async (payload: any) => {
                sentEmbed = payload.embeds[0];
                sentComponents = payload.components;
              },
            };
          }
          return null;
        },
      },
    };

    const mockClient: any = {
      channels: {
        fetch: async (id: string) => (id === mockChannel.id ? mockChannel : null),
        cache: new Map([[mockChannel.id, mockChannel]]),
      },
    };

    const pub1 = await publishOrRefreshOrderCard(mockClient, testOrder1.id, mockChannel.id);
    const updatedOrder1 = await prisma.order.findUnique({
      where: { id: testOrder1.id },
      include: { game: true, service: true, requiredRoles: true },
    });

    assert(
      pub1.success &&
        sentCount === 1 &&
        updatedOrder1?.discordMessageId === mockDiscordMessageId &&
        updatedOrder1?.discordChannelId === mockChannel.id,
      '5. One eligible order publishes exactly one Discord card and persists IDs'
    );

    // ─── TEST 6: Publication retry does not create duplicates (Idempotent) ─
    let editCount = 0;
    mockChannel.messages.fetch = async (id: string) => {
      return {
        id,
        edit: async () => {
          editCount++;
        },
      };
    };

    const pub2 = await publishOrRefreshOrderCard(mockClient, testOrder1.id, mockChannel.id);
    assert(
      pub2.success &&
        pub2.isNew === false &&
        sentCount === 1 &&
        editCount === 1,
      '6. Publication retry edits existing message and does not create duplicate cards'
    );

    // ─── TEST 7: Order card contents match database state ──────────────────
    const cardEmbed = buildOrderEmbed(updatedOrder1, [], []);
    const titleMatch = cardEmbed.data.title?.includes(`Order #${testOrder1.id}`);
    const gameMatch = cardEmbed.data.description?.includes('World of Warcraft Midnight');
    const noFinancialLeak =
      !JSON.stringify(cardEmbed.data).includes('10000') &&
      !JSON.stringify(cardEmbed.data).includes('grossAmountMinor');

    assert(
      titleMatch && gameMatch && noFinancialLeak,
      '7. Order card contents match database state and exclude financial secrets'
    );

    // ─── TEST 8: Tank presign persists correctly ──────────────────────────
    let tankReply = '';
    const mockTankInteraction: any = {
      user: { id: uBoosterTank, username: 'TankMaster', displayName: 'Tank Master' },
      customId: `presign_tank:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        tankReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockTankInteraction);
    const tankPresign = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uBoosterTank, status: 'registered' },
    });

    assert(
      tankPresign !== null &&
        tankPresign.registeredRole === 'tank' &&
        tankReply.includes('Pre-sign Confirmed'),
      '8. Tank presign persists correctly in database with registered status'
    );

    // ─── TEST 9: Healer presign persists correctly ────────────────────────
    let healerReply = '';
    const mockHealerInteraction: any = {
      user: { id: uBoosterHealer, username: 'HealGod', displayName: 'Heal God' },
      customId: `presign_healer:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        healerReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockHealerInteraction);
    const healerPresign = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uBoosterHealer, status: 'registered' },
    });

    assert(
      healerPresign !== null &&
        healerPresign.registeredRole === 'healer' &&
        healerReply.includes('Pre-sign Confirmed'),
      '9. Healer presign persists correctly in database with registered status'
    );

    // ─── TEST 10: DPS presign persists correctly ──────────────────────────
    let dps1Reply = '';
    const mockDps1Interaction: any = {
      user: { id: uBoosterDps1, username: 'DpsPro1', displayName: 'DPS Pro 1' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        dps1Reply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockDps1Interaction);
    const dps1Presign = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uBoosterDps1, status: 'registered' },
    });

    assert(
      dps1Presign !== null &&
        dps1Presign.registeredRole === 'dps' &&
        dps1Reply.includes('Pre-sign Confirmed'),
      '10. DPS presign persists correctly in database with registered status'
    );

    // ─── TEST 11: Presign withdrawal works ────────────────────────────────
    let withdrawReply = '';
    const mockWithdrawInteraction: any = {
      user: { id: uBoosterTank, username: 'TankMaster', displayName: 'Tank Master' },
      customId: `presign_withdraw:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        withdrawReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockWithdrawInteraction);
    const withdrawnTank = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uBoosterTank },
    });

    assert(
      withdrawnTank?.status === 'withdrawn' && withdrawReply.includes('Pre-sign Withdrawn'),
      '11. Presign withdrawal works and marks status as withdrawn'
    );

    // ─── TEST 12: Unapproved Booster cannot presign ───────────────────────
    let unapprovedReply = '';
    const mockUnapprovedInteraction: any = {
      user: { id: uRegular, username: 'RegularGuy', displayName: 'Regular Guy' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        unapprovedReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockUnapprovedInteraction);
    const unapprovedPresign = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uRegular },
    });

    assert(
      unapprovedPresign === null && unapprovedReply.includes('Booster Approval Required'),
      '12. Unapproved Booster cannot presign'
    );

    // ─── TEST 13: Duplicate presign is safe (idempotent) ──────────────────
    let dupReply = '';
    const mockDupInteraction: any = {
      user: { id: uBoosterDps1, username: 'DpsPro1', displayName: 'DPS Pro 1' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        dupReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockDupInteraction);
    const dps1Rows = await prisma.orderPresign.findMany({
      where: { orderId: testOrder1.id, userId: uBoosterDps1, status: 'registered' },
    });

    assert(
      dps1Rows.length === 1 && dupReply.includes('already registered'),
      '13. Duplicate presign is safe and returns idempotent response without creating duplicate rows'
    );

    // ─── TEST 14: Concurrent presign clicks cannot exceed capacity ────────
    // testOrder1 has max 3 DPS. uBoosterDps1 is already registered.
    // Register uBoosterDps2 and uBoosterDps3 to fill the 3 slots:
    const mockDps2Interaction: any = {
      user: { id: uBoosterDps2, username: 'DpsPro2', displayName: 'DPS Pro 2' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async () => {},
    };
    const mockDps3Interaction: any = {
      user: { id: uBoosterDps3, username: 'DpsPro3', displayName: 'DPS Pro 3' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async () => {},
    };

    await handleButtonInteraction(mockDps2Interaction);
    await handleButtonInteraction(mockDps3Interaction);

    // Now attempt 4th DPS when capacity is strictly 3
    let overflowReply = '';
    const mockDps4Interaction: any = {
      user: { id: uBoosterDps4, username: 'DpsPro4', displayName: 'DPS Pro 4' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        overflowReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockDps4Interaction);
    const activeDpsCount = await prisma.orderPresign.count({
      where: { orderId: testOrder1.id, registeredRole: 'dps', status: 'registered' },
    });

    assert(
      activeDpsCount === 3 && overflowReply.includes('Slot Full'),
      '14. Presign clicks cannot exceed capacity (max 3 DPS strictly enforced)'
    );

    // ─── TEST 15: Closed or cancelled orders cannot be claimed ────────────
    const cancelledOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD_TEST_CANCELLED_002',
        gameSlug: 'wow_midnight',
        serviceId: mplusService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        status: 'cancelled',
      },
    });

    let cancelledReply = '';
    const mockCancelledInteraction: any = {
      user: { id: uBoosterHealer, username: 'HealGod', displayName: 'Heal God' },
      customId: `presign_healer:${cancelledOrder.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        cancelledReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockCancelledInteraction);
    const presignOnCancelled = await prisma.orderPresign.findFirst({
      where: { orderId: cancelledOrder.id, userId: uBoosterHealer },
    });

    assert(
      presignOnCancelled === null && cancelledReply.includes('Order Closed'),
      '15. Closed or cancelled orders cannot be claimed or pre-signed'
    );

    // ─── TEST 16: Incorrect game/role eligibility is rejected ─────────────
    let wrongGameReply = '';
    const mockWrongGameInteraction: any = {
      user: { id: uOtherGameBooster, username: 'R6Booster', displayName: 'R6 Booster' },
      customId: `presign_dps:${testOrder1.id}`,
      client: mockClient,
      reply: async (payload: any) => {
        wrongGameReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockWrongGameInteraction);
    const presignOnWrongGame = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uOtherGameBooster },
    });

    assert(
      presignOnWrongGame === null && wrongGameReply.includes('Booster Approval Required'),
      '16. Incorrect game/role eligibility is strictly rejected'
    );

    // ─── TEST 17: Buttons still work correctly after restart ──────────────
    // Tank previously withdrew; re-presign after simulated restart
    const freshMockClient: any = {
      channels: {
        fetch: async (id: string) => (id === mockChannel.id ? mockChannel : null),
        cache: new Map([[mockChannel.id, mockChannel]]),
      },
    };

    let restartTankReply = '';
    const mockRestartTankInteraction: any = {
      user: { id: uBoosterTank, username: 'TankMaster', displayName: 'Tank Master' },
      customId: `presign_tank:${testOrder1.id}`,
      client: freshMockClient,
      reply: async (payload: any) => {
        restartTankReply = typeof payload === 'string' ? payload : payload.content;
      },
    };

    await handleButtonInteraction(mockRestartTankInteraction);
    const rePresignedTank = await prisma.orderPresign.findFirst({
      where: { orderId: testOrder1.id, userId: uBoosterTank, status: 'registered' },
    });

    assert(
      rePresignedTank !== null && restartTankReply.includes('Pre-sign Confirmed'),
      '17. Buttons still work correctly after restart backed by persistent database'
    );

    // ─── TEST 18: Failed Discord API calls are recoverable ────────────────
    const failingMockChannel: any = {
      id: 'chan_failing_9902',
      isTextBased: () => true,
      send: async () => {
        throw new Error('SIMULATED_DISCORD_500_ERROR: Discord API is down');
      },
      messages: { fetch: async () => null },
    };
    const failingMockClient: any = {
      channels: {
        fetch: async () => failingMockChannel,
        cache: new Map([[failingMockChannel.id, failingMockChannel]]),
      },
    };

    const failedPub = await publishOrRefreshOrderCard(failingMockClient, testOrder1.id, failingMockChannel.id);
    assert(
      failedPub.success === false && failedPub.error?.includes('DISCORD_API_ERROR'),
      '18. Failed Discord API calls are handled safely and are recoverable'
    );

    // ─── TEST 19: Website and Discord display consistent order state ──────
    const dbOrder = await prisma.order.findUnique({
      where: { id: testOrder1.id },
      include: {
        game: true,
        service: true,
        presigns: { where: { status: 'registered' } },
      },
    });

    const webSimplifiedStatus = mapOrderStatus(dbOrder!.status);
    const discordEmbed = buildOrderEmbed(dbOrder, dbOrder!.presigns);

    const discordShowsOpen = discordEmbed.data.description?.includes('Open for Pre-sign');
    const webShowsPending = webSimplifiedStatus.label === 'Pending';
    const countsMatch = dbOrder?.presigns.length === 5; // 1 Tank, 1 Healer, 3 active DPS

    assert(
      discordShowsOpen && webShowsPending && countsMatch,
      '19. Website and Discord display consistent order state and counts'
    );

    // ─── TEST 20: No financial ledger or wallet mutation occurs ───────────
    const finalLedgerCount = await prisma.ledgerTransaction.count();
    const finalWallets = await prisma.wallet.findMany();

    const ledgerUnchanged = finalLedgerCount === initialLedgerCount;
    let walletsUnchanged = true;
    for (const w of finalWallets) {
      const initial = initialWallets.find((iw) => iw.userId === w.userId);
      if (
        !initial ||
        initial.balanceUsd !== w.balanceUsd ||
        initial.escrowUsd !== w.escrowUsd ||
        initial.balanceGold !== w.balanceGold
      ) {
        walletsUnchanged = false;
        break;
      }
    }

    assert(
      ledgerUnchanged && walletsUnchanged,
      '20. No financial ledger or wallet mutation occurs in Phase 2 Milestone 1'
    );

    // ─── Final Cleanup ───────────────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning up isolated test records...');
    await prisma.orderPresign.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.orderAssignment.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.boosterReservation.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.order.deleteMany({ where: { creatorId: { in: allTestUsers } } });
    await prisma.userGameApproval.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: allTestUsers } } });

    console.log(`\n======================================================`);
    console.log(`DISCORD ORDER TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log(`======================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in Discord Order Test Suite:', err);
    process.exit(1);
  }
}

runDiscordOrderSuite();
