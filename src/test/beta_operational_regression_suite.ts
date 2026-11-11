/**
 * src/test/beta_operational_regression_suite.ts
 *
 * Consolidated Operational Closed-Beta v0.001 End-to-End Regression Suite.
 *
 * Covers every P0/P1 beta operational blocker implemented across Workstreams 1-5:
 *  1. Environment validation, non-public binding, confined DB paths, and live gate lock invariants.
 *  2. Booster earnings pipeline: proof submit -> pending -> review/approval -> confirmed -> gated release.
 *     Verifies deterministic idempotency keys, concurrent calls, and ESCROW_RELEASE_ENABLED='false' lock.
 *  3. Withdrawal queue, RBAC matrix, UI-API audit-history contract, approve_processing transition,
 *     concurrent reservation race protection (WalletV2 atomic decrement/increment), and quote signing config.
 *  4. Persistent operational beta database lifecycle: restart persistence, atomic WAL-checkpointed backup,
 *     simulated DB corruption + restore recovery, and integrity/foreign-key checks.
 *  5. Invite-only Closed Beta OAuth2 & session enforcement (no synthetic staging bypass, g4x_beta.sid).
 *  6. Idempotent legacy Discord order intake (--dry-run preview vs confirmed import, historical_imported
 *     zero auto-credit rule, active order creation, duplicate skipping).
 */

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';
import prisma, { setGlobalPrismaClient } from '../database/db';
import { validateBetaEnvironment, validateBetaDatabaseUrl } from '../beta/validateBetaEnv';
import {
  initializeBetaDatabase,
  createBetaDatabaseBackup,
  restoreBetaDatabaseFromBackup,
} from '../beta/betaDatabase';
import { startBetaRunner } from '../beta/betaRunner';
import { createBetaApp } from '../beta/betaApp';
import { importLegacyBetaOrders } from '../beta/legacyOrderImport';
import {
  recordProofSubmitted,
  recordStaffReview,
  recordAdminFinalApproval,
  executeG4XBoostRelease,
} from '../services/financeV2/g4xBoostReleaseService';
import {
  syncOrderPendingEarnings,
  confirmOrderBoosterEarnings,
} from '../services/financeV2/boosterEarningsSyncService';
import { finalizeOrderFinancialsAndBoosterAllocation } from '../services/financialCalculationEngine';
import {
  getWalletV2Summary,
  assertWalletInvariants,
} from '../services/financeV2/financeV2WalletService';
import {
  generateUsdtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  confirmAndSubmitWithdrawalRequest,
  adminRejectWithdrawal,
  validateWithdrawalQuoteSigningConfig,
} from '../services/financeV2/boosterWithdrawalService';
import { setGlobalDiscordClient } from '../services/orderDiscordService';

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
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  json: any;
}

function httpRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  options: { cookie?: string; headers?: Record<string, string>; body?: any } = {}
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, baseUrl);
    const bodyStr =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (options.cookie) {
      reqHeaders['Cookie'] = options.cookie;
    }
    if (bodyStr !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method,
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
            headers: res.headers as any,
            bodyText,
            json,
          });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  for (const raw of arr) {
    const firstPart = raw.split(';')[0].trim();
    if (firstPart.startsWith(`${name}=`)) {
      return firstPart;
    }
  }
  return null;
}

const VALID_QUOTE_SECRET = 'g4x_beta_quote_signing_secret_9876543210_abcdef';
const VALID_SESSION_SECRET = 'g4x_beta_session_secret_9876543210_abcdef';
const VALID_OWNER_KEY = 'g4x_beta_owner_access_key_123456';

const OWNER_ID = '111111111111111101';
const ADMIN_ID = '111111111111111102';
const STAFF_ID = '111111111111111103';
const MANAGER_ID = '111111111111111104';
const BOOSTER1_ID = '111111111111111105';
const BOOSTER2_ID = '111111111111111106';
const UNINVITED_ID = '999999999999999999';
const TEST_GUILD_ID = '1485549539447111771';
const TEST_APP_ID = '1485549800000000001';

function buildBaseBetaEnv(dbPath: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    BETA_MODE: 'true',
    DISCORD_LAB_MODE: 'false',
    BETA_DISCORD_ENABLED: 'false',
    BETA_OAUTH_ENABLED: 'false',
    BETA_HOST: '127.0.0.1',
    BETA_PORT: '3098',
    COOKIE_SECURE: 'false',
    DATABASE_URL: `file:${dbPath.replace(/\\/g, '/')}`,
    SESSION_SECRET: VALID_SESSION_SECRET,
    G4X_OWNER_ACCESS_KEY: VALID_OWNER_KEY,
    WITHDRAWAL_QUOTE_SIGNING_SECRET: VALID_QUOTE_SECRET,
    OWNER_DISCORD_ID: OWNER_ID,
    BETA_INVITE_ALLOWLIST_IDS: `${OWNER_ID},${ADMIN_ID},${STAFF_ID},${MANAGER_ID},${BOOSTER1_ID},${BOOSTER2_ID}`,
    DISCORD_CLIENT_ID: 'mock_client_id',
    DISCORD_CLIENT_SECRET: 'mock_client_secret',
    DISCORD_REDIRECT_URI: 'http://127.0.0.1:3098/auth/callback',
    FINANCE_V2_LIVE_CREDITS_ENABLED: 'false',
    FINANCE_V2_LIVE_PAYOUTS_ENABLED: 'false',
    FINANCE_V2_P2P_SETTLEMENT_ENABLED: 'false',
    NOWPAYMENTS_LIVE_COLLECTION_ENABLED: 'false',
    ESCROW_RELEASE_ENABLED: 'false',
    RAIDERIO_LIVE_SYNC_ENABLED: 'false',
    NOWPAYMENTS_MODE: 'disabled',
  };
}

async function main() {
  console.log('\n============================================================');
  console.log('🚀 G4X Operational Closed Beta v0.001 — Regression Suite');
  console.log('============================================================\n');

  const schemaDir = findPrismaSchemaDir();
  const testRunDir = path.resolve(schemaDir, 'staging', `beta_op_test_${Date.now()}_${process.pid}`);
  fs.mkdirSync(testRunDir, { recursive: true });
  const testDbPath = path.resolve(testRunDir, 'beta_v0001.db');

  const prevEnv = { ...process.env };
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
  };

  try {
    // ─── Group 1: Env, Gate Locks & Database Containment ──────────────────────
    await test('1.1 validateBetaEnvironment rejects live gates, public wildcard bind, dev/prod DBs, and token fallback', () => {
      const validEnv = buildBaseBetaEnv(testDbPath);
      const ok = validateBetaEnvironment(validEnv);
      assert.strictEqual(ok.valid, true, `Expected valid config, got errors: ${ok.errors.join('; ')}`);

      const gateBad = validateBetaEnvironment({ ...validEnv, ESCROW_RELEASE_ENABLED: 'true' });
      assert.strictEqual(gateBad.valid, false);
      assert(gateBad.errors.some((e) => e.includes('ESCROW_RELEASE_ENABLED')));

      const npBad = validateBetaEnvironment({ ...validEnv, NOWPAYMENTS_MODE: 'live' });
      assert.strictEqual(npBad.valid, false);

      const hostBad = validateBetaEnvironment({ ...validEnv, BETA_HOST: '0.0.0.0' });
      assert.strictEqual(hostBad.valid, false);
      assert(hostBad.errors.some((e) => e.includes('0.0.0.0')));

      const labMixBad = validateBetaEnvironment({ ...validEnv, DISCORD_LAB_MODE: 'true' });
      assert.strictEqual(labMixBad.valid, false);

      for (const badUrl of [
        'file:./dev.db',
        'file:./g4x.db',
        'file:../data/g4x.db',
        'file:./staging/g4x.db',
        'file:./staging/discord_lab_temp.db',
      ]) {
        const res = validateBetaDatabaseUrl(badUrl);
        assert.strictEqual(res.valid, false, `Expected refusal for ${badUrl}`);
      }

      assert.strictEqual(validateWithdrawalQuoteSigningConfig('').valid, false);
      assert.strictEqual(validateWithdrawalQuoteSigningConfig('short_secret').valid, false);
      assert.strictEqual(validateWithdrawalQuoteSigningConfig('test_secret_32_characters_minimum').valid, false);
      assert.strictEqual(validateWithdrawalQuoteSigningConfig(VALID_QUOTE_SECRET).valid, true);

      const botMissing = validateBetaEnvironment(
        {
          ...validEnv,
          BETA_DISCORD_ENABLED: 'true',
          DISCORD_TOKEN: 'prod_token_should_never_be_reused_123456',
          BETA_ALLOWED_GUILD_ID: TEST_GUILD_ID,
          BETA_APPLICATION_ID: TEST_APP_ID,
        },
        { requireDiscordBotConfig: true }
      );
      assert.strictEqual(botMissing.valid, false);

      const botSameAsProd = validateBetaEnvironment(
        {
          ...validEnv,
          BETA_DISCORD_ENABLED: 'true',
          DISCORD_TOKEN: 'shared_token_secret_1234567890123456',
          BETA_BOT_TOKEN: 'shared_token_secret_1234567890123456',
          BETA_ALLOWED_GUILD_ID: TEST_GUILD_ID,
          BETA_APPLICATION_ID: TEST_APP_ID,
        },
        { requireDiscordBotConfig: true }
      );
      assert.strictEqual(botSameAsProd.valid, false);
    });

    Object.assign(process.env, buildBaseBetaEnv(testDbPath));
    const dbHandle = await initializeBetaDatabase(process.env.DATABASE_URL!, { silent: true });
    setGlobalPrismaClient(dbHandle.prismaClient);
    setGlobalDiscordClient(null);

    try {
      // Seed Role, User, UserRole, Game, and GameService
      for (const r of ['owner', 'admin', 'staff', 'manager', 'booster']) {
        await prisma.role.upsert({
          where: { roleKey: r },
          update: { name: r.toUpperCase() },
          create: { roleKey: r, name: r.toUpperCase() },
        });
      }

      const seedUsers = [
        { discordId: OWNER_ID, username: 'beta_owner', roleKey: 'owner' },
        { discordId: ADMIN_ID, username: 'beta_admin', roleKey: 'admin' },
        { discordId: STAFF_ID, username: 'beta_staff', roleKey: 'staff' },
        { discordId: MANAGER_ID, username: 'beta_manager', roleKey: 'manager' },
        { discordId: BOOSTER1_ID, username: 'beta_booster1', roleKey: 'booster' },
        { discordId: BOOSTER2_ID, username: 'beta_booster2', roleKey: 'booster' },
      ];
      for (const su of seedUsers) {
        await prisma.user.create({
          data: { discordId: su.discordId, username: su.username, isActive: true },
        });
        await prisma.userRole.create({
          data: { userId: su.discordId, roleKey: su.roleKey },
        });
      }

      await prisma.game.create({
        data: {
          slug: 'wow_midnight',
          displayName: 'World of Warcraft Midnight',
          serviceCategory: 'both',
          isActive: true,
        },
      });
      const service = await prisma.gameService.create({
        data: {
          gameSlug: 'wow_midnight',
          serviceKey: 'mythic_plus',
          displayName: 'Mythic+ Boosting',
          serviceMode: 'non_pilot',
          profileMode: 'raiderio',
          isActive: true,
        },
      });

      // ─── Group 2: Wallet & Earnings Linkage + Idempotency + Gate Lock ───────
      let completedOrderId = 0;
      await test('2.1 Proof submit -> pendingEarningsCents -> admin approval -> confirmedEarningsCents (locked behind ESCROW_RELEASE_ENABLED=false)', async () => {
        const order = await prisma.order.create({
          data: {
            orderRef: `G4X-BETA-ORD-${Date.now()}`,
            gameSlug: 'wow_midnight',
            serviceId: service.id,
            customerId: OWNER_ID,
            creatorType: 'g4x',
            sourceType: 'internal',
            orderType: 'group',
            orderMode: 'non_pilot',
            currency: 'USD',
            grossAmountMinor: 10000,
            platformFeeMinor: 1500,
            advertiserFeeMinor: 0,
            boosterPoolMinor: 8500,
            paymentStatus: 'verified',
            status: 'completed',
          },
        });
        completedOrderId = order.id;

        const a1 = await prisma.orderAssignment.create({
          data: {
            orderId: order.id,
            userId: BOOSTER1_ID,
            assignedById: STAFF_ID,
            assignedRole: 'tank',
            status: 'completed',
          },
        });
        const a2 = await prisma.orderAssignment.create({
          data: {
            orderId: order.id,
            userId: BOOSTER2_ID,
            assignedById: STAFF_ID,
            assignedRole: 'healer',
            status: 'completed',
          },
        });

        const run = await prisma.orderRun.create({
          data: {
            orderId: order.id,
            runNumber: 1,
            status: 'completed',
          },
        });
        await prisma.runAssignment.createMany({
          data: [
            { runId: run.id, assignmentId: a1.id, roleName: 'tank', status: 'completed' },
            { runId: run.id, assignmentId: a2.id, roleName: 'healer', status: 'completed' },
          ],
        });

        await prisma.orderFinancialSnapshot.create({
          data: {
            orderId: order.id,
            sourcePlatform: 'direct',
            sourceAmountType: 'gross_sale',
            sourceAmountMinor: 10000,
            platformOrderNetMinor: 10000,
            externalNetBaseMinor: 10000,
            boosterPoolMinor: 8500,
            calculationStatus: 'provisional',
          },
        });

        await finalizeOrderFinancialsAndBoosterAllocation({
          orderId: order.id,
          actorId: OWNER_ID,
          participatingBoosterIds: [BOOSTER1_ID, BOOSTER2_ID],
          serviceType: 'team',
        });

        await recordProofSubmitted(order.id, BOOSTER1_ID);
        await Promise.all([
          syncOrderPendingEarnings(order.id, STAFF_ID),
          syncOrderPendingEarnings(order.id, STAFF_ID),
        ]);

        const w1Pending = await getWalletV2Summary(BOOSTER1_ID);
        const w2Pending = await getWalletV2Summary(BOOSTER2_ID);
        assert.strictEqual(w1Pending.pendingEarningsCents, 4250);
        assert.strictEqual(w2Pending.pendingEarningsCents, 4250);
        assert.strictEqual(w1Pending.confirmedEarningsCents, 0);
        assert.strictEqual(w1Pending.availableCents, 0);

        await recordStaffReview(order.id, STAFF_ID, 'Verified screenshot');
        await recordAdminFinalApproval(order.id, ADMIN_ID, 'Finalized for release');
        await Promise.all([
          confirmOrderBoosterEarnings(order.id, ADMIN_ID),
          confirmOrderBoosterEarnings(order.id, ADMIN_ID),
        ]);

        const w1Conf = await getWalletV2Summary(BOOSTER1_ID);
        const w2Conf = await getWalletV2Summary(BOOSTER2_ID);
        assert.strictEqual(w1Conf.pendingEarningsCents, 0);
        assert.strictEqual(w2Conf.pendingEarningsCents, 0);
        assert.strictEqual(w1Conf.confirmedEarningsCents, 4250);
        assert.strictEqual(w2Conf.confirmedEarningsCents, 4250);
        assert.strictEqual(w1Conf.availableCents, 0, 'Locked while ESCROW_RELEASE_ENABLED=false');
        assert.strictEqual(w2Conf.availableCents, 0);
        assertWalletInvariants(w1Conf);
        assertWalletInvariants(w2Conf);

        await prisma.g4XBoostReleaseTracker.update({
          where: { orderId: order.id },
          data: { holdExpiresAt: new Date(Date.now() - 3600_000) },
        });
        await prisma.orderFinancialSnapshot.upsert({
          where: { orderId: order.id },
          update: { calculationStatus: 'finalized' },
          create: {
            orderId: order.id,
            sourcePlatform: 'direct',
            sourceAmountType: 'gross_sale',
            sourceAmountMinor: 10000,
            platformOrderNetMinor: 10000,
            externalNetBaseMinor: 10000,
            boosterPoolMinor: 8500,
            calculationStatus: 'finalized',
          },
        });

        const blockedRelease = await executeG4XBoostRelease(order.id, OWNER_ID);
        assert.strictEqual(blockedRelease.blockedByConfig, true);
        assert.strictEqual((await getWalletV2Summary(BOOSTER1_ID)).availableCents, 0);
      });

      // ─── Group 3: Withdrawal Concurrency, Queue, Permissions & HTTP App ─────
      await test('3.1 Concurrent withdrawal reservations cannot overdraft WalletV2 (atomic conditional decrement)', async () => {
        await prisma.walletV2.upsert({
          where: { userId: BOOSTER1_ID },
          update: { availableCents: 10000 },
          create: { userId: BOOSTER1_ID, availableCents: 10000 },
        });

        const addr = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
        const q1 = await generateUsdtWithdrawalQuote({
          boosterId: BOOSTER1_ID,
          requestedUsdCents: 8000,
          destinationAddress: addr,
        });
        const q2 = await generateUsdtWithdrawalQuote({
          boosterId: BOOSTER1_ID,
          requestedUsdCents: 8000,
          destinationAddress: addr,
        });

        const req1 = await createWithdrawalRequestFromQuote(q1);
        const req2 = await createWithdrawalRequestFromQuote(q2);

        const [r1, r2] = await Promise.allSettled([
          confirmAndSubmitWithdrawalRequest(req1.id, BOOSTER1_ID),
          confirmAndSubmitWithdrawalRequest(req2.id, BOOSTER1_ID),
        ]);

        const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
        const rejected = [r1, r2].filter((r) => r.status === 'rejected');
        assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent $80 reservation out of $100 balance must succeed');
        assert.strictEqual(rejected.length, 1, 'Conflicting concurrent reservation must fail atomically');

        const wAfter = await getWalletV2Summary(BOOSTER1_ID);
        assert.strictEqual(wAfter.availableCents, 2000);
        assert.strictEqual(wAfter.reservedCents, 8000);
        assertWalletInvariants(wAfter);
      });

      await test('3.2 Invite-only OAuth2 betaApp, RBAC, UNDER_ADMIN_REVIEW queue, approve_processing, reject, audit-history & release gate HTTP contracts', async () => {
        const underReview = await prisma.boosterWithdrawalRequest.create({
          data: {
            withdrawalRef: `WDR-BETA-REVIEW-${Date.now()}`,
            boosterId: BOOSTER2_ID,
            payoutMethod: 'USDT_BEP20',
            requestedUsdCents: 3000,
            fixedFeeUsdCents: 200,
            netUsdCents: 2800,
            quotedNetPayoutAmount: '28.00',
            quotedCurrency: 'USDT',
            quoteExpiresAt: new Date(Date.now() + 3600_000),
            quoteHash: 'mock_hash_review_1',
            destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            status: 'UNDER_ADMIN_REVIEW',
          },
        });
        await prisma.walletV2.upsert({
          where: { userId: BOOSTER2_ID },
          update: { reservedCents: 3000 },
          create: { userId: BOOSTER2_ID, reservedCents: 3000 },
        });

        let currentOAuthUser: { id: string; username: string } = {
          id: UNINVITED_ID,
          username: 'stranger',
        };
        const app = createBetaApp({
          inviteAllowlistIds: [OWNER_ID, ADMIN_ID, STAFF_ID, MANAGER_ID, BOOSTER1_ID, BOOSTER2_ID],
          sessionSecret: VALID_SESSION_SECRET,
          cookieSecure: false,
          oauthHttpClient: {
            post: (async () => ({ data: { access_token: 'mock_oauth_tok' } })) as any,
            get: (async () => ({ data: currentOAuthUser })) as any,
          },
        });

        const server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as any).port;
        const baseUrl = `http://127.0.0.1:${port}`;

        const loginViaOAuth = async (discordId: string, username: string) => {
          currentOAuthUser = { id: discordId, username };
          const authInit = await httpRequest(baseUrl, 'GET', '/auth/discord');
          assert.strictEqual(authInit.status, 302);
          const initCookie = extractCookie(authInit.headers['set-cookie'], 'g4x_beta.sid');
          assert(initCookie, 'Expected g4x_beta.sid cookie on OAuth init');
          const redirectLoc = String(authInit.headers['location'] || '');
          const state = new URL(redirectLoc).searchParams.get('state') || '';
          assert(state.length > 10);

          const cb = await httpRequest(
            baseUrl,
            'GET',
            `/auth/callback?code=mock_code&state=${encodeURIComponent(state)}`,
            { cookie: initCookie }
          );
          const finalCookie = extractCookie(cb.headers['set-cookie'], 'g4x_beta.sid') || initCookie;
          return { cb, cookie: finalCookie };
        };

        try {
          const health = await httpRequest(baseUrl, 'GET', '/api/beta/health');
          assert.strictEqual(health.status, 200);
          assert.strictEqual(health.json.mode, 'operational-beta');

          const stagingBypass = await httpRequest(baseUrl, 'POST', '/api/auth/staging-login', {
            body: { discordId: ADMIN_ID },
          });
          assert.strictEqual(stagingBypass.status, 404);

          const uninvited = await loginViaOAuth(UNINVITED_ID, 'uninvited_user');
          assert.strictEqual(uninvited.cb.status, 403);
          assert.strictEqual(uninvited.cb.json?.error, 'CLOSED_BETA_INVITE_REQUIRED');
          assert.strictEqual(
            await prisma.user.findUnique({ where: { discordId: UNINVITED_ID } }),
            null
          );

          const adminAuth = await loginViaOAuth(ADMIN_ID, 'beta_admin');
          assert.strictEqual(adminAuth.cb.status, 302);
          const adminCsrf = (
            await httpRequest(baseUrl, 'GET', '/api/csrf-token', { cookie: adminAuth.cookie })
          ).json.csrfToken;

          const mgrAuth = await loginViaOAuth(MANAGER_ID, 'beta_manager');
          assert.strictEqual(mgrAuth.cb.status, 302);
          const mgrCsrf = (
            await httpRequest(baseUrl, 'GET', '/api/csrf-token', { cookie: mgrAuth.cookie })
          ).json.csrfToken;

          const ownerAuth = await loginViaOAuth(OWNER_ID, 'beta_owner');
          assert.strictEqual(ownerAuth.cb.status, 302);
          const ownerCsrf = (
            await httpRequest(baseUrl, 'GET', '/api/csrf-token', { cookie: ownerAuth.cookie })
          ).json.csrfToken;

          const queueRes = await httpRequest(baseUrl, 'GET', '/api/admin/withdrawals', {
            cookie: adminAuth.cookie,
          });
          assert.strictEqual(queueRes.status, 200);
          const queueIds = new Set((queueRes.json.withdrawals || []).map((w: any) => w.id));
          assert(queueIds.has(underReview.id), 'UNDER_ADMIN_REVIEW must appear in default queue');

          const mgrReviewDeny = await httpRequest(
            baseUrl,
            'POST',
            `/api/admin/withdrawals/${underReview.id}/review`,
            {
              cookie: mgrAuth.cookie,
              headers: { 'X-CSRF-Token': mgrCsrf },
              body: { decision: 'approve_processing', notes: 'Should deny' },
            }
          );
          assert.strictEqual(mgrReviewDeny.status, 403);

          const procRes = await httpRequest(
            baseUrl,
            'POST',
            `/api/admin/withdrawals/${underReview.id}/review`,
            {
              cookie: adminAuth.cookie,
              headers: { 'X-CSRF-Token': adminCsrf },
              body: { decision: 'approve_processing', notes: 'Queued for manual batch' },
            }
          );
          assert.strictEqual(procRes.status, 200);
          assert.strictEqual(procRes.json.request?.status, 'PROCESSING');

          const adminPaidDeny = await httpRequest(
            baseUrl,
            'POST',
            `/api/admin/withdrawals/${underReview.id}/review`,
            {
              cookie: adminAuth.cookie,
              headers: { 'X-CSRF-Token': adminCsrf },
              body: { decision: 'approve_paid', txHash: '0x' + 'a'.repeat(64) },
            }
          );
          assert.strictEqual(adminPaidDeny.status, 403);

          const ownerPaidBlocked = await httpRequest(
            baseUrl,
            'POST',
            `/api/admin/withdrawals/${underReview.id}/review`,
            {
              cookie: ownerAuth.cookie,
              headers: { 'X-CSRF-Token': ownerCsrf },
              body: { decision: 'approve_paid', txHash: '0x' + 'b'.repeat(64) },
            }
          );
          assert.strictEqual(ownerPaidBlocked.status, 403);

          const rejectRes = await httpRequest(
            baseUrl,
            'POST',
            `/api/admin/withdrawals/${underReview.id}/review`,
            {
              cookie: adminAuth.cookie,
              headers: { 'X-CSRF-Token': adminCsrf },
              body: { decision: 'reject', reason: 'Wrong BEP20 memo' },
            }
          );
          assert.strictEqual(rejectRes.status, 200);
          const b2AfterReject = await getWalletV2Summary(BOOSTER2_ID);
          assert.strictEqual(b2AfterReject.reservedCents, 0);
          assert.strictEqual(b2AfterReject.availableCents, 3000);

          const dupRej = await adminRejectWithdrawal(underReview.id, ADMIN_ID, 'Duplicate');
          assert.strictEqual(dupRej.alreadyRejected, true);
          assert.strictEqual((await getWalletV2Summary(BOOSTER2_ID)).availableCents, 3000);

          const histRes = await httpRequest(
            baseUrl,
            'GET',
            `/api/admin/withdrawals/${underReview.id}/audit-history`,
            { cookie: adminAuth.cookie }
          );
          assert.strictEqual(histRes.status, 200);
          assert(Array.isArray(histRes.json.logs));
          assert(Array.isArray(histRes.json.history));
          assert(histRes.json.history.length >= 2);
          assert(histRes.json.history[0].details !== null && histRes.json.history[0].details !== undefined);
          assert(histRes.json.history[0].actor?.id);

          const relBlocked = await httpRequest(
            baseUrl,
            'POST',
            `/api/orders/${completedOrderId}/release-earnings`,
            {
              cookie: ownerAuth.cookie,
              headers: { 'X-CSRF-Token': ownerCsrf },
            }
          );
          assert.strictEqual(relBlocked.status, 403);
          assert.strictEqual(relBlocked.json.blockedByConfig, true);

          try {
            process.env.ESCROW_RELEASE_ENABLED = 'true';
            const relOk = await httpRequest(
              baseUrl,
              'POST',
              `/api/orders/${completedOrderId}/release-earnings`,
              {
                cookie: ownerAuth.cookie,
                headers: { 'X-CSRF-Token': ownerCsrf },
              }
            );
            assert.strictEqual(relOk.status, 200);
            assert.strictEqual(relOk.json.success, true);

            const b1Final = await getWalletV2Summary(BOOSTER1_ID);
            const b2Final = await getWalletV2Summary(BOOSTER2_ID);
            assert.strictEqual(b1Final.confirmedEarningsCents, 0);
            assert.strictEqual(b1Final.availableCents, 6250);
            assert.strictEqual(b2Final.confirmedEarningsCents, 0);
            assert.strictEqual(b2Final.availableCents, 7250);

            await assert.rejects(
              () => executeG4XBoostRelease(completedOrderId, OWNER_ID),
              /ALREADY_RELEASED/
            );
            assert.strictEqual((await getWalletV2Summary(BOOSTER1_ID)).availableCents, 6250);
          } finally {
            process.env.ESCROW_RELEASE_ENABLED = 'false';
          }
        } finally {
          (server as any).closeAllConnections?.();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      });

      // ─── Group 4: Legacy Discord Order Intake ───────────────────────────────
      await test('4.1 Legacy Discord order intake: dry-run, historical zero-credit guard, active import & idempotent re-run', async () => {
        const batch = [
          {
            sourceOrderId: 'DISC-HIST-001',
            intakeMode: 'historical_completed' as const,
            gameSlug: 'wow_midnight',
            serviceKey: 'mythic_plus',
            currency: 'USD' as const,
            grossAmountMinor: 15000,
            boosterPoolMinor: 12000,
            assignedBoosters: [{ discordId: BOOSTER1_ID, role: 'tank' }],
          },
          {
            sourceOrderId: 'DISC-ACT-002',
            intakeMode: 'active' as const,
            status: 'assigned',
            gameSlug: 'wow_midnight',
            serviceKey: 'mythic_plus',
            currency: 'USD' as const,
            grossAmountMinor: 9000,
            boosterPoolMinor: 7500,
            paymentStatus: 'verified' as const,
            assignedBoosters: [{ discordId: BOOSTER2_ID, role: 'healer' }],
          },
        ];

        const beforeOrders = await prisma.order.count();
        const b1WalletBefore = await getWalletV2Summary(BOOSTER1_ID);

        const dry = await importLegacyBetaOrders(prisma, batch, {
          dryRun: true,
          actorDiscordId: OWNER_ID,
        });
        assert.strictEqual(dry.dryRun, true);
        assert.strictEqual(dry.createdHistorical, 1);
        assert.strictEqual(dry.createdActive, 1);
        assert.strictEqual(await prisma.order.count(), beforeOrders);

        const run1 = await importLegacyBetaOrders(prisma, batch, {
          dryRun: false,
          confirmImport: true,
          actorDiscordId: OWNER_ID,
        });
        assert.strictEqual(run1.createdHistorical, 1);
        assert.strictEqual(run1.createdActive, 1);
        assert.strictEqual(run1.skippedDuplicate, 0);
        assert.strictEqual(await prisma.order.count(), beforeOrders + 2);

        const b1WalletAfter = await getWalletV2Summary(BOOSTER1_ID);
        assert.strictEqual(b1WalletAfter.availableCents, b1WalletBefore.availableCents);
        assert.strictEqual(b1WalletAfter.pendingEarningsCents, b1WalletBefore.pendingEarningsCents);
        assert.strictEqual(b1WalletAfter.confirmedEarningsCents, b1WalletBefore.confirmedEarningsCents);

        const histOrder = await prisma.order.findFirstOrThrow({
          where: { externalOrderId: 'DISC-HIST-001' },
          include: { financialSnapshot: true },
        });
        assert.strictEqual(histOrder.status, 'completed');
        assert.strictEqual(histOrder.financialSnapshot?.calculationStatus, 'historical_imported');

        const syncAttempt = await syncOrderPendingEarnings(histOrder.id, OWNER_ID);
        assert.strictEqual(syncAttempt.skippedReason, 'HISTORICAL_IMPORT_NO_AUTO_CREDIT');

        const run2 = await importLegacyBetaOrders(prisma, batch, {
          dryRun: false,
          confirmImport: true,
          actorDiscordId: OWNER_ID,
        });
        assert.strictEqual(run2.createdHistorical, 0);
        assert.strictEqual(run2.createdActive, 0);
        assert.strictEqual(run2.skippedDuplicate, 2);
      });

      // ─── Group 5: Backup, Restart Persistence & Corruption Recovery ─────────
      await test('5.1 Persistent DB survives betaRunner stop/restart; backup + corrupt DB restore recovers intact', async () => {
        const expectedOrderCount = await prisma.order.count();
        await dbHandle.disconnect();
        setGlobalPrismaClient(null);

        assert.strictEqual(fs.existsSync(testDbPath), true, 'Persistent beta DB must remain after shutdown');

        const restarted = await startBetaRunner({
          skipDiscordLogin: true,
          silentDb: true,
          hostOverride: '127.0.0.1',
          portOverride: 0,
        });
        try {
          assert.strictEqual(await prisma.order.count(), expectedOrderCount);
          const health = await httpRequest(`http://${restarted.host}:${restarted.port}`, 'GET', '/api/beta/health');
          assert.strictEqual(health.status, 200);
          assert.strictEqual(health.json.ok, true);

          const backupDir = path.resolve(testRunDir, 'backups');
          const backupRes = await createBetaDatabaseBackup(testDbPath, {
            backupDir,
            label: 'restart_verified',
            client: restarted.database.prismaClient,
          });
          assert.strictEqual(backupRes.integrityOk, true);
          assert.strictEqual(backupRes.fkViolationCount, 0);
          assert.strictEqual(backupRes.counts.orders, expectedOrderCount);

          await restarted.stop();

          const badBackup = path.resolve(backupDir, 'corrupt_fake.db');
          fs.writeFileSync(badBackup, Buffer.from('NOT_A_VALID_SQLITE_HEADER'));
          await assert.rejects(
            () => restoreBetaDatabaseFromBackup(badBackup, testDbPath, { preRestoreSnapshotDir: backupDir })
          );

          fs.writeFileSync(testDbPath, Buffer.from('CORRUPTED_BYTES_SIMULATION'));
          const restoreRes = await restoreBetaDatabaseFromBackup(backupRes.backupPath, testDbPath, {
            preRestoreSnapshotDir: backupDir,
          });
          assert.strictEqual(restoreRes.integrityOk, true);
          assert.strictEqual(restoreRes.fkViolationCount, 0);
          assert.strictEqual(restoreRes.counts.orders, expectedOrderCount);
          assert(restoreRes.preRestoreSnapshotPath && fs.existsSync(restoreRes.preRestoreSnapshotPath));

          const checkDb = await initializeBetaDatabase(`file:${testDbPath.replace(/\\/g, '/')}`, { silent: true });
          try {
            assert.strictEqual(await checkDb.prismaClient.order.count(), expectedOrderCount);
          } finally {
            await checkDb.disconnect();
          }
        } finally {
          await restarted.stop();
        }
      });
    } finally {
      setGlobalPrismaClient(null);
      setGlobalDiscordClient(null);
      try { await dbHandle.disconnect(); } catch {}
    }
  } finally {
    restoreEnv();
    try {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n============================================================');
  console.log(`📊 Beta Operational Suite: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal operational suite error:', err);
    process.exit(1);
  });
}
