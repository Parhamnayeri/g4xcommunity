import assert from 'assert';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

if (!process.env.DATABASE_URL) {
  const stagingEnv = path.resolve(__dirname, '../../.env.staging');
  if (fs.existsSync(stagingEnv)) {
    dotenv.config({ path: stagingEnv, override: true });
  } else {
    dotenv.config();
  }
}

import prisma from '../database/db';
import { calculateOrderFinancialSnapshot } from '../services/financialCalculationEngine';
import { createExternalOrder } from '../services/platformOrderService';

async function runTestSuite() {
  console.log('=== STARTING BOOSTER POOL PRESERVATION & ORDER CREATION TEST SUITE ===\n');

  // Find or create an active game and service for testing
  const game = await prisma.game.findFirst({
    where: { isActive: true },
    include: { services: true },
  });
  if (!game || game.services.length === 0) {
    throw new Error('Must have at least one active game with a service for testing');
  }
  const service = game.services[0];
  const gameSlug = game.slug;
  const serviceId = service.id;

  const testOrderRefPrefix = `TEST_BP_${Date.now()}`;
  const adminId = `test_bp_admin_${Date.now()}`;

  await prisma.user.upsert({
    where: { discordId: adminId },
    update: { isActive: true },
    create: {
      discordId: adminId,
      username: 'test_bp_admin',
      isActive: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleKey: { userId: adminId, roleKey: 'owner' } },
    update: {},
    create: { userId: adminId, roleKey: 'owner' },
  });

  async function createFixtureOrder(suffix: string, grossMinor: number) {
    return prisma.order.create({
      data: {
        orderRef: `${testOrderRefPrefix}_${suffix}`,
        gameSlug,
        serviceId,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: grossMinor,
        status: 'pending',
        paymentStatus: 'verified',
      },
    });
  }

  try {
    // Test 1: Financial engine preserves explicit booster pool for external 13% platform (SkyCoach)
    console.log('Test 1: Financial engine preserves explicit booster pool on SkyCoach ($100 gross, $60 booster pool)...');
    const order1 = await createFixtureOrder('SKYCOACH', 10000);
    const skycoachSnapshot = await calculateOrderFinancialSnapshot({
      orderId: order1.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000, // $100.00
      currency: 'USD',
      explicitBoosterPoolMinor: 6000, // $60.00 entered by user
    });

    assert.strictEqual(skycoachSnapshot.grossSaleMinor, 10000, 'Gross sale should be 10000 cents ($100.00)');
    assert.strictEqual(skycoachSnapshot.platformSaleCommissionMinor, 1300, 'SkyCoach 13% commission should be 1300 cents ($13.00)');
    assert.strictEqual(skycoachSnapshot.externalNetBaseMinor, 8700, 'External net base should be 8700 cents ($87.00)');
    assert.strictEqual(skycoachSnapshot.boosterPoolMinor, 6000, 'Booster pool MUST be preserved at 6000 cents ($60.00), NOT overwritten with net base!');
    assert.strictEqual(skycoachSnapshot.g4xFeeMinor, 2700, 'Platform margin (g4xFee) should be 8700 - 6000 = 2700 cents ($27.00)');
    assert.strictEqual(
      skycoachSnapshot.platformSaleCommissionMinor + skycoachSnapshot.g4xFeeMinor + skycoachSnapshot.boosterPoolMinor,
      skycoachSnapshot.grossSaleMinor,
      'Financial snapshot components must sum exactly to gross sale (1300 + 2700 + 6000 = 10000)'
    );
    console.log('✅ [PASS] 1. Financial calculation engine preserves explicit booster pool and correctly computes platform margin\n');

    // Test 2: Financial engine preserves explicit booster pool for direct G4X orders
    console.log('Test 2: Financial engine preserves explicit booster pool on Direct G4X order ($100 gross, $75 booster pool)...');
    const order2 = await createFixtureOrder('DIRECT', 10000);
    const directSnapshot = await calculateOrderFinancialSnapshot({
      orderId: order2.id,
      sourcePlatform: 'direct',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
      explicitBoosterPoolMinor: 7500,
    });

    assert.strictEqual(directSnapshot.grossSaleMinor, 10000);
    assert.strictEqual(directSnapshot.platformSaleCommissionMinor, 0);
    assert.strictEqual(directSnapshot.boosterPoolMinor, 7500, 'Booster pool MUST be preserved at 7500 cents ($75.00)');
    assert.strictEqual(directSnapshot.g4xFeeMinor, 2500, 'Platform margin should be 2500 cents ($25.00)');
    assert.strictEqual(
      directSnapshot.g4xFeeMinor + directSnapshot.boosterPoolMinor,
      directSnapshot.grossSaleMinor
    );
    console.log('✅ [PASS] 2. Direct G4X orders cleanly separate booster reward pool and platform net revenue\n');

    // Test 3: Backward compatibility fallback when explicitBoosterPoolMinor is omitted
    console.log('Test 3: Backward compatibility fallback when explicitBoosterPoolMinor is omitted...');
    const order3 = await createFixtureOrder('FALLBACK', 10000);
    const defaultSnapshot = await calculateOrderFinancialSnapshot({
      orderId: order3.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      currency: 'USD',
    });
    assert.strictEqual(defaultSnapshot.boosterPoolMinor, 8700, 'When explicit pool is omitted, defaults to 100% of net base');
    assert.strictEqual(defaultSnapshot.g4xFeeMinor, 0);
    console.log('✅ [PASS] 3. Backward compatibility fallback defaults to net base when explicit pool is not provided\n');

    // Test 4: Validation guardrails in createExternalOrder
    console.log('Test 4: createExternalOrder input validation guardrails...');
    let errorExceedsCaught = false;
    try {
      await createExternalOrder({
        gameSlug: game.slug,
        serviceId: service.id,
        sourcePlatform: 'skycoach',
        sourceAmountType: 'gross_sale',
        externalOrderId: 'TEST_EXCEED',
        amountMinor: 10000,
        boosterPoolMinor: 15000, // Exceeds gross amount!
        currency: 'USD',
        title: 'Invalid Order Exceeding Pool',
        actorId: adminId,
      });
    } catch (err: any) {
      errorExceedsCaught = true;
      assert(err.message.includes('exceed'), `Expected exceed error message, got: ${err.message}`);
    }
    assert(errorExceedsCaught, 'createExternalOrder must reject boosterPoolMinor > amountMinor');

    let errorZeroCaught = false;
    try {
      await createExternalOrder({
        gameSlug: game.slug,
        serviceId: service.id,
        sourcePlatform: 'skycoach',
        sourceAmountType: 'gross_sale',
        externalOrderId: 'TEST_ZERO',
        amountMinor: 10000,
        boosterPoolMinor: 0, // <= 0
        currency: 'USD',
        title: 'Invalid Order Zero Pool',
        actorId: adminId,
      });
    } catch (err: any) {
      errorZeroCaught = true;
      assert(err.message.includes('positive'), `Expected positive error message, got: ${err.message}`);
    }
    assert(errorZeroCaught, 'createExternalOrder must reject boosterPoolMinor <= 0');
    console.log('✅ [PASS] 4. Strict validation guardrails reject negative, zero, or excessive booster pools\n');

    // Test 5: End-to-end order creation and database persistence
    console.log('Test 5: End-to-end order persistence with explicit booster pool in database...');
    const testExternalId = `SKY_${Date.now()}`;

    const result = await createExternalOrder({
      gameSlug: game.slug,
      serviceId: service.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      externalOrderId: testExternalId,
      amountMinor: 10000, // $100.00
      boosterPoolMinor: 6000, // $60.00 entered by user
      currency: 'USD',
      title: 'SkyCoach Mythic +10 Run',
      actorId: adminId,
    });

    // Verify in database: Order record
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: result.order.id },
      include: { financialSnapshot: true },
    });

    assert.strictEqual(dbOrder.boosterPoolMinor, 6000, `Database Order.boosterPoolMinor must be 6000 cents, found: ${dbOrder.boosterPoolMinor}`);
    assert.strictEqual(dbOrder.grossAmountMinor, 10000, 'Database Order.grossAmountMinor must be 10000 cents');
    assert.strictEqual(dbOrder.platformFeeMinor, 1300, 'Database Order.platformFeeMinor must be 1300 cents');

    // Verify in database: OrderFinancialSnapshot record
    assert(dbOrder.financialSnapshot, 'OrderFinancialSnapshot must be attached');
    assert.strictEqual(dbOrder.financialSnapshot.boosterPoolMinor, 6000, `Snapshot boosterPoolMinor must be 6000, found: ${dbOrder.financialSnapshot.boosterPoolMinor}`);
    assert.strictEqual(dbOrder.financialSnapshot.g4xFeeMinor, 2700, `Snapshot g4xFeeMinor (platform profit) must be 2700, found: ${dbOrder.financialSnapshot.g4xFeeMinor}`);
    assert.strictEqual(dbOrder.financialSnapshot.platformSaleCommissionMinor, 1300, 'Snapshot commission must be 1300');

    console.log('✅ [PASS] 5. Order and Financial Snapshot correctly persisted in database with exact booster pool and margin\n');
  } finally {
    // Clean up test orders
    const testOrders = await prisma.order.findMany({
      where: {
        OR: [
          { orderRef: { startsWith: testOrderRefPrefix } },
          { externalOrderId: { startsWith: 'SKY_' } },
        ],
      },
      select: { id: true },
    });
    for (const ord of testOrders) {
      await prisma.orderFinancialSnapshot.deleteMany({ where: { orderId: ord.id } });
      await prisma.order.delete({ where: { id: ord.id } });
    }
    await prisma.userRole.deleteMany({ where: { userId: adminId } });
    await prisma.user.deleteMany({ where: { discordId: adminId } });
  }

  console.log('======================================================');
  console.log('ALL BOOSTER POOL TESTS PASSED SUCCESSFULLY! (5/5)');
  console.log('======================================================\n');
}

runTestSuite()
  .catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
