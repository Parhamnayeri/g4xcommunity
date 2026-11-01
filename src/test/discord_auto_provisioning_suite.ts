/**
 * discord_auto_provisioning_suite.ts — Test Suite for Automatic Discord Channel Provisioning & Admin Mapping
 *
 * G4X Community — Verification & Acceptance Suite
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite
 *
 * Coverage:
 *  1. Full automated provisioning of all required categories and channels (Registration, Panels, Publications, Execution).
 *  2. Idempotency & duplicate prevention across multiple runs.
 *  3. Discovery and safe auto-repair of missing/stale channels.
 *  4. Reconciliation against guild state and detection of INVALID channel types.
 *  5. Strict RBAC enforcement (Unauthorized mutations rejected with PERMISSION_DENIED).
 *  6. Clear warning/error handling when bot lacks ManageChannels permission.
 *  7. Manual Channel ID editing with CRITICAL ZERO-DELETION guarantee.
 *  8. Validation of Channel IDs against connected Discord guild.
 *  9. Dynamic catalog provisioning for enabled games and safe deactivation for disabled games.
 * 10. Restart recovery and persistence across in-memory resets.
 * 11. Security & isolation: Private execution coordination channels are not leaked.
 */

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import prisma from '../database/db';
import {
  provisionAllChannels,
  reconcileChannelMappings,
  validateDiscordChannel,
  updateChannelMapping,
  repairChannelMapping,
  toggleChannelMappingStatus,
  listChannelMappings,
} from '../services/discordProvisioningService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

// Test runner helper
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
    failCount++;
  }
}

async function runAutoProvisioningTestSuite(): Promise<void> {
  console.log('\n===============================================================');
  console.log(' G4X Discord Automatic Channel Provisioning & Admin Mapping Suite');
  console.log('===============================================================\n');

  const uAdmin = 'user_admin_prov_01';
  const uManager = 'user_manager_prov_02';
  const uRegular = 'user_regular_prov_03';
  const testUsers = [uAdmin, uManager, uRegular];
  const testGuildId = 'guild_prov_test_99';

  try {
    // ─── ۰. تمیزکاری دیتابیس تست ──────────────────────────────────────────────
    await prisma.discordChannelMapping.deleteMany({ where: { guildId: testGuildId } });
    await prisma.channelRoute.deleteMany({ where: { discordGuildId: testGuildId } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });
    await prisma.gameService.deleteMany({ where: { gameSlug: 'test_auto_game' } });
    await prisma.game.deleteMany({ where: { slug: 'test_auto_game' } });

    // ثبت کاربران تست
    await prisma.user.create({
      data: {
        discordId: uAdmin,
        username: 'ProvAdmin',
        userRoles: { create: [{ roleKey: 'owner' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uManager,
        username: 'ProvManager',
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uRegular,
        username: 'ProvRegular',
      },
    });

    // ─── راه‌اندازی شبیه‌ساز گیلد دیسکورد (Discord Mock Harness) ───────────────
    const mockChannelsMap = new Map<string, any>();
    const mockMessagesMap = new Map<string, any>();
    let deleteCallCount = 0;

    function createMockChannel(data: any): any {
      const parentId = (typeof data.parent === 'object' ? data.parent?.id : data.parent) || null;
      const fakeId = `ch_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
      const fakeChannel = {
        id: fakeId,
        name: data.name,
        type: data.type,
        parentId,
        topic: data.topic || null,
        isTextBased: () => data.type !== ChannelType.GuildCategory && data.type !== 4,
        delete: async () => {
          deleteCallCount++;
          mockChannelsMap.delete(fakeId);
          return fakeChannel;
        },
        setParent: async (parentId: string) => {
          fakeChannel.parentId = parentId;
          return fakeChannel;
        },
        messages: {
          fetch: async (msgId: string) => mockMessagesMap.get(msgId) || null,
        },
        send: async (payload: any) => {
          const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
          const msgObj = {
            id: msgId,
            channelId: fakeId,
            embeds: payload.embeds,
            components: payload.components,
            edit: async (newP: any) => {
              msgObj.embeds = newP.embeds;
              msgObj.components = newP.components;
              return msgObj;
            },
          };
          mockMessagesMap.set(msgId, msgObj);
          return msgObj;
        },
      };
      mockChannelsMap.set(fakeId, fakeChannel);
      return fakeChannel;
    }

    const mockGuild: any = {
      id: testGuildId,
      name: 'G4X Test Guild',
      channels: {
        cache: {
          find: (fn: any) => Array.from(mockChannelsMap.values()).find(fn),
          get: (id: string) => mockChannelsMap.get(id),
          values: () => mockChannelsMap.values(),
        },
        create: async (data: any) => createMockChannel(data),
        fetch: async (id: string) => mockChannelsMap.get(id) || null,
      },
      members: {
        me: {
          permissions: {
            has: (perm: bigint) => true,
          },
        },
      },
      roles: {
        everyone: { id: `${testGuildId}_everyone` },
      },
    };

    // ─── تست ۱: راه‌اندازی و همگام‌سازی اولیه و ایجاد خودکار ساختار کامل ─────────
    console.log('\n--- Test 1: Full Automated Initial Provisioning ---');
    const result1 = await provisionAllChannels({
      guild: mockGuild,
      actorId: uAdmin,
    });

    assert(result1.success === true, '1.1 Initial provisioning reports success');
    assert(result1.totalConfigured >= 22, `1.2 Provisioned all required items (configured: ${result1.totalConfigured})`);
    assert(result1.synced >= 22, `1.3 All items synced to Discord (synced: ${result1.synced})`);

    const dbMappings = await prisma.discordChannelMapping.findMany({
      where: { guildId: testGuildId },
    });
    assert(dbMappings.length >= 22, `1.4 Stored in discord_channel_mappings (records: ${dbMappings.length})`);

    // Verify key categories exist
    const categories = new Set(dbMappings.map((m) => m.categoryName));
    assert(categories.has('START HERE'), '1.5 Category "START HERE" provisioned');
    assert(categories.has('APPLICATION MANAGEMENT'), '1.6 Category "APPLICATION MANAGEMENT" provisioned');
    assert(categories.has('G4X ORDERS'), '1.7 Category "G4X ORDERS" provisioned');
    assert(categories.has('ADVERTISER ORDERS'), '1.8 Category "ADVERTISER ORDERS" provisioned');
    assert(categories.has('WoW Midnight'), '1.9 Category "WoW Midnight" provisioned');
    assert(categories.has('WoW Forever'), '1.10 Category "WoW Forever" provisioned');
    assert(categories.has('ACTIVE ORDERS'), '1.11 Category "ACTIVE ORDERS" provisioned');

    // Verify channel routes synchronized
    const routes = await prisma.channelRoute.findMany({
      where: { discordGuildId: testGuildId },
    });
    assert(routes.length >= 5, `1.12 Channel routes synchronized for publication (routes: ${routes.length})`);

    // Verify AuditLog written
    const audit1 = await prisma.auditLog.findFirst({
      where: { action: 'DISCORD_CHANNELS_AUTO_PROVISIONED', entityId: testGuildId },
    });
    assert(audit1 !== null, '1.13 AuditLog created for auto-provisioning');

    // ─── تست ۲: تکرارپذیری امن (Idempotency) و عدم ایجاد تکراری در ری‌استارت ────
    console.log('\n--- Test 2: Idempotency & Duplicate Prevention ---');
    const initialDiscordChannelCount = mockChannelsMap.size;

    const result2 = await provisionAllChannels({
      guild: mockGuild,
      actorId: uManager,
    });

    assert(result2.success === true, '2.1 Second run reports success');
    assert(result2.created === 0, `2.2 Zero new channels created on rerun (created: ${result2.created})`);
    assert(result2.reused >= 20, `2.3 All channels successfully reused (reused: ${result2.reused})`);
    assert(mockChannelsMap.size === initialDiscordChannelCount, `2.4 Discord guild channels count unchanged (${mockChannelsMap.size})`);

    // ─── تست ۳: کشف و تعمیر خودکار کانال‌های گم‌شده (Missing Channel Auto-Repair) ─
    console.log('\n--- Test 3: Missing Channel Discovery & Repair ---');
    // Simulate channel deleted externally in Discord
    const pilotMapping = dbMappings.find((m) => m.channelKey === 'publication:wow_midnight:pilot_boosts');
    assert(pilotMapping !== undefined && pilotMapping.discordChannelId !== null, '3.1 Found pilot_boosts mapping');

    const deletedChannelId = pilotMapping!.discordChannelId!;
    mockChannelsMap.delete(deletedChannelId); // Delete from Discord

    // Run reconciliation
    const recon1 = await reconcileChannelMappings({
      guild: mockGuild,
      actorId: uAdmin,
    });
    assert(recon1.missing >= 1, `3.2 Reconciliation correctly identified missing channel (missing: ${recon1.missing})`);

    const missingRec = await prisma.discordChannelMapping.findUnique({
      where: { channelKey: 'publication:wow_midnight:pilot_boosts' },
    });
    assert(missingRec?.syncStatus === 'MISSING', '3.3 Mapping status updated to MISSING');

    // Repair the mapping
    const repaired = await repairChannelMapping({
      channelKey: 'publication:wow_midnight:pilot_boosts',
      guild: mockGuild,
      actorId: uAdmin,
    });
    assert(repaired.syncStatus === 'SYNCED', '3.4 Repaired channel status is SYNCED');
    assert(repaired.discordChannelId !== deletedChannelId, '3.5 New Discord channel assigned');
    assert(mockChannelsMap.has(repaired.discordChannelId!), '3.6 Repaired channel exists in Discord guild');

    // Verify ChannelRoute was also updated
    const routePilot = await prisma.channelRoute.findFirst({
      where: { discordGuildId: testGuildId, gameSlug: 'wow_midnight', serviceMode: 'pilot' },
    });
    assert(routePilot?.discordChannelId === repaired.discordChannelId, '3.7 ChannelRoute updated to repaired channel ID');

    // ─── تست ۴: اعتبارسنجی نوع کانال و تشخیص INVALID ───────────────────────────
    console.log('\n--- Test 4: Channel Type Validation & INVALID Detection ---');
    // Map text channel to category ID
    const startHereCat = dbMappings.find((m) => m.channelKey === 'reg:cat:start_here');
    assert(startHereCat !== undefined, '4.1 Found start_here category');

    await prisma.discordChannelMapping.update({
      where: { channelKey: 'reg:public:booster' },
      data: { discordChannelId: startHereCat!.discordChannelId }, // Category ID instead of text channel
    });

    const recon2 = await reconcileChannelMappings({
      guild: mockGuild,
      actorId: uAdmin,
    });
    assert(recon2.invalid >= 1, `4.2 Reconciliation detected type mismatch as INVALID (invalid: ${recon2.invalid})`);

    const invalidRec = await prisma.discordChannelMapping.findUnique({
      where: { channelKey: 'reg:public:booster' },
    });
    assert(invalidRec?.syncStatus === 'INVALID', '4.3 become_booster status set to INVALID');

    // ─── تست ۵: اعمال سطوح دسترسی RBAC (رد درخواست کاربران غیرمجاز) ────────────
    console.log('\n--- Test 5: RBAC Permissions Enforcement ---');
    let rejectedAuth = false;
    try {
      await provisionAllChannels({
        guild: mockGuild,
        actorId: uRegular, // Regular user without management permission
      });
    } catch (err: any) {
      rejectedAuth = err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED;
    }
    assert(rejectedAuth, '5.1 Unauthorized user rejected from provisionAllChannels');

    let rejectedUpdate = false;
    try {
      await updateChannelMapping({
        channelKey: 'reg:public:advertiser',
        newChannelId: '123456',
        actorId: uRegular,
      });
    } catch (err: any) {
      rejectedUpdate = err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED;
    }
    assert(rejectedUpdate, '5.2 Unauthorized user rejected from updateChannelMapping');

    // ─── تست ۶: پیام خطای شفاف در صورت فقدان اختیارات ManageChannels بات ────────
    console.log('\n--- Test 6: Clear Warning when Bot Lacks ManageChannels ---');
    const restrictedGuild: any = {
      ...mockGuild,
      members: {
        me: {
          permissions: {
            has: (p: any) => false, // Bot has NO permissions
          },
        },
      },
    };

    const restrictedRes = await provisionAllChannels({
      guild: restrictedGuild,
      actorId: uAdmin,
    });
    assert(
      restrictedRes.warnings.some((w) => w.includes('ManageChannels')),
      '6.1 Warning explicitly mentions ManageChannels requirement'
    );

    // ─── تست ۷: ویرایش دستی Channel ID و قانون عدم حذف کانال قبلی دیسکورد ──────
    console.log('\n--- Test 7: Manual Channel ID Edit & Zero Deletion Rule ---');
    deleteCallCount = 0; // Reset counter

    // Create a new text channel in mock guild to point to
    const manualTargetChannel = createMockChannel({
      name: 'custom-manual-booster',
      type: ChannelType.GuildText,
    });

    const preUpdateMapping = await prisma.discordChannelMapping.findUnique({
      where: { channelKey: 'reg:public:booster' },
    });
    const oldDiscordChannelId = preUpdateMapping?.discordChannelId;

    const manualResult = await updateChannelMapping({
      channelKey: 'reg:public:booster',
      newChannelId: manualTargetChannel.id,
      actorId: uAdmin,
      guild: mockGuild,
    });

    assert(manualResult.syncStatus === 'MANUAL', '7.1 Status updated to MANUAL');
    assert(manualResult.discordChannelId === manualTargetChannel.id, '7.2 Channel ID updated in database');
    assert(deleteCallCount === 0, '7.3 Old channel was NEVER deleted in Discord (Zero Deletion Rule preserved)');
    if (oldDiscordChannelId) {
      assert(mockChannelsMap.has(oldDiscordChannelId), '7.4 Old channel still safely exists in Discord guild');
    }

    // Verify AuditLog was recorded
    const editAudit = await prisma.auditLog.findFirst({
      where: { action: 'DISCORD_CHANNEL_MAPPING_UPDATED', entityId: 'reg:public:booster' },
    });
    assert(editAudit !== null, '7.5 AuditLog recorded for manual Channel ID edit');

    // ─── تست ۸: اعتبارسنجی شناسه کانال در سرور دیسکورد (Channel ID Validation) ──
    console.log('\n--- Test 8: Discord Channel Validation Helper ---');
    const valGood = await validateDiscordChannel(manualTargetChannel.id, mockGuild, 'GUILD_TEXT');
    assert(valGood.valid === true, '8.1 Valid text channel passes validation');

    const valBad = await validateDiscordChannel('non_existent_snowflake_id', mockGuild, 'GUILD_TEXT');
    assert(valBad.valid === false, '8.2 Unknown channel ID fails validation');

    const valTypeMismatch = await validateDiscordChannel(manualTargetChannel.id, mockGuild, 'GUILD_CATEGORY');
    assert(valTypeMismatch.valid === false && valTypeMismatch.error!.includes('not a Category'), '8.3 Type mismatch fails validation with clear error');

    // ─── تست ۹: همگام‌سازی بازی‌های فعال و غیرفعال‌سازی ایمن بازی‌های کاتالوگ ─────
    console.log('\n--- Test 9: Dynamic Games Catalog & Disabled Games ---');
    // Add a new game to database
    await prisma.game.create({
      data: {
        slug: 'test_auto_game',
        displayName: 'Apex Boosts',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    const dynProv = await provisionAllChannels({
      guild: mockGuild,
      actorId: uAdmin,
    });

    const dynMappings = await prisma.discordChannelMapping.findMany({
      where: { guildId: testGuildId, gameSlug: 'test_auto_game' },
    });
    assert(dynMappings.length >= 3, `9.1 Dynamic game provisioned category and 2 boost channels (count: ${dynMappings.length})`);
    assert(dynMappings.every((m) => m.syncStatus === 'SYNCED'), '9.2 All dynamic game channels are SYNCED');

    // Now disable the game in catalog
    await prisma.game.update({
      where: { slug: 'test_auto_game' },
      data: { isActive: false },
    });

    await provisionAllChannels({
      guild: mockGuild,
      actorId: uAdmin,
    });

    const disabledMappings = await prisma.discordChannelMapping.findMany({
      where: { guildId: testGuildId, gameSlug: 'test_auto_game' },
    });
    assert(disabledMappings.every((m) => m.syncStatus === 'DISABLED' && !m.isActive), '9.3 Disabled game channels marked as DISABLED and inactive');

    // ─── تست ۱۰: بازیابی پس از ری‌استارت (Restart Recovery) ─────────────────────
    console.log('\n--- Test 10: Restart Recovery ---');
    // Re-query from clean DB
    const listAfterRestart = await listChannelMappings({ guildId: testGuildId });
    assert(listAfterRestart.length >= 22, `10.1 Channel inventory persists across restarts (count: ${listAfterRestart.length})`);

    const manualCheck = listAfterRestart.find((m) => m.channelKey === 'reg:public:booster');
    assert(manualCheck?.syncStatus === 'MANUAL', '10.2 Manual configuration overrides preserved across restart');

    // ─── تست ۱۱: امنیت و ایزولاسیون کانال‌های اجرای خصوصی سفارشات ──────────────
    console.log('\n--- Test 11: Private Order Execution Channel Security ---');
    const orderCoordinationChannels = listAfterRestart.filter((m) => m.channelName.startsWith('order-'));
    assert(orderCoordinationChannels.length === 0, '11.1 Dynamic private customer/booster execution channels are NOT exposed in public mappings');

    const execCategory = listAfterRestart.find((m) => m.channelKey === 'execution:cat:active_orders');
    assert(execCategory !== undefined && execCategory.channelType === 'GUILD_CATEGORY', '11.2 ACTIVE ORDERS parent category properly provisioned');

    // ─── پاکسازی پایانی ────────────────────────────────────────────────────────
    await prisma.discordChannelMapping.deleteMany({ where: { guildId: testGuildId } });
    await prisma.channelRoute.deleteMany({ where: { discordGuildId: testGuildId } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });
    await prisma.gameService.deleteMany({ where: { gameSlug: 'test_auto_game' } });
    await prisma.game.deleteMany({ where: { slug: 'test_auto_game' } });

  } catch (err: any) {
    console.error('Unhandled test suite error:', err);
    failCount++;
  }

  console.log('\n===============================================================');
  console.log(` Provisioning Test Results: ${passCount} Passed, ${failCount} Failed`);
  console.log('===============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAutoProvisioningTestSuite();
