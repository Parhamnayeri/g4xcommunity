/**
 * security_auth_suite.ts — مجموعه تست‌های خودکار امنیت وب و احراز هویت (Phase 2.6.1)
 *
 * ۱۲ آزمون الزامی:
 *  1. درخواست فقط با x-discord-id بدون نشست منجر به 401 می‌شود.
 *  2. درخواست به والت خصوصی بدون نشست معتبر منجر به 401 می‌شود.
 *  3. نشست معتبر به والت خود دسترسی دارد.
 *  4. کاربر نمی‌تواند با تزریق شناسه دیگر به اطلاعات والت کاربر دیگر دسترسی یابد.
 *  5. پارامتر state نامعتبر در OAuth ریجکت می‌شود (403).
 *  6. پارامتر state مفقود در OAuth ریجکت می‌شود (403).
 *  7. پارامتر state منقضی‌شده ریجکت می‌شود (403).
 *  8. کوکی نشست دارای فلگ‌های امنیتی HttpOnly و SameSite=Lax است.
 *  9. لاگ‌اوت منجر به باطل شدن قطعی نشست و 401 شدن درخواست‌های بعدی می‌شود.
 * 10. عدم وجود رول مجاز برای روت مدیریتی منجر به 403 می‌شود.
 * 11. تلاش‌های CSRF بر روی روت تغییردهنده داده بلاک می‌شوند (403).
 * 12. ریدایرکت کال‌بک OAuth هیچ توکن یا شناسه‌ای را در URL افشا نمی‌کند.
 */

import request from 'supertest';
import axios from 'axios';
import { app, sessionStore } from '../web/server';
import prisma from '../database/db';

// Helper to sign session cookie matching express-session format
function formatSessionCookie(sid: string): string {
  // express-session creates cookie: name=s%3A<sid>.<signature>
  // However, we can also simulate the full flow via supertest agent!
  return sid;
}

async function runSecurityTests() {
  console.log('=== STARTING PHASE 2.6.1 AUTOMATED SECURITY TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // ─── آماده‌سازی داده‌های تست ──────────────────────────────────────────
    const userA = await prisma.user.upsert({
      where: { discordId: 'test_sec_user_a' },
      update: { isActive: true },
      create: {
        discordId: 'test_sec_user_a',
        username: 'SecUserA',
        displayName: 'Security User A',
      },
    });

    const userB = await prisma.user.upsert({
      where: { discordId: 'test_sec_user_b' },
      update: { isActive: true },
      create: {
        discordId: 'test_sec_user_b',
        username: 'SecUserB',
        displayName: 'Security User B',
      },
    });

    await prisma.wallet.upsert({
      where: { userId: userA.discordId },
      update: { balanceUsd: 2500 },
      create: { userId: userA.discordId, balanceUsd: 2500 },
    });

    await prisma.wallet.upsert({
      where: { userId: userB.discordId },
      update: { balanceUsd: 9999 },
      create: { userId: userB.discordId, balanceUsd: 9999 },
    });

    // ─── TEST 1: Request with only x-discord-id returns 401 ──────────────
    const res1 = await request(app)
      .get('/api/me')
      .set('x-discord-id', userA.discordId);
    assert(
      res1.status === 401 && res1.body.error === 'Unauthorized',
      '1. Request with only x-discord-id header returns 401 Unauthorized',
      `Got status ${res1.status}`,
    );

    // ─── TEST 2: Private wallet API without valid session returns 401 ────
    const res2 = await request(app).get('/api/wallet');
    assert(
      res2.status === 401 && res2.body.error === 'Unauthorized',
      '2. Private wallet API without a valid session returns 401',
      `Got status ${res2.status}`,
    );

    // ─── TEST 3: A valid session can access its own wallet ────────────────
    const agentA = request.agent(app);
    // Initialize session for agentA
    const initResA = await agentA.get('/api/csrf-token');
    // Inject userId into agentA's session via store
    const cookieHeaderA = initResA.header['set-cookie'];
    const rawCookieA = cookieHeaderA ? cookieHeaderA[0] : '';
    const matchA = rawCookieA.match(/g4x\.sid=s%3A([^.]+)\./);
    const sidA = matchA ? matchA[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(sidA, (err, sess) => {
        if (err || !sess) return reject(err || new Error('No session'));
        sess.userId = userA.discordId;
        sessionStore.set(sidA, sess, (setErr) => {
          if (setErr) return reject(setErr);
          resolve();
        });
      });
    });

    const res3 = await agentA.get('/api/wallet');
    assert(
      res3.status === 200 && res3.body.userId === userA.discordId && res3.body.balanceUsd === 2500,
      '3. A valid session can access its own wallet',
      `Status: ${res3.status}, data: ${JSON.stringify(res3.body)}`,
    );

    // ─── TEST 4: User cannot retrieve another user's private info ────────
    const res4 = await agentA
      .get('/api/wallet')
      .query({ userId: userB.discordId })
      .set('x-discord-id', userB.discordId);
    assert(
      res4.status === 200 &&
        res4.body.userId === userA.discordId &&
        res4.body.balanceUsd === 2500 &&
        res4.body.balanceUsd !== 9999,
      "4. User cannot retrieve another user's private information via query or header injection",
      `Got: ${JSON.stringify(res4.body)}`,
    );

    // ─── TEST 5: Invalid OAuth state is rejected ──────────────────────────
    const agentOAuth = request.agent(app);
    // Start OAuth to set state in session
    await agentOAuth.get('/auth/discord');
    const res5 = await agentOAuth
      .get('/auth/callback')
      .query({ code: 'mock_auth_code', state: 'invalid_malicious_state' });
    assert(
      res5.status === 403 && res5.body.error === 'Invalid or mismatched OAuth state',
      '5. Invalid OAuth state is rejected with 403 Forbidden',
      `Status: ${res5.status}, body: ${JSON.stringify(res5.body)}`,
    );

    // ─── TEST 6: Missing OAuth state is rejected ──────────────────────────
    const res6 = await agentOAuth
      .get('/auth/callback')
      .query({ code: 'mock_auth_code' });
    assert(
      res6.status === 403 && res6.body.error.includes('Missing OAuth state'),
      '6. Missing OAuth state is rejected with 403 Forbidden',
      `Status: ${res6.status}`,
    );

    // ─── TEST 7: Expired OAuth state is rejected ──────────────────────────
    const agentExpired = request.agent(app);
    const resInitExp = await agentExpired.get('/auth/discord');
    const cookieHeaderExp = resInitExp.header['set-cookie'];
    const matchExp = cookieHeaderExp && cookieHeaderExp[0].match(/g4x\.sid=s%3A([^.]+)\./);
    const sidExp = matchExp ? matchExp[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(sidExp, (err, sess) => {
        if (err || !sess) return reject(err);
        sess.oauthState = 'state_expired_test';
        sess.oauthStateExpires = Date.now() - 5000; // Expired 5 seconds ago
        sessionStore.set(sidExp, sess, () => resolve());
      });
    });

    const res7 = await agentExpired
      .get('/auth/callback')
      .query({ code: 'mock_code', state: 'state_expired_test' });
    assert(
      res7.status === 403 && res7.body.error.includes('expired'),
      '7. Expired OAuth state is rejected with 403 Forbidden',
      `Status: ${res7.status}, body: ${JSON.stringify(res7.body)}`,
    );

    // ─── TEST 8: Session cookies use appropriate security flags ──────────
    const res8 = await request(app).get('/auth/discord');
    const cookieHeader8 = res8.header['set-cookie'] ? res8.header['set-cookie'][0] : '';
    assert(
      cookieHeader8.includes('g4x.sid=') &&
        cookieHeader8.toLowerCase().includes('httponly') &&
        cookieHeader8.toLowerCase().includes('samesite=lax'),
      '8. Session cookies use appropriate security flags (g4x.sid, HttpOnly, SameSite=Lax)',
      `Cookie header: ${cookieHeader8}`,
    );

    // ─── TEST 9: Logout invalidates the session ───────────────────────────
    const csrfResA = await agentA.get('/api/csrf-token');
    const csrfTokenA = csrfResA.body.csrfToken;

    const resLogout = await agentA
      .post('/auth/logout')
      .set('x-csrf-token', csrfTokenA);
    assert(
      resLogout.status === 200 && resLogout.body.success === true,
      '9a. Logout endpoint executes successfully with CSRF token',
      `Status: ${resLogout.status}`,
    );

    const resAfterLogout = await agentA.get('/api/me');
    assert(
      resAfterLogout.status === 401,
      '9b. Session is completely invalidated after logout (subsequent request returns 401)',
      `Status: ${resAfterLogout.status}`,
    );

    // ─── TEST 10: Unauthorized role access returns 403 ────────────────────
    const agentRole = request.agent(app);
    const resRoleInit = await agentRole.get('/api/csrf-token');
    const matchRole = resRoleInit.header['set-cookie'] && resRoleInit.header['set-cookie'][0].match(/g4x\.sid=s%3A([^.]+)\./);
    const sidRole = matchRole ? matchRole[1] : '';

    await new Promise<void>((resolve, reject) => {
      sessionStore.get(sidRole, (err, sess) => {
        if (err || !sess) return reject(err);
        sess.userId = userA.discordId;
        sessionStore.set(sidRole, sess, () => resolve());
      });
    });

    // Remove any admin roles for userA first
    await prisma.userRole.deleteMany({ where: { userId: userA.discordId } });

    const resRoleDenied = await agentRole.get('/api/admin/overview');
    assert(
      resRoleDenied.status === 403 && (resRoleDenied.body.error === 'Forbidden' || resRoleDenied.body.error === 'ADMIN_ACCESS_DENIED'),
      '10a. Unauthorized role access to admin route returns 403 Forbidden',
      `Status: ${resRoleDenied.status}`,
    );

    // Now grant admin role to userA
    await prisma.userRole.create({
      data: { userId: userA.discordId, roleKey: 'admin' },
    });
    const resRoleGranted = await agentRole.get('/api/admin/overview');
    assert(
      resRoleGranted.status === 200 && (typeof resRoleGranted.body.totalUsers === 'number' || typeof resRoleGranted.body.kpis?.totalUsers === 'number'),
      '10b. Authorized role access returns 200 OK with data',
      `Status: ${resRoleGranted.status}`,
    );

    // ─── TEST 11: CSRF attempts against state-changing routes blocked ─────
    // Attempt state-changing POST without CSRF token
    const resCsrfMissing = await agentRole
      .post('/api/characters/sync-request')
      .send({ characterId: 999 });
    assert(
      resCsrfMissing.status === 403 && resCsrfMissing.body.message.includes('CSRF'),
      '11a. State-changing POST without CSRF token is blocked with 403',
      `Status: ${resCsrfMissing.status}`,
    );

    // Attempt with invalid CSRF token
    const resCsrfInvalid = await agentRole
      .post('/api/characters/sync-request')
      .set('x-csrf-token', 'malicious_forged_csrf_token')
      .send({ characterId: 999 });
    assert(
      resCsrfInvalid.status === 403 && resCsrfInvalid.body.message.includes('CSRF'),
      '11b. State-changing POST with invalid CSRF token is blocked with 403',
      `Status: ${resCsrfInvalid.status}`,
    );

    // Attempt with cross-origin attacker header
    const roleCsrfRes = await agentRole.get('/api/csrf-token');
    const validCsrf = roleCsrfRes.body.csrfToken;
    const resCsrfOrigin = await agentRole
      .post('/api/characters/sync-request')
      .set('x-csrf-token', validCsrf)
      .set('Origin', 'https://malicious-phishing-site.xyz')
      .send({ characterId: 999 });
    assert(
      resCsrfOrigin.status === 403,
      '11c. State-changing POST from malicious cross-origin is blocked with 403',
      `Status: ${resCsrfOrigin.status}`,
    );

    // ─── TEST 12: OAuth callback does not expose secrets in URL ──────────
    // Mock Axios post and get for Discord OAuth
    const originalPost = axios.post;
    const originalGet = axios.get;

    axios.post = (async (url: string, ...args: any[]) => {
      if (url.includes('/oauth2/token')) {
        return { data: { access_token: 'mock_discord_access_token_123' } };
      }
      return originalPost(url, ...args);
    }) as any;

    axios.get = (async (url: string, ...args: any[]) => {
      if (url.includes('/users/@me')) {
        return {
          data: {
            id: 'test_oauth_user_verified',
            username: 'VerifiedOAuthUser',
            global_name: 'Verified User',
          },
        };
      }
      return originalGet(url, ...args);
    }) as any;

    try {
      const agentCallback = request.agent(app);
      const resInitCb = await agentCallback.get('/auth/discord');
      const locationUrl = new URL(resInitCb.header.location, 'https://discord.com');
      const generatedState = locationUrl.searchParams.get('state')!;

      const resCb = await agentCallback
        .get('/auth/callback')
        .query({ code: 'valid_mock_code', state: generatedState });

      const redirectLocation = resCb.header.location;
      assert(
        resCb.status === 302 &&
          redirectLocation === '/' &&
          !redirectLocation.includes('auth=') &&
          !redirectLocation.includes('token') &&
          !redirectLocation.includes('test_oauth_user_verified'),
        '12. OAuth callback redirects cleanly to / without exposing tokens or user IDs in URL',
        `Redirect location: ${redirectLocation}`,
      );

      // Verify that agentCallback is now authenticated as the verified OAuth user
      const resMeAfterCb = await agentCallback.get('/api/me');
      assert(
        resMeAfterCb.status === 200 &&
          resMeAfterCb.body.discordId === 'test_oauth_user_verified',
        '12b. Session established safely and bound to verified Discord identity',
        `Authenticated as: ${resMeAfterCb.body.discordId}`,
      );
    } finally {
      // Restore axios
      axios.post = originalPost;
      axios.get = originalGet;
    }

    // ─── CLEANUP ──────────────────────────────────────────────────────────
    console.log('\n[CLEANUP] Cleaning up test records...');
    await prisma.userRole.deleteMany({ where: { userId: userA.discordId } });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [userA.discordId, userB.discordId, 'test_oauth_user_verified'] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [userA.discordId, userB.discordId, 'test_oauth_user_verified'] } },
    });

    console.log(`\n=== RESULTS: ${passed} PASSED / ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('TEST SUITE EXCEPTION:', error);
    process.exit(1);
  } finally {
    sessionStore.stopCleanup();
    await prisma.$disconnect();
  }
}

runSecurityTests();
