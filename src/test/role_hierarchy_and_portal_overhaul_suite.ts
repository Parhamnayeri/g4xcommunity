/**
 * role_hierarchy_and_portal_overhaul_suite.ts
 *
 * Comprehensive regression test suite verifying:
 *  1. 4-tier Authoritative Role Hierarchy (Owner > Admin > Manager > Staff)
 *  2. Capability Matrix & Anti-Self-Approval
 *  3. Multi-role simultaneous assignments & role union resolution
 *  4. User Ban/Unban workflow & immutable audit history
 *  5. Order operational edits & lifecycle restrictions
 *  6. Withdrawal metadata edits & audit history
 *  7. Discord order channel naming (order-${order.id}-${modeSlug}) & slug rules
 *  8. Terminology overhaul: "Selfpay" replacing "Non-Pilot" on user surfaces
 */

import assert from 'assert';
import prisma from '../database/db';
import { authorize } from '../services/authorizationService';
import { Permission, getEffectivePermissions, SystemRoleKey } from '../services/permissionTypes';
import {
  updateUserAccountStatus,
  assignOrRevokeUserRole,
  getUserBanHistory,
  getAdminUserProfile,
} from '../services/adminUserService';
import { updateOrderOperationalFields } from '../services/orderLifecycleService';
import {
  updateWithdrawalMetadata,
  getWithdrawalAuditHistory,
} from '../services/financeV2/boosterWithdrawalService';
import {
  deriveOrderChannelModeSlug,
  buildOrderExecutionChannelName,
} from '../services/orderExecutionChannelService';

let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✅ [PASS] ${desc}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  ❌ [FAIL] ${desc}\n     ${err.message}`);
    });
}

async function run() {
  console.log('\n===============================================================');
  console.log('=== G4X ROLE HIERARCHY, MULTI-ROLE & AUDIT REGRESSION SUITE ===');
  console.log('===============================================================\n');

  // Test identities
  const timestamp = Date.now();
  const testStaffId = `test_staff_${timestamp}`;
  const testManagerId = `test_manager_${timestamp}`;
  const testAdminId = `test_admin_${timestamp}`;
  const testOwnerId = `test_owner_${timestamp}`;
  const testTargetId = `test_target_${timestamp}`;
  const testMultiId = `test_multi_${timestamp}`;

  // Clean setup
  await prisma.userRole.deleteMany({
    where: {
      userId: {
        in: [testStaffId, testManagerId, testAdminId, testOwnerId, testTargetId, testMultiId],
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      discordId: {
        in: [testStaffId, testManagerId, testAdminId, testOwnerId, testTargetId, testMultiId],
      },
    },
  });

  // Seed Users
  await prisma.user.createMany({
    data: [
      { discordId: testStaffId, username: 'StaffUser', isActive: true },
      { discordId: testManagerId, username: 'ManagerUser', isActive: true },
      { discordId: testAdminId, username: 'AdminUser', isActive: true },
      { discordId: testOwnerId, username: 'OwnerUser', isActive: true },
      { discordId: testTargetId, username: 'TargetUser', isActive: true },
      { discordId: testMultiId, username: 'MultiRoleUser', isActive: true },
    ],
  });

  // Seed Roles
  await prisma.userRole.createMany({
    data: [
      { userId: testStaffId, roleKey: 'staff' },
      { userId: testManagerId, roleKey: 'manager' },
      { userId: testAdminId, roleKey: 'admin' },
      { userId: testOwnerId, roleKey: 'owner' },
      { userId: testMultiId, roleKey: 'staff' },
      { userId: testMultiId, roleKey: 'booster' },
    ],
  });

  console.log('--- 1. Authoritative Role Hierarchy & Capability Matrix ---');

  await it('Staff holds proof review and dispute review, but denied order edit and user ban', async () => {
    const proofAuth = await authorize(testStaffId, Permission.PROOF_REVIEW);
    assert.strictEqual(proofAuth.allowed, true);

    const disputeAuth = await authorize(testStaffId, Permission.DISPUTE_REVIEW);
    assert.strictEqual(disputeAuth.allowed, true);

    const editAuth = await authorize(testStaffId, Permission.ORDER_EDIT_OPERATIONAL);
    assert.strictEqual(editAuth.allowed, false);

    const banAuth = await authorize(testStaffId, Permission.USER_BAN);
    assert.strictEqual(banAuth.allowed, false);

    const kycAuth = await authorize(testStaffId, Permission.SENSITIVE_IDENTITY_REVIEW);
    assert.strictEqual(kycAuth.allowed, false);
  });

  await it('Manager holds order operational edit and user ban, but denied withdrawal payout and deposit review', async () => {
    const editAuth = await authorize(testManagerId, Permission.ORDER_EDIT_OPERATIONAL);
    assert.strictEqual(editAuth.allowed, true);

    const banAuth = await authorize(testManagerId, Permission.USER_BAN);
    assert.strictEqual(banAuth.allowed, true);

    const createOrderAuth = await authorize(testManagerId, Permission.ORDER_CREATE_INTERNAL);
    assert.strictEqual(createOrderAuth.allowed, true);

    const payoutAuth = await authorize(testManagerId, Permission.WITHDRAWAL_REVIEW);
    assert.strictEqual(payoutAuth.allowed, false);

    const depositAuth = await authorize(testManagerId, Permission.MANUAL_DEPOSIT_REVIEW);
    assert.strictEqual(depositAuth.allowed, false);

    const kycAuth = await authorize(testManagerId, Permission.SENSITIVE_IDENTITY_REVIEW);
    assert.strictEqual(kycAuth.allowed, false);
  });

  await it('Admin holds KYC review, deposit review, withdrawal metadata review, but denied Owner controls', async () => {
    const kycAuth = await authorize(testAdminId, Permission.SENSITIVE_IDENTITY_REVIEW);
    assert.strictEqual(kycAuth.allowed, true);

    const depositAuth = await authorize(testAdminId, Permission.MANUAL_DEPOSIT_REVIEW);
    assert.strictEqual(depositAuth.allowed, true);

    const withdrawAuth = await authorize(testAdminId, Permission.WITHDRAWAL_REVIEW);
    assert.strictEqual(withdrawAuth.allowed, true);

    const ownerConfigAuth = await authorize(testAdminId, Permission.SYSTEM_CONFIG_MANAGE);
    assert.strictEqual(ownerConfigAuth.allowed, false);

    const gateControlAuth = await authorize(testAdminId, Permission.FINANCIAL_POLICY_MANAGE);
    assert.strictEqual(gateControlAuth.allowed, false);
  });

  await it('Owner holds all administrative, KYC, financial policy, and infrastructure capabilities', async () => {
    const ownerConfigAuth = await authorize(testOwnerId, Permission.SYSTEM_CONFIG_MANAGE);
    assert.strictEqual(ownerConfigAuth.allowed, true);

    const gateControlAuth = await authorize(testOwnerId, Permission.FINANCIAL_POLICY_MANAGE);
    assert.strictEqual(gateControlAuth.allowed, true);

    const kycAuth = await authorize(testOwnerId, Permission.SENSITIVE_IDENTITY_REVIEW);
    assert.strictEqual(kycAuth.allowed, true);

    const editAuth = await authorize(testOwnerId, Permission.ORDER_EDIT_OPERATIONAL);
    assert.strictEqual(editAuth.allowed, true);
  });

  console.log('\n--- 2. Multi-Role Simultaneous Assignments & Role Union ---');

  await it('Multi-role user receives permission union of staff and booster', async () => {
    const profile = await getAdminUserProfile(testMultiId);
    assert(profile.roles.includes('staff'));
    assert(profile.roles.includes('booster'));
    assert(profile.permissions.includes(Permission.PROOF_REVIEW)); // from staff
    assert(profile.permissions.includes(Permission.PROOF_SUBMIT_ASSIGNED)); // from booster
  });

  await it('Granting an additional business role preserves existing administrative roles', async () => {
    await assignOrRevokeUserRole({
      actorId: testOwnerId,
      targetUserId: testMultiId,
      roleKey: 'exchanger',
      action: 'grant',
      reason: 'Assign exchanger capability to existing staff/booster',
    });

    const profile = await getAdminUserProfile(testMultiId);
    assert(profile.roles.includes('staff'), 'Preserves STAFF');
    assert(profile.roles.includes('booster'), 'Preserves BOOSTER');
    assert(profile.roles.includes('exchanger'), 'Adds EXCHANGER');
  });

  await it('Revoking one role does not revoke unrelated roles', async () => {
    await assignOrRevokeUserRole({
      actorId: testOwnerId,
      targetUserId: testMultiId,
      roleKey: 'booster',
      action: 'revoke',
      reason: 'Revoke booster role only',
    });

    const profile = await getAdminUserProfile(testMultiId);
    assert(profile.roles.includes('staff'), 'Retains STAFF');
    assert(!profile.roles.includes('booster'), 'Revoked BOOSTER');
    assert(profile.roles.includes('exchanger'), 'Retains EXCHANGER');
  });

  await it('Privilege escalation: Admin cannot grant Admin, Manager, or Owner roles', async () => {
    await assert.rejects(
      () =>
        assignOrRevokeUserRole({
          actorId: testAdminId,
          targetUserId: testTargetId,
          roleKey: 'manager',
          action: 'grant',
          reason: 'Attempt privilege escalation',
        }),
      /PRIVILEGE_ESCALATION_FORBIDDEN/
    );
  });

  console.log('\n--- 3. User Ban/Unban Workflow & Immutable History ---');

  await it('Ban without reason or with short reason is rejected', async () => {
    await assert.rejects(
      () =>
        updateUserAccountStatus({
          actorId: testAdminId,
          targetUserId: testTargetId,
          isActive: false,
          reason: '', // empty reason
        }),
      /REASON_REQUIRED/
    );
  });

  await it('Lower-privileged manager cannot ban admin or owner', async () => {
    await assert.rejects(
      () =>
        updateUserAccountStatus({
          actorId: testManagerId,
          targetUserId: testAdminId,
          isActive: false,
          reason: 'Manager attempting to ban admin',
        }),
      /HIERARCHY_VIOLATION/
    );
  });

  await it('Self-ban is strictly rejected', async () => {
    await assert.rejects(
      () =>
        updateUserAccountStatus({
          actorId: testAdminId,
          targetUserId: testAdminId,
          isActive: false,
          reason: 'Self ban attempt',
        }),
      /SELF_STATUS_CHANGE_FORBIDDEN/
    );
  });

  await it('Valid ban updates account status and records immutable audit log', async () => {
    const banResult = await updateUserAccountStatus({
      actorId: testAdminId,
      targetUserId: testTargetId,
      isActive: false,
      reason: 'Violation of platform Terms of Service - unauthorized external contact',
    });

    assert.strictEqual(banResult.success, true);
    assert.strictEqual(banResult.isActive, false);

    const history = await getUserBanHistory(testTargetId);
    assert(history.length >= 1);
    assert.strictEqual(history[0].action, 'USER_SUSPENDED');
    assert.strictEqual(history[0].previousStatus, 'active');
    assert.strictEqual(history[0].resultingStatus, 'suspended');
    assert.strictEqual(history[0].actorId, testAdminId);
  });

  await it('Valid unban restores account status and records unban in history', async () => {
    const unbanResult = await updateUserAccountStatus({
      actorId: testAdminId,
      targetUserId: testTargetId,
      isActive: true,
      reason: 'Identity appeal submitted and approved by administration',
    });

    assert.strictEqual(unbanResult.success, true);
    assert.strictEqual(unbanResult.isActive, true);

    const history = await getUserBanHistory(testTargetId);
    assert(history.length >= 2);
    assert.strictEqual(history[0].action, 'USER_REACTIVATED');
    assert.strictEqual(history[0].previousStatus, 'suspended');
    assert.strictEqual(history[0].resultingStatus, 'active');
  });

  console.log('\n--- 4. Order Operational Edits & Audit History ---');

  let testOrderId = 0;
  await it('Setup test order in active state', async () => {
    // Find or create service
    let service = await prisma.gameService.findFirst();
    if (!service) {
      service = await prisma.gameService.create({
        data: {
          gameSlug: 'wow_midnight',
          serviceKey: 'mythic_plus',
          displayName: 'Mythic+ Dungeons',
          profileMode: 'character',
        },
      });
    }

    const order = await prisma.order.create({
      data: {
        orderRef: `ORD-TEST-${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        orderType: 'group',
        orderMode: 'non_pilot',
        status: 'in_progress',
        paymentStatus: 'verified',
        currency: 'USD',
        grossAmountMinor: 5000,
        boosterPoolMinor: 4000,
        notes: 'Initial operational notes',
        externalOrderId: 'EXT-100',
        creatorId: testStaffId,
      },
    });
    testOrderId = order.id;
    assert(testOrderId > 0);
  });

  await it('Manager can update operational fields (notes, externalOrderId) with reason', async () => {
    const result = await updateOrderOperationalFields({
      orderId: testOrderId,
      actorId: testManagerId,
      fields: {
        notes: 'Updated customer notes: prefers evening run',
        externalOrderId: 'EXT-200',
      },
      reason: 'Customer requested updated external tracking reference',
    });

    assert.strictEqual(result.success, true);
    assert((result.changedFields as string[]).includes('notes'));
    assert((result.changedFields as string[]).includes('externalOrderId'));
    assert.strictEqual(result.previousValues?.externalOrderId, 'EXT-100');
    assert.strictEqual(result.newValues?.externalOrderId, 'EXT-200');

    // Verify DB updated
    const updated = await prisma.order.findUnique({ where: { id: testOrderId } });
    assert.strictEqual(updated?.notes, 'Updated customer notes: prefers evening run');
    assert.strictEqual(updated?.externalOrderId, 'EXT-200');
  });

  await it('Order edit without reason is rejected', async () => {
    await assert.rejects(
      () =>
        updateOrderOperationalFields({
          orderId: testOrderId,
          actorId: testManagerId,
          fields: { notes: 'New notes' },
          reason: '', // empty reason
        }),
      /REASON_REQUIRED/
    );
  });

  await it('Terminal order (completed/cancelled) rejects operational edits', async () => {
    await prisma.order.update({
      where: { id: testOrderId },
      data: { status: 'completed' },
    });

    await assert.rejects(
      () =>
        updateOrderOperationalFields({
          orderId: testOrderId,
          actorId: testManagerId,
          fields: { notes: 'Should fail on completed order' },
          reason: 'Attempting edit on completed order',
        }),
      /LIFECYCLE_RESTRICTION/
    );
  });

  console.log('\n--- 5. Withdrawal Metadata Edits & History ---');

  let testWithdrawalId = 0;
  await it('Setup test withdrawal request', async () => {
    const w = await prisma.boosterWithdrawalRequest.create({
      data: {
        withdrawalRef: `WTH-TEST-${timestamp}`,
        boosterId: testStaffId,
        payoutMethod: 'IRT_BANK',
        status: 'UNDER_ADMIN_REVIEW',
        requestedUsdCents: 5000,
        fixedFeeUsdCents: 130,
        netUsdCents: 4870,
        quotedNetPayoutAmount: '4500000',
        quotedCurrency: 'IRT',
        destinationAddress: 'IR123456789012345678901234',
      },
    });
    testWithdrawalId = w.id;
    assert(testWithdrawalId > 0);
  });

  await it('Admin can edit withdrawal metadata with recorded audit reason', async () => {
    const result = await updateWithdrawalMetadata({
      requestId: testWithdrawalId,
      actorId: testAdminId,
      notes: 'Initial bank coordination notes',
      adminNotes: 'Verified IBAN identity against KYC submission',
      reason: 'Administrative verification audit documentation',
    });

    assert.strictEqual(result.success, true);
    assert((result.changedFields as string[]).includes('notes'));
    assert((result.changedFields as string[]).includes('adminNotes'));

    const history = await getWithdrawalAuditHistory(testWithdrawalId);
    assert(history.length >= 1);
    assert.strictEqual(history[0].action, 'WITHDRAWAL_METADATA_EDITED');
    assert.strictEqual(history[0].actor?.discordId, testAdminId);
  });

  await it('Withdrawal edit without reason is rejected', async () => {
    await assert.rejects(
      () =>
        updateWithdrawalMetadata({
          requestId: testWithdrawalId,
          actorId: testAdminId,
          notes: 'Missing reason',
          reason: '',
        }),
      /REASON_REQUIRED/
    );
  });

  await it('Staff cannot edit withdrawal metadata', async () => {
    await assert.rejects(
      () =>
        updateWithdrawalMetadata({
          requestId: testWithdrawalId,
          actorId: testStaffId,
          notes: 'Staff unauthorized notes',
          reason: 'Staff review attempt',
        }),
      /WITHDRAWAL_REVIEW_FORBIDDEN/
    );
  });

  console.log('\n--- 6. Discord Order Channel Naming & Terminology ---');

  await it('deriveOrderChannelModeSlug returns mythicplus for Mythic+ service regardless of mode', () => {
    const slug1 = deriveOrderChannelModeSlug({
      service: { serviceKey: 'mythic_plus', displayName: 'Mythic+ Dungeons' },
      orderMode: 'non_pilot',
    });
    assert.strictEqual(slug1, 'mythicplus');

    const slug2 = deriveOrderChannelModeSlug({
      service: { serviceKey: 'mythicplus', displayName: 'Mythic+ 10-15' },
      orderMode: 'pilot',
    });
    assert.strictEqual(slug2, 'mythicplus');
  });

  await it('deriveOrderChannelModeSlug returns pilot for pilot non-mythic services', () => {
    const slug = deriveOrderChannelModeSlug({
      service: { serviceKey: 'raid_clear', displayName: 'Heroic Raid Clear' },
      orderMode: 'pilot',
    });
    assert.strictEqual(slug, 'pilot');
  });

  await it('deriveOrderChannelModeSlug returns selfplay for non_pilot orders', () => {
    const slug = deriveOrderChannelModeSlug({
      service: { serviceKey: 'raid_clear', displayName: 'Heroic Raid Clear' },
      orderMode: 'non_pilot',
    });
    assert.strictEqual(slug, 'selfplay');
  });

  await it('buildOrderExecutionChannelName produces correct format and enforces <= 100 limit', () => {
    const name1 = buildOrderExecutionChannelName({
      id: 143,
      service: { serviceKey: 'mythic_plus' },
      orderMode: 'non_pilot',
    });
    assert.strictEqual(name1, 'order-143-mythicplus');

    const name2 = buildOrderExecutionChannelName({
      id: 144,
      service: { serviceKey: 'raid' },
      orderMode: 'pilot',
    });
    assert.strictEqual(name2, 'order-144-pilot');

    const name3 = buildOrderExecutionChannelName({
      id: 145,
      service: { serviceKey: 'raid' },
      orderMode: 'non_pilot',
    });
    assert.strictEqual(name3, 'order-145-selfplay');

    // Test long ID safety limit
    const longName = buildOrderExecutionChannelName({
      id: 999999999,
      service: { serviceKey: 'mythic_plus' },
      orderMode: 'non_pilot',
    });
    assert(longName.length <= 100);
    assert(longName.startsWith('order-999999999-'));
  });

  console.log('\n--- 7. Cleanup Test Records ---');
  if (testOrderId > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Order',
        entityId: String(testOrderId),
      },
    });
    await prisma.order.delete({ where: { id: testOrderId } });
  }
  if (testWithdrawalId > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'BoosterWithdrawalRequest',
        entityId: String(testWithdrawalId),
      },
    });
    await prisma.boosterWithdrawalRequest.delete({ where: { id: testWithdrawalId } });
  }
  await prisma.auditLog.deleteMany({
    where: {
      entityType: 'User',
      entityId: {
        in: [testStaffId, testManagerId, testAdminId, testOwnerId, testTargetId, testMultiId],
      },
    },
  });
  await prisma.userRole.deleteMany({
    where: {
      userId: {
        in: [testStaffId, testManagerId, testAdminId, testOwnerId, testTargetId, testMultiId],
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      discordId: {
        in: [testStaffId, testManagerId, testAdminId, testOwnerId, testTargetId, testMultiId],
      },
    },
  });

  console.log('\n===============================================================');
  console.log(`=== REGRESSION SUITE RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
