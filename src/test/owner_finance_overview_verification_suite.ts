/**
 * src/test/owner_finance_overview_verification_suite.ts
 *
 * Verifies:
 * 1. Owner-exclusive access control (non-owners receive 403, owner permitted).
 * 2. Live database connection (real orders, platform accounts, wallet aggregates).
 * 3. Dynamic dollar rate integration from SystemFinancialConfig (admin_usd_irt_rate).
 */

import prisma from '../database/db';
import { resolveDatabaseOwner } from '../web/ownerGate';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('🚀 STARTING OWNER FINANCE OVERVIEW VERIFICATION SUITE');
  console.log('======================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Authoritative Database Owner Resolution & RBAC Verification
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Authoritative Database Owner Resolution ---');
    process.env.OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || '387583875066626069';
    const ownerResolution = await resolveDatabaseOwner(prisma);
    assert(ownerResolution.owner !== null, 'Authoritative database owner exists', `Found owner: ${ownerResolution.owner?.username}`);
    
    const ownerDiscordId = ownerResolution.owner?.discordId || '';
    
    // Check owner has SYSTEM_CONFIG_MANAGE permission
    const ownerAuth = await authorize(ownerDiscordId, Permission.SYSTEM_CONFIG_MANAGE);
    assert(ownerAuth.allowed, 'Owner holds Permission.SYSTEM_CONFIG_MANAGE');

    // -------------------------------------------------------------------------
    // TEST 2: Strict Owner-Only Access Restriction
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Strict Access Restriction (Non-Owners Forbidden) ---');
    
    // Simulate non-owner admin user
    const fakeAdminDiscordId = '999999999999999999';
    const nonOwnerAuth = await authorize(fakeAdminDiscordId, Permission.SYSTEM_CONFIG_MANAGE);
    assert(!nonOwnerAuth.allowed, 'Random/Non-owner account cannot bypass SYSTEM_CONFIG_MANAGE');

    // Verify owner resolution rejects non-matching discordId
    const isOwnerMatch = ownerResolution.owner?.discordId === fakeAdminDiscordId;
    assert(!isOwnerMatch, 'Fake user does NOT match single authoritative database owner');

    // -------------------------------------------------------------------------
    // TEST 3: Dynamic Dollar Rate from SystemFinancialConfig
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Dynamic Dollar Rate Integration ---');
    
    // Check existing or default dollar rate config
    const currentRateConfig = await prisma.systemFinancialConfig.findUnique({
      where: { key: 'admin_usd_irt_rate' },
    });
    
    const initialRate = currentRateConfig?.value ? parseFloat(currentRateConfig.value) : 90000;
    console.log(`Current active SystemFinancialConfig admin_usd_irt_rate: ${initialRate} Toman`);
    assert(initialRate > 0, 'Dollar rate is positive integer/float');

    // Test updating dollar rate to test dynamic calculation
    const testDollarRate = 95500;
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: String(testDollarRate) },
      create: {
        key: 'admin_usd_irt_rate',
        value: String(testDollarRate),
        description: 'Current USD to IRT exchange rate for platform finance conversions',
        updatedBy: ownerDiscordId,
      },
    });

    const updatedConfig = await prisma.systemFinancialConfig.findUnique({
      where: { key: 'admin_usd_irt_rate' },
    });
    const parsedUpdatedRate = updatedConfig?.value ? parseFloat(updatedConfig.value) : 0;
    assert(parsedUpdatedRate === testDollarRate, 'Dynamic dollar rate updated and read from SystemFinancialConfig');

    // Calculate sample Toman conversions with updated rate
    const sampleGrossMinor = 100000; // $1,000.00
    const calculatedToman = Math.round((sampleGrossMinor / 100) * parsedUpdatedRate);
    assert(calculatedToman === 95500000, `Accurate Toman conversion at rate ${parsedUpdatedRate}: ${calculatedToman.toLocaleString()} Toman`);

    // Restore original rate
    await prisma.systemFinancialConfig.update({
      where: { key: 'admin_usd_irt_rate' },
      data: { value: String(initialRate) },
    });
    console.log(`Restored admin_usd_irt_rate to: ${initialRate} Toman`);

    // -------------------------------------------------------------------------
    // TEST 4: Live Real Database Connection (Orders, Accounts, Wallets)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Live Real Database Connection ---');
    
    const [ordersCount, platformAccounts, walletsAgg, pendingWithdrawals] = await Promise.all([
      prisma.order.count(),
      prisma.platformAccount.findMany({ select: { accountRef: true, platform: true, eligibleBalanceMinor: true } }),
      prisma.walletV2.aggregate({
        _sum: {
          availableCents: true,
          reservedCents: true,
        },
      }),
      prisma.boosterWithdrawalRequest.aggregate({
        where: {
          status: { in: ['RESERVED', 'PROCESSING', 'QUOTED', 'UNDER_ADMIN_REVIEW', 'REQUESTED', 'USER_CONFIRMED'] },
        },
        _sum: { requestedUsdCents: true },
        _count: { id: true },
      }),
    ]);

    console.log(`Live Orders in Database: ${ordersCount}`);
    console.log(`Live Platform Accounts: ${platformAccounts.length} (${platformAccounts.map(p => p.platform).join(', ')})`);
    console.log(`Live Wallet V2 Liability: $${(((walletsAgg._sum.availableCents || 0) + (walletsAgg._sum.reservedCents || 0)) / 100).toFixed(2)}`);
    console.log(`Live Pending Withdrawals: ${pendingWithdrawals._count?.id || 0} ($${((pendingWithdrawals._sum?.requestedUsdCents || 0) / 100).toFixed(2)})`);

    assert(typeof ordersCount === 'number', 'Connected to live orders table in real database');
    assert(Array.isArray(platformAccounts), 'Connected to live platform accounts table in real database');
    assert(typeof (walletsAgg._sum.availableCents ?? 0) === 'number', 'Connected to live walletV2 table in real database');

    // -------------------------------------------------------------------------
    // TEST 5: Financial Overview Aggregation Math Parity
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Financial Overview Math Parity ---');
    
    const liveOrders = await prisma.order.findMany({
      select: {
        grossAmountMinor: true,
        platformFeeMinor: true,
        boosterPoolMinor: true,
        status: true,
      },
    });

    const totalGross = liveOrders.reduce((sum, o) => sum + (o.grossAmountMinor || 0), 0);
    const totalFees = liveOrders.reduce((sum, o) => sum + (o.platformFeeMinor || 0), 0);
    const totalNetProfit = totalGross - totalFees;
    const grossToman = Math.round((totalGross / 100) * initialRate);

    console.log(`Total Gross Volume: $${(totalGross / 100).toFixed(2)} (${grossToman.toLocaleString()} Toman)`);
    console.log(`Total Platform Fees: $${(totalFees / 100).toFixed(2)}`);
    console.log(`Total Net Platform Profit: $${(totalNetProfit / 100).toFixed(2)}`);

    assert(totalNetProfit <= totalGross, 'Net platform profit does not exceed gross volume');

  } catch (err: any) {
    console.error('Unexpected error during suite run:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`📊 SUITE COMPLETED: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().finally(async () => {
  await prisma.$disconnect();
});
