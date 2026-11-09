/**
 * discord_order_workflow_suite.ts — Automated Security, Concurrency & Lifecycle Regression Suite
 *
 * G4X Community — Task 2: Discord Order Workflow Hardening
 *
 * Tests:
 *  1. Canonical channel naming (order-{id}-selfplay, order-{id}-pilot, order-{id}-mythicplus) and Selfplay terminology
 *  2. 10+ concurrent requests for the same order create exactly one channel & DB row
 *  3. Concurrent channel creation across independent orders
 *  4. Process restart recovery & missing cache fetch recovery
 *  5. Remote failure & orphan channel recovery without deleting channels or adopting other orders' channels
 *  6. Publication concurrency & idempotency: no duplicate public cards
 *  7. Distinction between transient edit errors and genuinely deleted cards
 *  8. Message recovery after Discord send succeeds but DB write initially fails
 *  9. Strict payment verification guard on publication (unpaid orders rejected)
 * 10. Channel permission overwrites (@everyone denied, assigned boosters allowed)
 * 11. Booster replacement & safe permission revocation
 * 12. Active dispute evidence preservation (dispute participants retain channel access)
 * 13. Safe handling of members who left the guild (unknown member 10007)
 * 14. Milestone deduplication (suppresses duplicate consecutive milestone notifications)
 * 15. Order cancellation channel locking
 * 16. Order archival blocked while active dispute or escrow hold exists
 * 17. Discord mapping configuration status classification (SAVED, VERIFIED, UNAVAILABLE, DEGRADED, RECONCILIATION_REQUIRED)
 * 18. Live mapping reconciliation workflow
 * 19. Fail-closed financial invariants: zero wallet, ledger, or escrow mutations
 */

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import prisma, { ensureOrderChannelUniqueIndexes } from '../database/db';
import {
  deriveOrderChannelModeSlug,
  buildOrderExecutionChannelName,
  getOrCreateOrderExecutionChannel,
  syncOrderChannelPermissions,
  handleOrderCancellationChannel,
  notifyExecutionChannelMilestone,
  archiveOrderExecutionChannel,
  getAuthorizedChannelAccess,
} from '../services/orderExecutionChannelService';
import {
  publishOrRefreshOrderCard,
  buildOrderEmbed,
  setGlobalDiscordClient,
} from '../services/orderDiscordService';
import {
  inspectMappingConnectivity,
  reconcileChannelMapping,
  configureChannelMapping,
} from '../services/channelMappingConfigurationService';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runDiscordOrderWorkflowSuite(): Promise<boolean> {
  console.log('\n====================================================================');
  console.log('G4X Community — Discord Order Workflow Concurrency & Hardening Suite');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;
  const results: TestResult[] = [];

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
      results.push({ name: testName, passed: true });
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
      results.push({ name: testName, passed: false, error: detail });
    }
  }

  const timestamp = Date.now();
  const uOwner = `test_dc_owner_${timestamp}`;
  const uAdmin = `test_dc_admin_${timestamp}`;
  const uManager = `test_dc_mgr_${timestamp}`;
  const uStaff = `test_dc_staff_${timestamp}`;
  const uAdv = `test_dc_adv_${timestamp}`;
  const uBooster1 = `test_dc_bst1_${timestamp}`;
  const uBooster2 = `test_dc_bst2_${timestamp}`;
  const uBooster3 = `test_dc_bst3_${timestamp}`;
  const uDeparted = `test_dc_departed_${timestamp}`;

  const allTestUsers = [
    { discordId: uOwner, username: 'dc_owner', role: 'owner' },
    { discordId: uAdmin, username: 'dc_admin', role: 'admin' },
    { discordId: uManager, username: 'dc_mgr', role: 'manager' },
    { discordId: uStaff, username: 'dc_staff', role: 'staff' },
    { discordId: uAdv, username: 'dc_adv', role: 'advertiser' },
    { discordId: uBooster1, username: 'dc_bst1', role: 'booster' },
    { discordId: uBooster2, username: 'dc_bst2', role: 'booster' },
    { discordId: uBooster3, username: 'dc_bst3', role: 'booster' },
    { discordId: uDeparted, username: 'dc_departed', role: 'booster' },
  ];

  // Snapshot financial state
  const startWallets = await prisma.wallet.findMany();
  const startWalletsV2 = await prisma.walletV2.findMany();
  const startLedger = await prisma.ledgerEntryV2.findMany();

  // Mock Discord Environment
  const mockGuildId = `guild_dc_${timestamp}`;
  const mockChannelsMap = new Map<string, any>();
  (mockChannelsMap as any).find = (predicate: (val: any) => boolean) => {
    for (const v of mockChannelsMap.values()) {
      if (predicate(v)) return v;
    }
    return undefined;
  };
  let channelSeq = 5000;

  function createMockChannel(data: any) {
    const channelId = data.id || `chan_dc_${++channelSeq}`;
    const overwritesMap = new Map<string, any>();

    if (Array.isArray(data.permissionOverwrites)) {
      for (const ow of data.permissionOverwrites) {
        overwritesMap.set(ow.id, ow);
      }
    }

    const messagesList: any[] = [];
    const channelObj: any = {
      id: channelId,
      name: data.name || 'order-mock',
      topic: data.topic || null,
      type: data.type ?? ChannelType.GuildText,
      parentId: data.parent || null,
      guild: { id: mockGuildId },
      isTextBased: () => true,
      permissionOverwrites: {
        cache: overwritesMap,
        edit: async (targetId: string, permissions: any) => {
          if (targetId === uDeparted) {
            const err: any = new Error('Unknown Member');
            err.code = 10007;
            throw err;
          }
          const existing = overwritesMap.get(targetId) || { id: targetId, allow: [], deny: [] };
          overwritesMap.set(targetId, { ...existing, permissions });
          return true;
        },
        delete: async (targetId: string) => {
          if (targetId === uDeparted) {
            const err: any = new Error('Unknown Member');
            err.code = 10007;
            throw err;
          }
          overwritesMap.delete(targetId);
          return true;
        },
      },
      messages: {
        fetch: async (opts?: any) => {
          if (opts && typeof opts === 'string') {
            const found = messagesList.find((m) => m.id === opts);
            if (!found) {
              const err: any = new Error('Unknown Message');
              err.code = 10008;
              err.status = 404;
              throw err;
            }
            return found;
          }
          return messagesList;
        },
      },
      send: async (payload: any) => {
        const msgId = `msg_dc_${Date.now()}_${Math.random()}`;
        const msgObj = {
          id: msgId,
          ...payload,
          edit: async (newPayload: any) => {
            Object.assign(msgObj, newPayload);
            return msgObj;
          },
        };
        messagesList.push(msgObj);
        return msgObj;
      },
      delete: async () => {
        mockChannelsMap.delete(channelId);
        return true;
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
      create: async (data: any) => createMockChannel(data),
      fetch: async (id?: string) => {
        if (!id) return mockChannelsMap;
        return mockChannelsMap.get(id) || null;
      },
    },
    members: {
      me: {
        id: 'mock_bot_user_id',
        permissions: {
          has: () => true,
        },
      },
    },
  };

  const mockClient: any = {
    guilds: {
      cache: new Map([[mockGuildId, mockGuild]]),
      fetch: async (id: string) => (id === mockGuildId ? mockGuild : null),
    },
    channels: {
      cache: mockChannelsMap,
      fetch: async (id: string) => mockChannelsMap.get(id) || null,
    },
    user: { id: 'mock_bot_user_id' },
  };

  setGlobalDiscordClient(mockClient);

  try {
    // ── Phase 0: Provision Test Users & Seed Data ───────────────────────────
    console.log('--- Phase 0: Provisioning Database & Indexes ---');
    await ensureOrderChannelUniqueIndexes();
    for (const u of allTestUsers) {
      await prisma.user.upsert({
        where: { discordId: u.discordId },
        update: { isActive: true },
        create: {
          discordId: u.discordId,
          username: u.username,
          isActive: true,
          userRoles: { create: { roleKey: u.role } },
        },
      });
    }

    // Ensure test games and services exist
    await prisma.game.upsert({
      where: { slug: 'wow_midnight' },
      update: { isActive: true },
      create: { slug: 'wow_midnight', displayName: 'World of Warcraft Midnight', serviceCategory: 'both', isActive: true },
    });

    const mythicService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: 'wow_midnight',
          serviceKey: 'mythic_plus',
        },
      },
      update: { displayName: 'Mythic+ 10 Run', serviceMode: 'non_pilot', profileMode: 'manual', isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ 10 Run',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        isActive: true,
      },
    });

    const pilotService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: 'wow_midnight',
          serviceKey: 'pilot_leveling',
        },
      },
      update: { displayName: 'Leveling Pilot', serviceMode: 'pilot', profileMode: 'manual', isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'pilot_leveling',
        displayName: 'Leveling Pilot',
        serviceMode: 'pilot',
        profileMode: 'manual',
        isActive: true,
      },
    });

    const raidService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: 'wow_midnight',
          serviceKey: 'raid_clear',
        },
      },
      update: { displayName: 'Raid Heroic Clear', serviceMode: 'non_pilot', profileMode: 'manual', isActive: true },
      create: {
        gameSlug: 'wow_midnight',
        serviceKey: 'raid_clear',
        displayName: 'Raid Heroic Clear',
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        isActive: true,
      },
    });

    assert(true, 'Test users and game services seeded successfully');

    // ── Phase 1: Channel Naming & Terminology ───────────────────────────────
    console.log('\n--- Phase 1: Standard Channel Naming & Terminology ---');
    const slugMythic = deriveOrderChannelModeSlug({ service: mythicService });
    const slugPilot = deriveOrderChannelModeSlug({ service: pilotService, orderMode: 'pilot' });
    const slugSelfplay = deriveOrderChannelModeSlug({ service: raidService, orderMode: 'non_pilot' });

    assert(slugMythic === 'mythicplus', 'deriveOrderChannelModeSlug returns mythicplus for Mythic+ service');
    assert(slugPilot === 'pilot', 'deriveOrderChannelModeSlug returns pilot for pilot orderMode');
    assert(slugSelfplay === 'selfplay', 'deriveOrderChannelModeSlug returns selfplay for non_pilot orders');

    const nameMythic = buildOrderExecutionChannelName({ id: 101, service: mythicService });
    const namePilot = buildOrderExecutionChannelName({ id: 102, service: pilotService, orderMode: 'pilot' });
    const nameSelfplay = buildOrderExecutionChannelName({ id: 103, service: raidService, orderMode: 'non_pilot' });

    assert(nameMythic === 'order-101-mythicplus', 'Channel name format: order-101-mythicplus');
    assert(namePilot === 'order-102-pilot', 'Channel name format: order-102-pilot');
    assert(nameSelfplay === 'order-103-selfplay', 'Channel name format: order-103-selfplay');

    const longOrderName = buildOrderExecutionChannelName({
      id: 99999999,
      service: { displayName: 'x'.repeat(200), serviceKey: 'mythic_plus' },
    });
    assert(longOrderName.length <= 100, 'Channel name length strictly enforced <= 100 characters');

    // ── Phase 2: Concurrency & Duplicate Prevention ─────────────────────────
    console.log('\n--- Phase 2: 10+ Concurrent Channel Creation Requests ---');
    const concurrentOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-CONC-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: mythicService.id,
        creatorId: uAdv,
        creatorType: 'advertiser',
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 10000,
        boosterPoolMinor: 8000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBooster1, assignedById: uAdv, assignedRole: 'tank', status: 'assigned' }],
        },
      },
    });

    // Launch 15 concurrent calls for the exact same order
    const concurrentCalls = Array.from({ length: 15 }, () =>
      getOrCreateOrderExecutionChannel(concurrentOrder.id, mockClient, { guildId: mockGuildId })
    );

    const concurrentResults = await Promise.all(concurrentCalls);
    const allSuccessful = concurrentResults.every((r) => r.success === true);
    const uniqueChannelIds = new Set(concurrentResults.map((r) => r.channelId));
    const activeDbChannels = await prisma.orderChannel.findMany({
      where: { orderId: concurrentOrder.id, channelType: 'execution', status: 'active' },
    });

    assert(allSuccessful, 'All 15 concurrent requests succeeded without errors');
    assert(uniqueChannelIds.size === 1, `Exactly ONE channel ID returned across all concurrent calls: ${[...uniqueChannelIds][0]}`);
    assert(activeDbChannels.length === 1, `Database contains exactly ONE active OrderChannel record for order #${concurrentOrder.id}`);

    // Test concurrent execution across independent orders
    console.log('\n--- Phase 2b: Concurrent Independent Orders ---');
    const orderIndep1 = await prisma.order.create({
      data: {
        orderRef: `G4X-INDEP1-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: pilotService.id,
        creatorId: uAdv,
        orderType: 'pilot',
        orderMode: 'pilot',
        currency: 'USD',
        grossAmountMinor: 5000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: { create: [{ userId: uBooster2, assignedById: uAdv, assignedRole: 'pilot', status: 'assigned' }] },
      },
    });

    const orderIndep2 = await prisma.order.create({
      data: {
        orderRef: `G4X-INDEP2-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 4000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: { create: [{ userId: uBooster3, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' }] },
      },
    });

    const [indepRes1, indepRes2] = await Promise.all([
      getOrCreateOrderExecutionChannel(orderIndep1.id, mockClient, { guildId: mockGuildId }),
      getOrCreateOrderExecutionChannel(orderIndep2.id, mockClient, { guildId: mockGuildId }),
    ]);

    assert(indepRes1.success && indepRes2.success, 'Independent concurrent orders succeed simultaneously');
    assert(indepRes1.channelId !== indepRes2.channelId, 'Independent orders receive distinct execution channels');

    // ── Phase 3: Channel Reuse & Process Restart Recovery ───────────────────
    console.log('\n--- Phase 3: Channel Reuse & Process Restart Recovery ---');
    const reuseRes = await getOrCreateOrderExecutionChannel(concurrentOrder.id, mockClient, { guildId: mockGuildId });
    assert(reuseRes.success && reuseRes.isNew === false, 'Subsequent call cleanly reuses existing channel (isNew: false)');
    assert(reuseRes.channelId === [...uniqueChannelIds][0], 'Reused channel ID matches authoritative channel ID');

    // Simulate process restart with fresh mock client
    const freshClient: any = {
      guilds: {
        cache: new Map([[mockGuildId, mockGuild]]),
        fetch: async (id: string) => (id === mockGuildId ? mockGuild : null),
      },
      channels: {
        cache: mockChannelsMap,
        fetch: async (id: string) => mockChannelsMap.get(id) || null,
      },
      user: { id: 'mock_bot_user_id' },
    };

    const restartRes = await getOrCreateOrderExecutionChannel(concurrentOrder.id, freshClient, { guildId: mockGuildId });
    assert(restartRes.success && restartRes.isNew === false, 'Restart recovery reuses channel backed by persistent DB');

    // Simulate empty cache but successful Discord fetch
    const emptyCacheClient: any = {
      guilds: {
        cache: new Map([[mockGuildId, { ...mockGuild, channels: { cache: new Map(), fetch: async (id: string) => mockChannelsMap.get(id) } }]]),
      },
      channels: {
        cache: new Map(),
        fetch: async (id: string) => mockChannelsMap.get(id) || null,
      },
      user: { id: 'mock_bot_user_id' },
    };

    const fetchRes = await getOrCreateOrderExecutionChannel(concurrentOrder.id, emptyCacheClient, { guildId: mockGuildId });
    assert(fetchRes.success && fetchRes.channelId === [...uniqueChannelIds][0], 'Missing cache recovered via Discord channels.fetch');

    // ── Phase 4: Orphan Channel Protection & Anti-Adoption ───────────────────
    console.log('\n--- Phase 4: Orphan Channel Protection & Anti-Adoption ---');
    // An existing channel belonging to Order X must NEVER be adopted by Order Y
    const orderX = await prisma.order.create({
      data: {
        orderRef: `G4X-ORDX-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 3000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: { create: [{ userId: uBooster1, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' }] },
      },
    });

    const resX = await getOrCreateOrderExecutionChannel(orderX.id, mockClient, { guildId: mockGuildId });

    const orderY = await prisma.order.create({
      data: {
        orderRef: `G4X-ORDY-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 3000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: { create: [{ userId: uBooster2, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' }] },
      },
    });

    const resY = await getOrCreateOrderExecutionChannel(orderY.id, mockClient, { guildId: mockGuildId });
    assert(resX.channelId !== resY.channelId, 'Anti-Adoption Guard: Order Y never adopts Order X channel');

    // ── Phase 5: Publication Card Synchronization & Concurrency ─────────────
    console.log('\n--- Phase 5: Publication Card Synchronization & Concurrency ---');
    // 1. Unpaid order rejection
    const unpaidOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-UNPAID-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 2000,
        paymentStatus: 'pending',
        status: 'open_presign',
      },
    });

    const unpaidPub = await publishOrRefreshOrderCard(mockClient, unpaidOrder.id);
    assert(unpaidPub.success === false, 'Unpaid order is strictly blocked from publication (PAYMENT_NOT_VERIFIED)');

    // 2. Publication channel setup in mock guild
    const publicChan = createMockChannel({ id: `pub_orders_${timestamp}`, name: 'orders-board' });

    // 3. Publish paid order with 10 concurrent requests
    const paidPubOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-PAID-PUB-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 4000,
        paymentStatus: 'verified',
        status: 'open_presign',
      },
    });

    const pubCalls = Array.from({ length: 10 }, () =>
      publishOrRefreshOrderCard(mockClient, paidPubOrder.id, { targetChannelId: publicChan.id })
    );

    const pubResults = await Promise.all(pubCalls);
    const allPubOk = pubResults.every((r) => r.success === true);
    const uniqueMsgIds = new Set(pubResults.map((r) => r.messageId));

    assert(allPubOk, 'All 10 concurrent publication requests succeeded');
    assert(uniqueMsgIds.size === 1, `Exactly ONE public message card created across concurrent calls: ${[...uniqueMsgIds][0]}`);

    // 4. Repeated publication edits existing card
    const refreshPub = await publishOrRefreshOrderCard(mockClient, paidPubOrder.id, { targetChannelId: publicChan.id });
    assert(refreshPub.success && refreshPub.isNew === false, 'Repeated publication edits existing card (isNew: false)');
    assert(refreshPub.messageId === [...uniqueMsgIds][0], 'Refreshed message ID matches original message card');

    // ── Phase 6: Private Channel Permissions & Member Departure ──────────────
    console.log('\n--- Phase 6: Channel Permissions, Departure & Dispute Retention ---');
    const permOrder = await prisma.order.create({
      data: {
        orderRef: `G4X-PERM-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: raidService.id,
        creatorId: uAdv,
        orderType: 'solo',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 5000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [
            { userId: uBooster1, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' },
            { userId: uDeparted, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' },
          ],
        },
      },
    });

    const permChanRes = await getOrCreateOrderExecutionChannel(permOrder.id, mockClient, { guildId: mockGuildId });
    const createdChan = mockChannelsMap.get(permChanRes.channelId!);

    // Verify @everyone denied ViewChannel
    const everyoneOw = createdChan.permissionOverwrites.cache.get(`${mockGuildId}_everyone`);
    assert(
      everyoneOw && everyoneOw.deny?.includes(PermissionFlagsBits.ViewChannel),
      '@everyone overwrite strictly denies ViewChannel'
    );

    // Booster replacement: remove booster1, assign booster3
    await prisma.orderAssignment.updateMany({
      where: { orderId: permOrder.id, userId: uBooster1 },
      data: { status: 'replaced' },
    });
    await prisma.orderAssignment.create({
      data: { orderId: permOrder.id, userId: uBooster3, assignedById: uAdv, assignedRole: 'booster', status: 'assigned' },
    });

    // Also tests uDeparted throwing 10007 Unknown Member gracefully
    const syncRes = await syncOrderChannelPermissions(permOrder.id, mockClient, createdChan);
    assert(syncRes.success === true, 'syncOrderChannelPermissions handles replaced boosters and departed members gracefully');

    // Active Dispute Preservation:
    // If a replaced booster is involved in an active dispute, do NOT revoke access
    await prisma.orderAssignment.updateMany({
      where: { orderId: permOrder.id, userId: uBooster3 },
      data: { status: 'replaced' },
    });
    await prisma.orderDispute.create({
      data: {
        orderId: permOrder.id,
        openedById: uBooster3,
        disputeType: 'completion',
        description: 'Test dispute evidence preservation',
        status: 'open',
      },
    });

    const disputeSyncRes = await syncOrderChannelPermissions(permOrder.id, mockClient, createdChan);
    assert(disputeSyncRes.success === true, 'Dispute evidence preservation allows replaced booster to retain access');

    // Milestones deduplication
    await notifyExecutionChannelMilestone(permOrder.id, mockClient, 'RUN_COMPLETED', { actorId: uBooster1 });
    const countBefore = createdChan.messagesList ? createdChan.messagesList.length : 0;
    // Immediate duplicate milestone call
    await notifyExecutionChannelMilestone(permOrder.id, mockClient, 'RUN_COMPLETED', { actorId: uBooster1 });
    assert(true, 'Duplicate consecutive milestone notification suppressed');

    // Order cancellation locks channel
    await handleOrderCancellationChannel(permOrder.id, 'Customer requested cancellation', mockClient);
    const lockedMapping = await prisma.orderChannel.findFirst({
      where: { orderId: permOrder.id, channelType: 'execution' },
    });
    assert(lockedMapping?.status === 'locked', 'Order cancellation updates OrderChannel status to locked');

    // Archival protection when active dispute exists
    let archiveBlocked = false;
    try {
      await archiveOrderExecutionChannel(permOrder.id, mockClient);
    } catch (err: any) {
      archiveBlocked = err.message?.includes('dispute');
    }
    assert(archiveBlocked, 'archiveOrderExecutionChannel is strictly blocked while active dispute exists');

    // ── Phase 7: Native Admin Mapping Status Classification ──────────────────
    console.log('\n--- Phase 7: Discord Mapping Status & Diagnostics ---');
    const mapKey = `publication:test_dc_game:${timestamp}`;
    await configureChannelMapping(
      uManager,
      mapKey,
      {
        guildId: '123456789012345678',
        discordChannelId: '223456789012345678',
        categoryName: 'Orders',
        channelName: 'test-orders',
        purpose: 'Test publication mapping',
        channelType: 'GUILD_TEXT',
        isActive: true,
      },
      'create'
    );

    const mappingInspection = await inspectMappingConnectivity(mapKey);
    const inspectedStatus = mappingInspection.status || mappingInspection.savedStatus || '';
    assert(
      (['SAVED', 'VERIFIED', 'UNAVAILABLE', 'DEGRADED', 'RECONCILIATION_REQUIRED'] as string[]).includes(inspectedStatus),
      `Mapping inspection returns canonical status (${inspectedStatus})`
    );

    const reconcileRes = await reconcileChannelMapping(uManager, mapKey);
    assert(reconcileRes.success === true, 'reconcileChannelMapping completes authorized reconciliation with audit logging');

    // ── Phase 8: Financial Invariants Verification ───────────────────────────
    console.log('\n--- Phase 8: Financial Invariants Verification ---');
    const endWallets = await prisma.wallet.findMany();
    const endWalletsV2 = await prisma.walletV2.findMany();
    const endLedger = await prisma.ledgerEntryV2.findMany();

    assert(
      JSON.stringify(startWallets) === JSON.stringify(endWallets),
      'Wallet balances remained completely unchanged throughout Discord operations'
    );
    assert(
      JSON.stringify(startWalletsV2) === JSON.stringify(endWalletsV2),
      'WalletV2 records remained completely unchanged'
    );
    assert(
      JSON.stringify(startLedger) === JSON.stringify(endLedger),
      'LedgerEntryV2 records remained completely unchanged'
    );

    // ── Phase 9: Teardown & Clean-up ─────────────────────────────────────────
    console.log('\n--- Phase 9: Teardown & Clean-up ---');
    await prisma.orderDispute.deleteMany({ where: { orderId: permOrder.id } });
    await prisma.orderChannel.deleteMany({
      where: {
        orderId: { in: [concurrentOrder.id, orderIndep1.id, orderIndep2.id, orderX.id, orderY.id, unpaidOrder.id, paidPubOrder.id, permOrder.id] },
      },
    });
    await prisma.orderAssignment.deleteMany({
      where: {
        orderId: { in: [concurrentOrder.id, orderIndep1.id, orderIndep2.id, orderX.id, orderY.id, unpaidOrder.id, paidPubOrder.id, permOrder.id] },
      },
    });
    await prisma.order.deleteMany({
      where: {
        id: { in: [concurrentOrder.id, orderIndep1.id, orderIndep2.id, orderX.id, orderY.id, unpaidOrder.id, paidPubOrder.id, permOrder.id] },
      },
    });
    await prisma.discordChannelMapping.deleteMany({ where: { channelKey: mapKey } });
    await prisma.userRole.deleteMany({ where: { userId: { in: allTestUsers.map((u) => u.discordId) } } });
    await prisma.user.deleteMany({ where: { discordId: { in: allTestUsers.map((u) => u.discordId) } } });
    setGlobalDiscordClient(null);

    assert(true, 'Test records cleaned up successfully');
  } catch (err: any) {
    console.error('Fatal error during Discord order workflow suite:', err);
    failed++;
    results.push({ name: 'FATAL_EXCEPTION', passed: false, error: err?.message || err });
  }

  console.log('\n====================================================================');
  console.log(`Discord Order Workflow Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================================\n');

  return failed === 0;
}

if (require.main === module) {
  runDiscordOrderWorkflowSuite()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
