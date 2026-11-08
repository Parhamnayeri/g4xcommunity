/**
 * private_discord_order_channels_suite.ts — Comprehensive Test Suite for Private Discord Order Channels
 *
 * G4X Community — Phase 2 Completion: Private Discord Order Channels
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite
 *
 * Tests:
 *  1. Authorized channel creation
 *  2. Unpaid order rejection
 *  3. Presign-only user denied
 *  4. Correct permission overwrites
 *  5. Duplicate event handling (Idempotent)
 *  6. Restart recovery
 *  7. Missing/deleted channel recovery
 *  8. Booster replacement (Roster update & permission sync)
 *  9. Unauthorized access denial
 * 10. Cancelled order behavior
 * 11. Completed order archiving
 * 12. Dispute retention (Evidence preservation blocks archiving)
 * 13. Discord API failure recovery
 * 14. Website access authorization
 * 15. No wallet or ledger changes
 */

import prisma from '../database/db';
import { ensureUserExists } from '../services/registrationService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';
import {
  getOrCreateOrderExecutionChannel,
  syncOrderChannelPermissions,
  handleOrderCancellationChannel,
  notifyExecutionChannelMilestone,
  archiveOrderExecutionChannel,
  getAuthorizedChannelAccess,
  buildExecutionChannelOverwrites,
} from '../services/orderExecutionChannelService';
import { replaceAssignment, completeOrderRun } from '../services/runValidationService';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runPrivateDiscordOrderChannelsSuite(): Promise<void> {
  console.log('\n================================================================================');
  console.log('   G4X COMMUNITY — PRIVATE DISCORD ORDER CHANNELS TEST SUITE (PHASE 2)          ');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  const results: TestResult[] = [];

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
      results.push({ name: testName, passed: true });
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
      results.push({ name: testName, passed: false, error: detail });
    }
  }

  const timestamp = Date.now();
  const uOwner = `test_poc_owner_${timestamp}`;
  const uAdmin = `test_poc_admin_${timestamp}`;
  const uStaff = `test_poc_staff_${timestamp}`;
  const uAdvertiser = `test_poc_adv_${timestamp}`;
  const uBooster1 = `test_poc_bst1_${timestamp}`;
  const uBooster2 = `test_poc_bst2_${timestamp}`;
  const uBooster3 = `test_poc_bst3_${timestamp}`;
  const uPresignOnly = `test_poc_pre_${timestamp}`;
  const uRegular = `test_poc_reg_${timestamp}`;

  const allTestUsers = [
    uOwner,
    uAdmin,
    uStaff,
    uAdvertiser,
    uBooster1,
    uBooster2,
    uBooster3,
    uPresignOnly,
    uRegular,
  ];

  // Mock Discord Environment
  const mockGuildId = `guild_poc_${timestamp}`;
  const mockChannelsMap = new Map<string, any>();
  (mockChannelsMap as any).find = (predicate: (val: any) => boolean) => {
    for (const v of mockChannelsMap.values()) {
      if (predicate(v)) return v;
    }
    return undefined;
  };
  let channelSequence = 1000;

  function createMockChannel(data: any) {
    const channelId = data.id || `chan_${++channelSequence}`;
    const overwritesMap = new Map<string, any>();

    if (Array.isArray(data.permissionOverwrites)) {
      for (const ow of data.permissionOverwrites) {
        overwritesMap.set(ow.id, ow);
      }
    }

    const channelObj: any = {
      id: channelId,
      name: data.name || `order-mock`,
      type: data.type ?? ChannelType.GuildText,
      parentId: data.parent || null,
      guild: { id: mockGuildId },
      isTextBased: () => true,
      permissionOverwrites: {
        cache: overwritesMap,
        edit: async (targetId: string, permissions: any) => {
          const existing = overwritesMap.get(targetId) || { id: targetId, allow: [], deny: [] };
          overwritesMap.set(targetId, { ...existing, permissions });
          return true;
        },
        delete: async (targetId: string) => {
          overwritesMap.delete(targetId);
          return true;
        },
      },
      messages: [],
      send: async (payload: any) => {
        const msgId = `msg_${Date.now()}_${Math.random()}`;
        channelObj.messages.push({ id: msgId, ...payload });
        return { id: msgId, ...payload };
      },
    };

    mockChannelsMap.set(channelId, channelObj);
    return channelObj;
  }

  const mockGuild: any = {
    id: mockGuildId,
    roles: {
      everyone: { id: `${mockGuildId}_everyone` },
    },
    channels: {
      cache: mockChannelsMap,
      create: async (data: any) => {
        return createMockChannel(data);
      },
    },
    members: {
      me: { id: `bot_${timestamp}` },
    },
  };

  const mockGuildsMap = new Map([[mockGuildId, mockGuild]]);
  (mockGuildsMap as any).first = () => mockGuild;

  const mockClient: any = {
    guilds: {
      cache: mockGuildsMap,
    },
    channels: {
      fetch: async (id: string) => {
        const found = mockChannelsMap.get(id);
        if (!found) throw new Error('Unknown Channel');
        return found;
      },
    },
    user: { id: `bot_${timestamp}` },
  };

  try {
    // ─── Setup: Users & Roles ────────────────────────────────────────────────
    for (const uid of allTestUsers) {
      await ensureUserExists(uid, `user_${uid.slice(-6)}`);
    }

    await prisma.userRole.createMany({
      data: [
        { userId: uOwner, roleKey: 'owner' },
        { userId: uAdmin, roleKey: 'admin' },
        { userId: uStaff, roleKey: 'staff' },
        { userId: uAdvertiser, roleKey: 'advertiser' },
        { userId: uBooster1, roleKey: 'booster' },
        { userId: uBooster2, roleKey: 'booster' },
        { userId: uBooster3, roleKey: 'booster' },
        { userId: uPresignOnly, roleKey: 'booster' },
      ],
    });

    const testService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight' },
    });
    if (!testService) throw new Error('GameService wow_midnight not found');

    for (const uid of [uBooster1, uBooster2, uBooster3, uPresignOnly]) {
      await prisma.userGameApproval.create({
        data: {
          userId: uid,
          gameSlug: 'wow_midnight',
          serviceId: testService.id,
          approvalType: 'booster',
          status: 'approved',
        },
      });
    }

    // Capture initial wallet state for verification (Test 15)
    const initialWallets = await prisma.walletV2.findMany({
      where: { userId: { in: allTestUsers } },
    });
    const initialLedgerCount = await prisma.ledgerEntryV2.count();

    // ─── Test 1: Authorized channel creation ─────────────────────────────────
    const order1 = await prisma.order.create({
      data: {
        orderRef: `ORD_POC1_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        advertiserId: uAdvertiser,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        boosterPoolMinor: 8500,
        paymentStatus: 'verified',
        status: 'assigned',
        runs: {
          create: [{ runNumber: 1, status: 'pending' }],
        },
        assignments: {
          create: [
            { userId: uBooster1, assignedById: uAdvertiser, assignedRole: 'tank', status: 'assigned' },
            { userId: uBooster2, assignedById: uAdvertiser, assignedRole: 'healer', status: 'assigned' },
          ],
        },
      },
    });

    const chanRes1 = await getOrCreateOrderExecutionChannel(order1.id, mockClient, {
      guildId: mockGuildId,
    });

    const dbChannel1 = await prisma.orderChannel.findFirst({
      where: { orderId: order1.id, channelType: 'execution', status: 'active' },
    });
    const updatedOrder1 = await prisma.order.findUnique({ where: { id: order1.id } });

    assert(
      chanRes1.success &&
        chanRes1.isNew === true &&
        chanRes1.channelId === dbChannel1?.discordChannelId &&
        updatedOrder1?.executionChannelId === chanRes1.channelId,
      '1. Authorized channel creation creates channel with predictable name and updates OrderChannel'
    );

    // ─── Test 2: Unpaid order rejection ──────────────────────────────────────
    const orderUnpaid = await prisma.order.create({
      data: {
        orderRef: `ORD_UNPAID_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        paymentStatus: 'pending', // Unpaid
        status: 'payment_pending',
      },
    });

    let unpaidError: any = null;
    try {
      await getOrCreateOrderExecutionChannel(orderUnpaid.id, mockClient, { guildId: mockGuildId });
    } catch (e: any) {
      unpaidError = e;
    }

    assert(
      unpaidError instanceof DomainError && unpaidError.code === DomainErrorCode.PAYMENT_NOT_VERIFIED,
      '2. Unpaid order rejection strictly blocks channel creation'
    );

    // ─── Test 3: Presign-only user denied ────────────────────────────────────
    const orderPresignOnly = await prisma.order.create({
      data: {
        orderRef: `ORD_PREONLY_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        paymentStatus: 'verified',
        status: 'open_presign', // In presign stage without assignments
        presigns: {
          create: [{ userId: uPresignOnly, claimType: 'individual', registeredRole: 'dps', status: 'registered' }],
        },
      },
    });

    let presignOnlyError: any = null;
    try {
      await getOrCreateOrderExecutionChannel(orderPresignOnly.id, mockClient, { guildId: mockGuildId });
    } catch (e: any) {
      presignOnlyError = e;
    }

    assert(
      presignOnlyError instanceof DomainError &&
        (presignOnlyError.code === DomainErrorCode.ORDER_NOT_ASSIGNED ||
          presignOnlyError.code === DomainErrorCode.INVALID_ORDER_TRANSITION),
      '3. Presign-only user denied: Channels not created merely because someone clicked Presign'
    );

    // ─── Test 4: Correct permission overwrites ───────────────────────────────
    const createdChanObj = mockChannelsMap.get(chanRes1.channelId!);
    const overwrites = createdChanObj.permissionOverwrites.cache;

    const everyoneDenied = overwrites.get(mockGuild.roles.everyone.id)?.deny?.includes(
      PermissionFlagsBits.ViewChannel
    );
    const bst1Allowed = overwrites.get(uBooster1)?.allow?.includes(PermissionFlagsBits.ViewChannel);
    const bst2Allowed = overwrites.get(uBooster2)?.allow?.includes(PermissionFlagsBits.ViewChannel);
    const presignUserOverwrites = overwrites.get(uPresignOnly);

    assert(
      everyoneDenied && bst1Allowed && bst2Allowed && presignUserOverwrites === undefined,
      '4. Correct permission overwrites: @everyone denied, assigned boosters allowed, presign-only excluded'
    );

    // ─── Test 5: Duplicate event handling (Idempotency) ──────────────────────
    const duplicateRes = await getOrCreateOrderExecutionChannel(order1.id, mockClient, {
      guildId: mockGuildId,
    });
    const totalActiveMappings = await prisma.orderChannel.count({
      where: { orderId: order1.id, channelType: 'execution', status: 'active' },
    });

    assert(
      duplicateRes.success &&
        duplicateRes.isNew === false &&
        duplicateRes.channelId === chanRes1.channelId &&
        totalActiveMappings === 1,
      '5. Duplicate event handling is idempotent and reuses existing channel without duplication'
    );

    // ─── Test 6: Restart recovery ────────────────────────────────────────────
    // Create a fresh client simulating post-restart state
    const mockClientRestart: any = {
      guilds: mockClient.guilds,
      channels: {
        fetch: async (id: string) => mockChannelsMap.get(id) || null,
      },
      user: mockClient.user,
    };

    const restartRes = await getOrCreateOrderExecutionChannel(order1.id, mockClientRestart, {
      guildId: mockGuildId,
    });

    assert(
      restartRes.success &&
        restartRes.isNew === false &&
        restartRes.channelId === chanRes1.channelId,
      '6. Restart recovery cleanly reconnects to persistent DB channel mapping'
    );

    // ─── Test 7: Missing/deleted channel recovery ─────────────────────────────
    // Simulate channel deleted from Discord directly
    mockChannelsMap.delete(chanRes1.channelId!);

    const recoverRes = await getOrCreateOrderExecutionChannel(order1.id, mockClient, {
      guildId: mockGuildId,
    });

    const activeDbChannelAfterRecover = await prisma.orderChannel.findFirst({
      where: { orderId: order1.id, channelType: 'execution', status: 'active' },
    });

    assert(
      recoverRes.success &&
        recoverRes.isNew === true &&
        recoverRes.channelId !== chanRes1.channelId &&
        activeDbChannelAfterRecover?.discordChannelId === recoverRes.channelId,
      '7. Missing/deleted channel recovery automatically recreates channel and updates mapping'
    );

    // ─── Test 8: Booster replacement ─────────────────────────────────────────
    const bst1Assignment = await prisma.orderAssignment.findFirst({
      where: { orderId: order1.id, userId: uBooster1 },
    });

    await replaceAssignment(
      bst1Assignment!.id,
      uBooster3,
      uAdvertiser,
      'Booster 1 unavailable for key',
      prisma,
      mockClient
    );

    const updatedChan = mockChannelsMap.get(recoverRes.channelId!);
    const bst3HasAccess = updatedChan.permissionOverwrites.cache.get(uBooster3) !== undefined;
    const bst1Overwrites = updatedChan.permissionOverwrites.cache.get(uBooster1);
    const bst1Removed = bst1Overwrites === undefined || bst1Overwrites?.permissions?.ViewChannel === false;

    assert(
      bst3HasAccess && bst1Removed,
      '8. Booster replacement safely grants access to new booster and revokes access from replaced booster'
    );

    // ─── Test 9: Unauthorized access denial ──────────────────────────────────
    const unauthAccess = await getAuthorizedChannelAccess(order1.id, uRegular);
    assert(
      unauthAccess.authorized === false && unauthAccess.reason?.includes('PERMISSION_DENIED'),
      '9. Unauthorized access denial: Unrelated user cannot obtain private channel metadata'
    );

    // ─── Test 10: Cancelled order behavior ───────────────────────────────────
    await handleOrderCancellationChannel(order1.id, 'Customer requested refund', mockClient);

    const lockedMapping = await prisma.orderChannel.findFirst({
      where: { orderId: order1.id, channelType: 'execution' },
      orderBy: { id: 'desc' },
    });

    let channelOnCancelledError: any = null;
    await prisma.order.update({ where: { id: order1.id }, data: { status: 'cancelled' } });
    try {
      await getOrCreateOrderExecutionChannel(order1.id, mockClient, { guildId: mockGuildId });
    } catch (e: any) {
      channelOnCancelledError = e;
    }

    assert(
      lockedMapping?.status === 'locked' &&
        channelOnCancelledError instanceof DomainError &&
        channelOnCancelledError.code === DomainErrorCode.INVALID_ORDER_TRANSITION,
      '10. Cancelled order behavior locks channel and prevents recreation'
    );

    // ─── Test 11: Completed order archiving ──────────────────────────────────
    // Create a new completed order with active channel
    const orderArchivable = await prisma.order.create({
      data: {
        orderRef: `ORD_ARCH_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBooster2, assignedById: uAdvertiser, assignedRole: 'dps', status: 'assigned' }],
        },
      },
    });

    const archChan = await getOrCreateOrderExecutionChannel(orderArchivable.id, mockClient, {
      guildId: mockGuildId,
    });

    const archiveResult = await archiveOrderExecutionChannel(orderArchivable.id, mockClient);
    const dbArchived = await prisma.orderChannel.findFirst({
      where: { orderId: orderArchivable.id, channelType: 'execution' },
    });

    assert(
      archiveResult.success &&
        dbArchived?.status === 'archived' &&
        dbArchived.archivedAt !== null,
      '11. Completed order archiving safely locks channel and updates DB archivedAt'
    );

    // ─── Test 12: Dispute retention ──────────────────────────────────────────
    // Order with active dispute cannot be archived
    const orderWithDispute = await prisma.order.create({
      data: {
        orderRef: `ORD_DISP_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBooster2, assignedById: uAdvertiser, assignedRole: 'dps', status: 'assigned' }],
        },
        disputes: {
          create: [
            {
              openedById: uAdvertiser,
              disputeType: 'completion',
              description: 'Run key was depleted before completion',
              status: 'open',
            },
          ],
        },
      },
    });

    await getOrCreateOrderExecutionChannel(orderWithDispute.id, mockClient, { guildId: mockGuildId });

    let disputeArchiveError: any = null;
    try {
      await archiveOrderExecutionChannel(orderWithDispute.id, mockClient);
    } catch (e: any) {
      disputeArchiveError = e;
    }

    assert(
      disputeArchiveError instanceof DomainError &&
        disputeArchiveError.code === DomainErrorCode.ORDER_DISPUTE_ACTIVE,
      '12. Dispute retention blocks channel archiving while an unresolved dispute exists'
    );

    // ─── Test 13: Discord API failure recovery ───────────────────────────────
    const orderApiFail = await prisma.order.create({
      data: {
        orderRef: `ORD_FAIL_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: testService.id,
        creatorId: uAdvertiser,
        creatorType: 'advertiser',
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBooster3, assignedById: uAdvertiser, assignedRole: 'dps', status: 'assigned' }],
        },
      },
    });

    const mockClientFailing: any = {
      guilds: {
        cache: new Map([
          [
            mockGuildId,
            {
              id: mockGuildId,
              roles: mockGuild.roles,
              channels: {
                cache: new Map(),
                create: async () => {
                  throw new Error('SIMULATED_DISCORD_500: Internal Server Error');
                },
              },
            },
          ],
        ]),
      },
      channels: mockClient.channels,
      user: mockClient.user,
    };

    let apiFailCaught = false;
    try {
      await getOrCreateOrderExecutionChannel(orderApiFail.id, mockClientFailing, { guildId: mockGuildId });
    } catch (e: any) {
      if (e instanceof DomainError && e.code === DomainErrorCode.CHANNEL_CREATION_FAILED) {
        apiFailCaught = true;
      }
    }

    const failedDbChannels = await prisma.orderChannel.count({
      where: { orderId: orderApiFail.id },
    });

    assert(
      apiFailCaught && failedDbChannels === 0,
      '13. Discord API failure recovery: API errors fail cleanly without partial DB corruptions'
    );

    // ─── Test 14: Website access authorization ───────────────────────────────
    const boosterAccess = await getAuthorizedChannelAccess(orderWithDispute.id, uBooster2);
    const presignAccess = await getAuthorizedChannelAccess(orderPresignOnly.id, uPresignOnly);
    const staffAccess = await getAuthorizedChannelAccess(orderWithDispute.id, uStaff);

    assert(
      boosterAccess.authorized === true &&
        boosterAccess.channelUrl?.includes(mockGuildId) &&
        presignAccess.authorized === false &&
        staffAccess.authorized === true,
      '14. Website access authorization permits assigned booster and staff, but denies presign-only candidate'
    );

    // ─── Test 15: No wallet or ledger changes ────────────────────────────────
    const finalWallets = await prisma.walletV2.findMany({
      where: { userId: { in: allTestUsers } },
    });
    const finalLedgerCount = await prisma.ledgerEntryV2.count();

    const walletDifferences = finalWallets.filter((fw) => {
      const iw = initialWallets.find((w) => w.userId === fw.userId);
      return (
        !iw ||
        iw.availableCents !== fw.availableCents ||
        iw.reservedCents !== fw.reservedCents
      );
    });

    assert(
      walletDifferences.length === 0 && finalLedgerCount === initialLedgerCount,
      '15. No wallet or ledger changes: Order channel lifecycle creates zero financial balance mutations'
    );

  } finally {
    // ─── Cleanup ─────────────────────────────────────────────────────────────
    await prisma.orderDispute.deleteMany({
      where: { openedById: { in: allTestUsers } },
    });
    await prisma.orderChannel.deleteMany({
      where: { discordGuildId: mockGuildId },
    });
    await prisma.orderAssignment.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.orderPresign.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.boosterReservation.deleteMany({
      where: { userId: { in: allTestUsers } },
    });
    await prisma.orderRun.deleteMany({
      where: { order: { creatorId: { in: allTestUsers } } },
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
  }

  console.log('\n================================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    throw new Error(`Test suite failed: ${failed} assertions failed`);
  }
}

if (require.main === module) {
  runPrivateDiscordOrderChannelsSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
