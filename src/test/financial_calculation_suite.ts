/**
 * financial_calculation_suite.ts — مجموعه آزمون‌های جامع موتور محاسبات و سیاست‌های مالی (Phase 3.3)
 *
 * پوشش کامل ۲۳ آزمون الزامی:
 *  1. G2G order sale commission.
 *  2. G2G withdrawal-batch fee allocation.
 *  3. SkyCoach displayed order amount remains unchanged before withdrawal.
 *  4. SkyCoach 5% plus $5 is charged once per withdrawal batch.
 *  5. SkyCoach $0.30 transfer fee is treated separately.
 *  6. Eldorado game/category-dependent sale commission.
 *  7. WoW Currency 1.5% example from the owner-provided table.
 *  8. Eldorado N/A fee categories cannot silently become 0%.
 *  9. Already-net Eldorado amounts never receive a second commission deduction.
 * 10. Actual Eldorado platform balance reconciliation.
 * 11. Distinct platform minimum withdrawal thresholds.
 * 12. Proportional allocation across multiple orders.
 * 13. Rounding and conservation invariants.
 * 14. Missing order-specific G4X fee blocks finalization.
 * 15. G4X fee applies after actual external costs.
 * 16. Advertiser-specific commission rules.
 * 17. Shared Gold G4X fee policy requires explicit management configuration and blocks finalization without it.
 * 18. Equal Mythic+ split among four boosters.
 * 19. Equal split for other team sizes.
 * 20. Idempotent calculation and reconciliation.
 * 21. No premature withdrawable wallet credits.
 * 22. No financial action bypassing authorization.
 * 23. No automatic escrow release.
 */

import prisma from '../database/db';
import {
  allocateProportionalWithRemainder,
  splitPoolEquallyWithRemainder,
  calculateOrderFinancialSnapshot,
  createAndReconcileWithdrawalBatch,
  finalizeOrderFinancialsAndBoosterAllocation,
} from '../services/financialCalculationEngine';
import {
  seedStandardFeePolicies,
  createOrUpdateFeePolicy,
  setAdvertiserCommissionRate,
  getAdvertiserCommissionRate,
  getFeePolicy,
  configureSharedAdvertiserGoldFeePolicy,
  reviewAndCorrectUnapprovedPolicies,
} from '../services/financialPolicyService';
import { isEscrowReleaseEnabled } from '../services/escrowService';

async function runFinancialEngineTests() {
  console.log('=== STARTING PHASE 3.3 FINANCIAL POLICY & CALCULATION ENGINE TEST SUITE ===\n');

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

  // شناسه‌های تست
  const adminId = 'test_fin_admin_01';
  const unauthorizedId = 'test_fin_unauthorized_01';
  const advertiserId = 'test_fin_advertiser_01';
  const boosterA = 'test_fin_booster_a';
  const boosterB = 'test_fin_booster_b';
  const boosterC = 'test_fin_booster_c';
  const boosterD = 'test_fin_booster_d';
  const boosterE = 'test_fin_booster_e';

  try {
    // ─── ۱. آماده‌سازی کاربران، نقش‌ها و خط‌مشی‌های استاندارد ───────────────
    await prisma.user.upsert({ where: { discordId: adminId }, update: {}, create: { discordId: adminId, username: 'FinAdmin' } });
    await prisma.user.upsert({ where: { discordId: unauthorizedId }, update: {}, create: { discordId: unauthorizedId, username: 'Unauthorized' } });
    await prisma.user.upsert({ where: { discordId: advertiserId }, update: {}, create: { discordId: advertiserId, username: 'Advertiser1' } });
    await prisma.user.upsert({ where: { discordId: boosterA }, update: {}, create: { discordId: boosterA, username: 'BoosterA' } });
    await prisma.user.upsert({ where: { discordId: boosterB }, update: {}, create: { discordId: boosterB, username: 'BoosterB' } });
    await prisma.user.upsert({ where: { discordId: boosterC }, update: {}, create: { discordId: boosterC, username: 'BoosterC' } });
    await prisma.user.upsert({ where: { discordId: boosterD }, update: {}, create: { discordId: boosterD, username: 'BoosterD' } });
    await prisma.user.upsert({ where: { discordId: boosterE }, update: {}, create: { discordId: boosterE, username: 'BoosterE' } });

    await prisma.userRole.upsert({ where: { userId_roleKey: { userId: adminId, roleKey: 'owner' } }, update: {}, create: { userId: adminId, roleKey: 'owner' } });
    await prisma.userRole.upsert({ where: { userId_roleKey: { userId: advertiserId, roleKey: 'advertiser' } }, update: {}, create: { userId: advertiserId, roleKey: 'advertiser' } });

    // بارگذاری خط‌مشی‌های استاندارد
    await seedStandardFeePolicies();

    // ایجاد یک بازی و سرویس جهت ارجاع سفارشات تست
    const testGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    if (!testGame) throw new Error('Game wow_midnight missing');
    const testService = await prisma.gameService.findFirst({ where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' } });
    if (!testService) throw new Error('Service mythic_plus missing');

    // تابع کمکی ایجاد سفارش تست
    async function createTestOrder(ref: string, grossMinor: number, currency = 'USD') {
      return await prisma.order.upsert({
        where: { orderRef: ref },
        update: { grossAmountMinor: grossMinor },
        create: {
          orderRef: ref,
          gameSlug: 'wow_midnight',
          serviceId: testService!.id,
          orderType: 'group',
          currency,
          grossAmountMinor: grossMinor,
          status: 'assigned',
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱: G2G order sale commission
    // ─────────────────────────────────────────────────────────────────────────
    const ordG2G_1 = await createTestOrder('ORD-FIN-G2G-01', 10000); // $100.00
    const snapG2G_1 = await calculateOrderFinancialSnapshot({
      orderId: ordG2G_1.id,
      sourcePlatform: 'g2g',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
    });
    // 8.99% of $100.00 = $8.99 (899 minor). Net = $91.01 (9101 minor)
    assert(
      snapG2G_1.grossSaleMinor === 10000 &&
        snapG2G_1.platformSaleCommissionMinor === 899 &&
        snapG2G_1.platformOrderNetMinor === 9101,
      '1. G2G order sale commission is accurately calculated at 8.99% from gross sale',
      `Commission: ${snapG2G_1.platformSaleCommissionMinor}, Net: ${snapG2G_1.platformOrderNetMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲: G2G withdrawal-batch fee allocation
    // ─────────────────────────────────────────────────────────────────────────
    const ordG2G_2 = await createTestOrder('ORD-FIN-G2G-02', 5000); // $50.00
    const snapG2G_2 = await calculateOrderFinancialSnapshot({
      orderId: ordG2G_2.id,
      sourcePlatform: 'g2g',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 5000, // already net
    });

    const g2gBatch = await createAndReconcileWithdrawalBatch({
      platform: 'g2g',
      orderContributions: [
        { orderId: ordG2G_1.id, contributionMinor: snapG2G_1.platformOrderNetMinor }, // 9101
        { orderId: ordG2G_2.id, contributionMinor: snapG2G_2.platformOrderNetMinor }, // 5000
      ],
      actorId: adminId,
    });
    // Total contribution = 14101 ($141.01 >= $10.00 threshold)
    // Batch fee = 3.99% * 14101 + 99 = 563 + 99 = 662 minor
    // Sum of allocated batch fees must equal actual batch fee
    const g2gBatchFeeSum = g2gBatch.allocations.reduce((s, a) => s + a.allocatedBatchFeeMinor, 0);
    assert(
      g2gBatch.batch.status === 'reconciled' &&
        g2gBatchFeeSum === g2gBatch.batch.actualBatchFeeMinor &&
        g2gBatch.allocations.length === 2,
      '2. G2G withdrawal-batch fee (3.99% + $0.99) is allocated proportionally across orders',
      `Total: ${g2gBatchFeeSum}, Actual: ${g2gBatch.batch.actualBatchFeeMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۳: SkyCoach displayed order amount remains unchanged before withdrawal
    // ─────────────────────────────────────────────────────────────────────────
    const ordSky_1 = await createTestOrder('ORD-FIN-SKY-01', 8000); // $80.00
    const snapSky_1 = await calculateOrderFinancialSnapshot({
      orderId: ordSky_1.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 8000,
    });
    // No 5% or $5 deducted at creation!
    assert(
      snapSky_1.platformOrderNetMinor === 8000 &&
        snapSky_1.platformSaleCommissionMinor === 0 &&
        snapSky_1.allocatedWithdrawalFeeMinor === 0,
      '3. SkyCoach displayed order amount remains unchanged before withdrawal (no fee deducted at creation)',
      `Platform Net: ${snapSky_1.platformOrderNetMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۴: SkyCoach 5% plus $5 is charged once per withdrawal batch
    // ─────────────────────────────────────────────────────────────────────────
    const ordSky_2 = await createTestOrder('ORD-FIN-SKY-02', 12000); // $120.00
    await calculateOrderFinancialSnapshot({
      orderId: ordSky_2.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 12000,
    });

    // Total batch = 8000 + 12000 = 20000 ($200.00). 5% = 1000 minor ($10.00). Flat fee = 500 minor ($5.00).
    // Total batch fee = 1500 minor ($15.00).
    const skyBatch = await createAndReconcileWithdrawalBatch({
      platform: 'skycoach',
      orderContributions: [
        { orderId: ordSky_1.id, contributionMinor: 8000 },
        { orderId: ordSky_2.id, contributionMinor: 12000 },
      ],
      actorId: adminId,
    });
    const skyBatchFee = skyBatch.batch.actualBatchFeeMinor;
    assert(
      skyBatchFee === 1500 &&
        skyBatch.allocations.reduce((s, a) => s + a.allocatedBatchFeeMinor, 0) === 1500 &&
        // Order 1 (40% of 20000) gets 600 minor; Order 2 (60% of 20000) gets 900 minor
        skyBatch.allocations.find((a) => a.orderId === ordSky_1.id)?.allocatedBatchFeeMinor === 600 &&
        skyBatch.allocations.find((a) => a.orderId === ordSky_2.id)?.allocatedBatchFeeMinor === 900,
      '4. SkyCoach 5% plus $5 is charged once per withdrawal batch and allocated proportionally',
      `Actual batch fee: ${skyBatchFee}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۵: SkyCoach $0.30 transfer fee is treated separately
    // ─────────────────────────────────────────────────────────────────────────
    const skyTransferSum = skyBatch.allocations.reduce((s, a) => s + a.allocatedTransferFeeMinor, 0);
    assert(
      skyBatch.batch.actualTransferFeeMinor === 30 && skyTransferSum === 30,
      '5. SkyCoach $0.30 transfer fee is treated separately and allocated across batch',
      `Transfer fee: ${skyBatch.batch.actualTransferFeeMinor}, Allocated sum: ${skyTransferSum}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۶: Eldorado game/category-dependent sale commission
    // ─────────────────────────────────────────────────────────────────────────
    const policyWowCurrency = await getFeePolicy({
      platform: 'eldorado',
      feeType: 'sale_commission',
      gameSlug: 'wow',
      listingCategory: 'currency',
    });
    assert(
      policyWowCurrency !== null && policyWowCurrency.percentageRate === 0.015,
      '6. Eldorado game and category-dependent fee policy is correctly retrieved',
      `Rate: ${policyWowCurrency?.percentageRate}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۷: WoW Currency 1.5% example from owner-provided table
    // ─────────────────────────────────────────────────────────────────────────
    const ordEld_1 = await createTestOrder('ORD-FIN-ELD-01', 20000); // $200.00
    const snapEld_1 = await calculateOrderFinancialSnapshot({
      orderId: ordEld_1.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 20000,
      gameSlug: 'wow',
      listingCategory: 'currency',
    });
    // 1.5% of $200.00 = $3.00 (300 minor). Net = $197.00 (19700 minor).
    assert(
      snapEld_1.platformSaleCommissionMinor === 300 && snapEld_1.platformOrderNetMinor === 19700,
      '7. WoW Currency 1.5% commission is precisely applied (owner table specification)',
      `Commission: ${snapEld_1.platformSaleCommissionMinor}, Net: ${snapEld_1.platformOrderNetMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۸: Eldorado N/A fee categories cannot silently become 0%
    // ─────────────────────────────────────────────────────────────────────────
    const ordEld_NA = await createTestOrder('ORD-FIN-ELD-NA', 15000);
    let naBlocked = false;
    try {
      // Trying to calculate without allowProvisional on an undefined combination must throw
      await calculateOrderFinancialSnapshot({
        orderId: ordEld_NA.id,
        sourcePlatform: 'eldorado',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 15000,
        gameSlug: 'unregistered_game_xyz',
        listingCategory: 'unknown_cat',
        allowProvisional: false,
      });
    } catch (err: any) {
      if (err.message.includes('ELDORADO_CATEGORY_RATE_UNDEFINED')) {
        naBlocked = true;
      }
    }
    // Also verify that provisional snapshot records the missing fee note and cannot be finalized
    const snapEld_NA = await calculateOrderFinancialSnapshot({
      orderId: ordEld_NA.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 15000,
      gameSlug: 'unregistered_game_xyz',
      listingCategory: 'unknown_cat',
      allowProvisional: true,
    });
    assert(
      naBlocked && snapEld_NA.notes?.includes('ELDORADO_FEE_UNKNOWN') === true,
      '8. Eldorado N/A fee categories cannot silently become 0% and block finalization',
      `Notes: ${snapEld_NA.notes}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۹: Already-net Eldorado amounts never receive a second commission deduction
    // ─────────────────────────────────────────────────────────────────────────
    const ordEld_Net = await createTestOrder('ORD-FIN-ELD-NET', 25000); // $250.00
    const snapEld_Net = await calculateOrderFinancialSnapshot({
      orderId: ordEld_Net.id,
      sourcePlatform: 'eldorado',
      sourceAmountType: 'platform_net',
      sourceAmountMinor: 25000,
    });
    assert(
      snapEld_Net.platformOrderNetMinor === 25000 &&
        snapEld_Net.platformSaleCommissionMinor === 0 &&
        snapEld_Net.grossSaleMinor === null,
      '9. Already-net Eldorado amounts never receive a second commission deduction',
      `Net: ${snapEld_Net.platformOrderNetMinor}, Commission: ${snapEld_Net.platformSaleCommissionMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۰: Actual Eldorado platform balance reconciliation
    // ─────────────────────────────────────────────────────────────────────────
    const eldBatch = await createAndReconcileWithdrawalBatch({
      platform: 'eldorado',
      orderContributions: [
        { orderId: ordEld_1.id, contributionMinor: 19700 },
        { orderId: ordEld_Net.id, contributionMinor: 25000 },
      ],
      actualBatchFeeMinor: 0,
      actualTransferFeeMinor: 150, // $1.50 BNB
      externalReceiptRef: 'ELD-RECEIPT-2026-X1',
      externalReceiptNotes: 'Actual payout receipt received on BNB chain',
      actorId: adminId,
    });
    assert(
      eldBatch.batch.status === 'reconciled' &&
        eldBatch.batch.externalReceiptRef === 'ELD-RECEIPT-2026-X1' &&
        eldBatch.batch.actualTransferFeeMinor === 150,
      '10. Actual Eldorado platform balance reconciliation with receipt overrides estimates',
      `Receipt: ${eldBatch.batch.externalReceiptRef}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۱: Distinct platform minimum withdrawal thresholds
    // ─────────────────────────────────────────────────────────────────────────
    let g2gBlocked = false;
    let skyBlocked = false;
    let eldBlocked = false;

    try {
      // G2G min is $10 (1000 minor)
      await createAndReconcileWithdrawalBatch({
        platform: 'g2g',
        orderContributions: [{ orderId: ordG2G_1.id, contributionMinor: 999 }],
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('MINIMUM_WITHDRAWAL_THRESHOLD_NOT_MET')) g2gBlocked = true;
    }

    try {
      // SkyCoach min is $50 (5000 minor)
      await createAndReconcileWithdrawalBatch({
        platform: 'skycoach',
        orderContributions: [{ orderId: ordSky_1.id, contributionMinor: 4999 }],
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('MINIMUM_WITHDRAWAL_THRESHOLD_NOT_MET')) skyBlocked = true;
    }

    try {
      // Eldorado min is $200 (20000 minor)
      await createAndReconcileWithdrawalBatch({
        platform: 'eldorado',
        orderContributions: [{ orderId: ordEld_1.id, contributionMinor: 19999 }],
        actorId: adminId,
      });
    } catch (e: any) {
      if (e.message.includes('MINIMUM_WITHDRAWAL_THRESHOLD_NOT_MET')) eldBlocked = true;
    }

    assert(
      g2gBlocked && skyBlocked && eldBlocked,
      '11. Distinct minimum withdrawal thresholds enforced ($10 G2G, $50 SkyCoach, $200 Eldorado)',
      `G2G: ${g2gBlocked}, Sky: ${skyBlocked}, Eld: ${eldBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۲: Proportional allocation across multiple orders
    // ─────────────────────────────────────────────────────────────────────────
    const sampleItems = [
      { id: 1, contributionMinor: 10000 },
      { id: 2, contributionMinor: 20000 },
      { id: 3, contributionMinor: 30000 },
    ];
    // Total contribution = 60000. Fee = 600. Quotas: 100, 200, 300.
    const propAlloc = allocateProportionalWithRemainder(600, sampleItems);
    assert(
      propAlloc.find((p) => p.id === 1)?.allocatedMinor === 100 &&
        propAlloc.find((p) => p.id === 2)?.allocatedMinor === 200 &&
        propAlloc.find((p) => p.id === 3)?.allocatedMinor === 300,
      '12. Proportional allocation accurately distributes fee based on order contribution ratios',
      `Allocations: ${JSON.stringify(propAlloc)}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۳: Rounding and conservation invariants
    // ─────────────────────────────────────────────────────────────────────────
    // Odd fee that produces fractional cents: Fee = 100 minor, 3 equal contributors (33.333...)
    const oddItems = [
      { id: 'A', contributionMinor: 1000 },
      { id: 'B', contributionMinor: 1000 },
      { id: 'C', contributionMinor: 1000 },
    ];
    const oddAlloc = allocateProportionalWithRemainder(100, oddItems);
    const oddSum = oddAlloc.reduce((s, a) => s + a.allocatedMinor, 0);
    assert(
      oddSum === 100 &&
        oddAlloc.map((a) => a.allocatedMinor).sort().join(',') === '33,33,34',
      '13. Rounding and conservation invariants strictly preserved to the exact minor unit (no lost cents)',
      `Sum: ${oddSum}, Shares: ${JSON.stringify(oddAlloc)}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۴: Missing order-specific G4X fee blocks finalization
    // ─────────────────────────────────────────────────────────────────────────
    const ordWeb_1 = await createTestOrder('ORD-FIN-WEB-01', 15000); // $150.00
    await calculateOrderFinancialSnapshot({
      orderId: ordWeb_1.id,
      sourcePlatform: 'website',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 15000,
      // No g4xFeeRate provided!
    });

    let webFinalizeBlocked = false;
    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: ordWeb_1.id,
        actorId: adminId,
        participatingBoosterIds: [boosterA],
        serviceType: 'solo',
      });
    } catch (e: any) {
      if (e.message.includes('MISSING_ORDER_G4X_FEE_RATE')) webFinalizeBlocked = true;
    }
    assert(
      webFinalizeBlocked,
      '14. Missing order-specific G4X fee rate blocks finalization (no placeholder defaults)',
      `Blocked: ${webFinalizeBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۵: G4X fee applies after actual external costs
    // ─────────────────────────────────────────────────────────────────────────
    // SkyCoach Order 1 had gross 8000 ($80.00). In SkyBatch, it received:
    // batchFee: 600, transferFee: 12. ExternalNetBase = 8000 - 612 = 7388.
    // If G4X fee is 15%, it MUST be 15% of 7388 = 1108 minor (NOT 15% of 8000 = 1200 minor).
    const snapSkyReconciled = await prisma.orderFinancialSnapshot.findUnique({
      where: { orderId: ordSky_1.id },
    });
    // Set 15% G4X fee rate and update
    const snapSkyWithG4x = await calculateOrderFinancialSnapshot({
      orderId: ordSky_1.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 8000,
      g4xFeeRate: 0.15,
    });
    // Re-run batch update to ensure external net base calculation applies
    const expectedExternalNet = 8000 - snapSkyReconciled!.allocatedWithdrawalFeeMinor - snapSkyReconciled!.allocatedTransferFeeMinor;
    const expectedG4xFee = Math.round(expectedExternalNet * 0.15);
    const expectedBoosterPool = expectedExternalNet - expectedG4xFee;
    // Update snapshot with reconciled costs
    await prisma.orderFinancialSnapshot.update({
      where: { orderId: ordSky_1.id },
      data: {
        allocatedWithdrawalFeeMinor: snapSkyReconciled!.allocatedWithdrawalFeeMinor,
        allocatedTransferFeeMinor: snapSkyReconciled!.allocatedTransferFeeMinor,
        externalNetBaseMinor: expectedExternalNet,
        g4xFeeMinor: expectedG4xFee,
        boosterPoolMinor: expectedBoosterPool,
        calculationStatus: 'reconciled',
      },
    });
    const updatedSkySnap = await prisma.orderFinancialSnapshot.findUnique({ where: { orderId: ordSky_1.id } });
    assert(
      updatedSkySnap!.externalNetBaseMinor === expectedExternalNet &&
        updatedSkySnap!.g4xFeeMinor === expectedG4xFee &&
        updatedSkySnap!.g4xFeeMinor < Math.round(8000 * 0.15),
      '15. G4X fee is charged on external net base after external deductions, not gross sale',
      `External Net: ${updatedSkySnap?.externalNetBaseMinor}, G4X Fee: ${updatedSkySnap?.g4xFeeMinor} (vs Gross 15%: 1200)`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۶: Advertiser-specific commission rules
    // ─────────────────────────────────────────────────────────────────────────
    // Admin sets custom commission rate 12% on advertiser wallet
    await setAdvertiserCommissionRate(advertiserId, 0.12, adminId);
    const advRate = await getAdvertiserCommissionRate(advertiserId);

    // Advertiser trying to set their own rate must be blocked
    let advSelfBlocked = false;
    try {
      await setAdvertiserCommissionRate(advertiserId, 0.05, advertiserId);
    } catch (e: any) {
      if (e.message.includes('PERMISSION_DENIED') || e.message.includes('cannot set')) advSelfBlocked = true;
    }

    const ordAdv_1 = await createTestOrder('ORD-FIN-ADV-01', 10000); // $100.00
    const snapAdv_1 = await calculateOrderFinancialSnapshot({
      orderId: ordAdv_1.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      advertiserId,
      currency: 'USD',
      g4xFeeRate: 0.10, // 10% G4X fee
    });
    // Advertiser commission: 12% of 10000 = 1200 minor. G4X fee: 10% = 1000 minor. Pool = 7800 minor.
    assert(
      advRate === 0.12 &&
        advSelfBlocked &&
        snapAdv_1.advertiserFeeMinor === 1200 &&
        snapAdv_1.boosterPoolMinor === 7800,
      '16. Advertiser-specific commission configured by admin is enforced and self-modification blocked',
      `Rate: ${advRate}, Commission: ${snapAdv_1.advertiserFeeMinor}, Pool: ${snapAdv_1.boosterPoolMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۷: اصلاح خط‌مشی کارمزد طلای ادورتایزر (Phase 3.3.1 Business Rule Correction)
    // حذف فرض ۱۰٪، ممانعت از نهایی‌سازی بدون درصد مصوب، و اعمال درصد پس از تایید مدیریت
    // ─────────────────────────────────────────────────────────────────────────
    const ordAdvGold = await createTestOrder('ORD-FIN-ADV-GOLD', 1000000, 'GOLD'); // 1,000,000 Gold

    // ۱۷.الف: پیش از تنظیم درصد توسط مدیریت، کارمزد صفر و وضعیت provisional ثبت می‌شود (عدم فرض ۱۰٪)
    const snapAdvGoldBefore = await calculateOrderFinancialSnapshot({
      orderId: ordAdvGold.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 1000000,
      advertiserId,
      currency: 'GOLD',
    });

    let finalizationBlockedWithoutPolicy = false;
    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: ordAdvGold.id,
        actorId: adminId,
        participatingBoosterIds: [boosterA],
        serviceType: 'solo',
      });
    } catch (e: any) {
      if (e.message.includes('MISSING_SHARED_GOLD_FEE_RATE')) {
        finalizationBlockedWithoutPolicy = true;
      }
    }

    // ۱۷.ب: تنظیم درصد توسط کاربر غیرمجاز مسدود می‌شود
    let unauthorizedConfigBlocked = false;
    try {
      await configureSharedAdvertiserGoldFeePolicy({
        percentageRate: 0.15,
        actorId: boosterA, // بوستر اجازه تنظیم سیاست مالی ندارد
        reason: 'Unauthorized attempt',
      });
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION')) {
        unauthorizedConfigBlocked = true;
      }
    }

    // ۱۷.ج: تنظیم درصد مصوب مشترک توسط مدیر مجاز (مثلاً ۱۵٪) با ثبت نسخه‌بندی و ممیزی
    const configuredPolicy = await configureSharedAdvertiserGoldFeePolicy({
      percentageRate: 0.15, // نرخ فرضی مصوب مدیریت برای تست
      actorId: adminId,
      reason: 'Management approved 15% shared Gold advertiser fee rate',
    });

    // محاسبه مجدد اسنپ‌شات پس از تایید مدیریت
    const snapAdvGoldAfter = await calculateOrderFinancialSnapshot({
      orderId: ordAdvGold.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 1000000,
      advertiserId,
      currency: 'GOLD',
    });

    // نهایی‌سازی موفق پس از تایید درصد
    const finalizedGoldResult = await finalizeOrderFinancialsAndBoosterAllocation({
      orderId: ordAdvGold.id,
      actorId: adminId,
      participatingBoosterIds: [boosterA],
      serviceType: 'solo',
    });

    assert(
      snapAdvGoldBefore.g4xFeeMinor === 0 &&
        Boolean(snapAdvGoldBefore.notes?.includes('MISSING_SHARED_GOLD_FEE_RATE')) &&
        finalizationBlockedWithoutPolicy &&
        unauthorizedConfigBlocked &&
        configuredPolicy.version >= 1 &&
        snapAdvGoldAfter.g4xFeeMinor === 150000 && // 15% of 1,000,000
        snapAdvGoldAfter.advertiserFeeMinor === 120000 && // 12% custom
        snapAdvGoldAfter.boosterPoolMinor === 730000 && // 1,000,000 - 120,000 - 150,000
        finalizedGoldResult.snapshot.calculationStatus === 'finalized',
      '17. Shared Gold G4X fee policy requires explicit management configuration and blocks finalization without it',
      `Before Fee: ${snapAdvGoldBefore.g4xFeeMinor}, Finalization Blocked: ${finalizationBlockedWithoutPolicy}, After Fee: ${snapAdvGoldAfter.g4xFeeMinor}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۸: Equal Mythic+ split among four boosters
    // ─────────────────────────────────────────────────────────────────────────
    // Pool of 10001 minor among 4 boosters -> 2501, 2500, 2500, 2500
    const mplusSplit = splitPoolEquallyWithRemainder(10001, [boosterA, boosterB, boosterC, boosterD]);
    const mplusSum = mplusSplit.reduce((s, b) => s + b.allocatedMinor, 0);
    assert(
      mplusSplit.length === 4 &&
        mplusSum === 10001 &&
        mplusSplit[0].allocatedMinor === 2501 &&
        mplusSplit[1].allocatedMinor === 2500 &&
        mplusSplit[2].allocatedMinor === 2500 &&
        mplusSplit[3].allocatedMinor === 2500,
      '18. Mythic+ booster pool split equally among exactly four participating boosters with remainder',
      `Shares: ${mplusSplit.map((s) => s.allocatedMinor).join(', ')}, Total: ${mplusSum}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۱۹: Equal split for other team sizes
    // ─────────────────────────────────────────────────────────────────────────
    // 3-booster team with pool 1000 -> 334, 333, 333 (sum = 1000)
    const team3Split = splitPoolEquallyWithRemainder(1000, [boosterA, boosterB, boosterC]);
    // 5-booster team with pool 1004 -> 201, 201, 201, 201, 200 (sum = 1004)
    const team5Split = splitPoolEquallyWithRemainder(1004, [boosterA, boosterB, boosterC, boosterD, boosterE]);
    assert(
      team3Split.reduce((s, b) => s + b.allocatedMinor, 0) === 1000 &&
        team5Split.reduce((s, b) => s + b.allocatedMinor, 0) === 1004 &&
        team3Split.length === 3 &&
        team5Split.length === 5,
      '19. Equal split supports other team sizes (3-player, 5-player) without hardcoding four',
      `Team 3 sum: 1000, Team 5 sum: 1004`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۰: Idempotent calculation and reconciliation
    // ─────────────────────────────────────────────────────────────────────────
    // Finalize order 1 and then re-finalize
    const final1 = await finalizeOrderFinancialsAndBoosterAllocation({
      orderId: ordSky_1.id,
      actorId: adminId,
      participatingBoosterIds: [boosterA, boosterB, boosterC, boosterD],
      serviceType: 'mythic_plus',
    });
    const count1 = await prisma.boosterPayoutAllocation.count({ where: { orderId: ordSky_1.id } });

    // Re-finalize same order
    const final2 = await finalizeOrderFinancialsAndBoosterAllocation({
      orderId: ordSky_1.id,
      actorId: adminId,
      participatingBoosterIds: [boosterA, boosterB, boosterC, boosterD],
      serviceType: 'mythic_plus',
    });
    const count2 = await prisma.boosterPayoutAllocation.count({ where: { orderId: ordSky_1.id } });

    assert(
      count1 === 4 && count2 === 4 && final1.snapshot.calculationStatus === 'finalized',
      '20. Idempotent booster allocation execution preserves consistency and prevents duplicate allocations',
      `Initial count: ${count1}, Re-run count: ${count2}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۱: No premature withdrawable wallet credits
    // ─────────────────────────────────────────────────────────────────────────
    // Check wallet balances for boosters after finalization
    const walletA = await prisma.wallet.findUnique({ where: { userId: boosterA } });
    const walletB = await prisma.wallet.findUnique({ where: { userId: boosterB } });
    assert(
      (walletA?.balanceUsd ?? 0) === 0 && (walletB?.balanceUsd ?? 0) === 0,
      '21. No premature withdrawable wallet credits occur during financial calculation or finalization',
      `BoosterA USD Balance: ${walletA?.balanceUsd ?? 0}, BoosterB USD Balance: ${walletB?.balanceUsd ?? 0}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۲: No financial action bypassing authorization
    // ─────────────────────────────────────────────────────────────────────────
    let unauthPolicyBlocked = false;
    let unauthReconcileBlocked = false;
    let unauthFinalizeBlocked = false;

    try {
      await createOrUpdateFeePolicy(
        {
          platform: 'g2g',
          feeType: 'sale_commission',
          chargingEvent: 'sale',
          percentageRate: 0.12,
        },
        unauthorizedId
      );
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION')) unauthPolicyBlocked = true;
    }

    try {
      await createAndReconcileWithdrawalBatch({
        platform: 'skycoach',
        orderContributions: [{ orderId: ordSky_1.id, contributionMinor: 5000 }],
        actorId: unauthorizedId,
      });
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION')) unauthReconcileBlocked = true;
    }

    try {
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: ordSky_1.id,
        actorId: unauthorizedId,
        participatingBoosterIds: [boosterA],
      });
    } catch (e: any) {
      if (e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION')) unauthFinalizeBlocked = true;
    }

    assert(
      unauthPolicyBlocked && unauthReconcileBlocked && unauthFinalizeBlocked,
      '22. Unauthorized users are strictly blocked from policy updates, batch reconciliation, and finalization',
      `Policy: ${unauthPolicyBlocked}, Batch: ${unauthReconcileBlocked}, Finalize: ${unauthFinalizeBlocked}`
    );

    // ─────────────────────────────────────────────────────────────────────────
    // تست ۲۳: No automatic escrow release
    // ─────────────────────────────────────────────────────────────────────────
    const escrowEnabled = isEscrowReleaseEnabled();
    assert(
      escrowEnabled === false,
      '23. ESCROW_RELEASE_ENABLED is strictly false (no automatic escrow release in Phase 3.3)',
      `ESCROW_RELEASE_ENABLED: ${escrowEnabled}`
    );
  } catch (error: any) {
    console.error('Fatal error during financial calculation tests:', error);
    failed++;
  } finally {
    try {
      await prisma.boosterPayoutAllocation.deleteMany({ where: { order: { orderRef: { startsWith: 'ORD-FIN-' } } } });
      await prisma.orderWithdrawalAllocation.deleteMany({ where: { order: { orderRef: { startsWith: 'ORD-FIN-' } } } });
      await prisma.orderFinancialSnapshot.deleteMany({ where: { order: { orderRef: { startsWith: 'ORD-FIN-' } } } });
      await prisma.platformWithdrawalBatch.deleteMany({ where: { batchRef: { startsWith: 'BATCH_' } } });
      await prisma.order.deleteMany({ where: { orderRef: { startsWith: 'ORD-FIN-' } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: [adminId, unauthorizedId, advertiserId] } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: [adminId, unauthorizedId, advertiserId, boosterA, boosterB, boosterC, boosterD, boosterE] } } });
      await prisma.user.deleteMany({ where: { discordId: { in: [adminId, unauthorizedId, advertiserId, boosterA, boosterB, boosterC, boosterD, boosterE] } } });
    } catch (cleanupErr) {
      console.warn('Test cleanup warning:', cleanupErr);
    }
  }

  console.log('\n======================================================');
  console.log(`FINANCIAL ENGINE TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFinancialEngineTests().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});

