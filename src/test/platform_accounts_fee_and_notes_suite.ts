/**
 * src/test/platform_accounts_fee_and_notes_suite.ts
 *
 * Verifies:
 *  1. Default Platform Accounts auto-creation & auto-selection (G2G, SkyCoach, Eldorado, Kingboost, Overgear).
 *  2. <#ORDERID> auto-extraction and clean notes parsing across backend and frontend.
 *  3. 13% fee cut deduction on SkyCoach, Kingboost, and Overgear.
 *  4. Preservation of G2G and Eldorado fee logic.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Ensure staging environment variables are loaded if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  const stagingEnv = path.resolve(__dirname, '../../.env.staging');
  if (fs.existsSync(stagingEnv)) {
    dotenv.config({ path: stagingEnv, override: true });
  } else {
    dotenv.config();
  }
}

import prisma from '../database/db';
import {
  extractExternalOrderIdAndCleanNotes,
  calculate13PercentSplit,
  has13PercentFee,
} from '../services/orderParsingUtils';
import { validateExternalOrderSource, SUPPORTED_SOURCE_PLATFORMS } from '../services/platformOrderService';
import { validateExternalOrderDefensibleNet } from '../services/financialCalculationEngine';
import { seedStandardFeePolicies } from '../services/financialPolicyService';

async function runTests() {
  console.log('🧪 Starting Platform Accounts, Order ID Extraction, and 13% Fee Cut Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // ── TEST GROUP 1: <#ORDERID> Extraction & Notes Cleaning ──
  console.log('── Test Group 1: Notes & Order ID Extraction ──');
  {
    const r1 = extractExternalOrderIdAndCleanNotes('<#JC100>');
    assert(r1.externalOrderId === 'JC100', 'Extracts exact ID from single tag: JC100');
    assert(r1.cleanNotes === null, 'Strips tag leaving null notes when no extra text');

    const r2 = extractExternalOrderIdAndCleanNotes('Fast run please <#ORD-9923> urgent');
    assert(r2.externalOrderId === 'ORD-9923', 'Extracts embedded ID from middle of notes: ORD-9923');
    assert(r2.cleanNotes === 'Fast run please urgent', 'Cleans whitespace around tag in notes');

    const r3 = extractExternalOrderIdAndCleanNotes('Some notes <#OLD1>', 'EXPLICIT-99');
    assert(r3.externalOrderId === 'EXPLICIT-99', 'Explicit order ID takes precedence over embedded tag');
    assert(r3.cleanNotes === 'Some notes', 'Strips embedded tag even when explicit order ID is provided');

    const r4 = extractExternalOrderIdAndCleanNotes('Just ordinary notes without tag');
    assert(r4.externalOrderId === null, 'Returns null externalOrderId when no tag is present and no explicit ID');
    assert(r4.cleanNotes === 'Just ordinary notes without tag', 'Preserves clean notes as-is');

    const r5 = extractExternalOrderIdAndCleanNotes(null, 'MANUAL-1');
    assert(r5.externalOrderId === 'MANUAL-1', 'Accepts explicit order ID when notes is null');
    assert(r5.cleanNotes === null, 'Preserves null notes');
  }

  // ── TEST GROUP 2: Supported Platforms & Default Platform Account Auto-Resolution ──
  console.log('\n── Test Group 2: Supported Platforms & Default Platform Account Auto-Resolution ──');
  await seedStandardFeePolicies();
  {
    const expectedPlatforms = ['g2g', 'skycoach', 'eldorado', 'kingboost', 'overgear'];
    for (const plat of expectedPlatforms) {
      assert(SUPPORTED_SOURCE_PLATFORMS.includes(plat as any), `SUPPORTED_SOURCE_PLATFORMS includes '${plat}'`);

      // Test validateExternalOrderSource without explicit account ID or ref
      try {
        const acct = await validateExternalOrderSource({ sourcePlatform: plat });
        assert(
          acct !== null && acct.platform.toLowerCase() === plat,
          `validateExternalOrderSource auto-resolves/seeds active account for '${plat}': ${acct.accountRef}`
        );
      } catch (err: any) {
        assert(false, `validateExternalOrderSource failed for '${plat}': ${err.message}`);
      }
    }
  }

  // ── TEST GROUP 3: 13% Fee Cut Calculation for SkyCoach, Kingboost, Overgear ──
  console.log('\n── Test Group 3: 13% Fee Cut Rules & Defensible Net ──');
  {
    // Frontend helper tests
    assert(has13PercentFee('skycoach'), 'Frontend: skycoach is 13% fee platform');
    assert(has13PercentFee('kingboost'), 'Frontend: kingboost is 13% fee platform');
    assert(has13PercentFee('overgear'), 'Frontend: overgear is 13% fee platform');
    assert(!has13PercentFee('g2g'), 'Frontend: g2g is NOT 13% fee platform');
    assert(!has13PercentFee('eldorado'), 'Frontend: eldorado is NOT 13% fee platform');

    const split = calculate13PercentSplit(100);
    assert(split.platformFee === 13.0, 'Frontend: $100 gross -> $13.00 fee');
    assert(split.netAvailable === 87.0, 'Frontend: $100 gross -> $87.00 net available');

    // Backend defensible net tests for 13% platforms
    const platforms13 = ['skycoach', 'kingboost', 'overgear'] as const;
    for (const plat of platforms13) {
      // 1. Defensible allocation (Gross $100 = 10000 cents, 13% fee = 1300 cents, net = 8700 cents)
      const valid = await validateExternalOrderDefensibleNet({
        platform: plat,
        grossMinor: 10000,
        boosterPoolMinor: 8700,
      });
      assert(valid.isDefensible, `${plat}: $87 booster pool on $100 gross is defensible`);
      assert(valid.platformCommissionMinor === 1300, `${plat}: 13% commission is 1300 minor units ($13.00)`);
      assert(valid.platformNetMinor === 8700, `${plat}: 87% net available is 8700 minor units ($87.00)`);

      // 2. Excessive booster pool rejection
      let rejected = false;
      try {
        await validateExternalOrderDefensibleNet({
          platform: plat,
          grossMinor: 10000,
          boosterPoolMinor: 8701, // 1 cent over 87% net
        });
      } catch (err: any) {
        rejected = err.message.includes('EXCESSIVE_BOOSTER_POOL');
      }
      assert(rejected, `${plat}: rejects booster pool exceeding post-13% net amount ($87.01 > $87.00)`);
    }

    // ── TEST GROUP 4: G2G and Eldorado Fee Integrity ──
    console.log('\n── Test Group 4: G2G and Eldorado Fee Calculation Unchanged ──');
    {
      const g2gRes = await validateExternalOrderDefensibleNet({
        platform: 'g2g',
        grossMinor: 10000,
        boosterPoolMinor: 9101, // 8.99% fee is 899 cents -> net = 9101 cents
      });
      assert(g2gRes.isDefensible, 'G2G: 8.99% seller fee preserved ($91.01 net on $100 gross)');
      assert(g2gRes.platformCommissionMinor === 899, 'G2G: platform commission is 899 minor units');

      const eldRes = await validateExternalOrderDefensibleNet({
        platform: 'eldorado',
        grossMinor: 10000,
        boosterPoolMinor: 9850, // 1.5% fee is 150 cents -> net = 9850 cents
        gameSlug: 'wow',
        listingCategory: 'currency',
      });
      assert(eldRes.isDefensible, 'Eldorado: 1.5% currency fee preserved ($98.50 net on $100 gross)');
      assert(eldRes.platformCommissionMinor === 150, 'Eldorado: platform commission is 150 minor units');
    }
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
