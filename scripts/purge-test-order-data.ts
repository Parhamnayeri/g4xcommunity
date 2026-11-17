/**
 * scripts/purge-test-order-data.ts
 *
 * Safe Test Data Purging Utility for G4X Financial System.
 * Safely removes test orders, test booster withdrawals, and reconciles balances
 * within an atomic transaction.
 *
 * Usage:
 *   npx ts-node scripts/purge-test-order-data.ts --list
 *   npx ts-node scripts/purge-test-order-data.ts --order=<ORDER_REF_OR_ID> [--dry-run]
 *   npx ts-node scripts/purge-test-order-data.ts --withdrawal=<WITHDRAWAL_REF_OR_ID> [--dry-run]
 *   npx ts-node scripts/purge-test-order-data.ts --prefix=TEST- [--dry-run]
 */

import prisma from '../src/database/db';

async function listRecentTestCandidates() {
  console.log('\n============================= RECENT ORDERS =============================');
  const orders = await prisma.order.findMany({
    take: 15,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderRef: true,
      title: true,
      status: true,
      grossAmountMinor: true,
      currency: true,
      sourceWebsite: true,
      createdAt: true,
    },
  });

  if (orders.length === 0) {
    console.log('No orders found.');
  } else {
    console.log('ID   | Order Ref            | Platform     | Status       | Amount    | Created At');
    console.log('---------------------------------------------------------------------------------');
    for (const o of orders) {
      const amt = `${(o.grossAmountMinor / 100).toFixed(2)} ${o.currency}`;
      console.log(
        `${String(o.id).padEnd(4)} | ${(o.orderRef || '').padEnd(20)} | ${(o.sourceWebsite || 'direct').padEnd(12)} | ${(o.status || '').padEnd(12)} | ${amt.padStart(9)} | ${o.createdAt.toISOString().slice(0, 16)}`
      );
    }
  }

  console.log('\n======================= RECENT BOOSTER WITHDRAWALS =======================');
  const withdrawals = await prisma.boosterWithdrawalRequest.findMany({
    take: 15,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      withdrawalRef: true,
      boosterId: true,
      payoutMethod: true,
      status: true,
      requestedUsdCents: true,
      quotedNetPayoutAmount: true,
      quotedCurrency: true,
      createdAt: true,
    },
  });

  if (withdrawals.length === 0) {
    console.log('No booster withdrawal requests found.');
  } else {
    console.log('ID   | Withdrawal Ref       | Booster ID           | Status     | Net Amount | Created At');
    console.log('---------------------------------------------------------------------------------');
    for (const w of withdrawals) {
      const amt = `${w.quotedNetPayoutAmount} ${w.quotedCurrency}`;
      console.log(
        `${String(w.id).padEnd(4)} | ${(w.withdrawalRef || '').padEnd(20)} | ${w.boosterId.padEnd(20)} | ${(w.status || '').padEnd(10)} | ${amt.padStart(10)} | ${w.createdAt.toISOString().slice(0, 16)}`
      );
    }
  }
  console.log('=========================================================================\n');
}

async function purgeOrder(orderIdentifier: string, dryRun: boolean) {
  const isNumeric = /^\d+$/.test(orderIdentifier.trim());
  const order = await prisma.order.findFirst({
    where: isNumeric ? { id: parseInt(orderIdentifier, 10) } : { orderRef: orderIdentifier.trim() },
    include: {
      financialSnapshot: true,
      platformTransactions: true,
      boosterPayoutAllocations: true,
      withdrawalAllocations: true,
      ledgerEntriesV2: true,
      platformAccount: true,
    },
  });

  if (!order) {
    console.error(`❌ Order not found matching '${orderIdentifier}'.`);
    return;
  }

  console.log(`\nFound Order #${order.id} (${order.orderRef}):`);
  console.log(`  - Title: ${order.title}`);
  console.log(`  - Status: ${order.status}`);
  console.log(`  - Gross: ${(order.grossAmountMinor / 100).toFixed(2)} ${order.currency}`);
  console.log(`  - Platform Account: ${order.platformAccount?.accountRef || 'None'}`);
  console.log(`  - Transactions: ${order.platformTransactions.length}`);
  console.log(`  - Financial Snapshot: ${order.financialSnapshot ? 'Present' : 'None'}`);
  console.log(`  - Booster Allocations: ${order.boosterPayoutAllocations.length}`);
  console.log(`  - Ledger Entries: ${order.ledgerEntriesV2.length}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] No database modifications made. Pass without --dry-run to purge.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Revert platform account balances if any were credited
    if (order.platformAccountId) {
      const platformAccount = await tx.platformAccount.findUnique({
        where: { id: order.platformAccountId },
      });
      if (platformAccount) {
        // Sum total credited transactions for this order
        const credited = order.platformTransactions
          .filter((t) => t.entryType === 'sale_credit')
          .reduce((sum, t) => sum + t.amountMinor, 0);

        const released = order.platformTransactions
          .filter((t) => t.entryType === 'platform_release')
          .reduce((sum, t) => sum + t.amountMinor, 0);

        if (credited > 0 || released > 0) {
          console.log(`  -> Adjusting platform account '${platformAccount.accountRef}' balances:`);
          const newSales = Math.max(0, platformAccount.salesCreditedMinor - credited);
          const newEligible = Math.max(0, platformAccount.eligibleBalanceMinor - released);
          const newPending = Math.max(0, platformAccount.pendingReleaseMinor - (credited - released));

          await tx.platformAccount.update({
            where: { id: platformAccount.id },
            data: {
              salesCreditedMinor: newSales,
              eligibleBalanceMinor: newEligible,
              pendingReleaseMinor: newPending,
            },
          });
          console.log(`     salesCredited: ${platformAccount.salesCreditedMinor} -> ${newSales}`);
          console.log(`     eligibleBalance: ${platformAccount.eligibleBalanceMinor} -> ${newEligible}`);
        }
      }
    }

    // 2. Delete child records
    await tx.boosterPayoutAllocation.deleteMany({ where: { orderId: order.id } });
    await tx.orderWithdrawalAllocation.deleteMany({ where: { orderId: order.id } });
    await tx.orderFinancialSnapshot.deleteMany({ where: { orderId: order.id } });
    await tx.platformAccountTransaction.deleteMany({ where: { orderId: order.id } });
    await tx.ledgerEntryV2.deleteMany({ where: { orderId: order.id } });
    await tx.escrowHold.deleteMany({ where: { orderId: order.id } });
    await tx.orderDispute.deleteMany({ where: { orderId: order.id } });
    await tx.runProof.deleteMany({ where: { run: { orderId: order.id } } });
    await tx.runEvent.deleteMany({ where: { run: { orderId: order.id } } });
    await tx.runAssignment.deleteMany({ where: { run: { orderId: order.id } } });
    await tx.orderRun.deleteMany({ where: { orderId: order.id } });
    await tx.boosterReservation.deleteMany({ where: { orderId: order.id } });
    await tx.orderAssignment.deleteMany({ where: { orderId: order.id } });
    await tx.orderPresign.deleteMany({ where: { orderId: order.id } });
    await tx.orderRequiredRole.deleteMany({ where: { orderId: order.id } });
    await tx.orderKeyRequirement.deleteMany({ where: { orderId: order.id } });
    await tx.orderChannel.deleteMany({ where: { orderId: order.id } });
    await tx.g4XBoostReleaseTracker.deleteMany({ where: { orderId: order.id } });
    await tx.paymentRequest.deleteMany({ where: { orderId: order.id } });
    await tx.advertiserOrderMetadata.deleteMany({ where: { orderId: order.id } });

    // 3. Delete order
    await tx.order.delete({ where: { id: order.id } });

    console.log(`✅ Order #${order.id} (${order.orderRef}) and all associated records successfully purged!`);
  });
}

async function purgeWithdrawal(withdrawalIdentifier: string, dryRun: boolean) {
  const isNumeric = /^\d+$/.test(withdrawalIdentifier.trim());
  const withdrawal = await prisma.boosterWithdrawalRequest.findFirst({
    where: isNumeric ? { id: parseInt(withdrawalIdentifier, 10) } : { withdrawalRef: withdrawalIdentifier.trim() },
    include: {
      ledgerEntries: true,
      booster: {
        include: { wallet: true },
      },
    },
  });

  if (!withdrawal) {
    console.error(`❌ Booster withdrawal not found matching '${withdrawalIdentifier}'.`);
    return;
  }

  console.log(`\nFound Booster Withdrawal #${withdrawal.id} (${withdrawal.withdrawalRef}):`);
  console.log(`  - Booster: ${withdrawal.boosterId}`);
  console.log(`  - Status: ${withdrawal.status}`);
  console.log(`  - Requested: $${(withdrawal.requestedUsdCents / 100).toFixed(2)}`);
  console.log(`  - Net Payout: ${withdrawal.quotedNetPayoutAmount} ${withdrawal.quotedCurrency}`);
  console.log(`  - Ledger Entries: ${withdrawal.ledgerEntries.length}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] No database modifications made. Pass without --dry-run to purge.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // If funds were held in escrow, restore them
    if (['RESERVED', 'PROCESSING', 'UNDER_ADMIN_REVIEW'].includes(withdrawal.status)) {
      if (withdrawal.booster?.wallet) {
        const wallet = withdrawal.booster.wallet;
        await tx.wallet.update({
          where: { userId: withdrawal.boosterId },
          data: {
            escrowUsd: Math.max(0, wallet.escrowUsd - withdrawal.requestedUsdCents),
            balanceUsd: wallet.balanceUsd + withdrawal.requestedUsdCents,
          },
        });
        console.log(`  -> Restored ${withdrawal.requestedUsdCents} cents back to booster wallet available balance.`);
      }
    }

    // Delete linked ledger entries
    await tx.ledgerEntryV2.deleteMany({
      where: { withdrawalRequestId: withdrawal.id },
    });

    // Delete withdrawal request
    await tx.boosterWithdrawalRequest.delete({
      where: { id: withdrawal.id },
    });

    console.log(`✅ Booster Withdrawal #${withdrawal.id} (${withdrawal.withdrawalRef}) successfully purged!`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const orderArg = args.find((a) => a.startsWith('--order='));
  const withdrawalArg = args.find((a) => a.startsWith('--withdrawal='));
  const prefixArg = args.find((a) => a.startsWith('--prefix='));
  const listFlag = args.includes('--list');

  if (listFlag || args.length === 0) {
    await listRecentTestCandidates();
    console.log('Instructions:');
    console.log('  To delete a test order:      npx ts-node scripts/purge-test-order-data.ts --order=<REF_OR_ID>');
    console.log('  To delete a test withdrawal: npx ts-node scripts/purge-test-order-data.ts --withdrawal=<REF_OR_ID>');
    console.log('  To purge orders by prefix:   npx ts-node scripts/purge-test-order-data.ts --prefix=TEST-');
    console.log('  Use --dry-run to simulate without modifying data.');
    return;
  }

  if (orderArg) {
    const orderId = orderArg.split('=')[1];
    await purgeOrder(orderId, dryRun);
  } else if (withdrawalArg) {
    const withdrawalId = withdrawalArg.split('=')[1];
    await purgeWithdrawal(withdrawalId, dryRun);
  } else if (prefixArg) {
    const prefix = prefixArg.split('=')[1];
    console.log(`Searching orders with prefix '${prefix}'...`);
    const matching = await prisma.order.findMany({
      where: { orderRef: { startsWith: prefix } },
      select: { orderRef: true },
    });
    console.log(`Found ${matching.length} orders matching prefix '${prefix}'.`);
    for (const m of matching) {
      await purgeOrder(m.orderRef, dryRun);
    }
  }
}

main()
  .catch((e) => {
    console.error('Error running purge script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
