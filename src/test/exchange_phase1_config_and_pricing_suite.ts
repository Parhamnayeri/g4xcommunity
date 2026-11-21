/**
 * src/test/exchange_phase1_config_and_pricing_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 1:
 *  1. Zero-Drift Integer Pricing Engine & Basis Points Math
 *  2. Min/Max USD Commission Clamping
 *  3. Idempotent Defaults Seeding (Regions, Delivery Methods, Fee Rules, Games)
 *  4. Strict Fee Resolution Hierarchy (Currency Override > Game Override > Global Default)
 *  5. Immutable Fee Rule Versioning
 *  6. Owner-Only RBAC & 403 Rejection for Non-Owners
 *  7. Audit Logging Verification
 */

import prisma from '../database/db';
import {
  calculateExchangeTradePricing,
  resolveActiveExchangeFeeRule,
  createVersionedExchangeFeeRule,
  ensureExchangeDefaults,
} from '../services/exchangeConfigService';
import { requireOwner } from '../web/exchangeConfigRoutes';
import { Request, Response, NextFunction } from 'express';

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
  console.log('=== STARTING G4X EXCHANGE PHASE 1 VERIFICATION SUITE ===\n');

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Pure Zero-Drift Pricing Math (Basis Points + Integer Cents)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Pricing Math & Basis Points Calculations ---');

    // 20,000,000 Gold at $0.85 per 100K with 1.00% buyer (100 bps) and 2.00% seller (200 bps)
    const calculation = calculateExchangeTradePricing({
      quantityBaseUnits: '20000000',
      unitMultiplier: '100000',
      pricePerUnitCents: 85, // $0.85
      feeRule: {
        id: 'RULE_TEST_1',
        version: 1,
        scope: 'GLOBAL',
        buyerCommissionBps: 100, // 1.00%
        sellerCommissionBps: 200, // 2.00%
        minCommissionCents: null,
        maxCommissionCents: null,
      },
    });

    assert(calculation.tradeUnits === '200', 'Trade units calculated correctly as 200', `Got ${calculation.tradeUnits}`);
    assert(calculation.grossCents === 17000, 'Gross cents calculated exactly as 17000 ($170.00)', `Got ${calculation.grossCents}`);
    assert(calculation.grossUsd === '170.00', 'Gross USD formatted correctly', `Got ${calculation.grossUsd}`);
    assert(calculation.buyerFeeCents === 170, 'Buyer fee calculated as exactly 170 cents (1.00% of $170.00 = $1.70)', `Got ${calculation.buyerFeeCents}`);
    assert(calculation.totalBuyerCents === 17170, 'Total buyer cents calculated as 17170 ($171.70)', `Got ${calculation.totalBuyerCents}`);
    assert(calculation.sellerFeeCents === 340, 'Seller fee calculated as exactly 340 cents (2.00% of $170.00 = $3.40)', `Got ${calculation.sellerFeeCents}`);
    assert(calculation.netSellerCents === 16660, 'Net seller cents calculated as 16660 ($166.60)', `Got ${calculation.netSellerCents}`);
    assert(calculation.cappedBuyerMin === false && calculation.cappedBuyerMax === false, 'Buyer caps not triggered');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Min / Max USD Fee Clamping
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Min / Max Commission Caps Clamping ---');

    // Case A: Min cap clamps buyer fee from $1.70 (170 cents) to $2.00 (200 cents)
    const clampedMinCalc = calculateExchangeTradePricing({
      quantityBaseUnits: '20000000',
      unitMultiplier: '100000',
      pricePerUnitCents: 85,
      feeRule: {
        buyerCommissionBps: 100,
        sellerCommissionBps: 200,
        minCommissionCents: 200, // $2.00 min cap
        maxCommissionCents: null,
      },
    });
    assert(clampedMinCalc.buyerFeeCents === 200, 'Buyer fee clamped up to minCommissionCents (200 cents)', `Got ${clampedMinCalc.buyerFeeCents}`);
    assert(clampedMinCalc.cappedBuyerMin === true, 'cappedBuyerMin flag is true');
    assert(clampedMinCalc.totalBuyerCents === 17200, 'Total buyer cents reflects min cap ($172.00)', `Got ${clampedMinCalc.totalBuyerCents}`);

    // Case B: Max cap clamps seller fee from $3.40 (340 cents) down to $3.00 (300 cents)
    const clampedMaxCalc = calculateExchangeTradePricing({
      quantityBaseUnits: '20000000',
      unitMultiplier: '100000',
      pricePerUnitCents: 85,
      feeRule: {
        buyerCommissionBps: 100,
        sellerCommissionBps: 200,
        minCommissionCents: null,
        maxCommissionCents: 300, // $3.00 max cap
      },
    });
    assert(clampedMaxCalc.sellerFeeCents === 300, 'Seller fee clamped down to maxCommissionCents (300 cents)', `Got ${clampedMaxCalc.sellerFeeCents}`);
    assert(clampedMaxCalc.cappedSellerMax === true, 'cappedSellerMax flag is true');
    assert(clampedMaxCalc.netSellerCents === 16700, 'Net seller reflects max cap ($167.00)', `Got ${clampedMaxCalc.netSellerCents}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Idempotent Defaults Seeder
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Idempotent Defaults Seeder ---');

    const firstSeed = await ensureExchangeDefaults();
    console.log(`First seed: ${JSON.stringify(firstSeed)}`);

    const secondSeed = await ensureExchangeDefaults();
    console.log(`Second seed (idempotency check): ${JSON.stringify(secondSeed)}`);

    assert(secondSeed.regionsSeeded === 0, 'No duplicate regions seeded on second run');
    assert(secondSeed.deliveryMethodsSeeded === 0, 'No duplicate delivery methods seeded on second run');
    assert(secondSeed.feeRulesSeeded === 0, 'No duplicate fee rules seeded on second run');
    assert(secondSeed.gamesSeeded === 0, 'No duplicate games seeded on second run');

    // Verify regions exist
    const euRegion = await prisma.exchangeRegion.findFirst({ where: { code: 'EU' } });
    assert(Boolean(euRegion), 'Europe (EU) region exists');

    // Verify delivery methods exist
    const tradeMethod = await prisma.exchangeDeliveryMethod.findUnique({ where: { code: 'IN_GAME_TRADE' } });
    assert(Boolean(tradeMethod), 'In-game trade delivery method exists');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Fee Resolution Hierarchy Precedence & Versioning
    // ─────────────────────────────────────────────────────────────────────────
    // Create a real test user for audit foreign key references
    const testOwnerId = `test_owner_${Date.now()}`;
    await prisma.user.create({
      data: {
        discordId: testOwnerId,
        username: 'TestExchangeOwner',
        userRoles: { create: [{ roleKey: 'owner' }] },
      },
    });

    // Create a temporary test game & currency
    const testGameSlug = `test_game_${Date.now()}`;
    const testGame = await prisma.exchangeGame.create({
      data: {
        slug: testGameSlug,
        name: 'Test Hierarchy Game',
        isActive: true,
      },
    });

    const testCurrency = await prisma.exchangeCurrency.create({
      data: {
        gameId: testGame.id,
        slug: 'test-gold',
        name: 'Test Gold',
        unitLabel: '100K Gold',
        unitMultiplier: '100000',
        minTradeBaseUnits: '100000',
        maxTradeBaseUnits: '10000000',
        isActive: true,
      },
    });

    // 4.1: When neither game nor currency has override, should resolve to GLOBAL
    const resolvedGlobal = await resolveActiveExchangeFeeRule({
      gameId: testGame.id,
      currencyId: testCurrency.id,
    });
    assert(resolvedGlobal.scope === 'GLOBAL', 'Resolves to GLOBAL scope when no overrides exist', `Got ${resolvedGlobal.scope}`);

    // 4.2: Create GAME override (buyer 75 bps, seller 150 bps)
    const gameRuleV1 = await createVersionedExchangeFeeRule({
      scope: 'GAME',
      gameId: testGame.id,
      buyerCommissionBps: 75,
      sellerCommissionBps: 150,
      createdByDiscordId: testOwnerId,
      reason: 'Game specific commission tier',
    });
    assert(gameRuleV1.version === 1, 'Game fee rule created as version 1');

    const resolvedGame = await resolveActiveExchangeFeeRule({
      gameId: testGame.id,
      currencyId: testCurrency.id,
    });
    assert(resolvedGame.scope === 'GAME' && resolvedGame.buyerCommissionBps === 75, 'GAME override takes priority over GLOBAL', `Got scope ${resolvedGame.scope}, buyer bps ${resolvedGame.buyerCommissionBps}`);

    // 4.3: Create CURRENCY override (buyer 50 bps, seller 100 bps)
    const currencyRuleV1 = await createVersionedExchangeFeeRule({
      scope: 'CURRENCY',
      currencyId: testCurrency.id,
      buyerCommissionBps: 50,
      sellerCommissionBps: 100,
      createdByDiscordId: testOwnerId,
      reason: 'Currency specific promotion',
    });
    assert(currencyRuleV1.version === 1, 'Currency fee rule created as version 1');

    const resolvedCurrency = await resolveActiveExchangeFeeRule({
      gameId: testGame.id,
      currencyId: testCurrency.id,
    });
    assert(resolvedCurrency.scope === 'CURRENCY' && resolvedCurrency.buyerCommissionBps === 50, 'CURRENCY override takes priority over GAME and GLOBAL', `Got scope ${resolvedCurrency.scope}, buyer bps ${resolvedCurrency.buyerCommissionBps}`);

    // 4.4: Versioning check: creating another rule increments version to v2
    const currencyRuleV2 = await createVersionedExchangeFeeRule({
      scope: 'CURRENCY',
      currencyId: testCurrency.id,
      buyerCommissionBps: 40,
      sellerCommissionBps: 80,
      createdByDiscordId: testOwnerId,
      reason: 'Upgraded currency promotion v2',
    });
    assert(currencyRuleV2.version === 2, 'New version created with incremented version 2', `Got version ${currencyRuleV2.version}`);

    // Verify v1 still exists in DB
    const allCurrencyRules = await prisma.exchangeFeeRule.findMany({
      where: { scope: 'CURRENCY', currencyId: testCurrency.id },
      orderBy: { version: 'asc' },
    });
    assert(allCurrencyRules.length === 2, 'Historical version v1 preserved alongside v2 (immutable versioning)');

    // 4.5: Disabling v2 falls back to v1
    await prisma.exchangeFeeRule.update({
      where: { id: currencyRuleV2.id },
      data: { isEnabled: false },
    });
    const fallbackToV1 = await resolveActiveExchangeFeeRule({
      gameId: testGame.id,
      currencyId: testCurrency.id,
    });
    assert(fallbackToV1.version === 1 && fallbackToV1.buyerCommissionBps === 50, 'Disabling v2 safely resolves back to active v1', `Got v${fallbackToV1.version}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Strict Owner RBAC Gate (403 for Non-Owners)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Security & Owner-Only RBAC Gate ---');

    // Non-owner mock
    let statusSet: number | null = null;
    let nextCalled: boolean = false;

    const mockNonOwnerReq = {
      user: {
        discordId: 'non_owner_123',
        userRoles: [{ roleKey: 'booster' }, { roleKey: 'admin' }],
      },
    } as any;

    const mockRes = {
      status: (code: number) => {
        statusSet = code;
        return {
          json: (_data: any) => {},
        };
      },
    } as any;

    const mockNext: NextFunction = () => {
      nextCalled = true;
    };

    requireOwner(mockNonOwnerReq, mockRes, mockNext);
    assert(statusSet === 403, 'Non-owner receives 403 Forbidden on owner mutating route', `Got ${statusSet}`);
    assert(!nextCalled, 'next() was not called for non-owner');

    // Owner mock
    statusSet = null;
    nextCalled = false;

    const mockOwnerReq = {
      user: {
        discordId: 'owner_user_777',
        userRoles: [{ roleKey: 'owner' }],
      },
    } as any;

    requireOwner(mockOwnerReq, mockRes, mockNext);
    assert(Boolean(nextCalled), 'Owner role successfully authorized (next called)');
    assert(statusSet === null, 'No error status returned for Owner');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Audit Logging Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Audit Logging Verification ---');

    const recentAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'ExchangeFeeRule',
        action: 'EXCHANGE_FEE_RULE_VERSION_CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    assert(Boolean(recentAudit), 'AuditLog record exists for ExchangeFeeRule mutation');
    assert(recentAudit?.actorId === testOwnerId, 'AuditLog correctly attributes actorDiscordId', `Got ${recentAudit?.actorId}`);
    assert(Boolean(recentAudit?.newValues), 'AuditLog contains serialized newValues JSON snapshot');

    // Clean up test game, currency, and test owner user
    await prisma.exchangeFeeRule.deleteMany({ where: { gameId: testGame.id } });
    await prisma.exchangeFeeRule.deleteMany({ where: { currencyId: testCurrency.id } });
    await prisma.exchangeCurrency.deleteMany({ where: { gameId: testGame.id } });
    await prisma.exchangeGame.delete({ where: { id: testGame.id } });
    await prisma.userRole.deleteMany({ where: { userId: testOwnerId } });
    await prisma.user.delete({ where: { discordId: testOwnerId } });
  } catch (error: any) {
    console.error('Unexpected suite failure:', error);
    failed++;
  }

  console.log(`\n==================================================`);
  console.log(`EXCHANGE PHASE 1 SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().then(() => {
  process.exit(0);
});
