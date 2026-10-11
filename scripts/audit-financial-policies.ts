/**
 * scripts/audit-financial-policies.ts — ابزار ممیزی و تصحیح غیرمخرب خط‌مشی‌های مالی (Phase 3.3.1)
 *
 * هدف:
 *  بررسی شفاف تمامی رکوردهای جدول platform_fee_policies و ابطال ایمن و مستند خط‌مشی‌های تاییدنشده
 *  (به‌ویژه فرض ۱۰٪ طلای ادورتایزر بدون تایید مالک).
 *
 * اصول:
 *  ۱. عدم حذف فیزیکی هیچ رکوردی از دیتابیس (Never delete production financial policies).
 *  ۲. ابطال مستند سیاست‌های منسوخ با درج تاریخ پایان (effectiveTo) و ثبت لاگ ممیزی در AuditLog.
 *  ۳. گزارش‌دهی دقیق وضعیت به اپراتور سیستم.
 */

import prisma from '../src/database/db';
import { reviewAndCorrectUnapprovedPolicies } from '../src/services/financialPolicyService';

async function main() {
  console.log('=== G4X COMMUNITY — FINANCIAL POLICIES AUDIT & INTEGRITY CHECK ===\n');

  const allPolicies = await prisma.platformFeePolicy.findMany({
    orderBy: [{ platform: 'asc' }, { version: 'asc' }],
  });

  console.log(`Total platform fee policies found in database: ${allPolicies.length}\n`);

  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log('| ID | Platform   | Type             | Category | Currency | Rate / Fixed   | Ver | Approved | Reason / Status');
  console.log('------------------------------------------------------------------------------------------------------------------------');

  for (const p of allPolicies) {
    const rateStr = p.percentageRate !== null ? `${(p.percentageRate * 100).toFixed(2)}%` : p.fixedMinor !== null ? `$${(p.fixedMinor / 100).toFixed(2)}` : 'N/A';
    const appStr = p.isApproved ? 'YES' : 'REVOKED/NO';
    console.log(
      `| ${String(p.id).padEnd(2)} | ${p.platform.padEnd(10)} | ${p.feeType.padEnd(16)} | ${(p.listingCategory || '-').padEnd(8)} | ${p.currency.padEnd(8)} | ${rateStr.padEnd(14)} | v${String(p.version).padEnd(2)} | ${appStr.padEnd(8)} | ${p.changeReason || ''}`
    );
  }
  console.log('------------------------------------------------------------------------------------------------------------------------\n');

  console.log('[Audit] Checking for unapproved Gold advertiser fee policies (e.g. unapproved 10% rate)...');
  const auditResult = await reviewAndCorrectUnapprovedPolicies('cli_audit_runner');

  if (auditResult.corrected > 0) {
    console.log(`⚠️ Corrected / Revoked ${auditResult.corrected} unapproved policy records safely without deletion.`);
    for (const d of auditResult.details) {
      console.log(`  • ${d}`);
    }
  } else {
    console.log('✅ No unapproved active policies found. All active policies conform to approved business specifications.');
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

main()
  .catch((err) => {
    console.error('Audit failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
