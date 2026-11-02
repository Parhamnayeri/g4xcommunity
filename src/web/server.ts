/**
 * server.ts — وب‌سرور امن Express برای پورتال g4x.online
 *
 * مسئولیت‌ها:
 *  - پیکربندی امن session مبتنی بر PrismaSessionStore
 *  - اعمال کوکی‌های HttpOnly, Secure, SameSite
 *  - تنظیم trust proxy برای محیط‌های پروداکشن
 *  - ارائه فایل‌های استاتیک داشبورد (public/)
 *  - فراهم کردن روت‌های API و احراز هویت
 */

import express from 'express';
import session from 'express-session';
import path from 'path';
import prisma from '../database/db';
import { PrismaSessionStore } from './sessionStore';
import { router } from './routes';
import { ensureCsrfToken } from './middleware/auth';

const app = express();

// ─── پیکربندی پروکسی برای محیط‌های پروداکشن ─────────────────────────────────
// در صورتی که سرور پشت Nginx / Cloudflare قرار دارد، صرفاً پروکسی اول اعتماد می‌شود
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── میدل‌ویرهای پایه و پارس بدنه ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// هدرهای پایه امنیت وب
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─── پیکربندی امن نشست‌های سرور (Express Session) ───────────────────────────
const sessionSecret = process.env.SESSION_SECRET || 'a_very_long_random_secret_key_change_this';
const sessionStore = new PrismaSessionStore(prisma);

app.use(
  session({
    name: 'g4x.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // ۷ روز
    },
  }),
);

// مقداردهی اولیه توکن CSRF برای نشست‌های جدید
app.use(ensureCsrfToken);

import fs from 'fs';

// سرو فایل‌های استاتیک کامپایل‌شده فرانت‌اند React (در صورت بیلد شدن)
const frontendDist = path.join(process.cwd(), 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// سرو فایل‌های استاتیک داشبورد
app.use(express.static(path.join(process.cwd(), 'public')));

// دسترسی به پنل قدیمی و دست‌نخورده برای حفظ کامل قابلیت‌های داشبورد، امور مالی و ادمین در فاز ۱
app.get(['/legacy', '/legacy/*'], (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'legacy.html'));
});

// ─── روت‌های API و احراز هویت ──────────────────────────────────────────────
// روت‌های اصلی API
app.use('/api', router);
// روت‌های احراز هویت بدون پیشوند /api (جهت انطباق با DISCORD_REDIRECT_URI=/auth/callback)
app.use('/', router);

// ─── SPA fallback — تمام مسیرهای دیگر به index.html فرانت‌اند هدایت می‌شوند ───
app.get('*', (req, res, next) => {
  // اگر روت متعلق به API، احراز هویت یا دروازه مالک بود و یافت نشد، نباید فایل HTML پس دهد
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/auth/') ||
    req.path.toLowerCase().startsWith('/ownergate')
  ) {
    return next();
  }
  const frontendIndex = path.join(process.cwd(), 'frontend', 'dist', 'index.html');
  if (fs.existsSync(frontendIndex)) {
    return res.sendFile(frontendIndex);
  }
  return res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// ─── مدیریت خطاهای Express ────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Web] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * راه‌اندازی وب‌سرور
 */
export function startWebServer(port: number): void {
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`[Web] ✅ Server running at http://${host}:${port}`);
    console.log(`[Web] Public URL: ${process.env.WEB_BASE_URL ?? 'http://localhost:' + port}`);
  });
}

export { app, sessionStore };
