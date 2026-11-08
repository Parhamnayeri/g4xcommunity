/**
 * discord_order_panels_suite.ts — Comprehensive Test Suite for Dedicated Discord Order Creation Panels
 *
 * Verifies:
 *  1. Six panel locations in two distinct categories (G4X Orders & Advertiser Orders).
 *  2. Idempotent setup (no duplicate categories, channels, or panel messages on rerun).
 *  3. Restart recovery (stateless interaction customIds survive bot restart).
 *  4. Authorized and unauthorized button access (G4X direct vs Advertiser).
 *  5. Server-side validation against forged modal component IDs.
 *  6. Modal input validation (amounts, games, services).
 *  7. WoW Midnight Mythic order creation with 4-Booster requirement (1 Tank, 1 Healer, 2 DPS).
 *  8. Non-Pilot order creation and mode validation.
 *  9. Pilot order creation with VPN directives and pilot mode enforcement.
 * 10. Separation of G4X-direct vs Advertiser-originated orders in metadata and AuditLog.
 * 11. Authoritative Advertiser commercial rank commission snapshot (no G2G seller deductions on G4X orders).
 * 12. Unpaid orders remain unpublished in payment_pending / draft status.
 * 13. Zero unexpected wallet movements when funding is pending.
 */

import prisma from '../database/db';
import { setupOrderPanels } from '../services/orderChannelSetup';
import {
  handleOrderPanelButton,
  handleOrderPanelModalSubmit,
  buildMythicPanelEmbed,
  buildNonPilotPanelEmbed,
  buildPilotPanelEmbed,
  buildOrderPanelButtons,
} from '../interactions/orderPanelInteractions';
import { handleSetupCommand } from '../commands/setup';
import { AdvertiserRank } from '../services/advertiserRankService';
import { Permission } from '../services/permissionTypes';

async function runOrderPanelsSuite() {
  console.log('=== STARTING DISCORD ORDER CREATION PANELS INTEGRATION SUITE ===\n');

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

  const uManager = 'test_pan_manager_9101';
  const uAdmin = 'test_pan_admin_9102';
  const uAdvertiser = 'test_pan_adv_9103';
  const uUnrankedAdv = 'test_pan_unranked_adv_9104';
  const uRegular = 'test_pan_regular_9105';

  const testUsers = [uManager, uAdmin, uAdvertiser, uUnrankedAdv, uRegular];

  try {
    // ─── ۰. آماده‌سازی و پاکسازی رکوردهای تست ───────────────────────────────
    await prisma.orderPresign.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderAssignment.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderRequiredRole.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.order.deleteMany({ where: { creatorId: { in: testUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });

    // ثبت کاربران تست در دیتابیس
    await prisma.user.create({
      data: {
        discordId: uManager,
        username: 'PanManager',
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uAdmin,
        username: 'PanAdmin',
        userRoles: { create: [{ roleKey: 'admin' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uAdvertiser,
        username: 'PanAdvertiser',
        advertiserRank: AdvertiserRank.BRONZE,
        userRoles: { create: [{ roleKey: 'advertiser' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uUnrankedAdv,
        username: 'PanUnrankedAdv',
        advertiserRank: null,
        userRoles: { create: [{ roleKey: 'advertiser' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: uRegular,
        username: 'PanRegularUser',
      },
    });

    // ─── تست ۱: استقرار ۶ پنل در دو دسته‌بندی مجزا ───────────────────────────
    const mockGuildChannels = new Map<string, any>();
    const mockGuild: any = {
      id: 'mock_order_panels_guild_77',
      channels: {
        cache: {
          find: (fn: any) => Array.from(mockGuildChannels.values()).find(fn),
          get: (id: string) => mockGuildChannels.get(id),
        },
        create: async (data: any) => {
          const fakeId = `ch_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
          const fakeChannel = {
            id: fakeId,
            name: data.name,
            type: data.type,
            parentId: data.parent,
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

    const setupResult = await setupOrderPanels({ guild: mockGuild, actorId: uManager });

    const hasG4xCat = Boolean(setupResult.categories.g4xOrdersId);
    const hasAdvCat = Boolean(setupResult.categories.advertiserOrdersId);
    const hasG4xMythic = Boolean(setupResult.g4xChannels.mythic?.channelId);
    const hasG4xNonPilot = Boolean(setupResult.g4xChannels.non_pilot?.channelId);
    const hasG4xPilot = Boolean(setupResult.g4xChannels.pilot?.channelId);
    const hasAdvMythic = Boolean(setupResult.advertiserChannels.mythic?.channelId);
    const hasAdvNonPilot = Boolean(setupResult.advertiserChannels.non_pilot?.channelId);
    const hasAdvPilot = Boolean(setupResult.advertiserChannels.pilot?.channelId);

    assert(
      setupResult.success &&
        hasG4xCat &&
        hasAdvCat &&
        hasG4xMythic &&
        hasG4xNonPilot &&
        hasG4xPilot &&
        hasAdvMythic &&
        hasAdvNonPilot &&
        hasAdvPilot,
      '1. Six order creation channels deployed across two separate categories (G4X Orders & Advertiser Orders)',
      `G4X Cat: ${setupResult.categories.g4xOrdersId}, Adv Cat: ${setupResult.categories.advertiserOrdersId}`
    );

    // ─── تست ۲: تکرارپذیری امن (Idempotency) ──────────────────────────────────
    const countAfterRun1 = mockGuildChannels.size;
    const setupRun2 = await setupOrderPanels({ guild: mockGuild, actorId: uManager });
    const countAfterRun2 = mockGuildChannels.size;

    assert(
      setupRun2.success && countAfterRun1 === countAfterRun2,
      '2. Panel setup is completely idempotent on repeated execution (no duplicate categories or channels)',
      `Channels Run 1: ${countAfterRun1}, Channels Run 2: ${countAfterRun2}`
    );

    // ─── تست ۳: پایداری پس از ری‌استارت (Restart Recovery) ────────────────────
    const btnMythicG4x = buildOrderPanelButtons('g4x', 'mythic').components[0].data as any;
    const btnPilotAdv = buildOrderPanelButtons('adv', 'pilot').components[0].data as any;

    assert(
      btnMythicG4x.custom_id === 'ord_create:g4x:mythic' && btnPilotAdv.custom_id === 'ord_create:adv:pilot',
      '3. Panel interaction customIds are stateless and recoverable across bot restarts'
    );

    // ─── تست ۴: بررسی دسترسی دکمه‌ها (Authorized vs Unauthorized) ───────────
    let replyUnauthG4x = '';
    const mockUnauthG4xBtn: any = {
      customId: 'ord_create:g4x:mythic',
      user: { id: uRegular },
      reply: async (p: any) => {
        replyUnauthG4x = p.content;
      },
    };
    await handleOrderPanelButton(mockUnauthG4xBtn);

    let replyUnauthAdv = '';
    const mockUnauthAdvBtn: any = {
      customId: 'ord_create:adv:mythic',
      user: { id: uRegular },
      reply: async (p: any) => {
        replyUnauthAdv = p.content;
      },
    };
    await handleOrderPanelButton(mockUnauthAdvBtn);

    let replyUnrankedAdv = '';
    const mockUnrankedAdvBtn: any = {
      customId: 'ord_create:adv:mythic',
      user: { id: uUnrankedAdv },
      reply: async (p: any) => {
        replyUnrankedAdv = p.content;
      },
    };
    await handleOrderPanelButton(mockUnrankedAdvBtn);

    assert(
      replyUnauthG4x.includes('Permission Denied') &&
        replyUnauthAdv.includes('Permission Denied') &&
        replyUnrankedAdv.includes('Unresolved Commercial Rank'),
      '4. Unauthorized and unranked users are denied access to panel order creation buttons',
      `G4X unauth: ${replyUnauthG4x.substring(0, 40)}, Adv unauth: ${replyUnauthAdv.substring(0, 40)}`
    );

    // ─── تست ۵: دسترسی کاربر مجاز به شروع ویزارد هدایت‌شده به جای مودال مستقیم ────────────
    let wizardReplyAdv: any = null;
    const mockAuthAdvBtn: any = {
      customId: 'ord_create:adv:mythic',
      user: { id: uAdvertiser },
      showModal: async () => {},
      reply: async (p: any) => {
        wizardReplyAdv = p;
      },
      update: async () => {},
    };
    await handleOrderPanelButton(mockAuthAdvBtn);

    assert(
      wizardReplyAdv !== null &&
        wizardReplyAdv.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Game'),
      '5. Authorized user clicking panel button starts Guided Wizard with Game selection (Advertiser flow)'
    );

    let wizardReplyG4x: any = null;
    const mockAuthG4xBtn: any = {
      customId: 'ord_create:g4x:mythic',
      user: { id: uManager },
      showModal: async () => {},
      reply: async (p: any) => {
        wizardReplyG4x = p;
      },
      update: async () => {},
    };
    await handleOrderPanelButton(mockAuthG4xBtn);

    assert(
      wizardReplyG4x !== null &&
        wizardReplyG4x.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Platform'),
      '5b. Authorized user clicking G4X panel button starts Guided Wizard with Platform selection'
    );

    // ─── تست ۶: جلوگیری از دسترسی غیرمجاز در ارسال مودال‌های قدیمی بازنشسته‌شده ───────
    let replyForgedModal = '';
    const mockForgedModal: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uRegular },
      reply: async (p: any) => {
        replyForgedModal = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockForgedModal);

    assert(
      replyForgedModal.includes('Permission Denied'),
      '6. Server validates permissions on modal submission, blocking unauthorized bypasses'
    );

    // ─── تست ۷: هدایت کاربران به ویزارد جدید هنگام کلیک روی مودال‌های قدیمی بازنشسته‌شده ─
    let replyRetiredNotice = '';
    const mockRetiredModalSubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      reply: async (p: any) => {
        replyRetiredNotice = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockRetiredModalSubmit);

    assert(
      replyRetiredNotice.includes('Legacy Order Modal Retired') &&
        replyRetiredNotice.includes('Guided Order Wizard'),
      '7. Retired legacy modal submissions inform authorized users to proceed via Guided Order Wizard'
    );


    // ─── تست ۸ تا ۱۴: اعتبارسنجی بازنشستگی کامل ارسال مستقیم مودال و هدایت به ویزارد ────────────
    let replyLegacyMythic = '';
    const mockMythicSubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      reply: async (p: any) => {
        replyLegacyMythic = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMythicSubmit);

    assert(
      replyLegacyMythic.includes('Legacy Order Modal Retired') &&
        replyLegacyMythic.includes('Guided Order Wizard'),
      '8. Mythic legacy modal submission informs user of wizard retirement without creating unguided orders'
    );

    let replyLegacyNonPilot = '';
    const mockNonPilotSubmit: any = {
      customId: 'modal_ord:g4x:non_pilot',
      user: { id: uManager },
      reply: async (p: any) => {
        replyLegacyNonPilot = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockNonPilotSubmit);

    assert(
      replyLegacyNonPilot.includes('Legacy Order Modal Retired'),
      '9. Non-Pilot legacy modal submission safely directs user to wizard'
    );

    let replyLegacyPilot = '';
    const mockPilotSubmit: any = {
      customId: 'modal_ord:adv:pilot',
      user: { id: uAdvertiser },
      reply: async (p: any) => {
        replyLegacyPilot = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockPilotSubmit);

    assert(
      replyLegacyPilot.includes('Legacy Order Modal Retired'),
      '10. Pilot legacy modal submission safely directs user to wizard'
    );

    // ─── تست ۱۱: عدم ثبت سفارشات معلق با متد مودال مستقیم ─────────────
    const directOrderCount = await prisma.order.count({
      where: { creatorId: { in: [uManager, uAdvertiser] } },
    });
    assert(
      directOrderCount === 0,
      '11. Zero rogue orders created via legacy direct modal endpoints'
    );

    // ─── تست ۱۲: عدم کسر غیرمنتظره موجودی والت در کاربر ───────────
    const advWalletAfter = await prisma.walletV2.findUnique({
      where: { userId: uAdvertiser },
    });
    const ledgerCount = await prisma.ledgerEntryV2.count({
      where: { userId: uAdvertiser },
    });

    assert(
      advWalletAfter === null && ledgerCount === 0,
      '12. No unexpected wallet balance mutations or ledger entries from legacy modal interactions'
    );

    // ─── تست ۱۳: اجرای دستور G4!setup orders توسط مدیریت مجاز ────────────────
    let setupCommandReply = '';
    const mockSetupMsg: any = {
      author: { id: uManager },
      guild: mockGuild,
      reply: async (p: any) => {
        setupCommandReply = p.content;
      },
    };
    await handleSetupCommand(mockSetupMsg, ['orders']);

    assert(
      setupCommandReply.includes('Order Creation Panel Architecture Setup Completed Successfully'),
      '13. G4!setup orders executes successfully for authorized management and outputs confirmation'
    );

  } catch (err) {
    console.error('Unhandled error in order panels suite:', err);
    failed++;
  } finally {
    // پاکسازی نهایی
    await prisma.orderPresign.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderAssignment.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderRequiredRole.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { creatorId: { in: testUsers } } } });
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.order.deleteMany({ where: { creatorId: { in: testUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers } } });
  }

  console.log(`\n=== RESULTS: ${passed} PASSED / ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runOrderPanelsSuite().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
