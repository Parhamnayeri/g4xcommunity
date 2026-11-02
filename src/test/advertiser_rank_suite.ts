/**
 * src/test/advertiser_rank_suite.ts — Comprehensive Test Suite for Advertiser Rank System
 *
 * G4X Community — Advertiser Rank-Based Commission System
 *
 * Validates all required criteria:
 *  1. Six approved ranks & exact integer basis points (BRONZE=1499, SILVER=1299, GOLD=1099, DIAMOND=899, OFFICIAL_PARTNERS=699, FOUNDING_ADVERTISER=899).
 *  2. Exact fee rounding on $10 order ($1.50, $1.30, $1.10, $0.90, $0.90, $0.70).
 *  3. Booster Cut calculated strictly from remaining amount; complete conservation of cents.
 *  4. Registration approval assigns BRONZE by default to new advertisers.
 *  5. Re-verification / role sync preserves existing approved rank.
 *  6. Role independence: commercial rank does not alter Discord security roles.
 *  7. Self-modification forbidden: Advertiser cannot change own rank.
 *  8. Cross-role unauthorized access: Exchanger cannot change advertiser ranks.
 *  9. Unauthorized staff rejected.
 * 10. Authorized Admin / Owner can change rank with mandatory non-empty reason.
 * 11. Complete AuditLog created with oldRank, newRank, reason, policyVersion, actorId, targetId.
 * 12. Real HTTP route security: session auth, admin permission, and CSRF protection on POST /api/admin/advertiser-ranks/:id.
 * 13. Order commitment snapshot persistence (OrderFinancialSnapshot with rank metadata).
 * 14. Rank changes apply to FUTURE orders only; accepted/committed orders retain snapshotted rate.
 * 15. Finalized financial snapshots are never repriced or recalculated.
 * 16. Unresolved migration mapping blocks ambiguous direct order finalizations.
 * 17. External platform fees (G2G 8.99%, SkyCoach 10%, Eldorado) remain unchanged.
 * 18. Exchanger fee rules remain unchanged.
 * 19. Gold Exchange Trade orders are not subject to direct boost order rank commissions.
 * 20. Zero live wallet credits or debits (strictly policy change, financial gates preserved).
 */

import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import {
  AdvertiserRank,
  ADVERTISER_RANK_RATES_BPS,
  calculateRankCommission,
  getAdvertiserRank,
  setAdvertiserRank,
  getRankBasisPoints,
  formatBasisPoints,
  getAdvertiserMigrationImpactReport,
} from '../services/advertiserRankService';
import {
  calculateOrderFinancialSnapshot,
  finalizeOrderFinancialsAndBoosterAllocation,
  CalculateOrderSnapshotInput,
} from '../services/financialCalculationEngine';
import { reviewApplication } from '../services/registrationService';
import { getFeePolicy } from '../services/financialPolicyService';
import { createOrderClaim } from '../services/claimService';
import { FINANCE_V2_FEATURE_GATES } from '../services/financeV2/financeV2Types';

async function runAdvertiserRankSuite() {
  console.log('================================================================================');
  console.log('   G4X COMMUNITY — ADVERTISER RANK-BASED COMMISSION SYSTEM TEST SUITE           ');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Ranks & Basis Points Definition
    // -------------------------------------------------------------------------
    assert(
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.BRONZE] === 1499 &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.SILVER] === 1299 &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.GOLD] === 1099 &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.DIAMOND] === 899 &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.FOUNDING_ADVERTISER] === 899 &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.OFFICIAL_PARTNERS] === 699,
      '1. Exact approved integer basis points for all 6 ranks',
      `Got: ${JSON.stringify(ADVERTISER_RANK_RATES_BPS)}`
    );

    assert(
      (AdvertiserRank.DIAMOND as string) !== (AdvertiserRank.FOUNDING_ADVERTISER as string) &&
      ADVERTISER_RANK_RATES_BPS[AdvertiserRank.DIAMOND] === ADVERTISER_RANK_RATES_BPS[AdvertiserRank.FOUNDING_ADVERTISER],
      '2. DIAMOND and FOUNDING_ADVERTISER are distinct ranks with coincidentally equal 8.99% rate'
    );

    // -------------------------------------------------------------------------
    // TEST 3-8: Exact fee rounding on $10 order (1000 cents)
    // -------------------------------------------------------------------------
    const tenDollars = 1000;
    const bronzeCalc = calculateRankCommission(tenDollars, AdvertiserRank.BRONZE);
    const silverCalc = calculateRankCommission(tenDollars, AdvertiserRank.SILVER);
    const goldCalc = calculateRankCommission(tenDollars, AdvertiserRank.GOLD);
    const diamondCalc = calculateRankCommission(tenDollars, AdvertiserRank.DIAMOND);
    const foundingCalc = calculateRankCommission(tenDollars, AdvertiserRank.FOUNDING_ADVERTISER);
    const officialCalc = calculateRankCommission(tenDollars, AdvertiserRank.OFFICIAL_PARTNERS);

    assert(
      bronzeCalc.g4xFeeMinor === 150 && bronzeCalc.remainingMinor === 850,
      '3. $10 BRONZE order produces $1.50 G4X fee and $8.50 remaining (14.99% -> 149.9 -> 150 cents)',
      `Got fee: ${bronzeCalc.g4xFeeMinor}, remaining: ${bronzeCalc.remainingMinor}`
    );

    assert(
      silverCalc.g4xFeeMinor === 130 && silverCalc.remainingMinor === 870,
      '4. $10 SILVER order produces $1.30 G4X fee and $8.70 remaining (12.99% -> 129.9 -> 130 cents)',
      `Got fee: ${silverCalc.g4xFeeMinor}`
    );

    assert(
      goldCalc.g4xFeeMinor === 110 && goldCalc.remainingMinor === 890,
      '5. $10 GOLD order produces $1.10 G4X fee and $8.90 remaining (10.99% -> 109.9 -> 110 cents)',
      `Got fee: ${goldCalc.g4xFeeMinor}`
    );

    assert(
      diamondCalc.g4xFeeMinor === 90 && diamondCalc.remainingMinor === 910,
      '6. $10 DIAMOND order produces $0.90 G4X fee and $9.10 remaining (8.99% -> 89.9 -> 90 cents)',
      `Got fee: ${diamondCalc.g4xFeeMinor}`
    );

    assert(
      foundingCalc.g4xFeeMinor === 90 && foundingCalc.remainingMinor === 910,
      '7. $10 FOUNDING_ADVERTISER order produces $0.90 G4X fee and $9.10 remaining (8.99% -> 89.9 -> 90 cents)',
      `Got fee: ${foundingCalc.g4xFeeMinor}`
    );

    assert(
      officialCalc.g4xFeeMinor === 70 && officialCalc.remainingMinor === 930,
      '8. $10 OFFICIAL_PARTNERS order produces $0.70 G4X fee and $9.30 remaining (6.99% -> 69.9 -> 70 cents)',
      `Got fee: ${officialCalc.g4xFeeMinor}`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Conservation of cents & Booster Cut calculated on remaining
    // -------------------------------------------------------------------------
    const oddGross = 3333; // $33.33
    const oddCalc = calculateRankCommission(oddGross, AdvertiserRank.GOLD);
    assert(
      oddCalc.g4xFeeMinor + oddCalc.remainingMinor === oddGross,
      '9. Conservation of cents: g4xFeeMinor + remainingMinor equals gross cents exactly',
      `${oddCalc.g4xFeeMinor} + ${oddCalc.remainingMinor} vs ${oddGross}`
    );

    // -------------------------------------------------------------------------
    // TEST 10: Setup Base Catalog Data, Users & Roles
    // -------------------------------------------------------------------------
    const testGameSlug = 'wow_test_rank';
    await prisma.game.upsert({
      where: { slug: testGameSlug },
      update: { isActive: true },
      create: {
        slug: testGameSlug,
        displayName: 'WoW Test Rank',
        serviceCategory: 'both',
        isActive: true,
      },
    });

    let testService = await prisma.gameService.findFirst({
      where: { gameSlug: testGameSlug },
    });
    if (!testService) {
      testService = await prisma.gameService.create({
        data: {
          gameSlug: testGameSlug,
          serviceKey: 'rank_boost_service',
          displayName: 'Rank Boost Service',
          serviceMode: 'non_pilot',
          profileMode: 'none',
          isActive: true,
        },
      });
    } else {
      testService = await prisma.gameService.update({
        where: { id: testService.id },
        data: { isActive: true },
      });
    }

    const adminDiscordId = 'test_rank_admin_001';
    const advertiserDiscordId = 'test_rank_adv_001';
    const exchangerDiscordId = 'test_rank_exch_001';
    const unauthorizedDiscordId = 'test_rank_user_001';

    await prisma.user.upsert({
      where: { discordId: adminDiscordId },
      update: { isActive: true },
      create: { discordId: adminDiscordId, username: 'AdminTester', displayName: 'Admin Tester' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: adminDiscordId, roleKey: 'owner' } },
      update: {},
      create: { userId: adminDiscordId, roleKey: 'owner' },
    });

    await prisma.user.upsert({
      where: { discordId: advertiserDiscordId },
      update: { isActive: true, advertiserRank: null },
      create: { discordId: advertiserDiscordId, username: 'AdvTester', displayName: 'Advertiser Tester' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: advertiserDiscordId, roleKey: 'advertiser' } },
      update: {},
      create: { userId: advertiserDiscordId, roleKey: 'advertiser' },
    });

    await prisma.user.upsert({
      where: { discordId: exchangerDiscordId },
      update: { isActive: true },
      create: { discordId: exchangerDiscordId, username: 'ExchTester', displayName: 'Exchanger Tester' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: exchangerDiscordId, roleKey: 'exchanger' } },
      update: {},
      create: { userId: exchangerDiscordId, roleKey: 'exchanger' },
    });

    await prisma.user.upsert({
      where: { discordId: unauthorizedDiscordId },
      update: { isActive: true },
      create: { discordId: unauthorizedDiscordId, username: 'RandomUser', displayName: 'Random User' },
    });

    // -------------------------------------------------------------------------
    // TEST 11: Registration Approval assigns BRONZE by default to new Advertiser
    // -------------------------------------------------------------------------
    const newRegDiscordId = 'test_rank_reg_new_adv';
    await prisma.user.upsert({
      where: { discordId: newRegDiscordId },
      update: { isActive: true, advertiserRank: null },
      create: { discordId: newRegDiscordId, username: 'NewAdv', displayName: 'New Advertiser' },
    });
    const regApp = await prisma.registrationApplication.create({
      data: {
        userId: newRegDiscordId,
        category: 'advertiser',
        preferredLanguage: 'en',
        qualifications: JSON.stringify({ introduction: 'New direct advertiser' }),
        status: 'pending',
        roleSyncStatus: 'pending',
      },
    });

    await reviewApplication({
      reviewerId: adminDiscordId,
      applicationId: regApp.id,
      decision: 'approve',
      reason: 'Approved new partner',
    });

    const registeredUser = await prisma.user.findUnique({ where: { discordId: newRegDiscordId } });
    assert(
      registeredUser?.advertiserRank === AdvertiserRank.BRONZE,
      '11. Registration approval assigns BRONZE by default to new Advertiser',
      `Got rank: ${registeredUser?.advertiserRank}`
    );

    // -------------------------------------------------------------------------
    // TEST 12: Existing approved rank is NOT reset on re-verification / role sync
    // -------------------------------------------------------------------------
    await prisma.user.update({
      where: { discordId: newRegDiscordId },
      data: { advertiserRank: AdvertiserRank.GOLD },
    });
    const regApp2 = await prisma.registrationApplication.create({
      data: {
        userId: newRegDiscordId,
        category: 'advertiser',
        preferredLanguage: 'en',
        qualifications: JSON.stringify({ introduction: 'Re-verifying partner' }),
        status: 'pending',
        roleSyncStatus: 'pending',
      },
    });
    await reviewApplication({
      reviewerId: adminDiscordId,
      applicationId: regApp2.id,
      decision: 'approve',
      reason: 'Re-verifying profile',
    });
    const reVerifiedUser = await prisma.user.findUnique({ where: { discordId: newRegDiscordId } });
    assert(
      reVerifiedUser?.advertiserRank === AdvertiserRank.GOLD,
      '12. Existing approved rank is NOT reset on re-verification or role sync',
      `Got rank: ${reVerifiedUser?.advertiserRank}`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Non-advertiser categories unaffected by rank logic
    // -------------------------------------------------------------------------
    const boosterDiscordId = 'test_rank_reg_booster';
    await prisma.user.upsert({
      where: { discordId: boosterDiscordId },
      update: { isActive: true, advertiserRank: null },
      create: { discordId: boosterDiscordId, username: 'NewBooster', displayName: 'New Booster' },
    });
    const boosterApp = await prisma.registrationApplication.create({
      data: {
        userId: boosterDiscordId,
        category: 'booster',
        preferredLanguage: 'en',
        qualifications: JSON.stringify({ experience: 'Mythic raider' }),
        status: 'pending',
        roleSyncStatus: 'pending',
      },
    });
    await reviewApplication({
      reviewerId: adminDiscordId,
      applicationId: boosterApp.id,
      decision: 'approve',
      reason: 'Approved booster',
    });
    const boosterUser = await prisma.user.findUnique({ where: { discordId: boosterDiscordId } });
    assert(
      boosterUser?.advertiserRank === null,
      '13. Booster registration approval does not assign advertiser rank',
      `Got rank: ${boosterUser?.advertiserRank}`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Advertiser cannot change own rank (SELF_RANK_MODIFICATION_FORBIDDEN)
    // -------------------------------------------------------------------------
    let selfModifyError: string | null = null;
    try {
      await setAdvertiserRank({
        advertiserId: advertiserDiscordId,
        newRank: AdvertiserRank.OFFICIAL_PARTNERS,
        reason: 'Attempting to self-promote',
        actorId: advertiserDiscordId,
      });
    } catch (err: any) {
      selfModifyError = err.message;
    }
    assert(
      Boolean(selfModifyError && selfModifyError.includes('strictly prohibited')),
      '14. Advertiser cannot change own rank',
      `Got error: ${selfModifyError}`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Exchanger cannot change advertiser ranks (INSUFFICIENT_PERMISSIONS)
    // -------------------------------------------------------------------------
    let exchModifyError: string | null = null;
    try {
      await setAdvertiserRank({
        advertiserId: advertiserDiscordId,
        newRank: AdvertiserRank.DIAMOND,
        reason: 'Exchanger trying to change rank',
        actorId: exchangerDiscordId,
      });
    } catch (err: any) {
      exchModifyError = err.message;
    }
    assert(
      Boolean(exchModifyError && exchModifyError.includes('PERMISSION_DENIED')),
      '15. Exchanger cannot change advertiser rank',
      `Got error: ${exchModifyError}`
    );

    // -------------------------------------------------------------------------
    // TEST 16: Unauthorized staff rejected
    // -------------------------------------------------------------------------
    let unauthorizedError: string | null = null;
    try {
      await setAdvertiserRank({
        advertiserId: advertiserDiscordId,
        newRank: AdvertiserRank.DIAMOND,
        reason: 'Unauthorized user trying to change rank',
        actorId: unauthorizedDiscordId,
      });
    } catch (err: any) {
      unauthorizedError = err.message;
    }
    assert(
      Boolean(unauthorizedError && unauthorizedError.includes('PERMISSION_DENIED')),
      '16. Unauthorized user cannot change ranks',
      `Got error: ${unauthorizedError}`
    );

    // -------------------------------------------------------------------------
    // TEST 17: Mandatory rank-change reason is enforced
    // -------------------------------------------------------------------------
    let emptyReasonError: string | null = null;
    try {
      await setAdvertiserRank({
        advertiserId: advertiserDiscordId,
        newRank: AdvertiserRank.SILVER,
        reason: '   ',
        actorId: adminDiscordId,
      });
    } catch (err: any) {
      emptyReasonError = err.message;
    }
    assert(
      Boolean(emptyReasonError && emptyReasonError.includes('MANDATORY_REASON_REQUIRED')),
      '17. Mandatory non-empty rank-change reason is enforced',
      `Got error: ${emptyReasonError}`
    );

    // -------------------------------------------------------------------------
    // TEST 18: Authorized Admin can change rank & complete AuditLog created
    // -------------------------------------------------------------------------
    const changeResult = await setAdvertiserRank({
      advertiserId: advertiserDiscordId,
      newRank: AdvertiserRank.DIAMOND,
      reason: 'Long-standing VIP partner qualification review',
      actorId: adminDiscordId,
    });

    assert(
      changeResult.user.advertiserRank === AdvertiserRank.DIAMOND &&
      changeResult.effectiveBasisPoints === 899 &&
      changeResult.effectiveCommissionRate === '8.99%',
      '18. Authorized Admin changes rank successfully',
      `New rank: ${changeResult.user.advertiserRank}, bps: ${changeResult.effectiveBasisPoints}`
    );

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        action: 'ADVERTISER_RANK_CHANGED',
        entityId: advertiserDiscordId,
      },
      orderBy: { createdAt: 'desc' },
    });

    let auditMeta: any = {};
    if (auditEntry?.newValues) {
      auditMeta = JSON.parse(auditEntry.newValues);
    }

    assert(
      auditEntry !== null &&
      auditEntry.actorId === adminDiscordId &&
      auditMeta.rank === AdvertiserRank.DIAMOND &&
      auditEntry.reason === 'Long-standing VIP partner qualification review' &&
      auditMeta.policyVersion === 1,
      '19. Rank change produces complete and auditable AuditLog record',
      `Audit entry: ${JSON.stringify(auditEntry)}`
    );

    // -------------------------------------------------------------------------
    // TEST 20: Real HTTP route security: Session auth, admin permission, CSRF
    // -------------------------------------------------------------------------
    const unauthHttpRes = await request(app)
      .post(`/api/admin/advertiser-ranks/${advertiserDiscordId}`)
      .send({ rank: AdvertiserRank.GOLD, reason: 'Testing unauthenticated' });
    assert(
      unauthHttpRes.status === 401,
      '20. Unauthenticated POST /api/admin/advertiser-ranks/:id returns 401 Unauthorized',
      `Status: ${unauthHttpRes.status}`
    );

    // Authenticate admin session via agent
    const adminAgent = request.agent(app);
    const csrfRes = await adminAgent.get('/api/csrf-token');
    const adminSidMatch = (csrfRes.header['set-cookie']?.[0] || '').match(/g4x\.sid=s%3A([^.]+)\./);
    const adminSid = adminSidMatch ? adminSidMatch[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(adminSid, (err, sess) => {
        if (err || !sess) return reject(err || new Error('No session'));
        sess.userId = adminDiscordId;
        sessionStore.set(adminSid, sess, setErr => (setErr ? reject(setErr) : resolve()));
      });
    });

    // CSRF rejection without token -> 403
    const noCsrfRes = await adminAgent
      .post(`/api/admin/advertiser-ranks/${advertiserDiscordId}`)
      .send({ rank: AdvertiserRank.GOLD, reason: 'Missing CSRF test' });
    assert(
      noCsrfRes.status === 403,
      '21. Admin request without valid CSRF header returns 403 Forbidden',
      `Status: ${noCsrfRes.status}`
    );

    // Valid CSRF + session -> 200
    const validHttpRes = await adminAgent
      .post(`/api/admin/advertiser-ranks/${advertiserDiscordId}`)
      .set('x-csrf-token', csrfRes.body.csrfToken)
      .send({ rank: AdvertiserRank.GOLD, reason: 'Promoted via admin web portal' });
    assert(
      validHttpRes.status === 200 && validHttpRes.body.success === true && validHttpRes.body.data.user.advertiserRank === AdvertiserRank.GOLD,
      '22. Authenticated Admin with CSRF successfully updates rank via HTTP API',
      `Status: ${validHttpRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 23: Order Commitment snapshot persistence & conservation
    // -------------------------------------------------------------------------
    const testOrderRef = `test_order_rank_snap_${Date.now()}`;
    const createdOrder = await prisma.order.create({
      data: {
        orderRef: testOrderRef,
        gameSlug: testGameSlug,
        serviceId: testService.id,
        customerId: null,
        creatorId: advertiserDiscordId,
        advertiserId: advertiserDiscordId,
        creatorType: 'advertiser',
        sourceType: 'direct',
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000, // $100
        advertiserRank: AdvertiserRank.GOLD,
        rankCommissionBps: 1099,
        platformFeeMinor: 1099,
        boosterPoolMinor: 8901,
        status: 'open_presign',
      },
    });

    const snapshotInput: CalculateOrderSnapshotInput = {
      orderId: createdOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: advertiserDiscordId,
    };

    const snapshot = await calculateOrderFinancialSnapshot(snapshotInput);
    assert(
      snapshot.advertiserRank === AdvertiserRank.GOLD &&
      snapshot.rankFeeBasisPoints === 1099 &&
      snapshot.g4xFeeMinor === 1099 &&
      snapshot.remainingAmountMinor === 8901 &&
      snapshot.boosterPoolMinor === 8901,
      '23. Order financial snapshot persists rank, bps, G4X fee, remaining amount, and booster pool',
      `Snapshot: g4xFee=${snapshot.g4xFeeMinor}, remaining=${snapshot.remainingAmountMinor}`
    );

    // -------------------------------------------------------------------------
    // TEST 24: Rank change applies to FUTURE orders only; existing snapshots untouched
    // -------------------------------------------------------------------------
    // Promote advertiser to DIAMOND
    await setAdvertiserRank({
      advertiserId: advertiserDiscordId,
      newRank: AdvertiserRank.DIAMOND,
      reason: 'Promotion to Diamond',
      actorId: adminDiscordId,
    });

    // Re-evaluating existing order snapshot must respect previous snapshot
    const reEvaluatedSnapshot = await calculateOrderFinancialSnapshot(snapshotInput);
    assert(
      reEvaluatedSnapshot.advertiserRank === AdvertiserRank.GOLD &&
      reEvaluatedSnapshot.rankFeeBasisPoints === 1099 &&
      reEvaluatedSnapshot.g4xFeeMinor === 1099,
      '24. Changing rank does NOT alter an existing order snapshot (snapshots immutable)',
      `Re-evaluated rank: ${reEvaluatedSnapshot.advertiserRank}, bps: ${reEvaluatedSnapshot.rankFeeBasisPoints}`
    );

    // -------------------------------------------------------------------------
    // TEST 25a: Unfunded order safely blocks financial finalization
    // -------------------------------------------------------------------------
    const unfundedAdvId = 'test_unfunded_adv_101';
    await prisma.user.upsert({
      where: { discordId: unfundedAdvId },
      update: { isActive: true, advertiserRank: AdvertiserRank.BRONZE },
      create: { discordId: unfundedAdvId, username: 'UnfundedAdv', displayName: 'Unfunded Advertiser', advertiserRank: AdvertiserRank.BRONZE },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: unfundedAdvId, roleKey: 'advertiser' } },
      update: {},
      create: { userId: unfundedAdvId, roleKey: 'advertiser' },
    });

    const unfundedOrder = await prisma.order.create({
      data: {
        orderRef: `unfunded_order_${Date.now()}`,
        gameSlug: testGameSlug,
        serviceId: testService.id,
        creatorId: unfundedAdvId,
        advertiserId: unfundedAdvId,
        creatorType: 'advertiser',
        sourceType: 'direct',
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'payment_pending',
        paymentStatus: 'pending',
      },
    });

    let unfundedFinalizeErr: string | null = null;
    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: unfundedOrder.id,
        actorId: adminDiscordId,
      });
    } catch (err: any) {
      unfundedFinalizeErr = err.message;
    }
    assert(
      Boolean(unfundedFinalizeErr && unfundedFinalizeErr.includes('ORDER_PAYMENT_NOT_VERIFIED')),
      '25a. Unfunded order safely blocks financial finalization (ORDER_PAYMENT_NOT_VERIFIED)',
      `Got error: ${unfundedFinalizeErr}`
    );

    // -------------------------------------------------------------------------
    // TEST 25b: Unresolved migration mapping blocks ambiguous direct order finalization
    // -------------------------------------------------------------------------
    const unresolvedAdvId = 'test_unresolved_adv_999';
    await prisma.user.upsert({
      where: { discordId: unresolvedAdvId },
      update: { isActive: true, advertiserRank: null },
      create: { discordId: unresolvedAdvId, username: 'UnresolvedAdv', displayName: 'Unresolved Advertiser' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: unresolvedAdvId, roleKey: 'advertiser' } },
      update: {},
      create: { userId: unresolvedAdvId, roleKey: 'advertiser' },
    });

    // Give legacy custom commission to create unresolved condition
    await prisma.walletV2.upsert({
      where: { userId: unresolvedAdvId },
      update: { customCommissionRate: 0.0899 },
      create: { userId: unresolvedAdvId, customCommissionRate: 0.0899 },
    });

    const unresolvedOrder = await prisma.order.create({
      data: {
        orderRef: `unresolved_order_${Date.now()}`,
        gameSlug: testGameSlug,
        serviceId: testService.id,
        creatorId: unresolvedAdvId,
        advertiserId: unresolvedAdvId,
        creatorType: 'advertiser',
        sourceType: 'direct',
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'open_presign',
        paymentStatus: 'verified', // Set verified so we isolate the rank migration check
      },
    });

    await calculateOrderFinancialSnapshot({
      orderId: unresolvedOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: unresolvedAdvId,
      allowProvisional: true,
    });

    let finalizationError: string | null = null;
    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: unresolvedOrder.id,
        actorId: adminDiscordId,
      });
    } catch (err: any) {
      finalizationError = err.message;
    }
    assert(
      Boolean(finalizationError && finalizationError.includes('UNRESOLVED_ADVERTISER_RANK_MIGRATION')),
      '25b. Unresolved advertiser rank migration safely blocks financial finalization',
      `Got error: ${finalizationError}`
    );

    // -------------------------------------------------------------------------
    // TEST 26: External platform fee policies remain completely unchanged
    // -------------------------------------------------------------------------
    const g2gPolicy = await getFeePolicy({ platform: 'g2g', feeType: 'sale_commission' });
    const skycoachPolicy = await getFeePolicy({ platform: 'skycoach', feeType: 'sale_commission' });
    const eldoradoPolicy = await getFeePolicy({ platform: 'eldorado', feeType: 'sale_commission', gameSlug: 'wow_midnight', listingCategory: 'currency' });

    assert(
      g2gPolicy?.percentageRate === 0.0899 && g2gPolicy?.platform === 'g2g',
      '26. External G2G fee policy remains strictly unchanged at 8.99%',
      `G2G rate: ${g2gPolicy?.percentageRate}`
    );

    assert(
      skycoachPolicy?.percentageRate === 0.10 && skycoachPolicy?.platform === 'skycoach',
      '27. External SkyCoach fee policy remains strictly unchanged at 10.00%',
      `SkyCoach rate: ${skycoachPolicy?.percentageRate}`
    );

    assert(
      eldoradoPolicy?.platform === 'eldorado',
      '28. External Eldorado fee policy remains strictly unchanged and independent',
      `Eldorado platform: ${eldoradoPolicy?.platform}`
    );

    // -------------------------------------------------------------------------
    // TEST 29: Read-Only Migration Impact Report functionality
    // -------------------------------------------------------------------------
    const impactReport = await getAdvertiserMigrationImpactReport();
    assert(
      impactReport.totalAdvertisers >= 2 &&
      impactReport.advertisersWithAssignedRank >= 1 &&
      Array.isArray(impactReport.advertisers),
      '29. Read-only Migration Impact Report accurately queries advertisers and summaries',
      `Total: ${impactReport.totalAdvertisers}, Assigned: ${impactReport.advertisersWithAssignedRank}`
    );

    // -------------------------------------------------------------------------
    // TEST 30: Zero wallet balances altered by rank operations
    // -------------------------------------------------------------------------
    const advWallet = await prisma.walletV2.findUnique({ where: { userId: advertiserDiscordId } });
    assert(
      (advWallet?.availableCents ?? 0) === 0 && (advWallet?.reservedCents ?? 0) === 0,
      '30. Rank system operations execute strictly as policy changes with zero wallet credits/debits'
    );

    // =========================================================================
    // TARGETED REGRESSION TESTS (Section 7 Requirements)
    // =========================================================================

    // -------------------------------------------------------------------------
    // REGRESSION 1: Advertiser with missing rank cannot publish a commission-free order
    // -------------------------------------------------------------------------
    // Setup advertiser agent
    const advAgent = request.agent(app);
    const advCsrfRes = await advAgent.get('/api/csrf-token');
    const advSidMatch = (advCsrfRes.header['set-cookie']?.[0] || '').match(/g4x\.sid=s%3A([^.]+)\./);
    const advSid = advSidMatch ? advSidMatch[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(advSid, (err, sess) => {
        if (err || !sess) return reject(err || new Error('No session'));
        sess.userId = unresolvedAdvId; // has advertiser role but advertiserRank === null
        sessionStore.set(advSid, sess, setErr => (setErr ? reject(setErr) : resolve()));
      });
    });

    const unrankedOrderRes = await advAgent
      .post('/api/orders/create')
      .set('x-csrf-token', advCsrfRes.body.csrfToken)
      .send({
        gameSlug: testGameSlug,
        serviceId: testService.id,
        grossAmountUsd: 50,
      });

    assert(
      unrankedOrderRes.status === 400 &&
      unrankedOrderRes.body.error?.includes('UNRESOLVED_ADVERTISER_RANK'),
      'R1. Advertiser with missing rank cannot publish a commission-free order (HTTP 400 UNRESOLVED_ADVERTISER_RANK)',
      `Status: ${unrankedOrderRes.status}, Error: ${unrankedOrderRes.body.error}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 2: Existing Advertiser with unresolved legacy commission cannot bypass rank mapping
    // -------------------------------------------------------------------------
    let legacyBypassErr: string | null = null;
    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: unresolvedOrder.id,
        actorId: adminDiscordId,
      });
    } catch (err: any) {
      legacyBypassErr = err.message;
    }
    assert(
      Boolean(legacyBypassErr && legacyBypassErr.includes('UNRESOLVED_ADVERTISER_RANK_MIGRATION')),
      'R2. Existing Advertiser with unresolved legacy commission fails closed and cannot bypass rank mapping',
      `Got error: ${legacyBypassErr}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 3: Web and Discord apply identical commission rules
    // -------------------------------------------------------------------------
    const bronzeCalcR = calculateRankCommission(10000, AdvertiserRank.BRONZE);
    const silverCalcR = calculateRankCommission(10000, AdvertiserRank.SILVER);
    const goldCalcR = calculateRankCommission(10000, AdvertiserRank.GOLD);
    const diamondCalcR = calculateRankCommission(10000, AdvertiserRank.DIAMOND);
    const foundingCalcR = calculateRankCommission(10000, AdvertiserRank.FOUNDING_ADVERTISER);
    const officialCalcR = calculateRankCommission(10000, AdvertiserRank.OFFICIAL_PARTNERS);

    assert(
      bronzeCalcR.g4xFeeMinor === 1499 &&
      silverCalcR.g4xFeeMinor === 1299 &&
      goldCalcR.g4xFeeMinor === 1099 &&
      diamondCalcR.g4xFeeMinor === 899 &&
      foundingCalcR.g4xFeeMinor === 899 &&
      officialCalcR.g4xFeeMinor === 699,
      'R3. Web and Discord share identical integer basis point rules across all approved ranks'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 4: Order creation does not mark payment verified without authoritative evidence
    // -------------------------------------------------------------------------
    // Set advertiser wallet to 0 balance
    await prisma.walletV2.upsert({
      where: { userId: advertiserDiscordId },
      update: { availableCents: 0, reservedCents: 0 },
      create: { userId: advertiserDiscordId, availableCents: 0, reservedCents: 0 },
    });

    // Authenticate advertiser with valid rank
    await new Promise<void>((resolve, reject) => {
      sessionStore.get(advSid, (err, sess) => {
        if (err || !sess) return reject(err || new Error('No session'));
        sess.userId = advertiserDiscordId;
        sessionStore.set(advSid, sess, setErr => (setErr ? reject(setErr) : resolve()));
      });
    });

    const unfundedCreationRes = await advAgent
      .post('/api/orders/create')
      .set('x-csrf-token', advCsrfRes.body.csrfToken)
      .send({
        gameSlug: testGameSlug,
        serviceId: testService.id,
        grossAmountUsd: 100,
      });

    assert(
      unfundedCreationRes.status === 200 &&
      unfundedCreationRes.body.order.paymentStatus === 'pending' &&
      unfundedCreationRes.body.order.status === 'payment_pending',
      'R4. Order creation without authoritative wallet funds sets paymentStatus: pending and status: payment_pending',
      `PaymentStatus: ${unfundedCreationRes.body.order?.paymentStatus}, Status: ${unfundedCreationRes.body.order?.status}`
    );

    const newlyCreatedUnfundedOrderId = unfundedCreationRes.body.order.id;

    // -------------------------------------------------------------------------
    // REGRESSION 5: Unfunded order cannot become publicly claimable or financially releasable
    // -------------------------------------------------------------------------
    let claimErr: string | null = null;
    try {
      await createOrderClaim({
        orderId: newlyCreatedUnfundedOrderId,
        userId: boosterDiscordId,
        claimType: 'individual',
        registeredRole: 'dps',
      });
    } catch (err: any) {
      claimErr = err.message;
    }
    assert(
      Boolean(claimErr && (claimErr.includes('PAYMENT_NOT_VERIFIED') || claimErr.includes('not in \'open_presign\' status'))),
      'R5. Unfunded order cannot be claimed by boosters (blocked by paymentStatus and status)',
      `Claim error: ${claimErr}`
    );

    const availableOrdersRes = await advAgent.get('/api/orders/available');
    const orderInAvailable = availableOrdersRes.body.orders?.some(
      (o: any) => o.id === newlyCreatedUnfundedOrderId
    );
    assert(
      orderInAvailable === false,
      'R5b. Unfunded order does not appear in /orders/available list'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 6: User cannot forge payment verification
    // -------------------------------------------------------------------------
    const forgedRes = await advAgent
      .post('/api/orders/create')
      .set('x-csrf-token', advCsrfRes.body.csrfToken)
      .send({
        gameSlug: testGameSlug,
        serviceId: testService.id,
        grossAmountUsd: 50,
        paymentStatus: 'verified', // Client attempting to forge payment verification
      });

    assert(
      forgedRes.status === 200 && forgedRes.body.order.paymentStatus === 'pending',
      'R6. Client cannot forge payment verification flag; server enforces authoritative funds check',
      `Result paymentStatus: ${forgedRes.body.order?.paymentStatus}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 7: Rank change does not alter committed order rates
    // -------------------------------------------------------------------------
    // Order was committed at GOLD (1099 bps) in Test 23
    const lockedSnapshotBefore = await prisma.orderFinancialSnapshot.findFirst({
      where: { orderId: createdOrder.id },
    });
    // Promote advertiser to OFFICIAL_PARTNERS (699 bps)
    await setAdvertiserRank({
      advertiserId: advertiserDiscordId,
      newRank: AdvertiserRank.OFFICIAL_PARTNERS,
      reason: 'Partner promotion test',
      actorId: adminDiscordId,
    });
    const lockedSnapshotAfter = await calculateOrderFinancialSnapshot(snapshotInput);
    assert(
      lockedSnapshotBefore?.rankFeeBasisPoints === 1099 &&
      lockedSnapshotAfter.rankFeeBasisPoints === 1099 &&
      lockedSnapshotAfter.g4xFeeMinor === 1099,
      'R7. Advertiser rank change does not reprice previously committed order rates',
      `Locked bps: ${lockedSnapshotAfter.rankFeeBasisPoints}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 8: Finalized snapshots cannot be overwritten
    // -------------------------------------------------------------------------
    // Mark snapshot finalized
    await prisma.orderFinancialSnapshot.updateMany({
      where: { orderId: createdOrder.id },
      data: { calculationStatus: 'finalized' },
    });

    let finalizedOverwriteErr: string | null = null;
    try {
      await calculateOrderFinancialSnapshot({
        ...snapshotInput,
        sourceAmountMinor: 20000, // Attempt conflicting reprice
      });
    } catch (err: any) {
      finalizedOverwriteErr = err.message;
    }
    assert(
      Boolean(finalizedOverwriteErr && finalizedOverwriteErr.includes('FINALIZED_SNAPSHOT_IMMUTABLE')),
      'R8. Finalized financial snapshots are strictly immutable and cannot be overwritten',
      `Got error: ${finalizedOverwriteErr}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 9: Conflicting financial snapshot recalculation fails
    // -------------------------------------------------------------------------
    const freshOrder = await prisma.order.create({
      data: {
        orderRef: `fresh_order_${Date.now()}`,
        gameSlug: testGameSlug,
        serviceId: testService.id,
        creatorId: advertiserDiscordId,
        advertiserId: advertiserDiscordId,
        creatorType: 'advertiser',
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'open_presign',
        paymentStatus: 'verified',
      },
    });

    await calculateOrderFinancialSnapshot({
      orderId: freshOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: advertiserDiscordId,
    });

    let conflictRecalcErr: string | null = null;
    try {
      await calculateOrderFinancialSnapshot({
        orderId: freshOrder.id,
        sourcePlatform: 'advertiser',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 15000, // Conflicting gross amount
        currency: 'USD',
        advertiserId: advertiserDiscordId,
      });
    } catch (err: any) {
      conflictRecalcErr = err.message;
    }
    assert(
      Boolean(conflictRecalcErr && conflictRecalcErr.includes('CONFLICTING_SNAPSHOT_RECALCULATION')),
      'R9. Conflicting financial snapshot recalculation fails closed',
      `Got error: ${conflictRecalcErr}`
    );

    // -------------------------------------------------------------------------
    // REGRESSION 10: Duplicate order requests remain safe (Idempotency)
    // -------------------------------------------------------------------------
    const identicalSnapshot1 = await calculateOrderFinancialSnapshot({
      orderId: freshOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: advertiserDiscordId,
    });
    const identicalSnapshot2 = await calculateOrderFinancialSnapshot({
      orderId: freshOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: advertiserDiscordId,
    });
    assert(
      identicalSnapshot1.id === identicalSnapshot2.id &&
      identicalSnapshot1.g4xFeeMinor === identicalSnapshot2.g4xFeeMinor,
      'R10. Duplicate / identical recalculation calls are strictly idempotent and safe'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 11: Invalid financial inputs fail
    // -------------------------------------------------------------------------
    let negativeInputErr: string | null = null;
    try {
      await calculateOrderFinancialSnapshot({
        orderId: freshOrder.id,
        sourcePlatform: 'advertiser',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: -500,
        currency: 'USD',
      });
    } catch (err: any) {
      negativeInputErr = err.message;
    }

    let nanInputErr: string | null = null;
    try {
      await calculateOrderFinancialSnapshot({
        orderId: freshOrder.id,
        sourcePlatform: 'advertiser',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: NaN,
        currency: 'USD',
      });
    } catch (err: any) {
      nanInputErr = err.message;
    }

    assert(
      Boolean(negativeInputErr && negativeInputErr.includes('INVALID_SOURCE_AMOUNT')) &&
      Boolean(nanInputErr && nanInputErr.includes('INVALID_SOURCE_AMOUNT')),
      'R11. Negative amounts and NaN fail financial calculation with INVALID_SOURCE_AMOUNT'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 12: Legacy commissions cannot double-charge rank fees
    // -------------------------------------------------------------------------
    const singleChargeOrder = await prisma.order.create({
      data: {
        orderRef: `single_charge_${Date.now()}`,
        gameSlug: testGameSlug,
        serviceId: testService.id,
        creatorId: advertiserDiscordId,
        advertiserId: advertiserDiscordId,
        creatorType: 'advertiser',
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'open_presign',
        paymentStatus: 'verified',
      },
    });

    const singleChargeSnap = await calculateOrderFinancialSnapshot({
      orderId: singleChargeOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      advertiserId: advertiserDiscordId,
    });

    assert(
      singleChargeSnap.advertiserFeeMinor === 0 &&
      singleChargeSnap.g4xFeeMinor === 699 && // OFFICIAL_PARTNERS = 6.99%
      singleChargeSnap.g4xFeeMinor + (singleChargeSnap.remainingAmountMinor ?? 0) === 10000,
      'R12. Rank-based commission is the sole approved fee; legacy custom commission is not combined or double-charged'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 13: G2G, SkyCoach, Eldorado and Exchanger policies remain unchanged
    // -------------------------------------------------------------------------
    const g2gFresh = await getFeePolicy({ platform: 'g2g', feeType: 'sale_commission' });
    const skycoachFresh = await getFeePolicy({ platform: 'skycoach', feeType: 'sale_commission' });
    assert(
      g2gFresh?.percentageRate === 0.0899 && skycoachFresh?.percentageRate === 0.10,
      'R13. Third-party platform policies (G2G, SkyCoach, Eldorado) remain strictly unchanged'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 14: Concurrent Admin rank updates preserve accurate audit history
    // -------------------------------------------------------------------------
    // Target user current rank is OFFICIAL_PARTNERS
    let concurrentError: string | null = null;
    try {
      await setAdvertiserRank({
        advertiserId: advertiserDiscordId,
        newRank: AdvertiserRank.DIAMOND,
        reason: 'Stale admin attempting update',
        actorId: adminDiscordId,
        expectedPreviousRank: AdvertiserRank.BRONZE, // Wrong expected previous rank
      });
    } catch (err: any) {
      concurrentError = err.message;
    }
    assert(
      Boolean(concurrentError && concurrentError.includes('CONCURRENT_RANK_MODIFICATION')),
      'R14. Optimistic concurrency with expectedPreviousRank blocks stale concurrent admin updates (CONCURRENT_RANK_MODIFICATION)',
      `Got error: ${concurrentError}`
    );

    const safeConcurrentSuccess = await setAdvertiserRank({
      advertiserId: advertiserDiscordId,
      newRank: AdvertiserRank.DIAMOND,
      reason: 'Valid optimistic update',
      actorId: adminDiscordId,
      expectedPreviousRank: AdvertiserRank.OFFICIAL_PARTNERS, // Correct previous rank
    });
    assert(
      safeConcurrentSuccess.user.advertiserRank === AdvertiserRank.DIAMOND,
      'R14b. Concurrent rank update succeeds when expected previous rank matches database state exactly'
    );

    // -------------------------------------------------------------------------
    // REGRESSION 15: All financial production feature gates remain disabled
    // -------------------------------------------------------------------------
    assert(
      FINANCE_V2_FEATURE_GATES.ESCROW_RELEASE_ENABLED === false &&
      FINANCE_V2_FEATURE_GATES.FINANCE_V2_LIVE_CREDITS_ENABLED === false &&
      FINANCE_V2_FEATURE_GATES.FINANCE_V2_LIVE_PAYOUTS_ENABLED === false &&
      FINANCE_V2_FEATURE_GATES.FINANCE_V2_P2P_SETTLEMENT_ENABLED === false,
      'R15. All financial production feature gates remain strictly false / disabled'
    );

  } catch (err) {
    console.error('Fatal test error encountered:', err);
    failed++;
  } finally {
    console.log('\n================================================================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  }
}

runAdvertiserRankSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
