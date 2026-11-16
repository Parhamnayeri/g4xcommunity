/**
 * scripts/cleanup-test-financials.ts
 *
 * Dedicated tool to safely clean up test orders, test withdrawals, and their financial impacts.
 *
 * Usage:
 *   # 1. Preview test records without deleting (Dry Run):
 *   npx ts-node scripts/cleanup-test-financials.ts --dry-run
 *
 *   # 2. Delete test withdrawal requests (e.g. WDR_TEST_*, WDR-STG-*):
 *   npx ts-node scripts/cleanup-test-financials.ts --clean-withdrawals
 *
 *   # 3. Delete automated test orders:
 *   npx ts-node scripts/cleanup-test-financials.ts --clean-test-orders
 *
 *   # 4. Clean specific order by ID or Ref:
 *   npx ts-node scripts/cleanup-test-financials.ts --orderId 1794759568
 *   npx ts-node scripts/cleanup-test-financials.ts --orderRef G4X-SKY-rep_p3_mwicm1cc
 *
 *   # 5. Clean specific withdrawal by ID or Ref:
 *   npx ts-node scripts/cleanup-test-financials.ts --withdrawalId 115
 *   npx ts-node scripts/cleanup-test-financials.ts --withdrawalRef WDR_TEST_1_1794771138485
 *
 *   # 6. Reset all test financial transactions and platform balances:
 *   npx ts-node scripts/cleanup-test-financials.ts --all-test
 */

import prisma from '../src/database/db';

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.length === 0;
  const cleanWithdrawals = args.includes('--clean-withdrawals') || args.includes('--all-test');
  const cleanOrders = args.includes('--clean-test-orders') || args.includes('--all-test');
  const resetFinancialTestData = args.includes('--reset-financial-test-data') || args.includes('--all-test');

  const orderIdArgIdx = args.indexOf('--orderId');
  const specificOrderId = orderIdArgIdx !== -1 && args[orderIdArgIdx + 1] ? parseInt(args[orderIdArgIdx + 1], 10) : null;

  const orderRefArgIdx = args.indexOf('--orderRef');
  const specificOrderRef = orderRefArgIdx !== -1 && args[orderRefArgIdx + 1] ? args[orderRefArgIdx + 1] : null;

  const withdrawalIdArgIdx = args.indexOf('--withdrawalId');
  const specificWdrId = withdrawalIdArgIdx !== -1 && args[withdrawalIdArgIdx + 1] ? parseInt(args[withdrawalIdArgIdx + 1], 10) : null;

  const withdrawalRefArgIdx = args.indexOf('--withdrawalRef');
  const specificWdrRef = withdrawalRefArgIdx !== -1 && args[withdrawalRefArgIdx + 1] ? args[withdrawalRefArgIdx + 1] : null;

  console.log('===========================================================');
  console.log(`🧹 G4X FINANCIAL SYSTEM TEST DATA CLEANUP UTILITY`);
  console.log(`MODE: ${isDryRun ? 'DRY-RUN (Preview only, no changes applied)' : 'LIVE EXECUTION (Modifying database)'}`);
  console.log('===========================================================\n');

  if (isDryRun && !specificOrderId && !specificOrderRef && !specificWdrId && !specificWdrRef && !cleanWithdrawals && !cleanOrders && !resetFinancialTestData) {
    console.log('💡 Tip: Run with specific flags to execute actions. Examples:');
    console.log('   --dry-run                     (Preview what would be affected)');
    console.log('   --clean-withdrawals           (Delete all test booster withdrawals)');
    console.log('   --clean-test-orders           (Delete automated test orders)');
    console.log('   --orderId <id>                (Delete single order by ID)');
    console.log('   --orderRef <ref>              (Delete single order by OrderRef)');
    console.log('   --withdrawalId <id>           (Delete single withdrawal by ID)');
    console.log('   --withdrawalRef <ref>         (Delete single withdrawal by Ref)');
    console.log('   --all-test                    (Delete all test orders, withdrawals, and test platform records)\n');
  }

  // ---------------------------------------------------------------------------
  // 1. TARGET WITHDRAWALS
  // ---------------------------------------------------------------------------
  let targetWithdrawals: Array<{ id: number; withdrawalRef: string; boosterId: string; requestedUsdCents: number; status: string }> = [];

  if (specificWdrId) {
    const w = await prisma.boosterWithdrawalRequest.findUnique({ where: { id: specificWdrId } });
    if (w) targetWithdrawals.push(w);
  } else if (specificWdrRef) {
    const w = await prisma.boosterWithdrawalRequest.findUnique({ where: { withdrawalRef: specificWdrRef } });
    if (w) targetWithdrawals.push(w);
  } else if (cleanWithdrawals || isDryRun) {
    targetWithdrawals = await prisma.boosterWithdrawalRequest.findMany({
      where: {
        OR: [
          { withdrawalRef: { startsWith: 'WDR_TEST' } },
          { withdrawalRef: { startsWith: 'WDR-STG' } },
          { boosterId: { startsWith: 'user_dash_test' } },
          { boosterId: { startsWith: '99999999999999' } },
        ],
      },
    });
  }

  console.log(`📌 Found ${targetWithdrawals.length} Target Test Withdrawals:`);
  targetWithdrawals.forEach((w) => {
    console.log(`   - [ID: ${w.id}] ${w.withdrawalRef} | Booster: ${w.boosterId} | Status: ${w.status} | Amount: $${(w.requestedUsdCents / 100).toFixed(2)}`);
  });

  if (!isDryRun && (cleanWithdrawals || specificWdrId || specificWdrRef)) {
    for (const w of targetWithdrawals) {
      // Release wallet reserve if reserved
      if (['REQUESTED', 'RESERVED', 'PROCESSING', 'QUOTED'].includes(w.status)) {
        await prisma.walletV2.updateMany({
          where: { userId: w.boosterId },
          data: {
            reservedCents: { decrement: w.requestedUsdCents },
          },
        });
      }
      // Delete ledger links and withdrawal
      await prisma.ledgerEntryV2.deleteMany({ where: { withdrawalRequestId: w.id } });
      await prisma.boosterWithdrawalRequest.delete({ where: { id: w.id } });
      console.log(`   ✅ Deleted withdrawal request [ID: ${w.id}] and adjusted wallet reserve.`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. TARGET ORDERS
  // ---------------------------------------------------------------------------
  let targetOrders: Array<{ id: number; orderRef: string; grossAmountMinor: number; status: string; sourceWebsite: string | null }> = [];

  if (specificOrderId) {
    const o = await prisma.order.findUnique({ where: { id: specificOrderId } });
    if (o) targetOrders.push(o);
  } else if (specificOrderRef) {
    const o = await prisma.order.findUnique({ where: { orderRef: specificOrderRef } });
    if (o) targetOrders.push(o);
  } else if (cleanOrders || isDryRun) {
    targetOrders = await prisma.order.findMany({
      where: {
        OR: [
          { orderRef: { startsWith: 'TEST-' } },
          { orderRef: { contains: 'rep_p3_' } },
          { orderRef: { startsWith: 'ORD_DUMMY' } },
          { orderRef: { startsWith: 'ORD_PF' } },
          { orderRef: { startsWith: 'ORD-ACTIVE-1' } },
          { orderRef: { startsWith: 'G4X-TEST-' } },
          { orderRef: { startsWith: 'G4X-STG-' } },
          { creatorId: { startsWith: 'test_' } },
          { customerId: { startsWith: 'test_' } },
        ],
      },
    });
  }

  console.log(`\n📌 Found ${targetOrders.length} Target Test Orders:`);
  targetOrders.slice(0, 20).forEach((o) => {
    console.log(`   - [ID: ${o.id}] ${o.orderRef} | Source: ${o.sourceWebsite} | Status: ${o.status} | Amount: $${(o.grossAmountMinor / 100).toFixed(2)}`);
  });
  if (targetOrders.length > 20) {
    console.log(`   ... and ${targetOrders.length - 20} more test orders`);
  }

  if (!isDryRun && (cleanOrders || specificOrderId || specificOrderRef)) {
    const orderIds = targetOrders.map((o) => o.id);
    if (orderIds.length > 0) {
      await prisma.orderFinancialSnapshot.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.boosterPayoutAllocation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderWithdrawalAllocation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderPresign.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderAssignment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderRequiredRole.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderKeyRequirement.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderRun.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.boosterReservation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderChannel.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderDispute.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.escrowHold.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.g4XBoostReleaseTracker.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.advertiserOrderMetadata.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.platformAccountTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.ledgerEntryV2.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.paymentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.financialTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      console.log(`   ✅ Deleted ${orderIds.length} test orders and all child records.`);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. FINANCIAL ACCOUNTS & TRANSACTIONS RESET
  // ---------------------------------------------------------------------------
  if (resetFinancialTestData || isDryRun) {
    const testAccounts = await prisma.financialAccount.findMany({
      where: {
        OR: [
          { name: { contains: 'Test' } },
          { name: { contains: 'P5' } },
          { name: { contains: 'Phase' } },
        ],
      },
      select: { id: true, name: true, currentBalance: true, currency: true },
    });

    console.log(`\n📌 Found ${testAccounts.length} Test Financial Accounts:`);
    testAccounts.forEach((acc) => {
      console.log(`   - [ID: ${acc.id}] ${acc.name} | Balance: ${acc.currentBalance} ${acc.currency}`);
    });

    if (!isDryRun && resetFinancialTestData) {
      for (const acc of testAccounts) {
        await prisma.financialLedgerEntry.deleteMany({ where: { accountId: acc.id } });
        await prisma.financialTransaction.deleteMany({ where: { accountId: acc.id } });
        await prisma.internalTransfer.deleteMany({
          where: { OR: [{ sourceAccountId: acc.id }, { destinationAccountId: acc.id }] },
        });
        await prisma.platformWithdrawal.deleteMany({ where: { sourceAccountId: acc.id } });
        await prisma.financialAccount.delete({ where: { id: acc.id } });
        console.log(`   ✅ Deleted test financial account: ${acc.name}`);
      }

      // Re-align PlatformAccount balances to 0 for cleanly resetting test credits
      await prisma.platformAccount.updateMany({
        data: {
          salesCreditedMinor: 0,
          pendingReleaseMinor: 0,
          eligibleBalanceMinor: 0,
          reservedBatchMinor: 0,
          withdrawnTotalMinor: 0,
          receivedTotalMinor: 0,
        },
      });
      console.log('   ✅ Reset all external PlatformAccount balances to clean zero baseline.');
    }
  }

  console.log('\n===========================================================');
  if (isDryRun) {
    console.log('🔍 DRY RUN COMPLETE. No data was modified.');
    console.log('To apply these deletions for real, run with:');
    console.log('   npx ts-node scripts/cleanup-test-financials.ts --clean-withdrawals');
    console.log('   npx ts-node scripts/cleanup-test-financials.ts --clean-test-orders');
    console.log('   npx ts-node scripts/cleanup-test-financials.ts --all-test');
  } else {
    console.log('🎉 CLEANUP COMPLETED SUCCESSFULLY. Financial metrics have been updated.');
  }
  console.log('===========================================================\n');
}

main()
  .catch((err) => {
    console.error('Error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
