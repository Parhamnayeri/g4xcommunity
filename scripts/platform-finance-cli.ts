/**
 * scripts/platform-finance-cli.ts — رابط عملیاتی مدیریت مالی پلتفرم‌ها و تسویه حساب‌ها (Phase 3.4 CLI)
 *
 * عملیات ۹ گانه الزامی:
 *  1. View platform balance summary (مشاهده خلاصه مانده‌های پلتفرم‌ها)
 *  2. List pending platform withdrawals (فهرست برداشت‌های در جریان)
 *  3. Create a draft withdrawal batch (ایجاد پیش‌نویس دسته برداشت)
 *  4. View batch details and constituent orders (مشاهده جزئیات دسته و سفارشات)
 *  5. Submit/mark processing (ثبت ارسال در پلتفرم)
 *  6. Record actual receipt and fees (ثبت وصول واقعی و کارمزدها با مدارک امن)
 *  7. Reconcile batch (تسویه و تسهیم قطعی تناسبی)
 *  8. View fee allocation results (مشاهده نتایج تسهیم کارمزد میان سفارشات)
 *  9. View audit and failure reasons (مشاهده سوابق ممیزی و دلایل خطا/مغایرت)
 *
 * امنیت:
 *  - احراز هویت متمرکز بر مبنای نقش‌های مالک/مدیر (Fail-Closed)
 *  - عدم دسترسی بدون شناسه معتبر بازیگر
 */

import prisma from '../src/database/db';
import { authorize } from '../src/services/authorizationService';
import { Permission } from '../src/services/permissionTypes';
import {
  getPlatformAccountsSummary,
  checkPlatformWithdrawalEligibility,
} from '../src/services/platformBalanceService';
import {
  createDraftWithdrawalBatch,
  submitWithdrawalBatch,
  recordBatchReceipt,
  reconcileWithdrawalBatch,
  cancelWithdrawalBatch,
} from '../src/services/withdrawalBatchService';

export async function cliViewPlatformBalances(actorId: string) {
  const balances = await getPlatformAccountsSummary(actorId);
  console.log('\n============================= PLATFORM BALANCES SUMMARY =============================');
  console.log('Account Ref    | Platform | Eligible ($) | Reserved ($) | Pending ($) | Min Thresh ($) | Status');
  console.log('-------------------------------------------------------------------------------------');
  for (const b of balances) {
    const el = (b.eligibleBalanceMinor / 100).toFixed(2);
    const res = (b.reservedBatchMinor / 100).toFixed(2);
    const pend = (b.pendingReleaseMinor / 100).toFixed(2);
    const min = (b.minWithdrawalThresholdMinor / 100).toFixed(2);
    const stat = b.isEligibleForWithdrawal ? '✅ WITHDRAWABLE' : '⏳ BELOW_THRESHOLD';
    console.log(
      `${b.accountRef.padEnd(14)} | ${b.platform.padEnd(8)} | $${el.padStart(10)} | $${res.padStart(10)} | $${pend.padStart(9)} | $${min.padStart(12)} | ${stat}`
    );
  }
  console.log('=====================================================================================\n');
  return balances;
}

export async function cliListPendingBatches(actorId: string) {
  const auth = await authorize(actorId, Permission.FINANCE_ADMIN_VIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason}`);
  }

  const batches = await prisma.platformWithdrawalBatch.findMany({
    where: {
      status: { in: ['draft', 'ready', 'submitted', 'processing', 'received', 'review_required'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      allocations: true,
    },
  });

  console.log('\n============================= PENDING WITHDRAWAL BATCHES =============================');
  console.log('ID  | Batch Ref                  | Platform | Account     | Status          | Total ($)  | Orders');
  console.log('---------------------------------------------------------------------------------------');
  for (const b of batches) {
    const tot = (b.totalContributionsMinor / 100).toFixed(2);
    console.log(
      `${String(b.id).padEnd(3)} | ${b.batchRef.padEnd(26)} | ${b.platform.padEnd(8)} | ${(b.accountRef || '-').padEnd(11)} | ${b.status.padEnd(15)} | $${tot.padStart(8)} | ${b.allocations.length}`
    );
  }
  console.log('=======================================================================================\n');
  return batches;
}

export async function cliViewBatchDetails(actorId: string, batchId: number) {
  const auth = await authorize(actorId, Permission.FINANCE_ADMIN_VIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason}`);
  }

  const batch = await prisma.platformWithdrawalBatch.findUnique({
    where: { id: batchId },
    include: {
      allocations: {
        include: { order: true },
      },
    },
  });

  if (!batch) {
    console.log(`Batch #${batchId} not found.`);
    return null;
  }

  console.log('\n============================= BATCH DETAILS =============================');
  console.log(`ID:                    ${batch.id}`);
  console.log(`Ref:                   ${batch.batchRef}`);
  console.log(`Platform:              ${batch.platform}`);
  console.log(`Account:               ${batch.accountRef || '-'}`);
  console.log(`Status:                ${batch.status.toUpperCase()}`);
  console.log(`Total Contributions:   $${(batch.totalContributionsMinor / 100).toFixed(2)}`);
  console.log(`Batch Fee:             $${(batch.actualBatchFeeMinor / 100).toFixed(2)}`);
  console.log(`Transfer Fee:          $${(batch.actualTransferFeeMinor / 100).toFixed(2)}`);
  console.log(`Net Received:          $${(batch.netReceivedMinor / 100).toFixed(2)}`);
  console.log(`Destination Account:   ${batch.destinationAccountRef || 'N/A'}`);
  console.log(`Safe Evidence Ref:     ${batch.safeEvidenceRef || 'N/A'}`);
  console.log(`External Receipt Ref:  ${batch.externalReceiptRef || 'N/A'}`);
  console.log(`Failure / Review:      ${batch.failureReason || 'None'}`);
  console.log(`Review Notes:          ${batch.reviewNotes || 'None'}`);
  console.log('\nConstituent Order Allocations:');
  console.log('Order ID | Order Ref       | Contrib ($) | Batch Fee ($) | Transfer Fee ($) | Net ($)');
  console.log('-----------------------------------------------------------------------------------');
  for (const a of batch.allocations) {
    console.log(
      `${String(a.orderId).padEnd(8)} | ${a.order.orderRef.padEnd(15)} | $${(a.contributionAmountMinor / 100).toFixed(2).padStart(9)} | $${(a.allocatedBatchFeeMinor / 100).toFixed(2).padStart(11)} | $${(a.allocatedTransferFeeMinor / 100).toFixed(2).padStart(14)} | $${(a.netContributionMinor / 100).toFixed(2).padStart(7)}`
    );
  }
  console.log('=========================================================================\n');
  return batch;
}

export async function cliViewAuditLogs(actorId: string, batchId?: number) {
  const auth = await authorize(actorId, Permission.AUDIT_LOG_VIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED: ${auth.reason}`);
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: { in: ['PlatformWithdrawalBatch', 'PlatformAccount', 'PlatformFeePolicy'] },
      ...(batchId ? { entityId: String(batchId) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('\n============================= FINANCIAL AUDIT LOGS =============================');
  for (const log of logs) {
    console.log(
      `[${log.createdAt.toISOString()}] Action: ${log.action} | Entity: ${log.entityType}#${log.entityId} | Actor: ${log.actorId || 'SYSTEM'}`
    );
    if (log.reason) console.log(`  Reason: ${log.reason}`);
    if (log.newValues) console.log(`  New Values: ${log.newValues.slice(0, 120)}...`);
  }
  console.log('================================================================================\n');
  return logs;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const actorId = process.env.FIN_ACTOR_ID || 'system_cli_runner';

  console.log(`=== G4X PLATFORM FINANCIAL MANAGEMENT CLI === (Actor: ${actorId})\n`);

  switch (command) {
    case 'balances':
      await cliViewPlatformBalances(actorId);
      break;
    case 'pending':
      await cliListPendingBatches(actorId);
      break;
    case 'view': {
      const batchId = parseInt(args[1], 10);
      if (isNaN(batchId)) {
        console.error('Usage: npm run finance:cli -- view <batchId>');
        process.exit(1);
      }
      await cliViewBatchDetails(actorId, batchId);
      break;
    }
    case 'audit': {
      const batchId = args[1] ? parseInt(args[1], 10) : undefined;
      await cliViewAuditLogs(actorId, batchId);
      break;
    }
    case 'help':
    default:
      console.log('Available Commands:');
      console.log('  npm run finance:cli -- balances              (View platform accounts & eligible balances)');
      console.log('  npm run finance:cli -- pending               (List pending platform withdrawals)');
      console.log('  npm run finance:cli -- view <batchId>        (View batch details & constituent order allocations)');
      console.log('  npm run finance:cli -- audit [batchId]       (View financial audit history & failure reasons)');
      console.log('\nProgrammatic / Service Operations:');
      console.log('  • createDraftWithdrawalBatch(...)');
      console.log('  • submitWithdrawalBatch(...)');
      console.log('  • recordBatchReceipt(...)');
      console.log('  • reconcileWithdrawalBatch(...)');
      console.log('  • cancelWithdrawalBatch(...)');
      break;
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('CLI Operation Error:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
