/**
 * src/test/nowpayments_v1_telemetry_and_webhook_suite.ts
 *
 * Dedicated verification suite for:
 * 1. Recursive canonical key sorting and HMAC-SHA512 IPN signature calculation
 * 2. Constant-time timingSafeEqual validation
 * 3. Gateway status normalization mapping
 * 4. Atomic, idempotent DepositIntent balance crediting
 */

import crypto from 'crypto';
import prisma from '../database/db';
import {
  NowPaymentsService,
  sortObjectKeysRecursively,
  mapGatewayStatusToInternal,
} from '../services/nowPaymentsService';

async function runSuite() {
  console.log('=== STARTING NOWPAYMENTS API V1 & DEPOSIT TELEMETRY SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  const testSecret = 'TEST_NOWPAYMENTS_IPN_SECRET_12345';
  const service = new NowPaymentsService({
    apiKey: 'test-api-key',
    ipnSecret: testSecret,
    isSandbox: true,
  });

  // 1. Recursive key sorting test
  const unordered = {
    z_key: 1,
    a_key: {
      nested_b: 'hello',
      nested_a: 'world',
    },
    m_key: [3, 2, 1],
  };
  const sorted = sortObjectKeysRecursively(unordered);
  const keys = Object.keys(sorted);
  const nestedKeys = Object.keys(sorted.a_key);
  assert(
    keys[0] === 'a_key' && keys[1] === 'm_key' && keys[2] === 'z_key' &&
    nestedKeys[0] === 'nested_a' && nestedKeys[1] === 'nested_b',
    '1. Recursive alphabetical key sorter produces deterministic canonical JSON'
  );

  // 2. HMAC-SHA512 verification test
  const ipnPayload = {
    payment_id: 123456789,
    invoice_id: 987654321,
    payment_status: 'finished',
    pay_address: '0x1234567890abcdef',
    price_amount: 50.0,
    price_currency: 'usd',
    actually_paid: 50.01,
    pay_amount: 50.0,
    pay_currency: 'usdtbsc',
    order_id: '99999',
  };

  const serialized = JSON.stringify(sortObjectKeysRecursively(ipnPayload));
  const validSig = crypto.createHmac('sha512', testSecret).update(serialized).digest('hex');

  const isValid = service.verifyIpnSignature(ipnPayload, validSig);
  assert(isValid === true, '2. Valid HMAC-SHA512 signature is verified successfully');

  const isInvalid = service.verifyIpnSignature(ipnPayload, 'deadbeef123456');
  assert(isInvalid === false, '3. Invalid HMAC-SHA512 signature is strictly rejected');

  const tamperedPayload = { ...ipnPayload, actually_paid: 0.0 };
  const isTampered = service.verifyIpnSignature(tamperedPayload, validSig);
  assert(isTampered === false, '4. Tampered payload with valid original signature is strictly rejected');

  // 3. Status mapping test
  assert(mapGatewayStatusToInternal('finished') === 'CONFIRMED', '5. Gateway status finished -> CONFIRMED');
  assert(mapGatewayStatusToInternal('partially_paid') === 'PARTIALLY_PAID', '6. Gateway status partially_paid -> PARTIALLY_PAID');
  assert(mapGatewayStatusToInternal('confirming') === 'PROCESSING', '7. Gateway status confirming -> PROCESSING');
  assert(mapGatewayStatusToInternal('sending') === 'PROCESSING', '8. Gateway status sending -> PROCESSING');
  assert(mapGatewayStatusToInternal('expired') === 'EXPIRED', '9. Gateway status expired -> EXPIRED');
  assert(mapGatewayStatusToInternal('failed') === 'FAILED', '10. Gateway status failed -> FAILED');
  assert(mapGatewayStatusToInternal('waiting') === 'WAITING', '11. Gateway status waiting -> WAITING');

  // 4. Atomic crediting & idempotency test
  const testUserId = `test_np_user_${Date.now()}`;
  try {
    // Setup test user
    await prisma.user.create({
      data: {
        discordId: testUserId,
        username: 'TestNowPaymentsUser',
        advertiserRank: 'BRONZE',
      },
    });

    const testDeposit = await prisma.depositIntent.create({
      data: {
        intentRef: `DEP_TEST_${Date.now()}`,
        userId: testUserId,
        amountUsd: 100.0,
        payCurrency: 'USDTTRC20',
        status: 'WAITING',
        gatewayStatus: 'waiting',
      },
    });

    // First credit execution
    const creditRes1 = await service.creditDepositAtomic(testDeposit.id, 100.0, 'test_actor', 'Test initial credit');
    assert(creditRes1.success === true && creditRes1.alreadyCredited === false, '12. Initial atomic credit execution succeeds');
    assert(creditRes1.wallet?.availableBalance === 100.0, '13. User wallet balance credited accurately ($100.00 USD)');

    // Verify DepositIntent is updated
    const updatedDep = await prisma.depositIntent.findUnique({ where: { id: testDeposit.id } });
    assert(updatedDep?.status === 'CONFIRMED' && updatedDep?.gatewayStatus === 'finished' && updatedDep?.creditedAt !== null, '14. DepositIntent updated with CONFIRMED, finished, and creditedAt');
    assert(Boolean(updatedDep?.creditedLedgerId), '15. DepositIntent persists immutable creditedLedgerId');

    // Idempotent second credit execution
    const creditRes2 = await service.creditDepositAtomic(testDeposit.id, 100.0, 'test_actor', 'Test second duplicate credit');
    assert(creditRes2.success === true && creditRes2.alreadyCredited === true, '16. Duplicate credit call is strictly idempotent (alreadyCredited = true)');

    const finalWallet = await prisma.wallet.findUnique({ where: { userId: testUserId } });
    assert(finalWallet?.balanceUsd === 10000, '17. Balance remains strictly 10000 cents (no double crediting)');

    // Clean up
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: testUserId } });
    await prisma.ledgerTransaction.deleteMany({ where: { userId: testUserId } });
    await prisma.auditLog.deleteMany({ where: { entityId: String(testDeposit.id) } });
    await prisma.depositIntent.delete({ where: { id: testDeposit.id } });
    await prisma.walletV2.deleteMany({ where: { userId: testUserId } });
    await prisma.wallet.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { discordId: testUserId } });
    console.log('Test artifacts cleanly purged.');
  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`SUITE FINISHED: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Fatal test error:', err);
    prisma.$disconnect();
    process.exit(1);
  });
