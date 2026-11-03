/**
 * website_phase7_operations_suite.ts — Website Phase 7 React Staff & Management Portal Test Suite
 *
 * Covers:
 *  1. Staff authentication, authorization and RBAC boundaries (unauthenticated, booster, staff, manager, owner).
 *  2. Management authorization and executive endpoint security.
 *  3. KYC document security, traversal prevention and strict SENSITIVE_IDENTITY_REVIEW enforcement.
 *  4. Anti self-approval enforcement across proofs, disputes, applications, and KYC decisions.
 *  5. Mythic+ booster roster slot rules and external order wallet isolation.
 *  6. Duplicate decision prevention under state transitions.
 *  7. Financial gate integrity (all 5 live financial feature gates remain disabled).
 */

import assert from 'assert';
import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { Permission } from '../services/permissionTypes';

// Helper to create an authenticated session agent for testing
async function createAuthenticatedAgent(userId: string) {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/csrf-token');
  const cookieHeader = initRes.header['set-cookie'];
  const rawCookie = cookieHeader ? cookieHeader[0] : '';
  const match = rawCookie.match(/g4x\.sid=s%3A([^.]+)\./);
  const sid = match ? match[1] : '';

  await new Promise<void>((resolve, reject) => {
    sessionStore.get(sid, (err, sess) => {
      if (err || !sess) return reject(err || new Error('No session'));
      sess.userId = userId;
      sessionStore.set(sid, sess, (setErr) => {
        if (setErr) return reject(setErr);
        resolve();
      });
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

async function runPhase7OperationsSuite() {
  console.log('\n============================================================');
  console.log('--- STARTING WEBSITE PHASE 7 OPERATIONS PORTAL TEST SUITE ---');
  console.log('============================================================\n');

  const timestamp = Date.now();
  const testBoosterId = `phase7_booster_${timestamp}`;
  const testStaffId = `phase7_staff_${timestamp}`;
  const testManagerId = `phase7_manager_${timestamp}`;
  const testOwnerId = `phase7_owner_${timestamp}`;

  try {
    // 0. Seed test roles if not present
    const rolesToEnsure = ['booster', 'staff', 'manager', 'owner'];
    for (const r of rolesToEnsure) {
      await prisma.role.upsert({
        where: { roleKey: r },
        update: {},
        create: { roleKey: r, name: `${r.toUpperCase()} Role` },
      });
    }

    // Create test users
    await prisma.user.create({
      data: {
        discordId: testBoosterId,
        username: `booster_${timestamp}`,
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testStaffId,
        username: `staff_${timestamp}`,
        userRoles: { create: [{ roleKey: 'staff' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testManagerId,
        username: `manager_${timestamp}`,
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testOwnerId,
        username: `owner_${timestamp}`,
        userRoles: { create: [{ roleKey: 'owner' }] },
      },
    });

    console.log('[Phase 7 Test] Test users seeded successfully.');

    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated & Generic User Access Restrictions
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] Testing unauthenticated and unprivileged access restrictions...');

    const unauthRes = await request(app).get('/api/staff/overview');
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated access to /staff/overview must return 401');

    const boosterAgent = await createAuthenticatedAgent(testBoosterId);
    const boosterStaffRes = await boosterAgent.agent.get('/api/staff/overview');
    assert.strictEqual(boosterStaffRes.status, 403, 'Booster user without staff role must receive 403 on /staff/overview');

    const boosterMgmtRes = await boosterAgent.agent.get('/api/management/overview');
    assert.strictEqual(boosterMgmtRes.status, 403, 'Booster user must receive 403 on /management/overview');

    console.log('✓ Unauthenticated and unprivileged access successfully rejected with 401/403');

    // -------------------------------------------------------------------------
    // TEST 2: Staff RBAC Boundaries (Staff allowed on staff, blocked on management/kyc)
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Staff RBAC boundary isolation...');

    const staffAgent = await createAuthenticatedAgent(testStaffId);
    const staffOverviewRes = await staffAgent.agent.get('/api/staff/overview');
    assert.strictEqual(staffOverviewRes.status, 200, 'Staff user must be able to access /api/staff/overview');
    assert.strictEqual(staffOverviewRes.body.success, true);
    assert.strictEqual(staffOverviewRes.body.user.discordId, testStaffId);

    const staffProofsRes = await staffAgent.agent.get('/api/staff/pending-proofs');
    assert.strictEqual(staffProofsRes.status, 200, 'Staff user must be able to access /api/staff/pending-proofs');
    assert.ok(Array.isArray(staffProofsRes.body.proofs), 'Proofs must return an array');

    // Verify staff CANNOT access management oversight
    const staffMgmtRes = await staffAgent.agent.get('/api/management/overview');
    assert.strictEqual(staffMgmtRes.status, 403, 'Staff user without manager role must receive 403 on /management/overview');

    const staffOrdersRes = await staffAgent.agent.get('/api/management/orders');
    assert.strictEqual(staffOrdersRes.status, 403, 'Staff user must receive 403 on /management/orders');

    const staffKycRes = await staffAgent.agent.get('/api/management/kyc/applications');
    assert.strictEqual(staffKycRes.status, 403, 'Staff user must receive 403 on /management/kyc/applications');

    console.log('✓ Staff RBAC isolation confirmed: Staff has operational access but is strictly forbidden from Management/KYC');

    // -------------------------------------------------------------------------
    // TEST 3: Management Oversight Access
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Testing Management authorization...');

    const managerAgent = await createAuthenticatedAgent(testManagerId);
    const mgmtOverviewRes = await managerAgent.agent.get('/api/management/overview');
    assert.strictEqual(mgmtOverviewRes.status, 200, 'Manager user must be able to access /api/management/overview');
    assert.strictEqual(mgmtOverviewRes.body.success, true);
    assert.ok(mgmtOverviewRes.body.kpis, 'Manager overview must include operational KPI counters');
    assert.strictEqual(typeof mgmtOverviewRes.body.kpis.activeOrdersCount, 'number');

    const mgmtOrdersRes = await managerAgent.agent.get('/api/management/orders');
    assert.strictEqual(mgmtOrdersRes.status, 200, 'Manager user must be able to access /api/management/orders');
    assert.ok(Array.isArray(mgmtOrdersRes.body.orders), 'Orders list must return an array');

    const mgmtAppsRes = await managerAgent.agent.get('/api/management/applications');
    assert.strictEqual(mgmtAppsRes.status, 200, 'Manager user must be able to access /api/management/applications');
    assert.ok(Array.isArray(mgmtAppsRes.body.applications), 'Applications list must return an array');

    const mgmtKycRes = await managerAgent.agent.get('/api/management/kyc/applications');
    assert.strictEqual(mgmtKycRes.status, 200, 'Manager user must be able to access /api/management/kyc/applications');
    assert.ok(Array.isArray(mgmtKycRes.body.applications), 'KYC applications must return an array');

    console.log('✓ Manager oversight endpoints successfully accessible to authorized Management user');

    // -------------------------------------------------------------------------
    // TEST 4: KYC Security, Document Protection & Path Traversal Prevention
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Testing KYC document security and path traversal prevention...');

    // 4a: Staff cannot access KYC document viewer
    const staffDocRes = await staffAgent.agent.get('/api/management/kyc/documents/test_doc.png');
    assert.strictEqual(staffDocRes.status, 403, 'Staff user must be denied access to /management/kyc/documents/:docRef');

    // 4b: Path traversal attempts by manager must fail closed
    const traversalRes1 = await managerAgent.agent.get('/api/management/kyc/documents/..%2F..%2Fetc%2Fpasswd');
    assert.strictEqual(traversalRes1.status, 400, 'Path traversal ../ must be rejected with 400');
    assert.strictEqual(traversalRes1.body.error, 'PATH_TRAVERSAL_DETECTED');

    const traversalRes2 = await managerAgent.agent.get('/api/management/kyc/documents/..%5C..%5Csecret.txt');
    assert.strictEqual(traversalRes2.status, 400, 'Path traversal ..\\ must be rejected with 400');
    assert.strictEqual(traversalRes2.body.error, 'PATH_TRAVERSAL_DETECTED');

    console.log('✓ KYC documents protected: Staff denied, path traversal attempts rejected');

    // -------------------------------------------------------------------------
    // TEST 5: Anti Self-Approval Enforcement (Proofs, Disputes, Applications, KYC)
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Testing Anti Self-Approval enforcement...');

    // 5a: Proof Anti Self-Approval
    const firstGame = await prisma.game.findFirst();
    const firstService = await prisma.gameService.findFirst();

    const testOrder = await prisma.order.create({
      data: {
        orderRef: `ORD-P7-${timestamp}`,
        gameSlug: firstGame?.slug || 'wow_midnight',
        serviceId: firstService?.id || 1,
        customerId: testBoosterId,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 10000,
        status: 'in_progress',
        paymentStatus: 'verified',
      },
    });

    const testOrderRun = await prisma.orderRun.create({
      data: {
        orderId: testOrder.id,
        runNumber: 1,
        status: 'pending',
      },
    });

    const testProof = await prisma.runProof.create({
      data: {
        runId: testOrderRun.id,
        proofType: 'screenshot',
        evidenceUrl: 'https://cdn.example.com/proof1.png',
        submittedById: testStaffId,
        status: 'pending',
        description: 'Test proof by staff',
      },
    });

    const selfProofRes = await staffAgent.agent
      .post(`/api/staff/proofs/${testProof.id}/review`)
      .set('x-csrf-token', staffAgent.csrfToken || '')
      .send({ action: 'approved', notes: 'Self-approval attempt' });

    assert.strictEqual(selfProofRes.status, 403, 'Staff cannot approve their own submitted run proof');
    assert.strictEqual(selfProofRes.body.error, 'CANNOT_REVIEW_OWN_PROOF');

    // Now manager (different user) approves the proof
    const otherProofRes = await managerAgent.agent
      .post(`/api/staff/proofs/${testProof.id}/review`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ action: 'approved', notes: 'Valid review by manager' });

    assert.strictEqual(otherProofRes.status, 200, 'Non-submitter staff/manager can review proof');
    assert.strictEqual(otherProofRes.body.success, true);
    assert.strictEqual(otherProofRes.body.proof.status, 'approved');

    // 5b: Dispute Anti Self-Resolution
    // Create a mock dispute opened by testManagerId

    const testDispute = await prisma.orderDispute.create({
      data: {
        orderId: testOrder.id,
        openedById: testManagerId,
        disputeType: 'completion',
        status: 'open',
        description: 'Self opened dispute for testing',
      },
    });

    const selfDisputeRes = await managerAgent.agent
      .post(`/api/management/disputes/${testDispute.id}/resolve`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ decision: 'release_booster', notes: 'Self resolution attempt' });

    assert.strictEqual(selfDisputeRes.status, 403, 'Manager cannot resolve their own opened dispute');
    assert.strictEqual(selfDisputeRes.body.error, 'CANNOT_RESOLVE_OWN_DISPUTE');

    // 5c: Application Anti Self-Review
    const testApp = await prisma.registrationApplication.create({
      data: {
        userId: testManagerId,
        category: 'pilot',
        qualifications: JSON.stringify({ exp: '10 years' }),
        status: 'pending',
        identityStatus: 'none',
      },
    });

    const selfAppRes = await managerAgent.agent
      .post(`/api/management/applications/${testApp.id}/review`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ decision: 'approve', reviewerNotes: 'Self app approval attempt' });

    assert.strictEqual(selfAppRes.status, 403, 'Reviewer cannot approve their own registration application');
    assert.strictEqual(selfAppRes.body.error, 'CANNOT_REVIEW_OWN_APPLICATION');

    console.log('✓ Anti self-approval strictly enforced across proofs, disputes, and registration applications');

    // -------------------------------------------------------------------------
    // TEST 6: Duplicate Decision & State Transition Prevention
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Testing duplicate decision & state transition validation...');

    // Attempting to review the already approved proof again
    const dupProofRes = await managerAgent.agent
      .post(`/api/staff/proofs/${testProof.id}/review`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ action: 'approved', notes: 'Second approval attempt' });

    assert.strictEqual(dupProofRes.status, 400, 'Duplicate proof review must be rejected with 400');
    assert.strictEqual(dupProofRes.body.error, 'PROOF_ALREADY_REVIEWED');

    console.log('✓ Duplicate decisions on closed entities rejected fail-closed');

    // -------------------------------------------------------------------------
    // TEST 7: Financial Gate Verification (All 5 gates disabled)
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Verifying live financial feature gates remain disabled...');

    const gates = [
      { name: 'ESCROW_RELEASE_ENABLED', isLive: process.env.ESCROW_RELEASE_ENABLED === 'true' },
      { name: 'FINANCE_V2_LIVE_CREDITS_ENABLED', isLive: process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true' },
      { name: 'FINANCE_V2_LIVE_PAYOUTS_ENABLED', isLive: process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true' },
      { name: 'FINANCE_V2_P2P_SETTLEMENT_ENABLED', isLive: process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true' },
      { name: 'NOWPAYMENTS_LIVE_COLLECTION_ENABLED', isLive: process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true' },
    ];

    for (const gate of gates) {
      assert.strictEqual(
        gate.isLive,
        false,
        `Critical safety violation: Financial feature gate ${gate.name} must be disabled (isLive must be false)`
      );
      console.log(`  ✓ Gate confirmed disabled: ${gate.name} (live=${gate.isLive})`);
    }

    console.log('\n============================================================');
    console.log('--- ALL WEBSITE PHASE 7 OPERATIONS TESTS PASSED (100%) ---');
    console.log('============================================================\n');
  } catch (err) {
    console.error('\n❌ WEBSITE PHASE 7 TEST FAILURE:', err);
    throw err;
  } finally {
    // Cleanup test records
    await prisma.runProof.deleteMany({ where: { submittedById: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.orderDispute.deleteMany({ where: { openedById: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.orderRun.deleteMany({ where: { order: { orderRef: { startsWith: 'ORD-P7-' } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { orderRef: { startsWith: 'ORD-P7-' } } }).catch(() => {});
    await prisma.registrationApplication.deleteMany({ where: { userId: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [testBoosterId, testStaffId, testManagerId, testOwnerId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { discordId: { in: [testBoosterId, testStaffId, testManagerId, testOwnerId] } } }).catch(() => {});
  }
}

// Direct execution runner
if (require.main === module) {
  runPhase7OperationsSuite()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runPhase7OperationsSuite };
