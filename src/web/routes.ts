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
  serializeSquad,
  serializeOrderHistory,
} from './serializers';
import {
  addCharacter,
  listUserCharacters,
  setMainCharacter,
  syncCharacterProfile,
  removeCharacter,
} from '../services/characterService';
import {
  createTeam,
  listTeams,
  inviteMember,
  acceptInvitation,
  declineInvitation,
  leaveTeam,
  disbandTeam,
} from '../services/teamService';
import { DomainError } from '../services/domainErrors';
import { getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';
import { marketplaceRouter } from './marketplaceRoutes';
import { paymentRouter } from './paymentRoutes';
import { verifyOrderWithReceipt } from '../services/payment/paymentReconciliationService';
import {
  generateUsdtWithdrawalQuote,
  generateIrtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  confirmAndSubmitWithdrawalRequest,
  adminExecuteManualPayout,
  adminRejectWithdrawal,
} from '../services/financeV2/boosterWithdrawalService';
import {
  recordProofSubmitted,
  recordStaffReview,
  recordAdminFinalApproval,
} from '../services/financeV2/g4xBoostReleaseService';
import {
  registerBooster,
  registerAdvertiser,
  registerExchanger,
  getUserActiveApplications,
  reviewApplication,
} from '../services/registrationService';
import { createOrderClaim } from '../services/claimService';
import { completeOrderRun } from '../services/runValidationService';
import {
  getOrCreateOrderExecutionChannel,
  getAuthorizedChannelAccess,
} from '../services/orderExecutionChannelService';
import {
  mapOrderStatus,
  mapGoldTradeStatus,
  mapWithdrawalStatus,
  mapApplicationStatus,
} from '../services/statusSimplifier';
import {
  AdvertiserRank,
  ADVERTISER_RANK_RATES_BPS,
  ADVERTISER_RANK_LABELS,
  ADVERTISER_RANK_POLICY_VERSION,
  isValidAdvertiserRank,
  getRankBasisPoints,
  formatBasisPoints,
  calculateRankCommission,
  getAdvertiserRank,
  setAdvertiserRank,
  getAdvertiserMigrationImpactReport,
  getAdvertiserRankAuditHistory,
} from '../services/advertiserRankService';

export const router = Router();

// ─── روت‌های بازار مبادله، معاملات طلا و شارژ همتا‌به‌همتا (Finance V2.2) ──────
router.use('/marketplace', marketplaceRouter);

// ─── روت‌های پرداخت، وب‌هوک و اعتبارسنجی وصول وجوه ─────────────────────────
router.use('/', paymentRouter);

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

// ─── ورود امن محیط استیجینگ (فقط در حالت STAGING_TEST_AUTH فعال است) ─────────
if (process.env.STAGING_TEST_AUTH === 'true' || process.env.NODE_ENV === 'staging') {
  router.get('/auth/staging-login', async (req: Request, res: Response): Promise<void> => {
    const discordId = String(req.query.discordId || 'test_admin_staging');
    const username = String(req.query.username || 'Staging Admin');
    const role = String(req.query.role || 'admin');

    await prisma.user.upsert({
      where: { discordId },
      update: { isActive: true },
      create: { discordId, username, displayName: username },
    });

    await prisma.role.upsert({
      where: { roleKey: role },
      update: {},
      create: { roleKey: role, name: role.toUpperCase() },
    });

    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: discordId, roleKey: role } },
      update: {},
      create: { userId: discordId, roleKey: role },
    });

    await prisma.wallet.upsert({
      where: { userId: discordId },
      update: {},
      create: { userId: discordId },
    });

    await getOrCreateWalletV2(discordId);

    if (req.session) {
      req.session.userId = discordId;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save(() => {
        res.redirect('/');
      });
    } else {
      res.redirect('/');
    }
  });
}


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

// ─── موجودی کیف‌پول دلاری نسل دوم (Unified USD Wallet V2) ───────────────────
router.get('/wallet/v2', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { user } = req as AuthenticatedRequest;
  const walletV2 = await getOrCreateWalletV2(user.discordId);
  res.json({
    userId: walletV2.userId,
    availableCents: walletV2.availableCents,
    reservedCents: walletV2.reservedCents,
    pendingEarningsCents: walletV2.pendingEarningsCents,
    confirmedEarningsCents: walletV2.confirmedEarningsCents,
    paidCents: walletV2.paidCents,
    refundedCents: walletV2.refundedCents,
    totalUsd: ((walletV2.availableCents + walletV2.reservedCents) / 100).toFixed(2),
  });
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

// ─── کاراکترهای WoW کاربر جاری ───────────────────────────────────────────────
router.get('/characters', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const characters = await listUserCharacters(user.discordId);
    res.json(characters.map(serializeCharacter));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list characters' });
  }
});

router.post(
  '/characters/add',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { characterName, realm, region } = req.body;

      if (!characterName || !realm) {
        res.status(400).json({ error: 'characterName and realm are required.' });
        return;
      }

      const character = await addCharacter({
        userId: user.discordId,
        characterName,
        realm,
        region,
        actorId: user.discordId,
      });

      res.json({ success: true, character: serializeCharacter(character) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to add character' });
    }
  }
);

router.post(
  '/characters/set-main',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { characterId } = req.body;

      if (!characterId) {
        res.status(400).json({ error: 'Valid characterId required.' });
        return;
      }

      const updated = await setMainCharacter(user.discordId, characterId, user.discordId);
      res.json({ success: true, character: serializeCharacter(updated) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to set main character' });
    }
  }
);

router.post(
  '/characters/sync-request',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { characterId } = req.body;

      if (!characterId) {
        res.status(400).json({ error: 'Valid characterId required.' });
        return;
      }

      const { result, character } = await syncCharacterProfile(characterId, user.discordId, user.discordId);
      res.json({ success: true, result, character: serializeCharacter(character) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to sync character' });
    }
  }
);

router.post(
  '/characters/remove',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { characterId } = req.body;

      if (!characterId) {
        res.status(400).json({ error: 'Valid characterId required.' });
        return;
      }

      const removed = await removeCharacter(characterId, user.discordId, user.discordId);
      res.json({ success: true, character: serializeCharacter(removed) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to remove character' });
    }
  }
);

// ─── تیم‌های آماده (Premade Squads) ───────────────────────────────────────────
router.get('/teams', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const squads = await listTeams(user.discordId);
    res.json(squads.map(serializeSquad));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list teams' });
  }
});

router.post(
  '/teams/create',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { teamName, squadType } = req.body;

      if (!teamName) {
        res.status(400).json({ error: 'teamName is required.' });
        return;
      }

      const squad = await createTeam({
        leaderId: user.discordId,
        teamName,
        squadType,
        actorId: user.discordId,
      });

      res.json({ success: true, squad: squad ? serializeSquad(squad) : null });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to create team' });
    }
  }
);

router.post(
  '/teams/invite',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { squadId, targetUserId, memberRole } = req.body;

      if (!squadId || !targetUserId) {
        res.status(400).json({ error: 'squadId and targetUserId are required.' });
        return;
      }

      await inviteMember({
        squadIdOrName: squadId,
        leaderId: user.discordId,
        targetUserId,
        memberRole,
      });

      res.json({ success: true });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to invite member' });
    }
  }
);

router.post(
  '/teams/accept',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { squadId } = req.body;

      if (!squadId) {
        res.status(400).json({ error: 'squadId is required.' });
        return;
      }

      await acceptInvitation(squadId, user.discordId);
      res.json({ success: true });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to accept invitation' });
    }
  }
);

router.post(
  '/teams/decline',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { squadId } = req.body;

      if (!squadId) {
        res.status(400).json({ error: 'squadId is required.' });
        return;
      }

      await declineInvitation(squadId, user.discordId);
      res.json({ success: true });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to decline invitation' });
    }
  }
);

router.post(
  '/teams/leave',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { squadId } = req.body;

      if (!squadId) {
        res.status(400).json({ error: 'squadId is required.' });
        return;
      }

      const result = await leaveTeam(squadId, user.discordId);
      res.json({ success: true, result });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to leave team' });
    }
  }
);

router.post(
  '/teams/disband',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { squadId } = req.body;

      if (!squadId) {
        res.status(400).json({ error: 'squadId is required.' });
        return;
      }

      const squad = await disbandTeam(squadId, user.discordId);
      res.json({ success: true, squad: serializeSquad(squad) });
    } catch (err: any) {
      const status = err instanceof DomainError ? 400 : 500;
      res.status(status).json({ error: err.message || 'Failed to disband team' });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY E: بوستر — درخواست و پیش‌نمایش تسویه/برداشت (Booster Withdrawals)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/withdrawals/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const requests = await prisma.boosterWithdrawalRequest.findMany({
      where: { boosterId: user.discordId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      withdrawals: requests.map((r) => ({
        ...r,
        simplifiedStatus: mapWithdrawalStatus(r.status),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch withdrawals' });
  }
});

router.post(
  '/withdrawals/quote',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { payoutMethod, requestedUsdCents, destinationAddress } = req.body;

      if (!payoutMethod || !requestedUsdCents || !destinationAddress) {
        res.status(400).json({ error: 'payoutMethod, requestedUsdCents, and destinationAddress are required' });
        return;
      }

      let quoteResult;
      if (payoutMethod.toLowerCase() === 'usdt') {
        quoteResult = await generateUsdtWithdrawalQuote({
          boosterId: user.discordId,
          requestedUsdCents: Number(requestedUsdCents),
          destinationAddress: String(destinationAddress).trim(),
        });
      } else if (payoutMethod.toLowerCase() === 'irt') {
        quoteResult = await generateIrtWithdrawalQuote({
          boosterId: user.discordId,
          requestedUsdCents: Number(requestedUsdCents),
          destinationAddress: String(destinationAddress).trim(),
        });
      } else {
        res.status(400).json({ error: "Unsupported payoutMethod. Use 'usdt' or 'irt'." });
        return;
      }

      const requestRecord = await createWithdrawalRequestFromQuote(quoteResult);

      res.json({
        success: true,
        quote: {
          id: requestRecord.id,
          withdrawalRef: requestRecord.withdrawalRef,
          payoutMethod: requestRecord.payoutMethod,
          requestedUsdCents: requestRecord.requestedUsdCents,
          fixedFeeUsdCents: requestRecord.fixedFeeUsdCents,
          quotedNetPayoutAmount: requestRecord.quotedNetPayoutAmount,
          destinationAddress: requestRecord.destinationAddress,
          quoteExpiresAt: requestRecord.quoteExpiresAt,
          quoteHash: requestRecord.quoteHash,
          status: requestRecord.status,
          simplifiedStatus: mapWithdrawalStatus(requestRecord.status),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to generate withdrawal quote' });
    }
  }
);

router.post(
  '/withdrawals/confirm',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { requestId } = req.body;

      if (!requestId || typeof requestId !== 'number') {
        res.status(400).json({ error: 'Valid numeric requestId required' });
        return;
      }

      const { request, wallet } = await confirmAndSubmitWithdrawalRequest(requestId, user.discordId);

      res.json({
        success: true,
        request: {
          ...request,
          simplifiedStatus: mapWithdrawalStatus(request.status),
        },
        wallet: {
          availableCents: wallet.availableCents,
          reservedCents: wallet.reservedCents,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to confirm withdrawal' });
    }
  }
);

router.get(
  '/admin/withdrawals',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const requests = await prisma.boosterWithdrawalRequest.findMany({
        where: { status: { in: ['RESERVED', 'PROCESSING', 'QUOTED'] } },
        include: {
          booster: {
            select: { discordId: true, username: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        withdrawals: requests.map((r) => ({
          ...r,
          simplifiedStatus: mapWithdrawalStatus(r.status),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/admin/withdrawals/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = Number(req.params.id);
      const { decision, txHash, reason } = req.body;

      if (decision === 'approve_paid') {
        const tx = txHash || `SIMULATED_MANUAL_TX_${Date.now()}`;
        const { request: updatedReq } = await adminExecuteManualPayout(id, user.discordId, {
          externalTxHash: tx,
          bankReceiptRef: tx,
          notes: 'Executed via Admin Hub',
        });
        res.json({
          success: true,
          request: {
            ...updatedReq,
            simplifiedStatus: mapWithdrawalStatus(updatedReq.status),
          },
        });
      } else if (decision === 'reject') {
        const rejReason = reason || 'Rejected by administration';
        const { request } = await adminRejectWithdrawal(id, user.discordId, rejReason);
        res.json({
          success: true,
          request: {
            ...request,
            simplifiedStatus: mapWithdrawalStatus(request.status),
          },
        });
      } else {
        res.status(400).json({ error: "Invalid decision. Must be 'approve_paid' or 'reject'." });
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Withdrawal review failed' });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY C: کارمزد و درآمدهای بوستر (Booster Earnings & Order Release)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/booster/earnings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const allocations = await prisma.boosterPayoutAllocation.findMany({
      where: { boosterId: user.discordId },
      include: {
        order: {
          include: {
            service: true,
            boostReleaseTracker: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      earnings: allocations.map((a) => ({
        id: a.id,
        orderId: a.orderId,
        orderRef: a.order.orderRef,
        serviceName: a.order.service.displayName,
        allocatedMinor: a.allocatedMinor,
        allocatedUsd: (a.allocatedMinor / 100).toFixed(2),
        payoutRole: a.payoutRole,
        createdAt: a.createdAt,
        simplifiedStatus: mapOrderStatus(a.order.status, a.order.boostReleaseTracker?.stage),
        releaseStage: a.order.boostReleaseTracker?.stage || null,
        holdExpiresAt: a.order.boostReleaseTracker?.holdExpiresAt || null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch booster earnings' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY B: چرخه عمر سفارش‌های بوستینگ (Boost Order Lifecycle)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/orders/available', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ['open_presign', 'pending', 'assigned', 'in_progress', 'completed'] },
        paymentStatus: { in: ['verified', 'unneeded'] },
      },
      include: {
        service: true,
        runs: true,
        boostReleaseTracker: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      orders: orders.map((o) => ({
        id: o.id,
        orderRef: o.orderRef,
        gameSlug: o.gameSlug,
        serviceName: o.service.displayName,
        grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
        boosterPoolUsd: (o.boosterPoolMinor / 100).toFixed(2),
        status: o.status,
        creatorType: o.creatorType,
        runsCount: o.runs.length,
        releaseStage: o.boostReleaseTracker?.stage || null,
        simplifiedStatus: mapOrderStatus(o.status, o.boostReleaseTracker?.stage),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch available orders' });
  }
});

router.post(
  '/orders/create',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { gameSlug, serviceId, grossAmountUsd, orderType, notes } = req.body;

      if (!gameSlug || !serviceId || !grossAmountUsd) {
        res.status(400).json({ error: 'gameSlug, serviceId, and grossAmountUsd are required' });
        return;
      }

      const grossCents = Math.round(Number(grossAmountUsd) * 100);
      if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
        res.status(400).json({ error: 'Amount must be a positive integer in cents' });
        return;
      }

      const isAdv = user.userRoles?.some((ur) => ur.roleKey === 'advertiser');
      let advRank: AdvertiserRank | null = null;
      let platformFeeMinor = 0;
      let boosterPoolMinor = grossCents;
      let rankCommissionBps: number | null = null;

      if (isAdv) {
        advRank = await getAdvertiserRank(user.discordId);
        if (!advRank || !isValidAdvertiserRank(advRank)) {
          res.status(400).json({
            error:
              'UNRESOLVED_ADVERTISER_RANK: Direct Advertiser Boost order creation is blocked because the advertiser lacks an approved rank. Commercial rank must be assigned by management.',
          });
          return;
        }
        const calc = calculateRankCommission(grossCents, advRank);
        platformFeeMinor = calc.g4xFeeMinor;
        boosterPoolMinor = calc.remainingMinor;
        rankCommissionBps = calc.rankCommissionBasisPoints;
      }

      const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const order = await prisma.$transaction(async (tx) => {
        // Authoritative wallet check for payment reservation
        const wallet = await tx.walletV2.findUnique({
          where: { userId: user.discordId },
        });

        const hasSufficientWalletFunds = Boolean(wallet && wallet.availableCents >= grossCents);
        let paymentStatus = 'pending';
        let orderStatus = 'payment_pending';
        let paymentVerifiedBy: string | null = null;
        let paymentVerifiedAt: Date | null = null;

        if (hasSufficientWalletFunds && wallet) {
          const newAvailable = wallet.availableCents - grossCents;
          const newReserved = wallet.reservedCents + grossCents;

          await tx.walletV2.update({
            where: { userId: user.discordId },
            data: {
              availableCents: newAvailable,
              reservedCents: newReserved,
            },
          });

          await tx.ledgerEntryV2.create({
            data: {
              entryRef: `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              userId: user.discordId,
              amountCents: grossCents,
              entryType: 'ORDER_RESERVE',
              direction: 'DEBIT',
              balanceAfterAvailableCents: newAvailable,
              balanceAfterReservedCents: newReserved,
              description: `Authoritative funds reserved from available USD balance for Order #${orderRef}`,
              createdBy: user.discordId,
            },
          });

          paymentStatus = 'verified';
          orderStatus = 'open_presign';
          paymentVerifiedBy = user.discordId;
          paymentVerifiedAt = new Date();
        }

        const ord = await tx.order.create({
          data: {
            orderRef,
            gameSlug,
            serviceId: Number(serviceId),
            creatorId: user.discordId,
            creatorType: isAdv ? 'advertiser' : 'g4x',
            advertiserId: isAdv ? user.discordId : null,
            advertiserRank: advRank,
            rankCommissionBps,
            orderType: orderType || 'group',
            orderMode: 'non_pilot',
            currency: 'USD',
            grossAmountMinor: grossCents,
            platformFeeMinor,
            advertiserFeeMinor: 0,
            boosterPoolMinor,
            paymentStatus,
            status: orderStatus,
            paymentVerifiedBy,
            paymentVerifiedAt,
            notes: notes || null,
            runs: {
              create: [{ runNumber: 1, status: 'pending' }],
            },
          },
          include: { service: true, runs: true },
        });

        // Persist commercial snapshot at authoritative commitment point
        if (isAdv && advRank && rankCommissionBps !== null) {
          await tx.orderFinancialSnapshot.create({
            data: {
              orderId: ord.id,
              sourcePlatform: 'advertiser',
              sourceAmountType: 'gross_sale',
              sourceAmountMinor: grossCents,
              grossSaleMinor: grossCents,
              platformOrderNetMinor: grossCents,
              externalNetBaseMinor: grossCents,
              g4xFeeRate: rankCommissionBps / 10000,
              g4xFeeMinor: platformFeeMinor,
              advertiserFeeMinor: 0,
              boosterPoolMinor,
              currency: 'USD',
              calculationStatus: 'provisional',
              policyVersion: ADVERTISER_RANK_POLICY_VERSION,
              advertiserId: user.discordId,
              advertiserRank: advRank,
              rankFeeBasisPoints: rankCommissionBps,
              remainingAmountMinor: boosterPoolMinor,
              snapshotTimestamp: new Date(),
            },
          });
        }

        return ord;
      });

      res.json({
        success: true,
        order: {
          ...order,
          simplifiedStatus: mapOrderStatus(order.status),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create order' });
    }
  }
);

router.post(
  '/orders/:id/verify-payment',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const { receiptRef } = req.body;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.paymentStatus === 'verified') {
        res.json({ success: true, message: 'Order payment is already verified', order });
        return;
      }

      if (!receiptRef) {
        res.status(400).json({
          error:
            'DIRECT_PAYMENT_VERIFICATION_BLOCKED: Administrative payment verification strictly requires a valid verified payment receipt. Synthetic approvals without financial backing are prohibited. Please approve an active payment attempt or provide receiptRef.',
        });
        return;
      }

      const result = await verifyOrderWithReceipt(orderId, String(receiptRef), user.discordId);

      res.json({
        success: true,
        message: 'Order payment verified via receipt',
        order: result.order
          ? {
              ...result.order,
              simplifiedStatus: mapOrderStatus(result.order.status),
            }
          : undefined,
        receipt: result.receipt,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to verify order payment' });
    }
  }
);

router.post(
  '/orders/:id/pay-from-wallet',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.creatorId !== user.discordId && order.advertiserId !== user.discordId) {
        res.status(403).json({ error: 'Only the order creator can fund this order from wallet' });
        return;
      }

      if (order.paymentStatus === 'verified') {
        res.json({ success: true, message: 'Order is already funded and verified', order });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const wallet = await tx.walletV2.findUnique({
          where: { userId: user.discordId },
        });

        if (!wallet || wallet.availableCents < order.grossAmountMinor) {
          throw new Error('INSUFFICIENT_FUNDS: Available wallet balance is insufficient to fund this order.');
        }

        const newAvailable = wallet.availableCents - order.grossAmountMinor;
        const newReserved = wallet.reservedCents + order.grossAmountMinor;

        await tx.walletV2.update({
          where: { userId: user.discordId },
          data: {
            availableCents: newAvailable,
            reservedCents: newReserved,
          },
        });

        await tx.ledgerEntryV2.create({
          data: {
            entryRef: `LEDGER_ORD_PAY_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            userId: user.discordId,
            amountCents: order.grossAmountMinor,
            entryType: 'ORDER_RESERVE',
            direction: 'DEBIT',
            balanceAfterAvailableCents: newAvailable,
            balanceAfterReservedCents: newReserved,
            description: `Payment reserved from available USD balance for Order #${order.orderRef}`,
            createdBy: user.discordId,
          },
        });

        const ord = await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: 'verified',
            status: order.status === 'payment_pending' ? 'open_presign' : order.status,
            paymentVerifiedBy: user.discordId,
            paymentVerifiedAt: new Date(),
          },
        });

        return ord;
      });

      res.json({
        success: true,
        message: 'Order funded and payment verified from wallet balance',
        order: {
          ...updated,
          simplifiedStatus: mapOrderStatus(updated.status),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to pay for order' });
    }
  }
);

router.post(
  '/orders/:id/claim',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const { registeredRole = 'dps' } = req.body;

      const claim = await createOrderClaim({
        orderId,
        userId: user.discordId,
        claimType: 'individual',
        registeredRole,
      });

      // برای سادگی در MVP، در صورت کلیم موفق، تخصیص را به صورت خودکار ایجاد و ران را فعال می‌کنیم
      await prisma.orderAssignment.create({
        data: {
          orderId,
          userId: user.discordId,
          assignedById: user.discordId,
          assignedRole: registeredRole,
          status: 'assigned',
          claimId: claim.id,
        },
      });

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { status: 'in_progress' },
      });

      res.json({
        success: true,
        claim,
        simplifiedStatus: mapOrderStatus(updatedOrder.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to claim order' });
    }
  }
);

router.get(
  '/orders/:id/channel',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      if (isNaN(orderId) || orderId <= 0) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const access = await getAuthorizedChannelAccess(orderId, user.discordId);
      if (!access.authorized) {
        res.status(403).json({ error: access.reason || 'PERMISSION_DENIED' });
        return;
      }

      if (!access.hasChannel) {
        res.status(404).json({ error: access.reason || 'NO_CHANNEL_AVAILABLE' });
        return;
      }

      res.json({
        success: true,
        channelId: access.channelId,
        channelUrl: access.channelUrl,
        channelName: access.channelName,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve order channel' });
    }
  }
);

router.post(
  '/orders/:id/complete-run',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);

      const run = await prisma.orderRun.findFirst({
        where: { orderId, status: { in: ['pending', 'in_progress'] } },
      });

      if (!run) {
        res.status(400).json({ error: 'No active run found for this order' });
        return;
      }

      const completed = await completeOrderRun(run.id, user.discordId, 'Completed via web dashboard');

      // سفارش به اتمام ران می‌رسد
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'completed', completedAt: new Date() },
      });

      res.json({ success: true, run: completed, simplifiedStatus: mapOrderStatus('completed', 'RUN_COMPLETED') });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to complete run' });
    }
  }
);

router.post(
  '/orders/:id/submit-proof',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);

      const tracker = await recordProofSubmitted(orderId, user.discordId);

      res.json({
        success: true,
        tracker,
        simplifiedStatus: mapOrderStatus('completed', tracker.stage),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to submit proof' });
    }
  }
);

router.post(
  '/orders/:id/staff-review',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const { notes } = req.body;

      const tracker = await recordStaffReview(orderId, user.discordId, notes);

      res.json({
        success: true,
        tracker,
        simplifiedStatus: mapOrderStatus('completed', tracker.stage),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Staff review failed' });
    }
  }
);

router.post(
  '/orders/:id/admin-approve',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.id);
      const { notes } = req.body;

      const tracker = await recordAdminFinalApproval(orderId, user.discordId, notes);

      res.json({
        success: true,
        tracker,
        simplifiedStatus: mapOrderStatus('completed', tracker.stage),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Admin final approval failed' });
    }
  }
);

router.get(
  '/admin/orders',
  requireAuth,
  requireRole('owner', 'manager', 'admin', 'staff'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const orders = await prisma.order.findMany({
        include: {
          service: true,
          runs: true,
          boostReleaseTracker: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({
        success: true,
        orders: orders.map((o) => ({
          id: o.id,
          orderRef: o.orderRef,
          gameSlug: o.gameSlug,
          serviceName: o.service.displayName,
          grossAmountUsd: (o.grossAmountMinor / 100).toFixed(2),
          boosterPoolUsd: (o.boosterPoolMinor / 100).toFixed(2),
          status: o.status,
          creatorType: o.creatorType,
          runsCount: o.runs.length,
          releaseStage: o.boostReleaseTracker?.stage || null,
          simplifiedStatus: mapOrderStatus(o.status, o.boostReleaseTracker?.stage),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch admin orders' });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// ─── JOURNEY A: درخواست‌های عضویت و ثبت‌نام (Registration Applications)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/applications/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const applications = await getUserActiveApplications(user.discordId);

    res.json({
      success: true,
      applications: applications.map((app) => ({
        ...app,
        simplifiedStatus: mapApplicationStatus(app.status),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch applications' });
  }
});

router.post(
  '/applications',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const { category, gameSlug, experience, introduction, priorExperience, contactInfo, gameCurrencies, settlementCurrencies } = req.body;

      let app;
      if (category === 'booster') {
        app = await registerBooster({
          userId: user.discordId,
          gameSlug: gameSlug || 'wow_midnight',
          experience: experience || 'Elite player with mythic raiding background',
        });
      } else if (category === 'advertiser') {
        app = await registerAdvertiser({
          userId: user.discordId,
          introduction: introduction || 'Experienced game services coordinator',
          priorExperience: priorExperience || 'Managed multiple gaming communities',
          contactInfo: contactInfo || `discord:${user.username}`,
        });
      } else if (category === 'exchanger') {
        app = await registerExchanger({
          userId: user.discordId,
          introduction: introduction || 'Financial exchanger with verified reserves',
          experience: experience || 'High-volume cross-currency trading',
          gameCurrencies: gameCurrencies || ['wow_gold'],
          settlementCurrencies: settlementCurrencies || ['IRT', 'USDT'],
          contactInfo: contactInfo || `discord:${user.username}`,
        });
      } else {
        res.status(400).json({ error: "Invalid category. Must be 'booster', 'advertiser', or 'exchanger'." });
        return;
      }

      res.json({
        success: true,
        application: {
          ...app,
          simplifiedStatus: mapApplicationStatus(app.status),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to submit application' });
    }
  }
);

router.get(
  '/admin/applications',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const applications = await prisma.registrationApplication.findMany({
        where: { status: { in: ['pending', 'under_review', 'info_requested'] } },
        include: {
          user: {
            select: { discordId: true, username: true, displayName: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
      });

      res.json({
        success: true,
        applications: applications.map((app) => ({
          ...app,
          simplifiedStatus: mapApplicationStatus(app.status),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/admin/applications/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const applicationId = Number(req.params.id);
      const { decision, reason, reviewNotes } = req.body;

      if (!['approve', 'reject', 'request_info'].includes(decision)) {
        res.status(400).json({ error: "Invalid decision. Must be 'approve', 'reject', or 'request_info'." });
        return;
      }

      // برای سهولت تایید صراف در محیط تست و MVP، در صورت تایید صراف، وضعیت هویت موقتاً verified علامت‌گذاری می‌شود
      if (decision === 'approve') {
        const currentApp = await prisma.registrationApplication.findUnique({ where: { id: applicationId } });
        if (currentApp?.category === 'exchanger' && currentApp.identityStatus !== 'verified') {
          await prisma.registrationApplication.update({
            where: { id: applicationId },
            data: { identityStatus: 'verified' },
          });
        }
      }

      const updated = await reviewApplication({
        reviewerId: user.discordId,
        applicationId,
        decision,
        reason,
        reviewNotes,
      });

      res.json({
        success: true,
        application: {
          ...updated,
          simplifiedStatus: mapApplicationStatus(updated.status),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Application review failed' });
    }
  }
);

// ─── روت‌های مدیریت رنک‌های تجاری ادورتایزرها (Advertiser Rank Management) ────────

// ۱. دریافت فهرست ادورتایزرها و رنک‌های فعلی
router.get(
  '/admin/advertiser-ranks',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const advertisers = await prisma.user.findMany({
        where: {
          userRoles: {
            some: { roleKey: 'advertiser' },
          },
        },
        include: {
          wallet: { select: { customCommissionRate: true } },
          walletV2: { select: { customCommissionRate: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const result = advertisers.map((adv) => {
        const rank = isValidAdvertiserRank(adv.advertiserRank) ? (adv.advertiserRank as AdvertiserRank) : null;
        const bps = rank ? getRankBasisPoints(rank) : null;
        return {
          discordId: adv.discordId,
          username: adv.username,
          displayName: adv.displayName,
          advertiserRank: rank,
          rankLabel: rank ? ADVERTISER_RANK_LABELS[rank] : 'Unassigned / Pending Migration',
          basisPoints: bps,
          commissionRateFormatted: bps !== null ? formatBasisPoints(bps) : null,
          legacyW1CustomRate: adv.wallet?.customCommissionRate ?? null,
          legacyW2CustomRate: adv.walletV2?.customCommissionRate ?? null,
          hasLegacyRate: adv.wallet?.customCommissionRate != null || adv.walletV2?.customCommissionRate != null,
          isMigrationUnresolved: rank === null,
          createdAt: adv.createdAt,
        };
      });

      res.json({
        success: true,
        advertisers: result,
        approvedRanks: Object.values(AdvertiserRank).map((r) => ({
          rank: r,
          label: ADVERTISER_RANK_LABELS[r],
          basisPoints: ADVERTISER_RANK_RATES_BPS[r],
          percentageFormatted: formatBasisPoints(ADVERTISER_RANK_RATES_BPS[r]),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch advertiser ranks' });
    }
  }
);

// ۲. به‌روزرسانی دستی رنک ادورتایزر با دلیل اجباری
router.post(
  '/admin/advertiser-ranks/:id',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const advertiserId = req.params.id;
      const { rank, reason } = req.body;

      if (!rank || !isValidAdvertiserRank(rank)) {
        res.status(400).json({
          error: `Invalid advertiser rank. Approved ranks: ${Object.values(AdvertiserRank).join(', ')}`,
        });
        return;
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        res.status(400).json({
          error: 'A mandatory reason of at least 3 characters is required to change an advertiser rank.',
        });
        return;
      }

      const result = await setAdvertiserRank({
        advertiserId,
        newRank: rank as AdvertiserRank,
        reason,
        actorId: user.discordId,
      });

      res.json({
        success: true,
        message: `Advertiser rank successfully updated to ${rank} (${result.effectiveCommissionRate})`,
        data: result,
      });
    } catch (err: any) {
      const statusCode = err.message?.includes('PERMISSION_DENIED') ? 403 : 400;
      res.status(statusCode).json({ error: err.message || 'Failed to update advertiser rank' });
    }
  }
);

// ۳. دریافت گزارش ممیزی مهاجرت کمیسیون‌های قدیمی ادورتایزرها (Read-only Migration Impact Report)
router.get(
  '/admin/advertiser-ranks/migration-report',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const report = await getAdvertiserMigrationImpactReport();
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate migration impact report' });
    }
  }
);

// ۴. دریافت تاریخچه تغییرات رنک ادورتایزر (Audit Trail)
router.get(
  '/admin/advertiser-ranks/:id/audit-history',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const targetId = req.params.id;

      const userRoles = user.userRoles?.map((r) => r.roleKey) || [];
      const isStaffOrAdmin = userRoles.some((r) => ['owner', 'manager', 'admin'].includes(r));
      const isSelf = user.discordId === targetId;

      if (!isStaffOrAdmin && !isSelf) {
        res.status(403).json({ error: 'PERMISSION_DENIED: Cannot access audit history for other users.' });
        return;
      }

      const history = await getAdvertiserRankAuditHistory(targetId);
      res.json({ success: true, history });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch rank audit history' });
    }
  }
);


