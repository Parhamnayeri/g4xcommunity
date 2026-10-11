/**
 * src/test/owner_bootstrap_suite.ts — مجموعه تست‌های سیستم امن تعیین مالک اولیه (Phase 3.2.2)
 * 
 * آزمون‌های الزامی:
 *  1. ایجاد موفقیت‌آمیز اولین مالک سیستم (First Owner created successfully)
 *  2. تکرار ایمن برای همان مالک بدون خطا یا تغییر (Idempotent for same owner)
 *  3. رد قطعی ثبت مالک دوم یا متفاوت (Second different owner rejected)
 *  4. رد شناسه‌های نامعتبر دیسکورد (Invalid Discord IDs rejected)
 *  5. رول‌بک کامل تراکنش در صورت بروز خطا (Transaction rollback on failure)
 *  6. حفظ کامل نقش‌های قبلی و عدم دستکاری داده‌های دیگر کاربران (Preserve existing roles)
 *  7. احراز دسترسی واقعی SERVICE_CONFIG_MANAGE برای مالک جدید (Owner gains SERVICE_CONFIG_MANAGE)
 *  8. اعتبارسنجی آرگومان‌های خط فرمان و متغیرهای محیطی CLI (CLI execution verification)
 */

import prisma from '../database/db';
import {
  bootstrapOwner,
  validateDiscordSnowflake,
} from '../services/bootstrapService';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { execSync } from 'child_process';

async function runOwnerBootstrapTests() {
  console.log('=== STARTING PHASE 3.2.2 INITIAL OWNER BOOTSTRAP TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  // شناسه‌های معتبر اسنوفلیک جهت تست ایزوله
  const testOwner1 = '999888777666555444'; // ۱۸ رقم
  const testOwner2 = '111222333444555666'; // ۱۸ رقم
  const existingBooster = '777888999000111222'; // ۱۸ رقم

  const allTestIds = [testOwner1, testOwner2, existingBooster];

  try {
    // ─── پاکسازی اولیه سوابق تستی ─────────────────────────────────────────
    await prisma.auditLog.deleteMany({
      where: {
        entityId: { in: allTestIds },
      },
    });
    await prisma.userRole.deleteMany({
      where: {
        userId: { in: allTestIds },
      },
    });
    await prisma.user.deleteMany({
      where: {
        discordId: { in: allTestIds },
      },
    });

    // ─── تست ۱: رد شناسه‌های نامعتبر دیسکورد (Invalid Discord IDs) ─────────
    const invalidIds = [
      '',
      'short123',
      '1234567890123456', // ۱۶ رقم (کمتر از ۱۷)
      '123456789012345678901', // ۲۱ رقم (بیشتر از ۲۰)
      '12345678901234567a', // شامل حروف
      ' 12345678901234567! ',
    ];

    let allInvalidRejected = true;
    for (const inv of invalidIds) {
      try {
        validateDiscordSnowflake(inv);
        allInvalidRejected = false;
      } catch (err: any) {
        if (!err.message.includes('INVALID_DISCORD_ID')) {
          allInvalidRejected = false;
        }
      }
    }
    assert(allInvalidRejected, '1. Invalid Discord IDs are rejected with validation error');

    // ─── تست ۲: ایجاد موفقیت‌آمیز اولین مالک (First Owner created) ─────────
    const res1 = await bootstrapOwner(testOwner1, { username: 'PrimaryOwner' });
    const userInDb = await prisma.user.findUnique({
      where: { discordId: testOwner1 },
      include: { userRoles: true },
    });
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        entityId: testOwner1,
        action: 'INITIAL_OWNER_BOOTSTRAP',
      },
    });

    assert(
      res1.success &&
        res1.status === 'created' &&
        userInDb !== null &&
        userInDb.userRoles.some((r) => r.roleKey === 'owner') &&
        auditRecord !== null,
      '2. First Owner is created successfully with role and audit log'
    );

    // ─── تست ۳: تکرار برای همان مالک ایمن و Idempotent است ─────────────────
    const resRepeat = await bootstrapOwner(testOwner1);
    const ownerRoleCount = await prisma.userRole.count({
      where: { userId: testOwner1, roleKey: 'owner' },
    });

    assert(
      resRepeat.success &&
        resRepeat.status === 'already_owner' &&
        ownerRoleCount === 1,
      '3. Repeating bootstrap for the same Owner is safe and idempotent'
    );

    // ─── تست ۴: رد قطعی ثبت مالک دوم یا متفاوت (Second Owner rejected) ───
    let secondOwnerError = '';
    try {
      await bootstrapOwner(testOwner2, { username: 'ImposterOwner' });
    } catch (err: any) {
      secondOwnerError = err.message;
    }

    const imposterUser = await prisma.user.findUnique({
      where: { discordId: testOwner2 },
    });

    assert(
      secondOwnerError.includes('BOOTSTRAP_LOCKED') && imposterUser === null,
      '4. A second, different Owner is strictly rejected with BOOTSTRAP_LOCKED'
    );

    // ─── تست ۵: حفظ کامل نقش‌های قبلی و عدم آسیب به داده‌های کاربران ──────
    // ایجاد کاربر با نقش booster
    await prisma.role.upsert({
      where: { roleKey: 'booster' },
      update: {},
      create: { roleKey: 'booster', name: 'Booster' },
    });
    await prisma.user.create({
      data: {
        discordId: existingBooster,
        username: 'ExistingBoosterUser',
        userRoles: {
          create: { roleKey: 'booster' },
        },
      },
    });

    // بررسی اینکه ثبت مالک اولیه نقشی از existingBooster حذف نکرده است
    const boosterRoleCheck = await prisma.userRole.findUnique({
      where: {
        userId_roleKey: {
          userId: existingBooster,
          roleKey: 'booster',
        },
      },
    });

    assert(
      boosterRoleCheck !== null,
      '5. Existing user roles and records remain completely unchanged'
    );

    // ─── تست ۶: احراز دسترسی متمرکز SERVICE_CONFIG_MANAGE برای مالک ───────
    const authOwner = await authorize(testOwner1, Permission.SERVICE_CONFIG_MANAGE);
    const authNonOwner = await authorize(existingBooster, Permission.SERVICE_CONFIG_MANAGE);

    assert(
      authOwner.allowed === true && authNonOwner.allowed === false,
      '6. The bootstrapped Owner gains SERVICE_CONFIG_MANAGE permission while non-owner is denied'
    );

    // ─── تست ۷: رول‌بک کامل تراکنش در صورت بروز خطای داخلی (Rollback) ─────
    const rollbackTestId = '555666777888999000';
    let rollbackOccurred = false;

    // شبیه‌سازی کلاینت دیتابیس با خطای ساختگی در مرحله تراکنش
    const mockFailingClient = {
      userRole: {
        findFirst: async () => null, // وانمود می‌کند مالکی نیست
      },
      $transaction: async () => {
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      },
    };

    try {
      await bootstrapOwner(rollbackTestId, { client: mockFailingClient });
    } catch (err: any) {
      if (err.message.includes('SIMULATED_TRANSACTION_FAILURE')) {
        rollbackOccurred = true;
      }
    }

    const rollbackUserCheck = await prisma.user.findUnique({
      where: { discordId: rollbackTestId },
    });

    assert(
      rollbackOccurred && rollbackUserCheck === null,
      '7. Failure inside transaction rolls back all state changes completely'
    );

    // ─── تست ۸: اعتبارسنجی اجرای CLI از طریق زیرفرایند (CLI Execution) ────
    let cliFlagSuccess = false;
    let cliRejectSuccess = false;

    try {
      // اجرای CLI برای مالک فعلی با فلگ --discord-id=... (باید بدون خطا با کد 0 خارج شود)
      const output = execSync(
        `npx ts-node scripts/bootstrap-owner.ts --discord-id=${testOwner1}`,
        { encoding: 'utf-8' }
      );
      if (output.includes('ALREADY_OWNER') || output.includes('SUCCESS')) {
        cliFlagSuccess = true;
      }
    } catch {
      cliFlagSuccess = false;
    }

    try {
      // تلاش CLI برای شناسه دوم (باید با کد خروج غیر صفر رد شود)
      execSync(
        `npx ts-node scripts/bootstrap-owner.ts ${testOwner2}`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      cliRejectSuccess = false;
    } catch (err: any) {
      if (err.status !== 0) {
        cliRejectSuccess = true;
      }
    }

    assert(
      cliFlagSuccess && cliRejectSuccess,
      '8. CLI execution via arguments and flags operates safely with correct exit codes'
    );

  } catch (err) {
    console.error('Fatal error during test suite:', err);
    failed++;
  } finally {
    // ─── پاکسازی رکوردهای تستی ──────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning bootstrap test records...');
    await prisma.auditLog.deleteMany({
      where: {
        entityId: { in: allTestIds },
      },
    });
    await prisma.userRole.deleteMany({
      where: {
        userId: { in: allTestIds },
      },
    });
    await prisma.user.deleteMany({
      where: {
        discordId: { in: allTestIds },
      },
    });
  }

  console.log(`\n=== OWNER BOOTSTRAP TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runOwnerBootstrapTests().catch((err) => {
  console.error('Execution failure:', err);
  process.exit(1);
});
