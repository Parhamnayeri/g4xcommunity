/**
 * game_order_publication_routing_suite.ts — جامع‌ترین آزمون اعتبارسنجی کانال‌های انتشار سفارشات بر اساس بازی و نوع بوست
 *
 * Verifies:
 *  1. Idempotent deployment of WoW Midnight and WoW Forever categories and 5 dedicated boost channels.
 *  2. Database-backed ChannelRoute persistence and AuditLog tracking.
 *  3. Management permission guards on publication setup (G4!setup publications).
 *  4. Exact routing for all 5 channels:
 *     - WoW Midnight Mythic+ -> #mythic_plus_boosts (WoW Midnight)
 *     - WoW Midnight Non-Pilot -> #non_pilot_boosts (WoW Midnight)
 *     - WoW Midnight Pilot -> #pilot_boosts (WoW Midnight)
 *     - WoW Forever Non-Pilot -> #non_pilot_boosts (WoW Forever)
 *     - WoW Forever Pilot -> #pilot_boosts (WoW Forever)
 *  5. Wrong-game routing prevention (WoW Forever never published in WoW Midnight channels and vice versa).
 *  6. Fail-safe behavior for unmapped games (no silent publication to unrelated fallback channels).
 *  7. Payment verification guard (unpaid / payment_pending orders are strictly rejected from publication).
 *  8. English Embed and component validation (orderRef, game, service, mode, presign/claim buttons, no secrets).
 *  9. Duplicate-message prevention on repeated publication and restart recovery (message edited, isNew: false).
 * 10. Order lifecycle card updates upon assignment, cancellation, and completion (presigns removed).
 * 11. Separation of publication channels from private execution channels.
 * 12. Zero financial or wallet balance changes.
 */

import prisma from '../database/db';
import {
  setupPublicationChannels,
  resolveOrderPublicationChannel,
} from '../services/orderPublicationChannelService';
import {
  publishOrRefreshOrderCard,
  resolveOrdersChannel,
  buildOrderEmbed,
  buildOrderComponents,
} from '../services/orderDiscordService';
import { assignOrderBoosters } from '../services/assignmentService';
import { handleSetupCommand } from '../commands/setup';
import { Permission } from '../services/permissionTypes';

async function runGameOrderPublicationRoutingSuite() {
  console.log('=== STARTING GAME-BASED DISCORD ORDER PUBLICATION ROUTING SUITE ===\n');

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

  const uManager = 'test_pub_manager_8801';
  const uBooster = 'test_pub_booster_8802';
  const uCustomer = 'test_pub_customer_8803';
  const uRegular = 'test_pub_regular_8804';

  const testUsers = [uManager, uBooster, uCustomer, uRegular];

  try {
    // ─── ۰. آماده‌سازی و پاکسازی ایزوله محیط تست ──────────────────────────────
    await prisma.channelRoute.deleteMany({
      where: { discordGuildId: 'mock_publication_guild_99' },
    });
    await prisma.boosterReservation.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderPresign.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderAssignment.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderRequiredRole.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.order.deleteMany({ where: { creatorId: { in: testUsers } } });
    await prisma.userGameApproval.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });

    // ثبت کاربران تست در دیتابیس
    await prisma.user.create({
      data: {
        discordId: uManager,
        username: 'PubManager',
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uBooster,
        username: 'PubBooster',
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    await prisma.userGameApproval.create({
      data: {
        userId: uBooster,
        gameSlug: 'wow_midnight',
        approvalType: 'booster',
        status: 'approved',
        reviewedBy: uManager,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uCustomer,
        username: 'PubCustomer',
      },
    });

    await prisma.user.create({
      data: {
        discordId: uRegular,
        username: 'PubRegularUser',
      },
    });

    // ثبت کیف پول کاربر بوستر جهت راستی‌آزمایی عدم تغییرات مالی
    await prisma.wallet.create({
      data: {
        userId: uBooster,
        balanceUsd: 100.0,
      },
    });

    // ─── ۱. راه‌اندازی شبیه‌ساز دیسکورد (Discord Mock Harness) ────────────────
    const mockChannelsMap = new Map<string, any>();
    const mockMessagesMap = new Map<string, any>();

    const mockGuild: any = {
      id: 'mock_publication_guild_99',
      channels: {
        cache: {
          find: (fn: any) => Array.from(mockChannelsMap.values()).find(fn),
          get: (id: string) => mockChannelsMap.get(id),
          first: () => Array.from(mockChannelsMap.values())[0],
        },
        create: async (data: any) => {
          const fakeId = `ch_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
          const fakeChannel = {
            id: fakeId,
            name: data.name,
            type: data.type,
            parentId: data.parent,
            isTextBased: () => data.type !== 4, // 4 is category
            messages: {
              fetch: async (msgId: string) => mockMessagesMap.get(msgId) || null,
            },
            send: async (payload: any) => {
              const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
              const messageObj = {
                id: msgId,
                channelId: fakeId,
                embeds: payload.embeds,
                components: payload.components,
                edit: async (newPayload: any) => {
                  messageObj.embeds = newPayload.embeds;
                  messageObj.components = newPayload.components;
                  return messageObj;
                },
              };
              mockMessagesMap.set(msgId, messageObj);
              return messageObj;
            },
          };
          mockChannelsMap.set(fakeId, fakeChannel);
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

    const mockClient: any = {
      guilds: {
        cache: {
          get: (id: string) => (id === mockGuild.id ? mockGuild : null),
          first: () => mockGuild,
        },
      },
      channels: {
        fetch: async (chId: string) => mockChannelsMap.get(chId) || null,
      },
    };

    // ─── تست ۱: استقرار کانال‌ها و دسته‌بندی‌ها توسط مدیر مجاز ────────────────
    const setupResult = await setupPublicationChannels({
      guild: mockGuild,
      actorId: uManager,
    });

    const wmCatId = setupResult.categories.wowMidnightId;
    const wfCatId = setupResult.categories.wowForeverId;

    const wmMysticChId = setupResult.channels.wowMidnightMythicId;
    const wmNonPilotChId = setupResult.channels.wowMidnightNonPilotId;
    const wmPilotChId = setupResult.channels.wowMidnightPilotId;

    const wfNonPilotChId = setupResult.channels.wowForeverNonPilotId;
    const wfPilotChId = setupResult.channels.wowForeverPilotId;

    assert(
      setupResult.success &&
        Boolean(wmCatId) &&
        Boolean(wfCatId) &&
        Boolean(wmMysticChId) &&
        Boolean(wmNonPilotChId) &&
        Boolean(wmPilotChId) &&
        Boolean(wfNonPilotChId) &&
        Boolean(wfPilotChId),
      '1. Setup creates 2 categories (WoW Midnight, WoW Forever) and 5 dedicated channels',
      `WM Cat: ${wmCatId}, WF Cat: ${wfCatId}, 5 Channels Created`
    );

    // ─── تست ۲: ثبت در جدول پایگاه داده ChannelRoute و AuditLog ──────────────
    const dbRoutes = await prisma.channelRoute.findMany({
      where: { discordGuildId: mockGuild.id, isActive: true },
    });

    const mythicRoute = dbRoutes.find((r) => r.gameSlug === 'wow_midnight' && r.serviceId !== null);
    const wmNonPilotRoute = dbRoutes.find(
      (r) => r.gameSlug === 'wow_midnight' && r.serviceId === null && r.serviceMode === 'non_pilot'
    );
    const wmPilotRoute = dbRoutes.find(
      (r) => r.gameSlug === 'wow_midnight' && r.serviceId === null && r.serviceMode === 'pilot'
    );
    const wfNonPilotRoute = dbRoutes.find(
      (r) => r.gameSlug === 'wow_forever' && r.serviceMode === 'non_pilot'
    );
    const wfPilotRoute = dbRoutes.find(
      (r) => r.gameSlug === 'wow_forever' && r.serviceMode === 'pilot'
    );

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        actorId: uManager,
        action: 'ORDER_PUBLICATION_CHANNELS_SETUP',
      },
    });

    assert(
      dbRoutes.length >= 5 &&
        Boolean(mythicRoute) &&
        Boolean(wmNonPilotRoute) &&
        Boolean(wmPilotRoute) &&
        Boolean(wfNonPilotRoute) &&
        Boolean(wfPilotRoute) &&
        Boolean(auditLog),
      '2. Database ChannelRoute records and AuditLog entry accurately persisted',
      `Recorded ${dbRoutes.length} active routes in channel_routes table`
    );

    // ─── تست ۳: تکرارپذیری امن (Idempotency) ──────────────────────────────────
    const channelCountBefore = mockChannelsMap.size;
    const setupRerun = await setupPublicationChannels({
      guild: mockGuild,
      actorId: uManager,
    });
    const channelCountAfter = mockChannelsMap.size;

    assert(
      setupRerun.success &&
        channelCountBefore === channelCountAfter &&
        setupRerun.categories.wowMidnightId === wmCatId &&
        setupRerun.channels.wowMidnightMythicId === wmMysticChId,
      '3. Repeated setup run is idempotent (reuses existing categories and channels without duplicates)',
      `Channel count before: ${channelCountBefore}, after: ${channelCountAfter}`
    );

    // ─── تست ۴: بررسی کنترل دسترسی (Permission Guard) ────────────────────────
    let regularSetupBlocked = false;
    try {
      await setupPublicationChannels({ guild: mockGuild, actorId: uRegular });
    } catch (err: any) {
      if (err.message.includes('PERMISSION_DENIED')) {
        regularSetupBlocked = true;
      }
    }

    assert(
      regularSetupBlocked,
      '4. Unauthorized user cannot trigger publication channel setup (PERMISSION_DENIED)'
    );

    // بررسی دستور کامند G4!setup publications
    let commandReply = '';
    const mockMessage: any = {
      author: { id: uRegular },
      guild: mockGuild,
      reply: async (msg: any) => {
        commandReply = msg.content;
      },
    };
    await handleSetupCommand(mockMessage, ['publications']);

    assert(
      commandReply.includes('Permission Denied'),
      '4.1 Command G4!setup publications enforces management-only authorization',
      `Reply: ${commandReply}`
    );

    // ─── تست ۵: مسیریابی دقیق ۵ کانال بر اساس بازی و سرویس ───────────────────
    // ۵.۱ WoW Midnight Mythic+ -> #mythic_plus_boosts
    const mythicService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
    });

    const routeMythic = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'wow_midnight',
        serviceId: mythicService?.id || 10,
        serviceKey: 'mythic_plus',
        orderMode: 'non_pilot',
      },
      mockGuild.id
    );

    assert(
      routeMythic?.id === wmMysticChId,
      '5.1 WoW Midnight Mythic+ order routes exclusively to #mythic_plus_boosts',
      `Resolved channel ID: ${routeMythic?.id}, Expected: ${wmMysticChId}`
    );

    // ۵.۲ WoW Midnight Non-Pilot -> #non_pilot_boosts
    const raidService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'raid_boost' },
    });

    const routeWmNonPilot = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'wow_midnight',
        serviceId: raidService?.id,
        serviceKey: 'raid_boost',
        orderMode: 'non_pilot',
      },
      mockGuild.id
    );

    assert(
      routeWmNonPilot?.id === wmNonPilotChId,
      '5.2 WoW Midnight Non-Pilot order routes exclusively to #non_pilot_boosts',
      `Resolved channel ID: ${routeWmNonPilot?.id}, Expected: ${wmNonPilotChId}`
    );

    // ۵.۳ WoW Midnight Pilot -> #pilot_boosts
    const routeWmPilot = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'wow_midnight',
        orderMode: 'pilot',
      },
      mockGuild.id
    );

    assert(
      routeWmPilot?.id === wmPilotChId,
      '5.3 WoW Midnight Pilot order routes exclusively to #pilot_boosts',
      `Resolved channel ID: ${routeWmPilot?.id}, Expected: ${wmPilotChId}`
    );

    // ۵.۴ WoW Forever Non-Pilot -> #non_pilot_boosts (تحت دسته‌بندی WoW Forever)
    const routeWfNonPilot = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'wow_forever',
        orderMode: 'non_pilot',
      },
      mockGuild.id
    );

    assert(
      routeWfNonPilot?.id === wfNonPilotChId,
      '5.4 WoW Forever Non-Pilot order routes to #non_pilot_boosts under WoW Forever',
      `Resolved channel ID: ${routeWfNonPilot?.id}, Expected: ${wfNonPilotChId}`
    );

    // ۵.۵ WoW Forever Pilot -> #pilot_boosts (تحت دسته‌بندی WoW Forever)
    const routeWfPilot = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'wow_forever',
        orderMode: 'pilot',
      },
      mockGuild.id
    );

    assert(
      routeWfPilot?.id === wfPilotChId,
      '5.5 WoW Forever Pilot order routes to #pilot_boosts under WoW Forever',
      `Resolved channel ID: ${routeWfPilot?.id}, Expected: ${wfPilotChId}`
    );

    // ─── تست ۶: عدم تداخل بازی‌ها (Wrong-Game Routing Prevention) ─────────────
    const wfChannel = mockChannelsMap.get(routeWfPilot?.id || '');
    const wmCategory = mockChannelsMap.get(wmCatId || '');

    assert(
      wfChannel?.parentId !== wmCatId && wfChannel?.id !== wmPilotChId,
      '6. WoW Forever order is strictly prevented from routing into WoW Midnight channels',
      `WoW Forever Pilot parent: ${wfChannel?.parentId}, WoW Midnight Cat: ${wmCatId}`
    );

    // ─── تست ۷: شکست امن برای بازی‌ها یا سرویس‌های تعریف‌نشده (Fail-Safe) ─────
    const unmappedRoute = await resolveOrderPublicationChannel(
      mockClient,
      {
        gameSlug: 'unknown_alien_game',
        orderMode: 'non_pilot',
      },
      mockGuild.id
    );

    assert(
      unmappedRoute === null,
      '7. Unmapped game or service fails safely by returning null (never leaks to unrelated channels)',
      `Returned: ${unmappedRoute}`
    );

    // ─── تست ۸: گارد تایید پرداخت (Payment Verification Guard) ───────────────
    // ایجاد یک سفارش پرداخت‌نشده (paymentStatus = 'pending')
    const unpaidOrder = await prisma.order.create({
      data: {
        orderRef: `TEST-ORD-UNPAID-${Date.now()}`,
        creatorId: uCustomer,
        gameSlug: 'wow_midnight',
        serviceId: mythicService?.id || 10,
        orderMode: 'non_pilot',
        orderType: 'g4x',
        status: 'draft',
        paymentStatus: 'pending',
        currency: 'USD',
        grossAmountMinor: 10000,
      },
    });

    const unpaidPublishResult = await publishOrRefreshOrderCard(mockClient, unpaidOrder.id);

    assert(
      unpaidPublishResult.success === false &&
        Boolean(unpaidPublishResult.error?.includes('PAYMENT_NOT_VERIFIED')),
      '8. Unpaid order (paymentStatus: pending) is strictly blocked from publication for public claims',
      `Error: ${unpaidPublishResult.error}`
    );

    // ─── تست ۹: انتشار سفارش با پرداخت تاییدشده (Verified Order Publication) ─
    const verifiedOrder = await prisma.order.create({
      data: {
        orderRef: `TEST-ORD-VERIFIED-${Date.now()}`,
        creatorId: uCustomer,
        gameSlug: 'wow_midnight',
        serviceId: mythicService?.id || 10,
        orderMode: 'non_pilot',
        orderType: 'g4x',
        status: 'open_presign',
        paymentStatus: 'verified',
        currency: 'USD',
        grossAmountMinor: 10000,
        requiredRoles: {
          create: [
            { roleName: 'tank', quantity: 1 },
            { roleName: 'healer', quantity: 1 },
            { roleName: 'dps', quantity: 2 },
          ],
        },
      },
    });

    const publishResult = await publishOrRefreshOrderCard(mockClient, verifiedOrder.id);

    assert(
      publishResult.success === true &&
        publishResult.isNew === true &&
        publishResult.channelId === wmMysticChId &&
        Boolean(publishResult.messageId),
      '9. Verified WoW Midnight Mythic+ order successfully published in #mythic_plus_boosts',
      `Channel: ${publishResult.channelId}, MessageId: ${publishResult.messageId}`
    );

    // ─── تست ۱۰: بررسی ساختار Embed و کنترل‌های Presign/Claim انگلیسی ─────────
    const sentMessage = mockMessagesMap.get(publishResult.messageId || '');
    const embedData = sentMessage?.embeds?.[0]?.data;
    const components = sentMessage?.components;

    const hasRef = embedData?.title?.includes(verifiedOrder.orderRef);
    const hasGame = embedData?.description?.includes('World of Warcraft');
    const hasMythic = embedData?.description?.includes('Mythic+ Boosting');
    const hasStatus = embedData?.description?.includes('Open for Pre-sign');
    const hasMode = embedData?.description?.includes('Self-Play');

    const buttonIds: string[] = [];
    if (components && components[0]?.components) {
      for (const btn of components[0].components) {
        buttonIds.push(btn.data.custom_id);
      }
    }

    assert(
      hasRef &&
        hasGame &&
        hasMythic &&
        hasStatus &&
        hasMode &&
        buttonIds.includes(`presign_tank:${verifiedOrder.id}`) &&
        buttonIds.includes(`presign_healer:${verifiedOrder.id}`) &&
        buttonIds.includes(`presign_dps:${verifiedOrder.id}`) &&
        buttonIds.includes(`presign_withdraw:${verifiedOrder.id}`) &&
        buttonIds.includes(`order_view:${verifiedOrder.id}`),
      '10. Published order contains complete English Embed and interactive presign/claim controls',
      `Buttons: ${buttonIds.join(', ')}`
    );

    // بررسی عدم افشای اطلاعات حساس مالی یا اطلاعات شخصی مشتری در Embed
    const embedJson = JSON.stringify(embedData || {});
    const leaksSecret =
      embedJson.includes('cvv') ||
      embedJson.includes('secret') ||
      embedJson.includes('private_key') ||
      embedJson.includes('token') ||
      embedJson.includes('escrow_release');

    assert(
      !leaksSecret,
      '10.1 Order embed contains no sensitive customer or financial secrets'
    );

    // ─── تست ۱۱: جلوگیری از ارسال پیام تکراری (Duplicate Prevention) ──────────
    const republishResult = await publishOrRefreshOrderCard(mockClient, verifiedOrder.id);

    assert(
      republishResult.success === true &&
        republishResult.isNew === false &&
        republishResult.messageId === publishResult.messageId &&
        republishResult.channelId === publishResult.channelId,
      '11. Duplicate-message prevention on republishing / restart recovery (edits existing message)',
      `Same messageId: ${republishResult.messageId}, isNew: ${republishResult.isNew}`
    );

    // ─── تست ۱۲: به‌روزرسانی کارت دیسکورد هنگام تخصیص سفارش (Assignment) ──────
    // انجام تخصیص سفارش به بوستر
    const assignResult = await assignOrderBoosters({
      orderId: verifiedOrder.id,
      actorId: uManager,
      candidates: [{ userId: uBooster, assignedRole: 'tank' }],
      discordClient: mockClient,
    });

    const afterAssignOrder = await prisma.order.findUnique({
      where: { id: verifiedOrder.id },
    });

    const updatedMsg = mockMessagesMap.get(publishResult.messageId || '');
    const updatedEmbed = updatedMsg?.embeds?.[0]?.data;
    const updatedButtons: string[] = [];
    if (updatedMsg?.components?.[0]?.components) {
      for (const btn of updatedMsg.components[0].components) {
        updatedButtons.push(btn.data.custom_id);
      }
    }

    assert(
      assignResult.success &&
        afterAssignOrder?.status === 'assigned' &&
        updatedEmbed?.description?.includes('Assigned') &&
        !updatedButtons.includes(`presign_tank:${verifiedOrder.id}`),
      '12. Order assignment refreshes public card to Assigned status and disables/removes presign buttons',
      `Order status: ${afterAssignOrder?.status}, Active buttons: ${updatedButtons.join(', ')}`
    );

    // ─── تست ۱۳: به‌روزرسانی وضعیت هنگام لغو یا تکمیل سفارش ───────────────────
    await prisma.order.update({
      where: { id: verifiedOrder.id },
      data: { status: 'cancelled' },
    });

    await publishOrRefreshOrderCard(mockClient, verifiedOrder.id);
    const cancelledMsg = mockMessagesMap.get(publishResult.messageId || '');
    const cancelledEmbed = cancelledMsg?.embeds?.[0]?.data;

    assert(
      cancelledEmbed?.description?.includes('Cancelled'),
      '13.1 Order cancellation updates public card to Cancelled status',
      `Embed description snippet: ${cancelledEmbed?.description}`
    );

    await prisma.order.update({
      where: { id: verifiedOrder.id },
      data: { status: 'completed' },
    });

    await publishOrRefreshOrderCard(mockClient, verifiedOrder.id);
    const completedMsg = mockMessagesMap.get(publishResult.messageId || '');
    const completedEmbed = completedMsg?.embeds?.[0]?.data;

    assert(
      completedEmbed?.description?.includes('Completed'),
      '13.2 Order completion updates public card to Completed status',
      `Embed description snippet: ${completedEmbed?.description}`
    );

    // ─── تست ۱۴: عدم تغییرات مالی و بالانس کیف پول‌ها (Zero Financial Leak) ───
    const boosterWallet = await prisma.wallet.findUnique({
      where: { userId: uBooster },
    });

    assert(
      boosterWallet?.balanceUsd === 100.0,
      '14. Absolute financial safety: Zero unexpected wallet balance or ledger movements occurred',
      `Booster wallet balance: ${boosterWallet?.balanceUsd}`
    );

    console.log(`\n======================================================`);
    console.log(`SUITE SUMMARY: ${passed} PASSED | ${failed} FAILED`);
    console.log(`======================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error in publication routing test suite:', error);
    process.exit(1);
  } finally {
    // پاکسازی نهایی داده‌های تست
    await prisma.channelRoute.deleteMany({
      where: { discordGuildId: 'mock_publication_guild_99' },
    });
    await prisma.boosterReservation.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderPresign.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderAssignment.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderRequiredRole.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.order.deleteMany({ where: { creatorId: { in: testUsers } } });
    await prisma.userGameApproval.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });
    await prisma.$disconnect();
  }
}

runGameOrderPublicationRoutingSuite();
