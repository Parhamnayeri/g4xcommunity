/**
 * src/web/ownerGate.ts — دروازه ورود امن و اختصاصی مالک پلتفرم (Secure OwnerGate Authentication)
 * 
 * ویژگی‌ها:
 *  - احراز هویت اختصاصی مالک از طریق Owner Access Key با انتروپی بالا
 *  - ارزیابی Timing-Safe و بدون افشای کلید در حافظه یا لاگ‌ها
 *  - Fail-Closed در صورت فقدان کلید، ضعف انتروپی، یا نبود مالک یکتا در دیتابیس
 *  - عدم ایجاد یا ارتقای خودکار کاربر؛ استخراج صرف هویت مالک از پایگاه داده
 *  - بازتولید شناسه سشن (Session Regeneration) و تنظیم کوکی‌های امن HttpOnly
 *  - محافظت در برابر CSRF و حملات Brute-force با محدودکننده نرخ (Rate Limiting)
 *  - ثبت وقایع در جدول AuditLog بدون افشای کلیدها
 */

import { Request, Response, Router, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../database/db';
import { User } from '@prisma/client';

export const OWNER_KEY_ENV_NAME = 'G4X_OWNER_ACCESS_KEY';
export const OWNER_KEY_FALLBACK_ENV = 'OWNER_ACCESS_KEY';

export const MIN_KEY_LENGTH = 32;
export const MIN_DISTINCT_CHARS = 10;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 دقیقه

const KNOWN_PLACEHOLDERS = [
  'your_owner_access_key_here',
  'your_key_here',
  'change_me',
  'placeholder',
  'default_key',
  'secret_key',
  'password',
  '12345678',
  'g4x_owner_key',
];

/**
 * اعتبارسنجی کیفیت و انتروپی کلید دسترسی مالک از متغیرهای محیطی
 */
export function validateOwnerAccessKeyConfig(key?: string): { valid: boolean; reason?: string } {
  if (!key || typeof key !== 'string') {
    return { valid: false, reason: 'MISSING_CONFIGURATION' };
  }

  const trimmed = key.trim();
  if (trimmed.length < MIN_KEY_LENGTH) {
    return { valid: false, reason: `INSUFFICIENT_LENGTH: Key must be at least ${MIN_KEY_LENGTH} characters` };
  }

  const lower = trimmed.toLowerCase();
  for (const ph of KNOWN_PLACEHOLDERS) {
    if (lower.includes(ph)) {
      return { valid: false, reason: 'PLACEHOLDER_KEY_DETECTED' };
    }
  }

  // بررسی تنوع کاراکترها (حداقل ۱۰ کاراکتر منحصربه‌فرد)
  const distinctChars = new Set(trimmed).size;
  if (distinctChars < MIN_DISTINCT_CHARS) {
    return { valid: false, reason: 'LOW_ENTROPY_KEY' };
  }

  return { valid: true };
}

/**
 * دریافت کلید فعال فعلی از محیط با اولویت G4X_OWNER_ACCESS_KEY
 */
export function getConfiguredOwnerAccessKey(): string | null {
  const primary = process.env[OWNER_KEY_ENV_NAME]?.trim();
  if (primary) return primary;
  const fallback = process.env[OWNER_KEY_FALLBACK_ENV]?.trim();
  if (fallback) return fallback;
  return null;
}

/**
 * مقایسه زمان‌ثابت (Timing-Safe) کلید ارائه‌شده با کلید پیکربندی‌شده
 */
export function verifyOwnerAccessKey(providedKey: string, configuredKey: string): boolean {
  if (!providedKey || !configuredKey) return false;

  try {
    const suppliedHash = crypto.createHash('sha256').update(providedKey, 'utf8').digest();
    const configuredHash = crypto.createHash('sha256').update(configuredKey, 'utf8').digest();
    return crypto.timingSafeEqual(suppliedHash, configuredHash);
  } catch {
    return false;
  }
}

/**
 * استخراج و احراز یکتایی هویت مالک ثبت‌شده از دیتابیس (Fail-Closed)
 */
export async function resolveDatabaseOwner(client = prisma): Promise<{
  owner: User | null;
  reason?: 'NO_ESTABLISHED_OWNER' | 'AMBIGUOUS_MULTIPLE_OWNERS';
}> {
  const ownerRoles = await client.userRole.findMany({
    where: { roleKey: 'owner' },
    include: { user: true },
  });

  // فیلتر صرفاً کاربران فعال با شناسه اسنوفلیک عددی دیسکورد (۱۷ الی ۲۰ رقم)
  const validOwners = ownerRoles.filter(
    (r) => r.user && r.user.isActive && /^\d{17,20}$/.test(r.userId)
  );

  if (validOwners.length === 0) {
    return { owner: null, reason: 'NO_ESTABLISHED_OWNER' };
  }

  if (validOwners.length > 1) {
    return { owner: null, reason: 'AMBIGUOUS_MULTIPLE_OWNERS' };
  }

  return { owner: validOwners[0].user };
}

/**
 * مدیریت محدودکننده نرخ ورود در حافظه (In-Memory IP Rate Limiter)
 */
interface RateLimitRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil?: number;
}

class OwnerGateRateLimiter {
  private attempts = new Map<string, RateLimitRecord>();

  public isLimited(ip: string, now = Date.now()): { limited: boolean; retryAfterSeconds: number } {
    const record = this.attempts.get(ip);
    if (!record) return { limited: false, retryAfterSeconds: 0 };

    if (record.lockedUntil && record.lockedUntil > now) {
      const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
      return { limited: true, retryAfterSeconds: Math.max(1, retryAfter) };
    }

    // پنجره منقضی شده است
    if (now - record.firstFailureAt > RATE_LIMIT_WINDOW_MS) {
      this.attempts.delete(ip);
      return { limited: false, retryAfterSeconds: 0 };
    }

    if (record.failures >= RATE_LIMIT_MAX_ATTEMPTS) {
      const lockDuration = RATE_LIMIT_WINDOW_MS - (now - record.firstFailureAt);
      record.lockedUntil = now + Math.max(1000, lockDuration);
      const retryAfter = Math.ceil(lockDuration / 1000);
      return { limited: true, retryAfterSeconds: Math.max(1, retryAfter) };
    }

    return { limited: false, retryAfterSeconds: 0 };
  }

  public recordFailure(ip: string, now = Date.now()): void {
    const record = this.attempts.get(ip);
    if (!record || now - record.firstFailureAt > RATE_LIMIT_WINDOW_MS) {
      this.attempts.set(ip, { failures: 1, firstFailureAt: now });
    } else {
      record.failures += 1;
      if (record.failures >= RATE_LIMIT_MAX_ATTEMPTS) {
        record.lockedUntil = now + RATE_LIMIT_WINDOW_MS;
      }
    }
  }

  public recordSuccess(ip: string): void {
    this.attempts.delete(ip);
  }

  public reset(): void {
    this.attempts.clear();
  }
}

export const ownerGateRateLimiter = new OwnerGateRateLimiter();

/**
 * ثبت امن وقایع ممیزی احراز هویت بدون افشای هرگونه کلید یا محتوای محرمانه
 */
async function recordAudit(
  actorId: string | null,
  isSuccess: boolean,
  reason: string,
  ip: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: isSuccess ? 'AUTH_OWNER_GATE_SUCCESS' : 'AUTH_OWNER_GATE_FAILED',
        entityType: 'OwnerGate',
        entityId: actorId ?? 'anonymous_owner_gate',
        reason,
        isSuccess,
        newValues: JSON.stringify({
          clientIp: ip.replace(/:/g, '_'),
          timestamp: new Date().toISOString(),
        }),
      },
    });
  } catch (err) {
    console.error('[OwnerGate] Failed to record audit log:', err);
  }
}

/**
 * گریزدهی امن رشته‌ها در خروجی HTML
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * رندر صفحه ورود تمیز و مینیمال انگلیسی برای GET /OwnerGate
 */
export function renderOwnerGateHtml(csrfToken: string, errorMessage?: string, successMessage?: string): string {
  const safeCsrf = escapeHtml(csrfToken);
  const errorBanner = errorMessage
    ? `<div class="banner banner-error" role="alert"><svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg><span>${escapeHtml(
        errorMessage
      )}</span></div>`
    : '';

  const successBanner = successMessage
    ? `<div class="banner banner-success" role="alert"><svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg><span>${escapeHtml(
        successMessage
      )}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Owner Access Gate — G4X Community</title>
  <meta name="robots" content="noindex, nofollow, noarchive">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #080C14;
      --card-bg: rgba(17, 24, 39, 0.85);
      --card-border: rgba(139, 92, 246, 0.25);
      --card-border-focus: rgba(139, 92, 246, 0.6);
      --text-main: #F3F4F6;
      --text-muted: #9CA3AF;
      --primary: #8B5CF6;
      --primary-hover: #7C3AED;
      --accent-red: #EF4444;
      --accent-green: #10B981;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-dark);
      background-image: radial-gradient(circle at 50% 20%, rgba(139, 92, 246, 0.12), transparent 45%),
                        radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.08), transparent 40%);
      color: var(--text-main);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .container {
      width: 100%;
      max-width: 460px;
    }

    .gate-card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 2.25rem 2rem;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 25px rgba(139, 92, 246, 0.1);
      transition: border-color 0.2s ease;
    }

    .gate-header {
      text-align: center;
      margin-bottom: 1.75rem;
    }

    .shield-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(16, 185, 129, 0.15));
      border: 1px solid rgba(139, 92, 246, 0.4);
      margin-bottom: 1rem;
      color: #A78BFA;
    }

    .shield-badge svg {
      width: 1.85rem;
      height: 1.85rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #FFFFFF;
      margin-bottom: 0.35rem;
    }

    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
      line-height: 1.35;
    }

    .banner-error {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #FCA5A5;
    }

    .banner-success {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
      color: #6EE7B7;
    }

    .banner svg {
      width: 1.15rem;
      height: 1.15rem;
      flex-shrink: 0;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .input-wrapper {
      position: relative;
    }

    input[type="password"],
    input[type="text"] {
      width: 100%;
      padding: 0.85rem 1rem;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(75, 85, 99, 0.6);
      border-radius: 0.5rem;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 0.95rem;
      outline: none;
      transition: all 0.15s ease;
    }

    input[type="password"]:focus,
    input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.25);
      background: rgba(15, 23, 42, 0.95);
    }

    .btn-submit {
      width: 100%;
      padding: 0.875rem 1.25rem;
      background: linear-gradient(135deg, var(--primary), #6D28D9);
      color: #FFFFFF;
      border: none;
      border-radius: 0.5rem;
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: transform 0.1s ease, filter 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);
    }

    .btn-submit:hover {
      filter: brightness(1.1);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
    }

    .btn-submit:active {
      transform: translateY(1px);
    }

    .footer-notice {
      margin-top: 1.5rem;
      text-align: center;
      font-size: 0.75rem;
      color: #6B7280;
      line-height: 1.45;
    }

    .footer-notice strong {
      color: #9CA3AF;
    }

    .discord-alt {
      margin-top: 1rem;
      text-align: center;
    }

    .discord-alt a {
      color: #A78BFA;
      text-decoration: none;
      font-size: 0.8125rem;
      font-weight: 500;
      transition: color 0.15s ease;
    }

    .discord-alt a:hover {
      color: #C4B5FD;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="gate-card">
      <div class="gate-header">
        <div class="shield-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M12 8v4"/>
            <path d="M12 16h.01"/>
          </svg>
        </div>
        <h1>G4X Community</h1>
        <p class="subtitle">Secure Owner Access Gate &bull; Restricted Entry</p>
      </div>

      ${errorBanner}
      ${successBanner}

      <form action="/OwnerGate" method="POST" id="ownerGateForm" autocomplete="off">
        <input type="hidden" name="_csrf" value="${safeCsrf}">
        <div class="form-group">
          <label for="accessKey">Owner Access Key</label>
          <div class="input-wrapper">
            <input
              type="password"
              id="accessKey"
              name="accessKey"
              required
              autofocus
              autocomplete="current-password"
              placeholder="Enter cryptographic secret..."
              spellcheck="false"
              autocapitalize="off"
              autocorrect="off"
            >
          </div>
        </div>
        <button type="submit" class="btn-submit" id="btnSubmit">
          <span>Authenticate &amp; Enter Dashboard</span>
          <svg style="width:1.1rem;height:1.1rem;" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </form>

      <div class="discord-alt">
        <a href="/auth/discord">&larr; Return to Standard Discord OAuth Login</a>
      </div>

      <div class="footer-notice">
        <strong>Strictly Authorized Personnel Only.</strong><br>
        All connection attempts are cryptographically verified and committed to the immutable audit ledger.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * هندلر متد GET برای مسیر /OwnerGate
 */
export async function handleGetOwnerGate(req: Request, res: Response): Promise<void> {
  // اگر کاربر قبلاً لاگین کرده و مالک است، مستقیماً به داشبورد هدایت شود
  if (req.session?.userId) {
    const existingUser = await prisma.user.findUnique({
      where: { discordId: req.session.userId },
      include: { userRoles: true },
    });
    if (existingUser && existingUser.isActive && existingUser.userRoles.some((r) => r.roleKey === 'owner')) {
      res.redirect('/?tab=admin');
      return;
    }
  }

  const csrfToken = req.session?.csrfToken || '';
  const errorQuery = req.query.error as string | undefined;

  let errorMessage: string | undefined;
  if (errorQuery === 'invalid') {
    errorMessage = 'Invalid credentials or authentication unavailable.';
  } else if (errorQuery === 'rate_limited') {
    errorMessage = 'Too many failed login attempts. Please try again later.';
  } else if (errorQuery === 'csrf') {
    errorMessage = 'Session expired or invalid security token. Please try again.';
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.send(renderOwnerGateHtml(csrfToken, errorMessage));
}

/**
 * هندلر متد POST برای مسیر /OwnerGate
 */
export async function handlePostOwnerGate(req: Request, res: Response): Promise<void> {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown_ip';
  const isJsonRequest =
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json');

  // ۱. بررسی عدم ارسال کلید در query string جهت ممانعت از افشا در لاگ و URL
  if (req.query.accessKey || req.query.key) {
    await recordAudit(null, false, 'KEY_TRANSMITTED_IN_QUERY_REJECTED', clientIp);
    res.status(400).json({
      error: 'Bad Request',
      message: 'Access Key must strictly be sent in request body',
    });
    return;
  }

  // ۲. کنترل محدودیت نرخ ورود (Rate Limiting)
  const rateLimitStatus = ownerGateRateLimiter.isLimited(clientIp);
  if (rateLimitStatus.limited) {
    res.setHeader('Retry-After', String(rateLimitStatus.retryAfterSeconds));
    await recordAudit(null, false, 'RATE_LIMITED', clientIp);
    if (isJsonRequest) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Too many failed login attempts. Please try again later.',
        retryAfter: rateLimitStatus.retryAfterSeconds,
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=rate_limited');
      return;
    }
  }

  // ۳. بررسی و تطابق توکن ضد CSRF
  const sessionCsrf = req.session?.csrfToken;
  const providedCsrf = (req.headers['x-csrf-token'] as string) || req.body?._csrf || req.body?.csrfToken;

  if (!sessionCsrf || !providedCsrf || sessionCsrf !== providedCsrf) {
    if (isJsonRequest) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid or missing CSRF token',
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=csrf');
      return;
    }
  }

  // ۴. دریافت کلید ورودی صرفاً از بدنه درخواست
  const providedKey = typeof req.body?.accessKey === 'string'
    ? req.body.accessKey.trim()
    : (typeof req.body?.key === 'string' ? req.body.key.trim() : '');

  if (!providedKey) {
    ownerGateRateLimiter.recordFailure(clientIp);
    await recordAudit(null, false, 'MISSING_KEY_PROVIDED', clientIp);
    if (isJsonRequest) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials or authentication unavailable.',
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=invalid');
      return;
    }
  }

  // ۵. اعتبارسنجی سرورساید کلید پیکربندی‌شده محیط
  const configuredKey = getConfiguredOwnerAccessKey();
  const configValidation = validateOwnerAccessKeyConfig(configuredKey ?? undefined);

  if (!configValidation.valid || !configuredKey) {
    // گارد Fail-Closed: در صورت فقدان یا ضعف کلید در تنظیمات، اجازه ورود داده نمی‌شود
    ownerGateRateLimiter.recordFailure(clientIp);
    await recordAudit(null, false, 'INVALID_OR_MISSING_SERVER_KEY_CONFIG', clientIp);
    if (isJsonRequest) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials or authentication unavailable.',
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=invalid');
      return;
    }
  }

  // ۶. استخراج هویت مالک یکتا از پایگاه داده (Fail-Closed)
  const { owner, reason: dbFailReason } = await resolveDatabaseOwner();
  if (!owner) {
    ownerGateRateLimiter.recordFailure(clientIp);
    await recordAudit(null, false, dbFailReason || 'NO_ESTABLISHED_OWNER', clientIp);
    if (isJsonRequest) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials or authentication unavailable.',
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=invalid');
      return;
    }
  }

  // ۷. ارزیابی Timing-Safe کلید ورودی
  const isMatch = verifyOwnerAccessKey(providedKey, configuredKey);
  if (!isMatch) {
    ownerGateRateLimiter.recordFailure(clientIp);
    await recordAudit(null, false, 'INCORRECT_KEY', clientIp);
    if (isJsonRequest) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials or authentication unavailable.',
      });
      return;
    } else {
      res.redirect('/OwnerGate?error=invalid');
      return;
    }
  }

  // ۸. احراز موفقیت‌آمیز: ریست لیمیتر و بازتولید امن شناسه سشن (Session Fixation Prevention)
  ownerGateRateLimiter.recordSuccess(clientIp);
  await recordAudit(owner.discordId, true, 'OWNER_ACCESS_KEY_VERIFIED', clientIp);

  req.session.regenerate((err) => {
    if (err) {
      console.error('[OwnerGate] Failed to regenerate session:', err);
      res.status(500).json({ error: 'Failed to establish authenticated session' });
      return;
    }

    req.session.userId = owner.discordId;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[OwnerGate] Failed to save regenerated session:', saveErr);
        res.status(500).json({ error: 'Failed to persist session' });
        return;
      }

      if (isJsonRequest) {
        res.json({
          success: true,
          message: 'Owner authenticated successfully',
          redirectUrl: '/?tab=admin',
        });
      } else {
        res.redirect('/?tab=admin');
      }
    });
  });
}

export const ownerGateRouter = Router();
ownerGateRouter.get('/', handleGetOwnerGate);
ownerGateRouter.post('/', handlePostOwnerGate);
