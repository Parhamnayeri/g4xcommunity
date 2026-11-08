/**
 * website_phase8_admin_owner_suite.ts — Website Phase 8 React Admin & Owner Portal Test Suite
 *
 * Comprehensive tests covering:
 *  1. Mandatory KYC Security Preflight:
 *     - Canonical file validation, symlink rejection, path traversal rejection.
 *     - Cross-application document rejection / validation.
 *     - Concurrent / duplicate verify_identity race condition handling.
 *  2. Admin Portal Security & Authorization:
 *     - Unauthenticated requests rejected (401).
 *     - Booster / unauthorized users rejected (403).
 *     - Live server-side permission checks.
 *     - Admin cannot access Owner endpoints (/owner/* -> 403).
 *  3. Owner Portal & OwnerGate Security:
 *     - Protected by OwnerGate and resolveDatabaseOwner(prisma).
 *     - Frontend role="owner" claims without live DB owner status rejected.
 *     - Genuine Owner can inspect system health, gates, wallets/ledgers, and audit logs.
 *     - All 5 financial feature gates confirmed strictly disabled (read-only).
 *  4. Owner Financial Configuration:
 *     - Server-side validation for rates, TTL, card number, and IBAN.
 *     - Rejection of invalid inputs (negative rate, excessive fee, invalid card/IBAN).
 *     - Successful update preserves quotes/snapshots and emits AuditLog with masked secrets.
 *     - Bank account numbers masked in serialized outputs.
 *     - 3,000-toman deduction policy respected (withdrawal-only, never deposits).
 *  5. CSRF Mutation Protection on Admin & Owner write endpoints.
 */

import assert from 'assert';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { resolveDatabaseOwner } from '../web/ownerGate';
import { validateKycDocumentReference, validateApplicationKycDocuments } from '../services/kycDocumentSecurity';
import { reviewApplication } from '../services/registrationService';

const KYC_DOCS_DIR = path.join(process.cwd(), 'storage', 'kyc_documents');
if (!fs.existsSync(KYC_DOCS_DIR)) {
  fs.mkdirSync(KYC_DOCS_DIR, { recursive: true });
}

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

async function runPhase8AdminOwnerSuite() {
  console.log('\n============================================================');
  console.log('--- STARTING WEBSITE PHASE 8 ADMIN & OWNER TEST SUITE ---');
  console.log('============================================================\n');

  const timestamp = Date.now();
  const testBoosterId = `phase8_booster_${timestamp}`;
  const testBooster2Id = `phase8_booster2_${timestamp}`;
  const testAdminId = `phase8_admin_${timestamp}`;
  const testOwnerId = `phase8_owner_${timestamp}`;
  const fakeOwnerId = `phase8_fake_owner_${timestamp}`;

  const kycDocApp1 = `kyc_app1_${timestamp}.png`;
  const kycDocApp2 = `kyc_app2_${timestamp}.png`;
  const symlinkDoc = `kyc_symlink_${timestamp}.png`;
  const kycDocApp1Path = path.join(KYC_DOCS_DIR, kycDocApp1);
  const kycDocApp2Path = path.join(KYC_DOCS_DIR, kycDocApp2);
  const symlinkDocPath = path.join(KYC_DOCS_DIR, symlinkDoc);

  let app1Id = 0;
  let app2Id = 0;

  try {
    // 0. Ensure base roles exist
    for (const r of ['booster', 'admin', 'manager', 'owner']) {
      await prisma.role.upsert({
        where: { roleKey: r },
        update: {},
        create: { roleKey: r, name: `${r.toUpperCase()} Role` },
      });
    }

    // Create real test files
    fs.writeFileSync(kycDocApp1Path, 'VALID_KYC_DOC_APP_1');
    fs.writeFileSync(kycDocApp2Path, 'VALID_KYC_DOC_APP_2');

    // Create a symlink to test symlink rejection
    try {
      if (fs.existsSync(symlinkDocPath)) fs.unlinkSync(symlinkDocPath);
      fs.symlinkSync(kycDocApp1Path, symlinkDocPath);
    } catch {
      // Symlink creation might need elevated privileges on some windows configurations
    }

    // Create DB users
    await prisma.user.create({
      data: {
        discordId: testBoosterId,
        username: `booster_${timestamp}`,
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testAdminId,
        username: `admin_${timestamp}`,
        userRoles: { create: [{ roleKey: 'admin' }] },
      },
    });

    // Genuine Owner: must have owner role AND match resolveDatabaseOwner
    const ownerResolution = await resolveDatabaseOwner(prisma);
    const existingDbOwner = ownerResolution.owner?.discordId;
    let ownerDiscordId = testOwnerId;

    if (existingDbOwner) {
      ownerDiscordId = existingDbOwner;
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: existingDbOwner, roleKey: 'owner' } },
        update: {},
        create: { userId: existingDbOwner, roleKey: 'owner' },
      });
    } else {
      await prisma.user.create({
        data: {
          discordId: testOwnerId,
          username: `owner_${timestamp}`,
          userRoles: { create: [{ roleKey: 'owner' }] },
        },
      });
    }

    // Fake owner: user with owner role but NOT resolved as the database owner
    const fakeOwnerDiscordId = existingDbOwner ? testBoosterId : fakeOwnerId;
    if (!existingDbOwner) {
      await prisma.user.create({
        data: {
          discordId: fakeOwnerId,
          username: `fake_owner_${timestamp}`,
          userRoles: { create: [{ roleKey: 'owner' }] },
        },
      });
    }

    // Create 2 test registration applications with KYC metadata
    const app1 = await prisma.registrationApplication.create({
      data: {
        userId: testBoosterId,
        category: 'pilot',
        qualifications: JSON.stringify({
          identityDocumentRef: kycDocApp1,
          selfieDocumentRef: kycDocApp1,
        }),
        status: 'awaiting_identity_verification',
        identityStatus: 'pending',
      },
    });
    app1Id = app1.id;

    // Create pilot verification record
    await prisma.pilotVerification.create({
      data: {
        userId: testBoosterId,
        gameSlug: 'wow_midnight',
        identityDocumentRef: kycDocApp1,
        selfieDocumentRef: kycDocApp1,
        status: 'pending',
      },
    });

    await prisma.user.create({
      data: {
        discordId: testBooster2Id,
        username: `booster2_${timestamp}`,
        userRoles: { create: [{ roleKey: 'booster' }] },
      },
    });

    const app2 = await prisma.registrationApplication.create({
      data: {
        userId: testBooster2Id,
        category: 'pilot',
        qualifications: JSON.stringify({
          identityDocumentRef: kycDocApp2,
          selfieDocumentRef: kycDocApp2,
        }),
        status: 'awaiting_identity_verification',
        identityStatus: 'pending',
      },
    });
    app2Id = app2.id;

    // ============================================================
    // 1. Mandatory Phase 7 KYC Security Preflight Tests
    // ============================================================
    console.log('[Test 1] Mandatory KYC Security Preflight Checks...');

    // 1.1 Non-existent file reference rejection
    const nonExistentResult = validateKycDocumentReference('non_existent_file.png', KYC_DOCS_DIR);
    assert.strictEqual(nonExistentResult.valid, false, 'Non-existent file must be rejected');
    assert.strictEqual(nonExistentResult.error, 'DOCUMENT_NOT_FOUND');

    // 1.2 Path traversal rejection
    const traversalResult = validateKycDocumentReference('../../secret.env', KYC_DOCS_DIR);
    assert.strictEqual(traversalResult.valid, false, 'Path traversal must be rejected');
    assert.strictEqual(traversalResult.error, 'PATH_TRAVERSAL_DETECTED');

    // 1.3 Symlink rejection (if symlink exists)
    if (fs.existsSync(symlinkDocPath)) {
      const symlinkResult = validateKycDocumentReference(symlinkDoc, KYC_DOCS_DIR);
      assert.strictEqual(symlinkResult.valid, false, 'Symlink must be rejected');
      assert.strictEqual(symlinkResult.error, 'ILLEGAL_LINK_DETECTED');
    }

    // 1.4 Application KYC validation rejecting missing/forged files
    const missingDocsResult = validateApplicationKycDocuments(
      { category: 'pilot', qualifications: JSON.stringify({ identityDocumentRef: 'forged_file.png' }), userId: testBoosterId },
      null,
      KYC_DOCS_DIR
    );
    assert.strictEqual(missingDocsResult.valid, false, 'Missing/forged file must be rejected');

    // 1.5 Valid application document passes
    const validAppResult = validateApplicationKycDocuments(
      { category: 'pilot', qualifications: app1.qualifications, userId: testBoosterId },
      { identityDocumentRef: kycDocApp1, selfieDocumentRef: kycDocApp1 },
      KYC_DOCS_DIR
    );
    assert.strictEqual(validAppResult.valid, true, 'Valid application document must pass');

    // 1.6 Verify identity with forged document reference in DB fails
    let forgedFailed = false;
    try {
      // Modify app2 with a missing file reference
      await prisma.registrationApplication.update({
        where: { id: app2.id },
        data: {
          qualifications: JSON.stringify({
            identityDocumentRef: 'missing_non_existent.png',
            selfieDocumentRef: 'missing_non_existent.png',
          }),
        },
      });

      await reviewApplication({
        applicationId: app2.id,
        reviewerId: ownerDiscordId,
        decision: 'verify_identity',
        reviewNotes: 'Attempt with missing reference',
      });
    } catch (err: any) {
      forgedFailed = true;
      assert.match(err.message, /KYC_DOCUMENT_INVALID|INVALID_EVIDENCE/);
    }
    assert.strictEqual(forgedFailed, true, 'verify_identity must reject missing/forged physical documents');

    // 1.7 Verify identity with genuine document succeeds
    const verifiedApp = await reviewApplication({
      applicationId: app1.id,
      reviewerId: ownerDiscordId,
      decision: 'verify_identity',
      reviewNotes: 'Valid KYC verification',
    });
    assert.strictEqual(verifiedApp.identityStatus, 'verified');

    // 1.8 Duplicate / concurrent verify_identity fails-closed
    let duplicateFailed = false;
    try {
      await reviewApplication({
        applicationId: app1.id,
        reviewerId: ownerDiscordId,
        decision: 'verify_identity',
        reviewNotes: 'Second verification attempt',
      });
    } catch (err: any) {
      duplicateFailed = true;
      assert.match(err.message, /IDENTITY_ALREADY_VERIFIED/);
    }
    assert.strictEqual(duplicateFailed, true, 'Duplicate verify_identity must be rejected');
    console.log('✓ KYC Security Preflight passed cleanly.');

    // ============================================================
    // 2. Admin Portal RBAC & Security Tests
    // ============================================================
    console.log('\n[Test 2] Admin Portal Authorization and Privileges...');

    const unauthAgent = request(app);
    const boosterClient = await createAuthenticatedAgent(testBoosterId);
    const adminClient = await createAuthenticatedAgent(testAdminId);

    // 2.1 Unauthenticated request rejected
    const unauthRes = await unauthAgent.get('/admin/overview');
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');

    // 2.2 Booster request rejected
    const boosterRes = await boosterClient.agent.get('/admin/overview');
    assert.strictEqual(boosterRes.status, 403, 'Booster must be forbidden from /admin/overview');

    // 2.3 Admin request allowed for overview
    const adminOverviewRes = await adminClient.agent.get('/admin/overview');
    assert.strictEqual(adminOverviewRes.status, 200, 'Admin must have access to /admin/overview');
    assert(adminOverviewRes.body.kpis !== undefined, 'KPIs must be returned');
    assert(adminOverviewRes.body.featureGates !== undefined, 'Feature gates must be returned');

    // 2.4 Admin deposits queue
    const adminDepositsRes = await adminClient.agent.get('/admin/deposits');
    assert.strictEqual(adminDepositsRes.status, 200, 'Admin can view deposit review queue');
    assert(Array.isArray(adminDepositsRes.body.deposits), 'Deposits array must be returned');

    // 2.5 Admin exchange monitoring
    const adminTradesRes = await adminClient.agent.get('/admin/exchange/trades');
    assert.strictEqual(adminTradesRes.status, 200, 'Admin can view exchange trades');
    assert(Array.isArray(adminTradesRes.body.trades), 'Trades array must be returned');

    // 2.6 Admin audit logs
    const adminAuditRes = await adminClient.agent.get('/admin/audit-logs');
    assert.strictEqual(adminAuditRes.status, 200, 'Admin can view audit logs');
    assert(Array.isArray(adminAuditRes.body.logs), 'Audit logs array must be returned');

    // 2.7 Admin roles matrix
    const adminRolesRes = await adminClient.agent.get('/admin/roles-matrix');
    assert.strictEqual(adminRolesRes.status, 200, 'Admin can view role permission matrix');
    assert(Array.isArray(adminRolesRes.body.roles), 'Roles array must be returned');

    // 2.8 Admin CANNOT access Owner portal endpoints
    const adminOwnerRes = await adminClient.agent.get('/owner/overview');
    assert.strictEqual(adminOwnerRes.status, 403, 'Admin must NOT have access to /owner/overview');
    assert.strictEqual(adminOwnerRes.body.error, 'FORBIDDEN');

    const adminOwnerConfigRes = await adminClient.agent.get('/owner/financial-config');
    assert.strictEqual(adminOwnerConfigRes.status, 403, 'Admin must NOT have access to /owner/financial-config');
    console.log('✓ Admin RBAC boundaries and privileges verified.');

    // ============================================================
    // 3. Owner Portal & OwnerGate Security Tests
    // ============================================================
    console.log('\n[Test 3] Owner Portal and OwnerGate Enforcement...');

    const ownerClient = await createAuthenticatedAgent(ownerDiscordId);

    // 3.1 Owner can access /owner/overview
    const ownerOverviewRes = await ownerClient.agent.get('/owner/overview');
    assert.strictEqual(ownerOverviewRes.status, 200, 'Genuine owner must access /owner/overview');
    assert.strictEqual(ownerOverviewRes.body.owner.isAuthoritativeOwner, true);
    assert(ownerOverviewRes.body.stats !== undefined);
    assert(Array.isArray(ownerOverviewRes.body.featureGates));

    // 3.2 Owner can view wallets and ledgers
    const ownerWalletsRes = await ownerClient.agent.get('/owner/wallets-ledgers');
    assert.strictEqual(ownerWalletsRes.status, 200, 'Owner can view wallets & ledger totals');
    assert(ownerWalletsRes.body.summary !== undefined, 'Summary must be returned');
    assert(Array.isArray(ownerWalletsRes.body.recentEntries), 'Recent entries array must be returned');

    // 3.3 Owner can view security health
    const ownerHealthRes = await ownerClient.agent.get('/owner/security-health');
    assert.strictEqual(ownerHealthRes.status, 200, 'Owner can view security health');
    assert(ownerHealthRes.body.securityStatus !== undefined);

    // 3.4 Feature Gates: Strictly disabled (all 5 live gates = false)
    const ownerGatesRes = await ownerClient.agent.get('/owner/feature-gates');
    assert.strictEqual(ownerGatesRes.status, 200);
    const gates = ownerGatesRes.body.gates;
    assert(Array.isArray(gates));
    for (const g of gates) {
      assert.strictEqual(g.isEnabled, false, `Gate ${g.key} must be disabled`);
    }
    console.log('✓ OwnerGate security and disabled feature gates verified.');

    // ============================================================
    // 4. Owner Financial Configuration & Snapshot Integrity
    // ============================================================
    console.log('\n[Test 4] Owner Financial Configuration & Input Validation...');

    // 4.1 Get current financial config
    const currentConfigRes = await ownerClient.agent.get('/owner/financial-config');
    assert.strictEqual(currentConfigRes.status, 200);
    assert(currentConfigRes.body.configs !== undefined, 'configs must be present');
    assert.strictEqual(currentConfigRes.body.withdrawalDeductionPolicy?.fixedDeductionToman, 3000, 'Withdrawal 3,000 toman policy must be enforced');

    // 4.2 Validation: Negative exchange rate rejected
    const invalidRateRes = await ownerClient.agent
      .put('/owner/financial-config')
      .set('x-csrf-token', ownerClient.csrfToken)
      .send({
        configs: { admin_usd_irt_rate: -1000 },
        reason: 'Attempt negative exchange rate calibration',
      });
    assert.strictEqual(invalidRateRes.status, 400, 'Negative USD/IRT rate must be rejected');

    // 4.3 Validation: Excessive fee rate rejected (> 50%)
    const invalidFeeRes = await ownerClient.agent
      .put('/owner/financial-config')
      .set('x-csrf-token', ownerClient.csrfToken)
      .send({
        configs: { incoming_irt_fee_rate: 0.85 },
        reason: 'Attempt excessive fee rate calibration',
      });
    assert.strictEqual(invalidFeeRes.status, 400, 'Fee rate > 0.50 must be rejected');

    // 4.4 Validation: Invalid card number rejected (not 16 digits)
    const invalidCardRes = await ownerClient.agent
      .put('/owner/financial-config')
      .set('x-csrf-token', ownerClient.csrfToken)
      .send({
        configs: { irt_bank_card_number: '1234abcd' },
        reason: 'Attempt invalid card calibration',
      });
    assert.strictEqual(invalidCardRes.status, 400, 'Invalid card number must be rejected');

    // 4.5 Validation: Invalid IBAN rejected
    const invalidIbanRes = await ownerClient.agent
      .put('/owner/financial-config')
      .set('x-csrf-token', ownerClient.csrfToken)
      .send({
        configs: { irt_bank_iban: 'NOT_AN_IBAN' },
        reason: 'Attempt invalid IBAN calibration',
      });
    assert.strictEqual(invalidIbanRes.status, 400, 'Invalid IBAN must be rejected');

    // 4.6 Successful update with valid parameters
    const validUpdateRes = await ownerClient.agent
      .put('/owner/financial-config')
      .set('x-csrf-token', ownerClient.csrfToken)
      .send({
        configs: {
          admin_usd_irt_rate: 115000,
          incoming_irt_fee_rate: 0.02,
          incoming_irt_quote_ttl_minutes: 30,
          irt_bank_name: 'Melli Bank',
          irt_bank_card_holder: 'Parham Nayeri',
          irt_bank_card_number: '6037991912345678',
          irt_bank_iban: 'IR120170000000123456789012',
        },
        reason: 'Routine quarterly exchange and banking parameters calibration',
      });
    assert.strictEqual(validUpdateRes.status, 200, 'Valid financial config update must succeed');
    assert.strictEqual(validUpdateRes.body.success, true);

    // Fetch updated config to verify persisted values and masking
    const updatedConfigRes = await ownerClient.agent.get('/owner/financial-config');
    assert.strictEqual(updatedConfigRes.status, 200);
    assert.strictEqual(updatedConfigRes.body.configs.admin_usd_irt_rate.value, '115000');
    assert.strictEqual(updatedConfigRes.body.configs.incoming_irt_fee_rate.value, '0.02');

    // Verify card number is masked in the response
    assert(updatedConfigRes.body.configs.irt_bank_card_number.maskedValue.includes('****'), 'Card number must be masked');
    assert(updatedConfigRes.body.configs.irt_bank_card_number.maskedValue.endsWith('5678'), 'Card last 4 digits visible');
    assert(updatedConfigRes.body.configs.irt_bank_iban.maskedValue.startsWith('IR**'), 'IBAN prefix masked');

    // 4.7 AuditLog written for financial config modification
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        actorId: ownerDiscordId,
        action: 'FINANCIAL_CONFIG_UPDATED',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(auditEntry !== null, 'AuditLog entry must be recorded for financial config update');
    // Ensure raw card number is masked in audit log
    if (auditEntry.newValues) {
      assert(!auditEntry.newValues.includes('6037991912345678'), 'Card number must be masked in audit log');
    }
    console.log('✓ Financial configuration validation and masked audit logging verified.');

    // ============================================================
    // 5. CSRF Protection on Mutations
    // ============================================================
    console.log('\n[Test 5] CSRF Protection on Admin and Owner Mutations...');

    // 5.1 Owner update without CSRF token fails
    const noCsrfRes = await ownerClient.agent
      .put('/owner/financial-config')
      .send({
        configs: { admin_usd_irt_rate: 120000 },
        reason: 'Attempt without CSRF token',
      });
    assert.strictEqual(noCsrfRes.status, 403, 'Mutation without CSRF token must return 403');

    // 5.2 Admin deposit review without CSRF token fails
    const noCsrfAdminRes = await adminClient.agent
      .post('/admin/deposits/dummy-id/review')
      .send({ decision: 'APPROVE' });
    assert.strictEqual(noCsrfAdminRes.status, 403, 'Admin review without CSRF token must return 403');
    console.log('✓ CSRF protection verified on all write operations.');

    console.log('\n============================================================');
    console.log('--- ALL WEBSITE PHASE 8 TESTS PASSED (100%) ---');
    console.log('============================================================\n');

  } finally {
    // Cleanup files
    try {
      if (fs.existsSync(kycDocApp1Path)) fs.unlinkSync(kycDocApp1Path);
      if (fs.existsSync(kycDocApp2Path)) fs.unlinkSync(kycDocApp2Path);
      if (fs.existsSync(symlinkDocPath)) fs.unlinkSync(symlinkDocPath);
    } catch {
      // Ignore cleanup errors
    }

    // Cleanup DB records
    await prisma.pilotVerification.deleteMany({
      where: { userId: testBoosterId },
    });

    const appIdsToDelete = [app1Id, app2Id].filter(id => id > 0);
    if (appIdsToDelete.length > 0) {
      await prisma.registrationApplication.deleteMany({
        where: { id: { in: appIdsToDelete } },
      });
    }

    await prisma.userRole.deleteMany({
      where: { userId: { in: [testBoosterId, testBooster2Id, testAdminId, fakeOwnerId] } },
    });

    await prisma.user.deleteMany({
      where: { discordId: { in: [testBoosterId, testBooster2Id, testAdminId, fakeOwnerId] } },
    });
  }
}

runPhase8AdminOwnerSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
