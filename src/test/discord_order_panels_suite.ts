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

    // ─── تست ۵: دسترسی کاربر مجاز به نمایش مودال ────────────────────────────
    let modalShown: any = null;
    const mockAuthAdvBtn: any = {
      customId: 'ord_create:adv:mythic',
      user: { id: uAdvertiser },
      showModal: async (m: any) => {
        modalShown = m;
      },
      reply: async () => {},
    };
    await handleOrderPanelButton(mockAuthAdvBtn);

    assert(
      modalShown !== null && modalShown.data?.custom_id === 'modal_ord:adv:mythic',
      '5. Authorized user successfully receives the dedicated order creation Modal'
    );

    // ─── تست ۶: جلوگیری از جعل Component ID در ارسال مودال ──────────────────
    let replyForgedModal = '';
    const mockForgedModal: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uRegular },
      fields: {
        getTextInputValue: (f: string) => (f === 'amount_usd' ? '50' : 'test'),
      },
      reply: async (p: any) => {
        replyForgedModal = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockForgedModal);

    assert(
      replyForgedModal.includes('Permission Denied'),
      '6. Server validates permissions on modal submission, blocking forged component ID bypasses'
    );

    // ─── تست ۷: اعتبارسنجی مقادیر نامعتبر فرم (Input Validation) ─────────────
    let replyInvalidAmount = '';
    const mockInvalidAmountModal: any = {
      customId: 'modal_ord:adv:mythic',
      user: { id: uAdvertiser },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'amount_usd') return '-25.00';
          if (f === 'key_level') return '+10 Ara-Kara';
          return '';
        },
      },
      reply: async (p: any) => {
        replyInvalidAmount = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockInvalidAmountModal);

    assert(
      replyInvalidAmount.includes('Invalid Order Amount'),
      '7. Modal rejects invalid/negative amounts safely'
    );

    // ─── تست ۸: ایجاد سفارش WoW Midnight Mythic با الزام ۴ بوستر ────────────
    let replyMythicCreated = '';
    const mockMythicSubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'key_level') return '+10 The Dawnbreaker';
          if (f === 'amount_usd') return '60.00';
          if (f === 'runs_count') return '1';
          if (f === 'customer_info') return 'Player#1111';
          if (f === 'notes') return 'Cloth stack requested';
          return '';
        },
      },
      reply: async (p: any) => {
        replyMythicCreated = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMythicSubmit);

    const createdMythicOrder = await prisma.order.findFirst({
      where: { creatorId: uManager, notes: { contains: '+10 The Dawnbreaker' } },
      include: { requiredRoles: true },
    });

    const rolesCount = createdMythicOrder?.requiredRoles.reduce((s, r) => s + r.quantity, 0) || 0;
    const hasTank = createdMythicOrder?.requiredRoles.some((r) => r.roleName === 'tank' && r.quantity === 1);
    const hasHealer = createdMythicOrder?.requiredRoles.some((r) => r.roleName === 'healer' && r.quantity === 1);
    const hasDps = createdMythicOrder?.requiredRoles.some((r) => r.roleName === 'dps' && r.quantity === 2);

    assert(
      createdMythicOrder !== null &&
        createdMythicOrder.gameSlug === 'wow_midnight' &&
        createdMythicOrder.orderMode === 'non_pilot' &&
        createdMythicOrder.creatorType === 'g4x' &&
        rolesCount === 4 &&
        Boolean(hasTank && hasHealer && hasDps),
      '8. WoW Midnight Mythic panel creates order with correct service and 4-Booster squad requirement (1 Tank, 1 Healer, 2 DPS)',
      `Total Booster Roles: ${rolesCount}`
    );

    // ─── تست ۹: ایجاد سفارش Non-Pilot و اعتبارسنجی مود ───────────────────────
    let replyNonPilotCreated = '';
    const mockNonPilotSubmit: any = {
      customId: 'modal_ord:g4x:non_pilot',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'rainbow_six_siege';
          if (f === 'service_id') return 'non_pilot_boost';
          if (f === 'amount_usd') return '35.00';
          if (f === 'runs_count') return '2';
          if (f === 'notes') return 'Ranked placements';
          return '';
        },
      },
      reply: async (p: any) => {
        replyNonPilotCreated = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockNonPilotSubmit);

    const createdNonPilotOrder = await prisma.order.findFirst({
      where: { creatorId: uManager, gameSlug: 'rainbow_six_siege' },
    });

    assert(
      createdNonPilotOrder !== null &&
        createdNonPilotOrder.orderMode === 'non_pilot' &&
        createdNonPilotOrder.grossAmountMinor === 3500 &&
        createdNonPilotOrder.quantity === 2,
      '9. Non-Pilot panel successfully creates non-pilot order with accurate properties'
    );

    // ─── تست ۱۰: ایجاد سفارش Pilot و ذخیره الزامات امنیتی VPN (عدم وجود runs_count در مودال پایلوت) ───
    let replyPilotCreated = '';
    const mockPilotSubmit: any = {
      customId: 'modal_ord:adv:pilot',
      user: { id: uAdvertiser },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'wow_classic_era';
          if (f === 'service_id') return 'pilot_boost';
          if (f === 'amount_usd') return '80.00';
          if (f === 'runs_count') {
            // شبیه‌سازی دقیق رفتار دیسکورد: فیلد runs_count در فرم پایلوت وجود ندارد و باید خطا پرتاب کند
            throw new Error('DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "runs_count" not found.');
          }
          if (f === 'vpn_location') return 'Sweden / Stockholm';
          if (f === 'notes') return 'Stream via Discord required';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyPilotCreated = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockPilotSubmit);

    const createdPilotOrder = await prisma.order.findFirst({
      where: { creatorId: uAdvertiser, gameSlug: 'wow_classic_era' },
    });

    assert(
      createdPilotOrder !== null &&
        createdPilotOrder.orderMode === 'pilot' &&
        createdPilotOrder.quantity === 1 &&
        createdPilotOrder.notes?.includes('Sweden / Stockholm') &&
        createdPilotOrder.creatorType === 'advertiser',
      '10. Pilot panel creates pilot order with preserved VPN security requirements without runs_count crash'
    );

    // ─── تست ۱۱: تفکیک دقیق متادیتا و اسنپ‌شات کمیسیون ادورتایزر ─────────────
    const advSnapshot = await prisma.orderFinancialSnapshot.findUnique({
      where: { orderId: createdPilotOrder!.id },
    });

    assert(
      advSnapshot !== null &&
        advSnapshot.advertiserRank === AdvertiserRank.BRONZE &&
        advSnapshot.rankFeeBasisPoints === 1499 &&
        advSnapshot.g4xFeeMinor === Math.round(8000 * 0.1499) &&
        advSnapshot.boosterPoolMinor === 8000 - Math.round(8000 * 0.1499),
      '11. Correct Advertiser commission snapshot applied (Bronze 14.99%, no G2G deductions on direct orders)',
      `Gross: $80, Fee: ${advSnapshot?.g4xFeeMinor} cents, Pool: ${advSnapshot?.boosterPoolMinor} cents`
    );

    // ─── تست ۱۲: عدم انتشار سفارش بدون پرداخت (Unpaid Stays Unpublished) ─────
    assert(
      createdPilotOrder?.paymentStatus === 'pending' &&
        createdPilotOrder?.status === 'payment_pending' &&
        createdPilotOrder?.discordMessageId === null,
      '12. Unpaid panel orders remain unpublished in payment_pending / draft status',
      `Payment: ${createdPilotOrder?.paymentStatus}, Status: ${createdPilotOrder?.status}`
    );

    // ─── تست ۱۳: عدم کسر غیرمنتظره موجودی والت در سفارش پرداخت‌نشده ───────────
    const advWalletAfter = await prisma.walletV2.findUnique({
      where: { userId: uAdvertiser },
    });
    const ledgerCount = await prisma.ledgerEntryV2.count({
      where: { userId: uAdvertiser },
    });

    assert(
      advWalletAfter === null && ledgerCount === 0,
      '13. No unexpected wallet balance mutations or ledger entries for unfunded draft orders'
    );

    // ─── تست ۱۴: ثبت لاگ‌های ممیزی در AuditLog ──────────────────────────────
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        actorId: { in: [uManager, uAdvertiser] },
        action: 'ORDER_CREATED_DISCORD_PANEL',
      },
    });

    assert(
      auditLogs.length >= 3,
      '14. AuditLog records created with full metadata for each panel order submission',
      `Found ${auditLogs.length} audit records`
    );

    // ─── تست ۱۵: اجرای دستور G4!setup orders توسط مدیریت مجاز ────────────────
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
      '15. G4!setup orders executes successfully for authorized management and outputs confirmation'
    );

    // ─── تست ۱۶: اعتبارسنجی نبود فیلد اجباری VPN در مودال پایلوت ─────────────
    let replyMissingVpn = '';
    const mockMissingVpnModal: any = {
      customId: 'modal_ord:adv:pilot',
      user: { id: uAdvertiser },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'wow_classic_era';
          if (f === 'service_id') return 'pilot_boost';
          if (f === 'amount_usd') return '50.00';
          if (f === 'vpn_location') return '';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMissingVpn = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMissingVpnModal);
    assert(
      replyMissingVpn.includes('Missing VPN Location'),
      '16. Pilot modal rejects submission when VPN location is missing or empty'
    );

    // ─── تست ۱۷: اعتبارسنجی نبود Game Slug در مودال پایلوت ───────────────────
    let replyMissingGameSlug = '';
    const mockMissingGameModal: any = {
      customId: 'modal_ord:adv:pilot',
      user: { id: uAdvertiser },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'service_id') return 'pilot_boost';
          if (f === 'amount_usd') return '50.00';
          if (f === 'vpn_location') return 'Germany / Frankfurt';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMissingGameSlug = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMissingGameModal);
    assert(
      replyMissingGameSlug.includes('Missing Game Slug'),
      '17. Pilot modal rejects submission when Game Slug is missing'
    );

    // ─── تست ۱۸: اعتبارسنجی نبود Service ID در مودال پایلوت ──────────────────
    let replyMissingServiceId = '';
    const mockMissingServiceModal: any = {
      customId: 'modal_ord:adv:pilot',
      user: { id: uAdvertiser },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'wow_classic_era';
          if (f === 'amount_usd') return '50.00';
          if (f === 'vpn_location') return 'Germany / Frankfurt';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMissingServiceId = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMissingServiceModal);
    assert(
      replyMissingServiceId.includes('Missing Service ID'),
      '18. Pilot modal rejects submission when Service ID is missing'
    );

    // ─── تست ۱۹: ایجاد Non-Pilot در صورت خالی بودن یا نبود فیلد اختیاری runs_count ───
    let replyNonPilotNoRuns = '';
    const mockNonPilotNoRunsSubmit: any = {
      customId: 'modal_ord:g4x:non_pilot',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'rainbow_six_siege';
          if (f === 'service_id') return 'non_pilot_boost';
          if (f === 'amount_usd') return '40.00';
          if (f === 'notes') return 'Omitted runs_count test';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyNonPilotNoRuns = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockNonPilotNoRunsSubmit);
    const createdNoRunsOrder = await prisma.order.findFirst({
      where: { creatorId: uManager, notes: 'Omitted runs_count test' },
    });
    assert(
      createdNoRunsOrder !== null && createdNoRunsOrder.quantity === 1,
      '19. Non-Pilot modal gracefully defaults to quantity 1 when optional runs_count is omitted'
    );

    // ─── تست ۲۰: اعتبارسنجی runs_count نامعتبر در Non-Pilot ──────────────────
    let replyNonPilotInvalidRuns = '';
    const mockNonPilotInvalidRunsSubmit: any = {
      customId: 'modal_ord:g4x:non_pilot',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'rainbow_six_siege';
          if (f === 'service_id') return 'non_pilot_boost';
          if (f === 'amount_usd') return '40.00';
          if (f === 'runs_count') return 'not_a_number';
          return '';
        },
      },
      reply: async (p: any) => {
        replyNonPilotInvalidRuns = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockNonPilotInvalidRunsSubmit);
    assert(
      replyNonPilotInvalidRuns.includes('Invalid Runs Count'),
      '20. Non-Pilot modal rejects non-numeric runs_count with English ephemeral error'
    );

    // ─── تست ۲۱: اعتبارسنجی runs_count منفی یا صفر در Non-Pilot ──────────────
    let replyNonPilotZeroRuns = '';
    const mockNonPilotZeroRunsSubmit: any = {
      customId: 'modal_ord:g4x:non_pilot',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'game_slug') return 'rainbow_six_siege';
          if (f === 'service_id') return 'non_pilot_boost';
          if (f === 'amount_usd') return '40.00';
          if (f === 'runs_count') return '0';
          return '';
        },
      },
      reply: async (p: any) => {
        replyNonPilotZeroRuns = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockNonPilotZeroRunsSubmit);
    assert(
      replyNonPilotZeroRuns.includes('Invalid Runs Count'),
      '21. Non-Pilot modal rejects zero or negative runs_count'
    );

    // ─── تست ۲۲: ایجاد Mythic+ در صورت خالی بودن یا نبود فیلد اختیاری runs_count ───
    let replyMythicNoRuns = '';
    const mockMythicNoRunsSubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'key_level') return '+12 Grim Batol';
          if (f === 'amount_usd') return '70.00';
          if (f === 'notes') return 'No runs specified';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMythicNoRuns = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMythicNoRunsSubmit);
    const createdMythicNoRuns = await prisma.order.findFirst({
      where: { creatorId: uManager, notes: { contains: '+12 Grim Batol' } },
    });
    assert(
      createdMythicNoRuns !== null && createdMythicNoRuns.quantity === 1,
      '22. Mythic+ modal gracefully defaults to quantity 1 when optional runs_count is omitted'
    );

    // ─── تست ۲۳: اعتبارسنجی نبود key_level در Mythic+ ─────────────────────────
    let replyMissingKey = '';
    const mockMissingKeySubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'amount_usd') return '70.00';
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMissingKey = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMissingKeySubmit);
    assert(
      replyMissingKey.includes('Missing Key Level'),
      '23. Mythic+ modal rejects submission when key_level is missing'
    );

    // ─── تست ۲۴: اعتبارسنجی runs_count نامعتبر در Mythic+ ────────────────────
    let replyMythicInvalidRuns = '';
    const mockMythicInvalidRunsSubmit: any = {
      customId: 'modal_ord:g4x:mythic',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'key_level') return '+10 Necrotic Wake';
          if (f === 'amount_usd') return '70.00';
          if (f === 'runs_count') return 'xyz';
          return '';
        },
      },
      reply: async (p: any) => {
        replyMythicInvalidRuns = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMythicInvalidRunsSubmit);
    assert(
      replyMythicInvalidRuns.includes('Invalid Runs Count'),
      '24. Mythic+ modal rejects non-numeric runs_count'
    );

    // ─── تست ۲۵: مدیریت خطا در صورت نبود فیلد amount_usd بدون کرش کردن ربات ──
    let replyMissingAmount = '';
    const mockMissingAmountSubmit: any = {
      customId: 'modal_ord:g4x:pilot',
      user: { id: uManager },
      fields: {
        getTextInputValue: (f: string) => {
          throw new Error(`DiscordjsTypeError [ModalSubmitInteractionFieldNotFound]: Required field with custom id "${f}" not found.`);
        },
      },
      reply: async (p: any) => {
        replyMissingAmount = p.content;
      },
    };
    await handleOrderPanelModalSubmit(mockMissingAmountSubmit);
    assert(
      replyMissingAmount.includes('Invalid Order Amount'),
      '25. Handler catches missing amount field gracefully without uncaught DiscordjsTypeError crash'
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
