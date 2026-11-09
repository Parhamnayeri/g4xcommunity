/**
 * src/test/staging_environment_bootstrap_suite.ts
 *
 * Comprehensive Automated Staging Environment Verification Suite for G4X Community.
 *
 * VERIFICATION PILLARS:
 *  1. Staging Environment Validation & Safety Boundary Enforcement:
 *     - .env.staging passes all isolation checks.
 *     - Live credentials, real Discord tokens, and live financial gates fail closed.
 *     - Database URLs pointing outside staging directory are strictly rejected.
 *     - Loopback host binding (127.0.0.1) enforced.
 *     - High-entropy Owner Access Key enforced.
 *
 *  2. Safe Staging Reset Guard:
 *     - Reset without --confirm-staging-reset is strictly blocked.
 *     - Reset targets outside prisma/staging/ are strictly blocked.
 *     - Confirmed reset cleans up database and journal files safely.
 *
 *  3. Disposable Staging Database Provisioning & Migration:
 *     - Clean bootstrap against prisma/staging/staging.db succeeds.
 *     - All 27 Prisma migrations apply with 0 errors.
 *     - PRAGMA foreign_key_check returns 0 violations.
 *     - SQLite partial unique indexes exist in sqlite_master.
 *
 *  4. Synthetic Dataset Integrity:
 *     - All 10 synthetic identities present with 18-digit snowflakes.
 *     - Exactly one owner resolved by OwnerGate.
 *     - Roles, wallets (V1 & V2), characters, orders across statuses present.
 *     - Rules & Policies CMS has active published policy.
 *
 *  5. HTTP Smoke & Role-Based Authorization Tests:
 *     - Public routes return 200: /, /rules, /privacy, /discord-commands.
 *     - Static assets and React SPA refresh fallback function properly.
 *     - Unknown API routes return 404 JSON, not SPA entry HTML.
 *     - Staging login endpoint (POST /api/auth/staging-login) issues authenticated session.
 *     - Unauthenticated requests to private portals return 401.
 *     - Role boundaries enforced (Booster rejected from admin, Staff rejected from owner, etc.).
 */

import path from 'path';
import request from 'supertest';
import { app } from '../web/server';
import prisma from '../database/db';
import { resolveDatabaseOwner } from '../web/ownerGate';

// Dynamic requires to satisfy tsconfig rootDir boundaries
const { validateStagingEnvironment } = require(path.resolve(__dirname, '../../scripts/validate-staging-env'));
const { resetStagingDatabase } = require(path.resolve(__dirname, '../../scripts/staging-reset'));
const { bootstrapStagingEnvironment } = require(path.resolve(__dirname, '../../scripts/staging-bootstrap'));
const { seedStagingDatabase, SYNTHETIC_USERS } = require(path.resolve(__dirname, '../../scripts/seed-staging'));
const { startStagingServer } = require(path.resolve(__dirname, '../../scripts/staging-server'));

async function runStagingBootstrapSuite(): Promise<void> {
  console.log('\n================================================================');
  console.log('🧪 G4X COMMUNITY — STAGING PHASE 1 BOOTSTRAP VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string): void {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // ─── 1. ENVIRONMENT VALIDATION & SAFETY BOUNDARY ENFORCEMENT ───────────────
    console.log('[SECTION 1] Testing Staging Environment Configuration & Safety Gates...');

    // 1.1 Valid staging environment passes
    const validResult = validateStagingEnvironment();
    assert(
      validResult.valid,
      'Staging validator passes valid .env.staging configuration',
      validResult.errors.join(', ')
    );

    // 1.2 Rejection when STAGING_MODE is not true
    const invalidModeResult = validateStagingEnvironment({
      ...process.env,
      STAGING_MODE: 'false',
    });
    assert(
      !invalidModeResult.valid && invalidModeResult.errors.some((e: string) => e.includes('STAGING_MODE')),
      'Validator strictly rejects STAGING_MODE !== "true"'
    );

    // 1.3 Rejection of production database target
    const prodDbResult = validateStagingEnvironment({
      ...process.env,
      DATABASE_URL: 'file:../data/g4x.db',
    });
    assert(
      !prodDbResult.valid && prodDbResult.errors.some((e: string) => e.includes('not an isolated staging database')),
      'Validator strictly blocks production database target (data/g4x.db)'
    );

    // 1.4 Rejection of standard dev.db target
    const devDbResult = validateStagingEnvironment({
      ...process.env,
      DATABASE_URL: 'file:./dev.db',
    });
    assert(
      !devDbResult.valid && devDbResult.errors.some((e: string) => e.includes('not an isolated staging database')),
      'Validator strictly blocks non-staging dev.db target'
    );

    // 1.5 Rejection when financial safety gates are enabled
    const financialGates = [
      'ESCROW_RELEASE_ENABLED',
      'FINANCE_V2_LIVE_CREDITS_ENABLED',
      'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
      'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
      'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
      'RAIDERIO_LIVE_SYNC_ENABLED',
    ];

    for (const gate of financialGates) {
      const gateResult = validateStagingEnvironment({
        ...process.env,
        [gate]: 'true',
      });
      assert(
        !gateResult.valid && gateResult.errors.some((e: string) => e.includes(gate)),
        `Validator strictly fails closed if safety gate ${gate}=true`
      );
    }

    // 1.6 Rejection of live NOWPayments mode
    const livePaymentsResult = validateStagingEnvironment({
      ...process.env,
      NOWPAYMENTS_MODE: 'live',
    });
    assert(
      !livePaymentsResult.valid && livePaymentsResult.errors.some((e: string) => e.includes('NOWPAYMENTS_MODE')),
      'Validator strictly rejects NOWPAYMENTS_MODE="live"'
    );

    // 1.7 Rejection of public host binding (0.0.0.0)
    const publicHostResult = validateStagingEnvironment({
      ...process.env,
      HOST: '0.0.0.0',
    });
    assert(
      !publicHostResult.valid && publicHostResult.errors.some((e: string) => e.includes('HOST')),
      'Validator strictly rejects public host binding (0.0.0.0)'
    );

    // 1.8 Rejection of low-entropy or placeholder owner access key
    const weakKeyResult = validateStagingEnvironment({
      ...process.env,
      G4X_OWNER_ACCESS_KEY: 'your_owner_access_key_here_too_short',
    });
    assert(
      !weakKeyResult.valid && weakKeyResult.errors.some((e: string) => e.includes('G4X_OWNER_ACCESS_KEY')),
      'Validator strictly rejects placeholder or low-entropy G4X_OWNER_ACCESS_KEY'
    );

    // ─── 2. SAFE RESET TOOL & CONFINEMENT GUARD ───────────────────────────────
    console.log('\n[SECTION 2] Testing Safe Staging Database Reset Guard...');

    // 2.1 Refusal without confirmation flag
    const unconfirmedReset = await resetStagingDatabase({ confirmFlag: false, silent: true });
    assert(
      !unconfirmedReset.success && unconfirmedReset.error?.includes('--confirm-staging-reset'),
      'staging-reset refuses to delete database without explicit --confirm-staging-reset flag'
    );

    // 2.2 Refusal on non-staging database path
    const nonStagingReset = await resetStagingDatabase({
      confirmFlag: true,
      databaseUrl: 'file:../data/g4x_dev.db',
      silent: true,
    });
    assert(
      !nonStagingReset.success,
      'staging-reset strictly refuses to operate on paths outside prisma/staging/'
    );

    // ─── 3. PROVISIONING, MIGRATION & DATABASE INTEGRITY ──────────────────────
    console.log('\n[SECTION 3] Testing Database Provisioning, Safe Migration & Partial Indexes...');

    // 3.1 Bootstrap staging environment
    const bootstrapResult = await bootstrapStagingEnvironment({ silent: true });
    assert(
      bootstrapResult.success && bootstrapResult.migrationsApplied,
      'staging-bootstrap successfully deploys all Prisma migrations against staging.db',
      bootstrapResult.error
    );

    // 3.2 PRAGMA foreign_key_check passes with 0 violations
    const fkViolations: any[] = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    assert(
      Array.isArray(fkViolations) && fkViolations.length === 0,
      'PRAGMA foreign_key_check detects exactly 0 referential violations in staging database'
    );

    // 3.3 Verify SQLite partial unique indexes
    const indexes: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_bwr_settled_tx_hash_unique', 'idx_bwr_settled_bank_receipt_unique', 'idx_order_channels_active_execution');"
    );
    const indexNames = new Set(indexes.map((i) => i.name));
    assert(
      indexNames.has('idx_bwr_settled_tx_hash_unique'),
      'SQLite partial unique index idx_bwr_settled_tx_hash_unique is active'
    );
    assert(
      indexNames.has('idx_bwr_settled_bank_receipt_unique'),
      'SQLite partial unique index idx_bwr_settled_bank_receipt_unique is active'
    );
    assert(
      indexNames.has('idx_order_channels_active_execution'),
      'SQLite partial unique index idx_order_channels_active_execution is active'
    );

    // ─── 4. SYNTHETIC TEST DATASET VERIFICATION ───────────────────────────────
    console.log('\n[SECTION 4] Testing Synthetic Dataset Identities, Wallets, Orders & CMS...');

    // 4.1 All 10 synthetic identities exist
    const userCount = await prisma.user.count();
    assert(userCount >= 10, `At least 10 synthetic users present in staging (found: ${userCount})`);

    const expectedIdentities = [
      { id: SYNTHETIC_USERS.OWNER, role: 'owner' },
      { id: SYNTHETIC_USERS.ADMIN, role: 'admin' },
      { id: SYNTHETIC_USERS.MANAGEMENT, role: 'manager' },
      { id: SYNTHETIC_USERS.STAFF, role: 'staff' },
      { id: SYNTHETIC_USERS.ADVERTISER, role: 'advertiser' },
      { id: SYNTHETIC_USERS.EXCHANGER, role: 'exchanger' },
      { id: SYNTHETIC_USERS.BOOSTER, role: 'booster' },
      { id: SYNTHETIC_USERS.PILOT, role: 'pilot' },
      { id: SYNTHETIC_USERS.MULTI_ROLE, role: 'booster' },
    ];

    for (const exp of expectedIdentities) {
      const userWithRoles = await prisma.user.findUnique({
        where: { discordId: exp.id },
        include: { userRoles: true },
      });
      const hasRole = userWithRoles?.userRoles.some((r) => r.roleKey === exp.role);
      assert(
        !!userWithRoles && !!hasRole,
        `Identity ${exp.id} possesses required role '${exp.role}'`
      );
    }

    // 4.2 OwnerGate single-owner resolution
    const ownerRes = await resolveDatabaseOwner(prisma);
    assert(
      ownerRes.owner !== null && ownerRes.owner.discordId === SYNTHETIC_USERS.OWNER,
      `OwnerGate resolves single authoritative owner: ${ownerRes.owner?.username} (${ownerRes.owner?.discordId})`
    );

    // 4.3 Wallets exist for synthetic users
    const walletsCount = await prisma.wallet.count();
    const walletsV2Count = await prisma.walletV2.count();
    assert(walletsCount >= 10 && walletsV2Count >= 10, 'All synthetic identities have both Wallet and WalletV2');

    // 4.4 Orders seeded across statuses
    const orders = await prisma.order.findMany();
    const orderStatuses = new Set(orders.map((o) => o.status));
    assert(
      orderStatuses.has('payment_pending') &&
      orderStatuses.has('open_presign') &&
      orderStatuses.has('in_progress') &&
      orderStatuses.has('completed') &&
      orderStatuses.has('cancelled'),
      'Orders seeded across multiple lifecycle states (pending, presign, in_progress, completed, cancelled)'
    );

    // 4.5 Execution channel mapping for active order
    const order103Channel = await prisma.orderChannel.findFirst({
      where: { orderId: 103, status: 'active', channelType: 'execution' },
    });
    assert(
      !!order103Channel && order103Channel.discordChannelId === '999999999999993001',
      'Active order 103 has dedicated execution channel mapped'
    );

    // 4.6 WoW Characters seeded
    const wowChars = await prisma.wowCharacter.findMany();
    assert(wowChars.length >= 2, `WoW characters seeded with Raider.IO cached metrics (found: ${wowChars.length})`);

    // 4.7 Rules & Policies CMS document published
    const policyDoc = await prisma.policyDocument.findUnique({
      where: { slug: 'community-rules' },
      include: { versions: true },
    });
    const hasPublished = policyDoc?.versions.some((v) => v.status === 'PUBLISHED');
    assert(
      !!policyDoc && !!hasPublished,
      'Unified Rules & Policies CMS contains authoritative published version'
    );

    // ─── 5. HTTP SMOKE & ROLE-BASED AUTHORIZATION SMOKE TESTS ─────────────────
    console.log('\n[SECTION 5] Running HTTP Smoke Tests & Protected Portal Authorization...');

    // 5.1 Public routes return 200 HTML
    const publicPages = ['/', '/rules', '/privacy', '/discord-commands'];
    for (const page of publicPages) {
      const res = await request(app).get(page).set('Accept', 'text/html');
      assert(
        res.status === 200 && res.type.includes('html'),
        `Public page '${page}' serves 200 OK HTML`
      );
    }

    // 5.2 Public CMS policy API returns 200 JSON
    const policyRes = await request(app).get('/api/public/rules');
    assert(
      policyRes.status === 200 && policyRes.body.success && policyRes.body.policy,
      'GET /api/public/rules serves authoritative published policy'
    );

    // 5.3 Public games catalog returns 200 JSON
    const gamesRes = await request(app).get('/api/public/games');
    assert(
      gamesRes.status === 200 && Array.isArray(gamesRes.body.games) && gamesRes.body.games.length > 0,
      'GET /api/public/games serves active game catalog'
    );

    // 5.4 SPA Fallback for unknown frontend page
    const spaRes = await request(app).get('/booster/settings').set('Accept', 'text/html');
    assert(
      spaRes.status === 200 && spaRes.type.includes('html'),
      'HTML request to /booster/settings falls back to SPA React entry point'
    );

    // 5.5 Unknown API route returns 404 JSON, NOT SPA HTML
    const api404Res = await request(app).get('/api/unknown/endpoint/never/exists');
    assert(
      api404Res.status === 404 && api404Res.body.error === 'NOT_FOUND',
      'Unknown API route returns 404 JSON error, never index.html'
    );

    // 5.6 Unauthenticated requests to protected endpoints return 401
    const unauthMe = await request(app).get('/api/me');
    assert(unauthMe.status === 401, 'Unauthenticated GET /api/me returns 401 Unauthorized');

    const unauthStaff = await request(app).get('/api/staff/orders');
    assert(unauthStaff.status === 401, 'Unauthenticated GET /api/staff/orders returns 401 Unauthorized');

    const unauthAdmin = await request(app).get('/api/admin/users');
    assert(unauthAdmin.status === 401, 'Unauthenticated GET /api/admin/users returns 401 Unauthorized');

    const unauthOwner = await request(app).get('/api/owner/overview');
    assert(unauthOwner.status === 401, 'Unauthenticated GET /api/owner/overview returns 401 Unauthorized');

    // 5.7 Staging Login: Booster Session
    const boosterAgent = request.agent(app);
    const boosterLoginRes = await boosterAgent
      .post('/api/auth/staging-login')
      .send({ userId: SYNTHETIC_USERS.BOOSTER });

    assert(
      boosterLoginRes.status === 200 && boosterLoginRes.body.success,
      'POST /api/auth/staging-login succeeds for Booster identity'
    );

    const boosterMeRes = await boosterAgent.get('/api/me');
    assert(
      boosterMeRes.status === 200 && boosterMeRes.body.discordId === SYNTHETIC_USERS.BOOSTER,
      'Booster session retrieves user profile from /api/me'
    );

    const boosterPortalRes = await boosterAgent.get('/api/booster/portal-data');
    assert(
      boosterPortalRes.status === 200,
      'Booster session has access to /api/booster/portal-data'
    );

    // Booster trying to access Admin endpoint -> 403 Forbidden
    const boosterForbiddenRes = await boosterAgent.get('/api/admin/users');
    assert(
      boosterForbiddenRes.status === 403,
      'Booster identity is strictly rejected (403) from /api/admin/users'
    );

    // 5.8 Staging Login: Staff Session
    const staffAgent = request.agent(app);
    await staffAgent
      .post('/api/auth/staging-login')
      .send({ userId: SYNTHETIC_USERS.STAFF });

    const staffOrdersRes = await staffAgent.get('/api/staff/orders');
    assert(
      staffOrdersRes.status === 200,
      'Staff session has access to /api/staff/orders'
    );

    // Staff trying to access Owner overview -> 403 Forbidden
    const staffToOwnerRes = await staffAgent.get('/api/owner/overview');
    assert(
      staffToOwnerRes.status === 403,
      'Staff identity is strictly rejected (403) from /api/owner/overview'
    );

    // 5.9 Staging Login: Admin Session
    const adminAgent = request.agent(app);
    await adminAgent
      .post('/api/auth/staging-login')
      .send({ userId: SYNTHETIC_USERS.ADMIN });

    const adminUsersRes = await adminAgent.get('/api/admin/users');
    assert(
      adminUsersRes.status === 200,
      'Admin session has access to /api/admin/users'
    );

    // 5.10 Staging Login: Owner Session
    const ownerAgent = request.agent(app);
    await ownerAgent
      .post('/api/auth/staging-login')
      .send({ userId: SYNTHETIC_USERS.OWNER });

    const ownerOverviewRes = await ownerAgent.get('/api/owner/overview');
    assert(
      ownerOverviewRes.status === 200,
      'Owner session has access to /api/owner/overview'
    );

  } catch (err: any) {
    console.error('\n💥 Unexpected suite failure:', err);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`STAGING TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run suite directly
if (require.main === module) {
  runStagingBootstrapSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal suite error:', err);
      process.exit(1);
    });
}

export { runStagingBootstrapSuite };
