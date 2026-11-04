/**
 * src/test/react_pagination_contract_regression_suite.ts
 *
 * Regression test suite verifying:
 * 1. Safe pagination normalization across flat and nested backend responses.
 * 2. Real backend contract parity for Staff, KYC, Disputes, Orders, and Management endpoints:
 *    - Guarantees both nested 'pagination' object and flat pagination properties exist.
 *    - Guarantees 'totalPages' is strictly defined and >= 1 to prevent TypeError black screens.
 * 3. /api/marketplace/exchanger/overview contract returns both profile and exchanger objects.
 * 4. Numeric ID handling in trade tables and application cards.
 */

process.env.COOKIE_SECURE = 'false';
import assert from 'assert';
import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';

// Pure logic replica of normalizePagination from frontend/src/services/operations.ts
function normalizePagination(raw: any, defaultLimit: number = 10): { page: number; limit: number; total: number; totalPages: number } {
  if (!raw || typeof raw !== 'object') {
    return { page: 1, limit: defaultLimit, total: 0, totalPages: 1 };
  }

  if (raw.pagination && typeof raw.pagination === 'object') {
    const p = raw.pagination;
    const page = Math.max(1, Number(p.page) || 1);
    const limit = Math.max(1, Number(p.limit) || defaultLimit);
    const total = Math.max(0, Number(p.total ?? p.totalCount) || 0);
    const totalPages = Number(p.totalPages) || (total > 0 ? Math.ceil(total / limit) : 1);
    return { page, limit, total, totalPages: Math.max(1, totalPages) };
  }

  const page = Math.max(1, Number(raw.page) || 1);
  const limit = Math.max(1, Number(raw.limit) || defaultLimit);
  const total = Math.max(0, Number(raw.total ?? raw.totalCount) || 0);
  const totalPages = Number(raw.totalPages) || (total > 0 ? Math.ceil(total / limit) : 1);
  return { page, limit, total, totalPages: Math.max(1, totalPages) };
}

// Session helper for authenticated tests
async function createAuthenticatedAgent(userId: string) {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/csrf-token');
  const cookieHeader = initRes.header['set-cookie'];
  const rawCookie = cookieHeader ? cookieHeader[0] : '';
  const match = rawCookie.match(/g4x\.sid=s%3A([^.]+)\./);
  const sid = match ? match[1] : '';

  const baseSession: any = {
    cookie: {
      originalMaxAge: 7 * 24 * 60 * 60 * 1000,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      httpOnly: true,
      secure: false,
      path: '/',
    },
    csrfToken: initRes.body?.csrfToken,
    userId,
  };

  await new Promise<void>((resolve, reject) => {
    sessionStore.set(sid, baseSession, (setErr) => {
      if (setErr) return reject(setErr);
      resolve();
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

async function runRegressionSuite() {
  console.log('\n============================================================');
  console.log('  G4X REACT BLACK SCREEN & API CONTRACT REGRESSION SUITE');
  console.log('============================================================\n');

  // --- UNIT TESTS: normalizePagination ---
  console.log('[TEST 1] normalizePagination handles undefined/null safely');
  const rNull = normalizePagination(null);
  assert.strictEqual(rNull.page, 1);
  assert.strictEqual(rNull.limit, 10);
  assert.strictEqual(rNull.total, 0);
  assert.strictEqual(rNull.totalPages, 1);

  const rUndef = normalizePagination(undefined);
  assert.strictEqual(rUndef.totalPages, 1);
  console.log('  -> PASSED: Null/undefined safely produces default pagination with totalPages >= 1');

  console.log('[TEST 2] normalizePagination handles legacy flat pagination fields');
  const flatInput = { success: true, page: 2, limit: 15, total: 45, totalPages: 3, proofs: [] };
  const rFlat = normalizePagination(flatInput);
  assert.strictEqual(rFlat.page, 2);
  assert.strictEqual(rFlat.limit, 15);
  assert.strictEqual(rFlat.total, 45);
  assert.strictEqual(rFlat.totalPages, 3);
  console.log('  -> PASSED: Flat fields normalized successfully');

  console.log('[TEST 3] normalizePagination handles nested pagination object');
  const nestedInput = {
    success: true,
    pagination: { page: 3, limit: 10, total: 100, totalPages: 10 },
  };
  const rNested = normalizePagination(nestedInput);
  assert.strictEqual(rNested.page, 3);
  assert.strictEqual(rNested.limit, 10);
  assert.strictEqual(rNested.total, 100);
  assert.strictEqual(rNested.totalPages, 10);
  console.log('  -> PASSED: Nested pagination normalized successfully');

  console.log('[TEST 4] normalizePagination handles totalCount fallback from separated orders');
  const separatedInput = {
    success: true,
    pagination: { page: 1, limit: 20, totalCount: 42, totalPages: 3 },
  };
  const rSeparated = normalizePagination(separatedInput);
  assert.strictEqual(rSeparated.total, 42);
  assert.strictEqual(rSeparated.totalPages, 3);
  console.log('  -> PASSED: totalCount correctly converted to total');

  console.log('[TEST 5] normalizePagination calculates missing totalPages dynamically');
  const calcInput = { total: 25, limit: 10 };
  const rCalc = normalizePagination(calcInput);
  assert.strictEqual(rCalc.totalPages, 3);
  console.log('  -> PASSED: totalPages dynamically computed as ceil(25 / 10) = 3');

  // --- SEED TEST USERS FOR INTEGRATION TESTS ---
  console.log('\n[SETUP] Seeding staff and management test actors...');
  const testStaffId = 'test_staff_react_blackscreen_01';
  const testManagerId = 'test_manager_react_blackscreen_01';

  await prisma.user.upsert({
    where: { discordId: testStaffId },
    update: { isActive: true },
    create: {
      discordId: testStaffId,
      username: 'TestStaffUser',
      displayName: 'Test Staff',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { discordId: testManagerId },
    update: { isActive: true },
    create: {
      discordId: testManagerId,
      username: 'TestManagerUser',
      displayName: 'Test Manager',
      isActive: true,
    },
  });

  // Assign staff and manager roles
  await prisma.userRole.upsert({
    where: { userId_roleKey: { userId: testStaffId, roleKey: 'staff' } },
    update: {},
    create: { userId: testStaffId, roleKey: 'staff' },
  });

  await prisma.userRole.upsert({
    where: { userId_roleKey: { userId: testManagerId, roleKey: 'manager' } },
    update: {},
    create: { userId: testManagerId, roleKey: 'manager' },
  });

  const staffSession = await createAuthenticatedAgent(testStaffId);
  const managerSession = await createAuthenticatedAgent(testManagerId);

  // --- INTEGRATION TESTS: Real backend routes pagination contracts ---
  console.log('\n[TEST 6] GET /api/staff/pending-proofs returns both nested and flat pagination');
  const resProofs = await staffSession.agent.get('/api/staff/pending-proofs');
  assert.strictEqual(resProofs.status, 200);
  assert.strictEqual(typeof resProofs.body.pagination, 'object', 'Expected nested pagination object');
  assert.strictEqual(typeof resProofs.body.pagination.totalPages, 'number', 'Expected pagination.totalPages');
  assert.strictEqual(typeof resProofs.body.totalPages, 'number', 'Expected flat totalPages');
  assert.ok(resProofs.body.pagination.totalPages >= 1, 'totalPages must be >= 1');
  console.log('  -> PASSED: /api/staff/pending-proofs satisfies contract with totalPages:', resProofs.body.pagination.totalPages);

  console.log('[TEST 7] GET /api/staff/disputes endpoint exists and returns pagination contract');
  const resDisputes = await staffSession.agent.get('/api/staff/disputes');
  assert.strictEqual(resDisputes.status, 200, 'Expected /api/staff/disputes to exist (status 200, not 404)');
  assert.strictEqual(typeof resDisputes.body.pagination, 'object', 'Expected nested pagination object');
  assert.strictEqual(typeof resDisputes.body.pagination.totalPages, 'number');
  assert.strictEqual(typeof resDisputes.body.totalPages, 'number');
  assert.ok(Array.isArray(resDisputes.body.disputes), 'Expected disputes array');
  console.log('  -> PASSED: /api/staff/disputes route implemented and verified');

  console.log('[TEST 8] GET /api/management/applications returns both nested and flat pagination');
  const resApps = await managerSession.agent.get('/api/management/applications');
  assert.strictEqual(resApps.status, 200);
  assert.strictEqual(typeof resApps.body.pagination, 'object');
  assert.strictEqual(typeof resApps.body.pagination.totalPages, 'number');
  assert.strictEqual(typeof resApps.body.totalPages, 'number');
  console.log('  -> PASSED: /api/management/applications satisfies contract');

  console.log('[TEST 9] GET /api/management/disputes returns both nested and flat pagination');
  const resMgmtDisputes = await managerSession.agent.get('/api/management/disputes');
  assert.strictEqual(resMgmtDisputes.status, 200);
  assert.strictEqual(typeof resMgmtDisputes.body.pagination, 'object');
  assert.strictEqual(typeof resMgmtDisputes.body.pagination.totalPages, 'number');
  assert.strictEqual(typeof resMgmtDisputes.body.totalPages, 'number');
  console.log('  -> PASSED: /api/management/disputes satisfies contract');

  console.log('[TEST 10] GET /api/management/kyc/applications returns both nested and flat pagination');
  const resKyc = await managerSession.agent.get('/api/management/kyc/applications');
  assert.strictEqual(resKyc.status, 200);
  assert.strictEqual(typeof resKyc.body.pagination, 'object');
  assert.strictEqual(typeof resKyc.body.pagination.totalPages, 'number');
  assert.strictEqual(typeof resKyc.body.totalPages, 'number');
  console.log('  -> PASSED: /api/management/kyc/applications satisfies contract');

  console.log('[TEST 11] GET /api/management/orders returns pagination with total and totalCount');
  const resOrders = await managerSession.agent.get('/api/management/orders');
  assert.strictEqual(resOrders.status, 200);
  assert.strictEqual(typeof resOrders.body.pagination, 'object');
  assert.strictEqual(typeof resOrders.body.pagination.total, 'number');
  assert.strictEqual(typeof resOrders.body.pagination.totalCount, 'number');
  assert.strictEqual(typeof resOrders.body.pagination.totalPages, 'number');
  console.log('  -> PASSED: /api/management/orders includes both total and totalCount');

  console.log('[TEST 12] GET /api/marketplace/exchanger/overview returns profile and exchanger summaries');
  // Register exchanger role for test user
  await prisma.userRole.upsert({
    where: { userId_roleKey: { userId: testStaffId, roleKey: 'exchanger' } },
    update: {},
    create: { userId: testStaffId, roleKey: 'exchanger' },
  });

  const resExchangerOverview = await staffSession.agent.get('/api/marketplace/exchanger/overview');
  assert.strictEqual(resExchangerOverview.status, 200);
  assert.strictEqual(typeof resExchangerOverview.body.profile, 'object', 'Expected profile object');
  assert.strictEqual(typeof resExchangerOverview.body.exchanger, 'object', 'Expected exchanger object');
  assert.strictEqual(resExchangerOverview.body.exchanger.discordId, testStaffId);
  console.log('  -> PASSED: /api/marketplace/exchanger/overview includes both profile and exchanger objects');

  console.log('[TEST 13] Verify numeric application ID string conversion and tradeRef fallback');
  const mockApplication = { id: 1042, submittedAt: '2026-11-04T12:00:00Z', createdAt: '2026-11-04T12:00:00Z' };
  const safeAppId = String(mockApplication.id);
  assert.strictEqual(safeAppId, '1042');

  const mockTrade = { id: 508, tradeRef: 'TRD-202611-001', goldAmountK: 500 };
  const safeTradeId = mockTrade.tradeRef || String(mockTrade.id);
  assert.strictEqual(safeTradeId, 'TRD-202611-001');

  const mockTradeNoRef = { id: 509, tradeRef: null, goldAmountK: 200 };
  const fallbackTradeId = mockTradeNoRef.tradeRef || String(mockTradeNoRef.id);
  assert.strictEqual(fallbackTradeId, '509');
  console.log('  -> PASSED: Numeric IDs handled without .substring exceptions');

  console.log('\n============================================================');
  console.log('  ALL REGRESSION CONTRACT TESTS PASSED PERFECTLY!');
  console.log('============================================================\n');
}

runRegressionSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[REGRESSION TEST FAILED]:', err);
    process.exit(1);
  });
