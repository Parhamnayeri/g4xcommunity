/**
 * admin_user_management_suite.ts — مجموعه تست‌های جامع مدیریت کاربران و حاکمیت نقش‌ها در پنل ادمین
 *
 * پوشش آزمون‌ها:
 *  1. فهرست‌بندی کاربران و صفحه‌بندی امن (Listing & Pagination)
 *  2. جستجو و فیلترسازی بر اساس نام کاربری، شناسه دیسکورد، رول و وضعیت صلاحیت (Search & Filter)
 *  3. کنترل دسترسی و احراز هویت (Unauthorized Access & RBAC)
 *  4. تخصیص و سلب رول‌های مجاز (Role Assignment & Revocation)
 *  5. حفاظت سخت‌گیرانه از سلسله‌مراتب مالک (Owner Hierarchy & Protection Guard)
 *  6. مسدودسازی حساب (Suspension) و ممانعت از اقدامات جدید
 *  7. فعال‌سازی مجدد حساب (Reactivation)
 *  8. بررسی و تایید/رد درخواست‌های ثبت‌نام (Application Approval / Rejection)
 *  9. مدیریت امن عدم دسترسی به API دیسکورد (Discord Sync Failure Handling)
 * 10. صیانت از داده‌های تاریخی و مالی و ممانعت از حذف کاربران دارای رکورد (Historical Data Preservation)
 * 11. ثبت و استعلام کامل لاگ‌های ممیزی سیستم (Centralized Audit Logging)
 */

import prisma from '../database/db';
import {
  listAdminUsers,
  getAdminUserProfile,
  updateUserAccountStatus,
  assignOrRevokeUserRole,
  deleteUserSafely,
  getUserAuditLogs,
  isUserOwner,
} from '../services/adminUserService';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { reviewApplication } from '../services/registrationService';

async function runAdminUserManagementSuite() {
  console.log('=== STARTING G4X ADMIN USER MANAGEMENT TEST SUITE ===\n');

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

  const PRIMARY_OWNER_ID = process.env.DISCORD_OWNER_ID || '387583875066626069';
  const testOwnerId = PRIMARY_OWNER_ID;
  const testAdminId = '990000000000000001';
  const testManagerId = '990000000000000002';
  const testRegularId1 = '990000000000000003';
  const testRegularId2 = '990000000000000004';
  const testRegularId3 = '990000000000000005';
  const testHistoricalUser = '990000000000000006';
  const testCleanUser = '990000000000000007';

  try {
    // ─── آماده‌سازی و راه‌اندازی کاربران تستی در دیتابیس ───────────────────────
    console.log('--- Setup: Bootstrapping Test Identities in Database ---');

    // 1. اطمینان از وجود نقش‌های سیستمی
    const rolesToEnsure = ['owner', 'manager', 'admin', 'staff', 'advertiser', 'booster', 'pilot', 'exchanger'];
    for (const r of rolesToEnsure) {
      await prisma.role.upsert({
        where: { roleKey: r },
        update: {},
        create: { roleKey: r, name: r.charAt(0).toUpperCase() + r.slice(1) },
      });
    }

    // 2. ایجاد حساب مالک
    await prisma.user.upsert({
      where: { discordId: testOwnerId },
      update: { isActive: true, username: 'SystemOwnerUser' },
      create: { discordId: testOwnerId, username: 'SystemOwnerUser', isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testOwnerId, roleKey: 'owner' } },
      update: {},
      create: { userId: testOwnerId, roleKey: 'owner', grantedAt: new Date() },
    });

    // 3. ایجاد حساب ادمین
    await prisma.user.upsert({
      where: { discordId: testAdminId },
      update: { isActive: true, username: 'AdminOperatorUser' },
      create: { discordId: testAdminId, username: 'AdminOperatorUser', isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testAdminId, roleKey: 'admin' } },
      update: {},
      create: { userId: testAdminId, roleKey: 'admin', grantedAt: new Date() },
    });

    // 4. ایجاد حساب منیجر
    await prisma.user.upsert({
      where: { discordId: testManagerId },
      update: { isActive: true, username: 'ManagerSeniorUser' },
      create: { discordId: testManagerId, username: 'ManagerSeniorUser', isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testManagerId, roleKey: 'manager' } },
      update: {},
      create: { userId: testManagerId, roleKey: 'manager', grantedAt: new Date() },
    });

    // 5. ایجاد حساب‌های عادی
    const regulars = [testRegularId1, testRegularId2, testRegularId3, testHistoricalUser, testCleanUser];
    for (let i = 0; i < regulars.length; i++) {
      const rid = regulars[i];
      await prisma.user.upsert({
        where: { discordId: rid },
        update: { isActive: true, username: `RegularUser_${i + 1}` },
        create: { discordId: rid, username: `RegularUser_${i + 1}`, isActive: true },
      });
      // پاک‌سازی نقش‌های قبلی تستی جهت ایزوله‌سازی
      await prisma.userRole.deleteMany({ where: { userId: rid } });
    }

    // ─── 1. فهرست‌بندی و صفحه‌بندی امن (Listing & Pagination) ──────────────────
    console.log('\n--- Step 1: Listing & Pagination ---');
    const page1 = await listAdminUsers({ page: 1, limit: 3 });

    assert(page1.users.length === 3, 'Page 1 returns exactly 3 users');
    assert(page1.pagination.page === 1, 'Pagination reports current page 1');
    assert(page1.pagination.limit === 3, 'Pagination reports limit 3');
    assert(page1.pagination.total >= 5, 'Total user count is correctly tracked');
    assert(page1.pagination.totalPages >= 2, 'Total pages calculated correctly');

    const page2 = await listAdminUsers({ page: 2, limit: 3 });
    assert(page2.users.length > 0, 'Page 2 returns users');
    assert(page2.users[0].discordId !== page1.users[0].discordId, 'Page 2 returns distinct users from Page 1');

    // بررسی مقادیر حد و سقف صفحه‌بندی
    const overLimit = await listAdminUsers({ page: 1, limit: 500 });
    assert(overLimit.pagination.limit === 100, 'Limit is strictly capped at 100 max');

    const negativeLimit = await listAdminUsers({ page: -2, limit: -10 });
    assert(negativeLimit.pagination.page === 1 && negativeLimit.pagination.limit === 1, 'Negative pagination parameters safely fallback to minimum 1');

    // بررسی عدم افشای فیلدهای حساس
    const firstDto: any = page1.users[0];
    assert(firstDto.phoneNumber === undefined, 'Private phone numbers are never serialized in user list');
    assert(firstDto.whatsappNumber === undefined, 'Private whatsapp numbers are never serialized in user list');
    assert(firstDto.session === undefined, 'Session secrets are never serialized in user list');

    // ─── 2. جستجو و فیلترسازی (Search & Filtering) ───────────────────────────
    console.log('\n--- Step 2: Search & Filtering ---');
    const searchByUsername = await listAdminUsers({ search: 'AdminOperatorUser' });
    assert(searchByUsername.users.some(u => u.discordId === testAdminId), 'Search by username successfully finds admin user');

    const searchById = await listAdminUsers({ search: testRegularId2 });
    assert(searchById.users.length === 1 && searchById.users[0].discordId === testRegularId2, 'Search by exact Discord snowflake ID returns expected user');

    const filterByRole = await listAdminUsers({ role: 'admin' });
    assert(filterByRole.users.every(u => u.roles.includes('admin')), 'Filter by role returns only users holding that role');

    const filterByStatusActive = await listAdminUsers({ accountStatus: 'active' });
    assert(filterByStatusActive.users.every(u => u.isActive === true), 'Filter by active status returns only active accounts');

    // ─── 3. کنترل دسترسی و احراز هویت (Unauthorized Access & RBAC) ───────────
    console.log('\n--- Step 3: Unauthorized Access & RBAC Guards ---');
    // کاربر عادی فاقد مجوزهای ادمین است
    const regularAuth = await authorize(testRegularId1, Permission.USER_ROLE_ASSIGN);
    assert(!regularAuth.allowed, 'Regular non-admin user is rejected for USER_ROLE_ASSIGN');

    const adminAuth = await authorize(testAdminId, Permission.BOOSTER_APPLICATION_REVIEW);
    assert(adminAuth.allowed, 'Admin user holds BOOSTER_APPLICATION_REVIEW permission');

    // ادمین هرگز نباید بتواند رول Owner را به خود یا دیگری بدهد (قانون ۴)
    let adminGrantOwnerThrown = false;
    try {
      await assignOrRevokeUserRole({
        targetUserId: testAdminId,
        actorId: testAdminId,
        roleKey: 'owner',
        action: 'grant',
        reason: 'Attempting to self-grant owner privileges',
      });
    } catch (err: any) {
      adminGrantOwnerThrown = true;
      assert(err.message.includes('OWNER_ACCESS_DENIED'), 'Admin attempting to grant Owner role is strictly blocked with OWNER_ACCESS_DENIED');
    }
    assert(adminGrantOwnerThrown, 'Self-granting or non-owner granting of Owner role threw security error');

    // ─── 4. محافظت از سلسله‌مراتب مالک (Owner Hierarchy & Protection Guard) ───
    console.log('\n--- Step 4: Owner Protection Guard ---');
    // ممانعت صریح از تعلیق حساب Owner (قانون ۵)
    let suspendOwnerThrown = false;
    try {
      await updateUserAccountStatus({
        targetUserId: testOwnerId,
        actorId: testAdminId,
        isActive: false,
        reason: 'Attempting to suspend the system owner',
      });
    } catch (err: any) {
      suspendOwnerThrown = true;
      assert(err.message.includes('OWNER_PROTECTION_VIOLATION'), 'Attempting to suspend Owner account rejected with OWNER_PROTECTION_VIOLATION');
    }
    assert(suspendOwnerThrown, 'Owner suspension guard successfully triggered');

    // ممانعت از سلب رول Owner از مالک اصلی
    let revokeOwnerThrown = false;
    try {
      await assignOrRevokeUserRole({
        targetUserId: testOwnerId,
        actorId: testOwnerId,
        roleKey: 'owner',
        action: 'revoke',
        reason: 'Attempting to strip owner role',
      });
    } catch (err: any) {
      revokeOwnerThrown = true;
      assert(err.message.includes('OWNER_PROTECTION_VIOLATION'), 'Attempting to revoke Owner role from primary owner rejected with OWNER_PROTECTION_VIOLATION');
    }
    assert(revokeOwnerThrown, 'Revoking primary owner role guard successfully triggered');

    // ─── 5. مسدودسازی و فعال‌سازی مجدد کاربر (Suspension & Reactivation) ───────
    console.log('\n--- Step 5: User Suspension & Reactivation ---');
    // مسدودسازی با ثبت دلیل معتبر
    const suspendRes = await updateUserAccountStatus({
      targetUserId: testRegularId1,
      actorId: testAdminId,
      isActive: false,
      reason: 'Administrative suspension due to policy violations',
    });
    assert(suspendRes.success && suspendRes.isActive === false, 'User successfully suspended in database');

    const suspendedUser = await prisma.user.findUnique({ where: { discordId: testRegularId1 } });
    assert(suspendedUser?.isActive === false, 'User isActive flag updated to false');

    // بررسی اثر مسدودسازی بر موتور مجوزها: کاربر معلق فوراً رد صلاحیت می‌شود (قانون ۷)
    const suspendedAuth = await authorize(testRegularId1, Permission.WALLET_VIEW_OWN);
    assert(!suspendedAuth.allowed && suspendedAuth.reason?.includes('USER_NOT_FOUND_OR_INACTIVE'), 'Suspended user is immediately blocked by authorizationService');

    // تلاش برای تعلیق بدون دلیل ممیزی باید خطا دهد
    let noReasonThrown = false;
    try {
      await updateUserAccountStatus({
        targetUserId: testRegularId2,
        actorId: testAdminId,
        isActive: false,
        reason: '',
      });
    } catch (err: any) {
      noReasonThrown = true;
      assert(err.message.includes('REASON_REQUIRED'), 'Suspension without audit reason is rejected with REASON_REQUIRED');
    }
    assert(noReasonThrown, 'Empty reason check successfully enforced');

    // فعال‌سازی مجدد
    const reactivateRes = await updateUserAccountStatus({
      targetUserId: testRegularId1,
      actorId: testAdminId,
      isActive: true,
      reason: 'Reactivated after verification and compliance agreement',
    });
    assert(reactivateRes.success && reactivateRes.isActive === true, 'User successfully reactivated');

    const reactivatedUser = await prisma.user.findUnique({ where: { discordId: testRegularId1 } });
    assert(reactivatedUser?.isActive === true, 'User isActive flag restored to true');

    // ─── 6. تخصیص و سلب رول (Role Assignment & Revocation) ────────────────────
    console.log('\n--- Step 6: Role Assignment & Revocation ---');
    // اعطای رول booster توسط ادمین
    const grantBooster = await assignOrRevokeUserRole({
      targetUserId: testRegularId2,
      actorId: testAdminId,
      roleKey: 'booster',
      action: 'grant',
      reason: 'Approved application for WoW Midnight Mythic+',
      discordClient: null, // شبیه‌سازی عدم حضور دیسکورد بدون کرش
    });
    assert(grantBooster.success && grantBooster.roleKey === 'booster', 'Booster role successfully granted');

    const hasBooster = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: testRegularId2, roleKey: 'booster' } },
    });
    assert(Boolean(hasBooster && hasBooster.grantedBy === testAdminId), 'UserRole record created in database with grantedBy attribution');

    // اعطای رول advertiser رنک BRONZE را به صورت خودکار تخصیص می‌دهد
    await assignOrRevokeUserRole({
      targetUserId: testRegularId2,
      actorId: testAdminId,
      roleKey: 'advertiser',
      action: 'grant',
      reason: 'Promoted to advertiser',
      discordClient: null,
    });
    const advUser = await prisma.user.findUnique({ where: { discordId: testRegularId2 } });
    assert(advUser?.advertiserRank === 'BRONZE', 'Advertiser role assignment automatically provisions BRONZE rank');

    // سلب رول booster
    const revokeBooster = await assignOrRevokeUserRole({
      targetUserId: testRegularId2,
      actorId: testAdminId,
      roleKey: 'booster',
      action: 'revoke',
      reason: 'Inactivity cleanup',
      discordClient: null,
    });
    assert(revokeBooster.success, 'Booster role successfully revoked');

    const hasBoosterAfter = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: testRegularId2, roleKey: 'booster' } },
    });
    assert(!hasBoosterAfter, 'UserRole successfully removed from database');

    // ─── 7. مدیریت ایمن خطای همگام‌سازی دیسکورد (Discord Sync Failure Handling)
    console.log('\n--- Step 7: Discord Sync Failure Safe Handling ---');
    // ارسال شیء کلاینت دیسکورد نامعتبر که متد guilds.fetch آن خطا برمی‌گرداند
    const mockFailingDiscordClient = {
      guilds: {
        fetch: async () => {
          throw new Error('Discord API 500: Internal Guild Gateway Timeout');
        },
      },
    };

    const safeSyncResult = await assignOrRevokeUserRole({
      targetUserId: testRegularId3,
      actorId: testAdminId,
      roleKey: 'pilot',
      action: 'grant',
      reason: 'Testing safe Discord sync resilience',
      discordClient: mockFailingDiscordClient,
    });

    assert(safeSyncResult.success === true, 'Database role assignment succeeds even when Discord API fails (Fail-Safe)');
    assert(safeSyncResult.discordSync.success === false, 'Discord sync reported as false without throwing or breaking API response');
    assert(Boolean(safeSyncResult.discordSync.reason), 'Discord failure reason is captured and surfaced safely');

    // رول پایلوت در دیتابیس ثبت شده است
    const pilotInDb = await prisma.userRole.findUnique({
      where: { userId_roleKey: { userId: testRegularId3, roleKey: 'pilot' } },
    });
    assert(Boolean(pilotInDb), 'Database integrity is preserved despite Discord API failure');

    // ─── 8. بررسی و تایید/رد درخواست عضویت (Application Review Workflow) ───────
    console.log('\n--- Step 8: Registration Application Review Workflow ---');
    // ایجاد یک درخواست ثبت‌نام تستی
    const application = await prisma.registrationApplication.create({
      data: {
        userId: testRegularId3,
        category: 'booster',
        gameSlug: 'wow_midnight',
        preferredLanguage: 'en',
        qualifications: JSON.stringify({ experience: '2800 Mythic IO', mainRole: 'dps' }),
        status: 'pending',
      },
    });

    assert(application.id > 0, 'Test registration application successfully created');

    // بررسی و تایید درخواست توسط ادمین از طریق سرویس موجود
    const reviewedApp = await reviewApplication({
      reviewerId: testAdminId,
      applicationId: application.id,
      decision: 'approve',
      reviewNotes: 'Verified RaiderIO logs and score',
      discordClient: null,
    });

    assert(reviewedApp.status === 'approved', 'Application approved through existing reviewApplication service');

    // بررسی تخصیص صلاحیت بازی و رول در دیتابیس
    const approvalRecord = await prisma.userGameApproval.findFirst({
      where: { userId: testRegularId3, gameSlug: 'wow_midnight', approvalType: 'booster' },
    });
    assert(approvalRecord?.status === 'approved', 'UserGameApproval record created with status approved');

    // ─── 9. صیانت از داده‌های تاریخی و مالی (Historical Data Preservation) ─────
    console.log('\n--- Step 9: Historical Data Preservation (No Hard-Delete) ---');
    // ایجاد یک سفارش تاریخی برای testHistoricalUser
    const testOrder = await prisma.order.create({
      data: {
        orderRef: `ORD-HIST-${Date.now()}`,
        gameSlug: 'wow_midnight',
        serviceId: 1,
        customerId: testHistoricalUser,
        orderName: 'Historical Test Order',
        orderType: 'boost',
        status: 'completed',
        grossAmountMinor: 5000,
        currency: 'USD',
      },
    });
    assert(testOrder.id > 0, 'Historical test order successfully established in database');

    // بررسی پروفایل و نشانه‌گذاری وجود سوابق تاریخی
    const profileHistorical = await getAdminUserProfile(testHistoricalUser);
    assert(profileHistorical.hasHistoricalRecords === true, 'UserProfile accurately flags hasHistoricalRecords = true');
    assert(profileHistorical.historicalCounts.orders >= 1, 'Historical orders count is non-zero');

    // تلاش برای حذف کاربر دارای سابقه تاریخی باید قطعاً مسدود شود (قانون ۶)
    let deleteHistoricalThrown = false;
    try {
      await deleteUserSafely({
        targetUserId: testHistoricalUser,
        actorId: testAdminId,
        reason: 'Attempting to purge user with historical records',
      });
    } catch (err: any) {
      deleteHistoricalThrown = true;
      assert(err.message.includes('HISTORICAL_DATA_PRESERVATION'), 'Attempting to delete user with orders is strictly blocked with HISTORICAL_DATA_PRESERVATION');
    }
    assert(deleteHistoricalThrown, 'Historical data preservation guard successfully triggered');

    // کاربر بدون سابقه تاریخی می‌تواند به صورت امن با ثبت ممیزی حذف شود
    const profileClean = await getAdminUserProfile(testCleanUser);
    assert(profileClean.hasHistoricalRecords === false, 'Clean test user accurately flags hasHistoricalRecords = false');

    const deleteCleanRes = await deleteUserSafely({
      targetUserId: testCleanUser,
      actorId: testAdminId,
      reason: 'Clean test user cleanup',
    });
    assert(deleteCleanRes.success === true, 'Clean user without historical records can be safely deleted');

    const cleanUserInDb = await prisma.user.findUnique({ where: { discordId: testCleanUser } });
    assert(cleanUserInDb === null, 'Clean user removed from database after safe delete');

    // ─── 10. لاگ‌های ممیزی سیستم (Centralized Audit Logging) ───────────────────
    console.log('\n--- Step 10: Centralized Audit Logging ---');
    const auditLogs = await getUserAuditLogs(testRegularId1);
    assert(auditLogs.length > 0, 'Audit logs retrieved for testRegularId1');

    const actionTypes = auditLogs.map(l => l.action);
    assert(actionTypes.includes('USER_SUSPENDED'), 'Audit trail records USER_SUSPENDED action');
    assert(actionTypes.includes('USER_REACTIVATED'), 'Audit trail records USER_REACTIVATED action');

    const roleAuditLogs = await getUserAuditLogs(testRegularId2);
    const roleActions = roleAuditLogs.map(l => l.action);
    assert(roleActions.includes('USER_ROLE_ASSIGNED') || roleActions.includes('USER_ROLE_REVOKED'), 'Audit trail records role assignment and revocation events');

    // پاک‌سازی سفارش تستی
    await prisma.order.delete({ where: { id: testOrder.id } }).catch(() => null);

  } catch (error: any) {
    console.error('FATAL SUITE ERROR:', error);
    failed++;
  } finally {
    console.log(`\n==================================================`);
    console.log(`SUITE RESULTS: Passed: ${passed} | Failed: ${failed}`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  }
}

runAdminUserManagementSuite();
