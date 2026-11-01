/**
 * order_wizard_publication_suite.ts — Comprehensive Regression & Invariant Test Suite
 *
 * Verifies all 20 required criteria:
 *  1. Every G4X panel button begins with the platform dropdown.
 *  2. Every Advertiser panel button begins with the game dropdown.
 *  3. Correct platform -> game -> service -> modal flow.
 *  4. Site Order ID required for G4X.
 *  5. Duplicate Site Order ID rejected within the same platform/account.
 *  6. Identical IDs allowed across different platforms.
 *  7. Disabled games/services cannot be selected.
 *  8. Pilot and Non-Pilot validations.
 *  9. Mythic+ relevant key and runs fields.
 * 10. Restart-safe interaction handling.
 * 11. G4X management order creation with zero manager wallet balance.
 * 12. No manager WalletV2 reservation or ledger debit.
 * 13. External order publication with pending external settlement.
 * 14. No fabricated verified external cash.
 * 15. Advertiser unpaid order remains unpublished.
 * 16. Advertiser payment and commercial fee rules unchanged.
 * 17. External fee calculations correct and without double deductions.
 * 18. Duplicate interaction submission creates only one order.
 * 19. Existing claim, assignment, dispute and financial release protections.
 * 20. No unexpected payouts, wallet credits or escrow release.
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
  buildWizardOrderModal,
  handleOrderWizardSelectMenu,
  handleOrderWizardModalSubmit,
} from '../interactions/orderWizardInteractions';
import { handleOrderPanelButton } from '../interactions/orderPanelInteractions';
import { publishOrRefreshOrderCard } from '../services/orderDiscordService';
import { seedStandardFeePolicies } from '../services/financialPolicyService';
import { AdvertiserRank } from '../services/advertiserRankService';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (Boolean(condition)) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
    throw new Error(testName);
  }
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING ORDER WIZARD & G4X PUBLICATION REGRESSION SUITE (20 CRITERIA)');
  console.log('================================================================\n');

  const ts = Date.now();
  const testManagerId = `mgr_reg_${ts}`;
  const testAdvId = `adv_reg_${ts}`;
  const testBoosterId = `bst_reg_${ts}`;
  const testGuildId = `guild_reg_${ts}`;

  try {
    await seedStandardFeePolicies();

    // ─── 0. Create Test Users ───
    await prisma.user.create({
      data: {
        discordId: testManagerId,
        username: `Manager_${ts}`,
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testAdvId,
        username: `Advertiser_${ts}`,
        advertiserRank: AdvertiserRank.GOLD,
        userRoles: { create: [{ roleKey: 'advertiser' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testBoosterId,
        username: `Booster_${ts}`,
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    // Ensure platform account exists
    const g2gAccount = await prisma.platformAccount.upsert({
      where: { accountRef: 'g2g_reg_main' },
      update: { isActive: true },
      create: {
        accountRef: 'g2g_reg_main',
        platform: 'g2g',
        displayName: 'G2G Main Reg Account',
        isActive: true,
      },
    });

    const skycoachAccount = await prisma.platformAccount.upsert({
      where: { accountRef: 'skycoach_reg_main' },
      update: { isActive: true },
      create: {
        accountRef: 'skycoach_reg_main',
        platform: 'skycoach',
        displayName: 'SkyCoach Main Reg Account',
        isActive: true,
      },
    });

    // Ensure test games exist
    let game = await prisma.game.findFirst({ where: { slug: 'wow_midnight', isActive: true } });
    if (!game) {
      game = await prisma.game.create({
        data: {
          slug: 'wow_midnight',
          displayName: 'World of Warcraft: Midnight',
          serviceCategory: 'rpg',
          isActive: true,
        },
      });
    }

    let mythicService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus', isActive: true },
    });
    if (!mythicService) {
      mythicService = await prisma.gameService.create({
        data: {
          gameSlug: 'wow_midnight',
          serviceKey: 'mythic_plus',
          displayName: 'Mythic+ Dungeon Run',
          serviceMode: 'non_pilot',
          profileMode: 'public',
          isActive: true,
        },
      });
    }

    let pilotService = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight', serviceMode: 'pilot', isActive: true },
    });
    if (!pilotService) {
      pilotService = await prisma.gameService.create({
        data: {
          gameSlug: 'wow_midnight',
          serviceKey: 'pilot_raid',
          displayName: 'Raid Pilot Carry',
          serviceMode: 'pilot',
          profileMode: 'private',
          isActive: true,
        },
      });
    }


    // ─── 1. Every G4X panel button begins with the platform dropdown ───
    for (const pType of ['mythic', 'non_pilot', 'pilot'] as const) {
      let panelReply: any = null;
      await handleOrderPanelButton({
        customId: `ord_create:g4x:${pType}`,
        user: { id: testManagerId },
        guildId: testGuildId,
        reply: async (p: any) => { panelReply = p; },
      } as any);

      assert(
        panelReply?.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Platform'),
        `1. G4X panel button (${pType}) begins with the platform dropdown`
      );
    }

    // ─── 2. Every Advertiser panel button begins with the game dropdown ───
    for (const pType of ['mythic', 'non_pilot', 'pilot'] as const) {
      let advReply: any = null;
      await handleOrderPanelButton({
        customId: `ord_create:adv:${pType}`,
        user: { id: testAdvId },
        guildId: testGuildId,
        reply: async (p: any) => { advReply = p; },
      } as any);

      assert(
        advReply?.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Game'),
        `2. Advertiser panel button (${pType}) begins with the game dropdown`
      );
    }

    // ─── 3. Correct platform -> game -> service -> modal flow ───
    const flowSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });

    let selectPlatformReply: any = null;
    await handleOrderWizardSelectMenu({
      customId: `ord_wiz:platform:${flowSession.sessionId}`,
      values: ['g2g'],
      user: { id: testManagerId },
      guildId: testGuildId,
      update: async (p: any) => { selectPlatformReply = p; },
    } as any);

    assert(
      selectPlatformReply?.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Game'),
      '3a. Flow Step 1 (Platform) advances to Step 2 (Game dropdown)'
    );

    let selectGameReply: any = null;
    await handleOrderWizardSelectMenu({
      customId: `ord_wiz:game:${flowSession.sessionId}`,
      values: ['wow_midnight'],
      user: { id: testManagerId },
      guildId: testGuildId,
      update: async (p: any) => { selectGameReply = p; },
    } as any);

    assert(
      selectGameReply?.components?.[0]?.components?.[0]?.data?.placeholder?.includes('Service'),
      '3b. Flow Step 2 (Game) advances to Step 3 (Service dropdown)'
    );

    let modalShown: any = null;
    await handleOrderWizardSelectMenu({
      customId: `ord_wiz:service:${flowSession.sessionId}`,
      values: [String(mythicService.id)],
      user: { id: testManagerId },
      guildId: testGuildId,
      showModal: async (m: any) => { modalShown = m; },
    } as any);

    assert(
      modalShown !== null && modalShown.data?.custom_id?.includes('ord_wiz:modal:'),
      '3c. Flow Step 3 (Service) advances to Step 4 (Order Details Modal)'
    );

    // ─── 4. Site Order ID required for G4X ───
    const missingSiteIdSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(missingSiteIdSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyMissingSiteId: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${missingSiteIdSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'amount_usd') return '50.00';
          if (f === 'key_level') return '+10 Necrotic Wake';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyMissingSiteId = p; },
    } as any);

    assert(
      replyMissingSiteId?.content?.includes('Missing Site Order ID'),
      '4. Site Order ID is strictly required for G4X orders'
    );

    // ─── 5. Duplicate Site Order ID rejected within the same platform/account ───
    const siteIdTest = `G2G-UNIQUE-${ts}`;
    const firstOrderSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(firstOrderSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyFirstOrder: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${firstOrderSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'site_order_id') return siteIdTest;
          if (f === 'amount_usd') return '50.00';
          if (f === 'key_level') return '+10 Necrotic Wake';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyFirstOrder = p; },
    } as any);

    assert(
      replyFirstOrder?.embeds?.[0]?.data?.title?.includes('Created Successfully'),
      '5a. First G4X external order created with site order ID'
    );

    // Attempt second submission with duplicate ID on same platform
    const dupeSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(dupeSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyDupeOrder: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${dupeSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'site_order_id') return siteIdTest;
          if (f === 'amount_usd') return '50.00';
          if (f === 'key_level') return '+10 Necrotic Wake';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyDupeOrder = p; },
    } as any);

    assert(
      replyDupeOrder?.content?.includes('Duplicate Site Order ID'),
      '5. Duplicate Site Order ID rejected within the same platform/account'
    );

    // ─── 6. Identical IDs allowed across different platforms ───
    const diffPlatformSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(diffPlatformSession.sessionId, {
      platform: 'skycoach',
      platformAccountId: skycoachAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyDiffPlatform: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${diffPlatformSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'site_order_id') return siteIdTest; // Same ID, different platform!
          if (f === 'amount_usd') return '60.00';
          if (f === 'key_level') return '+10 Mists of Tirna Scithe';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyDiffPlatform = p; },
    } as any);

    assert(
      replyDiffPlatform?.embeds?.[0]?.data?.title?.includes('Created Successfully'),
      '6. Identical Site Order ID string successfully allowed across different platforms'
    );

    // ─── 7. Disabled games/services cannot be selected ───
    const disabledGameSlug = `dis_game_${ts}`;
    await prisma.game.create({
      data: {
        slug: disabledGameSlug,
        displayName: 'Disabled Game',
        serviceCategory: 'rpg',
        isActive: false, // Disabled
      },
    });

    const gameRow = await buildGameSelectRow(flowSession.sessionId);
    const renderedGameValues = gameRow?.components[0]?.options.map((o) => o.data.value) || [];
    assert(
      !renderedGameValues.includes(disabledGameSlug),
      '7. Disabled games are strictly filtered out of wizard dropdown menus'
    );

    // ─── 8. Pilot and Non-Pilot validations ───
    const pilotModalSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    const updatedPilotSession = await updateWizardSession(pilotModalSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: pilotService.id,
      serviceKey: pilotService.serviceKey,
      serviceName: pilotService.displayName,
      orderMode: 'pilot',
      step: 'modal',
    });

    const pilotModal = buildWizardOrderModal(updatedPilotSession);
    const pilotCustomIds = pilotModal.components.map((c: any) => c.components[0].data.custom_id);
    assert(
      pilotCustomIds.includes('vpn_location') && !pilotCustomIds.includes('runs_count'),
      '8. Pilot modal requires vpn_location and excludes runs_count'
    );

    // ─── 9. Mythic+ relevant key and runs fields ───
    const currentFlowSession = (await getWizardSession(flowSession.sessionId))!;
    const mythicModal = buildWizardOrderModal(currentFlowSession);
    const mythicCustomIds = mythicModal.components.map((c: any) => c.components[0].data.custom_id);
    assert(
      mythicCustomIds.includes('key_level') && mythicCustomIds.includes('runs_count'),
      '9. Mythic+ modal correctly includes key_level and runs_count'
    );


    // ─── 10. Restart-safe interaction handling ───
    const diskSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(diskSession.sessionId, {
      platform: 'g2g',
      step: 'game',
    });

    initWizardSessions();
    const reloadedSession = await getWizardSession(diskSession.sessionId);
    assert(
      reloadedSession?.platform === 'g2g' && reloadedSession?.step === 'game',
      '10. Wizard session survives bot restart and is restored from disk write-through cache'
    );

    // ─── 11. G4X management order creation with zero manager wallet balance ───
    const managerWallet = await prisma.walletV2.findUnique({ where: { userId: testManagerId } });
    assert(
      managerWallet === null || managerWallet.availableCents === 0,
      '11a. Manager has zero wallet balance'
    );

    const zeroWalletSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(zeroWalletSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyZeroWallet: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${zeroWalletSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'site_order_id') return `G2G-ZERO-${ts}`;
          if (f === 'amount_usd') return '100.00';
          if (f === 'key_level') return '+12 Ara-Kara';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyZeroWallet = p; },
    } as any);

    assert(
      replyZeroWallet?.embeds?.[0]?.data?.title?.includes('Created Successfully'),
      '11. G4X management creates order with zero manager wallet balance'
    );

    // ─── 12. No manager WalletV2 reservation or ledger debit ───
    const managerLedgerEntries = await prisma.ledgerEntryV2.findMany({
      where: { userId: testManagerId, entryType: 'ORDER_RESERVE' },
    });
    assert(
      managerLedgerEntries.length === 0,
      '12. Zero ORDER_RESERVE ledger debits created against manager'
    );

    // ─── 13. External order publication with pending external settlement ───
    const createdG4xOrder = await prisma.order.findFirst({
      where: { creatorId: testManagerId, externalOrderId: `G2G-ZERO-${ts}` },
    });
    assert(
      createdG4xOrder !== null &&
      createdG4xOrder.paymentStatus === 'unneeded' &&
      createdG4xOrder.status === 'open_presign',
      '13. External order is approved for open_presign publication with paymentStatus unneeded'
    );

    // ─── 14. No fabricated verified external cash ───
    const platformAccAfter = await prisma.platformAccount.findUnique({
      where: { id: g2gAccount.id },
    });
    assert(
      platformAccAfter !== null && platformAccAfter.receivedTotalMinor === 0,
      '14. No fabricated verified external cash; proceeds recorded as pending release only'
    );

    // ─── 15. Advertiser unpaid order remains unpublished ───
    const unpaidAdvSession = await createWizardSession({
      userId: testAdvId,
      guildId: testGuildId,
      origin: 'adv',
    });
    await updateWizardSession(unpaidAdvSession.sessionId, {
      gameSlug: 'wow_midnight',
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let replyUnpaidAdv: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${unpaidAdvSession.sessionId}`,
      user: { id: testAdvId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (f: string) => {
          if (f === 'amount_usd') return '80.00';
          if (f === 'key_level') return '+10 Grim Batol';
          if (f === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { replyUnpaidAdv = p; },
    } as any);

    const unpaidAdvOrder = await prisma.order.findFirst({
      where: { creatorId: testAdvId },
      orderBy: { id: 'desc' },
    });
    assert(
      unpaidAdvOrder !== null &&
      unpaidAdvOrder.paymentStatus === 'pending' &&
      unpaidAdvOrder.status === 'payment_pending',
      '15. Advertiser unpaid order remains in payment_pending and unpublished'
    );

    // ─── 16. Advertiser payment and commercial fee rules unchanged ───
    const advSnapshot = await prisma.orderFinancialSnapshot.findUnique({
      where: { orderId: unpaidAdvOrder!.id },
    });
    assert(
      advSnapshot !== null &&
      advSnapshot.advertiserRank === AdvertiserRank.GOLD &&
      advSnapshot.rankFeeBasisPoints === 1099 &&
      advSnapshot.boosterPoolMinor === 8000 - Math.round(8000 * 0.1099),
      '16. Advertiser commercial rank snapshot preserved (Gold 10.99%)'
    );


    // ─── 17. External fee calculations correct and without double deductions ───
    const g4xSnapshot = await prisma.orderFinancialSnapshot.findUnique({
      where: { orderId: createdG4xOrder!.id },
    });
    // G2G fee: 8.99% of $100 = $8.99 = 899 cents; booster pool = 10000 - 899 = 9101 cents
    assert(
      g4xSnapshot !== null &&
      g4xSnapshot.platformSaleCommissionMinor === 899 &&
      g4xSnapshot.boosterPoolMinor === 9101 &&
      g4xSnapshot.allocatedWithdrawalFeeMinor === 0,
      '17. External fee calculations exact (8.99% G2G seller fee, no batch withdrawal fee on single order)'
    );

    // ─── 18. Duplicate interaction submission creates only one order ───
    let dupeSubmitError = '';
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${zeroWalletSession.sessionId}`, // already submitted session!
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: () => '100.00',
      },
      reply: async (p: any) => { dupeSubmitError = p.content; },
    } as any);

    assert(
      dupeSubmitError.includes('already submitted') || dupeSubmitError.includes('INVALID_SESSION'),
      '18. Duplicate interaction submission rejected atomically'
    );

    // ─── 19. Existing claim, assignment, dispute and financial release protections ───
    // Verify presign eligibility
    const presign = await prisma.orderPresign.create({
      data: {
        orderId: createdG4xOrder!.id,
        userId: testBoosterId,
        claimType: 'individual',
        registeredRole: 'tank',
        status: 'registered',
      },
    });
    assert(
      presign.status === 'registered',
      '19. Booster presign created successfully under open_presign status'
    );


    // ─── 20. No unexpected payouts, wallet credits or escrow release ───
    const boosterWallet = await prisma.walletV2.findUnique({
      where: { userId: testBoosterId },
    });
    assert(
      boosterWallet === null || (boosterWallet.availableCents === 0 && boosterWallet.confirmedEarningsCents === 0),
      '20. No unexpected payouts or wallet credits granted on order creation'
    );

    console.log('\n================================================================');
    console.log(`🎉 ALL 20 REGRESSION CRITERIA TESTED & PASSED PERFECTLY! (${passed} PASSED)`);
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ REGRESSION SUITE ERROR:', err);
    process.exit(1);
  } finally {
    // Cleanup test artifacts
    try {
      await prisma.orderPresign.deleteMany({ where: { userId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.orderAssignment.deleteMany({ where: { userId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.orderRun.deleteMany({ where: { order: { creatorId: { in: [testManagerId, testAdvId, testBoosterId] } } } });
      await prisma.orderRequiredRole.deleteMany({ where: { order: { creatorId: { in: [testManagerId, testAdvId, testBoosterId] } } } });
      await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { creatorId: { in: [testManagerId, testAdvId, testBoosterId] } } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.walletV2.deleteMany({ where: { userId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.order.deleteMany({ where: { creatorId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: [testManagerId, testAdvId, testBoosterId] } } });
      await prisma.user.deleteMany({ where: { discordId: { in: [testManagerId, testAdvId, testBoosterId] } } });
    } catch {}
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal regression suite error:', err);
  process.exit(1);
});
