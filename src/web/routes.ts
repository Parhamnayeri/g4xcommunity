/**
 * routes.ts — روت‌های امن API و OAuth2 دیسکورد با استفاده از Prisma و Session
 *
 * ویژگی‌های امنیتی فاز ۲.۶.۱:
 *  - حذف کامل اعتماد به هدر x-discord-id و کوئری استرینگ‌های هویتی
 *  - پارامتر state تصادفی و رمزنگاری‌شده در جریان OAuth2
 *  - بازتولید نشست (Session Regeneration) پس از لاگین جهت جلوگیری از Session Fixation
 *  - پاک‌سازی سشن و کوکی هنگام لاگ‌اوت
 *  - عدم افشای هویت یا توکن‌ها در URL ریدایرکت
 *  - استفاده از Serializerها برای جلوگیری از افشای فیلدهای حساس
 *  - محافظت CSRF بر روی متدهای تغییردهنده داده
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import prisma from '../database/db';
import {
  requireAuth,
  requireRole,
  requireCsrf,
  ensureCsrfToken,
  AuthenticatedRequest,
} from './middleware/auth';
import {
  serializeUser,
  serializeWallet,
  serializeCharacter,
  serializeOrderHistory,
} from './serializers';

export const router = Router();

// ─── ثابت‌های OAuth2 ────────────────────────────────────────────────────────
const DISCORD_API = 'https://discord.com/api/v10';

function getDiscordOAuthURL(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? '',
    redirect_uri: process.env.DISCORD_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

// ─── شروع جریان امن OAuth2 با State رمزنگاری‌شده ─────────────────────────────
router.get('/auth/discord', (req: Request, res: Response) => {
  if (!req.session) {
    res.status(500).json({ error: 'Session store unavailable' });
    return;
  }

  // تولید مقدار تصادفی و رمزنگاری‌شده برای State
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  req.session.oauthStateExpires = Date.now() + 10 * 60 * 1000; // معتبر به مدت ۱۰ دقیقه

  // ذخیره نشست قبل از ریدایرکت
  req.session.save((err) => {
    if (err) {
      console.error('[OAuth] Failed to save session before redirect:', err);
      res.status(500).json({ error: 'Failed to initiate login flow' });
      return;
    }
    res.redirect(getDiscordOAuthURL(state));
  });
});

// ─── کال‌بک OAuth2 با اعتبارسنجی دقیق State در سمت سرور ─────────────────────
router.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  // ۱. اعتبارسنجی وجود پارامترها
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing or invalid authorization code' });
    return;
  }

  if (!state || typeof state !== 'string') {
    res.status(403).json({ error: 'Missing OAuth state parameter' });
    return;
  }

  // ۲. تطابق و بررسی انقضای State
  const sessionState = req.session?.oauthState;
  const stateExpires = req.session?.oauthStateExpires;

  if (!sessionState || sessionState !== state) {
    res.status(403).json({ error: 'Invalid or mismatched OAuth state' });
    return;
  }

  if (stateExpires && Date.now() > stateExpires) {
    res.status(403).json({ error: 'OAuth state parameter has expired' });
    return;
  }

  // پاک‌سازی مقادیر موقت State از سشن
  delete req.session.oauthState;
  delete req.session.oauthStateExpires;

  try {
    // ۳. تبادل امن کد مجوز با access_token در سرور دیسکورد
    const tokenRes = await axios.post(
      `${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID ?? '',
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI ?? '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const { access_token } = tokenRes.data as { access_token: string };

    // ۴. دریافت و تایید هویت کاربر مستقیماً از API دیسکورد
    const userRes = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const discordUser = userRes.data as {
      id: string;
      username: string;
      global_name?: string;
    };

    // ۵. ایجاد یا بروزرسانی کاربر در دیتابیس
    await prisma.user.upsert({
      where: { discordId: discordUser.id },
      update: {
        username: discordUser.username,
        displayName: discordUser.global_name ?? discordUser.username,
      },
      create: {
        discordId: discordUser.id,
        username: discordUser.username,
        displayName: discordUser.global_name ?? discordUser.username,
      },
    });

    // ۶. اطمینان از وجود کیف‌پول
    await prisma.wallet.upsert({
      where: { userId: discordUser.id },
      update: {},
      create: { userId: discordUser.id },
    });

    // ۷. بازتولید شناسه سشن (Regenerate Session) جهت مقابله قطعی با Session Fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('[OAuth] Session regeneration error:', err);
        res.status(500).json({ error: 'Session creation failed' });
        return;
      }

      // انتساب هویت تاییدشده به سشن جدید
      req.session.userId = discordUser.id;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[OAuth] Session save error after regeneration:', saveErr);
          res.status(500).json({ error: 'Failed to finalize login' });
          return;
        }

        // ریدایرکت امن بدون افشای هویت یا توکن در URL
        res.redirect('/');
      });
    });

  } catch (error) {
    console.error('[OAuth] Callback authentication error:', error);
    res.status(500).json({ error: 'Discord authentication failed' });
  }
});

// ─── خروج از حساب (Logout) با باطل‌سازی سشن و پاک‌سازی کوکی ─────────────────
router.post('/auth/logout', requireAuth, requireCsrf, (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error destroying session:', err);
      res.status(500).json({ error: 'Failed to destroy session' });
      return;
    }
    res.clearCookie('g4x.sid', { path: '/' });
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// خروج از طریق GET برای سهولت ریدایرکت مرورگر
router.get('/auth/logout', (req: Request, res: Response) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('g4x.sid', { path: '/' });
      res.redirect('/');
    });
  } else {
    res.clearCookie('g4x.sid', { path: '/' });
    res.redirect('/');
  }
});

// ─── دریافت توکن CSRF برای نشست جاری ─────────────────────────────────────────
router.get('/csrf-token', ensureCsrfToken, (req: Request, res: Response) => {
  res.json({ csrfToken: req.session.csrfToken });
});

// ─── اطلاعات کاربر احراز هویت‌شده (Session-Derived) ──────────────────────────
router.get('/me', requireAuth, (req: Request, res: Response): void => {
  const { user } = req as AuthenticatedRequest;
  res.json(serializeUser(user));
});

// ─── موجودی کیف‌پول (صرفاً برای مالک سشن) ───────────────────────────────────
router.get('/wallet', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { user } = req as AuthenticatedRequest;

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.discordId },
  });

  if (!wallet) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }

  res.json(serializeWallet(wallet));
});

// ─── کاراکترهای WoW کاربر جاری ───────────────────────────────────────────────
router.get('/characters', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { user } = req as AuthenticatedRequest;

  const characters = await prisma.wowCharacter.findMany({
    where: { userId: user.discordId },
    orderBy: [
      { isMain: 'desc' },
      { mythicScore: 'desc' },
    ],
  });

  res.json(characters.map(serializeCharacter));
});

// ─── تاریخچه بوست‌های کاربر جاری ─────────────────────────────────────────────
router.get('/boosts/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { user } = req as AuthenticatedRequest;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const offset = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: {
        assignments: {
          some: { userId: user.discordId },
        },
        status: { in: ['completed', 'in_progress', 'assigned'] },
      },
      include: {
        service: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.order.count({
      where: {
        assignments: {
          some: { userId: user.discordId },
        },
        status: { in: ['completed', 'in_progress', 'assigned'] },
      },
    }),
  ]);

  res.json({
    data: orders.map(serializeOrderHistory),
    total,
    page,
    limit,
  });
});

// ─── روت مدیریتی حفاظت‌شده با Role-Based Access Control (RBAC) ───────────────
router.get(
  '/admin/overview',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (_req: Request, res: Response): Promise<void> => {
    const [userCount, orderCount, activeGamesCount] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.game.count({ where: { isActive: true } }),
    ]);

    res.json({
      totalUsers: userCount,
      totalOrders: orderCount,
      activeGames: activeGamesCount,
    });
  },
);

// ─── روت تغییر وضعیت تحت محافظت CSRF (نمونه عملیاتی) ────────────────────────
router.post(
  '/characters/sync-request',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { user } = req as AuthenticatedRequest;
    const { characterId } = req.body;

    if (!characterId || typeof characterId !== 'number') {
      res.status(400).json({ error: 'Valid characterId required' });
      return;
    }

    // بررسی مالکیت کاراکتر
    const char = await prisma.wowCharacter.findFirst({
      where: { id: characterId, userId: user.discordId },
    });

    if (!char) {
      res.status(404).json({ error: 'Character not found or not owned by caller' });
      return;
    }

    const updated = await prisma.wowCharacter.update({
      where: { id: characterId },
      data: { syncStatus: 'pending' },
    });

    res.json({ success: true, character: serializeCharacter(updated) });
  },
);
