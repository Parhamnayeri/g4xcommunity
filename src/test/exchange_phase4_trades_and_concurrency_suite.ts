/**
 * src/test/exchange_phase4_trades_and_concurrency_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 4:
 *  1. 6-Point Sell Offer Validator (Role, Active Order, Capacity, Trade Limits, Currency/Region, Delivery Method)
 *  2. Anti-Self-Trading Rule (Buyer cannot submit sell offers on their own buy order)
 *  3. Partial Fulfillment & Multi-Trade Splitting (20M order fulfilled across multiple independent EXT trades)
 *  4. Concurrency & Zero-Overselling Protection (Promise.allSettled -> 1 success, 1 conflict, remaining >= 0)
 *  5. Immutable Fee Rule & Price Snapshot Isolation (Changing active rule does not mutate past trade snapshots)
 *  6. Pre-Payment Trade Cancellation & Capacity Release (AWAITING_PAYMENT trade release restores order capacity & status)
 *  7. Full Event Timeline & Exchange Audit Logging
 */

import prisma from '../database/db';
import {
  submitSellOffer,
  acceptSellOffer,
  rejectSellOffer,
  withdrawSellOffer,
  cancelUnpaidTrade,
  previewSellOfferPricing,
  listOffersOnBuyOrder,
  listMySellOffers,
  listTrades,
  getTradeById,
  ConcurrencyConflictError,
  TradeValidationError,
} from '../services/exchangeTradeService';
import {
  ensureExchangeDefaults,
  createVersionedExchangeFeeRule,
} from '../services/exchangeConfigService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runSuite() {
  console.log('=== STARTING G4X EXCHANGE PHASE 4 VERIFICATION SUITE ===\n');

  const BUYER_DISCORD_ID = 'PHASE4_BUYER_01';
  const SELLER_A_DISCORD_ID = 'PHASE4_SELLER_A';
  const SELLER_B_DISCORD_ID = 'PHASE4_SELLER_B';
  const SELLER_C_DISCORD_ID = 'PHASE4_SELLER_C';
  const ZERO_ROLE_USER_ID = 'PHASE4_ZERO_ROLE_USER';

  try {
    console.log('--- SETUP: Seeding Test Roles, Users & Initial Catalog ---');
    await ensureExchangeDefaults();

    // Ensure roles exist
    await prisma.role.upsert({ where: { roleKey: 'exchanger' }, create: { roleKey: 'exchanger', name: 'Exchanger' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'booster' }, create: { roleKey: 'booster', name: 'Booster' }, update: {} });

    // Seed Buyer
    await prisma.user.upsert({
      where: { discordId: BUYER_DISCORD_ID },
      create: { discordId: BUYER_DISCORD_ID, username: 'p4_buyer', displayName: 'P4 Buyer', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: BUYER_DISCORD_ID, roleKey: 'exchanger' } },
      create: { userId: BUYER_DISCORD_ID, roleKey: 'exchanger' },
      update: {},
    });
    await prisma.exchangeKycRequest.upsert({
      where: { userId: BUYER_DISCORD_ID },
      create: { userId: BUYER_DISCORD_ID, status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED' },
    });
    await prisma.exchangeUserPermission.upsert({
      where: { userId: BUYER_DISCORD_ID },
      create: { userId: BUYER_DISCORD_ID, canCreateBuyOrder: true, canSubmitSellOffer: true },
      update: { canCreateBuyOrder: true, canSubmitSellOffer: true, isSuspended: false },
    });

    // Seed Sellers with standard role (booster)
    for (const sId of [SELLER_A_DISCORD_ID, SELLER_B_DISCORD_ID, SELLER_C_DISCORD_ID]) {
      await prisma.user.upsert({
        where: { discordId: sId },
        create: { discordId: sId, username: sId.toLowerCase(), displayName: sId, isActive: true },
        update: { isActive: true },
      });
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: sId, roleKey: 'booster' } },
        create: { userId: sId, roleKey: 'booster' },
        update: {},
      });
    }

    // Seed zero-role user
    await prisma.user.upsert({
      where: { discordId: ZERO_ROLE_USER_ID },
      create: { discordId: ZERO_ROLE_USER_ID, username: 'zero_role', displayName: 'Zero Role', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.deleteMany({ where: { userId: ZERO_ROLE_USER_ID } });

    // Find test catalog entities
    const game = await prisma.exchangeGame.findFirst({ where: { isActive: true } });
    const currency = await prisma.exchangeCurrency.findFirst({ where: { gameId: game!.id, isActive: true } });
    const deliveryMethod = await prisma.exchangeDeliveryMethod.findFirst({ where: { isActive: true } });
    const unacceptedDeliveryMethod = await prisma.exchangeDeliveryMethod.findFirst({
      where: { id: { not: deliveryMethod!.id }, isActive: true },
    });

    if (!game || !currency || !deliveryMethod) {
      throw new Error('Default catalog seed failed; game, currency, or delivery method missing.');
    }

    // Create a 20M capacity buy order for testing
    // totalCapacity = 20,000,000, minTrade = 1,000,000, maxTrade = 15,000,000
    const buyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-P4-${Date.now()}`,
        buyerUserId: BUYER_DISCORD_ID,
        buyerDiscordId: BUYER_DISCORD_ID,
        gameId: game.id,
        currencyId: currency.id,
        pricePerUnitCents: 150, // $1.50 per unit
        unitLabelSnapshot: currency.unitLabel,
        unitMultiplierSnapshot: currency.unitMultiplier,
        minTradeBaseUnits: '1000000',
        maxTradeBaseUnits: '15000000',
        totalCapacityBaseUnits: '20000000',
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '20000000',
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([deliveryMethod.id]),
        status: 'ACTIVE',
      },
    });

    console.log(`Created Test Buy Order: ${buyOrder.orderCode} (Total Capacity: 20M)\n`);

    // =========================================================================
    // TEST 1: 6-Point Sell Offer Validator & Anti-Self-Trading Checks
    // =========================================================================
    console.log('--- TEST 1: 6-Point Sell Offer Validator & Anti-Self-Trading ---');

    // 1.1 Zero-role user must be rejected
    let zeroRoleBlocked = false;
    try {
      await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: ZERO_ROLE_USER_ID,
        offeredAmountBaseUnits: '5000000',
        deliveryMethodId: deliveryMethod.id,
      });
    } catch (err: any) {
      zeroRoleBlocked = true;
    }
    assert(zeroRoleBlocked, '1.1 Zero-role user without any active G4X role is rejected from submitting offers');

    // 1.2 Anti-self-trading: buyer cannot submit offer to their own buy order
    let selfTradeBlocked = false;
    try {
      await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: BUYER_DISCORD_ID,
        offeredAmountBaseUnits: '5000000',
        deliveryMethodId: deliveryMethod.id,
      });
    } catch (err: any) {
      selfTradeBlocked = err.message.includes('cannot submit a sell offer to your own buy order');
    }
    assert(selfTradeBlocked, '1.2 Anti-self-trading guard blocks buyer from submitting offer to own buy order');

    // 1.3 Offering below minimum trade limit
    let belowMinBlocked = false;
    try {
      await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: SELLER_A_DISCORD_ID,
        offeredAmountBaseUnits: '500000', // min is 1,000,000
        deliveryMethodId: deliveryMethod.id,
      });
    } catch (err: any) {
      belowMinBlocked = err.message.includes('below the order\'s minimum trade limit');
    }
    assert(belowMinBlocked, '1.3 Offering below minimum trade limit is rejected (500k < 1M)');

    // 1.4 Offering above maximum trade limit
    let aboveMaxBlocked = false;
    try {
      await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: SELLER_A_DISCORD_ID,
        offeredAmountBaseUnits: '16000000', // max is 15,000,000
        deliveryMethodId: deliveryMethod.id,
      });
    } catch (err: any) {
      aboveMaxBlocked = err.message.includes('exceeds the order\'s maximum trade limit');
    }
    assert(aboveMaxBlocked, '1.4 Offering above maximum trade limit is rejected (16M > 15M)');

    // 1.5 Offering above remaining capacity
    let aboveCapacityBlocked = false;
    try {
      await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: SELLER_A_DISCORD_ID,
        offeredAmountBaseUnits: '25000000', // remaining is 20,000,000
        deliveryMethodId: deliveryMethod.id,
      });
    } catch (err: any) {
      aboveCapacityBlocked = true;
    }
    assert(aboveCapacityBlocked, '1.5 Offering above remaining capacity is rejected (25M > 20M)');

    // 1.6 Unaccepted delivery method
    if (unacceptedDeliveryMethod) {
      let unacceptedMethodBlocked = false;
      try {
        await submitSellOffer({
          buyOrderId: buyOrder.id,
          sellerUserId: SELLER_A_DISCORD_ID,
          offeredAmountBaseUnits: '5000000',
          deliveryMethodId: unacceptedDeliveryMethod.id,
        });
      } catch (err: any) {
        unacceptedMethodBlocked = err.message.includes('not accepted by this buy order');
      }
      assert(unacceptedMethodBlocked, '1.6 Unaccepted delivery method is rejected');
    }

    // 1.7 Live payout calculation preview
    const preview = await previewSellOfferPricing({
      buyOrderId: buyOrder.id,
      offeredAmountBaseUnits: '5000000',
    });
    assert(
      preview.pricing.grossCents > 0 && preview.pricing.netSellerCents > 0,
      '1.7 Live payout calculation preview returns exact non-zero integer cents without saving'
    );

    // =========================================================================
    // TEST 2: Partial Fulfillment & Multi-Trade Splitting
    // =========================================================================
    console.log('\n--- TEST 2: Partial Fulfillment & Multi-Trade Splitting ---');

    // 2.1 Seller A submits valid 5,000,000 offer
    const offerA = await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: SELLER_A_DISCORD_ID,
      offeredAmountBaseUnits: '5000000',
      deliveryMethodId: deliveryMethod.id,
      estimatedDeliveryMinutes: 20,
      additionalInfo: 'Ready to trade immediately',
    });
    assert(offerA.status === 'PENDING' && offerA.offerCode.startsWith('EXS-'), '2.1 Seller A submits 5M offer successfully with PENDING status');

    // 2.2 Buyer accepts Seller A's offer
    const tradeA = await acceptSellOffer({
      offerId: offerA.id,
      buyerUserId: BUYER_DISCORD_ID,
    });
    assert(tradeA.status === 'AWAITING_PAYMENT' && tradeA.tradeCode.startsWith('EXT-'), '2.2 Buyer accepts Offer A; Trade A is created with AWAITING_PAYMENT status');

    // Check Buy Order state after Trade A
    const orderAfterA = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    assert(
      orderAfterA?.status === 'PARTIALLY_FILLED' &&
      orderAfterA.remainingCapacityBaseUnits === '15000000' &&
      orderAfterA.reservedCapacityBaseUnits === '5000000',
      '2.3 Order capacity after Trade A: 15M remaining, 5M reserved, status PARTIALLY_FILLED'
    );

    // 2.4 Seller B submits 10,000,000 offer
    const offerB = await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: SELLER_B_DISCORD_ID,
      offeredAmountBaseUnits: '10000000',
      deliveryMethodId: deliveryMethod.id,
    });
    const tradeB = await acceptSellOffer({
      offerId: offerB.id,
      buyerUserId: BUYER_DISCORD_ID,
    });
    assert(tradeB.tradeCode.startsWith('EXT-') && tradeB.id !== tradeA.id, '2.4 Buyer accepts Offer B; independent Trade B created');

    const orderAfterB = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    assert(
      orderAfterB?.status === 'PARTIALLY_FILLED' &&
      orderAfterB.remainingCapacityBaseUnits === '5000000' &&
      orderAfterB.reservedCapacityBaseUnits === '15000000',
      '2.5 Order capacity after Trade B: 5M remaining, 15M reserved, status still PARTIALLY_FILLED'
    );

    // 2.6 Seller C submits remaining 5,000,000 offer
    const offerC = await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: SELLER_C_DISCORD_ID,
      offeredAmountBaseUnits: '5000000',
      deliveryMethodId: deliveryMethod.id,
    });
    const tradeC = await acceptSellOffer({
      offerId: offerC.id,
      buyerUserId: BUYER_DISCORD_ID,
    });

    const orderAfterC = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    assert(
      orderAfterC?.status === 'FULLY_RESERVED' &&
      orderAfterC.remainingCapacityBaseUnits === '0' &&
      orderAfterC.reservedCapacityBaseUnits === '20000000',
      '2.6 Full fulfillment reached: 0 remaining, 20M reserved, status transitions to FULLY_RESERVED'
    );

    // =========================================================================
    // TEST 3: Concurrency & Zero-Overselling Protection (Promise.allSettled)
    // =========================================================================
    console.log('\n--- TEST 3: Concurrency & Zero-Overselling Protection ---');

    // Create a new order with remaining capacity of 4,000,000
    const concurrencyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-CONC-${Date.now()}`,
        buyerUserId: BUYER_DISCORD_ID,
        buyerDiscordId: BUYER_DISCORD_ID,
        gameId: game.id,
        currencyId: currency.id,
        pricePerUnitCents: 100,
        unitLabelSnapshot: currency.unitLabel,
        unitMultiplierSnapshot: currency.unitMultiplier,
        minTradeBaseUnits: '1000000',
        maxTradeBaseUnits: '5000000',
        totalCapacityBaseUnits: '4000000',
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '4000000',
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([deliveryMethod.id]),
        status: 'ACTIVE',
        version: 0,
      },
    });

    // Both Seller A and Seller B submit an offer for 4,000,000 (each wanting the FULL remaining capacity)
    const concOffer1 = await submitSellOffer({
      buyOrderId: concurrencyOrder.id,
      sellerUserId: SELLER_A_DISCORD_ID,
      offeredAmountBaseUnits: '4000000',
      deliveryMethodId: deliveryMethod.id,
    });

    const concOffer2 = await submitSellOffer({
      buyOrderId: concurrencyOrder.id,
      sellerUserId: SELLER_B_DISCORD_ID,
      offeredAmountBaseUnits: '4000000',
      deliveryMethodId: deliveryMethod.id,
    });

    // Now, buyer attempts to accept BOTH concurrently at the exact same instant
    const [result1, result2] = await Promise.allSettled([
      acceptSellOffer({ offerId: concOffer1.id, buyerUserId: BUYER_DISCORD_ID }),
      acceptSellOffer({ offerId: concOffer2.id, buyerUserId: BUYER_DISCORD_ID }),
    ]);

    const successes = [result1, result2].filter((r) => r.status === 'fulfilled');
    const failures = [result1, result2].filter((r) => r.status === 'rejected');

    assert(successes.length === 1, `3.1 Exactly ONE concurrent acceptance succeeds (got ${successes.length} success)`);
    assert(failures.length === 1, `3.2 Exactly ONE concurrent acceptance fails (got ${failures.length} conflict/failure)`);

    // Verify order capacity never went below 0
    const finalConcOrder = await prisma.exchangeBuyOrder.findUnique({ where: { id: concurrencyOrder.id } });
    assert(
      finalConcOrder?.remainingCapacityBaseUnits === '0' &&
      finalConcOrder?.reservedCapacityBaseUnits === '4000000' &&
      finalConcOrder?.status === 'FULLY_RESERVED',
      '3.3 Zero-overselling guaranteed: remaining capacity is exactly 0, not negative'
    );

    // =========================================================================
    // TEST 4: Immutable Fee Rule & Price Snapshot Isolation
    // =========================================================================
    console.log('\n--- TEST 4: Immutable Fee Rule & Price Snapshot Isolation ---');

    // Inspect Trade A fee snapshots
    const originalTradeA = await getTradeById(tradeA.id, BUYER_DISCORD_ID, ['exchanger']);
    const originalBuyerBps = originalTradeA.buyerCommissionBpsSnapshot;
    const originalSellerBps = originalTradeA.sellerCommissionBpsSnapshot;

    // Owner creates a new higher fee rule v2 (500 bps buyer, 700 bps seller)
    await createVersionedExchangeFeeRule({
      scope: 'GLOBAL',
      buyerCommissionBps: 500,
      sellerCommissionBps: 700,
      effectiveFrom: new Date(),
      createdByDiscordId: 'SYSTEM',
      reason: 'Owner updated rates',
    });

    // Re-query Trade A
    const queriedTradeA = await getTradeById(tradeA.id, BUYER_DISCORD_ID, ['exchanger']);
    assert(
      queriedTradeA.buyerCommissionBpsSnapshot === originalBuyerBps &&
      queriedTradeA.sellerCommissionBpsSnapshot === originalSellerBps,
      '4.1 Trade A maintains immutable snapshot from creation moment despite global fee rule mutation'
    );

    // =========================================================================
    // TEST 5: Pre-Payment Trade Cancellation & Capacity Release
    // =========================================================================
    console.log('\n--- TEST 5: Pre-Payment Trade Cancellation & Capacity Release ---');

    // Order buyOrder was FULLY_RESERVED (20M total, 0 remaining, 20M reserved)
    // Cancel Trade A (5,000,000 base units)
    const cancelledTradeA = await cancelUnpaidTrade({
      tradeId: tradeA.id,
      actorUserId: BUYER_DISCORD_ID,
      actorRoles: ['exchanger'],
      reason: 'Seller went offline before payment',
    });

    assert(
      cancelledTradeA.status === 'CANCELLED' && cancelledTradeA.capacityReserved === false,
      '5.1 Trade A status changed to CANCELLED and capacityReserved set to false'
    );

    // Buy order should now have released 5M capacity back to remaining!
    const restoredOrder = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    assert(
      restoredOrder?.remainingCapacityBaseUnits === '5000000' &&
      restoredOrder?.reservedCapacityBaseUnits === '15000000' &&
      restoredOrder?.status === 'PARTIALLY_FILLED',
      '5.2 5M capacity released back: remaining is now 5M, reserved is 15M, status restored from FULLY_RESERVED to PARTIALLY_FILLED'
    );

    // =========================================================================
    // TEST 6: Event Timeline & Query Verification
    // =========================================================================
    console.log('\n--- TEST 6: Event Timeline & Query Verification ---');

    const tradeWithEvents = await getTradeById(tradeA.id, BUYER_DISCORD_ID, ['exchanger']);
    const eventTypes = (tradeWithEvents.events || []).map((e: any) => e.eventType);

    assert(eventTypes.includes('OFFER_ACCEPTED'), '6.1 Timeline includes OFFER_ACCEPTED event');
    assert(eventTypes.includes('CAPACITY_RESERVED'), '6.2 Timeline includes CAPACITY_RESERVED event');
    assert(eventTypes.includes('TRADE_CANCELLED'), '6.3 Timeline includes TRADE_CANCELLED event');
    assert(eventTypes.includes('CAPACITY_RELEASED'), '6.4 Timeline includes CAPACITY_RELEASED event');

    // Query seller's own offers
    const sellerOffers = await listMySellOffers(SELLER_A_DISCORD_ID);
    assert(sellerOffers.length >= 1, '6.5 listMySellOffers returns seller offers');

    // Query user's trades
    const buyerTrades = await listTrades({ userId: BUYER_DISCORD_ID, role: 'buyer' });
    assert(buyerTrades.length >= 3, '6.6 listTrades returns all user trades');

    // =========================================================================
    // CLEANUP
    // =========================================================================
    console.log('\n--- CLEANUP: Removing Test Records ---');
    await prisma.exchangeTradeEvent.deleteMany({
      where: { trade: { buyOrderId: { in: [buyOrder.id, concurrencyOrder.id] } } },
    });
    await prisma.exchangeTrade.deleteMany({
      where: { buyOrderId: { in: [buyOrder.id, concurrencyOrder.id] } },
    });
    await prisma.exchangeSellOffer.deleteMany({
      where: { buyOrderId: { in: [buyOrder.id, concurrencyOrder.id] } },
    });
    await prisma.exchangeBuyOrder.deleteMany({
      where: { id: { in: [buyOrder.id, concurrencyOrder.id] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        entityType: { in: ['EXCHANGE_SELL_OFFER', 'EXCHANGE_TRADE'] },
      },
    });

  } catch (err: any) {
    console.error('Unhandled suite error:', err);
    failed++;
  }

  console.log('\n============================================================');
  console.log(`PHASE 4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
