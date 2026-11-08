/**
 * src/test/owner_gate_suite.ts — مجموعه تست‌های خودکار دروازه امن ورود مالک (/OwnerGate)
 * 
 * آزمون‌های ۱۲‌گانه الزامی:
 *  1. Missing Owner configuration (فقدان یا ضعف کلید در محیط منجر به 401 و Fail-Closed می‌شود)
 *  2. Missing key (ارسال درخواست فاقد کلید یا ارسال در Query String منجر به رد امن می‌شود)
 *  3. Incorrect key (کلید نادرست به صورت زمان‌ثابت مقایسه و با 401 رد می‌شود)
 *  4. Correct key (کلید صحیح منجر به احراز موفق و پاسخ مجاز می‌گردد)
 *  5. Rate limiting (تکرار ۵ تلاش ناموفق منجر به مسدودی با کد 429 و هدر Retry-After می‌شود)
 *  6. Session regeneration (شناسه سشن پس از ورود بازتولید شده و از تثبیت نشست جلوگیری می‌شود)
 *  7. Unauthorized access (درخواست‌های فاقد نشست به اندپوینت‌های محافظت‌شده رد می‌شوند)
 *  8. CSRF rejection (درخواست فاقد یا با توکن نامعتبر CSRF با 403 رد می‌شود)
 *  9. Logout (خروج از حساب، سشن را منهدم و دسترسی را لغو می‌کند)
 * 10. Owner RBAC (کاربر لاگین‌شده از طریق OwnerGate تمامی مجوزهای مالک را بر اساس RBAC دریافت می‌کند)
 * 11. Key rotation (با تغییر متغیر محیطی، کلید قبلی بلافاصله نامعتبر و کلید جدید فعال می‌شود)
 * 12. No production test-auth bypass (مسیر /auth/staging-login به طور قطعی مسدود یا ۴۰۴ است)
 */

import request from 'supertest';
import { app, sessionStore } from '../web/server';
import prisma from '../database/db';
import {
  OWNER_KEY_ENV_NAME,
  OWNER_KEY_FALLBACK_ENV,
  ownerGateRateLimiter,
  validateOwnerAccessKeyConfig,
} from '../web/ownerGate';

async function runOwnerGateTests() {
  console.log('=== STARTING SECURE OWNERGATE AUTHENTICATION TEST SUITE ===\n');

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

  // کلیدهای آزمایشی با انتروپی بالا (طول ۶۴ کاراکتر هگز)
  const TEST_VALID_OWNER_KEY_1 = '4f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a';
  const TEST_VALID_OWNER_KEY_2 = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
  const TEST_WRONG_KEY = '9999999999999999999999999999999999999999999999999999999999999999';

  // ذخیره مقادیر قبلی متغیرهای محیطی جهت بازگردانی در پایان تست
  const originalEnvKey = process.env[OWNER_KEY_ENV_NAME];
  const originalFallbackKey = process.env[OWNER_KEY_FALLBACK_ENV];

  try {
    // ─── اطمینان از وجود مالک ثبت‌شده در دیتابیس ────────────────────────────
    const registeredOwner = await prisma.userRole.findFirst({
      where: { roleKey: 'owner' },
      include: { user: true },
    });
    if (!registeredOwner || !registeredOwner.user) {
      throw new Error('Database prerequisite failed: No established owner found in database.');
    }
    const ownerDiscordId = registeredOwner.userId;

    // ─── تست ۱: Missing Owner Configuration & Weak Key Rejection ──────────
    // حذف موقت کلید از محیط
    delete process.env[OWNER_KEY_ENV_NAME];
    delete process.env[OWNER_KEY_FALLBACK_ENV];
    ownerGateRateLimiter.reset();

    const agent1 = request.agent(app);
    const getRes1 = await agent1.get('/OwnerGate');
    const csrfMatch1 = getRes1.text.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrfToken1 = csrfMatch1 ? csrfMatch1[1] : '';

    const res1MissingConfig = await agent1
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken1)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    // تست کلید ضعیف و پلیس‌هولدر
    process.env[OWNER_KEY_ENV_NAME] = 'your_owner_access_key_here_placeholder';
    const res1WeakKey = await agent1
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken1)
      .send({ accessKey: 'your_owner_access_key_here_placeholder' });

    assert(
      res1MissingConfig.status === 401 &&
        res1WeakKey.status === 401 &&
        validateOwnerAccessKeyConfig(undefined).valid === false &&
        validateOwnerAccessKeyConfig('short_key').valid === false &&
        validateOwnerAccessKeyConfig('your_owner_access_key_here_1234567890').valid === false,
      '1. Missing or weak Owner Access Key configuration fails closed with 401 Unauthorized',
      `Got statuses: missing=${res1MissingConfig.status}, weak=${res1WeakKey.status}`
    );

    // تنظیم کلید آزمایشی معتبر اول
    process.env[OWNER_KEY_ENV_NAME] = TEST_VALID_OWNER_KEY_1;
    ownerGateRateLimiter.reset();

    // ─── تست ۲: Missing Key & Query Parameter Leak Prevention ──────────────
    const agent2 = request.agent(app);
    const getRes2 = await agent2.get('/OwnerGate');
    const csrfToken2 = getRes2.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    // ارسال بدنه بدون کلید
    const res2EmptyBody = await agent2
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken2)
      .send({});

    // تلاش برای ارسال کلید در query string (باید قویاً ریجکت شود تا در لاگ و History ذخیره نشود)
    const res2QueryLeak = await agent2
      .post(`/OwnerGate?accessKey=${TEST_VALID_OWNER_KEY_1}`)
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken2)
      .send({});

    assert(
      res2EmptyBody.status === 401 &&
        res2QueryLeak.status === 400 &&
        res2QueryLeak.body.message.includes('request body'),
      '2. Missing key is rejected with 401 and query-string key leak attempt is strictly blocked with 400',
      `Empty status: ${res2EmptyBody.status}, Query status: ${res2QueryLeak.status}`
    );

    ownerGateRateLimiter.reset();

    // ─── تست ۳: Incorrect Key Verification (Timing-Safe Rejection) ──────────
    const agent3 = request.agent(app);
    const getRes3 = await agent3.get('/OwnerGate');
    const csrfToken3 = getRes3.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    const res3Incorrect = await agent3
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken3)
      .send({ accessKey: TEST_WRONG_KEY });

    assert(
      res3Incorrect.status === 401 &&
        res3Incorrect.body.message.includes('Invalid credentials'),
      '3. Incorrect Owner Access Key is rejected with generic 401 Unauthorized',
      `Status: ${res3Incorrect.status}, Message: ${res3Incorrect.body.message}`
    );

    ownerGateRateLimiter.reset();

    // ─── تست ۴: Correct Key Authentication (Success) ───────────────────────
    const agent4 = request.agent(app);
    const getRes4 = await agent4.get('/OwnerGate');
    const csrfToken4 = getRes4.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    const res4Correct = await agent4
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken4)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    assert(
      res4Correct.status === 200 &&
        res4Correct.body.success === true &&
        res4Correct.body.redirectUrl === '/?tab=admin',
      '4. Correct Owner Access Key authenticates successfully with dashboard redirect instruction',
      `Status: ${res4Correct.status}, Body: ${JSON.stringify(res4Correct.body)}`
    );

    // ─── تست ۵: Rate Limiting Enforcement (Max 5 Attempts) ────────────────
    ownerGateRateLimiter.reset();
    const agent5 = request.agent(app);
    const getRes5 = await agent5.get('/OwnerGate');
    const csrfToken5 = getRes5.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    // انجام ۵ بار تلاش ناموفق متوالی
    for (let i = 1; i <= 5; i++) {
      await agent5
        .post('/OwnerGate')
        .set('Accept', 'application/json')
        .set('x-csrf-token', csrfToken5)
        .send({ accessKey: `wrong_attempt_${i}_` + TEST_WRONG_KEY });
    }

    // تلاش ششم باید مسدود شود (429 Too Many Requests)
    const res5Blocked = await agent5
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken5)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 }); // حتی با کلید صحیح پس از لیمیت باید مسدود بماند

    assert(
      res5Blocked.status === 429 &&
        Boolean(res5Blocked.headers['retry-after']) &&
        res5Blocked.body.error === 'Too Many Requests',
      '5. Exceeding 5 failed authentication attempts enforces HTTP 429 Rate Limiting with Retry-After',
      `Status: ${res5Blocked.status}, Retry-After: ${res5Blocked.headers['retry-after']}`
    );

    ownerGateRateLimiter.reset();

    // ─── تست ۶: Session Regeneration (Session Fixation Prevention) ────────
    const agent6 = request.agent(app);
    const getRes6 = await agent6.get('/OwnerGate');
    const initialCookie = getRes6.headers['set-cookie']?.[0] || '';
    const initialSid = initialCookie.split(';')[0];
    const csrfToken6 = getRes6.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    const res6Login = await agent6
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken6)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    const postLoginCookie = res6Login.headers['set-cookie']?.[0] || '';
    const postLoginSid = postLoginCookie.split(';')[0];

    assert(
      res6Login.status === 200 &&
        initialSid.length > 0 &&
        postLoginSid.length > 0 &&
        initialSid !== postLoginSid,
      '6. Session ID is regenerated on successful login to prevent Session Fixation',
      `Before: ${initialSid.slice(0, 20)}..., After: ${postLoginSid.slice(0, 20)}...`
    );

    // ─── تست ۷: Unauthorized Access to Protected Routes ───────────────────
    const unauthAgent = request.agent(app);
    const res7Me = await unauthAgent.get('/api/me');
    const res7Admin = await unauthAgent.get('/api/admin/applications');

    assert(
      res7Me.status === 401 && res7Admin.status === 401,
      '7. Protected endpoints strictly reject unauthenticated requests with 401 Unauthorized',
      `Me: ${res7Me.status}, Admin: ${res7Admin.status}`
    );

    // ─── تست ۸: CSRF Protection Rejection ─────────────────────────────────
    const agent8 = request.agent(app);
    await agent8.get('/OwnerGate');

    // ارسال بدون توکن CSRF
    const res8NoCsrf = await agent8
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    // ارسال با توکن جعلی CSRF
    const res8FakeCsrf = await agent8
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', 'malicious_forged_csrf_token_12345678')
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    assert(
      res8NoCsrf.status === 403 &&
        res8FakeCsrf.status === 403 &&
        res8NoCsrf.body.error === 'Forbidden',
      '8. Missing or mismatched CSRF token is rejected with 403 Forbidden',
      `NoCsrf: ${res8NoCsrf.status}, FakeCsrf: ${res8FakeCsrf.status}`
    );

    // ─── تست ۹: Logout & Session Invalidation ──────────────────────────────
    const agent9 = request.agent(app);
    const getRes9 = await agent9.get('/OwnerGate');
    const csrfToken9 = getRes9.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    // ورود موفق
    await agent9
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken9)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    // بررسی برقراری دسترسی به /api/me
    const res9BeforeLogout = await agent9.get('/api/me');

    // دریافت توکن جدید CSRF پس از بازتولید سشن
    const csrfToken9AfterLogin = (await agent9.get('/csrf-token')).body.csrfToken;

    // لاگ‌اوت امن
    const res9Logout = await agent9
      .post('/auth/logout')
      .set('x-csrf-token', csrfToken9AfterLogin);

    // بررسی قطع دسترسی
    const res9AfterLogout = await agent9.get('/api/me');

    assert(
      res9BeforeLogout.status === 200 &&
        res9Logout.status === 200 &&
        res9AfterLogout.status === 401,
      '9. Logout terminates session, clears authentication cookie, and renders subsequent requests 401',
      `Before: ${res9BeforeLogout.status}, Logout: ${res9Logout.status}, After: ${res9AfterLogout.status}`
    );

    // ─── تست ۱۰: Server-Side Owner RBAC Verification ───────────────────────
    const agent10 = request.agent(app);
    const getRes10 = await agent10.get('/OwnerGate');
    const csrfToken10 = getRes10.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    await agent10
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken10)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    const res10Me = await agent10.get('/api/me');
    const res10AdminHub = await agent10.get('/api/admin/applications');

    assert(
      res10Me.status === 200 &&
        res10Me.body.discordId === ownerDiscordId &&
        res10Me.body.roles.includes('owner') &&
        res10AdminHub.status === 200,
      '10. OwnerGate session is bound to database Owner identity and retains full RBAC permissions on admin routes',
      `Discord ID: ${res10Me.body?.discordId}, Admin Hub Status: ${res10AdminHub.status}`
    );

    // ─── تست ۱۱: Secret Key Rotation & Revocation ──────────────────────────
    // چرخش کلید به TEST_VALID_OWNER_KEY_2
    process.env[OWNER_KEY_ENV_NAME] = TEST_VALID_OWNER_KEY_2;
    ownerGateRateLimiter.reset();

    const agent11 = request.agent(app);
    const getRes11 = await agent11.get('/OwnerGate');
    const csrfToken11 = getRes11.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';

    // تلاش با کلید قدیمی (TEST_VALID_OWNER_KEY_1) باید بلافاصله رد شود
    const res11OldKey = await agent11
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken11)
      .send({ accessKey: TEST_VALID_OWNER_KEY_1 });

    // تلاش با کلید جدید (TEST_VALID_OWNER_KEY_2) باید بلافاصله موفق شود
    const res11NewKey = await agent11
      .post('/OwnerGate')
      .set('Accept', 'application/json')
      .set('x-csrf-token', csrfToken11)
      .send({ accessKey: TEST_VALID_OWNER_KEY_2 });

    assert(
      res11OldKey.status === 401 && res11NewKey.status === 200,
      '11. Rotating environment Owner Access Key takes effect immediately, invalidating old key',
      `OldKey Status: ${res11OldKey.status}, NewKey Status: ${res11NewKey.status}`
    );

    // ─── تست ۱۲: No Production Test-Auth Bypass ────────────────────────────
    const res12StagingLogin = await request(app).get('/auth/staging-login');
    const res12PostStaging = await request(app).post('/auth/staging-login').send({});

    assert(
      (res12StagingLogin.status === 404 || res12StagingLogin.status === 403 || res12StagingLogin.status === 200 && res12StagingLogin.text.includes('<!DOCTYPE html>')) &&
        (res12PostStaging.status === 404 || res12PostStaging.status === 403),
      '12. Insecure /auth/staging-login remains completely disabled and uncallable in production routes',
      `GET: ${res12StagingLogin.status}, POST: ${res12PostStaging.status}`
    );

  } catch (err: any) {
    console.error('Fatal test error in OwnerGate suite:', err);
    failed++;
  } finally {
    // ─── بازگردانی تنظیمات محیطی ──────────────────────────────────────────
    if (originalEnvKey !== undefined) {
      process.env[OWNER_KEY_ENV_NAME] = originalEnvKey;
    } else {
      delete process.env[OWNER_KEY_ENV_NAME];
    }

    if (originalFallbackKey !== undefined) {
      process.env[OWNER_KEY_FALLBACK_ENV] = originalFallbackKey;
    } else {
      delete process.env[OWNER_KEY_FALLBACK_ENV];
    }

    ownerGateRateLimiter.reset();
    sessionStore.stopCleanup();
    await prisma.$disconnect();

    console.log(`\n=== OWNERGATE TEST RESULTS: ${passed} PASSED / ${failed} FAILED ===\n`);
    if (failed > 0) {
      process.exit(1);
    }
  }
}

if (require.main === module) {
  runOwnerGateTests().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { runOwnerGateTests };
