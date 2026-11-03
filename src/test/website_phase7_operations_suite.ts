/**
 * website_phase7_operations_suite.ts — Website Phase 7 React Staff & Management Portal Test Suite
 *
 * Covers:
 *  1. Staff authentication, authorization and RBAC boundaries (unauthenticated, booster, staff, manager, owner).
 *  2. Management authorization and executive endpoint security.
 *  3. KYC document security, traversal prevention and strict SENSITIVE_IDENTITY_REVIEW enforcement:
 *     - Authorized KYC document belonging to selected application (200 OK with no-store, nosniff).
 *     - Document belonging to another application rejected with 403 DOCUMENT_NOT_ASSOCIATED.
 *     - Arbitrary valid-looking filename rejected with 403.
 *     - Missing document or application metadata fails closed (404).
 *     - Symlink escape and directory traversal rejection.
 *  4. Live Authorization & Stale Session Role Revocation:
 *     - Staff attempting KYC approval rejected with 403.
 *     - Stale manager session role rejected immediately upon DB role revocation.
 *     - Unauthorized application approval rejected (Admin cannot approve Advertiser app).
 *  5. Anti self-approval enforcement across proofs, disputes, applications, and KYC decisions.
 *  6. Duplicate decision and state transition prevention (terminal locked, duplicate KYC rejected).
 *  7. CSRF mutation protection.
 *  8. Financial safety and gate integrity (no phantom wallet credits, all 5 live gates disabled).
 */

import assert from 'assert';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { Permission } from '../services/permissionTypes';

const KYC_DOCS_DIR = path.join(process.cwd(), 'storage', 'kyc_documents');
if (!fs.existsSync(KYC_DOCS_DIR)) {
  fs.mkdirSync(KYC_DOCS_DIR, { recursive: true });
}

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
  const testAdminId = `phase7_admin_${timestamp}`;
  const testManagerId = `phase7_manager_${timestamp}`;
  const testOwnerId = `phase7_owner_${timestamp}`;
  const tempManagerId = `phase7_temp_manager_${timestamp}`;

  const docAName = `kyc_doc_a_${timestamp}.png`;
  const docBName = `kyc_doc_b_${timestamp}.png`;
  const docAPath = path.join(KYC_DOCS_DIR, docAName);
  const docBPath = path.join(KYC_DOCS_DIR, docBName);

  try {
    // 0. Seed test roles if not present
    const rolesToEnsure = ['booster', 'staff', 'admin', 'manager', 'owner'];
    for (const r of rolesToEnsure) {
      await prisma.role.upsert({
        where: { roleKey: r },
        update: {},
        create: { roleKey: r, name: `${r.toUpperCase()} Role` },
      });
    }

    // Create test dummy files
    fs.writeFileSync(docAPath, 'VALID_KYC_DOCUMENT_A_PAYLOAD');
    fs.writeFileSync(docBPath, 'VALID_KYC_DOCUMENT_B_PAYLOAD');

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
        discordId: testAdminId,
        username: `admin_${timestamp}`,
        userRoles: { create: [{ roleKey: 'admin' }] },
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

    await prisma.user.create({
      data: {
        discordId: tempManagerId,
        username: `temp_mgr_${timestamp}`,
        userRoles: { create: [{ roleKey: 'manager' }] },
      },
    });

    console.log('[Phase 7 Test] Test users and dummy KYC files seeded successfully.');

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

    console.log('✓ Unauthenticated and unprivileged access denied appropriately (401/403)');

    // -------------------------------------------------------------------------
    // TEST 2: Staff Portal Capabilities & Boundaries
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Staff portal endpoints with authorized Staff user...');

    const staffAgent = await createAuthenticatedAgent(testStaffId);
    const staffOverviewRes = await staffAgent.agent.get('/api/staff/overview');
    assert.strictEqual(staffOverviewRes.status, 200, 'Staff user must be able to access /api/staff/overview');
    assert.strictEqual(staffOverviewRes.body.success, true);
    assert.strictEqual(typeof staffOverviewRes.body.metrics.pendingProofsCount, 'number');

    const staffProofsRes = await staffAgent.agent.get('/api/staff/pending-proofs');
    assert.strictEqual(staffProofsRes.status, 200, 'Staff user must be able to access /api/staff/pending-proofs');
    assert.ok(Array.isArray(staffProofsRes.body.proofs), 'Proofs must return an array');

    // Staff cannot access Management or KYC overview
    const staffMgmtRes = await staffAgent.agent.get('/api/management/overview');
    assert.strictEqual(staffMgmtRes.status, 403, 'Staff user must be denied access to /api/management/overview');

    const staffKycRes = await staffAgent.agent.get('/api/management/kyc/applications');
    assert.strictEqual(staffKycRes.status, 403, 'Staff user must be denied access to /api/management/kyc/applications');

    console.log('✓ Staff operational capabilities verified and management/KYC boundaries enforced');

    // -------------------------------------------------------------------------
    // TEST 3: Management Portal Executive Capabilities
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Testing Management portal endpoints with authorized Manager user...');

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
    console.log('\n[Test 4] Testing KYC document security, application binding and traversal prevention...');

    // Seed test applications with registered documents
    const appA = await prisma.registrationApplication.create({
      data: {
        userId: testBoosterId,
        category: 'pilot',
        gameSlug: 'wow_midnight',
        status: 'pending',
        identityStatus: 'awaiting_submission',
        qualifications: JSON.stringify({
          identityDocumentRef: docAName,
          selfieDocumentRef: docAName,
        }),
      },
    });

    await prisma.pilotVerification.create({
      data: {
        userId: testBoosterId,
        gameSlug: 'wow_midnight',
        status: 'pending',
        identityDocumentRef: docAName,
        selfieDocumentRef: docAName,
      },
    });

    const appB = await prisma.registrationApplication.create({
      data: {
        userId: testStaffId,
        category: 'pilot',
        gameSlug: 'wow_midnight',
        status: 'pending',
        identityStatus: 'awaiting_submission',
        qualifications: JSON.stringify({
          identityDocumentRef: docBName,
          selfieDocumentRef: docBName,
        }),
      },
    });

    // 4a: Staff cannot access KYC document viewer
    const staffDocRes = await staffAgent.agent.get(`/api/management/kyc/applications/${appA.id}/documents/identityDoc`);
    assert.strictEqual(staffDocRes.status, 403, 'Staff user must be denied access to KYC document viewer');

    // 4b: Path traversal attempts fail closed
    const traversalRes1 = await managerAgent.agent.get('/api/management/kyc/documents/..%2F..%2Fetc%2Fpasswd');
    assert.strictEqual(traversalRes1.status, 400, 'Path traversal ../ must be rejected with 400');
    assert.strictEqual(traversalRes1.body.error, 'PATH_TRAVERSAL_DETECTED');

    const traversalRes2 = await managerAgent.agent.get('/api/management/kyc/documents/..%5C..%5Csecret.txt');
    assert.strictEqual(traversalRes2.status, 400, 'Path traversal ..\\ must be rejected with 400');
    assert.strictEqual(traversalRes2.body.error, 'PATH_TRAVERSAL_DETECTED');

    // 4c: Authorized KYC document belonging to selected application returns 200 with security headers
    const authDocRes = await managerAgent.agent.get(`/api/management/kyc/applications/${appA.id}/documents/identityDoc`);
    assert.strictEqual(authDocRes.status, 200, 'Authorized KYC document for application must return 200');
    assert.strictEqual(authDocRes.headers['x-content-type-options'], 'nosniff');
    assert.ok(authDocRes.headers['cache-control']?.includes('no-store'), 'Must include no-store header');

    // 4d: Document belonging to another application rejected with 403 DOCUMENT_NOT_ASSOCIATED
    const crossAppDocRes = await managerAgent.agent.get(`/api/management/kyc/documents/${docBName}?applicationId=${appA.id}`);
    assert.strictEqual(crossAppDocRes.status, 403, 'Document belonging to appB cannot be fetched under appA');
    assert.strictEqual(crossAppDocRes.body.error, 'DOCUMENT_NOT_ASSOCIATED');

    // 4e: Arbitrary valid-looking filename without matching DB record rejected with 403
    const arbitraryDocRes = await managerAgent.agent.get(`/api/management/kyc/documents/unrelated_secret.png?applicationId=${appA.id}`);
    assert.strictEqual(arbitraryDocRes.status, 403, 'Unregistered document reference must be rejected with 403');
    assert.strictEqual(arbitraryDocRes.body.error, 'DOCUMENT_NOT_ASSOCIATED');

    // 4f: Missing document or application metadata fails closed
    const missingAppRes = await managerAgent.agent.get('/api/management/kyc/applications/999999/documents/identityDoc');
    assert.strictEqual(missingAppRes.status, 404, 'Non-existent application must return 404');
    assert.strictEqual(missingAppRes.body.error, 'APPLICATION_NOT_FOUND');

    // 4g: Symlink escape protection
    const symlinkPath = path.join(KYC_DOCS_DIR, `symlink_escape_${timestamp}.png`);
    let symlinkCreated = false;
    try {
      fs.symlinkSync(path.join(process.cwd(), 'package.json'), symlinkPath);
      symlinkCreated = true;
    } catch {
      // Symlink creation might require Developer Mode/Admin on Windows; fallback noted
    }

    if (symlinkCreated) {
      try {
        const symlinkApp = await prisma.registrationApplication.create({
          data: {
            userId: testBoosterId,
            category: 'pilot',
            status: 'pending',
            identityStatus: 'awaiting_submission',
            qualifications: JSON.stringify({ identityDocumentRef: path.basename(symlinkPath) }),
          },
        });
        const symlinkRes = await managerAgent.agent.get(`/api/management/kyc/applications/${symlinkApp.id}/documents/identityDoc`);
        assert.strictEqual(symlinkRes.status, 403, 'Symlink escaping storage directory must be rejected with 403');
        assert.ok(['ILLEGAL_LINK_DETECTED', 'PATH_TRAVERSAL_DETECTED'].includes(symlinkRes.body.error));
        await prisma.registrationApplication.delete({ where: { id: symlinkApp.id } });
      } finally {
        fs.unlinkSync(symlinkPath);
      }
    }

    console.log('✓ KYC documents protected: Ownership bound, cross-app access blocked, security headers verified');

    // -------------------------------------------------------------------------
    // TEST 5: Live Authorization & Stale Session Revocation
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Testing live server-authoritative authorization and stale session revocation...');

    // 5a: Staff attempting KYC approval rejected
    const staffKycDecisionRes = await staffAgent.agent
      .post(`/api/management/kyc/applications/${appA.id}/decision`)
      .set('x-csrf-token', staffAgent.csrfToken || '')
      .send({ decision: 'verify_identity' });
    assert.strictEqual(staffKycDecisionRes.status, 403, 'Staff user must be rejected with 403 on KYC decision');
    assert.strictEqual(staffKycDecisionRes.body.error, 'PERMISSION_DENIED');

    // 5b: Stale manager session role rejected immediately upon DB role deletion
    const tempMgrAgent = await createAuthenticatedAgent(tempManagerId);
    const activeMgrCheck = await tempMgrAgent.agent.get('/api/management/overview');
    assert.strictEqual(activeMgrCheck.status, 200, 'Initial active manager session must have access');

    // Revoke manager role directly in database
    await prisma.userRole.deleteMany({ where: { userId: tempManagerId } });

    // Stale session attempt
    const staleMgrCheck = await tempMgrAgent.agent.get('/api/management/overview');
    assert.strictEqual(staleMgrCheck.status, 403, 'Revoked manager role must immediately fail on next request (stale session rejected)');
    assert.strictEqual(staleMgrCheck.body.error, 'MANAGEMENT_ACCESS_DENIED');

    // 5c: Unauthorized application approval (Admin attempting to approve Advertiser application)
    const adminAgent = await createAuthenticatedAgent(testAdminId);
    const advApp = await prisma.registrationApplication.create({
      data: {
        userId: testBoosterId,
        category: 'advertiser',
        status: 'pending',
        identityStatus: 'none',
        qualifications: JSON.stringify({ company: 'Test Adv' }),
      },
    });

    const adminAdvReviewRes = await adminAgent.agent
      .post(`/api/management/applications/${advApp.id}/review`)
      .set('x-csrf-token', adminAgent.csrfToken || '')
      .send({ decision: 'approve', reviewerNotes: 'Unauthorized admin approval attempt' });

    assert.strictEqual(adminAdvReviewRes.status, 403, 'Admin without ADVERTISER_APPLICATION_REVIEW permission must be rejected with 403');
    assert.strictEqual(adminAdvReviewRes.body.error, 'UNAUTHORIZED_REVIEWER');

    console.log('✓ Live authorization enforced: Revocations reject stale sessions, role boundaries respected');

    // -------------------------------------------------------------------------
    // TEST 6: Anti Self-Approval Enforcement (Proofs, Disputes, Applications, KYC)
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Testing Anti Self-Approval enforcement across all workflows...');

    // 6a: Proof Anti Self-Approval
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

    // Non-submitter manager approves the proof
    const otherProofRes = await managerAgent.agent
      .post(`/api/staff/proofs/${testProof.id}/review`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ action: 'approved', notes: 'Valid review by manager' });

    assert.strictEqual(otherProofRes.status, 200, 'Non-submitter staff/manager can review proof');
    assert.strictEqual(otherProofRes.body.success, true);
    assert.strictEqual(otherProofRes.body.proof.status, 'approved');

    // 6b: Dispute Anti Self-Resolution
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

    // 6c: Application Anti Self-Review
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

    // 6d: KYC Anti Self-Review
    const selfKycDecisionRes = await managerAgent.agent
      .post(`/api/management/kyc/applications/${testApp.id}/decision`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ decision: 'verify_identity' });

    assert.strictEqual(selfKycDecisionRes.status, 403, 'Reviewer cannot verify their own KYC application');
    assert.strictEqual(selfKycDecisionRes.body.error, 'SELF_REVIEW_PROHIBITED');

    console.log('✓ Anti self-approval strictly enforced across proofs, disputes, applications, and KYC');

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate Decision & State Transition Prevention
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Testing duplicate decisions and state transition validation...');

    // Attempting to review the already approved proof again
    const dupProofRes = await managerAgent.agent
      .post(`/api/staff/proofs/${testProof.id}/review`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ action: 'approved', notes: 'Second approval attempt' });

    assert.strictEqual(dupProofRes.status, 400, 'Duplicate proof review must be rejected with 400');
    assert.strictEqual(dupProofRes.body.error, 'PROOF_ALREADY_REVIEWED');

    // Manager verifies identity on appA
    const kycVerifyRes = await managerAgent.agent
      .post(`/api/management/kyc/applications/${appA.id}/decision`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ decision: 'verify_identity', reviewNotes: 'Verified with valid ID and selfie' });
    assert.strictEqual(kycVerifyRes.status, 200, 'Manager can verify identity with valid documents');

    // Attempting duplicate verify_identity on already verified application
    const dupKycVerifyRes = await managerAgent.agent
      .post(`/api/management/kyc/applications/${appA.id}/decision`)
      .set('x-csrf-token', managerAgent.csrfToken || '')
      .send({ decision: 'verify_identity', reviewNotes: 'Duplicate verification attempt' });
    assert.strictEqual(dupKycVerifyRes.status, 400, 'Duplicate identity verification must be rejected');

    console.log('✓ Duplicate decisions on closed entities rejected fail-closed');

    // -------------------------------------------------------------------------
    // TEST 8: CSRF & Financial Integrity
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] Testing CSRF enforcement and financial safety...');

    // 8a: CSRF validation failure on missing token
    const noCsrfRes = await managerAgent.agent
      .post(`/api/management/orders/${testOrder.id}/approve`)
      .send({ notes: 'No CSRF token provided' });
    assert.strictEqual(noCsrfRes.status, 403, 'Mutations without CSRF token must fail with 403');
    assert.strictEqual(noCsrfRes.body.error, 'Forbidden');
    assert.strictEqual(noCsrfRes.body.message, 'Invalid or missing CSRF token');

    // 8b: No phantom wallet credits created
    const boosterWallet = await prisma.wallet.findUnique({ where: { userId: testBoosterId } });
    assert.strictEqual(boosterWallet?.balanceUsd || 0, 0, 'No wallet balance should be credited from operational/KYC decisions');

    // 8c: Financial feature gates remain disabled
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
    if (fs.existsSync(docAPath)) fs.unlinkSync(docAPath);
    if (fs.existsSync(docBPath)) fs.unlinkSync(docBPath);

    await prisma.pilotVerification.deleteMany({ where: { userId: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.runProof.deleteMany({ where: { submittedById: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.orderDispute.deleteMany({ where: { openedById: { in: [testBoosterId, testStaffId, testManagerId] } } }).catch(() => {});
    await prisma.orderRun.deleteMany({ where: { order: { orderRef: { startsWith: 'ORD-P7-' } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { orderRef: { startsWith: 'ORD-P7-' } } }).catch(() => {});
    await prisma.registrationApplication.deleteMany({ where: { userId: { in: [testBoosterId, testStaffId, testManagerId, tempManagerId] } } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [testBoosterId, testStaffId, testAdminId, testManagerId, testOwnerId, tempManagerId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { discordId: { in: [testBoosterId, testStaffId, testAdminId, testManagerId, testOwnerId, tempManagerId] } } }).catch(() => {});
  }
}

// Direct execution runner
if (require.main === module) {
  runPhase7OperationsSuite()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runPhase7OperationsSuite };
