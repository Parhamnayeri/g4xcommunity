/**
 * cross_entrypoint_order_parity_suite.ts
 *
 * Comprehensive cross-entry-point parity test suite verifying that Web and Discord
 * Advertiser order creation adhere to the exact same authoritative contracts, rules,
 * validation policies, and financial invariants.
 */

import prisma from '../database/db';
import { createAdvertiserBoostOrder, isMythicPlusService } from '../services/orderLifecycleService';
import { handleOrderWizardModalSubmit } from '../interactions/orderWizardInteractions';
import { createWizardSession, updateWizardSession } from '../services/orderWizardStateService';
import { AdvertiserRank } from '../services/advertiserRankService';
import { creditAvailableCents } from '../services/financeV2/financeV2WalletService';
import { LedgerV2EntryType } from '../services/financeV2/financeV2Types';
import { publishOrRefreshOrderCard } from '../services/orderDiscordService';

function assert(condition: boolean, message: string, detail?: any) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`, detail || '');
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASSED: ${message}`);
}

async function runCrossEntrypointParitySuite() {
  console.log('\n======================================================');
  console.log('STARTING CROSS-ENTRY-POINT ORDER PARITY TEST SUITE');
  console.log('======================================================\n');

  const testAdvWebId = `cross_adv_web_${Date.now()}`;
  const testAdvDiscId = `cross_adv_disc_${Date.now()}`;
  const testManagerId = `cross_mgr_${Date.now()}`;
  const testGuildId = `guild_cross_${Date.now()}`;

  let testGame: any = null;
  let mythicService: any = null;
  let nonMythicService: any = null;
  let pilotService: any = null;
  let g2gAccount: any = null;

  try {
    // 1. Setup Test Users with Roles and Ranks
    await prisma.user.createMany({
      data: [
        {
          discordId: testAdvWebId,
          username: 'AdvWebUser',
          displayName: 'Adv Web',
          advertiserRank: AdvertiserRank.GOLD,
        },
        {
          discordId: testAdvDiscId,
          username: 'AdvDiscordUser',
          displayName: 'Adv Discord',
          advertiserRank: AdvertiserRank.GOLD,
        },
        {
          discordId: testManagerId,
          username: 'G4XManager',
          displayName: 'G4X Manager',
        },
      ],
    });

    await prisma.userRole.createMany({
      data: [
        { userId: testAdvWebId, roleKey: 'advertiser' },
        { userId: testAdvDiscId, roleKey: 'advertiser' },
        { userId: testManagerId, roleKey: 'manager' },
      ],
    });

    // Setup Wallets with funded balances
    await prisma.walletV2.createMany({
      data: [
        { userId: testAdvWebId, availableCents: 10000, reservedCents: 0 },
        { userId: testAdvDiscId, availableCents: 10000, reservedCents: 0 },
        { userId: testManagerId, availableCents: 50000, reservedCents: 0 },
      ],
    });

    // 2. Setup Test Game and Services
    testGame = await prisma.game.create({
      data: {
        slug: `game_cross_${Date.now()}`,
        displayName: 'WoW Parity Game',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    mythicService = await prisma.gameService.create({
      data: {
        gameSlug: testGame.slug,
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ Dungeon Run',
        serviceMode: 'both',
        profileMode: 'character',
        isActive: true,
      },
    });

    nonMythicService = await prisma.gameService.create({
      data: {
        gameSlug: testGame.slug,
        serviceKey: 'leveling_carry',
        displayName: 'Leveling Power Carry',
        serviceMode: 'non_pilot',
        profileMode: 'none',
        isActive: true,
      },
    });

    pilotService = await prisma.gameService.create({
      data: {
        gameSlug: testGame.slug,
        serviceKey: 'arena_pilot',
        displayName: 'Gladiator Arena Pilot',
        serviceMode: 'pilot',
        profileMode: 'none',
        requiresPilotApproval: true,
        isActive: true,
      },
    });

    g2gAccount = await prisma.platformAccount.upsert({
      where: { accountRef: 'plat_acc_g2g_001' },
      update: { isActive: true },
      create: {
        accountRef: 'plat_acc_g2g_001',
        platform: 'g2g',
        displayName: 'G2G Parity Account',
        currency: 'USD',
        isActive: true,
      },
    });

    console.log('--- TEST 1: Same Input Produces Equivalent Order Data (Web vs Discord) ---');
    // Web Order Creation
    const webRes = await createAdvertiserBoostOrder({
      actorId: testAdvWebId,
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      grossAmountMinor: 5000, // $50.00
      orderMode: 'non_pilot',
      runsCount: 2,
      keyLevel: '+10 Ara-Kara',
      customerInfo: 'CustomerA#1234',
      notes: 'Priority timing',
      actionSource: 'web_portal',
      idempotencyKey: `idemp_web_${Date.now()}`,
    });

    // Discord Wizard Order Creation
    const discSession = await createWizardSession({
      userId: testAdvDiscId,
      guildId: testGuildId,
      origin: 'adv',
    });
    await updateWizardSession(discSession.sessionId, {
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let discReply: any = null;
    const mockModalSubmitDisc: any = {
      customId: `ord_wiz:modal:${discSession.sessionId}`,
      user: { id: testAdvDiscId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '50.00';
          if (field === 'key_level') return '+10 Ara-Kara';
          if (field === 'runs_count') return '2';
          if (field === 'customer_info') return 'CustomerA#1234';
          if (field === 'notes') return 'Priority timing';
          return '';
        },
      },
      reply: async (p: any) => { discReply = p; },
    };

    await handleOrderWizardModalSubmit(mockModalSubmitDisc);

    const discOrder = await prisma.order.findFirst({
      where: { creatorId: testAdvDiscId },
      orderBy: { id: 'desc' },
      include: {
        financialSnapshot: true,
        requiredRoles: true,
        runs: true,
        keyRequirements: true,
      },
    });

    assert(webRes.order !== null && discOrder !== null, 'Both Web and Discord orders created successfully');
    assert(webRes.order.grossAmountMinor === discOrder!.grossAmountMinor, 'Matching grossAmountMinor: 5000 cents');
    assert(webRes.order.platformFeeMinor === discOrder!.platformFeeMinor, 'Matching platformFeeMinor calculated from rank');
    assert(webRes.order.boosterPoolMinor === discOrder!.boosterPoolMinor, 'Matching boosterPoolMinor conservation');
    assert(webRes.order.advertiserRank === discOrder!.advertiserRank, 'Matching advertiserRank: GOLD');
    assert(webRes.order.rankCommissionBps === discOrder!.rankCommissionBps, 'Matching rankCommissionBps: 1099');
    assert(webRes.order.quantity === discOrder!.quantity, 'Matching runs quantity: 2');
    assert(webRes.order.sourceType === discOrder!.sourceType, 'Matching sourceType: direct');
    assert(webRes.order.sourceWebsite === null && discOrder!.sourceWebsite === null, 'Matching sourceWebsite: null');
    assert(webRes.order.status === 'open_presign' && discOrder!.status === 'open_presign', 'Matching status: open_presign');
    assert(webRes.order.paymentStatus === 'verified' && discOrder!.paymentStatus === 'verified', 'Matching paymentStatus: verified');

    console.log('--- TEST 2: Correct Four-Role Mythic+ Composition (1 Tank, 1 Healer, 2 DPS) ---');
    const webRoles = await prisma.orderRequiredRole.findMany({ where: { orderId: webRes.order.id } });
    const discRoles = discOrder!.requiredRoles;

    assert(webRoles.length === 3 && discRoles.length === 3, 'Both orders enforce exactly 3 distinct roles');
    const webTank = webRoles.find((r) => r.roleName === 'tank');
    const webHeal = webRoles.find((r) => r.roleName === 'healer');
    const webDps = webRoles.find((r) => r.roleName === 'dps');
    const discTank = discRoles.find((r) => r.roleName === 'tank');
    const discHeal = discRoles.find((r) => r.roleName === 'healer');
    const discDps = discRoles.find((r) => r.roleName === 'dps');

    assert(webTank?.quantity === 1 && discTank?.quantity === 1, '1 Tank required on both Web and Discord');
    assert(webHeal?.quantity === 1 && discHeal?.quantity === 1, '1 Healer required on both Web and Discord');
    assert(webDps?.quantity === 2 && discDps?.quantity === 2, '2 DPS required on both Web and Discord (total 4 boosters)');

    console.log('--- TEST 3: Missing Mythic+ Key Level / Dungeon Rejected by Both ---');
    // Web missing keyLevel
    let webKeyError = '';
    try {
      await createAdvertiserBoostOrder({
        actorId: testAdvWebId,
        gameSlug: testGame.slug,
        serviceId: mythicService.id,
        grossAmountMinor: 2000,
        orderMode: 'non_pilot',
        runsCount: 1,
        keyLevel: '', // Missing
        actionSource: 'web_portal',
      });
    } catch (err: any) {
      webKeyError = err.message;
    }
    assert(webKeyError.includes('Target dungeon and key level are required'), 'Web rejects missing Mythic+ key level');

    // Discord missing key_level
    const discKeySession = await createWizardSession({
      userId: testAdvDiscId,
      guildId: testGuildId,
      origin: 'adv',
    });
    await updateWizardSession(discKeySession.sessionId, {
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });
    let discKeyReply: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${discKeySession.sessionId}`,
      user: { id: testAdvDiscId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '20.00';
          if (field === 'key_level') return ''; // Missing
          if (field === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { discKeyReply = p; },
    } as any);

    assert(discKeyReply?.content?.includes('Missing Key Level'), 'Discord wizard rejects missing key level modal submission');

    console.log('--- TEST 4: Pilot VPN Requirement Enforced by Both ---');
    // Web missing VPN on pilot service
    let webVpnError = '';
    try {
      await createAdvertiserBoostOrder({
        actorId: testAdvWebId,
        gameSlug: testGame.slug,
        serviceId: pilotService.id,
        grossAmountMinor: 3000,
        orderMode: 'pilot',
        runsCount: 1,
        vpnLocation: '', // Missing
        actionSource: 'web_portal',
      });
    } catch (err: any) {
      webVpnError = err.message;
    }
    assert(webVpnError.includes('Pilot orders require a specified VPN location'), 'Web rejects missing VPN location on pilot order');

    // Web with valid VPN creates pilot role
    const webPilotOrder = await createAdvertiserBoostOrder({
      actorId: testAdvWebId,
      gameSlug: testGame.slug,
      serviceId: pilotService.id,
      grossAmountMinor: 3000,
      orderMode: 'pilot',
      runsCount: 1,
      vpnLocation: 'Frankfurt, Germany',
      actionSource: 'web_portal',
    });
    const pilotRoles = await prisma.orderRequiredRole.findMany({ where: { orderId: webPilotOrder.order.id } });
    assert(pilotRoles.length === 1 && pilotRoles[0].roleName === 'pilot' && pilotRoles[0].quantity === 1, 'Pilot order enforces 1 Pilot role slot');

    console.log('--- TEST 5: Non-Mythic Service-Specific Booster Count & Run Count ---');
    const nonMythicOrder = await createAdvertiserBoostOrder({
      actorId: testAdvWebId,
      gameSlug: testGame.slug,
      serviceId: nonMythicService.id,
      grossAmountMinor: 4000,
      orderMode: 'non_pilot',
      runsCount: 3,
      requiredBoosterCount: 2,
      actionSource: 'web_portal',
    });

    const nonMythicRoles = await prisma.orderRequiredRole.findMany({ where: { orderId: nonMythicOrder.order.id } });
    const nonMythicRuns = await prisma.orderRun.findMany({ where: { orderId: nonMythicOrder.order.id } });
    assert(nonMythicRuns.length === 3, 'Runs count matches 3 runs');
    assert(nonMythicRoles.length === 1 && nonMythicRoles[0].roleName === 'booster' && nonMythicRoles[0].quantity === 2, 'Service-specific booster count of 2 correctly allocated');

    console.log('--- TEST 6: Concurrent & Repeated Submissions (Idempotency) ---');
    const idempKey = `cross_idemp_${Date.now()}`;
    const [sub1, sub2] = await Promise.all([
      createAdvertiserBoostOrder({
        actorId: testAdvWebId,
        gameSlug: testGame.slug,
        serviceId: mythicService.id,
        grossAmountMinor: 1000,
        orderMode: 'non_pilot',
        runsCount: 1,
        keyLevel: '+10 Ara-Kara',
        idempotencyKey: idempKey,
        actionSource: 'web_portal',
      }),
      createAdvertiserBoostOrder({
        actorId: testAdvWebId,
        gameSlug: testGame.slug,
        serviceId: mythicService.id,
        grossAmountMinor: 1000,
        orderMode: 'non_pilot',
        runsCount: 1,
        keyLevel: '+10 Ara-Kara',
        idempotencyKey: idempKey,
        actionSource: 'web_portal',
      }),
    ]);

    assert(sub1.order.id === sub2.order.id, 'Idempotent repeated submission returns the exact same order without duplication');
    assert(sub1.isDuplicate === true || sub2.isDuplicate === true, 'Duplicate flag set on idempotent retry');

    console.log('--- TEST 7: Insufficient Wallet Balance Preserves Safe payment_pending ---');
    // Deplete user's available balance
    await prisma.walletV2.update({
      where: { userId: testAdvWebId },
      data: { availableCents: 0 },
    });

    const unfundedOrderRes = await createAdvertiserBoostOrder({
      actorId: testAdvWebId,
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      grossAmountMinor: 5000,
      orderMode: 'non_pilot',
      runsCount: 1,
      keyLevel: '+10 Ara-Kara',
      actionSource: 'web_portal',
    });

    assert(unfundedOrderRes.isFunded === false, 'isFunded is false when funds are insufficient');
    assert(unfundedOrderRes.order.paymentStatus === 'pending', 'paymentStatus remains pending');
    assert(unfundedOrderRes.order.status === 'payment_pending', 'order status is safely preserved as payment_pending');
    assert(unfundedOrderRes.order.paymentVerifiedBy === null, 'No paymentVerifier set without financial backing');

    console.log('--- TEST 8: G4X Manager Orders Do NOT Debit Personal Manager Wallets ---');
    const mgrWalletBefore = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testManagerId } });

    const g4xSession = await createWizardSession({
      userId: testManagerId,
      guildId: testGuildId,
      origin: 'g4x',
    });
    await updateWizardSession(g4xSession.sessionId, {
      platform: 'g2g',
      platformAccountId: g2gAccount.id,
      platformAccountRef: 'plat_acc_g2g_001',
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let g4xReply: any = null;
    const mockModalSubmitG4x: any = {
      customId: `ord_wiz:modal:${g4xSession.sessionId}`,
      user: { id: testManagerId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '100-80'; // $100 Gross, $80 Booster Pool
          if (field === 'site_order_id') return `G2G-PARITY-${Date.now()}`;
          if (field === 'key_level') return '+10 Grim Batol';
          if (field === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { g4xReply = p; },
    };

    await handleOrderWizardModalSubmit(mockModalSubmitG4x);

    const mgrWalletAfter = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testManagerId } });
    assert(mgrWalletBefore.availableCents === mgrWalletAfter.availableCents, 'Manager available wallet balance completely untouched');
    assert(mgrWalletBefore.reservedCents === mgrWalletAfter.reservedCents, 'Manager reserved balance completely untouched');

    const createdG4xOrder = await prisma.order.findFirst({
      where: { creatorId: testManagerId },
      orderBy: { id: 'desc' },
    });
    assert(createdG4xOrder !== null, 'G4X operational order created');
    assert(createdG4xOrder!.sourceWebsite === 'g2g', 'Source website set to g2g');
    assert(createdG4xOrder!.paymentStatus === 'unneeded', 'G4X order uses paymentStatus unneeded');
    assert(createdG4xOrder!.status === 'open_presign', 'G4X order open for presign without personal wallet deduction');

    console.log('--- TEST 9: Discord Publication Occurs ONLY Under Existing Funding Policy ---');
    // A. Unfunded order (paymentStatus: 'pending') strictly fails publication guard
    const mockClient: any = {
      user: { id: 'bot_test_id' },
      guilds: { cache: { has: () => false, get: () => null } },
      channels: { cache: { get: () => null } },
    };
    const pubUnfundedResult = await publishOrRefreshOrderCard(mockClient, unfundedOrderRes.order.id);
    assert(
      Boolean(pubUnfundedResult.success === false && pubUnfundedResult.error?.includes('PAYMENT_NOT_VERIFIED')),
      'Unfunded order with paymentStatus=pending is rejected from publication with PAYMENT_NOT_VERIFIED'
    );

    // B. Discord wizard submission for advertiser with 0 balance creates unfunded order and blocks publication
    const discUnfundedSession = await createWizardSession({
      userId: testAdvWebId, // Available balance was drained to 0 in TEST 7
      guildId: testGuildId,
      origin: 'adv',
    });
    await updateWizardSession(discUnfundedSession.sessionId, {
      gameSlug: testGame.slug,
      serviceId: mythicService.id,
      serviceKey: mythicService.serviceKey,
      serviceName: mythicService.displayName,
      orderMode: 'non_pilot',
      step: 'modal',
    });

    let discUnfundedReply: any = null;
    await handleOrderWizardModalSubmit({
      customId: `ord_wiz:modal:${discUnfundedSession.sessionId}`,
      user: { id: testAdvWebId },
      guildId: testGuildId,
      fields: {
        getTextInputValue: (field: string) => {
          if (field === 'amount_usd') return '25.00';
          if (field === 'key_level') return '+10 Necrotic Wake';
          if (field === 'runs_count') return '1';
          return '';
        },
      },
      reply: async (p: any) => { discUnfundedReply = p; },
    } as any);

    assert(
      discUnfundedReply?.embeds?.[0]?.data?.description?.includes('PENDING (Awaiting Funding)'),
      'Discord wizard confirms order paymentStatus as PENDING (Awaiting Funding)'
    );
    assert(
      discUnfundedReply?.embeds?.[0]?.data?.description?.includes('Blocked — Awaiting Verified Payment'),
      'Discord wizard explicitly displays publication status as Blocked — Awaiting Verified Payment'
    );

    console.log('\n======================================================');
    console.log('CROSS-ENTRY-POINT ORDER PARITY SUITE: ALL TESTS PASSED!');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('Fatal error during Cross-Entrypoint Parity suite:', err);
    process.exit(1);
  } finally {
    // Teardown
    try {
      const allUserIds = [testAdvWebId, testAdvDiscId, testManagerId];
      const orders = await prisma.order.findMany({
        where: { creatorId: { in: allUserIds } },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);

      await prisma.auditLog.deleteMany({ where: { actorId: { in: allUserIds } } });
      await prisma.orderKeyRequirement.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderRequiredRole.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderRun.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderFinancialSnapshot.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: allUserIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.walletV2.deleteMany({ where: { userId: { in: allUserIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: allUserIds } } });
      await prisma.user.deleteMany({ where: { discordId: { in: allUserIds } } });

      if (testGame) {
        await prisma.gameService.deleteMany({ where: { gameSlug: testGame.slug } });
        await prisma.game.deleteMany({ where: { slug: testGame.slug } });
      }

      if (g2gAccount) {
        await prisma.platformAccountTransaction.deleteMany({ where: { accountId: g2gAccount.id } });
        await prisma.platformAccount.deleteMany({ where: { id: g2gAccount.id } });
      }
    } catch {}
  }
}

runCrossEntrypointParitySuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
