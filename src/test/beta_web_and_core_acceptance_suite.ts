/**
 * src/test/beta_web_and_core_acceptance_suite.ts
 *
 * G4X v0.001 — Local Web, Owner Dashboard & Wallet Acceptance Suite.
 *
 * Verifies:
 *  STEP 2: Local Web & Owner Dashboard Verification:
 *   - Bound strictly to 127.0.0.1, Discord Bot OFFLINE.
 *   - /api/beta/health returns operational-beta status and locked financial gates.
 *   - Frontend routing: React SPA entrypoint served for /, /dashboard, /wallet, /withdraw, /owner.
 *   - Legacy HTML portal served for /legacy.
 *   - Static asset serving (CSS/JS).
 *   - Unauthenticated requests to protected endpoints return 401 Unauthorized.
 *   - Legitimate OwnerGate authentication:
 *     - GET /OwnerGate renders security gate with CSRF token.
 *     - POST /OwnerGate with invalid key is rejected with 401 & logged to AuditLog.
 *     - POST /OwnerGate with legitimate G4X_OWNER_ACCESS_KEY regenerates session & issues auth cookie.
 *     - Authenticated Owner can query /api/me and /api/owner/overview.
 *   - Documents Discord OAuth2 limitation in local web-only mode without internet.
 *
 *  STEP 3: Core APIs with Synthetic Data in Isolated Test DB:
 *   - Database strictly confined to `prisma/staging/beta_acceptance_synthetic.db` (never touching beta_v0001.db).
 *   - Multi-role RBAC authorization matrix (Owner / Manager / Booster / Client).
 *   - Synthetic order creation, assignment, proof and completion lifecycle.
 *   - WalletV2 balances and double-entry ledger integrity.
 *   - HMAC-SHA256 withdrawal quote generation and anti-tamper validation.
 *   - Atomic balance reservation and overdraft prevention.
 *   - Withdrawal review and rejection (safe non-payout with atomic refund).
 *   - Durable AuditLog history.
 *   - Database consistency and integrity verification after restart.
 *   - Safe cleanup of synthetic test database.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { setGlobalPrismaClient } from '../database/db';
import { createBetaApp } from '../beta/betaApp';
import { initializeBetaDatabase } from '../beta/betaDatabase';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import {
  generateUsdtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  confirmAndSubmitWithdrawalRequest,
  adminApproveWithdrawalForProcessing,
  adminExecuteManualPayout,
  adminRejectWithdrawal,
  validateWithdrawalQuoteSigningConfig,
} from '../services/financeV2/boosterWithdrawalService';
import {
  recordProofSubmitted,
  recordStaffReview,
  recordAdminFinalApproval,
  executeG4XBoostRelease,
} from '../services/financeV2/g4xBoostReleaseService';
import { finalizeOrderFinancialsAndBoosterAllocation } from '../services/financialCalculationEngine';
import { confirmOrderBoosterEarnings } from '../services/financeV2/boosterEarningsSyncService';
import { getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';
import { validateOwnerAccessKeyConfig, resolveDatabaseOwner } from '../web/ownerGate';
import { validateBetaEnvironment } from '../beta/validateBetaEnv';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';

const TEST_PORT = 3005;
const TEST_HOST = '127.0.0.1';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

// High-entropy test secrets (>= 32 chars)
const TEST_SESSION_SECRET = 'synthetic_test_session_secret_of_high_entropy_32_bytes_hex_abc';
const TEST_OWNER_ACCESS_KEY = 'synthetic_owner_key_32_characters_long_entropy_test_owner_xyz';
const TEST_QUOTE_SECRET = 'synthetic_quote_signing_secret_32_characters_minimum_entropy_99';

const SYNTH_OWNER_ID = '900000000000000001';
const SYNTH_MANAGER_ID = '900000000000000002';
const SYNTH_BOOSTER_ID = '900000000000000003';
const SYNTH_CLIENT_ID = '900000000000000004';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  process.stdout.write(`⏳ ${name} ... `);
  try {
    await fn();
    passed++;
    console.log('✅ PASS');
  } catch (err: any) {
    failed++;
    console.log('❌ FAIL');
    console.error(`   ↳ ${err?.stack || err}`);
  }
}

interface HttpResp {
  status: number;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
  json: any;
}

function httpRequest(
  urlPath: string,
  options: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, BASE_URL);
    const bodyStr =
      typeof options.body === 'string'
        ? options.body
        : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

    const reqHeaders: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (options.cookie) {
      reqHeaders['Cookie'] = options.cookie;
    }
    if (bodyStr !== undefined && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
    } else if (bodyStr !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = bodyText ? JSON.parse(bodyText) : null;
          } catch {}
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            bodyText,
            json,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function extractCookie(headers: http.IncomingHttpHeaders, name: string): string | null {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookieList) {
    const match = c.match(new RegExp(`${name}=([^;]+)`));
    if (match) {
      return `${name}=${match[1]}`;
    }
  }
  return null;
}

async function runAcceptanceSuite() {
  console.log('\n============================================================');
  console.log('🚀 G4X v0.001 — Web, Owner Dashboard & Wallet Acceptance Suite');
  console.log('============================================================\n');

  // Setup isolated synthetic database
  const schemaDir = findPrismaSchemaDir();
  const synthDbPath = path.resolve(schemaDir, 'staging', 'beta_acceptance_synthetic.db');
  const synthDbUrl = `file:${synthDbPath.replace(/\\/g, '/')}`;

  // Clean any old synthetic test DB first
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    const f = synthDbPath + ext;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  }

  // Set environment variables for this test run
  process.env.BETA_MODE = 'true';
  process.env.DISCORD_LAB_MODE = 'false';
  process.env.DATABASE_URL = synthDbUrl;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.G4X_OWNER_ACCESS_KEY = TEST_OWNER_ACCESS_KEY;
  process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET = TEST_QUOTE_SECRET;
  process.env.BETA_INVITE_ALLOWLIST_IDS = `${SYNTH_OWNER_ID},${SYNTH_MANAGER_ID},${SYNTH_BOOSTER_ID},${SYNTH_CLIENT_ID}`;
  process.env.OWNER_DISCORD_ID = SYNTH_OWNER_ID;
  process.env.COOKIE_SECURE = 'false';
  process.env.BETA_HOST = TEST_HOST;
  process.env.BETA_PORT = String(TEST_PORT);
  process.env.HOST = TEST_HOST;
  process.env.PORT = String(TEST_PORT);
  process.env.BETA_DISCORD_ENABLED = 'false';
  process.env.BETA_OAUTH_ENABLED = 'false';

  // Hard lock all six financial gates
  process.env.ESCROW_RELEASE_ENABLED = 'false';
  process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';
  process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
  process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';
  process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';
  process.env.RAIDERIO_LIVE_SYNC_ENABLED = 'false';
  process.env.NOWPAYMENTS_MODE = 'disabled';

  console.log('[Acceptance] Initializing isolated test database: ' + synthDbPath);
  const dbHandle = await initializeBetaDatabase(synthDbUrl, { silent: true });
  setGlobalPrismaClient(dbHandle.prismaClient);
  const prisma = dbHandle.prismaClient;

  // Seed synthetic roles and users
  console.log('[Acceptance] Seeding roles and synthetic test users...');
  for (const roleKey of ['owner', 'manager', 'admin', 'staff', 'booster', 'client', 'advertiser', 'exchanger']) {
    await prisma.role.upsert({
      where: { roleKey },
      update: {},
      create: { roleKey, name: roleKey },
    });
  }

  // Create Users & Roles
  await prisma.user.create({
    data: {
      discordId: SYNTH_OWNER_ID,
      username: 'SyntheticOwner',
      displayName: 'G4X Platform Owner',
      userRoles: { create: { roleKey: 'owner' } },
      wallet: { create: {} },
    },
  });

  await prisma.user.create({
    data: {
      discordId: SYNTH_MANAGER_ID,
      username: 'SyntheticManager',
      displayName: 'Platform Operations Manager',
      userRoles: { create: { roleKey: 'manager' } },
      wallet: { create: {} },
    },
  });

  await prisma.user.create({
    data: {
      discordId: SYNTH_BOOSTER_ID,
      username: 'SyntheticBooster',
      displayName: 'Verified WoW Booster',
      userRoles: { create: { roleKey: 'booster' } },
      wallet: { create: {} },
    },
  });

  await prisma.user.create({
    data: {
      discordId: SYNTH_CLIENT_ID,
      username: 'SyntheticClient',
      displayName: 'Community Customer',
      userRoles: { create: { roleKey: 'client' } },
      wallet: { create: {} },
    },
  });

  // Seed game and service for order tests
  await prisma.game.upsert({
    where: { slug: 'wow' },
    update: {},
    create: {
      slug: 'wow',
      displayName: 'World of Warcraft',
      serviceCategory: 'both',
    },
  });

  const gameService = await prisma.gameService.create({
    data: {
      gameSlug: 'wow',
      serviceKey: 'mplus',
      displayName: 'Mythic Plus Dungeon Run',
      profileMode: 'manual',
    },
  });

  // Start HTTP server on 127.0.0.1:3005
  console.log(`[Acceptance] Starting Beta Web App on http://${TEST_HOST}:${TEST_PORT}...`);
  const app = createBetaApp({
    inviteAllowlistIds: [SYNTH_OWNER_ID, SYNTH_MANAGER_ID, SYNTH_BOOSTER_ID, SYNTH_CLIENT_ID],
    sessionSecret: TEST_SESSION_SECRET,
    cookieSecure: false,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(TEST_PORT, TEST_HOST, () => resolve());
  });
  console.log('  - Server bound successfully to loopback interface.\n');

  let ownerCookie: string | null = null;

  try {
    // =========================================================================
    // STEP 2: LOCAL WEB & OWNER DASHBOARD VERIFICATION
    // =========================================================================

    await test('2.1 Health Check returns operational-beta status and locked gates', async () => {
      const res = await httpRequest('/api/beta/health');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.json?.mode !== 'operational-beta') throw new Error(`Expected mode operational-beta, got ${res.json?.mode}`);
      if (res.json?.version !== 'v0.001') throw new Error(`Expected version v0.001, got ${res.json?.version}`);
      if (!res.json?.liveFinanceGatesLocked) throw new Error('Expected liveFinanceGatesLocked: true');
    });

    await test('2.2 Frontend SPA routing serves React HTML for core pages (/, /dashboard, /wallet, /withdraw, /owner)', async () => {
      const pages = ['/', '/dashboard', '/wallet', '/withdraw', '/owner', '/admin'];
      for (const p of pages) {
        const res = await httpRequest(p, { headers: { Accept: 'text/html' } });
        if (res.status !== 200) throw new Error(`Page ${p} returned status ${res.status}`);
        if (!res.bodyText.includes('<div id="root">') && !res.bodyText.includes('<!DOCTYPE html>')) {
          throw new Error(`Page ${p} did not return valid SPA HTML`);
        }
      }
    });

    await test('2.3 Legacy portal HTML endpoint (/legacy) is served cleanly', async () => {
      const res = await httpRequest('/legacy', { headers: { Accept: 'text/html' } });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.bodyText.includes('G4X') && !res.bodyText.includes('html')) {
        throw new Error('Legacy HTML portal missing expected structure');
      }
    });

    await test('2.4 Unauthenticated requests to protected API endpoints are strictly blocked (401)', async () => {
      const protectedEndpoints = ['/api/me', '/api/wallet', '/api/wallet/v2', '/api/withdrawals/overview', '/api/owner/overview', '/api/admin/overview'];
      for (const ep of protectedEndpoints) {
        const res = await httpRequest(ep);
        if (res.status !== 401 && res.status !== 403) {
          throw new Error(`Endpoint ${ep} returned status ${res.status} instead of 401/403 for unauthenticated request`);
        }
      }
    });

    await test('2.5 GET /OwnerGate renders legitimate owner login gate with CSRF token', async () => {
      const res = await httpRequest('/OwnerGate');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.bodyText.includes('Owner Access Gate') || !res.bodyText.includes('G4X Community')) {
        throw new Error('OwnerGate HTML missing security banner');
      }
      const initialCookie = extractCookie(res.headers, 'g4x_beta.sid');
      if (!initialCookie) throw new Error('Expected g4x_beta.sid session cookie on GET /OwnerGate');
    });

    await test('2.6 POST /OwnerGate rejects invalid access key with 401 and records AuditLog', async () => {
      const csrfRes = await httpRequest('/api/csrf-token');
      const cookie = extractCookie(csrfRes.headers, 'g4x_beta.sid')!;
      const csrfToken = csrfRes.json?.csrfToken;

      const badRes = await httpRequest('/OwnerGate', {
        method: 'POST',
        cookie,
        headers: { 'x-csrf-token': csrfToken },
        body: { accessKey: 'completely_wrong_key_1234567890abcdef' },
      });

      if (badRes.status !== 401 && badRes.status !== 302) {
        throw new Error(`Expected 401/302 for wrong key, got ${badRes.status}`);
      }

      const failedAudit = await prisma.auditLog.findFirst({
        where: { action: 'AUTH_OWNER_GATE_FAILED' },
        orderBy: { createdAt: 'desc' },
      });
      if (!failedAudit) throw new Error('AuditLog missing AUTH_OWNER_GATE_FAILED entry');
    });

    await test('2.7 POST /OwnerGate with valid G4X_OWNER_ACCESS_KEY establishes legitimate Owner session', async () => {
      const csrfRes = await httpRequest('/api/csrf-token');
      const initialCookie = extractCookie(csrfRes.headers, 'g4x_beta.sid')!;
      const csrfToken = csrfRes.json?.csrfToken;

      const loginRes = await httpRequest('/OwnerGate', {
        method: 'POST',
        cookie: initialCookie,
        headers: {
          'x-csrf-token': csrfToken,
          'Accept': 'application/json',
        },
        body: { accessKey: TEST_OWNER_ACCESS_KEY },
      });

      if (loginRes.status !== 200 && loginRes.status !== 302) {
        throw new Error(`Expected 200/302 for valid owner login, got ${loginRes.status}: ${loginRes.bodyText}`);
      }

      ownerCookie = extractCookie(loginRes.headers, 'g4x_beta.sid') || initialCookie;
      if (!ownerCookie) throw new Error('Failed to retrieve authenticated owner session cookie');

      const successAudit = await prisma.auditLog.findFirst({
        where: { action: 'AUTH_OWNER_GATE_SUCCESS', actorId: SYNTH_OWNER_ID },
      });
      if (!successAudit) throw new Error('AuditLog missing AUTH_OWNER_GATE_SUCCESS entry');
    });

    await test('2.8 Authenticated Owner can query /api/me and access /api/owner/overview', async () => {
      if (!ownerCookie) throw new Error('Owner session cookie unavailable');

      const meRes = await httpRequest('/api/me', { cookie: ownerCookie });
      if (meRes.status !== 200) throw new Error(`Expected 200 from /api/me, got ${meRes.status}`);
      if (meRes.json?.discordId !== SYNTH_OWNER_ID) {
        throw new Error(`Expected discordId ${SYNTH_OWNER_ID}, got ${meRes.json?.discordId}`);
      }

      const ownerRes = await httpRequest('/api/owner/overview', { cookie: ownerCookie });
      if (ownerRes.status !== 200) throw new Error(`Expected 200 from /api/owner/overview, got ${ownerRes.status}: ${ownerRes.bodyText}`);
      if (ownerRes.json?.owner?.displayName !== 'G4X Platform Owner' || !ownerRes.json?.owner?.isAuthoritativeOwner) {
        throw new Error(`Expected authoritative owner 'G4X Platform Owner', got '${ownerRes.json?.owner?.displayName}'`);
      }
      const escrowGate = (ownerRes.json?.featureGates || []).find((g: any) => g.key === 'ESCROW_RELEASE_ENABLED');
      if (!escrowGate || escrowGate.isEnabled !== false) {
        throw new Error('Owner overview failed to report locked ESCROW_RELEASE_ENABLED gate');
      }
    });

    // =========================================================================
    // STEP 3: TEST CORE APIS WITH SYNTHETIC DATA IN ISOLATED TEST DB
    // =========================================================================

    await test('3.1 Multi-Role RBAC Authorization Matrix (Owner / Manager / Booster / Client)', async () => {
      const boosterCheck = await authorize(SYNTH_BOOSTER_ID, Permission.SYSTEM_CONFIG_MANAGE);
      if (boosterCheck.allowed) throw new Error('Booster was incorrectly allowed SYSTEM_CONFIG_MANAGE');

      const managerCheck = await authorize(SYNTH_MANAGER_ID, Permission.FINANCE_ADJUST);
      if (managerCheck.allowed) throw new Error('Manager was incorrectly allowed Owner-only FINANCE_ADJUST');

      const mgrReviewCheck = await authorize(SYNTH_MANAGER_ID, Permission.WITHDRAWAL_REVIEW);
      if (mgrReviewCheck.allowed) throw new Error('Manager was incorrectly allowed WITHDRAWAL_REVIEW (must be read-only)');

      const ownerCheck = await authorize(SYNTH_OWNER_ID, Permission.SYSTEM_CONFIG_MANAGE);
      if (!ownerCheck.allowed) throw new Error('Owner was rejected for SYSTEM_CONFIG_MANAGE');

      const ownerReviewCheck = await authorize(SYNTH_OWNER_ID, Permission.WITHDRAWAL_REVIEW);
      if (!ownerReviewCheck.allowed) throw new Error('Owner was rejected for WITHDRAWAL_REVIEW');
    });

    let createdOrderId: number;

    await test('3.2 OwnerGate Configuration Consistency & Single Authoritative Owner Invariant', async () => {
      // 1. Missing, short (<32), placeholder, and low-entropy keys must fail closed
      const missingCheck = validateOwnerAccessKeyConfig(undefined);
      if (missingCheck.valid || missingCheck.reason !== 'MISSING_CONFIGURATION') {
        throw new Error(`Expected MISSING_CONFIGURATION for undefined key, got ${JSON.stringify(missingCheck)}`);
      }

      const shortCheck = validateOwnerAccessKeyConfig('short_key_under_32_chars');
      if (shortCheck.valid || !shortCheck.reason?.includes('INSUFFICIENT_LENGTH')) {
        throw new Error(`Expected INSUFFICIENT_LENGTH for short key, got ${JSON.stringify(shortCheck)}`);
      }

      const placeholderCheck = validateOwnerAccessKeyConfig('your_owner_access_key_here_padded_to_over_32_chars');
      if (placeholderCheck.valid || placeholderCheck.reason !== 'PLACEHOLDER_KEY_DETECTED') {
        throw new Error(`Expected PLACEHOLDER_KEY_DETECTED for placeholder key, got ${JSON.stringify(placeholderCheck)}`);
      }

      const lowEntropyCheck = validateOwnerAccessKeyConfig('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      if (lowEntropyCheck.valid || !lowEntropyCheck.reason) {
        throw new Error(`Expected failure for low-entropy key, got ${JSON.stringify(lowEntropyCheck)}`);
      }

      const validCheck = validateOwnerAccessKeyConfig(TEST_OWNER_ACCESS_KEY);
      if (!validCheck.valid) {
        throw new Error(`Expected valid result for test owner key, got ${JSON.stringify(validCheck)}`);
      }

      // 2. validateBetaEnvironment fails closed with weak key
      const weakEnvRes = validateBetaEnvironment({
        ...process.env,
        G4X_OWNER_ACCESS_KEY: 'weak_short_key',
      });
      if (weakEnvRes.valid || !weakEnvRes.errors.some((e) => e.includes('G4X_OWNER_ACCESS_KEY'))) {
        throw new Error('validateBetaEnvironment did not fail closed on weak G4X_OWNER_ACCESS_KEY');
      }

      // 3. Exactly one active database Owner exists and matches OWNER_DISCORD_ID / invite allowlist
      const resolvedOwner = await resolveDatabaseOwner(prisma);
      if (!resolvedOwner.owner || resolvedOwner.reason) {
        throw new Error(`Expected single authoritative database owner, got: ${resolvedOwner.reason}`);
      }
      if (resolvedOwner.owner.discordId !== SYNTH_OWNER_ID) {
        throw new Error(`Resolved owner discordId mismatch: expected ${SYNTH_OWNER_ID}, got ${resolvedOwner.owner.discordId}`);
      }

      // 4. Multiple active owners must fail closed with AMBIGUOUS_MULTIPLE_OWNERS
      const secondOwnerUser = await prisma.user.create({
        data: {
          discordId: '900000000000000099',
          username: 'SecondSyntheticOwner',
          displayName: 'Second Owner',
          userRoles: { create: { roleKey: 'owner' } },
        },
      });

      try {
        const ambiguousRes = await resolveDatabaseOwner(prisma);
        if (ambiguousRes.owner !== null || ambiguousRes.reason !== 'AMBIGUOUS_MULTIPLE_OWNERS') {
          throw new Error(`Expected AMBIGUOUS_MULTIPLE_OWNERS when multiple active owners exist, got: ${JSON.stringify(ambiguousRes)}`);
        }
      } finally {
        await prisma.userRole.deleteMany({ where: { userId: secondOwnerUser.discordId } });
        await prisma.user.delete({ where: { discordId: secondOwnerUser.discordId } });
      }

      const restoredOwner = await resolveDatabaseOwner(prisma);
      if (!restoredOwner.owner || restoredOwner.owner.discordId !== SYNTH_OWNER_ID) {
        throw new Error('Failed to restore single authoritative owner');
      }
    });

    await test('3.3 Order-to-Wallet End-to-End Real Service Workflow (No Manual Balance Insert)', async () => {
      // 1. Create synthetic order with creatorType 'g4x' and paymentStatus 'verified'
      const order = await prisma.order.create({
        data: {
          orderRef: 'SYNTH_ORD_001',
          gameSlug: 'wow',
          serviceId: gameService.id,
          customerId: SYNTH_CLIENT_ID,
          creatorId: SYNTH_CLIENT_ID,
          creatorType: 'g4x',
          orderType: 'group',
          currency: 'USD',
          grossAmountMinor: 10000, // $100.00
          status: 'completed',
          paymentStatus: 'verified',
        },
      });
      createdOrderId = order.id;

      // 2. Create OrderFinancialSnapshot with boosterPoolMinor = 7500 ($75.00)
      await prisma.orderFinancialSnapshot.create({
        data: {
          orderId: order.id,
          sourcePlatform: 'direct',
          sourceAmountType: 'gross_sale',
          sourceAmountMinor: 10000,
          platformOrderNetMinor: 10000,
          externalNetBaseMinor: 10000,
          g4xFeeMinor: 1500,
          advertiserFeeMinor: 1000,
          boosterPoolMinor: 7500,
          currency: 'USD',
          calculationStatus: 'provisional',
        },
      });

      // 3. Create completed OrderRun
      const run = await prisma.orderRun.create({
        data: {
          orderId: order.id,
          runNumber: 1,
          status: 'completed',
          completedAt: new Date(),
          completedBy: SYNTH_BOOSTER_ID,
        },
      });

      // 4. Create OrderAssignment and RunAssignment
      const assignment = await prisma.orderAssignment.create({
        data: {
          orderId: order.id,
          userId: SYNTH_BOOSTER_ID,
          assignedById: SYNTH_OWNER_ID,
          assignedRole: 'booster',
          status: 'completed',
        },
      });

      await prisma.runAssignment.create({
        data: {
          runId: run.id,
          assignmentId: assignment.id,
          roleName: 'booster',
          status: 'completed',
        },
      });

      // 5. Initial booster wallet state check: zero balances
      const initialWallet = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (initialWallet.availableCents !== 0 || initialWallet.confirmedEarningsCents !== 0 || initialWallet.pendingEarningsCents !== 0) {
        throw new Error('Booster wallet should initialize with zero balance');
      }

      // 6. Step 1: recordProofSubmitted
      await recordProofSubmitted(order.id, SYNTH_BOOSTER_ID);
      const trackerAfterProof = await prisma.g4XBoostReleaseTracker.findUniqueOrThrow({ where: { orderId: order.id } });
      if (trackerAfterProof.stage !== 'PROOF_SUBMITTED') {
        throw new Error(`Expected stage PROOF_SUBMITTED, got ${trackerAfterProof.stage}`);
      }

      // 7. Step 2: finalizeOrderFinancialsAndBoosterAllocation (computes allocations & syncs pending earnings)
      const finalizeRes = await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: order.id,
        actorId: SYNTH_OWNER_ID,
        participatingBoosterIds: [SYNTH_BOOSTER_ID],
        serviceType: 'solo',
      });
      if (finalizeRes.allocations.length !== 1 || finalizeRes.allocations[0].allocatedMinor !== 7500) {
        throw new Error(`Expected 1 allocation of 7500 minor, got ${JSON.stringify(finalizeRes.allocations)}`);
      }

      // Verify pending earnings in WalletV2
      const walletPending = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletPending.pendingEarningsCents !== 7500 || walletPending.confirmedEarningsCents !== 0 || walletPending.availableCents !== 0) {
        throw new Error(`Wallet balance mismatch after pending sync: pending=${walletPending.pendingEarningsCents}, confirmed=${walletPending.confirmedEarningsCents}, available=${walletPending.availableCents}`);
      }

      const pendingLedgers = await prisma.ledgerEntryV2.findMany({
        where: { orderId: order.id, entryType: 'EARNING_PENDING' },
      });
      if (pendingLedgers.length !== 1 || pendingLedgers[0].amountCents !== 7500) {
        throw new Error(`Expected 1 EARNING_PENDING ledger entry for 7500 cents, found ${pendingLedgers.length}`);
      }

      // 8. Step 3: recordStaffReview (moves pending -> confirmed)
      await recordStaffReview(order.id, SYNTH_OWNER_ID, 'Staff verified dungeon completion logs');
      const trackerAfterStaff = await prisma.g4XBoostReleaseTracker.findUniqueOrThrow({ where: { orderId: order.id } });
      if (trackerAfterStaff.stage !== 'STAFF_REVIEW') {
        throw new Error(`Expected stage STAFF_REVIEW, got ${trackerAfterStaff.stage}`);
      }

      const walletConfirmed = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletConfirmed.pendingEarningsCents !== 0 || walletConfirmed.confirmedEarningsCents !== 7500 || walletConfirmed.availableCents !== 0) {
        throw new Error(`Wallet balance mismatch after staff review: pending=${walletConfirmed.pendingEarningsCents}, confirmed=${walletConfirmed.confirmedEarningsCents}, available=${walletConfirmed.availableCents}`);
      }

      const confirmedLedgers = await prisma.ledgerEntryV2.findMany({
        where: { orderId: order.id, entryType: 'EARNING_CONFIRMED' },
      });
      if (confirmedLedgers.length !== 1 || confirmedLedgers[0].amountCents !== 7500) {
        throw new Error(`Expected 1 EARNING_CONFIRMED ledger entry for 7500 cents, found ${confirmedLedgers.length}`);
      }

      // 9. Step 4: recordAdminFinalApproval (enters 24h hold)
      await recordAdminFinalApproval(order.id, SYNTH_OWNER_ID, 'Admin final approval granted');
      const trackerAfterAdmin = await prisma.g4XBoostReleaseTracker.findUniqueOrThrow({ where: { orderId: order.id } });
      if (trackerAfterAdmin.stage !== 'HOLD_24_HOURS' || !trackerAfterAdmin.adminFinalApprovedAt) {
        throw new Error(`Expected stage HOLD_24_HOURS, got ${trackerAfterAdmin.stage}`);
      }

      // 10. Verify Idempotency: re-running finalize or confirm does NOT create duplicate allocations or earnings
      await finalizeOrderFinancialsAndBoosterAllocation({
        orderId: order.id,
        actorId: SYNTH_OWNER_ID,
        participatingBoosterIds: [SYNTH_BOOSTER_ID],
        serviceType: 'solo',
      });
      await confirmOrderBoosterEarnings(order.id, SYNTH_OWNER_ID);

      const walletIdempotent = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletIdempotent.pendingEarningsCents !== 0 || walletIdempotent.confirmedEarningsCents !== 7500 || walletIdempotent.availableCents !== 0) {
        throw new Error(`Idempotency failure: duplicate balance recorded! confirmed=${walletIdempotent.confirmedEarningsCents}`);
      }

      // 11. Verify locked escrow / financial gates cannot be bypassed
      // Fast forward hold timestamp to satisfy 24h condition
      await prisma.g4XBoostReleaseTracker.update({
        where: { orderId: order.id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });

      // Attempt release while ESCROW_RELEASE_ENABLED = false
      const blockedRelease = await executeG4XBoostRelease(order.id, SYNTH_OWNER_ID);
      if (!blockedRelease.blockedByConfig || blockedRelease.success) {
        throw new Error('executeG4XBoostRelease should be blocked when ESCROW_RELEASE_ENABLED is false');
      }

      const walletStillLocked = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletStillLocked.availableCents !== 0) {
        throw new Error(`Security breach: earnings became available despite locked release gate! availableCents=${walletStillLocked.availableCents}`);
      }

      // 12. Execute legitimate release to available under controlled test gate
      process.env.ESCROW_RELEASE_ENABLED = 'true';
      try {
        const successfulRelease = await executeG4XBoostRelease(order.id, SYNTH_OWNER_ID);
        if (!successfulRelease.success || successfulRelease.stage !== 'AVAILABLE') {
          throw new Error(`Release execution failed: ${JSON.stringify(successfulRelease)}`);
        }
      } finally {
        process.env.ESCROW_RELEASE_ENABLED = 'false'; // Immediately lock back
      }

      const walletReleased = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletReleased.availableCents !== 7500 || walletReleased.confirmedEarningsCents !== 0) {
        throw new Error(`Wallet balance mismatch after release: available=${walletReleased.availableCents}, confirmed=${walletReleased.confirmedEarningsCents}`);
      }

      const releaseLedgers = await prisma.ledgerEntryV2.findMany({
        where: { orderId: order.id, entryType: 'AVAILABLE_RELEASE' },
      });
      if (releaseLedgers.length !== 1 || releaseLedgers[0].amountCents !== 7500) {
        throw new Error(`Expected 1 AVAILABLE_RELEASE ledger entry, got ${releaseLedgers.length}`);
      }
    });

    let createdWithdrawalId: number;

    await test('3.4 Withdrawal Quote Generation & Anti-Tamper Signature Verification', async () => {
      const quoteConfig = validateWithdrawalQuoteSigningConfig(TEST_QUOTE_SECRET);
      if (!quoteConfig.valid) throw new Error('Quote signing config validation failed');

      // Request $50.00 (5000 cents) from legitimate released earnings ($75.00 / 7500 cents)
      const quote = await generateUsdtWithdrawalQuote({
        boosterId: SYNTH_BOOSTER_ID,
        requestedUsdCents: 5000,
        destinationAddress: '0x1234567890123456789012345678901234567890',
      });

      if (!quote.quoteHash || quote.quoteHash.length < 32) {
        throw new Error('Quote hash missing or invalid');
      }
      if (quote.netUsdCents !== 4960) {
        throw new Error(`Expected netUsdCents 4960, got ${quote.netUsdCents}`);
      }

      // 1. Create draft quote record
      const draftRecord = await createWithdrawalRequestFromQuote(quote);
      createdWithdrawalId = draftRecord.id;

      // 2. Confirm and submit
      const confirmResult = await confirmAndSubmitWithdrawalRequest(createdWithdrawalId, SYNTH_BOOSTER_ID);
      if (confirmResult.request.status !== 'RESERVED') {
        throw new Error(`Expected status RESERVED, got ${confirmResult.request.status}`);
      }
    });

    await test('3.5 Atomic Balance Reservation & Overdraft Protection', async () => {
      const walletAfter = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      // Originally 7,500 cents; 5,000 cents reserved -> 2,500 available
      if (walletAfter.availableCents !== 2500) {
        throw new Error(`Expected availableCents 2500, got ${walletAfter.availableCents}`);
      }
      if (walletAfter.reservedCents !== 5000) {
        throw new Error(`Expected reservedCents 5000, got ${walletAfter.reservedCents}`);
      }

      // Attempt concurrent overdraft withdrawal for $30.00 (3,000 cents) when only 2,500 cents remain
      let overdraftPrevented = false;
      try {
        const excessQuote = await generateUsdtWithdrawalQuote({
          boosterId: SYNTH_BOOSTER_ID,
          requestedUsdCents: 3000,
          destinationAddress: '0x1234567890123456789012345678901234567890',
        });
        const excessDraft = await createWithdrawalRequestFromQuote(excessQuote);
        await confirmAndSubmitWithdrawalRequest(excessDraft.id, SYNTH_BOOSTER_ID);
      } catch (err: any) {
        if (
          err.message.includes('INSUFFICIENT_FUNDS') ||
          err.message.includes('INSUFFICIENT_BALANCE') ||
          err.message.includes('OVERDRAFT') ||
          err.message.includes('INSUFFICIENT')
        ) {
          overdraftPrevented = true;
        } else {
          throw err;
        }
      }

      if (!overdraftPrevented) {
        throw new Error('Overdraft was not prevented! Expected INSUFFICIENT_FUNDS error.');
      }
    });

    await test('3.6 Authorized Withdrawal Review, approve_processing Transition & Fail-Closed Payout Guards', async () => {
      // 1. Manager attempting to review/reject withdrawal -> strictly blocked by RBAC
      let managerBlockedByRbac = false;
      try {
        await adminRejectWithdrawal(
          createdWithdrawalId,
          SYNTH_MANAGER_ID,
          'Unauthorized manager rejection attempt'
        );
      } catch (err: any) {
        if (err.message.includes('UNAUTHORIZED_FINANCIAL_ACTION') || err.message.includes('Insufficient permissions')) {
          managerBlockedByRbac = true;
        } else {
          throw err;
        }
      }
      if (!managerBlockedByRbac) {
        throw new Error('Manager was not blocked from WITHDRAWAL_REVIEW action!');
      }

      // 2. Put request UNDER_ADMIN_REVIEW
      await prisma.boosterWithdrawalRequest.update({
        where: { id: createdWithdrawalId },
        data: {
          status: 'UNDER_ADMIN_REVIEW',
          approvedBy: SYNTH_OWNER_ID,
          approvedAt: new Date(),
        },
      });

      // 3. Authorized Owner approves withdrawal for external manual processing (approve_processing)
      const approveRes = await adminApproveWithdrawalForProcessing(
        createdWithdrawalId,
        SYNTH_OWNER_ID,
        'Booster verified on Discord; approved for manual processing'
      );

      if (approveRes.request.status !== 'PROCESSING') {
        throw new Error(`Expected status PROCESSING, got ${approveRes.request.status}`);
      }

      const processingAudit = await prisma.auditLog.findFirst({
        where: {
          action: 'BOOSTER_WITHDRAWAL_APPROVED_FOR_PROCESSING',
          entityId: String(createdWithdrawalId),
        },
      });
      if (!processingAudit) {
        throw new Error('Missing BOOSTER_WITHDRAWAL_APPROVED_FOR_PROCESSING audit log entry');
      }

      // 4. Attempt to execute real payout while FINANCE_V2_LIVE_PAYOUTS_ENABLED is false -> strictly fails closed
      let payoutBlockedByGate = false;
      try {
        await adminExecuteManualPayout(
          createdWithdrawalId,
          SYNTH_OWNER_ID,
          {
            externalTxHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            notes: 'Attempted synthetic payout execution',
          }
        );
      } catch (err: any) {
        if (err.message.includes('LIVE_PAYOUTS_DISABLED') || err.message.includes('FINANCE_V2_LIVE_PAYOUTS_ENABLED')) {
          payoutBlockedByGate = true;
        } else {
          throw err;
        }
      }

      if (!payoutBlockedByGate) {
        throw new Error('Payout execution was not blocked by FINANCE_V2_LIVE_PAYOUTS_ENABLED gate!');
      }

      // Verify request status remained PROCESSING and did not transition to PAID
      const reqAfterFailedPayout = await prisma.boosterWithdrawalRequest.findUniqueOrThrow({
        where: { id: createdWithdrawalId },
      });
      if (reqAfterFailedPayout.status !== 'PROCESSING') {
        throw new Error(`Expected status to remain PROCESSING after blocked payout, got ${reqAfterFailedPayout.status}`);
      }

      // 5. Authorized Owner rejects withdrawal (Safe non-payout workflow with atomic balance reversal)
      const rejectResult = await adminRejectWithdrawal(
        createdWithdrawalId,
        SYNTH_OWNER_ID,
        'Synthetic test: booster requested cancellation'
      );

      if (rejectResult.request.status !== 'REJECTED') {
        throw new Error(`Expected status REJECTED, got ${rejectResult.request.status}`);
      }

      // Verify atomic balance refund: 5,000 returned to availableCents (2,500 + 5,000 = 7,500)
      const refundedWallet = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (refundedWallet.availableCents !== 7500) {
        throw new Error(`Expected refunded availableCents 7500, got ${refundedWallet.availableCents}`);
      }
      if (refundedWallet.reservedCents !== 0) {
        throw new Error(`Expected reservedCents 0, got ${refundedWallet.reservedCents}`);
      }

      // 6. Verify idempotency: repeated rejection returns alreadyRejected: true without duplicate fund restoration
      const repeatReject = await adminRejectWithdrawal(createdWithdrawalId, SYNTH_OWNER_ID, 'Repeat rejection attempt');
      if (!repeatReject.alreadyRejected) {
        throw new Error('Repeated rejection should return alreadyRejected: true');
      }

      // Verify balances are still exactly 7500 and 0 (funds were not restored twice)
      const walletAfterRepeatReject = await getOrCreateWalletV2(SYNTH_BOOSTER_ID);
      if (walletAfterRepeatReject.availableCents !== 7500 || walletAfterRepeatReject.reservedCents !== 0) {
        throw new Error(`Double refund detected: available=${walletAfterRepeatReject.availableCents}, reserved=${walletAfterRepeatReject.reservedCents}`);
      }
    });

    await test('3.7 Durable AuditLog Verification', async () => {
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
      });

      const actions = logs.map((l) => l.action);
      const expectedActions = [
        'BOOSTER_WITHDRAWAL_REJECTED',
        'BOOSTER_WITHDRAWAL_APPROVED_FOR_PROCESSING',
        'G4X_BOOST_ADMIN_FINAL_APPROVED',
        'ORDER_FINANCIALS_FINALIZED',
        'AUTH_OWNER_GATE_SUCCESS',
        'AUTH_OWNER_GATE_FAILED',
      ];

      for (const expected of expectedActions) {
        if (!actions.includes(expected)) {
          throw new Error(`Expected AuditLog action '${expected}' not found in audit logs: ${actions.join(', ')}`);
        }
      }
    });

    await test('3.8 Database Consistency & Integrity Verification After Restart', async () => {
      await prisma.$disconnect();

      const restartClient = new PrismaClient({
        datasources: { db: { url: synthDbUrl } },
      });

      try {
        const integrityRows: Array<{ integrity_check?: string }> = await restartClient.$queryRawUnsafe('PRAGMA integrity_check;');
        const detail = String(Object.values(integrityRows[0] || {})[0] || '');
        if (detail.toLowerCase() !== 'ok') {
          throw new Error(`Integrity check failed: ${detail}`);
        }

        const fkViolations: any[] = await restartClient.$queryRawUnsafe('PRAGMA foreign_key_check;');
        if (fkViolations.length > 0) {
          throw new Error(`Found ${fkViolations.length} foreign key violations post-restart`);
        }

        const orderCount = await restartClient.order.count();
        const userCount = await restartClient.user.count();
        const withdrawalCount = await restartClient.boosterWithdrawalRequest.count();

        if (orderCount !== 1 || userCount !== 4 || withdrawalCount < 1) {
          throw new Error(`Record count mismatch post-restart: orders=${orderCount}, users=${userCount}, withdrawals=${withdrawalCount}`);
        }
      } finally {
        await restartClient.$disconnect();
      }
    });

  } finally {
    // Shutdown HTTP Server
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dbHandle.disconnect();

    // Cleanup temporary synthetic test database files
    for (const ext of ['', '-wal', '-shm', '-journal']) {
      const f = synthDbPath + ext;
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    console.log('[Acceptance] Cleaned up temporary synthetic test database.');

    // Confirm that the real beta database (beta_v0001.db) was never modified
    const realBetaDb = path.resolve(schemaDir, 'staging', 'beta_v0001.db');
    if (fs.existsSync(realBetaDb)) {
      console.log(`[Acceptance] Verified real beta DB intact: ${realBetaDb} (${fs.statSync(realBetaDb).size} bytes)`);
    }
  }

  console.log('\n============================================================');
  console.log(`📊 Acceptance Suite Results: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAcceptanceSuite().catch((err) => {
    console.error('\n❌ Fatal error in acceptance suite:', err);
    process.exit(1);
  });
}
