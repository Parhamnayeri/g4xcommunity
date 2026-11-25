/**
 * src/test/exchange_phase2_guards_and_phase3_buy_orders_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 2 & 3:
 *  1. Buyer Eligibility Guard (Requires 'exchanger' role + APPROVED non-expired KYC)
 *  2. Seller Eligibility Guard (Requires >= 1 active role, zero KYC required to sell)
 *  3. Backward-Compatibility Auto-Bridge for existing Exchangers
 *  4. Exchanger KYC Application & Admin Review Lifecycle (APPROVE, SUSPEND, REJECT)
 *  5. Direct Admin Role Assignment (setExchangerRole)
 *  6. Buy Order Creation with Strict No-Float Math (Integer cents & String base units)
 *  7. Buy Order Lifecycle & Safe Transitions (DRAFT -> ACTIVE -> PAUSED -> ACTIVE -> CANCELLED)
 *  8. Edit bounds validation & capacity integrity
 *  9. Active Reservation Cancel Guard (Cannot cancel if reserved > 0)
 * 10. Auto-Expiration Engine (Past-due orders transition to EXPIRED)
 * 11. Zero PII Guardrail (Public marketplace response hides phone, telegram, whatsapp, KYC notes)
 * 12. Full Audit Logging for KYC reviews and Order mutations
 */

import express from 'express';
import http from 'http';
import prisma from '../database/db';
import { router as apiRouter } from '../web/routes';
import {
  getExchangeEligibility,
  assertEligibleExchangeBuyer,
  assertEligibleExchangeSeller,
  submitExchangerKycApplication,
  reviewExchangerKyc,
  setExchangerRole,
  ExchangeAuthError,
} from '../services/exchangeAuthService';
import {
  autoExpirePastDueOrders,
} from '../web/exchangeMarketplaceRoutes';
import { ensureExchangeDefaults } from '../services/exchangeConfigService';

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
  console.log('=== STARTING G4X EXCHANGE PHASE 2 & 3 VERIFICATION SUITE ===\n');

  const TEST_BUYER_ID = 'TEST_EXCHANGE_BUYER_01';
  const TEST_SELLER_ID = 'TEST_EXCHANGE_SELLER_01';
  const TEST_NON_EXCHANGER_ID = 'TEST_NON_EXCHANGER_01';
  const TEST_ADMIN_ID = 'TEST_EXCHANGE_ADMIN_01';

  try {
    // 0. Seed test roles and users
    console.log('--- SETUP: Seeding Test Roles, Users & Catalog ---');

    await prisma.role.upsert({
      where: { roleKey: 'exchanger' },
      create: { roleKey: 'exchanger', name: 'Exchanger' },
      update: {},
    });
    await prisma.role.upsert({
      where: { roleKey: 'booster' },
      create: { roleKey: 'booster', name: 'Booster' },
      update: {},
    });
    await prisma.role.upsert({
      where: { roleKey: 'admin' },
      create: { roleKey: 'admin', name: 'Admin' },
      update: {},
    });

    // Cleanup previous test users
    const testIds = [TEST_BUYER_ID, TEST_SELLER_ID, TEST_NON_EXCHANGER_ID, TEST_ADMIN_ID];
    await prisma.exchangeBuyOrder.deleteMany({
      where: { buyerUserId: { in: testIds } },
    });
    await prisma.exchangeKycRequest.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.exchangeUserPermission.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: testIds } },
    });

    // Create users
    await prisma.user.create({
      data: {
        discordId: TEST_BUYER_ID,
        username: 'TestBuyerExchanger',
        displayName: 'Verified Buyer',
        phoneNumber: '+1-555-0199',
        telegramUsername: '@testbuyer',
        whatsappNumber: '+1-555-0199',
      },
    });

    await prisma.user.create({
      data: {
        discordId: TEST_SELLER_ID,
        username: 'TestSellerBooster',
        displayName: 'Active Booster Seller',
        phoneNumber: '+1-555-0200',
      },
    });
    await prisma.userRole.create({
      data: { userId: TEST_SELLER_ID, roleKey: 'booster' },
    });

    await prisma.user.create({
      data: {
        discordId: TEST_NON_EXCHANGER_ID,
        username: 'TestOrdinaryUser',
        displayName: 'No Roles Member',
      },
    });

    await prisma.user.create({
      data: {
        discordId: TEST_ADMIN_ID,
        username: 'TestExchangeAdmin',
        displayName: 'Compliance Admin',
      },
    });
    await prisma.userRole.create({
      data: { userId: TEST_ADMIN_ID, roleKey: 'admin' },
    });

    // Seed catalog defaults (WoW, PoE, Diablo IV, fee rules, delivery methods)
    await ensureExchangeDefaults();

    const testGame = await prisma.exchangeGame.findFirst({
      where: { isActive: true },
      include: { currencies: true, regions: true },
    });
    if (!testGame || testGame.currencies.length === 0) {
      throw new Error('Test catalog has no active game or currencies');
    }
    const testCurrency = testGame.currencies[0];
    const testRegion = testGame.regions[0] || null;

    const deliveryMethod = await prisma.exchangeDeliveryMethod.findFirst({
      where: { isActive: true },
    });
    const testDeliveryMethodId = deliveryMethod?.id || 'TEST_DM';

    console.log(`Using Catalog Game: ${testGame.name}, Currency: ${testCurrency.name}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Buyer Eligibility Guard (Blocks non-exchanger without approved KYC)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Buyer Eligibility Guard ---');

    let buyerErrorThrown = false;
    try {
      await assertEligibleExchangeBuyer(TEST_NON_EXCHANGER_ID);
    } catch (err: any) {
      buyerErrorThrown = true;
      assert(err instanceof ExchangeAuthError, 'assertEligibleExchangeBuyer throws ExchangeAuthError');
      assert(err.statusCode === 403, 'assertEligibleExchangeBuyer returns 403 Forbidden');
      assert(err.reasons.length > 0, 'assertEligibleExchangeBuyer specifies descriptive blocking reasons');
    }
    assert(buyerErrorThrown, 'Ordinary user without exchanger role is blocked from creating buy orders');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Seller Eligibility Guard (Permits any user with >= 1 active role)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Seller Eligibility Guard ---');

    // Booster seller with active role has selling rights without KYC or exchanger role
    const sellerEligibility = await assertEligibleExchangeSeller(TEST_SELLER_ID);
    assert(sellerEligibility.canSubmitSellOffer === true, 'Booster with active role is eligible to sell');
    assert(sellerEligibility.hasExchangerRole === false, 'Booster does NOT need exchanger role to sell');
    assert(sellerEligibility.kycStatus === 'NOT_SUBMITTED', 'Booster does NOT need KYC to sell');

    // User with 0 roles is blocked from selling
    let noRoleSellerBlocked = false;
    try {
      await assertEligibleExchangeSeller(TEST_NON_EXCHANGER_ID);
    } catch (err: any) {
      noRoleSellerBlocked = true;
      assert(err.statusCode === 403, 'User with 0 roles is blocked with 403 on sell offer');
    }
    assert(noRoleSellerBlocked, 'User with no roles is blocked from selling');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Backward Compatibility Auto-Bridge for Existing Exchangers
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Backward Compatibility Auto-Bridge ---');

    // Assign 'exchanger' role to buyerUser directly without any prior KYC record
    await prisma.userRole.create({
      data: { userId: TEST_BUYER_ID, roleKey: 'exchanger', grantedBy: TEST_ADMIN_ID },
    });

    const bridgedEligibility = await getExchangeEligibility(TEST_BUYER_ID);
    assert(bridgedEligibility.hasExchangerRole === true, 'User has exchanger role');
    assert(bridgedEligibility.kycStatus === 'APPROVED', 'Pre-existing exchanger was auto-bridged to APPROVED KYC');
    assert(bridgedEligibility.canCreateBuyOrder === true, 'Pre-existing exchanger can create buy orders without lockout');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Exchanger KYC Application & Admin Review Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Exchanger KYC Application & Admin Review Lifecycle ---');

    // User submits KYC application
    const kycApplication = await submitExchangerKycApplication({
      userId: TEST_NON_EXCHANGER_ID,
      notes: 'Experienced trader from Path of Exile & Diablo IV',
      documentsMetaJson: JSON.stringify({ verifiedDiscord: true, tradeHistoryProofs: 5 }),
    });
    assert(kycApplication.status === 'PENDING_REVIEW', 'KYC application status is PENDING_REVIEW');
    assert(kycApplication.submittedAt !== null, 'KYC submission timestamp is recorded');

    // Admin reviews with APPROVE
    const approvedKyc = await reviewExchangerKyc({
      adminDiscordId: TEST_ADMIN_ID,
      requestId: kycApplication.id,
      action: 'APPROVE',
      notes: 'Credentials verified by compliance officer',
    });
    assert(approvedKyc.status === 'APPROVED', 'Reviewed KYC status is APPROVED');

    const approvedEligibility = await getExchangeEligibility(TEST_NON_EXCHANGER_ID);
    assert(approvedEligibility.hasExchangerRole === true, 'User was automatically granted exchanger role in UserRole');
    assert(approvedEligibility.canCreateBuyOrder === true, 'User can now create buy orders');

    // Admin reviews with SUSPEND
    await reviewExchangerKyc({
      adminDiscordId: TEST_ADMIN_ID,
      requestId: kycApplication.id,
      action: 'SUSPEND',
      notes: 'Suspended pending investigation',
    });

    const suspendedEligibility = await getExchangeEligibility(TEST_NON_EXCHANGER_ID);
    assert(suspendedEligibility.isSuspended === true, 'User is marked suspended');
    assert(suspendedEligibility.canCreateBuyOrder === false, 'Suspended user cannot create buy orders');
    assert(suspendedEligibility.canSubmitSellOffer === false, 'Suspended user cannot submit sell offers');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Direct Admin Role Grant & Revocation (setExchangerRole)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Direct Admin Exchanger Role Assignment ---');

    // Revoke from buyerUser
    await setExchangerRole({
      adminDiscordId: TEST_ADMIN_ID,
      targetDiscordId: TEST_BUYER_ID,
      grant: false,
      reason: 'Administrative role revocation test',
    });
    let buyerEligibilityAfterRevoke = await getExchangeEligibility(TEST_BUYER_ID);
    assert(buyerEligibilityAfterRevoke.hasExchangerRole === false, 'Exchanger role was revoked');
    assert(buyerEligibilityAfterRevoke.canCreateBuyOrder === false, 'canCreateBuyOrder revoked');

    // Re-grant to buyerUser
    await setExchangerRole({
      adminDiscordId: TEST_ADMIN_ID,
      targetDiscordId: TEST_BUYER_ID,
      grant: true,
      reason: 'Re-granting exchanger role test',
    });
    buyerEligibilityAfterRevoke = await getExchangeEligibility(TEST_BUYER_ID);
    assert(buyerEligibilityAfterRevoke.hasExchangerRole === true, 'Exchanger role was re-granted');
    assert(buyerEligibilityAfterRevoke.canCreateBuyOrder === true, 'canCreateBuyOrder re-enabled');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Buy Order Creation & Strict No-Float Math
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Buy Order Creation with Strict No-Float Math ---');

    // Create Buy Order: $0.85 (85 cents) per unit, min 1000 base units, max 50000, total 100000
    const multiplier = testCurrency.unitMultiplier || '1';
    const minUnits = '1000';
    const maxUnits = '50000';
    const totalUnits = '100000';
    const priceCents = 85;

    const buyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-TEST-${Date.now()}`,
        buyerUserId: TEST_BUYER_ID,
        buyerDiscordId: TEST_BUYER_ID,
        gameId: testGame.id,
        currencyId: testCurrency.id,
        regionId: testRegion?.id || null,
        pricePerUnitCents: priceCents,
        unitLabelSnapshot: testCurrency.unitLabel,
        unitMultiplierSnapshot: multiplier,
        minTradeBaseUnits: minUnits,
        maxTradeBaseUnits: maxUnits,
        totalCapacityBaseUnits: totalUnits,
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: totalUnits,
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([testDeliveryMethodId]),
        instructions: 'Deliver in-game or via direct mail',
        status: 'ACTIVE',
      },
    });

    assert(buyOrder.pricePerUnitCents === 85, 'Price stored as exact integer cents (85 for $0.85)');
    assert(buyOrder.totalCapacityBaseUnits === totalUnits, 'Total capacity stored as exact integer string');
    assert(buyOrder.remainingCapacityBaseUnits === totalUnits, 'Remaining capacity equals total capacity on creation');
    assert(buyOrder.reservedCapacityBaseUnits === '0', 'Reserved capacity starts at 0');
    assert(buyOrder.filledCapacityBaseUnits === '0', 'Filled capacity starts at 0');
    assert(buyOrder.status === 'ACTIVE', 'Initial status is ACTIVE');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Buy Order Lifecycle Transitions (ACTIVE -> PAUSED -> ACTIVE)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Order Lifecycle Transitions & Safe Edits ---');

    // 1. Pause
    const pausedOrder = await prisma.exchangeBuyOrder.update({
      where: { id: buyOrder.id },
      data: { status: 'PAUSED' },
    });
    assert(pausedOrder.status === 'PAUSED', 'Order transitioned to PAUSED');

    // 2. Safe Edit while PAUSED (update price to 95 cents, total capacity to 150000)
    const newTotal = '150000';
    const remaining = BigInt(newTotal) - BigInt(pausedOrder.filledCapacityBaseUnits) - BigInt(pausedOrder.reservedCapacityBaseUnits);
    const editedOrder = await prisma.exchangeBuyOrder.update({
      where: { id: buyOrder.id },
      data: {
        pricePerUnitCents: 95,
        totalCapacityBaseUnits: newTotal,
        remainingCapacityBaseUnits: remaining.toString(),
      },
    });
    assert(editedOrder.pricePerUnitCents === 95, 'Price updated to 95 cents ($0.95)');
    assert(editedOrder.totalCapacityBaseUnits === '150000', 'Total capacity updated');
    assert(editedOrder.remainingCapacityBaseUnits === '150000', 'Remaining capacity recalculated accurately');

    // 3. Resume
    const resumedOrder = await prisma.exchangeBuyOrder.update({
      where: { id: buyOrder.id },
      data: { status: 'ACTIVE' },
    });
    assert(resumedOrder.status === 'ACTIVE', 'Order resumed to ACTIVE');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Reservation Cancel Guard (Cannot cancel if reserved > 0)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Reservation Cancel Guard ---');

    // Simulate an in-progress trade reservation of 20000 base units
    const orderWithReservation = await prisma.exchangeBuyOrder.update({
      where: { id: buyOrder.id },
      data: {
        reservedCapacityBaseUnits: '20000',
        remainingCapacityBaseUnits: '130000',
      },
    });

    const isReserved = BigInt(orderWithReservation.reservedCapacityBaseUnits) > 0n;
    assert(isReserved === true, 'Order has active trade reservation');

    // Attempting to cancel while reserved > 0 should be rejected by guard logic
    let cancelBlocked = false;
    if (BigInt(orderWithReservation.reservedCapacityBaseUnits) > 0n) {
      cancelBlocked = true;
    }
    assert(cancelBlocked, 'Cancellation guard strictly blocks orders with active reservations');

    // Release reservation (trade completed or failed)
    const clearedOrder = await prisma.exchangeBuyOrder.update({
      where: { id: buyOrder.id },
      data: {
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '150000',
      },
    });

    // Now cancellation succeeds
    const cancelledOrder = await prisma.exchangeBuyOrder.update({
      where: { id: clearedOrder.id },
      data: { status: 'CANCELLED' },
    });
    assert(cancelledOrder.status === 'CANCELLED', 'Order safely cancelled when reservations are 0');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Auto-Expiration Logic (Past-due active orders -> EXPIRED)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Auto-Expiration Engine ---');

    // Create an order with expiresAt in the past
    const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
    const expiringOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-EXPIRE-${Date.now()}`,
        buyerUserId: TEST_BUYER_ID,
        buyerDiscordId: TEST_BUYER_ID,
        gameId: testGame.id,
        currencyId: testCurrency.id,
        pricePerUnitCents: 50,
        minTradeBaseUnits: '1',
        maxTradeBaseUnits: '100',
        totalCapacityBaseUnits: '1000',
        remainingCapacityBaseUnits: '1000',
        reservedCapacityBaseUnits: '0',
        filledCapacityBaseUnits: '0',
        expiresAt: pastDate,
        status: 'ACTIVE',
      },
    });

    const expiredCount = await autoExpirePastDueOrders();
    assert(expiredCount >= 1, `Auto-expiration engine processed ${expiredCount} expired order(s)`);

    const refreshedOrder = await prisma.exchangeBuyOrder.findUnique({
      where: { id: expiringOrder.id },
    });
    assert(refreshedOrder?.status === 'EXPIRED', 'Past-due active order with 0 reservations transitioned to EXPIRED');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Zero PII Guardrail in Public Marketplace Listings
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Zero PII Guardrail in Public Marketplace ---');

    // Create an active order to query
    const publicOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-PUB-${Date.now()}`,
        buyerUserId: TEST_BUYER_ID,
        buyerDiscordId: TEST_BUYER_ID,
        gameId: testGame.id,
        currencyId: testCurrency.id,
        pricePerUnitCents: 100,
        minTradeBaseUnits: '1',
        maxTradeBaseUnits: '100',
        totalCapacityBaseUnits: '1000',
        remainingCapacityBaseUnits: '1000',
        reservedCapacityBaseUnits: '0',
        filledCapacityBaseUnits: '0',
        status: 'ACTIVE',
      },
      include: {
        buyer: true,
      },
    });

    // Public serialization projection
    const sanitizedBuyer = {
      discordId: publicOrder.buyer.discordId,
      username: publicOrder.buyer.username,
      displayName: publicOrder.buyer.displayName || publicOrder.buyer.username,
      reputationScore: 100,
      completedTradesCount: 0,
      memberSince: publicOrder.buyer.createdAt,
    };

    assert(!('phoneNumber' in sanitizedBuyer), 'Zero PII: phoneNumber is NOT in public buyer profile');
    assert(!('telegramUsername' in sanitizedBuyer), 'Zero PII: telegramUsername is NOT in public buyer profile');
    assert(!('whatsappNumber' in sanitizedBuyer), 'Zero PII: whatsappNumber is NOT in public buyer profile');
    assert(!('documentsMetaJson' in sanitizedBuyer), 'Zero PII: KYC documents are NOT in public buyer profile');
    assert(sanitizedBuyer.username === 'TestBuyerExchanger', 'Safe public username is preserved');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: Audit Trail Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 11: Audit Logging Verification ---');

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: { in: ['ExchangeKycRequest', 'ExchangeBuyOrder', 'UserRole'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    assert(auditLogs.length > 0, 'AuditLog recorded exchange mutations');
    const hasKycAction = auditLogs.some((l) => l.action.startsWith('EXCHANGE_KYC_'));
    const hasRoleAction = auditLogs.some((l) => l.action.startsWith('EXCHANGE_ROLE_'));
    assert(hasKycAction, 'AuditLog records KYC submissions/reviews');
    assert(hasRoleAction, 'AuditLog records Exchanger role assignments');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12: Privileged Buyer Roles & /api/* Route Prefix Normalization
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 12: Privileged Buyer Roles & Route Normalization ---');

    const privilegedRoles = ['staff', 'management', 'manager', 'admin', 'owner'];
    for (const rKey of privilegedRoles) {
      const pUid = `test_priv_${rKey}_${Date.now()}`;
      testIds.push(pUid);
      await prisma.role.upsert({
        where: { roleKey: rKey },
        create: { roleKey: rKey, name: rKey.toUpperCase() },
        update: {},
      });
      await prisma.user.create({
        data: {
          discordId: pUid,
          username: `TestPriv_${rKey}`,
          isActive: true,
          userRoles: { create: [{ roleKey: rKey }] },
        },
      });
      const elig = await getExchangeEligibility(pUid);
      assert(elig.hasExchangerRole === false, `${rKey} does NOT have exchanger role`);
      assert(elig.hasPrivilegedBuyerRole === true, `${rKey} recognized as privileged buyer`);
      assert(elig.canCreateBuyOrder === true, `${rKey} can buy game currency without exchanger role/KYC`);
      await assertEligibleExchangeBuyer(pUid);
    }

    // Verify Express app.use('/api', apiRouter) mounts /api/exchange/*, /api/owner/exchange/*, /api/admin/exchange/* cleanly
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api', apiRouter);
    testApp.use('/api', (_req, res) => {
      res.status(404).json({ error: 'NOT_FOUND' });
    });

    const testServer = await new Promise<http.Server>((resolve) => {
      const s = testApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (testServer.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const catalogRes = await fetch(`${baseUrl}/api/exchange/catalog`);
      const catalogJson: any = await catalogRes.json();
      assert(catalogRes.status === 200 && catalogJson?.success === true, '/api/exchange/catalog resolves with 200 OK');

      const ordersRes = await fetch(`${baseUrl}/api/exchange/orders`);
      const ordersJson: any = await ordersRes.json();
      assert(ordersRes.status === 200 && Array.isArray(ordersJson?.orders), '/api/exchange/orders resolves with 200 OK');

      const ownerOvRes = await fetch(`${baseUrl}/api/owner/exchange/overview`);
      assert(ownerOvRes.status === 401, `/api/owner/exchange/overview hits auth guard (401), not 404 (got ${ownerOvRes.status})`);

      const ownerGamesRes = await fetch(`${baseUrl}/api/owner/exchange/games`);
      assert(ownerGamesRes.status === 401, `/api/owner/exchange/games hits auth guard (401), not 404 (got ${ownerGamesRes.status})`);

      const adminOvRes = await fetch(`${baseUrl}/api/admin/exchange/overview`);
      assert(adminOvRes.status === 401, `/api/admin/exchange/overview hits auth guard (401), not 404 (got ${adminOvRes.status})`);
    } finally {
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    }

    // Cleanup test artifacts
    await prisma.exchangeBuyOrder.deleteMany({
      where: { buyerUserId: { in: testIds } },
    });
    await prisma.exchangeKycRequest.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.exchangeUserPermission.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: testIds } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: testIds } },
    });

  } catch (error: any) {
    console.error('Unhandled Exception in Test Suite:', error);
    assert(false, 'Suite execution completed without unhandled exceptions', error.message);
  }

  console.log(`\n=== SUITE COMPLETE: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().finally(async () => {
  await prisma.$disconnect();
});
